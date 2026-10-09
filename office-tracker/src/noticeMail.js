import { formatClockAmPm } from '../../employee-tracker/src/clockTimes.js';
import { schoolDaysBeforeValue } from './contractReminder.js';
import { prettyDate } from './historyMarkup.js';

export const CHANGE_NOTICE_SENT_KEY = 'transportation-timechange.change-notice-sent.v1';

export const DEFAULT_DRIVER_NOTICE_SUBJECT = 'Clock-time notice for {{driver_name}}';

export const DEFAULT_DRIVER_NOTICE_BODY = 'Hi {{driver_name}},\n\n{{notices}}';

/** The memorandum used as the email until another one is chosen. */
export const DEFAULT_MEMORANDUM_ID = 'student-route-time';

/**
 * Email bodies an admin can choose. Add another object here to offer another memorandum.
 * `label` is the choice on the settings page. `subject` is the email subject.
 * `body` is the email, with {{driver_name}}, {{date}}, {{effective_date}}, and {{route_times}}.
 */
export const DRIVER_MEMORANDA = [
  {
    id: 'student-route-time',
    label:
      'Route Time Changes due to added student(s) or loss of student(s) on or after October 1',
    subject:
      '{{driver_name}}: Route Time Changes due to added student(s) or loss of student(s) on or after October 1',
    body: `Action Required

MEMORANDUM

TO: {{driver_name}}

FROM: Rachel Hrutfiord, Transportation Director

DATE: {{date}}

SUBJECT: Route Time Changes due to added student(s) or loss of student(s) on or after October 1

Effective {{effective_date}} your route times (punch-in and punch-out time) will be: {{route_times}}.

John and Jamie will be tracking the number of days, so please just mark your timecard with the timecard code #1 each day. It is your responsibility to notify Rachel Hrutfiord, Transportation Director, if the student has not been on the bus for two weeks.

This is not yet contracted time so if the student is absent, you should clock out at your regularly contracted time. If you sign up for work on the daily/weekly boards, please include this time as part of your day.

If these route changes are a decrease in time of 15 minutes or less, you will receive an official notice of your reduced contract time and the date it will take effect. If the decrease is 30 minutes or more, you will receive notification of the effective date of change, which will be 15 days from the effective date as well as your options regarding this decrease.

Please sign and date this form as your acknowledgement of receipt of your new route time. Please return your completed form to Jamie and she will get you a copy for your records. Feel free to see me if you have any questions.

Driver Signature: ______________________________

Date: ______________________________
`,
  },
];

/**
 * @param {unknown} id
 */
