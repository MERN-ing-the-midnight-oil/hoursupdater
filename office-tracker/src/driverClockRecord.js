import { formatClockAmPm, formatDurationLabel } from '../../employee-tracker/src/clockTimes.js';
import {
  localDateKey,
  normalizePunchRun,
  pairClockPunches,
  runForClockPair,
  segmentForClock,
} from '../../src/logic/timesheets.js';
import { normalizeStoredWorkPortions, tripTicketLine, workTypeLabel } from '../../src/logic/workTypes.js';
import { DEFAULT_PAY_PERIODS } from './driverPay.js';
import { normalizeLeaveRequests } from './leaveRequests.js';
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
  { key: 'otherWork', label: 'Other work', text: true },
];

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function clockLabel(date) {
  return formatClockAmPm(`${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`);
}

function datesForPeriod(period) {
  const match = /^(\d{4})-(\d{2})-/.exec(String(period?.key || ''));
  if (!match || !Array.isArray(period?.days)) return [];
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return period.days.map((day) => new Date(year, monthIndex, day));
}

function clocksByDate(punches) {
  const { pairs, unpaired } = pairClockPunches(punches);
  const map = new Map();
  const notes = new Map();
  const ensure = (key) => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { AM: [], MIDDAY: [], PM: [], OTHER: [] };
      map.set(key, bucket);
    }
    return bucket;
  };
  const addNote = (key, text) => {
    if (!text) return;
    const list = notes.get(key) || [];
    list.push(text);
    notes.set(key, list);
  };
  for (const pair of pairs) {
    const run = runForClockPair(pair);
    const key = localDateKey(pair.start);
    ensure(key)[run].push({
      at: pair.start.getTime(),
      in: clockLabel(pair.start),
      out: clockLabel(pair.end),
    });
    if (run === 'OTHER') {
      const label = workTypeLabel(pair.clockIn?.work_type || pair.clockOut?.work_type);
      const ticket = tripTicketLine(pair.clockIn?.trip_ticket || pair.clockOut?.trip_ticket);
      const span = `${clockLabel(pair.start)}–${clockLabel(pair.end)}`;
      const text = [label ? `${label} ${span}` : '', ticket].filter(Boolean).join('\n');
      if (text) addNote(key, text);
    } else {
      for (const portion of normalizeStoredWorkPortions(pair.clockIn?.work_portions)) {
        const label = workTypeLabel(portion.work_type);
        const start = new Date(portion.start);
        const end = new Date(portion.end);
        if (label && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
          const ticket = tripTicketLine(portion.trip_ticket);
          const text = [`${label} ${clockLabel(start)}–${clockLabel(end)}`, ticket].filter(Boolean).join('\n');
          addNote(key, text);
        }
      }
    }
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
  return { byRun: map, notes };
}

function rowFor(date, clocks, periodStart) {
  const key = localDateKey(date);
  const spans = clocks.byRun.get(key);
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
    otherWork: (clocks.notes.get(key) || []).join('\n'),
  };
}

function paintLeave(row, requests) {
  for (const leave of requests) {
    const hours = formatDurationLabel(leave.minutes);
    const [inKey, outKey] =
      leave.run === 'AM'
        ? ['amIn', 'amOut']
        : leave.run === 'MIDDAY'
          ? ['middayIn', 'middayOut']
          : ['pmIn', 'pmOut'];
    if (row[inKey] || row[outKey]) continue;
    row[inKey] = 'Leave Requested';
    row[outKey] = hours;
  }
  return row;
}

function dateFromKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  return startOfDay(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

// Pay periods for one driver, newest period first, newest day first inside each.
// Days after `now` stay off the sheet unless a clock was already saved then.
// A period that ended before this driver's first clock is left out.
export function buildDriverClockRecord(punches, periods, driverName, now = new Date(), leaveRequests = []) {
  const wanted = String(driverName ?? '').trim().toLowerCase();
  if (!wanted) return [];
  const mine = (Array.isArray(punches) ? punches : []).filter(
    (punch) =>
      punch?.removed !== true &&
      String(punch?.driver_name || '').trim().toLowerCase() === wanted
  );
  const leaves = normalizeLeaveRequests(leaveRequests).filter(
    (row) => row.driver_name.toLowerCase() === wanted
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
  const leaveByDate = new Map();
  for (const leave of leaves) {
    const day = dateFromKey(leave.date);
    if (!day) continue;
    if (day < earliest) earliest = day;
    if (day > end) end = day;
    const list = leaveByDate.get(leave.date) || [];
    list.push(leave);
    leaveByDate.set(leave.date, list);
  }
  const configured = Array.isArray(periods) && periods.length ? periods : DEFAULT_PAY_PERIODS;
  const anchors = leaves.length
    ? [...mine, ...leaves.map((leave) => ({ punched_at: new Date(`${leave.date}T12:00:00`).toISOString() }))]
    : mine;
  let listed = payPeriodsForClocks(anchors, configured, end);
  if (leaves.length && end > today) {
    const seen = new Set(listed.map((period) => period.key));
    const current = payPeriodsForClocks(mine, configured, today).filter((period) => !seen.has(period.key));
    listed = [...listed, ...current].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  }
  const byDate = clocksByDate(mine);
  const notable = new Set();
  if (leaves.length) {
    for (const leave of leaves) notable.add(leave.date);
    for (const punch of mine) {
      const date = new Date(punch?.punched_at);
      if (!Number.isNaN(date.getTime())) notable.add(localDateKey(date));
    }
  }
  const sheets = [];
  for (const period of listed) {
    const dates = datesForPeriod(period).filter((date) => {
      const day = startOfDay(date);
      if (!leaves.length) return day <= end;
      if (day <= today) return true;
      return notable.has(localDateKey(date));
    });
    if (!dates.length) continue;
    const first = startOfDay(dates[0]);
    const last = startOfDay(dates[dates.length - 1]);
    if (last < earliest || first > end) continue;
    const rows = [...dates].reverse().map((date, index) => {
      const row = rowFor(date, byDate, index === 0);
      return paintLeave(row, leaveByDate.get(row.dateKey) || []);
    });
    sheets.push({
      key: period.key,
      label: period.label,
      band: sheets.length % 2,
      rows,
    });
  }
  return sheets;
}
