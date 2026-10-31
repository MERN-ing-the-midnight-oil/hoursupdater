// Suggested and accepted contract time changes for the office.
// Teamster countdown math still predicts becomes_on. Admin Accept writes
// force_contract_on on the change so those hours become legal contracted
// hours, and records a commitment to report them to Payroll.

import { formatClockAmPm } from '../../employee-tracker/src/clockTimes.js';
import { toDateString } from '../../src/logic/timeUtils.js';
import { prettyDate } from './historyMarkup.js';

export function normalizeContractAcceptance(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const changeId = String(source.changeId || source.id || '').trim();
  const routeId = String(source.routeId || '').trim();
  const effectiveDate = toDateString(source.effectiveDate || source.becomesOn || '');
  const times = normalizeTimes(source.times);
  if (!changeId || !routeId || !effectiveDate) return null;
  return {
    changeId,
    routeId,
    routeName: String(source.routeName || '').trim(),
    effectiveDate,
    times,
    acceptedBy: String(source.acceptedBy || '').trim(),
    acceptedAt: String(source.acceptedAt || '').trim() || new Date().toISOString(),
    reportedToPayroll: source.reportedToPayroll !== false,
    reportedToPayrollAt:
      String(source.reportedToPayrollAt || '').trim() ||
      (source.reportedToPayroll !== false ? new Date().toISOString() : null),
    note: String(source.note || '').trim(),
    source: String(source.source || 'suggestion').trim() || 'suggestion',
  };
}

export function contractAcceptanceMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const map = {};
  for (const [key, value] of Object.entries(raw)) {
    const record = normalizeContractAcceptance({
      ...(value && typeof value === 'object' ? value : {}),
      changeId: value?.changeId || key,
    });
    if (!record) continue;
    map[record.changeId] = record;
  }
  return map;
}

function normalizeTimes(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    AM: rangeOrNull(source.AM),
    MIDDAY: rangeOrNull(source.MIDDAY),
    PM: rangeOrNull(source.PM),
  };
}

function rangeOrNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function scheduleTimes(row) {
  const schedule = row?.schedule || {};
  return {
    AM: rangeOrNull(schedule.AM?.range ?? schedule.AM),
    MIDDAY: rangeOrNull(schedule.MIDDAY?.range ?? schedule.MIDDAY),
    PM: rangeOrNull(schedule.PM?.range ?? schedule.PM),
  };
}

function timesLabel(times) {
  const parts = [];
  if (times?.AM) parts.push(`AM ${formatClockAmPm(times.AM)}`);
  if (times?.MIDDAY) parts.push(`Midday ${formatClockAmPm(times.MIDDAY)}`);
  if (times?.PM) parts.push(`PM ${formatClockAmPm(times.PM)}`);
  return parts.join(' · ') || 'No clock times';
}

// One suggested Accept from a predicted history row.
export function suggestionFromHistoryRow({
  profile,
  row,
  driverName = '',
  asOf = '',
  acceptance = null,
} = {}) {
  if (row?.kind !== 'change' || row?.contracted?.status !== 'predicted') return null;
  const becomesOn = toDateString(row.contracted?.becomes_on);
  const changeId = String(row.change_id || '').trim();
  if (!changeId || !becomesOn) return null;
  const today = toDateString(asOf || new Date());
  const times = scheduleTimes(row);
  const accepted = Boolean(acceptance);
  const overdue = !accepted && Boolean(today && becomesOn <= today);
  return {
    changeId,
    changeIds: Array.isArray(row.change_ids) && row.change_ids.length ? row.change_ids : [changeId],
    routeId: String(profile?.id || '').trim(),
    routeName: String(profile?.name || '').trim(),
    driverName: String(driverName || profile?.driver_name || '').trim() || 'Unassigned',
    changeDate: toDateString(row.date),
    becomesOn,
    times,
    timesLabel: timesLabel(times),
    outcome: String(row.contracted?.projected_outcome || '').trim(),
    outcomeLabel: String(
      row.contracted?.projected_outcome_label || row.contracted?.label || ''
    ).trim(),
    accepted,
    overdue,
    acceptance: acceptance || null,
  };
}

