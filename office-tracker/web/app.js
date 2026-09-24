import {
  bindCalculatorStore,
  buildSnapshot,
  calendarPayload,
  currentSnapshot,
  deleteChange,
  getAsOfDate,
  peopleList,
  previewChange,
  recordChange,
  removeCurrentPerson,
  setupProfile,
  startingScheduleFields,
  switchPerson,
  updateChange,
  updateStartingSchedule,
} from '../../employee-tracker/web/engine.js';
import {
  deleteProfile,
  dismissNotificationId,
  getCurrentProfile,
  importState,
  listDismissedNotificationIds,
  listProfiles,
  loadState,
  saveProfile,
  saveState,
  setCurrentProfile,
} from './store.js';
import { buildRoutesCsv, stateFromRoutesCsv } from '../src/routesCsv.js';

bindCalculatorStore({
  deleteProfile,
  getCurrentProfile,
  importState,
  listProfiles,
  saveProfile,
  setCurrentProfile,
});
import {
  buildEmployeeNotifications,
  visibleEmployeeNotifications,
} from '../../employee-tracker/src/notifications.js';
import { localDateString } from '../../employee-tracker/src/clockTimes.js';
import { initCitations } from '../../employee-tracker/web/citations.js';
import { getSchoolDays } from '../../src/logic/calendar.js';
import {
  bidPeriodRanges,
  buildClockHistoryMarks,
  changeDetailLines,
  changeHoverLines,
  clockHistoryLabel,
} from '../../employee-tracker/src/clockHistory.js';

const OFFICE_HISTORY_TONES = [
  '#1a4f86',
  '#0e7490',
  '#8a4b12',
  '#6b3f78',
  '#9a3d4a',
  '#2f6f4e',
  '#3d5a80',
  '#8a5a2b',
];

const PAGE_TITLE = 'Transportation Timechange Calculator';

const RUNS = [
  { id: 'AM', label: 'AM', inName: 'am_in', outName: 'am_out' },
  { id: 'MIDDAY', label: 'Midday', inName: 'midday_in', outName: 'midday_out' },
  { id: 'PM', label: 'PM', inName: 'pm_in', outName: 'pm_out' },
];

const setupView = document.querySelector('#setup-view');
const appView = document.querySelector('#app-view');
const setupRuns = document.querySelector('#setup-runs');
const setupForm = document.querySelector('#setup-form');
const setupStatus = document.querySelector('#setup-status');
const changeForm = document.querySelector('#change-form');
const changeDialog = document.querySelector('#change-dialog');
const changeStatus = document.querySelector('#change-status');
const scheduleStatus = document.querySelector('#schedule-status');
const previewBox = document.querySelector('#preview-box');
const hero = document.querySelector('#hero');
const scheduleLead = document.querySelector('#schedule-lead');
const scheduleHistory = document.querySelector('#schedule-history');
const notificationToasts = document.querySelector('#notification-toasts');
const calendarMonths = document.querySelector('#calendar-months');
const historyLegend = document.querySelector('#history-legend');
const calendarPill = document.querySelector('#calendar-pill');
const routeTabs = document.querySelector('#route-tabs');
const startEditForm = document.querySelector('#start-edit-form');
const startEditRuns = document.querySelector('#start-edit-runs');
const startEditStatus = document.querySelector('#start-edit-status');
const changeEditForm = document.querySelector('#change-edit-form');
const changeEditStatus = document.querySelector('#change-edit-status');

let snapshot = null;
let addingPerson = false;

function toTimeInput(clock) {
  if (!clock) return '';
  const [h, m] = String(clock).split(':');
  return `${String(h).padStart(2, '0')}:${m}`;
}

