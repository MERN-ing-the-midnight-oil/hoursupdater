import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backupRange,
  groupPunchesByDriver,
  mergePaperBackup,
  normalizeBackupHours,
  normalizePaperBackup,
  paperBackupCsv,
  paperBackupHtml,
  paperBackupReminderDue,
  paperBackupReminderText,
  punchesInRange,
  yearToDateFilename,
  yearToDateRange,
} from '../office-tracker/src/paperClockBackup.js';
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

function punch(id, name, action, at, extra = {}) {
  return {
    id,
    driver_name: name,
    action,
    punched_at: at.toISOString(),
    note: '',
    reason_codes: [],
    ...extra,
  };
}

test('the paper backup starts at 24 hours with reminders on', () => {
  assert.equal(normalizeBackupHours(''), 24);
  assert.equal(normalizeBackupHours('nope'), 24);
  assert.equal(normalizeBackupHours(0), 1);
  assert.equal(normalizeBackupHours(24.4), 24);
  assert.equal(normalizeBackupHours(9000), 744);
  const prefs = normalizePaperBackup(undefined);
  assert.equal(prefs.hours, 24);
  assert.equal(prefs.reminders, true);
  assert.equal(prefs.lastPrintedAt, '');
  assert.equal(normalizePaperBackup({ hours: 12, reminders: false }).reminders, false);
});

test('the print window keeps clock ins and clock outs from the last 24 hours', () => {
  const now = new Date(2026, 9, 12, 12, 0, 0);
  const range = backupRange(now, 24);
  assert.equal(range.start.getTime(), new Date(2026, 9, 11, 12, 0, 0).getTime());
  const punches = [
    punch('edge', 'Ada Jones', 'in', new Date(2026, 9, 11, 12, 0, 0)),
    punch('inside', 'Ada Jones', 'out', new Date(2026, 9, 12, 8, 5, 0)),
    punch('old', 'Ada Jones', 'in', new Date(2026, 9, 11, 11, 59, 0)),
    punch('gone', 'Ada Jones', 'out', new Date(2026, 9, 12, 9, 0, 0), { removed: true }),
  ];
  const kept = punchesInRange(punches, range.start, range.end);
  assert.deepEqual(
    kept.map((item) => item.id),
    ['edge', 'inside']
  );
});

test('clock records group under each driver name', () => {
  const groups = groupPunchesByDriver([
    punch('b2', 'Ben Cole', 'out', new Date(2026, 9, 12, 9, 0, 0)),
    punch('a2', 'ada jones', 'out', new Date(2026, 9, 12, 10, 0, 0)),
    punch('a1', 'Ada Jones', 'in', new Date(2026, 9, 12, 6, 2, 0)),
    punch('b1', 'Ben Cole', 'in', new Date(2026, 9, 12, 6, 15, 0)),
  ]);
  assert.deepEqual(
    groups.map((group) => group.name),
    ['Ada Jones', 'Ben Cole']
  );
  assert.deepEqual(
    groups[0].punches.map((item) => item.id),
    ['a1', 'a2']
  );
});

test('the sheet is 10-point type and lists each driver once', () => {
  const start = new Date(2026, 9, 11, 12, 0, 0);
  const end = new Date(2026, 9, 12, 12, 0, 0);
  const groups = groupPunchesByDriver([
    punch('a', 'Ada Jones', 'in', new Date(2026, 9, 12, 6, 2, 0), {
      run: 'AM',
      note: 'late bus',
      reason_codes: [{ id: 'w', label: 'Weather' }],
    }),
    punch('b', 'Ben Cole', 'out', new Date(2026, 9, 12, 9, 0, 0), { substitute_name: 'Pat Lee' }),
  ]);
  const html = paperBackupHtml(groups, { hours: 24, start, end });
  assert.match(html, /font-size:10pt/);
  assert.match(html, /<h1>Paper clock backup<\/h1>/);
  assert.match(html, /Last 24 hours/);
  assert.match(html, /<th colspan="4">Ada Jones<\/th>/);
  assert.match(html, /<th colspan="4">Ben Cole<\/th>/);
  assert.match(html, /10\/12\/2026 6:02 AM/);
  assert.match(html, />In</);
  assert.match(html, />AM</);
  assert.match(html, /late bus · Weather/);
  assert.match(html, /Sub Pat Lee/);
  const ada = html.indexOf('Ada Jones');
  const ben = html.indexOf('Ben Cole');
  const adaTime = html.indexOf('6:02 AM');
  const benTime = html.indexOf('9:00 AM');
  assert.ok(ada < adaTime && adaTime < ben && ben < benTime);
});

