// A school year imported as a list: first and last day, holidays, breaks,
// days with no school, and early release days.
// No saved year means the built-in Bellingham Public Schools 2026–2027 year.

import { BELLINGHAM_2026_2027_INPUT } from '../../employee-tracker/src/bellinghamCalendar2026.js';
import { EARLY_RELEASE_EXTRA_DATES } from './earlyRelease.js';
import { defaultCoverageWindow, generateSchoolYearCalendar } from './schoolCalendarGenerate.js';

const LABEL_MAX = 80;
const YEAR_LABEL_MAX = 40;

const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function isoFromParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';
  let fullYear = year;
  if (fullYear < 100) fullYear += 2000;
  if (fullYear < 2000 || fullYear > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const iso = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return '';
  return iso;
}

function takeDate(text) {
  const source = String(text ?? '').trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})\b/.exec(source);
  if (isoMatch) {
    const iso = isoFromParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    if (!iso) return null;
    return { iso, rest: source.slice(isoMatch[0].length).trim() };
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(source);
  if (slash) {
    const iso = isoFromParts(Number(slash[3]), Number(slash[1]), Number(slash[2]));
    if (!iso) return null;
    return { iso, rest: source.slice(slash[0].length).trim() };
  }
  const named = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/.exec(source);
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    if (!month) return null;
    const iso = isoFromParts(Number(named[3]), month, Number(named[2]));
    if (!iso) return null;
    return { iso, rest: source.slice(named[0].length).trim() };
  }
  return null;
}

function stripLabel(rest) {
  return String(rest ?? '')
    .replace(/^[-–—:]\s*/, '')
    .trim();
}

function takeRange(text) {
  const first = takeDate(text);
  if (!first || !/^(?:to|through|–|—|-)\s+/i.test(first.rest)) return null;
  const after = first.rest.replace(/^(?:to|through|–|—|-)\s+/i, '');
  const second = takeDate(after);
  if (!second) return null;
  return { start: first.iso, end: second.iso, label: stripLabel(second.rest) };
}

function headingOf(text) {
  const value = text.trim().replace(/:$/, '').toLowerCase().replace(/\s+/g, ' ');
  if (/^holidays?$/.test(value)) return 'holidays';
  if (/^(breaks?|recess|recesses)$/.test(value)) return 'breaks';
  if (/^(early release|early releases|early release days|half day|half days)$/.test(value)) return 'early';
  if (/^(no school|no school days|closed|closure|closures|teacher day|teacher days)$/.test(value)) return 'closed';
  return '';
}

function metaOf(text) {
  const match = /^(school year|year|first day(?: of school)?|last day(?: of school)?)\s*:\s*(.*)$/i.exec(text.trim());
  if (!match) return null;
  const kind = match[1].toLowerCase();
  if (kind === 'school year' || kind === 'year') return { kind: 'year', value: match[2].trim() };
  if (kind.startsWith('first')) return { kind: 'first', value: match[2].trim() };
  return { kind: 'last', value: match[2].trim() };
}

function prefixedLine(text) {
  const match =
    /^(holidays?|breaks?|recess(?:es)?|early releases?|early release days|half days?|no school(?: days)?|closures?|closed|teacher days?)\s*:\s*(.*)$/i.exec(
      text.trim()
    );
  if (!match) return null;
  const section = headingOf(match[1]);
  if (!section) return null;
  return { section, rest: match[2].trim() };
}

function isThursdayLine(text) {
  const value = text.trim().toLowerCase().replace(/\.$/, '');
  return value === 'every thursday' || value === 'thursdays' || value === 'all thursdays';
}

function eachDate(start, end) {
  const dates = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function yearLabel(startYear, endYear) {
  return startYear === endYear ? String(startYear) : `${startYear}-${endYear}`;
}

// The Bellingham Public Schools year shipped with the app.
// Early dismissal is every Thursday that school is in session, plus June 11, 2027.
export function builtinSchoolYear() {
  const year = normalizeSchoolYear({
    school_year: BELLINGHAM_2026_2027_INPUT.school_year,
    first_day: BELLINGHAM_2026_2027_INPUT.first_day,
    last_day: BELLINGHAM_2026_2027_INPUT.last_day,
    holidays: BELLINGHAM_2026_2027_INPUT.holidays,
    breaks: BELLINGHAM_2026_2027_INPUT.breaks,
    no_school: [],
    early_release: EARLY_RELEASE_EXTRA_DATES.map((date) => ({ date, label: '' })),
    early_release_thursdays: true,
  });
  if (!year) throw new Error('The built-in school year is unreadable.');
  return year;
}

function cleanLabel(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, LABEL_MAX);
}

