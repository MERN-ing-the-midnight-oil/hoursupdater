import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildBps2026_2027Calendar } from '../employee-tracker/src/bpsCalendar2026.js';
import { rebuildEmployeeRouteState } from '../employee-tracker/src/snapshot.js';
import { stateFromRoutesCsv } from '../office-tracker/src/routesCsv.js';
import {
  PAYROLL_HEADERS,
  PAYROLL_RUN_COLORS,
  PAYROLL_SHEET,
  buildPayrollWorkbook,
  changedPayrollKeys,
  changedPayrollLabels,
  contractStartedOn,
  payrollBaselineRows,
  formatQuarterHours,
  payrollDriverRows,
  payrollRowsForDriver,
  quarterHoursFromMinutes,
  rowsFromPayrollWorkbook,
  splitDriverName,
  sumRoundedQuarterHours,
} from '../office-tracker/src/payrollTimes.js';
import {
  beginSessionRouteTracking,
  saveDriver,
  saveProfile,
  sessionModifiedRouteNames,
} from '../office-tracker/web/store.js';

const calendar = buildBps2026_2027Calendar().calendar;

const csv = [
  'Route,Driver,Kind,Date,Run,Clock in,Clock out,Note',
  '104,Alex Driver,start,2026-09-08,AM,6:00,8:00,',
  '104,Alex Driver,start,2026-09-08,Midday,11:00,12:00,',
  '104,Alex Driver,start,2026-09-08,PM,14:00,16:15,',
  '104,Alex Driver,change,2026-09-14,AM,6:00,8:10,Still inside the review window',
  '12,Alex Driver,start,2026-09-08,AM,7:00,9:00,',
  '209,Riley Cho,start,2026-09-08,AM,6:00,8:00,',
  '209,Riley Cho,start,2026-09-08,Midday,11:00,12:00,',
  '209,Riley Cho,start,2026-09-08,PM,14:00,16:15,',
  '209,Riley Cho,change,2026-09-09,AM,6:00,8:10,Ten minutes, then the window closed',
].join('\n');

function sampleState() {
  const state = stateFromRoutesCsv(csv);
  state.drivers = [
    { id: 'driver-alex', name: 'Alex Driver', phone: '', email: 'alex.driver@example.com' },
    { id: 'driver-riley', name: 'Riley Cho', phone: '', email: 'riley.cho@example.com' },
    { id: 'driver-sam', name: 'Sam NoRoute', phone: '', email: 'sam.noroute@example.com' },
    { id: 'driver-madonna', name: 'Madonna', phone: '', email: 'madonna@example.com' },
  ];
  return state;
}

