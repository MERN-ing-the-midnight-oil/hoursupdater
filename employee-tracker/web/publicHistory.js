import { bidPostingSpanText } from '../src/clockHistory.js';
import { formatClockAmPm, localDateString } from '../src/clockTimes.js';
import { formatSignedMinutes } from '../src/snapshot.js';
import { dayBefore, routeAssignments, slicesForDriver } from '../../office-tracker/src/assignments.js';
import {
  calendarMonthsHtml,
  escapeHtml,
  historyLegendHtml,
  prettyDate,
  scheduleHistoryTableHtml,
  setHistoryDateLocale,
} from '../../office-tracker/src/historyMarkup.js';
import { dateLocaleFor, pageLang, translate } from './i18n.js';
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
  const lang = pageLang();
  const url = lang === 'pa' || lang === 'fa' ? `${PUBLISHED_SHARE_URL}?lang=${lang}` : PUBLISHED_SHARE_URL;
  if (lang === 'en') {
    return {
      text: `Teamster Tools\nBy Rhys- Get your real route change history, use an AI to scan your timecards, and more!\n${url}\nPassword: ${PAGE_PASSWORD}`,
    };
  }
  return { text: translate('share.text', { url, password: PAGE_PASSWORD }) };
}

function usePageDateLocale() {
  setHistoryDateLocale(dateLocaleFor(pageLang()));
}

function runLabel(run) {
  return run.id === 'MIDDAY' ? translate('run.midday') : run.label;
}

function historyCopy() {
  if (pageLang() === 'en') return null;
  return {
    started: translate('col.started'),
    amStart: translate('col.amStart'),
    amEnd: translate('col.amEnd'),
    midStart: translate('col.midStart'),
    midEnd: translate('col.midEnd'),
    pmStart: translate('col.pmStart'),
    pmEnd: translate('col.pmEnd'),
    change: translate('col.change'),
    hours: translate('col.hours'),
    contractDate: translate('col.contractDate'),
    empty: translate('col.empty'),
    diffTitle: translate('col.diffTitle'),
    bidNote: translate('legend.bidNote'),
    dows: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => translate(`dow.${day}`)),
    schoolDay: translate('cal.schoolDay'),
    today: translate('cal.today'),
    bidPeriod: translate('cal.bidPeriod'),
    off: translate('cal.off'),
    weekend: translate('cal.weekend'),
    outside: translate('cal.outside'),
    goesToBid: translate('cal.goesToBid'),
    pointsTo: translate('cal.pointsTo'),
    established: translate('cal.established'),
    schoolDayN: translate('cal.schoolDayN'),
    became: translate('cal.became'),
    postedBid: translate('cal.postedBid'),
    bump: translate('cal.bump'),
    resolution: translate('cal.resolution'),
    dateLocale: dateLocaleFor(),
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
  if (!assignment.until) return translate('held.since', { date: prettyDate(assignment.from) });
  return translate('held.range', {
    from: prettyDate(assignment.from),
    to: prettyDate(dayBefore(assignment.until)),
  });
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
    return range ? `${runLabel(run)} ${formatClockAmPm(range)}` : `${runLabel(run)} —`;
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
    return snapped ? `${runLabel(run)} ${formatClockAmPm(snapped)}` : `${runLabel(run)} —`;
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
      return range ? `${runLabel(run)} ${formatClockAmPm(range)}` : `${runLabel(run)} —`;
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

function sideSuffix(view) {
  if (pageLang() === 'en') return view?.side_window_note ? ` ${view.side_window_note}` : '';
  const sides = view?.side_windows;
  if (!Array.isArray(sides) || !sides.length) return '';
  return ` ${sides
    .map((side) => {
      const amount = formatSignedMinutes(side.drift_minutes);
      const when = side.becomes_on ? prettyDate(side.becomes_on) : translate('side.ownDate');
      const clock = String(side.rule ?? '').endsWith('_bid')
        ? translate('side.bidClock', { when })
        : translate('side.dayClock', { when });
      return translate('side.note', { amount, clock });
    })
    .join(' ')}`;
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
      sentence = translate('rules.bidOpen', { drift, dates });
    } else if (view.projected_outcome === 'BUMP_ELIGIBLE') {
      sentence = translate('rules.bumpOpen', { drift, date: prettyDate(view.becomes_contracted_on) });
    } else {
      sentence = translate('rules.hoursOpen', { drift, date: prettyDate(view.becomes_contracted_on) });
    }
    return `${sentence}${sideSuffix(view)}`;
  }
  const row = latestChange(snapshot);
  if (!row) return translate('rules.nothingWaiting');
  const on = row.contracted?.becomes_on;
  if (view.status === 'BID_PENDING') {
    const dates = bidDates(on, row.contracted?.bid_through);
    return dates ? translate('rules.bidClosedDates', { dates }) : translate('rules.bidClosed');
  }
  if (view.status === 'BUMP_ELIGIBLE') {
    return on ? translate('rules.bumpClosedDate', { date: prettyDate(on) }) : translate('rules.bumpClosed');
  }
  if (on) return translate('rules.hoursClosedDate', { date: prettyDate(on) });
  return translate('rules.hoursAre');
}

