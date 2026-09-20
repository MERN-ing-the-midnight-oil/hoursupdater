import {
  parseClockTime,
  parseTimeRange,
} from '../../src/logic/timeUtils.js';

/**
 * Normalize a clock string (from a time input or H:MM) to unpadded "H:MM".
 * @param {string} time
 * @returns {string}
 */
export function normalizeClockTime(time) {
  const minutes = parseClockTime(String(time ?? '').trim());
  return formatClockMinutes(minutes);
}

/**
 * @param {number} minutesSinceMidnight
 * @returns {string}
 */
export function formatClockMinutes(minutesSinceMidnight) {
  if (
    typeof minutesSinceMidnight !== 'number' ||
    Number.isNaN(minutesSinceMidnight) ||
    minutesSinceMidnight < 0 ||
    minutesSinceMidnight >= 24 * 60
  ) {
    throw new Error(`Invalid minutes value: ${minutesSinceMidnight}`);
  }
  const hours = Math.floor(minutesSinceMidnight / 60);
  const minutes = minutesSinceMidnight % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Pad for HTML `<input type="time">`.
 * @param {string} time
 * @returns {string}
 */
export function toTimeInputValue(time) {
  const minutes = parseClockTime(normalizeClockTime(time));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * @param {string} clockIn
 * @param {string} clockOut
 * @returns {string} H:MM-H:MM
 */
export function formatSegmentRange(clockIn, clockOut) {
  return `${normalizeClockTime(clockIn)}-${normalizeClockTime(clockOut)}`;
}

/**
 * @param {string | null | undefined} range
 * @returns {{
 *   clock_in: string,
 *   clock_out: string,
 *   range: string,
 *   duration_minutes: number,
 * } | null}
 */
export function splitSegmentRange(range) {
  if (!range || !String(range).trim()) {
    return null;
  }
  const parsed = parseTimeRange(range);
  return {
    clock_in: formatClockMinutes(parsed.startMinutes),
    clock_out: formatClockMinutes(parsed.endMinutes),
    range: `${formatClockMinutes(parsed.startMinutes)}-${formatClockMinutes(parsed.endMinutes)}`,
    duration_minutes: parsed.durationMinutes,
  };
}

/**
 * @param {number} minutes
 * @returns {string}
 */
export function formatDurationLabel(minutes) {
  if (typeof minutes !== 'number' || Number.isNaN(minutes)) {
    return '—';
  }
  const sign = minutes < 0 ? '−' : '';
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

/**
 * @param {string} iso
 * @returns {string}
 */
export function dayAfter(iso) {
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${iso}`);
  }
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Local civil date (YYYY-MM-DD) — “today” for a personal tracker.
 * @returns {string}
 */
export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
