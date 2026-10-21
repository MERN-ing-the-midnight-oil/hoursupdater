import assert from 'node:assert/strict';
import test from 'node:test';
import { getSchoolDays } from '../src/logic/calendar.js';
import { isEarlyReleaseDate } from '../src/logic/earlyRelease.js';
import {
  builtinSchoolYear,
  calendarForOfficeState,
  describeSchoolYear,
  earlyReleaseRulesForState,
  formatSchoolYearListing,
  holidayListForState,
  parseSchoolYearListing,
  savedSchoolYear,
  blankSchoolYear,
  schoolYearCalendarDraft,
  schoolYearFromMarks,
  schoolYearGeneration,
  schoolYearMarks,
  schoolYearMonths,
  schoolYearSpan,
} from '../src/logic/schoolYear.js';
import { buildMonthlySummaryMath } from '../office-tracker/src/monthlyTimeSummary.js';
import { overtimeForPairs } from '../office-tracker/src/overtimeRules.js';
import { loadState, mergeSharedDriverList, saveState } from '../office-tracker/web/store.js';

const NEXT_YEAR = `
School year: 2027-2028
First day: September 8, 2027
Last day: June 16, 2028

Holidays
September 6, 2027 Labor Day
10/11/2027 Indigenous Peoples Day

Breaks
November 25, 2027 to November 26, 2027 Thanksgiving Recess

No school
January 3, 2028 Teachers report

Early release
2027-11-24 Day before Thanksgiving
`;

function memoryStorage() {
  /** @type {Record<string, string>} */
  const data = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
  };
}

test('the built-in list is the Bellingham 2026-2027 year, with Thursday early dismissal', () => {
  const year = builtinSchoolYear();
  assert.equal(year.school_year, '2026-2027');
  assert.equal(year.first_day, '2026-08-31');
  assert.equal(year.last_day, '2027-06-11');
  assert.equal(year.early_release_thursdays, true);
  assert.deepEqual(year.early_release.map((day) => day.date), ['2027-06-11']);
  const again = parseSchoolYearListing(formatSchoolYearListing(year));
  assert.deepEqual(again, year);
  assert.equal(getSchoolDays(schoolYearGeneration(year).calendar).length, 179);
  assert.match(describeSchoolYear(year), /built-in 2026-2027 Bellingham Public Schools/);
});

test('a pasted list sets holidays, breaks, days with no school, and early release', () => {
  const year = parseSchoolYearListing(NEXT_YEAR);
  assert.equal(year.school_year, '2027-2028');
  assert.equal(year.first_day, '2027-09-08');
  assert.equal(year.last_day, '2028-06-16');
  assert.deepEqual(year.holidays, [
    { date: '2027-09-06', label: 'Labor Day' },
    { date: '2027-10-11', label: 'Indigenous Peoples Day' },
  ]);
  assert.deepEqual(year.breaks, [
    { start: '2027-11-25', end: '2027-11-26', label: 'Thanksgiving Recess' },
  ]);
  assert.deepEqual(year.no_school, [{ date: '2028-01-03', label: 'Teachers report' }]);
  assert.equal(year.early_release_thursdays, false);
  assert.deepEqual(year.early_release, [{ date: '2027-11-24', label: 'Day before Thanksgiving' }]);

  const { calendar } = schoolYearGeneration(year);
  const byDate = Object.fromEntries(calendar.days.map((day) => [day.date, day]));
  assert.equal(byDate['2027-09-06'].is_school_day, false);
  assert.equal(byDate['2027-10-11'].is_school_day, false);
  assert.equal(byDate['2027-10-11'].reason, 'Indigenous Peoples Day');
  assert.equal(byDate['2027-11-25'].is_school_day, false);
  assert.equal(byDate['2028-01-03'].is_school_day, false);
  assert.equal(byDate['2028-01-03'].reason, 'Teachers report');
  assert.equal(byDate['2027-11-24'].is_school_day, true);

  const schoolDays = getSchoolDays(calendar);
  const rules = earlyReleaseRulesForState({ schoolYear: year });
  assert.equal(isEarlyReleaseDate('2027-11-24', schoolDays, rules), true);
  assert.equal(isEarlyReleaseDate('2027-10-07', schoolDays, rules), false);
  assert.match(describeSchoolYear(year, { saved: true }), /2027-2028 is saved/);
  assert.match(describeSchoolYear(year, { saved: true }), /1 listed day/);
});

