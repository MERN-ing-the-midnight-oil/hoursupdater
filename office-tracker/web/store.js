import { renameDriverOnRoute, sameDriver } from '../src/assignments.js';

export const STORAGE_KEY = 'transportation-timechange.v1';
export const DISMISSED_NOTIFICATIONS_KEY = 'transportation-timechange.notify-dismissed.v1';

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
    return {
      version: 1,
      currentProfileId: parsed.currentProfileId ?? null,
      profiles: parsed.profiles ?? {},
      drivers: Array.isArray(parsed.drivers) ? parsed.drivers : [],
      exampleVersion: parsed.exampleVersion ?? 0,
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
 * Drivers saved on the sheet, plus anyone named on a route who is not listed yet.
 * @param {ReturnType<typeof emptyState>} state
 */
export function driversFromState(state) {
  /** @type {Map<string, { id: string, name: string, firstName: string, lastName: string, phone: string, email: string }>} */
  const byName = new Map();
  for (const driver of state?.drivers ?? []) {
    const parts = personNameParts(driver);
    if (!parts.name) continue;
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
    if (!parts.name || byName.has(parts.name.toLowerCase())) continue;
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
  saveState(state, storage);
  return next;
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
  };
  if (next.currentProfileId && !next.profiles[next.currentProfileId]) {
    next.currentProfileId = Object.keys(next.profiles)[0] ?? null;
  }
  saveState(next, storage);
  return next;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string[]>}
 */
function parseDismissedMap(raw) {
  try {
    const parsed = raw ? JSON.parse(String(raw)) : {};
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    /** @type {Record<string, string[]>} */
    const map = {};
    for (const [profileId, ids] of Object.entries(parsed)) {
      if (!Array.isArray(ids)) continue;
      map[profileId] = ids.filter((id) => typeof id === 'string' && id);
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * @param {string | null | undefined} profileId
 * @param {Storage} [storage]
 * @returns {string[]}
 */
export function listDismissedNotificationIds(
  profileId,
  storage = globalThis.localStorage
) {
  if (!profileId) {
    return [];
  }
  const map = parseDismissedMap(storage?.getItem(DISMISSED_NOTIFICATIONS_KEY));
  return map[profileId] ?? [];
}

/**
 * @param {string} profileId
 * @param {string} notificationId
 * @param {Storage} [storage]
 * @returns {string[]}
 */
export function dismissNotificationId(
  profileId,
  notificationId,
  storage = globalThis.localStorage
) {
  if (!profileId || !notificationId) {
    return listDismissedNotificationIds(profileId, storage);
  }
  const map = parseDismissedMap(storage?.getItem(DISMISSED_NOTIFICATIONS_KEY));
  const current = map[profileId] ?? [];
  if (current.includes(notificationId)) {
    return current;
  }
  const next = [...current, notificationId];
  map[profileId] = next;
  storage.setItem(DISMISSED_NOTIFICATIONS_KEY, JSON.stringify(map));
  return next;
}
