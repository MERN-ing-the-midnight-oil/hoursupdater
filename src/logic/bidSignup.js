/**
 * Electronic open-bid sign-up (Art. 3.08(c)(1)).
 * Gated by app-settings.electronic_bid_signup_enabled — off by default until
 * office + Union formally replace the paper sign-up sheet.
 *
 * The Forms workbook is EXTERNAL input (written by Microsoft Forms/Excel, not
 * this app). Parse defensively: match columns by header name, fail loudly on
 * schema surprises, never write to the file.
 */

import ExcelJS from 'exceljs';
import path from 'node:path';
import { BID_RESPONSE_SCHOOL_DAYS } from '../config.js';
import { getSeniorityOrder } from './seniority.js';
import { toDateString } from './timeUtils.js';

/**
 * @typedef {import('../data/storage.js').Driver} Driver
 * @typedef {import('./stateMachine.js').RouteStateEntry} RouteStateEntry
 * @typedef {import('./stateMachine.js').RouteStateMap} RouteStateMap
 *
 * @typedef {{
 *   driver_id: string,
 *   name: string,
 *   initials: string,
 *   signed_at: string,
 *   seniority_rank: number | null,
 * }} BidSignupResponder
 *
 * @typedef {{
 *   form_email: string,
 *   form_name: string,
 *   route_id: string,
 *   initials: string,
 *   signed_at: string,
 *   kind: 'unmatched' | 'ambiguous',
 *   suggestions: string[],
 * }} BidSignupMatchIssue
 *
 * @typedef {{
 *   drivers_notified_at: string | null,
 *   finalized_at: string | null,
 *   eligible_responders: BidSignupResponder[] | null,
 *   match_issues: BidSignupMatchIssue[] | null,
 *   workbook_mtime: string | null,
 * }} BidSignupState
 *
 * @typedef {'missing' | 'ok' | 'schema_error' | 'unreadable' | 'empty'} BidSignupFileStatus
 *
 * @typedef {{
 *   status: BidSignupFileStatus,
 *   message: string | null,
 *   missing_columns: string[],
 *   found_headers: string[],
 *   responses: {
 *     route_id: string,
 *     email: string,
 *     driver_name: string,
 *     initials: string,
 *     signed_at: string,
 *     source_row: number,
 *   }[],
 *   sheet_name: string | null,
 * }} BidSignupParseResult
 */

/** Exact Forms/custom question labels we require (matched by header name). */
export const REQUIRED_BID_SIGNUP_COLUMNS = [
  'Email',
  'Name',
  'Route ID',
  'Initials',
  'Completion time',
];

/** Columns Forms always writes that we intentionally ignore (for now). */
export const IGNORED_BID_SIGNUP_COLUMNS = ['ID', 'Start time'];

/**
 * @param {unknown} value
 * @returns {string}
 */
function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString();
  }
  if (typeof value === 'object') {
    const obj = /** @type {{ text?: unknown, result?: unknown }} */ (value);
    if (obj.text != null) return String(obj.text).trim();
    if (obj.result != null) return cellText(obj.result);
  }
  return String(value).trim();
}

/**
 * Normalize a header for comparison while preserving human label for errors.
 * @param {string} header
 */
