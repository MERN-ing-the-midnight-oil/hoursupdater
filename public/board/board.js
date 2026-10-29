import { openMailto } from '/shared/openMailto.js';
import { enhanceIcons } from '/shared/icons.js';
import {
  addIsoDays,
  barPercents,
  chartAxis,
  clipInterval,
  contentAxis,
  formatClock,
  freeWindows,
  mondayOf,
  subtractIntervals,
  openDuty,
  regularRouteBars,
  runSchoolLists,
  schoolsForWindow,
  overlappingBars,
  overlapWarning,
  packLanes,
  parseMinutes,
  tripInterval,
  weekDates,
  weekdayDates,
} from '/board/gantt.js';
import {
  AVAIL_WEEKDAYS,
  OPEN_MIDDAY_LABEL,
  assignedDayLoad,
  dayIsOpenOnSchedule,
  emptyAvailabilityWeek,
  lateInterestList,
  noWinnerText,
  normalizeTimeRanges,
  planDailyAwards,
  rangesOnSchedule,
  requestedDayLoad,
  sameAsCycle,
  weekdayEntryOpen,
  weekdayEntryRanges,
  weekdayKey,
  weeklyBusyBars,
} from '/board/dailyAward.js';
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

const boardParams = new URLSearchParams(location.search);
const boardList =
  boardParams.get('sheet') === 'roster'
    ? 'roster'
    : boardParams.get('sheet') === 'weekly'
      ? 'weekly'
      : boardParams.get('sheet') === 'daily'
        ? 'daily'
        : '';

const officeDesk = boardParams.get('as') === 'office';
const phoneView = !officeDesk && boardParams.get('view') === 'phone';
const fromDriver = boardParams.get('from') === 'driver';
const wallDisplay = !officeDesk && !phoneView && boardParams.get('display') === 'wall';
const requestedWeek = boardParams.get('week') || '';
const lockedWeek =
  /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) && mondayOf(requestedWeek) === requestedWeek ? requestedWeek : '';
const HALL_FONTS = [16, 20, 24, 32, 40];

const state = {
  postings: [],
  notifications: [],
  drivers: [],
  substitutes: [],
  schedules: [],
  routeNotes: {},
  roster: [],
  closedDays: [],
  availability: [],
  myAvailability: [],
  mySchedule: null,
  availDraft: null,
  availExceptionDraft: null,
  availError: '',
  availFocusDate: '',
  lateDraft: false,
  mode: officeDesk ? 'office' : 'driver',
  driverId: '',
  pinDriverId: '',
  pinDigits: '',
  pinMatches: [],
  pinError: '',
  shareUrl: '',
  weekStart: lockedWeek,
  weekChosen: Boolean(lockedWeek),
  postingPrint: false,
  postingsMonitor: 'this',
  postingsStatus: '',
  postingsStatusError: false,
  postTheWorkOpen: false,
  postingFont: 24,
  weeklyWeek: '',
  weeklyDay: '',
  weeklyEntry: false,
  dailyDay: '',
  dailyChoseAll: false,
  heldWork: [],
  tripLane: {},
  phoneDate: '',
  officePanel: 'sheets',
  signedIn: false,
  officePinMiss: false,
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
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'The board could not save that.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function postingList(posting) {
  if (posting?.list === 'roster' || posting?.list === 'weekly') return posting.list;
  return 'daily';
}

function onWeekWall() {
  if (boardList === 'roster') return !officeDesk;
  if (!officeDesk) return true;
  return boardList === 'daily' && state.officePanel !== 'sheets';
}