// A saved year, or null when this office has not imported one.
export function normalizeSchoolYear(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = (raw);
  const first = takeDate(String(source.first_day ?? ''));
  const last = takeDate(String(source.last_day ?? ''));
  if (!first || first.rest || !last || last.rest || last.iso < first.iso) return null;
  const bounds = defaultCoverageWindow(first.iso, last.iso);

  const holidays = [];
  const breaks = [];
  const noSchool = [];
  const early = [];
  const seen = new Set();

  const addDay = (date, label, bucket) => {
    const parsed = takeDate(String(date ?? ''));
    if (
      !parsed ||
      parsed.rest ||
      parsed.iso < bounds.coverage_start ||
      parsed.iso > bounds.coverage_end ||
      seen.has(parsed.iso)
    ) {
      return;
    }
    seen.add(parsed.iso);
    bucket.push({ date: parsed.iso, label: cleanLabel(label) });
  };

  for (const item of Array.isArray(source.holidays) ? source.holidays : []) {
    if (!item || typeof item !== 'object') continue;
    addDay(item.date, item.label, holidays);
  }
  for (const item of Array.isArray(source.breaks) ? source.breaks : []) {
    if (!item || typeof item !== 'object') continue;
    const start = takeDate(String(item.start ?? ''));
    const end = takeDate(String(item.end ?? ''));
    if (!start || start.rest || !end || end.rest || end.iso < start.iso) continue;
    if (start.iso < bounds.coverage_start || end.iso > bounds.coverage_end) continue;
    const covered = eachDate(start.iso, end.iso);
    if (covered.some((date) => seen.has(date))) continue;
    for (const date of covered) seen.add(date);
    breaks.push({ start: start.iso, end: end.iso, label: cleanLabel(item.label) });
  }
  for (const item of Array.isArray(source.no_school) ? source.no_school : []) {
    if (!item || typeof item !== 'object') continue;
    addDay(item.date, item.label, noSchool);
  }
  for (const item of Array.isArray(source.early_release) ? source.early_release : []) {
    if (typeof item === 'string') addDay(item, '', early);
    else if (item && typeof item === 'object') addDay(item.date, item.label, early);
  }

  const startYear = Number(first.iso.slice(0, 4));
  const endYear = Number(last.iso.slice(0, 4));
  const written = String(source.school_year ?? '').trim().replace(/\s+/g, ' ');
  return {
    school_year: written && written.length <= YEAR_LABEL_MAX ? written : yearLabel(startYear, endYear),
    first_day: first.iso,
    last_day: last.iso,
    holidays: holidays.sort((a, b) => a.date.localeCompare(b.date)),
    breaks: breaks.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)),
    no_school: noSchool.sort((a, b) => a.date.localeCompare(b.date)),
    early_release: early.sort((a, b) => a.date.localeCompare(b.date)),
    early_release_thursdays: source.early_release_thursdays === true,
  };
}

