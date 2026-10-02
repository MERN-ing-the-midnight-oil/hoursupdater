import { buildEmployeeSnapshot, groupCalendarByMonth } from '../../employee-tracker/src/snapshot.js';
import {
  driverPacketDocument,
  driverPacketMail,
} from '../../office-tracker/src/driverPacket.js';
import { routeIdsForDriver } from '../logic/clockSheet.js';
import { calendarWithDays, changeBelongsToDriver } from './routeSheet.js';

/**
 * @param {import('../logic/calendar.js').SchoolCalendar} calendar
 */
export function packetCalendar(calendar) {
  const withDays = calendarWithDays(calendar);
  return {
    ...withDays,
    months: groupCalendarByMonth(withDays),
  };
}

/**
 * History sections for routes this driver held, using the district calendar.
 * @param {{ driver: object, changeLog: import('../logic/stateMachine.js').LogEntry[], routeState: Record<string, object>, calendar: import('../logic/calendar.js').SchoolCalendar, asOf: string, onlyRouteNames?: string[] }} input
 */
export function sectionsForLogDriver({
  driver,
  changeLog,
  routeState,
  calendar,
  asOf,
  onlyRouteNames,
}) {
  const allowed =
    Array.isArray(onlyRouteNames) && onlyRouteNames.length
      ? new Set(onlyRouteNames.map((item) => String(item ?? '').trim()))
      : null;
  const routeIds = routeIdsForDriver(changeLog, routeState, driver).filter(
    (routeId) => !allowed || allowed.has(routeId)
  );
  /** @type {Array<{ routeName: string, snapshot: object }>} */
  const sections = [];
  for (const routeId of routeIds) {
    const entry = routeState[routeId];
    if (!entry) continue;
    const routeLog = (changeLog ?? []).filter(
      (item) =>
        item.route_id === routeId &&
        (!item.type || item.type === 'CHANGE') &&
        changeBelongsToDriver(changeLog, item, driver)
    );
    if (!routeLog.length) continue;
    const startDate =
      routeLog
        .map((item) => item.effective_date)
        .filter(Boolean)
        .sort()[0] || null;
    sections.push({
      routeName: routeId,
      snapshot: buildEmployeeSnapshot({
        profile: { name: routeId, start_date: startDate },
        changeLog: routeLog,
        entry,
        calendar: calendarWithDays(calendar),
        asOfDate: asOf,
      }),
    });
  }
  return sections;
}

/**
 * @param {{ driver: object, changeLog: import('../logic/stateMachine.js').LogEntry[], routeState: Record<string, object>, calendar: import('../logic/calendar.js').SchoolCalendar, asOf: string, stylesheets?: string[], include?: object, onlyRouteNames?: string[], mail?: { subject?: string, body?: string } }} input
 */
export function packetForDriver({
  driver,
  changeLog,
  routeState,
  calendar,
  asOf,
  stylesheets = [],
  include,
  onlyRouteNames,
  mail,
}) {
  const name = String(driver?.name || '').trim();
  if (!name) return null;
  const sections = sectionsForLogDriver({
    driver,
    changeLog,
    routeState,
    calendar,
    asOf,
    onlyRouteNames,
  });
  if (!sections.length) return null;
  const routeNames = [];
  for (const section of sections) {
    if (!routeNames.includes(section.routeName)) routeNames.push(section.routeName);
  }
  const fallback = driverPacketMail({ driverName: name, routeNames });
  const subject = String(mail?.subject ?? '').trim();
  const body = String(mail?.body ?? '').trim();
  return {
    html: driverPacketDocument({
      driverName: name,
      sections,
      calendar: packetCalendar(calendar),
      stylesheets,
      generatedOn: asOf,
      include,
    }),
    routeNames,
    mail: {
      subject: subject || fallback.subject,
      body: body || fallback.body,
    },
  };
}
