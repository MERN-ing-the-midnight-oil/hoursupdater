import {
  assignmentDriverLabel,
  emptyMessage,
  renderPendingChangesCard,
  renderRouteCard,
  setReassignRefreshHandler,
} from '../shared/queueRenderers.js';
import { appendCitationLinks } from '../shared/contractCitationUi.js';
import { enhanceGlossaryTips } from '../shared/glossaryTip.js';
import { enhanceIcons, setLabeledIcon } from '../shared/icons.js';
import {
  ATTENTION_STATUSES,
  ATTENTION_STATUS_LABELS,
  TOAST_EVENT_TYPES,
  TOAST_EVENT_LABELS,
  filterNotificationsByPrefs,
  isStatusTriggerEnabled,
  loadNotifyPrefs,
  saveNotifyPrefs,
  defaultNotifyPrefs,
  shouldShowDesktopPopup,
} from './notificationPrefs.js';
import { openMailto } from '../shared/openMailto.js';
import { initRosterImportTip } from '../shared/rosterImportTip.js';

enhanceGlossaryTips();
enhanceIcons();

/** @type {import('./notificationPrefs.js').NotifyPrefs} */
let notifyPrefs = loadNotifyPrefs();

const settingsEl = document.getElementById('settings');
const staffNamesSettingsEl = document.getElementById('settings-staff-names');
const reasonCategoriesSettingsEl = document.getElementById(
  'settings-reason-categories'
);
if (settingsEl instanceof HTMLDetailsElement) {
  const openSettingsFromHash = () => {
    const hash = window.location.hash;
    if (
      hash === '#settings' ||
      hash === '#settings-staff-names' ||
      hash === '#settings-reason-categories' ||
      hash === '#settings-notifications' ||
      hash === '#settings-bulk-import'
    ) {
      settingsEl.open = true;
    }
    if (
      hash === '#settings-staff-names' &&
      staffNamesSettingsEl instanceof HTMLDetailsElement
    ) {
      staffNamesSettingsEl.open = true;
      staffNamesSettingsEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if (
      hash === '#settings-reason-categories' &&
      reasonCategoriesSettingsEl instanceof HTMLDetailsElement
    ) {
      reasonCategoriesSettingsEl.open = true;
      reasonCategoriesSettingsEl.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
    if (hash === '#settings-notifications') {
      const notifySettingsEl = document.getElementById('settings-notifications');
      if (notifySettingsEl instanceof HTMLDetailsElement) {
        notifySettingsEl.open = true;
        notifySettingsEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
    if (hash === '#settings-bulk-import') {
      const bulkImportSettingsEl = document.getElementById('settings-bulk-import');
      if (bulkImportSettingsEl instanceof HTMLDetailsElement) {
        bulkImportSettingsEl.open = true;
        bulkImportSettingsEl.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        });
      }
    }
  };
  openSettingsFromHash();
  window.addEventListener('hashchange', openSettingsFromHash);
}

const BASE_TITLE = document.title;
const FAVICON_HREF = '/favicon.svg';
/** Quiet background refresh while the Admin tab stays open. */
const ATTENTION_POLL_MS = 45_000;

const queueStatusEl = document.getElementById('queue-status');

const lists = {
  needsReview: document.getElementById('list-needs-review'),
  accumulating: document.getElementById('list-accumulating'),
  bidPending: document.getElementById('list-bid-pending'),
  bumpEligible: document.getElementById('list-bump-eligible'),
  pendingChanges: document.getElementById('list-pending-changes'),
  stable: document.getElementById('list-stable'),
};

const sectionPreviews = {
  needsReview: document.getElementById('previews-needs-review'),
  accumulating: document.getElementById('previews-accumulating'),
  bidPending: document.getElementById('previews-bid-pending'),
  bumpEligible: document.getElementById('previews-bump-eligible'),
  pendingChanges: document.getElementById('previews-pending-changes'),
  stable: document.getElementById('previews-stable'),
};

/**
 * Fill a section summary with route · driver preview chips.
 * @param {HTMLElement | null} el
 * @param {object[]} rows
 */
function fillSectionPreviews(el, rows) {
  if (!el) return;
  el.replaceChildren();
  for (const row of rows) {
    const chip = document.createElement('span');
    chip.className = 'section-route-preview';
    chip.textContent = `${row.route_id || '—'} · ${assignmentDriverLabel(row.driver_name)}`;
    el.appendChild(chip);
  }
}

const notificationToastsEl = document.getElementById('notification-toasts');

/** @type {number} */
let pendingNotificationCount = 0;

/** Flash pending email alerts once on first Admin page load. */
let shouldFlashAlertsOnLoad = true;

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function showStatus(el, message, kind = 'ok') {
  if (!el) return;
  el.textContent = message;
  el.className = `status visible ${kind}`;
}

/**
 * Bulk-import feedback — CSV area, Settings header, and next to Commit
 * (so errors are not buried above a long preview list).
 * @param {string} message
 * @param {'ok' | 'error' | 'warn'} [kind]
 * @param {{ scrollToCommit?: boolean }} [options]
 */
function showBulkImportStatus(message, kind = 'ok', options = {}) {
  const commitStatus = document.getElementById('bulk-import-commit-status');
  showStatus(document.getElementById('bulk-import-status'), message, kind);
  showStatus(commitStatus, message, kind);
  showStatus(document.getElementById('settings-status'), message, kind);
  if (options.scrollToCommit !== false && (kind === 'error' || kind === 'warn')) {
    const target =
      commitStatus instanceof HTMLElement && !bulkImportPreviewPanel?.hidden
        ? commitStatus
        : document.getElementById('bulk-import-status');
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function fillList(listEl, nodes, emptyText) {
  listEl.innerHTML = '';
  if (!nodes.length) {
    listEl.appendChild(emptyMessage(emptyText));
    enhanceGlossaryTips(listEl);
    return;
  }
  for (const node of nodes) {
    listEl.appendChild(node);
  }
  enhanceGlossaryTips(listEl);
}

/**
 * Routes that need Admin attention — open NEEDS_REVIEW, BID_PENDING,
 * BUMP_ELIGIBLE (when enabled in prefs), plus pending email-offer notifications
 * that match enabled event triggers (`pendingNotificationCount`).
 * @param {object[]} rows
 * @returns {number}
 */
function countAttentionItems(rows) {
  const routeAttention = rows.filter((row) => isAttentionRouteStatus(row)).length;
  return routeAttention + pendingNotificationCount;
}

/**
 * Same attention statuses as the tab-badge count (piece 1), gated by prefs.
 * @param {object} row
 * @returns {boolean}
 */
function isAttentionRouteStatus(row) {
  if (
    row.status !== 'NEEDS_REVIEW' &&
    row.status !== 'BUMP_ELIGIBLE' &&
    row.status !== 'BID_PENDING'
  ) {
    return false;
  }
  return isStatusTriggerEnabled(notifyPrefs, row.status);
}

/** @type {HTMLLinkElement | null} */
let faviconLinkEl = null;
/** @type {HTMLImageElement | null} */
let baseFaviconImage = null;
/** @type {Promise<HTMLImageElement | null> | null} */
let baseFaviconPromise = null;

function ensureFaviconLink() {
  if (faviconLinkEl) return faviconLinkEl;
  faviconLinkEl =
    document.querySelector('link[rel="icon"]') ||
    document.createElement('link');
  if (!faviconLinkEl.parentNode) {
    faviconLinkEl.rel = 'icon';
    document.head.appendChild(faviconLinkEl);
  }
  return faviconLinkEl;
}

function loadBaseFavicon() {
  if (baseFaviconImage) return Promise.resolve(baseFaviconImage);
  if (baseFaviconPromise) return baseFaviconPromise;
  baseFaviconPromise = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      baseFaviconImage = img;
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = FAVICON_HREF;
  });
  return baseFaviconPromise;
}

/**
 * @param {number} count
 * @returns {string}
 */
function drawBadgedFavicon(count) {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return FAVICON_HREF;

  if (baseFaviconImage) {
    ctx.drawImage(baseFaviconImage, 0, 0, size, size);
  } else {
    ctx.fillStyle = '#1f5c4a';
    ctx.fillRect(0, 0, size, size);
  }

  const label = count > 99 ? '99+' : String(count);
  const badgeR = label.length > 1 ? 10 : 8;
  const cx = size - badgeR + 1;
  const cy = size - badgeR + 1;

  ctx.fillStyle = '#8b2e2e';
  ctx.beginPath();
  ctx.arc(cx, cy, badgeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fffcf6';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#fffcf6';
  ctx.font =
    label.length > 2
      ? 'bold 8px system-ui, sans-serif'
      : label.length > 1
        ? 'bold 9px system-ui, sans-serif'
        : 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + 0.5);

  return canvas.toDataURL('image/png');
}

/**
 * @param {number} count
 */
function updateAttentionIndicator(count) {
  const effective = notifyPrefs.channels.badge ? count : 0;
  document.title =
    effective > 0 ? `(${effective}) ${BASE_TITLE}` : BASE_TITLE;

  const link = ensureFaviconLink();
  if (effective > 0) {
    link.type = 'image/png';
    link.href = drawBadgedFavicon(effective);
  } else {
    link.type = 'image/svg+xml';
    link.href = FAVICON_HREF;
  }
}

const DESKTOP_NOTIFY_DISMISS_KEY = 'rct_admin_desktop_notify_dismissed';

/** @type {Set<string>} */
let seenDesktopAttentionKeys = new Set();
/** After first snapshot, only newly appeared attention events fire OS popups. */
let desktopAttentionPrimed = false;

/**
 * @returns {boolean}
 */
function desktopNotificationsSupported() {
  return typeof window.Notification === 'function';
}

/**
 * @returns {'unsupported' | NotificationPermission}
 */
function desktopNotificationPermission() {
  if (!desktopNotificationsSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Opt-in banner only when the API exists, desktop channel is on, and
 * permission has not been decided.
 */
function refreshDesktopNotifyBanner() {
  const banner = document.getElementById('desktop-notify-banner');
  if (!(banner instanceof HTMLElement)) return;

  const permission = desktopNotificationPermission();
  const dismissed = localStorage.getItem(DESKTOP_NOTIFY_DISMISS_KEY) === '1';
  const show =
    notifyPrefs.channels.desktop &&
    permission === 'default' &&
    !dismissed;
  banner.hidden = !show;
  refreshDesktopPermissionStatus();
}

/**
 * Short OS title from the in-app toast prompt (text before the em dash).
 * @param {string | null | undefined} prompt
 * @returns {string}
 */
function desktopTitleFromPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return 'Admin alert';
  const cut = text.indexOf(' — ');
  return cut > 0 ? text.slice(0, cut) : text;
}

/**
 * @param {object} row
 * @returns {string}
 */
function desktopTitleForAttentionRoute(row) {
  const route = row.route_id || '—';
  switch (row.status) {
    case 'NEEDS_REVIEW':
      return `Route ${route} needs review`;
    case 'BUMP_ELIGIBLE':
      return `Route ${route} is bump-eligible`;
    case 'BID_PENDING':
      return `Route ${route} is bid pending`;
    default:
      return `Route ${route} needs attention`;
  }
}

/**
 * One attention event → one desktop delivery key. Pending email toasts cover
 * their route so we do not also fire a separate route-status popup for the
 * same underlying event.
 * @param {object[]} rows
 * @param {object[]} notifications
 * @returns {{ key: string, title: string, body: string }[]}
 */
function collectDesktopAttentionEvents(rows, notifications) {
  /** @type {{ key: string, title: string, body: string }[]} */
  const events = [];
  /** @type {Set<string>} */
  const routesCoveredByToast = new Set();

  for (const note of notifications) {
    const id = String(note.id || '').trim();
    if (!id) continue;
    const routeId = String(note.route_id || '').trim();
    if (routeId) routesCoveredByToast.add(routeId);
    events.push({
      key: `note:${id}`,
      title: desktopTitleFromPrompt(note.prompt),
      body: 'Click to review',
    });
  }

  for (const row of rows) {
    if (!isAttentionRouteStatus(row)) continue;
    const routeId = String(row.route_id || '').trim();
    if (!routeId || routesCoveredByToast.has(routeId)) continue;
    events.push({
      key: `route:${routeId}:${row.status}`,
      title: desktopTitleForAttentionRoute(row),
      body: 'Click to review',
    });
  }

  return events;
}

/**
 * @param {{ key: string, title: string, body: string }} event
 */
function showDesktopAttentionPopup(event) {
  if (
    !shouldShowDesktopPopup(notifyPrefs, {
      permission: desktopNotificationPermission(),
      documentHidden: document.hidden,
    })
  ) {
    return;
  }
  try {
    const popup = new Notification(event.title, {
      body: event.body,
      tag: event.key,
      renotify: false,
      icon: FAVICON_HREF,
    });
    popup.onclick = () => {
      window.focus();
      popup.close();
    };
  } catch {
    // Notification construction can throw if permission flips mid-flight.
  }
}

/**
 * Second delivery channel for the same attention stream as toasts + tab badge.
 * Primes on first snapshot (and after opt-in) so existing items do not spam.
 * @param {object[]} rows
 * @param {object[]} notifications
 */
function syncDesktopAttentionNotifications(rows, notifications) {
  const filteredNotes = filterNotificationsByPrefs(notifyPrefs, notifications);
  const events = collectDesktopAttentionEvents(rows, filteredNotes);
  const nextKeys = new Set(events.map((event) => event.key));

  if (!desktopAttentionPrimed) {
    seenDesktopAttentionKeys = nextKeys;
    desktopAttentionPrimed = true;
    return;
  }

  const canPopup = shouldShowDesktopPopup(notifyPrefs, {
    permission: desktopNotificationPermission(),
    documentHidden: document.hidden,
  });
  if (canPopup) {
    for (const event of events) {
      if (seenDesktopAttentionKeys.has(event.key)) continue;
      showDesktopAttentionPopup(event);
    }
  }

  seenDesktopAttentionKeys = nextKeys;
}

function initDesktopNotifyOptIn() {
  refreshDesktopNotifyBanner();

  document
    .getElementById('desktop-notify-enable')
    ?.addEventListener('click', async () => {
      await requestDesktopNotificationPermission();
    });

  document
    .getElementById('desktop-notify-dismiss')
    ?.addEventListener('click', () => {
      localStorage.setItem(DESKTOP_NOTIFY_DISMISS_KEY, '1');
      refreshDesktopNotifyBanner();
    });
}

/**
 * @returns {Promise<NotificationPermission | 'unsupported'>}
 */
async function requestDesktopNotificationPermission() {
  if (!desktopNotificationsSupported()) {
    refreshDesktopNotifyBanner();
    return 'unsupported';
  }
  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  localStorage.removeItem(DESKTOP_NOTIFY_DISMISS_KEY);
  // Re-prime so currently visible alerts do not all fire at once on grant.
  desktopAttentionPrimed = false;
  refreshDesktopNotifyBanner();
  if (permission === 'granted') {
    loadQueue({ silent: true }).catch(() => {});
  }
  return permission;
}

function refreshDesktopPermissionStatus() {
  const statusEl = document.getElementById('notify-desktop-permission-status');
  const enableBtn = document.getElementById('notify-desktop-enable');
  if (!(statusEl instanceof HTMLElement)) return;

  const permission = desktopNotificationPermission();
  if (permission === 'unsupported') {
    statusEl.textContent =
      'This browser does not support desktop notifications.';
    if (enableBtn) enableBtn.hidden = true;
    return;
  }
  if (permission === 'granted') {
    statusEl.textContent = 'Desktop permission: allowed on this browser.';
    if (enableBtn) enableBtn.hidden = true;
    return;
  }
  if (permission === 'denied') {
    statusEl.textContent =
      'Desktop permission: blocked. Use the browser site settings to allow notifications for this site, then reload.';
    if (enableBtn) enableBtn.hidden = true;
    return;
  }
  statusEl.textContent =
    'Desktop permission: not enabled yet. Click below to allow OS pop-ups (only works while this tab is open).';
  if (enableBtn) enableBtn.hidden = !notifyPrefs.channels.desktop;
}

/**
 * Persist prefs from the Settings form and refresh attention channels.
 * @param {boolean} [announce]
 */
function commitNotifyPrefsFromForm(announce = true) {
  const next = readNotifyPrefsFromForm();
  notifyPrefs = saveNotifyPrefs(next);
  refreshDesktopNotifyBanner();
  // Re-prime desktop keys so toggling triggers does not replay old events.
  desktopAttentionPrimed = false;
  if (announce) {
    showStatus(
      document.getElementById('notify-prefs-status'),
      'Notification preferences saved on this browser.',
      'ok'
    );
  }
  loadQueue({ silent: true }).catch(() => {});
}

/**
 * @returns {import('./notificationPrefs.js').NotifyPrefs}
 */
function readNotifyPrefsFromForm() {
  const desktop = document.getElementById('notify-channel-desktop');
  const quietEnabled = document.getElementById('notify-quiet-enabled');
  const quietStart = document.getElementById('notify-quiet-start');
  const quietEnd = document.getElementById('notify-quiet-end');

  /** @type {Record<string, boolean>} */
  const statuses = {};
  for (const status of ATTENTION_STATUSES) {
    const input = document.getElementById(`notify-status-${status}`);
    statuses[status] =
      input instanceof HTMLInputElement ? input.checked : true;
  }

  /** @type {Record<string, boolean>} */
  const events = {};
  for (const type of TOAST_EVENT_TYPES) {
    const input = document.getElementById(`notify-event-${type}`);
    events[type] = input instanceof HTMLInputElement ? input.checked : true;
  }

  return {
    channels: {
      // Channel toggles beyond desktop are no longer on the form; keep stored values.
      toast: notifyPrefs.channels.toast !== false,
      badge: notifyPrefs.channels.badge !== false,
      desktop: desktop instanceof HTMLInputElement ? desktop.checked : true,
      flashOnLoad: notifyPrefs.channels.flashOnLoad !== false,
    },
    when: {
      desktopOnlyWhenHidden: notifyPrefs.when.desktopOnlyWhenHidden === true,
      quietHoursEnabled:
        quietEnabled instanceof HTMLInputElement ? quietEnabled.checked : false,
      quietHoursStart:
        quietStart instanceof HTMLInputElement && quietStart.value
          ? quietStart.value
          : '18:00',
      quietHoursEnd:
        quietEnd instanceof HTMLInputElement && quietEnd.value
          ? quietEnd.value
          : '08:00',
    },
    triggers: { statuses, events },
  };
}

/**
 * @param {import('./notificationPrefs.js').NotifyPrefs} prefs
 */
function writeNotifyPrefsToForm(prefs) {
  const setChecked = (id, value) => {
    const el = document.getElementById(id);
    if (el instanceof HTMLInputElement) el.checked = value;
  };
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el instanceof HTMLInputElement) el.value = value;
  };

  setChecked('notify-channel-desktop', prefs.channels.desktop);
  setChecked('notify-quiet-enabled', prefs.when.quietHoursEnabled);
  setValue('notify-quiet-start', prefs.when.quietHoursStart);
  setValue('notify-quiet-end', prefs.when.quietHoursEnd);

  for (const status of ATTENTION_STATUSES) {
    setChecked(`notify-status-${status}`, prefs.triggers.statuses[status] !== false);
  }
  for (const type of TOAST_EVENT_TYPES) {
    setChecked(`notify-event-${type}`, prefs.triggers.events[type] !== false);
  }

  const quietRow = document.querySelector('.notify-quiet-hours-row');
  if (quietRow instanceof HTMLElement) {
    quietRow.hidden = !prefs.when.quietHoursEnabled;
  }
  refreshDesktopPermissionStatus();
}

/**
 * @param {{ title: string, detail: string } | string} labelInfo
 * @param {string} inputId
 * @param {boolean} checked
 * @returns {HTMLLabelElement}
 */
function createNotifyPrefCheckbox(labelInfo, inputId, checked) {
  const label = document.createElement('label');
  label.className = 'field checkbox-field checkbox-field-after';
  const textSpan = document.createElement('span');
  textSpan.className = 'checkbox-field-text';
  if (labelInfo && typeof labelInfo === 'object') {
    const title = document.createElement('strong');
    title.className = 'checkbox-field-title';
    title.textContent = labelInfo.title;
    textSpan.append(title, document.createTextNode(` — ${labelInfo.detail}`));
  } else {
    textSpan.textContent = String(labelInfo || inputId);
  }
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = inputId;
  input.checked = checked;
  label.append(textSpan, input);
  return label;
}

function buildNotifyTriggerCheckboxes() {
  const root = document.getElementById('notify-trigger-list');
  if (!root) return;
  root.innerHTML = '';
  for (const status of ATTENTION_STATUSES) {
    root.appendChild(
      createNotifyPrefCheckbox(
        ATTENTION_STATUS_LABELS[status] || status,
        `notify-status-${status}`,
        notifyPrefs.triggers.statuses[status] !== false
      )
    );
  }
  for (const type of TOAST_EVENT_TYPES) {
    root.appendChild(
      createNotifyPrefCheckbox(
        TOAST_EVENT_LABELS[type] || type,
        `notify-event-${type}`,
        notifyPrefs.triggers.events[type] !== false
      )
    );
  }
}

function initNotifyPrefsSettings() {
  buildNotifyTriggerCheckboxes();
  writeNotifyPrefsToForm(notifyPrefs);

  const root = document.getElementById('settings-notifications');
  if (!root) return;

  const onChange = () => {
    const quietEnabled = document.getElementById('notify-quiet-enabled');
    const quietRow = document.querySelector('.notify-quiet-hours-row');
    if (
      quietRow instanceof HTMLElement &&
      quietEnabled instanceof HTMLInputElement
    ) {
      quietRow.hidden = !quietEnabled.checked;
    }
    commitNotifyPrefsFromForm(true);
  };

  root.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', onChange);
  });

  document
    .getElementById('notify-desktop-enable')
    ?.addEventListener('click', async () => {
      await requestDesktopNotificationPermission();
    });

  document.getElementById('notify-prefs-reset')?.addEventListener('click', () => {
    notifyPrefs = saveNotifyPrefs(defaultNotifyPrefs());
    writeNotifyPrefsToForm(notifyPrefs);
    desktopAttentionPrimed = false;
    refreshDesktopNotifyBanner();
    showStatus(
      document.getElementById('notify-prefs-status'),
      'Notification preferences reset to defaults on this browser.',
      'ok'
    );
    loadQueue({ silent: true }).catch(() => {});
  });
}

