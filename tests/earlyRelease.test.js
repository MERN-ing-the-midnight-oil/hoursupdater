import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBellingham2026_2027Calendar } from '../employee-tracker/src/bellinghamCalendar2026.js';
import { getSchoolDays } from '../src/logic/calendar.js';
import {
  EARLY_RELEASE_DEFAULT_CLOCK,
  earlyReleaseClock,
  earlyReleaseDefaultClock,
  earlyReleaseScreenClock,
  firstHeadedSchool,
  schoolDestinationLabel,
  isEarlyReleaseDate,
  knownSchoolCodes,
  normalizeEarlyReleaseTimes,
  noteWithSchoolLists,
  pmClockForDate,
  routeSchoolLists,
  schoolCodeChoices,
  schoolCodesFromNote,
  schoolsForSegment,
  lastSchoolForSegment,
} from '../src/logic/earlyRelease.js';
import { clockInKey, flashingClockInKeys } from '../src/logic/lateClockFlash.js';
import { importState, loadState, mergeSharedDriverList, saveState } from '../office-tracker/web/store.js';

const schoolDays = getSchoolDays(buildBellingham2026_2027Calendar().calendar);
const s10 = 'LOW, SHS/BHS, LOW';

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

test('the last school on a segment is the final code in that part of the note', () => {
  assert.deepEqual(schoolsForSegment(s10, 'AM'), ['LOW', 'SHS']);
  assert.deepEqual(schoolsForSegment(s10, 'PM'), ['BHS', 'LOW']);
  assert.equal(lastSchoolForSegment(s10, 'AM'), 'SHS');
  assert.equal(lastSchoolForSegment(s10, 'PM'), 'LOW');
  assert.equal(lastSchoolForSegment('NH, SMS,SQHS/NH, SMS, MD BW', 'PM'), 'SMS');
  assert.equal(lastSchoolForSegment('NH, SMS,SQHS/NH, SMS, MD BW', 'MID'), 'BW');
  assert.equal(lastSchoolForSegment('6 hrs MWF(CT) - CC, KMS, SQHS/CC, KMS', 'AM'), 'SQHS');
});

test('route S10 heads to Lowell first, and every school code on the note is known', () => {
  assert.equal(firstHeadedSchool(s10), 'LOW');
  assert.equal(schoolDestinationLabel('LOW'), 'Lowell');
  assert.equal(schoolDestinationLabel('low'), 'Lowell');
  assert.deepEqual(schoolCodesFromNote(s10), ['LOW', 'SHS', 'BHS']);
  assert.deepEqual(schoolCodesFromNote('GEN-WK-BHS, WMS/GEN-WK'), ['GEN', 'WK', 'BHS', 'WMS']);
  assert.equal(firstHeadedSchool('BHS-OPT, COR, CT/BHS-OPT, COR'), 'BHS');
  assert.equal(firstHeadedSchool('3.5 hours/4 hr min RV, SQHS/RV, SQHS'), 'RV');
  assert.equal(firstHeadedSchool('6 hrs MWF(CT) - CC, KMS, SQHS/CC, KMS'), 'CC');
  assert.deepEqual(schoolCodesFromNote('KMS, SHS, SL/KMS, SHS, SL-MER SK RET'), ['KMS', 'SHS', 'SL', 'MER']);
});

test('editing school codes keeps each run, and leaves an unchanged note alone', () => {
  assert.deepEqual(routeSchoolLists(s10), { AM: ['LOW', 'SHS'], MIDDAY: [], PM: ['BHS', 'LOW'] });
  assert.equal(noteWithSchoolLists(s10, routeSchoolLists(s10)), s10);
  const withoutSehome = noteWithSchoolLists(s10, { AM: ['LOW'], MIDDAY: [], PM: ['BHS', 'LOW'] });
  assert.equal(withoutSehome, 'LOW/BHS, LOW');
  assert.deepEqual(routeSchoolLists(withoutSehome).AM, ['LOW']);
  const withMidday = noteWithSchoolLists(s10, {
    AM: ['LOW', 'SHS'],
    MIDDAY: ['COSMO'],
    PM: ['BHS', 'LOW'],
  });
  assert.equal(withMidday, 'LOW, SHS/BHS, LOW, MD COSMO');
  assert.deepEqual(routeSchoolLists(withMidday).MIDDAY, ['COSMO']);
  assert.equal(lastSchoolForSegment(withMidday, 'PM'), 'LOW');
  const afternoonOnly = noteWithSchoolLists('', { AM: [], MIDDAY: [], PM: ['BHS', 'LOW'] });
  assert.equal(afternoonOnly, '/BHS, LOW');
  assert.deepEqual(routeSchoolLists(afternoonOnly), { AM: [], MIDDAY: [], PM: ['BHS', 'LOW'] });
  assert.equal(firstHeadedSchool(afternoonOnly), '');
});

