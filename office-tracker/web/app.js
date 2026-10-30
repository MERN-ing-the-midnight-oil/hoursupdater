import {
  bindCalculatorStore,
  buildSnapshot,
  calendarPayload,
  currentSnapshot,
  useSchoolYearCalendar,
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
  bidBumpUseSnappedContractTimesEnabled,
  contractQuarterHourSnapEnabled,
  contractSnapBreaksFromState,
  contractSnapOptions,
  listProfiles,
  loadContractNotice,
  loadContractReminder,
  loadCreatedContractEvents,
  loadDriverNotice,
  loadReminderSignatures,
  loadState,
  rememberPublishedReminders,
  saveContractNotice,
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
  payrollWorkbookFilename,
  workbookTitleFromFilename,
} from '../src/downloadName.js';
import {
  fileBaseFromRouteBackupFilename,
  normalizeRouteBackupFilename,
  normalizeRouteDataBackup,
  routeDataBackupReminderDue,
  routeDataBackupReminderLabel,
  suggestedRouteBackupFilename,
} from '../src/routeDataBackup.js';
import {
  buildPayrollWorkbook,
  changedPayrollLabels,
  contractedSegments,
  contractStartedOn,
  payrollBaselineRows,
  payrollDriverRows,
} from '../src/payrollTimes.js';
import { contractedRunMinutes } from '../src/leaveRequests.js';
import { rebuildEmployeeRouteState } from '../../employee-tracker/src/snapshot.js';
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
import { shouldDeferSharedUiRefresh } from '../src/sharedUiRefresh.js';
import { ensureExampleRoutes, isSampleOffice } from './exampleRoutes.js';
import { mountClockDesk } from './clockDesk.js';
import {
  isExternalTimeclockSearch,
  otherTimeclockScreens,
  TIMECLOCK_LOCK_KEY,
  timeclockScreenLabel,
  timeclockWindowBounds,
  timeclockWindowFeatures,
} from './timeclockScreen.js';
import {
  CLOCK_IN_TYPES,
  driverPayStatusChoices,
  normalizeClockPayDefaults,
  normalizeDriverPay,
  normalizePayStatusByRun,
} from '../src/driverPay.js';
import { snapContractTimeRange } from '../../src/logic/timeUtils.js';

bindCalculatorStore({
  deleteProfile,
  getCurrentProfile,
  importState,
  listProfiles,
  saveProfile,
  setCurrentProfile,
  contractSnapOptions: () => contractSnapOptions(loadState()),
});
import { formatClockAmPm, localDateString } from '../../employee-tracker/src/clockTimes.js';
import { getSchoolDays } from '../../src/logic/calendar.js';
import { DEFAULT_DRIVER_PIN, driverClockPin } from '../../src/logic/clockKiosk.js';
import { earlyReleaseClock, isEarlyReleaseDate } from '../../src/logic/earlyRelease.js';
import { earlyReleaseRulesForState, savedSchoolYear } from '../../src/logic/schoolYear.js';
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
  loadSentChangeRecords,
  memorandumMail,
  noticeSentLineForIds,
  noticeCcAddress,
  noticeCalendarFilename,
  noticeCoveredIds,
  noticeMailto,
  forgetChangeNoticesSent,
  rememberChangeNoticesSent,
  routeHistoryFilename,
  routeHistoryMail,
  timeChangeNoticeDocument,
} from '../src/noticeMail.js';
import { contractCitations } from '../../public/shared/contractCitations.js';
import {
  CONTRACT_NOTICE_KINDS,
  contractNoticeKindById,
  contractNoticeMail,
  contractNoticeNeedsAttention,
  contractNoticeValues,
  describeContractNotice,
  isContractNoticeSent,
  loadSentContractIds,
  loadSentContractRecords,
  forgetContractNoticesSent,
  rememberContractNoticesSent,
} from '../src/contractNotice.js';
import {
  biddingDriverRoster,
  eomMonthOptions,
  eomOutsidePostingSeasonMessage,
  PAPER_BID_SHEET_DEFAULTS,
  periodForMonthKey,
  renderEomBiddingPacketHtml,
  routesApproachingBid,
  routesStillOpenForBid,
  routesUpForBid,
} from '../src/eomBidding.js';
import { initCitations } from '../../employee-tracker/web/citations.js';
import {
  calendarMonthsHtml,
  contractColumnsForHistory,
  contractNoticeCalendarHtml,
  escapeHtml,
  historyLegendHtml,
  monthsSpanningIsoDates,
  prettyDate,
  scheduleClockDiffers,
  scheduleHistoryTableHtml,
  toneForRow,
} from '../src/historyMarkup.js';
import { scheduleChangeKindHtml } from '../../employee-tracker/src/clockHistory.js';

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
const weeklyWorkTab = document.querySelector('#weekly-work-tab');
const dailyWorkTab = document.querySelector('#daily-work-tab');
const rosterTripsTab = document.querySelector('#roster-trips-tab');
const weeklyWorkView = document.querySelector('#weekly-work-view');
const dailyWorkView = document.querySelector('#daily-work-view');
const rosterTripsView = document.querySelector('#roster-trips-view');
const paperBackupView = document.querySelector('#paper-backup-view');
const timeclockSettingsView = document.querySelector('#timeclock-settings-view');
const trackerSettingsView = document.querySelector('#tracker-settings-view');
const trackerSettingsOpen = document.querySelector('#tracker-settings-open');
const adminReminderTab = document.querySelector('#admin-reminder-tab');
const driverNoticeTab = document.querySelector('#driver-notice-tab');
const contractNoticeTab = document.querySelector('#contract-notice-tab');
const biddingTab = document.querySelector('#bidding-tab');
const adminReminderView = document.querySelector('#admin-reminder-view');
const driverNoticeView = document.querySelector('#driver-notice-view');
const contractNoticeView = document.querySelector('#contract-notice-view');
const biddingView = document.querySelector('#bidding-view');
const eomBiddingMonth = document.querySelector('#eom-bidding-month');
const eomBiddingMonthHint = document.querySelector('#eom-bidding-month-hint');
const eomBiddingSeasonNote = document.querySelector('#eom-bidding-season-note');
const eomBiddingStatus = document.querySelector('#eom-bidding-status');
const eomBiddingRoutesBody = document.querySelector('#eom-bidding-routes-body');
const eomBiddingRoutesSummary = document.querySelector('#eom-bidding-routes-summary');
const eomBiddingStillOpenBody = document.querySelector('#eom-bidding-still-open-body');
const eomBiddingStillOpenSummary = document.querySelector('#eom-bidding-still-open-summary');
const eomBiddingApproachingBody = document.querySelector('#eom-bidding-approaching-body');
const eomBiddingApproachingSummary = document.querySelector('#eom-bidding-approaching-summary');
const eomBiddingPrint = document.querySelector('#eom-bidding-print');
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
let pendingSharedUiRefresh = false;
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

function isTripBoard(sheet = activeSheet) {
  return sheet === 'weekly-work' || sheet === 'daily-work' || sheet === 'roster-trips';
}

function isOfficeSheet(sheet = activeSheet) {
  return (
    sheet === 'payroll' ||
    sheet === 'clocking' ||
    sheet === 'clock-settings' ||
    sheet === 'paper-backup' ||
    isTripBoard(sheet)
  );
}

function toTimeInput(clock) {
  if (!clock) return '';
  const [h, m] = String(clock).split(':');
  return `${String(h).padStart(2, '0')}:${m}`;
}

function setStatus(el, message, kind = '') {
  if (!el) return;
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
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22V15"/>',
  bid: '<path d="m14.5 12.5-8 8a2.12 2.12 0 1 1-3-3l8-8"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>',
  bump: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>',
  decrease: '<path d="M22 17 13.5 8.5 8.5 13.5 2 7"/><path d="M16 17h6v-6"/>',
  increase: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
};

function iconHtml(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

function iconEl(name) {
  const wrap = document.createElement('span');
  wrap.innerHTML = iconHtml(name);
  return wrap.firstElementChild;
}

function markSectionChrome() {
  const onDrivers = activeSheet === 'drivers' && !addingPerson;
  const onPayroll = activeSheet === 'payroll' && !addingPerson;
  const onClocking = activeSheet === 'clocking' && !addingPerson;
  const onClockSettings = activeSheet === 'clock-settings' && !addingPerson;
  const onPaperBackup = activeSheet === 'paper-backup' && !addingPerson;
  const onWeekly = activeSheet === 'weekly-work' && !addingPerson;
  const onDaily = activeSheet === 'daily-work' && !addingPerson;
  const onRoster = activeSheet === 'roster-trips' && !addingPerson;
  const onSettings = activeSheet === 'settings' && !addingPerson;
  const onOfficeApp = onPayroll || onClocking || onClockSettings || onPaperBackup || onWeekly || onDaily || onRoster;
  const onAdminReminder = activeSheet === 'admin-reminder' && !addingPerson;
  const onDriverNotice = activeSheet === 'driver-notice' && !addingPerson;
  const onContractNotice = activeSheet === 'contract-notice' && !addingPerson;
  const onBidding = activeSheet === 'bidding' && !addingPerson;
  driversTab.classList.toggle('is-active', onDrivers);
  driversTab.setAttribute('aria-selected', onDrivers ? 'true' : 'false');
  dashboardApp?.classList.toggle('is-active', !onOfficeApp && !onSettings);
  payrollTab?.classList.toggle('is-active', onPayroll);
  clockingTab?.classList.toggle('is-active', onClocking || onClockSettings || onPaperBackup);
  weeklyWorkTab?.classList.toggle('is-active', onWeekly);
  dailyWorkTab?.classList.toggle('is-active', onDaily);
  rosterTripsTab?.classList.toggle('is-active', onRoster);
  dashboardApp?.removeAttribute('aria-current');
  payrollTab?.removeAttribute('aria-current');
  clockingTab?.removeAttribute('aria-current');
  weeklyWorkTab?.removeAttribute('aria-current');
  dailyWorkTab?.removeAttribute('aria-current');
  rosterTripsTab?.removeAttribute('aria-current');
  if (onPayroll) payrollTab?.setAttribute('aria-current', 'page');
  else if (onClocking || onClockSettings || onPaperBackup) clockingTab?.setAttribute('aria-current', 'page');
  else if (onWeekly) weeklyWorkTab?.setAttribute('aria-current', 'page');
  else if (onDaily) dailyWorkTab?.setAttribute('aria-current', 'page');
  else if (onRoster) rosterTripsTab?.setAttribute('aria-current', 'page');
  else if (!onSettings) dashboardApp?.setAttribute('aria-current', 'page');
  trackerSettingsOpen?.classList.toggle('is-active', onSettings);
  if (onSettings) trackerSettingsOpen?.setAttribute('aria-current', 'page');
  else trackerSettingsOpen?.removeAttribute('aria-current');
  adminReminderTab?.classList.toggle('is-active', onAdminReminder);
  adminReminderTab?.setAttribute('aria-selected', onAdminReminder ? 'true' : 'false');
  driverNoticeTab?.classList.toggle('is-active', onDriverNotice);
  driverNoticeTab?.setAttribute('aria-selected', onDriverNotice ? 'true' : 'false');
  contractNoticeTab?.classList.toggle('is-active', onContractNotice);
  contractNoticeTab?.setAttribute('aria-selected', onContractNotice ? 'true' : 'false');
  biddingTab?.classList.toggle('is-active', onBidding);
  biddingTab?.setAttribute('aria-selected', onBidding ? 'true' : 'false');
}

function renderRouteTabs() {
  markSectionChrome();
  const onDrivers = activeSheet === 'drivers' && !addingPerson;
  const onAll = activeSheet === 'all' && !addingPerson;
  const onDriverHistory = activeSheet === 'driver-history' && !addingPerson;
  const onPayroll = activeSheet === 'payroll' && !addingPerson;
  const onClocking = activeSheet === 'clocking' && !addingPerson;
  const onClockSettings = activeSheet === 'clock-settings' && !addingPerson;
  const onPaperBackup = activeSheet === 'paper-backup' && !addingPerson;
  const onWeekly = activeSheet === 'weekly-work' && !addingPerson;
  const onDaily = activeSheet === 'daily-work' && !addingPerson;
  const onRoster = activeSheet === 'roster-trips' && !addingPerson;
  const onSettings = activeSheet === 'settings' && !addingPerson;
  const onOfficeApp = onPayroll || onClocking || onClockSettings || onPaperBackup || onWeekly || onDaily || onRoster;
  const onAdminReminder = activeSheet === 'admin-reminder' && !addingPerson;
  const onDriverNotice = activeSheet === 'driver-notice' && !addingPerson;
  const onContractNotice = activeSheet === 'contract-notice' && !addingPerson;
  const onBidding = activeSheet === 'bidding' && !addingPerson;
  const onRoute =
    !addingPerson &&
    !onDrivers &&
    !onAll &&
    !onDriverHistory &&
    !onOfficeApp &&
    !onSettings &&
    !onAdminReminder &&
    !onDriverNotice &&
    !onContractNotice &&
    !onBidding;
  const currentId = onRoute ? getCurrentProfile()?.id : null;
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
    activeSheet !== 'paper-backup' &&
    activeSheet !== 'weekly-work' &&
    activeSheet !== 'daily-work' &&
    activeSheet !== 'roster-trips' &&
    activeSheet !== 'settings' &&
    activeSheet !== 'admin-reminder' &&
    activeSheet !== 'driver-notice' &&
    activeSheet !== 'contract-notice' &&
    activeSheet !== 'bidding' &&
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
        : 'Allow pop-up windows for this site, then open Driver Clock Records again.';
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
  if (!isOfficeSheet()) {
    sheetBeforeOffice = activeSheet === 'driver-history' ? 'drivers' : activeSheet;
  }
}

function openTripFrame(list) {
  const frameId = list === 'roster' ? 'roster-trips-frame' : list === 'weekly' ? 'weekly-work-frame' : 'daily-work-frame';
  const frame = document.querySelector(`#${frameId}`);
  if (!(frame instanceof HTMLIFrameElement) || frame.dataset.loaded === list) return;
  frame.src = `/board?as=office&embed=1&sheet=${list}`;
  frame.dataset.loaded = list;
}

const TRIP_SCREEN_KEYS = {
  daily: 'teamster-daily-work-screen',
  weekly: 'teamster-weekly-work-screen',
};

function tripScreen(kind = 'daily') {
  const weekly = kind === 'weekly';
  return {
    kind,
    sheet: weekly ? 'weekly' : 'daily',
    postings: weekly ? 'Weekly Work Postings' : 'Daily/Late Work Postings',
    admin: weekly ? 'Weekly Work Admin' : 'Daily/Late Work Admin',
    storageKey: TRIP_SCREEN_KEYS[weekly ? 'weekly' : 'daily'],
    windowName: weekly ? 'teamster-weekly-work' : 'teamster-daily-work',
    status: document.querySelector(weekly ? '#weekly-work-screen-status' : '#daily-work-screen-status'),
    select: document.querySelector(weekly ? '#weekly-work-monitor' : '#daily-work-monitor'),
    wall: document.querySelector(weekly ? '#weekly-work-wall' : '#daily-work-wall'),
  };
}

function setDailyWorkScreenStatus(message, isError = false, kind = 'daily') {
  if (kind === 'weekly') {
    weeklyPostingsStatus.message = message || '';
    weeklyPostingsStatus.isError = Boolean(isError && message);
    notifyWeeklyPostings();
    return;
  }
  const status = tripScreen(kind).status;
  if (!(status instanceof HTMLElement)) return;
  status.hidden = !message;
  status.textContent = message || '';
  status.classList.toggle('is-error', Boolean(isError));
}

function dailyWorkWindowUrl(kind = 'daily') {
  const url = new URL('/board', location.origin);
  url.searchParams.set('as', 'driver');
  url.searchParams.set('sheet', tripScreen(kind).sheet);
  url.searchParams.set('display', 'wall');
  return url.href;
}

function readDailyWorkScreenSetting(kind = 'daily') {
  try {
    const raw = localStorage.getItem(tripScreen(kind).storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDailyWorkScreenSetting(screen, kind = 'daily') {
  try {
    const key = tripScreen(kind).storageKey;
    if (!screen) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(screenIdentity(screen)));
  } catch {
    // This browser is not storing the monitor, so the postings stay on this screen.
  }
}

function screenIdentity(screen) {
  return {
    label: String(screen?.label || '').trim(),
    left: Number(screen?.left) || 0,
    top: Number(screen?.top) || 0,
    width: Number(screen?.width) || 0,
    height: Number(screen?.height) || 0,
  };
}

function sameDailyWorkScreen(saved, screen) {
  if (!saved || !screen) return false;
  const label = String(screen.label || '').trim();
  if (saved.label && label && saved.label === label) return true;
  return (
    Number(saved.left) === (Number(screen.left) || 0) &&
    Number(saved.top) === (Number(screen.top) || 0) &&
    Number(saved.width) === (Number(screen.width) || 0) &&
    Number(saved.height) === (Number(screen.height) || 0)
  );
}

const tripMonitorScreens = { daily: [], weekly: [] };
const weeklyPostingsChoice = { value: 'this', options: [] };
const weeklyPostingsStatus = { message: '', isError: false };

function monitorChoices(screens, saved) {
  const options = [{ value: 'this', label: 'This screen' }];
  screens.forEach((screen, index) => {
    options.push({ value: String(index), label: timeclockScreenLabel(screen) });
  });
  let selected = 'this';
  if (saved) {
    const match = screens.findIndex((screen) => sameDailyWorkScreen(saved, screen));
    if (match >= 0) selected = String(match);
    else {
      options.push({ value: 'saved', label: saved.label || 'Saved monitor' });
      selected = 'saved';
    }
  }
  options.push({ value: 'pick', label: 'Choose a monitor…' });
  return { options, selected };
}

function notifyWeeklyPostings() {
  const frame = document.querySelector('#weekly-work-frame');
  if (!(frame instanceof HTMLIFrameElement) || !frame.getAttribute('src') || !frame.contentWindow) return;
  try {
    frame.contentWindow.postMessage({ type: 'weekly-postings-sync' }, location.origin);
  } catch {
    // The admin frame is not open yet.
  }
}

function paintDailyWorkMonitorSelect(screens = tripMonitorScreens.daily, kind = 'daily') {
  const saved = readDailyWorkScreenSetting(kind);
  tripMonitorScreens[kind] = screens;
  const { options, selected } = monitorChoices(screens, saved);
  if (kind === 'weekly') {
    weeklyPostingsChoice.options = options;
    weeklyPostingsChoice.value = selected;
    notifyWeeklyPostings();
    return;
  }
  const select = tripScreen(kind).select;
  if (!(select instanceof HTMLSelectElement)) return;
  select.replaceChildren();
  for (const option of options) select.add(new Option(option.label, option.value));
  select.value = selected;
}

function dailyWorkWallFrame(kind = 'daily') {
  const frame = tripScreen(kind).wall;
  return frame instanceof HTMLIFrameElement ? frame : null;
}

function closeDailyWorkWall(kind = 'daily') {
  const frame = dailyWorkWallFrame(kind);
  if (!frame) return;
  frame.classList.remove('is-open');
  frame.setAttribute('aria-hidden', 'true');
}

function openWallKind() {
  if (dailyWorkWallFrame('weekly')?.classList.contains('is-open')) return 'weekly';
  if (dailyWorkWallFrame('daily')?.classList.contains('is-open')) return 'daily';
  return '';
}

function requestNodeFullscreen(node) {
  const request = node.requestFullscreen || node.webkitRequestFullscreen;
  if (typeof request !== 'function') return Promise.reject(new Error('Full screen is unavailable.'));
  const pending = request === node.requestFullscreen ? request.call(node, { navigationUI: 'hide' }) : request.call(node);
  return Promise.resolve(pending);
}

function showDailyWorkOnThisScreen(message, kind = 'daily') {
  const board = tripScreen(kind);
  const frame = dailyWorkWallFrame(kind);
  if (!frame) return;
  const note = message || `${board.postings} is full screen on this screen.`;
  frame.classList.add('is-open');
  frame.removeAttribute('aria-hidden');
  if (!frame.getAttribute('src')) frame.src = dailyWorkWindowUrl(kind);
  requestNodeFullscreen(frame)
    .catch(() => requestNodeFullscreen(document.documentElement))
    .then(() => setDailyWorkScreenStatus(note, false, kind))
    .catch(() => {
      setDailyWorkScreenStatus(`${board.postings} fills this window. Press Escape to return to ${board.admin}.`, false, kind);
    });
}

function openDailyWorkWindow(screen, placed = false, kind = 'daily') {
  const board = tripScreen(kind);
  const opened = window.open(dailyWorkWindowUrl(kind), board.windowName, timeclockWindowFeatures(screen));
  if (!opened) {
    setDailyWorkScreenStatus(`Allow pop-up windows for this site, then choose ${board.postings} again.`, true, kind);
    return;
  }
  const bounds = timeclockWindowBounds(screen);
  if (bounds) {
    try {
      opened.moveTo(bounds.left, bounds.top);
      opened.resizeTo(bounds.width, bounds.height);
    } catch {
      // The browser can refuse to move a window until it allows screen placement.
    }
  }
  opened.focus();
  setDailyWorkScreenStatus(
    placed && screen
      ? `${board.postings} is open on ${timeclockScreenLabel(screen)}.`
      : `${board.postings} is full screen.`,
    false,
    kind
  );
}

async function chooseDailyWorkMonitor(kind = 'daily') {
  const board = tripScreen(kind);
  const stay = `${board.postings} stays full screen on this screen. Mirror this display, or extend the desktop and choose that monitor here.`;
  if (window.screen?.isExtended === false || typeof window.getScreenDetails !== 'function') {
    paintDailyWorkMonitorSelect([], kind);
    setDailyWorkScreenStatus(stay, false, kind);
    return;
  }
  let details;
  try {
    details = await window.getScreenDetails();
  } catch {
    paintDailyWorkMonitorSelect([], kind);
    setDailyWorkScreenStatus(
      `${board.postings} stays full screen on this screen. Mirror this display, or allow screen access and choose a monitor.`,
      false,
      kind
    );
    return;
  }
  const others = otherTimeclockScreens(details);
  paintDailyWorkMonitorSelect(others, kind);
  if (!others.length) {
    setDailyWorkScreenStatus(stay, false, kind);
    return;
  }
  setDailyWorkScreenStatus(`Choose the monitor for ${board.postings}.`, false, kind);
}

async function openDailyWorkBoard(kind = 'daily') {
  const board = tripScreen(kind);
  setDailyWorkScreenStatus('', false, kind);
  const select = board.select;
  const value =
    kind === 'weekly' ? weeklyPostingsChoice.value : select instanceof HTMLSelectElement ? select.value : 'this';
  if (value === 'this' || value === 'pick') {
    showDailyWorkOnThisScreen('', kind);
    return;
  }
  const saved = value === 'saved' ? readDailyWorkScreenSetting(kind) : screenIdentity(tripMonitorScreens[kind][Number(value)]);
  if (!saved || typeof window.getScreenDetails !== 'function') {
    showDailyWorkOnThisScreen('', kind);
    return;
  }
  let details;
  try {
    details = await window.getScreenDetails();
  } catch {
    showDailyWorkOnThisScreen('', kind);
    return;
  }
  const match = otherTimeclockScreens(details).find((screen) => sameDailyWorkScreen(saved, screen));
  if (!match) {
    showDailyWorkOnThisScreen(`That monitor is not connected. ${board.postings} is full screen on this screen.`, kind);
    return;
  }
  openDailyWorkWindow(match, true, kind);
}

async function setWeeklyPostingsMonitor(value) {
  weeklyPostingsChoice.value = value;
  if (value === 'pick') {
    await chooseDailyWorkMonitor('weekly');
    return;
  }
  if (value === 'this') {
    writeDailyWorkScreenSetting(null, 'weekly');
    setDailyWorkScreenStatus('Weekly Work Postings opens full screen on this screen.', false, 'weekly');
    return;
  }
  if (value === 'saved') return;
  const screen = tripMonitorScreens.weekly[Number(value)];
  if (!screen) return;
  writeDailyWorkScreenSetting(screen, 'weekly');
  setDailyWorkScreenStatus(`Weekly Work Postings opens on ${timeclockScreenLabel(screen)}.`, false, 'weekly');
}

window.weeklyPostings = {
  describe() {
    return {
      options: weeklyPostingsChoice.options.map((option) => ({ ...option })),
      value: weeklyPostingsChoice.value,
      status: weeklyPostingsStatus.message,
      isError: weeklyPostingsStatus.isError,
    };
  },
  setMonitor: setWeeklyPostingsMonitor,
  open: () => openDailyWorkBoard('weekly'),
};

function bindTripMonitor(kind) {
  paintDailyWorkMonitorSelect(tripMonitorScreens[kind], kind);
  tripScreen(kind).select?.addEventListener('change', (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    const board = tripScreen(kind);
    if (select.value === 'pick') {
      chooseDailyWorkMonitor(kind).catch((error) => setDailyWorkScreenStatus(error.message, true, kind));
      return;
    }
    if (select.value === 'this') {
      writeDailyWorkScreenSetting(null, kind);
      setDailyWorkScreenStatus(`${board.postings} opens full screen on this screen.`, false, kind);
      return;
    }
    if (select.value === 'saved') return;
    const screen = tripMonitorScreens[kind][Number(select.value)];
    if (!screen) return;
    writeDailyWorkScreenSetting(screen, kind);
    setDailyWorkScreenStatus(`${board.postings} opens on ${timeclockScreenLabel(screen)}.`, false, kind);
  });
}
bindTripMonitor('daily');
bindTripMonitor('weekly');
document.addEventListener('fullscreenchange', () => {
  const kind = openWallKind();
  if (kind && !document.fullscreenElement) closeDailyWorkWall(kind);
});
document.addEventListener('keydown', (event) => {
  const kind = openWallKind();
  if (event.key !== 'Escape' || !kind) return;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  closeDailyWorkWall(kind);
});
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.data?.type !== 'daily-work-wall-close') return;
  const kind = openWallKind() || 'daily';
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  closeDailyWorkWall(kind);
});

