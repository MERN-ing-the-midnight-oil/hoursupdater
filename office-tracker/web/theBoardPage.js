import {
  absenceDayLabel,
  absenceMarkup,
  absencePortions,
  absencesForDate,
  addOutOfService,
  applyScheduleClocks,
  assignRouteBuses,
  availableBusSheet,
  availableBusSheetMarkup,
  availableDrivers,
  availableMarkup,
  boardDate,
  boardRuns,
  darkBusKey,
  darkBuses,
  startupDismissals,
  darkBusLog,
  darkBusPageMarkup,
  darkBusPills,
  darkBusScreen,
  darkBusSwitchNote,
  indexPowerEvents,
  applyPowerOns,
  sparePowerLive,
  busesInService,
  rememberAlertTimes,
  withAlertedAt,
  darkBusSkip,
  earlyReleaseWatch,
  adoptScheduleClocks,
  restoreRegularPmClocks,
  minutesNow,
  normalizeEarlyMinutes,
  noteSchoolVisits,
  noteYardReturns,
  normalizeStudentCheckAlert,
  studentCheckAlarmStatement,
  studentCheckAlerts,
  studentCheckPageMarkup,
  studentCheckPillFacts,
  studentCheckPills,
  studentCheckSchoolVisits,
  studentCheckScreen,
  studentCheckSwitchNote,
  studentCheckYardReturns,
  studentChecksByRun,
  studentCheckKey,
  absencePortionPosts,
  absenceSchedules,
  calendarCells,
  normalizeDarkBusAlert,
  applyOutOfServiceSpares,
  assignOutOfServiceSpare,
  outOfServiceManagerView,
  outOfServiceMarkup,
  placeOutOfServiceSpare,
  portionSpareMap,
  pairedAbsenceBus,
  pairedAbsenceRoute,
  postAbsenceDays,
  replaceAbsenceSchedule,
  rememberedNames,
  rememberStudent,
  removeAbsencePortion,
  removeOutOfService,
  routeRunChoices,
  isSpedRoute,
  spareAssignmentWarnings,
  spareAssignPrompt,
  spareCovers,
  sparePoolChoiceMarkup,
  sparePoolMarkup,
  sparePortionWarnings,
  routeBusSheet,
  mainFleetFromSheet,
  mainFleetMarkup,
  mainFleetWarnings,
  normalizeSparePools,
  routeWheelchairNeed,
  watchOutOfService,
} from '../src/theBoard.js';
import { POSTED_REG_ED_SPARES, POSTED_ROUTE_BUSES, POSTED_ROUTE_SHEET, POSTED_SPED_SPARES, seedPostedRouteBuses } from '../src/postedRouteBuses.js';
import {
  DEFAULT_OOS_NOTICE_BODY,
  DEFAULT_OOS_NOTICE_SUBJECT,
  noticeLetterEml,
  noticeMailFits,
  noticeMailto,
  outOfServiceLetterFilename,
  outOfServiceNoticeMail,
} from '../src/noticeMail.js';
import { bindCalculatorStore, buildSnapshot, calendarPayload, useSchoolYearCalendar } from '../../employee-tracker/web/engine.js';
import { localDateString } from '../../employee-tracker/src/clockTimes.js';
import { getSchoolDays } from '../../src/logic/calendar.js';
import {
  EARLY_RELEASE_DEFAULT_CLOCK,
  earlyReleaseClock,
  earlyReleaseScreenClock,
  isEarlyReleaseDate,
} from '../../src/logic/earlyRelease.js';
import { earlyReleaseRulesForState, savedSchoolYear } from '../../src/logic/schoolYear.js';
import { driverPhotoSrc } from './driverPhotos.js';
import {
  STORAGE_KEY,
  contractSnapOptions,
  listDrivers,
  listProfiles,
  loadOutOfServiceNotice,
  loadState,
  saveOutOfServiceNotice,
} from './store.js';

const ROSTER_KEY = 'the-board-roster';
const ABSENCE_KEY = 'the-board-absences';
const RUNS_KEY = 'the-board-runs';
const ALERTED_KEY = 'the-board-dark-alerted';
const OOS_KEY = 'the-board-out-of-service';
const PAIRING_KEY = 'the-board-pairings';
const ROUTE_BUS_KEY = 'the-board-route-buses';
const ROUTE_WC_KEY = 'the-board-route-wheelchairs';
const POSTED_SEED_KEY = 'the-board-posted-sheet';
const USUAL_KEY = 'the-board-usual-starts';
const ALERT_KEY = 'the-board-dark-alert';
const ACK_KEY = 'the-board-dark-ack';
const SCHOOL_VISIT_KEY = 'the-board-school-visits';
const YARD_RETURN_KEY = 'the-board-yard-returns';
const EARLY_KEY = 'the-board-early-minutes';
const STUDENT_ALERT_KEY = 'the-board-student-alert';
const STUDENT_ACK_KEY = 'the-board-student-ack';
const STUDENT_VISIT_KEY = 'the-board-student-visits';
const STUDENT_RETURN_KEY = 'the-board-student-returns';

const oosList = document.querySelector('#oos-list');
const absentList = document.querySelector('#absent-list');
const availableList = document.querySelector('#available-list');
const nowEl = document.querySelector('#board-now');
const absentDialog = document.querySelector('#absent-dialog');
const absentForm = document.querySelector('#absent-form');
const absentFormStatus = document.querySelector('#absent-form-status');
const darkPage = document.querySelector('#dark-bus-page');
const darkPills = document.querySelector('#dark-bus-pills');
const darkNote = document.querySelector('#dark-bus-switch-note');
const boardTitle = document.querySelector('.the-board-bar h1');
const darkTitle = document.querySelector('#dark-bus-title');
const graceInput = document.querySelector('#dark-bus-grace');
const midAtInput = document.querySelector('#dark-bus-mid-at');
const pmAtInput = document.querySelector('#dark-bus-pm-at');
const soundInput = document.querySelector('#dark-bus-sound');
const flashInput = document.querySelector('#dark-bus-flash');
const coverInput = document.querySelector('#dark-bus-cover');
const countEl = document.querySelector('#dark-bus-count');
const alertButton = document.querySelector('#dark-bus-open');
const configStatus = document.querySelector('#dark-bus-config-status');
const oosForm = document.querySelector('#oos-form');
const oosDialog = document.querySelector('#oos-dialog');
const oosStatus = document.querySelector('#oos-status');
const oosFormStatus = document.querySelector('#oos-form-status');
const spareStatus = document.querySelector('#dark-bus-spare-status');
const studentPage = document.querySelector('#student-check-page');
const studentPills = document.querySelector('#student-check-pills');
const studentNote = document.querySelector('#student-check-switch-note');
const studentTitle = document.querySelector('#student-check-title');
const studentGraceInput = document.querySelector('#student-check-grace');
const studentSoundInput = document.querySelector('#student-check-sound');
const studentFlashInput = document.querySelector('#student-check-flash');
const studentCoverInput = document.querySelector('#student-check-cover');
const studentCountEl = document.querySelector('#student-check-count');
const studentButton = document.querySelector('#student-check-open');
const studentConfigStatus = document.querySelector('#student-check-config-status');
const studentStatus = document.querySelector('#student-check-status');
const availableSettingsDialog = document.querySelector('#available-settings-dialog');
const availableEarlyInput = document.querySelector('#available-early-minutes');
const availableBusSheetEl = document.querySelector('#available-bus-sheet');
const availableSettingsStatus = document.querySelector('#available-settings-status');

