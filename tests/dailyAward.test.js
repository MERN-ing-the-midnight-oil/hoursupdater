import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assignedDayLoad, noWinnerText, planDailyAwards, requestedDayLoad } from '../public/board/dailyAward.js';

const day = '2026-10-08';

function trip(id, number, start, end, bids = []) {
  return {
    id,
    status: 'posted',
    list: 'daily',
    trip_date: day,
    trip_number: number,
    destination: `Place ${number}`,
    school: 'School',
    times: { clock_in: start, clock_out: end },
    bids,
  };
}

function bid(driverId, preference) {
  return {
    driver_id: driverId,
    initials: 'AB',
    preference,
    signed_at: '2026-10-08T06:00:00.000Z',
  };
}

function driver(id, name, rank) {
  return { driver_id: id, name, seniority_rank: rank };
}

function schedule(driverId, segments) {
  return { driver_id: driverId, route_id: driverId, segments };
}

describe('daily award walk', () => {
  it('gives the senior driver the first choice that fits and tells the next driver it is gone', () => {
    const plan = planDailyAwards({
      date: day,
      drivers: [driver('senior', 'Senior Driver', 1), driver('junior', 'Junior Driver', 2)],
      schedules: [
        schedule('senior', { AM: '6:00-9:00', MIDDAY: null, PM: '14:00-16:00' }),
        schedule('junior', { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' }),
      ],
      postings: [
        trip('a', '19821', '06:45', '09:30', [bid('senior', '19821, 19824')]),
        trip('b', '19824', '10:00', '11:30', [bid('senior', '19821, 19824'), bid('junior', '19824')]),
      ],
    });
    const swimming = plan.trips.find((row) => row.trip_number === '19824');
    const morning = plan.trips.find((row) => row.trip_number === '19821');
    assert.equal(swimming.winner.name, 'Senior Driver');
    assert.match(swimming.winner.reason, /Got the trip/);
    assert.match(swimming.winner.reason, /Higher choices did not fit/);
    assert.match(swimming.winner.reason, /Crosses/);
    assert.match(swimming.winner.reason, /seniority 1/);
    assert.match(swimming.winner.reason, /seniority 2/);
    assert.equal(morning.winner, null);
    assert.equal(swimming.steps.at(-1).outcome, 'taken');
    assert.match(swimming.steps.at(-1).reason, /Senior Driver/);
  });

  it('gives every fitting trip when the request is in parentheses', () => {
    const plan = planDailyAwards({
      date: day,
      drivers: [driver('ada', 'Ada Driver', 1)],
      schedules: [schedule('ada', { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' })],
      postings: [
        trip('mid', '19825', '10:00', '12:00', [bid('ada', '(19830, 19825)')]),
        trip('eve', '19830', '17:00', '19:00', [bid('ada', '(19830, 19825)')]),
      ],
    });
    assert.deepEqual(
      plan.trips.filter((row) => row.winner).map((row) => row.trip_number).sort(),
      ['19825', '19830']
    );
  });

  it('skips a senior driver past one hour of overtime and gives the trip to the next driver who fits', () => {
    const plan = planDailyAwards({
      date: day,
      drivers: [driver('senior', 'Senior Driver', 1), driver('next', 'Next Driver', 2)],
      schedules: [
        schedule('senior', { AM: '6:00-13:00', MIDDAY: null, PM: null }),
        schedule('next', { AM: '6:00-12:00', MIDDAY: null, PM: null }),
      ],
      postings: [
        trip('late', '19830', '14:00', '16:30', [
          bid('senior', '19830'),
          bid('next', '19830'),
        ]),
      ],
    });
    const row = plan.trips[0];
    assert.equal(row.winner.name, 'Next Driver');
    assert.match(row.winner.reason, /overtime/);
    assert.match(row.winner.reason, /seniority 2/);
    assert.match(row.steps[0].reason, /seniority 1/);
    assert.equal(row.steps[0].outcome, 'passed');
    assert.match(row.steps[0].reason, /one-hour limit/);
  });

  it('does not treat a utility day as a regular run a trip has to fit around', () => {
    const plan = planDailyAwards({
      date: day,
      drivers: [
        driver('utility', 'Bob Blakeslee', 4),
        driver('route', 'Route Driver', 1),
      ],
      schedules: [
        {
          driver_id: 'utility',
          route_id: 'Utility — Blakeslee',
          segments: { AM: '7:00-15:00', MIDDAY: null, PM: null },
        },
        schedule('route', { AM: '6:00-10:00', MIDDAY: null, PM: '12:00-16:00' }),
      ],
      postings: [
        trip('museum', '19861', '10:30', '11:00', [
          bid('utility', '19861'),
          bid('route', '19861'),
        ]),
      ],
    });
    const row = plan.trips[0];
    assert.equal(row.winner.name, 'Bob Blakeslee');
    assert.match(row.winner.reason, /under 40 contracted hours/);
    assert.equal(row.steps[0].outcome, 'awarded');
    assert.doesNotMatch(row.steps[0].reason, /Crosses/);
    assert.equal(row.steps[1].outcome, 'taken');
  });

  it('offers the utility position before a more senior route driver who also has no overtime', () => {
    const plan = planDailyAwards({
      date: day,
      drivers: [driver('senior', 'Senior Driver', 1), driver('part', 'Utility Driver', 8)],
      schedules: [
        schedule('senior', { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' }),
        {
          driver_id: 'part',
          route_id: 'Utility — Part',
          segments: { AM: '7:00-15:00', MIDDAY: null, PM: null },
        },
      ],
      postings: [
        trip('gap', '19826', '10:00', '11:00', [
          bid('senior', '19826'),
          bid('part', '19826'),
        ]),
      ],
    });
    assert.equal(plan.mixed_hours, true);
    assert.equal(plan.trips[0].winner.name, 'Utility Driver');
    assert.match(plan.trips[0].winner.reason, /seniority 8/);
    assert.match(plan.trips[0].winner.reason, /under 40 contracted hours/);
    assert.equal(plan.trips[0].steps[0].name, 'Utility Driver');
    assert.equal(plan.trips[0].steps[1].outcome, 'taken');
  });

  it('does not let a short route jump a more senior driver when both have no overtime', () => {
    const plan = planDailyAwards({
      date: day,
      drivers: [driver('senior', 'Senior Driver', 3), driver('short', 'Short Route', 40)],
      schedules: [
        schedule('senior', { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' }),
        schedule('short', { AM: '6:00-7:00', MIDDAY: null, PM: null }),
      ],
      postings: [
        trip('gap', '19826', '10:00', '11:00', [bid('senior', '19826'), bid('short', '19826')]),
      ],
    });
    assert.equal(plan.mixed_hours, false);
    assert.equal(plan.trips[0].winner.name, 'Senior Driver');
    assert.equal(plan.trips[0].winner.seniority_rank, 3);
  });

  it('gives a 3.5 hour trip that leaves town by seniority even with overtime', () => {
    const leaving = {
      ...trip('town', '19840', '09:00', '13:00', [
        bid('senior', '19840'),
        bid('junior', '19840'),
      ]),
      out_of_town: true,
    };
    const plan = planDailyAwards({
      date: day,
      drivers: [driver('senior', 'Senior Driver', 7), driver('junior', 'Junior Driver', 47)],
      schedules: [
        schedule('senior', { AM: '6:45-8:45', MIDDAY: '9:55-11:50', PM: '13:45-16:30' }),
        schedule('junior', { AM: '6:40-8:30', MIDDAY: null, PM: '14:05-16:25' }),
      ],
      postings: [leaving],
    });
    const row = plan.trips[0];
    assert.equal(row.winner.name, 'Senior Driver');
    assert.match(row.winner.reason, /leaves town/);
    assert.match(row.winner.reason, /seniority 7/);
    assert.match(row.steps[0].reason, /midday/i);
  });

  it('keeps the regular rule when Leaves town is checked on a trip under 3.5 hours', () => {
    const leaving = {
      ...trip('town', '19841', '10:30', '12:00', [
        bid('senior', '19841'),
        bid('junior', '19841'),
      ]),
      out_of_town: true,
    };
    const plan = planDailyAwards({
      date: day,
      drivers: [driver('senior', 'Senior Driver', 10), driver('junior', 'Junior Driver', 26)],
      schedules: [
        schedule('senior', { AM: '6:55-9:15', MIDDAY: '10:05-12:20', PM: '14:05-16:40' }),
        schedule('junior', { AM: '6:25-9:15', MIDDAY: null, PM: '14:05-16:10' }),
      ],
      postings: [leaving],
    });
    const row = plan.trips[0];
    assert.equal(row.winner.name, 'Junior Driver');
    assert.match(row.winner.reason, /under 3\.5 hours/);
    assert.match(row.steps[0].reason, /Crosses/);
    assert.match(row.steps[0].reason, /Midday/);
  });

  it('leaves awarded weekly work in place and will not offer a daily trip across it', () => {
    const plan = planDailyAwards({
      date: day,
      drivers: [driver('senior', 'Senior Driver', 4), driver('junior', 'Junior Driver', 26)],
      schedules: [
        schedule('senior', { AM: '6:50-9:15', MIDDAY: null, PM: '14:05-17:00' }),
        schedule('junior', { AM: '6:25-9:15', MIDDAY: null, PM: '14:05-16:10' }),
      ],
      extraBars: [
        {
          driver_id: 'senior',
          start: 10 * 60,
          end: 12 * 60,
          label: 'Weekly #18420',
          segment: 'WEEKLY',
        },
      ],
      postings: [trip('gap', '19902', '10:15', '11:30', [bid('senior', '19902'), bid('junior', '19902')])],
    });
    const row = plan.trips[0];
    assert.equal(row.winner.name, 'Junior Driver');
    assert.match(row.steps[0].reason, /Weekly #18420/);
    assert.equal(row.steps[0].outcome, 'passed');
  });

  it('stops after one trip when the request has no parentheses', () => {
    const plan = planDailyAwards({
      date: day,
      drivers: [driver('ada', 'Ada Driver', 1)],
      schedules: [schedule('ada', { AM: '6:00-8:00', MIDDAY: null, PM: null })],
      postings: [
        trip('mid', '19825', '10:00', '11:00', [bid('ada', '19830, 19825')]),
        trip('eve', '19830', '17:00', '18:00', [bid('ada', '19830, 19825')]),
      ],
    });
    const evening = plan.trips.find((row) => row.trip_number === '19830');
    const midday = plan.trips.find((row) => row.trip_number === '19825');
    assert.equal(evening.winner.name, 'Ada Driver');
    assert.equal(midday.winner, null);
    assert.equal(midday.steps[0].outcome, 'later');
    assert.match(midday.steps[0].reason, /#19830/);
    assert.match(noWinnerText(midday), /Ada Driver already took the one trip/);
  });

  it('gives the trip to a less senior driver who can finish with no overtime', () => {
    const plan = planDailyAwards({
      date: day,
      drivers: [
        { ...driver('senior', 'Senior Driver', 1), hire_date: '2012-08-15' },
        { ...driver('junior', 'Junior Driver', 4), hire_date: '2016-03-14' },
      ],
      schedules: [
        schedule('senior', { AM: '6:00-12:30', MIDDAY: null, PM: null }),
        schedule('junior', { AM: '6:00-8:00', MIDDAY: null, PM: null }),
      ],
      postings: [
        trip('mid', '19825', '13:00', '15:00', [bid('senior', '19825'), bid('junior', '19825')]),
      ],
    });
    const row = plan.trips[0];
    assert.equal(row.winner.name, 'Junior Driver');
    assert.equal(row.winner.seniority_rank, 4);
    assert.equal(row.winner.hire_date, '2016-03-14');
    assert.match(row.winner.reason, /no overtime/);
    assert.match(row.winner.reason, /seniority 4/);
    assert.match(row.winner.reason, /seniority 1/);
    assert.match(row.winner.reason, /hired March 14, 2016/);
    assert.match(row.winner.reason, /30 min of overtime/);
    assert.equal(row.steps[0].seniority_rank, 1);
    assert.equal(row.steps[0].hire_date, '2012-08-15');
    assert.match(row.steps[0].reason, /Junior Driver/);
  });

  it('holds a ticket when two drivers share a hire date and lots are not recorded', () => {
    const plan = planDailyAwards({
      date: day,
      drivers: [
        { ...driver('aaron', 'Aaron Hakeman', 1), hire_date: '2023-08-31', tie_break: null },
        { ...driver('darryl', 'Darryl Rose', 2), hire_date: '2023-08-31', tie_break: null },
      ],
      schedules: [
        schedule('aaron', { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' }),
        schedule('darryl', { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' }),
      ],
      postings: [
        trip('gap', '19826', '10:00', '11:30', [bid('aaron', '19826'), bid('darryl', '19826')]),
      ],
    });
    const row = plan.trips[0];
    assert.equal(row.winner, null);
    assert.match(row.hold_reason, /Please flip a coin per Art\. 3\.01/);
    assert.match(
      row.hold_reason,
      /The seniority order of employees hired on the same date shall be established by drawing lots/
    );
    assert.match(row.hold_reason, /Aaron Hakeman and Darryl Rose/);
    assert.match(row.hold_reason, /August 31, 2023/);
    assert.match(noWinnerText(row), /Please flip a coin per Art\. 3\.01/);
    assert.equal(row.steps.filter((step) => step.outcome === 'tied').length, 2);
  });

  it('awards by the recorded lots result when hire dates match', () => {
    const plan = planDailyAwards({
      date: day,
      drivers: [
        { ...driver('first', 'First Lots', 1), hire_date: '2023-08-31', tie_break: 1 },
        { ...driver('second', 'Second Lots', 2), hire_date: '2023-08-31', tie_break: 2 },
      ],
      schedules: [
        schedule('first', { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' }),
        schedule('second', { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' }),
      ],
      postings: [
        trip('gap', '19826', '10:00', '11:30', [bid('first', '19826'), bid('second', '19826')]),
      ],
    });
    assert.equal(plan.trips[0].winner.name, 'First Lots');
    assert.equal(plan.trips[0].hold_reason, null);
  });
});

describe('requested day hours', () => {
  const bars = [{ start: 6 * 60 + 15, end: 8 * 60 + 30 }, { start: 14 * 60 + 5, end: 16 * 60 + 20 }];
  const trips = [
    trip('a', '1', '09:00', '11:30'),
    trip('b', '2', '09:20', '11:40'),
    trip('c', '3', '11:45', '13:15'),
  ];

  it('counts one fitting trip when the request has no parentheses', () => {
    const load = requestedDayLoad({ preference: '2,3,1', trips, bars });
    assert.equal(load.tripMinutes, 140);
    assert.equal(load.total, 270 + 140);
    assert.equal(load.ot, 0);
  });

  it('counts every fitting trip in parentheses and the overtime past 8 hours', () => {
    const load = requestedDayLoad({ preference: '(1,3)', trips, bars });
    assert.equal(load.tripMinutes, 150 + 90);
    assert.equal(load.ot, 270 + 240 - 8 * 60);
  });

  it('skips a trip that crosses a regular run', () => {
    const busy = [...bars, { start: 12 * 60, end: 12 * 60 + 30 }];
    const load = requestedDayLoad({ preference: '3,1', trips, bars: busy });
    assert.equal(load.tripMinutes, 150);
    assert.equal(load.ot, 0);
  });
});

describe('assigned day overtime', () => {
  const bars = [{ start: 6 * 60 + 15, end: 8 * 60 + 30 }, { start: 14 * 60 + 5, end: 16 * 60 + 20 }];

  it('is only the regular route when nothing is on the row', () => {
    const load = assignedDayLoad({ intervals: [], bars });
    assert.equal(load.tripMinutes, 0);
    assert.equal(load.total, 270);
    assert.equal(load.ot, 0);
  });

  it('adds each placed job and the overtime past 8 hours', () => {
    const load = assignedDayLoad({
      intervals: [
        { start: 9 * 60, end: 11 * 60 + 30 },
        { start: 11 * 60 + 45, end: 13 * 60 + 15 },
      ],
      bars,
    });
    assert.equal(load.tripMinutes, 150 + 90);
    assert.equal(load.ot, 270 + 240 - 8 * 60);
  });

  it('counts overlapping route time and overlapping jobs once', () => {
    const load = assignedDayLoad({
      intervals: [
        { start: 8 * 60, end: 10 * 60 },
        { start: 9 * 60 + 20, end: 11 * 60 + 40 },
      ],
      bars,
    });
    assert.equal(load.tripMinutes, 11 * 60 + 40 - (8 * 60 + 30));
    assert.equal(load.ot, 0);
  });
});