/**
 * @param {object[]} rows
 * @param {{
 *   payrollEmailConfigured?: boolean,
 *   electronicBidSignupEnabled?: boolean,
 *   paperBidSignupEnabled?: boolean,
 * }} [options]
 */
function renderQueue(rows, options = {}) {
  const needsReview = rows.filter(
    (row) => row.status === 'NEEDS_REVIEW' || row.has_self_resolved_review
  );
  const accumulating = rows.filter((row) => row.status === 'ACCUMULATING');
  const bidPending = rows.filter((row) => row.status === 'BID_PENDING');
  const bumpEligible = rows.filter((row) => row.status === 'BUMP_ELIGIBLE');
  const pendingBehindReview = rows.filter(
    (row) =>
      row.status === 'NEEDS_REVIEW' && (row.pending_change_ids?.length ?? 0) > 0
  );
  const stable = rows.filter((row) => row.status === 'STABLE');

  fillSectionPreviews(sectionPreviews.needsReview, needsReview);
  fillSectionPreviews(sectionPreviews.accumulating, accumulating);
  fillSectionPreviews(sectionPreviews.bidPending, bidPending);
  fillSectionPreviews(sectionPreviews.bumpEligible, bumpEligible);
  fillSectionPreviews(sectionPreviews.pendingChanges, pendingBehindReview);
  fillSectionPreviews(sectionPreviews.stable, stable);

  const cardOptions = {
    showNotifyPayroll: false,
    payrollEmailConfigured: options.payrollEmailConfigured !== false,
    electronicBidSignupEnabled: options.electronicBidSignupEnabled === true,
    paperBidSignupEnabled: options.paperBidSignupEnabled === true,
    onPayrollNotified: () => {
      loadQueue().catch((error) =>
        showStatus(queueStatusEl, error.message, 'error')
      );
    },
    onOpenBidNotified: () => {
      loadQueue().catch((error) =>
        showStatus(queueStatusEl, error.message, 'error')
      );
    },
    onReviewResolved: () => {
      loadQueue().catch((error) =>
        showStatus(queueStatusEl, error.message, 'error')
      );
      loadNotifications().catch(() => {});
    },
    onBumpDecided: () => {
      loadQueue().catch((error) =>
        showStatus(queueStatusEl, error.message, 'error')
      );
      loadNotifications().catch(() => {});
    },
  };

  fillList(
    lists.needsReview,
    needsReview.map((row) => renderRouteCard(row, 'needs-review', cardOptions)),
    'No routes need review right now.'
  );
  fillList(
    lists.accumulating,
    accumulating.map((row) =>
      renderRouteCard(row, 'accumulating', cardOptions)
    ),
    'No accumulating windows.'
  );
  fillList(
    lists.bidPending,
    bidPending.map((row) => renderRouteCard(row, 'bid-pending', cardOptions)),
    'No bid-pending routes.'
  );
  fillList(
    lists.bumpEligible,
    bumpEligible.map((row) =>
      renderRouteCard(row, 'bump-eligible', cardOptions)
    ),
    'No bump-eligible routes.'
  );
  fillList(
    lists.pendingChanges,
    pendingBehindReview.map((row) => renderPendingChangesCard(row)),
    'No changes queued behind a review.'
  );
  fillList(
    lists.stable,
    stable.map((row) => renderRouteCard(row, 'stable', cardOptions)),
    'No stable routes.'
  );
}

