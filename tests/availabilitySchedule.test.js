import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dayIsOpenOnSchedule, lateInterestList, rangesOnSchedule, sameAsCycle, weekdayKey } from '../public/board/dailyAward.js';
import {
  closeDailyOfferings,
  driverBoardPayload,
  setAvailabilitySchedule,
  setLateAvailability,
} from '../src/logic/extraWorkBoard.js';

const NOW = '2026-10-25T18:00:00.000Z';

function emptyBoard() {
  return { postings: [], notifications: [], closed_days: [], availability: [] };
}

function save(board, extras = {}) {
  return setAvailabilitySchedule(board, {
    driverId: 'senior',
    now: NOW,
    today: '2026-10-25',
    ...extras,
  });
}

describe('weekday availability', () => {
  it('names the weekday of a calendar date', () => {
    assert.equal(weekdayKey('2026-10-26'), 'mon');
    assert.equal(weekdayKey('2026-10-25'), 'sun');
  });

  it('repeats a weekday, follows same-as, and lets one date replace it', () => {
    const saved = save(emptyBoard(), {
      weekdays: {
        mon: { ranges: [{ start: '15:00', end: '18:00' }], note: 'After the PM route' },
        wed: { same_as: 'mon' },
      },
      exceptions: [{ date: '2026-11-02', ranges: [], note: 'Day off' }],
    });
    const schedule = saved.availability_schedules[0];
    assert.equal(schedule.weekdays.mon.note, 'After the PM route');
    assert.deepEqual(rangesOnSchedule(schedule, '2026-10-26'), [{ start: '15:00', end: '18:00' }]);
    assert.deepEqual(rangesOnSchedule(schedule, '2026-10-28'), [{ start: '15:00', end: '18:00' }]);
    assert.deepEqual(rangesOnSchedule(schedule, '2026-11-02'), []);
    assert.equal(saved.availability.some((mark) => mark.date === '2026-10-26'), true);
    assert.equal(saved.availability.some((mark) => mark.date === '2026-10-28'), true);
    assert.equal(saved.availability.some((mark) => mark.date === '2026-10-27'), false);
    assert.equal(saved.availability.some((mark) => mark.date === '2026-11-02'), false);
  });

  it('keeps a closed day when the usual week changes', () => {
    const saved = save(emptyBoard(), {
      weekdays: { mon: { ranges: [{ start: '15:00', end: '18:00' }] } },
    });
    const closed = closeDailyOfferings(saved, { date: '2026-10-26', now: '2026-10-26T15:00:00.000Z' });
    assert.deepEqual(closed.board.availability.find((mark) => mark.date === '2026-10-26').ranges, [
      { start: '15:00', end: '18:00' },
    ]);
    const changed = save(closed.board, {
      weekdays: { mon: { ranges: [{ start: '16:00', end: '19:00' }] } },
      now: '2026-10-26T16:00:00.000Z',
      today: '2026-10-26',
    });
    assert.deepEqual(changed.availability.find((mark) => mark.date === '2026-10-26').ranges, [
      { start: '15:00', end: '18:00' },
    ]);
    assert.deepEqual(changed.availability.find((mark) => mark.date === '2026-11-02').ranges, [
      { start: '16:00', end: '19:00' },
    ]);
  });

  it('refuses an exception that would change a closed day', () => {
    const saved = save(emptyBoard(), {
      weekdays: { mon: { ranges: [{ start: '15:00', end: '18:00' }] } },
    });
    const closed = closeDailyOfferings(saved, { date: '2026-10-26', now: '2026-10-26T15:00:00.000Z' });
    assert.throws(
      () =>
        save(closed.board, {
          weekdays: { mon: { ranges: [{ start: '15:00', end: '18:00' }] } },
          exceptions: [{ date: '2026-10-26', ranges: [], note: '' }],
          today: '2026-10-26',
        }),
      /before 8:00/
    );
  });

  it('can record the times a closed day already had', () => {
    const legacy = {
      ...emptyBoard(),
      closed_days: [{ date: '2026-10-22', closed_at: '2026-10-22T15:00:00.000Z' }],
      availability: [
        {
          date: '2026-10-22',
          driver_id: 'senior',
          ranges: [{ start: '09:00', end: '12:00' }],
          marked_at: NOW,
        },
      ],
    };
    const kept = save(legacy, {
      weekdays: { mon: { ranges: [{ start: '15:00', end: '18:00' }] } },
      exceptions: [{ date: '2026-10-22', ranges: [{ start: '09:00', end: '12:00' }], note: '' }],
    });
    assert.deepEqual(kept.availability.find((mark) => mark.date === '2026-10-22').ranges, [
      { start: '09:00', end: '12:00' },
    ]);
  });

  it('rejects a circle and a date that is not real', () => {
    assert.equal(sameAsCycle({ mon: { same_as: 'tue' }, tue: { same_as: 'mon' } }), true);
    assert.throws(
      () =>
        save(emptyBoard(), {
          weekdays: { mon: { same_as: 'tue' }, tue: { same_as: 'mon' } },
        }),
      /circle/
    );
    assert.throws(
      () => save(emptyBoard(), { exceptions: [{ date: '2026-02-31', ranges: [] }] }),
      /real date/
    );
  });

  it('turns one saved date into an exception on an existing week', () => {
    const saved = save(emptyBoard(), {
      weekdays: { mon: { ranges: [{ start: '15:00', end: '18:00' }] } },
      exceptions: [{ date: '2026-11-02', ranges: [], note: 'Day off' }],
    });
    const once = setLateAvailability(saved, {
      date: '2026-10-27',
      driverId: 'senior',
      ranges: [{ start: '10:00', end: '12:00' }],
      now: NOW,
    });
    const schedule = once.availability_schedules[0];
    assert.deepEqual(schedule.exceptions.find((row) => row.date === '2026-10-27').ranges, [
      { start: '10:00', end: '12:00' },
    ]);
    assert.equal(schedule.exceptions.some((row) => row.date === '2026-11-02'), true);
    assert.equal(schedule.weekdays.mon.ranges[0].start, '15:00');
  });

  it('covers any late addition when a day is totally open on the mid-day', () => {
    const saved = save(emptyBoard(), {
      weekdays: {
        mon: { open: true, ranges: [{ start: '09:00', end: '11:00' }], note: 'No clock limit' },
        wed: { same_as: 'mon' },
      },
      exceptions: [
        { date: '2026-11-02', ranges: [], note: 'Day off' },
        { date: '2026-11-03', open: true, ranges: [{ start: '12:00', end: '13:00' }], note: 'Open Tuesday' },
      ],
    });
    const schedule = saved.availability_schedules[0];
    assert.equal(schedule.weekdays.mon.open, true);
    assert.deepEqual(schedule.weekdays.mon.ranges, []);
    assert.equal(dayIsOpenOnSchedule(schedule, '2026-10-26'), true);
    assert.equal(dayIsOpenOnSchedule(schedule, '2026-10-28'), true);
    assert.equal(dayIsOpenOnSchedule(schedule, '2026-11-02'), false);
    assert.equal(dayIsOpenOnSchedule(schedule, '2026-11-03'), true);
    const monday = saved.availability.find((mark) => mark.date === '2026-10-26');
    assert.equal(monday.open, true);
    assert.deepEqual(monday.ranges, []);
    assert.equal(saved.availability.some((mark) => mark.date === '2026-11-02'), false);
    const tuesday = saved.availability.find((mark) => mark.date === '2026-11-03');
    assert.equal(tuesday.open, true);
    assert.deepEqual(tuesday.ranges, []);
    const rows = lateInterestList({
      drivers: [
        { driver_id: 'senior', name: 'Senior Driver', seniority_rank: 1 },
        { driver_id: 'junior', name: 'Junior Driver', seniority_rank: 4 },
      ],
      marks: saved.availability,
      date: '2026-10-26',
      interval: { start: 6 * 60, end: 22 * 60 },
    });
    assert.deepEqual(
      rows.map((row) => row.driver.driver_id),
      ['senior']
    );
    assert.equal(rows[0].open, true);
    const early = lateInterestList({
      drivers: [{ driver_id: 'junior', name: 'Junior Driver', seniority_rank: 4 }],
      marks: [{ date: '2026-10-26', driver_id: 'junior', ranges: [{ start: '09:00', end: '11:00' }] }],
      date: '2026-10-26',
      interval: { start: 6 * 60, end: 22 * 60 },
    });
    assert.deepEqual(early, []);
  });

  it('keeps a closed totally-open day when the usual week changes', () => {
    const saved = save(emptyBoard(), { weekdays: { mon: { open: true } } });
    const closed = closeDailyOfferings(saved, { date: '2026-10-26', now: '2026-10-26T15:00:00.000Z' });
    const frozen = closed.board.availability.find((mark) => mark.date === '2026-10-26');
    assert.equal(frozen.open, true);
    assert.deepEqual(frozen.ranges, []);
    const changed = save(closed.board, {
      weekdays: { mon: { ranges: [{ start: '16:00', end: '19:00' }] } },
      now: '2026-10-26T16:00:00.000Z',
      today: '2026-10-26',
    });
    const kept = changed.availability.find((mark) => mark.date === '2026-10-26');
    assert.equal(kept.open, true);
    assert.deepEqual(kept.ranges, []);
    assert.deepEqual(changed.availability.find((mark) => mark.date === '2026-11-02').ranges, [
      { start: '16:00', end: '19:00' },
    ]);
    assert.equal(changed.availability.find((mark) => mark.date === '2026-11-02').open, undefined);
    assert.throws(
      () =>
        save(closed.board, {
          weekdays: { mon: { open: true } },
          exceptions: [{ date: '2026-10-26', ranges: [{ start: '16:00', end: '19:00' }] }],
          today: '2026-10-26',
        }),
      /before 8:00/
    );
  });

  it('clips a long note and shows one driver only their own week', () => {
    const saved = save(emptyBoard(), {
      weekdays: { mon: { ranges: [{ start: '15:00', end: '18:00' }], note: 'x'.repeat(120) } },
    });
    assert.equal(saved.availability_schedules[0].weekdays.mon.note.length, 80);
    const both = setAvailabilitySchedule(saved, {
      driverId: 'junior',
      weekdays: { fri: { ranges: [{ start: '12:00', end: '14:00' }], note: 'Junior only' } },
      now: NOW,
      today: '2026-10-25',
    });
    const view = driverBoardPayload(both, {
      driver: { driver_id: 'senior', name: 'Senior Driver' },
      today: '2026-10-25',
    });
    assert.equal(view.my_schedule.weekdays.mon.ranges[0].start, '15:00');
    assert.equal(JSON.stringify(view).includes('Junior only'), false);
    assert.equal(JSON.stringify(view).includes('junior'), false);
  });
});