let announced = new Set();
let latestAlerts = [];
const ABSENCE_PARTS = ['AM', 'MID', 'PM'];
let absencePlan = {};
let absenceAuto = { AM: { bus: false, route: false }, MID: { bus: false, route: false }, PM: { bus: false, route: false } };
let absenceMode = 'today';
let absenceEdit = null;
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function roster() {
  const rows = readJson(ROSTER_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

function absences() {
  const rows = readJson(ABSENCE_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

function runs() {
  const rows = readJson(RUNS_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

function routeCatalog() {
  return listProfiles()
    .map((profile) => profile?.name)
    .filter(Boolean);
}

function outOfService() {
  const rows = readJson(OOS_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

function routeBuses() {
  const rows = readJson(ROUTE_BUS_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

function usualStarts() {
  const rows = readJson(USUAL_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

function migratePairings() {
  const old = readJson(PAIRING_KEY, null);
  if (!Array.isArray(old) || !old.length) return;
  if (localStorage.getItem(ROUTE_BUS_KEY) == null && localStorage.getItem(USUAL_KEY) == null) {
    writeJson(ROUTE_BUS_KEY, old.filter((row) => String(row?.route || '').trim()));
    writeJson(USUAL_KEY, old.filter((row) => !String(row?.route || '').trim()));
  }
  localStorage.removeItem(PAIRING_KEY);
}

function liveStatus(rows) {
  const live = {};
  for (const run of rows || []) {
    const bus = String(run?.bus || '').trim().toLowerCase();
    if (!bus) continue;
    const piece = String(run?.run || '').trim().toLowerCase();
    const status = {
      poweredOnAt: run.poweredOnAt || '',
      lastStopVisited: Boolean(run.lastStopVisited),
    };
    live[`${bus}|${piece}`] = status;
    if (!piece) live[bus] = status;
  }
  return live;
}

let busZones = [];
let powerEventsByBus = null;
let studentInspections = null;

function withPostedDrivers(runs) {
  const drivers = new Map(POSTED_ROUTE_BUSES.map((row) => [String(row.route).toLowerCase(), row.driver || '']));
  return (runs || []).map((run) => ({
    ...run,
    driver: drivers.get(String(run?.route || '').trim().toLowerCase()) || run?.driver || '',
  }));
}

function regularDriverName(route) {
  const profile = routeProfile(route);
  const full = String(profile?.driver_name || '').trim();
  if (full) return full;
  const posted = POSTED_ROUTE_BUSES.find(
    (row) => String(row.route).toLowerCase() === String(route || '').trim().toLowerCase()
  );
  const short = String(posted?.driver || '').trim();
  if (!short) return '';
  const match = listProfiles().find((item) => sameDriver(short, item?.driver_name));
  return String(match?.driver_name || short).trim();
}

async function loadBusZones() {
  try {
    const response = await fetch('/api/the-board/availability');
    if (!response.ok) return;
    const data = await response.json();
    busZones = Array.isArray(data?.buses) ? data.buses : [];
    paintBoard();
  } catch {
    // The roster still shows. Yard status fills in on the next check.
  }
}

async function loadPowerEvents() {
  const now = minutesNow();
  const buses = new Set(busesInService(watchedRuns(), now));
  for (const row of outOfService()) {
    const spare = String(row?.spareBus || '').trim().replace(/^0+(?=\d)/, '');
    if (spare) buses.add(spare);
  }
  if (!buses.size) return;
  try {
    const response = await fetch(`/api/the-board/power?buses=${encodeURIComponent([...buses].join(','))}`);
    if (!response.ok) return;
    const data = await response.json();
    powerEventsByBus = indexPowerEvents(data?.events);
    paintBoard();
  } catch {
    // Alerts stay up without a Power On time until the next check.
  }
}

async function loadInspections() {
  try {
    const response = await fetch('/api/the-board/inspections');
    if (!response.ok) return;
    const data = await response.json();
    studentInspections = Array.isArray(data?.inspections) ? data.inspections : [];
    paintBoard();
  } catch {
    // A missing list stays quiet. The alert waits until Zonar answers.
  }
}

function watchedRuns() {
  const assigned = boardRuns(routeBuses(), usualStarts(), liveStatus(runs()));
  if (!assigned.length) return runs();
  return assigned;
}

let clocksBound = false;

function bindOfficeClocks() {
  if (clocksBound) return;
  bindCalculatorStore({
    contractSnapOptions: () => contractSnapOptions(loadState()),
  });
  clocksBound = true;
}

function cachedClocks() {
  const cache = new Map();
  return (route) => {
    const key = String(route || '').trim().toLowerCase();
    if (!cache.has(key)) cache.set(key, clocksForRoute(route).runs);
    return cache.get(key);
  };
}

function routeSchedules() {
  const clocksFor = cachedClocks();
  const names = new Map();
  const add = (name) => {
    const route = String(name || '').trim().replace(/\s+/g, ' ');
    if (!route) return;
    const key = route.toLowerCase();
    if (!names.has(key)) names.set(key, route);
  };
  for (const row of POSTED_ROUTE_BUSES) add(row.route);
  for (const name of routeCatalog()) add(name);
  for (const row of routeBuses()) add(row.route);
  return [...names.values()].map((route) => ({ route, runs: clocksFor(route) }));
}

function refreshScheduleClocks() {
  const clocksFor = cachedClocks();
  const current = routeBuses();
  const names = new Set(current.map((row) => String(row?.route || '').trim()).filter(Boolean));
  for (const row of POSTED_ROUTE_BUSES) names.add(row.route);
  const schedules = [...names].map((route) => {
    const detail = clocksForRoute(route);
    return { route, runs: detail.runs, skip: detail.skip };
  });
  let next = applyScheduleClocks(current, clocksFor);
  next = adoptScheduleClocks(next, schedules);
  next = restoreRegularPmClocks(next, clocksFor, earlyPmClock, EARLY_RELEASE_DEFAULT_CLOCK);
  if (next !== current) writeJson(ROUTE_BUS_KEY, next);
}

function skippedRoutes() {
  const names = new Set(routeBuses().map((row) => String(row?.route || '').trim()).filter(Boolean));
  for (const row of POSTED_ROUTE_BUSES) names.add(row.route);
  return [...names].flatMap((route) => {
    const reason = clocksForRoute(route).skip;
    return reason ? [{ route, reason }] : [];
  });
}

function routeProfile(name) {
  const want = String(name || '').trim().toLowerCase();
  const profiles = listProfiles();
  const exact = profiles.find((item) => String(item?.name || '').trim().toLowerCase() === want);
  if (exact) return exact;
  const number = Number(want);
  if (!Number.isInteger(number) || number <= 0) return null;
  return (
    profiles.find((item) => {
      const match = /^s\s*0*(\d+)$/i.exec(String(item?.name || '').trim());
      return match && Number(match[1]) === number;
    }) || null
  );
}

function sameDriver(posted, full) {
  const short = String(posted || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const name = String(full || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!short.length || !name.length || short[0] !== name[0]) return false;
  if (short.length === 1) return true;
  return name[name.length - 1].startsWith(short[1].replace(/\./g, ''));
}

function utilitySkipForPosted(route) {
  const posted = POSTED_ROUTE_BUSES.find((row) => String(row.route).toLowerCase() === String(route || '').trim().toLowerCase());
  if (!posted?.driver) return '';
  const utility = listProfiles().find(
    (profile) => darkBusSkip(profile).startsWith('Utility') && sameDriver(posted.driver, profile.driver_name)
  );
  return utility ? darkBusSkip(utility) : '';
}

function clocksForRoute(name) {
  const profile = routeProfile(name);
  const postedSkip = utilitySkipForPosted(name);
  if (!profile) return { known: false, runs: [], skip: postedSkip };
  const skip = darkBusSkip(profile) || postedSkip;
  if (skip) return { known: true, runs: [], skip };
  try {
    bindOfficeClocks();
    const state = loadState();
    useSchoolYearCalendar(savedSchoolYear(state));
    const today = localDateString();
    const schedule = buildSnapshot(profile, today)?.schedule || {};
    return { known: true, runs: routeRunChoices(schedule), skip: '' };
  } catch {
    return { known: true, runs: [], skip: '' };
  }
}

function alertSettings() {
  return normalizeDarkBusAlert(readJson(ALERT_KEY, null));
}

function officeEarlyRelease() {
  try {
    bindOfficeClocks();
    const state = loadState();
    useSchoolYearCalendar(savedSchoolYear(state));
    const today = localDateString();
    if (!isEarlyReleaseDate(today, getSchoolDays(calendarPayload()), earlyReleaseRulesForState(state))) return null;
    return state;
  } catch {
    return null;
  }
}

function earlyPmClock(route) {
  const profile = routeProfile(route);
  if (!profile) return '';
  try {
    return earlyReleaseClock(profile.note, loadState().clockEarlyReleaseTimes);
  } catch {
    return '';
  }
}

function darkScreenSettings(settings = alertSettings()) {
  const state = officeEarlyRelease();
  if (!state) return settings;
  const pmAt = earlyReleaseScreenClock(state.clockEarlyReleaseTimes);
  return { ...settings, midAt: pmAt, pmAt, earlyRelease: true };
}

function earlyMinutes() {
  return normalizeEarlyMinutes(readJson(EARLY_KEY, null));
}

function schoolVisits(date = new Date()) {
  const saved = readJson(SCHOOL_VISIT_KEY, null);
  if (!saved || saved.date !== boardDate(date) || !Array.isArray(saved.keys)) return [];
  return saved.keys;
}

function rememberSchoolVisits(runs, now, zones, date = new Date()) {
  const next = noteSchoolVisits(runs, now, zones, schoolVisits(date));
  const prev = schoolVisits(date);
  if (next.length !== prev.length || next.some((key, index) => key !== prev[index])) {
    writeJson(SCHOOL_VISIT_KEY, { date: boardDate(date), keys: next });
  }
  return next;
}

function yardReturns(date = new Date()) {
  const saved = readJson(YARD_RETURN_KEY, null);
  if (!saved || saved.date !== boardDate(date) || !Array.isArray(saved.returns)) return [];
  return saved.returns;
}

function rememberYardReturns(runs, now, zones, schoolKeys, date = new Date()) {
  const next = noteYardReturns(runs, now, zones, schoolKeys, yardReturns(date));
  const prev = yardReturns(date);
  const same =
    next.length === prev.length &&
    next.every((item, index) => item.key === prev[index]?.key && item.at === prev[index]?.at);
  if (!same) writeJson(YARD_RETURN_KEY, { date: boardDate(date), returns: next });
  return next;
}

function acknowledgeRoute(key) {
  const routeKey = String(key || '');
  if (!routeKey) return;
  stopRouteAlarm(routeKey);
  const acked = new Set(acknowledged());
  if (acked.has(routeKey)) return;
  acked.add(routeKey);
  writeAcknowledged([...acked]);
}

function acknowledged() {
  const saved = readJson(ACK_KEY, null);
  if (!saved || saved.date !== boardDate() || !Array.isArray(saved.keys)) return [];
  return saved.keys;
}

function writeAcknowledged(keys) {
  writeJson(ACK_KEY, { date: boardDate(), keys });
}

function setOosStatus(message) {
  for (const el of [oosStatus, document.querySelector('#oos-manager-status')]) {
    if (!el) continue;
    el.hidden = !message;
    el.textContent = message || '';
  }
}

function alarmTones(key) {
  let hash = 0;
  for (const char of String(key || '')) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  const high = 520 + (hash % 7) * 60;
  return [high, Math.round(high * 0.75)];
}

function playAlertSound(key) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = playAlertSound.ctx || new AudioCtx();
    playAlertSound.ctx = ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const start = ctx.currentTime;
    alarmTones(key).forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const at = start + index * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.17);
    });
  } catch {
    // A browser can block sound until the page has been clicked.
  }
}

function paintClock(date = new Date()) {
  if (!nowEl) return;
  nowEl.textContent = date.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

let paintedPills = '';
let darkWatch = [];
let darkSkipped = [];
let darkLive = {};
let darkPowered = [];
let pinnedDarkTab = '';
let pinnedDuring = '';
let darkPageForced = false;
let darkPageClosed = false;

function darkBlockersOpen() {
  return Boolean(
    absentDialog?.open ||
      availableSettingsDialog?.open ||
      oosDialog?.open ||
      document.querySelector('#absent-editor')?.hidden === false ||
      document.querySelector('#oos-manager')?.hidden === false
  );
}

function shownDarkTab(now, settings) {
  const scheduled = darkBusScreen(now, settings);
  if (pinnedDarkTab && pinnedDuring === scheduled) return pinnedDarkTab;
  pinnedDarkTab = '';
  pinnedDuring = '';
  return scheduled;
}

const BOARD_PATH = '/the-board';
const DARK_BUS_PATH = '/the-board/darkbus';

function cleanPath(pathname) {
  const path = String(pathname || '/');
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function isDarkBusPath() {
  return cleanPath(location.pathname) === DARK_BUS_PATH;
}

function setScreenAddress(path, mode) {
  if (!mode || cleanPath(location.pathname) === path) return;
  const state = { screen: path };
  if (mode === 'replace') history.replaceState(state, '', path);
  else history.pushState(state, '', path);
}

function studentPageOpen() {
  return Boolean(studentPage && !studentPage.hidden);
}

function openDarkPage(address = 'push') {
  const manager = document.querySelector('#oos-manager');
  if (manager) manager.hidden = true;
  const editor = document.querySelector('#absent-editor');
  if (editor) editor.hidden = true;
  if (studentPage) studentPage.hidden = true;
  document.body.classList.remove('is-student-open');
  if (darkPage) darkPage.hidden = false;
  document.body.classList.add('is-dark-open');
  document.title = 'Dark Bus Alerts';
  setScreenAddress(DARK_BUS_PATH, address);
}

function closeDarkPage(address = 'push') {
  darkPageForced = false;
  darkPageClosed = true;
  if (darkPage) darkPage.hidden = true;
  document.body.classList.remove('is-dark-open');
  document.title = 'The Board';
  setScreenAddress(BOARD_PATH, address);
}

function paintDarkPage(now, settings) {
  const view = darkScreenSettings(settings);
  const scheduled = darkBusScreen(now, view);
  const tab = shownDarkTab(now, view);
  for (const button of document.querySelectorAll('[data-dark-tab]')) {
    const on = button.dataset.darkTab === tab;
    button.setAttribute('aria-selected', on ? 'true' : 'false');
    button.tabIndex = on ? 0 : -1;
  }
  if (darkPills) darkPills.setAttribute('aria-labelledby', `dark-tab-${tab.toLowerCase()}`);
  if (darkNote) darkNote.textContent = darkBusSwitchNote(tab, scheduled, view);
  const acked = acknowledged();
  const markup = darkBusPageMarkup(darkWatch, {
    nowMinutes: now,
    graceMinutes: settings.graceMinutes,
    tab,
    acknowledged: acked,
  });
  if (darkPills && markup !== paintedPills) {
    paintedPills = markup;
    darkPills.innerHTML = markup;
  }
}

function paintAlert(alerts, settings, logLines = [], now = minutesNow()) {
  latestAlerts = alerts;
  const ackedSet = new Set(acknowledged());
  const pending = alerts.filter((alert) => !ackedSet.has(darkBusKey(alert)));
  const fresh = pending.filter((alert) => !announced.has(darkBusKey(alert)));
  announced = new Set(alerts.map(darkBusKey));
  const reds = darkBusPills(darkWatch, now, settings.graceMinutes, ackedSet).filter((pill) => pill.tone === 'dark');

  if (countEl) {
    countEl.hidden = reds.length === 0;
    countEl.textContent = String(reds.length);
  }
  alertButton?.classList.toggle('is-live', reds.length > 0);
  darkTitle?.classList.toggle('is-dark-flash', reds.length > 0);
  syncBoardFlash();

  const logSignature = (logLines || []).map((line) => `${line.bus}|${line.route}|${line.run}|${line.verdict}|${line.detail}`).join('\n');
  if (logSignature !== paintAlert.logged) {
    paintAlert.logged = logSignature;
    const text = (logLines || [])
      .map((line) => {
        const who = [line.bus ? `Bus ${line.bus}` : '', line.route ? `Route ${line.route}` : '', line.run].filter(Boolean).join(' ');
        return `${who}: ${line.verdict}. ${line.detail}`;
      })
      .join('\n');
    console.info(`[Dark Bus]${text ? `\n${text}` : ' No runs are being watched.'}`);
  }
  if (fresh.length) darkPageClosed = false;
  const pageHidden = !darkPage || darkPage.hidden;
  const coverHolding = Boolean(settings.cover) && pending.length > 0;
  if (pending.length && pageHidden && !darkPageClosed && !darkBlockersOpen() && !studentPageOpen() && (coverHolding || fresh.length)) {
    darkPageForced = true;
    openDarkPage('replace');
  } else if (darkPageForced && !pending.length && darkPage && !darkPage.hidden) {
    closeDarkPage('replace');
  }
  if (darkPage && !darkPage.hidden) paintDarkPage(now, settings);
  const pageOpen = Boolean(darkPage && !darkPage.hidden);
  if (fresh.length && settings.flash && !(coverHolding && pageOpen)) flashScreen();
  syncRouteAlarms(pending, settings);
  const anyFlashing = reds.length > 0;
  darkPage?.classList.toggle('is-alarming', anyFlashing && Boolean(settings.flash) && pageOpen);
  if (!anyFlashing) document.body.classList.remove('is-flashing');
}

function flashScreen() {
  document.body.classList.remove('is-flashing');
  void document.body.offsetWidth;
  document.body.classList.add('is-flashing');
}

const routeAlarms = new Map();

window.speechSynthesis?.cancel();

function stopRouteAlarm(key) {
  const timer = routeAlarms.get(key);
  if (!timer) return;
  window.clearInterval(timer);
  routeAlarms.delete(key);
}

// Each unacknowledged route keeps its own beep. Clicking that route's pill
// removes its key, and the other routes keep sounding.
function syncRouteAlarms(pending, settings) {
  const want = new Set(settings.sound ? pending.map(darkBusKey) : []);
  for (const key of routeAlarms.keys()) {
    if (!want.has(key)) stopRouteAlarm(key);
  }
  if (!settings.sound) return;
  for (const key of want) {
    if (routeAlarms.has(key)) continue;
    playAlertSound(key);
    routeAlarms.set(
      key,
      window.setInterval(() => playAlertSound(key), 1500)
    );
  }
}

function rememberDarkWatch(date = new Date()) {
  let watched = withPostedDrivers(watchedRuns());
  if (officeEarlyRelease()) {
    const clocks = new Map();
    for (const run of watched) {
      const route = String(run?.route || '').trim().toLowerCase();
      if (!route || clocks.has(route)) continue;
      const next = earlyPmClock(run.route);
      if (next) clocks.set(route, next);
    }
    watched = earlyReleaseWatch(watched, clocks).runs;
  }
  const baseLive = liveStatus(runs());
  const now = minutesNow(date);
  darkPowered = powerEventsByBus ? applyPowerOns(watched, powerEventsByBus, now) : watched;
  darkLive = powerEventsByBus
    ? { ...baseLive, ...sparePowerLive(watched, outOfService(), powerEventsByBus, now, boardDate(date)) }
    : baseLive;
  const covered = watchOutOfService(darkPowered, outOfService(), darkLive, boardDate(date));
  darkSkipped = skippedRoutes();
  const quiet = new Set(darkSkipped.map((item) => String(item.route || '').trim().toLowerCase()));
  darkWatch = covered
    .filter((run) => !quiet.has(String(run.route || '').trim().toLowerCase()))
    .map((run) => {
      const driver = regularDriverName(run.route) || String(run.driver || '').trim();
      return { ...run, driver, photo: driverPhotoSrc(driver) };
    });
  return date;
}

function refreshDarkBus(date = new Date()) {
  const settings = alertSettings();
  const now = minutesNow(date);
  const today = boardDate(date);
  const hadPending = pendingAlerts().length > 0;
  const started = startupDismissals(darkWatch, now, settings.graceMinutes, darkSkipped);
  if (started.length) {
    const keys = new Set(acknowledged());
    let added = false;
    for (const key of started) {
      if (keys.has(key)) continue;
      keys.add(key);
      added = true;
    }
    if (added) writeAcknowledged([...keys]);
  }
  const alerts = darkBuses(darkWatch, now, settings.graceMinutes, darkSkipped);
  const recorded = rememberAlertTimes(readJson(ALERTED_KEY, null), alerts, now, today);
  if (JSON.stringify(readJson(ALERTED_KEY, null)) !== JSON.stringify(recorded)) writeJson(ALERTED_KEY, recorded);
  const log = darkBusLog(darkPowered, outOfService(), darkLive, now, settings.graceMinutes, acknowledged(), darkSkipped, today);
  paintAlert(withAlertedAt(alerts, recorded), settings, log, now);
  if (hadPending && !pendingAlerts().length && darkPageForced) closeDarkPage();
}

function syncBoardFlash() {
  const live = Boolean(alertButton?.classList.contains('is-live') || studentButton?.classList.contains('is-live'));
  boardTitle?.classList.toggle('is-dark-flash', live);
}

let studentAnnounced = new Set();
let latestStudentAlerts = [];
let paintedStudentPills = '';
let studentWatch = [];
let pinnedStudentTab = '';
let pinnedStudentDuring = '';
let studentPageForced = false;
let studentPageClosed = false;
const studentAlarms = new Map();

function studentSettings() {
  return normalizeStudentCheckAlert(readJson(STUDENT_ALERT_KEY, null));
}

function studentVisits(date = new Date()) {
  const saved = readJson(STUDENT_VISIT_KEY, null);
  if (!saved || saved.date !== boardDate(date) || !Array.isArray(saved.keys)) return [];
  return saved.keys;
}

function rememberStudentVisits(runs, now, zones, date = new Date()) {
  const next = studentCheckSchoolVisits(runs, now, zones, studentVisits(date));
  const prev = studentVisits(date);
  if (next.length !== prev.length || next.some((key, index) => key !== prev[index])) {
    writeJson(STUDENT_VISIT_KEY, { date: boardDate(date), keys: next });
  }
  return next;
}

function studentReturns(date = new Date()) {
  const saved = readJson(STUDENT_RETURN_KEY, null);
  if (!saved || saved.date !== boardDate(date) || !Array.isArray(saved.returns)) return [];
  return saved.returns;
}

function rememberStudentReturns(runs, now, zones, schoolKeys, date = new Date()) {
  const next = studentCheckYardReturns(runs, now, zones, schoolKeys, studentReturns(date));
  const prev = studentReturns(date);
  const same =
    next.length === prev.length &&
    next.every((item, index) => item.key === prev[index]?.key && item.at === prev[index]?.at);
  if (!same) writeJson(STUDENT_RETURN_KEY, { date: boardDate(date), returns: next });
  return next;
}

function studentAcknowledged() {
  const saved = readJson(STUDENT_ACK_KEY, null);
  if (!saved || saved.date !== boardDate() || !Array.isArray(saved.keys)) return [];
  return saved.keys;
}

function writeStudentAcknowledged(keys) {
  writeJson(STUDENT_ACK_KEY, { date: boardDate(), keys });
}

function acknowledgeStudentRoute(key) {
  const routeKey = String(key || '');
  if (!routeKey) return;
  stopStudentAlarm(routeKey);
  const acked = new Set(studentAcknowledged());
  if (acked.has(routeKey)) return;
  acked.add(routeKey);
  writeStudentAcknowledged([...acked]);
}

function stopStudentAlarm(key) {
  const timer = studentAlarms.get(key);
  if (!timer) return;
  window.clearInterval(timer);
  studentAlarms.delete(key);
}

function syncStudentAlarms(pending, settings) {
  const want = new Set(settings.sound ? pending.map(studentCheckKey) : []);
  for (const key of studentAlarms.keys()) {
    if (!want.has(key)) stopStudentAlarm(key);
  }
  if (!settings.sound) return;
  for (const key of want) {
    if (studentAlarms.has(key)) continue;
    playAlertSound(`student:${key}`);
    studentAlarms.set(
      key,
      window.setInterval(() => playAlertSound(`student:${key}`), 1500)
    );
  }
}

function shownStudentTab(now, screenSettings) {
  const scheduled = studentCheckScreen(now, screenSettings);
  if (pinnedStudentTab && pinnedStudentDuring === scheduled) return pinnedStudentTab;
  pinnedStudentTab = '';
  pinnedStudentDuring = '';
  return scheduled;
}

const STUDENT_CHECK_PATH = '/the-board/studentcheck';

function isStudentCheckPath() {
  return cleanPath(location.pathname) === STUDENT_CHECK_PATH;
}

function openStudentPage(address = 'push') {
  const manager = document.querySelector('#oos-manager');
  if (manager) manager.hidden = true;
  const editor = document.querySelector('#absent-editor');
  if (editor) editor.hidden = true;
  if (darkPage) darkPage.hidden = true;
  document.body.classList.remove('is-dark-open');
  if (studentPage) studentPage.hidden = false;
  document.body.classList.add('is-student-open');
  document.title = 'Student Check Alerts';
  setScreenAddress(STUDENT_CHECK_PATH, address);
}

function closeStudentPage(address = 'push') {
  studentPageForced = false;
  studentPageClosed = true;
  if (studentPage) studentPage.hidden = true;
  document.body.classList.remove('is-student-open');
  if (!darkPage || darkPage.hidden) document.title = 'The Board';
  setScreenAddress(BOARD_PATH, address);
}

function paintStudentPage(now, settings, context) {
  const screenSettings = darkScreenSettings();
  const scheduled = studentCheckScreen(now, screenSettings);
  const tab = shownStudentTab(now, screenSettings);
  for (const button of document.querySelectorAll('[data-student-tab]')) {
    const on = button.dataset.studentTab === tab;
    button.setAttribute('aria-selected', on ? 'true' : 'false');
    button.tabIndex = on ? 0 : -1;
  }
  if (studentPills) studentPills.setAttribute('aria-labelledby', `student-tab-${tab.toLowerCase()}`);
  if (studentNote) studentNote.textContent = studentCheckSwitchNote(tab, scheduled, screenSettings);
  const markup = studentCheckPageMarkup(studentWatch, {
    nowMinutes: now,
    graceMinutes: settings.graceMinutes,
    tab,
    ...context,
  });
  if (studentPills && markup !== paintedStudentPills) {
    paintedStudentPills = markup;
    studentPills.innerHTML = markup;
  }
}

function paintStudentAlert(alerts, settings, context, now) {
  latestStudentAlerts = alerts;
  const ackedSet = new Set(studentAcknowledged());
  const pending = alerts.filter((alert) => !ackedSet.has(studentCheckKey(alert)));
  const fresh = pending.filter((alert) => !studentAnnounced.has(studentCheckKey(alert)));
  studentAnnounced = new Set(alerts.map(studentCheckKey));
  const reds = studentCheckPills(studentWatch, now, settings.graceMinutes, { ...context, acknowledged: [...ackedSet] }).filter(
    (pill) => pill.tone === 'dark'
  );
  if (studentCountEl) {
    studentCountEl.hidden = reds.length === 0;
    studentCountEl.textContent = String(reds.length);
  }
  studentButton?.classList.toggle('is-live', reds.length > 0);
  studentTitle?.classList.toggle('is-dark-flash', reds.length > 0);
  syncBoardFlash();
  if (fresh.length) {
    studentPageClosed = false;
    const lines = fresh.map((alert) => {
      const who = alert.route ? `Route ${alert.route}` : alert.bus ? `Bus ${alert.bus}` : 'A route';
      const facts = studentCheckPillFacts(alert, now);
      console.info(`[Student Check] ${studentCheckAlarmStatement(alert, settings.graceMinutes)} ${facts.join('. ')}.`);
      return `${who}. ${facts.join('. ')}.`;
    });
    setNamedStatus(studentStatus, lines.join(' '));
  }
  const pageHidden = !studentPage || studentPage.hidden;
  const coverHolding = Boolean(settings.cover) && pending.length > 0;
  const darkOpen = Boolean(darkPage && !darkPage.hidden);
  if (pending.length && pageHidden && !studentPageClosed && !darkBlockersOpen() && !darkOpen && (coverHolding || fresh.length)) {
    studentPageForced = true;
    openStudentPage('replace');
  } else if (studentPageForced && !pending.length && studentPage && !studentPage.hidden) {
    closeStudentPage('replace');
  }
  if (studentPage && !studentPage.hidden) paintStudentPage(now, settings, { ...context, acknowledged: [...ackedSet] });
  const pageOpen = Boolean(studentPage && !studentPage.hidden);
  if (fresh.length && settings.flash && !(coverHolding && pageOpen)) flashScreen();
  syncStudentAlarms(pending, settings);
  const anyFlashing = reds.length > 0;
  studentPage?.classList.toggle('is-alarming', anyFlashing && Boolean(settings.flash) && pageOpen);
  if (!anyFlashing && !alertButton?.classList.contains('is-live')) document.body.classList.remove('is-flashing');
}

function rememberStudentWatch(date = new Date()) {
  let watched = withRouteNotes(withPostedDrivers(watchedRuns()));
  if (officeEarlyRelease()) {
    const clocks = new Map();
    for (const run of watched) {
      const route = String(run?.route || '').trim().toLowerCase();
      if (!route || clocks.has(route)) continue;
      const next = earlyPmClock(run.route);
      if (next) clocks.set(route, next);
    }
    watched = earlyReleaseWatch(watched, clocks).runs;
  }
  const covered = watchOutOfService(watched, outOfService(), liveStatus(runs()), boardDate(date));
  studentWatch = covered.map((run) => {
    const driver = regularDriverName(run.route) || String(run.driver || '').trim();
    return { ...run, driver, photo: driverPhotoSrc(driver) };
  });
  return date;
}

function studentContext(visits, returns) {
  return {
    visits,
    returns,
    checks: studentChecksByRun(studentWatch, studentInspections || []),
    inspectionsKnown: studentInspections != null,
  };
}

function refreshStudentCheck(date = new Date(), visits = studentVisits(date), returns = studentReturns(date)) {
  const settings = studentSettings();
  const now = minutesNow(date);
  const context = studentContext(visits, returns);
  const hadPending = pendingStudentAlerts().length > 0;
  const alerts = studentCheckAlerts(studentWatch, now, settings.graceMinutes, context);
  paintStudentAlert(alerts, settings, context, now);
  if (hadPending && !pendingStudentAlerts().length && studentPageForced) closeStudentPage();
}

function pendingStudentAlerts() {
  const acked = new Set(studentAcknowledged());
  return latestStudentAlerts.filter((alert) => !acked.has(studentCheckKey(alert)));
}

function fillStudentForm() {
  const settings = studentSettings();
  if (studentGraceInput) studentGraceInput.value = String(settings.graceMinutes);
  if (studentSoundInput) studentSoundInput.checked = settings.sound;
  if (studentFlashInput) studentFlashInput.checked = settings.flash;
  if (studentCoverInput) studentCoverInput.checked = settings.cover;
  paintStudentMute();
}

function paintStudentMute() {
  const button = document.querySelector('#student-check-mute');
  if (!button) return;
  const muted = !studentSettings().sound;
  button.setAttribute('aria-pressed', muted ? 'true' : 'false');
  button.textContent = muted ? 'Unmute Alerts' : 'Mute Alerts';
}

function saveStudentSettings() {
  const next = normalizeStudentCheckAlert({
    ...studentSettings(),
    graceMinutes: Number(studentGraceInput?.value),
    sound: Boolean(studentSoundInput?.checked),
    flash: Boolean(studentFlashInput?.checked),
    cover: Boolean(studentCoverInput?.checked),
  });
  writeJson(STUDENT_ALERT_KEY, next);
  if (document.activeElement !== studentGraceInput && studentGraceInput) {
    studentGraceInput.value = String(next.graceMinutes);
  }
  paintBoard();
  paintStudentMute();
  setNamedStatus(studentConfigStatus, 'Saved.');
}

function tryCloseStudentPage() {
  if (studentSettings().cover && pendingStudentAlerts().length) {
    setNamedStatus(studentStatus, 'Click a flashing route to stop its alarm.');
    return;
  }
  closeStudentPage();
  refreshStudentCheck();
}

function withRouteNotes(runs) {
  return (runs || []).map((run) => {
    if (String(run?.note || '').trim()) return run;
    const note = routeProfile(run?.route)?.note;
    return note ? { ...run, note } : run;
  });
}

function paintBoard(date = new Date()) {
  const now = minutesNow(date);
  const today = boardDate(date);
  if (oosList) oosList.innerHTML = outOfServiceMarkup(outOfService(), today);
  paintOosManager();
  absentList.innerHTML = absenceMarkup(absencesForDate(absences(), today), {
    routes: routeCatalog(),
  });
  paintAbsenceEditor();
  const watched = withRouteNotes(withPostedDrivers(watchedRuns()));
  const left = rememberSchoolVisits(watched, now, busZones, date);
  const returns = rememberYardReturns(watched, now, busZones, left, date);
  availableList.innerHTML = availableMarkup(availableDrivers(watched, now, busZones, left, earlyMinutes(), returns));
  paintClock(date);
  rememberDarkWatch(date);
  refreshDarkBus(date);
  rememberStudentWatch(date);
  const studentLeft = rememberStudentVisits(studentWatch, now, busZones, date);
  const studentBack = rememberStudentReturns(studentWatch, now, busZones, studentLeft, date);
  refreshStudentCheck(date, studentLeft, studentBack);
}

function fillRememberedNames() {
  const list = document.querySelector('#absent-names');
  if (!list) return;
  list.innerHTML = rememberedNames(roster())
    .map((name) => `<option value="${escapeAttr(name)}"></option>`)
    .join('');
}

function escapeText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

function setNamedStatus(el, message) {
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
}

function fillSettingsForm() {
  const settings = alertSettings();
  if (graceInput) graceInput.value = String(settings.graceMinutes);
  if (midAtInput) midAtInput.value = settings.midAt;
  if (pmAtInput) pmAtInput.value = settings.pmAt;
  if (soundInput) soundInput.checked = settings.sound;
  if (flashInput) flashInput.checked = settings.flash;
  if (coverInput) coverInput.checked = settings.cover;
  paintMuteButton();
}

function paintMuteButton() {
  const button = document.querySelector('#dark-bus-mute');
  if (!button) return;
  const muted = !alertSettings().sound;
  button.setAttribute('aria-pressed', muted ? 'true' : 'false');
  button.textContent = muted ? 'Unmute Alerts' : 'Mute Alerts';
}

function paintAvailableSheet() {
  if (!availableBusSheetEl) return;
  availableBusSheetEl.innerHTML = availableBusSheetMarkup(availableBusSheet(routeBuses(), routeSchedules()));
}

function changedAvailableAssignments() {
  const inputs = [...document.querySelectorAll('#available-bus-sheet input[data-route]')];
  const groups = new Map();
  for (const input of inputs) {
    const route = input.dataset.route || '';
    if (!groups.has(route)) groups.set(route, []);
    groups.get(route).push({
      route,
      run: input.dataset.run,
      bus: input.value,
      original: input.dataset.original || '',
    });
  }
  const assignments = [];
  for (const cells of groups.values()) {
    if (!cells.some((cell) => cell.bus.trim() !== cell.original.trim())) continue;
    for (const cell of cells) assignments.push({ route: cell.route, run: cell.run, bus: cell.bus });
  }
  return assignments;
}

function pendingAlerts() {
  const acked = new Set(acknowledged());
  return latestAlerts.filter((alert) => !acked.has(darkBusKey(alert)));
}

document.querySelector('#dark-bus-page')?.addEventListener('click', (event) => {
  const pill = event.target.closest('[data-dark-key]');
  if (pill) {
    acknowledgeRoute(pill.dataset.darkKey);
    const route = pill.querySelector('.board-dark-route')?.textContent || 'That route';
    setNamedStatus(spareStatus, `${route} is quiet. It stays red until the bus powers on.`);
    refreshDarkBus();
    return;
  }
  const tab = event.target.closest('[data-dark-tab]');
  if (!tab) return;
  const settings = darkScreenSettings();
  const now = minutesNow();
  const scheduled = darkBusScreen(now, settings);
  const choice = tab.dataset.darkTab || '';
  if (choice === scheduled) {
    pinnedDarkTab = '';
    pinnedDuring = '';
  } else {
    pinnedDarkTab = choice;
    pinnedDuring = scheduled;
  }
  refreshDarkBus();
});

function tryCloseDarkPage() {
  if (alertSettings().cover && pendingAlerts().length) {
    setNamedStatus(spareStatus, 'Click a flashing route to stop its alarm.');
    return;
  }
  closeDarkPage();
  refreshDarkBus();
}

alertButton?.addEventListener('click', () => {
  if (darkPage && !darkPage.hidden) {
    tryCloseDarkPage();
    return;
  }
  darkPageClosed = false;
  darkPageForced = false;
  openDarkPage();
  refreshDarkBus();
});

document.querySelector('#dark-bus-close')?.addEventListener('click', () => {
  tryCloseDarkPage();
});

document.body.addEventListener('animationend', (event) => {
  if (event.target === document.body && event.animationName === 'board-dark-flash') {
    document.body.classList.remove('is-flashing');
  }
});

function saveDarkSettings() {
  const midAt = midAtInput?.value || '';
  const pmAt = pmAtInput?.value || '';
  if (!midAt || !pmAt || midAt >= pmAt) {
    setNamedStatus(configStatus, 'MID has to start before PM.');
    return;
  }
  const before = darkBusScreen(minutesNow(), darkScreenSettings());
  const next = normalizeDarkBusAlert({
    ...alertSettings(),
    graceMinutes: Number(graceInput?.value),
    midAt,
    pmAt,
    sound: Boolean(soundInput?.checked),
    flash: Boolean(flashInput?.checked),
    cover: Boolean(coverInput?.checked),
  });
  writeJson(ALERT_KEY, next);
  if (document.activeElement !== graceInput && graceInput) graceInput.value = String(next.graceMinutes);
  if (before !== darkBusScreen(minutesNow(), darkScreenSettings())) {
    pinnedDarkTab = '';
    pinnedDuring = '';
  }
  paintBoard();
  paintMuteButton();
  setNamedStatus(configStatus, 'Saved.');
}

document.querySelector('#dark-bus-mute')?.addEventListener('click', () => {
  const next = normalizeDarkBusAlert({ ...alertSettings(), sound: !alertSettings().sound });
  writeJson(ALERT_KEY, next);
  if (soundInput) soundInput.checked = next.sound;
  paintMuteButton();
  refreshDarkBus();
});

document.querySelector('#dark-bus-config-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  saveDarkSettings();
});

document.querySelector('#dark-bus-config-form')?.addEventListener('change', () => {
  saveDarkSettings();
});

document.querySelector('#student-check-page')?.addEventListener('click', (event) => {
  const pill = event.target.closest('[data-student-key]');
  if (pill) {
    acknowledgeStudentRoute(pill.dataset.studentKey);
    const route = pill.querySelector('.board-dark-route')?.textContent || 'That route';
    setNamedStatus(studentStatus, `${route} is quiet. It stays red until Zonar has the Student Check.`);
    refreshStudentCheck();
    return;
  }
  const tab = event.target.closest('[data-student-tab]');
  if (!tab) return;
  const screenSettings = darkScreenSettings();
  const now = minutesNow();
  const scheduled = studentCheckScreen(now, screenSettings);
  const choice = tab.dataset.studentTab || '';
  if (choice === scheduled) {
    pinnedStudentTab = '';
    pinnedStudentDuring = '';
  } else {
    pinnedStudentTab = choice;
    pinnedStudentDuring = scheduled;
  }
  refreshStudentCheck();
});

studentButton?.addEventListener('click', () => {
  if (studentPage && !studentPage.hidden) {
    tryCloseStudentPage();
    return;
  }
  studentPageClosed = false;
  studentPageForced = false;
  openStudentPage();
  refreshStudentCheck();
});

document.querySelector('#student-check-close')?.addEventListener('click', () => {
  tryCloseStudentPage();
});

document.querySelector('#student-check-mute')?.addEventListener('click', () => {
  const next = normalizeStudentCheckAlert({ ...studentSettings(), sound: !studentSettings().sound });
  writeJson(STUDENT_ALERT_KEY, next);
  if (studentSoundInput) studentSoundInput.checked = next.sound;
  paintStudentMute();
  refreshStudentCheck();
});

document.querySelector('#student-check-config-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  saveStudentSettings();
});

document.querySelector('#student-check-config-form')?.addEventListener('change', () => {
  saveStudentSettings();
});

function applyAbsenceMode(mode) {
  absenceMode = mode === 'calendar' ? 'calendar' : 'today';
  const panel = document.querySelector('#absent-calendar-panel');
  if (panel) panel.hidden = absenceMode !== 'calendar';
  const chosen = absentForm?.querySelector(`input[name="absent-span"][value="${absenceMode}"]`);
  if (chosen) chosen.checked = true;
  const submit = document.querySelector('#absent-submit');
  const title = document.querySelector('#absent-dialog-title');
  if (submit) submit.textContent = absenceEdit ? 'Save' : 'Put on the board';
  if (title) title.textContent = absenceDialogTitle();
  paintCalendar();
}

function absencePlanDays() {
  return Object.keys(absencePlan)
    .filter((day) => (absencePlan[day] || []).length)
    .sort();
}

function planFromSchedule(schedule) {
  const plan = {};
  for (const item of schedule || []) {
    const parts = absencePortions(item?.when);
    if (!item?.date || !parts.length) continue;
    plan[item.date] = absencePortions([...(plan[item.date] || []), ...parts]);
  }
  return plan;
}

function seedAbsencePlan(days, when) {
  const portions = absencePortions(when);
  const seed = days.length ? days : [boardDate()];
  absencePlan = {};
  if (!portions.length) return;
  for (const day of seed) absencePlan[day] = [...portions];
}

function freshAbsenceAuto() {
  return { AM: { bus: false, route: false }, MID: { bus: false, route: false }, PM: { bus: false, route: false } };
}

function portionRow(portion) {
  return document.querySelector(`#absent-portions [data-absence-portion="${portion}"]`);
}

function portionField(portion, field) {
  return portionRow(portion)?.querySelector(`[data-absence-field="${field}"]`);
}

function absencePortionFields() {
  return ABSENCE_PARTS.map((portion) => ({
    portion,
    bus: portionField(portion, 'bus')?.value || '',
    route: portionField(portion, 'route')?.value || '',
  }));
}

function filledPortionIds() {
  return absencePortionFields()
    .filter((row) => row.bus.trim() || row.route.trim())
    .map((row) => row.portion);
}

function absenceEntryKind() {
  return absentForm?.querySelector('input[name="absent-entry"]:checked')?.value === 'note' ? 'note' : 'student';
}

function absenceDialogTitle(note = absenceEntryKind() === 'note') {
  if (absenceEdit) return note ? 'Edit note' : 'Edit absence';
  return note ? 'Board note' : 'Absent student';
}

function applyAbsenceEntry(kind) {
  const note = kind === 'note';
  const chosen = absentForm?.querySelector(`input[name="absent-entry"][value="${note ? 'note' : 'student'}"]`);
  if (chosen) chosen.checked = true;
  const caption = document.querySelector('#absent-name-caption');
  if (caption) caption.textContent = note ? 'Note' : 'Student';
  const input = document.querySelector('#absent-name');
  if (input) {
    input.placeholder = note ? 'Note for this route' : '';
    if (note) input.removeAttribute('list');
    else input.setAttribute('list', 'absent-names');
  }
  const title = document.querySelector('#absent-dialog-title');
  if (title) title.textContent = absenceDialogTitle(note);
}

function fillAbsencePair(portion, source) {
  const routeInput = portionField(portion, 'route');
  const busInput = portionField(portion, 'bus');
  const auto = absenceAuto[portion];
  if (!routeInput || !busInput || !auto) return;
  if (source === 'route') {
    auto.route = false;
    const bus = pairedAbsenceBus(routeCatalog(), routeBuses(), routeInput.value);
    if (bus) {
      busInput.value = bus;
      auto.bus = true;
    } else if (auto.bus) {
      busInput.value = '';
      auto.bus = false;
    }
    return;
  }
  auto.bus = false;
  const route = pairedAbsenceRoute(routeCatalog(), routeBuses(), busInput.value);
  if (route) {
    routeInput.value = route;
    auto.route = true;
  } else if (auto.route) {
    routeInput.value = '';
    auto.route = false;
  }
}

function copyAmPortion(portion) {
  const amBus = portionField('AM', 'bus')?.value.trim() || '';
  const amRoute = portionField('AM', 'route')?.value.trim() || '';
  const busInput = portionField(portion, 'bus');
  const routeInput = portionField(portion, 'route');
  if (!busInput || !routeInput) return;
  if (!amBus && !amRoute) {
    setNamedStatus(absentFormStatus, 'Fill AM first.');
    return;
  }
  if (busInput.value.trim() || routeInput.value.trim()) return;
  busInput.value = amBus;
  routeInput.value = amRoute;
  absenceAuto[portion] = { bus: false, route: false };
  setNamedStatus(absentFormStatus, '');
}

function fillPortionRows(schedule, { onlyEmpty = false } = {}) {
  const picked = {};
  for (const item of schedule || []) {
    for (const portion of absencePortions(item?.when)) {
      if (!picked[portion]) picked[portion] = item.route;
    }
  }
  for (const portion of ABSENCE_PARTS) {
    const routeInput = portionField(portion, 'route');
    const busInput = portionField(portion, 'bus');
    if (!routeInput || !busInput) continue;
    if (onlyEmpty && (routeInput.value.trim() || busInput.value.trim())) continue;
    const route = picked[portion] || '';
    routeInput.value = route;
    const bus = route ? pairedAbsenceBus(routeCatalog(), routeBuses(), route) : '';
    busInput.value = bus;
    absenceAuto[portion] = { bus: Boolean(bus), route: false };
  }
}

function routesFromSchedule(schedule) {
  return [...new Set((schedule || []).map((item) => item.route).filter(Boolean))];
}

function showCalendarPlan() {
  const typedName = document.querySelector('#absent-name')?.value || '';
  if (!absenceEdit && typedName.trim()) {
    const schedule = absenceSchedules(absences(), { name: typedName, kind: absenceEntryKind() });
    if (schedule.length) {
      absenceEdit = {
        name: schedule[0].name,
        kind: schedule[0].kind === 'note' ? 'note' : 'student',
        routes: routesFromSchedule(schedule),
      };
      absencePlan = planFromSchedule(schedule);
      fillPortionRows(schedule, { onlyEmpty: true });
    }
  }
  if (!absencePlanDays().length) seedAbsencePlan([boardDate()], filledPortionIds());
  const focus = absencePlanDays()[0] || boardDate();
  const [year, month] = focus.split('-').map(Number);
  if (year && month) {
    calendarYear = year;
    calendarMonth = month - 1;
  }
  applyAbsenceMode('calendar');
}

function paintCalendar() {
  const root = document.querySelector('#absent-cal');
  const title = document.querySelector('#absent-cal-title');
  const count = document.querySelector('#absent-day-count');
  if (title) {
    title.textContent = new Date(calendarYear, calendarMonth, 1).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }
  if (count) count.textContent = absenceDayLabel(absencePlanDays().length);
  if (!root) return;
  const today = boardDate();
  const heads = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
    .map((label) => `<span class="board-cal-dow">${label}</span>`)
    .join('');
  const boxes = calendarCells(calendarYear, calendarMonth, absencePlanDays())
    .map((cell) => {
      const portions = absencePlan[cell.date] || [];
      const allOn = ABSENCE_PARTS.every((part) => portions.includes(part));
      const choices = [
        { id: 'ALL', label: 'All', checked: allOn },
        ...ABSENCE_PARTS.map((part) => ({ id: part, label: part, checked: portions.includes(part) })),
      ];
      const periods = choices
        .map((choice) => {
          const checked = choice.checked ? 'checked' : '';
          return `<label class="board-cal-period"><input type="checkbox" data-absence-day="${cell.date}" data-absence-portion="${choice.id}" aria-label="${choice.label} on ${cell.date}" ${checked} /><span>${choice.label}</span></label>`;
        })
        .join('');
      const classes = [
        'board-cal-day',
        cell.inMonth ? '' : 'is-out',
        portions.length ? 'is-selected' : '',
        cell.date === today ? 'is-today' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<div class="${classes}"><span class="board-cal-num">${cell.day}</span><span class="board-cal-periods">${periods}</span></div>`;
    })
    .join('');
  root.innerHTML = heads + boxes;
}

function paintDaySelection(cell, day) {
  const portions = absencePlan[day] || [];
  cell?.classList.toggle('is-selected', portions.length > 0);
  const all = cell?.querySelector('input[data-absence-portion="ALL"]');
  if (all) all.checked = ABSENCE_PARTS.every((part) => portions.includes(part));
  for (const part of ABSENCE_PARTS) {
    const input = cell?.querySelector(`input[data-absence-portion="${part}"]`);
    if (input) input.checked = portions.includes(part);
  }
  const count = document.querySelector('#absent-day-count');
  if (count) count.textContent = absenceDayLabel(absencePlanDays().length);
}

function openAbsenceForm() {
  fillRememberedNames();
  absenceEdit = null;
  absenceAuto = freshAbsenceAuto();
  absencePlan = {};
  const today = new Date();
  calendarYear = today.getFullYear();
  calendarMonth = today.getMonth();
  absentForm?.reset();
  applyAbsenceEntry('student');
  setNamedStatus(absentFormStatus, '');
  applyAbsenceMode('today');
  absentDialog?.showModal();
  portionField('AM', 'bus')?.focus();
}

function openAbsenceEditor(id) {
  const row = absences().find((item) => item.id === id);
  if (!row) return;
  const schedule = absenceSchedules(absences(), row);
  fillRememberedNames();
  absenceEdit = {
    name: row.name,
    kind: row.kind === 'note' ? 'note' : 'student',
    routes: routesFromSchedule(schedule),
  };
  absenceAuto = freshAbsenceAuto();
  absencePlan = planFromSchedule(schedule);
  absentForm?.reset();
  applyAbsenceEntry(absenceEdit.kind);
  const nameInput = document.querySelector('#absent-name');
  if (nameInput) nameInput.value = row.name;
  fillPortionRows(schedule);
  setNamedStatus(absentFormStatus, '');
  showCalendarPlan();
  absentDialog?.showModal();
  nameInput?.focus();
}

function paintAbsenceEditor() {
  const editor = document.querySelector('#absent-editor');
  if (!editor || editor.hidden) return;
  const list = document.querySelector('#absent-editor-list');
  if (list) {
    list.innerHTML = absenceMarkup(absencesForDate(absences(), boardDate()), {
      routes: routeCatalog(),
      controls: true,
    });
  }
}

document.querySelector('#absent-add')?.addEventListener('click', openAbsenceForm);
document.querySelector('#absent-portions')?.addEventListener('input', (event) => {
  const row = event.target.closest?.('[data-absence-portion]');
  const field = event.target?.dataset?.absenceField;
  if (!row || !field) return;
  fillAbsencePair(row.dataset.absencePortion, field);
});
document.querySelector('#absent-portions')?.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-same-as-am]');
  const row = button?.closest?.('[data-absence-portion]');
  if (!row) return;
  copyAmPortion(row.dataset.absencePortion);
});

absentForm?.addEventListener('change', (event) => {
  if (event.target?.name === 'absent-entry') {
    applyAbsenceEntry(event.target.value === 'note' ? 'note' : 'student');
    return;
  }
  if (event.target?.name === 'absent-span') {
    if (event.target.value === 'calendar') showCalendarPlan();
    else applyAbsenceMode('today');
    return;
  }
  const box = event.target?.closest?.('input[data-absence-day]');
  if (!box) return;
  const day = box.dataset.absenceDay;
  const portion = box.dataset.absencePortion;
  if (portion === 'ALL') {
    if (box.checked) absencePlan[day] = [...ABSENCE_PARTS];
    else delete absencePlan[day];
  } else if (ABSENCE_PARTS.includes(portion)) {
    const current = new Set(absencePlan[day] || []);
    if (box.checked) current.add(portion);
    else current.delete(portion);
    const parts = ABSENCE_PARTS.filter((part) => current.has(part));
    if (parts.length) absencePlan[day] = parts;
    else delete absencePlan[day];
  }
  paintDaySelection(box.closest('.board-cal-day'), day);
});

document.querySelector('#absent-cal-prev')?.addEventListener('click', () => {
  calendarMonth -= 1;
  if (calendarMonth < 0) {
    calendarMonth = 11;
    calendarYear -= 1;
  }
  paintCalendar();
});

document.querySelector('#absent-cal-next')?.addEventListener('click', () => {
  calendarMonth += 1;
  if (calendarMonth > 11) {
    calendarMonth = 0;
    calendarYear += 1;
  }
  paintCalendar();
});

document.querySelector('#available-settings')?.addEventListener('click', () => {
  if (availableEarlyInput) availableEarlyInput.value = String(earlyMinutes());
  paintAvailableSheet();
  setNamedStatus(availableSettingsStatus, '');
  if (!availableSettingsDialog?.open) availableSettingsDialog?.showModal();
});

document.querySelector('#available-settings-cancel')?.addEventListener('click', () => availableSettingsDialog?.close());

document.querySelector('#available-settings-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const minutes = normalizeEarlyMinutes(availableEarlyInput?.value);
  const clocksFor = cachedClocks();
  try {
    const saved = assignRouteBuses(routeBuses(), changedAvailableAssignments(), clocksFor);
    const list = applyScheduleClocks(saved.list, clocksFor);
    writeJson(EARLY_KEY, { minutes });
    writeJson(ROUTE_BUS_KEY, list);
    paintBoard();
    if (saved.skipped.length) {
      paintAvailableSheet();
      setNamedStatus(availableSettingsStatus, `Saved. No start time for ${saved.skipped.join(', ')}.`);
      return;
    }
    availableSettingsDialog?.close();
  } catch (error) {
    setNamedStatus(availableSettingsStatus, error.message);
  }
});

document.querySelector('#absent-cancel')?.addEventListener('click', () => absentDialog?.close());

function clearNamedAbsences(list, { name, kind, routes }) {
  const found = routes?.length ? routes : routesFromSchedule(absenceSchedules(list, { name, kind }));
  return found.reduce(
    (next, route) =>
      replaceAbsenceSchedule(next, {
        name,
        route,
        dates: [],
        kind,
        previousName: name,
        previousRoute: route,
        previousKind: kind,
      }),
    list
  );
}

absentForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = document.querySelector('#absent-name')?.value || '';
  const kind = absenceEntryKind();
  const rows = absencePortionFields();
  const filled = filledPortionIds();
  const plan = absenceMode === 'today'
    ? (filled.length ? [{ date: boardDate(), when: filled }] : [])
    : absencePlanDays().map((date) => ({ date, when: absencePlan[date] || [] }));
  try {
    let nextAbsences = absences();
    let nextRoster = roster();
    if (!plan.length) {
      if (!absenceEdit) {
        throw new Error(absenceMode === 'today' ? 'Choose a bus or route for AM, mid day, or PM.' : 'Choose at least one day.');
      }
      nextAbsences = clearNamedAbsences(nextAbsences, absenceEdit);
      writeJson(ABSENCE_KEY, nextAbsences);
      writeJson(ROSTER_KEY, nextRoster);
      absentForm.reset();
      absentDialog?.close();
      paintBoard();
      return;
    }
    const grouped = new Map();
    for (const item of plan) {
      const posts = absencePortionPosts(routeCatalog(), routeBuses(), rows, item.when);
      for (const post of posts) {
        const days = grouped.get(post.route) || [];
        days.push({ date: item.date, when: post.when });
        grouped.set(post.route, days);
      }
    }
    if (absenceEdit) nextAbsences = clearNamedAbsences(nextAbsences, absenceEdit);
    for (const [postRoute, days] of grouped) {
      nextAbsences = postAbsenceDays(nextAbsences, { name, route: postRoute, days, kind });
      if (kind !== 'note') nextRoster = rememberStudent(nextRoster, { name, route: postRoute });
    }
    writeJson(ABSENCE_KEY, nextAbsences);
    writeJson(ROSTER_KEY, nextRoster);
    absentForm.reset();
    absentDialog?.close();
    paintBoard();
  } catch (error) {
    setNamedStatus(absentFormStatus, error.message);
  }
});

const SPARE_POOL_KEY = 'the-board-spare-pools';
const OOS_PORTIONS = ['AM', 'MID', 'PM'];
const oosSpareWarning = document.querySelector('#oos-spare-warning');
const oosDaysInput = document.querySelector('#oos-days');
const spareListsForm = document.querySelector('#spare-lists-form');
const spareListsDialog = document.querySelector('#spare-lists-dialog');
let oosDayPlan = {};
let oosEditId = '';
let oosCalYear = new Date().getFullYear();
let oosCalMonth = new Date().getMonth();

function routeWheelchairs() {
  return readJson(ROUTE_WC_KEY, {});
}

function busToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^0+(?=\d)/, '');
}

function routesForUsualBus(bus) {
  const key = busToken(bus);
  const names = [];
  if (!key) return names;
  for (const row of routeBuses()) {
    if (busToken(row?.bus) !== key) continue;
    const route = String(row?.route || '').trim();
    if (route && !names.some((name) => name.toLowerCase() === route.toLowerCase())) names.push(route);
  }
  return names;
}

function postedSparePools() {
  return {
    sped: POSTED_SPED_SPARES.map((row) => ({ bus: row.route, kind: row.spare })),
    reg: POSTED_REG_ED_SPARES.map((row) => ({ bus: row.bus, kind: row.kind })),
  };
}

function sparePools() {
  return normalizeSparePools(readJson(SPARE_POOL_KEY, null), postedSparePools());
}

function writeSparePools(pools) {
  writeJson(SPARE_POOL_KEY, normalizeSparePools(pools, postedSparePools()));
}

function readSpareEditor() {
  const read = (id) =>
    [...document.querySelectorAll(`#${id} .board-spare-edit`)].map((row) => ({
      bus: row.querySelector('[data-spare-field="bus"]')?.value || '',
      kind: row.querySelector('[data-spare-field="kind"]')?.value || '',
    }));
  const sped = document.querySelector('#spare-list-sped');
  if (!sped?.querySelector('.board-spare-edit, [data-spare-add]')) return sparePools();
  return { sped: read('spare-list-sped'), reg: read('spare-list-reg') };
}

function routeIsSped(route) {
  if (isSpedRoute(route)) return true;
  return isSpedRoute(routeProfile(route)?.name || '');
}

function spareBusChoices() {
  const pools = sparePools();
  const seen = new Set();
  const choices = [];
  const push = (bus, kind, group) => {
    const key = busToken(bus);
    if (!key || seen.has(key)) return;
    seen.add(key);
    choices.push({ bus: String(bus).trim(), kind: String(kind || '').trim(), group });
  };
  for (const row of pools.sped || []) push(row.bus, row.kind, 'Sped spare buses');
  for (const row of pools.reg || []) push(row.bus, row.kind, 'Reg ed spares');
  return choices;
}

function spareOptionMarkup(selected, { mixed = false } = {}) {
  const want = busToken(selected);
  const choices = spareBusChoices();
  if (want && !choices.some((choice) => busToken(choice.bus) === want) && selected !== '__mixed__') {
    choices.push({ bus: String(selected).trim(), kind: '', group: 'Other bus' });
  }
  const groups = new Map();
  for (const choice of choices) {
    const list = groups.get(choice.group) || [];
    list.push(choice);
    groups.set(choice.group, list);
  }
  const option = (bus, label, picked) =>
    `<option value="${escapeAttr(bus)}"${picked ? ' selected' : ''}>${escapeText(label)}</option>`;
  const mixedOption = mixed ? option('__mixed__', 'Different spares', true) : '';
  const blank = option('', 'No spare', !mixed && !want);
  const body = [...groups.entries()]
    .map(([label, list]) => {
      const items = list
        .map((choice) => option(choice.bus, choice.kind ? `${choice.bus} · ${choice.kind}` : choice.bus, !mixed && busToken(choice.bus) === want))
        .join('');
      return `<optgroup label="${escapeAttr(label)}">${items}</optgroup>`;
    })
    .join('');
  return `${mixedOption}${blank}${body}`;
}

function readOosSpares() {
  return portionSpareMap({
    AM: document.querySelector('#oos-spare-am')?.value || '',
    MID: document.querySelector('#oos-spare-mid')?.value || '',
    PM: document.querySelector('#oos-spare-pm')?.value || '',
  });
}

function paintOosPortions(map = readOosSpares()) {
  const spares = portionSpareMap(map);
  for (const portion of OOS_PORTIONS) {
    const select = document.querySelector(`#oos-spare-${portion.toLowerCase()}`);
    if (select) select.innerHTML = spareOptionMarkup(spares[portion]);
  }
  const all = document.querySelector('#oos-spare-all');
  if (!all) return;
  const same = OOS_PORTIONS.every((portion) => busToken(spares[portion]) === busToken(spares.AM));
  all.innerHTML = spareOptionMarkup(same ? spares.AM : '', { mixed: !same });
}

function oosDayMode() {
  return oosForm?.querySelector('input[name="oos-days-mode"]:checked')?.value === 'calendar' ? 'calendar' : 'same';
}

function setOosDayMode(mode) {
  const calendar = mode === 'calendar';
  const chosen = oosForm?.querySelector(`input[name="oos-days-mode"][value="${calendar ? 'calendar' : 'same'}"]`);
  if (chosen) chosen.checked = true;
  const panel = document.querySelector('#oos-calendar-panel');
  if (panel) panel.hidden = !calendar;
  if (!calendar) oosDayPlan = {};
  paintOosCalendar();
  if (calendar && oosDialog?.open) document.querySelector('#oos-cal-back')?.focus();
}

function sparesMatch(left, right) {
  const a = portionSpareMap(left);
  const b = portionSpareMap(right);
  return OOS_PORTIONS.every((portion) => busToken(a[portion]) === busToken(b[portion]));
}

function paintOosCalendar() {
  const root = document.querySelector('#oos-cal');
  const title = document.querySelector('#oos-cal-title');
  if (title) {
    title.textContent = new Date(oosCalYear, oosCalMonth, 1).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }
  if (!root || oosDayMode() !== 'calendar') return;
  const pattern = readOosSpares();
  const today = boardDate();
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const boxes = calendarCells(oosCalYear, oosCalMonth, Object.keys(oosDayPlan))
    .map((cell, index) => {
      const weekday = index % 7;
      const custom = Boolean(oosDayPlan[cell.date]);
      const spares = portionSpareMap(custom ? oosDayPlan[cell.date] : pattern);
      const same = OOS_PORTIONS.every((portion) => busToken(spares[portion]) === busToken(spares.AM));
      const field = (portion, label) =>
        `<label class="board-cal-period">${label}<select data-oos-day="${cell.date}" data-oos-portion="${portion}" aria-label="${label} spare on ${cell.date}">${spareOptionMarkup(portion === 'ALL' ? (same ? spares.AM : '') : spares[portion], { mixed: portion === 'ALL' && !same })}</select></label>`;
      const periods = [field('ALL', 'All'), field('AM', 'AM'), field('MID', 'MID'), field('PM', 'PM')].join('');
      const usual = custom ? `<button type="button" class="board-oos-usual" data-oos-usual-day="${cell.date}">Usual</button>` : '';
      const classes = [
        'board-cal-day',
        `is-dow-${weekday}`,
        cell.inMonth ? '' : 'is-out',
        custom ? 'is-custom' : '',
        cell.date === today ? 'is-today' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<div class="${classes}"><span class="board-cal-date"><span class="board-cal-dow-name">${weekdayNames[weekday]}</span><span class="board-cal-num">${cell.day}</span>${usual}</span><span class="board-cal-periods">${periods}</span></div>`;
    })
    .join('');
  root.innerHTML = boxes;
}

function paintSpareLists() {
  const pools = sparePools();
  const sped = document.querySelector('#spare-list-sped');
  const reg = document.querySelector('#spare-list-reg');
  if (sped) sped.innerHTML = sparePoolMarkup(pools.sped, 'sped');
  if (reg) reg.innerHTML = sparePoolMarkup(pools.reg, 'reg');
}

const oosSpareEditing = { sped: false, reg: false };

function spareMenuRoot(pool) {
  return document.querySelector(pool === 'reg' ? '#oos-reg-spares' : '#oos-sped-spares');
}

function readSpareRows(root) {
  return [...(root?.querySelectorAll('.board-spare-edit') || [])].map((row) => ({
    bus: row.querySelector('[data-spare-field="bus"]')?.value || '',
    kind: row.querySelector('[data-spare-field="kind"]')?.value || '',
  }));
}

function readOosSpareEditor() {
  const stored = sparePools();
  const read = (pool) => {
    const root = spareMenuRoot(pool);
    if (!oosSpareEditing[pool] || !root?.querySelector('.board-spare-edit, [data-spare-add]')) return stored[pool];
    return readSpareRows(root);
  };
  return { sped: read('sped'), reg: read('reg') };
}

function selectedSpareBus() {
  const spares = readOosSpares();
  const same = OOS_PORTIONS.every((portion) => busToken(spares[portion]) === busToken(spares.AM));
  return same ? spares.AM : '';
}

function spareEditLabel(pool, editing) {
  const name = pool === 'reg' ? 'regular-ed spares' : 'sped spare buses';
  return editing ? `Done editing ${name}` : `Edit ${name}`;
}

function paintOosSparePool(pool) {
  const root = spareMenuRoot(pool);
  if (!root) return;
  const pools = sparePools();
  const editing = Boolean(oosSpareEditing[pool]);
  root.innerHTML = editing
    ? sparePoolMarkup(pools[pool], pool)
    : sparePoolChoiceMarkup(pools[pool], pool, selectedSpareBus());
  const button = oosForm?.querySelector(`[data-spare-edit="${pool}"]`);
  if (!button) return;
  const label = spareEditLabel(pool, editing);
  button.setAttribute('aria-pressed', editing ? 'true' : 'false');
  button.title = label;
  button.setAttribute('aria-label', label);
}

function paintOosSpareMenus() {
  for (const pool of ['sped', 'reg']) {
    if (oosSpareEditing[pool] && spareMenuRoot(pool)?.contains(document.activeElement)) continue;
    paintOosSparePool(pool);
  }
  paintMainFleet();
}

let mainFleetCache = null;

function currentMainFleet() {
  if (mainFleetCache) return mainFleetCache;
  const saved = routeBuses();
  const names = [];
  const seen = new Set();
  const addName = (route) => {
    const label = String(route || '').trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) return;
    seen.add(key);
    names.push(label);
  };
  for (const row of POSTED_ROUTE_BUSES) addName(row.route);
  for (const row of saved) addName(row.route);
  const portionsByRoute = {};
  for (const route of names) {
    const scheduled = (clocksForRoute(route).runs || []).map((item) => String(item.run || '').toUpperCase());
    const savedRuns = saved
      .filter((row) => String(row?.route || '').trim().toLowerCase() === route.toLowerCase())
      .map((row) => String(row?.run || '').toUpperCase());
    portionsByRoute[route] = OOS_PORTIONS.filter((run) => scheduled.includes(run) || savedRuns.includes(run));
  }
  mainFleetCache = mainFleetFromSheet(routeBusSheet(saved, names), portionsByRoute);
  return mainFleetCache;
}

function paintMainFleet() {
  const root = document.querySelector('#oos-fleet-spares');
  if (!root || root.contains(document.activeElement)) return;
  root.innerHTML = mainFleetMarkup(currentMainFleet(), selectedSpareBus());
}

function fleetWarningsFor(spares, fleet) {
  const grouped = new Map();
  for (const portion of OOS_PORTIONS) {
    const spare = String(spares?.[portion] || '').trim();
    if (!spare) continue;
    const key = busToken(spare);
    if (!grouped.has(key)) grouped.set(key, { bus: spare, portions: [] });
    const item = grouped.get(key);
    if (!item.portions.includes(portion)) item.portions.push(portion);
  }
  const warnings = [];
  for (const item of grouped.values()) warnings.push(...mainFleetWarnings({ bus: item.bus, portions: item.portions, fleet }));
  return warnings;
}

function shortFleetDay(day) {
  const [year, month, date] = String(day || '').split('-').map(Number);
  if (!year || !month || !date) return String(day || '');
  return new Date(year, month - 1, date).toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

function afterSparePoolChange() {
  paintOosManager(true);
  if (spareListsDialog?.open) paintSpareLists();
  if (!oosDialog?.open) return;
  syncOpenSpareMenus();
}

function syncOpenSpareMenus() {
  paintOosSpareMenus();
  paintOosPortions();
  if (oosDayMode() === 'calendar') paintOosCalendar();
  refreshSpareWarning();
}

function assignSpareToAllPortions(bus) {
  const value = String(bus || '').trim();
  const map = { AM: value, MID: value, PM: value };
  paintOosPortions(map);
  paintOosSpareMenus();
  if (oosDayMode() === 'calendar') paintOosCalendar();
  refreshOosConfirm();
  refreshSpareWarning();
}

function oosDuration() {
  const span = oosForm?.querySelector('input[name="oos-span"]:checked')?.value;
  if (span === 'indefinitely') return 'indefinitely';
  if (span === 'today') return 'today';
  if (span === 'days') return { days: Number(oosDaysInput?.value) };
  return null;
}

function syncOosDuration(focusDays = false) {
  const span = oosForm?.querySelector('input[name="oos-span"]:checked')?.value || '';
  if (oosDaysInput) oosDaysInput.disabled = span !== 'days';
  if (focusDays && span === 'days') oosDaysInput?.focus();
}

function usualBusContext(bus) {
  const routes = routesForUsualBus(bus);
  const route = routes.length === 1 ? routes[0] : '';
  const chairs = routes.reduce((max, name) => Math.max(max, routeWheelchairNeed(routeWheelchairs(), name) || 0), 0);
  return { route, routes, chairs, sped: routes.some((name) => isSpedRoute(name)) };
}

function refreshOosConfirm() {
  const line = document.querySelector('#oos-confirm');
  if (!line) return;
  line.textContent = spareAssignPrompt(readOosSpares(), document.querySelector('#oos-usual')?.value);
}

function refreshSpareWarning() {
  const spares = readOosSpares();
  const usual = document.querySelector('#oos-usual')?.value || '';
  const match = usualBusContext(usual);
  const pools = sparePools();
  const fleet = currentMainFleet();
  const fleetBuses = new Set(fleet.map((item) => busToken(item.bus)));
  const warnings = [];
  const seen = new Set();
  for (const portion of OOS_PORTIONS) {
    const spare = spares[portion];
    if (!spare || seen.has(busToken(spare))) continue;
    seen.add(busToken(spare));
    const lines = spareAssignmentWarnings({
      route: match.route,
      spare,
      assignments: routeBuses(),
      outOfService: [],
      sped: match.sped,
      spedSpares: pools.sped,
      regSpares: pools.reg,
      wheelchairsNeeded: match.chairs || '',
    });
    const kept = fleetBuses.has(busToken(spare)) ? lines.filter((line) => !line.includes('already assigned to route')) : lines;
    warnings.push(...kept);
  }
  warnings.push(...fleetWarningsFor(spares, fleet));
  if (oosDayMode() === 'calendar') {
    for (const [day, map] of Object.entries(oosDayPlan)) {
      const extra = fleetWarningsFor(portionSpareMap(map), fleet).filter((line) => !warnings.includes(line));
      for (const line of extra) warnings.push(line.replace(/\.$/, ` on ${shortFleetDay(day)}.`));
    }
  }
  const days = oosDayMode() === 'calendar' ? oosDayPlan : {};
  warnings.push(
    ...sparePortionWarnings({
      spares,
      days,
      outOfService: outOfService(),
      ignoreId: oosEditId,
      usualBus: usual,
    })
  );
  if (!oosSpareWarning) return;
  oosSpareWarning.hidden = warnings.length === 0;
  oosSpareWarning.textContent = warnings.join(' ');
}

let paintedOosManager = '';

function oosManagerOptions() {
  const pools = sparePools();
  return {
    sped: pools.sped,
    reg: pools.reg,
    spedRoutes: routeCatalog().filter((name) => routeIsSped(name)),
    wheelchairs: routeWheelchairs(),
  };
}

function paintOosManager(force = false) {
  const manager = document.querySelector('#oos-manager');
  if (!manager || manager.hidden) return;
  const view = outOfServiceManagerView(outOfService(), oosManagerOptions());
  const signature = JSON.stringify(view);
  if (!force && signature === paintedOosManager) return;
  paintedOosManager = signature;
  const summary = document.querySelector('#oos-manager-summary');
  const suggestions = document.querySelector('#oos-manager-suggestions');
  const buses = document.querySelector('#oos-manager-list');
  const spares = document.querySelector('#oos-manager-spares');
  if (summary) summary.textContent = view.summary;
  if (suggestions) suggestions.innerHTML = view.suggestions;
  if (buses) buses.innerHTML = view.buses;
  if (spares) spares.innerHTML = view.spares;
}

function openOosManager() {
  const manager = document.querySelector('#oos-manager');
  if (!manager) return;
  manager.hidden = false;
  paintOosManager();
  document.querySelector('#oos-manager-title')?.focus();
}

function closeOosManager() {
  const manager = document.querySelector('#oos-manager');
  if (manager) manager.hidden = true;
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-board-home]')) return;
  closeDarkPage();
  closeStudentPage();
  closeOosManager();
  const editor = document.querySelector('#absent-editor');
  if (editor) editor.hidden = true;
});

document.querySelector('#oos-manager-open')?.addEventListener('click', openOosManager);
document.querySelector('#oos-manager-close')?.addEventListener('click', closeOosManager);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (darkPage && !darkPage.hidden) {
    tryCloseDarkPage();
    return;
  }
  if (studentPage && !studentPage.hidden) {
    tryCloseStudentPage();
    return;
  }
  const manager = document.querySelector('#oos-manager');
  if (!manager || manager.hidden) return;
  closeOosManager();
});

document.querySelector('#oos-manager')?.addEventListener('change', (event) => {
  const assign = event.target.closest('[data-oos-assign]');
  const place = event.target.closest('[data-spare-place]');
  if (!assign && !place) return;
  if (place?.value === '__several__') return;
  try {
    const next = assign
      ? assignOutOfServiceSpare(outOfService(), assign.dataset.oosAssign, assign.value, assign.dataset.oosPortion || '')
      : placeOutOfServiceSpare(outOfService(), place.dataset.sparePlace, place.value);
    writeJson(OOS_KEY, next);
    setOosStatus('');
    paintBoard();
  } catch (error) {
    setOosStatus(error.message);
    paintOosManager(true);
  }
});

document.querySelector('#oos-manager')?.addEventListener('click', (event) => {
  const edit = event.target.closest('[data-oos-edit]');
  if (edit) {
    openOosEditor(edit.dataset.oosEdit);
    return;
  }
  if (event.target.closest('[data-oos-apply]')) {
    writeJson(OOS_KEY, applyOutOfServiceSpares(outOfService(), oosManagerOptions()));
    setOosStatus('');
    paintBoard();
    return;
  }
  const button = event.target.closest('[data-oos-id]');
  if (!button) return;
  writeJson(OOS_KEY, removeOutOfService(outOfService(), button.dataset.oosId));
  setOosStatus('Taken down.');
  paintBoard();
});

function paintOosEmailTemplate(settings = loadOutOfServiceNotice()) {
  const subject = document.querySelector('#oos-email-subject');
  const body = document.querySelector('#oos-email-body');
  if (subject) subject.value = settings.subject;
  if (body) body.value = settings.body;
}

function currentOosEmailTemplate() {
  return {
    subject: document.querySelector('#oos-email-subject')?.value || '',
    body: document.querySelector('#oos-email-body')?.value || '',
  };
}

function routesForBusNotice(usualBus, route) {
  if (route) return [route];
  const saved = routesForUsualBus(usualBus);
  if (saved.length) return saved;
  const key = busToken(usualBus);
  const names = [];
  for (const row of POSTED_ROUTE_BUSES) {
    if (busToken(row.bus) !== key) continue;
    const name = String(row.route || '').trim();
    if (name && !names.some((item) => item.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names;
}

function driversForOutOfService(usualBus, route) {
  const people = [];
  for (const name of routesForBusNotice(usualBus, route)) {
    const driverName = regularDriverName(name);
    if (!driverName) continue;
    if (people.some((item) => item.driverName.toLowerCase() === driverName.toLowerCase())) continue;
    const listed = listDrivers().find(
      (item) => sameDriver(item.name, driverName) || sameDriver(driverName, item.name)
    );
    people.push({ route: name, driverName, email: String(listed?.email || '').trim() });
  }
  return people;
}

function openBoardNotice(mail) {
  if (noticeMailFits(mail)) {
    const link = document.createElement('a');
    link.href = noticeMailto(mail);
    link.style.position = 'fixed';
    link.style.left = '-1000px';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return 'mailto';
  }
  const file = new Blob([noticeLetterEml(mail)], { type: 'message/rfc822' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = mail.filename || outOfServiceLetterFilename('');
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return 'eml';
}

function emailOutOfServiceDriver({ usualBus, spareBus, spares, days, route, covers, note }) {
  const people = driversForOutOfService(usualBus, route);
  const bus = String(usualBus || '').trim();
  if (!people.length) {
    return `No driver is assigned to bus ${bus}, so no email was opened.`;
  }
  if (people.length > 1) {
    const names = people.map((item) => item.driverName).join(', ');
    return `Bus ${bus} has more than one driver (${names}), so no email was opened.`;
  }
  const person = people[0];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email)) {
    return `Add an email for ${person.driverName} on the Driver Name List before sending a notice.`;
  }
  const template = saveOutOfServiceNotice(currentOosEmailTemplate());
  const mail = outOfServiceNoticeMail({
    ...template,
    driverName: person.driverName,
    usualBus: bus,
    spareBus,
    spares,
    days,
    routeName: person.route,
    covers,
    note,
    asOf: localDateString(new Date()),
  });
  const filename = outOfServiceLetterFilename(bus);
  const opened = openBoardNotice({
    to: person.email,
    subject: mail.subject,
    body: mail.body,
    filename,
  });
  const how = opened === 'eml' ? `Open ${filename} and Outlook shows the letter.` : 'Outlook has the letter.';
  return `Email for ${person.driverName} is ready. ${how}`;
}

function spareStatusPhrase(spares) {
  const map = portionSpareMap(spares);
  const same = OOS_PORTIONS.every((portion) => busToken(map[portion]) === busToken(map.AM));
  if (same) return map.AM ? `Spare ${map.AM} covers it` : 'No spare is assigned';
  return OOS_PORTIONS.map((portion) => (map[portion] ? `${portion} spare ${map[portion]}` : `${portion} has no spare`)).join(', ');
}

function openOosForm({ row = null } = {}) {
  oosEditId = row?.id || '';
  oosDayPlan = {};
  for (const [day, map] of Object.entries(row?.days || {})) oosDayPlan[day] = portionSpareMap(map);
  const today = new Date();
  const focus = Object.keys(oosDayPlan).sort()[0];
  if (focus) {
    const [year, month] = focus.split('-').map(Number);
    oosCalYear = year;
    oosCalMonth = month - 1;
  } else {
    oosCalYear = today.getFullYear();
    oosCalMonth = today.getMonth();
  }
  oosForm?.reset();
  const usual = document.querySelector('#oos-usual');
  const note = document.querySelector('#oos-note');
  if (usual) usual.value = row?.usualBus || '';
  if (note) note.value = row?.note || '';
  const span = row?.covers === 'indefinitely' ? 'indefinitely' : row?.covers === 'today' ? 'today' : Number(row?.covers) >= 1 ? 'days' : '';
  const spanInput = span ? oosForm?.querySelector(`input[name="oos-span"][value="${span}"]`) : null;
  if (spanInput) spanInput.checked = true;
  if (oosDaysInput && span === 'days') oosDaysInput.value = String(row.covers);
  syncOosDuration();
  const spares = portionSpareMap(row?.spares);
  if (row && !row.spares) {
    const spare = row.spareBus || '';
    spares.AM = !row.run || row.run === 'AM' ? spare : '';
    spares.MID = !row.run || row.run === 'MID' ? spare : '';
    spares.PM = !row.run || row.run === 'PM' ? spare : '';
  }
  oosSpareEditing.sped = false;
  oosSpareEditing.reg = false;
  mainFleetCache = null;
  paintOosPortions(spares);
  paintOosSpareMenus();
  setOosDayMode(Object.keys(oosDayPlan).length ? 'calendar' : 'same');
  paintOosEmailTemplate();
  refreshOosConfirm();
  refreshSpareWarning();
  setNamedStatus(oosFormStatus, '');
  setNamedStatus(document.querySelector('#oos-email-status'), '');
  const title = document.querySelector('#oos-dialog-title');
  if (title) title.textContent = row ? 'Update out of service' : 'Out of Service';
  oosDialog?.showModal();
  if (oosDayMode() === 'calendar') document.querySelector('#oos-cal-back')?.focus();
  else usual?.focus();
}

function openOosEditor(id) {
  const row = outOfService().find((item) => item.id === id);
  if (!row) return;
  openOosForm({ row });
}

document.querySelector('#oos-add')?.addEventListener('click', () => openOosForm());

document.querySelector('#oos-cancel')?.addEventListener('click', () => oosDialog?.close());

document.querySelector('#oos-cal-back')?.addEventListener('click', () => {
  const panel = document.querySelector('#oos-calendar-panel');
  if (panel) panel.hidden = true;
  oosForm?.querySelector('input[name="oos-days-mode"][value="calendar"]')?.focus();
});

document.querySelector('#oos-cal-prev')?.addEventListener('click', () => {
  oosCalMonth -= 1;
  if (oosCalMonth < 0) {
    oosCalMonth = 11;
    oosCalYear -= 1;
  }
  paintOosCalendar();
});

document.querySelector('#oos-cal-next')?.addEventListener('click', () => {
  oosCalMonth += 1;
  if (oosCalMonth > 11) {
    oosCalMonth = 0;
    oosCalYear += 1;
  }
  paintOosCalendar();
});

oosForm?.addEventListener('click', (event) => {
  if (event.target?.name === 'oos-days-mode' && event.target.value === 'calendar') {
    setOosDayMode('calendar');
    return;
  }
  const edit = event.target.closest('[data-spare-edit]');
  if (edit) {
    const pool = edit.dataset.spareEdit === 'reg' ? 'reg' : 'sped';
    if (oosSpareEditing[pool]) writeSparePools(readOosSpareEditor());
    oosSpareEditing[pool] = !oosSpareEditing[pool];
    paintOosSparePool(pool);
    afterSparePoolChange();
    return;
  }
  const add = event.target.closest('#oos-sped-spares [data-spare-add], #oos-reg-spares [data-spare-add]');
  if (add) {
    const pools = readOosSpareEditor();
    const pool = add.dataset.spareAdd === 'reg' ? 'reg' : 'sped';
    pools[pool] = [...pools[pool], { bus: '', kind: '' }];
    writeSparePools(pools);
    paintOosSparePool(pool);
    afterSparePoolChange();
    spareMenuRoot(pool)?.querySelector('.board-spare-edit:last-of-type [data-spare-field="bus"]')?.focus();
    return;
  }
  const remove = event.target.closest('#oos-sped-spares [data-spare-remove], #oos-reg-spares [data-spare-remove]');
  if (remove) {
    const row = remove.closest('.board-spare-edit');
    const pool = row?.parentElement?.id === 'oos-reg-spares' ? 'reg' : 'sped';
    const pools = readOosSpareEditor();
    const index = [...(row?.parentElement?.querySelectorAll('.board-spare-edit') || [])].indexOf(row);
    pools[pool] = pools[pool].filter((_, item) => item !== index);
    writeSparePools(pools);
    paintOosSparePool(pool);
    afterSparePoolChange();
    return;
  }
  const use = event.target.closest('#oos-sped-spares [data-spare-use], #oos-reg-spares [data-spare-use], #oos-fleet-spares [data-spare-use]');
  if (use) {
    const row = use.closest('.board-spare-edit');
    const bus = row?.querySelector('[data-spare-field="bus"]')?.value || use.dataset.spareUse || '';
    assignSpareToAllPortions(bus);
    return;
  }
  const usual = event.target.closest('[data-oos-usual-day]');
  if (!usual) return;
  delete oosDayPlan[usual.dataset.oosUsualDay];
  paintOosCalendar();
  refreshSpareWarning();
});

oosForm?.addEventListener('input', (event) => {
  if (event.target?.dataset?.spareField && event.target.closest('#oos-sped-spares, #oos-reg-spares')) {
    writeSparePools(readOosSpareEditor());
    afterSparePoolChange();
    return;
  }
  if (event.target?.id !== 'oos-usual') return;
  refreshOosConfirm();
  refreshSpareWarning();
});

oosForm?.addEventListener('change', (event) => {
  if (event.target?.name === 'oos-span') {
    syncOosDuration(event.target.value === 'days');
    return;
  }
  if (event.target?.name === 'oos-days-mode') {
    setOosDayMode(event.target.value);
    refreshSpareWarning();
    return;
  }
  const portion = event.target?.dataset?.oosPortion;
  if (!portion) return;
  const day = event.target.dataset.oosDay || '';
  if (!day) {
    if (event.target.id === 'oos-spare-all') {
      const value = event.target.value === '__mixed__' ? '' : event.target.value;
      if (event.target.value !== '__mixed__') {
        for (const part of OOS_PORTIONS) {
          const select = document.querySelector(`#oos-spare-${part.toLowerCase()}`);
          if (select) select.value = value;
        }
      }
    }
    if (oosDayMode() === 'calendar') paintOosCalendar();
    paintOosPortions();
    paintOosSpareMenus();
    refreshOosConfirm();
    refreshSpareWarning();
    return;
  }
  const cell = event.target.closest('.board-cal-day');
  const read = (part) => cell?.querySelector(`[data-oos-portion="${part}"]`)?.value || '';
  if (portion === 'ALL' && event.target.value !== '__mixed__') {
    for (const part of OOS_PORTIONS) {
      const select = cell?.querySelector(`[data-oos-portion="${part}"]`);
      if (select) select.value = event.target.value;
    }
  }
  const next = portionSpareMap({
    AM: portion === 'ALL' && event.target.value !== '__mixed__' ? event.target.value : read('AM'),
    MID: portion === 'ALL' && event.target.value !== '__mixed__' ? event.target.value : read('MID'),
    PM: portion === 'ALL' && event.target.value !== '__mixed__' ? event.target.value : read('PM'),
  });
  if (sparesMatch(next, readOosSpares())) delete oosDayPlan[day];
  else oosDayPlan[day] = next;
  paintOosCalendar();
  refreshSpareWarning();
});

oosForm?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (event.target.closest('.board-spare-edit')) {
    event.preventDefault();
    return;
  }
  if (event.target.closest('button, textarea, #oos-email-template')) return;
  event.preventDefault();
  oosForm.requestSubmit();
});

document.querySelector('#oos-email-save')?.addEventListener('click', () => {
  saveOutOfServiceNotice(currentOosEmailTemplate());
  setNamedStatus(document.querySelector('#oos-email-status'), 'Out of service email saved.');
});

document.querySelector('#oos-email-reset')?.addEventListener('click', () => {
  paintOosEmailTemplate({ subject: DEFAULT_OOS_NOTICE_SUBJECT, body: DEFAULT_OOS_NOTICE_BODY });
  setNamedStatus(document.querySelector('#oos-email-status'), '');
});

oosForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const usualBus = document.querySelector('#oos-usual')?.value || '';
  if (!usualBus.trim()) {
    setNamedStatus(oosFormStatus, 'Enter the usual bus.');
    return;
  }
  const duration = oosDuration();
  const covers = spareCovers(duration);
  if (!covers) {
    setNamedStatus(oosFormStatus, 'Choose today only, a number of days, or indefinitely.');
    return;
  }
  const spares = readOosSpares();
  const days = oosDayMode() === 'calendar' ? oosDayPlan : {};
  const match = usualBusContext(usualBus);
  const note = document.querySelector('#oos-note')?.value || '';
  const emailDriver = oosForm.querySelector('input[name="oos-email"]:checked')?.value === 'yes';
  refreshSpareWarning();
  const warnings = oosSpareWarning && !oosSpareWarning.hidden ? oosSpareWarning.textContent : '';
  try {
    writeJson(
      OOS_KEY,
      addOutOfService(outOfService(), {
        route: match.route,
        usualBus,
        spares,
        days,
        note,
        covers,
        replaceId: oosEditId,
      })
    );
    const mailed = emailDriver
      ? ` ${emailOutOfServiceDriver({ usualBus, spares, days, route: match.route, covers, note })}`
      : '';
    oosForm.reset();
    oosDialog?.close();
    const length = covers === 'indefinitely' ? 'indefinitely' : covers === 'today' ? 'today only' : covers === 1 ? 'for 1 day' : `for ${covers} days`;
    const warning = warnings ? ` ${warnings}` : '';
    setOosStatus(`Bus ${usualBus.trim()} is on the board. ${spareStatusPhrase(spares)} ${length}.${warning}${mailed}`);
    paintBoard();
  } catch (error) {
    setNamedStatus(oosFormStatus, error.message);
  }
});

function openSpareLists() {
  paintSpareLists();
  setNamedStatus(document.querySelector('#spare-lists-status'), '');
  spareListsDialog?.showModal();
  document.querySelector('#spare-lists-title')?.focus();
}

document.querySelector('#spare-lists-open')?.addEventListener('click', openSpareLists);
document.querySelector('#spare-lists-close')?.addEventListener('click', () => spareListsDialog?.close());

spareListsForm?.addEventListener('submit', (event) => event.preventDefault());

spareListsForm?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.closest('.board-spare-edit')) event.preventDefault();
});

