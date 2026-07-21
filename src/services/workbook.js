import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { getAsOfDate } from '../config.js';
import { daysRemainingInWindow } from '../logic/calendar.js';
import { getSeniorityOrder } from '../logic/seniority.js';
import { isChangeEvent } from '../logic/stateMachine.js';

/**
 * @typedef {import('../logic/stateMachine.js').LogEntry} LogEntry
 * @typedef {import('../logic/stateMachine.js').RouteStateMap} RouteStateMap
 * @typedef {import('../logic/calendar.js').SchoolCalendar} SchoolCalendar
 * @typedef {import('../data/storage.js').Driver} Driver
 */

/**
 * Canonical logical workbook (sheet → rows of plain objects).
 * Used for hashing/diffing so OneDrive byte churn does not false-trigger.
 * @typedef {Object} LogicalWorkbook
 * @property {Record<string, string>[]} change_log
 * @property {Record<string, string|number|null>[]} routes
 * @property {Record<string, string|null>[]} drivers
 * @property {Record<string, string|number|null>[]} change_reports
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function cell(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? '').join('');
    }
  }
  return String(value);
}

/**
 * @param {object} input
 * @param {LogEntry[]} input.changeLog
 * @param {RouteStateMap} input.routeState
 * @param {Driver[]} input.drivers
 * @param {SchoolCalendar} input.schoolCalendar
 * @param {string | Date} [input.asOfDate]
 * @returns {LogicalWorkbook}
 */
