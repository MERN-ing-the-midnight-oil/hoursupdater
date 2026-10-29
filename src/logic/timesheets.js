// instead of a photographed card. Day rules match compareCardToContract:
// school days carry the current contracted day, weekends are all overtime,
// and a weekday's first 8 clock hours are regular. This does not change
// routes or punches.

import { getSchoolDays } from './calendar.js';
import { parseTimeRange } from './timeUtils.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RUNS = [
  { id: 'AM', label: 'AM' },
  { id: 'MIDDAY', label: 'Midday' },
  { id: 'PM', label: 'PM' },
];

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function roundHours(value) {
  return Math.round(value * 100) / 100;
}

export function periodFromDate(date) {
  return {
    year: date.getFullYear(),
    monthIndex: date.getMonth(),
    half: date.getDate() <= 15 ? 1 : 2,
  };
}

function periodOrdinal(period) {
  return period.year * 24 + period.monthIndex * 2 + (period.half === 1 ? 0 : 1);
}

function nextPeriod(period) {
  if (period.half === 1) return { year: period.year, monthIndex: period.monthIndex, half: 2 };
  if (period.monthIndex === 11) return { year: period.year + 1, monthIndex: 0, half: 1 };
  return { year: period.year, monthIndex: period.monthIndex + 1, half: 1 };
}

export function semiMonthlyDates(year, monthIndex, half) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const dates = [];
  const start = half === 1 ? 1 : 16;
  const end = half === 1 ? 15 : lastDay;
  for (let day = start; day <= end; day += 1) {
    dates.push(new Date(year, monthIndex, day));
  }
  return dates;
}

export function periodLabel(period) {
  const dates = semiMonthlyDates(period.year, period.monthIndex, period.half);
  const monthName = dates[0].toLocaleString('en-US', { month: 'long' });
  const last = dates[dates.length - 1].getDate();
  return `${monthName} ${dates[0].getDate()}–${last}, ${period.year}`;
}

export function presentPeriod(period) {
  return {
    year: period.year,
    month: period.monthIndex + 1,
    half: period.half,
    label: periodLabel(period),
  };
}

// Pay periods from the earliest punch through the period that contains `now`.
// Newest first. With no punches, only the current period.
export function listPeriods(punches, now = new Date()) {
  const current = periodFromDate(now);
  let earliest = current;
  for (const punch of punches) {
    if (punch?.removed === true) continue;
    const date = new Date(punch?.punched_at);
    if (Number.isNaN(date.getTime())) continue;
    const period = periodFromDate(date);
    if (periodOrdinal(period) < periodOrdinal(earliest)) earliest = period;
  }
  if (periodOrdinal(earliest) > periodOrdinal(current)) earliest = current;
  const periods = [];
  let cursor = earliest;
  while (periodOrdinal(cursor) <= periodOrdinal(current)) {
    periods.push(cursor);
    cursor = nextPeriod(cursor);
  }
  return periods.reverse();
}

export function periodFromQuery(query, now = new Date()) {
  const yearText = query?.year;
  const monthText = query?.month;
  const halfText = query?.half;
  const hasYear = yearText != null && String(yearText) !== '';
  const hasMonth = monthText != null && String(monthText) !== '';
  const hasHalf = halfText != null && String(halfText) !== '';
  if (!hasYear && !hasMonth && !hasHalf) return periodFromDate(now);
  if (!hasYear || !hasMonth || !hasHalf) {
    fail('Choose a year, month, and pay-period half.');
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const half = Number(halfText);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) fail('That year is not valid.');
  if (!Number.isInteger(month) || month < 1 || month > 12) fail('That month is not valid.');
  if (half !== 1 && half !== 2) {
    fail('A pay period is the 1st–15th or the 16th through the end of the month.');
  }
  return { year, monthIndex: month - 1, half };
}