spareListsForm?.addEventListener('click', (event) => {
  const add = event.target.closest('[data-spare-add]');
  if (add) {
    const pools = readSpareEditor();
    const pool = add.dataset.spareAdd === 'reg' ? 'reg' : 'sped';
    pools[pool] = [...pools[pool], { bus: '', kind: '' }];
    writeSparePools(pools);
    paintSpareLists();
    paintOosManager(true);
    if (oosDialog?.open) syncOpenSpareMenus();
    document.querySelector(`#spare-list-${pool} .board-spare-edit:last-of-type [data-spare-field="bus"]`)?.focus();
    return;
  }
  const remove = event.target.closest('[data-spare-remove]');
  if (!remove) return;
  const row = remove.closest('.board-spare-edit');
  const pool = row?.parentElement?.id === 'spare-list-reg' ? 'reg' : 'sped';
  const pools = readSpareEditor();
  const index = [...(row?.parentElement?.querySelectorAll('.board-spare-edit') || [])].indexOf(row);
  pools[pool] = pools[pool].filter((_, item) => item !== index);
  writeSparePools(pools);
  paintSpareLists();
  paintOosManager(true);
  if (oosDialog?.open) syncOpenSpareMenus();
});

spareListsForm?.addEventListener('input', (event) => {
  if (!event.target?.dataset?.spareField) return;
  writeSparePools(readSpareEditor());
  paintOosManager(true);
  if (oosDialog?.open) syncOpenSpareMenus();
});