export function memorandumById(id) {
  const key = String(id ?? '').trim();
  return DRIVER_MEMORANDA.find((item) => item.id === key) || DRIVER_MEMORANDA[0];
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 */
function yesNo(value, fallback) {
  if (value === true || value === 'yes' || value === 'true') return true;
  if (value === false || value === 'no' || value === 'false') return false;
  return fallback;
}

/**
 * Timing for the driver email, which memorandum is that email, and whether the
 * older clock-time notice is also downloaded as a PDF to attach.
 * Automatic notices stay off until someone turns them on.
 * @param {unknown} raw
 */
export function normalizeDriverNotice(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const subject = String(source.subject ?? '').trim();
  const body = String(source.body ?? '').trim();
  return {
    noticeImmediately: yesNo(source.noticeImmediately, false),
    noticeBeforeContract: yesNo(source.noticeBeforeContract, false),
    schoolDaysBefore: schoolDaysBeforeValue(source.schoolDaysBefore),
    memorandumId: memorandumById(source.memorandumId).id,
    attachTimeChangeNotice: yesNo(source.attachTimeChangeNotice, false),
    subject: subject || DEFAULT_DRIVER_NOTICE_SUBJECT,
    body: body || DEFAULT_DRIVER_NOTICE_BODY,
  };
}

const TYPE_FROM_STATUS = {
  became_contracted: 'contracted',
  bid_pending: 'bid',
  bump_eligible: 'bump',
};

const PHRASE = {
  contracted: 'automatically contracted',
  bid_eligible: 'up for bid',
  bid: 'posted for bid',
  bump: 'bump eligible',
};

/**
 * @param {string} segment
 */
function runLabel(segment) {
  if (segment === 'MIDDAY') return 'midday';
  if (segment === 'AM' || segment === 'PM') return segment;
  return 'clock-time';
}

/**
 * @param {string[]} routeNames
 */
export function routesPhrase(routeNames) {
  const names = routeNames.filter(Boolean);
  const noun = names.length === 1 ? 'route' : 'routes';
  return `${noun} ${names.join(', ')}`;
}

/**
 * A row that is already headed for bid, with a known bid date.
 * @param {object | null | undefined} contracted
 */
function upcomingBidType(contracted) {
  if (
    contracted?.status === 'predicted' &&
    contracted?.projected_outcome === 'BID_PENDING' &&
    contracted?.becomes_on
  ) {
    return 'bid_eligible';
  }
  return null;
}

/**
 * @param {{ driverName: string, routeName: string, row: object }} input
 */
export function noticeFromChange({ driverName, routeName, row }) {
  const type = upcomingBidType(row?.contracted) || TYPE_FROM_STATUS[row?.contracted?.status] || '';
  return {
    driverName,
    routeName,
    type,
    changeId: row?.change_id || row?.id || '',
    segment: row?.segment,
    establishedOn: row?.date,
    resolvedOn: row?.contracted?.becomes_on || null,
    phrase: PHRASE[type] || '',
    deltaLabel: row?.delta_label || '',
    statusLabel: row?.contracted?.label || '',
    previousTime: row?.previous_time || '',
    newTime: row?.new_time || '',
  };
}

/**
 * @param {object} notice
 */
export function formatNoticeLine(notice) {
  const run = runLabel(notice.segment);
  const established = prettyDate(notice.establishedOn);
  const route = `Route ${notice.routeName}: the ${run} change from ${established}`;
  if (notice.type === 'bid_eligible' && notice.resolvedOn) {
    return `${route} will be up for bid on ${prettyDate(notice.resolvedOn)}.`;
  }
  if (notice.phrase && notice.resolvedOn) {
    return `${route} is ${notice.phrase} as of ${prettyDate(notice.resolvedOn)}.`;
  }
  if (notice.phrase) return `${route} is ${notice.phrase}.`;
  const previousTime = formatClockAmPm(notice.previousTime);
  const newTime = formatClockAmPm(notice.newTime);
  const shift =
    previousTime && newTime ? `, ${previousTime} to ${newTime}` : '';
  const delta = notice.deltaLabel ? ` (${notice.deltaLabel})` : '';
  const status = notice.statusLabel ? ` ${notice.statusLabel}.` : '';
  return `${route}${shift}${delta}.${status}`;
}

/**
 * @param {string} template
 * @param {Record<string, string>} values
 */
export function fillNoticeTemplate(template, values) {
  return String(template ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : match
  );
}

/**
 * @param {object | null | undefined} schedule
 * @param {'AM' | 'MIDDAY' | 'PM'} segment
 */
function runClockText(schedule, segment) {
  const item = schedule?.[segment];
  if (!item?.clock_in || !item?.clock_out) return '';
  return formatClockAmPm(`${item.clock_in}-${item.clock_out}`);
}

/**
 * @param {object | null | undefined} schedule
 */
function scheduleClockLines(schedule) {
  return [
    ['AM', 'AM'],
    ['MIDDAY', 'Midday'],
    ['PM', 'PM'],
  ]
    .map(([segment, label]) => {
      const times = runClockText(schedule, segment);
      return times ? `${label} ${times}` : '';
    })
    .filter(Boolean);
}

/**
 * @param {object} row
 */
function changeClockShift(row) {
  const from = formatClockAmPm(row.previous?.range || row.previous_time || '');
  const to = formatClockAmPm(row.next?.range || row.new_time || '');
  if (from && to) return ` from ${from} to ${to}`;
  if (to) return ` to ${to}`;
  return '';
}

/**
 * Original clock times, then each change to date, oldest first.
 * @param {string} routeName
 * @param {object[] | null | undefined} history
 */
export function noticeHistoryText(routeName, history) {
  const rows = Array.isArray(history) ? history : [];
  const route = String(routeName || '').trim() || 'this route';
  const initial = rows.find((row) => row.kind === 'initial') || rows[0];
  /** @type {string[]} */
  const lines = [`Changes to date on route ${route}:`, ''];
  if (!initial) {
    lines.push('No clock times are recorded yet.');
    return lines.join('\n');
  }
  lines.push(`Original clock times, established ${prettyDate(initial.date)}:`);
  const clocks = scheduleClockLines(initial.schedule);
  lines.push(...(clocks.length ? clocks : ['No clock times are recorded.']));
  const changes = rows.filter((row) => row.kind === 'change');
  lines.push('');
  if (!changes.length) {
    lines.push('No clock-time changes yet.');
    return lines.join('\n');
  }
  for (const row of changes) {
    const run = row.segment === 'MIDDAY' ? 'Midday' : row.segment || 'Clock time';
    const note = String(row.note || '').trim();
    lines.push(
      `${prettyDate(row.date)}. ${run} changed${changeClockShift(row)}.${note ? ` ${note}` : ''}`
    );
  }
  return lines.join('\n');
}

/**
 * Punch-in and punch-out for each run on the schedule after this change.
 * @param {string} routeName
 * @param {object | null | undefined} schedule
 */
export function routeTimesPhrase(routeName, schedule) {
  const parts = [
    ['AM', 'AM'],
    ['MIDDAY', 'Midday'],
    ['PM', 'PM'],
  ]
    .map(([segment, label]) => {
      const item = schedule?.[segment];
      if (!item?.clock_in || !item?.clock_out) return '';
      return `${label} punch-in ${formatClockAmPm(item.clock_in)}, punch-out ${formatClockAmPm(item.clock_out)}`;
    })
    .filter(Boolean);
  const route = String(routeName || '').trim();
  if (!parts.length) {
    return route ? `route ${route}, not recorded yet` : 'not recorded yet';
  }
  const listed = parts.join('; ');
  return route ? `route ${route}, ${listed}` : listed;
}

/**
 * The email opened from one clock-time change. The body is the chosen memorandum.
 * @param {{ memorandumId?: string, driverName: string, routeName: string, row: object, asOf?: string }} input
 */
export function memorandumMail({ memorandumId, driverName, routeName, row, asOf }) {
  const memo = memorandumById(memorandumId);
  const values = {
    driver_name: driverName,
    route_name: String(routeName || '').trim(),
    date: prettyDate(asOf),
    effective_date: prettyDate(row?.date),
    route_times: routeTimesPhrase(routeName, row?.schedule),
  };
  return {
    id: memo.id,
    subject: fillNoticeTemplate(memo.subject, values),
    body: `${fillNoticeTemplate(memo.body, values).trimEnd()}\n`,
  };
}

/**
 * The previous email, kept as the optional driver time-change notice PDF.
 * @param {{ driverName: string, routeName: string, row: object, asOf?: string, history?: object[], subject?: string, body?: string }} input
 */
export function changeNoticeMail({ driverName, routeName, row, asOf, history, subject, body }) {
  const notice = noticeFromChange({ driverName, routeName, row });
  const settings = normalizeDriverNotice({ subject, body });
  const values = {
    driver_name: driverName,
    routes: routesPhrase([routeName]),
    notices: formatNoticeLine(notice),
    date: prettyDate(asOf || row?.date),
  };
  const story = noticeHistoryText(routeName, history);
  const opening = fillNoticeTemplate(settings.body, values).trimEnd();
  return {
    changeId: notice.changeId,
    subject: fillNoticeTemplate(settings.subject, values),
    body: `${opening}\n\n${story}\n`,
  };
}

/**
 * Calendar download named like JohnSmith.pdf.
 * @param {string} driverName
 */
export function noticeCalendarFilename(driverName) {
  const compact = String(driverName ?? '').replace(/[^A-Za-z0-9]+/g, '');
  return `${compact || 'Driver'}.pdf`;
}

/**
 * Optional clock-time notice PDF, named apart from the calendar.
 * @param {string} driverName
 */
export function timeChangeNoticeFilename(driverName) {
  const compact = String(driverName ?? '').replace(/[^A-Za-z0-9]+/g, '');
  return `${compact || 'Driver'}-time-change-notice.pdf`;
}

/**
 * Text of the optional driver time-change notice PDF.
 * @param {{ driverName: string, routeName: string, row: object, asOf?: string, history?: object[], subject?: string, body?: string }} input
 */
export function timeChangeNoticeDocument(input) {
  const mail = changeNoticeMail(input);
  return {
    filename: timeChangeNoticeFilename(input.driverName),
    text: `${mail.subject}\n\n${mail.body}`.trimEnd() + '\n',
  };
}

/**
 * @param {Storage} [storage]
 * @returns {string[]}
 */
export function loadSentChangeIds(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(CHANGE_NOTICE_SENT_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === 'string' && id);
  } catch {
    return [];
  }
}

/**
 * @param {string} changeId
 * @param {Storage} [storage]
 */
export function isChangeNoticeSent(changeId, storage = globalThis.localStorage) {
  const id = String(changeId || '');
  if (!id) return false;
  return loadSentChangeIds(storage).includes(id);
}

/**
 * @param {string} changeId
 * @param {Storage} [storage]
 */
export function rememberChangeNoticeSent(changeId, storage = globalThis.localStorage) {
  const id = String(changeId || '');
  if (!id) return loadSentChangeIds(storage);
  const next = [...new Set([...loadSentChangeIds(storage), id])];
  storage.setItem(CHANGE_NOTICE_SENT_KEY, JSON.stringify(next));
  return next;
}