function showWeeklyWork() {
  rememberOfficeSheet();
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'weekly-work';
  loadAll();
  weeklyWorkView?.scrollIntoView({ block: 'start' });
}

function showDailyWork() {
  rememberOfficeSheet();
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'daily-work';
  loadAll();
  dailyWorkView?.scrollIntoView({ block: 'start' });
}

function showRosterTrips() {
  rememberOfficeSheet();
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'roster-trips';
  loadAll();
  rosterTripsView?.scrollIntoView({ block: 'start' });
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

async function showClockSettings() {
  rememberOfficeSheet();
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'clock-settings';
  try {
    await ensureTimeclock();
    loadAll();
    timeclockSettingsView?.scrollIntoView({ block: 'start' });
  } catch (error) {
    setStatus(fileStatus, error.message || 'Could not open timeclock settings.', 'error');
  }
}

async function showPaperBackup() {
  rememberOfficeSheet();
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'paper-backup';
  try {
    await ensurePaperBackup();
    loadAll();
    paperBackupView?.scrollIntoView({ block: 'start' });
  } catch (error) {
    setStatus(fileStatus, error.message || 'Could not open paper records.', 'error');
  }
}

async function showTrackerSettings() {
  if (activeSheet === 'settings') {
    showDrivers();
    return;
  }
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'settings';
  try {
    await ensureTimeclock();
    loadAll();
    trackerSettingsView?.scrollIntoView({ block: 'start' });
  } catch (error) {
    setStatus(fileStatus, error.message || 'Could not open settings.', 'error');
  }
}

function showDashboardApp() {
  if (activeSheet === 'settings') {
    showDrivers();
    return;
  }
  if (!isOfficeSheet()) {
    return;
  }
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
  if (back === 'contract-notice') {
    showContractNotice();
    return;
  }
  if (back === 'bidding') {
    showBidding();
    return;
  }
  if (
    back &&
    back !== 'drivers' &&
    back !== 'payroll' &&
    back !== 'clocking' &&
    back !== 'clock-settings' &&
    back !== 'paper-backup' &&
    !isTripBoard(back) &&
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

function showContractNotice() {
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'contract-notice';
  loadAll();
  fillContractNoticeSettings();
}

function showBidding() {
  addingPerson = false;
  viewingDriver = '';
  activeSheet = 'bidding';
  loadAll();
  renderEomBidding();
}

driversTab.addEventListener('click', showDrivers);
dashboardApp?.addEventListener('click', showDashboardApp);
trackerSettingsOpen?.addEventListener('click', showTrackerSettings);

const TERMS_SEEN_KEY = 'teamster-tracker-terms-seen';
const termsDialog = document.querySelector('#terms-dialog');

function termsAlreadySeen() {
  try {
    return localStorage.getItem(TERMS_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberTermsSeen() {
  try {
    localStorage.setItem(TERMS_SEEN_KEY, '1');
  } catch {
    // This browser is not storing the reminder, so the message can appear again.
  }
}

function openTermsDialog() {
  if (!termsDialog || termsDialog.open) return;
  termsDialog.showModal();
}

document.querySelector('#terms-open')?.addEventListener('click', openTermsDialog);
document.querySelector('#terms-close')?.addEventListener('click', () => termsDialog?.close());
document.querySelector('#terms-ok')?.addEventListener('click', () => termsDialog?.close());
termsDialog?.addEventListener('click', (event) => {
  if (event.target === termsDialog) termsDialog.close();
});
termsDialog?.addEventListener('close', rememberTermsSeen);

if (!termsAlreadySeen()) openTermsDialog();
payrollTab?.addEventListener('click', showPayroll);
clockingTab?.addEventListener('click', showClocking);
weeklyWorkTab?.addEventListener('click', showWeeklyWork);
dailyWorkTab?.addEventListener('click', showDailyWork);
document.querySelector('#daily-work-screen')?.addEventListener('click', () => {
  openDailyWorkBoard('daily').catch((error) => setDailyWorkScreenStatus(error.message, true, 'daily'));
});
rosterTripsTab?.addEventListener('click', showRosterTrips);
document.querySelector('#open-drivers')?.addEventListener('click', () => openOfficeWindow('payroll'));
document.querySelector('#open-clock-records')?.addEventListener('click', () => openOfficeWindow('clocking'));
document.querySelector('#timeclock-settings-open')?.addEventListener('click', showClockSettings);
document.querySelector('#timeclock-settings-back')?.addEventListener('click', showClocking);
document.querySelector('#open-paper-backup')?.addEventListener('click', showPaperBackup);
document.querySelector('#paper-backup-reminder-open')?.addEventListener('click', showPaperBackup);
document.querySelector('#paper-backup-back')?.addEventListener('click', showClocking);
adminReminderTab?.addEventListener('click', showAdminReminder);
driverNoticeTab?.addEventListener('click', showDriverNotice);
contractNoticeTab?.addEventListener('click', showContractNotice);
biddingTab?.addEventListener('click', showBidding);
eomBiddingMonth?.addEventListener('change', () => {
  renderEomBidding({ preserveMonth: true });
});
eomBiddingPrint?.addEventListener('click', printEomBiddingPacket);

let reminderInvitees = [];
let officeUsers = [];

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
  const copy = noticeCcAddress('sample.driver@example.com', document.querySelector('#driver-notice-secretary')?.value);
  const ccLine = copy ? `Cc: ${copy}\n` : '';
  return `Sample email\n${ccLine}${mail.subject}\n\n${mail.body}${attachment}`;
}

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
  const secretary = document.querySelector('#driver-notice-secretary');
  const status = document.querySelector('#driver-notice-status');
  setChoice('notice_attach', settings.attachTimeChangeNotice);
  if (secretary) secretary.value = settings.secretaryCc;
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
  const secretaryCc = document.querySelector('#driver-notice-secretary')?.value ?? '';
  if (String(secretaryCc).trim() && !isEmailAddress(secretaryCc)) {
    if (status) setStatus(status, 'Enter a valid email for the secretary, or leave it blank.', 'error');
    return;
  }
  try {
    saveDriverNotice({
      memorandumId: selectedMemorandumId(),
      memorandumTemplates: collectMemorandumTemplates(),
      attachTimeChangeNotice: checkedChoice('notice_attach'),
      secretaryCc,
      subject: document.querySelector('#driver-notice-subject')?.value,
      body: document.querySelector('#driver-notice-body')?.value,
    });
    fillDriverNoticeSettings();
    if (status) setStatus(status, 'Driver time-change notice saved.', 'ok');
  } catch (error) {
    if (status) setStatus(status, error.message, 'error');
  }
});

document.querySelector('#notice-queue')?.addEventListener('click', (event) => {
  const button = event.target.closest('.js-send-notice');
  if (button) {
    sendChangeNotice(button);
    return;
  }
  const printNotice = event.target.closest('.js-print-notice');
  if (printNotice) {
    const changeId = printNotice.closest('[data-change-id]')?.dataset.changeId;
    if (changeId) printClockNotice(changeId, printNotice);
    return;
  }
  const mark = event.target.closest('.js-mark-notice-sent');
  if (mark) {
    const changeId = mark.closest('[data-change-id]')?.dataset.changeId;
    if (changeId) {
      if (mark.dataset.sent === 'yes') unmarkClockNotices([changeId]);
      else markClockNoticesSent([changeId]);
    }
    return;
  }
  if (event.target.closest('.js-mark-sent-selected')) {
    markClockNoticesSent(selectedNoticeIds('#notice-queue'));
  }
});

document.querySelector('#notice-queue')?.addEventListener('change', (event) => {
  if (!event.target.closest('.js-notice-select, .js-notice-select-all')) return;
  if (event.target.classList.contains('js-notice-select-all')) {
    const on = event.target.checked;
    document.querySelectorAll('#notice-queue .js-notice-select').forEach((box) => {
      box.checked = on;
    });
  }
  syncNoticeSelection('#notice-queue');
});

document.querySelector('#contract-notice-queue')?.addEventListener('click', (event) => {
  const button = event.target.closest('.js-send-contract-notice');
  if (button) {
    sendContractNotice(button);
    return;
  }
  const printNotice = event.target.closest('.js-print-contract-notice');
  if (printNotice) {
    const changeId = printNotice.closest('[data-change-id]')?.dataset.changeId;
    if (changeId) printContractNotice(changeId, printNotice);
    return;
  }
  const mark = event.target.closest('.js-mark-contract-sent');
  if (mark) {
    const changeId = mark.closest('[data-change-id]')?.dataset.changeId;
    if (changeId) {
      if (mark.dataset.sent === 'yes') unmarkContractNotices([changeId]);
      else markContractNoticesSent([changeId]);
    }
    return;
  }
  if (event.target.closest('.js-mark-sent-selected')) {
    markContractNoticesSent(selectedNoticeIds('#contract-notice-queue'));
  }
});

document.querySelector('#contract-notice-queue')?.addEventListener('change', (event) => {
  if (!event.target.closest('.js-notice-select, .js-notice-select-all')) return;
  if (event.target.classList.contains('js-notice-select-all')) {
    const on = event.target.checked;
    document.querySelectorAll('#contract-notice-queue .js-notice-select').forEach((box) => {
      box.checked = on;
    });
  }
  syncNoticeSelection('#contract-notice-queue');
});

document.querySelector('#contract-notice-reset')?.addEventListener('click', () => {
  renderContractNoticeEditors({});
});

document.querySelector('#contract-notice-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const status = document.querySelector('#contract-notice-status');
  const secretaryCc = document.querySelector('#contract-notice-secretary')?.value ?? '';
  if (String(secretaryCc).trim() && !isEmailAddress(secretaryCc)) {
    if (status) setStatus(status, 'Enter a valid email for the secretary, or leave it blank.', 'error');
    return;
  }
  try {
    saveContractNotice({
      secretaryCc,
      templates: collectContractTemplates(),
    });
    fillContractNoticeSettings();
    if (status) setStatus(status, 'Contract time-change notice saved.', 'ok');
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
  if (weeklyWorkView) weeklyWorkView.hidden = true;
  if (dailyWorkView) dailyWorkView.hidden = true;
  if (rosterTripsView) rosterTripsView.hidden = true;
  if (paperBackupView) paperBackupView.hidden = true;
  if (timeclockSettingsView) timeclockSettingsView.hidden = true;
  if (trackerSettingsView) trackerSettingsView.hidden = true;
  if (adminReminderView) adminReminderView.hidden = true;
  if (driverNoticeView) driverNoticeView.hidden = true;
  if (contractNoticeView) contractNoticeView.hidden = true;
  if (biddingView) biddingView.hidden = true;
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

function scheduleRunsLabel(schedule) {
  return RUNS.map((run) => {
    const item = schedule?.[run.id];
    if (!item?.clock_in || !item?.clock_out) return `${run.label} —`;
    return `${run.label} ${formatClockAmPm(`${item.clock_in}-${item.clock_out}`)}`;
  }).join(' · ');
}

function contractedRunsLabel(segments, snap = {}) {
  return RUNS.map((run) => {
    let range = segments?.[run.id] || null;
    if (range && snap.snapContractClocks === true) {
      try {
        range = snapContractTimeRange(range, snap.contractSnapBreaks);
      } catch {
        // Keep the written range if snap cannot read it.
      }
    }
    if (!range) return `${run.label} —`;
    return `${run.label} ${formatClockAmPm(range)}`;
  }).join(' · ');
}

function establishedLine(date) {
  const iso = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 'Established date unknown';
  return `Established ${prettyDate(iso)}`;
}

function renderHero() {
  hero.className = 'hero panel';

  const profile = getCurrentProfile();
  const name = snapshot.employee?.name;
  const driver = profile?.driver_name;
  const officeNote = String(profile?.note ?? '').trim();
  const routeLabel = name ? `Route ${name}` : 'Route';
  const title = driver ? `${routeLabel} · ${driver}` : routeLabel;

  const history = snapshot.schedule_history || [];
  const clockEstablished =
    history.at(-1)?.date || snapshot.employee?.start_date || profile?.start_date || null;
  const clockTimes = scheduleRunsLabel(snapshot.schedule);

  const snap = contractSnapOptions(loadState());
  let contractedTimes = 'AM — · Midday — · PM —';
  let contractEstablished = null;
  try {
    const entry = rebuildEmployeeRouteState(
      profile?.changeLog ?? [],
      calendarPayload(),
      getAsOfDate(),
      {},
      snap
    );
    contractedTimes = contractedRunsLabel(contractedSegments(entry), snap);
    contractEstablished = contractStartedOn(entry, {
      startDate: profile?.start_date || snapshot.employee?.start_date || '',
      changeLog: profile?.changeLog ?? [],
    });
  } catch {
    // Keep empty contracted times if the route state cannot be rebuilt yet.
  }

  hero.innerHTML = `
    <h1 class="hero-title">${escapeHtml(title)}</h1>
    <ul class="hero-times">
      <li>
        <span class="hero-times-label">Current clock times</span>
        <strong>${escapeHtml(clockTimes)}</strong>
        <span class="hero-times-when">${escapeHtml(establishedLine(clockEstablished))}</span>
      </li>
      <li>
        <span class="hero-times-label">Current contracted times</span>
        <strong>${escapeHtml(contractedTimes)}</strong>
        <span class="hero-times-when">${escapeHtml(establishedLine(contractEstablished))}</span>
      </li>
    </ul>
    ${officeNote ? `<p class="hero-detail">${escapeHtml(officeNote)}</p>` : ''}
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
  const noticeHint =
    ' The mail icon on a change sends the notice. If that notice was already sent, you will be warned first. The email uses the chosen memorandum and downloads a calendar PDF. Attach that PDF if you want the driver to see the calendar. The complete time change history can be downloaded too, when that attachment is turned on.';
  const hoursHint =
    ' New Schedule Started is the date only. Change holds the minute change, cumulative change, and countdown lines. Scheduled Hours is the rounded total of the clock times on that row. When “Use quarter hour snapping for contract times” is on, Change (including Countdown lines) uses that same snapped schedule instead of exact minutes. When “Bid/bump windows use snapped contract times” is also on, the 15-school-day countdown and 30-minute bid/bump line use those snapped totals too. Contract Time Change is the date those rounded hours changed, or the date they are predicted to change, such as Nov 4. For a route that goes up for bid, that date is the 15th school day after the change. A row that rounds to the same total as the row above has no date there. Date, if Contracted is the date that schedule became the contract, a predicted contract date, or "Predicted up for bid mm/dd–mm/dd" when the route goes up for bid during the last five school days of the month.';
  scheduleLead.textContent = start
    ? `Each row is a full schedule. The first row is the established starting times from ${prettyDate(start)}. Later rows are changes, oldest to newest.${hoursHint}${noticeHint}`
    : `Each row is a full schedule. The first row is the established starting times. Later rows are changes, oldest to newest.${hoursHint}${noticeHint}`;

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
      '<tr><td colspan="12" class="empty">No clock times recorded yet.</td></tr>';
    return;
  }

  const columns = contractColumnsForHistory(rows, undefined, contractSnapOptions(loadState()));
  body.innerHTML =
    rows
      .map((row, index) => {
        const predicted = row.contracted?.status === 'predicted';
        const kind = scheduleChangeKindHtml(row, escapeHtml);
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
        <th scope="row">
          ${scheduleDateField(row.date, {
            allowNull: false,
            sendNotice: row.kind === 'change',
          })}
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
        <td class="change-figure">${kind}</td>
        <td class="hours-figure">${escapeHtml(column.hours)}</td>
        <td class="hours-figure">${escapeHtml(column.contractTimeChange)}</td>
        <td>
          <div class="contracted-cell">
            <span class="contracted-stack">
              <span class="contracted-date">${escapeHtml(column.contractedDate)}</span>
            </span>
            ${contractedInfoControl(row)}
          </div>
        </td>
        <td>${actions}</td>
      </tr>`;
      })
      .join('') + entryRowMarkup(rows);
  markScheduleTimeDiffs();
}

function markScheduleTimeDiffs() {
  const rows = [...scheduleHistory.querySelectorAll('tbody tr')].filter((row) =>
    row.querySelector('input[type="time"]')
  );
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    for (const input of row.querySelectorAll('input[type="time"]')) {
      const run = input.dataset.run;
      const which = input.dataset.which;
      const prior = previous?.querySelector(
        `input[type="time"][data-run="${run}"][data-which="${which}"]`
      );
      const differs = Boolean(previous) && scheduleClockDiffers(input.value, prior?.value);
      input.classList.toggle('is-time-diff', differs);
      if (differs) input.title = 'Different from the row above';
      else if (input.title === 'Different from the row above') input.removeAttribute('title');
    }
  });
}

function scheduleDateField(
  value,
  {
    id = '',
    className = 'js-history-date',
    label = 'New schedule started',
    allowNull = true,
    sendNotice = false,
  } = {}
) {
  const empty = !value;
  const idAttr = id ? ` id="${id}"` : '';
  const trailing = sendNotice
    ? `<button type="button" class="schedule-date-mail js-send-notice" aria-label="Send notice" title="Send notice">${iconHtml(
        'mail'
      )}</button>`
    : allowNull
      ? `<button type="button" class="schedule-date-null js-date-null" aria-pressed="${empty ? 'true' : 'false'}">N/A</button>`
      : '';
  return `<div class="schedule-date${empty && allowNull ? ' is-null' : ''}">
    <input${idAttr} class="entry-input ${className}" type="date" aria-label="${label}" value="${escapeHtml(value || '')}" />
    ${trailing}
  </div>`;
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
    `<input id="entry_${run.id}_${which}" class="entry-input" type="time" step="60" data-run="${run.id}" data-which="${which}" aria-label="${run.label} ${
      which === 'in' ? 'start' : 'end'
    }" value="${value ? toTimeInput(value) : ''}" />`;
  return `<tr class="is-entry is-new-change">
    <th scope="row">
      ${scheduleDateField(lastDate, { id: 'entry_date', className: '', label: 'Date the change takes effect' })}
    </th>
    ${RUNS.map((run) => {
      const item = schedule[run.id];
      return `<td class="${run.shade}">${timeField(run, 'in', item?.clock_in)}</td><td class="${run.shade}">${timeField(run, 'out', item?.clock_out)}</td>`;
    }).join('')}
    <td class="change-figure"><span class="row-kind">New time change</span></td>
    <td></td>
    <td></td>
    <td class="is-editor">
      <label class="entry-editor" for="entry_editor">
        Comment
        <input id="entry_editor" class="entry-input" type="text" placeholder="Optional" />
      </label>
    </td>
    <td>
      <button type="button" id="add-change-row">Add this change</button>
    </td>
  </tr>`;
}

function isEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}

