import { formatClockAmPm } from '../../employee-tracker/src/clockTimes.js';
import { parseClockTime } from '../../src/logic/timeUtils.js';
import { contractRunParts } from './timesheetGenieCard.js';
import {
  formatStampParts,
  inferDefaultYear,
  parseLegacyStampToDate,
  parseStampParts,
} from './timesheetNormalize.js';
import {
  cardStampSpan,
  normalizeTimesheetHoursMode,
  snapRoundedForRow,
  snapsForCardRows,
  TIMESHEET_HOURS_MODE_QUARTER,
} from './timesheetSnap.js';

export const RUN_WINDOWS_KEY = 'teamster-timesheet-run-windows';

// A pair's start time picks the run. The cutoffs are exclusive:
// AM is before amBefore, MID is after midAfter and before midBefore, PM is after pmAfter.
// Checked in that order, so an overlapping window uses the earlier run.
export const DEFAULT_RUN_WINDOWS = Object.freeze({
  amBefore: 8 * 60,
  midAfter: 9 * 60,
  midBefore: 11 * 60,
  pmAfter: 11 * 60 + 30,
});

/**
 * @param {number} minutes
 */
export function minutesToTimeValue(minutes) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(minutes) || 0)));
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function timeValueToMinutes(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * @param {number} minutes
 */
export function formatWindowClock(minutes) {
  const total = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(minutes) || 0)));
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  let hour = hour24 % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${period}`;
}

/**
 * @param {unknown} value
 */
export function normalizeRunWindows(value) {
  const source = value && typeof value === 'object' ? value : {};
  const pick = (key) => {
    const raw = source[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      const minutes = Math.round(raw);
      if (minutes >= 0 && minutes <= 23 * 60 + 59) return minutes;
    }
    const parsed = timeValueToMinutes(raw);
    return parsed == null ? DEFAULT_RUN_WINDOWS[key] : parsed;
  };
  return {
    amBefore: pick('amBefore'),
    midAfter: pick('midAfter'),
    midBefore: pick('midBefore'),
    pmAfter: pick('pmAfter'),
  };
}

/**
 * @param {Date | null | undefined} date
 * @param {unknown} windows
 * @returns {'AM' | 'MID' | 'PM' | ''}
 */
export function runForStartDate(date, windows) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const minutes = date.getHours() * 60 + date.getMinutes();
  const rules = normalizeRunWindows(windows);
  if (minutes < rules.amBefore) return 'AM';
  if (minutes > rules.midAfter && minutes < rules.midBefore) return 'MID';
  if (minutes > rules.pmAfter) return 'PM';
  return '';
}

/**
 * @param {unknown} value
 */
export function formatRunHours(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const rounded = Math.round(number * 100) / 100;
  if (rounded === 0) return '0';
  return String(rounded);
}

/** Header field that stores one run's contract hours. */
export const RUN_CONTRACT_FIELD = Object.freeze({
  AM: 'contract_am_hours',
  MID: 'contract_midday_hours',
  PM: 'contract_pm_hours',
});

/**
 * Run column text. Unclassified pairs stay a dash.
 * @param {string | null | undefined} run
 */
export function formatRunTitle(run) {
  if (run !== 'AM' && run !== 'MID' && run !== 'PM') return '—';
  return run;
}

/**
 * Run column text: the run title, then that run's contract hours.
 * Unclassified pairs stay a dash. A run with no sticker contract shows the title only.
 * @param {string | null | undefined} run
 * @param {number | null | undefined} contract
 */
export function formatRunLabel(run, contract) {
  if (run !== 'AM' && run !== 'MID' && run !== 'PM') return '—';
  if (contract == null || contract === '') return run;
  const hours = formatRunHours(contract);
  return hours ? `${run} ${hours}` : run;
}

/**
 * Hours typed into the contract column. Empty clears the run.
 * A trailing dot is still being typed. Zero is a real contract.
 * @param {unknown} value
 * @returns {{ ok: true, hours: number | null } | { ok: false, hours: null }}
 */
export function parseRunContractInput(value) {
  const text = String(value ?? '').trim();
  if (!text) return { ok: true, hours: null };
  if (!/^\d+(?:\.\d+)?$/.test(text)) return { ok: false, hours: null };
  const number = Math.round(Number(text) * 100) / 100;
  if (!Number.isFinite(number) || number < 0 || number > 24) return { ok: false, hours: null };
  return { ok: true, hours: number };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function comparableContractHours(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number * 100) / 100;
  if (rounded < 0) return null;
  return rounded;
}

/**
 * True when the card's contract for a run is not the hours Time Changes has.
 * No known hours means there is nothing to compare.
 * @param {unknown} cardHours
 * @param {unknown} knownHours
 */
export function contractHoursDiffer(cardHours, knownHours) {
  const known = comparableContractHours(knownHours);
  if (known == null) return false;
  const card = comparableContractHours(cardHours);
  if (card == null) return true;
  return card !== known;
}

/**
 * Explanation for the contract-mismatch warning.
 * @param {{
 *   run?: string,
 *   cardHours?: unknown,
 *   knownHours?: unknown,
 *   driver?: string,
 *   route?: string,
 *   asOf?: string,
 * }} detail
 */
function hoursPhrase(value) {
  const text = formatRunHours(value);
  if (!text) return '0 hours';
  return text === '1' ? '1 hour' : `${text} hours`;
}

export function contractMismatchNote(detail) {
  const run =
    detail?.run === 'TOTAL'
      ? 'total'
      : detail?.run === 'AM' || detail?.run === 'MID' || detail?.run === 'PM'
        ? detail.run
        : 'Run';
  const cardHours = comparableContractHours(detail?.cardHours);
  const card = cardHours == null ? 'blank' : hoursPhrase(cardHours);
  const known = hoursPhrase(detail?.knownHours);
  const driver = String(detail?.driver || '').trim();
  const route = String(detail?.route || '').trim();
  const place = [driver, route ? `route ${route}` : ''].filter(Boolean).join(', ');
  const asOf = String(detail?.asOf || '').trim();
  const where = `${place ? ` for ${place}` : ''}${asOf ? ` as of ${asOf}` : ''}`;
  return `The ${run} contract on this card is ${card}. Time Changes has ${known}${where}. Tot. Hrs., Reg, and OT use these sticker hours.`;
}

/**
 * Contract hours for one run. Null when the sticker has no AM / midday / PM parts.
 * A missing run among parts that do exist is 0, so that work is all extra.
 * @param {object | null | undefined} source
 * @param {'AM' | 'MID' | 'PM' | ''} run
 * @returns {number | null}
 */
export function contractHoursForRun(source, run) {
  if (run !== 'AM' && run !== 'MID' && run !== 'PM') return null;
  const parts = contractRunParts(source);
  if (!parts) return null;
  if (run === 'AM') return parts.am;
  if (run === 'MID') return parts.midday;
  return parts.pm;
}

function roundHours(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * One slot per card row. A completed clock pair owns the first line and
 * continues through the last line that belongs to it, including blanks between
 * an Out and its In. Continuation slots draw no cells so the pair can span them.
 * @param {object[] | null | undefined} rows
 * @param {object[] | null | undefined} snaps
 * @param {unknown} windows
 * @param {object | null | undefined} contractSource
 */
export function runTableSlots(rows, snaps, windows, contractSource) {
  const list = Array.isArray(rows) ? rows : [];
  const snapList = Array.isArray(snaps) ? snaps : [];
  const count = Math.max(list.length, snapList.length);
  /** @type {object[]} */
  const slots = [];
  const consumed = new Set();
  for (let index = 0; index < count; index += 1) {
    if (consumed.has(index)) continue;
    const row = list[index];
    const snap = snapList[index];
    const complete =
      row &&
      !row.crossed_out &&
      snap &&
      snap.spanOwner === index &&
      snap.spanStart instanceof Date &&
      !Number.isNaN(snap.spanStart.getTime()) &&
      snap.totalHours != null;
    if (!complete) {
      slots.push({
        index: index + 1,
        role: 'blank',
        rowspan: 1,
        run: '',
        duration: null,
        extra: null,
        contract: null,
        start: null,
        endIndex: index,
      });
      continue;
    }
    let end = index;
    for (let next = index + 1; next < count; next += 1) {
      if (snapList[next]?.spanOwner === index) end = next;
    }
    for (let next = index + 1; next <= end; next += 1) consumed.add(next);
    const run = runForStartDate(snap.spanStart, windows);
    const duration = snap.totalHours;
    const contract = contractHoursForRun(contractSource, run);
    const extra = run && contract != null ? roundHours(duration - contract) : null;
    slots.push({
      index: index + 1,
      role: 'pair',
      rowspan: end - index + 1,
      run,
      duration,
      extra,
      contract,
      start: snap.spanStart,
      endIndex: end,
    });
    for (let next = index + 1; next <= end; next += 1) {
      slots.push({
        index: next + 1,
        role: 'continue',
        rowspan: 1,
        run: '',
        duration: null,
        extra: null,
        contract: null,
        start: null,
        endIndex: next,
      });
    }
  }
  return slots;
}

/**
 * Start punches that are earlier than that run's Time Changes clock-in and
 * that add at least a quarter hour under the active hours mode.
 * On the blue card the start is usually the Out (leave). An In is the start
 * only when that stamp is the earlier one. The assigned clock is the unsnapped
 * contract time. Quarter-hour mode rounds the span. Snap mode snaps both
 * clocks, then counts the span. The return stamp stays as written.
 * @param {object[] | null | undefined} rows
 * @param {{
 *   breaks?: object | null,
 *   mode?: string | null,
 *   windows?: object | null,
 *   clocks?: { am?: string, midday?: string, pm?: string } | null,
 *   defaultYear?: number | null,
 * }} [options]
 * @returns {Array<{ index: number, side: 'out' | 'in', title: string }>}
 */
export function earlyClockInMarks(rows, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const clocks = options.clocks;
  if (!clocks) return [];
  const year = options.defaultYear ?? inferDefaultYear(null);
  const mode = normalizeTimesheetHoursMode(options.mode);
  const snaps = snapsForCardRows(list, options.breaks, year, mode);
  const modeName =
    mode === TIMESHEET_HOURS_MODE_QUARTER ? 'Quarter-hour rounding' : 'Snap rounding';
  /** @type {Array<{ index: number, side: 'out' | 'in', title: string }>} */
  const marks = [];
  for (let index = 0; index < list.length; index += 1) {
    const row = list[index];
    const snap = snaps[index];
    if (!row || row.crossed_out || !snap) continue;
    if (snap.spanOwner !== index || snap.totalHours == null) continue;
    if (!(snap.spanStart instanceof Date) || Number.isNaN(snap.spanStart.getTime())) continue;
    let end = index;
    for (let next = index + 1; next < list.length; next += 1) {
      if (snaps[next]?.spanOwner === index) end = next;
    }
    let outIndex = -1;
    let inIndex = -1;
    let outRaw = '';
    let inRaw = '';
    for (let cursor = index; cursor <= end; cursor += 1) {
      const line = list[cursor];
      if (!line || line.crossed_out) continue;
      const out = String(line.clock_out_raw ?? '').trim();
      const inn = String(line.clock_in_raw ?? '').trim();
      if (out && !outRaw) {
        outRaw = out;
        outIndex = cursor;
      }
      if (inn) {
        inRaw = inn;
        inIndex = cursor;
      }
    }
    if (!outRaw || !inRaw) continue;
    const outDate = parseLegacyStampToDate(outRaw, year);
    const inDate = parseLegacyStampToDate(inRaw, year);
    const rawSpan = outDate && inDate ? cardStampSpan(outDate, inDate) : null;
    if (!rawSpan || !outDate || !inDate) continue;
    const startIsOut = rawSpan.start.getTime() === outDate.getTime();
    const startDate = startIsOut ? outDate : inDate;
    const startRaw = startIsOut ? outRaw : inRaw;
    const startIndex = startIsOut ? outIndex : inIndex;
    const side = startIsOut ? 'out' : 'in';
    if (startIndex < 0) continue;
    const run = runForStartDate(snap.spanStart, options.windows);
    const contractClock = contractClockForRun(clocks, run);
    if (!contractClock) continue;
    let contractMinutes;
    try {
      contractMinutes = parseClockTime(contractClock);
    } catch {
      continue;
    }
    const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
    if (startMinutes >= contractMinutes) continue;
    const contractRaw = contractStampFrom(startRaw, contractMinutes);
    if (!contractRaw) continue;
    const hypothetical = snapRoundedForRow(
      startIsOut
        ? { clock_out_raw: contractRaw, clock_in_raw: inRaw }
        : { clock_out_raw: outRaw, clock_in_raw: contractRaw },
      options.breaks,
      year,
      mode
    );
    if (hypothetical.totalHours == null) continue;
    const delta = Math.round((snap.totalHours - hypothetical.totalHours) * 100) / 100;
    if (delta < 0.25) continue;
    const actualLabel = formatClockAmPm(
      `${startDate.getHours()}:${String(startDate.getMinutes()).padStart(2, '0')}`
    );
    const contractLabel = formatClockAmPm(contractClock);
    const stampName = side === 'out' ? 'Out' : 'In';
    marks.push({
      index: startIndex + 1,
      side,
      title:
        `${stampName} ${actualLabel} is earlier than the ${run} Time Changes clock-in (${contractLabel}). ` +
        `${modeName} makes this run ${formatRunHours(snap.totalHours)} hours instead of ${formatRunHours(hypothetical.totalHours)}.`,
    });
  }
  return marks;
}

/**
 * @param {{ am?: string, midday?: string, pm?: string } | null | undefined} clocks
 * @param {string} run
 */
function contractClockForRun(clocks, run) {
  if (run === 'AM') return String(clocks?.am ?? '').trim();
  if (run === 'MID') return String(clocks?.midday ?? '').trim();
  if (run === 'PM') return String(clocks?.pm ?? '').trim();
  return '';
}

/**
 * Same printed date as the In, with the assigned contract clock.
 * @param {string} inRaw
 * @param {number} contractMinutes
 */
function contractStampFrom(inRaw, contractMinutes) {
  const parts = parseStampParts(inRaw);
  if (!parts.month || !parts.day || parts.illegible || parts.handwriting) return null;
  const hour24 = Math.floor(contractMinutes / 60);
  const minute = contractMinutes % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  let hour = hour24 % 12;
  if (hour === 0) hour = 12;
  return formatStampParts({
    month: parts.month,
    day: parts.day,
    period,
    time: `${hour}:${String(minute).padStart(2, '0')}`,
  });
}
