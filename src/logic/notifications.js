import { changeReportMatchKey } from './changeReport.js';
import { buildPayrollRoundingBreakdown } from './timeUtils.js';

/**
 * Named trigger events for the unified notification system (email offers + print).
 * @typedef {'WINDOW_LOCKED_IN' | 'WINDOW_BID_PENDING' | 'OPEN_BID_POSTING' | 'WINDOW_BUMP_ELIGIBLE' | 'BID_AWARDED' | 'NEEDS_REVIEW_RESOLVED_CONTRADICTS_LETTER' | 'ROUTE_REASSIGNED' | 'PAYROLL_CONTRACTED_HOURS_CHANGED' | 'PAPER_BID_SIGNUP'} NotificationEventType
 */

/** @type {NotificationEventType[]} */
export const NOTIFICATION_EVENT_TYPES = [
  'WINDOW_LOCKED_IN',
  'WINDOW_BID_PENDING',
  'OPEN_BID_POSTING',
  'WINDOW_BUMP_ELIGIBLE',
  'BID_AWARDED',
  'NEEDS_REVIEW_RESOLVED_CONTRADICTS_LETTER',
  'ROUTE_REASSIGNED',
  'PAYROLL_CONTRACTED_HOURS_CHANGED',
  'PAPER_BID_SIGNUP',
];

/** Events that offer email drafts (excludes print-only prompts). */
export const EMAIL_NOTIFICATION_EVENT_TYPES = NOTIFICATION_EVENT_TYPES.filter(
  (type) => type !== 'PAPER_BID_SIGNUP'
);

/**
 * @typedef {'driver' | 'payroll' | 'drivers_directory'} NotificationRecipient
 * @typedef {'pending' | 'actioned' | 'dismissed'} NotificationStatus
 *
 * @typedef {{
 *   recipient: NotificationRecipient,
 *   subject: string,
 *   body: string,
 * }} EmailTemplate
 *
 * @typedef {{
 *   payroll_email: string,
 *   payroll_cc: string,
 *   templates: Record<NotificationEventType, EmailTemplate>,
 * }} EmailTemplatesSettings
 *
 * @typedef {{
 *   id: string,
 *   event_type: NotificationEventType,
 *   route_id: string,
 *   source_key: string,
 *   created_at: string,
 *   status: NotificationStatus,
 *   actioned_at: string | null,
 *   dismissed_at: string | null,
 *   context: Record<string, string | number | null | undefined>,
 * }} AppNotification
 */

/** @typedef {{
 *   event_type: NotificationEventType,
 *   route_id: string,
 *   source_key: string,
 *   context: Record<string, string | number | null | undefined>,
 * }} NotificationEnqueueSpec */

/** Placeholders relevant per event (for Admin Settings hints). */
export const TEMPLATE_PLACEHOLDERS = {
  WINDOW_LOCKED_IN: ['route_id', 'driver_name', 'driver_email'],
  // Retained for Settings / legacy pending rows; no longer enqueued (not payroll).
  WINDOW_BID_PENDING: ['route_id', 'driver_name', 'driver_email'],
  OPEN_BID_POSTING: ['route_id', 'bid_response_due_date'],
  WINDOW_BUMP_ELIGIBLE: [
    'route_id',
    'driver_name',
    'driver_email',
    'bump_decision_due_date',
  ],
  BID_AWARDED: [
    'route_id',
    'driver_name',
    'driver_email',
    'previous_driver_name',
  ],
  NEEDS_REVIEW_RESOLVED_CONTRADICTS_LETTER: [
    'route_id',
    'driver_name',
    'driver_email',
  ],
  ROUTE_REASSIGNED: [
    'route_id',
    'driver_name',
    'driver_email',
    'previous_driver_name',
  ],
  PAYROLL_CONTRACTED_HOURS_CHANGED: [
    'route_id',
    'driver_name',
    'driver_email',
    'payroll_email',
    'before_payroll_rounded_total_minutes',
    'after_payroll_rounded_total_minutes',
  ],
  PAPER_BID_SIGNUP: ['route_id', 'driver_name', 'bid_response_due_date'],
};

/**
 * Human-readable labels for Settings UI.
 * @type {Record<NotificationEventType, string>}
 */
