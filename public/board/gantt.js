/**
 * Day chart for the extra-work driver view.
 * Trip clocks are 24-hour. Route PM clocks are often written as afternoon
 * 12-hour times ("2:05-4:45"), so a PM start before noon is shifted 12 hours.
 */

const SEGMENTS = ['AM', 'MIDDAY', 'PM'];

export function parseMinutes(time) {
  if (time == null || time === '') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time).trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 23) return null;
  return hours * 60 + minutes;
}

/**
 * @param {string} segment
 * @param {string | null | undefined} range
 * @returns {{ start: number, end: number } | null}
 */
export function segmentInterval(segment, range) {
  if (!range) return null;
  const parts = String(range).trim().split('-');
  if (parts.length !== 2) return null;
  let start = parseMinutes(parts[0]);
  let end = parseMinutes(parts[1]);
  if (start == null || end == null || end <= start) return null;
  if (segment === 'PM' && start < 12 * 60) {
    start += 12 * 60;
    end += 12 * 60;
  }
  return { start, end };
}

/**
 * Span of a trip: earliest filled clock through the latest.
 * @param {Record<string, string> | null | undefined} times
 * @returns {{ start: number, end: number } | null}
 */
export function tripInterval(times) {
  const values = Object.values(times || {})
    .map((value) => parseMinutes(value))
    .filter((value) => value != null);
  if (values.length < 2) return null;
  const start = Math.min(...values);
  const end = Math.max(...values);
  if (end <= start) return null;
  return { start, end };
}

/**
 * @param {{ start: number, end: number }} a
 * @param {{ start: number, end: number }} b
 */
export function intervalsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function segmentName(segment) {
  if (segment === 'MIDDAY') return 'Midday';
  return segment;
}

/**
 * Open time between a driver's regular runs.
 * The first bar runs from the AM clock-out to the next clock-in.
 * When there is a midday run, a second bar runs from that clock-out to the PM clock-in.
 * @param {Array<{ segment?: string, start: number, end: number }>} bars
 * @returns {Array<{ start: number, end: number, from: string, to: string }>}
 */
const SCHOOL_NOTE_WORDS = new Set([
  'AM', 'PM', 'HR', 'HRS', 'HOUR', 'HOURS', 'MIN', 'MINIMUM', 'SHOP', 'OFFICE', 'DRIVER',
  'TRAINER', 'SIGNED', 'FOR', 'WITH', 'NO', 'CLOCK', 'LEFT', 'OUT', 'OF', 'CONTRACTED',
  'THE', 'AND', 'TO', 'ONLY', 'DAYS', 'DAY', 'WEEK', 'CONTRACT', 'RECORDED', 'SPAN',
  'NOT', 'AN', 'RUN', 'ROUTE', 'UTILITY', 'ASSIGNED', 'MISCALCULATION', 'TIME',
  'CHANGED', 'AFTER', 'NOTING', 'CHANGE', 'SHEET', 'IS', 'MD', 'ON', 'FROM', 'THIS',
  'THAT', 'WHEN', 'OR', 'BG', 'MWF', 'RET', 'SK', 'IN', 'AS', 'ONE',
]);

