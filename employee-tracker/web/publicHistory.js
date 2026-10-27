import { dayBefore, routeAssignments, slicesForDriver } from '../../office-tracker/src/assignments.js';
import {
  calendarMonthsHtml,
  escapeHtml,
  historyLegendHtml,
  prettyDate,
  scheduleHistoryTableHtml,
} from '../../office-tracker/src/historyMarkup.js';
import { buildSnapshot, getAsOfDate, getCalendarPack, useSchoolYearCalendar } from './engine.js';

// Shared gate for the public page. The office function checks the same value.
export const PAGE_PASSWORD = '07041776';

// The live page. Share this address by itself. The password stays in the message.
export const PUBLISHED_SHARE_URL = 'https://mern-ing-the-midnight-oil.github.io/hoursupdater/';

export function sharePayload() {
  return {
    title: 'Route change history',
    text: `Route change history\n${PUBLISHED_SHARE_URL}\nPassword: ${PAGE_PASSWORD}`,
  };
}

export function shareMailHref() {
  const body = sharePayload().text;
  return `mailto:?subject=${encodeURIComponent('Route change history')}&body=${encodeURIComponent(body)}`;
}

// iOS uses sms:&body=. Android uses sms:?body=.
export function shareTextHref(userAgent = '') {
  const body = encodeURIComponent(sharePayload().text);
  return /Android/i.test(userAgent) ? `sms:?body=${body}` : `sms:&body=${body}`;
}

function compareRouteNumbers(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function routeLabel(profile) {
  return String(profile?.name || '').trim() || 'Route';
}

// The office school year, when one is saved. Otherwise the built-in calendar.
export function prepareCalendar(schoolYear) {
  useSchoolYearCalendar(schoolYear && typeof schoolYear === 'object' ? schoolYear : null);
}

export function profilesFromPayload(payload) {
  const raw = payload?.profiles;
  const list = Array.isArray(raw) ? raw : Object.values(raw || {});
  return list.filter((profile) => profile && typeof profile === 'object');
}

function driverNames(profiles) {
  const names = new Map();
  for (const profile of profiles || []) {
    for (const assignment of routeAssignments(profile)) {
      const name = assignment.driver_name;
      const key = name.toLowerCase();
      if (!names.has(key)) names.set(key, name);
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// Matches for the search box. `by` is "driver" or "route".
export function searchHistory(profiles, { by, query } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  if (by === 'route') {
    return (profiles || [])
      .filter((profile) => routeLabel(profile).toLowerCase().includes(q))
      .sort((a, b) => compareRouteNumbers(a.name, b.name))
      .map((profile) => ({
        kind: 'route',
        key: routeLabel(profile),
        label: routeLabel(profile),
      }));
  }
  return driverNames(profiles)
    .filter((name) => name.toLowerCase().includes(q))
    .map((name) => ({ kind: 'driver', key: name, label: name }));
}

function viewCalendar() {
  const pack = getCalendarPack();
  return {
    ...pack.calendar,
    months: pack.months,
    source: pack.source,
    first_day: pack.first_day,
    last_day: pack.last_day,
  };
}

function heldLabel(assignment) {
  if (!assignment?.from) return '';
  if (!assignment.until) return `Since ${prettyDate(assignment.from)}`;
  return `${prettyDate(assignment.from)} – ${prettyDate(dayBefore(assignment.until))}`;
}

function historyBlock(snapshot) {
  const rows = snapshot?.schedule_history || [];
  const asOf = snapshot?.as_of || getAsOfDate();
  return `<div class="table-wrap">${scheduleHistoryTableHtml(snapshot)}</div>
    <h3>Calendar</h3>
    <ul class="history-legend">${historyLegendHtml(rows)}</ul>
    <div class="calendar-months">${calendarMonthsHtml({
      calendar: viewCalendar(),
      rows,
      asOf,
    })}</div>`;
}

function sectionsForDriver(profiles, driverName) {
  const name = String(driverName ?? '').trim();
  if (!name) return null;
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
  const asOf = getAsOfDate(pieces[0].profile);
  const sections = pieces.map((piece) => {
    const snapshotAsOf =
      piece.assignment.until && piece.assignment.until <= asOf
        ? dayBefore(piece.assignment.until)
        : asOf;
    return {
      routeName: routeLabel(piece.profile),
      assignment: piece.assignment,
      snapshot: buildSnapshot(piece.profile, snapshotAsOf || asOf),
    };
  });
  return { name, sections, asOf };
}

export function driverHistoryHtml(profiles, driverName) {
  const name = String(driverName ?? '').trim();
  const built = sectionsForDriver(profiles, name);
  if (!built) {
    return `<p class="empty">No route history is recorded for ${escapeHtml(name)}.</p>`;
  }
  const routes = [];
  for (const section of built.sections) {
    if (!routes.includes(section.routeName)) routes.push(section.routeName);
  }
  const listed = routes.join(', ');
  const lead =
    routes.length === 1
      ? `Route ${listed}, including each change while ${name} held it.`
      : `Routes ${listed}, including each change while ${name} held them.`;
  const body = built.sections
    .map((section) => {
      const held = heldLabel(section.assignment);
      return `<section class="history-route">
        <h2>Route ${escapeHtml(section.routeName)}</h2>
        ${held ? `<p class="lead">${escapeHtml(held)}</p>` : ''}
        ${historyBlock(section.snapshot)}
      </section>`;
    })
    .join('');
  return `<h2 class="person">${escapeHtml(name)}</h2><p class="lead">${escapeHtml(lead)}</p>${body}`;
}

export function routeHistoryHtml(profiles, routeName) {
  const wanted = String(routeName ?? '').trim().toLowerCase();
  const profile = (profiles || []).find((item) => routeLabel(item).toLowerCase() === wanted);
  if (!profile) {
    return `<p class="empty">No route history is recorded for ${escapeHtml(routeName)}.</p>`;
  }
  const label = routeLabel(profile);
  const holders = routeAssignments(profile)
    .map((assignment) => {
      const held = heldLabel(assignment);
      return held ? `${assignment.driver_name} (${held})` : assignment.driver_name;
    })
    .join('; ');
  const snapshot = buildSnapshot(profile, getAsOfDate(profile));
  return `<h2 class="person">Route ${escapeHtml(label)}</h2>
    <p class="lead">${holders ? escapeHtml(holders) : 'No driver is assigned.'}</p>
    ${historyBlock(snapshot)}`;
}
