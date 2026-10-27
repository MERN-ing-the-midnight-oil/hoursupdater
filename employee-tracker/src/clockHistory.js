import { addSchoolDays } from '../../src/logic/calendar.js';
import { BID_THRESHOLD_MINUTES, WINDOW_SCHOOL_DAYS } from '../../src/logic/constants.js';
import { monthlyBidPostingDays, october1ForDate } from '../../src/logic/contractWindows.js';

// One color per clock-time row, reused if there are more rows than colors.
export const CLOCK_HISTORY_TONES = [
  '#1f5c4a',
  '#2f5f9e',
  '#a15c12',
  '#6b3f78',
  '#0e7490',
  '#9a3d4a',
  '#3f6b2f',
  '#8a5a2b',
];

export function shiftIsoDate(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

// Running total for this row, kept beside the row's own minute change.
function cumulativeChangeBeside(row) {
  if (row?.kind !== 'change') return null;
  const label = String(row?.cumulative_drift_label ?? '').trim();
  return label || null;
}

// Lines under New Schedule Started. The first line is this row's own
// minute change. It does not name AM, midday, or PM as separate changes.
// The second line is the cumulative change for the review window.
export function scheduleChangeKindLines(row) {
  if (row?.kind === 'initial') return ['Established'];
  const lines = [row?.delta_label ? `Change · ${row.delta_label}` : 'Change'];
  const cumulative = cumulativeChangeBeside(row);
  if (cumulative) lines.push(`Cumulative change · ${cumulative}`);
  return lines;
}

export function scheduleChangeKind(row) {
  return scheduleChangeKindLines(row).join('\n');
}

export function scheduleChangeKindHtml(row, escapeHtml) {
  const escape = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value ?? '');
  return scheduleChangeKindLines(row)
    .map((line) => `<span class="row-kind">${escape(line)}</span>`)
    .join('');
}

export function clockHistoryLabel(row) {
  if (row?.kind === 'initial') return 'Established';
  return row?.delta_label || 'Change';
}

// The 15 school days strictly after `from`. Empty if the calendar runs out.
function fifteenSchoolDaysAfter(schoolDays, from) {
  try {
    const end = addSchoolDays(schoolDays, from, WINDOW_SCHOOL_DAYS);
    return schoolDays.filter((day) => day > from && day <= end);
  } catch {
    return schoolDays.filter((day) => day > from).slice(0, WINDOW_SCHOOL_DAYS);
  }
}

// A 15-school-day review window applies after October 1, and before October 1
// only when a 30-minute increase can finish those 15 school days first.
// Under-30 changes before October 1 wait until October 1. A 30-minute
// decrease before October 1 is bump-eligible the day it is written.
function usesFifteenDayWindow(row, fifteen) {
  if (row?.force_oct1_contract) return false;
  if (row?.kind !== 'change' || !row.date || !fifteen.length) return false;
  const fifteenth = fifteen[fifteen.length - 1];
  const october1 = october1ForDate(row.date);
  const becomes = row.contracted?.becomes_on;
  if (becomes) {
    // Before October 1, an under-30 change waits until October 1 itself.
    if (becomes === october1 && row.date < october1) return false;
    return shiftIsoDate(becomes, -1) >= fifteenth;
  }
  if (row.contracted?.status !== 'superseded') return false;
  if (row.date >= october1) return true;
  if ((row.delta_minutes ?? 0) >= BID_THRESHOLD_MINUTES) {
    return fifteenth < october1;
  }
  return false;
}

// One end-of-month bid period: the last five school days of an October–April
// month, from the first of those days through the last.
export function bidPeriodRanges(schoolDays) {
  const byMonth = new Map();
  for (const day of monthlyBidPostingDays(schoolDays)) {
    const key = day.slice(0, 7);
    const group = byMonth.get(key);
    if (group) group.push(day);
    else byMonth.set(key, [day]);
  }
  return [...byMonth.values()].map((days) => ({
    start: days[0],
    end: days[days.length - 1],
    schoolDays: days,
  }));
}

