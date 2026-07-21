/**
 * Per-browser Admin notification preferences (localStorage).
 * Controls which attention events alert, which delivery channels fire, and when.
 * Shared office email templates stay on the server; these prefs do not.
 */

export const NOTIFY_PREFS_STORAGE_KEY = 'rct_admin_notify_prefs';

/** Queue statuses that contribute to the tab-badge attention count. */
export const ATTENTION_STATUSES = [
  'NEEDS_REVIEW',
  'BUMP_ELIGIBLE',
  'BID_PENDING',
];

/**
 * @typedef {{ title: string, detail: string }} NotifyPrefLabel
 */

/** @type {Record<string, NotifyPrefLabel>} */
export const ATTENTION_STATUS_LABELS = {
  NEEDS_REVIEW: {
    title:
      'A correction may change a decision that was already finalized',
    detail:
      'example: a letter already went out, then someone finds a logged time was wrong (Needs Review)',
  },
  BUMP_ELIGIBLE: {
    title:
      'A driver\'s route got shorter enough that they may want to switch routes (a "bump")',
    detail: 'example: a route dropped by 45 minutes',
  },
  BID_PENDING: {
    title: 'A route grew enough that it\'s open for other drivers to claim',
    detail: 'example: a route gained 35 minutes (Bid Pending)',
  },
};

/**
 * Email-offer event types that appear as in-app toasts today.
 * (Legacy / unused types omitted.)
 */
export const TOAST_EVENT_TYPES = [
  'WINDOW_LOCKED_IN',
  'WINDOW_BUMP_ELIGIBLE',
  'BID_AWARDED',
  'NEEDS_REVIEW_RESOLVED_CONTRADICTS_LETTER',
  'ROUTE_REASSIGNED',
  'PAYROLL_CONTRACTED_HOURS_CHANGED',
  'PAPER_BID_SIGNUP',
];

/** @type {Record<string, NotifyPrefLabel>} */
export const TOAST_EVENT_LABELS = {
  WINDOW_LOCKED_IN: {
    title:
      'A small hours change is locked in without opening the route for bid',
    detail: 'example: a route changed by 20 minutes',
  },
  WINDOW_BUMP_ELIGIBLE: {
    title:
      'You may need to email a driver whose route got shorter enough that they may want to switch',
    detail: 'example: a route dropped by 40 minutes',
  },
  BID_AWARDED: {
    title: 'Someone won an open route and it is now theirs',
    detail: 'example: after a bid is awarded',
  },
  NEEDS_REVIEW_RESOLVED_CONTRADICTS_LETTER: {
    title: 'Your decision differs from a letter that was already sent',
    detail:
      'example: you keep a route open for bid after a correction that would have locked it in',
  },
  ROUTE_REASSIGNED: {
    title: 'A route moved from one driver to another',
    detail: 'example: after a driver switches routes or wins a bid',
  },
  PAYROLL_CONTRACTED_HOURS_CHANGED: {
    title: 'The hours used for payroll were updated',
    detail: 'example: after hours are finalized or a bid is awarded',
  },
  PAPER_BID_SIGNUP: {
    title: 'Time to print or send the paper sign-up sheet for drivers',
    detail: 'for an open route that needs signatures',
  },
};

/**
 * @typedef {{
 *   channels: {
 *     toast: boolean,
 *     badge: boolean,
 *     desktop: boolean,
 *     flashOnLoad: boolean,
 *   },
 *   when: {
 *     desktopOnlyWhenHidden: boolean,
 *     quietHoursEnabled: boolean,
 *     quietHoursStart: string,
 *     quietHoursEnd: string,
 *   },
 *   triggers: {
 *     statuses: Record<string, boolean>,
 *     events: Record<string, boolean>,
 *   },
 * }} NotifyPrefs
 */

/**
 * @returns {NotifyPrefs}
 */
export function defaultNotifyPrefs() {
  /** @type {Record<string, boolean>} */
  const statuses = {};
  for (const status of ATTENTION_STATUSES) statuses[status] = true;

  /** @type {Record<string, boolean>} */
  const events = {};
  for (const type of TOAST_EVENT_TYPES) events[type] = true;

  return {
    channels: {
      toast: true,
      badge: true,
      desktop: true,
      flashOnLoad: true,
    },
    when: {
      desktopOnlyWhenHidden: false,
      quietHoursEnabled: false,
      quietHoursStart: '18:00',
      quietHoursEnd: '08:00',
    },
    triggers: { statuses, events },
  };
}

