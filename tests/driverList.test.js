import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { buildRouteWorkbook } from '../office-tracker/src/routeWorkbook.js';
import {
  deleteDriver,
  importState,
  listDrivers,
  loadState,
  mergeSharedDriverList,
  saveDriver,
  saveProfile,
  STORAGE_KEY,
} from '../office-tracker/web/store.js';

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

function route(name, driver) {
  return {
    id: `route-${name}`,
    name,
    driver_name: driver,
    start_date: '2026-09-08',
    changeLog: [],
  };
}

test('deleteDriver removes a name and leaves the rest of the list', () => {
  const storage = memoryStorage();
  saveDriver({ firstName: 'Alex', lastName: 'Driver', email: 'alex@example.com' }, storage);
  saveDriver({ firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com' }, storage);
  const alex = listDrivers(storage).find((driver) => driver.name === 'Alex Driver');

  const removed = deleteDriver(alex.id, storage);

  assert.equal(removed.name, 'Alex Driver');
  assert.deepEqual(
    listDrivers(storage).map((driver) => driver.name),
    ['Jordan Lee']
  );
});

test('a driver still assigned to a route stays off the list and on the route', () => {
  const storage = memoryStorage();
  saveProfile(route('12', 'Alex Driver'), storage);
  saveDriver({ firstName: 'Alex', lastName: 'Driver', email: 'alex@example.com' }, storage);
  const alex = listDrivers(storage).find((driver) => driver.name === 'Alex Driver');

  deleteDriver(alex.id, storage);

  assert.deepEqual(listDrivers(storage), []);
  assert.equal(loadState(storage).profiles['route-12'].driver_name, 'Alex Driver');
  assert.deepEqual(loadState(storage).omittedDrivers, ['alex driver']);
});

test('a route-only name can be removed without a saved driver row', () => {
  const storage = memoryStorage();
  saveProfile(route('12', 'Alex Driver'), storage);
  const alex = listDrivers(storage).find((driver) => driver.name === 'Alex Driver');

  deleteDriver(alex.id, storage);

  assert.equal(listDrivers(storage).length, 0);
  assert.equal(loadState(storage).profiles['route-12'].driver_name, 'Alex Driver');
});

test('saving the same name puts that driver back on the list', () => {
  const storage = memoryStorage();
  saveProfile(route('12', 'Alex Driver'), storage);
  const alex = listDrivers(storage).find((driver) => driver.name === 'Alex Driver');
  deleteDriver(alex.id, storage);

  saveDriver({ firstName: 'Alex', lastName: 'Driver', email: 'alex@example.com' }, storage);

  assert.deepEqual(
    listDrivers(storage).map((driver) => driver.email),
    ['alex@example.com']
  );
  assert.equal(loadState(storage).omittedDrivers, undefined);
});

test('deleteDriver rejects a name that is not on the list', () => {
  const storage = memoryStorage();
  assert.throws(() => deleteDriver('driver-missing', storage), /not on the list/);
});

test('a backup keeps a removed driver off the list', () => {
  const storage = memoryStorage();
  saveProfile(route('12', 'Alex Driver'), storage);
  saveDriver({ firstName: 'Jordan', lastName: 'Lee' }, storage);
  const alex = listDrivers(storage).find((driver) => driver.name === 'Alex Driver');
  deleteDriver(alex.id, storage);

  const copy = memoryStorage();
  importState(storage.getItem(STORAGE_KEY), copy);

  assert.deepEqual(
    listDrivers(copy).map((driver) => driver.name),
    ['Jordan Lee']
  );
  assert.equal(loadState(copy).profiles['route-12'].driver_name, 'Alex Driver');
});

test('a shared-office clash keeps a driver added on this browser', () => {
  const remote = {
    version: 1,
    currentProfileId: 'route-12',
    profiles: { 'route-12': route('12', 'Alex Driver') },
    drivers: [{ id: 'driver-alex-driver', name: 'Alex Driver', firstName: 'Alex', lastName: 'Driver', phone: '', email: 'alex@example.com' }],
  };
  const local = {
    ...remote,
    drivers: [
      ...remote.drivers,
      { id: 'driver-casey-nguyen', name: 'Casey Nguyen', firstName: 'Casey', lastName: 'Nguyen', phone: '', email: 'casey@example.com' },
    ],
  };

  const merged = mergeSharedDriverList(remote, local);

  assert.deepEqual(
    merged.drivers.map((driver) => driver.name).sort(),
    ['Alex Driver', 'Casey Nguyen']
  );
  assert.equal(merged.profiles['route-12'].driver_name, 'Alex Driver');
});

test('a shared-office clash keeps a driver removed on this browser', () => {
  const remote = {
    version: 1,
    profiles: { 'route-12': route('12', 'Alex Driver') },
    drivers: [
      { id: 'driver-alex-driver', name: 'Alex Driver', firstName: 'Alex', lastName: 'Driver', phone: '', email: '' },
      { id: 'driver-jordan-lee', name: 'Jordan Lee', firstName: 'Jordan', lastName: 'Lee', phone: '', email: '' },
    ],
  };
  const local = {
    ...remote,
    drivers: [remote.drivers[1]],
    omittedDrivers: ['alex driver'],
  };

  const merged = mergeSharedDriverList(remote, local);

  assert.deepEqual(
    merged.drivers.map((driver) => driver.name),
    ['Jordan Lee']
  );
  assert.deepEqual(merged.omittedDrivers, ['alex driver']);
  assert.equal(merged.profiles['route-12'].driver_name, 'Alex Driver');
});

test('the route workbook leaves a removed driver off the driver sheet', async () => {
  const storage = memoryStorage();
  saveProfile(route('12', 'Alex Driver'), storage);
  saveDriver({ firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com' }, storage);
  const alex = listDrivers(storage).find((driver) => driver.name === 'Alex Driver');
  deleteDriver(alex.id, storage);

  const buffer = await buildRouteWorkbook(loadState(storage));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.getWorksheet('12').getRow(2).getCell(2).value, 'Alex Driver');
  const drivers = workbook.getWorksheet('Drivers');
  const names = [];
  drivers.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    names.push(`${row.getCell(1).value || ''} ${row.getCell(2).value || ''}`.trim());
  });
  assert.deepEqual(names, ['Jordan Lee']);
});
