import {
  BID_RESPONSE_SCHOOL_DAYS,
  BID_THRESHOLD_MINUTES,
  BUMP_DECISION_SCHOOL_DAYS,
  SEGMENTS,
} from './constants.js';
import {
  addSchoolDays,
  isWindowExpired,
  nextCalendarDate,
} from './calendar.js';
import {
  contractWindowPlan,
  forcedContractOnDate,
  forcedContractOnPlan,
  forcedOctober1ContractPlan,
  isForcedOctober1Contract,
} from './contractWindows.js';
import {
  buildPayrollRoundingBreakdown,
  normalizeContractSnapBreaks,
  scheduleDateForMath,
  snappedContractScheduleDeltaMinutes,
  toDateString,
} from './timeUtils.js';
import { buildChangeReport } from './changeReport.js';

// Pass-through for payroll snap and optional snapped Art. 3.08 drift.
function contractRoundingOptions(options = {}) {
  const snapContractClocks = options.snapContractClocks === true;
  return {
    snapContractClocks,
    bidBumpUseSnappedTimes: options.bidBumpUseSnappedTimes === true,
    ...(snapContractClocks
      ? { contractSnapBreaks: normalizeContractSnapBreaks(options.contractSnapBreaks) }
      : {}),
  };
}

// Minutes that feed the open window / 30-minute threshold for this change.
// Default: exact wall-clock (or Admin override). With bidBumpUseSnappedTimes,
// use the snapped contracted daily-total difference unless Admin overrode the
// stored delta.
function driftDeltaForChange(changeEvent, segmentsAfter, deltaOverride, options = {}) {
  const adminOverride =
    typeof deltaOverride === 'number' && deltaOverride !== changeEvent.delta_minutes;
  if (adminOverride) return deltaOverride;

  if (
    options.bidBumpUseSnappedTimes === true &&
    options.snapContractClocks === true
  ) {
    const after = { ...(segmentsAfter || {}) };
    const before = {
      ...after,
      [changeEvent.segment]: changeEvent.previous_time,
    };
    return snappedContractScheduleDeltaMinutes(before, after, {
      contractSnapBreaks: options.contractSnapBreaks,
    });
  }

  return typeof deltaOverride === 'number' ? deltaOverride : changeEvent.delta_minutes;
}



// Route time change submitted by Routing. type is omitted or "CHANGE".

// Admin amendment to an earlier ChangeEvent. Append-only; never edits the original.

// Admin reassignment of which driver currently holds a route.
// Does not touch window status, drift, or countdown. Null new_* = Unassigned.
// Historical ChangeEvents / ADJUSTMENTs / reports are never rewritten.

// One-shot roster seed (drivers + routes + first assignments). Not a CHANGE —
// rebuild ignores this entry; seeded STABLE routes live in route-state.

// Admin resolution of an open NEEDS_REVIEW. Append-only; scoped to one discrepancy.
// Rebuild honors keep_prior / accept_computed only while the same discrepancy

// Admin resolution of BUMP_ELIGIBLE (original decrease or displacement chain).
// Append-only; the app never invents these — Admin always decides.

// Admin resolution of Art. 3.01 same-date seniority lots.
// Append-only audit; does not affect route rebuild.


// Held when an ADJUSTMENT would flip a finalized route's status after the
// window has already closed / an action was communicated. Admin must resolve.

// Audit trail for review flag lifecycle (self-resolve, and Admin resolve).


// A change logged while a 30-minute increase is already counting toward bid.
// Its minutes stay out of that bid clock. It has its own close date.


export function isAdjustmentEvent(entry) {
  return entry?.type === 'ADJUSTMENT';
}

export function isReassignmentEvent(entry) {
  return entry?.type === 'REASSIGNMENT';
}

export function isBulkImportEvent(entry) {
  return entry?.type === 'BULK_IMPORT';
}

export function isNeedsReviewResolutionEvent(entry) {
  return entry?.type === 'NEEDS_REVIEW_RESOLUTION';
}

export function isBumpDecisionEvent(entry) {
  return entry?.type === 'BUMP_DECISION';
}

export function isSeniorityTieResolutionEvent(entry) {
  return entry?.type === 'SENIORITY_TIE_RESOLUTION';
}

export function isChangeEvent(entry) {
  return (
    !isAdjustmentEvent(entry) &&
    !isReassignmentEvent(entry) &&
    !isBulkImportEvent(entry) &&
    !isNeedsReviewResolutionEvent(entry) &&
    !isBumpDecisionEvent(entry) &&
    !isSeniorityTieResolutionEvent(entry)
  );
}

// Whether a logged Admin resolution matches the discrepancy rebuild is looking at.
// Scoped — a newer causing adjustment or different status pair is a fresh conflict.
export function resolutionMatchesDiscrepancy(resolution, discrepancy) {
  return (
    (resolution.causing_adjustment_id ?? null) ===
      (discrepancy.causing_adjustment_id ?? null) &&
    resolution.previous_finalized_status ===
      discrepancy.previous_finalized_status &&
    resolution.computed_status === discrepancy.computed_status
  );
}

// Latest NEEDS_REVIEW_RESOLUTION for this route that matches the discrepancy.
export function findMatchingNeedsReviewResolution(
  changeLog,
  routeId,
  discrepancy
) {
  const matches = changeLog
    .filter(isNeedsReviewResolutionEvent)
    .map((entry) => (entry))
    .filter((entry) => entry.route_id === routeId)
    .filter((entry) => resolutionMatchesDiscrepancy(entry, discrepancy))
    .sort((a, b) => a.resolved_at.localeCompare(b.resolved_at));
  return matches.at(-1) ?? null;
}

// Live lookup: who holds this route as of a timestamp, from the append-only log.
// CHANGE stamps the driver at submission; REASSIGNMENT overrides going forward
export function resolveDriverAssignment(changeLog, routeId, asOfTimestamp) {
  let best = {
    found: false,
    driver_id: null,
    driver_name: null,
    at: null,
  };

  for (const entry of changeLog) {
    if (isChangeEvent(entry)) {
      const change = (entry);
      if (change.route_id !== routeId) continue;
      const at = change.submitted_at;
      if (!at || at > asOfTimestamp) continue;
      if (!best.at || at >= best.at) {
        best = {
          found: true,
          driver_id: change.driver_id ?? null,
          driver_name: change.driver_name?.trim() || null,
          at,
        };
      }
      continue;
    }

    if (isReassignmentEvent(entry)) {
      const reassignment = (entry);
      if (reassignment.route_id !== routeId) continue;
      const at = reassignment.reassigned_at;
      if (!at || at > asOfTimestamp) continue;
      if (!best.at || at >= best.at) {
        best = {
          found: true,
          driver_id: reassignment.new_driver_id ?? null,
          driver_name: reassignment.new_driver_name?.trim() || null,
          at,
        };
      }
    }
  }

  return best;
}

