/**
 * District Monthly Time Summary. Each sheet is one pay period.
 * The usual periods are the 1st–15th and the 16th through the end
 * of the month. The office can set different calendar days, including
 * one sheet for the whole month. Completed clock pairs fill the pay
 * status recorded on the clock in. A pair with no status fills REG DRIVER.
 * EX DRIVER is the clocked quarter hours beyond that day's contract hours.
 * Other pay-status rows keep their existing calculation.
 * Each day column shows the regular contracted hours in effect that day.
 * Those hours come from Time Changes and change when a contracted date
 * falls inside the pay period.
 */

import { formatClockAmPm } from '../../employee-tracker/src/clockTimes.js';
import { roundClockToQuarterHour } from '../../src/logic/timeUtils.js';
import { localDateKey, pairClockPunches, runForClockPair } from '../../src/logic/timesheets.js';
import { isPayLineId, normalizeClockPayDefaults, normalizeDriverPay, normalizeTimeSummaryEdits } from './driverPay.js';
import { payrollDriverRows, payrollRowsForDriver, quarterHoursFromDailyMinutes, sumRoundedQuarterHours } from './payrollTimes.js';
import { overtimeForPairs, pairOvertimeKey } from './overtimeRules.js';
import { clockQuarterStep, exDriverDayHours, exHoursDifference, formatQuarterHourText } from './summaryMath.js';
import { CLOCK_ROUNDING_DAILY, CLOCK_ROUNDING_SNAP, normalizeClockRounding } from '../web/store.js';

/**
 * @param {string} value
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {Date} date
 */
function clockFromDate(date) {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Day 31 means the last day that month actually has.
 * @param {number} year
 * @param {number} monthIndex
 * @param {{ id: string, startDay: number, endDay: number }} period
 */
function datesForPayPeriod(year, monthIndex, period) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const end = Math.min(period.endDay, lastDay);
  if (period.startDay > end) return [];
  /** @type {Date[]} */
  const dates = [];
  for (let day = period.startDay; day <= end; day += 1) dates.push(new Date(year, monthIndex, day));
  return dates;
}

/**
 * @param {number} year
 * @param {number} monthIndex
 * @param {{ id: string, startDay: number, endDay: number }} period
 */
function describePeriod(year, monthIndex, period) {
  const dates = datesForPayPeriod(year, monthIndex, period);
  if (!dates.length) return null;
  const last = dates[dates.length - 1];
  const monthName = dates[0].toLocaleString('en-US', { month: 'long' });
  const month = String(last.getMonth() + 1).padStart(2, '0');
  const day = String(last.getDate()).padStart(2, '0');
  return {
    id: period.id,
    key: `${year}-${String(monthIndex + 1).padStart(2, '0')}-${period.id}`,
    label: `${monthName} ${dates[0].getDate()}–${last.getDate()}, ${year}`,
    ending: `${month}/${day}/${last.getFullYear()}`,
    dates,
    days: dates.map((date) => date.getDate()),
    startDay: period.startDay,
  };
}

/**
 * @param {number} year
 * @param {number} monthIndex
 * @param {{ id: string, startDay: number, endDay: number }} period
 */
export function describePayPeriod(year, monthIndex, period) {
  const row = describePeriod(year, monthIndex, period);
  if (!row) return null;
  return { id: row.id, key: row.key, label: row.label, ending: row.ending, days: row.days };
}

/**
 * @param {Date} date
 * @param {Array<{ id: string, startDay: number, endDay: number }>} periods
 */
function periodForDate(date, periods) {
  const day = date.getDate();
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return periods.find((period) => day >= period.startDay && day <= Math.min(period.endDay, lastDay)) || null;
}

/**
 * @param {number} year
 * @param {number} monthIndex
 * @param {number} startDay
 */
function periodOrdinal(year, monthIndex, startDay) {
  return year * 400 + monthIndex * 32 + startDay;
}

/**
 * Pay periods from the earliest punch through the period that contains `now`.
 * Newest first. With no punches, only the periods in the current month up through today.
 * @param {Array<{ punched_at?: string }>} punches
 * @param {Array<{ id: string, startDay: number, endDay: number }>} periods
 * @param {Date} now
 */
function listCoveredPeriods(punches, periods, now) {
  let start = new Date(now.getFullYear(), now.getMonth(), 1);
  for (const punch of punches) {
    if (punch?.removed === true) continue;
    const date = new Date(punch?.punched_at);
    if (Number.isNaN(date.getTime())) continue;
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    if (monthStart < start) start = monthStart;
  }
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  if (start > end) start = end;
  const cutoff = periodOrdinal(now.getFullYear(), now.getMonth(), now.getDate());
  /** @type {NonNullable<ReturnType<typeof describePeriod>>[]} */
  const rows = [];
  for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
    for (const period of periods) {
      const row = describePeriod(cursor.getFullYear(), cursor.getMonth(), period);
      if (!row) continue;
      if (periodOrdinal(cursor.getFullYear(), cursor.getMonth(), period.startDay) > cutoff) continue;
      rows.push(row);
    }
  }
  return rows.reverse();
}

