export const STORAGE_KEY = 'my-hours-tracker.v1';

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
  return Object.values(state.profiles).sort((a, b) => {
    const nameCompare = String(a.name || '').localeCompare(String(b.name || ''));
    if (nameCompare !== 0) {
      return nameCompare;
    }
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
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
    throw new Error('That person is not saved in this browser.');
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
    const remaining = Object.keys(state.profiles);
    state.currentProfileId = remaining[0] ?? null;
  }
  saveState(state, storage);
  return state.currentProfileId
    ? state.profiles[state.currentProfileId]
    : null;
}

/**
 * @param {Storage} [storage]
 */
export function exportState(storage = globalThis.localStorage) {
  return JSON.stringify(loadState(storage), null, 2);
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
    throw new Error('That file is not a My Teamster Contract Hours Tracker backup.');
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
