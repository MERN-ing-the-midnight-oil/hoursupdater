import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { getAsOfDate } from '../config.js';
import { daysRemainingInWindow } from '../logic/calendar.js';
import { clockTimeRows } from '../logic/clockSheet.js';
import { getSeniorityOrder } from '../logic/seniority.js';

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
 * @property {Record<string, string>[]} clock_times
 * @property {Record<string, string|number|null>[]} routes
 * @property {Record<string, string|null>[]} drivers
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
  const clock_times = clockTimeRows(changeLog).map((row) => ({
    route: row.route,
    driver: row.driver,
    kind: row.kind,
    date: row.date,
    run: row.run,
    clock_in: row.clock_in,
    clock_out: row.clock_out,
    note: row.note,
    change_id: row.change_id,
  }));

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
        route: route_id,
        driver: entry.driver_name,
        status: entry.status,
        cumulative_drift_minutes: String(entry.cumulative_drift_minutes ?? ''),
        window_expires_date: entry.window_expires_date ?? '',
        days_remaining:
          entry.status === 'ACCUMULATING' ? String(daysRemaining ?? '') : '',
      };
    })
    .sort((a, b) => String(a.route).localeCompare(String(b.route)));

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
        email: driver.email ?? '',
        name: driver.name,
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
    .sort((a, b) => String(a.email || a.name).localeCompare(String(b.email || b.name)));

  return {
    clock_times,
    routes,
    drivers: driversSheet,
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

const CLOCK_HEADERS = [
  'route',
  'driver',
  'kind',
  'date',
  'run',
  'clock_in',
  'clock_out',
  'note',
  'change_id',
];

const STATUS_HEADERS = [
  'route',
  'driver',
  'status',
  'cumulative_drift_minutes',
  'window_expires_date',
  'days_remaining',
];

const DRIVERS_HEADERS = [
  'email',
  'name',
  'hire_date',
  'tie_break',
  'seniority_rank',
  'current_assignments',
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
    'AUTO-GENERATED — regenerated from the OneDrive log. Hand-edits are replaced the next time the app saves.',
    '',
    'change-log.json is the source of truth. This workbook is the clock-time view:',
    'Clock Times has one row per run (route, driver, kind, date, run, clock in, clock out, note).',
    'Status is the current window. Drivers are keyed by email.',
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
    workbook.addWorksheet('Clock Times'),
    CLOCK_HEADERS,
    logical.clock_times
  );
  writeTable(workbook.addWorksheet('Status'), STATUS_HEADERS, logical.routes);
  writeTable(
    workbook.addWorksheet('Drivers'),
    DRIVERS_HEADERS,
    logical.drivers
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
    clock_times: readSheet('Clock Times', CLOCK_HEADERS),
    routes: readSheet('Status', STATUS_HEADERS),
    drivers: readSheet('Drivers', DRIVERS_HEADERS),
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
    clock_times: diffSheet(
      'Clock Times',
      appLogical.clock_times,
      fileLogical.clock_times,
      'change_id'
    ),
    routes: diffSheet('Status', appLogical.routes, fileLogical.routes, 'route'),
    drivers: diffSheet(
      'Drivers',
      appLogical.drivers,
      fileLogical.drivers,
      'email'
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