/**
 * Every configured pay period from the earliest clock through the end of the
 * current month, newest first. A period later this month stays on the list.
 * With no clocks, the list is this month only.
 * @param {Array<{ punched_at?: string }>} punches
 * @param {Array<{ id: string, startDay: number, endDay: number }>} periods
 * @param {Date} now
 */
export function payPeriodsForClocks(punches, periods, now) {
  let start = new Date(now.getFullYear(), now.getMonth(), 1);
  for (const punch of punches) {
    if (punch?.removed === true) continue;
    const date = new Date(punch?.punched_at);
    if (Number.isNaN(date.getTime())) continue;
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    if (monthStart < start) start = monthStart;
  }
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  if (start > end) start = end;
  /** @type {NonNullable<ReturnType<typeof describePeriod>>[]} */
  const rows = [];
  for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
    for (const period of periods) {
      const row = describePeriod(cursor.getFullYear(), cursor.getMonth(), period);
      if (row) rows.push(row);
    }
  }
  return rows.reverse().map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    ending: row.ending,
    days: row.days,
  }));
}

/**
 * Pay periods in which this driver already has a clock, newest first.
 * @param {Array<{ punched_at?: string }>} punches
 * @param {Array<{ id: string, startDay: number, endDay: number }>} periods
 * @param {Date} [now]
 */