function noticeSender() {
  const account = currentAccount();
  return {
    by: String(account?.name || '').trim(),
    by_user_id: account?.id ? String(account.id) : null,
    at: new Date().toISOString(),
  };
}

function sentColumnText(sent, ids, records) {
  if (!sent) return 'No';
  return noticeSentLineForIds(ids, records) || 'Yes';
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
    const cc = noticeCcAddress(email, noticeSettings.secretaryCc);
    await withRouteCalendar(profile, history, () => downloadCalendarPdf(downloads[0]));
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
    openNoticeMail({ to: email, cc, subject: mail.subject, body: mail.body });
    explainNoticeDownloads(downloads);
    const sentIds = row.change_ids?.length ? row.change_ids : [changeId];
    rememberChangeNoticesSent(sentIds, undefined, noticeSender());
    if ((snapshot?.schedule_history || []).some((item) => item.change_id === changeId)) {
      renderScheduleHistory();
    }
    renderDriverNoticeQueue();
    paintNoticeTabFlags();
    paintRecentNoticeFlags();
    const listed = downloads.join(' and ');
    const noun = downloads.length > 1 ? 'them' : 'it';
    const copied = cc ? ` ${cc} is copied.` : '';
    const stamp = sentColumnText(true, sentIds, loadSentChangeRecords());
    return {
      ok: true,
      message: `Please look for ${listed} in your downloads folder and attach ${noun}.${copied} ${stamp}.`,
    };
  } catch (error) {
    return { ok: false, message: error.message || 'Could not create that notice.' };
  }
}

function noticeStatusTarget(button) {
  if (button?.closest('#contract-notice-queue')) return document.querySelector('#contract-notice-queue-status');
  if (button?.closest('#notice-queue')) return document.querySelector('#notice-queue-status');
  return scheduleStatus;
}

async function runChangeNotice(changeId, button) {
  const status = noticeStatusTarget(button);
  const located = locateChange(changeId);
  if (!located) {
    setStatus(status, 'That clock-time change could not be found.', 'error');
    return;
  }
  if (button) button.disabled = true;
  const downloading = loadDriverNotice().attachTimeChangeNotice
    ? 'Opening the email and downloading the calendar and the time change history…'
    : 'Opening the email and downloading the calendar…';
  setStatus(status, downloading);
  const result = await deliverChangeNotice(located);
  setStatus(status, result.message, result.ok ? 'ok' : 'error');
  if (!result.ok && button) button.disabled = false;
}

async function sendChangeNotice(button) {
  const changeId = button.closest('[data-change-id]')?.dataset.changeId;
  if (!changeId) return;
  if (changeNoticeAlreadySent(changeId)) {
    queueNoticeOffer([changeId]);
    return;
  }
  await runChangeNotice(changeId, button);
}

function noticeFlagHtml() {
  return `<span class="notice-flag" title="Notice not sent">${iconHtml('flag')}<span class="visually-hidden">Notice not sent. </span></span>`;
}

let coveredClockNoticeIds = new Set();

function refreshCoveredClockNotices() {
  coveredClockNoticeIds = noticeCoveredIds(recentRouteChanges(loadState()), loadSentChangeIds());
}

function changeNoticeAlreadySent(changeId) {
  const id = String(changeId || '');
  if (!id) return false;
  if (isChangeNoticeSent(id)) return true;
  if (!coveredClockNoticeIds.size) refreshCoveredClockNotices();
  return coveredClockNoticeIds.has(id);
}

async function withRouteCalendar(profile, history, action) {
  const onThisRoute =
    appView &&
    !appView.hidden &&
    getCurrentProfile()?.id === profile?.id &&
    calendarMonths?.childElementCount;
  if (onThisRoute) return action();
  const previousSnapshot = snapshot;
  const previousMonths = calendarMonths?.innerHTML ?? '';
  const previousLegend = historyLegend?.innerHTML ?? '';
  snapshot = {
    ...(previousSnapshot || {}),
    schedule_history: history,
    as_of: getAsOfDate(),
  };
  try {
    renderCalendar();
    return await action();
  } finally {
    snapshot = previousSnapshot;
    if (calendarMonths) calendarMonths.innerHTML = previousMonths;
    if (historyLegend) historyLegend.innerHTML = previousLegend;
  }
}

function sameDayNoticeIds(item, items) {
  const date = String(item.effectiveDate || '').trim();
  if (!date) return [item.id];
  return items
    .filter((other) => other.routeId === item.routeId && other.effectiveDate === date)
    .map((other) => other.id);
}

function driverNoticeItems() {
  refreshCoveredClockNotices();
  const records = loadSentChangeRecords();
  const state = loadState();
  const profiles = Object.values(state?.profiles || {});
  const byId = new Map(profiles.map((profile) => [String(profile?.id || ''), profile]));
  const items = recentRouteChanges(state).map((item) => {
    const profile = byId.get(item.routeId);
    const driverName = profile ? driverForDate(profile, item.effectiveDate) : '';
    return {
      ...item,
      driverName,
      sent: coveredClockNoticeIds.has(item.id) || isChangeNoticeSent(item.id),
      previousLabel: formatClockAmPm(item.previousTime),
      newLabel: formatClockAmPm(item.newTime),
    };
  });
  return items.map((item) => ({
    ...item,
    sentLabel: sentColumnText(item.sent, sameDayNoticeIds(item, items), records),
  }));
}

function contractNoticeItems() {
  const asOf = getAsOfDate();
  const calendar = calendarPayload();
  const records = loadSentContractRecords();
  const sent = new Set(loadSentContractIds());
  const items = [];
  for (const profile of listProfiles()) {
    let built;
    try {
      built = buildSnapshot(profile, asOf);
    } catch {
      continue;
    }
    const history = built?.schedule_history || [];
    history.forEach((row, index) => {
      const described = describeContractNotice({
        row,
        previousRow: history[index - 1],
        calendar,
        asOf,
        ...contractSnapOptions(loadState()),
      });
      if (!described || described.skip || !described.changeId) return;
      const entry = (profile.changeLog || []).find((item) => item.id === described.changeId);
      const written = String(entry?.entered_by || '').trim();
      const routeName = String(profile.name || '').trim();
      const noticeSent = described.changeIds.some((id) => sent.has(id)) || isContractNoticeSent(described.changeId);
      items.push({
        ...described,
        routeId: String(profile.id || ''),
        routeName,
        driverName: driverForDate(profile, row.date),
        submittedAt: String(entry?.submitted_at || ''),
        enteredBy: written && written !== routeName ? written : '',
        sent: noticeSent,
        sentLabel: sentColumnText(noticeSent, described.changeIds, records),
      });
    });
  }
  items.sort((a, b) => {
    const byTime = String(b.submittedAt).localeCompare(String(a.submittedAt));
    if (byTime !== 0) return byTime;
    return String(b.date).localeCompare(String(a.date));
  });
  return items;
}

function selectedNoticeIds(queueSelector) {
  return [...document.querySelectorAll(`${queueSelector} .js-notice-select:checked`)]
    .map((box) => box.value)
    .filter(Boolean);
}

function syncNoticeSelection(queueSelector) {
  const boxes = [...document.querySelectorAll(`${queueSelector} .js-notice-select`)];
  const checked = boxes.filter((box) => box.checked).length;
  const all = document.querySelector(`${queueSelector} .js-notice-select-all`);
  if (all) {
    all.disabled = boxes.length === 0;
    all.checked = boxes.length > 0 && checked === boxes.length;
    all.indeterminate = checked > 0 && checked < boxes.length;
  }
  const button = document.querySelector(`${queueSelector} .js-mark-sent-selected`);
  if (button) button.disabled = checked === 0;
  const count = document.querySelector(`${queueSelector} .js-notice-selected-count`);
  if (count) count.textContent = checked ? `${checked} selected` : '';
}

function noticeSelectCell(id, label) {
  const name = String(label || 'this change').trim();
  return `<td class="notice-select"><input type="checkbox" class="js-notice-select" value="${escapeHtml(id)}" aria-label="Select ${escapeHtml(name)}" /></td>`;
}