/**
 * @param {unknown} raw
 * @returns {NotifyPrefs}
 */
export function normalizeNotifyPrefs(raw) {
  const defaults = defaultNotifyPrefs();
  if (!raw || typeof raw !== 'object') return defaults;
  const src = /** @type {Record<string, any>} */ (raw);

  const channels = {
    toast: src.channels?.toast !== false,
    badge: src.channels?.badge !== false,
    desktop: src.channels?.desktop !== false,
    flashOnLoad: src.channels?.flashOnLoad !== false,
  };

  const quietStart = normalizeTimeHm(src.when?.quietHoursStart, defaults.when.quietHoursStart);
  const quietEnd = normalizeTimeHm(src.when?.quietHoursEnd, defaults.when.quietHoursEnd);

  const when = {
    desktopOnlyWhenHidden: src.when?.desktopOnlyWhenHidden === true,
    quietHoursEnabled: src.when?.quietHoursEnabled === true,
    quietHoursStart: quietStart,
    quietHoursEnd: quietEnd,
  };

  /** @type {Record<string, boolean>} */
  const statuses = {};
  for (const status of ATTENTION_STATUSES) {
    statuses[status] = src.triggers?.statuses?.[status] !== false;
  }

  /** @type {Record<string, boolean>} */
  const events = {};
  for (const type of TOAST_EVENT_TYPES) {
    events[type] = src.triggers?.events?.[type] !== false;
  }

  return { channels, when, triggers: { statuses, events } };
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeTimeHm(value, fallback) {
  const text = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

/**
 * @returns {NotifyPrefs}
 */
export function loadNotifyPrefs() {
  try {
    const raw = localStorage.getItem(NOTIFY_PREFS_STORAGE_KEY);
    if (!raw) return defaultNotifyPrefs();
    return normalizeNotifyPrefs(JSON.parse(raw));
  } catch {
    return defaultNotifyPrefs();
  }
}

/**
 * @param {NotifyPrefs} prefs
 */
export function saveNotifyPrefs(prefs) {
  const normalized = normalizeNotifyPrefs(prefs);
  localStorage.setItem(NOTIFY_PREFS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

/**
 * @param {NotifyPrefs} prefs
 * @param {string} status
 * @returns {boolean}
 */
export function isStatusTriggerEnabled(prefs, status) {
  return prefs.triggers.statuses[status] !== false;
}

/**
 * @param {NotifyPrefs} prefs
 * @param {string | null | undefined} eventType
 * @returns {boolean}
 */
export function isEventTriggerEnabled(prefs, eventType) {
  if (!eventType) return true;
  if (!(eventType in prefs.triggers.events)) return true;
  return prefs.triggers.events[eventType] !== false;
}

/**
 * @param {NotifyPrefs} prefs
 * @param {object[]} notifications
 * @returns {object[]}
 */
export function filterNotificationsByPrefs(prefs, notifications) {
  return (notifications || []).filter((note) =>
    isEventTriggerEnabled(prefs, note.event_type)
  );
}

/**
 * Quiet hours may wrap midnight (e.g. 18:00 → 08:00).
 * @param {NotifyPrefs} prefs
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isInQuietHours(prefs, now = new Date()) {
  if (!prefs.when.quietHoursEnabled) return false;
  const start = parseMinutes(prefs.when.quietHoursStart);
  const end = parseMinutes(prefs.when.quietHoursEnd);
  if (start == null || end == null) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return true;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

/**
 * @param {string} hm
 * @returns {number | null}
 */
function parseMinutes(hm) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(hm || ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Whether a new desktop OS popup should fire right now.
 * @param {NotifyPrefs} prefs
 * @param {{ permission?: NotificationPermission | 'unsupported', documentHidden?: boolean, now?: Date }} [ctx]
 * @returns {boolean}
 */
export function shouldShowDesktopPopup(prefs, ctx = {}) {
  if (!prefs.channels.desktop) return false;
  const permission = ctx.permission ?? 'denied';
  if (permission !== 'granted') return false;
  if (prefs.when.desktopOnlyWhenHidden) {
    const hidden = ctx.documentHidden ?? (typeof document !== 'undefined' && document.hidden);
    if (!hidden) return false;
  }
  if (isInQuietHours(prefs, ctx.now)) return false;
  return true;
}