test('a reminder is due 24 hours after the last paper backup', () => {
  const now = new Date(2026, 9, 12, 12, 0, 0);
  const punches = [punch('old', 'Ada Jones', 'in', new Date(2026, 9, 1, 8, 0, 0))];
  assert.equal(
    paperBackupReminderDue({
      reminders: true,
      lastPrintedAt: new Date(2026, 9, 11, 12, 0, 0).toISOString(),
      hours: 24,
      punches,
      now,
    }),
    true
  );
  assert.equal(
    paperBackupReminderDue({
      reminders: true,
      lastPrintedAt: new Date(2026, 9, 11, 12, 1, 0).toISOString(),
      hours: 24,
      punches,
      now,
    }),
    false
  );
  assert.equal(
    paperBackupReminderDue({
      reminders: false,
      lastPrintedAt: '',
      hours: 24,
      punches,
      now,
    }),
    false
  );
  assert.equal(
    paperBackupReminderDue({
      reminders: true,
      lastPrintedAt: '',
      hours: 24,
      punches: [punch('new', 'Ada Jones', 'in', new Date(2026, 9, 12, 8, 0, 0))],
      now,
    }),
    false
  );
  assert.equal(
    paperBackupReminderDue({ reminders: true, lastPrintedAt: '', hours: 24, punches: [], now }),
    false
  );
  assert.match(paperBackupReminderText({ hours: 24, lastPrintedAt: '2026-10-11T19:00:00.000Z' }), /more than 24 hours/);
  assert.match(paperBackupReminderText({ hours: 24, lastPrintedAt: '' }), /last 24 hours/);
});

test('year-to-date download starts on January 1 and groups drivers', () => {
  const now = new Date(2026, 9, 12, 15, 0, 0);
  const range = yearToDateRange(now);
  assert.equal(range.start.getTime(), new Date(2026, 0, 1).getTime());
  const punches = [
    punch('old', 'Ben Cole', 'in', new Date(2025, 11, 31, 18, 0, 0)),
    punch('new', 'Ada Jones', 'out', new Date(2026, 0, 1, 0, 0, 0), { note: 'say "hi", then go' }),
    punch('mid', 'Ben Cole', 'in', new Date(2026, 5, 2, 7, 30, 0)),
  ];
  const groups = groupPunchesByDriver(punchesInRange(punches, range.start, range.end));
  const csv = paperBackupCsv(groups);
  assert.equal(yearToDateFilename(now), 'Clock records 2026 year-to-date.csv');
  assert.match(csv, /^Driver,Date,Time,Kind,Run,Note,Reason codes,Substitute\r\n/);
  assert.match(csv, /Ada Jones,1\/1\/2026,12:00 AM,Clock out/);
  assert.match(csv, /"say ""hi"", then go"/);
  assert.doesNotMatch(csv, /12\/31\/2025/);
  const ada = csv.indexOf('Ada Jones');
  const ben = csv.indexOf('Ben Cole');
  assert.ok(ada !== -1 && ben !== -1 && ada < ben);
});

test('saved backup settings survive a reload, and the later print time is kept', () => {
  const storage = memoryStorage();
  saveState(
    {
      version: 1,
      currentProfileId: null,
      profiles: { route: { id: 'route', name: '1' } },
      punches: [],
      paperBackup: { hours: 36, reminders: false, lastPrintedAt: '2026-10-01T00:00:00.000Z' },
    },
    storage
  );
  const loaded = loadState(storage);
  assert.equal(loaded.paperBackup.hours, 36);
  assert.equal(loaded.paperBackup.reminders, false);
  assert.equal(loaded.paperBackup.lastPrintedAt, '2026-10-01T00:00:00.000Z');

  const imported = importState(
    JSON.stringify({
      version: 1,
      profiles: { route: { id: 'route', name: '1' } },
      paperBackup: { hours: '48', reminders: 'false', lastPrintedAt: 'not-a-date' },
    }),
    storage
  );
  assert.equal(imported.paperBackup.hours, 48);
  assert.equal(imported.paperBackup.reminders, false);
  assert.equal(imported.paperBackup.lastPrintedAt, '');

  const remote = {
    version: 1,
    profiles: {},
    paperBackup: { hours: 12, reminders: false, lastPrintedAt: '2026-10-11T12:00:00.000Z' },
  };
  const localUnset = { version: 1, profiles: {} };
  assert.equal(mergeSharedDriverList(remote, localUnset).paperBackup.hours, 12);
  assert.deepEqual(
    mergePaperBackup(remote.paperBackup, { hours: 48, reminders: true, lastPrintedAt: '2026-10-10T12:00:00.000Z' }),
    { hours: 48, reminders: true, lastPrintedAt: '2026-10-11T12:00:00.000Z' }
  );
  assert.equal(
    mergeSharedDriverList(remote, {
      ...localUnset,
      paperBackup: { hours: 48, reminders: true, lastPrintedAt: '2026-10-12T12:00:00.000Z' },
    }).paperBackup.lastPrintedAt,
    '2026-10-12T12:00:00.000Z'
  );
});