export const EVENT_LABELS = {
  WINDOW_LOCKED_IN: 'Window locked in (under 30 min)',
  WINDOW_BID_PENDING: 'Window bid pending (increase ≥ 30) — unused',
  OPEN_BID_POSTING: 'Open bid posting (CC driver directory)',
  WINDOW_BUMP_ELIGIBLE: 'Window bump eligible (decrease ≥ 30)',
  BID_AWARDED: 'Bid awarded',
  NEEDS_REVIEW_RESOLVED_CONTRADICTS_LETTER:
    'Needs review resolved (contradicts prior letter)',
  ROUTE_REASSIGNED: 'Route reassigned (ordinary)',
  PAYROLL_CONTRACTED_HOURS_CHANGED:
    'Payroll — contracted hours changed (rounded)',
  PAPER_BID_SIGNUP: 'Paper bid sign-up sheet',
};

/**
 * Driver-facing toast events from change-report outcomes.
 * BID_PENDING is handled separately when paper bid sign-up is enabled
 * (print sheet offer — not an email).
 * @param {string} outcome
 * @returns {NotificationEventType | null}
 */
export function eventTypeForChangeReportOutcome(outcome) {
  if (outcome === 'STABLE') return 'WINDOW_LOCKED_IN';
  if (outcome === 'BUMP_ELIGIBLE') return 'WINDOW_BUMP_ELIGIBLE';
  return null;
}

/**
 * Print-sheet draft for paper bid sign-up toasts (no mailto).
 * @param {AppNotification} notification
 * @returns {{
 *   can_send: boolean,
 *   disabled_reason: string | null,
 *   action: 'print',
 *   print_url: string,
 *   mailto_url: null,
 *   subject: string,
 *   body: string,
 *   to_email: null,
 *   cc_email: null,
 *   recipient: 'driver',
 * }}
 */
export function buildPaperBidSignupDraft(notification) {
  const routeId = String(notification.route_id || '').trim();
  const print_url = `/admin/paper-bid-sheet.html?route_id=${encodeURIComponent(routeId)}`;
  return {
    can_send: Boolean(routeId),
    disabled_reason: routeId ? null : 'Missing route id for paper sign-up sheet.',
    action: 'print',
    print_url,
    mailto_url: null,
    subject: '',
    body: '',
    to_email: null,
    cc_email: null,
    recipient: 'driver',
  };
}

/**
 * Rounded contracted minutes for a route entry (last finalization, else segments).
 * @param {import('./stateMachine.js').RouteStateEntry | null | undefined} entry
 * @returns {number | null}
 */
export function roundedContractedMinutesForEntry(entry) {
  if (!entry) return null;
  if (typeof entry.payroll_rounded_total_minutes === 'number') {
    return entry.payroll_rounded_total_minutes;
  }
  const segments = entry.baseline_segments ?? entry.segments;
  if (!segments) return null;
  try {
    return buildPayrollRoundingBreakdown(segments).payroll_rounded_total_minutes;
  } catch {
    return null;
  }
}

/**
 * Rounded minutes from baseline vs current segments (pre-lock bump keep).
 * @param {import('./stateMachine.js').RouteStateEntry | null | undefined} entry
 * @returns {{ before: number | null, after: number | null }}
 */
export function roundedMinutesFromBaselineVsSegments(entry) {
  if (!entry) return { before: null, after: null };
  let before = null;
  let after = null;
  try {
    if (entry.baseline_segments) {
      before = buildPayrollRoundingBreakdown(entry.baseline_segments)
        .payroll_rounded_total_minutes;
    }
  } catch {
    before = null;
  }
  try {
    if (entry.segments) {
      after = buildPayrollRoundingBreakdown(entry.segments)
        .payroll_rounded_total_minutes;
    } else if (typeof entry.payroll_rounded_total_minutes === 'number') {
      after = entry.payroll_rounded_total_minutes;
    }
  } catch {
    after = null;
  }
  return { before, after };
}

/**
 * @param {number | null | undefined} before
 * @param {number | null | undefined} after
 * @returns {boolean}
 */
export function roundedContractedHoursChanged(before, after) {
  if (before == null && after == null) return false;
  if (before == null || after == null) return true;
  return Number(before) !== Number(after);
}

/**
 * Find the route currently held by a driver and its rounded contracted minutes.
 * @param {import('./stateMachine.js').RouteStateMap} routeState
 * @param {string | null | undefined} driverId
 * @returns {{ route_id: string, minutes: number | null } | null}
 */
