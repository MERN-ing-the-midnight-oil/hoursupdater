import { randomUUID } from 'node:crypto';
import { buildPayrollRoundingBreakdown } from './timeUtils.js';

/**
 * @typedef {import('./stateMachine.js').ChangeEvent} ChangeEvent
 * @typedef {import('./timeUtils.js').buildPayrollRoundingBreakdown} BreakdownFn
 */

/**
 * Before/after payroll math for the shared "see the math" UI.
 * Single path via buildPayrollRoundingBreakdown — used by Change Reports and Admin queue.
 *
 * @param {Record<string, string | null>} before_segments
 * @param {Record<string, string | null>} after_segments
 * @returns {{
 *   before: ReturnType<typeof buildPayrollRoundingBreakdown>,
 *   after: ReturnType<typeof buildPayrollRoundingBreakdown>,
 *   statement: string,
 *   contracted_hours_changed: boolean,
 *   contracted_hours_delta_minutes: number,
 * }}
 */
export function buildSeeTheMathFromSegments(before_segments, after_segments) {
  const before = buildPayrollRoundingBreakdown(before_segments);
  const after = buildPayrollRoundingBreakdown(after_segments);

  const contracted_hours_delta_minutes =
    after.payroll_rounded_total_minutes - before.payroll_rounded_total_minutes;
  const contracted_hours_changed = contracted_hours_delta_minutes !== 0;
  const schedule_changed =
    before.exact_total_minutes !== after.exact_total_minutes;

  let statement;
  if (contracted_hours_changed) {
    const sign = contracted_hours_delta_minutes > 0 ? '+' : '';
    statement =
      `Contracted hours changed by ${sign}${contracted_hours_delta_minutes} minutes ` +
      `(${before.payroll_rounded_total_minutes} → ${after.payroll_rounded_total_minutes}).`;
  } else if (schedule_changed) {
    statement =
      `Schedule changed (exact total ${before.exact_total_minutes} → ` +
      `${after.exact_total_minutes} minutes), but contracted hours did not change ` +
      `because both totals round to the same quarter-hour figure ` +
      `(${after.payroll_rounded_total_minutes} minutes).`;
  } else {
    statement =
      `Contracted hours unchanged at ${after.payroll_rounded_total_minutes} minutes ` +
      `(schedule total also unchanged).`;
  }

  return {
    before,
    after,
    statement,
    contracted_hours_changed,
    contracted_hours_delta_minutes,
  };
}

/**
 * @param {{
 *   route_id: string,
 *   driver_name: string | null,
 *   driver_id?: string | null,
 *   outcome: 'STABLE' | 'BID_PENDING',
 *   finalized_at: string,
 *   window_opened_date: string | null,
 *   before_segments: Record<string, string | null>,
 *   after_segments: Record<string, string | null>,
 *   contributing_changes: Array<ChangeEvent & { effective_delta_minutes?: number }>,
 * }} input
 */
export function buildChangeReport(input) {
  const math = buildSeeTheMathFromSegments(
    input.before_segments,
    input.after_segments
  );

  const changes = input.contributing_changes.map((change) => ({
    id: change.id,
    start_date: change.effective_date,
    segment: change.segment,
    previous_time: change.previous_time,
    new_time: change.new_time,
    delta_minutes:
      typeof change.effective_delta_minutes === 'number'
        ? change.effective_delta_minutes
        : change.delta_minutes,
    entered_by: change.entered_by,
    note: change.note,
  }));

  return {
    id: randomUUID(),
    route_id: input.route_id,
    driver_name: input.driver_name?.trim() || null,
    driver_id: input.driver_id ?? null,
    outcome: input.outcome,
    finalized_at: input.finalized_at,
    window_opened_date: input.window_opened_date,
    contributing_changes: changes,
    before: {
      segments: input.before_segments,
      math: math.before,
    },
    after: {
      segments: input.after_segments,
      math: math.after,
    },
    contracted_hours_changed: math.contracted_hours_changed,
    contracted_hours_delta_minutes: math.contracted_hours_delta_minutes,
    contracted_hours_statement: math.statement,
    // Alias for the shared "see the math" UI (after-state is the finalized schedule).
    see_the_math: {
      before: math.before,
      after: math.after,
      statement: math.statement,
    },
  };
}

/**
 * Plain-language email draft for a human to review/send (mailto:).
 * Does not claim interim pay during BID_PENDING (open question #1).
 *
 * @param {ReturnType<typeof buildChangeReport>} report
 * @param {{ name: string, email: string | null } | null} driver
 * @returns {{ can_send: boolean, disabled_reason: string | null, mailto_url: string | null, subject: string, body: string }}
 */
