import assert from 'node:assert/strict';
import test from 'node:test';
import { ROUTE_DATA_FILE_BASE } from '../office-tracker/src/downloadName.js';
import {
  DEFAULT_ROUTE_BACKUP_REMINDER,
  fileBaseFromRouteBackupFilename,
  mergeRouteDataBackup,
  normalizeRouteBackupFileBase,
  normalizeRouteBackupFilename,
  normalizeRouteBackupReminder,
  normalizeRouteDataBackup,
  routeDataBackupReminderDue,
  suggestedRouteBackupFilename,
} from '../office-tracker/src/routeDataBackup.js';
import { importState, loadState, mergeSharedDriverList, saveState } from '../office-tracker/web/store.js';

function memoryStorage() {
  /** @type {Map<string, string>} */
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

test('route backup reminders default to off', () => {
  assert.equal(normalizeRouteBackupReminder(''), DEFAULT_ROUTE_BACKUP_REMINDER);
  assert.equal(normalizeRouteBackupReminder('nope'), 'off');
  assert.equal(normalizeRouteBackupReminder('WEEKLY'), 'weekly');
  assert.equal(normalizeRouteBackupReminder('off'), 'off');
  const prefs = normalizeRouteDataBackup(undefined);
  assert.equal(prefs.reminder, 'off');
  assert.equal(prefs.fileBase, ROUTE_DATA_FILE_BASE);
  assert.equal(prefs.lastDownloadedAt, '');
  assert.equal(prefs.lastFilename, '');
});

test('route backup file names stay safe and keep .xlsx', () => {
  assert.equal(normalizeRouteBackupFileBase(''), ROUTE_DATA_FILE_BASE);
  assert.equal(normalizeRouteBackupFileBase('My Backup.xlsx'), 'My Backup');
  assert.equal(normalizeRouteBackupFileBase('a/b:c*.xlsx'), 'a_b:c_');
  assert.match(normalizeRouteBackupFilename('Office Routes'), /\.xlsx$/i);
  assert.equal(normalizeRouteBackupFilename('keep.xlsx'), 'keep.xlsx');
  assert.equal(
    fileBaseFromRouteBackupFilename('Current_Route_Data_OCT15_14:25.xlsx'),
    'Current_Route_Data'
  );
  assert.equal(fileBaseFromRouteBackupFilename('OfficeCopy.xlsx'), 'OfficeCopy');
  const suggested = suggestedRouteBackupFilename('OfficeCopy', new Date(2026, 9, 29, 13, 5));
  assert.equal(suggested, 'OfficeCopy_OCT29_13:05.xlsx');
});

test('a missing download is due until the office saves one', () => {
  const now = new Date(2026, 9, 29, 12, 0, 0);
  assert.equal(routeDataBackupReminderDue({ reminder: 'daily' }, now), true);
  assert.equal(routeDataBackupReminderDue({ reminder: 'off' }, now), false);
  assert.equal(
    routeDataBackupReminderDue(
      { reminder: 'daily', lastDownloadedAt: new Date(2026, 9, 29, 8, 0, 0).toISOString() },
      now
    ),
    false
  );
  assert.equal(
    routeDataBackupReminderDue(
      { reminder: 'daily', lastDownloadedAt: new Date(2026, 9, 28, 23, 0, 0).toISOString() },
      now
    ),
    true
  );
});

test('weekly and monthly reminders use the chosen window', () => {
  const now = new Date(2026, 9, 29, 12, 0, 0);
  assert.equal(
    routeDataBackupReminderDue(
      { reminder: 'weekly', lastDownloadedAt: new Date(2026, 9, 22, 12, 0, 0).toISOString() },
      now
    ),
    true
  );
  assert.equal(
    routeDataBackupReminderDue(
      { reminder: 'weekly', lastDownloadedAt: new Date(2026, 9, 23, 12, 0, 0).toISOString() },
      now
    ),
    false
  );
  assert.equal(
    routeDataBackupReminderDue(
      { reminder: 'monthly', lastDownloadedAt: new Date(2026, 8, 30, 12, 0, 0).toISOString() },
      now
    ),
    true
  );
  assert.equal(
    routeDataBackupReminderDue(
      { reminder: 'monthly', lastDownloadedAt: new Date(2026, 9, 1, 8, 0, 0).toISOString() },
      now
    ),
    false
  );
});

test('the later download clears the shared route backup reminder', () => {
  const earlier = '2026-10-28T10:00:00.000Z';
  const later = '2026-10-29T10:00:00.000Z';
  assert.deepEqual(
    mergeRouteDataBackup(
      {
        reminder: 'weekly',
        fileBase: 'Remote',
        lastDownloadedAt: earlier,
        lastFilename: 'Remote.xlsx',
      },
      {
        reminder: 'daily',
        fileBase: 'Local',
        lastDownloadedAt: later,
        lastFilename: 'Local_OCT29_14:20.xlsx',
      }
    ),
    {
      reminder: 'daily',
      fileBase: 'Local',
      lastDownloadedAt: later,
      lastFilename: 'Local_OCT29_14:20.xlsx',
    }
  );
});

test('route backup settings round-trip through office storage', () => {
  const storage = memoryStorage();
  const state = loadState(storage);
  state.routeDataBackup = {
    reminder: 'weekly',
    fileBase: 'Office Routes',
    lastDownloadedAt: '2026-10-29T18:00:00.000Z',
    lastFilename: 'Office Routes_OCT29_14:20.xlsx',
  };
  saveState(state, storage);
  const loaded = loadState(storage);
  assert.deepEqual(loaded.routeDataBackup, {
    reminder: 'weekly',
    fileBase: 'Office Routes',
    lastDownloadedAt: '2026-10-29T18:00:00.000Z',
    lastFilename: 'Office Routes_OCT29_14:20.xlsx',
  });

  const remote = {
    version: 1,
    currentProfileId: null,
    profiles: {},
    punches: [],
    leaveRequests: [],
    clockPins: {},
    clockLockCode: '',
    clockReasonCodes: [],
    clockSubstituteDrivers: [],
    routeDataBackup: {
      reminder: 'monthly',
      fileBase: 'Remote',
      lastDownloadedAt: '2026-10-20T00:00:00.000Z',
    },
  };
  const merged = mergeSharedDriverList(remote, loaded);
  assert.equal(merged.routeDataBackup.reminder, 'weekly');
  assert.equal(merged.routeDataBackup.fileBase, 'Office Routes');
  assert.equal(merged.routeDataBackup.lastDownloadedAt, '2026-10-29T18:00:00.000Z');

  const json = JSON.stringify({
    profiles: { a: { id: 'a', name: '1' } },
    routeDataBackup: {
      reminder: 'off',
      fileBase: 'Imported',
      lastDownloadedAt: '2026-09-01T00:00:00.000Z',
    },
  });
  const imported = importState(json, memoryStorage());
  assert.equal(imported.routeDataBackup.reminder, 'off');
  assert.equal(imported.routeDataBackup.fileBase, 'Imported');
});