function visiblePostings() {
  const rows =
    state.mode === 'office' && !onWeekWall()
      ? state.postings
      : state.postings.filter((row) => row.status !== 'draft');
  if (!boardList) return rows;
  return rows.filter((row) => postingList(row) === boardList);
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
    if (boardList && posting && postingList(posting) !== boardList) return false;
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

function daySelect(active, editing) {
  const options = SHEET_DAYS.map(
    (day) => `<option value="${day}"${day === active ? ' selected' : ''}>${day}</option>`
  ).join('');
  return `<select class="day-select" data-sheet-day aria-label="Day"${editing ? '' : ' disabled'}>
    <option value="">Day</option>
    ${options}
  </select>`;
}

function dateForWeekday(iso, weekday) {
  const names = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const target = names.indexOf(weekday);
  if (target < 0) return iso || '';
  const base = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : localToday();
  const [year, month, day] = base.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const delta = (target - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${nextMonth}-${nextDay}`;
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
  if (editing) {
    return `<div class="time-row">
      <span class="lbl">${TIME_LABELS[key]}:</span>
      <input class="marker-field time" type="time" name="${key}" value="${esc(value)}" />
    </div>`;
  }
  const clock = splitClock(value);
  return `<div class="time-row">
    <span class="lbl">${TIME_LABELS[key]}:</span>
    <span class="time-value">${markerText(clock.display, true)}<span class="ampm">${ampm(clock.meridiem)}</span></span>
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

function leavesBeforeBoard() {
  return regularRouteBars(mySchedules()).some((bar) => bar.segment === 'AM' && bar.start < 6 * 60 + 15);
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
    ${rows || (emptyText ? `<li class="bid-empty">${esc(emptyText)}</li>` : '')}
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
  const posted = postings.filter((row) => row.status === 'posted' && !row.late_addition);
  if (dayIsClosed(date)) {
    return `<div class="day-bid"><p class="bid-howto">Sign-up for this day is closed.</p></div>`;
  }
  if (!posted.length) {
    return `<div class="day-bid"><p class="bid-howto">These trips are already awarded.</p></div>`;
  }
  const day = dayBidFor(date, postings);
  const cipher = dayCipher(day, postings);
  const missingNumber = chosenIds(day).some((id) => !tripToken(state.postings.find((row) => row.id === id)));
  const tokens = chosenIds(day).map((id) => tripToken(state.postings.find((row) => row.id === id))).filter(Boolean);
  const duplicate = tokens.some((token, index) => tokens.indexOf(token) !== index);
  const tooLong = cipher.length > PREFERENCE_LIMIT;
  let sheetLine = '';
  if (cipher) sheetLine = `Written on the sheet as ${cipher}.`;
  if (missingNumber) sheetLine = 'One trip has no trip number, so this list cannot be written on the sheet yet.';
  if (duplicate) sheetLine = 'Two trips share a number, so the sheet cannot tell them apart.';
  if (tooLong) sheetLine = 'This list is too long to write on the sheet. Remove a trip.';
  const saved = !day.dirty && !missingNumber && !duplicate && !tooLong && dayMatchesSheet(day, postings, cipher);
  const saveNote = saved
    ? cipher
      ? ''
      : 'Your name is not on these trips.'
    : 'Not saved yet.';
  return `<div class="day-bid">
    <div class="bid-mode" role="group" aria-label="How many trips you want">
      <button type="button" class="${day.mode === 'one' ? 'is-on' : ''}" data-action="bid-mode" data-date="${esc(date)}" data-mode="one">Only one</button>
      <button type="button" class="${day.mode === 'many' ? 'is-on' : ''}" data-action="bid-mode" data-date="${esc(date)}" data-mode="many">As many as fit</button>
    </div>
    <h3>Your choices</h3>
    ${bidList(date, day, 'primary', routeSegments, '')}
    <h3>Then these</h3>
    ${bidList(date, day, 'secondary', routeSegments, '')}
    <p class="day-total">${esc(dayHoursText(day, routeSegments))}</p>
    ${sheetLine ? `<p class="cipher-preview">${esc(sheetLine)}</p>` : ''}
    <div class="pick-actions">
      <button type="button" class="primary" data-action="save-day" data-date="${esc(date)}"${missingNumber || duplicate || tooLong || !state.driverId ? ' disabled' : ''}>Submit</button>
      ${saveNote ? `<span class="signed-note">${esc(saveNote)}</span>` : ''}
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
        const openSign = posting.status === 'posted' && !posting.late_addition;
        const openTag = openSign ? 'button' : 'div';
        const openAttrs = openSign
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
      const names = posting.signup_count ? ` · ${posting.signup_count} signed` : '';
      const text = mine
        ? 'Awarded to you'
        : awarded
          ? 'Awarded'
          : rank
            ? `${rank}  ${label}${names}`
            : `${label}${names}`;
      const signable = !awarded && !posting.late_addition;
      const tag = signable ? 'button' : 'div';
      const attrs = signable
        ? ` type="button" data-action="pick-trip" data-id="${esc(posting.id)}"`
        : '';
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
  const bars = regularRouteBars(mySchedules());
  if (!groups.length) {
    root.innerHTML = `<div class="day-chart"><p>No daily work is posted.</p></div>`;
    return;
  }
  root.innerHTML = `<div class="driver-board">
    ${groups.map(([date, postings]) => renderDay(date, postings, bars)).join('')}
  </div>`;
}

function localToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function ensureWeek(postings) {
  if (!state.weekStart) state.weekStart = mondayOf(localToday());
  if (state.weekChosen) return;
  const days = new Set(weekDates(state.weekStart));
  if (postings.some((row) => days.has(row.trip_date))) return;
  const dates = postings
    .map((row) => row.trip_date)
    .filter(Boolean)
    .sort();
  if (!dates.length) return;
  const today = localToday();
  const upcoming = dates.find((date) => date >= today) || dates[dates.length - 1];
  state.weekStart = mondayOf(upcoming);
}

function weeklyOfficeBounds() {
  const thisStart = mondayOf(localToday());
  const nextStart = addIsoDays(thisStart, 7);
  const span = (start) => ({ start, end: addIsoDays(start, 6), friday: addIsoDays(start, 4) });
  return { this: span(thisStart), next: span(nextStart) };
}

function weekKeyForDate(date) {
  const bounds = weeklyOfficeBounds();
  if (date >= bounds.next.start && date <= bounds.next.end) return 'next';
  if (date >= bounds.this.start && date <= bounds.this.end) return 'this';
  return state.weeklyWeek === 'next' ? 'next' : 'this';
}

function weeklyWeekKey() {
  if (state.weeklyWeek === 'this' || state.weeklyWeek === 'next') return state.weeklyWeek;
  const bounds = weeklyOfficeBounds();
  const has = (key) =>
    visiblePostings().some((row) => row.trip_date >= bounds[key].start && row.trip_date <= bounds[key].end);
  state.weeklyWeek = !has('this') && has('next') ? 'next' : 'this';
  return state.weeklyWeek;
}

function weeklyOfficeTable() {
  return officeDesk && boardList === 'weekly' && !state.weeklyEntry;
}

function defaultWeeklyDate() {
  const bounds = weeklyOfficeBounds();
  const week = bounds[weeklyWeekKey()];
  if (state.weeklyDay && state.weeklyDay >= week.start && state.weeklyDay <= week.end) return state.weeklyDay;
  const today = localToday();
  if (today >= week.start && today <= week.friday) return today;
  return week.start;
}

function weeklyTripRows(bounds) {
  return visiblePostings()
    .filter((row) => row.trip_date >= bounds.start && row.trip_date <= bounds.end)
    .sort((a, b) => {
      const byDate = String(a.trip_date).localeCompare(String(b.trip_date));
      if (byDate) return byDate;
      const startA = tripInterval(a.times)?.start ?? 0;
      const startB = tripInterval(b.times)?.start ?? 0;
      if (startA !== startB) return startA - startB;
      return String(a.trip_number).localeCompare(String(b.trip_number), undefined, { numeric: true });
    });
}

function sheetHour(minutes) {
  const hours = Math.round((Number(minutes) / 60) * 100) / 100;
  return hours.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
}

function interestedOnDay(dayRows) {
  const seen = new Map();
  for (const posting of dayRows) {
    for (const bid of posting.bids || []) {
      if (!bid?.driver_id || seen.has(bid.driver_id)) continue;
      seen.set(bid.driver_id, bid);
    }
  }
  return [...seen.entries()]
    .map(([id, bid]) => ({
      bid,
      driver: state.drivers.find((row) => row.driver_id === id) || {
        driver_id: id,
        name: bid.initials || 'Driver',
        seniority_rank: null,
      },
    }))
    .sort((a, b) => {
      const left = a.driver.seniority_rank ?? 9999;
      const right = b.driver.seniority_rank ?? 9999;
      if (left !== right) return left - right;
      return String(a.driver.name).localeCompare(String(b.driver.name));
    });
}

function schedulesForDriver(driverId) {
  return (state.schedules || []).filter((row) => row.driver_id === driverId);
}

function barsForDriver(driverId) {
  return regularRouteBars(schedulesForDriver(driverId));
}

function schoolListsForRoute(routeId) {
  return runSchoolLists(state.routeNotes?.[routeId] || '');
}

function awardedWeeklyBars(driverId, date) {
  if (!driverId || !date) return [];
  const source = [...(state.postings || []), ...(state.heldWork || [])];
  return weeklyBusyBars(source, date).filter((bar) => bar.driver_id === driverId);
}

function windowsForDriver(driverId, date = '') {
  const duty = openDuty(schedulesForDriver(driverId));
  let windows;
  if (duty?.kind === 'utility') {
    windows = [
      {
        start: duty.start,
        end: duty.end,
        fromSchool: '',
        toSchool: '',
        openLabel: duty.label,
      },
    ];
  } else {
    const bars = barsForDriver(driverId);
    windows = freeWindows(bars).map((window) => {
      const ending = bars.filter((bar) => bar.segment === window.from);
      const starting = bars.filter((bar) => bar.segment === window.to);
      const fromBar = ending.reduce((best, bar) => (!best || bar.end > best.end ? bar : best), null);
      const toBar = starting.reduce((best, bar) => (!best || bar.start < best.start ? bar : best), null);
      const fromLists = schoolListsForRoute(fromBar?.route_id);
      const toLists = schoolListsForRoute(toBar?.route_id);
      const schools = schoolsForWindow(window, {
        [window.from]: fromLists[window.from] || [],
        [window.to]: toLists[window.to] || [],
      });
      return { ...window, ...schools };
    });
  }
  if (boardList !== 'daily' || !date) return windows;
  return subtractIntervals(windows, awardedWeeklyBars(driverId, date));
}

function schoolCap(kind, school, edge, heightRem) {
  if (!school) return '';
  const title = kind === 'from' ? `Route ends at ${school}` : `Route starts at ${school}`;
  const height = heightRem ? `height:${heightRem}rem;` : '';
  return `<span class="school-cap ${kind}" style="${height}--at:${edge}%;" data-at="${edge}" title="${esc(title)}">${esc(school)}</span>`;
}

function placeSchoolCaps() {
  const chart = document.querySelector('.dispatch-chart');
  if (!chart) return;
  for (const cap of chart.querySelectorAll('.school-cap')) {
    const track = cap.closest('.dispatch-track');
    const at = Number(cap.dataset.at);
    if (!track || !Number.isFinite(at)) continue;
    const trackBox = track.getBoundingClientRect();
    if (trackBox.width < 1) continue;
    cap.style.left = '0px';
    cap.style.right = 'auto';
    cap.style.transform = 'none';
    const width = cap.getBoundingClientRect().width;
    const barX = trackBox.left + (at / 100) * trackBox.width;
    const preferred = cap.classList.contains('from') ? barX - width : barX;
    const minLeft = trackBox.left;
    const maxLeft = Math.max(minLeft, trackBox.right - width);
    const left = Math.min(Math.max(preferred, minLeft), maxLeft);
    cap.style.left = `${left - trackBox.left}px`;
  }
}

window.addEventListener('resize', () => {
  placeSchoolCaps();
  centerDayCarousel();
  const fit = document.querySelector('[data-bar-fit]');
  if (fit) fitPinkBars(fit);
  fitPhoneWantBars();
});

document.body.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  if (!event.target.closest('.day-carousel')) return;
  const dir = event.key === 'ArrowLeft' ? 'earlier' : 'later';
  const arrow = document.querySelector(`.day-carousel-arrow[data-dir="${dir}"]:not(:disabled)`);
  if (!arrow) return;
  event.preventDefault();
  arrow.click();
});

window.addEventListener('beforeprint', () => {
  for (const stamp of document.querySelectorAll('.hall-printed')) {
    stamp.textContent = `Printed ${printedAt()}`;
  }
  const fit = document.querySelector('[data-bar-fit]');
  if (fit) fitPinkBars(fit);
});

window.addEventListener('afterprint', () => {
  const fit = document.querySelector('[data-bar-fit]');
  if (fit) fitPinkBars(fit);
});

function placedIntervals(driverId, dayRows) {
  const intervals = [];
  for (const posting of dayRows) {
    const lane = laneOf(posting.id);
    if (lane?.kind !== 'driver' || lane.driverId !== driverId) continue;
    const interval = tripInterval(posting.times);
    if (interval) intervals.push(interval);
  }
  return intervals;
}

function daySignupMarkup(dayRows, { assignedOt = false } = {}) {
  const people = interestedOnDay(dayRows);
  if (!people.length) return '';
  const body = people
    .map(({ driver, bid }) => {
      const bars = barsForDriver(driver.driver_id);
      const load = requestedDayLoad({ preference: bid.preference, trips: dayRows, bars });
      const assigned = assignedOt
        ? assignedDayLoad({ intervals: placedIntervals(driver.driver_id, dayRows), bars })
        : null;
      const rank = driver.seniority_rank == null ? '—' : String(driver.seniority_rank);
      return `<tr>
        <td class="rank">${esc(rank)}</td>
        <td>${esc(driver.name)}</td>
        <td class="num">${esc(sheetHour(load.total))}</td>
        <td class="pref">${esc(bid.preference || '')}</td>
        <td class="num">${esc(sheetHour(load.ot))}</td>
        ${assigned ? `<td class="num total-ot" data-assigned-ot="${esc(driver.driver_id)}">${esc(sheetHour(assigned.ot))}</td>` : ''}
      </tr>`;
    })
    .join('');
  return `<div class="week-signups-wrap"><table class="week-signups${assignedOt ? ' has-total-ot' : ''}">
      <thead>
        <tr>
          <th>Seniority</th>
          <th>Driver</th>
          <th>Total hours today</th>
          <th>Requested trips</th>
          <th>Amount of OT</th>
          ${assignedOt ? '<th class="total-ot">Total Amount of OT</th>' : ''}
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

function sheetClock(value) {
  const minutes = parseMinutes(value);
  return minutes == null ? '' : formatClock(minutes);
}

function estimatedTime(times) {
  const start = parseMinutes(times?.clock_in);
  const end = parseMinutes(times?.clock_out);
  if (start == null || end == null || end <= start) return '';
  return sheetHour(end - start);
}

function suggestionFor(plan, posting) {
  return plan?.trips.find((trip) => trip.id === posting.id)?.winner || null;
}

function assignCell(posting, suggested) {
  if (posting.status === 'draft') return '';
  const bids = [];
  for (const bid of posting.bids || []) {
    if (!bid?.driver_id || bids.some((row) => row.driver_id === bid.driver_id)) continue;
    const driver = state.drivers.find((row) => row.driver_id === bid.driver_id);
    bids.push({
      driver_id: bid.driver_id,
      name: driver?.name || bid.initials || 'Driver',
    });
  }
  if (!bids.length) return '<span class="suggest-none">Nobody signed this trip</span>';
  const chosen = posting.awarded_driver_id || suggested?.driver_id || '';
  const options = bids
    .map((bid) => {
      const mark = bid.driver_id === suggested?.driver_id ? ' (suggested)' : '';
      const selected = bid.driver_id === chosen ? ' selected' : '';
      return `<option value="${esc(bid.driver_id)}"${selected}>${esc(bid.name)}${esc(mark)}</option>`;
    })
    .join('');
  return `<label class="assign-pick">Assign
      <select data-assign>${options}</select>
    </label>
    <button type="button" data-action="weekly-assign" data-id="${esc(posting.id)}">Assign</button>`;
}

function directoryPerson(driverId) {
  if (!driverId) return null;
  return (
    state.drivers.find((row) => row.driver_id === driverId) ||
    (state.substitutes || []).find((row) => row.driver_id === driverId) ||
    null
  );
}

function laneOf(postingId) {
  const lane = state.tripLane?.[postingId];
  if (!lane || typeof lane !== 'object') return null;
  if (lane.kind === 'driver') {
    const driver = directoryPerson(lane.driverId);
    return driver ? { kind: 'driver', driverId: driver.driver_id, driver } : null;
  }
  if (lane.kind === 'name') {
    const name = String(lane.name || '').trim().replace(/\s+/g, ' ');
    return name ? { kind: 'name', name } : null;
  }
  return null;
}

function substituteMoveOptions(lane) {
  const people = state.substitutes || [];
  if (!people.length) return '';
  const options = people
    .map((driver) => {
      const selected = lane?.kind === 'driver' && driver.driver_id === lane.driverId ? ' selected' : '';
      return `<option value="${esc(driver.driver_id)}"${selected}>${esc(driver.name)}</option>`;
    })
    .join('');
  return `<optgroup label="Substitutes">${options}</optgroup>`;
}

function substituteAssignMarkup(posting) {
  if (state.mode !== 'office' || !posting?.id || posting.status === 'draft') return '';
  const people = state.substitutes || [];
  if (!people.length) {
    return '<p class="avail-note">No substitute drivers yet. Add them on Drivers/Routes.</p>';
  }
  const chosen = posting.awarded_driver_id || '';
  const options = people
    .map((driver) => {
      const selected = driver.driver_id === chosen ? ' selected' : '';
      return `<option value="${esc(driver.driver_id)}"${selected}>${esc(driver.name)}</option>`;
    })
    .join('');
  return `<div class="assign-pick substitute-assign">
      <label>Substitute
        <select data-substitute-for="${esc(posting.id)}">${options}</select>
      </label>
      <button type="button" data-action="award-substitute" data-id="${esc(posting.id)}">Assign substitute</button>
    </div>`;
}

function knownDrivers() {
  const seen = new Set();
  const rows = [];
  for (const driver of [...state.drivers, ...(state.substitutes || [])]) {
    if (!driver?.driver_id || !driver.name || seen.has(driver.driver_id)) continue;
    seen.add(driver.driver_id);
    rows.push(driver);
  }
  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function ensureMoveDialog() {
  let dialog = document.getElementById('move-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'move-dialog';
  dialog.className = 'info-dialog';
  dialog.setAttribute('aria-labelledby', 'move-dialog-title');
  dialog.innerHTML = `<form>
      <header class="info-dialog-bar">
        <h2 id="move-dialog-title"></h2>
        <button type="button" class="info-close" data-move-close>Close</button>
      </header>
      <div id="move-dialog-body" class="info-dialog-body"></div>
    </form>`;
  dialog.addEventListener('close', () => {
    renderSheet();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.closest?.('[data-move-close]')) {
      dialog.close();
      return;
    }
    const pick = event.target.closest?.('[data-move-driver]');
    if (!pick) return;
    const postingId = dialog.dataset.postingId || '';
    if (!postingId) return;
    state.tripLane[postingId] = { kind: 'driver', driverId: pick.dataset.moveDriver };
    dialog.close('picked');
  });
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    const nameInput = dialog.querySelector('#move-other-name');
    if (!nameInput) return;
    const name = nameInput.value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const postingId = dialog.dataset.postingId || '';
    if (!postingId) return;
    state.tripLane[postingId] = { kind: 'name', name };
    dialog.close('picked');
  });
  document.body.appendChild(dialog);
  return dialog;
}

function openDriverSearch(postingId) {
  const dialog = ensureMoveDialog();
  dialog.dataset.postingId = postingId;
  dialog.querySelector('#move-dialog-title').textContent = 'Search';
  const body = dialog.querySelector('#move-dialog-body');
  body.replaceChildren();
  const label = document.createElement('label');
  label.className = 'move-search-label';
  label.textContent = 'Find a driver';
  const input = document.createElement('input');
  input.id = 'move-driver-search';
  input.type = 'search';
  input.placeholder = 'Name';
  input.autocomplete = 'off';
  label.appendChild(input);
  const list = document.createElement('ul');
  list.id = 'move-driver-results';
  list.className = 'move-driver-results';
  const paint = () => {
    const query = input.value.trim().toLowerCase();
    const matches = knownDrivers().filter((driver) => !query || driver.name.toLowerCase().includes(query));
    list.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement('li');
      empty.className = 'move-empty';
      empty.textContent = 'No driver matches that name.';
      list.appendChild(empty);
      return;
    }
    for (const driver of matches) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.moveDriver = driver.driver_id;
      const rank = driver.seniority_rank == null ? '' : ` · ${driver.seniority_rank}`;
      button.textContent = `${driver.name}${rank}`;
      item.appendChild(button);
      list.appendChild(item);
    }
  };
  input.addEventListener('input', paint);
  body.append(label, list);
  paint();
  if (!dialog.open) dialog.showModal();
  input.focus();
}

function openOtherName(postingId) {
  const dialog = ensureMoveDialog();
  dialog.dataset.postingId = postingId;
  dialog.querySelector('#move-dialog-title').textContent = 'Other';
  const body = dialog.querySelector('#move-dialog-body');
  body.replaceChildren();
  const label = document.createElement('label');
  label.className = 'move-search-label';
  label.textContent = 'Name';
  const input = document.createElement('input');
  input.id = 'move-other-name';
  input.type = 'text';
  input.maxLength = 80;
  input.autocomplete = 'off';
  label.appendChild(input);
  const use = document.createElement('button');
  use.type = 'submit';
  use.className = 'info-btn move-other-use';
  use.textContent = 'Use this name';
  body.append(label, use);
  if (!dialog.open) dialog.showModal();
  input.focus();
}

function chartPeople(dayRows, date, includeAvailability) {
  const people = interestedOnDay(dayRows).map((person) => ({
    ...person,
    availability: false,
    ranges: [],
    open: false,
  }));
  if (includeAvailability && date) {
    for (const mark of state.availability || []) {
      if (mark?.date !== date || !mark.driver_id) continue;
      if (people.some((person) => person.driver.driver_id === mark.driver_id)) continue;
      const open = mark.open === true;
      const ranges = open ? [] : normalizeTimeRanges(mark.ranges);
      if (!open && !ranges.length) continue;
      const driver = state.drivers.find((row) => row.driver_id === mark.driver_id);
      if (!driver) continue;
      people.push({ driver, bid: null, availability: true, ranges, open });
    }
    people.sort((a, b) => {
      const left = a.driver.seniority_rank ?? 9999;
      const right = b.driver.seniority_rank ?? 9999;
      if (left !== right) return left - right;
      return String(a.driver.name || '').localeCompare(String(b.driver.name || ''));
    });
  }
  return people;
}

function dispatchChart(dayRows, options = {}) {
  const date = options.date || '';
  const people = chartPeople(dayRows, date, Boolean(options.includeAvailability));
  const jobs = dayRows
    .map((posting) => ({ posting, interval: tripInterval(posting.times) }))
    .filter((row) => row.interval);
  const extras = [];
  const guests = [];
  const seenDrivers = new Set(people.map((person) => person.driver.driver_id));
  const seenNames = new Set();
  for (const row of jobs) {
    const lane = laneOf(row.posting.id);
    if (lane?.kind === 'driver' && !seenDrivers.has(lane.driverId)) {
      seenDrivers.add(lane.driverId);
      extras.push(lane.driver);
    }
    if (lane?.kind === 'name' && !seenNames.has(lane.name.toLowerCase())) {
      seenNames.add(lane.name.toLowerCase());
      guests.push(lane.name);
    }
  }
  const driverRows = [
    ...people.map((person) => ({
      driverId: person.driver.driver_id,
      label: [
        person.driver.name,
        person.open
          ? OPEN_MIDDAY_LABEL
          : person.availability
            ? `Available ${person.ranges.map((range) => formatRange(range)).filter(Boolean).join(', ')}`
            : person.bid?.preference || '',
      ]
        .filter(Boolean)
        .join(' · '),
      windows: windowsForDriver(person.driver.driver_id, date),
    })),
    ...extras.map((driver) => ({
      driverId: driver.driver_id,
      label: driver.name,
      windows: windowsForDriver(driver.driver_id, date),
    })),
  ];
  const axis = contentAxis([
    ...jobs.map((row) => row.interval),
    ...driverRows.flatMap((row) => row.windows),
  ]);
  const hours = (axis.end - axis.start) / 60;
  const ticks = [];
  for (let minute = axis.start; minute <= axis.end; minute += 60) ticks.push(minute);
  const scale = ticks
    .map((minute) => {
      const left = barPercents({ start: minute, end: minute + 1 }, axis).left;
      return `<span class="gantt-tick" style="left:${left}%">${esc(hourTick(minute))}</span>`;
    })
    .join('');
  const tripBar = (row, top) => {
    const pos = barPercents(row.interval, axis);
    const number = row.posting.trip_number ? `#${row.posting.trip_number}` : 'Trip';
    const location = row.posting.pickup_location || row.posting.school || '';
    const label = [number, location].filter(Boolean).join(' ');
    const title = `${label} ${formatClock(row.interval.start)}–${formatClock(row.interval.end)}`;
    const lane = laneOf(row.posting.id);
    const options = people
      .map(({ driver }) => {
        const selected = lane?.kind === 'driver' && driver.driver_id === lane.driverId ? ' selected' : '';
        return `<option value="${esc(driver.driver_id)}"${selected}>${esc(driver.name)}</option>`;
      })
      .join('');
    const held =
      lane?.kind === 'driver' &&
      !people.some((person) => person.driver.driver_id === lane.driverId) &&
      !(state.substitutes || []).some((driver) => driver.driver_id === lane.driverId)
        ? `<option value="${esc(lane.driverId)}" selected>${esc(lane.driver.name)}</option>`
        : lane?.kind === 'name'
          ? `<option value="__name" selected>${esc(lane.name)}</option>`
          : '';
    return `<span class="gantt-bar trip${lane ? ' is-placed' : ''}" style="left:${pos.left}%;width:${pos.width}%;top:${top}" title="${esc(title)}">
        <span class="trip-bar-label">${esc(label)}</span>
        <select class="move-to" data-action="move-trip" data-id="${esc(row.posting.id)}" aria-label="Move ${esc(label)}">
          <option value="">Move to</option>
          ${options}
          ${substituteMoveOptions(lane)}
          ${held}
          <option value="__search">Search</option>
          <option value="__other">Other</option>
        </select>
      </span>`;
  };
  const placedTop = (lanes, index, laneCount, greenHeight) => {
    const tanHeight = 1.75;
    if (laneCount <= 1) return 0.25 + greenHeight - tanHeight - 0.08;
    return (
      0.25 +
      lanes[index] * (greenHeight / laneCount) +
      Math.max(0, greenHeight / laneCount - tanHeight) / 2
    );
  };
  const driverTrack = (row) => {
    const mine = jobs.filter((job) => {
      const lane = laneOf(job.posting.id);
      return lane?.kind === 'driver' && lane.driverId === row.driverId;
    });
    const tripLanes = packLanes(mine.map((job) => job.interval));
    const tripLaneCount = tripLanes.length ? Math.max(...tripLanes) + 1 : 1;
    const trackRem = tripLaneCount <= 1 ? 3.2 : 0.5 + tripLaneCount * 1.9;
    const greenHeight = trackRem - 0.5;
    const duty = openDuty(schedulesForDriver(row.driverId));
    const bars = row.windows
      .map((window) => {
        const drawn = clipInterval(window, axis);
        if (!drawn) return '';
        const pos = barPercents(drawn, axis);
        const when = `${formatClock(window.start)}–${formatClock(window.end)}`;
        const open = Boolean(window.openLabel);
        const caption = open ? `${window.openLabel} — ${row.label}` : row.label;
        const title = [caption, when].filter(Boolean).join(' ');
        const right = pos.left + pos.width;
        return `${open ? '' : schoolCap('from', window.fromSchool, pos.left, greenHeight)}<span class="gantt-bar free${open ? ' is-open' : ''}" style="left:${pos.left}%;width:${pos.width}%;height:${greenHeight}rem" title="${esc(title)}">${esc(caption)}</span>${open ? '' : schoolCap('to', window.toSchool, right, greenHeight)}`;
      })
      .join('');
    const placed = mine
      .map((job, index) => tripBar(job, `${placedTop(tripLanes, index, tripLaneCount, greenHeight)}rem`))
      .join('');
    const openBar =
      bars || duty?.kind !== 'open'
        ? ''
        : `<span class="gantt-bar free is-open" style="left:0;width:100%;height:${greenHeight}rem" title="${esc(`${duty.label} — ${row.label}`)}">${esc(`${duty.label} — ${row.label}`)}</span>`;
    const held = date
      ? awardedWeeklyBars(row.driverId, date)
          .map((bar) => {
            const drawn = clipInterval(bar, axis);
            if (!drawn) return '';
            const pos = barPercents(drawn, axis);
            return `<span class="gantt-bar weekly-held" style="left:${pos.left}%;width:${pos.width}%;height:${greenHeight}rem" title="${esc(bar.label)}">${esc(bar.label)}</span>`;
          })
          .join('')
      : '';
    const empty = bars || openBar || held ? '' : `<span class="dispatch-empty">${esc(row.label)} — No gap after a clock-out</span>`;
    return `<div class="dispatch-row"><div class="gantt-track dispatch-track" style="height:${trackRem}rem">${bars}${openBar}${held}${placed}${empty}</div></div>`;
  };
  const guestTrack = (name) => {
    const mine = jobs.filter((job) => {
      const lane = laneOf(job.posting.id);
      return lane?.kind === 'name' && lane.name.toLowerCase() === name.toLowerCase();
    });
    const tripLanes = packLanes(mine.map((job) => job.interval));
    const tripLaneCount = tripLanes.length ? Math.max(...tripLanes) + 1 : 1;
    const trackRem = tripLaneCount <= 1 ? 3.2 : 0.5 + tripLaneCount * 1.9;
    const greenHeight = trackRem - 0.5;
    const placed = mine
      .map((job, index) => tripBar(job, `${placedTop(tripLanes, index, tripLaneCount, greenHeight)}rem`))
      .join('');
    return `<div class="dispatch-row"><div class="gantt-track dispatch-track is-guest" style="height:${trackRem}rem"><span class="guest-name">${esc(name)}</span>${placed}</div></div>`;
  };
  const unplaced = jobs.filter((row) => !laneOf(row.posting.id));
  const unplacedLanes = packLanes(unplaced.map((row) => row.interval));
  const unplacedCount = Math.max(unplacedLanes.length ? Math.max(...unplacedLanes) + 1 : 1, 1);
  const jobBars = unplaced
    .map((row, index) => tripBar(row, `calc(${unplacedLanes[index]} * 1.9rem + 0.15rem)`))
    .join('');
  const jobsRow = unplaced.length
    ? `<div class="dispatch-row"><div class="gantt-track dispatch-track jobs" style="height:calc(${unplacedCount} * 1.9rem)">${jobBars}</div></div>`
    : '';
  const peopleMarkup = driverRows.map((row) => driverTrack(row)).join('');
  const guestMarkup = guests.map((name) => guestTrack(name)).join('');
  const signed = people.length || extras.length || guests.length
    ? `${peopleMarkup}${guestMarkup}`
    : '<p class="dispatch-empty">No drivers have signed up for this day.</p>';
  return `<div class="dispatch-chart" style="--hours:${hours}">
    <div class="gantt-scale dispatch-scale">${scale}</div>
    ${jobsRow}
    ${signed}
  </div>`;
}

const WEEKDAY_NAMES = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

function weekdayName(iso) {
  return WEEKDAY_NAMES[sheetWeekday(iso)] || 'Day';
}

function dayHeading(iso) {
  return `${weekdayName(iso)} ${formatSheetDate(iso)}`.trim();
}

function countLabel(count, singular, plural) {
  if (!count) return '';
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

function infoButton(key, label, extra = '', postingId = '') {
  const why = extra ? ` data-why="${esc(extra)}"` : '';
  const id = postingId ? ` data-id="${esc(postingId)}"` : '';
  const mini = extra ? ' is-mini' : '';
  return `<button type="button" class="info-btn${mini}" data-action="info-pop" data-info="${esc(key)}"${why}${id} aria-haspopup="dialog">${esc(label)}</button>`;
}

function weeklyRuleButtons() {
  return `${infoButton('signup', 'Weekly signup rules')}${infoButton('hours', 'How hours are counted')}${infoButton('chart', 'Chart key')}`;
}

function weeklyAdminTools() {
  return `<div class="week-admin-tools">
      <button type="button" class="primary" data-action="new">New trip sheet</button>
      ${weeklyRuleButtons()}
    </div>`;
}

function weeklyPostingsApi() {
  try {
    if (window.parent && window.parent !== window && window.parent.weeklyPostings) return window.parent.weeklyPostings;
  } catch {
    return null;
  }
  return null;
}

function weeklyPostingsInfo() {
  const info = weeklyPostingsApi()?.describe?.();
  const options = info?.options?.length
    ? info.options
    : [
        { value: 'this', label: 'This screen' },
        { value: 'pick', label: 'Choose a monitor…' },
      ];
  return {
    options,
    value: info?.value || state.postingsMonitor || 'this',
    status: info?.status || state.postingsStatus || '',
    isError: Boolean(info?.isError || state.postingsStatusError),
  };
}

function weeklyPostingsPanel() {
  const info = weeklyPostingsInfo();
  const selected = info.options.some((option) => option.value === info.value) ? info.value : 'this';
  const options = info.options
    .map(
      (option) =>
        `<option value="${esc(option.value)}"${option.value === selected ? ' selected' : ''}>${esc(option.label)}</option>`
    )
    .join('');
  return `<details class="post-the-work"${state.postTheWorkOpen ? ' open' : ''}>
      <summary class="post-the-work-link">
        <span class="post-the-work-icons" aria-hidden="true">
          <span data-icon="monitor"></span>
          <span data-icon="printer"></span>
        </span>
        Post The Work
      </summary>
      <section class="week-postings-panel" aria-label="Weekly Work Postings">
        <h3>Weekly Work Postings</h3>
        <div class="week-postings-actions">
          <button type="button" data-action="open-postings" data-icon="monitor">Weekly Work Postings</button>
          <label class="week-postings-monitor"><span data-icon="monitor">Screen</span>
            <select data-action="postings-monitor" aria-label="Screen">${options}</select>
          </label>
          <button type="button" data-action="print-postings" data-icon="printer">Awarded Weekly Work</button>
        </div>
        <p class="week-postings-hint">Opens the weekday chart full screen. Mirror this screen, or choose a monitor. Awarded Weekly Work prints that chart on paper.</p>
        <p class="week-postings-status${info.status && info.isError ? ' is-error' : ''}" data-postings-status role="status"${info.status ? '' : ' hidden'}>${esc(info.status)}</p>
      </section>
    </details>`;
}

function syncWeeklyPostingsPanel() {
  const root = $('sheet-root');
  if (root) enhanceIcons(root);
  const details = document.querySelector('.post-the-work');
  if (details instanceof HTMLDetailsElement && details.dataset.bound !== '1') {
    details.dataset.bound = '1';
    details.addEventListener('toggle', () => {
      state.postTheWorkOpen = details.open;
    });
  }
  const select = document.querySelector('[data-action="postings-monitor"]');
  if (!(select instanceof HTMLSelectElement)) return;
  const info = weeklyPostingsInfo();
  const selected = info.options.some((option) => option.value === info.value) ? info.value : 'this';
  select.replaceChildren();
  for (const option of info.options) select.add(new Option(option.label, option.value));
  select.value = selected;
  const status = document.querySelector('[data-postings-status]');
  if (!(status instanceof HTMLElement)) return;
  status.hidden = !info.status;
  status.textContent = info.status || '';
  status.classList.toggle('is-error', Boolean(info.status && info.isError));
}

async function openWeeklyPostingsDisplay() {
  const api = weeklyPostingsApi();
  if (api) {
    await api.open();
    syncWeeklyPostingsPanel();
    return;
  }
  const url = new URL('/board', location.origin);
  url.searchParams.set('as', 'driver');
  url.searchParams.set('sheet', 'weekly');
  url.searchParams.set('display', 'wall');
  const opened = window.open(url.href, 'teamster-weekly-work');
  state.postingsStatus = opened
    ? 'Weekly Work Postings is full screen.'
    : 'Allow pop-up windows for this site, then choose Weekly Work Postings again.';
  state.postingsStatusError = !opened;
  syncWeeklyPostingsPanel();
}

async function setWeeklyPostingsMonitor(value) {
  const api = weeklyPostingsApi();
  if (api) {
    await api.setMonitor(value);
    syncWeeklyPostingsPanel();
    return;
  }
  state.postingsMonitor = value === 'pick' ? 'this' : value;
  state.postingsStatus =
    value === 'pick' ? 'Weekly Work Postings stays full screen on this screen.' : 'Weekly Work Postings opens full screen on this screen.';
  state.postingsStatusError = false;
  syncWeeklyPostingsPanel();
}

function weeklyInfoCopy(key) {
  if (key === 'signup') {
    return {
      title: 'Weekly signup rules',
      body: `<p>Thursday at 8:00 a.m. posts next week. Post next week’s field trips and known midday absences by 8:00 a.m. Thursday.</p>
        <p>Drivers sign by 10:00 a.m. Friday and prioritize each day’s choices. Sign-up is open until 10:00 a.m. Friday. That close does not assign a driver. Awards are posted by 2:00 p.m. Friday.</p>
        <p>No parentheses means one assignment that day, in the order written. Parentheses means every trip in that group that fits. Each driver notes total daily time, including extra work already assigned.</p>
        <p>At 10:00 a.m. Friday the sheets are pulled. The chart shows each job beside the free mid-day time of every driver who signed up. The suggestion follows the contract. Offer utility drivers the work first, up to 40 contracted hours. Then the most senior driver who can finish with the regular runs and no overtime, or the least overtime up to one hour. Dispatch assigns the driver. You make the assignment. The clock does not.</p>`,
    };
  }
  if (key === 'hours') {
    return {
      title: 'How hours are counted',
      body: `<p>Total hours and Amount of OT are calculated from the regular route plus the trips in the request that fit. The driver writes the trip order. No parentheses means one trip. Parentheses means every trip in that group that fits. A trip that crosses a regular run is left out of the hours.</p>
        <p>Total Amount of OT is the regular route plus the jobs sitting on that driver's row. Move a job on the chart and that total changes. Time already on the route, or shared by two jobs, is counted once.</p>`,
    };
  }
  if (key === 'chart') {
    return {
      title: 'Chart key',
      body: `<p>Green bars are free mid-day time between a clock-out and the next clock-in. The box on the left is the school the driver is leaving. The box on the right is the school they head to next. A purple bar is a utility driver, or a driver with no regular route. That time is not a gap after a clock-out. Search places a trip on any driver’s row. Other is a name you type, shown as a blue row.</p>
        <p class="dispatch-legend"><span class="swatch trip"></span> Weekly work <span class="swatch free"></span> Free mid-day time <span class="swatch open"></span> Utility driver or no regular route <span class="swatch guest"></span> Typed name</p>`,
    };
  }
  return null;
}

function dailyInfoCopy(key) {
  if (key === 'signup') {
    return {
      title: 'Daily assignment rules',
      body: `<p>Post available work by 6:15 a.m. Drivers sign by 8:00 a.m. A signup is a commitment. At 8:00 a.m. that day is awarded. You can close it sooner. A driver already on the road before 6:15 may call so the office can add that name.</p>
        <p>Offer the utility driver the work first, up to 40 contracted hours. Then the most senior driver who can finish with the regular runs and no overtime, or the least overtime up to one hour. A field trip of 3.5 hours or more that leaves town goes by seniority even with overtime. The midday it crosses comes off the route. A shorter trip with Leaves town checked still follows the regular rule.</p>
        <p>Free mid-day time is the gap after a regular run, with weekly work already awarded taken out. A daily trip that crosses that weekly work stays with the weekly work.</p>
        <p>Between 6:15 and 8:00, announce new work by radio so drivers can still sign. After 8:00, a late addition goes to drivers who set availability for that time, by the same rule. Then offer it by radio, then to a substitute.</p>`,
    };
  }
  if (key === 'chart') {
    return {
      title: 'Chart key',
      body: `<p>Blue bars are free mid-day time between a clock-out and the next clock-in, after awarded weekly work is taken out. The box on the left is the school the driver is leaving. The box on the right is the school they head to next. A purple bar is a utility driver, or a driver with no regular route. A pink bar is weekly work already awarded. Copper bars are the daily jobs.</p>
        <p class="dispatch-legend"><span class="swatch free"></span> Free mid-day time <span class="swatch open"></span> Utility or no regular route <span class="swatch weekly"></span> Awarded weekly work <span class="swatch trip"></span> Daily work</p>`,
    };
  }
  return null;
}

function ensureInfoDialog() {
  let dialog = document.getElementById('info-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'info-dialog';
    dialog.className = 'info-dialog';
    dialog.setAttribute('aria-labelledby', 'info-dialog-title');
    dialog.innerHTML = `<form method="dialog">
        <header class="info-dialog-bar">
          <h2 id="info-dialog-title"></h2>
          <button type="submit" class="info-close">Close</button>
        </header>
        <div id="info-dialog-body" class="info-dialog-body"></div>
      </form>`;
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.body.appendChild(dialog);
  }
  return dialog;
}

function openWeeklyInfo(key, why = '', postingId = '') {
  const dialog = ensureInfoDialog();
  const title = dialog.querySelector('#info-dialog-title');
  const body = dialog.querySelector('#info-dialog-body');
  body.replaceChildren();
  if (key === 'why') {
    title.textContent = 'Why this suggestion';
    const paragraph = document.createElement('p');
    paragraph.textContent = why || '';
    body.appendChild(paragraph);
  } else if (key === 'mail') {
    const posting = state.postings.find((row) => row.id === postingId);
    const email = posting?.winner_email;
    if (!email) return;
    const winner = directoryPerson(posting.awarded_driver_id);
    title.textContent = `Email to ${winner ? givenName(winner.name) : 'winner'}`;
    const subject = document.createElement('p');
    subject.textContent = email.subject || '';
    const address = document.createElement('p');
    address.textContent = email.disabled_reason || email.to_email || '';
    const letter = document.createElement('pre');
    letter.className = 'mail-body';
    letter.textContent = email.body || '';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'info-btn';
    open.dataset.action = 'open-mail';
    open.dataset.id = posting.id;
    open.textContent = 'Open email';
    open.disabled = !email.can_send;
    body.append(subject, address, letter, open);
  } else {
    const copy =
      boardList === 'daily' ? dailyInfoCopy(key) : boardList === 'roster' ? rosterInfoCopy(key) : weeklyInfoCopy(key);
    if (!copy) return;
    title.textContent = copy.title;
    body.innerHTML = copy.body;
  }
  if (!dialog.open) dialog.showModal();
}

function scrollBoardTop() {
  const stage = document.querySelector('.board-stage');
  if (stage) stage.scrollTop = 0;
  window.scrollTo(0, 0);
}

function weeklyDates(week, rows) {
  const dates = weekdayDates(week.start);
  for (const row of rows) {
    if (row.trip_date && row.trip_date >= week.start && row.trip_date <= week.end && !dates.includes(row.trip_date)) {
      dates.push(row.trip_date);
    }
  }
  dates.sort();
  return dates;
}

function postingFact(label, value) {
  return `<div><dt>${esc(label)}</dt><dd>${value ? esc(value) : '—'}</dd></div>`;
}

function seniorityLead(rank, name) {
  const who = name || 'This driver';
  if (rank == null || rank === '') return `No seniority number, ${who}`;
  return `Seniority ${rank}, ${who}`;
}

function awardWalkMarkup(steps) {
  if (!steps?.length) return '<p class="award-empty">Nobody has signed up for this trip.</p>';
  return `<ol class="award-walk">${steps
    .map((step) => {
      const rank = step.hire_date
        ? `Seniority ${step.seniority_rank}, hired ${formatSheetDate(step.hire_date)}`
        : step.seniority_rank == null
          ? 'No seniority number'
          : `Seniority ${step.seniority_rank}`;
      const kind =
        step.mode === 'many'
          ? 'Parentheses: every trip in the group that fits'
          : 'No parentheses: one trip, the first choice that fits';
      const hours = step.utility
        ? 'Utility driver. Extra work is offered here first, up to 40 contracted hours'
        : `Regular week ${formatDuration(step.weekly_minutes)}. A route driver is offered this after any utility driver`;
      const request = step.preference ? `Wrote ${step.preference}` : 'No written order';
      const outcome =
        step.outcome === 'awarded'
          ? 'Gets this ticket'
          : step.outcome === 'taken'
            ? 'Does not get this ticket'
            : step.outcome === 'later'
              ? 'Later choice, not used'
              : 'Passed over';
      return `<li class="is-${esc(step.outcome)}">
        <strong>${esc(rosterName(step.name))}</strong>
        <span>${esc(outcome)} · ${esc(rank)} · ${esc(kind)} · ${esc(request)} · ${esc(hours)}</span>
        <p>${esc(step.reason)}</p>
      </li>`;
    })
    .join('')}</ol>`;
}

function whySection(label, body, assignMarkup = '') {
  const controls = assignMarkup ? `<div class="assign-cell">${assignMarkup}</div>` : '';
  const heading = controls
    ? `<div class="ticket-why-lead">${controls}<h4>${label}</h4></div>`
    : `<h4>${label}</h4>`;
  return `<section class="ticket-why" aria-label="${label}">
    ${heading}
    ${body}
  </section>`;
}

function weeklyWhyBlock(posting, plan, assignMarkup = '') {
  if (boardList === 'roster') {
    const count = (posting.bids || []).length;
    const names = count ? countLabel(count, 'driver signed this trip', 'drivers signed this trip') : 'Nobody has signed this trip yet';
    return whySection(
      'Signups',
      `<p>${esc(names)}. Assign the driver from that list. The morning daily close does not award a roster trip.</p>`,
      assignMarkup
    );
  }
  if (posting.late_addition && posting.status !== 'awarded') {
    return whySection(
      'Why',
      `<p>Drivers do not sign a late addition. It goes to the drivers who set availability for this time, most senior first, by the same overtime rule. Open the sheet to see who covers this job before you offer it on the radio.</p>`,
      assignMarkup
    );
  }
  if (posting.status === 'draft') {
    return whySection(
      'Why',
      '<p>This ticket is still a draft. It stays out of the seniority walk until it is posted, so there is no suggestion yet.</p>',
      assignMarkup
    );
  }
  const trip = plan?.trips.find((row) => row.id === posting.id) || null;
  if (!trip) {
    return whySection('Why', '<p>This ticket is not in the award check for this day.</p>', assignMarkup);
  }
  const summary = trip.winner ? trip.winner.reason : noWinnerText(trip);
  const lead = trip.winner
    ? `Suggested: ${seniorityLead(trip.winner.seniority_rank, trip.winner.name)}.`
    : 'No driver is suggested.';
  return whySection(
    'Why',
    `<p>${esc(lead)} ${esc(summary)}</p>
    ${awardWalkMarkup(trip.steps)}`,
    assignMarkup
  );
}

function weeklyPostingCard(posting, plan) {
  const times = posting.times || {};
  const winner = directoryPerson(posting.awarded_driver_id);
  const suggested = suggestionFor(plan, posting);
  const location = posting.pickup_location || posting.school || '';
  const signedCount = (posting.bids || []).length;
  const suggestedText =
    boardList === 'roster'
      ? `<span class="suggest-none">${esc(signedCount ? countLabel(signedCount, 'signup', 'signups') : 'No signups')}</span>`
      : suggested
        ? `<span class="suggest-name">${esc(seniorityLead(suggested.seniority_rank, suggested.name))}</span>`
        : '<span class="suggest-none">No suggestion</span>';
  const ticket = posting.trip_number ? `Ticket ${posting.trip_number}` : 'No ticket number';
  const status = posting.status === 'draft' ? 'Draft' : posting.status === 'awarded' ? 'Assigned' : 'Posted';
  const mailButton = posting.winner_email
    ? infoButton('mail', `Email to ${winner ? givenName(winner.name) : 'winner'}`, '', posting.id)
    : '';
  const substitute = substituteAssignMarkup(posting);
  return `<article class="week-posting">
      <header class="week-posting-head">
        <h3>${esc(ticket)} <span class="week-posting-status">${esc(status)}</span></h3>
        <span class="week-posting-actions">${mailButton}<button type="button" data-action="weekly-edit" data-id="${esc(posting.id)}">Change</button></span>
      </header>
      <dl class="week-posting-facts">
        ${postingFact('Driver', winner ? winner.name : '')}
        <div><dt>Suggested</dt><dd>${suggestedText}</dd></div>
        ${postingFact('Location', location)}
        ${postingFact('Destination', posting.destination || '')}
        ${postingFact('Clock-in', sheetClock(times.clock_in))}
        ${postingFact('Site Spot Time', sheetClock(times.arrive_trip))}
        ${postingFact('Site Depart Time', sheetClock(times.depart_school))}
        ${postingFact('Est. Clock out Time', sheetClock(times.clock_out))}
        ${postingFact('Est time', estimatedTime(times))}
      </dl>
      ${weeklyWhyBlock(posting, plan, assignCell(posting, suggested))}
      ${substitute ? `<div class="assign-cell">${substitute}</div>` : ''}
    </article>`;
}

function weeklyDayLink(date, dayRows) {
  const signed = interestedOnDay(dayRows).length;
  const jobs = dayRows.length ? countLabel(dayRows.length, 'posting', 'postings') : 'No postings';
  const people = signed ? countLabel(signed, 'driver signed up', 'drivers signed up') : 'No signups';
  const tickets = dayRows.map((row) => tripToken(row)).filter(Boolean);
  const ticketList = tickets.length
    ? `<ul class="week-day-tickets">${tickets.map((ticket) => `<li>${esc(ticket)}</li>`).join('')}</ul>`
    : '';
  return `<button type="button" class="week-day-link" data-action="weekly-day" data-date="${esc(date)}">
      <strong data-icon="calendar">${esc(weekdayName(date))}</strong>
      <span>${esc(formatSheetDate(date))}</span>
      <span>${esc(jobs)} · ${esc(people)}</span>
      ${ticketList}
    </button>`;
}

function dayCarouselArrow(dir, date, action) {
  const mark = dir === 'earlier' ? '‹' : '›';
  const label = dir === 'earlier' ? 'Earlier day' : 'Later day';
  const enabled = Boolean(date);
  const move = enabled ? ` data-action="${action}" data-date="${esc(date)}"` : '';
  return `<button type="button" class="day-carousel-arrow" data-dir="${dir}" aria-label="${label}"${move}${enabled ? '' : ' disabled'}><span aria-hidden="true">${mark}</span></button>`;
}

function dayCarousel(date, days, action) {
  const index = days.indexOf(date);
  const earlier = index > 0 ? days[index - 1] : '';
  const later = index >= 0 && index < days.length - 1 ? days[index + 1] : '';
  const slides = days
    .map((day) => {
      const label = esc(dayHeading(day));
      if (day === date) {
        return `<h2 class="day-carousel-slide is-current" data-weekday="${esc(sheetWeekday(day))}" tabindex="-1">${label}</h2>`;
      }
      return `<button type="button" class="day-carousel-slide" data-action="${action}" data-date="${esc(day)}">${label}</button>`;
    })
    .join('');
  return `<div class="day-carousel" role="region" aria-roledescription="carousel" aria-label="Days this week">
      ${dayCarouselArrow('earlier', earlier, action)}
      <div class="day-carousel-track" tabindex="0">
        <span class="day-carousel-spacer" aria-hidden="true"></span>
        ${slides}
        <span class="day-carousel-spacer" aria-hidden="true"></span>
      </div>
      ${dayCarouselArrow('later', later, action)}
    </div>`;
}

function weeklyDayCarousel(date) {
  const week = weeklyOfficeBounds()[weeklyWeekKey()];
  return dayCarousel(date, weeklyDates(week, weeklyTripRows(week)), 'weekly-day');
}

function officeDayCarousel(date) {
  const week = dailyWeekBounds();
  return dayCarousel(date, weeklyDates(week, dailyTripRows(week)), 'daily-day');
}

function centerDayCarousel() {
  const track = document.querySelector('.day-carousel-track');
  const current = track?.querySelector('.is-current');
  const spacers = track ? [...track.querySelectorAll('.day-carousel-spacer')] : [];
  if (!track || !current || spacers.length !== 2 || track.clientWidth < 1) return;
  const pad = Math.max(0, (track.clientWidth - current.getBoundingClientRect().width) / 2);
  for (const spacer of spacers) spacer.style.width = `${pad}px`;
  const trackBox = track.getBoundingClientRect();
  const currentBox = current.getBoundingClientRect();
  const delta = currentBox.left + currentBox.width / 2 - (trackBox.left + trackBox.width / 2);
  track.scrollLeft = Math.max(0, track.scrollLeft + delta);
}

function settleDayCarousel() {
  centerDayCarousel();
  requestAnimationFrame(centerDayCarousel);
}

function focusDayCarousel(dir) {
  const nextArrow = dir
    ? document.querySelector(`.day-carousel-arrow[data-dir="${dir}"]:not(:disabled)`)
    : null;
  (nextArrow || document.querySelector('.day-carousel-slide.is-current'))?.focus({ preventScroll: true });
}

function weeklyDayScreen(date, dayRows) {
  const heading = dayHeading(date);
  const plan = awardPlanFor(date);
  const jobs = dayRows.length
    ? `<div class="week-postings">${dayRows.map((posting) => weeklyPostingCard(posting, plan)).join('')}</div>`
    : `<p class="week-empty">No weekly work is posted for ${esc(heading)}.</p>`;
  const signups = daySignupMarkup(dayRows, { assignedOt: true });
  const chart = dayRows.length
    ? `<h3 class="week-block-title">Jobs and free mid-day time</h3>${dispatchChart(dayRows)}`
    : '';
  const signupBlock = signups ? `<h3 class="week-block-title">Signups</h3>${signups}` : '';
  return `<section class="week-admin">
      <div class="week-day-bar">
        <button type="button" class="week-day-back" data-action="weekly-days">Back to weekly view</button>
      </div>
      ${weeklyDayCarousel(date)}
      ${weeklyAdminTools()}
      ${weeklyPostingsPanel()}
      ${chart}
      ${signupBlock}
      ${jobs}
    </section>`;
}

function dailyOfficeTable() {
  return officeDesk && boardList === 'daily' && !state.weeklyEntry && !state.postingPrint;
}

function rosterOfficeTable() {
  return officeDesk && boardList === 'roster' && !state.weeklyEntry && !state.postingPrint;
}

function rosterInfoCopy(key) {
  if (key === 'roster') {
    return {
      title: 'Roster trip signup',
      body: `<p>Roster trips are the evening, weekend, and mountain trips. Drivers sign from the driver dashboard. Tap WANT in the order they want the trips that day, then submit.</p>
        <p>No parentheses means one trip, the first choice that fits. Parentheses means every wanted trip that fits, in that order. The office assigns the driver from the names on the trip. The 8:00 a.m. daily close does not award these trips.</p>`,
    };
  }
  return null;
}

function rosterAdminTools() {
  return `<div class="week-admin-tools">
      <button type="button" class="primary" data-action="new">New roster trip</button>
      ${infoButton('roster', 'Roster signup')}
    </div>`;
}

function rosterChartLegend() {
  return `<p class="gantt-legend"><span class="swatch free"></span> Free mid-day time <span class="swatch open"></span> Utility or no regular route <span class="swatch weekly"></span> Awarded weekly work <span class="swatch trip"></span> Roster trip</p>`;
}

function dailyWeekBounds() {
  const start = state.weekStart || mondayOf(localToday());
  return { start, end: addIsoDays(start, 6), friday: addIsoDays(start, 4) };
}

function dailyTripRows(bounds) {
  return visiblePostings()
    .filter((row) => row.trip_date >= bounds.start && row.trip_date <= bounds.end)
    .sort((a, b) => {
      const byDate = String(a.trip_date).localeCompare(String(b.trip_date));
      if (byDate) return byDate;
      const startA = tripInterval(a.times)?.start ?? 0;
      const startB = tripInterval(b.times)?.start ?? 0;
      if (startA !== startB) return startA - startB;
      return String(a.trip_number).localeCompare(String(b.trip_number), undefined, { numeric: true });
    });
}

function dailyAdminTools(date) {
  const close =
    date && !dayIsClosed(date)
      ? `<button type="button" data-action="close-day" data-date="${esc(date)}">Close offerings</button>`
      : '';
  return `<div class="week-admin-tools">
      <button type="button" class="primary" data-action="new">New trip sheet</button>
      <button type="button" data-action="late-addition">Late addition</button>
      <button type="button" data-action="print-postings">Print daily work</button>
      ${close}
      ${infoButton('signup', 'Daily assignment rules')}
      ${infoButton('chart', 'Chart key')}
    </div>`;
}

function dailyChartLegend() {
  return `<p class="gantt-legend"><span class="swatch free"></span> Free mid-day time <span class="swatch open"></span> Utility or no regular route <span class="swatch weekly"></span> Awarded weekly work <span class="swatch trip"></span> Daily work</p>`;
}

function availabilityRoster(date, onForm = false) {
  const rows = [];
  for (const mark of state.availability || []) {
    if (mark?.date !== date || !mark.driver_id) continue;
    const open = mark.open === true;
    const ranges = open ? [] : normalizeTimeRanges(mark.ranges);
    if (!open && !ranges.length) continue;
    const driver = state.drivers.find((row) => row.driver_id === mark.driver_id);
    if (!driver) continue;
    rows.push({ driver, ranges, open });
  }
  rows.sort((a, b) => {
    const left = a.driver.seniority_rank ?? 9999;
    const right = b.driver.seniority_rank ?? 9999;
    if (left !== right) return left - right;
    return String(a.driver.name || '').localeCompare(String(b.driver.name || ''));
  });
  const lead = onForm
    ? 'These drivers set availability for this day, most senior first. The list under the times is who covers this job.'
    : 'These drivers asked to be considered for late additions, most senior first. Check this list before you offer a late job on the radio.';
  const items = rows
    .map(({ driver, ranges, open }) => {
      const rank = driver.seniority_rank == null ? '—' : String(driver.seniority_rank);
      const when = open ? OPEN_MIDDAY_LABEL : ranges.map((range) => formatRange(range)).filter(Boolean).join(', ');
      return `<li><strong>${esc(rank)}</strong> ${esc(driver.name)} <span class="avail-note">${esc(when)}</span></li>`;
    })
    .join('');
  return `<section class="avail-roster">
      <h3>Set availability</h3>
      <p>${esc(lead)}</p>
      ${items ? `<ol class="avail-rank">${items}</ol>` : '<p class="avail-note">No driver has set availability for late additions on this day.</p>'}
    </section>`;
}

function dailyDayScreen(date, dayRows) {
  const heading = dayHeading(date);
  const plan = awardPlanFor(date);
  const jobs = dayRows.length
    ? `<div class="week-postings">${dayRows.map((posting) => weeklyPostingCard(posting, plan)).join('')}</div>`
    : `<p class="week-empty">No daily work is posted for ${esc(heading)}.</p>`;
  const signups = daySignupMarkup(dayRows.filter((row) => !row.late_addition));
  const chart = `<h3 class="week-block-title">Free mid-day time</h3>${dailyChartLegend()}${dispatchChart(dayRows, { date, includeAvailability: true })}`;
  const signupBlock = signups ? `<h3 class="week-block-title">Signups</h3>${signups}` : '';
  return `<section class="week-admin daily-admin">
      <div class="week-day-bar">
        <button type="button" class="week-day-back" data-action="daily-days">Back to daily view</button>
      </div>
      ${officeDayCarousel(date)}
      ${dailyAdminTools(date)}
      ${availabilityRoster(date)}
      ${chart}
      ${signupBlock}
      ${jobs}
    </section>`;
}

function rosterDayScreen(date, dayRows) {
  const heading = dayHeading(date);
  const jobs = dayRows.length
    ? `<div class="week-postings">${dayRows.map((posting) => weeklyPostingCard(posting, null)).join('')}</div>`
    : `<p class="week-empty">No roster trips are posted for ${esc(heading)}.</p>`;
  const signups = daySignupMarkup(dayRows);
  const chart = dayRows.length
    ? `<h3 class="week-block-title">Trips and free mid-day time</h3>${rosterChartLegend()}${dispatchChart(dayRows, { date })}`
    : '';
  const signupBlock = signups
    ? `<h3 class="week-block-title">Signups</h3>${signups}`
    : '<p class="week-empty">No driver has signed a roster trip for this day.</p>';
  return `<section class="week-admin roster-admin">
      <div class="week-day-bar">
        <button type="button" class="week-day-back" data-action="daily-days">Back to roster view</button>
      </div>
      ${officeDayCarousel(date)}
      ${rosterAdminTools()}
      ${chart}
      ${signupBlock}
      ${jobs}
    </section>`;
}

function renderRosterWeek() {
  const root = $('sheet-root');
  const postings = visiblePostings();
  ensureWeek(postings);
  const week = dailyWeekBounds();
  const rows = dailyTripRows(week);
  const days = weeklyDates(week, rows);
  if (!state.dailyDay && !state.dailyChoseAll) {
    const today = localToday();
    const upcoming = days.find((date) => date >= today && rows.some((row) => row.trip_date === date));
    const any = days.find((date) => rows.some((row) => row.trip_date === date));
    if (upcoming || any) state.dailyDay = upcoming || any;
  }
  if (state.dailyDay && days.includes(state.dailyDay)) {
    root.innerHTML = rosterDayScreen(state.dailyDay, rows.filter((row) => row.trip_date === state.dailyDay));
    placeSchoolCaps();
    settleDayCarousel();
    return;
  }
  const links = days
    .map((date) => {
      const dayRows = rows.filter((row) => row.trip_date === date);
      const signed = interestedOnDay(dayRows).length;
      const jobs = dayRows.length ? countLabel(dayRows.length, 'trip', 'trips') : 'No trips';
      const people = signed ? countLabel(signed, 'driver signed up', 'drivers signed up') : 'No signups';
      return `<button type="button" class="week-day-link" data-action="daily-day" data-date="${esc(date)}">
          <strong>${esc(weekdayName(date))}</strong>
          <span>${esc(formatSheetDate(date))}</span>
          <span>${esc(jobs)} · ${esc(people)}</span>
        </button>`;
    })
    .join('');
  const range = `${formatSheetDate(week.start)} – ${formatSheetDate(week.end)}`;
  root.innerHTML = `<section class="week-admin roster-admin">
      <div class="week-nav">
        <button type="button" data-action="week-prev">Earlier week</button>
        <h2>${esc(range)}</h2>
        <button type="button" data-action="week-next">Later week</button>
      </div>
      ${rosterAdminTools()}
      ${links ? `<nav class="week-day-list" aria-label="Days">${links}</nav>` : '<p class="week-empty">No days in this week.</p>'}
    </section>`;
}

function renderDailyWeek() {
  const root = $('sheet-root');
  const postings = visiblePostings();
  ensureWeek(postings);
  const week = dailyWeekBounds();
  const rows = dailyTripRows(week);
  const days = weeklyDates(week, rows);
  if (!state.dailyDay && !state.dailyChoseAll) {
    const today = localToday();
    const upcoming = days.find((date) => date >= today && rows.some((row) => row.trip_date === date));
    const any = days.find((date) => rows.some((row) => row.trip_date === date));
    if (upcoming || any) state.dailyDay = upcoming || any;
  }
  if (state.dailyDay && days.includes(state.dailyDay)) {
    root.innerHTML = dailyDayScreen(state.dailyDay, rows.filter((row) => row.trip_date === state.dailyDay));
    placeSchoolCaps();
    settleDayCarousel();
    return;
  }
  const links = days
    .map((date) => {
      const dayRows = rows.filter((row) => row.trip_date === date);
      const signed = interestedOnDay(dayRows.filter((row) => !row.late_addition)).length;
      const ready = (state.availability || []).filter(
        (mark) => mark?.date === date && normalizeTimeRanges(mark.ranges).length
      ).length;
      const jobs = dayRows.length ? countLabel(dayRows.length, 'posting', 'postings') : 'No postings';
      const people = signed ? countLabel(signed, 'driver signed up', 'drivers signed up') : 'No signups';
      const avail = ready ? countLabel(ready, 'driver available', 'drivers available') : 'No late availability';
      return `<button type="button" class="week-day-link" data-action="daily-day" data-date="${esc(date)}">
          <strong>${esc(weekdayName(date))}</strong>
          <span>${esc(formatSheetDate(date))}</span>
          <span>${esc(jobs)} · ${esc(people)} · ${esc(avail)}</span>
        </button>`;
    })
    .join('');
  const range = `${formatSheetDate(week.start)} – ${formatSheetDate(week.friday)}`;
  root.innerHTML = `<section class="week-admin daily-admin">
      <div class="week-nav">
        <button type="button" data-action="week-prev">Earlier week</button>
        <h2>${esc(range)}</h2>
        <button type="button" data-action="week-next">Later week</button>
      </div>
      ${dailyAdminTools('')}
      ${links ? `<nav class="week-day-list" aria-label="Days">${links}</nav>` : '<p class="week-empty">No days in this week.</p>'}
    </section>`;
}

function hallPageStyle(on) {
  const existing = document.getElementById('hall-page-size');
  if (!on) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const style = document.createElement('style');
  style.id = 'hall-page-size';
  style.textContent = '@page { size: letter landscape; margin: 0.5in 0.45in 0.45in; }';
  document.head.appendChild(style);
}

function dailyPhoneUrl() {
  let origin = location.origin;
  try {
    if (state.shareUrl) origin = new URL(state.shareUrl).origin;
  } catch {
    origin = location.origin;
  }
  return `${String(origin).replace(/\/$/, '')}/driver?tab=daily`;
}

function weeklyPhoneUrl(weekStart) {
  let origin = location.origin;
  try {
    if (state.shareUrl) origin = new URL(state.shareUrl).origin;
  } catch {
    origin = location.origin;
  }
  return `${String(origin).replace(/\/$/, '')}/driver?week=${weekStart}`;
}

const MIN_BAR_PT = 14;

function pinkLineBoxes(bar, selector) {
  const el = bar.querySelector(selector);
  if (!el || !el.textContent.trim()) return [];
  const range = document.createRange();
  range.selectNodeContents(el);
  return [...range.getClientRects()];
}

function pinkNeedsShrink(bar) {
  const head = pinkLineBoxes(bar, '.bar-head');
  const name = pinkLineBoxes(bar, '.hall-driver');
  return head.length > 1 || name.length > 1;
}

function applyPinkFont(bar, pt, wrap) {
  bar.style.fontSize = `${pt}pt`;
  bar.style.lineHeight = '1.2';
  bar.style.overflowWrap = wrap;
  bar.style.height = 'auto';
}

function fitPinkBars(root) {
  const scope = root?.matches?.('[data-bar-fit]') ? root : root?.querySelector?.('[data-bar-fit]');
  if (!scope) return;
  const startPt = Math.max(MIN_BAR_PT, Math.round(Number(scope.dataset.barFont) || 24));
  const gap = 4;
  for (const track of scope.querySelectorAll('.week-track')) {
    const bars = [...track.querySelectorAll(':scope > .week-bar.trip')];
    if (!bars.length) continue;
    const measured = [];
    for (const bar of bars) {
      if (bar.clientWidth < 8) continue;
      let pt = startPt;
      let anywhere = false;
      applyPinkFont(bar, pt, 'break-word');
      while (pt > MIN_BAR_PT && pinkNeedsShrink(bar)) {
        pt -= 1;
        applyPinkFont(bar, pt, 'break-word');
      }
      const lines = [...pinkLineBoxes(bar, '.bar-head'), ...pinkLineBoxes(bar, '.hall-driver')];
      const tooWide = lines.some((rect) => rect.width > bar.clientWidth + 1);
      if (tooWide) {
        anywhere = true;
        applyPinkFont(bar, pt, 'anywhere');
      }
      measured.push({
        bar,
        lane: Number(bar.dataset.lane) || 0,
        pt,
        anywhere,
        height: Math.ceil(bar.getBoundingClientRect().height) + 2,
      });
    }
    if (!measured.length) continue;
    const laneCount = measured.reduce((max, item) => Math.max(max, item.lane + 1), 1);
    const laneHeight = Array(laneCount).fill(0);
    for (const item of measured) laneHeight[item.lane] = Math.max(laneHeight[item.lane], item.height);
    const laneTop = [];
    let cursor = 2;
    for (let lane = 0; lane < laneCount; lane += 1) {
      laneTop[lane] = cursor;
      cursor += (laneHeight[lane] || 0) + gap;
    }
    track.style.height = `${Math.max(cursor, 8)}px`;
    for (const item of measured) {
      item.bar.style.top = `${laneTop[item.lane]}px`;
      item.bar.style.height = `${item.height}px`;
      item.bar.style.fontSize = `${item.pt}pt`;
      item.bar.style.lineHeight = '1.2';
      item.bar.style.overflowWrap = item.anywhere ? 'anywhere' : 'break-word';
    }
  }
}

function watchBarFit(scope) {
  if (!scope || scope.dataset.fitWatch === '1' || typeof ResizeObserver === 'undefined') return;
  scope.dataset.fitWatch = '1';
  let width = scope.clientWidth;
  const observer = new ResizeObserver(() => {
    const next = scope.clientWidth;
    if (Math.abs(next - width) < 2) return;
    width = next;
    fitPinkBars(scope);
  });
  observer.observe(scope);
}

function scheduleBarFit(root) {
  requestAnimationFrame(() => {
    fitPinkBars(root);
    const scope = root?.matches?.('[data-bar-fit]') ? root : root?.querySelector?.('[data-bar-fit]');
    watchBarFit(scope);
  });
}

function printedAt() {
  const now = new Date();
  const date = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

function awardDriverName(posting) {
  if (posting.status !== 'awarded') return '';
  const winner = directoryPerson(posting.awarded_driver_id);
  return winner?.name || posting.awarded_name || '';
}

function renderHallPosting(kind = 'weekly') {
  const root = $('sheet-root');
  const daily = kind === 'daily';
  const bounds = daily ? null : weeklyOfficeBounds();
  const key = daily ? '' : weeklyWeekKey();
  const week = daily ? dailyWeekBounds() : bounds[key];
  const source = daily ? dailyTripRows(week) : weeklyTripRows(week);
  const rows = source.filter((row) => row.status === 'posted' || row.status === 'awarded');
  const days = weekdayDates(week.start);
  const intervals = rows.map((row) => tripInterval(row.times)).filter(Boolean);
  const axis = contentAxis(intervals);
  const hours = (axis.end - axis.start) / 60;
  const ticks = [];
  for (let minute = axis.start; minute <= axis.end; minute += 60) ticks.push(minute);
  const scale = ticks
    .map((minute) => {
      const left = barPercents({ start: minute, end: minute + 1 }, axis).left;
      return `<span class="gantt-tick" style="left:${left}%">${esc(hourTick(minute))}</span>`;
    })
    .join('');
  const chart = days
    .map((date) => {
      const dayTrips = rows.filter((row) => row.trip_date === date);
      const timed = dayTrips
        .map((posting) => ({ posting, interval: tripInterval(posting.times) }))
        .filter((row) => row.interval);
      const lanes = packLanes(timed.map((row) => row.interval));
      const laneCount = Math.max(lanes.length ? Math.max(...lanes) + 1 : 1, 1);
      const bars = timed
        .map((row, index) => {
          const drawn = clipInterval(row.interval, axis);
          if (!drawn) return '';
          const pos = barPercents(drawn, axis);
          const name = awardDriverName(row.posting);
          const line = driverBoardLine(row.posting, row.interval);
          const awarded = row.posting.status === 'awarded';
          return `<div class="week-bar trip is-fit${awarded ? ' is-awarded' : ''}" data-lane="${lanes[index]}" style="left:${pos.left}%;width:${pos.width}%">
              <span class="bar-copy"><strong class="bar-head">${esc(line)}</strong>${name ? `<span class="hall-driver">${esc(name)}</span>` : ''}</span>
            </div>`;
        })
        .join('');
      const untimed = dayTrips
        .filter((posting) => !tripInterval(posting.times))
        .map((posting) => {
          const name = awardDriverName(posting);
          return `<div class="week-open">${esc(driverBoardLine(posting, null))}${name ? ` <span class="hall-driver">${esc(name)}</span>` : ''}</div>`;
        })
        .join('');
      const outside = timed
        .filter((row) => !clipInterval(row.interval, axis))
        .map((row) => {
          const name = awardDriverName(row.posting);
          return `<div class="week-open">${esc(driverBoardLine(row.posting, row.interval))}${name ? ` <span class="hall-driver">${esc(name)}</span>` : ''}</div>`;
        })
        .join('');
      return `<div class="week-row" style="--lanes:${laneCount}">
          <div class="week-day"><strong>${esc(sheetWeekday(date))}</strong><span>${esc(formatSheetDate(date))}</span></div>
          <div>
            <div class="week-track" style="--hours:${hours}">${bars}</div>
            ${untimed}${outside}
          </div>
        </div>`;
    })
    .join('');
  const range = `${formatSheetDate(week.start)} – ${formatSheetDate(week.friday)}`;
  const font = HALL_FONTS.includes(state.postingFont) ? state.postingFont : 24;
  const phoneTarget = daily ? dailyPhoneUrl() : weeklyPhoneUrl(week.start);
  const qr = `/api/extra-work/qr?url=${encodeURIComponent(phoneTarget)}`;
  const title = daily ? 'Daily Work' : 'Awarded Weekly Work';
  const sizes = HALL_FONTS.map(
    (size) => `<option value="${size}"${size === font ? ' selected' : ''}>${size} point</option>`
  ).join('');
  const empty = rows.length
    ? ''
    : `<p class="hall-empty">No ${daily ? 'daily' : 'weekly'} work is posted for this week.</p>`;
  hallPageStyle(true);
  root.innerHTML = `<div class="hall-print${daily ? ' is-daily-print' : ''}" style="--hall-font:${font}pt">
      <div class="hall-tools">
        <button type="button" data-action="print-close">Back</button>
        <label>Font size <select data-action="posting-font" aria-label="Font size">${sizes}</select></label>
        <button type="button" class="primary" data-action="print-now">Print</button>
      </div>
      <table class="hall-sheet">
        <thead>
          <tr>
            <td>
              <div class="hall-running">
                <strong>${esc(title)}</strong>
                <span>${esc(range)}</span>
                <img alt="" src="${esc(qr)}" />
              </div>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div class="hall-award" data-bar-fit data-bar-font="${font}">
                <header class="hall-mast">
                  <h1>${esc(title)}</h1>
                  <p class="hall-range">${esc(range)}</p>
                  <img class="hall-qr" alt="Scan to open this board on your phone" src="${esc(qr)}" />
                </header>
                ${empty}
                <div class="week-scale" style="--hours:${hours}">${scale}</div>
                <div class="week-rows">${chart}</div>
                <p class="hall-printed">Printed ${esc(printedAt())}</p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>`;
  document.body.classList.add('is-hall-print');
  scheduleBarFit(root);
}

function renderWeeklyWeek() {
  const root = $('sheet-root');
  const bounds = weeklyOfficeBounds();
  const key = weeklyWeekKey();
  const week = bounds[key];
  const rows = weeklyTripRows(week);
  const openDay = state.weeklyDay;
  if (openDay && openDay >= week.start && openDay <= week.end) {
    root.innerHTML = weeklyDayScreen(openDay, rows.filter((row) => row.trip_date === openDay));
    placeSchoolCaps();
    settleDayCarousel();
    return;
  }
  const tabs = ['this', 'next']
    .map((id) => {
      const row = bounds[id];
      const name = id === 'this' ? 'This Week' : 'Next Week';
      const range = `${formatSheetDate(row.start)} – ${formatSheetDate(row.friday)}`;
      return `<button type="button" class="week-tab${id === key ? ' is-on' : ''}" data-action="weekly-tab" data-week="${id}" aria-pressed="${id === key ? 'true' : 'false'}">${esc(name)}<span>${esc(range)}</span></button>`;
    })
    .join('');
  const days = weeklyDates(week, rows)
    .map((date) => weeklyDayLink(date, rows.filter((row) => row.trip_date === date)))
    .join('');
  const empty = rows.length
    ? ''
    : `<p class="week-empty">No weekly work is posted for ${key === 'this' ? 'this week' : 'next week'}.</p>`;
  root.innerHTML = `<section class="week-admin">
    <div class="week-tabs" role="tablist">${tabs}</div>
    ${weeklyAdminTools()}
    ${weeklyPostingsPanel()}
    ${empty}
    <nav class="week-day-list" aria-label="Days">${days}</nav>
  </section>`;
  placeSchoolCaps();
}

function busWords(posting) {
  return [
    posting.buses?.big ? 'Big bus' : '',
    posting.buses?.small ? 'Small bus' : '',
    posting.buses?.wc ? 'W/C bus' : '',
  ]
    .filter(Boolean)
    .join(', ');
}

function driverBoardLine(posting, interval) {
  const from = posting.school || posting.pickup_location || '';
  const to = posting.destination || '';
  const place = from && to && from !== to ? `${from} → ${to}` : to || from;
  const route = place ? `(${place})` : '';
  const clocks = interval
    ? [formatClock(interval.start), route, formatClock(interval.end)].filter(Boolean).join(' ')
    : route || 'Times not complete';
  return [clocks, busWords(posting)].filter(Boolean).join(' · ');
}

function tripBarCopy(posting, interval) {
  const number = posting.trip_number ? `#${posting.trip_number}` : 'Trip';
  const head = [number, posting.activity].filter(Boolean).join(' ');
  const from = posting.school || posting.pickup_location || '';
  const to = posting.destination || '';
  const place = from && to && from !== to ? `${from} → ${to}` : to || from;
  const when = interval ? `${formatClock(interval.start)}–${formatClock(interval.end)}` : 'Times not complete';
  const foot = [when, busWords(posting)].filter(Boolean).join(' · ');
  let awarded = '';
  if (posting.late_addition && posting.status !== 'awarded') awarded = 'Late addition';
  if (posting.status === 'awarded') {
    if (posting.awarded_driver_id && posting.awarded_driver_id === state.driverId) awarded = 'Awarded to you';
    else if (posting.awarded_name) awarded = `Awarded · ${posting.awarded_name}`;
    else awarded = 'Awarded';
  }
  return { head, place, foot, awarded };
}

function weekBarButton(posting, interval, lane, axis, placement) {
  const drawn = clipInterval(interval, axis);
  if (!drawn) return '';
  const copy = tripBarCopy(posting, interval);
  const boardLine = driverBoardLine(posting, interval);
  const pos = barPercents(drawn, axis);
  const width = placement.fit ? pos.width : Math.max(pos.width, 8);
  const box = placement.fit
    ? `left:${pos.left}%;width:${width}%`
    : `left:${pos.left}%;width:${width}%;top:${placement.routeOffset + lane * 3.6}rem`;
  const awarded = posting.status === 'awarded';
  const sameDay = visiblePostings().filter((row) => row.trip_date === posting.trip_date);
  const day = dayBidFor(posting.trip_date || '', sameDay);
  const selected = state.signedIn && listRank(day, posting.id);
  const overlaps = state.signedIn && overlappingBars(interval, regularRouteBars(mySchedules())).length;
  const classes = [
    'week-bar',
    'trip',
    placement.fit ? 'is-fit' : '',
    overlaps ? 'is-overlap' : '',
    selected ? 'is-selected' : '',
    awarded ? 'is-awarded' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const title = placement.fit
    ? [boardLine, copy.awarded].filter(Boolean).join(' · ')
    : [copy.head, copy.place, copy.foot, copy.awarded].filter(Boolean).join(' · ');
  const lines = placement.fit
    ? `<span class="bar-copy"><strong class="bar-head">${esc(boardLine)}</strong>${copy.awarded ? `<span class="bar-award">${esc(copy.awarded)}</span>` : ''}</span>`
    : `<strong>${esc(copy.head)}</strong>${copy.place ? `<span>${esc(copy.place)}</span>` : ''}<span>${esc(copy.foot)}</span>${copy.awarded ? `<span class="week-award">${esc(copy.awarded)}</span>` : ''}`;
  const laneAttr = placement.fit ? ` data-lane="${lane}"` : '';
  return `<div class="${classes}"${laneAttr} style="${box}" title="${esc(title)}">${lines}</div>`;
}

function ensurePhoneDay(days, postings) {
  if (days.includes(state.phoneDate)) return;
  const today = localToday();
  const withTrips = days.filter((date) => postings.some((row) => row.trip_date === date));
  state.phoneDate = days.includes(today)
    ? today
    : withTrips.find((date) => date >= today) || withTrips.at(-1) || days[0];
}

function phonePlacement(interval, axis, lane, laneCount, regionLeft, regionWidth) {
  const pos = barPercents(interval, axis);
  const slot = regionWidth / Math.max(laneCount, 1);
  const gap = Math.min(1.4, slot * 0.16);
  const left = regionLeft + lane * slot + gap / 2;
  return `top:${pos.left}%;height:${Math.max(pos.width, 0.9)}%;left:${left}%;width:${Math.max(slot - gap, 1.4)}%`;
}

function renderPhoneBoard() {
  const root = $('sheet-root');
  const postings = visiblePostings();
  ensureWeek(postings);
  const days = weekDates(state.weekStart);
  const inWeek = postings.filter((row) => days.includes(row.trip_date));
  ensurePhoneDay(days, inWeek);
  const date = state.phoneDate;
  const dayTrips = inWeek.filter((row) => row.trip_date === date);
  const routes = state.signedIn ? regularRouteBars(mySchedules()) : [];
  const timed = dayTrips
    .map((posting) => ({ posting, interval: tripInterval(posting.times) }))
    .filter((row) => row.interval);
  const axis = chartAxis([...routes, ...timed.map((row) => row.interval)]);
  const hours = (axis.end - axis.start) / 60;
  const ticks = [];
  for (let minute = axis.start; minute <= axis.end; minute += 60) ticks.push(minute);
  const lanes = packLanes(timed.map((row) => row.interval));
  const tripLanes = Math.max(lanes.length ? Math.max(...lanes) + 1 : 1, 1);
  const routeLanes = routes.length ? packLanes(routes) : [];
  const routeLaneCount = routeLanes.length ? Math.max(...routeLanes) + 1 : 0;
  const routeWidth = routeLaneCount ? 26 : 0;
  const timeMarks = ticks
    .map((minute) => {
      const top = barPercents({ start: minute, end: minute + 1 }, axis).left;
      return `<span style="top:${top}%">${esc(hourTick(minute))}</span>`;
    })
    .join('');
  const routeMarkup = routes
    .map((bar, index) => {
      const label = `${bar.label} ${formatClock(bar.start)}–${formatClock(bar.end)}`;
      return `<div class="phone-bar route" style="${phonePlacement(bar, axis, routeLanes[index], routeLaneCount, 0, routeWidth)}" aria-label="${esc(label)}"></div>`;
    })
    .join('');
  const tripMarkup = timed
    .map((row, index) => {
      const copy = tripBarCopy(row.posting, row.interval);
      const label = [copy.head, copy.place, copy.foot, copy.awarded].filter(Boolean).join('. ');
      const awarded = row.posting.status === 'awarded';
      const sameDay = dayTrips;
      const day = dayBidFor(date, sameDay);
      const selected = state.signedIn && listRank(day, row.posting.id);
      const overlaps = state.signedIn && overlappingBars(row.interval, routes).length;
      const classes = ['phone-bar', overlaps ? 'is-overlap' : '', selected ? 'is-selected' : '', awarded ? 'is-awarded' : '']
        .filter(Boolean)
        .join(' ');
      const action = awarded || row.posting.late_addition ? '' : state.signedIn ? 'pick-trip' : 'pin-needed';
      const tag = action ? 'button' : 'div';
      const attrs = action ? ` type="button" data-action="${action}" data-id="${esc(row.posting.id)}"` : '';
      const place = phonePlacement(row.interval, axis, lanes[index], tripLanes, routeWidth, 100 - routeWidth);
      return `<${tag} class="${classes}"${attrs} style="${place};background:${inkFor(row.posting.id)}" aria-label="${esc(label)}"></${tag}>`;
    })
    .join('');
  const options = days
    .map(
      (day) =>
        `<option value="${esc(day)}"${day === date ? ' selected' : ''}>${esc(sheetWeekday(day))} ${esc(formatSheetDate(day))}</option>`
    )
    .join('');
  const runList = routes
    .map(
      (bar) =>
        `<li class="phone-run"><span class="phone-swatch route"></span><span class="phone-trip-copy"><strong>${esc(bar.label)}</strong><span>${esc(formatClock(bar.start))}–${esc(formatClock(bar.end))}</span></span></li>`
    )
    .join('');
  const tripList = [
    ...timed.map((row) => row.posting),
    ...dayTrips.filter((posting) => !tripInterval(posting.times)),
  ]
    .map((posting) => {
      const interval = tripInterval(posting.times);
      const copy = tripBarCopy(posting, interval);
      const awarded = posting.status === 'awarded';
      const action = awarded || posting.late_addition ? '' : state.signedIn ? 'pick-trip' : 'pin-needed';
      const tag = action ? 'button' : 'div';
      const attrs = action ? ` type="button" data-action="${action}" data-id="${esc(posting.id)}"` : '';
      return `<li><${tag} class="phone-trip${awarded ? ' is-awarded' : ''}"${attrs}><span class="phone-swatch" style="background:${inkFor(posting.id)}"></span><span class="phone-trip-copy"><strong>${esc(copy.head)}</strong>${copy.place ? `<span>${esc(copy.place)}</span>` : ''}<span>${esc(copy.foot)}</span>${copy.awarded ? `<span class="week-award">${esc(copy.awarded)}</span>` : ''}</span></${tag}></li>`;
    })
    .join('');
  const bids =
    state.signedIn && dayTrips.some((row) => row.status === 'posted' && !row.late_addition)
      ? renderDayBid(date, dayTrips, routes)
      : '';
  const end = formatSheetDate(addIsoDays(state.weekStart, 6));
  root.innerHTML = `<div class="week-board phone-board">
    <div class="week-nav">
      <button type="button" data-action="week-prev">Earlier</button>
      <h2>${esc(formatSheetDate(state.weekStart))} – ${esc(end)}</h2>
      <button type="button" data-action="week-next">Later</button>
    </div>
    <label class="phone-day">Day
      <select data-action="phone-day">${options}</select>
    </label>
    ${state.signedIn && boardList === 'daily' ? availabilityLauncher(date) : ''}
    <div class="phone-chart" style="height:${Math.max(hours * 2.65, 16)}rem;--hours:${hours}">
      <div class="phone-times">${timeMarks}</div>
      <div class="phone-track">${routeMarkup}${tripMarkup}</div>
    </div>
    <ul class="phone-trips">${runList}${tripList || '<li class="phone-empty">No trips posted for this day.</li>'}</ul>
    ${bids}
  </div>`;
  renderPinDock();
}

function phoneWeekDays(weekStart, postings) {
  const days = weekdayDates(weekStart);
  const end = addIsoDays(weekStart, 6);
  for (const row of postings) {
    if (row.trip_date && row.trip_date >= weekStart && row.trip_date <= end && !days.includes(row.trip_date)) {
      days.push(row.trip_date);
    }
  }
  days.sort();
  return days;
}

function shortWeekday(iso) {
  return (weekdayName(iso) || 'Day').slice(0, 3);
}

function monthDay(iso) {
  const [, month, day] = String(iso || '').split('-');
  if (!month || !day) return '';
  return `${Number(month)}/${Number(day)}`;
}

function wantPlace(posting) {
  const from = posting.school || posting.pickup_location || '';
  const to = posting.destination || '';
  if (from && to && from !== to) return `${from} → ${to}`;
  return to || from || (posting.trip_number ? `#${posting.trip_number}` : 'Trip');
}

function wantButton(posting, rank) {
  const on = rank > 0;
  const label = on ? `Choice ${rank}. Tap to take this off.` : 'WANT';
  return `<button type="button" class="want-btn${on ? ' is-on' : ''}" data-action="want-trip" data-id="${esc(posting.id)}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${esc(label)}">${on ? `<span class="want-num">${rank}</span>` : ''}<span>WANT</span></button>`;
}

function renderWeeklyPhone() {
  const root = $('sheet-root');
  const postings = visiblePostings();
  ensureWeek(postings);
  const days = phoneWeekDays(state.weekStart, postings);
  const inWeek = postings.filter((row) => days.includes(row.trip_date));
  ensurePhoneDay(days, inWeek);
  const date = state.phoneDate;
  const dayTrips = inWeek.filter((row) => row.trip_date === date);
  dayTrips.sort((a, b) => {
    const startA = tripInterval(a.times)?.start ?? 24 * 60;
    const startB = tripInterval(b.times)?.start ?? 24 * 60;
    if (startA !== startB) return startA - startB;
    return String(a.trip_number).localeCompare(String(b.trip_number), undefined, { numeric: true });
  });
  const dailyPhone = boardList === 'daily';
  const rosterPhone = boardList === 'roster';
  const routes = state.signedIn ? regularRouteBars(mySchedules()) : [];
  const windows = state.signedIn ? windowsForDriver(state.driverId, dailyPhone ? date : '') : [];
  const held = (dailyPhone || rosterPhone) && state.signedIn ? awardedWeeklyBars(state.driverId, date) : [];
  const timed = dayTrips
    .map((posting) => ({ posting, interval: tripInterval(posting.times) }))
    .filter((row) => row.interval);
  const axis = chartAxis([...windows, ...routes, ...timed.map((row) => row.interval)]);
  const hours = (axis.end - axis.start) / 60;
  const tickStep = hours > 8 ? 120 : 60;
  const tickStart = tickStep === 120 ? Math.ceil(axis.start / 120) * 120 : axis.start;
  const ticks = [];
  for (let minute = tickStart; minute <= axis.end; minute += tickStep) ticks.push(minute);
  const lanes = packLanes(timed.map((row) => row.interval));
  const laneCount = Math.max(lanes.length ? Math.max(...lanes) + 1 : 1, 1);
  const lanePx = 76;
  const weeklyPhone = !dailyPhone && !rosterPhone;
  const bandPx = 56;
  const trackPx = Math.max(laneCount * lanePx + 8 + bandPx, 132 + bandPx);
  const freeBox = 'top:0.25rem;height:2.7rem';
  const day = dayBidFor(date, dayTrips);
  const closed = dayIsClosed(date);
  const scale = ticks
    .map((minute) => {
      const left = barPercents({ start: minute, end: minute + 1 }, axis).left;
      return `<span class="gantt-tick" style="left:${left}%">${esc(hourTick(minute))}</span>`;
    })
    .join('');
  const freeMarkup = windows
    .map((window) => {
      const drawn = clipInterval(window, axis);
      if (!drawn) return '';
      const pos = barPercents(drawn, axis);
      const when = `${formatClock(window.start)}–${formatClock(window.end)}`;
      const right = pos.left + pos.width;
      const cap = (kind, school, edge) => (school ? schoolCap(kind, school, edge, 2.7) : '');
      const open = Boolean(window.openLabel);
      const freeTitle = open ? `${window.openLabel} ${when}` : weeklyPhone ? `Your free time ${when}` : `Free mid-day time ${when}`;
      const freeText = open ? esc(window.openLabel) : weeklyPhone ? '<span class="free-name">Your free time</span>' : '';
      return `${open ? '' : cap('from', window.fromSchool, pos.left)}<span class="gantt-bar free${open ? ' is-open' : ''}" style="left:${pos.left}%;width:${pos.width}%;${freeBox}" title="${esc(freeTitle)}">${freeText}</span>${open ? '' : cap('to', window.toSchool, right)}`;
    })
    .join('');
  const tripMarkup = timed
    .map((row, index) => {
      const line = driverBoardLine(row.posting, row.interval);
      const pos = barPercents(row.interval, axis);
      const awarded = row.posting.status === 'awarded';
      const open = row.posting.status === 'posted' && !row.posting.late_addition && !closed;
      const rank = open ? listRank(day, row.posting.id) : 0;
      const crosses = state.signedIn && overlappingBars(row.interval, [...routes, ...held]).length;
      const classes = [
        'gantt-bar',
        'trip',
        dailyPhone ? 'is-daily' : rosterPhone ? 'is-roster' : 'is-pink',
        crosses ? 'is-overlap' : '',
        rank ? 'is-wanted' : '',
        awarded ? 'is-awarded' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const note = awarded
        ? row.posting.awarded_driver_id === state.driverId
          ? 'Awarded to you'
          : row.posting.awarded_name
            ? `Awarded · ${row.posting.awarded_name}`
            : 'Awarded'
        : row.posting.late_addition
          ? 'Late addition'
          : crosses
            ? 'Crosses your run'
            : '';
      return `<div class="${classes}" data-lane="${lanes[index] || 0}" style="left:${pos.left}%;width:${pos.width}%;top:3.45rem" title="${esc([line, note].filter(Boolean).join('. '))}">
          ${open ? wantButton(row.posting, rank) : ''}
          <span class="trip-bar-label">${esc(line)}</span>
          ${!open && note ? `<span class="want-note">${esc(note)}</span>` : ''}
        </div>`;
    })
    .join('');
  const dayButtons = days
    .map((day) => {
      const on = day === date ? ' is-on' : '';
      const label = `${weekdayName(day)} ${formatSheetDate(day)}`;
      return `<button type="button" class="phone-day-btn${on}" data-action="phone-day" data-date="${esc(day)}" aria-pressed="${day === date ? 'true' : 'false'}" aria-label="${esc(label)}"><span class="phone-day-name">${esc(shortWeekday(day))}</span><span class="phone-day-date">${esc(monthDay(day))}</span></button>`;
    })
    .join('');
  const duty = state.signedIn ? openDuty(mySchedules()) : null;
  const openTrips = dayTrips.filter((row) => row.status === 'posted' && !row.late_addition);
  const anyOn = day.mode === 'many';
  const orderNames = day.primary
    .map((id, index) => {
      const posting = dayTrips.find((row) => row.id === id) || state.postings.find((row) => row.id === id);
      return posting ? `${index + 1}  ${wantPlace(posting)}` : '';
    })
    .filter(Boolean);
  const orderLine = orderNames.join('   ·   ');
  const fitLine = closed
    ? 'Sign-up for this day is closed.'
    : !openTrips.length
      ? 'These trips are already awarded.'
      : '';
  const anyButton =
    closed || !openTrips.length
      ? ''
      : `<button type="button" class="want-any${anyOn ? ' is-on' : ''}" data-action="want-any" data-date="${esc(date)}" aria-pressed="${anyOn ? 'true' : 'false'}">I want anything that fits</button>`;
  const cipher = dayCipher(day, dayTrips);
  const onSheet = state.signedIn && !day.dirty && dayMatchesSheet(day, dayTrips, cipher);
  const saveNote = !state.signedIn || (onSheet && cipher)
    ? ''
    : day.dirty
      ? 'Not saved yet.'
      : 'Nothing saved for this day.';
  const saveRow =
    closed || !openTrips.length
      ? ''
      : `<div class="want-save"><button type="button" class="primary" data-action="save-day" data-date="${esc(date)}">Submit</button>${saveNote ? `<span class="signed-note">${esc(saveNote)}</span>` : ''}</div>`;
  const untimed = dayTrips
    .filter((posting) => !tripInterval(posting.times) && posting.status === 'posted' && !posting.late_addition && !closed)
    .map((posting) => {
      const rank = listRank(day, posting.id);
      return `<li class="want-open">${wantButton(posting, rank)}<span>${esc(driverBoardLine(posting, null))}</span></li>`;
    })
    .join('');
  const heldMarkup = held
    .map((bar) => {
      const drawn = clipInterval(bar, axis);
      if (!drawn) return '';
      const pos = barPercents(drawn, axis);
      return `<span class="gantt-bar weekly-held" style="left:${pos.left}%;width:${pos.width}%;${freeBox}" title="${esc(bar.label)}">${esc(bar.label)}</span>`;
    })
    .join('');
  const end = formatSheetDate(addIsoDays(state.weekStart, rosterPhone ? 6 : 4));
  const legend = rosterPhone
    ? '<span class="swatch free"></span> Free mid-day time <span class="swatch weekly"></span> Awarded weekly work <span class="swatch trip"></span> Roster trip'
    : dailyPhone
      ? `${duty ? `<span class="swatch open"></span> ${esc(duty.label)}` : '<span class="swatch free"></span> Free mid-day time'} <span class="swatch weekly"></span> Awarded weekly work <span class="swatch trip"></span> Daily work`
      : '';
  const anyTools = `<div class="want-tools">${anyButton}</div>`;
  root.innerHTML = `<div class="week-board phone-board free-phone${dailyPhone ? ' is-daily-phone' : ''}${rosterPhone ? ' is-roster-phone' : ''}">
      ${fromDriver ? `<a class="dash-back" href="${esc(driverDashHref())}" target="_top">Dashboard</a>` : ''}
      <div class="week-nav">
        <button type="button" data-action="week-prev">Earlier</button>
        <h2>${esc(formatSheetDate(state.weekStart))} – ${esc(end)}</h2>
        <button type="button" data-action="week-next">Later</button>
      </div>
      <div class="phone-days" role="tablist">${dayButtons}</div>
      ${dailyPhone ? availabilityLauncher(date) : ''}
      ${weeklyPhone ? '' : anyTools}
      ${weeklyPhone ? anyTools : ''}
      ${legend ? `<p class="gantt-legend">${legend}</p>` : ''}
      <div class="dispatch-chart free-phone-chart" style="--hours:${hours}">
        <div class="gantt-scale">${scale}</div>
        <div class="gantt-track dispatch-track" style="height:${trackPx}px">${duty?.kind === 'open' ? `<span class="gantt-bar free is-open" style="left:0;width:100%;${freeBox}">${esc(duty.label)}</span>` : ''}${freeMarkup}${heldMarkup}${tripMarkup}</div>
      </div>
      ${untimed ? `<ul class="want-untimed">${untimed}</ul>` : ''}
      ${orderLine ? `<p class="want-order">${esc(orderLine)}</p>` : ''}
      ${fitLine ? `<p class="want-fit">${esc(fitLine)}</p>` : ''}
      ${saveRow}
    </div>`;
  placeSchoolCaps();
  renderPinDock();
  schedulePhoneWantFit();
}

function fitPhoneWantBars() {
  const track = document.querySelector('.free-phone-chart .gantt-track');
  if (!track) return;
  const bars = [...track.querySelectorAll(':scope > .gantt-bar.trip')];
  const gap = 8;
  let cursor = 4;
  const bandBottom = [...track.querySelectorAll(':scope > .gantt-bar.free, :scope > .gantt-bar.weekly-held')].reduce(
    (max, bar) => Math.max(max, bar.offsetTop + bar.offsetHeight),
    0
  );
  if (bandBottom) cursor = bandBottom + gap;
  if (!bars.length) {
    if (cursor > 4) track.style.height = `${cursor + 4}px`;
    return;
  }
  const measured = [];
  for (const bar of bars) {
    if (bar.clientWidth < 8) continue;
    bar.style.height = 'auto';
    measured.push({
      bar,
      lane: Number(bar.dataset.lane) || 0,
      height: Math.ceil(bar.scrollHeight),
    });
  }
  if (!measured.length) return;
  const laneCount = measured.reduce((max, item) => Math.max(max, item.lane + 1), 1);
  const laneHeight = Array(laneCount).fill(0);
  for (const item of measured) laneHeight[item.lane] = Math.max(laneHeight[item.lane], item.height);
  const laneTop = [];
  for (let lane = 0; lane < laneCount; lane += 1) {
    laneTop[lane] = cursor;
    cursor += laneHeight[lane] + gap;
  }
  track.style.height = `${cursor + 4}px`;
  for (const item of measured) {
    item.bar.style.top = `${laneTop[item.lane]}px`;
    item.bar.style.height = `${laneHeight[item.lane]}px`;
  }
}

function schedulePhoneWantFit() {
  let tries = 0;
  const run = () => {
    const track = document.querySelector('.free-phone-chart .gantt-track');
    if (!track) return;
    const bars = [...track.querySelectorAll(':scope > .gantt-bar.trip')];
    const narrow = bars.some((bar) => bar.clientWidth < 8);
    if (narrow && tries < 40) {
      tries += 1;
      requestAnimationFrame(run);
      return;
    }
    fitPhoneWantBars();
  };
  requestAnimationFrame(run);
}

function renderWeekBoard() {
  if (phoneView) {
    if (boardList === 'weekly' || boardList === 'daily' || boardList === 'roster') renderWeeklyPhone();
    else renderPhoneBoard();
    return;
  }
  const root = $('sheet-root');
  const postings = visiblePostings();
  ensureWeek(postings);
  const days = wallDisplay ? weekdayDates(state.weekStart) : weekDates(state.weekStart);
  const inWeek = postings.filter((row) => days.includes(row.trip_date));
  const routes = state.signedIn ? regularRouteBars(mySchedules()) : [];
  const intervals = [
    ...routes,
    ...inWeek.map((row) => tripInterval(row.times)).filter(Boolean),
  ];
  const axis = wallDisplay ? contentAxis(intervals) : chartAxis(intervals);
  const ticks = [];
  for (let minute = axis.start; minute <= axis.end; minute += 60) ticks.push(minute);
  const hours = (axis.end - axis.start) / 60;
  const scale = `<div class="week-scale" style="--hours:${hours}">${ticks
    .map((minute) => {
      const left = barPercents({ start: minute, end: minute + 1 }, axis).left;
      return `<span class="gantt-tick" style="left:${left}%">${esc(hourTick(minute))}</span>`;
    })
    .join('')}</div>`;
  const driver = state.drivers.find((row) => row.driver_id === state.driverId);
  const lead = state.signedIn
    ? routes.length
      ? `${driver?.name || 'Your'} regular runs are on each day with the trips. Tap a trip to add it.`
      : `${driver?.name || 'You'} can tap a trip to sign up. No regular route clocks are on file.`
    : 'Each row is one day. The trip is written on its bar.';
  const rows = days
    .map((date) => {
      const dayTrips = inWeek.filter((row) => row.trip_date === date);
      const timed = dayTrips
        .map((posting) => ({ posting, interval: tripInterval(posting.times) }))
        .filter((row) => row.interval);
      const lanes = packLanes(timed.map((row) => row.interval));
      const laneCount = Math.max(lanes.length ? Math.max(...lanes) + 1 : 1, 1);
      const routeBand = wallDisplay && routes.length ? 14 : 0;
      const laneGap = laneCount > 1 ? 1.1 : 0.4;
      const lanePct = (100 - routeBand) / laneCount;
      const placement = wallDisplay
        ? { fit: true, routeBand, lanePct, barHeight: Math.max(lanePct - laneGap, 0.5) }
        : { fit: false, routeOffset: routes.length ? 1.75 : 0.25 };
      const height = (placement.routeOffset || 0.25) + laneCount * 3.6 + 0.35;
      const routeMarkup = routes
        .map((bar) => {
          const drawn = clipInterval(bar, axis);
          if (!drawn) return '';
          const pos = barPercents(drawn, axis);
          const box = wallDisplay
            ? `left:${pos.left}%;width:${pos.width}%;top:1%;height:${Math.max(routeBand - 2, 8)}%`
            : `left:${pos.left}%;width:${pos.width}%;top:0.2rem`;
          const label = `${bar.label} ${formatClock(bar.start)}–${formatClock(bar.end)}`;
          return `<div class="week-bar route" style="${box}" title="${esc(label)}"><span>${esc(bar.label)}</span></div>`;
        })
        .join('');
      const tripMarkup = timed
        .map((row, index) => weekBarButton(row.posting, row.interval, lanes[index], axis, placement))
        .join('');
      const untimed = dayTrips
        .filter((posting) => !tripInterval(posting.times))
        .map((posting) => {
          if (wallDisplay) return `<div class="week-open">${esc(driverBoardLine(posting, null))}</div>`;
          const copy = tripBarCopy(posting, null);
          return `<div class="week-open">${esc(copy.head)} — ${esc(copy.place || 'times not complete')}</div>`;
        })
        .join('');
      const outside = wallDisplay
        ? timed
            .filter((row) => !clipInterval(row.interval, axis))
            .map((row) => `<div class="week-open">${esc(driverBoardLine(row.posting, row.interval))}</div>`)
            .join('')
        : '';
      return `<div class="week-row">
        <div class="week-day"><strong>${esc(sheetWeekday(date))}</strong><span>${esc(formatSheetDate(date))}</span></div>
        <div>
          <div class="week-track" style="--hours:${hours}${wallDisplay ? '' : `;height:${height}rem`}">${routeMarkup}${tripMarkup}</div>
          ${untimed}${outside}
        </div>
      </div>`;
    })
    .join('');
  const end = formatSheetDate(addIsoDays(state.weekStart, wallDisplay ? 4 : 6));
  const qr = state.shareUrl
    ? `<img class="week-qr" alt="Scan to open this board on your phone" src="/api/extra-work/qr?url=${encodeURIComponent(state.shareUrl)}" />`
    : '';
  const fitAttr = wallDisplay ? ' data-bar-fit data-bar-font="24"' : '';
  root.innerHTML = `<div class="week-board"${fitAttr}>
    <div class="week-nav">
      <div class="week-nav-side">
        ${wallDisplay ? '<button type="button" data-action="wall-back">Back</button>' : ''}
        <button type="button" data-action="week-prev">Earlier week</button>
      </div>
      <div class="week-heading">
        <h2>${esc(formatSheetDate(state.weekStart))} – ${esc(end)}</h2>
        ${qr}
      </div>
      <button type="button" data-action="week-next">Later week</button>
    </div>
    ${wallDisplay ? '' : `<p class="driver-lead">${esc(lead)}</p>`}
    ${wallDisplay || !state.signedIn || boardList !== 'daily' ? '' : availabilityLauncher(localToday())}
    ${
      wallDisplay
        ? ''
        : '<p class="gantt-legend"><span class="swatch route"></span> Regular run <span class="swatch trip"></span> Daily work <span class="swatch overlap"></span> Crosses your run</p>'
    }
    ${scale}
    <div class="week-rows">${rows}</div>
    ${wallDisplay ? `<p class="hall-printed week-printed">Printed ${esc(printedAt())}</p>` : ''}
  </div>`;
  renderPinDock();
  if (wallDisplay) scheduleBarFit(root);
}

function renderSheet() {
  queueMicrotask(() => syncWeeklyPostingsPanel());
  if (officeDesk && boardList === 'daily' && state.postingPrint && !state.weeklyEntry) {
    renderPinDock();
    renderHallPosting('daily');
    return;
  }
  if (onWeekWall()) {
    renderWeekBoard();
    return;
  }
  if (dailyOfficeTable()) {
    renderPinDock();
    document.body.classList.remove('is-hall-print');
    hallPageStyle(false);
    renderDailyWeek();
    return;
  }
  if (rosterOfficeTable()) {
    renderPinDock();
    document.body.classList.remove('is-hall-print');
    hallPageStyle(false);
    renderRosterWeek();
    return;
  }
  if (officeDesk && boardList === 'weekly' && state.postingPrint) {
    renderPinDock();
    renderHallPosting();
    return;
  }
  if (weeklyOfficeTable()) {
    renderPinDock();
    document.body.classList.remove('is-hall-print');
    hallPageStyle(false);
    renderWeeklyWeek();
    return;
  }
  document.body.classList.remove('is-hall-print');
  hallPageStyle(false);
  renderPinDock();
  const root = $('sheet-root');
  const posting = state.selectedId === 'new' ? blankPosting() : selectedPosting();
  if (!posting) {
    const postings = officeDesk && boardList === 'weekly' ? weeklyPostingsPanel() : '';
    root.innerHTML = `${postings}<div class="sheet"><p>No trip sheet is on the board.</p></div>`;
    return;
  }
  const editing = state.mode === 'office' && posting.status !== 'awarded';
  const day = sheetWeekday(posting.trip_date);
  const winner = directoryPerson(posting.awarded_driver_id);
  const stamp = winner
    ? `<div class="award-stamp" aria-label="Awarded to ${esc(winner.name)}">${esc(givenName(winner.name))}</div>`
    : '';
  const tools = editing
    ? `<div class="sheet-tools">
        <button type="button" class="primary" data-action="save">${posting.id ? 'Save' : 'Save draft'}</button>
        ${posting.status === 'draft' ? '<button type="button" data-action="post">Post to the board</button>' : ''}
        ${posting.id && posting.status === 'draft' ? '<button type="button" data-action="delete-draft">Delete draft</button>' : ''}
        ${officeDesk && (boardList === 'weekly' || boardList === 'daily' || boardList === 'roster') ? '<button type="button" data-action="weekly-back">Back to the day</button>' : ''}
      </div>`
    : officeDesk && (boardList === 'weekly' || boardList === 'daily' || boardList === 'roster')
      ? `<div class="sheet-tools"><button type="button" data-action="weekly-back">Back to the day</button></div>`
      : '';

  const postingsPanel = officeDesk && boardList === 'weekly' ? weeklyPostingsPanel() : '';
  root.innerHTML = `${postingsPanel}${posting.late_addition ? '<p class="late-banner">Late addition, after 8:00. Drivers do not sign this sheet. It goes to drivers who marked a time that covers it, by the same overtime and seniority rule. Then offer it by radio, then to a substitute. Work that comes in between 6:15 and 8:00 is still a normal signup: announce it by radio so drivers can add their names before 8:00.</p>' : ''}
    ${posting.late_addition ? '' : awardLogicMarkup(posting)}
    <article class="sheet">
      ${boardList === 'roster' ? '<p class="sheet-kicker">Roster trip information - read carefully.</p>' : ''}
      <form id="trip-form">
        <div class="form-line date-line">
          <span class="lbl">Trip date:</span>
          ${
            editing
              ? `<input class="marker-field date" type="date" name="trip_date" value="${esc(posting.trip_date)}" />`
              : markerText(formatSheetDate(posting.trip_date))
          }
          <span class="days"><span class="lbl">Day:</span>${daySelect(day, editing)}</span>
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
        <div class="form-line">
          ${
            editing
              ? checkMark('Leaves town', 'out_of_town', 'on', Boolean(posting.out_of_town), 'checkbox')
              : staticCheck('Leaves town', Boolean(posting.out_of_town))
          }
          <span class="avail-note">A trip of 3.5 hours or more that leaves town goes by seniority even with overtime. A shorter trip still follows the regular rule.</span>
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
                  ? `<input class="marker-field ticket" name="trip_number" value="${esc(posting.trip_number)}" />`
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
        ${tools}
      </form>
      ${posting.late_addition ? '<div id="late-interest"></div>' : signupsTable(posting)}
      ${substituteAssignMarkup(posting)}
      ${
        state.mode === 'driver' && posting.status === 'posted'
          ? `<p class="bid-hint">No parentheses means one assignment that day. Parentheses means all the work you can get. Examples: 3,7 or (3-8) or (1-5), (6-10). Total hours and overtime are calculated from the regular route and those trips.</p>`
          : ''
      }
    </article>`;
  bindLiveMarks(root);
  renderLateInterest();
  root.querySelectorAll('[name="bid_initials"], [name="bid_preference"]').forEach((input) => {
    input.addEventListener('input', () => {
      state.dirty = true;
    });
  });
}

function myRanges(date) {
  const mark = (state.myAvailability || []).find((row) => row.date === date);
  return normalizeTimeRanges(mark?.ranges);
}

function formatRange(range) {
  const start = parseMinutes(range.start);
  const end = parseMinutes(range.end);
  if (start == null || end == null) return '';
  return `${formatClock(start)}–${formatClock(end)}`;
}

function availabilityGlyph() {
  return `<svg class="avail-glyph" viewBox="0 0 48 48" aria-hidden="true">
      <g transform="translate(16 17)" fill="currentColor">
        <rect x="-2.3" y="-15.5" width="4.6" height="6.2" rx="1"></rect>
        <rect x="-2.3" y="-15.5" width="4.6" height="6.2" rx="1" transform="rotate(45)"></rect>
        <rect x="-2.3" y="-15.5" width="4.6" height="6.2" rx="1" transform="rotate(90)"></rect>
        <rect x="-2.3" y="-15.5" width="4.6" height="6.2" rx="1" transform="rotate(135)"></rect>
        <rect x="-2.3" y="-15.5" width="4.6" height="6.2" rx="1" transform="rotate(180)"></rect>
        <rect x="-2.3" y="-15.5" width="4.6" height="6.2" rx="1" transform="rotate(225)"></rect>
        <rect x="-2.3" y="-15.5" width="4.6" height="6.2" rx="1" transform="rotate(270)"></rect>
        <rect x="-2.3" y="-15.5" width="4.6" height="6.2" rx="1" transform="rotate(315)"></rect>
        <circle r="10"></circle>
        <circle class="avail-glyph-hole" r="3.7"></circle>
      </g>
      <circle class="avail-glyph-face" cx="33.5" cy="32.5" r="10.5"></circle>
      <circle cx="33.5" cy="32.5" r="10.5" fill="none" stroke="currentColor" stroke-width="2"></circle>
      <path d="M33.5 26.2 V32.6 L37.6 35.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      <circle cx="33.5" cy="32.6" r="1.25" fill="currentColor"></circle>
    </svg>`;
}

function availabilitySummary(date) {
  const day = shortWeekday(date);
  const mine = (state.myAvailability || []).find((row) => row.date === date);
  if (dayIsClosed(date)) {
    if (mine?.open) return `${day} · ${OPEN_MIDDAY_LABEL} · closed`;
    const ranges = myRanges(date);
    return ranges.length ? `${day} · ${ranges.map(formatRange).join(', ')} · closed` : `${day} · closed`;
  }
  const schedule = state.mySchedule;
  if (!schedule) {
    if (mine?.open) return `${day} · ${OPEN_MIDDAY_LABEL}`;
    const ranges = myRanges(date);
    return ranges.length ? `${day} · ${ranges.map(formatRange).join(', ')}` : 'Not set yet';
  }
  const exception = (schedule.exceptions || []).find((row) => row.date === date);
  if (dayIsOpenOnSchedule(schedule, date)) {
    const tag = exception ? ' · exception' : '';
    const entry = schedule.weekdays?.[weekdayKey(date)];
    if (!exception && entry?.same_as) {
      const label = AVAIL_WEEKDAYS.find((row) => row.key === entry.same_as)?.label || 'another day';
      return `${day} · ${OPEN_MIDDAY_LABEL} · same as ${label}`;
    }
    return `${day} · ${OPEN_MIDDAY_LABEL}${tag}`;
  }
  const ranges = rangesOnSchedule(schedule, date);
  const when = ranges.length ? ranges.map(formatRange).join(', ') : 'Not available';
  if (exception) return `${day} · ${when} · exception`;
  const entry = schedule.weekdays?.[weekdayKey(date)];
  if (entry?.same_as) {
    const label = AVAIL_WEEKDAYS.find((row) => row.key === entry.same_as)?.label || 'another day';
    return `${day} · ${when} · same as ${label}`;
  }
  return `${day} · ${when}`;
}

function availabilityLauncher(date) {
  if (!date) return '';
  const text = availabilitySummary(date);
  return `<div class="avail-bar"><button type="button" class="avail-launch" data-action="open-availability" data-date="${esc(date)}" aria-haspopup="dialog" aria-label="${esc(`Availability settings. ${text}`)}">${availabilityGlyph()}<span class="avail-launch-copy"><strong>Availability</strong><span class="avail-launch-when">${esc(text)}</span></span></button></div>`;
}

function availabilityDraftFromState() {
  const weekdays = emptyAvailabilityWeek();
  for (const day of AVAIL_WEEKDAYS) weekdays[day.key] = { ...weekdays[day.key], mode: 'off' };
  const source = state.mySchedule;
  if (source) {
    for (const day of AVAIL_WEEKDAYS) {
      const entry = source.weekdays?.[day.key] || {};
      const ranges = normalizeTimeRanges(entry.ranges);
      const same_as = String(entry.same_as || '');
      const open = entry.open === true;
      weekdays[day.key] = {
        ranges: same_as || open ? [] : ranges,
        note: String(entry.note || ''),
        same_as,
        open,
        mode: same_as ? 'same' : open ? 'open' : ranges.length ? 'times' : 'off',
      };
    }
    return {
      weekdays,
      exceptions: (source.exceptions || []).map((row) => ({
        date: row.date,
        ranges: row.open ? [] : normalizeTimeRanges(row.ranges),
        note: String(row.note || ''),
        open: row.open === true,
      })),
    };
  }
  return {
    weekdays,
    exceptions: (state.myAvailability || [])
      .filter((mark) => mark?.date)
      .map((mark) => ({
        date: mark.date,
        ranges: mark.open ? [] : normalizeTimeRanges(mark.ranges),
        note: '',
        open: mark.open === true,
      }))
      .filter((row) => row.open || row.ranges.length),
  };
}

function freshExceptionDraft(focus, exceptions) {
  const taken = (exceptions || []).some((row) => row.date === focus);
  return {
    date: focus && !taken && !dayIsClosed(focus) ? focus : '',
    ranges: [],
    note: '',
    kind: 'times',
  };
}

function weekdayPayload(entry) {
  const note = String(entry?.note || '').slice(0, 80);
  if (entry?.mode === 'same' && entry.same_as) return { ranges: [], note, same_as: entry.same_as, open: false };
  if (entry?.mode === 'open') return { ranges: [], note, same_as: '', open: true };
  if (entry?.mode === 'times') return { ranges: normalizeTimeRanges(entry.ranges), note, same_as: '', open: false };
  return { ranges: [], note, same_as: '', open: false };
}

function draftPreview(date) {
  if (!date || !state.availDraft) return '';
  if (dayIsClosed(date)) {
    const mine = (state.myAvailability || []).find((row) => row.date === date);
    if (mine?.open) return `${dayHeading(date)} is closed. The office kept totally open on my mid-day.`;
    const ranges = myRanges(date);
    const when = ranges.length ? ranges.map(formatRange).join(', ') : 'not available';
    return `${dayHeading(date)} is closed. The office kept ${when}.`;
  }
  const draft = state.availDraft;
  const exception = (draft.exceptions || []).find((row) => row.date === date);
  const previewSchedule = {
    weekdays: Object.fromEntries(AVAIL_WEEKDAYS.map((day) => [day.key, weekdayPayload(draft.weekdays[day.key])])),
    exceptions: draft.exceptions,
  };
  if (dayIsOpenOnSchedule(previewSchedule, date)) {
    const note = exception?.note ? ` ${exception.note}` : '';
    const entry = draft.weekdays?.[weekdayKey(date)];
    const sameLabel = AVAIL_WEEKDAYS.find((row) => row.key === entry?.same_as)?.label || 'another day';
    const same = !exception && entry?.mode === 'same' ? ` Same as ${sameLabel}.` : '';
    const repeat = exception ? `${note} This date replaces the usual week.` : ` This repeats every ${weekdayName(date)}.`;
    return `${dayHeading(date)}: totally open on my mid-day.${repeat}${same} This does not limit the times.`;
  }
  const ranges = rangesOnSchedule(previewSchedule, date);
  const when = ranges.length ? ranges.map(formatRange).join(', ') : 'not available';
  if (exception) {
    const note = exception.note ? ` ${exception.note}` : '';
    return `${dayHeading(date)}: ${when}.${note} This date replaces the usual week.`;
  }
  const entry = draft.weekdays?.[weekdayKey(date)];
  if (entry?.mode === 'times' && !ranges.length) {
    return `${dayHeading(date)}: add the times for every ${weekdayName(date)}.`;
  }
  if (entry?.mode === 'same' && entry.same_as) {
    const label = AVAIL_WEEKDAYS.find((row) => row.key === entry.same_as)?.label || 'another day';
    return `${dayHeading(date)}: ${when}. Same as ${label}.`;
  }
  return `${dayHeading(date)}: ${when}. This repeats every ${weekdayName(date)}.`;
}

function dialogError() {
  if (state.availDraft && sameAsCycle(state.availDraft.weekdays)) {
    return 'One weekday cannot follow another in a circle.';
  }
  return state.availError || '';
}

function rangeItems(ranges, action, extra = '') {
  return ranges
    .map((range, index) => {
      const when = formatRange(range);
      return `<li><span>${esc(when)}</span><button type="button" class="avail-remove" data-action="${esc(action)}" data-index="${index}"${extra}>Remove</button></li>`;
    })
    .join('');
}

function weekdayBlock(day) {
  const entry = state.availDraft.weekdays[day.key];
  const mode =
    entry.mode === 'same' && entry.same_as ? `same:${entry.same_as}` : entry.mode === 'times' ? 'times' : entry.mode === 'open' ? 'open' : 'off';
  const options = [
    `<option value="off"${mode === 'off' ? ' selected' : ''}>Not available</option>`,
    `<option value="open"${mode === 'open' ? ' selected' : ''}>${esc(OPEN_MIDDAY_LABEL)}</option>`,
    `<option value="times"${mode === 'times' ? ' selected' : ''}>These times</option>`,
    ...AVAIL_WEEKDAYS.filter((row) => row.key !== day.key).map(
      (row) =>
        `<option value="same:${esc(row.key)}"${mode === `same:${row.key}` ? ' selected' : ''}>Same as ${esc(row.label)}</option>`
    ),
  ].join('');
  let detail = '<p class="avail-note">Not available for late additions.</p>';
  if (entry.mode === 'open') {
    detail = `<p class="avail-note">${esc(OPEN_MIDDAY_LABEL)}. Any late addition this day counts. The times are not limited.</p>`;
  } else if (entry.mode === 'same' && entry.same_as) {
    const label = AVAIL_WEEKDAYS.find((row) => row.key === entry.same_as)?.label || 'that day';
    const open = weekdayEntryOpen(state.availDraft.weekdays, entry.same_as);
    const ranges = weekdayEntryRanges(state.availDraft.weekdays, entry.same_as);
    const when = open ? OPEN_MIDDAY_LABEL : ranges.length ? ranges.map(formatRange).join(', ') : 'not available';
    detail = `<p class="avail-note">Uses ${esc(label)}: ${esc(when)}.</p>`;
  } else if (entry.mode === 'times') {
    const saved = entry.ranges.length
      ? `<ul class="avail-times">${rangeItems(entry.ranges, 'avail-remove-range', ` data-weekday="${esc(day.key)}"`)}</ul>`
      : '<p class="avail-note">Add the times you can take late additions.</p>';
    detail = `${saved}<div class="avail-add">
        <label>From <input type="time" data-range-start /></label>
        <label>To <input type="time" data-range-end /></label>
        <button type="button" data-action="avail-add-range" data-weekday="${esc(day.key)}">Add this time</button>
      </div>`;
  }
  return `<section class="avail-day" data-weekday="${esc(day.key)}">
      <h3>${esc(day.label)}</h3>
      <label class="avail-mode">Usual ${esc(day.label)}
        <select data-avail-mode="${esc(day.key)}">${options}</select>
      </label>
      ${detail}
      <label class="avail-note-label">Note
        <input data-weekday-note="${esc(day.key)}" maxlength="80" value="${esc(entry.note)}" placeholder="Optional, such as after the PM route" />
      </label>
    </section>`;
}

function exceptionBlock(row) {
  const locked = dayIsClosed(row.date);
  const when = row.open ? OPEN_MIDDAY_LABEL : row.ranges.length ? row.ranges.map(formatRange).join(', ') : 'Not available';
  const remove = locked
    ? ''
    : `<button type="button" class="avail-remove" data-action="avail-remove-exception" data-date="${esc(row.date)}">Remove</button>`;
  const note = locked
    ? row.note
      ? `<p class="avail-note">${esc(row.note)}</p>`
      : ''
    : `<label class="avail-note-label">Note
        <input data-exception-note maxlength="80" value="${esc(row.note)}" placeholder="Optional, such as a day off" />
      </label>`;
  return `<li class="avail-exception" data-exception data-date="${esc(row.date)}">
      <div class="avail-exception-head"><strong>${esc(dayHeading(row.date))}</strong>${remove}</div>
      <p>${esc(when)}</p>
      ${note}
      ${locked ? '<p class="avail-note">Interest for this day closed at 8:00.</p>' : ''}
    </li>`;
}

function exceptionComposer() {
  const draft = state.availExceptionDraft || { date: '', ranges: [], note: '', kind: 'times' };
  const kind = draft.kind === 'open' || draft.kind === 'off' ? draft.kind : 'times';
  const times =
    kind === 'open'
      ? `<p class="avail-note">${esc(OPEN_MIDDAY_LABEL)}. Any late addition this date counts. The times are not limited.</p>`
      : kind === 'off'
        ? '<p class="avail-note">This date will be not available, even if that weekday usually is.</p>'
        : `${
            draft.ranges.length
              ? `<ul class="avail-times">${rangeItems(draft.ranges, 'avail-remove-composer-range')}</ul>`
              : ''
          }<div class="avail-add">
        <label>From <input type="time" data-range-start /></label>
        <label>To <input type="time" data-range-end /></label>
        <button type="button" data-action="avail-add-exception-range">Add this time</button>
      </div>`;
  return `<section class="avail-composer">
      <h3>Add an exception</h3>
      <label class="avail-note-label">Date
        <input type="date" data-ex-date value="${esc(draft.date)}" />
      </label>
      <label class="avail-mode">This date
        <select data-ex-kind>
          <option value="times"${kind === 'times' ? ' selected' : ''}>Different times</option>
          <option value="open"${kind === 'open' ? ' selected' : ''}>${esc(OPEN_MIDDAY_LABEL)}</option>
          <option value="off"${kind === 'off' ? ' selected' : ''}>Not available</option>
        </select>
      </label>
      ${times}
      <label class="avail-note-label">Note
        <input data-ex-note maxlength="80" value="${esc(draft.note)}" placeholder="Optional, such as an appointment or a day off" />
      </label>
      <button type="button" data-action="avail-add-exception">Add this date</button>
    </section>`;
}

function availabilityDialogMarkup() {
  const error = dialogError();
  const seeded = state.availSeeded
    ? '<p class="avail-note">Dates you already marked are listed as exceptions. Saving keeps those dates and uses the usual week for every other open day.</p>'
    : '';
  const exceptions = state.availDraft.exceptions.length
    ? `<ul class="avail-exceptions">${state.availDraft.exceptions.map((row) => exceptionBlock(row)).join('')}</ul>`
    : '<p class="avail-note">No exceptions yet.</p>';
  return `<p>The usual week repeats. An exception replaces one date. Totally open on my mid-day counts for any late addition and does not limit the times. The office uses this for late additions. Seniority and overtime still decide the work. A note is only for you. A day already closed at 8:00 keeps what it had.</p>
    <p class="avail-resolved">${esc(draftPreview(state.availFocusDate))}</p>
    ${seeded}
    ${error ? `<p class="avail-error">${esc(error)}</p>` : ''}
    <h3 class="avail-section-title">Usual week</h3>
    ${AVAIL_WEEKDAYS.map((day) => weekdayBlock(day)).join('')}
    <h3 class="avail-section-title">Exceptions</h3>
    <p class="avail-note">Use an exception for a day off, a totally open mid-day, or one date that is not the usual weekday.</p>
    ${exceptions}
    ${exceptionComposer()}
    <div class="avail-actions">
      <button type="button" class="primary" data-action="avail-save"${error && sameAsCycle(state.availDraft.weekdays) ? ' disabled' : ''}>Save availability</button>
    </div>`;
}

function ensureAvailabilityDialog() {
  let dialog = document.getElementById('avail-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'avail-dialog';
  dialog.className = 'info-dialog avail-dialog';
  dialog.setAttribute('aria-labelledby', 'avail-dialog-title');
  dialog.innerHTML = `<form>
      <header class="info-dialog-bar">
        <h2 id="avail-dialog-title">${availabilityGlyph()}<span>Availability</span></h2>
        <button type="button" data-action="avail-close">Close</button>
      </header>
      <div id="avail-dialog-body" class="info-dialog-body"></div>
    </form>`;
  dialog.querySelector('form').addEventListener('submit', (event) => event.preventDefault());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    state.availDraft = null;
    state.availExceptionDraft = null;
    state.availError = '';
    state.availSeeded = false;
  });
  document.body.appendChild(dialog);
  return dialog;
}

function renderAvailabilityDialog() {
  if (!state.availDraft) return;
  const dialog = ensureAvailabilityDialog();
  const body = dialog.querySelector('#avail-dialog-body');
  const scroll = body.scrollTop;
  body.innerHTML = availabilityDialogMarkup();
  body.scrollTop = scroll;
  if (!dialog.open) dialog.showModal();
}

function openAvailabilitySettings(date) {
  if (!state.signedIn) {
    if (state.officePinMiss) setStatus('That PIN is not on the office driver list.', true);
    else if (phoneView || fromDriver) sendToDriverDashboard();
    else setStatus('Enter your PIN on the driver dashboard before you set availability.', true);
    return;
  }
  const focus = date || localToday();
  state.availFocusDate = focus;
  state.availDraft = availabilityDraftFromState();
  state.availSeeded = !state.mySchedule && state.availDraft.exceptions.length > 0;
  state.availExceptionDraft = freshExceptionDraft(focus, state.availDraft.exceptions);
  state.availError = '';
  renderAvailabilityDialog();
}

function captureAvailEditor() {
  const root = document.getElementById('avail-dialog');
  if (!root || !state.availDraft) return;
  for (const day of AVAIL_WEEKDAYS) {
    const note = root.querySelector(`[data-weekday-note="${day.key}"]`);
    if (note) state.availDraft.weekdays[day.key].note = note.value.slice(0, 80);
  }
  for (const row of root.querySelectorAll('[data-exception]')) {
    const found = state.availDraft.exceptions.find((item) => item.date === row.dataset.date);
    const note = row.querySelector('[data-exception-note]');
    if (found && note && !dayIsClosed(found.date)) found.note = note.value.slice(0, 80);
  }
  const composer = state.availExceptionDraft;
  if (!composer) return;
  const date = root.querySelector('[data-ex-date]');
  const note = root.querySelector('[data-ex-note]');
  const kind = root.querySelector('[data-ex-kind]');
  if (date) composer.date = date.value;
  if (note) composer.note = note.value.slice(0, 80);
  if (kind) composer.kind = kind.value === 'open' || kind.value === 'off' ? kind.value : 'times';
}

function applyAvailMode(select) {
  captureAvailEditor();
  const entry = state.availDraft?.weekdays?.[select.dataset.availMode];
  if (!entry) return;
  const value = select.value;
  if (value === 'open') {
    entry.mode = 'open';
    entry.open = true;
    entry.same_as = '';
    entry.ranges = [];
  } else if (value === 'times') {
    entry.mode = 'times';
    entry.open = false;
    entry.same_as = '';
  } else if (value.startsWith('same:')) {
    entry.mode = 'same';
    entry.open = false;
    entry.same_as = value.slice(5);
    entry.ranges = [];
  } else {
    entry.mode = 'off';
    entry.open = false;
    entry.same_as = '';
    entry.ranges = [];
  }
  state.availError = '';
  renderAvailabilityDialog();
}

function addWeekdayRange(key, section) {
  captureAvailEditor();
  const entry = state.availDraft?.weekdays?.[key];
  if (!entry || entry.mode !== 'times') return;
  const start = section?.querySelector('[data-range-start]')?.value || '';
  const end = section?.querySelector('[data-range-end]')?.value || '';
  const next = normalizeTimeRanges([...entry.ranges, { start, end }]);
  if (next.length === entry.ranges.length) {
    state.availError = 'Enter a start time and a later end time.';
    renderAvailabilityDialog();
    return;
  }
  entry.ranges = next;
  entry.same_as = '';
  state.availError = '';
  renderAvailabilityDialog();
}

function addComposerRange(section) {
  captureAvailEditor();
  const draft = state.availExceptionDraft;
  if (!draft || draft.kind === 'off' || draft.kind === 'open') return;
  const start = section?.querySelector('[data-range-start]')?.value || '';
  const end = section?.querySelector('[data-range-end]')?.value || '';
  const next = normalizeTimeRanges([...draft.ranges, { start, end }]);
  if (next.length === draft.ranges.length) {
    state.availError = 'Enter a start time and a later end time.';
    renderAvailabilityDialog();
    return;
  }
  draft.ranges = next;
  state.availError = '';
  renderAvailabilityDialog();
}

function commitException() {
  captureAvailEditor();
  const draft = state.availExceptionDraft;
  if (!draft || !state.availDraft) return;
  const date = String(draft.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    state.availError = 'Choose the date for this exception.';
    renderAvailabilityDialog();
    return;
  }
  if (dayIsClosed(date)) {
    state.availError = 'Interest for this day was marked before 8:00.';
    renderAvailabilityDialog();
    return;
  }
  const kind = draft.kind === 'open' || draft.kind === 'off' ? draft.kind : 'times';
  const ranges = kind === 'times' ? normalizeTimeRanges(draft.ranges) : [];
  if (kind === 'times' && !ranges.length) {
    state.availError = 'Add a time, or choose totally open or not available.';
    renderAvailabilityDialog();
    return;
  }
  const rest = state.availDraft.exceptions.filter((row) => row.date !== date && !dayIsClosed(row.date));
  const locked = state.availDraft.exceptions.filter((row) => dayIsClosed(row.date) && row.date !== date);
  state.availDraft.exceptions = [
    ...locked,
    ...rest,
    { date, ranges, note: draft.note || '', open: kind === 'open' },
  ].sort((a, b) => a.date.localeCompare(b.date));
  state.availExceptionDraft = freshExceptionDraft('', state.availDraft.exceptions);
  state.availError = '';
  renderAvailabilityDialog();
}

function removeException(date) {
  captureAvailEditor();
  if (!state.availDraft || dayIsClosed(date)) return;
  state.availDraft.exceptions = state.availDraft.exceptions.filter((row) => row.date !== date);
  state.availError = '';
  renderAvailabilityDialog();
}

async function saveAvailabilitySettings() {
  captureAvailEditor();
  if (!state.availDraft) return;
  if (sameAsCycle(state.availDraft.weekdays)) {
    state.availError = 'One weekday cannot follow another in a circle.';
    renderAvailabilityDialog();
    return;
  }
  const weekdays = {};
  for (const day of AVAIL_WEEKDAYS) weekdays[day.key] = weekdayPayload(state.availDraft.weekdays[day.key]);
  const exceptions = state.availDraft.exceptions.map((row) => ({
    date: row.date,
    ranges: row.open ? [] : normalizeTimeRanges(row.ranges),
    note: row.note || '',
    open: row.open === true,
  }));
  await api('/api/extra-work/availability-schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekdays, exceptions }),
  });
  await load();
  document.getElementById('avail-dialog')?.close();
  setStatus('Availability saved.');
}

function renderLateInterest() {
  const host = document.getElementById('late-interest');
  if (!host) return;
  const posting = state.selectedId === 'new' ? blankPosting() : selectedPosting();
  if (!posting?.late_addition) {
    host.innerHTML = '';
    return;
  }
  const form = document.getElementById('trip-form');
  const data = form ? new FormData(form) : null;
  const date = data ? String(data.get('trip_date') || '') : posting.trip_date;
  const times = {};
  for (const key of TIME_FIELDS) times[key] = data ? String(data.get(key) || '') : posting.times?.[key] || '';
  const interval = tripInterval(times);
  if (!date) {
    host.innerHTML = '<section class="late-list"><h2>Set availability</h2><p>Enter the trip date.</p></section>';
    return;
  }
  const roster = availabilityRoster(date, true);
  if (!interval) {
    host.innerHTML = `${roster}<section class="late-list"><h2>Who covers this job</h2><p>Enter a start and end time. The suggestion uses drivers who set availability for that time.</p></section>`;
    return;
  }
  const rows = lateInterestList({
    drivers: state.drivers,
    marks: state.availability,
    date,
    interval,
  });
  const number = data ? String(data.get('trip_number') || '') : posting.trip_number;
  const probe = {
    ...posting,
    id: posting.id || 'late-probe',
    status: 'posted',
    late_addition: false,
    list: 'daily',
    trip_date: date,
    trip_number: number || 'late',
    times,
    out_of_town: data ? data.get('out_of_town') === 'on' : Boolean(posting.out_of_town),
    bids: rows.map((row) => ({
      driver_id: row.driver.driver_id,
      preference: number || 'late',
      signed_at: '2026-10-26T14:00:00.000Z',
    })),
  };
  const plan = rows.length
    ? planDailyAwards({
        postings: [probe],
        drivers: state.drivers,
        schedules: state.schedules,
        extraBars: weeklyBusyBars([...(state.postings || []), ...(state.heldWork || [])], date),
        date,
      })
    : null;
  const suggestion = plan?.trips?.[0] || null;
  const canAward = Boolean(posting.id) && posting.status === 'posted';
  const items = rows
    .map(({ driver, ranges, open }) => {
      const hired = driver.hire_date ? `, hired ${formatSheetDate(driver.hire_date)}` : '';
      const when = open ? OPEN_MIDDAY_LABEL : ranges.map((range) => formatRange(range)).filter(Boolean).join(', ');
      const winner = posting.awarded_driver_id === driver.driver_id;
      const suggested = suggestion?.winner?.driver_id === driver.driver_id && !winner;
      const button = winner
        ? '<span class="suggest-tag">Got the trip</span>'
        : canAward
          ? `<button type="button" class="mini-btn" data-action="award" data-driver-id="${esc(driver.driver_id)}">Award</button>`
          : '';
      const tag = suggested ? ' <span class="suggest-tag">Suggestion</span>' : '';
      const rank = driver.seniority_rank == null ? '—' : String(driver.seniority_rank);
      return `<li><span><strong>${esc(rank)}</strong> ${esc(driver.name)}${esc(hired)}${tag} <span class="avail-note">${esc(when)}</span></span> ${button}</li>`;
    })
    .join('');
  const outside = (state.availability || [])
    .filter((mark) => mark?.date === date && !rows.some((row) => row.driver.driver_id === mark.driver_id))
    .map((mark) => {
      const driver = state.drivers.find((row) => row.driver_id === mark.driver_id);
      const when = mark.open
        ? OPEN_MIDDAY_LABEL
        : normalizeTimeRanges(mark.ranges)
            .map((range) => formatRange(range))
            .join(', ');
      return driver ? `${driver.name} marked ${when}` : '';
    })
    .filter(Boolean);
  const why = suggestion?.winner
    ? suggestion.winner.reason
    : rows.length
      ? noWinnerText(suggestion)
      : '';
  const pending = canAward || posting.status === 'awarded' ? '' : '<p>Save and post the sheet to award a driver from this list.</p>';
  const walk = suggestion?.steps?.length ? awardWalkMarkup(suggestion.steps) : '';
  host.innerHTML = `${roster}<section class="late-list"><h2>Marked this time</h2>${
    items
      ? `<ol>${items}</ol>${why ? `<p>${esc(why)}</p>` : ''}${walk}`
      : '<p>No driver marked this time. Offer it by radio, then to a substitute.</p>'
  }${
    outside.length ? `<p class="avail-note">Marked other times today: ${esc(outside.join('; '))}.</p>` : ''
  }${pending}</section>`;
}

function blankPosting() {
  return {
    id: '',
    status: 'draft',
    trip_number: '',
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
    out_of_town: false,
    late_addition: Boolean(state.lateDraft),
    trip_date: state.lateDraft
      ? state.dailyDay || localToday()
      : boardList === 'weekly' && officeDesk
        ? defaultWeeklyDate()
        : boardList === 'daily' && officeDesk
          ? state.dailyDay || localToday()
          : boardList === 'roster' && officeDesk
            ? state.dailyDay || localToday()
            : '',
    list: boardList === 'roster' ? 'roster' : boardList === 'weekly' ? 'weekly' : 'daily',
    awarded_driver_id: null,
  };
}

function awardPlanFor(date) {
  if (state.mode !== 'office' || boardList === 'roster' || !date) return null;
  return planDailyAwards({
    postings: state.postings.filter(
      (row) => postingList(row) === (boardList === 'weekly' ? 'weekly' : 'daily') && !row.late_addition
    ),
    drivers: state.drivers,
    schedules: state.schedules,
    extraBars: boardList === 'daily' ? weeklyBusyBars(state.postings, date) : [],
    date,
  });
}

function dayIsClosed(date) {
  if (boardList === 'roster') return false;
  return (state.closedDays || []).some((row) => row.date === date);
}

function awardLogicMarkup(posting) {
  if (state.mode !== 'office' || boardList === 'roster') return '';
  const date = posting?.trip_date || '';
  if (!date) return '';
  if (boardList === 'weekly') return `<div class="week-admin-tools">${weeklyRuleButtons()}</div>`;
  const plan = awardPlanFor(date);
  if (!plan?.trips.length) return '';
  const heading = `${sheetWeekday(date) || ''} ${formatSheetDate(date)}`.trim();
  const rows = plan.trips
    .map((trip) => {
      const who = trip.winner
        ? `${trip.winner.seniority_rank ?? '—'} · ${rosterName(trip.winner.name)}${trip.winner.hire_date ? `, hired ${formatSheetDate(trip.winner.hire_date)}` : ''}`
        : 'Nobody got this trip';
      const why = trip.winner ? trip.winner.reason : noWinnerText(trip);
      return `<tr class="${trip.id === posting.id ? 'is-current' : ''}">
        <td><strong>#${esc(trip.trip_number || 'Trip')}</strong> ${esc([trip.school, trip.destination].filter(Boolean).join(' → '))}</td>
        <td class="num">${esc(trip.signup_count)}</td>
        <td>${esc(who)}</td>
        <td>${esc(why)}</td>
      </tr>`;
    })
    .join('');
  const focus = plan.trips.find((trip) => trip.id === posting.id);
  const walk = focus
    ? `<h3>Who got trip #${esc(focus.trip_number || 'this trip')}</h3>${awardWalkMarkup(focus.steps)}`
    : '';
  const hoursNote = plan.drivers.length
    ? plan.mixed_hours
      ? ' A utility driver is offered the work first, up to 40 hours.'
      : ' No utility driver signed up.'
    : '';
  const closed = dayIsClosed(date);
  const results = `<table class="award-table">
      <thead>
        <tr><th>Trip</th><th>Signed</th><th>${closed ? 'Got the trip' : 'Suggestion'}</th><th>Why</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${walk}
    ${
      closed
        ? ''
        : `<p class="award-empty">This is the suggestion. Sign-up stays open until 8:00 a.m., or until you close it. Closing the day awards these suggestions.</p>
      <button type="button" class="primary" data-action="close-day" data-date="${esc(date)}">Close offerings</button>`
    }`;
  return `<section class="award-logic">
    <h2>${closed ? `Who got the trips on ${esc(heading)}` : `Suggestion for ${esc(heading)}`}</h2>
    <p>Post the work by 6:15 a.m. Drivers sign by 8:00 a.m. At 8:00 a.m. that day is awarded. You can close it sooner. The seniority number is the office list. The request is the order the driver wrote.${esc(hoursNote)} No parentheses means one trip, the first choice that fits. Parentheses means every trip in that group that fits. After the utility driver, the trip goes to the most senior driver who can finish it with the regular runs and no overtime. If nobody can, it goes to the least overtime, up to one hour. A trip of 3.5 hours or more that leaves town goes by seniority even with overtime, and a midday that it crosses comes off that route. A trip that crosses an AM or PM run stays with that run. Work nobody can take goes to a substitute.</p>
    ${results}
  </section>`;
}

function suggestedDriverId(posting) {
  if (!posting?.id) return '';
  return awardPlanFor(posting.trip_date)?.trips.find((trip) => trip.id === posting.id)?.winner?.driver_id || '';
}

function signupsTable(posting) {
  const bids = [...(posting.bids || [])].sort((a, b) => {
    const rank = (id) => state.drivers.find((driver) => driver.driver_id === id)?.seniority_rank ?? 9999;
    return rank(a.driver_id) - rank(b.driver_id);
  });
  if (!bids.length) return '';
  const suggestedId = suggestedDriverId(posting);
  const rows = bids
    .map((bid) => {
      const driver = state.drivers.find((row) => row.driver_id === bid.driver_id) || {
        driver_id: bid.driver_id,
        name: bid.driver_id,
        seniority_rank: '',
      };
      return `<tr>${rosterCells(driver, posting, suggestedId)}</tr>`;
    })
    .join('');
  return `<table class="roster">
    <thead>
      <tr>
        <th>Seniority</th>
        <th>Driver</th>
        <th>Request</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function rosterCells(driver, posting, suggestedId) {
  const rank = driver.seniority_rank ?? '';
  const winner = posting.awarded_driver_id === driver.driver_id;
  const suggested = suggestedId === driver.driver_id && !winner;
  const hired = driver.hire_date ? formatSheetDate(driver.hire_date) : '';
  const bid = (posting.bids || []).find((row) => row.driver_id === driver.driver_id);
  return `<td class="num">${esc(rank)}${hired ? `<span class="hired">hired ${esc(hired)}</span>` : ''}</td>
    <td class="who${winner ? ' is-winner' : ''}${suggested ? ' is-suggested' : ''}">${esc(rosterName(driver.name))}${suggested ? ' <span class="suggest-tag">Got the trip</span>' : ''}</td>
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
    const daySelect = form.querySelector('[data-sheet-day]');
    if (date && daySelect && document.activeElement !== daySelect) {
      daySelect.value = sheetWeekday(date.value);
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
  form.querySelector('[data-sheet-day]')?.addEventListener('change', (event) => {
    const date = form.querySelector('[name="trip_date"]');
    if (!(date instanceof HTMLInputElement)) return;
    date.value = dateForWeekday(date.value, event.target.value);
    state.dirty = true;
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
    out_of_town: data.get('out_of_town') === 'on',
    list: boardList === 'roster' ? 'roster' : boardList === 'weekly' ? 'weekly' : 'daily',
    late_addition: state.selectedId === 'new' ? Boolean(state.lateDraft) : Boolean(selectedPosting()?.late_addition),
  };
}

function renderSide() {
  const side = $('board-side');
  const postings = visiblePostings();
  const items =
    state.mode === 'driver'
      ? `<p class="side-note">The chart shows posted trips next to your regular runs. Other drivers' initials stay on the office sheet.</p>`
      : weeklyOfficeTable() || dailyOfficeTable() || rosterOfficeTable() || (officeDesk && (boardList === 'weekly' || boardList === 'daily' || boardList === 'roster'))
        ? ''
      : postings
          .map((posting) => {
            const title = posting.trip_number ? `Trip #${posting.trip_number}` : 'Untitled sheet';
            const when = formatSheetDate(posting.trip_date) || 'No date';
            const place = posting.destination || posting.school || '';
            const signed = (posting.bids || []).length;
            const closed = dayIsClosed(posting.trip_date);
            const winner = directoryPerson(posting.awarded_driver_id);
            const signupNote = (posting.late_addition
              ? [
                  'Late addition',
                  posting.status === 'awarded' && winner
                    ? `seniority ${winner.seniority_rank} ${givenName(winner.name)} got it`
                    : '',
                ]
              : [
                  signed ? `${signed} signed` : 'No signups',
                  posting.status === 'awarded' && winner
                    ? `seniority ${winner.seniority_rank} ${givenName(winner.name)} got it`
                    : closed
                      ? 'Closed'
                      : '',
                ]
            )
              .filter(Boolean)
              .join(' · ');
            return `<button type="button" class="sheet-link${posting.id === state.selectedId ? ' is-on' : ''}" data-action="select" data-id="${esc(posting.id)}">
        <strong>${esc(title)}</strong>
        <span>${esc(when)}${place ? ` · ${esc(place)}` : ''} · ${esc(signupNote)}</span>
      </button>`;
          })
          .join('') || '<p class="side-note">No sheets on this board yet.</p>';
  const create =
    state.mode === 'office' && !(officeDesk && (boardList === 'weekly' || boardList === 'daily' || boardList === 'roster'))
      ? `<button type="button" class="side-btn" data-action="new">New trip sheet</button>`
      : '';
  const mail =
    state.mode === 'office' && !(officeDesk && (boardList === 'weekly' || boardList === 'daily' || boardList === 'roster'))
      ? state.postings
          .filter((posting) => posting.winner_email && (!boardList || postingList(posting) === boardList))
          .map((posting) => {
            const email = posting.winner_email;
            const winner = directoryPerson(posting.awarded_driver_id);
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
      ? boardList === 'weekly'
        ? `<details class="directions">
          <summary>Sign-up directions</summary>
          <p>Click WANT to choose a trip. Click that button again to un-click it. Click it once more and it goes to the end.</p>
          <p>I want anything that fits gives you every wanted trip that fits, in that order. Then submit.</p>
        </details>`
        : boardList === 'roster'
          ? `<details class="directions">
          <summary>Sign-up directions</summary>
          <p>Turn sideways. Blue is your free mid-day time. Navy is the roster trip. Tap WANT in the order you want the evening, weekend, or mountain trips.</p>
          <p>Tap a numbered WANT to take it off. Tap it again and it goes to the end. I want anything that fits gives you every wanted trip that fits, in that order. Then submit.</p>
        </details>`
        : `<details class="directions" open>
          <summary>Sign-up directions</summary>
          <p>Click a trip to add it. Drag a row, or use Up and Down, so your first choice is on top.</p>
          <p>Only one gives you the highest trip that fits. As many as fit gives you every trip in the first list that fits, then the second list. That order is your request. The office still awards by seniority and overtime.</p>
          <p>A warning means the trip crosses a regular run. You can still keep it if that run is changed for the day. The hours under the list include your regular runs.</p>
        </details>`
      : boardList === 'daily'
        ? `<details class="directions">
            <summary>Daily assignment rules</summary>
            <p>Post available work by 6:15 a.m. Drivers sign by 8:00 a.m. A signup is a commitment. At 8:00 a.m. that day is awarded. You can close it sooner. A driver who is already on the road before 6:15 may call so the office can add that name.</p>
            <p>Offer the utility driver the work first, up to 40 contracted hours. Then the most senior driver who can finish the trip with the regular runs and no overtime, or the least overtime up to one hour. A field trip of 3.5 hours or more that leaves town goes by seniority even with overtime. Mark Leaves town on that sheet. The midday it crosses comes off the route and is posted here. Checking Leaves town on a shorter trip does not change the rule.</p>
            <p>Between 6:15 and 8:00, announce new work by radio so drivers can still sign. After 8:00, assign it to drivers who marked the times they can take. Use the same rule. Then offer it by radio, then to a substitute. Assignments that send a driver straight to the next run are announced by radio. Other awards can be read on the board after 8:45.</p>
          </details>`
        : '';
  side.innerHTML = `${create}
    ${items}
    ${mail}
    ${directions}`;
  const deskHome = officeDesk && (boardList === 'weekly' || boardList === 'daily' || boardList === 'roster');
  side.hidden = deskHome;
}

function renderIdentity() {
  const who = $('whoami');
  const bell = $('notice-bell');
  const driver = state.drivers.find((row) => row.driver_id === state.driverId);
  const show = state.signedIn && driver && (state.mode === 'driver' || onWeekWall());
  who.hidden = !show;
  bell.hidden = !show;
  $('whoami-name').textContent = driver ? driver.name : '';
  const unread = unreadNotices().length;
  const count = $('notice-count');
  count.textContent = String(unread);
  count.classList.toggle('is-zero', unread === 0);
}

function driverDashHref() {
  const tab = boardList === 'roster' ? 'roster' : boardList === 'weekly' ? 'weekly' : 'daily';
  const params = new URLSearchParams({ tab });
  if (boardList === 'weekly' && /^\d{4}-\d{2}-\d{2}$/.test(state.weekStart || '')) {
    params.set('week', state.weekStart);
  }
  return `/driver?${params}`;
}

function sendToDriverDashboard() {
  const next = `${location.pathname}${location.search}`;
  const dest = `/driver?next=${encodeURIComponent(next)}`;
  if (window.top !== window) window.top.location.replace(dest);
  else location.replace(dest);
}

function renderPinDock() {
  const dock = $('pin-dock');
  if (!dock) return;
  dock.hidden = true;
  dock.classList.remove('is-weekly-pin');
  dock.innerHTML = '';
}

async function submitPin(driverId = '') {
  if (!/^\d{4}$/.test(state.pinDigits)) {
    state.pinError = 'Enter all 4 digits.';
    renderPinDock();
    return;
  }
  try {
    const result = await api('/api/extra-work/enter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: state.pinDigits,
        ...(driverId ? { driver_id: driverId } : {}),
      }),
    });
    if (result.matches) {
      state.pinMatches = result.matches;
      state.pinError = '';
      renderPinDock();
      return;
    }
    state.pinDigits = '';
    state.pinMatches = [];
    state.pinError = '';
    state.dayBids = {};
    state.shown.clear();
    await load();
    if (!state.signedIn) await load();
  } catch (error) {
    state.pinError = error.message;
    state.pinMatches = [];
    renderPinDock();
  }
}

async function leaveBoard() {
  try {
    await api('/api/extra-work/leave', { method: 'POST' });
  } catch (error) {
    setStatus(error.message, true);
  }
  state.driverId = '';
  state.signedIn = false;
  state.pinDigits = '';
  state.pinMatches = [];
  state.pinError = '';
  state.dayBids = {};
  state.shown.clear();
  await load();
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
      : '<p>No notices yet.</p>'
  }`;
}

function showNewToasts() {
  // Dashboard sheets already show the posted and awarded work.
  if (fromDriver) return;
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
      body: '{}',
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

async function loadRouteNotes(officeNotes) {
  const notes = {};
  try {
    const response = await fetch('/board/routeNotes.json', { cache: 'no-store' });
    if (response.ok) Object.assign(notes, await response.json());
  } catch {
    // Free time still draws when the school list cannot be read.
  }
  if (officeNotes && typeof officeNotes === 'object') {
    for (const [routeId, note] of Object.entries(officeNotes)) {
      const name = String(routeId || '').trim();
      const text = String(note || '').trim();
      if (name && text) notes[name] = text;
    }
  }
  try {
    const raw = localStorage.getItem('transportation-timechange.v1');
    const profiles = raw ? JSON.parse(raw).profiles : null;
    for (const profile of Object.values(profiles || {})) {
      const name = String(profile?.name || '').trim();
      const note = String(profile?.note || '').trim();
      if (name && note) notes[name] = note;
    }
  } catch {
    // A missing office list leaves the saved route notes in place.
  }
  return notes;
}

async function load({ keepSheet = false } = {}) {
  const sheet = boardList === 'roster' ? 'roster' : boardList === 'weekly' ? 'weekly' : 'daily';
  let data;
  if (onWeekWall()) {
    try {
      data = await api(`/api/extra-work/mine?sheet=${sheet}`);
      state.signedIn = true;
    } catch (error) {
      if (error.status !== 401) throw error;
      const notOnList = /not on the office driver list/i.test(error.message);
      if (notOnList) state.officePinMiss = true;
      if (phoneView && !notOnList && !state.officePinMiss) {
        sendToDriverDashboard();
        return;
      }
      data = await api(`/api/extra-work/board?sheet=${sheet}`);
      state.signedIn = false;
      state.driverId = '';
      if (state.officePinMiss) setStatus('That PIN is not on the office driver list.', true);
    }
  } else {
    data = await api('/api/extra-work');
    state.signedIn = false;
  }
  state.postings = data.postings || [];
  state.notifications = data.notifications || [];
  state.closedDays = data.closed_days || [];
  state.availability = data.availability || [];
  state.myAvailability = data.my_availability || [];
  state.mySchedule = data.my_schedule || null;
  state.heldWork = data.held_work || [];
  state.drivers = data.drivers || [];
  state.substitutes = data.substitutes || [];
  state.schedules = data.schedules || [];
  state.routeNotes = await loadRouteNotes(data.route_notes);
  if (onWeekWall() && state.signedIn) {
    state.driverId = state.drivers[0]?.driver_id || '';
  }
  const visible = visiblePostings();
  if (officeDesk && (boardList === 'weekly' || boardList === 'daily' || boardList === 'roster') && !state.weeklyEntry) {
    state.selectedId = null;
  } else if (state.selectedId === 'new') {
    // keep the unsaved sheet
  } else if (!visible.some((row) => row.id === state.selectedId)) {
    state.selectedId = visible[0]?.id || null;
  }
  renderSide();
  renderIdentity();
  renderBoardViewToggle();
  renderNotices();
  if (!keepSheet || !state.dirty) renderSheet();
  showNewToasts();
  const status = $('sheet-status');
  if (!state.status) status.textContent = '';
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
  if (officeDesk && boardList === 'weekly') {
    state.weeklyEntry = false;
    state.weeklyWeek = weekKeyForDate(result.posting?.trip_date || '');
    state.weeklyDay = result.posting?.trip_date || state.weeklyDay;
    state.selectedId = null;
  }
  if (officeDesk && (boardList === 'daily' || boardList === 'roster')) {
    state.weeklyEntry = false;
    state.lateDraft = false;
    state.dailyDay = result.posting?.trip_date || state.dailyDay;
    state.dailyChoseAll = false;
    state.selectedId = null;
  }
  setStatus('Posted. Drivers get a notice on this board.');
  await load();
}

async function signSheet() {
  if (!state.driverId) {
    setStatus('Enter your PIN before you sign.', true);
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
    if (phoneView || fromDriver) {
      sendToDriverDashboard();
      return;
    }
    setStatus('Enter your PIN on the driver dashboard before you submit.', true);
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

async function closeDay(date) {
  const heading = `${sheetWeekday(date) || ''} ${formatSheetDate(date)}`.trim();
  const ok = window.confirm(
    `Close sign-up for ${heading} and award the trips from the requests and seniority numbers? Drivers cannot change a signup after this.`
  );
  if (!ok) return;
  const result = await api('/api/extra-work/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
  });
  const names = (result.awarded || []).map((row) => `${row.trip_number} ${givenName(row.name)}`).join(', ');
  const left = (result.left_open || []).length
    ? ` No driver got ${(result.left_open || []).join(', ')}.`
    : '';
  setStatus(names ? `Offerings closed. ${names} got the trips.${left}` : `Offerings closed.${left}`);
  await load();
}

async function awardChosen(postingId, driverId, asSubstitute = false) {
  const driver = directoryPerson(driverId);
  const posting = state.postings.find((row) => row.id === postingId) || selectedPosting();
  if (!posting || !driver) {
    setStatus(asSubstitute ? 'Choose a substitute driver.' : 'Choose a driver who signed this trip.', true);
    return;
  }
  const number = posting.trip_number ? `#${posting.trip_number} ` : '';
  const ok = window.confirm(
    `Assign ${number}to ${driver.name}? The email to the winner will open for you to send.`
  );
  if (!ok) return;
  const result = await api(`/api/extra-work/${posting.id}/award`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driver_id: driverId }),
  });
  state.dirty = false;
  state.selectedId = posting.id;
  if (result.email?.mailto_url) {
    openMailto(result.email.mailto_url);
    setStatus(`Email to ${givenName(driver.name)} is open. Send it from your mail app.`);
  } else {
    setStatus(result.email?.disabled_reason || 'The assignment is on the sheet.', true);
  }
  await load();
}

