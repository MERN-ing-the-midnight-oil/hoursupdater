/**
 * Admin-driven bump decisions (Art. 3.08).
 * The app never auto-resolves a bump — it tracks state and reminds Admin.
 */

import { randomUUID } from 'node:crypto';
import { BUMP_DECISION_SCHOOL_DAYS } from '../config.js';
import { addSchoolDays } from './calendar.js';
import {
  cloneRouteState,
  isBumpDecisionEvent,
  isChangeEvent,
  isReassignmentEvent,
} from './stateMachine.js';
import { toDateString } from './timeUtils.js';

/**
 * @typedef {import('./stateMachine.js').RouteStateMap} RouteStateMap
 * @typedef {import('./stateMachine.js').RouteStateEntry} RouteStateEntry
 * @typedef {import('./stateMachine.js').LogEntry} LogEntry
 * @typedef {import('./stateMachine.js').BumpDecisionEvent} BumpDecisionEvent
 * @typedef {import('../data/storage.js').Driver} Driver
 */

/**
 * Elector is more senior than candidate only by hire_date / tie_break.
 * Name sort is never used — same-date hires without a recorded lots outcome
 * are not eligible bump targets.
 *
 * @param {Driver} elector
 * @param {Driver} candidate
 * @returns {boolean}
 */
export function isStrictlyJuniorDriver(elector, candidate) {
  if (!elector?.hire_date || !candidate?.hire_date) return false;
  const byDate = elector.hire_date.localeCompare(candidate.hire_date);
  if (byDate < 0) return true;
  if (byDate > 0) return false;
  const electorTie = elector.tie_break ?? null;
  const candidateTie = candidate.tie_break ?? null;
  if (electorTie == null || candidateTie == null) return false;
  return electorTie < candidateTie;
}

/**
 * Routes held by drivers junior to the electing driver (eligible bump targets).
 *
 * @param {{
 *   electing_driver_id: string,
 *   electing_route_id: string,
 *   drivers: Driver[],
 *   routeState: RouteStateMap,
 * }} input
 * @returns {{ route_id: string, driver_id: string, driver_name: string, hire_date: string | null }[]}
 */
export function listBumpTargets(input) {
  const elector = input.drivers.find(
    (d) => d.driver_id === input.electing_driver_id
  );
  if (!elector?.hire_date) return [];

  /** @type {{ route_id: string, driver_id: string, driver_name: string, hire_date: string | null }[]} */
  const targets = [];
  for (const [route_id, entry] of Object.entries(input.routeState)) {
    if (route_id === input.electing_route_id) continue;
    const driverId = entry.driver_id ?? null;
    if (!driverId) continue;
    const holder = input.drivers.find((d) => d.driver_id === driverId);
    if (!holder || !isStrictlyJuniorDriver(elector, holder)) continue;
    targets.push({
      route_id,
      driver_id: holder.driver_id,
      driver_name: holder.name,
      hire_date: holder.hire_date,
    });
  }
  targets.sort((a, b) => a.driver_name.localeCompare(b.driver_name));
  return targets;
}

/**
 * @param {Partial<BumpDecisionEvent>} event
 * @param {string[]} [allowedStaffNames]
 * @returns {string[]}
 */
