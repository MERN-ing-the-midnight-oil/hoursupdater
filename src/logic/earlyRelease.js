// Early release replaces a route's regular PM clock-in.
// The built-in Bellingham year is every Thursday that school is in session, and also the last day, June 11, 2027.
// An imported school year lists its own early release days.
// The clock-in is the time saved for the first school the route heads to.
// Route notes write that school first: "LOW, SHS/BHS, LOW" heads to LOW.

import { parseClockTime } from './timeUtils.js';

// Clock-in used when a school has no saved early release time.
export const EARLY_RELEASE_DEFAULT_CLOCK = '11:55';

// Early dismissal days that are not Thursdays. The last day of school is one.
export const EARLY_RELEASE_EXTRA_DATES = ['2027-06-11'];

// Words that show up in route notes and are not school codes.
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

function isParenthetical(text, index, length) {
  return text[index - 1] === '(' || text[index + length] === ')';
}

function schoolCodesIn(text, options = {}) {
  const source = String(text ?? '');
  const codes = [];
  for (const match of source.matchAll(/\b[A-Za-z]{2,6}\b/g)) {
    const code = match[0].toUpperCase();
    if (NOTE_WORDS.has(code)) continue;
    if (options.skipParenthetical && isParenthetical(source, match.index ?? 0, match[0].length)) continue;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

// The slash that separates the schools the driver heads to first from the other run.
// Notes such as "3.5 hours/4 hr min RV, SQHS/RV, SQHS" use the last slash that
// has school codes on both sides.
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

// School codes written on a route, in the order they appear.
export function schoolCodesFromNote(note) {
  const { headed, other } = splitSchoolLists(note);
  const codes = [];
  for (const code of [...schoolCodesIn(headed), ...schoolCodesIn(other)]) {
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

// The first school this route heads to. A code tucked in parentheses, such as
// "MWF(CT)", is a side note and is not that school.
export function firstHeadedSchool(note) {
  const { headed } = splitSchoolLists(note);
  return schoolCodesIn(headed, { skipParenthetical: true })[0] || schoolCodesIn(headed)[0] || '';
}

// Every school code on the office routes, in alphabetical order.
export function knownSchoolCodes(profiles) {
  const found = new Set();
  const list =
    profiles && typeof profiles === 'object'
      ? Object.values( (profiles))
      : [];
  for (const profile of list) {
    for (const code of schoolCodesFromNote(profile?.note)) found.add(code);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

function clockText(raw) {
  const minutes = parseClockTime(String(raw ?? '').trim());
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

// Saved early release clock-ins, keyed by school code.
// A missing or unreadable time is left out so that school stays at 11:55 AM.
export function normalizeEarlyReleaseTimes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
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

// Early release clock-in for the first school on this route.
// Blank when the note has no school code.
export function earlyReleaseClock(note, times) {
  const school = firstHeadedSchool(note);
  if (!school) return '';
  const saved = normalizeEarlyReleaseTimes(times);
  return saved[school] || EARLY_RELEASE_DEFAULT_CLOCK;
}

function thursdaySchoolDay(iso, schoolDays) {
  const days = Array.isArray(schoolDays) ? schoolDays.map((day) => String(day)) : [];
  if (!days.includes(iso)) return false;
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).getDay() === 4;
}

// Built-in rule: Thursday school days, plus June 11, 2027.
// A saved school year passes `rules` and uses that list instead.
export function isEarlyReleaseDate(date, schoolDays, rules) {
  const iso = String(date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  if (rules && typeof rules === 'object') {
    const dates = Array.isArray(rules.dates) ? rules.dates.map((day) => String(day).slice(0, 10)) : [];
    if (dates.includes(iso)) return true;
    if (rules.thursdays === true) return thursdaySchoolDay(iso, schoolDays);
    return false;
  }
  if (EARLY_RELEASE_EXTRA_DATES.includes(iso)) return true;
  return thursdaySchoolDay(iso, schoolDays);
}

// PM clock-in for this date. Early release days use the first school's time.
// A route with no school code keeps its regular PM clock-in.
export function pmClockForDate({ regularClock, note, date, schoolDays, times, rules }) {
  const regular = String(regularClock ?? '').trim();
  if (!regular) return '';
  if (!isEarlyReleaseDate(date, schoolDays, rules)) return regular;
  return earlyReleaseClock(note, times) || regular;
}
