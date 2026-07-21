/**
 * Paper open-bid sign-up sheet (Art. 3.08(c)(1)).
 * Gated by app-settings.paper_bid_signup_enabled.
 */

import { SEGMENTS } from '../config.js';
import { compareDriversBySeniority, getSeniorityOrder } from './seniority.js';
import { fillTemplate } from './notifications.js';

/**
 * @typedef {{
 *   title: string,
 *   intro: string,
 *   footer: string,
 * }} PaperBidSheetTemplate
 *
 * @typedef {{
 *   driver_id: string,
 *   name: string,
 *   seniority_rank: number | null,
 *   more_senior_than_holder: boolean,
 * }} PaperBidSheetDriver
 */

/** @type {PaperBidSheetTemplate} */
export const DEFAULT_PAPER_BID_SHEET_TEMPLATE = {
  title: 'Open Bid Sign-Up Sheet',
  intro:
    'Drivers interested in this route should initial next to their name. Sign-up closes after two (2) school days — due {{bid_response_due_date}}. Failing to initial by that deadline is a rejection of the open position per Art. 3.08(c)(1).',
  footer:
    'Names in bold have more seniority than the current route holder. Initial in the box next to your name if you want to bid.',
};

/**
 * @param {unknown} raw
 * @param {PaperBidSheetTemplate} [fallback]
 * @returns {PaperBidSheetTemplate}
 */
export function normalizePaperBidSheetTemplate(
  raw,
  fallback = DEFAULT_PAPER_BID_SHEET_TEMPLATE
) {
  const record =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? /** @type {Record<string, unknown>} */ (raw)
      : {};
  return {
    title:
      typeof record.title === 'string' && record.title.trim()
        ? record.title.trim()
        : fallback.title,
    intro:
      typeof record.intro === 'string' ? record.intro : fallback.intro,
    footer:
      typeof record.footer === 'string' ? record.footer : fallback.footer,
  };
}

/**
 * True when candidate is strictly more senior than the route holder.
 * Incomplete hire dates cannot be compared — returns false.
 *
 * @param {{ hire_date?: string | null, tie_break?: number | null, name?: string }} candidate
 * @param {{ hire_date?: string | null, tie_break?: number | null, name?: string } | null | undefined} holder
 * @returns {boolean}
 */
export function isMoreSeniorThanHolder(candidate, holder) {
  if (!holder?.hire_date || !candidate?.hire_date) return false;
  return compareDriversBySeniority(candidate, holder) < 0;
}

/**
 * Format AM / Midday / PM schedule line for the sheet header.
 * @param {Record<string, string | null | undefined> | null | undefined} segments
 * @returns {string}
 */
export function formatPaperBidSchedule(segments) {
  if (!segments || typeof segments !== 'object') {
    return SEGMENTS.map((seg) => `${seg}: —`).join(' · ');
  }
  return SEGMENTS.map((seg) => {
    const value = String(segments[seg] ?? '').trim();
    return `${seg}: ${value || '—'}`;
  }).join(' · ');
}

/**
 * Split a seniority-ordered list into N columns (fill left → right).
 * @template T
 * @param {T[]} items
 * @param {number} [columnCount=3]
 * @returns {T[][]}
 */
export function splitIntoColumns(items, columnCount = 3) {
  const list = items ?? [];
  const n = Math.max(1, Math.floor(Number(columnCount) || 3));
  /** @type {T[][]} */
  const columns = Array.from({ length: n }, () => []);
  if (!list.length) return columns;
  const perCol = Math.ceil(list.length / n);
  for (let i = 0; i < n; i += 1) {
    columns[i] = list.slice(i * perCol, (i + 1) * perCol);
  }
  return columns;
}

/** @deprecated Use splitIntoColumns(items, 2) */
export function splitIntoTwoColumns(items) {
  const [left, right] = splitIntoColumns(items, 2);
  return [left, right];
}

/**
 * Estimate a font size (px) so a driver name fits a narrow column cell.
 * Used by DOCX export; the HTML sheet measures overflow and shrinks live.
 *
 * @param {string | null | undefined} name
 * @param {{
 *   basePx?: number,
 *   minPx?: number,
 *   maxCharsAtBase?: number,
 * }} [opts]
 * @returns {number}
 */
