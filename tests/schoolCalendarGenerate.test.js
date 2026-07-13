import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultCoverageWindow,
  findCalendarGenerationConflicts,
  generateSchoolYearCalendar,
  mergeGeneratedSchoolCalendar,
} from '../src/logic/schoolCalendarGenerate.js';
import { addSchoolDays, getSchoolDays } from '../src/logic/calendar.js';

describe('schoolCalendarGenerate', () => {
  it('uses July→June coverage around the school year', () => {
    const window = defaultCoverageWindow('2026-08-31', '2027-06-11');
    assert.equal(window.coverage_start, '2026-07-01');
    assert.equal(window.coverage_end, '2027-06-30');
  });

  it('marks weekdays as school days and weekends as Weekend', () => {
    const { calendar, summary } = generateSchoolYearCalendar({
      first_day: '2026-08-31',
      last_day: '2026-09-04',
      breaks: [],
      holidays: [],
    });
    const byDate = Object.fromEntries(calendar.days.map((d) => [d.date, d]));
    assert.equal(byDate['2026-08-31'].is_school_day, true); // Monday
    assert.equal(byDate['2026-09-04'].is_school_day, true); // Friday
    assert.equal(byDate['2026-09-05'].is_school_day, false); // Saturday after last day → summer
    assert.equal(byDate['2026-09-05'].reason, 'Outside school year (summer)');
    assert.equal(byDate['2026-07-01'].reason, 'Outside school year (summer)');
    // Weekend inside school year
    const { calendar: cal2 } = generateSchoolYearCalendar({
      first_day: '2026-08-31',
      last_day: '2026-09-11',
    });
    const sat = cal2.days.find((d) => d.date === '2026-09-05');
    assert.equal(sat?.is_school_day, false);
    assert.equal(sat?.reason, 'Weekend');
    assert.ok(summary.school_day_count >= 5);
  });

  it('applies breaks and holidays with labels', () => {
    const { calendar, summary } = generateSchoolYearCalendar({
      first_day: '2026-08-31',
      last_day: '2026-12-18',
      breaks: [{ start: '2026-11-23', end: '2026-11-27', label: 'Thanksgiving Break' }],
      holidays: [{ date: '2026-09-07', label: 'Labor Day' }],
    });
    const byDate = Object.fromEntries(calendar.days.map((d) => [d.date, d]));
    assert.equal(byDate['2026-09-07'].is_school_day, false);
    assert.equal(byDate['2026-09-07'].reason, 'Labor Day');
    assert.equal(byDate['2026-11-25'].is_school_day, false);
    assert.equal(byDate['2026-11-25'].reason, 'Thanksgiving Break');
    assert.equal(summary.holidays_applied[0].label, 'Labor Day');
    // Generated calendar is usable by addSchoolDays with no month hardcoding.
    assert.equal(addSchoolDays(calendar, '2026-07-10', 1), '2026-08-31');
    assert.ok(getSchoolDays(calendar).includes('2026-08-31'));
  });

  it('surfaces overlaps instead of silently merging without notice', () => {
    const first = generateSchoolYearCalendar({
      first_day: '2025-09-02',
      last_day: '2026-06-12',
    });
    const second = generateSchoolYearCalendar({
      first_day: '2026-08-31',
      last_day: '2027-06-11',
    });
    // Adjacent years share nothing if coverages are Jul–Jun contiguous without overlap...
    // 2025-26 ends 2026-06-30, 2026-27 starts 2026-07-01 — zero overlap.
    const adjacent = findCalendarGenerationConflicts(first.calendar, second.calendar);
    assert.equal(adjacent.has_overlap, false);

    const regen = findCalendarGenerationConflicts(first.calendar, first.calendar);
    assert.equal(regen.has_overlap, true);
    assert.ok(regen.overlapping_date_count > 300);
  });

  it('merges generated years into continuous coverage', () => {
    const y1 = generateSchoolYearCalendar({
      first_day: '2025-09-02',
      last_day: '2026-06-12',
      school_year: '2025-2026',
    });
    const y2 = generateSchoolYearCalendar({
      first_day: '2026-08-31',
      last_day: '2027-06-11',
      school_year: '2026-2027',
    });
    const merged = mergeGeneratedSchoolCalendar(y1.calendar, y2.calendar);
    assert.equal(merged.coverage_start, '2025-07-01');
    assert.equal(merged.coverage_end, '2027-06-30');
    assert.equal(merged.days.length, 730);
  });
});