export function validateBumpDecisionEvent(event, allowedStaffNames = []) {
  /** @type {string[]} */
  const errors = [];
  if (event.type !== 'BUMP_DECISION') {
    errors.push('type must be "BUMP_DECISION".');
  }
  if (!event.route_id?.trim()) {
    errors.push('route_id is required.');
  }
  const decision = event.decision;
  if (
    decision !== 'keep_assignment' &&
    decision !== 'elect_bump' &&
    decision !== 'accept_unassigned'
  ) {
    errors.push(
      'decision must be "keep_assignment", "elect_bump", or "accept_unassigned".'
    );
  }
  if (
    event.bump_kind !== 'original_decrease' &&
    event.bump_kind !== 'displacement'
  ) {
    errors.push('bump_kind must be "original_decrease" or "displacement".');
  }
  if (!event.bump_chain_id?.trim()) {
    errors.push('bump_chain_id is required.');
  }
  if (!Number.isInteger(event.bump_chain_link) || Number(event.bump_chain_link) < 1) {
    errors.push('bump_chain_link must be a positive integer.');
  }
  if (!event.note?.trim()) {
    errors.push('note is required.');
  }
  const decidedBy = event.decided_by?.trim() ?? '';
  if (!decidedBy) {
    errors.push('decided_by is required.');
  } else if (allowedStaffNames.length === 0) {
    errors.push(
      'No staff names configured. Add names in Admin settings before submitting.'
    );
  } else if (!allowedStaffNames.includes(decidedBy)) {
    errors.push('decided_by must be one of the configured staff names.');
  }
  if (!event.decided_at) {
    errors.push('decided_at is required.');
  }
  if (decision === 'elect_bump') {
    if (!event.target_route_id?.trim()) {
      errors.push('target_route_id is required for elect_bump.');
    }
    if (!event.target_driver_id?.trim()) {
      errors.push('target_driver_id is required for elect_bump.');
    }
  }
  if (
    event.bump_kind === 'original_decrease' &&
    decision === 'accept_unassigned'
  ) {
    errors.push(
      'accept_unassigned is only for displacement chain cards; use keep_assignment.'
    );
  }
  if (event.bump_kind === 'displacement' && decision === 'keep_assignment') {
    errors.push(
      'keep_assignment is only for original decrease cards; use accept_unassigned.'
    );
  }
  return errors;
}

/**
 * Clear bump-decision fields when leaving BUMP_ELIGIBLE.
 * @param {RouteStateEntry} entry
 * @returns {RouteStateEntry}
 */
function clearBumpFields(entry) {
  const next = cloneRouteState(entry);
  next.bump_decision_due_date = null;
  next.bump_chain_id = null;
  next.bump_chain_link = null;
  next.bump_kind = null;
  return next;
}

/**
 * Lock decreased hours in as STABLE baseline (same shape as bid award).
 * @param {RouteStateEntry} entry
 * @param {string} at
 * @returns {RouteStateEntry}
 */
function lockInStable(entry, at) {
  const next = clearBumpFields(entry);
  next.status = 'STABLE';
  next.baseline_segments = { ...next.segments };
  next.cumulative_drift_minutes = 0;
  next.contributing_change_ids = [];
  next.window_opened_date = null;
  next.window_expires_date = null;
  next.reconciliation = null;
  next.pending_change_ids = [];
  next.last_updated = at;
  return next;
}

/**
 * Whether a logged keep/accept should lock the route in on this rebuild.
 * Includes NEEDS_REVIEW rows where reconcile flipped STABLE↔BUMP_ELIGIBLE
 * after a prior keep (mirrors applyBidAwardResolutions forcing STABLE).
 * @param {RouteStateEntry} entry
 * @returns {boolean}
 */
function shouldApplyBumpLockIn(entry) {
  if (entry.status === 'BUMP_ELIGIBLE') return true;
  if (
    entry.status === 'NEEDS_REVIEW' &&
    entry.reconciliation?.computed_status === 'BUMP_ELIGIBLE'
  ) {
    return true;
  }
  return false;
}

/**
 * Preserve bump meta across rebuild so due dates / chain ids do not drift.
 * New BUMP_ELIGIBLE rows get a fresh chain id (written once, then preserved).
 *
 * @param {RouteStateMap} prior
 * @param {RouteStateMap} next
 * @returns {RouteStateMap}
 */
export function preserveBumpDecisionMeta(prior, next) {
  /** @type {RouteStateMap} */
  const updated = {};
  for (const [routeId, entry] of Object.entries(next)) {
    if (entry.status !== 'BUMP_ELIGIBLE') {
      updated[routeId] = clearBumpFields(entry);
      continue;
    }
    const p = prior[routeId];
    if (p?.status === 'BUMP_ELIGIBLE' && p.bump_chain_id) {
      updated[routeId] = {
        ...cloneRouteState(entry),
        bump_decision_due_date:
          p.bump_decision_due_date ?? entry.bump_decision_due_date ?? null,
        bump_chain_id: p.bump_chain_id,
        bump_chain_link: p.bump_chain_link ?? 1,
        bump_kind: p.bump_kind ?? 'original_decrease',
      };
      continue;
    }
    updated[routeId] = {
      ...cloneRouteState(entry),
      bump_chain_id: entry.bump_chain_id ?? randomUUID(),
      bump_chain_link: entry.bump_chain_link ?? 1,
      bump_kind: entry.bump_kind ?? 'original_decrease',
      bump_decision_due_date: entry.bump_decision_due_date ?? null,
    };
  }
  return updated;
}

