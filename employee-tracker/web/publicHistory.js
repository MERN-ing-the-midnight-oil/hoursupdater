import { bidPostingSpanText } from '../src/clockHistory.js';
import { formatClockAmPm, localDateString } from '../src/clockTimes.js';
import { dayBefore, routeAssignments, slicesForDriver } from '../../office-tracker/src/assignments.js';
import {
  calendarMonthsHtml,
  escapeHtml,
  historyLegendHtml,
  prettyDate,
  scheduleHistoryTableHtml,
} from '../../office-tracker/src/historyMarkup.js';
import {
  buildPayrollRoundingBreakdown,
  DEFAULT_CONTRACT_SNAP_BREAKS,
} from '../../src/logic/timeUtils.js';
import { buildSnapshot, getAsOfDate, getCalendarPack, useSchoolYearCalendar } from './engine.js';

// Shared gate for the public page. The office function checks the same value.
export const PAGE_PASSWORD = '6111';

// The live page. Share this address by itself. The password stays in the message.
export const PUBLISHED_SHARE_URL = 'https://mern-ing-the-midnight-oil.github.io/hoursupdater/';

export function sharePayload() {
  // No title field: some phones prepend title onto text and would repeat "Teamster Tools".
  return {
    text: `Teamster Tools\nBy Rhys- Get your real route change history, use an AI to scan your timecards, and more!\n${PUBLISHED_SHARE_URL}\nPassword: ${PAGE_PASSWORD}`,
  };
}

export function shareMailHref() {
  const body = sharePayload().text;
  return `mailto:?subject=${encodeURIComponent('Teamster Tools')}&body=${encodeURIComponent(body)}`;
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

// Full driver or route list for the lookup menu. `by` is "driver" or "route".
export function historyOptions(profiles, { by } = {}) {
  if (by === 'route') {
    return (profiles || [])
      .map((profile) => ({
        kind: 'route',
        key: routeLabel(profile),
        label: routeLabel(profile),
      }))
      .sort((a, b) => compareRouteNumbers(a.label, b.label));
  }
  return driverNames(profiles).map((name) => ({ kind: 'driver', key: name, label: name }));
}

// Matches for typed filtering. `by` is "driver" or "route".
export function searchHistory(profiles, { by, query } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return historyOptions(profiles, { by }).filter((item) => item.label.toLowerCase().includes(q));
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

const RUNS = [
  { id: 'AM', label: 'AM' },
  { id: 'MIDDAY', label: 'Midday' },
  { id: 'PM', label: 'PM' },
];

// Driver page snap. Off uses the written clocks. On moves each clock onto the
// payroll bands and counts bid and bump from those hours. Accept stays out.
export function driverSnapOptions(enabled) {
  if (enabled !== true) {
    return { snapContractClocks: false, bidBumpUseSnappedTimes: false };
  }
  return {
    snapContractClocks: true,
    bidBumpUseSnappedTimes: true,
    contractSnapBreaks: { ...DEFAULT_CONTRACT_SNAP_BREAKS },
  };
}

function runRange(schedule, runId) {
  const item = schedule?.[runId];
  if (item?.range) return item.range;
  if (item?.clock_in && item?.clock_out) return `${item.clock_in}-${item.clock_out}`;
  return '';
}

function runsLabel(schedule) {
  return RUNS.map((run) => {
    const range = runRange(schedule, run.id);
    return range ? `${run.label} ${formatClockAmPm(range)}` : `${run.label} —`;
  }).join(' · ');
}

function snappedRunsLabel(schedule) {
  const segments = {};
  for (const run of RUNS) {
    const range = runRange(schedule, run.id);
    if (range) segments[run.id] = range;
  }
  const breakdown = buildPayrollRoundingBreakdown(segments, driverSnapOptions(true));
  const byId = new Map((breakdown.segments || []).map((segment) => [segment.segment, segment]));
  let moved = false;
  const label = RUNS.map((run) => {
    const item = byId.get(run.id);
    const written = item?.time || '';
    const snapped = item?.snapped_time || written;
    if (snapped && snapped !== written) moved = true;
    return snapped ? `${run.label} ${formatClockAmPm(snapped)}` : `${run.label} —`;
  }).join(' · ');
  return moved ? label : '';
}

function contractedRunsLabel(snapshot) {
  const open = snapshot?.window?.status === 'ACCUMULATING' && snapshot.window.expires_date;
  const before = open ? snapshot.window.see_the_math?.before?.segments : null;
  if (Array.isArray(before) && before.length) {
    const byId = new Map(before.map((segment) => [segment.segment, segment.time || '']));
    return RUNS.map((run) => {
      const range = byId.get(run.id) || '';
      return range ? `${run.label} ${formatClockAmPm(range)}` : `${run.label} —`;
    }).join(' · ');
  }
  return runsLabel(snapshot?.schedule);
}

function latestChange(snapshot) {
  const rows = snapshot?.schedule_history || [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index]?.kind === 'change') return rows[index];
  }
  return null;
}

