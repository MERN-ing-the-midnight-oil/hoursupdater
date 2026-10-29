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

// Month/day for a countdown label, such as 10/20.
export function countdownDateLabel(iso) {
  const match = String(iso ?? '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${match[2]}/${match[3]}`;
}

// "+10 min" or "−15 min". Each countdown keeps its own total.
export function countdownMinutesLabel(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (value > 0) return `+${abs} min`;
  if (value < 0) return `−${abs} min`;
  return '0 min';
}

export function countdownAccumulationLabel(startedOn, minutes) {
  const date = countdownDateLabel(startedOn);
  const amount = countdownMinutesLabel(minutes);
  if (!date || !amount) return '';
  return `${date} Countdown, ${amount}`;
}

// Lines under New Schedule Started. The first line is this row's own
// minute change. It does not name AM, midday, or PM as separate changes.
// Each open countdown follows, named by the date its clock started.
export function scheduleChangeKindLines(row) {
  if (row?.kind === 'initial') return ['Established'];
  const lines = [row?.delta_label ? `Change · ${row.delta_label}` : 'Change'];
  if (Array.isArray(row?.countdowns)) {
    for (const countdown of row.countdowns) {
      const label = countdownAccumulationLabel(countdown?.started_on, countdown?.minutes);
      if (label) lines.push(label);
    }
    return lines;
  }
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

function monthDay(iso) {
  const match = String(iso ?? '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${match[2]}/${match[3]}`;
}

// The posting days still ahead once `becomesOn` is the first day this route
// may be posted. That day can fall after the window opens, when the 15
// school days finish inside the last five.
export function bidPostingSpan(schoolDays, becomesOn) {
  const day = String(becomesOn ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const period = bidPeriodRanges(schoolDays).find((range) => day >= range.start && day <= range.end);
  if (!period) return null;
  return { start: day, end: period.end };
}

export function bidPostingSpanText(span) {
  const start = monthDay(span?.start);
  const end = monthDay(span?.end);
  if (!start) return '';
  if (!end || start === end) return start;
  return `${start}–${end}`;
}

// "Predicted up for bid 11/20–11/30". A closed window drops "Predicted".
export function bidPostingPhrase(span, role = 'predicted') {
  const dates = bidPostingSpanText(span);
  if (!dates) return '';
  if (role === 'new') return `New predicted up for bid ${dates}`;
  if (role === 'old') return `Old predicted up for bid ${dates}`;
  if (role === 'posted') return `Up for bid ${dates}`;
  return `Predicted up for bid ${dates}`;
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
    windowTone: flags.windowTone ?? null,
    extraWindows: flags.extraWindows ?? null,
    arrow: flags.arrow ?? false,
    arrowHead: flags.arrowHead ?? false,
    resolvesOn: flags.resolvesOn ?? null,
    goesToBid: flags.goesToBid ?? false,
    contractedDay: flags.contractedDay ?? false,
    arrowOrigin: flags.arrowOrigin ?? false,
    arrowFromWindow: flags.arrowFromWindow ?? false,
  };
}

function copyMarkFlags(mark, overrides = {}) {
  return {
    isChange: mark?.isChange ?? false,
    cumulativeLabel: mark?.cumulativeLabel ?? null,
    sourceIndex: mark?.sourceIndex ?? null,
    established: mark?.established ?? false,
    window: mark?.window ?? false,
    windowDay: mark?.windowDay ?? null,
    windowTone: mark?.windowTone ?? null,
    extraWindows: mark?.extraWindows ?? null,
    arrow: mark?.arrow ?? false,
    arrowHead: mark?.arrowHead ?? false,
    resolvesOn: mark?.resolvesOn ?? null,
    goesToBid: mark?.goesToBid ?? false,
    contractedDay: mark?.contractedDay ?? false,
    arrowOrigin: mark?.arrowOrigin ?? false,
    arrowFromWindow: mark?.arrowFromWindow ?? false,
    ...overrides,
  };
}

// Numbered countdown squares for one change. When `asExtra` is set, an
// already-painted countdown keeps its square and this count is added beside it.
function paintWindowDays(marks, fifteen, nextDate, toneIndex, tone, label, hover, { asExtra = false } = {}) {
  let windowDay = 0;
  for (const day of fifteen) {
    if (nextDate && day >= nextDate) break;
    windowDay += 1;
    const existing = marks.get(day);
    const entry = {
      toneIndex,
      tone,
      label,
      windowDay,
      sourceIndex: hover.sourceIndex,
    };

    if (asExtra && existing?.window) {
      const extras = [...(existing.extraWindows || [])].filter(
        (item) => item.sourceIndex !== entry.sourceIndex
      );
      extras.push(entry);
      marks.set(
        day,
        historyMark(existing.toneIndex, existing.tone, existing.label, copyMarkFlags(existing, {
          extraWindows: extras,
        }))
      );
      continue;
    }

    if (asExtra && existing) {
      marks.set(
        day,
        historyMark(existing.toneIndex, existing.tone, existing.label, copyMarkFlags(existing, {
          window: true,
          windowDay,
          windowTone: tone,
          extraWindows: existing.extraWindows ?? null,
        }))
      );
      continue;
    }

    marks.set(
      day,
      historyMark(toneIndex, tone, label, {
        ...hover,
        established: existing?.established ?? false,
        window: true,
        windowDay,
        windowTone: tone,
        extraWindows: null,
      })
    );
  }
}

// Calendar marks for each clock-time row.
// The row color covers the day those times were established and, when a
// 15-school-day count applies, each school day in that count. Those school
// days are numbered. A later change that leaves the bid in place paints its
// own numbered squares beside that bid count. Days still left before those
// times become contracted are an arrow pointing at a box around that day.
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
    const sideCountdown = keepsStandingForecast(row);
    const existingStart = marks.get(row.date);

    marks.set(
      row.date,
      historyMark(toneIndex, tone, label, {
        ...hover,
        established: true,
        // Keep the standing countdown's square when this day already carries it.
        window: sideCountdown ? existingStart?.window ?? false : false,
        windowDay: sideCountdown ? existingStart?.windowDay ?? null : null,
        windowTone: sideCountdown
          ? existingStart?.windowTone ?? (existingStart?.window ? existingStart.tone : null)
          : null,
        extraWindows: sideCountdown ? existingStart?.extraWindows ?? null : null,
        arrow: sideCountdown ? existingStart?.arrow ?? false : false,
        arrowHead: sideCountdown ? existingStart?.arrowHead ?? false : false,
        resolvesOn: sideCountdown ? existingStart?.resolvesOn ?? null : null,
        goesToBid: sideCountdown ? existingStart?.goesToBid ?? false : false,
        contractedDay: sideCountdown ? existingStart?.contractedDay ?? false : false,
        arrowOrigin: sideCountdown ? existingStart?.arrowOrigin ?? false : false,
        arrowFromWindow: sideCountdown ? existingStart?.arrowFromWindow ?? false : false,
      })
    );

    // A countdown beside a bid keeps that bid's numbers and adds its own.
    // The bid date does not move, so this count is not cut short by it.
    if (sideCountdown) {
      if (fifteen.length) {
        paintWindowDays(marks, fifteen, null, toneIndex, tone, label, hover, { asExtra: true });
      }
      return;
    }

    if (usesFifteenDayWindow(row, fifteen)) {
      paintWindowDays(marks, fifteen, nextDate, toneIndex, tone, label, hover);
    }

    const arrow = resolutionArrow(row, fifteen, nextDate);
    if (arrow) {
      const originDay = shiftIsoDate(arrow.start, -1);
      const origin = marks.get(originDay);
      const fromWindow = Boolean(origin?.window);
      if (origin) {
        marks.set(
          originDay,
          historyMark(toneIndex, tone, origin.label, copyMarkFlags(origin, {
            arrowOrigin: true,
            arrowFromWindow: fromWindow,
          }))
        );
      }
      const arrowLast = shiftIsoDate(arrow.end, -1);
      let cursor = arrow.start;
      while (cursor < arrow.end) {
        const existing = marks.get(cursor);
        marks.set(
          cursor,
          historyMark(toneIndex, tone, label, {
            ...hover,
            established: existing?.established ?? false,
            window: existing?.window ?? false,
            windowDay: existing?.windowDay ?? null,
            windowTone: existing?.windowTone ?? null,
            extraWindows: existing?.extraWindows ?? null,
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
          windowTone: existing?.windowTone ?? null,
          extraWindows: existing?.extraWindows ?? null,
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
