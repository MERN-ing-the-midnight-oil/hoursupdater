import { renameDriverOnRoute, sameDriver } from '../src/assignments.js';
import { normalizeContractReminder, reminderEventSignature } from '../src/contractReminder.js';
import {
  applyTimeSummaryEdit,
  mergeTimeSummaryEdits,
  isPayLineId,
  normalizeClockPayDefaults,
  normalizeDriverPay,
  normalizeDriverPayStatuses,
  normalizePayStatusByRun,
  normalizeStoredPayPortions,
  normalizeTimeSummaryEdits,
} from '../src/driverPay.js';
import { DEFAULT_REASON_CODES, REASON_LABEL_MAX, TRIP_TICKET_REASON_ID, isPreviousCombinedReasonList, isRetiredDefaultReasonList, isTimecardReasonList, validLockCode } from '../../src/logic/clockKiosk.js';
import { normalizeEarlyReleaseTimes } from '../../src/logic/earlyRelease.js';
import { normalizeLateFlashMinutes } from '../../src/logic/lateClockFlash.js';
import { normalizeOfficeEdits } from '../src/officePunches.js';
import { normalizePunchRun } from '../../src/logic/timesheets.js';
import { normalizeStoredWorkPortions, normalizeTripTicket, normalizeWorkType } from '../../src/logic/workTypes.js';
import { normalizeTimecardEntries } from '../src/timecardEntries.js';
import { applyLeaveRequests, normalizeLeaveRequests, officeLeaveRequests } from '../src/leaveRequests.js';
import { normalizeDriverNotice } from '../src/noticeMail.js';
import { normalizeOvertimeRules } from '../src/overtimeRules.js';
import { mergePaperBackup, normalizePaperBackup } from '../src/paperClockBackup.js';
import { normalizePunchSound } from './punchSounds.js';

export const STORAGE_KEY = 'transportation-timechange.v1';

/**
 * @param {Storage} [storage]
 */
export function emptyState() {
  return {
    version: 1,
    currentProfileId: null,
    profiles: {},
    punches: [],
    leaveRequests: [],
    clockPins: {},
    clockLockCode: '',
    clockReasonCodes: defaultReasonCodes(),
    clockSubstituteDrivers: [],
  };
}

function defaultReasonCodes() {
  return DEFAULT_REASON_CODES.map((code) => ({ id: code.id, label: code.label }));
}

/**
 * Reason codes drivers can attach to a punch. A missing list uses the starting codes.
 * An empty list stays empty.
 * @param {unknown} raw
 */
export function normalizeClockReasonCodes(raw) {
  if (raw == null) return defaultReasonCodes();
  if (!Array.isArray(raw)) return [];
  /** @type {Array<{ id: string, label: string }>} */
  const codes = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    const label = String(item.label || '').trim();
    if (!id || !label || label.length > REASON_LABEL_MAX || seen.has(id)) continue;
    seen.add(id);
    codes.push({ id, label });
  }
  return codes;
}

/**
 * The office list. A saved copy of an older starter list becomes the current list.
 * Trip Ticket Number is added at the top when the saved list still uses only built-in codes.
 * An empty list, or one with a code the office added, stays as saved.
 * @param {unknown} raw
 */
function officeReasonCodes(raw) {
  const codes = normalizeClockReasonCodes(raw);
  if (!codes.length) return codes;
  if (isRetiredDefaultReasonList(codes) || isTimecardReasonList(codes) || isPreviousCombinedReasonList(codes)) {
    return defaultReasonCodes();
  }
  if (codes.some((code) => code.id === TRIP_TICKET_REASON_ID)) return codes;
  const known = new Set(defaultReasonCodes().map((code) => code.id));
  if (!codes.every((code) => known.has(code.id))) return codes;
  const ticket = defaultReasonCodes().find((code) => code.id === TRIP_TICKET_REASON_ID);
  return ticket ? [ticket, ...codes] : codes;
}

/**
 * People who may clock in for a route without that driver's PIN.
 * @param {unknown} raw
 * @returns {Array<{ id: string, name: string }>}
 */
export function normalizeClockSubstituteDrivers(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Array<{ id: string, name: string }>} */
  const drivers = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    const name = String(item.name || '').trim();
    const key = name.toLowerCase();
    if (!id || !name || name.length > 80 || seen.has(key)) continue;
    seen.add(key);
    drivers.push({ id, name });
  }
  return drivers;
}

/**
 * @param {unknown} raw
 */
function normalizePunchReasons(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Array<{ id: string, label: string, minutes?: number }>} */
  const codes = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    const label = String(item.label || '').trim();
    if (!id || !label || label.length > REASON_LABEL_MAX || seen.has(id)) continue;
    seen.add(id);
    /** @type {{ id: string, label: string, minutes?: number }} */
    const code = { id, label };
    const minutes = Number(item.minutes);
    if (Number.isInteger(minutes) && minutes >= 0 && minutes <= 24 * 60) code.minutes = minutes;
    codes.push(code);
  }
  return codes;
}

/**
 * Four-digit driver PINs for the door screen, keyed by driver id.
 * @param {unknown} raw
 */
export function normalizeClockPins(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  /** @type {Record<string, string>} */
  const pins = {};
  for (const [id, pin] of Object.entries(raw)) {
    const driverId = String(id || '').trim();
    const value = String(pin ?? '').trim();
    if (!driverId || !/^\d{4}$/.test(value)) continue;
    pins[driverId] = value;
  }
  return pins;
}

/**
 * Office lock code that leaves the driver screen. Blank means the shared default.
 * @param {unknown} raw
 */
