import { driverForDate } from './assignments.js';
import { parseTimeRange } from '../../src/logic/timeUtils.js';
import { fleetKey } from './yardTransitions.js';

const PIECES = [
  { id: 'am-in', label: 'AM clock in', segment: 'AM', edge: 'in', yard: 'leave' },
  { id: 'am-out', label: 'AM clock out', segment: 'AM', edge: 'out', yard: 'return' },
  { id: 'mid-in', label: 'Midday clock in', segment: 'MIDDAY', edge: 'in', yard: 'leave' },
  { id: 'mid-out', label: 'Midday clock out', segment: 'MIDDAY', edge: 'out', yard: 'return' },
  { id: 'pm-in', label: 'PM clock in', segment: 'PM', edge: 'in', yard: 'leave' },
  { id: 'pm-out', label: 'PM clock out', segment: 'PM', edge: 'out', yard: 'return' },
];

const MATCH_MINUTES = 150;

export function pacificStamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    minutes: hour * 60 + minute,
  };
}

export function recentWeekdays(count, now = new Date()) {
  const today = pacificStamp(now)?.date;
  if (!today) return [];
  const want = Math.max(0, Number(count) || 0);
  const dates = [];
  let cursor = today;
  while (dates.length < want) {
    const [year, month, day] = cursor.split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(cursor);
    cursor = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
  }
  return dates.reverse();
}

export function formatHabitClock(minutes) {
  if (!Number.isFinite(Number(minutes))) return '';
  const rounded = Math.round(Number(minutes));
  const wrapped = ((rounded % 1440) + 1440) % 1440;
  const hour24 = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function routeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^route\s+/, '');
}