function formatStamp(date) {
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${WEEKDAYS[date.getDay()]} ${date.getMonth() + 1}/${date.getDate()} ${hours}:${minutes} ${ampm}`;
}

// Routes this driver holds now. Prefer driver id. A route that never stored
// an id can still match the driver's name.
export function routesHeldBy(routeState, driver) {
  const id = String(driver?.driver_id || '').trim();
  const name = String(driver?.name || '').trim().toLowerCase();
  const byId = [];
  const byName = [];
  for (const [route_id, entry] of Object.entries(routeState || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const row = { route_id, segments: entry.segments || {} };
    if (id && entry.driver_id === id) byId.push(row);
    else if (!entry.driver_id && name && String(entry.driver_name || '').trim().toLowerCase() === name) {
      byName.push(row);
    }
  }
  const held = byId.length ? byId : byName;
  held.sort((a, b) => a.route_id.localeCompare(b.route_id, undefined, { numeric: true }));
  return held;
}

// Exact contracted day from current route segments, same as the reader's
// contractDailyHours when each run has a minute total.
export function contractFromRoutes(routes) {
  const routeIds = [];
  const clockParts = [];
  const problems = [];
  let minutes = 0;
  for (const route of routes) {
    routeIds.push(route.route_id);
    const runs = [];
    for (const run of RUNS) {
      const range = route.segments?.[run.id];
      if (range == null || !String(range).trim()) continue;
      const text = String(range).trim();
      try {
        minutes += parseTimeRange(text).durationMinutes;
        const [clockIn, clockOut] = text.split('-').map((part) => part.trim());
        runs.push(`${run.label} ${clockIn}–${clockOut}`);
      } catch {
        problems.push(`Route ${route.route_id} ${run.label} time "${text}" could not be read.`);
      }
    }
    if (runs.length) {
      clockParts.push(routes.length > 1 ? `Route ${route.route_id}: ${runs.join(' · ')}` : runs.join(' · '));
    }
  }
  return {
    routeIds,
    clocks: clockParts.join('. '),
    dailyHours: roundHours(minutes / 60),
    problems,
  };
}

function contractedHoursForDate(date, dailyHours, calendar, schoolDays) {
  const key = localDateKey(date);
  const start = calendar?.coverage_start;
  const end = calendar?.coverage_end;
  if (calendar && schoolDays && start && end && key >= start && key <= end) {
    return schoolDays.includes(key) ? dailyHours : 0;
  }
  const day = date.getDay();
  return day === 0 || day === 6 ? 0 : dailyHours;
}

export function compareHoursToContract(hoursByDay, dailyContractHours, period, calendar) {
  const dates = semiMonthlyDates(period.year, period.monthIndex, period.half);
  let schoolDays = null;
  let usable = calendar;
  if (usable?.coverage_start && usable?.coverage_end) {
    try {
      schoolDays = getSchoolDays(usable);
    } catch {
      usable = null;
      schoolDays = null;
    }
  } else {
    usable = null;
  }
  const days = dates.map((date) => {
    const key = localDateKey(date);
    const clockHours = hoursByDay.get(key) ?? 0;
    const contractHours = contractedHoursForDate(date, dailyContractHours, usable, schoolDays);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    let regular = 0;
    let overtime = 0;
    if (weekend) overtime = clockHours;
    else {
      regular = Math.min(8, clockHours);
      overtime = Math.max(0, roundHours(clockHours - 8));
    }
    return {
      date: key,
      label: `${WEEKDAYS[date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}`,
      clockHours,
      contractHours,
      difference: roundHours(clockHours - contractHours),
      regular: roundHours(regular),
      overtime: roundHours(overtime),
    };
  });
  const total = (field) => roundHours(days.reduce((sum, day) => sum + day[field], 0));
  return {
    label: periodLabel(period),
    days,
    totals: {
      clockHours: total('clockHours'),
      contractHours: total('contractHours'),
      difference: total('difference'),
      regular: total('regular'),
      overtime: total('overtime'),
    },
  };
}

function punchTime(punch) {
  const date = new Date(punch?.punched_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Clock punches a later punch of the same route replaced on that same day.
// A second clock in before the clock out, or a second clock out before the
// next clock in, replaces the earlier one. A finished in-and-out stays.
// The replaced punch is kept so the office can still see that time.
export function replacedClockPunchIds(punches) {
  const groups = new Map();
  for (const punch of punches || []) {
    if (!punch || punch.removed === true || !punch.id) continue;
    if (punch.action !== 'in' && punch.action !== 'out') continue;
    const when = punchTime(punch);
    if (!when) continue;
    const run = normalizePunchRun(punch.run) || '';
    const extra = run === 'OTHER' ? String(extraPunchIndex(punch)) : '';
    const key = `${String(punch.driver_name || '').trim().toLowerCase()}|${localDateKey(when)}|${run}|${extra}`;
    const list = groups.get(key) || [];
    list.push(punch);
    groups.set(key, list);
  }
  const replaced = new Set();
  for (const list of groups.values()) {
    list.sort((a, b) => String(a.punched_at).localeCompare(String(b.punched_at)) || String(a.id).localeCompare(String(b.id)));
    let openIn = null;
    let openOut = null;
    for (const punch of list) {
      if (punch.action === 'in') {
        if (openIn) replaced.add(String(openIn.id));
        openIn = punch;
        openOut = null;
        continue;
      }
      if (openOut) replaced.add(String(openOut.id));
      openOut = punch;
      openIn = null;
    }
  }
  return replaced;
}

// Pair each clock in with the next clock out. A second in, or an out with
// nothing open, stays unpaired. A punch replaced by a later one on that
// same route is left out of the pair so the later time is the one that counts.
export function pairClockPunches(punches) {
  const replaced = replacedClockPunchIds(punches);
  const sorted = [...punches].filter((punch) => !replaced.has(String(punch?.id || ''))).sort((a, b) => {
    const at = String(a.punched_at).localeCompare(String(b.punched_at));
    if (at !== 0) return at;
    return String(a.id).localeCompare(String(b.id));
  });
  const pairs = [];
  const unpaired = [];
  let open = null;
  for (const punch of sorted) {
    if (punch?.removed === true) continue;
    if (punch.action === 'in') {
      if (open) unpaired.push({ punch: open, reason: 'in' });
      open = punch;
      continue;
    }
    if (punch.action !== 'out') continue;
    if (!open) {
      unpaired.push({ punch, reason: 'out' });
      continue;
    }
    const start = punchTime(open);
    const end = punchTime(punch);
    if (!start || !end) {
      unpaired.push({ punch: open, reason: 'in' });
      unpaired.push({ punch, reason: 'out' });
      open = null;
      continue;
    }
    const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
    pairs.push({
      clockIn: open,
      clockOut: punch,
      start,
      end,
      hours: roundHours(Math.abs(minutes) / 60),
      reversed: minutes < 0,
    });
    open = null;
  }
  if (open) unpaired.push({ punch: open, reason: 'in' });
  return { pairs, unpaired };
}

function reasonMinutesLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourText = hours === 1 ? '1 hour' : hours ? `${hours} hours` : '';
  const minuteText = rest === 1 ? '1 minute' : rest ? `${rest} minutes` : '';
  return [hourText, minuteText].filter(Boolean).join(' ') || '0 minutes';
}

function reasonLabels(codes) {
  const labels = [];
  const seen = new Set();
  for (const code of codes || []) {
    const label = String(code?.label || '').trim();
    const id = String(code?.id || label);
    if (!label || seen.has(id)) continue;
    seen.add(id);
    const minutes = Number(code?.minutes);
    const time =
      Number.isInteger(minutes) && minutes >= 0 && minutes <= 24 * 60 ? ` (${reasonMinutesLabel(minutes)})` : '';
    labels.push(`${label}${time}`);
  }
  return labels;
}

function punchNote(punch) {
  return String(punch?.note || '').trim();
}

function combinedNote(clockIn, clockOut) {
  return [punchNote(clockIn), clockOut ? punchNote(clockOut) : ''].filter(Boolean).join(' · ');
}

function combinedReasons(clockIn, clockOut) {
  return reasonLabels([...(clockIn?.reason_codes || []), ...(clockOut?.reason_codes || [])]);
}

// A pair counts as AM before 8:00, midday from 8:00 until 1:00, and PM after that.
// The earlier stamp decides the run.
// Used only when a clock record has no route chosen by the driver.
export function segmentForClock(date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes < 8 * 60) return 'am';
  if (minutes < 13 * 60) return 'midday';
  return 'pm';
}

// The route a driver chose for a clock in or clock out.
export function normalizePunchRun(value) {
  const run = String(value ?? '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (run === 'AM') return 'AM';
  if (run === 'MIDDAY') return 'MIDDAY';
  if (run === 'PM') return 'PM';
  if (run === 'OTHER') return 'OTHER';
  return '';
}

// Which extra period a punch belongs to.
// Missing indexes are the first extra period. Other routes are not extra periods.
export function extraPunchIndex(punch) {
  if (normalizePunchRun(punch?.run) !== 'OTHER') return 0;
  const index = Number(punch?.extra_index);
  if (Number.isInteger(index) && index >= 1) return index;
  return 1;
}

export function punchRunLabel(run) {
  if (run === 'AM') return 'AM route';
  if (run === 'MIDDAY') return 'Mid day route';
  if (run === 'PM') return 'PM route';
  if (run === 'OTHER') return 'Other';
  return '';
}

// The driver's choice on the clock in, then the clock out.
// A record saved before that choice still uses the clock time.
export function runForClockPair(pair) {
  const chosen = normalizePunchRun(pair?.clockIn?.run) || normalizePunchRun(pair?.clockOut?.run);
  if (chosen) return chosen;
  const earlier = pair.start <= pair.end ? pair.start : pair.end;
  const segment = segmentForClock(earlier);
  return segment === 'am' ? 'AM' : segment === 'midday' ? 'MIDDAY' : 'PM';
}

// A typed extra-hours amount. Zero means the day has none.
export function normalizeExtraHours(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return roundHours(Math.min(999, Math.max(-999, number)));
}

export function extraStoreKey(driverId, period) {
  return `${driverId}|${period.year}-${period.monthIndex + 1}-${period.half}`;
}

export function normalizeTimesheetExtras(data) {
  const out = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const [key, days] of Object.entries(data)) {
    if (!days || typeof days !== 'object' || Array.isArray(days)) continue;
    const cleaned = {};
    for (const [date, hours] of Object.entries(days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const value = normalizeExtraHours(hours);
      if (value !== 0) cleaned[date] = value;
    }
    if (Object.keys(cleaned).length) out[key] = cleaned;
  }
  return out;
}

export function setExtraHours(store, driverId, period, date, hours) {
  const next = normalizeTimesheetExtras(store);
  const key = extraStoreKey(driverId, period);
  const days = { ...(next[key] || {}) };
  const value = normalizeExtraHours(hours);
  if (value === 0) delete days[date];
  else days[date] = value;
  if (Object.keys(days).length) next[key] = days;
  else delete next[key];
  return next;
}

export function extraDateInPeriod(period, date) {
  return semiMonthlyDates(period.year, period.monthIndex, period.half).some(
    (day) => localDateKey(day) === date
  );
}

export function buildTimesheet({ driver, punches, routes, calendar, period, extraByDate }) {
  const mine = (punches || []).filter((punch) => punch.driver_id === driver.driver_id);
  const { pairs, unpaired } = pairClockPunches(mine);
  const dates = semiMonthlyDates(period.year, period.monthIndex, period.half);
  const keys = new Set(dates.map((date) => localDateKey(date)));
  const inPeriod = (date) => keys.has(localDateKey(date));
  const hoursByDay = new Map();
  const segmentHours = new Map();
  const rows = [];
  const caveats = [];

  for (const pair of pairs) {
    if (!inPeriod(pair.start)) {
      if (inPeriod(pair.end)) {
        caveats.push(
          `A clock in on ${formatStamp(pair.start)} closed during this period, so those hours stay on that earlier day.`
        );
      }
      continue;
    }
    const key = localDateKey(pair.start);
    hoursByDay.set(key, roundHours((hoursByDay.get(key) ?? 0) + pair.hours));
    const run = runForClockPair(pair);
    if (run !== 'OTHER') {
      const segment = run === 'AM' ? 'am' : run === 'MIDDAY' ? 'midday' : 'pm';
      const segmentKey = `${key}:${segment}`;
      segmentHours.set(segmentKey, roundHours((segmentHours.get(segmentKey) ?? 0) + pair.hours));
    }
    rows.push({
      at: pair.start.getTime(),
      in_label: formatStamp(pair.start),
      out_label: formatStamp(pair.end),
      hours: pair.hours,
      note: combinedNote(pair.clockIn, pair.clockOut),
      reason_codes: combinedReasons(pair.clockIn, pair.clockOut),
    });
    if (pair.reversed) {
      caveats.push(`Clock out is before clock in on ${formatStamp(pair.start)}.`);
    }
  }

  for (const item of unpaired) {
    const date = punchTime(item.punch);
    if (!date || !inPeriod(date)) continue;
    if (item.reason === 'in') caveats.push(`Clock in on ${formatStamp(date)} has no clock out.`);
    else caveats.push(`Clock out on ${formatStamp(date)} has no clock in.`);
    rows.push({
      at: date.getTime(),
      in_label: item.reason === 'in' ? formatStamp(date) : '',
      out_label: item.reason === 'out' ? formatStamp(date) : '',
      hours: null,
      note: punchNote(item.punch),
      reason_codes: reasonLabels(item.punch.reason_codes),
    });
  }

  rows.sort((a, b) => a.at - b.at);
  const contract = contractFromRoutes(routes);
  caveats.push(...contract.problems);
  const comparison = compareHoursToContract(hoursByDay, contract.dailyHours, period, calendar);
  for (const day of comparison.days) {
    day.amHours = segmentHours.get(`${day.date}:am`) ?? 0;
    day.middayHours = segmentHours.get(`${day.date}:midday`) ?? 0;
    day.pmHours = segmentHours.get(`${day.date}:pm`) ?? 0;
    day.extraHours = normalizeExtraHours(extraByDate?.[day.date]);
  }
  const routeIds = contract.routeIds;
  const routeText =
    routeIds.length === 0
      ? ''
      : routeIds.length === 1
        ? ` · route ${routeIds[0]}`
        : ` · routes ${routeIds.join(', ')}`;
  const assigned =
    driver.kind === 'substitute'
      ? 'Substitute driver. '
      : routeIds.length === 0
        ? 'This driver is not assigned to a route. '
        : '';
  const sheet = {
    driver: {
      driver_id: driver.driver_id,
      name: driver.name,
      email: String(driver.email || '').trim(),
    },
    heading: `${driver.name}${routeText}`,
    route_ids: routeIds,
    clocks: contract.clocks,
    daily_hours: contract.dailyHours,
    contract_text: `${assigned}Current contracted clocks: ${contract.clocks || 'none recorded'}. Contracted day: ${contract.dailyHours.toFixed(2)} hours.`,
    period: presentPeriod(period),
    days: comparison.days,
    totals: comparison.totals,
    payroll_rows: payrollVarianceRows(comparison.days),
    pairs: rows.map(({ at: _at, ...row }) => row),
    caveats,
  };
  sheet.email = payPeriodEmail(sheet);
  return sheet;
}

export function payPeriodSummaryText(sheet) {
  const lines = ['Pay period summary', '', `Employee: ${sheet.driver?.name || ''}`];
  if (sheet.route_ids?.length) lines.push(`Route: ${sheet.route_ids.join(', ')}`);
  lines.push(`Period: ${sheet.period?.label || ''}`, '');
  lines.push(
    `Period totals — Regular: ${Number(sheet.totals?.regular || 0).toFixed(2)} h, OT: ${Number(sheet.totals?.overtime || 0).toFixed(2)} h`,
    '',
    'Day by day:'
  );
  for (const day of sheet.days || []) {
    lines.push(
      `  ${day.label} — Clock ${Number(day.clockHours).toFixed(2)}, Contract ${Number(day.contractHours).toFixed(2)}, AM ${Number(day.amHours).toFixed(2)}, Midday ${Number(day.middayHours).toFixed(2)}, PM ${Number(day.pmHours).toFixed(2)}, Extra ${Number(day.extraHours).toFixed(2)}, Reg ${Number(day.regular).toFixed(2)}, OT ${Number(day.overtime).toFixed(2)}`
    );
  }
  lines.push(
    '',
    'Clock records are the source of the worked hours. Extra hours were typed on this sheet and are not part of regular or overtime.'
  );
  return lines.join('\n');
}

export function payPeriodEmail(sheet) {
  const to = String(sheet.driver?.email || '').trim();
  const subject = `Pay period summary — ${sheet.period?.label || ''} — ${sheet.driver?.name || ''}`.trim();
  const body = payPeriodSummaryText(sheet);
  if (!to) return { to: '', subject, body, mailto_url: null };
  const mailto_url =
    `mailto:${encodeURIComponent(to)}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;
  return { to, subject, body, mailto_url };
}

// Hours above and below the contracted day. Above is the extra clock time.
// Below is the shortfall, kept negative so a spreadsheet paste stays signed.
export function payrollVarianceRows(days) {
  const above = [];
  const below = [];
  for (const day of days || []) {
    const diff = Number(day?.difference);
    const value = Number.isFinite(diff) ? diff : 0;
    above.push(value > 0 ? roundHours(value) : 0);
    below.push(value < 0 ? roundHours(value) : 0);
  }
  return { above, below };
}

// Two spreadsheet rows: hours above the contracted day, then hours below it.
export function payrollVarianceClipboard(rows) {
  const cell = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '0.00');
  const line = (values) => (values || []).map(cell).join('\t');
  const htmlRow = (values) =>
    `<tr>${(values || []).map((value) => `<td>${cell(value)}</td>`).join('')}</tr>`;
  return {
    plain: `${line(rows?.above)}\r\n${line(rows?.below)}`,
    html: `<table>${htmlRow(rows?.above)}${htmlRow(rows?.below)}</table>`,
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

// One row per driver for a pay period. Daily regular and overtime come from
// clock records, not a scanned card.
export function payPeriodCalculatorsCsv(sheets) {
  const days = sheets[0]?.days || [];
  const dayHeaders = days.flatMap((day) => [`${day.label} Reg`, `${day.label} OT`]);
  const header = ['Employee', 'Route', ...dayHeaders, 'Period Reg total', 'Period OT total'];
  const lines = [header.map(csvCell).join(',')];
  for (const sheet of sheets) {
    const cols = [sheet.driver?.name || '', (sheet.route_ids || []).join(', ')];
    for (const day of sheet.days || []) {
      cols.push(Number(day.regular || 0).toFixed(2));
      cols.push(Number(day.overtime || 0).toFixed(2));
    }
    cols.push(Number(sheet.totals?.regular || 0).toFixed(2));
    cols.push(Number(sheet.totals?.overtime || 0).toFixed(2));
    lines.push(cols.map(csvCell).join(','));
  }
  return lines.join('\n');
}

export function payPeriodExportFilename(label) {
  const safe = String(label || '')
    .replace(/[^\w-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `Pay_period_calculators_${safe || 'export'}.csv`;
}

// Every driver's timesheet for one pay period, by name.
export function buildPeriodTimesheets({ drivers, punches, routeState, calendar, period }) {
  return [...(drivers || [])]
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }))
    .map((driver) =>
      buildTimesheet({
        driver,
        punches,
        routes: routesHeldBy(routeState, driver),
        calendar,
        period,
      })
    );
}