function noticeActionCell(sendClass, printClass, markClass, sent) {
  return `<td class="notice-row-actions">
    <button type="button" class="secondary ${sendClass}">${sent ? 'Send again' : 'Send'}</button>
    <button type="button" class="secondary ${printClass}">Print</button>
    <button type="button" class="secondary ${markClass}" data-sent="${sent ? 'yes' : 'no'}">${sent ? 'Unmark' : 'Mark Sent'}</button>
  </td>`;
}

function clockNoticeDocument(changeId) {
  const located = locateChange(changeId);
  if (!located?.profile || !located.row?.change_id) {
    return { ok: false, message: 'That clock-time change could not be found.' };
  }
  const driverName = driverForDate(located.profile, located.row.date);
  if (!driverName) {
    return { ok: false, message: 'Assign a driver to this route before printing a notice.' };
  }
  const settings = loadDriverNotice();
  const mail = memorandumMail({
    memorandumId: settings.memorandumId,
    templates: settings.memorandumTemplates,
    driverName,
    routeName: String(located.profile.name || '').trim(),
    row: located.row,
    asOf: getAsOfDate(),
  });
  return { ok: true, subject: mail.subject, body: mail.body };
}

function contractNoticeDocument(changeId) {
  const located = locateChange(changeId);
  if (!located) return { ok: false, message: 'That contract time change could not be found.' };
  const { profile, row, history } = located;
  const index = history.findIndex((item) => item.change_id === row.change_id);
  const described = describeContractNotice({
    row,
    previousRow: history[index - 1],
    calendar: calendarPayload(),
    asOf: getAsOfDate(),
    ...contractSnapOptions(loadState()),
  });
  if (!described || described.skip || !described.changeId) {
    return { ok: false, message: 'That change does not have a contract time notice.' };
  }
  const driverName = driverForDate(profile, row.date);
  if (!driverName) {
    return { ok: false, message: 'Assign a driver to this route before printing a notice.' };
  }
  const settings = loadContractNotice();
  const mail = contractNoticeMail({
    described,
    templates: settings.templates,
    driverName,
    routeName: String(profile.name || '').trim(),
    asOf: getAsOfDate(),
  });
  return { ok: true, subject: mail.subject, body: mail.body };
}

function printNoticeDocument(notice) {
  const sheet = document.querySelector('#notice-print');
  if (!sheet) return false;
  sheet.innerHTML = `<article class="notice-print-page"><h1>${escapeHtml(notice.subject)}</h1><pre class="notice-print-body">${escapeHtml(notice.body)}</pre></article>`;
  document.body.classList.add('is-notice-print');
  window.addEventListener(
    'afterprint',
    () => {
      document.body.classList.remove('is-notice-print');
      sheet.replaceChildren();
    },
    { once: true }
  );
  window.print();
  return true;
}

function printClockNotice(changeId, button) {
  const status = noticeStatusTarget(button);
  const notice = clockNoticeDocument(changeId);
  if (!notice.ok) {
    setStatus(status, notice.message, 'error');
    return;
  }
  printNoticeDocument(notice);
  setStatus(status, 'The notice is ready to print. It is not marked sent.', 'ok');
}

function printContractNotice(changeId, button) {
  const status = noticeStatusTarget(button);
  const notice = contractNoticeDocument(changeId);
  if (!notice.ok) {
    setStatus(status, notice.message, 'error');
    return;
  }
  printNoticeDocument(notice);
  setStatus(status, 'The notice is ready to print. It is not marked sent.', 'ok');
}

function markedSentMessage(count, line) {
  const notices = count === 1 ? '1 notice' : `${count} notices`;
  const stamp = line ? ` ${line}.` : '';
  return `Marked ${notices} sent.${stamp}`;
}

function refreshClockNoticeViews(ids) {
  const history = snapshot?.schedule_history || [];
  if (history.some((row) => ids.includes(row.change_id) || (row.change_ids || []).some((id) => ids.includes(id)))) {
    renderScheduleHistory();
  }
  renderDriverNoticeQueue();
  paintNoticeTabFlags();
  paintRecentNoticeFlags();
}

function clockNoticeIds(changeIds) {
  const wanted = new Set((changeIds || []).map((id) => String(id || '')).filter(Boolean));
  const items = driverNoticeItems();
  const ids = [];
  let rows = 0;
  for (const item of items) {
    if (!wanted.has(item.id)) continue;
    rows += 1;
    ids.push(...sameDayNoticeIds(item, items));
  }
  return { rows, ids: [...new Set(ids.filter(Boolean))] };
}

function contractNoticeIds(changeIds) {
  const wanted = new Set((changeIds || []).map((id) => String(id || '')).filter(Boolean));
  const items = contractNoticeItems();
  const ids = [];
  let rows = 0;
  for (const item of items) {
    if (!wanted.has(item.changeId)) continue;
    rows += 1;
    ids.push(...(item.changeIds?.length ? item.changeIds : [item.changeId]));
  }
  return { rows, ids: [...new Set(ids.filter(Boolean))] };
}

function markClockNoticesSent(changeIds) {
  const status = document.querySelector('#notice-queue-status');
  const wanted = new Set((changeIds || []).map((id) => String(id || '')).filter(Boolean));
  if (!wanted.size) {
    setStatus(status, 'Select a clock-time change to mark sent.', 'error');
    return;
  }
  const { rows, ids } = clockNoticeIds(changeIds);
  if (!ids.length) {
    setStatus(status, 'Those clock-time changes could not be found.', 'error');
    return;
  }
  rememberChangeNoticesSent(ids, undefined, noticeSender());
  refreshClockNoticeViews(ids);
  const line = noticeSentLineForIds(ids, loadSentChangeRecords());
  setStatus(status, markedSentMessage(rows, line), 'ok');
}

function unmarkClockNotices(changeIds) {
  const status = document.querySelector('#notice-queue-status');
  const { rows, ids } = clockNoticeIds(changeIds);
  if (!ids.length) {
    setStatus(status, 'Those clock-time changes could not be found.', 'error');
    return;
  }
  forgetChangeNoticesSent(ids);
  refreshClockNoticeViews(ids);
  const notices = rows === 1 ? '1 notice' : `${rows} notices`;
  setStatus(status, `Unmarked ${notices}.`, 'ok');
}

function markContractNoticesSent(changeIds) {
  const status = document.querySelector('#contract-notice-queue-status');
  const wanted = new Set((changeIds || []).map((id) => String(id || '')).filter(Boolean));
  if (!wanted.size) {
    setStatus(status, 'Select a contract time change to mark sent.', 'error');
    return;
  }
  const { rows, ids } = contractNoticeIds(changeIds);
  if (!ids.length) {
    setStatus(status, 'Those contract time changes could not be found.', 'error');
    return;
  }
  rememberContractNoticesSent(ids, undefined, noticeSender());
  renderContractNoticeQueue();
  paintNoticeTabFlags();
  const line = noticeSentLineForIds(ids, loadSentContractRecords());
  setStatus(status, markedSentMessage(rows, line), 'ok');
}

function unmarkContractNotices(changeIds) {
  const status = document.querySelector('#contract-notice-queue-status');
  const { rows, ids } = contractNoticeIds(changeIds);
  if (!ids.length) {
    setStatus(status, 'Those contract time changes could not be found.', 'error');
    return;
  }
  forgetContractNoticesSent(ids);
  renderContractNoticeQueue();
  paintNoticeTabFlags();
  const notices = rows === 1 ? '1 notice' : `${rows} notices`;
  setStatus(status, `Unmarked ${notices}.`, 'ok');
}

function noticeQueueSummary(items, noun) {
  if (!items.length) return `No ${noun} are recorded yet.`;
  const waiting = items.filter((item) => !item.sent).length;
  const name = items.length === 1 ? noun.replace(/s$/, '') : noun;
  if (!waiting) return `${items.length} ${name}. Every notice has been sent.`;
  const pending = waiting === 1 ? '1 notice has not been sent.' : `${waiting} notices have not been sent.`;
  return `${items.length} ${name}. ${pending}`;
}

function contractNoticeOverdue(items, asOf = getAsOfDate()) {
  return items.filter((item) => contractNoticeNeedsAttention(item, asOf));
}

function contractNoticeQueueSummary(items, asOf = getAsOfDate()) {
  if (!items.length) return 'No contract notices are recorded yet.';
  const name = items.length === 1 ? 'contract notice' : 'contract notices';
  const overdue = contractNoticeOverdue(items, asOf).length;
  const unsentLater = items.filter(
    (item) => !item.sent && !contractNoticeNeedsAttention(item, asOf)
  ).length;
  if (!overdue && !unsentLater) return `${items.length} ${name}. Every notice has been sent.`;
  const parts = [`${items.length} ${name}.`];
  if (overdue) {
    parts.push(
      overdue === 1
        ? '1 notice is past its Send by date and has not been sent.'
        : `${overdue} notices are past their Send by date and have not been sent.`
    );
  }
  if (unsentLater) {
    parts.push(
      unsentLater === 1
        ? '1 notice is not due yet.'
        : `${unsentLater} notices are not due yet.`
    );
  }
  return parts.join(' ');
}

function paintQueueUnsent(queueSelector, count) {
  const badge = document.querySelector(`${queueSelector} .notice-queue-unsent`);
  if (!badge) return;
  const waiting = Number(count) || 0;
  badge.hidden = waiting <= 0;
  const number = badge.querySelector('.notice-queue-unsent-count');
  if (number) number.textContent = waiting === 1 ? '1 unsent' : `${waiting} unsent`;
}

const NOTICE_QUEUE_PREVIEW_LIMIT = 3;

function paintNoticeQueuePreview(previewId, lines, emptyText) {
  const root = document.querySelector(previewId);
  if (!root) return;
  root.replaceChildren();
  if (!lines.length) {
    const empty = document.createElement('p');
    empty.className = 'notice-queue-preview-empty';
    empty.textContent = emptyText;
    root.append(empty);
    return;
  }
  const list = document.createElement('ul');
  list.className = 'notice-queue-preview-list';
  for (const line of lines.slice(0, NOTICE_QUEUE_PREVIEW_LIMIT)) {
    const item = document.createElement('li');
    if (line.attention) item.classList.add('is-unsent');
    item.textContent = line.text;
    list.append(item);
  }
  root.append(list);
  const rest = lines.length - NOTICE_QUEUE_PREVIEW_LIMIT;
  if (rest > 0) {
    const more = document.createElement('p');
    more.className = 'notice-queue-preview-more field-hint';
    more.textContent = rest === 1 ? 'and 1 more…' : `and ${rest} more…`;
    root.append(more);
  }
}

function driverNoticePreviewLines(items) {
  return items.map((item) => {
    const change = [item.segmentLabel, item.previousLabel, '→', item.newLabel]
      .filter(Boolean)
      .join(' ');
    const effect = item.effectiveDate ? prettyDate(item.effectiveDate) : '';
    return {
      attention: !item.sent,
      text: [`Route ${item.routeName || '—'}`, item.driverName || 'No driver', change, effect]
        .filter(Boolean)
        .join(' · '),
    };
  });
}

function contractNoticePreviewLines(items, asOf) {
  return items.map((item) => {
    const letter = item.kindLabel || 'Contract notice';
    const sendBy = item.sendByDate ? `Send by ${item.sendByDate}` : '';
    return {
      attention: contractNoticeNeedsAttention(item, asOf),
      text: [`Route ${item.routeName || '—'}`, item.driverName || 'No driver', letter, sendBy]
        .filter(Boolean)
        .join(' · '),
    };
  });
}

function renderDriverNoticeQueue() {
  const body = document.querySelector('#notice-queue-body');
  const summary = document.querySelector('#notice-queue-summary');
  if (!body) return;
  const items = driverNoticeItems();
  if (summary) summary.textContent = noticeQueueSummary(items, 'clock-time changes');
  paintQueueUnsent('#notice-queue', items.filter((item) => !item.sent).length);
  paintNoticeQueuePreview(
    '#notice-queue-preview',
    driverNoticePreviewLines(items),
    'No clock-time changes are recorded yet.'
  );
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="9" class="empty">No clock-time changes are recorded yet.</td></tr>';
    syncNoticeSelection('#notice-queue');
    return;
  }
  body.innerHTML = items
    .map((item) => {
      const flag = item.sent ? '' : noticeFlagHtml();
      const recorded = formatRecordedAt(item.submittedAt);
      const who = item.enteredBy ? escapeHtml(item.enteredBy) : 'No account was recorded';
      const when = recorded ? `${escapeHtml(recorded)} · ${who}` : who;
      const effect = item.effectiveDate ? escapeHtml(prettyDate(item.effectiveDate)) : '—';
      return `<tr class="${item.sent ? '' : 'is-unsent'}" data-change-id="${escapeHtml(item.id)}">
        ${noticeSelectCell(item.id, item.routeName)}
        <td>${flag}</td>
        <td>${escapeHtml(item.routeName)}</td>
        <td>${escapeHtml(item.driverName || 'No driver')}</td>
        <td>${escapeHtml(item.segmentLabel)} ${escapeHtml(item.previousLabel)} → ${escapeHtml(item.newLabel)}</td>
        <td>${effect}</td>
        <td>${when}</td>
        <td class="notice-sent-mark">${escapeHtml(item.sentLabel)}</td>
        ${noticeActionCell('js-send-notice', 'js-print-notice', 'js-mark-notice-sent', item.sent)}
      </tr>`;
    })
    .join('');
  syncNoticeSelection('#notice-queue');
}

function contractKindBadgeHtml(iconName) {
  if (!iconName || !ICONS[iconName]) return '';
  return `<span class="contract-kind-badge contract-kind-${iconName}">${iconHtml(iconName)}</span>`;
}

function contractLetterMark(item) {
  const icon = contractKindBadgeHtml(item?.kindIcon);
  return `<span class="notice-letter">${icon}<span>${escapeHtml(item?.kindLabel || '')}</span></span>`;
}

function contractNoticeCalendarMarkHtml(item) {
  const route = String(item?.routeName || '').trim() || '—';
  const driver = String(item?.driverName || '').trim() || 'No driver';
  const kind = item?.kindIcon || '';
  const badge = contractKindBadgeHtml(kind);
  const label = item?.kindLabel || 'Contract notice';
  const when = item?.sendByDate || prettyDate(item?.sendByOn);
  const title = [driver, `Route ${route}`, label, when ? `Send by ${when}` : '']
    .filter(Boolean)
    .join(' · ');
  return `<span class="contract-notice-mark${kind ? ` contract-notice-mark-${kind}` : ''}" title="${escapeHtml(
    title
  )}">${badge}<span class="contract-notice-route">${escapeHtml(route)}</span></span>`;
}

function contractNoticeCalendarSummary(items) {
  const count = items.length;
  if (!count) return 'No contract notices are recorded yet.';
  if (count === 1) return '1 notice is plotted on its Send by date.';
  return `${count} notices are plotted on their Send by dates.`;
}

function renderContractNoticeCalendar(items = contractNoticeItems()) {
  const root = document.querySelector('#contract-notice-calendar-months');
  const summary = document.querySelector('#contract-notice-calendar-summary');
  if (!root) return;
  const asOf = getAsOfDate();
  if (summary) summary.textContent = contractNoticeCalendarSummary(items);
  const dated = items
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item.sendByOn || '')))
    .slice()
    .sort((a, b) => {
      const byDate = String(a.sendByOn).localeCompare(String(b.sendByOn));
      if (byDate !== 0) return byDate;
      return compareRouteNumbers(a.routeName, b.routeName);
    });
  if (!dated.length) {
    root.innerHTML = '<p class="empty">No contract notices are recorded yet.</p>';
    return;
  }
  const byDate = {};
  for (const item of dated) {
    const key = item.sendByOn;
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(item);
  }
  const marksByDate = Object.fromEntries(
    Object.entries(byDate).map(([date, dayItems]) => [
      date,
      `<span class="contract-notice-marks">${dayItems.map(contractNoticeCalendarMarkHtml).join('')}</span>`,
    ])
  );
  const calendar = calendarPayload();
  const months = monthsSpanningIsoDates(calendar?.months || [], dated.map((item) => item.sendByOn));
  root.innerHTML = contractNoticeCalendarHtml({ calendar, months, marksByDate, asOf });
}

function renderContractNoticeQueue() {
  const body = document.querySelector('#contract-notice-queue-body');
  const summary = document.querySelector('#contract-notice-queue-summary');
  if (!body) return;
  const asOf = getAsOfDate();
  const items = contractNoticeItems();
  const overdue = contractNoticeOverdue(items, asOf);
  if (summary) summary.textContent = contractNoticeQueueSummary(items, asOf);
  paintQueueUnsent('#contract-notice-queue', overdue.length);
  paintNoticeQueuePreview(
    '#contract-notice-queue-preview',
    contractNoticePreviewLines(items, asOf),
    'No contract notices are recorded yet.'
  );
  renderContractNoticeCalendar(items);
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="10" class="empty">No contract notices are recorded yet.</td></tr>';
    syncNoticeSelection('#contract-notice-queue');
    return;
  }
  body.innerHTML = items
    .map((item) => {
      const needsAttention = contractNoticeNeedsAttention(item, asOf);
      const flag = needsAttention ? noticeFlagHtml() : '';
      const recorded = formatRecordedAt(item.submittedAt);
      const who = item.enteredBy ? escapeHtml(item.enteredBy) : '';
      const when = [recorded ? escapeHtml(recorded) : '', who].filter(Boolean).join(' · ') || '—';
      const hours = `${escapeHtml(item.previousHours)} → ${escapeHtml(item.contractHours)}`;
      const outcome = item.resultLabel && item.resultLabel !== item.kindLabel
        ? `<span class="notice-queue-meta">${escapeHtml(item.resultLabel)}</span>`
        : '';
      return `<tr class="${needsAttention ? 'is-unsent' : ''}" data-change-id="${escapeHtml(item.changeId)}">
        ${noticeSelectCell(item.changeId, item.routeName)}
        <td>${flag}</td>
        <td>${escapeHtml(item.routeName)}</td>
        <td>${escapeHtml(item.driverName || 'No driver')}</td>
        <td class="notice-letter-cell">${contractLetterMark(item)}</td>
        <td>${hours}${outcome}</td>
        <td>${item.sendByDate ? escapeHtml(item.sendByDate) : '—'}</td>
        <td>${when}</td>
        <td class="notice-sent-mark">${escapeHtml(item.sentLabel)}</td>
        ${noticeActionCell('js-send-contract-notice', 'js-print-contract-notice', 'js-mark-contract-sent', item.sent)}
      </tr>`;
    })
    .join('');
  syncNoticeSelection('#contract-notice-queue');
}

