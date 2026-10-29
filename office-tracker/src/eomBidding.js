/**
 * End-of-month route bidding paper packets (Art. 3.08(b)(1) / (c)(1)).
 * Pure helpers for listing routes up for bid, ranking drivers, and printing
 * a cover sheet plus one sign-up sheet per route.
 */

import { formatDurationLabel } from '../../employee-tracker/src/clockTimes.js';
import {
  bidPeriodRanges,
  bidPostingSpan,
  bidPostingSpanText,
} from '../../employee-tracker/src/clockHistory.js';
import { formatSignedMinutes } from '../../employee-tracker/src/snapshot.js';
import { addSchoolDays, getSchoolDays } from '../../src/logic/calendar.js';
import {
  BID_RESPONSE_SCHOOL_DAYS,
  MONTHLY_BID_POSTING_MONTHS,
} from '../../src/logic/constants.js';
import { driversWithSeniorityNumbers } from '../../src/logic/seniority.js';
import { driverForDate, sameDriver } from './assignments.js';
import { isContractNoticeSent } from './contractNotice.js';
import { escapeHtml, prettyDate, scheduleRoundedMinutes } from './historyMarkup.js';

const POSTING_MONTH_SET = new Set(MONTHLY_BID_POSTING_MONTHS);

export const PAPER_BID_SHEET_DEFAULTS = {
  title: 'Open Bid Sign-Up Sheet',
  intro:
    'Drivers interested in this route should initial next to their name. Sign-up closes after two (2) school days — due {{bid_response_due_date}}. Failing to initial by that deadline is a rejection of the open position per Art. 3.08(c)(1).',
  footer:
    'Names in bold have more seniority than the current route holder. Initial in the box next to your name if you want to bid.',
};

export function monthKeyFromDate(iso) {
  const day = String(iso || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.slice(0, 7) : '';
}

export function isMonthlyBidPostingMonth(isoOrMonthKey) {
  const text = String(isoOrMonthKey || '');
  const monthPart = text.length >= 7 ? text.slice(5, 7) : text.slice(0, 2);
  const month = Number(monthPart);
  return POSTING_MONTH_SET.has(month);
}

export function postingPeriods(calendar) {
  return bidPeriodRanges(getSchoolDays(calendar));
}

export function periodForMonthKey(calendar, monthKey) {
  const key = String(monthKey || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(key)) return null;
  return postingPeriods(calendar).find((period) => period.start.startsWith(key)) || null;
}

/** Prefer the period containing `asOf`, else the next upcoming, else the latest past. */
export function defaultPostingMonthKey(calendar, asOf) {
  const day = String(asOf || '').slice(0, 10);
  const periods = postingPeriods(calendar);
  if (!periods.length) return '';
  const containing = periods.find((period) => day >= period.start && day <= period.end);
  if (containing) return monthKeyFromDate(containing.start);
  const upcoming = periods.find((period) => period.start >= day);
  if (upcoming) return monthKeyFromDate(upcoming.start);
  return monthKeyFromDate(periods[periods.length - 1].start);
}

export function signupDueDate(calendar, fromDate) {
  const start = String(fromDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return '';
  try {
    return addSchoolDays(calendar, start, BID_RESPONSE_SCHOOL_DAYS);
  } catch {
    return '';
  }
}

export function fillPaperBidTemplate(template, values = {}) {
  return String(template ?? '').replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = values[key];
    return value == null ? '' : String(value);
  });
}

function isBidRow(row) {
  const contracted = row?.contracted;
  if (!contracted) return false;
  return (
    contracted.projected_outcome === 'BID_PENDING' ||
    contracted.status === 'bid_pending'
  );
}

function changeIdsFor(row) {
  if (Array.isArray(row?.change_ids) && row.change_ids.length) {
    return row.change_ids.map(String);
  }
  return row?.change_id ? [String(row.change_id)] : [];
}

function reportChangeIds(report) {
  return (report?.contributing_changes || [])
    .map((change) => String(change?.id || ''))
    .filter(Boolean);
}

function bidNoticeSentIds(ids) {
  return (ids || []).some((id) => isContractNoticeSent(id));
}

function hoursLabel(minutes) {
  if (typeof minutes !== 'number' || Number.isNaN(minutes)) return '—';
  return formatDurationLabel(minutes);
}

function scheduleFromSegments(segments) {
  if (!segments || typeof segments !== 'object') return null;
  const schedule = {};
  for (const [id, range] of Object.entries(segments)) {
    const text = String(range || '').trim();
    if (text) schedule[id] = { range: text };
  }
  return Object.keys(schedule).length ? schedule : null;
}