// Inclusive end of an as-of civil day (for including same-day event stamps).
// Date-only strings become 23:59:59.999Z; Date objects keep their instant.
function asOfInclusiveTimestamp(asOfDate) {
  if (asOfDate instanceof Date) {
    return asOfDate.toISOString();
  }
  const trimmed = String(asOfDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T23:59:59.999Z`;
  }
  return new Date(trimmed).toISOString();
}

// Overlay live driver assignment onto route state from the change log.
// Window / drift / status are untouched.
export function applyResolvedDrivers(routeStateMap, changeLog, asOfDate) {
  // Date-only asOf must include events stamped later the same day (Admin
  // reassign / bid award), not only those at midnight.
  const asOfIso = asOfInclusiveTimestamp(asOfDate);
  const updated = {};
  for (const [routeId, entry] of Object.entries(routeStateMap)) {
    const resolved = resolveDriverAssignment(changeLog, routeId, asOfIso);
    if (!resolved.found) {
      updated[routeId] = entry;
      continue;
    }
    updated[routeId] = {
      ...cloneRouteState(entry),
      driver_id: resolved.driver_id,
      driver_name: resolved.driver_name,
    };
  }
  return updated;
}

// When a BID_PENDING route has a later reassignment marked bid_awarded,
// clear into STABLE (baseline catches up). Ordinary reassignments leave status alone.
export function applyBidAwardResolutions(routeStateMap, changeLog) {
  const latestAwardByRoute = new Map();
  for (const entry of changeLog) {
    if (!isReassignmentEvent(entry)) continue;
    const reassignment = (entry);
    if (reassignment.resolution !== 'bid_awarded') continue;
    const prev = latestAwardByRoute.get(reassignment.route_id);
    if (!prev || reassignment.reassigned_at >= prev.reassigned_at) {
      latestAwardByRoute.set(reassignment.route_id, reassignment);
    }
  }
  if (!latestAwardByRoute.size) {
    return routeStateMap;
  }

  const updated = { ...routeStateMap };
  for (const [routeId, award] of latestAwardByRoute) {
    const entry = updated[routeId];
    if (!entry) continue;
    const awardable =
      entry.status === 'BID_PENDING' ||
      (entry.status === 'NEEDS_REVIEW' &&
        entry.reconciliation?.computed_status === 'BID_PENDING');
    if (!awardable) continue;

    const bidReport = [...(entry.change_reports ?? [])]
      .reverse()
      .find((r) => r.outcome === 'BID_PENDING');
    // Compare calendar days so same-day awards are not rejected when
    // finalized_at is midnight of asOf and the award stamp is earlier that day.
    if (
      bidReport?.finalized_at &&
      toDateString(award.reassigned_at) < toDateString(bidReport.finalized_at)
    ) {
      continue;
    }

    const next = cloneRouteState(entry);
    next.status = 'STABLE';
    next.baseline_segments = { ...next.segments };
    next.cumulative_drift_minutes = 0;
    next.contributing_change_ids = [];
    next.side_windows = [];
    next.window_opened_date = null;
    next.window_expires_date = null;
    next.window_rule = null;
    next.bump_decision_due_date = null;
    next.bump_chain_id = null;
    next.bump_chain_link = null;
    next.bump_kind = null;
    next.bid_response_due_date = null;
    next.bid_signup = null;
    next.reconciliation = null;
    next.pending_change_ids = [];
    next.last_updated = award.reassigned_at;
    updated[routeId] = next;
  }
  return updated;
}

export function emptySegments() {
  return { AM: null, MIDDAY: null, PM: null };
}

export function cloneRouteState(routeState) {
  return {
    ...routeState,
    segments: { ...routeState.segments },
    baseline_segments: { ...routeState.baseline_segments },
    contributing_change_ids: [...routeState.contributing_change_ids],
    side_windows: (routeState.side_windows ?? []).map((side) => ({
      ...side,
      contributing_change_ids: [...(side.contributing_change_ids ?? [])],
    })),
    pending_change_ids: [...(routeState.pending_change_ids ?? [])],
    review_history: [...(routeState.review_history ?? [])],
    change_reports: [...(routeState.change_reports ?? [])],
    reconciliation: routeState.reconciliation
      ? { ...routeState.reconciliation }
      : null,
  };
}

// Bootstrap a route that has no prior state using the first change event.
export function createInitialRouteState(changeEvent) {
  const segments = emptySegments();
  const baseline_segments = emptySegments();
  segments[changeEvent.segment] = changeEvent.previous_time;
  baseline_segments[changeEvent.segment] = changeEvent.previous_time;

  return {
    driver_name: changeEvent.driver_name?.trim() || null,
    driver_id: changeEvent.driver_id ?? null,
    segments,
    baseline_segments,
    status: 'STABLE',
    window_opened_date: null,
    window_expires_date: null,
    window_rule: null,
    cumulative_drift_minutes: 0,
    contributing_change_ids: [],
    side_windows: [],
    payroll_rounded_total_minutes: null,
    bump_decision_due_date: null,
    bump_chain_id: null,
    bump_chain_link: null,
    bump_kind: null,
    bid_response_due_date: null,
    bid_signup: null,
    reconciliation: null,
    pending_change_ids: [],
    review_history: [],
    change_reports: [],
    last_updated: changeEvent.submitted_at,
  };
}

// Window finalization outcome from exact cumulative drift.
// Magnitude uses the 30-minute threshold; sign distinguishes bid posting
export function windowFinalizationOutcome(exactDrift) {
  if (Math.abs(exactDrift) < BID_THRESHOLD_MINUTES) {
    return 'STABLE';
  }
  return exactDrift > 0 ? 'BID_PENDING' : 'BUMP_ELIGIBLE';
}

// Apply window expiration when 15 school days have passed with no extension.
// Rule 4: compare the exact unrounded cumulative_drift_minutes against the
// 30-minute bid threshold — never a rounded version of it.
// Payroll contracted hours: at finalization only, sum this route's own exact
// AM+MIDDAY+PM segment durations and round that total fresh via
// roundToQuarterHourForPayroll(). Never round a delta, never round per-segment,
// never build on a prior rounded value.
// When changeLog + routeId are provided, appends a Change Report to the route.
export function applyWindowExpiration(routeState, asOfDate, options = {}) {
  const withSideWindows = expireDueSideWindows(routeState, asOfDate, options);
  if (
    withSideWindows.status !== 'ACCUMULATING' &&
    withSideWindows.status !== 'BID_PENDING' &&
    withSideWindows.status !== 'BUMP_ELIGIBLE'
  ) {
    return withSideWindows;
  }
  routeState = withSideWindows;

  if (!isWindowExpired(asOfDate, routeState.window_expires_date)) {
    return routeState;
  }

  const state = cloneRouteState(routeState);
  const exactDrift = state.cumulative_drift_minutes;
  const rounding = contractRoundingOptions(options);
  const payrollBreakdown = buildPayrollRoundingBreakdown(state.segments, rounding);
  const payrollRoundedTotal = payrollBreakdown.payroll_rounded_total_minutes;
  const forcedOctober1 = state.window_rule === 'forced_october_1_contract';
  const forcedAccept = state.window_rule === 'forced_contract_on';
  const forcedContract = forcedOctober1 || forcedAccept;
  const outcome = forcedContract ? 'STABLE' : windowFinalizationOutcome(exactDrift);
  // Under-30 lock-in waits for admin Accept when the office asks for it.
  // Bid and bump still close on the Teamster date so those letters can go out.
  if (
    options.requireAcceptForStable === true &&
    outcome === 'STABLE' &&
    !forcedContract &&
    !windowHasForcedContract(state, options)
  ) {
    return state;
  }
  // The window closed the day after it expired. A later viewing date
  // must not move that close onto the day the calendar is opened.
  const closedOn = nextCalendarDate(state.window_expires_date);

  if (options.changeLog && options.routeId) {
    const effectiveDeltas =
      options.effectiveDeltas ?? resolveEffectiveDeltas(options.changeLog);
    const byId = new Map();
    for (const entry of options.changeLog) {
      if (isChangeEvent(entry)) {
        byId.set(entry.id, (entry));
      }
    }
    const contributing_changes = state.contributing_change_ids
      .map((id) => {
        const change = byId.get(id);
        if (!change) return null;
        return {
          ...change,
          effective_delta_minutes: effectiveDeltas.has(id)
            ? effectiveDeltas.get(id)
            : change.delta_minutes,
        };
      })
      .filter(Boolean);

    const finalized_at = `${closedOn}T00:00:00.000Z`;

    // Fresh lookup at finalization — not whoever was assigned when the window opened.
    const resolved = resolveDriverAssignment(
      options.changeLog,
      options.routeId,
      finalized_at
    );
    const reportDriverName = resolved.found
      ? resolved.driver_name
      : state.driver_name;
    const reportDriverId = resolved.found
      ? resolved.driver_id
      : (state.driver_id ?? null);

    const report = buildChangeReport({
      route_id: options.routeId,
      driver_name: reportDriverName,
      driver_id: reportDriverId,
      outcome,
      finalized_at,
      window_opened_date: state.window_opened_date,
      before_segments: { ...state.baseline_segments },
      after_segments: { ...state.segments },
      contributing_changes,
      forced_october_1: forcedOctober1,
      forced_contract_on:
        forcedAccept || (windowHasForcedContract(state, options) && !forcedOctober1)
          ? closedOn
          : false,
      ...rounding,
    });
    state.change_reports = [...(state.change_reports ?? []), report];

    // Keep live assignment on the route aligned with the same lookup.
    if (resolved.found) {
      state.driver_id = resolved.driver_id;
      state.driver_name = resolved.driver_name;
    }
  }

  if (outcome === 'STABLE') {
    // (a) Lock-in: baseline catches up; store rounded contracted total for Payroll.
    state.baseline_segments = { ...state.segments };
    state.status = 'STABLE';
    state.payroll_rounded_total_minutes = payrollRoundedTotal;
    state.cumulative_drift_minutes = 0;
    state.window_opened_date = null;
    state.window_expires_date = null;
    state.window_rule = null;
    state.contributing_change_ids = [];
    state.side_windows = [];
    state.bump_decision_due_date = null;
    state.bump_chain_id = null;
    state.bump_chain_link = null;
    state.bump_kind = null;
    state.bid_response_due_date = null;
    state.bid_signup = null;
  } else if (outcome === 'BID_PENDING') {
    // TODO: confirm interim pay handling during BID_PENDING — does the driver
    // get paid the new time immediately while a bid is pending, or only after
    // the bid resolves? Do not assume pay behavior here beyond status flagging.
    // (b) Bid posting (increase ≥ 30): keep exact cumulative for Admin.
    state.status = 'BID_PENDING';
    state.payroll_rounded_total_minutes = payrollRoundedTotal;
    state.window_opened_date = null;
    state.window_expires_date = null;
    state.window_rule = null;
    state.bump_decision_due_date = null;
    state.bump_chain_id = null;
    state.bump_chain_link = null;
    state.bump_kind = null;
    if (options.schoolCalendar) {
      state.bid_response_due_date = addSchoolDays(
        options.schoolCalendar,
        closedOn,
        BID_RESPONSE_SCHOOL_DAYS
      );
    } else {
      state.bid_response_due_date = null;
    }
  } else {
    // (c) Bump-eligible (decrease ≥ 30): current driver has a 2-school-day clock
    // to bump or keep the assignment — Art. 3.08(a)(8)(b) / (b)(2).
    // Chain id / kind are assigned (or preserved) after rebuild — not auto-resolved.
    state.status = 'BUMP_ELIGIBLE';
    state.payroll_rounded_total_minutes = payrollRoundedTotal;
    state.window_opened_date = null;
    state.window_expires_date = null;
    state.window_rule = null;
    if (options.schoolCalendar) {
      state.bump_decision_due_date = addSchoolDays(
        options.schoolCalendar,
        closedOn,
        BUMP_DECISION_SCHOOL_DAYS
      );
    } else {
      state.bump_decision_due_date = null;
    }
    state.bid_response_due_date = null;
  }

  return state;
}

// Whether a route has an open accumulation window on the given date.
export function hasOpenAccumulationWindow(routeState, asOfDate) {
  if (
    routeState.status !== 'ACCUMULATING' &&
    routeState.status !== 'BID_PENDING' &&
    routeState.status !== 'BUMP_ELIGIBLE'
  ) {
    return false;
  }
  return (
    !!routeState.window_expires_date &&
    !isWindowExpired(asOfDate, routeState.window_expires_date)
  );
}

// Resolve the effective (possibly Admin-adjusted) delta for each ChangeEvent.
// Starts from each event's delta_minutes, then applies ADJUSTMENT entries in
// adjusted_at order (last write wins). Does not change the 6 rules — only
// which exact unrounded number feeds them.
export function resolveEffectiveDeltas(changeLog) {
  const deltas = new Map();

  for (const entry of changeLog) {
    if (isChangeEvent(entry)) {
      const change = (entry);
      deltas.set(change.id, change.delta_minutes);
    }
  }

  const adjustments = changeLog
    .filter(isAdjustmentEvent)
    .map((entry) => (entry))
    .sort((a, b) => a.adjusted_at.localeCompare(b.adjusted_at));

  for (const adjustment of adjustments) {
    deltas.set(adjustment.target_change_id, adjustment.new_delta);
  }

  return deltas;
}

// Office override on the change being applied. Skips size and countdown rules
// for this schedule. A later change uses its own mark.
function forcesOctober1Contract(changeEvent) {
  return isForcedOctober1Contract(changeEvent?.force_oct1_contract);
}

function forcesContractOn(changeEvent) {
  return forcedContractOnDate(changeEvent?.force_contract_on);
}

function forcesAnyContract(changeEvent) {
  return forcesOctober1Contract(changeEvent) || Boolean(forcesContractOn(changeEvent));
}

// True when a contributing change already carries an Accept / Oct 1 mark.
function windowHasForcedContract(state, options = {}) {
  const ids = state?.contributing_change_ids || [];
  if (!ids.length) return false;
  const byId = new Map();
  for (const entry of options.changeLog || []) {
    if (entry?.id) byId.set(entry.id, entry);
  }
  for (const id of ids) {
    if (forcesAnyContract(byId.get(id))) return true;
  }
  return false;
}

function contractPlanForChange(changeEvent, changeDate, schoolCalendar, cumulativeDrift) {
  const acceptedOn = forcesContractOn(changeEvent);
  if (acceptedOn) return forcedContractOnPlan(acceptedOn, changeDate);
  if (forcesOctober1Contract(changeEvent)) return forcedOctober1ContractPlan(changeDate);
  return contractWindowPlan(schoolCalendar, changeDate, cumulativeDrift);
}

// Minutes on countdowns that were split off an open bid.
function sideWindowDrift(state) {
  return (state.side_windows ?? []).reduce(
    (sum, side) => sum + (side.drift_minutes || 0),
    0
  );
}

// True when this change leaves an already-qualified 30-minute increase
// at or above 30 minutes. The bid date stays. The change gets its own clock.
function keepsBidAboveThreshold(state, delta) {
  const rule = state.window_rule;
  if (rule !== 'post_october_1_bid' && rule !== 'pre_october_1_bid') {
    return false;
  }
  if ((state.cumulative_drift_minutes ?? 0) < BID_THRESHOLD_MINUTES) {
    return false;
  }
  const total =
    (state.cumulative_drift_minutes ?? 0) + sideWindowDrift(state) + delta;
  return total >= BID_THRESHOLD_MINUTES;
}

// Pull split-off changes back into the open bid window.
// Used when a later change drops the route under 30 minutes.
function foldSideWindows(state) {
  for (const side of state.side_windows ?? []) {
    state.cumulative_drift_minutes += side.drift_minutes || 0;
    state.contributing_change_ids.push(...(side.contributing_change_ids ?? []));
  }
  state.side_windows = [];
}

// Close side countdowns whose own date has passed. The bid window is left alone.
function expireDueSideWindows(routeState, asOfDate, options = {}) {
  const pending = routeState.side_windows ?? [];
  if (!pending.some((side) => isWindowExpired(asOfDate, side.expires_date))) {
    return routeState;
  }
  const state = cloneRouteState(routeState);
  const keep = [];
  for (const side of state.side_windows ?? []) {
    if (!isWindowExpired(asOfDate, side.expires_date)) {
      keep.push(side);
      continue;
    }
    const report = buildSeparateCountdownReport(state, side, options);
    if (report) {
      state.change_reports = [...(state.change_reports ?? []), report];
    }
  }
  state.side_windows = keep;
  return state;
}

// Record that a split-off change finished its own countdown.
// Does not move contracted hours or the bid window.
function buildSeparateCountdownReport(state, side, options) {
  if (!options.changeLog || !options.routeId) {
    return null;
  }
  const ids = new Set(side.contributing_change_ids ?? []);
  const changes = options.changeLog.filter(
    (entry) => isChangeEvent(entry) && ids.has(entry.id)
  );
  if (!changes.length) {
    return null;
  }
  const effectiveDeltas =
    options.effectiveDeltas ?? resolveEffectiveDeltas(options.changeLog);
  const contributing_changes = changes.map((change) => ({
    ...change,
    effective_delta_minutes: effectiveDeltas.has(change.id)
      ? effectiveDeltas.get(change.id)
      : change.delta_minutes,
  }));
  const before = { ...state.segments };
  for (const change of changes) {
    if (state.segments[change.segment] === change.new_time) {
      before[change.segment] = change.previous_time;
    }
  }
  const closedOn = nextCalendarDate(side.expires_date);
  const report = buildChangeReport({
    route_id: options.routeId,
    driver_name: state.driver_name,
    driver_id: state.driver_id ?? null,
    outcome: windowFinalizationOutcome(side.drift_minutes),
    finalized_at: `${closedOn}T00:00:00.000Z`,
    window_opened_date: side.opened_date,
    before_segments: before,
    after_segments: { ...state.segments },
    contributing_changes,
    ...contractRoundingOptions(options),
  });
  return { ...report, separate_countdown: true };
}

// Apply a single change event to one route's state (pure function).
export function applyChangeToRoute(
  routeState,
  changeEvent,
  schoolCalendar,
  asOfDate = changeEvent.effective_date,
  deltaOverride = undefined,
  options = {}
) {
  const changeDate = toDateString(asOfDate);
  const isFirstEvent = !routeState;
  let state = routeState
    ? cloneRouteState(routeState)
    : createInitialRouteState(changeEvent);
  const rounding = contractRoundingOptions(options);

  state = applyWindowExpiration(state, changeDate, {
    routeId: changeEvent.route_id,
    changeLog: options.changeLog,
    effectiveDeltas: options.effectiveDeltas,
    schoolCalendar,
    requireAcceptForStable: options.requireAcceptForStable === true,
    ...rounding,
  });

  state.driver_name = changeEvent.driver_name?.trim() || null;
  if (changeEvent.driver_id) {
    state.driver_id = changeEvent.driver_id;
  } else if (isFirstEvent) {
    state.driver_id = null;
  }
  state.segments[changeEvent.segment] = changeEvent.new_time;
  state.last_updated = changeEvent.submitted_at;

  // Exact wall-clock minutes by default. When bid/bump windows use snapped
  // contract times, the running total follows snapped daily contracted hours
  // instead. Admin ADJUSTMENT overrides still win.
  const delta = driftDeltaForChange(
    changeEvent,
    state.segments,
    deltaOverride,
    rounding
  );

  // Seed-only schedule write (create route / add another segment with no
  // prior→new change): update segment times only — do not open a 15-day window.
  if (delta === 0 && changeEvent.previous_time === changeEvent.new_time) {
    if (state.status === 'STABLE') {
      state.baseline_segments[changeEvent.segment] = changeEvent.new_time;
    }
    return state;
  }

  if (
    !forcesAnyContract(changeEvent) &&
    hasOpenAccumulationWindow(state, changeDate) &&
    keepsBidAboveThreshold(state, delta)
  ) {
    // Already qualified for bid. A change that stays at or above 30 minutes
    // does not move that date. It runs its own countdown.
    const aside = contractWindowPlan(schoolCalendar, changeDate, delta);
    state.side_windows = [
      ...(state.side_windows ?? []),
      {
        id: changeEvent.id,
        opened_date: changeDate,
        expires_date: aside.window_expires_date,
        becomes_on: aside.becomes_effective_on,
        rule: aside.rule,
        drift_minutes: delta,
        contributing_change_ids: [changeEvent.id],
      },
    ];
    return applyWindowExpiration(state, changeDate, {
      routeId: changeEvent.route_id,
      changeLog: options.changeLog,
      effectiveDeltas: options.effectiveDeltas,
      schoolCalendar,
      requireAcceptForStable: options.requireAcceptForStable === true,
      ...rounding,
    });
  }

  if (hasOpenAccumulationWindow(state, changeDate)) {
    foldSideWindows(state);
    // Rule 3: extend existing window (sum drift deltas; payroll rounds at lock-in)
    state.cumulative_drift_minutes += delta;
    state.contributing_change_ids.push(changeEvent.id);

    // Rule 5: reversal from bid/bump flag back to ACCUMULATING
    // Threshold uses exact unrounded cumulative — no rounding artifact.
    if (
      (state.status === 'BID_PENDING' || state.status === 'BUMP_ELIGIBLE') &&
      Math.abs(state.cumulative_drift_minutes) < BID_THRESHOLD_MINUTES
    ) {
      state.status = 'ACCUMULATING';
      state.bump_decision_due_date = null;
      state.bump_chain_id = null;
      state.bump_chain_link = null;
      state.bump_kind = null;
      state.bid_response_due_date = null;
      state.bid_signup = null;
    }
  } else {
    // Rule 2 / Rule 6: open a fresh window (STABLE after lock-in, or closed bid/bump)
    state.status = 'ACCUMULATING';
    state.window_opened_date = changeDate;
    state.cumulative_drift_minutes = delta;
    state.contributing_change_ids = [changeEvent.id];
    state.bump_decision_due_date = null;
    state.bump_chain_id = null;
    state.bump_chain_link = null;
    state.bump_kind = null;
    state.bid_response_due_date = null;
    state.bid_signup = null;
  }

  const plan = contractPlanForChange(
    changeEvent,
    changeDate,
    schoolCalendar,
    state.cumulative_drift_minutes
  );
  state.window_expires_date = plan.window_expires_date;
  state.window_rule = plan.rule;

  // Art. 3.08(a)(8)(b): a 30+ minute decrease before October 1 is bump-eligible
  // on the determination date — expire immediately when the new window already ended.
  return applyWindowExpiration(state, changeDate, {
    routeId: changeEvent.route_id,
    changeLog: options.changeLog,
    effectiveDeltas: options.effectiveDeltas,
    schoolCalendar,
    requireAcceptForStable: options.requireAcceptForStable === true,
    ...rounding,
  });
}

// Expire windows across all routes as of a given date (no new change applied).
export function applyAllWindowExpirations(routeStateMap, asOfDate, options = {}) {
  const rounding = contractRoundingOptions(options);
  const updated = {};
  for (const [routeId, entry] of Object.entries(routeStateMap)) {
    updated[routeId] = applyWindowExpiration(entry, asOfDate, {
      routeId,
      changeLog: options.changeLog,
      effectiveDeltas: options.effectiveDeltas,
      schoolCalendar: options.schoolCalendar,
      requireAcceptForStable: options.requireAcceptForStable === true,
      ...rounding,
    });
  }
  return updated;
}

// A route is "finalized" once its accumulation window has closed into a
// lock-in (STABLE with a payroll figure), a bid flag (BID_PENDING), a bump
// option (BUMP_ELIGIBLE), or it is already waiting on Admin review of such a flip.
export function isFinalizedRouteEntry(entry) {
  if (!entry) {
    return false;
  }
  if (
    entry.status === 'BID_PENDING' ||
    entry.status === 'BUMP_ELIGIBLE' ||
    entry.status === 'NEEDS_REVIEW'
  ) {
    return true;
  }
  return (
    entry.status === 'STABLE' && entry.payroll_rounded_total_minutes != null
  );
}

// The real-world-facing finalized status that was (or is being) communicated.
export function getPreviousFinalizedStatus(entry) {
  if (entry.status === 'NEEDS_REVIEW') {
    return entry.reconciliation?.previous_finalized_status ?? null;
  }
  if (entry.status === 'BID_PENDING') {
    return 'BID_PENDING';
  }
  if (entry.status === 'BUMP_ELIGIBLE') {
    return 'BUMP_ELIGIBLE';
  }
  if (entry.status === 'STABLE' && entry.payroll_rounded_total_minutes != null) {
    return 'STABLE';
  }
  return null;
}

// Most recent ADJUSTMENT that targets a ChangeEvent on this route.
export function findCausingAdjustment(changeLog, routeId) {
  const changeIds = new Set(
    changeLog
      .filter(isChangeEvent)
      .map((entry) => (entry))
      .filter((change) => change.route_id === routeId)
      .map((change) => change.id)
  );

  const adjustments = changeLog
    .filter(isAdjustmentEvent)
    .map((entry) => (entry))
    .filter((adjustment) => changeIds.has(adjustment.target_change_id))
    .sort((a, b) => a.adjusted_at.localeCompare(b.adjusted_at));

  return adjustments.at(-1) ?? null;
}

// Timestamp after which new ChangeEvents are held while NEEDS_REVIEW is open.
// Per-route only — other routes are unaffected.
export function getReviewHoldAfter(prior) {
  if (!prior || prior.status !== 'NEEDS_REVIEW') {
    return null;
  }
  return prior.reconciliation?.raised_at ?? prior.last_updated;
}

// Split route changes into those eligible for window math vs held for later.
export function splitBaseAndPendingChanges(routeChanges, holdAfter) {
  if (!holdAfter) {
    return { base: routeChanges, pending: [] };
  }
  return {
    base: routeChanges.filter((change) => change.submitted_at <= holdAfter),
    pending: routeChanges.filter((change) => change.submitted_at > holdAfter),
  };
}

// Apply queued ChangeEvents in arrival order after a NEEDS_REVIEW is resolved.
// Uses the existing applyChangeToRoute / applyWindowExpiration path unchanged.
export function applyPendingChanges(
  routeState,
  pendingChanges,
  schoolCalendar,
  effectiveDeltas = new Map(),
  asOfDate = new Date(),
  options = {}
) {
  let state = cloneRouteState(routeState);
  state.pending_change_ids = [];
  state.reconciliation = null;

  const ordered = [...pendingChanges].sort((a, b) =>
    a.submitted_at.localeCompare(b.submitted_at)
  );

  const reportOptions = {
    changeLog: options.changeLog,
    effectiveDeltas,
    requireAcceptForStable: options.requireAcceptForStable === true,
    ...contractRoundingOptions(options),
  };

  for (const change of ordered) {
    const delta = effectiveDeltas.has(change.id)
      ? effectiveDeltas.get(change.id)
      : change.delta_minutes;
    state = applyChangeToRoute(
      state,
      change,
      schoolCalendar,
      change.effective_date,
      delta,
      reportOptions
    );
  }

  return applyWindowExpiration(state, asOfDate, {
    routeId: ordered[0]?.route_id,
    schoolCalendar,
    ...reportOptions,
  });
}

function toIsoTimestamp(asOfDate) {
  if (asOfDate instanceof Date) {
    return asOfDate.toISOString();
  }
  const trimmed = String(asOfDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`;
  }
  return new Date(trimmed).toISOString();
}