/** @type {{ payroll_email: string, payroll_cc?: string, message_template: string } | null} */
let payrollSettings = null;

/** @type {object | null} */
let emailTemplatesSettings = null;

/** @type {{
 *   electronic_bid_signup_enabled: boolean,
 *   bid_signup_workbook: string,
 *   open_bid_posting_to_email: string,
 *   paper_bid_signup_enabled: boolean,
 *   paper_bid_sheet: { title: string, intro: string, footer: string },
 * } | null} */
let appSettings = null;

const payrollEmailInput = document.getElementById('payroll-email');
const payrollCcInput = document.getElementById('payroll-cc');
const payrollEmailCurrentEl = document.getElementById('payroll-email-current');
const payrollCcCurrentEl = document.getElementById('payroll-cc-current');
const emailTemplatesRoot = document.getElementById('email-templates-root');
const electronicBidEnabledInput = document.getElementById(
  'electronic-bid-signup-enabled'
);
const electronicBidFeatureToggle = document.getElementById(
  'electronic-bid-feature-toggle'
);
const electronicBidStateLabel = document.getElementById(
  'electronic-bid-signup-state-label'
);
const electronicBidSummaryStatus = document.getElementById(
  'electronic-bid-signup-summary-status'
);
const bidSignupWorkbookInput = document.getElementById('bid-signup-workbook');
const openBidToEmailInput = document.getElementById('open-bid-posting-to-email');
const paperBidEnabledInput = document.getElementById('paper-bid-signup-enabled');
const paperBidFeatureToggle = document.getElementById('paper-bid-feature-toggle');
const paperBidStateLabel = document.getElementById('paper-bid-signup-state-label');
const paperBidSummaryStatus = document.getElementById(
  'paper-bid-signup-summary-status'
);
const paperBidSheetTitleInput = document.getElementById('paper-bid-sheet-title');
const paperBidSheetIntroInput = document.getElementById('paper-bid-sheet-intro');
const paperBidSheetFooterInput = document.getElementById('paper-bid-sheet-footer');

/**
 * Sync a feature toggle's switch, labels, and summary badge.
 * @param {{
 *   input: HTMLInputElement | null,
 *   panel: HTMLElement | null,
 *   stateLabel: HTMLElement | null,
 *   summary: HTMLElement | null,
 *   enabled: boolean,
 *   onLabel: string,
 *   offLabel: string,
 *   enableAria: string,
 *   disableAria: string,
 *   summaryOn?: string,
 *   summaryOff?: string,
 * }} opts
 */
function renderFeatureToggle(opts) {
  const on = opts.enabled === true;
  if (opts.input) {
    opts.input.checked = on;
    opts.input.setAttribute('aria-checked', on ? 'true' : 'false');
    opts.input.setAttribute('aria-label', on ? opts.disableAria : opts.enableAria);
  }
  opts.panel?.classList.toggle('is-on', on);
  opts.panel?.classList.toggle('is-off', !on);
  if (opts.stateLabel) {
    opts.stateLabel.classList.toggle('is-on', on);
    opts.stateLabel.classList.toggle('is-off', !on);
    opts.stateLabel.textContent = on ? opts.onLabel : opts.offLabel;
  }
  if (opts.summary) {
    opts.summary.classList.toggle('is-on', on);
    opts.summary.classList.toggle('is-off', !on);
    opts.summary.textContent = on
      ? opts.summaryOn || 'Active'
      : opts.summaryOff || 'Disabled';
  }
}

/**
 * Sync the e-bid feature toggle chrome (switch, labels, summary badge).
 * @param {boolean} enabled
 */
function renderElectronicBidToggle(enabled) {
  renderFeatureToggle({
    input: electronicBidEnabledInput,
    panel: electronicBidFeatureToggle,
    stateLabel: electronicBidStateLabel,
    summary: electronicBidSummaryStatus,
    enabled,
    onLabel: 'Active — Notify drivers + Forms record are authoritative',
    offLabel: 'Disabled — paper sign-up remains in effect',
    enableAria: 'Activate electronic bid sign-up',
    disableAria: 'Disable electronic bid sign-up',
  });
}

/**
 * @param {boolean} enabled
 */
function renderPaperBidToggle(enabled) {
  renderFeatureToggle({
    input: paperBidEnabledInput,
    panel: paperBidFeatureToggle,
    stateLabel: paperBidStateLabel,
    summary: paperBidSummaryStatus,
    enabled,
    onLabel: 'Active — bid-eligible routes offer a printable sign-up sheet',
    offLabel: 'Disabled — no print-sheet prompts',
    enableAria: 'Activate paper bid sign-up',
    disableAria: 'Disable paper bid sign-up',
  });
}

async function loadPayrollSettings() {
  payrollSettings = await fetchJson('/api/payroll-settings');
  return payrollSettings;
}

async function loadAppSettings() {
  appSettings = await fetchJson('/api/app-settings');
  renderElectronicBidToggle(!!appSettings.electronic_bid_signup_enabled);
  renderPaperBidToggle(!!appSettings.paper_bid_signup_enabled);
  if (bidSignupWorkbookInput) {
    bidSignupWorkbookInput.value = appSettings.bid_signup_workbook || 'bid-signups.xlsx';
  }
  if (openBidToEmailInput) {
    openBidToEmailInput.value = appSettings.open_bid_posting_to_email || '';
  }
  const sheet = appSettings.paper_bid_sheet || {};
  if (paperBidSheetTitleInput) {
    paperBidSheetTitleInput.value = sheet.title || '';
  }
  if (paperBidSheetIntroInput) {
    paperBidSheetIntroInput.value = sheet.intro || '';
  }
  if (paperBidSheetFooterInput) {
    paperBidSheetFooterInput.value = sheet.footer || '';
  }
  return appSettings;
}

/**
 * Show server-saved payroll To / CC as plain text under PAYROLL EMAIL.
 * @param {object | null | undefined} settings
 */
function renderPayrollEmailSaved(settings) {
  const to = String(settings?.payroll_email ?? '').trim();
  const cc = String(settings?.payroll_cc ?? '')
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');

  if (payrollEmailCurrentEl) {
    payrollEmailCurrentEl.textContent = to
      ? `Current email being used: ${to}`
      : 'Current email being used: (none set)';
  }
  if (payrollCcCurrentEl) {
    if (cc) {
      payrollCcCurrentEl.hidden = false;
      payrollCcCurrentEl.textContent = `Current CC being used: ${cc}`;
    } else {
      payrollCcCurrentEl.hidden = true;
      payrollCcCurrentEl.textContent = '';
    }
  }
}

function applyPayrollEmailFields(settings) {
  if (payrollEmailInput) {
    payrollEmailInput.value = settings?.payroll_email || '';
  }
  if (payrollCcInput) {
    payrollCcInput.value = settings?.payroll_cc || '';
  }
  renderPayrollEmailSaved(settings);
}

async function loadEmailTemplates() {
  emailTemplatesSettings = await fetchJson('/api/email-templates');
  applyPayrollEmailFields(emailTemplatesSettings);
  renderEmailTemplatesEditor(emailTemplatesSettings);
  return emailTemplatesSettings;
}

/**
 * @param {object} settings
 */
function renderEmailTemplatesEditor(settings) {
  emailTemplatesRoot.innerHTML = '';
  const types = settings.event_types || Object.keys(settings.templates || {});
  const labels = settings.event_labels || {};
  const placeholders = settings.placeholders || {};

  for (const eventType of types) {
    const template = settings.templates?.[eventType];
    if (!template) continue;
    const block = document.createElement('details');
    block.className = 'email-template-block';
    block.setAttribute('data-event-type', eventType);

    const summary = document.createElement('summary');
    summary.textContent = labels[eventType] || eventType;
    block.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'email-template-body';

    const recipientField = document.createElement('label');
    recipientField.className = 'field';
    recipientField.appendChild(document.createTextNode('Recipient'));
    const recipientSelect = document.createElement('select');
    recipientSelect.className = 'email-template-recipient';
    recipientSelect.innerHTML = `
      <option value="driver">Driver</option>
      <option value="payroll">Payroll</option>
    `;
    recipientSelect.value = template.recipient || 'driver';
    recipientField.appendChild(recipientSelect);

    const subjectField = document.createElement('label');
    subjectField.className = 'field';
    subjectField.appendChild(document.createTextNode('Subject'));
    const subjectInput = document.createElement('input');
    subjectInput.type = 'text';
    subjectInput.className = 'email-template-subject';
    subjectInput.value = template.subject || '';
    subjectField.appendChild(subjectInput);

    const bodyField = document.createElement('label');
    bodyField.className = 'field';
    bodyField.appendChild(document.createTextNode('Body'));
    const bodyArea = document.createElement('textarea');
    bodyArea.className = 'email-template-body-text';
    bodyArea.rows = 6;
    bodyArea.value = template.body || '';
    bodyField.appendChild(bodyArea);

    const hint = document.createElement('p');
    hint.className = 'field-hint';
    const keys = placeholders[eventType] || [];
    hint.innerHTML =
      'Placeholders: ' +
      (keys.length
        ? keys.map((k) => `<code>{{${k}}}</code>`).join(', ')
        : '—') +
      ' — missing values are left blank.';

    body.append(recipientField, subjectField, bodyField, hint);
    block.appendChild(body);
    emailTemplatesRoot.appendChild(block);
  }
}

function collectEmailTemplatesFromForm() {
  /** @type {Record<string, { recipient: string, subject: string, body: string }>} */
  const templates = {};
  for (const block of emailTemplatesRoot.querySelectorAll(
    '.email-template-block'
  )) {
    const eventType = block.getAttribute('data-event-type');
    if (!eventType) continue;
    templates[eventType] = {
      recipient:
        block.querySelector('.email-template-recipient')?.value || 'driver',
      subject: block.querySelector('.email-template-subject')?.value || '',
      body: block.querySelector('.email-template-body-text')?.value || '',
    };
  }
  return {
    payroll_email: payrollEmailInput?.value || '',
    payroll_cc: payrollCcInput?.value || '',
    templates,
  };
}

/**
 * Keep legacy payrollSettings cache aligned after email-templates saves.
 * @param {object} settings
 */
function syncPayrollSettingsFromEmailTemplates(settings) {
  payrollSettings = {
    payroll_email: settings?.payroll_email || '',
    payroll_cc: settings?.payroll_cc || '',
    message_template:
      settings?.templates?.PAYROLL_CONTRACTED_HOURS_CHANGED?.body ||
      settings?.templates?.WINDOW_BID_PENDING?.body ||
      '',
  };
}

/**
 * @param {object[]} notifications
 */
function renderNotificationToasts(notifications) {
  if (!notificationToastsEl) return;
  notificationToastsEl.innerHTML = '';
  if (!notifyPrefs.channels.toast) return;

  const visible = filterNotificationsByPrefs(notifyPrefs, notifications);
  const flashOnLoad =
    shouldFlashAlertsOnLoad &&
    notifyPrefs.channels.flashOnLoad &&
    visible.length > 0;
  if (shouldFlashAlertsOnLoad) {
    shouldFlashAlertsOnLoad = false;
  }
  for (const note of visible) {
    const toast = document.createElement('div');
    toast.className = flashOnLoad
      ? 'notification-toast is-flashing'
      : 'notification-toast';
    toast.setAttribute('data-id', note.id);
    if (flashOnLoad) {
      toast.addEventListener(
        'animationend',
        () => {
          toast.classList.remove('is-flashing');
        },
        { once: true }
      );
    }

    const text = document.createElement('p');
    text.className = 'notification-toast-text';
    text.textContent = note.prompt || 'Send an email update?';

    const actions = document.createElement('div');
    actions.className = 'notification-toast-actions';

    const isPaperBid = note.event_type === 'PAPER_BID_SIGNUP';
    const yesBtn = document.createElement('button');
    yesBtn.type = 'button';
    setLabeledIcon(
      yesBtn,
      isPaperBid ? 'printer' : 'mail',
      isPaperBid ? 'Print sheet' : 'Yes'
    );
    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'secondary';
    setLabeledIcon(dismissBtn, 'x', 'Dismiss');

    const hint = document.createElement('p');
    hint.className = 'field-hint';

    if (!note.draft?.can_send) {
      yesBtn.disabled = true;
      hint.textContent =
        note.draft?.disabled_reason ||
        (isPaperBid
          ? 'Paper sign-up sheet unavailable.'
          : 'No email on file for this recipient.');
      hint.className = 'field-hint warn-text';
    }

    yesBtn.addEventListener('click', async () => {
      yesBtn.disabled = true;
      dismissBtn.disabled = true;
      try {
        const result = await fetchJson(
          `/api/notifications/${encodeURIComponent(note.id)}/action`,
          { method: 'POST' }
        );
        const draft = result.notification?.draft;
        if (draft?.action === 'print' && draft.print_url) {
          window.open(draft.print_url, '_blank', 'noopener');
        } else if (draft?.mailto_url) {
          openMailto(draft.mailto_url);
        }
        await loadNotifications();
        await loadQueue({ silent: true });
      } catch (error) {
        hint.textContent = error.message;
        hint.className = 'field-hint warn-text';
        yesBtn.disabled = !note.draft?.can_send;
        dismissBtn.disabled = false;
      }
    });

    dismissBtn.addEventListener('click', async () => {
      yesBtn.disabled = true;
      dismissBtn.disabled = true;
      try {
        await fetchJson(
          `/api/notifications/${encodeURIComponent(note.id)}/dismiss`,
          { method: 'POST' }
        );
        await loadNotifications();
        await loadQueue({ silent: true });
      } catch (error) {
        hint.textContent = error.message;
        hint.className = 'field-hint warn-text';
        yesBtn.disabled = !note.draft?.can_send;
        dismissBtn.disabled = false;
      }
    });

    actions.append(yesBtn, dismissBtn);
    toast.append(text, actions, hint);
    notificationToastsEl.appendChild(toast);
  }
}

