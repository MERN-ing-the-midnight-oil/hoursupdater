/**
 * Parse a time string like "6:35" or "14:05" into minutes since midnight.
 * @param {string} time
 * @returns {number}
 */
export function parseClockTime(time) {
  const trimmed = time.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid time format: "${time}". Expected H:MM or HH:MM.`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes < 0 || minutes > 59 || hours < 0 || hours > 23) {
    throw new Error(`Invalid time value: "${time}".`);
  }
  return hours * 60 + minutes;
}

/**
 * Parse a route segment time range like "6:35-8:55".
 * @param {string} range
 * @returns {{ startMinutes: number, endMinutes: number, durationMinutes: number }}
 */
export function parseTimeRange(range) {
  const trimmed = range.trim();
  const parts = trimmed.split('-');
  if (parts.length !== 2) {
    throw new Error(
      `Invalid time range format: "${range}". Expected "H:MM-H:MM".`
    );
  }
  const startMinutes = parseClockTime(parts[0]);
  const endMinutes = parseClockTime(parts[1]);
  if (endMinutes <= startMinutes) {
    throw new Error(
      `Invalid time range: end must be after start in "${range}".`
    );
  }
  return {
    startMinutes,
    endMinutes,
    durationMinutes: endMinutes - startMinutes,
  };
}

/**
 * Exact raw minute difference between old and new route durations.
 * No rounding — a genuine 7-minute shift stores as 7.
 * @param {string} previousTime
 * @param {string} newTime
 * @returns {number}
 */
export function computeDeltaMinutes(previousTime, newTime) {
  const previous = parseTimeRange(previousTime);
  const next = parseTimeRange(newTime);
  return next.durationMinutes - previous.durationMinutes;
}

/**
 * Exact total daily scheduled duration for one route: sum of that route's own
 * AM + MIDDAY + PM segment durations. Null segments are skipped. No rounding.
 *
 * @param {Record<'AM'|'MIDDAY'|'PM', string | null | undefined>} segments
 * @returns {number}
 */
export function computeExactRouteDailyTotalMinutes(segments) {
  let total = 0;
  for (const key of /** @type {const} */ (['AM', 'MIDDAY', 'PM'])) {
    const range = segments?.[key];
    if (!range) continue;
    total += parseTimeRange(range).durationMinutes;
  }
  return total;
}

/**
 * Round minutes to the nearest quarter hour for Payroll reporting only.
 *
 * Call this exactly once when a window is finalized, on the route's exact
 * daily total (AM+MD+PM), never on a delta/drift and never on a prior rounded
 * value. Never use for stored deltas, cumulative drift, or threshold checks.
 *
 * @param {number} minutes - exact unrounded minutes (may be negative)
 * @returns {number} nearest multiple of 15
 */
export function roundToQuarterHourForPayroll(minutes) {
  if (typeof minutes !== 'number' || Number.isNaN(minutes)) {
    throw new Error(`Expected a number of minutes, got: ${minutes}`);
  }
  // Normalize -0 to 0 so Payroll never sees a signed zero.
  return Math.round(minutes / 15) * 15 || 0;
}

/**
 * Full breakdown for Payroll contracted hours (and phase-4 "see the math" UI).
 * Rounds the exact route daily total fresh — not a delta applied to a baseline.
 *
 * @param {Record<'AM'|'MIDDAY'|'PM', string | null | undefined>} segments
 * @returns {{
 *   segments: Array<{ segment: string, time: string | null, duration_minutes: number | null }>,
 *   exact_total_minutes: number,
 *   payroll_rounded_total_minutes: number,
 * }}
 */
export function buildPayrollRoundingBreakdown(segments) {
  const detail = /** @type {const} */ (['AM', 'MIDDAY', 'PM']).map((segment) => {
    const time = segments?.[segment] ?? null;
    if (!time) {
      return { segment, time: null, duration_minutes: null };
    }
    return {
      segment,
      time,
      duration_minutes: parseTimeRange(time).durationMinutes,
    };
  });

  const exact_total_minutes = computeExactRouteDailyTotalMinutes(segments);
  return {
    segments: detail,
    exact_total_minutes,
    payroll_rounded_total_minutes: roundToQuarterHourForPayroll(exact_total_minutes),
  };
}

/**
 * Normalize a date string to YYYY-MM-DD for consistent comparisons.
 * @param {string | Date} value
 * @returns {string}
 */
export function toDateString(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: "${value}".`);
  }
  return parsed.toISOString().slice(0, 10);
}
