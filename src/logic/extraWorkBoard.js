/**
 * Extra-work board — the paper field-trip signup sheet as data.
 *
 * Office fields match the clipboard form (date, school, leg, times, buses).
 * Driver cells store initials plus the preference notation from the office
 * directions (commas = one trip in order, parentheses = more than one).
 * Awarding a sheet generates the email the office sends the winner.
 *
 * This board is local until it is published. It is not the Art. 3.08 route bid.
 */

import { randomUUID } from 'node:crypto';
import { addIsoDays } from '../../public/board/gantt.js';
import {
  AVAIL_WEEKDAYS,
  dayIsOpenOnSchedule,
  normalizeTimeRanges,
  planDailyAwards,
  rangesOnSchedule,
  sameAsCycle,
  weeklyBusyBars,
} from '../../public/board/dailyAward.js';

/** Printed day order on the paper form. */
export const SHEET_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** @type {readonly string[]} */
export const TIME_FIELDS = [
  'clock_in',
  'leave_garage',
  'arrive_trip',
  'depart_school',
  'leave_destination',
  'clock_out',
];

export const TIME_LABELS = {
  clock_in: 'Clock in Time',
  leave_garage: 'Leave Bus Garage',
  arrive_trip: 'Arrive at Trip',
  depart_school: 'Depart School',
  leave_destination: 'Leave destination',
  clock_out: 'Clock out',
};

/** Sheet cell can hold a full day's ordered trip list. */
const PREFERENCE_LIMIT = 240;

const LEGS = ['whole', 'to_only', 'return_only'];
const STATUSES = ['draft', 'posted', 'awarded'];

/**
 * @typedef {'whole' | 'to_only' | 'return_only' | ''} TripLeg
 * @typedef {'draft' | 'posted' | 'awarded'} PostingStatus
 * @typedef {'yes' | 'no' | ''} StorageChoice
 *
 * @typedef {{
 *   driver_id: string,
 *   initials: string,
 *   preference: string,
 *   signed_at: string,
 * }} ExtraWorkBid
 *
 * @typedef {{
 *   to_email: string | null,
 *   subject: string,
 *   body: string,
 *   mailto_url: string | null,
 *   can_send: boolean,
 *   disabled_reason: string | null,
 *   generated_at: string,
 * }} WinnerEmail
 *
 * @typedef {{
 *   id: string,
 *   status: PostingStatus,
 *   trip_number: string,
 *   trip_date: string,
 *   school: string,
 *   pickup_location: string,
 *   leg: TripLeg,
 *   destination: string,
 *   activity: string,
 *   passenger_count: string,
 *   passenger_capacity: string,
 *   times: Record<(typeof TIME_FIELDS)[number], string>,
 *   buses: { big: boolean, small: boolean, wc: boolean },
 *   storage: StorageChoice,
 *   comments: string,
 *   bids: ExtraWorkBid[],
 *   list: 'daily' | 'roster',
 *   awarded_driver_id: string | null,
 *   winner_email: WinnerEmail | null,
 *   created_at: string,
 *   updated_at: string,
 *   posted_at: string | null,
 *   awarded_at: string | null,
 * }} ExtraWorkPosting
 *
 * @typedef {'posted' | 'awarded' | 'passed_over' | 'award_changed'} NoticeKind
 * @typedef {'all' | 'driver' | 'bidders'} NoticeAudience
 *
 * @typedef {{
 *   id: string,
 *   posting_id: string,
 *   kind: NoticeKind,
 *   audience: NoticeAudience,
 *   driver_id: string | null,
 *   exclude_driver_id: string | null,
 *   title: string,
 *   body: string,
 *   created_at: string,
 *   read_by: string[],
 * }} ExtraWorkNotice
 *
 * @typedef {{
 *   date: string,
 *   closed_at: string,
 * }} ClosedDay
 *
 * @typedef {{
 *   postings: ExtraWorkPosting[],
 *   notifications: ExtraWorkNotice[],
 *   closed_days: ClosedDay[],
 *   availability: AvailabilityMark[],
 *   availability_schedules: AvailabilitySchedule[],
 * }} ExtraWorkBoard
 *
 * @typedef {{
 *   date: string,
 *   driver_id: string,
 *   ranges: Array<{ start: string, end: string }>,
 *   marked_at: string,
 *   open?: boolean,
 * }} AvailabilityMark
 *
 * @typedef {{
 *   ranges: Array<{ start: string, end: string }>,
 *   note: string,
 *   same_as: string,
 *   open: boolean,
 * }} AvailabilityWeekday
 *
 * @typedef {{
 *   date: string,
 *   ranges: Array<{ start: string, end: string }>,
 *   note: string,
 *   open: boolean,
 * }} AvailabilityException
 *
 * @typedef {{
 *   driver_id: string,
 *   weekdays: Record<string, AvailabilityWeekday>,
 *   exceptions: AvailabilityException[],
 *   updated_at: string,
 * }} AvailabilitySchedule
 *
 * @typedef {{
 *   driver_id: string,
 *   name: string,
 *   email?: string | null,
 * }} AwardDriver
 */

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function clip(value, max) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanTime(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) {
    throw new Error('Times use HH:MM, from the time menu.');
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error('Times use HH:MM, from the time menu.');
  }
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error('Trip date must be a real calendar date.');
  }
  const [y, m, d] = text.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new Error('Trip date must be a real calendar date.');
  }
  return text;
}

/**
 * Printed weekday for a YYYY-MM-DD date. Uses the UTC civil date.
 * @param {string} iso
 * @returns {(typeof SHEET_DAYS)[number] | ''}
 */
export function sheetWeekday(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const names = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return names[dt.getUTCDay()] ?? '';
}

/**
 * 10/10/26, matching the marker on the paper form.
 * @param {string} iso
 * @returns {string}
 */
export function formatSheetDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

/**
 * @param {string} time HH:MM 24-hour, or ''
 * @returns {{ display: string, meridiem: 'AM' | 'PM' | '' }}
 */
