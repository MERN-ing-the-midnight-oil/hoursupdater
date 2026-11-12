import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContractReminderCalendar,
  combineRemindersByDay,
  dateSchoolDaysBefore,
  isPredictedContract,
  isRecordedContractChange,
  isReminderDue,
  normalizeContractReminder,
  planReminderPublish,
  prepareContractReminder,
  reminderCancelFilename,
  reminderDayFilename,
  reminderEventSignature,
} from '../office-tracker/src/contractReminder.js';
import {
  forgetCreatedContractEvents,
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

function recordedItem(overrides = {}) {
  return {
    changeId: 'change-1',
    routeName: 'S5',
    driverName: 'Jean-Luc Picard',
    becomesOn: '2026-10-06',
    timesLabel: 'PM 2:20 PM-4:20 PM',
    times: { PM: '14:20-16:20' },
    reasonLabel: 'Office recorded contracted hours',
    accepted: true,
    ...overrides,
  };
}

function unfold(ics) {
  return ics.replace(/\r\n[ \t]/g, '');
}

test('missing reminder settings queue after Record and use 1 school day before', () => {
  const storage = memoryStorage();
  assert.equal(loadContractReminder(storage).schoolDaysBefore, 1);
  assert.equal(loadContractReminder(storage).queueAfterRecord, true);
  assert.equal(loadContractReminder(storage).askAfterRecord, true);
  assert.equal(loadContractReminder(storage).autoCreate, true);
  assert.equal(normalizeContractReminder({ schoolDaysBefore: 0 }).schoolDaysBefore, 0);
  assert.equal(normalizeContractReminder({ queueAfterRecord: 'no' }).queueAfterRecord, false);
  assert.equal(normalizeContractReminder({ askAfterRecord: 'no' }).queueAfterRecord, false);
  assert.equal(normalizeContractReminder({ autoCreate: 'no' }).queueAfterRecord, false);
  assert.equal(isReminderDue('2026-10-05', '2026-10-05'), true);
  assert.equal(isReminderDue('2026-10-06', '2026-10-05'), false);
  const saved = saveContractReminder(
    {
      schoolDaysBefore: 3,
      queueAfterRecord: false,
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
  assert.equal(saved.queueAfterRecord, false);
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

test('Add schedules a recorded contract change even before the reminder day', () => {
  const settings = normalizeContractReminder({
    schoolDaysBefore: 1,
    invitees: [
      { email: 'ada@bps.org', name: 'Ada Lovelace' },
      { email: 'grace@bps.org', name: 'Grace Hopper' },
    ],
  });
  const item = recordedItem();
  assert.equal(isRecordedContractChange(item), true);
  assert.equal(isRecordedContractChange({ ...item, accepted: false }), false);
  assert.equal(isPredictedContract({ contracted: { status: 'predicted', becomes_on: '2026-10-06' } }), true);
  assert.equal(
    prepareContractReminder({
      routeName: 'S5',
      driverName: 'Jean-Luc Picard',
      row: { change_id: 'change-1', contracted: { status: 'predicted', becomes_on: '2026-10-06' } },
      settings,
      calendar: schoolDays,
    }),
    null
  );
  const early = prepareContractReminder({
    item,
    settings,
    calendar: schoolDays,
    asOf: '2026-10-02',
  });
  assert.equal(early.reminderDate, '2026-10-05');
  assert.equal(
    prepareContractReminder({
      item,
      settings,
      calendar: schoolDays,
      asOf: '2026-10-02',
      requireDue: true,
    }),
    null
  );
  const event = combineRemindersByDay([early])[0];
  assert.equal(event.reminderDate, '2026-10-05');
  assert.equal(event.uid, 'contract-reminder-2026-10-05@teamster-time-changes');
  assert.match(event.subject, /Recorded contract hours · Route S5 effective Tue, Oct 6, 2026/);
  assert.match(event.body, /Jean-Luc Picard/);
  assert.match(event.body, /New contracted hours: PM 2:20 PM-4:20 PM/);
  assert.match(event.body, /District Payroll/);
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
  assert.match(ics, /ORGANIZER;CN=Pat:mailto:pat@bps.org/);
  assert.match(ics, /mailto:ada@bps.org/);
  assert.equal(reminderDayFilename('2026-10-05'), 'contract-reminder-20261005.ics');
  assert.equal(reminderCancelFilename('2026-10-05'), 'contract-reminder-cancel-20261005.ics');
});

test('routes that share a reminder day become one Outlook event', () => {
  const settings = normalizeContractReminder({ schoolDaysBefore: 1 });
  const first = prepareContractReminder({
    routeName: 'S9',
    driverName: 'Beverly Crusher',
    item: recordedItem({ changeId: 'change-1', routeName: 'S9', driverName: 'Beverly Crusher' }),
    settings,
    calendar: schoolDays,
  });
  const second = prepareContractReminder({
    routeName: 'S5',
    driverName: 'Jean-Luc Picard',
    item: recordedItem({ changeId: 'change-2', routeName: 'S5' }),
    settings,
    calendar: schoolDays,
  });
  const later = prepareContractReminder({
    routeName: 'S1',
    driverName: 'William Riker',
    item: recordedItem({
      changeId: 'change-3',
      routeName: 'S1',
      driverName: 'William Riker',
      becomesOn: '2026-10-07',
    }),
    settings,
    calendar: schoolDays,
  });
  const events = combineRemindersByDay([first, second, second, later]);
  assert.equal(events.length, 2);
  assert.equal(events[0].reminderDate, '2026-10-05');
  assert.deepEqual(events[0].changeIds, ['change-2', 'change-1']);
  assert.deepEqual(events[0].routes, ['S5', 'S9']);
  assert.match(events[0].subject, /Routes S5, S9/);
  assert.equal(events[1].reminderDate, '2026-10-06');
});

test('publishing updates the Added set and can cancel a day', () => {
  const settings = normalizeContractReminder({ schoolDaysBefore: 1 });
  const first = prepareContractReminder({
    routeName: 'S5',
    driverName: 'Jean-Luc Picard',
    item: recordedItem(),
    settings,
    calendar: schoolDays,
  });
  const day = combineRemindersByDay([first]);
  const created = planReminderPublish(day, {}, {});
  assert.equal(created.length, 1);
  assert.equal(created[0].reminderDate, '2026-10-05');
  const signature = `${reminderEventSignature(created[0])}\n`;
  const stored = { 'change-1': '2026-10-05' };
  const signatures = { '2026-10-05': signature };
  assert.equal(planReminderPublish(day, stored, signatures).length, 0);

  const second = prepareContractReminder({
    routeName: 'S9',
    driverName: 'Beverly Crusher',
    item: recordedItem({ changeId: 'change-2', routeName: 'S9', driverName: 'Beverly Crusher' }),
    settings,
    calendar: schoolDays,
  });
  const withBoth = planReminderPublish(combineRemindersByDay([first, second]), stored, signatures);
  assert.equal(withBoth.length, 1);
  assert.deepEqual([...withBoth[0].changeIds].sort(), ['change-1', 'change-2']);

  const storage = memoryStorage();
  rememberPublishedReminders(withBoth, '', storage);
  assert.equal(isContractEventCreated('change-1', storage), true);
  assert.equal(isContractEventCreated('change-2', storage), true);
  forgetCreatedContractEvents(['change-2'], storage);
  assert.equal(isContractEventCreated('change-2', storage), false);
  assert.equal(isContractEventCreated('change-1', storage), true);
  assert.equal(loadReminderSignatures(storage)['2026-10-05'], `${reminderEventSignature(withBoth[0])}\n`);

  const cancelled = planReminderPublish([], { 'change-1': '2026-10-05' }, signatures);
  assert.equal(cancelled[0].cancelled, true);
  const cancelIcs = unfold(
    buildContractReminderCalendar({
      organizer: { email: 'pat@bps.org', name: 'Pat' },
      invitees: [{ email: 'ada@bps.org', name: 'Ada' }],
      events: [cancelled[0]],
      method: 'CANCEL',
      now: new Date('2026-10-02T15:00:00Z'),
    })
  );
  assert.match(cancelIcs, /METHOD:CANCEL/);
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
  saveContractReminder({ schoolDaysBefore: 2, queueAfterRecord: false }, storage);
  assert.equal(isContractEventCreated('change-1', storage), true);
  assert.equal(loadContractReminder(storage).schoolDaysBefore, 2);
  assert.equal(loadContractReminder(storage).queueAfterRecord, false);
});
