import { inferDefaultYear, toLocalWallIso } from './timesheetNormalize.js';
import { snapRoundedForRow } from './timesheetSnap.js';
import { overtimeForPairs, pairOvertimeKey } from './overtimeRules.js';
import { regOtGapHours } from './summaryMath.js';
import { localDateKey } from '../../src/logic/timesheets.js';

function roundHours(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Split each row's Tot. Hrs. into Reg and OT using office overtime rules.
 * Walks Front then Back rows in clock order so daily/weekly banks accumulate.
 *
 * When `contractedByDay` has that day's contracted hours, Reg + OT become only
 * the residual past contract (Tot. Hrs. minus contract when clocks ran long).
 * At or under contract both are cleared. The overtime rules still decide how
 * any residual splits between Reg and OT.
 *
 * Mutates hours_regular / hours_overtime on each row. Rows without a Tot. Hrs.
 * (blank, illegible, handwriting) get both cleared.
 *
 * @param {object[][]} rowLists  e.g. [front_rows, back_rows]
 * @param {{
 *   breaks?: object | null,
 *   rules?: object | null,
 *   holidays?: { date: string, label?: string }[] | null,
 *   defaultYear?: number | null,
 *   mode?: string | null,
 *   contractedByDay?: Map<string, string> | Record<string, string> | null,
 * }} [options]
 */
export function splitTotHoursIntoRegOt(rowLists, options = {}) {
  const breaks = options.breaks;
  const year = options.defaultYear ?? inferDefaultYear(null);
  const mode = options.mode;
  const lists = (Array.isArray(rowLists) ? rowLists : []).filter(Array.isArray);
  /** @type {{ row: object, start: Date, end: Date, totHours: number, key: string }[]} */
  const ready = [];

  for (const rows of lists) {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row || typeof row !== 'object') continue;
      if (row.crossed_out) {
        row.hours_regular = null;
        row.hours_overtime = null;
        continue;
      }
      const snapped = snapRoundedForRow(row, breaks, year, mode);
      const totHours = snapped.totalHours;
      const start = snapped.spanStart;
      const end = snapped.spanEnd;
      if (totHours == null || !start || !end || end.getTime() <= start.getTime()) {
        row.hours_regular = null;
        row.hours_overtime = null;
        continue;
      }
      const key = `genie|${lists.indexOf(rows)}|${index}|${start.toISOString()}|${end.toISOString()}`;
      ready.push({ row, start, end, totHours, key });
    }
  }

  const pairs = ready.map((item) => ({
    start: item.start,
    end: item.end,
    clockIn: { id: `${item.key}|in` },
    clockOut: { id: `${item.key}|out` },
    _key: item.key,
  }));
  const overtimeByPair = overtimeForPairs(pairs, options.rules, options.holidays);
  const byKey = new Map(ready.map((item) => [item.key, item]));

  for (const pair of pairs) {
    const item = byKey.get(pair._key);
    if (!item) continue;
    const counted = overtimeByPair.get(pairOvertimeKey(pair));
    const otMinutes = counted?.actual ?? 0;
    let otHours = roundHours(otMinutes / 60);
    if (otHours > item.totHours) otHours = item.totHours;
    if (otHours < 0) otHours = 0;
    const regHours = roundHours(item.totHours - otHours);
    item.row.hours_regular = regHours;
    item.row.hours_overtime = otHours;
  }

  scaleRegOtToContractGap(ready, options.contractedByDay);
}

function contractedHoursOn(contractedByDay, key) {
  if (!contractedByDay) return '';
  if (typeof contractedByDay.get === 'function') return contractedByDay.get(key) || '';
  return contractedByDay[key] || '';
}

