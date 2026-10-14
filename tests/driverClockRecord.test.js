import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PAY_PERIODS } from '../office-tracker/src/driverPay.js';
import { buildDriverClockRecord } from '../office-tracker/src/driverClockRecord.js';

function punch(id, name, action, when, run = 'AM') {
  return { id, driver_name: name, action, punched_at: when, run };
}

describe('driver clock record', () => {
  it('lists every day newest first, with blank weekends and pay-period bands', () => {
    const punches = [
      punch('fri-in', 'Alex Driver', 'in', new Date(2026, 9, 9, 6, 0)),
      punch('fri-out', 'Alex Driver', 'out', new Date(2026, 9, 9, 8, 30)),
      punch('fri-mid-in', 'Alex Driver', 'in', new Date(2026, 9, 9, 11, 0), 'MIDDAY'),
      punch('fri-mid-out', 'Alex Driver', 'out', new Date(2026, 9, 9, 12, 15), 'MIDDAY'),
      punch('sat-in', 'Alex Driver', 'in', new Date(2026, 9, 10, 9, 0), 'OTHER'),
      punch('sat-out', 'Alex Driver', 'out', new Date(2026, 9, 10, 10, 0), 'OTHER'),
      punch('sep-in', 'Alex Driver', 'in', new Date(2026, 8, 30, 14, 0), 'PM'),
      punch('sep-out', 'Alex Driver', 'out', new Date(2026, 8, 30, 16, 45), 'PM'),
      punch('other-in', 'Riley Cho', 'in', new Date(2026, 9, 9, 5, 0)),
      punch('other-out', 'Riley Cho', 'out', new Date(2026, 9, 9, 7, 0)),
      { ...punch('gone-in', 'Alex Driver', 'in', new Date(2026, 9, 8, 6, 0)), removed: true },
      { ...punch('gone-out', 'Alex Driver', 'out', new Date(2026, 9, 8, 8, 0)), removed: true },
    ];
    const now = new Date(2026, 9, 11, 15);
    const periods = buildDriverClockRecord(punches, DEFAULT_PAY_PERIODS, 'Alex Driver', now);

    assert.deepEqual(
      periods.map((period) => period.label),
      ['October 1–15, 2026', 'September 16–30, 2026']
    );
    assert.deepEqual(
      periods.map((period) => period.band),
      [0, 1]
    );
    assert.deepEqual(
      periods[0].rows.slice(0, 4).map((row) => [row.dateKey, row.weekday, row.weekend, row.periodStart]),
      [
        ['2026-10-11', 'Sunday', true, true],
        ['2026-10-10', 'Saturday', true, false],
        ['2026-10-09', 'Friday', false, false],
        ['2026-10-08', 'Thursday', false, false],
      ]
    );
    assert.equal(periods[0].rows.at(-1).dateKey, '2026-10-01');
    assert.equal(periods[0].rows[0].amIn, '');
    assert.equal(periods[0].rows[1].otherIn, '9:00 AM');
    assert.equal(periods[0].rows[1].otherOut, '10:00 AM');
    assert.equal(periods[0].rows[2].amIn, '6:00 AM');
    assert.equal(periods[0].rows[2].amOut, '8:30 AM');
    assert.equal(periods[0].rows[2].middayIn, '11:00 AM');
    assert.equal(periods[0].rows[2].middayOut, '12:15 PM');
    assert.equal(periods[0].rows[3].amIn, '');
    assert.equal(periods[1].rows[0].dateKey, '2026-09-30');
    assert.equal(periods[1].rows[0].pmIn, '2:00 PM');
    assert.equal(periods[1].rows[0].pmOut, '4:45 PM');
    assert.equal(periods[1].rows.at(-1).dateKey, '2026-09-16');
  });

  it('names other work and a part marked inside a regular route', () => {
    const punches = [
      {
        ...punch('sat-in', 'Alex Driver', 'in', new Date(2026, 9, 10, 9, 0), 'OTHER'),
        work_type: 'field-trip',
        trip_ticket: '4821',
      },
      {
        ...punch('sat-out', 'Alex Driver', 'out', new Date(2026, 9, 10, 10, 0), 'OTHER'),
        work_type: 'field-trip',
      },
      {
        ...punch('fri-in', 'Alex Driver', 'in', new Date(2026, 9, 9, 14, 0), 'PM'),
        work_portions: [
          {
            start: new Date(2026, 9, 9, 15, 0).toISOString(),
            end: new Date(2026, 9, 9, 16, 0).toISOString(),
            work_type: 'middle-school-sports',
          },
        ],
      },
      punch('fri-out', 'Alex Driver', 'out', new Date(2026, 9, 9, 17, 0), 'PM'),
    ];
    const periods = buildDriverClockRecord(punches, DEFAULT_PAY_PERIODS, 'Alex Driver', new Date(2026, 9, 11, 15));
    const saturday = periods[0].rows.find((row) => row.dateKey === '2026-10-10');
    const friday = periods[0].rows.find((row) => row.dateKey === '2026-10-09');
    assert.equal(saturday.otherWork, 'Field trip 9:00 AM–10:00 AM\nTrip ticket 4821');
    assert.equal(friday.otherWork, 'Middle school sports 3:00 PM–4:00 PM');
    assert.equal(friday.pmIn, '2:00 PM');
  });

  it('with no clocks, shows the current pay period through today', () => {
    const periods = buildDriverClockRecord([], DEFAULT_PAY_PERIODS, 'Alex Driver', new Date(2026, 9, 11, 12));
    assert.equal(periods.length, 1);
    assert.equal(periods[0].label, 'October 1–15, 2026');
    assert.equal(periods[0].rows[0].dateKey, '2026-10-11');
    assert.equal(periods[0].rows.at(-1).dateKey, '2026-10-01');
    assert.ok(periods[0].rows.every((row) => row.amIn === '' && row.pmOut === ''));
  });

  it('returns nothing without a driver name', () => {
    assert.deepEqual(buildDriverClockRecord([], DEFAULT_PAY_PERIODS, '  '), []);
  });

  it('shows Leave Requested and the hours, including a future day', () => {
    const leaves = [
      {
        id: 'leave-am',
        driver_name: 'Alex Driver',
        date: '2026-10-09',
        run: 'AM',
        minutes: 140,
        requested_at: '2026-10-09T15:00:00.000Z',
      },
      {
        id: 'leave-pm',
        driver_name: 'Alex Driver',
        date: '2026-11-03',
        run: 'PM',
        minutes: 90,
        requested_at: '2026-10-11T15:00:00.000Z',
      },
    ];
    const periods = buildDriverClockRecord([], DEFAULT_PAY_PERIODS, 'Alex Driver', new Date(2026, 9, 11, 12), leaves);
    const friday = periods.find((period) => period.key === '2026-10-1')?.rows.find((row) => row.dateKey === '2026-10-09');
    const future = periods.find((period) => period.key === '2026-11-1')?.rows.find((row) => row.dateKey === '2026-11-03');
    assert.equal(friday.amIn, 'Leave Requested');
    assert.equal(friday.amOut, '2 hr 20 min');
    assert.equal(future.pmIn, 'Leave Requested');
    assert.equal(future.pmOut, '1 hr 30 min');
    const october = periods.find((period) => period.key === '2026-10-1');
    assert.equal(october.rows.some((row) => row.dateKey === '2026-10-11'), true);
    assert.equal(october.rows.some((row) => row.dateKey === '2026-10-12'), false);
  });
});
