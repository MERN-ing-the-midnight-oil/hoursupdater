export const DEFAULT_JOB_TITLE = 'Driver';
export const DEFAULT_LOCATION = 'Transportation';

// Pay status checked for a driver who has none saved.
export const DEFAULT_DRIVER_PAY_STATUS = 'ex-driver';

export const DEFAULT_PAY_LINES = [
  {
    id: 'reg-driver',
    label: 'REG DRIVER',
    otFactor: 0,
    fillsFromClock: true,
  },
  {
    id: 'ot-trainer',
    label: 'OT DR TRAINER',
    otFactor: 1.5,
    fillsFromClock: false,
  },
  {
    id: 'ex-trainer',
    label: 'EX DR TRAINER',
    otFactor: 1.5,
    fillsFromClock: false,
  },
  {
    id: 'ex-driver',
    label: 'EX DRIVER',
    otFactor: 0,
    fillsFromClock: false,
  },
];

// Days 1–15, then the 16th through the last day of the month.
export const DEFAULT_PAY_PERIODS = [
  { id: '1', startDay: 1, endDay: 15 },
  { id: '2', startDay: 16, endDay: 31 },
];

// One sheet for the whole month. Day 31 means the last day that month has.
export const WHOLE_MONTH_PAY_PERIODS = [{ id: '1', startDay: 1, endDay: 31 }];

const BUILTIN_LINE_IDS = new Set(DEFAULT_PAY_LINES.map((line) => line.id));
const LINE_ID_PATTERN = /^(?:reg-driver|ot-trainer|ex-trainer|ex-driver|pay-[a-z0-9-]{1,32})$/;

export function isPayLineId(id) {
  return LINE_ID_PATTERN.test(id);
}

function dayNumber(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 31) return 0;
  return number;
}

function samePeriodDays(rows, preset) {
  return (
    rows.length === preset.length &&
    rows.every((row, index) => row.startDay === preset[index].startDay && row.endDay === preset[index].endDay)
  );
}

export function normalizePayPeriods(value) {
  if (!Array.isArray(value)) return DEFAULT_PAY_PERIODS.map((period) => ({ ...period }));
  const periods = [];
  const used = new Set();
  let cursor = 1;
  for (const item of value) {
    if (periods.length >= 6) break;
    const startDay = dayNumber(item?.startDay);
    const endDay = dayNumber(item?.endDay);
    if (!startDay || !endDay || endDay < startDay || startDay < cursor) continue;
    let id = String(item?.id ?? '');
    if (!/^[1-9]$/.test(id) || used.has(id)) {
      id = '1';
      while (used.has(id) && Number(id) < 9) id = String(Number(id) + 1);
      if (used.has(id)) continue;
    }
    used.add(id);
    periods.push({ id, startDay, endDay });
    cursor = endDay + 1;
  }
  if (!periods.length) return DEFAULT_PAY_PERIODS.map((period) => ({ ...period }));
  return periods;
}

// Clock time when a pay period stops accepting notes and reasons.
export function normalizePeriodEndsAt(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return '23:59';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return '23:59';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function payPeriodPreset(periods) {
  const rows = normalizePayPeriods(periods);
  if (samePeriodDays(rows, DEFAULT_PAY_PERIODS)) return 'split';
  if (samePeriodDays(rows, WHOLE_MONTH_PAY_PERIODS)) return 'month';
  return 'custom';
}

function payLineIdFor(label, taken) {
  const base = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'status';
  let id = `pay-${base}`.slice(0, 36);
  let n = 2;
  while (taken.has(id) || !isPayLineId(id)) {
    id = `pay-${base}-${n}`.slice(0, 36);
    n += 1;
    if (n > 40) return '';
  }
  return id;
}

function clip(value, fallback, max) {
  const text = String(value ?? '').trim().slice(0, max);
  return text || fallback;
}

function otFactor(value, fallback) {
  const number = Number(value);
  if (number === 0) return 0;
  if (!Number.isFinite(number) || number < 1 || number > 3) return fallback;
  return Math.round(number * 100) / 100;
}

// A typed day cell. Blank clears the cell. Zero stays 0.00.
// Other values snap to the nearest quarter hour.
export function snapSummaryHours(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || number > 24) return '';
  return (Math.round(number * 4) / 4).toFixed(2);
}

export function normalizeDriverPay(value) {
  const source = value && typeof value === 'object' ? value : {};
  const serial = String(source.serial ?? '').trim();
  const rateText = String(source.rate ?? '')
    .trim()
    .replace(/^\$/, '')
    .replace(/,/g, '');
  const rate = /^\d+(\.\d+)?$/.test(rateText) ? rateText.replace(/^0+(?=\d)/, '') : '';
  const account = String(source.account ?? '').trim();
  return { serial, rate, account };
}

