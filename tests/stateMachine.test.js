import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addSchoolDays } from '../src/logic/calendar.js';
import {
  applyAllWindowExpirations,
  applyChangeToRoute,
  applyWindowExpiration,
  createInitialRouteState,
  rebuildRouteStateFromChangeLog,
} from '../src/logic/stateMachine.js';
import {
  parseTimeRange,
  roundToQuarterHourForPayroll,
} from '../src/logic/timeUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const calendar = JSON.parse(
  await fs.readFile(path.join(__dirname, 'fixtures/school-calendar.json'), 'utf8')
);

/** @param {Partial<import('../src/logic/stateMachine.js').ChangeEvent>} overrides */
function makeChange(overrides) {
  const delta = overrides.delta_minutes ?? 5;
  return {
    id: overrides.id ?? `change-${Math.random().toString(36).slice(2, 8)}`,
    route_id: 'S 20',
    driver_name: 'Jane Driver',
    segment: 'AM',
    submitted_at: '2025-09-02T08:00:00.000Z',
    effective_date: '2025-09-02',
    previous_time: '6:35-8:55',
    new_time: '6:30-8:55',
    computed_delta_minutes: overrides.computed_delta_minutes ?? delta,
    delta_minutes: delta,
    routing_adjustment: null,
    reason_category: 'MV',
    note: 'Test change note',
    entered_by: 'Routing Desk',
    ...overrides,
  };
}

