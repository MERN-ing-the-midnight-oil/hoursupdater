import { enhanceIcons } from '../shared/icons.js';
import { openMailto } from '../shared/openMailto.js';

const driverSelect = document.querySelector('#timesheet-driver');
const periodSelect = document.querySelector('#timesheet-period');
const statusEl = document.querySelector('#timesheet-status');
const resultEl = document.querySelector('#timesheet-result');
const whoEl = document.querySelector('#timesheet-who');
const contractEl = document.querySelector('#timesheet-contract');
const periodLabelEl = document.querySelector('#timesheet-period-label');
const compareTable = document.querySelector('#timesheet-compare');
const varianceTable = document.querySelector('#timesheet-variance');
const copyButton = document.querySelector('#timesheet-copy-good');
const emailButton = document.querySelector('#timesheet-email');
const printButton = document.querySelector('#timesheet-print');
const copyStatus = document.querySelector('#timesheet-copy-status');
const exportButton = document.querySelector('#timesheet-export');
const pairsTable = document.querySelector('#timesheet-pairs');
const caveatsEl = document.querySelector('#timesheet-caveats');

/** @type {Array<{ driver_id: string, name: string, route_ids: string[] }>} */
let drivers = [];
/** @type {Array<{ year: number, month: number, half: number, label: string }>} */
let periods = [];
/** @type {object | null} */
let currentSheet = null;

enhanceIcons();

exportButton.addEventListener('click', () => {
  exportPeriod();
});
copyButton.addEventListener('click', () => {
  copyGoodStuff().catch((error) => setCopyStatus(error instanceof Error ? error.message : 'Could not copy those rows.', true));
});
emailButton.addEventListener('click', emailSummary);
printButton.addEventListener('click', printSummary);

driverSelect.addEventListener('change', () => {
  rememberChoice();
  loadSheet().catch(showError);
});
periodSelect.addEventListener('change', () => {
  rememberChoice();
  loadSheet().catch(showError);
});
loadIndex().catch(showError);

async function loadIndex() {
  const response = await fetch('/api/timesheets');
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not load timesheets.');
  drivers = body.drivers ?? [];
  periods = body.periods ?? [];
  fillDrivers();
  fillPeriods(body.current);
  applyQuery();
  if (driverSelect.value) await loadSheet();
  else setStatus('Choose a driver.');
}

function fillDrivers() {
  const current = driverSelect.value;
  driverSelect.replaceChildren();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Choose a driver';
  driverSelect.append(blank);
  for (const driver of drivers) {
    const option = document.createElement('option');
    option.value = driver.driver_id;
    const routes = driver.route_ids?.length ? ` · route ${driver.route_ids.join(', ')}` : '';
    option.textContent = `${driver.name}${routes}`;
    driverSelect.append(option);
  }
  if (drivers.some((driver) => driver.driver_id === current)) driverSelect.value = current;
}

function fillPeriods(current) {
  periodSelect.replaceChildren();
  for (const period of periods) {
    const option = document.createElement('option');
    option.value = periodValue(period);
    option.textContent = period.label;
    periodSelect.append(option);
  }
  const preferred = current && periods.some((period) => samePeriod(period, current)) ? current : periods[0];
  if (preferred) periodSelect.value = periodValue(preferred);
}

function applyQuery() {
  const params = new URLSearchParams(location.search);
  const driverId = params.get('driver') || '';
  if (drivers.some((driver) => driver.driver_id === driverId)) driverSelect.value = driverId;
  const year = Number(params.get('year'));
  const month = Number(params.get('month'));
  const half = Number(params.get('half'));
  const match = periods.find((period) => period.year === year && period.month === month && period.half === half);
  if (match) periodSelect.value = periodValue(match);
}

function rememberChoice() {
  const params = new URLSearchParams();
  if (driverSelect.value) params.set('driver', driverSelect.value);
  const period = selectedPeriod();
  if (period) {
    params.set('year', String(period.year));
    params.set('month', String(period.month));
    params.set('half', String(period.half));
  }
  const next = params.toString();
  history.replaceState(null, '', next ? `/admin/timesheets?${next}` : '/admin/timesheets');
}

function selectedPeriod() {
  return periods.find((period) => periodValue(period) === periodSelect.value) || null;
}

function periodValue(period) {
  return `${period.year}-${period.month}-${period.half}`;
}

function samePeriod(a, b) {
  return a.year === b.year && a.month === b.month && a.half === b.half;
}

