/**
 * Pay details for the district Monthly Time Summary.
 * Office defaults cover the job title, location, pay-period dates,
 * and the pay-status lines. A serial number, hourly rate, and payroll
 * account number belong to one driver. A pay status does not have an account.
 */

export const DEFAULT_JOB_TITLE = 'Driver';
export const DEFAULT_LOCATION = 'Transportation';

/** Pay status checked for a driver who has none saved. */
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

/** Days 1–15, then the 16th through the last day of the month. */
export const DEFAULT_PAY_PERIODS = [
  { id: '1', startDay: 1, endDay: 15 },
  { id: '2', startDay: 16, endDay: 31 },
];

/** One sheet for the whole month. Day 31 means the last day that month has. */
export const WHOLE_MONTH_PAY_PERIODS = [{ id: '1', startDay: 1, endDay: 31 }];

const BUILTIN_LINE_IDS = new Set(DEFAULT_PAY_LINES.map((line) => line.id));
const LINE_ID_PATTERN = /^(?:reg-driver|ot-trainer|ex-trainer|ex-driver|pay-[a-z0-9-]{1,32})$/;

/**
 * @param {string} id
 */
export function isPayLineId(id) {
  return LINE_ID_PATTERN.test(id);
}

/**
 * @param {unknown} value
 */
function dayNumber(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 31) return 0;
  return number;
}

/**
 * @param {Array<{ startDay: number, endDay: number }>} rows
 * @param {Array<{ startDay: number, endDay: number }>} preset
 */
function samePeriodDays(rows, preset) {
  return (
    rows.length === preset.length &&
    rows.every((row, index) => row.startDay === preset[index].startDay && row.endDay === preset[index].endDay)
  );
}

/**
 * @param {unknown} value
 */
export function normalizePayPeriods(value) {
  if (!Array.isArray(value)) return DEFAULT_PAY_PERIODS.map((period) => ({ ...period }));
  /** @type {Array<{ id: string, startDay: number, endDay: number }>} */
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

/**
 * @param {unknown} periods
 * @returns {'split' | 'month' | 'custom'}
 */
export function payPeriodPreset(periods) {
  const rows = normalizePayPeriods(periods);
  if (samePeriodDays(rows, DEFAULT_PAY_PERIODS)) return 'split';
  if (samePeriodDays(rows, WHOLE_MONTH_PAY_PERIODS)) return 'month';
  return 'custom';
}

/**
 * @param {string} label
 * @param {Set<string>} taken
 */
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

/**
 * @param {unknown} value
 * @param {string} fallback
 * @param {number} max
 */
function clip(value, fallback, max) {
  const text = String(value ?? '').trim().slice(0, max);
  return text || fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function otFactor(value, fallback) {
  const number = Number(value);
  if (number === 0) return 0;
  if (!Number.isFinite(number) || number < 1 || number > 3) return fallback;
  return Math.round(number * 100) / 100;
}

/**
 * A typed day cell. Blank clears the cell. Zero stays 0.00.
 * Other values snap to the nearest quarter hour.
 * @param {unknown} value
 */
export function snapSummaryHours(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || number > 24) return '';
  return (Math.round(number * 4) / 4).toFixed(2);
}

/**
 * @param {unknown} value
 */
export function normalizeDriverPay(value) {
  const source = value && typeof value === 'object' ? value : {};
  const serial = String(source.serial ?? '').trim().slice(0, 20);
  const rateText = String(source.rate ?? '')
    .trim()
    .replace(/^\$/, '');
  const rate = /^\d{1,4}(\.\d{1,2})?$/.test(rateText) ? rateText : '';
  const account = String(source.account ?? '').trim().slice(0, 40);
  return { serial, rate, account };
}

/**
 * Pay statuses a driver may clock. A missing or empty list means EX DRIVER only.
 * @param {unknown} value
 * @param {Set<string>} [known]
 */
export function normalizeDriverPayStatuses(value, known) {
  const allowed = known instanceof Set ? known : null;
  if (!Array.isArray(value)) return [DEFAULT_DRIVER_PAY_STATUS];
  /** @type {string[]} */
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

/**
 * Catalog rows this driver can clock, in catalog order.
 * @param {unknown} saved
 * @param {Array<{ id: string, label: string }>} lines
 */
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

/**
 * True when EX DRIVER is this driver's only pay status.
 * A driver with nothing saved counts as EX DRIVER only.
 * @param {unknown} saved
 * @param {Array<{ id: string }> | undefined} [lines]
 */
export function isExDriverOnly(saved, lines) {
  const ids = Array.isArray(lines)
    ? driverPayStatusChoices(saved, lines).map((line) => line.id)
    : normalizeDriverPayStatuses(saved);
  return ids.length === 1 && ids[0] === DEFAULT_DRIVER_PAY_STATUS;
}

/**
 * @param {unknown} value
 */
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
    lines,
  };
}

/**
 * @param {unknown} value
 */
export function normalizeTimeSummaryEdits(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  /** @type {Record<string, Record<string, Record<string, { days?: Record<string, string>, comment?: string }>>>} */
  const edits = {};
  for (const [driverId, periods] of Object.entries(value)) {
    const id = String(driverId).trim().slice(0, 80);
    if (!id || !periods || typeof periods !== 'object' || Array.isArray(periods)) continue;
    /** @type {Record<string, Record<string, { days?: Record<string, string>, comment?: string }>>} */
    const periodOut = {};
    for (const [periodKey, lines] of Object.entries(periods)) {
      if (!/^\d{4}-\d{2}-[1-9]$/.test(periodKey)) continue;
      if (!lines || typeof lines !== 'object' || Array.isArray(lines)) continue;
      /** @type {Record<string, { days?: Record<string, string>, comment?: string }>} */
      const lineOut = {};
      for (const [lineId, entry] of Object.entries(lines)) {
        if (!isPayLineId(lineId)) continue;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        /** @type {Record<string, string>} */
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

/**
 * Local typed cells win. A cell that exists only on the shared copy stays.
 * @param {unknown} remote
 * @param {unknown} local
 */
export function mergeTimeSummaryEdits(remote, local) {
  const base = normalizeTimeSummaryEdits(remote);
  const over = normalizeTimeSummaryEdits(local);
  for (const [driverId, periods] of Object.entries(over)) {
    base[driverId] = base[driverId] || {};
    for (const [periodKey, lines] of Object.entries(periods)) {
      base[driverId][periodKey] = base[driverId][periodKey] || {};
      for (const [lineId, entry] of Object.entries(lines)) {
        const previous = base[driverId][periodKey][lineId] || {};
        /** @type {{ days?: Record<string, string>, comment?: string }} */
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

/**
 * @param {unknown} edits
 * @param {{
 *   driverId?: string,
 *   periodKey?: string,
 *   lineId?: string,
 *   kind?: string,
 *   day?: string | number,
 *   hours?: string,
 *   comment?: string,
 * }} edit
 */
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
