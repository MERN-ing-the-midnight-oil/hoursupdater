import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PAY_PERIODS,
  applyTimeSummaryEdit,
  driverPayStatusChoices,
  isExDriverOnly,
  normalizeClockPayDefaults,
  normalizeDriverPayStatuses,
  normalizePayStatusByRun,
  normalizeStoredPayPortions,
  payPeriodPreset,
  paySlicesForPair,
  payStatusForClockIn,
} from '../office-tracker/src/driverPay.js';
import { buildMonthlySummaryMath, buildMonthlyTimeSummary, payPeriodsForClocks, payPeriodsForDriver, renderMonthlyTimeSummaryHtml, summaryPdfBasename } from '../office-tracker/src/monthlyTimeSummary.js';
import { mathPdfBasename, renderMonthlySummaryMathHtml } from '../office-tracker/src/summaryMath.js';
import { exampleOfficeState } from '../office-tracker/web/exampleRoutes.js';
import { listDrivers, saveDriver, saveTimeSummaryEdit } from '../office-tracker/web/store.js';
import { computeDeltaMinutes } from '../src/logic/timeUtils.js';

function memoryStorage() {
  /** @type {Record<string, string>} */
  const data = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
  };
}

test('monthly time summary fills REG DRIVER from quarter-hour clocks', () => {
  const summary = buildMonthlyTimeSummary({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    pay: { serial: '9001021', rate: '37.74', account: '8800-10-100' },
    roundClocks: true,
    now: new Date(2026, 9, 9, 12, 0),
    edits: {
      'driver-goofy-goof': {
        '2026-10-1': {
          'ot-trainer': { days: { 1: '1.50' }, comment: 'Practice hours' },
          'ex-driver': { days: { 8: '0.75' } },
        },
      },
    },
    punches: [
      {
        id: 'in',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 9, 8, 5, 54).toISOString(),
      },
      {
        id: 'out',
        driver_name: 'Goofy Goof',
        action: 'out',
        punched_at: new Date(2026, 9, 8, 8, 40).toISOString(),
      },
      {
        id: 'sep',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 8, 8, 6, 2).toISOString(),
      },
    ],
  });

  const october = summary.periods.find((period) => period.key === '2026-10-1');
  assert.equal(summary.defaultPeriodKey, '2026-10-1');
  assert.equal(october.label, 'October 1–15, 2026');
  assert.equal(october.ending, '10/15/2026');
  const regular = october.lines.find((line) => line.id === 'reg-driver');
  const day = regular.cells.find((cell) => cell.day === 8);
  assert.equal(day.value, '2.75');
  assert.equal(day.calculated, '2.75');
  assert.equal(regular.total, '2.75');
  assert.equal(october.grandTotal, '2.75');
  const trainer = october.lines.find((line) => line.id === 'ot-trainer');
  assert.equal(trainer.cells.find((cell) => cell.day === 1).value, '1.50');
  assert.equal(trainer.total, '1.50');
  assert.equal(trainer.comment, 'Practice hours');
  assert.equal(october.lines.find((line) => line.id === 'ex-driver').cells.find((cell) => cell.day === 8).value, '0.75');
  assert.equal(summary.serial, '9001021');
  assert.equal(summary.rate, '$37.74');
  assert.equal(summary.account, '8800-10-100');
  assert.equal(october.lines.every((line) => line.account == null), true);
  assert.equal(october.contractedHours.every((hours) => hours === ''), true);
  assert.equal(summary.jobTitle, 'Driver');
  const september = summary.periods.find((period) => period.key === '2026-09-1');
  assert.equal(september.lines.find((line) => line.id === 'reg-driver').total, '');
  assert.equal(september.unpaired.length, 1);
  assert.match(september.unpaired[0].when, /Sep/);
  assert.equal(september.unpaired[0].action, 'Clock in');

  const html = renderMonthlyTimeSummaryHtml(summary);
  assert.match(html, /MONTHLY TIME SUMMARY/);
  assert.match(html, /size: letter landscape/);
  assert.match(html, /id="print"/);
  assert.match(html, /id="email"/);
  assert.match(html, /Goofy Goof/);
  assert.match(html, /9001021/);
  assert.match(html, /\$37\.74/);
  assert.match(html, /8800-<wbr>10-<wbr>100/);
  assert.doesNotMatch(html, /9900-52-310/);
  assert.match(html, /value="2\.75"/);
  assert.match(html, /I certify that the above hours were worked as reported/);
  assert.match(html, /class="grand-total">2\.75/);
});

test('each day shows the contracted hours in effect on that date', () => {
  const previous = '6:00-8:00';
  const next = '6:00-8:15';
  const summary = buildMonthlyTimeSummary({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    roundClocks: true,
    now: new Date(2026, 9, 20, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '2' },
    officeState: {
      profiles: {
        route12: {
          name: '12',
          driver_name: 'Goofy Goof',
          start_date: '2026-09-01',
          changeLog: [
            {
              id: 'seed-am',
              route_id: 'SELF',
              segment: 'AM',
              effective_date: '2026-09-01',
              submitted_at: '2026-09-01T08:00:00.000Z',
              previous_time: previous,
              new_time: previous,
              delta_minutes: 0,
              computed_delta_minutes: 0,
            },
            {
              id: 'seed-pm',
              route_id: 'SELF',
              segment: 'PM',
              effective_date: '2026-09-01',
              submitted_at: '2026-09-01T08:00:01.000Z',
              previous_time: '14:00-16:00',
              new_time: '14:00-16:00',
              delta_minutes: 0,
              computed_delta_minutes: 0,
            },
            {
              id: 'change-am',
              route_id: 'SELF',
              segment: 'AM',
              effective_date: '2026-10-01',
              submitted_at: '2026-10-01T12:00:00.000Z',
              previous_time: previous,
              new_time: next,
              delta_minutes: computeDeltaMinutes(previous, next),
              computed_delta_minutes: computeDeltaMinutes(previous, next),
              // Office Accept on the Teamster suggested date locks these hours.
              force_contract_on: '2026-10-26',
            },
          ],
        },
      },
    },
  });
  const october = summary.periods.find((period) => period.key === '2026-10-2');
  const hours = (day) => october.contractedHours[october.days.indexOf(day)];
  assert.equal(hours(16), '4.00');
  assert.equal(hours(25), '4.00');
  assert.equal(hours(26), '4.25');
  assert.equal(hours(31), '4.25');
  const html = renderMonthlyTimeSummaryHtml(summary);
  assert.match(html, /REG CONTR HRS/);
  assert.equal(html.includes('<dt>REG CONTR HRS</dt>'), false);
  assert.match(html, />4\.00</);
  assert.match(html, />4\.25</);
});

test('a 30-minute decrease changes contract hours on that day', () => {
  const previous = '14:00-16:00';
  const next = '14:00-15:15';
  const later = '14:00-15:35';
  const summary = buildMonthlyTimeSummary({
    driverName: 'Donald Duck',
    driverId: 'driver-donald-duck',
    roundClocks: true,
    now: new Date(2026, 8, 30, 12, 0),
    focus: { year: 2026, monthIndex: 8, periodId: '2' },
    officeState: {
      profiles: {
        route7: {
          name: 'D 07',
          driver_name: 'Donald Duck',
          start_date: '2026-09-08',
          changeLog: [
            {
              id: 'seed-am',
              route_id: 'SELF',
              segment: 'AM',
              effective_date: '2026-09-08',
              submitted_at: '2026-09-08T08:00:00.000Z',
              previous_time: '6:00-8:00',
              new_time: '6:00-8:00',
              delta_minutes: 0,
              computed_delta_minutes: 0,
            },
            {
              id: 'seed-pm',
              route_id: 'SELF',
              segment: 'PM',
              effective_date: '2026-09-08',
              submitted_at: '2026-09-08T08:00:01.000Z',
              previous_time: previous,
              new_time: previous,
              delta_minutes: 0,
              computed_delta_minutes: 0,
            },
            {
              id: 'sept-21-cut',
              route_id: 'SELF',
              segment: 'PM',
              effective_date: '2026-09-21',
              submitted_at: '2026-09-21T15:00:00.000Z',
              previous_time: previous,
              new_time: next,
              delta_minutes: computeDeltaMinutes(previous, next),
              computed_delta_minutes: computeDeltaMinutes(previous, next),
            },
            {
              id: 'later-increase',
              route_id: 'SELF',
              segment: 'PM',
              effective_date: '2026-10-06',
              submitted_at: '2026-10-06T15:00:00.000Z',
              previous_time: next,
              new_time: later,
              delta_minutes: computeDeltaMinutes(next, later),
              computed_delta_minutes: computeDeltaMinutes(next, later),
            },
          ],
        },
      },
    },
  });
  const september = summary.periods.find((period) => period.key === '2026-09-2');
  const hours = (day) => september.contractedHours[september.days.indexOf(day)];
  assert.equal(hours(18), '4.00');
  assert.equal(hours(21), '3.25');
  assert.equal(hours(30), '3.25');
});