function prettyDate(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function setStatus(el, message, kind = '') {
  el.hidden = !message;
  el.textContent = message || '';
  el.className = `status${kind ? ` is-${kind}` : ''}`;
}

function renderRouteTabs() {
  const routes = peopleList();
  const currentId = addingPerson ? null : getCurrentProfile()?.id;
  routeTabs.innerHTML = '';
  for (const route of routes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'route-tab';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', route.id === currentId ? 'true' : 'false');
    if (route.id === currentId) button.classList.add('is-active');
    button.textContent = route.name;
    button.addEventListener('click', () => chooseRoute(route.id));
    routeTabs.append(button);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'route-tab is-add';
  add.textContent = 'Add route';
  add.addEventListener('click', beginAddRoute);
  routeTabs.append(add);
}

function chooseRoute(id) {
  const current = getCurrentProfile();
  if (!addingPerson && current?.id === id) return;
  addingPerson = false;
  snapshot = switchPerson(id);
  loadAll();
}

function beginAddRoute() {
  addingPerson = true;
  showSetup(true);
  renderRouteTabs();
  document.querySelector('#setup_name').focus();
}

function rememberDriver(driver) {
  const profile = getCurrentProfile();
  if (!profile) return;
  profile.driver_name = String(driver ?? '').trim();
  saveProfile(profile);
}

function renderSetupRuns() {
  setupRuns.innerHTML = RUNS.map(
    (run) => `
      <div class="run-card">
        <h3>${run.label}</h3>
        <div class="pair">
          <div class="field">
            <label for="${run.inName}">Clock-in</label>
            <input id="${run.inName}" name="${run.inName}" type="time" step="60" />
          </div>
          <div class="field">
            <label for="${run.outName}">Clock-out</label>
            <input id="${run.outName}" name="${run.outName}" type="time" step="60" />
          </div>
        </div>
      </div>`
  ).join('');
}

function fillChangeFormFromSegment() {
  if (!snapshot?.schedule) return;
  const segment = document.querySelector('#change_segment').value;
  const current = snapshot.schedule[segment];
  document.querySelector('#clock_in').value = current
    ? toTimeInput(current.clock_in)
    : '';
  document.querySelector('#clock_out').value = current
    ? toTimeInput(current.clock_out)
    : '';
}

function renderNotifications() {
  if (!notificationToasts) return;
  notificationToasts.innerHTML = '';
  const profile = getCurrentProfile();
  if (!snapshot?.setup_complete || addingPerson || !profile) {
    notificationToasts.hidden = true;
    document.title = PAGE_TITLE;
    return;
  }

  const pending = visibleEmployeeNotifications(
    buildEmployeeNotifications(snapshot),
    listDismissedNotificationIds(profile.id)
  );
  if (!pending.length) {
    notificationToasts.hidden = true;
    document.title = PAGE_TITLE;
    return;
  }

  notificationToasts.hidden = false;
  document.title = `(${pending.length}) ${PAGE_TITLE}`;

  for (const note of pending) {
    const toast = document.createElement('article');
    toast.className = 'notification-toast is-flashing';
    toast.dataset.id = note.id;
    toast.addEventListener(
      'animationend',
      () => {
        toast.classList.remove('is-flashing');
      },
      { once: true }
    );

    const kicker = document.createElement('p');
    kicker.className = 'notification-toast-kicker';
    kicker.textContent = note.finalized_on
      ? `Locked in ${prettyDate(note.finalized_on)}`
      : 'Locked in';

    const title = document.createElement('h2');
    title.className = 'notification-toast-title';
    title.textContent = note.title;

    const detail = document.createElement('p');
    detail.className = 'notification-toast-text';
    detail.textContent = note.detail;

    toast.append(kicker, title, detail);

    const timeLines = note.time_changes.length
      ? note.time_changes
      : note.contracted_times;
    if (timeLines.length) {
      const list = document.createElement('ul');
      list.className = 'notification-toast-times';
      for (const row of timeLines) {
        const item = document.createElement('li');
        item.textContent = row.label;
        list.append(item);
      }
      toast.append(list);
    }

    if (note.contracted_hours_statement || note.contracted_hours_label) {
      const hours = document.createElement('p');
      hours.className = 'notification-toast-hours';
      hours.textContent =
        note.contracted_hours_statement ||
        `Contracted hours: ${note.contracted_hours_label}`;
      toast.append(hours);
    }

    const actions = document.createElement('div');
    actions.className = 'notification-toast-actions';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'secondary js-dismiss-notification';
    dismiss.textContent = 'Dismiss';
    actions.append(dismiss);
    toast.append(actions);
    notificationToasts.append(toast);
  }
}

function renderHero() {
  const windowInfo = snapshot.window;
  const contracted = snapshot.contracted;
  const name = snapshot.employee?.name;
  const outcome = windowInfo?.projected_outcome;
  hero.className = `hero panel${
    outcome === 'BID_PENDING'
      ? ' outcome-bid'
      : outcome === 'BUMP_ELIGIBLE'
        ? ' outcome-bump'
        : ''
  }`;

  const title = windowInfo?.becomes_contracted_on
    ? `Becomes contracted on ${prettyDate(windowInfo.becomes_contracted_on)}`
    : windowInfo?.status === 'STABLE'
      ? 'No open window'
      : windowInfo?.status_label || 'Route hours';
  const driver = getCurrentProfile()?.driver_name;
  const routeLabel = name ? `Route ${name}` : '';

  hero.innerHTML = `
    <p class="hero-kicker">${routeLabel ? `${routeLabel}${driver ? ` · ${escapeHtml(driver)}` : ''} · ` : ''}${windowInfo?.status_label || 'Not set up'}</p>
    <h1 class="hero-title">${title}</h1>
    <p class="hero-detail">${windowInfo?.headline || ''}</p>
    <ul class="stat-row">
      <li><span>Contracted hours</span><strong>${contracted?.label || '—'}</strong></li>
      <li><span>Accumulated difference</span><strong>${windowInfo?.cumulative_drift_label || '0 min'}</strong></li>
      <li><span>School days left in window</span><strong>${
        windowInfo?.days_remaining == null ? '—' : windowInfo.days_remaining
      }</strong></li>
    </ul>
    ${
      windowInfo?.projected_outcome_detail
        ? `<p class="hero-detail">${windowInfo.projected_outcome_detail}</p>`
        : ''
    }
    ${
      windowInfo?.contracted_hours_statement
        ? `<p class="hero-detail">${windowInfo.contracted_hours_statement}</p>`
        : ''
    }
  `;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatRange(item) {
  if (!item) return '—';
  return `${item.clock_in}–${item.clock_out}`;
}

function renderScheduleHistory() {
  const start = snapshot.employee?.start_date;
  const rows = snapshot.schedule_history || [];
  scheduleLead.textContent = start
    ? `Each row is a full schedule. The first row is the established starting times from ${prettyDate(start)}. Later rows are changes, oldest to newest.`
    : 'Each row is a full schedule. The first row is the established starting times. Later rows are changes, oldest to newest.';

  const downloadChangesBtn = document.querySelector('#download-changes-btn');
  const changeCount = rows.filter((row) => row.kind === 'change').length;
  if (downloadChangesBtn) {
    downloadChangesBtn.disabled = changeCount === 0;
    downloadChangesBtn.title =
      changeCount === 0 ? 'No clock-time changes to download yet.' : '';
  }

  const body = scheduleHistory.querySelector('tbody');
  if (!rows.length) {
    body.innerHTML =
      '<tr><td colspan="6" class="empty">No clock times recorded yet.</td></tr>';
    return;
  }

  body.innerHTML = rows
    .map((row, index) => {
      const predicted = row.contracted?.status === 'predicted';
      const kind =
        row.kind === 'initial'
          ? 'Established'
          : `${row.segment} change${row.delta_label ? ` · ${row.delta_label}` : ''}`;
      const contractedLabel = escapeHtml(row.contracted?.label || '—');
      const contractedDetail = row.contracted?.projected_outcome_label
        ? `<span class="contracted-detail">${escapeHtml(
            row.contracted.projected_outcome_label
          )}</span>`
        : '';
      const note = row.note
        ? `<span class="change-note">${escapeHtml(row.note)}</span>`
        : '';
      const actions =
        row.kind === 'change'
          ? `<div class="row-actions">
              <button type="button" class="secondary js-edit-change">Edit</button>
              <button type="button" class="secondary js-delete-change">Remove</button>
            </div>`
          : `<div class="row-actions">
              <button type="button" class="secondary js-edit-start">Edit</button>
            </div>`;
      return `<tr class="is-history${predicted ? ' is-predicted' : ''}" style="--tone:${toneForRow(index)}"${
        row.change_id ? ` data-change-id="${escapeHtml(row.change_id)}"` : ''
      }${row.kind === 'initial' ? ' data-row-kind="initial"' : ''}>
        <th scope="row">
          ${prettyDate(row.date)}
          <span class="row-kind">${escapeHtml(kind)}</span>
        </th>
        ${RUNS.map((run) => {
          const changed = row.segment === run.id;
          return `<td${changed ? ' class="is-changed"' : ''}>
            <span class="times">${formatRange(row.schedule?.[run.id])}</span>
            ${
              changed
                ? `<span class="change-note">was ${escapeHtml(
                    row.previous_time || '—'
                  )}</span>`
                : ''
            }
          </td>`;
        }).join('')}
        <td>
          <span class="contracted-label">${contractedLabel}</span>
          ${contractedDetail}
          ${note}
        </td>
        <td>${actions}</td>
      </tr>`;
    })
    .join('');
}

function toneForRow(index) {
  return OFFICE_HISTORY_TONES[index % OFFICE_HISTORY_TONES.length];
}

function renderHistoryLegend(rows) {
  if (!historyLegend) return;
  historyLegend.innerHTML = rows
    .map((row, index) => {
      const tone = toneForRow(index);
      return `<li style="--tone:${tone}">
        <span class="history-swatch" aria-hidden="true"></span>
        ${prettyDate(row.date)} · ${escapeHtml(clockHistoryLabel(row))}
      </li>`;
    })
    .join('') +
    `<li class="is-key-note">
      <span class="history-swatch is-bid" aria-hidden="true"></span>
      End-of-month bid period: the last five school days of October through April, when a 30-minute increase is posted for bid.
    </li>`;
}

function renderCalendar() {
  const calendar = calendarPayload();
  const rows = snapshot?.schedule_history || [];
  const schoolDays = getSchoolDays(calendar);
  const marks = buildClockHistoryMarks(rows, {
    schoolDays,
    tones: OFFICE_HISTORY_TONES,
  });
  const bidRanges = bidPeriodRanges(schoolDays);
  renderHistoryLegend(rows);
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = snapshot?.as_of || localDateString();
  calendarMonths.innerHTML = (calendar.months || [])
    .map((month) => {
      const first = month.days[0];
      const pad = first ? new Date(`${first.date}T00:00:00Z`).getUTCDay() : 0;
      const blanks = Array.from({ length: pad }, (_, index) => {
        return `<div class="cal-day" style="grid-column:${index + 1};grid-row:2"></div>`;
      });
      const days = month.days.map((day, index) => {
        const num = Number(day.date.slice(-2));
        const offReason = day.is_school_day ? '' : day.reason || 'Off';
        const skipLabel =
          !offReason ||
          offReason === 'Weekend' ||
          offReason.startsWith('Outside school year');
        const short =
          !day.is_school_day && !skipLabel
            ? offReason.replace(' (students off)', '')
            : '';
        const mark = marks.get(day.date);
        const inBid = bidRanges.some(
          (range) => day.date >= range.start && day.date <= range.end
        );
        const slot = pad + index;
        const col = (slot % 7) + 1;
        const row = Math.floor(slot / 7) + 2;
        const dow = new Date(`${day.date}T00:00:00Z`).getUTCDay();
        const isToday = day.date === today;
        const changeLines = mark ? changeHoverLines(mark) : [];
        const detailLines =
          mark?.sourceIndex == null ? [] : changeDetailLines(rows[mark.sourceIndex]);
        const classes = [
          'cal-day',
          day.is_school_day ? 'is-school' : 'is-off',
          mark?.arrow ? 'is-bid-arrow' : '',
          mark?.arrow && dow !== 0 ? 'is-arrow-join' : '',
          mark?.arrow && !mark.arrowHead && dow !== 6 ? 'is-arrow-bridge' : '',
          mark?.arrowOrigin ? 'is-arrow-origin' : '',
          mark?.arrowOrigin && dow !== 6 ? 'is-arrow-origin-bridge' : '',
          mark?.arrowFromWindow ? 'is-arrow-from-window' : '',
          mark?.contractedDay ? 'is-contracted' : '',
          isToday ? 'is-today' : '',
          changeLines.length ? 'is-hover-change' : '',
          changeLines.length && col <= 2 ? 'is-tip-start' : '',
          changeLines.length && col >= 6 ? 'is-tip-end' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const titleParts = [day.is_school_day ? 'School day' : offReason];
        if (isToday) titleParts.unshift("Today's date");
        if (inBid) titleParts.push('End-of-month bid period');
        if (mark?.arrow) {
          const when = mark.resolvesOn ? prettyDate(mark.resolvesOn) : 'resolution';
          const aim = mark.goesToBid ? `Goes to bid ${when}` : `Points to ${when}`;
          if (changeLines.length) {
            titleParts.push(...changeLines, aim);
          } else {
            titleParts.push(`${mark.label} · ${aim.charAt(0).toLowerCase()}${aim.slice(1)}`);
          }
        } else if (mark) {
          if (changeLines.length) titleParts.push(...changeLines);
          else titleParts.push(mark.label);
          if (mark.established) titleParts.push('established');
          if (mark.windowDay) titleParts.push(`school day ${mark.windowDay} of 15`);
          if (mark.contractedDay) titleParts.push('became contracted');
        }
        const popupLines = [
          ...titleParts,
          ...detailLines.filter((line) => !titleParts.includes(line)),
        ];
        const hoverList = changeLines.length
          ? `<ul class="cal-hover" role="tooltip">${popupLines
              .map((line) => {
                const isChangeLine =
                  line.startsWith('Current change:') ||
                  line.startsWith('Cumulative change:');
                const isDetail = !titleParts.includes(line);
                const itemClass = [isChangeLine ? 'is-change' : '', isDetail ? 'is-detail' : '']
                  .filter(Boolean)
                  .join(' ');
                return `<li${itemClass ? ` class="${itemClass}"` : ''}>${escapeHtml(line)}</li>`;
              })
              .join('')}</ul>`
          : '';
        const showPip = mark && !mark.arrow && (mark.window || mark.established);
        const pip = showPip
          ? `<span class="history-pip${mark.established ? ' is-established' : ''}${
              mark.window ? ' is-window' : ''
            }" style="--tone:${mark.tone}">${mark.windowDay ? `#${mark.windowDay}` : ''}</span>`
          : '';
        const arrow = mark?.arrow
          ? `<span class="bid-arrow${mark.arrowHead ? ' is-head' : ''}" style="--tone:${mark.tone}"></span>`
          : '';
        const toneStyle =
          mark?.contractedDay || mark?.arrowOrigin ? `;--tone:${mark.tone}` : '';
        const hoverAttrs = hoverList
          ? ` data-date="${day.date}" aria-label="${escapeHtml(titleParts.join('. '))}" tabindex="0"`
          : ` title="${escapeHtml(titleParts.join(' · '))}"`;
        return `<div class="${classes}" style="grid-column:${col};grid-row:${row}${toneStyle}"${hoverAttrs}><span class="num">${num}</span>${pip}${arrow}${
          short ? `<span class="why">${escapeHtml(short)}</span>` : ''
        }${hoverList}</div>`;
      });
      const rects = bidRectMarkup(bidRanges, month.days, pad);
      return `<div class="month-block">
        <h3>${month.label}</h3>
        <div class="month-grid">
          ${dows
            .map(
              (label, index) =>
                `<div class="dow" style="grid-column:${index + 1};grid-row:1">${label}</div>`
            )
            .join('')}
          ${blanks.join('')}${days.join('')}${rects}
        </div>
      </div>`;
    })
    .join('');
}

function bidRectMarkup(ranges, monthDays, pad) {
  const html = [];
  for (const range of ranges) {
    const indexes = [];
    monthDays.forEach((day, index) => {
      if (day.date >= range.start && day.date <= range.end) indexes.push(index);
    });
    if (!indexes.length) continue;
    /** @type {{ row: number, startCol: number, endCol: number } | null} */
    let segment = null;
    const segments = [];
    for (const index of indexes) {
      const slot = pad + index;
      const row = Math.floor(slot / 7);
      const col = slot % 7;
      if (segment && segment.row === row && col === segment.endCol + 1) {
        segment.endCol = col;
      } else {
        segment = { row, startCol: col, endCol: col };
        segments.push(segment);
      }
    }
    for (const seg of segments) {
      const gridRow = seg.row + 2;
      html.push(
        `<div class="bid-rect" style="grid-column:${seg.startCol + 1} / ${
          seg.endCol + 2
        };grid-row:${gridRow} / ${gridRow + 1}" title="End-of-month bid period"></div>`
      );
    }
  }
  return html.join('');
}

function showSetup(resetForm = false) {
  setupView.hidden = false;
  setupView.setAttribute('aria-hidden', 'false');
  appView.hidden = true;
  if (resetForm) {
    setupForm.reset();
    document.querySelector('#setup_start_date').value = getAsOfDate();
    setStatus(setupStatus, '');
  }
}

function renderApp() {
  renderRouteTabs();
  const ready = Boolean(snapshot?.setup_complete) && !addingPerson;
  if (!ready) {
    showSetup(false);
    renderNotifications();
    return;
  }
  setupView.hidden = true;
  setupView.setAttribute('aria-hidden', 'true');
  appView.hidden = false;
  renderNotifications();
  renderHero();
  renderScheduleHistory();
  renderCalendar();
  fillChangeFormFromSegment();
}

function loadAll() {
  startEditForm.hidden = true;
  changeEditForm.hidden = true;
  snapshot = addingPerson ? buildSnapshot(null) : currentSnapshot();
  const asOf = snapshot.as_of || getAsOfDate();
  const viewingAsOf = asOf !== localDateString();
  calendarPill.textContent = viewingAsOf
    ? `Viewing as of ${prettyDate(asOf)}`
    : `BPS ${snapshot.calendar?.school_year || '2026-2027'} · ${
        snapshot.calendar?.school_day_count ?? 180
      } school days`;
  if (!document.querySelector('#setup_start_date').value) {
    document.querySelector('#setup_start_date').value = snapshot.as_of || getAsOfDate();
  }
  if (!document.querySelector('#change_date').value) {
    document.querySelector('#change_date').value = snapshot.as_of || getAsOfDate();
  }
  renderApp();
}

function updatePreview() {
  if (!snapshot?.setup_complete || addingPerson) return;
  const clockIn = document.querySelector('#clock_in').value;
  const clockOut = document.querySelector('#clock_out').value;
  const changeDate = document.querySelector('#change_date').value;
  const segment = document.querySelector('#change_segment').value;
  if (!clockIn || !clockOut || !changeDate) {
    previewBox.hidden = true;
    return;
  }
  try {
    const preview = previewChange({
      segment,
      clock_in: clockIn,
      clock_out: clockOut,
      change_date: changeDate,
    });
    previewBox.hidden = false;
    previewBox.innerHTML = `
      <strong>${preview.delta_label}</strong> exact difference
      · window ends <strong>${prettyDate(preview.window_expires_date)}</strong>
      · becomes contracted <strong>${prettyDate(preview.becomes_contracted_on)}</strong>
      · ${preview.projected_outcome_label}
      <div class="meta">${preview.contracted_hours_statement || ''}</div>
    `;
    setStatus(changeStatus, '');
  } catch (error) {
    previewBox.hidden = true;
    setStatus(changeStatus, error.message, 'error');
  }
}

setupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(setupForm));
  const routeNumber = String(data.name ?? '').trim();
  const duplicate = peopleList().some(
    (route) => route.name.toLowerCase() === routeNumber.toLowerCase()
  );
  if (!routeNumber) {
    setStatus(setupStatus, 'Enter a route number.', 'error');
    return;
  }
  if (duplicate) {
    setStatus(setupStatus, `Route ${routeNumber} already has a tab.`, 'error');
    return;
  }
  try {
    snapshot = setupProfile(data);
    rememberDriver(data.driver);
    addingPerson = false;
    setStatus(setupStatus, `Route ${routeNumber} saved in this browser.`, 'ok');
    loadAll();
  } catch (error) {
    setStatus(setupStatus, error.message, 'error');
  }
});

changeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    snapshot = recordChange({
      segment: document.querySelector('#change_segment').value,
      change_date: document.querySelector('#change_date').value,
      clock_in: document.querySelector('#clock_in').value,
      clock_out: document.querySelector('#clock_out').value,
      note: document.querySelector('#change_note').value,
    });
    document.querySelector('#change_note').value = '';
    setStatus(changeStatus, '');
    closeChangeDialog();
    setStatus(scheduleStatus, 'Change recorded on this device.', 'ok');
    renderApp();
  } catch (error) {
    setStatus(changeStatus, error.message, 'error');
  }
});

