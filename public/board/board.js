import { openMailto } from '/shared/openMailto.js';
import {
  barPercents,
  chartAxis,
  formatClock,
  overlappingBars,
  overlapWarning,
  routeBars,
  tripInterval,
} from '/board/gantt.js';
import {
  formatDuration,
  formatPreference,
  parsePreference,
  PREFERENCE_LIMIT,
  totalDayMinutes,
} from '/board/preference.js';
import {
  formatSheetDate,
  givenName,
  rosterName,
  sheetWeekday,
  splitClock,
  suggestedInitials,
  TIME_FIELDS,
  TIME_LABELS,
  SHEET_DAYS,
} from '/board/sheetFormat.js';

const ACTIVITIES = [
  'Volleyball',
  'Basketball',
  'Soccer',
  'Football',
  'Wrestling',
  'Track',
  'Swimming',
  'Choir',
  'Band',
  'Field trip',
];

const INKS = ['#1a3d8f', '#1a1a1a', '#0e6b32', '#6a2c86', '#8d1d3a'];

const state = {
  postings: [],
  notifications: [],
  drivers: [],
  schedules: [],
  mode: 'driver',
  driverId: '',
  selectedId: null,
  dirty: false,
  noticeOpen: false,
  status: '',
  statusError: false,
  shown: new Set(),
  dayBids: {},
};

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inkFor(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  return INKS[hash % INKS.length];
}

function setStatus(message, isError = false) {
  state.status = message || '';
  state.statusError = Boolean(isError);
  const el = $('sheet-status');
  if (!el) return;
  el.textContent = state.status;
  el.classList.toggle('is-error', state.statusError);
}

async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'The board could not save that.');
  }
  return data;
}

function visiblePostings() {
  if (state.mode === 'office') return state.postings;
  return state.postings.filter((row) => row.status !== 'draft');
}

function selectedPosting() {
  if (state.selectedId === 'new') return null;
  return state.postings.find((row) => row.id === state.selectedId) || null;
}

function noticesForMe() {
  const driverId = state.driverId;
  if (!driverId) return [];
  return state.notifications.filter((notice) => {
    const posting = state.postings.find((row) => row.id === notice.posting_id);
    if (notice.audience === 'all') return true;
    if (notice.audience === 'driver') return notice.driver_id === driverId;
    if (notice.audience === 'bidders') {
      if (notice.exclude_driver_id === driverId) return false;
      return Boolean(posting?.bids?.some((bid) => bid.driver_id === driverId));
    }
    return false;
  });
}

function unreadNotices() {
  return noticesForMe().filter((notice) => !notice.read_by.includes(state.driverId));
}

function markerText(value, short = false) {
  const text = String(value || '').trim();
  if (!text) return `<span class="blank-line${short ? ' short' : ''}"></span>`;
  return `<span class="marker">${esc(text)}</span>`;
}

function checkMark(label, name, value, checked, inputType) {
  return `<label class="mark${checked ? ' is-checked' : ''}">
    <input type="${inputType}" name="${name}" value="${esc(value)}"${checked ? ' checked' : ''} />
    <span class="mark-box"></span>
    ${esc(label)}
  </label>`;
}

function staticCheck(label, checked) {
  return `<span class="mark${checked ? ' is-checked' : ''}">
    <span class="mark-box"></span>
    ${esc(label)}
  </span>`;
}

function dayChips(active) {
  return SHEET_DAYS.map(
    (day) => `<span class="day-chip${day === active ? ' is-on' : ''}" data-day="${day}">${day}</span>`
  ).join('');
}

function ampm(active) {
  return ['AM', 'PM']
    .map(
      (mer) =>
        `<span class="mer${mer === active ? ' is-on' : ''}" data-meridiem="${mer}">${mer}</span>`
    )
    .join('');
}

function timeRow(key, posting, editing) {
  const value = posting.times?.[key] || '';
  const clock = splitClock(value);
  const control = editing
    ? `<input class="marker-field short" type="time" name="${key}" value="${esc(value)}" />`
    : markerText(clock.display, true);
  return `<div class="time-row">
    <span class="lbl">${TIME_LABELS[key]}:</span>
    <span class="time-value">${control}<span class="ampm">${ampm(clock.meridiem)}</span></span>
  </div>`;
}