// When an ADJUSTMENT would flip a finalized route's status, preserve the
// previously communicated state and flag NEEDS_REVIEW for Admin. Open-window
// routes (ACCUMULATING) keep the silently recomputed state.
// Self-resolved discrepancies append a review_history note, then drain any
// pending ChangeEvents for that route in arrival order.
export function reconcileFinalizedStatusFlips(
  priorRouteState,
  computedRouteState,
  changeLog,
  options = {}
) {
  const lettersByRouteId = options.lettersByRouteId ?? {};
  const pendingByRoute = options.pendingByRoute ?? {};
  const schoolCalendar = options.schoolCalendar;
  const effectiveDeltas = options.effectiveDeltas ?? new Map();
  const asOfDate = options.asOfDate ?? new Date();
  const resolvedAt = toIsoTimestamp(asOfDate);

  const result = { ...computedRouteState };

  const routeIds = new Set([
    ...Object.keys(priorRouteState),
    ...Object.keys(computedRouteState),
  ]);

  for (const routeId of routeIds) {
    const prior = priorRouteState[routeId];
    const computed = computedRouteState[routeId];
    if (!prior || !computed) {
      continue;
    }

    // Adjustments before finalization: window still open → silent recompute.
    if (!isFinalizedRouteEntry(prior)) {
      continue;
    }

    const previousFinalized = getPreviousFinalizedStatus(prior);
    const computedStatus = computed.status;

    if (!previousFinalized) {
      continue;
    }

    const pending = pendingByRoute[routeId] ?? [];
    const causing = findCausingAdjustment(changeLog, routeId);
    const discrepancy = {
      causing_adjustment_id: causing?.id ?? null,
      previous_finalized_status: previousFinalized,
      computed_status: computedStatus,
    };
    const adminResolution = findMatchingNeedsReviewResolution(
      changeLog,
      routeId,
      discrepancy
    );

    // Discrepancy cleared — leave an audit trace, then process any held changes.
    if (computedStatus === previousFinalized) {
      let historyNote = null;
      if (prior.status === 'NEEDS_REVIEW') {
        historyNote = {
          event: 'NEEDS_REVIEW_SELF_RESOLVED',
          previous_flag_raised_at: prior.reconciliation?.raised_at ?? null,
          resolved_at: resolvedAt,
          causing_adjustment_id:
            causing?.id ?? prior.reconciliation?.causing_adjustment_id ?? null,
        };
      }

      let next = {
        ...computed,
        reconciliation: null,
        pending_change_ids: [],
        review_history: [
          ...(prior.review_history ?? []),
          ...(historyNote ? [historyNote] : []),
        ],
      };

      if (pending.length > 0 && schoolCalendar) {
        next = applyPendingChanges(
          next,
          pending,
          schoolCalendar,
          effectiveDeltas,
          asOfDate,
          {
            changeLog,
            ...contractRoundingOptions(options),
          }
        );
        next.review_history = [
          ...(prior.review_history ?? []),
          ...(historyNote ? [historyNote] : []),
        ];
      }

      result[routeId] = next;
      continue;
    }

    // Admin already resolved this exact discrepancy — honor keep_prior / accept_computed.
    if (adminResolution?.resolution === 'keep_prior') {
      const historyNote = historyNoteFromResolution(prior, adminResolution);
      result[routeId] = {
        ...cloneRouteState(prior),
        status: previousFinalized,
        reconciliation: null,
        pending_change_ids: [],
        review_history: withAdminHistory(prior, historyNote),
        bump_decision_due_date:
          previousFinalized === 'BUMP_ELIGIBLE'
            ? (prior.bump_decision_due_date ?? null)
            : null,
        bump_chain_id:
          previousFinalized === 'BUMP_ELIGIBLE'
            ? (prior.bump_chain_id ?? null)
            : null,
        bump_chain_link:
          previousFinalized === 'BUMP_ELIGIBLE'
            ? (prior.bump_chain_link ?? null)
            : null,
        bump_kind:
          previousFinalized === 'BUMP_ELIGIBLE'
            ? (prior.bump_kind ?? 'original_decrease')
            : null,
      };
      continue;
    }

    if (adminResolution?.resolution === 'accept_computed') {
      const historyNote = historyNoteFromResolution(prior, adminResolution);
      let next = {
        ...computed,
        reconciliation: null,
        pending_change_ids: [],
        review_history: withAdminHistory(prior, historyNote),
      };
      if (pending.length > 0 && schoolCalendar) {
        next = applyPendingChanges(
          next,
          pending,
          schoolCalendar,
          effectiveDeltas,
          asOfDate,
          {
            changeLog,
            ...contractRoundingOptions(options),
          }
        );
        next.review_history = withAdminHistory(prior, historyNote);
      }
      result[routeId] = next;
      continue;
    }

    if (
      computedStatus !== 'STABLE' &&
      computedStatus !== 'BID_PENDING' &&
      computedStatus !== 'BUMP_ELIGIBLE' &&
      computedStatus !== 'ACCUMULATING'
    ) {
      continue;
    }

    const letterOrActionExists = lettersByRouteId[routeId] === true;
    const raisedAt =
      prior.status === 'NEEDS_REVIEW'
        ? (prior.reconciliation?.raised_at ?? prior.last_updated)
        : (causing?.adjusted_at ?? resolvedAt);

    // Preserve previously communicated operational fields; hold pending changes.
    result[routeId] = {
      ...cloneRouteState(prior),
      status: 'NEEDS_REVIEW',
      pending_change_ids: pending.map((change) => change.id),
      review_history: [...(prior.review_history ?? [])],
      reconciliation: {
        previous_finalized_status: previousFinalized,
        computed_status: computedStatus,
        computed_cumulative_drift_minutes: computed.cumulative_drift_minutes,
        computed_payroll_rounded_total_minutes:
          computed.payroll_rounded_total_minutes,
        causing_adjustment_id: causing?.id ?? null,
        letter_or_action_exists: letterOrActionExists,
        raised_at: raisedAt,
      },
      last_updated: computed.last_updated,
    };
  }

  return result;
}

