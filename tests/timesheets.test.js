import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildBps2026_2027Calendar } from '../employee-tracker/src/bpsCalendar2026.js';
import {
  buildPeriodTimesheets,
  buildTimesheet,
  contractFromRoutes,
  extraDateInPeriod,
  listPeriods,
  pairClockPunches,
  payPeriodCalculatorsCsv,
  payPeriodExportFilename,
  payrollVarianceClipboard,
  payrollVarianceRows,
  periodFromQuery,
  routesHeldBy,
  setExtraHours,
} from '../src/logic/timesheets.js';

const calendar = buildBps2026_2027Calendar().calendar;

function at(year, monthIndex, day, hour, minute) {
  return new Date(year, monthIndex, day, hour, minute);
}

function punch(id, action, when, extra = {}) {
  return {
    id,
    driver_id: extra.driver_id || 'd1',
    driver_name: 'Alex Driver',
    action,
    punched_at: when.toISOString(),
    note: extra.note || '',
    note_at: extra.note ? when.toISOString() : null,
    reason_codes: extra.reason_codes || [],
  };
}

const routes = [
  {
    route_id: '104',
    segments: { AM: '6:00-8:00', MIDDAY: '11:00-12:00', PM: '14:00-16:15' },
  },
];

function sheet(punches, period = { year: 2026, monthIndex: 8, half: 1 }, held = routes) {
  return buildTimesheet({
    driver: { driver_id: 'd1', name: 'Alex Driver' },
    punches,
    routes: held,
    calendar,
    period,
  });
}

