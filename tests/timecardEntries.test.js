import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimecardEntries } from '../office-tracker/src/officePunches.js';
import {
  formatTimecardMinutes,
  normalizeTimecardEntries,
  reasonNoteLine,
  payPeriodStillOpen,
  sessionForClockOut,
  timecardEntryError,
} from '../office-tracker/src/timecardEntries.js';
import { loadState, saveState } from '../office-tracker/web/store.js';

const catalog = [
  { id: 'reason-traffic', label: 'Traffic/Construction/Accident' },
  { id: 'reason-bus-wash', label: 'Bus Wash' },
];

const punches = [
  {
    id: 'in',
    driver_name: 'Alex Driver',
    action: 'in',
    punched_at: '2026-10-09T15:00:00.000Z',
  },
  {
    id: 'out',
    driver_name: 'Alex Driver',
    action: 'out',
    punched_at: '2026-10-09T17:00:00.000Z',
  },
];

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

test('a clock-out keeps timecard times that fit inside the session', () => {
  const session = sessionForClockOut(punches, 'out');
  assert.equal(session.minutes, 120);
  assert.equal(
    timecardEntryError(
      [
        { id: 'reason-traffic', minutes: 20, comment: 'Columbia' },
        { id: 'reason-bus-wash', minutes: 100, comment: '' },
      ],
      session.minutes,
      catalog
    ),
    ''
  );
  assert.match(
    timecardEntryError(
      [
        { id: 'reason-traffic', minutes: 80 },
        { id: 'reason-bus-wash', minutes: 50 },
      ],
      session.minutes,
      catalog
    ),
    /more than this clock session/
  );

  const saved = setTimecardEntries(punches, 'out', {
    entries: [{ id: 'reason-traffic', minutes: 20, comment: ' Columbia ' }],
    catalog,
    periods: [
      { id: '1', startDay: 1, endDay: 15 },
      { id: '2', startDay: 16, endDay: 31 },
    ],
    now: new Date(2026, 9, 10, 12, 0),
  });
  assert.deepEqual(saved[1].timecard_entries, [
    { id: 'reason-traffic', label: 'Traffic/Construction/Accident', minutes: 20, comment: 'Columbia' },
  ]);
  assert.equal(formatTimecardMinutes(20), '20 minutes');
  assert.equal(formatTimecardMinutes(75), '1 hour 15 minutes');

  const cleared = setTimecardEntries(saved, 'out', {
    entries: [],
    catalog,
    periods: [{ id: '1', startDay: 1, endDay: 15 }],
    now: new Date(2026, 9, 10, 12, 0),
  });
  assert.equal(cleared[1].timecard_entries, undefined);
});

test('a driver cannot change codes after the pay period ends, and the office can', () => {
  const periods = [
    { id: '1', startDay: 1, endDay: 15 },
    { id: '2', startDay: 16, endDay: 31 },
  ];
  const clockOut = new Date(2026, 9, 9, 10, 0);
  assert.equal(payPeriodStillOpen(clockOut, periods, new Date(2026, 9, 15, 23, 0)), true);
  assert.equal(payPeriodStillOpen(clockOut, periods, new Date(2026, 9, 16, 0, 1)), false);
  assert.equal(payPeriodStillOpen(clockOut, periods, new Date(2026, 9, 15, 16, 59), '17:00'), true);
  assert.equal(payPeriodStillOpen(clockOut, periods, new Date(2026, 9, 15, 17, 1), '17:00'), false);
  assert.throws(
    () =>
      setTimecardEntries(punches, 'out', {
        entries: [{ id: 'reason-traffic', minutes: 15 }],
        catalog,
        periods,
        now: new Date(2026, 9, 20, 12, 0),
      }),
    /pay period is closed/
  );
  const office = setTimecardEntries(punches, 'out', {
    entries: [{ id: 'reason-bus-wash', minutes: 30, comment: 'Yard' }],
    catalog,
    periods,
    now: new Date(2026, 9, 20, 12, 0),
    office: true,
    account: { id: 'user-1', name: 'Rachel Smith' },
    note: 'Added after the period',
    at: '2026-10-20T18:00:00.000Z',
  });
  assert.equal(office[1].timecard_entries[0].label, 'Bus Wash');
  assert.equal(office[1].office_edits[0].note, 'Added after the period');
  assert.throws(
    () =>
      setTimecardEntries(punches, 'out', {
        entries: [{ id: 'reason-bus-wash', minutes: 30 }],
        catalog,
        office: true,
        account: { id: 'user-1', name: 'Rachel Smith' },
        note: '',
      }),
    /note/i
  );
});

test('a reason becomes a note line only after it has a time', () => {
  assert.equal(reasonNoteLine({ label: 'Traffic', minutes: 75 }), 'Traffic · 1 hour 15 minutes');
  assert.equal(reasonNoteLine({ label: 'Bus Wash', minutes: 1 }), 'Bus Wash · 1 minute');
  assert.equal(reasonNoteLine({ label: 'Weather' }), '');
  assert.equal(reasonNoteLine({ label: 'Weather', minutes: 0 }), '');
});

test('saved timecard codes stay on the clock-out', () => {
  const storage = memoryStorage();
  const state = loadState(storage);
  state.punches = [
    {
      id: 'out',
      driver_name: 'Alex Driver',
      action: 'out',
      punched_at: '2026-10-09T17:00:00.000Z',
      note: '',
      timecard_entries: [
        { id: 'reason-traffic', label: 'Traffic/Construction/Accident', minutes: 20, comment: 'Columbia' },
        { id: 'reason-traffic', label: 'Traffic/Construction/Accident', minutes: 5, comment: 'again' },
        { id: 'reason-bus-wash', label: 'Bus Wash', minutes: 0, comment: '' },
      ],
    },
  ];
  saveState(state, storage);
  const loaded = loadState(storage).punches[0];
  assert.equal(loaded.timecard_entries.length, 1);
  assert.equal(loaded.timecard_entries[0].minutes, 20);
  assert.equal(normalizeTimecardEntries(loaded.timecard_entries)[0].comment, 'Columbia');
});