test('a school-code edit keeps the comment around the codes', () => {
  const noted = 'SB, SQHS/SB, SQHS (miscalculation on time, signed for 4.25 hours)';
  const preamble = '3.5 hours/4 hr min RV, SQHS/RV, SQHS';
  assert.equal(noteWithSchoolLists(noted, routeSchoolLists(noted)), noted);
  assert.equal(noteWithSchoolLists(preamble, routeSchoolLists(preamble)), preamble);
  const next = noteWithSchoolLists(noted, { AM: ['SB'], MIDDAY: [], PM: ['SB', 'SQHS'] });
  assert.equal(next, 'SB/SB, SQHS (miscalculation on time, signed for 4.25 hours)');
  assert.equal(firstHeadedSchool(next), 'SB');
  const utility = 'Utility day, 7:00 AM–3:00 PM. Recorded as one span, not an AM run and a PM run.';
  assert.equal(noteWithSchoolLists(utility, routeSchoolLists(utility)), utility);
  const choices = schoolCodeChoices({ a: { note: 'LOW, SHS/BHS, LOW' }, b: { note: preamble } });
  assert.equal(choices.some((item) => item.code === 'LOW' && item.label === 'Lowell'), true);
  assert.equal(choices.some((item) => item.code === 'RV'), true);
  assert.equal(choices.some((item) => item.code === 'SQHS' && item.label === 'Squalicum'), true);
});

test('known school codes come from the route notes, in alphabetical order', () => {
  assert.deepEqual(
    knownSchoolCodes({
      a: { note: s10 },
      b: { note: 'AW, SQHS/AW, CT' },
      c: { note: 'Utility day, 7:00 AM–3:00 PM. Recorded as one span, not an AM run and a PM run.' },
    }),
    ['AW', 'BHS', 'CT', 'LOW', 'SHS', 'SQHS']
  );
});

test('early dismissal is Thursday when school is in session, and the last day June 11, 2027', () => {
  assert.equal(isEarlyReleaseDate('2026-10-08', schoolDays), true);
  assert.equal(isEarlyReleaseDate('2026-10-09', schoolDays), false);
  assert.equal(isEarlyReleaseDate('2026-11-25', schoolDays), false);
  assert.equal(isEarlyReleaseDate('2027-06-11', schoolDays), true);
  assert.equal(isEarlyReleaseDate('2026-11-26', schoolDays), false);
  assert.equal(isEarlyReleaseDate('2026-12-24', schoolDays), false);
});