function historyNoteFromResolution(prior, resolution) {
  return {
    event: 'NEEDS_REVIEW_ADMIN_RESOLVED',
    resolution: resolution.resolution,
    previous_flag_raised_at:
      prior.status === 'NEEDS_REVIEW'
        ? (prior.reconciliation?.raised_at ?? null)
        : null,
    resolved_at: resolution.resolved_at,
    causing_adjustment_id: resolution.causing_adjustment_id ?? null,
    resolved_by: resolution.resolved_by ?? null,
    resolution_event_id: resolution.id,
    note: resolution.note ?? null,
  };
}

// Avoid duplicating the same Admin resolution note on every rebuild.
function withAdminHistory(prior, historyNote) {
  const existing = [...(prior.review_history ?? [])];
  if (
    historyNote.resolution_event_id &&
    existing.some(
      (item) => item.resolution_event_id === historyNote.resolution_event_id
    )
  ) {
    return existing;
  }
  return [...existing, historyNote];
}

// Rebuild route-state from the full change log in chronological order.
// ADJUSTMENT entries amend the effective delta of a prior ChangeEvent; they
// do not open/extend windows themselves.
// Pass `priorRouteState` so that ADJUSTMENTs which would flip an already-finalized
// status become NEEDS_REVIEW. While a route is in NEEDS_REVIEW, new ChangeEvents
// for that route are logged but held in pending_change_ids until review resolves.
// Other routes are unaffected. Window/threshold math is unchanged — only eligibility
// to open/advance a window is gated.
export function rebuildRouteStateFromChangeLog(
  changeLog,
  initialState = {},
  schoolCalendar,
  asOfDate = new Date(),
  options = {}
) {
  const effectiveDeltas = resolveEffectiveDeltas(changeLog);
  const priorRouteState = options.priorRouteState ?? {};

  const changesByRoute = {};
  for (const entry of changeLog) {
    if (!isChangeEvent(entry)) continue;
    const change = (entry);
    if (!changesByRoute[change.route_id]) changesByRoute[change.route_id] = [];
    changesByRoute[change.route_id].push(change);
  }
  const anchorByRoute = {};
  for (const [routeId, routeChanges] of Object.entries(changesByRoute)) {
    const anchor = routeChanges
      .map((change) => String(change.effective_date ?? '').trim())
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .sort()[0] || toDateString(asOfDate);
    anchorByRoute[routeId] = anchor;
    routeChanges.sort((a, b) => {
      const dateCompare = scheduleDateForMath(a.effective_date, anchor).localeCompare(
        scheduleDateForMath(b.effective_date, anchor)
      );
      if (dateCompare !== 0) return dateCompare;
      return a.submitted_at.localeCompare(b.submitted_at);
    });
  }

  const pendingByRoute = {};
  let state = { ...initialState };

  for (const [routeId, routeChanges] of Object.entries(changesByRoute)) {
    const holdAfter = getReviewHoldAfter(priorRouteState[routeId]);
    const { base, pending } = splitBaseAndPendingChanges(routeChanges, holdAfter);
    pendingByRoute[routeId] = pending;

    const reportOptions = {
      changeLog,
      effectiveDeltas,
      requireAcceptForStable: options.requireAcceptForStable === true,
      ...contractRoundingOptions(options),
    };
    for (const change of base) {
      const effectiveDelta = effectiveDeltas.has(change.id)
        ? effectiveDeltas.get(change.id)
        : change.delta_minutes;
      state[routeId] = applyChangeToRoute(
        state[routeId],
        change,
        schoolCalendar,
        scheduleDateForMath(change.effective_date, anchorByRoute[routeId]),
        effectiveDelta,
        reportOptions
      );
    }
  }

  const computed = applyAllWindowExpirations(state, asOfDate, {
    changeLog,
    effectiveDeltas,
    schoolCalendar,
    requireAcceptForStable: options.requireAcceptForStable === true,
    ...contractRoundingOptions(options),
  });

  if (!options.priorRouteState) {
    return applyResolvedDrivers(computed, changeLog, asOfDate);
  }

  return applyResolvedDrivers(
    reconcileFinalizedStatusFlips(
      priorRouteState,
      computed,
      changeLog,
      {
        lettersByRouteId: options.lettersByRouteId,
        pendingByRoute,
        schoolCalendar,
        effectiveDeltas,
        asOfDate,
        ...contractRoundingOptions(options),
      }
    ),
    changeLog,
    asOfDate
  );
}

