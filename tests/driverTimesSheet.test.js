import assert from 'node:assert/strict';
import test from 'node:test';
import { officeStateFromDriverTimesCsv, DRIVER_TIMES_CONTRACT_DATE } from '../office-tracker/src/driverTimesSheet.js';
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

test('imports October 1 clocked runs and leaves shop, office, and empty routes out of the clocks', () => {
  const state = officeStateFromDriverTimesCsv(csv);
  const byName = Object.fromEntries(
    Object.values(state.profiles).map((profile) => [profile.name, profile])
  );
  assert.equal(byName['S 22'], undefined);
  assert.equal(Object.keys(byName).sort().join(','), '56,59,65,83,S 14,Utility — Blakeslee');

  const hundal = byName['59'];
  assert.equal(hundal.driver_name, 'Charanjit Hundal');
  assert.equal(hundal.start_date, DRIVER_TIMES_CONTRACT_DATE);
  assert.deepEqual(
    hundal.changeLog.map((event) => event.segment),
    ['AM', 'PM']
  );
  assert.equal(hundal.changeLog.every((event) => event.delta_minutes === 0), true);
  assert.equal(hundal.changeLog[0].effective_date, '2026-10-01');
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
