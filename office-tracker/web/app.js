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
  listDrivers,
  compareRouteNumbers,
  listProfiles,
  loadState,
  saveDriver,
  saveProfile,
  saveState,
  sessionModifiedRouteNames,
  setCurrentProfile,
  beginSessionRouteTracking,
} from './store.js';
import {
  ROUTE_DATA_FILE_BASE,
  payrollWorkbookFilename,
  stampedWorkbookFilename,
  workbookTitleFromFilename,
} from '../src/downloadName.js';
import { buildPayrollWorkbook, rowsFromPayrollWorkbook } from '../src/payrollTimes.js';
import { buildRouteWorkbook } from '../src/routeWorkbook.js';
import { startAccounts, currentAccount } from './accounts.js';
import { attributionForChange } from './attribution.js';
import { recentRouteChanges } from '../src/recentChanges.js';
import { ensureExampleRoutes, isSampleOffice } from './exampleRoutes.js';
import { mountTimesheetReader } from './timesheetReader.js';

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
import { assignRouteDriver, dayBefore, driverForDate, driverOwnsRoute, routeAssignments, sameDriver } from '../src/assignments.js';
import { sectionsForDriver } from '../src/driverPacket.js';
import { changeNoticeMail, isChangeNoticeSent, loadSentChangeIds, noticeCalendarFilename, rememberChangeNoticeSent } from '../src/noticeMail.js';
import { downloadCalendarPdf } from './noticeCalendarPdf.js';
import { initCitations } from '../../employee-tracker/web/citations.js';
import {
  calendarMonthsHtml,
  contractColumnsForHistory,
  escapeHtml,
  historyLegendHtml,
  prettyDate,
  scheduleHistoryTableHtml,
  toneForRow,
} from '../src/historyMarkup.js';

const PAGE_TITLE = 'Teamster Time Changes Dashboard';

const RUNS = [
  { id: 'AM', label: 'AM', inName: 'am_in', outName: 'am_out', shade: 'run-am' },
  { id: 'MIDDAY', label: 'Midday', inName: 'midday_in', outName: 'midday_out', shade: 'run-mid' },
  { id: 'PM', label: 'PM', inName: 'pm_in', outName: 'pm_out', shade: 'run-pm' },
];

const driversView = document.querySelector('#drivers-view');
const driverSheet = document.querySelector('#driver-sheet');
const driverStatus = document.querySelector('#driver-status');
const setupView = document.querySelector('#setup-view');
const appView = document.querySelector('#app-view');
const setupRuns = document.querySelector('#setup-runs');
const setupForm = document.querySelector('#setup-form');
const setupStatus = document.querySelector('#setup-status');
const fileStatus = document.querySelector('#file-status');
const recentChangesBox = document.querySelector('#recent-changes');
const recentChangesTrack = document.querySelector('#recent-changes-track');
const recentChangesCount = document.querySelector('#recent-changes-count');
const recentChangesNewer = document.querySelector('#recent-changes-newer');
const recentChangesOlder = document.querySelector('#recent-changes-older');
const recentChangesLive = document.querySelector('#recent-changes-live');
/** @type {ReturnType<typeof recentRouteChanges>} */
let recentChangeItems = [];
let recentChangeIndex = -1;
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
const routeTabs = document.querySelector('#route-tabs');
const driversTab = document.querySelector('#drivers-tab');
const timesheetTab = document.querySelector('#timesheet-tab');
const timesheetView = document.querySelector('#timesheet-view');
const allRoutesView = document.querySelector('#all-routes-view');
const allRoutesSheet = document.querySelector('#all-routes-sheet');
const driverHistoryView = document.querySelector('#driver-history-view');
const driverHistoryTitle = document.querySelector('#driver-history-title');
const driverHistoryLead = document.querySelector('#driver-history-lead');
const driverHistoryBody = document.querySelector('#driver-history-body');
const startEditForm = document.querySelector('#start-edit-form');
const startEditRuns = document.querySelector('#start-edit-runs');
const startEditStatus = document.querySelector('#start-edit-status');
const changeEditForm = document.querySelector('#change-edit-form');
const changeEditStatus = document.querySelector('#change-edit-status');

let snapshot = null;
let addingPerson = false;
let activeSheet = 'drivers';
let viewingDriver = '';

function toTimeInput(clock) {
  if (!clock) return '';
  const [h, m] = String(clock).split(':');
  return `${String(h).padStart(2, '0')}:${m}`;
}

function setStatus(el, message, kind = '') {
  el.hidden = !message;
  el.textContent = message || '';
  el.className = `status${kind ? ` is-${kind}` : ''}`;
}

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="3.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
};