// Read a pasted school year. Unreadable lines are reported and nothing is saved.
export function parseSchoolYearListing(text) {
  const raw = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n');
  if (!lines.some((line) => line.trim())) {
    throw new Error('Paste a school year first.');
  }

  const problems = [];
  let schoolYear = '';
  let firstDay = '';
  let lastDay = '';
  let section = '';
  const holidays = [];
  const breaks = [];
  const noSchool = [];
  const early = [];
  let thursdays = false;

  const readEntry = (body, where, lineNumber) => {
    if (isThursdayLine(body)) {
      if (where !== 'early') {
        problems.push(`Line ${lineNumber}: Every Thursday belongs under Early release.`);
        return;
      }
      thursdays = true;
      return;
    }
    const range = takeRange(body);
    if (range) {
      if (where !== 'breaks') {
        problems.push(
          `Line ${lineNumber}: A range belongs under Breaks. ${where === 'early' ? 'An early release day is one day.' : 'List one day on each line.'}`
        );
        return;
      }
      if (range.end < range.start) {
        problems.push(`Line ${lineNumber}: That break ends before it starts.`);
        return;
      }
      if (range.label.length > LABEL_MAX) {
        problems.push(`Line ${lineNumber}: That label is too long.`);
        return;
      }
      breaks.push(range);
      return;
    }
    const day = takeDate(body);
    if (!day) {
      problems.push(`Line ${lineNumber}: Could not read "${body}".`);
      return;
    }
    const label = stripLabel(day.rest);
    if (label.length > LABEL_MAX) {
      problems.push(`Line ${lineNumber}: That label is too long.`);
      return;
    }
    const entry = { date: day.iso, label };
    if (where === 'holidays') holidays.push(entry);
    else if (where === 'early') early.push(entry);
    else if (where === 'closed') noSchool.push(entry);
    else breaks.push({ start: day.iso, end: day.iso, label });
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || /^[-–—]{3,}$/.test(trimmed)) return;
    const lineNumber = index + 1;
    const meta = metaOf(trimmed);
    if (meta) {
      if (meta.kind === 'year') {
        if (meta.value.length > YEAR_LABEL_MAX) problems.push(`Line ${lineNumber}: The school year label is too long.`);
        else schoolYear = meta.value;
        return;
      }
      const parsed = takeDate(meta.value);
      if (!parsed || parsed.rest) {
        problems.push(`Line ${lineNumber}: Enter a date for the ${meta.kind === 'first' ? 'first' : 'last'} day.`);
        return;
      }
      if (meta.kind === 'first') firstDay = parsed.iso;
      else lastDay = parsed.iso;
      return;
    }
    const prefixed = prefixedLine(trimmed);
    if (prefixed) {
      if (!prefixed.rest) {
        section = (prefixed.section);
        return;
      }
      readEntry(prefixed.rest, (prefixed.section), lineNumber);
      return;
    }
    const heading = headingOf(trimmed);
    if (heading) {
      section = (heading);
      return;
    }
    if (!section) {
      problems.push(`Line ${lineNumber}: Start a section with Holidays, Breaks, No school, or Early release.`);
      return;
    }
    readEntry(trimmed, (section), lineNumber);
  });

  if (!firstDay) problems.push('Add the first day of school.');
  if (!lastDay) problems.push('Add the last day of school.');
  if (firstDay && lastDay && lastDay < firstDay) problems.push('The last day of school is before the first day.');
  if (problems.length) {
    throw new Error(problems.length === 1 ? problems[0] : problems.join(' '));
  }

  const bounds = defaultCoverageWindow(firstDay, lastDay);
  const used = new Map();
  const claim = (date, role) => {
    const prior = used.get(date);
    if (prior) {
      problems.push(
        prior === role
          ? `${prettyDate(date)} is listed more than once.`
          : `${prettyDate(date)} is listed as both ${prior} and ${role}.`
      );
      return;
    }
    used.set(date, role);
  };
  const claimInside = (date, role) => {
    if (date < bounds.coverage_start || date > bounds.coverage_end) {
      problems.push(`${prettyDate(date)} is outside the school year.`);
      return;
    }
    claim(date, role);
  };
  for (const day of holidays) claimInside(day.date, 'a holiday');
  for (const span of breaks) {
    if (span.start < bounds.coverage_start || span.end > bounds.coverage_end) {
      problems.push(`${prettyDate(span.start)} to ${prettyDate(span.end)} is outside the school year.`);
      continue;
    }
    for (const date of eachDate(span.start, span.end)) claim(date, 'a break');
  }
  for (const day of noSchool) claimInside(day.date, 'a day with no school');
  for (const day of early) claimInside(day.date, 'an early release day');
  if (problems.length) {
    throw new Error(problems.length === 1 ? problems[0] : problems.join(' '));
  }

  const normalized = normalizeSchoolYear({
    school_year: schoolYear,
    first_day: firstDay,
    last_day: lastDay,
    holidays,
    breaks,
    no_school: noSchool,
    early_release: early,
    early_release_thursdays: thursdays,
  });
  if (!normalized) throw new Error('That school year could not be read.');
  return normalized;
}

function prettyDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dayLine(item) {
  return item.label ? `${item.date} ${item.label}` : item.date;
}

function weekdayNumber(iso) {
  return new Date(`${iso}T00:00:00.000Z`).getUTCDay();
}

function isWeekday(iso) {
  const day = weekdayNumber(iso);
  return day !== 0 && day !== 6;
}