async function loadNotifications() {
  const data = await fetchJson('/api/notifications?pending=1');
  const list = data.notifications || [];
  const filtered = filterNotificationsByPrefs(notifyPrefs, list);
  pendingNotificationCount = filtered.length;
  renderNotificationToasts(list);
  return list;
}

/**
 * @param {{ silent?: boolean }} [options]
 */
async function loadQueue(options = {}) {
  const [rows, settings, bidSettings] = await Promise.all([
    fetchJson('/api/admin/queue'),
    payrollSettings
      ? Promise.resolve(payrollSettings)
      : fetchJson('/api/payroll-settings').then((s) => {
          payrollSettings = s;
          return s;
        }),
    appSettings
      ? Promise.resolve(appSettings)
      : fetchJson('/api/app-settings').then((s) => {
          appSettings = s;
          return s;
        }),
  ]);
  /** @type {object[]} */
  let notifications = [];
  try {
    notifications = await loadNotifications();
  } catch {
    pendingNotificationCount = 0;
  }
  await loadBaseFavicon();
  renderQueue(rows, {
    payrollEmailConfigured: Boolean(settings?.payroll_email?.trim()),
    electronicBidSignupEnabled: bidSettings?.electronic_bid_signup_enabled === true,
    paperBidSignupEnabled: bidSettings?.paper_bid_signup_enabled === true,
  });
  updateAttentionIndicator(countAttentionItems(rows));
  syncDesktopAttentionNotifications(rows, notifications);
  if (options.silent) return;
  const active =
    rows.filter((r) => r.status !== 'STABLE').length +
    rows.filter((r) => r.status === 'STABLE' && r.has_self_resolved_review)
      .length;
  showStatus(
    queueStatusEl,
    `Loaded ${rows.length} route${rows.length === 1 ? '' : 's'} · ${active} in active sections.`,
    'ok'
  );
}

setReassignRefreshHandler(() => {
  loadQueue().catch((error) => {
    showStatus(queueStatusEl, error.message, 'error');
  });
});

const settingsStatusEl = document.getElementById('settings-status');
const calendarList = document.getElementById('calendar-list');
const calendarYear = document.getElementById('calendar-year');
const calendarCount = document.getElementById('calendar-count');
const calendarCoverage = document.getElementById('calendar-coverage');
const calendarNewDate = document.getElementById('calendar-new-date');

/** @type {{ school_year: string | null, school_days?: string[], days?: Array<{date:string,is_school_day:boolean}>, coverage_start?: string, coverage_end?: string }} */
let schoolCalendar = { school_year: null, school_days: [] };

