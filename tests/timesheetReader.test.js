import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stateFromRoutesCsv } from '../office-tracker/src/routesCsv.js';
import { payrollDriverRows } from '../office-tracker/src/payrollTimes.js';
import {
  compareCardToContract,
  contractDailyHours,
  dashboardSchoolCalendar,
  matchPayrollRow,
  payrollRowKey,
} from '../office-tracker/src/timesheetMath.js';
import { normalizeExtractionFromUnknown } from '../office-tracker/src/timesheetNormalize.js';

const csv = [
  'Route,Driver,Kind,Date,Run,Clock in,Clock out,Note',
  '104,Alex Driver,start,2026-09-08,AM,6:00,8:00,',
  '104,Alex Driver,start,2026-09-08,Midday,11:00,12:00,',
  '104,Alex Driver,start,2026-09-08,PM,14:00,16:15,',
  '12,Riley Cho,start,2026-09-08,AM,7:00,9:00,',
].join('\n');

function card() {
  return normalizeExtractionFromUnknown({
    header: { employee_name: 'Driver, Alex', route_number: '104', date_on_card: '9/15/26' },
    front_rows: [
      {
        row_index: 1,
        clock_out: { date: 'SEP 8', period: 'AM', time: '6:00' },
        clock_in: { date: 'SEP 8', period: 'AM', time: '8:00' },
        total_hours: 2,
      },
      {
        row_index: 2,
        clock_out_iso: '2026-09-08T11:00:00',
        clock_in_iso: '2026-09-08T12:00:00',
        total_hours: 1,
      },
      {
        row_index: 3,
        clock_out_iso: '2026-09-08T14:00:00',
        clock_in_iso: '2026-09-08T16:15:00',
        total_hours: 2.25,
      },
      {
        row_index: 4,
        clock_out_iso: '2026-09-08T18:00:00',
        clock_in_iso: '2026-09-08T19:00:00',
        total_hours: 9,
        crossed_out: true,
      },
    ],
    back_rows: [],
    caveats: [],
  });
}

describe('timesheet reader contract comparison', () => {
  it('reads current contracted hours from dashboard route state', () => {
    const state = stateFromRoutesCsv(csv);
    const before = JSON.stringify(state);
    const rows = payrollDriverRows(state, { asOf: '2026-09-16' });
    const match = matchPayrollRow(rows, { employee_name: 'Driver, Alex', route_number: '104' });
    assert.equal(match.route, '104');
    assert.equal(contractDailyHours(match), 5.25);
    assert.equal(JSON.stringify(state), before);
    assert.equal(payrollRowKey(match).includes('104'), true);
  });

  it('compares card clock hours with those contracted hours', () => {
    const state = stateFromRoutesCsv(csv);
    const rows = payrollDriverRows(state, { asOf: '2026-09-16' });
    const match = matchPayrollRow(rows, card().header);
    const comparison = compareCardToContract(
      card(),
      contractDailyHours(match),
      dashboardSchoolCalendar()
    );
    const september8 = comparison.days.find((day) => day.date === '2026-09-08');
    const september6 = comparison.days.find((day) => day.date === '2026-09-06');
    const september9 = comparison.days.find((day) => day.date === '2026-09-09');
    assert.equal(september8.clockHours, 5.25);
    assert.equal(september8.contractHours, 5.25);
    assert.equal(september8.difference, 0);
    assert.equal(september6.contractHours, 0);
    assert.equal(september9.clockHours, 0);
    assert.equal(september9.contractHours, 5.25);
    assert.equal(comparison.label, 'September 1–15, 2026');
  });

  it('turns a clock stamp object into the same wall time the reader uses', () => {
    const extraction = normalizeExtractionFromUnknown({
      header: { employee_name: 'Cho, Riley', route_number: '12', date_on_card: '9/15/26' },
      front_rows: [
        { clock_out: { date: 'SEP 9', period: 'AM', time: '7:05' }, clock_in: { date: 'SEP 9', period: 'AM', time: '9:00' } },
      ],
    });
    assert.equal(extraction.front_rows[0].clock_out_iso, '2026-09-09T07:05:00');
    assert.equal(extraction.front_rows[0].clock_in_raw, 'SEP 9 AM 9:00');
    assert.equal(extraction.front_rows.length, 13);
    assert.equal(extraction.back_rows.length, 15);
  });
});
