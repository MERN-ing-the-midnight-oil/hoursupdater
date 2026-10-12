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
  deleteDriver,
  deleteProfile,
  getCurrentProfile,
  importState,
  listDrivers,
  compareRouteNumbers,
  listProfiles,
  loadContractReminder,
  loadCreatedContractEvents,
  loadDriverNotice,
  loadReminderSignatures,
  loadState,
  rememberPublishedReminders,
  saveContractReminder,
  saveDriver,
  saveDriverNotice,
  saveProfile,
  saveState,
  setCurrentProfile,
  STORAGE_KEY,
  beginSessionRouteTracking,
} from './store.js';
import {
  ROUTE_DATA_FILE_BASE,
  payrollWorkbookFilename,
  stampedWorkbookFilename,
  workbookTitleFromFilename,
} from '../src/downloadName.js';
import {
  buildPayrollWorkbook,
  changedPayrollLabels,
  payrollBaselineRows,
  payrollDriverRows,
} from '../src/payrollTimes.js';
import { buildRouteWorkbook } from '../src/routeWorkbook.js';
import {
  startAccounts,
  currentAccount,
  accountsEnabled,
  listOfficeUsers,
  loadPayrollBaseline,
  savePayrollBaseline,
  whenSharedOfficeSaved,
} from './accounts.js';
import { attributionForChange } from './attribution.js';
import { recentRouteChanges } from '../src/recentChanges.js';
import { ensureExampleRoutes, isSampleOffice } from './exampleRoutes.js';
import { mountClockDesk } from './clockDesk.js';
import { mountTimeclock } from './timeclockKiosk.js';
import { driverPayStatusChoices, normalizeClockPayDefaults, normalizeDriverPay } from '../src/driverPay.js';

bindCalculatorStore({
  deleteProfile,
  getCurrentProfile,
  importState,
  listProfiles,
  saveProfile,
  setCurrentProfile,
});
import { localDateString } from '../../employee-tracker/src/clockTimes.js';
import { getSchoolDays } from '../../src/logic/calendar.js';
import { earlyReleaseClock, isEarlyReleaseDate } from '../../src/logic/earlyRelease.js';
import { assignRouteDriver, assignmentOnDate, dayBefore, driverForDate, driverOwnsRoute, routeAssignments, sameDriver } from '../src/assignments.js';
import { duplicateRunRoutes, joinRunLabels, runClocksFromOriginalRoute, runTypeLabel } from '../src/duplicateRuns.js';
import { sectionsForDriver } from '../src/driverPacket.js';
import {
  DEFAULT_REMINDER_BODY,
  DEFAULT_REMINDER_SUBJECT,
  buildContractReminderCalendar,
  combineRemindersByDay,
  fillReminderTemplate,
  isPredictedContract,
  planReminderPublish,
  prepareContractReminder,
  reminderDayFilename,
} from '../src/contractReminder.js';
import {
  DEFAULT_DRIVER_NOTICE_BODY,
  DEFAULT_DRIVER_NOTICE_SUBJECT,
  DEFAULT_MEMORANDUM_ID,
  DRIVER_MEMORANDA,
  isChangeNoticeSent,
  loadSentChangeIds,
  memorandumMail,
  noticeCalendarFilename,
  rememberChangeNoticeSent,
  routeHistoryFilename,
  routeHistoryMail,
  timeChangeNoticeDocument,
} from '../src/noticeMail.js';
import { downloadCalendarPdf } from './noticeCalendarPdf.js';
import { downloadTextPdf } from './noticeDocumentPdf.js';
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

const APP_TITLE = 'Teamster Tracker';
const PAGE_TITLE = `Time Changes · ${APP_TITLE}`;

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
const payrollStatus = document.querySelector('#payroll-status');
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
const calendarMonths = document.querySelector('#calendar-months');
const historyLegend = document.querySelector('#history-legend');
const routeTabs = document.querySelector('#route-tabs');
const driversTab = document.querySelector('#drivers-tab');
const dashboardApp = document.querySelector('#dashboard-app');
const payrollTab = document.querySelector('#payroll-tab');
const clockingTab = document.querySelector('#clocking-tab');
const payrollView = document.querySelector('#payroll-view');
const clockingView = document.querySelector('#clocking-view');
const timeclockSettingsView = document.querySelector('#timeclock-settings-view');
const adminReminderTab = document.querySelector('#admin-reminder-tab');
const driverNoticeTab = document.querySelector('#driver-notice-tab');
const adminReminderView = document.querySelector('#admin-reminder-view');
const driverNoticeView = document.querySelector('#driver-notice-view');
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
const officeSection = new URLSearchParams(location.search).get('section');
const driversApp = officeSection === 'clock-records' ? 'clocking' : officeSection === 'drivers' ? 'payroll' : '';
const driversWindow = Boolean(driversApp);
if (driversWindow) {
  document.body.classList.add('is-drivers-window');
  document.body.dataset.driversApp = driversApp;
}
let activeSheet = driversApp === 'clocking' ? 'clocking' : driversApp === 'payroll' ? 'payroll' : 'drivers';
let viewingDriver = '';
let sheetBeforeOffice = 'drivers';

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
  const onPayroll = activeSheet === 'payroll' && !addingPerson;
  const onClocking = activeSheet === 'clocking' && !addingPerson;
  const onClockSettings = activeSheet === 'clock-settings' && !addingPerson;
  const onOfficeApp = onPayroll || onClocking || onClockSettings;
  const onAdminReminder = activeSheet === 'admin-reminder' && !addingPerson;
  const onDriverNotice = activeSheet === 'driver-notice' && !addingPerson;
  const onRoute =
    !addingPerson &&
    !onDrivers &&
    !onAll &&
    !onDriverHistory &&
    !onOfficeApp &&
    !onAdminReminder &&
    !onDriverNotice;
  const currentId = onRoute ? getCurrentProfile()?.id : null;
  driversTab.classList.toggle('is-active', onDrivers);
  driversTab.setAttribute('aria-selected', onDrivers ? 'true' : 'false');
  dashboardApp?.classList.toggle('is-active', !onOfficeApp);
  payrollTab?.classList.toggle('is-active', onPayroll);
  clockingTab?.classList.toggle('is-active', onClocking || onClockSettings);
  dashboardApp?.removeAttribute('aria-current');
  payrollTab?.removeAttribute('aria-current');
  clockingTab?.removeAttribute('aria-current');
  if (onPayroll) payrollTab?.setAttribute('aria-current', 'page');
  else if (onClocking || onClockSettings) clockingTab?.setAttribute('aria-current', 'page');
  else dashboardApp?.setAttribute('aria-current', 'page');
  adminReminderTab?.classList.toggle('is-active', onAdminReminder);
  adminReminderTab?.setAttribute('aria-selected', onAdminReminder ? 'true' : 'false');
  driverNoticeTab?.classList.toggle('is-active', onDriverNotice);
  driverNoticeTab?.setAttribute('aria-selected', onDriverNotice ? 'true' : 'false');
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
    activeSheet !== 'payroll' &&
    activeSheet !== 'clocking' &&
    activeSheet !== 'clock-settings' &&
    activeSheet !== 'admin-reminder' &&
    activeSheet !== 'driver-notice' &&
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

function openOfficeWindow(app) {
  const clocking = app === 'clocking';
  const status = document.querySelector(clocking ? '#clock-records-open-status' : '#drivers-open-status');
  const url = new URL('./', location.href);
  url.searchParams.set('section', clocking ? 'clock-records' : 'drivers');
  const opened = window.open(
    url.href,
    clocking ? 'teamster-clock-records' : 'teamster-drivers',
    'popup,width=1100,height=820'
  );
  if (!opened) {
    if (status) {
      status.hidden = false;
      status.textContent = clocking
        ? 'Allow pop-up windows for this site, then open Clock records again.'
        : 'Allow pop-up windows for this site, then open Drivers again.';
    }
    return;
  }
  if (status) {
    status.hidden = true;
    status.textContent = '';
  }
  opened.focus();
}

function rememberOfficeSheet() {
  if (activeSheet !== 'payroll' && activeSheet !== 'clocking' && activeSheet !== 'clock-settings') {
    sheetBeforeOffice = activeSheet === 'driver-history' ? 'drivers' : activeSheet;
  }
}

function showPayroll() {
  rememberOfficeSheet();
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'payroll';
  loadAll();
  payrollView?.scrollIntoView({ block: 'start' });
}

function showClocking() {
  rememberOfficeSheet();
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'clocking';
  loadAll();
  clockingView?.scrollIntoView({ block: 'start' });
}

function showClockSettings() {
  rememberOfficeSheet();
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'clock-settings';
  loadAll();
  timeclockSettingsView?.scrollIntoView({ block: 'start' });
}

function showDashboardApp() {
  if (activeSheet !== 'payroll' && activeSheet !== 'clocking' && activeSheet !== 'clock-settings') return;
  const back = sheetBeforeOffice;
  if (back === 'all') {
    showAllRoutes();
    return;
  }
  if (back === 'admin-reminder' || back === 'reminders') {
    showAdminReminder();
    return;
  }
  if (back === 'driver-notice') {
    showDriverNotice();
    return;
  }
  if (
    back &&
    back !== 'drivers' &&
    back !== 'payroll' &&
    back !== 'clocking' &&
    back !== 'clock-settings' &&
    peopleList().some((person) => person.id === back)
  ) {
    chooseRoute(back);
    return;
  }
  showDrivers();
}

function showAdminReminder() {
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'admin-reminder';
  loadAll();
  fillReminderSettings();
}

function showDriverNotice() {
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'driver-notice';
  loadAll();
  fillDriverNoticeSettings();
}

driversTab.addEventListener('click', showDrivers);
dashboardApp?.addEventListener('click', showDashboardApp);
payrollTab?.addEventListener('click', showPayroll);
clockingTab?.addEventListener('click', showClocking);
document.querySelector('#open-drivers')?.addEventListener('click', () => openOfficeWindow('payroll'));
document.querySelector('#open-clock-records')?.addEventListener('click', () => openOfficeWindow('clocking'));
document.querySelector('#timeclock-settings-open')?.addEventListener('click', showClockSettings);
document.querySelector('#timeclock-settings-back')?.addEventListener('click', showClocking);
adminReminderTab?.addEventListener('click', showAdminReminder);
driverNoticeTab?.addEventListener('click', showDriverNotice);

/** @type {Array<{ email: string, name: string }>} */
let reminderInvitees = [];
/** @type {Array<{ id: string, email: string, name: string }>} */
let officeUsers = [];

/**
 * @param {{ email: string, name?: string }} user
 */
function userChoiceLabel(user) {
  const email = user.email;
  const name = String(user.name || '').trim();
  if (!name || name.toLowerCase() === email.toLowerCase()) return email;
  return `${name} · ${email}`;
}

