/**
 * Door clock: a driver picks their name, enters a PIN, and records either a
 * clock-in or a clock-out. Each tap is its own record. A record can carry one
 * note, stamped when it was written, and any number of reason codes from the
 * office list. This log does not decide whether they were already in or out,
 * and it does not change contracted route clocks.
 */

import { createId } from './createId.js';

const PIN_PATTERN = /^\d{4}$/;
const LOCK_CODE_PATTERN = /^[A-Za-z0-9]{4,64}$/;
const NOTE_MAX = 500;
const REASON_LABEL_MAX = 60;

/** Lock code that leaves the driver clock screen. Not a driver PIN. */
export const DEFAULT_KIOSK_CODE = 'TeamsterTracker2026';

export const KIOSK_COOKIE = 'clock_kiosk';

/**
 * @typedef {'in' | 'out'} ClockAction
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 * }} ReasonCode
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 * }} PunchReasonCode
 *
 * @typedef {{
 *   id: string,
 *   driver_id: string,
 *   driver_name: string,
 *   action: ClockAction,
 *   punched_at: string,
 *   note: string,
 *   note_at: string | null,
 *   reason_codes: PunchReasonCode[],
 * }} ClockPunch
 *
 * @typedef {{ pin: string, updated_at: string }} PinRecord
 * @typedef {Record<string, PinRecord>} PinFile
 */

/**
 * @param {string} message
 * @param {number} [status]
 */
function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

/**
 * @param {unknown} pin
 * @returns {string}
 */
export function assertPin(pin) {
  const value = String(pin ?? '').trim();
  if (!PIN_PATTERN.test(value)) {
    fail('PIN must be 4 digits.');
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function assertTimestamp(value) {
  const text = String(value ?? '').trim();
  const time = Date.parse(text);
  if (!text || Number.isNaN(time)) {
    fail('That time is not valid.');
  }
  return new Date(time).toISOString();
}

/**
 * @param {unknown} action
 * @returns {ClockAction}
 */
export function assertAction(action) {
  if (action !== 'in' && action !== 'out') {
    fail('Choose clock in or clock out.');
  }
  return action;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function assertNote(value) {
  const text = String(value ?? '').trim();
  if (text.length > NOTE_MAX) {
    fail(`A note can be ${NOTE_MAX} characters or fewer.`);
  }
  return text;
}

/**
 * @param {ReasonCode[]} codes
 * @param {unknown} label
 * @param {string} [exceptId]
 * @returns {string}
 */
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

/**
 * @param {unknown} raw
 * @returns {PunchReasonCode[]}
 */
function normalizePunchReasonCodes(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) fail('Reason codes must be a list.');
  /** @type {PunchReasonCode[]} */
  const codes = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail('Each reason code needs a name.');
    }
    const record = /** @type {Record<string, unknown>} */ (item);
    const id = String(record.id || '').trim();
    const label = String(record.label || '').trim();
    if (!id || !label) fail('Each reason code needs a name.');
    if (seen.has(id)) continue;
    seen.add(id);
    codes.push({ id, label });
  }
  return codes;
}

/**
 * @param {unknown} raw
 * @returns {ReasonCode[]}
 */
export function normalizeReasonCodeList(raw) {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray(/** @type {{ codes?: unknown }} */ (raw).codes)
      ? /** @type {{ codes: unknown[] }} */ (raw).codes
      : null;
  if (!list) {
    if (raw == null) return [];
    fail('clock-reason-codes.json must contain a JSON array.');
  }
  return normalizePunchReasonCodes(list);
}

/**
 * Keep codes already stored on the record when they have left the office list.
 * New picks must still be on that list.
 * @param {PunchReasonCode[]} current
 * @param {unknown} rawIds
 * @param {ReasonCode[]} catalog
 * @returns {PunchReasonCode[]}
 */
