import { BID_THRESHOLD_MINUTES, SEGMENTS } from '../../src/logic/constants.js';
import { daysRemainingInWindow } from '../../src/logic/calendar.js';
import { buildSeeTheMathFromSegments } from '../../src/logic/changeReport.js';
import { contractWindowPlan } from '../../src/logic/contractWindows.js';
import {
  applyChangeToRoute,
  rebuildRouteStateFromChangeLog,
  windowFinalizationOutcome,
} from '../../src/logic/stateMachine.js';
import {
  buildPayrollRoundingBreakdown,
  computeDeltaMinutes,
  toDateString,
} from '../../src/logic/timeUtils.js';
import {
  dayAfter,
  formatDurationLabel,
  formatSegmentRange,
  splitSegmentRange,
} from './clockTimes.js';

export const EMPLOYEE_ROUTE_ID = 'SELF';

const STATUS_COPY = {
  STABLE: {
    label: 'Stable',
    summary: 'No open review window. Your contracted hours match the last lock-in (or your starting schedule).',
  },
  ACCUMULATING: {
    label: 'Accumulating',
    summary:
      'A review window is open. Further changes reset it and add the exact minute difference. When it closes, these times become contracted — or go to bid/bump if the difference is 30 minutes or more.',
  },
  BID_PENDING: {
    label: 'Bid pending',
    summary:
      'The window closed with an increase of 30 minutes or more. Under the contract this assignment would be posted for bid.',
  },
  BUMP_ELIGIBLE: {
    label: 'Bump eligible',
    summary:
      'The window closed with a decrease of 30 minutes or more. Under the contract you would have a bump option.',
  },
  NEEDS_REVIEW: {
    label: 'Needs review',
    summary: 'A later correction would change an outcome that already finalized.',
  },
  LOCKED_PENDING: {
    label: 'Locked pending',
    summary: 'Window closed; waiting on a lock-in outcome.',
  },
};

const WINDOW_RULE_HEADLINE = {
  pre_october_1_lock:
    'Before October 1 a change under 30 minutes becomes contracted on October 1 (Art. 3.08(a)(8)(c)).',
  pre_october_1_bid:
    'Before October 1 a 30-minute increase that has lasted 15 school days is posted for bid (Art. 3.08(a)(8)(a)).',
  pre_october_1_bump:
    'Before October 1 a 30-minute decrease is bump-eligible on the written determination date (Art. 3.08(a)(8)(b)).',
  post_october_1_increase_lock:
    'After October 1 a 15-minute increase becomes contracted the workday after it has lasted 15 school days (Art. 3.08(b)(3)).',
  post_october_1_decrease_lock:
    'After October 1 a decrease under 30 minutes is counted with any other change in the same 15 school days, then becomes contracted the next school day (Art. 3.08(b)(4)).',
  post_october_1_bid:
    'After October 1 a 30-minute increase is posted for bid during the last five school days of the month, October through April (Art. 3.08(b)(1)).',
  post_october_1_bump:
    'After October 1 a 30-minute decrease is bump-eligible after it has lasted 15 school days (Art. 3.08(b)(2)).',
};

const OUTCOME_COPY = {
  STABLE: {
    label: 'Lock in as contracted hours',
    detail:
      'The accumulated difference is under 30 minutes, so the new clock times lock in. Contracted hours become the nearest quarter-hour of your daily total.',
  },
  BID_PENDING: {
    label: 'Posted for bid',
    detail:
      'The accumulated difference is an increase of 30 minutes or more. The new contracted figure is calculated, but the assignment would be posted for bid.',
  },
  BUMP_ELIGIBLE: {
    label: 'Bump eligible',
    detail:
      'The accumulated difference is a decrease of 30 minutes or more. You would have a contract bump option.',
  },
};

/**
 * @param {import('../../src/logic/stateMachine.js').LogEntry[]} changeLog
 * @param {import('../../src/logic/calendar.js').SchoolCalendar} calendar
 * @param {string} asOfDate
 * @param {import('../../src/logic/stateMachine.js').RouteStateMap} [prior]
 */