function renderInviteeChoices() {
  const select = document.querySelector('#reminder-user');
  const list = document.querySelector('#reminder-invitees');
  const add = document.querySelector('#reminder-add-invitee');
  const hint = document.querySelector('#reminder-users-hint');
  if (!select || !list) return;
  const selected = new Set(reminderInvitees.map((item) => item.email.toLowerCase()));
  const available = officeUsers.filter(
    (user) => user.email && !selected.has(user.email.toLowerCase())
  );
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = available.length ? 'Choose an account' : 'No accounts left to add';
  select.append(placeholder);
  for (const user of available) {
    const option = document.createElement('option');
    option.value = user.email;
    option.textContent = userChoiceLabel(user);
    select.append(option);
  }
  const signedIn = accountsEnabled();
  select.disabled = !signedIn || !available.length;
  if (add) add.disabled = !signedIn || !available.length;
  if (hint) {
    hint.textContent = signedIn
      ? 'Add one or more accounts. The sign-in address is the Outlook address on the invite.'
      : 'Sign-in is off on this copy, so there are no accounts to invite.';
  }
  list.replaceChildren();
  if (!reminderInvitees.length) {
    const empty = document.createElement('li');
    empty.className = 'invitee-empty';
    empty.textContent = 'No invitees yet.';
    list.append(empty);
    return;
  }
  for (const person of reminderInvitees) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = userChoiceLabel(person);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary js-remove-invitee';
    remove.dataset.email = person.email;
    remove.textContent = 'Remove';
    item.append(label, remove);
    list.append(item);
  }
}

function checkedChoice(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value === 'yes';
}

function setChoice(name, yes) {
  const value = yes ? 'yes' : 'no';
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

function reminderPreviewText() {
  const settings = loadContractReminder();
  const draft = {
    schoolDaysBefore: document.querySelector('#reminder-days')?.value ?? settings.schoolDaysBefore,
    subject: document.querySelector('#reminder-subject')?.value,
    body: document.querySelector('#reminder-body')?.value,
  };
  const normalized = {
    schoolDaysBefore: Number.isFinite(Number(draft.schoolDaysBefore))
      ? draft.schoolDaysBefore
      : settings.schoolDaysBefore,
    subject: String(draft.subject || '').trim() || DEFAULT_REMINDER_SUBJECT,
    body: String(draft.body || '').trim() || DEFAULT_REMINDER_BODY,
  };
  const values = {
    route: '50',
    driver: 'Sample Driver',
    contract_date: 'Thu, Oct 1, 2026',
    reminder_date: 'Wed, Sep 30, 2026',
    school_days_before: String(normalized.schoolDaysBefore),
    change: 'PM changed from 2:00 PM-4:00 PM to 2:20 PM-4:20 PM.',
    outcome: 'Automatically contracted',
    note: 'Stop added',
  };
  const subject = fillReminderTemplate(normalized.subject, values);
  const body = fillReminderTemplate(normalized.body, values);
  return `Sample\n${subject}\n\n${body}`;
}

function selectedMemorandumId() {
  const checked = document.querySelector(
    '#driver-notice-memoranda input[name="memorandum"]:checked'
  );
  return checked?.value || DEFAULT_MEMORANDUM_ID;
}

function collectMemorandumTemplates() {
  /** @type {Record<string, { subject: string, body: string }>} */
  const templates = {};
  for (const block of document.querySelectorAll('#driver-notice-memoranda .email-content-option')) {
    const id = block.dataset.id;
    if (!id) continue;
    templates[id] = {
      subject: block.querySelector('.js-memo-subject')?.value ?? '',
      body: block.querySelector('.js-memo-body')?.value ?? '',
    };
  }
  return templates;
}

function driverNoticePreviewText() {
  const mail = memorandumMail({
    memorandumId: selectedMemorandumId(),
    templates: collectMemorandumTemplates(),
    driverName: 'Sample Driver',
    routeName: '50',
    row: {
      date: '2026-09-14',
      schedule: {
        AM: { clock_in: '6:10', clock_out: '8:40' },
        PM: { clock_in: '14:00', clock_out: '16:20' },
      },
    },
    asOf: '2026-09-14',
  });
  const attachment = checkedChoice('notice_attach')
    ? '\n\nA complete time change history PDF is also downloaded to attach.'
    : '';
  return `Sample email\n${mail.subject}\n\n${mail.body}${attachment}`;
}

/**
 * @param {HTMLElement} editor
 * @param {string} labelText
 * @param {string} controlId
 * @param {HTMLElement} control
 */
function appendTemplateField(editor, labelText, controlId, control) {
  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('label');
  label.htmlFor = controlId;
  label.textContent = labelText;
  control.id = controlId;
  field.append(label, control);
  editor.append(field);
}

function renderEmailContentOptions(selectedId, templates) {
  const root = document.querySelector('#driver-notice-memoranda');
  if (!root) return;
  const current = DRIVER_MEMORANDA.some((memo) => memo.id === selectedId)
    ? selectedId
    : DEFAULT_MEMORANDUM_ID;
  const saved = templates && typeof templates === 'object' ? templates : {};
  root.replaceChildren();
  for (const memo of DRIVER_MEMORANDA) {
    const draft = saved[memo.id];
    const details = document.createElement('details');
    details.className = 'email-content-option';
    details.dataset.id = memo.id;

    const summary = document.createElement('summary');
    const chevron = document.createElement('span');
    chevron.className = 'email-content-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'memorandum';
    radio.value = memo.id;
    radio.checked = memo.id === current;
    radio.setAttribute('aria-label', `Use ${memo.label}`);
    radio.addEventListener('click', (event) => {
      event.stopPropagation();
      details.open = true;
    });
    const name = document.createElement('span');
    name.className = 'email-content-name';
    name.textContent = memo.label;
    summary.append(chevron, radio, name);

    const editor = document.createElement('div');
    editor.className = 'email-content-editor';
    const subject = document.createElement('input');
    subject.type = 'text';
    subject.className = 'js-memo-subject';
    subject.value = String(draft?.subject ?? '').trim() || memo.subject;
    appendTemplateField(editor, 'Subject template', `memo-subject-${memo.id}`, subject);
    const body = document.createElement('textarea');
    body.className = 'js-memo-body';
    body.rows = 16;
    body.value = String(draft?.body ?? '').trim() || memo.body.trim();
    appendTemplateField(editor, 'Email template', `memo-body-${memo.id}`, body);
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.textContent =
      'You can use {{driver_name}}, {{route_name}}, {{date}}, {{effective_date}}, and {{route_times}}.';
    editor.append(hint);

    details.addEventListener('toggle', () => {
      if (!details.open || radio.checked) return;
      radio.checked = true;
      radio.dispatchEvent(new Event('input', { bubbles: true }));
    });
    details.append(summary, editor);
    root.append(details);
  }
}

function syncNoticeAttachmentFields() {
  const wording = document.querySelector('#driver-notice-attachment-wording');
  if (wording) wording.hidden = !checkedChoice('notice_attach');
}

function paintTemplatePreview(id, text) {
  const box = document.querySelector(id);
  if (!box) return;
  box.replaceChildren();
  const title = document.createElement('h3');
  title.textContent = 'Preview';
  box.append(title, document.createTextNode(text));
}

function fillDriverNoticeSettings() {
  const settings = loadDriverNotice();
  const subject = document.querySelector('#driver-notice-subject');
  const body = document.querySelector('#driver-notice-body');
  const status = document.querySelector('#driver-notice-status');
  setChoice('notice_attach', settings.attachTimeChangeNotice);
  renderEmailContentOptions(settings.memorandumId, settings.memorandumTemplates);
  if (subject) subject.value = settings.subject;
  if (body) body.value = settings.body;
  syncNoticeAttachmentFields();
  paintTemplatePreview('#driver-notice-preview', driverNoticePreviewText());
  if (status) setStatus(status, '');
}

async function fillReminderSettings() {
  const settings = loadContractReminder();
  reminderInvitees = settings.invitees.map((item) => ({ ...item }));
  const days = document.querySelector('#reminder-days');
  const subject = document.querySelector('#reminder-subject');
  const body = document.querySelector('#reminder-body');
  const status = document.querySelector('#reminder-status');
  setChoice('reminder_auto', settings.autoCreate);
  if (days) days.value = String(settings.schoolDaysBefore);
  if (subject) subject.value = settings.subject;
  if (body) body.value = settings.body;
  paintTemplatePreview('#reminder-preview', reminderPreviewText());
  if (status) setStatus(status, '');
  try {
    officeUsers = await listOfficeUsers();
  } catch (error) {
    officeUsers = [];
    if (status) setStatus(status, error.message || 'Could not load accounts.', 'error');
  }
  renderInviteeChoices();
}

document.querySelector('#reminder-add-invitee')?.addEventListener('click', () => {
  const email = document.querySelector('#reminder-user')?.value || '';
  const user = officeUsers.find((item) => item.email === email);
  if (!user) return;
  if (reminderInvitees.some((item) => item.email.toLowerCase() === user.email.toLowerCase())) {
    return;
  }
  reminderInvitees.push({ email: user.email, name: user.name });
  renderInviteeChoices();
});

document.querySelector('#reminder-invitees')?.addEventListener('click', (event) => {
  const button = event.target.closest('.js-remove-invitee');
  if (!button) return;
  reminderInvitees = reminderInvitees.filter((item) => item.email !== button.dataset.email);
  renderInviteeChoices();
});

document.querySelector('#driver-notice-form')?.addEventListener('input', () => {
  syncNoticeAttachmentFields();
  paintTemplatePreview('#driver-notice-preview', driverNoticePreviewText());
});

document.querySelector('#driver-notice-reset')?.addEventListener('click', () => {
  const subject = document.querySelector('#driver-notice-subject');
  const body = document.querySelector('#driver-notice-body');
  renderEmailContentOptions(DEFAULT_MEMORANDUM_ID, {});
  if (subject) subject.value = DEFAULT_DRIVER_NOTICE_SUBJECT;
  if (body) body.value = DEFAULT_DRIVER_NOTICE_BODY;
  paintTemplatePreview('#driver-notice-preview', driverNoticePreviewText());
});

document.querySelector('#driver-notice-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.querySelector('#driver-notice-status');
  try {
    saveDriverNotice({
      memorandumId: selectedMemorandumId(),
      memorandumTemplates: collectMemorandumTemplates(),
      attachTimeChangeNotice: checkedChoice('notice_attach'),
      subject: document.querySelector('#driver-notice-subject')?.value,
      body: document.querySelector('#driver-notice-body')?.value,
    });
    fillDriverNoticeSettings();
    if (status) setStatus(status, 'Driver time-change notice saved.', 'ok');
  } catch (error) {
    if (status) setStatus(status, error.message, 'error');
  }
});