export function normalizeClockLockCode(raw) {
  const value = String(raw ?? '').trim();
  return validLockCode(value) ? value : '';
}

/**
 * Minutes after a route clock-in before that driver's name flashes.
 * A missing field means this browser has not chosen, so a shared value can stay.
 * Null means the office turned flashing off.
 * @param {object | null | undefined} source
 */
function lateFlashField(source) {
  if (!source || typeof source !== 'object' || !Object.prototype.hasOwnProperty.call(source, 'clockLateMinutes')) {
    return {};
  }
  return { clockLateMinutes: normalizeLateFlashMinutes(source.clockLateMinutes) };
}

/**
 * Early release PM clock-ins by school code.
 * A missing field means this browser has not chosen, so a shared value can stay.
 * @param {object | null | undefined} source
 */
function earlyReleaseField(source) {
  if (
    !source ||
    typeof source !== 'object' ||
    !Object.prototype.hasOwnProperty.call(source, 'clockEarlyReleaseTimes')
  ) {
    return {};
  }
  return { clockEarlyReleaseTimes: normalizeEarlyReleaseTimes(source.clockEarlyReleaseTimes) };
}

/**
 * Size of the driver buttons on the Timeclock screen.
 * A missing field means this browser has not chosen, so a shared value can stay.
 * @param {unknown} raw
 * @returns {'compact' | 'regular' | 'large' | ''}
 */
export function normalizeClockNameSize(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'compact' || value === 'regular' || value === 'large') return value;
  return '';
}

/**
 * @param {object | null | undefined} source
 */
function nameSizeField(source) {
  if (!source || typeof source !== 'object' || !Object.prototype.hasOwnProperty.call(source, 'clockNameSize')) {
    return {};
  }
  const size = normalizeClockNameSize(source.clockNameSize);
  return size ? { clockNameSize: size } : {};
}

/**
 * Clock-in and clock-out sounds. A missing field keeps the starting sound.
 * `off` stays quiet.
 * @param {object | null | undefined} source
 */
function punchSoundField(source) {
  if (!source || typeof source !== 'object') return {};
  /** @type {{ clockPunchSoundIn?: string, clockPunchSoundOut?: string }} */
  const saved = {};
  if (Object.prototype.hasOwnProperty.call(source, 'clockPunchSoundIn')) {
    const id = normalizePunchSound(source.clockPunchSoundIn);
    if (id) saved.clockPunchSoundIn = id;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'clockPunchSoundOut')) {
    const id = normalizePunchSound(source.clockPunchSoundOut);
    if (id) saved.clockPunchSoundOut = id;
  }
  return saved;
}

/**
 * Snap each clock in and clock out to the nearest quarter hour, then count minutes.
 * This is the starting choice.
 */
export const CLOCK_ROUNDING_SNAP = 'snap';

/**
 * Keep each clock on the minute it was punched.
 * Add the day's minutes, then round that one total to the nearest quarter hour.
 */
export const CLOCK_ROUNDING_DAILY = 'daily';

/**
 * Keep each clock on the minute it was punched.
 * Round each clock in and clock out span to the nearest quarter hour, then add those.
 */
export const CLOCK_ROUNDING_SEPARATE = 'separate';

/**
 * @param {unknown} value
 * @returns {'snap' | 'daily' | 'separate'}
 */
export function normalizeClockRounding(value) {
  if (value === CLOCK_ROUNDING_DAILY || value === CLOCK_ROUNDING_SEPARATE || value === CLOCK_ROUNDING_SNAP) {
    return value;
  }
  if (value === false) return CLOCK_ROUNDING_SEPARATE;
  return CLOCK_ROUNDING_SNAP;
}

/**
 * The one clock-rounding choice for this office.
 * A missing choice snaps each clock. An older off switch rounds each clock span.
 * @param {object | null | undefined} state
 * @returns {'snap' | 'daily' | 'separate'}
 */
