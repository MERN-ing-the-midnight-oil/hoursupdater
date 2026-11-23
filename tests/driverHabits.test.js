import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDriverHabits, formatHabitClock, gapTone, pacificStamp, recentWeekdays } from '../office-tracker/src/driverHabits.js';
import { metersBetween, transitionsFromPathXml, transitionsFromPoints, yardCenter } from '../office-tracker/src/yardTransitions.js';

describe('yard transitions', () => {
  it('ignores a brief swing through the yard edge', () => {
    const points = [
      { at: 400, inside: true },
      { at: 406, inside: false },
      { at: 407, inside: true },
      { at: 410, inside: false },
      { at: 414, inside: false },
    ];
    assert.deepEqual(transitionsFromPoints(points, 3), [{ at: 410, kind: 'leave' }]);
  });

  it('reads a path and keeps a bus inside 150 meters', () => {
    const center = { lat: 48.75, lon: -122.47 };
    const near = 48.7504;
    const far = 48.756;
    const xml = `
      <event time="2026-11-23 06:40:00" lat="${near}" long="-122.47"/>
      <event time="2026-11-23 06:50:00" lat="${far}" long="-122.47"/>
      <event time="2026-11-23 06:54:00" lat="${far}" long="-122.47"/>
    `;
    assert.ok(metersBetween(center, { lat: near, lon: -122.47 }) < 150);
    assert.ok(metersBetween(center, { lat: far, lon: -122.47 }) > 150);
    assert.deepEqual(transitionsFromPathXml(xml, center), [{ at: 6 * 60 + 50, kind: 'leave' }]);
  });

  it('uses buses currently in Transportation as the yard', () => {
    const center = yardCenter([
      { zone: 'Transportation', lat: 1, lon: 2 },
      { zone: 'Transportation', lat: 3, lon: 4 },
      { zone: 'School', lat: 9, lon: 9 },
    ]);
    assert.equal(center.lat, 2);
    assert.equal(center.lon, 3);
    assert.equal(yardCenter([{ zone: 'School', lat: 1, lon: 2 }]), null);
  });
});

function published(segment, range, when = '2026-09-01') {
  return {
    segment,
    effective_date: when,
    new_time: range,
    submitted_at: `${when}T00:00:00.000Z`,
  };
}

