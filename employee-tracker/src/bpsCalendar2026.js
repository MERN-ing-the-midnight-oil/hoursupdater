import { generateSchoolYearCalendar } from '../../src/logic/schoolCalendarGenerate.js';

/**
 * Official Boston Public Schools SY2026–27 district calendar.
 * Source: SY26-27 BPS District Calendar (bostonpublicschools.org).
 *
 * Student instructional days (what bus/work days follow):
 *   First day (grades 1–12): 2026-09-08
 *   Last day (180 days, no cancellations): 2027-06-22
 *
 * Teacher-only report days (Sept 2–3, Jan 4) are not student school days.
 * Early-release days remain school days.
 */
export const BPS_2026_2027_SOURCE = {
  name: 'Boston Public Schools',
  school_year: '2026-2027',
  document: 'SY26-27 BPS District Calendar',
  url: 'https://www.bostonpublicschools.org',
};

export const BPS_2026_2027_INPUT = {
  school_year: '2026-2027',
  first_day: '2026-09-08',
  last_day: '2027-06-22',
  breaks: [
    { start: '2026-11-26', end: '2026-11-27', label: 'Thanksgiving Recess' },
    { start: '2026-12-24', end: '2027-01-01', label: 'Winter Recess' },
    { start: '2027-02-16', end: '2027-02-19', label: 'February Recess' },
    { start: '2027-04-20', end: '2027-04-23', label: 'Spring Recess' },
  ],
  holidays: [
    { date: '2026-09-07', label: 'Labor Day' },
    { date: '2026-10-12', label: 'Indigenous Peoples’ Day' },
    { date: '2026-11-11', label: 'Veterans Day' },
    { date: '2027-01-04', label: 'Teachers/paras report (students off)' },
    { date: '2027-01-18', label: 'Martin Luther King Jr. Day' },
    { date: '2027-02-15', label: 'Presidents’ Day' },
    { date: '2027-03-26', label: 'Good Friday' },
    { date: '2027-04-19', label: 'Patriots’ Day' },
    { date: '2027-05-31', label: 'Memorial Day' },
    { date: '2027-06-18', label: 'Juneteenth (observed)' },
  ],
};

/**
 * @returns {{
 *   calendar: import('../../src/logic/calendar.js').SchoolCalendar,
 *   summary: object,
 *   source: typeof BPS_2026_2027_SOURCE,
 * }}
 */
export function buildBps2026_2027Calendar() {
  const { calendar, summary } = generateSchoolYearCalendar(BPS_2026_2027_INPUT);
  return {
    calendar: {
      ...calendar,
      district: BPS_2026_2027_SOURCE.name,
      source_document: BPS_2026_2027_SOURCE.document,
    },
    summary,
    source: BPS_2026_2027_SOURCE,
  };
}
