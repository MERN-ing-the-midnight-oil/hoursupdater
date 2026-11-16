// One timecard copy for email and for print.
// Both formats are built from this sheet, in the same order, with the same
// words: clock records, Reg, OT, Tot. Hrs., the run table, and a Monthly
// Time Summary stacked by day so it fits a message and a printed page.

import { formatAuditHours } from './timesheetAudit.js';
import {
  contractHoursDiffer,
  contractMismatchNote,
  formatRunHours,
  formatRunTitle,
  runTableSlots,
} from './timesheetRunTable.js';
import { alternateDayShade, snapsForCardRows } from './timesheetSnap.js';
import { formatStampParts, parseStampParts } from './timesheetNormalize.js';

const CARD_HEADERS = ['Run', 'Contract', 'Duration', 'Extra Time', 'Reg', 'OT', 'Tot. Hrs.', 'Clock Record'];
const SUMMARY_HEADERS = ['Pay status', 'OT', 'Total hours', 'Comments'];
const CERTIFY = 'I certify that the above hours were worked as reported.';
const UNPAIRED_NOTE = 'A clock in counts only after its clock out is recorded.';

/**
 * @param {unknown} value
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {unknown} value
 */
function hoursText(value) {
  if (value == null || value === '') return '';
  return formatRunHours(value);
}

/**
 * @param {object | null | undefined} row
 * @param {'reg' | 'ot'} field
 */
function hourCell(row, field) {
  const status = field === 'reg' ? row?.written_regular_status : row?.written_overtime_status;
  const hours = field === 'reg' ? row?.written_regular : row?.written_overtime;
  if (status === 'illegible') return 'illegible';
  if (status === 'number' && hours != null && hours !== '') return formatAuditHours(hours);
  const legacy = field === 'reg' ? row?.hours_regular : row?.hours_overtime;
  if (typeof legacy === 'number' && Number.isFinite(legacy)) return formatAuditHours(legacy);
  return legacy == null || legacy === '' ? '' : String(legacy);
}

/**
 * @param {object | null | undefined} row
 */
function totCell(row) {
  if (row?.total_hours == null || row.total_hours === '') return '';
  return formatAuditHours(row.total_hours);
}

/**
 * @param {unknown} raw
 * @returns {{ text: string, illegible: boolean } | null}
 */
function stampEntry(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const parts = parseStampParts(text);
  return {
    text: formatStampParts(parts) || text,
    illegible: parts.illegible === true || parts.handwriting === true,
  };
}

/**
 * @param {object | null | undefined} row
 * @returns {{ label: 'Out' | 'In', text: string, illegible: boolean }[]}
 */
function clockEntries(row) {
  const out = stampEntry(row?.clock_out_raw);
  const inn = stampEntry(row?.clock_in_raw);
  if (inn && !out) return [{ label: 'In', ...inn }];
  if (out && !inn) return [{ label: 'Out', ...out }];
  if (!out && !inn) return [];
  return [
    { label: 'Out', ...(out || { text: '—', illegible: false }) },
    { label: 'In', ...(inn || { text: '—', illegible: false }) },
  ];
}

/**
 * @param {object | null | undefined} row
 */
function clockLineKind(row) {
  const hasOut = Boolean(String(row?.clock_out_raw ?? '').trim());
  const hasIn = Boolean(String(row?.clock_in_raw ?? '').trim());
  if (hasIn && !hasOut) return 'in';
  if (hasOut && !hasIn) return 'out';
  if (hasIn && hasOut) return 'pair';
  return '';
}

/**
 * @param {object | null | undefined} row
 * @param {object | null | undefined} next
 */
function pairBreakAfter(row, next) {
  const kind = clockLineKind(row);
  const nextKind = clockLineKind(next);
  if (!kind || !nextKind) return false;
  return (kind === 'in' || kind === 'pair') && (nextKind === 'out' || nextKind === 'pair');
}

/**
 * @param {object | null | undefined} known
 * @param {string} run
 */
function knownHoursForRun(known, run) {
  if (!known) return null;
  if (run === 'AM') return known.am;
  if (run === 'MID') return known.midday;
  if (run === 'PM') return known.pm;
  return null;
}