describe('payroll driver times', () => {
  it('writes rounded time as quarter hours ending in .0, .25, .5, or .75', () => {
    assert.equal(formatQuarterHours(quarterHoursFromMinutes(120)), '2.0');
    assert.equal(formatQuarterHours(quarterHoursFromMinutes(135)), '2.25');
    assert.equal(formatQuarterHours(quarterHoursFromMinutes(150)), '2.5');
    assert.equal(formatQuarterHours(quarterHoursFromMinutes(165)), '2.75');
    assert.equal(formatQuarterHours(quarterHoursFromMinutes(127)), '2.0');
    assert.equal(formatQuarterHours(4), '4.0');
    assert.equal(formatQuarterHours(4.25), '4.25');
    assert.equal(formatQuarterHours(4.5), '4.5');
    assert.equal(formatQuarterHours(4.75), '4.75');
  });

  it('splits a driver name into first and last', () => {
    assert.deepEqual(splitDriverName('Alex Driver'), {
      firstName: 'Alex',
      lastName: 'Driver',
    });
    assert.deepEqual(splitDriverName('Mary Ann Smith'), {
      firstName: 'Mary',
      lastName: 'Ann Smith',
    });
    assert.deepEqual(splitDriverName('Madonna'), { firstName: 'Madonna', lastName: '' });
  });

  it('keeps one row per driver, and one row per route when a driver holds more than one', () => {
    const rows = payrollDriverRows(sampleState(), { asOf: '2026-09-16', calendar });
    assert.deepEqual(
      rows.map((row) => [row.lastName, row.firstName, row.route, row.email]),
      [
        ['', 'Madonna', '', 'madonna@example.com'],
        ['Cho', 'Riley', '209', 'riley.cho@example.com'],
        ['Driver', 'Alex', '12', 'alex.driver@example.com'],
        ['Driver', 'Alex', '104', 'alex.driver@example.com'],
        ['NoRoute', 'Sam', '', 'sam.noroute@example.com'],
      ]
    );
  });

  it('rounds each run to the nearest quarter hour and sums those for the day', () => {
    const state = sampleState();
    const asOf = '2026-09-16';
    const route104 = Object.values(state.profiles).find((profile) => profile.name === '104');
    const open = rebuildEmployeeRouteState(route104.changeLog, calendar, asOf);
    assert.equal(open.status, 'ACCUMULATING');

    const rows = payrollDriverRows(state, { asOf, calendar });
    const alex104 = rows.find((row) => row.route === '104');
    assert.equal(alex104.amIn, '6:00');
    assert.equal(alex104.amOut, '8:00');
    assert.equal(alex104.middayIn, '11:00');
    assert.equal(alex104.middayOut, '12:00');
    assert.equal(alex104.pmIn, '14:00');
    assert.equal(alex104.pmOut, '16:15');
    assert.equal(alex104.amTotalMinutes, 120);
    assert.equal(alex104.amRoundedQuarterHours, 2);
    assert.equal(formatQuarterHours(alex104.amRoundedQuarterHours), '2.0');
    assert.equal(alex104.middayTotalMinutes, 60);
    assert.equal(alex104.middayRoundedQuarterHours, 1);
    assert.equal(formatQuarterHours(alex104.middayRoundedQuarterHours), '1.0');
    assert.equal(alex104.pmTotalMinutes, 135);
    assert.equal(alex104.pmRoundedQuarterHours, 2.25);
    assert.equal(formatQuarterHours(alex104.pmRoundedQuarterHours), '2.25');
    assert.equal(alex104.fullDayRoundedQuarterHours, 5.25);
    assert.equal(formatQuarterHours(alex104.fullDayRoundedQuarterHours), '5.25');
    assert.equal(alex104.contractStarted, '2026-09-08');

    const punched = sampleState();
    punched.punches = [
      {
        id: 'in',
        driver_name: 'Alex Driver',
        action: 'in',
        punched_at: new Date(2026, 8, 16, 5, 50).toISOString(),
        note: '',
      },
      {
        id: 'out',
        driver_name: 'Alex Driver',
        action: 'out',
        punched_at: new Date(2026, 8, 16, 8, 10).toISOString(),
        note: '',
      },
    ];
    const fromClock = payrollDriverRows(punched, { asOf, calendar }).find((row) => row.route === '104');
    assert.equal(fromClock.amIn, '5:50');
    assert.equal(fromClock.amOut, '8:10');
    assert.equal(fromClock.middayIn, '');
    assert.equal(fromClock.pmIn, '');
    assert.equal(fromClock.amQuarterClocks, '5:45 AM–8:15 AM');
    assert.equal(fromClock.amTotalMinutes, 150);
    const riley = payrollDriverRows(punched, { asOf, calendar }).find((row) => row.route === '209');
    assert.equal(riley.amIn, '6:00');

    const alex12 = rows.find((row) => row.route === '12');
    assert.equal(alex12.amTotalMinutes, 120);
    assert.equal(alex12.amRoundedQuarterHours, 2);
    assert.equal(alex12.middayTotalMinutes, null);
    assert.equal(alex12.middayRoundedQuarterHours, null);
    assert.equal(alex12.pmTotalMinutes, null);
    assert.equal(alex12.fullDayRoundedQuarterHours, 2);
    assert.equal(formatQuarterHours(alex12.fullDayRoundedQuarterHours), '2.0');

    const sam = rows.find((row) => row.email === 'sam.noroute@example.com');
    assert.equal(sam.route, '');
    assert.equal(sam.amIn, '');
    assert.equal(sam.amTotalMinutes, null);
    assert.equal(sam.fullDayRoundedQuarterHours, null);
    assert.equal(sam.contractStarted, '');
    assert.equal(
      alex104.fullDayRoundedQuarterHours,
      sumRoundedQuarterHours([
        alex104.amRoundedQuarterHours,
        alex104.middayRoundedQuarterHours,
        alex104.pmRoundedQuarterHours,
      ])
    );
  });

  it('sums the three rounded runs instead of rounding the exact daily total', () => {
    const csv = [
      'Route,Driver,Kind,Date,Run,Clock in,Clock out,Note',
      '88,Pat Example,start,2026-09-08,AM,6:00,8:07,',
      '88,Pat Example,start,2026-09-08,Midday,11:00,12:07,',
      '88,Pat Example,start,2026-09-08,PM,14:00,16:07,',
    ].join('\n');
    const row = payrollDriverRows(stateFromRoutesCsv(csv), {
      asOf: '2026-09-16',
      calendar,
      roundClocks: false,
    }).find((item) => item.route === '88');
    assert.equal(row.amQuarterClocks, '6:00 AM–8:07 AM');
    assert.equal(row.amTotalMinutes, 127);
    assert.equal(row.amRoundedQuarterHours, 2);
    assert.equal(row.middayTotalMinutes, 67);
    assert.equal(row.middayRoundedQuarterHours, 1);
    assert.equal(row.pmTotalMinutes, 127);
    assert.equal(row.pmRoundedQuarterHours, 2);
    assert.equal(row.fullDayRoundedQuarterHours, 5);
    assert.equal(formatQuarterHours(row.fullDayRoundedQuarterHours), '5.0');
    assert.equal(
      row.fullDayRoundedQuarterHours,
      sumRoundedQuarterHours([2, 1, 2])
    );
  });

  it('counts minutes from clocks snapped to the nearest quarter hour', () => {
    const csv = [
      'Route,Driver,Kind,Date,Run,Clock in,Clock out,Note',
      '88,Pat Example,start,2026-09-08,AM,6:00,8:07,',
      '88,Pat Example,start,2026-09-08,Midday,11:00,12:07,',
      '88,Pat Example,start,2026-09-08,PM,14:00,16:07,',
    ].join('\n');
    const row = payrollDriverRows(stateFromRoutesCsv(csv), {
      asOf: '2026-09-16',
      calendar,
    }).find((item) => item.route === '88');
    assert.equal(row.amIn, '6:00');
    assert.equal(row.amOut, '8:07');
    assert.equal(row.amQuarterClocks, '6:00 AM–8:00 AM');
    assert.equal(row.amTotalMinutes, 120);
    assert.equal(row.amRoundedQuarterHours, 2);
    assert.equal(row.middayQuarterClocks, '11:00 AM–12:00 PM');
    assert.equal(row.middayTotalMinutes, 60);
    assert.equal(row.pmQuarterClocks, '2:00 PM–4:00 PM');
    assert.equal(row.pmTotalMinutes, 120);
    assert.equal(row.fullDayRoundedQuarterHours, 5);
  });

  it('uses the new clock times after a small change has been contracted', () => {
    const state = sampleState();
    const asOf = '2026-11-02';
    const route209 = Object.values(state.profiles).find((profile) => profile.name === '209');
    const locked = rebuildEmployeeRouteState(route209.changeLog, calendar, asOf);
    assert.equal(locked.status, 'STABLE');

    const riley = payrollDriverRows(state, { asOf, calendar }).find((row) => row.route === '209');
    assert.equal(riley.amOut, '8:10');
    assert.equal(riley.amQuarterClocks, '6:00 AM–8:15 AM');
    assert.equal(riley.amTotalMinutes, 135);
    assert.equal(riley.amRoundedQuarterHours, 2.25);
    assert.equal(formatQuarterHours(riley.amRoundedQuarterHours), '2.25');
    assert.equal(riley.middayRoundedQuarterHours, 1);
    assert.equal(riley.pmRoundedQuarterHours, 2.25);
    assert.equal(riley.fullDayRoundedQuarterHours, 5.5);
    assert.equal(formatQuarterHours(riley.fullDayRoundedQuarterHours), '5.5');
    assert.equal(
      riley.contractStarted,
      contractStartedOn(locked, {
        startDate: route209.start_date,
        changeLog: route209.changeLog,
      })
    );
    assert.equal(riley.contractStarted, String(locked.change_reports.at(-1).finalized_at).slice(0, 10));
    assert.notEqual(riley.contractStarted, '2026-09-09');
  });

  it('writes per-run totals in minutes and rounded time in quarter hours', async () => {
    const buffer = await buildPayrollWorkbook(sampleState(), { asOf: '2026-09-16' });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      [PAYROLL_SHEET]
    );
    const sheet = workbook.getWorksheet(PAYROLL_SHEET);
    assert.deepEqual(
      PAYROLL_HEADERS.map((_, index) => sheet.getRow(1).getCell(index + 1).value),
      [
        'Email',
        'First name',
        'Last name',
        'Route number',
        'Contract started',
        'Contracted AM clock in',
        'Contracted AM clock out',
        'AM quarter-hour clocks',
        'AM total minutes',
        'AM rounded quarter hours',
        'Contracted midday clock in',
        'Contracted midday clock out',
        'Mid Day quarter-hour clocks',
        'Mid Day total minutes',
        'Mid Day rounded quarter hours',
        'Contracted PM clock in',
        'Contracted PM clock out',
        'PM quarter-hour clocks',
        'PM total minutes',
        'PM rounded quarter hours',
        'Full Day rounded quarter hours',
      ]
    );

    const data = [];
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      data.push(row);
    });
    const alex104 = data.find((row) => row.getCell(4).value === '104');
    assert.equal(alex104.getCell(1).value, 'alex.driver@example.com');
    assert.equal(alex104.getCell(2).value, 'Alex');
    assert.equal(alex104.getCell(3).value, 'Driver');
    assert.equal(alex104.getCell(5).value.toISOString(), '2026-09-08T12:00:00.000Z');
    assert.equal(alex104.getCell(5).numFmt, 'm/d/yyyy');
    assert.equal(alex104.getCell(6).value.toISOString(), '1899-12-30T06:00:00.000Z');
    assert.equal(alex104.getCell(6).numFmt, 'h:mm AM/PM');
    assert.equal(alex104.getCell(7).value.toISOString(), '1899-12-30T08:00:00.000Z');
    assert.equal(alex104.getCell(8).value, '6:00 AM–8:00 AM');
    assert.equal(alex104.getCell(9).value, 120);
    assert.equal(alex104.getCell(10).value, 2);
    assert.equal(alex104.getCell(10).numFmt, '0.0#');
    assert.equal(formatQuarterHours(alex104.getCell(10).value), '2.0');
    assert.equal(alex104.getCell(11).value.toISOString(), '1899-12-30T11:00:00.000Z');
    assert.equal(alex104.getCell(12).value.toISOString(), '1899-12-30T12:00:00.000Z');
    assert.equal(alex104.getCell(13).value, '11:00 AM–12:00 PM');
    assert.equal(alex104.getCell(14).value, 60);
    assert.equal(alex104.getCell(15).value, 1);
    assert.equal(formatQuarterHours(alex104.getCell(15).value), '1.0');
    assert.equal(alex104.getCell(16).value.toISOString(), '1899-12-30T14:00:00.000Z');
    assert.equal(alex104.getCell(17).value.toISOString(), '1899-12-30T16:15:00.000Z');
    assert.equal(alex104.getCell(18).value, '2:00 PM–4:15 PM');
    assert.equal(alex104.getCell(19).value, 135);
    assert.equal(alex104.getCell(20).value, 2.25);
    assert.equal(alex104.getCell(20).numFmt, '0.0#');
    assert.equal(formatQuarterHours(alex104.getCell(20).value), '2.25');
    assert.equal(alex104.getCell(21).value, 5.25);
    assert.equal(alex104.getCell(21).numFmt, '0.0#');
    assert.equal(formatQuarterHours(alex104.getCell(21).value), '5.25');

    const sam = data.find((row) => row.getCell(1).value === 'sam.noroute@example.com');
    assert.equal(sam.getCell(4).value, '');
    assert.equal(sam.getCell(5).value, null);
    assert.equal(sam.getCell(8).value, null);
    assert.equal(sam.getCell(9).value, null);
    assert.equal(sam.getCell(21).value, null);

    const widths = PAYROLL_HEADERS.map((_, index) => sheet.getColumn(index + 1).width);
    const total = widths.reduce((sum, width) => sum + width, 0);
    assert.ok(total <= 250, `sheet is ${total} characters wide`);
    assert.deepEqual(widths, [
      25, 10, 10, 6, 11, 11, 11, 16, 8, 8, 11, 11, 18, 8, 8, 11, 11, 16, 8, 8, 8,
    ]);
    assert.equal(sheet.getRow(1).getCell(6).alignment.wrapText, true);
    assert.ok(sheet.getRow(1).height >= 56);
    assert.notEqual(alex104.getCell(1).fill?.fgColor?.argb, 'FFFFFF00');

    const headerRow = sheet.getRow(1);
    assert.equal(headerRow.getCell(6).fill.fgColor.argb, PAYROLL_RUN_COLORS.AM.fill);
    assert.equal(headerRow.getCell(6).font.color.argb, 'FF000000');
    assert.equal(headerRow.getCell(10).fill.fgColor.argb, PAYROLL_RUN_COLORS.AM.fill);
    assert.equal(headerRow.getCell(11).fill.fgColor.argb, PAYROLL_RUN_COLORS.MIDDAY.fill);
    assert.equal(headerRow.getCell(11).font.color.argb, 'FF000000');
    assert.equal(headerRow.getCell(15).fill.fgColor.argb, PAYROLL_RUN_COLORS.MIDDAY.fill);
    assert.equal(headerRow.getCell(16).fill.fgColor.argb, PAYROLL_RUN_COLORS.PM.fill);
    assert.equal(headerRow.getCell(16).font.color.argb, 'FF000000');
    assert.equal(headerRow.getCell(20).fill.fgColor.argb, PAYROLL_RUN_COLORS.PM.fill);
    assert.equal(headerRow.getCell(1).fill.fgColor.argb, 'FF1A4F86');
    assert.equal(headerRow.getCell(21).fill.fgColor.argb, 'FF1A4F86');

    assert.equal(alex104.getCell(6).fill.fgColor.argb, PAYROLL_RUN_COLORS.AM.fill);
    assert.equal(alex104.getCell(6).font.color.argb, 'FF000000');
    assert.equal(alex104.getCell(10).fill.fgColor.argb, PAYROLL_RUN_COLORS.AM.fill);
    assert.equal(alex104.getCell(11).fill.fgColor.argb, PAYROLL_RUN_COLORS.MIDDAY.fill);
    assert.equal(alex104.getCell(15).fill.fgColor.argb, PAYROLL_RUN_COLORS.MIDDAY.fill);
    assert.equal(alex104.getCell(16).fill.fgColor.argb, PAYROLL_RUN_COLORS.PM.fill);
    assert.equal(alex104.getCell(16).font.color.argb, 'FF000000');
    assert.equal(alex104.getCell(20).fill.fgColor.argb, PAYROLL_RUN_COLORS.PM.fill);
    assert.equal(sam.getCell(11).fill.fgColor.argb, PAYROLL_RUN_COLORS.MIDDAY.fill);
    assert.equal(sam.getCell(16).fill.fgColor.argb, PAYROLL_RUN_COLORS.PM.fill);
  });

  it('widens a column for a longer value and still keeps the sheet on one screen', async () => {
    const state = sampleState();
    state.drivers.push({
      id: 'driver-pat',
      name: 'Patricia Longname',
      phone: '',
      email: 'patricia.longname.example@district.k12.wa.us',
    });
    const buffer = await buildPayrollWorkbook(state, { asOf: '2026-09-16' });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet(PAYROLL_SHEET);
    const widths = PAYROLL_HEADERS.map((_, index) => sheet.getColumn(index + 1).width);
    assert.equal(widths[0], 28);
    assert.equal(widths[2], 10);
    assert.equal(widths[5], 11);
    assert.equal(widths[8], 8);
    const total = widths.reduce((sum, width) => sum + width, 0);
    assert.ok(total <= 250, `sheet is ${total} characters wide`);
  });

  it('highlights the routes changed during this visit', async () => {
    const result = {};
    const buffer = await buildPayrollWorkbook(sampleState(), {
      asOf: '2026-09-16',
      highlightRoutes: ['104'],
      result,
    });
    assert.equal(result.changedCount, 1);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet(PAYROLL_SHEET);
    /** @type {ExcelJS.Row[]} */
    const data = [];
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      data.push(row);
    });
    const highlighted = data.find((row) => row.getCell(4).value === '104');
    const untouched = data.find((row) => row.getCell(4).value === '12');
    assert.equal(highlighted.getCell(1).font.bold, true);
    assert.equal(highlighted.getCell(1).fill.fgColor.argb, 'FFFFFF00');
    assert.notEqual(untouched.getCell(1).fill?.fgColor?.argb, 'FFFFFF00');
    assert.notEqual(untouched.getCell(1).font?.bold, true);
  });

  it('keeps a saved payroll file comparable with the next one', () => {
    const asOf = '2026-09-16';
    const rows = payrollDriverRows(sampleState(), { asOf, calendar });
    const saved = payrollBaselineRows(rows);
    assert.deepEqual(changedPayrollKeys(rows, saved), []);
    assert.deepEqual(changedPayrollLabels(rows, saved), []);

    const edited = saved.map((row) => ({ ...row }));
    const alex104 = edited.find((row) => row.route === '104');
    alex104.amOut = '8:10';
    assert.deepEqual(changedPayrollLabels(rows, edited), ['104 · Alex Driver']);
  });

  it('keeps every payroll column for one driver', () => {
    const rows = payrollDriverRows(sampleState(), { asOf: '2026-09-16', calendar });
    const alex = payrollRowsForDriver(rows, 'Alex Driver');
    assert.deepEqual(
      alex.map((row) => row.route),
      ['12', '104']
    );
    assert.equal(payrollRowsForDriver(rows, 'Sam NoRoute').length, 1);
    assert.equal(payrollRowsForDriver(rows, 'Nobody').length, 0);
  });

  it('bolds and highlights rows that differ from the last payroll file', async () => {
    const state = sampleState();
    const asOf = '2026-09-16';
    const sent = await buildPayrollWorkbook(state, { asOf });
    const previous = await rowsFromPayrollWorkbook(sent);
    const current = payrollDriverRows(state, { asOf, calendar });
    assert.deepEqual(changedPayrollKeys(current, previous), []);

    const lastSent = previous.map((row) => ({ ...row }));
    const alex104 = lastSent.find((row) => row.route === '104');
    alex104.amOut = '8:10';
    alex104.amTotalMinutes = 130;
    alex104.amRoundedQuarterHours = 2.25;
    alex104.fullDayRoundedQuarterHours = 5.5;
    const withoutSam = lastSent.filter((row) => row.email !== 'sam.noroute@example.com');

    const result = {};
    const buffer = await buildPayrollWorkbook(state, {
      asOf,
      previousRows: withoutSam,
      result,
    });
    assert.equal(result.changedCount, 2);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet(PAYROLL_SHEET);
    /** @type {ExcelJS.Row[]} */
    const data = [];
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      data.push(row);
    });
    const changed104 = data.find((row) => row.getCell(4).value === '104');
    const unchanged12 = data.find((row) => row.getCell(4).value === '12');
    const newSam = data.find((row) => row.getCell(1).value === 'sam.noroute@example.com');
    assert.equal(changed104.getCell(1).font.bold, true);
    assert.equal(changed104.getCell(1).fill.fgColor.argb, 'FFFFFF00');
    assert.equal(changed104.getCell(6).fill.fgColor.argb, PAYROLL_RUN_COLORS.AM.fill);
    assert.equal(changed104.getCell(6).font.color.argb, 'FF000000');
    assert.equal(changed104.getCell(6).font.bold, true);
    assert.equal(newSam.getCell(2).font.bold, true);
    assert.equal(newSam.getCell(1).fill.fgColor.argb, 'FFFFFF00');
    assert.notEqual(unchanged12.getCell(1).fill?.fgColor?.argb, 'FFFFFF00');
    assert.notEqual(unchanged12.getCell(1).font?.bold, true);

    const reread = await rowsFromPayrollWorkbook(buffer);
    assert.deepEqual(changedPayrollKeys(reread, previous), []);
  });

  it('reads an older payroll file that has no contract started column', async () => {
    const buffer = await buildPayrollWorkbook(sampleState(), { asOf: '2026-09-16' });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    workbook.getWorksheet(PAYROLL_SHEET).spliceColumns(5, 1);
    const rows = await rowsFromPayrollWorkbook(await workbook.xlsx.writeBuffer());
    const alex = rows.find((row) => row.route === '104');
    assert.equal(alex.contractStarted, '');
    assert.equal(alex.amIn, '6:00');
    assert.equal(alex.amTotalMinutes, 120);
    assert.equal(alex.fullDayRoundedQuarterHours, 5.25);
    assert.equal(formatQuarterHours(alex.fullDayRoundedQuarterHours), '5.25');
  });

  it('reads an older payroll file that rounded the daily total into clock hours', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Payroll Driver Times');
    sheet.addRow([
      'Email',
      'First name',
      'Last name',
      'Route number',
      'Contracted AM clock in',
      'Contracted AM clock out',
      'Contracted midday clock in',
      'Contracted midday clock out',
      'Contracted PM clock in',
      'Contracted PM clock out',
      'AM minutes',
      'Midday minutes',
      'PM minutes',
      'Exact total minutes',
      'Rounded clock hours',
    ]);
    sheet.addRow([
      'alex.driver@example.com',
      'Alex',
      'Driver',
      '104',
      '6:00 AM',
      '8:07 AM',
      '11:00 AM',
      '12:07 PM',
      '2:00 PM',
      '4:07 PM',
      127,
      67,
      127,
      321,
      5.25,
    ]);
    const rows = await rowsFromPayrollWorkbook(await workbook.xlsx.writeBuffer());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amTotalMinutes, 127);
    assert.equal(rows[0].amRoundedQuarterHours, null);
    assert.equal(rows[0].middayTotalMinutes, 67);
    assert.equal(rows[0].pmTotalMinutes, 127);
    assert.equal(rows[0].fullDayRoundedQuarterHours, 5.25);
    assert.equal(formatQuarterHours(rows[0].fullDayRoundedQuarterHours), '5.25');
    assert.equal(rows[0].amIn, '6:00');
    assert.equal(rows[0].pmOut, '16:07');
  });

  it('reads an older file that stored rounded minutes and converts them to quarter hours', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Payroll Driver Times');
    sheet.addRow([
      'Email',
      'First name',
      'Last name',
      'Route number',
      'Contracted AM clock in',
      'Contracted AM clock out',
      'Contracted midday clock in',
      'Contracted midday clock out',
      'Contracted PM clock in',
      'Contracted PM clock out',
      'AM total minutes',
      'AM rounded minutes',
      'Mid Day total minutes',
      'Mid Day rounded minutes',
      'PM total minutes',
      'PM rounded minutes',
      'Full Day rounded minutes',
    ]);
    sheet.addRow([
      'deanna.troi@example.com',
      'Deanna',
      'Troi',
      'S6',
      '6:00 AM',
      '8:20 AM',
      null,
      null,
      '2:00 PM',
      '4:20 PM',
      140,
      135,
      null,
      null,
      140,
      135,
      270,
    ]);
    const rows = await rowsFromPayrollWorkbook(await workbook.xlsx.writeBuffer());
    assert.equal(rows[0].amTotalMinutes, 140);
    assert.equal(rows[0].amRoundedQuarterHours, 2.25);
    assert.equal(formatQuarterHours(rows[0].amRoundedQuarterHours), '2.25');
    assert.equal(rows[0].middayRoundedQuarterHours, null);
    assert.equal(rows[0].pmRoundedQuarterHours, 2.25);
    assert.equal(rows[0].fullDayRoundedQuarterHours, 4.5);
    assert.equal(formatQuarterHours(rows[0].fullDayRoundedQuarterHours), '4.5');
  });

  it('remembers route numbers saved during this visit', () => {
    const storage = {
      /** @type {Map<string, string>} */
      data: new Map(),
      getItem(key) {
        return this.data.has(key) ? this.data.get(key) : null;
      },
      setItem(key, value) {
        this.data.set(key, String(value));
      },
    };
    saveProfile({ id: 'before', name: 'S1', driver_name: 'Alex Driver' }, storage);
    beginSessionRouteTracking();
    assert.deepEqual(sessionModifiedRouteNames(), []);
    saveProfile({ id: 's6', name: 'S6', driver_name: 'Deanna Troi' }, storage);
    saveProfile({ id: 's1', name: 'S1', driver_name: 'Alex Driver' }, storage);
    saveDriver(
      {
        name: 'Deanna Troi',
        firstName: 'Deanna',
        lastName: 'Troi',
        email: 'deanna.troi@example.com',
      },
      storage
    );
    assert.deepEqual(sessionModifiedRouteNames(), ['S1', 'S6']);
  });

  it('rejects a spreadsheet that is not payroll driver times', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Notes').addRow(['Hello']);
    const buffer = await workbook.xlsx.writeBuffer();
    await assert.rejects(
      () => rowsFromPayrollWorkbook(buffer),
      /Payroll Driver Times spreadsheet/
    );
  });
});
