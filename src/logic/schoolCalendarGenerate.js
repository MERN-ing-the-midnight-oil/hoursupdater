import { toDateString } from './timeUtils.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * @typedef {Object} CalendarBreak
 * @property {string} start
 * @property {string} end
 * @property {string} [label]
 */

/**
 * @typedef {Object} CalendarHoliday
 * @property {string} date
 * @property {string} [label]
 */

/**
 * @typedef {Object} GenerateSchoolYearInput
 * @property {string} first_day
 * @property {string} last_day
 * @property {CalendarBreak[]} [breaks]
 * @property {CalendarHoliday[]} [holidays]
 * @property {string | null} [school_year]
 */

/**
 * @param {string} day
 */
function assertDate(day, label = 'date') {
  if (typeof day !== 'string' || !DATE_RE.test(day.trim())) {
    throw new Error(`Invalid ${label}: ${day}`);
  }
  const normalized = day.trim();
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new Error(`Invalid ${label}: ${day}`);
  }
  return normalized;
}

/**
 * @param {string} iso
 * @returns {Date}
 */
function utcDate(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * @param {Date} d
 * @returns {string}
 */
function isoFromUtc(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * @param {string} iso
 * @returns {string}
 */
function dayOfWeekName(iso) {
  return WEEKDAY_NAMES[utcDate(iso).getUTCDay()];
}

/**
 * District-file convention: July 1 on/before first day → June 30 on/after last day.
 * Flagged in KNOWN_OPEN_QUESTIONS — confirm this boundary with Rachel if needed.
 *
 * @param {string} firstDay
 * @param {string} lastDay
 * @returns {{ coverage_start: string, coverage_end: string, boundary_rule: string }}
 */
export function defaultCoverageWindow(firstDay, lastDay) {
  const first = utcDate(firstDay);
  const last = utcDate(lastDay);
  const firstYear = first.getUTCFullYear();
  const lastYear = last.getUTCFullYear();

  const coverage_start =
    first.getUTCMonth() >= 6
      ? `${firstYear}-07-01`
      : `${firstYear - 1}-07-01`;
  const coverage_end =
    last.getUTCMonth() <= 5
      ? `${lastYear}-06-30`
      : `${lastYear + 1}-06-30`;

  if (coverage_end < coverage_start) {
    throw new Error('Computed coverage window is inverted — check first/last day.');
  }

  return {
    coverage_start,
    coverage_end,
    boundary_rule:
      'July 1 on or before first day of school through June 30 on or after last day of school (matches district year files). Outside that window is not generated.',
  };
}

/**
 * @param {GenerateSchoolYearInput} input
 */
export function validateGenerateSchoolYearInput(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Generation input is required.');
  }
  const first_day = assertDate(input.first_day, 'first day of school');
  const last_day = assertDate(input.last_day, 'last day of school');
  if (last_day < first_day) {
    throw new Error('Last day of school must be on or after the first day.');
  }

  /** @type {CalendarBreak[]} */
  const breaks = [];
  for (const raw of input.breaks ?? []) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Each break must be an object with start and end.');
    }
    const start = assertDate(raw.start, 'break start');
    const end = assertDate(raw.end, 'break end');
    if (end < start) {
      throw new Error(`Break end ${end} is before start ${start}.`);
    }
    breaks.push({
      start,
      end,
      label: typeof raw.label === 'string' ? raw.label.trim() : '',
    });
  }

  /** @type {CalendarHoliday[]} */
  const holidays = [];
  /** @type {Set<string>} */
  const holidaySeen = new Set();
  for (const raw of input.holidays ?? []) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Each holiday must be an object with date.');
    }
    const date = assertDate(raw.date, 'holiday date');
    if (holidaySeen.has(date)) {
      throw new Error(`Duplicate holiday date: ${date}`);
    }
    holidaySeen.add(date);
    holidays.push({
      date,
      label: typeof raw.label === 'string' ? raw.label.trim() : '',
    });
  }

  let school_year = null;
  if (input.school_year != null && String(input.school_year).trim()) {
    school_year = String(input.school_year).trim();
  } else {
    const startY = utcDate(first_day).getUTCFullYear();
    const endY = utcDate(last_day).getUTCFullYear();
    school_year =
      startY === endY ? String(startY) : `${startY}-${String(endY).slice(-2)}`;
  }

  return { first_day, last_day, breaks, holidays, school_year };
}

/**
 * Generate a full civil-day calendar for one school year from key dates.
 *
 * @param {GenerateSchoolYearInput} rawInput
 * @returns {{
 *   calendar: import('./calendar.js').SchoolCalendar,
 *   summary: object,
 *   coverage_boundary: { coverage_start: string, coverage_end: string, boundary_rule: string },
 * }}
 */
