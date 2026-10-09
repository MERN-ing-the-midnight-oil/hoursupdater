import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clockInKey,
  dueClockInKeys,
  flashingClockInKeys,
  localClockParts,
  normalizeLateFlashMinutes,
} from '../src/logic/lateClockFlash.js';

const day = new Date(2026, 9, 9, 6, 40, 30);
const date = localClockParts(day).date;

function punch(hours, minutes, name = 'Jean-Luc Picard', action = 'in') {
  return {
    driver_name: name,
    action,
    punched_at: new Date(2026, 9, 9, hours, minutes).toISOString(),
  };
}

test('blank or out-of-range flash minutes leave names steady', () => {
  assert.equal(normalizeLateFlashMinutes(null), null);
  assert.equal(normalizeLateFlashMinutes(''), null);
  assert.equal(normalizeLateFlashMinutes('  '), null);
  assert.equal(normalizeLateFlashMinutes('5'), 5);
  assert.equal(normalizeLateFlashMinutes(0), 0);
  assert.equal(normalizeLateFlashMinutes(5.5), null);
  assert.equal(normalizeLateFlashMinutes(-1), null);
  assert.equal(normalizeLateFlashMinutes(241), null);
});

test('a name flashes once the route clock-in is late and no clock-in covers that run', () => {
  const clockIns = ['6:30', '11:00', '14:05'];
  const before = flashingClockInKeys({
    now: new Date(2026, 9, 9, 6, 34),
    graceMinutes: 5,
    clockIns,
    driverName: 'Jean-Luc Picard',
  });
  assert.deepEqual(before, []);

  const late = flashingClockInKeys({
    now: new Date(2026, 9, 9, 6, 35),
    graceMinutes: 5,
    clockIns,
    driverName: 'Jean-Luc Picard',
  });
  assert.deepEqual(late, [clockInKey(date, 6 * 60 + 30)]);

  const earlyPunch = flashingClockInKeys({
    now: new Date(2026, 9, 9, 6, 40),
    graceMinutes: 5,
    clockIns,
    driverName: 'Jean-Luc Picard',
    punches: [punch(6, 10)],
  });
  assert.deepEqual(earlyPunch, []);

  const otherRun = flashingClockInKeys({
    now: day,
    graceMinutes: 5,
    clockIns,
    driverName: 'Jean-Luc Picard',
    punches: [punch(11, 5)],
  });
  assert.deepEqual(otherRun, [clockInKey(date, 6 * 60 + 30)]);

  const otherDriver = flashingClockInKeys({
    now: day,
    graceMinutes: 5,
    clockIns,
    driverName: 'Jean-Luc Picard',
    punches: [punch(6, 32, 'William Riker')],
  });
  assert.deepEqual(otherDriver, [clockInKey(date, 6 * 60 + 30)]);
});

test('opening a name only clears clock-ins that are already due', () => {
  const clockIns = ['6:30', '11:00'];
  const now = new Date(2026, 9, 9, 6, 40);
  const due = dueClockInKeys({ now, graceMinutes: 5, clockIns });
  assert.deepEqual(due, [clockInKey(date, 6 * 60 + 30)]);

  const cleared = flashingClockInKeys({
    now,
    graceMinutes: 5,
    clockIns,
    driverName: 'Jean-Luc Picard',
    acknowledged: due,
  });
  assert.deepEqual(cleared, []);

  const midday = flashingClockInKeys({
    now: new Date(2026, 9, 9, 11, 6),
    graceMinutes: 5,
    clockIns,
    driverName: 'Jean-Luc Picard',
    acknowledged: due,
  });
  assert.deepEqual(midday, [clockInKey(date, 11 * 60)]);
});

test('flashing stays off until the office sets a number of minutes', () => {
  assert.deepEqual(
    flashingClockInKeys({
      now: day,
      graceMinutes: null,
      clockIns: ['6:30'],
      driverName: 'Jean-Luc Picard',
    }),
    []
  );
  assert.deepEqual(
    dueClockInKeys({ now: new Date(2026, 9, 9, 6, 29), graceMinutes: 0, clockIns: ['6:30'] }),
    []
  );
  assert.deepEqual(
    dueClockInKeys({ now: new Date(2026, 9, 9, 6, 30), graceMinutes: 0, clockIns: ['6:30'] }),
    [clockInKey(date, 6 * 60 + 30)]
  );
});
