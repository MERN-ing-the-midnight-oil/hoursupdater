import { createClient } from '@supabase/supabase-js';
import {
  clockRecordCsv,
  clockRecordFilename,
  clockRecordMessage,
  looksLikeEmail,
} from '../src/clockShare.js';
import { buildDriverClockRecord, CLOCK_RECORD_COLUMNS } from '../src/driverClockRecord.js';
import { normalizeClockPayDefaults } from '../src/driverPay.js';
import {
  formatTimecardMinutes,
  normalizeTimecardEntries,
  payPeriodStillOpen,
  sessionForClockOut,
  timecardSummary,
} from '../src/timecardEntries.js';

const title = document.querySelector('#driver-clock-title');
const status = document.querySelector('#driver-clock-status');
const jumps = document.querySelector('#driver-clock-periods');
const scroll = document.querySelector('#driver-clock-scroll');
const head = document.querySelector('#driver-clock-sheet thead tr');
const body = document.querySelector('#driver-clock-sheet tbody');
const downloadButton = document.querySelector('#driver-clock-download');
const emailButton = document.querySelector('#driver-clock-email');
const printButton = document.querySelector('#driver-clock-print');
const timecards = document.querySelector('#driver-clock-timecards');

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let client = null;
let linkToken = '';
/** @type {object[]} */
let punches = [];
/** @type {Array<{ id: string, startDay: number, endDay: number }>} */
let periods = [];
/** @type {Array<{ id: string, label: string }>} */
let codes = [];

/** @type {{ driverName: string, email: string, sheets: ReturnType<typeof buildDriverClockRecord> } | null} */
let record = null;

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

function setActionsEnabled(enabled) {
  for (const button of [downloadButton, emailButton, printButton]) {
    if (button instanceof HTMLButtonElement) button.disabled = !enabled;
  }
}

/**
 * @param {ReturnType<typeof buildDriverClockRecord>} sheets
 */
function renderSheets(sheets) {
  if (!head || !body) return;
  if (jumps) {
    jumps.replaceChildren();
    jumps.hidden = sheets.length === 0;
    for (const period of sheets) {
      const link = document.createElement('a');
      link.href = `#clock-period-${period.key}`;
      link.textContent = period.label;
      jumps.append(link);
    }
  }
  head.replaceChildren();
  for (const column of CLOCK_RECORD_COLUMNS) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = column.label;
    head.append(cell);
  }
  body.replaceChildren();
  const rows = sheets.flatMap((period) =>
    period.rows.map((row) => ({ ...row, band: period.band, periodKey: period.key }))
  );
  if (!rows.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = CLOCK_RECORD_COLUMNS.length;
    cell.textContent = 'No clock records yet.';
    row.append(cell);
    body.append(row);
  } else {
    for (const item of rows) {
      const row = document.createElement('tr');
      row.classList.add(item.band === 1 ? 'is-band-1' : 'is-band-0');
      if (item.periodStart) {
        row.id = `clock-period-${item.periodKey}`;
        row.classList.add('is-period-start');
      }
      if (item.weekend) row.classList.add('is-weekend');
      for (const column of CLOCK_RECORD_COLUMNS) {
        const cell = document.createElement('td');
        const value = String(item[column.key] || '');
        cell.textContent = value;
        if (column.text) cell.classList.add('is-text');
        if (!value) cell.classList.add('is-empty');
        row.append(cell);
      }
      body.append(row);
    }
  }
  if (scroll) scroll.hidden = false;
}

async function loadAccountConfig() {
  try {
    const response = await fetch('./supabase-config.json', { cache: 'no-store' });
    const type = response.headers.get('content-type') || '';
    if (response.ok && type.includes('json')) {
      const config = await response.json();
      if (config?.url && config?.anonKey) {
        return { url: String(config.url), anonKey: String(config.anonKey) };
      }
    }
  } catch {
    // The local program answers the same config.
  }
  const response = await fetch('/api/supabase-config');
  if (!response.ok) return null;
  const config = await response.json();
  if (!config?.enabled || !config.url || !config.anonKey) return null;
  return { url: String(config.url), anonKey: String(config.anonKey) };
}

function downloadRecords() {
  if (!record) return;
  const csv = clockRecordCsv(record.sheets);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = clockRecordFilename(record.driverName);
  link.click();
  URL.revokeObjectURL(url);
  setStatus('Downloaded your clock records.');
}