function paintNoticeTabFlag(tabId, countId, pending) {
  const flag = document.querySelector(tabId);
  const count = document.querySelector(countId);
  if (!flag) return;
  flag.hidden = pending <= 0;
  if (count) count.textContent = pending > 0 ? String(pending) : '';
}

function eomBiddingSnapshots() {
  const asOf = getAsOfDate();
  const snapshots = [];
  for (const profile of listProfiles()) {
    try {
      snapshots.push({ profile, snap: buildSnapshot(profile, asOf) });
    } catch {
      // Skip routes that cannot build a snapshot yet.
    }
  }
  return snapshots;
}

function eomSelectedMonthKey(options = {}) {
  const asOf = getAsOfDate();
  const calendar = calendarPayload();
  const fromSelect = String(eomBiddingMonth?.value || '').slice(0, 7);
  if (options.preserveMonth && /^\d{4}-\d{2}$/.test(fromSelect)) return fromSelect;
  if (/^\d{4}-\d{2}$/.test(fromSelect) && options.keepSelect) return fromSelect;
  const match = eomMonthOptions(calendar, asOf).find((option) => option.selected);
  return match?.value || fromSelect || '';
}

function eomBiddingPacketData(options = {}) {
  const asOf = getAsOfDate();
  const calendar = calendarPayload();
  const monthKey = eomSelectedMonthKey(options);
  const period = periodForMonthKey(calendar, monthKey);
  const snapshots = eomBiddingSnapshots();
  const snap = contractSnapOptions(loadState());
  const routes = routesUpForBid({ snapshots, calendar, monthKey, asOf, ...snap });
  const stillOpen = routesStillOpenForBid({ snapshots, calendar, monthKey, asOf, ...snap });
  const approaching = routesApproachingBid({ snapshots, calendar, monthKey, asOf, ...snap });
  const roster = biddingDriverRoster({
    state: loadState(),
    listedDrivers: listDrivers(),
    asOf,
  });
  return { asOf, calendar, monthKey, period, routes, stillOpen, approaching, roster };
}

function eomBiddingRouteCount() {
  try {
    const asOf = getAsOfDate();
    const calendar = calendarPayload();
    const monthKey = eomMonthOptions(calendar, asOf).find((option) => option.selected)?.value || '';
    if (!monthKey) return 0;
    const snapshots = eomBiddingSnapshots();
    const snap = contractSnapOptions(loadState());
    return (
      routesUpForBid({ snapshots, calendar, monthKey, asOf, ...snap }).length +
      routesStillOpenForBid({ snapshots, calendar, monthKey, asOf, ...snap }).length
    );
  } catch {
    return 0;
  }
}

function renderEomBidding(options = {}) {
  if (!eomBiddingMonth || !eomBiddingRoutesBody) return;
  const asOf = getAsOfDate();
  const calendar = calendarPayload();
  const monthOptions = eomMonthOptions(calendar, asOf);
  const selected = eomSelectedMonthKey({
    preserveMonth: options.preserveMonth,
    keepSelect: true,
  });
  eomBiddingMonth.innerHTML = monthOptions
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}"${
          option.value === selected ? ' selected' : ''
        }>${escapeHtml(option.label)}</option>`
    )
    .join('');
  if (selected && ![...eomBiddingMonth.options].some((option) => option.value === selected)) {
    const fallback = document.createElement('option');
    fallback.value = selected;
    fallback.selected = true;
    fallback.textContent = selected;
    eomBiddingMonth.append(fallback);
  } else if (selected) {
    eomBiddingMonth.value = selected;
  }

  const data = eomBiddingPacketData({ preserveMonth: true });
  if (eomBiddingMonthHint) {
    eomBiddingMonthHint.textContent = data.period
      ? `Last five school days: ${prettyDate(data.period.start)}–${prettyDate(data.period.end)}.`
      : 'No October–April bid posting window is on the school calendar for that month.';
  }
  const seasonNote = eomOutsidePostingSeasonMessage(asOf);
  if (eomBiddingSeasonNote) {
    if (seasonNote) {
      eomBiddingSeasonNote.hidden = false;
      eomBiddingSeasonNote.textContent = seasonNote;
      eomBiddingSeasonNote.className = 'status is-warn';
    } else {
      eomBiddingSeasonNote.hidden = true;
      eomBiddingSeasonNote.textContent = '';
    }
  }

  if (eomBiddingRoutesSummary) {
    eomBiddingRoutesSummary.textContent = data.routes.length
      ? `${data.routes.length} route${data.routes.length === 1 ? '' : 's'} in this posting window.`
      : 'No routes are up for bid in this posting window.';
  }
  eomBiddingRoutesBody.innerHTML = data.routes.length
    ? data.routes
        .map(
          (route) => `<tr>
            <td>${escapeHtml(route.routeName)}</td>
            <td>${escapeHtml(route.driverName || '—')}</td>
            <td>${escapeHtml(route.previousHours)} → ${escapeHtml(route.contractHours)}</td>
            <td>${escapeHtml(route.increaseLabel)}</td>
            <td>${escapeHtml(route.postingWindowText || prettyDate(route.becomesOn))}</td>
            <td>${escapeHtml(prettyDate(route.signupDue) || '—')}</td>
            <td>${route.bidNoticeSent ? 'Sent' : 'Not sent'}</td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="7">No routes are posted for bid in this window.</td></tr>`;

  if (eomBiddingStillOpenSummary) {
    eomBiddingStillOpenSummary.textContent = data.stillOpen.length
      ? `${data.stillOpen.length} earlier bid${data.stillOpen.length === 1 ? '' : 's'} still open (often left on the hall board).`
      : 'No earlier bids are still open.';
  }
  if (eomBiddingStillOpenBody) {
    eomBiddingStillOpenBody.innerHTML = data.stillOpen.length
      ? data.stillOpen
          .map(
            (route) => `<tr>
              <td>${escapeHtml(route.routeName)}</td>
              <td>${escapeHtml(route.driverName || '—')}</td>
              <td>${escapeHtml(route.previousHours)} → ${escapeHtml(route.contractHours)}</td>
              <td>${escapeHtml(route.increaseLabel)}</td>
              <td>${escapeHtml(prettyDate(route.becomesOn))}</td>
              <td>${route.bidNoticeSent ? 'Sent' : 'Not sent'}</td>
            </tr>`
          )
          .join('')
      : `<tr><td colspan="6">No earlier bids are still open.</td></tr>`;
  }

  if (eomBiddingApproachingSummary) {
    eomBiddingApproachingSummary.textContent = data.approaching.length
      ? `${data.approaching.length} route${data.approaching.length === 1 ? '' : 's'} still counting or due in a later month.`
      : 'No other routes are approaching bid.';
  }
  if (eomBiddingApproachingBody) {
    eomBiddingApproachingBody.innerHTML = data.approaching.length
      ? data.approaching
          .map(
            (route) => `<tr>
              <td>${escapeHtml(route.routeName)}</td>
              <td>${escapeHtml(route.driverName || '—')}</td>
              <td>${escapeHtml(route.increaseLabel)}</td>
              <td>${escapeHtml(prettyDate(route.becomesOn))}${route.predicted ? ' · predicted' : ''}</td>
              <td>${route.bidNoticeSent ? 'Sent' : 'Not sent'}</td>
            </tr>`
          )
          .join('')
      : `<tr><td colspan="5">No approaching bids.</td></tr>`;
  }

  const packetCount = data.routes.length + data.stillOpen.length;
  if (eomBiddingPrint) {
    eomBiddingPrint.disabled = !data.period;
    eomBiddingPrint.textContent = packetCount
      ? `Print bidding packet (${packetCount + 1} pages)`
      : 'Print cover sheet';
  }
  if (eomBiddingStatus) {
    if (!data.period) {
      setStatus(eomBiddingStatus, 'Choose an October–April posting month on the school calendar.', 'error');
    } else if (!data.roster.hasSeniorityData) {
      setStatus(
        eomBiddingStatus,
        'Driver lists print alphabetically until hire dates or seniority numbers are stored on driver records.',
        'warn'
      );
    } else if (!packetCount) {
      setStatus(
        eomBiddingStatus,
        'No routes are up for bid in this window. You can still print the cover sheet and driver acknowledgment list.',
        'warn'
      );
    } else {
      eomBiddingStatus.hidden = true;
    }
  }
}

function printEomBiddingPacket() {
  const data = eomBiddingPacketData({ preserveMonth: true });
  if (!data.period) {
    setStatus(eomBiddingStatus, 'Choose an October–April posting month before printing.', 'error');
    return;
  }
  const sheet = document.querySelector('#notice-print');
  if (!sheet) return;
  sheet.innerHTML = renderEomBiddingPacketHtml({
    monthKey: data.monthKey,
    period: data.period,
    calendar: data.calendar,
    routes: data.routes,
    stillOpen: data.stillOpen,
    roster: data.roster,
    paperBidSheet: PAPER_BID_SHEET_DEFAULTS,
    asOf: data.asOf,
  });
  document.body.classList.add('is-notice-print');
  window.addEventListener(
    'afterprint',
    () => {
      document.body.classList.remove('is-notice-print');
      sheet.replaceChildren();
    },
    { once: true }
  );
  window.print();
}

function paintNoticeTabFlags() {
  const clockWaiting = driverNoticeItems().filter((item) => !item.sent).length;
  const contractWaiting = contractNoticeOverdue(contractNoticeItems()).length;
  paintNoticeTabFlag('#driver-notice-flag', '#driver-notice-flag-count', clockWaiting);
  paintNoticeTabFlag('#contract-notice-flag', '#contract-notice-flag-count', contractWaiting);
  paintNoticeTabFlag('#bidding-flag', '#bidding-flag-count', eomBiddingRouteCount());
}

function paintRecentNoticeFlags() {
  refreshCoveredClockNotices();
  recentChangeItems.forEach((item) => {
    item.noticeSent = coveredClockNoticeIds.has(item.id) || isChangeNoticeSent(item.id);
  });
  for (const card of recentChangesTrack?.querySelectorAll('.recent-changes-card') || []) {
    const item = recentChangeItems[Number(card.dataset.index)];
    if (!item) continue;
    const title = card.querySelector('.recent-changes-title');
    const flag = title?.querySelector('.notice-flag');
    if (item.noticeSent) flag?.remove();
    else if (title && !flag) title.insertAdjacentHTML('afterbegin', noticeFlagHtml());
  }
}

async function deliverContractNotice(changeId) {
  const located = locateChange(changeId);
  if (!located) return { ok: false, message: 'That contract time change could not be found.' };
  const { profile, row, history } = located;
  const index = history.findIndex((item) => item.change_id === row.change_id);
  const described = describeContractNotice({
    row,
    previousRow: history[index - 1],
    calendar: calendarPayload(),
    asOf: getAsOfDate(),
    ...contractSnapOptions(loadState()),
  });
  if (!described || described.skip || !described.changeId) {
    return { ok: false, message: 'That change does not have a contract time notice.' };
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
  const settings = loadContractNotice();
  const mail = contractNoticeMail({
    described,
    templates: settings.templates,
    driverName,
    routeName: String(profile.name || '').trim(),
    asOf: getAsOfDate(),
  });
  const cc = noticeCcAddress(email, settings.secretaryCc);
  openNoticeMail({ to: email, cc, subject: mail.subject, body: mail.body });
  rememberContractNoticesSent(described.changeIds, undefined, noticeSender());
  renderContractNoticeQueue();
  paintNoticeTabFlags();
  const copied = cc ? ` ${cc} is copied.` : '';
  const stamp = sentColumnText(true, described.changeIds, loadSentContractRecords());
  return {
    ok: true,
    message: `The contract time-change email is open.${copied} ${stamp}.`,
  };
}

async function runContractNotice(changeId, button) {
  const status = noticeStatusTarget(button);
  if (button) button.disabled = true;
  setStatus(status, 'Opening the contract time-change email…');
  const result = await deliverContractNotice(changeId);
  setStatus(status, result.message, result.ok ? 'ok' : 'error');
  if (!result.ok && button) button.disabled = false;
}

async function sendContractNotice(button) {
  const changeId = button.closest('[data-change-id]')?.dataset.changeId;
  if (!changeId) return;
  const alreadySent = isContractNoticeSent(changeId);
  if (alreadySent) {
    const dialog = document.querySelector('#send-notice-offer-dialog');
    const message = document.querySelector('#send-notice-offer-message');
    const warning = document.querySelector('#send-notice-offer-warning');
    const title = document.querySelector('#send-notice-offer-title');
    if (!dialog || !message) return;
    dialog.dataset.changeId = changeId;
    dialog.dataset.noticeKind = 'contract';
    message.textContent = 'Send this contract time-change notice again?';
    if (warning) warning.hidden = false;
    if (title) title.textContent = 'Send this notice again?';
    if (!dialog.open) dialog.showModal();
    return;
  }
  await runContractNotice(changeId, button);
}

function contractQuoteHtml(kind) {
  return kind.citations
    .map((id) => {
      const entry = contractCitations[id];
      if (!entry) return '';
      return `<p class="contract-notice-article">${escapeHtml(entry.label)}</p><p>${escapeHtml(entry.text)}</p>`;
    })
    .join('');
}

function contractNoticeDisclosure(label, text, sectionId) {
  const details = document.createElement('details');
  details.className = 'contract-notice-edit contract-notice-note';
  details.dataset.section = sectionId;
  const summary = document.createElement('summary');
  summary.textContent = label;
  const body = document.createElement('p');
  body.className = 'contract-notice-rationale';
  body.textContent = text || '';
  details.append(summary, body);
  return details;
}

function renderContractNoticeEditors(templates) {
  const root = document.querySelector('#contract-notice-kinds');
  if (!root) return;
  const openSections = new Set(
    [...root.querySelectorAll('details[open]')].map((node) => node.dataset.section).filter(Boolean)
  );
  const saved = templates && typeof templates === 'object' ? templates : {};
  root.replaceChildren();
  for (const kind of CONTRACT_NOTICE_KINDS) {
    const draft = saved[kind.id];
    const card = document.createElement('article');
    const kindTone = kind.icon || kind.id;
    card.className = `contract-notice-card contract-notice-card-${kindTone}`;
    card.dataset.id = kind.id;

    const head = document.createElement('div');
    head.className = 'contract-notice-card-head';
    const title = document.createElement('h3');
    if (kind.icon && ICONS[kind.icon]) {
      const badge = document.createElement('span');
      badge.className = `contract-kind-badge contract-kind-${kind.icon}`;
      badge.append(iconEl(kind.icon));
      title.append(badge);
    }
    const titleText = document.createElement('span');
    titleText.textContent = kind.label;
    title.append(titleText);
    head.append(title);

    const sample = document.createElement('div');
    sample.className = 'template-preview contract-notice-sample';
    const sampleText = document.createElement('div');
    sampleText.className = 'contract-notice-sample-text';
    sampleText.dataset.sample = kind.id;

    const why = contractNoticeDisclosure(
      kind.required === false ? 'Not required by the contract' : 'Required because',
      kind.rationale || kind.detail,
      `${kind.id}-why`
    );
    const when = contractNoticeDisclosure(
      'When it\u2019s generated',
      kind.generated,
      `${kind.id}-when`
    );
    if (openSections.has(why.dataset.section)) why.open = true;
    if (openSections.has(when.dataset.section)) when.open = true;

    const quote = document.createElement('blockquote');
    quote.className = 'contract-notice-quote';
    quote.innerHTML = contractQuoteHtml(kind);

    const edit = document.createElement('details');
    edit.className = 'contract-notice-edit';
    edit.dataset.id = kind.id;
    edit.dataset.section = `${kind.id}-edit`;
    if (openSections.has(edit.dataset.section)) edit.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'Edit the email template';
    const editor = document.createElement('div');
    editor.className = 'contract-notice-editor';
    const subject = document.createElement('input');
    subject.type = 'text';
    subject.className = 'js-contract-subject';
    subject.value = String(draft?.subject ?? '').trim() || kind.subject;
    const subjectField = document.createElement('div');
    subjectField.className = 'field';
    const subjectLabel = document.createElement('label');
    subjectLabel.htmlFor = `contract-subject-${kind.id}`;
    subjectLabel.textContent = 'Subject template';
    subject.id = subjectLabel.htmlFor;
    subjectField.append(subjectLabel, subject);
    const body = document.createElement('textarea');
    body.className = 'js-contract-body';
    body.rows = 12;
    body.value = String(draft?.body ?? '').trim() || kind.body.trim();
    const bodyField = document.createElement('div');
    bodyField.className = 'field';
    const bodyLabel = document.createElement('label');
    bodyLabel.htmlFor = `contract-body-${kind.id}`;
    bodyLabel.textContent = 'Email template';
    body.id = bodyLabel.htmlFor;
    bodyField.append(bodyLabel, body);
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.textContent =
      'You can use {{driver_name}}, {{route_name}}, {{date}}, {{effective_date}}, {{previous_hours}}, {{contract_hours}}, {{change_amount}}, {{timing}}, {{citation_label}}, and {{citation_text}}. The citation lines are the contract wording for this change. In the example above, highlighted text comes from those fields—hover a highlight to see which one.';
    const editorActions = document.createElement('div');
    editorActions.className = 'contract-notice-editor-actions actions';
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save contract notice';
    editorActions.append(save);
    editor.append(subjectField, bodyField, hint, editorActions);
    const refreshSample = () => paintContractCardSample(kind.id);
    subject.addEventListener('input', refreshSample);
    body.addEventListener('input', refreshSample);
    edit.append(summary, editor);
    sample.append(sampleText, edit);

    card.append(head, sample, why, when, quote);
    root.append(card);
    paintContractCardSample(kind.id);
  }
  const secretary = document.querySelector('#contract-notice-secretary');
  if (secretary && !secretary.dataset.sampleBound) {
    secretary.dataset.sampleBound = 'yes';
    secretary.addEventListener('input', () => {
      for (const kind of CONTRACT_NOTICE_KINDS) paintContractCardSample(kind.id);
    });
  }
}

const TEMPLATE_TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

function appendFilledTemplate(parent, template, values) {
  const source = String(template ?? '');
  let last = 0;
  TEMPLATE_TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = TEMPLATE_TOKEN_RE.exec(source))) {
    if (match.index > last) parent.append(source.slice(last, match.index));
    const key = match[1];
    const token = `{{${key}}}`;
    const known = Object.prototype.hasOwnProperty.call(values, key);
    if (!known) {
      parent.append(match[0]);
      last = match.index + match[0].length;
      continue;
    }
    const text = String(values[key] ?? '');
    const mark = document.createElement('mark');
    mark.className = 'template-fill';
    mark.dataset.token = token;
    mark.title = token;
    mark.setAttribute('aria-label', text ? `${token}: ${text}` : `${token} (empty)`);
    mark.textContent = text;
    parent.append(mark);
    last = match.index + match[0].length;
  }
  if (last < source.length) parent.append(source.slice(last));
}

function contractNoticeSamplePeople(kindId) {
  const samples = {
    bid: {
      driverName: 'Annie Porter',
      email: 'annie.porter@example.com',
      routeName: 'S1',
      previousHours: '6 hr',
      contractHours: '6 hr 30 min',
      changeAmount: '30 min in contracted hours',
      timing:
        'Under Art. 3.08(b)(1), an increase of 30 minutes or more that has lasted 15 school days is posted for bid during the last five school days of the month, from October through April. That date is Fri, Nov 20, 2026.',
    },
    bump: {
      driverName: 'Annie Porter',
      email: 'annie.porter@example.com',
      routeName: 'S2',
      previousHours: '6 hr 30 min',
      contractHours: '6 hr',
      changeAmount: '30 min in contracted hours',
      timing:
        'Under Art. 3.08(b)(2), the decrease has to last 15 school days before this written determination. That date is Fri, Nov 20, 2026. The two school days start when you receive it.',
    },
    decrease: {
      driverName: 'Annie Porter',
      email: 'annie.porter@example.com',
      routeName: 'S5',
      previousHours: '6 hr 15 min',
      contractHours: '6 hr',
      changeAmount: '15 min in contracted hours',
      timing:
        'Under Art. 3.08(b)(4), the new contract time takes effect on the workday after this written notice (Fri, Nov 20, 2026).',
    },
    increase: {
      driverName: 'Annie Porter',
      email: 'annie.porter@example.com',
      routeName: 'S8',
      previousHours: '6 hr',
      contractHours: '6 hr 15 min',
      changeAmount: '15 min in contracted hours',
      timing:
        'Under Art. 3.08(b)(3), the new contract time takes effect on the workday following the 15th school day (Fri, Nov 20, 2026).',
    },
  };
  return samples[kindId] || samples.bid;
}

function paintContractCardSample(kindId) {
  const box = document.querySelector(`#contract-notice-kinds [data-sample="${kindId}"]`);
  if (!box) return;
  const kind = contractNoticeKindById(kindId);
  const citationId = kind.citations[0];
  const entry = contractCitations[citationId] || {};
  const hours = contractNoticeSamplePeople(kind.id);
  const described = {
    kind: kind.id,
    effectiveDate: 'Fri, Nov 20, 2026',
    previousHours: hours.previousHours,
    contractHours: hours.contractHours,
    changeAmount: hours.changeAmount,
    timing: hours.timing,
    citationLabel: entry.label || '',
    citationText: entry.text || '',
  };
  const block = document.querySelector(`#contract-notice-kinds [data-id="${kind.id}"]`);
  const subjectTemplate = block?.querySelector('.js-contract-subject')?.value ?? kind.subject;
  const bodyTemplate = block?.querySelector('.js-contract-body')?.value ?? kind.body;
  const values = contractNoticeValues(described, {
    driverName: hours.driverName,
    routeName: hours.routeName,
    asOf: '2026-11-02',
  });
  const copy = noticeCcAddress(
    hours.email,
    document.querySelector('#contract-notice-secretary')?.value
  );

  box.replaceChildren();
  const kicker = document.createElement('h3');
  kicker.textContent = 'Example';
  box.append(kicker);
  box.append(`To: ${hours.email}\n`);
  if (copy) box.append(`Cc: ${copy}\n`);
  appendFilledTemplate(box, subjectTemplate, values);
  box.append('\n\n');
  appendFilledTemplate(box, String(bodyTemplate ?? '').trimEnd(), values);
  box.append('\n');
}

