// Kinds of work a driver clocks as Other.
// Trips come from Appendix A and Article 4.03.
// Other paid time is the same combined list as the door-clock reason codes.

import { DEFAULT_REASON_CODES, TRIP_TICKET_REASON_ID } from './clockKiosk.js';
import { parseClockTime } from './timeUtils.js';
import { normalizePunchRun, pairClockPunches } from './timesheets.js';

export const WORK_PORTION_LIMIT = 8;
const LOOKBACK_MS = 45 * 24 * 60 * 60 * 1000;

const TRIP_WORK_TYPES = [
  { id: 'field-trip', label: 'Field trip', group: 'Trips' },
  { id: 'flatland-roster', label: 'Flatland roster trip', group: 'Trips' },
  { id: 'mountain-roster', label: 'Mountain roster trip', group: 'Trips' },
  { id: 'summer-trip', label: 'Summer trip', group: 'Trips' },
  { id: 'emergency-roster', label: 'Emergency roster trip', group: 'Trips' },
  { id: 'overnight', label: 'Overnight trip', group: 'Trips' },
  { id: 'supplemental', label: 'Supplemental assignment', group: 'Trips' },
  { id: 'extended-day', label: 'Extended day', group: 'Trips' },
  { id: 'middle-school-sports', label: 'Middle school sports', group: 'Trips' },
];

export const TRIP_TICKET_WORK_TYPE = TRIP_TICKET_REASON_ID;
export const TRIP_TICKET_MAX = 40;

export function normalizeTripTicket(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text || text.length > TRIP_TICKET_MAX) return '';
  return text;
}

export function tripTicketLine(value) {
  const ticket = normalizeTripTicket(value);
  return ticket ? `Trip ticket ${ticket}` : '';
}

// Driver note, with a trip ticket number on its own line when one was collected.
export function clockNoteText(punch) {
  const lines = [];
  const seen = new Set();
  const add = (value) => {
    const line = tripTicketLine(value);
    if (!line || seen.has(line)) return;
    seen.add(line);
    lines.push(line);
  };
  add(punch?.trip_ticket);
  for (const portion of normalizeStoredWorkPortions(punch?.work_portions)) add(portion.trip_ticket);
  const note = String(punch?.note || '').trim();
  if (note) lines.push(note);
  return lines.join('\n');
}

export function stampTripTicket(punches, punchId, ticket) {
  const value = normalizeTripTicket(ticket);
  return (Array.isArray(punches) ? punches : []).map((punch) => {
    if (punch?.id !== punchId) return punch;
    const next = { ...punch };
    if (value) next.trip_ticket = value;
    else delete next.trip_ticket;
    return next;
  });
}

export const IRREGULAR_WORK_TYPES = [
  ...TRIP_WORK_TYPES,
  ...DEFAULT_REASON_CODES.map((code) => ({
    id: code.id,
    label: code.label,
    group: 'Other paid time',
  })),
];

const WORK_TYPE_IDS = new Set(IRREGULAR_WORK_TYPES.map((type) => type.id));

export function normalizeWorkType(value) {
  const id = String(value ?? '').trim();
  return WORK_TYPE_IDS.has(id) ? id : '';
}

export function workTypeLabel(value) {
  const id = normalizeWorkType(value);
  return IRREGULAR_WORK_TYPES.find((type) => type.id === id)?.label || '';
}

function minuteStamp(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()).getTime();
}

export function normalizeStoredWorkPortions(value) {
  if (!Array.isArray(value)) return [];
  const portions = [];
  for (const item of value) {
    if (portions.length >= WORK_PORTION_LIMIT) break;
    const work_type = normalizeWorkType(item?.work_type);
    const start = new Date(item?.start);
    const end = new Date(item?.end);
    if (!work_type || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end.getTime() - start.getTime() < 60000) continue;
    const portion = { start: start.toISOString(), end: end.toISOString(), work_type };
    const ticket = work_type === TRIP_TICKET_WORK_TYPE ? normalizeTripTicket(item?.trip_ticket) : '';
    if (ticket) portion.trip_ticket = ticket;
    portions.push(portion);
  }
  portions.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const kept = [];
  let cursor = 0;
  for (const portion of portions) {
    const from = new Date(portion.start).getTime();
    if (from < cursor) continue;
    kept.push(portion);
    cursor = new Date(portion.end).getTime();
  }
  return kept;
}

export function workPortionError(portions, periodStart, periodEnd) {
  const list = Array.isArray(portions) ? portions : [];
  if (!list.length) return '';
  if (list.length > WORK_PORTION_LIMIT) return `A route can have ${WORK_PORTION_LIMIT} parts.`;
  const startMs = periodStart?.getTime?.();
  const endMs = periodEnd?.getTime?.();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 'Clock out before marking part of this route.';
  }
  const checked = [];
  for (const portion of list) {
    if (!normalizeWorkType(portion?.work_type)) return 'Choose the kind of work.';
    const fromDate = new Date(portion?.start);
    const toDate = new Date(portion?.end);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 'Each part needs a start and an end.';
    const from = minuteStamp(fromDate) === minuteStamp(periodStart) ? startMs : fromDate.getTime();
    const to = minuteStamp(toDate) === minuteStamp(periodEnd) ? endMs : toDate.getTime();
    if (to - from < 60000) return 'A part has to end after it starts.';
    if (from < startMs || to > endMs) return 'That part has to sit inside the route.';
    checked.push({ from, to });
  }
  checked.sort((a, b) => a.from - b.from || a.to - b.to);
  for (let index = 1; index < checked.length; index += 1) {
    if (checked[index].from < checked[index - 1].to) return 'Those parts overlap.';
  }
  return '';
}