describe('stateMachine', () => {
  it('opens a new window from STABLE on first change (Rule 2)', () => {
    const change = makeChange({ delta_minutes: 5 });
    const result = applyChangeToRoute(null, change, calendar);

    assert.equal(result.status, 'ACCUMULATING');
    assert.equal(result.window_opened_date, '2025-09-02');
    assert.equal(result.cumulative_drift_minutes, 5);
    assert.equal(result.payroll_rounded_total_minutes, null);
    assert.deepEqual(result.contributing_change_ids, [change.id]);
    assert.equal(result.window_expires_date, addSchoolDays(calendar, '2025-09-02', 15));
    assert.equal(result.segments.AM, '6:30-8:55');
  });

  it('sums unrounded deltas without intermediate rounding (Rule 3)', () => {
    // 7 + 8 + 7 = 22 exact. Rounding each step (0+15+0=15) would be the compounding bug.
    const first = makeChange({ id: 'c1', delta_minutes: 7, effective_date: '2025-09-02' });
    let state = applyChangeToRoute(null, first, calendar);
    assert.equal(state.cumulative_drift_minutes, 7);

    const second = makeChange({
      id: 'c2',
      delta_minutes: 8,
      effective_date: '2025-09-05',
      submitted_at: '2025-09-05T08:00:00.000Z',
    });
    state = applyChangeToRoute(state, second, calendar);
    assert.equal(state.cumulative_drift_minutes, 15);

    const third = makeChange({
      id: 'c3',
      delta_minutes: 7,
      effective_date: '2025-09-10',
      submitted_at: '2025-09-10T08:00:00.000Z',
    });
    state = applyChangeToRoute(state, third, calendar);

    assert.equal(state.status, 'ACCUMULATING');
    assert.equal(state.cumulative_drift_minutes, 22);
    assert.equal(state.payroll_rounded_total_minutes, null);
    assert.deepEqual(state.contributing_change_ids, ['c1', 'c2', 'c3']);
    assert.equal(state.window_expires_date, addSchoolDays(calendar, '2025-09-10', 15));
  });

  it('locks in under 30 using exact drift; rounds only at finalization (Rule 4a)', () => {
    // 22 exact is under 30 → lock in. Payroll sees nearest quarter hour (15), not 22.
    const first = makeChange({ id: 'c1', delta_minutes: 7 });
    let state = applyChangeToRoute(null, first, calendar);
    state = applyChangeToRoute(
      state,
      makeChange({
        id: 'c2',
        delta_minutes: 8,
        effective_date: '2025-09-05',
        submitted_at: '2025-09-05T08:00:00.000Z',
      }),
      calendar
    );
    state = applyChangeToRoute(
      state,
      makeChange({
        id: 'c3',
        delta_minutes: 7,
        effective_date: '2025-09-10',
        submitted_at: '2025-09-10T08:00:00.000Z',
      }),
      calendar
    );
    assert.equal(state.cumulative_drift_minutes, 22);

    // Third change on 9/10 reset the window to expire 15 school days later (10/1).
    state = applyWindowExpiration(state, '2025-10-02');

    assert.equal(state.status, 'STABLE');
    assert.equal(state.cumulative_drift_minutes, 0);
    assert.equal(state.payroll_rounded_total_minutes, 150);
    assert.equal(state.window_opened_date, null);
    assert.equal(state.window_expires_date, null);
    assert.deepEqual(state.contributing_change_ids, []);
    assert.equal(state.baseline_segments.AM, '6:30-8:55');
  });

  it('does not let a rounding artifact push a route across the 30-min threshold', () => {
    // 29 exact stays under bid. Nearest quarter hour of the *drift* is 30 —
    // that must NOT trigger BID_PENDING. Payroll stores rounded *total* instead.
    const change = makeChange({ id: 'c1', delta_minutes: 29 });
    let state = applyChangeToRoute(null, change, calendar);
    assert.equal(state.cumulative_drift_minutes, 29);

    state = applyWindowExpiration(state, '2025-09-24');

    assert.equal(state.status, 'STABLE');
    // 6:30-8:55 = 145 → round to 150 (not round(29)=30)
    assert.equal(state.payroll_rounded_total_minutes, 150);
  });

  it('rounds exact route daily total at finalization, not the drift (non-aligned baseline)', () => {
    // Baseline 6:35-8:55 = 140 — not quarter-hour aligned.
    // +7 → 6:28-8:55 = 147.
    // Old (wrong): round(7) = 0. New (correct): round(147) = 150.
    const change = makeChange({
      id: 'c1',
      previous_time: '6:35-8:55',
      new_time: '6:28-8:55',
      computed_delta_minutes: 7,
      delta_minutes: 7,
    });
    let state = applyChangeToRoute(null, change, calendar);
    assert.equal(state.cumulative_drift_minutes, 7);
    assert.equal(parseTimeRange(state.segments.AM).durationMinutes, 147);
    assert.equal(roundToQuarterHourForPayroll(7), 0);

    state = applyWindowExpiration(state, '2025-09-24');

    assert.equal(state.status, 'STABLE');
    assert.equal(state.payroll_rounded_total_minutes, 150);
    assert.notEqual(state.payroll_rounded_total_minutes, roundToQuarterHourForPayroll(7));
  });

  it('sums only this route AM+MD+PM into the Payroll total (not cross-route)', () => {
    const change = makeChange({
      id: 'c1',
      delta_minutes: 5,
      previous_time: '6:35-8:55',
      new_time: '6:30-8:55',
    });
    let state = applyChangeToRoute(null, change, calendar);
    state.segments.PM = '2:10-4:45'; // 155 exact
    // AM 145 + PM 155 = 300 → already on a quarter hour
    state = applyWindowExpiration(state, '2025-09-24');
    assert.equal(state.payroll_rounded_total_minutes, 300);
  });

  it('flags BID_PENDING on exact >= 30; stores Payroll-rounded daily total (Rule 4b)', () => {
    const first = makeChange({ id: 'c1', delta_minutes: 20 });
    let state = applyChangeToRoute(null, first, calendar);

    const second = makeChange({
      id: 'c2',
      delta_minutes: 15,
      effective_date: '2025-09-05',
      previous_time: '6:30-8:55',
      new_time: '6:20-8:55',
      submitted_at: '2025-09-05T08:00:00.000Z',
    });
    state = applyChangeToRoute(state, second, calendar);
    assert.equal(state.cumulative_drift_minutes, 35);

    state = applyWindowExpiration(state, '2025-10-01');

    assert.equal(state.status, 'BID_PENDING');
    assert.equal(state.cumulative_drift_minutes, 35);
    assert.equal(state.payroll_rounded_total_minutes, 150);
    assert.deepEqual(state.contributing_change_ids, ['c1', 'c2']);
    assert.equal(state.window_expires_date, null);
  });

  it('reverts BID_PENDING to ACCUMULATING when exact drift drops below 30 (Rule 5)', () => {
    let state = createInitialRouteState(makeChange({}));
    state.status = 'BID_PENDING';
    state.window_opened_date = '2025-09-02';
    state.window_expires_date = addSchoolDays(calendar, '2025-09-02', 15);
    state.cumulative_drift_minutes = 35;
    state.contributing_change_ids = ['c1', 'c2'];
    state.segments.AM = '6:20-8:55';

    const reversal = makeChange({
      id: 'c3',
      delta_minutes: -10,
      effective_date: '2025-09-10',
      previous_time: '6:20-8:55',
      new_time: '6:25-8:55',
      submitted_at: '2025-09-10T08:00:00.000Z',
    });

    state = applyChangeToRoute(state, reversal, calendar);

    assert.equal(state.status, 'ACCUMULATING');
    assert.equal(state.cumulative_drift_minutes, 25);
    assert.deepEqual(state.contributing_change_ids, ['c1', 'c2', 'c3']);
  });

  it('starts a fresh window after a fully expired prior window (Rule 6)', () => {
    const first = makeChange({ id: 'c1', delta_minutes: 35 });
    let state = applyChangeToRoute(null, first, calendar);
    state = applyWindowExpiration(state, '2025-09-24');
    assert.equal(state.status, 'BID_PENDING');
    assert.equal(state.payroll_rounded_total_minutes, 150);

    const fresh = makeChange({
      id: 'c2',
      delta_minutes: 5,
      effective_date: '2025-10-06',
      previous_time: state.segments.AM,
      new_time: '6:25-8:55',
      submitted_at: '2025-10-06T08:00:00.000Z',
    });
    state = applyChangeToRoute(state, fresh, calendar);

    assert.equal(state.status, 'ACCUMULATING');
    assert.equal(state.cumulative_drift_minutes, 5);
    assert.deepEqual(state.contributing_change_ids, ['c2']);
    assert.equal(state.window_opened_date, '2025-10-06');
  });

  it('rebuilds route state from change log in effective-date order', () => {
    const changes = [
      makeChange({
        id: 'later-submitted-first',
        effective_date: '2025-09-10',
        delta_minutes: 5,
        submitted_at: '2025-09-01T08:00:00.000Z',
      }),
      makeChange({
        id: 'earlier-effective',
        effective_date: '2025-09-02',
        delta_minutes: 10,
        submitted_at: '2025-09-11T08:00:00.000Z',
      }),
    ];

    const state = rebuildRouteStateFromChangeLog(changes, {}, calendar, '2025-09-15');
    assert.equal(state['S 20'].cumulative_drift_minutes, 15);
    assert.deepEqual(state['S 20'].contributing_change_ids, [
      'earlier-effective',
      'later-submitted-first',
    ]);
  });

  it('expires all routes via applyAllWindowExpirations', () => {
    const change = makeChange({ delta_minutes: 10 });
    const routeState = {
      'S 20': applyChangeToRoute(null, change, calendar),
    };

    const expired = applyAllWindowExpirations(routeState, '2025-09-24');
    assert.equal(expired['S 20'].status, 'STABLE');
    assert.equal(expired['S 20'].payroll_rounded_total_minutes, 150);
  });

  it('appends a Change Report on window finalization during rebuild', () => {
    const changes = [
      makeChange({
        id: 'c1',
        delta_minutes: 7,
        previous_time: '6:35-8:55',
        new_time: '6:28-8:55',
      }),
    ];

    const state = rebuildRouteStateFromChangeLog(
      changes,
      {},
      calendar,
      '2025-09-24'
    );
    const route = state['S 20'];
    assert.equal(route.status, 'STABLE');
    assert.equal(route.change_reports?.length, 1);
    const report = route.change_reports[0];
    assert.equal(report.outcome, 'STABLE');
    assert.equal(report.contributing_changes.length, 1);
    assert.equal(report.contributing_changes[0].id, 'c1');
    assert.equal(report.before.math.exact_total_minutes, 140);
    assert.equal(report.after.math.exact_total_minutes, 147);
    assert.ok(report.contracted_hours_statement);
    assert.ok(report.see_the_math);
  });

  it('uses Routing-adjusted delta_minutes while preserving computed_delta_minutes', () => {
    const change = makeChange({
      id: 'c1',
      computed_delta_minutes: 7,
      delta_minutes: 10,
      routing_adjustment: {
        reason: 'Known driving-time discrepancy',
        adjusted_by: 'Routing Desk',
        adjusted_at: '2025-09-02T08:05:00.000Z',
      },
    });

    const state = applyChangeToRoute(null, change, calendar);
    assert.equal(state.cumulative_drift_minutes, 10);
    assert.equal(change.computed_delta_minutes, 7);
  });

  it('applies Admin ADJUSTMENT as effective delta on rebuild without editing the original', () => {
    const original = makeChange({
      id: 'c1',
      computed_delta_minutes: 35,
      delta_minutes: 35,
    });
    /** @type {import('../src/logic/stateMachine.js').AdjustmentEvent} */
    const adjustment = {
      id: 'adj-1',
      type: 'ADJUSTMENT',
      target_change_id: 'c1',
      previous_delta: 35,
      new_delta: 20,
      reason: 'Data entry correction',
      adjusted_by: 'Admin Assistant',
      adjusted_at: '2025-09-03T12:00:00.000Z',
    };

    const withoutAdj = rebuildRouteStateFromChangeLog(
      [original],
      {},
      calendar,
      '2025-09-15'
    );
    assert.equal(withoutAdj['S 20'].cumulative_drift_minutes, 35);

    const withAdj = rebuildRouteStateFromChangeLog(
      [original, adjustment],
      {},
      calendar,
      '2025-09-15'
    );
    assert.equal(withAdj['S 20'].cumulative_drift_minutes, 20);
    assert.equal(original.delta_minutes, 35);
    assert.equal(original.computed_delta_minutes, 35);
  });

  it('lets a later Admin ADJUSTMENT win when multiple amend the same change', () => {
    const original = makeChange({ id: 'c1', delta_minutes: 40 });
    const log = [
      original,
      {
        id: 'adj-1',
        type: 'ADJUSTMENT',
        target_change_id: 'c1',
        previous_delta: 40,
        new_delta: 32,
        reason: 'Data entry correction',
        adjusted_by: 'Admin',
        adjusted_at: '2025-09-03T10:00:00.000Z',
      },
      {
        id: 'adj-2',
        type: 'ADJUSTMENT',
        target_change_id: 'c1',
        previous_delta: 32,
        new_delta: 18,
        reason: 'Traffic pattern adjustment',
        adjusted_by: 'Admin',
        adjusted_at: '2025-09-04T10:00:00.000Z',
      },
    ];

    const state = rebuildRouteStateFromChangeLog(log, {}, calendar, '2025-09-15');
    assert.equal(state['S 20'].cumulative_drift_minutes, 18);
  });

  it('Admin ADJUSTMENT can pull a route under the bid threshold on rebuild', () => {
    const original = makeChange({ id: 'c1', delta_minutes: 35 });
    const adjustment = {
      id: 'adj-1',
      type: 'ADJUSTMENT',
      target_change_id: 'c1',
      previous_delta: 35,
      new_delta: 22,
      reason: 'Data entry correction',
      adjusted_by: 'Admin',
      adjusted_at: '2025-09-05T10:00:00.000Z',
    };

    // Without prior finalized state, rebuild applies the new outcome directly.
    const state = rebuildRouteStateFromChangeLog(
      [original, adjustment],
      {},
      calendar,
      '2025-09-24'
    );
    assert.equal(state['S 20'].status, 'STABLE');
    assert.equal(state['S 20'].payroll_rounded_total_minutes, 150);
  });

  it('silently recomputes when ADJUSTMENT lands before the window is finalized', () => {
    const original = makeChange({ id: 'c1', delta_minutes: 35 });
    const adjustment = {
      id: 'adj-1',
      type: 'ADJUSTMENT',
      target_change_id: 'c1',
      previous_delta: 35,
      new_delta: 22,
      reason: 'Data entry correction',
      adjusted_by: 'Admin',
      adjusted_at: '2025-09-05T10:00:00.000Z',
    };

    const priorOpen = rebuildRouteStateFromChangeLog(
      [original],
      {},
      calendar,
      '2025-09-10'
    );
    assert.equal(priorOpen['S 20'].status, 'ACCUMULATING');

    const afterAdj = rebuildRouteStateFromChangeLog(
      [original, adjustment],
      {},
      calendar,
      '2025-09-10',
      { priorRouteState: priorOpen }
    );
    assert.equal(afterAdj['S 20'].status, 'ACCUMULATING');
    assert.equal(afterAdj['S 20'].cumulative_drift_minutes, 22);
    assert.equal(afterAdj['S 20'].reconciliation ?? null, null);
  });

  it('flags NEEDS_REVIEW when ADJUSTMENT would flip a finalized BID_PENDING → STABLE', () => {
    const original = makeChange({ id: 'c1', delta_minutes: 35 });
    const adjustment = {
      id: 'adj-1',
      type: 'ADJUSTMENT',
      target_change_id: 'c1',
      previous_delta: 35,
      new_delta: 22,
      reason: 'Data entry correction',
      adjusted_by: 'Admin',
      adjusted_at: '2025-09-25T10:00:00.000Z',
    };

    const priorFinalized = rebuildRouteStateFromChangeLog(
      [original],
      {},
      calendar,
      '2025-09-24'
    );
    assert.equal(priorFinalized['S 20'].status, 'BID_PENDING');
    assert.equal(priorFinalized['S 20'].cumulative_drift_minutes, 35);

    const reconciled = rebuildRouteStateFromChangeLog(
      [original, adjustment],
      {},
      calendar,
      '2025-09-24',
      {
        priorRouteState: priorFinalized,
        lettersByRouteId: { 'S 20': true },
      }
    );

    assert.equal(reconciled['S 20'].status, 'NEEDS_REVIEW');
    assert.equal(reconciled['S 20'].cumulative_drift_minutes, 35);
    assert.equal(reconciled['S 20'].reconciliation?.previous_finalized_status, 'BID_PENDING');
    assert.equal(reconciled['S 20'].reconciliation?.computed_status, 'STABLE');
    assert.equal(reconciled['S 20'].reconciliation?.computed_cumulative_drift_minutes, 0);
    assert.equal(reconciled['S 20'].reconciliation?.computed_payroll_rounded_total_minutes, 150);
    assert.equal(reconciled['S 20'].reconciliation?.causing_adjustment_id, 'adj-1');
    assert.equal(reconciled['S 20'].reconciliation?.letter_or_action_exists, true);
    assert.equal(reconciled['S 20'].reconciliation?.raised_at, '2025-09-25T10:00:00.000Z');
    assert.deepEqual(reconciled['S 20'].pending_change_ids, []);
  });

  it('flags NEEDS_REVIEW for finalized flip even when no letter exists yet', () => {
    const original = makeChange({ id: 'c1', delta_minutes: 22 });
    const adjustment = {
      id: 'adj-1',
      type: 'ADJUSTMENT',
      target_change_id: 'c1',
      previous_delta: 22,
      new_delta: 35,
      reason: 'Data entry correction',
      adjusted_by: 'Admin',
      adjusted_at: '2025-09-25T10:00:00.000Z',
    };

    const priorFinalized = rebuildRouteStateFromChangeLog(
      [original],
      {},
      calendar,
      '2025-09-24'
    );
    assert.equal(priorFinalized['S 20'].status, 'STABLE');

    const reconciled = rebuildRouteStateFromChangeLog(
      [original, adjustment],
      {},
      calendar,
      '2025-09-24',
      {
        priorRouteState: priorFinalized,
        lettersByRouteId: { 'S 20': false },
      }
    );

    assert.equal(reconciled['S 20'].status, 'NEEDS_REVIEW');
    assert.equal(reconciled['S 20'].reconciliation?.previous_finalized_status, 'STABLE');
    assert.equal(reconciled['S 20'].reconciliation?.computed_status, 'BID_PENDING');
    assert.equal(reconciled['S 20'].reconciliation?.letter_or_action_exists, false);
    assert.equal(reconciled['S 20'].reconciliation?.causing_adjustment_id, 'adj-1');
    assert.equal(reconciled['S 20'].reconciliation?.raised_at, '2025-09-25T10:00:00.000Z');
    // Preserves communicated lock-in fields
    assert.equal(reconciled['S 20'].payroll_rounded_total_minutes, 150);
    assert.equal(reconciled['S 20'].cumulative_drift_minutes, 0);
  });

  it('clears NEEDS_REVIEW with a visible self-resolved history note', () => {
    const original = makeChange({ id: 'c1', delta_minutes: 35 });
    const adjDown = {
      id: 'adj-1',
      type: 'ADJUSTMENT',
      target_change_id: 'c1',
      previous_delta: 35,
      new_delta: 22,
      reason: 'Data entry correction',
      adjusted_by: 'Admin',
      adjusted_at: '2025-09-25T10:00:00.000Z',
    };
    const adjRestore = {
      id: 'adj-2',
      type: 'ADJUSTMENT',
      target_change_id: 'c1',
      previous_delta: 22,
      new_delta: 35,
      reason: 'Data entry correction',
      adjusted_by: 'Admin',
      adjusted_at: '2025-09-26T10:00:00.000Z',
    };

    const priorFinalized = rebuildRouteStateFromChangeLog(
      [original],
      {},
      calendar,
      '2025-09-24'
    );
    const needsReview = rebuildRouteStateFromChangeLog(
      [original, adjDown],
      {},
      calendar,
      '2025-09-24',
      { priorRouteState: priorFinalized }
    );
    assert.equal(needsReview['S 20'].status, 'NEEDS_REVIEW');
    assert.equal(needsReview['S 20'].reconciliation?.raised_at, '2025-09-25T10:00:00.000Z');

    const restored = rebuildRouteStateFromChangeLog(
      [original, adjDown, adjRestore],
      {},
      calendar,
      '2025-09-24',
      { priorRouteState: needsReview }
    );
    assert.equal(restored['S 20'].status, 'BID_PENDING');
    assert.equal(restored['S 20'].reconciliation ?? null, null);
    assert.equal(restored['S 20'].cumulative_drift_minutes, 35);
    assert.deepEqual(restored['S 20'].review_history, [
      {
        event: 'NEEDS_REVIEW_SELF_RESOLVED',
        previous_flag_raised_at: '2025-09-25T10:00:00.000Z',
        resolved_at: '2025-09-24T00:00:00.000Z',
        causing_adjustment_id: 'adj-2',
      },
    ]);
  });

  it('holds new ChangeEvents on a NEEDS_REVIEW route without advancing its window', () => {
    const original = makeChange({ id: 'c1', delta_minutes: 35 });
    const adjustment = {
      id: 'adj-1',
      type: 'ADJUSTMENT',
      target_change_id: 'c1',
      previous_delta: 35,
      new_delta: 22,
      reason: 'Data entry correction',
      adjusted_by: 'Admin',
      adjusted_at: '2025-09-25T10:00:00.000Z',
    };
    const queued = makeChange({
      id: 'c2',
      delta_minutes: 5,
      effective_date: '2025-09-26',
      submitted_at: '2025-09-26T09:00:00.000Z',
      previous_time: '6:20-8:55',
      new_time: '6:15-8:55',
    });

    const priorFinalized = rebuildRouteStateFromChangeLog(
      [original],
      {},
      calendar,
      '2025-09-24'
    );
    const needsReview = rebuildRouteStateFromChangeLog(
      [original, adjustment],
      {},
      calendar,
      '2025-09-24',
      { priorRouteState: priorFinalized }
    );
    assert.equal(needsReview['S 20'].status, 'NEEDS_REVIEW');

    const withQueued = rebuildRouteStateFromChangeLog(
      [original, adjustment, queued],
      {},
      calendar,
      '2025-09-26',
      { priorRouteState: needsReview }
    );

    assert.equal(withQueued['S 20'].status, 'NEEDS_REVIEW');
    assert.equal(withQueued['S 20'].cumulative_drift_minutes, 35);
    assert.deepEqual(withQueued['S 20'].pending_change_ids, ['c2']);
    assert.equal(withQueued['S 20'].window_opened_date, null);
    assert.notEqual(withQueued['S 20'].segments.AM, '6:15-8:55');
  });

  it('does not hold changes on other routes while one route is under review', () => {
    const routeA = makeChange({ id: 'a1', route_id: 'S 20', delta_minutes: 35 });
    const adjA = {
      id: 'adj-a',
      type: 'ADJUSTMENT',
      target_change_id: 'a1',
      previous_delta: 35,
      new_delta: 22,
      reason: 'Data entry correction',
      adjusted_by: 'Admin',
      adjusted_at: '2025-09-25T10:00:00.000Z',
    };
    const routeB = makeChange({
      id: 'b1',
      route_id: 'S 21',
      driver_name: 'Other Driver',
      delta_minutes: 10,
      effective_date: '2025-09-26',
      submitted_at: '2025-09-26T09:00:00.000Z',
    });

    const priorA = rebuildRouteStateFromChangeLog([routeA], {}, calendar, '2025-09-24');
    const needsReview = rebuildRouteStateFromChangeLog(
      [routeA, adjA],
      {},
      calendar,
      '2025-09-24',
      { priorRouteState: priorA }
    );

    const both = rebuildRouteStateFromChangeLog(
      [routeA, adjA, routeB],
      {},
      calendar,
      '2025-09-26',
      { priorRouteState: needsReview }
    );

    assert.equal(both['S 20'].status, 'NEEDS_REVIEW');
    assert.equal(both['S 21'].status, 'ACCUMULATING');
    assert.equal(both['S 21'].cumulative_drift_minutes, 10);
  });

  it('drains pending changes in arrival order after NEEDS_REVIEW self-resolves', () => {
    const original = makeChange({ id: 'c1', delta_minutes: 35 });
    const adjDown = {
      id: 'adj-1',
      type: 'ADJUSTMENT',
      target_change_id: 'c1',
      previous_delta: 35,
      new_delta: 22,
      reason: 'Data entry correction',
      adjusted_by: 'Admin',
      adjusted_at: '2025-09-25T10:00:00.000Z',
    };
    const queued = makeChange({
      id: 'c2',
      delta_minutes: 5,
      effective_date: '2025-09-26',
      submitted_at: '2025-09-26T09:00:00.000Z',
      previous_time: '6:20-8:55',
      new_time: '6:15-8:55',
    });
    const adjRestore = {
      id: 'adj-2',
      type: 'ADJUSTMENT',
      target_change_id: 'c1',
      previous_delta: 22,
      new_delta: 35,
      reason: 'Data entry correction',
      adjusted_by: 'Admin',
      adjusted_at: '2025-09-27T10:00:00.000Z',
    };

    const priorFinalized = rebuildRouteStateFromChangeLog(
      [original],
      {},
      calendar,
      '2025-09-24'
    );
    const needsReview = rebuildRouteStateFromChangeLog(
      [original, adjDown],
      {},
      calendar,
      '2025-09-24',
      { priorRouteState: priorFinalized }
    );
    const withQueued = rebuildRouteStateFromChangeLog(
      [original, adjDown, queued],
      {},
      calendar,
      '2025-09-26',
      { priorRouteState: needsReview }
    );
    assert.deepEqual(withQueued['S 20'].pending_change_ids, ['c2']);

    const restored = rebuildRouteStateFromChangeLog(
      [original, adjDown, queued, adjRestore],
      {},
      calendar,
      '2025-09-27',
      { priorRouteState: withQueued }
    );

    // Prior finalized BID_PENDING restored, then queued c2 opens a fresh window (Rule 6).
    assert.equal(restored['S 20'].status, 'ACCUMULATING');
    assert.equal(restored['S 20'].cumulative_drift_minutes, 5);
    assert.deepEqual(restored['S 20'].contributing_change_ids, ['c2']);
    assert.deepEqual(restored['S 20'].pending_change_ids, []);
    assert.equal(restored['S 20'].review_history?.[0]?.event, 'NEEDS_REVIEW_SELF_RESOLVED');
  });

  it('reassignment mid-window updates live driver without touching drift or countdown', () => {
    const change = makeChange({
      id: 'c1',
      driver_id: 'drv-jane',
      driver_name: 'Jane Driver',
      delta_minutes: 12,
    });
    const reassignment = {
      id: 'r1',
      type: 'REASSIGNMENT',
      route_id: 'S 20',
      previous_driver_id: 'drv-jane',
      previous_driver_name: 'Jane Driver',
      new_driver_id: 'drv-tammy',
      new_driver_name: 'Tammy Trapp',
      note: 'Sub covering while Jane is out',
      reassigned_by: 'Admin Assistant',
      reassigned_at: '2025-09-10T12:00:00.000Z',
    };

    const before = rebuildRouteStateFromChangeLog(
      [change],
      {},
      calendar,
      '2025-09-15'
    );
    const after = rebuildRouteStateFromChangeLog(
      [change, reassignment],
      {},
      calendar,
      '2025-09-15'
    );

    assert.equal(before['S 20'].status, 'ACCUMULATING');
    assert.equal(after['S 20'].status, 'ACCUMULATING');
    assert.equal(
      after['S 20'].cumulative_drift_minutes,
      before['S 20'].cumulative_drift_minutes
    );
    assert.equal(
      after['S 20'].window_expires_date,
      before['S 20'].window_expires_date
    );
    assert.equal(
      after['S 20'].window_opened_date,
      before['S 20'].window_opened_date
    );
    assert.deepEqual(
      after['S 20'].contributing_change_ids,
      before['S 20'].contributing_change_ids
    );
    assert.equal(after['S 20'].driver_id, 'drv-tammy');
    assert.equal(after['S 20'].driver_name, 'Tammy Trapp');
  });

  it('finalization Change Report uses current driver after mid-window reassignment', () => {
    const change = makeChange({
      id: 'c1',
      driver_id: 'drv-jane',
      driver_name: 'Jane Driver',
      delta_minutes: 7,
      previous_time: '6:35-8:55',
      new_time: '6:28-8:55',
    });
    const reassignment = {
      id: 'r1',
      type: 'REASSIGNMENT',
      route_id: 'S 20',
      previous_driver_id: 'drv-jane',
      previous_driver_name: 'Jane Driver',
      new_driver_id: 'drv-tammy',
      new_driver_name: 'Tammy Trapp',
      note: 'Permanent transfer',
      reassigned_by: 'Admin Assistant',
      reassigned_at: '2025-09-10T12:00:00.000Z',
    };

    const state = rebuildRouteStateFromChangeLog(
      [change, reassignment],
      {},
      calendar,
      '2025-09-24'
    );
    const route = state['S 20'];
    assert.equal(route.status, 'STABLE');
    assert.equal(route.change_reports?.length, 1);
    assert.equal(route.change_reports[0].driver_id, 'drv-tammy');
    assert.equal(route.change_reports[0].driver_name, 'Tammy Trapp');
    assert.equal(route.driver_id, 'drv-tammy');
  });

  it('finalization with Unassigned still builds a report and clears live driver', () => {
    const change = makeChange({
      id: 'c1',
      driver_id: 'drv-jane',
      driver_name: 'Jane Driver',
      delta_minutes: 7,
      previous_time: '6:35-8:55',
      new_time: '6:28-8:55',
    });
    const reassignment = {
      id: 'r1',
      type: 'REASSIGNMENT',
      route_id: 'S 20',
      previous_driver_id: 'drv-jane',
      previous_driver_name: 'Jane Driver',
      new_driver_id: null,
      new_driver_name: null,
      note: 'Sub-covered; leave unassigned until permanent returns',
      reassigned_by: 'Admin Assistant',
      reassigned_at: '2025-09-10T12:00:00.000Z',
    };

    const state = rebuildRouteStateFromChangeLog(
      [change, reassignment],
      {},
      calendar,
      '2025-09-24'
    );
    const route = state['S 20'];
    assert.equal(route.status, 'STABLE');
    assert.equal(route.change_reports?.length, 1);
    assert.equal(route.change_reports[0].driver_id, null);
    assert.equal(route.change_reports[0].driver_name, null);
    assert.equal(route.driver_id, null);
    assert.equal(route.driver_name, null);
    // Historical change attribution is untouched.
    assert.equal(change.driver_name, 'Jane Driver');
  });
});