function iconHtml(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

function iconEl(name) {
  const wrap = document.createElement('span');
  wrap.innerHTML = iconHtml(name);
  return wrap.firstElementChild;
}

function renderRouteTabs() {
  const onDrivers = activeSheet === 'drivers' && !addingPerson;
  const onAll = activeSheet === 'all' && !addingPerson;
  const onDriverHistory = activeSheet === 'driver-history' && !addingPerson;
  const onTimesheet = activeSheet === 'timesheets' && !addingPerson;
  const onRoute = !addingPerson && !onDrivers && !onAll && !onDriverHistory && !onTimesheet;
  const currentId = onRoute ? getCurrentProfile()?.id : null;
  driversTab.classList.toggle('is-active', onDrivers);
  driversTab.setAttribute('aria-selected', onDrivers ? 'true' : 'false');
  timesheetTab?.classList.toggle('is-active', onTimesheet);
  timesheetTab?.setAttribute('aria-selected', onTimesheet ? 'true' : 'false');
  const routes = [...peopleList()].sort((a, b) => compareRouteNumbers(a.name, b.name));
  routeTabs.innerHTML = '';
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'route-tab';
  all.id = 'all-routes-tab';
  all.setAttribute('role', 'tab');
  all.setAttribute('aria-selected', onAll ? 'true' : 'false');
  if (onAll) all.classList.add('is-active');
  all.append(iconEl('grid'), document.createTextNode('All routes'));
  all.addEventListener('click', showAllRoutes);
  routeTabs.append(all);
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
  add.append(iconEl('plus'), document.createTextNode('Add route'));
  add.addEventListener('click', beginAddRoute);
  routeTabs.append(add);
}

function chooseRoute(id) {
  const current = getCurrentProfile();
  if (
    !addingPerson &&
    activeSheet !== 'drivers' &&
    activeSheet !== 'all' &&
    activeSheet !== 'driver-history' &&
    activeSheet !== 'timesheets' &&
    current?.id === id
  ) {
    return;
  }
  addingPerson = false;
  viewingDriver = '';
  activeSheet = id;
  snapshot = switchPerson(id);
  loadAll();
}

function showAllRoutes() {
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'all';
  loadAll();
}

function showDriverHistory(name) {
  const driverName = String(name || '').trim();
  if (!driverName) return;
  addingPerson = false;
  viewingDriver = driverName;
  activeSheet = 'driver-history';
  loadAll();
  driverHistoryView?.scrollIntoView({ block: 'start' });
}

function showDrivers() {
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'drivers';
  loadAll();
}

function showTimesheets() {
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'timesheets';
  loadAll();
  timesheetView?.scrollIntoView({ block: 'start' });
}

driversTab.addEventListener('click', showDrivers);
timesheetTab?.addEventListener('click', showTimesheets);

function beginAddRoute() {
  addingPerson = true;
  viewingDriver = '';
  activeSheet = 'route';
  driversView.hidden = true;
  allRoutesView.hidden = true;
  driverHistoryView.hidden = true;
  if (timesheetView) timesheetView.hidden = true;
  if (routeTabs) routeTabs.hidden = false;
  showSetup(true);
  renderRouteTabs();
  document.querySelector('#setup_name').focus();
}

function rememberDriver(driver) {
  const profile = getCurrentProfile();
  if (!profile) return;
  assignRouteDriver(profile, driver, localDateString());
  saveProfile(profile);
}

const assignDriverDialog = document.querySelector('#assign-driver-dialog');
const assignDriverForm = document.querySelector('#assign-driver-form');
const assignDriverStatus = document.querySelector('#assign-driver-status');

function openAssignDriverDialog() {
  const profile = getCurrentProfile();
  if (!profile || !assignDriverDialog) return;
  const current = String(profile.driver_name || '').trim();
  const options = document.querySelector('#assign-driver-options');
  options.innerHTML = listDrivers()
    .filter((driver) => !sameDriver(driver.name, current))
    .map((driver) => `<option value="${escapeHtml(driver.name)}"></option>`)
    .join('');
  const input = document.querySelector('#assign_driver');
  input.value = '';
  const routeName = profile.name ? `Route ${profile.name}` : 'This route';
  const when = prettyDate(localDateString());
  document.querySelector('#assign-driver-lead').textContent = current
    ? `${routeName} is assigned to ${current}. Choose who takes it starting ${when}. Clock times from before then stay with ${current}.`
    : `${routeName} has no driver yet. Choose who takes it starting ${when}.`;
  setStatus(assignDriverStatus, '');
  if (!assignDriverDialog.open) assignDriverDialog.showModal();
  input.focus();
}

function closeAssignDriverDialog() {
  if (assignDriverDialog?.open) assignDriverDialog.close();
}

hero.addEventListener('click', (event) => {
  if (!event.target.closest('#assign-driver-btn')) return;
  openAssignDriverDialog();
});

assignDriverForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const profile = getCurrentProfile();
  if (!profile) return;
  const typed = document.querySelector('#assign_driver').value.trim();
  if (!typed) {
    setStatus(assignDriverStatus, 'Choose a driver.', 'error');
    return;
  }
  const known = listDrivers().find((driver) => sameDriver(driver.name, typed));
  const nextName = known?.name || typed;
  if (sameDriver(nextName, profile.driver_name)) {
    setStatus(assignDriverStatus, `${nextName} already has this route.`, 'error');
    return;
  }
  try {
    assignRouteDriver(profile, nextName, localDateString());
    if (!known) saveDriver({ name: nextName });
    saveProfile(profile);
    closeAssignDriverDialog();
    loadAll();
    const routeName = profile.name ? `Route ${profile.name}` : 'This route';
    setStatus(
      scheduleStatus,
      `${routeName} is assigned to ${nextName} starting ${prettyDate(localDateString())}.`,
      'ok'
    );
  } catch (error) {
    setStatus(assignDriverStatus, error.message, 'error');
  }
});

