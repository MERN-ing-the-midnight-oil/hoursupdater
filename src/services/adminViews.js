import { getAsOfDate } from '../config.js';
import { daysRemainingInWindow } from '../logic/calendar.js';
import { isBidResponseWindowClosed } from '../logic/bidSignup.js';
import { isBumpDecisionOverdue } from '../logic/bumpDecisions.js';
import { buildSeeTheMathFromSegments } from '../logic/changeReport.js';
import {
  isAdjustmentEvent,
  isBulkImportEvent,
  isChangeEvent,
  isReassignmentEvent,
  isSeniorityTieResolutionEvent,
  resolveEffectiveDeltas,
} from '../logic/stateMachine.js';
import { toDateString } from '../logic/timeUtils.js';
import {
  findDriverById,
  readAppSettings,
  readBidSignupWorkbook,
  readChangeLog,
  readDrivers,
  readRouteState,
  readSchoolCalendar,
} from '../data/storage.js';
import { getDriverSeniorityRank } from '../logic/seniority.js';

/**
 * @param {import('../logic/stateMachine.js').LogEntry[]} changeLog
 * @param {Map<string, number>} effectiveDeltas
 * @param {string[]} ids
 */
export function joinChangeSummaries(changeLog, effectiveDeltas, ids) {
  /** @type {Map<string, import('../logic/stateMachine.js').LogEntry>} */
  const byId = new Map(changeLog.map((entry) => [entry.id, entry]));
  return ids
    .map((id) => summarizeLogEntry(byId.get(id), id, effectiveDeltas, byId))
    .filter(Boolean);
}

/**
 * @param {import('../logic/stateMachine.js').LogEntry | undefined} entry
 * @param {string} id
 * @param {Map<string, number>} effectiveDeltas
 * @param {Map<string, import('../logic/stateMachine.js').LogEntry>} byId
 */