export function rebuildEmployeeRouteState(
  changeLog,
  calendar,
  asOfDate,
  prior = {}
) {
  const map = rebuildRouteStateFromChangeLog(
    changeLog,
    {},
    calendar,
    asOfDate,
    { priorRouteState: prior }
  );
  return map[EMPLOYEE_ROUTE_ID] ?? null;
}

/**
 * @param {Record<string, string | null | undefined>} segments
 */
export function describeSchedule(segments) {
  /** @type {Record<string, ReturnType<typeof splitSegmentRange>>} */
  const out = {};
  for (const segment of SEGMENTS) {
    out[segment] = splitSegmentRange(segments?.[segment] ?? null);
  }
  return out;
}

function isSeedChange(change) {
  return (
    change &&
    change.delta_minutes === 0 &&
    change.previous_time === change.new_time
  );
}

function chronologicalChangeCompare(a, b) {
  const dateCompare = String(a.effective_date).localeCompare(
    String(b.effective_date)
  );
  if (dateCompare !== 0) {
    return dateCompare;
  }
  return String(a.submitted_at).localeCompare(String(b.submitted_at));
}

function reportChangeIds(report) {
  return (report?.contributing_changes ?? []).map((item) => item.id);
}

/**
 * One row per established starting schedule, then one row per later change.
 * Oldest first so the most recent change is last.
 *
 * @param {import('../../src/logic/stateMachine.js').LogEntry[]} changeLog
 * @param {import('../../src/logic/stateMachine.js').RouteStateEntry | null} entry
 * @param {ReturnType<typeof buildWindowView> | null} window
 * @param {string | null} startDate
 */
export function buildScheduleHistory(changeLog, entry, window, startDate) {
  const events = (changeLog ?? [])
    .filter((item) => !item.type || item.type === 'CHANGE')
    .slice()
    .sort(chronologicalChangeCompare);
  const seeds = events.filter(isSeedChange);
  const later = events.filter((item) => !isSeedChange(item));
  if (!seeds.length && !later.length) {
    return [];
  }

  /** @type {Record<string, string | null>} */
  const running = { AM: null, MIDDAY: null, PM: null };
  for (const seed of seeds) {
    running[seed.segment] = seed.new_time;
  }

  const reports = entry?.change_reports ?? [];
  const openIds = entry?.contributing_change_ids ?? [];
  const lastOpenId = openIds.at(-1) ?? null;

  /** @type {object[]} */
  const rows = [
    {
      id: 'initial',
      kind: 'initial',
      date: startDate || seeds[0]?.effective_date || null,
      change_id: null,
      segment: null,
      previous_time: null,
      new_time: null,
      previous: null,
      next: null,
      delta_minutes: null,
      delta_label: null,
      cumulative_drift_minutes: null,
      cumulative_drift_label: null,
      note: '',
      schedule: describeSchedule(running),
      contracted: {
        status: 'established',
        becomes_on: null,
        projected_outcome: null,
        projected_outcome_label: null,
        label: 'Established starting schedule',
        detail: null,
      },
    },
  ];

  for (const change of later) {
    running[change.segment] = change.new_time;
    rows.push({
      id: change.id,
      kind: 'change',
      date: change.effective_date,
      change_id: change.id,
      segment: change.segment,
      previous_time: change.previous_time,
      new_time: change.new_time,
      previous: splitSegmentRange(change.previous_time),
      next: splitSegmentRange(change.new_time),
      delta_minutes: change.delta_minutes,
      delta_label: formatSignedMinutes(change.delta_minutes),
      cumulative_drift_minutes: null,
      cumulative_drift_label: null,
      note: change.note || '',
      schedule: describeSchedule(running),
      contracted: contractedStatusForChange(change, {
        reports,
        openIds,
        lastOpenId,
        entry,
        window,
      }),
    });
  }

  annotateCumulativeDrift(rows, entry);
  return rows;
}

