// Early release replaces a route's regular PM clock-in.
// The built-in Bellingham year is every Thursday that school is in session, and also the last day, June 11, 2027.
// An imported school year lists its own early release days.
// The clock-in is the time saved for the first school the route heads to.
// Route notes write that school first: "LOW, SHS/BHS, LOW" heads to LOW.

import { parseClockTime } from './timeUtils.js';

// Clock-in used when a school is not on the early-release poster and has no saved time.
export const EARLY_RELEASE_DEFAULT_CLOCK = '11:55';

// Posted early-release PM clock-ins. Morning clocks are not on that sheet.
// A.W. Alderwood, B.W. Birchwood, C.C. Carl Cozier, CORD Cordata, GEN Geneva,
// H.V. Happy Valley, LOW Lowell, N.H. Northern Heights, P.V. Parkview,
// ROOS Roosevelt, S.B. Silver Beach, SUN Sunnyland, W.K. Wade King.
// CORD, ROOS, SUN, and GN are the same schools as COR, ROO, SL, and GEN.
export const EARLY_RELEASE_SCHOOL_CLOCKS = Object.freeze({
  AW: '11:50',
  BW: '11:50',
  CC: '12:00',
  COR: '11:50',
  CORD: '11:50',
  GEN: '11:55',
  GN: '11:55',
  HV: '11:55',
  LOW: '11:55',
  NH: '11:50',
  PV: '11:55',
  ROO: '11:55',
  ROOS: '11:55',
  SB: '11:50',
  SL: '11:55',
  SUN: '11:55',
  WK: '11:55',
});

export function earlyReleaseDefaultClock(school) {
  const code = String(school || '').trim().toUpperCase();
  return EARLY_RELEASE_SCHOOL_CLOCKS[code] || EARLY_RELEASE_DEFAULT_CLOCK;
}

// Route notes use these codes. The settings page shows the school name.
const SCHOOL_DESTINATION_NAMES = {
  AW: 'Alderwood',
  BHS: 'Bellingham High',
  BW: 'Birchwood',
  CC: 'Carl Cozier',
  COL: 'Columbia',
  COR: 'Cordata',
  CT: 'Community Transitions',
  ELC: 'Early Learning Center',
  FMS: 'Fairhaven',
  GEN: 'Geneva',
  GN: 'Geneva',
  HV: 'Happy Valley',
  KMS: 'Kulshan',
  LOW: 'Lowell',
  NH: 'Northern Heights',
  PV: 'Parkview',
  ROO: 'Roosevelt',
  SB: 'Silver Beach',
  SHS: 'Sehome',
  SL: 'Sunnyland',
  SMS: 'Shuksan',
  SQHS: 'Squalicum',
  WK: 'Wade King',
  WMS: 'Whatcom',
};

export function schoolDestinationLabel(code) {
  const key = String(code || '').trim().toUpperCase();
  return SCHOOL_DESTINATION_NAMES[key] || key;
}

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

function segmentKey(segment) {
  const piece = String(segment || '').trim().toUpperCase();
  if (piece === 'MID' || piece === 'MIDDAY' || piece === 'MID-DAY' || piece === 'MID DAY') return 'MID';
  if (piece === 'AM' || piece === 'PM') return piece;
  return '';
}

// "MD COSMO" is the midday segment, not the last afternoon school.
function splitMidday(text) {
  const source = String(text ?? '');
  const match = source.match(/\bMD\b/i);
  if (!match) return { schools: schoolCodesIn(source, { skipParenthetical: true }), midday: [] };
  return {
    schools: schoolCodesIn(source.slice(0, match.index), { skipParenthetical: true }),
    midday: schoolCodesIn(source.slice(match.index + match[0].length), { skipParenthetical: true }),
  };
}

// Schools visited on one run, in the order the note lists them.
// "LOW, SHS/BHS, LOW" visits Lowell then Sehome in the morning, and Bellingham High then Lowell in the afternoon.
export function schoolsForSegment(note, segment) {
  const piece = segmentKey(segment);
  if (!piece) return [];
  if (note && typeof note === 'object') {
    const key = piece === 'MID' ? 'MIDDAY' : piece;
    const list = Array.isArray(note[key]) ? note[key] : [];
    return list.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean);
  }
  const { headed, other } = splitSchoolLists(note);
  const morning = splitMidday(headed);
  const afternoon = splitMidday(other);
  if (piece === 'AM') return morning.schools;
  if (piece === 'PM') return afternoon.schools;
  return [...morning.midday, ...afternoon.midday];
}

// The last school on that run. That is the stop that marks the route empty.
export function lastSchoolForSegment(note, segment) {
  const schools = schoolsForSegment(note, segment);
  return schools[schools.length - 1] || '';
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
// A missing or unreadable time is left out so that school keeps its posted clock-in.
export function normalizeEarlyReleaseTimes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const times = {};
  for (const [key, value] of Object.entries(raw)) {
    const code = String(key || '').trim().toUpperCase();
    if (!/^[A-Z]{2,6}$/.test(code) || NOTE_WORDS.has(code)) continue;
    try {
      times[code] = clockText(value);
    } catch {
      // An unreadable time keeps that school's posted clock-in.
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
  return saved[school] || earlyReleaseDefaultClock(school);
}

// The first posted PM clock-in. Dark Bus opens the afternoon screen then.
// A saved time for a school replaces that school's posted time.
export function earlyReleaseScreenClock(times) {
  const saved = normalizeEarlyReleaseTimes(times);
  const codes = new Set([...Object.keys(EARLY_RELEASE_SCHOOL_CLOCKS), ...Object.keys(saved)]);
  let earliest = null;
  for (const code of codes) {
    const text = saved[code] || EARLY_RELEASE_SCHOOL_CLOCKS[code];
    if (!text) continue;
    try {
      const minutes = parseClockTime(text);
      if (earliest == null || minutes < earliest) earliest = minutes;
    } catch {
      // An unreadable saved time does not move the screen.
    }
  }
  if (earliest == null) return '11:50';
  const hours = Math.floor(earliest / 60);
  const mins = earliest % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
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
