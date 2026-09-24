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
    };
  } catch {
    return emptyState();
  }
}

/**
 * @param {ReturnType<typeof emptyState>} state
 * @param {Storage} [storage]
 */
export function saveState(state, storage = globalThis.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
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
    throw new Error('That file is not a Transportation Timechange Calculator backup.');
  }
  const next = {
    version: 1,
    currentProfileId: parsed.currentProfileId ?? null,
    profiles: parsed.profiles,
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