// Validate a ChangeEvent before append.
export function validateChangeEvent(
  event,
  allowedAdjustmentReasons = [],
  allowedStaffNames = []
) {
  const errors = [];

  if (!event.route_id?.trim()) {
    errors.push('route_id is required.');
  }
  // driver_name may be empty for Unassigned (new route created without a driver).
  if (typeof event.driver_name !== 'string') {
    errors.push('driver_name must be a string (use empty string for Unassigned).');
  }
  if (!event.segment || !SEGMENTS.includes(event.segment)) {
    errors.push(`segment must be one of: ${SEGMENTS.join(', ')}.`);
  }
  if (event.effective_date != null && String(event.effective_date).trim() && !/^\d{4}-\d{2}-\d{2}$/.test(String(event.effective_date).trim())) {
    errors.push('effective_date must be YYYY-MM-DD or null.');
  }
  if (!event.previous_time?.trim()) {
    errors.push('previous_time is required.');
  }
  if (!event.new_time?.trim()) {
    errors.push('new_time is required.');
  }
  if (
    typeof event.computed_delta_minutes !== 'number' ||
    Number.isNaN(event.computed_delta_minutes)
  ) {
    errors.push('computed_delta_minutes must be a number.');
  }
  if (typeof event.delta_minutes !== 'number' || Number.isNaN(event.delta_minutes)) {
    errors.push('delta_minutes must be a number.');
  }

  const enteredBy = event.entered_by?.trim() ?? '';
  if (!enteredBy) {
    errors.push('entered_by is required.');
  } else if (allowedStaffNames.length === 0) {
    errors.push(
      'No staff names configured. Add names in Admin settings before submitting.'
    );
  } else if (!allowedStaffNames.includes(enteredBy)) {
    errors.push('entered_by must be one of the configured staff names.');
  }

  const computed = event.computed_delta_minutes;
  const used = event.delta_minutes;
  const wasAdjusted =
    typeof computed === 'number' &&
    typeof used === 'number' &&
    computed !== used;

  if (wasAdjusted) {
    if (!event.routing_adjustment) {
      errors.push(
        'routing_adjustment is required when delta_minutes differs from computed_delta_minutes.'
      );
    } else {
      if (!event.routing_adjustment.reason?.trim()) {
        errors.push('routing_adjustment.reason is required.');
      } else if (
        allowedAdjustmentReasons.length > 0 &&
        !allowedAdjustmentReasons.includes(event.routing_adjustment.reason)
      ) {
        errors.push(
          'routing_adjustment.reason must be one of the configured adjustment reasons.'
        );
      }
      const adjustedBy = event.routing_adjustment.adjusted_by?.trim() ?? '';
      if (!adjustedBy) {
        errors.push('routing_adjustment.adjusted_by is required.');
      } else if (
        allowedStaffNames.length > 0 &&
        !allowedStaffNames.includes(adjustedBy)
      ) {
        errors.push(
          'routing_adjustment.adjusted_by must be one of the configured staff names.'
        );
      }
      if (!event.routing_adjustment.adjusted_at) {
        errors.push('routing_adjustment.adjusted_at is required.');
      }
    }
  } else if (event.routing_adjustment != null) {
    errors.push(
      'routing_adjustment must be null when delta_minutes equals computed_delta_minutes.'
    );
  }

  return errors;
}