const MONTH_ABBREV = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** @param {string} iso YYYY-MM-DD */
function formatCalendarDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTH_ABBREV[m - 1]} ${d}, ${y}`;
}

/** @param {string} iso YYYY-MM-DD */
function weekdaySun0(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function activeSchoolDays() {
  if (Array.isArray(schoolCalendar.days) && schoolCalendar.days.length) {
    return schoolCalendar.days.filter((d) => d.is_school_day).map((d) => d.date);
  }
  return schoolCalendar.school_days || [];
}

/** @returns {Array<{date:string,is_school_day:boolean,reason?:string,day_of_week?:string}>} */
function calendarDaysForDisplay() {
  if (Array.isArray(schoolCalendar.days) && schoolCalendar.days.length) {
    return [...schoolCalendar.days].sort((a, b) => a.date.localeCompare(b.date));
  }
  const marked = new Set(activeSchoolDays());
  if (!marked.size) return [];

  const sorted = [...marked].sort();
  const start = sorted[0];
  const end = sorted[sorted.length - 1];
  /** @type {Array<{date:string,is_school_day:boolean}>} */
  const filled = [];
  const [sy, sm, sd] = start.split('-').map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  const [ey, em, ed] = end.split('-').map(Number);
  const last = new Date(ey, em - 1, ed);
  while (cursor <= last) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    const date = `${y}-${m}-${d}`;
    filled.push({ date, is_school_day: marked.has(date) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return filled;
}

/**
 * @param {string} date
 * @param {boolean} currentlyMarked
 */
async function toggleSchoolDay(date, currentlyMarked) {
  const days = activeSchoolDays();
  const next = currentlyMarked
    ? days.filter((d) => d !== date)
    : [...days, date].sort();
  await saveCalendar({
    school_year: calendarYear.value.trim() || null,
    school_days: next,
  });
  showStatus(
    settingsStatusEl,
    currentlyMarked
      ? `Unmarked ${formatCalendarDate(date)} (no longer a school day).`
      : `Marked ${formatCalendarDate(date)} as a school day.`,
    'ok'
  );
  await loadQueue();
}

function renderCalendarList() {
  calendarList.innerHTML = '';
  calendarYear.value = schoolCalendar.school_year || '';
  const marked = activeSchoolDays();
  const allDays = calendarDaysForDisplay();
  const total = allDays.length;
  calendarCount.textContent = `${marked.length} school day${marked.length === 1 ? '' : 's'} marked`;
  calendarCoverage.textContent = schoolCalendar.coverage_start
    ? `Coverage ${formatCalendarDate(schoolCalendar.coverage_start)} → ${formatCalendarDate(schoolCalendar.coverage_end)} (${total} civil days)`
    : '';

  if (!allDays.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No calendar days yet.';
    calendarList.appendChild(empty);
    return;
  }

  /** @type {Map<string, typeof allDays>} */
  const byMonth = new Map();
  for (const entry of allDays) {
    const key = entry.date.slice(0, 7); // YYYY-MM
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(entry);
  }

  for (const [monthKey, monthDays] of byMonth) {
    const [yearStr, monthStr] = monthKey.split('-');
    const monthIndex = Number(monthStr) - 1;
    const section = document.createElement('section');
    section.className = 'calendar-month';

    const heading = document.createElement('h4');
    heading.textContent = `${MONTH_ABBREV[monthIndex]} ${yearStr}`;
    section.appendChild(heading);

    const weekdays = document.createElement('div');
    weekdays.className = 'calendar-weekdays';
    weekdays.setAttribute('aria-hidden', 'true');
    for (const label of WEEKDAY_LABELS) {
      const cell = document.createElement('span');
      cell.textContent = label;
      weekdays.appendChild(cell);
    }
    section.appendChild(weekdays);

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', `${MONTH_ABBREV[monthIndex]} ${yearStr}`);

    const firstPad = weekdaySun0(monthDays[0].date);
    for (let i = 0; i < firstPad; i += 1) {
      const pad = document.createElement('span');
      pad.className = 'calendar-day is-pad';
      pad.setAttribute('aria-hidden', 'true');
      grid.appendChild(pad);
    }

    for (const entry of monthDays) {
      const dayNum = Number(entry.date.slice(8, 10));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = entry.is_school_day
        ? 'calendar-day is-school-day'
        : 'calendar-day';
      btn.textContent = String(dayNum);
      const status = entry.is_school_day ? 'school day' : 'not a school day';
      const reason = entry.reason ? ` — ${entry.reason}` : '';
      btn.title = `${formatCalendarDate(entry.date)} (${status})${reason}`;
      btn.setAttribute(
        'aria-label',
        `${formatCalendarDate(entry.date)}, ${status}. Click to ${entry.is_school_day ? 'unmark' : 'mark'}.`
      );
      btn.addEventListener('click', async () => {
        try {
          await toggleSchoolDay(entry.date, entry.is_school_day);
        } catch (error) {
          showStatus(settingsStatusEl, error.message, 'error');
        }
      });
      grid.appendChild(btn);
    }

    section.appendChild(grid);
    calendarList.appendChild(section);
  }
}

async function saveCalendar(next) {
  schoolCalendar = await fetchJson('/api/school-calendar', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  });
  renderCalendarList();
  return schoolCalendar;
}

async function loadCalendar() {
  schoolCalendar = await fetchJson('/api/school-calendar');
  renderCalendarList();
}

document.getElementById('calendar-add').addEventListener('click', async () => {
  try {
    const day = calendarNewDate.value;
    if (!day) throw new Error('Pick a date to mark as a school day.');
    const days = activeSchoolDays();
    if (days.includes(day)) {
      throw new Error(`Already a school day: ${formatCalendarDate(day)}`);
    }
    await saveCalendar({
      school_year: calendarYear.value.trim() || null,
      school_days: [...days, day],
    });
    calendarNewDate.value = '';
    showStatus(
      settingsStatusEl,
      `Marked ${formatCalendarDate(day)} as a school day.`,
      'ok'
    );
    await loadQueue();
  } catch (error) {
    showStatus(settingsStatusEl, error.message, 'error');
  }
});

calendarYear.addEventListener('change', async () => {
  try {
    await saveCalendar({
      school_year: calendarYear.value.trim() || null,
      school_days: activeSchoolDays(),
    });
    showStatus(settingsStatusEl, 'School year label updated.', 'ok');
  } catch (error) {
    showStatus(settingsStatusEl, error.message, 'error');
  }
});

// Staff-name state must be initialized before boot loaders that fill selects.
let staffNamesList = [];

function openBulkImportSettings() {
  window.location.hash = '#settings-bulk-import';
  if (settingsEl instanceof HTMLDetailsElement) {
    settingsEl.open = true;
    const bulk = document.getElementById('settings-bulk-import');
    if (bulk instanceof HTMLDetailsElement) {
      bulk.open = true;
      bulk.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

initDesktopNotifyOptIn();
initNotifyPrefsSettings();
initRosterImportTip({ onShowWhere: openBulkImportSettings });

Promise.all([
  loadQueue(),
  loadCalendar(),
  loadPayrollSettings(),
  loadEmailTemplates(),
  loadAppSettings(),
  loadStaffNamesSettings(),
  loadReasonCategoriesSettings(),
  loadYearRolloverStaffNames(),
  initYearRolloverFlow(),
]).catch((error) => {
  showStatus(queueStatusEl, error.message, 'error');
  showStatus(settingsStatusEl, error.message, 'error');
});

setInterval(() => {
  loadQueue({ silent: true }).catch(() => {
    /* Keep the last indicator; next poll retries. */
  });
}, ATTENTION_POLL_MS);

/**
 * Persist e-bid on/off immediately from the feature toggle.
 * @param {boolean} enabled
 */
async function saveElectronicBidEnabled(enabled) {
  const previous = appSettings?.electronic_bid_signup_enabled === true;
  renderElectronicBidToggle(enabled);
  try {
    appSettings = await fetchJson('/api/app-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ electronic_bid_signup_enabled: enabled }),
    });
    renderElectronicBidToggle(!!appSettings.electronic_bid_signup_enabled);
    showStatus(
      settingsStatusEl,
      appSettings.electronic_bid_signup_enabled
        ? 'Electronic bid sign-up is ON — Notify drivers + Forms record are authoritative.'
        : 'Electronic bid sign-up is OFF.',
      'ok'
    );
    await loadQueue();
  } catch (error) {
    renderElectronicBidToggle(previous);
    showStatus(settingsStatusEl, error.message, 'error');
  }
}

electronicBidEnabledInput?.addEventListener('change', () => {
  void saveElectronicBidEnabled(electronicBidEnabledInput.checked === true);
});

/**
 * Persist paper-bid on/off immediately from the feature toggle.
 * @param {boolean} enabled
 */
async function savePaperBidEnabled(enabled) {
  const previous = appSettings?.paper_bid_signup_enabled === true;
  renderPaperBidToggle(enabled);
  try {
    appSettings = await fetchJson('/api/app-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper_bid_signup_enabled: enabled }),
    });
    renderPaperBidToggle(!!appSettings.paper_bid_signup_enabled);
    showStatus(
      settingsStatusEl,
      appSettings.paper_bid_signup_enabled
        ? 'Paper bid sign-up is ON — bid-eligible routes will offer a print sheet.'
        : 'Paper bid sign-up is OFF.',
      'ok'
    );
    await loadQueue();
  } catch (error) {
    renderPaperBidToggle(previous);
    showStatus(settingsStatusEl, error.message, 'error');
  }
}

paperBidEnabledInput?.addEventListener('change', () => {
  void savePaperBidEnabled(paperBidEnabledInput.checked === true);
});

document
  .getElementById('paper-bid-settings-save')
  ?.addEventListener('click', async () => {
    try {
      appSettings = await fetchJson('/api/app-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paper_bid_signup_enabled: paperBidEnabledInput?.checked === true,
          paper_bid_sheet: {
            title: paperBidSheetTitleInput?.value?.trim() || 'Open Bid Sign-Up Sheet',
            intro: paperBidSheetIntroInput?.value ?? '',
            footer: paperBidSheetFooterInput?.value ?? '',
          },
        }),
      });
      await loadAppSettings();
      showStatus(settingsStatusEl, 'Paper bid sheet template saved.', 'ok');
      await loadQueue();
    } catch (error) {
      showStatus(settingsStatusEl, error.message, 'error');
    }
  });

document
  .getElementById('app-settings-save')
  ?.addEventListener('click', async () => {
    try {
      appSettings = await fetchJson('/api/app-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          electronic_bid_signup_enabled: electronicBidEnabledInput?.checked === true,
          bid_signup_workbook: bidSignupWorkbookInput?.value?.trim() || 'bid-signups.xlsx',
          open_bid_posting_to_email: openBidToEmailInput?.value?.trim() || '',
        }),
      });
      await loadAppSettings();
      showStatus(
        settingsStatusEl,
        'Bid sign-up settings saved.',
        'ok'
      );
      await loadQueue();
    } catch (error) {
      showStatus(settingsStatusEl, error.message, 'error');
    }
  });

document
  .getElementById('payroll-email-save')
  ?.addEventListener('click', async () => {
    try {
      emailTemplatesSettings = await fetchJson('/api/email-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payroll_email: payrollEmailInput?.value || '',
          payroll_cc: payrollCcInput?.value || '',
        }),
      });
      syncPayrollSettingsFromEmailTemplates(emailTemplatesSettings);
      applyPayrollEmailFields(emailTemplatesSettings);
      showStatus(settingsStatusEl, 'Payroll email saved.', 'ok');
      await loadQueue();
    } catch (error) {
      showStatus(settingsStatusEl, error.message, 'error');
    }
  });

document
  .getElementById('email-templates-save')
  .addEventListener('click', async () => {
    try {
      emailTemplatesSettings = await fetchJson('/api/email-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectEmailTemplatesFromForm()),
      });
      syncPayrollSettingsFromEmailTemplates(emailTemplatesSettings);
      applyPayrollEmailFields(emailTemplatesSettings);
      renderEmailTemplatesEditor(emailTemplatesSettings);
      showStatus(settingsStatusEl, 'Email templates saved.', 'ok');
      await loadQueue();
    } catch (error) {
      showStatus(settingsStatusEl, error.message, 'error');
    }
  });

// --- Generate a school year ---

const genBreaksEl = document.getElementById('gen-breaks');
const genHolidaysEl = document.getElementById('gen-holidays');
const genPreviewPanel = document.getElementById('gen-preview-panel');
const genPreviewBody = document.getElementById('gen-preview-body');
const genCommitBtn = document.getElementById('gen-commit');

/** @type {object | null} */
let pendingGeneration = null;

function addBreakRow(values = {}) {
  const row = document.createElement('div');
  row.className = 'generate-row';
  row.innerHTML = `
    <label class="field">Start<input type="date" class="gen-break-start" value="${values.start || ''}" /></label>
    <label class="field">End<input type="date" class="gen-break-end" value="${values.end || ''}" /></label>
    <label class="field">Label<input type="text" class="gen-break-label" placeholder="Winter Break" value="${values.label || ''}" /></label>
    <button type="button" class="secondary gen-remove-row" data-icon="trash">Remove</button>
  `;
  row.querySelector('.gen-remove-row').addEventListener('click', () => row.remove());
  genBreaksEl.appendChild(row);
  enhanceIcons(row);
}

function addHolidayRow(values = {}) {
  const row = document.createElement('div');
  row.className = 'generate-row holiday-row';
  row.innerHTML = `
    <label class="field">Date<input type="date" class="gen-holiday-date" value="${values.date || ''}" /></label>
    <label class="field">Label<input type="text" class="gen-holiday-label" placeholder="Labor Day" value="${values.label || ''}" /></label>
    <button type="button" class="secondary gen-remove-row" data-icon="trash">Remove</button>
  `;
  row.querySelector('.gen-remove-row').addEventListener('click', () => row.remove());
  genHolidaysEl.appendChild(row);
  enhanceIcons(row);
}

document.getElementById('gen-add-break').addEventListener('click', () => addBreakRow());
document.getElementById('gen-add-holiday').addEventListener('click', () => addHolidayRow());

function collectGenerationInput() {
  const first_day = document.getElementById('gen-first-day').value;
  const last_day = document.getElementById('gen-last-day').value;
  if (!first_day || !last_day) {
    throw new Error('First day and last day of school are required.');
  }

  const breaks = [...genBreaksEl.querySelectorAll('.generate-row')]
    .map((row) => ({
      start: row.querySelector('.gen-break-start').value,
      end: row.querySelector('.gen-break-end').value,
      label: row.querySelector('.gen-break-label').value.trim(),
    }))
    .filter((b) => b.start || b.end || b.label);
  for (const b of breaks) {
    if (!b.start || !b.end) {
      throw new Error('Each break needs both a start and end date.');
    }
  }

  const holidays = [...genHolidaysEl.querySelectorAll('.generate-row')]
    .map((row) => ({
      date: row.querySelector('.gen-holiday-date').value,
      label: row.querySelector('.gen-holiday-label').value.trim(),
    }))
    .filter((h) => h.date || h.label);
  for (const h of holidays) {
    if (!h.date) throw new Error('Each holiday needs a date.');
  }

  return {
    first_day,
    last_day,
    school_year: document.getElementById('gen-school-year').value.trim() || null,
    breaks,
    holidays,
  };
}

function renderGenerationPreview(result) {
  pendingGeneration = {
    input: collectGenerationInput(),
    requires_confirm: result.requires_confirm,
    conflicts: result.conflicts,
  };

  const s = result.summary;
  const c = result.conflicts;
  const boundary = result.coverage_boundary;

  genPreviewBody.innerHTML = '';

  const stats = document.createElement('dl');
  stats.className = 'gen-preview-stats';
  stats.innerHTML = `
    <div><dt>School days</dt><dd>${s.school_day_count}</dd></div>
    <div><dt>Civil days in coverage</dt><dd>${s.civil_day_count}</dd></div>
    <div><dt>Weekends</dt><dd>${s.weekend_count}</dd></div>
    <div><dt>Break days</dt><dd>${s.break_day_count}</dd></div>
    <div><dt>Holiday days</dt><dd>${s.holiday_day_count}</dd></div>
    <div><dt>Outside school year (summer pad)</dt><dd>${s.summer_day_count}</dd></div>
    <div><dt>Coverage</dt><dd>${boundary.coverage_start} → ${boundary.coverage_end}</dd></div>
  `;
  genPreviewBody.appendChild(stats);

  const boundaryNote = document.createElement('p');
  boundaryNote.className = 'field-hint';
  boundaryNote.textContent = boundary.boundary_rule;
  genPreviewBody.appendChild(boundaryNote);

  if (s.breaks_applied?.length) {
    const ul = document.createElement('ul');
    ul.className = 'report-changes';
    for (const b of s.breaks_applied) {
      const li = document.createElement('li');
      li.textContent = `${b.label}: ${b.start} → ${b.end}`;
      ul.appendChild(li);
    }
    const title = document.createElement('h4');
    title.textContent = 'Breaks applied';
    genPreviewBody.append(title, ul);
  }

  if (s.holidays_applied?.length) {
    const ul = document.createElement('ul');
    ul.className = 'report-changes';
    for (const h of s.holidays_applied) {
      const li = document.createElement('li');
      li.textContent = `${h.label}: ${h.date}`;
      ul.appendChild(li);
    }
    const title = document.createElement('h4');
    title.textContent = 'Holidays applied';
    genPreviewBody.append(title, ul);
  }

  if (c?.has_overlap) {
    const box = document.createElement('div');
    box.className = 'gen-conflict-box';
    box.innerHTML = `
      <strong>Overlap with existing calendar</strong>
      <p>${c.overlapping_date_count} date(s) already exist in school-calendar.json
      (${c.differing_count} differ in school-day flag or reason).</p>
      <p class="field-hint">Sample: ${(c.sample_overlapping_dates || []).join(', ') || '—'}</p>
      <p>Committing will replace those overlapping dates with the generated values. Non-overlapping dates are kept.</p>
    `;
    genPreviewBody.appendChild(box);
    setLabeledIcon(genCommitBtn, 'check', 'Replace overlap & commit');
  } else {
    setLabeledIcon(genCommitBtn, 'check', 'Commit to calendar');
  }

  genCommitBtn.hidden = false;
  genPreviewPanel.hidden = false;
}

document.getElementById('gen-preview').addEventListener('click', async () => {
  try {
    const input = collectGenerationInput();
    const result = await fetchJson('/api/school-calendar/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    // Re-store input (collectGenerationInput already validated)
    pendingGeneration = { input, requires_confirm: result.requires_confirm, conflicts: result.conflicts };
    renderGenerationPreview(result);
    showStatus(
      settingsStatusEl,
      result.requires_confirm
        ? 'Preview ready — overlap needs confirmation before commit.'
        : 'Preview ready — review counts, then commit.',
      result.requires_confirm ? 'warn' : 'ok'
    );
  } catch (error) {
    showStatus(settingsStatusEl, error.message, 'error');
  }
});

document.getElementById('gen-cancel-preview').addEventListener('click', () => {
  pendingGeneration = null;
  genPreviewPanel.hidden = true;
  genCommitBtn.hidden = true;
  genPreviewBody.innerHTML = '';
});

document.getElementById('gen-commit').addEventListener('click', async () => {
  try {
    if (!pendingGeneration?.input) {
      throw new Error('Generate a preview first.');
    }
    const body = {
      ...pendingGeneration.input,
      confirm_replace: pendingGeneration.requires_confirm === true,
    };
    const result = await fetchJson('/api/school-calendar/generate/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    schoolCalendar = result.calendar;
    renderCalendarList();
    pendingGeneration = null;
    genPreviewPanel.hidden = true;
    genCommitBtn.hidden = true;
    showStatus(
      settingsStatusEl,
      result.replaced_overlap
        ? `Committed with ${result.conflicts.overlapping_date_count} overlapping date(s) replaced.`
        : `Committed ${result.summary.school_day_count} school days.`,
      'ok'
    );
    await loadQueue();
  } catch (error) {
    showStatus(settingsStatusEl, error.message, 'error');
  }
});

// --- Archive Year & Import New Roster ---

const yearArchiveStepEl = document.getElementById('year-archive-step');
const yearImportStepEl = document.getElementById('year-import-step');
const yearArchiveDoneEl = document.getElementById('year-archive-done');
const yearArchiveDoneSummaryEl = document.getElementById(
  'year-archive-done-summary'
);
const yearArchiveDoneFilesEl = document.getElementById(
  'year-archive-done-files'
);
const yearArchiveFirstUseNoteEl = document.getElementById(
  'year-archive-first-use-note'
);
const yearArchivePurposeEl = document.getElementById('year-archive-purpose');
const yearArchiveFolderNameEl = document.getElementById(
  'year-archive-folder-name'
);
const yearArchiveConfirmFolderEl = document.getElementById(
  'year-archive-confirm-folder'
);
const yearArchiveEnteredByEl = document.getElementById(
  'year-archive-entered-by'
);
const yearArchiveNoteEl = document.getElementById('year-archive-note');
const yearArchivePreviewPanel = document.getElementById(
  'year-archive-preview-panel'
);
const yearArchivePreviewBody = document.getElementById(
  'year-archive-preview-body'
);
const yearArchiveStatusEl = document.getElementById('year-archive-status');
const yearImportStepTitleEl = document.getElementById(
  'year-import-step-title'
);
const yearImportStepHintEl = document.getElementById('year-import-step-hint');

/** @type {object | null} */
let yearArchivePreview = null;
/** Session flag: archive completed (or unnecessary) so import may proceed. */
let yearImportUnlocked = false;
/** After archive success, show the done screen until Admin starts import. */
let yearArchiveJustCompleted = false;

/**
 * @param {string} message
 * @param {'ok' | 'error' | 'warn'} [kind]
 */
function showYearArchiveStatus(message, kind = 'ok') {
  showStatus(yearArchiveStatusEl, message, kind);
  showStatus(document.getElementById('settings-status'), message, kind);
}

/**
 * @param {HTMLSelectElement | null} selectEl
 * @param {string[]} names
 * @param {string} previous
 */
function fillStaffNameSelect(selectEl, names, previous) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Select your name…</option>';
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    if (name === previous) option.selected = true;
    selectEl.appendChild(option);
  }
}

/** @type {string[]} */
const staffNamesListEl = document.getElementById('staff-names-list');
const staffNamesNewInput = document.getElementById('staff-names-new');

function renderStaffNamesList() {
  if (!staffNamesListEl) return;
  staffNamesListEl.innerHTML = '';
  if (!staffNamesList.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No staff names yet.';
    staffNamesListEl.appendChild(empty);
    return;
  }
  for (const name of staffNamesList) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    setLabeledIcon(remove, 'trash', 'Remove');
    remove.addEventListener('click', async () => {
      try {
        await saveStaffNames(staffNamesList.filter((n) => n !== name));
        showStatus(settingsStatusEl, `Removed “${name}”.`, 'ok');
      } catch (error) {
        showStatus(settingsStatusEl, error.message, 'error');
      }
    });
    li.append(label, remove);
    staffNamesListEl.appendChild(li);
  }
}

async function saveStaffNames(names) {
  staffNamesList = await fetchJson('/api/staff-names', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(names),
  });
  renderStaffNamesList();
  const previous = localStorage.getItem('rct_entered_by') || '';
  fillStaffNameSelect(yearArchiveEnteredByEl, staffNamesList, previous);
  fillStaffNameSelect(
    document.getElementById('bulk-import-entered-by'),
    staffNamesList,
    previous
  );
  return staffNamesList;
}

async function loadStaffNamesSettings() {
  staffNamesList = await fetchJson('/api/staff-names');
  renderStaffNamesList();
  return staffNamesList;
}

async function loadYearRolloverStaffNames() {
  const names = staffNamesList.length
    ? staffNamesList
    : await fetchJson('/api/staff-names');
  const previous = localStorage.getItem('rct_entered_by') || '';
  fillStaffNameSelect(yearArchiveEnteredByEl, names, previous);
  fillStaffNameSelect(
    document.getElementById('bulk-import-entered-by'),
    names,
    previous
  );
}

document.getElementById('staff-names-add')?.addEventListener('click', async () => {
  try {
    const name = (staffNamesNewInput?.value || '').trim();
    if (!name) throw new Error('Enter a name to add.');
    if (staffNamesList.some((n) => n.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Already on the list: ${name}`);
    }
    await saveStaffNames([...staffNamesList, name]);
    if (staffNamesNewInput) staffNamesNewInput.value = '';
    showStatus(settingsStatusEl, `Added “${name}”.`, 'ok');
  } catch (error) {
    showStatus(settingsStatusEl, error.message, 'error');
  }
});

