import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { computeDeltaMinutes } from '../src/logic/timeUtils.js';
import { buildBps2026_2027Calendar } from '../employee-tracker/src/bpsCalendar2026.js';
import {
  formatSegmentRange,
  normalizeClockTime,
  splitSegmentRange,
  dayAfter,
} from '../employee-tracker/src/clockTimes.js';
import { EMPLOYEE_ROUTE_ID } from '../employee-tracker/src/snapshot.js';
import {
  buildEmployeeSnapshot,
  officialContractedMinutes,
  previewEmployeeChange,
  rebuildEmployeeRouteState,
} from '../employee-tracker/src/snapshot.js';

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
    assert.equal(entry.window_expires_date, '2026-09-29');

    const snap = buildEmployeeSnapshot({
      profile,
      changeLog: log,
      entry,
      calendar,
      asOfDate: '2026-09-08',
    });
    assert.equal(snap.window.becomes_contracted_on, '2026-09-30');
    assert.equal(snap.window.projected_outcome, 'STABLE');
    assert.equal(dayAfter('2026-09-30'), '2026-10-01');
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
    const open = rebuildEmployeeRouteState(log, calendar, '2026-09-29');
    assert.equal(open.status, 'ACCUMULATING');

    const closed = rebuildEmployeeRouteState(log, calendar, '2026-09-30');
    assert.equal(closed.status, 'STABLE');
    assert.equal(closed.segments.AM, '6:28-8:55');
    assert.ok(closed.payroll_rounded_total_minutes != null);
    assert.equal(closed.change_reports.at(-1).outcome, 'STABLE');
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
    assert.equal(preview.window_expires_date, '2026-09-29');
    assert.equal(preview.becomes_contracted_on, '2026-09-30');
    assert.equal(preview.projected_outcome, 'STABLE');
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
});
