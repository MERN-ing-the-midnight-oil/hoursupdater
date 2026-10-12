/**
 * One driver's clock record: every date from today back through the pay
 * period that holds the earliest clock. Newest day first. A weekend with
 * no clock is an empty row, so the weeks stay visible while scrolling.
 */

import { formatClockAmPm } from '../../employee-tracker/src/clockTimes.js';
import {
  localDateKey,
  normalizePunchRun,
  pairClockPunches,
  runForClockPair,
  segmentForClock,
} from '../../src/logic/timesheets.js';
import { DEFAULT_PAY_PERIODS } from './driverPay.js';
import { payPeriodsForClocks } from './monthlyTimeSummary.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const CLOCK_RECORD_COLUMNS = [
  { key: 'dateLabel', label: 'Date', text: true },
  { key: 'weekday', label: 'Day', text: true },
  { key: 'amIn', label: 'AM in' },
  { key: 'amOut', label: 'AM out' },
  { key: 'middayIn', label: 'Midday in' },
  { key: 'middayOut', label: 'Midday out' },
  { key: 'pmIn', label: 'PM in' },
  { key: 'pmOut', label: 'PM out' },
  { key: 'otherIn', label: 'Other in' },
  { key: 'otherOut', label: 'Other out' },
];

/**
 * @param {Date} date
 */
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * @param {Date} date
 */
function clockLabel(date) {
  return formatClockAmPm(`${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`);
}

/**
 * @param {{ key: string, days: number[] }} period
 */
function datesForPeriod(period) {
  const match = /^(\d{4})-(\d{2})-/.exec(String(period?.key || ''));
  if (!match || !Array.isArray(period?.days)) return [];
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return period.days.map((day) => new Date(year, monthIndex, day));
}

/**
 * @param {object[]} punches
 */
function clocksByDate(punches) {
  const { pairs, unpaired } = pairClockPunches(punches);
  /** @type {Map<string, Record<string, Array<{ at: number, in: string, out: string }>>>} */
  const map = new Map();
  const ensure = (key) => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { AM: [], MIDDAY: [], PM: [], OTHER: [] };
      map.set(key, bucket);
    }
    return bucket;
  };
  for (const pair of pairs) {
    const run = runForClockPair(pair);
    ensure(localDateKey(pair.start))[run].push({
      at: pair.start.getTime(),
      in: clockLabel(pair.start),
      out: clockLabel(pair.end),
    });
  }
  for (const item of unpaired) {
    const at = new Date(item.punch?.punched_at);
    if (Number.isNaN(at.getTime())) continue;
    const chosen = normalizePunchRun(item.punch?.run);
    const segment = segmentForClock(at);
    const run = chosen || (segment === 'am' ? 'AM' : segment === 'midday' ? 'MIDDAY' : 'PM');
    ensure(localDateKey(at))[run].push({
      at: at.getTime(),
      in: item.reason === 'in' ? clockLabel(at) : '',
      out: item.reason === 'out' ? clockLabel(at) : '',
    });
  }
  for (const bucket of map.values()) {
    for (const spans of Object.values(bucket)) spans.sort((a, b) => a.at - b.at);
  }
  return map;
}

/**
 * @param {Date} date
 * @param {ReturnType<typeof clocksByDate>} byDate
 * @param {boolean} periodStart
 */
function rowFor(date, byDate, periodStart) {
  const key = localDateKey(date);
  const spans = byDate.get(key);
  const cell = (run, side) => (spans ? spans[run].map((span) => span[side]).join('\n') : '');
  return {
    dateKey: key,
    dateLabel: `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`,
    weekday: WEEKDAYS[date.getDay()],
    weekend: date.getDay() === 0 || date.getDay() === 6,
    periodStart,
    amIn: cell('AM', 'in'),
    amOut: cell('AM', 'out'),
    middayIn: cell('MIDDAY', 'in'),
    middayOut: cell('MIDDAY', 'out'),
    pmIn: cell('PM', 'in'),
    pmOut: cell('PM', 'out'),
    otherIn: cell('OTHER', 'in'),
    otherOut: cell('OTHER', 'out'),
  };
}

/**
 * Pay periods for one driver, newest period first, newest day first inside each.
 * Days after `now` stay off the sheet unless a clock was already saved then.
 * A period that ended before this driver's first clock is left out.
 * @param {object[] | null | undefined} punches
 * @param {Array<{ id: string, startDay: number, endDay: number }> | null | undefined} periods
 * @param {string | null | undefined} driverName
 * @param {Date} [now]
 */
export function buildDriverClockRecord(punches, periods, driverName, now = new Date()) {
  const wanted = String(driverName ?? '').trim().toLowerCase();
  if (!wanted) return [];
  const mine = (Array.isArray(punches) ? punches : []).filter(
    (punch) =>
      punch?.removed !== true &&
      String(punch?.driver_name || '').trim().toLowerCase() === wanted
  );
  const today = startOfDay(now instanceof Date ? now : new Date());
  let end = today;
  let earliest = today;
  for (const punch of mine) {
    const date = new Date(punch?.punched_at);
    if (Number.isNaN(date.getTime())) continue;
    const day = startOfDay(date);
    if (day < earliest) earliest = day;
    if (day > end) end = day;
  }
  const configured = Array.isArray(periods) && periods.length ? periods : DEFAULT_PAY_PERIODS;
  const listed = payPeriodsForClocks(mine, configured, end);
  const byDate = clocksByDate(mine);
  /** @type {Array<{ key: string, label: string, band: number, rows: ReturnType<typeof rowFor>[] }>} */
  const sheets = [];
  for (const period of listed) {
    const dates = datesForPeriod(period).filter((date) => startOfDay(date) <= end);
    if (!dates.length) continue;
    const first = startOfDay(dates[0]);
    const last = startOfDay(dates[dates.length - 1]);
    if (last < earliest || first > end) continue;
    const rows = [...dates].reverse().map((date, index) => rowFor(date, byDate, index === 0));
    sheets.push({
      key: period.key,
      label: period.label,
      band: sheets.length % 2,
      rows,
    });
  }
  return sheets;
}