async function emailRecords() {
  if (!record) return;
  const filename = clockRecordFilename(record.driverName);
  const csv = clockRecordCsv(record.sheets);
  const message = clockRecordMessage(record.driverName, record.sheets);
  const file = new File([csv], filename, { type: 'text/csv' });
  const share = {
    title: `Clock records for ${record.driverName}`,
    text: message,
    files: [file],
  };
  let canShare = false;
  try {
    canShare = Boolean(navigator.canShare?.(share));
  } catch {
    canShare = false;
  }
  if (canShare) {
    try {
      await navigator.share(share);
      setStatus('Choose Mail to send the file.');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setStatus('Could not open sharing.', 'error');
    }
    return;
  }
  const to = looksLikeEmail(record.email) ? record.email.trim() : '';
  const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
    `Clock records for ${record.driverName}`
  )}&body=${encodeURIComponent(message)}`;
  window.location.href = href;
  setStatus(to ? `Opening an email to ${to}.` : 'Opening your email app.');
}

downloadButton?.addEventListener('click', downloadRecords);
emailButton?.addEventListener('click', () => {
  emailRecords().catch(() => setStatus('Could not open email.', 'error'));
});
printButton?.addEventListener('click', () => {
  setStatus('');
  window.print();
});

function clockOutCards() {
  const now = new Date();
  const outs = punches
    .filter((punch) => punch?.action === 'out' && sessionForClockOut(punches, punch.id))
    .sort((a, b) => String(b.punched_at).localeCompare(String(a.punched_at)));
  return outs
    .map((punch) => {
      const when = new Date(punch.punched_at);
      const open = payPeriodStillOpen(when, periods, now);
      const entries = normalizeTimecardEntries(punch.timecard_entries, codes);
      return { punch, open, entries, session: sessionForClockOut(punches, punch.id) };
    })
    .filter((card) => card.open || card.entries.length);
}

function renderTimecards() {
  if (!timecards) return;
  const cards = clockOutCards();
  timecards.replaceChildren();
  timecards.hidden = cards.length === 0;
  for (const card of cards) {
    const block = document.createElement('article');
    block.className = 'driver-clock-timecard';
    const heading = document.createElement('h3');
    const when = new Date(card.punch.punched_at);
    const day = when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const range = card.session
      ? `${card.session.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}–${card.session.end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
      : '';
    heading.textContent = `${day} · ${range}`;
    block.append(heading);
    if (!card.open) {
      const text = document.createElement('p');
      text.textContent = timecardSummary(card.entries);
      block.append(text);
      timecards.append(block);
      continue;
    }
    const lead = document.createElement('p');
    lead.className = 'lead';
    lead.textContent = card.session
      ? `Optional. The times can add up to ${formatTimecardMinutes(card.session.minutes)} or less.`
      : '';
    const form = document.createElement('form');
    form.novalidate = true;
    /** @type {Array<{ id: string, hours: string, minutes: string, comment: string }>} */
    const draft = card.entries.map((entry) => ({
      id: entry.id,
      hours: String(Math.floor(entry.minutes / 60)),
      minutes: String(entry.minutes % 60),
      comment: entry.comment,
    }));
    const rows = document.createElement('div');
    const error = document.createElement('p');
    error.className = 'status is-error';
    error.hidden = true;
    const paint = () => {
      rows.replaceChildren();
      draft.forEach((row, index) => {
        const line = document.createElement('div');
        line.className = 'kiosk-timecard-row';
        const select = document.createElement('select');
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = 'Choose a code';
        select.append(blank);
        const options = [...codes];
        if (row.id && !options.some((code) => code.id === row.id)) {
          const stored = card.entries.find((entry) => entry.id === row.id);
          options.push({ id: row.id, label: stored?.label || row.id });
        }
        for (const code of options) {
          const option = document.createElement('option');
          option.value = code.id;
          option.textContent = code.label;
          select.append(option);
        }
        if (options.some((code) => code.id === row.id)) select.value = row.id;
        select.addEventListener('change', () => {
          draft[index].id = select.value;
        });
        const hours = document.createElement('input');
        hours.type = 'number';
        hours.min = '0';
        hours.max = '24';
        hours.inputMode = 'numeric';
        hours.value = row.hours;
        hours.addEventListener('input', () => {
          draft[index].hours = hours.value;
        });
        const minutes = document.createElement('input');
        minutes.type = 'number';
        minutes.min = '0';
        minutes.max = '59';
        minutes.inputMode = 'numeric';
        minutes.value = row.minutes;
        minutes.addEventListener('input', () => {
          draft[index].minutes = minutes.value;
        });
        const time = document.createElement('div');
        time.className = 'kiosk-timecard-time';
        const hoursLabel = document.createElement('label');
        hoursLabel.append('Hours', hours);
        const minutesLabel = document.createElement('label');
        minutesLabel.append('Minutes', minutes);
        time.append(hoursLabel, minutesLabel);
        const comment = document.createElement('textarea');
        comment.rows = 2;
        comment.maxLength = 200;
        comment.placeholder = 'Comment, if you want one';
        comment.value = row.comment;
        comment.addEventListener('input', () => {
          draft[index].comment = comment.value;
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'secondary';
        remove.textContent = 'Remove code';
        remove.addEventListener('click', () => {
          draft.splice(index, 1);
          paint();
        });
        line.append(select, time, comment, remove);
        rows.append(line);
      });
    };
    paint();
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'secondary';
    add.textContent = 'Add a code';
    add.addEventListener('click', () => {
      draft.push({ id: '', hours: '', minutes: '', comment: '' });
      paint();
    });
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save codes';
    form.append(lead, rows, add, error, save);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      saveTimecard(card.punch.id, draft, error, save);
    });
    block.append(form);
    timecards.append(block);
  }
}