async function awardWeekly(postingId, driverId) {
  const driver = directoryPerson(driverId);
  const posting = state.postings.find((row) => row.id === postingId);
  if (!posting) return;
  if (!driver) {
    setStatus('Choose a driver who signed this trip.', true);
    return;
  }
  const number = posting.trip_number ? `#${posting.trip_number} ` : '';
  const ok = window.confirm(
    `Assign ${number}to ${driver.name}? The email to the winner will open for you to send.`
  );
  if (!ok) return;
  const result = await api(`/api/extra-work/${posting.id}/award`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driver_id: driverId }),
  });
  state.dirty = false;
  state.weeklyEntry = false;
  state.selectedId = null;
  if (posting.trip_date) {
    state.weeklyWeek = weekKeyForDate(posting.trip_date);
    state.weeklyDay = posting.trip_date;
  }
  if (result.email?.mailto_url) {
    openMailto(result.email.mailto_url);
    setStatus(`Email to ${givenName(driver.name)} is open. Send it from your mail app.`);
  } else {
    setStatus(result.email?.disabled_reason || 'The assignment is on the sheet.', true);
  }
  await load();
}

async function award(driverId) {
  const driver = directoryPerson(driverId);
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

document.body.addEventListener('input', (event) => {
  if (!event.target.closest?.('#trip-form') || !document.getElementById('late-interest')) return;
  state.dirty = true;
  renderLateInterest();
});

document.body.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === 'new') {
      state.selectedId = 'new';
      state.lateDraft = false;
      state.weeklyEntry = true;
      state.dirty = true;
      state.mode = 'office';
      setStatus('');
      renderSide();
      renderSheet();
      return;
    }
    if (action === 'info-pop') {
      openWeeklyInfo(button.dataset.info || '', button.dataset.why || '', button.dataset.id || '');
      return;
    }
    if (action === 'open-postings') {
      await openWeeklyPostingsDisplay();
      return;
    }
    if (action === 'print-postings') {
      state.postingPrint = true;
      await loadShareUrl();
      renderSide();
      renderSheet();
      scrollBoardTop();
      return;
    }
    if (action === 'print-close') {
      state.postingPrint = false;
      document.body.classList.remove('is-hall-print');
      hallPageStyle(false);
      renderSide();
      renderSheet();
      scrollBoardTop();
      return;
    }
    if (action === 'print-now') {
      const stamp = document.querySelector('.hall-printed');
      if (stamp) stamp.textContent = `Printed ${printedAt()}`;
      window.print();
      return;
    }
    if (action === 'phone-day' && button.tagName === 'BUTTON') {
      state.phoneDate = button.dataset.date || state.phoneDate;
      renderWeeklyPhone();
      return;
    }
    if (action === 'weekly-day') {
      const date = button.dataset.date || '';
      if (!date) return;
      const dir = button.dataset.dir || '';
      state.weeklyDay = date;
      state.weeklyEntry = false;
      state.selectedId = null;
      state.dirty = false;
      setStatus('');
      renderSide();
      renderSheet();
      scrollBoardTop();
      focusDayCarousel(dir);
      return;
    }
    if (action === 'weekly-days') {
      state.weeklyDay = '';
      setStatus('');
      renderSide();
      renderSheet();
      scrollBoardTop();
      return;
    }
    if (action === 'weekly-tab') {
      const week = button.dataset.week === 'next' ? 'next' : 'this';
      if (state.weeklyEntry && state.dirty && !window.confirm('Leave this sheet without saving?')) return;
      state.weeklyWeek = week;
      state.weeklyDay = '';
      state.weeklyEntry = false;
      state.selectedId = null;
      state.dirty = false;
      setStatus('');
      renderSide();
      renderSheet();
      scrollBoardTop();
      return;
    }
    if (action === 'weekly-back') {
      if (state.dirty && !window.confirm('Leave this sheet without saving?')) return;
      const date = document.querySelector('#trip-form [name="trip_date"]')?.value || selectedPosting()?.trip_date || '';
      if (boardList === 'daily' || boardList === 'roster') {
        if (date) state.dailyDay = date;
        state.dailyChoseAll = false;
      } else if (date) {
        state.weeklyWeek = weekKeyForDate(date);
        state.weeklyDay = date;
      }
      state.weeklyEntry = false;
      state.selectedId = null;
      state.dirty = false;
      setStatus('');
      renderSide();
      renderSheet();
      scrollBoardTop();
      return;
    }
    if (action === 'weekly-edit') {
      state.weeklyEntry = true;
      state.selectedId = button.dataset.id || null;
      state.dirty = false;
      setStatus('');
      renderSide();
      renderSheet();
      return;
    }
    if (action === 'daily-day') {
      const date = button.dataset.date || '';
      if (!date) return;
      const dir = button.dataset.dir || '';
      state.dailyDay = date;
      state.dailyChoseAll = false;
      state.weeklyEntry = false;
      state.selectedId = null;
      state.dirty = false;
      setStatus('');
      renderSide();
      renderSheet();
      scrollBoardTop();
      focusDayCarousel(dir);
      return;
    }
    if (action === 'daily-days') {
      state.dailyDay = '';
      state.dailyChoseAll = true;
      setStatus('');
      renderSide();
      renderSheet();
      scrollBoardTop();
      return;
    }
    if (action === 'late-addition') {
      state.selectedId = 'new';
      state.lateDraft = true;
      state.weeklyEntry = true;
      state.dirty = true;
      state.mode = 'office';
      setStatus('');
      renderSide();
      renderSheet();
      return;
    }
    if (action === 'open-availability') {
      openAvailabilitySettings(button.dataset.date || '');
      return;
    }
    if (action === 'avail-close') {
      document.getElementById('avail-dialog')?.close();
      return;
    }
    if (action === 'avail-add-range') {
      addWeekdayRange(button.dataset.weekday || '', button.closest('.avail-day'));
      return;
    }
    if (action === 'avail-remove-range') {
      captureAvailEditor();
      const entry = state.availDraft?.weekdays?.[button.dataset.weekday];
      if (entry) entry.ranges = entry.ranges.filter((_, index) => index !== Number(button.dataset.index));
      state.availError = '';
      renderAvailabilityDialog();
      return;
    }
    if (action === 'avail-add-exception-range') {
      addComposerRange(button.closest('.avail-composer'));
      return;
    }
    if (action === 'avail-remove-composer-range') {
      captureAvailEditor();
      if (state.availExceptionDraft) {
        state.availExceptionDraft.ranges = state.availExceptionDraft.ranges.filter(
          (_, index) => index !== Number(button.dataset.index)
        );
      }
      state.availError = '';
      renderAvailabilityDialog();
      return;
    }
    if (action === 'avail-add-exception') {
      commitException();
      return;
    }
    if (action === 'avail-remove-exception') {
      removeException(button.dataset.date || '');
      return;
    }
    if (action === 'avail-save') {
      await saveAvailabilitySettings();
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
      state.weeklyEntry = false;
      if (posting.trip_date) {
        state.weeklyWeek = weekKeyForDate(posting.trip_date);
        state.weeklyDay = posting.trip_date;
      }
      state.dirty = false;
      setStatus('Draft deleted.');
      await load();
      return;
    }
    if (action === 'sign') {
      await signSheet();
      return;
    }
    if (action === 'pick-trip' || action === 'want-trip') {
      toggleDayTrip(state.postings.find((row) => row.id === button.dataset.id));
      return;
    }
    if (action === 'want-any') {
      mutateDay(button.dataset.date || '', (day) => {
        day.mode = day.mode === 'many' ? 'one' : 'many';
      });
      return;
    }
    if (action === 'pin-needed') {
      if (state.officePinMiss) {
        setStatus('That PIN is not on the office driver list.', true);
        return;
      }
      if (phoneView || fromDriver) {
        sendToDriverDashboard();
        return;
      }
      state.pinError = 'Enter your PIN to sign up.';
      renderPinDock();
      return;
    }
    if (action === 'pin-key') {
      const key = button.dataset.key || '';
      if (key === 'clear') {
        state.pinDigits = '';
        state.pinMatches = [];
        state.pinError = '';
      } else if (key === 'ok') {
        await submitPin();
        return;
      } else if (state.pinDigits.length < 4) {
        state.pinDigits += key;
        state.pinMatches = [];
        state.pinError = '';
        if (state.pinDigits.length === 4) {
          renderPinDock();
          await submitPin();
          return;
        }
      }
      renderPinDock();
      return;
    }
    if (action === 'pin-name') {
      await submitPin(button.dataset.driverId || '');
      return;
    }
    if (action === 'leave-board') {
      await leaveBoard();
      return;
    }
    if (action === 'show-sheets' || action === 'show-week') {
      if (state.dirty && !window.confirm('Leave this sheet without saving?')) return;
      state.officePanel = action === 'show-sheets' ? 'sheets' : 'week';
      state.dirty = false;
      applyWeekLayout();
      if (onWeekWall()) await loadShareUrl();
      await load();
      return;
    }
    if (action === 'wall-back') {
      leaveDriverBoard();
      return;
    }
    if (action === 'week-prev' || action === 'week-next') {
      if (!state.weekStart) state.weekStart = mondayOf(localToday());
      state.weekChosen = true;
      state.weekStart = addIsoDays(state.weekStart, action === 'week-next' ? 7 : -7);
      if (officeDesk && (boardList === 'daily' || boardList === 'roster')) {
        state.dailyDay = '';
        state.dailyChoseAll = false;
        renderSheet();
        return;
      }
      renderWeekBoard();
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
    if (action === 'close-day') {
      await closeDay(button.dataset.date || '');
      return;
    }
    if (action === 'award-substitute') {
      const postingId = button.dataset.id || '';
      const select = document.querySelector(`[data-substitute-for="${CSS.escape(postingId)}"]`);
      const driverId = select instanceof HTMLSelectElement ? select.value : '';
      await awardChosen(postingId, driverId, true);
      return;
    }
    if (action === 'weekly-assign') {
      const driverId = button.closest('.week-posting, tr')?.querySelector('[data-assign]')?.value || '';
      await awardWeekly(button.dataset.id, driverId);
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
    const dialog = document.getElementById('avail-dialog');
    if (dialog?.open && state.availDraft) {
      state.availError = error.message;
      renderAvailabilityDialog();
    }
  }
});

