import { parseCardPeriodEnd } from './auditPayPeriods.js';
import { DEFAULT_PAY_LINES } from './driverPay.js';
import { formatAuditHours } from './timesheetAudit.js';

export const GENIE_CARD_ARCHIVE_KEY = 'teamster-genie-cards';
const ARCHIVE_VERSION = 1;

const DROPPED_KEYS = new Set([
  'frontFile',
  'backFile',
  'file',
  'image',
  'photo',
  'jpeg',
  'blob',
  'preview',
  'dataUrl',
  'src',
]);

const PAY_LABELS = new Map(DEFAULT_PAY_LINES.map((line) => [line.id, line.label]));

/**
 * @param {Storage | null | undefined} storage
 */
export function loadGenieCardArchive(storage) {
  if (!storage) return emptyGenieCardArchive();
  try {
    const raw = storage.getItem(GENIE_CARD_ARCHIVE_KEY);
    if (!raw) return emptyGenieCardArchive();
    return normalizeGenieCardArchive(JSON.parse(raw));
  } catch {
    return emptyGenieCardArchive();
  }
}

/**
 * @param {{ version?: number, cards?: object[] }} archive
 * @param {Storage | null | undefined} storage
 */
export function saveGenieCardArchive(archive, storage) {
  if (!storage) return false;
  try {
    storage.setItem(GENIE_CARD_ARCHIVE_KEY, JSON.stringify(normalizeGenieCardArchive(archive)));
    return true;
  } catch {
    return false;
  }
}

export function emptyGenieCardArchive() {
  return { version: ARCHIVE_VERSION, cards: [] };
}

/**
 * Constructed cards only. Example chips and in-progress reads are left out.
 * Photos and image data are not copied.
 * @param {object[] | null | undefined} cards
 */
export function archiveCardsFromSession(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const records = [];
  for (const card of list) {
    if (!card || card.example === true || card.status === 'reading') continue;
    const extraction = cloneConstructedExtraction(card.extraction);
    if (!extraction) continue;
    const id = String(card.id || '').trim();
    if (!id) continue;
    records.push({
      id,
      updatedAt: Number(card.updatedAt) || Date.now(),
      status: card.status === 'needs_review' ? 'needs_review' : 'ready',
      hoursMode: String(card.hoursMode || '').trim(),
      printId: String(card.printId || '').trim(),
      printed: card.printed === true,
      printQueued: card.printQueued === true,
      printQueuedAt: Number(card.printQueuedAt) || 0,
      extraction,
      summary: payPeriodSummarySnapshot(card.summary),
    });
  }
  return records;
}

/**
 * @param {object | null | undefined} summary A live Monthly Time Summary, or a snapshot already saved.
 */
export function payPeriodSummarySnapshot(summary) {
  if (!summary || typeof summary !== 'object' || !Array.isArray(summary.periods)) return null;
  const periods = summary.periods.map((period) => {
    const lines = (Array.isArray(period?.lines) ? period.lines : [])
      .map((line) => ({
        id: String(line?.id || ''),
        label: String(line?.label || line?.id || ''),
        total: String(line?.total || ''),
        cells: (Array.isArray(line?.cells) ? line.cells : []).map((cell) => ({
          day: cell?.day,
          value: String(cell?.value || ''),
        })),
      }))
      .filter((line) => line.total || line.cells.some((cell) => cell.value));
    return {
      key: String(period?.key || ''),
      label: String(period?.label || ''),
      ending: String(period?.ending || ''),
      days: Array.isArray(period?.days) ? period.days.map((day) => Number(day)) : [],
      contractedHours: Array.isArray(period?.contractedHours) ? period.contractedHours.map((value) => String(value || '')) : [],
      grandTotal: String(period?.grandTotal || ''),
      lines,
      unpaired: (Array.isArray(period?.unpaired) ? period.unpaired : []).map((item) => ({
        when: String(item?.when || ''),
        action: String(item?.action || ''),
      })),
    };
  });
  if (!periods.length) return null;
  return {
    driverName: String(summary.driverName || ''),
    jobTitle: String(summary.jobTitle || ''),
    location: String(summary.location || ''),
    serial: String(summary.serial || ''),
    rate: String(summary.rate || ''),
    account: String(summary.account || ''),
    periods,
  };
}