describe('timesheets from clock records', () => {
  it('compares paired punches with current contracted hours', () => {
    const punches = [
      punch('a', 'in', at(2026, 8, 8, 6, 0)),
      punch('b', 'out', at(2026, 8, 8, 8, 0)),
      punch('c', 'in', at(2026, 8, 8, 11, 0), { note: 'Late school' }),
      punch('d', 'out', at(2026, 8, 8, 12, 0), {
        reason_codes: [{ id: 'reason-traffic', label: 'Traffic' }],
      }),
      punch('e', 'in', at(2026, 8, 8, 14, 0)),
      punch('f', 'out', at(2026, 8, 8, 16, 15)),
    ];
    const result = sheet(punches);
    const september8 = result.days.find((day) => day.date === '2026-09-08');
    const september6 = result.days.find((day) => day.date === '2026-09-06');
    const september7 = result.days.find((day) => day.date === '2026-09-07');
    const september9 = result.days.find((day) => day.date === '2026-09-09');
    assert.equal(september8.clockHours, 5.25);
    assert.equal(september8.amHours, 2);
    assert.equal(september8.middayHours, 1);
    assert.equal(september8.pmHours, 2.25);
    assert.equal(september8.extraHours, 0);
    assert.equal(september8.contractHours, 5.25);
    assert.equal(september8.difference, 0);
    assert.equal(september8.regular, 5.25);
    assert.equal(september8.overtime, 0);
    assert.equal(september6.contractHours, 0);
    assert.equal(september7.contractHours, 0);
    assert.equal(september9.clockHours, 0);
    assert.equal(september9.contractHours, 5.25);
    assert.equal(result.period.label, 'September 1–15, 2026');
    assert.equal(result.daily_hours, 5.25);
    assert.equal(
      result.clocks,
      'AM 6:00–8:00 · Midday 11:00–12:00 · PM 14:00–16:15'
    );
    assert.equal(result.heading, 'Alex Driver · route 104');
    assert.equal(result.pairs.length, 3);
    assert.equal(result.pairs[1].note, 'Late school');
    assert.deepEqual(result.pairs[1].reason_codes, ['Traffic']);
  });

  it('counts a weekend as overtime and caps a weekday at 8 regular hours', () => {
    const punches = [
      punch('a', 'in', at(2026, 8, 6, 8, 0)),
      punch('b', 'out', at(2026, 8, 6, 11, 0)),
      punch('c', 'in', at(2026, 8, 9, 6, 0)),
      punch('d', 'out', at(2026, 8, 9, 15, 0)),
    ];
    const result = sheet(punches);
    const sunday = result.days.find((day) => day.date === '2026-09-06');
    const wednesday = result.days.find((day) => day.date === '2026-09-09');
    assert.equal(sunday.clockHours, 3);
    assert.equal(sunday.regular, 0);
    assert.equal(sunday.overtime, 3);
    assert.equal(wednesday.clockHours, 9);
    assert.equal(wednesday.regular, 8);
    assert.equal(wednesday.overtime, 1);
  });

  it('keeps a span that crosses midnight on the clock-in day', () => {
    const punches = [
      punch('a', 'in', at(2026, 8, 15, 22, 0)),
      punch('b', 'out', at(2026, 8, 16, 1, 0)),
    ];
    const firstHalf = sheet(punches, { year: 2026, monthIndex: 8, half: 1 });
    const secondHalf = sheet(punches, { year: 2026, monthIndex: 8, half: 2 });
    const september15 = firstHalf.days.find((day) => day.date === '2026-09-15');
    assert.equal(september15.clockHours, 3);
    assert.equal(secondHalf.totals.clockHours, 0);
    assert.match(secondHalf.caveats[0], /closed during this period/);
  });

  it('reports a clock in with no clock out and ignores another driver', () => {
    const punches = [
      punch('a', 'in', at(2026, 8, 8, 6, 0)),
      punch('b', 'in', at(2026, 8, 8, 7, 0), { driver_id: 'other' }),
      punch('c', 'out', at(2026, 8, 8, 8, 0), { driver_id: 'other' }),
    ];
    const result = sheet(punches);
    assert.equal(result.totals.clockHours, 0);
    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0].hours, null);
    assert.match(result.caveats[0], /has no clock out/);
  });

  it('sums every route the driver holds and says when there is no route', () => {
    const summed = contractFromRoutes([
      { route_id: '12', segments: { AM: '7:00-9:00', MIDDAY: null, PM: null } },
      { route_id: '104', segments: { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' } },
    ]);
    assert.equal(summed.dailyHours, 6);
    assert.match(summed.clocks, /^Route 12:/);
    const open = sheet([], { year: 2026, monthIndex: 8, half: 1 }, []);
    assert.match(open.contract_text, /not assigned to a route/);
    assert.equal(open.daily_hours, 0);
  });

  it('matches a route that only stored the driver name', () => {
    const held = routesHeldBy(
      {
        12: { driver_name: 'Alex Driver', segments: { AM: '7:00-8:00' } },
        14: { driver_id: 'someone', driver_name: 'Alex Driver', segments: {} },
      },
      { driver_id: 'd1', name: 'Alex Driver' }
    );
    assert.deepEqual(held.map((route) => route.route_id), ['12']);
  });

  it('lists pay periods from the earliest punch through today', () => {
    const periods = listPeriods(
      [{ punched_at: at(2026, 8, 8, 6, 0).toISOString() }],
      at(2026, 9, 8, 9, 0)
    );
    assert.deepEqual(
      periods.map((period) => [period.year, period.monthIndex, period.half]),
      [
        [2026, 9, 1],
        [2026, 8, 2],
        [2026, 8, 1],
      ]
    );
  });

  it('rejects a pay period that is not a half month', () => {
    assert.equal(periodFromQuery({}, at(2026, 9, 8, 9, 0)).half, 1);
    assert.throws(() => periodFromQuery({ year: '2026', month: '9', half: '3' }), /1st/);
  });

  it('leaves an unreadable segment out of the day total', () => {
    const contract = contractFromRoutes([
      { route_id: '3', segments: { AM: 'nope', MIDDAY: null, PM: '14:00-15:00' } },
    ]);
    assert.equal(contract.dailyHours, 1);
    assert.match(contract.problems[0], /could not be read/);
  });
});

