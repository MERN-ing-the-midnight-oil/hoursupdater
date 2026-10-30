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

// Office contract-clock snap bands (minute-of-hour cutoffs).
// :00–toHour → :00
// toHour+1–toQuarter → :15
// toQuarter+1–toHalf → :30
// toHalf+1–(toNextHour-1) → :45
// toNextHour–:59 → next hour :00
export const DEFAULT_CONTRACT_SNAP_BREAKS = Object.freeze({
  toHour: 6,
  toQuarter: 21,
  toHalf: 36,
  toNextHour: 52,
});

function clampMinuteCutoff(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(59, Math.max(0, Math.trunc(number)));
}

// Keep the four cutoffs ordered so each band is non-empty when possible.
export function normalizeContractSnapBreaks(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  let toHour = clampMinuteCutoff(source.toHour, DEFAULT_CONTRACT_SNAP_BREAKS.toHour);
  let toQuarter = clampMinuteCutoff(source.toQuarter, DEFAULT_CONTRACT_SNAP_BREAKS.toQuarter);
  let toHalf = clampMinuteCutoff(source.toHalf, DEFAULT_CONTRACT_SNAP_BREAKS.toHalf);
  let toNextHour = clampMinuteCutoff(
    source.toNextHour,
    DEFAULT_CONTRACT_SNAP_BREAKS.toNextHour
  );
  if (toQuarter <= toHour) toQuarter = Math.min(59, toHour + 1);
  if (toHalf <= toQuarter) toHalf = Math.min(59, toQuarter + 1);
  if (toNextHour <= toHalf) toNextHour = Math.min(59, toHalf + 1);
  return { toHour, toQuarter, toHalf, toNextHour };
}

// Snap one clock using the office contract bands (not nearest-quarter math).
export function snapContractClockToBreaks(clock, breaks) {
  const text = String(clock ?? '').trim();
  if (!text) return '';
  const total = parseClockTime(text);
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  const band = normalizeContractSnapBreaks(breaks);
  let snappedTotal;
  if (minute <= band.toHour) {
    snappedTotal = hour * 60;
  } else if (minute <= band.toQuarter) {
    snappedTotal = hour * 60 + 15;
  } else if (minute <= band.toHalf) {
    snappedTotal = hour * 60 + 30;
  } else if (minute < band.toNextHour) {
    snappedTotal = hour * 60 + 45;
  } else {
    snappedTotal = (hour + 1) * 60;
  }
  return formatClockMinutesFromDay(snappedTotal % (24 * 60));
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

// Snap both ends of a contract range with the office minute bands.
// Default bands turn "14:05-17:25" into "14:00-17:30". Used for official
// contracted hours when the office snaps contract clocks, and for Art. 3.08
// drift when bid/bump windows also use snapped contract times.
export function snapContractTimeRange(range, breaks) {
  const trimmed = String(range ?? '').trim();
  const parts = trimmed.split('-');
  if (parts.length !== 2) {
    throw new Error(
      `Invalid time range format: "${range}". Expected "H:MM-H:MM".`
    );
  }
  const start = snapContractClockToBreaks(parts[0], breaks);
  const end = snapContractClockToBreaks(parts[1], breaks);
  if (!start || !end) {
    throw new Error(`Invalid time range format: "${range}". Expected "H:MM-H:MM".`);
  }
  return `${start}-${end}`;
}

// Minutes used for one run when computing official contracted hours.
// With snapContractClocks, each end snaps with the office minute bands first.
function contractRunMinutesForPayroll(time, snapContractClocks, breaks) {
  const exact = parseTimeRange(time);
  if (!snapContractClocks) {
    return {
      duration_minutes: exact.durationMinutes,
      snapped_time: null,
    };
  }
  try {
    const snapped_time = snapContractTimeRange(time, breaks);
    return {
      duration_minutes: parseTimeRange(snapped_time).durationMinutes,
      snapped_time,
    };
  } catch {
    return {
      duration_minutes: exact.durationMinutes,
      snapped_time: null,
    };
  }
}

// Difference in snapped contracted daily totals between two schedules.
// Used when Art. 3.08 bid/bump windows follow snapped contract times.
export function snappedContractScheduleDeltaMinutes(
  beforeSegments,
  afterSegments,
  options = {}
) {
  const rounding = {
    snapContractClocks: true,
    contractSnapBreaks: options.contractSnapBreaks,
  };
  const before = buildPayrollRoundingBreakdown(beforeSegments || {}, rounding)
    .payroll_rounded_total_minutes;
  const after = buildPayrollRoundingBreakdown(afterSegments || {}, rounding)
    .payroll_rounded_total_minutes;
  return after - before;
}

// Full breakdown for Payroll contracted hours (and phase-4 "see the math" UI).
// Default: each run's exact duration is rounded, those minutes are added, and
// that sum is rounded again for the contracted daily total.
// When options.snapContractClocks is true, each run's start and end snap with
// the office minute bands before duration is counted, then the same per-run /
// daily rounding still applies. Exact wall-clock totals stay on
// exact_total_minutes for schedule-change copy. Art. 3.08 drift uses this only
// when bid/bump windows are set to follow snapped contract times.
export function buildPayrollRoundingBreakdown(segments, options = {}) {
  const snapContractClocks = options.snapContractClocks === true;
  const breaks = normalizeContractSnapBreaks(options.contractSnapBreaks);
  const detail = (['AM', 'MIDDAY', 'PM']).map((segment) => {
    const time = segments?.[segment] ?? null;
    if (!time) {
      return {
        segment,
        time: null,
        snapped_time: null,
        duration_minutes: null,
        rounded_minutes: null,
      };
    }
    const { duration_minutes, snapped_time } = contractRunMinutesForPayroll(
      time,
      snapContractClocks,
      breaks
    );
    return {
      segment,
      time,
      snapped_time,
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
    snap_contract_clocks: snapContractClocks,
    contract_snap_breaks: breaks,
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