export function mathPeriodsWithPunches(punches, periods, now = new Date()) {
  const listed = payPeriodsForClocks(punches || [], periods || [], now);
  const keys = new Set();
  for (const punch of punches || []) {
    if (punch?.removed === true) continue;
    const date = new Date(punch?.punched_at);
    if (Number.isNaN(date.getTime())) continue;
    const day = date.getDate();
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const period = (periods || []).find(
      (item) => day >= item.startDay && day <= Math.min(item.endDay, lastDay)
    );
    if (!period) continue;
    keys.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${period.id}`);
  }
  return listed.filter((row) => keys.has(row.key));
}

/**
 * @param {number | null | undefined} hours
 */
function formatCalculated(hours) {
  if (hours == null || !Number.isFinite(Number(hours))) return '';
  const snapped = Math.round(Number(hours) * 4) / 4;
  if (!snapped) return '';
  return snapped.toFixed(2);
}

/**
 * @param {string[]} values
 */
function totalOf(values) {
  const present = values.filter((value) => value !== '');
  if (!present.length) return '';
  const sum = present.reduce((total, value) => total + Number(value), 0);
  if (!Number.isFinite(sum)) return '';
  return (Math.round(sum * 4) / 4).toFixed(2);
}

/**
 * @param {number | null | undefined} hours
 */
function formatContracted(hours) {
  return formatQuarterHourText(hours);
}

/**
 * The office choice. `true` snaps clocks. `false` is the older off switch.
 * A missing choice snaps each clock.
 * @param {{ rounding?: string, roundClocks?: boolean | string } | null | undefined} options
 */
function roundingFrom(options) {
  if (options && Object.prototype.hasOwnProperty.call(options, 'rounding')) {
    return normalizeClockRounding(options.rounding);
  }
  if (options && Object.prototype.hasOwnProperty.call(options, 'roundClocks')) {
    return normalizeClockRounding(options.roundClocks);
  }
  return CLOCK_ROUNDING_SNAP;
}

/**
 * Quarter hours for one day. Daily rounding adds the minutes first.
 * The other choices add figures that are already on a quarter hour.
 * @param {Array<number | null | undefined>} values
 * @param {'snap' | 'daily' | 'separate'} rounding
 */
function dayHours(values, rounding) {
  if (rounding === CLOCK_ROUNDING_DAILY) return quarterHoursFromDailyMinutes(values);
  return sumRoundedQuarterHours(values);
}

/**
 * Schedule rows dated after `asOf` have not happened yet. Leaving them in
 * would let a later review window rewrite the contract hours of earlier days.
 * @param {object | null | undefined} officeState
 * @param {string} asOf
 */
function officeStateOnDate(officeState, asOf) {
  /** @type {Record<string, object>} */
  const profiles = {};
  for (const [id, profile] of Object.entries(officeState?.profiles ?? {})) {
    profiles[id] = {
      ...profile,
      changeLog: (profile?.changeLog ?? []).filter((event) => {
        const dated = String(event?.effective_date || event?.adjusted_at || '').slice(0, 10);
        return !/^\d{4}-\d{2}-\d{2}$/.test(dated) || dated <= asOf;
      }),
    };
  }
  return { ...officeState, profiles };
}

/**
 * Regular contracted hours for one driver on each date. An open review
 * window keeps the earlier contract until its contracted date.
 * Hours from every route the driver holds that day are added together.
 * Daily rounding adds those minutes first, then rounds once.
 * @param {object | null | undefined} officeState
 * @param {string} driverName
 * @param {Date[]} dates
 * @param {'snap' | 'daily' | 'separate'} rounding
 */
function contractedHoursForDays(officeState, driverName, dates, rounding) {
  /** @type {Map<string, string>} */
  const byDay = new Map();
  if (!officeState?.profiles || !driverName) return byDay;
  for (const date of dates) {
    const key = localDateKey(date);
    if (byDay.has(key)) continue;
    const rows = payrollRowsForDriver(
      payrollDriverRows(
        { ...officeStateOnDate(officeState, key), punches: [] },
        { asOf: key, roundClocks: rounding }
      ),
      driverName
    );
    const hours =
      rounding === CLOCK_ROUNDING_DAILY
        ? quarterHoursFromDailyMinutes(
            rows.flatMap((row) => [row.amTotalMinutes, row.middayTotalMinutes, row.pmTotalMinutes])
          )
        : sumRoundedQuarterHours(rows.map((row) => row.fullDayRoundedQuarterHours));
    byDay.set(key, formatContracted(hours));
  }
  return byDay;
}

/**
 * @param {string} rate
 */
function formatRate(rate) {
  if (!rate) return '';
  const number = Number(rate);
  if (!Number.isFinite(number)) return '';
  return `$${number.toFixed(2)}`;
}

/**
 * @param {{ start: Date, end: Date }} pair
 * @param {'snap' | 'daily' | 'separate'} rounding
 */
function pairQuarterHours(pair, rounding) {
  const step = clockQuarterStep(clockFromDate(pair.start), clockFromDate(pair.end), rounding);
  return step ? step.quarterHours : null;
}

/**
 * Minutes counted for one clock span. Daily rounding sums these before it rounds.
 * @param {{ start: Date, end: Date }} pair
 * @param {'snap' | 'daily' | 'separate'} rounding
 */
function pairCountedMinutes(pair, rounding) {
  const step = clockQuarterStep(clockFromDate(pair.start), clockFromDate(pair.end), rounding);
  return step ? step.minutes : null;
}

const CONTRACT_RUNS = [
  { label: 'AM', inKey: 'amIn', outKey: 'amOut' },
  { label: 'Midday', inKey: 'middayIn', outKey: 'middayOut' },
  { label: 'PM', inKey: 'pmIn', outKey: 'pmOut' },
];

/**
 * @param {ReturnType<typeof clockQuarterStep>} step
 * @param {string} label
 */
function stepRow(step, label) {
  return {
    label,
    writtenIn: step ? formatClockAmPm(step.writtenIn) : '',
    writtenOut: step ? formatClockAmPm(step.writtenOut) : '',
    snappedIn: step ? formatClockAmPm(step.usedIn) : '',
    snappedOut: step ? formatClockAmPm(step.usedOut) : '',
    minutes: step ? step.minutes : null,
    snappedMinutes: step ? step.snappedMinutes : null,
    hours: step ? formatQuarterHourText(step.quarterHours) : '',
    quarterHours: step ? step.quarterHours : null,
  };
}

/**
 * Contracted runs for one driver on one date, in the same rounding the summary uses.
 * @param {object | null | undefined} officeState
 * @param {string} driverName
 * @param {Date} date
 * @param {'snap' | 'daily' | 'separate'} rounding
 */
function contractRoutesForDay(officeState, driverName, date, rounding) {
  if (!officeState?.profiles || !driverName) return [];
  const key = localDateKey(date);
  const rows = payrollRowsForDriver(
    payrollDriverRows(
      { ...officeStateOnDate(officeState, key), punches: [] },
      { asOf: key, roundClocks: rounding }
    ),
    driverName
  );
  return rows.map((row) => {
    const runs = CONTRACT_RUNS.map((run) => stepRow(clockQuarterStep(row[run.inKey], row[run.outKey], rounding), run.label));
    const totalNumber =
      rounding === CLOCK_ROUNDING_DAILY
        ? quarterHoursFromDailyMinutes(runs.map((run) => run.minutes))
        : sumRoundedQuarterHours(runs.map((run) => run.quarterHours));
    return {
      route: String(row.route || '').trim(),
      runs,
      total: formatQuarterHourText(totalNumber),
    };
  });
}

/**
 * @param {{
 *   driverName: string,
 *   driverId?: string,
 *   pay?: { serial?: string, rate?: string, account?: string },
 *   defaults?: object,
 *   edits?: object,
 *   punches?: object[],
 *   officeState?: object,
 *   email?: string,
 *   roundClocks?: boolean | string,
 *   rounding?: string,
 *   now?: Date,
 *   focus?: { year: number, monthIndex: number, periodId?: string, lineIds?: string[] },
 * }} options
 */
export function buildMonthlyTimeSummary(options) {
  const now = options.now instanceof Date ? options.now : new Date();
  const driverName = String(options.driverName || '').trim();
  const driverId = String(options.driverId || '').trim();
  const wanted = driverName.toLowerCase();
  const pay = normalizeDriverPay(options.pay);
  const defaults = normalizeClockPayDefaults(options.defaults);
  const edits = normalizeTimeSummaryEdits(options.edits);
  const driverEdits = edits[driverId] || {};
  const rounding = roundingFrom(options);
  const punches = (options.punches || []).filter(
    (punch) => String(punch?.driver_name || '').trim().toLowerCase() === wanted
  );
  const { pairs, unpaired } = pairClockPunches(punches);
  /** @type {Map<string, Map<string, Array<number | null>>>} */
  const hoursByLine = new Map();
  /** @type {Map<string, Array<number | null>>} */
  const clockedByDay = new Map();
  for (const pair of pairs) {
    const status = isPayLineId(pair.clockIn?.pay_status) ? String(pair.clockIn.pay_status) : 'reg-driver';
    const key = localDateKey(pair.start);
    const amount =
      rounding === CLOCK_ROUNDING_DAILY ? pairCountedMinutes(pair, rounding) : pairQuarterHours(pair, rounding);
    const byDay = hoursByLine.get(status) || new Map();
    const list = byDay.get(key) || [];
    list.push(amount);
    byDay.set(key, list);
    hoursByLine.set(status, byDay);
    const clocked = clockedByDay.get(key) || [];
    clocked.push(amount);
    clockedByDay.set(key, clocked);
  }
  const ranges = defaults.periods;
  const focus = options.focus;
  const wantedLines = Array.isArray(focus?.lineIds) ? new Set(focus.lineIds.map((id) => String(id))) : null;
  const catalog = defaults.lines.filter((line) => !wantedLines || wantedLines.has(line.id));
  const chosenLines = catalog.length ? catalog : defaults.lines;
  /** @type {NonNullable<ReturnType<typeof describePeriod>>[]} */
  let covered = [];
  if (focus && Number.isInteger(focus.year) && Number.isInteger(focus.monthIndex)) {
    const range = ranges.find((period) => period.id === String(focus.periodId || '')) || ranges[0];
    const row = range ? describePeriod(focus.year, focus.monthIndex, range) : null;
    covered = row ? [row] : [];
  } else {
    covered = listCoveredPeriods(punches, ranges, now);
  }
  const contractedByDay = contractedHoursForDays(
    options.officeState,
    driverName,
    covered.flatMap((period) => period.dates),
    rounding
  );
  const periods = covered.map((period) => {
    const lines = chosenLines.map((line) => {
      const entry = driverEdits[period.key]?.[line.id] || {};
      const byDay = hoursByLine.get(line.id);
      /** @type {Record<number, string>} */
      const calculated = {};
      for (const date of period.dates) {
        const key = localDateKey(date);
        const text =
          line.id === 'ex-driver'
            ? exDriverDayHours(dayHours(clockedByDay.get(key) || [], rounding), contractedByDay.get(key) || '')
            : formatCalculated(dayHours(byDay?.get(key) || [], rounding));
        if (text) calculated[date.getDate()] = text;
      }
      const cells = period.days.map((day) => {
        const typed = entry.days?.[String(day)] || '';
        const fromClock = calculated[day] || '';
        return {
          day,
          calculated: fromClock,
          value: typed || fromClock,
        };
      });
      return {
        id: line.id,
        label: line.label,
        otFactor: line.otFactor,
        comment: entry.comment || '',
        cells,
        total: totalOf(cells.map((cell) => cell.value)),
      };
    });
    const regular = lines.find((line) => line.id === 'reg-driver');
    const openPunches = unpaired
      .map((item) => item.punch)
      .filter((punch) => {
        const date = new Date(punch?.punched_at);
        if (Number.isNaN(date.getTime())) return false;
        const range = periodForDate(date, ranges);
        if (!range) return false;
        const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${range.id}`;
        return stamp === period.key;
      })
      .map((punch) => {
        const date = new Date(punch.punched_at);
        return {
          when: date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
          action: punch.action === 'out' ? 'Clock out' : 'Clock in',
        };
      });
    return {
      key: period.key,
      label: period.label,
      ending: period.ending,
      days: period.days,
      contractedHours: period.dates.map((date) => contractedByDay.get(localDateKey(date)) || ''),
      lines,
      grandTotal: regular ? regular.total : totalOf(lines.map((line) => line.total)),
      unpaired: openPunches,
    };
  });
  const todayRange = periodForDate(now, ranges) || ranges[0];
  const current = todayRange ? describePeriod(now.getFullYear(), now.getMonth(), todayRange)?.key || '' : '';
  return {
    driverName,
    driverId,
    jobTitle: defaults.jobTitle,
    location: defaults.location,
    serial: pay.serial,
    rate: formatRate(pay.rate),
    account: pay.account,
    email: String(options.email || '').trim(),
    defaultPeriodKey: periods.some((period) => period.key === current) ? current : periods[0]?.key || current,
    periods,
  };
}