export function buildDriverEmailDraft(report, driver) {
  const subject =
    report.outcome === 'BID_PENDING'
      ? `Route ${report.route_id} time change — bid pending`
      : `Route ${report.route_id} time change — hours update`;

  const changeLines = report.contributing_changes
    .map(
      (c) =>
        `• ${c.start_date} ${c.segment}: ${c.previous_time} → ${c.new_time} ` +
        `(${c.delta_minutes >= 0 ? '+' : ''}${c.delta_minutes} min)`
    )
    .join('\n');

  const outcomeLine =
    report.outcome === 'BID_PENDING'
      ? 'This route’s accumulated time change has reached the bid threshold and is flagged for bidding. (Pay handling while a bid is pending is still being confirmed with Transportation — this note does not state interim pay.)'
      : 'These changes have locked in as the official route times.';

  const assignedName =
    driver?.name?.trim() || report.driver_name?.trim() || null;
  const isUnassigned = !assignedName && !report.driver_id && !driver?.email;

  const greetingName = assignedName
    ? assignedName.split(' ')[0] || assignedName
    : 'Driver';

  const body = [
    `Hi ${greetingName},`,
    '',
    `This is a summary of recent time changes on route ${report.route_id}.`,
    '',
    'Changes in this window:',
    changeLines || '• (no line items)',
    '',
    report.contracted_hours_statement,
    '',
    outcomeLine,
    '',
    'Please review and let the office know if you have questions.',
    '',
    'Thank you,',
    'Transportation',
  ].join('\n');

  if (isUnassigned) {
    return {
      can_send: false,
      disabled_reason:
        'No driver assigned to this route. Reassign a driver before drafting an email.',
      mailto_url: null,
      subject,
      body,
    };
  }

  if (!driver?.email?.trim()) {
    return {
      can_send: false,
      disabled_reason: `No email on file for ${assignedName}. Add an email in the driver directory before drafting.`,
      mailto_url: null,
      subject,
      body,
    };
  }

  const mailto_url =
    `mailto:${encodeURIComponent(driver.email.trim())}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;

  return {
    can_send: true,
    disabled_reason: null,
    mailto_url,
    subject,
    body,
  };
}

/**
 * Stable key for matching regenerated Change Reports across rebuilds
 * (report ids are new UUIDs each rebuild).
 * @param {{ outcome?: string, window_opened_date?: string | null, contributing_changes?: Array<{ id?: string }> }} report
 * @returns {string}
 */
export function changeReportMatchKey(report) {
  const ids = (report.contributing_changes ?? [])
    .map((change) => change.id)
    .filter(Boolean)
    .sort()
    .join(',');
  return `${report.outcome ?? ''}|${report.window_opened_date ?? ''}|${ids}`;
}

/**
 * Copy payroll_notified_at from prior reports onto rebuilt reports matched by key.
 * @param {import('./stateMachine.js').RouteStateMap} priorState
 * @param {import('./stateMachine.js').RouteStateMap} nextState
 * @returns {import('./stateMachine.js').RouteStateMap}
 */
export function preservePayrollNotifiedAt(priorState, nextState) {
  /** @type {import('./stateMachine.js').RouteStateMap} */
  const updated = { ...nextState };
  for (const [routeId, next] of Object.entries(nextState)) {
    const prior = priorState[routeId];
    if (!prior?.change_reports?.length || !next?.change_reports?.length) {
      continue;
    }
    /** @type {Map<string, string>} */
    const priorByKey = new Map();
    for (const report of prior.change_reports) {
      if (report?.payroll_notified_at) {
        priorByKey.set(
          changeReportMatchKey(report),
          report.payroll_notified_at
        );
      }
    }
    if (!priorByKey.size) {
      continue;
    }
    updated[routeId] = {
      ...next,
      change_reports: next.change_reports.map((report) => {
        const notified = priorByKey.get(changeReportMatchKey(report));
        if (!notified || report.payroll_notified_at) {
          return report;
        }
        return { ...report, payroll_notified_at: notified };
      }),
    };
  }
  return updated;
}

/**
 * Fill a payroll message template. Unknown / missing placeholders become empty.
 * Supported: {{route_id}}, {{driver_name}}, {{driver_email}}.
 *
 * @param {string} template
 * @param {{ route_id?: string | null, driver_name?: string | null, driver_email?: string | null }} values
 * @returns {string}
 */
export function fillPayrollMessageTemplate(template, values) {
  const map = {
    route_id: values.route_id?.trim() || '',
    driver_name: values.driver_name?.trim() || '',
    driver_email: values.driver_email?.trim() || '',
  };
  return String(template ?? '').replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : match
  );
}

/**
 * Mailto draft for payroll when a BID_PENDING Change Report exists.
 * App never sends — human reviews the draft.
 *
 * @param {{
 *   id?: string,
 *   route_id: string,
 *   driver_name?: string | null,
 *   driver_id?: string | null,
 *   outcome?: string,
 * }} report
 * @param {{ payroll_email: string, message_template: string }} settings
 * @param {{ name?: string | null, email?: string | null } | null} driver
 * @returns {{ can_send: boolean, disabled_reason: string | null, mailto_url: string | null, subject: string, body: string }}
 */
export function buildPayrollEmailDraft(report, settings, driver) {
  const routeId = report.route_id?.trim() || '';
  const driverName =
    driver?.name?.trim() || report.driver_name?.trim() || '';
  const driverEmail = driver?.email?.trim() || '';

  const body = fillPayrollMessageTemplate(settings.message_template, {
    route_id: routeId,
    driver_name: driverName,
    driver_email: driverEmail,
  });
  const subject = `Route ${routeId} — bid pending (payroll notice)`;

  const payrollEmail = settings.payroll_email?.trim() || '';
  if (!payrollEmail) {
    return {
      can_send: false,
      disabled_reason:
        'Payroll email not set — configure in Admin Settings',
      mailto_url: null,
      subject,
      body,
    };
  }

  const mailto_url =
    `mailto:${encodeURIComponent(payrollEmail)}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;

  return {
    can_send: true,
    disabled_reason: null,
    mailto_url,
    subject,
    body,
  };
}