export function busForRoute(posted, route) {
  const key = routeKey(route);
  const row = (posted || []).find((item) => routeKey(item?.route) === key);
  return fleetKey(row?.bus);
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function changesOf(profile) {
  const log = profile?.changeLog || profile?.change_log;
  return Array.isArray(log) ? log : [];
}

// The published clock, in minutes, for one segment edge on one date.
// Later changes replace earlier ones. A change dated after that day does not count.
export function publishedMinutes(profile, date, segment, edge) {
  const day = String(date || '');
  let chosen = null;
  for (const change of changesOf(profile)) {
    if (change?.segment !== segment) continue;
    if (change.type && change.type !== 'CHANGE') continue;
    const when = String(change.effective_date || '').slice(0, 10);
    if (!when || when > day) continue;
    const range = String(change.new_time || '').trim();
    if (!range) continue;
    const submitted = String(change.submitted_at || '');
    if (!chosen || when > chosen.when || (when === chosen.when && submitted >= chosen.submitted)) {
      chosen = { when, submitted, range };
    }
  }
  if (!chosen) return null;
  try {
    const parsed = parseTimeRange(chosen.range);
    return edge === 'out' ? parsed.endMinutes : parsed.startMinutes;
  } catch {
    return null;
  }
}

function assignYard(events, pieces) {
  const candidates = [];
  for (const piece of pieces) {
    for (const event of events || []) {
      if (event?.kind !== piece.yard || !Number.isFinite(Number(event.at))) continue;
      const distance = Math.abs(Number(event.at) - piece.published);
      if (distance > MATCH_MINUTES) continue;
      candidates.push({ id: piece.id, at: Number(event.at), distance, kind: event.kind });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.at - b.at);
  const usedEvents = new Set();
  const usedPieces = new Set();
  const assigned = new Map();
  for (const item of candidates) {
    const eventId = `${item.kind}|${item.at}`;
    if (usedEvents.has(eventId) || usedPieces.has(item.id)) continue;
    usedEvents.add(eventId);
    usedPieces.add(item.id);
    assigned.set(item.id, item.at);
  }
  return assigned;
}

export function gapTone(gap) {
  if (!Number.isFinite(gap)) return 'none';
  const size = Math.abs(gap);
  if (size >= 30) return 'far';
  if (size >= 20) return 'long';
  if (size >= 10) return 'mild';
  return 'close';
}

function habitPhrase(piece, minutes) {
  const size = Math.abs(Math.round(minutes));
  const later = minutes > 0;
  if (size < 1) {
    return piece.edge === 'in'
      ? 'usually leaves at the published clock-in'
      : 'usually returns at the published clock-out';
  }
  if (piece.edge === 'in') {
    return later
      ? `usually leaves ${size} min after the published clock-in`
      : `usually leaves ${size} min before the published clock-in`;
  }
  return later
    ? `usually returns ${size} min after the published clock-out`
    : `usually returns ${size} min before the published clock-out`;
}

function weekdayLabel(iso) {
  const [year, month, day] = String(iso).split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function buildDriverHabits({
  transitions,
  profiles,
  posted,
  dates,
  threshold = 20,
  showUnsettled = false,
} = {}) {
  const line = Number(threshold) || 20;
  const wanted = (dates || []).filter(Boolean);
  const wantedSet = new Set(wanted);
  const byBusDate = new Map();
  for (const event of transitions || []) {
    const bus = fleetKey(event?.bus);
    const date = String(event?.date || '');
    if (!bus || !wantedSet.has(date)) continue;
    const key = `${date}|${bus}`;
    const list = byBusDate.get(key) || [];
    list.push(event);
    byBusDate.set(key, list);
  }
  const rows = [];
  for (const profile of profiles || []) {
    const route = String(profile?.name || '').trim();
    if (!route) continue;
    const bus = busForRoute(posted, route);
    if (!bus) continue;
    const latest = wanted.at(-1) || '';
    const driver = driverForDate(profile, latest) || '';
    for (const piece of PIECES) {
      const observations = [];
      for (const date of wanted) {
        const published = publishedMinutes(profile, date, piece.segment, piece.edge);
        if (published == null) continue;
        const dayPieces = PIECES.map((item) => {
          const minutes = publishedMinutes(profile, date, item.segment, item.edge);
          return minutes == null ? null : { ...item, published: minutes };
        }).filter(Boolean);
        const assigned = assignYard(byBusDate.get(`${date}|${bus}`) || [], dayPieces);
        const yard = assigned.has(piece.id) ? assigned.get(piece.id) : null;
        const gap = yard == null ? null : yard - published;
        observations.push({
          date,
          label: weekdayLabel(date),
          published,
          publishedLabel: formatHabitClock(published),
          yard,
          yardLabel: yard == null ? '' : formatHabitClock(yard),
          gap,
          tone: gapTone(gap),
        });
      }
      const withYard = observations.filter((item) => item.yard != null);
      if (!withYard.length) continue;
      const yards = withYard.map((item) => item.yard).sort((a, b) => a - b);
      const gaps = withYard.map((item) => item.gap).sort((a, b) => a - b);
      const usual = quantile(yards, 0.5);
      const spread = quantile(yards, 0.75) - quantile(yards, 0.25);
      const typicalGap = quantile(gaps, 0.5);
      const unsettled = withYard.length >= 5 && spread > 20;
      if (unsettled && !showUnsettled) continue;
      const daysOver = withYard.filter((item) => Math.abs(item.gap) >= line).length;
      if (Math.abs(typicalGap) < line) continue;
      const current = withYard.at(-1);
      rows.push({
        id: `${routeKey(route)}|${piece.id}`,
        route,
        driver,
        piece: piece.id,
        pieceLabel: piece.label,
        yardKind: piece.yard,
        publishedLabel: current.publishedLabel,
        usualYard: usual,
        usualLabel: formatHabitClock(usual),
        spread: Math.round(spread),
        unsettled,
        dayCount: withYard.length,
        typicalGap: Math.round(typicalGap),
        habitPhrase: habitPhrase(piece, typicalGap),
        daysOver,
        strip: observations.slice(-15),
        observations,
      });
    }
  }
  rows.sort(
    (a, b) =>
      Math.abs(b.typicalGap) - Math.abs(a.typicalGap) ||
      b.daysOver - a.daysOver ||
      a.route.localeCompare(b.route, undefined, { numeric: true }) ||
      a.pieceLabel.localeCompare(b.pieceLabel)
  );
  return rows;
}
