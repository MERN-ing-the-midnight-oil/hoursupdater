// Door clock: a driver picks their name, enters a PIN, and records either a
// clock-in or a clock-out. Each tap is its own record. A record can carry one
// note, stamped when it was written, and any number of reason codes from the
// office list. This log does not decide whether they were already in or out,
// and it does not change contracted route clocks.

import { createId } from './createId.js';

const PIN_PATTERN = /^\d{4}$/;
const LOCK_CODE_PATTERN = /^[A-Za-z0-9]{4,64}$/;
export const NOTE_MAX = 500;
export const REASON_LABEL_MAX = 120;

// Lock code that leaves the driver clock screen. Not a driver PIN.
export const DEFAULT_KIOSK_CODE = 'TimeChanges2026';

// PIN every driver starts with. A saved 4-digit PIN replaces this.
export const DEFAULT_DRIVER_PIN = '1234';

export function driverClockPin(pins, driverId) {
  const saved = pins && typeof pins === 'object' ? String(pins[driverId] ?? '').trim() : '';
  return PIN_PATTERN.test(saved) ? saved : DEFAULT_DRIVER_PIN;
}

export const KIOSK_COOKIE = 'clock_kiosk';


function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export function assertPin(pin) {
  const value = String(pin ?? '').trim();
  if (!PIN_PATTERN.test(value)) {
    fail('PIN must be 4 digits.');
  }
  return value;
}

export function assertTimestamp(value) {
  const text = String(value ?? '').trim();
  const time = Date.parse(text);
  if (!text || Number.isNaN(time)) {
    fail('That time is not valid.');
  }
  return new Date(time).toISOString();
}

export function assertAction(action) {
  if (action !== 'in' && action !== 'out') {
    fail('Choose clock in or clock out.');
  }
  return action;
}

export function assertNote(value) {
  const text = String(value ?? '').trim();
  if (text.length > NOTE_MAX) {
    fail(`A note can be ${NOTE_MAX} characters or fewer.`);
  }
  return text;
}

function assertReasonLabel(codes, label, exceptId = '') {
  const text = String(label ?? '').trim();
  if (!text) fail('Enter a reason code.');
  if (text.length > REASON_LABEL_MAX) {
    fail(`A reason code can be ${REASON_LABEL_MAX} characters or fewer.`);
  }
  const clash = codes.find(
    (code) => code.id !== exceptId && code.label.toLowerCase() === text.toLowerCase()
  );
  if (clash) fail('That reason code is already on the list.');
  return text;
}

function normalizePunchReasonCodes(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) fail('Reason codes must be a list.');
  const codes = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail('Each reason code needs a name.');
    }
    const record = (item);
    const id = String(record.id || '').trim();
    const label = String(record.label || '').trim();
    if (!id || !label) fail('Each reason code needs a name.');
    if (seen.has(id)) continue;
    seen.add(id);
    const code = { id, label };
    const minutes = Number(record.minutes);
    if (Number.isInteger(minutes) && minutes >= 0 && minutes <= 24 * 60) code.minutes = minutes;
    codes.push(code);
  }
  return codes;
}

export function normalizeReasonCodeList(raw) {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray( (raw).codes)
      ? (raw).codes
      : null;
  if (!list) {
    if (raw == null) return [];
    fail('clock-reason-codes.json must contain a JSON array.');
  }
  return normalizePunchReasonCodes(list);
}

// Keep a recorded length of time when the reason stays on the punch.
function reasonWithMinutes(code, kept) {
  const minutes = Number(kept?.minutes);
  if (Number.isInteger(minutes) && minutes >= 0 && minutes <= 24 * 60) {
    return { id: code.id, label: code.label, minutes };
  }
  return { id: code.id, label: code.label };
}