/**
 * @param {string} punchId
 * @param {Array<{ id: string, hours: string, minutes: string, comment: string }>} draft
 * @param {HTMLElement} error
 * @param {HTMLButtonElement} save
 */
async function saveTimecard(punchId, draft, error, save) {
  const entries = [];
  for (const row of draft) {
    if (!row.id && !row.hours && !row.minutes && !row.comment.trim()) continue;
    const hours = Number(row.hours);
    const minutes = Number(row.minutes);
    const total = hours * 60 + minutes;
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || minutes < 0 || minutes > 59 || total < 1) {
      error.hidden = false;
      error.textContent = 'Enter the time for each code.';
      return;
    }
    entries.push({ id: row.id, minutes: total, comment: row.comment });
  }
  if (!client) return;
  save.disabled = true;
  error.hidden = true;
  const { data, error: rpcError } = await client.rpc('save_driver_timecard', {
    link_token: linkToken,
    punch_id: punchId,
    entries,
  });
  save.disabled = false;
  if (rpcError) {
    error.hidden = false;
    error.textContent = rpcError.message || 'Could not save those codes.';
    return;
  }
  applyRecord(data);
  setStatus('Timecard codes saved.');
}

/**
 * @param {object} data
 */
function applyRecord(data) {
  const driverName = String(data.driverName).trim();
  periods = normalizeClockPayDefaults({ periods: data.periods }).periods;
  punches = Array.isArray(data.punches) ? data.punches : [];
  const leaveRequests = Array.isArray(data.leaveRequests) ? data.leaveRequests : [];
  codes = (Array.isArray(data.codes) ? data.codes : [])
    .filter((code) => code && code.id && code.label)
    .map((code) => ({ id: String(code.id), label: String(code.label) }));
  const sheets = buildDriverClockRecord(punches, periods, driverName, new Date(), leaveRequests);
  record = { driverName, email: String(data.email || ''), sheets };
  if (title) title.textContent = driverName;
  document.title = `Clock records — ${driverName}`;
  renderSheets(sheets);
  renderTimecards();
  setActionsEnabled(true);
}

async function openRecord() {
  linkToken = new URLSearchParams(window.location.search).get('t')?.trim() || '';
  if (!linkToken) {
    setStatus('This link does not open a clock record.', 'error');
    return;
  }
  try {
    const config = await loadAccountConfig();
    if (!config) throw new Error('Clock records are not available from this link.');
    client = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc('driver_clock_record', { link_token: linkToken });
    if (error) throw new Error('This clock record link is not available.');
    if (!data || typeof data !== 'object' || !data.driverName) {
      throw new Error('This clock record link is not valid.');
    }
    applyRecord(data);
    setStatus('');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not open these clock records.', 'error');
  }
}

openRecord();