export function findDriverAssignmentRounded(routeState, driverId) {
  if (!driverId) return null;
  for (const [routeId, entry] of Object.entries(routeState ?? {})) {
    if (entry?.driver_id === driverId) {
      return {
        route_id: routeId,
        minutes: roundedContractedMinutesForEntry(entry),
      };
    }
  }
  return null;
}

/**
 * Fill {{placeholders}}. Unknown keys are left as-is; missing values → ''.
 * @param {string} template
 * @param {Record<string, string | number | null | undefined>} values
 * @returns {string}
 */
export function fillTemplate(template, values) {
  return String(template ?? '').replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      return match;
    }
    const value = values[key];
    if (value == null) return '';
    return String(value);
  });
}

/**
 * @param {AppNotification} notification
 * @param {EmailTemplatesSettings} settings
 * @returns {{
 *   can_send: boolean,
 *   disabled_reason: string | null,
 *   mailto_url: string | null,
 *   subject: string,
 *   body: string,
 *   to_email: string | null,
 *   cc_email: string | null,
 *   recipient: NotificationRecipient,
 * }}
 */
export function buildNotificationMailto(notification, settings) {
  if (notification.event_type === 'PAPER_BID_SIGNUP') {
    return buildPaperBidSignupDraft(notification);
  }

  const template = settings.templates[notification.event_type];
  const recipient = template?.recipient ?? 'driver';
  const ctx = {
    ...notification.context,
    payroll_email: settings.payroll_email,
    payroll_cc: settings.payroll_cc,
  };
  const subject = fillTemplate(template?.subject ?? '', ctx);
  const body = fillTemplate(template?.body ?? '', ctx);

  /** @type {string} */
  let toEmail = '';
  /** @type {string} */
  let ccEmail = '';
  if (recipient === 'payroll') {
    toEmail = String(settings.payroll_email ?? '').trim();
    ccEmail = String(settings.payroll_cc ?? '')
      .split(/[,;]+/)
      .map((part) => part.trim())
      .filter((part) => part.includes('@'))
      .join(',');
    if (!toEmail) {
      return {
        can_send: false,
        disabled_reason:
          'Payroll email not set — configure in Admin Settings → Email templates',
        mailto_url: null,
        subject,
        body,
        to_email: null,
        cc_email: null,
        recipient,
      };
    }
  } else {
    toEmail = String(notification.context.driver_email ?? '').trim();
    if (!toEmail) {
      const name =
        String(notification.context.driver_name ?? '').trim() || 'this driver';
      return {
        can_send: false,
        disabled_reason: `No email on file for ${name}`,
        mailto_url: null,
        subject,
        body,
        to_email: null,
        cc_email: null,
        recipient,
      };
    }
  }

  const params = [
    `subject=${encodeURIComponent(subject)}`,
    `body=${encodeURIComponent(body)}`,
  ];
  if (ccEmail) {
    params.push(`cc=${encodeURIComponent(ccEmail)}`);
  }
  const mailto_url = `mailto:${encodeURIComponent(toEmail)}?${params.join('&')}`;

  return {
    can_send: true,
    disabled_reason: null,
    mailto_url,
    subject,
    body,
    to_email: toEmail,
    cc_email: ccEmail || null,
    recipient,
  };
}

/**
 * Toast/banner copy for a pending notification.
 * @param {AppNotification} notification
 * @returns {string}
 */
export function formatNotificationPrompt(notification) {
  const route = notification.route_id || '—';
  const email = String(notification.context.driver_email ?? '').trim();

  switch (notification.event_type) {
    case 'WINDOW_LOCKED_IN':
      return email
        ? `Route ${route} locked in — send the driver an update to ${email}?`
        : `Route ${route} locked in — send the driver an update?`;
    case 'WINDOW_BID_PENDING':
      // Legacy pending rows only — no longer enqueued.
      return `Route ${route} is bid pending — send an update?`;
    case 'PAPER_BID_SIGNUP':
      return `Route ${route} is eligible for bid — print a paper sign-up sheet?`;
    case 'WINDOW_BUMP_ELIGIBLE':
      return email
        ? `Route ${route} is bump-eligible — send the determination to ${email}?`
        : `Route ${route} is bump-eligible — send the determination?`;
    case 'BID_AWARDED':
      return email
        ? `Bid awarded on ${route} — notify ${email}?`
        : `Bid awarded on ${route} — notify the new driver?`;
    case 'NEEDS_REVIEW_RESOLVED_CONTRADICTS_LETTER':
      return email
        ? `Review on ${route} resolved differently than a prior letter — send a correction to ${email}?`
        : `Review on ${route} resolved differently than a prior letter — send a correction?`;
    case 'ROUTE_REASSIGNED':
      return email
        ? `Route ${route} reassigned — notify ${email}?`
        : `Route ${route} reassigned — notify the new driver?`;
    case 'PAYROLL_CONTRACTED_HOURS_CHANGED': {
      const before = notification.context.before_payroll_rounded_total_minutes;
      const after = notification.context.after_payroll_rounded_total_minutes;
      const range =
        before != null && after != null ? ` (${before} → ${after} min)` : '';
      return `Contracted hours changed on ${route}${range} — notify payroll?`;
    }
    default:
      return `Update on route ${route} — send an email?`;
  }
}

