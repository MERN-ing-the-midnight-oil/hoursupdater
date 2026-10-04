import { getSchoolDays } from '../../src/logic/calendar.js';
import { toDateString } from '../../src/logic/timeUtils.js';
import { prettyDate } from './historyMarkup.js';

export const DEFAULT_SCHOOL_DAYS_BEFORE = 1;

export const DEFAULT_REMINDER_SUBJECT =
  'Route {{route}} becomes contracted on {{contract_date}}';

export const DEFAULT_REMINDER_BODY = [
  'Route {{route}} for {{driver}} is predicted to become contracted on {{contract_date}}.',
  '',
  '{{change}}',
  '{{outcome}}',
].join('\n');

const EVENT_START = '080000';
const EVENT_END = '080100';

/**
 * @param {string} value
 */
function isEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}

/**
 * @param {unknown} value
 */
export function schoolDaysBeforeValue(value) {
  if (value == null || value === '') return DEFAULT_SCHOOL_DAYS_BEFORE;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SCHOOL_DAYS_BEFORE;
  return Math.min(200, Math.max(0, Math.round(parsed)));
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
 * @param {unknown} raw
 * @returns {{ email: string, name: string }[]}
 */
function inviteesFrom(raw) {
  const list = Array.isArray(raw) ? raw : [];
  /** @type {{ email: string, name: string }[]} */
  const invitees = [];
  const seen = new Set();
  for (const item of list) {
    const email = String(item?.email ?? '').trim();
    if (!isEmailAddress(email)) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const name = String(item?.name ?? '').trim() || email.split('@')[0];
    invitees.push({ email, name });
  }
  return invitees;
}

/**
 * Shared office setting for the Outlook reminder.
 * @param {unknown} raw
 */
export function normalizeContractReminder(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const subject = String(source.subject ?? '').trim();
  const body = String(source.body ?? '').trim();
  return {
    autoCreate: yesNo(source.autoCreate, true),
    schoolDaysBefore: schoolDaysBeforeValue(source.schoolDaysBefore),
    invitees: inviteesFrom(source.invitees),
    subject: subject || DEFAULT_REMINDER_SUBJECT,
    body: body || DEFAULT_REMINDER_BODY,
  };
}

/**
 * The reminder day has arrived. Dates are yyyy-mm-dd.
 * @param {string} reminderDate
 * @param {string} asOf
 */
export function isReminderDue(reminderDate, asOf) {
  try {
    const day = toDateString(reminderDate);
    const today = toDateString(asOf);
    return Boolean(day && today && day <= today);
  } catch {
    return false;
  }
}

/**
 * @param {string} template
 * @param {Record<string, string>} values
 */
export function fillReminderTemplate(template, values) {
  return String(template ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : match
  );
}

/**
 * A change whose contract date is still in the future.
 * @param {object | null | undefined} row
 */
export function isPredictedContract(row) {
  return row?.contracted?.status === 'predicted' && Boolean(row?.contracted?.becomes_on);
}

/**
 * School day `count` school days before the contract date.
 * 0 is the contract date itself. 1 is the previous school day.
 * @param {import('../../src/logic/calendar.js').SchoolCalendar | string[]} calendar
 * @param {string} contractDate
 * @param {number} count
 */
export function dateSchoolDaysBefore(calendar, contractDate, count) {
  const whole = schoolDaysBeforeValue(count);
  const start = toDateString(contractDate);
  if (whole === 0) return start;
  const schoolDays = getSchoolDays(calendar);
  let remaining = whole;
  for (let index = schoolDays.length - 1; index >= 0; index -= 1) {
    const day = schoolDays[index];
    if (day >= start) continue;
    remaining -= 1;
    if (remaining === 0) return day;
  }
  throw new Error(
    `The school calendar does not go back ${whole} school days before ${prettyDate(start)}.`
  );
}

/**
 * @param {object} row
 */
function describeChange(row) {
  const run = row?.segment === 'MIDDAY' ? 'Midday' : row?.segment || 'Clock time';
  const from = String(row?.previous_time || '').trim();
  const to = String(row?.new_time || '').trim();
  if (from && to) return `${run} changed from ${from} to ${to}.`;
  return `${run} change.`;
}

/**
 * @param {{
 *   routeName: string,
 *   driverName?: string,
 *   row: object,
 *   settings: ReturnType<typeof normalizeContractReminder>,
 *   calendar: import('../../src/logic/calendar.js').SchoolCalendar | string[],
 * }} input
 */
export function prepareContractReminder({ routeName, driverName, row, settings, calendar }) {
  if (!isPredictedContract(row)) return null;
  const contractDate = toDateString(row.contracted.becomes_on);
  const reminderDate = dateSchoolDaysBefore(calendar, contractDate, settings.schoolDaysBefore);
  const values = {
    route: String(routeName || '').trim() || 'this route',
    driver: String(driverName || '').trim() || 'Unassigned',
    contract_date: prettyDate(contractDate),
    reminder_date: prettyDate(reminderDate),
    school_days_before: String(settings.schoolDaysBefore),
    change: describeChange(row),
    outcome: String(row.contracted?.projected_outcome_label || row.contracted?.label || '').trim(),
    note: String(row.note || '').trim(),
  };
  return {
    changeId: String(row.change_id || ''),
    route: values.route,
    reminderDate,
    contractDate,
    subject: fillReminderTemplate(settings.subject, values).replace(/\s+/g, ' ').trim(),
    body: fillReminderTemplate(settings.body, values).trim(),
  };
}

/**
 * One Outlook event per reminder day. Later routes on that day are added
 * to the same event instead of getting a second one.
 * @param {Array<NonNullable<ReturnType<typeof prepareContractReminder>>>} reminders
 */
export function combineRemindersByDay(reminders) {
  /** @type {Map<string, NonNullable<ReturnType<typeof prepareContractReminder>>[]>} */
  const byDay = new Map();
  for (const item of reminders || []) {
    if (!item?.reminderDate || !item.changeId) continue;
    const day = byDay.get(item.reminderDate) || [];
    if (day.some((existing) => existing.changeId === item.changeId)) continue;
    day.push(item);
    byDay.set(item.reminderDate, day);
  }
  return [...byDay.keys()]
    .sort()
    .map((reminderDate) => {
      const items = byDay.get(reminderDate).sort((a, b) =>
        a.route.localeCompare(b.route, undefined, { numeric: true, sensitivity: 'base' })
      );
      const routes = items.map((item) => item.route);
      const subject =
        items.length === 1
          ? items[0].subject
          : `Routes ${routes.join(', ')} · ${prettyDate(reminderDate)}`;
      return {
        uid: contractReminderUid(reminderDate),
        reminderDate,
        subject,
        body: items.map((item) => item.body).join('\n\n'),
        changeIds: items.map((item) => item.changeId),
        routes,
      };
    });
}

/**
 * @param {string} reminderDate
 */
export function contractReminderUid(reminderDate) {
  return `contract-reminder-${reminderDate}@teamster-time-changes`;
}

/**
 * Stable text for one day's event, so a later download can tell if it changed.
 * @param {{ changeIds?: string[], subject?: string, body?: string }} event
 */
export function reminderEventSignature(event) {
  const ids = [...(event?.changeIds || [])].map(String).filter(Boolean).sort();
  return `${ids.join(',')}\n${event?.subject || ''}\n${event?.body || ''}`;
}

/**
 * Events to download now. A new prediction creates the day's event.
 * A moved contract date or another route on that day updates it.
 * A day that no longer has a prediction is cancelled.
 * @param {ReturnType<typeof combineRemindersByDay>} currentEvents
 * @param {Record<string, string>} [previousMap] change id to reminder day
 * @param {Record<string, string>} [previousSignatures] reminder day to signature
 * @param {string} [stamp] extra settings, such as invitees, that should refresh the file
 */
export function planReminderPublish(currentEvents, previousMap = {}, previousSignatures = {}, stamp = '') {
  /** @type {Map<string, string[]>} */
  const previousByDay = new Map();
  for (const [changeId, day] of Object.entries(previousMap || {})) {
    if (!changeId || !day) continue;
    const ids = previousByDay.get(day) || [];
    ids.push(changeId);
    previousByDay.set(day, ids);
  }
  const currentByDay = new Map(
    (currentEvents || []).filter((event) => event?.reminderDate).map((event) => [event.reminderDate, event])
  );
  const days = [...new Set([...currentByDay.keys(), ...previousByDay.keys()])].sort();
  /** @type {Array<object>} */
  const publish = [];
  for (const day of days) {
    const current = currentByDay.get(day);
    const previousIds = [...(previousByDay.get(day) || [])].sort();
    if (!current) {
      if (!previousIds.length) continue;
      publish.push({
        uid: contractReminderUid(day),
        reminderDate: day,
        subject: 'Contract reminder cancelled',
        body: 'This contract reminder is no longer needed.',
        changeIds: [],
        routes: [],
        cancelled: true,
        updated: true,
      });
      continue;
    }
    const signature = `${reminderEventSignature(current)}\n${stamp}`;
    const sameIds = previousIds.join(',') === [...current.changeIds].map(String).sort().join(',');
    if (sameIds && previousSignatures?.[day] === signature) continue;
    publish.push({
      ...current,
      cancelled: false,
      updated: previousIds.length > 0,
    });
  }
  return publish;
}

/**
 * @param {string} reminderDate
 */
export function reminderDayFilename(reminderDate) {
  const day = toDateString(reminderDate).replaceAll('-', '');
  return `contract-reminder-${day}.ics`;
}

/**
 * @param {string} value
 */
function icsText(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('\r\n', '\n')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
}

/**
 * @param {string} value
 */
function icsParam(value) {
  const text = String(value ?? '').replaceAll('"', '');
  if (/[;,:]/.test(text)) return `"${text}"`;
  return text;
}

/**
 * @param {string} line
 */
function foldLine(line) {
  const limit = 73;
  if (line.length <= limit) return line;
  let folded = line.slice(0, limit);
  let rest = line.slice(limit);
  while (rest.length) {
    folded += `\r\n ${rest.slice(0, limit - 1)}`;
    rest = rest.slice(limit - 1);
  }
  return folded;
}

/**
 * @param {Date} date
 */
function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * @param {string} day
 * @param {string} time
 */
function localStamp(day, time) {
  return `${toDateString(day).replaceAll('-', '')}T${time}`;
}

/**
 * One-minute Outlook meeting that stays free on the calendar.
 * Opening the file in Outlook lets the signed-in person send it.
 * @param {{
 *   organizer: { email: string, name?: string },
 *   invitees: { email: string, name?: string }[],
 *   events: Array<{ uid: string, reminderDate: string, subject: string, body: string }>,
 *   now?: Date,
 *   method?: 'REQUEST' | 'CANCEL',
 * }} input
 */
export function buildContractReminderCalendar({
  organizer,
  invitees,
  events,
  now = new Date(),
  method = 'REQUEST',
}) {
  const people = inviteesFrom(invitees);
  if (!isEmailAddress(organizer?.email)) {
    throw new Error('Sign in with the Outlook account that should send this reminder.');
  }
  if (!people.length) {
    throw new Error('Choose at least one Outlook invitee in Admin contract reminder.');
  }
  if (!events?.length) {
    throw new Error('There is no predicted contract date for this change.');
  }
  const stamp = utcStamp(now);
  const sequence = Math.floor(now.getTime() / 1000);
  const organizerLine = `ORGANIZER;CN=${icsParam(organizer.name || organizer.email)}:mailto:${organizer.email.trim()}`;
  const attendeeLines = people.map(
    (person) =>
      `ATTENDEE;CN=${icsParam(person.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${person.email}`
  );
  const blocks = events.map((event) => {
    const lines = [
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${localStamp(event.reminderDate, EVENT_START)}`,
      `DTEND:${localStamp(event.reminderDate, EVENT_END)}`,
      `SUMMARY:${icsText(event.subject)}`,
      `DESCRIPTION:${icsText(event.body)}`,
      `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
      `SEQUENCE:${sequence}`,
      'TRANSP:TRANSPARENT',
      'X-MICROSOFT-CDO-BUSYSTATUS:FREE',
      'X-MICROSOFT-CDO-INTENDEDSTATUS:FREE',
      organizerLine,
      ...attendeeLines,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Contract reminder',
      'TRIGGER:-PT0M',
      'END:VALARM',
      'END:VEVENT',
    ];
    return lines.map(foldLine).join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Teamster Time Changes Dashboard//EN', `METHOD:${method}`, ...blocks, 'END:VCALENDAR', ''].join(
    '\r\n'
  );
}
