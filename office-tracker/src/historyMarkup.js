import { formatDurationLabel, localDateString, normalizeClockTime } from '../../employee-tracker/src/clockTimes.js';
import { getSchoolDays } from '../../src/logic/calendar.js';
import { buildPayrollRoundingBreakdown } from '../../src/logic/timeUtils.js';
import {
  bidPeriodRanges,
  bidPostingSpan,
  bidPostingSpanText,
  buildClockHistoryMarks,
  changeDetailLines,
  changeHoverLines,
  scheduleChangeKindHtml,
} from '../../employee-tracker/src/clockHistory.js';

export const OFFICE_HISTORY_TONES = [
  '#1a4f86',
  '#0e7490',
  '#8a4b12',
  '#6b3f78',
  '#9a3d4a',
  '#2f6f4e',
  '#3d5a80',
  '#8a5a2b',
];

const RUNS = [
  { id: 'AM', label: 'AM' },
  { id: 'MIDDAY', label: 'Midday' },
  { id: 'PM', label: 'PM' },
];

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function prettyDate(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Numeric month/day/year, matching the date fields on the same table.
export function monthDayYear(iso) {
  const match = String(iso ?? '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '—';
  return `${match[2]}/${match[3]}/${match[1]}`;
}

// Short date such as "Nov 4".
export function shortMonthDay(iso) {
  const match = String(iso ?? '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(
    'en-US',
    { month: 'short', day: 'numeric' }
  );
}

// Payroll-rounded daily total for one schedule row.
// Default: each run is rounded to the nearest 15 minutes, those amounts are
// added, and that sum is rounded again. With snapContractClocks, each run's
// clocks snap to the nearest quarter hour before that math.
export function scheduleRoundedMinutes(schedule, options = {}) {
  const segments = {};
  for (const run of RUNS) {
    const range = schedule?.[run.id]?.range;
    if (range) segments[run.id] = range;
  }
  if (!Object.keys(segments).length) return null;
  return buildPayrollRoundingBreakdown(segments, options).payroll_rounded_total_minutes;
}

function hoursText(minutes) {
  return minutes == null ? '—' : formatDurationLabel(minutes);
}

function isBidContract(contracted) {
  return contracted?.projected_outcome === 'BID_PENDING' || contracted?.status === 'bid_pending';
}

function isBumpContract(contracted) {
  return contracted?.projected_outcome === 'BUMP_ELIGIBLE' || contracted?.status === 'bump_eligible';
}

function monthDay(iso) {
  const match = String(iso ?? '')
    .slice(0, 10)
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${match[2]}/${match[3]}`;
}

// Monthly bid window for this row. The stored end covers a custom school year.
// School days cover a row that has not been annotated yet.
function bidSpanForContract(contracted, schoolDays) {
  if (!isBidContract(contracted)) return null;
  const on = String(contracted?.becomes_on || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return null;
  if (schoolDays?.length) {
    const span = bidPostingSpan(schoolDays, on);
    if (span) return span;
  }
  const through = String(contracted?.bid_through || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(through) && through >= on) {
    return { start: on, end: through };
  }
  return null;
}

// Second line when the rules point at a bid or bump date.
function bidBumpSecondary(contracted, schoolDays) {
  const status = contracted?.status;
  const predicted = status === 'predicted';
  const on = contracted?.becomes_on;
  if (!on) return null;
  if (isBidContract(contracted)) {
    const span = bidSpanForContract(contracted, schoolDays);
    const dates = span ? bidPostingSpanText(span) : monthDay(on);
    if (!dates) return null;
    if (predicted) {
      return {
        text: `Predicted Up for Bid: ${dates}`,
        title:
          'Under the contract rules, a large enough increase would go up for bid on this date (or during this end-of-month window). Not confirmation that posting already happened.',
      };
    }
    return {
      text: `Up for Bid: ${dates}`,
      title:
        'Bid posting date the contract rules assign for this change. The app does not know when an admin actually posts the bid.',
    };
  }
  if (isBumpContract(contracted)) {
    const dates = monthDay(on);
    if (!dates) return null;
    if (predicted) {
      return {
        text: `Predicted Up for Bump: ${dates}`,
        title:
          'Under the contract rules, a large enough decrease would make this route bump-eligible on this date. Not confirmation that a bump already happened.',
      };
    }
    return {
      text: `Up for Bump: ${dates}`,
      title:
        'Bump date the contract rules assign for this change. The app does not know when an admin handles the bump.',
    };
  }
  return null;
}

// Calculated Contract Date for this row: the date the contract rules would
// use. Bid/bump predictions ride on a second line. The app does not know when
// an admin or payroll actually creates a contract.
// Returns { text, title, secondary, secondaryTitle }.
export function contractedDateEntry(row, role = 'predicted', schoolDays) {
  const status = row.contracted?.status;
  const on = row.contracted?.becomes_on;
  const secondary = status === 'side_countdown' ? null : bidBumpSecondary(row.contracted, schoolDays);
  const withSecondary = (entry) => ({
    ...entry,
    secondary: secondary?.text || null,
    secondaryTitle: secondary?.title || null,
  });
  if (status === 'side_countdown') {
    return withSecondary({
      text: '—',
      title: 'No calculated contract date for this row.',
    });
  }
  if (status === 'predicted') {
    if (!on) {
      return withSecondary({
        text: 'predicted',
        title:
          'The contract rules say these hours should become contracted, but the exact date is not set yet. Not a confirmed admin or payroll entry.',
      });
    }
    const date = monthDayYear(on);
    if (role === 'new') {
      return withSecondary({
        text: `new predicted: ${date}`,
        title:
          'A later change moved the forecast. This is the newer date the contract rules would use. Not a confirmed admin or payroll entry.',
      });
    }
    if (role === 'old') {
      return withSecondary({
        text: `old predicted: ${date}`,
        title:
          'Earlier forecast that a later change replaced. The app does not know when an admin or payroll actually creates a contract.',
      });
    }
    return withSecondary({
      text: `predicted: ${date}`,
      title:
        'If nothing else changes, the contract rules say these hours should become contracted on this date. Not a confirmed admin or payroll entry.',
    });
  }
  if (on && status !== 'superseded') {
    return withSecondary({
      text: monthDayYear(on),
      title:
        'Calculated date under the contract rules for when these hours should count as contracted. The app does not know when an admin or payroll actually created a new contract.',
    });
  }
  if (row.kind === 'initial' && row.date) {
    return withSecondary({
      text: monthDayYear(row.date),
      title:
        'Starting schedule date. These hours are treated as contracted from the start. The app does not track when an admin entered that starting contract.',
    });
  }
  return withSecondary({
    text: '—',
    title: 'No calculated contract date for this row.',
  });
}

export function contractedDateText(row, role = 'predicted', schoolDays) {
  return contractedDateEntry(row, role, schoolDays).text;
}

export function contractedDateStackHtml(column) {
  const secondary = column?.contractedDateSecondary
    ? `<span class="contracted-date-secondary" title="${escapeHtml(
        column.contractedDateSecondaryTitle || ''
      )}">${escapeHtml(column.contractedDateSecondary)}</span>`
    : '';
  return `<span class="contracted-stack">
    <span class="contracted-date" title="${escapeHtml(column?.contractedDateTitle || '')}">${escapeHtml(
      column?.contractedDate || '—'
    )}</span>
    ${secondary}
  </span>`;
}