document.querySelector('#change_segment').addEventListener('change', () => {
  fillChangeFormFromSegment();
  updatePreview();
});
document.querySelector('#change-reset').addEventListener('click', () => {
  fillChangeFormFromSegment();
  document.querySelector('#change_note').value = '';
  updatePreview();
});
for (const id of ['clock_in', 'clock_out', 'change_date']) {
  document.querySelector(`#${id}`).addEventListener('change', updatePreview);
}

document.querySelector('#reset-btn').addEventListener('click', () => {
  const route = getCurrentProfile();
  const label = route?.name ? `route ${route.name}` : 'this route';
  if (!confirm(`Remove ${label} from this browser?`)) return;
  snapshot = removeCurrentPerson();
  addingPerson = !getCurrentProfile();
  setupForm.reset();
  setStatus(setupStatus, '');
  loadAll();
});

document.querySelector('#export-btn').addEventListener('click', () => {
  const blob = new Blob([buildRoutesCsv(loadState())], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'transportation-timechange.csv';
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelector('#import-btn').addEventListener('click', () => {
  document.querySelector('#import-file').click();
});

function fillStartEditForm() {
  const fields = startingScheduleFields();
  document.querySelector('#start_edit_name').value = fields.name;
  document.querySelector('#start_edit_driver').value = getCurrentProfile()?.driver_name || '';
  document.querySelector('#start_edit_date').value = fields.start_date;
  startEditRuns.innerHTML = RUNS.map((run) => {
    const item = fields.segments[run.id];
    return `
      <div class="run-card">
        <h3>${run.label}</h3>
        <div class="pair">
          <div class="field">
            <label for="start_edit_${run.inName}">Clock-in</label>
            <input id="start_edit_${run.inName}" name="${run.inName}" type="time" step="60" value="${
              item ? toTimeInput(item.clock_in) : ''
            }" />
          </div>
          <div class="field">
            <label for="start_edit_${run.outName}">Clock-out</label>
            <input id="start_edit_${run.outName}" name="${run.outName}" type="time" step="60" value="${
              item ? toTimeInput(item.clock_out) : ''
            }" />
          </div>
        </div>
      </div>`;
  }).join('');
}

function openChangeDialog() {
  setStatus(changeStatus, '');
  if (!changeDialog.open) {
    changeDialog.showModal();
  }
  updatePreview();
}

function closeChangeDialog() {
  if (changeDialog.open) {
    changeDialog.close();
  }
}

const dayDialog = document.querySelector('#day-dialog');
const dayDialogTitle = document.querySelector('#day-dialog-title');
const dayDialogList = document.querySelector('#day-dialog-list');

function usesDayPopup() {
  return window.matchMedia('(max-width: 720px), (hover: none) and (pointer: coarse)').matches;
}

function openDayPopup(day) {
  const lines = [...day.querySelectorAll('.cal-hover li')].map((item) => item.textContent);
  dayDialogTitle.textContent = prettyDate(day.dataset.date);
  dayDialogList.innerHTML = lines
    .map((line) => {
      const isChangeLine =
        line.startsWith('Current change:') || line.startsWith('Cumulative change:');
      return `<li${isChangeLine ? ' class="is-change"' : ''}>${escapeHtml(line)}</li>`;
    })
    .join('');
  if (!dayDialog.open) dayDialog.showModal();
}

function closeDayPopup() {
  if (dayDialog.open) dayDialog.close();
}

calendarMonths.addEventListener('click', (event) => {
  const day = event.target.closest('.cal-day.is-hover-change');
  if (!day || !usesDayPopup()) return;
  openDayPopup(day);
});

calendarMonths.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const day = event.target.closest('.cal-day.is-hover-change');
  if (!day || !usesDayPopup()) return;
  event.preventDefault();
  openDayPopup(day);
});

document.querySelector('#day-dialog-close').addEventListener('click', closeDayPopup);
dayDialog.addEventListener('click', (event) => {
  if (event.target === dayDialog) closeDayPopup();
});

document.querySelector('#record-change-btn').addEventListener('click', openChangeDialog);
document.querySelector('#change-dialog-close').addEventListener('click', closeChangeDialog);
changeDialog.addEventListener('click', (event) => {
  if (event.target === changeDialog) {
    closeChangeDialog();
  }
});

function openStartEditor() {
  changeEditForm.hidden = true;
  fillStartEditForm();
  startEditForm.hidden = false;
  setStatus(startEditStatus, '');
  startEditForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.querySelector('#edit-start-btn').addEventListener('click', openStartEditor);

document.querySelector('#start-edit-cancel').addEventListener('click', () => {
  startEditForm.hidden = true;
  setStatus(startEditStatus, '');
});

startEditForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(startEditForm));
  const routeNumber = String(data.name ?? '').trim();
  const current = getCurrentProfile();
  const duplicate = peopleList().some(
    (route) =>
      route.id !== current?.id &&
      route.name.toLowerCase() === routeNumber.toLowerCase()
  );
  if (!routeNumber) {
    setStatus(startEditStatus, 'Enter a route number.', 'error');
    return;
  }
  if (duplicate) {
    setStatus(startEditStatus, `Route ${routeNumber} already has a tab.`, 'error');
    return;
  }
  try {
    snapshot = updateStartingSchedule(data);
    rememberDriver(data.driver);
    startEditForm.hidden = true;
    setStatus(scheduleStatus, 'Starting times corrected.', 'ok');
    renderApp();
  } catch (error) {
    setStatus(startEditStatus, error.message, 'error');
  }
});