function suggestions(kind) {
  const values = new Set(kind === 'activity' ? ACTIVITIES : ['SMS', 'Nooksack HS']);
  for (const posting of state.postings) {
    const value = posting[kind];
    if (value) values.add(value);
    if (kind === 'school' && posting.pickup_location) values.add(posting.pickup_location);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

function dataList(id, values) {
  return `<datalist id="${id}">${values.map((value) => `<option value="${esc(value)}"></option>`).join('')}</datalist>`;
}

function combo(name, value, listId, editing) {
  if (!editing) return markerText(value);
  return `<input class="marker-field" name="${name}" list="${listId}" value="${esc(value)}" autocomplete="off" />`;
}

function mySchedules() {
  if (!state.driverId) return [];
  return state.schedules.filter((row) => row.driver_id === state.driverId);
}

function myBid(posting) {
  return (posting.bids || []).find((bid) => bid.driver_id === state.driverId) || null;
}

function tripToken(posting) {
  return String(posting?.trip_number || '').replace(/\s+/g, ' ').trim();
}

function seedDayBid(postings) {
  const mine = postings
    .filter((posting) => posting.status === 'posted' && myBid(posting))
    .map((posting) => ({ posting, bid: myBid(posting) }))
    .sort((a, b) => String(b.bid.signed_at).localeCompare(String(a.bid.signed_at)));
  const parsed = parsePreference(mine[0]?.bid.preference || '');
  const byToken = new Map();
  for (const posting of postings) {
    if (posting.status !== 'posted') continue;
    const token = tripToken(posting);
    if (!token || byToken.has(token)) continue;
    byToken.set(token, posting.id);
  }
  const used = new Set();
  const take = (tokens) =>
    (tokens || [])
      .map((token) => {
        const id = byToken.get(token);
        if (!id || used.has(id)) return '';
        used.add(id);
        return id;
      })
      .filter(Boolean);
  const primary = take(parsed.groups[0]);
  const secondary = take(parsed.groups[1]);
  for (const row of mine) {
    if (used.has(row.posting.id)) continue;
    primary.push(row.posting.id);
    used.add(row.posting.id);
  }
  return { mode: parsed.mode === 'many' ? 'many' : 'one', primary, secondary, dirty: false };
}

function dayBidFor(date, postings) {
  const current = state.dayBids[date];
  if (current?.dirty) return current;
  const seeded = seedDayBid(postings);
  state.dayBids[date] = seeded;
  return seeded;
}

function listRank(day, postingId) {
  const primary = day.primary.indexOf(postingId);
  if (primary >= 0) return primary + 1;
  const secondary = day.secondary.indexOf(postingId);
  if (secondary >= 0) return secondary + 1;
  return 0;
}

function chosenIds(day) {
  return [...day.primary, ...day.secondary];
}

function tripLabel(posting) {
  const number = posting.trip_number ? `Trip #${posting.trip_number}` : 'Extra trip';
  return [number, posting.destination || posting.school, posting.activity].filter(Boolean).join(' · ');
}

function groupByDate(postings) {
  const groups = new Map();
  for (const posting of postings) {
    const key = posting.trip_date || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(posting);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function hourTick(minutes) {
  return formatClock(minutes).replace(':00', '');
}

function barMarkup(tag, attrs, interval, axis, classes, title, text) {
  const pos = barPercents(interval, axis);
  return `<${tag} class="gantt-bar ${classes}"${attrs} style="left:${pos.left}%;width:${pos.width}%" title="${esc(title)}">${esc(text)}</${tag}>`;
}

function bidSpan(posting) {
  const interval = tripInterval(posting.times);
  if (!interval) return 'Times not complete';
  return `${formatClock(interval.start)}–${formatClock(interval.end)}`;
}

function bidRow(posting, day, listName, routeSegments) {
  const rank = listRank(day, posting.id);
  const interval = tripInterval(posting.times);
  const overlaps = overlappingBars(interval, routeSegments);
  const date = posting.trip_date || '';
  const list = day[listName];
  const index = list.indexOf(posting.id);
  const other = listName === 'primary' ? 'secondary' : 'primary';
  const otherLabel = listName === 'primary' ? 'Then' : 'First';
  const warning = overlaps.length
    ? `<p class="overlap-warn" role="status">${esc(overlapWarning(tripLabel(posting), interval, routeSegments))}</p>`
    : '';
  const missing = interval
    ? ''
    : `<p class="overlap-warn" role="status">This trip has no start and end time yet, so the hours cannot be checked. You can still keep it on the list.</p>`;
  return `<li class="bid-row${overlaps.length ? ' has-overlap' : ''}" draggable="true" data-bid-row data-id="${esc(posting.id)}" data-date="${esc(date)}" data-list="${listName}">
    <div class="bid-row-main">
      <span class="drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">↕</span>
      <span class="bid-rank">${rank}</span>
      <span class="bid-row-text"><strong>${esc(tripLabel(posting))}</strong> · ${esc(bidSpan(posting))}</span>
    </div>
    <div class="bid-row-actions">
      <button type="button" data-action="bid-up" data-id="${esc(posting.id)}" data-date="${esc(date)}" data-list="${listName}"${index <= 0 ? ' disabled' : ''}>Up</button>
      <button type="button" data-action="bid-down" data-id="${esc(posting.id)}" data-date="${esc(date)}" data-list="${listName}"${index < 0 || index >= list.length - 1 ? ' disabled' : ''}>Down</button>
      <button type="button" data-action="bid-move" data-id="${esc(posting.id)}" data-date="${esc(date)}" data-list="${listName}" data-target="${other}">${otherLabel}</button>
      <button type="button" data-action="bid-remove" data-id="${esc(posting.id)}" data-date="${esc(date)}">Remove</button>
    </div>
    ${warning}${missing}
  </li>`;
}

function bidList(date, day, listName, routeSegments, emptyText) {
  const ids = day[listName];
  const rows = ids
    .map((id) => state.postings.find((row) => row.id === id))
    .filter((posting) => posting && posting.status === 'posted')
    .map((posting) => bidRow(posting, day, listName, routeSegments))
    .join('');
  return `<ol class="bid-stack" data-bid-list data-date="${esc(date)}" data-list="${listName}">
    ${rows || `<li class="bid-empty">${esc(emptyText)}</li>`}
  </ol>`;
}

function dayCipher(day, postings) {
  const tokenFor = (id) => tripToken(postings.find((row) => row.id === id) || state.postings.find((row) => row.id === id));
  return formatPreference(day.mode, day.primary.map(tokenFor), day.secondary.map(tokenFor));
}

function dayHoursText(day, routeSegments) {
  const routeMinutes = routeSegments.reduce((sum, bar) => sum + (bar.end - bar.start), 0);
  const tripMinutes = chosenIds(day).reduce((sum, id) => {
    const posting = state.postings.find((row) => row.id === id);
    const interval = posting ? tripInterval(posting.times) : null;
    return sum + (interval ? interval.end - interval.start : 0);
  }, 0);
  const total = totalDayMinutes(routeMinutes, tripMinutes);
  if (!routeMinutes && !tripMinutes) return 'No clocks yet, so the daily total is unknown.';
  if (!routeMinutes) return `These trips add ${formatDuration(tripMinutes)}. No regular route clocks are on file.`;
  if (!tripMinutes) return `Regular runs ${formatDuration(routeMinutes)}.`;
  return `Regular runs ${formatDuration(routeMinutes)}. With these trips, ${formatDuration(total)}.`;
}

function renderDayBid(date, postings, routeSegments) {
  const posted = postings.filter((row) => row.status === 'posted');
  if (!posted.length) {
    return `<div class="day-bid"><p class="bid-howto">These trips are already awarded.</p></div>`;
  }
  const day = dayBidFor(date, postings);
  const cipher = dayCipher(day, postings);
  const missingNumber = chosenIds(day).some((id) => !tripToken(state.postings.find((row) => row.id === id)));
  const tokens = chosenIds(day).map((id) => tripToken(state.postings.find((row) => row.id === id))).filter(Boolean);
  const duplicate = tokens.some((token, index) => tokens.indexOf(token) !== index);
  const tooLong = cipher.length > PREFERENCE_LIMIT;
  let sheetLine = 'Add a trip and save. Nothing is written on the sheet yet.';
  if (cipher) sheetLine = `Written on the sheet as ${cipher}.`;
  if (missingNumber) sheetLine = 'One trip has no trip number, so this list cannot be written on the sheet yet.';
  if (duplicate) sheetLine = 'Two trips share a number, so the sheet cannot tell them apart.';
  if (tooLong) sheetLine = 'This list is too long to write on the sheet. Remove a trip.';
  const saved = !day.dirty && !missingNumber && !duplicate && !tooLong && dayMatchesSheet(day, postings, cipher);
  const saveNote = saved
    ? cipher
      ? 'On the sheet.'
      : 'Your name is not on these trips.'
    : 'Not saved yet.';
  return `<div class="day-bid">
    <p class="bid-howto">Click a trip to add it. Drag a row, or use Up and Down, so your first choice is on top.</p>
    <p class="bid-howto">Only one gives you the highest trip that fits. As many as fit gives you every trip in the first list that fits, then the second list. A warning means the trip crosses a regular run. You can still keep it.</p>
    <div class="bid-mode" role="group" aria-label="How many trips you want">
      <button type="button" class="${day.mode === 'one' ? 'is-on' : ''}" data-action="bid-mode" data-date="${esc(date)}" data-mode="one">Only one</button>
      <button type="button" class="${day.mode === 'many' ? 'is-on' : ''}" data-action="bid-mode" data-date="${esc(date)}" data-mode="many">As many as fit</button>
    </div>
    <h3>Your choices</h3>
    ${bidList(date, day, 'primary', routeSegments, 'Click a trip on the chart.')}
    <h3>Then these</h3>
    <p class="bid-note">Backup set. Dispatch uses it after the first list.</p>
    ${bidList(date, day, 'secondary', routeSegments, 'Choose Then on a row, or drag a trip here.')}
    <p class="day-total">${esc(dayHoursText(day, routeSegments))}</p>
    <p class="cipher-preview">${esc(sheetLine)}</p>
    <div class="pick-actions">
      <button type="button" class="primary" data-action="save-day" data-date="${esc(date)}"${missingNumber || duplicate || tooLong || !state.driverId ? ' disabled' : ''}>Save this day</button>
      <span class="signed-note">${esc(saveNote)}</span>
    </div>
  </div>`;
}

function dayMatchesSheet(day, postings, cipher) {
  const chosen = new Set(chosenIds(day));
  for (const posting of postings) {
    if (posting.status !== 'posted') continue;
    const bid = myBid(posting);
    if (chosen.has(posting.id)) {
      if (!bid || bid.preference !== cipher) return false;
    } else if (bid) {
      return false;
    }
  }
  return true;
}

function renderDay(date, postings, routeSegments) {
  const heading = date ? `${sheetWeekday(date) || ''} ${formatSheetDate(date)}`.trim() : 'No date';
  const tripIntervals = postings.map((posting) => tripInterval(posting.times));
  const axis = chartAxis([...routeSegments, ...tripIntervals.filter(Boolean)]);
  const ticks = [];
  for (let minute = axis.start; minute <= axis.end; minute += 60) ticks.push(minute);
  const scale = `<div class="gantt-scale">${ticks
    .map((minute) => {
      const left = barPercents({ start: minute, end: minute + 1 }, axis).left;
      return `<span class="gantt-tick" style="left:${left}%">${esc(hourTick(minute))}</span>`;
    })
    .join('')}</div>`;
  const trackStyle = ` style="--hours:${(axis.end - axis.start) / 60}"`;
  const routeRow = routeSegments.length
    ? `<div class="gantt-label">My routes</div><div class="gantt-track"${trackStyle}>${routeSegments
        .map((bar) =>
          barMarkup(
            'div',
            '',
            bar,
            axis,
            'route',
            `${bar.label} ${formatClock(bar.start)}–${formatClock(bar.end)}`,
            bar.label
          )
        )
        .join('')}</div>`
    : '';
  const day = dayBidFor(date, postings);
  const tripRows = postings
    .map((posting, index) => {
      const interval = tripIntervals[index];
      const overlaps = overlappingBars(interval, routeSegments);
      const label = tripLabel(posting);
      const short = posting.trip_number ? `#${posting.trip_number}` : 'Trip';
      const rank = listRank(day, posting.id);
      if (!interval) {
        const openTag = posting.status === 'posted' ? 'button' : 'div';
        const openAttrs =
          posting.status === 'posted'
            ? ` type="button" class="gantt-open-btn" data-action="pick-trip" data-id="${esc(posting.id)}"`
            : '';
        return `<div class="gantt-label">${esc(rank ? `${rank} ${short}` : short)}</div><div class="gantt-track gantt-open"${trackStyle}><${openTag}${openAttrs}>${esc(label)} — times not complete</${openTag}></div>`;
      }
      const awarded = posting.status === 'awarded';
      const mine = awarded && posting.awarded_driver_id === state.driverId;
      const classes = [
        'trip',
        rank ? 'is-selected' : '',
        overlaps.length ? 'is-overlap' : '',
        awarded ? 'is-awarded' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const text = mine ? 'Awarded to you' : awarded ? 'Awarded' : rank ? `${rank}  ${label}` : label;
      const tag = awarded ? 'div' : 'button';
      const attrs = awarded
        ? ''
        : ` type="button" data-action="pick-trip" data-id="${esc(posting.id)}"`;
      return `<div class="gantt-label">${esc(short)}</div><div class="gantt-track"${trackStyle}>${barMarkup(tag, attrs, interval, axis, classes, label, text)}</div>`;
    })
    .join('');

  return `<section class="day-chart">
    <h2>${esc(heading)}</h2>
    <p class="gantt-legend"><span class="swatch route"></span> Regular run <span class="swatch trip"></span> Extra trip <span class="swatch overlap"></span> Crosses a regular run</p>
    <div class="gantt-scroll">
      <div class="gantt">
        <div class="gantt-label"></div>
        ${scale}
        ${routeRow}
        ${tripRows}
      </div>
    </div>
    ${renderDayBid(date, postings, routeSegments)}
  </section>`;
}

function renderDriverBoard() {
  const root = $('sheet-root');
  const groups = groupByDate(visiblePostings());
  const bars = routeBars(mySchedules());
  const driver = state.drivers.find((row) => row.driver_id === state.driverId);
  const lead = !driver
    ? 'Choose your name to put your regular runs on the chart with these trips.'
    : bars.length
      ? `Regular runs for ${driver.name} are on the chart with every posted trip.`
      : `${driver.name} has no regular route clocks on file. Posted trips are still on the chart.`;
  if (!groups.length) {
    root.innerHTML = `<div class="day-chart"><p class="driver-lead">${esc(lead)}</p><p>No extra trips are posted.</p></div>`;
    return;
  }
  root.innerHTML = `<div class="driver-board">
    <p class="driver-lead">${esc(lead)} Click a trip to put it on your list for that day.</p>
    ${groups.map(([date, postings]) => renderDay(date, postings, bars)).join('')}
  </div>`;
}

function renderSheet() {
  if (state.mode === 'driver') {
    renderDriverBoard();
    return;
  }
  const root = $('sheet-root');
  const posting = state.selectedId === 'new' ? blankPosting() : selectedPosting();
  if (!posting) {
    root.innerHTML = `<div class="sheet"><p>No trip sheet is on the board.</p></div>`;
    return;
  }
  const editing = state.mode === 'office' && posting.status !== 'awarded';
  const day = sheetWeekday(posting.trip_date);
  const winner = state.drivers.find((driver) => driver.driver_id === posting.awarded_driver_id);
  const stamp = winner
    ? `<div class="award-stamp" aria-label="Awarded to ${esc(winner.name)}">${esc(givenName(winner.name))}</div>`
    : '';
  const tools = editing
    ? `<div class="sheet-tools">
        <button type="button" class="primary" data-action="save">${posting.id ? 'Save' : 'Save draft'}</button>
        ${posting.status === 'draft' ? '<button type="button" data-action="post">Post to the board</button>' : ''}
        ${posting.id && posting.status === 'draft' ? '<button type="button" data-action="delete-draft">Delete draft</button>' : ''}
      </div>`
    : '';

  root.innerHTML = `${tools}
    <article class="sheet">
      <p class="sheet-kicker">Field trip information - read carefully.</p>
      <p class="sheet-disclaimer">All trips are Subject to change based on driver availability.</p>
      <form id="trip-form">
        <div class="form-line">
          <span class="lbl">Trip date:</span>
          ${
            editing
              ? `<input class="marker-field date" type="date" name="trip_date" value="${esc(posting.trip_date)}" />`
              : markerText(formatSheetDate(posting.trip_date))
          }
          <span class="lbl">Day:</span>
          <span class="days">${dayChips(day)}</span>
        </div>
        <div class="form-line">
          <span class="lbl">School:</span>
          ${combo('school', posting.school, 'school-list', editing)}
        </div>
        <div class="form-line">
          <span class="lbl">Pick up location:</span>
          ${combo('pickup_location', posting.pickup_location, 'school-list', editing)}
        </div>
        <div class="form-line">
          ${
            editing
              ? `<span class="checks">
                  ${checkMark('Whole', 'leg', 'whole', posting.leg === 'whole', 'radio')}
                  ${checkMark('To Only', 'leg', 'to_only', posting.leg === 'to_only', 'radio')}
                  ${checkMark('Return Only', 'leg', 'return_only', posting.leg === 'return_only', 'radio')}
                </span>`
              : `<span class="checks">
                  ${staticCheck('Whole', posting.leg === 'whole')}
                  ${staticCheck('To Only', posting.leg === 'to_only')}
                  ${staticCheck('Return Only', posting.leg === 'return_only')}
                </span>`
          }
        </div>
        <div class="form-line">
          <span class="lbl">Destination:</span>
          ${combo('destination', posting.destination, 'destination-list', editing)}
          <span class="lbl">Passengers</span>
          ${
            editing
              ? `<input class="marker-field short" name="passenger_count" value="${esc(posting.passenger_count)}" inputmode="numeric" />
                 / <input class="marker-field short" name="passenger_capacity" value="${esc(posting.passenger_capacity)}" inputmode="numeric" />`
              : `${markerText(posting.passenger_count, true)} / ${markerText(posting.passenger_capacity, true)}`
          }
        </div>
        <div class="form-line">
          <span class="lbl">Activity:</span>
          ${combo('activity', posting.activity, 'activity-list', editing)}
        </div>
        ${dataList('school-list', suggestions('school'))}
        ${dataList('destination-list', suggestions('destination'))}
        ${dataList('activity-list', suggestions('activity'))}
        <div class="times-wrap">
          <div>
            <h2 class="times-title">Trip Times</h2>
            ${TIME_FIELDS.map((key) => timeRow(key, posting, editing)).join('')}
            <div class="form-line bus-line">
              <span class="lbl">Number of Buses:</span>
            </div>
            <div class="form-line">
              ${
                editing
                  ? `<span class="checks">
                      ${checkMark('Big Bus', 'bus_big', 'on', posting.buses.big, 'checkbox')}
                      ${checkMark('Small bus', 'bus_small', 'on', posting.buses.small, 'checkbox')}
                      ${checkMark('W/C Bus', 'bus_wc', 'on', posting.buses.wc, 'checkbox')}
                    </span>`
                  : `<span class="checks">
                      ${staticCheck('Big Bus', posting.buses.big)}
                      ${staticCheck('Small bus', posting.buses.small)}
                      ${staticCheck('W/C Bus', posting.buses.wc)}
                    </span>`
              }
            </div>
            <div class="form-line storage-line">
              <span class="lbl">Storage:</span>
              ${
                editing
                  ? `<span class="checks">
                      ${checkMark('Yes', 'storage', 'yes', posting.storage === 'yes', 'radio')}
                      ${checkMark('No', 'storage', 'no', posting.storage === 'no', 'radio')}
                    </span>`
                  : `<span class="checks">
                      ${staticCheck('Yes', posting.storage === 'yes')}
                      ${staticCheck('No', posting.storage === 'no')}
                    </span>`
              }
            </div>
          </div>
          <div>
            <h2 class="comments-title">Comments</h2>
            <div class="form-line">
              <span class="lbl">Trip #</span>
              ${
                editing
                  ? `<input class="marker-field short" name="trip_number" value="${esc(posting.trip_number)}" />`
                  : markerText(posting.trip_number ? posting.trip_number : '', true)
              }
            </div>
            ${
              editing
                ? `<textarea class="marker-field" name="comments">${esc(posting.comments)}</textarea>`
                : `<div class="marker">${esc(posting.comments)}</div>`
            }
            ${stamp}
          </div>
        </div>
      </form>
      ${rosterTable(posting)}
      ${
        state.mode === 'driver' && posting.status === 'posted'
          ? `<p class="bid-hint">No parentheses means one assignment that day. Parentheses means all the work you can get. Examples: 3,7 or (3-8) or (1-5), (6-10). Write your total daily time in the preference if dispatch needs the hours.</p>`
          : ''
      }
    </article>`;
  bindLiveMarks(root);
  root.querySelectorAll('[name="bid_initials"], [name="bid_preference"]').forEach((input) => {
    input.addEventListener('input', () => {
      state.dirty = true;
    });
  });
}

function blankPosting() {
  return {
    id: '',
    status: 'draft',
    trip_number: '',
    trip_date: '',
    school: '',
    pickup_location: '',
    leg: '',
    destination: '',
    activity: '',
    passenger_count: '',
    passenger_capacity: '',
    times: Object.fromEntries(TIME_FIELDS.map((key) => [key, ''])),
    buses: { big: false, small: false, wc: false },
    storage: '',
    comments: '',
    bids: [],
    awarded_driver_id: null,
  };
}

function rosterTable(posting) {
  if (!state.drivers.length) {
    return `<p class="empty-roster">The signup list comes from Drivers/Routes, in seniority order. Add drivers there and this sheet will fill in.</p>`;
  }
  const mid = Math.ceil(state.drivers.length / 2);
  const left = state.drivers.slice(0, mid);
  const right = state.drivers.slice(mid);
  const rows = left
    .map((driver, index) => {
      const other = right[index] || null;
      return `<tr>
        ${rosterCells(driver, posting, 'Order #')}
        ${other ? rosterCells(other, posting, 'Seniority #') : '<td></td><td></td><td></td>'}
      </tr>`;
    })
    .join('');
  return `<table class="roster">
    <thead>
      <tr>
        <th>Order #</th>
        <th>Driver Name</th>
        <th>Initial &amp; indicate preference</th>
        <th>Seniority #</th>
        <th>Driver Name</th>
        <th>Initial &amp; indicate preference</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function rosterCells(driver, posting, _heading) {
  const rank = driver.seniority_rank ?? '';
  const winner = posting.awarded_driver_id === driver.driver_id;
  const bid = (posting.bids || []).find((row) => row.driver_id === driver.driver_id);
  return `<td class="num">${esc(rank)}</td>
    <td class="who${winner ? ' is-winner' : ''}">${esc(rosterName(driver.name))}</td>
    <td>${bidCell(driver, posting, bid)}</td>`;
}

function bidCell(driver, posting, bid) {
  const mine = state.mode === 'driver' && state.driverId === driver.driver_id && posting.status === 'posted';
  if (mine) {
    const initials = bid?.initials || suggestedInitials(driver.name);
    const ink = inkFor(driver.driver_id);
    return `<div class="bid-edit">
      <input class="ink-field" name="bid_initials" maxlength="12" aria-label="Your initials" value="${esc(initials)}" style="color:${ink}" />
      <input class="ink-field pref" name="bid_preference" maxlength="240" aria-label="Your preference" placeholder="3 or (3,7)" value="${esc(bid?.preference || '')}" style="color:${ink}" />
      <button type="button" class="mini-btn" data-action="sign">Initial</button>
      ${bid ? '<button type="button" class="mini-btn" data-action="clear-bid">Clear</button>' : ''}
    </div>`;
  }
  const ink = inkFor(driver.driver_id);
  const text = bid ? [bid.initials, bid.preference].filter(Boolean).join(' ') : '';
  const award =
    state.mode === 'office' && bid && posting.status !== 'draft' && posting.awarded_driver_id !== driver.driver_id
      ? `<button type="button" class="mini-btn" data-action="award" data-driver-id="${esc(driver.driver_id)}">Award</button>`
      : '';
  if (!text && !award) return '';
  return `${text ? `<span class="ink" style="color:${ink}">${esc(text)}</span>` : ''} ${award}`;
}

function bindLiveMarks(root) {
  const form = root.querySelector('#trip-form');
  if (!form) return;
  const sync = () => {
    const date = form.querySelector('[name="trip_date"]');
    if (date) {
      const day = sheetWeekday(date.value);
      form.querySelectorAll('[data-day]').forEach((el) => {
        el.classList.toggle('is-on', el.dataset.day === day);
      });
    }
    form.querySelectorAll('input[type="time"]').forEach((input) => {
      const hour = input.value ? Number(input.value.slice(0, 2)) : null;
      const mer = hour == null || Number.isNaN(hour) ? '' : hour >= 12 ? 'PM' : 'AM';
      input.parentElement?.querySelectorAll('[data-meridiem]').forEach((el) => {
        el.classList.toggle('is-on', el.dataset.meridiem === mer);
      });
    });
    form.querySelectorAll('.mark input').forEach((input) => {
      input.parentElement?.classList.toggle('is-checked', input.checked);
    });
  };
  form.addEventListener('input', () => {
    state.dirty = true;
    sync();
    const school = form.querySelector('[name="school"]');
    const pickup = form.querySelector('[name="pickup_location"]');
    if (school && pickup && document.activeElement === school && !pickup.dataset.touched) {
      pickup.value = school.value;
    }
  });
  form.querySelector('[name="pickup_location"]')?.addEventListener('input', (event) => {
    event.target.dataset.touched = '1';
  });
  form.addEventListener('submit', (event) => event.preventDefault());
  sync();
}

function readForm() {
  const form = document.getElementById('trip-form');
  const data = new FormData(form);
  const times = {};
  for (const key of TIME_FIELDS) times[key] = String(data.get(key) || '');
  return {
    trip_number: String(data.get('trip_number') || ''),
    trip_date: String(data.get('trip_date') || ''),
    school: String(data.get('school') || ''),
    pickup_location: String(data.get('pickup_location') || ''),
    leg: String(data.get('leg') || ''),
    destination: String(data.get('destination') || ''),
    activity: String(data.get('activity') || ''),
    passenger_count: String(data.get('passenger_count') || ''),
    passenger_capacity: String(data.get('passenger_capacity') || ''),
    times,
    buses: {
      big: data.get('bus_big') === 'on',
      small: data.get('bus_small') === 'on',
      wc: data.get('bus_wc') === 'on',
    },
    storage: String(data.get('storage') || ''),
    comments: String(data.get('comments') || ''),
  };
}

function renderSide() {
  const side = $('board-side');
  const postings = visiblePostings();
  const items =
    state.mode === 'driver'
      ? `<p class="side-note">The chart shows posted trips next to your regular runs. Other drivers' initials stay on the office sheet.</p>`
      : postings
          .map((posting) => {
            const title = posting.trip_number ? `Trip #${posting.trip_number}` : 'Untitled sheet';
            const when = formatSheetDate(posting.trip_date) || 'No date';
            const place = posting.destination || posting.school || '';
            return `<button type="button" class="sheet-link${posting.id === state.selectedId ? ' is-on' : ''}" data-action="select" data-id="${esc(posting.id)}">
        <strong>${esc(title)}</strong>
        <span>${esc(when)}${place ? ` · ${esc(place)}` : ''} · ${esc(posting.status)}</span>
      </button>`;
          })
          .join('') || '<p class="side-note">No sheets on this board yet.</p>';
  const create =
    state.mode === 'office'
      ? `<button type="button" class="side-btn" data-action="new">New trip sheet</button>`
      : '';
  const mail =
    state.mode === 'office'
      ? state.postings
          .filter((posting) => posting.winner_email)
          .map((posting) => {
            const email = posting.winner_email;
            const winner = state.drivers.find((driver) => driver.driver_id === posting.awarded_driver_id);
            return `<article class="mail-card">
              <h2>Email to ${esc(winner ? givenName(winner.name) : 'winner')}</h2>
              <p>${esc(email.subject)}</p>
              <p>${esc(email.disabled_reason || email.to_email || '')}</p>
              <pre class="mail-body">${esc(email.body)}</pre>
              <button type="button" class="mail-btn" data-action="open-mail" data-id="${esc(posting.id)}"${email.can_send ? '' : ' disabled'}>Open email</button>
            </article>`;
          })
          .join('')
      : '';
  const directions =
    state.mode === 'driver'
      ? `<details class="directions">
          <summary>Sign-up directions</summary>
          <p>Click a trip to add it. Drag a row, or use Up and Down, so your first choice is on top.</p>
          <p>Only one gives you the highest trip that fits. As many as fit gives you every trip in the first list that fits, then the second list.</p>
          <p>A warning means the trip crosses a regular run. You can still keep it. The hours under the list include your regular runs.</p>
        </details>`
      : '';
  side.innerHTML = `${create}
    ${items}
    ${mail}
    ${directions}`;
}

function renderIdentity() {
  const wrap = $('identity-wrap');
  const select = $('driver-identity');
  const bell = $('notice-bell');
  wrap.hidden = state.mode !== 'driver';
  bell.hidden = state.mode !== 'driver';
  $('mode-office').classList.toggle('is-on', state.mode === 'office');
  $('mode-driver').classList.toggle('is-on', state.mode === 'driver');
  const current = state.driverId;
  select.innerHTML =
    `<option value="">Choose your name</option>` +
    state.drivers
      .map(
        (driver) =>
          `<option value="${esc(driver.driver_id)}"${driver.driver_id === current ? ' selected' : ''}>${esc(rosterName(driver.name))}</option>`
      )
      .join('');
  const unread = unreadNotices().length;
  const count = $('notice-count');
  count.textContent = String(unread);
  count.classList.toggle('is-zero', unread === 0);
}

function renderNotices() {
  const panel = $('notice-panel');
  if (!state.noticeOpen || state.mode !== 'driver') {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  const notes = noticesForMe();
  panel.hidden = false;
  panel.innerHTML = `<h2>Your notices</h2>${
    notes.length
      ? notes
          .map(
            (notice) => `<article class="notice">
              <strong>${esc(notice.title)}</strong>
              <p>${esc(notice.body)}</p>
            </article>`
          )
          .join('')
      : '<p>No notices yet. Choose your name to see awards and new sheets.</p>'
  }`;
}

function showNewToasts() {
  if (state.mode !== 'driver' || !state.driverId) return;
  const fresh = unreadNotices().filter((notice) => !state.shown.has(notice.id));
  if (!fresh.length) return;
  const host = $('toasts');
  for (const notice of fresh.slice(0, 2)) {
    state.shown.add(notice.id);
    const toast = document.createElement('article');
    toast.className = 'toast';
    toast.innerHTML = `<strong>${esc(notice.title)}</strong><p>${esc(notice.body)}</p><button type="button">Dismiss</button>`;
    toast.querySelector('button').addEventListener('click', () => {
      toast.remove();
      markRead(notice.id);
    });
    host.appendChild(toast);
  }
}

async function markRead(id) {
  if (!state.driverId) return;
  try {
    await api(`/api/extra-work/notifications/${id}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driver_id: state.driverId }),
    });
    const notice = state.notifications.find((row) => row.id === id);
    if (notice && !notice.read_by.includes(state.driverId)) {
      notice.read_by.push(state.driverId);
    }
    renderIdentity();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function load({ keepSheet = false } = {}) {
  const data = await api('/api/extra-work');
  state.postings = data.postings || [];
  state.notifications = data.notifications || [];
  state.drivers = data.drivers || [];
  state.schedules = data.schedules || [];
  const visible = visiblePostings();
  if (state.selectedId === 'new') {
    // keep the unsaved sheet
  } else if (!visible.some((row) => row.id === state.selectedId)) {
    state.selectedId = visible[0]?.id || null;
  }
  renderSide();
  renderIdentity();
  renderNotices();
  if (!keepSheet || !state.dirty) renderSheet();
  showNewToasts();
  const status = $('sheet-status');
  if (!state.status) status.textContent = '';
}

function selectMode(mode) {
  state.mode = mode;
  localStorage.setItem('extra-work-mode', mode);
  state.dirty = false;
  state.noticeOpen = false;
  const visible = visiblePostings();
  if (state.selectedId === 'new' && mode === 'driver') state.selectedId = null;
  if (state.selectedId !== 'new' && !visible.some((row) => row.id === state.selectedId)) {
    state.selectedId = visible[0]?.id || null;
  }
  renderSide();
  renderIdentity();
  renderNotices();
  renderSheet();
  showNewToasts();
}

async function saveSheet() {
  const body = readForm();
  const isNew = !state.selectedId || state.selectedId === 'new';
  const saved = await api(isNew ? '/api/extra-work' : `/api/extra-work/${state.selectedId}`, {
    method: isNew ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  state.dirty = false;
  state.selectedId = saved.id;
  setStatus(saved.status === 'draft' ? 'Draft saved on this computer.' : 'Sheet saved.');
  await load();
  return saved;
}

async function postSheet() {
  const saved = await saveSheet();
  const result = await api(`/api/extra-work/${saved.id}/post`, { method: 'POST' });
  state.selectedId = result.posting.id;
  setStatus('Posted. Drivers get a notice on this board.');
  await load();
}

async function signSheet() {
  if (!state.driverId) {
    setStatus('Choose your name before you initial.', true);
    return;
  }
  const posting = selectedPosting();
  if (!posting) return;
  const initials = document.querySelector('[name="bid_initials"]')?.value || '';
  const preference = document.querySelector('[name="bid_preference"]')?.value || '';
  await api(`/api/extra-work/${posting.id}/bids`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      driver_id: state.driverId,
      initials,
      preference,
    }),
  });
  state.dirty = false;
  setStatus('Your initial is on the sheet.');
  await load();
}

function mutateDay(date, change) {
  const postings = visiblePostings().filter((row) => (row.trip_date || '') === date);
  const day = dayBidFor(date, postings);
  const before = JSON.stringify([day.mode, day.primary, day.secondary]);
  change(day);
  day.primary = day.primary.filter((id, index) => day.primary.indexOf(id) === index);
  day.secondary = day.secondary.filter((id) => !day.primary.includes(id));
  day.secondary = day.secondary.filter((id, index) => day.secondary.indexOf(id) === index);
  const after = JSON.stringify([day.mode, day.primary, day.secondary]);
  if (before === after) return;
  day.dirty = true;
  renderSheet();
}

function toggleDayTrip(posting) {
  if (!posting || posting.status !== 'posted') return;
  const date = posting.trip_date || '';
  mutateDay(date, (day) => {
    const inPrimary = day.primary.indexOf(posting.id);
    const inSecondary = day.secondary.indexOf(posting.id);
    if (inPrimary >= 0) day.primary.splice(inPrimary, 1);
    else if (inSecondary >= 0) day.secondary.splice(inSecondary, 1);
    else day.primary.push(posting.id);
  });
}

function moveBidRow(date, listName, id, delta) {
  mutateDay(date, (day) => {
    const list = day[listName];
    const index = list.indexOf(id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(next, 0, item);
  });
}

function moveBidList(date, fromName, id, toName) {
  mutateDay(date, (day) => {
    day.primary = day.primary.filter((row) => row !== id);
    day.secondary = day.secondary.filter((row) => row !== id);
    day[toName].push(id);
  });
}

function placeDraggedBid(date, listName, beforeId) {
  if (!dragBid || dragBid.date !== date) return;
  const id = dragBid.id;
  mutateDay(date, (day) => {
    day.primary = day.primary.filter((row) => row !== id);
    day.secondary = day.secondary.filter((row) => row !== id);
    const list = day[listName];
    const index = beforeId ? list.indexOf(beforeId) : -1;
    if (index < 0) list.push(id);
    else list.splice(index, 0, id);
  });
}

async function saveDay(date) {
  if (!state.driverId) {
    setStatus('Choose your name before you save.', true);
    return;
  }
  const driver = state.drivers.find((row) => row.driver_id === state.driverId);
  const postings = state.postings.filter((row) => (row.trip_date || '') === date);
  const day = state.dayBids[date] || dayBidFor(date, postings);
  const cipher = dayCipher(day, postings);
  if (cipher.length > PREFERENCE_LIMIT) {
    setStatus('This list is too long to write on the sheet. Remove a trip.', true);
    return;
  }
  const chosen = new Set(chosenIds(day));
  for (const posting of postings) {
    if (posting.status !== 'posted') continue;
    const bid = myBid(posting);
    if (chosen.has(posting.id)) {
      await api(`/api/extra-work/${posting.id}/bids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_id: state.driverId,
          initials: suggestedInitials(driver?.name || ''),
          preference: cipher,
        }),
      });
    } else if (bid) {
      await api(`/api/extra-work/${posting.id}/bids/${state.driverId}`, { method: 'DELETE' });
    }
  }
  if (state.dayBids[date]) state.dayBids[date].dirty = false;
  setStatus(cipher ? 'Your choices for this day are on the sheet.' : 'Your name is off the trips for this day.');
  await load();
}

async function award(driverId) {
  const driver = state.drivers.find((row) => row.driver_id === driverId);
  const posting = selectedPosting();
  if (!driver || !posting) return;
  const ok = window.confirm(
    `Award this sheet to ${driver.name}? The email to the winner will open for you to send.`
  );
  if (!ok) return;
  const result = await api(`/api/extra-work/${posting.id}/award`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driver_id: driverId }),
  });
  state.dirty = false;
  state.selectedId = result.posting.id;
  if (result.email?.mailto_url) {
    openMailto(result.email.mailto_url);
    setStatus(`Email to ${givenName(driver.name)} is open. Send it from your mail app.`);
  } else {
    setStatus(result.email?.disabled_reason || 'The award is on the sheet.', true);
  }
  await load();
}

