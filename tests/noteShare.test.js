import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createNoteShare, noteDayUrl, noteShareUrl, noteSlotLabel } from '../office-tracker/src/noteShare.js';

const catalog = [
  { id: 'reason-bus-wash', label: 'Bus Wash' },
  { id: 'reason-traffic', label: 'Traffic' },
];

function openAmIn(share, extra = {}) {
  return share.open({
    driverName: 'Aaron Hakeman',
    run: 'AM',
    action: 'in',
    date: '2026-10-15',
    note: '',
    reasons: [],
    catalog,
    ...extra,
  });
}

describe('phone notes for one clock-card row', () => {
  it('builds a link that opens that notes page and names the row', () => {
    assert.equal(noteSlotLabel('AM', 'in'), 'AM IN');
    assert.equal(noteSlotLabel('MIDDAY', 'out'), 'MID OUT');
    assert.equal(noteSlotLabel('OTHER', 'nope'), '');
    assert.equal(
      noteShareUrl('http://192.168.1.20:3849/', 'abc'),
      'http://192.168.1.20:3849/driver-note.html?t=abc'
    );
    assert.equal(noteShareUrl('', 'abc'), '');
    assert.equal(
      noteDayUrl('http://192.168.1.20:3849/', 'day'),
      'http://192.168.1.20:3849/driver-note.html?d=day'
    );
    assert.equal(noteDayUrl('', 'day'), '');
  });

  it('keeps one link for a row and lets a phone change the note and reasons', () => {
    let issued = 0;
    const share = createNoteShare({ token: () => `token-${++issued}` });
    const opened = openAmIn(share, { note: 'Left the yard late.' });
    assert.equal(opened.label, 'AM IN');
    assert.equal(opened.note, 'Left the yard late.');
    assert.equal(opened.revision, 1);
    const again = openAmIn(share, { note: 'This should not replace the saved note.' });
    assert.equal(again.token, opened.token);
    assert.equal(again.note, 'Left the yard late.');
    assert.equal(again.revision, 1);

    const saved = share.save(opened.token, {
      revision: 1,
      note: 'Waited at the school.',
      reasons: [{ id: 'reason-bus-wash', label: 'Wrong label', minutes: 20 }],
      action: 'out',
      punched_at: '2026-10-15T14:00:00.000Z',
    });
    assert.equal(saved.conflict, false);
    assert.equal(saved.slot.note, 'Waited at the school.');
    assert.equal(saved.slot.action, 'in');
    assert.equal(saved.slot.reasons[0].label, 'Bus Wash');
    assert.equal(saved.slot.reasons[0].minutes, 20);
    assert.equal(saved.slot.punched_at, undefined);
    assert.equal(share.read(opened.token).revision, 2);
  });

  it('refuses a stale save, a punch-sized minute count, and a reason that is not on the list', () => {
    const share = createNoteShare({ token: () => 'token-1' });
    const opened = openAmIn(share);
    const stale = share.save(opened.token, { revision: 0, note: 'Nope', reasons: [] });
    assert.equal(stale.conflict, true);
    assert.equal(stale.slot.note, '');
    assert.throws(
      () => share.save(opened.token, { revision: 1, note: 'Ok', reasons: [{ id: 'reason-bus-wash', minutes: 1441 }] }),
      /1440/
    );
    assert.throws(
      () => share.save(opened.token, { revision: 1, note: 'Ok', reasons: [{ id: 'made-up', minutes: 10 }] }),
      /reason/i
    );
    assert.equal(share.read('missing'), null);
  });

  it('stops accepting changes after the pay period ends', () => {
    const until = Date.parse('2026-10-15T17:00:59.999Z');
    let clock = until - 60 * 1000;
    const share = createNoteShare({ now: () => clock, token: () => 'token-1' });
    const opened = openAmIn(share, { editableUntil: new Date(until).toISOString() });
    assert.equal(opened.closed, false);
    clock = until + 1;
    assert.equal(share.read(opened.token).closed, true);
    assert.throws(
      () => share.save(opened.token, { revision: 1, note: 'Too late', reasons: [] }),
      /pay period is closed/
    );
    assert.equal(share.read(opened.token).note, '');
  });
});

describe('one phone link for the punched rows of a day', () => {
  it('lists the punches the clock sends and lets a phone edit one of them', () => {
    let issued = 0;
    const share = createNoteShare({ token: () => `token-${++issued}` });
    const day = share.openDay({
      driverName: 'Aaron Hakeman',
      date: '2026-10-15',
      catalog,
      rows: [
        { run: 'AM', action: 'in', clock: '6:07 AM', note: 'Left late.', reasons: [] },
        { run: 'nope', action: 'in', clock: 'not a punch' },
      ],
    });
    assert.equal(day.rows.length, 1);
    assert.equal(day.rows[0].label, 'AM IN');
    assert.equal(day.rows[0].clock, '6:07 AM');
    assert.equal(day.rows[0].note, 'Left late.');

    const again = share.openDay({
      driverName: 'Aaron Hakeman',
      date: '2026-10-15',
      catalog,
      rows: [
        { run: 'AM', action: 'in', clock: '6:07 AM', note: 'This should not replace the saved note.', reasons: [] },
        { run: 'PM', action: 'out', clock: '3:12 PM', note: '', reasons: [{ id: 'reason-bus-wash', minutes: 20 }] },
      ],
    });
    assert.equal(again.token, day.token);
    assert.deepEqual(
      again.rows.map((row) => row.label),
      ['AM IN', 'PM OUT']
    );
    assert.equal(again.rows[0].note, 'Left late.');
    assert.equal(again.rows[1].reasons[0].label, 'Bus Wash');

    const saved = share.save(again.rows[0].token, {
      revision: again.rows[0].revision,
      note: 'Waited at the yard.',
      reasons: [],
      action: 'out',
      clock: '9:00 PM',
    });
    assert.equal(saved.conflict, false);
    assert.equal(saved.slot.action, 'in');
    const fresh = share.readDay(day.token);
    assert.equal(fresh.rows[0].note, 'Waited at the yard.');
    assert.equal(fresh.rows[0].clock, '6:07 AM');

    const none = share.openDay({
      driverName: 'Aaron Hakeman',
      date: '2026-10-15',
      rows: [],
    });
    assert.equal(none.token, day.token);
    assert.equal(none.rows.length, 0);
  });

  it('stops accepting changes after the pay period ends', () => {
    const until = Date.parse('2026-10-15T17:00:59.999Z');
    let clock = until - 60 * 1000;
    let issued = 0;
    const share = createNoteShare({ now: () => clock, token: () => `token-${++issued}` });
    const day = share.openDay({
      driverName: 'Aaron Hakeman',
      date: '2026-10-15',
      editableUntil: new Date(until).toISOString(),
      catalog,
      rows: [{ run: 'AM', action: 'in', clock: '6:07 AM', note: '', reasons: [] }],
    });
    assert.equal(day.closed, false);
    clock = until + 1;
    assert.equal(share.readDay(day.token).closed, true);
    assert.throws(
      () => share.save(day.rows[0].token, { revision: 1, note: 'Too late', reasons: [] }),
      /pay period is closed/
    );
  });
});