// Pay statuses a driver may clock. A missing or empty list means EX DRIVER only.
export function normalizeDriverPayStatuses(value, known) {
  const allowed = known instanceof Set ? known : null;
  if (!Array.isArray(value)) return [DEFAULT_DRIVER_PAY_STATUS];
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    const id = String(item ?? '').trim();
    if (!isPayLineId(id) || seen.has(id)) continue;
    if (allowed && !allowed.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 24) break;
  }
  if (ids.length) return ids;
  if (allowed && !allowed.has(DEFAULT_DRIVER_PAY_STATUS)) return [];
  return [DEFAULT_DRIVER_PAY_STATUS];
}

// Catalog rows this driver can clock, in catalog order.
export function driverPayStatusChoices(saved, lines) {
  const catalog = Array.isArray(lines) ? lines : [];
  const known = new Set(catalog.map((line) => line.id));
  const byId = new Map(catalog.map((line) => [line.id, line]));
  const choices = normalizeDriverPayStatuses(saved, known)
    .map((id) => byId.get(id))
    .filter(Boolean);
  if (choices.length) return choices;
  const fallback = byId.get(DEFAULT_DRIVER_PAY_STATUS);
  return fallback ? [fallback] : [];
}

// True when EX DRIVER is this driver's only pay status.
// A driver with nothing saved counts as EX DRIVER only.
export function isExDriverOnly(saved, lines) {
  const ids = Array.isArray(lines)
    ? driverPayStatusChoices(saved, lines).map((line) => line.id)
    : normalizeDriverPayStatuses(saved);
  return ids.length === 1 && ids[0] === DEFAULT_DRIVER_PAY_STATUS;
}

// Clock-in choices on the timeclock, in the order drivers see them.
export const CLOCK_IN_TYPES = [
  { id: 'AM', label: 'AM route' },
  { id: 'MIDDAY', label: 'Mid day route' },
  { id: 'PM', label: 'PM route' },
  { id: 'OTHER', label: 'Other' },
];

// Pay status for each clock-in.
// One pay status needs no map. Several pay statuses use the first status wherever a clock-in is unset.
export function normalizePayStatusByRun(value, allowed) {
  const ids = normalizeDriverPayStatuses(Array.isArray(allowed) ? allowed : []);
  if (ids.length < 2) return {};
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const map = {};
  for (const type of CLOCK_IN_TYPES) {
    const picked = String(source[type.id] ?? '').trim();
    map[type.id] = ids.includes(picked) ? picked : ids[0];
  }
  return map;
}

// Pay status written on a clock in or clock out.
// A driver with one pay status uses it for every clock-in.
export function payStatusForClockIn(payStatuses, payStatusByRun, run, lines) {
  const choices = Array.isArray(lines)
    ? driverPayStatusChoices(payStatuses, lines)
    : normalizeDriverPayStatuses(payStatuses).map((id) => ({ id, label: id }));
  const fallback = choices[0]?.id || DEFAULT_DRIVER_PAY_STATUS;
  if (choices.length < 2) return fallback;
  const key = String(run ?? '').trim().toUpperCase();
  const map = normalizePayStatusByRun(
    payStatusByRun,
    choices.map((line) => line.id)
  );
  return map[key] || fallback;
}

const PAY_PORTION_LIMIT = 8;

function minuteStamp(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()).getTime();
}