function openChangeEditor(changeId) {
  const change = (snapshot.changes || []).find((item) => item.id === changeId);
  if (!change) return;
  document.querySelector('#change_edit_id').value = change.id;
  document.querySelector('#change_edit_date').value = change.change_date;
  document.querySelector('#change_edit_segment').textContent = change.segment;
  document.querySelector('#change_edit_in').value = toTimeInput(change.next?.clock_in);
  document.querySelector('#change_edit_out').value = toTimeInput(change.next?.clock_out);
  document.querySelector('#change_edit_note').value = change.note || '';
  startEditForm.hidden = true;
  changeEditForm.hidden = false;
  setStatus(changeEditStatus, '');
  changeEditForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

scheduleHistory.addEventListener('click', (event) => {
  if (event.target.closest('.js-edit-start')) {
    openStartEditor();
    return;
  }
  const row = event.target.closest('[data-change-id]');
  if (!row) return;
  const changeId = row.dataset.changeId;
  if (event.target.closest('.js-edit-change')) {
    openChangeEditor(changeId);
    return;
  }
  if (event.target.closest('.js-delete-change')) {
    if (!confirm('Remove this recorded change? The hours math will be rebuilt without it.')) {
      return;
    }
    try {
      snapshot = deleteChange(changeId);
      changeEditForm.hidden = true;
      setStatus(scheduleStatus, 'Change removed.', 'ok');
      renderApp();
    } catch (error) {
      setStatus(scheduleStatus, error.message, 'error');
    }
  }
});

changeEditForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    snapshot = updateChange(document.querySelector('#change_edit_id').value, {
      change_date: document.querySelector('#change_edit_date').value,
      clock_in: document.querySelector('#change_edit_in').value,
      clock_out: document.querySelector('#change_edit_out').value,
      note: document.querySelector('#change_edit_note').value,
    });
    changeEditForm.hidden = true;
    setStatus(scheduleStatus, 'Change corrected.', 'ok');
    renderApp();
  } catch (error) {
    setStatus(changeEditStatus, error.message, 'error');
  }
});

