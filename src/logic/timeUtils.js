// Parse a time string like "6:35" or "14:05" into minutes since midnight.
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

// Parse a route segment time range like "6:35-8:55".
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

// Exact raw minute difference between old and new route durations.
// No rounding — a genuine 7-minute shift stores as 7.
export function computeDeltaMinutes(previousTime, newTime) {
  const previous = parseTimeRange(previousTime);
  const next = parseTimeRange(newTime);
  return next.durationMinutes - previous.durationMinutes;
}

// Exact total daily scheduled duration for one route: sum of that route's own
// AM + MIDDAY + PM segment durations. Null segments are skipped. No rounding.
export function computeExactRouteDailyTotalMinutes(segments) {
  let total = 0;
  for (const key of (['AM', 'MIDDAY', 'PM'])) {
    const range = segments?.[key];
    if (!range) continue;
    total += parseTimeRange(range).durationMinutes;
  }
  return total;
}

// Snap a clock to the nearest quarter hour on the clock face.
export function roundClockToQuarterHour(clock) {
  const text = String(clock ?? '').trim();
  if (!text) return '';
  const minutes = parseClockTime(text);
  const snapped = Math.round(minutes / 15) * 15;
  return formatClockMinutesFromDay(snapped % (24 * 60));
}

function formatClockMinutesFromDay(minutesSinceMidnight) {
  const hours = Math.floor(minutesSinceMidnight / 60);
  const minutes = minutesSinceMidnight % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

// Round minutes to the nearest quarter hour for Payroll reporting only.
// Payroll rounds each run (AM, midday, PM) on its own, adds those rounded
// minutes, then rounds that sum for the contracted daily total. Never use
// this for stored deltas, cumulative drift, or threshold checks.
export function roundToQuarterHourForPayroll(minutes) {
  if (typeof minutes !== 'number' || Number.isNaN(minutes)) {
    throw new Error(`Expected a number of minutes, got: ${minutes}`);
  }
  // Normalize -0 to 0 so Payroll never sees a signed zero.
  return Math.round(minutes / 15) * 15 || 0;
}

// Full breakdown for Payroll contracted hours (and phase-4 "see the math" UI).
// Each run is rounded on its own. Those rounded minutes are added, and that
// sum is rounded again for the contracted daily total.
export function buildPayrollRoundingBreakdown(segments) {
  const detail = (['AM', 'MIDDAY', 'PM']).map((segment) => {
    const time = segments?.[segment] ?? null;
    if (!time) {
      return { segment, time: null, duration_minutes: null, rounded_minutes: null };
    }
    const duration_minutes = parseTimeRange(time).durationMinutes;
    return {
      segment,
      time,
      duration_minutes,
      rounded_minutes: roundToQuarterHourForPayroll(duration_minutes),
    };
  });

  const exact_total_minutes = computeExactRouteDailyTotalMinutes(segments);
  const rounded_piece_total = detail.reduce(
    (sum, segment) => sum + (segment.rounded_minutes ?? 0),
    0
  );
  return {
    segments: detail,
    exact_total_minutes,
    payroll_rounded_total_minutes: roundToQuarterHourForPayroll(rounded_piece_total),
  };
}

// Normalize a date string to YYYY-MM-DD for consistent comparisons.
// True when a schedule row has no start date. The calendar picker stores that as null.
export function isBlankScheduleDate(value) {
  const text = value == null ? '' : String(value).trim();
  return !text || text.toLowerCase() === 'null';
}

// Date used for contract math when a schedule row's start date is null.
// A blank date sorts with the route's established date so it stays the next row.
export function scheduleDateForMath(value, anchor) {
  const text = value == null ? '' : String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(anchor ?? ''))) return anchor;
  return toDateString(new Date());
}

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