test('a typed REG DRIVER hour replaces the clock total for that day', () => {
  const summary = buildMonthlyTimeSummary({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    roundClocks: true,
    now: new Date(2026, 9, 9, 12, 0),
    edits: {
      'driver-goofy-goof': {
        '2026-10-1': { 'reg-driver': { days: { 8: '1.00' } } },
      },
    },
    punches: [
      {
        id: 'in',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 9, 8, 5, 54).toISOString(),
      },
      {
        id: 'out',
        driver_name: 'Goofy Goof',
        action: 'out',
        punched_at: new Date(2026, 9, 8, 8, 40).toISOString(),
      },
    ],
  });
  const october = summary.periods.find((period) => period.key === '2026-10-1');
  const day = october.lines.find((line) => line.id === 'reg-driver').cells.find((cell) => cell.day === 8);
  assert.equal(day.calculated, '2.75');
  assert.equal(day.value, '1.00');
  assert.equal(october.grandTotal, '1.00');
});

test('clearing a typed hour drops it and leaves another driver untouched', () => {
  const edits = applyTimeSummaryEdit(
    {
      'driver-goofy-goof': { '2026-10-1': { 'ot-trainer': { days: { 1: '1.50' } } } },
      'driver-mickey-mouse': { '2026-10-1': { 'ex-driver': { days: { 4: '0.25' } } } },
    },
    { driverId: 'driver-goofy-goof', periodKey: '2026-10-1', lineId: 'ot-trainer', kind: 'day', day: 1, hours: '' }
  );
  assert.equal(edits['driver-goofy-goof'], undefined);
  assert.equal(edits['driver-mickey-mouse']['2026-10-1']['ex-driver'].days['4'], '0.25');
});

test('clock hours follow the pay status on the clock in', () => {
  const summary = buildMonthlyTimeSummary({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    roundClocks: true,
    now: new Date(2026, 9, 10, 12, 0),
    punches: [
      {
        id: 'in-train',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 9, 8, 6, 0).toISOString(),
        pay_status: 'ot-trainer',
      },
      {
        id: 'out-train',
        driver_name: 'Goofy Goof',
        action: 'out',
        punched_at: new Date(2026, 9, 8, 8, 0).toISOString(),
        pay_status: 'reg-driver',
      },
      {
        id: 'in-reg',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 9, 9, 6, 0).toISOString(),
      },
      {
        id: 'out-reg',
        driver_name: 'Goofy Goof',
        action: 'out',
        punched_at: new Date(2026, 9, 9, 7, 0).toISOString(),
      },
    ],
  });
  const october = summary.periods.find((period) => period.key === '2026-10-1');
  const trainer = october.lines.find((line) => line.id === 'ot-trainer').cells.find((cell) => cell.day === 8);
  const regularSameDay = october.lines.find((line) => line.id === 'reg-driver').cells.find((cell) => cell.day === 8);
  const regularNextDay = october.lines.find((line) => line.id === 'reg-driver').cells.find((cell) => cell.day === 9);
  assert.equal(trainer.value, '2.00');
  assert.equal(regularSameDay.value, '');
  assert.equal(regularNextDay.value, '1.00');
});

test('a part of a clock period uses its own pay status and the rest keeps the period status', () => {
  const start = new Date(2026, 9, 8, 6, 0);
  const middle = new Date(2026, 9, 8, 7, 0);
  const end = new Date(2026, 9, 8, 8, 0);
  const pair = {
    start,
    end,
    clockIn: {
      pay_status: 'reg-driver',
      pay_portions: [
        { start: start.toISOString(), end: middle.toISOString(), pay_status: 'ot-trainer' },
        { start: '2026-10-08T12:00:00.000Z', end: '2026-10-08T12:30:00.000Z', pay_status: 'ex-trainer' },
        { start: middle.toISOString(), end: new Date(2026, 9, 8, 7, 20).toISOString(), pay_status: 'not-a-status' },
      ],
    },
  };
  const slices = paySlicesForPair(pair);
  assert.deepEqual(
    slices.map((slice) => slice.pay_status),
    ['ot-trainer', 'reg-driver']
  );
  assert.equal(slices.reduce((total, slice) => total + slice.minutes, 0), 120);

  const summary = buildMonthlyTimeSummary({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    roundClocks: true,
    now: new Date(2026, 9, 10, 12, 0),
    punches: [
      {
        id: 'in-split',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: start.toISOString(),
        pay_status: 'reg-driver',
        pay_portions: [{ start: start.toISOString(), end: middle.toISOString(), pay_status: 'ot-trainer' }],
      },
      {
        id: 'out-split',
        driver_name: 'Goofy Goof',
        action: 'out',
        punched_at: end.toISOString(),
      },
    ],
  });
  const october = summary.periods.find((period) => period.key === '2026-10-1');
  const trainer = october.lines.find((line) => line.id === 'ot-trainer').cells.find((cell) => cell.day === 8);
  const regular = october.lines.find((line) => line.id === 'reg-driver').cells.find((cell) => cell.day === 8);
  assert.equal(trainer.value, '1.00');
  assert.equal(regular.value, '1.00');
  assert.equal(
    normalizeStoredPayPortions([
      { start: middle.toISOString(), end: end.toISOString(), pay_status: 'ex-driver' },
      { start: start.toISOString(), end: middle.toISOString(), pay_status: 'ot-trainer' },
      { start: start.toISOString(), end: new Date(2026, 9, 8, 6, 30).toISOString(), pay_status: 'ex-trainer' },
    ]).map((portion) => portion.pay_status).join(','),
    'ex-trainer,ex-driver'
  );
});

test('a driver keeps the pay statuses the office assigns', () => {
  assert.deepEqual(normalizeDriverPayStatuses(undefined), ['ex-driver']);
  assert.deepEqual(normalizeDriverPayStatuses([]), ['ex-driver']);
  assert.deepEqual(normalizeDriverPayStatuses(['nope']), ['ex-driver']);
  assert.deepEqual(normalizeDriverPayStatuses(['ot-trainer', 'nope', 'ot-trainer', 'ex-driver']), [
    'ot-trainer',
    'ex-driver',
  ]);
  const lines = normalizeClockPayDefaults(undefined).lines;
  assert.deepEqual(
    driverPayStatusChoices(undefined, lines).map((line) => line.id),
    ['ex-driver']
  );
  assert.deepEqual(
    driverPayStatusChoices(['ot-trainer', 'ex-trainer'], lines).map((line) => line.id),
    ['ot-trainer', 'ex-trainer']
  );
  assert.equal(isExDriverOnly(undefined, lines), true);
  assert.equal(isExDriverOnly(['ex-driver'], lines), true);
  assert.equal(isExDriverOnly(['reg-driver', 'ex-driver'], lines), false);
  assert.equal(isExDriverOnly(['reg-driver'], lines), false);

  const storage = memoryStorage();
  saveDriver({ firstName: 'Mickey', lastName: 'Mouse', serial: '9001001', payStatuses: ['reg-driver', 'ex-driver'] }, storage);
  saveDriver({ firstName: 'Mickey', lastName: 'Mouse', email: 'mickey@example.com' }, storage);
  const mickey = listDrivers(storage).find((driver) => driver.name === 'Mickey Mouse');
  assert.deepEqual(mickey.payStatuses, ['reg-driver', 'ex-driver']);
  assert.equal(mickey.pay.serial, '9001001');
  assert.equal(mickey.email, 'mickey@example.com');
  assert.deepEqual(mickey.payStatusByRun, {
    AM: 'reg-driver',
    MIDDAY: 'reg-driver',
    PM: 'reg-driver',
    OTHER: 'reg-driver',
  });
});

