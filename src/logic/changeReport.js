import { createId } from './createId.js';
import { buildPayrollRoundingBreakdown } from './timeUtils.js';


// Before/after payroll math for the shared "see the math" UI.
// Single path via buildPayrollRoundingBreakdown — used by Change Reports and Admin queue.
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
    statement =
      `Contracted hours changed from ${formatContractHours(before.payroll_rounded_total_minutes)} ` +
      `to ${formatContractHours(after.payroll_rounded_total_minutes)} ` +
      `(${formatSignedContractHours(contracted_hours_delta_minutes)}).`;
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

// Hours and minutes, matching the route note ("4 hr 15 min").
export function formatContractHours(minutes) {
  const sign = minutes < 0 ? '−' : '';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  if (hours === 0) return `${sign}${mins} min`;
  if (mins === 0) return `${sign}${hours} hr`;
  return `${sign}${hours} hr ${mins} min`;
}

export function formatSignedContractHours(minutes) {
  if (minutes === 0) return '0 min';
  const sign = minutes > 0 ? '+' : '−';
  return `${sign}${formatContractHours(Math.abs(minutes))}`;
}

// Open-window note. Compares the official contract with the rounded total
// of the schedule as it stands, which can differ from the latest punch.
export function describeOpenWindowContractHours(currentMinutes, predictedMinutes) {
  const current = formatContractHours(currentMinutes);
  const predicted = formatContractHours(predictedMinutes);
  const delta = predictedMinutes - currentMinutes;
  if (delta === 0) {
    return (
      `Predicted contracted hours stay ${predicted}, the same as the current contracted hours. ` +
      `The latest logged change did not move the rounded total.`
    );
  }
  const direction = delta > 0 ? 'up' : 'down';
  return (
    `Predicted contracted hours are ${predicted}, ${direction} from the current contracted hours of ${current} ` +
    `(${formatSignedContractHours(delta)}). ` +
    `This is the rounded total for the whole schedule, not the size of the latest logged change.`
  );
}

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
    id: createId(),
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
    ...(input.forced_october_1 ? { forced_october_1: true } : {}),
    // Alias for the shared "see the math" UI (after-state is the finalized schedule).
    see_the_math: {
      before: math.before,
      after: math.after,
      statement: math.statement,
    },
  };
}

// Plain-language email draft for a human to review/send (mailto:).
// Does not claim interim pay during BID_PENDING (open question #1).
export function buildDriverEmailDraft(report, driver) {
  const subject =
    report.outcome === 'BID_PENDING'
      ? `Route ${report.route_id} time change — bid pending`
      : report.outcome === 'BUMP_ELIGIBLE'
        ? `Route ${report.route_id} time change — bump option`
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
      : report.outcome === 'BUMP_ELIGIBLE'
        ? 'This route’s accumulated time change is a decrease of 30 minutes or more. Per the contract, you may use seniority to bump a less-senior driver, or confirm that you choose to keep this assignment. You have two school days from written determination to decide.'
        : 'These changes have been automatically contracted as the official route times.';

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

// Stable key for matching regenerated Change Reports across rebuilds
export function changeReportMatchKey(report) {
  const ids = (report.contributing_changes ?? [])
    .map((change) => change.id)
    .filter(Boolean)
    .sort()
    .join(',');
  return `${report.outcome ?? ''}|${report.window_opened_date ?? ''}|${ids}`;
}

// Copy payroll_notified_at from prior reports onto rebuilt reports matched by key.
export function preservePayrollNotifiedAt(priorState, nextState) {
  const updated = { ...nextState };
  for (const [routeId, next] of Object.entries(nextState)) {
    const prior = priorState[routeId];
    if (!prior?.change_reports?.length || !next?.change_reports?.length) {
      continue;
    }
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

// Fill a payroll message template. Unknown / missing placeholders become empty.
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

// Mailto draft for payroll when a BID_PENDING Change Report exists.
// App never sends — human reviews the draft.
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

  const cc = String(settings.payroll_cc ?? '')
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter((part) => part.includes('@'))
    .join(',');
  const params = [
    `subject=${encodeURIComponent(subject)}`,
    `body=${encodeURIComponent(body)}`,
  ];
  if (cc) {
    params.push(`cc=${encodeURIComponent(cc)}`);
  }
  const mailto_url = `mailto:${encodeURIComponent(payrollEmail)}?${params.join('&')}`;

  return {
    can_send: true,
    disabled_reason: null,
    mailto_url,
    subject,
    body,
  };
}