function normalizeHeaderKey(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[\u00a0]/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Map a Forms header to a canonical field — by name only, never by position.
 * @param {string} header
 * @returns {'email' | 'name' | 'route_id' | 'initials' | 'completion_time' | 'ignored' | null}
 */
export function mapBidSignupHeader(header) {
  const key = normalizeHeaderKey(header);
  if (!key) return null;
  if (key === 'email' || key === 'email address') return 'email';
  if (key === 'name' || key === 'full name' || key === 'driver name') {
    return 'name';
  }
  if (key === 'route id' || key === 'route' || key === 'routeid') {
    return 'route_id';
  }
  if (key === 'initials' || key === 'initial') return 'initials';
  if (
    key === 'completion time' ||
    key === 'completed time' ||
    key === 'submission time'
  ) {
    return 'completion_time';
  }
  if (key === 'id' || key === 'start time') {
    return 'ignored';
  }
  return null;
}

/**
 * Prefer the Forms response sheet; skip “Read Me” documentation sheets.
 * @param {import('exceljs').Workbook} workbook
 */
function pickResponseSheet(workbook) {
  const sheets = workbook.worksheets ?? [];
  if (!sheets.length) return null;
  const preferred = sheets.find((s) => {
    const n = String(s.name || '')
      .trim()
      .toLowerCase();
    return (
      n.includes('bid') ||
      n.includes('form') ||
      n.includes('response') ||
      n === 'sheet1'
    );
  });
  if (preferred) return preferred;
  return (
    sheets.find((s) => {
      const n = String(s.name || '')
        .trim()
        .toLowerCase();
      return !n.includes('read me') && !n.includes('readme') && n !== 'about';
    }) ?? sheets[0]
  );
}

/**
 * Normalize an email for comparison (case-insensitive, trim only — no guessing).
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeBidSignupEmail(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Match Forms Email (M365 sign-in) to drivers.json email.
 * Case-insensitive exact only — never auto-bind a near miss.
 *
 * @param {string} formEmail
 * @param {Driver[]} drivers
 * @returns {{
 *   status: 'matched' | 'unmatched' | 'ambiguous',
 *   driver: Driver | null,
 *   suggestions: Driver[],
 * }}
 */
export function matchFormEmailToDriver(formEmail, drivers) {
  const needle = normalizeBidSignupEmail(formEmail);
  if (!needle || !needle.includes('@')) {
    return { status: 'unmatched', driver: null, suggestions: [] };
  }

  const exact = (drivers ?? []).filter(
    (d) => normalizeBidSignupEmail(d.email) === needle
  );
  if (exact.length === 1) {
    return { status: 'matched', driver: exact[0], suggestions: [] };
  }
  if (exact.length > 1) {
    return { status: 'ambiguous', driver: null, suggestions: exact };
  }
  return { status: 'unmatched', driver: null, suggestions: [] };
}

/**
 * Inspect an external Forms workbook buffer. Never mutate the file.
 *
 * @param {ArrayBuffer | Buffer | import('exceljs').Buffer} buffer
 * @returns {Promise<BidSignupParseResult>}
 */
export async function parseBidSignupWorkbookBuffer(buffer) {
  let workbook;
  try {
    workbook = new ExcelJS.Workbook();
    // @ts-expect-error exceljs accepts Buffer
    await workbook.xlsx.load(buffer);
  } catch (error) {
    return {
      status: 'unreadable',
      message: `Bid sign-up file could not be read as Excel: ${
        error instanceof Error ? error.message : String(error)
      }. Fix the file in Forms/OneDrive — this app never writes to it.`,
      missing_columns: [...REQUIRED_BID_SIGNUP_COLUMNS],
      found_headers: [],
      responses: [],
      sheet_name: null,
    };
  }

  const sheet = pickResponseSheet(workbook);
  if (!sheet) {
    return {
      status: 'unreadable',
      message:
        'Bid sign-up file has no worksheets. Confirm the Forms → Excel export landed in _app_data.',
      missing_columns: [...REQUIRED_BID_SIGNUP_COLUMNS],
      found_headers: [],
      responses: [],
      sheet_name: null,
    };
  }

  const headerRow = sheet.getRow(1);
  /** @type {string[]} */
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (c, col) => {
    headers[col - 1] = cellText(c.value);
  });
  while (headers.length && headers[headers.length - 1] === '') headers.pop();

  if (!headers.length) {
    return {
      status: 'schema_error',
      message:
        'Bid sign-up file has no header row. Expected columns: Email, Name, Route ID, Initials, Completion time.',
      missing_columns: [...REQUIRED_BID_SIGNUP_COLUMNS],
      found_headers: [],
      responses: [],
      sheet_name: sheet.name,
    };
  }

  /** @type {Partial<Record<'email'|'name'|'route_id'|'initials'|'completion_time', number>>} */
  const colIndex = {};
  for (let i = 0; i < headers.length; i += 1) {
    const field = mapBidSignupHeader(headers[i]);
    if (field && field !== 'ignored' && colIndex[field] == null) {
      colIndex[field] = i;
    }
  }

  /** @type {string[]} */
  const missing_columns = [];
  if (colIndex.email == null) missing_columns.push('Email');
  if (colIndex.name == null) missing_columns.push('Name');
  if (colIndex.route_id == null) missing_columns.push('Route ID');
  if (colIndex.initials == null) missing_columns.push('Initials');
  if (colIndex.completion_time == null) missing_columns.push('Completion time');

  if (missing_columns.length) {
    return {
      status: 'schema_error',
      message: `Bid sign-up file is missing an expected column: ${missing_columns.join(
        ', '
      )}. Match columns by header name in the Forms export (do not reorder blindly). This app never edits that file.`,
      missing_columns,
      found_headers: headers.filter(Boolean),
      responses: [],
      sheet_name: sheet.name,
    };
  }

  /** @type {BidSignupParseResult['responses']} */
  const responses = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const pick = (field) => {
      const idx = colIndex[field];
      return idx == null ? '' : cellText(row.getCell(idx + 1).value);
    };
    const email = pick('email');
    const driver_name = pick('name');
    const route_id = pick('route_id');
    const initials = pick('initials');
    const signed_at = pick('completion_time');
    // Blank trailing rows from Excel — skip quietly.
    if (!email && !driver_name && !route_id && !initials && !signed_at) return;
    // Incomplete response row — require all official fields (Email is the match key).
    if (!email || !driver_name || !route_id || !initials || !signed_at) return;
    responses.push({
      route_id,
      email,
      driver_name,
      initials,
      signed_at,
      source_row: rowNumber,
    });
  });

  if (!responses.length) {
    return {
      status: 'empty',
      message: 'No sign-up responses found yet.',
      missing_columns: [],
      found_headers: headers.filter(Boolean),
      responses: [],
      sheet_name: sheet.name,
    };
  }

  return {
    status: 'ok',
    message: null,
    missing_columns: [],
    found_headers: headers.filter(Boolean),
    responses,
    sheet_name: sheet.name,
  };
}

