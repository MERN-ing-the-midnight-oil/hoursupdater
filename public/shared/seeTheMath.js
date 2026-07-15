/**
 * Shared "see the math" renderer for Change Reports and payroll breakdowns.
 * Both Admin queue and any future Routing surface should call this — do not
 * re-implement the before/after rounding explanation elsewhere.
 */
import { appendGlossaryTip } from './glossaryTip.js';
import { createIcon } from './icons.js';

/**
 * @param {HTMLElement} container
 * @param {{
 *   before?: { exact_total_minutes: number, payroll_rounded_total_minutes: number, segments?: object },
 *   after?: { exact_total_minutes: number, payroll_rounded_total_minutes: number, segments?: object },
 *   statement?: string,
 * } | null} math
 */
export function renderSeeTheMath(container, math) {
  container.innerHTML = '';
  if (!math?.before || !math?.after) {
    container.textContent = 'No payroll math available for this report.';
    return;
  }

  const statement = document.createElement('p');
  statement.className = 'math-statement';
  statement.textContent = math.statement || '';

  const grid = document.createElement('div');
  grid.className = 'math-grid';

  for (const [label, side, iconName] of [
    ['Before window', math.before, 'history'],
    ['After window', math.after, 'check-circle'],
  ]) {
    const block = document.createElement('div');
    block.className = 'math-side';

    const heading = document.createElement('h4');
    heading.className = 'with-icon';
    heading.append(createIcon(iconName), document.createTextNode(label));
    if (label === 'Before window') {
      appendGlossaryTip(heading, 'window');
    }

    const dl = document.createElement('dl');
    dl.append(
      mathStat('Exact scheduled total', `${side.exact_total_minutes} min`, 'scheduled_time'),
      mathStat(
        'Rounded contracted hours',
        `${side.payroll_rounded_total_minutes} min`,
        'contracted_hours'
      )
    );

    block.append(heading, dl);
    grid.appendChild(block);
  }

  container.append(statement, grid);
}

/**
 * @param {string} label
 * @param {string} value
 * @param {string} glossaryId
 * @returns {HTMLElement}
 */
function mathStat(label, value, glossaryId) {
  const row = document.createElement('div');
  const dt = document.createElement('dt');
  dt.append(document.createTextNode(label));
  appendGlossaryTip(dt, glossaryId);
  const dd = document.createElement('dd');
  dd.textContent = value;
  row.append(dt, dd);
  return row;
}

/**
 * Format a Change Report for Admin history display.
 * @param {object} report
 * @returns {string}
 */
export function formatReportOutcome(report) {
  if (report.outcome === 'BID_PENDING') return 'Bid pending';
  if (report.outcome === 'BUMP_ELIGIBLE') return 'Bump eligible';
  if (report.outcome === 'STABLE') return 'Locked in';
  return String(report.outcome || '—');
}

/**
 * @param {number} minutes
 * @returns {string}
 */
export function formatSignedMinutes(minutes) {
  if (minutes > 0) return `+${minutes}`;
  return String(minutes);
}