export function clockRoundingMode(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return CLOCK_ROUNDING_SNAP;
  if (Object.prototype.hasOwnProperty.call(state, 'clockRounding')) {
    const mode = state.clockRounding;
    if (mode === CLOCK_ROUNDING_SNAP || mode === CLOCK_ROUNDING_DAILY || mode === CLOCK_ROUNDING_SEPARATE) {
      return mode;
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(state, 'clockQuarterHourClocks') &&
    state.clockQuarterHourClocks === false
  ) {
    return CLOCK_ROUNDING_SEPARATE;
  }
  return CLOCK_ROUNDING_SNAP;
}

/**
 * True when payroll snaps each clock in and clock out to the nearest quarter hour.
 * @param {object | null | undefined} state
 */
export function quarterHourClocksEnabled(state) {
  return clockRoundingMode(state) === CLOCK_ROUNDING_SNAP;
}

/**
 * @param {object | null | undefined} source
 */
function quarterHourClocksField(source) {
  if (!source || typeof source !== 'object') return {};
  /** @type {{ clockRounding?: 'snap' | 'daily' | 'separate', clockQuarterHourClocks?: boolean }} */
  const saved = {};
  if (Object.prototype.hasOwnProperty.call(source, 'clockRounding')) {
    const mode = source.clockRounding;
    if (mode === CLOCK_ROUNDING_SNAP || mode === CLOCK_ROUNDING_DAILY || mode === CLOCK_ROUNDING_SEPARATE) {
      saved.clockRounding = mode;
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, 'clockQuarterHourClocks')) {
    saved.clockQuarterHourClocks = source.clockQuarterHourClocks !== false;
  }
  return saved;
}

/**
 * @param {object | null | undefined} source
 */
function overtimeRulesField(source) {
  if (!source || typeof source !== 'object' || !Object.prototype.hasOwnProperty.call(source, 'overtimeRules')) {
    return {};
  }
  return { overtimeRules: normalizeOvertimeRules(source.overtimeRules) };
}

function payDefaultsField(source) {
  if (!source || typeof source !== 'object' || !Object.prototype.hasOwnProperty.call(source, 'clockPayDefaults')) {
    return {};
  }
  return { clockPayDefaults: normalizeClockPayDefaults(source.clockPayDefaults) };
}

/**
 * @param {object | null | undefined} source
 */
function timeSummaryEditsField(source) {
  if (!source || typeof source !== 'object' || !Object.prototype.hasOwnProperty.call(source, 'timeSummaryEdits')) {
    return {};
  }
  return { timeSummaryEdits: normalizeTimeSummaryEdits(source.timeSummaryEdits) };
}

/**
 * Paper backup duration, reminder choice, and the last time it was printed.
 * A missing field means this browser has not chosen, so a shared value can stay.
 * @param {object | null | undefined} source
 */
function paperBackupField(source) {
  if (!source || typeof source !== 'object' || !Object.prototype.hasOwnProperty.call(source, 'paperBackup')) {
    return {};
  }
  return { paperBackup: normalizePaperBackup(source.paperBackup) };
}

/**
 * Serial number, hourly rate, and payroll account number saved for one driver.
 * Empty values are left off.
 * @param {unknown} driver
 */
function driverPayField(driver) {
  const pay = normalizeDriverPay(driver?.pay);
  return pay.serial || pay.rate || pay.account ? { pay } : {};
}

/**
 * Pay statuses this driver can use, and which clock-in uses each one.
 * @param {{ payStatuses?: unknown, payStatusByRun?: unknown }} driver
 */
function driverPayStatusesField(driver) {
  /** @type {{ payStatuses?: string[], payStatusByRun?: Partial<Record<'AM' | 'MIDDAY' | 'PM' | 'OTHER', string>> }} */
  const fields = {};
  if (Array.isArray(driver?.payStatuses)) {
    const payStatuses = normalizeDriverPayStatuses(driver.payStatuses);
    if (payStatuses.length) fields.payStatuses = payStatuses;
  }
  if (driver?.payStatusByRun && typeof driver.payStatusByRun === 'object' && !Array.isArray(driver.payStatusByRun)) {
    const payStatusByRun = normalizePayStatusByRun(driver.payStatusByRun, fields.payStatuses || []);
    if (Object.keys(payStatusByRun).length) fields.payStatusByRun = payStatusByRun;
  }
  return fields;
}

/**
 * Clock in and clock out records saved with the shared office.
 * @param {unknown} raw
 */
export function normalizeOfficePunches(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Array<{ id: string, driver_name: string, action: 'in' | 'out', punched_at: string, note: string, reason_codes: Array<{ id: string, label: string }> }>} */
  const punches = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    const driver_name = String(item.driver_name || '').trim();
    const action = item.action === 'out' ? 'out' : item.action === 'in' ? 'in' : '';
    const punched_at = String(item.punched_at || '').trim();
    if (!id || !driver_name || !action || Number.isNaN(new Date(punched_at).getTime())) continue;
    const substitute_name = String(item.substitute_name || '').trim();
    const run = normalizePunchRun(item.run);
    const payStatus = String(item.pay_status || '').trim();
    /** @type {{ id: string, driver_name: string, action: 'in' | 'out', punched_at: string, note: string, reason_codes: Array<{ id: string, label: string }>, substitute_name?: string, run?: 'AM' | 'MIDDAY' | 'PM' | 'OTHER', pay_status?: string }} */
    const punch = {
      id,
      driver_name,
      action,
      punched_at,
      note: String(item.note || '').trim(),
      reason_codes: normalizePunchReasons(item.reason_codes),
    };
    if (substitute_name && substitute_name.length <= 80) punch.substitute_name = substitute_name;
    const tripTicket = normalizeTripTicket(item.trip_ticket);
    if (tripTicket) punch.trip_ticket = tripTicket;
    if (run) punch.run = run;
    if (run === 'OTHER') {
      const workType = normalizeWorkType(item.work_type);
      if (workType) punch.work_type = workType;
    }
    if (isPayLineId(payStatus)) punch.pay_status = payStatus;
    if (action === 'out') {
      const timecardEntries = normalizeTimecardEntries(item.timecard_entries);
      if (timecardEntries.length) punch.timecard_entries = timecardEntries;
    }
    if (action === 'in') {
      const payPortions = normalizeStoredPayPortions(item.pay_portions);
      if (payPortions.length) punch.pay_portions = payPortions;
      if (run === 'AM' || run === 'MIDDAY' || run === 'PM') {
        const workPortions = normalizeStoredWorkPortions(item.work_portions);
        if (workPortions.length) punch.work_portions = workPortions;
      }
    }
    const office_edits = normalizeOfficeEdits(item.office_edits);
    if (office_edits.length) punch.office_edits = office_edits;
    if (item.removed === true) punch.removed = true;
    punches.push(punch);
  }
  return punches;
}

/**
 * @param {Storage} [storage]
 */