async function loadSheet() {
  const driverId = driverSelect.value;
  const period = selectedPeriod();
  if (!driverId || !period) {
    currentSheet = null;
    resultEl.hidden = true;
    setCopyStatus('');
    setStatus(driverId ? 'Choose a pay period.' : 'Choose a driver.');
    return;
  }
  setStatus('Loading the timesheet…');
  const params = new URLSearchParams({
    year: String(period.year),
    month: String(period.month),
    half: String(period.half),
  });
  const response = await fetch(`/api/timesheets/${encodeURIComponent(driverId)}?${params}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not load that timesheet.');
  renderSheet(body);
  setStatus('');
}

function renderSheet(sheet) {
  currentSheet = sheet;
  resultEl.hidden = false;
  setCopyStatus('');
  whoEl.textContent = sheet.heading || '';
  contractEl.textContent = sheet.contract_text || '';
  periodLabelEl.textContent = sheet.period?.label || '';
  renderCompare(sheet.days || [], sheet.totals || {});
  renderVariance(sheet);
  emailButton.disabled = !sheet.email?.mailto_url;
  emailButton.title = sheet.email?.mailto_url
    ? ''
    : 'Add an email on this driver record, then try again.';
  renderPairs(sheet.pairs || []);
  const notes = sheet.caveats || [];
  caveatsEl.hidden = notes.length === 0;
  caveatsEl.textContent = notes.join(' ');
}

async function exportPeriod() {
  const period = selectedPeriod();
  if (!period) {
    setStatus('Choose a pay period.');
    return;
  }
  exportButton.disabled = true;
  setStatus('Preparing the pay-period file…');
  try {
    const params = new URLSearchParams({
      year: String(period.year),
      month: String(period.month),
      half: String(period.half),
    });
    const response = await fetch(`/api/timesheets/export?${params}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Could not export that pay period.');
    }
    const blob = await response.blob();
    const filename = filenameFromDisposition(response.headers.get('Content-Disposition')) || 'Pay_period_calculators.csv';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setStatus('Pay-period file downloaded.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not export that pay period.', true);
  } finally {
    exportButton.disabled = false;
  }
}

async function copyGoodStuff() {
  const rows = currentSheet?.payroll_rows;
  if (!rows) {
    setCopyStatus('Choose a driver first.', true);
    return;
  }
  const clipboard = payrollClipboard(rows);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([clipboard.plain], { type: 'text/plain' }),
          'text/html': new Blob([clipboard.html], { type: 'text/html' }),
        }),
      ]);
      flashCopy('COPIED!');
      return;
    } catch {
      /* Fall through to plain text. */
    }
  }
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('This browser could not copy those rows.');
    }
    await navigator.clipboard.writeText(clipboard.plain);
  } catch {
    throw new Error('Could not copy those rows. Click the page, then try again.');
  }
  flashCopy('COPIED!');
}

function payrollClipboard(rows) {
  const cell = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '0.00');
  const line = (values) => (values || []).map(cell).join('\t');
  const htmlRow = (values) => `<tr>${(values || []).map((value) => `<td>${cell(value)}</td>`).join('')}</tr>`;
  return {
    plain: `${line(rows.above)}\r\n${line(rows.below)}`,
    html: `<table>${htmlRow(rows.above)}${htmlRow(rows.below)}</table>`,
  };
}

function flashCopy(label) {
  const original = 'COPY THE GOOD STUFF!';
  copyButton.textContent = label;
  setCopyStatus('Copied. Paste it into the payroll spreadsheet.');
  window.setTimeout(() => {
    copyButton.textContent = original;
  }, 2000);
}

function filenameFromDisposition(header) {
  const match = /filename="([^"]+)"/.exec(header || '');
  return match ? match[1] : '';
}

function renderVariance(sheet) {
  const days = sheet.days || [];
  const rows = sheet.payroll_rows || { above: [], below: [] };
  varianceTable.replaceChildren();
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.scope = 'col';
  corner.textContent = '';
  headRow.append(corner);
  for (const day of days) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = day.label;
    headRow.append(cell);
  }
  head.append(headRow);
  varianceTable.append(head);
  const body = document.createElement('tbody');
  body.append(
    varianceRow('AM total', days.map((day) => day.amHours)),
    varianceRow('Mid day total', days.map((day) => day.middayHours)),
    varianceRow('PM total', days.map((day) => day.pmHours)),
    extraRow(days),
    varianceRow('Hours above regular daily rate', rows.above || [], 'is-above'),
    varianceRow('Hours below regular daily rate', rows.below || [], 'is-below')
  );
  varianceTable.append(body);
}