// Keep codes already stored on the record when they have left the office list.
// New picks must still be on that list.
export function selectReasonCodes(current, rawIds, catalog) {
  if (!Array.isArray(rawIds)) fail('Reason codes must be a list.');
  const live = new Map(normalizeReasonCodeList(catalog).map((code) => [code.id, code]));
  const previous = new Map(normalizePunchReasonCodes(current).map((code) => [code.id, code]));
  const next = [];
  const seen = new Set();
  for (const rawId of rawIds) {
    const id = String(rawId ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const fromList = live.get(id);
    const kept = previous.get(id);
    if (fromList) {
      next.push(reasonWithMinutes(fromList, kept));
      continue;
    }
    if (kept) {
      next.push(reasonWithMinutes(kept, kept));
      continue;
    }
    fail('That reason code is not on the list.');
  }
  return next;
}

// The timecard list, before other paid time from the contract was added.
const TIMECARD_REASON_CODES = [
  { id: 'reason-new-student', label: 'New Student' },
  { id: 'reason-traffic', label: 'Traffic/Construction/Accident' },
  { id: 'reason-returned-student-to-school', label: 'Returned Student to School' },
  { id: 'reason-extra-route', label: 'Extra Route(s) / Student(s)' },
  { id: 'reason-delay-at-stop-or-school', label: 'Delay at Stop / School' },
  { id: 'reason-bus-wash', label: 'Bus Wash' },
  { id: 'reason-early-release', label: 'Early Release' },
  { id: 'reason-meeting', label: 'Meetings / Trainings' },
  {
    id: 'reason-paperwork',
    label: 'Paperwork - a. Bus Conduct, b. Stop Paddle Violation, c. Accident Form, d. etc.',
  },
  { id: 'reason-fueling-bus', label: 'Fueling Bus' },
];

// Other paid time added beside the timecard codes, before trip tickets.
const OTHER_PAID_TIME_CODES = [
  { id: 'reason-bus-cleaning', label: 'Bus cleaning' },
  { id: 'reason-in-service', label: 'In-service' },
  { id: 'reason-contract-meeting', label: 'Meeting' },
  { id: 'reason-inclement-weather', label: 'Inclement weather' },
  { id: 'reason-snow-detour-accident', label: 'Snow, detour, or accident' },
  { id: 'reason-short-student', label: 'Student riding 3 days or fewer' },
  { id: 'reason-counseling', label: 'Counseling' },
  { id: 'reason-fifth-day', label: 'Fifth day of a 4-day run' },
  { id: 'reason-training', label: 'Training' },
  { id: 'reason-food-service', label: 'Food service delivery' },
];

// The combined list from before Trip Ticket Number was added at the top.
const PREVIOUS_COMBINED_REASON_CODES = [...TIMECARD_REASON_CODES, ...OTHER_PAID_TIME_CODES];

export const TRIP_TICKET_REASON_ID = 'reason-trip-ticket';

// Starting list for the door clock. The office can rename, add, or remove these.
export const DEFAULT_REASON_CODES = [
  { id: TRIP_TICKET_REASON_ID, label: 'Trip Ticket Number' },
  ...PREVIOUS_COMBINED_REASON_CODES,
];

// The previous starter list, replaced by the timecard posted in the office.
const RETIRED_DEFAULT_REASON_CODES = [
  { id: 'reason-fueling-bus', label: 'Fueling Bus' },
  { id: 'reason-traffic', label: 'Traffic' },
  { id: 'reason-delay-at-stop-or-school', label: 'Delay at Stop or School' },
  { id: 'reason-meeting', label: 'Meeting' },
  { id: 'reason-paperwork', label: 'Paperwork' },
];

// True when the office still has the starter list from before the timecard codes.
// A renamed, added, or removed code means the office has edited the list.
export function isRetiredDefaultReasonList(codes) {
  return sameReasonList(codes, RETIRED_DEFAULT_REASON_CODES);
}

// True when the office still has the timecard list from before other paid time was added.
export function isTimecardReasonList(codes) {
  return sameReasonList(codes, TIMECARD_REASON_CODES);
}

// True when the office still has the combined list from before trip tickets.
export function isPreviousCombinedReasonList(codes) {
  return sameReasonList(codes, PREVIOUS_COMBINED_REASON_CODES);
}

function sameReasonList(codes, expected) {
  if (!Array.isArray(codes) || codes.length !== expected.length) return false;
  const key = (code) => `${code.id}\0${code.label}`;
  const saved = codes.map(key).sort();
  const starter = expected.map(key).sort();
  return saved.every((item, index) => item === starter[index]);
}

export function addReasonCode(codes, label) {
  const list = normalizeReasonCodeList(codes);
  return [...list, { id: createId(), label: assertReasonLabel(list, label) }];
}

export function renameReasonCode(codes, id, label) {
  const list = normalizeReasonCodeList(codes);
  const codeId = String(id || '').trim();
  const index = list.findIndex((code) => code.id === codeId);
  if (index < 0) fail('Reason code not found.', 404);
  const next = list.slice();
  next[index] = { id: codeId, label: assertReasonLabel(list, label, codeId) };
  return next;
}

export function removeReasonCode(codes, id) {
  const list = normalizeReasonCodeList(codes);
  const codeId = String(id || '').trim();
  const next = list.filter((code) => code.id !== codeId);
  if (next.length === list.length) fail('Reason code not found.', 404);
  return next;
}

// A renamed code keeps the same meaning, so records show the new name.
export function relabelReasonCode(punches, codeId, label) {
  const id = String(codeId || '').trim();
  const text = String(label || '').trim();
  return normalizePunchLog(punches).map((punch) => ({
    ...punch,
    reason_codes: punch.reason_codes.map((code) =>
      code.id === id ? reasonWithMinutes({ id, label: text }, code) : code
    ),
  }));
}

// PINs are stored as written so the office can look them up.
// An older hashed entry has no recoverable number, so it is dropped.
export function normalizePinFile(raw) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail('clock-pins.json must contain a JSON object.');
  }
  const pins = {};
  for (const [driverId, value] of Object.entries(raw)) {
    const id = String(driverId || '').trim();
    if (!id || !value || typeof value !== 'object' || Array.isArray(value)) {
      fail('Each PIN entry needs a driver and a PIN.');
    }
    const record = (value);
    const pin = String(record.pin ?? '').trim();
    if (!PIN_PATTERN.test(pin)) {
      if (record.hash && (record.pin == null || pin === '')) continue;
      fail('Each PIN must be 4 digits.');
    }
    pins[id] = {
      pin,
      updated_at: record.updated_at
        ? assertTimestamp(record.updated_at)
        : new Date(0).toISOString(),
    };
  }
  return pins;
}