/**
 * @param {object | null | undefined} header
 */
function identityLines(header) {
  /** @type {string[]} */
  const lines = [];
  const route = String(header?.route_number ?? '').trim();
  if (route) lines.push(`Route ${route}`);
  const date = String(header?.date_on_card ?? '').trim();
  if (date) lines.push(`Date on card ${date}`);
  const total = hoursText(header?.contract_hours);
  const parts = [
    ['AM', header?.contract_am_hours],
    ['Mid', header?.contract_midday_hours],
    ['PM', header?.contract_pm_hours],
  ]
    .map(([label, value]) => {
      const hours = hoursText(value);
      return hours ? `${label} ${hours}` : '';
    })
    .filter(Boolean);
  if (total || parts.length) {
    const tail = parts.length ? `(${parts.join(', ')})` : '';
    lines.push(['Contract', total, tail].filter(Boolean).join(' '));
  }
  return lines;
}

/**
 * @param {object[] | null | undefined} rows
 * @param {object | null | undefined} breaks
 * @param {string | null | undefined} mode
 * @param {object | null | undefined} windows
 * @param {object | null | undefined} contract
 * @param {object | null | undefined} known
 */
function buildSideRows(rows, breaks, mode, windows, contract, known) {
  const list = Array.isArray(rows) ? rows : [];
  const snaps = snapsForCardRows(list, breaks, null, mode);
  const slots = runTableSlots(list, snaps, windows, contract);
  const shade = alternateDayShade(list);
  const slotAt = new Map(slots.map((slot) => [slot.index, slot]));
  /** @type {object[]} */
  const included = [];
  for (let index = 0; index < list.length; index += 1) {
    const row = list[index] || {};
    const entries = clockEntries(row);
    const reg = hourCell(row, 'reg');
    const ot = hourCell(row, 'ot');
    const tot = totCell(row);
    const hasContent = Boolean(entries.length || reg || ot || tot || row.crossed_out);
    if (!hasContent) continue;
    included.push({
      index,
      row,
      slot: slotAt.get(index + 1) || null,
      entries,
      reg,
      ot,
      tot,
      shade: Boolean(shade[index]),
      pairBreak: pairBreakAfter(row, list[index + 1]),
    });
  }

  /** @type {{ owner: object, end: number, count: number } | null} */
  let active = null;
  for (const item of included) {
    const slot = item.slot;
    if (slot?.role === 'pair') {
      active = { owner: item, end: slot.endIndex, count: 1 };
      item.runSpan = 1;
    } else if (active && slot?.role === 'continue' && item.index <= active.end) {
      active.count += 1;
      item.runSpan = 0;
    } else {
      active = null;
      item.runSpan = 1;
    }
  }
  for (const item of included) {
    if (item.runSpan === 1 && item.slot?.role === 'pair') {
      const count = included.filter(
        (other) => other.slot?.role === 'continue' && other.index <= item.slot.endIndex && other.index > item.index
      ).length;
      item.runSpan = count + 1;
    }
  }

  /** @type {string[]} */
  const notes = [];
  const seen = new Set();
  /** @type {object[]} */
  const built = included.map((item) => {
    const flags = [];
    if (item.row.crossed_out) flags.push('crossed out');
    if (item.row.hours_add_up === false) flags.push('hours do not add up');
    const slot = item.slot;
    let runCells = ['—', '—', '—', '—'];
    let extraTone = '';
    let contractWarn = false;
    if (item.runSpan === 0) {
      runCells = ['', '', '', ''];
    } else if (slot?.role === 'pair') {
      const contractText = slot.contract == null ? '—' : formatRunHours(slot.contract);
      const knownHours = knownHoursForRun(known, slot.run);
      contractWarn = contractHoursDiffer(slot.contract, knownHours);
      if (contractWarn) {
        const note = contractMismatchNote({
          run: slot.run,
          cardHours: slot.contract,
          knownHours,
          driver: known?.driver,
          route: known?.route,
          asOf: known?.asOf,
        });
        if (!seen.has(note)) {
          seen.add(note);
          notes.push(note);
        }
      }
      const extraText = slot.extra == null ? '—' : formatRunHours(slot.extra);
      if (slot.extra != null && slot.extra < 0) extraTone = 'short';
      else if (slot.extra != null && slot.extra > 0) extraTone = 'over';
      runCells = [
        formatRunTitle(slot.run),
        contractWarn ? `${contractText} *` : contractText,
        slot.duration == null ? '—' : formatRunHours(slot.duration),
        extraText,
      ];
    }
    const clockText = item.entries.length
      ? item.entries.map((entry) => `${entry.label} ${entry.text}`).join(' · ')
      : '—';
    return {
      cells: [...runCells, item.reg, item.ot, item.tot, flags.length ? `${clockText} (${flags.join('; ')})` : clockText],
      clocks: item.entries,
      flags,
      extraTone,
      contractWarn,
      shade: item.shade,
      pairBreak: item.pairBreak,
      crossed: item.row.crossed_out === true,
      hoursOff: item.row.hours_add_up === false,
      runSpan: item.runSpan,
    };
  });
  return { rows: built, notes };
}