// Resize each day's Reg and OT to the residual past contract only.
// gap = contract − Tot: positive/zero → under or even → clear Reg/OT;
// negative → clocks ran long → one Reg/OT combo for the date (first clocked
// row), using the day's overtime mix. Office practice is one figure per date,
// not a share on every Clock Record line.
// Days with no contracted hours keep the overtime split of Tot. Hrs.
function scaleRegOtToContractGap(ready, contractedByDay) {
  if (!contractedByDay) return;
  /** @type {Map<string, typeof ready>} */
  const byDay = new Map();
  for (const item of ready) {
    const key = localDateKey(item.start);
    const list = byDay.get(key) || [];
    list.push(item);
    byDay.set(key, list);
  }
  for (const [key, items] of byDay) {
    const tot = roundHours(items.reduce((sum, item) => sum + item.totHours, 0));
    const gap = regOtGapHours(contractedHoursOn(contractedByDay, key), tot);
    if (gap == null) continue;
    // At or under contract — nothing belongs in Reg / OT.
    if (gap >= 0) {
      for (const item of items) {
        item.row.hours_regular = null;
        item.row.hours_overtime = null;
      }
      continue;
    }
    const residual = roundHours(-gap);
    let regSum = 0;
    let otSum = 0;
    for (const item of items) {
      const priorReg = Number(item.row.hours_regular);
      const priorOt = Number(item.row.hours_overtime);
      if (Number.isFinite(priorReg)) regSum += priorReg;
      if (Number.isFinite(priorOt)) otSum += priorOt;
    }
    const parts = Math.abs(regSum) + Math.abs(otSum);
    let dayReg;
    let dayOt;
    if (parts < 0.001) {
      dayReg = residual;
      dayOt = 0;
    } else {
      const regRatio = Math.abs(regSum) / parts;
      dayReg = roundHours(Math.round(residual * regRatio * 4) / 4);
      dayOt = roundHours(Math.round((residual - dayReg) * 4) / 4);
    }
    items.forEach((item, index) => {
      if (index === 0) {
        item.row.hours_regular = Number.isFinite(dayReg) && dayReg !== 0 ? dayReg : null;
        item.row.hours_overtime = Number.isFinite(dayOt) && dayOt !== 0 ? dayOt : null;
      } else {
        item.row.hours_regular = null;
        item.row.hours_overtime = null;
      }
    });
  }
}

/**
 * Turn Genie card Out/In stamps into clock punches for Monthly Time Summary.
 * Uses the same leave→return span as Tot. Hrs. Carries pay_status / pay_portions
 * from each card row when the desk has assigned them.
 * @param {object | null | undefined} extraction
 * @param {object | null | undefined} breaks
 * @param {number | null | undefined} defaultYear
 * @param {string} driverName
 * @param {string | null | undefined} [mode]
 * @param {string | null | undefined} [defaultPayStatus]
 */
export function punchesFromCardExtraction(
  extraction,
  breaks,
  defaultYear,
  driverName,
  mode,
  defaultPayStatus
) {
  const year = defaultYear ?? inferDefaultYear(extraction?.header?.date_on_card);
  const name = String(driverName || extraction?.header?.employee_name || 'Driver').trim() || 'Driver';
  const fallbackStatus = String(defaultPayStatus || '').trim() || 'reg-driver';
  const punches = [];
  let seq = 1;
  const sides = [
    ['front', extraction?.front_rows],
    ['back', extraction?.back_rows],
  ];
  for (const [side, rows] of sides) {
    if (!Array.isArray(rows)) continue;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row || row.crossed_out) continue;
      const snapped = snapRoundedForRow(row, breaks, year, mode);
      const start = snapped.spanStart;
      const end = snapped.spanEnd;
      if (snapped.totalHours == null || !start || !end || end.getTime() <= start.getTime()) continue;
      const base = `genie-${side}-${index + 1}-${seq}`;
      seq += 1;
      const payStatus = String(row.pay_status || '').trim() || fallbackStatus;
      const clockIn = {
        id: `${base}-in`,
        driver_name: name,
        action: 'in',
        punched_at: toLocalWallIso(start),
        pay_status: payStatus,
      };
      if (Array.isArray(row.pay_portions) && row.pay_portions.length) {
        clockIn.pay_portions = row.pay_portions;
      }
      punches.push(clockIn);
      punches.push({
        id: `${base}-out`,
        driver_name: name,
        action: 'out',
        punched_at: toLocalWallIso(end),
      });
    }
  }
  return punches;
}