/**
 * @param {Date} [date]
 */
export function genieScanBackupFilename(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `timecard-genie-scans-${year}-${month}-${day}.html`;
}

/**
 * One HTML file a person can open or print. No photos.
 * @param {{ cards?: object[] } | null | undefined} archive
 * @param {Date} [generatedAt]
 */
export function genieScanBackupHtml(archive, generatedAt = new Date()) {
  const cards = normalizeGenieCardArchive(archive).cards;
  const generated = generatedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const groups = groupCardsByPeriod(cards);
  const body = groups.length
    ? groups.map((group) => periodSection(group)).join('')
    : '<p>No constructed cards are saved in this browser yet.</p>';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Timecard Genie scans</title>
  <style>
    body { margin: 1.5rem; color: #1a1a1a; font: 15px/1.4 "Segoe UI", Candara, sans-serif; }
    h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
    h2 { margin: 2rem 0 0.75rem; font-size: 1.2rem; }
    h3 { margin: 0 0 0.35rem; font-size: 1.05rem; }
    .lead, .meta { margin: 0.2rem 0; }
    .card { margin: 0 0 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #ccc; break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; margin: 0.4rem 0 0.8rem; }
    th, td { border: 1px solid #bbb; padding: 0.28rem 0.4rem; text-align: left; vertical-align: top; }
    th { background: #f4f4f4; }
    .days { overflow-x: auto; }
    .days td, .days th { text-align: center; white-space: nowrap; }
    .days td.label, .days th.label { text-align: left; }
    caption { caption-side: bottom; text-align: left; padding-top: 0.3rem; color: #333; }
  </style>
</head>
<body>
  <h1>Timecard Genie scans</h1>
  <p class="lead">Constructed cards and Monthly Time Summary sheets saved in this browser. Photos are not included. Downloaded ${escapeHtml(generated)}.</p>
  <p class="meta">${cards.length} card${cards.length === 1 ? '' : 's'}.</p>
  ${body}
</body>
</html>
`;
}

/**
 * @param {object | null | undefined} extraction
 */
export function cloneConstructedExtraction(extraction) {
  if (!extraction || typeof extraction !== 'object') return null;
  const cloned = cloneJson(extraction);
  if (!cloned || typeof cloned !== 'object') return null;
  return {
    header: cloned.header && typeof cloned.header === 'object' ? cloned.header : {},
    front_rows: numberRows(cloned.front_rows),
    back_rows: numberRows(cloned.back_rows),
        extra_sides: Array.isArray(cloned.extra_sides)
      ? cloned.extra_sides.map((side) => ({
          id: side?.id || '',
          card: side?.card ?? null,
          side: side?.side || '',
          printId: String(side?.printId || '').trim(),
          rows: numberRows(side?.rows),
        }))
      : [],
    caveats: Array.isArray(cloned.caveats) ? cloned.caveats.map((line) => String(line || '')).filter(Boolean) : [],
    sides_present: cloned.sides_present && typeof cloned.sides_present === 'object' ? cloned.sides_present : null,
  };
}

function normalizeGenieCardArchive(value) {
  const cards = Array.isArray(value?.cards) ? value.cards : [];
  return {
    version: ARCHIVE_VERSION,
    cards: cards.map(normalizeStoredCard).filter(Boolean),
  };
}

function normalizeStoredCard(card) {
  if (!card || typeof card !== 'object') return null;
  const id = String(card.id || '').trim();
  const extraction = cloneConstructedExtraction(card.extraction);
  if (!id || !extraction) return null;
  return {
    id,
    updatedAt: Number(card.updatedAt) || 0,
    status: card.status === 'needs_review' ? 'needs_review' : 'ready',
    hoursMode: String(card.hoursMode || '').trim(),
    printId: String(card.printId || '').trim(),
    printed: card.printed === true,
    printQueued: card.printQueued === true,
    printQueuedAt: Number(card.printQueuedAt) || 0,
    extraction,
    summary: payPeriodSummarySnapshot(card.summary),
  };
}

function numberRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row, index) => {
    const copy = row && typeof row === 'object' ? row : {};
    const current = Number(copy.row_index);
    return { ...copy, row_index: Number.isInteger(current) && current > 0 ? current : index + 1 };
  });
}

function cloneJson(value) {
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (DROPPED_KEYS.has(key)) return undefined;
      if (typeof item === 'string' && item.startsWith('data:image')) return undefined;
      if (typeof Blob !== 'undefined' && item instanceof Blob) return undefined;
      return item;
    })
  );
}

function groupCardsByPeriod(cards) {
  /** @type {Map<string, { iso: string, label: string, cards: object[] }>} */
  const groups = new Map();
  for (const card of cards) {
    const sticker = String(card.extraction?.header?.date_on_card || '').trim();
    const iso = parseCardPeriodEnd(sticker) || '';
    const key = iso || sticker || 'none';
    const label = sticker ? `Pay period ending ${sticker}` : 'No sticker date';
    const group = groups.get(key) || { iso, label, cards: [] };
    group.cards.push(card);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      cards: group.cards.sort((a, b) => cardName(a).localeCompare(cardName(b)) || a.updatedAt - b.updatedAt),
    }))
    .sort((a, b) => {
      if (!a.iso && !b.iso) return a.label.localeCompare(b.label);
      if (!a.iso) return 1;
      if (!b.iso) return -1;
      return a.iso.localeCompare(b.iso);
    });
}

function periodSection(group) {
  return `<section>
    <h2>${escapeHtml(group.label)}</h2>
    ${group.cards.map((card) => cardSection(card)).join('')}
  </section>`;
}

function cardSection(card) {
  const header = card.extraction?.header || {};
  const name = String(header.employee_name || '').trim() || 'Driver';
  const route = String(header.route_number || '').trim();
  const contract = formatStickerContractLine(header);
  const status = card.status === 'needs_review' ? 'Needs review' : 'Ready';
  const mode =
    card.hoursMode === 'quarter' ? 'Quarter hour rounding' : card.hoursMode === 'snap' ? 'Snap rounded times' : '';
  const facts = [
    route ? `Route ${route}` : '',
    contract ? `Contract ${contract}` : '',
    status,
    mode,
  ].filter(Boolean);
  const caveats = (card.extraction?.caveats || []).map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  const sides = [
    sideTable('Front', card.extraction?.front_rows),
    sideTable('Back', card.extraction?.back_rows),
    ...(card.extraction?.extra_sides || []).map((side) =>
      sideTable(`Card ${side.card || ''} ${side.side || 'side'}`.trim(), side.rows)
    ),
  ].join('');
  return `<article class="card">
    <h3>${escapeHtml(name)}</h3>
    <p class="meta">${escapeHtml(facts.join(' · '))}</p>
    ${caveats}
    ${sides || '<p>No clock rows on this card.</p>'}
    ${summarySection(card.summary)}
  </article>`;
}

function sideTable(title, rows) {
  const list = (Array.isArray(rows) ? rows : []).map(readableRow).filter(Boolean);
  if (!list.length) return '';
  const body = list
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.out)}</td>
        <td>${escapeHtml(row.in)}</td>
        <td>${escapeHtml(row.reg)}</td>
        <td>${escapeHtml(row.ot)}</td>
        <td>${escapeHtml(row.tot)}</td>
        <td>${escapeHtml(row.pay)}</td>
        <td>${escapeHtml(row.description)}</td>
      </tr>`
    )
    .join('');
  return `<table>
    <caption>${escapeHtml(title)}</caption>
    <thead><tr><th>Out</th><th>In</th><th>Reg</th><th>OT</th><th>Tot</th><th>Pay status</th><th>Description</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function readableRow(row) {
  if (!row || typeof row !== 'object' || row.crossed_out) return null;
  const out = String(row.clock_out_raw || '').trim();
  const inn = String(row.clock_in_raw || '').trim();
  const reg = hoursText(row.hours_regular);
  const ot = hoursText(row.hours_overtime);
  const tot = hoursText(row.total_hours);
  const description = String(row.description_of_work || '').trim();
  const pay = payText(row);
  if (!out && !inn && !reg && !ot && !tot && !description) return null;
  return { out, in: inn, reg, ot, tot, pay, description };
}

function summarySection(summary) {
  if (!summary?.periods?.length) {
    return '<p>Monthly Time Summary is not available for this card yet.</p>';
  }
  return summary.periods
    .map((period) => {
      const days = period.days || [];
      const head = days.map((day) => `<th>${escapeHtml(String(day))}</th>`).join('');
      const contract = (period.contractedHours || []).some((value) => String(value || '').trim())
        ? `<tr><th class="label">Contract</th>${days
            .map((_, index) => `<td>${escapeHtml(period.contractedHours[index] || '')}</td>`)
            .join('')}<td></td></tr>`
        : '';
      const lines = (period.lines || [])
        .map((line) => {
          const byDay = new Map((line.cells || []).map((cell) => [Number(cell.day), cell.value]));
          return `<tr><th class="label">${escapeHtml(line.label || line.id)}</th>${days
            .map((day) => `<td>${escapeHtml(byDay.get(Number(day)) || '')}</td>`)
            .join('')}<td>${escapeHtml(line.total || '')}</td></tr>`;
        })
        .join('');
      const unpaired = (period.unpaired || [])
        .filter((item) => item.when || item.action)
        .map((item) => `<li>${escapeHtml(item.when)} · ${escapeHtml(item.action)}</li>`)
        .join('');
      return `<div class="days">
        <table>
          <caption>Monthly Time Summary · ${escapeHtml(period.label || period.ending || 'Pay period')}</caption>
          <thead><tr><th class="label">Pay status</th>${head}<th>Total</th></tr></thead>
          <tbody>${contract}${lines}</tbody>
          <tfoot><tr><th class="label">Grand total</th><td colspan="${days.length}"></td><td>${escapeHtml(period.grandTotal || '')}</td></tr></tfoot>
        </table>
        ${unpaired ? `<p>Left off this sheet</p><ul>${unpaired}</ul>` : ''}
      </div>`;
    })
    .join('');
}

function payText(row) {
  const portions = Array.isArray(row?.pay_portions) ? row.pay_portions : [];
  if (portions.length) {
    const labels = [];
    for (const portion of portions) {
      const label = payStatusLabel(portion?.pay_status);
      if (label && !labels.includes(label)) labels.push(label);
    }
    if (labels.length) return labels.join(', ');
  }
  return payStatusLabel(row?.pay_status);
}

function payStatusLabel(value) {
  const id = String(value || '').trim();
  if (!id) return '';
  return PAY_LABELS.get(id) || id;
}

function hoursText(value) {
  if (value == null || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return formatAuditHours(number);
}

function formatStickerContractLine(header) {
  const total = header?.contract_hours;
  if (total == null || !(Number.isFinite(Number(total)) && Number(total) > 0)) return '';
  const parts = [header?.contract_am_hours, header?.contract_midday_hours, header?.contract_pm_hours]
    .map((value) => (value == null || value === '' ? null : Number(value)))
    .filter((value) => value != null && Number.isFinite(value) && value > 0);
  const totalText = formatAuditHours(total);
  if (!parts.length) return totalText;
  return `${totalText} (${parts.map((value) => formatAuditHours(value)).join(', ')})`;
}

function cardName(card) {
  return String(card?.extraction?.header?.employee_name || '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