function bidDates(start, end) {
  const text = bidPostingSpanText({ start, end });
  return text || (start ? prettyDate(start) : '');
}

// The date and the kind of result the open or closed count should produce.
function rulesNext(snapshot) {
  const view = snapshot?.window || {};
  const drift = view.cumulative_drift_label;
  const open = view.status === 'ACCUMULATING' && view.expires_date;
  if (open) {
    let sentence;
    if (view.projected_outcome === 'BID_PENDING') {
      const dates = bidDates(view.becomes_contracted_on, view.bid_through);
      sentence = `This change is ${drift}. If nothing else is logged, the route should go up for bid ${dates}.`;
    } else if (view.projected_outcome === 'BUMP_ELIGIBLE') {
      sentence = `This change is ${drift}. If nothing else is logged, the route should be bump-eligible on ${prettyDate(view.becomes_contracted_on)}.`;
    } else {
      sentence = `This change is ${drift}. If nothing else is logged, these hours should become the contracted hours on ${prettyDate(view.becomes_contracted_on)}.`;
    }
    return view.side_window_note ? `${sentence} ${view.side_window_note}` : sentence;
  }
  const row = latestChange(snapshot);
  if (!row) return 'Nothing is waiting on a count. These clock times are the contracted hours.';
  const on = row.contracted?.becomes_on;
  if (view.status === 'BID_PENDING') {
    const dates = bidDates(on, row.contracted?.bid_through);
    return dates
      ? `The count has closed. The route should be up for bid ${dates}.`
      : 'The count has closed. The route should be up for bid.';
  }
  if (view.status === 'BUMP_ELIGIBLE') {
    return on
      ? `The count has closed. The route should be bump-eligible as of ${prettyDate(on)}.`
      : 'The count has closed. The route should be bump-eligible.';
  }
  if (on) {
    return `The count has closed. These clock times should be the contracted hours as of ${prettyDate(on)}.`;
  }
  return 'These clock times are the contracted hours.';
}

function snapNote(snapshot, comparedTo) {
  const lines = [];
  const snapped = snappedRunsLabel(snapshot?.schedule);
  if (snapped) lines.push(`Snap reads the clock times as ${snapped}.`);
  const hoursNow = snapshot?.contracted?.label || '';
  const hoursWas = comparedTo?.contracted?.label || '';
  const nextNow = rulesNext(snapshot);
  const nextWas = rulesNext(comparedTo);
  if (hoursNow === hoursWas && nextNow === nextWas) {
    lines.push(
      snapped
        ? 'The contracted hours and what the rules say next stay the same.'
        : 'Snap leaves the clock times, the contracted hours, and what the rules say next the same.'
    );
  } else {
    if (hoursNow !== hoursWas && hoursWas && hoursNow) {
      lines.push(`Snap moves the contracted hours from ${hoursWas} to ${hoursNow}.`);
    }
    if (nextNow !== nextWas) {
      lines.push(`Written clock times: ${nextWas} Snap clock times: ${nextNow}`);
    }
  }
  return lines.join(' ');
}