test('early release PM clock-in follows the posted time for the first school', () => {
  assert.equal(EARLY_RELEASE_DEFAULT_CLOCK, '11:55');
  assert.equal(earlyReleaseDefaultClock('AW'), '11:50');
  assert.equal(earlyReleaseDefaultClock('BW'), '11:50');
  assert.equal(earlyReleaseDefaultClock('CC'), '12:00');
  assert.equal(earlyReleaseDefaultClock('COR'), '11:50');
  assert.equal(earlyReleaseDefaultClock('CORD'), '11:50');
  assert.equal(earlyReleaseDefaultClock('NH'), '11:50');
  assert.equal(earlyReleaseDefaultClock('SB'), '11:50');
  assert.equal(earlyReleaseDefaultClock('LOW'), '11:55');
  assert.equal(earlyReleaseDefaultClock('SL'), '11:55');
  assert.equal(earlyReleaseDefaultClock('SUN'), '11:55');
  assert.equal(earlyReleaseDefaultClock('ROO'), '11:55');
  assert.equal(earlyReleaseDefaultClock('WK'), '11:55');
  assert.equal(earlyReleaseDefaultClock('BHS'), '11:55');
  assert.equal(earlyReleaseScreenClock({}), '11:50');
  assert.equal(
    pmClockForDate({
      regularClock: '14:05',
      note: s10,
      date: '2026-10-08',
      schoolDays,
      times: {},
    }),
    '11:55'
  );
  assert.equal(
    pmClockForDate({
      regularClock: '14:05',
      note: 'AW, SQHS/AW, SQHS',
      date: '2026-10-08',
      schoolDays,
      times: {},
    }),
    '11:50'
  );
  assert.equal(
    pmClockForDate({
      regularClock: '14:05',
      note: 'CC, SHS/CC, SHS',
      date: '2026-10-08',
      schoolDays,
      times: {},
    }),
    '12:00'
  );
  assert.equal(
    pmClockForDate({
      regularClock: '14:05',
      note: 'AW, SQHS/AW, SQHS',
      date: '2026-10-09',
      schoolDays,
      times: {},
    }),
    '14:05'
  );
  assert.equal(
    pmClockForDate({
      regularClock: '14:05',
      note: s10,
      date: '2026-10-09',
      schoolDays,
      times: { LOW: '11:40' },
    }),
    '14:05'
  );
  assert.equal(
    pmClockForDate({
      regularClock: '14:05',
      note: s10,
      date: '2027-06-11',
      schoolDays,
      times: { LOW: '11:40', BHS: '12:30' },
    }),
    '11:40'
  );
  assert.equal(
    pmClockForDate({
      regularClock: '14:05',
      note: 'BHS, KMS/SWHS, KMS',
      date: '2026-10-08',
      schoolDays,
      times: { LOW: '11:40', BHS: '12:30' },
    }),
    '12:30'
  );
  assert.equal(
    pmClockForDate({
      regularClock: '14:05',
      note: 'No schools on this route.',
      date: '2026-10-08',
      schoolDays,
      times: { LOW: '11:40' },
    }),
    '14:05'
  );
  assert.equal(earlyReleaseClock(s10, { low: '11:40 AM' }), '11:55');
  assert.deepEqual(normalizeEarlyReleaseTimes({ LOW: '11:40', nope: 'noon', BHS: '12:30' }), {
    LOW: '11:40',
    BHS: '12:30',
  });
});

test('a name flashes from the early release PM clock-in once that time is late', () => {
  const clock = pmClockForDate({
    regularClock: '14:05',
    note: s10,
    date: '2026-10-08',
    schoolDays,
    times: {},
  });
  const punch = {
    driver_name: 'Route Driver',
    action: 'in',
    run: 'AM',
    punched_at: new Date(2026, 9, 8, 6, 50).toISOString(),
  };
  const shared = {
    graceMinutes: 5,
    clockIns: ['7:00', clock],
    clockRuns: ['AM', 'PM'],
    punches: [punch],
    driverName: 'Route Driver',
  };
  assert.deepEqual(
    flashingClockInKeys({ ...shared, now: new Date(2026, 9, 8, 11, 59) }),
    []
  );
  assert.deepEqual(
    flashingClockInKeys({ ...shared, now: new Date(2026, 9, 8, 12, 0) }),
    [clockInKey('2026-10-08', 11 * 60 + 55)]
  );
});

test('saved early release times stay with the office', () => {
  const storage = memoryStorage();
  const state = loadState(storage);
  state.profiles = { 'route-s10': { id: 'route-s10', name: 'S10', note: s10 } };
  state.clockEarlyReleaseTimes = { LOW: '11:40', BHS: 'noon' };
  saveState(state, storage);
  assert.deepEqual(loadState(storage).clockEarlyReleaseTimes, { LOW: '11:40' });

  const remote = { ...loadState(storage), clockEarlyReleaseTimes: { SHS: '12:05' } };
  const localUnset = loadState(storage);
  delete localUnset.clockEarlyReleaseTimes;
  assert.deepEqual(mergeSharedDriverList(remote, localUnset).clockEarlyReleaseTimes, { SHS: '12:05' });
  assert.deepEqual(
    mergeSharedDriverList(remote, { ...localUnset, clockEarlyReleaseTimes: { LOW: '11:50' } })
      .clockEarlyReleaseTimes,
    { LOW: '11:50' }
  );

  const imported = importState(
    JSON.stringify({ version: 1, profiles: state.profiles, clockEarlyReleaseTimes: { LOW: '11:45' } }),
    storage
  );
  assert.deepEqual(imported.clockEarlyReleaseTimes, { LOW: '11:45' });
});