// Validate an Admin ADJUSTMENT event before append.
export function validateAdjustmentEvent(
  event,
  allowedAdjustmentReasons = [],
  allowedStaffNames = []
) {
  const errors = [];

  if (event.type !== 'ADJUSTMENT') {
    errors.push('type must be "ADJUSTMENT".');
  }
  if (!event.target_change_id?.trim()) {
    errors.push('target_change_id is required.');
  }
  if (typeof event.previous_delta !== 'number' || Number.isNaN(event.previous_delta)) {
    errors.push('previous_delta must be a number.');
  }
  if (typeof event.new_delta !== 'number' || Number.isNaN(event.new_delta)) {
    errors.push('new_delta must be a number.');
  }
  if (!event.reason?.trim()) {
    errors.push('reason is required.');
  } else if (
    allowedAdjustmentReasons.length > 0 &&
    !allowedAdjustmentReasons.includes(event.reason)
  ) {
    errors.push('reason must be one of the configured adjustment reasons.');
  }
  if (!event.note?.trim()) {
    errors.push('note is required.');
  }
  const adjustedBy = event.adjusted_by?.trim() ?? '';
  if (!adjustedBy) {
    errors.push('adjusted_by is required.');
  } else if (allowedStaffNames.length === 0) {
    errors.push(
      'No staff names configured. Add names in Admin settings before submitting.'
    );
  } else if (!allowedStaffNames.includes(adjustedBy)) {
    errors.push('adjusted_by must be one of the configured staff names.');
  }
  if (!event.adjusted_at) {
    errors.push('adjusted_at is required.');
  }

  return errors;
}

