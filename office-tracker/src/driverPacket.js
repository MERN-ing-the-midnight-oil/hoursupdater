import { buildSnapshot, getAsOfDate, getCalendarPack } from '../../employee-tracker/web/engine.js';
import { compareRouteNumbers } from '../web/store.js';
import { dayBefore, driverOwnsRoute, slicesForDriver } from './assignments.js';
import { routeNarrativeHtml } from './driverNarrative.js';
import {
  calendarMonthsHtml,
  escapeHtml,
  historyLegendHtml,
  prettyDate,
  scheduleHistoryTableHtml,
} from './historyMarkup.js';

/**
 * Routes assigned to one driver. Matching is the trimmed name, case-insensitive.
 * @param {object[] | null | undefined} profiles
 * @param {string} driverName
 */
export function profilesForDriver(profiles, driverName) {
  const name = String(driverName ?? '').trim();
  if (!name) return [];
  return (profiles ?? []).filter((profile) => driverOwnsRoute(profile, name));
}

/**
 * @param {string} driverName
 */
export function packetPdfBasename(driverName) {
  const slug = String(driverName ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'driver'}-clock-history`;
}

/**
 * @param {{ driverName: string, routeNames: string[] }} input
 */
export function driverPacketMail({ driverName, routeNames }) {
  const routes = routeNames.join(', ');
  const noun = routeNames.length === 1 ? 'route' : 'routes';
  return {
    subject: `Clock-time history for ${driverName}`,
    body:
      `Hi ${driverName},\n\n` +
      `Attached is a copy of your clock-time change history and calendar for ${noun} ${routes}. ` +
      `It includes a written explanation of those changes and the dates marked on the calendar. ` +
      `This copy includes only the routes assigned to you.\n`,
  };
}

export function packetCalendar() {
  const pack = getCalendarPack();
  return {
    ...pack.calendar,
    months: pack.months,
    source: pack.source,
    first_day: pack.first_day,
    last_day: pack.last_day,
  };
}

/**
 * @param {object | null | undefined} snapshot
 */
function routeSummaryHtml(snapshot) {
  const windowInfo = snapshot?.window;
  const contracted = snapshot?.contracted;
  const daysLeft =
    windowInfo?.days_remaining == null ? '—' : escapeHtml(windowInfo.days_remaining);
  return [
    windowInfo?.status_label
      ? `<p class="hero-kicker">${escapeHtml(windowInfo.status_label)}</p>`
      : '',
    windowInfo?.headline ? `<p class="hero-detail">${escapeHtml(windowInfo.headline)}</p>` : '',
    `<ul class="stat-row">
      <li><span>Contracted hours</span><strong>${escapeHtml(contracted?.label || '—')}</strong></li>
      <li><span>Accumulated difference</span><strong>${escapeHtml(
        windowInfo?.cumulative_drift_label || '0 min'
      )}</strong></li>
      <li><span>School days left in window</span><strong>${daysLeft}</strong></li>
    </ul>`,
    windowInfo?.projected_outcome_detail
      ? `<p class="hero-detail">${escapeHtml(windowInfo.projected_outcome_detail)}</p>`
      : '',
    windowInfo?.contracted_hours_statement
      ? `<p class="hero-detail">${escapeHtml(windowInfo.contracted_hours_statement)}</p>`
      : '',
  ]
    .filter(Boolean)
    .join('');
}

/**
 * @param {{ routeName: string, snapshot: object }} section
 * @param {object} calendar
 */
/**
 * Which pieces of a route's history appear in the PDF.
 * Omitted flags stay on, so a full packet is the default.
 * @param {object | null | undefined} include
 */
export function packetIncludes(include) {
  return {
    summary: include?.summary !== false,
    narrative: include?.narrative !== false,
    history: include?.history !== false,
    calendar: include?.calendar !== false,
  };
}

/**
 * @param {{ routeName: string, snapshot: object, assignment?: object }} section
 * @param {object} calendar
 * @param {ReturnType<typeof packetIncludes>} include
 */
function routeSectionHtml(section, calendar, include) {
  const snapshot = section.snapshot;
  const rows = snapshot?.schedule_history || [];
  const routeName = escapeHtml(section.routeName);
  const narrative = include.narrative
    ? routeNarrativeHtml({
        routeName: section.routeName,
        snapshot,
        calendar,
        assignment: section.assignment,
      })
    : '';
  const history = include.history
    ? `<h3>Change history</h3>
    <div class="table-wrap">${scheduleHistoryTableHtml(snapshot)}</div>`
    : '';
  const months = include.calendar
    ? `<h3>Calendar</h3>
    <p class="lead">
      Each color matches a row in this route's clock times. A square marks the
      day those times were established. When a change counts 15 school days,
      those days are filled and numbered. The day of the change does not count:
      the next school day is 1. An arrow covers the days still left before those
      times become contracted, and points at a box around that day. Light shading
      marks each end-of-month bid period.
    </p>
    <ul class="history-legend">${historyLegendHtml(rows)}</ul>
    <div class="calendar-months">${calendarMonthsHtml({
      calendar,
      rows,
      asOf: snapshot?.as_of,
    })}</div>`
    : '';
  return `<section class="panel packet-route">
    <h2>Route ${routeName}</h2>
    ${include.summary ? routeSummaryHtml(snapshot) : ''}
    ${narrative}
    ${history}
    ${months}
  </section>`;
}

/**
 * A standalone document for one driver. Callers must pass only that driver's routes.
 * @param {{ driverName: string, sections: Array<{ routeName: string, snapshot: object }>, calendar: object, stylesheets?: string[], generatedOn?: string, include?: object }} input
 */
export function driverPacketDocument({
  driverName,
  sections,
  calendar,
  stylesheets = [],
  generatedOn,
  include,
}) {
  const parts = packetIncludes(include);
  const name = String(driverName ?? '').trim();
  const routeList = [];
  for (const section of sections) {
    if (!routeList.includes(section.routeName)) routeList.push(section.routeName);
  }
  const listed = routeList.join(', ');
  const noun = routeList.length === 1 ? 'route' : 'routes';
  const spansRoutes = routeList.length > 1 || sections.some((section) => section.assignment?.until);
  const intro = spansRoutes
    ? `This copy includes only ${name}'s clock-time history, across ${noun} ${listed}.`
    : `This copy includes only the ${noun} assigned to ${name}: ${listed}.`;
  const links = stylesheets
    .map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}" />`)
    .join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Clock-time history for ${escapeHtml(name)}</title>
  ${links}
  <style>
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size: letter landscape; margin: 0.45in; }
    body { background: #fff; }
    .packet { width: auto; max-width: none; margin: 0; padding: 0; }
    .packet-banner { margin-bottom: 1.25rem; }
    .packet-route { break-before: page; }
    .packet-route:first-of-type { break-before: auto; }
    .packet .schedule-history { min-width: 0; }
    .packet-narrative p { max-width: 85ch; line-height: 1.45; }
  </style>
</head>
<body>
  <main class="shell packet">
    <header class="packet-banner">
      <p class="tour-kicker">Teamster Tracker</p>
      <h1>Clock-time history for ${escapeHtml(name)}</h1>
      <p class="lead">${escapeHtml(intro)} Prepared ${escapeHtml(prettyDate(generatedOn))}.</p>
    </header>
    ${sections.map((section) => routeSectionHtml(section, calendar, parts)).join('')}
  </main>
</body>
</html>`;
}

/**
 * Route slices and snapshots for one driver.
 * Returns null when that driver has no assigned routes.
 * @param {{ driverName: string, profiles: object[], asOf?: string }} input
 */
export function sectionsForDriver({ driverName, profiles, asOf }) {
  const name = String(driverName ?? '').trim();
  if (!name) return null;
  /** @type {Array<{ profile: object, assignment: { from: string, until: string | null, routeStarted: string } }>} */
  const pieces = [];
  for (const profile of profiles ?? []) {
    pieces.push(...slicesForDriver(profile, name));
  }
  pieces.sort(
    (a, b) =>
      a.assignment.from.localeCompare(b.assignment.from) ||
      compareRouteNumbers(a.profile.name, b.profile.name)
  );
  if (!pieces.length) return null;
  const packetAsOf = asOf || getAsOfDate(pieces[0].profile);
  const sections = pieces.map((piece) => {
    const snapshotAsOf =
      piece.assignment.until && piece.assignment.until <= packetAsOf
        ? dayBefore(piece.assignment.until)
        : packetAsOf;
    return {
      routeName: String(piece.profile.name || '').trim() || 'Route',
      assignment: piece.assignment,
      snapshot: buildSnapshot(piece.profile, snapshotAsOf || packetAsOf),
    };
  });
  const routeNames = [];
  for (const section of sections) {
    if (!routeNames.includes(section.routeName)) routeNames.push(section.routeName);
  }
  return {
    name,
    sections,
    routeNames,
    asOf: packetAsOf || sections[0].snapshot.as_of,
  };
}

/**
 * Build the siloed document for one driver.
 * Returns null when that driver has no assigned routes.
 * `onlyRouteNames` keeps the PDF to the routes named in the notice.
 * @param {{ driverName: string, profiles: object[], stylesheets?: string[], asOf?: string, include?: object, onlyRouteNames?: string[], mail?: { subject?: string, body?: string } }} input
 */
export function buildDriverPacket({
  driverName,
  profiles,
  stylesheets = [],
  asOf,
  include,
  onlyRouteNames,
  mail,
}) {
  const built = sectionsForDriver({ driverName, profiles, asOf });
  if (!built) return null;
  let { sections, routeNames } = built;
  if (Array.isArray(onlyRouteNames) && onlyRouteNames.length) {
    const allowed = new Set(onlyRouteNames.map((item) => String(item ?? '').trim()));
    sections = sections.filter((section) => allowed.has(section.routeName));
    routeNames = routeNames.filter((routeName) => allowed.has(routeName));
  }
  if (!sections.length) return null;
  const fallback = driverPacketMail({ driverName: built.name, routeNames });
  const subject = String(mail?.subject ?? '').trim();
  const body = String(mail?.body ?? '').trim();
  return {
    html: driverPacketDocument({
      driverName: built.name,
      sections,
      calendar: packetCalendar(),
      stylesheets,
      generatedOn: built.asOf,
      include,
    }),
    routeNames,
    mail: {
      subject: subject || fallback.subject,
      body: body || fallback.body,
    },
  };
}