export function loadState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) {
      return emptyState();
    }
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || typeof parsed.profiles !== 'object') {
      return emptyState();
    }
    const omittedDrivers = omittedDriverKeys(parsed.omittedDrivers);
    const leaveRequests = officeLeaveRequests(parsed);
    return {
      version: 1,
      currentProfileId: parsed.currentProfileId ?? null,
      profiles: parsed.profiles ?? {},
      drivers: applyLeaveRequests(parsed.drivers, leaveRequests),
      punches: normalizeOfficePunches(parsed.punches),
      leaveRequests,
      clockPins: normalizeClockPins(parsed.clockPins),
      clockLockCode: normalizeClockLockCode(parsed.clockLockCode),
      clockReasonCodes: officeReasonCodes(parsed.clockReasonCodes),
      clockSubstituteDrivers: normalizeClockSubstituteDrivers(parsed.clockSubstituteDrivers),
      ...lateFlashField(parsed),
      ...earlyReleaseField(parsed),
      ...nameSizeField(parsed),
      ...punchSoundField(parsed),
      ...quarterHourClocksField(parsed),
      ...overtimeRulesField(parsed),
      ...payDefaultsField(parsed),
      ...timeSummaryEditsField(parsed),
      ...paperBackupField(parsed),
      ...(omittedDrivers.length ? { omittedDrivers } : {}),
      exampleVersion: parsed.exampleVersion ?? 0,
      ...(parsed.contractReminder ? { contractReminder: parsed.contractReminder } : {}),
      ...(parsed.driverNotice ? { driverNotice: parsed.driverNotice } : {}),
      ...(parsed.contractReminderCreated && typeof parsed.contractReminderCreated === 'object'
        ? { contractReminderCreated: parsed.contractReminderCreated }
        : {}),
      ...(parsed.contractReminderSignatures && typeof parsed.contractReminderSignatures === 'object'
        ? { contractReminderSignatures: parsed.contractReminderSignatures }
        : {}),
    };
  } catch {
    return emptyState();
  }
}

/** @type {((state: ReturnType<typeof emptyState>) => void) | null} */
let afterSave = null;
let suppressSync = false;

/**
 * Called after a local save so a signed-in office can write the shared copy.
 * @param {(state: ReturnType<typeof emptyState>) => void} listener
 */
export function onStateSaved(listener) {
  afterSave = listener;
}

/**
 * Replace the saved office without sending that copy back to the shared record.
 * @param {ReturnType<typeof emptyState>} state
 * @param {Storage} [storage]
 */
export function writeStateLocal(state, storage = globalThis.localStorage) {
  suppressSync = true;
  try {
    return saveState(state, storage);
  } finally {
    suppressSync = false;
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!suppressSync) afterSave?.(state);
  return state;
}

/**
 * Save one typed cell or comment on a driver's Monthly Time Summary.
 * @param {{
 *   driverId?: string,
 *   periodKey?: string,
 *   lineId?: string,
 *   kind?: string,
 *   day?: string | number,
 *   hours?: string,
 *   comment?: string,
 * }} edit
 * @param {Storage} [storage]
 */
export function saveTimeSummaryEdit(edit, storage = globalThis.localStorage) {
  const state = loadState(storage);
  state.timeSummaryEdits = applyTimeSummaryEdit(state.timeSummaryEdits, edit);
  saveState(state, storage);
  return state.timeSummaryEdits;
}

/** @type {Set<string> | null} */
let sessionModifiedRoutes = null;

/**
 * Start noting route numbers changed after this browser visit has loaded.
 * Loading the shared office does not count.
 */
export function beginSessionRouteTracking() {
  sessionModifiedRoutes = new Set();
}

/**
 * Route numbers saved during this visit, in route order.
 */
export function sessionModifiedRouteNames() {
  return [...(sessionModifiedRoutes ?? [])].sort(compareRouteNumbers);
}

/**
 * @param {string | null | undefined} name
 */
function noteSessionRoute(name) {
  if (!sessionModifiedRoutes) return;
  const route = String(name ?? '').trim();
  if (route) sessionModifiedRoutes.add(route);
}

/**
 * @param {string} name
 */
function driverIdFor(name) {
  return `driver-${String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}`;
}

/**
 * First token is the first name. Everything after the first space is the last name.
 * @param {string} name
 */
export function splitPersonName(name) {
  const trimmed = String(name ?? '').trim().replace(/\s+/g, ' ');
  const space = trimmed.indexOf(' ');
  if (space < 0) return { firstName: trimmed, lastName: '' };
  return {
    firstName: trimmed.slice(0, space),
    lastName: trimmed.slice(space + 1).trim(),
  };
}

/**
 * @param {string} firstName
 * @param {string} lastName
 */
export function joinPersonName(firstName, lastName) {
  return [String(firstName ?? '').trim(), String(lastName ?? '').trim()].filter(Boolean).join(' ');
}

/**
 * Directory order: last name, then first name. A single name sorts on that name.
 * @param {{ firstName?: string, lastName?: string, name?: string }} a
 * @param {{ firstName?: string, lastName?: string, name?: string }} b
 */
export function compareDrivers(a, b) {
  const aKey = String(a.lastName || a.firstName || a.name || '').toLowerCase();
  const bKey = String(b.lastName || b.firstName || b.name || '').toLowerCase();
  const byLast = aKey.localeCompare(bKey);
  if (byLast) return byLast;
  return String(a.firstName || '').toLowerCase().localeCompare(String(b.firstName || '').toLowerCase());
}

/**
 * @param {object | null | undefined} driver
 */