export function setPin(pins, driverId, pin, now) {
  const id = String(driverId || '').trim();
  if (!id) fail('Driver not found.', 404);
  return {
    ...normalizePinFile(pins),
    [id]: { pin: assertPin(pin), updated_at: assertTimestamp(now) },
  };
}

/**
 * Drivers whose saved clock PIN is this number.
 * A missing PIN does not match. Shared PINs return every match.
 * @param {Array<{ driver_id?: string, name?: string }>} drivers
 * @param {import('./clockKiosk.js').PinFile | Record<string, { pin?: string }>} pins
 * @param {unknown} pin
 * @returns {Array<{ driver_id: string, name: string }>}
 */
export function driversForPin(drivers, pins, pin) {
  assertPin(pin);
  const matches = [];
  for (const driver of drivers || []) {
    const id = String(driver?.driver_id || '').trim();
    if (!id) continue;
    try {
      assertPinMatches(pins, id, pin);
    } catch (error) {
      const status = Number(error?.status) || 400;
      if (status === 401 || status === 400) continue;
      throw error;
    }
    matches.push({ driver_id: id, name: String(driver?.name || '') });
  }
  matches.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return matches;
}

export function assertPinMatches(pins, driverId, pin) {
  const stored = normalizePinFile(pins)[driverId];
  if (!stored) {
    fail('No PIN on file. Ask the office to set one.');
  }
  if (String(pin ?? '').trim() !== stored.pin) {
    fail('That PIN does not match.', 401);
  }
}

export function normalizePunch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('Each punch must be an object.');
  }
  const record = (raw);
  const id = String(record.id || '').trim();
  const driver_id = String(record.driver_id || '').trim();
  const driver_name = String(record.driver_name || '').trim();
  if (!id || !driver_id || !driver_name) {
    fail('A punch is missing a driver.');
  }
  const note = assertNote(record.note);
  const punched_at = assertTimestamp(record.punched_at);
  return {
    id,
    driver_id,
    driver_name,
    action: assertAction(record.action),
    punched_at,
    note,
    note_at: note ? assertTimestamp(record.note_at || punched_at) : null,
    reason_codes: normalizePunchReasonCodes(record.reason_codes),
  };
}

export function normalizePunchLog(raw) {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray( (raw).punches)
      ? (raw).punches
      : null;
  if (!list) fail('clock-punches.json must contain a JSON array.');
  return list.map((row) => normalizePunch(row));
}

export function appendPunch(punches, input) {
  const note = assertNote(input.note);
  const punched_at = input.punched_at;
  const punch = normalizePunch({
    id: createId(),
    driver_id: input.driver_id,
    driver_name: input.driver_name,
    action: input.action,
    punched_at,
    note,
    note_at: note ? input.now || punched_at : null,
    reason_codes: selectReasonCodes([], input.reason_code_ids ?? [], input.catalog ?? []),
  });
  return { punches: [...normalizePunchLog(punches), punch], punch };
}

