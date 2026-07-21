import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBumpDecisions,
  isBumpDecisionOverdue,
  isStrictlyJuniorDriver,
  listBumpTargets,
  preserveBumpDecisionMeta,
  validateBumpDecisionEvent,
} from '../src/logic/bumpDecisions.js';
import { addSchoolDays } from '../src/logic/calendar.js';

const calendar = {
  school_year: '2025-2026',
  coverage_start: '2025-09-01',
  coverage_end: '2025-10-31',
  days: (() => {
    /** @type {{ date: string, is_school_day: boolean }[]} */
    const days = [];
    for (let d = 1; d <= 30; d += 1) {
      const date = `2025-09-${String(d).padStart(2, '0')}`;
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
      days.push({ date, is_school_day: dow !== 0 && dow !== 6 });
    }
    for (let d = 1; d <= 15; d += 1) {
      const date = `2025-10-${String(d).padStart(2, '0')}`;
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
      days.push({ date, is_school_day: dow !== 0 && dow !== 6 });
    }
    return days;
  })(),
};

describe('bump seniority targets', () => {
  const senior = {
    driver_id: 'drv-a',
    name: 'Alex Senior',
    email: null,
    hire_date: '2010-01-01',
    tie_break: null,
  };
  const junior = {
    driver_id: 'drv-b',
    name: 'Blake Junior',
    email: null,
    hire_date: '2018-01-01',
    tie_break: null,
  };
  const peer = {
    driver_id: 'drv-c',
    name: 'Casey Peer',
    email: null,
    hire_date: '2010-01-01',
    tie_break: null,
  };

  it('isStrictlyJuniorDriver uses hire_date only', () => {
    assert.equal(isStrictlyJuniorDriver(senior, junior), true);
    assert.equal(isStrictlyJuniorDriver(junior, senior), false);
    assert.equal(isStrictlyJuniorDriver(senior, peer), false);
  });

  it('listBumpTargets only returns junior holders on other routes', () => {
    const targets = listBumpTargets({
      electing_driver_id: 'drv-a',
      electing_route_id: 'X',
      drivers: [senior, junior, peer],
      routeState: {
        X: {
          driver_id: 'drv-a',
          driver_name: 'Alex Senior',
          status: 'BUMP_ELIGIBLE',
          segments: { AM: null, MIDDAY: null, PM: null },
          baseline_segments: { AM: null, MIDDAY: null, PM: null },
          window_opened_date: null,
          window_expires_date: null,
          cumulative_drift_minutes: -35,
          contributing_change_ids: [],
          payroll_rounded_total_minutes: 100,
          last_updated: '2025-10-01T00:00:00.000Z',
        },
        Y: {
          driver_id: 'drv-b',
          driver_name: 'Blake Junior',
          status: 'STABLE',
          segments: { AM: null, MIDDAY: null, PM: null },
          baseline_segments: { AM: null, MIDDAY: null, PM: null },
          window_opened_date: null,
          window_expires_date: null,
          cumulative_drift_minutes: 0,
          contributing_change_ids: [],
          payroll_rounded_total_minutes: 120,
          last_updated: '2025-09-01T00:00:00.000Z',
        },
        Z: {
          driver_id: 'drv-c',
          driver_name: 'Casey Peer',
          status: 'STABLE',
          segments: { AM: null, MIDDAY: null, PM: null },
          baseline_segments: { AM: null, MIDDAY: null, PM: null },
          window_opened_date: null,
          window_expires_date: null,
          cumulative_drift_minutes: 0,
          contributing_change_ids: [],
          payroll_rounded_total_minutes: 120,
          last_updated: '2025-09-01T00:00:00.000Z',
        },
      },
    });
    assert.equal(targets.length, 1);
    assert.equal(targets[0].driver_id, 'drv-b');
    assert.equal(targets[0].route_id, 'Y');
  });
});

describe('validateBumpDecisionEvent', () => {
  it('requires staff note and rejects mismatched kind/decision pairs', () => {
    const base = {
      type: 'BUMP_DECISION',
      route_id: 'X',
      decision: 'keep_assignment',
      bump_kind: 'original_decrease',
      bump_chain_id: 'chain-1',
      bump_chain_link: 1,
      electing_driver_id: 'drv-a',
      electing_driver_name: 'Alex',
      note: 'ok',
      decided_by: 'Rachel',
      decided_at: '2025-10-03T12:00:00.000Z',
    };
    assert.deepEqual(validateBumpDecisionEvent(base, ['Rachel']), []);
    assert.ok(
      validateBumpDecisionEvent(
        { ...base, decision: 'accept_unassigned' },
        ['Rachel']
      ).some((e) => /accept_unassigned/.test(e))
    );
    assert.ok(
      validateBumpDecisionEvent(
        { ...base, bump_kind: 'displacement', decision: 'keep_assignment' },
        ['Rachel']
      ).some((e) => /keep_assignment/.test(e))
    );
  });
});