function personNameParts(driver) {
  const rawName = String(driver?.name ?? '').trim().replace(/\s+/g, ' ');
  const hasFirst = driver != null && Object.prototype.hasOwnProperty.call(driver, 'firstName');
  const hasLast = driver != null && Object.prototype.hasOwnProperty.call(driver, 'lastName');
  const storedFirst = hasFirst ? String(driver.firstName ?? '').trim() : '';
  const storedLast = hasLast ? String(driver.lastName ?? '').trim() : '';
  if ((hasFirst || hasLast) && (storedFirst || storedLast)) {
    return {
      firstName: storedFirst,
      lastName: storedLast,
      name: joinPersonName(storedFirst, storedLast) || rawName,
    };
  }
  const parts = splitPersonName(rawName);
  return { firstName: parts.firstName, lastName: parts.lastName, name: rawName };
}

/**
 * Lowercase names removed from the driver list. A current route can still
 * name them; this stops that route from putting them back on the list.
 * @param {unknown} raw
 */
export function omittedDriverKeys(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  /** @type {string[]} */
  const names = [];
  for (const item of raw) {
    const key = String(item ?? '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(key);
  }
  return names;
}

/**
 * Drivers saved on the sheet, plus anyone named on a route who is not listed yet.
 * Names removed from the list stay off it.
 * @param {ReturnType<typeof emptyState>} state
 */
export function driversFromState(state) {
  const omitted = new Set(omittedDriverKeys(state?.omittedDrivers));
  /** @type {Map<string, { id: string, name: string, firstName: string, lastName: string, phone: string, email: string, pay?: { serial: string, rate: string, account: string }, payStatuses?: string[], payStatusByRun?: Partial<Record<'AM' | 'MIDDAY' | 'PM' | 'OTHER', string>> }>} */
  const byName = new Map();
  for (const driver of state?.drivers ?? []) {
    const parts = personNameParts(driver);
    if (!parts.name || omitted.has(parts.name.toLowerCase())) continue;
    byName.set(parts.name.toLowerCase(), {
      id: driver.id || driverIdFor(parts.name),
      name: parts.name,
      firstName: parts.firstName,
      lastName: parts.lastName,
      phone: String(driver.phone ?? ''),
      email: String(driver.email ?? ''),
      ...driverPayField(driver),
      ...driverPayStatusesField(driver),
    });
  }
  for (const profile of Object.values(state?.profiles ?? {})) {
    const parts = personNameParts({ name: profile.driver_name });
    if (!parts.name || omitted.has(parts.name.toLowerCase()) || byName.has(parts.name.toLowerCase())) continue;
    byName.set(parts.name.toLowerCase(), {
      id: driverIdFor(parts.name),
      name: parts.name,
      firstName: parts.firstName,
      lastName: parts.lastName,
      phone: '',
      email: '',
    });
  }
  return [...byName.values()].sort(compareDrivers);
}

/**
 * @param {Storage} [storage]
 */
export function listDrivers(storage = globalThis.localStorage) {
  return driversFromState(loadState(storage));
}

/**
 * @param {{ id?: string, name?: string, firstName?: string, lastName?: string, phone?: string, email?: string, previousName?: string, serial?: string, rate?: string, account?: string, payStatuses?: string[], payStatusByRun?: object }} driver
 * @param {Storage} [storage]
 */
export function saveDriver(driver, storage = globalThis.localStorage) {
  const state = loadState(storage);
  const drivers = driversFromState(state);
  const parts =
    driver.firstName != null || driver.lastName != null
      ? {
          firstName: String(driver.firstName ?? '').trim(),
          lastName: String(driver.lastName ?? '').trim(),
        }
      : splitPersonName(driver.name);
  const name = joinPersonName(parts.firstName, parts.lastName);
  if (!name) {
    throw new Error('Enter a first or last name.');
  }
  const previous = String(driver.previousName ?? '').trim();
  const id = driver.id || driverIdFor(previous || name);
  const duplicate = drivers.some(
    (item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    throw new Error(`${name} is already on the driver sheet.`);
  }
  const existing = drivers.find((item) => item.id === id);
  const payStatuses = Object.prototype.hasOwnProperty.call(driver, 'payStatuses')
    ? normalizeDriverPayStatuses(driver.payStatuses)
    : existing?.payStatuses;
  const payStatusByRun = normalizePayStatusByRun(
    Object.prototype.hasOwnProperty.call(driver, 'payStatusByRun') ? driver.payStatusByRun : existing?.payStatusByRun,
    Array.isArray(payStatuses) ? payStatuses : []
  );
  const next = {
    id,
    name,
    firstName: parts.firstName,
    lastName: parts.lastName,
    phone: driver.phone != null ? String(driver.phone).trim() : String(existing?.phone ?? ''),
    email: String(driver.email ?? '').trim(),
    ...driverPayField({
      pay: {
        serial: Object.prototype.hasOwnProperty.call(driver, 'serial') ? driver.serial : existing?.pay?.serial,
        rate: Object.prototype.hasOwnProperty.call(driver, 'rate') ? driver.rate : existing?.pay?.rate,
        account: Object.prototype.hasOwnProperty.call(driver, 'account') ? driver.account : existing?.pay?.account,
      },
    }),
    ...(Array.isArray(payStatuses) ? { payStatuses } : {}),
    ...(Object.keys(payStatusByRun).length ? { payStatusByRun } : {}),
  };
  const storedLeave = (Array.isArray(state.drivers) ? state.drivers : []).find(
    (item) => item?.id === id || sameDriver(item?.name, name) || (previous && sameDriver(item?.name, previous))
  );
  const keptLeave = normalizeLeaveRequests(storedLeave?.leaveRequests).map((row) =>
    sameDriver(row.driver_name, name) ? row : { ...row, driver_name: name }
  );
  if (keptLeave.length) next.leaveRequests = keptLeave;
  const index = drivers.findIndex((item) => item.id === id);
  if (index >= 0) drivers[index] = next;
  else drivers.push(next);
  const remembered = officeLeaveRequests(state).filter(
    (row) => !previous || !sameDriver(row.driver_name, previous)
  );
  const leaveRequests = normalizeLeaveRequests([...remembered, ...keptLeave]);
  state.leaveRequests = leaveRequests;
  state.drivers = applyLeaveRequests(drivers, leaveRequests);
  if (previous && !sameDriver(previous, name)) {
    for (const profile of Object.values(state.profiles)) {
      const touched =
        sameDriver(profile?.driver_name, previous) ||
        (Array.isArray(profile?.assignments) &&
          profile.assignments.some((item) => sameDriver(item?.driver_name, previous)));
      renameDriverOnRoute(profile, previous, name);
      if (touched) noteSessionRoute(profile?.name);
    }
  } else if (String(existing?.email ?? '').trim() !== next.email) {
    for (const profile of Object.values(state.profiles)) {
      if (sameDriver(profile?.driver_name, name)) noteSessionRoute(profile?.name);
    }
  }
  const omitted = omittedDriverKeys(state.omittedDrivers).filter((item) => item !== name.toLowerCase());
  if (omitted.length) state.omittedDrivers = omitted;
  else delete state.omittedDrivers;
  saveState(state, storage);
  return next;
}

/**
 * Take a driver off the name list. Route assignments and clock-time history stay.
 * @param {string} id
 * @param {Storage} [storage]
 */
export function deleteDriver(id, storage = globalThis.localStorage) {
  const driverId = String(id ?? '').trim();
  const state = loadState(storage);
  const drivers = driversFromState(state);
  const target = drivers.find((item) => item.id === driverId);
  if (!target) {
    throw new Error('That driver is not on the list.');
  }
  const key = target.name.toLowerCase();
  state.drivers = drivers.filter((item) => item.name.toLowerCase() !== key);
  const omitted = omittedDriverKeys(state.omittedDrivers);
  if (!omitted.includes(key)) omitted.push(key);
  state.omittedDrivers = omitted;
  saveState(state, storage);
  return target;
}

/**
 * Keep the newer shared office, and lay this browser's driver-list edits on top.
 * Routes stay with the shared copy. Adds, edits, and removals from this browser stay.
 * @param {object | null | undefined} remoteState
 * @param {object | null | undefined} localState
 */
export function mergeSharedDriverList(remoteState, localState) {
  const remote =
    remoteState && typeof remoteState === 'object' && !Array.isArray(remoteState)
      ? structuredClone(remoteState)
      : { version: 1, currentProfileId: null, profiles: {} };
  const localDrivers = Array.isArray(localState?.drivers) ? localState.drivers : [];
  const localOmitted = new Set(omittedDriverKeys(localState?.omittedDrivers));
  /** @type {Map<string, object>} */
  const byName = new Map();
  for (const driver of Array.isArray(remote.drivers) ? remote.drivers : []) {
    const name = String(driver?.name ?? '').trim();
    if (!name || localOmitted.has(name.toLowerCase())) continue;
    byName.set(name.toLowerCase(), driver);
  }
  for (const driver of localDrivers) {
    const name = String(driver?.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (localOmitted.has(key)) {
      byName.delete(key);
      continue;
    }
    byName.set(key, driver);
  }
  remote.drivers = [...byName.values()];
  const punches = new Map();
  for (const punch of [
    ...normalizeOfficePunches(remote.punches),
    ...normalizeOfficePunches(localState?.punches),
  ]) {
    punches.set(punch.id, punch);
  }
  remote.punches = [...punches.values()];
  const leaves = new Map();
  for (const leave of [
    ...normalizeLeaveRequests(remote.leaveRequests),
    ...normalizeLeaveRequests(localState?.leaveRequests),
  ]) {
    leaves.set(leave.id, leave);
  }
  remote.leaveRequests = [...leaves.values()];
  remote.drivers = applyLeaveRequests(remote.drivers, remote.leaveRequests);
  remote.clockPins = {
    ...normalizeClockPins(remote.clockPins),
    ...normalizeClockPins(localState?.clockPins),
  };
  remote.clockLockCode =
    normalizeClockLockCode(localState?.clockLockCode) ||
    normalizeClockLockCode(remote.clockLockCode);
  remote.clockReasonCodes = Array.isArray(localState?.clockReasonCodes)
    ? officeReasonCodes(localState.clockReasonCodes)
    : officeReasonCodes(remote.clockReasonCodes);
  remote.clockSubstituteDrivers = Array.isArray(localState?.clockSubstituteDrivers)
    ? normalizeClockSubstituteDrivers(localState.clockSubstituteDrivers)
    : normalizeClockSubstituteDrivers(remote.clockSubstituteDrivers);
  if (localState && Object.prototype.hasOwnProperty.call(localState, 'clockLateMinutes')) {
    const minutes = normalizeLateFlashMinutes(localState.clockLateMinutes);
    if (minutes == null) delete remote.clockLateMinutes;
    else remote.clockLateMinutes = minutes;
  }
  if (localState && Object.prototype.hasOwnProperty.call(localState, 'clockEarlyReleaseTimes')) {
    remote.clockEarlyReleaseTimes = normalizeEarlyReleaseTimes(localState.clockEarlyReleaseTimes);
  }
  if (localState && Object.prototype.hasOwnProperty.call(localState, 'clockNameSize')) {
    const size = normalizeClockNameSize(localState.clockNameSize);
    if (!size) delete remote.clockNameSize;
    else remote.clockNameSize = size;
  }
  if (localState && Object.prototype.hasOwnProperty.call(localState, 'clockPunchSoundIn')) {
    const id = normalizePunchSound(localState.clockPunchSoundIn);
    if (!id) delete remote.clockPunchSoundIn;
    else remote.clockPunchSoundIn = id;
  }
  if (localState && Object.prototype.hasOwnProperty.call(localState, 'clockPunchSoundOut')) {
    const id = normalizePunchSound(localState.clockPunchSoundOut);
    if (!id) delete remote.clockPunchSoundOut;
    else remote.clockPunchSoundOut = id;
  }
  if (localState && Object.prototype.hasOwnProperty.call(localState, 'clockRounding')) {
    const mode = localState.clockRounding;
    if (mode === 'snap' || mode === 'daily' || mode === 'separate') remote.clockRounding = mode;
    else delete remote.clockRounding;
  }
  if (localState && Object.prototype.hasOwnProperty.call(localState, 'clockQuarterHourClocks')) {
    remote.clockQuarterHourClocks = localState.clockQuarterHourClocks !== false;
  }
  if (localState && Object.prototype.hasOwnProperty.call(localState, 'overtimeRules')) {
    remote.overtimeRules = normalizeOvertimeRules(localState.overtimeRules);
  }
  if (localState && Object.prototype.hasOwnProperty.call(localState, 'clockPayDefaults')) {
    remote.clockPayDefaults = normalizeClockPayDefaults(localState.clockPayDefaults);
  }
  if (localState && Object.prototype.hasOwnProperty.call(localState, 'timeSummaryEdits')) {
    remote.timeSummaryEdits = mergeTimeSummaryEdits(remote.timeSummaryEdits, localState.timeSummaryEdits);
  }
  if (localState && Object.prototype.hasOwnProperty.call(localState, 'paperBackup')) {
    remote.paperBackup = mergePaperBackup(remote.paperBackup, localState.paperBackup);
  }
  const omitted = new Set([...omittedDriverKeys(remote.omittedDrivers), ...localOmitted]);
  for (const driver of remote.drivers) {
    omitted.delete(String(driver?.name ?? '').trim().toLowerCase());
  }
  if (omitted.size) remote.omittedDrivers = [...omitted];
  else delete remote.omittedDrivers;
  return remote;
}

/**
 * Outlook reminder shared by this office. Missing settings use 1 school day before.
 * @param {Storage} [storage]
 */
export function loadContractReminder(storage = globalThis.localStorage) {
  return normalizeContractReminder(loadState(storage).contractReminder);
}

/**
 * @param {unknown} settings
 * @param {Storage} [storage]
 */
export function saveContractReminder(settings, storage = globalThis.localStorage) {
  const state = loadState(storage);
  const next = normalizeContractReminder(settings);
  state.contractReminder = next;
  saveState(state, storage);
  return next;
}

/**
 * Which memorandum is emailed, and whether the clock-time notice PDF is attached.
 * @param {Storage} [storage]
 */
export function loadDriverNotice(storage = globalThis.localStorage) {
  return normalizeDriverNotice(loadState(storage).driverNotice);
}

/**
 * @param {unknown} settings
 * @param {Storage} [storage]
 */
export function saveDriverNotice(settings, storage = globalThis.localStorage) {
  const state = loadState(storage);
  const next = normalizeDriverNotice(settings);
  state.driverNotice = next;
  saveState(state, storage);
  return next;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
function createdContractEventMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  /** @type {Record<string, string>} */
  const map = {};
  for (const [id, value] of Object.entries(raw)) {
    const changeId = String(id || '').trim();
    const reminderDate = String(typeof value === 'string' ? value : value?.reminderDate || '').slice(0, 10);
    if (!changeId || !/^\d{4}-\d{2}-\d{2}$/.test(reminderDate)) continue;
    map[changeId] = reminderDate;
  }
  return map;
}

/**
 * Change ids already written into an Outlook reminder, keyed to that event's day.
 * @param {Storage} [storage]
 */
export function loadCreatedContractEvents(storage = globalThis.localStorage) {
  return createdContractEventMap(loadState(storage).contractReminderCreated);
}

/**
 * @param {string | null | undefined} changeId
 * @param {Storage} [storage]
 */
export function isContractEventCreated(changeId, storage = globalThis.localStorage) {
  const id = String(changeId || '').trim();
  if (!id) return false;
  return Boolean(loadCreatedContractEvents(storage)[id]);
}

/**
 * @param {Array<{ changeId: string, reminderDate: string }>} entries
 * @param {Storage} [storage]
 */
export function rememberCreatedContractEvents(entries, storage = globalThis.localStorage) {
  const state = loadState(storage);
  const map = createdContractEventMap(state.contractReminderCreated);
  for (const entry of entries || []) {
    const changeId = String(entry?.changeId || '').trim();
    const reminderDate = String(entry?.reminderDate || '').slice(0, 10);
    if (!changeId || !/^\d{4}-\d{2}-\d{2}$/.test(reminderDate)) continue;
    map[changeId] = reminderDate;
  }
  state.contractReminderCreated = map;
  saveState(state, storage);
  return map;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
function reminderSignatureMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  /** @type {Record<string, string>} */
  const map = {};
  for (const [day, value] of Object.entries(raw)) {
    const reminderDate = String(day || '').slice(0, 10);
    const signature = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reminderDate) || !signature) continue;
    map[reminderDate] = signature;
  }
  return map;
}

/**
 * Last downloaded wording for each reminder day.
 * @param {Storage} [storage]
 */
export function loadReminderSignatures(storage = globalThis.localStorage) {
  return reminderSignatureMap(loadState(storage).contractReminderSignatures);
}

/**
 * Record the events just downloaded, including a day that was cancelled.
 * @param {Array<{ reminderDate: string, changeIds?: string[], subject?: string, body?: string, cancelled?: boolean }>} events
 * @param {string} [stamp]
 * @param {Storage} [storage]
 */
export function rememberPublishedReminders(events, stamp = '', storage = globalThis.localStorage) {
  const state = loadState(storage);
  const map = createdContractEventMap(state.contractReminderCreated);
  const signatures = reminderSignatureMap(state.contractReminderSignatures);
  const touched = new Set(
    (events || []).map((event) => String(event?.reminderDate || '').slice(0, 10)).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))
  );
  for (const [changeId, day] of Object.entries(map)) {
    if (touched.has(day)) delete map[changeId];
  }
  for (const event of events || []) {
    const day = String(event?.reminderDate || '').slice(0, 10);
    if (!touched.has(day)) continue;
    if (event?.cancelled) {
      delete signatures[day];
      continue;
    }
    for (const changeId of event.changeIds || []) {
      const id = String(changeId || '').trim();
      if (id) map[id] = day;
    }
    signatures[day] = `${reminderEventSignature(event)}\n${stamp}`;
  }
  state.contractReminderCreated = map;
  state.contractReminderSignatures = signatures;
  saveState(state, storage);
  return map;
}

