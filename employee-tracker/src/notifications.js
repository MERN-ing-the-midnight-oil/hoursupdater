import { changeReportMatchKey } from '../../src/logic/changeReport.js';
import { SEGMENTS } from '../../src/logic/constants.js';
import { formatDurationLabel, splitSegmentRange } from './clockTimes.js';

const SEGMENT_LABELS = {
  AM: 'AM',
  MIDDAY: 'Midday',
  PM: 'PM',
};

/**
 * In-app alerts for the employee tracker. Clock times become contracted only
 * when a review window closes under 30 minutes (STABLE lock-in).
 *
 * @param {ReturnType<import('./snapshot.js').buildEmployeeSnapshot>} snapshot
 * @returns {Array<{
 *   id: string,
 *   event_type: 'TIMES_CONTRACTED',
 *   title: string,
 *   detail: string,
 *   finalized_on: string | null,
 *   contracted_hours_statement: string,
 *   contracted_hours_label: string | null,
 *   time_changes: Array<{
 *     segment: string,
 *     previous_time: string,
 *     new_time: string,
 *     label: string,
 *   }>,
 *   contracted_times: Array<{
 *     segment: string,
 *     clock_in: string,
 *     clock_out: string,
 *     label: string,
 *   }>,
 * }>}
 */
export function buildEmployeeNotifications(snapshot) {
  const reports = snapshot?.reports ?? [];
  /** @type {ReturnType<typeof buildEmployeeNotifications>} */
  const notifications = [];

  for (const report of reports) {
    if (report?.outcome !== 'STABLE') {
      continue;
    }
    const id = changeReportMatchKey(report) || report.id;
    if (!id) {
      continue;
    }
    const contractedTimes = describeContractedTimes(report);
    const timeChanges = describeTimeChanges(report);
    const contractedMinutes =
      report.see_the_math?.after?.payroll_rounded_total_minutes ??
      snapshot?.contracted?.minutes ??
      null;

    notifications.push({
      id,
      event_type: 'TIMES_CONTRACTED',
      title: 'Your clock times are now contracted',
      detail:
        'The review window closed. These clock-in and clock-out times have locked in as your contracted schedule.',
      finalized_on: report.finalized_at
        ? String(report.finalized_at).slice(0, 10)
        : null,
      contracted_hours_statement: report.contracted_hours_statement || '',
      contracted_hours_label:
        typeof contractedMinutes === 'number'
          ? formatDurationLabel(contractedMinutes)
          : snapshot?.contracted?.label ?? null,
      time_changes: timeChanges,
      contracted_times: contractedTimes,
    });
  }

  return notifications;
}

/**
 * @param {ReturnType<typeof buildEmployeeNotifications>} notifications
 * @param {string[]} [dismissedIds]
 */
export function visibleEmployeeNotifications(notifications, dismissedIds = []) {
  const dismissed = new Set(
    (dismissedIds ?? []).filter((id) => typeof id === 'string' && id)
  );
  return (notifications ?? []).filter((note) => note?.id && !dismissed.has(note.id));
}

/**
 * @param {object} report
 */
function describeContractedTimes(report) {
  const segments = report.after_segments ?? {};
  /** @type {Array<{ segment: string, clock_in: string, clock_out: string, label: string }>} */
  const rows = [];
  for (const segment of SEGMENTS) {
    const split = splitSegmentRange(segments[segment] ?? null);
    if (!split) continue;
    rows.push({
      segment,
      clock_in: split.clock_in,
      clock_out: split.clock_out,
      label: `${SEGMENT_LABELS[segment] ?? segment} ${split.clock_in}–${split.clock_out}`,
    });
  }
  return rows;
}

/**
 * @param {object} report
 */
function describeTimeChanges(report) {
  return (report.contributing_changes ?? [])
    .filter(
      (change) =>
        change?.previous_time &&
        change?.new_time &&
        change.previous_time !== change.new_time
    )
    .map((change) => ({
      segment: change.segment,
      previous_time: change.previous_time,
      new_time: change.new_time,
      label: `${SEGMENT_LABELS[change.segment] ?? change.segment} ${change.previous_time} → ${change.new_time}`,
    }));
}
