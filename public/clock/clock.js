import { enhanceIcons } from '../shared/icons.js';

const listView = document.querySelector('#list-view');
const detailView = document.querySelector('#detail-view');
const rosterEl = document.querySelector('#roster');
const searchEl = document.querySelector('#name-search');
const statusEl = document.querySelector('#status');
const driverNameEl = document.querySelector('#driver-name');
const driverRoutesEl = document.querySelector('#driver-routes');
const pinForm = document.querySelector('#pin-form');
const pinInput = document.querySelector('#pin');
const pinError = document.querySelector('#pin-error');
const punchActions = document.querySelector('#punch-actions');
const punchError = document.querySelector('#punch-error');
const punchNote = document.querySelector('#punch-note');
const punchReason = document.querySelector('#punch-reason');
const punchReasonList = document.querySelector('#punch-reason-list');
const myRecords = document.querySelector('#my-records');
const clockIn = document.querySelector('#clock-in');
const clockOut = document.querySelector('#clock-out');
const clockNow = document.querySelector('#clock-now');
const punchConfirm = document.querySelector('#punch-confirm');
const punchConfirmText = document.querySelector('#punch-confirm-text');
const punchConfirmOk = document.querySelector('#punch-confirm-ok');
const officeLink = document.querySelector('#office-link');
const leaveForm = document.querySelector('#leave-form');
const leaveCode = document.querySelector('#leave-code');
const leaveError = document.querySelector('#leave-error');

/**
 * @typedef {{ id: string, label: string }} ReasonCode
 * @typedef {{
 *   id: string,
 *   driver_name: string,
 *   action: 'in' | 'out',
 *   punched_at: string,
 *   note: string,
 *   note_at: string | null,
 *   reason_codes: ReasonCode[],
 * }} Punch
 */

/** @type {Array<{ driver_id: string, name: string, routes: string[], pin_set: boolean, clock_status: 'in' | 'out' | null }>} */
let roster = [];
/** @type {{ driver_id: string, name: string, routes: string[], pin_set: boolean, clock_status: 'in' | 'out' | null } | null} */
let selected = null;
let pin = '';
let pinAttempt = 0;
/** @type {ReasonCode[]} */
let reasonCodes = [];
/** @type {string[]} */
let draftReasonIds = [];
/** @type {Punch[]} */
let mine = [];
let editingId = '';
let editNote = '';
/** @type {string[]} */
let editReasonIds = [];
/** @type {ReturnType<typeof setTimeout> | undefined} */
let punchConfirmTimer;

enhanceIcons();

searchEl.addEventListener('input', renderRoster);
document.querySelector('#back').addEventListener('click', () => showList(''));
pinForm.addEventListener('submit', onPin);
pinInput.addEventListener('input', onPinInput);
clockIn.addEventListener('click', () => punch('in'));
clockOut.addEventListener('click', () => punch('out'));
punchConfirmOk.addEventListener('click', hidePunchConfirm);
startClock();
document.querySelector('#add-punch-reason').addEventListener('click', () => {
  addReasonId(draftReasonIds, punchReason.value);
  renderDraftReasons();
});
leaveForm.addEventListener('submit', onLeave);
leaveCode.addEventListener('input', () => {
  leaveError.textContent = '';
});

loadKioskLock().catch(() => {});
loadReasonCodes().catch(() => {
  reasonCodes = [];
  fillReasonSelect(punchReason, draftReasonIds);
});
loadRoster().catch((error) => {
  statusEl.textContent = error instanceof Error ? error.message : 'Could not load drivers.';
});

async function loadKioskLock() {
  const response = await fetch('/api/clock/kiosk');
  const body = await response.json().catch(() => ({}));
  if (!body.locked) return;
  officeLink.hidden = true;
  leaveForm.hidden = false;
  history.pushState(null, '', '/clock');
  window.addEventListener('popstate', () => {
    history.pushState(null, '', '/clock');
  });
}

async function onLeave(event) {
  event.preventDefault();
  leaveError.textContent = '';
  const response = await fetch('/api/clock/kiosk/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: leaveCode.value.trim() }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    leaveCode.value = '';
    leaveError.textContent = body.error || 'That lock code does not match.';
    leaveCode.focus();
    return;
  }
  window.location.href = '/admin/clock';
}

