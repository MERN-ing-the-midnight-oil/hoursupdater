import { toDateString } from './timeUtils.js';

/**
 * Full-day entry from the district calendar files (every civil day in range).
 * @typedef {Object} SchoolCalendarDay
 * @property {string} date - YYYY-MM-DD
 * @property {string} [day_of_week]
 * @property {boolean} is_school_day
 * @property {string} [reason]
 */

/**
 * School calendar — either legacy sparse school_days, or full day list with
 * is_school_day flags. Countdown logic only cares about dates where
 * is_school_day is true; it never assumes summer/month shapes.
 *
 * @typedef {Object} SchoolCalendar
 * @property {string | null} [school_year]
 * @property {string} [coverage_start]
 * @property {string} [coverage_end]
 * @property {string[]} [school_days] - legacy: YYYY-MM-DD school days only
 * @property {SchoolCalendarDay[]} [days] - full coverage with is_school_day
 */

/**
 * Extract ordered school-day date strings from any supported calendar shape.
 * Pure data read — no month/summer hardcoding.
 *
 * @param {SchoolCalendar | string[] | SchoolCalendarDay[]} calendarOrDays
 * @returns {string[]}
 */
export function getSchoolDays(calendarOrDays) {
  if (Array.isArray(calendarOrDays)) {
    if (calendarOrDays.length === 0) {
      throw new Error('School calendar must include school days.');
    }
    if (typeof calendarOrDays[0] === 'string') {
      return [...calendarOrDays].map(toDateString).sort();
    }
    return extractSchoolDaysFromDayList(
      /** @type {SchoolCalendarDay[]} */ (calendarOrDays)
    );
  }

  if (Array.isArray(calendarOrDays?.days) && calendarOrDays.days.length > 0) {
    return extractSchoolDaysFromDayList(calendarOrDays.days);
  }

  const legacy = calendarOrDays?.school_days;
  if (!Array.isArray(legacy) || legacy.length === 0) {
    throw new Error(
      'School calendar must include a non-empty days[] (with is_school_day) or school_days[] array.'
    );
  }
  return [...legacy].map(toDateString).sort();
}

/**
 * @param {SchoolCalendarDay[]} days
 * @returns {string[]}
 */
function extractSchoolDaysFromDayList(days) {
  const schoolDays = days
    .filter((entry) => entry && entry.is_school_day === true && entry.date)
    .map((entry) => toDateString(entry.date));
  if (schoolDays.length === 0) {
    throw new Error(
      'School calendar days[] has no entries with is_school_day: true.'
    );
  }
  return [...new Set(schoolDays)].sort();
}

/**
 * @param {string[]} schoolDays
 * @param {string | Date} date
 * @returns {boolean}
 */
export function isSchoolDay(schoolDays, date) {
  const normalized = toDateString(date);
  return schoolDays.includes(normalized);
}

/**
 * Return the date that is `count` school days after `fromDate` (exclusive of fromDate).
 * Example: fromDate Mon, count 1 → next school day after Mon.
 *
 * Throws if the calendar runs out of school days before `count` is reached
 * (fails visibly rather than returning null / silently opening a window).
 *
 * @param {SchoolCalendar | string[] | SchoolCalendarDay[]} calendarOrDays
 * @param {string | Date} fromDate
 * @param {number} count
 * @returns {string}
 */
export function addSchoolDays(calendarOrDays, fromDate, count) {
  if (count < 0) {
    throw new Error('School day count must be non-negative.');
  }
  if (count === 0) {
    return toDateString(fromDate);
  }

  const schoolDays = getSchoolDays(calendarOrDays);
  const start = toDateString(fromDate);
  let remaining = count;
  for (const day of schoolDays) {
    if (day <= start) {
      continue;
    }
    remaining -= 1;
    if (remaining === 0) {
      return day;
    }
  }

  const last = schoolDays[schoolDays.length - 1] ?? '(empty)';
  throw new Error(
    `School calendar ends at ${last}; cannot count ${count} school day(s) after ${start} ` +
      `(only ${count - remaining} available). Extend school-calendar.json coverage.`
  );
}

/**
 * Count school days strictly after `fromDate` up to and including `toDate`.
 * @param {SchoolCalendar | string[] | SchoolCalendarDay[]} calendarOrDays
 * @param {string | Date} fromDate
 * @param {string | Date} toDate
 * @returns {number}
 */
export function countSchoolDaysBetween(calendarOrDays, fromDate, toDate) {
  const schoolDays = getSchoolDays(calendarOrDays);
  const start = toDateString(fromDate);
  const end = toDateString(toDate);
  if (end < start) {
    return 0;
  }
  return schoolDays.filter((day) => day > start && day <= end).length;
}

/**
 * Days remaining in an open window (inclusive of expires date as last valid day).
 * @param {SchoolCalendar | string[] | SchoolCalendarDay[]} calendarOrDays
 * @param {string | Date} asOfDate
 * @param {string | null | undefined} windowExpiresDate
 * @returns {number | null}
 */
export function daysRemainingInWindow(calendarOrDays, asOfDate, windowExpiresDate) {
  if (!windowExpiresDate) {
    return null;
  }
  const today = toDateString(asOfDate);
  const expires = toDateString(windowExpiresDate);
  if (today > expires) {
    return 0;
  }
  const schoolDays = getSchoolDays(calendarOrDays);
  return schoolDays.filter((day) => day >= today && day <= expires).length;
}

/**
 * Whether the accumulation window has expired as of `asOfDate`.
 * Window is open through window_expires_date (inclusive); expires the first
 * school day after that date with no qualifying extension.
 * @param {string | Date} asOfDate
 * @param {string | null | undefined} windowExpiresDate
 * @returns {boolean}
 */
export function isWindowExpired(asOfDate, windowExpiresDate) {
  if (!windowExpiresDate) {
    return false;
  }
  return toDateString(asOfDate) > toDateString(windowExpiresDate);
}