export function generateSchoolYearCalendar(rawInput) {
  const input = validateGenerateSchoolYearInput(rawInput);
  const coverage = defaultCoverageWindow(input.first_day, input.last_day);

  /** @type {Map<string, { label: string }>} */
  const holidayByDate = new Map(
    input.holidays.map((h) => [h.date, { label: h.label || 'Holiday' }])
  );

  /** @type {import('./calendar.js').SchoolCalendarDay[]} */
  const days = [];
  let cursor = utcDate(coverage.coverage_start);
  const end = utcDate(coverage.coverage_end);

  let school_day_count = 0;
  let weekend_count = 0;
  let break_day_count = 0;
  let holiday_day_count = 0;
  let summer_day_count = 0;

  while (cursor <= end) {
    const date = isoFromUtc(cursor);
    const dow = cursor.getUTCDay(); // 0 Sun … 6 Sat
    const day_of_week = dayOfWeekName(date);
    const inSchoolYear = date >= input.first_day && date <= input.last_day;

    /** @type {import('./calendar.js').SchoolCalendarDay} */
    let entry;

    if (!inSchoolYear) {
      entry = {
        date,
        day_of_week,
        is_school_day: false,
        reason: 'Outside school year (summer)',
      };
      summer_day_count += 1;
    } else if (dow === 0 || dow === 6) {
      entry = {
        date,
        day_of_week,
        is_school_day: false,
        reason: 'Weekend',
      };
      weekend_count += 1;
    } else {
      const holiday = holidayByDate.get(date);
      const breakHit = input.breaks.find((b) => date >= b.start && date <= b.end);
      if (holiday) {
        entry = {
          date,
          day_of_week,
          is_school_day: false,
          reason: holiday.label,
        };
        holiday_day_count += 1;
      } else if (breakHit) {
        entry = {
          date,
          day_of_week,
          is_school_day: false,
          reason: breakHit.label || 'Break',
        };
        break_day_count += 1;
      } else {
        entry = {
          date,
          day_of_week,
          is_school_day: true,
          reason: '',
        };
        school_day_count += 1;
      }
    }

    days.push(entry);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const school_days = days.filter((d) => d.is_school_day).map((d) => d.date);

  return {
    calendar: {
      school_year: input.school_year,
      coverage_start: coverage.coverage_start,
      coverage_end: coverage.coverage_end,
      days,
      school_days,
    },
    summary: {
      first_day: input.first_day,
      last_day: input.last_day,
      school_day_count,
      weekend_count,
      break_day_count,
      holiday_day_count,
      summer_day_count,
      civil_day_count: days.length,
      breaks_applied: input.breaks.map((b) => ({
        start: b.start,
        end: b.end,
        label: b.label || 'Break',
      })),
      holidays_applied: input.holidays.map((h) => ({
        date: h.date,
        label: h.label || 'Holiday',
      })),
    },
    coverage_boundary: coverage,
  };
}

/**
 * Compare a generated year against an existing calendar for overlapping dates.
 *
 * @param {import('./calendar.js').SchoolCalendar | null | undefined} existing
 * @param {import('./calendar.js').SchoolCalendar} generated
 */
export function findCalendarGenerationConflicts(existing, generated) {
  const existingDays = Array.isArray(existing?.days) ? existing.days : [];
  /** @type {Map<string, import('./calendar.js').SchoolCalendarDay>} */
  const existingByDate = new Map(existingDays.map((d) => [d.date, d]));

  /** @type {string[]} */
  const overlapping_dates = [];
  /** @type {Array<{ date: string, existing_is_school_day: boolean, generated_is_school_day: boolean, existing_reason?: string, generated_reason?: string }>} */
  const differing = [];

  for (const day of generated.days ?? []) {
    const prior = existingByDate.get(day.date);
    if (!prior) continue;
    overlapping_dates.push(day.date);
    if (
      prior.is_school_day !== day.is_school_day ||
      (prior.reason || '') !== (day.reason || '')
    ) {
      differing.push({
        date: day.date,
        existing_is_school_day: prior.is_school_day,
        generated_is_school_day: day.is_school_day,
        existing_reason: prior.reason,
        generated_reason: day.reason,
      });
    }
  }

  return {
    has_overlap: overlapping_dates.length > 0,
    overlapping_date_count: overlapping_dates.length,
    differing_count: differing.length,
    sample_overlapping_dates: overlapping_dates.slice(0, 8),
    sample_differences: differing.slice(0, 8),
  };
}

/**
 * Merge generated days into an existing calendar (generated wins on overlap).
 *
 * @param {import('./calendar.js').SchoolCalendar | null | undefined} existing
 * @param {import('./calendar.js').SchoolCalendar} generated
 * @returns {import('./calendar.js').SchoolCalendar}
 */
export function mergeGeneratedSchoolCalendar(existing, generated) {
  /** @type {Map<string, import('./calendar.js').SchoolCalendarDay>} */
  const byDate = new Map();
  for (const day of existing?.days ?? []) {
    byDate.set(day.date, { ...day });
  }
  for (const day of generated.days ?? []) {
    byDate.set(day.date, { ...day });
  }

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) {
    throw new Error('Merged calendar has no days.');
  }

  const school_year_parts = [
    existing?.school_year,
    generated.school_year,
  ].filter(Boolean);
  const school_year =
    school_year_parts.length > 1
      ? [...new Set(school_year_parts)].join(' / ')
      : school_year_parts[0] || generated.school_year || null;

  return {
    school_year,
    coverage_start: days[0].date,
    coverage_end: days[days.length - 1].date,
    days,
    school_days: days.filter((d) => d.is_school_day).map((d) => d.date),
  };
}