test('prefixed lines and Every Thursday are part of the same list', () => {
  const year = parseSchoolYearListing(`
First day of school: 2027-09-08
Last day of school: 2028-06-16
Holiday: 2027-09-06 Labor Day
Break: 2027-12-24 through 2028-01-01 Winter Recess
No school: 2028-01-03 Teachers report
Early release: Every Thursday
Half day: 2027-11-24 Day before Thanksgiving
`);
  assert.equal(year.early_release_thursdays, true);
  assert.equal(year.breaks[0].label, 'Winter Recess');
  assert.equal(year.no_school[0].date, '2028-01-03');
  const rules = earlyReleaseRulesForState({ schoolYear: year });
  const schoolDays = getSchoolDays(schoolYearGeneration(year).calendar);
  assert.equal(isEarlyReleaseDate('2027-10-07', schoolDays, rules), true);
  assert.equal(isEarlyReleaseDate('2027-11-24', schoolDays, rules), true);
  assert.equal(isEarlyReleaseDate('2027-10-08', schoolDays, rules), false);
});

test('a list with a bad line, a date outside the year, or a repeated day is refused', () => {
  assert.throws(
    () => parseSchoolYearListing('First day: 2027-09-08\nLast day: 2028-06-16\nHolidays\nnext Tuesday off'),
    /Could not read "next Tuesday off"/
  );
  assert.throws(() => parseSchoolYearListing('Holidays\n2027-09-06 Labor Day'), /first day of school/);
  assert.throws(
    () =>
      parseSchoolYearListing(
        'First day: 2027-09-08\nLast day: 2028-06-16\nHolidays\n2028-07-04 Independence Day'
      ),
    /outside the school year/
  );
  assert.throws(
    () =>
      parseSchoolYearListing(
        'First day: 2027-09-08\nLast day: 2028-06-16\nHolidays\n2027-09-06 Labor Day\nEarly release\n2027-09-06'
      ),
    /both a holiday and an early release day/
  );
});

test('a named school year is July through June, with summer weekdays already off', () => {
  assert.equal(schoolYearSpan('2007-2008')?.first_day, '2007-07-01');
  assert.equal(schoolYearSpan('2008-2009')?.last_day, '2009-06-30');
  assert.equal(schoolYearSpan('2007-2009'), null);
  const blank = blankSchoolYear('2007-2008');
  assert.deepEqual(blank.closed, []);
  const months = schoolYearMonths(blank.first_day, blank.last_day);
  assert.deepEqual(
    months.slice(0, 6).map((month) => month.title),
    ['July 2007', 'August 2007', 'September 2007', 'October 2007', 'November 2007', 'December 2007']
  );
  assert.deepEqual(
    months.slice(6).map((month) => month.title),
    ['January 2008', 'February 2008', 'March 2008', 'April 2008', 'May 2008', 'June 2008']
  );
  const draft = schoolYearCalendarDraft(builtinSchoolYear());
  assert.equal(draft.first_day, '2026-07-01');
  assert.equal(draft.last_day, '2027-06-30');
  assert.ok(draft.closed.includes('2026-08-28'));
  assert.ok(draft.closed.includes('2026-09-07'));
  assert.equal(draft.closed.includes('2026-08-31'), false);
});