document.querySelector('#absent-edit-open')?.addEventListener('click', () => {
  const editor = document.querySelector('#absent-editor');
  if (!editor) return;
  editor.hidden = false;
  paintAbsenceEditor();
});

document.querySelector('#absent-editor-close')?.addEventListener('click', () => {
  const editor = document.querySelector('#absent-editor');
  if (editor) editor.hidden = true;
});

document.querySelector('#absent-editor')?.addEventListener('click', (event) => {
  const edit = event.target.closest('[data-absence-edit]');
  if (edit) {
    openAbsenceEditor(edit.dataset.absenceEdit);
    return;
  }
  const button = event.target.closest('[data-absence-delete]');
  if (!button) return;
  const row = absences().find((item) => item.id === button.dataset.absenceDelete);
  if (!row) return;
  writeJson(
    ABSENCE_KEY,
    removeAbsencePortion(absences(), {
      name: row.name,
      route: row.route,
      portion: button.dataset.absencePortion,
      kind: row.kind,
    })
  );
  paintBoard();
});

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) refreshScheduleClocks();
  if (event.key === ALERT_KEY && document.activeElement?.closest('#dark-bus-config-form') == null) fillSettingsForm();
  if (event.key === STUDENT_ALERT_KEY && document.activeElement?.closest('#student-check-config-form') == null) fillStudentForm();
  if ([ROSTER_KEY, ABSENCE_KEY, RUNS_KEY, OOS_KEY, PAIRING_KEY, ROUTE_BUS_KEY, USUAL_KEY, ALERT_KEY, ACK_KEY, ALERTED_KEY, SCHOOL_VISIT_KEY, YARD_RETURN_KEY, EARLY_KEY, STUDENT_ALERT_KEY, STUDENT_ACK_KEY, STUDENT_VISIT_KEY, STUDENT_RETURN_KEY, STORAGE_KEY].includes(event.key)) {
    paintBoard();
  }
});