export function compareSuggestions(a, b) {
  const overdueRank = Number(Boolean(b?.overdue)) - Number(Boolean(a?.overdue));
  if (overdueRank) return overdueRank;
  const day = String(a?.becomesOn || '').localeCompare(String(b?.becomesOn || ''));
  if (day) return day;
  return String(a?.routeName || '').localeCompare(String(b?.routeName || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

// Deep link into Contract time-changes for one suggested Accept.
export function contractAcceptUrl({ origin, changeId, pathname = './' } = {}) {
  const id = String(changeId || '').trim();
  if (!id) return '';
  const base = String(origin || '').replace(/\/$/, '');
  const path = String(pathname || './');
  const url = new URL(path, base.endsWith('/') ? base : `${base}/`);
  url.searchParams.set('sheet', 'contract-time-changes');
  url.searchParams.set('accept', id);
  return url.toString();
}

export function acceptLinkHint(url) {
  const href = String(url || '').trim();
  if (!href) return '';
  return `Accept in Teamster Time Changes (and report these hours to Bellingham Schools Payroll):\n${href}`;
}

export function calendarMarkTitle(item) {
  const route = item?.routeName || 'Route';
  const when = item?.becomesOn ? prettyDate(item.becomesOn) : '';
  const hours = item?.timesLabel || '';
  if (item?.accepted) {
    return [
      `Accepted contract time change for route ${route}`,
      when ? `Effective ${when}` : '',
      hours,
      'Report these hours to Bellingham Schools Payroll.',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (item?.overdue) {
    return [
      `Pending Accept — past due for route ${route}`,
      when ? `Suggested ${when}` : '',
      hours,
      'Accept to make these contracted hours legal and report them to Payroll.',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return [
    `Suggested contract time change for route ${route}`,
    when ? `Suggested ${when}` : '',
    hours,
    'Pending Accept.',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function contractTimeChangeMarkHtml(item, { iconHtml } = {}) {
  if (!item?.routeName || !item?.becomesOn) return '';
  const accepted = Boolean(item.accepted);
  const overdue = Boolean(item.overdue);
  const state = accepted ? 'accepted' : overdue ? 'overdue' : 'pending';
  const title = calendarMarkTitle(item);
  const icon =
    typeof iconHtml === 'function'
      ? iconHtml('alert-triangle')
      : '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
  return `<span class="contract-time-change-mark is-${state}" title="${escapeAttr(
    title
  )}" data-change-id="${escapeAttr(item.changeId)}"><span class="contract-time-change-tri" aria-hidden="true">${icon}</span><span class="contract-time-change-route">${escapeHtml(
    item.routeName
  )}</span></span>`;
}

const KEY_TRI = `<span class="contract-time-change-tri" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>`;

export function contractTimeChangeKeyHtml() {
  return `<div class="contract-time-change-key" role="list" aria-label="Contract time-change calendar key">
    <span class="contract-time-change-key-item" role="listitem" title="Outline triangle: Teamster rules suggest these contracted hours on that date. Accept on Contract time-changes to make them legal and report them to Payroll.">
      <span class="contract-time-change-mark is-pending" aria-hidden="true">${KEY_TRI}<span class="contract-time-change-route">#</span></span>
      Pending Accept
    </span>
    <span class="contract-time-change-key-item" role="listitem" title="Filled triangle: an admin Accepted these contracted hours and committed to report that date and hours to Bellingham Schools Payroll.">
      <span class="contract-time-change-mark is-accepted" aria-hidden="true">${KEY_TRI}<span class="contract-time-change-route">#</span></span>
      Accepted
    </span>
    <span class="contract-time-change-key-item" role="listitem" title="Past-due outline: the suggested date has passed and nobody has Accepted yet. Contracted hours have not changed for Payroll until Accept.">
      <span class="contract-time-change-mark is-overdue" aria-hidden="true">${KEY_TRI}<span class="contract-time-change-route">#</span></span>
      Past due
    </span>
  </div>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", '&#39;');
}
