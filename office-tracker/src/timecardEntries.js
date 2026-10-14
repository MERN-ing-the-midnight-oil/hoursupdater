/**
 * Timecard codes on a clock-out. Each code has its own minutes and comment.
 * The minutes are a note on that session. They can add up to less than the
 * session. They cannot add up to more. Pay hours do not use them.
 */

import { pairClockPunches } from '../../src/logic/timesheets.js';
import { normalizePayPeriods } from './driverPay.js';

export const TIMECARD_COMMENT_MAX = 200;
export const TIMECARD_ENTRY_LIMIT = 10;

/**
 * @param {unknown} value
 * @param {Array<{ id: string, label: string }>} [catalog]
 * @returns {Array<{ id: string, label: string, minutes: number, comment: string }>}
 */
export function normalizeTimecardEntries(value, catalog) {
  if (!Array.isArray(value)) return [];
  const labels = new Map(
    (Array.isArray(catalog) ? catalog : [])
      .filter((code) => code && code.id && code.label)
      .map((code) => [String(code.id), String(code.label).trim()])
  );
  /** @type {Array<{ id: string, label: string, minutes: number, comment: string }>} */
  const entries = [];
  const seen = new Set();
  for (const item of value) {
    if (entries.length >= TIMECARD_ENTRY_LIMIT) break;
    const id = String(item?.id || item?.code_id || '').trim();
    const minutes = Number(item?.minutes);
    const comment = String(item?.comment || '').trim().slice(0, TIMECARD_COMMENT_MAX);
    const label = labels.get(id) || String(item?.label || '').trim();
    if (!id || !label || label.length > 120 || seen.has(id)) continue;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) continue;
    seen.add(id);
    entries.push({ id, label, minutes, comment });
  }
  return entries;
}

/**
 * The clock-in this clock-out closes, and the actual minutes between them.
 * @param {object[] | null | undefined} punches
 * @param {string} clockOutId
 * @returns {{ start: Date, end: Date, minutes: number } | null}
 */
export function sessionForClockOut(punches, clockOutId) {
  const list = Array.isArray(punches) ? punches : [];
  const punch = list.find((item) => item?.id === clockOutId);
  if (!punch || punch.action !== 'out' || punch.removed === true) return null;
  const driver = String(punch.driver_name || '').trim().toLowerCase();
  const { pairs } = pairClockPunches(
    list.filter((item) => String(item?.driver_name || '').trim().toLowerCase() === driver)
  );
  const pair = pairs.find((item) => item.clockOut?.id === clockOutId);
  if (!pair) return null;
  const start = pair.start <= pair.end ? pair.start : pair.end;
  const end = pair.start <= pair.end ? pair.end : pair.start;
  return {
    start,
    end,
    minutes: Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)),
  };
}

/**
 * Why these codes cannot be saved, or an empty string when they can.
 * @param {unknown} entries
 * @param {number | null} sessionMinutes
 * @param {Array<{ id: string, label: string }>} catalog
 */
export function timecardEntryError(entries, sessionMinutes, catalog) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return '';
  if (sessionMinutes == null) return 'Clock in before adding timecard codes.';
  if (list.length > TIMECARD_ENTRY_LIMIT) return `A clock-out can have ${TIMECARD_ENTRY_LIMIT} codes.`;
  const ids = new Set((catalog || []).map((code) => code.id));
  const seen = new Set();
  let total = 0;
  for (const entry of list) {
    const id = String(entry?.id || entry?.code_id || '').trim();
    if (!id || (ids.size && !ids.has(id))) return 'Choose a timecard code.';
    if (seen.has(id)) return 'That code is already on this clock-out.';
    seen.add(id);
    const minutes = Number(entry?.minutes);
    if (!Number.isInteger(minutes) || minutes < 1) return 'Enter the time for each code.';
    const comment = String(entry?.comment || '').trim();
    if (comment.length > TIMECARD_COMMENT_MAX) {
      return `A comment can be ${TIMECARD_COMMENT_MAX} characters or fewer.`;
    }
    total += minutes;
  }
  if (total > sessionMinutes) return 'Those times add up to more than this clock session.';
  return '';
}

/**
 * Last moment of the pay period that contains this clock-out.
 * The office periods are used. Day 31 means the last day that month has.
 * @param {Date} clockOut
 * @param {unknown} periods
 * @returns {Date | null}
 */
export function payPeriodDeadline(clockOut, periods) {
  if (!(clockOut instanceof Date) || Number.isNaN(clockOut.getTime())) return null;
  const rows = normalizePayPeriods(periods);
  const day = clockOut.getDate();
  const lastOfMonth = new Date(clockOut.getFullYear(), clockOut.getMonth() + 1, 0).getDate();
  const period = rows.find((item) => day >= item.startDay && day <= Math.min(item.endDay, lastOfMonth));
  if (!period) return null;
  const endDay = Math.min(period.endDay, lastOfMonth);
  return new Date(clockOut.getFullYear(), clockOut.getMonth(), endDay, 23, 59, 59, 999);
}

/**
 * A driver can change codes through the end of that pay period.
 * @param {Date} clockOut
 * @param {unknown} periods
 * @param {Date} [now]
 */
export function payPeriodStillOpen(clockOut, periods, now = new Date()) {
  const deadline = payPeriodDeadline(clockOut, periods);
  if (!deadline) return false;
  return now.getTime() <= deadline.getTime();
}

/**
 * @param {number} minutes
 */
export function formatTimecardMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourText = hours === 1 ? '1 hour' : hours ? `${hours} hours` : '';
  const minuteText = rest === 1 ? '1 minute' : rest ? `${rest} minutes` : '';
  return [hourText, minuteText].filter(Boolean).join(' ') || '0 minutes';
}

/**
 * @param {Array<{ label?: string, minutes?: number, comment?: string }>} entries
 */
export function timecardSummary(entries) {
  return (entries || [])
    .map((entry) => {
      const time = formatTimecardMinutes(Number(entry.minutes) || 0);
      const comment = String(entry.comment || '').trim();
      return [entry.label, time, comment].filter(Boolean).join(' · ');
    })
    .filter(Boolean)
    .join('\n');
}