// Holidays and early release days to show on the school-year calendar.
// A break is marked the same as a holiday: no school. Thursday early release
// is expanded to the actual Thursday dates.
export function schoolYearMarks(year) {
  const current = normalizeSchoolYear(year) || builtinSchoolYear();
  if (!current) {
    return { school_year: '', first_day: '', last_day: '', closed: [], early: [], labels: {} };
  }
  const labels = new Map();
  const closed = new Set();
  const closeDay = (date, label) => {
    if (!isWeekday(date)) return;
    closed.add(date);
    if (!labels.has(date)) labels.set(date, label || 'No school');
  };
  for (const day of current.holidays) closeDay(day.date, day.label);
  for (const day of current.no_school) closeDay(day.date, day.label);
  for (const span of current.breaks) {
    for (const date of eachDate(span.start, span.end)) closeDay(date, span.label);
  }
  const early = new Set();
  for (const day of current.early_release) {
    if (!isWeekday(day.date) || closed.has(day.date)) continue;
    early.add(day.date);
    if (day.label) labels.set(day.date, day.label);
  }
  if (current.early_release_thursdays) {
    for (const day of schoolYearGeneration(current).calendar.days || []) {
      if (!day.is_school_day || weekdayNumber(day.date) !== 4 || closed.has(day.date)) continue;
      early.add(day.date);
    }
  }
  return {
    school_year: current.school_year,
    first_day: current.first_day,
    last_day: current.last_day,
    closed: [...closed].sort(),
    early: [...early].sort(),
    labels: Object.fromEntries(labels),
  };
}

// A school year from the days clicked on the calendar.
// Clicked holidays have no school. Early release days stay school days.
export function schoolYearFromMarks(marks) {
  const first = takeDate(String(marks?.first_day ?? ''));
  const last = takeDate(String(marks?.last_day ?? ''));
  if (!first || first.rest || !last || last.rest) {
    throw new Error('Choose a first day and a last day of school.');
  }
  if (last.iso < first.iso) throw new Error('The last day of school is before the first day.');
  const bounds = defaultCoverageWindow(first.iso, last.iso);
  const labels = marks?.labels && typeof marks.labels === 'object' ? (marks.labels) : {};
  const labelFor = (date) => cleanLabel(labels[String(date)] || '') || 'No school';
  const closed = new Set();
  for (const date of Array.isArray(marks?.closed) ? marks.closed : []) {
    const parsed = takeDate(String(date ?? ''));
    if (!parsed || parsed.rest || !isWeekday(parsed.iso)) continue;
    if (parsed.iso < bounds.coverage_start || parsed.iso > bounds.coverage_end) continue;
    closed.add(parsed.iso);
  }
  const early = [];
  for (const date of Array.isArray(marks?.early) ? marks.early : []) {
    const parsed = takeDate(String(date ?? ''));
    if (!parsed || parsed.rest || !isWeekday(parsed.iso) || closed.has(parsed.iso)) continue;
    if (parsed.iso < bounds.coverage_start || parsed.iso > bounds.coverage_end) continue;
    const label = cleanLabel(labels[parsed.iso] || '');
    early.push({ date: parsed.iso, label: label === 'No school' ? '' : label });
  }
  const year = normalizeSchoolYear({
    school_year: marks?.school_year,
    first_day: first.iso,
    last_day: last.iso,
    holidays: [...closed].sort().map((date) => ({ date, label: labelFor(date) })),
    breaks: [],
    no_school: [],
    early_release: early,
    early_release_thursdays: false,
  });
  if (!year) throw new Error('That school year could not be saved.');
  return year;
}

// July 1 through June 30 for a name such as 2007-2008.
export function schoolYearSpan(label) {
  const match = /^(\d{4})\s*[-–—]\s*(\d{4})$/.exec(String(label ?? '').trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end !== start + 1 || start < 1990 || end > 2100) return null;
  return {
    school_year: `${start}-${end}`,
    first_day: `${start}-07-01`,
    last_day: `${end}-06-30`,
  };
}

// A new school year with no days marked yet.
export function blankSchoolYear(label) {
  const span = schoolYearSpan(label);
  if (!span) throw new Error('Enter a school year like 2007-2008.');
  return {
    ...span,
    closed: ([]),
    early: ([]),
    labels: ({}),
  };
}

// July–June sheet for a saved year. Weekdays before the first day of school
// and after the last day start marked as no school.
export function schoolYearCalendarDraft(year) {
  const marks = schoolYearMarks(year);
  const span = schoolYearSpan(marks.school_year);
  if (!span) return marks;
  const closed = new Set(marks.closed);
  for (const date of eachDate(span.first_day, span.last_day)) {
    if (!isWeekday(date)) continue;
    if (date < marks.first_day || date > marks.last_day) closed.add(date);
  }
  return {
    school_year: span.school_year,
    first_day: span.first_day,
    last_day: span.last_day,
    closed: [...closed].sort(),
    early: marks.early.filter((date) => !closed.has(date)),
    labels: marks.labels,
  };
}