describe('applyBumpDecisions (no auto outcomes)', () => {
  it('keep_assignment locks BUMP_ELIGIBLE into STABLE', () => {
    const state = {
      X: {
        driver_id: 'drv-a',
        driver_name: 'Alex',
        status: 'BUMP_ELIGIBLE',
        segments: { AM: '6:00-8:00', MIDDAY: null, PM: null },
        baseline_segments: { AM: '6:00-8:30', MIDDAY: null, PM: null },
        window_opened_date: null,
        window_expires_date: null,
        cumulative_drift_minutes: -35,
        contributing_change_ids: ['c1'],
        payroll_rounded_total_minutes: 120,
        bump_decision_due_date: '2025-10-03',
        bump_chain_id: 'chain-1',
        bump_chain_link: 1,
        bump_kind: 'original_decrease',
        last_updated: '2025-10-01T00:00:00.000Z',
      },
    };
    const next = applyBumpDecisions(
      state,
      [
        {
          id: 'bd1',
          type: 'BUMP_DECISION',
          route_id: 'X',
          decision: 'keep_assignment',
          bump_kind: 'original_decrease',
          bump_chain_id: 'chain-1',
          bump_chain_link: 1,
          electing_driver_id: 'drv-a',
          electing_driver_name: 'Alex',
          note: 'Driver keeps assignment',
          decided_by: 'Rachel',
          decided_at: '2025-10-02T12:00:00.000Z',
        },
      ],
      calendar
    );
    assert.equal(next.X.status, 'STABLE');
    assert.equal(next.X.cumulative_drift_minutes, 0);
    assert.equal(next.X.bump_chain_id, null);
    assert.deepEqual(next.X.baseline_segments, next.X.segments);
  });

  it('keep_assignment still locks when rebuild raised NEEDS_REVIEW after a prior keep', () => {
    const state = {
      X: {
        driver_id: 'drv-a',
        driver_name: 'Alex',
        status: 'NEEDS_REVIEW',
        segments: { AM: '6:00-8:00', MIDDAY: null, PM: null },
        baseline_segments: { AM: '6:00-8:00', MIDDAY: null, PM: null },
        window_opened_date: null,
        window_expires_date: null,
        cumulative_drift_minutes: 0,
        contributing_change_ids: [],
        payroll_rounded_total_minutes: 120,
        bump_decision_due_date: null,
        bump_chain_id: null,
        bump_chain_link: null,
        bump_kind: null,
        reconciliation: {
          previous_finalized_status: 'STABLE',
          computed_status: 'BUMP_ELIGIBLE',
          computed_cumulative_drift_minutes: -35,
          computed_payroll_rounded_total_minutes: 105,
          causing_adjustment_id: null,
          letter_or_action_exists: false,
          raised_at: '2025-10-03T00:00:00.000Z',
        },
        pending_change_ids: [],
        last_updated: '2025-10-03T00:00:00.000Z',
      },
    };
    const next = applyBumpDecisions(
      state,
      [
        {
          id: 'bd1',
          type: 'BUMP_DECISION',
          route_id: 'X',
          decision: 'keep_assignment',
          bump_kind: 'original_decrease',
          bump_chain_id: 'chain-1',
          bump_chain_link: 1,
          electing_driver_id: 'drv-a',
          electing_driver_name: 'Alex',
          note: 'Driver keeps assignment',
          decided_by: 'Rachel',
          decided_at: '2025-10-02T12:00:00.000Z',
        },
      ],
      calendar
    );
    assert.equal(next.X.status, 'STABLE');
    assert.equal(next.X.reconciliation, null);
    assert.equal(next.X.cumulative_drift_minutes, 0);
  });

  it('elect_bump opens a displacement card on the vacated route (no Unassigned)', () => {
    const state = {
      X: {
        driver_id: 'drv-b',
        driver_name: 'Blake',
        status: 'BUMP_ELIGIBLE',
        segments: { AM: '6:00-8:00', MIDDAY: null, PM: null },
        baseline_segments: { AM: '6:00-8:30', MIDDAY: null, PM: null },
        window_opened_date: null,
        window_expires_date: null,
        cumulative_drift_minutes: -35,
        contributing_change_ids: ['c1'],
        payroll_rounded_total_minutes: 120,
        bump_decision_due_date: '2025-10-03',
        bump_chain_id: 'chain-1',
        bump_chain_link: 1,
        bump_kind: 'original_decrease',
        last_updated: '2025-10-01T00:00:00.000Z',
      },
      Y: {
        driver_id: 'drv-a',
        driver_name: 'Alex',
        status: 'STABLE',
        segments: { AM: '7:00-9:00', MIDDAY: null, PM: null },
        baseline_segments: { AM: '7:00-9:00', MIDDAY: null, PM: null },
        window_opened_date: null,
        window_expires_date: null,
        cumulative_drift_minutes: 0,
        contributing_change_ids: [],
        payroll_rounded_total_minutes: 120,
        last_updated: '2025-09-01T00:00:00.000Z',
      },
    };
    const next = applyBumpDecisions(
      state,
      [
        {
          id: 'bd1',
          type: 'BUMP_DECISION',
          route_id: 'X',
          decision: 'elect_bump',
          bump_kind: 'original_decrease',
          bump_chain_id: 'chain-1',
          bump_chain_link: 1,
          electing_driver_id: 'drv-a',
          electing_driver_name: 'Alex',
          target_route_id: 'Y',
          target_driver_id: 'drv-b',
          target_driver_name: 'Blake',
          note: 'Elect bump',
          decided_by: 'Rachel',
          decided_at: '2025-10-02T12:00:00.000Z',
        },
      ],
      calendar
    );
    assert.equal(next.X.status, 'BUMP_ELIGIBLE');
    assert.equal(next.X.bump_kind, 'displacement');
    assert.equal(next.X.bump_chain_link, 2);
    assert.equal(next.X.bump_chain_id, 'chain-1');
    assert.equal(
      next.X.bump_decision_due_date,
      addSchoolDays(calendar, '2025-10-02', 2)
    );
    // Y stays STABLE — not auto-touched beyond what reassignment did
    assert.equal(next.Y.status, 'STABLE');
  });

  it('never flips overdue routes without a logged decision', () => {
    const state = {
      X: {
        driver_id: 'drv-a',
        driver_name: 'Alex',
        status: 'BUMP_ELIGIBLE',
        segments: { AM: '6:00-8:00', MIDDAY: null, PM: null },
        baseline_segments: { AM: '6:00-8:30', MIDDAY: null, PM: null },
        window_opened_date: null,
        window_expires_date: null,
        cumulative_drift_minutes: -35,
        contributing_change_ids: ['c1'],
        payroll_rounded_total_minutes: 120,
        bump_decision_due_date: '2025-09-05',
        bump_chain_id: 'chain-1',
        bump_chain_link: 1,
        bump_kind: 'original_decrease',
        last_updated: '2025-09-03T00:00:00.000Z',
      },
    };
    assert.equal(isBumpDecisionOverdue('2025-09-05', '2025-09-10'), true);
    const next = applyBumpDecisions(state, [], calendar);
    assert.equal(next.X.status, 'BUMP_ELIGIBLE');
  });

  it('preserveBumpDecisionMeta keeps chain id across rebuild', () => {
    const prior = {
      X: {
        status: 'BUMP_ELIGIBLE',
        bump_chain_id: 'stable-chain',
        bump_chain_link: 1,
        bump_kind: 'original_decrease',
        bump_decision_due_date: '2025-10-03',
        driver_id: 'a',
        driver_name: 'A',
        segments: { AM: null, MIDDAY: null, PM: null },
        baseline_segments: { AM: null, MIDDAY: null, PM: null },
        window_opened_date: null,
        window_expires_date: null,
        cumulative_drift_minutes: -30,
        contributing_change_ids: [],
        payroll_rounded_total_minutes: 100,
        last_updated: 't',
      },
    };
    const computed = {
      X: {
        ...prior.X,
        bump_chain_id: null,
        bump_decision_due_date: '2099-01-01',
      },
    };
    const preserved = preserveBumpDecisionMeta(prior, computed);
    assert.equal(preserved.X.bump_chain_id, 'stable-chain');
    assert.equal(preserved.X.bump_decision_due_date, '2025-10-03');
  });
});
