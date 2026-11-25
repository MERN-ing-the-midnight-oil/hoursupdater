import { bidPeriodRanges, bidPostingSpan, bidPostingSpanText } from '../src/clockHistory.js';
import { formatSignedMinutes } from '../src/snapshot.js';
import { driverForDate } from '../../office-tracker/src/assignments.js';
import { escapeHtml, prettyDate } from '../../office-tracker/src/historyMarkup.js';
import { getSchoolDays } from '../../src/logic/calendar.js';
import { buildSnapshot, getAsOfDate, getCalendarPack } from './engine.js';
import { dateLocaleFor, translate } from './i18n.js';
import { driverSnapOptions } from './publicHistory.js';

const LIVE_STATUS = new Set(['predicted', 'bid_pending', 'bump_eligible']);

// The end-of-month window drivers are looking toward: the one that contains
// today, or the next one. A finished window gives way to the next month.
export function comingSoonPeriod(calendar, asOf) {
  const day = String(asOf || '').slice(0, 10);
  const periods = bidPeriodRanges(getSchoolDays(calendar));
  if (!periods.length) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return periods[0];
  const containing = periods.find((period) => day >= period.start && day <= period.end);
  if (containing) return containing;
  return periods.find((period) => period.start > day) || null;
}

function rowKind(row) {
  const contracted = row?.contracted || {};
  if (contracted.projected_outcome === 'BID_PENDING' || contracted.status === 'bid_pending') {
    return 'bid';
  }
  if (contracted.projected_outcome === 'BUMP_ELIGIBLE' || contracted.status === 'bump_eligible') {
    return 'bump';
  }
  return '';
}

function becomesOn(row) {
  return String(row?.contracted?.becomes_on || '').slice(0, 10);
}

function targetsPeriod(row, period) {
  const on = becomesOn(row);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return false;
  const kind = rowKind(row);
  if (kind === 'bid') return on >= period.start && on <= period.end;
  if (kind === 'bump') return on.slice(0, 7) === period.start.slice(0, 7);
  return false;
}

function isLive(row) {
  return LIVE_STATUS.has(row?.contracted?.status);
}

function driftLabel(row) {
  if (row?.cumulative_drift_label) return row.cumulative_drift_label;
  return formatSignedMinutes(row?.cumulative_drift_minutes);
}

function postingDates(row, schoolDays) {
  const on = becomesOn(row);
  if (rowKind(row) === 'bid') {
    const span = bidPostingSpan(schoolDays, on);
    return span ? bidPostingSpanText(span) : prettyDate(on);
  }
  return prettyDate(on);
}

function monthLabel(period) {
  return new Date(`${period.start}T12:00:00`).toLocaleDateString(dateLocaleFor(), {
    month: 'long',
    year: 'numeric',
    calendar: 'gregory',
    numberingSystem: 'latn',
  });
}

