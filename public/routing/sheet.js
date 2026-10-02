import { enhanceIcons } from '../shared/icons.js';

enhanceIcons();

const routeSelect = document.getElementById('route_id');
const statusEl = document.getElementById('sheet-status');
const summaryEl = document.getElementById('sheet-summary');
const historyEl = document.getElementById('sheet-history');
const legendEl = document.getElementById('sheet-legend');
const calendarEl = document.getElementById('sheet-calendar');
const form = document.getElementById('change-form');
const segmentSelect = document.getElementById('segment');
const previousIn = document.getElementById('previous_in');
const previousOut = document.getElementById('previous_out');
const enteredBy = document.getElementById('entered_by');
const reasonCategory = document.getElementById('reason_category');

/** @type {object | null} */
let sheet = null;

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function showStatus(message, kind = 'ok') {
  statusEl.textContent = message;
  statusEl.className = `status visible ${kind}`;
}

function parseClock(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time).trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 23) return null;
  return hours * 60 + minutes;
}

function rangeMinutes(clockIn, clockOut) {
  const start = parseClock(clockIn);
  const end = parseClock(clockOut);
  if (start == null || end == null || end < start) return null;
  return end - start;
}

function splitRange(range) {
  const [clockIn, clockOut] = String(range || '').split('-');
  return { clockIn: clockIn || '', clockOut: clockOut || '' };
}

function fillClocks() {
  const range = sheet?.segments?.[segmentSelect.value] || '';
  const parts = splitRange(range);
  previousIn.value = parts.clockIn;
  previousOut.value = parts.clockOut;
}

function formatRecordedAt(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function closeStamps(except) {
  for (const pop of historyEl.querySelectorAll('.change-stamp-pop')) {
    if (pop !== except) pop.hidden = true;
  }
}

function renderHistory() {
  historyEl.innerHTML = sheet?.history_html || '';
  for (const note of historyEl.querySelectorAll('.change-note')) note.remove();
  const rows = historyEl.querySelectorAll('tbody tr');
  const sourceRows = sheet?.rows || [];
  let index = 0;
  for (const tr of rows) {
    const row = sourceRows[index];
    index += 1;
    if (!row || row.kind !== 'change') continue;
    const cell = tr.lastElementChild;
    if (!cell) continue;
    const wrap = document.createElement('div');
    wrap.className = 'change-stamp-wrap';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'change-stamp-btn';
    button.setAttribute('aria-label', 'Show who recorded this change and why');
    button.textContent = '…';
    const pop = document.createElement('div');
    pop.className = 'change-stamp-pop';
    pop.hidden = true;
    const recorded = formatRecordedAt(row.submitted_at);
    const who = [row.entered_by, row.note].filter(Boolean).join(' — ');
    pop.textContent = recorded
      ? `Recorded ${recorded}. ${who || 'No name or comment was written.'}`
      : who || 'No name or comment was written.';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = pop.hidden;
      closeStamps(pop);
      pop.hidden = !open;
    });
    wrap.append(button, pop);
    cell.append(wrap);
  }
}

async function loadSheet(routeId) {
  sheet = await fetchJson(`/api/routes/${encodeURIComponent(routeId)}/sheet`);
  summaryEl.textContent = `${sheet.driver_name || 'Unassigned'} · ${sheet.status} · drift ${sheet.cumulative_drift_minutes} min`;
  renderHistory();
  legendEl.innerHTML = sheet.legend_html || '';
  calendarEl.innerHTML = sheet.calendar_html || '';
  fillClocks();
  const url = new URL(window.location.href);
  url.searchParams.set('route', routeId);
  history.replaceState(null, '', url);
}

document.addEventListener('click', () => closeStamps(null));

segmentSelect.addEventListener('change', fillClocks);

routeSelect.addEventListener('change', async () => {
  try {
    await loadSheet(routeSelect.value);
    statusEl.className = 'status';
    statusEl.textContent = '';
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const previous = rangeMinutes(previousIn.value, previousOut.value);
  const next = rangeMinutes(
    document.getElementById('next_in').value,
    document.getElementById('next_out').value
  );
  if (previous == null || next == null) {
    showStatus('Enter clock times as H:MM.', 'error');
    return;
  }
  const previousTime = `${previousIn.value.trim()}-${previousOut.value.trim()}`;
  const newTime = `${document.getElementById('next_in').value.trim()}-${document.getElementById('next_out').value.trim()}`;
  try {
    const result = await fetchJson('/api/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        route_id: routeSelect.value,
        driver_id: sheet?.driver_id || '',
        driver_name: sheet?.driver_name || '',
        segment: segmentSelect.value,
        effective_date: document.getElementById('effective_date').value,
        previous_time: previousTime,
        new_time: newTime,
        delta_minutes: next - previous,
        reason_category: reasonCategory.value,
        note: document.getElementById('note').value.trim(),
        entered_by: enteredBy.value,
      }),
    });
    showStatus(result.message, result.pending ? 'warn' : 'ok');
    await loadSheet(routeSelect.value);
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

const [routes, staff, reasons] = await Promise.all([
  fetchJson('/api/routes'),
  fetchJson('/api/staff-names'),
  fetchJson('/api/reason-categories'),
]);

for (const route of routes) {
  const option = document.createElement('option');
  option.value = route.route_id;
  option.textContent = `${route.route_id} — ${route.driver_name || 'Unassigned'}`;
  routeSelect.append(option);
}
for (const name of staff) {
  const option = document.createElement('option');
  option.value = name;
  option.textContent = name;
  enteredBy.append(option);
}
for (const reason of reasons) {
  const option = document.createElement('option');
  option.value = reason;
  option.textContent = reason;
  reasonCategory.append(option);
}

const today = new Date();
const offset = today.getTimezoneOffset();
document.getElementById('effective_date').value = new Date(today.getTime() - offset * 60000)
  .toISOString()
  .slice(0, 10);

const requested = new URLSearchParams(window.location.search).get('route');
if (requested && [...routeSelect.options].some((option) => option.value === requested)) {
  routeSelect.value = requested;
}
if (routeSelect.value) {
  await loadSheet(routeSelect.value);
}
