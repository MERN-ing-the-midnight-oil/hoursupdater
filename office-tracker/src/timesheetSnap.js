import {
  normalizeContractSnapBreaks,
  snapContractClockToBreaks,
} from '../../src/logic/timeUtils.js';
import {
  inferDefaultYear,
  parseLegacyStampToDate,
  parseStampParts,
} from './timesheetNormalize.js';

/**
 * Snap one Date with the office contract minute bands.
 * @param {Date} date
 * @param {object | null | undefined} breaks
 */
export function snapContractDate(date, breaks) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const band = normalizeContractSnapBreaks(breaks);
  const hour = date.getHours();
  const minute = date.getMinutes();
  const clock = `${hour}:${String(minute).padStart(2, '0')}`;
  const snappedClock = snapContractClockToBreaks(clock, band);
  const [snappedHour, snappedMinute] = snappedClock.split(':').map(Number);
  const out = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    snappedHour,
    snappedMinute,
    0,
    0
  );
  // :52–:59 on the 23rd hour snaps to 0:00 the next day.
  if (minute >= band.toNextHour && hour === 23 && snappedHour === 0) {
    out.setDate(out.getDate() + 1);
  }
  return out;
}

/**
 * @param {Date} date
 */
export function formatSnappedClock(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  let hour = date.getHours();
  const minute = date.getMinutes();
  const period = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${period}`;
}

/**
 * @param {Date} start
 * @param {Date} end
 */
export function hoursBetweenSnapped(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return null;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  let ms = end.getTime() - start.getTime();
  if (ms < 0) ms += 24 * 60 * 60 * 1000;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/**
 * Snap Out/In for one card slot and compute Tot. Hrs. from those snapped clocks.
 * @param {object | null | undefined} row
 * @param {object | null | undefined} breaks
 * @param {number | null | undefined} defaultYear
 */
export function snapRoundedForRow(row, breaks, defaultYear) {
  const year = defaultYear ?? inferDefaultYear(null);
  const outRaw = String(row?.clock_out_raw ?? '').trim();
  const inRaw = String(row?.clock_in_raw ?? '').trim();
  const outIllegible = parseStampParts(outRaw).illegible;
  const inIllegible = parseStampParts(inRaw).illegible;

  const outDate =
    outRaw && !outIllegible ? parseLegacyStampToDate(outRaw, year) : null;
  const inDate = inRaw && !inIllegible ? parseLegacyStampToDate(inRaw, year) : null;
  const snappedOut = outDate ? snapContractDate(outDate, breaks) : null;
  const snappedIn = inDate ? snapContractDate(inDate, breaks) : null;

  return {
    outLabel: outIllegible
      ? 'illegible'
      : snappedOut
        ? formatSnappedClock(snappedOut)
        : outRaw
          ? '—'
          : '',
    inLabel: inIllegible
      ? 'illegible'
      : snappedIn
        ? formatSnappedClock(snappedIn)
        : inRaw
          ? '—'
          : '',
    outIllegible,
    inIllegible,
    totalHours:
      snappedOut && snappedIn ? hoursBetweenSnapped(snappedOut, snappedIn) : null,
  };
}