/**
 * Day-by-day clocks behind EX HOURS: contract hours, written clocks, and the snap.
 * @param {Parameters<typeof buildMonthlyTimeSummary>[0]} options
 */
export function buildMonthlySummaryMath(options) {
  const focus = { ...(options?.focus || {}), lineIds: ['ex-driver'] };
  const summary = buildMonthlyTimeSummary({ ...options, focus });
  const rounding = roundingFrom(options);
  const driverName = summary.driverName;
  const wanted = driverName.toLowerCase();
  const punches = (options.punches || []).filter(
    (punch) => String(punch?.driver_name || '').trim().toLowerCase() === wanted
  );
  const { pairs, unpaired } = pairClockPunches(punches);
  const overtimeByPair = overtimeForPairs(pairs, options.overtimeRules);
  const edits = normalizeTimeSummaryEdits(options.edits);
  const driverEdits = edits[summary.driverId] || {};
  const periods = summary.periods.map((period) => ({
    label: period.label,
    ending: period.ending,
    dayNumbers: period.days,
    contractedHours: period.contractedHours || [],
    exDriver: period.lines.find((line) => line.id === 'ex-driver') || null,
    grandTotal: period.grandTotal,
    days: period.days.map((day, index) => {
      const match = /^(\d{4})-(\d{2})-[1-9]$/.exec(period.key);
      const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, day) : new Date();
      const key = localDateKey(date);
      const dayPairs = pairs.filter((pair) => localDateKey(pair.start) === key);
      const pairRows = dayPairs.map((pair) => {
        const rawIn = clockFromDate(pair.start);
        const rawOut = clockFromDate(pair.end);
        const plain = clockQuarterStep(rawIn, rawOut, false);
        const snapped = clockQuarterStep(rawIn, rawOut, true);
        const shown = clockQuarterStep(rawIn, rawOut, rounding);
        const overtime = overtimeByPair.get(pairOvertimeKey(pair));
        return {
          ...stepRow(shown, ''),
          run: runForClockPair(pair),
          actualMinutes: plain?.minutes ?? null,
          roundedMinutes: plain?.snappedMinutes ?? null,
          snapMinutes: snapped?.minutes ?? null,
          actualOvertimeMinutes: overtime?.actual ?? 0,
          roundedOvertimeMinutes: overtime?.rounded ?? 0,
          snapOvertimeMinutes: overtime?.snap ?? 0,
          overtimeReasons: overtime?.reasons || [],
          snapOvertimeReasons: overtime?.snapReasons || [],
        };
      });
      const clockedNumber =
        rounding === CLOCK_ROUNDING_DAILY
          ? quarterHoursFromDailyMinutes(pairRows.map((row) => row.actualMinutes))
          : sumRoundedQuarterHours(pairRows.map((row) => row.quarterHours));
      const contractHours = period.contractedHours?.[index] || '';
      const residual = exHoursDifference(clockedNumber, contractHours);
      const typed = driverEdits[period.key]?.['ex-driver']?.days?.[String(day)] || '';
      const open = unpaired
        .map((item) => item.punch)
        .filter((punch) => {
          const punched = new Date(punch?.punched_at);
          return !Number.isNaN(punched.getTime()) && localDateKey(punched) === key;
        })
        .map((punch) => {
          const punched = new Date(punch.punched_at);
          const clock = formatClockAmPm(clockFromDate(punched));
          let snapped = '';
          if (rounding === CLOCK_ROUNDING_SNAP) {
            try {
              snapped = formatClockAmPm(roundClockToQuarterHour(clockFromDate(punched)));
            } catch {
              snapped = '';
            }
          }
          return {
            when: punched.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
            action: punch.action === 'out' ? 'Clock out' : 'Clock in',
            clock,
            snapped,
          };
        });
      return {
        day,
        dateLabel: date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
        routes: contractRoutesForDay(options.officeState, driverName, date, rounding),
        contractHours,
        pairs: pairRows.filter((row) => row.writtenIn || row.writtenOut),
        clockedHours: formatQuarterHourText(clockedNumber),
        residual,
        typed,
        cell: typed || residual,
        unpaired: open,
      };
    }),
  }));
  return {
    driverName: summary.driverName,
    jobTitle: summary.jobTitle,
    location: summary.location,
    serial: summary.serial,
    rate: summary.rate,
    account: summary.account,
    email: summary.email,
    rounding,
    roundClocks: rounding === CLOCK_ROUNDING_SNAP,
    overtimeRules: options.overtimeRules,
    periods,
  };
}

