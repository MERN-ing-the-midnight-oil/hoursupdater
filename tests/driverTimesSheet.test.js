import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { buildBps2026_2027Calendar } from '../employee-tracker/src/bpsCalendar2026.js';
import { buildEmployeeSnapshot, rebuildEmployeeRouteState } from '../employee-tracker/src/snapshot.js';
import {
  officeStateFromDriverTimesCsv,
  officeStateFromDriverTimesWorkbook,
  DRIVER_TIMES_START_DATE,
} from '../office-tracker/src/driverTimesSheet.js';
import { buildRouteWorkbook, stateFromRouteWorkbook } from '../office-tracker/src/routeWorkbook.js';

const header = [
  'Seniority',
  'Bus #',
  'ROUTE',
  'Last Name',
  'First Name',
  'AM IN',
  'AM OUT',
  'AM Total',
  'Rounded Total',
  'AM Total',
  'Mid IN',
  'Mid OUT',
  'RT # / Bus',
  'Mid Total',
  'Rounded Total',
  'Midday Total',
  'PM IN',
  'PM OUT',
  'PM Total',
  'PM rounded',
  'PM Total',
  'TOTAL',
  'ER',
  'Comments',
].join(',');

function line(cells) {
  return cells
    .map((cell) => (/[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell))
    .join(',');
}

const csv = [
  '08/21/26 DRIVER CONTRACT TIME',
  header,
  line(['28', '76', '59', 'Hundal', 'Charanjit', '6:35 AM', '9:20 AM', '', '', '', '', '', 'SHOP', '', '', '1.50', '2:05 PM', '4:40 PM', '', '', '', '7.00', '', 'FMS, HV/FMS, HV']),
  line(['2', '31', '65', 'Vanderyacht', 'Becky', '6:35 AM', '9:20 AM', '', '', '', '', '', 'OFF', '', '', '1.50', '2:05 PM', '5:10 PM', '', '', '', '7.50', '', 'CC, SHS']),
  line(['1', '', 'Utility', 'Blakeslee', 'Bob', '7:00 AM', '3:00 PM', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '8.00', '', 'Utility']),
  line(['', '', 'S 22', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '0.00', '', '']),
  line(['', '64', '56', '', '', '6:40 AM', '8:15 AM', '', '', '', '', '', '', '', '', '', '1:55 PM', '3:10 PM', '', '', '', '2.75', '', '2.75 hours/4 hour minimum. Driver Trainer']),
  line(['27', '51', 'S 14', 'Cruikshank', 'Terri', '6:50 AM', '9:25 AM', '', '', '', '10:35 AM', '12:00 PM', 'CT', '', '', '1.50', '2:10 PM', '4:40 PM', '', '', '', '6.75', '', 'MD is only 3 days a week']),
  line(['14', '40', '83', 'de Vries', 'Johanna', '6:55 AM', '9:20 AM', '', '', '', '11:35 AM', '1:20 PM', 'CT', '', '', '1.75', '2:00 PM', '4:55 PM', '', '', '', '7.00', '', 'BW, FMS']),
].join('\n');

test('imports clocked runs from the first day of school and leaves shop, office, and empty routes out', () => {
  const state = officeStateFromDriverTimesCsv(csv);
  const byName = Object.fromEntries(
    Object.values(state.profiles).map((profile) => [profile.name, profile])
  );
  assert.equal(byName['S 22'], undefined);
  assert.equal(Object.keys(byName).sort().join(','), '56,59,65,83,S 14,Utility — Blakeslee');

  const hundal = byName['59'];
  assert.equal(hundal.driver_name, 'Charanjit Hundal');
  assert.equal(hundal.start_date, DRIVER_TIMES_START_DATE);
  assert.deepEqual(
    hundal.changeLog.map((event) => event.segment),
    ['AM', 'PM']
  );
  assert.equal(hundal.changeLog.every((event) => event.delta_minutes === 0), true);
  assert.equal(hundal.changeLog[0].effective_date, '2026-08-31');
  assert.match(hundal.note, /Shop 1\.50 hours/);
  assert.match(hundal.note, /FMS, HV/);

  assert.match(byName['65'].note, /Office 1\.50 hours/);
  assert.equal(
    byName['65'].changeLog.some((event) => event.segment === 'MIDDAY'),
    false
  );

  const utility = byName['Utility — Blakeslee'];
  assert.equal(utility.driver_name, 'Bob Blakeslee');
  assert.deepEqual(
    utility.changeLog.map((event) => `${event.segment} ${event.new_time}`),
    ['AM 7:00-15:00']
  );
  assert.match(utility.note, /one span/i);

  const open = byName['56'];
  assert.equal(open.driver_name, '');
  assert.match(open.note, /No driver assigned/);
  assert.equal(open.changeLog[0].driver_name, '');

  const partial = byName['S 14'];
  assert.equal(
    partial.changeLog.some((event) => event.segment === 'MIDDAY' && event.new_time === '10:35-12:00'),
    true
  );
  assert.match(partial.note, /3 days a week/);

  const johanna = state.drivers.find((driver) => driver.name === 'Johanna de Vries');
  assert.equal(johanna.firstName, 'Johanna');
  assert.equal(johanna.lastName, 'de Vries');
});

test('a route note survives a Current Route Data workbook', async () => {
  const state = officeStateFromDriverTimesCsv(csv);
  const restored = await stateFromRouteWorkbook(await buildRouteWorkbook(state));
  const hundal = Object.values(restored.profiles).find((profile) => profile.name === '59');
  assert.match(hundal.note, /Shop 1\.50 hours/);
  assert.equal(
    hundal.changeLog.some((event) => event.segment === 'MIDDAY'),
    false
  );
});

test('uses bid clocks as the established schedule and September clocks as a forced October 1 change', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('2026-2027');
  sheet.getCell('X2').value = 'SEPTEMBER ADJUSTMENTS';
  sheet.getRow(3).getCell(3).value = 'ROUTE';
  sheet.getRow(3).getCell(24).value = 'AM IN';

  function put(row, col, value) {
    sheet.getRow(row).getCell(col).value = value;
  }

  put(4, 3, '50');
  put(4, 4, 'Wright');
  put(4, 5, 'Scott');
  put(4, 6, '6:55 AM');
  put(4, 7, '9:20 AM');
  put(4, 17, '2:00 PM');
  put(4, 18, '4:40 PM');
  put(4, 24, '6:25 AM');
  put(4, 25, '9:20 AM');
  put(4, 35, '2:00 PM');
  put(4, 36, '5:00 PM');
  put(4, 44, '0.25');
  put(4, 45, 'NH, SMS');

  put(5, 3, '51');
  put(5, 4, 'DeGraaff');
  put(5, 5, 'Lisa');
  put(5, 6, '6:35 AM');
  put(5, 7, '9:20 AM');
  put(5, 11, '10:25 AM');
  put(5, 12, '11:50 AM');
  put(5, 17, '2:00 PM');
  put(5, 18, '5:15 PM');
  put(5, 24, '6:35 AM');
  put(5, 25, '9:20 AM');
  put(5, 35, '2:00 PM');
  put(5, 36, '5:20 PM');
  put(5, 44, 'LOST MD');

  put(6, 3, '70');
  put(6, 4, 'Smith');
  put(6, 5, 'David');
  put(6, 6, '7:05 AM');
  put(6, 7, '9:20 AM');
  put(6, 17, '2:05 PM');
  put(6, 18, '4:55 PM');
  put(6, 24, '7:05 AM');
  put(6, 25, '9:20 AM');
  put(6, 35, '2:05PM');
  put(6, 36, '4:55PM');
  put(6, 44, 'NC');

  put(7, 3, '58');
  put(7, 4, 'McDermott');
  put(7, 5, 'Heather');
  put(7, 6, '6:50 AM');
  put(7, 7, '9:20 AM');
  put(7, 17, '2:05 PM');
  put(7, 18, '4:20 PM');
  put(7, 24, '6:50 AM');
  put(7, 25, '9:20 AM');
  put(7, 35, 2 / 24 + 5 / 1440);
  put(7, 36, 4 / 24 + 25 / 1440);

  put(8, 3, 'S 22');
  put(8, 24, '6:20 AM');
  put(8, 25, '9:20 AM');

  const state = await officeStateFromDriverTimesWorkbook(await workbook.xlsx.writeBuffer());
  const byName = Object.fromEntries(
    Object.values(state.profiles).map((profile) => [profile.name, profile])
  );

  const wright = byName['50'];
  assert.equal(wright.start_date, '2026-08-31');
  assert.equal(wright.driver_name, 'Scott Wright');
  assert.match(wright.note, /NH, SMS/);
  const wrightChanges = wright.changeLog.filter((event) => event.delta_minutes !== 0);
  assert.deepEqual(
    wrightChanges.map((event) => event.segment),
    ['AM', 'PM']
  );
  assert.equal(wrightChanges.every((event) => event.force_oct1_contract === true), true);
  assert.equal(wrightChanges.every((event) => event.effective_date == null), true);
  assert.equal(new Set(wrightChanges.map((event) => event.schedule_id)).size, 1);
  assert.equal(wrightChanges.every((event) => event.note === '0.25'), true);
  assert.equal(wrightChanges[0].previous_time, '6:55-9:20');
  assert.equal(wrightChanges[0].new_time, '6:25-9:20');

  const lisa = byName['51'];
  const dropped = lisa.changeLog.find((event) => event.segment === 'MIDDAY' && event.delta_minutes !== 0);
  assert.equal(dropped.new_time, '');
  assert.equal(dropped.force_oct1_contract, true);
  assert.equal(dropped.note, 'LOST MD');
  assert.equal(
    lisa.changeLog.some((event) => event.segment === 'PM' && event.new_time === '14:00-17:20'),
    true
  );

  assert.equal(
    byName['70'].changeLog.every((event) => event.delta_minutes === 0),
    true
  );

  const heather = byName['58'].changeLog.find((event) => event.segment === 'PM' && event.delta_minutes);
  assert.equal(heather.previous_time, '14:05-16:20');
  assert.equal(heather.new_time, '14:05-16:25');
  assert.equal(heather.force_oct1_contract, true);

  const open = byName['S 22'];
  assert.deepEqual(
    open.changeLog.map((event) => `${event.segment} ${event.new_time}`),
    ['AM 6:20-9:20']
  );
  assert.equal(open.changeLog[0].force_oct1_contract, undefined);

  const calendar = buildBps2026_2027Calendar().calendar;
  const wrightEntry = rebuildEmployeeRouteState(wright.changeLog, calendar, '2026-10-02');
  const wrightHistory = buildEmployeeSnapshot({
    profile: wright,
    changeLog: wright.changeLog,
    entry: wrightEntry,
    calendar,
    asOfDate: '2026-10-02',
  }).schedule_history;
  assert.equal(wrightHistory.length, 2);
  assert.equal(wrightHistory[0].date, '2026-08-31');
  assert.equal(wrightHistory[0].kind, 'initial');
  assert.equal(wrightHistory[1].date, null);
  assert.equal(wrightHistory[1].force_oct1_contract, true);
  assert.equal(wrightHistory[1].segments.join(','), 'AM,PM');

  const contracted = rebuildEmployeeRouteState(lisa.changeLog, calendar, '2026-10-02');
  assert.equal(contracted.status, 'STABLE');
  assert.equal(contracted.segments.MIDDAY, '');
  assert.equal(contracted.segments.PM, '14:00-17:20');
  assert.equal(contracted.change_reports.at(-1).forced_october_1, true);
  assert.equal(String(contracted.change_reports.at(-1).finalized_at).slice(0, 10), '2026-10-01');

  const restored = await stateFromRouteWorkbook(await buildRouteWorkbook(state));
  const lisaAgain = Object.values(restored.profiles).find((profile) => profile.name === '51');
  const again = rebuildEmployeeRouteState(lisaAgain.changeLog, calendar, '2026-10-02');
  assert.equal(again.segments.MIDDAY, '');
  assert.equal(again.segments.AM, '6:35-9:20');
  assert.equal(
    lisaAgain.changeLog.filter((event) => event.delta_minutes).every((event) => event.force_oct1_contract),
    true
  );
});