const NAME_COLOR_KEY = 'clock-name-button-colors';

/** @type {Map<string, number>} */
let nameColors = new Map();

/**
 * @param {{ name: string }} a
 * @param {{ name: string }} b
 */
function compareDriverNames(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

function readStoredNameColors() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NAME_COLOR_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * @param {number} index
 */
function hueForColorIndex(index) {
  return (index * 47) % 360;
}

/**
 * @param {number} a
 * @param {number} b
 */
function hueDistance(a, b) {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

/**
 * Pick an unused palette slot whose hue is as far as possible from colors already in use.
 * @param {Set<number>} used
 */
function nextColorIndex(used) {
  const limit = Math.max(used.size + 36, 12);
  let best = 0;
  let bestDistance = -1;
  for (let index = 0; index < limit; index += 1) {
    if (used.has(index)) continue;
    const hue = hueForColorIndex(index);
    let nearest = 180;
    for (const taken of used) nearest = Math.min(nearest, hueDistance(hue, hueForColorIndex(taken)));
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = index;
    }
  }
  return best;
}

/**
 * @param {number} index
 */
function nameButtonColors(index) {
  const hue = hueForColorIndex(index);
  const band = index % 3;
  const saturation = [52, 64, 42][band];
  const lightness = [86, 80, 91][band];
  return {
    background: `hsl(${hue} ${saturation}% ${lightness}%)`,
    border: `hsl(${hue} ${Math.min(saturation + 12, 78)}% ${lightness - 18}%)`,
  };
}

/**
 * Keep a stable color for each driver id. New people get a free color; saved ones stay put.
 * @param {Array<{ driver_id: string, name: string }>} drivers
 */
function ensureNameColors(drivers) {
  const stored = readStoredNameColors();
  /** @type {Map<string, number>} */
  const assigned = new Map();
  const used = new Set();
  const ordered = [...drivers].sort(compareDriverNames);
  for (const driver of ordered) {
    const saved = stored[driver.driver_id];
    if (!Number.isInteger(saved) || saved < 0 || used.has(saved)) continue;
    assigned.set(driver.driver_id, saved);
    used.add(saved);
  }
  let changed = false;
  for (const driver of ordered) {
    if (assigned.has(driver.driver_id)) continue;
    const index = nextColorIndex(used);
    assigned.set(driver.driver_id, index);
    used.add(index);
    stored[driver.driver_id] = index;
    changed = true;
  }
  if (changed) {
    try {
      localStorage.setItem(NAME_COLOR_KEY, JSON.stringify(stored));
    } catch {
      // The colors still apply for this visit when storage is blocked.
    }
  }
  return assigned;
}

async function loadRoster() {
  const response = await fetch('/api/clock/roster');
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not load drivers.');
  roster = (body.drivers ?? []).slice().sort(compareDriverNames);
  nameColors = ensureNameColors(roster);
  renderRoster();
}

function renderRoster() {
  const query = searchEl.value.trim().toLowerCase();
  const names = roster
    .filter((driver) => driver.name.toLowerCase().includes(query))
    .sort(compareDriverNames);
  rosterEl.replaceChildren();
  rosterLayoutKey = '';
  if (!names.length) {
    rosterEl.style.removeProperty('grid-template-columns');
    rosterEl.style.removeProperty('grid-template-rows');
    rosterEl.style.removeProperty('grid-auto-rows');
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = roster.length ? 'No name matches.' : 'No drivers on file.';
    rosterEl.append(empty);
    return;
  }
  for (const driver of names) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'name-btn';
    const colors = nameButtonColors(nameColors.get(driver.driver_id) ?? 0);
    button.style.background = colors.background;
    button.style.borderColor = colors.border;
    const label = document.createElement('span');
    label.className = 'name-label';
    label.textContent = driver.name;
    button.append(label);
    const status = driver.clock_status === 'in' ? 'in' : 'out';
    button.classList.add('has-status');
    const badge = document.createElement('span');
    badge.className = `status-badge status-${status}`;
    badge.textContent = status === 'in' ? 'IN' : 'OUT';
    button.append(badge);
    button.addEventListener('click', () => openDriver(driver));
    rosterEl.append(button);
  }
  scheduleRosterLayout();
}

