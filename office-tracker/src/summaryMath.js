// Quarter-hour steps behind a Driver Pay period info day cell.
// EX DRIVER is the clocked quarter hours beyond that day's contract hours.
// The table shows contract hours, the clocks, the snap, overtime for each clock and for the day, EX HOURS, and clock notes.
// Pointing at a calculated number shows the math.
// Other pay-status rows are not calculated here.

import { parseClockTime, roundClockToQuarterHour } from '../../src/logic/timeUtils.js';
import { normalizeOvertimeRules } from './overtimeRules.js';
import { quarterHoursFromDailyMinutes, quarterHoursFromMinutes } from './payrollTimes.js';
import { CLOCK_ROUNDING_DAILY, CLOCK_ROUNDING_SNAP, normalizeClockRounding } from '../web/store.js';

function minutesApart(clockIn, clockOut) {
  const start = parseClockTime(clockIn);
  let end = parseClockTime(clockOut);
  if (end < start) end += 24 * 60;
  return end - start;
}

// Hours text used on the summary. Blank, zero, and non-numbers stay blank.
export function formatQuarterHourText(hours) {
  if (hours == null || hours === '' || !Number.isFinite(Number(hours))) return '';
  const snapped = Math.round(Number(hours) * 4) / 4;
  if (!snapped) return '';
  return snapped.toFixed(2);
}

// Written clocks, the clocks the minutes are counted from, and the quarter hours.
// Snapping moves each clock to the nearest quarter hour first.
// Rounding each span keeps the written clocks and rounds that span's minutes.
// Rounding only the daily total keeps the written clocks and leaves the span unrounded.
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

// EX DRIVER for one day on the district summary. Blank when the contract
// hours are missing, or when the clocked time does not go past them.
export function exDriverDayHours(clocked, contractText) {
  const difference = exHoursDifference(clocked, contractText);
  if (!difference || difference.startsWith('-')) return '';
  return difference;
}

// Billable clock hours minus that day's contract hours. Negative when the
// billable hours are under the contract. Blank when either figure is missing,
// and blank when they are equal.
export function exHoursDifference(clocked, contractText) {
  if (clocked == null || !Number.isFinite(Number(clocked))) return '';
  const text = String(contractText ?? '').trim();
  if (!text) return '';
  const contract = Number(text);
  if (!Number.isFinite(contract) || contract <= 0) return '';
  return formatQuarterHourText(Number(clocked) - contract);
}