/**
 * Responses for one route that arrived on or before the due date (inclusive).
 * Eligibility is keyed by Email (M365 sign-in) → drivers.json email.
 * Name is display-only. Email mismatches are explicit match_issues — never silent.
 *
 * @param {{
 *   route_id: string,
 *   due_date: string,
 *   responses: {
 *     route_id: string,
 *     email: string,
 *     driver_name: string,
 *     initials: string,
 *     signed_at: string,
 *   }[],
 *   drivers: Driver[],
 * }} input
 * @returns {{ responders: BidSignupResponder[], match_issues: BidSignupMatchIssue[] }}
 */
export function buildEligibleResponders(input) {
  const due = toDateString(input.due_date);
  const routeKey = input.route_id.trim().toLowerCase();
  /** @type {Map<string, BidSignupResponder>} */
  const byDriver = new Map();
  /** @type {BidSignupMatchIssue[]} */
  const match_issues = [];

  for (const raw of input.responses) {
    if (raw.route_id.trim().toLowerCase() !== routeKey) continue;

    let signedDate = null;
    try {
      signedDate = raw.signed_at ? toDateString(raw.signed_at) : null;
    } catch {
      signedDate = null;
    }
    if (!signedDate) continue;
    if (signedDate > due) continue;

    const match = matchFormEmailToDriver(raw.email, input.drivers);
    if (match.status !== 'matched' || !match.driver) {
      match_issues.push({
        form_email: raw.email,
        form_name: raw.driver_name,
        route_id: raw.route_id,
        initials: raw.initials,
        signed_at: raw.signed_at,
        kind: match.status === 'ambiguous' ? 'ambiguous' : 'unmatched',
        suggestions: match.suggestions.map((d) => d.name),
      });
      continue;
    }

    const driver = match.driver;
    const existing = byDriver.get(driver.driver_id);
    if (
      existing &&
      existing.signed_at &&
      raw.signed_at &&
      existing.signed_at <= raw.signed_at
    ) {
      continue;
    }
    byDriver.set(driver.driver_id, {
      driver_id: driver.driver_id,
      name: driver.name,
      initials: raw.initials.trim(),
      signed_at: raw.signed_at,
      seniority_rank: null,
    });
  }

  const ranked = getSeniorityOrder(input.drivers);
  const rankById = new Map(
    ranked.map((d) => [d.driver_id, d.seniority_rank])
  );

  const responders = [...byDriver.values()]
    .map((row) => ({
      ...row,
      seniority_rank: rankById.get(row.driver_id) ?? null,
    }))
    .sort((a, b) => {
      if (a.seniority_rank == null && b.seniority_rank == null) {
        return a.name.localeCompare(b.name);
      }
      if (a.seniority_rank == null) return 1;
      if (b.seniority_rank == null) return -1;
      return a.seniority_rank - b.seniority_rank;
    });

  return { responders, match_issues };
}

/**
 * Empty bid-signup slot on a route.
 * @returns {BidSignupState}
 */
export function emptyBidSignupState() {
  return {
    drivers_notified_at: null,
    finalized_at: null,
    eligible_responders: null,
    match_issues: null,
    workbook_mtime: null,
  };
}

/**
 * @param {string | null | undefined} dueDate
 * @param {string | Date} asOfDate
 * @returns {boolean}
 */
export function isBidResponseWindowClosed(dueDate, asOfDate = new Date()) {
  if (!dueDate) return false;
  return toDateString(asOfDate) > toDateString(dueDate);
}

/**
 * Mailto draft: CC the entire active driver directory.
 *
 * @param {{
 *   route_id: string,
 *   bid_response_due_date: string | null,
 *   drivers: Driver[],
 *   template: { subject: string, body: string },
 *   to_email?: string,
 * }} input
 */
