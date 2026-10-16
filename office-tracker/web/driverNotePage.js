/**
 * Phone page for today's punches. The driver taps a punched row to change
 * its notes and reasons. There is no punch control.
 */

import { formatTimecardMinutes } from '../src/timecardEntries.js';

const title = document.querySelector('#driver-note-title');
const lead = document.querySelector('#driver-note-lead');
const status = document.querySelector('#driver-note-status');
const form = document.querySelector('#driver-note-form');
const noteField = document.querySelector('#driver-note-text');
const reasonList = document.querySelector('#driver-note-reason-list');
const reasonSelect = document.querySelector('#driver-note-reason');
const minutesField = document.querySelector('#driver-note-minutes');
const addButton = document.querySelector('#driver-note-add');
const hint = document.querySelector('#driver-note-reason-hint');
const backButton = document.querySelector('#driver-note-back');
const daySection = document.querySelector('#driver-note-day');
const dayList = document.querySelector('#driver-note-rows');

const params = new URLSearchParams(window.location.search);
const dayToken = params.get('d')?.trim() || '';
const linkToken = params.get('t')?.trim() || '';
let activeToken = linkToken;

/** @type {{ revision: number, note: string, reasons: Array<{ id: string, label: string, minutes: number }>, catalog: Array<{ id: string, label: string }> } | null} */
let slot = null;
/** @type {{ driverName: string, date: string, closed: boolean, rows: object[] } | null} */
let day = null;
let saving = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let noteTimer = null;

/**
 * @param {string} message
 * @param {'error' | ''} [kind]
 */
function setStatus(message, kind = '') {
  if (!status) return;
  status.hidden = !message;
  status.textContent = message;
  status.className = `status${kind ? ` is-${kind}` : ''}`;
}

/**
 * @param {Array<{ id: string, label: string, minutes: number }>} left
 * @param {Array<{ id: string, label: string, minutes: number }>} right
 */