// Plain result for one route: clocks now, hours the rules call contracted, and
// the date those new hours should become the contract, go up for bid, or be bump-eligible.
export function routeResultHtml(snapshot, { snap = false, comparedTo = null } = {}) {
  if (!snapshot?.schedule && !(snapshot?.schedule_history || []).length) return '';
  const asOf = String(snapshot?.as_of || '').slice(0, 10);
  const today = asOf && asOf === localDateString();
  const clocks = runsLabel(snapshot?.schedule);
  const contractedClocks = contractedRunsLabel(snapshot);
  const started = snapshot?.schedule_history?.at(-1)?.date || snapshot?.employee?.start_date;
  const hours = snapshot?.contracted?.label || '';
  const sameClocks = contractedClocks === clocks;
  const contractedFact = sameClocks ? 'The same clocks.' : contractedClocks;
  const open = snapshot?.window?.status === 'ACCUMULATING' && snapshot.window.expires_date;
  const hoursNote = open
    ? 'These stay the contracted hours while this count is open.'
    : sameClocks
      ? ''
      : 'These are the hours the rules call contracted.';
  const contractedKicker = today || !asOf ? 'Contracted today' : `Contracted as of ${prettyDate(asOf)}`;
  const hoursLine = [hours, hoursNote].filter(Boolean).join('. ');
  const snapLine = snap && comparedTo ? snapNote(snapshot, comparedTo) : '';
  return `<div class="route-result">
    <p><span class="route-result-kicker">Clock times now</span> ${escapeHtml(clocks)}</p>
    ${started ? `<p class="route-result-when">Started ${escapeHtml(prettyDate(started))}.</p>` : ''}
    <p><span class="route-result-kicker">${escapeHtml(contractedKicker)}</span> ${escapeHtml(contractedFact)}</p>
    ${hoursLine ? `<p class="route-result-when">${escapeHtml(hoursLine.endsWith('.') ? hoursLine : `${hoursLine}.`)}</p>` : ''}
    <p><span class="route-result-kicker">What the rules say next</span> ${escapeHtml(rulesNext(snapshot))}</p>
    ${snapLine ? `<p class="route-result-snap">${escapeHtml(snapLine)}</p>` : ''}
  </div>`;
}

function historyBlock(snapshot, snapOptions) {
  const rows = snapshot?.schedule_history || [];
  const asOf = snapshot?.as_of || getAsOfDate();
  return `<div class="table-wrap">${scheduleHistoryTableHtml(snapshot, undefined, snapOptions)}</div>
    <h3>Calendar</h3>
    <ul class="history-legend">${historyLegendHtml(rows)}</ul>
    <div class="calendar-months">${calendarMonthsHtml({
      calendar: viewCalendar(),
      rows,
      asOf,
    })}</div>`;
}

function sectionsForDriver(profiles, driverName, snapOptions) {
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
      snapshot: buildSnapshot(piece.profile, snapshotAsOf || asOf, snapOptions),
    };
  });
  return { name, sections, asOf };
}

export function driverHistoryHtml(profiles, driverName, options = {}) {
  const name = String(driverName ?? '').trim();
  const snap = options.snap === true;
  const built = sectionsForDriver(profiles, name, driverSnapOptions(snap));
  if (!built) {
    return `<p class="empty">No route history is recorded for ${escapeHtml(name)}.</p>`;
  }
  const compared = snap ? sectionsForDriver(profiles, name, driverSnapOptions(false)) : null;
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
    .map((section, index) => {
      const held = heldLabel(section.assignment);
      return `<section class="history-route">
        <h2>Route ${escapeHtml(section.routeName)}</h2>
        ${held ? `<p class="lead">${escapeHtml(held)}</p>` : ''}
        ${routeResultHtml(section.snapshot, {
          snap,
          comparedTo: compared?.sections[index]?.snapshot || null,
        })}
        ${historyBlock(section.snapshot, driverSnapOptions(snap))}
      </section>`;
    })
    .join('');
  return `<h2 class="person">${escapeHtml(name)}</h2><p class="lead">${escapeHtml(lead)}</p>${body}`;
}

export function routeHistoryHtml(profiles, routeName, options = {}) {
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
  const snap = options.snap === true;
  const asOf = getAsOfDate(profile);
  const snapshot = buildSnapshot(profile, asOf, driverSnapOptions(snap));
  const comparedTo = snap ? buildSnapshot(profile, asOf, driverSnapOptions(false)) : null;
  return `<h2 class="person">Route ${escapeHtml(label)}</h2>
    <p class="lead">${holders ? escapeHtml(holders) : 'No driver is assigned.'}</p>
    ${routeResultHtml(snapshot, { snap, comparedTo })}
    ${historyBlock(snapshot, driverSnapOptions(snap))}`;
}