/**
 * File name for the landscape letter PDF attached to the email.
 * @param {string} driverName
 */
export function summaryPdfBasename(driverName) {
  const slug = String(driverName ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'driver'}-monthly-time-summary`;
}

/**
 * @param {ReturnType<typeof buildMonthlyTimeSummary>} summary
 */
export function renderMonthlyTimeSummaryHtml(summary) {
  const title = `Monthly Time Summary — ${summary.driverName || 'Driver'}`;
  const options = summary.periods
    .map(
      (period) =>
        `<option value="${escapeHtml(period.key)}"${period.key === summary.defaultPeriodKey ? ' selected' : ''}>${escapeHtml(period.label)}</option>`
    )
    .join('');
  const sheets = summary.periods
    .map((period) => {
      const head = period.days.map((day) => `<th class="day" scope="col">${day}</th>`).join('');
      const contract = (period.contractedHours || [])
        .map((hours) => `<td class="day">${escapeHtml(hours)}</td>`)
        .join('');
      const rows = period.lines
        .map((line) => {
          const cells = line.cells
            .map(
              (cell) => `<td><input data-kind="day" data-line="${escapeHtml(line.id)}" data-day="${cell.day}" data-calculated="${escapeHtml(cell.calculated)}" value="${escapeHtml(cell.value)}" inputmode="decimal" aria-label="${escapeHtml(line.label)} day ${cell.day}" /></td>`
            )
            .join('');
          return `<tr data-line="${escapeHtml(line.id)}">
            <th scope="row">${escapeHtml(line.label)}</th>
            <td class="account">${escapeHtml(summary.account).replace(/-/g, '-<wbr>')}</td>
            <td class="rate">${escapeHtml(summary.rate)}</td>
            <td class="ot">${escapeHtml(String(line.otFactor))}</td>
            ${cells}
            <td class="line-total">${escapeHtml(line.total)}</td>
            <td class="comment"><input data-kind="comment" data-line="${escapeHtml(line.id)}" value="${escapeHtml(line.comment)}" maxlength="200" aria-label="Comment for ${escapeHtml(line.label)}" /></td>
          </tr>`;
        })
        .join('');
      const unpaired = period.unpaired.length
        ? `<section class="unpaired"><h2>Clock records left off this sheet</h2><ul>${period.unpaired
            .map((item) => `<li>${escapeHtml(item.when)} · ${escapeHtml(item.action)}</li>`)
            .join('')}</ul><p>A clock in counts only after its clock out is recorded.</p></section>`
        : '';
      return `<section class="period-block" data-period="${escapeHtml(period.key)}"${period.key === summary.defaultPeriodKey ? '' : ' hidden'}>
      <div class="page-frame">
      <article class="sheet" data-period="${escapeHtml(period.key)}">
        <header class="banner">
          <p class="district">Bellingham Public Schools</p>
          <h1>MONTHLY TIME SUMMARY</h1>
          <p class="dept">${escapeHtml(summary.location)}</p>
        </header>
        <dl class="meta">
          <div><dt>Employee</dt><dd>${escapeHtml(summary.driverName)}</dd></div>
          <div><dt>Job title</dt><dd>${escapeHtml(summary.jobTitle)}</dd></div>
          <div><dt>Serial #</dt><dd>${escapeHtml(summary.serial)}</dd></div>
          <div><dt>Pay period ending</dt><dd>${escapeHtml(period.ending)}</dd></div>
          <div><dt>Location</dt><dd>${escapeHtml(summary.location)}</dd></div>
        </dl>
        <table class="${period.days.length > 20 ? 'many-days' : ''}" data-days="${period.days.length}">
          <colgroup>
            <col class="status" />
            <col class="account" />
            <col class="rate" />
            <col class="ot" />
            ${period.days.map(() => '<col class="day" />').join('')}
            <col class="total" />
            <col class="comment" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Pay status</th>
              <th scope="col">Account</th>
              <th scope="col">Rate</th>
              <th scope="col">OT</th>
              ${head}
              <th scope="col">Total hours</th>
              <th scope="col">Comments</th>
            </tr>
            <tr class="contract">
              <th scope="row" colspan="4">REG CONTR HRS</th>
              ${contract}
              <td></td>
              <td></td>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <th scope="row" colspan="4">TOTAL</th>
              <td colspan="${period.days.length}"></td>
              <td class="grand-total">${escapeHtml(period.grandTotal)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <p class="cert">I certify that the above hours were worked as reported.</p>
        <div class="signs">
          <div><span>Employee signature</span><i></i></div>
          <div><span>Date</span><i></i></div>
          <div><span>Supervisor approval</span><i></i></div>
        </div>
      </article>
      </div>
      ${unpaired}
      </section>`;
    })
    .join('');
  const sheetCss = `
    .banner { text-align: center; margin: 0 0 0.28in; }
    .district, .dept { margin: 0; letter-spacing: 0.04em; font-size: 11px; }
    h1 { margin: 0.04in 0; font-size: 18px; letter-spacing: 0.08em; }
    .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.08in 0.28in; margin: 0 0 0.16in; font-size: 11px; }
    .meta div { display: grid; grid-template-columns: 1.15in 1fr; gap: 0.06in; border-bottom: 1px solid #222; }
    .meta dt { margin: 0; font-weight: 600; }
    .meta dd { margin: 0; min-height: 0.9em; }
    table { width: 100%; table-layout: fixed; border-collapse: collapse; }
    col.status { width: 8.5%; }
    col.account { width: 13%; }
    col.rate { width: 4.6%; }
    col.ot { width: 3%; }
    col.total { width: 5.2%; }
    col.comment { width: 8.5%; }
    th, td { border: 1px solid #222; padding: 0.04in 0.03in; text-align: center; font-weight: 500; font-size: 8px; line-height: 1.15; vertical-align: middle; }
    thead th { background: #f4f4f4; }
    th.day, td.day { padding-left: 0; padding-right: 0; white-space: nowrap; overflow: hidden; }
    table.many-days th, table.many-days td { font-size: 7px; padding-top: 0.02in; padding-bottom: 0.02in; }
    table.many-days td.account { font-size: 6px; }
    thead tr.contract th { text-align: left; background: #f7f4ea; white-space: nowrap; }
    thead tr.contract td { font-weight: 700; background: #f7f4ea; }
    tbody th { text-align: left; white-space: normal; }
    td.account { font-size: 6.5px; line-height: 1.05; word-break: normal; }
    td input, td .value { width: 100%; border: 0; background: transparent; text-align: center; font: inherit; padding: 0; color: inherit; }
    .comment input, .comment .value { text-align: left; }
    tfoot th, tfoot td { background: #d9d9d9; font-weight: 700; }
    .cert { margin: 0.16in 0 0.08in; font-size: 11px; }
    .signs { display: grid; grid-template-columns: 1.4fr 0.6fr 1fr; gap: 0.35in; margin-top: 0.08in; }
    .signs span { display: block; font-size: 11px; margin-bottom: 0.28in; }
    .signs i { display: block; border-bottom: 1px solid #222; height: 0.16in; }
  `;
  const pdfCss = `
    @page { size: letter landscape; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; background: #fff; color: #1a1a1a; font: 12px/1.3 "Segoe UI", Candara, sans-serif; }
    .page-frame, .sheet { width: 11in; height: 8.5in; }
    .sheet { padding: 0.38in 0.42in 0.28in; overflow: hidden; background: #fff; }
    ${sheetCss}
  `;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    ${pdfCss}
    body { background: #e7e2d8; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: end; padding: 0.75rem 1rem; background: #fff; border-bottom: 1px solid #d5d0c8; position: sticky; top: 0; }
    .toolbar label { display: grid; gap: 0.2rem; font-size: 12px; }
    .toolbar select, .toolbar button { font: inherit; }
    .toolbar button { padding: 0.35rem 0.8rem; }
    #save-note { margin: 0; color: #6b4b16; flex: 1; min-width: 12rem; }
    .page-frame { width: min(11in, calc(100vw - 2rem)); height: auto; margin: 1rem auto 0; }
    .sheet { box-shadow: 0 10px 28px rgba(40, 32, 16, 0.14); transform-origin: top left; }
    .unpaired { width: min(11in, calc(100vw - 2rem)); margin: 0.75rem auto 1.5rem; }
    .unpaired h2 { font-size: 13px; margin: 0 0 0.3rem; }
    .unpaired ul { margin: 0; padding-left: 1.1rem; }
    @media print {
      html, body { width: 11in; height: 8.5in; overflow: hidden; background: #fff; }
      .toolbar, .unpaired { display: none !important; }
      .period-block[hidden] { display: none !important; }
      .page-frame { width: 11in !important; height: 8.5in !important; margin: 0 !important; }
      .sheet { transform: none !important; box-shadow: none; }
    }
  </style>
</head>
<body data-driver-id="${escapeHtml(summary.driverId)}" data-driver-name="${escapeHtml(summary.driverName)}" data-driver-email="${escapeHtml(summary.email)}">
  <div class="toolbar">
    <label>Pay period
      <select id="period">${options}</select>
    </label>
    <button type="button" id="print">Print</button>
    <button type="button" id="email">Email</button>
    <p id="save-note"></p>
  </div>
  ${sheets}
  <script>
    const driverId = document.body.dataset.driverId;
    const pdfCss = ${JSON.stringify(pdfCss)};
    const select = document.querySelector('#period');
    function fitSheets() {
      const pageWidth = 11 * 96;
      const pageHeight = 8.5 * 96;
      document.querySelectorAll('.period-block').forEach((block) => {
        const frame = block.querySelector('.page-frame');
        const sheet = block.querySelector('.sheet');
        if (!frame || !sheet || block.hidden) return;
        const scale = Math.min(1, frame.clientWidth / pageWidth);
        sheet.style.transform = 'scale(' + scale + ')';
        frame.style.height = (pageHeight * scale) + 'px';
      });
    }
    function show(key) {
      document.querySelectorAll('.period-block').forEach((block) => {
        block.hidden = block.dataset.period !== key;
      });
      fitSheets();
    }
    select.addEventListener('change', () => show(select.value));
    window.addEventListener('resize', fitSheets);
    fitSheets();
    document.querySelector('#print').addEventListener('click', () => window.print());
    function esc(value) {
      return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function pdfHtml() {
      const block = document.querySelector('.period-block:not([hidden])');
      const frame = block && block.querySelector('.page-frame');
      if (!frame) return '';
      const clone = frame.cloneNode(true);
      const live = frame.querySelectorAll('input');
      clone.querySelectorAll('input').forEach((input, index) => {
        const span = document.createElement('span');
        span.className = 'value';
        span.textContent = live[index] ? live[index].value : '';
        input.replaceWith(span);
      });
      clone.style.height = '';
      const sheet = clone.querySelector('.sheet');
      if (sheet) sheet.style.transform = '';
      return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>'
        + esc(document.title)
        + '</title><style>' + pdfCss + '</style></head><body>'
        + clone.outerHTML
        + '</body></html>';
    }
    document.querySelector('#email').addEventListener('click', async () => {
      const note = document.querySelector('#save-note');
      const email = document.body.dataset.driverEmail || '';
      const name = document.body.dataset.driverName || 'Driver';
      if (!email) {
        note.textContent = 'Add an email for ' + name + ' on the Driver Name List before sending this summary.';
        return;
      }
      const label = select.selectedOptions[0] ? select.selectedOptions[0].textContent : '';
      note.textContent = 'Opening the email…';
      try {
        const response = await fetch('/api/email-time-summary', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ html: pdfHtml(), email, name, period: label }),
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
    function snap(raw) {
      const number = Number(String(raw).trim());
      if (!Number.isFinite(number) || number < 0 || number > 24) return '';
      return (Math.round(number * 4) / 4).toFixed(2);
    }
    function post(payload) {
      if (!window.opener || window.opener.closed) {
        document.querySelector('#save-note').textContent = 'This window cannot save changes because the Timeclock page is closed.';
        return;
      }
      window.opener.postMessage({ type: 'teamster-time-summary', driverId, ...payload }, window.location.origin);
    }
    function refreshTotals(sheet) {
      sheet.querySelectorAll('tbody tr').forEach((row) => {
        let sum = 0;
        let any = false;
        row.querySelectorAll('input[data-kind="day"]').forEach((input) => {
          if (!input.value.trim()) return;
          any = true;
          sum += Number(input.value);
        });
        const total = row.querySelector('.line-total');
        if (total) total.textContent = any ? (Math.round(sum * 4) / 4).toFixed(2) : '';
      });
      const regular = sheet.querySelector('tr[data-line="reg-driver"] .line-total');
      const grand = sheet.querySelector('.grand-total');
      if (!grand) return;
      if (regular) {
        grand.textContent = regular.textContent;
        return;
      }
      let grandSum = 0;
      let grandAny = false;
      sheet.querySelectorAll('tbody .line-total').forEach((cell) => {
        if (!cell.textContent.trim()) return;
        grandAny = true;
        grandSum += Number(cell.textContent);
      });
      grand.textContent = grandAny ? (Math.round(grandSum * 4) / 4).toFixed(2) : '';
    }
    document.addEventListener('change', (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      const sheet = input.closest('.sheet');
      const line = input.dataset.line;
      if (!sheet || !line) return;
      if (input.dataset.kind === 'day') {
        const raw = input.value.trim();
        if (!raw) {
          input.value = input.dataset.calculated || '';
          refreshTotals(sheet);
          post({ kind: 'day', periodKey: sheet.dataset.period, lineId: line, day: input.dataset.day, hours: '' });
          return;
        }
        const snapped = snap(raw);
        if (!snapped) {
          input.value = input.dataset.calculated || '';
          return;
        }
        input.value = snapped;
        refreshTotals(sheet);
        post({ kind: 'day', periodKey: sheet.dataset.period, lineId: line, day: input.dataset.day, hours: snapped });
        return;
      }
      if (input.dataset.kind === 'comment') {
        post({ kind: 'comment', periodKey: sheet.dataset.period, lineId: line, comment: input.value });
      }
    });
  </script>
</body>
</html>`;
}