test('a clock in uses the pay status the office assigned to that route', () => {
  const lines = normalizeClockPayDefaults(undefined).lines;
  assert.equal(payStatusForClockIn(['ex-driver'], { AM: 'reg-driver' }, 'AM', lines), 'ex-driver');
  assert.equal(payStatusForClockIn(undefined, undefined, 'PM', lines), 'ex-driver');
  assert.equal(
    payStatusForClockIn(['reg-driver', 'ot-trainer'], { PM: 'ot-trainer', OTHER: 'nope' }, 'PM', lines),
    'ot-trainer'
  );
  assert.equal(payStatusForClockIn(['reg-driver', 'ot-trainer'], {}, 'AM', lines), 'reg-driver');
  assert.deepEqual(normalizePayStatusByRun({ AM: 'ot-trainer', LUNCH: 'ex-driver' }, ['reg-driver', 'ot-trainer']), {
    AM: 'ot-trainer',
    MIDDAY: 'reg-driver',
    PM: 'reg-driver',
    OTHER: 'reg-driver',
  });
  assert.deepEqual(normalizePayStatusByRun({ AM: 'ot-trainer' }, ['ex-driver']), {});

  const storage = memoryStorage();
  saveDriver(
    {
      firstName: 'Mickey',
      lastName: 'Mouse',
      payStatuses: ['reg-driver', 'ex-driver'],
      payStatusByRun: { AM: 'ex-driver', PM: 'lunch' },
    },
    storage
  );
  saveDriver({ firstName: 'Mickey', lastName: 'Mouse', email: 'mickey@example.com' }, storage);
  const mickey = listDrivers(storage).find((driver) => driver.name === 'Mickey Mouse');
  assert.equal(mickey.payStatusByRun.AM, 'ex-driver');
  assert.equal(mickey.payStatusByRun.PM, 'reg-driver');
  assert.equal(mickey.email, 'mickey@example.com');
  saveDriver({ firstName: 'Mickey', lastName: 'Mouse', payStatuses: ['ex-driver'] }, storage);
  const only = listDrivers(storage).find((driver) => driver.name === 'Mickey Mouse');
  assert.equal(only.payStatusByRun, undefined);
  assert.deepEqual(only.payStatuses, ['ex-driver']);
});