function snapNote(snapshot, comparedTo) {
  const lines = [];
  const snapped = snappedRunsLabel(snapshot?.schedule);
  if (snapped) lines.push(translate('snap.reads', { clocks: snapped }));
  const hoursNow = snapshot?.contracted?.label || '';
  const hoursWas = comparedTo?.contracted?.label || '';
  const nextNow = rulesNext(snapshot);
  const nextWas = rulesNext(comparedTo);
  if (hoursNow === hoursWas && nextNow === nextWas) {
    lines.push(snapped ? translate('snap.sameWithMove') : translate('snap.sameNoMove'));
  } else {
    if (hoursNow !== hoursWas && hoursWas && hoursNow) {
      lines.push(translate('snap.hours', { from: hoursWas, to: hoursNow }));
    }
    if (nextNow !== nextWas) {
      lines.push(translate('snap.compare', { written: nextWas, snap: nextNow }));
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
  const contractedFact = sameClocks ? translate('contracted.same') : contractedClocks;
  const open = snapshot?.window?.status === 'ACCUMULATING' && snapshot.window.expires_date;
  const hoursNote = open
    ? translate('hours.open')
    : sameClocks
      ? ''
      : translate('hours.rules');
  const contractedKicker = today || !asOf ? translate('contracted.today') : translate('contracted.asOf', { date: prettyDate(asOf) });
  const hoursLine = [hours, hoursNote].filter(Boolean).join('. ');
  const snapLine = snap && comparedTo ? snapNote(snapshot, comparedTo) : '';
  return `<div class="route-result">
    <p><span class="route-result-kicker">${escapeHtml(translate('clocks.now'))}</span> ${escapeHtml(clocks)}</p>
    ${started ? `<p class="route-result-when">${escapeHtml(translate('started', { date: prettyDate(started) }))}</p>` : ''}
    <p><span class="route-result-kicker">${escapeHtml(contractedKicker)}</span> ${escapeHtml(contractedFact)}</p>
    ${hoursLine ? `<p class="route-result-when">${escapeHtml(hoursLine.endsWith('.') ? hoursLine : `${hoursLine}.`)}</p>` : ''}
    <p><span class="route-result-kicker">${escapeHtml(translate('rules.next'))}</span> ${escapeHtml(rulesNext(snapshot))}</p>
    ${snapLine ? `<p class="route-result-snap">${escapeHtml(snapLine)}</p>` : ''}
  </div>`;
}

function historyBlock(snapshot, snapOptions) {
  const rows = snapshot?.schedule_history || [];
  const asOf = snapshot?.as_of || getAsOfDate();
  const copy = historyCopy();
  const tableOptions = copy ? { ...snapOptions, labels: copy } : snapOptions;
  return `<div class="table-wrap">${scheduleHistoryTableHtml(snapshot, undefined, tableOptions)}</div>
    <h3>${escapeHtml(translate('history.calendar'))}</h3>
    <ul class="history-legend">${historyLegendHtml(rows, undefined, copy)}</ul>
    <div class="calendar-months">${calendarMonthsHtml({
      calendar: viewCalendar(),
      rows,
      asOf,
      ...(copy ? { labels: copy } : {}),
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
  usePageDateLocale();
  const name = String(driverName ?? '').trim();
  const snap = options.snap === true;
  const built = sectionsForDriver(profiles, name, driverSnapOptions(snap));
  if (!built) {
    return `<p class="empty">${escapeHtml(translate('empty.driver', { name }))}</p>`;
  }
  const compared = snap ? sectionsForDriver(profiles, name, driverSnapOptions(false)) : null;
  const routes = [];
  for (const section of built.sections) {
    if (!routes.includes(section.routeName)) routes.push(section.routeName);
  }
  const listed = routes.join(', ');
  const lead =
    routes.length === 1
      ? translate('lead.one', { routes: listed, name })
      : translate('lead.many', { routes: listed, name });
  const body = built.sections
    .map((section, index) => {
      const held = heldLabel(section.assignment);
      return `<section class="history-route">
        <h2>${escapeHtml(translate('route.heading', { label: section.routeName }))}</h2>
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
  usePageDateLocale();
  const wanted = String(routeName ?? '').trim().toLowerCase();
  const profile = (profiles || []).find((item) => routeLabel(item).toLowerCase() === wanted);
  if (!profile) {
    return `<p class="empty">${escapeHtml(translate('empty.route', { route: routeName }))}</p>`;
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
  return `<h2 class="person">${escapeHtml(translate('route.heading', { label }))}</h2>
    <p class="lead">${holders ? escapeHtml(holders) : escapeHtml(translate('holders.none'))}</p>
    ${routeResultHtml(snapshot, { snap, comparedTo })}
    ${historyBlock(snapshot, driverSnapOptions(snap))}`;
}