// File name for the landscape letter PDF attached to the driver email.
export function mathPdfBasename(driverName) {
  const slug = String(driverName ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'driver'}-driver-pay-period-info`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// One slot for each consecutive clock-in and clock-out, in the order they were punched.
function pairSlots(days) {
  const total = days.reduce((max, day) => Math.max(max, (day.pairs || []).length), 0);
  return Array.from({ length: total }, (_, index) => ({ index, total }));
}

function pairAt(day, index) {
  return (day.pairs || [])[index] || null;
}

function slotLabel(index, total, kind) {
  const suffix = total > 1 ? ` ${index + 1}` : '';
  if (kind === 'in') return `Clock In${suffix}`;
  if (kind === 'out') return `Clock Out${suffix}`;
  if (kind === 'rounded-in') return `Rounded clock in${suffix}`;
  if (kind === 'rounded-out') return `Rounded clock out${suffix}`;
  if (kind === 'contract-in') return `Contracted clock in${suffix}`;
  if (kind === 'contract-out') return `Contracted clock out${suffix}`;
  if (kind === 'contract-hours') return `Contracted hours${suffix}`;
  if (kind === 'ex-driver') return `EX DRIVER${suffix}`;
  if (kind === 'actual') return `Actual minutes${suffix}`;
  if (kind === 'rounded') return `Quarter-hour minutes${suffix}`;
  if (kind === 'actual-ot') return `Actual overtime minutes${suffix}`;
  if (kind === 'rounded-ot') return `Quarter-hour overtime minutes${suffix}`;
  if (kind === 'snap-ot') return `Snap overtime minutes${suffix}`;
  return `Snap minutes${suffix}`;
}

function minuteText(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return '';
  return String(minutes);
}

function pairHasOvertime(pair) {
  if (!pair) return false;
  return ['actualOvertimeMinutes', 'roundedOvertimeMinutes', 'snapOvertimeMinutes'].some((key) => Number(pair[key]) > 0);
}

function overtimeMinuteText(pair, key) {
  if (!pairHasOvertime(pair)) return '';
  const minutes = pair?.[key];
  if (minutes == null || !Number.isFinite(Number(minutes))) return '';
  return String(minutes);
}

function clockMinutesFromLabel(clock) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(clock || '').trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = match[3].toUpperCase();
  if (hours > 12 || minutes > 59) return null;
  if (suffix === 'AM') hours = hours === 12 ? 0 : hours;
  else if (hours !== 12) hours += 12;
  return hours * 60 + minutes;
}

function joinList(items) {
  const text = items.map((value) => String(value)).filter(Boolean);
  if (text.length <= 1) return text[0] || '';
  if (text.length === 2) return `${text[0]} and ${text[1]}`;
  return `${text.slice(0, -1).join(', ')}, and ${text[text.length - 1]}`;
}

function snapClockTip(written, rounded) {
  if (!written || !rounded || written === rounded) return '';
  return `${rounded} is ${written} snapped to the nearest quarter hour.`;
}

function spanHoursTip(hours, start, end) {
  const shown = String(hours || '').trim();
  const from = String(start || '').trim();
  const to = String(end || '').trim();
  if (!shown || !from || !to) return '';
  const startMin = clockMinutesFromLabel(from);
  const endMin = clockMinutesFromLabel(to);
  if (startMin == null || endMin == null || endMin <= startMin) return `${shown} is ${to} minus ${from}.`;
  const exact = (endMin - startMin) / 60;
  const rounded = Math.abs(exact - Number(shown)) > 0.001 ? ', rounded to the nearest quarter hour' : '';
  return `${shown} is ${to} minus ${from}${rounded}.`;
}

function minutesApartTip(minutes, start, end) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return '';
  const from = String(start || '').trim();
  const to = String(end || '').trim();
  if (!from || !to) return '';
  return `${minutes} is ${to} minus ${from}.`;
}

function quarterMinuteTip(rounded, actual) {
  if (rounded == null || !Number.isFinite(Number(rounded))) return '';
  const exact = Number(actual);
  if (!Number.isFinite(exact) || exact === Number(rounded)) return '';
  return `${rounded} is ${exact} minutes rounded to the nearest quarter hour.`;
}

function snapMinutesTip(pair) {
  const minutes = pair.snapMinutes;
  if (minutes == null || !Number.isFinite(Number(minutes))) return '';
  const from = String(pair.roundedIn || '').trim();
  const to = String(pair.roundedOut || '').trim();
  if (!from || !to) return '';
  const moved = [];
  const writtenIn = String(pair.writtenIn || '').trim();
  const writtenOut = String(pair.writtenOut || '').trim();
  if (writtenIn && writtenIn !== from) moved.push(`${writtenIn} snapped to ${from}`);
  if (writtenOut && writtenOut !== to) moved.push(`${writtenOut} snapped to ${to}`);
  const base = `${minutes} is ${to} minus ${from}`;
  if (!moved.length) return `${base}.`;
  return `${base}. ${joinList(moved)}.`;
}

// Counted clock hours for one run, in the same rounding EX DRIVER uses.
function countedRunHours(pair, rounding) {
  const minutes = rounding === 'separate' ? Number(pair.roundedMinutes) : Number(pair.snapMinutes);
  if (!Number.isFinite(minutes)) return '';
  return formatQuarterHourText(quarterHoursFromMinutes(minutes));
}

function exDriverTip(pair, rounding) {
  const residual = String(pair.exDriver || '').trim();
  const contract = String(pair.contractHours || '').trim();
  if (!residual || !contract) return '';
  const counted = countedRunHours(pair, rounding);
  if (!counted) return `${residual} is the subtraction of ${contract} contracted hours from the counted clock hours for this run.`;
  return `${residual} is the subtraction of ${contract} (contracted hours) from ${counted} (counted clock hours for this run).`;
}

function overtimeSpanTip(pair, key, start, end) {
  const minutes = Number(pair?.[key]);
  if (!pair || !Number.isFinite(minutes) || minutes <= 0) return '';
  const reasons = key === 'snapOvertimeMinutes' ? pair.snapOvertimeReasons : pair.overtimeReasons;
  const why = Array.isArray(reasons) ? reasons.filter(Boolean).join(', ') : '';
  const because = why ? `: ${why}` : '';
  if (key === 'roundedOvertimeMinutes') {
    const actual = Number(pair.actualOvertimeMinutes);
    if (Number.isFinite(actual) && actual !== minutes) {
      return `${minutes} is ${actual} overtime minutes rounded to the nearest quarter hour${because}.`;
    }
  }
  const from = String(start || '').trim();
  const to = String(end || '').trim();
  if (from && to) return `${minutes} overtime minutes from ${from} to ${to}${because}.`;
  return `${minutes} overtime minutes${because}.`;
}

function pairCellTip(pair, kind, rounding) {
  if (!pair) return '';
  if (kind === 'rounded-in') return snapClockTip(String(pair.writtenIn || ''), String(pair.roundedIn || ''));
  if (kind === 'rounded-out') return snapClockTip(String(pair.writtenOut || ''), String(pair.roundedOut || ''));
  if (kind === 'contract-hours') return spanHoursTip(pair.contractHours, pair.contractIn, pair.contractOut);
  if (kind === 'ex-driver') return exDriverTip(pair, rounding);
  if (kind === 'actual') return minutesApartTip(pair.actualMinutes, pair.writtenIn, pair.writtenOut);
  if (kind === 'rounded') return quarterMinuteTip(pair.roundedMinutes, pair.actualMinutes);
  if (kind === 'snap') return snapMinutesTip(pair);
  if (kind === 'actual-ot') return overtimeSpanTip(pair, 'actualOvertimeMinutes', pair.writtenIn, pair.writtenOut);
  if (kind === 'rounded-ot') return overtimeSpanTip(pair, 'roundedOvertimeMinutes', pair.writtenIn, pair.writtenOut);
  if (kind === 'snap-ot') return overtimeSpanTip(pair, 'snapOvertimeMinutes', pair.roundedIn, pair.roundedOut);
  return '';
}

function slotHasOvertime(days, index) {
  return days.some((day) => pairHasOvertime(pairAt(day, index)));
}

function sumExHours(days) {
  const present = days.map((day) => day.residual).filter((value) => value);
  if (!present.length) return '';
  const total = present.reduce((sum, value) => sum + Number(value), 0);
  if (!Number.isFinite(total)) return '';
  return (Math.round(total * 4) / 4).toFixed(2);
}

// Overtime hours for the pay period, using the rounding method that payroll counts.
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

function overtimeTotalText(hours, multiplier) {
  const shown = (Math.round(Number(hours) * 100) / 100).toFixed(2);
  const factor = Number(multiplier);
  if (!Number.isFinite(factor) || factor === 1) return shown;
  const paid = (Math.round(Number(hours) * factor * 100) / 100).toFixed(2);
  return `${shown} × ${factor} = ${paid}`;
}

// The overtime minutes payroll counts for one day.
function dayOvertimeMinutes(day, rounding) {
  const key = rounding === 'snap' ? 'snapOvertimeMinutes' : rounding === 'separate' ? 'roundedOvertimeMinutes' : 'actualOvertimeMinutes';
  return (day.pairs || []).reduce((total, pair) => total + Number(pair?.[key] || 0), 0);
}

// Overtime hours for one day, using the same rounding as that day's part of the pay-period total.
function dayOvertimeHours(day, rounding) {
  const minutes = dayOvertimeMinutes(day, rounding);
  if (!minutes) return 0;
  if (rounding === 'daily') return quarterHoursFromDailyMinutes([minutes]) || 0;
  return quarterHoursFromMinutes(minutes) || 0;
}

function formatOvertimeHours(hours) {
  if (!hours) return '';
  return (Math.round(hours * 100) / 100).toFixed(2);
}

function overtimeMinuteName(rounding) {
  if (rounding === 'snap') return 'snap overtime minutes';
  if (rounding === 'separate') return 'quarter-hour overtime minutes';
  return 'actual overtime minutes';
}

function dayOvertimeTip(day, rounding) {
  const key = rounding === 'snap' ? 'snapOvertimeMinutes' : rounding === 'separate' ? 'roundedOvertimeMinutes' : 'actualOvertimeMinutes';
  const parts = (day.pairs || [])
    .map((pair) => {
      const minutes = Number(pair?.[key] || 0);
      if (!minutes) return null;
      const from = String((rounding === 'snap' ? pair.roundedIn : pair.writtenIn) || '').trim();
      const to = String((rounding === 'snap' ? pair.roundedOut : pair.writtenOut) || '').trim();
      return { minutes, from, to };
    })
    .filter(Boolean);
  if (!parts.length) return '';
  const hours = formatOvertimeHours(dayOvertimeHours(day, rounding));
  const noun = overtimeMinuteName(rounding);
  const exact = parts.reduce((total, part) => total + part.minutes, 0);
  const rounded = rounding === 'daily' && Math.abs(exact / 60 - Number(hours)) > 0.001 ? ', rounded to the nearest quarter hour' : '';
  if (parts.length === 1) {
    const span = parts[0].from && parts[0].to ? ` from ${parts[0].from} to ${parts[0].to}` : '';
    return `${hours} is ${parts[0].minutes} ${noun}${span}${rounded}.`;
  }
  return `${hours} is the sum of ${joinList(parts.map((part) => String(part.minutes)))} ${noun}${rounded}.`;
}

function overtimeTotalTip(days, hours, multiplier, rounding) {
  const shown = (Math.round(Number(hours) * 100) / 100).toFixed(2);
  const noun = overtimeMinuteName(rounding);
  const pieces = days
    .map((day) => {
      const minutes = dayOvertimeMinutes(day, rounding);
      return minutes ? `${minutes} on day ${day.day}` : '';
    })
    .filter(Boolean);
  const minuteSum = days.reduce((total, day) => total + dayOvertimeMinutes(day, rounding), 0);
  let basis;
  if (!minuteSum) {
    basis = `${shown} overtime hours. No clock in this pay period has overtime minutes.`;
  } else if (rounding === 'daily') {
    basis = `${shown} overtime hours is ${minuteSum} ${noun} (${joinList(pieces)}), rounded to the quarter hour on each day and then added.`;
  } else {
    basis = `${shown} overtime hours is ${minuteSum} ${noun} (${joinList(pieces)}), rounded to the nearest quarter hour.`;
  }
  const factor = Number(multiplier);
  const paid =
    Number.isFinite(factor) && factor !== 1
      ? ` The ${factor} multiplier makes that ${(Math.round(Number(hours) * factor * 100) / 100).toFixed(2)} pay hours.`
      : '';
  return `${basis}${paid}`;
}

function minuteList(minutes) {
  return joinList(minutes.map((value) => String(value)));
}

// The minutes that were added for that day's billable hours.
function billableMinutes(day, rounding) {
  const key = rounding === 'snap' ? 'snapMinutes' : rounding === 'separate' ? 'roundedMinutes' : 'actualMinutes';
  return (day.pairs || [])
    .map((pair) => pair?.[key])
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map((value) => Number(value));
}

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

function exHoursTip(day) {
  const residual = String(day.residual || '').trim();
  const contract = String(day.contractHours || '').trim();
  const clocked = String(day.clockedHours || '').trim();
  if (!residual || !contract || !clocked) return '';
  return `${residual} is the subtraction of ${contract} (contract hours) from ${clocked} (the total billable clock hours).`;
}

function contractDayTip(day) {
  const hours = String(day.contractHours || '').trim();
  if (!hours) return '';
  const runs = (day.routes || []).flatMap((route) => route.runs || []).filter((run) => String(run.hours || '').trim());
  if (runs.length === 1) return spanHoursTip(hours, runs[0].writtenIn, runs[0].writtenOut);
  if (runs.length > 1) {
    const parts = runs.map((run) => {
      const label = String(run.label || '').trim();
      return label ? `${run.hours} ${label}` : String(run.hours);
    });
    const sum = runs.reduce((total, run) => total + Number(run.hours), 0);
    const rounded = Math.abs(sum - Number(hours)) > 0.001 ? ', rounded to the nearest quarter hour' : '';
    return `${hours} is the sum of ${joinList(parts)}${rounded}.`;
  }
  return `${hours} is this day's contracted hours.`;
}