document.body.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === 'new') {
      state.selectedId = 'new';
      state.dirty = true;
      state.mode = 'office';
      setStatus('');
      renderSide();
      renderSheet();
      return;
    }
    if (action === 'select') {
      state.selectedId = button.dataset.id;
      state.dirty = false;
      setStatus('');
      renderSide();
      renderSheet();
      return;
    }
    if (action === 'save') {
      await saveSheet();
      return;
    }
    if (action === 'post') {
      await postSheet();
      return;
    }
    if (action === 'delete-draft') {
      const posting = selectedPosting();
      if (!posting?.id) {
        state.selectedId = visiblePostings()[0]?.id || null;
        renderSide();
        renderSheet();
        return;
      }
      if (!window.confirm('Delete this draft sheet?')) return;
      await api(`/api/extra-work/${posting.id}`, { method: 'DELETE' });
      state.selectedId = null;
      state.dirty = false;
      setStatus('Draft deleted.');
      await load();
      return;
    }
    if (action === 'sign') {
      await signSheet();
      return;
    }
    if (action === 'pick-trip') {
      toggleDayTrip(state.postings.find((row) => row.id === button.dataset.id));
      return;
    }
    if (action === 'bid-mode') {
      mutateDay(button.dataset.date || '', (day) => {
        day.mode = button.dataset.mode === 'many' ? 'many' : 'one';
      });
      return;
    }
    if (action === 'bid-up') {
      moveBidRow(button.dataset.date || '', button.dataset.list, button.dataset.id, -1);
      return;
    }
    if (action === 'bid-down') {
      moveBidRow(button.dataset.date || '', button.dataset.list, button.dataset.id, 1);
      return;
    }
    if (action === 'bid-move') {
      moveBidList(button.dataset.date || '', button.dataset.list, button.dataset.id, button.dataset.target);
      return;
    }
    if (action === 'bid-remove') {
      mutateDay(button.dataset.date || '', (day) => {
        day.primary = day.primary.filter((id) => id !== button.dataset.id);
        day.secondary = day.secondary.filter((id) => id !== button.dataset.id);
      });
      return;
    }
    if (action === 'save-day') {
      await saveDay(button.dataset.date || '');
      return;
    }
    if (action === 'clear-bid') {
      const posting = selectedPosting();
      if (!posting || !state.driverId) return;
      await api(`/api/extra-work/${posting.id}/bids/${state.driverId}`, { method: 'DELETE' });
      setStatus('Your initial was cleared.');
      await load();
      return;
    }
    if (action === 'award') {
      await award(button.dataset.driverId);
      return;
    }
    if (action === 'open-mail') {
      const posting = state.postings.find((row) => row.id === button.dataset.id);
      if (posting?.winner_email?.mailto_url) openMailto(posting.winner_email.mailto_url);
    }
  } catch (error) {
    setStatus(error.message, true);
  }
});