function collectContractTemplates() {
  const templates = {};
  for (const block of document.querySelectorAll('#contract-notice-kinds .contract-notice-card')) {
    const id = block.dataset.id;
    if (!id) continue;
    templates[id] = {
      subject: block.querySelector('.js-contract-subject')?.value ?? '',
      body: block.querySelector('.js-contract-body')?.value ?? '',
    };
  }
  return templates;
}

function fillContractNoticeSettings() {
  const settings = loadContractNotice();
  const secretary = document.querySelector('#contract-notice-secretary');
  const status = document.querySelector('#contract-notice-status');
  if (secretary) secretary.value = settings.secretaryCc;
  renderContractNoticeEditors(settings.templates);
  if (status) setStatus(status, '');
}

function openNoticeMail(mail) {
  const href = noticeMailto(mail);
  const link = document.createElement('a');
  link.href = href;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

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

function changeIdsOn(source) {
  return new Set(
    (source?.schedule_history || []).map((row) => row.change_id).filter(Boolean)
  );
}

function addedChangeIds(beforeIds, source) {
  return (source?.schedule_history || [])
    .map((row) => row.change_id)
    .filter((id) => id && !beforeIds.has(id));
}

function predictedContractDate(changeId, source = snapshot) {
  const row = (source?.schedule_history || []).find((item) => item.change_id === changeId);
  return isPredictedContract(row) ? row.contracted.becomes_on : null;
}

function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Predicted contract reminders for every route, one item per change.
function officeContractReminders() {
  const settings = loadContractReminder();
  const calendar = calendarPayload();
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

function publishedReminderMessage(events) {
  const active = events.filter((event) => !event.cancelled);
  const cancelled = events.filter((event) => event.cancelled);
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

// Download a calendar file for each reminder day that is new or different.
// The file is created when a contract date is predicted. It is not held until that day.
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

// History rows touched by these change ids. Several runs saved together share one row.
function noticeRowsForChangeIds(changeIds) {
  const wanted = new Set((changeIds || []).filter(Boolean));
  if (!wanted.size) return [];
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

function noticeOfferMessage(row) {
  const route = String(getCurrentProfile()?.name || '').trim();
  const run = row.segment === 'MIDDAY' ? 'Midday' : row.segment || 'schedule';
  const where = route ? ` on route ${route}` : '';
  return `Send a notice for the ${run} change${where}?`;
}

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
  dialog.dataset.noticeKind = 'clock';
  message.textContent = row ? noticeOfferMessage(row) : 'Send a notice for this clock-time change?';
  const alreadySent = isChangeNoticeSent(changeId);
  if (warning) warning.hidden = !alreadySent;
  if (title) title.textContent = alreadySent ? 'Send this notice again?' : 'Send a notice?';
  if (!dialog.open) dialog.showModal();
}

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
  const kind = dialog?.dataset.noticeKind || 'clock';
  noticeOfferSending = true;
  if (dialog?.open) dialog.close();
  noticeOfferSending = false;
  if (dialog) dialog.dataset.noticeKind = 'clock';
  if (kind === 'contract') {
    if (changeId) await runContractNotice(changeId);
    return;
  }
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
  if (windowInfo.bid_posting_phrase) {
    details.push(windowInfo.bid_posting_phrase);
  } else if (windowInfo.becomes_contracted_on) {
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

function renderDrivers(highlightName = '') {
  const drivers = listDrivers();
  if (!drivers.length) {
    driverSheet.innerHTML = '<li class="driver-name-empty">No drivers on the list yet.</li>';
    return;
  }
  driverSheet.innerHTML = drivers
    .map((driver) => {
      const justAdded = highlightName && sameDriver(driver.name, highlightName) ? ' class="is-just-added"' : '';
      const label = [driver.firstName, driver.lastName].filter(Boolean).join(' ') || driver.name;
      return `<li${justAdded}><button type="button" class="driver-name-button" data-driver-id="${escapeHtml(driver.id)}">${escapeHtml(label)}</button></li>`;
    })
    .join('');
  if (highlightName) driverSheet.querySelector('.is-just-added')?.scrollIntoView({ block: 'nearest' });
}

const driverDetailDialog = document.querySelector('#driver-detail-dialog');
const driverDetailForm = document.querySelector('#driver-detail-form');
const driverDetailFields = document.querySelector('#driver-detail-fields');
const driverDetailStatuses = document.querySelector('#driver-detail-statuses');
const driverDetailStatus = document.querySelector('#driver-detail-status');
const driverDetailTitle = document.querySelector('#driver-detail-title');
const driverDetailRemove = document.querySelector('#driver-detail-remove');
let driverDetailId = '';

function setDetailStatus(message, kind = '') {
  if (!driverDetailStatus) return;
  setStatus(driverDetailStatus, message, kind);
}

function driverDetailRecord() {
  if (!driverDetailId) {
    return {
      id: '',
      name: '',
      firstName: '',
      lastName: '',
      phone: '',
      email: '',
      pay: {},
      payStatuses: [],
      payStatusByRun: {},
    };
  }
  return infoDriver(driverDetailId);
}

function detailField(id, label, value, type, extra = '') {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${escapeHtml(value)}" ${extra} /></div>`;
}

function detailFact(label, value) {
  return `<div class="field"><p class="field-static-label">${escapeHtml(label)}</p><p class="field-static">${value}</p></div>`;
}

function currentRouteNames(name) {
  return routesForDriver(name)
    .filter((route) => route.current)
    .map((route) => route.name);
}

function earlierRouteNames(name) {
  return routesForDriver(name)
    .filter((route) => !route.current)
    .map((route) => route.name);
}

function routeFact(label, names, empty) {
  const body = names.length
    ? `<ul class="driver-detail-routes">${names.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>`
    : escapeHtml(empty);
  return `<div class="field full"><p class="field-static-label">${escapeHtml(label)}</p><div class="field-static">${body}</div></div>`;
}

function renderDriverDetail() {
  const driver = driverDetailRecord();
  if (driverDetailId && !driver) {
    driverDetailDialog?.close();
    return;
  }
  const who = driver?.name || 'New driver';
  if (driverDetailTitle) driverDetailTitle.textContent = who;
  if (driverDetailRemove) driverDetailRemove.hidden = !driver?.id;
  const pin = driver?.id ? driverClockPin(loadState().clockPins, driver.id) : DEFAULT_DRIVER_PIN;
  const email = driver?.email ? escapeHtml(driver.email) : 'No email';
  const current = driver?.name ? currentRouteNames(driver.name) : [];
  const earlier = driver?.name ? earlierRouteNames(driver.name) : [];
  if (driverDetailFields) {
    driverDetailFields.innerHTML = [
      detailField('driver-detail-first', 'First name', driver?.firstName || '', 'text', 'autocomplete="given-name"'),
      detailField('driver-detail-last', 'Last name', driver?.lastName || '', 'text', 'autocomplete="family-name"'),
      detailFact('Email', email),
      detailField('driver-detail-phone', 'Phone', driver?.phone || '', 'tel', 'autocomplete="tel"'),
      routeFact('Current routes', current, 'No current route'),
      earlier.length ? routeFact('Earlier routes', earlier, '') : '',
      detailField('driver-detail-serial', 'Serial number', driver?.pay?.serial || '', 'text', 'autocomplete="off"'),
      detailField(
        'driver-detail-rate',
        'Hourly rate',
        driver?.pay?.rate || '',
        'number',
        'min="0" step="any" inputmode="decimal" placeholder="0.00" autocomplete="off"'
      ),
      detailField('driver-detail-account', 'Payroll account', driver?.pay?.account || '', 'text', 'autocomplete="off"'),
      detailField(
        'driver-detail-pin',
        'Clock PIN',
        pin,
        'text',
        'inputmode="numeric" maxlength="4" autocomplete="off" spellcheck="false"'
      ),
    ].join('');
  }
  if (driverDetailStatuses) {
    driverDetailStatuses.innerHTML = `<p class="field-static-label">Pay status</p>${driverInfoStatusMarkup(driver || { name: 'New driver', payStatuses: [], payStatusByRun: {} }, payLinesForInfo())}`;
  }
  setDetailStatus('');
}

function openDriverDetail(driverId = '') {
  driverDetailId = driverId || '';
  renderDriverDetail();
  if (driverDetailDialog && !driverDetailDialog.open) driverDetailDialog.showModal();
}

function detailPayStatuses() {
  return [...(driverDetailStatuses?.querySelectorAll('[data-remove-status]') || [])]
    .map((button) => button.dataset.removeStatus || '')
    .filter(Boolean);
}

function detailPayStatusByRun() {
  const map = {};
  for (const select of driverDetailStatuses?.querySelectorAll('.js-pay-status-run') || []) {
    if (select.dataset.payRun) map[select.dataset.payRun] = select.value;
  }
  return map;
}

function refreshDetailStatuses(payStatuses, payStatusByRun) {
  const driver = driverDetailRecord() || { name: 'New driver' };
  const first = document.querySelector('#driver-detail-first')?.value.trim() || '';
  const last = document.querySelector('#driver-detail-last')?.value.trim() || '';
  const name = [first, last].filter(Boolean).join(' ') || driver.name || 'New driver';
  if (!driverDetailStatuses) return;
  driverDetailStatuses.innerHTML = `<p class="field-static-label">Pay status</p>${driverInfoStatusMarkup({ ...driver, name, payStatuses, payStatusByRun }, payLinesForInfo())}`;
}

function saveDriverClockPin(driverId, pin) {
  const state = loadState();
  const pins = { ...(state.clockPins || {}) };
  if (pins[driverId] === pin) return;
  pins[driverId] = pin;
  state.clockPins = pins;
  saveState(state);
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

function driverInfoRunMarkup(driver, choices) {
  if (choices.length < 2) {
    return `<p class="field-hint">Every clock-in uses ${escapeHtml(choices[0]?.label || 'that pay status')}.</p>`;
  }
  const map = normalizePayStatusByRun(
    driver.payStatusByRun,
    choices.map((line) => line.id)
  );
  const fields = CLOCK_IN_TYPES.map((type) => {
    const options = choices
      .map(
        (line) =>
          `<option value="${escapeHtml(line.id)}"${map[type.id] === line.id ? ' selected' : ''}>${escapeHtml(line.label)}</option>`
      )
      .join('');
    return `<label>${escapeHtml(type.label)}<select class="js-pay-status-run" data-pay-run="${type.id}" aria-label="${escapeHtml(type.label)} pay status for ${escapeHtml(driver.name)}">${options}</select></label>`;
  }).join('');
  return `<div class="pay-run-map">${fields}</div>`;
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
    ${driverInfoRunMarkup(driver, chosen)}
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
        <td>${infoInput(driver, 'serial', driver.pay?.serial || '', 'text', 'Serial number', 'autocomplete="off"')}</td>
        <td>${infoInput(driver, 'rate', driver.pay?.rate || '', 'number', 'Hourly rate', 'min="0" step="any" inputmode="decimal" placeholder="0.00" autocomplete="off"')}</td>
        <td>${infoInput(driver, 'account', driver.pay?.account || '', 'text', 'Payroll account', 'autocomplete="off"')}</td>
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
    if (input.validity?.badInput) {
      input.value = driver.pay?.rate || '';
      setInfoNote('Enter an hourly rate like 37.74.', 'error');
      return;
    }
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

async function finishInfoStatus(driver, payStatuses, message, extra = {}) {
  const row = driverInfoSheet?.querySelector(`tr[data-driver-id="${CSS.escape(driver.id)}"]`);
  try {
    const saved = await persistDriverInfo(driver, { payStatuses, ...extra });
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

async function saveDriverInfoRun(select) {
  const driver = driverFromInfoControl(select);
  const run = select.dataset.payRun || '';
  if (!driver || !run) return;
  const lines = payLinesForInfo();
  const choices = driverPayStatusChoices(driver.payStatuses, lines);
  const type = CLOCK_IN_TYPES.find((item) => item.id === run);
  if (choices.length < 2 || !type || !choices.some((line) => line.id === select.value)) return;
  const map = normalizePayStatusByRun(
    driver.payStatusByRun,
    choices.map((line) => line.id)
  );
  map[run] = select.value;
  const line = choices.find((item) => item.id === select.value);
  await finishInfoStatus(
    driver,
    choices.map((item) => item.id),
    `${type.label} for ${driver.name} uses ${line?.label || 'that pay status'}.`,
    { payStatusByRun: map }
  );
}

driverInfoSheet?.addEventListener('change', (event) => {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement)) return;
  if (select.classList.contains('js-pay-status-run')) {
    saveDriverInfoRun(select);
    return;
  }
  if (select.dataset.payStatusAdd !== '1') return;
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

function downloadCalendarPdf(filename) {
  return import('./noticeCalendarPdf.js').then((mod) => mod.downloadCalendarPdf(filename));
}

function downloadTextPdf(filename, text) {
  return import('./noticeDocumentPdf.js').then((mod) => mod.downloadTextPdf(filename, text));
}

function renderApp() {
  const onDrivers = activeSheet === 'drivers' && !addingPerson;
  const onAll = activeSheet === 'all' && !addingPerson;
  const onDriverHistory = activeSheet === 'driver-history' && !addingPerson;
  const onPayroll = activeSheet === 'payroll' && !addingPerson;
  const onClocking = activeSheet === 'clocking' && !addingPerson;
  const onClockSettings = activeSheet === 'clock-settings' && !addingPerson;
  const onPaperBackup = activeSheet === 'paper-backup' && !addingPerson;
  const onWeekly = activeSheet === 'weekly-work' && !addingPerson;
  const onDaily = activeSheet === 'daily-work' && !addingPerson;
  const onRoster = activeSheet === 'roster-trips' && !addingPerson;
  const onSettings = activeSheet === 'settings' && !addingPerson;
  const onOfficeApp = onPayroll || onClocking || onClockSettings || onPaperBackup || onWeekly || onDaily || onRoster;
  const onAdminReminder = activeSheet === 'admin-reminder' && !addingPerson;
  const onDriverNotice = activeSheet === 'driver-notice' && !addingPerson;
  const onContractNotice = activeSheet === 'contract-notice' && !addingPerson;
  const onBidding = activeSheet === 'bidding' && !addingPerson;
  const payrollWindow = driversWindow && driversApp === 'payroll';
  document.body.classList.toggle('is-payroll-app', onPayroll || (payrollWindow && onDriverHistory));
  document.body.classList.toggle('is-clocking-app', onClocking || onClockSettings || onPaperBackup);
  document.body.classList.toggle('is-daily-app', onDaily || onWeekly);
  document.body.classList.toggle('is-roster-app', onRoster);
  document.body.classList.toggle('is-paper-backup', onPaperBackup);
  document.body.classList.toggle('is-tracker-settings', onSettings);
  const themeColor = onWeekly
    ? '#1f6b4a'
    : onDaily
    ? '#c47b12'
    : onRoster
      ? '#8b3a4a'
      : onPayroll || (payrollWindow && onDriverHistory)
        ? '#12887a'
        : onClocking || onClockSettings || onPaperBackup
          ? '#1a4f8b'
          : '#6428f0';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
  const hideRouteTabs = onOfficeApp || onSettings || driversWindow;
  if (routeTabs) routeTabs.hidden = hideRouteTabs;
  if (hideRouteTabs) markSectionChrome();
  else renderRouteTabs();
  if (payrollView) payrollView.hidden = !onPayroll;
  if (clockingView) clockingView.hidden = !onClocking;
  if (weeklyWorkView) weeklyWorkView.hidden = !onWeekly;
  if (dailyWorkView) dailyWorkView.hidden = !onDaily;
  if (rosterTripsView) rosterTripsView.hidden = !onRoster;
  if (paperBackupView) paperBackupView.hidden = !onPaperBackup;
  if (timeclockSettingsView) timeclockSettingsView.hidden = !onClockSettings;
  if (trackerSettingsView) trackerSettingsView.hidden = !onSettings;
  if (adminReminderView) adminReminderView.hidden = !onAdminReminder;
  if (driverNoticeView) driverNoticeView.hidden = !onDriverNotice;
  if (contractNoticeView) contractNoticeView.hidden = !onContractNotice;
  if (biddingView) biddingView.hidden = !onBidding;
  paintNoticeTabFlags();
  if (onDriverNotice) renderDriverNoticeQueue();
  if (onContractNotice) renderContractNoticeQueue();
  if (onBidding) renderEomBidding({ preserveMonth: true });
  if (driversWindow && onDriverHistory) {
    if (payrollView) payrollView.hidden = true;
    if (clockingView) clockingView.hidden = true;
    if (weeklyWorkView) weeklyWorkView.hidden = true;
    if (dailyWorkView) dailyWorkView.hidden = true;
    if (rosterTripsView) rosterTripsView.hidden = true;
    if (paperBackupView) paperBackupView.hidden = true;
    if (timeclockSettingsView) timeclockSettingsView.hidden = true;
    if (trackerSettingsView) trackerSettingsView.hidden = true;
    driversView.hidden = true;
    allRoutesView.hidden = true;
    driverHistoryView.hidden = false;
    setupView.hidden = true;
    appView.hidden = true;
    renderDriverHistory();
    return;
  }
  if (onSettings) {
    driversView.hidden = true;
    allRoutesView.hidden = true;
    driverHistoryView.hidden = true;
    setupView.hidden = true;
    appView.hidden = true;
    document.title = `Teamster Tracker Settings · ${APP_TITLE}`;
    timeclockDesk.refresh();
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
  if (onPaperBackup) {
    driversView.hidden = true;
    allRoutesView.hidden = true;
    driverHistoryView.hidden = true;
    setupView.hidden = true;
    appView.hidden = true;
    document.title = `Paper records · ${APP_TITLE}`;
    paperBackupDesk.refresh();
    return;
  }
  if (onWeekly || onDaily || onRoster) {
    driversView.hidden = true;
    allRoutesView.hidden = true;
    driverHistoryView.hidden = true;
    setupView.hidden = true;
    appView.hidden = true;
    openTripFrame(onRoster ? 'roster' : onWeekly ? 'weekly' : 'daily');
    document.title = `${onRoster ? 'Roster Trips' : onWeekly ? 'Weekly Work Admin' : 'Daily/Late Work Admin'} · ${APP_TITLE}`;
    return;
  }
  if (onPayroll || onClocking) {
    driversView.hidden = true;
    allRoutesView.hidden = true;
    driverHistoryView.hidden = true;
    setupView.hidden = true;
    appView.hidden = true;
    clockDesk.refresh();
    if (onPayroll) renderDriverInfo();
    if (onClocking) refreshPaperRecords();
    // Payroll settings, pay-period info, and the timeclock share one module.
    // Opening Payroll has to load it, or those buttons have nothing to run.
    if (!driversWindow) {
      void ensureTimeclock()
        .then((desk) => {
          if (activeSheet === 'payroll' || activeSheet === 'clocking') desk.refresh();
        })
        .catch((error) => {
          reportOfficeToolError(error);
        });
    }
    const openDriver = clockDesk.openDriver();
    const appName = onClocking ? 'Clocking' : 'Payroll';
    if (driversWindow) {
      const windowLabel = driversApp === 'clocking' ? 'Clock records' : 'Driver Clock Records';
      document.title = openDriver ? `${openDriver} · ${windowLabel} · ${APP_TITLE}` : `${windowLabel} · ${APP_TITLE}`;
      return;
    }
    document.title = openDriver ? `${openDriver} · ${appName} · ${APP_TITLE}` : `${appName} · ${APP_TITLE}`;
    return;
  }
  if (onAdminReminder || onDriverNotice || onContractNotice || onBidding) {
    driversView.hidden = true;
    allRoutesView.hidden = true;
    driverHistoryView.hidden = true;
    setupView.hidden = true;
    appView.hidden = true;
    document.title = onAdminReminder
      ? 'Admin contract reminder'
      : onContractNotice
        ? 'Contract time-change notice'
        : onBidding
          ? 'Bidding'
          : 'Driver time-change notice';
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

function syncSchoolYearCalendar() {
  useSchoolYearCalendar(savedSchoolYear(loadState()));
}

function routeClockTimesUiState() {
  const active = document.activeElement;
  const focusIn = (root) => root instanceof HTMLElement && active instanceof Node && root.contains(active);
  return {
    startEditOpen: Boolean(startEditForm && !startEditForm.hidden),
    changeEditOpen: Boolean(changeEditForm && !changeEditForm.hidden),
    changeDialogOpen: Boolean(changeDialog?.open),
    focusInScheduleHistory: focusIn(scheduleHistory),
    focusInStartEdit: focusIn(startEditForm),
    focusInChangeEdit: focusIn(changeEditForm),
    setupVisible: Boolean(setupView && !setupView.hidden),
    focusInSetup: focusIn(setupForm),
  };
}

function isEditingRouteClockTimes() {
  return shouldDeferSharedUiRefresh(routeClockTimesUiState());
}

function applySharedOfficeUiRefresh() {
  pendingSharedUiRefresh = false;
  loadAll();
  showRecentRouteChanges(loadState());
  if (activeSheet === 'admin-reminder') fillReminderSettings();
  if (activeSheet === 'driver-notice') fillDriverNoticeSettings();
  if (activeSheet === 'contract-notice') fillContractNoticeSettings();
  if (activeSheet === 'bidding') renderEomBidding({ preserveMonth: true });
}

function requestSharedOfficeUiRefresh() {
  if (isEditingRouteClockTimes()) {
    pendingSharedUiRefresh = true;
    return;
  }
  applySharedOfficeUiRefresh();
}

function flushPendingSharedOfficeUiRefresh() {
  if (!pendingSharedUiRefresh || isEditingRouteClockTimes()) return;
  applySharedOfficeUiRefresh();
}

function loadAll() {
  syncSchoolYearCalendar();
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
  refreshRouteBackupFlash();
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
    });
    previewBox.hidden = false;
    previewBox.innerHTML = `
      <strong>${preview.delta_label}</strong> exact difference
      · window ends <strong>${prettyDate(preview.window_expires_date)}</strong>
      · ${
        preview.bid_posting_phrase
          ? `<strong>${escapeHtml(preview.bid_posting_phrase)}</strong>`
          : `becomes contracted <strong>${prettyDate(preview.becomes_contracted_on)}</strong>`
      }
      · ${preview.projected_outcome_label}
      <div class="meta">${preview.contracted_hours_statement || ''}</div>
      ${preview.side_window_note ? `<div class="meta">${escapeHtml(preview.side_window_note)}</div>` : ''}
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
      ...attributionForChange(currentAccount(), document.querySelector('#change_note').value),
    });
    document.querySelector('#change_note').value = '';
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

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function routeBackupPrefs() {
  return normalizeRouteDataBackup(loadState().routeDataBackup);
}

function saveRouteBackupPrefs(patch) {
  const next = loadState();
  next.routeDataBackup = normalizeRouteDataBackup({
    ...normalizeRouteDataBackup(next.routeDataBackup),
    ...patch,
  });
  saveState(next);
  refreshRouteBackupFlash();
  return next.routeDataBackup;
}

function refreshRouteBackupFlash() {
  const button = document.querySelector('#export-btn');
  if (!(button instanceof HTMLButtonElement)) return;
  const due = routeDataBackupReminderDue(routeBackupPrefs());
  button.classList.toggle('is-backup-due', due);
  if (due) button.setAttribute('title', 'A Current Route Data backup is due.');
  else button.removeAttribute('title');
}

function routeBackupSavedMessage(prefs) {
  const settings = normalizeRouteDataBackup(prefs);
  if (!settings.lastFilename) return '';
  return `Saved ${settings.lastFilename}.`;
}

function fillRouteBackupDialog() {
  const prefs = routeBackupPrefs();
  const reminder = document.querySelector('#route-backup-reminder');
  const filename = document.querySelector('#route-backup-filename');
  const hint = document.querySelector('#route-backup-reminder-hint');
  const locationHint = document.querySelector('#route-backup-location-hint');
  const status = document.querySelector('#route-backup-status');
  if (reminder instanceof HTMLSelectElement) reminder.value = prefs.reminder;
  if (filename instanceof HTMLInputElement) {
    filename.value = suggestedRouteBackupFilename(prefs.fileBase, new Date());
  }
  if (hint) hint.textContent = routeDataBackupReminderLabel(prefs.reminder);
  if (locationHint) {
    locationHint.textContent =
      typeof window.showSaveFilePicker === 'function'
        ? 'Your browser will ask where to save the file each time you download.'
        : 'This browser saves to its usual downloads folder. Chrome or Edge can let you choose a folder each time.';
  }
  if (status) {
    const saved = routeBackupSavedMessage(prefs);
    status.hidden = !saved;
    status.textContent = saved;
    status.classList.toggle('is-error', false);
    status.classList.toggle('is-ok', Boolean(saved));
  }
}

function openRouteBackupDialog() {
  const dialog = document.querySelector('#route-backup-dialog');
  if (!(dialog instanceof HTMLDialogElement)) return;
  fillRouteBackupDialog();
  if (!dialog.open) dialog.showModal();
}

function readRouteBackupForm() {
  const reminderEl = document.querySelector('#route-backup-reminder');
  const filenameEl = document.querySelector('#route-backup-filename');
  const reminder =
    reminderEl instanceof HTMLSelectElement ? reminderEl.value : routeBackupPrefs().reminder;
  const filename = normalizeRouteBackupFilename(
    filenameEl instanceof HTMLInputElement ? filenameEl.value : '',
    new Date()
  );
  return {
    reminder,
    filename,
    fileBase: fileBaseFromRouteBackupFilename(filename),
  };
}

function setRouteBackupStatus(message, kind = '') {
  const status = document.querySelector('#route-backup-status');
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || '';
  status.classList.toggle('is-error', kind === 'error');
  status.classList.toggle('is-ok', kind === 'ok');
}

// Prefer the system Save dialog so the office can pick a folder. Fall back to a normal download.
async function saveWorkbookBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: XLSX_MIME });
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'Excel workbook',
            accept: { [XLSX_MIME]: ['.xlsx'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { ok: true, method: 'picker', filename: handle.name || filename };
    } catch (error) {
      if (error?.name === 'AbortError') return { ok: false, method: 'cancelled' };
    }
  }
  downloadWorkbook(bytes, filename);
  return { ok: true, method: 'download', filename };
}

async function downloadRouteDataBackup() {
  const form = readRouteBackupForm();
  const createdAt = new Date();
  const filename = form.filename;
  setRouteBackupStatus('Creating the Excel file…');
  const { buildRouteWorkbook } = await import('../src/routeWorkbook.js');
  const bytes = await buildRouteWorkbook(
    {
      ...loadState(),
      asOf: getAsOfDate(),
    },
    {
      title: workbookTitleFromFilename(filename),
      createdAt,
    }
  );
  const saved = await saveWorkbookBytes(bytes, filename);
  if (!saved.ok) {
    setRouteBackupStatus('Download cancelled.', 'error');
    return false;
  }
  saveRouteBackupPrefs({
    reminder: form.reminder,
    fileBase: form.fileBase,
    lastDownloadedAt: createdAt.toISOString(),
    lastFilename: saved.filename,
  });
  setRouteBackupStatus(`Saved ${saved.filename}.`, 'ok');
  const filenameEl = document.querySelector('#route-backup-filename');
  if (filenameEl instanceof HTMLInputElement) {
    filenameEl.value = suggestedRouteBackupFilename(form.fileBase, new Date());
  }
  return true;
}

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

document.querySelector('#export-btn')?.addEventListener('click', () => {
  openRouteBackupDialog();
});

document.querySelector('#route-backup-close')?.addEventListener('click', () => {
  document.querySelector('#route-backup-dialog')?.close();
});

document.querySelector('#route-backup-reminder')?.addEventListener('change', (event) => {
  const hint = document.querySelector('#route-backup-reminder-hint');
  if (hint && event.target instanceof HTMLSelectElement) {
    hint.textContent = routeDataBackupReminderLabel(event.target.value);
  }
});

document.querySelector('#route-backup-save')?.addEventListener('click', () => {
  const form = readRouteBackupForm();
  saveRouteBackupPrefs({
    reminder: form.reminder,
    fileBase: form.fileBase,
  });
  setRouteBackupStatus('Backup reminder settings saved.', 'ok');
});

document.querySelector('#route-backup-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const downloadBtn = document.querySelector('#route-backup-download');
  if (downloadBtn instanceof HTMLButtonElement) downloadBtn.disabled = true;
  try {
    await downloadRouteDataBackup();
  } catch (error) {
    setRouteBackupStatus(error.message || 'Could not create the Excel file.', 'error');
  } finally {
    if (downloadBtn instanceof HTMLButtonElement) downloadBtn.disabled = false;
  }
});

refreshRouteBackupFlash();
window.setInterval(refreshRouteBackupFlash, 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshRouteBackupFlash();
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
  flushPendingSharedOfficeUiRefresh();
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
document.querySelector('#template-preview-close')?.addEventListener('click', () => {
  document.querySelector('#template-preview-dialog')?.close();
});
document.querySelector('#template-preview-dialog')?.addEventListener('click', (event) => {
  const dialog = document.querySelector('#template-preview-dialog');
  if (event.target === dialog) dialog.close();
});
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
  flushPendingSharedOfficeUiRefresh();
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
    flushPendingSharedOfficeUiRefresh();
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
      } else if (input.classList.contains('js-history-date')) {
        const ids = rowChangeIds(row);
        const previous = Object.fromEntries(ids.map((id) => [id, predictedContractDate(id)]));
        for (const id of ids) {
          const change = (snapshot.changes || []).find((item) => item.id === id);
          snapshot = updateChange(id, {
            change_date: changeDate,
            ...(change?.next?.clock_in && change?.next?.clock_out
              ? { clock_in: change.next.clock_in, clock_out: change.next.clock_out }
              : {}),
          });
        }
        announcePredictedReminders('Schedule corrected on this device.', ids, previous);
        renderApp();
        return;
      } else {
        const previousOn = predictedContractDate(sourceId);
        snapshot = updateChange(sourceId, {
          change_date: changeDate,
          clock_in: rowTime(row, runId, 'in'),
          clock_out: rowTime(row, runId, 'out'),
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

scheduleHistory.addEventListener('input', (event) => {
  if (event.target.closest('input[type="time"]')) markScheduleTimeDiffs();
});

scheduleHistory.addEventListener('change', (event) => {
  if (event.target.closest('input[type="time"]')) markScheduleTimeDiffs();
  const input = event.target.closest('.js-history-date, .js-history-time');
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
  const sendNotice = event.target.closest('.js-send-notice');
  if (sendNotice) {
    sendChangeNotice(sendNotice);
    return;
  }
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
    });
    changeEditForm.hidden = true;
    announcePredictedReminders('Change corrected.', [changeId], { [changeId]: previousOn });
    renderApp();
    flushPendingSharedOfficeUiRefresh();
  } catch (error) {
    setStatus(changeEditStatus, error.message, 'error');
  }
});

document.querySelector('#change-edit-cancel').addEventListener('click', () => {
  changeEditForm.hidden = true;
  setStatus(changeEditStatus, '');
  flushPendingSharedOfficeUiRefresh();
});

document.querySelector('#add-driver-row').addEventListener('click', () => {
  openDriverDetail('');
});

driverSheet.addEventListener('click', (event) => {
  const button = event.target.closest('.driver-name-button');
  if (!button?.dataset.driverId) return;
  openDriverDetail(button.dataset.driverId);
});

function detailValue(id) {
  return document.querySelector(`#${id}`)?.value ?? '';
}

driverDetailForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const existing = driverDetailId ? infoDriver(driverDetailId) : null;
  const firstName = detailValue('driver-detail-first').trim();
  const lastName = detailValue('driver-detail-last').trim();
  if (!firstName && !lastName) {
    setDetailStatus('Enter a first or last name.', 'error');
    return;
  }
  const rateInput = document.querySelector('#driver-detail-rate');
  if (rateInput instanceof HTMLInputElement && rateInput.validity?.badInput) {
    setDetailStatus('Enter an hourly rate like 37.74.', 'error');
    return;
  }
  const rateRaw = detailValue('driver-detail-rate').trim();
  const rate = normalizeDriverPay({ rate: rateRaw }).rate;
  if (rateRaw && !rate) {
    setDetailStatus('Enter an hourly rate like 37.74.', 'error');
    return;
  }
  const pin = detailValue('driver-detail-pin').trim();
  if (!/^\d{4}$/.test(pin)) {
    setDetailStatus('Clock PIN must be 4 digits.', 'error');
    return;
  }
  const pay = normalizeDriverPay({
    serial: detailValue('driver-detail-serial'),
    rate,
    account: detailValue('driver-detail-account'),
  });
  const lines = payLinesForInfo();
  const payStatuses = lines.map((line) => line.id).filter((id) => detailPayStatuses().includes(id));
  const payStatusByRun = normalizePayStatusByRun(detailPayStatusByRun(), payStatuses);
  const submit = driverDetailForm.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  try {
    setDetailStatus('Saving driver…');
    const saved = saveDriver({
      id: existing?.id,
      previousName: existing?.name || '',
      firstName,
      lastName,
      email: existing?.email || '',
      phone: detailValue('driver-detail-phone').trim(),
      serial: pay.serial,
      rate: pay.rate,
      account: pay.account,
      payStatuses,
      payStatusByRun,
    });
    saveDriverClockPin(saved.id, pin);
    driverDetailId = saved.id;
    renderDrivers(saved.name);
    renderDriverDetail();
    setDetailStatus('Saving driver…');
    if (accountsEnabled()) await whenSharedOfficeSaved();
    setDetailStatus(accountsEnabled() ? `${saved.name} saved.` : `${saved.name} saved on this device.`, 'ok');
  } catch (error) {
    setDetailStatus(error instanceof Error ? error.message : 'Could not save that driver.', 'error');
  } finally {
    if (submit) submit.disabled = false;
  }
});

driverDetailDialog?.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const removeStatus = target?.closest('[data-remove-status]');
  if (removeStatus instanceof HTMLButtonElement) {
    const current = detailPayStatuses();
    if (current.length < 2) {
      setDetailStatus('Leave at least one pay status for this driver.', 'error');
      return;
    }
    refreshDetailStatuses(
      current.filter((id) => id !== removeStatus.dataset.removeStatus),
      detailPayStatusByRun()
    );
    return;
  }
  const add = target?.closest('[data-add-status]');
  if (!(add instanceof HTMLButtonElement)) return;
  const select = add.parentElement?.querySelector('[data-pay-status-add]');
  if (!(select instanceof HTMLSelectElement) || !select.value) return;
  const current = detailPayStatuses();
  if (current.includes(select.value)) return;
  refreshDetailStatuses([...current, select.value], detailPayStatusByRun());
});

document.querySelector('#driver-detail-close')?.addEventListener('click', () => {
  driverDetailDialog?.close();
});

driverDetailRemove?.addEventListener('click', async () => {
  const driver = driverDetailId ? infoDriver(driverDetailId) : null;
  if (!driver || !confirmRemoveDriver(driver)) return;
  try {
    setDetailStatus('Removing driver…');
    deleteDriver(driver.id);
    if (accountsEnabled()) await whenSharedOfficeSaved();
    driverDetailDialog?.close();
    setStatus(
      driverStatus,
      accountsEnabled() ? `${driver.name} removed.` : `${driver.name} removed on this device.`,
      'ok'
    );
    renderDrivers();
  } catch (error) {
    setDetailStatus(error instanceof Error ? error.message : 'Could not remove that driver.', 'error');
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
  const pending = item.noticeSent ? '' : 'Notice not sent. ';
  return `${pending}${index + 1} of ${total}. Route ${item.routeName}, ${item.segmentLabel}, ${item.previousTime} to ${item.newTime}.${effect} ${recorded} ${who}${note}`;
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
  const flag = item.noticeSent ? '' : noticeFlagHtml();
  return `<article class="recent-changes-card" data-index="${index}" aria-roledescription="slide" aria-label="${index + 1} of ${total}"${hidden}>
    <p class="recent-changes-title">${flag}Route ${escapeHtml(item.routeName)} · ${escapeHtml(item.segmentLabel)}</p>
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

function showRecentRouteChanges(state) {
  if (!recentChangesBox || !recentChangesTrack) return;
  recentChangeItems = recentRouteChanges(state);
  refreshCoveredClockNotices();
  recentChangeItems.forEach((item) => {
    item.noticeSent = coveredClockNoticeIds.has(item.id) || isChangeNoticeSent(item.id);
  });
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

// Replace the fictional sample with employee-data/office-state.json when that
// file has been copied to the dashboard as starter-office.json.
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
    leaveRequests: Array.isArray(current.leaveRequests) ? current.leaveRequests : [],
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
    ...(Object.prototype.hasOwnProperty.call(current, 'contractQuarterHourSnap')
      ? { contractQuarterHourSnap: current.contractQuarterHourSnap }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(current, 'bidBumpUseSnappedContractTimes')
      ? { bidBumpUseSnappedContractTimes: current.bidBumpUseSnappedContractTimes }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(current, 'contractSnapBreaks')
      ? { contractSnapBreaks: current.contractSnapBreaks }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(current, 'overtimeRules')
      ? { overtimeRules: current.overtimeRules }
      : {}),
    clockReasonCodes: Array.isArray(current.clockReasonCodes) ? current.clockReasonCodes : [],
    clockSubstituteDrivers: Array.isArray(current.clockSubstituteDrivers) ? current.clockSubstituteDrivers : [],
    ...(current.paperBackup ? { paperBackup: current.paperBackup } : {}),
    ...(current.routeDataBackup ? { routeDataBackup: current.routeDataBackup } : {}),
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
    ...(next.contractNotice
      ? { contractNotice: next.contractNotice }
      : current.contractNotice
        ? { contractNotice: current.contractNotice }
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

let timeclockDesk = { refresh() {} };
let paperBackupDesk = { refresh() {} };
let timeclockMount = null;
let paperMount = null;
let timeclockMounted = false;

function refreshPaperRecords() {
  if (activeSheet !== 'clocking' && activeSheet !== 'paper-backup') return;
  void ensurePaperBackup().then((desk) => {
    if (activeSheet === 'clocking' || activeSheet === 'paper-backup') desk.refresh();
  });
}

function ensurePaperBackup() {
  if (!paperMount) {
    paperMount = import('./paperBackup.js').then(({ mountPaperBackup }) => {
      paperBackupDesk = mountPaperBackup({
        readState: loadState,
        writeState(state) {
          saveState(state);
          if (activeSheet === 'clock-settings' || activeSheet === 'settings') timeclockDesk.refresh();
        },
      });
      return paperBackupDesk;
    });
  }
  return paperMount;
}

const clockDesk = mountClockDesk({
  readState: loadState,
  writePunches(punches) {
    const state = loadState();
    state.punches = punches;
    saveState(state);
    refreshPaperRecords();
  },
  listNames() {
    const names = listDrivers().map((driver) => driver.name);
    const punches = loadState()?.punches;
    if (!Array.isArray(punches)) return names;
    for (const punch of punches) {
      if (punch?.removed === true) continue;
      const name = String(punch?.driver_name || '').trim();
      if (name) names.push(name);
    }
    return names;
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

// Clock-in for each run on the schedule in effect today. A bad route is skipped
// so one profile cannot take down the driver screen.
// On an early release day, `earlyReleaseTimes` replaces the PM clock-in with the
// time for the first school on the route. Null keeps the regular PM clock-in.
function routeClocksByRun(profile, today, earlyReleaseTimes) {
  try {
    const schedule = buildSnapshot(profile, today)?.schedule || {};
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

function ensureTimeclock() {
  if (!timeclockMount) {
    timeclockMount = import('./timeclockKiosk.js').then(({ mountTimeclock }) => {
      timeclockDesk = mountTimeclock({
  readState: loadState,
    writeState(state) {
    const beforeYear = JSON.stringify(savedSchoolYear(loadState()));
    const beforeSnap = contractQuarterHourSnapEnabled(loadState());
    const beforeBidSnap = bidBumpUseSnappedContractTimesEnabled(loadState());
    const beforeBreaks = JSON.stringify(contractSnapBreaksFromState(loadState()));
    saveState(state);
    syncSchoolYearCalendar();
    if (activeSheet === 'payroll' || activeSheet === 'clocking') clockDesk.refresh();
    refreshPaperRecords();
    const yearChanged = JSON.stringify(savedSchoolYear(state)) !== beforeYear;
    const snapChanged =
      contractQuarterHourSnapEnabled(state) !== beforeSnap ||
      bidBumpUseSnappedContractTimesEnabled(state) !== beforeBidSnap ||
      JSON.stringify(contractSnapBreaksFromState(state)) !== beforeBreaks;
    if (yearChanged || snapChanged) loadAll();
  },
  listPeople() {
    const state = loadState();
    const today = localDateString();
    let earlyReleaseTimes = null;
    try {
      syncSchoolYearCalendar();
      if (isEarlyReleaseDate(today, getSchoolDays(calendarPayload()), earlyReleaseRulesForState(state))) {
        earlyReleaseTimes = state.clockEarlyReleaseTimes;
      }
    } catch {
      earlyReleaseTimes = null;
    }
    const routesByName = new Map();
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
  contractedMinutes(driverName, dateKey) {
    return contractedRunMinutes(loadState().profiles, driverName, dateKey, (profile, date) => {
      try {
        return contractedSegments(
          rebuildEmployeeRouteState(
            profile?.changeLog ?? [],
            calendarPayload(),
            date,
            {},
            contractSnapOptions(loadState())
          )
        );
      } catch {
        return {};
      }
    });
  },
      });
      timeclockMounted = true;
      return timeclockDesk;
    });
  }
  return timeclockMount;
}

function timeclockNeededNow() {
  if (isExternalTimeclockSearch(location.search)) return true;
  try {
    return sessionStorage.getItem(TIMECLOCK_LOCK_KEY) === '1';
  } catch {
    return false;
  }
}

function revealOffice() {
  document.body.classList.remove('is-booting');
}

function paintLocalOffice() {
  try {
    loadAll();
  } catch (error) {
    setStatus(setupStatus, error.message, 'error');
    setupView.hidden = false;
  }
}

function reportOfficeToolError(error) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : activeSheet === 'payroll'
        ? 'Could not open Payroll tools.'
        : 'Could not open the timeclock.';
  if (activeSheet === 'payroll') {
    const mathStatus = document.querySelector('#math-maker-status');
    if (mathStatus) {
      setStatus(mathStatus, message, 'error');
      return;
    }
  }
  if (fileStatus) setStatus(fileStatus, message, 'error');
}

// Payroll buttons are wired when the timeclock module loads.
// A click in that gap is kept and run once the module is ready,
// so a submit button cannot reload the page first.
function armPayrollTools() {
  const root = document.querySelector('#payroll-view');
  if (!(root instanceof HTMLElement)) return;
  let waiting = false;

  function heldButton(target) {
    if (!(target instanceof Element)) return null;
    const button = target.closest('button');
    if (!(button instanceof HTMLButtonElement) || !root.contains(button)) return null;
    if (button.id === 'open-drivers') return null;
    if (
      button.closest(
        '#payroll-tools, #summary-tool, #pay-period-settings, #pay-status-settings, #quarter-clock-payroll, #overtime-rules-payroll'
      )
    ) {
      return button;
    }
    return null;
  }

  function runWhenReady(button, form = null, submitter = null) {
    if (waiting) return;
    waiting = true;
    void ensureTimeclock()
      .then(() => {
        waiting = false;
        if (!timeclockMounted) return;
        if (form) {
          if (submitter) form.requestSubmit(submitter);
          else form.requestSubmit();
          return;
        }
        button?.click();
      })
      .catch((error) => {
        waiting = false;
        reportOfficeToolError(error);
      });
  }

  root.addEventListener(
    'click',
    (event) => {
      if (timeclockMounted) return;
      const button = heldButton(event.target);
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      runWhenReady(button);
    },
    true
  );

  root.addEventListener(
    'submit',
    (event) => {
      if (timeclockMounted) return;
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const inPayrollTools = form.closest(
        '#summary-tool, #pay-period-settings, #pay-status-settings, #quarter-clock-payroll, #overtime-rules-payroll'
      );
      if (!inPayrollTools) return;
      event.preventDefault();
      event.stopPropagation();
      const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;
      runWhenReady(null, form, submitter);
    },
    true
  );
}

// The Start Timeclock button is on the page before its screen has loaded.
// A click during that gap starts the load, then runs the button once it is ready.
function armTimeclockLaunch(selector) {
  const button = document.querySelector(selector);
  if (!button) return;
  let waiting = false;
  button.addEventListener('click', () => {
    if (timeclockMounted || waiting) return;
    waiting = true;
    void ensureTimeclock()
      .then(() => {
        waiting = false;
        if (timeclockMounted) button.click();
      })
      .catch(() => {
        waiting = false;
      });
  });
}

function refreshDeskFromAnotherWindow() {
  if (activeSheet === 'payroll' || activeSheet === 'clocking') {
    clockDesk.refresh();
    if (activeSheet === 'payroll') renderDriverInfo();
    if (activeSheet === 'clocking') refreshPaperRecords();
    return;
  }
  if (activeSheet === 'paper-backup') {
    refreshPaperRecords();
    return;
  }
  if (activeSheet === 'settings' || activeSheet === 'clock-settings') {
    void ensureTimeclock().then((desk) => {
      if (activeSheet === 'settings' || activeSheet === 'clock-settings') desk.refresh();
    });
    return;
  }
  if (isEditingRouteClockTimes()) {
    pendingSharedUiRefresh = true;
    return;
  }
  snapshot = addingPerson ? buildSnapshot(null) : currentSnapshot();
  renderApp();
}

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;
  syncSchoolYearCalendar();
  refreshDeskFromAnotherWindow();
});

document.addEventListener('focusout', () => {
  window.setTimeout(() => flushPendingSharedOfficeUiRefresh(), 0);
});
changeDialog?.addEventListener('close', () => flushPendingSharedOfficeUiRefresh());

renderSetupRuns();
armPayrollTools();
armTimeclockLaunch('#start-timeclock');
if (timeclockNeededNow()) document.body.dataset.holdBoot = 'timeclock';
paintLocalOffice();
if (document.body.dataset.holdBoot === 'timeclock') {
  void ensureTimeclock()
    .then(() => {
      delete document.body.dataset.holdBoot;
      revealOffice();
    })
    .catch((error) => {
      delete document.body.dataset.holdBoot;
      revealOffice();
      setStatus(setupStatus, error.message || 'Could not open the timeclock.', 'error');
    });
} else {
  revealOffice();
}
startAccounts({
  onReady() {
    (async () => {
      try {
        ensureExampleRoutes();
        await adoptStarterOffice();
        beginSessionRouteTracking();
        if (!isEditingRouteClockTimes()) loadAll();
        else pendingSharedUiRefresh = true;
        await createAutomaticNotices();
      } catch (error) {
        setStatus(setupStatus, error.message, 'error');
        setupView.hidden = false;
      }
    })();
  },
  onRemoteReset() {
    requestSharedOfficeUiRefresh();
  },
}).catch((error) => {
  if (document.body.dataset.holdBoot !== 'timeclock') document.body.classList.remove('is-booting');
  setStatus(setupStatus, error.message || 'Could not start accounts.', 'error');
  setupView.hidden = false;
});

initCitations();