/**
 * Running exact-minute total inside each review window, as of that change.
 * A later change in the same window keeps the earlier changes in the sum.
 *
 * @param {object[]} rows
 * @param {import('../../src/logic/stateMachine.js').RouteStateEntry | null} entry
 */
function annotateCumulativeDrift(rows, entry) {
  /** @type {Map<string, object>} */
  const byId = new Map();
  for (const row of rows) {
    if (row.kind === 'change' && row.change_id) {
      byId.set(row.change_id, row);
    }
  }
  if (!byId.size) return;

  /** @type {string[][]} */
  const groups = [];
  const covered = new Set();
  for (const report of entry?.change_reports ?? []) {
    const ids = (report.contributing_changes ?? [])
      .map((item) => item.id)
      .filter((id) => byId.has(id) && !covered.has(id));
    if (!ids.length) continue;
    groups.push(ids);
    for (const id of ids) covered.add(id);
  }

  const openIds = (entry?.contributing_change_ids ?? []).filter(
    (id) => byId.has(id) && !covered.has(id)
  );
  if (openIds.length) groups.push(openIds);

  for (const ids of groups) {
    let sum = 0;
    for (const id of ids) {
      const row = byId.get(id);
      sum += row.delta_minutes ?? 0;
      row.cumulative_drift_minutes = sum;
      row.cumulative_drift_label = formatSignedMinutes(sum);
    }
  }
}

function contractedStatusForChange(change, { reports, openIds, lastOpenId, entry, window }) {
  for (const report of reports) {
    const ids = reportChangeIds(report);
    if (!ids.includes(change.id)) {
      continue;
    }
    if (ids.at(-1) === change.id) {
      const becomesOn = String(report.finalized_at || '').slice(0, 10) || null;
      const outcomeCopy = OUTCOME_COPY[report.outcome];
      if (report.outcome === 'STABLE') {
        return {
          status: 'became_contracted',
          becomes_on: becomesOn,
          projected_outcome: report.outcome,
          projected_outcome_label: outcomeCopy?.label ?? null,
          label: becomesOn
            ? `Became contracted on ${prettyDate(becomesOn)}`
            : 'Became contracted',
          detail: outcomeCopy?.detail ?? report.contracted_hours_statement ?? null,
        };
      }
      return {
        status:
          report.outcome === 'BID_PENDING'
            ? 'bid_pending'
            : report.outcome === 'BUMP_ELIGIBLE'
              ? 'bump_eligible'
              : String(report.outcome).toLowerCase(),
        becomes_on: becomesOn,
        projected_outcome: report.outcome,
        projected_outcome_label: outcomeCopy?.label ?? null,
        label: becomesOn
          ? `Window closed ${prettyDate(becomesOn)} · ${
              outcomeCopy?.label?.toLowerCase() ?? report.outcome
            }`
          : outcomeCopy?.label ?? report.outcome,
        detail: outcomeCopy?.detail ?? report.contracted_hours_statement ?? null,
      };
    }
    return {
      status: 'superseded',
      becomes_on: null,
      projected_outcome: null,
      projected_outcome_label: null,
      label: 'Replaced by a later change in that window',
      detail: null,
    };
  }

  if (entry?.status === 'ACCUMULATING' && openIds.includes(change.id)) {
    if (change.id === lastOpenId) {
      const becomesOn = window?.becomes_contracted_on ?? null;
      return {
        status: 'predicted',
        becomes_on: becomesOn,
        projected_outcome: window?.projected_outcome ?? null,
        projected_outcome_label: window?.projected_outcome_label ?? null,
        label: becomesOn
          ? `Predicted to become contracted on ${prettyDate(becomesOn)}`
          : 'Predicted to become contracted',
        detail: window?.projected_outcome_detail ?? null,
      };
    }
    return {
      status: 'superseded',
      becomes_on: null,
      projected_outcome: null,
      projected_outcome_label: null,
      label: 'Later change reset this window',
      detail: null,
    };
  }

  if (
    (entry?.status === 'BID_PENDING' || entry?.status === 'BUMP_ELIGIBLE') &&
    change.id === lastOpenId
  ) {
    const outcomeCopy = OUTCOME_COPY[entry.status];
    return {
      status:
        entry.status === 'BID_PENDING' ? 'bid_pending' : 'bump_eligible',
      becomes_on: null,
      projected_outcome: entry.status,
      projected_outcome_label: outcomeCopy?.label ?? null,
      label: outcomeCopy?.label ?? entry.status,
      detail: outcomeCopy?.detail ?? null,
    };
  }

  return {
    status: 'superseded',
    becomes_on: null,
    projected_outcome: null,
    projected_outcome_label: null,
    label: 'Replaced by a later change',
    detail: null,
  };
}

