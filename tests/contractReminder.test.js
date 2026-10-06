import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContractReminderCalendar,
  combineRemindersByDay,
  dateSchoolDaysBefore,
  isPredictedContract,
  isReminderDue,
  normalizeContractReminder,
  planReminderPublish,
  prepareContractReminder,
  reminderDayFilename,
  reminderEventSignature,
} from '../office-tracker/src/contractReminder.js';
import {
  isContractEventCreated,
  loadContractReminder,
  loadReminderSignatures,
  rememberCreatedContractEvents,
  rememberPublishedReminders,
  saveContractReminder,
} from '../office-tracker/web/store.js';

const schoolDays = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'];

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

function predictedRow() {
  return {
    change_id: 'change-1',
    segment: 'PM',
    previous_time: '14:00-16:00',
    new_time: '14:20-16:20',
    note: 'Stop added',
    contracted: {
      status: 'predicted',
      becomes_on: '2026-10-06',
      projected_outcome_label: 'Automatically contracted',
    },
  };
}

function unfold(ics) {
  return ics.replace(/\r\n[ \t]/g, '');
}

test('missing reminder settings use 1 school day before the contract date', () => {
  const storage = memoryStorage();
  assert.equal(loadContractReminder(storage).schoolDaysBefore, 1);
  assert.equal(loadContractReminder(storage).autoCreate, true);
  assert.equal(normalizeContractReminder({ schoolDaysBefore: 0 }).schoolDaysBefore, 0);
  assert.equal(normalizeContractReminder({ autoCreate: 'no' }).autoCreate, false);
  assert.equal(isReminderDue('2026-10-05', '2026-10-05'), true);
  assert.equal(isReminderDue('2026-10-06', '2026-10-05'), false);
  const saved = saveContractReminder(
    {
      schoolDaysBefore: 3,
      invitees: [
        { email: 'ada@bps.org', name: 'Ada Lovelace' },
        { email: 'Ada@bps.org', name: 'Duplicate' },
        { email: 'not-an-email', name: 'Skip' },
        { email: 'grace@bps.org', name: 'Grace Hopper' },
      ],
      subject: '  Route {{route}}  ',
      body: 'See you {{reminder_date}}',
    },
    storage
  );
  assert.equal(saved.schoolDaysBefore, 3);
  assert.deepEqual(
    saved.invitees.map((item) => item.email),
    ['ada@bps.org', 'grace@bps.org']
  );
  assert.equal(loadContractReminder(storage).body, 'See you {{reminder_date}}');
});

test('the reminder lands on the previous school day by default', () => {
  const settings = normalizeContractReminder({});
  assert.equal(dateSchoolDaysBefore(schoolDays, '2026-10-06', settings.schoolDaysBefore), '2026-10-05');
  assert.equal(dateSchoolDaysBefore(schoolDays, '2026-10-06', 0), '2026-10-06');
  assert.equal(dateSchoolDaysBefore(schoolDays, '2026-10-06', 2), '2026-10-02');
  assert.throws(
    () => dateSchoolDaysBefore(schoolDays, '2026-10-02', 4),
    /does not go back 4 school days/
  );
});

