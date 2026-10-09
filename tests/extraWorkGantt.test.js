import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chartAxis,
  formatClock,
  overlappingBars,
  overlapWarning,
  routeBars,
  segmentInterval,
  tripInterval,
} from '../public/board/gantt.js';

describe('extra-work gantt clocks', () => {
  it('reads a PM afternoon clock written as 2:05-4:45', () => {
    const interval = segmentInterval('PM', '2:05-4:45');
    assert.deepEqual(interval, { start: 14 * 60 + 5, end: 16 * 60 + 45 });
  });

  it('leaves a 24-hour PM clock where it is', () => {
    const interval = segmentInterval('PM', '14:05-16:25');
    assert.deepEqual(interval, { start: 14 * 60 + 5, end: 16 * 60 + 25 });
  });

  it('keeps morning and midday clocks as written', () => {
    assert.deepEqual(segmentInterval('AM', '6:20-8:45'), {
      start: 6 * 60 + 20,
      end: 8 * 60 + 45,
    });
    assert.deepEqual(segmentInterval('MIDDAY', '11:00-12:15'), {
      start: 11 * 60,
      end: 12 * 60 + 15,
    });
  });

  it('spans a trip from the earliest filled clock to the latest', () => {
    const interval = tripInterval({
      clock_in: '09:30',
      depart_school: '10:00',
      leave_destination: '14:45',
      clock_out: '',
    });
    assert.deepEqual(interval, { start: 9 * 60 + 30, end: 14 * 60 + 45 });
  });

  it('does not invent a duration from a single clock', () => {
    assert.equal(tripInterval({ clock_in: '09:30' }), null);
  });
});

describe('extra-work overlap', () => {
  const riker = routeBars([
    {
      route_id: 'S 02',
      segments: { AM: '6:20-8:45', MIDDAY: null, PM: '2:10-4:35' },
    },
  ]);

  it('names the regular run a trip crosses and still returns the trip', () => {
    const trip = tripInterval({
      clock_in: '13:30',
      leave_destination: '16:00',
    });
    const hits = overlappingBars(trip, riker);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].label, 'S 02 PM');
    const warning = overlapWarning('Trip #19815', trip, riker);
    assert.match(warning, /S 02 PM/);
    assert.match(warning, /2:10 PM/);
    assert.match(warning, /still sign up/);
  });

  it('does not warn when the trip sits between the regular runs', () => {
    const trip = tripInterval({
      clock_in: '09:30',
      leave_destination: '13:00',
    });
    assert.equal(overlappingBars(trip, riker).length, 0);
    assert.equal(overlapWarning('Trip #2', trip, riker), '');
  });

  it('opens the axis across a school day and widens it for an early run', () => {
    const axis = chartAxis(riker);
    assert.equal(axis.start, 5 * 60);
    assert.equal(axis.end, 19 * 60);
    const early = chartAxis([{ start: 4 * 60 + 15, end: 6 * 60 }]);
    assert.equal(early.start, 4 * 60);
    assert.equal(formatClock(early.start), '4:00 AM');
  });
});