describe('driver habits', () => {
  const profiles = [
    {
      name: '10',
      driver_name: 'Jordan Lee',
      start_date: '2026-09-01',
      changeLog: [published('AM', '6:05-8:30')],
    },
  ];
  const posted = [{ route: '10', bus: '60', driver: 'Jordan' }];
  const dates = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23'];

  function leave(day, minutes, bus = '60') {
    return { bus, date: `2026-11-${String(day).padStart(2, '0')}`, at: minutes, kind: 'leave' };
  }

  it('stamps a clock in Pacific time', () => {
    const stamp = pacificStamp('2026-11-23T15:05:00.000Z');
    assert.equal(stamp.date, '2026-11-23');
    assert.equal(stamp.minutes, 7 * 60 + 5);
    assert.equal(formatHabitClock(7 * 60 + 5), '7:05 AM');
  });

  it('lists weekdays oldest first and skips the weekend', () => {
    const days = recentWeekdays(3, new Date('2026-11-23T18:00:00.000Z'));
    assert.deepEqual(days, ['2026-11-19', '2026-11-20', '2026-11-23']);
  });

  it('ranks a repeated late leave ahead of a single late morning', () => {
    const transitions = [16, 17, 18, 19, 20, 23].map((day) => leave(day, 6 * 60 + 35));
    const rows = buildDriverHabits({
      transitions: [...transitions, leave(23, 6 * 60 + 40, '11')],
      profiles: [
        ...profiles,
        {
          name: '11',
          driver_name: 'Sam Ortiz',
          start_date: '2026-09-01',
          changeLog: [published('AM', '6:00-8:00')],
        },
      ],
      posted: [...posted, { route: '11', bus: '11' }],
      dates,
      threshold: 20,
    });
    const jordan = rows.find((row) => row.driver === 'Jordan Lee');
    const sam = rows.find((row) => row.driver === 'Sam Ortiz');
    assert.equal(rows[0].driver, 'Sam Ortiz');
    assert.equal(jordan.route, '10');
    assert.equal(jordan.pieceLabel, 'AM clock in');
    assert.equal(jordan.publishedLabel, '6:05 AM');
    assert.equal(jordan.daysOver, 6);
    assert.equal(jordan.usualLabel, '6:35 AM');
    assert.equal(jordan.habitPhrase, 'usually leaves 30 min after the published clock-in');
    assert.equal(sam.daysOver, 1);
    assert.equal(gapTone(30), 'far');
    assert.equal(gapTone(12), 'mild');
  });

  it('uses the published clock in effect on each day', () => {
    const rows = buildDriverHabits({
      transitions: [leave(16, 6 * 60 + 35), leave(23, 6 * 60 + 35)],
      profiles: [
        {
          name: '10',
          driver_name: 'Jordan Lee',
          changeLog: [
            published('AM', '6:05-8:30', '2026-09-01'),
            published('AM', '6:20-8:30', '2026-11-23'),
          ],
        },
      ],
      posted,
      dates: ['2026-11-16', '2026-11-23'],
      threshold: 10,
    });
    assert.equal(rows[0].observations[0].gap, 30);
    assert.equal(rows[0].observations[1].publishedLabel, '6:20 AM');
    assert.equal(rows[0].observations[1].gap, 15);
  });

  it('hides a yard time that wanders until unsettled habits are shown', () => {
    const yards = [5 * 60, 5 * 60 + 30, 6 * 60, 6 * 60 + 40, 7 * 60 + 10];
    const transitions = yards.map((at, index) => leave(16 + index, at));
    const early = {
      ...profiles[0],
      changeLog: [published('AM', '5:00-8:00')],
    };
    const unsettledDates = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];
    assert.equal(
      buildDriverHabits({
        transitions,
        profiles: [early],
        posted,
        dates: unsettledDates,
        threshold: 20,
      }).length,
      0
    );
    const shown = buildDriverHabits({
      transitions,
      profiles: [early],
      posted,
      dates: unsettledDates,
      threshold: 20,
      showUnsettled: true,
    });
    assert.equal(shown.length, 1);
    assert.equal(shown[0].unsettled, true);
  });

  it('compares each published clock-out with the return, and keeps a far leave off that clock', () => {
    const rows = buildDriverHabits({
      transitions: [
        { bus: '60', date: '2026-11-23', at: 5 * 60, kind: 'leave' },
        { bus: '60', date: '2026-11-23', at: 10 * 60 + 55, kind: 'leave' },
        { bus: '60', date: '2026-11-23', at: 12 * 60 + 40, kind: 'return' },
        { bus: '60', date: '2026-11-23', at: 15 * 60 + 50, kind: 'return' },
      ],
      profiles: [
        {
          name: '10',
          driver_name: 'Jordan Lee',
          changeLog: [published('MIDDAY', '10:40-12:10'), published('PM', '14:10-16:20')],
        },
      ],
      posted,
      dates: ['2026-11-23'],
      threshold: 20,
    });
    const midday = rows.find((row) => row.pieceLabel === 'Midday clock out');
    const evening = rows.find((row) => row.pieceLabel === 'PM clock out');
    assert.equal(midday.observations[0].gap, 30);
    assert.equal(evening.observations[0].gap, -30);
    assert.equal(evening.habitPhrase, 'usually returns 30 min before the published clock-out');
    assert.equal(rows.some((row) => row.pieceLabel === 'AM clock in'), false);
  });

  it('keeps a clock off the list when the usual gap is under the line', () => {
    const transitions = [16, 17, 18, 19, 20].map((day) => leave(day, 6 * 60 + 8));
    transitions.push(leave(23, 6 * 60 + 50));
    const rows = buildDriverHabits({
      transitions,
      profiles,
      posted,
      dates,
      threshold: 20,
    });
    assert.equal(rows.length, 0);
  });
});
