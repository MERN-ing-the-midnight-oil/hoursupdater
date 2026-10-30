// Contract time-change notices. The clock-time notice is a separate email.
// Art. 3.08 requires a written determination in three cases: a 30-minute
// increase that goes up for bid, a 30-minute decrease that opens a bump,
// and, after October 1, a smaller decrease with no bump. A fourth letter
// covers a smaller increase after October 1; the contract does not require it.

import { bidPostingSpan, bidPostingSpanText } from '../../employee-tracker/src/clockHistory.js';
import { formatDurationLabel } from '../../employee-tracker/src/clockTimes.js';
import { getSchoolDays, previousCalendarDate } from '../../src/logic/calendar.js';
import { contractWindowPlan, isPreOctober1ReviewPeriod } from '../../src/logic/contractWindows.js';
import { contractCitations } from '../../public/shared/contractCitations.js';
import { prettyDate, scheduleRoundedMinutes } from './historyMarkup.js';
import { fillNoticeTemplate, forgetNoticeSent, loadNoticeSentRecords, rememberNoticeSent } from './noticeMail.js';

export const CONTRACT_NOTICE_SENT_KEY = 'transportation-timechange.contract-notice-sent.v1';

const QUARTER_HOUR_LINE =
  'Contracted hours are rounded to the nearest quarter hour (each run, then the daily total). A change that is not itself a quarter hour—such as 20 minutes—still counts in exact minutes toward the 15- and 30-minute contract rules until those hours lock in.';

const BID_BODY = `Written determination of a route increase

TO: {{driver_name}}
ROUTE: {{route_name}}
DATE: {{date}}

This is a written determination that route {{route_name}} has increased, and notice that the route will go up for bid.

Your contracted hours has changed from {{previous_hours}} to {{contract_hours}} ({{change_amount}}).

${QUARTER_HOUR_LINE}

This is an increase of 30 minutes or more. You are receiving a written determination of the increase and notice that the route will go up for bid.

{{timing}}

Please "REPLY ALL" to this notice and write "Received" in the subject line.

{{citation_label}}
{{citation_text}}
`;

const BUMP_BODY = `Written determination of a route decrease

TO: {{driver_name}}
ROUTE: {{route_name}}
DATE: {{date}}

This is a written determination that route {{route_name}} has decreased.

Your contracted hours has changed from {{previous_hours}} to {{contract_hours}} ({{change_amount}}).

${QUARTER_HOUR_LINE}

This is a decrease of 30 minutes or more. You are receiving a written determination of the decrease and notice that you may bump a less-senior driver or retain this route.

You have two school days from this notification to use your seniority to bump a driver with less seniority, or to retain this route.

Please "REPLY ALL" to this notice with "Retain" or "Bump" in the subject line.

{{timing}}

{{citation_label}}
{{citation_text}}
`;

const DECREASE_BODY = `Written determination of a route decrease

TO: {{driver_name}}
ROUTE: {{route_name}}
DATE: {{date}}

This is a written determination that route {{route_name}} has decreased. The decrease is under 30 minutes, so you do not have the option to bump.

Your contracted hours has changed from {{previous_hours}} to {{contract_hours}} ({{change_amount}}).

${QUARTER_HOUR_LINE}

This is a decrease under 30 minutes. You are receiving a written determination of the decrease and do not have the option to bump. The new hours take effect the workday after this notice.

{{timing}}

Please "REPLY ALL" to this notice and write "Received" in the subject line.

{{citation_label}}
{{citation_text}}
`;

const INCREASE_BODY = `Notice of a route hours increase

TO: {{driver_name}}
ROUTE: {{route_name}}
DATE: {{date}}

This is notice that route {{route_name}} has increased. The increase is under 30 minutes, so the route does not go up for bid.

Your contracted hours has changed from {{previous_hours}} to {{contract_hours}} ({{change_amount}}).

${QUARTER_HOUR_LINE}

This is an increase under 30 minutes. The new hours take effect under Art. 3.08(b)(3).

{{timing}}

Please "REPLY ALL" to this notice and write "Received" in the subject line.

{{citation_label}}
{{citation_text}}
`;