test('a predicted contract becomes a one-minute free Outlook invite', () => {
  const settings = normalizeContractReminder({
    schoolDaysBefore: 1,
    invitees: [
      { email: 'ada@bps.org', name: 'Ada Lovelace' },
      { email: 'grace@bps.org', name: 'Grace Hopper' },
    ],
  });
  const row = predictedRow();
  assert.equal(isPredictedContract(row), true);
  assert.equal(isPredictedContract({ contracted: { status: 'became_contracted', becomes_on: '2026-10-06' } }), false);
  const event = combineRemindersByDay([
    prepareContractReminder({
      routeName: 'S5',
      driverName: 'Jean-Luc Picard',
      row,
      settings,
      calendar: schoolDays,
    }),
  ])[0];
  assert.equal(event.reminderDate, '2026-10-05');
  assert.equal(event.uid, 'contract-reminder-2026-10-05@teamster-time-changes');
  assert.match(event.subject, /Route S5 becomes contracted on Tue, Oct 6, 2026/);
  assert.match(event.body, /Jean-Luc Picard/);
  assert.match(event.body, /PM changed from 2:00 PM-4:00 PM to 2:20 PM-4:20 PM/);
  const ics = unfold(
    buildContractReminderCalendar({
      organizer: { email: 'pat@bps.org', name: 'Pat' },
      invitees: settings.invitees,
      events: [event],
      now: new Date('2026-10-02T15:00:00Z'),
    })
  );
  assert.match(ics, /METHOD:REQUEST/);
  assert.match(ics, /DTSTART:20261005T080000/);
  assert.match(ics, /DTEND:20261005T080100/);
  assert.match(ics, /TRANSP:TRANSPARENT/);
  assert.match(ics, /X-MICROSOFT-CDO-BUSYSTATUS:FREE/);
  assert.match(ics, /X-MICROSOFT-CDO-INTENDEDSTATUS:FREE/);
  assert.match(ics, /ORGANIZER;CN=Pat:mailto:pat@bps.org/);
  assert.match(ics, /mailto:ada@bps.org/);
  assert.match(ics, /mailto:grace@bps.org/);
  assert.equal(reminderDayFilename('2026-10-05'), 'contract-reminder-20261005.ics');
  assert.equal(prepareContractReminder({
    routeName: 'S5',
    row: { contracted: { status: 'superseded' } },
    settings,
    calendar: schoolDays,
  }), null);
});

test('routes that share a reminder day become one Outlook event', () => {
  const settings = normalizeContractReminder({ schoolDaysBefore: 1 });
  const first = prepareContractReminder({
    routeName: 'S9',
    driverName: 'Beverly Crusher',
    row: predictedRow(),
    settings,
    calendar: schoolDays,
  });
  const second = prepareContractReminder({
    routeName: 'S5',
    driverName: 'Jean-Luc Picard',
    row: { ...predictedRow(), change_id: 'change-2', segment: 'AM' },
    settings,
    calendar: schoolDays,
  });
  const later = prepareContractReminder({
    routeName: 'S1',
    driverName: 'William Riker',
    row: {
      ...predictedRow(),
      change_id: 'change-3',
      contracted: { ...predictedRow().contracted, becomes_on: '2026-10-07' },
    },
    settings,
    calendar: schoolDays,
  });
  const events = combineRemindersByDay([first, second, second, later]);
  assert.equal(events.length, 2);
  assert.equal(events[0].reminderDate, '2026-10-05');
  assert.deepEqual(events[0].changeIds, ['change-2', 'change-1']);
  assert.deepEqual(events[0].routes, ['S5', 'S9']);
  assert.match(events[0].subject, /Routes S5, S9/);
  assert.match(events[0].body, /Beverly Crusher/);
  assert.match(events[0].body, /Jean-Luc Picard/);
  assert.equal(events[0].uid, 'contract-reminder-2026-10-05@teamster-time-changes');
  assert.equal(events[1].reminderDate, '2026-10-06');
  assert.equal(events[1].uid, 'contract-reminder-2026-10-06@teamster-time-changes');
  const ics = unfold(
    buildContractReminderCalendar({
      organizer: { email: 'pat@bps.org', name: 'Pat' },
      invitees: [{ email: 'ada@bps.org', name: 'Ada' }],
      events: [events[0]],
      now: new Date('2026-10-02T15:00:00Z'),
    })
  );
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 1);
  assert.match(ics, /UID:contract-reminder-2026-10-05@teamster-time-changes/);
});