test('calendar marks turn clicked holidays and early release days into a school year', () => {
  const marks = schoolYearMarks(builtinSchoolYear());
  assert.ok(marks.closed.includes('2026-09-07'));
  assert.ok(marks.closed.includes('2026-11-26'));
  assert.ok(marks.early.includes('2026-10-08'));
  assert.ok(marks.early.includes('2027-06-11'));
  assert.equal(marks.early.includes('2026-11-25'), false);
  assert.equal(marks.early.includes('2026-10-07'), false);
  assert.equal(marks.early.includes('2026-11-26'), false);

  const months = schoolYearMonths(marks.first_day, marks.last_day);
  assert.equal(months[0].title, 'August 2026');
  assert.equal(months.at(-1)?.title, 'June 2027');
  assert.equal(months[0].weeks[0][6], '2026-08-01');

  const saved = schoolYearFromMarks({
    ...marks,
    closed: ['2027-09-07', '2027-11-25', '2027-11-26'],
    early: ['2027-10-07', '2027-11-24'],
    first_day: '2027-09-08',
    last_day: '2028-06-16',
    school_year: '2027-2028',
    labels: { '2027-09-07': 'Labor Day', '2027-11-24': 'Day before Thanksgiving' },
  });
  assert.equal(saved.early_release_thursdays, false);
  assert.deepEqual(
    saved.holidays.map((day) => day.date),
    ['2027-09-07', '2027-11-25', '2027-11-26']
  );
  assert.equal(saved.holidays[0].label, 'Labor Day');
  assert.deepEqual(saved.early_release, [
    { date: '2027-10-07', label: '' },
    { date: '2027-11-24', label: 'Day before Thanksgiving' },
  ]);
  const again = schoolYearMarks(saved);
  assert.deepEqual(again.early, ['2027-10-07', '2027-11-24']);
  assert.equal(getSchoolDays(schoolYearGeneration(saved).calendar).includes('2027-10-07'), true);
  assert.equal(getSchoolDays(schoolYearGeneration(saved).calendar).includes('2027-11-25'), false);
});

test('the saved year is what payroll, holidays, and a reopened office use', () => {
  const year = parseSchoolYearListing(NEXT_YEAR);
  const storage = memoryStorage();
  saveState({ version: 1, currentProfileId: null, profiles: {}, schoolYear: year }, storage);
  const loaded = loadState(storage);
  assert.equal(savedSchoolYear(loaded)?.school_year, '2027-2028');
  assert.equal(holidayListForState(loaded)[0].label, 'Labor Day');
  assert.equal(calendarForOfficeState({}), null);
  assert.equal(calendarForOfficeState(loaded)?.school_year, '2027-2028');

  const cleared = mergeSharedDriverList({ version: 1, profiles: {}, schoolYear: year }, { schoolYear: null });
  assert.equal(cleared.schoolYear, null);
  saveState({ version: 1, currentProfileId: null, profiles: {}, schoolYear: null }, storage);
  assert.equal(savedSchoolYear(loadState(storage)), null);
  assert.equal(holidayListForState(loadState(storage))[0].date, '2026-09-07');

  const september = buildMonthlySummaryMath({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    now: new Date(2027, 8, 20, 12, 0),
    focus: { year: 2027, monthIndex: 8, periodId: '1' },
    punches: [],
    officeState: loaded,
  });
  const days = september.periods[0].days;
  assert.equal(days.find((day) => day.day === 6).holiday, 'Labor Day');
  assert.equal(days.find((day) => day.day === 7).holiday, '');

  const start = new Date(2027, 8, 6, 8, 0, 0);
  const end = new Date(2027, 8, 6, 8, 30, 0);
  const pairs = [{ start, end, clockIn: { id: 'in' }, clockOut: { id: 'out' } }];
  const rules = {
    dailyHours: null,
    weeklyHours: null,
    eveningStart: null,
    morningEnd: null,
    weekendOvertime: false,
    holidayOvertime: true,
    multiplier: 1.5,
  };
  const counted = overtimeForPairs(pairs, rules, year.holidays);
  assert.equal([...counted.values()][0].actual, 30);
  assert.equal([...overtimeForPairs(pairs, rules, []).values()][0].actual, 0);
});
