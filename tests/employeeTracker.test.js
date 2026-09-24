import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { computeDeltaMinutes } from '../src/logic/timeUtils.js';
import { addSchoolDays } from '../src/logic/calendar.js';
import { buildBps2026_2027Calendar } from '../employee-tracker/src/bpsCalendar2026.js';
import {
  formatSegmentRange,
  normalizeClockTime,
  splitSegmentRange,
  dayAfter,
} from '../employee-tracker/src/clockTimes.js';
import {
  buildEmployeeNotifications,
  visibleEmployeeNotifications,
} from '../employee-tracker/src/notifications.js';
import { EMPLOYEE_ROUTE_ID } from '../employee-tracker/src/snapshot.js';
import {
  buildEmployeeSnapshot,
  officialContractedMinutes,
  previewEmployeeChange,
  rebuildEmployeeRouteState,
} from '../employee-tracker/src/snapshot.js';
import {
  DISMISSED_NOTIFICATIONS_KEY,
  dismissNotificationId,
  listDismissedNotificationIds,
} from '../employee-tracker/web/store.js';

const { calendar } = buildBps2026_2027Calendar();

function makeSeed(segment, range, date = '2026-09-08') {
  return {
    id: `seed-${segment}`,
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: 'Alex Driver',
    driver_id: null,
    segment,
    submitted_at: `${date}T08:00:00.000Z`,
    effective_date: date,
    previous_time: range,
    new_time: range,
    computed_delta_minutes: 0,
    delta_minutes: 0,
    routing_adjustment: null,
    reason_category: 'OTHER',
    note: 'Starting schedule',
    entered_by: 'Alex Driver',
  };
}

function makeChange(overrides) {
  const previous = overrides.previous_time ?? '6:35-8:55';
  const next = overrides.new_time ?? '6:28-8:55';
  const delta = overrides.delta_minutes ?? computeDeltaMinutes(previous, next);
  return {
    id: overrides.id ?? 'change-1',
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: 'Alex Driver',
    driver_id: null,
    segment: overrides.segment ?? 'AM',
    submitted_at: overrides.submitted_at ?? '2026-09-08T12:00:00.000Z',
    effective_date: overrides.effective_date ?? '2026-09-08',
    previous_time: previous,
    new_time: next,
    computed_delta_minutes: delta,
    delta_minutes: delta,
    routing_adjustment: null,
    reason_category: 'OTHER',
    note: overrides.note ?? '',
    entered_by: 'Alex Driver',
    ...overrides,
  };
}

describe('employee clock-time helpers', () => {
  it('normalizes time-input values into district H:MM ranges', () => {
    assert.equal(normalizeClockTime('06:35'), '6:35');
    assert.equal(formatSegmentRange('06:35', '08:55'), '6:35-8:55');
    assert.deepEqual(splitSegmentRange('6:35-8:55'), {
      clock_in: '6:35',
      clock_out: '8:55',
      range: '6:35-8:55',
      duration_minutes: 140,
    });
  });
});