$('mode-office').addEventListener('click', () => selectMode('office'));
$('mode-driver').addEventListener('click', () => selectMode('driver'));

$('driver-identity').addEventListener('change', () => {
  const previous = state.driverId;
  state.driverId = $('driver-identity').value;
  localStorage.setItem('extra-work-driver-id', state.driverId);
  state.shown.clear();
  if (previous) state.dayBids = {};
  renderIdentity();
  renderNotices();
  renderSheet();
  showNewToasts();
});

let dragBid = null;

document.body.addEventListener('dragstart', (event) => {
  const row = event.target.closest('[data-bid-row]');
  if (!row) return;
  dragBid = { id: row.dataset.id, date: row.dataset.date || '' };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', row.dataset.id);
  row.classList.add('is-dragging');
});

document.body.addEventListener('dragend', () => {
  dragBid = null;
  document.querySelectorAll('.is-dragging, .is-drop-target').forEach((el) => {
    el.classList.remove('is-dragging', 'is-drop-target');
  });
});

document.body.addEventListener('dragover', (event) => {
  const list = event.target.closest('[data-bid-list]');
  if (!list) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  if (!dragBid || (list.dataset.date || '') !== dragBid.date) return;
  document.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
  list.classList.add('is-drop-target');
});

document.body.addEventListener('drop', (event) => {
  const list = event.target.closest('[data-bid-list]');
  if (!list) return;
  event.preventDefault();
  if (!dragBid) {
    const id = event.dataTransfer?.getData('text/plain');
    if (!id) return;
    dragBid = { id, date: list.dataset.date || '' };
  }
  const row = event.target.closest('[data-bid-row]');
  let beforeId = null;
  if (row && row.dataset.id !== dragBid.id) {
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    beforeId = after ? row.nextElementSibling?.dataset?.id || null : row.dataset.id;
    if (beforeId === dragBid.id) beforeId = null;
  }
  const date = list.dataset.date || '';
  const listName = list.dataset.list === 'secondary' ? 'secondary' : 'primary';
  dragBid = { ...dragBid };
  placeDraggedBid(date, listName, beforeId);
  dragBid = null;
});

$('notice-bell').addEventListener('click', async () => {
  state.noticeOpen = !state.noticeOpen;
  renderNotices();
  if (state.noticeOpen) {
    const unread = unreadNotices();
    await Promise.all(unread.map((notice) => markRead(notice.id)));
  }
});

const params = new URLSearchParams(location.search);
const storedMode = localStorage.getItem('extra-work-mode');
state.mode = params.get('as') === 'office' || storedMode === 'office' ? 'office' : 'driver';
if (params.get('as') === 'driver') state.mode = 'driver';
state.driverId = localStorage.getItem('extra-work-driver-id') || '';

load().catch((error) => setStatus(error.message, true));
setInterval(() => {
  load({ keepSheet: true }).catch(() => {});
}, 20000);
