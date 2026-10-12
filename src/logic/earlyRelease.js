/**
 * Early release replaces a route's regular PM clock-in.
 * It is every Thursday that school is in session, and also November 25, 2026.
 * The clock-in is the time saved for the first school the route heads to.
 * Route notes write that school first: "LOW, SHS/BHS, LOW" heads to LOW.
 */

import { parseClockTime } from './timeUtils.js';

/** Clock-in used when a school has no saved early release time. */
export const EARLY_RELEASE_DEFAULT_CLOCK = '11:55';

/** Early release days that are not Thursdays. */
export const EARLY_RELEASE_EXTRA_DATES = ['2026-11-25'];

/**
 * Words that show up in route notes and are not school codes.
 * @type {Set<string>}
 */
const NOTE_WORDS = new Set([
  'AM',
  'PM',
  'HR',
  'HRS',
  'HOUR',
  'HOURS',
  'MIN',
  'MINIMUM',
  'SHOP',
  'OFFICE',
  'DRIVER',
  'TRAINER',
  'SIGNED',
  'FOR',
  'WITH',
  'NO',
  'CLOCK',
  'LEFT',
  'OUT',
  'OF',
  'CONTRACTED',
  'THE',
  'AND',
  'TO',
  'ONLY',
  'DAYS',
  'DAY',
  'WEEK',
  'CONTRACT',
  'RECORDED',
  'SPAN',
  'NOT',
  'AN',
  'RUN',
  'ROUTE',
  'UTILITY',
  'ASSIGNED',
  'MISCALCULATION',
  'TIME',
  'CHANGED',
  'AFTER',
  'NOTING',
  'CHANGE',
  'SHEET',
  'IS',
  'MD',
  'ON',
  'FROM',
  'THIS',
  'THAT',
  'WHEN',
  'OR',
  'BG',
  'MWF',
  'RET',
  'SK',
  'IN',
  'AS',
  'ONE',
]);

/**
 * @param {string} text
 * @param {number} index
 * @param {number} length
 */
function isParenthetical(text, index, length) {
  return text[index - 1] === '(' || text[index + length] === ')';
}

/**
 * @param {unknown} text
 * @param {{ skipParenthetical?: boolean }} [options]
 * @returns {string[]}
 */
function schoolCodesIn(text, options = {}) {
  const source = String(text ?? '');
  /** @type {string[]} */
  const codes = [];
  for (const match of source.matchAll(/\b[A-Za-z]{2,6}\b/g)) {
    const code = match[0].toUpperCase();
    if (NOTE_WORDS.has(code)) continue;
    if (options.skipParenthetical && isParenthetical(source, match.index ?? 0, match[0].length)) continue;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

/**
 * The slash that separates the schools the driver heads to first from the other run.
 * Notes such as "3.5 hours/4 hr min RV, SQHS/RV, SQHS" use the last slash that
 * has school codes on both sides.
 * @param {unknown} note
 * @returns {{ headed: string, other: string }}
 */
function splitSchoolLists(note) {
  const text = String(note ?? '');
  const parts = text.split('/');
  if (parts.length < 2) return { headed: text, other: '' };
  for (let index = parts.length - 1; index >= 1; index -= 1) {
    const headed = parts.slice(0, index).join('/');
    const other = parts.slice(index).join('/');
    if (schoolCodesIn(headed).length && schoolCodesIn(other).length) {
      return { headed, other };
    }
  }
  return { headed: text, other: '' };
}

/**
 * School codes written on a route, in the order they appear.
 * @param {unknown} note
 * @returns {string[]}
 */
export function schoolCodesFromNote(note) {
  const { headed, other } = splitSchoolLists(note);
  /** @type {string[]} */
  const codes = [];
  for (const code of [...schoolCodesIn(headed), ...schoolCodesIn(other)]) {
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

/**
 * The first school this route heads to. A code tucked in parentheses, such as
 * "MWF(CT)", is a side note and is not that school.
 * @param {unknown} note
 * @returns {string}
 */
export function firstHeadedSchool(note) {
  const { headed } = splitSchoolLists(note);
  return schoolCodesIn(headed, { skipParenthetical: true })[0] || schoolCodesIn(headed)[0] || '';
}

/**
 * Every school code on the office routes, in alphabetical order.
 * @param {unknown} profiles
 * @returns {string[]}
 */
export function knownSchoolCodes(profiles) {
  const found = new Set();
  const list =
    profiles && typeof profiles === 'object'
      ? Object.values(/** @type {Record<string, { note?: unknown }>} */ (profiles))
      : [];
  for (const profile of list) {
    for (const code of schoolCodesFromNote(profile?.note)) found.add(code);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function clockText(raw) {
  const minutes = parseClockTime(String(raw ?? '').trim());
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

/**
 * Saved early release clock-ins, keyed by school code.
 * A missing or unreadable time is left out so that school stays at 11:55 AM.
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function normalizeEarlyReleaseTimes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  /** @type {Record<string, string>} */
  const times = {};
  for (const [key, value] of Object.entries(raw)) {
    const code = String(key || '').trim().toUpperCase();
    if (!/^[A-Z]{2,6}$/.test(code) || NOTE_WORDS.has(code)) continue;
    try {
      times[code] = clockText(value);
    } catch {
      // An unreadable time keeps the 11:55 AM default.
    }
  }
  return times;
}

/**
 * Early release clock-in for the first school on this route.
 * Blank when the note has no school code.
 * @param {unknown} note
 * @param {unknown} times
 * @returns {string}
 */
export function earlyReleaseClock(note, times) {
  const school = firstHeadedSchool(note);
  if (!school) return '';
  const saved = normalizeEarlyReleaseTimes(times);
  return saved[school] || EARLY_RELEASE_DEFAULT_CLOCK;
}

/**
 * Thursday school days, plus November 25, 2026.
 * @param {unknown} date
 * @param {unknown} schoolDays
 * @returns {boolean}
 */
export function isEarlyReleaseDate(date, schoolDays) {
  const iso = String(date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  if (EARLY_RELEASE_EXTRA_DATES.includes(iso)) return true;
  const days = Array.isArray(schoolDays) ? schoolDays.map((day) => String(day)) : [];
  if (!days.includes(iso)) return false;
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).getDay() === 4;
}

/**
 * PM clock-in for this date. Early release days use the first school's time.
 * A route with no school code keeps its regular PM clock-in.
 * @param {{
 *   regularClock?: unknown,
 *   note?: unknown,
 *   date?: unknown,
 *   schoolDays?: unknown,
 *   times?: unknown,
 * }} input
 * @returns {string}
 */
export function pmClockForDate({ regularClock, note, date, schoolDays, times }) {
  const regular = String(regularClock ?? '').trim();
  if (!regular) return '';
  if (!isEarlyReleaseDate(date, schoolDays)) return regular;
  return earlyReleaseClock(note, times) || regular;
}