function postingFields(schoolDays, calendar, becomesOn, period) {
  const span = bidPostingSpan(schoolDays, becomesOn);
  const postingStart = span?.start || becomesOn;
  return {
    becomesOn,
    postingStart,
    postingEnd: span?.end || period.end,
    postingWindowText: span ? bidPostingSpanText(span) : '',
    signupDue: signupDueDate(calendar, postingStart),
  };
}

function routePacketRow({
  profile,
  asOf,
  becomesOn,
  period,
  schoolDays,
  calendar,
  predicted,
  increaseLabel,
  previousHours,
  contractHours,
  contractedHoursLabel,
  changeIds,
}) {
  const posting = postingFields(schoolDays, calendar, becomesOn, period);
  const ids = (changeIds || []).map(String).filter(Boolean);
  return {
    routeId: String(profile?.id || ''),
    routeName: String(profile?.name || '').trim() || '—',
    driverName: driverForDate(profile, asOf || becomesOn) || String(profile?.driver_name || '').trim(),
    ...posting,
    predicted,
    status: predicted ? 'predicted' : 'posted',
    increaseLabel: increaseLabel || '—',
    previousHours: previousHours || '—',
    contractHours: contractHours || '—',
    contractedHoursLabel: contractedHoursLabel || contractHours || '—',
    bidNoticeSent: bidNoticeSentIds(ids),
    changeIds: ids,
    changeId: ids[0] || '',
  };
}

/**
 * Routes whose bid posting date falls in the selected month's last-five window.
 * Prefers finalized BID_PENDING reports (authoritative once the 15 school days
 * close), then predicted history / open-window rows. A later change must not
 * hide a bid that already finalized inside this month's posting window.
 */
