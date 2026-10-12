import { createClient } from '@supabase/supabase-js';
import {
  clockRecordCsv,
  clockRecordFilename,
  clockRecordMessage,
  looksLikeEmail,
} from '../src/clockShare.js';
import { buildDriverClockRecord, CLOCK_RECORD_COLUMNS } from '../src/driverClockRecord.js';
import { normalizeClockPayDefaults } from '../src/driverPay.js';

const title = document.querySelector('#driver-clock-title');
const status = document.querySelector('#driver-clock-status');
const jumps = document.querySelector('#driver-clock-periods');
const scroll = document.querySelector('#driver-clock-scroll');
const head = document.querySelector('#driver-clock-sheet thead tr');
const body = document.querySelector('#driver-clock-sheet tbody');
const downloadButton = document.querySelector('#driver-clock-download');
const emailButton = document.querySelector('#driver-clock-email');
const printButton = document.querySelector('#driver-clock-print');

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

async function openRecord() {
  const token = new URLSearchParams(window.location.search).get('t')?.trim() || '';
  if (!token) {
    setStatus('This link does not open a clock record.', 'error');
    return;
  }
  try {
    const config = await loadAccountConfig();
    if (!config) throw new Error('Clock records are not available from this link.');
    const client = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc('driver_clock_record', { link_token: token });
    if (error) throw new Error('This clock record link is not available.');
    if (!data || typeof data !== 'object' || !data.driverName) {
      throw new Error('This clock record link is not valid.');
    }
    const driverName = String(data.driverName).trim();
    const periods = normalizeClockPayDefaults({ periods: data.periods }).periods;
    const sheets = buildDriverClockRecord(
      Array.isArray(data.punches) ? data.punches : [],
      periods,
      driverName
    );
    record = { driverName, email: String(data.email || ''), sheets };
    if (title) title.textContent = driverName;
    document.title = `Clock records — ${driverName}`;
    renderSheets(sheets);
    setActionsEnabled(true);
    setStatus('');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not open these clock records.', 'error');
  }
}

openRecord();