export function buildLogicalWorkbook({
  changeLog,
  routeState,
  drivers,
  schoolCalendar,
  asOfDate = getAsOfDate(),
}) {
  /** @type {Map<string, number>} */
  const effectiveDeltas = new Map();
  // Resolve ADJUSTMENT overlays for display of "exact delta used"
  for (const entry of changeLog) {
    if (entry?.type === 'ADJUSTMENT') {
      effectiveDeltas.set(entry.target_change_id, entry.new_delta);
    }
  }

  const change_log = changeLog
    .filter(isChangeEvent)
    .map((entry) => {
      const change = /** @type {import('../logic/stateMachine.js').ChangeEvent} */ (
        entry
      );
      const delta = effectiveDeltas.has(change.id)
        ? effectiveDeltas.get(change.id)
        : change.delta_minutes;
      return {
        change_id: change.id,
        driver: change.driver_name,
        route: change.route_id,
        segment: change.segment,
        previous_time: change.previous_time,
        new_time: change.new_time,
        exact_delta_minutes: String(delta ?? ''),
        entered_by: change.entered_by,
        reason_category: change.reason_category,
        note: change.note,
        start_date: change.effective_date,
        submitted_at: change.submitted_at,
      };
    });

  const routes = Object.entries(routeState)
    .map(([route_id, entry]) => {
      const daysRemaining =
        entry.status === 'ACCUMULATING'
          ? daysRemainingInWindow(
              schoolCalendar,
              asOfDate,
              entry.window_expires_date
            )
          : null;
      return {
        route_id,
        driver: entry.driver_name,
        status: entry.status,
        cumulative_drift_minutes: String(entry.cumulative_drift_minutes ?? ''),
        window_expires_date: entry.window_expires_date ?? '',
        days_remaining:
          entry.status === 'ACCUMULATING' ? String(daysRemaining ?? '') : '',
        payroll_rounded_total_minutes:
          entry.payroll_rounded_total_minutes == null
            ? ''
            : String(entry.payroll_rounded_total_minutes),
        am: entry.segments?.AM ?? '',
        midday: entry.segments?.MIDDAY ?? '',
        pm: entry.segments?.PM ?? '',
        last_updated: entry.last_updated ?? '',
      };
    })
    .sort((a, b) => String(a.route_id).localeCompare(String(b.route_id)));

  /** @type {Map<string, string[]>} */
  const assignmentsByDriver = new Map();
  for (const [route_id, entry] of Object.entries(routeState)) {
    const key = entry.driver_id || entry.driver_name;
    if (!key) continue;
    if (!assignmentsByDriver.has(key)) assignmentsByDriver.set(key, []);
    assignmentsByDriver.get(key)?.push(route_id);
  }

  const seniorityById = new Map(
    getSeniorityOrder(drivers).map((row) => [row.driver_id, row])
  );

  const driversSheet = drivers
    .map((driver) => {
      const byId = assignmentsByDriver.get(driver.driver_id) ?? [];
      const byName = assignmentsByDriver.get(driver.name) ?? [];
      const routesAssigned = [...new Set([...byId, ...byName])].sort();
      const ranked = seniorityById.get(driver.driver_id);
      return {
        driver_id: driver.driver_id,
        name: driver.name,
        email: driver.email ?? '',
        hire_date: driver.hire_date ?? '',
        tie_break:
          driver.tie_break == null ? '' : String(driver.tie_break),
        seniority_rank:
          ranked?.seniority_rank == null
            ? ''
            : String(ranked.seniority_rank),
        current_assignments: routesAssigned.join(', '),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  /** @type {LogicalWorkbook['change_reports']} */
  const change_reports = [];
  for (const [route_id, entry] of Object.entries(routeState)) {
    for (const report of entry.change_reports ?? []) {
      change_reports.push({
        report_id: report.id,
        route_id,
        driver: report.driver_name,
        outcome: report.outcome,
        finalized_at: report.finalized_at,
        window_opened_date: report.window_opened_date ?? '',
        before_exact_total: String(report.before?.math?.exact_total_minutes ?? ''),
        after_exact_total: String(report.after?.math?.exact_total_minutes ?? ''),
        before_rounded_contracted: String(
          report.before?.math?.payroll_rounded_total_minutes ?? ''
        ),
        after_rounded_contracted: String(
          report.after?.math?.payroll_rounded_total_minutes ?? ''
        ),
        contracted_hours_statement: report.contracted_hours_statement ?? '',
      });
    }
  }
  change_reports.sort((a, b) =>
    String(b.finalized_at).localeCompare(String(a.finalized_at))
  );

  return {
    change_log,
    routes,
    drivers: driversSheet,
    change_reports,
  };
}

/**
 * Stable hash of logical sheet data (not xlsx bytes).
 * @param {LogicalWorkbook} logical
 * @returns {string}
 */
export function hashLogicalWorkbook(logical) {
  const canonical = JSON.stringify(logical);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * @param {Buffer | Uint8Array} bytes
 * @returns {string}
 */
export function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const CHANGE_LOG_HEADERS = [
  'change_id',
  'driver',
  'route',
  'segment',
  'previous_time',
  'new_time',
  'exact_delta_minutes',
  'entered_by',
  'reason_category',
  'note',
  'start_date',
  'submitted_at',
];

const ROUTES_HEADERS = [
  'route_id',
  'driver',
  'status',
  'cumulative_drift_minutes',
  'window_expires_date',
  'days_remaining',
  'payroll_rounded_total_minutes',
  'am',
  'midday',
  'pm',
  'last_updated',
];

const DRIVERS_HEADERS = [
  'driver_id',
  'name',
  'email',
  'hire_date',
  'tie_break',
  'seniority_rank',
  'current_assignments',
];

const REPORTS_HEADERS = [
  'report_id',
  'route_id',
  'driver',
  'outcome',
  'finalized_at',
  'window_opened_date',
  'before_exact_total',
  'after_exact_total',
  'before_rounded_contracted',
  'after_rounded_contracted',
  'contracted_hours_statement',
];

/**
 * @param {ExcelJS.Worksheet} sheet
 * @param {string[]} headers
 * @param {Record<string, unknown>[]} rows
 */
function writeTable(sheet, headers, rows) {
  sheet.addRow(headers);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  for (const row of rows) {
    sheet.addRow(headers.map((key) => row[key] ?? ''));
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
}

/**
 * @param {LogicalWorkbook} logical
 * @returns {Promise<Buffer>}
 */
export async function renderWorkbookBuffer(logical) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Teamster Tracker';
  workbook.created = new Date();

  const readMe = workbook.addWorksheet('Read Me');
  readMe.getColumn(1).width = 100;
  const banner = [
    'AUTO-GENERATED — DO NOT HAND-EDIT (unless intentionally testing reconciliation)',
    '',
    'This workbook is regenerated from _app_data/ whenever the app updates its JSON source of truth.',
    'change-log.json and route-state.json remain authoritative. This file is a read-facing view.',
    '',
    'If you edit this file in Excel/OneDrive, the app will detect the external change and will NOT',
    'silently overwrite it. Instead it raises a workbook reconciliation item in the Admin view so a',
    'human can compare app data vs. the edited file and either discard the edits or pull a correction',
    'back into _app_data/ as a proper attributed ADJUSTMENT (name + note required).',
    '',
    `Generated at: ${new Date().toISOString()}`,
  ];
  banner.forEach((line, index) => {
    const row = readMe.getRow(index + 1);
    row.getCell(1).value = line;
    if (index === 0) {
      row.font = { bold: true, color: { argb: 'FF8B2E2E' }, size: 14 };
    }
  });

  writeTable(
    workbook.addWorksheet('Change Log'),
    CHANGE_LOG_HEADERS,
    logical.change_log
  );
  writeTable(workbook.addWorksheet('Routes'), ROUTES_HEADERS, logical.routes);
  writeTable(
    workbook.addWorksheet('Drivers'),
    DRIVERS_HEADERS,
    logical.drivers
  );
  writeTable(
    workbook.addWorksheet('Change Reports'),
    REPORTS_HEADERS,
    logical.change_reports
  );

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * @param {Buffer | Uint8Array} bytes
 * @returns {Promise<LogicalWorkbook>}
 */
export async function parseWorkbookBuffer(bytes) {
  const workbook = new ExcelJS.Workbook();
  // exceljs accepts Buffer
  // @ts-ignore
  await workbook.xlsx.load(bytes);

  /**
   * @param {string} sheetName
   * @param {string[]} expectedHeaders
   */
  function readSheet(sheetName, expectedHeaders) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) {
      return [];
    }
    const headerRow = sheet.getRow(1);
    /** @type {string[]} */
    const headers = [];
    headerRow.eachCell({ includeEmpty: true }, (c, col) => {
      headers[col - 1] = cell(c.value).trim();
    });
    // Trim trailing empties
    while (headers.length && headers[headers.length - 1] === '') {
      headers.pop();
    }

    /** @type {Record<string, string>[]} */
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      /** @type {Record<string, string>} */
      const obj = {};
      for (let i = 0; i < headers.length; i += 1) {
        const key = headers[i] || expectedHeaders[i] || `col_${i}`;
        obj[key] = cell(row.getCell(i + 1).value);
      }
      rows.push(obj);
    });
    return rows;
  }

  return {
    change_log: readSheet('Change Log', CHANGE_LOG_HEADERS),
    routes: readSheet('Routes', ROUTES_HEADERS),
    drivers: readSheet('Drivers', DRIVERS_HEADERS),
    change_reports: readSheet('Change Reports', REPORTS_HEADERS),
  };
}

/**
 * Diff app-expected logical workbook vs on-disk workbook.
 * @param {LogicalWorkbook} appLogical
 * @param {LogicalWorkbook} fileLogical
 */
export function diffLogicalWorkbooks(appLogical, fileLogical) {
  /**
   * @param {string} sheet
   * @param {Record<string, unknown>[]} appRows
   * @param {Record<string, unknown>[]} fileRows
   * @param {string} keyField
   */
  function diffSheet(sheet, appRows, fileRows, keyField) {
    /** @type {Map<string, Record<string, unknown>>} */
    const appByKey = new Map(
      appRows.map((row) => [String(row[keyField] ?? ''), row])
    );
    /** @type {Map<string, Record<string, unknown>>} */
    const fileByKey = new Map(
      fileRows.map((row) => [String(row[keyField] ?? ''), row])
    );

    /** @type {object[]} */
    const changes = [];
    const keys = new Set([...appByKey.keys(), ...fileByKey.keys()]);
    for (const key of [...keys].sort()) {
      if (!key) continue;
      const appRow = appByKey.get(key);
      const fileRow = fileByKey.get(key);
      if (!appRow && fileRow) {
        changes.push({ key, kind: 'only_in_file', file: fileRow });
        continue;
      }
      if (appRow && !fileRow) {
        changes.push({ key, kind: 'only_in_app', app: appRow });
        continue;
      }
      const fieldDiffs = [];
      const fields = new Set([
        ...Object.keys(appRow ?? {}),
        ...Object.keys(fileRow ?? {}),
      ]);
      for (const field of fields) {
        const a = cell(appRow?.[field]);
        const b = cell(fileRow?.[field]);
        if (a !== b) {
          fieldDiffs.push({ field, app: a, file: b });
        }
      }
      if (fieldDiffs.length) {
        changes.push({ key, kind: 'modified', fields: fieldDiffs, app: appRow, file: fileRow });
      }
    }
    return { sheet, key_field: keyField, changes };
  }

  return {
    change_log: diffSheet(
      'Change Log',
      appLogical.change_log,
      fileLogical.change_log,
      'change_id'
    ),
    routes: diffSheet('Routes', appLogical.routes, fileLogical.routes, 'route_id'),
    drivers: diffSheet(
      'Drivers',
      appLogical.drivers,
      fileLogical.drivers,
      'driver_id'
    ),
    change_reports: diffSheet(
      'Change Reports',
      appLogical.change_reports,
      fileLogical.change_reports,
      'report_id'
    ),
  };
}

/**
 * True when any sheet has at least one change.
 * @param {ReturnType<typeof diffLogicalWorkbooks>} diff
 */
export function diffHasChanges(diff) {
  return Object.values(diff).some((sheet) => sheet.changes.length > 0);
}
