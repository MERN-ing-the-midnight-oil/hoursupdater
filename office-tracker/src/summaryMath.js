/**
 * Quarter-hour steps behind a Monthly Time Summary day cell.
 * EX DRIVER is the clocked quarter hours beyond that day's contract hours.
 * The math table shows contract hours, the clocks, the snap, and EX HOURS.
 * Other pay-status rows are not calculated here.
 */

import { parseClockTime, roundClockToQuarterHour } from '../../src/logic/timeUtils.js';
import { normalizeOvertimeRules } from './overtimeRules.js';
import { quarterHoursFromDailyMinutes, quarterHoursFromMinutes } from './payrollTimes.js';
import { CLOCK_ROUNDING_DAILY, CLOCK_ROUNDING_SNAP, normalizeClockRounding } from '../web/store.js';

/**
 * @param {string} clockIn
 * @param {string} clockOut
 */
function minutesApart(clockIn, clockOut) {
  const start = parseClockTime(clockIn);
  let end = parseClockTime(clockOut);
  if (end < start) end += 24 * 60;
  return end - start;
}

/**
 * Hours text used on the summary. Blank, zero, and non-numbers stay blank.
 * @param {unknown} hours
 */
export function formatQuarterHourText(hours) {
  if (hours == null || hours === '' || !Number.isFinite(Number(hours))) return '';
  const snapped = Math.round(Number(hours) * 4) / 4;
  if (!snapped) return '';
  return snapped.toFixed(2);
}

/**
 * Written clocks, the clocks the minutes are counted from, and the quarter hours.
 * Snapping moves each clock to the nearest quarter hour first.
 * Rounding each span keeps the written clocks and rounds that span's minutes.
 * Rounding only the daily total keeps the written clocks and leaves the span unrounded.
 * @param {unknown} rawIn
 * @param {unknown} rawOut
 * @param {boolean | string} [rounding]
 */
export function clockQuarterStep(rawIn, rawOut, rounding = false) {
  const writtenIn = String(rawIn ?? '').trim();
  const writtenOut = String(rawOut ?? '').trim();
  if (!writtenIn || !writtenOut) return null;
  let usedIn = writtenIn;
  let usedOut = writtenOut;
  const mode = normalizeClockRounding(rounding);
  try {
    if (mode === CLOCK_ROUNDING_SNAP) {
      usedIn = roundClockToQuarterHour(writtenIn);
      usedOut = roundClockToQuarterHour(writtenOut);
    }
    if (!usedIn || !usedOut) return null;
    const minutes = minutesApart(usedIn, usedOut);
    if (!Number.isFinite(minutes)) return null;
    const snappedMinutes = Math.round(minutes / 15) * 15;
    return {
      writtenIn,
      writtenOut,
      usedIn,
      usedOut,
      minutes,
      snappedMinutes,
      quarterHours: mode === CLOCK_ROUNDING_DAILY ? null : quarterHoursFromMinutes(minutes),
    };
  } catch {
    return null;
  }
}

/**
 * EX DRIVER for one day on the district summary. Blank when the contract
 * hours are missing, or when the clocked time does not go past them.
 * @param {number | null | undefined} clocked
 * @param {unknown} contractText
 */
export function exDriverDayHours(clocked, contractText) {
  const difference = exHoursDifference(clocked, contractText);
  if (!difference || difference.startsWith('-')) return '';
  return difference;
}

/**
 * Billable clock hours minus that day's contract hours. Negative when the
 * billable hours are under the contract. Blank when either figure is missing,
 * and blank when they are equal.
 * @param {number | null | undefined} clocked
 * @param {unknown} contractText
 */
export function exHoursDifference(clocked, contractText) {
  if (clocked == null || !Number.isFinite(Number(clocked))) return '';
  const text = String(contractText ?? '').trim();
  if (!text) return '';
  const contract = Number(text);
  if (!Number.isFinite(contract) || contract <= 0) return '';
  return formatQuarterHourText(Number(clocked) - contract);
}

/**
 * File name for the landscape letter PDF attached to the driver email.
 * @param {string} driverName
 */