document.querySelector('#reminder-form')?.addEventListener('input', () => {
  paintTemplatePreview('#reminder-preview', reminderPreviewText());
});

document.querySelector('#reminder-reset')?.addEventListener('click', () => {
  const subject = document.querySelector('#reminder-subject');
  const body = document.querySelector('#reminder-body');
  if (subject) subject.value = DEFAULT_REMINDER_SUBJECT;
  if (body) body.value = DEFAULT_REMINDER_BODY;
  paintTemplatePreview('#reminder-preview', reminderPreviewText());
});

document.querySelector('#reminder-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const status = document.querySelector('#reminder-status');
  try {
    const saved = saveContractReminder({
      autoCreate: checkedChoice('reminder_auto'),
      schoolDaysBefore: document.querySelector('#reminder-days')?.value,
      invitees: reminderInvitees,
      subject: document.querySelector('#reminder-subject')?.value,
      body: document.querySelector('#reminder-body')?.value,
    });
    reminderInvitees = saved.invitees.map((item) => ({ ...item }));
    fillReminderSettings();
    if (status) setStatus(status, 'Admin contract reminder saved.', 'ok');
    if (saved.autoCreate) {
      const note = downloadDueContractReminders();
      if (note && status) setStatus(status, `${status.textContent} ${note.message}`, note.kind);
    }
  } catch (error) {
    if (status) setStatus(status, error.message, 'error');
  }
});

function beginAddRoute() {
  addingPerson = true;
  viewingDriver = '';
  activeSheet = 'route';
  driversView.hidden = true;
  allRoutesView.hidden = true;
  driverHistoryView.hidden = true;
  if (payrollView) payrollView.hidden = true;
  if (clockingView) clockingView.hidden = true;
  if (timeclockSettingsView) timeclockSettingsView.hidden = true;
  if (adminReminderView) adminReminderView.hidden = true;
  if (driverNoticeView) driverNoticeView.hidden = true;
  if (routeTabs) routeTabs.hidden = false;
  showSetup(true);
  renderRouteTabs();
  document.querySelector('#setup_name').focus();
}

function rememberDriver(driver) {
  const profile = getCurrentProfile();
  if (!profile) return false;
  const previous = String(profile.driver_name || '').trim();
  const next = String(driver || '').trim();
  assignRouteDriver(profile, next, localDateString());
  saveProfile(profile);
  return Boolean(next) && !sameDriver(previous, next);
}

const assignDriverDialog = document.querySelector('#assign-driver-dialog');
const assignDriverForm = document.querySelector('#assign-driver-form');
const assignDriverStatus = document.querySelector('#assign-driver-status');
const assignDriverDate = document.querySelector('#assign_start_date');

function assignDriverLead(profile, date) {
  const current = String(profile.driver_name || '').trim();
  const routeName = profile.name ? `Route ${profile.name}` : 'This route';
  const when = date ? prettyDate(date) : 'the date you choose';
  return current
    ? `${routeName} is assigned to ${current}. Choose who takes it starting ${when}. Clock times from before then stay with ${current}.`
    : `${routeName} has no driver yet. Choose who takes it starting ${when}.`;
}

function openAssignDriverDialog(startDate = '') {
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
  if (assignDriverDate) {
    assignDriverDate.value = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : localDateString();
  }
  document.querySelector('#assign-driver-lead').textContent = assignDriverLead(
    profile,
    assignDriverDate?.value || ''
  );
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
  const startDate = assignDriverDate?.value || '';
  if (!typed) {
    setStatus(assignDriverStatus, 'Choose a driver.', 'error');
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    setStatus(assignDriverStatus, 'Choose the date this driver starts.', 'error');
    return;
  }
  const known = listDrivers().find((driver) => sameDriver(driver.name, typed));
  const nextName = known?.name || typed;
  if (sameDriver(nextName, profile.driver_name)) {
    setStatus(assignDriverStatus, `${nextName} already has this route.`, 'error');
    return;
  }
  try {
    const previousName = String(profile.driver_name || '').trim();
    assignRouteDriver(profile, nextName, startDate);
    if (!known) saveDriver({ name: nextName });
    saveProfile(profile);
    closeAssignDriverDialog();
    loadAll();
    const routeName = profile.name ? `Route ${profile.name}` : 'This route';
    setStatus(
      scheduleStatus,
      `${routeName} is assigned to ${nextName} starting ${prettyDate(startDate)}.`,
      'ok'
    );
    if (!sameDriver(previousName, nextName)) offerDuplicateRunChoice(getCurrentProfile(), startDate);
  } catch (error) {
    setStatus(assignDriverStatus, error.message, 'error');
  }
});

assignDriverDate?.addEventListener('input', () => {
  const profile = getCurrentProfile();
  if (!profile) return;
  document.querySelector('#assign-driver-lead').textContent = assignDriverLead(
    profile,
    assignDriverDate.value
  );
});

document.querySelector('#assign-driver-close').addEventListener('click', closeAssignDriverDialog);
assignDriverDialog.addEventListener('click', (event) => {
  if (event.target === assignDriverDialog) closeAssignDriverDialog();
});

const duplicateRunDialog = document.querySelector('#duplicate-run-dialog');
const duplicateRunChoices = document.querySelector('#duplicate-run-choices');

function scheduleRunTypes(profile, asOf) {
  const schedule = buildSnapshot(profile, asOf).schedule || {};
  return RUNS.map((run) => run.id).filter((id) => {
    const item = schedule[id];
    return Boolean(item?.clock_in || item?.clock_out);
  });
}