function schoolCodesIn(text, options = {}) {
  const source = String(text ?? '');
  const codes = [];
  for (const match of source.matchAll(/\b[A-Za-z]{2,6}\b/g)) {
    const code = match[0].toUpperCase();
    if (SCHOOL_NOTE_WORDS.has(code)) continue;
    const index = match.index ?? 0;
    const parenthetical = source[index - 1] === '(' || source[index + match[0].length] === ')';
    if (options.skipParenthetical && parenthetical) continue;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

function splitSchoolLists(note) {
  const text = String(note ?? '');
  const parts = text.split('/');
  if (parts.length < 2) return { headed: text, other: '' };
  for (let index = parts.length - 1; index >= 1; index -= 1) {
    const headed = parts.slice(0, index).join('/');
    const other = parts.slice(index).join('/');
    if (schoolCodesIn(headed).length && schoolCodesIn(other).length) {
      return { headed, other };
    }
  }
  return { headed: text, other: '' };
}

/**
 * Schools on the way out, and schools on the way back, from a route note.
 * "LOW, SHS/BHS, LOW" leaves SHS and heads to BHS next.
 * @param {string} note
 * @returns {{ AM: string[], MIDDAY: string[], PM: string[] }}
 */
export function runSchoolLists(note) {
  if (note && typeof note === 'object') {
    const list = (value) => (Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : []);
    return { AM: list(note.AM), MIDDAY: list(note.MIDDAY), PM: list(note.PM) };
  }
  const { headed, other } = splitSchoolLists(note);
  return {
    AM: schoolCodesIn(headed, { skipParenthetical: true }),
    MIDDAY: [],
    PM: schoolCodesIn(other, { skipParenthetical: true }),
  };
}

/**
 * The school a free-time gap leaves, and the school it heads toward.
 * @param {{ from?: string, to?: string }} window
 * @param {{ AM?: string[], MIDDAY?: string[], PM?: string[] }} lists
 */
export function schoolsForWindow(window, lists) {
  const fromList = lists?.[window?.from] || [];
  const toList = lists?.[window?.to] || [];
  return {
    fromSchool: fromList.length ? fromList[fromList.length - 1] : '',
    toSchool: toList[0] || '',
  };
}

/**
 * A utility assignment is one day the district fills, not an AM run and a PM run.
 * @param {string | null | undefined} routeId
 */
export function isUtilityRoute(routeId) {
  return /^utility\b/i.test(String(routeId || '').trim());
}

/**
 * Route clocks that are regular AM, midday, and PM runs.
 * A utility span is left out. It is not a run a trip has to fit around.
 * @param {Array<{ route_id: string, segments?: Record<string, string | null> }>} schedules
 */
export function regularRouteBars(schedules) {
  return routeBars(schedules).filter((bar) => !isUtilityRoute(bar.route_id));
}

/**
 * Time that is not a gap after a clock-out.
 * A utility driver has one contracted day. A driver with no route clocks has
 * no clock-out either. A driver who has regular runs returns null.
 * @param {Array<{ route_id: string, segments?: Record<string, string | null> }>} schedules
 * @returns {{ kind: 'utility' | 'open', label: string, start: number | null, end: number | null } | null}
 */
export function openDuty(schedules) {
  const bars = routeBars(schedules);
  const regular = bars.filter((bar) => !isUtilityRoute(bar.route_id));
  if (regular.length) return null;
  const utility = bars.filter((bar) => isUtilityRoute(bar.route_id));
  if (utility.length) {
    return {
      kind: 'utility',
      label: 'Utility Driver',
      start: Math.min(...utility.map((bar) => bar.start)),
      end: Math.max(...utility.map((bar) => bar.end)),
    };
  }
  return { kind: 'open', label: 'No regular route', start: null, end: null };
}

/**
 * Cut awarded work out of free-time windows. A block that covers the middle
 * leaves the time before it and the time after it.
 * @param {Array<{ start: number, end: number, fromSchool?: string, toSchool?: string }>} windows
 * @param {Array<{ start: number, end: number }>} blocks
 */
export function subtractIntervals(windows, blocks) {
  let open = (windows || []).map((window) => ({ ...window }));
  for (const block of blocks || []) {
    if (!block || block.end <= block.start) continue;
    const next = [];
    for (const window of open) {
      if (block.end <= window.start || block.start >= window.end) {
        next.push(window);
        continue;
      }
      if (block.start > window.start) {
        next.push({ ...window, end: block.start, toSchool: '' });
      }
      if (block.end < window.end) {
        next.push({ ...window, start: block.end, fromSchool: '' });
      }
    }
    open = next;
  }
  return open.filter((window) => window.end > window.start);
}

export function freeWindows(bars) {
  const spans = ['AM', 'MIDDAY', 'PM'].map((segment) => {
    const matches = (bars || []).filter((bar) => bar.segment === segment);
    if (!matches.length) return null;
    return {
      segment,
      start: Math.min(...matches.map((bar) => bar.start)),
      end: Math.max(...matches.map((bar) => bar.end)),
    };
  }).filter(Boolean);
  const windows = [];
  for (let index = 0; index < spans.length - 1; index += 1) {
    const current = spans[index];
    const next = spans[index + 1];
    if (next.start <= current.end) continue;
    windows.push({
      start: current.end,
      end: next.start,
      from: current.segment,
      to: next.segment,
    });
  }
  return windows;
}

/**
 * @param {Array<{ route_id: string, segments?: Record<string, string | null> }>} schedules
 */
export function routeBars(schedules) {
  const bars = [];
  for (const schedule of schedules || []) {
    const segments = schedule.segments || {};
    for (const segment of SEGMENTS) {
      const range = segments[segment];
      const interval = segmentInterval(segment, range);
      if (!interval) continue;
      bars.push({
        route_id: schedule.route_id,
        segment,
        range,
        start: interval.start,
        end: interval.end,
        label: `${schedule.route_id} ${segmentName(segment)}`,
      });
    }
  }
  return bars;
}

/**
 * @param {{ start: number, end: number } | null} interval
 * @param {Array<{ start: number, end: number }>} bars
 */
export function overlappingBars(interval, bars) {
  if (!interval) return [];
  return (bars || []).filter((bar) => intervalsOverlap(interval, bar));
}

/**
 * @param {Array<{ start: number, end: number } | null | undefined>} intervals
 * @returns {{ start: number, end: number }}
 */
export function chartAxis(intervals) {
  let start = 5 * 60;
  let end = 19 * 60;
  for (const item of intervals || []) {
    if (!item) continue;
    start = Math.min(start, item.start);
    end = Math.max(end, item.end);
  }
  start = Math.floor(start / 60) * 60;
  end = Math.ceil(end / 60) * 60;
  if (end <= start) end = start + 60;
  return { start, end };
}

/**
 * Hour marks that cover the trips on the board.
 * An empty board uses a school-day span.
 * @param {Array<{ start: number, end: number } | null | undefined>} intervals
 * @returns {{ start: number, end: number }}
 */
export function contentAxis(intervals) {
  const items = (intervals || []).filter(
    (item) => item && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start
  );
  if (!items.length) return { start: 6 * 60, end: 16 * 60 };
  let start = Math.floor(Math.min(...items.map((item) => item.start)) / 60) * 60;
  let end = Math.ceil(Math.max(...items.map((item) => item.end)) / 60) * 60;
  start = Math.max(0, start);
  end = Math.min(24 * 60, end);
  if (end <= start) end = Math.min(24 * 60, start + 60);
  return { start, end };
}

/**
 * Keep the part of an interval that sits on the axis.
 * @param {{ start: number, end: number } | null | undefined} interval
 * @param {{ start: number, end: number }} axis
 * @returns {{ start: number, end: number } | null}
 */
export function clipInterval(interval, axis) {
  if (!interval || !axis) return null;
  const start = Math.max(interval.start, axis.start);
  const end = Math.min(interval.end, axis.end);
  if (end <= start) return null;
  return { start, end };
}

/** @param {number} minutes */
export function formatClock(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = ((minutes % 60) + 60) % 60;
  const mer = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${mer}`;
}

/**
 * @param {{ start: number, end: number }} interval
 * @param {{ start: number, end: number }} axis
 */
export function barPercents(interval, axis) {
  const span = axis.end - axis.start || 1;
  return {
    left: ((interval.start - axis.start) / span) * 100,
    width: ((interval.end - interval.start) / span) * 100,
  };
}

/**
 * @param {string} tripLabel
 * @param {{ start: number, end: number } | null} interval
 * @param {Array<{ label: string, start: number, end: number }>} bars
 */
/**
 * Lane index for each interval so overlapping bars stack instead of covering each other.
 * @param {Array<{ start: number, end: number }>} items
 * @returns {number[]}
 */
export function packLanes(items) {
  const order = (items || []).map((item, index) => ({ item, index }));
  order.sort(
    (a, b) => a.item.start - b.item.start || a.item.end - b.item.end || a.index - b.index
  );
  const laneEnds = [];
  const lanes = new Array(order.length);
  for (const entry of order) {
    let lane = laneEnds.findIndex((end) => end <= entry.item.start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(entry.item.end);
    } else {
      laneEnds[lane] = entry.item.end;
    }
    lanes[entry.index] = lane;
  }
  return lanes;
}

/**
 * Monday of the civil week that contains this YYYY-MM-DD date.
 * @param {string} iso
 * @returns {string}
 */
export function mondayOf(iso) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  const shift = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + shift);
  return date.toISOString().slice(0, 10);
}

/**
 * @param {string} iso
 * @param {number} days
 * @returns {string}
 */
export function addIsoDays(iso, days) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** @param {string} monday */
export function weekDates(monday) {
  return [0, 1, 2, 3, 4, 5, 6].map((offset) => addIsoDays(monday, offset));
}

/** Monday through Friday of that week. */
export function weekdayDates(monday) {
  return weekDates(monday).slice(0, 5);
}

export function overlapWarning(tripLabel, interval, bars) {
  const hits = overlappingBars(interval, bars);
  if (!hits.length) return '';
  const runs = hits
    .map((bar) => `${bar.label} (${formatClock(bar.start)}–${formatClock(bar.end)})`)
    .join(', ');
  return `${tripLabel} overlaps your regular ${runs}. You can still sign up if that run is changed for this day.`;
}
