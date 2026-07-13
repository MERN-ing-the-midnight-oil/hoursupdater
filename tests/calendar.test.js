import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addSchoolDays,
  countSchoolDaysBetween,
  daysRemainingInWindow,
  isWindowExpired,
} from '../src/logic/calendar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const calendar = JSON.parse(
  await fs.readFile(path.join(__dirname, 'fixtures/school-calendar.json'), 'utf8')
);

describe('calendar', () => {
  it('adds 15 school days forward from a start date', () => {
    const expires = addSchoolDays(calendar, '2025-09-02', 15);
    assert.equal(expires, '2025-09-23');
  });

  it('returns the same date when count is zero', () => {
    assert.equal(addSchoolDays(calendar, '2025-09-02', 0), '2025-09-02');
  });

  it('counts school days between dates', () => {
    assert.equal(countSchoolDaysBetween(calendar, '2025-09-02', '2025-09-05'), 3);
  });

  it('detects window expiration after the expires date', () => {
    assert.equal(isWindowExpired('2025-09-23', '2025-09-23'), false);
    assert.equal(isWindowExpired('2025-09-24', '2025-09-23'), true);
  });

  it('computes days remaining in an open window', () => {
    const remaining = daysRemainingInWindow(calendar, '2025-09-15', '2025-09-23');
    assert.equal(remaining, 7);
  });

  it('throws visibly when counting past the last school day in the calendar', () => {
    const short = {
      school_year: 'test',
      school_days: ['2025-09-02', '2025-09-03', '2025-09-04'],
    };
    assert.throws(
      () => addSchoolDays(short, '2025-09-02', 15),
      /School calendar ends at 2025-09-04/
    );
  });

  it('reads is_school_day from full day lists (no summer/month hardcoding)', () => {
    const full = {
      school_year: '2026-2027',
      days: [
        {
          date: '2026-07-10',
          day_of_week: 'Friday',
          is_school_day: false,
          reason: 'Outside school year (summer)',
        },
        {
          date: '2026-08-31',
          day_of_week: 'Monday',
          is_school_day: true,
          reason: '',
        },
        {
          date: '2026-09-01',
          day_of_week: 'Tuesday',
          is_school_day: true,
          reason: '',
        },
      ],
    };
    // From mid-summer: first school day after 2026-07-10 is Aug 31.
    assert.equal(addSchoolDays(full, '2026-07-10', 1), '2026-08-31');
    assert.equal(addSchoolDays(full, '2026-07-10', 2), '2026-09-01');
  });
});