document.querySelector('#assign-driver-close').addEventListener('click', closeAssignDriverDialog);
assignDriverDialog.addEventListener('click', (event) => {
  if (event.target === assignDriverDialog) closeAssignDriverDialog();
});

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
  const profile = getCurrentProfile();
  const driver = profile?.driver_name;
  const officeNote = String(profile?.note ?? '').trim();
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
    ${officeNote ? `<p class="hero-detail">${escapeHtml(officeNote)}</p>` : ''}
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
    <div class="actions">
      <button type="button" id="assign-driver-btn">${iconHtml('user')} Assign to different driver</button>
    </div>
  `;
}

function formatRange(item) {
  if (!item) return '—';
  return `${item.clock_in}–${item.clock_out}`;
}

function renderScheduleHistory() {
  const start = snapshot.employee?.start_date;
  const rows = snapshot.schedule_history || [];
  const noticeHint = ' Send notice opens a text email that lists the original clock times and every change to date, and downloads a calendar PDF. Attach that PDF if you want the driver to see the calendar. Notice sent is marked Yes.';
  const hoursHint =
    ' Hours is the rounded total of the clock times on that row. Contracted is the date that schedule became the contract, or a predicted date. Contract Hours is the official total, which stays at the previous figure until that date.';
  const forceHint =
    ' Force Oct 1 Contract starts off. Turn it on to contract that schedule on October 1, skipping the usual rules for the size of the change and the 15-school-day countdown.';
  scheduleLead.textContent = start
    ? `Each row is a full schedule. The first row is the established starting times from ${prettyDate(start)}. Later rows are changes, oldest to newest.${forceHint}${hoursHint}${noticeHint}`
    : `Each row is a full schedule. The first row is the established starting times. Later rows are changes, oldest to newest.${forceHint}${hoursHint}${noticeHint}`;

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
      '<tr><td colspan="13" class="empty">No clock times recorded yet.</td></tr>';
    return;
  }

  const columns = contractColumnsForHistory(rows);
  body.innerHTML =
    rows
      .map((row, index) => {
        const predicted = row.contracted?.status === 'predicted';
        const kind =
          row.kind === 'initial'
            ? 'Established'
            : `${row.segment === 'MIDDAY' ? 'Midday' : row.segment} change${
                row.delta_label ? ` · ${row.delta_label}` : ''
              }`;
        const column = columns[index];
        const actions =
          row.kind === 'change'
            ? `<button type="button" class="secondary js-delete-change">Remove</button>`
            : '';
        return `<tr class="is-history${predicted ? ' is-predicted' : ''}" style="--tone:${toneForRow(index)}" data-row-index="${index}"${
          row.change_id ? ` data-change-id="${escapeHtml(row.change_id)}"` : ''
        }${row.kind === 'initial' ? ' data-row-kind="initial"' : ''}${
          row.segment ? ` data-segment="${escapeHtml(row.segment)}"` : ''
        }>
        <td class="oct1-cell">${row.kind === 'change' ? forceOct1Toggle(row.force_oct1_contract) : ''}</td>
        <th scope="row">
          <input class="entry-input js-history-date" type="date" aria-label="New schedule started" value="${escapeHtml(row.date || '')}" />
          <span class="row-kind">${escapeHtml(kind)}</span>
        </th>
        ${RUNS.map((run) => {
          const item = row.schedule?.[run.id];
          const changed = row.segment === run.id;
          const source = timeSource(rows, index, run.id);
          return ['in', 'out']
            .map((which) => {
              const value = item ? toTimeInput(which === 'in' ? item.clock_in : item.clock_out) : '';
              return `<td class="${run.shade}${changed ? ' is-changed' : ''}">
                <input class="entry-input js-history-time" type="time" step="60" data-run="${run.id}" data-which="${which}" data-source-kind="${source.kind}"${
                  source.id ? ` data-source-id="${escapeHtml(source.id)}"` : ''
                } aria-label="${run.label} ${which === 'in' ? 'start' : 'end'}" value="${value}" />
              </td>`;
            })
            .join('');
        }).join('')}
        <td class="hours-figure">${escapeHtml(column.hours)}</td>
        <td>
          <div class="contracted-cell">
            <span class="contracted-date">${escapeHtml(column.contractedDate)}</span>
            ${contractedInfoControl(row)}
          </div>
        </td>
        <td class="hours-figure">${escapeHtml(column.contractHours)}</td>
        ${noticeSentCell(row)}
        <td>${actions}</td>
      </tr>`;
      })
      .join('') + entryRowMarkup(rows);
}

function forceOct1Toggle(on, id = '') {
  const idAttr = id ? ` id="${id}"` : '';
  return `<label class="oct1-toggle">
    <input${idAttr} class="js-force-oct1" type="checkbox" aria-label="Force Oct 1 Contract"${on ? ' checked' : ''} />
    <span class="oct1-state" data-off="Off" data-on="On"></span>
  </label>`;
}

function timeSource(rows, index, runId) {
  for (let i = index; i >= 0; i -= 1) {
    if (rows[i].kind === 'initial') return { kind: 'initial' };
    if (rows[i].segment === runId) return { kind: 'change', id: rows[i].change_id };
  }
  return { kind: 'initial' };
}

function latestSchedule(rows) {
  const last = rows[rows.length - 1];
  return last?.schedule || snapshot?.schedule || {};
}

function formatRecordedAt(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function contractedInfoControl(row) {
  const lines = [];
  const label = String(row.contracted?.label || '').trim();
  const outcome = String(row.contracted?.projected_outcome_label || '').trim();
  const detail = String(row.contracted?.detail || '').trim();
  if (label) lines.push(`<p class="change-stamp-status">${escapeHtml(label)}</p>`);
  if (outcome && !label.toLowerCase().includes(outcome.toLowerCase())) {
    lines.push(`<p>${escapeHtml(outcome)}</p>`);
  }
  if (detail && detail !== outcome && !label.toLowerCase().includes(detail.toLowerCase())) {
    lines.push(`<p class="change-stamp-comment">${escapeHtml(detail)}</p>`);
  }

  if (row.kind === 'change') {
    const entry = getCurrentProfile()?.changeLog?.find((item) => item.id === row.change_id);
    const routeName = String(getCurrentProfile()?.name || '').trim();
    const written = String(entry?.entered_by || '').trim();
    const name = written && written !== routeName ? written : '';
    const comment = String(entry?.note || row.note || '').trim();
    const when = formatRecordedAt(entry?.submitted_at);
    if (when) lines.push(`<p class="change-stamp-when">Recorded ${escapeHtml(when)}</p>`);
    lines.push('<p class="change-stamp-kicker">Recorded by</p>');
    lines.push(
      name
        ? `<p class="change-stamp-name">${escapeHtml(name)}</p>`
        : '<p class="change-stamp-comment">No account was recorded.</p>'
    );
    if (comment && comment !== name) {
      lines.push('<p class="change-stamp-kicker">Note</p>');
      lines.push(`<p class="change-stamp-comment">${escapeHtml(comment)}</p>`);
    }
  }

  if (!lines.length) return '';
  return `<span class="change-stamp-wrap">
    <button type="button" class="change-stamp js-change-stamp" aria-expanded="false" aria-label="Show contracted details, who recorded this, and the note">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    </button>
    <span class="change-stamp-pop" hidden>${lines.join('')}</span>
  </span>`;
}

function closeChangeStamps(except) {
  for (const pop of scheduleHistory.querySelectorAll('.change-stamp-pop')) {
    if (except && pop === except) continue;
    pop.hidden = true;
    pop.classList.remove('is-floating');
    pop.style.left = '';
    pop.style.top = '';
    pop.closest('.change-stamp-wrap')
      ?.querySelector('.js-change-stamp')
      ?.setAttribute('aria-expanded', 'false');
  }
}

function placeOpenStamp() {
  const stamp = scheduleHistory.querySelector('.js-change-stamp[aria-expanded="true"]');
  const pop = stamp?.parentElement?.querySelector('.change-stamp-pop');
  if (!stamp || !pop || pop.hidden) return;
  const rect = stamp.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
    closeChangeStamps();
    return;
  }
  pop.classList.add('is-floating');
  const margin = 8;
  const width = pop.offsetWidth || 256;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
  pop.style.left = `${left}px`;
  pop.style.top = `${rect.bottom + 6}px`;
  const popRect = pop.getBoundingClientRect();
  if (popRect.bottom > window.innerHeight - margin) {
    pop.style.top = `${Math.max(margin, rect.top - popRect.height - 6)}px`;
  }
}

function entryRowMarkup(rows) {
  const schedule = latestSchedule(rows);
  const lastDate = rows[rows.length - 1]?.date || '';
  const timeField = (run, which, value) =>
    `<input id="entry_${run.id}_${which}" class="entry-input" type="time" step="60" aria-label="${run.label} ${
      which === 'in' ? 'start' : 'end'
    }" value="${value ? toTimeInput(value) : ''}" />`;
  return `<tr class="is-entry is-new-change">
    <td class="oct1-cell">${forceOct1Toggle(false, 'entry_force_oct1')}</td>
    <th scope="row">
      <input id="entry_date" class="entry-input" type="date" aria-label="Date the change takes effect" value="${escapeHtml(lastDate)}" />
      <span class="row-kind">New time change</span>
    </th>
    ${RUNS.map((run) => {
      const item = schedule[run.id];
      return `<td class="${run.shade}">${timeField(run, 'in', item?.clock_in)}</td><td class="${run.shade}">${timeField(run, 'out', item?.clock_out)}</td>`;
    }).join('')}
    <td></td>
    <td class="is-editor">
      <label class="entry-editor" for="entry_editor">
        Comment
        <input id="entry_editor" class="entry-input" type="text" placeholder="Optional" />
      </label>
    </td>
    <td></td>
    <td></td>
    <td>
      <button type="button" id="add-change-row">Add this change</button>
    </td>
  </tr>`;
}

function isEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}

function noticeSentCell(row) {
  if (row.kind !== 'change' || !row.change_id) return '<td></td>';
  const sent = isChangeNoticeSent(row.change_id);
  return `<td class="notice-sent">
    <span class="notice-sent-value">${sent ? 'Yes' : 'No'}</span>
    <button type="button" class="secondary js-send-notice">${iconHtml('mail')} Send notice</button>
  </td>`;
}

async function sendChangeNotice(button) {
  const changeId = button.closest('[data-change-id]')?.dataset.changeId;
  const row = (snapshot?.schedule_history || []).find((item) => item.change_id === changeId);
  const profile = getCurrentProfile();
  if (!row || !profile || !changeId) return;
  const driverName = driverForDate(profile, row.date);
  if (!driverName) {
    setStatus(scheduleStatus, 'Assign a driver to this route before sending a notice.', 'error');
    return;
  }
  const driver = listDrivers().find((item) => sameDriver(item.name, driverName));
  const email = String(driver?.email || '').trim();
  if (!isEmailAddress(email)) {
    setStatus(
      scheduleStatus,
      `Add an email for ${driverName} on the Driver Name List before sending a notice.`,
      'error'
    );
    return;
  }
  const routeName = String(profile.name || '').trim();
  const mail = changeNoticeMail({
    driverName,
    routeName,
    row,
    asOf: getAsOfDate(),
    history: snapshot?.schedule_history || [],
  });
  const filename = noticeCalendarFilename(driverName);
  button.disabled = true;
  setStatus(scheduleStatus, `Opening the email and downloading ${filename}…`);
  try {
    await downloadCalendarPdf(filename);
    openNoticeMail({ to: email, subject: mail.subject, body: mail.body });
    explainCalendarDownload(filename);
    rememberChangeNoticeSent(changeId);
    setStatus(
      scheduleStatus,
      `Please look for ${filename} in your downloads folder and attach it. Notice sent is Yes for this change.`,
      'ok'
    );
    renderScheduleHistory();
  } catch (error) {
    setStatus(scheduleStatus, error.message, 'error');
    button.disabled = false;
  }
}

/**
 * @param {{ to: string, subject: string, body: string }} mail
 */