/**
 * @param {import('../../src/logic/stateMachine.js').RouteStateEntry | null} entry
 */
export function officialContractedMinutes(entry) {
  if (!entry) {
    return null;
  }
  if (entry.payroll_rounded_total_minutes != null) {
    return entry.payroll_rounded_total_minutes;
  }
  const source =
    entry.status === 'ACCUMULATING'
      ? entry.baseline_segments
      : entry.segments;
  return buildPayrollRoundingBreakdown(source).payroll_rounded_total_minutes;
}

/**
 * @param {object} input
 * @param {object | null} input.profile
 * @param {import('../../src/logic/stateMachine.js').LogEntry[]} input.changeLog
 * @param {import('../../src/logic/stateMachine.js').RouteStateEntry | null} input.entry
 * @param {import('../../src/logic/calendar.js').SchoolCalendar} input.calendar
 * @param {string} input.asOfDate
 * @param {object} [input.calendarSummary]
 * @param {object} [input.calendarSource]
 */
export function buildEmployeeSnapshot({
  profile,
  changeLog,
  entry,
  calendar,
  asOfDate,
  calendarSummary,
  calendarSource,
}) {
  const asOf = toDateString(asOfDate);
  const setup_complete = Boolean(profile && entry);
  const changes = changeLog
    .filter((item) => !item.type || item.type === 'CHANGE')
    .map((change) => ({
      id: change.id,
      segment: change.segment,
      change_date: change.effective_date,
      previous_time: change.previous_time,
      new_time: change.new_time,
      previous: splitSegmentRange(change.previous_time),
      next: splitSegmentRange(change.new_time),
      delta_minutes: change.delta_minutes,
      delta_label: formatSignedMinutes(change.delta_minutes),
      note: change.note || '',
      is_seed: change.delta_minutes === 0 && change.previous_time === change.new_time,
      submitted_at: change.submitted_at,
    }))
    .sort((a, b) => {
      const dateCompare = b.change_date.localeCompare(a.change_date);
      if (dateCompare !== 0) return dateCompare;
      return b.submitted_at.localeCompare(a.submitted_at);
    });

  const schedule = describeSchedule(entry?.segments ?? {});
  const scheduledExact = entry
    ? buildPayrollRoundingBreakdown(entry.segments)
    : null;
  const contractedMinutes = officialContractedMinutes(entry);
  const window = entry ? buildWindowView(entry, calendar, asOf) : null;
  const schedule_history = buildScheduleHistory(
    changeLog,
    entry,
    window,
    profile?.start_date ?? null
  );

  return {
    setup_complete,
    as_of: asOf,
    employee: {
      name: profile?.name?.trim() || '',
      start_date: profile?.start_date ?? null,
    },
    calendar: {
      school_year: calendar.school_year ?? '2026-2027',
      first_day: calendarSummary?.first_day ?? '2026-09-08',
      last_day: calendarSummary?.last_day ?? '2027-06-22',
      school_day_count:
        calendarSummary?.school_day_count ?? calendar.school_days?.length ?? null,
      source: calendarSource ?? null,
    },
    schedule,
    scheduled: scheduledExact
      ? {
          exact_minutes: scheduledExact.exact_total_minutes,
          exact_label: formatDurationLabel(scheduledExact.exact_total_minutes),
          if_locked_minutes: scheduledExact.payroll_rounded_total_minutes,
          if_locked_label: formatDurationLabel(
            scheduledExact.payroll_rounded_total_minutes
          ),
        }
      : null,
    contracted:
      contractedMinutes == null
        ? null
        : {
            minutes: contractedMinutes,
            label: formatDurationLabel(contractedMinutes),
            source:
              entry?.payroll_rounded_total_minutes != null
                ? 'last_finalization'
                : 'starting_schedule',
          },
    window,
    schedule_history,
    changes,
    reports: (entry?.change_reports ?? []).map(shapeReport).reverse(),
    bid_threshold_minutes: BID_THRESHOLD_MINUTES,
    window_length_school_days: 15,
  };
}