/**
 * Unified payroll offer when rounded contracted hours actually change.
 * @param {{
 *   route_id: string,
 *   source_key: string,
 *   driver_name?: string | null,
 *   driver_email?: string | null,
 *   driver_id?: string | null,
 *   before_payroll_rounded_total_minutes: number | null,
 *   after_payroll_rounded_total_minutes: number | null,
 * }} input
 * @returns {NotificationEnqueueSpec | null}
 */
export function buildPayrollHoursChangedSpec(input) {
  if (
    !roundedContractedHoursChanged(
      input.before_payroll_rounded_total_minutes,
      input.after_payroll_rounded_total_minutes
    )
  ) {
    return null;
  }
  return {
    event_type: 'PAYROLL_CONTRACTED_HOURS_CHANGED',
    route_id: input.route_id,
    source_key: input.source_key,
    context: {
      route_id: input.route_id,
      driver_name: input.driver_name ?? null,
      driver_email: input.driver_email ?? null,
      driver_id: input.driver_id ?? null,
      before_payroll_rounded_total_minutes:
        input.before_payroll_rounded_total_minutes,
      after_payroll_rounded_total_minutes:
        input.after_payroll_rounded_total_minutes,
    },
  };
}

/**
 * Diff prior vs next route-state change reports and build enqueue specs.
 * Driver toasts for lock-in / bump-eligible; payroll only when rounded hours
 * change on STABLE lock-in. When paper bid sign-up is enabled, BID_PENDING
 * enqueues a print-sheet offer (not an email).
 *
 * @param {import('./stateMachine.js').RouteStateMap} priorState
 * @param {import('./stateMachine.js').RouteStateMap} nextState
 * @param {{
 *   driversById?: Map<string, { name?: string, email?: string | null }>,
 *   paperBidSignupEnabled?: boolean,
 * }} [options]
 * @returns {NotificationEnqueueSpec[]}
 */
export function collectWindowFinalizationNotifications(
  priorState,
  nextState,
  options = {}
) {
  /** @type {NotificationEnqueueSpec[]} */
  const specs = [];
  const paperBidSignupEnabled = options.paperBidSignupEnabled === true;

  for (const [routeId, next] of Object.entries(nextState)) {
    const priorReports = priorState[routeId]?.change_reports ?? [];
    const priorKeys = new Set(priorReports.map(changeReportMatchKey));
    const nextReports = next.change_reports ?? [];

    for (const report of nextReports) {
      const key = changeReportMatchKey(report);
      if (priorKeys.has(key)) continue;

      const driver =
        (report.driver_id && options.driversById?.get(report.driver_id)) ||
        null;
      const driver_name =
        driver?.name?.trim() || report.driver_name?.trim() || null;
      const driver_email = driver?.email?.trim() || null;
      const driver_id = report.driver_id ?? null;

      const event_type = eventTypeForChangeReportOutcome(report.outcome);
      if (event_type) {
        specs.push({
          event_type,
          route_id: routeId,
          source_key: `${event_type}|${routeId}|${key}`,
          context: {
            route_id: routeId,
            driver_name,
            driver_email,
            driver_id,
            change_report_id: report.id ?? null,
            cumulative_drift_minutes: next.cumulative_drift_minutes ?? null,
            bump_decision_due_date: next.bump_decision_due_date ?? null,
            outcome: report.outcome,
          },
        });
      }

      if (paperBidSignupEnabled && report.outcome === 'BID_PENDING') {
        specs.push({
          event_type: 'PAPER_BID_SIGNUP',
          route_id: routeId,
          source_key: `PAPER_BID_SIGNUP|${routeId}|${key}`,
          context: {
            route_id: routeId,
            driver_name,
            driver_email,
            driver_id,
            change_report_id: report.id ?? null,
            bid_response_due_date: next.bid_response_due_date ?? null,
            outcome: report.outcome,
          },
        });
      }

      // Payroll: only when rounded contracted hours actually change at lock-in.
      // BID_PENDING / BUMP_ELIGIBLE do not lock contracted hours yet.
      if (report.outcome === 'STABLE' && report.contracted_hours_changed) {
        const before =
          report.before?.math?.payroll_rounded_total_minutes ?? null;
        const after = report.after?.math?.payroll_rounded_total_minutes ?? null;
        const payrollSpec = buildPayrollHoursChangedSpec({
          route_id: routeId,
          source_key: `PAYROLL_CONTRACTED_HOURS_CHANGED|${routeId}|${key}`,
          driver_name,
          driver_email,
          driver_id,
          before_payroll_rounded_total_minutes: before,
          after_payroll_rounded_total_minutes: after,
        });
        if (payrollSpec) specs.push(payrollSpec);
      }
    }
  }

  return specs;
}