staffNamesNewInput?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  document.getElementById('staff-names-add')?.click();
});

/** @type {string[]} */
let reasonCategoriesList = [];

const reasonCategoriesListEl = document.getElementById('reason-categories-list');
const reasonCategoriesNewInput = document.getElementById('reason-categories-new');

function renderReasonCategoriesList() {
  if (!reasonCategoriesListEl) return;
  reasonCategoriesListEl.innerHTML = '';
  if (!reasonCategoriesList.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No reason categories yet.';
    reasonCategoriesListEl.appendChild(empty);
    return;
  }
  for (const category of reasonCategoriesList) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = category;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    setLabeledIcon(remove, 'trash', 'Remove');
    remove.addEventListener('click', async () => {
      try {
        await saveReasonCategories(
          reasonCategoriesList.filter((c) => c !== category)
        );
        showStatus(settingsStatusEl, `Removed “${category}”.`, 'ok');
      } catch (error) {
        showStatus(settingsStatusEl, error.message, 'error');
      }
    });
    li.append(label, remove);
    reasonCategoriesListEl.appendChild(li);
  }
}

async function saveReasonCategories(categories) {
  reasonCategoriesList = await fetchJson('/api/reason-categories', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(categories),
  });
  renderReasonCategoriesList();
  return reasonCategoriesList;
}

async function loadReasonCategoriesSettings() {
  reasonCategoriesList = await fetchJson('/api/reason-categories');
  renderReasonCategoriesList();
  return reasonCategoriesList;
}

document
  .getElementById('reason-categories-add')
  ?.addEventListener('click', async () => {
    try {
      const category = (reasonCategoriesNewInput?.value || '').trim();
      if (!category) throw new Error('Enter a category to add.');
      if (
        reasonCategoriesList.some(
          (c) => c.toLowerCase() === category.toLowerCase()
        )
      ) {
        throw new Error(`Already on the list: ${category}`);
      }
      await saveReasonCategories([...reasonCategoriesList, category]);
      if (reasonCategoriesNewInput) reasonCategoriesNewInput.value = '';
      showStatus(settingsStatusEl, `Added “${category}”.`, 'ok');
    } catch (error) {
      showStatus(settingsStatusEl, error.message, 'error');
    }
  });

reasonCategoriesNewInput?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  document.getElementById('reason-categories-add')?.click();
});

/**
 * @param {object} preview
 * @param {{ afterArchive?: boolean, showImport?: boolean }} [options]
 */
function applyYearRolloverUi(preview, options = {}) {
  yearArchivePreview = preview;
  const afterArchive = options.afterArchive === true;
  const showImport = options.showImport === true;
  const hasData = preview?.has_meaningful_data === true;

  if (yearArchivePurposeEl && preview?.purpose) {
    yearArchivePurposeEl.textContent = preview.purpose;
  }

  if (!hasData) {
    yearImportUnlocked = true;
    yearArchiveJustCompleted = false;
    if (yearArchiveFirstUseNoteEl) {
      yearArchiveFirstUseNoteEl.hidden = false;
      yearArchiveFirstUseNoteEl.textContent =
        preview.first_use_note ||
        'No existing data found — nothing to archive. This will be the first roster import.';
    }
    if (yearArchiveStepEl) yearArchiveStepEl.hidden = true;
    if (yearArchiveDoneEl) yearArchiveDoneEl.hidden = true;
    if (yearImportStepEl) yearImportStepEl.hidden = false;
    if (yearImportStepTitleEl) {
      yearImportStepTitleEl.textContent = 'Import new roster';
    }
    if (yearImportStepHintEl) {
      yearImportStepHintEl.textContent =
        'Paste into the table below, or use the CSV template workflow under the table.';
    }
    return;
  }

  if (yearArchiveFirstUseNoteEl) {
    yearArchiveFirstUseNoteEl.hidden = true;
    yearArchiveFirstUseNoteEl.textContent = '';
  }

  if (afterArchive || yearArchiveJustCompleted) {
    yearArchiveJustCompleted = true;
    yearImportUnlocked = true;
    if (yearArchiveStepEl) yearArchiveStepEl.hidden = true;
    if (yearArchiveDoneEl) yearArchiveDoneEl.hidden = false;
    if (yearImportStepEl) yearImportStepEl.hidden = !showImport;
    if (showImport) {
      if (yearImportStepTitleEl) {
        yearImportStepTitleEl.textContent = 'Step 2: Import new roster';
      }
      if (yearImportStepHintEl) {
        yearImportStepHintEl.textContent =
          'Paste into the table below, or use the CSV template workflow under the table.';
      }
    }
    return;
  }

  if (yearArchiveDoneEl) yearArchiveDoneEl.hidden = true;
  if (yearArchiveStepEl) yearArchiveStepEl.hidden = false;
  if (yearImportStepEl) yearImportStepEl.hidden = true;
}

/**
 * @param {object} result - commit response
 */
function showYearArchiveDoneScreen(result) {
  const folder =
    result.archive_folder_name || result.meta?.archive_folder_name || '';
  const rel = result.relative_path || `archives/${folder}`;
  const meta = result.meta || {};

  if (yearArchiveDoneSummaryEl) {
    const parts = [
      `Saved to ${rel}.`,
      `${meta.drivers_count ?? '—'} drivers`,
      `${meta.routes_count ?? '—'} routes`,
      `${meta.change_log_entries ?? '—'} change-log entries`,
    ];
    if (meta.entered_by) {
      parts.push(`archived by ${meta.entered_by}`);
    }
    yearArchiveDoneSummaryEl.textContent = parts.join(' · ');
  }

  if (yearArchiveDoneFilesEl) {
    yearArchiveDoneFilesEl.innerHTML = '';
    const contents = Array.isArray(result.contents) ? result.contents : [];
    if (!contents.length) {
      const empty = document.createElement('div');
      empty.className = 'field-hint';
      empty.textContent = 'Archive folder created (file list unavailable).';
      yearArchiveDoneFilesEl.appendChild(empty);
    } else {
      for (const item of contents) {
        const row = document.createElement('div');
        row.className = 'year-archive-file-row';
        row.setAttribute('role', 'listitem');
        const kind = document.createElement('span');
        kind.className = 'year-archive-file-kind';
        kind.textContent = item.type === 'directory' ? 'dir' : 'file';
        const pathEl = document.createElement('span');
        pathEl.className = 'year-archive-file-path';
        pathEl.textContent =
          item.type === 'directory'
            ? `${item.path}/` +
              (typeof item.children === 'number'
                ? ` (${item.children} item${item.children === 1 ? '' : 's'})`
                : '')
            : item.path;
        row.append(kind, pathEl);
        yearArchiveDoneFilesEl.appendChild(row);
      }
    }
  }

  yearArchiveJustCompleted = true;
  applyYearRolloverUi(result.preview || yearArchivePreview, {
    afterArchive: true,
    showImport: false,
  });
  yearArchiveDoneEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function initYearRolloverFlow() {
  const preview = await fetchJson('/api/year-archive/preview');
  applyYearRolloverUi(preview);
}

/**
 * @param {object} preview
 */
function renderYearArchivePreview(preview) {
  if (!yearArchivePreviewBody) return;
  yearArchivePreviewBody.innerHTML = '';

  const stats = document.createElement('div');
  stats.className = 'gen-preview-stats';
  const rows = [
    ['Drivers', String(preview.drivers_count ?? 0)],
    ['Routes', String(preview.routes_count ?? 0)],
    ['Change-log entries', String(preview.change_log_entries ?? 0)],
    ['Generated letters', String(preview.letters_count ?? 0)],
    [
      'RouteChangeTracker.xlsx',
      preview.workbook_present ? 'Will be copied' : 'Not present',
    ],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    const left = document.createElement('span');
    left.textContent = label;
    const right = document.createElement('strong');
    right.textContent = value;
    row.append(left, right);
    stats.appendChild(row);
  }
  yearArchivePreviewBody.appendChild(stats);

  const mid = Array.isArray(preview.mid_flight_routes)
    ? preview.mid_flight_routes
    : [];
  if (mid.length) {
    const box = document.createElement('div');
    box.className = 'gen-conflict-box';
    const title = document.createElement('p');
    title.innerHTML = `<strong>${mid.length} route(s) currently mid-flight</strong> — still unresolved before you archive:`;
    const list = document.createElement('ul');
    list.className = 'year-archive-midflight';
    for (const route of mid) {
      const li = document.createElement('li');
      li.textContent = `${route.route_id} — ${route.status}`;
      list.appendChild(li);
    }
    const note = document.createElement('p');
    note.textContent =
      'Archiving is a copy only — these routes stay as-is in the live data. Review them if you expected a clean end of year.';
    box.append(title, list, note);
    yearArchivePreviewBody.appendChild(box);
  } else {
    const ok = document.createElement('p');
    ok.className = 'field-hint';
    ok.textContent =
      'No mid-flight routes (ACCUMULATING, BID_PENDING, BUMP_ELIGIBLE, or NEEDS_REVIEW).';
    yearArchivePreviewBody.appendChild(ok);
  }

  const copyNote = document.createElement('p');
  copyNote.className = 'field-hint';
  copyNote.textContent =
    'Nothing will be deleted. Live data stays in place; this only creates a folder under archives/.';
  yearArchivePreviewBody.appendChild(copyNote);

  enhanceGlossaryTips(yearArchivePreviewBody);
  if (yearArchivePreviewPanel) yearArchivePreviewPanel.hidden = false;
}

document
  .getElementById('year-archive-preview')
  ?.addEventListener('click', async () => {
    try {
      const folder = (yearArchiveFolderNameEl?.value || '').trim();
      if (!folder) {
        throw new Error('Enter an archive folder name before previewing.');
      }
      const preview = await fetchJson('/api/year-archive/preview');
      if (!preview.has_meaningful_data) {
        applyYearRolloverUi(preview);
        showYearArchiveStatus(
          preview.first_use_note || 'Nothing to archive.',
          'warn'
        );
        return;
      }
      yearArchivePreview = preview;
      renderYearArchivePreview(preview);
      if (yearArchiveConfirmFolderEl && !yearArchiveConfirmFolderEl.value) {
        // Leave confirm blank — admin must retype intentionally.
      }
      showYearArchiveStatus(
        `Ready to archive as “${folder}”. Retype the folder name, add your name and note, then create the archive.`,
        'ok'
      );
    } catch (error) {
      showYearArchiveStatus(error.message, 'error');
    }
  });

document
  .getElementById('year-archive-cancel')
  ?.addEventListener('click', () => {
    if (yearArchivePreviewPanel) yearArchivePreviewPanel.hidden = true;
    if (yearArchivePreviewBody) yearArchivePreviewBody.innerHTML = '';
    if (yearArchiveConfirmFolderEl) yearArchiveConfirmFolderEl.value = '';
    showYearArchiveStatus('Archive preview cancelled.', 'ok');
  });

document
  .getElementById('year-archive-commit')
  ?.addEventListener('click', async () => {
    try {
      const archive_folder_name = (
        yearArchiveFolderNameEl?.value || ''
      ).trim();
      const confirm_folder_name = (
        yearArchiveConfirmFolderEl?.value || ''
      ).trim();
      const entered_by = (yearArchiveEnteredByEl?.value || '').trim();
      const note = (yearArchiveNoteEl?.value || '').trim();

      if (!archive_folder_name) {
        throw new Error('Archive folder name is required.');
      }
      if (!confirm_folder_name) {
        throw new Error('Retype the archive folder name to confirm.');
      }
      if (confirm_folder_name !== archive_folder_name) {
        throw new Error(
          'Confirmation does not match the archive folder name. Retype it exactly.'
        );
      }
      if (!entered_by) {
        throw new Error('Select your name (Entered by).');
      }
      if (!note) {
        throw new Error('A note is required.');
      }

      const result = await fetchJson('/api/year-archive/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archive_folder_name,
          confirm_folder_name,
          entered_by,
          note,
        }),
      });

      localStorage.setItem('rct_entered_by', entered_by);

      if (yearArchivePreviewPanel) yearArchivePreviewPanel.hidden = true;
      if (yearArchivePreviewBody) yearArchivePreviewBody.innerHTML = '';
      if (yearArchiveConfirmFolderEl) yearArchiveConfirmFolderEl.value = '';
      if (yearArchiveNoteEl) yearArchiveNoteEl.value = '';

      showYearArchiveDoneScreen(result);
      showYearArchiveStatus(
        `Archive created at ${result.relative_path || archive_folder_name}. Live data was not changed.`,
        'ok'
      );
      enhanceIcons();
    } catch (error) {
      showYearArchiveStatus(error.message, 'error');
    }
  });