function duplicateRunLead(driverName, types) {
  const labels = types.map((type) => `another ${runTypeLabel(type)} route`);
  let listed = labels[0] || 'another route';
  if (labels.length === 2) listed = `${labels[0]} and ${labels[1]}`;
  else if (labels.length > 2) {
    listed = `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
  }
  return `${driverName} already has ${listed}. Choose one of these routes to assign to a different driver.`;
}

function offerDuplicateRunChoice(profile, asOf) {
  const driverName = String(profile?.driver_name || '').trim();
  if (!driverName || !profile?.id || !duplicateRunDialog) return;
  const held = listProfiles()
    .filter((item) => sameDriver(driverForDate(item, asOf), driverName))
    .map((item) => ({
      id: item.id,
      name: item.name || 'Unnamed',
      types: scheduleRunTypes(item, asOf),
    }));
  const overlap = duplicateRunRoutes(held, profile.id);
  if (!overlap) return;
  document.querySelector('#duplicate-run-lead').textContent = duplicateRunLead(
    driverName,
    overlap.types
  );
  const focus = overlap.routes.find((route) => route.id === profile.id);
  const others = overlap.routes
    .filter((route) => route.id !== profile.id)
    .sort((a, b) => compareRouteNumbers(a.name, b.name));
  duplicateRunChoices.innerHTML = [focus, ...others]
    .filter(Boolean)
    .map(
      (route) => `
        <li>
          <button type="button" data-route-id="${escapeHtml(route.id)}">
            Route ${escapeHtml(route.name)} · ${escapeHtml(joinRunLabels(route.types))}
          </button>
        </li>`
    )
    .join('');
  duplicateRunDialog.dataset.startDate = asOf;
  if (!duplicateRunDialog.open) duplicateRunDialog.showModal();
  duplicateRunChoices.querySelector('button')?.focus();
}

function closeDuplicateRunDialog() {
  if (duplicateRunDialog?.open) duplicateRunDialog.close();
}

duplicateRunChoices?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-route-id]');
  if (!button) return;
  const startDate = duplicateRunDialog?.dataset.startDate || '';
  closeDuplicateRunDialog();
  chooseRoute(button.dataset.routeId);
  openAssignDriverDialog(startDate);
});

document.querySelector('#duplicate-run-close')?.addEventListener('click', closeDuplicateRunDialog);
document.querySelector('#duplicate-run-keep')?.addEventListener('click', closeDuplicateRunDialog);
duplicateRunDialog?.addEventListener('click', (event) => {
  if (event.target === duplicateRunDialog) closeDuplicateRunDialog();
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
  const noticeHint = ' Saving a change offers to send the notice. Send notice on the row can send it again. If that notice was already sent, you will be warned first. The email uses the chosen memorandum and downloads a calendar PDF. Attach that PDF if you want the driver to see the calendar. The complete time change history can be downloaded too, when that attachment is turned on. Notice sent is marked Yes.';
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
            : row.segments?.length > 1
              ? 'Schedule change'
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
          row.change_ids?.length ? ` data-change-ids="${escapeHtml(row.change_ids.join(','))}"` : ''
        }${row.segment ? ` data-segment="${escapeHtml(row.segment)}"` : ''}>
        <td class="oct1-cell">${row.kind === 'change' ? forceOct1Toggle(row.force_oct1_contract) : ''}</td>
        <th scope="row">
          ${scheduleDateField(row.date, { allowNull: row.kind === 'change' })}
          <span class="row-kind">${escapeHtml(kind)}</span>
        </th>
        ${RUNS.map((run) => {
          const item = row.schedule?.[run.id];
          const changed = row.segment === run.id || row.segments?.includes(run.id);
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
            <span class="contracted-stack">
              <span class="contracted-date">${escapeHtml(column.contractedDate)}</span>
            </span>
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

function scheduleDateField(value, { id = '', className = 'js-history-date', label = 'New schedule started', allowNull = true } = {}) {
  const empty = !value;
  const idAttr = id ? ` id="${id}"` : '';
  const nullButton = allowNull
    ? `<button type="button" class="schedule-date-null js-date-null" aria-pressed="${empty ? 'true' : 'false'}">N/A</button>`
    : '';
  return `<div class="schedule-date${empty && allowNull ? ' is-null' : ''}">
    <input${idAttr} class="entry-input ${className}" type="date" aria-label="${label}" value="${escapeHtml(value || '')}" />
    ${nullButton}
  </div>`;
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
    const source = rows[i].time_sources?.[runId];
    if (source === 'initial' || rows[i].kind === 'initial') return { kind: 'initial' };
    if (source) return { kind: 'change', id: source };
    if (rows[i].segment === runId && rows[i].change_id) {
      return { kind: 'change', id: rows[i].change_id };
    }
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
      ${scheduleDateField(lastDate, { id: 'entry_date', className: '', label: 'Date the change takes effect' })}
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

function rowMatchesChange(row, changeId) {
  if (!changeId || row?.kind !== 'change') return false;
  if (row.change_id === changeId) return true;
  return Array.isArray(row.change_ids) && row.change_ids.includes(changeId);
}

function locateChange(changeId) {
  if (!changeId) return null;
  const currentRow = (snapshot?.schedule_history || []).find((item) => rowMatchesChange(item, changeId));
  const currentProfile = getCurrentProfile();
  if (currentRow && currentProfile) {
    return { profile: currentProfile, row: currentRow, history: snapshot.schedule_history || [] };
  }
  const asOf = getAsOfDate();
  for (const profile of listProfiles()) {
    let built;
    try {
      built = buildSnapshot(profile, asOf);
    } catch {
      continue;
    }
    const row = (built?.schedule_history || []).find((item) => rowMatchesChange(item, changeId));
    if (row) return { profile, row, history: built.schedule_history || [] };
  }
  return null;
}

/**
 * @param {{ profile: object, row: object, history: object[] }} located
 */
async function deliverChangeNotice(located) {
  const { profile, row, history } = located;
  const changeId = row?.change_id;
  if (!profile || !row || !changeId) {
    return { ok: false, message: 'That clock-time change could not be found.' };
  }
  const driverName = driverForDate(profile, row.date);
  if (!driverName) {
    return { ok: false, message: 'Assign a driver to this route before sending a notice.' };
  }
  const driver = listDrivers().find((item) => sameDriver(item.name, driverName));
  const email = String(driver?.email || '').trim();
  if (!isEmailAddress(email)) {
    return {
      ok: false,
      message: `Add an email for ${driverName} on the Driver Name List before sending a notice.`,
    };
  }
  const routeName = String(profile.name || '').trim();
  const noticeSettings = loadDriverNotice();
  const mail = memorandumMail({
    memorandumId: noticeSettings.memorandumId,
    templates: noticeSettings.memorandumTemplates,
    driverName,
    routeName,
    row,
    asOf: getAsOfDate(),
  });
  const downloads = [noticeCalendarFilename(driverName)];
  try {
    await downloadCalendarPdf(downloads[0]);
    if (noticeSettings.attachTimeChangeNotice) {
      const notice = timeChangeNoticeDocument({
        driverName,
        routeName,
        row,
        asOf: getAsOfDate(),
        history,
        subject: noticeSettings.subject,
        body: noticeSettings.body,
      });
      downloadTextPdf(notice.filename, notice.text);
      downloads.push(notice.filename);
    }
    openNoticeMail({ to: email, subject: mail.subject, body: mail.body });
    explainNoticeDownloads(downloads);
    rememberChangeNoticeSent(changeId);
    if ((snapshot?.schedule_history || []).some((item) => item.change_id === changeId)) {
      renderScheduleHistory();
    }
    const listed = downloads.join(' and ');
    const noun = downloads.length > 1 ? 'them' : 'it';
    return {
      ok: true,
      message: `Please look for ${listed} in your downloads folder and attach ${noun}. Notice sent is Yes for this change.`,
    };
  } catch (error) {
    return { ok: false, message: error.message || 'Could not create that notice.' };
  }
}

async function runChangeNotice(changeId, button) {
  const located = locateChange(changeId);
  if (!located) return;
  if (button) button.disabled = true;
  const downloading = loadDriverNotice().attachTimeChangeNotice
    ? 'Opening the email and downloading the calendar and the time change history…'
    : 'Opening the email and downloading the calendar…';
  setStatus(scheduleStatus, downloading);
  const result = await deliverChangeNotice(located);
  setStatus(scheduleStatus, result.message, result.ok ? 'ok' : 'error');
  if (!result.ok && button) button.disabled = false;
}

async function sendChangeNotice(button) {
  const changeId = button.closest('[data-change-id]')?.dataset.changeId;
  if (!changeId) return;
  if (isChangeNoticeSent(changeId)) {
    queueNoticeOffer([changeId]);
    return;
  }
  await runChangeNotice(changeId, button);
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
 * @param {string[]} filenames
 */
function explainNoticeDownloads(filenames) {
  const dialog = document.querySelector('#notice-download-dialog');
  const message = document.querySelector('#notice-download-message');
  const title = document.querySelector('#notice-download-title');
  if (!dialog || !message) return;
  const names = filenames.filter(Boolean);
  if (title) title.textContent = names.length > 1 ? 'Attach the downloads' : 'Attach the calendar';
  const listed = names.join(' and ');
  const noun = names.length > 1 ? 'them' : 'it';
  message.textContent = `Please look for ${listed} in your downloads folder and attach ${noun}.`;
  if (!dialog.open) dialog.showModal();
}

/**
 * @param {object | null | undefined} source
 */
function changeIdsOn(source) {
  return new Set(
    (source?.schedule_history || []).map((row) => row.change_id).filter(Boolean)
  );
}

/**
 * @param {Set<string>} beforeIds
 * @param {object | null | undefined} source
 */
function addedChangeIds(beforeIds, source) {
  return (source?.schedule_history || [])
    .map((row) => row.change_id)
    .filter((id) => id && !beforeIds.has(id));
}

/**
 * @param {string} changeId
 * @param {object | null | undefined} [source]
 */
function predictedContractDate(changeId, source = snapshot) {
  const row = (source?.schedule_history || []).find((item) => item.change_id === changeId);
  return isPredictedContract(row) ? row.contracted.becomes_on : null;
}

/**
 * @param {BlobPart} text
 * @param {string} filename
 */
function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Predicted contract reminders for every route, one item per change.
 */
function officeContractReminders() {
  const settings = loadContractReminder();
  const calendar = calendarPayload();
  /** @type {NonNullable<ReturnType<typeof prepareContractReminder>>[]} */
  const items = [];
  for (const profile of listProfiles()) {
    const routeName = String(profile?.name || '').trim();
    const snap = buildSnapshot(profile, getAsOfDate());
    for (const row of snap?.schedule_history || []) {
      try {
        const item = prepareContractReminder({
          routeName,
          driverName: driverForDate(profile, row.date),
          row,
          settings,
          calendar,
        });
        if (item?.changeId) items.push(item);
      } catch {
        // The school calendar does not reach this contract date yet.
      }
    }
  }
  return items;
}

/**
 * @param {Array<{ reminderDate: string, routes?: string[], cancelled?: boolean, updated?: boolean }>} events
 */
function publishedReminderMessage(events) {
  const active = events.filter((event) => !event.cancelled);
  const cancelled = events.filter((event) => event.cancelled);
  /** @type {string[]} */
  const parts = [];
  if (active.length) {
    const action = active.every((event) => event.updated)
      ? 'updated'
      : active.some((event) => event.updated)
        ? 'created or updated'
        : 'downloaded';
    const dayLabel = active.map((event) => prettyDate(event.reminderDate)).join(', ');
    const routeLabel = active
      .flatMap((event) => event.routes || [])
      .filter((name, index, list) => list.indexOf(name) === index)
      .join(', ');
    parts.push(
      `Outlook reminder ${action} for ${dayLabel}. It includes ${routeLabel}. Open it in Outlook and send the invite. The event is one minute and stays free.`
    );
  }
  if (cancelled.length) {
    const dayLabel = cancelled.map((event) => prettyDate(event.reminderDate)).join(', ');
    parts.push(
      `The reminder for ${dayLabel} was cancelled. Open that file in Outlook to take the old event off the calendar.`
    );
  }
  return parts.join(' ');
}

/**
 * @param {ReturnType<typeof planReminderPublish>} events
 * @param {string} stamp
 */
function publishReminderItems(events, stamp) {
  const settings = loadContractReminder();
  const list = events || [];
  if (!list.length) return null;
  if (!settings.invitees.length) {
    return {
      kind: 'error',
      message: 'Choose Outlook invitees in Admin contract reminder.',
    };
  }
  const organizer = currentAccount();
  if (!organizer?.email) {
    return {
      kind: 'error',
      message: 'Sign in with the Outlook account that should send this reminder.',
    };
  }
  const calendarInput = {
    organizer: { email: organizer.email, name: organizer.name },
    invitees: settings.invitees,
  };
  const active = list.filter((event) => !event.cancelled);
  const cancelled = list.filter((event) => event.cancelled);
  if (active.length) {
    downloadTextFile(
      buildContractReminderCalendar({ ...calendarInput, events: active }),
      active.length === 1 ? reminderDayFilename(active[0].reminderDate) : 'contract-reminders.ics'
    );
  }
  if (cancelled.length) {
    const filename =
      cancelled.length === 1
        ? `contract-reminder-cancel-${String(cancelled[0].reminderDate).replaceAll('-', '')}.ics`
        : 'contract-reminder-cancellations.ics';
    downloadTextFile(
      buildContractReminderCalendar({ ...calendarInput, events: cancelled, method: 'CANCEL' }),
      filename
    );
  }
  rememberPublishedReminders(list, stamp);
  return { kind: 'ok', message: publishedReminderMessage(list) };
}

/**
 * Download a calendar file for each reminder day that is new or different.
 * The file is created when a contract date is predicted. It is not held until that day.
 */
function downloadDueContractReminders() {
  const settings = loadContractReminder();
  if (!settings.autoCreate) return null;
  try {
    const stamp = settings.invitees
      .map((person) => person.email.toLowerCase())
      .sort()
      .join(',');
    const events = planReminderPublish(
      combineRemindersByDay(officeContractReminders()),
      loadCreatedContractEvents(),
      loadReminderSignatures(),
      stamp
    );
    if (!events.length) return null;
    return publishReminderItems(events, stamp);
  } catch (error) {
    return { kind: 'error', message: error.message };
  }
}

/**
 * History rows touched by these change ids. Several runs saved together share one row.
 * @param {string[]} changeIds
 */
function noticeRowsForChangeIds(changeIds) {
  const wanted = new Set((changeIds || []).filter(Boolean));
  if (!wanted.size) return [];
  /** @type {object[]} */
  const chosen = [];
  const seen = new Set();
  for (const row of snapshot?.schedule_history || []) {
    if (row.kind !== 'change' || !row.change_id || seen.has(row.change_id)) continue;
    const ids = row.change_ids?.length ? row.change_ids : [row.change_id];
    if (!ids.some((id) => wanted.has(id))) continue;
    seen.add(row.change_id);
    chosen.push(row);
  }
  return chosen;
}

/**
 * @param {object} row
 */
function noticeOfferMessage(row) {
  const route = String(getCurrentProfile()?.name || '').trim();
  const run = row.segment === 'MIDDAY' ? 'Midday' : row.segment || 'schedule';
  const where = route ? ` on route ${route}` : '';
  return `Send a notice for the ${run} change${where}?`;
}

/** @type {string[]} */
let noticeOfferQueue = [];
let noticeOfferSending = false;

function showNoticeOffer() {
  const changeId = noticeOfferQueue.shift();
  const dialog = document.querySelector('#send-notice-offer-dialog');
  const message = document.querySelector('#send-notice-offer-message');
  const warning = document.querySelector('#send-notice-offer-warning');
  const title = document.querySelector('#send-notice-offer-title');
  if (!changeId || !dialog || !message) return;
  const row = (snapshot?.schedule_history || []).find((item) => item.change_id === changeId);
  dialog.dataset.changeId = changeId;
  message.textContent = row ? noticeOfferMessage(row) : 'Send a notice for this clock-time change?';
  const alreadySent = isChangeNoticeSent(changeId);
  if (warning) warning.hidden = !alreadySent;
  if (title) title.textContent = alreadySent ? 'Send this notice again?' : 'Send a notice?';
  if (!dialog.open) dialog.showModal();
}

/**
 * @param {string[]} changeIds
 */
function queueNoticeOffer(changeIds) {
  const ids = noticeRowsForChangeIds(changeIds).map((row) => row.change_id);
  if (!ids.length) {
    for (const id of changeIds || []) {
      if (id) ids.push(id);
    }
  }
  if (!ids.length) return;
  noticeOfferQueue.push(...ids);
  const dialog = document.querySelector('#send-notice-offer-dialog');
  if (!dialog?.open) showNoticeOffer();
}

async function acceptNoticeOffer() {
  const dialog = document.querySelector('#send-notice-offer-dialog');
  const changeId = dialog?.dataset.changeId || '';
  noticeOfferSending = true;
  if (dialog?.open) dialog.close();
  noticeOfferSending = false;
  if (changeId) await runChangeNotice(changeId);
  const download = document.querySelector('#notice-download-dialog');
  if (download?.open && noticeOfferQueue.length) {
    download.addEventListener('close', () => showNoticeOffer(), { once: true });
    return;
  }
  if (noticeOfferQueue.length) showNoticeOffer();
}

function announcePredictedReminders(message, changeIds, previousDates = {}) {
  queueNoticeOffer(changeIds);
  const settings = loadContractReminder();
  const predictionChanged = (changeIds || []).some((changeId) => {
    const row = (snapshot?.schedule_history || []).find((item) => item.change_id === changeId);
    const next = isPredictedContract(row) ? row.contracted.becomes_on : null;
    const previous = Object.prototype.hasOwnProperty.call(previousDates, changeId)
      ? previousDates[changeId]
      : null;
    return previous !== next;
  });
  if (!predictionChanged) {
    setStatus(scheduleStatus, message, 'ok');
    return;
  }
  if (!settings.autoCreate) {
    setStatus(scheduleStatus, `${message} Automatic Outlook reminders are off.`, 'ok');
    return;
  }
  const note = downloadDueContractReminders();
  if (note) {
    setStatus(scheduleStatus, `${message} ${note.message}`, note.kind === 'ok' ? 'ok' : 'error');
    return;
  }
  setStatus(scheduleStatus, message, 'ok');
}

async function createAutomaticNotices() {
  const admin = downloadDueContractReminders();
  if (admin?.message) setStatus(fileStatus, admin.message, admin.kind === 'error' ? 'error' : 'ok');
}

function commitEntryRow() {
  const date = document.querySelector('#entry_date')?.value || null;
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
  const beforeIds = changeIdsOn(snapshot);
  const scheduleId = `schedule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    for (const item of changed) {
      snapshot = recordChange({
        ...item,
        change_date: date,
        schedule_id: scheduleId,
        force_oct1_contract: document.querySelector('#entry_force_oct1')?.checked === true,
        ...fields,
      });
    }
    announcePredictedReminders(
      'Time change added on this device.',
      addedChangeIds(beforeIds, snapshot)
    );
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

function renderDrivers(highlightName = '') {
  const drivers = listDrivers();
  const body = driverSheet.querySelector('tbody');
  const rows = drivers
    .map((driver, index) => {
      const routes = routesForDriver(driver.name);
      const routeLabel = routes
        .map((route) => (route.current ? route.name : `${route.name} (earlier)`))
        .join(', ');
      const who = driver.name;
      const justAdded = highlightName && sameDriver(driver.name, highlightName) ? ' is-just-added' : '';
      return `<tr class="${justAdded}" data-driver-id="${escapeHtml(driver.id)}">
        <th class="sheet-rowhead" scope="row">${index + 1}</th>
        <td><input class="entry-input js-driver-first" type="text" autocomplete="given-name" value="${escapeHtml(driver.firstName)}" aria-label="First name for ${escapeHtml(who)}" /></td>
        <td><input class="entry-input js-driver-last" type="text" autocomplete="family-name" value="${escapeHtml(driver.lastName)}" aria-label="Last name for ${escapeHtml(who)}" /></td>
        <td><input class="entry-input js-driver-email" type="email" autocomplete="email" value="${escapeHtml(driver.email)}" aria-label="Email for ${escapeHtml(who)}" placeholder="name@example.com" /></td>
        <td class="sheet-readonly">${routeLabel ? escapeHtml(routeLabel) : ''}</td>
        <td class="sheet-remove"><button type="button" class="secondary js-delete-driver" aria-label="Remove ${escapeHtml(who)} from the driver list">Remove</button></td>
      </tr>`;
    })
    .join('');
  body.innerHTML = `${rows}<tr class="is-entry" data-driver-id="">
    <th class="sheet-rowhead" scope="row">${drivers.length + 1}</th>
    <td><input class="entry-input js-driver-first" type="text" autocomplete="off" aria-label="New driver first name" placeholder="First" /></td>
    <td><input class="entry-input js-driver-last" type="text" autocomplete="off" aria-label="New driver last name" placeholder="Last" /></td>
    <td><input class="entry-input js-driver-email" type="email" autocomplete="off" aria-label="New driver email" placeholder="name@example.com" /></td>
    <td class="sheet-readonly"></td>
    <td class="sheet-remove"></td>
  </tr>`;
  if (highlightName) body.querySelector('.is-just-added')?.scrollIntoView({ block: 'nearest' });
}

const driverInfoSheet = document.querySelector('#driver-info-sheet');
const driverInfoNote = document.querySelector('#driver-info-status');

function setInfoNote(message, kind = '') {
  if (!driverInfoNote) return;
  setStatus(driverInfoNote, message, kind);
}

function payLinesForInfo() {
  return normalizeClockPayDefaults(loadState().clockPayDefaults).lines;
}

function infoDriver(id) {
  return listDrivers().find((driver) => driver.id === id) || null;
}

function driverFromInfoControl(node) {
  const row = node.closest('tr');
  return infoDriver(row?.dataset.driverId || '');
}

function routeLabelForDriver(name) {
  const routes = routesForDriver(name);
  if (!routes.length) return 'No route';
  return routes.map((route) => (route.current ? route.name : `${route.name} (earlier)`)).join(', ');
}

function infoInput(driver, field, value, type, label, extra = '') {
  return `<input class="entry-input" data-info-field="${field}" type="${type}" value="${escapeHtml(value)}" aria-label="${escapeHtml(label)} for ${escapeHtml(driver.name)}" ${extra} />`;
}

function driverInfoStatusMarkup(driver, lines) {
  const chosen = driverPayStatusChoices(driver.payStatuses, lines);
  const chosenIds = new Set(chosen.map((line) => line.id));
  const options = lines
    .filter((line) => !chosenIds.has(line.id))
    .map((line) => `<option value="${escapeHtml(line.id)}">${escapeHtml(line.label)}</option>`)
    .join('');
  const pills = chosen
    .map(
      (line) =>
        `<li><span>${escapeHtml(line.label)}</span><button type="button" class="secondary" data-remove-status="${escapeHtml(line.id)}" aria-label="Remove ${escapeHtml(line.label)} from ${escapeHtml(driver.name)}">Remove</button></li>`
    )
    .join('');
  return `<div class="driver-info-statuses">
    <ul class="driver-info-status-lines">${pills}</ul>
    <select data-pay-status-add="1" aria-label="Pay status to add for ${escapeHtml(driver.name)}">
      <option value="">Add a pay status</option>
      ${options}
    </select>
    <button type="button" class="secondary" data-add-status="1"${options ? '' : ' disabled'}>Add</button>
  </div>`;
}

function renderDriverInfo(force = false) {
  const body = driverInfoSheet?.querySelector('tbody');
  if (!body || !driverInfoSheet) return;
  const active = document.activeElement;
  if (!force && active instanceof HTMLElement && driverInfoSheet.contains(active)) return;
  const drivers = listDrivers();
  const lines = payLinesForInfo();
  if (!drivers.length) {
    body.innerHTML = '<tr><td class="empty" colspan="9">No drivers on the list yet.</td></tr>';
    return;
  }
  body.innerHTML = drivers
    .map(
      (driver) => `<tr data-driver-id="${escapeHtml(driver.id)}">
        <td>${infoInput(driver, 'firstName', driver.firstName, 'text', 'First name', 'autocomplete="given-name"')}</td>
        <td>${infoInput(driver, 'lastName', driver.lastName, 'text', 'Last name', 'autocomplete="family-name"')}</td>
        <td>${infoInput(driver, 'email', driver.email, 'email', 'Email', 'autocomplete="email" placeholder="name@example.com"')}</td>
        <td>${infoInput(driver, 'phone', driver.phone, 'tel', 'Phone', 'autocomplete="tel"')}</td>
        <td class="driver-info-routes">${escapeHtml(routeLabelForDriver(driver.name))}</td>
        <td>${infoInput(driver, 'serial', driver.pay?.serial || '', 'text', 'Serial number', 'maxlength="20" autocomplete="off"')}</td>
        <td>${infoInput(driver, 'rate', driver.pay?.rate || '', 'text', 'Hourly rate', 'inputmode="decimal" maxlength="7" placeholder="0.00" autocomplete="off"')}</td>
        <td>${infoInput(driver, 'account', driver.pay?.account || '', 'text', 'Payroll account', 'maxlength="40" autocomplete="off"')}</td>
        <td data-info-statuses>${driverInfoStatusMarkup(driver, lines)}</td>
      </tr>`
    )
    .join('');
}

async function persistDriverInfo(driver, fields) {
  const lines = payLinesForInfo();
  const saved = saveDriver({
    id: driver.id,
    firstName: driver.firstName,
    lastName: driver.lastName,
    email: driver.email,
    phone: driver.phone,
    previousName: driver.name,
    serial: driver.pay?.serial ?? '',
    rate: driver.pay?.rate ?? '',
    account: driver.pay?.account ?? '',
    payStatuses: driverPayStatusChoices(driver.payStatuses, lines).map((line) => line.id),
    ...fields,
  });
  if (accountsEnabled()) await whenSharedOfficeSaved();
  return saved;
}

async function writeInfoField(driver, fields, messageFor, restore) {
  try {
    const saved = await persistDriverInfo(driver, fields);
    setInfoNote(messageFor(saved), 'ok');
  } catch (error) {
    restore();
    setInfoNote(error instanceof Error ? error.message : 'Could not save that change.', 'error');
  }
}

async function commitDriverInfoField(input) {
  const driver = driverFromInfoControl(input);
  const field = input.dataset.infoField || '';
  if (!driver || !field) return;
  if (field === 'rate') {
    const raw = input.value.trim();
    const rate = normalizeDriverPay({ rate: raw }).rate;
    if (raw && !rate) {
      input.value = driver.pay?.rate || '';
      setInfoNote('Enter an hourly rate like 37.74.', 'error');
      return;
    }
    if (rate === (driver.pay?.rate || '')) {
      input.value = rate;
      return;
    }
    input.value = rate;
    await writeInfoField(
      driver,
      { rate },
      (saved) => (rate ? `Hourly rate saved for ${saved.name}.` : `Hourly rate removed for ${saved.name}.`),
      () => {
        input.value = driver.pay?.rate || '';
      }
    );
    return;
  }
  if (field === 'serial' || field === 'account') {
    const normalized = normalizeDriverPay({ [field]: input.value })[field];
    const previous = driver.pay?.[field] || '';
    const label = field === 'serial' ? 'Serial number' : 'Payroll account';
    if (normalized === previous) {
      input.value = normalized;
      return;
    }
    input.value = normalized;
    await writeInfoField(
      driver,
      { [field]: normalized },
      (saved) => (normalized ? `${label} saved for ${saved.name}.` : `${label} removed for ${saved.name}.`),
      () => {
        input.value = previous;
      }
    );
    return;
  }
  const value = input.value.trim();
  if (field === 'firstName' || field === 'lastName') {
    const firstName = field === 'firstName' ? value : driver.firstName;
    const lastName = field === 'lastName' ? value : driver.lastName;
    if (!firstName && !lastName) {
      input.value = driver[field] || '';
      setInfoNote('Enter a first or last name.', 'error');
      return;
    }
  }
  if (value === String(driver[field] ?? '').trim()) {
    input.value = value;
    return;
  }
  input.value = value;
  const labels = { firstName: 'First name', lastName: 'Last name', email: 'Email', phone: 'Phone' };
  const label = labels[field] || 'Driver info';
  await writeInfoField(
    driver,
    { [field]: value },
    (saved) => (value ? `${label} saved for ${saved.name}.` : `${label} removed for ${saved.name}.`),
    () => {
      input.value = driver[field] || '';
    }
  );
}

async function finishInfoStatus(driver, payStatuses, message) {
  const row = driverInfoSheet?.querySelector(`tr[data-driver-id="${CSS.escape(driver.id)}"]`);
  try {
    const saved = await persistDriverInfo(driver, { payStatuses });
    const fresh = infoDriver(saved.id) || saved;
    const cell = row?.querySelector('[data-info-statuses]');
    if (cell) cell.innerHTML = driverInfoStatusMarkup(fresh, payLinesForInfo());
    setInfoNote(message, 'ok');
  } catch (error) {
    setInfoNote(error instanceof Error ? error.message : 'Could not save that change.', 'error');
  }
}

async function addDriverInfoStatus(select) {
  const driver = driverFromInfoControl(select);
  if (!driver || !select.value) return;
  const lines = payLinesForInfo();
  const current = driverPayStatusChoices(driver.payStatuses, lines).map((line) => line.id);
  if (current.includes(select.value)) return;
  const next = lines.map((line) => line.id).filter((id) => current.includes(id) || id === select.value);
  const added = lines.find((line) => line.id === select.value);
  await finishInfoStatus(driver, next, `${added?.label || 'Pay status'} added for ${driver.name}.`);
}

async function removeDriverInfoStatus(button) {
  const driver = driverFromInfoControl(button);
  const id = button.dataset.removeStatus || '';
  if (!driver || !id) return;
  const lines = payLinesForInfo();
  const current = driverPayStatusChoices(driver.payStatuses, lines);
  if (current.length < 2) {
    setInfoNote('Leave at least one pay status for this driver.', 'error');
    return;
  }
  const next = lines.map((line) => line.id).filter((lineId) => current.some((line) => line.id === lineId) && lineId !== id);
  const removed = lines.find((line) => line.id === id);
  await finishInfoStatus(driver, next, `${removed?.label || 'Pay status'} removed for ${driver.name}.`);
}

driverInfoSheet?.addEventListener('focusout', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.dataset.infoField) return;
  commitDriverInfoField(input);
});