// The latest predicted date is the standing forecast.
// When it differs from an earlier predicted date, that latest row is
// "new predicted" and each earlier one is "old predicted".
function predictedDateRoles(rows) {
  const predicted = [];
  (rows || []).forEach((row, index) => {
    if (row?.contracted?.status === 'predicted' && row.contracted?.becomes_on) {
      predicted.push({ index, on: String(row.contracted.becomes_on).slice(0, 10) });
    }
  });
  const roles = new Map();
  if (!predicted.length) return roles;
  const latest = predicted[predicted.length - 1];
  const replaced = predicted.some((item) => item.on !== latest.on);
  for (const item of predicted) {
    if (!replaced) roles.set(item.index, 'predicted');
    else roles.set(item.index, item.index === latest.index ? 'new' : 'old');
  }
  return roles;
}

// A side countdown that leaves the bid in place keeps the standing forecast.
function standingPredictedRow(rows, index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const contracted = rows[cursor]?.contracted;
    if (contracted?.status === 'predicted' && contracted.becomes_on) {
      return { row: rows[cursor], index: cursor };
    }
  }
  return null;
}

// Scheduled Hours is the rounded total of the clock times on that row.
// When snapContractClocks is on, the Change column uses that same snapped
// total for Change and Countdown lines (see applySnappedChangeColumnLabels).
export function contractColumnsForHistory(rows, schoolDays, options = {}) {
  const list = rows || [];
  const roles = predictedDateRoles(list);
  return list.map((row, index) => {
    const standing = row?.contracted?.status === 'side_countdown' ? standingPredictedRow(list, index) : null;
    const entry = standing
      ? contractedDateEntry(standing.row, roles.get(standing.index) || 'predicted', schoolDays)
      : contractedDateEntry(row, roles.get(index), schoolDays);
    return {
      hours: hoursText(scheduleRoundedMinutes(row.schedule, options)),
      contractedDate: entry.text,
      contractedDateTitle: entry.title,
      contractedDateSecondary: entry.secondary,
      contractedDateSecondaryTitle: entry.secondaryTitle,
    };
  });
}