document.body.addEventListener('change', (event) => {
  const mode = event.target.closest?.('[data-avail-mode]');
  if (mode) {
    applyAvailMode(mode);
    return;
  }
  if (event.target.closest?.('[data-ex-kind]')) {
    captureAvailEditor();
    state.availError = '';
    renderAvailabilityDialog();
  }
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

if (boardParams.get('embed') === '1' || !officeDesk) document.body.classList.add('is-embed');
if (phoneView) document.body.classList.add('is-phone');
if (phoneView && boardList === 'weekly') document.body.classList.add('is-weekly-phone');
if (phoneView && boardList === 'daily') document.body.classList.add('is-daily-phone');
if (phoneView && boardList === 'roster') document.body.classList.add('is-roster-phone');
if (boardList === 'daily') document.body.classList.add('is-daily-board');
if (boardList === 'roster') document.body.classList.add('is-roster-board');
if (wallDisplay) {
  document.body.classList.add('is-wall');
  document.title = boardList === 'weekly' ? 'Weekly Work' : boardList === 'daily' ? 'Daily/Late Work' : 'Daily Work';
  hallPageStyle(true);
}
if (fromDriver) document.body.classList.add('is-from-driver');

function leaveDriverBoard() {
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'daily-work-wall-close' }, location.origin);
    return;
  }
  window.close();
  window.setTimeout(() => {
    if (history.length > 1) history.back();
    else location.assign('/');
  }, 60);
}