describe('payroll export from clock records', () => {
  it('splits hours above and below the contracted day', () => {
    const result = sheet([
      punch('a', 'in', at(2026, 8, 6, 8, 0)),
      punch('b', 'out', at(2026, 8, 6, 11, 0)),
      punch('c', 'in', at(2026, 8, 9, 6, 0)),
      punch('d', 'out', at(2026, 8, 9, 15, 0)),
    ]);
    const sunday = result.days.findIndex((day) => day.date === '2026-09-06');
    const wednesday = result.days.findIndex((day) => day.date === '2026-09-09');
    const missed = result.days.findIndex((day) => day.date === '2026-09-08');
    assert.equal(result.payroll_rows.above[sunday], 3);
    assert.equal(result.payroll_rows.below[sunday], 0);
    assert.equal(result.payroll_rows.above[wednesday], 3.75);
    assert.equal(result.payroll_rows.below[missed], -5.25);
    const copied = payrollVarianceClipboard(result.payroll_rows);
    assert.match(copied.plain, /3\.00/);
    assert.match(copied.plain, /-5\.25/);
    assert.match(copied.html, /<table><tr>/);
  });

  it('writes one regular and overtime pair per day for every driver', () => {
    const alex = sheet([
      punch('a', 'in', at(2026, 8, 8, 6, 0)),
      punch('b', 'out', at(2026, 8, 8, 8, 0)),
    ]);
    const blair = buildTimesheet({
      driver: { driver_id: 'd2', name: 'Blair, "Route"' },
      punches: [],
      routes: [],
      calendar,
      period: { year: 2026, monthIndex: 8, half: 1 },
    });
    const csv = payPeriodCalculatorsCsv([alex, blair]);
    const [header, alexRow, blairRow] = csv.split('\n');
    assert.match(header, /^Employee,Route,Tue 9\/1 Reg,Tue 9\/1 OT,/);
    assert.match(header, /Period Reg total,Period OT total$/);
    assert.match(alexRow, /^Alex Driver,104,/);
    assert.match(blairRow, /^"Blair, ""Route""",/);
    assert.equal(payPeriodExportFilename(alex.period.label), 'Pay_period_calculators_September_1_15_2026.csv');
    const sheets = buildPeriodTimesheets({
      drivers: [
        { driver_id: 'd2', name: 'Blair' },
        { driver_id: 'd1', name: 'Alex Driver' },
      ],
      punches: [
        punch('a', 'in', at(2026, 8, 8, 6, 0)),
        punch('b', 'out', at(2026, 8, 8, 8, 0)),
      ],
      routeState: { 104: { driver_id: 'd1', segments: routes[0].segments } },
      calendar,
      period: { year: 2026, monthIndex: 8, half: 1 },
    });
    assert.deepEqual(
      sheets.map((item) => item.driver.name),
      ['Alex Driver', 'Blair']
    );
    assert.equal(sheets[0].days.find((day) => day.date === '2026-09-08').clockHours, 2);
    assert.equal(payrollVarianceRows([{ difference: 0 }]).above[0], 0);
  });

  it('keeps typed extra hours beside the clock totals', () => {
    const period = { year: 2026, monthIndex: 8, half: 1 };
    const punches = [
      punch('a', 'in', at(2026, 8, 8, 6, 0)),
      punch('b', 'out', at(2026, 8, 8, 8, 0)),
    ];
    const without = sheet(punches, period);
    const withExtra = buildTimesheet({
      driver: { driver_id: 'd1', name: 'Alex Driver', email: 'alex@example.com' },
      punches,
      routes,
      calendar,
      period,
      extraByDate: { '2026-09-08': 1.5, '2026-09-09': 0 },
    });
    const day = withExtra.days.find((item) => item.date === '2026-09-08');
    const plain = without.days.find((item) => item.date === '2026-09-08');
    assert.equal(day.extraHours, 1.5);
    assert.equal(day.clockHours, plain.clockHours);
    assert.equal(day.regular, plain.regular);
    assert.equal(day.overtime, plain.overtime);
    assert.equal(day.difference, plain.difference);
    assert.deepEqual(withExtra.payroll_rows, without.payroll_rows);
    assert.match(withExtra.email.body, /Extra 1\.50/);
    assert.match(withExtra.email.mailto_url, /^mailto:alex%40example\.com/);
    assert.equal(withExtra.email.subject, 'Pay period summary — September 1–15, 2026 — Alex Driver');
    assert.equal(without.email.mailto_url, null);

    const stored = setExtraHours({}, 'd1', period, '2026-09-08', 1.5);
    const cleared = setExtraHours(stored, 'd1', period, '2026-09-08', 0);
    assert.deepEqual(stored, { 'd1|2026-9-1': { '2026-09-08': 1.5 } });
    assert.deepEqual(cleared, {});
    assert.equal(extraDateInPeriod(period, '2026-09-08'), true);
    assert.equal(extraDateInPeriod(period, '2026-09-20'), false);
  });
});

describe('clock punch pairing', () => {
  it('closes an open clock in and leaves a lone clock out unpaired', () => {
    const { pairs, unpaired } = pairClockPunches([
      punch('out', 'out', at(2026, 8, 8, 5, 0)),
      punch('in', 'in', at(2026, 8, 8, 6, 0)),
      punch('done', 'out', at(2026, 8, 8, 8, 30)),
    ]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].hours, 2.5);
    assert.equal(unpaired.length, 1);
    assert.equal(unpaired[0].reason, 'out');
  });
});