/**
 * @param {Storage} [storage]
 */
export function listProfiles(storage = globalThis.localStorage) {
  const state = loadState(storage);
  return Object.values(state.profiles).sort((a, b) =>
    compareRouteNumbers(a.name, b.name)
  );
}

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
export function compareRouteNumbers(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/**
 * @param {Storage} [storage]
 */
export function getCurrentProfile(storage = globalThis.localStorage) {
  const state = loadState(storage);
  if (!state.currentProfileId) {
    return null;
  }
  return state.profiles[state.currentProfileId] ?? null;
}

/**
 * @param {string} id
 * @param {Storage} [storage]
 */
export function setCurrentProfile(id, storage = globalThis.localStorage) {
  const state = loadState(storage);
  if (!state.profiles[id]) {
    throw new Error('That route is not saved in this browser.');
  }
  state.currentProfileId = id;
  saveState(state, storage);
  return state.profiles[id];
}

/**
 * @param {object} profile
 * @param {Storage} [storage]
 */
export function saveProfile(profile, storage = globalThis.localStorage) {
  const state = loadState(storage);
  state.profiles[profile.id] = profile;
  state.currentProfileId = profile.id;
  saveState(state, storage);
  noteSessionRoute(profile?.name);
  return profile;
}

/**
 * @param {string} id
 * @param {Storage} [storage]
 */
export function deleteProfile(id, storage = globalThis.localStorage) {
  const state = loadState(storage);
  delete state.profiles[id];
  if (state.currentProfileId === id) {
    const remaining = listProfilesFromState(state);
    state.currentProfileId = remaining[0]?.id ?? null;
  }
  saveState(state, storage);
  return state.currentProfileId
    ? state.profiles[state.currentProfileId]
    : null;
}

/**
 * @param {ReturnType<typeof emptyState>} state
 */
function listProfilesFromState(state) {
  return Object.values(state.profiles).sort((a, b) =>
    compareRouteNumbers(a.name, b.name)
  );
}

/**
 * @param {string} json
 * @param {Storage} [storage]
 */
export function importState(json, storage = globalThis.localStorage) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.profiles) {
    throw new Error('That file is not a Teamster Tracker backup.');
  }
  const leaveRequests = officeLeaveRequests(parsed);
  const next = {
    version: 1,
    currentProfileId: parsed.currentProfileId ?? null,
    profiles: parsed.profiles,
    drivers: applyLeaveRequests(parsed.drivers, leaveRequests),
    punches: normalizeOfficePunches(parsed.punches),
    leaveRequests,
    clockPins: normalizeClockPins(parsed.clockPins),
    clockLockCode: normalizeClockLockCode(parsed.clockLockCode),
    clockReasonCodes: officeReasonCodes(parsed.clockReasonCodes),
    clockSubstituteDrivers: normalizeClockSubstituteDrivers(parsed.clockSubstituteDrivers),
    ...lateFlashField(parsed),
    ...earlyReleaseField(parsed),
    ...nameSizeField(parsed),
    ...punchSoundField(parsed),
    ...quarterHourClocksField(parsed),
    ...overtimeRulesField(parsed),
    ...payDefaultsField(parsed),
    ...timeSummaryEditsField(parsed),
    ...paperBackupField(parsed),
    ...(omittedDriverKeys(parsed.omittedDrivers).length
      ? { omittedDrivers: omittedDriverKeys(parsed.omittedDrivers) }
      : {}),
    ...(parsed.contractReminder ? { contractReminder: parsed.contractReminder } : {}),
    ...(parsed.driverNotice ? { driverNotice: parsed.driverNotice } : {}),
    ...(parsed.contractReminderCreated && typeof parsed.contractReminderCreated === 'object'
      ? { contractReminderCreated: parsed.contractReminderCreated }
      : {}),
    ...(parsed.contractReminderSignatures && typeof parsed.contractReminderSignatures === 'object'
      ? { contractReminderSignatures: parsed.contractReminderSignatures }
      : {}),
  };
  if (next.currentProfileId && !next.profiles[next.currentProfileId]) {
    next.currentProfileId = Object.keys(next.profiles)[0] ?? null;
  }
  saveState(next, storage);
  return next;
}