document.addEventListener('pointerdown', () => {
  const ctx = playAlertSound.ctx;
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
});

function seedPostedAssignments() {
  if (localStorage.getItem(POSTED_SEED_KEY) === POSTED_ROUTE_SHEET) return;
  const seeded = seedPostedRouteBuses(routeBuses(), (route) => clocksForRoute(route).runs);
  if (seeded.length) writeJson(ROUTE_BUS_KEY, seeded);
  localStorage.setItem(POSTED_SEED_KEY, POSTED_ROUTE_SHEET);
}

window.addEventListener('popstate', () => {
  if (isDarkBusPath()) {
    darkPageClosed = false;
    openDarkPage(false);
  } else if (isStudentCheckPath()) {
    studentPageClosed = false;
    openStudentPage(false);
  } else {
    if (darkPage && !darkPage.hidden) closeDarkPage(false);
    if (studentPage && !studentPage.hidden) closeStudentPage(false);
  }
  refreshDarkBus();
  refreshStudentCheck();
});

migratePairings();
fillSettingsForm();
fillStudentForm();
seedPostedAssignments();
refreshScheduleClocks();
if (isDarkBusPath()) {
  darkPageClosed = false;
  openDarkPage(false);
} else if (isStudentCheckPath()) {
  studentPageClosed = false;
  openStudentPage(false);
}
paintBoard();
loadBusZones();
loadPowerEvents();
loadInspections();
setInterval(() => {
  paintBoard();
  loadBusZones();
}, 30 * 1000);
setInterval(loadPowerEvents, 60 * 1000);
setInterval(loadInspections, 60 * 1000);
setInterval(() => {
  refreshDarkBus();
  refreshStudentCheck();
}, 1000);