export function selectReasonCodes(current, rawIds, catalog) {
  if (!Array.isArray(rawIds)) fail('Reason codes must be a list.');
  const live = new Map(normalizeReasonCodeList(catalog).map((code) => [code.id, code]));
  const previous = new Map(normalizePunchReasonCodes(current).map((code) => [code.id, code]));
  /** @type {PunchReasonCode[]} */
  const next = [];
  const seen = new Set();
  for (const rawId of rawIds) {
    const id = String(rawId ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const fromList = live.get(id);
    if (fromList) {
      next.push({ id: fromList.id, label: fromList.label });
      continue;
    }
    const kept = previous.get(id);
    if (kept) {
      next.push(kept);
      continue;
    }
    fail('That reason code is not on the list.');
  }
  return next;
}

/** Starting list for the door clock. The office can rename, add, or remove these. */
export const DEFAULT_REASON_CODES = [
  { id: 'reason-fueling-bus', label: 'Fueling Bus' },
  { id: 'reason-traffic', label: 'Traffic' },
  { id: 'reason-delay-at-stop-or-school', label: 'Delay at Stop or School' },
  { id: 'reason-meeting', label: 'Meeting' },
  { id: 'reason-paperwork', label: 'Paperwork' },
];

/**
 * @param {ReasonCode[]} codes
 * @param {unknown} label
 * @returns {ReasonCode[]}
 */
export function addReasonCode(codes, label) {
  const list = normalizeReasonCodeList(codes);
  return [...list, { id: createId(), label: assertReasonLabel(list, label) }];
}

/**
 * @param {ReasonCode[]} codes
 * @param {string} id
 * @param {unknown} label
 * @returns {ReasonCode[]}
 */
export function renameReasonCode(codes, id, label) {
  const list = normalizeReasonCodeList(codes);
  const codeId = String(id || '').trim();
  const index = list.findIndex((code) => code.id === codeId);
  if (index < 0) fail('Reason code not found.', 404);
  const next = list.slice();
  next[index] = { id: codeId, label: assertReasonLabel(list, label, codeId) };
  return next;
}

/**
 * @param {ReasonCode[]} codes
 * @param {string} id
 * @returns {ReasonCode[]}
 */
export function removeReasonCode(codes, id) {
  const list = normalizeReasonCodeList(codes);
  const codeId = String(id || '').trim();
  const next = list.filter((code) => code.id !== codeId);
  if (next.length === list.length) fail('Reason code not found.', 404);
  return next;
}

/**
 * A renamed code keeps the same meaning, so records show the new name.
 * @param {ClockPunch[]} punches
 * @param {string} codeId
 * @param {string} label
 * @returns {ClockPunch[]}
 */
export function relabelReasonCode(punches, codeId, label) {
  const id = String(codeId || '').trim();
  const text = String(label || '').trim();
  return normalizePunchLog(punches).map((punch) => ({
    ...punch,
    reason_codes: punch.reason_codes.map((code) => (code.id === id ? { id, label: text } : code)),
  }));
}

/**
 * PINs are stored as written so the office can look them up.
 * An older hashed entry has no recoverable number, so it is dropped.
 * @param {unknown} raw
 * @returns {PinFile}
 */
export function normalizePinFile(raw) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail('clock-pins.json must contain a JSON object.');
  }
  /** @type {PinFile} */
  const pins = {};
  for (const [driverId, value] of Object.entries(raw)) {
    const id = String(driverId || '').trim();
    if (!id || !value || typeof value !== 'object' || Array.isArray(value)) {
      fail('Each PIN entry needs a driver and a PIN.');
    }
    const record = /** @type {Record<string, unknown>} */ (value);
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

/**
 * @param {PinFile} pins
 * @param {string} driverId
 * @param {unknown} pin
 * @param {string} now
 * @returns {PinFile}
 */
export function setPin(pins, driverId, pin, now) {
  const id = String(driverId || '').trim();
  if (!id) fail('Driver not found.', 404);
  return {
    ...normalizePinFile(pins),
    [id]: { pin: assertPin(pin), updated_at: assertTimestamp(now) },
  };
}

/**
 * @param {PinFile} pins
 * @param {string} driverId
 * @param {unknown} pin
 */
export function assertPinMatches(pins, driverId, pin) {
  const stored = normalizePinFile(pins)[driverId];
  if (!stored) {
    fail('No PIN on file. Ask the office to set one.');
  }
  if (String(pin ?? '').trim() !== stored.pin) {
    fail('That PIN does not match.', 401);
  }
}

/**
 * @param {unknown} raw
 * @returns {ClockPunch}
 */
export function normalizePunch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('Each punch must be an object.');
  }
  const record = /** @type {Record<string, unknown>} */ (raw);
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

/**
 * @param {unknown} raw
 * @returns {ClockPunch[]}
 */
export function normalizePunchLog(raw) {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray(/** @type {{ punches?: unknown }} */ (raw).punches)
      ? /** @type {{ punches: unknown[] }} */ (raw).punches
      : null;
  if (!list) fail('clock-punches.json must contain a JSON array.');
  return list.map((row) => normalizePunch(row));
}

/**
 * @param {ClockPunch[]} punches
 * @param {{
 *   driver_id: string,
 *   driver_name: string,
 *   action: unknown,
 *   punched_at: string,
 *   note?: unknown,
 *   now?: string,
 *   reason_code_ids?: unknown,
 *   catalog?: ReasonCode[],
 * }} input
 * @returns {{ punches: ClockPunch[], punch: ClockPunch }}
 */
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

/**
 * @param {ClockPunch[]} punches
 * @param {string} id
 * @param {{
 *   action?: unknown,
 *   punched_at?: unknown,
 *   note?: unknown,
 *   reason_code_ids?: unknown,
 * }} patch
 * @param {{ now?: string, catalog?: ReasonCode[] }} [context]
 */
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