function compareRouteNames(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function announcementFromRow(profile, row, kind, status, schoolDays, asOf) {
  const on = becomesOn(row);
  return {
    routeName: String(profile?.name || '').trim() || 'Route',
    driverName: driverForDate(profile, asOf) || String(profile?.driver_name || '').trim(),
    kind,
    status,
    drift: driftLabel(row),
    dates: postingDates(row, schoolDays),
    when: on,
    changedOn: String(row?.date || '').slice(0, 10),
  };
}

function changeDates(profile, asOf) {
  const dates = [];
  for (const change of profile?.changeLog || []) {
    const date = String(change?.effective_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > asOf) continue;
    if (change.delta_minutes === 0 && change.previous_time === change.new_time) continue;
    if (!dates.includes(date)) dates.push(date);
  }
  dates.sort();
  return dates;
}

// Later changes stay in the saved log. A past day has to be read without them,
// or a bid that was later replaced never shows up as a bid.
function profileThrough(profile, date) {
  return {
    ...profile,
    changeLog: (profile?.changeLog || []).filter((change) => {
      const day = String(change?.effective_date || '').slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= date;
    }),
  };
}

function liveByKind(snapshot, period) {
  const found = {};
  for (const row of snapshot?.schedule_history || []) {
    if (!targetsPeriod(row, period) || !isLive(row)) continue;
    const kind = rowKind(row);
    const previous = found[kind];
    if (!previous || becomesOn(row) < becomesOn(previous)) found[kind] = row;
  }
  return found;
}

// A replaced bid or bump loses its predicted date on the latest snapshot.
// Look back at each logged change so a route that fell off still has a status.
function announcementsForRoute(profile, period, schoolDays, asOf) {
  const snapOptions = driverSnapOptions(false);
  const last = { bid: null, bump: null };
  for (const date of changeDates(profile, asOf)) {
    const live = liveByKind(buildSnapshot(profileThrough(profile, date), date, snapOptions), period);
    for (const kind of ['bid', 'bump']) {
      if (live[kind]) last[kind] = live[kind];
    }
  }
  const current = liveByKind(buildSnapshot(profileThrough(profile, asOf), asOf, snapOptions), period);
  const items = [];
  for (const kind of ['bid', 'bump']) {
    if (current[kind]) {
      const status = current[kind].contracted?.status === 'predicted' ? 'likely' : 'eligible';
      items.push(announcementFromRow(profile, current[kind], kind, status, schoolDays, asOf));
    } else if (last[kind]) {
      items.push(announcementFromRow(profile, last[kind], kind, 'no_longer', schoolDays, asOf));
    }
  }
  return items;
}

const STATUS_ORDER = { likely: 0, eligible: 1, no_longer: 2 };

export function comingSoonAnnouncements(profiles, { asOf, calendar } = {}) {
  const cal = calendar || getCalendarPack().calendar;
  const day = String(asOf || getAsOfDate() || '').slice(0, 10);
  const period = comingSoonPeriod(cal, day);
  if (!period) return { period: null, month: '', window: '', items: [] };
  const schoolDays = getSchoolDays(cal);
  const items = [];
  for (const profile of profiles || []) {
    if (!profile || typeof profile !== 'object') continue;
    items.push(...announcementsForRoute(profile, period, schoolDays, day));
  }
  items.sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      String(a.when).localeCompare(String(b.when)) ||
      compareRouteNames(a.routeName, b.routeName)
  );
  return {
    period,
    month: monthLabel(period),
    window: bidPostingSpanText(period),
    items,
  };
}

function statusLabel(item) {
  if (item.status === 'no_longer') return translate('coming.noLonger');
  if (item.status === 'eligible') {
    return translate(item.kind === 'bump' ? 'coming.eligibleBump' : 'coming.eligibleBid');
  }
  return translate(item.kind === 'bump' ? 'coming.likelyBump' : 'coming.likelyBid');
}

function detailText(item, month) {
  if (item.status === 'no_longer') {
    return translate('coming.dropped', {
      kind: translate(item.kind === 'bump' ? 'coming.kindBump' : 'coming.kindBid'),
      month,
    });
  }
  if (item.status === 'eligible') {
    return translate(item.kind === 'bump' ? 'coming.bumpNow' : 'coming.bidNow', {
      dates: item.dates,
      date: item.dates,
    });
  }
  return translate(item.kind === 'bump' ? 'coming.bumpOpen' : 'coming.bidOpen', {
    drift: item.drift,
    dates: item.dates,
    date: item.dates,
  });
}

export function comingSoonHtml(profiles, options = {}) {
  const built = comingSoonAnnouncements(profiles, options);
  if (!built.period) {
    return `<p class="lead">${escapeHtml(translate('coming.noneSeason'))}</p>`;
  }
  const cards = built.items.length
    ? built.items
        .map((item) => {
          const driver = item.driverName
            ? `<p class="coming-driver">${escapeHtml(item.driverName)}</p>`
            : '';
          return `<article class="coming-card is-${escapeHtml(item.status)}">
            <p class="coming-kicker">${escapeHtml(statusLabel(item))}</p>
            <h2>${escapeHtml(translate('coming.route', { label: item.routeName }))}</h2>
            ${driver}
            <p>${escapeHtml(detailText(item, built.month))}</p>
          </article>`;
        })
        .join('')
    : `<p class="empty">${escapeHtml(translate('coming.empty'))}</p>`;
  return `<p class="lead">${escapeHtml(translate('coming.lead'))}</p>
    <h2 class="coming-month">${escapeHtml(translate('coming.period', { month: built.month }))}</h2>
    <p class="hint">${escapeHtml(translate('coming.window', { dates: built.window }))}</p>
    <div class="coming-list">${cards}</div>`;
}
