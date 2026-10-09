import { enhanceIcons } from '../shared/icons.js';

const statusEl = document.querySelector('#office-status');
const addForm = document.querySelector('#add-form');
const addDriver = document.querySelector('#add-driver');
const addAction = document.querySelector('#add-action');
const addTime = document.querySelector('#add-time');
const punchRows = document.querySelector('#punch-rows');
const pinForm = document.querySelector('#pin-form');
const pinDriver = document.querySelector('#pin-driver');
const pinValue = document.querySelector('#pin-value');
const pinList = document.querySelector('#pin-list');
const lockForm = document.querySelector('#lock-form');
const lockCode = document.querySelector('#lock-code');
const startTimeclock = document.querySelector('#start-timeclock');
const reasonForm = document.querySelector('#reason-form');
const reasonLabelInput = document.querySelector('#reason-label');
const reasonList = document.querySelector('#reason-list');

/**
 * @typedef {{ id: string, label: string }} ReasonCode
 * @typedef {{
 *   id: string,
 *   driver_id: string,
 *   driver_name: string,
 *   action: 'in' | 'out',
 *   punched_at: string,
 *   note: string,
 *   note_at: string | null,
 *   reason_codes: ReasonCode[],
 * }} Punch
 */

/** @type {Array<{ driver_id: string, name: string, routes: string[], pin_set: boolean, pin?: string | null }>} */
let drivers = [];
/** @type {Punch[]} */
let punches = [];
/** @type {ReasonCode[]} */
let reasonCodes = [];
let editingId = '';
let editNote = '';
/** @type {string[]} */
let editReasonIds = [];
let editingCodeId = '';

enhanceIcons();
addTime.value = toLocalInput(new Date().toISOString());
addForm.addEventListener('submit', onAdd);
pinForm.addEventListener('submit', onPin);
lockForm.addEventListener('submit', onLockCode);
reasonForm.addEventListener('submit', onAddReason);
startTimeclock.addEventListener('click', onStartTimeclock);
load().catch((error) => setStatus(error instanceof Error ? error.message : 'Could not load records.', true));

async function load() {
  const [rosterResponse, punchResponse, kioskResponse, reasonResponse] = await Promise.all([
    fetch('/api/clock/roster?pins=1'),
    fetch('/api/clock/punches'),
    fetch('/api/clock/kiosk'),
    fetch('/api/clock/reason-codes'),
  ]);
  const rosterBody = await rosterResponse.json().catch(() => ({}));
  const punchBody = await punchResponse.json().catch(() => ({}));
  const kioskBody = await kioskResponse.json().catch(() => ({}));
  const reasonBody = await reasonResponse.json().catch(() => ({}));
  if (!rosterResponse.ok) throw new Error(rosterBody.error || 'Could not load drivers.');
  if (!punchResponse.ok) throw new Error(punchBody.error || 'Could not load records.');
  if (!reasonResponse.ok) throw new Error(reasonBody.error || 'Could not load reason codes.');
  drivers = rosterBody.drivers ?? [];
  punches = punchBody.punches ?? [];
  reasonCodes = reasonBody.codes ?? [];
  if (kioskBody.unlock_pin) lockCode.value = kioskBody.unlock_pin;
  fillDriverSelects();
  renderPins();
  renderReasons();
  renderPunches();
}

function fillDriverSelects() {
  for (const select of [addDriver, pinDriver]) {
    const current = select.value;
    select.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select a driver…';
    select.append(blank);
    for (const driver of drivers) {
      const option = document.createElement('option');
      option.value = driver.driver_id;
      option.textContent = driver.name;
      select.append(option);
    }
    if ([...select.options].some((option) => option.value === current)) {
      select.value = current;
    }
  }
}

function renderPins() {
  pinList.replaceChildren();
  for (const driver of drivers) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = driver.name;
    const state = document.createElement('span');
    state.textContent = driver.pin ? driver.pin : 'No PIN';
    item.append(name, state);
    pinList.append(item);
  }
}

function renderPunches() {
  punchRows.replaceChildren();
  if (!punches.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.textContent = 'No clock records yet.';
    row.append(cell);
    punchRows.append(row);
    return;
  }
  for (const punch of punches) {
    const row = document.createElement('tr');
    if (editingId === punch.id) {
      row.append(editCell(punch));
    } else {
      row.append(
        textCell(formatWhen(punch.punched_at)),
        textCell(punch.driver_name),
        kindCell(punch.action),
        noteCell(punch),
        reasonCell(punch),
        actionCell(punch)
      );
    }
    punchRows.append(row);
  }
}

function textCell(text) {
  const cell = document.createElement('td');
  cell.textContent = text;
  return cell;
}