test('a predicted contract is published immediately and updated when the day or routes change', () => {
  const settings = normalizeContractReminder({ schoolDaysBefore: 1 });
  const first = prepareContractReminder({
    routeName: 'S5',
    driverName: 'Jean-Luc Picard',
    row: predictedRow(),
    settings,
    calendar: schoolDays,
  });
  const day = combineRemindersByDay([first]);
  const created = planReminderPublish(day, {}, {});
  assert.equal(created.length, 1);
  assert.equal(created[0].reminderDate, '2026-10-05');
  assert.equal(created[0].updated, false);
  const signature = `${reminderEventSignature(created[0])}\n`;
  const stored = { 'change-1': '2026-10-05' };
  const signatures = { '2026-10-05': signature };
  assert.equal(planReminderPublish(day, stored, signatures).length, 0);
  const rewritten = { ...day[0], body: 'Updated wording for the office.' };
  const reworded = planReminderPublish([rewritten], stored, signatures);
  assert.equal(reworded.length, 1);
  assert.equal(reworded[0].updated, true);
  assert.equal(reworded[0].body, 'Updated wording for the office.');

  const second = prepareContractReminder({
    routeName: 'S9',
    driverName: 'Beverly Crusher',
    row: { ...predictedRow(), change_id: 'change-2' },
    settings,
    calendar: schoolDays,
  });
  const withBoth = planReminderPublish(combineRemindersByDay([first, second]), stored, signatures);
  assert.equal(withBoth.length, 1);
  assert.equal(withBoth[0].updated, true);
  assert.deepEqual([...withBoth[0].changeIds].sort(), ['change-1', 'change-2']);

  const moved = prepareContractReminder({
    routeName: 'S5',
    driverName: 'Jean-Luc Picard',
    row: {
      ...predictedRow(),
      contracted: { ...predictedRow().contracted, becomes_on: '2026-10-07' },
    },
    settings,
    calendar: schoolDays,
  });
  const relocated = planReminderPublish(combineRemindersByDay([moved]), stored, signatures);
  assert.equal(relocated.length, 2);
  assert.equal(relocated[0].reminderDate, '2026-10-05');
  assert.equal(relocated[0].cancelled, true);
  assert.equal(relocated[1].reminderDate, '2026-10-06');
  assert.equal(relocated[1].updated, false);

  const storage = memoryStorage();
  rememberPublishedReminders(withBoth, '', storage);
  assert.equal(isContractEventCreated('change-1', storage), true);
  assert.equal(isContractEventCreated('change-2', storage), true);
  assert.equal(loadReminderSignatures(storage)['2026-10-05'], `${reminderEventSignature(withBoth[0])}\n`);
  rememberPublishedReminders(relocated, '', storage);
  assert.equal(isContractEventCreated('change-2', storage), false);
  assert.equal(loadContractReminder(storage) && isContractEventCreated('change-1', storage), true);
  const cancelIcs = unfold(
    buildContractReminderCalendar({
      organizer: { email: 'pat@bps.org', name: 'Pat' },
      invitees: [{ email: 'ada@bps.org', name: 'Ada' }],
      events: [relocated[0]],
      method: 'CANCEL',
      now: new Date('2026-10-02T15:00:00Z'),
    })
  );
  assert.match(cancelIcs, /METHOD:CANCEL/);
  assert.match(cancelIcs, /STATUS:CANCELLED/);
  assert.match(cancelIcs, /UID:contract-reminder-2026-10-05@teamster-time-changes/);
});

test('an event created badge remembers each change on that day', () => {
  const storage = memoryStorage();
  assert.equal(isContractEventCreated('change-1', storage), false);
  rememberCreatedContractEvents(
    [
      { changeId: 'change-1', reminderDate: '2026-10-05' },
      { changeId: 'change-2', reminderDate: '2026-10-05' },
    ],
    storage
  );
  assert.equal(isContractEventCreated('change-1', storage), true);
  assert.equal(isContractEventCreated('change-2', storage), true);
  saveContractReminder({ schoolDaysBefore: 2 }, storage);
  assert.equal(isContractEventCreated('change-1', storage), true);
  assert.equal(loadContractReminder(storage).schoolDaysBefore, 2);
});