export function toneForRow(index, tones = OFFICE_HISTORY_TONES) {
  return tones[index % tones.length];
}

// Comparable clock text. A blank stays blank. 06:10 and 6:10 are the same time.
export function scheduleClockKey(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try {
    return normalizeClockTime(text);
  } catch {
    return text;
  }
}

// True when this clock is not the same time as the one in the previous row.
export function scheduleClockDiffers(current, previous) {
  return scheduleClockKey(current) !== scheduleClockKey(previous);
}

export function historyLegendHtml(rows, tones = OFFICE_HISTORY_TONES) {
  return (
    (rows || [])
      .map((row, index) => {
        const tone = toneForRow(index, tones);
        return `<li style="--tone:${tone}">
        <span class="history-swatch" aria-hidden="true"></span>
        <span class="history-legend-text">
          ${escapeHtml(prettyDate(row.date))}
          ${scheduleChangeKindHtml(row, escapeHtml)}
        </span>
      </li>`;
      })
      .join('') +
    `<li class="is-key-note">
      <span class="history-swatch is-bid" aria-hidden="true"></span>
      End-of-month bid period: the last five school days of October through April, when a 30-minute increase is posted for bid.
    </li>`
  );
}

// Read-only clock-time history. The office screen keeps its own editable table.
export function scheduleHistoryTableHtml(snapshot, tones = OFFICE_HISTORY_TONES) {
  const rows = snapshot?.schedule_history || [];
  if (!rows.length) {
    return `<table class="schedule-history">
      <tbody><tr><td class="empty">No clock times recorded yet.</td></tr></tbody>
    </table>`;
  }
  const columns = contractColumnsForHistory(rows);
  const body = rows
    .map((row, index) => {
      const previous = index > 0 ? rows[index - 1] : null;
      const predicted = row.contracted?.status === 'predicted';
      const kind = scheduleChangeKindHtml(row, escapeHtml);
      const column = columns[index];
      const contractedDetail = row.contracted?.projected_outcome_label
        ? `<span class="contracted-detail">${escapeHtml(row.contracted.projected_outcome_label)}</span>`
        : '';
      const note = row.note ? `<span class="change-note">${escapeHtml(row.note)}</span>` : '';
      return `<tr class="is-history${predicted ? ' is-predicted' : ''}" style="--tone:${toneForRow(index, tones)}">
        <th scope="row">${escapeHtml(prettyDate(row.date))}</th>
        ${RUNS.map((run) => {
          const item = row.schedule?.[run.id];
          const changed = row.segment === run.id || row.segments?.includes(run.id);
          return ['clock_in', 'clock_out']
            .map((which) => {
              const value = item?.[which] || '';
              const prior = previous?.schedule?.[run.id]?.[which] || '';
              const differs = Boolean(previous) && scheduleClockDiffers(value, prior);
              const classes = [changed ? 'is-changed' : '', differs ? 'is-time-diff' : ''].filter(Boolean);
              const classAttr = classes.length ? ` class="${classes.join(' ')}"` : '';
              const title = differs ? ' title="Different from the row above"' : '';
              return `<td${classAttr}><span class="times${differs ? ' is-time-diff' : ''}"${title}>${escapeHtml(
                value || '—'
              )}</span></td>`;
            })
            .join('');
        }).join('')}
        <td class="change-figure">${kind}</td>
        <td class="hours-figure">${escapeHtml(column.hours)}</td>
        <td>
          ${contractedDateStackHtml(column)}
          ${contractedDetail}
          ${note}
        </td>
      </tr>`;
    })
    .join('');
  return `<table class="schedule-history">
    <thead>
      <tr>
        <th scope="col">New Schedule Started</th>
        <th scope="col">AM start</th>
        <th scope="col">AM end</th>
        <th scope="col">Midday start</th>
        <th scope="col">Midday end</th>
        <th scope="col">PM start</th>
        <th scope="col">PM end</th>
        <th scope="col">Change</th>
        <th scope="col">Scheduled Hours</th>
        <th scope="col">Calculated Contract Date</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

// YYYY-MM for a grouped calendar month.
function calendarMonthKey(month) {
  if (/^\d{4}-\d{2}$/.test(month?.month || '')) return month.month;
  const date = month?.days?.[0]?.date || '';
  return date.slice(0, 7);
}

// Past months, the month of asOf, and the following month.
export function historyMonthsThroughNext(months, asOf) {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(asOf || '')) ? asOf : localDateString();
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const limit = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
  return (months || []).filter((item) => {
    const key = calendarMonthKey(item);
    return Boolean(key) && key <= limit;
  });
}

// Months from the earliest through the latest notice send-by date.
export function monthsSpanningIsoDates(months, dates) {
  const keys = [...(dates || [])]
    .map((value) => String(value || '').slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .map((value) => value.slice(0, 7))
    .sort();
  if (!keys.length) return [];
  const start = keys[0];
  const end = keys[keys.length - 1];
  return (months || []).filter((item) => {
    const key = calendarMonthKey(item);
    return Boolean(key) && key >= start && key <= end;
  });
}

// School-year month grids with prebuilt mark HTML keyed by YYYY-MM-DD.
// Light beige bid-rect shading matches the route history calendar for the
// last five school days of each month, October through April.
export function contractNoticeCalendarHtml({
  calendar,
  months,
  marksByDate = {},
  asOf = '',
} = {}) {
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = String(asOf || '').slice(0, 10);
  const source = months || [];
  if (!source.length) return '';
  const bidRanges = calendar ? bidPeriodRanges(getSchoolDays(calendar)) : [];
  return source
    .map((month) => {
      const first = month.days?.[0];
      const pad = first ? new Date(`${first.date}T00:00:00Z`).getUTCDay() : 0;
      const blanks = Array.from({ length: pad }, (_, index) => {
        return `<div class="cal-day" style="grid-column:${index + 1};grid-row:2"></div>`;
      });
      const days = (month.days || []).map((day, index) => {
        const num = Number(day.date.slice(-2));
        const offReason = day.is_school_day ? '' : day.reason || 'Off';
        const skipLabel =
          !offReason ||
          offReason === 'Weekend' ||
          offReason.startsWith('Outside school year');
        const short =
          !day.is_school_day && !skipLabel ? offReason.replace(' (students off)', '') : '';
        const slot = pad + index;
        const col = (slot % 7) + 1;
        const row = Math.floor(slot / 7) + 2;
        const isToday = day.date === today;
        const inBid = bidRanges.some((range) => day.date >= range.start && day.date <= range.end);
        const marks = marksByDate[day.date] || '';
        const classes = [
          'cal-day',
          day.is_school_day ? 'is-school' : 'is-off',
          inBid ? 'is-bid-period' : '',
          isToday ? 'is-today' : '',
          marks ? 'has-contract-notice' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const titleParts = [day.is_school_day ? 'School day' : offReason];
        if (isToday) titleParts.unshift("Today's date");
        if (inBid) titleParts.push('End-of-month bid period');
        return `<div class="${classes}" style="grid-column:${col};grid-row:${row}" title="${escapeHtml(
          titleParts.join(' · ')
        )}"><span class="num">${num}</span>${marks}${
          short ? `<span class="why">${escapeHtml(short)}</span>` : ''
        }</div>`;
      });
      const rects = bidRectMarkup(bidRanges, month.days || [], pad);
      return `<div class="month-block">
        <h3>${escapeHtml(month.label)}</h3>
        <div class="month-grid">
          ${dows
            .map(
              (label, index) =>
                `<div class="dow" style="grid-column:${index + 1};grid-row:1">${label}</div>`
            )
            .join('')}
          ${blanks.join('')}${days.join('')}${rects}
        </div>
      </div>`;
    })
    .join('');
}

// Colorful countdown squares for one calendar day. A day can carry more than
// one numbered count when a later change runs beside an open bid. When a
// countdown finishes as bid or bump, that resolution date gets a BID or BUMP
// square in the same series color instead of a day number.
function historyPipsHtml(mark) {
  if (!mark) return '';
  const parts = [];
  const windowTone = mark.windowTone || mark.tone;
  const combined =
    mark.established && mark.window && mark.windowDay && windowTone === mark.tone;
  if (combined) {
    parts.push(
      `<span class="history-pip is-established is-window" style="--tone:${mark.tone}" aria-hidden="true">#${mark.windowDay}</span>`
    );
  } else {
    if (mark.established) {
      parts.push(
        `<span class="history-pip is-established" style="--tone:${mark.tone}" aria-hidden="true"></span>`
      );
    }
    if (mark.window && mark.windowDay) {
      parts.push(
        `<span class="history-pip is-window" style="--tone:${windowTone}" aria-hidden="true">#${mark.windowDay}</span>`
      );
    }
  }
  for (const extra of mark.extraWindows || []) {
    if (!extra?.windowDay) continue;
    parts.push(
      `<span class="history-pip is-window" style="--tone:${extra.tone}" aria-hidden="true">#${extra.windowDay}</span>`
    );
  }
  if (mark.result) {
    const resultTone = mark.resultTone || mark.tone;
    parts.push(
      `<span class="history-pip is-result" style="--tone:${resultTone}" aria-hidden="true">${escapeHtml(
        mark.result
      )}</span>`
    );
  }
  for (const extra of mark.extraResults || []) {
    if (!extra?.result) continue;
    parts.push(
      `<span class="history-pip is-result" style="--tone:${extra.tone}" aria-hidden="true">${escapeHtml(
        extra.result
      )}</span>`
    );
  }
  if (!parts.length) return '';
  return `<span class="history-pips">${parts.join('')}</span>`;
}