function kindCell(action) {
  const cell = document.createElement('td');
  const label = document.createElement('span');
  label.className = action === 'in' ? 'kind-in' : 'kind-out';
  label.textContent = action === 'in' ? 'Clock in' : 'Clock out';
  cell.append(label);
  return cell;
}

function actionCell(punch) {
  const cell = document.createElement('td');
  const wrap = document.createElement('div');
  wrap.className = 'clock-actions';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'secondary';
  edit.textContent = 'Edit';
  edit.addEventListener('click', () => {
    editingId = punch.id;
    editingCodeId = '';
    editNote = punch.note || '';
    editReasonIds = (punch.reason_codes || []).map((code) => code.id);
    renderPunches();
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary';
  remove.textContent = 'Delete';
  remove.addEventListener('click', () => onDelete(punch));
  wrap.append(edit, remove);
  cell.append(wrap);
  return cell;
}

function editCell(punch) {
  const cell = document.createElement('td');
  cell.colSpan = 6;
  const form = document.createElement('form');
  form.className = 'clock-edit';
  const time = document.createElement('input');
  time.type = 'datetime-local';
  time.required = true;
  time.value = toLocalInput(punch.punched_at);
  const action = document.createElement('select');
  for (const [value, label] of [
    ['in', 'Clock in'],
    ['out', 'Clock out'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    action.append(option);
  }
  action.value = punch.action;
  const note = document.createElement('textarea');
  note.value = editNote;
  note.maxLength = 500;
  note.placeholder = 'Note';
  const reasonAdd = document.createElement('div');
  reasonAdd.className = 'reason-add';
  const reasonSelect = document.createElement('select');
  fillReasonSelect(reasonSelect, editReasonIds);
  const addReason = document.createElement('button');
  addReason.type = 'button';
  addReason.className = 'secondary';
  addReason.textContent = 'Add code';
  addReason.addEventListener('click', () => {
    editNote = note.value;
    if (!reasonSelect.value || editReasonIds.includes(reasonSelect.value)) return;
    editReasonIds.push(reasonSelect.value);
    renderPunches();
  });
  reasonAdd.append(reasonSelect, addReason);
  const picks = document.createElement('ul');
  picks.className = 'reason-picks';
  for (const id of editReasonIds) {
    const item = document.createElement('li');
    item.textContent = reasonLabel(id);
    const removeCode = document.createElement('button');
    removeCode.type = 'button';
    removeCode.textContent = 'Remove';
    removeCode.addEventListener('click', () => {
      editNote = note.value;
      editReasonIds = editReasonIds.filter((itemId) => itemId !== id);
      renderPunches();
    });
    item.append(removeCode);
    picks.append(item);
  }
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    editingId = '';
    renderPunches();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onSave(punch.id, action.value, time.value, note.value);
  });
  form.append(time, action, note, reasonAdd, picks, save, cancel);
  cell.append(form);
  return cell;
}

async function onAdd(event) {
  event.preventDefault();
  setStatus('');
  const response = await fetch('/api/clock/office/punches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      driver_id: addDriver.value,
      action: addAction.value,
      punched_at: new Date(addTime.value).toISOString(),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus(body.error || 'Could not add that record.', true);
    return;
  }
  setStatus('Record added.');
  await load();
}

async function onSave(id, action, localTime, note) {
  setStatus('');
  const response = await fetch(`/api/clock/punches/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      punched_at: new Date(localTime).toISOString(),
      note,
      reason_code_ids: editReasonIds,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus(body.error || 'Could not save that record.', true);
    return;
  }
  editingId = '';
  setStatus('Record updated.');
  await load();
}

async function onDelete(punch) {
  const when = formatWhen(punch.punched_at);
  const kind = punch.action === 'in' ? 'clock in' : 'clock out';
  if (!window.confirm(`Delete ${punch.driver_name}'s ${kind} at ${when}?`)) return;
  setStatus('');
  const response = await fetch(`/api/clock/punches/${encodeURIComponent(punch.id)}`, {
    method: 'DELETE',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus(body.error || 'Could not delete that record.', true);
    return;
  }
  setStatus('Record deleted.');
  await load();
}

async function onStartTimeclock() {
  setStatus('');
  const response = await fetch('/api/clock/kiosk/lock', { method: 'POST' });
  if (!response.ok) {
    setStatus('Could not start the timeclock.', true);
    return;
  }
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (typeof request === 'function') {
    try {
      await request.call(root);
    } catch {
      // Full screen is optional. The lock still holds this browser on the driver screen.
    }
  }
  window.location.href = '/clock';
}

async function onLockCode(event) {
  event.preventDefault();
  setStatus('');
  const response = await fetch('/api/clock/kiosk', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unlock_pin: lockCode.value.trim() }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus(body.error || 'Could not save the lock code.', true);
    return;
  }
  lockCode.value = body.unlock_pin;
  setStatus('Lock code saved.');
}

async function onPin(event) {
  event.preventDefault();
  setStatus('');
  const response = await fetch(`/api/clock/pins/${encodeURIComponent(pinDriver.value)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: pinValue.value.trim() }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus(body.error || 'Could not save that PIN.', true);
    return;
  }
  pinValue.value = '';
  setStatus('PIN saved.');
  await load();
}

function renderReasons() {
  reasonList.replaceChildren();
  if (!reasonCodes.length) {
    const item = document.createElement('li');
    item.textContent = 'No reason codes yet.';
    reasonList.append(item);
    return;
  }
  for (const code of reasonCodes) {
    const item = document.createElement('li');
    if (editingCodeId === code.id) {
      const form = document.createElement('form');
      form.className = 'clock-edit';
      const input = document.createElement('input');
      input.type = 'text';
      input.required = true;
      input.maxLength = 60;
      input.value = code.label;
      const save = document.createElement('button');
      save.type = 'submit';
      save.textContent = 'Save';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'secondary';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        editingCodeId = '';
        renderReasons();
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        onRenameReason(code.id, input.value);
      });
      form.append(input, save, cancel);
      item.append(form);
    } else {
      const name = document.createElement('span');
      name.textContent = code.label;
      const actions = document.createElement('div');
      actions.className = 'reason-row-actions';
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'secondary';
      rename.textContent = 'Rename';
      rename.addEventListener('click', () => {
        editingCodeId = code.id;
        renderReasons();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => onDeleteReason(code));
      actions.append(rename, remove);
      item.append(name, actions);
    }
    reasonList.append(item);
  }
}

async function onAddReason(event) {
  event.preventDefault();
  setStatus('');
  const response = await fetch('/api/clock/reason-codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: reasonLabelInput.value.trim() }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus(body.error || 'Could not add that reason code.', true);
    return;
  }
  reasonLabelInput.value = '';
  setStatus('Reason code added.');
  await load();
}

async function onRenameReason(id, label) {
  setStatus('');
  const response = await fetch(`/api/clock/reason-codes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: label.trim() }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus(body.error || 'Could not rename that reason code.', true);
    return;
  }
  editingCodeId = '';
  setStatus('Reason code renamed.');
  await load();
}

async function onDeleteReason(code) {
  if (!window.confirm(`Remove “${code.label}” from the list drivers can choose? Records that already use it will keep it.`)) {
    return;
  }
  setStatus('');
  const response = await fetch(`/api/clock/reason-codes/${encodeURIComponent(code.id)}`, {
    method: 'DELETE',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus(body.error || 'Could not delete that reason code.', true);
    return;
  }
  setStatus('Reason code removed from the list.');
  await load();
}

function noteCell(punch) {
  const cell = document.createElement('td');
  cell.className = 'note-cell';
  if (!punch.note) {
    cell.textContent = '—';
    return cell;
  }
  cell.append(document.createTextNode(punch.note));
  if (punch.note_at) {
    const when = document.createElement('div');
    when.className = 'noted-at';
    when.textContent = `Noted ${formatWhen(punch.note_at)}`;
    cell.append(when);
  }
  return cell;
}

function reasonCell(punch) {
  const cell = document.createElement('td');
  cell.className = 'reason-cell';
  const codes = punch.reason_codes || [];
  cell.textContent = codes.length ? codes.map((code) => code.label).join(', ') : '—';
  return cell;
}

/**
 * @param {HTMLSelectElement} select
 * @param {string[]} selectedIds
 */
function fillReasonSelect(select, selectedIds) {
  select.replaceChildren();
  const available = reasonCodes.filter((code) => !selectedIds.includes(code.id));
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = available.length ? 'Reason code…' : 'No reason codes left';
  select.append(blank);
  select.disabled = !available.length;
  for (const code of available) {
    const option = document.createElement('option');
    option.value = code.id;
    option.textContent = code.label;
    select.append(option);
  }
}

function reasonLabel(id) {
  return (
    reasonCodes.find((code) => code.id === id)?.label ||
    punches.flatMap((punch) => punch.reason_codes || []).find((code) => code.id === id)?.label ||
    'Reason code'
  );
}

function setStatus(message, isError = false) {
  if (!message) {
    statusEl.textContent = '';
    statusEl.className = 'status';
    return;
  }
  statusEl.textContent = message;
  statusEl.className = isError ? 'status visible error' : 'status visible ok';
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

function toLocalInput(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
