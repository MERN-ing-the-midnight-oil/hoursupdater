// Suggested and accepted contract time changes for the office.
// Teamster countdown math still predicts becomes_on. Admin Accept writes
// force_contract_on on the change so those hours become legal contracted
// hours, and records a commitment to report them to Payroll.

import {
  formatClockAmPm,
  formatDurationLabel,
  splitSegmentRange,
} from '../../employee-tracker/src/clockTimes.js';
import { WINDOW_SCHOOL_DAYS } from '../../src/logic/constants.js';
import { snapContractTimeRange, toDateString } from '../../src/logic/timeUtils.js';
import { assignmentOnDate } from './assignments.js';
import { prettyDate, shortMonthDay } from './historyMarkup.js';

// Art. 3.08 reasons a route’s contracted hours change (and office overrides).
export const CONTRACT_CHANGE_REASONS = {
  pre_october_1_lock: {
    label: 'Pre-Oct 1 · < 30 minutes → contracts on October 1',
    citation: '3.08(a)(8)(c)',
  },
  pre_october_1_bid: {
    label: 'Pre-Oct 1 · +30+ minutes → bid after 15 school days',
    citation: '3.08(a)(8)(a)',
  },
  pre_october_1_bump: {
    label: 'Pre-Oct 1 · −30+ minutes → bump on determination',
    citation: '3.08(a)(8)(b)',
  },
  post_october_1_increase_lock: {
    label: 'Post-Oct 1 · < 30 minutes increase → contracts after 15 school days',
    citation: '3.08(b)(3)',
  },
  post_october_1_decrease_lock: {
    label: 'Post-Oct 1 · < 30 minutes decrease → contracts after 15 school days',
    citation: '3.08(b)(4)',
  },
  post_october_1_bid: {
    label: 'Post-Oct 1 · +30+ minutes → monthly bid (Oct–Apr)',
    citation: '3.08(b)(1)',
  },
  post_october_1_bump: {
    label: 'Post-Oct 1 · −30+ minutes → bump after 15 school days',
    citation: '3.08(b)(2)',
  },
  forced_october_1_contract: {
    label: 'Office override · contracts on October 1',
    citation: 'office override',
  },
  forced_contract_on: {
    label: 'Office recorded contracted hours',
    citation: 'office record',
  },
  arbitrary_set: {
    label: 'Admin set contracted times',
    citation: 'office set',
  },
  suggestion_edit: {
    label: 'Admin edited suggested change',
    citation: 'office edit',
  },
};

export function contractChangeReasonLabel(windowRule, fallback = '') {
  const rule = String(windowRule || '').trim();
  const entry = CONTRACT_CHANGE_REASONS[rule];
  if (entry) return entry.label;
  return String(fallback || '').trim();
}

// Long month + day for hover copy, e.g. "October 8".
export function longMonthDay(iso) {
  const day = toDateString(iso);
  if (!day) return '';
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });
}

// Plain-language how the Effective date was calculated.
export function effectiveDateHoverText({
  windowRule = '',
  changeDate = '',
  openedDate = '',
  becomesOn = '',
  source = '',
} = {}) {
  const rule = String(windowRule || '').trim();
  const start = longMonthDay(openedDate || changeDate);
  const effective = longMonthDay(becomesOn);
  const schoolDays = WINDOW_SCHOOL_DAYS;

  switch (rule) {
    case 'pre_october_1_lock':
      return start
        ? `October 1 after the change on ${start}`
        : 'October 1 lock for a pre–October 1 change under 30 minutes';
    case 'pre_october_1_bid':
      return start
        ? `${schoolDays} school days after ${start}`
        : `${schoolDays} school days after the change date`;
    case 'pre_october_1_bump':
      return start
        ? `On the determination date (${start})`
        : 'On the determination date (no 15-school-day wait)';
    case 'post_october_1_increase_lock':
    case 'post_october_1_decrease_lock':
      return start
        ? `${schoolDays} school days after ${start}, then the next school day`
        : `${schoolDays} school days after the change, then the next school day`;
    case 'post_october_1_bid':
      return start
        ? `${schoolDays} school days after ${start}, then the next Oct–Apr bid posting window`
        : `${schoolDays} school days after the change, then the next Oct–Apr bid posting window`;
    case 'post_october_1_bump':
      return start
        ? `${schoolDays} school days after ${start}`
        : `${schoolDays} school days after the change date`;
    case 'forced_october_1_contract':
      return 'Office override to contract on October 1';
    case 'forced_contract_on':
      return effective ? `Office-recorded effective date (${effective})` : 'Office-recorded effective date';
    case 'arbitrary_set':
      return effective ? `Admin set contracted times effective ${effective}` : 'Admin set contracted times';
    case 'suggestion_edit':
      return effective
        ? `Admin edited the suggested date to ${effective}`
        : 'Admin edited the suggested effective date';
    default:
      if (source === 'arbitrary_set' || source === 'suggestion_edit') {
        return effectiveDateHoverText({
          windowRule: source,
          changeDate,
          openedDate,
          becomesOn,
        });
      }
      if (start && schoolDays) return `${schoolDays} school days after ${start}`;
      if (effective) return `Effective ${effective}`;
      return shortMonthDay(becomesOn) ? `Effective ${shortMonthDay(becomesOn)}` : '';
  }
}

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