// One month grid for each month from the first day through the last day.
// Weeks start on Sunday. An empty cell is null.
export function schoolYearMonths(firstDay, lastDay) {
  const first = takeDate(String(firstDay ?? ''));
  const last = takeDate(String(lastDay ?? ''));
  if (!first || first.rest || !last || last.rest || last.iso < first.iso) return [];
  const months = [];
  const cursor = new Date(`${first.iso.slice(0, 7)}-01T00:00:00.000Z`);
  const endMonth = new Date(`${last.iso.slice(0, 7)}-01T00:00:00.000Z`);
  while (cursor <= endMonth) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const title = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cells = [];
    for (let pad = 0; pad < cursor.getUTCDay(); pad += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
    months.push({ title, weeks });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

// The list shown in Timeclock settings. Importing this text saves the same year.
export function formatSchoolYearListing(year) {
  const current = normalizeSchoolYear(year) || builtinSchoolYear();
  if (!current) return '';
  const lines = [
    `School year: ${current.school_year}`,
    `First day: ${current.first_day}`,
    `Last day: ${current.last_day}`,
    '',
    'Holidays',
    ...current.holidays.map(dayLine),
    '',
    'Breaks',
    ...current.breaks.map((item) => `${item.start} to ${item.end}${item.label ? ` ${item.label}` : ''}`),
    '',
    'No school',
    ...current.no_school.map(dayLine),
    '',
    'Early release',
    ...(current.early_release_thursdays ? ['Every Thursday'] : []),
    ...current.early_release.map(dayLine),
  ];
  return `${lines.join('\n').trim()}\n`;
}

function countPhrase(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function earlyReleaseSentence(year) {
  const extra = year.early_release.length;
  if (year.early_release_thursdays && extra) {
    return `Early release is every Thursday, plus ${countPhrase(extra, 'other day')}.`;
  }
  if (year.early_release_thursdays) return 'Early release is every Thursday.';
  if (extra) return `Early release is ${countPhrase(extra, 'listed day')}.`;
  return 'No early release days are listed.';
}

export function describeSchoolYear(year, options = {}) {
  const current = normalizeSchoolYear(year) || builtinSchoolYear();
  if (!current) return '';
  const counts = `${countPhrase(current.holidays.length, 'holiday')}, ${countPhrase(current.breaks.length, 'break')}, and ${countPhrase(current.no_school.length, 'day with no school', 'days with no school')}. ${earlyReleaseSentence(current)}`;
  if (!options.saved) {
    return `The built-in ${current.school_year} Bellingham Public Schools year is in use. Save the calendar to replace it.`;
  }
  return `${current.school_year} is saved, from ${prettyDate(current.first_day)} through ${prettyDate(current.last_day)}. ${counts}`;
}

// Saved year on the office, or null when the built-in year is in use.
export function savedSchoolYear(state) {
  if (!state || typeof state !== 'object') return null;
  return normalizeSchoolYear( (state).schoolYear);
}

// Holidays that count for overtime and the monthly summary.
export function holidayListForState(state) {
  const year = savedSchoolYear(state) || builtinSchoolYear();
  return (year?.holidays || []).map((item) => ({ date: item.date, label: item.label }));
}

// Early release rules for a saved year. Null keeps the built-in Thursday rule.
export function earlyReleaseRulesForState(state) {
  const year = savedSchoolYear(state);
  if (!year) return null;
  return {
    thursdays: year.early_release_thursdays,
    dates: year.early_release.map((item) => item.date),
  };
}

// Full civil-day calendar for an imported year.
// Days with no school are one-day breaks, so they are not overtime holidays.
export function schoolYearGeneration(year) {
  const current = normalizeSchoolYear(year);
  if (!current) throw new Error('Enter a school year first.');
  return generateSchoolYearCalendar({
    school_year: current.school_year,
    first_day: current.first_day,
    last_day: current.last_day,
    holidays: current.holidays,
    breaks: [
      ...current.breaks,
      ...current.no_school.map((day) => ({
        start: day.date,
        end: day.date,
        label: day.label || 'No school',
      })),
    ],
  });
}

// Calendar for payroll and route workbooks. Null keeps the built-in year.
export function calendarForOfficeState(state) {
  const year = savedSchoolYear(state);
  if (!year) return null;
  return schoolYearGeneration(year).calendar;
}