function openNoticeMail(mail) {
  const href = `mailto:${encodeURIComponent(mail.to)}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`;
  const link = document.createElement('a');
  link.href = href;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * @param {string} filename
 */
function explainCalendarDownload(filename) {
  const dialog = document.querySelector('#notice-download-dialog');
  const message = document.querySelector('#notice-download-message');
  if (!dialog || !message) return;
  message.textContent = `Please look for ${filename} in your downloads folder and attach it.`;
  if (!dialog.open) dialog.showModal();
}

function commitEntryRow() {
  const date = document.querySelector('#entry_date')?.value;
  if (!date) {
    setStatus(scheduleStatus, 'Enter the date this time change takes effect.', 'error');
    return;
  }
  const current = snapshot?.schedule || {};
  /** @type {Array<{ segment: string, clock_in: string, clock_out: string }>} */
  const changed = [];
  for (const run of RUNS) {
    const clockIn = document.querySelector(`#entry_${run.id}_in`)?.value || '';
    const clockOut = document.querySelector(`#entry_${run.id}_out`)?.value || '';
    const previous = current[run.id];
    if (!clockIn && !clockOut) continue;
    if (!clockIn || !clockOut) {
      setStatus(scheduleStatus, `${run.label} needs both a start and an end.`, 'error');
      return;
    }
    if (!previous) {
      setStatus(
        scheduleStatus,
        `${run.label} has no starting times. Add that run on the established row first.`,
        'error'
      );
      return;
    }
    const same =
      toTimeInput(previous.clock_in) === clockIn && toTimeInput(previous.clock_out) === clockOut;
    if (!same) changed.push({ segment: run.id, clock_in: clockIn, clock_out: clockOut });
  }
  if (!changed.length) {
    setStatus(
      scheduleStatus,
      'Change at least one clock time. This row starts as a copy of the latest schedule.',
      'error'
    );
    return;
  }
  const fields = attributionForChange(
    currentAccount(),
    document.querySelector('#entry_editor')?.value
  );
  try {
    for (const item of changed) {
      snapshot = recordChange({
        ...item,
        change_date: date,
        force_oct1_contract: document.querySelector('#entry_force_oct1')?.checked === true,
        ...fields,
      });
    }
    setStatus(scheduleStatus, 'Time change added on this device.', 'ok');
    renderApp();
  } catch (error) {
    setStatus(scheduleStatus, error.message, 'error');
  }
}

function routesForDriver(name) {
  return listProfiles()
    .filter((profile) => driverOwnsRoute(profile, name))
    .map((profile) => {
      const current = routeAssignments(profile).some(
        (item) => sameDriver(item.driver_name, name) && !item.until
      );
      return { name: profile.name, current };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function clockText(schedule, runId, which) {
  const item = schedule?.[runId];
  const value = item ? (which === 'in' ? item.clock_in : item.clock_out) : '';
  return value ? escapeHtml(value) : '—';
}

function currentStatusMarkup(view) {
  const windowInfo = view?.window;
  if (!windowInfo) return '—';
  const details = [];
  if (windowInfo.becomes_contracted_on) {
    details.push(`Becomes contracted ${prettyDate(windowInfo.becomes_contracted_on)}`);
  }
  if (windowInfo.status === 'ACCUMULATING' && windowInfo.cumulative_drift_label) {
    details.push(windowInfo.cumulative_drift_label);
  }
  const extra = details
    .map((line) => `<span class="status-detail">${escapeHtml(line)}</span>`)
    .join('');
  return `${escapeHtml(windowInfo.status_label || '—')}${extra}`;
}

function renderAllRoutes() {
  const profiles = listProfiles();
  const body = allRoutesSheet.querySelector('tbody');
  if (!profiles.length) {
    body.innerHTML =
      '<tr><td colspan="10" class="empty">No routes yet.</td></tr>';
    return;
  }
  const asOf = getAsOfDate();
  body.innerHTML = profiles
    .map((profile) => {
      const view = buildSnapshot(profile, asOf);
      const schedule = view.schedule || {};
      const driver = String(profile.driver_name || '').trim();
      const driverCell = driver
        ? `<button type="button" class="route-jump js-open-driver" data-driver-name="${escapeHtml(driver)}">${escapeHtml(driver)}</button>`
        : '—';
      return `<tr>
        <th scope="row"><button type="button" class="route-jump js-open-route" data-route-id="${escapeHtml(profile.id)}">${escapeHtml(profile.name || 'Unnamed')}</button></th>
        <td>${driverCell}</td>
        <td class="times">${clockText(schedule, 'AM', 'in')}</td>
        <td class="times">${clockText(schedule, 'AM', 'out')}</td>
        <td class="times">${clockText(schedule, 'MIDDAY', 'in')}</td>
        <td class="times">${clockText(schedule, 'MIDDAY', 'out')}</td>
        <td class="times">${clockText(schedule, 'PM', 'in')}</td>
        <td class="times">${clockText(schedule, 'PM', 'out')}</td>
        <td>${escapeHtml(view.contracted?.label || '—')}</td>
        <td>${currentStatusMarkup(view)}</td>
      </tr>`;
    })
    .join('');
}

function driverDraftFromRow(row) {
  return {
    firstName: row.querySelector('.js-driver-first')?.value ?? '',
    lastName: row.querySelector('.js-driver-last')?.value ?? '',
    email: row.querySelector('.js-driver-email')?.value ?? '',
  };
}

function renderDrivers() {
  const drivers = listDrivers();
  const body = driverSheet.querySelector('tbody');
  const rows = drivers
    .map((driver, index) => {
      const routes = routesForDriver(driver.name);
      const routeLabel = routes
        .map((route) => (route.current ? route.name : `${route.name} (earlier)`))
        .join(', ');
      const who = driver.name;
      return `<tr data-driver-id="${escapeHtml(driver.id)}">
        <th class="sheet-rowhead" scope="row">${index + 1}</th>
        <td><input class="entry-input js-driver-first" type="text" autocomplete="given-name" value="${escapeHtml(driver.firstName)}" aria-label="First name for ${escapeHtml(who)}" /></td>
        <td><input class="entry-input js-driver-last" type="text" autocomplete="family-name" value="${escapeHtml(driver.lastName)}" aria-label="Last name for ${escapeHtml(who)}" /></td>
        <td><input class="entry-input js-driver-email" type="email" autocomplete="email" value="${escapeHtml(driver.email)}" aria-label="Email for ${escapeHtml(who)}" placeholder="name@example.com" /></td>
        <td class="sheet-readonly">${routeLabel ? escapeHtml(routeLabel) : ''}</td>
      </tr>`;
    })
    .join('');
  body.innerHTML = `${rows}<tr class="is-entry" data-driver-id="">
    <th class="sheet-rowhead" scope="row">${drivers.length + 1}</th>
    <td><input class="entry-input js-driver-first" type="text" autocomplete="off" aria-label="New driver first name" placeholder="First" /></td>
    <td><input class="entry-input js-driver-last" type="text" autocomplete="off" aria-label="New driver last name" placeholder="Last" /></td>
    <td><input class="entry-input js-driver-email" type="email" autocomplete="off" aria-label="New driver email" placeholder="name@example.com" /></td>
    <td class="sheet-readonly"></td>
  </tr>`;
}

function renderHistoryLegend(rows) {
  if (!historyLegend) return;
  historyLegend.innerHTML = historyLegendHtml(rows);
}

function renderCalendar() {
  const rows = snapshot?.schedule_history || [];
  renderHistoryLegend(rows);
  calendarMonths.innerHTML = calendarMonthsHtml({
    calendar: calendarPayload(),
    rows,
    asOf: snapshot?.as_of || localDateString(),
  });
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

function heldLabel(assignment) {
  if (!assignment?.from) return '';
  if (!assignment.until) return `Since ${prettyDate(assignment.from)}`;
  return `${prettyDate(assignment.from)} – ${prettyDate(dayBefore(assignment.until))}`;
}

function renderDriverHistory() {
  const name = viewingDriver;
  driverHistoryTitle.textContent = `Clock-time history for ${name}`;
  const built = sectionsForDriver({
    driverName: name,
    profiles: listProfiles(),
    asOf: getAsOfDate(),
  });
  if (!built) {
    driverHistoryLead.textContent = `${name} has no route history on this device.`;
    driverHistoryBody.innerHTML = '';
    document.title = PAGE_TITLE;
    return;
  }
  const listed = built.routeNames.join(', ');
  driverHistoryLead.textContent =
    built.routeNames.length === 1
      ? `Route ${listed}, including each change while ${name} held it.`
      : `Routes ${listed}, including each change while ${name} held them.`;
  document.title = `Clock-time history for ${name}`;
  const calendar = calendarPayload();
  driverHistoryBody.innerHTML = built.sections
    .map((section) => {
      const rows = section.snapshot?.schedule_history || [];
      const held = heldLabel(section.assignment);
      return `<section class="driver-history-route">
        <h2 class="panel-title">${iconHtml('clock')} Route ${escapeHtml(section.routeName)}</h2>
        ${held ? `<p class="lead">${escapeHtml(held)}</p>` : ''}
        <div class="table-wrap">${scheduleHistoryTableHtml(section.snapshot)}</div>
        <h3>Calendar</h3>
        <ul class="history-legend">${historyLegendHtml(rows)}</ul>
        <div class="calendar-months">${calendarMonthsHtml({
          calendar,
          rows,
          asOf: section.snapshot?.as_of || built.asOf,
        })}</div>
      </section>`;
    })
    .join('');
}

function renderApp() {
  renderRouteTabs();
  const onDrivers = activeSheet === 'drivers' && !addingPerson;
  const onAll = activeSheet === 'all' && !addingPerson;
  const onDriverHistory = activeSheet === 'driver-history' && !addingPerson;
  const onTimesheet = activeSheet === 'timesheets' && !addingPerson;
  if (routeTabs) routeTabs.hidden = onTimesheet;
  if (timesheetView) timesheetView.hidden = !onTimesheet;
  if (onTimesheet) {
    driversView.hidden = true;
    allRoutesView.hidden = true;
    driverHistoryView.hidden = true;
    setupView.hidden = true;
    appView.hidden = true;
    document.title = 'Timesheet reader';
    timesheetDesk.refresh();
    return;
  }
  document.title = PAGE_TITLE;
  driversView.hidden = !onDrivers;
  allRoutesView.hidden = !onAll;
  driverHistoryView.hidden = !onDriverHistory;
  if (onDrivers) {
    setupView.hidden = true;
    appView.hidden = true;
    renderDrivers();
    return;
  }
  if (onAll) {
    setupView.hidden = true;
    appView.hidden = true;
    document.title = PAGE_TITLE;
    renderAllRoutes();
    return;
  }
  if (onDriverHistory) {
    setupView.hidden = true;
    appView.hidden = true;
    renderDriverHistory();
    return;
  }
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
      force_oct1_contract: document.querySelector('#change_force_oct1')?.checked === true,
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
      force_oct1_contract: document.querySelector('#change_force_oct1')?.checked === true,
      ...attributionForChange(currentAccount(), document.querySelector('#change_note').value),
    });
    document.querySelector('#change_note').value = '';
    const forceOct1 = document.querySelector('#change_force_oct1');
    if (forceOct1) forceOct1.checked = false;
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
  const forceOct1 = document.querySelector('#change_force_oct1');
  if (forceOct1) forceOct1.checked = false;
  updatePreview();
});
for (const id of ['clock_in', 'clock_out', 'change_date', 'change_force_oct1']) {
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

/**
 * @param {BlobPart} bytes
 * @param {string} filename
 */
function downloadWorkbook(bytes, filename) {
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * @param {number} changed
 */
function payrollCompareStatus(changed) {
  if (changed === 0) return 'No rows differ from the last file sent to payroll.';
  if (changed === 1) {
    return '1 row is bold and highlighted. It differs from the last file sent to payroll.';
  }
  return `${changed} rows are bold and highlighted. They differ from the last file sent to payroll.`;
}

/**
 * @param {string[]} routes
 */
function renderPayrollHighlightChoices(routes) {
  const list = document.querySelector('#payroll-highlight-routes');
  const lead = document.querySelector('#payroll-highlight-lead');
  const empty = document.querySelector('#payroll-highlight-empty');
  list.innerHTML = routes
    .map(
      (route) => `<li>
        <label>
          <input type="checkbox" name="payroll-highlight" value="${escapeHtml(route)}" checked />
          <span>${escapeHtml(route)}</span>
        </label>
      </li>`
    )
    .join('');
  const hasRoutes = routes.length > 0;
  list.hidden = !hasRoutes;
  lead.hidden = !hasRoutes;
  empty.hidden = hasRoutes;
}

/**
 * Route numbers still checked in the payroll dialog.
 * @returns {string[]}
 */
function checkedPayrollRoutes() {
  return [...document.querySelectorAll('#payroll-highlight-routes input:checked')].map(
    (input) => input.value
  );
}

/**
 * @param {string[]} routes
 */
function payrollSessionStatus(routes) {
  if (!routes.length) return 'No rows are highlighted.';
  const list = routes.join(', ');
  if (routes.length === 1) {
    return `Route ${list} is bold and highlighted. It was changed during this visit.`;
  }
  return `Routes ${list} are bold and highlighted. They were changed during this visit.`;
}

/**
 * @returns {Promise<File | string[] | null>} the last payroll file, the routes left checked, or null to cancel
 */
function askForPreviousPayrollFile() {
  const dialog = document.querySelector('#payroll-compare-dialog');
  const fileInput = document.querySelector('#payroll-previous-file');
  const uploadBtn = document.querySelector('#payroll-compare-upload');
  const createBtn = document.querySelector('#payroll-compare-create');
  const closeBtn = document.querySelector('#payroll-compare-close');
  return new Promise((resolve) => {
    /** @type {File | string[] | null} */
    let result = null;
    const onClose = () => {
      uploadBtn.removeEventListener('click', onUpload);
      createBtn.removeEventListener('click', onCreate);
      closeBtn.removeEventListener('click', onCancel);
      fileInput.removeEventListener('change', onFile);
      dialog.removeEventListener('close', onClose);
      fileInput.value = '';
      resolve(result);
    };
    const onUpload = () => fileInput.click();
    const onCreate = () => {
      result = checkedPayrollRoutes();
      dialog.close();
    };
    const onCancel = () => {
      result = null;
      dialog.close();
    };
    const onFile = () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      result = file;
      dialog.close();
    };
    uploadBtn.addEventListener('click', onUpload);
    createBtn.addEventListener('click', onCreate);
    closeBtn.addEventListener('click', onCancel);
    fileInput.addEventListener('change', onFile);
    dialog.addEventListener('close', onClose);
    renderPayrollHighlightChoices(sessionModifiedRouteNames());
    dialog.showModal();
  });
}

document.querySelector('#payroll-export-btn').addEventListener('click', async () => {
  setStatus(fileStatus, '');
  const choice = await askForPreviousPayrollFile();
  if (choice === null) return;
  try {
    const createdAt = new Date();
    const filename = payrollWorkbookFilename(createdAt);
    /** @type {{ changedCount?: number }} */
    const result = {};
    const previousFile = choice instanceof File ? choice : null;
    const previousRows = previousFile
      ? await rowsFromPayrollWorkbook(await previousFile.arrayBuffer())
      : null;
    const sessionRoutes = Array.isArray(choice) ? choice : null;
    const bytes = await buildPayrollWorkbook(
      { ...loadState(), asOf: getAsOfDate() },
      {
        title: workbookTitleFromFilename(filename),
        createdAt,
        previousRows,
        highlightRoutes: sessionRoutes,
        result,
      }
    );
    downloadWorkbook(bytes, filename);
    if (previousRows) setStatus(fileStatus, payrollCompareStatus(result.changedCount ?? 0), 'ok');
    else setStatus(fileStatus, payrollSessionStatus(sessionRoutes ?? []), 'ok');
  } catch (error) {
    setStatus(fileStatus, error.message || 'Could not create the payroll spreadsheet.', 'error');
  }
});

document.querySelector('#export-btn').addEventListener('click', async () => {
  setStatus(fileStatus, '');
  try {
    const createdAt = new Date();
    const filename = stampedWorkbookFilename(ROUTE_DATA_FILE_BASE, createdAt);
    const bytes = await buildRouteWorkbook(
      {
        ...loadState(),
        asOf: getAsOfDate(),
        noticeSentIds: loadSentChangeIds(),
      },
      {
        title: workbookTitleFromFilename(filename),
        createdAt,
      }
    );
    downloadWorkbook(bytes, filename);
  } catch (error) {
    setStatus(fileStatus, error.message || 'Could not create the Excel file.', 'error');
  }
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

document.querySelector('#change-dialog-close').addEventListener('click', closeChangeDialog);
document.querySelector('#notice-download-close')?.addEventListener('click', () => {
  document.querySelector('#notice-download-dialog')?.close();
});
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
  const forceOct1 = document.querySelector('#change_edit_force_oct1');
  if (forceOct1) forceOct1.checked = Boolean(change.force_oct1_contract);
  startEditForm.hidden = true;
  changeEditForm.hidden = false;
  setStatus(changeEditStatus, '');
  changeEditForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function rowTime(row, runId, which) {
  return row.querySelector(`.js-history-time[data-run="${runId}"][data-which="${which}"]`)?.value || '';
}

function saveHistoryEdit(input) {
  const row = input.closest('tr');
  if (!row) return;
  const date = row.querySelector('.js-history-date')?.value;
  if (!date) {
    setStatus(scheduleStatus, 'Enter the date this schedule took effect.', 'error');
    return;
  }
  try {
    if (row.dataset.rowKind === 'initial') {
      const profile = getCurrentProfile();
      const body = { name: profile?.name || '', start_date: date, driver: profile?.driver_name || '' };
      for (const run of RUNS) {
        const key = run.id.toLowerCase();
        body[`${key}_in`] = rowTime(row, run.id, 'in');
        body[`${key}_out`] = rowTime(row, run.id, 'out');
      }
      snapshot = updateStartingSchedule(body);
    } else {
      const sourceKind = input.classList.contains('js-history-date')
        ? 'change'
        : input.dataset.sourceKind;
      const sourceId = input.classList.contains('js-history-date')
        ? row.dataset.changeId
        : input.dataset.sourceId || row.dataset.changeId;
      const runId = input.dataset.run || row.dataset.segment;
      if (sourceKind === 'initial' || !sourceId) {
        const profile = getCurrentProfile();
        const fields = startingScheduleFields();
        const body = {
          name: profile?.name || fields.name,
          start_date: fields.start_date,
          driver: profile?.driver_name || '',
        };
        for (const run of RUNS) {
          const key = run.id.toLowerCase();
          const item = fields.segments[run.id];
          body[`${key}_in`] = run.id === runId ? rowTime(row, run.id, 'in') : item?.clock_in || '';
          body[`${key}_out`] = run.id === runId ? rowTime(row, run.id, 'out') : item?.clock_out || '';
        }
        snapshot = updateStartingSchedule(body);
      } else {
        const sourceRow = scheduleHistory.querySelector(`[data-change-id="${sourceId}"]`);
        const changeDate = sourceRow?.querySelector('.js-history-date')?.value || date;
        const forceInput = (sourceRow || row).querySelector('.js-force-oct1');
        snapshot = updateChange(sourceId, {
          change_date: changeDate,
          clock_in: rowTime(sourceRow || row, runId, 'in'),
          clock_out: rowTime(sourceRow || row, runId, 'out'),
          ...(forceInput ? { force_oct1_contract: forceInput.checked } : {}),
        });
      }
    }
    setStatus(scheduleStatus, 'Schedule corrected on this device.', 'ok');
    renderApp();
  } catch (error) {
    setStatus(scheduleStatus, error.message, 'error');
  }
}

document.addEventListener('click', (event) => {
  if (event.target.closest('.change-stamp-wrap')) return;
  closeChangeStamps();
});

window.addEventListener('scroll', placeOpenStamp, true);
window.addEventListener('resize', placeOpenStamp);

scheduleHistory.addEventListener('change', (event) => {
  const input = event.target.closest('.js-history-date, .js-history-time, .js-force-oct1');
  if (!input || input.closest('.is-new-change')) return;
  saveHistoryEdit(input);
});

scheduleHistory.addEventListener('click', (event) => {
  const stamp = event.target.closest('.js-change-stamp');
  if (stamp) {
    const pop = stamp.parentElement?.querySelector('.change-stamp-pop');
    const willOpen = pop?.hidden !== false;
    closeChangeStamps(willOpen ? pop : null);
    if (pop) {
      pop.hidden = !willOpen;
      stamp.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) placeOpenStamp();
      else {
        pop.classList.remove('is-floating');
        pop.style.left = '';
        pop.style.top = '';
      }
    }
    return;
  }
  const sendNotice = event.target.closest('.js-send-notice');
  if (sendNotice) {
    sendChangeNotice(sendNotice);
    return;
  }
  if (event.target.closest('#add-change-row')) {
    commitEntryRow();
    return;
  }
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
      force_oct1_contract: document.querySelector('#change_edit_force_oct1')?.checked === true,
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

document.querySelector('#add-driver-row').addEventListener('click', () => {
  const row = driverSheet.querySelector('tr.is-entry');
  if (!row) return;
  try {
    saveDriver(driverDraftFromRow(row));
    setStatus(driverStatus, 'Driver added on this device.', 'ok');
    renderDrivers();
  } catch (error) {
    setStatus(driverStatus, error.message, 'error');
  }
});

driverSheet.addEventListener('change', (event) => {
  const input = event.target.closest('.entry-input');
  const row = event.target.closest('tr[data-driver-id]');
  if (!input || !row?.dataset.driverId) return;
  const driver = listDrivers().find((item) => item.id === row.dataset.driverId);
  if (!driver) return;
  try {
    saveDriver({
      id: driver.id,
      previousName: driver.name,
      ...driverDraftFromRow(row),
    });
    setStatus(driverStatus, 'Driver sheet saved on this device.', 'ok');
    renderDrivers();
  } catch (error) {
    setStatus(driverStatus, error.message, 'error');
  }
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

allRoutesSheet.addEventListener('click', (event) => {
  const routeButton = event.target.closest('.js-open-route');
  if (routeButton?.dataset.routeId) {
    chooseRoute(routeButton.dataset.routeId);
    return;
  }
  const driverButton = event.target.closest('.js-open-driver');
  if (!driverButton?.dataset.driverName) return;
  showDriverHistory(driverButton.dataset.driverName);
});

document.querySelector('#driver-history-back')?.addEventListener('click', showAllRoutes);

function recentChangeSummary(item, index, total) {
  const who = item.enteredBy ? `Recorded by ${item.enteredBy}.` : 'No account was recorded.';
  const when = formatRecordedAt(item.submittedAt);
  const recorded = when ? `Recorded ${when}.` : 'Recorded time was not saved.';
  const effect = item.effectiveDate ? ` Takes effect ${prettyDate(item.effectiveDate)}.` : '';
  const note = item.note ? ` ${item.note}` : '';
  return `${index + 1} of ${total}. Route ${item.routeName}, ${item.segmentLabel}, ${item.previousTime} to ${item.newTime}.${effect} ${recorded} ${who}${note}`;
}

function recentChangeCardHtml(item, index, total) {
  const who = item.enteredBy
    ? `Recorded by ${escapeHtml(item.enteredBy)}`
    : 'No account was recorded.';
  const when = formatRecordedAt(item.submittedAt);
  const recorded = when ? `Recorded ${escapeHtml(when)}` : 'Recorded time was not saved.';
  const effect = item.effectiveDate
    ? `<p class="recent-changes-effect">Takes effect ${escapeHtml(prettyDate(item.effectiveDate))}</p>`
    : '';
  const note = item.note ? `<p class="recent-changes-note">${escapeHtml(item.note)}</p>` : '';
  const hidden = index === 0 ? '' : ' aria-hidden="true"';
  return `<article class="recent-changes-card" data-index="${index}" aria-roledescription="slide" aria-label="${index + 1} of ${total}"${hidden}>
    <p class="recent-changes-title">Route ${escapeHtml(item.routeName)} · ${escapeHtml(item.segmentLabel)}</p>
    <p class="recent-changes-times">${escapeHtml(item.previousTime)} <span aria-hidden="true">→</span> ${escapeHtml(item.newTime)}</p>
    ${effect}
    <p class="recent-changes-when">${recorded}</p>
    <p class="recent-changes-who">${who}</p>
    ${note}
  </article>`;
}

function recentChangeIndexFromScroll() {
  const width = recentChangesTrack?.clientWidth || 0;
  if (!width || recentChangeItems.length < 2) return 0;
  return Math.min(
    recentChangeItems.length - 1,
    Math.max(0, Math.round(recentChangesTrack.scrollLeft / width))
  );
}

function syncRecentChangePosition(announce) {
  if (!recentChangesCount || !recentChangesTrack) return;
  const total = recentChangeItems.length;
  if (!total) return;
  const index = recentChangeIndexFromScroll();
  const changed = index !== recentChangeIndex;
  recentChangeIndex = index;
  recentChangesCount.textContent = `${index === 0 ? 'Most recent · ' : ''}${index + 1} of ${total}`;
  if (recentChangesNewer) recentChangesNewer.disabled = index <= 0;
  if (recentChangesOlder) recentChangesOlder.disabled = index >= total - 1;
  for (const card of recentChangesTrack.querySelectorAll('.recent-changes-card')) {
    const cardIndex = Number(card.getAttribute('data-index'));
    if (cardIndex === index) card.removeAttribute('aria-hidden');
    else card.setAttribute('aria-hidden', 'true');
  }
  if ((announce || changed) && recentChangesLive) {
    recentChangesLive.textContent = recentChangeSummary(recentChangeItems[index], index, total);
  }
}

function scrollRecentChanges(delta) {
  if (!recentChangesTrack || recentChangeItems.length < 2) return;
  const width = recentChangesTrack.clientWidth;
  if (!width) return;
  const next = Math.min(recentChangeItems.length - 1, Math.max(0, recentChangeIndexFromScroll() + delta));
  recentChangesTrack.scrollTo({ left: next * width, behavior: 'smooth' });
}

/**
 * @param {Parameters<typeof recentRouteChanges>[0]} state
 */
function showRecentRouteChanges(state) {
  if (!recentChangesBox || !recentChangesTrack) return;
  recentChangeItems = recentRouteChanges(state);
  recentChangeIndex = -1;
  setStatus(fileStatus, '');
  recentChangesBox.hidden = false;
  const total = recentChangeItems.length;
  const canScroll = total > 1;
  if (recentChangesNewer) recentChangesNewer.hidden = !canScroll;
  if (recentChangesOlder) recentChangesOlder.hidden = !canScroll;
  if (!total) {
    recentChangesTrack.innerHTML =
      '<p class="recent-changes-empty">No clock-time changes are recorded yet.</p>';
    if (recentChangesCount) recentChangesCount.textContent = '';
    if (recentChangesLive) recentChangesLive.textContent = 'No clock-time changes are recorded yet.';
    return;
  }
  recentChangesTrack.innerHTML = recentChangeItems
    .map((item, index) => recentChangeCardHtml(item, index, total))
    .join('');
  recentChangesTrack.style.scrollBehavior = 'auto';
  recentChangesTrack.scrollLeft = 0;
  recentChangesTrack.style.scrollBehavior = '';
  syncRecentChangePosition(true);
}

recentChangesNewer?.addEventListener('click', () => scrollRecentChanges(-1));
recentChangesOlder?.addEventListener('click', () => scrollRecentChanges(1));
recentChangesTrack?.addEventListener('scroll', () => syncRecentChangePosition(false), { passive: true });
recentChangesBox?.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    scrollRecentChanges(1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    scrollRecentChanges(-1);
  }
});

/**
 * Replace the fictional sample with employee-data/office-state.json when that
 * file has been copied to the dashboard as starter-office.json.
 */
async function adoptStarterOffice() {
  if (!isSampleOffice(loadState())) return;
  let response;
  try {
    response = await fetch('/starter-office.json', { cache: 'no-store' });
  } catch {
    return;
  }
  if (!response.ok) return;
  const next = await response.json();
  if (!next || next.version !== 1 || !next.profiles || !Object.keys(next.profiles).length) return;
  saveState({
    version: 1,
    currentProfileId: next.currentProfileId ?? null,
    profiles: next.profiles,
    drivers: Array.isArray(next.drivers) ? next.drivers : [],
    exampleVersion: 0,
  });
}

const timesheetDesk = mountTimesheetReader({
  readState: loadState,
  asOf: getAsOfDate,
});

renderSetupRuns();
startAccounts({
  onReady() {
    (async () => {
      try {
        ensureExampleRoutes();
        await adoptStarterOffice();
        beginSessionRouteTracking();
        loadAll();
      } catch (error) {
        setStatus(setupStatus, error.message, 'error');
        setupView.hidden = false;
      }
    })();
  },
  onRemoteReset() {
    loadAll();
    showRecentRouteChanges(loadState());
  },
}).catch((error) => {
  document.body.classList.remove('is-booting');
  setStatus(setupStatus, error.message || 'Could not start accounts.', 'error');
  setupView.hidden = false;
});

initCitations();