// One editable template per notice kind. `citations` are the articles quoted on
// the settings page. The email quotes the article for that change.
export const CONTRACT_NOTICE_KINDS = [
  {
    id: 'bid',
    icon: 'bid',
    label: 'Up for bid',
    required: true,
    rationale:
      'The contract requires this letter when a route has increased by 30 minutes or more for 15 school days. It tells the driver the route increased and that it will go up for bid. Before October 1, Art. 3.08(a)(8)(a) counts those 15 school days from the initial bid. After October 1, Art. 3.08(b)(1) posts the route during the last five school days of each month from October through April.',
    generated:
      'Letters appear here the day they are due to be sent. Please check for letters here daily. Before October 1, Art. 3.08(a)(8)(a), that is after the increase has lasted 15 school days from the initial bid. After October 1, Art. 3.08(b)(1), that is during the last five school days of the month, from October through April, once the increase has lasted 15 school days or more.',
    detail:
      'This is an increase of 30 minutes or more. You are receiving a written determination of the increase and notice that the route will go up for bid.',
    citations: ['3.08(a)(8)(a)', '3.08(b)(1)'],
    subject: '{{driver_name}}: Route {{route_name}} increase — the route will go up for bid',
    body: BID_BODY,
  },
  {
    id: 'bump',
    icon: 'bump',
    label: 'Eligible to bump',
    required: true,
    rationale:
      'The contract requires this letter when a route has decreased by 30 minutes or more. From the day the driver receives it, there are two school days to bump a less-senior driver or keep the route. Before October 1, Art. 3.08(a)(8)(b) does not wait through 15 school days. After October 1, Art. 3.08(b)(2) requires the decrease to have lasted 15 school days.',
    generated:
      'Letters appear here the day they are due to be sent. Please check for letters here daily. Before October 1, Art. 3.08(a)(8)(b), that is the day the route is down 30 minutes or more. It does not wait through 15 school days, and the two school days start when the driver receives the letter. After October 1, Art. 3.08(b)(2), that is after the decrease has lasted 15 school days.',
    detail:
      'This is a decrease of 30 minutes or more. You are receiving a written determination of the decrease and notice that you may bump a less-senior driver or retain this route.',
    citations: ['3.08(a)(8)(b)', '3.08(b)(2)'],
    subject: '{{driver_name}}: Written determination of a decrease on route {{route_name}}',
    body: BUMP_BODY,
  },
  {
    id: 'decrease',
    icon: 'decrease',
    label: 'Hours decrease, no bump',
    required: true,
    rationale:
      'The contract requires this letter after October 1 when a route has decreased by 15 minutes and the decrease stays under 30 minutes. Art. 3.08(b)(4) does not give a bump. The new hours take effect the workday after this written notice.',
    generated:
      'Letters appear here the day they are due to be sent. Please check for letters here daily. After October 1, Art. 3.08(b)(4), that is the workday before the new hours take effect, once the decrease is determined. The new contract time is effective the workday after this written notice. A decrease that takes effect on October 1 does not generate this letter.',
    detail:
      'This is a decrease under 30 minutes. You are receiving a written determination of the decrease and do not have the option to bump. The new hours take effect the workday after this notice.',
    citations: ['3.08(b)(4)'],
    subject: '{{driver_name}}: Written determination of a decrease on route {{route_name}}',
    body: DECREASE_BODY,
  },
  {
    id: 'increase',
    icon: 'increase',
    label: 'Hours increase (optional courtesy)',
    required: false,
    rationale:
      'The Teamsters contract does not require this letter. Art. 3.08(b)(3) locks in a smaller increase after it has lasted 15 school days, but it does not call for a written determination. This optional courtesy notice tells the driver the new contracted hours. You do not have to send it.',
    generated:
      'Letters appear here the day they are due to be sent. Please check for letters here daily. After October 1, Art. 3.08(b)(3), that is the day the new hours take effect, once the increase has lasted 15 school days. Sending this letter is optional. An increase that takes effect on October 1 does not generate this letter.',
    detail:
      'This is an increase under 30 minutes. The new hours take effect under Art. 3.08(b)(3). The Teamsters contract does not require this notice.',
    citations: ['3.08(b)(3)'],
    subject: '{{driver_name}}: Hours increase on route {{route_name}}',
    body: INCREASE_BODY,
  },
];