export function routesUpForBid({ snapshots = [], calendar, monthKey, asOf }) {
  const period = periodForMonthKey(calendar, monthKey);
  if (!period) return [];
  const schoolDays = getSchoolDays(calendar);
  const out = [];
  const seen = new Set();

  function pushRow(row) {
    const key = `${row.routeName}|${row.becomesOn}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  }

  for (const item of snapshots) {
    const profile = item?.profile;
    const snap = item?.snap;
    const history = snap?.schedule_history || [];

    for (const report of snap?.reports || []) {
      if (report?.outcome !== 'BID_PENDING' || report?.separate_countdown) continue;
      const becomesOn = String(report.finalized_at || '').slice(0, 10);
      if (!becomesOn || becomesOn < period.start || becomesOn > period.end) continue;
      const beforeMinutes =
        report.see_the_math?.before?.payroll_rounded_total_minutes ??
        scheduleRoundedMinutes(scheduleFromSegments(report.before_segments));
      const afterMinutes =
        report.see_the_math?.after?.payroll_rounded_total_minutes ??
        scheduleRoundedMinutes(scheduleFromSegments(report.after_segments));
      pushRow(
        routePacketRow({
          profile,
          asOf,
          becomesOn,
          period,
          schoolDays,
          calendar,
          predicted: false,
          increaseLabel: formatSignedMinutes(report.contracted_hours_delta_minutes),
          previousHours: hoursLabel(beforeMinutes),
          contractHours: hoursLabel(afterMinutes),
          contractedHoursLabel: hoursLabel(afterMinutes),
          changeIds: reportChangeIds(report),
        })
      );
    }

    history.forEach((row, index) => {
      if (!isBidRow(row)) return;
      const becomesOn = String(row.contracted?.becomes_on || '').slice(0, 10);
      if (!becomesOn || becomesOn < period.start || becomesOn > period.end) return;
      const previous = history[index - 1];
      const previousMinutes = scheduleRoundedMinutes(previous?.schedule);
      const currentMinutes = scheduleRoundedMinutes(row.schedule);
      const predicted = row.contracted?.status === 'predicted';
      pushRow(
        routePacketRow({
          profile,
          asOf,
          becomesOn,
          period,
          schoolDays,
          calendar,
          predicted,
          increaseLabel:
            row.cumulative_drift_label ||
            formatSignedMinutes(row.cumulative_drift_minutes) ||
            '—',
          previousHours: hoursLabel(previousMinutes),
          contractHours: hoursLabel(currentMinutes),
          contractedHoursLabel: snap?.contracted?.label || hoursLabel(currentMinutes),
          changeIds: changeIdsFor(row),
        })
      );
    });

    const windowBidOn = String(snap?.window?.becomes_contracted_on || '').slice(0, 10);
    if (
      snap?.window?.projected_outcome === 'BID_PENDING' &&
      windowBidOn &&
      windowBidOn >= period.start &&
      windowBidOn <= period.end
    ) {
      pushRow(
        routePacketRow({
          profile,
          asOf,
          becomesOn: windowBidOn,
          period,
          schoolDays,
          calendar,
          predicted: true,
          increaseLabel: formatSignedMinutes(snap.window?.cumulative_drift_minutes),
          previousHours: hoursLabel(snap.contracted?.minutes),
          contractHours: '—',
          contractedHoursLabel: snap.contracted?.label || '—',
          changeIds: [],
        })
      );
    }
  }

  return out.sort((a, b) =>
    a.routeName.localeCompare(b.routeName, undefined, { numeric: true, sensitivity: 'base' })
  );
}

/**
 * Bids that already finalized before this month's window and are still open
 * (route status remains BID_PENDING). These often stay on the hall board
 * alongside the new end-of-month postings.
 */
export function routesStillOpenForBid({ snapshots = [], calendar, monthKey, asOf }) {
  const period = periodForMonthKey(calendar, monthKey);
  if (!period) return [];
  const schoolDays = getSchoolDays(calendar);
  const postingNames = new Set(
    routesUpForBid({ snapshots, calendar, monthKey, asOf }).map((route) => route.routeName)
  );
  const out = [];
  for (const item of snapshots) {
    const profile = item?.profile;
    const snap = item?.snap;
    const routeName = String(profile?.name || '').trim() || '—';
    if (postingNames.has(routeName)) continue;
    if (snap?.window?.status !== 'BID_PENDING') continue;

    const reports = (snap.reports || []).filter((report) => report?.outcome === 'BID_PENDING');
    const report = reports.sort((a, b) =>
      String(a.finalized_at || '').localeCompare(String(b.finalized_at || ''))
    ).at(-1);
    const historyRow = [...(snap.schedule_history || [])]
      .reverse()
      .find((row) => row?.contracted?.status === 'bid_pending');
    const becomesOn = String(
      report?.finalized_at || historyRow?.contracted?.becomes_on || ''
    ).slice(0, 10);
    if (!becomesOn || becomesOn >= period.start) continue;

    const beforeMinutes =
      report?.see_the_math?.before?.payroll_rounded_total_minutes ??
      scheduleRoundedMinutes(scheduleFromSegments(report?.before_segments));
    const afterMinutes =
      report?.see_the_math?.after?.payroll_rounded_total_minutes ??
      scheduleRoundedMinutes(historyRow?.schedule) ??
      scheduleRoundedMinutes(scheduleFromSegments(report?.after_segments));
    const changeIds = report ? reportChangeIds(report) : changeIdsFor(historyRow);
    out.push({
      ...routePacketRow({
        profile,
        asOf,
        becomesOn,
        period,
        schoolDays,
        calendar,
        predicted: false,
        increaseLabel:
          formatSignedMinutes(report?.contracted_hours_delta_minutes) ||
          historyRow?.cumulative_drift_label ||
          formatSignedMinutes(historyRow?.cumulative_drift_minutes) ||
          '—',
        previousHours: hoursLabel(beforeMinutes),
        contractHours: hoursLabel(afterMinutes),
        contractedHoursLabel: hoursLabel(afterMinutes),
        changeIds,
      }),
      carriedOver: true,
      label: `Still open from ${prettyDate(becomesOn)}`,
    });
  }
  return out.sort((a, b) =>
    a.becomesOn.localeCompare(b.becomesOn) ||
    a.routeName.localeCompare(b.routeName, undefined, { numeric: true, sensitivity: 'base' })
  );
}

/**
 * Routes still counting toward bid, or posted for a later month than selected.
 * Excludes routes that already appear on the selected month's posting list.
 */
export function routesApproachingBid({ snapshots = [], calendar, monthKey, asOf }) {
  const period = periodForMonthKey(calendar, monthKey);
  const postingNow = new Set(
    [
      ...routesUpForBid({ snapshots, calendar, monthKey, asOf }),
      ...routesStillOpenForBid({ snapshots, calendar, monthKey, asOf }),
    ].map((route) => `${route.routeName}|${route.becomesOn}`)
  );
  const openNames = new Set(
    [
      ...routesUpForBid({ snapshots, calendar, monthKey, asOf }),
      ...routesStillOpenForBid({ snapshots, calendar, monthKey, asOf }),
    ].map((route) => route.routeName)
  );
  const out = [];
  for (const item of snapshots) {
    const profile = item?.profile;
    const history = item?.snap?.schedule_history || [];
    for (const row of history) {
      if (!isBidRow(row)) continue;
      const becomesOn = String(row.contracted?.becomes_on || '').slice(0, 10);
      if (!becomesOn) continue;
      const routeName = String(profile?.name || '').trim() || '—';
      if (postingNow.has(`${routeName}|${becomesOn}`)) continue;
      // A still-open earlier bid on this route is not "approaching".
      if (openNames.has(routeName) && row.contracted?.status === 'bid_pending') continue;
      const predicted = row.contracted?.status === 'predicted';
      const laterMonth = period ? becomesOn > period.end : true;
      if (!predicted && !laterMonth) continue;
      out.push({
        routeName,
        driverName: driverForDate(profile, asOf || becomesOn) || String(profile?.driver_name || '').trim(),
        becomesOn,
        predicted,
        increaseLabel:
          row.cumulative_drift_label ||
          formatSignedMinutes(row.cumulative_drift_minutes) ||
          '—',
        label: row.contracted?.label || 'Approaching bid',
        bidNoticeSent: bidNoticeSentIds(changeIdsFor(row)),
      });
    }
  }
  const seen = new Set();
  return out
    .filter((row) => {
      const key = `${row.routeName}|${row.becomesOn}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.becomesOn.localeCompare(b.becomesOn) || a.routeName.localeCompare(b.routeName));
}