/** 1.5in at 96 CSS pixels per inch. Buttons stay at least this wide. */
const NAME_BUTTON_MIN_WIDTH = 144;
/** Tall enough for 14px text plus the button's own padding. */
const NAME_BUTTON_MIN_HEIGHT = 40;

let rosterLayoutKey = '';
let rosterLayoutFrame = 0;

function scheduleRosterLayout() {
  cancelAnimationFrame(rosterLayoutFrame);
  rosterLayoutFrame = requestAnimationFrame(layoutRoster);
}

function layoutRoster() {
  const count = rosterEl.querySelectorAll('.name-btn').length;
  if (!count || listView.hidden) return;
  const width = rosterEl.clientWidth;
  const height = rosterEl.clientHeight;
  if (width < 8 || height < 8) return;
  const styles = getComputedStyle(rosterEl);
  const columnGap = Number.parseFloat(styles.columnGap) || 0;
  const rowGap = Number.parseFloat(styles.rowGap) || columnGap;
  const pitch = NAME_BUTTON_MIN_WIDTH + columnGap;
  let cols = Math.round((width + columnGap) / pitch);
  cols = Math.max(1, Math.min(count, cols));
  const columnWidth = (width - columnGap * Math.max(0, cols - 1)) / cols;
  if (columnWidth < 120 && cols > 1) cols -= 1;
  const rows = Math.ceil(count / cols);
  const share = (height - rowGap * Math.max(0, rows - 1)) / rows;
  const rowHeight = Math.max(NAME_BUTTON_MIN_HEIGHT, share);
  const columns = `repeat(${cols}, minmax(0, 1fr))`;
  const autoRows = `${rowHeight}px`;
  const key = `${width}x${height}:${count}:${columns}:${autoRows}`;
  if (key === rosterLayoutKey) return;
  rosterLayoutKey = key;
  rosterEl.style.gridTemplateColumns = columns;
  rosterEl.style.removeProperty('grid-template-rows');
  rosterEl.style.gridAutoRows = autoRows;
}

new ResizeObserver(() => scheduleRosterLayout()).observe(rosterEl);

function openDriver(driver) {
  pinAttempt += 1;
  selected = driver;
  pin = '';
  pinInput.value = '';
  clearDraft();
  mine = [];
  editingId = '';
  myRecords.replaceChildren();
  pinError.textContent = driver.pin_set ? '' : 'No PIN on file. Ask the office to set one.';
  punchError.textContent = '';
  driverNameEl.textContent = driver.name;
  driverRoutesEl.textContent = driver.routes.length
    ? `Route ${driver.routes.join(', ')}`
    : 'No route assigned';
  pinForm.hidden = false;
  punchActions.hidden = true;
  pinInput.disabled = !driver.pin_set;
  listView.hidden = true;
  detailView.hidden = false;
  statusEl.textContent = '';
  if (driver.pin_set) pinInput.focus();
}

function showList(message) {
  pinAttempt += 1;
  selected = null;
  pin = '';
  pinInput.value = '';
  mine = [];
  editingId = '';
  myRecords.replaceChildren();
  detailView.hidden = true;
  listView.hidden = false;
  statusEl.textContent = message;
  scheduleRosterLayout();
  loadRoster().catch((error) => {
    statusEl.textContent = error instanceof Error ? error.message : 'Could not load drivers.';
  });
}

function startClock() {
  const paint = () => {
    const now = new Date();
    clockNow.dateTime = now.toISOString();
    clockNow.textContent = now.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  };
  const tick = () => {
    paint();
    setTimeout(tick, 1000 - (Date.now() % 1000));
  };
  tick();
}

function showPunchConfirm(name, verb, when) {
  clearTimeout(punchConfirmTimer);
  punchConfirmText.replaceChildren();
  const nameLine = document.createElement('span');
  nameLine.textContent = name;
  const detailLine = document.createElement('span');
  detailLine.textContent = `${verb} at ${when}`;
  punchConfirmText.append(nameLine, detailLine);
  punchConfirm.hidden = false;
  punchConfirmOk.focus();
  punchConfirmTimer = setTimeout(hidePunchConfirm, 2000);
}

function hidePunchConfirm() {
  clearTimeout(punchConfirmTimer);
  if (punchConfirm.hidden) return;
  punchConfirm.hidden = true;
  if (!listView.hidden) searchEl.focus();
}

function pinDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 4);
}