// Parts of a clock period saved on the clock in.
// Each part has its own pay status. Time outside the parts keeps the period's pay status.
export function normalizeStoredPayPortions(value) {
  if (!Array.isArray(value)) return [];
  const portions = [];
  for (const item of value) {
    if (portions.length >= PAY_PORTION_LIMIT) break;
    const status = String(item?.pay_status ?? '').trim();
    const start = new Date(item?.start);
    const end = new Date(item?.end);
    if (!isPayLineId(status) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end.getTime() - start.getTime() < 60000) continue;
    portions.push({ start: start.toISOString(), end: end.toISOString(), pay_status: status });
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

// Keep only the parts that sit inside one clock period and use an allowed pay status.
// A start or end in the same minute as the period edge counts as that edge.
export function normalizePayPortions(value, periodStart, periodEnd, allowed) {
  const startMs = periodStart?.getTime?.();
  const endMs = periodEnd?.getTime?.();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  const ids = Array.isArray(allowed) ? allowed.filter((id) => isPayLineId(id)) : null;
  return normalizeStoredPayPortions(value).flatMap((portion) => {
    if (ids && !ids.includes(portion.pay_status)) return [];
    const fromDate = new Date(portion.start);
    const toDate = new Date(portion.end);
    const from = minuteStamp(fromDate) === minuteStamp(periodStart) ? startMs : fromDate.getTime();
    const to = minuteStamp(toDate) === minuteStamp(periodEnd) ? endMs : toDate.getTime();
    if (from < startMs || to > endMs || to - from < 60000) return [];
    return [{ start: new Date(from).toISOString(), end: new Date(to).toISOString(), pay_status: portion.pay_status }];
  });
}

// Why a set of parts cannot be saved, or an empty string when they can.
export function payPortionError(portions, periodStart, periodEnd, allowed) {
  const list = Array.isArray(portions) ? portions : [];
  if (!list.length) return '';
  if (list.length > PAY_PORTION_LIMIT) return `A period can have ${PAY_PORTION_LIMIT} parts.`;
  const startMs = periodStart?.getTime?.();
  const endMs = periodEnd?.getTime?.();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 'Clock out before assigning part of the period.';
  }
  const ids = Array.isArray(allowed) ? new Set(allowed.filter((id) => isPayLineId(id))) : null;
  const checked = [];
  for (const portion of list) {
    const status = String(portion?.pay_status ?? '').trim();
    if (!isPayLineId(status) || (ids && !ids.has(status))) return 'Choose a pay status for each part.';
    const fromDate = new Date(portion?.start);
    const toDate = new Date(portion?.end);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 'Each part needs a start and an end.';
    const from = minuteStamp(fromDate) === minuteStamp(periodStart) ? startMs : fromDate.getTime();
    const to = minuteStamp(toDate) === minuteStamp(periodEnd) ? endMs : toDate.getTime();
    if (to - from < 60000) return 'A part has to end after it starts.';
    if (from < startMs || to > endMs) return 'Each part has to sit inside the clock period.';
    checked.push({ from, to });
  }
  checked.sort((a, b) => a.from - b.from || a.to - b.to);
  for (let index = 1; index < checked.length; index += 1) {
    if (checked[index].from < checked[index - 1].to) return 'Those parts overlap.';
  }
  return '';
}

// Pay-status slices of one clock in and clock out.
// Parts use their own status. The rest of the period uses the clock in's pay status.
export function paySlicesForPair(pair) {
  const start = pair.start <= pair.end ? pair.start : pair.end;
  const end = pair.start <= pair.end ? pair.end : pair.start;
  const fallback = isPayLineId(pair.clockIn?.pay_status) ? String(pair.clockIn.pay_status) : 'reg-driver';
  const elapsed = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const portions = normalizePayPortions(pair.clockIn?.pay_portions, start, end);
  if (!portions.length || elapsed <= 0) {
    return [{ start, end, pay_status: fallback, minutes: elapsed }];
  }
  const slices = [];
  let cursor = start.getTime();
  for (const portion of portions) {
    const from = new Date(portion.start).getTime();
    const to = new Date(portion.end).getTime();
    if (from > cursor) {
      slices.push({
        start: new Date(cursor),
        end: new Date(from),
        pay_status: fallback,
        minutes: Math.round((from - cursor) / 60000),
      });
    }
    slices.push({
      start: new Date(Math.max(from, cursor)),
      end: new Date(to),
      pay_status: portion.pay_status,
      minutes: Math.round((to - Math.max(from, cursor)) / 60000),
    });
    cursor = Math.max(cursor, to);
  }
  if (cursor < end.getTime()) {
    slices.push({
      start: new Date(cursor),
      end,
      pay_status: fallback,
      minutes: Math.round((end.getTime() - cursor) / 60000),
    });
  }
  const merged = [];
  for (const slice of slices) {
    if (slice.minutes <= 0) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.pay_status === slice.pay_status) {
      previous.end = slice.end;
      previous.minutes += slice.minutes;
      continue;
    }
    merged.push({ ...slice });
  }
  if (merged.length <= 1) {
    return [{ start, end, pay_status: merged[0]?.pay_status || fallback, minutes: elapsed }];
  }
  return merged;
}