function summarizeLogEntry(entry, id, effectiveDeltas, byId) {
  if (!entry) {
    return {
      id,
      missing: true,
      start_date: null,
      segment: null,
      delta_minutes: null,
      entered_by: null,
      previous_time: null,
      new_time: null,
      note: null,
      type: null,
      route_id: null,
      sort_at: null,
      involvement: null,
    };
  }
  if (isChangeEvent(entry)) {
    const change = /** @type {import('../logic/stateMachine.js').ChangeEvent} */ (
      entry
    );
    return {
      id: change.id,
      missing: false,
      type: 'CHANGE',
      start_date: change.effective_date,
      segment: change.segment,
      previous_time: change.previous_time,
      new_time: change.new_time,
      delta_minutes: effectiveDeltas.has(change.id)
        ? effectiveDeltas.get(change.id)
        : change.delta_minutes,
      entered_by: change.entered_by,
      note: change.note,
      route_id: change.route_id,
      sort_at: change.submitted_at || change.effective_date,
      driver_id: change.driver_id ?? null,
      driver_name: change.driver_name,
    };
  }
  if (isAdjustmentEvent(entry)) {
    const adjustment =
      /** @type {import('../logic/stateMachine.js').AdjustmentEvent} */ (entry);
    const target = byId.get(adjustment.target_change_id);
    const routeId = isChangeEvent(target)
      ? /** @type {import('../logic/stateMachine.js').ChangeEvent} */ (target)
          .route_id
      : null;
    return {
      id: adjustment.id,
      missing: false,
      type: 'ADJUSTMENT',
      start_date: toDateString(adjustment.adjusted_at),
      segment: null,
      previous_time: null,
      new_time: null,
      delta_minutes: adjustment.new_delta - adjustment.previous_delta,
      entered_by: adjustment.adjusted_by,
      note: adjustment.note,
      target_change_id: adjustment.target_change_id,
      previous_delta: adjustment.previous_delta,
      new_delta: adjustment.new_delta,
      reason: adjustment.reason,
      route_id: routeId,
      sort_at: adjustment.adjusted_at,
    };
  }
  if (isReassignmentEvent(entry)) {
    const reassignment =
      /** @type {import('../logic/stateMachine.js').ReassignmentEvent} */ (
        entry
      );
    const fromLabel =
      reassignment.previous_driver_name?.trim() ||
      (reassignment.previous_driver_id ? reassignment.previous_driver_id : 'Unassigned');
    const toLabel =
      reassignment.new_driver_name?.trim() ||
      (reassignment.new_driver_id ? reassignment.new_driver_id : 'Unassigned');
    return {
      id: reassignment.id,
      missing: false,
      type: 'REASSIGNMENT',
      start_date: toDateString(reassignment.reassigned_at),
      segment: null,
      previous_time: fromLabel,
      new_time: toLabel,
      delta_minutes: null,
      entered_by: reassignment.reassigned_by,
      note: reassignment.note,
      route_id: reassignment.route_id,
      sort_at: reassignment.reassigned_at,
      previous_driver_id: reassignment.previous_driver_id,
      previous_driver_name: reassignment.previous_driver_name,
      new_driver_id: reassignment.new_driver_id,
      new_driver_name: reassignment.new_driver_name,
      driver_id: reassignment.new_driver_id,
      driver_name: reassignment.new_driver_name,
    };
  }
  if (isBulkImportEvent(entry)) {
    const bulk = /** @type {import('../logic/stateMachine.js').BulkImportEvent} */ (
      entry
    );
    const created = bulk.created_routes?.length ?? 0;
    const overwritten = bulk.overwritten_routes?.length ?? 0;
    return {
      id: bulk.id,
      missing: false,
      type: 'BULK_IMPORT',
      start_date: toDateString(bulk.imported_at),
      segment: null,
      previous_time: null,
      new_time: `${created} route(s) created` +
        (overwritten ? `, ${overwritten} overwritten` : ''),
      delta_minutes: null,
      entered_by: bulk.entered_by,
      note: bulk.note,
      route_id: null,
      sort_at: bulk.imported_at,
      created_drivers: bulk.created_drivers,
      created_routes: bulk.created_routes,
      overwritten_routes: bulk.overwritten_routes,
    };
  }
  if (isSeniorityTieResolutionEvent(entry)) {
    const tie =
      /** @type {import('../logic/stateMachine.js').SeniorityTieResolutionEvent} */ (
        entry
      );
    const order = (tie.assignments ?? [])
      .slice()
      .sort((a, b) => a.tie_break - b.tie_break)
      .map((a) => `${a.tie_break}. ${a.driver_name}`)
      .join(', ');
    return {
      id: tie.id,
      missing: false,
      type: 'SENIORITY_TIE_RESOLUTION',
      start_date: toDateString(tie.resolved_at),
      segment: null,
      previous_time: tie.hire_date,
      new_time: order,
      delta_minutes: null,
      entered_by: tie.resolved_by,
      note: tie.note,
      route_id: null,
      sort_at: tie.resolved_at,
      hire_date: tie.hire_date,
      assignments: tie.assignments,
    };
  }
  return {
    id,
    missing: true,
    start_date: null,
    segment: null,
    delta_minutes: null,
    entered_by: null,
    previous_time: null,
    new_time: null,
    note: null,
    type: null,
    route_id: null,
    sort_at: null,
  };
}

/**
 * @param {import('../logic/stateMachine.js').RouteStateEntry} entry
 * @returns {string | null}
 */
export function bidPendingSince(entry) {
  if (entry.status !== 'BID_PENDING' && entry.status !== 'BUMP_ELIGIBLE') {
    return null;
  }
  const outcome =
    entry.status === 'BUMP_ELIGIBLE' ? 'BUMP_ELIGIBLE' : 'BID_PENDING';
  const reports = (entry.change_reports ?? []).filter(
    (report) => report.outcome === outcome
  );
  if (reports.length) {
    return reports[reports.length - 1].finalized_at;
  }
  return entry.last_updated ?? null;
}

/**
 * Latest BID_PENDING Change Report for a live BID_PENDING route (if any).
 * @param {import('../logic/stateMachine.js').RouteStateEntry} entry
 * @returns {object | null}
 */
export function latestBidPendingReport(entry) {
  if (entry.status !== 'BID_PENDING') {
    return null;
  }
  const reports = (entry.change_reports ?? []).filter(
    (report) => report.outcome === 'BID_PENDING'
  );
  return reports.length ? reports[reports.length - 1] : null;
}

/**
 * Latest BUMP_ELIGIBLE Change Report for a live BUMP_ELIGIBLE route (if any).
 * @param {import('../logic/stateMachine.js').RouteStateEntry} entry
 * @returns {object | null}
 */
export function latestBumpEligibleReport(entry) {
  if (entry.status !== 'BUMP_ELIGIBLE') {
    return null;
  }
  const reports = (entry.change_reports ?? []).filter(
    (report) => report.outcome === 'BUMP_ELIGIBLE'
  );
  return reports.length ? reports[reports.length - 1] : null;
}