function extraRow(days) {
  const row = document.createElement('tr');
  const name = document.createElement('th');
  name.scope = 'row';
  name.textContent = 'Extra';
  row.append(name);
  for (const day of days) {
    const cell = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.25';
    input.min = '-999';
    input.max = '999';
    input.inputMode = 'decimal';
    input.setAttribute('aria-label', `Extra hours ${day.label}`);
    input.value = day.extraHours ? Number(day.extraHours).toFixed(2) : '';
    input.addEventListener('change', () => {
      saveExtra(day, input).catch(showError);
    });
    cell.append(input);
    row.append(cell);
  }
  return row;
}

async function saveExtra(day, input) {
  const period = selectedPeriod();
  const driverId = driverSelect.value;
  if (!period || !driverId) return;
  const hours = input.value.trim() === '' ? 0 : Number(input.value);
  const response = await fetch(`/api/timesheets/${encodeURIComponent(driverId)}/extra`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      year: period.year,
      month: period.month,
      half: period.half,
      date: day.date,
      hours,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not save those extra hours.');
  day.extraHours = hours || 0;
  if (currentSheet?.email?.body) {
    const refreshed = await fetch(
      `/api/timesheets/${encodeURIComponent(driverId)}?` +
        new URLSearchParams({
          year: String(period.year),
          month: String(period.month),
          half: String(period.half),
        })
    );
    const sheet = await refreshed.json().catch(() => ({}));
    if (refreshed.ok) currentSheet = sheet;
  }
  setStatus('Extra hours saved.');
}

function emailSummary() {
  const mail = currentSheet?.email;
  if (!mail?.mailto_url) {
    setStatus('Add an email on this driver record, then try again.', true);
    return;
  }
  if (!openMailto(mail.mailto_url)) {
    setStatus('Could not open the email.', true);
    return;
  }
  setStatus('Opening the email.');
}

function printSummary() {
  const sheet = currentSheet;
  if (!sheet) return;
  const rows = (sheet.days || [])
    .map(
      (day) => `<tr>
        <td>${escapeHtml(day.label)}</td>
        <td class="num">${Number(day.clockHours).toFixed(2)}</td>
        <td class="num">${Number(day.contractHours).toFixed(2)}</td>
        <td class="num">${Number(day.amHours).toFixed(2)}</td>
        <td class="num">${Number(day.middayHours).toFixed(2)}</td>
        <td class="num">${Number(day.pmHours).toFixed(2)}</td>
        <td class="num">${Number(day.extraHours).toFixed(2)}</td>
        <td class="num">${Number(day.regular).toFixed(2)}</td>
        <td class="num">${Number(day.overtime).toFixed(2)}</td>
      </tr>`
    )
    .join('');
  const totals = sheet.totals || {};
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.append(frame);
  const page = frame.contentWindow;
  if (!page) {
    frame.remove();
    setStatus('Could not open the print view.', true);
    return;
  }
  page.document.open();
  page.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(sheet.period?.label || 'Timesheet')}</title>
<style>
  body{font-family:system-ui,sans-serif;padding:1.5rem;color:#111}
  h1{font-size:1.25rem;margin:0 0 .25rem}
  .meta{color:#444;margin:0 0 1rem}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #ccc;padding:.35rem .45rem;font-size:.85rem}
  th{background:#f4f4f5;text-align:left}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .note{margin-top:1rem;font-size:.8rem;color:#555}
</style></head><body>
<h1>${escapeHtml(sheet.heading || '')}</h1>
<p class="meta">${escapeHtml(sheet.period?.label || '')}<br>${escapeHtml(sheet.contract_text || '')}</p>
<table>
  <thead><tr>
    <th>Day</th><th class="num">Clock</th><th class="num">Contract</th>
    <th class="num">AM</th><th class="num">Midday</th><th class="num">PM</th>
    <th class="num">Extra</th><th class="num">Regular</th><th class="num">OT</th>
  </tr></thead>
  <tbody>
    ${rows}
    <tr><th>Period</th>
      <td class="num">${Number(totals.clockHours || 0).toFixed(2)}</td>
      <td class="num">${Number(totals.contractHours || 0).toFixed(2)}</td>
      <td></td><td></td><td></td><td></td>
      <td class="num">${Number(totals.regular || 0).toFixed(2)}</td>
      <td class="num">${Number(totals.overtime || 0).toFixed(2)}</td>
    </tr>
  </tbody>
</table>
<p class="note">Extra hours were typed on this sheet. They are not included in regular or overtime.</p>
</body></html>`);
  page.document.close();
  page.focus();
  page.print();
  setTimeout(() => frame.remove(), 1000);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function varianceRow(label, values, activeClass) {
  const row = document.createElement('tr');
  const name = document.createElement('th');
  name.scope = 'row';
  name.textContent = label;
  row.append(name);
  for (const value of values) {
    const node = document.createElement('td');
    if (!value) {
      node.textContent = '—';
    } else {
      node.textContent = Number(value).toFixed(2);
      node.className = activeClass;
    }
    row.append(node);
  }
  return row;
}

function renderCompare(days, totals) {
  compareTable.replaceChildren();
  compareTable.append(headerRow(['Day', 'Contract hours', 'Clock hours', 'Clock − contract', 'Regular', 'Overtime']));
  const body = document.createElement('tbody');
  for (const day of days) {
    const row = document.createElement('tr');
    if (day.clockHours === 0 && day.contractHours === 0) row.className = 'is-quiet';
    row.append(
      rowHeader(day.label),
      cell(day.contractHours.toFixed(2)),
      cell(day.clockHours.toFixed(2)),
      differenceCell(day.difference),
      cell(day.regular.toFixed(2)),
      cell(day.overtime.toFixed(2))
    );
    body.append(row);
  }
  const totalRow = document.createElement('tr');
  totalRow.className = 'is-total';
  totalRow.append(
    rowHeader('Period'),
    cell(Number(totals.contractHours || 0).toFixed(2)),
    cell(Number(totals.clockHours || 0).toFixed(2)),
    differenceCell(Number(totals.difference || 0)),
    cell(Number(totals.regular || 0).toFixed(2)),
    cell(Number(totals.overtime || 0).toFixed(2))
  );
  body.append(totalRow);
  compareTable.append(body);
}

function renderPairs(pairs) {
  pairsTable.replaceChildren();
  pairsTable.append(headerRow(['In', 'Out', 'Hours', 'Note', 'Reason codes']));
  const body = document.createElement('tbody');
  if (!pairs.length) {
    const row = document.createElement('tr');
    const empty = document.createElement('td');
    empty.colSpan = 5;
    empty.textContent = 'No clock records in this period.';
    row.append(empty);
    body.append(row);
  }
  for (const pair of pairs) {
    const row = document.createElement('tr');
    if (pair.hours == null) row.className = 'is-quiet';
    row.append(
      cell(pair.in_label),
      cell(pair.out_label),
      cell(pair.hours == null ? '' : Number(pair.hours).toFixed(2)),
      cell(pair.note),
      cell((pair.reason_codes || []).join(', '))
    );
    body.append(row);
  }
  pairsTable.append(body);
}

function headerRow(labels) {
  const head = document.createElement('thead');
  const row = document.createElement('tr');
  for (const label of labels) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    row.append(cell);
  }
  head.append(row);
  return head;
}

function rowHeader(text) {
  const cell = document.createElement('th');
  cell.scope = 'row';
  cell.textContent = text;
  return cell;
}

function cell(text) {
  const node = document.createElement('td');
  node.textContent = text ?? '';
  return node;
}

function differenceCell(value) {
  const node = cell(formatDifference(value));
  node.className = differenceClass(value);
  return node;
}

function formatDifference(value) {
  if (value === 0) return '0.00';
  const text = Math.abs(value).toFixed(2);
  return value > 0 ? `+${text}` : `−${text}`;
}

function differenceClass(value) {
  if (value > 0) return 'timesheet-diff is-over';
  if (value < 0) return 'timesheet-diff is-under';
  return 'timesheet-diff';
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

function setCopyStatus(message, isError = false) {
  if (!message) {
    copyStatus.textContent = '';
    copyStatus.className = 'status';
    return;
  }
  copyStatus.textContent = message;
  copyStatus.className = isError ? 'status visible error' : 'status visible ok';
}

function showError(error) {
  resultEl.hidden = true;
  currentSheet = null;
  setStatus(error instanceof Error ? error.message : 'Could not load that timesheet.', true);
}