/**
 * Apply logged Admin bump decisions after rebuild. Never invents outcomes.
 *
 * @param {RouteStateMap} routeStateMap
 * @param {LogEntry[]} changeLog
 * @param {import('./calendar.js').SchoolCalendar | string[]} [schoolCalendar]
 * @returns {RouteStateMap}
 */
export function applyBumpDecisions(routeStateMap, changeLog, schoolCalendar) {
  const decisions = changeLog
    .filter(isBumpDecisionEvent)
    .map((e) => /** @type {BumpDecisionEvent} */ (e))
    .sort((a, b) => a.decided_at.localeCompare(b.decided_at));

  if (!decisions.length) {
    return routeStateMap;
  }

  /** @type {RouteStateMap} */
  const updated = { ...routeStateMap };

  for (const decision of decisions) {
    const routeId = decision.route_id;
    const entry = updated[routeId];
    if (!entry) continue;

    if (decision.decision === 'keep_assignment') {
      if (!shouldApplyBumpLockIn(entry)) continue;
      updated[routeId] = lockInStable(entry, decision.decided_at);
      continue;
    }

    if (decision.decision === 'accept_unassigned') {
      if (!shouldApplyBumpLockIn(entry)) continue;
      updated[routeId] = lockInStable(entry, decision.decided_at);
      continue;
    }

    if (decision.decision === 'elect_bump') {
      // Source route stays BUMP_ELIGIBLE for the parked displaced driver.
      if (entry.status === 'BUMP_ELIGIBLE' || entry.status === 'STABLE') {
        let due = entry.bump_decision_due_date ?? null;
        if (schoolCalendar) {
          due = addSchoolDays(
            schoolCalendar,
            toDateString(decision.decided_at),
            BUMP_DECISION_SCHOOL_DAYS
          );
        }
        updated[routeId] = {
          ...cloneRouteState(entry),
          status: 'BUMP_ELIGIBLE',
          bump_kind: 'displacement',
          bump_chain_id: decision.bump_chain_id,
          bump_chain_link: decision.bump_chain_link + 1,
          bump_decision_due_date: due,
          last_updated: decision.decided_at,
        };
      }

      // Target route claimed by elector — lock to STABLE if it was open for bump.
      const targetId = decision.target_route_id;
      if (targetId && updated[targetId]) {
        const target = updated[targetId];
        if (target.status === 'BUMP_ELIGIBLE') {
          updated[targetId] = lockInStable(target, decision.decided_at);
        }
      }
    }
  }

  return updated;
}

/**
 * Count links in a bump chain for "link N of an ongoing vacancy chain" UI.
 *
 * @param {LogEntry[]} changeLog
 * @param {string} bumpChainId
 * @param {RouteStateMap} routeState
 * @returns {{ link: number, open_links: number, total_decisions: number }}
 */
export function bumpChainProgress(changeLog, bumpChainId, routeState) {
  const decisions = changeLog
    .filter(isBumpDecisionEvent)
    .map((e) => /** @type {BumpDecisionEvent} */ (e))
    .filter((e) => e.bump_chain_id === bumpChainId);

  const openOnChain = Object.values(routeState).filter(
    (e) => e.status === 'BUMP_ELIGIBLE' && e.bump_chain_id === bumpChainId
  );

  return {
    link: openOnChain[0]?.bump_chain_link ?? decisions.length + 1,
    open_links: openOnChain.length,
    total_decisions: decisions.length,
  };
}

/**
 * Whether the decision due date has passed (Admin still must act).
 * @param {string | null | undefined} dueDate
 * @param {string | Date} asOfDate
 * @returns {boolean}
 */
export function isBumpDecisionOverdue(dueDate, asOfDate = new Date()) {
  if (!dueDate) return false;
  return toDateString(asOfDate) > toDateString(dueDate);
}

/**
 * @param {LogEntry[]} changeLog
 * @returns {boolean}
 */
export function changeLogHasBumpDecision(changeLog) {
  return changeLog.some(isBumpDecisionEvent);
}

// Re-export for callers that only need bump helpers alongside event checks
export { isChangeEvent, isReassignmentEvent };