describe('employee hours snapshot', () => {
  const profile = {
    name: 'Alex Driver',
    start_date: '2026-09-08',
    setup_at: '2026-09-08T08:00:00.000Z',
  };

  it('seeds starting times as stable with no window', () => {
    const log = [
      makeSeed('AM', '6:35-8:55'),
      makeSeed('PM', '14:05-16:25'),
    ];
    const entry = rebuildEmployeeRouteState(log, calendar, '2026-09-08');
    assert.equal(entry.status, 'STABLE');
    assert.equal(entry.window_expires_date, null);
    assert.equal(entry.segments.AM, '6:35-8:55');
    const snap = buildEmployeeSnapshot({
      profile,
      changeLog: log,
      entry,
      calendar,
      asOfDate: '2026-09-08',
    });
    assert.equal(snap.setup_complete, true);
    assert.equal(snap.schedule.AM.clock_in, '6:35');
    assert.equal(snap.window.status, 'STABLE');
    assert.equal(snap.contracted.minutes, officialContractedMinutes(entry));
    assert.equal(snap.schedule_history.length, 1);
    assert.equal(snap.schedule_history[0].kind, 'initial');
    assert.equal(snap.schedule_history[0].schedule.AM.clock_in, '6:35');
    assert.equal(snap.schedule_history[0].contracted.status, 'established');
  });

  it('opens a 15-school-day window and names the contracted date', () => {
    const log = [
      makeSeed('AM', '6:35-8:55'),
      makeChange({
        previous_time: '6:35-8:55',
        new_time: '6:28-8:55',
      }),
    ];
    const entry = rebuildEmployeeRouteState(log, calendar, '2026-09-08');
    assert.equal(entry.status, 'ACCUMULATING');
    assert.equal(entry.cumulative_drift_minutes, 7);
    assert.equal(entry.window_expires_date, '2026-09-30');

    const snap = buildEmployeeSnapshot({
      profile,
      changeLog: log,
      entry,
      calendar,
      asOfDate: '2026-09-08',
    });
    assert.equal(snap.window.becomes_contracted_on, '2026-10-01');
    assert.equal(snap.window.projected_outcome, 'STABLE');
    assert.equal(dayAfter('2026-09-30'), '2026-10-01');
    assert.equal(snap.schedule_history.length, 2);
    assert.equal(snap.schedule_history[0].kind, 'initial');
    assert.equal(snap.schedule_history[1].kind, 'change');
    assert.equal(snap.schedule_history[1].schedule.AM.clock_in, '6:28');
    assert.equal(snap.schedule_history[1].contracted.status, 'predicted');
    assert.equal(snap.schedule_history[1].contracted.becomes_on, '2026-10-01');
    assert.match(snap.schedule_history[1].contracted.label, /predicted to become contracted/i);
  });

  it('locks in contracted hours after the window expires under 30 minutes', () => {
    const log = [
      makeSeed('AM', '6:35-8:55'),
      makeSeed('PM', '14:05-16:25'),
      makeChange({
        previous_time: '6:35-8:55',
        new_time: '6:28-8:55',
      }),
    ];
    const open = rebuildEmployeeRouteState(log, calendar, '2026-09-30');
    assert.equal(open.status, 'ACCUMULATING');

    const closed = rebuildEmployeeRouteState(log, calendar, '2026-10-01');
    assert.equal(closed.status, 'STABLE');
    assert.equal(closed.segments.AM, '6:28-8:55');
    assert.ok(closed.payroll_rounded_total_minutes != null);
    assert.equal(closed.change_reports.at(-1).outcome, 'STABLE');

    const snap = buildEmployeeSnapshot({
      profile,
      changeLog: log,
      entry: closed,
      calendar,
      asOfDate: '2026-10-01',
    });
    assert.equal(snap.schedule_history.at(-1).contracted.status, 'became_contracted');
    assert.equal(snap.schedule_history.at(-1).contracted.becomes_on, '2026-10-01');
    assert.equal(snap.schedule_history.at(-1).schedule.AM.clock_in, '6:28');
  });

  it('keeps a post-October 1 15-minute decrease open for 15 school days', () => {
    const log = [
      makeSeed('AM', '6:00-8:30', '2026-09-08'),
      makeChange({
        id: 'cut',
        previous_time: '6:00-8:30',
        new_time: '6:00-8:15',
        effective_date: '2026-10-06',
        submitted_at: '2026-10-06T12:00:00.000Z',
      }),
    ];
    const open = rebuildEmployeeRouteState(log, calendar, '2026-10-06');
    assert.equal(open.status, 'ACCUMULATING');
    assert.equal(open.cumulative_drift_minutes, -15);
    assert.equal(open.window_rule, 'post_october_1_decrease_lock');

    const stillOpen = rebuildEmployeeRouteState(log, calendar, '2026-10-07');
    assert.equal(stillOpen.status, 'ACCUMULATING');

    const fifteenth = addSchoolDays(calendar, '2026-10-06', 15);
    const effective = addSchoolDays(calendar, fifteenth, 1);
    const closed = rebuildEmployeeRouteState(log, calendar, effective);
    assert.equal(closed.status, 'STABLE');
  });

  it('flags a 30-minute increase as bid pending when the window closes', () => {
    const log = [
      makeSeed('AM', '6:00-8:00'),
      makeChange({
        previous_time: '6:00-8:00',
        new_time: '5:30-8:00',
      }),
    ];
    const closed = rebuildEmployeeRouteState(log, calendar, '2026-10-01');
    assert.equal(closed.status, 'BID_PENDING');
    assert.equal(closed.cumulative_drift_minutes, 30);

    const snap = buildEmployeeSnapshot({
      profile,
      changeLog: log,
      entry: closed,
      calendar,
      asOfDate: '2026-10-01',
    });
    assert.equal(snap.schedule_history.at(-1).contracted.status, 'bid_pending');
  });

  it('previews the same contracted date the state machine will use', () => {
    const log = [makeSeed('AM', '6:35-8:55')];
    const entry = rebuildEmployeeRouteState(log, calendar, '2026-09-08');
    const preview = previewEmployeeChange({
      entry,
      calendar,
      segment: 'AM',
      clock_in: '6:28',
      clock_out: '8:55',
      change_date: '2026-09-08',
    });
    assert.equal(preview.delta_minutes, 7);
    assert.equal(preview.window_expires_date, '2026-09-30');
    assert.equal(preview.becomes_contracted_on, '2026-10-01');
    assert.equal(preview.projected_outcome, 'STABLE');
  });

  it('does not notify while the review window is still open', () => {
    const log = [
      makeSeed('AM', '6:35-8:55'),
      makeChange({
        previous_time: '6:35-8:55',
        new_time: '6:28-8:55',
      }),
    ];
    const entry = rebuildEmployeeRouteState(log, calendar, '2026-09-08');
    const snap = buildEmployeeSnapshot({
      profile,
      changeLog: log,
      entry,
      calendar,
      asOfDate: '2026-09-08',
    });
    assert.equal(buildEmployeeNotifications(snap).length, 0);
  });

  it('alerts when clock-in times lock in as contracted', () => {
    const log = [
      makeSeed('AM', '6:35-8:55'),
      makeSeed('PM', '14:05-16:25'),
      makeChange({
        previous_time: '6:35-8:55',
        new_time: '6:28-8:55',
      }),
    ];
    const entry = rebuildEmployeeRouteState(log, calendar, '2026-10-01');
    const snap = buildEmployeeSnapshot({
      profile,
      changeLog: log,
      entry,
      calendar,
      asOfDate: '2026-10-01',
    });
    const notes = buildEmployeeNotifications(snap);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].event_type, 'TIMES_CONTRACTED');
    const rebuilt = buildEmployeeSnapshot({
      profile,
      changeLog: log,
      entry: rebuildEmployeeRouteState(log, calendar, '2026-10-01'),
      calendar,
      asOfDate: '2026-10-01',
    });
    assert.equal(buildEmployeeNotifications(rebuilt)[0].id, notes[0].id);
    assert.match(notes[0].title, /clock times are now contracted/i);
    assert.match(notes[0].detail, /window closed/i);
    assert.equal(notes[0].finalized_on, '2026-10-01');
    assert.ok(
      notes[0].time_changes.some(
        (change) =>
          change.segment === 'AM' &&
          change.previous_time === '6:35-8:55' &&
          change.new_time === '6:28-8:55'
      )
    );
    assert.ok(
      notes[0].contracted_times.some(
        (row) => row.segment === 'AM' && row.clock_in === '6:28'
      )
    );
    assert.equal(visibleEmployeeNotifications(notes, [notes[0].id]).length, 0);
  });

  it('lists each changed schedule oldest-first and marks superseded rows', () => {
    const log = [
      makeSeed('AM', '6:35-8:55'),
      makeSeed('PM', '14:05-16:25'),
      makeChange({
        id: 'change-am',
        segment: 'AM',
        previous_time: '6:35-8:55',
        new_time: '6:28-8:55',
        submitted_at: '2026-09-08T12:00:00.000Z',
        effective_date: '2026-09-08',
      }),
      makeChange({
        id: 'change-pm',
        segment: 'PM',
        previous_time: '14:05-16:25',
        new_time: '14:00-16:25',
        submitted_at: '2026-09-10T12:00:00.000Z',
        effective_date: '2026-09-10',
      }),
    ];
    const entry = rebuildEmployeeRouteState(log, calendar, '2026-09-10');
    const snap = buildEmployeeSnapshot({
      profile,
      changeLog: log,
      entry,
      calendar,
      asOfDate: '2026-09-10',
    });
    assert.deepEqual(
      snap.schedule_history.map((row) => row.kind),
      ['initial', 'change', 'change']
    );
    assert.deepEqual(
      snap.schedule_history.map((row) => row.date),
      ['2026-09-08', '2026-09-08', '2026-09-10']
    );
    assert.equal(snap.schedule_history[0].schedule.AM.clock_in, '6:35');
    assert.equal(snap.schedule_history[1].schedule.AM.clock_in, '6:28');
    assert.equal(snap.schedule_history[1].schedule.PM.clock_in, '14:05');
    assert.equal(snap.schedule_history[1].contracted.status, 'superseded');
    assert.equal(snap.schedule_history[2].schedule.AM.clock_in, '6:28');
    assert.equal(snap.schedule_history[2].schedule.PM.clock_in, '14:00');
    assert.equal(snap.schedule_history[2].contracted.status, 'predicted');
    assert.equal(snap.schedule_history.at(-1).id, 'change-pm');
    const first = snap.schedule_history[1];
    const second = snap.schedule_history[2];
    assert.equal(first.cumulative_drift_minutes, first.delta_minutes);
    assert.equal(
      second.cumulative_drift_minutes,
      first.delta_minutes + second.delta_minutes
    );
    assert.notEqual(second.cumulative_drift_minutes, second.delta_minutes);

    const closed = rebuildEmployeeRouteState(log, calendar, '2026-10-01');
    const closedSnap = buildEmployeeSnapshot({
      profile,
      changeLog: log,
      entry: closed,
      calendar,
      asOfDate: '2026-10-01',
    });
    assert.equal(
      closedSnap.schedule_history[2].cumulative_drift_minutes,
      first.delta_minutes + second.delta_minutes
    );
    assert.equal(
      closedSnap.schedule_history[2].cumulative_drift_label,
      second.cumulative_drift_label
    );
  });

  it('does not treat bid/bump window closes as contracted-time alerts', () => {
    const log = [
      makeSeed('AM', '6:00-8:00'),
      makeChange({
        previous_time: '6:00-8:00',
        new_time: '5:30-8:00',
      }),
    ];
    const entry = rebuildEmployeeRouteState(log, calendar, '2026-10-01');
    assert.equal(entry.status, 'BID_PENDING');
    const snap = buildEmployeeSnapshot({
      profile,
      changeLog: log,
      entry,
      calendar,
      asOfDate: '2026-10-01',
    });
    assert.equal(buildEmployeeNotifications(snap).length, 0);
  });
});