// Calendar days after the numbered count — or after the change day, when
// there is no 15-day count — until the resolution date. The arrow points at
// that date and does not cover it. A later change replaces this row, so it
// has no resolution arrow.
// A lock-in date, not a bid posting or a bump. The calendar draws a box
// around that whole day.
function resolvesAsBid(row) {
  const outcome = row?.contracted?.projected_outcome;
  const status = row?.contracted?.status;
  return outcome === 'BID_PENDING' || status === 'bid_pending';
}

function locksInAsContracted(row) {
  if (row?.kind !== 'change' || !row.contracted?.becomes_on || keepsStandingForecast(row)) return false;
  const outcome = row.contracted?.projected_outcome;
  const status = row.contracted?.status;
  if (outcome === 'BID_PENDING' || outcome === 'BUMP_ELIGIBLE') return false;
  if (status === 'bid_pending' || status === 'bump_eligible') return false;
  return true;
}

// A side countdown leaves the standing forecast where it is. It does not
// start a new predicted contract date, and it does not cut the bid window short.
function keepsStandingForecast(row) {
  const status = row?.contracted?.status;
  return status === 'side_countdown' || status === 'separate_countdown';
}

function nextReplacingDate(list, index) {
  for (let cursor = index + 1; cursor < list.length; cursor += 1) {
    const next = list[cursor];
    if (!next?.date || keepsStandingForecast(next)) continue;
    return next.date;
  }
  return null;
}

function resolutionArrow(row, fifteen, nextDate) {
  if (nextDate || row?.kind !== 'change' || keepsStandingForecast(row)) return null;
  const becomes = row.contracted?.becomes_on;
  if (!becomes) return null;
  const start = usesFifteenDayWindow(row, fifteen)
    ? shiftIsoDate(fifteen[fifteen.length - 1], 1)
    : shiftIsoDate(row.date, 1);
  if (becomes <= start) return null;
  return { start, end: becomes };
}

// Hover copy for a calendar day that belongs to a logged change.
// The cumulative line is included only when earlier changes in that same
// window make the running total different from this change alone.
export function changeHoverLines(mark) {
  if (!mark?.isChange) return [];
  const lines = [`Current change: ${mark.label}`];
  if (mark.cumulativeLabel) {
    lines.push(`Cumulative change: ${mark.cumulativeLabel}`);
  }
  return lines;
}

// Extra change facts for the tap popup: clock times, note, and contracted status.
export function changeDetailLines(row) {
  if (!row || row.kind !== 'change') return [];
  const segment = row.segment === 'MIDDAY' ? 'Midday' : row.segment || 'Run';
  const lines = [];
  if (row.previous_time || row.new_time) {
    lines.push(`${segment} ${row.previous_time || '—'} → ${row.new_time || '—'}`);
  }
  if (row.note) lines.push(row.note);
  const contracted = row.contracted || {};
  for (const line of [contracted.label, contracted.projected_outcome_label, contracted.detail]) {
    if (line && !lines.includes(line)) lines.push(line);
  }
  return lines;
}

function changeHoverFlags(row) {
  const isChange = row?.kind === 'change';
  const cumulative = row?.cumulative_drift_minutes;
  const own = row?.delta_minutes;
  const applies =
    isChange &&
    typeof cumulative === 'number' &&
    typeof own === 'number' &&
    cumulative !== own &&
    Boolean(row.cumulative_drift_label);
  return {
    isChange,
    cumulativeLabel: applies ? row.cumulative_drift_label : null,
  };
}