export function normalizeClockPayDefaults(value) {
  const source = value && typeof value === 'object' ? value : {};
  const savedLines = Array.isArray(source.lines) ? source.lines : [];
  const byId = new Map(
    savedLines
      .filter((line) => line && BUILTIN_LINE_IDS.has(String(line.id)))
      .map((line) => [String(line.id), line])
  );
  const lines = DEFAULT_PAY_LINES.map((line) => {
    const saved = byId.get(line.id);
    return {
      id: line.id,
      label: line.label,
      otFactor: otFactor(saved?.otFactor, line.otFactor),
      fillsFromClock: line.fillsFromClock,
      custom: false,
    };
  });
  const taken = new Set(lines.map((line) => line.id));
  for (const saved of savedLines) {
    if (!saved || BUILTIN_LINE_IDS.has(String(saved.id))) continue;
    const label = clip(saved.label, '', 40);
    if (!label) continue;
    let id = String(saved.id || '');
    if (!isPayLineId(id) || BUILTIN_LINE_IDS.has(id) || taken.has(id)) id = payLineIdFor(label, taken);
    if (!id || taken.has(id)) continue;
    taken.add(id);
    lines.push({
      id,
      label,
      otFactor: otFactor(saved.otFactor, 0),
      fillsFromClock: false,
      custom: true,
    });
  }
  return {
    jobTitle: clip(source.jobTitle, DEFAULT_JOB_TITLE, 40),
    location: clip(source.location, DEFAULT_LOCATION, 40),
    periods: normalizePayPeriods(source.periods),
    periodEndsAt: normalizePeriodEndsAt(source.periodEndsAt),
    lines,
  };
}

export function normalizeTimeSummaryEdits(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const edits = {};
  for (const [driverId, periods] of Object.entries(value)) {
    const id = String(driverId).trim().slice(0, 80);
    if (!id || !periods || typeof periods !== 'object' || Array.isArray(periods)) continue;
    const periodOut = {};
    for (const [periodKey, lines] of Object.entries(periods)) {
      if (!/^\d{4}-\d{2}-[1-9]$/.test(periodKey)) continue;
      if (!lines || typeof lines !== 'object' || Array.isArray(lines)) continue;
      const lineOut = {};
      for (const [lineId, entry] of Object.entries(lines)) {
        if (!isPayLineId(lineId)) continue;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const days = {};
        const sourceDays = entry.days && typeof entry.days === 'object' ? entry.days : {};
        for (const [day, hours] of Object.entries(sourceDays)) {
          const dayNumber = Number(day);
          if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) continue;
          const snapped = snapSummaryHours(hours);
          if (!snapped) continue;
          days[String(dayNumber)] = snapped;
        }
        const comment = String(entry.comment ?? '').trim().slice(0, 200);
        if (!Object.keys(days).length && !comment) continue;
        lineOut[lineId] = {
          ...(Object.keys(days).length ? { days } : {}),
          ...(comment ? { comment } : {}),
        };
      }
      if (Object.keys(lineOut).length) periodOut[periodKey] = lineOut;
    }
    if (Object.keys(periodOut).length) edits[id] = periodOut;
  }
  return edits;
}

// Local typed cells win. A cell that exists only on the shared copy stays.
export function mergeTimeSummaryEdits(remote, local) {
  const base = normalizeTimeSummaryEdits(remote);
  const over = normalizeTimeSummaryEdits(local);
  for (const [driverId, periods] of Object.entries(over)) {
    base[driverId] = base[driverId] || {};
    for (const [periodKey, lines] of Object.entries(periods)) {
      base[driverId][periodKey] = base[driverId][periodKey] || {};
      for (const [lineId, entry] of Object.entries(lines)) {
        const previous = base[driverId][periodKey][lineId] || {};
        const next = {
          days: { ...(previous.days || {}), ...(entry.days || {}) },
        };
        const comment = entry.comment || previous.comment;
        if (comment) next.comment = comment;
        base[driverId][periodKey][lineId] = next;
      }
    }
  }
  return normalizeTimeSummaryEdits(base);
}

export function applyTimeSummaryEdit(edits, edit) {
  const next = normalizeTimeSummaryEdits(edits);
  const driverId = String(edit?.driverId ?? '').trim().slice(0, 80);
  const periodKey = String(edit?.periodKey ?? '');
  const lineId = String(edit?.lineId ?? '');
  if (!driverId || !/^\d{4}-\d{2}-[1-9]$/.test(periodKey) || !isPayLineId(lineId)) return next;
  next[driverId] = next[driverId] || {};
  next[driverId][periodKey] = next[driverId][periodKey] || {};
  const entry = {
    days: { ...(next[driverId][periodKey][lineId]?.days || {}) },
    ...(next[driverId][periodKey][lineId]?.comment
      ? { comment: next[driverId][periodKey][lineId].comment }
      : {}),
  };
  if (edit.kind === 'comment') {
    const comment = String(edit.comment ?? '').trim().slice(0, 200);
    if (comment) entry.comment = comment;
    else delete entry.comment;
  } else {
    const dayNumber = Number(edit.day);
    if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) return next;
    const hours = snapSummaryHours(edit.hours);
    if (hours) entry.days[String(dayNumber)] = hours;
    else delete entry.days[String(dayNumber)];
  }
  if (!Object.keys(entry.days).length && !entry.comment) {
    delete next[driverId][periodKey][lineId];
  } else {
    next[driverId][periodKey][lineId] = entry;
  }
  return normalizeTimeSummaryEdits(next);
}