// Place a clock on the span's calendar day, or the next day when the span crosses midnight.
function clockOnSpan(spanStart, spanEnd, clock) {
  const minutes = parseClockTime(String(clock ?? '').trim());
  const candidates = [0, 1].map((extraDay) => {
    const date = new Date(spanStart.getFullYear(), spanStart.getMonth(), spanStart.getDate() + extraDay, 0, 0, 0, 0);
    date.setMinutes(minutes);
    return date;
  });
  return candidates.find((date) => minuteStamp(date) >= minuteStamp(spanStart) && minuteStamp(date) <= minuteStamp(spanEnd)) || candidates[0];
}

function snapToSpan(spanStart, spanEnd, date) {
  if (minuteStamp(date) === minuteStamp(spanStart)) return new Date(spanStart);
  if (minuteStamp(date) === minuteStamp(spanEnd)) return new Date(spanEnd);
  return date;
}

export function clocksOnSpan(spanStart, spanEnd, startClock, endClock) {
  let start;
  let end;
  try {
    start = clockOnSpan(spanStart, spanEnd, startClock);
    end = clockOnSpan(spanStart, spanEnd, endClock);
  } catch {
    throw new Error('Choose a start and an end.');
  }
  start = snapToSpan(spanStart, spanEnd, start);
  end = snapToSpan(spanStart, spanEnd, end);
  if (end <= start) {
    const next = new Date(end);
    next.setDate(next.getDate() + 1);
    if (next > start && next.getTime() <= spanEnd.getTime()) end = snapToSpan(spanStart, spanEnd, next);
  }
  if (start.getTime() < spanStart.getTime() || end.getTime() > spanEnd.getTime() || end <= start) {
    throw new Error('That part has to sit inside the route.');
  }
  if (end.getTime() - start.getTime() < 60000) throw new Error('A part has to end after it starts.');
  return { start, end };
}

// Completed regular routes this driver can still mark, newest first.
export function regularPairsForMarking(punches, driverName, now = new Date(), limit = 8) {
  const wanted = String(driverName ?? '').trim().toLowerCase();
  if (!wanted) return [];
  const mine = (Array.isArray(punches) ? punches : []).filter(
    (punch) => String(punch?.driver_name || '').trim().toLowerCase() === wanted
  );
  const cutoff = now.getTime() - LOOKBACK_MS;
  return pairClockPunches(mine)
    .pairs.filter((pair) => {
      const run = normalizePunchRun(pair.clockIn?.run) || normalizePunchRun(pair.clockOut?.run);
      if (run !== 'AM' && run !== 'MIDDAY' && run !== 'PM') return false;
      if (pair.reversed) return false;
      return pair.end.getTime() >= cutoff;
    })
    .sort((a, b) => b.start.getTime() - a.start.getTime())
    .slice(0, limit);
}

// Mark part of a regular clock pair as irregular work.
// The whole pair becomes that kind of work. A shorter part stays on the clock in.
export function applyWorkChunk(punches, clockInId, input) {
  const source = Array.isArray(punches) ? punches : [];
  const clockIn = source.find((punch) => punch?.id === clockInId && punch?.removed !== true);
  if (!clockIn || clockIn.action !== 'in') throw new Error('That clock in is not on the list.');
  const run = normalizePunchRun(clockIn.run);
  if (run !== 'AM' && run !== 'MIDDAY' && run !== 'PM') {
    throw new Error('Choose a regular AM, midday, or PM route.');
  }
  const workType = normalizeWorkType(input?.workType);
  if (!workType) throw new Error('Choose the kind of work.');
  const tripTicket = workType === TRIP_TICKET_WORK_TYPE ? normalizeTripTicket(input?.tripTicket) : '';
  if (workType === TRIP_TICKET_WORK_TYPE && !tripTicket) throw new Error('Enter the trip ticket number.');
  const driver = String(clockIn.driver_name || '').trim().toLowerCase();
  const mine = source.filter((punch) => String(punch?.driver_name || '').trim().toLowerCase() === driver);
  const pair = pairClockPunches(mine).pairs.find((item) => item.clockIn?.id === clockInId);
  if (!pair || pair.reversed) throw new Error('Clock out before marking part of this route.');
  const spanStart = pair.start <= pair.end ? pair.start : pair.end;
  const spanEnd = pair.start <= pair.end ? pair.end : pair.start;
  const bounds = clocksOnSpan(spanStart, spanEnd, input?.startClock, input?.endClock);
  const coversAll =
    minuteStamp(bounds.start) === minuteStamp(spanStart) && minuteStamp(bounds.end) === minuteStamp(spanEnd);
  if (coversAll) {
    return source.map((punch) => {
      if (punch?.id !== clockIn.id && punch?.id !== pair.clockOut?.id) return punch;
      const next = { ...punch, run: 'OTHER', work_type: workType };
      delete next.work_portions;
      if (tripTicket) next.trip_ticket = tripTicket;
      else delete next.trip_ticket;
      return next;
    });
  }
  const existing = normalizeStoredWorkPortions(clockIn.work_portions);
  const nextPortions = [
    ...existing,
    {
      start: bounds.start.toISOString(),
      end: bounds.end.toISOString(),
      work_type: workType,
      ...(tripTicket ? { trip_ticket: tripTicket } : {}),
    },
  ];
  const error = workPortionError(nextPortions, spanStart, spanEnd);
  if (error) throw new Error(error);
  const stored = normalizeStoredWorkPortions(nextPortions);
  return source.map((punch) => (punch?.id === clockIn.id ? { ...punch, work_portions: stored } : punch));
}