function exHoursTotalTip(days, total) {
  if (!total) return '';
  const parts = days.map((day) => String(day.residual || '').trim()).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return `${total} is the EX HOURS for that day.`;
  return `${total} is the sum of ${joinList(parts)} from the EX HOURS row.`;
}

// Distinct greens, light enough to keep black text readable.
// Day totals are placed at opposite ends so a contract change stands out.
const CONTRACT_GREENS = ['#e5f7ea', '#c9f0d2', '#a3e4b4', '#6fd492', '#3ec06c', '#17924a'];

function uniqueHours(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort(
    (a, b) => Number(a) - Number(b) || a.localeCompare(b)
  );
}

function spreadSlots(count, available) {
  const used = [];
  for (let index = 0; index < count; index += 1) {
    const ideal =
      count === 1
        ? available[Math.floor((available.length - 1) / 2)]
        : available[Math.round((index * (available.length - 1)) / (count - 1))];
    const slot = used.includes(ideal) ? available.find((item) => !used.includes(item)) ?? ideal : ideal;
    used.push(slot);
  }
  return used;
}

// One green when every contract-hour figure matches. A different shade for each different figure.
// The day's contract hours are spaced across the palette first, so 5.75 and 6.50 do not share a shade.
function contractGreenStyles(days) {
  const dayValues = uniqueHours(days.map((day) => day.contractHours));
  const pairValues = uniqueHours(days.flatMap((day) => (day.pairs || []).map((pair) => pair?.contractHours))).filter(
    (value) => !dayValues.includes(value)
  );
  const styles = new Map();
  if (dayValues.length + pairValues.length <= 1) {
    const only = dayValues[0] || pairValues[0];
    if (only) styles.set(only, 'background:#b7e4c7');
    return styles;
  }
  const daySlots = spreadSlots(
    dayValues.length,
    CONTRACT_GREENS.map((_, index) => index)
  );
  dayValues.forEach((value, index) => styles.set(value, `background:${CONTRACT_GREENS[daySlots[index]]}`));
  const free = CONTRACT_GREENS.map((_, index) => index).filter((index) => !daySlots.includes(index));
  const pairSlots = spreadSlots(pairValues.length, free.length ? free : CONTRACT_GREENS.map((_, index) => index));
  pairValues.forEach((value, index) => styles.set(value, `background:${CONTRACT_GREENS[pairSlots[index]]}`));
  return styles;
}