function historyMark(toneIndex, tone, label, flags = {}) {
  return {
    toneIndex,
    tone,
    label,
    isChange: flags.isChange ?? false,
    cumulativeLabel: flags.cumulativeLabel ?? null,
    sourceIndex: flags.sourceIndex ?? null,
    established: flags.established ?? false,
    window: flags.window ?? false,
    windowDay: flags.windowDay ?? null,
    arrow: flags.arrow ?? false,
    arrowHead: flags.arrowHead ?? false,
    resolvesOn: flags.resolvesOn ?? null,
    goesToBid: flags.goesToBid ?? false,
    contractedDay: flags.contractedDay ?? false,
    arrowOrigin: flags.arrowOrigin ?? false,
    arrowFromWindow: flags.arrowFromWindow ?? false,
  };
}

// Calendar marks for each clock-time row.
// The row color covers the day those times were established and, when a
// 15-school-day count applies, each school day in that count. Those school
// days are numbered. Days still left before those times become contracted are
// an arrow pointing at a box around that day.
export function buildClockHistoryMarks(rows, { schoolDays, tones = CLOCK_HISTORY_TONES }) {
  const marks = new Map();
  const days = [...schoolDays].sort();
  const list = rows ?? [];
  const palette = tones.length ? tones : CLOCK_HISTORY_TONES;

  list.forEach((row, index) => {
    if (!row?.date) return;
    const toneIndex = index % palette.length;
    const tone = palette[toneIndex];
    const label = clockHistoryLabel(row);
    const hover = { ...changeHoverFlags(row), sourceIndex: index };
    const nextDate = nextReplacingDate(list, index);
    const fifteen = fifteenSchoolDaysAfter(days, row.date);

    marks.set(
      row.date,
      historyMark(toneIndex, tone, label, {
        ...hover,
        established: true,
      })
    );

    // The standing forecast keeps its countdown. This row only marks the day
    // the later schedule started.
    if (keepsStandingForecast(row)) return;

    if (usesFifteenDayWindow(row, fifteen)) {
      let windowDay = 0;
      for (const day of fifteen) {
        if (nextDate && day >= nextDate) break;
        windowDay += 1;
        const existing = marks.get(day);
        marks.set(
          day,
          historyMark(toneIndex, tone, label, {
            ...hover,
            established: existing?.established ?? false,
            window: true,
            windowDay,
          })
        );
      }
    }

    const arrow = resolutionArrow(row, fifteen, nextDate);
    if (arrow) {
      const originDay = shiftIsoDate(arrow.start, -1);
      const origin = marks.get(originDay);
      const fromWindow = Boolean(origin?.window);
      if (origin) {
        marks.set(
          originDay,
          historyMark(toneIndex, tone, origin.label, {
            isChange: origin.isChange,
            cumulativeLabel: origin.cumulativeLabel,
            sourceIndex: origin.sourceIndex,
            established: origin.established,
            window: origin.window,
            windowDay: origin.windowDay,
            contractedDay: origin.contractedDay,
            arrowOrigin: true,
            arrowFromWindow: fromWindow,
          })
        );
      }
      const arrowLast = shiftIsoDate(arrow.end, -1);
      let cursor = arrow.start;
      while (cursor < arrow.end) {
        marks.set(
          cursor,
          historyMark(toneIndex, tone, label, {
            ...hover,
            arrow: true,
            arrowHead: cursor === arrowLast,
            resolvesOn: arrow.end,
            goesToBid: resolvesAsBid(row),
            arrowFromWindow: fromWindow,
          })
        );
        cursor = shiftIsoDate(cursor, 1);
      }
    }

    if (!nextDate && locksInAsContracted(row)) {
      const day = row.contracted.becomes_on;
      const existing = marks.get(day);
      marks.set(
        day,
        historyMark(toneIndex, tone, label, {
          ...hover,
          established: existing?.established ?? false,
          window: existing?.window ?? false,
          windowDay: existing?.windowDay ?? null,
          arrow: existing?.arrow ?? false,
          arrowHead: existing?.arrowHead ?? false,
          resolvesOn: existing?.resolvesOn ?? null,
          contractedDay: true,
        })
      );
    }
  });

  return marks;
}
