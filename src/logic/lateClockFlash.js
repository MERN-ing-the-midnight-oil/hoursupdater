/**
 * A driver name flashes when a route clock-in is late and that run has no
 * clock-in yet. Opening the name and returning to the driver list acknowledges
 * the clock-ins that are already due, which stops the flash for those runs.
 */

import { parseClockTime } from './timeUtils.js';

export const LATE_FLASH_MAX_MINUTES = 240;

/** A punch this many minutes before a clock-in still counts for that run. */
const EARLY_MINUTES = 90;
const DAY_MINUTES = 24 * 60;

/**
 * Blank, missing, or out of range means the names stay steady.
 * Zero means the name flashes at the route clock-in time.
 * @param {unknown} raw
 * @returns {number | null}
 */
export function normalizeLateFlashMinutes(raw) {
  if (raw == null) return null;
  const text = typeof raw === 'string' ? raw.trim() : raw;
  if (text === '') return null;
  const value = typeof text === 'number' ? text : Number(text);
  if (!Number.isInteger(value) || value < 0 || value > LATE_FLASH_MAX_MINUTES) return null;
  return value;
}

/**
 * @param {unknown} clockIns
 * @returns {number[]}
 */
export function clockInMinutesList(clockIns) {
  /** @type {number[]} */
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

/**
 * @param {Date} date
 * @returns {{ date: string, minutes: number }}
 */
export function localClockParts(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${month}-${day}`,
    minutes: date.getHours() * 60 + date.getMinutes(),
  };
}

/**
 * @param {string} date
 * @param {number} minutes
 */
export function clockInKey(date, minutes) {
  return `${date}|${minutes}`;
}

/**
 * Each punch belongs to the nearest run: from 90 minutes before the first
 * clock-in, then the midpoint between neighboring clock-ins, through the end
 * of the day for the last run.
 * @param {number[]} times
 */
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

/**
 * @param {Array<{ action?: string, punched_at?: string, driver_name?: string }> | null | undefined} punches
 * @param {string} driverName
 * @param {string} date
 */
function punchMinutesToday(punches, driverName, date) {
  const wanted = String(driverName || '').trim().toLowerCase();
  if (!wanted) return [];
  /** @type {number[]} */
  const found = [];
  for (const punch of Array.isArray(punches) ? punches : []) {
    if (punch?.action !== 'in') continue;
    if (String(punch.driver_name || '').trim().toLowerCase() !== wanted) continue;
    const when = new Date(punch.punched_at || '');
    if (Number.isNaN(when.getTime())) continue;
    const parts = localClockParts(when);
    if (parts.date !== date) continue;
    found.push(parts.minutes);
  }
  return found;
}

/**
 * Route clock-ins that are already `graceMinutes` past, whether or not the
 * driver has punched. Returning from that driver's screen acknowledges these.
 * @param {{ now: Date, graceMinutes: unknown, clockIns: unknown }} input
 * @returns {string[]}
 */
export function dueClockInKeys({ now, graceMinutes, clockIns }) {
  const grace = normalizeLateFlashMinutes(graceMinutes);
  if (grace == null || !(now instanceof Date) || Number.isNaN(now.getTime())) return [];
  const times = clockInMinutesList(clockIns);
  if (!times.length) return [];
  const { date, minutes } = localClockParts(now);
  return times.filter((clockIn) => minutes >= clockIn + grace).map((clockIn) => clockInKey(date, clockIn));
}

/**
 * Due clock-ins that still have no clock-in in that run, ignoring ones the
 * office already cleared by opening the name and returning to the list.
 * @param {{
 *   now: Date,
 *   graceMinutes: unknown,
 *   clockIns: unknown,
 *   punches?: Array<{ action?: string, punched_at?: string, driver_name?: string }> | null,
 *   driverName?: string,
 *   acknowledged?: string[] | null,
 * }} input
 * @returns {string[]}
 */
export function flashingClockInKeys({
  now,
  graceMinutes,
  clockIns,
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
  const punchesToday = punchMinutesToday(punches, driverName, date);
  const cleared = new Set(Array.isArray(acknowledged) ? acknowledged : []);
  /** @type {string[]} */
  const keys = [];
  for (let index = 0; index < times.length; index += 1) {
    const clockIn = times[index];
    if (nowMinutes < clockIn + grace) continue;
    const key = clockInKey(date, clockIn);
    if (cleared.has(key)) continue;
    const span = spans[index];
    const covered = punchesToday.some((minute) => minute >= span.start && minute < span.end);
    if (!covered) keys.push(key);
  }
  return keys;
}