export function fitPaperBidNameFontPx(name, opts = {}) {
  const basePx = opts.basePx ?? 15;
  const minPx = opts.minPx ?? 9;
  const maxCharsAtBase = opts.maxCharsAtBase ?? 12;
  const len = String(name || '').trim().length;
  if (len <= maxCharsAtBase) return basePx;
  const scaled = (basePx * maxCharsAtBase) / len;
  return Math.max(minPx, Math.round(scaled * 10) / 10);
}

/**
 * Build printable sheet payload for a BID_PENDING route.
 *
 * @param {{
 *   route_id: string,
 *   driver_id?: string | null,
 *   driver_name?: string | null,
 *   segments?: Record<string, string | null | undefined> | null,
 *   bid_response_due_date?: string | null,
 *   paper_bid_start_date?: string | null,
 *   drivers: Array<{
 *     driver_id: string,
 *     name: string,
 *     hire_date?: string | null,
 *     tie_break?: number | null,
 *   }>,
 *   template?: PaperBidSheetTemplate | null,
 * }} input
 */
export function buildPaperBidSheet(input) {
  const routeId = String(input.route_id || '').trim();
  const template = normalizePaperBidSheetTemplate(input.template);
  const ranked = getSeniorityOrder(input.drivers ?? []);
  const holder =
    ranked.find((d) => d.driver_id === input.driver_id) ||
    (input.driver_id
      ? {
          driver_id: input.driver_id,
          name: input.driver_name || '',
          hire_date: null,
          tie_break: null,
        }
      : null);

  /** @type {PaperBidSheetDriver[]} */
  const drivers = ranked.map((d) => ({
    driver_id: d.driver_id,
    name: d.name,
    seniority_rank: d.seniority_rank,
    more_senior_than_holder: isMoreSeniorThanHolder(d, holder),
  }));

  const columns = splitIntoColumns(drivers, 3);
  const schedule = formatPaperBidSchedule(input.segments);
  const startDate = String(input.paper_bid_start_date || '').trim() || null;
  const due = String(input.bid_response_due_date || '').trim() || '';

  const values = {
    route_id: routeId,
    driver_name: input.driver_name || holder?.name || '',
    bid_response_due_date: due,
    start_date: startDate || '',
    schedule,
  };

  return {
    route_id: routeId,
    driver_id: input.driver_id ?? null,
    driver_name: input.driver_name || holder?.name || null,
    schedule,
    segments: Object.fromEntries(
      SEGMENTS.map((seg) => [
        seg,
        String(input.segments?.[seg] ?? '').trim() || null,
      ])
    ),
    bid_response_due_date: due || null,
    paper_bid_start_date: startDate,
    template: {
      title: fillTemplate(template.title, values),
      intro: fillTemplate(template.intro, values),
      footer: fillTemplate(template.footer, values),
    },
    template_raw: template,
    drivers,
    columns,
    /** @deprecated prefer columns[0] */
    left_column: columns[0] || [],
    /** @deprecated prefer columns[1] */
    middle_column: columns[1] || [],
    /** @deprecated prefer columns[2] */
    right_column: columns[2] || [],
  };
}

/**
 * Preserve paper bid start date across rebuilds while BID_PENDING.
 * @param {import('./stateMachine.js').RouteStateMap} prior
 * @param {import('./stateMachine.js').RouteStateMap} next
 * @returns {import('./stateMachine.js').RouteStateMap}
 */
export function preservePaperBidMeta(prior, next) {
  /** @type {import('./stateMachine.js').RouteStateMap} */
  const updated = {};
  for (const [routeId, entry] of Object.entries(next)) {
    if (entry.status !== 'BID_PENDING') {
      updated[routeId] = {
        ...entry,
        paper_bid_start_date: null,
      };
      continue;
    }
    const priorDate = prior[routeId]?.paper_bid_start_date ?? null;
    updated[routeId] = {
      ...entry,
      paper_bid_start_date:
        entry.paper_bid_start_date ?? priorDate ?? null,
    };
  }
  return updated;
}