describe('employee isolated data dir', () => {
  /** @type {string} */
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'my-hours-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes the built-in BPS calendar into a private folder', async () => {
    const { ensureBuiltInCalendar } = await import(
      '../employee-tracker/src/storage.js'
    );
    const written = await ensureBuiltInCalendar(tempDir);
    assert.equal(written.school_year, '2026-2027');
    const raw = await fs.readFile(
      path.join(tempDir, 'school-calendar.json'),
      'utf8'
    );
    const parsed = JSON.parse(raw);
    assert.equal(parsed.school_days.length, 180);
  });
});

describe('independent browser profiles', () => {
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
      removeItem(key) {
        delete data[key];
      },
    };
  }

  it('keeps two people isolated in the same storage', async () => {
    const { recordChange, setupProfile, switchPerson } = await import(
      '../employee-tracker/web/engine.js'
    );
    const storage = memoryStorage();
    setupProfile(
      {
        name: 'Alex',
        start_date: '2026-09-08',
        am_in: '06:35',
        am_out: '08:55',
      },
      storage
    );
    setupProfile(
      {
        name: 'Jordan',
        start_date: '2026-09-08',
        am_in: '07:00',
        am_out: '09:00',
      },
      storage
    );

    const jordan = recordChange(
      {
        segment: 'AM',
        change_date: '2026-09-08',
        clock_in: '06:30',
        clock_out: '09:00',
      },
      storage
    );
    assert.equal(jordan.employee.name, 'Jordan');
    assert.equal(jordan.schedule.AM.clock_in, '6:30');
    assert.equal(jordan.window.cumulative_drift_minutes, 30);

    const alex = switchPerson(
      Object.values(JSON.parse(storage.getItem('my-hours-tracker.v1')).profiles).find(
        (profile) => profile.name === 'Alex'
      ).id,
      storage
    );
    assert.equal(alex.employee.name, 'Alex');
    assert.equal(alex.schedule.AM.clock_in, '6:35');
    assert.equal(alex.window.status, 'STABLE');
    assert.equal(alex.window.cumulative_drift_minutes, 0);
  });

  it('lets a person correct a mistyped change and rebuild the window', async () => {
    const { deleteChange, recordChange, setupProfile, updateChange } = await import(
      '../employee-tracker/web/engine.js'
    );
    const storage = memoryStorage();
    setupProfile(
      {
        name: 'Alex',
        start_date: '2026-09-08',
        am_in: '06:35',
        am_out: '08:55',
      },
      storage
    );
    const wrong = recordChange(
      {
        segment: 'AM',
        change_date: '2026-09-08',
        clock_in: '05:35',
        clock_out: '08:55',
      },
      storage
    );
    assert.equal(wrong.window.cumulative_drift_minutes, 60);
    const changeId = wrong.changes.find((change) => !change.is_seed).id;

    const fixed = updateChange(
      changeId,
      {
        change_date: '2026-09-08',
        clock_in: '06:28',
        clock_out: '08:55',
      },
      storage
    );
    assert.equal(fixed.schedule.AM.clock_in, '6:28');
    assert.equal(fixed.window.cumulative_drift_minutes, 7);
    assert.equal(fixed.window.projected_outcome, 'STABLE');

    const removed = deleteChange(changeId, storage);
    assert.equal(removed.schedule.AM.clock_in, '6:35');
    assert.equal(removed.window.status, 'STABLE');
    assert.equal(removed.changes.filter((change) => !change.is_seed).length, 0);
  });

  it('corrects current clock times without adding a new history row', async () => {
    const { correctCurrentTimes, recordChange, setupProfile } = await import(
      '../employee-tracker/web/engine.js'
    );
    const storage = memoryStorage();
    setupProfile(
      {
        name: 'Alex',
        start_date: '2026-09-08',
        am_in: '06:35',
        am_out: '08:55',
      },
      storage
    );
    recordChange(
      {
        segment: 'AM',
        change_date: '2026-09-08',
        clock_in: '06:20',
        clock_out: '08:55',
      },
      storage
    );
    const corrected = correctCurrentTimes(
      { segment: 'AM', clock_in: '06:28', clock_out: '08:55' },
      storage
    );
    assert.equal(corrected.schedule.AM.clock_in, '6:28');
    assert.equal(corrected.window.cumulative_drift_minutes, 7);
    assert.equal(corrected.changes.filter((change) => !change.is_seed).length, 1);
  });

  it('remembers dismissed contracted-time notifications per person', () => {
    const storage = memoryStorage();
    dismissNotificationId('person-a', 'note-1', storage);
    dismissNotificationId('person-a', 'note-1', storage);
    dismissNotificationId('person-b', 'note-2', storage);
    assert.deepEqual(listDismissedNotificationIds('person-a', storage), ['note-1']);
    assert.deepEqual(listDismissedNotificationIds('person-b', storage), ['note-2']);
    assert.deepEqual(listDismissedNotificationIds('missing', storage), []);
    const saved = JSON.parse(storage.getItem(DISMISSED_NOTIFICATIONS_KEY));
    assert.deepEqual(saved['person-a'], ['note-1']);
  });
});

