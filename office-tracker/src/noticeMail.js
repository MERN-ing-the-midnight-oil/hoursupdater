import {
  formatClockAmPm,
  formatDurationLabel,
  splitSegmentRange,
} from '../../employee-tracker/src/clockTimes.js';
import { prettyDate } from './historyMarkup.js';

export const CHANGE_NOTICE_SENT_KEY = 'transportation-timechange.change-notice-sent.v1';

export const DEFAULT_DRIVER_NOTICE_SUBJECT = 'Clock-time notice for {{driver_name}}';

export const DEFAULT_DRIVER_NOTICE_BODY = 'Hi {{driver_name}},\n\n{{notices}}';

/** The memorandum used as the email until another one is chosen. */
export const DEFAULT_MEMORANDUM_ID = 'student-route-time';

/**
 * Email bodies an admin can choose. Add another object here to offer another memorandum.
 * `label` is the choice on the settings page. `subject` and `body` are the usual template.
 * The settings page lets each one be opened and edited. Placeholders:
 * {{driver_name}}, {{route_name}}, {{date}}, {{effective_date}}, and {{route_times}}.
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
 * Wording saved for each memorandum. A blank or unchanged template stays on the usual text.
 * @param {unknown} raw
 * @returns {Record<string, { subject: string, body: string }>}
 */
export function normalizeMemorandumTemplates(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  /** @type {Record<string, { subject: string, body: string }>} */
  const templates = {};
  for (const memo of DRIVER_MEMORANDA) {
    const saved = source[memo.id];
    if (!saved || typeof saved !== 'object') continue;
    const subject = String(saved.subject ?? '').trim();
    const body = String(saved.body ?? '').trim();
    const usualSubject = memo.subject.trim();
    const usualBody = memo.body.trim();
    const nextSubject = subject || usualSubject;
    const nextBody = body || usualBody;
    if (nextSubject === usualSubject && nextBody === usualBody) continue;
    templates[memo.id] = { subject: nextSubject, body: nextBody };
  }
  return templates;
}

/**
 * Subject and body for one memorandum, using a saved template when there is one.
 * @param {unknown} id
 * @param {unknown} templates
 */
export function memorandumTemplate(id, templates) {
  const memo = memorandumById(id);
  const saved = normalizeMemorandumTemplates(templates)[memo.id];
  return {
    ...memo,
    subject: saved?.subject || memo.subject,
    body: saved?.body || memo.body,
  };
}

/**
 * Which memorandum is the driver email, and whether the older clock-time
 * notice is also downloaded as a PDF to attach.
 * @param {unknown} raw
 */