// Validate an Admin REASSIGNMENT event before append.
export function validateReassignmentEvent(event, allowedStaffNames = []) {
  const errors = [];

  if (event.type !== 'REASSIGNMENT') {
    errors.push('type must be "REASSIGNMENT".');
  }
  if (!event.route_id?.trim()) {
    errors.push('route_id is required.');
  }
  if (!event.note?.trim()) {
    errors.push('note is required.');
  }
  const reassignedBy = event.reassigned_by?.trim() ?? '';
  if (!reassignedBy) {
    errors.push('reassigned_by is required.');
  } else if (allowedStaffNames.length === 0) {
    errors.push(
      'No staff names configured. Add names in Admin settings before submitting.'
    );
  } else if (!allowedStaffNames.includes(reassignedBy)) {
    errors.push('reassigned_by must be one of the configured staff names.');
  }
  if (!event.reassigned_at) {
    errors.push('reassigned_at is required.');
  }

  const newId = event.new_driver_id ?? null;
  const newName = event.new_driver_name?.trim() || null;
  if (newId && !newName) {
    errors.push('new_driver_name is required when new_driver_id is set.');
  }
  if (!newId && newName) {
    errors.push(
      'new_driver_id is required when assigning a named driver (or clear both for Unassigned).'
    );
  }

  if (
    event.resolution != null &&
    event.resolution !== 'routine' &&
    event.resolution !== 'bid_awarded'
  ) {
    errors.push('resolution must be "routine" or "bid_awarded".');
  }

  return errors;
}