function requestWallFullscreen() {
  if (!wallDisplay || window.parent !== window) return;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (typeof request !== 'function') return;
  const pending = request === root.requestFullscreen ? request.call(root, { navigationUI: 'hide' }) : request.call(root);
  Promise.resolve(pending).catch(() => {});
}

if (wallDisplay) {
  document.addEventListener('pointerdown', () => requestWallFullscreen(), { once: true });
  if (window.parent !== window) {
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      window.parent.postMessage({ type: 'daily-work-wall-close' }, location.origin);
    });
  }
}
const boardTitle =
  boardList === 'roster'
    ? 'Roster Trips'
    : boardList === 'weekly'
      ? officeDesk
        ? 'Weekly Work Admin'
        : wallDisplay
          ? 'Weekly Work Postings'
          : 'Weekly Work'
      : boardList === 'daily'
        ? officeDesk
          ? 'Daily/Late Work Admin'
          : wallDisplay
            ? 'Daily/Late Work Postings'
            : 'Daily/Late Work'
        : '';
if (boardTitle) {
  const heading = document.querySelector('.board-bar h1');
  if (heading) heading.textContent = boardTitle;
  document.title = wallDisplay ? boardTitle : `${boardTitle} · Teamster Tracker`;
}
function renderBoardViewToggle() {
  const button = $('board-view-toggle');
  if (button) button.hidden = true;
}

