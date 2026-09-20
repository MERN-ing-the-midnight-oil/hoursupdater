// src/logic/constants.js
var BID_THRESHOLD_MINUTES = 30;
var BUMP_DECISION_SCHOOL_DAYS = 2;
var BID_RESPONSE_SCHOOL_DAYS = 2;
var SEGMENTS = ["AM", "MIDDAY", "PM"];

// src/logic/createId.js
function createId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === "x" ? random : random & 3 | 8;
    return value.toString(16);
  });
}

// src/logic/timeUtils.js
function parseClockTime(time) {
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
function parseTimeRange(range) {
  const trimmed = range.trim();
  const parts = trimmed.split("-");
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
    durationMinutes: endMinutes - startMinutes
  };
}
function computeDeltaMinutes(previousTime, newTime) {
  const previous = parseTimeRange(previousTime);
  const next = parseTimeRange(newTime);
  return next.durationMinutes - previous.durationMinutes;
}
function computeExactRouteDailyTotalMinutes(segments) {
  let total = 0;
  for (
    const key of
    /** @type {const} */
    ["AM", "MIDDAY", "PM"]
  ) {
    const range = segments?.[key];
    if (!range) continue;
    total += parseTimeRange(range).durationMinutes;
  }
  return total;
}
function roundToQuarterHourForPayroll(minutes) {
  if (typeof minutes !== "number" || Number.isNaN(minutes)) {
    throw new Error(`Expected a number of minutes, got: ${minutes}`);
  }
  return Math.round(minutes / 15) * 15 || 0;
}
function buildPayrollRoundingBreakdown(segments) {
  const detail = (
    /** @type {const} */
    ["AM", "MIDDAY", "PM"].map((segment) => {
      const time = segments?.[segment] ?? null;
      if (!time) {
        return { segment, time: null, duration_minutes: null };
      }
      return {
        segment,
        time,
        duration_minutes: parseTimeRange(time).durationMinutes
      };
    })
  );
  const exact_total_minutes = computeExactRouteDailyTotalMinutes(segments);
  return {
    segments: detail,
    exact_total_minutes,
    payroll_rounded_total_minutes: roundToQuarterHourForPayroll(exact_total_minutes)
  };
}
function toDateString(value) {
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

// src/logic/schoolCalendarGenerate.js
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];
function assertDate(day, label = "date") {
  if (typeof day !== "string" || !DATE_RE.test(day.trim())) {
    throw new Error(`Invalid ${label}: ${day}`);
  }
  const normalized = day.trim();
  const parsed = /* @__PURE__ */ new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`Invalid ${label}: ${day}`);
  }
  return normalized;
}
function utcDate(iso) {
  return /* @__PURE__ */ new Date(`${iso}T00:00:00.000Z`);
}
function isoFromUtc(d) {
  return d.toISOString().slice(0, 10);
}
function dayOfWeekName(iso) {
  return WEEKDAY_NAMES[utcDate(iso).getUTCDay()];
}
function defaultCoverageWindow(firstDay, lastDay) {
  const first = utcDate(firstDay);
  const last = utcDate(lastDay);
  const firstYear = first.getUTCFullYear();
  const lastYear = last.getUTCFullYear();
  const coverage_start = first.getUTCMonth() >= 6 ? `${firstYear}-07-01` : `${firstYear - 1}-07-01`;
  const coverage_end = last.getUTCMonth() <= 5 ? `${lastYear}-06-30` : `${lastYear + 1}-06-30`;
  if (coverage_end < coverage_start) {
    throw new Error("Computed coverage window is inverted \u2014 check first/last day.");
  }
  return {
    coverage_start,
    coverage_end,
    boundary_rule: "July 1 on or before first day of school through June 30 on or after last day of school (matches district year files). Outside that window is not generated."
  };
}
function validateGenerateSchoolYearInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Generation input is required.");
  }
  const first_day = assertDate(input.first_day, "first day of school");
  const last_day = assertDate(input.last_day, "last day of school");
  if (last_day < first_day) {
    throw new Error("Last day of school must be on or after the first day.");
  }
  const breaks = [];
  for (const raw of input.breaks ?? []) {
    if (!raw || typeof raw !== "object") {
      throw new Error("Each break must be an object with start and end.");
    }
    const start = assertDate(raw.start, "break start");
    const end = assertDate(raw.end, "break end");
    if (end < start) {
      throw new Error(`Break end ${end} is before start ${start}.`);
    }
    breaks.push({
      start,
      end,
      label: typeof raw.label === "string" ? raw.label.trim() : ""
    });
  }
  const holidays = [];
  const holidaySeen = /* @__PURE__ */ new Set();
  for (const raw of input.holidays ?? []) {
    if (!raw || typeof raw !== "object") {
      throw new Error("Each holiday must be an object with date.");
    }
    const date = assertDate(raw.date, "holiday date");
    if (holidaySeen.has(date)) {
      throw new Error(`Duplicate holiday date: ${date}`);
    }
    holidaySeen.add(date);
    holidays.push({
      date,
      label: typeof raw.label === "string" ? raw.label.trim() : ""
    });
  }
  let school_year = null;
  if (input.school_year != null && String(input.school_year).trim()) {
    school_year = String(input.school_year).trim();
  } else {
    const startY = utcDate(first_day).getUTCFullYear();
    const endY = utcDate(last_day).getUTCFullYear();
    school_year = startY === endY ? String(startY) : `${startY}-${String(endY).slice(-2)}`;
  }
  return { first_day, last_day, breaks, holidays, school_year };
}
function generateSchoolYearCalendar(rawInput) {
  const input = validateGenerateSchoolYearInput(rawInput);
  const coverage = defaultCoverageWindow(input.first_day, input.last_day);
  const holidayByDate = new Map(
    input.holidays.map((h) => [h.date, { label: h.label || "Holiday" }])
  );
  const days = [];
  let cursor = utcDate(coverage.coverage_start);
  const end = utcDate(coverage.coverage_end);
  let school_day_count = 0;
  let weekend_count = 0;
  let break_day_count = 0;
  let holiday_day_count = 0;
  let summer_day_count = 0;
  while (cursor <= end) {
    const date = isoFromUtc(cursor);
    const dow = cursor.getUTCDay();
    const day_of_week = dayOfWeekName(date);
    const inSchoolYear = date >= input.first_day && date <= input.last_day;
    let entry;
    if (!inSchoolYear) {
      entry = {
        date,
        day_of_week,
        is_school_day: false,
        reason: "Outside school year (summer)"
      };
      summer_day_count += 1;
    } else if (dow === 0 || dow === 6) {
      entry = {
        date,
        day_of_week,
        is_school_day: false,
        reason: "Weekend"
      };
      weekend_count += 1;
    } else {
      const holiday = holidayByDate.get(date);
      const breakHit = input.breaks.find((b) => date >= b.start && date <= b.end);
      if (holiday) {
        entry = {
          date,
          day_of_week,
          is_school_day: false,
          reason: holiday.label
        };
        holiday_day_count += 1;
      } else if (breakHit) {
        entry = {
          date,
          day_of_week,
          is_school_day: false,
          reason: breakHit.label || "Break"
        };
        break_day_count += 1;
      } else {
        entry = {
          date,
          day_of_week,
          is_school_day: true,
          reason: ""
        };
        school_day_count += 1;
      }
    }
    days.push(entry);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const school_days = days.filter((d) => d.is_school_day).map((d) => d.date);
  return {
    calendar: {
      school_year: input.school_year,
      coverage_start: coverage.coverage_start,
      coverage_end: coverage.coverage_end,
      days,
      school_days
    },
    summary: {
      first_day: input.first_day,
      last_day: input.last_day,
      school_day_count,
      weekend_count,
      break_day_count,
      holiday_day_count,
      summer_day_count,
      civil_day_count: days.length,
      breaks_applied: input.breaks.map((b) => ({
        start: b.start,
        end: b.end,
        label: b.label || "Break"
      })),
      holidays_applied: input.holidays.map((h) => ({
        date: h.date,
        label: h.label || "Holiday"
      }))
    },
    coverage_boundary: coverage
  };
}

// employee-tracker/src/bpsCalendar2026.js
var BPS_2026_2027_SOURCE = {
  name: "Boston Public Schools",
  school_year: "2026-2027",
  document: "SY26-27 BPS District Calendar",
  url: "https://www.bostonpublicschools.org"
};
var BPS_2026_2027_INPUT = {
  school_year: "2026-2027",
  first_day: "2026-09-08",
  last_day: "2027-06-22",
  breaks: [
    { start: "2026-11-26", end: "2026-11-27", label: "Thanksgiving Recess" },
    { start: "2026-12-24", end: "2027-01-01", label: "Winter Recess" },
    { start: "2027-02-16", end: "2027-02-19", label: "February Recess" },
    { start: "2027-04-20", end: "2027-04-23", label: "Spring Recess" }
  ],
  holidays: [
    { date: "2026-09-07", label: "Labor Day" },
    { date: "2026-10-12", label: "Indigenous Peoples\u2019 Day" },
    { date: "2026-11-11", label: "Veterans Day" },
    { date: "2027-01-04", label: "Teachers/paras report (students off)" },
    { date: "2027-01-18", label: "Martin Luther King Jr. Day" },
    { date: "2027-02-15", label: "Presidents\u2019 Day" },
    { date: "2027-03-26", label: "Good Friday" },
    { date: "2027-04-19", label: "Patriots\u2019 Day" },
    { date: "2027-05-31", label: "Memorial Day" },
    { date: "2027-06-18", label: "Juneteenth (observed)" }
  ]
};
function buildBps2026_2027Calendar() {
  const { calendar, summary } = generateSchoolYearCalendar(BPS_2026_2027_INPUT);
  return {
    calendar: {
      ...calendar,
      district: BPS_2026_2027_SOURCE.name,
      source_document: BPS_2026_2027_SOURCE.document
    },
    summary,
    source: BPS_2026_2027_SOURCE
  };
}

// employee-tracker/src/clockTimes.js
function normalizeClockTime(time) {
  const minutes = parseClockTime(String(time ?? "").trim());
  return formatClockMinutes(minutes);
}
function formatClockMinutes(minutesSinceMidnight) {
  if (typeof minutesSinceMidnight !== "number" || Number.isNaN(minutesSinceMidnight) || minutesSinceMidnight < 0 || minutesSinceMidnight >= 24 * 60) {
    throw new Error(`Invalid minutes value: ${minutesSinceMidnight}`);
  }
  const hours = Math.floor(minutesSinceMidnight / 60);
  const minutes = minutesSinceMidnight % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}
function formatSegmentRange(clockIn, clockOut) {
  return `${normalizeClockTime(clockIn)}-${normalizeClockTime(clockOut)}`;
}
function splitSegmentRange(range) {
  if (!range || !String(range).trim()) {
    return null;
  }
  const parsed = parseTimeRange(range);
  return {
    clock_in: formatClockMinutes(parsed.startMinutes),
    clock_out: formatClockMinutes(parsed.endMinutes),
    range: `${formatClockMinutes(parsed.startMinutes)}-${formatClockMinutes(parsed.endMinutes)}`,
    duration_minutes: parsed.durationMinutes
  };
}
function formatDurationLabel(minutes) {
  if (typeof minutes !== "number" || Number.isNaN(minutes)) {
    return "\u2014";
  }
  const sign = minutes < 0 ? "\u2212" : "";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  if (hours === 0) {
    return `${sign}${mins} min`;
  }
  if (mins === 0) {
    return `${sign}${hours} hr`;
  }
  return `${sign}${hours} hr ${mins} min`;
}
function dayAfter(iso) {
  const parsed = /* @__PURE__ */ new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${iso}`);
  }
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}
function localDateString(date = /* @__PURE__ */ new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// src/logic/calendar.js
function getSchoolDays(calendarOrDays) {
  if (Array.isArray(calendarOrDays)) {
    if (calendarOrDays.length === 0) {
      throw new Error("School calendar must include school days.");
    }
    if (typeof calendarOrDays[0] === "string") {
      return [...calendarOrDays].map(toDateString).sort();
    }
    return extractSchoolDaysFromDayList(
      /** @type {SchoolCalendarDay[]} */
      calendarOrDays
    );
  }
  if (Array.isArray(calendarOrDays?.days) && calendarOrDays.days.length > 0) {
    return extractSchoolDaysFromDayList(calendarOrDays.days);
  }
  const legacy = calendarOrDays?.school_days;
  if (!Array.isArray(legacy) || legacy.length === 0) {
    throw new Error(
      "School calendar must include a non-empty days[] (with is_school_day) or school_days[] array."
    );
  }
  return [...legacy].map(toDateString).sort();
}
function extractSchoolDaysFromDayList(days) {
  const schoolDays = days.filter((entry) => entry && entry.is_school_day === true && entry.date).map((entry) => toDateString(entry.date));
  if (schoolDays.length === 0) {
    throw new Error(
      "School calendar days[] has no entries with is_school_day: true."
    );
  }
  return [...new Set(schoolDays)].sort();
}
function addSchoolDays(calendarOrDays, fromDate, count) {
  if (count < 0) {
    throw new Error("School day count must be non-negative.");
  }
  if (count === 0) {
    return toDateString(fromDate);
  }
  const schoolDays = getSchoolDays(calendarOrDays);
  const start = toDateString(fromDate);
  let remaining = count;
  for (const day of schoolDays) {
    if (day <= start) {
      continue;
    }
    remaining -= 1;
    if (remaining === 0) {
      return day;
    }
  }
  const last = schoolDays[schoolDays.length - 1] ?? "(empty)";
  throw new Error(
    `School calendar ends at ${last}; cannot count ${count} school day(s) after ${start} (only ${count - remaining} available). Extend school-calendar.json coverage.`
  );
}
function daysRemainingInWindow(calendarOrDays, asOfDate, windowExpiresDate) {
  if (!windowExpiresDate) {
    return null;
  }
  const today = toDateString(asOfDate);
  const expires = toDateString(windowExpiresDate);
  if (today > expires) {
    return 0;
  }
  const schoolDays = getSchoolDays(calendarOrDays);
  return schoolDays.filter((day) => day >= today && day <= expires).length;
}
function isWindowExpired(asOfDate, windowExpiresDate) {
  if (!windowExpiresDate) {
    return false;
  }
  return toDateString(asOfDate) > toDateString(windowExpiresDate);
}

// src/logic/changeReport.js
function buildSeeTheMathFromSegments(before_segments, after_segments) {
  const before = buildPayrollRoundingBreakdown(before_segments);
  const after = buildPayrollRoundingBreakdown(after_segments);
  const contracted_hours_delta_minutes = after.payroll_rounded_total_minutes - before.payroll_rounded_total_minutes;
  const contracted_hours_changed = contracted_hours_delta_minutes !== 0;
  const schedule_changed = before.exact_total_minutes !== after.exact_total_minutes;
  let statement;
  if (contracted_hours_changed) {
    const sign = contracted_hours_delta_minutes > 0 ? "+" : "";
    statement = `Contracted hours changed by ${sign}${contracted_hours_delta_minutes} minutes (${before.payroll_rounded_total_minutes} \u2192 ${after.payroll_rounded_total_minutes}).`;
  } else if (schedule_changed) {
    statement = `Schedule changed (exact total ${before.exact_total_minutes} \u2192 ${after.exact_total_minutes} minutes), but contracted hours did not change because both totals round to the same quarter-hour figure (${after.payroll_rounded_total_minutes} minutes).`;
  } else {
    statement = `Contracted hours unchanged at ${after.payroll_rounded_total_minutes} minutes (schedule total also unchanged).`;
  }
  return {
    before,
    after,
    statement,
    contracted_hours_changed,
    contracted_hours_delta_minutes
  };
}
function buildChangeReport(input) {
  const math = buildSeeTheMathFromSegments(
    input.before_segments,
    input.after_segments
  );
  const changes = input.contributing_changes.map((change) => ({
    id: change.id,
    start_date: change.effective_date,
    segment: change.segment,
    previous_time: change.previous_time,
    new_time: change.new_time,
    delta_minutes: typeof change.effective_delta_minutes === "number" ? change.effective_delta_minutes : change.delta_minutes,
    entered_by: change.entered_by,
    note: change.note
  }));
  return {
    id: createId(),
    route_id: input.route_id,
    driver_name: input.driver_name?.trim() || null,
    driver_id: input.driver_id ?? null,
    outcome: input.outcome,
    finalized_at: input.finalized_at,
    window_opened_date: input.window_opened_date,
    contributing_changes: changes,
    before: {
      segments: input.before_segments,
      math: math.before
    },
    after: {
      segments: input.after_segments,
      math: math.after
    },
    contracted_hours_changed: math.contracted_hours_changed,
    contracted_hours_delta_minutes: math.contracted_hours_delta_minutes,
    contracted_hours_statement: math.statement,
    // Alias for the shared "see the math" UI (after-state is the finalized schedule).
    see_the_math: {
      before: math.before,
      after: math.after,
      statement: math.statement
    }
  };
}

// src/logic/stateMachine.js
function isAdjustmentEvent(entry) {
  return entry?.type === "ADJUSTMENT";
}
function isReassignmentEvent(entry) {
  return entry?.type === "REASSIGNMENT";
}
function isBulkImportEvent(entry) {
  return entry?.type === "BULK_IMPORT";
}
function isNeedsReviewResolutionEvent(entry) {
  return entry?.type === "NEEDS_REVIEW_RESOLUTION";
}
function isBumpDecisionEvent(entry) {
  return entry?.type === "BUMP_DECISION";
}
function isSeniorityTieResolutionEvent(entry) {
  return entry?.type === "SENIORITY_TIE_RESOLUTION";
}
function isChangeEvent(entry) {
  return !isAdjustmentEvent(entry) && !isReassignmentEvent(entry) && !isBulkImportEvent(entry) && !isNeedsReviewResolutionEvent(entry) && !isBumpDecisionEvent(entry) && !isSeniorityTieResolutionEvent(entry);
}
function resolutionMatchesDiscrepancy(resolution, discrepancy) {
  return (resolution.causing_adjustment_id ?? null) === (discrepancy.causing_adjustment_id ?? null) && resolution.previous_finalized_status === discrepancy.previous_finalized_status && resolution.computed_status === discrepancy.computed_status;
}
function findMatchingNeedsReviewResolution(changeLog, routeId, discrepancy) {
  const matches = changeLog.filter(isNeedsReviewResolutionEvent).map((entry) => (
    /** @type {NeedsReviewResolutionEvent} */
    entry
  )).filter((entry) => entry.route_id === routeId).filter((entry) => resolutionMatchesDiscrepancy(entry, discrepancy)).sort((a, b) => a.resolved_at.localeCompare(b.resolved_at));
  return matches.at(-1) ?? null;
}
function resolveDriverAssignment(changeLog, routeId, asOfTimestamp) {
  let best = {
    found: false,
    driver_id: null,
    driver_name: null,
    at: null
  };
  for (const entry of changeLog) {
    if (isChangeEvent(entry)) {
      const change = (
        /** @type {ChangeEvent} */
        entry
      );
      if (change.route_id !== routeId) continue;
      const at = change.submitted_at;
      if (!at || at > asOfTimestamp) continue;
      if (!best.at || at >= best.at) {
        best = {
          found: true,
          driver_id: change.driver_id ?? null,
          driver_name: change.driver_name?.trim() || null,
          at
        };
      }
      continue;
    }
    if (isReassignmentEvent(entry)) {
      const reassignment = (
        /** @type {ReassignmentEvent} */
        entry
      );
      if (reassignment.route_id !== routeId) continue;
      const at = reassignment.reassigned_at;
      if (!at || at > asOfTimestamp) continue;
      if (!best.at || at >= best.at) {
        best = {
          found: true,
          driver_id: reassignment.new_driver_id ?? null,
          driver_name: reassignment.new_driver_name?.trim() || null,
          at
        };
      }
    }
  }
  return best;
}
function asOfInclusiveTimestamp(asOfDate) {
  if (asOfDate instanceof Date) {
    return asOfDate.toISOString();
  }
  const trimmed = String(asOfDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T23:59:59.999Z`;
  }
  return new Date(trimmed).toISOString();
}
function applyResolvedDrivers(routeStateMap, changeLog, asOfDate) {
  const asOfIso = asOfInclusiveTimestamp(asOfDate);
  const updated = {};
  for (const [routeId, entry] of Object.entries(routeStateMap)) {
    const resolved = resolveDriverAssignment(changeLog, routeId, asOfIso);
    if (!resolved.found) {
      updated[routeId] = entry;
      continue;
    }
    updated[routeId] = {
      ...cloneRouteState(entry),
      driver_id: resolved.driver_id,
      driver_name: resolved.driver_name
    };
  }
  return updated;
}
function emptySegments() {
  return { AM: null, MIDDAY: null, PM: null };
}
function cloneRouteState(routeState) {
  return {
    ...routeState,
    segments: { ...routeState.segments },
    baseline_segments: { ...routeState.baseline_segments },
    contributing_change_ids: [...routeState.contributing_change_ids],
    pending_change_ids: [...routeState.pending_change_ids ?? []],
    review_history: [...routeState.review_history ?? []],
    change_reports: [...routeState.change_reports ?? []],
    reconciliation: routeState.reconciliation ? { ...routeState.reconciliation } : null
  };
}
function createInitialRouteState(changeEvent) {
  const segments = emptySegments();
  const baseline_segments = emptySegments();
  segments[changeEvent.segment] = changeEvent.previous_time;
  baseline_segments[changeEvent.segment] = changeEvent.previous_time;
  return {
    driver_name: changeEvent.driver_name?.trim() || null,
    driver_id: changeEvent.driver_id ?? null,
    segments,
    baseline_segments,
    status: "STABLE",
    window_opened_date: null,
    window_expires_date: null,
    cumulative_drift_minutes: 0,
    contributing_change_ids: [],
    payroll_rounded_total_minutes: null,
    bump_decision_due_date: null,
    bump_chain_id: null,
    bump_chain_link: null,
    bump_kind: null,
    bid_response_due_date: null,
    bid_signup: null,
    reconciliation: null,
    pending_change_ids: [],
    review_history: [],
    change_reports: [],
    last_updated: changeEvent.submitted_at
  };
}
function windowFinalizationOutcome(exactDrift) {
  if (Math.abs(exactDrift) < BID_THRESHOLD_MINUTES) {
    return "STABLE";
  }
  return exactDrift > 0 ? "BID_PENDING" : "BUMP_ELIGIBLE";
}
function applyWindowExpiration(routeState, asOfDate, options = {}) {
  if (routeState.status !== "ACCUMULATING" && routeState.status !== "BID_PENDING" && routeState.status !== "BUMP_ELIGIBLE") {
    return routeState;
  }
  if (!isWindowExpired(asOfDate, routeState.window_expires_date)) {
    return routeState;
  }
  const state = cloneRouteState(routeState);
  const exactDrift = state.cumulative_drift_minutes;
  const payrollBreakdown = buildPayrollRoundingBreakdown(state.segments);
  const payrollRoundedTotal = payrollBreakdown.payroll_rounded_total_minutes;
  const outcome = windowFinalizationOutcome(exactDrift);
  if (options.changeLog && options.routeId) {
    const effectiveDeltas = options.effectiveDeltas ?? resolveEffectiveDeltas(options.changeLog);
    const byId = /* @__PURE__ */ new Map();
    for (const entry of options.changeLog) {
      if (isChangeEvent(entry)) {
        byId.set(
          entry.id,
          /** @type {ChangeEvent} */
          entry
        );
      }
    }
    const contributing_changes = state.contributing_change_ids.map((id) => {
      const change = byId.get(id);
      if (!change) return null;
      return {
        ...change,
        effective_delta_minutes: effectiveDeltas.has(id) ? effectiveDeltas.get(id) : change.delta_minutes
      };
    }).filter(Boolean);
    const finalized_at = asOfDate instanceof Date ? asOfDate.toISOString() : `${toDateString(asOfDate)}T00:00:00.000Z`;
    const resolved = resolveDriverAssignment(
      options.changeLog,
      options.routeId,
      finalized_at
    );
    const reportDriverName = resolved.found ? resolved.driver_name : state.driver_name;
    const reportDriverId = resolved.found ? resolved.driver_id : state.driver_id ?? null;
    const report = buildChangeReport({
      route_id: options.routeId,
      driver_name: reportDriverName,
      driver_id: reportDriverId,
      outcome,
      finalized_at,
      window_opened_date: state.window_opened_date,
      before_segments: { ...state.baseline_segments },
      after_segments: { ...state.segments },
      contributing_changes
    });
    state.change_reports = [...state.change_reports ?? [], report];
    if (resolved.found) {
      state.driver_id = resolved.driver_id;
      state.driver_name = resolved.driver_name;
    }
  }
  if (outcome === "STABLE") {
    state.baseline_segments = { ...state.segments };
    state.status = "STABLE";
    state.payroll_rounded_total_minutes = payrollRoundedTotal;
    state.cumulative_drift_minutes = 0;
    state.window_opened_date = null;
    state.window_expires_date = null;
    state.contributing_change_ids = [];
    state.bump_decision_due_date = null;
    state.bump_chain_id = null;
    state.bump_chain_link = null;
    state.bump_kind = null;
    state.bid_response_due_date = null;
    state.bid_signup = null;
  } else if (outcome === "BID_PENDING") {
    state.status = "BID_PENDING";
    state.payroll_rounded_total_minutes = payrollRoundedTotal;
    state.window_opened_date = null;
    state.window_expires_date = null;
    state.bump_decision_due_date = null;
    state.bump_chain_id = null;
    state.bump_chain_link = null;
    state.bump_kind = null;
    if (options.schoolCalendar) {
      state.bid_response_due_date = addSchoolDays(
        options.schoolCalendar,
        asOfDate,
        BID_RESPONSE_SCHOOL_DAYS
      );
    } else {
      state.bid_response_due_date = null;
    }
  } else {
    state.status = "BUMP_ELIGIBLE";
    state.payroll_rounded_total_minutes = payrollRoundedTotal;
    state.window_opened_date = null;
    state.window_expires_date = null;
    if (options.schoolCalendar) {
      state.bump_decision_due_date = addSchoolDays(
        options.schoolCalendar,
        asOfDate,
        BUMP_DECISION_SCHOOL_DAYS
      );
    } else {
      state.bump_decision_due_date = null;
    }
    state.bid_response_due_date = null;
  }
  return state;
}
function hasOpenAccumulationWindow(routeState, asOfDate) {
  if (routeState.status !== "ACCUMULATING" && routeState.status !== "BID_PENDING" && routeState.status !== "BUMP_ELIGIBLE") {
    return false;
  }
  return !!routeState.window_expires_date && !isWindowExpired(asOfDate, routeState.window_expires_date);
}
function resolveEffectiveDeltas(changeLog) {
  const deltas = /* @__PURE__ */ new Map();
  for (const entry of changeLog) {
    if (isChangeEvent(entry)) {
      const change = (
        /** @type {ChangeEvent} */
        entry
      );
      deltas.set(change.id, change.delta_minutes);
    }
  }
  const adjustments = changeLog.filter(isAdjustmentEvent).map((entry) => (
    /** @type {AdjustmentEvent} */
    entry
  )).sort((a, b) => a.adjusted_at.localeCompare(b.adjusted_at));
  for (const adjustment of adjustments) {
    deltas.set(adjustment.target_change_id, adjustment.new_delta);
  }
  return deltas;
}
function applyChangeToRoute(routeState, changeEvent, schoolCalendar, asOfDate = changeEvent.effective_date, deltaOverride = void 0, options = {}) {
  const changeDate = toDateString(asOfDate);
  const isFirstEvent = !routeState;
  let state = routeState ? cloneRouteState(routeState) : createInitialRouteState(changeEvent);
  state = applyWindowExpiration(state, changeDate, {
    routeId: changeEvent.route_id,
    changeLog: options.changeLog,
    effectiveDeltas: options.effectiveDeltas,
    schoolCalendar
  });
  state.driver_name = changeEvent.driver_name?.trim() || null;
  if (changeEvent.driver_id) {
    state.driver_id = changeEvent.driver_id;
  } else if (isFirstEvent) {
    state.driver_id = null;
  }
  state.segments[changeEvent.segment] = changeEvent.new_time;
  state.last_updated = changeEvent.submitted_at;
  const delta = typeof deltaOverride === "number" ? deltaOverride : changeEvent.delta_minutes;
  if (delta === 0 && changeEvent.previous_time === changeEvent.new_time) {
    if (state.status === "STABLE") {
      state.baseline_segments[changeEvent.segment] = changeEvent.new_time;
    }
    return state;
  }
  const expiresDate = addSchoolDays(schoolCalendar, changeDate, 15);
  if (hasOpenAccumulationWindow(state, changeDate)) {
    state.cumulative_drift_minutes += delta;
    state.contributing_change_ids.push(changeEvent.id);
    state.window_expires_date = expiresDate;
    if ((state.status === "BID_PENDING" || state.status === "BUMP_ELIGIBLE") && Math.abs(state.cumulative_drift_minutes) < BID_THRESHOLD_MINUTES) {
      state.status = "ACCUMULATING";
      state.bump_decision_due_date = null;
      state.bump_chain_id = null;
      state.bump_chain_link = null;
      state.bump_kind = null;
      state.bid_response_due_date = null;
      state.bid_signup = null;
    }
  } else {
    state.status = "ACCUMULATING";
    state.window_opened_date = changeDate;
    state.cumulative_drift_minutes = delta;
    state.contributing_change_ids = [changeEvent.id];
    state.window_expires_date = expiresDate;
    state.bump_decision_due_date = null;
    state.bump_chain_id = null;
    state.bump_chain_link = null;
    state.bump_kind = null;
    state.bid_response_due_date = null;
    state.bid_signup = null;
  }
  return state;
}
function applyAllWindowExpirations(routeStateMap, asOfDate, options = {}) {
  const updated = {};
  for (const [routeId, entry] of Object.entries(routeStateMap)) {
    updated[routeId] = applyWindowExpiration(entry, asOfDate, {
      routeId,
      changeLog: options.changeLog,
      effectiveDeltas: options.effectiveDeltas,
      schoolCalendar: options.schoolCalendar
    });
  }
  return updated;
}
function isFinalizedRouteEntry(entry) {
  if (!entry) {
    return false;
  }
  if (entry.status === "BID_PENDING" || entry.status === "BUMP_ELIGIBLE" || entry.status === "NEEDS_REVIEW") {
    return true;
  }
  return entry.status === "STABLE" && entry.payroll_rounded_total_minutes != null;
}
function getPreviousFinalizedStatus(entry) {
  if (entry.status === "NEEDS_REVIEW") {
    return entry.reconciliation?.previous_finalized_status ?? null;
  }
  if (entry.status === "BID_PENDING") {
    return "BID_PENDING";
  }
  if (entry.status === "BUMP_ELIGIBLE") {
    return "BUMP_ELIGIBLE";
  }
  if (entry.status === "STABLE" && entry.payroll_rounded_total_minutes != null) {
    return "STABLE";
  }
  return null;
}
function findCausingAdjustment(changeLog, routeId) {
  const changeIds = new Set(
    changeLog.filter(isChangeEvent).map((entry) => (
      /** @type {ChangeEvent} */
      entry
    )).filter((change) => change.route_id === routeId).map((change) => change.id)
  );
  const adjustments = changeLog.filter(isAdjustmentEvent).map((entry) => (
    /** @type {AdjustmentEvent} */
    entry
  )).filter((adjustment) => changeIds.has(adjustment.target_change_id)).sort((a, b) => a.adjusted_at.localeCompare(b.adjusted_at));
  return adjustments.at(-1) ?? null;
}
function getReviewHoldAfter(prior) {
  if (!prior || prior.status !== "NEEDS_REVIEW") {
    return null;
  }
  return prior.reconciliation?.raised_at ?? prior.last_updated;
}
function splitBaseAndPendingChanges(routeChanges, holdAfter) {
  if (!holdAfter) {
    return { base: routeChanges, pending: [] };
  }
  return {
    base: routeChanges.filter((change) => change.submitted_at <= holdAfter),
    pending: routeChanges.filter((change) => change.submitted_at > holdAfter)
  };
}
function applyPendingChanges(routeState, pendingChanges, schoolCalendar, effectiveDeltas = /* @__PURE__ */ new Map(), asOfDate = /* @__PURE__ */ new Date(), options = {}) {
  let state = cloneRouteState(routeState);
  state.pending_change_ids = [];
  state.reconciliation = null;
  const ordered = [...pendingChanges].sort(
    (a, b) => a.submitted_at.localeCompare(b.submitted_at)
  );
  const reportOptions = {
    changeLog: options.changeLog,
    effectiveDeltas
  };
  for (const change of ordered) {
    const delta = effectiveDeltas.has(change.id) ? effectiveDeltas.get(change.id) : change.delta_minutes;
    state = applyChangeToRoute(
      state,
      change,
      schoolCalendar,
      change.effective_date,
      delta,
      reportOptions
    );
  }
  return applyWindowExpiration(state, asOfDate, {
    routeId: ordered[0]?.route_id,
    schoolCalendar,
    ...reportOptions
  });
}
function toIsoTimestamp(asOfDate) {
  if (asOfDate instanceof Date) {
    return asOfDate.toISOString();
  }
  const trimmed = String(asOfDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`;
  }
  return new Date(trimmed).toISOString();
}
function reconcileFinalizedStatusFlips(priorRouteState, computedRouteState, changeLog, options = {}) {
  const lettersByRouteId = options.lettersByRouteId ?? {};
  const pendingByRoute = options.pendingByRoute ?? {};
  const schoolCalendar = options.schoolCalendar;
  const effectiveDeltas = options.effectiveDeltas ?? /* @__PURE__ */ new Map();
  const asOfDate = options.asOfDate ?? /* @__PURE__ */ new Date();
  const resolvedAt = toIsoTimestamp(asOfDate);
  const result = { ...computedRouteState };
  const routeIds = /* @__PURE__ */ new Set([
    ...Object.keys(priorRouteState),
    ...Object.keys(computedRouteState)
  ]);
  for (const routeId of routeIds) {
    const prior = priorRouteState[routeId];
    const computed = computedRouteState[routeId];
    if (!prior || !computed) {
      continue;
    }
    if (!isFinalizedRouteEntry(prior)) {
      continue;
    }
    const previousFinalized = getPreviousFinalizedStatus(prior);
    const computedStatus = computed.status;
    if (!previousFinalized) {
      continue;
    }
    const pending = pendingByRoute[routeId] ?? [];
    const causing = findCausingAdjustment(changeLog, routeId);
    const discrepancy = {
      causing_adjustment_id: causing?.id ?? null,
      previous_finalized_status: previousFinalized,
      computed_status: computedStatus
    };
    const adminResolution = findMatchingNeedsReviewResolution(
      changeLog,
      routeId,
      discrepancy
    );
    if (computedStatus === previousFinalized) {
      let historyNote = null;
      if (prior.status === "NEEDS_REVIEW") {
        historyNote = {
          event: "NEEDS_REVIEW_SELF_RESOLVED",
          previous_flag_raised_at: prior.reconciliation?.raised_at ?? null,
          resolved_at: resolvedAt,
          causing_adjustment_id: causing?.id ?? prior.reconciliation?.causing_adjustment_id ?? null
        };
      }
      let next = {
        ...computed,
        reconciliation: null,
        pending_change_ids: [],
        review_history: [
          ...prior.review_history ?? [],
          ...historyNote ? [historyNote] : []
        ]
      };
      if (pending.length > 0 && schoolCalendar) {
        next = applyPendingChanges(
          next,
          pending,
          schoolCalendar,
          effectiveDeltas,
          asOfDate,
          { changeLog }
        );
        next.review_history = [
          ...prior.review_history ?? [],
          ...historyNote ? [historyNote] : []
        ];
      }
      result[routeId] = next;
      continue;
    }
    if (adminResolution?.resolution === "keep_prior") {
      const historyNote = historyNoteFromResolution(prior, adminResolution);
      result[routeId] = {
        ...cloneRouteState(prior),
        status: previousFinalized,
        reconciliation: null,
        pending_change_ids: [],
        review_history: withAdminHistory(prior, historyNote),
        bump_decision_due_date: previousFinalized === "BUMP_ELIGIBLE" ? prior.bump_decision_due_date ?? null : null,
        bump_chain_id: previousFinalized === "BUMP_ELIGIBLE" ? prior.bump_chain_id ?? null : null,
        bump_chain_link: previousFinalized === "BUMP_ELIGIBLE" ? prior.bump_chain_link ?? null : null,
        bump_kind: previousFinalized === "BUMP_ELIGIBLE" ? prior.bump_kind ?? "original_decrease" : null
      };
      continue;
    }
    if (adminResolution?.resolution === "accept_computed") {
      const historyNote = historyNoteFromResolution(prior, adminResolution);
      let next = {
        ...computed,
        reconciliation: null,
        pending_change_ids: [],
        review_history: withAdminHistory(prior, historyNote)
      };
      if (pending.length > 0 && schoolCalendar) {
        next = applyPendingChanges(
          next,
          pending,
          schoolCalendar,
          effectiveDeltas,
          asOfDate,
          { changeLog }
        );
        next.review_history = withAdminHistory(prior, historyNote);
      }
      result[routeId] = next;
      continue;
    }
    if (computedStatus !== "STABLE" && computedStatus !== "BID_PENDING" && computedStatus !== "BUMP_ELIGIBLE" && computedStatus !== "ACCUMULATING") {
      continue;
    }
    const letterOrActionExists = lettersByRouteId[routeId] === true;
    const raisedAt = prior.status === "NEEDS_REVIEW" ? prior.reconciliation?.raised_at ?? prior.last_updated : causing?.adjusted_at ?? resolvedAt;
    result[routeId] = {
      ...cloneRouteState(prior),
      status: "NEEDS_REVIEW",
      pending_change_ids: pending.map((change) => change.id),
      review_history: [...prior.review_history ?? []],
      reconciliation: {
        previous_finalized_status: previousFinalized,
        computed_status: computedStatus,
        computed_cumulative_drift_minutes: computed.cumulative_drift_minutes,
        computed_payroll_rounded_total_minutes: computed.payroll_rounded_total_minutes,
        causing_adjustment_id: causing?.id ?? null,
        letter_or_action_exists: letterOrActionExists,
        raised_at: raisedAt
      },
      last_updated: computed.last_updated
    };
  }
  return result;
}
function historyNoteFromResolution(prior, resolution) {
  return {
    event: "NEEDS_REVIEW_ADMIN_RESOLVED",
    resolution: resolution.resolution,
    previous_flag_raised_at: prior.status === "NEEDS_REVIEW" ? prior.reconciliation?.raised_at ?? null : null,
    resolved_at: resolution.resolved_at,
    causing_adjustment_id: resolution.causing_adjustment_id ?? null,
    resolved_by: resolution.resolved_by ?? null,
    resolution_event_id: resolution.id,
    note: resolution.note ?? null
  };
}
function withAdminHistory(prior, historyNote) {
  const existing = [...prior.review_history ?? []];
  if (historyNote.resolution_event_id && existing.some(
    (item) => item.resolution_event_id === historyNote.resolution_event_id
  )) {
    return existing;
  }
  return [...existing, historyNote];
}
function rebuildRouteStateFromChangeLog(changeLog, initialState = {}, schoolCalendar, asOfDate = /* @__PURE__ */ new Date(), options = {}) {
  const effectiveDeltas = resolveEffectiveDeltas(changeLog);
  const priorRouteState = options.priorRouteState ?? {};
  const changes = changeLog.filter(isChangeEvent).map((entry) => (
    /** @type {ChangeEvent} */
    entry
  )).sort((a, b) => {
    const dateCompare = toDateString(a.effective_date).localeCompare(
      toDateString(b.effective_date)
    );
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return a.submitted_at.localeCompare(b.submitted_at);
  });
  const changesByRoute = {};
  for (const change of changes) {
    if (!changesByRoute[change.route_id]) {
      changesByRoute[change.route_id] = [];
    }
    changesByRoute[change.route_id].push(change);
  }
  const pendingByRoute = {};
  let state = { ...initialState };
  for (const [routeId, routeChanges] of Object.entries(changesByRoute)) {
    const holdAfter = getReviewHoldAfter(priorRouteState[routeId]);
    const { base, pending } = splitBaseAndPendingChanges(routeChanges, holdAfter);
    pendingByRoute[routeId] = pending;
    const reportOptions = { changeLog, effectiveDeltas };
    for (const change of base) {
      const effectiveDelta = effectiveDeltas.has(change.id) ? effectiveDeltas.get(change.id) : change.delta_minutes;
      state[routeId] = applyChangeToRoute(
        state[routeId],
        change,
        schoolCalendar,
        change.effective_date,
        effectiveDelta,
        reportOptions
      );
    }
  }
  const computed = applyAllWindowExpirations(state, asOfDate, {
    changeLog,
    effectiveDeltas,
    schoolCalendar
  });
  if (!options.priorRouteState) {
    return applyResolvedDrivers(computed, changeLog, asOfDate);
  }
  return applyResolvedDrivers(
    reconcileFinalizedStatusFlips(
      priorRouteState,
      computed,
      changeLog,
      {
        lettersByRouteId: options.lettersByRouteId,
        pendingByRoute,
        schoolCalendar,
        effectiveDeltas,
        asOfDate
      }
    ),
    changeLog,
    asOfDate
  );
}

// employee-tracker/src/snapshot.js
var EMPLOYEE_ROUTE_ID = "SELF";
var STATUS_COPY = {
  STABLE: {
    label: "Stable",
    summary: "No open review window. Your contracted hours match the last lock-in (or your starting schedule)."
  },
  ACCUMULATING: {
    label: "Accumulating",
    summary: "A 15-school-day window is open. Further changes reset the window. When it closes, these times become contracted \u2014 or go to bid/bump if the difference is 30 minutes or more."
  },
  BID_PENDING: {
    label: "Bid pending",
    summary: "The window closed with an increase of 30 minutes or more. Under the contract this assignment would be posted for bid."
  },
  BUMP_ELIGIBLE: {
    label: "Bump eligible",
    summary: "The window closed with a decrease of 30 minutes or more. Under the contract you would have a bump option."
  },
  NEEDS_REVIEW: {
    label: "Needs review",
    summary: "A later correction would change an outcome that already finalized."
  },
  LOCKED_PENDING: {
    label: "Locked pending",
    summary: "Window closed; waiting on a lock-in outcome."
  }
};
var OUTCOME_COPY = {
  STABLE: {
    label: "Lock in as contracted hours",
    detail: "The accumulated difference is under 30 minutes, so the new clock times lock in. Contracted hours become the nearest quarter-hour of your daily total."
  },
  BID_PENDING: {
    label: "Posted for bid",
    detail: "The accumulated difference is an increase of 30 minutes or more. The new contracted figure is calculated, but the assignment would be posted for bid."
  },
  BUMP_ELIGIBLE: {
    label: "Bump eligible",
    detail: "The accumulated difference is a decrease of 30 minutes or more. You would have a contract bump option."
  }
};
function rebuildEmployeeRouteState(changeLog, calendar, asOfDate, prior = {}) {
  const map = rebuildRouteStateFromChangeLog(
    changeLog,
    {},
    calendar,
    asOfDate,
    { priorRouteState: prior }
  );
  return map[EMPLOYEE_ROUTE_ID] ?? null;
}
function describeSchedule(segments) {
  const out = {};
  for (const segment of SEGMENTS) {
    out[segment] = splitSegmentRange(segments?.[segment] ?? null);
  }
  return out;
}
function officialContractedMinutes(entry) {
  if (!entry) {
    return null;
  }
  if (entry.payroll_rounded_total_minutes != null) {
    return entry.payroll_rounded_total_minutes;
  }
  const source = entry.status === "ACCUMULATING" ? entry.baseline_segments : entry.segments;
  return buildPayrollRoundingBreakdown(source).payroll_rounded_total_minutes;
}
function buildEmployeeSnapshot({
  profile,
  changeLog,
  entry,
  calendar,
  asOfDate,
  calendarSummary,
  calendarSource
}) {
  const asOf = toDateString(asOfDate);
  const setup_complete = Boolean(profile && entry);
  const changes = changeLog.filter((item) => !item.type || item.type === "CHANGE").map((change) => ({
    id: change.id,
    segment: change.segment,
    change_date: change.effective_date,
    previous_time: change.previous_time,
    new_time: change.new_time,
    previous: splitSegmentRange(change.previous_time),
    next: splitSegmentRange(change.new_time),
    delta_minutes: change.delta_minutes,
    delta_label: formatSignedMinutes(change.delta_minutes),
    note: change.note || "",
    is_seed: change.delta_minutes === 0 && change.previous_time === change.new_time,
    submitted_at: change.submitted_at
  })).sort((a, b) => {
    const dateCompare = b.change_date.localeCompare(a.change_date);
    if (dateCompare !== 0) return dateCompare;
    return b.submitted_at.localeCompare(a.submitted_at);
  });
  const schedule = describeSchedule(entry?.segments ?? {});
  const scheduledExact = entry ? buildPayrollRoundingBreakdown(entry.segments) : null;
  const contractedMinutes = officialContractedMinutes(entry);
  const window = entry ? buildWindowView(entry, calendar, asOf) : null;
  return {
    setup_complete,
    as_of: asOf,
    employee: {
      name: profile?.name?.trim() || "",
      start_date: profile?.start_date ?? null
    },
    calendar: {
      school_year: calendar.school_year ?? "2026-2027",
      first_day: calendarSummary?.first_day ?? "2026-09-08",
      last_day: calendarSummary?.last_day ?? "2027-06-22",
      school_day_count: calendarSummary?.school_day_count ?? calendar.school_days?.length ?? null,
      source: calendarSource ?? null
    },
    schedule,
    scheduled: scheduledExact ? {
      exact_minutes: scheduledExact.exact_total_minutes,
      exact_label: formatDurationLabel(scheduledExact.exact_total_minutes),
      if_locked_minutes: scheduledExact.payroll_rounded_total_minutes,
      if_locked_label: formatDurationLabel(
        scheduledExact.payroll_rounded_total_minutes
      )
    } : null,
    contracted: contractedMinutes == null ? null : {
      minutes: contractedMinutes,
      label: formatDurationLabel(contractedMinutes),
      source: entry?.payroll_rounded_total_minutes != null ? "last_finalization" : "starting_schedule"
    },
    window,
    changes,
    reports: (entry?.change_reports ?? []).map(shapeReport).reverse(),
    bid_threshold_minutes: BID_THRESHOLD_MINUTES,
    window_length_school_days: 15
  };
}
function buildWindowView(entry, calendar, asOf) {
  const status = entry.status;
  const copy = STATUS_COPY[status] ?? {
    label: status,
    summary: ""
  };
  const open = status === "ACCUMULATING" && entry.window_expires_date;
  const drift = entry.cumulative_drift_minutes ?? 0;
  const daysRemaining = open ? daysRemainingInWindow(calendar, asOf, entry.window_expires_date) : null;
  const becomesOn = open ? dayAfter(entry.window_expires_date) : null;
  const projectedOutcome = open ? windowFinalizationOutcome(drift) : null;
  const outcomeCopy = projectedOutcome ? OUTCOME_COPY[projectedOutcome] : null;
  const math = open ? buildSeeTheMathFromSegments(entry.baseline_segments, entry.segments) : null;
  let headline = copy.summary;
  if (open && becomesOn && outcomeCopy) {
    headline = `If you do not log another change, these times become contracted on ${prettyDate(becomesOn)} (the day after the 15-school-day window ends on ${prettyDate(entry.window_expires_date)}). Projected result: ${outcomeCopy.label.toLowerCase()}.`;
  } else if (status === "STABLE" && entry.payroll_rounded_total_minutes != null) {
    headline = "Your latest window has locked in. The contracted hours below are official under the contract rules.";
  } else if (status === "STABLE") {
    headline = "These are your starting clock times. Log a change to open a 15-school-day window.";
  }
  return {
    status,
    status_label: copy.label,
    headline,
    summary: copy.summary,
    opened_date: entry.window_opened_date ?? null,
    expires_date: entry.window_expires_date ?? null,
    becomes_contracted_on: becomesOn,
    days_remaining: daysRemaining,
    cumulative_drift_minutes: drift,
    cumulative_drift_label: formatSignedMinutes(drift),
    projected_outcome: projectedOutcome,
    projected_outcome_label: outcomeCopy?.label ?? null,
    projected_outcome_detail: outcomeCopy?.detail ?? null,
    contracted_hours_would_change: math?.contracted_hours_changed ?? null,
    contracted_hours_delta_minutes: math?.contracted_hours_delta_minutes ?? null,
    contracted_hours_statement: math?.statement ?? null,
    see_the_math: math
  };
}
function shapeReport(report) {
  return {
    id: report.id,
    outcome: report.outcome,
    outcome_label: OUTCOME_COPY[report.outcome]?.label ?? report.outcome,
    finalized_at: report.finalized_at,
    window_opened_date: report.window_opened_date,
    contracted_hours_changed: report.contracted_hours_changed,
    contracted_hours_delta_minutes: report.contracted_hours_delta_minutes,
    contracted_hours_statement: report.contracted_hours_statement,
    see_the_math: report.see_the_math,
    contributing_changes: report.contributing_changes ?? []
  };
}
function formatSignedMinutes(minutes) {
  if (typeof minutes !== "number" || Number.isNaN(minutes)) {
    return "\u2014";
  }
  if (minutes === 0) {
    return "0 min";
  }
  const sign = minutes > 0 ? "+" : "\u2212";
  return `${sign}${formatDurationLabel(Math.abs(minutes))}`;
}
function previewEmployeeChange({
  entry,
  calendar,
  segment,
  clock_in,
  clock_out,
  change_date
}) {
  if (!entry) {
    throw new Error("Set up your starting schedule before previewing a change.");
  }
  if (!SEGMENTS.includes(segment)) {
    throw new Error(`segment must be one of: ${SEGMENTS.join(", ")}.`);
  }
  const previous = entry.segments[segment];
  if (!previous) {
    throw new Error(
      `No ${segment} times on file yet. Add that run to your starting schedule first.`
    );
  }
  const newTime = formatSegmentRange(clock_in, clock_out);
  const delta = computeDeltaMinutes(previous, newTime);
  const changeDate = toDateString(change_date);
  const hypothetical = {
    id: "preview",
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: entry.driver_name ?? "",
    driver_id: entry.driver_id ?? null,
    segment,
    submitted_at: `${changeDate}T00:00:00.000Z`,
    effective_date: changeDate,
    previous_time: previous,
    new_time: newTime,
    computed_delta_minutes: delta,
    delta_minutes: delta,
    routing_adjustment: null,
    reason_category: "OTHER",
    note: "",
    entered_by: "Self"
  };
  const next = applyChangeToRoute(entry, hypothetical, calendar, changeDate, delta);
  const expires = next.window_expires_date ?? addSchoolDays(calendar, changeDate, 15);
  const becomesOn = dayAfter(expires);
  const nextDrift = next.cumulative_drift_minutes ?? delta;
  const outcome = windowFinalizationOutcome(nextDrift);
  const math = buildSeeTheMathFromSegments(next.baseline_segments, next.segments);
  return {
    previous_time: previous,
    new_time: newTime,
    previous: splitSegmentRange(previous),
    next: splitSegmentRange(newTime),
    delta_minutes: delta,
    delta_label: formatSignedMinutes(delta),
    window_expires_date: expires,
    becomes_contracted_on: becomesOn,
    cumulative_drift_minutes: nextDrift,
    cumulative_drift_label: formatSignedMinutes(nextDrift),
    projected_outcome: outcome,
    projected_outcome_label: OUTCOME_COPY[outcome].label,
    projected_outcome_detail: OUTCOME_COPY[outcome].detail,
    contracted_hours_would_change: math.contracted_hours_changed,
    contracted_hours_delta_minutes: math.contracted_hours_delta_minutes,
    contracted_hours_statement: math.statement
  };
}
function prettyDate(iso) {
  return (/* @__PURE__ */ new Date(`${iso}T12:00:00`)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}
function groupCalendarByMonth(calendar) {
  const months = {};
  for (const day of calendar.days ?? []) {
    const month = day.date.slice(0, 7);
    if (!months[month]) {
      const [year, mon] = month.split("-");
      const label = new Date(Date.UTC(Number(year), Number(mon) - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      months[month] = { month, label, days: [] };
    }
    months[month].days.push(day);
  }
  return Object.values(months).filter(
    (month) => month.days.some((day) => day.is_school_day)
  );
}

// employee-tracker/web/store.js
var STORAGE_KEY = "my-hours-tracker.v1";
function emptyState() {
  return {
    version: 1,
    currentProfileId: null,
    profiles: {}
  };
}
function loadState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) {
      return emptyState();
    }
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || typeof parsed.profiles !== "object") {
      return emptyState();
    }
    return {
      version: 1,
      currentProfileId: parsed.currentProfileId ?? null,
      profiles: parsed.profiles ?? {}
    };
  } catch {
    return emptyState();
  }
}
function saveState(state, storage = globalThis.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}
function listProfiles(storage = globalThis.localStorage) {
  const state = loadState(storage);
  return Object.values(state.profiles).sort((a, b) => {
    const nameCompare = String(a.name || "").localeCompare(String(b.name || ""));
    if (nameCompare !== 0) {
      return nameCompare;
    }
    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });
}
function getCurrentProfile(storage = globalThis.localStorage) {
  const state = loadState(storage);
  if (!state.currentProfileId) {
    return null;
  }
  return state.profiles[state.currentProfileId] ?? null;
}
function setCurrentProfile(id, storage = globalThis.localStorage) {
  const state = loadState(storage);
  if (!state.profiles[id]) {
    throw new Error("That person is not saved in this browser.");
  }
  state.currentProfileId = id;
  saveState(state, storage);
  return state.profiles[id];
}
function saveProfile(profile, storage = globalThis.localStorage) {
  const state = loadState(storage);
  state.profiles[profile.id] = profile;
  state.currentProfileId = profile.id;
  saveState(state, storage);
  return profile;
}
function deleteProfile(id, storage = globalThis.localStorage) {
  const state = loadState(storage);
  delete state.profiles[id];
  if (state.currentProfileId === id) {
    const remaining = Object.keys(state.profiles);
    state.currentProfileId = remaining[0] ?? null;
  }
  saveState(state, storage);
  return state.currentProfileId ? state.profiles[state.currentProfileId] : null;
}
function exportState(storage = globalThis.localStorage) {
  return JSON.stringify(loadState(storage), null, 2);
}
function importState(json, storage = globalThis.localStorage) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || !parsed.profiles) {
    throw new Error("That file is not a My Hours Tracker backup.");
  }
  const next = {
    version: 1,
    currentProfileId: parsed.currentProfileId ?? null,
    profiles: parsed.profiles
  };
  if (next.currentProfileId && !next.profiles[next.currentProfileId]) {
    next.currentProfileId = Object.keys(next.profiles)[0] ?? null;
  }
  saveState(next, storage);
  return next;
}

// employee-tracker/web/engine.js
var cachedCalendar = null;
function getAsOfDate() {
  return localDateString();
}
function getCalendarPack() {
  if (!cachedCalendar) {
    const { calendar, summary, source } = buildBps2026_2027Calendar();
    cachedCalendar = {
      calendar,
      summary,
      source,
      months: groupCalendarByMonth(calendar),
      first_day: BPS_2026_2027_INPUT.first_day,
      last_day: BPS_2026_2027_INPUT.last_day
    };
  }
  return cachedCalendar;
}
function calendarMeta() {
  const pack = getCalendarPack();
  return {
    calendarSummary: pack.summary,
    calendarSource: pack.source ?? BPS_2026_2027_SOURCE
  };
}
function requireClockPair(clockIn, clockOut, label) {
  const inTrim = String(clockIn ?? "").trim();
  const outTrim = String(clockOut ?? "").trim();
  if (!inTrim && !outTrim) {
    return null;
  }
  if (!inTrim || !outTrim) {
    throw new Error(`${label} needs both a clock-in and a clock-out.`);
  }
  return formatSegmentRange(inTrim, outTrim);
}
function makeSeedChange({ segment, range, startDate, name, submittedAt }) {
  return {
    id: createId(),
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: name,
    driver_id: null,
    segment,
    submitted_at: submittedAt,
    effective_date: startDate,
    previous_time: range,
    new_time: range,
    computed_delta_minutes: 0,
    delta_minutes: 0,
    routing_adjustment: null,
    reason_category: "OTHER",
    note: "Starting schedule",
    entered_by: name || "Self"
  };
}
function buildSnapshot(profile, asOfDate = getAsOfDate()) {
  const pack = getCalendarPack();
  const asOf = toDateString(asOfDate);
  if (!profile) {
    return buildEmployeeSnapshot({
      profile: null,
      changeLog: [],
      entry: null,
      calendar: pack.calendar,
      asOfDate: asOf,
      ...calendarMeta()
    });
  }
  const entry = rebuildEmployeeRouteState(
    profile.changeLog ?? [],
    pack.calendar,
    asOf
  );
  return buildEmployeeSnapshot({
    profile: {
      name: profile.name,
      start_date: profile.start_date
    },
    changeLog: profile.changeLog ?? [],
    entry,
    calendar: pack.calendar,
    asOfDate: asOf,
    ...calendarMeta()
  });
}
function currentSnapshot(storage, asOfDate = getAsOfDate()) {
  return buildSnapshot(getCurrentProfile(storage), asOfDate);
}
function setupProfile(body, storage) {
  const name = String(body.name ?? "").trim();
  const startDate = toDateString(body.start_date || getAsOfDate());
  const submittedAt = (/* @__PURE__ */ new Date()).toISOString();
  const segments = [];
  for (const segment of SEGMENTS) {
    const key = segment.toLowerCase();
    const range = requireClockPair(
      body[`${key}_in`] ?? body[`${key}_clock_in`],
      body[`${key}_out`] ?? body[`${key}_clock_out`],
      segment
    );
    if (range) {
      segments.push({ segment, range });
    }
  }
  if (!segments.length) {
    throw new Error(
      "Enter clock-in and clock-out for at least one run (AM, Midday, or PM)."
    );
  }
  const seeds = segments.map(
    (item, index) => makeSeedChange({
      segment: item.segment,
      range: item.range,
      startDate,
      name,
      submittedAt: new Date(new Date(submittedAt).getTime() + index).toISOString()
    })
  );
  const profile = {
    id: createId(),
    name,
    start_date: startDate,
    setup_at: submittedAt,
    created_at: submittedAt,
    changeLog: seeds
  };
  saveProfile(profile, storage);
  return currentSnapshot(storage);
}
function previewChange(body, storage) {
  const profile = getCurrentProfile(storage);
  const pack = getCalendarPack();
  const asOf = toDateString(body.change_date || getAsOfDate());
  const entry = rebuildEmployeeRouteState(
    profile?.changeLog ?? [],
    pack.calendar,
    asOf
  );
  return previewEmployeeChange({
    entry,
    calendar: pack.calendar,
    segment: String(body.segment || "").trim(),
    clock_in: normalizeClockTime(body.clock_in),
    clock_out: normalizeClockTime(body.clock_out),
    change_date: asOf
  });
}
function recordChange(body, storage) {
  const profile = getCurrentProfile(storage);
  if (!profile) {
    throw new Error("Set up a person first.");
  }
  const segment = String(body.segment || "").trim();
  if (!SEGMENTS.includes(segment)) {
    throw new Error(`segment must be one of: ${SEGMENTS.join(", ")}.`);
  }
  const changeDate = toDateString(
    body.change_date || body.effective_date || getAsOfDate()
  );
  const pack = getCalendarPack();
  const entry = rebuildEmployeeRouteState(
    profile.changeLog,
    pack.calendar,
    changeDate
  );
  if (!entry) {
    throw new Error("Starting schedule is missing. Add this person again.");
  }
  const previous = entry.segments[segment];
  if (!previous) {
    throw new Error(
      `No ${segment} times on file. Add that run when you set up this person.`
    );
  }
  const newTime = formatSegmentRange(body.clock_in, body.clock_out);
  if (newTime === previous) {
    throw new Error("New times are the same as the current times.");
  }
  const delta = computeDeltaMinutes(previous, newTime);
  const name = profile.name?.trim() || "Self";
  profile.changeLog = [
    ...profile.changeLog,
    {
      id: createId(),
      route_id: EMPLOYEE_ROUTE_ID,
      driver_name: name,
      driver_id: null,
      segment,
      submitted_at: (/* @__PURE__ */ new Date()).toISOString(),
      effective_date: changeDate,
      previous_time: previous,
      new_time: newTime,
      computed_delta_minutes: delta,
      delta_minutes: delta,
      routing_adjustment: null,
      reason_category: "OTHER",
      note: String(body.note ?? "").trim(),
      entered_by: name
    }
  ];
  saveProfile(profile, storage);
  return currentSnapshot(storage);
}
function switchPerson(id, storage) {
  setCurrentProfile(id, storage);
  return currentSnapshot(storage);
}
function removeCurrentPerson(storage) {
  const profile = getCurrentProfile(storage);
  if (!profile) {
    return currentSnapshot(storage);
  }
  deleteProfile(profile.id, storage);
  return currentSnapshot(storage);
}
function peopleList(storage) {
  return listProfiles(storage).map((profile) => ({
    id: profile.id,
    name: profile.name || "Unnamed",
    start_date: profile.start_date
  }));
}
function calendarPayload() {
  const pack = getCalendarPack();
  return {
    ...pack.calendar,
    months: pack.months,
    source: pack.source,
    first_day: pack.first_day,
    last_day: pack.last_day
  };
}
function importBackup(json, storage) {
  importState(json, storage);
  return currentSnapshot(storage);
}

// employee-tracker/web/app.js
var RUNS = [
  { id: "AM", label: "AM", inName: "am_in", outName: "am_out" },
  { id: "MIDDAY", label: "Midday", inName: "midday_in", outName: "midday_out" },
  { id: "PM", label: "PM", inName: "pm_in", outName: "pm_out" }
];
var setupView = document.querySelector("#setup-view");
var appView = document.querySelector("#app-view");
var setupRuns = document.querySelector("#setup-runs");
var setupForm = document.querySelector("#setup-form");
var setupStatus = document.querySelector("#setup-status");
var changeForm = document.querySelector("#change-form");
var changeStatus = document.querySelector("#change-status");
var previewBox = document.querySelector("#preview-box");
var hero = document.querySelector("#hero");
var scheduleCards = document.querySelector("#schedule-cards");
var scheduleLead = document.querySelector("#schedule-lead");
var historyList = document.querySelector("#history-list");
var reportList = document.querySelector("#report-list");
var calendarMonths = document.querySelector("#calendar-months");
var calendarPill = document.querySelector("#calendar-pill");
var profileSelect = document.querySelector("#profile_select");
var snapshot = null;
var addingPerson = false;
var calendarRendered = false;
function toTimeInput(clock) {
  if (!clock) return "";
  const [h, m] = String(clock).split(":");
  return `${String(h).padStart(2, "0")}:${m}`;
}
function prettyDate2(iso) {
  if (!iso) return "\u2014";
  return (/* @__PURE__ */ new Date(`${iso}T12:00:00`)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}
function setStatus(el, message, kind = "") {
  el.hidden = !message;
  el.textContent = message || "";
  el.className = `status${kind ? ` is-${kind}` : ""}`;
}
function renderPeople() {
  const people = peopleList();
  const current = getCurrentProfile();
  profileSelect.innerHTML = "";
  if (!people.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Add a person\u2026";
    profileSelect.append(option);
    return;
  }
  for (const person of people) {
    const option = document.createElement("option");
    option.value = person.id;
    option.textContent = person.name || "Unnamed";
    profileSelect.append(option);
  }
  if (addingPerson) {
    const option = document.createElement("option");
    option.value = "__new__";
    option.textContent = "New person\u2026";
    profileSelect.append(option);
    profileSelect.value = "__new__";
  } else if (current) {
    profileSelect.value = current.id;
  }
}
function renderSetupRuns() {
  setupRuns.innerHTML = RUNS.map(
    (run) => `
      <div class="run-card">
        <h3>${run.label}</h3>
        <div class="pair">
          <div class="field">
            <label for="${run.inName}">Clock-in</label>
            <input id="${run.inName}" name="${run.inName}" type="time" step="60" />
          </div>
          <div class="field">
            <label for="${run.outName}">Clock-out</label>
            <input id="${run.outName}" name="${run.outName}" type="time" step="60" />
          </div>
        </div>
      </div>`
  ).join("");
}
function fillChangeFormFromSegment() {
  if (!snapshot?.schedule) return;
  const segment = document.querySelector("#change_segment").value;
  const current = snapshot.schedule[segment];
  document.querySelector("#clock_in").value = current ? toTimeInput(current.clock_in) : "";
  document.querySelector("#clock_out").value = current ? toTimeInput(current.clock_out) : "";
}
function renderHero() {
  const windowInfo = snapshot.window;
  const contracted = snapshot.contracted;
  const name = snapshot.employee?.name;
  const outcome = windowInfo?.projected_outcome;
  hero.className = `hero panel${outcome === "BID_PENDING" ? " outcome-bid" : outcome === "BUMP_ELIGIBLE" ? " outcome-bump" : ""}`;
  const title = windowInfo?.becomes_contracted_on ? `Becomes contracted on ${prettyDate2(windowInfo.becomes_contracted_on)}` : windowInfo?.status === "STABLE" ? "No open window" : windowInfo?.status_label || "Your hours";
  hero.innerHTML = `
    <p class="hero-kicker">${name ? `${name} \xB7 ` : ""}${windowInfo?.status_label || "Not set up"}</p>
    <h1 class="hero-title">${title}</h1>
    <p class="hero-detail">${windowInfo?.headline || ""}</p>
    <ul class="stat-row">
      <li><span>Contracted hours</span><strong>${contracted?.label || "\u2014"}</strong></li>
      <li><span>Current schedule total</span><strong>${snapshot.scheduled?.exact_label || "\u2014"}</strong></li>
      <li><span>Accumulated difference</span><strong>${windowInfo?.cumulative_drift_label || "0 min"}</strong></li>
      <li><span>School days left in window</span><strong>${windowInfo?.days_remaining == null ? "\u2014" : windowInfo.days_remaining}</strong></li>
    </ul>
    ${windowInfo?.projected_outcome_detail ? `<p class="hero-detail">${windowInfo.projected_outcome_detail}</p>` : ""}
    ${windowInfo?.contracted_hours_statement ? `<p class="hero-detail">${windowInfo.contracted_hours_statement}</p>` : ""}
  `;
}
function renderSchedule() {
  const start = snapshot.employee?.start_date;
  scheduleLead.textContent = start ? `Starting schedule as of ${prettyDate2(start)}. Times below update as soon as you log a change; contracted hours wait for the window to close.` : "";
  scheduleCards.innerHTML = RUNS.map((run) => {
    const item = snapshot.schedule?.[run.id];
    if (!item) {
      return `<article class="schedule-card"><h3>${run.label}</h3><p class="muted">Not on your schedule</p></article>`;
    }
    return `<article class="schedule-card">
      <h3>${run.label}</h3>
      <p class="times">${item.clock_in} \u2013 ${item.clock_out}</p>
      <p class="muted">${item.duration_minutes} min</p>
    </article>`;
  }).join("");
}
function renderHistory() {
  const items = (snapshot.changes || []).filter((change) => !change.is_seed);
  if (!items.length) {
    historyList.innerHTML = '<li class="empty">No clock-time changes yet.</li>';
    return;
  }
  historyList.innerHTML = items.map(
    (change) => `<li>
        <strong>${prettyDate2(change.change_date)} \xB7 ${change.segment}</strong>
        <div>${change.previous_time} \u2192 ${change.new_time} (${change.delta_label})</div>
        ${change.note ? `<div class="meta">${change.note}</div>` : ""}
      </li>`
  ).join("");
}
function renderReports() {
  const reports = snapshot.reports || [];
  if (!reports.length) {
    reportList.innerHTML = '<li class="empty">No windows have closed yet. That is when changes become contracted.</li>';
    return;
  }
  reportList.innerHTML = reports.map((report) => {
    const when = report.finalized_at ? prettyDate2(String(report.finalized_at).slice(0, 10)) : "\u2014";
    return `<li>
        <strong>${when} \xB7 ${report.outcome_label}</strong>
        <div>${report.contracted_hours_statement || ""}</div>
      </li>`;
  }).join("");
}
function renderCalendar() {
  if (calendarRendered) return;
  const calendar = calendarPayload();
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  calendarMonths.innerHTML = (calendar.months || []).map((month) => {
    const first = month.days[0];
    const pad = first ? (/* @__PURE__ */ new Date(`${first.date}T00:00:00Z`)).getUTCDay() : 0;
    const blanks = Array.from({ length: pad }, () => '<div class="cal-day"></div>');
    const days = month.days.map((day) => {
      const num = Number(day.date.slice(-2));
      const offReason = day.is_school_day ? "" : day.reason || "Off";
      const skipLabel = !offReason || offReason === "Weekend" || offReason.startsWith("Outside school year");
      const short = !day.is_school_day && !skipLabel ? offReason.replace(" (students off)", "") : "";
      return `<div class="cal-day ${day.is_school_day ? "is-school" : "is-off"}" title="${day.is_school_day ? "School day" : offReason}"><span class="num">${num}</span>${short ? `<span class="why">${short}</span>` : ""}</div>`;
    });
    return `<div class="month-block">
        <h3>${month.label}</h3>
        <div class="month-grid">
          ${dows.map((d) => `<div class="dow">${d}</div>`).join("")}
          ${blanks.join("")}${days.join("")}
        </div>
      </div>`;
  }).join("");
  calendarRendered = true;
}
function showSetup(resetForm = false) {
  setupView.hidden = false;
  setupView.setAttribute("aria-hidden", "false");
  appView.hidden = true;
  if (resetForm) {
    setupForm.reset();
    document.querySelector("#setup_start_date").value = getAsOfDate();
    setStatus(setupStatus, "");
  }
}
function renderApp() {
  renderPeople();
  const ready = Boolean(snapshot?.setup_complete) && !addingPerson;
  if (!ready) {
    showSetup(false);
    return;
  }
  setupView.hidden = true;
  setupView.setAttribute("aria-hidden", "true");
  appView.hidden = false;
  renderHero();
  renderSchedule();
  renderHistory();
  renderReports();
  renderCalendar();
  fillChangeFormFromSegment();
}
function loadAll() {
  snapshot = addingPerson ? buildSnapshot(null) : currentSnapshot();
  calendarPill.textContent = `BPS ${snapshot.calendar?.school_year || "2026-2027"} \xB7 ${snapshot.calendar?.school_day_count ?? 180} school days`;
  if (!document.querySelector("#setup_start_date").value) {
    document.querySelector("#setup_start_date").value = snapshot.as_of || getAsOfDate();
  }
  if (!document.querySelector("#change_date").value) {
    document.querySelector("#change_date").value = snapshot.as_of || getAsOfDate();
  }
  renderApp();
}
function updatePreview() {
  if (!snapshot?.setup_complete || addingPerson) return;
  const clockIn = document.querySelector("#clock_in").value;
  const clockOut = document.querySelector("#clock_out").value;
  const changeDate = document.querySelector("#change_date").value;
  const segment = document.querySelector("#change_segment").value;
  if (!clockIn || !clockOut || !changeDate) {
    previewBox.hidden = true;
    return;
  }
  try {
    const preview = previewChange({
      segment,
      clock_in: clockIn,
      clock_out: clockOut,
      change_date: changeDate
    });
    previewBox.hidden = false;
    previewBox.innerHTML = `
      <strong>${preview.delta_label}</strong> exact difference
      \xB7 window ends <strong>${prettyDate2(preview.window_expires_date)}</strong>
      \xB7 becomes contracted <strong>${prettyDate2(preview.becomes_contracted_on)}</strong>
      \xB7 ${preview.projected_outcome_label}
      <div class="meta">${preview.contracted_hours_statement || ""}</div>
    `;
    setStatus(changeStatus, "");
  } catch (error) {
    previewBox.hidden = true;
    setStatus(changeStatus, error.message, "error");
  }
}
setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(setupForm));
  try {
    snapshot = setupProfile(data);
    addingPerson = false;
    setStatus(setupStatus, "Starting times saved on this device.", "ok");
    loadAll();
  } catch (error) {
    setStatus(setupStatus, error.message, "error");
  }
});
changeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    snapshot = recordChange({
      segment: document.querySelector("#change_segment").value,
      change_date: document.querySelector("#change_date").value,
      clock_in: document.querySelector("#clock_in").value,
      clock_out: document.querySelector("#clock_out").value,
      note: document.querySelector("#change_note").value
    });
    setStatus(changeStatus, "Change recorded on this device.", "ok");
    document.querySelector("#change_note").value = "";
    renderApp();
    updatePreview();
  } catch (error) {
    setStatus(changeStatus, error.message, "error");
  }
});
document.querySelector("#change_segment").addEventListener("change", () => {
  fillChangeFormFromSegment();
  updatePreview();
});
document.querySelector("#change-reset").addEventListener("click", () => {
  fillChangeFormFromSegment();
  document.querySelector("#change_note").value = "";
  updatePreview();
});
for (const id of ["clock_in", "clock_out", "change_date"]) {
  document.querySelector(`#${id}`).addEventListener("change", updatePreview);
}
document.querySelector("#reset-btn").addEventListener("click", () => {
  if (!confirm("Erase this person\u2019s hours from this browser?")) return;
  snapshot = removeCurrentPerson();
  addingPerson = !getCurrentProfile();
  setupForm.reset();
  setStatus(setupStatus, "");
  loadAll();
});
profileSelect.addEventListener("change", () => {
  const id = profileSelect.value;
  if (!id || id === "__new__") {
    return;
  }
  addingPerson = false;
  snapshot = switchPerson(id);
  loadAll();
});
document.querySelector("#add-person-btn").addEventListener("click", () => {
  addingPerson = true;
  showSetup(true);
  renderPeople();
});
document.querySelector("#export-btn").addEventListener("click", () => {
  const blob = new Blob([exportState()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "my-hours-tracker-backup.json";
  link.click();
  URL.revokeObjectURL(url);
});
document.querySelector("#import-btn").addEventListener("click", () => {
  document.querySelector("#import-file").click();
});
document.querySelector("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    snapshot = importBackup(await file.text());
    addingPerson = false;
    loadAll();
  } catch (error) {
    setStatus(setupStatus, error.message, "error");
    setupView.hidden = false;
  }
});
renderSetupRuns();
try {
  loadAll();
} catch (error) {
  setStatus(setupStatus, error.message, "error");
  setupView.hidden = false;
}