function emailOrBlank(value) {
  const email = String(value ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export function contractNoticeKindById(id) {
  const key = String(id ?? '').trim();
  return CONTRACT_NOTICE_KINDS.find((item) => item.id === key) || CONTRACT_NOTICE_KINDS[0];
}

export function normalizeContractTemplates(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const templates = {};
  for (const kind of CONTRACT_NOTICE_KINDS) {
    const saved = source[kind.id];
    if (!saved || typeof saved !== 'object') continue;
    const subject = String(saved.subject ?? '').trim();
    const body = String(saved.body ?? '').trim();
    const usualSubject = kind.subject.trim();
    const usualBody = kind.body.trim();
    const nextSubject = subject || usualSubject;
    const nextBody = body || usualBody;
    if (nextSubject === usualSubject && nextBody === usualBody) continue;
    templates[kind.id] = { subject: nextSubject, body: nextBody };
  }
  return templates;
}

export function contractNoticeTemplate(id, templates) {
  const kind = contractNoticeKindById(id);
  const saved = normalizeContractTemplates(templates)[kind.id];
  return {
    ...kind,
    subject: saved?.subject || kind.subject,
    body: saved?.body || kind.body,
  };
}

export function normalizeContractNotice(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    secretaryCc: emailOrBlank(source.secretaryCc),
    templates: normalizeContractTemplates(source.templates),
  };
}

function hoursLabel(minutes) {
  if (typeof minutes !== 'number') return 'not recorded';
  return formatDurationLabel(minutes);
}

// Smaller under-30 notices only after October 1 (Arts. 3.08(b)(3) and (b)(4)).
function isPostOctober1SmallerNotice(row) {
  const date = row?.date;
  return Boolean(date) && !isPreOctober1ReviewPeriod(date);
}

function noticeKind(row) {
  const status = row?.contracted?.status;
  if (status === 'superseded') return null;
  const outcome = row?.contracted?.projected_outcome;
  if (outcome === 'BID_PENDING' || status === 'bid_pending') return 'bid';
  if (outcome === 'BUMP_ELIGIBLE' || status === 'bump_eligible') return 'bump';
  const drift = row?.cumulative_drift_minutes;
  if (typeof drift === 'number' && Math.abs(drift) >= 30) {
    return drift < 0 ? 'bump' : 'bid';
  }
  if (typeof drift === 'number' && drift < 0 && isPostOctober1SmallerNotice(row)) return 'decrease';
  if (typeof drift === 'number' && drift > 0 && isPostOctober1SmallerNotice(row)) return 'increase';
  return null;
}

function fallbackCitation(kind, date) {
  const pre = date ? isPreOctober1ReviewPeriod(date) : false;
  if (kind === 'bid') return pre ? '3.08(a)(8)(a)' : '3.08(b)(1)';
  if (kind === 'bump') return pre ? '3.08(a)(8)(b)' : '3.08(b)(2)';
  if (kind === 'decrease') return '3.08(b)(4)';
  if (kind === 'increase') return '3.08(b)(3)';
  return '';
}

function planMatchesKind(plan, kind) {
  const rule = plan?.rule;
  if (kind === 'bid') return rule === 'pre_october_1_bid' || rule === 'post_october_1_bid';
  if (kind === 'bump') return rule === 'pre_october_1_bump' || rule === 'post_october_1_bump';
  if (kind === 'decrease') return rule === 'post_october_1_decrease_lock';
  if (kind === 'increase') return rule === 'post_october_1_increase_lock';
  return false;
}

function planFor(row, calendar, kind) {
  const drift = row?.cumulative_drift_minutes;
  const date = row?.date;
  if (calendar && date && typeof drift === 'number') {
    try {
      const plan = contractWindowPlan(calendar, date, drift);
      if (plan?.citation && plan.citation !== 'office override' && planMatchesKind(plan, kind)) {
        return plan;
      }
      if (plan?.rule === 'forced_october_1_contract') return plan;
    } catch {
      // The school calendar does not reach this date.
    }
  }
  return { rule: '', citation: fallbackCitation(kind, date) };
}

function citationFields(citationId) {
  const entry = contractCitations[citationId];
  if (!entry) {
    return {
      citationId: citationId || '',
      citationLabel: 'Teamsters CBA 2024–2027',
      citationText: '',
    };
  }
  return {
    citationId,
    citationLabel: entry.label,
    citationText: entry.text,
  };
}

function timingSentence(kind, plan, row, calendar) {
  const when = row?.contracted?.becomes_on ? prettyDate(row.contracted.becomes_on) : '';
  const rule = plan?.rule || '';
  const citation = plan?.citation || '';
  let timing = '';
  if (kind === 'bid') {
    let posted = '';
    if (calendar && row?.contracted?.becomes_on) {
      try {
        const span = bidPostingSpan(getSchoolDays(calendar), row.contracted.becomes_on);
        const window = span ? bidPostingSpanText(span) : '';
        if (window) posted = ` The posting window is ${window}.`;
      } catch {
        posted = '';
      }
    }
    if (!posted && when) posted = ` That date is ${when}.`;
    timing =
      rule === 'pre_october_1_bid' || citation === '3.08(a)(8)(a)'
        ? `Under Art. 3.08(a)(8)(a), an increase of 30 minutes or more that has lasted 15 school days from the initial bid goes up for bid.${posted}`
        : `Under Art. 3.08(b)(1), an increase of 30 minutes or more that has lasted 15 school days is posted for bid during the last five school days of the month, from October through April.${posted}`;
  } else if (kind === 'bump') {
    timing =
      rule === 'pre_october_1_bump' || citation === '3.08(a)(8)(b)'
        ? 'Under Art. 3.08(a)(8)(b), those two school days start when you receive this written determination. The decrease does not wait through 15 school days.'
        : `Under Art. 3.08(b)(2), the decrease has to last 15 school days before this written determination.${
            when ? ` That date is ${when}.` : ''
          } The two school days start when you receive it.`;
  } else if (kind === 'decrease') {
    timing = `Under Art. 3.08(b)(4), the new contract time takes effect on the workday after this written notice${
      when ? ` (${when})` : ''
    }.`;
  } else if (kind === 'increase') {
    timing = `Under Art. 3.08(b)(3), the new contract time takes effect on the workday following the 15th school day${
      when ? ` (${when})` : ''
    }.`;
  }
  const status = row?.contracted?.status;
  if (status === 'side_countdown' || status === 'separate_countdown') {
    timing = `${timing} This change does not move the bid date.`;
  }
  if (rule === 'forced_october_1_contract') {
    timing = `This schedule becomes contracted on October 1${when ? ` (${when})` : ''}. The 15-school-day countdown is not used.`;
  }
  return timing;
}

function changeAmount(row, previousMinutes, currentMinutes) {
  if (typeof previousMinutes === 'number' && typeof currentMinutes === 'number') {
    const delta = currentMinutes - previousMinutes;
    if (delta === 0) return 'no change in contracted hours';
    return `${formatDurationLabel(delta)} in contracted hours`;
  }
  const drift = row?.cumulative_drift_label || row?.delta_label;
  return drift ? String(drift) : 'not recorded';
}

function officeDate(asOf) {
  const text = String(asOf || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// The workday before the new hours. Art. 3.08(b)(4) makes those hours
// effective the workday after the written notice, so the letter is due then.
function decreaseNoticeDueOn(row, plan, calendar) {
  const effective = String(plan?.becomes_effective_on || row?.contracted?.becomes_on || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) return '';
  if (calendar) {
    try {
      let prior = '';
      for (const day of getSchoolDays(calendar)) {
        if (day < effective) prior = day;
        else break;
      }
      if (prior) return prior;
    } catch {
      // A calendar that does not reach this date uses the calendar day before.
    }
  }
  return previousCalendarDate(effective);
}

// Day the office should send this letter. Bid, bump, and increase letters are
// due the day the window closes. A smaller decrease is due the workday before
// the new hours, because Art. 3.08(b)(4) starts those hours the workday after
// the written notice.
function noticeSendByOn(row, kind, plan, calendar) {
  if (kind === 'decrease') return decreaseNoticeDueOn(row, plan, calendar);
  const when = String(row?.contracted?.becomes_on || plan?.becomes_effective_on || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(when) ? when : '';
}

// Bid, bump, and optional increase letters wait until the snapshot leaves
// "predicted", which is the day that window closes. A smaller decrease is due
// one workday sooner, while the row can still say predicted, because the
// notice itself starts the next workday.
function noticeIsDue(row, kind, plan, calendar, asOf) {
  if (kind !== 'decrease') return row?.contracted?.status !== 'predicted';
  const due = decreaseNoticeDueOn(row, plan, calendar);
  if (!due) return row?.contracted?.status === 'became_contracted';
  return officeDate(asOf) >= due;
}

// One schedule row, classified for the contract notice list and the email.
export function describeContractNotice({
  row,
  previousRow,
  calendar,
  asOf,
  snapContractClocks,
  contractSnapBreaks,
} = {}) {
  if (!row || row.kind === 'initial') return null;
  const rounding = {
    snapContractClocks: snapContractClocks === true,
    ...(contractSnapBreaks ? { contractSnapBreaks } : {}),
  };
  const previousMinutes = scheduleRoundedMinutes(previousRow?.schedule, rounding);
  const currentMinutes = scheduleRoundedMinutes(row.schedule, rounding);
  const status = row.contracted?.status;
  if (status === 'superseded') {
    return { skip: true, changeId: row.change_id || '' };
  }
  const kind = noticeKind(row);
  if (!kind) return { skip: true, changeId: row.change_id || '' };
  const plan = planFor(row, calendar, kind);
  if (kind === 'decrease' && plan.rule && plan.rule !== 'post_october_1_decrease_lock') {
    return { skip: true, changeId: row.change_id || '' };
  }
  if (kind === 'increase' && plan.rule && plan.rule !== 'post_october_1_increase_lock') {
    return { skip: true, changeId: row.change_id || '' };
  }
  if (!noticeIsDue(row, kind, plan, calendar, asOf)) {
    return { skip: true, changeId: row.change_id || '' };
  }
  const cite = citationFields(plan.citation || fallbackCitation(kind, row.date));
  const kindInfo = contractNoticeKindById(kind);
  const effective = row.contracted?.becomes_on ? prettyDate(row.contracted.becomes_on) : '';
  const sendBy = noticeSendByOn(row, kind, plan, calendar);
  return {
    skip: false,
    changeId: String(row.change_id || ''),
    changeIds: (row.change_ids?.length ? row.change_ids : [row.change_id]).filter(Boolean).map(String),
    kind,
    kindIcon: kindInfo.icon || '',
    kindLabel: kindInfo.label,
    date: row.date || '',
    effectiveDate: effective,
    sendByOn: sendBy || '',
    sendByDate: sendBy ? prettyDate(sendBy) : '',
    previousHours: hoursLabel(previousMinutes),
    contractHours: hoursLabel(currentMinutes),
    changeAmount: changeAmount(row, previousMinutes, currentMinutes),
    timing: timingSentence(kind, plan, row, calendar),
    resultLabel: String(row.contracted?.label || kindInfo.label),
    ...cite,
  };
}

// Red-flag only after the Send by deadline when the notice is still unsent.
export function contractNoticeNeedsAttention({ sent, sendByOn } = {}, asOf) {
  if (sent) return false;
  const due = String(sendByOn || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return true;
  return officeDate(asOf) >= due;
}

export function contractNoticeValues(described, { driverName, routeName, asOf } = {}) {
  const notice = described || {};
  return {
    driver_name: String(driverName || '').trim() || 'Driver',
    route_name: String(routeName || '').trim() || 'this route',
    date: prettyDate(asOf),
    effective_date: notice.effectiveDate || 'not predicted yet',
    previous_hours: notice.previousHours || 'not recorded',
    contract_hours: notice.contractHours || 'not recorded',
    change_amount: notice.changeAmount || 'not recorded',
    timing: notice.timing || '',
    citation_label: notice.citationLabel || '',
    citation_text: notice.citationText || '',
  };
}

export function contractNoticeMail({ described, templates, driverName, routeName, asOf }) {
  const kind = contractNoticeKindById(described?.kind);
  const template = contractNoticeTemplate(kind.id, templates);
  const values = contractNoticeValues(described, { driverName, routeName, asOf });
  return {
    id: kind.id,
    subject: fillNoticeTemplate(template.subject, values),
    body: `${fillNoticeTemplate(template.body, values).trimEnd()}\n`,
  };
}

export function loadSentContractRecords(storage = globalThis.localStorage) {
  return loadNoticeSentRecords(storage, CONTRACT_NOTICE_SENT_KEY);
}

export function loadSentContractIds(storage = globalThis.localStorage) {
  return loadSentContractRecords(storage).map((record) => record.id);
}

export function isContractNoticeSent(changeId, storage = globalThis.localStorage) {
  const id = String(changeId || '');
  if (!id) return false;
  return loadSentContractIds(storage).includes(id);
}

export function rememberContractNoticesSent(changeIds, storage = globalThis.localStorage, sender) {
  return rememberNoticeSent(CONTRACT_NOTICE_SENT_KEY, changeIds, storage, sender);
}

export function forgetContractNoticesSent(changeIds, storage = globalThis.localStorage) {
  return forgetNoticeSent(CONTRACT_NOTICE_SENT_KEY, changeIds, storage);
}
