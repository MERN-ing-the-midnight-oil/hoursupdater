import { renameDriverOnRoute, sameDriver } from '../src/assignments.js';
import { normalizeContractReminder, reminderEventSignature } from '../src/contractReminder.js';
import { normalizeDriverNotice } from '../src/noticeMail.js';

export const STORAGE_KEY = 'transportation-timechange.v1';

/**
 * @param {Storage} [storage]
 */
export function emptyState() {
  return {
    version: 1,
    currentProfileId: null,
    profiles: {},
  };
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
    return {
      version: 1,
      currentProfileId: parsed.currentProfileId ?? null,
      profiles: parsed.profiles ?? {},
      drivers: Array.isArray(parsed.drivers) ? parsed.drivers : [],
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
  /** @type {Map<string, { id: string, name: string, firstName: string, lastName: string, phone: string, email: string }>} */
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
 * @param {{ id?: string, name?: string, firstName?: string, lastName?: string, phone?: string, email?: string, previousName?: string }} driver
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
  const next = {
    id,
    name,
    firstName: parts.firstName,
    lastName: parts.lastName,
    phone: driver.phone != null ? String(driver.phone).trim() : String(existing?.phone ?? ''),
    email: String(driver.email ?? '').trim(),
  };
  const index = drivers.findIndex((item) => item.id === id);
  if (index >= 0) drivers[index] = next;
  else drivers.push(next);
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
  state.drivers = drivers;
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
 * Email wording for the notice a driver gets when clock times change.
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
    throw new Error('That file is not a Teamster Time Changes Dashboard backup.');
  }
  const next = {
    version: 1,
    currentProfileId: parsed.currentProfileId ?? null,
    profiles: parsed.profiles,
    drivers: Array.isArray(parsed.drivers) ? parsed.drivers : [],
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