// When quarter-hour snapping is on, suggested Accept hours use the same
// office minute bands as contracted hours elsewhere in the dashboard.
export function snapSuggestionTimes(times, options = {}) {
  if (options.snapContractClocks !== true) {
    return {
      AM: rangeOrNull(times?.AM),
      MIDDAY: rangeOrNull(times?.MIDDAY),
      PM: rangeOrNull(times?.PM),
    };
  }
  const snapOne = (range) => {
    const text = rangeOrNull(range);
    if (!text) return null;
    try {
      return snapContractTimeRange(text, options.contractSnapBreaks);
    } catch {
      return text;
    }
  };
  return {
    AM: snapOne(times?.AM),
    MIDDAY: snapOne(times?.MIDDAY),
    PM: snapOne(times?.PM),
  };
}

export function timesLabel(times) {
  const parts = [];
  if (times?.AM) parts.push(`AM ${formatClockAmPm(times.AM)}`);
  if (times?.MIDDAY) parts.push(`Midday ${formatClockAmPm(times.MIDDAY)}`);
  if (times?.PM) parts.push(`PM ${formatClockAmPm(times.PM)}`);
  return parts.join(' · ') || 'No clock times';
}

function totalMinutesFromTimes(times) {
  let total = 0;
  for (const key of ['AM', 'MIDDAY', 'PM']) {
    const parts = splitSegmentRange(times?.[key]);
    if (parts) total += parts.duration_minutes;
  }
  return total;
}

// Compact queue cell: one run per line (AM / Mid / PM), then TOTAL HOURS.
export function timesStackHtml(times, escapeHtmlFn) {
  const escape =
    typeof escapeHtmlFn === 'function'
      ? escapeHtmlFn
      : (value) =>
          String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;');
  const lines = [];
  if (times?.AM) lines.push(`<span>AM ${escape(formatClockAmPm(times.AM))}</span>`);
  if (times?.MIDDAY) lines.push(`<span>Mid ${escape(formatClockAmPm(times.MIDDAY))}</span>`);
  if (times?.PM) lines.push(`<span>PM ${escape(formatClockAmPm(times.PM))}</span>`);
  if (!lines.length) return '<span class="contract-hours-stack">No clock times</span>';
  const total = totalMinutesFromTimes(times);
  lines.push(
    `<span class="contract-hours-total">TOTAL HOURS: ${escape(formatDurationLabel(total))}</span>`
  );
  return `<span class="contract-hours-stack">${lines.join('')}</span>`;
}

// One suggested Accept from a predicted history row.
export function suggestionFromHistoryRow({
  profile,
  row,
  driverName = '',
  awardedOn = '',
  asOf = '',
  acceptance = null,
  snapContractClocks = false,
  contractSnapBreaks,
  windowRule = '',
  openedDate = '',
} = {}) {
  if (row?.kind !== 'change' || row?.contracted?.status !== 'predicted') return null;
  const becomesOn = toDateString(row.contracted?.becomes_on);
  const changeId = String(row.change_id || '').trim();
  if (!changeId || !becomesOn) return null;
  const today = toDateString(asOf || new Date());
  const times = snapSuggestionTimes(scheduleTimes(row), {
    snapContractClocks,
    contractSnapBreaks,
  });
  const accepted = Boolean(acceptance);
  const overdue = !accepted && Boolean(today && becomesOn <= today);
  const rule =
    String(windowRule || '').trim() ||
    (row.force_oct1_contract ? 'forced_october_1_contract' : '') ||
    (acceptance?.source === 'arbitrary_set'
      ? 'arbitrary_set'
      : acceptance?.source === 'suggestion_edit'
        ? 'suggestion_edit'
        : acceptance
          ? 'forced_contract_on'
          : '');
  const changeDate = toDateString(row.date);
  const windowOpened = (String(openedDate || '').trim() ? toDateString(openedDate) : '') || changeDate;
  const reasonLabel =
    contractChangeReasonLabel(
      rule,
      row.contracted?.projected_outcome_label || row.contracted?.detail || ''
    ) ||
    String(row.contracted?.label || '').trim() ||
    'Teamster contract countdown';
  const effectiveHover = effectiveDateHoverText({
    windowRule: rule,
    changeDate,
    openedDate: windowOpened,
    becomesOn,
    source: acceptance?.source || '',
  });
  const rawAward =
    String(awardedOn || '').trim() ||
    assignmentOnDate(profile, changeDate || becomesOn)?.from ||
    '';
  const awardDate = rawAward ? toDateString(rawAward) : '';
  return {
    changeId,
    changeIds: Array.isArray(row.change_ids) && row.change_ids.length ? row.change_ids : [changeId],
    routeId: String(profile?.id || '').trim(),
    routeName: String(profile?.name || '').trim(),
    driverName: String(driverName || profile?.driver_name || '').trim() || 'Unassigned',
    awardedOn: awardDate,
    changeDate,
    openedDate: windowOpened,
    becomesOn,
    times,
    timesLabel: timesLabel(times),
    outcome: String(row.contracted?.projected_outcome || '').trim(),
    outcomeLabel: reasonLabel,
    reason: rule,
    reasonLabel,
    effectiveHover,
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

const TRIANGLE_SVG =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

export function contractTimeChangeMarkHtml(item) {
  if (!item?.routeName || !item?.becomesOn) return '';
  const accepted = Boolean(item.accepted);
  const overdue = Boolean(item.overdue);
  const state = accepted ? 'accepted' : overdue ? 'overdue' : 'pending';
  const title = calendarMarkTitle(item);
  return `<span class="contract-time-change-mark is-${state}" title="${escapeAttr(
    title
  )}" data-change-id="${escapeAttr(item.changeId)}"><span class="contract-time-change-tri" aria-hidden="true">${TRIANGLE_SVG}</span><span class="contract-time-change-route">${escapeHtml(
    item.routeName
  )}</span></span>`;
}

const KEY_TRI = `<span class="contract-time-change-tri" aria-hidden="true">${TRIANGLE_SVG}</span>`;

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