/**
 * @param {object | null | undefined} extraction
 */
function cardSides(extraction) {
  const present = extraction?.sides_present;
  /** @type {{ title: string, rows: object[] }[]} */
  const sides = [];
  if (!present || present.front !== false) sides.push({ title: 'Front', rows: extraction?.front_rows || [] });
  if (!present || present.back !== false) sides.push({ title: 'Back', rows: extraction?.back_rows || [] });
  const extras = Array.isArray(extraction?.extra_sides) ? extraction.extra_sides : [];
  for (const extra of extras) {
    const card = Number(extra?.card) || 0;
    const face = extra?.side === 'back' ? 'back' : 'front';
    const title = card >= 2 ? `Card ${card} ${face}` : face === 'back' ? 'Back' : 'Front';
    sides.push({ title, rows: Array.isArray(extra?.rows) ? extra.rows : [] });
  }
  return sides;
}

/**
 * @param {object | null | undefined} period
 */
function periodHasContent(period) {
  if (Array.isArray(period?.unpaired) && period.unpaired.length) return true;
  if ((period?.contractedHours || []).some((hours) => String(hours ?? '').trim())) return true;
  return (period?.lines || []).some((line) => {
    if (String(line?.total ?? '').trim() || String(line?.comment ?? '').trim()) return true;
    return (line?.cells || []).some((cell) => String(cell?.value ?? '').trim());
  });
}

/**
 * @param {object | null | undefined} summary
 */
function summaryView(summary) {
  if (!summary?.periods?.length) return { unavailable: true, periods: [] };
  const useful = summary.periods.filter((period) => periodHasContent(period));
  const chosen = useful.length
    ? useful
    : [summary.periods.find((period) => period.key === summary.defaultPeriodKey) || summary.periods[0]].filter(Boolean);
  return {
    unavailable: false,
    district: 'Bellingham Public Schools',
    location: String(summary.location ?? '').trim(),
    driverName: String(summary.driverName ?? '').trim(),
    jobTitle: String(summary.jobTitle ?? '').trim(),
    serial: String(summary.serial ?? '').trim(),
    rate: String(summary.rate ?? '').trim(),
    account: String(summary.account ?? '').trim(),
    periods: chosen.map((period) => {
      const days = Array.isArray(period.days) ? period.days : [];
      const contractDays = days
        .map((day, index) => ({
          day: String(day),
          hours: String(period.contractedHours?.[index] ?? '').trim(),
        }))
        .filter((day) => day.hours);
      const lines = (period.lines || [])
        .map((line) => {
          const dayRows = (line.cells || [])
            .map((cell) => ({ day: String(cell?.day ?? ''), hours: String(cell?.value ?? '').trim() }))
            .filter((day) => day.hours);
          return {
            label: String(line?.label ?? '').trim(),
            ot: line?.otFactor == null || line.otFactor === '' ? '' : String(line.otFactor),
            total: String(line?.total ?? '').trim(),
            comment: String(line?.comment ?? '').trim(),
            days: dayRows,
          };
        })
        .filter((line) => line.total || line.comment || line.days.length);
      return {
        label: String(period.label ?? '').trim(),
        ending: String(period.ending ?? '').trim(),
        contractDays,
        lines,
        grandTotal: String(period.grandTotal ?? '').trim(),
        showTotal: lines.length > 0,
        unpaired: (period.unpaired || []).map((item) => ({
          when: String(item?.when ?? '').trim(),
          action: String(item?.action ?? '').trim(),
        })),
      };
    }),
  };
}