export function mathPdfBasename(driverName) {
  const slug = String(driverName ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'driver'}-ex-driver-time-summary-math`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * One slot for each consecutive clock-in and clock-out, in the order they were punched.
 * @param {Array<{ pairs?: Array<unknown> }>} days
 */
function pairSlots(days) {
  const total = days.reduce((max, day) => Math.max(max, (day.pairs || []).length), 0);
  return Array.from({ length: total }, (_, index) => ({ index, total }));
}

/**
 * @param {{ pairs?: Array<Record<string, unknown>> }} day
 * @param {number} index
 */
function pairAt(day, index) {
  return (day.pairs || [])[index] || null;
}

/**
 * @param {number} index
 * @param {number} total
 * @param {'in' | 'out' | 'actual' | 'rounded' | 'snap' | 'actual-ot' | 'rounded-ot' | 'snap-ot'} kind
 */
function slotLabel(index, total, kind) {
  const suffix = total > 1 ? ` ${index + 1}` : '';
  if (kind === 'in') return `Clock In${suffix}`;
  if (kind === 'out') return `Clock Out${suffix}`;
  if (kind === 'actual') return `Actual minutes${suffix}`;
  if (kind === 'rounded') return `Quarter-hour minutes${suffix}`;
  if (kind === 'actual-ot') return `Actual overtime minutes${suffix}`;
  if (kind === 'rounded-ot') return `Quarter-hour overtime minutes${suffix}`;
  if (kind === 'snap-ot') return `Snap overtime minutes${suffix}`;
  return `Snap minutes${suffix}`;
}

/**
 * @param {number | null | undefined} minutes
 */
function minuteText(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return '';
  return String(minutes);
}

/**
 * @param {Record<string, unknown> | null | undefined} pair
 */
function pairHasOvertime(pair) {
  if (!pair) return false;
  return ['actualOvertimeMinutes', 'roundedOvertimeMinutes', 'snapOvertimeMinutes'].some((key) => Number(pair[key]) > 0);
}

/**
 * @param {Record<string, unknown> | null | undefined} pair
 * @param {string} key
 */
function overtimeMinuteText(pair, key) {
  if (!pairHasOvertime(pair)) return '';
  const minutes = pair?.[key];
  if (minutes == null || !Number.isFinite(Number(minutes))) return '';
  return String(minutes);
}

/**
 * @param {Record<string, unknown> | null | undefined} pair
 * @param {'actualOvertimeMinutes' | 'snapOvertimeMinutes'} key
 */
function overtimeTip(pair, key) {
  const minutes = Number(pair?.[key]);
  if (!pair || !Number.isFinite(minutes) || minutes <= 0) return '';
  const reasons = key === 'snapOvertimeMinutes' ? pair.snapOvertimeReasons : pair.overtimeReasons;
  const why = Array.isArray(reasons) ? reasons.filter(Boolean).join(', ') : '';
  return why ? `${minutes} overtime minutes: ${why}.` : `${minutes} overtime minutes.`;
}

/**
 * @param {Array<{ pairs?: Array<Record<string, unknown>> }>} days
 * @param {number} index
 */
function slotHasOvertime(days, index) {
  return days.some((day) => pairHasOvertime(pairAt(day, index)));
}

/**
 * @param {Array<{ residual?: string }>} days
 */
function sumExHours(days) {
  const present = days.map((day) => day.residual).filter((value) => value);
  if (!present.length) return '';
  const total = present.reduce((sum, value) => sum + Number(value), 0);
  if (!Number.isFinite(total)) return '';
  return (Math.round(total * 4) / 4).toFixed(2);
}

/**
 * Overtime hours for the pay period, using the rounding method that payroll counts.
 * @param {Array<{ pairs?: Array<Record<string, unknown>> }>} days
 * @param {'snap' | 'daily' | 'separate'} rounding
 */
function sumOvertimeHours(days, rounding) {
  if (rounding === 'daily') {
    const hours = days.reduce((sum, day) => {
      const minutes = (day.pairs || []).reduce((total, pair) => total + Number(pair?.actualOvertimeMinutes || 0), 0);
      return sum + (minutes ? quarterHoursFromDailyMinutes([minutes]) || 0 : 0);
    }, 0);
    return Math.round(hours * 100) / 100;
  }
  const key = rounding === 'snap' ? 'snapOvertimeMinutes' : 'roundedOvertimeMinutes';
  const minutes = days.reduce(
    (sum, day) => sum + (day.pairs || []).reduce((total, pair) => total + Number(pair?.[key] || 0), 0),
    0
  );
  return quarterHoursFromMinutes(minutes) || 0;
}

/**
 * @param {number} hours
 * @param {number} multiplier
 */
function overtimeTotalText(hours, multiplier) {
  const shown = (Math.round(Number(hours) * 100) / 100).toFixed(2);
  const factor = Number(multiplier);
  if (!Number.isFinite(factor) || factor === 1) return shown;
  const paid = (Math.round(Number(hours) * factor * 100) / 100).toFixed(2);
  return `${shown} × ${factor} = ${paid}`;
}

/**
 * @param {number} hours
 * @param {number} multiplier
 * @param {'snap' | 'daily' | 'separate'} rounding
 */
function overtimeTotalTip(hours, multiplier, rounding) {
  const shown = (Math.round(Number(hours) * 100) / 100).toFixed(2);
  const basis =
    rounding === 'snap'
      ? 'snap overtime minutes'
      : rounding === 'separate'
        ? 'quarter-hour overtime minutes'
        : 'actual overtime minutes, rounded to the quarter hour each day';
  const factor = Number(multiplier);
  const paid =
    Number.isFinite(factor) && factor !== 1
      ? ` The ${factor} multiplier makes that ${(Math.round(Number(hours) * factor * 100) / 100).toFixed(2)} pay hours.`
      : '';
  return `${shown} overtime hours from the ${basis}.${paid}`;
}

/**
 * @param {number[]} minutes
 */
function minuteList(minutes) {
  const text = minutes.map((value) => String(value));
  if (text.length <= 1) return text[0] || '';
  if (text.length === 2) return `${text[0]} and ${text[1]}`;
  return `${text.slice(0, -1).join(', ')}, and ${text[text.length - 1]}`;
}

/**
 * The minutes that were added for that day's billable hours.
 * @param {{ pairs?: Array<Record<string, unknown>> }} day
 * @param {'snap' | 'daily' | 'separate'} rounding
 */
function billableMinutes(day, rounding) {
  const key = rounding === 'snap' ? 'snapMinutes' : rounding === 'separate' ? 'roundedMinutes' : 'actualMinutes';
  return (day.pairs || [])
    .map((pair) => pair?.[key])
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map((value) => Number(value));
}

/**
 * @param {{ clockedHours?: string, pairs?: Array<Record<string, unknown>> }} day
 * @param {'snap' | 'daily' | 'separate'} rounding
 */
function billableTip(day, rounding) {
  const hours = String(day.clockedHours || '').trim();
  const minutes = billableMinutes(day, rounding);
  if (!hours || !minutes.length) return '';
  const exactHours = minutes.reduce((total, value) => total + value, 0) / 60;
  const shown = Number(hours);
  const rounded = Number.isFinite(shown) && Math.abs(exactHours - shown) > 0.001;
  const tail = rounded ? ', rounded to the nearest quarter hour' : '';
  return `${hours} is the sum of ${minuteList(minutes)} minutes from that day${tail}.`;
}

/**
 * @param {{ residual?: string, contractHours?: string, clockedHours?: string }} day
 */
function exHoursTip(day) {
  const residual = String(day.residual || '').trim();
  const contract = String(day.contractHours || '').trim();
  const clocked = String(day.clockedHours || '').trim();
  if (!residual || !contract || !clocked) return '';
  return `${residual} is the subtraction of ${contract} (contract hours) from ${clocked} (the total billable clock hours).`;
}

/**
 * @param {string} row
 * @param {string} label
 * @param {Array<{ day: number }>} days
 * @param {(day: { day: number, contractHours?: string, residual?: string }) => string} value
 * @param {string} [className]
 * @param {(day: { day: number }) => string} [tipFor]
 */
function mathRow(row, label, days, value, className = '', tipFor) {
  const cells = days
    .map((day) => {
      const tip = tipFor ? String(tipFor(day) || '') : '';
      const attr = tip ? ` data-math="${escapeHtml(tip)}" tabindex="0"` : '';
      return `<td data-row="${row}" data-day="${day.day}"${attr}>${value(day)}</td>`;
    })
    .join('');
  const cls = className ? ` class="${className}"` : '';
  return `<tr${cls}><th scope="row">${escapeHtml(label)}</th>${cells}</tr>`;
}

/**
 * One table. Columns are the days in the pay period.
 * @param {{
 *   driverName?: string,
 *   rounding?: 'snap' | 'daily' | 'separate',
 *   roundClocks?: boolean,
 *   periods?: Array<{
 *     label?: string,
 *     days?: Array<{
 *       day: number,
 *       contractHours?: string,
 *       residual?: string,
 *       pairs?: Array<Record<string, string>>,
 *       unpaired?: Array<{ action?: string, clock?: string, snapped?: string }>,
 *     }>,
 *   }>,
 * }} model
 */
export function renderMonthlySummaryMathHtml(model) {
  const driverName = String(model?.driverName || 'Driver');
  const rounding = normalizeClockRounding(
    model && Object.prototype.hasOwnProperty.call(model, 'rounding') ? model.rounding : model?.roundClocks
  );
  const overtimeRules = normalizeOvertimeRules(model?.overtimeRules);
  const email = String(model?.email || '').trim();
  const periods = Array.isArray(model?.periods) ? model.periods : [];
  const periodLabel = periods.map((period) => period.label).filter(Boolean).join('; ');
  const sheets = periods.map((period) => periodTable(driverName, period, rounding, overtimeRules)).join('');
  const title = `EX DRIVER TIME SUMMARY MATH — ${driverName}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; display: flex; flex-direction: column; overflow-x: hidden; background: #fff; color: #1a1a1a; font: 15px/1.35 "Segoe UI", Candara, sans-serif; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; padding: 0.55rem 0.8rem; background: #fff; border-bottom: 1px solid #d5d0c8; flex: none; }
    .toolbar button { font: inherit; padding: 0.35rem 0.8rem; }
    #mail-note { margin: 0; color: #6b4b16; }
    article { flex: 1 1 auto; width: 100%; min-height: 0; margin: 0; padding: 0.55rem 0.7rem 0.7rem; background: #fff; display: flex; flex-direction: column; }
    h1 { margin: 0; text-align: center; font-size: clamp(16px, 1.6vw, 22px); letter-spacing: 0.04em; }
    .who { margin: 0.2rem 0 0.45rem; text-align: center; }
    .table-scroll { flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto; }
    table { width: 100%; height: auto; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #222; padding: 0.28rem 0.2rem; text-align: center; vertical-align: middle; white-space: normal; overflow-wrap: break-word; font-size: clamp(11px, 1.05vw, 15px); }
    thead th:first-child, tbody th, tfoot th { width: 22%; text-align: left; }
    thead th { background: #f4f4f4; }
    tbody th { background: #fafafa; }
    tr.pair-a th, tr.pair-a td { background: #d7e4f4; }
    tr.pair-b th, tr.pair-b td { background: #f6e4c8; }
    tr.pair-start th, tr.pair-start td { border-top: 4px solid #111; padding-top: 0.85rem; }
    tr.pair-end th, tr.pair-end td { border-bottom: 4px solid #111; padding-bottom: 0.85rem; }
    tr.contract td { background: #f7f4ea; font-weight: 650; }
    tr.used th, tr.used td { background: #ffe08a; font-weight: 700; }
    tr.billable th, tr.billable td { font-weight: 650; }
    tr.ex td, tr.ex th { font-weight: 700; background: #f3f3f3; }
    tr.ot th, tr.ot td { background: #fde8ea; }
    tr.pair-a.ot th, tr.pair-a.ot td { background: #f8d4d8; }
    tr.pair-b.ot th, tr.pair-b.ot td { background: #f8e4cc; }
    tr.ot.used th, tr.ot.used td { background: #ffe08a; font-weight: 700; }
    td[data-math] { cursor: help; }
    #math-hover { position: fixed; z-index: 5; max-width: 18rem; padding: 0.45rem 0.6rem; background: #1c1e22; color: #fff; border-radius: 6px; font-size: 13px; line-height: 1.35; pointer-events: none; box-shadow: 0 8px 20px rgba(0,0,0,0.2); }
    #math-hover[hidden] { display: none; }
    tfoot th, tfoot td { background: #e7e7e7; font-weight: 700; text-align: left; }
    @page { size: letter landscape; margin: 0.4in; }
    @media print {
      html, body { height: auto; display: block; overflow: visible; background: #fff; }
      .toolbar { display: none !important; }
      article { display: block; width: auto; height: auto; min-height: 0; margin: 0; padding: 0; }
      .table-scroll { overflow: visible; }
      table { height: auto; min-height: 0; }
      th, td { font-size: 8pt; padding: 0.12rem 0.08rem; }
      tr.pair-start th, tr.pair-start td { border-top-width: 2px; padding-top: 0.35rem; }
      tr.pair-end th, tr.pair-end td { border-bottom-width: 2px; padding-bottom: 0.35rem; }
      #math-hover { display: none !important; }
    }
  </style>
</head>
<body data-driver-name="${escapeHtml(driverName)}" data-driver-email="${escapeHtml(email)}" data-period="${escapeHtml(periodLabel)}">
  <div class="toolbar">
    <button type="button" id="print">Print</button>
    <button type="button" id="email-driver">Email copy to driver</button>
    <p id="mail-note" role="status"></p>
  </div>
  ${sheets || '<article><p>Choose a pay period that has days in that month.</p></article>'}
  <div id="math-hover" hidden></div>
  <script>
    document.querySelector('#print').addEventListener('click', () => window.print());
    document.querySelector('#email-driver').addEventListener('click', async () => {
      const note = document.querySelector('#mail-note');
      const email = document.body.dataset.driverEmail || '';
      const name = document.body.dataset.driverName || 'Driver';
      const period = document.body.dataset.period || '';
      if (!email) {
        note.textContent = 'Add an email for ' + name + ' on the Driver Name List before sending this summary.';
        return;
      }
      note.textContent = 'Opening the email…';
      try {
        const response = await fetch('/api/email-time-summary-math', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            html: '<!DOCTYPE html>' + document.documentElement.outerHTML,
            email: email,
            name: name,
            period: period,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          note.textContent = payload.error || 'Could not open the email.';
          return;
        }
        note.textContent = 'Opened an email to ' + name + ' with the summary attached.';
      } catch (error) {
        note.textContent = 'Could not open the email.';
      }
    });
    const hover = document.querySelector('#math-hover');
    function placeHover(cell) {
      if (!hover || !cell) return;
      hover.textContent = cell.getAttribute('data-math') || '';
      hover.hidden = false;
      const box = cell.getBoundingClientRect();
      const width = hover.offsetWidth;
      const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
      const below = box.bottom + 6;
      const height = hover.offsetHeight;
      hover.style.left = left + 'px';
      hover.style.top = (below + height > window.innerHeight ? Math.max(8, box.top - height - 6) : below) + 'px';
    }
    function hideHover(event) {
      const cell = event.target.closest ? event.target.closest('[data-math]') : null;
      if (!cell || cell.contains(event.relatedTarget)) return;
      if (hover) hover.hidden = true;
    }
    document.addEventListener('mouseover', (event) => {
      const cell = event.target.closest ? event.target.closest('[data-math]') : null;
      if (cell) placeHover(cell);
    });
    document.addEventListener('mouseout', hideHover);
    document.addEventListener('focusin', (event) => {
      const cell = event.target.closest ? event.target.closest('[data-math]') : null;
      if (cell) placeHover(cell);
    });
    document.addEventListener('focusout', hideHover);
  </script>
</body>
</html>`;
}

/**
 * @param {string} driverName
 * @param {{
 *   label?: string,
 *   days?: Array<{
 *     day: number,
 *     contractHours?: string,
 *     residual?: string,
 *     pairs?: Array<Record<string, string>>,
 *     unpaired?: Array<{ action?: string, clock?: string, snapped?: string }>,
 *   }>,
 * }} period
 * @param {'snap' | 'daily' | 'separate'} rounding
 * @param {ReturnType<typeof normalizeOvertimeRules>} overtimeRules
 */
function periodTable(driverName, period, rounding, overtimeRules) {
  const days = Array.isArray(period.days) ? period.days : [];
  const head = days.map((day) => `<th scope="col">${day.day}</th>`).join('');
  const contract = mathRow('contract', 'Contract hours', days, (day) => escapeHtml(day.contractHours || ''), 'contract');
  const slots = pairSlots(days);
  const clockRows = slots
    .map((slot) => {
      const id = `pair-${slot.index}`;
      const find = (day) => pairAt(day, slot.index);
      const band = slot.index % 2 === 0 ? 'pair-a' : 'pair-b';
      /** @type {Array<'in' | 'out' | 'actual' | 'rounded' | 'snap' | 'actual-ot' | 'rounded-ot' | 'snap-ot'>} */
      const kinds = ['in', 'out', 'actual'];
      if (rounding === 'separate') kinds.push('rounded');
      kinds.push('snap');
      if (slotHasOvertime(days, slot.index)) {
        kinds.push('actual-ot');
        if (rounding === 'separate') kinds.push('rounded-ot');
        if (rounding === 'snap') kinds.push('snap-ot');
      }
      return kinds
        .map((kind, index) => {
          const edge = index === 0 ? 'pair-start' : index === kinds.length - 1 ? 'pair-end' : '';
          const overtime = kind === 'actual-ot' || kind === 'rounded-ot' || kind === 'snap-ot';
          const used =
            (kind === 'rounded' && rounding === 'separate') ||
            (kind === 'snap' && rounding === 'snap') ||
            (kind === 'rounded-ot' && rounding === 'separate') ||
            (kind === 'snap-ot' && rounding === 'snap') ||
            (kind === 'actual-ot' && rounding === 'daily')
              ? 'used'
              : '';
          const className = ['pair', band, edge, overtime ? 'ot' : '', used].filter(Boolean).join(' ');
          const value = (day) => {
            const pair = find(day);
            if (kind === 'in') return escapeHtml(pair?.writtenIn || '');
            if (kind === 'out') return escapeHtml(pair?.writtenOut || '');
            if (kind === 'actual') return minuteText(pair?.actualMinutes);
            if (kind === 'rounded') return minuteText(pair?.roundedMinutes);
            if (kind === 'actual-ot') return overtimeMinuteText(pair, 'actualOvertimeMinutes');
            if (kind === 'rounded-ot') return overtimeMinuteText(pair, 'roundedOvertimeMinutes');
            if (kind === 'snap-ot') return overtimeMinuteText(pair, 'snapOvertimeMinutes');
            return minuteText(pair?.snapMinutes);
          };
          const tipFor = overtime
            ? (day) => overtimeTip(find(day), kind === 'snap-ot' ? 'snapOvertimeMinutes' : 'actualOvertimeMinutes')
            : undefined;
          return mathRow(id + '-' + kind, slotLabel(slot.index, slot.total, kind), days, value, className, tipFor);
        })
        .join('');
    })
    .join('');
  const billable = mathRow(
    'billable',
    'Total billable clock hours',
    days,
    (day) => escapeHtml(day.clockedHours || ''),
    rounding === 'daily' ? 'billable used' : 'billable',
    (day) => billableTip(day, rounding)
  );
  const exHours = mathRow('ex-hours', 'EX HOURS', days, (day) => escapeHtml(day.residual || ''), 'ex', exHoursTip);
  const total = sumExHours(days);
  const overtimeTotal = sumOvertimeHours(days, rounding);
  const overtimeLabel = overtimeTotalText(overtimeTotal, overtimeRules.multiplier);
  const who = [driverName, period.label].filter(Boolean).join(' · ');
  return `<article>
    <h1>EX DRIVER TIME SUMMARY MATH</h1>
    <p class="who">${escapeHtml(who)}</p>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col"></th>
            ${head}
          </tr>
        </thead>
        <tbody>
          ${clockRows}
          ${billable}
          ${contract}
          ${exHours}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total EX HOURS</th>
            <td colspan="${days.length}" data-total="ex-hours">${escapeHtml(total)}</td>
          </tr>
          <tr>
            <th scope="row">Total OT</th>
            <td colspan="${days.length}" data-total="overtime" data-math="${escapeHtml(overtimeTotalTip(overtimeTotal, overtimeRules.multiplier, rounding))}">${escapeHtml(overtimeLabel)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </article>`;
}
