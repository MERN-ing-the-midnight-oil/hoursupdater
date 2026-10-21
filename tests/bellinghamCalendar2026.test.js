import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addSchoolDays, getSchoolDays } from '../src/logic/calendar.js';
import {
  BELLINGHAM_2026_2027_INPUT,
  buildBellingham2026_2027Calendar,
} from '../employee-tracker/src/bellinghamCalendar2026.js';

describe('Bellingham 2026-2027 school calendar', () => {
  const { calendar, summary, source } = buildBellingham2026_2027Calendar();
  const byDate = Object.fromEntries(calendar.days.map((day) => [day.date, day]));

  it('matches the Bellingham Public Schools 2026-2027 year', () => {
    assert.equal(source.name, 'Bellingham Public Schools');
    assert.equal(BELLINGHAM_2026_2027_INPUT.first_day, '2026-08-31');
    assert.equal(BELLINGHAM_2026_2027_INPUT.last_day, '2027-06-11');
    assert.equal(summary.school_day_count, 179);
    assert.equal(getSchoolDays(calendar).length, 179);
    assert.equal(byDate['2026-08-31']?.is_school_day, true);
    assert.equal(byDate['2027-06-11']?.is_school_day, true);
  });

  it('treats holidays, breaks, and other no-school days as non-school days', () => {
    assert.equal(byDate['2026-09-07']?.is_school_day, false);
    assert.equal(byDate['2026-09-18']?.is_school_day, false);
    assert.equal(byDate['2026-11-11']?.is_school_day, false);
    assert.equal(byDate['2026-11-26']?.is_school_day, false);
    assert.equal(byDate['2026-12-21']?.is_school_day, false);
    assert.equal(byDate['2027-01-04']?.is_school_day, true);
    assert.equal(byDate['2027-01-18']?.is_school_day, false);
    assert.equal(byDate['2027-01-22']?.is_school_day, false);
    assert.equal(byDate['2027-01-25']?.is_school_day, false);
    assert.equal(byDate['2027-02-15']?.is_school_day, false);
    assert.equal(byDate['2027-04-05']?.is_school_day, false);
    assert.equal(byDate['2027-05-21']?.is_school_day, false);
    assert.equal(byDate['2027-05-31']?.is_school_day, false);
    assert.equal(byDate['2027-06-14']?.is_school_day, false);
  });

  it('counts 15 school days the same way the district app does', () => {
    assert.equal(addSchoolDays(calendar, '2026-08-31', 15), '2026-09-23');
  });
});
