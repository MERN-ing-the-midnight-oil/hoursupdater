import { toDateString } from './timeUtils.js';

// Full-day entry from the district calendar files (every civil day in range).

// School calendar — either legacy sparse school_days, or full day list with
// is_school_day flags. Countdown logic only cares about dates where
// is_school_day is true; it never assumes summer/month shapes.

// Extract ordered school-day date strings from any supported calendar shape.
// Pure data read — no month/summer hardcoding.
export function getSchoolDays(calendarOrDays) {
  if (Array.isArray(calendarOrDays)) {
    if (calendarOrDays.length === 0) {
      throw new Error('School calendar must include school days.');
    }
    if (typeof calendarOrDays[0] === 'string') {
      return [...calendarOrDays].map(toDateString).sort();
    }
    return extractSchoolDaysFromDayList(
 (calendarOrDays)
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

export function isSchoolDay(schoolDays, date) {
  const normalized = toDateString(date);
  return schoolDays.includes(normalized);
}

// Return the date that is `count` school days after `fromDate` (exclusive of fromDate).
// Throws if the calendar runs out of school days before `count` is reached
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

// Count school days strictly after `fromDate` up to and including `toDate`.
export function countSchoolDaysBetween(calendarOrDays, fromDate, toDate) {
  const schoolDays = getSchoolDays(calendarOrDays);
  const start = toDateString(fromDate);
  const end = toDateString(toDate);
  if (end < start) {
    return 0;
  }
  return schoolDays.filter((day) => day > start && day <= end).length;
}

// Days remaining in an open window (inclusive of expires date as last valid day).
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

// Whether the accumulation window has expired as of `asOfDate`.
// Window is open through window_expires_date (inclusive); expires the first
// school day after that date with no qualifying extension.
export function isWindowExpired(asOfDate, windowExpiresDate) {
  if (!windowExpiresDate) {
    return false;
  }
  return toDateString(asOfDate) > toDateString(windowExpiresDate);
}

// Shift a YYYY-MM-DD civil date by `days` (can be negative).
export function shiftCalendarDate(date, days) {
  const iso = toDateString(date);
  const utc = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(utc.getTime())) {
    throw new Error(`Invalid date: ${iso}`);
  }
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function previousCalendarDate(date) {
  return shiftCalendarDate(date, -1);
}

export function nextCalendarDate(date) {
  return shiftCalendarDate(date, 1);
}
