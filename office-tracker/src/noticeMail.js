import { schoolDaysBeforeValue } from './contractReminder.js';
import { prettyDate } from './historyMarkup.js';

export const CHANGE_NOTICE_SENT_KEY = 'transportation-timechange.change-notice-sent.v1';

export const DEFAULT_DRIVER_NOTICE_SUBJECT = 'Clock-time notice for {{driver_name}}';

export const DEFAULT_DRIVER_NOTICE_BODY = 'Hi {{driver_name}},\n\n{{notices}}';

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
 * Wording and timing for the email a driver gets. Missing text uses the usual draft.
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
  const shift =
    notice.previousTime && notice.newTime
      ? `, ${notice.previousTime} to ${notice.newTime}`
      : '';
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
  return `${item.clock_in}-${item.clock_out}`;
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
  const from = row.previous?.range || row.previous_time || '';
  const to = row.next?.range || row.new_time || '';
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
 * Subject and body for the Mail draft opened from one clock-time change.
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
