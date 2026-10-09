import { formatDurationLabel, localDateString } from '../../employee-tracker/src/clockTimes.js';
import { getSchoolDays } from '../../src/logic/calendar.js';
import { buildPayrollRoundingBreakdown } from '../../src/logic/timeUtils.js';
import {
  bidPeriodRanges,
  buildClockHistoryMarks,
  changeDetailLines,
  changeHoverLines,
  clockHistoryLabel,
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

/**
 * @param {unknown} value
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * @param {string | null | undefined} iso
 */
export function prettyDate(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Numeric month/day/year, matching the date fields on the same table.
 * @param {string | null | undefined} iso
 */
export function monthDayYear(iso) {
  const match = String(iso ?? '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '—';
  return `${match[2]}/${match[3]}/${match[1]}`;
}

/**
 * Payroll-rounded daily total for one schedule row.
 * Each run is rounded to the nearest 15 minutes, those amounts are added,
 * and that sum is rounded again.
 * @param {Record<string, { range?: string } | null | undefined> | null | undefined} schedule
 * @returns {number | null}
 */
export function scheduleRoundedMinutes(schedule) {
  /** @type {Record<string, string>} */
  const segments = {};
  for (const run of RUNS) {
    const range = schedule?.[run.id]?.range;
    if (range) segments[run.id] = range;
  }
  if (!Object.keys(segments).length) return null;
  return buildPayrollRoundingBreakdown(segments).payroll_rounded_total_minutes;
}

/**
 * @param {number | null} minutes
 */
function hoursText(minutes) {
  return minutes == null ? '—' : formatDurationLabel(minutes);
}

/**
 * Date this row's schedule became the contract, or a predicted date.
 * @param {object} row
 */
export function contractedDateText(row) {
  const status = row.contracted?.status;
  const on = row.contracted?.becomes_on;
  if (status === 'predicted') {
    return on ? `predicted: ${monthDayYear(on)}` : 'predicted';
  }
  if (on && status !== 'superseded') return monthDayYear(on);
  if (row.kind === 'initial' && row.date) return monthDayYear(row.date);
  return '—';
}

/**
 * Hours is the rounded total of the clock times on that row.
 * Contract hours stay at the previous official figure until a row
 * records the date those hours became contracted.
 * @param {object[]} rows
 * @returns {Array<{ hours: string, contractedDate: string, contractHours: string }>}
 */
export function contractColumnsForHistory(rows) {
  /** @type {number | null} */
  let official = null;
  return (rows || []).map((row) => {
    const scheduleMinutes = scheduleRoundedMinutes(row.schedule);
    const status = row.contracted?.status;
    const closes =
      row.kind === 'initial' ||
      (Boolean(row.contracted?.becomes_on) && status !== 'predicted' && status !== 'superseded');
    if (closes) official = scheduleMinutes;
    return {
      hours: hoursText(scheduleMinutes),
      contractedDate: contractedDateText(row),
      contractHours: hoursText(official),
    };
  });
}

/**
 * @param {number} index
 * @param {string[]} [tones]
 */
export function toneForRow(index, tones = OFFICE_HISTORY_TONES) {
  return tones[index % tones.length];
}

/**
 * @param {object[]} rows
 * @param {string[]} [tones]
 */
export function historyLegendHtml(rows, tones = OFFICE_HISTORY_TONES) {
  return (
    (rows || [])
      .map((row, index) => {
        const tone = toneForRow(index, tones);
        return `<li style="--tone:${tone}">
        <span class="history-swatch" aria-hidden="true"></span>
        ${prettyDate(row.date)} · ${escapeHtml(clockHistoryLabel(row))}
      </li>`;
      })
      .join('') +
    `<li class="is-key-note">
      <span class="history-swatch is-bid" aria-hidden="true"></span>
      End-of-month bid period: the last five school days of October through April, when a 30-minute increase is posted for bid.
    </li>`
  );
}

/**
 * Read-only clock-time history. The office screen keeps its own editable table.
 * @param {object | null | undefined} snapshot
 * @param {string[]} [tones]
 */
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
      const predicted = row.contracted?.status === 'predicted';
      const kind =
        row.kind === 'initial'
          ? 'Established'
          : `${row.segment === 'MIDDAY' ? 'Midday' : row.segment} change${
              row.delta_label ? ` · ${row.delta_label}` : ''
            }`;
      const column = columns[index];
      const contractedDetail = row.contracted?.projected_outcome_label
        ? `<span class="contracted-detail">${escapeHtml(row.contracted.projected_outcome_label)}</span>`
        : '';
      const note = row.note ? `<span class="change-note">${escapeHtml(row.note)}</span>` : '';
      return `<tr class="is-history${predicted ? ' is-predicted' : ''}" style="--tone:${toneForRow(index, tones)}">
        <td>${row.kind === 'change' ? (row.force_oct1_contract ? 'On' : 'Off') : ''}</td>
        <th scope="row">
          ${escapeHtml(prettyDate(row.date))}
          <span class="row-kind">${escapeHtml(kind)}</span>
        </th>
        ${RUNS.map((run) => {
          const item = row.schedule?.[run.id];
          const changed = row.segment === run.id;
          return ['clock_in', 'clock_out']
            .map(
              (which) =>
                `<td${changed ? ' class="is-changed"' : ''}><span class="times">${escapeHtml(
                  item?.[which] || '—'
                )}</span></td>`
            )
            .join('');
        }).join('')}
        <td class="hours-figure">${escapeHtml(column.hours)}</td>
        <td>
          <span class="contracted-date">${escapeHtml(column.contractedDate)}</span>
          ${contractedDetail}
          ${note}
        </td>
        <td class="hours-figure">${escapeHtml(column.contractHours)}</td>
      </tr>`;
    })
    .join('');
  return `<table class="schedule-history">
    <thead>
      <tr>
        <th scope="col">Force Oct 1 Contract</th>
        <th scope="col">New Schedule Started</th>
        <th scope="col">AM start</th>
        <th scope="col">AM end</th>
        <th scope="col">Midday start</th>
        <th scope="col">Midday end</th>
        <th scope="col">PM start</th>
        <th scope="col">PM end</th>
        <th scope="col">Hours</th>
        <th scope="col">Contracted</th>
        <th scope="col">Contract Hours</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

/**
 * YYYY-MM for a grouped calendar month.
 * @param {{ month?: string, days?: Array<{ date?: string }> }} month
 */
function calendarMonthKey(month) {
  if (/^\d{4}-\d{2}$/.test(month?.month || '')) return month.month;
  const date = month?.days?.[0]?.date || '';
  return date.slice(0, 7);
}

/**
 * Past months, the month of asOf, and the following month.
 * @param {Array<{ month?: string, days?: Array<{ date?: string }> }>} months
 * @param {string} [asOf]
 */
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

/**
 * @param {{ calendar: object, rows: object[], asOf?: string, tones?: string[] }} options
 */
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
          if (mark.contractedDay) titleParts.push('became contracted');
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
        const showPip = mark && !mark.arrow && (mark.window || mark.established);
        const pip = showPip
          ? `<span class="history-pip${mark.established ? ' is-established' : ''}${
              mark.window ? ' is-window' : ''
            }" style="--tone:${mark.tone}">${mark.windowDay ? `#${mark.windowDay}` : ''}</span>`
          : '';
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

/**
 * @param {Array<{ start: string, end: string }>} ranges
 * @param {Array<{ date: string }>} monthDays
 * @param {number} pad
 */
function bidRectMarkup(ranges, monthDays, pad) {
  const html = [];
  for (const range of ranges) {
    const indexes = [];
    monthDays.forEach((day, index) => {
      if (day.date >= range.start && day.date <= range.end) indexes.push(index);
    });
    if (!indexes.length) continue;
    /** @type {{ row: number, startCol: number, endCol: number } | null} */
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