function sameReasons(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fillSelect() {
  if (!(reasonSelect instanceof HTMLSelectElement) || !slot) return;
  const taken = new Set(slot.reasons.map((reason) => reason.id));
  const current = reasonSelect.value;
  reasonSelect.replaceChildren();
  const blank = document.createElement('option');
  blank.value = '';
  const available = slot.catalog.filter((code) => !taken.has(code.id));
  blank.textContent = slot.catalog.length
    ? available.length
      ? 'Choose a reason'
      : 'All reasons added'
    : 'No reasons yet';
  reasonSelect.append(blank);
  for (const code of available) {
    const option = document.createElement('option');
    option.value = code.id;
    option.textContent = code.label;
    reasonSelect.append(option);
  }
  reasonSelect.disabled = available.length === 0;
  if (addButton instanceof HTMLButtonElement) addButton.disabled = available.length === 0;
  if (minutesField instanceof HTMLInputElement) minutesField.disabled = available.length === 0;
  if (available.some((code) => code.id === current)) reasonSelect.value = current;
}

function paintReasons() {
  if (!reasonList || !slot) return;
  reasonList.replaceChildren();
  for (const reason of slot.reasons) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = reason.label;
    const minutes = document.createElement('input');
    minutes.type = 'number';
    minutes.min = '1';
    minutes.max = '1440';
    minutes.step = '1';
    minutes.inputMode = 'numeric';
    minutes.value = String(reason.minutes);
    minutes.setAttribute('aria-label', `Minutes for ${reason.label}`);
    const shown = document.createElement('span');
    shown.className = 'driver-note-reason-time';
    shown.textContent = formatTimecardMinutes(reason.minutes);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${reason.label}`);
    minutes.addEventListener('change', () => {
      const next = Number(minutes.value);
      if (!Number.isInteger(next) || next < 1 || next > 1440) {
        minutes.value = String(reason.minutes);
        showHint('Use whole minutes, up to 1440.');
        return;
      }
      reason.minutes = next;
      shown.textContent = formatTimecardMinutes(next);
      hideHint();
      void saveSlot();
    });
    remove.addEventListener('click', () => {
      if (!slot) return;
      slot.reasons = slot.reasons.filter((item) => item.id !== reason.id);
      paintReasons();
      fillSelect();
      void saveSlot();
    });
    item.append(name, minutes, shown, remove);
    reasonList.append(item);
  }
}

function showHint(message) {
  if (!hint) return;
  hint.hidden = false;
  hint.textContent = message;
}

function hideHint() {
  if (!hint) return;
  hint.hidden = true;
  hint.textContent = '';
}

/**
 * @param {object} data
 * @param {{ keepNote?: boolean }} [options]
 */
function applySlot(data, options = {}) {
  const reasons = Array.isArray(data.reasons) ? data.reasons : [];
  const catalog = Array.isArray(data.catalog) ? data.catalog : [];
  slot = {
    revision: Number(data.revision) || 1,
    note: String(data.note || ''),
    reasons: reasons.map((reason) => ({
      id: String(reason.id),
      label: String(reason.label),
      minutes: Number(reason.minutes),
    })),
    catalog: catalog
      .filter((code) => code && code.id && code.label)
      .map((code) => ({ id: String(code.id), label: String(code.label) })),
  };
  const label = String(data.label || 'Notes');
  const driver = String(data.driverName || '').trim();
  if (title) title.textContent = driver ? `${driver} · ${label}` : label;
  document.title = title?.textContent || 'Clock notes';
  if (lead) {
    lead.textContent = `Change the notes and reasons for ${label}. Clocking in and out stays on the timeclock.`;
  }
  const typing = document.activeElement === noteField;
  if (noteField instanceof HTMLTextAreaElement && (!options.keepNote || !typing)) {
    if (!typing) noteField.value = slot.note;
  }
  paintReasons();
  fillSelect();
  const closed = Boolean(data.closed);
  if (form) form.hidden = false;
  for (const control of form?.querySelectorAll('textarea, select, input, button') || []) {
    if (
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLInputElement ||
      control instanceof HTMLButtonElement
    ) {
      control.disabled = closed;
    }
  }
  if (closed) setStatus('This pay period has ended. Notes and reasons stay as they are.');
}

async function loadSlot() {
  if (!activeToken) {
    setStatus('This link does not open a note.', 'error');
    return;
  }
  const response = await fetch(`/api/clock-note/${encodeURIComponent(activeToken)}`, { cache: 'no-store' });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    setStatus(body?.error || 'This notes link is not valid.', 'error');
    if (form) form.hidden = true;
    return;
  }
  const closed = Boolean(body.closed);
  if (slot && body.revision === slot.revision && closed === noteField?.disabled) return;
  const typing = document.activeElement === noteField || document.activeElement instanceof HTMLInputElement;
  if (typing && slot && body.revision !== slot.revision && !closed) return;
  applySlot(body);
  if (!saving && !closed) setStatus('');
}

async function saveSlot() {
  if (!slot || !activeToken || !(noteField instanceof HTMLTextAreaElement)) return;
  if (noteField.disabled) return;
  const savingToken = activeToken;
  saving = true;
  setStatus('Saving…');
  const payload = {
    revision: slot.revision,
    note: noteField.value,
    reasons: slot.reasons.map((reason) => ({
      id: reason.id,
      minutes: reason.minutes,
    })),
  };
  let response = await fetch(`/api/clock-note/${encodeURIComponent(savingToken)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body = await response.json().catch(() => null);
  if (response.status === 409 && body?.revision != null) {
    payload.revision = body.revision;
    response = await fetch(`/api/clock-note/${encodeURIComponent(savingToken)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    body = await response.json().catch(() => null);
  }
  saving = false;
  if (activeToken !== savingToken) return;
  if (!response.ok || !body) {
    setStatus(body?.error || 'That note could not be saved.', 'error');
    return;
  }
  applySlot(body, { keepNote: true });
  setStatus('Saved. The timeclock will show this note.');
}

function queueNoteSave() {
  if (noteTimer) clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    noteTimer = null;
    saveSlot().catch(() => setStatus('That note could not be saved.', 'error'));
  }, 400);
}

/**
 * @param {string} date
 */
function dayHeading(date) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return 'Today';
  return parsed.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/**
 * @param {Array<{ label?: string, minutes?: number }>} reasons
 */
function reasonPreview(reasons) {
  return reasons
    .map((reason) => {
      const label = String(reason.label || '').trim();
      const minutes = Number(reason.minutes);
      if (!label || !Number.isInteger(minutes)) return '';
      return `${label} · ${formatTimecardMinutes(minutes)}`;
    })
    .filter(Boolean)
    .join(', ');
}

function showDayList() {
  activeToken = '';
  slot = null;
  if (form) form.hidden = true;
  if (backButton instanceof HTMLButtonElement) backButton.hidden = true;
  if (daySection) daySection.hidden = false;
  if (!day) return;
  const heading = dayHeading(day.date);
  const driver = day.driverName.trim();
  if (title) title.textContent = driver ? `${driver} · ${heading}` : heading;
  document.title = title?.textContent || 'Clock notes';
  if (lead) {
    lead.textContent = 'Tap a punch to add or change its notes and reasons. Clocking in and out stays on the timeclock.';
  }
}

/**
 * @param {object} row
 */
function openRow(row) {
  activeToken = String(row.token || '');
  slot = null;
  if (daySection) daySection.hidden = true;
  if (backButton instanceof HTMLButtonElement) backButton.hidden = !dayToken;
  if (form) form.hidden = true;
  loadSlot().catch(() => setStatus('This notes link is not valid.', 'error'));
}

function paintDay() {
  if (!dayList || !day) return;
  const editing = Boolean(activeToken);
  dayList.replaceChildren();
  for (const row of day.rows) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    const label = document.createElement('span');
    label.className = 'driver-note-row-label';
    const name = String(row.label || 'Punch');
    const clock = String(row.clock || '').trim();
    label.textContent = clock ? `${name} · ${clock}` : name;
    const note = document.createElement('span');
    note.className = 'driver-note-row-note';
    const noteText = String(row.note || '').trim();
    const reasons = reasonPreview(Array.isArray(row.reasons) ? row.reasons : []);
    note.textContent = noteText || (reasons ? '' : 'Add notes or a reason');
    button.append(label);
    if (note.textContent) button.append(note);
    if (reasons) {
      const reasonLine = document.createElement('span');
      reasonLine.className = 'driver-note-row-reasons';
      reasonLine.textContent = reasons;
      button.append(reasonLine);
    }
    button.addEventListener('click', () => openRow(row));
    item.append(button);
    dayList.append(item);
  }
  if (!editing) showDayList();
  if (!day.rows.length && !editing) {
    setStatus('No punches yet today. After a clock in or clock out, that row shows up here.');
    return;
  }
  if (day.closed && !editing) {
    setStatus('This pay period has ended. Notes and reasons stay as they are.');
    return;
  }
  if (!editing && !saving) setStatus('');
}

async function loadDay() {
  if (!dayToken) return;
  const response = await fetch(`/api/clock-note-day/${encodeURIComponent(dayToken)}`, { cache: 'no-store' });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    setStatus(body?.error || 'This notes link is not valid.', 'error');
    if (daySection) daySection.hidden = true;
    if (form) form.hidden = true;
    return;
  }
  day = {
    driverName: String(body.driverName || ''),
    date: String(body.date || ''),
    closed: Boolean(body.closed),
    rows: Array.isArray(body.rows) ? body.rows : [],
  };
  paintDay();
}

function addReason() {
  if (!slot || !(reasonSelect instanceof HTMLSelectElement) || !(minutesField instanceof HTMLInputElement)) return;
  const id = reasonSelect.value;
  const code = slot.catalog.find((item) => item.id === id);
  const minutes = Number(minutesField.value);
  if (!code || slot.reasons.some((reason) => reason.id === code.id)) {
    showHint('Choose a reason.');
    reasonSelect.focus();
    return;
  }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    showHint(minutesField.value.trim() ? 'Use whole minutes, up to 1440.' : 'Enter the minutes.');
    minutesField.focus();
    return;
  }
  slot.reasons.push({ id: code.id, label: code.label, minutes });
  minutesField.value = '';
  reasonSelect.value = '';
  hideHint();
  paintReasons();
  fillSelect();
  saveSlot().catch(() => setStatus('That note could not be saved.', 'error'));
}

noteField?.addEventListener('input', () => {
  setStatus('');
  queueNoteSave();
});
addButton?.addEventListener('click', addReason);
minutesField?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  addReason();
});
form?.addEventListener('submit', (event) => event.preventDefault());
backButton?.addEventListener('click', () => {
  if (noteTimer) {
    clearTimeout(noteTimer);
    noteTimer = null;
  }
  showDayList();
  loadDay().catch(() => setStatus('This notes link is not valid.', 'error'));
});

const start = dayToken ? loadDay() : loadSlot();
start
  .catch(() => setStatus('This notes link is not valid.', 'error'))
  .finally(() => {
    setInterval(() => {
      const refresh = activeToken ? loadSlot() : dayToken ? loadDay() : Promise.resolve();
      refresh.catch(() => {});
    }, 2000);
  });