function contractGreen(shades, value) {
  return shades.get(String(value || '').trim()) || '';
}

function mathRow(row, label, days, value, className = '', tipFor, styleFor) {
  const cells = days
    .map((day) => {
      const tip = tipFor ? String(tipFor(day) || '') : '';
      const style = styleFor ? String(styleFor(day) || '') : '';
      const attr = [
        tip ? `data-math="${escapeHtml(tip)}" tabindex="0"` : '',
        style ? `style="${escapeHtml(style)}"` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<td data-row="${row}" data-day="${day.day}"${attr ? ` ${attr}` : ''}>${value(day)}</td>`;
    })
    .join('');
  const cls = className ? ` class="${className}"` : '';
  return `<tr${cls}><th scope="row">${escapeHtml(label)}</th>${cells}</tr>`;
}

// One table. Columns are the days in the pay period.
export function renderMonthlySummaryMathHtml(model) {
  const driverName = String(model?.driverName || 'Driver');
  const email = String(model?.email || '').trim();
  const periods = Array.isArray(model?.periods) ? model.periods : [];
  const periodLabel = periods.map((period) => period.label).filter(Boolean).join('; ');
  const sheets = payPeriodInfoMarkup(model);
  const title = `Driver Pay period info — ${driverName}`;
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
    tr.holidays th { background: #f7f4ea; }
    tr.holidays th.is-holiday { writing-mode: vertical-rl; text-orientation: mixed; white-space: nowrap; overflow-wrap: normal; word-break: keep-all; background: #fde8ea; font-weight: 700; font-size: 12px; letter-spacing: 0.03em; padding: 0.45rem 0.1rem; }
    tr.weekdays th { font-weight: 700; letter-spacing: 0; padding: 0.18rem 0; }
    tr.weekdays th:not(:first-child) { white-space: nowrap; font-size: clamp(8px, 0.85vw, 12px); }
    tr.weekdays th:first-child { white-space: normal; }
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
    tr.replaced th, tr.replaced td { background: #f6f1e6; color: #4e463c; }
    tr.replaced s { text-decoration: line-through; }
    tr.ot.used th, tr.ot.used td { background: #ffe08a; font-weight: 700; }
    td[data-math] { cursor: help; }
    #math-hover { position: fixed; z-index: 5; max-width: 22rem; padding: 0.45rem 0.6rem; background: #1c1e22; color: #fff; border-radius: 6px; font-size: 13px; line-height: 1.35; pointer-events: none; box-shadow: 0 8px 20px rgba(0,0,0,0.2); }
    #math-hover[hidden] { display: none; }
    tfoot th, tfoot td { background: #e7e7e7; font-weight: 700; text-align: left; }
    .clock-notes { flex: none; max-height: 32vh; margin-top: 0.55rem; padding-top: 0.4rem; border-top: 2px solid #222; overflow: auto; text-align: left; }
    .clock-notes h2 { margin: 0 0 0.3rem; font-size: 14px; letter-spacing: 0.04em; }
    .clock-notes ul { margin: 0; padding: 0; list-style: none; }
    .clock-notes li { margin: 0.18rem 0; }
    .clock-notes .note-when { font-weight: 650; }
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
      .clock-notes { max-height: none; overflow: visible; }
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

// Clock notes and contract-change notes for the admin, in day order.
function clockNotesSection(days) {
  const items = [];
  for (const day of days) {
    const label = String(day.dateLabel || day.day);
    for (const note of day.notes || []) {
      const text = String(note?.text || '').trim();
      if (!text) continue;
      items.push({ label, when: String(note.when || '').trim(), text });
    }
  }
  if (!items.length) return '';
  const rows = items
    .map((item) => {
      const when = item.when ? `<span class="note-when">${escapeHtml(item.label)} · ${escapeHtml(item.when)}</span> ` : `<span class="note-when">${escapeHtml(item.label)}</span> `;
      return `<li>${when}${escapeHtml(item.text)}</li>`;
    })
    .join('');
  return `<section class="clock-notes"><h2>Clock notes</h2><ul>${rows}</ul></section>`;
}

// The pay-period tables, including clock notes, without the printable page chrome.
export function payPeriodInfoMarkup(model) {
  const driverName = String(model?.driverName || 'Driver');
  const rounding = normalizeClockRounding(
    model && Object.prototype.hasOwnProperty.call(model, 'rounding') ? model.rounding : model?.roundClocks
  );
  const overtimeRules = normalizeOvertimeRules(model?.overtimeRules);
  const periods = Array.isArray(model?.periods) ? model.periods : [];
  return periods.map((period) => periodTable(driverName, period, rounding, overtimeRules)).join('');
}

// One row for each earlier clock time a later punch replaced.
// The counted time stays on Clock In or Clock Out. This cell keeps the old time.
function earlierClockRows(days) {
  return ['in', 'out']
    .map((action) => {
      const total = days.reduce((max, day) => {
        const count = (day.replacedClocks || []).filter((item) => item?.action === action && item.clock).length;
        return Math.max(max, count);
      }, 0);
      return Array.from({ length: total }, (_, index) => {
        const suffix = total > 1 ? ` ${index + 1}` : '';
        const label = action === 'out' ? `Earlier clock out${suffix}` : `Earlier clock in${suffix}`;
        const noun = action === 'out' ? 'clock out' : 'clock in';
        return mathRow(
          `earlier-${action}-${index}`,
          label,
          days,
          (day) => {
            const item = (day.replacedClocks || []).filter((entry) => entry?.action === action && entry.clock)[index];
            return item?.clock ? `<s>${escapeHtml(item.clock)}</s>` : '';
          },
          'replaced',
          (day) => {
            const item = (day.replacedClocks || []).filter((entry) => entry?.action === action && entry.clock)[index];
            if (!item?.clock) return '';
            return `${item.clock} is an earlier ${noun}. It is not counted. The later time on this day is the one that counts. Remove that later time in Clock records if this is the real one.`;
          }
        );
      }).join('');
    })
    .join('');
}

function periodTable(driverName, period, rounding, overtimeRules) {
  const days = Array.isArray(period.days) ? period.days : [];
  const holidays = days
    .map((day) => {
      const name = String(day.holiday || '').trim();
      const mark = name ? ' class="is-holiday"' : '';
      const tip = name ? ` title="${escapeHtml(name)}"` : '';
      return `<th scope="col" data-day="${day.day}"${mark}${tip}>${escapeHtml(name)}</th>`;
    })
    .join('');
  const weekdays = days
    .map((day) => `<th scope="col" data-day="${day.day}">${escapeHtml(day.weekday || '')}</th>`)
    .join('');
  const head = days.map((day) => `<th scope="col">${day.day}</th>`).join('');
  const shades = contractGreenStyles(days);
  const contract = mathRow(
    'contract',
    'Contract hours',
    days,
    (day) => escapeHtml(day.contractHours || ''),
    'contract',
    contractDayTip,
    (day) => contractGreen(shades, day.contractHours)
  );
  const slots = pairSlots(days);
  const clockRows = slots
    .map((slot) => {
      const id = `pair-${slot.index}`;
      const find = (day) => pairAt(day, slot.index);
      const band = slot.index % 2 === 0 ? 'pair-a' : 'pair-b';
      const kinds = ['in', 'out', 'rounded-in', 'rounded-out', 'contract-in', 'contract-out', 'contract-hours', 'ex-driver', 'actual'];
      if (rounding === 'separate') kinds.push('rounded');
      kinds.push('snap');
      if (slotHasOvertime(days, slot.index) || rounding === 'daily') kinds.push('actual-ot');
      if (rounding === 'separate') kinds.push('rounded-ot');
      if (rounding === 'snap') kinds.push('snap-ot');
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
          const className = [
            'pair',
            band,
            edge,
            overtime ? 'ot' : '',
            used,
            kind === 'contract-in' || kind === 'contract-out' || kind === 'contract-hours' ? 'contract' : '',
            kind === 'ex-driver' ? 'ex' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const value = (day) => {
            const pair = find(day);
            if (kind === 'in') return escapeHtml(pair?.writtenIn || '');
            if (kind === 'out') return escapeHtml(pair?.writtenOut || '');
            if (kind === 'rounded-in') return escapeHtml(pair?.roundedIn || '');
            if (kind === 'rounded-out') return escapeHtml(pair?.roundedOut || '');
            if (kind === 'contract-in') return escapeHtml(pair?.contractIn || '');
            if (kind === 'contract-out') return escapeHtml(pair?.contractOut || '');
            if (kind === 'contract-hours') return escapeHtml(pair?.contractHours || '');
            if (kind === 'ex-driver') return escapeHtml(pair?.exDriver || '');
            if (kind === 'actual') return minuteText(pair?.actualMinutes);
            if (kind === 'rounded') return minuteText(pair?.roundedMinutes);
            if (kind === 'actual-ot') return overtimeMinuteText(pair, 'actualOvertimeMinutes');
            if (kind === 'rounded-ot') return overtimeMinuteText(pair, 'roundedOvertimeMinutes');
            if (kind === 'snap-ot') return overtimeMinuteText(pair, 'snapOvertimeMinutes');
            return minuteText(pair?.snapMinutes);
          };
          const tipFor = (day) => pairCellTip(find(day), kind, rounding);
          const styleFor =
            kind === 'contract-hours' ? (day) => contractGreen(shades, find(day)?.contractHours) : undefined;
          return mathRow(id + '-' + kind, slotLabel(slot.index, slot.total, kind), days, value, className, tipFor, styleFor);
        })
        .join('');
    })
    .join('');
  const earlier = earlierClockRows(days);
  const billable = mathRow(
    'billable',
    'Total billable clock hours',
    days,
    (day) => escapeHtml(day.clockedHours || ''),
    rounding === 'daily' ? 'billable used' : 'billable',
    (day) => billableTip(day, rounding)
  );
  const exHours = mathRow('ex-hours', 'EX HOURS', days, (day) => escapeHtml(day.residual || ''), 'ex', exHoursTip);
  const dailyOt = mathRow(
    'daily-ot',
    'OT',
    days,
    (day) => escapeHtml(formatOvertimeHours(dayOvertimeHours(day, rounding))),
    'ot',
    (day) => dayOvertimeTip(day, rounding)
  );
  const total = sumExHours(days);
  const overtimeTotal = sumOvertimeHours(days, rounding);
  const overtimeLabel = overtimeTotalText(overtimeTotal, overtimeRules.multiplier);
  const exTotalTip = exHoursTotalTip(days, total);
  const who = [driverName, period.label].filter(Boolean).join(' · ');
  return `<article>
    <h1>Driver Pay period info</h1>
    <p class="who">${escapeHtml(who)}</p>
    <div class="table-scroll">
      <table>
        <thead>
          <tr class="holidays">
            <th scope="row">Holiday</th>
            ${holidays}
          </tr>
          <tr class="weekdays">
            <th scope="row">Day of the week</th>
            ${weekdays}
          </tr>
          <tr>
            <th scope="col"></th>
            ${head}
          </tr>
        </thead>
        <tbody>
          ${clockRows}
          ${earlier}
          ${billable}
          ${contract}
          ${exHours}
          ${dailyOt}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total EX HOURS</th>
            <td colspan="${days.length}" data-total="ex-hours"${exTotalTip ? ` data-math="${escapeHtml(exTotalTip)}" tabindex="0"` : ''}>${escapeHtml(total)}</td>
          </tr>
          <tr>
            <th scope="row">Total OT</th>
            <td colspan="${days.length}" data-total="overtime" data-math="${escapeHtml(overtimeTotalTip(days, overtimeTotal, overtimeRules.multiplier, rounding))}">${escapeHtml(overtimeLabel)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    ${clockNotesSection(days)}
  </article>`;
}
