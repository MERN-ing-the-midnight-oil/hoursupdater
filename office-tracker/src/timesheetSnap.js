import {
  normalizeContractSnapBreaks,
  snapContractClockToBreaks,
} from '../../src/logic/timeUtils.js';
import { quarterHoursFromMinutes } from './payrollTimes.js';
import {
  inferDefaultYear,
  parseLegacyStampToDate,
  parseStampParts,
} from './timesheetNormalize.js';

/** Snap each Out/In clock with office minute bands, then Tot. Hrs. from those clocks. */
export const TIMESHEET_HOURS_MODE_SNAP = 'snap';
/** Keep written clocks; Tot. Hrs. is the span rounded to the nearest quarter hour. */
export const TIMESHEET_HOURS_MODE_QUARTER = 'quarter';

/**
 * @param {unknown} value
 * @returns {'snap' | 'quarter'}
 */
export function normalizeTimesheetHoursMode(value) {
  return String(value || '').trim().toLowerCase() === TIMESHEET_HOURS_MODE_QUARTER
    ? TIMESHEET_HOURS_MODE_QUARTER
    : TIMESHEET_HOURS_MODE_SNAP;
}

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
 * Hours from start to end. When end is earlier on the clock, add one day.
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

function localDayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Blue-card span: Out is leave (start), In is return (end).
 * Overnight is decided only by the printed stamp dates — a later In date means
 * the run crossed midnight. Same-date stamps never invent a next day from AM/PM;
 * if In is earlier on that day, the stamps are treated as reversed.
 * @param {Date} outDate
 * @param {Date} inDate
 * @returns {{ start: Date, end: Date } | null}
 */
export function cardStampSpan(outDate, inDate) {
  if (!(outDate instanceof Date) || !(inDate instanceof Date)) return null;
  if (Number.isNaN(outDate.getTime()) || Number.isNaN(inDate.getTime())) return null;
  if (inDate.getTime() >= outDate.getTime()) {
    return { start: new Date(outDate.getTime()), end: new Date(inDate.getTime()) };
  }
  // Same calendar day with In earlier than Out: reversed Out/In on the card.
  if (localDayKey(outDate) === localDayKey(inDate)) {
    return { start: new Date(inDate.getTime()), end: new Date(outDate.getTime()) };
  }
  // In's printed date is before Out's: also reversed across days.
  return { start: new Date(inDate.getTime()), end: new Date(outDate.getTime()) };
}

/**
 * @param {Date} outDate
 * @param {Date} inDate
 */
export function hoursBetweenCardStamps(outDate, inDate) {
  const span = cardStampSpan(outDate, inDate);
  if (!span) return null;
  const ms = span.end.getTime() - span.start.getTime();
  if (ms < 0) return null;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/**
 * @param {Date} outDate
 * @param {Date} inDate
 */
export function quarterHoursBetweenCardStamps(outDate, inDate) {
  const span = cardStampSpan(outDate, inDate);
  if (!span) return null;
  const minutes = (span.end.getTime() - span.start.getTime()) / 60_000;
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  return quarterHoursFromMinutes(minutes);
}

/**
 * Out/In for one card slot and Tot. Hrs. for the active hours mode.
 * Out = leave (start), In = return (end) on the blue paper card.
 * @param {object | null | undefined} row
 * @param {object | null | undefined} breaks
 * @param {number | null | undefined} defaultYear
 * @param {'snap' | 'quarter' | string | null | undefined} [mode]
 */
function blockedStampLabel(parts) {
  if (parts.handwriting) return 'HANDWRITING';
  if (parts.illegible) return 'illegible';
  return null;
}

export function snapRoundedForRow(row, breaks, defaultYear, mode) {
  const hoursMode = normalizeTimesheetHoursMode(mode);
  const year = defaultYear ?? inferDefaultYear(null);
  const outRaw = String(row?.clock_out_raw ?? '').trim();
  const inRaw = String(row?.clock_in_raw ?? '').trim();
  const outParts = parseStampParts(outRaw);
  const inParts = parseStampParts(inRaw);
  const outBlocked = blockedStampLabel(outParts);
  const inBlocked = blockedStampLabel(inParts);
  const outIllegible = Boolean(outParts.illegible || outParts.handwriting);
  const inIllegible = Boolean(inParts.illegible || inParts.handwriting);

  const outDate =
    outRaw && !outBlocked ? parseLegacyStampToDate(outRaw, year) : null;
  const inDate = inRaw && !inBlocked ? parseLegacyStampToDate(inRaw, year) : null;
  const useExact = hoursMode === TIMESHEET_HOURS_MODE_QUARTER;
  const displayOut = useExact
    ? outDate
    : outDate
      ? snapContractDate(outDate, breaks)
      : null;
  const displayIn = useExact
    ? inDate
    : inDate
      ? snapContractDate(inDate, breaks)
      : null;
  const span =
    displayOut && displayIn ? cardStampSpan(displayOut, displayIn) : null;
  const totalHours =
    outBlocked || inBlocked || !displayOut || !displayIn
      ? null
      : useExact
        ? quarterHoursBetweenCardStamps(displayOut, displayIn)
        : hoursBetweenCardStamps(displayOut, displayIn);

  return {
    mode: hoursMode,
    outLabel: outBlocked
      ? outBlocked
      : displayOut
        ? formatSnappedClock(displayOut)
        : outRaw
          ? '—'
          : '',
    inLabel: inBlocked
      ? inBlocked
      : displayIn
        ? formatSnappedClock(displayIn)
        : inRaw
          ? '—'
          : '',
    outIllegible,
    inIllegible,
    outHandwriting: Boolean(outParts.handwriting),
    inHandwriting: Boolean(inParts.handwriting),
    snappedIn: displayIn,
    snappedOut: displayOut,
    spanStart: span?.start || null,
    spanEnd: span?.end || null,
    // Handwriting or illegible on either stamp leaves Tot. Hrs. blank.
    totalHours,
  };
}