/**
 * @param {string} route_id
 * @param {import('../logic/stateMachine.js').RouteStateEntry} entry
 * @param {{
 *   driversById: Map<string, import('../data/storage.js').Driver>,
 *   driversByName: Map<string, import('../data/storage.js').Driver>,
 *   changeLog: import('../logic/stateMachine.js').LogEntry[],
 *   effectiveDeltas: Map<string, number>,
 *   schoolCalendar: object,
 *   asOfDate: string,
 * }} ctx
 */
export function enrichRouteForQueue(route_id, entry, ctx) {
  const {
    driversById,
    driversByName,
    changeLog,
    effectiveDeltas,
    schoolCalendar,
    asOfDate,
  } = ctx;
  const driver =
    (entry.driver_id && driversById.get(entry.driver_id)) ||
    driversByName.get(String(entry.driver_name || '').toLowerCase()) ||
    null;
  const contributingIds = entry.contributing_change_ids ?? [];
  const pendingIds = entry.pending_change_ids ?? [];
  const reviewHistory = entry.review_history ?? [];
  const causingAdjustmentId =
    entry.reconciliation?.causing_adjustment_id ?? null;
  const selfResolvedIds = reviewHistory
    .map((item) => item.causing_adjustment_id)
    .filter(Boolean);
  const adjustmentIds = [
    ...new Set([causingAdjustmentId, ...selfResolvedIds].filter(Boolean)),
  ];

  const seeTheMath = buildSeeTheMathFromSegments(
    entry.baseline_segments ?? entry.segments,
    entry.segments
  );

  const daysRemaining =
    entry.status === 'ACCUMULATING' ||
    entry.status === 'BID_PENDING' ||
    entry.status === 'BUMP_ELIGIBLE'
      ? daysRemainingInWindow(
          schoolCalendar,
          asOfDate,
          entry.window_expires_date
        )
      : null;

  return {
    route_id,
    driver_name: entry.driver_name,
    driver_id: entry.driver_id ?? driver?.driver_id ?? null,
    driver_email: driver?.email ?? null,
    status: entry.status,
    cumulative_drift_minutes: entry.cumulative_drift_minutes,
    window_opened_date: entry.window_opened_date ?? null,
    window_expires_date: entry.window_expires_date ?? null,
    days_remaining: daysRemaining,
    bid_pending_since: bidPendingSince(entry),
    bid_pending_report: latestBidPendingReport(entry),
    bump_eligible_report: latestBumpEligibleReport(entry),
    bump_decision_due_date: entry.bump_decision_due_date ?? null,
    bump_decision_overdue: isBumpDecisionOverdue(
      entry.bump_decision_due_date,
      asOfDate
    ),
    bump_chain_id: entry.bump_chain_id ?? null,
    bump_chain_link: entry.bump_chain_link ?? null,
    bump_kind: entry.bump_kind ?? null,
    bid_response_due_date: entry.bid_response_due_date ?? null,
    bid_response_closed: isBidResponseWindowClosed(
      entry.bid_response_due_date,
      asOfDate
    ),
    paper_bid_start_date: entry.paper_bid_start_date ?? null,
    bid_signup: entry.bid_signup ?? null,
    /** @type {import('../logic/bidSignup.js').BidSignupParseResult | null} */
    bid_signup_file: ctx.bidSignupFile ?? null,
    payroll_rounded_total_minutes: entry.payroll_rounded_total_minutes,
    segments: entry.segments,
    baseline_segments: entry.baseline_segments,
    contributing_change_ids: contributingIds,
    contributing_changes: joinChangeSummaries(
      changeLog,
      effectiveDeltas,
      contributingIds
    ),
    pending_change_ids: pendingIds,
    pending_changes: joinChangeSummaries(changeLog, effectiveDeltas, pendingIds),
    reconciliation: entry.reconciliation ?? null,
    causing_adjustment: causingAdjustmentId
      ? joinChangeSummaries(changeLog, effectiveDeltas, [
          causingAdjustmentId,
        ])[0] ?? null
      : null,
    related_adjustments: joinChangeSummaries(
      changeLog,
      effectiveDeltas,
      /** @type {string[]} */ (adjustmentIds)
    ),
    review_history: reviewHistory,
    change_reports: entry.change_reports ?? [],
    see_the_math: {
      before: seeTheMath.before,
      after: seeTheMath.after,
      statement: seeTheMath.statement,
    },
    last_updated: entry.last_updated ?? null,
    has_self_resolved_review: reviewHistory.some(
      (item) => item.event === 'NEEDS_REVIEW_SELF_RESOLVED'
    ),
  };
}