/**
 * @param {{
 *   route_id: string,
 *   resolution: 'routine' | 'bid_awarded',
 *   reassignment_id: string,
 *   new_driver_name: string | null,
 *   new_driver_email: string | null,
 *   previous_driver_name: string | null,
 * }} input
 */
export function buildReassignmentNotificationSpec(input) {
  const event_type =
    input.resolution === 'bid_awarded' ? 'BID_AWARDED' : 'ROUTE_REASSIGNED';
  return {
    event_type,
    route_id: input.route_id,
    source_key: `${event_type}|${input.route_id}|${input.reassignment_id}`,
    context: {
      route_id: input.route_id,
      driver_name: input.new_driver_name,
      driver_email: input.new_driver_email,
      previous_driver_name: input.previous_driver_name || 'Unassigned',
    },
  };
}

/**
 * Payroll offer after bid award when the awardee's rounded hours changed.
 * @param {{
 *   route_id: string,
 *   reassignment_id: string,
 *   priorState: import('./stateMachine.js').RouteStateMap,
 *   nextState: import('./stateMachine.js').RouteStateMap,
 *   new_driver_id: string | null,
 *   new_driver_name: string | null,
 *   new_driver_email: string | null,
 * }} input
 * @returns {NotificationEnqueueSpec | null}
 */
export function buildBidAwardPayrollSpec(input) {
  if (!input.new_driver_id) return null;
  const priorAssignment = findDriverAssignmentRounded(
    input.priorState,
    input.new_driver_id
  );
  const afterMinutes = roundedContractedMinutesForEntry(
    input.nextState[input.route_id]
  );
  const beforeMinutes = priorAssignment?.minutes ?? null;
  return buildPayrollHoursChangedSpec({
    route_id: input.route_id,
    source_key: `PAYROLL_CONTRACTED_HOURS_CHANGED|bid_awarded|${input.route_id}|${input.reassignment_id}`,
    driver_name: input.new_driver_name,
    driver_email: input.new_driver_email,
    driver_id: input.new_driver_id,
    before_payroll_rounded_total_minutes: beforeMinutes,
    after_payroll_rounded_total_minutes: afterMinutes,
  });
}

/**
 * Payroll offers from a bump decision (keep locks decreased hours; elect/accept
 * move drivers across routes).
 * @param {{
 *   decision: 'keep_assignment' | 'elect_bump' | 'accept_unassigned',
 *   decision_id: string,
 *   route_id: string,
 *   target_route_id?: string | null,
 *   priorState: import('./stateMachine.js').RouteStateMap,
 *   nextState: import('./stateMachine.js').RouteStateMap,
 *   driversById?: Map<string, { name?: string, email?: string | null }>,
 * }} input
 * @returns {NotificationEnqueueSpec[]}
 */