export function splitClock(time) {
  if (!time) return { display: '', meridiem: '' };
  const [hourText, minute] = time.split(':');
  const hour = Number(hourText);
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return { display: `${hour12}:${minute}`, meridiem };
}

/**
 * @param {string} name
 * @returns {string}
 */
export function rosterName(name) {
  const text = String(name || '').trim().replace(/\s+/g, ' ');
  if (!text || text.includes(',')) return text;
  const parts = text.split(' ');
  if (parts.length < 2) return text;
  const last = parts.pop();
  return `${last}, ${parts.join(' ')}`;
}

/**
 * Given name used for the pink award stamp ("Darryl").
 * @param {string} name
 * @returns {string}
 */
export function givenName(name) {
  const text = String(name || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.includes(',')) {
    return text.split(',').slice(1).join(',').trim() || text;
  }
  const parts = text.split(' ');
  if (parts.length < 2) return text;
  return parts.slice(0, -1).join(' ');
}

/**
 * @param {string} name
 * @returns {string}
 */
export function suggestedInitials(name) {
  const text = String(name || '').trim();
  const spoken = text.includes(',')
    ? text.split(',').slice(1).join(' ').trim() +
      ' ' +
      text.split(',')[0].trim()
    : text;
  const parts = spoken.split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

/**
 * @param {string} [now]
 * @returns {ExtraWorkPosting}
 */
export function emptyPosting(now = new Date().toISOString()) {
  return {
    id: '',
    status: 'draft',
    trip_number: '',
    trip_date: '',
    school: '',
    pickup_location: '',
    leg: '',
    destination: '',
    activity: '',
    passenger_count: '',
    passenger_capacity: '',
    times: {
      clock_in: '',
      leave_garage: '',
      arrive_trip: '',
      depart_school: '',
      leave_destination: '',
      clock_out: '',
    },
    buses: { big: false, small: false, wc: false },
    storage: '',
    comments: '',
    bids: [],
    late_addition: false,
    out_of_town: false,
    award_note: '',
    list: 'daily',
    awarded_driver_id: null,
    winner_email: null,
    created_at: now,
    updated_at: now,
    posted_at: null,
    awarded_at: null,
  };
}

/**
 * @param {unknown} raw
 * @returns {ExtraWorkPosting}
 */
export function normalizePosting(raw) {
  const record =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? /** @type {Record<string, unknown>} */ (raw)
      : {};
  const timesIn =
    record.times && typeof record.times === 'object'
      ? /** @type {Record<string, unknown>} */ (record.times)
      : {};
  /** @type {ExtraWorkPosting['times']} */
  const times = {
    clock_in: '',
    leave_garage: '',
    arrive_trip: '',
    depart_school: '',
    leave_destination: '',
    clock_out: '',
  };
  for (const key of TIME_FIELDS) {
    times[key] = cleanTime(timesIn[key]);
  }
  const busesIn =
    record.buses && typeof record.buses === 'object'
      ? /** @type {Record<string, unknown>} */ (record.buses)
      : {};
  const leg = LEGS.includes(String(record.leg))
    ? /** @type {TripLeg} */ (record.leg)
    : '';
  const storage =
    record.storage === 'yes' || record.storage === 'no' ? record.storage : '';
  const status = STATUSES.includes(String(record.status))
    ? /** @type {PostingStatus} */ (record.status)
    : 'draft';
  const bids = Array.isArray(record.bids)
    ? record.bids.map((bid) => {
        const row =
          bid && typeof bid === 'object'
            ? /** @type {Record<string, unknown>} */ (bid)
            : {};
        return {
          driver_id: clip(row.driver_id, 80),
          initials: clip(row.initials, 12),
          preference: clip(row.preference, PREFERENCE_LIMIT),
          signed_at: clip(row.signed_at, 40),
        };
      }).filter((bid) => bid.driver_id && bid.initials)
    : [];

  return {
    id: clip(record.id, 80),
    status,
    trip_number: clip(record.trip_number, 20),
    trip_date: cleanDate(record.trip_date),
    school: clip(record.school, 80),
    pickup_location: clip(record.pickup_location, 80),
    leg,
    destination: clip(record.destination, 80),
    activity: clip(record.activity, 80),
    passenger_count: clip(record.passenger_count, 8),
    passenger_capacity: clip(record.passenger_capacity, 8),
    times,
    buses: {
      big: Boolean(busesIn.big),
      small: Boolean(busesIn.small),
      wc: Boolean(busesIn.wc),
    },
    storage,
    comments: clip(record.comments, 240),
    late_addition: Boolean(record.late_addition),
    out_of_town: Boolean(record.out_of_town),
    award_note: clip(record.award_note, 160),
    bids,
    list: record.list === 'roster' || record.list === 'weekly' ? record.list : 'daily',
    awarded_driver_id: record.awarded_driver_id
      ? clip(record.awarded_driver_id, 80)
      : null,
    winner_email: normalizeWinnerEmail(record.winner_email),
    created_at: clip(record.created_at, 40),
    updated_at: clip(record.updated_at, 40),
    posted_at: record.posted_at ? clip(record.posted_at, 40) : null,
    awarded_at: record.awarded_at ? clip(record.awarded_at, 40) : null,
  };
}

/**
 * @param {unknown} raw
 * @returns {WinnerEmail | null}
 */
function normalizeWinnerEmail(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const row = /** @type {Record<string, unknown>} */ (raw);
  const subject = clip(row.subject, 200);
  const body = String(row.body ?? '').slice(0, 4000);
  if (!subject && !body) return null;
  return {
    to_email: row.to_email ? clip(row.to_email, 200) : null,
    subject,
    body,
    mailto_url: row.mailto_url ? String(row.mailto_url).slice(0, 8000) : null,
    can_send: Boolean(row.can_send),
    disabled_reason: row.disabled_reason ? clip(row.disabled_reason, 240) : null,
    generated_at: clip(row.generated_at, 40),
  };
}

/**
 * @param {unknown} raw
 * @returns {ExtraWorkNotice}
 */
function normalizeNotice(raw) {
  const row =
    raw && typeof raw === 'object'
      ? /** @type {Record<string, unknown>} */ (raw)
      : {};
  const kind = ['posted', 'awarded', 'passed_over', 'award_changed'].includes(
    String(row.kind)
  )
    ? /** @type {NoticeKind} */ (row.kind)
    : 'posted';
  const audience = ['all', 'driver', 'bidders'].includes(String(row.audience))
    ? /** @type {NoticeAudience} */ (row.audience)
    : 'all';
  return {
    id: clip(row.id, 80),
    posting_id: clip(row.posting_id, 80),
    kind,
    audience,
    driver_id: row.driver_id ? clip(row.driver_id, 80) : null,
    exclude_driver_id: row.exclude_driver_id
      ? clip(row.exclude_driver_id, 80)
      : null,
    title: clip(row.title, 160),
    body: String(row.body ?? '').slice(0, 1000),
    created_at: clip(row.created_at, 40),
    read_by: Array.isArray(row.read_by)
      ? row.read_by.map((id) => clip(id, 80)).filter(Boolean)
      : [],
  };
}

/**
 * @param {unknown} raw
 * @returns {ExtraWorkBoard}
 */
export function normalizeExtraWorkBoard(raw) {
  const record =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? /** @type {Record<string, unknown>} */ (raw)
      : {};
  return {
    postings: Array.isArray(record.postings)
      ? record.postings.map((row) => normalizePosting(row)).filter((row) => row.id)
      : [],
    notifications: Array.isArray(record.notifications)
      ? record.notifications
          .map((row) => normalizeNotice(row))
          .filter((row) => row.id && row.posting_id)
      : [],
    closed_days: normalizeClosedDays(record.closed_days),
    availability: normalizeAvailability(record.availability),
    availability_schedules: normalizeAvailabilitySchedules(record.availability_schedules),
  };
}

/**
 * @param {unknown} raw
 * @returns {AvailabilityMark[]}
 */
function normalizeAvailability(raw) {
  if (!Array.isArray(raw)) return [];
  const marks = [];
  for (const row of raw) {
    const source = row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {};
    let date = '';
    try {
      date = cleanDate(source.date);
    } catch {
      date = '';
    }
    const driver_id = clip(source.driver_id, 80);
    const open = source.open === true;
    const ranges = open ? [] : normalizeTimeRanges(source.ranges);
    if (!date || !driver_id || (!open && !ranges.length) || marks.some((mark) => mark.date === date && mark.driver_id === driver_id)) {
      continue;
    }
    const mark = { date, driver_id, ranges, marked_at: clip(source.marked_at, 40) };
    if (open) mark.open = true;
    marks.push(mark);
  }
  return marks;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, AvailabilityWeekday>}
 */
function normalizeWeekdays(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? /** @type {Record<string, unknown>} */ (raw) : {};
  /** @type {Record<string, AvailabilityWeekday>} */
  const weekdays = {};
  for (const day of AVAIL_WEEKDAYS) {
    const entry = source[day.key];
    const record =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? /** @type {Record<string, unknown>} */ (entry)
        : { ranges: entry };
    const same = clip(record.same_as, 8);
    const same_as = AVAIL_WEEKDAYS.some((row) => row.key === same && row.key !== day.key) ? same : '';
    const open = !same_as && record.open === true;
    weekdays[day.key] = {
      ranges: same_as || open ? [] : normalizeTimeRanges(record.ranges),
      note: clip(record.note, 80),
      same_as,
      open,
    };
  }
  return weekdays;
}

/**
 * @param {unknown} raw
 * @param {{ strict?: boolean }} [options]
 * @returns {AvailabilityException[]}
 */
function normalizeExceptions(raw, { strict = false } = {}) {
  if (!Array.isArray(raw)) return [];
  /** @type {Map<string, AvailabilityException>} */
  const byDate = new Map();
  for (const row of raw) {
    const source = row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {};
    const text = String(source.date ?? '').trim();
    if (!text) continue;
    let date = '';
    try {
      date = cleanDate(text);
    } catch {
      if (strict) throw new Error('Choose a real date for the exception.');
      continue;
    }
    if (!byDate.has(date) && byDate.size >= 60) {
      if (strict) throw new Error('Keep the exception list to 60 dates.');
      break;
    }
    const open = source.open === true;
    byDate.set(date, {
      date,
      ranges: open ? [] : normalizeTimeRanges(source.ranges),
      note: clip(source.note, 80),
      open,
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Drop "same as" links that circle, so a stored board can still open.
 * @param {Record<string, AvailabilityWeekday>} weekdays
 */
function withoutSameAsCycles(weekdays) {
  const next = Object.fromEntries(AVAIL_WEEKDAYS.map((day) => [day.key, { ...weekdays[day.key] }]));
  for (const day of AVAIL_WEEKDAYS) {
    if (!sameAsCycle(next)) break;
    next[day.key] = { ...next[day.key], same_as: '' };
  }
  return next;
}

/**
 * @param {unknown} raw
 * @returns {AvailabilitySchedule[]}
 */
function normalizeAvailabilitySchedules(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {AvailabilitySchedule[]} */
  const schedules = [];
  for (const row of raw) {
    const source = row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {};
    const driver_id = clip(source.driver_id, 80);
    if (!driver_id || schedules.some((item) => item.driver_id === driver_id)) continue;
    const schedule = {
      driver_id,
      weekdays: withoutSameAsCycles(normalizeWeekdays(source.weekdays)),
      exceptions: normalizeExceptions(source.exceptions),
      updated_at: clip(source.updated_at, 40),
    };
    schedules.push(schedule);
  }
  return schedules;
}

/**
 * @param {AvailabilityException | null | undefined} row
 */
function exceptionSignature(row) {
  if (!row) return '';
  return JSON.stringify({
    ranges: row.open === true ? [] : normalizeTimeRanges(row.ranges),
    note: clip(row.note, 80),
    open: row.open === true,
  });
}

/**
 * A closed day keeps the times already on file.
 * The first save may record that frozen day as an exception when the times match.
 * @param {ExtraWorkBoard} board
 * @param {AvailabilitySchedule | null} previous
 * @param {AvailabilitySchedule} next
 */
function assertClosedExceptions(board, previous, next) {
  const dates = new Set([
    ...(previous?.exceptions || []).map((row) => row.date),
    ...next.exceptions.map((row) => row.date),
  ]);
  for (const date of dates) {
    if (!isDayClosed(board, date)) continue;
    const before = (previous?.exceptions || []).find((row) => row.date === date) || null;
    const after = next.exceptions.find((row) => row.date === date) || null;
    if (before) {
      if (exceptionSignature(before) !== exceptionSignature(after)) {
        throw new Error('Interest for this day was marked before 8:00.');
      }
      continue;
    }
    const frozen = (board.availability || []).find((mark) => mark.date === date && mark.driver_id === next.driver_id);
    const frozenOpen = frozen?.open === true;
    const afterOpen = after?.open === true;
    const frozenRanges = JSON.stringify(frozenOpen ? [] : normalizeTimeRanges(frozen?.ranges));
    const afterRanges = JSON.stringify(afterOpen ? [] : normalizeTimeRanges(after?.ranges));
    if (frozenRanges !== afterRanges || frozenOpen !== afterOpen) {
      throw new Error('Interest for this day was marked before 8:00.');
    }
  }
}

/**
 * Dates the office can see from a saved week. Exceptions outside the window stay too.
 * @param {string} today
 */
export function availabilitySpan(today) {
  const day = cleanDate(today);
  if (!day) throw new Error('Choose the day.');
  return { start: addIsoDays(day, -120), end: addIsoDays(day, 400) };
}

/**
 * Open days in the window follow the repeating week and its exceptions.
 * A closed day keeps the mark it had when interest closed.
 * @param {ExtraWorkBoard} board
 * @param {{ start?: string, end?: string }} span
 * @returns {ExtraWorkBoard}
 */
export function projectAvailability(board, { start = '', end = '' } = {}) {
  const schedules = board.availability_schedules || [];
  if (!schedules.length || !start || !end || start > end) return board;
  const scheduled = new Set(schedules.map((row) => row.driver_id));
  const kept = (board.availability || []).filter((mark) => {
    if (!scheduled.has(mark.driver_id)) return true;
    return isDayClosed(board, mark.date);
  });
  /** @type {AvailabilityMark[]} */
  const added = [];
  for (const schedule of schedules) {
    /** @type {Set<string>} */
    const dates = new Set();
    for (let date = start; date && date <= end; date = addIsoDays(date, 1)) dates.add(date);
    for (const exception of schedule.exceptions || []) {
      if (exception.date) dates.add(exception.date);
    }
    for (const date of dates) {
      if (isDayClosed(board, date)) continue;
      const open = dayIsOpenOnSchedule(schedule, date);
      const ranges = open ? [] : rangesOnSchedule(schedule, date);
      if (!open && !ranges.length) continue;
      const mark = {
        date,
        driver_id: schedule.driver_id,
        ranges,
        marked_at: schedule.updated_at || '',
      };
      if (open) mark.open = true;
      added.push(mark);
    }
  }
  return { ...board, availability: [...added, ...kept] };
}

/**
 * Write one day's resolved times onto the board before that day closes.
 * @param {ExtraWorkBoard} board
 * @param {string} date
 * @param {string} now
 */
function freezeAvailabilityDay(board, date, now) {
  const schedules = board.availability_schedules || [];
  if (!schedules.length) return board;
  let marks = board.availability || [];
  for (const schedule of schedules) {
    const open = dayIsOpenOnSchedule(schedule, date);
    const ranges = open ? [] : rangesOnSchedule(schedule, date);
    marks = marks.filter((mark) => !(mark.date === date && mark.driver_id === schedule.driver_id));
    if (!open && !ranges.length) continue;
    const mark = {
      date,
      driver_id: schedule.driver_id,
      ranges,
      marked_at: schedule.updated_at || clip(now, 40),
    };
    if (open) mark.open = true;
    marks = [mark, ...marks];
  }
  return { ...board, availability: marks };
}

/**
 * @param {AvailabilitySchedule | null | undefined} schedule
 */
function publicSchedule(schedule) {
  if (!schedule) return null;
  return {
    weekdays: schedule.weekdays,
    exceptions: schedule.exceptions,
    updated_at: schedule.updated_at || '',
  };
}

/**
 * @param {unknown} raw
 * @returns {ClosedDay[]}
 */
function normalizeClosedDays(raw) {
  if (!Array.isArray(raw)) return [];
  const days = [];
  for (const row of raw) {
    const source = row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {};
    let date = '';
    try {
      date = cleanDate(source.date);
    } catch {
      date = '';
    }
    if (!date || days.some((day) => day.date === date)) continue;
    days.push({ date, closed_at: clip(source.closed_at, 40) });
  }
  return days;
}

/**
 * @param {ExtraWorkBoard} board
 * @param {string} date
 */
export function isDayClosed(board, date) {
  return (board.closed_days || []).some((day) => day.date === date);
}

/**
 * @param {unknown} input
 * @param {ExtraWorkPosting} base
 * @returns {ExtraWorkPosting}
 */
export function postingFromInput(input, base) {
  const body =
    input && typeof input === 'object'
      ? /** @type {Record<string, unknown>} */ (input)
      : {};
  const timesIn =
    body.times && typeof body.times === 'object'
      ? /** @type {Record<string, unknown>} */ (body.times)
      : {};
  const busesIn =
    body.buses && typeof body.buses === 'object'
      ? /** @type {Record<string, unknown>} */ (body.buses)
      : {};
  return normalizePosting({
    ...base,
    trip_number: body.trip_number ?? base.trip_number,
    trip_date: body.trip_date ?? base.trip_date,
    school: body.school ?? base.school,
    pickup_location: body.pickup_location ?? base.pickup_location,
    leg: body.leg ?? base.leg,
    destination: body.destination ?? base.destination,
    activity: body.activity ?? base.activity,
    passenger_count: body.passenger_count ?? base.passenger_count,
    passenger_capacity: body.passenger_capacity ?? base.passenger_capacity,
    times: {
      ...base.times,
      ...Object.fromEntries(TIME_FIELDS.map((key) => [key, timesIn[key] ?? base.times[key]])),
    },
    buses: {
      big: busesIn.big ?? base.buses.big,
      small: busesIn.small ?? base.buses.small,
      wc: busesIn.wc ?? base.buses.wc,
    },
    storage: body.storage ?? base.storage,
    comments: body.comments ?? base.comments,
    list: body.list === 'roster' || body.list === 'weekly' || body.list === 'daily' ? body.list : base.list,
    late_addition: body.late_addition === undefined ? Boolean(base.late_addition) : Boolean(body.late_addition),
    out_of_town: body.out_of_town === undefined ? Boolean(base.out_of_town) : Boolean(body.out_of_town),
  });
}

/**
 * @param {ExtraWorkBoard} board
 * @param {string} id
 * @returns {ExtraWorkPosting}
 */
export function requirePosting(board, id) {
  const posting = board.postings.find((row) => row.id === id);
  if (!posting) {
    throw new Error('That trip sheet is not on the board.');
  }
  return posting;
}

/**
 * @param {ExtraWorkBoard} board
 * @param {ExtraWorkPosting} posting
 * @returns {ExtraWorkBoard}
 */
function replacePosting(board, posting) {
  return {
    ...board,
    postings: board.postings.map((row) => (row.id === posting.id ? posting : row)),
  };
}

/**
 * @param {ExtraWorkPosting} posting
 * @returns {string}
 */
export function postingHeadline(posting) {
  const number = posting.trip_number ? `Trip #${posting.trip_number}` : 'Extra work';
  const when = formatSheetDate(posting.trip_date);
  const day = sheetWeekday(posting.trip_date);
  const place = posting.destination || posting.school || 'trip';
  const activity = posting.activity ? ` ${posting.activity}` : '';
  return [number, when && day ? `${when} ${day}` : when, `${place}${activity}`]
    .filter(Boolean)
    .join(' · ');
}

/**
 * @param {ExtraWorkPosting} posting
 * @returns {string[]}
 */
export function validateForPost(posting) {
  /** @type {string[]} */
  const errors = [];
  if (!posting.trip_date) errors.push('Trip date is required before the sheet is posted.');
  if (!posting.school && !posting.destination) {
    errors.push('Add a school or a destination before posting the sheet.');
  }
  return errors;
}

/**
 * @param {ExtraWorkBoard} board
 * @param {unknown} input
 * @param {string} [now]
 * @returns {{ board: ExtraWorkBoard, posting: ExtraWorkPosting }}
 */
export function createPosting(board, input, now = new Date().toISOString()) {
  const posting = postingFromInput(input, {
    ...emptyPosting(now),
    id: randomUUID(),
    created_at: now,
    updated_at: now,
  });
  return {
    posting,
    board: { ...board, postings: [posting, ...board.postings] },
  };
}

/**
 * @param {ExtraWorkBoard} board
 * @param {string} id
 * @param {unknown} input
 * @param {string} [now]
 * @returns {{ board: ExtraWorkBoard, posting: ExtraWorkPosting }}
 */
export function updatePosting(board, id, input, now = new Date().toISOString()) {
  const current = requirePosting(board, id);
  if (current.status === 'awarded') {
    throw new Error('This sheet is already awarded. The office details stay as posted.');
  }
  const posting = postingFromInput(input, { ...current, updated_at: now });
  posting.status = current.status;
  posting.bids = current.bids;
  posting.posted_at = current.posted_at;
  posting.created_at = current.created_at;
  return { posting, board: replacePosting(board, posting) };
}

/**
 * @param {ExtraWorkPosting} posting
 * @param {NoticeKind} kind
 * @param {NoticeAudience} audience
 * @param {string} title
 * @param {string} body
 * @param {string} now
 * @param {{ driver_id?: string | null, exclude_driver_id?: string | null }} [who]
 * @returns {ExtraWorkNotice}
 */
function makeNotice(posting, kind, audience, title, body, now, who = {}) {
  return {
    id: randomUUID(),
    posting_id: posting.id,
    kind,
    audience,
    driver_id: who.driver_id ?? null,
    exclude_driver_id: who.exclude_driver_id ?? null,
    title,
    body,
    created_at: now,
    read_by: [],
  };
}

/**
 * @param {ExtraWorkBoard} board
 * @param {string} id
 * @param {string} [now]
 * @returns {{ board: ExtraWorkBoard, posting: ExtraWorkPosting }}
 */
export function publishPosting(board, id, now = new Date().toISOString()) {
  const current = requirePosting(board, id);
  if (current.status === 'awarded') {
    throw new Error('This sheet is already awarded.');
  }
  const errors = validateForPost(current);
  if (errors.length) throw new Error(errors.join(' '));
  if (current.list !== 'roster' && !current.late_addition && isDayClosed(board, current.trip_date)) {
    throw new Error('This day is closed. Add the work as a late addition.');
  }
  const posting = {
    ...current,
    status: /** @type {PostingStatus} */ ('posted'),
    posted_at: current.posted_at || now,
    updated_at: now,
  };
  const notice = makeNotice(
    posting,
    'posted',
    'all',
    `Extra work posted: ${postingHeadline(posting)}`,
    current.late_addition
      ? 'This work came in after the morning board. Drivers who signed are offered it first, then drivers who marked available.'
      : 'A trip sheet is on the board. Initial your row and write your preference if you want the work.',
    now
  );
  return {
    posting,
    board: {
      ...replacePosting(board, posting),
      notifications: [notice, ...board.notifications],
    },
  };
}

/**
 * @param {ExtraWorkBoard} board
 * @param {string} id
 * @returns {ExtraWorkBoard}
 */
export function deleteDraft(board, id) {
  const current = requirePosting(board, id);
  if (current.status !== 'draft') {
    throw new Error('Only a draft sheet can be taken off the desk.');
  }
  return {
    ...board,
    postings: board.postings.filter((row) => row.id !== id),
  };
}

/**
 * @param {ExtraWorkBoard} board
 * @param {string} postingId
 * @param {{ driver_id: string, initials: string, preference?: string }} bid
 * @param {string} [now]
 * @returns {{ board: ExtraWorkBoard, posting: ExtraWorkPosting }}
 */
export function upsertBid(board, postingId, bid, now = new Date().toISOString()) {
  const current = requirePosting(board, postingId);
  if (current.late_addition) {
    throw new Error('Late additions are offered from the times drivers marked ahead. They are not on the signup list.');
  }
  if (current.list !== 'roster' && isDayClosed(board, current.trip_date)) {
    throw new Error('Sign-up for this day is closed.');
  }
  if (current.status !== 'posted') {
    throw new Error('Sign the sheet after the office posts it, and before it is awarded.');
  }
  const driver_id = clip(bid.driver_id, 80);
  const initials = clip(bid.initials, 12);
  const preference = clip(bid.preference, PREFERENCE_LIMIT);
  if (!driver_id) throw new Error('Choose your name before you sign.');
  if (!initials) throw new Error('Initial the cell next to your name.');
  const nextBid = { driver_id, initials, preference, signed_at: now };
  const bids = [
    nextBid,
    ...current.bids.filter((row) => row.driver_id !== driver_id),
  ];
  const posting = { ...current, bids, updated_at: now };
  return { posting, board: replacePosting(board, posting) };
}

/**
 * @param {ExtraWorkBoard} board
 * @param {string} postingId
 * @param {string} driverId
 * @param {string} [now]
 * @returns {{ board: ExtraWorkBoard, posting: ExtraWorkPosting }}
 */
export function removeBid(board, postingId, driverId, now = new Date().toISOString()) {
  const current = requirePosting(board, postingId);
  if (current.list !== 'roster' && isDayClosed(board, current.trip_date)) {
    throw new Error('Sign-up for this day is closed.');
  }
  if (current.status !== 'posted') {
    throw new Error('Bids stay on the sheet once it is awarded.');
  }
  const posting = {
    ...current,
    bids: current.bids.filter((row) => row.driver_id !== driverId),
    updated_at: now,
  };
  return { posting, board: replacePosting(board, posting) };
}

/**
 * @param {ExtraWorkPosting} posting
 * @param {AwardDriver} driver
 * @param {string} now
 * @returns {WinnerEmail}
 */
export function buildWinnerEmail(posting, driver, now) {
  const first = givenName(driver.name) || driver.name || 'Driver';
  const day = sheetWeekday(posting.trip_date);
  const clockIn = splitClock(posting.times.clock_in);
  const depart = splitClock(posting.times.depart_school);
  const leave = splitClock(posting.times.leave_destination);
  const subject = posting.trip_number
    ? `Trip #${posting.trip_number} — extra work awarded`
    : 'Extra work awarded';
  const lines = [
    `Hi ${first},`,
    '',
    'You have been awarded this extra work.',
    '',
    posting.trip_number ? `Trip #${posting.trip_number}` : null,
    posting.trip_date
      ? `Date: ${formatSheetDate(posting.trip_date)}${day ? ` (${day})` : ''}`
      : null,
    posting.school ? `School: ${posting.school}` : null,
    posting.pickup_location ? `Pick up: ${posting.pickup_location}` : null,
    posting.destination ? `Destination: ${posting.destination}` : null,
    posting.activity ? `Activity: ${posting.activity}` : null,
    clockIn.display ? `Clock in: ${clockIn.display} ${clockIn.meridiem}` : null,
    depart.display ? `Depart school: ${depart.display} ${depart.meridiem}` : null,
    leave.display ? `Leave destination: ${leave.display} ${leave.meridiem}` : null,
    posting.comments ? `Comments: ${posting.comments}` : null,
    '',
    posting.late_addition ? 'This work came in after the morning board closed.' : null,
    'All trips are subject to change based on driver availability.',
    '',
    'Thank you,',
    'Transportation',
  ].filter((line) => line != null);
  const body = lines.join('\n');
  const to = String(driver.email || '').trim();
  if (!to) {
    return {
      to_email: null,
      subject,
      body,
      mailto_url: null,
      can_send: false,
      disabled_reason: `No email on file for ${driver.name}. Add an email on the driver record, then open this draft again.`,
      generated_at: now,
    };
  }
  const mailto_url =
    `mailto:${encodeURIComponent(to)}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;
  return {
    to_email: to,
    subject,
    body,
    mailto_url,
    can_send: true,
    disabled_reason: null,
    generated_at: now,
  };
}

/**
 * @param {ExtraWorkBoard} board
 * @param {string} postingId
 * @param {AwardDriver} driver
 * @param {string} [now]
 * @returns {{ board: ExtraWorkBoard, posting: ExtraWorkPosting, email: WinnerEmail }}
 */
export function awardPosting(board, postingId, driver, now = new Date().toISOString()) {
  const current = requirePosting(board, postingId);
  if (current.status === 'draft') {
    throw new Error('Post the sheet before awarding it.');
  }
  const driver_id = clip(driver?.driver_id, 80);
  if (!driver_id || !driver?.name) {
    throw new Error('Choose the driver who won.');
  }
  const bid = current.bids.find((row) => row.driver_id === driver_id);
  const substitute = driver?.kind === 'substitute';
  if (!bid && !current.late_addition && !substitute) {
    throw new Error('Award a driver who initialed this sheet.');
  }
  const email = buildWinnerEmail(current, driver, now);
  const posting = {
    ...current,
    status: /** @type {PostingStatus} */ ('awarded'),
    awarded_driver_id: driver_id,
    awarded_at: now,
    updated_at: now,
    winner_email: email,
  };
  const headline = postingHeadline(posting);
  /** @type {ExtraWorkNotice[]} */
  const notices = [
    makeNotice(
      posting,
      'awarded',
      'driver',
      `You were awarded ${headline}`,
      'The office marked your name on this trip sheet. Watch for the award email.',
      now,
      { driver_id }
    ),
  ];
  if (current.bids.some((row) => row.driver_id !== driver_id)) {
    notices.push(
      makeNotice(
        posting,
        'passed_over',
        'bidders',
        `${headline} was awarded to ${driver.name}`,
        'This sheet has been awarded. Your initial stays on the sheet as the record of the signup.',
        now,
        { exclude_driver_id: driver_id }
      )
    );
  }
  if (current.awarded_driver_id && current.awarded_driver_id !== driver_id) {
    notices.push(
      makeNotice(
        posting,
        'award_changed',
        'driver',
        `${headline} was awarded to someone else`,
        `The office changed the award on this sheet to ${driver.name}.`,
        now,
        { driver_id: current.awarded_driver_id }
      )
    );
  }
  return {
    posting,
    email,
    board: {
      ...replacePosting(board, posting),
      notifications: [...notices, ...board.notifications],
    },
  };
}

/**
 * Close one day's sign-up, then award that day's posted trips from the
 * written requests and hire-date seniority. The office clock does this at
 * 8:00 a.m. Late additions stay on the sheet for the dispatcher.
 *
 * @param {ExtraWorkBoard} board
 * @param {{
 *   date: string,
 *   drivers?: Array<{ driver_id?: string, name?: string, email?: string | null, seniority_rank?: number | null, hire_date?: string | null }>,
 *   schedules?: Array<{ driver_id?: string, route_id?: string, segments?: object }>,
 *   now?: string,
 * }} options
 */
export function closeDailyOfferings(board, { date, drivers = [], schedules = [], now = new Date().toISOString() } = {}) {
  const day = cleanDate(date);
  if (!day) throw new Error('Choose the day to close.');
  if (isDayClosed(board, day)) throw new Error('That day is already closed.');
  const frozen = freezeAvailabilityDay(board, day, now);
  const plan = planDailyAwards({
    postings: (frozen.postings || []).filter(
      (row) => !row.late_addition && row.list !== 'weekly' && row.list !== 'roster'
    ),
    drivers,
    schedules,
    extraBars: weeklyBusyBars(frozen.postings, day),
    date: day,
  });
  let next = {
    ...frozen,
    closed_days: [{ date: day, closed_at: now }, ...(frozen.closed_days || []).filter((row) => row.date !== day)],
  };
  const awarded = [];
  const leftOpen = [];
  for (const trip of plan.trips) {
    const current = next.postings.find((row) => row.id === trip.id);
    if (!current || current.status !== 'posted') continue;
    if (!trip.winner) {
      leftOpen.push(trip.trip_number);
      continue;
    }
    const driver = drivers.find((row) => row.driver_id === trip.winner.driver_id);
    if (!driver?.name) {
      leftOpen.push(trip.trip_number);
      continue;
    }
    const saved = awardPosting(
      next,
      trip.id,
      { driver_id: driver.driver_id, name: driver.name, email: driver.email },
      now
    );
    next = saved.board;
    awarded.push({
      trip_number: trip.trip_number,
      driver_id: driver.driver_id,
      name: driver.name,
    });
  }
  return { board: next, awarded, left_open: leftOpen };
}

/**
 * A driver marks the times they can take late work.
 * The mark is made before 8:00 a.m. An empty list clears the day.
 * When a repeating week is already saved, this date becomes an exception to it.
 *
 * @param {ExtraWorkBoard} board
 * @param {{ date?: string, driverId?: string, ranges?: unknown, now?: string, today?: string }} options
 */
export function setLateAvailability(board, { date, driverId, ranges = [], now = new Date().toISOString(), today = '' } = {}) {
  const day = cleanDate(date);
  if (!day) throw new Error('Choose the day.');
  const driver_id = clip(driverId, 80);
  if (!driver_id) throw new Error('Enter your PIN first.');
  if (isDayClosed(board, day)) throw new Error('Interest for this day was marked before 8:00.');
  const cleaned = normalizeTimeRanges(ranges);
  const schedule = (board.availability_schedules || []).find((row) => row.driver_id === driver_id);
  if (schedule) {
    const exceptions = (schedule.exceptions || []).filter((row) => row.date !== day);
    exceptions.push({ date: day, ranges: cleaned, note: '' });
    return setAvailabilitySchedule(board, {
      driverId: driver_id,
      weekdays: schedule.weekdays,
      exceptions,
      now,
      today: today || day,
    });
  }
  const rest = (board.availability || []).filter((row) => !(row.date === day && row.driver_id === driver_id));
  return {
    ...board,
    availability: cleaned.length ? [{ date: day, driver_id, ranges: cleaned, marked_at: now }, ...rest] : rest,
  };
}

/**
 * Save the repeating week and the dates that replace it.
 * Open days in the office window are rewritten from that schedule.
 * Closed days stay as they were at 8:00.
 *
 * @param {ExtraWorkBoard} board
 * @param {{
 *   driverId?: string,
 *   weekdays?: unknown,
 *   exceptions?: unknown,
 *   now?: string,
 *   today?: string,
 * }} options
 */
export function setAvailabilitySchedule(
  board,
  { driverId, weekdays, exceptions = [], now = new Date().toISOString(), today = '' } = {}
) {
  const driver_id = clip(driverId, 80);
  if (!driver_id) throw new Error('Enter your PIN first.');
  const normalizedWeek = normalizeWeekdays(weekdays);
  if (sameAsCycle(normalizedWeek)) throw new Error('One weekday cannot follow another in a circle.');
  /** @type {AvailabilitySchedule} */
  const schedule = {
    driver_id,
    weekdays: normalizedWeek,
    exceptions: normalizeExceptions(exceptions, { strict: true }),
    updated_at: clip(now, 40),
  };
  const previous = (board.availability_schedules || []).find((row) => row.driver_id === driver_id) || null;
  assertClosedExceptions(board, previous, schedule);
  const rest = (board.availability_schedules || []).filter((row) => row.driver_id !== driver_id);
  const withSchedule = {
    ...board,
    availability_schedules: [schedule, ...rest],
  };
  if (!today) return withSchedule;
  return projectAvailability(withSchedule, availabilitySpan(today));
}

/**
 * @param {ExtraWorkNotice} notice
 * @param {string} driverId
 * @param {ExtraWorkPosting | undefined} posting
 * @returns {boolean}
 */
export function noticeVisibleTo(notice, driverId, posting) {
  if (!driverId) return false;
  if (notice.audience === 'all') return true;
  if (notice.audience === 'driver') return notice.driver_id === driverId;
  if (notice.audience === 'bidders') {
    if (notice.exclude_driver_id === driverId) return false;
    return Boolean(posting?.bids.some((bid) => bid.driver_id === driverId));
  }
  return false;
}

/**
 * @param {ExtraWorkBoard} board
 * @param {string} driverId
 * @returns {ExtraWorkNotice[]}
 */
export function notificationsForDriver(board, driverId) {
  if (!driverId) return [];
  return board.notifications.filter((notice) => {
    const posting = board.postings.find((row) => row.id === notice.posting_id);
    return noticeVisibleTo(notice, driverId, posting);
  });
}

/**
 * @param {ExtraWorkBoard} board
 * @param {string} noticeId
 * @param {string} driverId
 * @returns {ExtraWorkBoard}
 */
export function markNoticeRead(board, noticeId, driverId) {
  const id = clip(driverId, 80);
  if (!id) throw new Error('Choose your name before marking a notice read.');
  let found = false;
  const notifications = board.notifications.map((notice) => {
    if (notice.id !== noticeId) return notice;
    found = true;
    if (notice.read_by.includes(id)) return notice;
    return { ...notice, read_by: [...notice.read_by, id] };
  });
  if (!found) throw new Error('That notice is not on the board.');
  return { ...board, notifications };
}

/**
 * Sheets a driver is allowed to see. Drafts stay on the office desk.
 * @param {ExtraWorkBoard} board
 * @returns {ExtraWorkPosting[]}
 */
export function driverVisiblePostings(board) {
  return board.postings.filter((row) => row.status !== 'draft');
}

/**
 * What one signed-in driver may see. Other drivers' initials and preferences
 * stay on the office sheet. The signup count is enough to see that names are
 * on the trip.
 *
 * @param {ExtraWorkBoard} board
 * @param {{
 *   driver?: { driver_id?: string, name?: string, seniority_rank?: number | null } | null,
 *   schedules?: Array<{ driver_id?: string }>,
 *   list?: 'daily' | 'roster',
 * }} options
 */
/**
 * @param {ExtraWorkPosting} row
 * @param {Map<string, string>} names
 */
function publicPosting(row, names) {
  const awarded = row.awarded_driver_id ? names.get(row.awarded_driver_id) || '' : '';
  return {
    ...row,
    bids: [],
    signup_count: row.bids.length,
    awarded_name: awarded ? givenName(awarded) : '',
    winner_email: null,
  };
}

export function driverBoardPayload(board, { driver = null, schedules = [], list = 'daily', names = [], today = '' } = {}) {
  const driverId = String(driver?.driver_id || '');
  const shown = today ? projectAvailability(board, availabilitySpan(today)) : board;
  const wanted = list === 'roster' || list === 'weekly' ? list : 'daily';
  const nameById = new Map(
    (names || []).map((row) => [String(row?.driver_id || ''), String(row?.name || '')])
  );
  const postings = driverVisiblePostings(shown)
    .filter((row) => (row.list === 'roster' || row.list === 'weekly' ? row.list : 'daily') === wanted)
    .map((row) => ({
      ...publicPosting(row, nameById),
      bids: row.bids
        .filter((bid) => bid.driver_id === driverId)
        .map((bid) => ({
          driver_id: bid.driver_id,
          initials: bid.initials,
          preference: bid.preference,
          signed_at: bid.signed_at,
        })),
    }));
  return {
    postings,
    notifications: notificationsForDriver(shown, driverId),
    drivers: driverId
      ? [
          {
            driver_id: driverId,
            name: driver?.name || '',
            seniority_rank: driver?.seniority_rank ?? null,
            email: null,
          },
        ]
      : [],
    schedules: (schedules || []).filter((row) => row?.driver_id === driverId),
    closed_days: shown.closed_days || [],
    my_availability: (shown.availability || [])
      .filter((row) => row.driver_id === driverId)
      .map((row) => {
        const mark = { date: row.date, ranges: row.ranges };
        if (row.open) mark.open = true;
        return mark;
      }),
    my_schedule: publicSchedule((board.availability_schedules || []).find((row) => row.driver_id === driverId)),
    held_work:
      wanted === 'daily'
        ? driverVisiblePostings(board)
            .filter(
              (row) => row.list === 'weekly' && row.status === 'awarded' && row.awarded_driver_id === driverId
            )
            .map((row) => ({
              id: row.id,
              list: 'weekly',
              status: 'awarded',
              awarded_driver_id: driverId,
              trip_date: row.trip_date,
              trip_number: row.trip_number,
              school: row.school || '',
              destination: row.destination || '',
              times: row.times,
            }))
        : [],
  };
}

/**
 * The wall board. Trip facts and who was awarded. Not the driver roster,
 * and not anyone's preference.
 * @param {ExtraWorkBoard} board
 * @param {Array<{ driver_id?: string, name?: string }>} drivers
 * @param {'daily' | 'roster'} [list]
 */
export function publicBoardPayload(board, drivers = [], list = 'daily') {
  const wanted = list === 'roster' || list === 'weekly' ? list : 'daily';
  const nameById = new Map(
    (drivers || []).map((row) => [String(row?.driver_id || ''), String(row?.name || '')])
  );
  return {
    postings: driverVisiblePostings(board)
      .filter((row) => (row.list === 'roster' || row.list === 'weekly' ? row.list : 'daily') === wanted)
      .map((row) => publicPosting(row, nameById)),
    notifications: [],
    drivers: [],
    schedules: [],
    closed_days: board.closed_days || [],
  };
}