// Validate an Admin NEEDS_REVIEW_RESOLUTION event before append.
export function validateNeedsReviewResolutionEvent(
  event,
  allowedStaffNames = []
) {
  const errors = [];

  if (event.type !== 'NEEDS_REVIEW_RESOLUTION') {
    errors.push('type must be "NEEDS_REVIEW_RESOLUTION".');
  }
  if (!event.route_id?.trim()) {
    errors.push('route_id is required.');
  }
  if (
    event.resolution !== 'keep_prior' &&
    event.resolution !== 'accept_computed'
  ) {
    errors.push('resolution must be "keep_prior" or "accept_computed".');
  }
  if (!event.previous_finalized_status?.trim()) {
    errors.push('previous_finalized_status is required.');
  }
  if (!event.computed_status?.trim()) {
    errors.push('computed_status is required.');
  }
  if (!event.note?.trim()) {
    errors.push('note is required.');
  }
  const resolvedBy = event.resolved_by?.trim() ?? '';
  if (!resolvedBy) {
    errors.push('resolved_by is required.');
  } else if (allowedStaffNames.length === 0) {
    errors.push(
      'No staff names configured. Add names in Admin settings before submitting.'
    );
  } else if (!allowedStaffNames.includes(resolvedBy)) {
    errors.push('resolved_by must be one of the configured staff names.');
  }
  if (!event.resolved_at) {
    errors.push('resolved_at is required.');
  }

  return errors;
}

// Validate an Admin SENIORITY_TIE_RESOLUTION event before append.
export function validateSeniorityTieResolutionEvent(
  event,
  allowedStaffNames = []
) {
  const errors = [];

  if (event.type !== 'SENIORITY_TIE_RESOLUTION') {
    errors.push('type must be "SENIORITY_TIE_RESOLUTION".');
  }
  if (!event.hire_date?.trim()) {
    errors.push('hire_date is required.');
  }
  if (!Array.isArray(event.assignments) || event.assignments.length < 2) {
    errors.push('assignments must list at least two drivers.');
  } else {
    const ranks = new Set();
    const ids = new Set();
    for (const row of event.assignments) {
      const driverId = String(row?.driver_id || '').trim();
      const driverName = String(row?.driver_name || '').trim();
      const tieBreak = row?.tie_break;
      if (!driverId) errors.push('Each assignment needs driver_id.');
      if (!driverName) errors.push('Each assignment needs driver_name.');
      if (!Number.isInteger(tieBreak) || (tieBreak) < 1) {
        errors.push('Each assignment needs a positive integer tie_break.');
      } else {
        ranks.add( (tieBreak));
      }
      if (driverId) {
        if (ids.has(driverId)) {
          errors.push('assignments must not repeat driver_id.');
        }
        ids.add(driverId);
      }
    }
    if (
      ranks.size === event.assignments.length &&
      [...ranks].sort((a, b) => a - b).some((n, i) => n !== i + 1)
    ) {
      errors.push('tie_break values must be 1..N with no gaps.');
    }
  }
  if (!event.note?.trim()) {
    errors.push('note is required.');
  }
  const resolvedBy = event.resolved_by?.trim() ?? '';
  if (!resolvedBy) {
    errors.push('resolved_by is required.');
  } else if (allowedStaffNames.length === 0) {
    errors.push(
      'No staff names configured. Add names in Admin settings before submitting.'
    );
  } else if (!allowedStaffNames.includes(resolvedBy)) {
    errors.push('resolved_by must be one of the configured staff names.');
  }
  if (!event.resolved_at) {
    errors.push('resolved_at is required.');
  }

  return errors;
}