/**
 * @param {import('../../src/logic/stateMachine.js').RouteStateEntry} entry
 * @param {import('../../src/logic/calendar.js').SchoolCalendar} calendar
 * @param {string} asOf
 */
function buildWindowView(entry, calendar, asOf) {
  const status = entry.status;
  const copy = STATUS_COPY[status] ?? {
    label: status,
    summary: '',
  };
  const open = status === 'ACCUMULATING' && entry.window_expires_date;
  const drift = entry.cumulative_drift_minutes ?? 0;
  const daysRemaining = open
    ? daysRemainingInWindow(calendar, asOf, entry.window_expires_date)
    : null;
  const becomesOn = open ? dayAfter(entry.window_expires_date) : null;
  const projectedOutcome = open ? windowFinalizationOutcome(drift) : null;
  const outcomeCopy = projectedOutcome ? OUTCOME_COPY[projectedOutcome] : null;
  const math = open
    ? buildSeeTheMathFromSegments(entry.baseline_segments, entry.segments)
    : null;

  let headline = copy.summary;
  if (open && becomesOn && outcomeCopy) {
    const ruleNote =
      WINDOW_RULE_HEADLINE[entry.window_rule] ??
      'If you do not log another change, these times become contracted on the date below.';
    headline =
      `${ruleNote} If you do not log another change, that date is ${prettyDate(becomesOn)}. ` +
      `Projected result: ${outcomeCopy.label.toLowerCase()}.`;
  } else if (status === 'STABLE' && entry.payroll_rounded_total_minutes != null) {
    headline =
      'Your latest window has locked in. The contracted hours below are official under the contract rules.';
  } else if (status === 'STABLE') {
    headline =
      'These are your starting clock times. Log a change to open a review window.';
  }

  return {
    status,
    status_label: copy.label,
    headline,
    summary: copy.summary,
    opened_date: entry.window_opened_date ?? null,
    expires_date: entry.window_expires_date ?? null,
    window_rule: entry.window_rule ?? null,
    becomes_contracted_on: becomesOn,
    days_remaining: daysRemaining,
    cumulative_drift_minutes: drift,
    cumulative_drift_label: formatSignedMinutes(drift),
    projected_outcome: projectedOutcome,
    projected_outcome_label: outcomeCopy?.label ?? null,
    projected_outcome_detail: outcomeCopy?.detail ?? null,
    contracted_hours_would_change: math?.contracted_hours_changed ?? null,
    contracted_hours_delta_minutes: math?.contracted_hours_delta_minutes ?? null,
    contracted_hours_statement: math?.statement ?? null,
    see_the_math: math,
  };
}

/**
 * @param {object} report
 */
function shapeReport(report) {
  return {
    id: report.id,
    outcome: report.outcome,
    outcome_label: OUTCOME_COPY[report.outcome]?.label ?? report.outcome,
    finalized_at: report.finalized_at,
    window_opened_date: report.window_opened_date,
    contracted_hours_changed: report.contracted_hours_changed,
    contracted_hours_delta_minutes: report.contracted_hours_delta_minutes,
    contracted_hours_statement: report.contracted_hours_statement,
    see_the_math: report.see_the_math,
    before_segments: report.before?.segments ?? null,
    after_segments: report.after?.segments ?? null,
    contributing_changes: report.contributing_changes ?? [],
  };
}