function rawDriverFields(state) {
  const byKey = new Map();
  for (const driver of state?.drivers || []) {
    const name = String(driver?.name || '').trim();
    const id = String(driver?.id || '').trim();
    const key = id || name.toLowerCase();
    if (!key) continue;
    byKey.set(key, driver);
    if (name) byKey.set(name.toLowerCase(), driver);
  }
  return byKey;
}

/**
 * Seniority-ordered drivers with their currently assigned route(s).
 * Uses hire_date / seniority_number from stored drivers when present.
 */
export function biddingDriverRoster({ state, listedDrivers = [], asOf }) {
  const raw = rawDriverFields(state);
  const people = [];
  const seen = new Set();
  for (const person of listedDrivers) {
    const name = String(person?.name || '').trim();
    if (!name) continue;
    const id = String(person?.id || '').trim() || name.toLowerCase();
    if (seen.has(id.toLowerCase()) || seen.has(name.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    seen.add(name.toLowerCase());
    const stored = raw.get(id) || raw.get(name.toLowerCase()) || {};
    people.push({
      driver_id: id,
      name,
      hire_date: stored.hire_date || person.hire_date || null,
      tie_break: stored.tie_break ?? person.tie_break ?? null,
      seniority_number: stored.seniority_number ?? person.seniority_number ?? null,
    });
  }

  const routesByDriver = new Map();
  for (const profile of Object.values(state?.profiles || {})) {
    const routeName = String(profile?.name || '').trim();
    if (!routeName) continue;
    const holder = String(driverForDate(profile, asOf) || profile?.driver_name || '').trim();
    if (!holder) continue;
    const key = holder.toLowerCase();
    const list = routesByDriver.get(key) || [];
    list.push(routeName);
    routesByDriver.set(key, list);
  }

  const hasSeniorityData = people.some(
    (person) => person.hire_date || person.seniority_number != null
  );
  let ranked;
  if (hasSeniorityData) {
    ranked = driversWithSeniorityNumbers(people).sort((a, b) => {
      const aRank = a.seniority_rank ?? Number.POSITIVE_INFINITY;
      const bRank = b.seniority_rank ?? Number.POSITIVE_INFINITY;
      if (aRank !== bRank) return aRank - bRank;
      return a.name.localeCompare(b.name);
    });
  } else {
    ranked = [...people]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((person, index) => ({
        ...person,
        seniority_rank: index + 1,
        missing_hire_date: true,
      }));
  }

  return {
    hasSeniorityData,
    drivers: ranked.map((person) => {
      const routes = routesByDriver.get(person.name.toLowerCase()) || [];
      routes.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      return {
        driverId: person.driver_id,
        name: person.name,
        seniorityRank: person.seniority_rank,
        missingHireDate: Boolean(person.missing_hire_date),
        currentRoutes: routes,
        currentRoutesLabel: routes.length ? routes.join(', ') : '—',
      };
    }),
  };
}

export function driverIsSeniorTo(holderName, driver, rosterDrivers) {
  if (!holderName || !driver) return false;
  const holder = rosterDrivers.find((row) => sameDriver(row.name, holderName));
  if (!holder || holder.seniorityRank == null || driver.seniorityRank == null) return false;
  return driver.seniorityRank < holder.seniorityRank;
}

function monthTitle(monthKey) {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return String(monthKey || '');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function initialCell() {
  return '<td class="bid-initial-cell"><span class="bid-initial-box" aria-hidden="true"></span></td>';
}

function driverRowsHtml(drivers, { holderName = '', forInterest = false, hasSeniorityData = false } = {}) {
  return drivers
    .map((driver) => {
      const senior =
        forInterest && hasSeniorityData && driverIsSeniorTo(holderName, driver, drivers);
      const nameClass = senior ? ' class="is-senior-bidder"' : '';
      const rank = driver.seniorityRank != null ? String(driver.seniorityRank) : '—';
      return `<tr>
        <td class="bid-rank">${escapeHtml(rank)}</td>
        <td${nameClass}>${escapeHtml(driver.name)}</td>
        <td>${escapeHtml(driver.currentRoutesLabel)}</td>
        ${initialCell()}
      </tr>`;
    })
    .join('');
}

function routeSummaryRowsHtml(routes) {
  if (!routes.length) {
    return `<tr><td colspan="6">No routes are posted for bid in this window.</td></tr>`;
  }
  return routes
    .map((route) => {
      const posting = route.carriedOver
        ? `Still open · ${prettyDate(route.becomesOn)}`
        : route.postingWindowText || prettyDate(route.becomesOn);
      return `<tr>
        <td>${escapeHtml(route.routeName)}</td>
        <td>${escapeHtml(route.driverName || '—')}</td>
        <td>${escapeHtml(route.previousHours)} → ${escapeHtml(route.contractHours)}</td>
        <td>${escapeHtml(route.increaseLabel)}</td>
        <td>${escapeHtml(posting)}</td>
        <td>${route.bidNoticeSent ? 'Sent' : 'Not sent'}</td>
      </tr>`;
    })
    .join('');
}

/**
 * Multi-page printable HTML: cover sheet, then one sheet per route.
 */
export function renderEomBiddingPacketHtml({
  monthKey,
  period,
  calendar,
  routes = [],
  stillOpen = [],
  roster,
  paperBidSheet = PAPER_BID_SHEET_DEFAULTS,
  asOf,
} = {}) {
  const title = `End of Month Bidding · ${monthTitle(monthKey)}`;
  const windowText = period
    ? `${prettyDate(period.start)}–${prettyDate(period.end)}`
    : '—';
  const packetRoutes = [...routes, ...stillOpen];
  let boardSignupDue = '';
  if (period?.end && calendar) {
    boardSignupDue = signupDueDate(calendar, period.end);
  }
  if (!boardSignupDue) {
    boardSignupDue =
      packetRoutes
        .map((route) => route.signupDue)
        .filter(Boolean)
        .sort()
        .at(-1) || '';
  }

  const sheet = { ...PAPER_BID_SHEET_DEFAULTS, ...paperBidSheet };
  const drivers = roster?.drivers || [];
  const hasSeniorityData = Boolean(roster?.hasSeniorityData);
  const stillOpenNote = stillOpen.length
    ? ` Includes ${stillOpen.length} earlier bid${stillOpen.length === 1 ? '' : 's'} still open.`
    : '';

  const cover = `<article class="bid-print-page bid-print-cover">
    <p class="bid-print-kicker">Teamsters Art. 3.08(b)(1) · last five school days, October–April</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="bid-print-lead">
      Posting window: <strong>${escapeHtml(windowText)}</strong>.
      Sign-up closes two (2) school days after posting — board due
      <strong>${escapeHtml(prettyDate(boardSignupDue) || '—')}</strong>
      (Art. 3.08(c)(1)). Printed ${escapeHtml(prettyDate(asOf) || asOf || '')}.${escapeHtml(stillOpenNote)}
    </p>
    <p class="bid-print-note">
      Per Art. 3.08, seniority fills vacant routes. A driver who successfully bids from one route
      to another may not bid back to their previous route when it is subsequently posted as a
      result of their successful bid. All resulting changes take effect on the same day.
    </p>
    <h2>Routes up for bid</h2>
    <table class="bid-print-table">
      <thead>
        <tr>
          <th scope="col">Route</th>
          <th scope="col">Incumbent</th>
          <th scope="col">Hours</th>
          <th scope="col">Increase</th>
          <th scope="col">Posting</th>
          <th scope="col">Written notice</th>
        </tr>
      </thead>
      <tbody>${routeSummaryRowsHtml(packetRoutes)}</tbody>
    </table>
    <h2>Driver acknowledgment</h2>
    <p class="bid-print-lead">
      Initial to confirm you have reviewed this month’s postings.
      ${
        hasSeniorityData
          ? 'Drivers are listed in seniority order (Art. 3.01).'
          : 'Drivers are listed alphabetically — add hire dates or seniority numbers on the driver record to print Art. 3.01 seniority order.'
      }
    </p>
    <table class="bid-print-table bid-driver-table">
      <thead>
        <tr>
          <th scope="col">${hasSeniorityData ? 'Sen.' : '#'}</th>
          <th scope="col">Driver</th>
          <th scope="col">Current route(s)</th>
          <th scope="col">Initial</th>
        </tr>
      </thead>
      <tbody>${driverRowsHtml(drivers, { hasSeniorityData })}</tbody>
    </table>
  </article>`;

  const routePages = packetRoutes
    .map((route) => {
      const intro = fillPaperBidTemplate(sheet.intro, {
        bid_response_due_date: prettyDate(route.signupDue) || route.signupDue || '—',
      });
      const footer = fillPaperBidTemplate(sheet.footer, {});
      const kicker = route.carriedOver
        ? `${sheet.title} · still open from earlier posting`
        : `${sheet.title} · Art. 3.08(b)(1)`;
      return `<article class="bid-print-page bid-print-route">
        <p class="bid-print-kicker">${escapeHtml(kicker)}</p>
        <h1>Route ${escapeHtml(route.routeName)}</h1>
        <dl class="bid-route-facts">
          <div><dt>Incumbent</dt><dd>${escapeHtml(route.driverName || '—')}</dd></div>
          <div><dt>Previous hours</dt><dd>${escapeHtml(route.previousHours)}</dd></div>
          <div><dt>New hours</dt><dd>${escapeHtml(route.contractHours)}</dd></div>
          <div><dt>Increase</dt><dd>${escapeHtml(route.increaseLabel)}</dd></div>
          <div><dt>Posting window</dt><dd>${escapeHtml(route.postingWindowText || windowText)}</dd></div>
          <div><dt>Sign-up due</dt><dd>${escapeHtml(prettyDate(route.signupDue) || '—')}</dd></div>
        </dl>
        <p class="bid-print-lead">${escapeHtml(intro)}</p>
        <p class="bid-print-note">
          Per Art. 3.08, a successful bidder may not bid back to their previous route when that
          route is subsequently posted because of their successful bid. All resulting changes
          take effect on the same day.
        </p>
        <table class="bid-print-table bid-driver-table">
          <thead>
            <tr>
              <th scope="col">${hasSeniorityData ? 'Sen.' : '#'}</th>
              <th scope="col">Driver</th>
              <th scope="col">Current route(s)</th>
              <th scope="col">Initial</th>
            </tr>
          </thead>
          <tbody>${driverRowsHtml(drivers, {
            holderName: route.driverName,
            forInterest: true,
            hasSeniorityData,
          })}</tbody>
        </table>
        <p class="bid-print-footer">${escapeHtml(footer)}</p>
      </article>`;
    })
    .join('');

  return `${cover}${routePages}`;
}

export function eomMonthOptions(calendar, asOf) {
  const periods = postingPeriods(calendar);
  const selected = defaultPostingMonthKey(calendar, asOf);
  return periods.map((period) => {
    const key = monthKeyFromDate(period.start);
    return {
      value: key,
      label: `${monthTitle(key)} (${prettyDate(period.start)}–${prettyDate(period.end)})`,
      selected: key === selected,
      period,
    };
  });
}

export function eomOutsidePostingSeasonMessage(asOf) {
  const day = String(asOf || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  if (isMonthlyBidPostingMonth(day)) return '';
  const month = Number(day.slice(5, 7));
  if (month >= 5 && month <= 6) {
    return 'Art. 3.08(b)(1) does not provide monthly bid reposting in May or June. You can still print a packet for an October–April window.';
  }
  if (month === 7 || month === 8 || month === 9) {
    return 'Art. 3.08(b)(1) monthly bid posting begins in October. Before October 1, use the pre–October 1 bid rules (Art. 3.08(a)(8)(a)). You can still prepare an October packet.';
  }
  return '';
}
