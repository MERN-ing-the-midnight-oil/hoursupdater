import {
  buildScheduleHistory,
  groupCalendarByMonth,
} from '../../employee-tracker/src/snapshot.js';
import {
  calendarMonthsHtml,
  historyLegendHtml,
  scheduleHistoryTableHtml,
} from '../../office-tracker/src/historyMarkup.js';
import { driverNameOnChange } from '../logic/clockSheet.js';
import { resolveDriverAssignment } from '../logic/stateMachine.js';

/**
 * District calendars are sometimes a bare school_days list. The colored
 * calendar needs every civil day in that span.
 * @param {import('../logic/calendar.js').SchoolCalendar} calendar
 */
export function calendarWithDays(calendar) {
  if (Array.isArray(calendar?.days) && calendar.days.length) return calendar;
  const school = [...(calendar?.school_days ?? [])].filter(Boolean).sort();
  if (!school.length) return calendar;
  const start = calendar.coverage_start || school[0];
  const end = calendar.coverage_end || school[school.length - 1];
  const schoolSet = new Set(school);
  /** @type {object[]} */
  const days = [];
  let cursor = start;
  while (cursor && cursor <= end) {
    const dow = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    days.push({
      date: cursor,
      is_school_day: schoolSet.has(cursor),
      reason: schoolSet.has(cursor) ? '' : weekend ? 'Weekend' : 'Off',
    });
    cursor = nextDate(cursor);
  }
  return { ...calendar, days };
}

/**
 * @param {string} iso
 */
function nextDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

/**
 * @param {import('../logic/stateMachine.js').LogEntry[]} changeLog
 * @param {import('../logic/stateMachine.js').ChangeEvent} change
 * @param {{ driver_id?: string | null, name?: string | null }} driver
 */
export function changeBelongsToDriver(changeLog, change, driver) {
  if (change.type && change.type !== 'CHANGE') return false;
  const date = String(change.effective_date || '').slice(0, 10);
  const asOf = date ? `${date}T23:59:59.999Z` : change.submitted_at || '';
  const held = resolveDriverAssignment(changeLog, change.route_id, asOf);
  if (driver.driver_id && held.driver_id === driver.driver_id) return true;
  const heldName = String(held.driver_name || '').trim().toLowerCase();
  const name = String(driver.name || '').trim().toLowerCase();
  return Boolean(name) && heldName === name;
}

/**
 * Wide schedule plus colored calendar for one route.
 * Corrections are not applied here. Callers append a new log entry.
 *
 * @param {{ routeId: string, entry: object, changeLog: import('../logic/stateMachine.js').LogEntry[], calendar: import('../logic/calendar.js').SchoolCalendar, asOf: string }} input
 */
export function buildRouteSheet({ routeId, entry, changeLog, calendar, asOf }) {
  const routeLog = (changeLog ?? []).filter((item) => item.route_id === routeId);
  const changes = routeLog.filter((item) => !item.type || item.type === 'CHANGE');
  const startDate =
    changes
      .map((item) => item.effective_date)
      .filter(Boolean)
      .sort()[0] || null;
  const rows = buildScheduleHistory(routeLog, entry, null, startDate);
  const byId = new Map(routeLog.map((item) => [item.id, item]));
  const enriched = rows.map((row) => {
    const change = row.change_id ? byId.get(row.change_id) : null;
    return {
      ...row,
      entered_by: change?.entered_by || '',
      submitted_at: change?.submitted_at || '',
      driver_name: change
        ? driverNameOnChange(changeLog, change)
        : entry.driver_name || '',
    };
  });
  const view = {
    ...calendarWithDays(calendar),
    months: groupCalendarByMonth(calendarWithDays(calendar)),
  };
  return {
    route_id: routeId,
    driver_name: entry.driver_name || '',
    driver_id: entry.driver_id ?? null,
    status: entry.status,
    segments: entry.segments ?? {},
    cumulative_drift_minutes: entry.cumulative_drift_minutes ?? 0,
    window_expires_date: entry.window_expires_date ?? null,
    rows: enriched,
    history_html: scheduleHistoryTableHtml({
      schedule_history: enriched,
      as_of: asOf,
    }),
    legend_html: historyLegendHtml(enriched),
    calendar_html: calendarMonthsHtml({
      calendar: view,
      rows: enriched,
      asOf,
    }),
  };
}