export function changePunch(punches, id, patch, context = {}) {
  const list = normalizePunchLog(punches);
  const index = list.findIndex((row) => row.id === id);
  if (index < 0) fail('Punch not found.', 404);
  const current = list[index];
  const note = applyNote(current, patch.note, context.now);
  const next = normalizePunch({
    ...current,
    action: patch.action === undefined ? current.action : patch.action,
    punched_at: patch.punched_at === undefined ? current.punched_at : patch.punched_at,
    note: note.note,
    note_at: note.note_at,
    reason_codes:
      patch.reason_code_ids === undefined
        ? current.reason_codes
        : selectReasonCodes(current.reason_codes, patch.reason_code_ids, context.catalog ?? []),
  });
  const updated = list.slice();
  updated[index] = next;
  return { punches: updated, punch: next };
}

// A driver may write the note and choose reason codes on their own record.
// The note time changes only when the words change.
export function annotatePunch(punches, id, input) {
  const list = normalizePunchLog(punches);
  const index = list.findIndex((row) => row.id === id);
  if (index < 0) fail('Punch not found.', 404);
  const current = list[index];
  if (current.driver_id !== String(input.driver_id || '').trim()) {
    fail('That record is for a different driver.', 403);
  }
  return changePunch(
    list,
    id,
    {
      note: input.note,
      reason_code_ids: input.reason_code_ids,
    },
    { now: input.now, catalog: input.catalog }
  );
}

function applyNote(current, note, now) {
  if (note === undefined) {
    return { note: current.note, note_at: current.note_at };
  }
  const text = assertNote(note);
  if (text === current.note) {
    return { note: current.note, note_at: current.note_at };
  }
  return {
    note: text,
    note_at: text ? assertTimestamp(now) : null,
  };
}

export function removePunch(punches, id) {
  const list = normalizePunchLog(punches);
  const next = list.filter((row) => row.id !== id);
  if (next.length === list.length) fail('Punch not found.', 404);
  return next;
}

export function routesForDriver(routeState, driverId) {
  if (!routeState || typeof routeState !== 'object') return [];
  return Object.entries(routeState)
    .filter(([, entry]) => entry?.driver_id === driverId)
    .map(([routeId]) => routeId)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// Each driver's latest punch: in or out. Drivers with no punch are omitted.
export function latestStatusByDriver(punches) {
  const latest = new Map();
  for (const punch of normalizePunchLog(punches)) {
    const prev = latest.get(punch.driver_id);
    if (!prev || punch.punched_at >= prev.punched_at) latest.set(punch.driver_id, punch);
  }
  const status = {};
  for (const [driverId, punch] of latest) status[driverId] = punch.action;
  return status;
}

// Names for the door screen. The door list omits the PIN itself.
// The office list includes it when includePin is set.
export function buildRoster(drivers, routeState, pins, options = {}) {
  const pinFile = normalizePinFile(pins);
  const includePin = options.includePin === true;
  const statusByDriver = options.statusByDriver ?? {};
  return [...(drivers ?? [])]
    .filter((driver) => driver?.driver_id && driver?.name)
    .map((driver) => {
      const stored = pinFile[driver.driver_id];
      const status = statusByDriver[driver.driver_id];
      const row = {
        driver_id: driver.driver_id,
        name: driver.name,
        kind: driver.kind === 'substitute' ? 'substitute' : 'route',
        routes: routesForDriver(routeState, driver.driver_id),
        pin_set: Boolean(stored),
        clock_status: status === 'in' ? 'in' : 'out',
      };
      if (includePin) row.pin = stored?.pin ?? null;
      return row;
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function validLockCode(code) {
  return LOCK_CODE_PATTERN.test(String(code ?? '').trim());
}

export function normalizeKioskSettings(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const unlock_pin = String( (source).unlock_pin ?? '').trim();
  return {
    unlock_pin: validLockCode(unlock_pin) ? unlock_pin : DEFAULT_KIOSK_CODE,
  };
}

export function assertKioskCode(settings, code) {
  if (String(code ?? '').trim() !== settings.unlock_pin) {
    fail('That lock code does not match.', 401);
  }
}

export function requestHasKioskLock(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .some((part) => part.trim() === `${KIOSK_COOKIE}=1`);
}

export function kioskCookieHeader(locked) {
  const base = `${KIOSK_COOKIE}=${locked ? '1' : ''}; Path=/; HttpOnly; SameSite=Lax`;
  return locked ? base : `${base}; Max-Age=0`;
}

// Newest first. Prefer the directory name when the driver is still on file.
export function presentPunches(punches, drivers) {
  const names = new Map((drivers ?? []).map((driver) => [driver.driver_id, driver.name]));
  return normalizePunchLog(punches)
    .map((punch) => ({
      ...punch,
      driver_name: names.get(punch.driver_id) || punch.driver_name,
    }))
    .sort((a, b) => b.punched_at.localeCompare(a.punched_at) || b.id.localeCompare(a.id));
}
