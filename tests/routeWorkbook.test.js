import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildRoutesCsv, stateFromRoutesCsv } from '../office-tracker/src/routesCsv.js';
import {
  buildRouteWorkbook,
  stateFromRouteWorkbook,
} from '../office-tracker/src/routeWorkbook.js';

const sample = [
  'Route,Driver,Kind,Date,Run,Clock in,Clock out,Note',
  '12,Alex Driver,start,2026-09-08,AM,6:15,8:45,',
  '12,Alex Driver,start,2026-09-08,Midday,11:00,12:15,',
  '12,Alex Driver,start,2026-09-08,PM,14:10,16:40,',
  '12,Alex Driver,change,2026-10-06,AM,6:15,9:00,"Fifteen minutes added, after the stop"',
  'P32,Jordan Lee,start,2026-09-08,AM,6:30,8:50,',
  'P32,Jordan Lee,change,2026-09-15,AM,6:20,8:50,Ten minutes added',
].join('\r\n');

describe('current route data workbook', () => {
  it('opens in Excel with plain labels and restores routes, times, and drivers', async () => {
    const state = stateFromRoutesCsv(sample, { currentRoute: 'P32' });
    state.drivers = [
      { id: 'driver-alex', name: 'Alex Driver', phone: '617-555-0101', email: 'alex.driver@example.com' },
      { id: 'driver-jordan', name: 'Jordan Lee', phone: '617-555-0102', email: 'jordan.lee@example.com' },
    ];

    const sentId = Object.values(state.profiles)
      .find((profile) => profile.name === '12')
      .changeLog.find((row) => row.delta_minutes).id;
    const buffer = await buildRouteWorkbook({ ...state, noticeSentIds: [sentId] });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      ['12', 'P32', 'Drivers', 'How to read this file']
    );

    const clock = workbook.getWorksheet('12');
    assert.equal(clock.getRow(1).getCell(1).value, 'Route');
    assert.equal(clock.getRow(1).getCell(2).value, '12');
    assert.equal(clock.getRow(2).getCell(1).value, 'Driver');
    assert.equal(clock.getRow(2).getCell(2).value, 'Alex Driver');
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((col) => clock.getRow(4).getCell(col).value),
      [
        'Force Oct 1 Contract',
        'New Schedule Started',
        'AM start',
        'AM end',
        'Midday start',
        'Midday end',
        'PM start',
        'PM end',
        'Hours',
        'Contracted',
        'Contract Hours',
        'Notice sent?',
      ]
    );
    assert.equal(clock.getRow(5).getCell(1).value ?? '', '');
    assert.equal(clock.getRow(5).getCell(2).value.toISOString(), '2026-09-08T12:00:00.000Z');
    assert.equal(clock.getRow(5).getCell(2).numFmt, 'm/d/yyyy');
    assert.equal(clock.getRow(5).getCell(3).value.toISOString(), '1899-12-30T06:15:00.000Z');
    assert.equal(clock.getRow(5).getCell(3).numFmt, 'h:mm AM/PM');
    assert.equal(clock.getRow(5).getCell(7).value.toISOString(), '1899-12-30T14:10:00.000Z');
    assert.equal(clock.getRow(5).getCell(9).value, '6 hr 15 min');
    assert.equal(clock.getRow(5).getCell(10).value, '09/08/2026');
    assert.equal(clock.getRow(5).getCell(11).value, '6 hr 15 min');
    assert.equal(clock.getRow(5).getCell(12).value ?? '', '');
    assert.equal(clock.getRow(6).getCell(1).value, 'Off');
    assert.equal(clock.getRow(6).getCell(4).value.toISOString(), '1899-12-30T09:00:00.000Z');
    assert.equal(clock.getRow(6).getCell(4).font.bold, true);
    assert.equal(clock.getRow(6).getCell(9).value, '6 hr 30 min');
    assert.match(String(clock.getRow(6).getCell(10).value), /Note: Fifteen minutes added, after the stop/);
    assert.equal(clock.getRow(6).getCell(12).value, 'Yes');

    const p32 = workbook.getWorksheet('P32');
    assert.equal(p32.getRow(5).getCell(5).value, null);
    assert.equal(p32.getRow(6).getCell(1).value, 'Off');
    assert.equal(p32.getRow(6).getCell(3).value.toISOString(), '1899-12-30T06:20:00.000Z');
    assert.equal(p32.getRow(6).getCell(12).value, 'No');

    const drivers = workbook.getWorksheet('Drivers');
    assert.equal(drivers.getRow(1).getCell(1).value, 'First name');
    assert.equal(drivers.getRow(1).getCell(2).value, 'Last name');
    assert.equal(drivers.getRow(2).getCell(1).value, 'Alex');
    assert.equal(drivers.getRow(2).getCell(2).value, 'Driver');
    assert.equal(drivers.getRow(2).getCell(3).value, 'alex.driver@example.com');

    const restored = await stateFromRouteWorkbook(buffer, { currentRoute: 'P32' });
    assert.equal(restored.profiles[restored.currentProfileId].name, 'P32');
    const route12 = Object.values(restored.profiles).find((profile) => profile.name === '12');
    const change = route12.changeLog.find((row) => row.delta_minutes);
    assert.equal(change.new_time, '6:15-9:00');
    assert.equal(change.note, 'Fifteen minutes added, after the stop');
    assert.equal(route12.changeLog.filter((row) => row.delta_minutes !== 0).length, 1);
    const jordan = restored.drivers.find((driver) => driver.name === 'Jordan Lee');
    assert.equal(jordan.firstName, 'Jordan');
    assert.equal(jordan.lastName, 'Lee');
    assert.equal(jordan.email, 'jordan.lee@example.com');

    const again = stateFromRoutesCsv(buildRoutesCsv(restored));
    const routeAgain = Object.values(again.profiles).find((profile) => profile.name === '12');
    assert.equal(routeAgain.changeLog.find((row) => row.delta_minutes).new_time, '6:15-9:00');
  });

  it('keeps the driver who held the route on each row', async () => {
    const moved = [
      sample,
      '12,Marcus Ellison,change,2026-10-20,PM,14:10,16:55,Marcus took the PM run',
    ].join('\r\n');
    const state = stateFromRoutesCsv(moved);
    const restored = await stateFromRouteWorkbook(await buildRouteWorkbook(state));
    const routeSheet = new ExcelJS.Workbook();
    await routeSheet.xlsx.load(await buildRouteWorkbook(state));
    const driversOn12 = routeSheet.getWorksheet('12');
    assert.equal(driversOn12.getRow(3).getCell(1).value, 'Alex Driver');
    assert.equal(driversOn12.getRow(3).getCell(3).value.toISOString(), '2026-10-20T12:00:00.000Z');
    assert.equal(driversOn12.getRow(4).getCell(1).value, 'Marcus Ellison');
    assert.equal(driversOn12.getRow(4).getCell(2).value.toISOString(), '2026-10-20T12:00:00.000Z');

    const route12 = Object.values(restored.profiles).find((profile) => profile.name === '12');
    assert.equal(route12.driver_name, 'Marcus Ellison');
    assert.equal(route12.assignments[0].driver_name, 'Alex Driver');
    assert.equal(route12.assignments[0].until, '2026-10-20');
    assert.equal(
      restored.drivers.some((driver) => driver.name === 'Marcus Ellison'),
      true
    );
  });

  it('keeps Force Oct 1 Contract when a route workbook is saved and opened again', async () => {
    const state = stateFromRoutesCsv(sample);
    const route = Object.values(state.profiles).find((profile) => profile.name === '12');
    const change = route.changeLog.find((row) => row.delta_minutes);
    change.force_oct1_contract = true;
    const restored = await stateFromRouteWorkbook(await buildRouteWorkbook(state));
    const again = Object.values(restored.profiles).find((profile) => profile.name === '12');
    const quiet = Object.values(restored.profiles).find((profile) => profile.name === 'P32');
    assert.equal(again.changeLog.find((row) => row.delta_minutes).force_oct1_contract, true);
    assert.equal(Boolean(quiet.changeLog.find((row) => row.delta_minutes).force_oct1_contract), false);
  });

  it('rejects a workbook that is not route data', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Notes').addRow(['Hello']);
    const buffer = await workbook.xlsx.writeBuffer();
    await assert.rejects(
      () => stateFromRouteWorkbook(buffer),
      /New Schedule Started/
    );
  });

  it('still reads a driver list that used one name column and a phone column', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Drivers');
    sheet.addRow(['Driver', 'Phone', 'Email']);
    sheet.addRow(['Geordi La Forge', '617-555-0199', 'geordi@example.com']);
    const routes = workbook.addWorksheet('S4');
    routes.addRow(['Route', 'S4']);
    routes.addRow(['Driver', 'Geordi La Forge']);
    routes.addRow([]);
    routes.addRow([
      'Effective',
      'AM start',
      'AM end',
      'Midday start',
      'Midday end',
      'PM start',
      'PM end',
      'Contracted',
      'Notice sent?',
    ]);
    routes.addRow(['9/8/2026', '6:15 AM', '8:45 AM', '', '', '', '', '', '']);
    const restored = await stateFromRouteWorkbook(await workbook.xlsx.writeBuffer());
    const geordi = restored.drivers.find((driver) => driver.name === 'Geordi La Forge');
    assert.equal(geordi.firstName, 'Geordi');
    assert.equal(geordi.lastName, 'La Forge');
    assert.equal(geordi.phone, '617-555-0199');
    assert.equal(geordi.email, 'geordi@example.com');
  });

  it('still reads an older workbook with every route on one sheet', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Route clock times');
    sheet.addRow([
      'Route number',
      'Driver',
      'What this row is',
      'Date',
      'Run',
      'Clock in',
      'Clock out',
      'Note',
    ]);
    sheet.addRow(['12', 'Alex Driver', 'Starting times', '9/8/2026', 'AM', '6:15 AM', '8:45 AM', '']);
    sheet.addRow([
      '12',
      'Alex Driver',
      'Clock-time change',
      '10/6/2026',
      'AM',
      '6:15 AM',
      '9:00 AM',
      'Fifteen minutes added, after the stop',
    ]);
    const restored = await stateFromRouteWorkbook(await workbook.xlsx.writeBuffer());
    const route12 = Object.values(restored.profiles).find((profile) => profile.name === '12');
    const change = route12.changeLog.find((row) => row.delta_minutes);
    assert.equal(change.new_time, '6:15-9:00');
    assert.equal(change.note, 'Fifteen minutes added, after the stop');
  });
});
