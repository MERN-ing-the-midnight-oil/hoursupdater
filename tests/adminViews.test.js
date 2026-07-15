import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendAdjustmentEvent,
  appendChangeEvent,
  writeDrivers,
  writeRouteState,
  writeSchoolCalendar,
  writeStaffNames,
  writeAdjustmentReasons,
} from '../src/data/storage.js';
import { rebuildAndPersistRouteState } from '../src/services/rebuild.js';
import {
  buildAdminQueue,
  buildDriverChangeHistory,
  buildDriverDetail,
} from '../src/services/adminViews.js';
import { resolveEffectiveDeltas } from '../src/logic/stateMachine.js';
import { readChangeLog } from '../src/data/storage.js';

async function setupDir() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rct-driver-'));
  await writeStaffNames(['Routing Desk', 'Admin Assistant'], dataDir);
  await writeAdjustmentReasons(
    ['Data entry correction', 'Other'],
    dataDir
  );
  // Minimal calendar: enough school days for a short window if needed.
  const days = [];
  for (let d = 1; d <= 30; d += 1) {
    const date = `2025-09-${String(d).padStart(2, '0')}`;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    days.push({
      date,
      is_school_day: weekday !== 0 && weekday !== 6,
      reason: null,
    });
  }
  await writeSchoolCalendar(
    {
      school_year: '2025-2026',
      coverage_start: '2025-09-01',
      coverage_end: '2025-09-30',
      days,
    },
    dataDir
  );
  await writeDrivers(
    [
      {
        driver_id: 'drv-jane',
        name: 'Jane Driver',
        email: 'jane@example.com',
        hire_date: '2012-08-15',
        tie_break: null,
      },
      {
        driver_id: 'drv-other',
        name: 'Other Driver',
        email: null,
        hire_date: '2018-09-01',
        tie_break: null,
      },
    ],
    dataDir
  );
  await writeRouteState(
    {
      'S 20': {
        driver_name: 'Jane Driver',
        driver_id: 'drv-jane',
        segments: { AM: '6:35-8:55', MIDDAY: null, PM: '2:10-4:45' },
        baseline_segments: {
          AM: '6:35-8:55',
          MIDDAY: null,
          PM: '2:10-4:45',
        },
        status: 'STABLE',
        window_opened_date: null,
        window_expires_date: null,
        cumulative_drift_minutes: 0,
        contributing_change_ids: [],
        payroll_rounded_total_minutes: null,
        reconciliation: null,
        pending_change_ids: [],
        review_history: [],
        change_reports: [],
        last_updated: '2025-09-01T12:00:00.000Z',
      },
      'S 99': {
        driver_name: 'Other Driver',
        driver_id: 'drv-other',
        segments: { AM: '6:00-8:00', MIDDAY: null, PM: null },
        baseline_segments: { AM: '6:00-8:00', MIDDAY: null, PM: null },
        status: 'STABLE',
        window_opened_date: null,
        window_expires_date: null,
        cumulative_drift_minutes: 0,
        contributing_change_ids: [],
        payroll_rounded_total_minutes: null,
        reconciliation: null,
        pending_change_ids: [],
        review_history: [],
        change_reports: [],
        last_updated: '2025-09-01T12:00:00.000Z',
      },
    },
    dataDir
  );
  return dataDir;
}

describe('adminViews driver detail', () => {
  it('aggregates assignments and chronological history for one driver', async () => {
    const dataDir = await setupDir();

    await appendChangeEvent(
      {
        id: 'c1',
        route_id: 'S 20',
        driver_name: 'Jane Driver',
        driver_id: 'drv-jane',
        segment: 'AM',
        submitted_at: '2025-09-02T08:00:00.000Z',
        effective_date: '2025-09-02',
        previous_time: '6:35-8:55',
        new_time: '6:30-8:55',
        computed_delta_minutes: 5,
        delta_minutes: 5,
        routing_adjustment: null,
        reason_category: 'MV',
        note: 'Student added',
        entered_by: 'Routing Desk',
      },
      dataDir
    );
    await appendAdjustmentEvent(
      {
        id: 'a1',
        target_change_id: 'c1',
        previous_delta: 5,
        new_delta: 10,
        reason: 'Data entry correction',
        note: 'Fix delta',
        adjusted_by: 'Admin Assistant',
        adjusted_at: '2025-09-03T09:00:00.000Z',
      },
      dataDir
    );
    // Unrelated change for the other driver — must not appear.
    await appendChangeEvent(
      {
        id: 'c-other',
        route_id: 'S 99',
        driver_name: 'Other Driver',
        driver_id: 'drv-other',
        segment: 'AM',
        submitted_at: '2025-09-04T08:00:00.000Z',
        effective_date: '2025-09-04',
        previous_time: '6:00-8:00',
        new_time: '6:05-8:00',
        computed_delta_minutes: -5,
        delta_minutes: -5,
        routing_adjustment: null,
        reason_category: 'MV',
        note: 'Other',
        entered_by: 'Routing Desk',
      },
      dataDir
    );

    await rebuildAndPersistRouteState(dataDir, '2025-09-04');

    const detail = await buildDriverDetail('drv-jane', dataDir);
    assert.ok(detail);
    assert.equal(detail.driver.email, 'jane@example.com');
    assert.equal(detail.driver.hire_date, '2012-08-15');
    assert.deepEqual(detail.seniority, {
      rank: 1,
      total: 2,
      missing_hire_date: false,
    });
    assert.equal(detail.assignments.length, 1);
    assert.equal(detail.assignments[0].route_id, 'S 20');
    assert.equal(detail.change_history.length, 2);
    assert.equal(detail.change_history[0].id, 'c1');
    assert.equal(detail.change_history[0].involvement, 'driver');
    assert.equal(detail.change_history[1].id, 'a1');
    assert.equal(detail.change_history[1].type, 'ADJUSTMENT');
    assert.equal(detail.change_history[1].route_id, 'S 20');
    assert.ok(!detail.change_history.some((e) => e.id === 'c-other'));

    const missing = await buildDriverDetail('drv-missing', dataDir);
    assert.equal(missing, null);

    const queue = await buildAdminQueue(dataDir);
    assert.ok(queue.some((r) => r.route_id === 'S 20' && r.driver_id === 'drv-jane'));
  });

  it('includes log entries where the person is entered_by or adjusted_by', async () => {
    const dataDir = await setupDir();
    await writeDrivers(
      [
        {
          driver_id: 'drv-staffish',
          name: 'Routing Desk',
          email: null,
        },
        {
          driver_id: 'drv-jane',
          name: 'Jane Driver',
          email: null,
        },
      ],
      dataDir
    );

    await appendChangeEvent(
      {
        id: 'c-entered',
        route_id: 'S 20',
        driver_name: 'Jane Driver',
        driver_id: 'drv-jane',
        segment: 'AM',
        submitted_at: '2025-09-02T08:00:00.000Z',
        effective_date: '2025-09-02',
        previous_time: '6:35-8:55',
        new_time: '6:30-8:55',
        computed_delta_minutes: 5,
        delta_minutes: 5,
        routing_adjustment: null,
        reason_category: 'MV',
        note: 'Entered by desk',
        entered_by: 'Routing Desk',
      },
      dataDir
    );

    const log = await readChangeLog(dataDir);
    const history = buildDriverChangeHistory(
      { driver_id: 'drv-staffish', name: 'Routing Desk', email: null },
      log,
      resolveEffectiveDeltas(log)
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].involvement, 'entered_by');
  });
});