function onPinInput() {
  const entered = pinDigits(pinInput.value);
  if (pinInput.value !== entered) pinInput.value = entered;
  if (!selected?.pin_set) return;
  pinError.textContent = '';
  if (entered.length === 4) void checkPin(entered);
  else pinAttempt += 1;
}

async function onPin(event) {
  event.preventDefault();
  const entered = pinDigits(pinInput.value);
  if (entered.length === 4) await checkPin(entered);
}

/**
 * A 4-digit PIN is checked as soon as the fourth digit is entered.
 * @param {string} entered
 */
async function checkPin(entered) {
  if (!selected?.pin_set || pin || !/^\d{4}$/.test(entered)) return;
  const attempt = ++pinAttempt;
  const driverId = selected.driver_id;
  pinError.textContent = '';
  let response;
  /** @type {{ error?: string }} */
  let body = {};
  try {
    response = await fetch('/api/clock/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driver_id: driverId, pin: entered }),
    });
    body = await response.json().catch(() => ({}));
  } catch {
    if (attempt !== pinAttempt || selected?.driver_id !== driverId) return;
    pinError.textContent = 'Could not check that PIN.';
    return;
  }
  if (attempt !== pinAttempt || selected?.driver_id !== driverId || pin) return;
  if (pinDigits(pinInput.value) !== entered) return;
  if (!response.ok) {
    pin = '';
    pinInput.value = '';
    pinError.textContent = body.error || 'Could not check that PIN.';
    pinInput.focus();
    return;
  }
  pin = entered;
  pinForm.hidden = true;
  punchActions.hidden = false;
  fillReasonSelect(punchReason, draftReasonIds);
  renderDraftReasons();
  clockIn.focus();
  await loadMine();
}

async function punch(action) {
  if (!selected || !pin) return;
  punchError.textContent = '';
  clockIn.disabled = true;
  clockOut.disabled = true;
  const note = punchNote.value;
  const reason_code_ids = draftReasonIds.slice();
  try {
    const response = await fetch('/api/clock/punches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        driver_id: selected.driver_id,
        pin,
        action,
        note,
        reason_code_ids,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body.error || 'Could not save that punch.';
      if (response.status === 401) {
        pin = '';
        pinInput.value = '';
        pinForm.hidden = false;
        punchActions.hidden = true;
        pinError.textContent = message;
        pinInput.focus();
      } else {
        punchError.textContent = message;
      }
      return;
    }
    const when = new Date(body.punched_at).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    const verb = body.action === 'in' ? 'Clocked in' : 'Clocked out';
    showList('');
    showPunchConfirm(body.driver_name, verb, when);
  } finally {
    clockIn.disabled = false;
    clockOut.disabled = false;
  }
}

async function loadReasonCodes() {
  const response = await fetch('/api/clock/reason-codes');
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not load reason codes.');
  reasonCodes = body.codes ?? [];
  fillReasonSelect(punchReason, draftReasonIds);
}

async function loadMine() {
  if (!selected || !pin) return;
  const response = await fetch('/api/clock/mine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driver_id: selected.driver_id, pin }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    punchError.textContent = body.error || 'Could not load your records.';
    return;
  }
  mine = body.punches ?? [];
  renderMine();
}

function renderDraftReasons() {
  renderReasonPicks(punchReasonList, draftReasonIds, (id) => {
    draftReasonIds = draftReasonIds.filter((item) => item !== id);
    renderDraftReasons();
  });
  fillReasonSelect(punchReason, draftReasonIds);
}

