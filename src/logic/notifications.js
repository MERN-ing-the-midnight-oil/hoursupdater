import { changeReportMatchKey } from './changeReport.js';

/**
 * Named trigger events for the unified email-offer notification system.
 * @typedef {'WINDOW_LOCKED_IN' | 'WINDOW_BID_PENDING' | 'OPEN_BID_POSTING' | 'WINDOW_BUMP_ELIGIBLE' | 'BID_AWARDED' | 'NEEDS_REVIEW_RESOLVED_CONTRADICTS_LETTER' | 'ROUTE_REASSIGNED'} NotificationEventType
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
];

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

/** Placeholders relevant per event (for Admin Settings hints). */
export const TEMPLATE_PLACEHOLDERS = {
  WINDOW_LOCKED_IN: ['route_id', 'driver_name', 'driver_email'],
  WINDOW_BID_PENDING: [
    'route_id',
    'driver_name',
    'driver_email',
    'payroll_email',
  ],
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
};

/**
 * Human-readable labels for Settings UI.
 * @type {Record<NotificationEventType, string>}
 */
export const EVENT_LABELS = {
  WINDOW_LOCKED_IN: 'Window locked in (under 30 min)',
  WINDOW_BID_PENDING: 'Window bid pending (increase ≥ 30)',
  OPEN_BID_POSTING: 'Open bid posting (CC driver directory)',
  WINDOW_BUMP_ELIGIBLE: 'Window bump eligible (decrease ≥ 30)',
  BID_AWARDED: 'Bid awarded',
  NEEDS_REVIEW_RESOLVED_CONTRADICTS_LETTER:
    'Needs review resolved (contradicts prior letter)',
  ROUTE_REASSIGNED: 'Route reassigned (ordinary)',
};

/**
 * @param {string} outcome
 * @returns {NotificationEventType | null}
 */
export function eventTypeForChangeReportOutcome(outcome) {
  if (outcome === 'STABLE') return 'WINDOW_LOCKED_IN';
  if (outcome === 'BID_PENDING') return 'WINDOW_BID_PENDING';
  if (outcome === 'BUMP_ELIGIBLE') return 'WINDOW_BUMP_ELIGIBLE';
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
 *   recipient: NotificationRecipient,
 * }}
 */
export function buildNotificationMailto(notification, settings) {
  const template = settings.templates[notification.event_type];
  const recipient = template?.recipient ?? 'driver';
  const ctx = {
    ...notification.context,
    payroll_email: settings.payroll_email,
  };
  const subject = fillTemplate(template?.subject ?? '', ctx);
  const body = fillTemplate(template?.body ?? '', ctx);

  /** @type {string} */
  let toEmail = '';
  if (recipient === 'payroll') {
    toEmail = String(settings.payroll_email ?? '').trim();
    if (!toEmail) {
      return {
        can_send: false,
        disabled_reason:
          'Payroll email not set — configure in Admin Settings → Email templates',
        mailto_url: null,
        subject,
        body,
        to_email: null,
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
        recipient,
      };
    }
  }

  const mailto_url =
    `mailto:${encodeURIComponent(toEmail)}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;

  return {
    can_send: true,
    disabled_reason: null,
    mailto_url,
    subject,
    body,
    to_email: toEmail,
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
  const payrollHint = notification.context.payroll_email
    ? String(notification.context.payroll_email)
    : 'payroll';

  switch (notification.event_type) {
    case 'WINDOW_LOCKED_IN':
      return email
        ? `Route ${route} locked in — send the driver an update to ${email}?`
        : `Route ${route} locked in — send the driver an update?`;
    case 'WINDOW_BID_PENDING':
      return `Route ${route} is bid pending — notify payroll${email ? ` (driver ${email})` : ''}?`;
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
    default:
      return `Update on route ${route} — send an email?`;
  }
}

/**
 * Diff prior vs next route-state change reports and build enqueue specs.
 * @param {import('./stateMachine.js').RouteStateMap} priorState
 * @param {import('./stateMachine.js').RouteStateMap} nextState
 * @param {{
 *   driversById?: Map<string, { name?: string, email?: string | null }>,
 * }} [options]
 * @returns {Array<{
 *   event_type: NotificationEventType,
 *   route_id: string,
 *   source_key: string,
 *   context: Record<string, string | number | null | undefined>,
 * }>}
 */
export function collectWindowFinalizationNotifications(
  priorState,
  nextState,
  options = {}
) {
  /** @type {ReturnType<typeof collectWindowFinalizationNotifications>} */
  const specs = [];

  for (const [routeId, next] of Object.entries(nextState)) {
    const priorReports = priorState[routeId]?.change_reports ?? [];
    const priorKeys = new Set(priorReports.map(changeReportMatchKey));
    const nextReports = next.change_reports ?? [];

    for (const report of nextReports) {
      const key = changeReportMatchKey(report);
      if (priorKeys.has(key)) continue;
      const event_type = eventTypeForChangeReportOutcome(report.outcome);
      if (!event_type) continue;

      const driver =
        (report.driver_id && options.driversById?.get(report.driver_id)) ||
        null;

      specs.push({
        event_type,
        route_id: routeId,
        source_key: `${event_type}|${routeId}|${key}`,
        context: {
          route_id: routeId,
          driver_name:
            driver?.name?.trim() || report.driver_name?.trim() || null,
          driver_email: driver?.email?.trim() || null,
          driver_id: report.driver_id ?? null,
          change_report_id: report.id ?? null,
          cumulative_drift_minutes: next.cumulative_drift_minutes ?? null,
          bump_decision_due_date: next.bump_decision_due_date ?? null,
          outcome: report.outcome,
        },
      });
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