export function buildOpenBidPostingDraft(input) {
  const routeId = input.route_id.trim();
  const due = input.bid_response_due_date?.trim() || '';
  const fill = (text) =>
    String(text ?? '')
      .replaceAll('{{route_id}}', routeId)
      .replaceAll('{{bid_response_due_date}}', due);

  const subject = fill(input.template.subject);
  const body = fill(input.template.body);
  const emails = [
    ...new Set(
      input.drivers
        .map((d) => d.email?.trim())
        .filter((e) => typeof e === 'string' && e.includes('@'))
    ),
  ];

  if (!emails.length) {
    return {
      can_send: false,
      disabled_reason:
        'No driver emails on file — add emails in the driver directory before posting.',
      mailto_url: null,
      subject,
      body,
      cc_count: 0,
      missing_email_count: input.drivers.length,
    };
  }

  const toEmail = (input.to_email || '').trim();
  const cc = emails.join(',');
  const params = [
    `subject=${encodeURIComponent(subject)}`,
    `body=${encodeURIComponent(body)}`,
    `cc=${encodeURIComponent(cc)}`,
  ].join('&');

  const mailto_url = toEmail
    ? `mailto:${encodeURIComponent(toEmail)}?${params}`
    : `mailto:?${params}`;

  const missing = input.drivers.filter(
    (d) => !d.email?.trim() || !d.email.includes('@')
  ).length;

  return {
    can_send: true,
    disabled_reason: null,
    mailto_url,
    subject,
    body,
    cc_count: emails.length,
    missing_email_count: missing,
  };
}

export { BID_RESPONSE_SCHOOL_DAYS };

/**
 * Absolute path helper for configured workbook name under dataDir.
 * @param {string} dataDir
 * @param {string} workbookName
 */
export function bidSignupWorkbookPath(dataDir, workbookName) {
  const safe = path.basename(String(workbookName || 'bid-signups.xlsx').trim());
  return path.join(dataDir, safe || 'bid-signups.xlsx');
}

/**
 * Preserve bid sign-up due date + finalized snapshot across rebuilds.
 * @param {RouteStateMap} prior
 * @param {RouteStateMap} next
 * @returns {RouteStateMap}
 */
export function preserveBidSignupMeta(prior, next) {
  /** @type {RouteStateMap} */
  const updated = {};
  for (const [routeId, entry] of Object.entries(next)) {
    if (entry.status !== 'BID_PENDING') {
      updated[routeId] = {
        ...entry,
        bid_response_due_date: null,
        bid_signup: null,
      };
      continue;
    }
    const p = prior[routeId];
    if (p?.status === 'BID_PENDING') {
      updated[routeId] = {
        ...entry,
        bid_response_due_date:
          p.bid_response_due_date ?? entry.bid_response_due_date ?? null,
        bid_signup: p.bid_signup ?? entry.bid_signup ?? emptyBidSignupState(),
      };
    } else {
      updated[routeId] = {
        ...entry,
        bid_response_due_date: entry.bid_response_due_date ?? null,
        bid_signup: entry.bid_signup ?? emptyBidSignupState(),
      };
    }
  }
  return updated;
}

/**
 * When the 2-school-day window has closed and electronic sign-up is on,
 * snapshot eligible responders from the Forms workbook (once).
 * Schema/read failures do not invent an empty eligible list — they leave
 * the route unfinalized and surface via file_status for Admin.
 *
 * @param {RouteStateMap} routeStateMap
 * @param {{
 *   enabled: boolean,
 *   parse: BidSignupParseResult,
 *   drivers: Driver[],
 *   workbook_mtime?: string | null,
 *   asOfDate?: string | Date,
 * }} options
 * @returns {RouteStateMap}
 */
export function finalizeClosedBidSignups(routeStateMap, options) {
  if (!options.enabled) return routeStateMap;
  const asOf = options.asOfDate ?? new Date();
  const parse = options.parse;
  /** @type {RouteStateMap} */
  const updated = { ...routeStateMap };

  for (const [routeId, entry] of Object.entries(routeStateMap)) {
    if (entry.status !== 'BID_PENDING') continue;
    if (!entry.bid_response_due_date) continue;
    if (!isBidResponseWindowClosed(entry.bid_response_due_date, asOf)) continue;
    if (entry.bid_signup?.finalized_at && entry.bid_signup.eligible_responders) {
      continue;
    }

    // Schema / unreadable: leave unfinalized so Admin must fix Forms file.
    // Missing / empty / ok: finalize (zero eligible is a valid outcome).
    if (
      parse.status !== 'ok' &&
      parse.status !== 'empty' &&
      parse.status !== 'missing'
    ) {
      continue;
    }

    const { responders, match_issues } = buildEligibleResponders({
      route_id: routeId,
      due_date: entry.bid_response_due_date,
      responses: parse.responses,
      drivers: options.drivers,
    });

    updated[routeId] = {
      ...entry,
      bid_signup: {
        drivers_notified_at: entry.bid_signup?.drivers_notified_at ?? null,
        finalized_at: new Date().toISOString(),
        eligible_responders: responders,
        match_issues: match_issues.length ? match_issues : [],
        workbook_mtime: options.workbook_mtime ?? null,
      },
    };
  }
  return updated;
}
