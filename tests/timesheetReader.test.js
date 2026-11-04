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
import {
  formatStampParts,
  normalizeExtractionFromUnknown,
  parseStampParts,
  sideFromSlotCount,
} from '../office-tracker/src/timesheetNormalize.js';
import { snapRoundedForRow } from '../office-tracker/src/timesheetSnap.js';
import { DEFAULT_CONTRACT_SNAP_BREAKS } from '../src/logic/timeUtils.js';
import { coverCropRect } from '../office-tracker/web/timesheetReader.js';
import {
  BACK_SLOT_COUNT,
  EXTRACTION_SYSTEM,
  FRONT_SLOT_COUNT,
  extractionUserPrefix,
} from '../office-tracker/src/timesheetPrompt.js';

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

describe('timecard camera card crop', () => {
  it('crops the sides of a wide camera feed to a tall 5 by 8 card', () => {
    const crop = coverCropRect(1920, 1080, 5, 8);
    assert.equal(crop.sy, 0);
    assert.equal(crop.sh, 1080);
    assert.ok(Math.abs(crop.sw / crop.sh - 5 / 8) < 0.0001);
    assert.ok(Math.abs(crop.sx - (1920 - crop.sw) / 2) < 0.0001);
  });

  it('crops the top and bottom of a taller feed to the same card frame', () => {
    const crop = coverCropRect(900, 1600, 5, 8);
    assert.equal(crop.sx, 0);
    assert.equal(crop.sw, 900);
    assert.ok(Math.abs(crop.sw / crop.sh - 5 / 8) < 0.0001);
    assert.ok(Math.abs(crop.sy - (1600 - crop.sh) / 2) < 0.0001);
  });
});

describe('timecard clock-record extraction', () => {
  it('keeps the prompt short and asks for bold-line slots', () => {
    assert.match(EXTRACTION_SYSTEM, /far-right "Clock Record" column/i);
    assert.match(EXTRACTION_SYSTEM, /between bold horizontal lines/i);
    assert.match(EXTRACTION_SYSTEM, new RegExp(`front has ${FRONT_SLOT_COUNT}`));
    assert.match(EXTRACTION_SYSTEM, new RegExp(`back has ${BACK_SLOT_COUNT}`));
    assert.match(EXTRACTION_SYSTEM, /Do not write notes, caveats, commentary/i);
    assert.match(extractionUserPrefix('front', FRONT_SLOT_COUNT), /exactly 13/);
    assert.match(extractionUserPrefix('back', BACK_SLOT_COUNT), /exactly 15/);
    assert.ok(EXTRACTION_SYSTEM.length < 900);
  });

  it('uses slot count to tell front from back', () => {
    assert.equal(sideFromSlotCount(13), 'front');
    assert.equal(sideFromSlotCount(15), 'back');
    assert.equal(sideFromSlotCount(14), null);
  });

  it('maps stamps, null empties, and illegible slots from the simple JSON', () => {
    const extraction = normalizeExtractionFromUnknown({
      front: [['SEP 8 AM 6:00', 'SEP 8 AM 8:00'], null, 'illegible'],
      back: [],
    });
    assert.equal(extraction.header, null);
    assert.deepEqual(extraction.caveats, []);
    assert.equal(extraction.front_rows[0].clock_out_raw, 'SEP 8 AM 6:00');
    assert.equal(extraction.front_rows[0].clock_in_raw, 'SEP 8 AM 8:00');
    assert.equal(extraction.front_rows[0].description_of_work, null);
    assert.equal(extraction.front_rows[1].clock_out_raw, null);
    assert.equal(extraction.front_rows[1].clock_in_raw, null);
    assert.equal(extraction.front_rows[1].crossed_out, false);
    assert.equal(extraction.front_rows[2].clock_out_raw, 'illegible');
    assert.equal(extraction.front_rows[2].clock_in_raw, 'illegible');
    assert.equal(extraction.front_rows[2].crossed_out, true);
    assert.equal(extraction.front_rows.length, FRONT_SLOT_COUNT);
    assert.equal(extraction.back_rows.length, BACK_SLOT_COUNT);
  });

  it('splits a stamp into month, day, period, and time for editing', () => {
    assert.deepEqual(parseStampParts('OCT 7 AM 8:50'), {
      month: 'oct',
      day: '7',
      period: 'AM',
      time: '8:50',
      illegible: false,
    });
    assert.equal(formatStampParts({ month: 'oct', day: '7', period: 'AM', time: '8:50' }), 'OCT 7 AM 8:50');
    assert.equal(parseStampParts('illegible').illegible, true);
    assert.equal(formatStampParts({ illegible: true }), 'illegible');
  });

  it('snaps clock stamps with contract bands and totals hours from snapped clocks', () => {
    const snapped = snapRoundedForRow(
      {
        clock_out_raw: 'OCT 7 AM 8:50',
        clock_in_raw: 'OCT 7 AM 10:07',
      },
      DEFAULT_CONTRACT_SNAP_BREAKS,
      2026
    );
    // Default bands: :50 → :45, :07 → :15
    assert.equal(snapped.outLabel, '8:45 AM');
    assert.equal(snapped.inLabel, '10:15 AM');
    assert.equal(snapped.totalHours, 1.5);
  });
});
