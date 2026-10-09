/**
 * Monthly Time Summary for one driver. A calendar month, split into the
 * office pay periods (the 1st–15th and the 16th through month end).
 * Quarter-hour clocks follow the same snap used on Payroll Driver Times.
 */

import { formatClockAmPm } from '../../employee-tracker/src/clockTimes.js';
import {
  localDateKey,
  pairClockPunches,
  periodLabel,
  segmentForClock,
  semiMonthlyDates,
} from '../../src/logic/timesheets.js';
import { parseClockTime, roundClockToQuarterHour } from '../../src/logic/timeUtils.js';
import { formatQuarterHours, quarterHoursFromMinutes, sumRoundedQuarterHours } from './payrollTimes.js';

const RUN_ORDER = { am: 0, midday: 1, pm: 2 };
const RUN_LABEL = { am: 'AM', midday: 'Midday', pm: 'PM' };

/**
 * @param {string} value
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {Date} date
 */
function clockFromDate(date) {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * @param {string} clockIn
 * @param {string} clockOut
 */
function minutesApart(clockIn, clockOut) {
  const start = parseClockTime(clockIn);
  let end = parseClockTime(clockOut);
  if (end < start) end += 24 * 60;
  return end - start;
}

/**
 * @param {Date} date
 */
function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * @param {string} key
 */
function monthLabel(key) {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * @param {string} key
 */
function monthFromKey(key) {
  const [year, month] = key.split('-').map(Number);
  return { year, monthIndex: month - 1 };
}

/**
 * @param {Array<{ punched_at?: string }>} punches
 * @param {Date} now
 */
function monthKeys(punches, now) {
  const keys = new Set([monthKey(now)]);
  for (const punch of punches) {
    const date = new Date(punch?.punched_at);
    if (!Number.isNaN(date.getTime())) keys.add(monthKey(date));
  }
  return [...keys].sort();
}

/**
 * @param {object} punch
 */
function punchNote(punch) {
  return String(punch?.note || '').trim();
}

/**
 * @param {object} clockIn
 * @param {object} [clockOut]
 */
function combinedNote(clockIn, clockOut) {
  const reasons = [];
  const seen = new Set();
  for (const code of [...(clockIn?.reason_codes || []), ...(clockOut?.reason_codes || [])]) {
    const label = String(code?.label || '').trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    reasons.push(label);
  }
  return [punchNote(clockIn), clockOut ? punchNote(clockOut) : '', reasons.join(', ')].filter(Boolean).join(' · ');
}

/**
 * @param {{
 *   driverName: string,
 *   routes?: string[],
 *   punches?: object[],
 *   roundClocks?: boolean,
 *   now?: Date,
 * }} input
 */
export function buildMonthlyTimeSummary(input) {
  const driverName = String(input.driverName || '').trim();
  const wanted = driverName.toLowerCase();
  const roundClocks = input.roundClocks !== false;
  const now = input.now instanceof Date ? input.now : new Date();
  const punches = (input.punches || []).filter(
    (punch) => String(punch?.driver_name || '').trim().toLowerCase() === wanted
  );
  const { pairs, unpaired } = pairClockPunches(punches);
  /** @type {Array<object>} */
  const lines = [];

  for (const pair of pairs) {
    const earlier = pair.start.getTime() <= pair.end.getTime() ? pair.start : pair.end;
    const run = segmentForClock(earlier);
    const clockIn = clockFromDate(pair.start);
    const clockOut = clockFromDate(pair.end);
    const usedIn = roundClocks ? roundClockToQuarterHour(clockIn) : clockIn;
    const usedOut = roundClocks ? roundClockToQuarterHour(clockOut) : clockOut;
    const minutes = usedIn && usedOut ? minutesApart(usedIn, usedOut) : null;
    const quarterHours = quarterHoursFromMinutes(minutes);
    lines.push({
      when: earlier,
      run,
      clockIn: formatClockAmPm(clockIn),
      clockOut: formatClockAmPm(clockOut),
      quarterClocks: usedIn && usedOut ? `${formatClockAmPm(usedIn)}–${formatClockAmPm(usedOut)}` : '',
      minutes,
      quarterHours,
      note: combinedNote(pair.clockIn, pair.clockOut),
    });
  }

  for (const item of unpaired) {
    const when = new Date(item.punch?.punched_at);
    if (Number.isNaN(when.getTime())) continue;
    const clock = formatClockAmPm(clockFromDate(when));
    const run = segmentForClock(when);
    lines.push({
      when,
      run,
      clockIn: item.reason === 'in' ? clock : '',
      clockOut: item.reason === 'out' ? clock : '',
      quarterClocks: '',
      minutes: null,
      quarterHours: null,
      note: combinedNote(item.punch),
    });
  }

  lines.sort((a, b) => {
    const byTime = a.when.getTime() - b.when.getTime();
    if (byTime !== 0) return byTime;
    return RUN_ORDER[a.run] - RUN_ORDER[b.run];
  });

  const keys = monthKeys(punches, now);
  const months = keys.map((key) => {
    const { year, monthIndex } = monthFromKey(key);
    const periods = [1, 2].map((half) => {
      const dates = semiMonthlyDates(year, monthIndex, /** @type {1 | 2} */ (half));
      const dateKeys = new Set(dates.map((date) => localDateKey(date)));
      const rows = lines
        .filter((line) => dateKeys.has(localDateKey(line.when)))
        .map((line) => ({
          date: line.when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          weekday: line.when.toLocaleDateString('en-US', { weekday: 'short' }),
          run: RUN_LABEL[line.run],
          clockIn: line.clockIn,
          clockOut: line.clockOut,
          quarterClocks: line.quarterClocks,
          minutes: line.minutes == null ? '' : String(line.minutes),
          quarterHours: formatQuarterHours(line.quarterHours),
          note: line.note,
        }));
      const quarterTotal = sumRoundedQuarterHours(
        lines
          .filter((line) => dateKeys.has(localDateKey(line.when)))
          .map((line) => line.quarterHours)
      );
      const minuteTotal = lines
        .filter((line) => dateKeys.has(localDateKey(line.when)) && line.minutes != null)
        .reduce((total, line) => total + line.minutes, 0);
      return {
        label: periodLabel({ year, monthIndex, half: /** @type {1 | 2} */ (half) }),
        rows,
        minutes: rows.some((row) => row.minutes) ? String(minuteTotal) : '',
        quarterHours: formatQuarterHours(quarterTotal),
      };
    });
    const monthQuarter = sumRoundedQuarterHours(
      periods.map((period) => {
        const number = Number(period.quarterHours);
        return period.quarterHours === '' || !Number.isFinite(number) ? null : number;
      })
    );
    const monthMinutes = periods.reduce((total, period) => total + (Number(period.minutes) || 0), 0);
    return {
      key,
      label: monthLabel(key),
      periods,
      minutes: periods.some((period) => period.minutes) ? String(monthMinutes) : '',
      quarterHours: formatQuarterHours(monthQuarter),
    };
  });

  return {
    driverName,
    routes: (input.routes || []).filter(Boolean),
    roundClocks,
    defaultMonth: months.some((month) => month.key === monthKey(now)) ? monthKey(now) : months[months.length - 1].key,
    months,
  };
}

/**
 * @param {ReturnType<typeof buildMonthlyTimeSummary>} summary
 */
export function renderMonthlyTimeSummaryHtml(summary) {
  const routeLine = summary.routes.length ? `Route ${summary.routes.join(', ')}` : 'No route';
  const rounding = summary.roundClocks
    ? 'Clock in and clock out snap to the nearest quarter hour. Minutes are the time between those clocks.'
    : 'Clock in and clock out stay exact. Quarter hours round the minutes.';
  const options = summary.months
    .map(
      (month) =>
        `<option value="${escapeHtml(month.key)}"${month.key === summary.defaultMonth ? ' selected' : ''}>${escapeHtml(month.label)}</option>`
    )
    .join('');
  const sections = summary.months
    .map((month) => {
      const periods = month.periods
        .map((period) => {
          const body = period.rows.length
            ? period.rows
                .map(
                  (row) => `<tr>
                    <td>${escapeHtml(row.date)}</td>
                    <td>${escapeHtml(row.weekday)}</td>
                    <td>${escapeHtml(row.run)}</td>
                    <td>${escapeHtml(row.clockIn)}</td>
                    <td>${escapeHtml(row.clockOut)}</td>
                    <td>${escapeHtml(row.quarterClocks)}</td>
                    <td class="num">${escapeHtml(row.minutes)}</td>
                    <td class="num">${escapeHtml(row.quarterHours)}</td>
                    <td>${escapeHtml(row.note)}</td>
                  </tr>`
                )
                .join('')
            : `<tr><td colspan="9">No clock records in this pay period.</td></tr>`;
          return `<section>
            <h2>${escapeHtml(period.label)}</h2>
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Day</th><th>Run</th><th>Clock in</th><th>Clock out</th>
                  <th>Quarter-hour clocks</th><th>Minutes</th><th>Quarter hours</th><th>Note</th>
                </tr>
              </thead>
              <tbody>${body}</tbody>
              <tfoot>
                <tr>
                  <td colspan="6">Pay period total</td>
                  <td class="num">${escapeHtml(period.minutes)}</td>
                  <td class="num">${escapeHtml(period.quarterHours)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </section>`;
        })
        .join('');
      return `<article data-month="${escapeHtml(month.key)}"${month.key === summary.defaultMonth ? '' : ' hidden'}>
        <p class="month-total">Month total <strong>${escapeHtml(month.quarterHours || '0.0')}</strong> quarter hours${month.minutes ? ` · ${escapeHtml(month.minutes)} minutes` : ''}</p>
        ${periods}
      </article>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Monthly Time Summary — ${escapeHtml(summary.driverName)}</title>
  <style>
    body { margin: 0; color: #1c1e22; background: #f7f5fb; font: 16px/1.4 "Avenir Next", "Segoe UI", sans-serif; }
    main { max-width: 72rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
    h1 { margin: 0; font-size: 1.6rem; letter-spacing: 0.04em; }
    h2 { margin: 1.4rem 0 0.4rem; font-size: 1.05rem; }
    .who { margin: 0.2rem 0 0; font-size: 1.35rem; }
    .meta { margin: 0.15rem 0 0; color: #5c5670; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: end; margin: 1rem 0; }
    label { font-weight: 650; font-size: 0.92rem; }
    select, button { font: inherit; }
    select { margin-left: 0.4rem; padding: 0.35rem 0.5rem; }
    button { border: 1px solid #5b3f91; background: #5b3f91; color: #fff; border-radius: 6px; padding: 0.45rem 0.8rem; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { border-bottom: 1px solid #e4dfef; padding: 0.4rem 0.5rem; text-align: left; white-space: nowrap; font-size: 0.92rem; }
    th { background: #efeaf8; font-size: 0.78rem; letter-spacing: 0.02em; }
    td:last-child, th:last-child { white-space: normal; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    tfoot td { font-weight: 700; background: #faf8ff; }
    .month-total { margin: 0.2rem 0 0; }
    @media print {
      body { background: #fff; }
      .toolbar { display: none; }
      article[hidden] { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <h1>MONTHLY TIME SUMMARY</h1>
    <p class="who">${escapeHtml(summary.driverName)}</p>
    <p class="meta">${escapeHtml(routeLine)}</p>
    <p class="meta">${escapeHtml(rounding)}</p>
    <div class="toolbar">
      <label>Month <select id="month">${options}</select></label>
      <button type="button" id="print">Print</button>
    </div>
    ${sections}
  </main>
  <script>
    const month = document.querySelector('#month');
    function showMonth() {
      for (const article of document.querySelectorAll('[data-month]')) {
        article.hidden = article.getAttribute('data-month') !== month.value;
      }
    }
    month.addEventListener('change', showMonth);
    document.querySelector('#print').addEventListener('click', () => print());
    showMonth();
  </script>
</body>
</html>`;
}