function applyWeekLayout() {
  document.body.classList.toggle('is-week', onWeekWall());
  document.body.classList.toggle('is-office-week', officeDesk && (boardList === 'weekly' || boardList === 'daily' || boardList === 'roster'));
  const note = $('local-note');
  if (!note || !officeDesk) return;
  note.textContent =
    boardList === 'weekly'
      ? 'Open a day to see its postings. The field trip sheet is for a new job.'
      : boardList === 'roster'
        ? state.weeklyEntry
          ? 'Post the trip, then return to the day.'
          : 'Open a day to see who signed the evening, weekend, and mountain trips.'
      : boardList === 'daily'
        ? state.weeklyEntry
          ? 'Post the sheet, then return to the day.'
          : 'Open a day to see free mid-day time, signups, and who set availability for late additions.'
        : '';
}

document.body.addEventListener('change', (event) => {
  const monitor = event.target.closest?.('[data-action="postings-monitor"]');
  if (monitor) {
    setWeeklyPostingsMonitor(monitor.value).catch((error) => setStatus(error.message, true));
    return;
  }
  const move = event.target.closest?.('[data-action="move-trip"]');
  if (move) {
    const postingId = move.dataset.id || '';
    const value = move.value || '';
    if (value === '__search') {
      openDriverSearch(postingId);
      return;
    }
    if (value === '__other') {
      openOtherName(postingId);
      return;
    }
    if (value === '__name') return;
    if (value && directoryPerson(value)) {
      state.tripLane[postingId] = { kind: 'driver', driverId: value };
    } else {
      delete state.tripLane[postingId];
    }
    renderSheet();
    return;
  }
  const font = event.target.closest?.('[data-action="posting-font"]');
  if (font) {
    const size = Number(font.value);
    if (HALL_FONTS.includes(size)) state.postingFont = size;
    renderHallPosting(boardList === 'daily' ? 'daily' : 'weekly');
    return;
  }
  const select = event.target.closest?.('[data-action="phone-day"]');
  if (!select || select.tagName !== 'SELECT') return;
  state.phoneDate = select.value;
  renderPhoneBoard();
});

$('sign-out-pin')?.addEventListener('click', () => {
  leaveBoard().catch((error) => setStatus(error.message, true));
});

async function loadShareUrl() {
  let origin = location.origin;
  try {
    const response = await fetch('/api/clock-share-origin', { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      if (data.origin) origin = data.origin;
    }
  } catch {
    origin = location.origin;
  }
  const base = String(origin).replace(/\/$/, '');
  const tab = boardList === 'roster' ? 'roster' : boardList === 'weekly' ? 'weekly' : 'daily';
  const params = new URLSearchParams({ tab });
  if (boardList === 'weekly' && /^\d{4}-\d{2}-\d{2}$/.test(state.weekStart || '')) {
    params.set('week', state.weekStart);
  }
  state.shareUrl = `${base}/driver?${params}`;
}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.data?.type !== 'weekly-postings-sync') return;
  syncWeeklyPostingsPanel();
});

async function boot() {
  applyWeekLayout();
  if (onWeekWall() || wallDisplay) await loadShareUrl();
  await load();
  requestWallFullscreen();
}

boot().catch((error) => setStatus(error.message, true));
setInterval(() => {
  load({ keepSheet: true }).catch(() => {});
}, 20000);