export function collectBumpDecisionPayrollSpecs(input) {
  /** @type {NotificationEnqueueSpec[]} */
  const specs = [];
  const driversById = input.driversById ?? new Map();

  if (input.decision === 'keep_assignment') {
    const prior = input.priorState[input.route_id];
    const next = input.nextState[input.route_id];
    const { before, after } = roundedMinutesFromBaselineVsSegments(prior);
    // Prefer post-lock after from next state when available.
    const afterMinutes =
      roundedContractedMinutesForEntry(next) ?? after;
    const driverId = next?.driver_id ?? prior?.driver_id ?? null;
    const driver = driverId ? driversById.get(driverId) : null;
    const spec = buildPayrollHoursChangedSpec({
      route_id: input.route_id,
      source_key: `PAYROLL_CONTRACTED_HOURS_CHANGED|bump_keep|${input.route_id}|${input.decision_id}`,
      driver_name:
        driver?.name?.trim() ||
        next?.driver_name?.trim() ||
        prior?.driver_name?.trim() ||
        null,
      driver_email: driver?.email?.trim() || null,
      driver_id: driverId,
      before_payroll_rounded_total_minutes: before,
      after_payroll_rounded_total_minutes: afterMinutes,
    });
    if (spec) specs.push(spec);
    return specs;
  }

  if (input.decision === 'accept_unassigned') {
    const prior = input.priorState[input.route_id];
    const driverId = prior?.driver_id ?? null;
    const driver = driverId ? driversById.get(driverId) : null;
    const before = roundedContractedMinutesForEntry(prior);
    const spec = buildPayrollHoursChangedSpec({
      route_id: input.route_id,
      source_key: `PAYROLL_CONTRACTED_HOURS_CHANGED|bump_accept_unassigned|${input.route_id}|${input.decision_id}`,
      driver_name:
        driver?.name?.trim() || prior?.driver_name?.trim() || null,
      driver_email: driver?.email?.trim() || null,
      driver_id: driverId,
      before_payroll_rounded_total_minutes: before,
      after_payroll_rounded_total_minutes: 0,
    });
    if (spec) specs.push(spec);
    return specs;
  }

  if (input.decision === 'elect_bump' && input.target_route_id) {
    // Electing driver: prior source route → target route hours.
    const sourcePrior = input.priorState[input.route_id];
    const targetNext = input.nextState[input.target_route_id];
    const electorId = targetNext?.driver_id ?? sourcePrior?.driver_id ?? null;
    if (electorId) {
      const elector = driversById.get(electorId);
      const spec = buildPayrollHoursChangedSpec({
        route_id: input.target_route_id,
        source_key: `PAYROLL_CONTRACTED_HOURS_CHANGED|bump_elect|${input.target_route_id}|${input.decision_id}`,
        driver_name:
          elector?.name?.trim() || targetNext?.driver_name?.trim() || null,
        driver_email: elector?.email?.trim() || null,
        driver_id: electorId,
        before_payroll_rounded_total_minutes:
          roundedContractedMinutesForEntry(sourcePrior),
        after_payroll_rounded_total_minutes:
          roundedContractedMinutesForEntry(targetNext),
      });
      if (spec) specs.push(spec);
    }

    // Displaced driver: prior target → parked on source (displacement card).
    const targetPrior = input.priorState[input.target_route_id];
    const sourceNext = input.nextState[input.route_id];
    const displacedId = sourceNext?.driver_id ?? targetPrior?.driver_id ?? null;
    if (displacedId) {
      const displaced = driversById.get(displacedId);
      const spec = buildPayrollHoursChangedSpec({
        route_id: input.route_id,
        source_key: `PAYROLL_CONTRACTED_HOURS_CHANGED|bump_displace|${input.route_id}|${input.decision_id}`,
        driver_name:
          displaced?.name?.trim() || sourceNext?.driver_name?.trim() || null,
        driver_email: displaced?.email?.trim() || null,
        driver_id: displacedId,
        before_payroll_rounded_total_minutes:
          roundedContractedMinutesForEntry(targetPrior),
        after_payroll_rounded_total_minutes:
          roundedContractedMinutesForEntry(sourceNext),
      });
      if (spec) specs.push(spec);
    }
  }

  return specs;
}

/**
 * @param {{
 *   route_id: string,
 *   resolve_id: string,
 *   driver_name: string | null,
 *   driver_email: string | null,
 * }} input
 */
export function buildNeedsReviewContradictionSpec(input) {
  return {
    event_type: /** @type {NotificationEventType} */ (
      'NEEDS_REVIEW_RESOLVED_CONTRADICTS_LETTER'
    ),
    route_id: input.route_id,
    source_key: `NEEDS_REVIEW_RESOLVED_CONTRADICTS_LETTER|${input.route_id}|${input.resolve_id}`,
    context: {
      route_id: input.route_id,
      driver_name: input.driver_name,
      driver_email: input.driver_email,
    },
  };
}
