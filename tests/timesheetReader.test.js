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
import { DEFAULT_OVERTIME_RULES } from '../office-tracker/src/overtimeRules.js';
import {
  punchesFromCardExtraction,
  splitTotHoursIntoRegOt,
} from '../office-tracker/src/timesheetRegOt.js';
import {
  snapRoundedForRow,
  TIMESHEET_HOURS_MODE_QUARTER,
} from '../office-tracker/src/timesheetSnap.js';
import { computeDeltaMinutes, DEFAULT_CONTRACT_SNAP_BREAKS } from '../src/logic/timeUtils.js';
import {
  allocateHoursToPayStatus,
  clearCardRow,
  coverCropRect,
  hasIllegibleClockStamps,
} from '../office-tracker/web/timesheetReader.js';
import {
  buildMonthlyTimeSummary,
  monthlyTimeSummaryEmbedMarkup,
} from '../office-tracker/src/monthlyTimeSummary.js';
import { normalizeClockPayDefaults } from '../office-tracker/src/driverPay.js';
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
  it('keeps the prompt short and asks for flat Clock Record lines', () => {
    assert.match(EXTRACTION_SYSTEM, /sky-blue/i);
    assert.match(EXTRACTION_SYSTEM, /far-right "Clock Record" column/i);
    assert.match(EXTRACTION_SYSTEM, /Front has exactly 26 lines/i);
    assert.match(EXTRACTION_SYSTEM, /Back has exactly 30 lines/i);
    assert.doesNotMatch(EXTRACTION_SYSTEM, /bold horizontal lines/i);
    assert.match(EXTRACTION_SYSTEM, /Do not write notes, caveats, commentary/i);
    assert.match(EXTRACTION_SYSTEM, /Never guess a month, day, AM\/PM, or time/i);
    assert.match(EXTRACTION_SYSTEM, /"HANDWRITING"/);
    assert.match(EXTRACTION_SYSTEM, /"illegible"/);
    assert.match(EXTRACTION_SYSTEM, /white sticker/i);
    assert.match(extractionUserPrefix('front', 26), /exactly 26/);
    assert.match(extractionUserPrefix('back', 30), /exactly 30/);
    assert.match(extractionUserPrefix('front', 26), /Never guess/i);
    assert.ok(EXTRACTION_SYSTEM.length < 1600);
  });

  it('flags extractions that include illegible clock stamps', () => {
    const clean = normalizeExtractionFromUnknown({
      front: [['SEP 8 AM 6:00', 'SEP 8 AM 8:00']],
      back: [],
    });
    assert.equal(hasIllegibleClockStamps(clean), false);
    const dirty = normalizeExtractionFromUnknown({
      front: [['SEP 8 AM 6:00', 'illegible']],
      back: [],
    });
    assert.equal(hasIllegibleClockStamps(dirty), true);
  });

  it('uses line or slot count to tell front from back', () => {
    assert.equal(sideFromSlotCount(13), 'front');
    assert.equal(sideFromSlotCount(26), 'front');
    assert.equal(sideFromSlotCount(15), 'back');
    assert.equal(sideFromSlotCount(30), 'back');
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

  it('maps HANDWRITING slots from the simple JSON', () => {
    const extraction = normalizeExtractionFromUnknown({
      front: ['HANDWRITING', ['HANDWRITING', 'SEP 8 AM 8:00']],
      back: [],
    });
    assert.equal(extraction.front_rows[0].clock_out_raw, 'HANDWRITING');
    assert.equal(extraction.front_rows[0].clock_in_raw, 'HANDWRITING');
    assert.equal(extraction.front_rows[0].crossed_out, true);
    assert.equal(extraction.front_rows[1].clock_out_raw, 'HANDWRITING');
    assert.equal(extraction.front_rows[1].clock_in_raw, 'SEP 8 AM 8:00');
    assert.equal(extraction.front_rows[1].crossed_out, true);
  });

  it('splits a stamp into month, day, period, and time for editing', () => {
    assert.deepEqual(parseStampParts('OCT 7 AM 8:50'), {
      month: 'oct',
      day: '7',
      period: 'AM',
      time: '8:50',
      illegible: false,
      handwriting: false,
    });
    assert.equal(formatStampParts({ month: 'oct', day: '7', period: 'AM', time: '8:50' }), 'OCT 7 AM 8:50');
    assert.equal(parseStampParts('illegible').illegible, true);
    assert.equal(parseStampParts('HANDWRITING').handwriting, true);
    assert.equal(formatStampParts({ illegible: true }), 'illegible');
    assert.equal(formatStampParts({ handwriting: true }), 'HANDWRITING');
  });

  it('snaps clock stamps with contract bands and totals hours from Out to In', () => {
    const snapped = snapRoundedForRow(
      {
        // Out = leave (start), In = return (end).
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

  it('quarter-hour mode keeps written clocks and rounds only the duration', () => {
    const quartered = snapRoundedForRow(
      {
        clock_out_raw: 'OCT 7 AM 8:50',
        clock_in_raw: 'OCT 7 AM 10:07',
      },
      DEFAULT_CONTRACT_SNAP_BREAKS,
      2026,
      TIMESHEET_HOURS_MODE_QUARTER
    );
    // Exact span is 1h 17m → 77 minutes → nearest quarter hour is 1.25.
    assert.equal(quartered.outLabel, '8:50 AM');
    assert.equal(quartered.inLabel, '10:07 AM');
    assert.equal(quartered.totalHours, 1.25);
  });

  it('totals afternoon, reversed, and overnight Out/In rows without a 24-hour false wrap', () => {
    const afternoon = snapRoundedForRow(
      {
        clock_out_raw: 'NOV 4 PM 2:00',
        clock_in_raw: 'NOV 4 PM 5:15',
      },
      DEFAULT_CONTRACT_SNAP_BREAKS,
      2026
    );
    assert.equal(afternoon.outLabel, '2:00 PM');
    assert.equal(afternoon.inLabel, '5:15 PM');
    assert.equal(afternoon.totalHours, 3.25);

    // Same times swapped on the card: still 3.25, not 20.75.
    const reversed = snapRoundedForRow(
      {
        clock_out_raw: 'NOV 4 PM 5:15',
        clock_in_raw: 'NOV 4 PM 2:00',
      },
      DEFAULT_CONTRACT_SNAP_BREAKS,
      2026
    );
    assert.equal(reversed.totalHours, 3.25);

    // AM In with PM Out (crossed meridiem, reversed on the card): ~4.5, not 19.5.
    const crossedMeridiem = snapRoundedForRow(
      {
        clock_out_raw: 'NOV 4 PM 4:18',
        clock_in_raw: 'NOV 4 AM 11:55',
      },
      DEFAULT_CONTRACT_SNAP_BREAKS,
      2026,
      TIMESHEET_HOURS_MODE_QUARTER
    );
    assert.equal(crossedMeridiem.outLabel, '4:18 PM');
    assert.equal(crossedMeridiem.inLabel, '11:55 AM');
    assert.equal(crossedMeridiem.totalHours, 4.5);

    // Same printed day with AM In after a PM Out is reversed stamps, not overnight.
    const sameDayCrossed = snapRoundedForRow(
      {
        clock_out_raw: 'NOV 4 PM 11:15',
        clock_in_raw: 'NOV 4 AM 8:45',
      },
      DEFAULT_CONTRACT_SNAP_BREAKS,
      2026
    );
    assert.equal(sameDayCrossed.totalHours, 14.5);

    // Overnight only when the In stamp's date is the next day.
    const overnight = snapRoundedForRow(
      {
        clock_out_raw: 'NOV 4 PM 11:15',
        clock_in_raw: 'NOV 5 AM 8:45',
      },
      DEFAULT_CONTRACT_SNAP_BREAKS,
      2026
    );
    assert.equal(overnight.outLabel, '11:15 PM');
    assert.equal(overnight.inLabel, '8:45 AM');
    assert.equal(overnight.totalHours, 9.5);

    const datedOvernight = snapRoundedForRow(
      {
        clock_out_raw: 'NOV 4 PM 10:00',
        clock_in_raw: 'NOV 5 AM 6:00',
      },
      DEFAULT_CONTRACT_SNAP_BREAKS,
      2026
    );
    assert.equal(datedOvernight.totalHours, 8);
  });

  it('leaves Tot. Hrs. blank for handwriting or illegible stamps', () => {
    const handwriting = snapRoundedForRow(
      { clock_out_raw: 'HANDWRITING', clock_in_raw: 'HANDWRITING' },
      DEFAULT_CONTRACT_SNAP_BREAKS,
      2026
    );
    assert.equal(handwriting.outLabel, 'HANDWRITING');
    assert.equal(handwriting.inLabel, 'HANDWRITING');
    assert.equal(handwriting.totalHours, null);
    assert.equal(handwriting.outHandwriting, true);

    const mixed = snapRoundedForRow(
      { clock_out_raw: 'illegible', clock_in_raw: 'OCT 7 AM 10:07' },
      DEFAULT_CONTRACT_SNAP_BREAKS,
      2026
    );
    assert.equal(mixed.outLabel, 'illegible');
    assert.equal(mixed.totalHours, null);
  });
});

describe('timesheet Reg / OT split', () => {
  const rules = { ...DEFAULT_OVERTIME_RULES };

  it('keeps same-day rows under eight hours as all Reg', () => {
    const rows = [
      {
        row_index: 1,
        clock_out_raw: 'NOV 4 AM 6:00',
        clock_in_raw: 'NOV 4 AM 8:00',
      },
      {
        row_index: 2,
        clock_out_raw: 'NOV 4 PM 2:00',
        clock_in_raw: 'NOV 4 PM 4:00',
      },
    ];
    splitTotHoursIntoRegOt([rows], { breaks: DEFAULT_CONTRACT_SNAP_BREAKS, rules, defaultYear: 2026 });
    assert.equal(rows[0].hours_regular, 2);
    assert.equal(rows[0].hours_overtime, 0);
    assert.equal(rows[1].hours_regular, 2);
    assert.equal(rows[1].hours_overtime, 0);
  });

  it('puts the daily remainder over eight onto the later row', () => {
    const rows = [
      {
        row_index: 1,
        clock_out_raw: 'NOV 4 AM 6:00',
        clock_in_raw: 'NOV 4 PM 12:00',
      },
      {
        row_index: 2,
        clock_out_raw: 'NOV 4 PM 1:00',
        clock_in_raw: 'NOV 4 PM 4:00',
      },
    ];
    splitTotHoursIntoRegOt([rows], { breaks: DEFAULT_CONTRACT_SNAP_BREAKS, rules, defaultYear: 2026 });
    assert.equal(rows[0].hours_regular, 6);
    assert.equal(rows[0].hours_overtime, 0);
    assert.equal(rows[1].hours_regular, 2);
    assert.equal(rows[1].hours_overtime, 1);
  });

  it('counts minutes after the evening start as OT', () => {
    const rows = [
      {
        row_index: 1,
        clock_out_raw: 'NOV 4 PM 4:00',
        clock_in_raw: 'NOV 4 PM 6:00',
      },
    ];
    splitTotHoursIntoRegOt([rows], { breaks: DEFAULT_CONTRACT_SNAP_BREAKS, rules, defaultYear: 2026 });
    assert.equal(rows[0].hours_regular, 1.5);
    assert.equal(rows[0].hours_overtime, 0.5);
  });

  it('treats a weekend stamp day as all OT', () => {
    const rows = [
      {
        row_index: 1,
        clock_out_raw: 'NOV 7 AM 8:00',
        clock_in_raw: 'NOV 7 AM 11:00',
      },
    ];
    splitTotHoursIntoRegOt([rows], { breaks: DEFAULT_CONTRACT_SNAP_BREAKS, rules, defaultYear: 2026 });
    assert.equal(rows[0].hours_regular, 0);
    assert.equal(rows[0].hours_overtime, 3);
  });

  it('clears Reg and OT when Tot. Hrs. is at or under the contract', () => {
    const rows = [
      {
        row_index: 1,
        clock_out_raw: 'NOV 4 AM 6:00',
        clock_in_raw: 'NOV 4 AM 8:00',
      },
      {
        row_index: 2,
        clock_out_raw: 'NOV 4 PM 2:00',
        clock_in_raw: 'NOV 4 PM 4:00',
      },
    ];
    splitTotHoursIntoRegOt([rows], {
      breaks: DEFAULT_CONTRACT_SNAP_BREAKS,
      rules,
      defaultYear: 2026,
      contractedByDay: new Map([['2026-11-04', '6.00']]),
    });
    const sum = rows.reduce((total, row) => total + (row.hours_regular || 0) + (row.hours_overtime || 0), 0);
    assert.equal(sum, 0);
    assert.equal(rows[0].hours_regular, null);
    assert.equal(rows[1].hours_regular, null);
    assert.equal(rows[0].hours_overtime, null);
    assert.equal(rows[1].hours_overtime, null);
  });

  it('keeps only hours past the contract, with the overtime split of that residual', () => {
    const rows = [
      {
        row_index: 1,
        clock_out_raw: 'NOV 4 PM 4:00',
        clock_in_raw: 'NOV 4 PM 6:00',
      },
    ];
    // 2h Tot vs 0.50 contract → 1.50 residual; OT rules on the 2h span were 1.5 reg / 0.5 ot.
    splitTotHoursIntoRegOt([rows], {
      breaks: DEFAULT_CONTRACT_SNAP_BREAKS,
      rules,
      defaultYear: 2026,
      contractedByDay: new Map([['2026-11-04', '0.50']]),
    });
    assert.equal(rows[0].hours_regular, 1.25);
    assert.equal(rows[0].hours_overtime, 0.25);
    assert.equal(rows[0].hours_regular + rows[0].hours_overtime, 1.5);
  });

  it('puts a two-run day residual on the first clocked row only', () => {
    const rows = [
      {
        row_index: 1,
        clock_out_raw: 'NOV 4 AM 6:00',
        clock_in_raw: 'NOV 4 AM 9:00',
      },
      {
        row_index: 2,
        clock_out_raw: 'NOV 4 PM 1:00',
        clock_in_raw: 'NOV 4 PM 5:00',
      },
    ];
    // 3h + 4h = 7 Tot vs 5.25 contract → 1.75 residual on the first row.
    splitTotHoursIntoRegOt([rows], {
      breaks: DEFAULT_CONTRACT_SNAP_BREAKS,
      rules,
      defaultYear: 2026,
      contractedByDay: new Map([['2026-11-04', '5.25']]),
    });
    assert.equal((rows[0].hours_regular || 0) + (rows[0].hours_overtime || 0), 1.75);
    assert.equal(rows[1].hours_regular, null);
    assert.equal(rows[1].hours_overtime, null);
  });

  it('clears Reg and OT when Tot. Hrs. is blank', () => {
    const rows = [
      {
        row_index: 1,
        clock_out_raw: 'illegible',
        clock_in_raw: 'illegible',
        hours_regular: 2,
        hours_overtime: 1,
      },
    ];
    splitTotHoursIntoRegOt([rows], { breaks: DEFAULT_CONTRACT_SNAP_BREAKS, rules, defaultYear: 2026 });
    assert.equal(rows[0].hours_regular, null);
    assert.equal(rows[0].hours_overtime, null);
  });

  it('builds Monthly Time Summary punches from card stamps with pay status', () => {
    const extraction = {
      header: { employee_name: 'Alex Driver' },
      front_rows: [
        {
          row_index: 1,
          clock_out_raw: 'NOV 4 AM 6:00',
          clock_in_raw: 'NOV 4 AM 8:00',
          pay_status: 'reg-driver',
        },
      ],
      back_rows: [],
    };
    const punches = punchesFromCardExtraction(
      extraction,
      DEFAULT_CONTRACT_SNAP_BREAKS,
      2026,
      'Alex Driver',
      null,
      'ex-driver'
    );
    assert.equal(punches.length, 2);
    assert.equal(punches[0].action, 'in');
    assert.equal(punches[0].pay_status, 'reg-driver');
    assert.equal(punches[1].action, 'out');
    const summary = buildMonthlyTimeSummary({
      driverName: 'Alex Driver',
      driverId: 'alex',
      defaults: normalizeClockPayDefaults(null),
      punches,
      officeState: {},
      overtimeRules: rules,
      now: new Date(2026, 10, 4),
    });
    assert.ok(summary.periods.length >= 1);
    const html = monthlyTimeSummaryEmbedMarkup(summary);
    assert.match(html, /MONTHLY TIME SUMMARY/);
    assert.match(html, /\d+\.(00|25|50|75)/);
  });

  it('drops a cleared card line from Monthly Time Summary punches', () => {
    const extraction = {
      header: { employee_name: 'Alex Driver', default_pay_status: 'ex-driver' },
      front_rows: [
        {
          row_index: 1,
          clock_out_raw: 'NOV 4 AM 6:00',
          clock_in_raw: 'NOV 4 AM 8:00',
          pay_status: 'reg-driver',
        },
        {
          row_index: 2,
          clock_out_raw: 'NOV 4 PM 2:00',
          clock_in_raw: 'NOV 4 PM 4:00',
          pay_status: 'ot-trainer',
        },
      ],
      back_rows: [],
    };
    clearCardRow(extraction.front_rows[0]);
    assert.equal(extraction.front_rows[0].clock_out_raw, null);
    assert.equal(extraction.front_rows[0].pay_status, null);
    const punches = punchesFromCardExtraction(
      extraction,
      DEFAULT_CONTRACT_SNAP_BREAKS,
      2026,
      'Alex Driver',
      null,
      'ex-driver'
    );
    assert.equal(punches.length, 2);
    assert.equal(punches[0].pay_status, 'ot-trainer');
  });

  it('keeps punch-based REG on the Monthly Summary and puts past-contract hours on EX DRIVER', () => {
    const officeState = {
      profiles: {
        route12: {
          name: '12',
          driver_name: 'Alex Driver',
          start_date: '2026-09-01',
          changeLog: [
            ['AM', '6:00-8:00'],
            ['PM', '14:00-16:00'],
          ].map(([segment, range], index) => ({
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
    const summary = buildMonthlyTimeSummary({
      driverName: 'Alex Driver',
      driverId: 'alex',
      defaults: normalizeClockPayDefaults(null),
      punches: [
        {
          id: 'in',
          driver_name: 'Alex Driver',
          action: 'in',
          punched_at: new Date(2026, 10, 4, 6, 0).toISOString(),
          pay_status: 'reg-driver',
        },
        {
          id: 'out',
          driver_name: 'Alex Driver',
          action: 'out',
          punched_at: new Date(2026, 10, 4, 9, 0).toISOString(),
        },
      ],
      officeState,
      overtimeRules: rules,
      now: new Date(2026, 10, 4),
      regOtFromContractGap: true,
      totHoursByDay: new Map([['2026-11-04', 3]]),
    });
    const november = summary.periods.find((period) => period.key === '2026-11-1');
    const day = (id) => november.lines.find((line) => line.id === id).cells.find((cell) => cell.day === 4);
    assert.equal(november.contractedHours[november.days.indexOf(4)], '4.00');
    // Punch-based REG stays; no shortfall fill to contract − Tot.
    assert.equal(day('reg-driver').value, '3.00');
    assert.equal(day('ex-driver').value, '');

    const over = buildMonthlyTimeSummary({
      driverName: 'Alex Driver',
      driverId: 'alex',
      defaults: normalizeClockPayDefaults(null),
      punches: [
        {
          id: 'in',
          driver_name: 'Alex Driver',
          action: 'in',
          punched_at: new Date(2026, 10, 4, 6, 0).toISOString(),
          pay_status: 'reg-driver',
        },
        {
          id: 'out',
          driver_name: 'Alex Driver',
          action: 'out',
          punched_at: new Date(2026, 10, 4, 9, 0).toISOString(),
        },
      ],
      officeState: {
        profiles: {
          route12: {
            ...officeState.profiles.route12,
            changeLog: officeState.profiles.route12.changeLog.filter((event) => event.segment === 'AM'),
          },
        },
      },
      overtimeRules: rules,
      now: new Date(2026, 10, 4),
      regOtFromContractGap: true,
      totHoursByDay: new Map([['2026-11-04', 3]]),
    });
    const overNovember = over.periods.find((period) => period.key === '2026-11-1');
    const overDay = (id) => overNovember.lines.find((line) => line.id === id).cells.find((cell) => cell.day === 4);
    assert.equal(overNovember.contractedHours[overNovember.days.indexOf(4)], '2.00');
    assert.equal(overDay('reg-driver').value, '3.00');
    assert.equal(overDay('ex-driver').value, '1.00');
  });
});

describe('timecard pay-status hour slices', () => {
  it('allocates hours from the start of a clock period to a pay status', () => {
    const start = new Date(2026, 10, 4, 6, 0, 0);
    const end = new Date(2026, 10, 4, 10, 0, 0);
    const first = allocateHoursToPayStatus({
      periodStart: start,
      periodEnd: end,
      hours: 1.5,
      payStatus: 'ot-trainer',
      allowed: ['reg-driver', 'ot-trainer', 'ex-driver'],
    });
    assert.equal(first.error, '');
    assert.equal(first.portions.length, 1);
    assert.equal(first.portions[0].pay_status, 'ot-trainer');
    assert.equal(new Date(first.portions[0].start).getTime(), start.getTime());
    assert.equal(new Date(first.portions[0].end).getTime(), new Date(2026, 10, 4, 7, 30, 0).getTime());

    const second = allocateHoursToPayStatus({
      periodStart: start,
      periodEnd: end,
      hours: 0.5,
      payStatus: 'ex-driver',
      existingPortions: first.portions,
      allowed: ['reg-driver', 'ot-trainer', 'ex-driver'],
    });
    assert.equal(second.error, '');
    assert.equal(second.portions.length, 2);
    assert.equal(second.portions[1].pay_status, 'ex-driver');
    assert.equal(new Date(second.portions[1].start).getTime(), new Date(2026, 10, 4, 7, 30, 0).getTime());
  });

  it('rejects a slice that is larger than the remaining hours', () => {
    const start = new Date(2026, 10, 4, 6, 0, 0);
    const end = new Date(2026, 10, 4, 7, 0, 0);
    const result = allocateHoursToPayStatus({
      periodStart: start,
      periodEnd: end,
      hours: 2,
      payStatus: 'ot-trainer',
      allowed: ['ot-trainer'],
    });
    assert.match(result.error, /Only 1 hour/);
    assert.equal(result.portions.length, 0);
  });
});
