/**
 * Day chart for the extra-work driver view.
 * Trip clocks are 24-hour. Route PM clocks are often written as afternoon
 * 12-hour times ("2:05-4:45"), so a PM start before noon is shifted 12 hours.
 */

const SEGMENTS = ['AM', 'MIDDAY', 'PM'];

function parseMinutes(time) {
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
export function overlapWarning(tripLabel, interval, bars) {
  const hits = overlappingBars(interval, bars);
  if (!hits.length) return '';
  const runs = hits
    .map((bar) => `${bar.label} (${formatClock(bar.start)}–${formatClock(bar.end)})`)
    .join(', ');
  return `${tripLabel} overlaps your regular ${runs}. You can still sign up if that run is changed for this day.`;
}
