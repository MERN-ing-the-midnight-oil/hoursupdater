import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backupRange,
  groupPunchesByDriver,
  mergePaperBackup,
  normalizeBackupHours,
  normalizePaperBackup,
  markPaperPagesPrinted,
  mergePaperPages,
  paperBackupCsv,
  paperBackupHtml,
  paperBackupReminderDue,
  paperBackupReminderText,
  paperPageSpan,
  paperPagesHtml,
  syncPaperPages,
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

test('the sheet is two columns of time and in or out, without notes or substitutes', () => {
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
  assert.match(html, /class="paper-columns"/);
  assert.equal(html.match(/class="paper-col"/g)?.length, 2);
  assert.match(html, /<h2>Ada Jones<\/h2>/);
  assert.match(html, /<h2>Ben Cole<\/h2>/);
  assert.match(html, /10\/12\/2026 6:02 AM/);
  assert.match(html, />In AM</);
  assert.match(html, />Out</);
  assert.doesNotMatch(html, /late bus|Weather|Pat Lee|Note|Substitute/);
  const left = html.indexOf('class="paper-col"');
  const right = html.indexOf('class="paper-col"', left + 1);
  const ada = html.indexOf('Ada Jones');
  const ben = html.indexOf('Ben Cole');
  assert.ok(left < ada && ada < right && right < ben);
});

test('a full page joins the queue newest first, and a short page stays open', () => {
  const punches = [0, 1, 2, 3, 4].map((hour) =>
    punch(`p${hour}`, hour % 2 ? 'Ben Cole' : 'Ada Jones', hour % 2 ? 'out' : 'in', new Date(2026, 9, 13, 8 + hour, 0, 0), {
      run: 'AM',
      note: 'skip',
    })
  );
  punches.push(punch('gone', 'Ada Jones', 'in', new Date(2026, 9, 13, 7, 0, 0), { removed: true }));
  const first = syncPaperPages(punches, [], { pageSize: 4 });
  assert.equal(first.pages.length, 1);
  assert.deepEqual(
    first.pages[0].rows.map((row) => row.id),
    ['p3', 'p2', 'p1', 'p0']
  );
  assert.equal(first.pages[0].printedAt, '');
  assert.deepEqual(
    first.open.map((row) => row.id),
    ['p4']
  );
  assert.doesNotMatch(JSON.stringify(first.pages[0].rows), /skip/);
  const again = syncPaperPages(punches, first.pages, { pageSize: 4 });
  assert.equal(again.pages.length, 1);
  assert.equal(again.pages[0].id, first.pages[0].id);
  const html = paperPagesHtml(
    [{ title: 'Page 1', rows: first.pages[0].rows }],
    { columnRows: 2 }
  );
  assert.match(html, /font-size:10pt/);
  assert.match(html, /<h1>Page 1<\/h1>/);
  assert.equal(paperPageSpan(first.pages[0].rows), '10/13/2026 11:00 AM – 10/13/2026 8:00 AM');
  const columns = [...html.matchAll(/<div class="paper-col">([\s\S]*?)<\/div>/g)].map((match) => match[1]);
  assert.match(columns[0], /11:00 AM[\s\S]*10:00 AM/);
  assert.match(columns[1], /9:00 AM[\s\S]*8:00 AM/);
  assert.match(html, /Ada Jones/);
  assert.match(html, />In AM</);
  assert.doesNotMatch(html, /skip/);
});

test('a reminder is due while pages are waiting to print', () => {
  const waiting = [{ id: 'page-a-b', sealedAt: '2026-10-13T15:00:00.000Z', printedAt: '', rows: [{ id: 'b', driver_name: 'Ada Jones', action: 'in', punched_at: '2026-10-13T15:00:00.000Z' }] }];
  assert.equal(paperBackupReminderDue({ reminders: true, pages: waiting }), true);
  assert.equal(paperBackupReminderDue({ reminders: false, pages: waiting }), false);
  assert.equal(
    paperBackupReminderDue({
      reminders: true,
      pages: markPaperPagesPrinted(waiting, ['page-a-b'], '2026-10-13T16:00:00.000Z'),
    }),
    false
  );
  assert.equal(paperBackupReminderText(1), '1 page of clock records is waiting to print.');
  assert.equal(paperBackupReminderText(2), '2 pages of clock records are waiting to print.');
  const merged = mergePaperPages(waiting, [
    { ...waiting[0], printedAt: '2026-10-13T16:00:00.000Z' },
  ]);
  assert.equal(merged[0].printedAt, '2026-10-13T16:00:00.000Z');
  assert.equal(merged[0].rows[0].driver_name, 'Ada Jones');
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
    { hours: 48, reminders: true, lastPrintedAt: '2026-10-11T12:00:00.000Z', pages: [] }
  );
  assert.equal(
    mergeSharedDriverList(remote, {
      ...localUnset,
      paperBackup: { hours: 48, reminders: true, lastPrintedAt: '2026-10-12T12:00:00.000Z' },
    }).paperBackup.lastPrintedAt,
    '2026-10-12T12:00:00.000Z'
  );
});
