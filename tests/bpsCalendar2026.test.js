import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addSchoolDays, getSchoolDays } from '../src/logic/calendar.js';
import {
  BPS_2026_2027_INPUT,
  buildBps2026_2027Calendar,
} from '../employee-tracker/src/bpsCalendar2026.js';

describe('BPS 2026-2027 school calendar', () => {
  const { calendar, summary } = buildBps2026_2027Calendar();
  const byDate = Object.fromEntries(calendar.days.map((day) => [day.date, day]));

  it('matches the official 180-day student year', () => {
    assert.equal(BPS_2026_2027_INPUT.first_day, '2026-09-08');
    assert.equal(BPS_2026_2027_INPUT.last_day, '2027-06-22');
    assert.equal(summary.school_day_count, 180);
    assert.equal(getSchoolDays(calendar).length, 180);
    assert.equal(byDate['2026-09-08']?.is_school_day, true);
    assert.equal(byDate['2027-06-22']?.is_school_day, true);
  });

  it('treats holidays, recesses, and teacher-only days as non-school days', () => {
    assert.equal(byDate['2026-10-12']?.is_school_day, false);
    assert.equal(byDate['2026-11-11']?.is_school_day, false);
    assert.equal(byDate['2026-11-26']?.is_school_day, false);
    assert.equal(byDate['2026-12-24']?.is_school_day, false);
    assert.equal(byDate['2027-01-01']?.is_school_day, false);
    assert.equal(byDate['2027-01-04']?.is_school_day, false);
    assert.equal(byDate['2027-01-05']?.is_school_day, true);
    assert.equal(byDate['2027-02-15']?.is_school_day, false);
    assert.equal(byDate['2027-02-16']?.is_school_day, false);
    assert.equal(byDate['2027-03-26']?.is_school_day, false);
    assert.equal(byDate['2027-04-19']?.is_school_day, false);
    assert.equal(byDate['2027-05-31']?.is_school_day, false);
    assert.equal(byDate['2027-06-18']?.is_school_day, false);
  });

  it('counts 15 school days the same way the district app does', () => {
    assert.equal(addSchoolDays(calendar, '2026-09-08', 15), '2026-09-29');
  });
});
