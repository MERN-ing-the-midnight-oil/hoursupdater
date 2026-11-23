import assert from 'node:assert/strict';
import test from 'node:test';
import { directoryEmail, TRANSPORTATION_STAFF } from '../office-tracker/src/staffDirectory.js';
import {
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

test('directory addresses are the ones published for transportation staff', () => {
  assert.equal(TRANSPORTATION_STAFF.length, 75);
  assert.equal(directoryEmail('David Smith'), 'david.smith@bellinghamschools.org');
  assert.equal(directoryEmail('  david   smith '), 'david.smith@bellinghamschools.org');
  assert.equal(directoryEmail('Johanna deVries'), 'johana.devries@bellinghamschools.org');
  assert.equal(directoryEmail('Charlie Lane'), 'Charles.Lane@bellinghamschools.org');
  assert.equal(directoryEmail('Nick Levin'), 'Nicholas.Levin@bellinghamschools.org');
  assert.equal(directoryEmail('Billa Inderjit'), 'Inderjit@bellinghamschools.org');
  assert.equal(directoryEmail('Matthew Peterson'), 'Matthew.A.Peterson@bellinghamschools.org');
  assert.equal(directoryEmail('Rae Anne Thon'), 'raeanne.thon@bellinghamschools.org');
  assert.equal(directoryEmail('Jean-Luc Picard'), '');
  for (const person of TRANSPORTATION_STAFF) {
    assert.match(person.email, /@bellinghamschools\.org$/);
    assert.equal(directoryEmail(person.name), person.email);
  }
});

test('saving a different address keeps the published staff address', () => {
  const storage = memoryStorage();
  saveDriver({ firstName: 'David', lastName: 'Smith', email: 'someone@gmail.com' }, storage);
  const david = listDrivers(storage).find((driver) => driver.name === 'David Smith');
  assert.equal(david.email, 'david.smith@bellinghamschools.org');

  saveDriver({
    id: david.id,
    firstName: 'David',
    lastName: 'Smith',
    previousName: 'David Smith',
    email: 'another@gmail.com',
  }, storage);

  assert.equal(
    listDrivers(storage).find((driver) => driver.name === 'David Smith').email,
    'david.smith@bellinghamschools.org'
  );
  const stored = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(
    stored.drivers.find((driver) => driver.name === 'David Smith').email,
    'david.smith@bellinghamschools.org'
  );
});

test('a stored personal address is replaced when the office is opened', () => {
  const storage = memoryStorage();
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      currentProfileId: null,
      profiles: {},
      drivers: [
        {
          id: 'driver-david-smith',
          name: 'David Smith',
          firstName: 'David',
          lastName: 'Smith',
          phone: '',
          email: 'someone@gmail.com',
        },
      ],
    })
  );

  assert.equal(loadState(storage).drivers[0].email, 'david.smith@bellinghamschools.org');
  assert.equal(
    listDrivers(storage).find((driver) => driver.name === 'David Smith').email,
    'david.smith@bellinghamschools.org'
  );
});

test('a driver who is not on the staff page keeps the saved address', () => {
  const storage = memoryStorage();
  saveDriver({ firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com' }, storage);
  assert.equal(listDrivers(storage)[0].email, 'jordan@example.com');
});

test('a route name from the staff page gets that published address', () => {
  const storage = memoryStorage();
  saveProfile(
    {
      id: 'route-12',
      name: '12',
      driver_name: 'David Smith',
      start_date: '2026-09-08',
      changeLog: [],
    },
    storage
  );

  assert.equal(
    listDrivers(storage).find((driver) => driver.name === 'David Smith').email,
    'david.smith@bellinghamschools.org'
  );
});

test('a shared office copy cannot replace a published staff address', () => {
  const merged = mergeSharedDriverList(
    {
      version: 1,
      profiles: {},
      drivers: [
        {
          id: 'driver-david-smith',
          name: 'David Smith',
          firstName: 'David',
          lastName: 'Smith',
          email: 'someone@gmail.com',
        },
      ],
    },
    {
      version: 1,
      profiles: {},
      drivers: [
        {
          id: 'driver-david-smith',
          name: 'David Smith',
          firstName: 'David',
          lastName: 'Smith',
          email: 'office@gmail.com',
        },
      ],
    }
  );

  assert.equal(merged.drivers[0].email, 'david.smith@bellinghamschools.org');
});
