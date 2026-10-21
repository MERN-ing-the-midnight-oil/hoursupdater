import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureExampleRoutes, isSampleOffice, migrateLegacyExampleOffice, seedDisneyOvertimeHours } from '../office-tracker/web/exampleRoutes.js';

test('renames the previous sample office to S routes and Star Trek drivers', () => {
  const migrated = migrateLegacyExampleOffice({
    version: 1,
    currentProfileId: 'route-12',
    exampleVersion: 0,
    profiles: {
      'route-12': {
        id: 'route-12',
        name: '12',
        driver_name: 'Priya Raman',
        changeLog: [
          {
            driver_name: 'Priya Raman',
            entered_by: 'Priya Raman',
            note: 'Jordan Hale — PM dismissal moved for a late activity',
          },
        ],
        assignments: [{ driver_name: 'Priya Raman', from: '2026-09-08', until: null }],
      },
      'route-47': { id: 'route-47', name: '47', driver_name: 'Marcus Ellison', changeLog: [] },
      'route-76': { id: 'route-76', name: '76', driver_name: 'Riley Cho', changeLog: [] },
      'route-88': { id: 'route-88', name: '88', driver_name: 'Elena Voss', changeLog: [] },
      'route-104': { id: 'route-104', name: '104', driver_name: 'Andre Cole', changeLog: [] },
      'route-118': { id: 'route-118', name: '118', driver_name: 'Samira Okonkwo', changeLog: [] },
      'route-209': { id: 'route-209', name: '209', driver_name: 'Chris Nguyen', changeLog: [] },
      'route-p32': { id: 'route-p32', name: 'P32', driver_name: 'Jordan Hale', changeLog: [] },
    },
    drivers: [{ id: 'driver-priya-raman', name: 'Priya Raman', phone: '617-555-0101', email: 'priya.raman@example.com' }],
  });
  assert.equal(migrated.profiles['route-12'].name, 'S1');
  assert.equal(migrated.profiles['route-12'].driver_name, 'Jean-Luc Picard');
  assert.equal(migrated.profiles['route-12'].assignments[0].driver_name, 'Jean-Luc Picard');
  assert.equal(
    migrated.profiles['route-12'].changeLog[0].note,
    'Deanna Troi — PM dismissal moved for a late activity'
  );
  assert.equal(migrated.profiles['route-76'].name, 'S8');
  assert.equal(migrated.profiles['route-76'].driver_name, 'Wesley Crusher');
  assert.equal(migrated.profiles['route-p32'].name, 'S6');
  assert.equal(migrated.drivers[0].name, 'Jean-Luc Picard');
  assert.equal(migrated.drivers[0].email, 'jean-luc.picard@example.com');
  assert.equal(migrateLegacyExampleOffice(migrated), null);
});

test('sample offices gain Disney weekend and evening clocks once', () => {
  const sample = {
    version: 1,
    exampleVersion: 4,
    currentProfileId: 'route-s1',
    profiles: { 'route-s1': { id: 'route-s1', name: 'S1', driver_name: 'Jean-Luc Picard' } },
    drivers: [{ id: 'driver-jean-luc-picard', name: 'Jean-Luc Picard' }],
    punches: [],
  };
  const seeded = seedDisneyOvertimeHours(sample);
  assert.equal(seeded.drivers.some((driver) => driver.name === 'Mickey Mouse'), true);
  assert.equal(seeded.drivers.some((driver) => driver.name === 'Goofy Goof'), true);
  assert.equal(seeded.punches.some((punch) => punch.id === 'disney-mickey-sat-in'), true);
  assert.equal(seeded.punches.some((punch) => punch.id === 'disney-pluto-fri-in'), true);
  assert.equal(seedDisneyOvertimeHours(seeded), seeded);
  const realOffice = { version: 1, exampleVersion: 0, profiles: { real: { name: '50' } }, drivers: [], punches: [] };
  assert.equal(seedDisneyOvertimeHours(realOffice), realOffice);

  const storage = {
    /** @type {Record<string, string>} */
    data: {},
    getItem(key) {
      return this.data[key] ?? null;
    },
    setItem(key, value) {
      this.data[key] = String(value);
    },
  };
  storage.setItem(
    'transportation-timechange.v1',
    JSON.stringify(sample)
  );
  const saved = ensureExampleRoutes(storage);
  assert.equal(saved.punches.some((punch) => String(punch.id).startsWith('disney-')), true);
});

test('the fictional office is a sample even after its route ids change', () => {
  assert.equal(isSampleOffice({ exampleVersion: 6, profiles: { 'new-id': { name: 'S1' } } }), true);
  assert.equal(isSampleOffice({ exampleVersion: 0, profiles: {} }), true);
  assert.equal(
    isSampleOffice({ exampleVersion: 0, profiles: { 'real-route': { name: '50' } } }),
    false
  );
});