document
  .getElementById('year-archive-start-import')
  ?.addEventListener('click', () => {
    yearImportUnlocked = true;
    applyYearRolloverUi(yearArchivePreview, {
      afterArchive: true,
      showImport: true,
    });
    yearImportStepEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

// --- Import new roster (step 2 / first-use) ---

const BULK_COLUMNS = [
  { key: 'driver_name', label: 'Driver Name' },
  { key: 'driver_email', label: 'Driver Email' },
  { key: 'hire_date', label: 'Hire Date' },
  { key: 'route_id', label: 'Route' },
  { key: 'am_time', label: 'AM Time' },
  { key: 'midday_time', label: 'Midday Time' },
  { key: 'pm_time', label: 'PM Time' },
];

const BULK_HEADER_ALIASES = {
  driver_name: 'driver_name',
  drivername: 'driver_name',
  name: 'driver_name',
  driver_email: 'driver_email',
  driveremail: 'driver_email',
  email: 'driver_email',
  hire_date: 'hire_date',
  hiredate: 'hire_date',
  hired: 'hire_date',
  route_id: 'route_id',
  routeid: 'route_id',
  route: 'route_id',
  am_time: 'am_time',
  am: 'am_time',
  midday_time: 'midday_time',
  midday: 'midday_time',
  md_time: 'midday_time',
  pm_time: 'pm_time',
  pm: 'pm_time',
};

const BULK_EMPTY_ROWS = 8;
const BULK_MIN_ROWS = 1;
const BULK_MAX_ROWS = 500;

const bulkImportTbody = document.getElementById('bulk-import-tbody');
const bulkImportTableWrap = document.getElementById('bulk-import-table-wrap');
const bulkImportRowCountEl = document.getElementById('bulk-import-row-count');
const bulkImportTemplateCountEl = document.getElementById('bulk-import-template-count');
const bulkImportFileEl = document.getElementById('bulk-import-file');
const bulkImportStatusEl = document.getElementById('bulk-import-status');
const bulkImportEnteredByEl = document.getElementById('bulk-import-entered-by');
const bulkImportNoteEl = document.getElementById('bulk-import-note');
const bulkImportPreviewPanel = document.getElementById('bulk-import-preview-panel');
const bulkImportPreviewBody = document.getElementById('bulk-import-preview-body');
const bulkImportCommitBtn = document.getElementById('bulk-import-commit');

/** @type {{ text: string, preview: object } | null} */
let pendingBulkImport = null;

/**
 * @param {string} line
 * @param {string} delimiter
 * @returns {string[]}
 */
function splitDelimitedLine(line, delimiter) {
  /** @type {string[]} */
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      fields.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/**
 * @param {string} headerCell
 * @returns {string | null}
 */
function normalizeBulkHeader(headerCell) {
  const key = String(headerCell || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return BULK_HEADER_ALIASES[key] ?? null;
}

/**
 * @param {string} headerLine
 * @returns {string}
 */
function detectBulkDelimiter(headerLine) {
  const candidates = ['\t', ',', ';'];
  let best = '\t';
  let bestScore = -1;
  for (const delimiter of candidates) {
    const cells = splitDelimitedLine(headerLine, delimiter);
    const recognized = cells.filter((c) => normalizeBulkHeader(c)).length;
    const score = recognized > 0 ? recognized * 10 + cells.length : cells.length;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

/**
 * @param {string} text
 * @returns {string[][]}
 */
function parseBulkPasteText(text) {
  const normalized = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!normalized) return [];

  const lines = normalized.split('\n').filter((line) => line.trim() !== '');
  if (!lines.length) return [];

  const delimiter = detectBulkDelimiter(lines[0]);
  const firstCells = splitDelimitedLine(lines[0], delimiter);
  const headerMap = firstCells.map((c) => normalizeBulkHeader(c));
  const recognized = headerMap.filter(Boolean).length;
  const hasHeaderRow = recognized >= 2;

  /** @type {string[][]} */
  const rows = [];

  if (hasHeaderRow) {
    /** @type {Record<string, number>} */
    const columnIndex = {};
    for (let i = 0; i < headerMap.length; i += 1) {
      const mapped = headerMap[i];
      if (mapped && columnIndex[mapped] == null) columnIndex[mapped] = i;
    }
    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
      const cells = splitDelimitedLine(lines[lineIndex], delimiter);
      rows.push(
        BULK_COLUMNS.map((col) => {
          const idx = columnIndex[col.key];
          return idx == null ? '' : String(cells[idx] ?? '').trim();
        })
      );
    }
  } else {
    for (const line of lines) {
      const cells = splitDelimitedLine(line, delimiter);
      rows.push(
        BULK_COLUMNS.map((_, i) => String(cells[i] ?? '').trim())
      );
    }
  }

  return rows.filter((row) => row.some((cell) => cell !== ''));
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeCsvCell(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * @param {number} rowCount
 * @returns {string}
 */
function buildBulkImportCsvTemplate(rowCount) {
  const count = Math.max(
    BULK_MIN_ROWS,
    Math.min(BULK_MAX_ROWS, Math.floor(Number(rowCount)) || BULK_MIN_ROWS)
  );
  const header = BULK_COLUMNS.map((col) => col.key).join(',');
  const blankRow = BULK_COLUMNS.map(() => '').join(',');
  const lines = [header];
  for (let i = 0; i < count; i += 1) {
    lines.push(blankRow);
  }
  return `${lines.join('\n')}\n`;
}

function downloadBulkImportCsvTemplate() {
  const rawCount = bulkImportTemplateCountEl?.value ?? BULK_EMPTY_ROWS;
  const count = Math.max(
    BULK_MIN_ROWS,
    Math.min(BULK_MAX_ROWS, Math.floor(Number(rawCount)) || BULK_MIN_ROWS)
  );
  if (bulkImportTemplateCountEl) {
    bulkImportTemplateCountEl.value = String(count);
  }
  const csv = buildBulkImportCsvTemplate(count);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'bulk-import-roster.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function createBulkImportRow(values = []) {
  const tr = document.createElement('tr');
  const numTd = document.createElement('td');
  numTd.className = 'bulk-import-row-num';
  numTd.setAttribute('aria-hidden', 'true');
  tr.appendChild(numTd);
  for (let i = 0; i < BULK_COLUMNS.length; i += 1) {
    const col = BULK_COLUMNS[i];
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'bulk-import-cell';
    input.setAttribute('data-col', col.key);
    input.setAttribute('aria-label', col.label);
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = values[i] ?? '';
    if (col.key === 'am_time' || col.key === 'midday_time' || col.key === 'pm_time') {
      input.placeholder = 'H:MM-H:MM';
    }
    td.appendChild(input);
    tr.appendChild(td);
  }
  return tr;
}

function renumberBulkImportRows() {
  const rows = bulkImportTbody.children;
  for (let i = 0; i < rows.length; i += 1) {
    const numCell = rows[i].querySelector('.bulk-import-row-num');
    if (numCell) numCell.textContent = String(i + 1);
  }
  if (bulkImportRowCountEl) {
    bulkImportRowCountEl.value = String(rows.length);
  }
}

function ensureBulkImportRows(minCount) {
  while (bulkImportTbody.children.length < minCount) {
    bulkImportTbody.appendChild(createBulkImportRow());
  }
  renumberBulkImportRows();
}

/**
 * @param {number} count
 */
function setBulkImportRowCount(count) {
  const target = Math.max(
    BULK_MIN_ROWS,
    Math.min(BULK_MAX_ROWS, Math.floor(Number(count)) || BULK_MIN_ROWS)
  );
  const current = bulkImportTbody.children.length;
  if (target > current) {
    ensureBulkImportRows(target);
    return;
  }
  if (target < current) {
    while (bulkImportTbody.children.length > target) {
      bulkImportTbody.lastElementChild?.remove();
    }
  }
  renumberBulkImportRows();
}

/**
 * @param {string[][]} rows
 * @param {{ startRow?: number, startCol?: number, replace?: boolean }} [options]
 */
function fillBulkImportTable(rows, options = {}) {
  const startRow = options.startRow ?? 0;
  const startCol = options.startCol ?? 0;
  const replace = options.replace ?? false;

  if (replace) {
    bulkImportTbody.innerHTML = '';
  }

  if (!rows.length) {
    ensureBulkImportRows(BULK_EMPTY_ROWS);
    return;
  }

  ensureBulkImportRows(startRow + rows.length);

  for (let r = 0; r < rows.length; r += 1) {
    const tr = bulkImportTbody.children[startRow + r];
    if (!tr) continue;
    const inputs = tr.querySelectorAll('input');
    for (let c = 0; c < rows[r].length; c += 1) {
      const input = inputs[startCol + c];
      if (input) input.value = rows[r][c];
    }
  }

  // Keep a couple of blank rows under the pasted data for easy edits.
  ensureBulkImportRows(startRow + rows.length + 2);
}

function clearBulkImportTable() {
  bulkImportTbody.innerHTML = '';
  ensureBulkImportRows(BULK_EMPTY_ROWS);
  if (bulkImportFileEl) bulkImportFileEl.value = '';
}

function serializeBulkImportTable() {
  /** @type {string[][]} */
  const dataRows = [];
  for (const tr of bulkImportTbody.querySelectorAll('tr')) {
    const cells = [...tr.querySelectorAll('input')].map((input) =>
      input.value.trim()
    );
    if (cells.some((cell) => cell !== '')) dataRows.push(cells);
  }
  if (!dataRows.length) return '';
  const header = BULK_COLUMNS.map((col) => col.key).join(',');
  const body = dataRows
    .map((cells) => cells.map(escapeCsvCell).join(','))
    .join('\n');
  return `${header}\n${body}`;
}

/**
 * @param {HTMLElement | null} target
 * @returns {{ row: number, col: number } | null}
 */
function bulkImportCellPosition(target) {
  if (!(target instanceof HTMLInputElement)) return null;
  if (!target.classList.contains('bulk-import-cell')) return null;
  const tr = target.closest('tr');
  if (!tr || !bulkImportTbody.contains(tr)) return null;
  const row = [...bulkImportTbody.children].indexOf(tr);
  const col = [...tr.querySelectorAll('input')].indexOf(target);
  if (row < 0 || col < 0) return null;
  return { row, col };
}

async function loadBulkImportStaffNames() {
  await loadYearRolloverStaffNames();
}

clearBulkImportTable();

bulkImportTableWrap.addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text/plain');
  if (!text) return;
  // Only hijack multi-row / multi-column spreadsheet pastes; let
  // single-cell edits use the browser default.
  if (!text.includes('\n') && !text.includes('\t')) return;

  const rows = parseBulkPasteText(text);
  if (!rows.length) return;

  event.preventDefault();
  const pos = bulkImportCellPosition(event.target);
  const tableIsEmpty = ![...bulkImportTbody.querySelectorAll('input')].some(
    (input) => input.value.trim() !== ''
  );

  if (tableIsEmpty || !pos) {
    fillBulkImportTable(rows, { replace: true });
  } else {
    fillBulkImportTable(rows, {
      startRow: pos.row,
      startCol: pos.col,
      replace: false,
    });
  }

  showBulkImportStatus(
    `Pasted ${rows.length} row(s) into the table — preview when ready.`,
    'ok'
  );
});

bulkImportRowCountEl.addEventListener('change', () => {
  setBulkImportRowCount(bulkImportRowCountEl.value);
});

document
  .getElementById('bulk-import-download-template')
  .addEventListener('click', () => {
    downloadBulkImportCsvTemplate();
  });

document.getElementById('bulk-import-clear').addEventListener('click', () => {
  clearBulkImportTable();
  pendingBulkImport = null;
  bulkImportPreviewPanel.hidden = true;
  bulkImportCommitBtn.hidden = true;
  bulkImportPreviewBody.innerHTML = '';
  showBulkImportStatus('Import table cleared.', 'ok');
});

bulkImportFileEl.addEventListener('change', async () => {
  const file = bulkImportFileEl.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const rows = parseBulkPasteText(text);
    if (!rows.length) {
      throw new Error(
        'No filled driver rows found. Add data to the template (keep the header), save as CSV, then try again.'
      );
    }
    fillBulkImportTable(rows, { replace: true });
    bulkImportTableWrap?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showBulkImportStatus(
      `Loaded ${rows.length} row(s) from ${file.name} into the table — preview when ready.`,
      'ok'
    );
  } catch (error) {
    showBulkImportStatus(error.message, 'error');
  } finally {
    // Allow re-selecting the same file after a failed or partial try.
    bulkImportFileEl.value = '';
  }
});

function collectBulkResolutions() {
  /** @type {Record<string, 'skip' | 'overwrite'>} */
  const resolutions = {};
  for (const select of bulkImportPreviewBody.querySelectorAll(
    'select.bulk-conflict-resolution'
  )) {
    const row = select.getAttribute('data-row');
    const value = select.value;
    if (row && (value === 'skip' || value === 'overwrite')) {
      resolutions[row] = value;
    }
  }
  return resolutions;
}

function renderBulkImportPreview(preview) {
  bulkImportPreviewBody.innerHTML = '';

  const stats = document.createElement('dl');
  stats.className = 'gen-preview-stats';
  stats.innerHTML = `
    <div><dt>New drivers (no conflicts)</dt><dd>${preview.summary.new_drivers_count}</dd></div>
    <div><dt>New routes (no conflicts)</dt><dd>${preview.summary.new_routes_count}</dd></div>
    <div><dt>Valid rows</dt><dd>${preview.summary.planned_row_count}</dd></div>
    <div><dt>Conflicts needing resolution</dt><dd>${preview.summary.conflict_row_count}</dd></div>
    <div><dt>Excluded (invalid)</dt><dd>${preview.summary.excluded_row_count}</dd></div>
  `;
  bulkImportPreviewBody.appendChild(stats);

  if (preview.unresolved_seniority_ties?.length) {
    const warn = document.createElement('div');
    warn.className = 'status visible warn';
    const groups = preview.unresolved_seniority_ties
      .map((tie) => {
        const names = (tie.drivers ?? []).map((d) => d.name).join(', ');
        return `${tie.hire_date}: ${names}`;
      })
      .join(' · ');
    const n = preview.unresolved_seniority_ties.length;
    warn.appendChild(
      document.createTextNode(
        `${n} same-date seniority tie${n === 1 ? '' : 's'} will need ` +
          `resolving on the Drivers/Routes page after office lots. The contract ` +
          `requires same-date ties to be resolved by drawing lots (`
      )
    );
    appendCitationLinks(warn, ['3.01']);
    warn.appendChild(document.createTextNode(`) — ${groups}`));
    bulkImportPreviewBody.appendChild(warn);
  }

  if (preview.excluded_rows?.length) {
    const title = document.createElement('h4');
    title.textContent = 'Excluded rows (not imported)';
    const ul = document.createElement('ul');
    ul.className = 'report-changes bulk-excluded-list';
    for (const row of preview.excluded_rows) {
      const li = document.createElement('li');
      const label =
        row.raw?.route_id || row.raw?.driver_name
          ? `${row.raw.driver_name || '—'} / ${row.raw.route_id || '—'}`
          : 'row';
      li.textContent = `Row ${row.row_number} (${label}): ${row.reasons.join(' ')}`;
      ul.appendChild(li);
    }
    bulkImportPreviewBody.append(title, ul);
  }

  if (preview.conflicts?.length) {
    const title = document.createElement('h4');
    title.textContent = 'Conflicts — resolve each before commit';
    const box = document.createElement('div');
    box.className = 'gen-conflict-box bulk-conflict-list';

    const intro = document.createElement('p');
    intro.textContent =
      'Existing route_id or driver name matches require an explicit choice. Overwrite replaces a clean seeded route or links/updates an existing driver; skip leaves that row out.';
    box.appendChild(intro);

    for (const conflict of preview.conflicts) {
      const conflictRow = document.createElement('div');
      conflictRow.className = 'bulk-conflict-row';

      const types = conflict.conflict_types
        .map((t) =>
          t === 'existing_route'
            ? 'route already exists'
            : 'driver name already exists'
        )
        .join('; ');

      const detail = document.createElement('div');
      detail.className = 'bulk-conflict-detail';
      detail.innerHTML = `
        <strong>Row ${conflict.row_number}</strong>
        — ${conflict.driver_name} → ${conflict.route_id}
        <span class="field-hint">${types}</span>
        ${
          conflict.existing_route
            ? `<span class="field-hint">Current route status: ${conflict.existing_route.status}${
                conflict.existing_route.driver_name
                  ? ` · ${conflict.existing_route.driver_name}`
                  : ''
              }</span>`
            : ''
        }
        ${
          conflict.overwrite_blocked_reason
            ? `<span class="field-hint">${conflict.overwrite_blocked_reason}</span>`
            : ''
        }
      `;

      const label = document.createElement('label');
      label.className = 'field bulk-conflict-choice';
      label.appendChild(document.createTextNode('Resolution'));
      const select = document.createElement('select');
      select.className = 'bulk-conflict-resolution';
      select.setAttribute('data-row', String(conflict.row_number));

      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Choose…';
      select.appendChild(blank);

      const skipOpt = document.createElement('option');
      skipOpt.value = 'skip';
      skipOpt.textContent = 'Skip this row';
      select.appendChild(skipOpt);

      const overwriteOpt = document.createElement('option');
      overwriteOpt.value = 'overwrite';
      overwriteOpt.disabled = !conflict.overwrite_allowed;
      if (
        conflict.conflict_types.includes('existing_route') &&
        conflict.conflict_types.includes('existing_driver')
      ) {
        overwriteOpt.textContent = 'Overwrite route & use existing driver';
      } else if (conflict.conflict_types.includes('existing_route')) {
        overwriteOpt.textContent = 'Overwrite existing route';
      } else {
        overwriteOpt.textContent =
          'Use existing driver (update email if provided)';
      }
      select.appendChild(overwriteOpt);

      label.appendChild(select);
      conflictRow.append(detail, label);
      box.appendChild(conflictRow);
    }

    bulkImportPreviewBody.append(title, box);
    setLabeledIcon(bulkImportCommitBtn, 'check', 'Resolve conflicts & commit');
  } else {
    setLabeledIcon(bulkImportCommitBtn, 'check', 'Commit import');
  }

  if (preview.planned?.length && !preview.conflicts?.length) {
    const title = document.createElement('h4');
    title.textContent = 'Rows to create';
    const ul = document.createElement('ul');
    ul.className = 'report-changes';
    for (const row of preview.planned.slice(0, 40)) {
      const li = document.createElement('li');
      const segs = ['AM', 'MIDDAY', 'PM']
        .filter((s) => row.segments[s])
        .map((s) => `${s} ${row.segments[s]}`)
        .join(', ');
      li.textContent = `${row.driver_name} → ${row.route_id} (${segs || 'no times'})`;
      ul.appendChild(li);
    }
    if (preview.planned.length > 40) {
      const more = document.createElement('li');
      more.textContent = `…and ${preview.planned.length - 40} more`;
      ul.appendChild(more);
    }
    bulkImportPreviewBody.append(title, ul);
  }

  const canCommit =
    preview.summary.planned_row_count > 0 ||
    preview.summary.conflict_row_count > 0;
  bulkImportCommitBtn.hidden = !canCommit;
  bulkImportPreviewPanel.hidden = false;
}

document.getElementById('bulk-import-preview').addEventListener('click', async () => {
  try {
    const text = serializeBulkImportTable();
    if (!text.trim()) {
      throw new Error('Paste or type at least one roster row into the table first.');
    }
    const preview = await fetchJson('/api/bulk-import/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    pendingBulkImport = { text, preview };
    renderBulkImportPreview(preview);
    showBulkImportStatus(
      preview.requires_resolutions
        ? 'Preview ready — resolve each conflict before commit.'
        : preview.summary.planned_row_count === 0
          ? 'Preview ready — no valid rows to import.'
          : 'Preview ready — review counts, then commit.',
      preview.requires_resolutions || preview.summary.planned_row_count === 0
        ? 'warn'
        : 'ok'
    );
  } catch (error) {
    showBulkImportStatus(error.message, 'error');
  }
});

document.getElementById('bulk-import-cancel').addEventListener('click', () => {
  pendingBulkImport = null;
  bulkImportPreviewPanel.hidden = true;
  bulkImportCommitBtn.hidden = true;
  bulkImportPreviewBody.innerHTML = '';
});

document.getElementById('bulk-import-commit').addEventListener('click', async () => {
  try {
    if (!pendingBulkImport?.text) {
      throw new Error('Preview an import first.');
    }
    const entered_by = bulkImportEnteredByEl?.value.trim() || '';
    const note = bulkImportNoteEl?.value.trim() || '';

    const resolutions = collectBulkResolutions();
    if (pendingBulkImport.preview.requires_resolutions) {
      for (const conflict of pendingBulkImport.preview.conflicts) {
        const choice = resolutions[String(conflict.row_number)];
        if (choice !== 'skip' && choice !== 'overwrite') {
          throw new Error(
            `Choose skip or overwrite for row ${conflict.row_number} (${conflict.route_id}).`
          );
        }
        if (choice === 'overwrite' && !conflict.overwrite_allowed) {
          throw new Error(
            conflict.overwrite_blocked_reason ||
              `Overwrite is not allowed for row ${conflict.row_number}.`
          );
        }
      }
    }

    bulkImportCommitBtn.disabled = true;
    const result = await fetchJson('/api/bulk-import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: pendingBulkImport.text,
        entered_by,
        note,
        resolutions,
      }),
    });

    if (entered_by) {
      localStorage.setItem('rct_entered_by', entered_by);
    }
    pendingBulkImport = null;
    bulkImportPreviewPanel.hidden = true;
    bulkImportCommitBtn.hidden = true;
    bulkImportPreviewBody.innerHTML = '';
    clearBulkImportTable();
    if (bulkImportNoteEl) bulkImportNoteEl.value = '';

    const s = result.summary;
    showBulkImportStatus(
      `Imported ${s.accepted_row_count} row(s): ${s.new_drivers_count} new driver(s), ${s.new_routes_count} new route(s)` +
        (s.overwritten_routes_count
          ? `, ${s.overwritten_routes_count} overwritten`
          : '') +
        (s.skipped_row_count ? `, ${s.skipped_row_count} skipped` : '') +
        '.',
      'ok',
      { scrollToCommit: false }
    );
    await loadQueue();
  } catch (error) {
    showBulkImportStatus(error.message, 'error');
  } finally {
    bulkImportCommitBtn.disabled = false;
  }
});