describe('fictional example person', () => {
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
      removeItem(key) {
        delete data[key];
      },
    };
  }

  it('shows Morgan on November 16 with a stacked 30-minute increase still counting', async () => {
    const { buildSnapshot } = await import('../employee-tracker/web/engine.js');
    const { EXAMPLE_VIEW_AS_OF, exampleProfile } = await import(
      '../employee-tracker/web/examplePerson.js'
    );
    const profile = exampleProfile();
    const snap = buildSnapshot(profile, profile.view_as_of);
    assert.equal(profile.view_as_of, EXAMPLE_VIEW_AS_OF);
    assert.equal(snap.as_of, '2026-11-16');
    assert.equal(snap.employee.name, 'Morgan Hale (example)');
    assert.equal(snap.schedule.AM.range, '6:15-8:25');
    assert.equal(snap.schedule.MIDDAY.range, '11:00-12:25');
    assert.equal(snap.schedule.PM.range, '13:46-16:40');
    assert.deepEqual(
      snap.schedule_history.map((row) => [
        row.date,
        row.segment,
        row.delta_minutes,
        row.contracted.status,
      ]),
      [
        ['2026-09-08', null, null, 'established'],
        ['2026-09-09', 'AM', -35, 'bump_eligible'],
        ['2026-09-15', 'PM', 12, 'superseded'],
        ['2026-09-18', 'MIDDAY', -8, 'became_contracted'],
        ['2026-10-06', 'AM', 15, 'became_contracted'],
        ['2026-11-02', 'PM', 12, 'superseded'],
        ['2026-11-09', 'MIDDAY', 18, 'predicted'],
      ]
    );
    assert.equal(snap.schedule_history.at(-1).cumulative_drift_minutes, 30);
    assert.equal(snap.schedule_history.at(-1).contracted.becomes_on, '2026-12-17');
    assert.equal(snap.window.status, 'ACCUMULATING');
    assert.equal(snap.window.cumulative_drift_minutes, 30);
    assert.equal(snap.window.projected_outcome, 'BID_PENDING');
  });

  it('adds the example once and leaves an existing person selected', async () => {
    const { setupProfile } = await import('../employee-tracker/web/engine.js');
    const {
      EXAMPLE_PROFILE_ID,
      EXAMPLE_SEEDED_KEY,
      ensureExamplePerson,
      exampleProfiles,
    } = await import('../employee-tracker/web/examplePerson.js');
    const { getCurrentProfile } = await import('../employee-tracker/web/store.js');
    const storage = memoryStorage();
    setupProfile(
      {
        name: 'Alex',
        start_date: '2026-09-08',
        am_in: '06:35',
        am_out: '08:55',
      },
      storage
    );
    ensureExamplePerson(storage);
    ensureExamplePerson(storage);
    const saved = JSON.parse(storage.getItem('my-hours-tracker.v1'));
    assert.equal(Object.keys(saved.profiles).length, 1 + exampleProfiles().length);
    assert.ok(saved.profiles[EXAMPLE_PROFILE_ID]);
    assert.ok(saved.profiles['example-after-add-up']);
    assert.equal(getCurrentProfile(storage).name, 'Alex');
    assert.equal(storage.getItem(EXAMPLE_SEEDED_KEY), '1');
    delete saved.profiles[EXAMPLE_PROFILE_ID];
    storage.setItem('my-hours-tracker.v1', JSON.stringify(saved));
    ensureExamplePerson(storage);
    const afterDelete = JSON.parse(storage.getItem('my-hours-tracker.v1'));
    assert.equal(afterDelete.profiles[EXAMPLE_PROFILE_ID], undefined);
  });

  it('draws each contract pattern on the calendar at its real close date', async () => {
    const { buildSnapshot } = await import('../employee-tracker/web/engine.js');
    const { calendarExampleProfiles } = await import(
      '../employee-tracker/web/examplePerson.js'
    );
    const { buildClockHistoryMarks } = await import(
      '../employee-tracker/src/clockHistory.js'
    );
    const { getSchoolDays } = await import('../src/logic/calendar.js');
    const { buildBps2026_2027Calendar } = await import(
      '../employee-tracker/src/bpsCalendar2026.js'
    );
    const schoolDays = getSchoolDays(buildBps2026_2027Calendar().calendar);
    const byName = Object.fromEntries(
      calendarExampleProfiles().map((profile) => [profile.name, profile])
    );

    const beforeSmall = buildSnapshot(byName['Ex before · small +12'], '2026-10-01');
    const beforeSmallMarks = buildClockHistoryMarks(beforeSmall.schedule_history, {
      schoolDays,
    });
    assert.equal(beforeSmallMarks.get('2026-09-10')?.windowDay, null);
    assert.equal(beforeSmallMarks.get('2026-09-11')?.arrow, true);
    assert.equal(beforeSmallMarks.get('2026-09-30')?.arrowHead, true);
    assert.equal(beforeSmallMarks.get('2026-10-01')?.contractedDay, true);

    const beforeCut = buildSnapshot(byName['Ex before · big −35'], '2026-09-09');
    const beforeCutMarks = buildClockHistoryMarks(beforeCut.schedule_history, {
      schoolDays,
    });
    assert.equal(beforeCutMarks.get('2026-09-09')?.established, true);
    assert.equal(beforeCutMarks.has('2026-09-10'), false);

    const afterAdd = buildSnapshot(byName['Ex after · +12 then +20'], '2026-11-16');
    const afterAddMarks = buildClockHistoryMarks(afterAdd.schedule_history, {
      schoolDays,
    });
    assert.equal(afterAdd.window.becomes_contracted_on, '2026-11-20');
    assert.equal(afterAddMarks.get('2026-10-05')?.windowDay, 1);
    assert.equal(afterAddMarks.get('2026-10-30')?.windowDay, 15);
    assert.equal(afterAddMarks.get('2026-11-19')?.arrowHead, true);
    assert.equal(afterAddMarks.has('2026-11-20'), false);

    const laterView = buildSnapshot(byName['Ex before · small +12'], '2026-12-10');
    const laterMarks = buildClockHistoryMarks(laterView.schedule_history, { schoolDays });
    assert.equal(laterView.schedule_history.at(-1).contracted.becomes_on, '2026-10-01');
    assert.equal(laterMarks.get('2026-10-01')?.contractedDay, true);
    assert.equal(laterMarks.get('2026-12-10')?.contractedDay, undefined);

    const novBid = buildSnapshot(byName['Ex Nov · big +40'], '2026-12-10');
    const novBidMarks = buildClockHistoryMarks(novBid.schedule_history, { schoolDays });
    assert.equal(novBid.window.becomes_contracted_on, '2026-12-17');
    assert.equal(novBidMarks.get('2026-12-03')?.windowDay, 15);
    assert.equal(novBidMarks.get('2026-12-10')?.arrow, true);
    assert.equal(novBidMarks.get('2026-12-16')?.arrowHead, true);

    const decSmall = buildSnapshot(byName['Ex Dec · small +15'], '2026-12-10');
    const decSmallMarks = buildClockHistoryMarks(decSmall.schedule_history, { schoolDays });
    assert.equal(decSmall.window.becomes_contracted_on, '2026-12-23');
    assert.equal(decSmallMarks.get('2026-12-10')?.windowDay, 7);
  });

  it('opens on the example when the browser has no one saved', async () => {
    const { ensureExamplePerson } = await import(
      '../employee-tracker/web/examplePerson.js'
    );
    const storage = memoryStorage();
    const current = ensureExamplePerson(storage);
    assert.equal(current.name, 'Morgan Hale (example)');
    assert.equal(current.changeLog.filter((entry) => entry.delta_minutes !== 0).length, 6);
    assert.equal(current.view_as_of, '2026-11-16');
  });
});
