import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addOfficePunch,
  changeOfficePunch,
  normalizeOfficeEdits,
  officeEditor,
  removeOfficePunch,
} from '../office-tracker/src/officePunches.js';
import { pairClockPunches } from '../src/logic/timesheets.js';
import { loadState, mergeSharedDriverList, saveState } from '../office-tracker/web/store.js';

const at = '2026-10-11T18:04:00.000Z';
const rachel = { id: 'user-1', name: 'Rachel Smith' };

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

const base = {
  driver_name: 'Alex Driver',
  action: 'in',
  punched_at: '2026-10-09T14:00:00.000Z',
  recordNote: ' Student wait ',
  account: rachel,
  note: '  Forgot the morning punch  ',
  at,
};

test('an office add, change, or removal requires a note and records the admin', () => {
  assert.deepEqual(officeEditor(rachel, 'Someone Else'), {
    by: 'Rachel Smith',
    by_user_id: 'user-1',
  });
  assert.throws(() => officeEditor(null, '   '), /Enter your name/);
  assert.deepEqual(officeEditor(null, ' Pat Lee '), { by: 'Pat Lee', by_user_id: null });

  assert.throws(() => addOfficePunch([], { ...base, note: '   ' }), /Leave a note/);
  assert.throws(() => addOfficePunch([], { ...base, account: null, typedName: '' }), /Enter your name/);

  const added = addOfficePunch([], { ...base, id: 'punch-1' });
  assert.equal(added[0].note, 'Student wait');
  assert.equal(added[0].office_edits[0].action, 'add');
  assert.equal(added[0].office_edits[0].by, 'Rachel Smith');
  assert.equal(added[0].office_edits[0].by_user_id, 'user-1');
  assert.equal(added[0].office_edits[0].note, 'Forgot the morning punch');
  assert.equal(Object.prototype.hasOwnProperty.call(added[0], 'removed'), false);

  const changed = changeOfficePunch(added, 'punch-1', {
    action: 'out',
    punched_at: '2026-10-09T18:30:00.000Z',
    recordNote: 'Left early',
    account: { id: 'user-2', name: 'Sam Office' },
    note: 'Driver called from the yard',
    at: '2026-10-11T19:00:00.000Z',
  });
  assert.equal(changed[0].action, 'out');
  assert.equal(changed[0].note, 'Left early');
  assert.equal(changed[0].office_edits[1].action, 'change');
  assert.equal(changed[0].office_edits[1].by, 'Sam Office');
  assert.equal(changed[0].office_edits[0].by, 'Rachel Smith');

  const removed = removeOfficePunch(changed, 'punch-1', {
    account: rachel,
    note: 'Entered on the wrong driver',
    at: '2026-10-11T20:00:00.000Z',
  });
  assert.equal(removed.length, 1);
  assert.equal(removed[0].removed, true);
  assert.equal(removed[0].office_edits.at(-1).action, 'delete');
  assert.equal(removed[0].office_edits.at(-1).by, 'Rachel Smith');
  assert.throws(
    () => removeOfficePunch(removed, 'punch-1', { account: rachel, note: 'Again', at }),
    /already removed/
  );
  assert.throws(() => changeOfficePunch(removed, 'punch-1', { ...base, note: 'Nope' }), /already removed/);
});

test('a change keeps the route, substitute, and earlier office notes', () => {
  const added = addOfficePunch(
    [],
    {
      ...base,
      id: 'punch-sub',
    }
  );
  added[0].run = 'PM';
  added[0].substitute_name = 'Pat Lee';
  const changed = changeOfficePunch(added, 'punch-sub', {
    ...base,
    action: 'in',
    note: 'Time was wrong',
    at: '2026-10-11T21:00:00.000Z',
  });
  assert.equal(changed[0].run, 'PM');
  assert.equal(changed[0].substitute_name, 'Pat Lee');
  assert.equal(changed[0].office_edits.length, 2);
});

test('a removed clock does not pair, and the office note stays on the saved record', () => {
  const { pairs } = pairClockPunches([
    {
      id: 'in',
      action: 'in',
      punched_at: '2026-10-09T13:00:00.000Z',
    },
    {
      id: 'gone',
      action: 'in',
      removed: true,
      punched_at: '2026-10-09T14:00:00.000Z',
    },
    {
      id: 'out',
      action: 'out',
      punched_at: '2026-10-09T16:00:00.000Z',
    },
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].clockIn.id, 'in');
  assert.equal(pairs[0].clockOut.id, 'out');

  const storage = memoryStorage();
  const state = loadState(storage);
  state.profiles = { 'route-12': { id: 'route-12', name: '12' } };
  state.punches = removeOfficePunch(
    addOfficePunch([], { ...base, id: 'punch-keep' }),
    'punch-keep',
    { account: rachel, note: 'Duplicate', at: '2026-10-11T22:00:00.000Z' }
  );
  saveState(state, storage);
  const loaded = loadState(storage).punches[0];
  assert.equal(loaded.removed, true);
  assert.deepEqual(
    loaded.office_edits.map((edit) => edit.action),
    ['add', 'delete']
  );
  assert.equal(loaded.office_edits[1].note, 'Duplicate');
  assert.deepEqual(normalizeOfficeEdits([{ action: 'add', note: '', by: 'Rachel', at }]), []);

  const remote = {
    version: 1,
    profiles: state.profiles,
    punches: [{ ...base, id: 'punch-keep', action: 'in', punched_at: base.punched_at, note: '' }],
  };
  const merged = mergeSharedDriverList(remote, loadState(storage));
  assert.equal(merged.punches.find((punch) => punch.id === 'punch-keep').removed, true);
});