/**
 * @param {string} [dataDir]
 */
export async function buildAdminQueue(dataDir) {
  const [state, drivers, changeLog, schoolCalendar, appSettings] =
    await Promise.all([
      readRouteState(dataDir),
      readDrivers(dataDir),
      readChangeLog(dataDir),
      readSchoolCalendar(dataDir),
      readAppSettings(dataDir),
    ]);
  const driversById = new Map(drivers.map((d) => [d.driver_id, d]));
  const driversByName = new Map(drivers.map((d) => [d.name.toLowerCase(), d]));
  const effectiveDeltas = resolveEffectiveDeltas(changeLog);
  const asOfDate = toDateString(getAsOfDate());

  /** @type {import('../logic/bidSignup.js').BidSignupParseResult | null} */
  let bidSignupFile = null;
  if (appSettings.electronic_bid_signup_enabled) {
    try {
      const workbook = await readBidSignupWorkbook(
        dataDir,
        appSettings.bid_signup_workbook
      );
      bidSignupFile = workbook.parse;
    } catch (error) {
      bidSignupFile = {
        status: 'unreadable',
        message: `Bid sign-up file could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
        missing_columns: [],
        found_headers: [],
        responses: [],
        sheet_name: null,
      };
    }
  }

  const ctx = {
    driversById,
    driversByName,
    changeLog,
    effectiveDeltas,
    schoolCalendar,
    asOfDate,
    bidSignupFile,
  };

  return Object.entries(state)
    .map(([route_id, entry]) => enrichRouteForQueue(route_id, entry, ctx))
    .sort((a, b) => a.route_id.localeCompare(b.route_id));
}

/**
 * @param {import('../data/storage.js').Driver} driver
 * @param {import('../logic/stateMachine.js').LogEntry} entry
 * @param {Map<string, import('../logic/stateMachine.js').LogEntry>} byId
 * @returns {string | null} involvement role label, or null if not involved
 */
function involvementRole(driver, entry, byId) {
  const name = driver.name.trim().toLowerCase();
  if (isChangeEvent(entry)) {
    const change = /** @type {import('../logic/stateMachine.js').ChangeEvent} */ (
      entry
    );
    if (change.driver_id && change.driver_id === driver.driver_id) {
      return 'driver';
    }
    if (change.driver_name?.trim().toLowerCase() === name) {
      return 'driver';
    }
    if (change.entered_by?.trim().toLowerCase() === name) {
      return 'entered_by';
    }
    return null;
  }
  if (isAdjustmentEvent(entry)) {
    const adjustment =
      /** @type {import('../logic/stateMachine.js').AdjustmentEvent} */ (entry);
    if (adjustment.adjusted_by?.trim().toLowerCase() === name) {
      return 'adjusted_by';
    }
    const target = byId.get(adjustment.target_change_id);
    if (target && involvementRole(driver, target, byId) === 'driver') {
      return 'driver';
    }
    return null;
  }
  if (isReassignmentEvent(entry)) {
    const reassignment =
      /** @type {import('../logic/stateMachine.js').ReassignmentEvent} */ (
        entry
      );
    if (reassignment.reassigned_by?.trim().toLowerCase() === name) {
      return 'reassigned_by';
    }
    if (
      reassignment.new_driver_id === driver.driver_id ||
      reassignment.previous_driver_id === driver.driver_id
    ) {
      return 'driver';
    }
    if (
      reassignment.new_driver_name?.trim().toLowerCase() === name ||
      reassignment.previous_driver_name?.trim().toLowerCase() === name
    ) {
      return 'driver';
    }
    return null;
  }
  if (isBulkImportEvent(entry)) {
    const bulk = /** @type {import('../logic/stateMachine.js').BulkImportEvent} */ (
      entry
    );
    if (bulk.entered_by?.trim().toLowerCase() === name) {
      return 'entered_by';
    }
    const created = [
      ...(bulk.created_drivers ?? []),
      ...(bulk.updated_drivers ?? []),
    ];
    if (
      created.some(
        (d) =>
          d.driver_id === driver.driver_id ||
          d.name?.trim().toLowerCase() === name
      )
    ) {
      return 'driver';
    }
    const routes = [
      ...(bulk.created_routes ?? []),
      ...(bulk.overwritten_routes ?? []),
    ];
    if (
      routes.some(
        (r) =>
          r.driver_id === driver.driver_id ||
          r.driver_name?.trim().toLowerCase() === name
      )
    ) {
      return 'driver';
    }
    return null;
  }
  if (isSeniorityTieResolutionEvent(entry)) {
    const tie =
      /** @type {import('../logic/stateMachine.js').SeniorityTieResolutionEvent} */ (
        entry
      );
    if (tie.resolved_by?.trim().toLowerCase() === name) {
      return 'resolved_by';
    }
    if (
      (tie.assignments ?? []).some(
        (a) =>
          a.driver_id === driver.driver_id ||
          a.driver_name?.trim().toLowerCase() === name
      )
    ) {
      return 'driver';
    }
    return null;
  }
  return null;
}

/**
 * Chronological ChangeEvents + ADJUSTMENTs this person was involved in.
 * @param {import('../data/storage.js').Driver} driver
 * @param {import('../logic/stateMachine.js').LogEntry[]} changeLog
 * @param {Map<string, number>} effectiveDeltas
 */
export function buildDriverChangeHistory(driver, changeLog, effectiveDeltas) {
  /** @type {Map<string, import('../logic/stateMachine.js').LogEntry>} */
  const byId = new Map(changeLog.map((entry) => [entry.id, entry]));
  const rows = [];
  for (const entry of changeLog) {
    const role = involvementRole(driver, entry, byId);
    if (!role) continue;
    const summary = summarizeLogEntry(entry, entry.id, effectiveDeltas, byId);
    rows.push({ ...summary, involvement: role });
  }
  return rows.sort((a, b) => {
    const aAt = a.sort_at || '';
    const bAt = b.sort_at || '';
    if (aAt !== bAt) return aAt.localeCompare(bAt);
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * @param {string} driverId
 * @param {string} [dataDir]
 */
export async function buildDriverDetail(driverId, dataDir) {
  const driver = await findDriverById(driverId, dataDir);
  if (!driver) {
    return null;
  }

  const [queue, changeLog, allDrivers] = await Promise.all([
    buildAdminQueue(dataDir),
    readChangeLog(dataDir),
    readDrivers(dataDir),
  ]);
  const seniority = getDriverSeniorityRank(allDrivers, driver.driver_id);
  const effectiveDeltas = resolveEffectiveDeltas(changeLog);

  const assignments = queue.filter(
    (row) =>
      row.driver_id === driver.driver_id ||
      String(row.driver_name || '').toLowerCase() ===
        driver.name.toLowerCase()
  );

  const change_history = buildDriverChangeHistory(
    driver,
    changeLog,
    effectiveDeltas
  );

  const change_reports = [
    ...assignments.flatMap((row) =>
      (row.change_reports ?? []).map((report) => ({
        ...report,
        route_id: report.route_id || row.route_id,
      }))
    ),
    // Reports baked to this driver at finalization, even if the route moved on.
    ...queue.flatMap((row) =>
      (row.change_reports ?? [])
        .filter(
          (report) =>
            (report.driver_id && report.driver_id === driver.driver_id) ||
            (report.driver_name &&
              String(report.driver_name).toLowerCase() ===
                driver.name.toLowerCase())
        )
        .map((report) => ({
          ...report,
          route_id: report.route_id || row.route_id,
        }))
    ),
  ];
  const seenReportIds = new Set();
  const dedupedReports = [];
  for (const report of change_reports) {
    if (!report.id || seenReportIds.has(report.id)) continue;
    seenReportIds.add(report.id);
    dedupedReports.push(report);
  }
  dedupedReports.sort((a, b) =>
    String(a.finalized_at || '').localeCompare(String(b.finalized_at || ''))
  );

  const review_history = assignments.filter(
    (row) =>
      row.status === 'NEEDS_REVIEW' ||
      (row.review_history ?? []).some(
        (item) => item.event === 'NEEDS_REVIEW_SELF_RESOLVED'
      )
  );

  return {
    driver,
    seniority: seniority ?? {
      rank: null,
      total: 0,
      missing_hire_date: true,
    },
    assignments,
    change_history,
    change_reports: dedupedReports,
    review_history,
  };
}