/**
 * A driver may write the note and choose reason codes on their own record.
 * The note time changes only when the words change.
 * @param {ClockPunch[]} punches
 * @param {string} id
 * @param {{
 *   driver_id: string,
 *   note?: unknown,
 *   reason_code_ids?: unknown,
 *   catalog: ReasonCode[],
 *   now: string,
 * }} input
 */
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

/**
 * @param {ClockPunch} current
 * @param {unknown} note
 * @param {string | undefined} now
 * @returns {{ note: string, note_at: string | null }}
 */
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

/**
 * @param {ClockPunch[]} punches
 * @param {string} id
 * @returns {ClockPunch[]}
 */
export function removePunch(punches, id) {
  const list = normalizePunchLog(punches);
  const next = list.filter((row) => row.id !== id);
  if (next.length === list.length) fail('Punch not found.', 404);
  return next;
}

/**
 * @param {Record<string, { driver_id?: string | null }> | null | undefined} routeState
 * @param {string} driverId
 * @returns {string[]}
 */
export function routesForDriver(routeState, driverId) {
  if (!routeState || typeof routeState !== 'object') return [];
  return Object.entries(routeState)
    .filter(([, entry]) => entry?.driver_id === driverId)
    .map(([routeId]) => routeId)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Each driver's latest punch: in or out. Drivers with no punch are omitted.
 * @param {ClockPunch[]} punches
 * @returns {Record<string, 'in' | 'out'>}
 */
export function latestStatusByDriver(punches) {
  /** @type {Map<string, ClockPunch>} */
  const latest = new Map();
  for (const punch of normalizePunchLog(punches)) {
    const prev = latest.get(punch.driver_id);
    if (!prev || punch.punched_at >= prev.punched_at) latest.set(punch.driver_id, punch);
  }
  /** @type {Record<string, 'in' | 'out'>} */
  const status = {};
  for (const [driverId, punch] of latest) status[driverId] = punch.action;
  return status;
}

/**
 * Names for the door screen. The door list omits the PIN itself.
 * The office list includes it when includePin is set.
 * @param {Array<{ driver_id: string, name: string }>} drivers
 * @param {Record<string, { driver_id?: string | null }> | null | undefined} routeState
 * @param {PinFile} pins
 * @param {{ includePin?: boolean, statusByDriver?: Record<string, 'in' | 'out'> }} [options]
 */
export function buildRoster(drivers, routeState, pins, options = {}) {
  const pinFile = normalizePinFile(pins);
  const includePin = options.includePin === true;
  const statusByDriver = options.statusByDriver ?? {};
  return [...(drivers ?? [])]
    .filter((driver) => driver?.driver_id && driver?.name)
    .map((driver) => {
      const stored = pinFile[driver.driver_id];
      const status = statusByDriver[driver.driver_id];
      /** @type {{ driver_id: string, name: string, routes: string[], pin_set: boolean, clock_status: 'in' | 'out' | null, pin?: string | null }} */
      const row = {
        driver_id: driver.driver_id,
        name: driver.name,
        routes: routesForDriver(routeState, driver.driver_id),
        pin_set: Boolean(stored),
        clock_status: status === 'in' || status === 'out' ? status : null,
      };
      if (includePin) row.pin = stored?.pin ?? null;
      return row;
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * @param {unknown} code
 */
export function validLockCode(code) {
  return LOCK_CODE_PATTERN.test(String(code ?? '').trim());
}

export function normalizeKioskSettings(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const unlock_pin = String(/** @type {{ unlock_pin?: unknown }} */ (source).unlock_pin ?? '').trim();
  return {
    unlock_pin: validLockCode(unlock_pin) ? unlock_pin : DEFAULT_KIOSK_CODE,
  };
}

/**
 * @param {{ unlock_pin: string }} settings
 * @param {unknown} code
 */
export function assertKioskCode(settings, code) {
  if (String(code ?? '').trim() !== settings.unlock_pin) {
    fail('That lock code does not match.', 401);
  }
}

/**
 * @param {string | undefined} cookieHeader
 */
export function requestHasKioskLock(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .some((part) => part.trim() === `${KIOSK_COOKIE}=1`);
}

/**
 * @param {boolean} locked
 */
export function kioskCookieHeader(locked) {
  const base = `${KIOSK_COOKIE}=${locked ? '1' : ''}; Path=/; HttpOnly; SameSite=Lax`;
  return locked ? base : `${base}; Max-Age=0`;
}

/**
 * Newest first. Prefer the directory name when the driver is still on file.
 * @param {ClockPunch[]} punches
 * @param {Array<{ driver_id: string, name: string }>} drivers
 */
export function presentPunches(punches, drivers) {
  const names = new Map((drivers ?? []).map((driver) => [driver.driver_id, driver.name]));
  return normalizePunchLog(punches)
    .map((punch) => ({
      ...punch,
      driver_name: names.get(punch.driver_id) || punch.driver_name,
    }))
    .sort((a, b) => b.punched_at.localeCompare(a.punched_at) || b.id.localeCompare(a.id));
}