document.querySelector('#change-edit-cancel').addEventListener('click', () => {
  changeEditForm.hidden = true;
  setStatus(changeEditStatus, '');
});

notificationToasts?.addEventListener('click', (event) => {
  const button = event.target.closest('.js-dismiss-notification');
  const toast = event.target.closest('[data-id]');
  if (!button || !toast) return;
  const profile = getCurrentProfile();
  if (!profile) return;
  dismissNotificationId(profile.id, toast.dataset.id);
  renderNotifications();
});

document.querySelector('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const existing = peopleList();
  if (
    existing.length &&
    !confirm('Replace the routes saved in this browser with this CSV?')
  ) {
    return;
  }
  try {
    const currentRoute = getCurrentProfile()?.name;
    const next = stateFromRoutesCsv(await file.text(), { currentRoute });
    saveState(next);
    addingPerson = false;
    setStatus(setupStatus, 'Routes loaded from the CSV.', 'ok');
    loadAll();
  } catch (error) {
    setStatus(setupStatus, error.message, 'error');
    if (!getCurrentProfile()) {
      setupView.hidden = false;
    }
  }
});

renderSetupRuns();
try {
  loadAll();
} catch (error) {
  setStatus(setupStatus, error.message, 'error');
  setupView.hidden = false;
}

initCitations();