function renderMine() {
  myRecords.replaceChildren();
  if (!mine.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No clock records yet.';
    myRecords.append(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'record-list';
  for (const punch of mine) {
    list.append(recordCard(punch));
  }
  myRecords.append(list);
}

function recordCard(punch) {
  const card = document.createElement('article');
  card.className = 'record-card';
  const title = document.createElement('h4');
  const kind = punch.action === 'in' ? 'Clock in' : 'Clock out';
  title.textContent = `${kind} · ${formatWhen(punch.punched_at)}`;
  card.append(title);
  if (editingId === punch.id) {
    card.append(recordEditor(punch));
    return card;
  }
  card.append(noteBlock(punch));
  card.append(reasonLine(punch.reason_codes));
  const actions = document.createElement('div');
  actions.className = 'record-actions';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'secondary';
  edit.textContent = punch.note || punch.reason_codes.length ? 'Edit note' : 'Add note';
  edit.addEventListener('click', () => {
    editingId = punch.id;
    editNote = punch.note || '';
    editReasonIds = punch.reason_codes.map((code) => code.id);
    renderMine();
  });
  actions.append(edit);
  card.append(actions);
  return card;
}

function recordEditor(punch) {
  const form = document.createElement('form');
  form.className = 'record-editor';
  const label = document.createElement('label');
  label.append(document.createTextNode('Note'));
  const note = document.createElement('textarea');
  note.rows = 3;
  note.maxLength = 500;
  note.value = editNote;
  label.append(note);
  const reasonAdd = document.createElement('div');
  reasonAdd.className = 'reason-add';
  const reasonLabel = document.createElement('label');
  reasonLabel.append(document.createTextNode('Reason code'));
  const select = document.createElement('select');
  fillReasonSelect(select, editReasonIds);
  reasonLabel.append(select);
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = 'Add';
  add.addEventListener('click', () => {
    editNote = note.value;
    addReasonId(editReasonIds, select.value);
    renderMine();
  });
  reasonAdd.append(reasonLabel, add);
  const picks = document.createElement('ul');
  picks.className = 'reason-picks';
  renderReasonPicks(picks, editReasonIds, (id) => {
    editNote = note.value;
    editReasonIds = editReasonIds.filter((item) => item !== id);
    renderMine();
  });
  const actions = document.createElement('div');
  actions.className = 'record-actions';
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    editingId = '';
    renderMine();
  });
  actions.append(save, cancel);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveDetails(punch.id, note.value);
  });
  form.append(label, reasonAdd, picks, actions);
  return form;
}

async function saveDetails(id, note) {
  if (!selected || !pin) return;
  punchError.textContent = '';
  const response = await fetch(`/api/clock/punches/${encodeURIComponent(id)}/details`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      driver_id: selected.driver_id,
      pin,
      note,
      reason_code_ids: editReasonIds,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    punchError.textContent = body.error || 'Could not save that note.';
    return;
  }
  editingId = '';
  await loadMine();
}

function clearDraft() {
  punchNote.value = '';
  draftReasonIds = [];
  renderDraftReasons();
}

/**
 * @param {string[]} ids
 * @param {string} id
 */
function addReasonId(ids, id) {
  if (!id || ids.includes(id)) return;
  ids.push(id);
}

/**
 * @param {HTMLSelectElement} select
 * @param {string[]} selectedIds
 */
function fillReasonSelect(select, selectedIds) {
  const current = select.value;
  select.replaceChildren();
  const available = reasonCodes.filter((code) => !selectedIds.includes(code.id));
  if (!available.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = reasonCodes.length ? 'All reason codes added' : 'No reason codes yet';
    select.append(option);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Select a reason code…';
  select.append(blank);
  for (const code of available) {
    const option = document.createElement('option');
    option.value = code.id;
    option.textContent = code.label;
    select.append(option);
  }
  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

/**
 * @param {HTMLElement} list
 * @param {string[]} ids
 * @param {(id: string) => void} onRemove
 */
function renderReasonPicks(list, ids, onRemove) {
  list.replaceChildren();
  for (const id of ids) {
    const item = document.createElement('li');
    item.textContent = reasonLabel(id);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => onRemove(id));
    item.append(remove);
    list.append(item);
  }
}

function reasonLabel(id) {
  return reasonCodes.find((code) => code.id === id)?.label
    || mine.flatMap((punch) => punch.reason_codes).find((code) => code.id === id)?.label
    || 'Reason code';
}

function noteBlock(punch) {
  const block = document.createElement('p');
  block.className = 'record-note';
  if (!punch.note) {
    block.textContent = 'No note';
    return block;
  }
  block.append(document.createTextNode(punch.note));
  if (punch.note_at) {
    const when = document.createElement('span');
    when.className = 'noted-at';
    when.textContent = `Noted ${formatWhen(punch.note_at)}`;
    block.append(when);
  }
  return block;
}

function reasonLine(codes) {
  const line = document.createElement('p');
  line.className = 'hint';
  line.textContent = codes.length
    ? codes.map((code) => code.label).join(', ')
    : 'No reason codes';
  return line;
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