/**
 * Sheet shared by the email body and the printed page.
 * @param {{
 *   extraction?: object | null,
 *   driverName?: string,
 *   breaks?: object | null,
 *   mode?: string | null,
 *   windows?: object | null,
 *   known?: { am?: unknown, midday?: unknown, pm?: unknown, driver?: string, route?: string, asOf?: string } | null,
 *   summary?: object | null,
 * }} [options]
 */
export function buildTimecardCopySheet(options = {}) {
  const extraction = options.extraction || {};
  const header = extraction.header || {};
  const driverName = String(options.driverName || header.employee_name || '').trim() || 'Driver';
  const sides = cardSides(extraction)
    .map((side) => {
      const built = buildSideRows(side.rows, options.breaks, options.mode, options.windows, header, options.known);
      return { title: side.title, headers: CARD_HEADERS, ...built };
    })
    .filter((side) => side.rows.length);
  return {
    title: 'Completed timecard',
    driverName,
    identity: identityLines(header),
    sides,
    emptyNote: sides.length ? '' : 'No clock records on this card.',
    summary: summaryView(options.summary),
  };
}

/**
 * @param {string[]} headers
 * @param {string[][]} rows
 */
function alignedTable(headers, rows) {
  const widths = headers.map((header, index) => {
    let width = String(header).length;
    for (const row of rows) width = Math.max(width, String(row[index] ?? '').length);
    return width;
  });
  const paint = (cells) =>
    cells
      .map((cell, index) => String(cell ?? '').padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  const rule = widths.map((width) => '-'.repeat(Math.max(width, 1))).join('  ');
  return [paint(headers), rule, ...rows.map((row) => paint(row))].join('\n');
}

/**
 * @param {object} summary
 */
function summaryText(summary) {
  /** @type {string[]} */
  const lines = ['MONTHLY TIME SUMMARY'];
  if (summary.unavailable) {
    lines.push('Monthly Time Summary is not available for this card yet.');
    return lines.join('\n');
  }
  lines.push('Bellingham Public Schools');
  if (summary.location) lines.push(summary.location);
  lines.push('');
  const meta = [
    ['Employee', summary.driverName],
    ['Job title', summary.jobTitle],
    ['Serial #', summary.serial],
    ['Location', summary.location],
    ['Rate', summary.rate],
    ['Account', summary.account],
  ];
  const metaWidth = Math.max(...meta.map(([label]) => label.length));
  for (const [label, value] of meta) lines.push(`${label.padEnd(metaWidth)}  ${value}`);
  for (const period of summary.periods) {
    lines.push('');
    if (period.label) lines.push(period.label);
    if (period.ending) lines.push(`Pay period ending ${period.ending}`);
    if (period.contractDays.length) {
      lines.push('');
      lines.push('REG CONTR HRS');
      lines.push(
        alignedTable(
          ['Day', 'Hours'],
          period.contractDays.map((day) => [day.day, day.hours])
        )
      );
    }
    if (period.lines.length) {
      lines.push('');
      /** @type {string[][]} */
      const rows = [];
      for (const line of period.lines) {
        rows.push([line.label, line.ot, line.total, line.comment]);
        for (const day of line.days) rows.push([`Day ${day.day}`, '', day.hours, '']);
      }
      if (period.showTotal) rows.push(['TOTAL', '', period.grandTotal, '']);
      lines.push(alignedTable(SUMMARY_HEADERS, rows));
    }
    if (period.unpaired.length) {
      lines.push('');
      lines.push('Clock records left off this sheet');
      for (const item of period.unpaired) lines.push(`${item.when} · ${item.action}`);
      lines.push(UNPAIRED_NOTE);
    }
  }
  lines.push('');
  lines.push(CERTIFY);
  lines.push('Employee signature ________    Date ________    Supervisor approval ________');
  return lines.join('\n');
}

/**
 * Plain-text copy. The mail draft uses this as the message body.
 * @param {ReturnType<typeof buildTimecardCopySheet>} sheet
 */
export function renderTimecardCopyText(sheet) {
  /** @type {string[]} */
  const lines = [sheet.title, sheet.driverName, ...sheet.identity];
  if (sheet.emptyNote) {
    lines.push('');
    lines.push(sheet.emptyNote);
  }
  for (const side of sheet.sides) {
    lines.push('');
    lines.push(side.title);
    lines.push(
      alignedTable(
        side.headers,
        side.rows.map((row) => row.cells)
      )
    );
    for (const note of side.notes) lines.push(note);
  }
  lines.push('');
  lines.push(summaryText(sheet.summary));
  return lines.join('\n');
}

/**
 * @param {{ label: string, text: string, illegible?: boolean }[]} clocks
 * @param {string[]} flags
 */
function clockHtml(clocks, flags) {
  const stamps = clocks.length
    ? clocks
        .map(
          (clock) =>
            `<div class="stamp"><span class="stamp-label">${escapeHtml(clock.label)}</span> <span class="${
              clock.illegible ? 'is-illegible' : ''
            }">${escapeHtml(clock.text)}</span></div>`
        )
        .join('')
    : '<div>—</div>';
  const flag = flags.length ? `<div class="flag">${escapeHtml(flags.join('; '))}</div>` : '';
  return `${stamps}${flag}`;
}

/**
 * @param {object} summary
 */
function summaryHtml(summary) {
  if (summary.unavailable) {
    return `<section class="summary"><h2>MONTHLY TIME SUMMARY</h2><p class="empty">Monthly Time Summary is not available for this card yet.</p></section>`;
  }
  const meta = [
    ['Employee', summary.driverName],
    ['Job title', summary.jobTitle],
    ['Serial #', summary.serial],
    ['Location', summary.location],
    ['Rate', summary.rate],
    ['Account', summary.account],
  ]
    .map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('');
  const periods = summary.periods
    .map((period) => {
      const contract = period.contractDays.length
        ? `<h3>REG CONTR HRS</h3><table class="summary"><thead><tr><th scope="col">Day</th><th scope="col">Hours</th></tr></thead><tbody>${period.contractDays
            .map(
              (day) =>
                `<tr class="contract"><th scope="row">${escapeHtml(day.day)}</th><td>${escapeHtml(day.hours)}</td></tr>`
            )
            .join('')}</tbody></table>`
        : '';
      const body = period.lines
        .map((line) => {
          const head = `<tr class="status"><th scope="row">${escapeHtml(line.label)}</th><td>${escapeHtml(
            line.ot
          )}</td><td>${escapeHtml(line.total)}</td><td>${escapeHtml(line.comment)}</td></tr>`;
          const days = line.days
            .map(
              (day) =>
                `<tr class="day"><th scope="row">Day ${escapeHtml(day.day)}</th><td></td><td>${escapeHtml(
                  day.hours
                )}</td><td></td></tr>`
            )
            .join('');
          return `${head}${days}`;
        })
        .join('');
      const total = period.showTotal
        ? `<tfoot><tr><th scope="row">TOTAL</th><td></td><td>${escapeHtml(period.grandTotal)}</td><td></td></tr></tfoot>`
        : '';
      const table = period.lines.length
        ? `<table class="summary"><thead><tr>${SUMMARY_HEADERS.map(
            (header) => `<th scope="col">${escapeHtml(header)}</th>`
          ).join('')}</tr></thead><tbody>${body}</tbody>${total}</table>`
        : '';
      const unpaired = period.unpaired.length
        ? `<h3>Clock records left off this sheet</h3><ul>${period.unpaired
            .map((item) => `<li>${escapeHtml(item.when)} · ${escapeHtml(item.action)}</li>`)
            .join('')}</ul><p>${escapeHtml(UNPAIRED_NOTE)}</p>`
        : '';
      return `<section class="period"><h3 class="period-label">${escapeHtml(period.label)}</h3>${
        period.ending ? `<p class="ending">Pay period ending ${escapeHtml(period.ending)}</p>` : ''
      }${contract}${table}${unpaired}</section>`;
    })
    .join('');
  return `<section class="summary">
    <header class="banner">
      <p class="district">Bellingham Public Schools</p>
      <h2>MONTHLY TIME SUMMARY</h2>
      ${summary.location ? `<p class="dept">${escapeHtml(summary.location)}</p>` : ''}
    </header>
    <table class="meta"><tbody>${meta}</tbody></table>
    ${periods}
    <p class="cert">${escapeHtml(CERTIFY)}</p>
    <div class="signs">
      <div><span>Employee signature</span><i></i></div>
      <div><span>Date</span><i></i></div>
      <div><span>Supervisor approval</span><i></i></div>
    </div>
  </section>`;
}

/**
 * Printed page for one driver. Same sections and words as the email text.
 * @param {ReturnType<typeof buildTimecardCopySheet>} sheet
 */
export function renderTimecardCopyHtml(sheet) {
  const identity = sheet.identity.map((line) => `<p class="identity">${escapeHtml(line)}</p>`).join('');
  const empty = sheet.emptyNote ? `<p class="empty">${escapeHtml(sheet.emptyNote)}</p>` : '';
  const sides = sheet.sides
    .map((side) => {
      const body = side.rows
        .map((row) => {
          const classes = [
            row.shade ? 'shade' : '',
            row.pairBreak ? 'break' : '',
            row.crossed ? 'crossed' : '',
            row.hoursOff ? 'hours-off' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const span = row.runSpan > 1 ? ` rowspan="${row.runSpan}"` : '';
          const runCells =
            row.runSpan === 0
              ? ''
              : `<td class="run"${span}>${escapeHtml(row.cells[0])}</td><td class="run${
                  row.contractWarn ? ' warn' : ''
                }"${span}>${escapeHtml(row.cells[1])}</td><td class="run"${span}>${escapeHtml(
                  row.cells[2]
                )}</td><td class="run extra ${row.extraTone}"${span}>${escapeHtml(row.cells[3])}</td>`;
          return `<tr class="${classes}">${runCells}<td class="num">${escapeHtml(row.cells[4])}</td><td class="num">${escapeHtml(
            row.cells[5]
          )}</td><td class="num">${escapeHtml(row.cells[6])}</td><td class="clock">${clockHtml(
            row.clocks,
            row.flags
          )}</td></tr>`;
        })
        .join('');
      const notes = side.notes.length
        ? `<ul class="notes">${side.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
        : '';
      return `<section class="side"><h2>${escapeHtml(side.title)}</h2><table class="card"><thead><tr>${side.headers
        .map((header) => `<th scope="col">${escapeHtml(header)}</th>`)
        .join('')}</tr></thead><tbody>${body}</tbody></table>${notes}</section>`;
    })
    .join('');
  return `<header class="who"><h1>${escapeHtml(sheet.title)}</h1><p class="driver">${escapeHtml(
    sheet.driverName
  )}</p>${identity}</header>${empty}${sides}${summaryHtml(sheet.summary)}`;
}

const COPY_CSS = `
  @page { margin: 0.5in; }
  html, body { background: #fff; }
  body { margin: 0; color: #1c2830; font-family: "Segoe UI", Helvetica, Arial, sans-serif; font-size: 12px; }
  article.copy { break-after: page; page-break-after: always; }
  article.copy:last-child { break-after: auto; page-break-after: auto; }
  h1 { margin: 0; font-size: 20px; letter-spacing: 0.04em; }
  h2 { margin: 0.9rem 0 0.35rem; font-size: 15px; }
  h3 { margin: 0.7rem 0 0.25rem; font-size: 13px; }
  .driver { margin: 0.15rem 0 0; font-size: 16px; font-weight: 700; }
  .identity, .empty, .ending, .cert { margin: 0.12rem 0; }
  table { border-collapse: collapse; }
  table.card { width: 100%; table-layout: fixed; background: #d7eaf6; margin-top: 0.2rem; }
  table.card th:nth-child(1) { width: 8%; }
  table.card th:nth-child(2), table.card th:nth-child(3) { width: 11%; }
  table.card th:nth-child(4) { width: 12%; }
  table.card th:nth-child(5), table.card th:nth-child(6) { width: 8%; }
  table.card th:nth-child(7) { width: 11%; }
  table.card th, table.card td { border: 1px solid #7eb6d6; padding: 0.18rem 0.35rem; vertical-align: middle; }
  table.card th { background: #e8eef3; font-size: 11px; text-align: center; }
  td.run { text-align: center; font-family: "American Typewriter", "Courier New", Courier, monospace; font-weight: 700; color: #1f4b66; }
  td.num { text-align: center; font-family: "Permanent Marker", "Marker Felt", "Comic Sans MS", cursive; font-size: 15px; }
  td.clock { font-family: "American Typewriter", "Courier New", Courier, monospace; }
  .stamp { white-space: normal; }
  .stamp-label { display: inline-block; min-width: 1.8rem; font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; color: #3d5a73; }
  tr.shade td { background: #c5dff0; }
  tr.break td { border-bottom: 2px solid #1a1a1a; }
  tr.crossed td { opacity: 0.78; }
  tr.hours-off td:first-child { box-shadow: inset 3px 0 0 #c2410c; }
  td.extra.short { color: #9a3412; }
  td.extra.over { color: #0f6b4c; }
  td.warn { color: #9b1c1c; }
  .is-illegible, .flag { color: #c62828; font-style: italic; font-weight: 700; }
  .notes { margin: 0.3rem 0 0; padding-left: 1.1rem; }
  .banner { text-align: center; margin: 0.4rem 0 0.5rem; }
  .district, .dept { margin: 0; letter-spacing: 0.04em; font-size: 11px; }
  .summary h2 { margin: 0.08rem 0; font-size: 18px; letter-spacing: 0.08em; }
  table.meta { width: 100%; margin: 0 0 0.4rem; }
  table.meta th, table.meta td { border-bottom: 1px solid #222; padding: 0.12rem 0.4rem 0.12rem 0; text-align: left; font-weight: 500; }
  table.meta th { width: 7.5rem; font-weight: 700; }
  table.summary { width: 100%; margin: 0 0 0.45rem; }
  table.summary th, table.summary td { border: 1px solid #222; padding: 0.14rem 0.3rem; text-align: center; font-size: 11px; }
  table.summary thead th { background: #f4f4f4; }
  table.summary tbody th { text-align: left; }
  tr.contract th, tr.contract td { background: #f7f4ea; font-weight: 700; }
  tr.day th { padding-left: 1rem; font-weight: 500; color: #3d4c59; }
  table.summary tfoot th, table.summary tfoot td { background: #d9d9d9; font-weight: 700; }
  .signs { display: flex; gap: 1.2rem; margin-top: 0.45rem; }
  .signs div { flex: 1; }
  .signs span { display: block; font-size: 11px; margin-bottom: 0.15rem; }
  .signs i { display: block; border-bottom: 1px solid #222; height: 0.38in; }
`;

/**
 * Printable document for one or more drivers.
 * Clipboard HTML skips the web font so a paste does not wait on the network.
 * @param {ReturnType<typeof buildTimecardCopySheet>[]} sheets
 * @param {{ externalFonts?: boolean }} [options]
 */
export function renderTimecardCopyDocument(sheets, options = {}) {
  const list = Array.isArray(sheets) ? sheets.filter(Boolean) : [];
  const title = list.length === 1 ? `${list[0].title} for ${list[0].driverName}` : 'Timecard copies';
  const body = list.map((sheet) => `<article class="copy">${renderTimecardCopyHtml(sheet)}</article>`).join('');
  const font =
    options.externalFonts === false
      ? ''
      : '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Permanent+Marker&amp;display=swap">';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(
    title
  )}</title>${font}<style>${COPY_CSS}</style></head><body>${body}</body></html>`;
}
