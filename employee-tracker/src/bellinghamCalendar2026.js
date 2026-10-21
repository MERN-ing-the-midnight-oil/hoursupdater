import { generateSchoolYearCalendar } from '../../src/logic/schoolCalendarGenerate.js';

// Bellingham Public Schools 2026–27 district calendar.
// Grades 1–12 start Monday, August 31, 2026.
// Tentative last day is Friday, June 11, 2027 (early dismissal).
// June 14–16 are weather makeup days only if needed, so they are not school days.
// Every Thursday that school is in session is an early dismissal, and so is the last day.
export const BELLINGHAM_2026_2027_SOURCE = {
  name: 'Bellingham Public Schools',
  school_year: '2026-2027',
  document: '2026-27 District Calendar',
  url: 'https://www.bellinghamschools.org/calendar',
};

export const BELLINGHAM_2026_2027_INPUT = {
  school_year: '2026-2027',
  first_day: '2026-08-31',
  last_day: '2027-06-11',
  breaks: [
    { start: '2026-09-18', end: '2026-09-18', label: 'Teacher workday' },
    { start: '2026-12-21', end: '2027-01-01', label: 'Winter break' },
    { start: '2027-01-22', end: '2027-01-22', label: 'Treaty Day' },
    { start: '2027-01-25', end: '2027-01-25', label: 'Semester break' },
    { start: '2027-04-05', end: '2027-04-09', label: 'Spring break' },
    { start: '2027-05-21', end: '2027-05-21', label: 'No school or weather makeup day' },
  ],
  holidays: [
    { date: '2026-09-07', label: 'Labor Day' },
    { date: '2026-11-11', label: 'Veterans Day' },
    { date: '2026-11-26', label: 'Thanksgiving' },
    { date: '2026-11-27', label: 'Thanksgiving' },
    { date: '2027-01-18', label: 'Martin Luther King Jr. Day' },
    { date: '2027-02-15', label: 'Presidents Day' },
    { date: '2027-05-31', label: 'Memorial Day' },
    { date: '2027-06-18', label: 'Juneteenth' },
  ],
};

export function buildBellingham2026_2027Calendar() {
  const { calendar, summary } = generateSchoolYearCalendar(BELLINGHAM_2026_2027_INPUT);
  return {
    calendar: {
      ...calendar,
      district: BELLINGHAM_2026_2027_SOURCE.name,
      source_document: BELLINGHAM_2026_2027_SOURCE.document,
    },
    summary,
    source: BELLINGHAM_2026_2027_SOURCE,
  };
}
