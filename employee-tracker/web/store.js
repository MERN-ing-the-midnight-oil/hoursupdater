export const STORAGE_KEY = 'my-hours-tracker.v1';
export const DISMISSED_NOTIFICATIONS_KEY = 'my-hours-tracker.notify-dismissed.v1';

export function emptyState() {
  return {
    version: 1,
    currentProfileId: null,
    profiles: {},
  };
}

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

export function saveState(state, storage = globalThis.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

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

export function getCurrentProfile(storage = globalThis.localStorage) {
  const state = loadState(storage);
  if (!state.currentProfileId) {
    return null;
  }
  return state.profiles[state.currentProfileId] ?? null;
}

export function setCurrentProfile(id, storage = globalThis.localStorage) {
  const state = loadState(storage);
  if (!state.profiles[id]) {
    throw new Error('That person is not saved in this browser.');
  }
  state.currentProfileId = id;
  saveState(state, storage);
  return state.profiles[id];
}

export function saveProfile(profile, storage = globalThis.localStorage) {
  const state = loadState(storage);
  state.profiles[profile.id] = profile;
  state.currentProfileId = profile.id;
  saveState(state, storage);
  return profile;
}

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

export function exportState(storage = globalThis.localStorage) {
  return JSON.stringify(loadState(storage), null, 2);
}

function parseDismissedMap(raw) {
  try {
    const parsed = raw ? JSON.parse(String(raw)) : {};
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
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

export function importState(json, storage = globalThis.localStorage) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.profiles) {
    throw new Error('That file is not a My Teamster Contract Date Calculator backup.');
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