export function calendarMonthsHtml({ calendar, rows, asOf, tones = OFFICE_HISTORY_TONES }) {
  const schoolDays = getSchoolDays(calendar);
  const marks = buildClockHistoryMarks(rows, { schoolDays, tones });
  const bidRanges = bidPeriodRanges(schoolDays);
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = asOf || '';
  return historyMonthsThroughNext(calendar.months, asOf)
    .map((month) => {
      const first = month.days[0];
      const pad = first ? new Date(`${first.date}T00:00:00Z`).getUTCDay() : 0;
      const blanks = Array.from({ length: pad }, (_, index) => {
        return `<div class="cal-day" style="grid-column:${index + 1};grid-row:2"></div>`;
      });
      const days = month.days.map((day, index) => {
        const num = Number(day.date.slice(-2));
        const offReason = day.is_school_day ? '' : day.reason || 'Off';
        const skipLabel =
          !offReason ||
          offReason === 'Weekend' ||
          offReason.startsWith('Outside school year');
        const short =
          !day.is_school_day && !skipLabel ? offReason.replace(' (students off)', '') : '';
        const mark = marks.get(day.date);
        const inBid = bidRanges.some((range) => day.date >= range.start && day.date <= range.end);
        const slot = pad + index;
        const col = (slot % 7) + 1;
        const row = Math.floor(slot / 7) + 2;
        const dow = new Date(`${day.date}T00:00:00Z`).getUTCDay();
        const isToday = day.date === today;
        const changeLines = mark ? changeHoverLines(mark) : [];
        const detailLines =
          mark?.sourceIndex == null ? [] : changeDetailLines(rows[mark.sourceIndex]);
        const classes = [
          'cal-day',
          day.is_school_day ? 'is-school' : 'is-off',
          inBid ? 'is-bid-period' : '',
          mark?.arrow ? 'is-bid-arrow' : '',
          mark?.arrow && dow !== 0 ? 'is-arrow-join' : '',
          mark?.arrow && !mark.arrowHead && dow !== 6 ? 'is-arrow-bridge' : '',
          mark?.arrowOrigin ? 'is-arrow-origin' : '',
          mark?.arrowOrigin && dow !== 6 ? 'is-arrow-origin-bridge' : '',
          mark?.arrowFromWindow ? 'is-arrow-from-window' : '',
          mark?.contractedDay ? 'is-contracted' : '',
          isToday ? 'is-today' : '',
          changeLines.length ? 'is-hover-change' : '',
          changeLines.length && col <= 2 ? 'is-tip-start' : '',
          changeLines.length && col >= 6 ? 'is-tip-end' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const titleParts = [day.is_school_day ? 'School day' : offReason];
        if (isToday) titleParts.unshift("Today's date");
        if (inBid) titleParts.push('End-of-month bid period');
        if (mark?.arrow) {
          const when = mark.resolvesOn ? prettyDate(mark.resolvesOn) : 'resolution';
          const aim = mark.goesToBid ? `Goes to bid ${when}` : `Points to ${when}`;
          if (changeLines.length) {
            titleParts.push(...changeLines, aim);
          } else {
            titleParts.push(`${mark.label} · ${aim.charAt(0).toLowerCase()}${aim.slice(1)}`);
          }
        } else if (mark) {
          if (changeLines.length) titleParts.push(...changeLines);
          else titleParts.push(mark.label);
          if (mark.established) titleParts.push('established');
          if (mark.windowDay) titleParts.push(`school day ${mark.windowDay} of 15`);
          for (const extra of mark.extraWindows || []) {
            if (extra?.windowDay) titleParts.push(`school day ${extra.windowDay} of 15`);
          }
          if (mark.contractedDay) titleParts.push('became contracted');
          if (mark.result === 'BID') titleParts.push('posted for bid');
          else if (mark.result === 'BUMP') titleParts.push('bump eligible');
          for (const extra of mark.extraResults || []) {
            if (extra?.result === 'BID') titleParts.push('posted for bid');
            else if (extra?.result === 'BUMP') titleParts.push('bump eligible');
          }
        }
        const popupLines = [
          ...titleParts,
          ...detailLines.filter((line) => !titleParts.includes(line)),
        ];
        const hoverList = changeLines.length
          ? `<ul class="cal-hover" role="tooltip">${popupLines
              .map((line) => {
                const isChangeLine =
                  line.startsWith('Current change:') || line.startsWith('Cumulative change:');
                const isDetail = !titleParts.includes(line);
                const itemClass = [isChangeLine ? 'is-change' : '', isDetail ? 'is-detail' : '']
                  .filter(Boolean)
                  .join(' ');
                return `<li${itemClass ? ` class="${itemClass}"` : ''}>${escapeHtml(line)}</li>`;
              })
              .join('')}</ul>`
          : '';
        const pip = historyPipsHtml(mark);
        const arrow = mark?.arrow
          ? `<span class="bid-arrow${mark.arrowHead ? ' is-head' : ''}" style="--tone:${mark.tone}"></span>`
          : '';
        const toneStyle = mark?.contractedDay || mark?.arrowOrigin ? `;--tone:${mark.tone}` : '';
        const hoverAttrs = hoverList
          ? ` data-date="${day.date}" aria-label="${escapeHtml(titleParts.join('. '))}" tabindex="0"`
          : ` title="${escapeHtml(titleParts.join(' · '))}"`;
        return `<div class="${classes}" style="grid-column:${col};grid-row:${row}${toneStyle}"${hoverAttrs}><span class="num">${num}</span>${pip}${arrow}${
          short ? `<span class="why">${escapeHtml(short)}</span>` : ''
        }${hoverList}</div>`;
      });
      const rects = bidRectMarkup(bidRanges, month.days, pad);
      return `<div class="month-block">
        <h3>${month.label}</h3>
        <div class="month-grid">
          ${dows
            .map(
              (label, index) =>
                `<div class="dow" style="grid-column:${index + 1};grid-row:1">${label}</div>`
            )
            .join('')}
          ${blanks.join('')}${days.join('')}${rects}
        </div>
      </div>`;
    })
    .join('');
}

function bidRectMarkup(ranges, monthDays, pad) {
  const html = [];
  for (const range of ranges) {
    const indexes = [];
    monthDays.forEach((day, index) => {
      if (day.date >= range.start && day.date <= range.end) indexes.push(index);
    });
    if (!indexes.length) continue;
    let segment = null;
    const segments = [];
    for (const index of indexes) {
      const slot = pad + index;
      const row = Math.floor(slot / 7);
      const col = slot % 7;
      if (segment && segment.row === row && col === segment.endCol + 1) {
        segment.endCol = col;
      } else {
        segment = { row, startCol: col, endCol: col };
        segments.push(segment);
      }
    }
    for (const seg of segments) {
      const gridRow = seg.row + 2;
      html.push(
        `<div class="bid-rect" style="grid-column:${seg.startCol + 1} / ${
          seg.endCol + 2
        };grid-row:${gridRow} / ${gridRow + 1}" title="End-of-month bid period"></div>`
      );
    }
  }
  return html.join('');
}