/**
 * @param {number} minutes
 */
export function formatSignedMinutes(minutes) {
  if (typeof minutes !== 'number' || Number.isNaN(minutes)) {
    return '—';
  }
  if (minutes === 0) {
    return '0 min';
  }
  const sign = minutes > 0 ? '+' : '−';
  return `${sign}${formatDurationLabel(Math.abs(minutes))}`;
}

/**
 * Preview a not-yet-saved clock change using the same state machine.
 *
 * @param {{
 *   entry: import('../../src/logic/stateMachine.js').RouteStateEntry | null,
 *   calendar: import('../../src/logic/calendar.js').SchoolCalendar,
 *   segment: string,
 *   clock_in: string,
 *   clock_out: string,
 *   change_date: string,
 * }} input
 */
export function previewEmployeeChange({
  entry,
  calendar,
  segment,
  clock_in,
  clock_out,
  change_date,
}) {
  if (!entry) {
    throw new Error('Set up your starting schedule before previewing a change.');
  }
  if (!SEGMENTS.includes(segment)) {
    throw new Error(`segment must be one of: ${SEGMENTS.join(', ')}.`);
  }
  const previous = entry.segments[segment];
  if (!previous) {
    throw new Error(
      `No ${segment} times on file yet. Add that run to your starting schedule first.`
    );
  }
  const newTime = formatSegmentRange(clock_in, clock_out);
  const delta = computeDeltaMinutes(previous, newTime);
  const changeDate = toDateString(change_date);
  const hypothetical = {
    id: 'preview',
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: entry.driver_name ?? '',
    driver_id: entry.driver_id ?? null,
    segment,
    submitted_at: `${changeDate}T00:00:00.000Z`,
    effective_date: changeDate,
    previous_time: previous,
    new_time: newTime,
    computed_delta_minutes: delta,
    delta_minutes: delta,
    routing_adjustment: null,
    reason_category: 'OTHER',
    note: '',
    entered_by: 'Self',
  };
  const next = applyChangeToRoute(entry, hypothetical, calendar, changeDate, delta);
  const nextDrift = next.cumulative_drift_minutes ?? delta;
  const plan = contractWindowPlan(calendar, changeDate, nextDrift);
  const outcome = windowFinalizationOutcome(nextDrift);
  const math = buildSeeTheMathFromSegments(next.baseline_segments, next.segments);

  return {
    previous_time: previous,
    new_time: newTime,
    previous: splitSegmentRange(previous),
    next: splitSegmentRange(newTime),
    delta_minutes: delta,
    delta_label: formatSignedMinutes(delta),
    window_expires_date: plan.window_expires_date,
    becomes_contracted_on: plan.becomes_effective_on,
    cumulative_drift_minutes: nextDrift,
    cumulative_drift_label: formatSignedMinutes(nextDrift),
    projected_outcome: outcome,
    projected_outcome_label: OUTCOME_COPY[outcome].label,
    projected_outcome_detail: OUTCOME_COPY[outcome].detail,
    contracted_hours_would_change: math.contracted_hours_changed,
    contracted_hours_delta_minutes: math.contracted_hours_delta_minutes,
    contracted_hours_statement: math.statement,
  };
}

/**
 * Group calendar days by YYYY-MM for the UI.
 * @param {import('../../src/logic/calendar.js').SchoolCalendar} calendar
 */
/**
 * @param {string} iso
 */
function prettyDate(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function groupCalendarByMonth(calendar) {
  /** @type {Record<string, { month: string, label: string, days: object[] }>} */
  const months = {};
  for (const day of calendar.days ?? []) {
    const month = day.date.slice(0, 7);
    if (!months[month]) {
      const [year, mon] = month.split('-');
      const label = new Date(Date.UTC(Number(year), Number(mon) - 1, 1))
        .toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      months[month] = { month, label, days: [] };
    }
    months[month].days.push(day);
  }
  return Object.values(months).filter((month) =>
    month.days.some((day) => day.is_school_day)
  );
}