driverInfoSheet?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.dataset.infoField) return;
  event.preventDefault();
  input.blur();
});

driverInfoSheet?.addEventListener('change', (event) => {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement) || select.dataset.payStatusAdd !== '1') return;
  if (select.value) addDriverInfoStatus(select);
});

driverInfoSheet?.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const remove = target?.closest('[data-remove-status]');
  if (remove instanceof HTMLButtonElement) {
    removeDriverInfoStatus(remove);
    return;
  }
  const add = target?.closest('[data-add-status]');
  if (!(add instanceof HTMLButtonElement)) return;
  const select = add.parentElement?.querySelector('[data-pay-status-add]');
  if (select instanceof HTMLSelectElement && select.value) addDriverInfoStatus(select);
});

document.querySelector('#payroll-tools')?.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('#open-driver-info') : null;
  if (!(button instanceof HTMLButtonElement)) return;
  queueMicrotask(() => {
    if (button.getAttribute('aria-expanded') === 'true') renderDriverInfo(true);
  });
});

function confirmRemoveDriver(driver) {
  const routes = routesForDriver(driver.name);
  const current = routes.filter((route) => route.current).map((route) => route.name);
  const earlier = routes.filter((route) => !route.current).map((route) => route.name);
  const lines = [`Remove ${driver.name} from the driver list?`];
  if (current.length) {
    const listed = current.join(', ');
    lines.push(
      current.length === 1
        ? `${driver.name} stays assigned to route ${listed} until you choose another driver.`
        : `${driver.name} stays assigned to routes ${listed} until you choose another driver.`
    );
  }
  if (earlier.length) {
    lines.push(`Earlier route history on ${earlier.join(', ')} stays.`);
  }
  return confirm(lines.join(' '));
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
  const backLabel = document.querySelector('#driver-history-back [data-back-label]');
  if (backLabel) backLabel.textContent = driversWindow ? 'Clock record' : 'All routes';
  const built = sectionsForDriver({
    driverName: name,
    profiles: listProfiles(),
    asOf: getAsOfDate(),
  });
  if (!built) {
    driverHistoryLead.textContent = `${name} has no route history on this device.`;
    driverHistoryBody.innerHTML = '';
    document.title = driversWindow ? `Clock-time history for ${name}` : PAGE_TITLE;
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
  const onPayroll = activeSheet === 'payroll' && !addingPerson;
  const onClocking = activeSheet === 'clocking' && !addingPerson;
  const onClockSettings = activeSheet === 'clock-settings' && !addingPerson;
  const onOfficeApp = onPayroll || onClocking || onClockSettings;
  const onAdminReminder = activeSheet === 'admin-reminder' && !addingPerson;
  const onDriverNotice = activeSheet === 'driver-notice' && !addingPerson;
  const payrollWindow = driversWindow && driversApp === 'payroll';
  document.body.classList.toggle('is-payroll-app', onPayroll || (payrollWindow && onDriverHistory));
  document.body.classList.toggle('is-clocking-app', onClocking || onClockSettings);
  const themeColor =
    onPayroll || (payrollWindow && onDriverHistory)
      ? '#12887a'
      : onClocking || onClockSettings
        ? '#1a4f8b'
        : '#6428f0';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
  if (routeTabs) routeTabs.hidden = onOfficeApp || driversWindow;
  if (payrollView) payrollView.hidden = !onPayroll;
  if (clockingView) clockingView.hidden = !onClocking;
  if (timeclockSettingsView) timeclockSettingsView.hidden = !onClockSettings;
  if (adminReminderView) adminReminderView.hidden = !onAdminReminder;
  if (driverNoticeView) driverNoticeView.hidden = !onDriverNotice;
  if (driversWindow && onDriverHistory) {
    if (payrollView) payrollView.hidden = true;
    if (clockingView) clockingView.hidden = true;
    if (timeclockSettingsView) timeclockSettingsView.hidden = true;
    driversView.hidden = true;
    allRoutesView.hidden = true;
    driverHistoryView.hidden = false;
    setupView.hidden = true;
    appView.hidden = true;
    renderDriverHistory();
    return;
  }
  if (onClockSettings) {
    driversView.hidden = true;
    allRoutesView.hidden = true;
    driverHistoryView.hidden = true;
    setupView.hidden = true;
    appView.hidden = true;
    document.title = `Timeclock settings · ${APP_TITLE}`;
    timeclockDesk.refresh();
    return;
  }
  if (onPayroll || onClocking) {
    driversView.hidden = true;
    allRoutesView.hidden = true;
    driverHistoryView.hidden = true;
    setupView.hidden = true;
    appView.hidden = true;
    clockDesk.refresh();
    timeclockDesk.refresh();
    if (onPayroll) renderDriverInfo();
    const openDriver = clockDesk.openDriver();
    const appName = onClocking ? 'Clocking' : 'Payroll';
    if (driversWindow) {
      const windowLabel = driversApp === 'clocking' ? 'Clock records' : 'Drivers';
      document.title = openDriver ? `${openDriver} · ${windowLabel} · ${APP_TITLE}` : `${windowLabel} · ${APP_TITLE}`;
      return;
    }
    document.title = openDriver ? `${openDriver} · ${appName} · ${APP_TITLE}` : `${appName} · ${APP_TITLE}`;
    return;
  }
  if (onAdminReminder || onDriverNotice) {
    driversView.hidden = true;
    allRoutesView.hidden = true;
    driverHistoryView.hidden = true;
    setupView.hidden = true;
    appView.hidden = true;
    document.title = onAdminReminder ? 'Admin contract reminder' : 'Driver time-change notice';
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
    return;
  }
  setupView.hidden = true;
  setupView.setAttribute('aria-hidden', 'true');
  appView.hidden = false;
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
  const changeDateWrap = document.querySelector('#change-date-wrap');
  changeDateWrap?.classList.toggle('is-null', !changeDate);
  changeDateWrap?.querySelector('.js-date-null')?.setAttribute('aria-pressed', changeDate ? 'false' : 'true');
  const segment = document.querySelector('#change_segment').value;
  if (!clockIn || !clockOut) {
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
    const driverChanged = rememberDriver(data.driver);
    addingPerson = false;
    setStatus(setupStatus, `Route ${routeNumber} saved in this browser.`, 'ok');
    loadAll();
    if (driverChanged) offerDuplicateRunChoice(getCurrentProfile(), localDateString());
  } catch (error) {
    setStatus(setupStatus, error.message, 'error');
  }
});

changeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const beforeIds = changeIdsOn(snapshot);
    snapshot = recordChange({
      segment: document.querySelector('#change_segment').value,
      change_date: document.querySelector('#change_date').value || null,
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
    announcePredictedReminders(
      'Change recorded on this device.',
      addedChangeIds(beforeIds, snapshot)
    );
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
 * @param {boolean} remembered
 */
function payrollCompareStatus(changed, remembered) {
  if (!remembered) {
    return 'This payroll file is saved. The next file will highlight rows that differ from it.';
  }
  if (changed === 0) return 'No rows differ from the last payroll file this office created.';
  if (changed === 1) {
    return '1 row is bold and highlighted. It differs from the last payroll file this office created.';
  }
  return `${changed} rows are bold and highlighted. They differ from the last payroll file this office created.`;
}

/**
 * @param {{ labels: string[], hasBaseline: boolean }} choice
 */
function renderPayrollHighlightChoices({ labels, hasBaseline }) {
  const list = document.querySelector('#payroll-highlight-routes');
  const lead = document.querySelector('#payroll-highlight-lead');
  const empty = document.querySelector('#payroll-highlight-empty');
  list.innerHTML = labels.map((label) => `<li>${escapeHtml(label)}</li>`).join('');
  const hasRoutes = labels.length > 0;
  list.hidden = !hasRoutes;
  lead.hidden = !hasRoutes;
  empty.hidden = hasRoutes;
  empty.textContent = hasBaseline
    ? 'No rows differ from the last payroll file this office created, so nothing will be highlighted.'
    : 'This office has not saved a payroll file yet. Nothing will be highlighted. Creating this file remembers it, and the next file will highlight every row that changed.';
}

/**
 * @param {{ labels: string[], hasBaseline: boolean }} choice
 * @returns {Promise<boolean>}
 */
function confirmPayrollHighlights(choice) {
  const dialog = document.querySelector('#payroll-compare-dialog');
  const createBtn = document.querySelector('#payroll-compare-create');
  const closeBtn = document.querySelector('#payroll-compare-close');
  return new Promise((resolve) => {
    let create = false;
    const onClose = () => {
      createBtn.removeEventListener('click', onCreate);
      closeBtn.removeEventListener('click', onCancel);
      dialog.removeEventListener('close', onClose);
      resolve(create);
    };
    const onCreate = () => {
      create = true;
      dialog.close();
    };
    const onCancel = () => {
      create = false;
      dialog.close();
    };
    createBtn.addEventListener('click', onCreate);
    closeBtn.addEventListener('click', onCancel);
    dialog.addEventListener('close', onClose);
    renderPayrollHighlightChoices(choice);
    dialog.showModal();
  });
}

document.querySelector('#payroll-export-btn').addEventListener('click', async () => {
  setStatus(payrollStatus, '');
  try {
    const state = { ...loadState(), asOf: getAsOfDate() };
    const currentRows = payrollDriverRows(state, { asOf: state.asOf });
    const previousRows = await loadPayrollBaseline();
    const hasBaseline = Array.isArray(previousRows);
    const labels = hasBaseline ? changedPayrollLabels(currentRows, previousRows) : [];
    const create = await confirmPayrollHighlights({ labels, hasBaseline });
    if (!create) return;
    const createdAt = new Date();
    const filename = payrollWorkbookFilename(createdAt);
    /** @type {{ changedCount?: number }} */
    const result = {};
    const bytes = await buildPayrollWorkbook(state, {
      title: workbookTitleFromFilename(filename),
      createdAt,
      previousRows: hasBaseline ? previousRows : null,
      result,
    });
    downloadWorkbook(bytes, filename);
    try {
      await savePayrollBaseline(payrollBaselineRows(currentRows));
      setStatus(payrollStatus, payrollCompareStatus(result.changedCount ?? 0, hasBaseline), 'ok');
    } catch (error) {
      setStatus(
        payrollStatus,
        error.message ||
          'The spreadsheet downloaded, but the office could not remember it. The next file may highlight these same rows.',
        'error'
      );
    }
  } catch (error) {
    setStatus(payrollStatus, error.message || 'Could not create the payroll spreadsheet.', 'error');
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

function openRouteHistoryEmail() {
  const dialog = document.querySelector('#history-email-dialog');
  const select = document.querySelector('#history-email-driver');
  const status = document.querySelector('#history-email-status');
  const routeName = String(getCurrentProfile()?.name || '').trim() || 'this route';
  const lead = document.querySelector('#history-email-lead');
  if (!dialog || !select) return;
  if (lead) lead.textContent = `Choose who receives the clock-time history for route ${routeName}.`;
  const drivers = listDrivers();
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose a driver';
  select.append(placeholder);
  for (const driver of drivers) {
    const option = document.createElement('option');
    option.value = driver.id;
    option.textContent = driver.name;
    select.append(option);
  }
  select.value = '';
  if (status) setStatus(status, '');
  if (!dialog.open) dialog.showModal();
}

async function sendRouteHistoryEmail(event) {
  event.preventDefault();
  const status = document.querySelector('#history-email-status');
  const driverId = document.querySelector('#history-email-driver')?.value || '';
  const driver = listDrivers().find((item) => item.id === driverId);
  if (!driver) {
    if (status) setStatus(status, 'Choose a driver.', 'error');
    return;
  }
  const email = String(driver.email || '').trim();
  if (!isEmailAddress(email)) {
    if (status) {
      setStatus(status, `Add an email for ${driver.name} on the Driver Name List before sending this history.`, 'error');
    }
    return;
  }
  const routeName = String(getCurrentProfile()?.name || snapshot?.employee?.name || '').trim();
  const mail = routeHistoryMail({
    driverName: driver.name,
    routeName,
    history: snapshot?.schedule_history || [],
  });
  const filename = routeHistoryFilename(routeName);
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  if (status) setStatus(status, 'Opening the email and downloading the calendar…');
  try {
    await downloadCalendarPdf(filename);
    openNoticeMail({ to: email, subject: mail.subject, body: mail.body });
    document.querySelector('#history-email-dialog')?.close();
    explainNoticeDownloads([filename]);
    setStatus(
      scheduleStatus,
      `Please look for ${filename} in your downloads folder and attach it.`,
      'ok'
    );
  } catch (error) {
    if (status) setStatus(status, error.message || 'Could not create that history.', 'error');
  } finally {
    if (submit) submit.disabled = false;
  }
}

document.querySelector('#email-route-history')?.addEventListener('click', openRouteHistoryEmail);
document.querySelector('#history-email-close')?.addEventListener('click', () => {
  document.querySelector('#history-email-dialog')?.close();
});
document.querySelector('#history-email-dialog')?.addEventListener('click', (event) => {
  const dialog = document.querySelector('#history-email-dialog');
  if (event.target === dialog) dialog.close();
});
document.querySelector('#history-email-form')?.addEventListener('submit', (event) => {
  void sendRouteHistoryEmail(event);
});

document.querySelector('#day-dialog-close').addEventListener('click', closeDayPopup);
dayDialog.addEventListener('click', (event) => {
  if (event.target === dayDialog) closeDayPopup();
});

document.querySelector('#change-dialog-close').addEventListener('click', closeChangeDialog);
document.querySelector('#notice-download-close')?.addEventListener('click', () => {
  document.querySelector('#notice-download-dialog')?.close();
});
document.querySelector('#send-notice-offer-send')?.addEventListener('click', () => {
  void acceptNoticeOffer();
});
document.querySelector('#send-notice-offer-skip')?.addEventListener('click', () => {
  document.querySelector('#send-notice-offer-dialog')?.close();
});
document.querySelector('#send-notice-offer-close')?.addEventListener('click', () => {
  document.querySelector('#send-notice-offer-dialog')?.close();
});
document.querySelector('#send-notice-offer-dialog')?.addEventListener('close', () => {
  if (noticeOfferSending) return;
  setTimeout(() => showNoticeOffer(), 0);
});
document.querySelector('#send-notice-offer-dialog')?.addEventListener('click', (event) => {
  const dialog = document.querySelector('#send-notice-offer-dialog');
  if (event.target === dialog) dialog.close();
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
    const driverChanged = rememberDriver(data.driver);
    startEditForm.hidden = true;
    setStatus(scheduleStatus, 'Starting times corrected.', 'ok');
    renderApp();
    if (driverChanged) offerDuplicateRunChoice(getCurrentProfile(), localDateString());
  } catch (error) {
    setStatus(startEditStatus, error.message, 'error');
  }
});

function openChangeEditor(changeId) {
  const change = (snapshot.changes || []).find((item) => item.id === changeId);
  if (!change) return;
  document.querySelector('#change_edit_id').value = change.id;
  const editDate = document.querySelector('#change_edit_date');
  editDate.value = change.change_date || '';
  editDate.closest('.schedule-date')?.classList.toggle('is-null', !change.change_date);
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

function rowChangeIds(row) {
  return (row.dataset.changeIds || row.dataset.changeId || '').split(',').filter(Boolean);
}

function saveHistoryEdit(input) {
  const row = input.closest('tr');
  if (!row) return;
  const dateInput = row.querySelector('.js-history-date');
  const date = dateInput?.value || '';
  dateInput?.closest('.schedule-date')?.classList.toggle('is-null', !date);
  if (row.dataset.rowKind === 'initial' && !date) {
    setStatus(scheduleStatus, 'Enter the date this schedule took effect.', 'error');
    return;
  }
  const changeDate = date || null;
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
      } else if (input.classList.contains('js-history-date') || input.classList.contains('js-force-oct1')) {
        const forceInput = row.querySelector('.js-force-oct1');
        const ids = rowChangeIds(row);
        const previous = Object.fromEntries(ids.map((id) => [id, predictedContractDate(id)]));
        for (const id of ids) {
          const change = (snapshot.changes || []).find((item) => item.id === id);
          snapshot = updateChange(id, {
            change_date: changeDate,
            ...(change?.next?.clock_in && change?.next?.clock_out
              ? { clock_in: change.next.clock_in, clock_out: change.next.clock_out }
              : {}),
            ...(forceInput ? { force_oct1_contract: forceInput.checked } : {}),
          });
        }
        announcePredictedReminders('Schedule corrected on this device.', ids, previous);
        renderApp();
        return;
      } else {
        const forceInput = row.querySelector('.js-force-oct1');
        const previousOn = predictedContractDate(sourceId);
        snapshot = updateChange(sourceId, {
          change_date: changeDate,
          clock_in: rowTime(row, runId, 'in'),
          clock_out: rowTime(row, runId, 'out'),
          ...(forceInput ? { force_oct1_contract: forceInput.checked } : {}),
        });
        announcePredictedReminders('Schedule corrected on this device.', [sourceId], {
          [sourceId]: previousOn,
        });
        renderApp();
        return;
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

document.addEventListener('input', (event) => {
  const input = event.target.closest?.('.schedule-date input[type="date"]');
  if (!input) return;
  const wrap = input.closest('.schedule-date');
  const empty = !input.value;
  wrap?.classList.toggle('is-null', empty);
  wrap?.querySelector('.js-date-null')?.setAttribute('aria-pressed', empty ? 'true' : 'false');
});

document.addEventListener('click', (event) => {
  const nullButton = event.target.closest('.js-date-null');
  if (!nullButton) return;
  const wrap = nullButton.closest('.schedule-date');
  const input = wrap?.querySelector('input[type="date"]');
  if (!input) return;
  event.preventDefault();
  input.value = '';
  wrap.classList.add('is-null');
  nullButton.setAttribute('aria-pressed', 'true');
  if (nullButton.closest('.is-new-change') || nullButton.closest('#change-edit-form')) return;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});

scheduleHistory.addEventListener('click', (event) => {
  if (event.target.closest('.js-date-null')) return;
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
      const ids = rowChangeIds(row);
      for (const id of ids.length ? ids : [changeId]) snapshot = deleteChange(id);
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
    const changeId = document.querySelector('#change_edit_id').value;
    const previousOn = predictedContractDate(changeId);
    snapshot = updateChange(changeId, {
      change_date: document.querySelector('#change_edit_date').value || null,
      clock_in: document.querySelector('#change_edit_in').value,
      clock_out: document.querySelector('#change_edit_out').value,
      note: document.querySelector('#change_edit_note').value,
      force_oct1_contract: document.querySelector('#change_edit_force_oct1')?.checked === true,
    });
    changeEditForm.hidden = true;
    announcePredictedReminders('Change corrected.', [changeId], { [changeId]: previousOn });
    renderApp();
  } catch (error) {
    setStatus(changeEditStatus, error.message, 'error');
  }
});

document.querySelector('#change-edit-cancel').addEventListener('click', () => {
  changeEditForm.hidden = true;
  setStatus(changeEditStatus, '');
});

document.querySelector('#add-driver-row').addEventListener('click', async () => {
  const row = driverSheet.querySelector('tr.is-entry');
  if (!row) return;
  const button = document.querySelector('#add-driver-row');
  button.disabled = true;
  try {
    setStatus(driverStatus, 'Saving driver…');
    const saved = saveDriver(driverDraftFromRow(row));
    if (accountsEnabled()) await whenSharedOfficeSaved();
    setStatus(
      driverStatus,
      accountsEnabled() ? `${saved.name} added.` : `${saved.name} added on this device.`,
      'ok'
    );
    renderDrivers(saved.name);
  } catch (error) {
    setStatus(driverStatus, error.message, 'error');
    renderDrivers();
  } finally {
    button.disabled = false;
  }
});

driverSheet.addEventListener('click', async (event) => {
  const button = event.target.closest('.js-delete-driver');
  if (!button) return;
  const row = button.closest('tr[data-driver-id]');
  const driver = listDrivers().find((item) => item.id === row?.dataset.driverId);
  if (!driver) return;
  if (!confirmRemoveDriver(driver)) return;
  try {
    setStatus(driverStatus, 'Removing driver…');
    deleteDriver(driver.id);
    if (accountsEnabled()) await whenSharedOfficeSaved();
    setStatus(
      driverStatus,
      accountsEnabled() ? `${driver.name} removed.` : `${driver.name} removed on this device.`,
      'ok'
    );
    renderDrivers();
  } catch (error) {
    setStatus(driverStatus, error.message, 'error');
    renderDrivers();
  }
});

driverSheet.addEventListener('change', async (event) => {
  const input = event.target.closest('.entry-input');
  const row = event.target.closest('tr[data-driver-id]');
  if (!input || !row?.dataset.driverId) return;
  const driver = listDrivers().find((item) => item.id === row.dataset.driverId);
  if (!driver) return;
  try {
    setStatus(driverStatus, 'Saving driver…');
    saveDriver({
      id: driver.id,
      previousName: driver.name,
      ...driverDraftFromRow(row),
    });
    if (accountsEnabled()) await whenSharedOfficeSaved();
    setStatus(driverStatus, accountsEnabled() ? 'Driver saved.' : 'Driver sheet saved on this device.', 'ok');
    renderDrivers();
  } catch (error) {
    setStatus(driverStatus, error.message, 'error');
    renderDrivers();
  }
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

document.querySelector('#driver-history-back')?.addEventListener('click', () => {
  if (driversWindow && driversApp === 'payroll') {
    showPayroll();
    return;
  }
  showAllRoutes();
});

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
  const current = loadState();
  saveState({
    version: 1,
    currentProfileId: next.currentProfileId ?? null,
    profiles: next.profiles,
    drivers: Array.isArray(next.drivers) ? next.drivers : [],
    punches: Array.isArray(current.punches) ? current.punches : [],
    clockPins: current.clockPins && typeof current.clockPins === 'object' ? current.clockPins : {},
    clockLockCode: current.clockLockCode || '',
    ...(Object.prototype.hasOwnProperty.call(current, 'clockLateMinutes')
      ? { clockLateMinutes: current.clockLateMinutes }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(current, 'clockEarlyReleaseTimes')
      ? { clockEarlyReleaseTimes: current.clockEarlyReleaseTimes }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(current, 'clockNameSize')
      ? { clockNameSize: current.clockNameSize }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(current, 'clockPunchSoundIn')
      ? { clockPunchSoundIn: current.clockPunchSoundIn }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(current, 'clockPunchSoundOut')
      ? { clockPunchSoundOut: current.clockPunchSoundOut }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(current, 'clockRounding')
      ? { clockRounding: current.clockRounding }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(current, 'clockQuarterHourClocks')
      ? { clockQuarterHourClocks: current.clockQuarterHourClocks }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(current, 'overtimeRules')
      ? { overtimeRules: current.overtimeRules }
      : {}),
    clockReasonCodes: Array.isArray(current.clockReasonCodes) ? current.clockReasonCodes : [],
    clockSubstituteDrivers: Array.isArray(current.clockSubstituteDrivers) ? current.clockSubstituteDrivers : [],
    exampleVersion: 0,
    ...(next.contractReminder
      ? { contractReminder: next.contractReminder }
      : current.contractReminder
        ? { contractReminder: current.contractReminder }
        : {}),
    ...(next.driverNotice
      ? { driverNotice: next.driverNotice }
      : current.driverNotice
        ? { driverNotice: current.driverNotice }
        : {}),
    ...(next.contractReminderCreated
      ? { contractReminderCreated: next.contractReminderCreated }
      : current.contractReminderCreated
        ? { contractReminderCreated: current.contractReminderCreated }
        : {}),
    ...(next.contractReminderSignatures
      ? { contractReminderSignatures: next.contractReminderSignatures }
      : current.contractReminderSignatures
        ? { contractReminderSignatures: current.contractReminderSignatures }
        : {}),
  });
}

const clockDesk = mountClockDesk({
  readState: loadState,
  writePunches(punches) {
    const state = loadState();
    state.punches = punches;
    saveState(state);
  },
  listNames() {
    return listDrivers().map((driver) => driver.name);
  },
  asOf() {
    return getAsOfDate();
  },
  readAccount: currentAccount,
  onOpenHistory(name) {
    showDriverHistory(name);
  },
  async saveDriverPay(driver, fields) {
    saveDriver({
      id: driver.id,
      firstName: driver.firstName,
      lastName: driver.lastName,
      email: driver.email,
      phone: driver.phone,
      ...fields,
    });
    if (accountsEnabled()) await whenSharedOfficeSaved();
  },
});

/**
 * Clock-in for each run on the schedule in effect today. A bad route is skipped
 * so one profile cannot take down the driver screen.
 * On an early release day, `earlyReleaseTimes` replaces the PM clock-in with the
 * time for the first school on the route. Null keeps the regular PM clock-in.
 * @param {object} profile
 * @param {string} today
 * @param {unknown} earlyReleaseTimes
 * @returns {Record<string, string>}
 */
function routeClocksByRun(profile, today, earlyReleaseTimes) {
  try {
    const schedule = buildSnapshot(profile, today)?.schedule || {};
    /** @type {Record<string, string>} */
    const clocks = {};
    for (const segment of ['AM', 'MIDDAY', 'PM']) {
      const clockIn = schedule[segment]?.clock_in;
      if (clockIn) clocks[segment] = String(clockIn);
    }
    if (clocks.PM && earlyReleaseTimes !== null) {
      const next = earlyReleaseClock(profile?.note, earlyReleaseTimes);
      if (next) clocks.PM = next;
    }
    return clocks;
  } catch {
    return {};
  }
}

const timeclockDesk = mountTimeclock({
  readState: loadState,
  writeState(state) {
    saveState(state);
    clockDesk.refresh();
  },
  listPeople() {
    const state = loadState();
    const today = localDateString();
    let earlyReleaseTimes = null;
    try {
      if (isEarlyReleaseDate(today, getSchoolDays(calendarPayload()))) {
        earlyReleaseTimes = state.clockEarlyReleaseTimes;
      }
    } catch {
      earlyReleaseTimes = null;
    }
    /** @type {Map<string, string[]>} */
    const routesByName = new Map();
    /** @type {Map<string, Array<{ name: string, assignedFrom: string, clocks: Record<string, string> }>>} */
    const heldByName = new Map();
    for (const profile of Object.values(state.profiles || {})) {
      const name = String(profile?.driver_name || '').trim().toLowerCase();
      const route = String(profile?.name || '').trim();
      if (!name || !route) continue;
      const routes = routesByName.get(name) || [];
      routes.push(route);
      routesByName.set(name, routes);
      const assignment = assignmentOnDate(profile, today);
      const held = heldByName.get(name) || [];
      held.push({
        name: route,
        assignedFrom:
          assignment && sameDriver(assignment.driver_name, profile.driver_name)
            ? assignment.from
            : String(profile?.start_date || ''),
        clocks: routeClocksByRun(profile, today, earlyReleaseTimes),
      });
      heldByName.set(name, held);
    }
    return listDrivers().map((driver) => {
      const key = driver.name.toLowerCase();
      const clocks = runClocksFromOriginalRoute(heldByName.get(key) || []);
      return {
        id: driver.id,
        name: driver.name,
        routes: routesByName.get(key) || [],
        clockIns: ['AM', 'MIDDAY', 'PM'].flatMap((run) => (clocks[run] ? [clocks[run]] : [])),
        clockRuns: ['AM', 'MIDDAY', 'PM'].filter((run) => clocks[run]),
      };
    });
  },
});

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;
  clockDesk.refresh();
  timeclockDesk.refresh();
  if (activeSheet === 'payroll') renderDriverInfo();
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
        await createAutomaticNotices();
      } catch (error) {
        setStatus(setupStatus, error.message, 'error');
        setupView.hidden = false;
      }
    })();
  },
  onRemoteReset() {
    loadAll();
    showRecentRouteChanges(loadState());
    if (activeSheet === 'admin-reminder') fillReminderSettings();
    if (activeSheet === 'driver-notice') fillDriverNoticeSettings();
  },
}).catch((error) => {
  document.body.classList.remove('is-booting');
  setStatus(setupStatus, error.message || 'Could not start accounts.', 'error');
  setupView.hidden = false;
});

initCitations();