export function normalizeDriverNotice(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const subject = String(source.subject ?? '').trim();
  const body = String(source.body ?? '').trim();
  return {
    memorandumId: memorandumById(source.memorandumId).id,
    memorandumTemplates: normalizeMemorandumTemplates(source.memorandumTemplates),
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
 * A missing change date is a blank, not a time. "from —" reads as a missing clock.
 * @param {object} notice
 */
function changeIntro(notice) {
  const run = runLabel(notice.segment);
  const route = `Route ${notice.routeName}: the ${run} change`;
  if (!notice.establishedOn) return `${route}, date not recorded,`;
  return `${route} from ${prettyDate(notice.establishedOn)}`;
}

/**
 * @param {number | null | undefined} beforeMinutes
 * @param {number | null | undefined} afterMinutes
 */
function lengthChangePhrase(beforeMinutes, afterMinutes) {
  if (typeof beforeMinutes !== 'number' || typeof afterMinutes !== 'number') return '';
  const delta = afterMinutes - beforeMinutes;
  if (delta === 0) return 'same length';
  const amount = formatDurationLabel(Math.abs(delta));
  return delta > 0 ? `${amount} longer` : `${amount} shorter`;
}

/**
 * The noticed run, with whether that span got longer or shorter.
 * A row that covers more than one run has no single previous/new pair.
 * @param {object} notice
 */
function noticedRunSentence(notice) {
  if (notice.segment !== 'AM' && notice.segment !== 'PM' && notice.segment !== 'MIDDAY') {
    return '';
  }
  const previousTime = formatClockAmPm(notice.previousTime);
  const newTime = formatClockAmPm(notice.newTime);
  if (!previousTime || !newTime || previousTime === newTime) return '';
  const direction = lengthChangePhrase(
    splitSegmentRange(notice.previousTime)?.duration_minutes,
    splitSegmentRange(notice.newTime)?.duration_minutes
  );
  const run = notice.segment === 'MIDDAY' ? 'Midday' : notice.segment;
  return ` ${run} changed from ${previousTime} to ${newTime}${direction ? `, ${direction}` : ''}.`;
}

/**
 * @param {object} notice
 */
export function formatNoticeLine(notice) {
  const route = changeIntro(notice);
  const shift = noticedRunSentence(notice);
  if (notice.type === 'bid_eligible' && notice.resolvedOn) {
    return `${route} will be up for bid on ${prettyDate(notice.resolvedOn)}.${shift}`;
  }
  if (notice.phrase && notice.resolvedOn) {
    return `${route} is ${notice.phrase} as of ${prettyDate(notice.resolvedOn)}.${shift}`;
  }
  if (notice.phrase) return `${route} is ${notice.phrase}.${shift}`;
  const previousTime = formatClockAmPm(notice.previousTime);
  const newTime = formatClockAmPm(notice.newTime);
  const times =
    previousTime && newTime ? `, ${previousTime} to ${newTime}` : '';
  const delta = notice.deltaLabel ? ` (${notice.deltaLabel})` : '';
  const status = notice.statusLabel ? ` ${notice.statusLabel}.` : '';
  return `${route}${times}${delta}.${status}`;
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

const HISTORY_RUNS = [
  ['AM', 'AM'],
  ['MIDDAY', 'Midday'],
  ['PM', 'PM'],
];

/**
 * @param {object | null | undefined} item
 */
function runRange(item) {
  if (!item) return '';
  if (item.range) return String(item.range);
  if (item.clock_in && item.clock_out) return `${item.clock_in}-${item.clock_out}`;
  return '';
}

/**
 * @param {object | null | undefined} item
 */
function runDuration(item) {
  if (typeof item?.duration_minutes === 'number') return item.duration_minutes;
  return splitSegmentRange(runRange(item))?.duration_minutes ?? null;
}

/**
 * @param {string} label
 * @param {object | null | undefined} before
 * @param {object | null | undefined} after
 */
function describeRunChange(label, before, after) {
  const from = formatClockAmPm(runRange(before));
  const to = formatClockAmPm(runRange(after));
  if (from && to && from !== to) {
    const direction = lengthChangePhrase(runDuration(before), runDuration(after));
    return `${label} changed from ${from} to ${to}${direction ? `, ${direction}` : ''}.`;
  }
  if (!from && to) return `${label} was added at ${to}.`;
  if (from && !to) return `${label} was removed. It had been ${from}.`;
  return '';
}

/**
 * Every run that moved on this row. A saved row can change AM and PM together;
 * the row's own previous/new pair is only the last run and hides the other.
 * @param {object | null | undefined} beforeSchedule
 * @param {object} row
 */
function shiftsOnRow(beforeSchedule, row) {
  const fromSchedule = HISTORY_RUNS.map(([segment, label]) =>
    describeRunChange(label, beforeSchedule?.[segment], row.schedule?.[segment])
  ).filter(Boolean);
  if (fromSchedule.length) return fromSchedule;
  const from = row.previous?.range || row.previous_time || '';
  const to = row.next?.range || row.new_time || '';
  const shift = changeClockShift(row);
  if (!shift) return [];
  const direction = lengthChangePhrase(
    splitSegmentRange(from)?.duration_minutes,
    splitSegmentRange(to)?.duration_minutes
  );
  const run = row.segment === 'MIDDAY' ? 'Midday' : row.segment || 'Clock time';
  return [`${run} changed${shift}${direction ? `, ${direction}` : ''}.`];
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
  let previousSchedule = initial.schedule;
  /** @type {object | null} */
  let previousChange = null;
  for (const row of changes) {
    const shifts = shiftsOnRow(previousSchedule, row);
    const note = String(row.note || '').trim();
    const when = row.date ? prettyDate(row.date) : 'Date not recorded';
    const sameDay =
      row.date && previousChange?.date && row.date === previousChange.date
        ? ', same day as the change above'
        : '';
    const heading = `${when}${sameDay}.`;
    if (shifts.length > 1) {
      lines.push(`${heading} These runs were entered together:`);
      lines.push(...shifts);
      if (note) lines.push(note);
    } else if (shifts.length === 1) {
      lines.push(`${heading} ${shifts[0]}${note ? ` ${note}` : ''}`);
    } else {
      lines.push(`${heading}${note ? ` ${note}` : ''}`);
    }
    lines.push('');
    if (row.schedule) previousSchedule = row.schedule;
    previousChange = row;
  }
  if (changes.length > 1 && changes.some((row) => !row.date)) {
    lines.push(
      'Each block is its own change. Runs in one block were entered together. Date not recorded means that date was left blank, so that change is not known to be the same day as any other.'
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
 * @param {{ memorandumId?: string, templates?: unknown, driverName: string, routeName: string, row: object, asOf?: string }} input
 */
export function memorandumMail({ memorandumId, templates, driverName, routeName, row, asOf }) {
  const memo = memorandumTemplate(memorandumId, templates);
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
 * Email whose body is one route’s clock-time history.
 * @param {{ driverName: string, routeName: string, history?: object[] }} input
 */
export function routeHistoryMail({ driverName, routeName, history }) {
  const route = String(routeName || '').trim() || 'this route';
  return {
    subject: `Route clock-time history for route ${route}`,
    body: `Hi ${driverName},\n\n${noticeHistoryText(route, history)}\n`,
  };
}

/**
 * Calendar download for a route history email, named apart from a driver notice.
 * @param {string} routeName
 */
export function routeHistoryFilename(routeName) {
  const compact = String(routeName ?? '').replace(/[^A-Za-z0-9]+/g, '');
  return `Route${compact || 'History'}-clock-history.pdf`;
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
