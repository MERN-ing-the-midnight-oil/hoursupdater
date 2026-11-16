import { contractRunParts } from './timesheetGenieCard.js';

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
