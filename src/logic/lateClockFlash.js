import { normalizePunchRun } from './timesheets.js';
import { parseClockTime } from './timeUtils.js';

export const LATE_FLASH_MAX_MINUTES = 240;

// A punch this many minutes before a clock-in still counts for that run.
const EARLY_MINUTES = 90;
const DAY_MINUTES = 24 * 60;

// Blank, missing, or out of range means the names stay steady.
// Zero means the name flashes at the route clock-in time.
export function normalizeLateFlashMinutes(raw) {
  if (raw == null) return null;
  const text = typeof raw === 'string' ? raw.trim() : raw;
  if (text === '') return null;
  const value = typeof text === 'number' ? text : Number(text);
  if (!Number.isInteger(value) || value < 0 || value > LATE_FLASH_MAX_MINUTES) return null;
  return value;
}

export function clockInMinutesList(clockIns) {
  const minutes = [];
  for (const item of Array.isArray(clockIns) ? clockIns : []) {
    if (typeof item === 'number' && Number.isInteger(item) && item >= 0 && item < DAY_MINUTES) {
      minutes.push(item);
      continue;
    }
    const text = String(item ?? '').trim();
    if (!text) continue;
    try {
      minutes.push(parseClockTime(text));
    } catch {
      // A route clock the screen cannot read does not flash.
    }
  }
  return [...new Set(minutes)].sort((a, b) => a - b);
}

export function localClockParts(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${month}-${day}`,
    minutes: date.getHours() * 60 + date.getMinutes(),
  };
}

export function clockInKey(date, minutes) {
  return `${date}|${minutes}`;
}

// Each punch belongs to the nearest run: from 90 minutes before the first
// clock-in, then the midpoint between neighboring clock-ins, through the end
// of the day for the last run.
function windows(times) {
  return times.map((clockIn, index) => {
    const previous = times[index - 1];
    const next = times[index + 1];
    const start =
      previous == null ? Math.max(0, clockIn - EARLY_MINUTES) : Math.floor((previous + clockIn) / 2);
    const end = next == null ? DAY_MINUTES : Math.floor((clockIn + next) / 2);
    return { start, end };
  });
}

function punchEventsToday(punches, driverName, date) {
  const wanted = String(driverName || '').trim().toLowerCase();
  if (!wanted) return [];
  const found = [];
  for (const punch of Array.isArray(punches) ? punches : []) {
    if (punch?.removed === true) continue;
    if (punch?.action !== 'in') continue;
    if (String(punch.driver_name || '').trim().toLowerCase() !== wanted) continue;
    const when = new Date(punch.punched_at || '');
    if (Number.isNaN(when.getTime())) continue;
    const parts = localClockParts(when);
    if (parts.date !== date) continue;
    found.push({ minutes: parts.minutes, run: normalizePunchRun(punch.run) });
  }
  return found;
}

// Route clock-ins that are already `graceMinutes` past, whether or not the
// driver has punched. Returning from that driver's screen acknowledges these.
export function dueClockInKeys({ now, graceMinutes, clockIns }) {
  const grace = normalizeLateFlashMinutes(graceMinutes);
  if (grace == null || !(now instanceof Date) || Number.isNaN(now.getTime())) return [];
  const times = clockInMinutesList(clockIns);
  if (!times.length) return [];
  const { date, minutes } = localClockParts(now);
  return times.filter((clockIn) => minutes >= clockIn + grace).map((clockIn) => clockInKey(date, clockIn));
}

// Due clock-ins that still have no clock-in in that run, ignoring ones the
// office already cleared by opening the name and returning to the list.
export function flashingClockInKeys({
  now,
  graceMinutes,
  clockIns,
  clockRuns = [],
  punches = [],
  driverName = '',
  acknowledged = [],
}) {
  const grace = normalizeLateFlashMinutes(graceMinutes);
  if (grace == null || !(now instanceof Date) || Number.isNaN(now.getTime())) return [];
  const times = clockInMinutesList(clockIns);
  if (!times.length) return [];
  const { date, minutes: nowMinutes } = localClockParts(now);
  const spans = windows(times);
  const punchesToday = punchEventsToday(punches, driverName, date);
  const cleared = new Set(Array.isArray(acknowledged) ? acknowledged : []);
  const runs = Array.isArray(clockRuns) ? clockRuns : [];
  const keys = [];
  for (let index = 0; index < times.length; index += 1) {
    const clockIn = times[index];
    if (nowMinutes < clockIn + grace) continue;
    const key = clockInKey(date, clockIn);
    if (cleared.has(key)) continue;
    const span = spans[index];
    const spanRun = normalizePunchRun(runs[index]);
    const covered = punchesToday.some((event) => {
      if (event.run === 'OTHER') return false;
      if (event.run) return Boolean(spanRun) && event.run === spanRun;
      return event.minutes >= span.start && event.minutes < span.end;
    });
    if (!covered) keys.push(key);
  }
  return keys;
}
