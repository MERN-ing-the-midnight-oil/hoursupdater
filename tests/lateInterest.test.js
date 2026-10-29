import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lateInterestList, normalizeTimeRanges, rangeCovers } from '../public/board/dailyAward.js';
import { awardIsDue, pacificClock } from '../src/logic/dailyWorkClock.js';
import {
  createPosting,
  publishPosting,
  setLateAvailability,
  upsertBid,
} from '../src/logic/extraWorkBoard.js';

const drivers = [
  { driver_id: 'senior', name: 'Senior Driver', seniority_rank: 1, hire_date: '2012-08-15' },
  { driver_id: 'junior', name: 'Junior Driver', seniority_rank: 4, hire_date: '2016-03-14' },
];

describe('late-work time ranges', () => {
  it('keeps ranges that end after they start', () => {
    const ranges = normalizeTimeRanges([
      { start: '13:00', end: '15:00' },
      { start: '9:00', end: '9:00' },
      { start: '09:00', end: '11:30' },
    ]);
    assert.deepEqual(ranges, [
      { start: '09:00', end: '11:30' },
      { start: '13:00', end: '15:00' },
    ]);
  });

  it('covers a job that sits inside touching ranges', () => {
    const ranges = [
      { start: '09:00', end: '11:00' },
      { start: '11:00', end: '13:00' },
    ];
    assert.equal(rangeCovers(ranges, { start: 9 * 60, end: 13 * 60 }), true);
    assert.equal(rangeCovers(ranges, { start: 10 * 60, end: 14 * 60 }), false);
  });

  it('lists drivers by seniority when their time covers the job', () => {
    const marks = [
      { date: '2026-10-22', driver_id: 'junior', ranges: [{ start: '09:00', end: '12:00' }] },
      { date: '2026-10-22', driver_id: 'senior', ranges: [{ start: '10:00', end: '14:00' }] },
      { date: '2026-10-23', driver_id: 'senior', ranges: [{ start: '10:00', end: '14:00' }] },
    ];
    const rows = lateInterestList({
      drivers,
      marks,
      date: '2026-10-22',
      interval: { start: 10 * 60, end: 12 * 60 },
    });
    assert.deepEqual(
      rows.map((row) => row.driver.driver_id),
      ['senior', 'junior']
    );
    const morning = lateInterestList({
      drivers,
      marks,
      date: '2026-10-22',
      interval: { start: 8 * 60, end: 9 * 60 + 30 },
    });
    assert.deepEqual(morning, []);
  });

  it('stores ranges before 8:00 and refuses a change after the day closes', () => {
    const created = createPosting(
      { postings: [], notifications: [], closed_days: [], availability: [] },
      {
        trip_number: '19901',
        trip_date: '2026-10-22',
        destination: 'Town',
        school: 'SMS',
        times: { clock_in: '10:00', clock_out: '12:00' },
        late_addition: true,
        list: 'daily',
      },
      '2026-10-22T14:00:00.000Z'
    );
    const marked = setLateAvailability(created.board, {
      date: '2026-10-22',
      driverId: 'senior',
      ranges: [{ start: '09:00', end: '15:00' }],
      now: '2026-10-22T14:00:00.000Z',
    });
    assert.deepEqual(marked.availability[0].ranges, [{ start: '09:00', end: '15:00' }]);
    const posted = publishPosting(marked, created.posting.id, '2026-10-22T14:00:00.000Z');
    assert.equal(posted.posting.late_addition, true);
    assert.throws(
      () => upsertBid(posted.board, created.posting.id, { driver_id: 'senior', initials: 'SR' }, '2026-10-22T14:00:00.000Z'),
      /not on the signup list/
    );
    const closed = {
      ...posted.board,
      closed_days: [{ date: '2026-10-22', closed_at: '2026-10-22T15:00:00.000Z' }],
    };
    assert.throws(
      () =>
        setLateAvailability(closed, {
          date: '2026-10-22',
          driverId: 'junior',
          ranges: [{ start: '10:00', end: '12:00' }],
          now: '2026-10-22T16:00:00.000Z',
        }),
      /before 8:00/
    );
  });
});

describe('8:00 award clock', () => {
  it('is due at 8:00 Pacific and not before', () => {
    assert.equal(awardIsDue(new Date('2026-10-21T14:59:00.000Z')), false);
    assert.equal(awardIsDue(new Date('2026-10-21T15:00:00.000Z')), true);
    assert.equal(pacificClock(new Date('2026-10-21T15:00:00.000Z')).date, '2026-10-21');
  });
});