test('each driver keeps one payroll account number, apart from pay status', () => {
  const defaults = normalizeClockPayDefaults({
    lines: [
      { id: 'reg-driver', account: '9900-52-310-210-1210-0000' },
      { id: 'pay-field-trip', label: 'FIELD TRIP', account: '9900-52-0000', otFactor: 1.5 },
    ],
  });
  assert.equal(defaults.lines.every((line) => line.account == null), true);
  assert.equal(defaults.lines.at(-1).otFactor, 1.5);

  const storage = memoryStorage();
  saveDriver({ firstName: 'Mickey', lastName: 'Mouse', account: '8800-10-100' }, storage);
  saveDriver({ firstName: 'Mickey', lastName: 'Mouse', serial: '9001001' }, storage);
  const mickey = listDrivers(storage).find((driver) => driver.name === 'Mickey Mouse');
  assert.equal(mickey.pay.account, '8800-10-100');
  assert.equal(mickey.pay.serial, '9001001');

  const summary = buildMonthlyTimeSummary({
    driverName: 'Mickey Mouse',
    driverId: mickey.id,
    pay: mickey.pay,
    defaults,
    now: new Date(2026, 9, 9, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1', lineIds: ['reg-driver', 'pay-field-trip'] },
  });
  const html = renderMonthlyTimeSummaryHtml(summary);
  assert.equal(summary.account, '8800-10-100');
  assert.equal(html.match(/8800-<wbr>10-<wbr>100/g).length, 2);
  assert.doesNotMatch(html, /9900-52/);
});

test('saving one driver keeps another driver serial and rate', () => {
  const storage = memoryStorage();
  saveDriver({ firstName: 'Mickey', lastName: 'Mouse', serial: '9001001', rate: '37.74' }, storage);
  saveDriver({ firstName: 'Alex', lastName: 'Driver', email: 'alex@example.com' }, storage);
  const mickey = listDrivers(storage).find((driver) => driver.name === 'Mickey Mouse');
  const alex = listDrivers(storage).find((driver) => driver.name === 'Alex Driver');
  assert.equal(mickey.pay.serial, '9001001');
  assert.equal(mickey.pay.rate, '37.74');
  assert.equal(alex.pay, undefined);

  saveDriver({ id: mickey.id, firstName: 'Mickey', lastName: 'Mouse', email: 'mickey.mouse@example.com' }, storage);
  assert.equal(listDrivers(storage).find((driver) => driver.name === 'Mickey Mouse').pay.serial, '9001001');

  saveTimeSummaryEdit(
    {
      driverId: 'driver-mickey-mouse',
      periodKey: '2026-10-1',
      lineId: 'ot-trainer',
      kind: 'day',
      day: 2,
      hours: '1.5',
    },
    storage
  );
  const saved = saveTimeSummaryEdit(
    {
      driverId: 'driver-alex-driver',
      periodKey: '2026-10-1',
      lineId: 'reg-driver',
      kind: 'day',
      day: 2,
      hours: 'nope',
    },
    storage
  );
  assert.equal(saved['driver-mickey-mouse']['2026-10-1']['ot-trainer'].days['2'], '1.50');
  assert.equal(saved['driver-alex-driver'], undefined);
});

test('pay periods default to days 1–15 and 16 through the end, or the whole month', () => {
  const defaults = normalizeClockPayDefaults({});
  assert.equal(payPeriodPreset(defaults.periods), 'split');
  assert.deepEqual(
    defaults.periods.map((period) => [period.startDay, period.endDay]),
    [
      [1, 15],
      [16, 31],
    ]
  );
  assert.deepEqual(
    defaults.lines.map((line) => line.label),
    ['REG DRIVER', 'OT DR TRAINER', 'EX DR TRAINER', 'EX DRIVER']
  );

  const whole = normalizeClockPayDefaults({
    periods: [{ id: '1', startDay: 1, endDay: 31 }],
  });
  assert.equal(payPeriodPreset(whole.periods), 'month');
  const october = buildMonthlyTimeSummary({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    defaults: whole,
    now: new Date(2026, 9, 9, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1', lineIds: ['reg-driver'] },
    punches: [
      {
        id: 'in',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 9, 20, 6, 0).toISOString(),
      },
      {
        id: 'out',
        driver_name: 'Goofy Goof',
        action: 'out',
        punched_at: new Date(2026, 9, 20, 8, 0).toISOString(),
      },
    ],
  });
  assert.equal(october.periods.length, 1);
  assert.equal(october.periods[0].days.length, 31);
  assert.equal(october.periods[0].days.at(-1), 31);
  assert.equal(october.periods[0].lines.length, 1);
  assert.equal(october.periods[0].lines[0].cells.find((cell) => cell.day === 20).value, '2.00');

  const february = buildMonthlyTimeSummary({
    driverName: 'Goofy Goof',
    defaults: whole,
    now: new Date(2026, 1, 2, 12, 0),
    focus: { year: 2026, monthIndex: 1, periodId: '1' },
  });
  assert.equal(february.periods[0].days.length, 28);
  assert.equal(february.periods[0].ending, '02/28/2026');
});

test('an added pay status can be chosen for one summary and keeps typed hours', () => {
  const defaults = normalizeClockPayDefaults({
    lines: [{ id: 'pay-field-trip', label: 'FIELD TRIP', account: '9900-52-0000', otFactor: 0 }],
    periods: [{ startDay: 1, endDay: 4 }, { startDay: 3, endDay: 10 }],
  });
  assert.equal(defaults.lines.at(-1).label, 'FIELD TRIP');
  assert.equal(defaults.lines.at(-1).custom, true);
  assert.equal(defaults.lines.at(-1).account, undefined);
  assert.deepEqual(
    defaults.periods.map((period) => [period.startDay, period.endDay]),
    [[1, 4]]
  );

  const summary = buildMonthlyTimeSummary({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    defaults,
    now: new Date(2026, 9, 9, 12, 0),
    focus: {
      year: 2026,
      monthIndex: 9,
      periodId: defaults.periods[0].id,
      lineIds: ['ex-driver', 'pay-field-trip'],
    },
    edits: {
      'driver-goofy-goof': {
        '2026-10-1': { 'pay-field-trip': { days: { 2: '3.25' }, comment: 'Band trip' } },
      },
    },
  });
  const lines = summary.periods[0].lines;
  assert.deepEqual(
    lines.map((line) => line.label),
    ['EX DRIVER', 'FIELD TRIP']
  );
  assert.equal(summary.periods[0].days.length, 4);
  assert.equal(lines[1].cells.find((cell) => cell.day === 2).value, '3.25');
  assert.equal(lines[1].comment, 'Band trip');
  assert.equal(summary.periods[0].grandTotal, '3.25');
  const html = renderMonthlyTimeSummaryHtml(summary);
  assert.match(html, /FIELD TRIP/);
  assert.doesNotMatch(html, /REG DRIVER/);

  const edits = applyTimeSummaryEdit(
    {},
    {
      driverId: 'driver-goofy-goof',
      periodKey: '2026-10-1',
      lineId: 'pay-field-trip',
      kind: 'day',
      day: 2,
      hours: '3.25',
    }
  );
  assert.equal(edits['driver-goofy-goof']['2026-10-1']['pay-field-trip'].days['2'], '3.25');
});

test('the summary email uses the driver address and a landscape letter file name', () => {
  assert.equal(summaryPdfBasename('Daisy Duck'), 'daisy-duck-monthly-time-summary');
  assert.equal(summaryPdfBasename('Ann "Ace" Driver'), 'ann-ace-driver-monthly-time-summary');
  assert.equal(summaryPdfBasename('   '), 'driver-monthly-time-summary');
  const summary = buildMonthlyTimeSummary({
    driverName: 'Daisy Duck',
    driverId: 'driver-daisy-duck',
    email: 'daisy.duck@example.com',
    now: new Date(2026, 9, 10, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
  });
  const html = renderMonthlyTimeSummaryHtml(summary);
  assert.match(html, /data-driver-email="daisy.duck@example.com"/);
  assert.match(html, /data-driver-name="Daisy Duck"/);
  assert.match(html, /Add an email for /);
  assert.match(html, /width: 11in/);
  assert.match(html, /height: 8.5in/);
});

function contractedRoute(ranges) {
  return {
    profiles: {
      route12: {
        name: '12',
        driver_name: 'Goofy Goof',
        start_date: '2026-09-01',
        changeLog: ranges.map(([segment, range], index) => ({
          id: `seed-${segment}`,
          route_id: 'SELF',
          segment,
          effective_date: '2026-09-01',
          submitted_at: `2026-09-01T08:00:0${index}.000Z`,
          previous_time: range,
          new_time: range,
          delta_minutes: computeDeltaMinutes(range, range),
          computed_delta_minutes: computeDeltaMinutes(range, range),
        })),
      },
    },
  };
}

test('EX DRIVER is the clocked time beyond that day contract hours', () => {
  const officeState = contractedRoute([
    ['AM', '6:00-9:00'],
    ['PM', '14:00-16:30'],
  ]);
  const summary = buildMonthlyTimeSummary({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    roundClocks: true,
    now: new Date(2026, 9, 10, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    officeState,
    punches: [
      {
        id: 'in',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 9, 8, 6, 7).toISOString(),
        pay_status: 'ex-driver',
      },
      {
        id: 'out',
        driver_name: 'Goofy Goof',
        action: 'out',
        punched_at: new Date(2026, 9, 8, 12, 38).toISOString(),
      },
    ],
  });
  const october = summary.periods.find((period) => period.key === '2026-10-1');
  const day = (id) => october.lines.find((line) => line.id === id).cells.find((cell) => cell.day === 8);
  assert.equal(october.contractedHours[october.days.indexOf(8)], '5.50');
  assert.equal(day('ex-driver').calculated, '1.25');
  assert.equal(day('ex-driver').value, '1.25');
  assert.equal(day('reg-driver').value, '');
  assert.equal(day('ot-trainer').value, '');

  const math = buildMonthlySummaryMath({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    email: 'goofy@example.com',
    roundClocks: true,
    now: new Date(2026, 9, 10, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    officeState,
    punches: [
      {
        id: 'in',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 9, 8, 6, 7).toISOString(),
        pay_status: 'ex-driver',
      },
      {
        id: 'out',
        driver_name: 'Goofy Goof',
        action: 'out',
        punched_at: new Date(2026, 9, 8, 12, 38).toISOString(),
      },
    ],
  });
  const eighth = math.periods[0].days.find((item) => item.day === 8);
  assert.equal(eighth.contractHours, '5.50');
  assert.equal(eighth.clockedHours, '6.75');
  assert.equal(eighth.cell, '1.25');
  const html = renderMonthlySummaryMathHtml(math);
  assert.match(html, /Driver Pay period info/);
  assert.doesNotMatch(html, /EX DRIVER TIME SUMMARY MATH/);
  assert.match(html, /Email copy to driver/);
  assert.match(html, /data-driver-email="goofy@example.com"/);
  assert.match(html, /table-layout:\s*fixed/);
  assert.match(html, /overflow-x:\s*hidden/);
  assert.doesNotMatch(html, /overflow-x:\s*auto/);
  assert.equal(mathPdfBasename('Goofy Goof'), 'goofy-goof-driver-pay-period-info');
  assert.match(html, /<th scope="col">8<\/th>/);
  assert.match(html, /<th scope="row">Clock In<\/th>/);
  assert.match(html, /<th scope="row">Clock Out<\/th>/);
  assert.match(html, /<th scope="row">Rounded clock in<\/th>/);
  assert.match(html, /<th scope="row">Rounded clock out<\/th>/);
  assert.match(html, /<th scope="row">Contracted clock in<\/th>/);
  assert.match(html, /<th scope="row">EX DRIVER<\/th>/);
  assert.match(html, /data-row="pair-0-rounded-in" data-day="8"[^>]*>6:00 AM</);
  assert.match(html, /data-row="pair-0-rounded-out" data-day="8"[^>]*>12:45 PM</);
  assert.doesNotMatch(html, /AM Route|PM Route/);
  assert.match(html, /data-row="pair-0-in" data-day="8">6:07 AM</);
  assert.match(html, /data-row="pair-0-out" data-day="8">12:38 PM</);
  assert.match(html, /data-row="pair-0-actual" data-day="8"[^>]*data-math="391 is 12:38 PM minus 6:07 AM\."[^>]*>391</);
  assert.match(html, /data-math="405 is 12:45 PM minus 6:00 AM\. 6:07 AM snapped to 6:00 AM and 12:38 PM snapped to 12:45 PM\."/);
  assert.match(html, /data-math="6:00 AM is 6:07 AM snapped to the nearest quarter hour\."/);
  assert.match(html, /data-math="12:45 PM is 12:38 PM snapped to the nearest quarter hour\."/);
  assert.doesNotMatch(html, /Quarter-hour minutes/);
  assert.match(html, /<tr class="pair pair-a pair-start">[\s\S]*data-row="pair-0-in" data-day="8">6:07 AM</);
  assert.match(html, /<tr class="[^"]*\bused\b[^"]*">[\s\S]*data-row="pair-0-snap" data-day="8"[^>]*>405</);
  assert.match(html, /data-row="billable" data-day="8"[^>]*>6\.75</);
  assert.match(html, /data-math="6\.75 is the sum of 405 minutes from that day\."/);
  assert.match(html, /data-row="billable"[\s\S]*<th scope="row">Contract hours<\/th>[\s\S]*<th scope="row">EX HOURS<\/th>/);
  assert.match(html, /<th scope="row">EX HOURS<\/th>/);
  assert.match(html, /data-row="ex-hours" data-day="8"[^>]*>1\.25</);
  assert.match(
    html,
    /data-math="1\.25 is the subtraction of 5\.50 \(contract hours\) from 6\.75 \(the total billable clock hours\)\."/
  );
  assert.match(html, /data-total="ex-hours"[^>]*>1\.25</);

  const two = buildMonthlySummaryMath({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    roundClocks: true,
    now: new Date(2026, 9, 10, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    officeState,
    punches: [
      { id: 'in-1', driver_name: 'Goofy Goof', action: 'in', run: 'AM', punched_at: new Date(2026, 9, 8, 6, 7).toISOString(), pay_status: 'ex-driver' },
      { id: 'out-1', driver_name: 'Goofy Goof', action: 'out', run: 'AM', punched_at: new Date(2026, 9, 8, 9, 0).toISOString() },
      { id: 'in-2', driver_name: 'Goofy Goof', action: 'in', run: 'PM', punched_at: new Date(2026, 9, 8, 14, 8).toISOString(), pay_status: 'ex-driver' },
      { id: 'out-2', driver_name: 'Goofy Goof', action: 'out', run: 'PM', punched_at: new Date(2026, 9, 8, 16, 40).toISOString() },
    ],
  });
  const twoHtml = renderMonthlySummaryMathHtml(two);
  assert.match(twoHtml, /<th scope="row">Clock In 1<\/th>/);
  assert.match(twoHtml, /<th scope="row">Clock Out 1<\/th>/);
  assert.match(twoHtml, /<th scope="row">Clock In 2<\/th>/);
  assert.match(twoHtml, /<th scope="row">Clock Out 2<\/th>/);
  assert.match(twoHtml, /data-row="pair-0-in" data-day="8">6:07 AM</);
  assert.match(twoHtml, /data-row="pair-0-out" data-day="8">9:00 AM</);
  assert.match(twoHtml, /data-row="pair-1-in" data-day="8">2:08 PM</);
  assert.match(twoHtml, /data-row="pair-1-out" data-day="8">4:40 PM</);
  assert.doesNotMatch(twoHtml, /AM Route|PM Route|Midday Route/);
});

test('a replaced clock in stays struck through in its own pay-period cell', () => {
  const officeState = contractedRoute([
    ['AM', '6:00-9:00'],
    ['PM', '14:00-16:30'],
  ]);
  const math = buildMonthlySummaryMath({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    roundClocks: true,
    now: new Date(2026, 9, 10, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    officeState,
    punches: [
      { id: 'in-1', driver_name: 'Goofy Goof', action: 'in', run: 'AM', punched_at: new Date(2026, 9, 8, 6, 7).toISOString(), pay_status: 'ex-driver' },
      { id: 'in-2', driver_name: 'Goofy Goof', action: 'in', run: 'AM', punched_at: new Date(2026, 9, 8, 6, 20).toISOString(), pay_status: 'ex-driver' },
      { id: 'out', driver_name: 'Goofy Goof', action: 'out', run: 'AM', punched_at: new Date(2026, 9, 8, 9, 0).toISOString() },
    ],
  });
  const eighth = math.periods[0].days.find((item) => item.day === 8);
  assert.equal(eighth.pairs.length, 1);
  assert.equal(eighth.pairs[0].writtenIn, '6:20 AM');
  assert.equal(eighth.pairs[0].writtenOut, '9:00 AM');
  assert.deepEqual(eighth.replacedClocks, [{ action: 'in', clock: '6:07 AM' }]);
  const html = renderMonthlySummaryMathHtml(math);
  assert.match(html, /<th scope="row">Earlier clock in<\/th>/);
  assert.match(html, /<s>6:07 AM<\/s>/);
  assert.match(html, /data-row="pair-0-in" data-day="8">6:20 AM</);
  assert.match(html, /if this is the real one/);
});

test('daily rounding rounds the day once, and separate rounding rounds each clock span', () => {
  const officeState = contractedRoute([
    ['AM', '6:00-9:00'],
    ['PM', '14:00-16:30'],
  ]);
  const punches = [
    {
      id: 'in-am',
      driver_name: 'Goofy Goof',
      action: 'in',
      punched_at: new Date(2026, 9, 8, 6, 0).toISOString(),
    },
    {
      id: 'out-am',
      driver_name: 'Goofy Goof',
      action: 'out',
      punched_at: new Date(2026, 9, 8, 8, 7).toISOString(),
    },
    {
      id: 'in-mid',
      driver_name: 'Goofy Goof',
      action: 'in',
      punched_at: new Date(2026, 9, 8, 11, 0).toISOString(),
    },
    {
      id: 'out-mid',
      driver_name: 'Goofy Goof',
      action: 'out',
      punched_at: new Date(2026, 9, 8, 12, 7).toISOString(),
    },
  ];
  const reg = (rounding) => {
    const summary = buildMonthlyTimeSummary({
      driverName: 'Goofy Goof',
      driverId: 'driver-goofy-goof',
      rounding,
      now: new Date(2026, 9, 10, 12, 0),
      focus: { year: 2026, monthIndex: 9, periodId: '1' },
      officeState,
      punches,
    });
    return summary.periods[0].lines.find((line) => line.id === 'reg-driver').cells.find((cell) => cell.day === 8).value;
  };
  assert.equal(reg('snap'), '3.00');
  assert.equal(reg('separate'), '3.00');
  assert.equal(reg('daily'), '3.25');

  const math = buildMonthlySummaryMath({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    rounding: 'daily',
    now: new Date(2026, 9, 10, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    officeState,
    punches,
  });
  const eighth = math.periods[0].days.find((item) => item.day === 8);
  assert.equal(eighth.clockedHours, '3.25');
  assert.equal(eighth.contractHours, '5.50');
  const html = renderMonthlySummaryMathHtml(math);
  assert.match(html, /<tr class="billable used">/);
  assert.match(html, /data-row="billable" data-day="8"[^>]*>3\.25</);
  assert.doesNotMatch(html, /Quarter-hour minutes/);
  assert.match(
    html,
    /data-math="3\.25 is the sum of 127 and 67 minutes from that day, rounded to the nearest quarter hour\."/
  );
  assert.doesNotMatch(html, /<tr class="used">/);

  const separateHtml = renderMonthlySummaryMathHtml(
    buildMonthlySummaryMath({
      driverName: 'Goofy Goof',
      driverId: 'driver-goofy-goof',
      rounding: 'separate',
      now: new Date(2026, 9, 10, 12, 0),
      focus: { year: 2026, monthIndex: 9, periodId: '1' },
      officeState,
      punches,
    })
  );
  assert.match(separateHtml, /<th scope="row">Quarter-hour minutes 1<\/th>/);
  assert.match(separateHtml, /<th scope="row">Quarter-hour minutes 2<\/th>/);
  assert.match(separateHtml, /data-math="3\.00 is the sum of 120 and 60 minutes from that day\."/);
});

test('time under the contract, or clocks with no contract, leave EX DRIVER blank', () => {
  const officeState = contractedRoute([
    ['AM', '6:00-9:00'],
    ['PM', '14:00-16:30'],
  ]);
  const under = buildMonthlyTimeSummary({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    roundClocks: true,
    now: new Date(2026, 9, 10, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    officeState,
    punches: [
      {
        id: 'in-ot',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 9, 8, 8, 0).toISOString(),
        pay_status: 'ot-trainer',
      },
      {
        id: 'out-ot',
        driver_name: 'Goofy Goof',
        action: 'out',
        punched_at: new Date(2026, 9, 8, 10, 0).toISOString(),
      },
    ],
  });
  const october = under.periods[0];
  const cell = (id) => october.lines.find((line) => line.id === id).cells.find((item) => item.day === 8);
  assert.equal(cell('ot-trainer').value, '2.00');
  assert.equal(cell('ex-driver').value, '');
  assert.equal(cell('reg-driver').value, '');

  const math = buildMonthlySummaryMath({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    roundClocks: true,
    now: new Date(2026, 9, 10, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    officeState,
    punches: [
      {
        id: 'in',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 9, 8, 8, 0).toISOString(),
        pay_status: 'ex-driver',
      },
      {
        id: 'out',
        driver_name: 'Goofy Goof',
        action: 'out',
        punched_at: new Date(2026, 9, 8, 10, 0).toISOString(),
      },
    ],
  });
  const short = math.periods[0].days.find((item) => item.day === 8);
  assert.equal(short.clockedHours, '2.00');
  assert.equal(short.contractHours, '5.50');
  assert.equal(short.residual, '-3.50');
  const mathHtml = renderMonthlySummaryMathHtml(math);
  assert.match(mathHtml, /data-row="billable"[\s\S]*data-row="contract" data-day="8"[^>]*>5\.50[\s\S]*data-row="ex-hours" data-day="8"[^>]*>-3\.50/);
  assert.match(mathHtml, /data-total="ex-hours"[^>]*>-3\.50/);

  const open = buildMonthlyTimeSummary({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    roundClocks: true,
    now: new Date(2026, 9, 10, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    punches: [
      {
        id: 'in',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 9, 9, 6, 0).toISOString(),
        pay_status: 'ex-driver',
      },
      {
        id: 'out',
        driver_name: 'Goofy Goof',
        action: 'out',
        punched_at: new Date(2026, 9, 9, 12, 30).toISOString(),
      },
    ],
  });
  const friday = open.periods[0].lines.find((line) => line.id === 'ex-driver').cells.find((item) => item.day === 9);
  assert.equal(friday.value, '');
  assert.equal(friday.calculated, '');
});

test('a typed EX DRIVER hour replaces the residual for that day', () => {
  const officeState = contractedRoute([
    ['AM', '6:00-9:00'],
    ['PM', '14:00-16:30'],
  ]);
  const punches = [
    {
      id: 'in',
      driver_name: 'Goofy Goof',
      action: 'in',
      punched_at: new Date(2026, 9, 8, 6, 7).toISOString(),
      pay_status: 'ex-driver',
    },
    {
      id: 'out',
      driver_name: 'Goofy Goof',
      action: 'out',
      punched_at: new Date(2026, 9, 8, 12, 38).toISOString(),
    },
  ];
  const summary = buildMonthlyTimeSummary({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    roundClocks: true,
    now: new Date(2026, 9, 10, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    officeState,
    punches,
    edits: {
      'driver-goofy-goof': { '2026-10-1': { 'ex-driver': { days: { 8: '0.50' } } } },
    },
  });
  const day = summary.periods[0].lines.find((line) => line.id === 'ex-driver').cells.find((cell) => cell.day === 8);
  assert.equal(day.calculated, '1.25');
  assert.equal(day.value, '0.50');
  const html = renderMonthlySummaryMathHtml(
    buildMonthlySummaryMath({
      driverName: 'Goofy Goof',
      driverId: 'driver-goofy-goof',
      roundClocks: true,
      now: new Date(2026, 9, 10, 12, 0),
      focus: { year: 2026, monthIndex: 9, periodId: '1' },
      officeState,
      punches,
      edits: {
        'driver-goofy-goof': { '2026-10-1': { 'ex-driver': { days: { 8: '0.50' } } } },
      },
    })
  );
  assert.match(html, /data-row="ex-hours" data-day="8"[^>]*>1\.25</);
});

test('a September route start lists September pay periods for that driver', () => {
  const now = new Date(2026, 9, 14, 12, 0);
  const office = {
    punches: [
      { driver_name: 'Daisy Duck', punched_at: '2026-10-14T14:54:57.407Z', action: 'in' },
    ],
    profiles: {
      d07: {
        driver_name: 'Donald Duck',
        start_date: '2026-09-08',
        assignments: [{ driver_name: 'Donald Duck', from: '2026-09-08', until: null }],
        changeLog: [
          { effective_date: '2026-09-08', driver_name: 'Donald Duck', segment: 'PM' },
          { effective_date: '2026-09-16', driver_name: 'Donald Duck', segment: 'MIDDAY' },
          { effective_date: '2026-09-21', driver_name: 'Donald Duck', segment: 'PM' },
        ],
      },
    },
  };
  const donald = payPeriodsForDriver(office, 'Donald Duck', DEFAULT_PAY_PERIODS, now);
  assert.deepEqual(donald.map((period) => period.label), [
    'October 16–31, 2026',
    'October 1–15, 2026',
    'September 16–30, 2026',
    'September 1–15, 2026',
  ]);
  const daisy = payPeriodsForDriver(office, 'Daisy Duck', DEFAULT_PAY_PERIODS, now);
  assert.deepEqual(daisy.map((period) => period.key), ['2026-10-2', '2026-10-1']);
});

test('clocks from an earlier month list more than the current two pay periods', () => {
  const now = new Date(2026, 9, 10, 12, 0);
  const empty = payPeriodsForClocks([], DEFAULT_PAY_PERIODS, now);
  assert.deepEqual(empty.map((period) => period.key), ['2026-10-2', '2026-10-1']);

  const covered = payPeriodsForClocks(
    [
      { punched_at: '2026-08-04T13:00:00.000Z' },
      { punched_at: '2026-09-18T13:00:00.000Z' },
      { punched_at: 'not-a-date' },
    ],
    DEFAULT_PAY_PERIODS,
    now
  );
  assert.deepEqual(covered.map((period) => period.key), [
    '2026-10-2',
    '2026-10-1',
    '2026-09-2',
    '2026-09-1',
    '2026-08-2',
    '2026-08-1',
  ]);
});

test('weekend, evening, and over-eight clocks add overtime rows and a total', () => {
  const officeState = contractedRoute([['AM', '6:00-9:00']]);
  const punches = [
    { id: 'thu-in', driver_name: 'Mickey Mouse', action: 'in', punched_at: new Date(2026, 9, 8, 14, 7).toISOString(), pay_status: 'ex-driver' },
    { id: 'thu-out', driver_name: 'Mickey Mouse', action: 'out', punched_at: new Date(2026, 9, 8, 18, 38).toISOString() },
    { id: 'sat-in', driver_name: 'Mickey Mouse', action: 'in', punched_at: new Date(2026, 9, 10, 8, 4).toISOString(), pay_status: 'ex-driver' },
    { id: 'sat-out', driver_name: 'Mickey Mouse', action: 'out', punched_at: new Date(2026, 9, 10, 12, 19).toISOString() },
    { id: 'goof-am-in', driver_name: 'Goofy Goof', action: 'in', punched_at: new Date(2026, 9, 5, 6, 4).toISOString(), pay_status: 'ex-driver' },
    { id: 'goof-am-out', driver_name: 'Goofy Goof', action: 'out', punched_at: new Date(2026, 9, 5, 9, 11).toISOString() },
    { id: 'goof-mid-in', driver_name: 'Goofy Goof', action: 'in', punched_at: new Date(2026, 9, 5, 10, 58).toISOString(), pay_status: 'ex-driver' },
    { id: 'goof-mid-out', driver_name: 'Goofy Goof', action: 'out', punched_at: new Date(2026, 9, 5, 12, 22).toISOString() },
    { id: 'goof-pm-in', driver_name: 'Goofy Goof', action: 'in', punched_at: new Date(2026, 9, 5, 13, 36).toISOString(), pay_status: 'ex-driver' },
    { id: 'goof-pm-out', driver_name: 'Goofy Goof', action: 'out', punched_at: new Date(2026, 9, 5, 18, 21).toISOString() },
  ];
  const math = buildMonthlySummaryMath({
    driverName: 'Mickey Mouse',
    driverId: 'driver-mickey-mouse',
    rounding: 'snap',
    now: new Date(2026, 9, 11, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    officeState,
    punches,
  });
  const thursday = math.periods[0].days.find((day) => day.day === 8).pairs[0];
  const saturday = math.periods[0].days.find((day) => day.day === 10).pairs[0];
  assert.equal(thursday.actualOvertimeMinutes, 68);
  assert.equal(thursday.snapOvertimeMinutes, 75);
  assert.deepEqual(thursday.overtimeReasons, ['at or after 5:30 PM']);
  assert.equal(saturday.actualOvertimeMinutes, 255);
  assert.equal(saturday.snapOvertimeMinutes, 255);
  assert.deepEqual(saturday.overtimeReasons, ['Saturday']);
  const html = renderMonthlySummaryMathHtml(math);
  assert.match(html, /<th scope="row">Actual overtime minutes<\/th>/);
  assert.match(html, /<th scope="row">Snap overtime minutes<\/th>/);
  assert.match(html, /data-row="pair-0-actual-ot" data-day="8"[^>]*>68</);
  assert.match(html, /data-row="pair-0-snap-ot" data-day="8"[^>]*>75</);
  assert.match(html, /data-row="pair-0-actual-ot" data-day="10"[^>]*>255</);
  assert.match(html, /data-total="overtime"[^>]*>5\.50 × 1\.5 = 8\.25</);
  assert.doesNotMatch(html, /Quarter-hour overtime minutes/);

  const goofy = buildMonthlySummaryMath({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    rounding: 'snap',
    now: new Date(2026, 9, 11, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    officeState,
    punches,
  });
  const evening = goofy.periods[0].days.find((day) => day.day === 5).pairs[2];
  assert.equal(evening.actualOvertimeMinutes, 76);
  assert.ok(evening.overtimeReasons.includes('over 8 hours in the day'));
  assert.ok(evening.overtimeReasons.includes('at or after 5:30 PM'));

  const separate = renderMonthlySummaryMathHtml(
    buildMonthlySummaryMath({
      driverName: 'Mickey Mouse',
      driverId: 'driver-mickey-mouse',
      rounding: 'separate',
      now: new Date(2026, 9, 11, 12, 0),
      focus: { year: 2026, monthIndex: 9, periodId: '1' },
      officeState,
      punches,
      overtimeRules: { multiplier: 2 },
    })
  );
  assert.match(separate, /<th scope="row">Quarter-hour overtime minutes<\/th>/);
  assert.doesNotMatch(separate, /Snap overtime minutes/);
  assert.match(separate, /data-total="overtime"[^>]*>5\.50 × 2 = 11\.00</);

  const daytime = buildMonthlySummaryMath({
    driverName: 'Mickey Mouse',
    driverId: 'driver-mickey-mouse',
    rounding: 'snap',
    now: new Date(2026, 9, 11, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    officeState,
    punches: punches.filter((punch) => punch.id.startsWith('thu')),
    overtimeRules: { eveningStart: null, weekendOvertime: false, holidayOvertime: false },
  });
  const plain = daytime.periods[0].days.find((day) => day.day === 8).pairs[0];
  assert.equal(plain.actualOvertimeMinutes, 0);
  assert.doesNotMatch(renderMonthlySummaryMathHtml(daytime), /Actual overtime minutes/);
});

test('a reason with a time becomes its own clock note for that day', () => {
  const math = buildMonthlySummaryMath({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    roundClocks: true,
    now: new Date(2026, 9, 10, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    punches: [
      {
        id: 'in',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 9, 8, 6, 7).toISOString(),
        note: 'Left the yard late.',
        reason_codes: [
          { id: 'reason-traffic', label: 'Traffic', minutes: 75 },
          { id: 'reason-weather', label: 'Weather' },
        ],
      },
      {
        id: 'out',
        driver_name: 'Goofy Goof',
        action: 'out',
        punched_at: new Date(2026, 9, 8, 9, 0).toISOString(),
      },
    ],
  });
  const day = math.periods[0].days.find((item) => item.day === 8);
  const texts = day.notes.map((note) => note.text);
  assert.ok(texts.includes('Left the yard late.'));
  assert.ok(texts.includes('Traffic · 1 hour 15 minutes'));
  assert.equal(texts.includes('Weather'), false);
  const reason = day.notes.find((note) => note.text.startsWith('Traffic'));
  assert.equal(reason.when, 'Clock in 6:07 AM');
  assert.match(renderMonthlySummaryMathHtml(math), /Traffic · 1 hour 15 minutes/);
});

test('driver pay period info lists clock notes and office notes', () => {
  const math = buildMonthlySummaryMath({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    roundClocks: true,
    now: new Date(2026, 9, 10, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    punches: [
      {
        id: 'in',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 9, 8, 6, 7).toISOString(),
        pay_status: 'ex-driver',
        note: 'Left the yard late.',
      },
      {
        id: 'out',
        driver_name: 'Goofy Goof',
        action: 'out',
        punched_at: new Date(2026, 9, 8, 9, 0).toISOString(),
        note: 'Traffic on the way back.',
        office_edits: [
          {
            action: 'change',
            note: 'Clock out corrected after a call from the yard.',
            by: 'Office',
            by_user_id: null,
            at: '2026-10-08T20:00:00.000Z',
          },
        ],
      },
    ],
  });
  const html = renderMonthlySummaryMathHtml(math);
  assert.match(html, /<h2>Clock notes<\/h2>/);
  assert.match(html, /Clock in 6:07 AM/);
  assert.match(html, /Left the yard late/);
  assert.match(html, /Clock out 9:00 AM/);
  assert.match(html, /Traffic on the way back/);
  assert.match(html, /Changed by Office/);
  assert.match(html, /Clock out corrected after a call from the yard/);
});

test('Donald Duck has a full September 1–15 example with a mid-period contract change and notes', () => {
  const state = exampleOfficeState();
  const math = buildMonthlySummaryMath({
    driverName: 'Donald Duck',
    driverId: 'driver-donald-duck',
    rounding: 'snap',
    now: new Date(2026, 8, 20, 12, 0),
    focus: { year: 2026, monthIndex: 8, periodId: '1' },
    officeState: state,
    punches: state.punches,
  });
  const days = math.periods[0].days;
  const first = days.find((day) => day.day === 1);
  const seventh = days.find((day) => day.day === 7);
  const eighth = days.find((day) => day.day === 8);
  const fifteenth = days.find((day) => day.day === 15);
  assert.equal(first.pairs.length, 3);
  assert.equal(eighth.pairs.length, 3);
  assert.equal(fifteenth.pairs.length, 3);
  assert.equal(seventh.pairs.length, 0);
  assert.equal(first.contractHours, '6.50');
  assert.equal(eighth.contractHours, '5.75');
  assert.equal(fifteenth.contractHours, '5.75');
  const html = renderMonthlySummaryMathHtml(math);
  assert.match(html, /Driver Pay period info/);
  assert.match(html, /First week back\. Walked the AM stops with the monitor\./);
  assert.match(html, /Preschool student was not ready\. Waited at the door\./);
  assert.match(html, /Yard fuel stop before the PM run\./);
  assert.match(html, /Traffic on Blue Hill Ave added a few minutes\./);
  assert.match(html, /Clock out corrected after the driver called from the yard\./);
  assert.match(html, /Changed by Office/);
  assert.match(html, /PM run is shorter today\. One stop moved to another route\./);
  assert.match(html, /PM ended 45 minutes earlier\. One stop moved to another route\./);
  assert.match(html, /Contract hours/);
  assert.match(html, /Extra preschool pickup on this midday\./);
  assert.match(html, /Parent was late at the last stop\./);
  assert.match(html, /Left the yard a few minutes late\./);
  assert.match(html, /Covered one extra stop after the regular PM\./);
  assert.match(html, /<th scope="row">Rounded clock in 1<\/th>/);
  assert.match(html, /<th scope="row">Contracted hours 2<\/th>/);
  assert.match(html, /<th scope="row">EX DRIVER 2<\/th>/);
  assert.match(html, /data-row="pair-1-ex-driver" data-day="10"[^>]*>0\.50</);
  assert.match(html, /<h2>Clock notes<\/h2>/);
  assert.doesNotMatch(html, />math</i);
  const contractStyle = (day) => {
    const match = html.match(new RegExp(`data-row="contract" data-day="${day}"[^>]*style="([^"]+)"`));
    return match?.[1] || '';
  };
  assert.equal(contractStyle(1), contractStyle(4));
  assert.notEqual(contractStyle(1), '');
  assert.notEqual(contractStyle(1), contractStyle(8));
  assert.match(contractStyle(1), /background:/);
  assert.match(contractStyle(8), /background:/);
});

test('Donald Duck September 16–30 shows where each overtime hour comes from', () => {
  const state = exampleOfficeState();
  const math = buildMonthlySummaryMath({
    driverName: 'Donald Duck',
    driverId: 'driver-donald-duck',
    rounding: 'snap',
    now: new Date(2026, 8, 30, 12, 0),
    focus: { year: 2026, monthIndex: 8, periodId: '2' },
    officeState: state,
    punches: state.punches,
  });
  const day = (number) => math.periods[0].days.find((item) => item.day === number);
  assert.equal(day(16).pairs.length, 3);
  assert.equal(day(16).pairs.some((pair) => pair.snapOvertimeMinutes), false);
  assert.equal(day(17).pairs[0].actualOvertimeMinutes, 38);
  assert.equal(day(17).pairs[0].snapOvertimeMinutes, 45);
  assert.deepEqual(day(17).pairs[0].overtimeReasons, ['before 5:30 AM']);
  assert.equal(day(18).pairs[2].snapOvertimeMinutes, 75);
  assert.ok(day(18).pairs[2].overtimeReasons.includes('at or after 5:30 PM'));
  assert.ok(day(18).pairs[2].overtimeReasons.includes('over 8 hours in the day'));
  assert.equal(day(19).pairs[0].snapOvertimeMinutes, 270);
  assert.deepEqual(day(19).pairs[0].overtimeReasons, ['Saturday']);
  assert.equal(day(20).pairs[0].snapOvertimeMinutes, 120);
  assert.equal(day(20).pairs[1].snapOvertimeMinutes, 135);
  assert.deepEqual(day(20).pairs[0].overtimeReasons, ['Sunday']);
  assert.equal(day(21).pairs[2].snapOvertimeMinutes, 30);
  assert.deepEqual(day(21).pairs[2].overtimeReasons, ['at or after 5:30 PM']);
  assert.equal(day(22).pairs[2].snapOvertimeMinutes, 45);
  assert.deepEqual(day(22).pairs[2].overtimeReasons, ['over 8 hours in the day']);
  assert.equal(day(24).pairs[0].snapOvertimeMinutes, 30);
  assert.equal(day(24).pairs[2].snapOvertimeMinutes, 30);
  const html = renderMonthlySummaryMathHtml(math);
  assert.match(html, /<th scope="row">Snap overtime minutes 1<\/th>/);
  assert.match(html, /<th scope="row">OT<\/th>/);
  assert.match(html, /data-row="daily-ot" data-day="17"[^>]*>0\.75</);
  assert.match(html, /data-row="daily-ot" data-day="18"[^>]*>1\.25</);
  assert.match(html, /data-row="daily-ot" data-day="19"[^>]*>4\.50</);
  assert.match(html, /data-row="daily-ot" data-day="20"[^>]*>4\.25</);
  assert.match(html, /data-row="daily-ot" data-day="21"[^>]*>0\.50</);
  assert.match(html, /data-row="daily-ot" data-day="22"[^>]*>0\.75</);
  assert.match(html, /data-row="daily-ot" data-day="24"[^>]*>1\.00</);
  assert.match(html, /data-row="daily-ot" data-day="16"[^>]*><\/td>/);
  assert.match(html, /45 snap overtime minutes from 4:45 AM to 8:45 AM/);
  assert.match(html, /the sum of 120 and 135 snap overtime minutes/);
  assert.match(html, /In the yard before 5:30 for a bus check/);
  assert.match(html, /Saturday field trip/);
  assert.match(html, /Sunday charter, morning loop/);
  assert.match(html, /Sunday charter, afternoon loop/);
  assert.match(html, /data-total="overtime"[^>]*>13\.00 × 1\.5 = 19\.50</);
  const lateStyle = (number) => {
    const match = html.match(new RegExp(`data-row="contract" data-day="${number}"[^>]*style="([^"]+)"`));
    return match?.[1] || '';
  };
  const runStyle = (row, number) => {
    const match = html.match(new RegExp(`data-row="${row}" data-day="${number}"[^>]*style="([^"]+)"`));
    return match?.[1] || '';
  };
  assert.equal(lateStyle(16), lateStyle(30));
  assert.notEqual(lateStyle(16), '');
  assert.equal(runStyle('pair-0-contract-hours', 16), runStyle('pair-0-contract-hours', 30));
  assert.notEqual(lateStyle(16), runStyle('pair-0-contract-hours', 16));
});

test('contract hours stay one green when every value is the same', () => {
  const html = renderMonthlySummaryMathHtml(
    buildMonthlySummaryMath({
      driverName: 'Goofy Goof',
      driverId: 'driver-goofy-goof',
      rounding: 'snap',
      now: new Date(2026, 9, 10, 12, 0),
      focus: { year: 2026, monthIndex: 9, periodId: '1' },
      officeState: contractedRoute([['AM', '6:00-9:00']]),
      punches: [
        {
          id: 'in',
          driver_name: 'Goofy Goof',
          action: 'in',
          run: 'AM',
          punched_at: new Date(2026, 9, 8, 6, 0).toISOString(),
          pay_status: 'ex-driver',
        },
        {
          id: 'out',
          driver_name: 'Goofy Goof',
          action: 'out',
          run: 'AM',
          punched_at: new Date(2026, 9, 8, 9, 0).toISOString(),
        },
      ],
    })
  );
  const styles = [...html.matchAll(/data-row="(?:contract|pair-\d+-contract-hours)" data-day="\d+"[^>]*style="([^"]+)"/g)].map(
    (match) => match[1]
  );
  assert.ok(styles.length > 1);
  assert.equal(new Set(styles).size, 1);
  assert.equal(styles[0], 'background:#b7e4c7');
});

test('pay period info shows each holiday in a row above the dates', () => {
  const september = buildMonthlySummaryMath({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    now: new Date(2026, 8, 20, 12, 0),
    focus: { year: 2026, monthIndex: 8, periodId: '1' },
    punches: [],
  });
  const septemberDays = september.periods[0].days;
  assert.equal(septemberDays.find((day) => day.day === 7).holiday, 'Labor Day');
  assert.equal(septemberDays.find((day) => day.day === 8).holiday, '');
  const october = buildMonthlySummaryMath({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    now: new Date(2026, 9, 20, 12, 0),
    focus: { year: 2026, monthIndex: 9, periodId: '1' },
    punches: [],
  });
  assert.equal(october.periods[0].days.find((day) => day.day === 12).holiday, '');
  const html = renderMonthlySummaryMathHtml(september);
  const holidayAt = html.indexOf('<tr class="holidays">');
  const dateAt = html.indexOf('<th scope="col">1</th>');
  assert.ok(holidayAt >= 0 && dateAt > holidayAt);
  const holidayRow = html.slice(holidayAt, html.indexOf('</tr>', holidayAt));
  assert.match(holidayRow, /<th scope="row">Holiday<\/th>/);
  assert.match(holidayRow, /data-day="7" class="is-holiday" title="Labor Day">Labor Day<\/th>/);
  assert.match(holidayRow, /data-day="8"><\/th>/);
});

test('pay period info lists the weekday above each calendar day', () => {
  const september = buildMonthlySummaryMath({
    driverName: 'Goofy Goof',
    driverId: 'driver-goofy-goof',
    now: new Date(2026, 8, 20, 12, 0),
    focus: { year: 2026, monthIndex: 8, periodId: '1' },
    punches: [],
  });
  const days = september.periods[0].days;
  assert.equal(days.find((day) => day.day === 1).weekday, 'TUES');
  assert.equal(days.find((day) => day.day === 3).weekday, 'THR');
  assert.equal(days.find((day) => day.day === 6).weekday, 'SUN');
  assert.equal(days.find((day) => day.day === 7).weekday, 'MON');
  const html = renderMonthlySummaryMathHtml(september);
  const weekdayAt = html.indexOf('<tr class="weekdays">');
  const dateAt = html.indexOf('<th scope="col">1</th>');
  assert.ok(weekdayAt >= 0 && dateAt > weekdayAt);
  const weekdayRow = html.slice(weekdayAt, html.indexOf('</tr>', weekdayAt));
  assert.match(weekdayRow, /<th scope="row">Day of the week<\/th>/);
  assert.match(
    weekdayRow,
    /data-day="1">TUES<\/th>.*data-day="2">WED<\/th>.*data-day="3">THR<\/th>.*data-day="4">FRI<\/th>.*data-day="5">SAT<\/th>.*data-day="6">SUN<\/th>.*data-day="7">MON<\/th>/
  );
});
