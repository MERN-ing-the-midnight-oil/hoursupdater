import { randomUUID } from 'node:crypto';
import { emptySegments } from './stateMachine.js';
import { normalizeHireDate, findUnresolvedSeniorityTies } from './seniority.js';
import { parseTimeRange } from './timeUtils.js';

const REQUIRED_HEADERS = ['driver_name', 'route_id'];
const OPTIONAL_HEADERS = [
  'driver_email',
  'hire_date',
  'am_time',
  'midday_time',
  'pm_time',
];
const ALL_HEADERS = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS];

const HEADER_ALIASES = {
  driver_name: 'driver_name',
  drivername: 'driver_name',
  name: 'driver_name',
  driver_email: 'driver_email',
  driveremail: 'driver_email',
  email: 'driver_email',
  hire_date: 'hire_date',
  hiredate: 'hire_date',
  hired: 'hire_date',
  route_id: 'route_id',
  routeid: 'route_id',
  route: 'route_id',
  am_time: 'am_time',
  am: 'am_time',
  am_time_range: 'am_time',
  midday_time: 'midday_time',
  midday: 'midday_time',
  md_time: 'midday_time',
  pm_time: 'pm_time',
  pm: 'pm_time',
};

/**
 * @typedef {Object} BulkImportRawRow
 * @property {number} row_number - 1-based data row (header is row 0 conceptually)
 * @property {string} driver_name
 * @property {string} driver_email
 * @property {string} hire_date
 * @property {string} route_id
 * @property {string} am_time
 * @property {string} midday_time
 * @property {string} pm_time
 * @property {Record<string, string>} raw
 */

/**
 * @typedef {Object} BulkImportExcludedRow
 * @property {number} row_number
 * @property {string[]} reasons
 * @property {Record<string, string>} raw
 */

/**
 * @typedef {Object} BulkImportConflict
 * @property {number} row_number
 * @property {string} route_id
 * @property {string} driver_name
 * @property {('existing_route' | 'existing_driver')[]} conflict_types
 * @property {{ driver_id: string, name: string, email: string | null } | null} existing_driver
 * @property {{ status: string, driver_name: string | null } | null} existing_route
 * @property {boolean} overwrite_allowed
 * @property {string | null} overwrite_blocked_reason
 */

/**
 * @typedef {Object} BulkImportPlannedRow
 * @property {number} row_number
 * @property {string} route_id
 * @property {string} driver_name
 * @property {string | null} driver_email
 * @property {string | null} hire_date
 * @property {Record<'AM'|'MIDDAY'|'PM', string | null>} segments
 * @property {boolean} will_create_driver
 * @property {boolean} will_create_route
 * @property {boolean} has_conflict
 */

/**
 * @typedef {Object} BulkImportPreview
 * @property {{ new_drivers_count: number, new_routes_count: number, planned_row_count: number, conflict_row_count: number, excluded_row_count: number }} summary
 * @property {BulkImportExcludedRow[]} excluded_rows
 * @property {BulkImportConflict[]} conflicts
 * @property {BulkImportPlannedRow[]} planned
 * @property {boolean} requires_resolutions
 * @property {{ hire_date: string, drivers: { driver_id: string, name: string }[] }[]} unresolved_seniority_ties
 */

/**
 * Split a CSV/TSV line respecting double-quoted fields.
 * @param {string} line
 * @param {string} delimiter
 * @returns {string[]}
 */
export function splitDelimitedLine(line, delimiter) {
  /** @type {string[]} */
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      fields.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/**
 * @param {string} headerCell
 * @returns {string | null}
 */
function normalizeHeader(headerCell) {
  const key = String(headerCell || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return HEADER_ALIASES[key] ?? null;
}

/**
 * Detect delimiter from the header line (comma vs tab). Prefer the one
 * that yields more recognized headers.
 * @param {string} headerLine
 * @returns {string}
 */
export function detectDelimiter(headerLine) {
  const candidates = [',', '\t', ';'];
  let best = ',';
  let bestScore = -1;
  for (const delimiter of candidates) {
    const cells = splitDelimitedLine(headerLine, delimiter);
    const score = cells.filter((c) => normalizeHeader(c)).length;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

/**
 * @param {string} text
 * @returns {BulkImportRawRow[]}
 */
export function parseBulkImportText(text) {
  const normalized = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!normalized) {
    throw new Error('Import text is empty. Paste a table or upload a CSV.');
  }

  const lines = normalized.split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) {
    throw new Error(
      'Import needs a header row and at least one data row.'
    );
  }

  const delimiter = detectDelimiter(lines[0]);
  const headerCells = splitDelimitedLine(lines[0], delimiter);
  /** @type {Record<string, number>} */
  const columnIndex = {};
  for (let i = 0; i < headerCells.length; i += 1) {
    const mapped = normalizeHeader(headerCells[i]);
    if (mapped && columnIndex[mapped] == null) {
      columnIndex[mapped] = i;
    }
  }

  for (const required of REQUIRED_HEADERS) {
    if (columnIndex[required] == null) {
      throw new Error(
        `Missing required column "${required}". Expected headers: ${ALL_HEADERS.join(', ')}.`
      );
    }
  }

  /** @type {BulkImportRawRow[]} */
  const rows = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const cells = splitDelimitedLine(lines[lineIndex], delimiter);
    const pick = (name) => {
      const idx = columnIndex[name];
      return idx == null ? '' : String(cells[idx] ?? '').trim();
    };
    const raw = {
      driver_name: pick('driver_name'),
      driver_email: pick('driver_email'),
      hire_date: pick('hire_date'),
      route_id: pick('route_id'),
      am_time: pick('am_time'),
      midday_time: pick('midday_time'),
      pm_time: pick('pm_time'),
    };
    // Skip blank data rows and rows that only had values in unrecognized columns.
    if (!Object.values(raw).some((value) => value !== '')) {
      continue;
    }
    rows.push({
      row_number: lineIndex,
      ...raw,
      raw,
    });
  }

  if (!rows.length) {
    throw new Error(
      'Import needs a header row and at least one data row.'
    );
  }

  return rows;
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function normalizeOptionalTime(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  parseTimeRange(trimmed);
  return trimmed;
}

/**
 * @param {BulkImportRawRow} row
 * @returns {{ ok: true, segments: Record<'AM'|'MIDDAY'|'PM', string | null>, driver_name: string, driver_email: string | null, hire_date: string | null, route_id: string } | { ok: false, reasons: string[] }}
 */
export function validateBulkImportRow(row) {
  /** @type {string[]} */
  const reasons = [];
  const driver_name = String(row.driver_name || '').trim();
  const route_id = String(row.route_id || '').trim();
  const emailRaw = String(row.driver_email || '').trim();

  if (!driver_name) reasons.push('driver_name is required.');
  if (!route_id) reasons.push('route_id is required.');

  /** @type {string | null} */
  let hire_date = null;
  try {
    hire_date = normalizeHireDate(row.hire_date);
  } catch (error) {
    reasons.push(
      error instanceof Error ? error.message : 'hire_date is invalid.'
    );
  }

  /** @type {Record<'AM'|'MIDDAY'|'PM', string | null>} */
  const segments = emptySegments();
  try {
    segments.AM = normalizeOptionalTime(row.am_time);
  } catch (error) {
    reasons.push(
      error instanceof Error ? `am_time: ${error.message}` : 'am_time is invalid.'
    );
  }
  try {
    segments.MIDDAY = normalizeOptionalTime(row.midday_time);
  } catch (error) {
    reasons.push(
      error instanceof Error
        ? `midday_time: ${error.message}`
        : 'midday_time is invalid.'
    );
  }
  try {
    segments.PM = normalizeOptionalTime(row.pm_time);
  } catch (error) {
    reasons.push(
      error instanceof Error ? `pm_time: ${error.message}` : 'pm_time is invalid.'
    );
  }

  if (!segments.AM && !segments.MIDDAY && !segments.PM) {
    reasons.push(
      'At least one of am_time, midday_time, or pm_time is required.'
    );
  }

  if (reasons.length) {
    return { ok: false, reasons };
  }

  return {
    ok: true,
    segments,
    driver_name,
    driver_email: emailRaw || null,
    hire_date,
    route_id,
  };
}

/**
 * @param {import('../data/storage.js').Driver[]} drivers
 * @param {string} name
 */
function findDriverCaseInsensitive(drivers, name) {
  const needle = name.trim().toLowerCase();
  return drivers.find((d) => d.name.toLowerCase() === needle) ?? null;
}

/**
 * Build a dry-run preview: counts, excluded invalid rows, and conflicts that
 * need skip/overwrite before commit.
 *
 * @param {string | BulkImportRawRow[]} input
 * @param {{ drivers: import('../data/storage.js').Driver[], routeState: import('./stateMachine.js').RouteStateMap, changeLog?: import('./stateMachine.js').LogEntry[] }} context
 * @returns {BulkImportPreview}
 */
export function previewBulkImport(input, context) {
  const rawRows = typeof input === 'string' ? parseBulkImportText(input) : input;
  const { drivers, routeState } = context;
  const changeLog = context.changeLog ?? [];

  /** @type {Set<string>} */
  const routeIdsWithHistory = new Set();
  for (const entry of changeLog) {
    if (
      entry?.type === 'ADJUSTMENT' ||
      entry?.type === 'BULK_IMPORT' ||
      entry?.type === 'SENIORITY_TIE_RESOLUTION'
    ) {
      continue;
    }
    const routeId = /** @type {{ route_id?: string }} */ (entry).route_id?.trim();
    if (routeId) routeIdsWithHistory.add(routeId);
  }

  /** @type {BulkImportExcludedRow[]} */
  const excluded_rows = [];
  /** @type {BulkImportConflict[]} */
  const conflicts = [];
  /** @type {BulkImportPlannedRow[]} */
  const planned = [];

  /** @type {Set<string>} */
  const seenRouteIds = new Set();
  /** @type {Map<string, { email: string | null, hire_date: string | null, name: string }>} */
  const batchNewDrivers = new Map();

  for (const raw of rawRows) {
    const validated = validateBulkImportRow(raw);
    if (!validated.ok) {
      excluded_rows.push({
        row_number: raw.row_number,
        reasons: validated.reasons,
        raw: raw.raw,
      });
      continue;
    }

    const {
      driver_name,
      driver_email,
      hire_date,
      route_id,
      segments,
    } = validated;
    const routeKey = route_id.toLowerCase();

    if (seenRouteIds.has(routeKey)) {
      excluded_rows.push({
        row_number: raw.row_number,
        reasons: [
          `Duplicate route_id "${route_id}" in this import — only the first row is kept.`,
        ],
        raw: raw.raw,
      });
      continue;
    }
    seenRouteIds.add(routeKey);

    const existingDriver = findDriverCaseInsensitive(drivers, driver_name);
    const existingRoute = routeState[route_id] ?? null;
    /** Match exact key first; also catch case-only collisions on route ids. */
    const existingRouteKey =
      existingRoute
        ? route_id
        : Object.keys(routeState).find((id) => id.toLowerCase() === routeKey) ??
          null;
    const resolvedExistingRoute = existingRouteKey
      ? routeState[existingRouteKey]
      : null;
    const resolvedRouteId = existingRouteKey ?? route_id;

    /** @type {('existing_route' | 'existing_driver')[]} */
    const conflict_types = [];
    if (resolvedExistingRoute) conflict_types.push('existing_route');
    if (existingDriver) conflict_types.push('existing_driver');

    const has_conflict = conflict_types.length > 0;
    const driverKey = driver_name.toLowerCase();

    // New directory names (including route-only conflict overwrites) need hire_date.
    if (!existingDriver && !hire_date && !batchNewDrivers.has(driverKey)) {
      excluded_rows.push({
        row_number: raw.row_number,
        reasons: [
          'hire_date is required when creating a new driver (YYYY-MM-DD).',
        ],
        raw: raw.raw,
      });
      continue;
    }

    let will_create_driver = false;
    if (!existingDriver && !has_conflict) {
      if (batchNewDrivers.has(driverKey)) {
        will_create_driver = false;
      } else {
        will_create_driver = true;
        batchNewDrivers.set(driverKey, {
          email: driver_email,
          hire_date,
          name: driver_name,
        });
      }
    } else if (!existingDriver && hire_date && !batchNewDrivers.has(driverKey)) {
      // Remember hire_date for later create during route overwrite resolution.
      batchNewDrivers.set(driverKey, {
        email: driver_email,
        hire_date,
        name: driver_name,
      });
    }

    const will_create_route = !resolvedExistingRoute && !has_conflict;

    let overwrite_allowed = true;
    /** @type {string | null} */
    let overwrite_blocked_reason = null;
    if (resolvedExistingRoute && routeIdsWithHistory.has(resolvedRouteId)) {
      overwrite_allowed = false;
      overwrite_blocked_reason =
        `Route "${resolvedRouteId}" already has change-log history — skip this row, or correct it with the existing per-route tools.`;
    }

    if (has_conflict) {
      conflicts.push({
        row_number: raw.row_number,
        route_id: resolvedRouteId,
        driver_name: existingDriver?.name ?? driver_name,
        conflict_types,
        existing_driver: existingDriver
          ? {
              driver_id: existingDriver.driver_id,
              name: existingDriver.name,
              email: existingDriver.email,
            }
          : null,
        existing_route: resolvedExistingRoute
          ? {
              status: resolvedExistingRoute.status,
              driver_name: resolvedExistingRoute.driver_name,
            }
          : null,
        overwrite_allowed,
        overwrite_blocked_reason,
      });
    }

    planned.push({
      row_number: raw.row_number,
      route_id: resolvedRouteId,
      driver_name,
      driver_email,
      hire_date,
      segments,
      will_create_driver,
      will_create_route,
      has_conflict,
    });
  }

  const newDriversFromNonConflict = new Set(
    planned
      .filter((p) => p.will_create_driver)
      .map((p) => p.driver_name.toLowerCase())
  );
  const newRoutesFromNonConflict = planned.filter(
    (p) => p.will_create_route
  ).length;

  /** @type {import('../data/storage.js').Driver[]} */
  const projectedDrivers = drivers.map((d) => ({ ...d }));
  /** @type {Map<string, import('../data/storage.js').Driver>} */
  const projectedByName = new Map(
    projectedDrivers.map((d) => [d.name.toLowerCase(), d])
  );
  for (const row of planned) {
    const key = row.driver_name.toLowerCase();
    const existing = projectedByName.get(key);
    if (existing) {
      if (row.hire_date && row.hire_date !== existing.hire_date) {
        existing.hire_date = row.hire_date;
        existing.tie_break = null;
      }
      continue;
    }
    const batch = batchNewDrivers.get(key);
    const hire = row.hire_date ?? batch?.hire_date ?? null;
    if (!hire) continue;
    const created = {
      driver_id: `preview:${key}`,
      name: batch?.name ?? row.driver_name,
      email: row.driver_email ?? batch?.email ?? null,
      hire_date: hire,
      tie_break: null,
    };
    projectedDrivers.push(created);
    projectedByName.set(key, created);
  }
  const unresolved_seniority_ties = findUnresolvedSeniorityTies(
    projectedDrivers
  ).map((tie) => ({
    hire_date: tie.hire_date,
    drivers: tie.drivers.map((d) => ({
      driver_id: d.driver_id,
      name: d.name,
    })),
  }));

  return {
    summary: {
      new_drivers_count: newDriversFromNonConflict.size,
      new_routes_count: newRoutesFromNonConflict,
      planned_row_count: planned.length,
      conflict_row_count: conflicts.length,
      excluded_row_count: excluded_rows.length,
    },
    excluded_rows,
    conflicts,
    planned,
    requires_resolutions: conflicts.length > 0,
    unresolved_seniority_ties,
  };
}

/**
 * Apply conflict resolutions to a preview and return the rows that will write,
 * plus updated summary counts (including overwrite creates).
 *
 * @param {BulkImportPreview} preview
 * @param {Record<string, 'skip' | 'overwrite'>} resolutions - keyed by row_number string
 */
export function resolveBulkImportPreview(preview, resolutions = {}) {
  /** @type {string[]} */
  const unresolved = [];
  /** @type {BulkImportPlannedRow[]} */
  const accepted = [];
  /** @type {number[]} */
  const skipped = [];

  const conflictByRow = new Map(
    preview.conflicts.map((c) => [c.row_number, c])
  );

  for (const row of preview.planned) {
    const conflict = conflictByRow.get(row.row_number);
    if (!conflict) {
      accepted.push({
        ...row,
        will_create_driver: row.will_create_driver,
        will_create_route: row.will_create_route,
        has_conflict: false,
      });
      continue;
    }

    const resolution = resolutions[String(row.row_number)];
    if (resolution !== 'skip' && resolution !== 'overwrite') {
      unresolved.push(
        `Row ${row.row_number} (${row.route_id}): choose skip or overwrite.`
      );
      continue;
    }
    if (resolution === 'skip') {
      skipped.push(row.row_number);
      continue;
    }
    if (!conflict.overwrite_allowed) {
      unresolved.push(
        conflict.overwrite_blocked_reason ||
          `Row ${row.row_number}: overwrite is not allowed.`
      );
      continue;
    }

    accepted.push({
      ...row,
      will_create_driver: false,
      will_create_route: conflict.conflict_types.includes('existing_route')
        ? false
        : true,
      has_conflict: true,
    });
  }

  if (unresolved.length) {
    const error = new Error(
      `Resolve all conflicts before commit:\n${unresolved.join('\n')}`
    );
    /** @type {any} */
    const err = error;
    err.code = 'UNRESOLVED_CONFLICTS';
    err.unresolved = unresolved;
    throw error;
  }

  /** Drivers newly created across accepted non-overwrite rows (name key). */
  /** @type {Set<string>} */
  const newDriverNames = new Set();
  let newRoutes = 0;
  let overwrittenRoutes = 0;
  let linkedExistingDrivers = 0;

  for (const row of accepted) {
    const conflict = conflictByRow.get(row.row_number);
    if (conflict?.conflict_types.includes('existing_driver')) {
      linkedExistingDrivers += 1;
    } else {
      newDriverNames.add(row.driver_name.toLowerCase());
    }

    if (conflict?.conflict_types.includes('existing_route')) {
      overwrittenRoutes += 1;
    } else {
      newRoutes += 1;
    }
  }

  return {
    accepted,
    skipped_row_numbers: skipped,
    summary: {
      new_drivers_count: newDriverNames.size,
      new_routes_count: newRoutes,
      overwritten_routes_count: overwrittenRoutes,
      linked_existing_drivers_count: linkedExistingDrivers,
      skipped_row_count: skipped.length,
      accepted_row_count: accepted.length,
    },
  };
}

/**
 * Build a STABLE route-state entry for seeding (no open window).
 * @param {{ driver_name: string, driver_id: string | null, segments: Record<'AM'|'MIDDAY'|'PM', string | null>, last_updated?: string }} input
 */
export function buildSeededRouteState(input) {
  const segments = {
    AM: input.segments.AM ?? null,
    MIDDAY: input.segments.MIDDAY ?? null,
    PM: input.segments.PM ?? null,
  };
  return {
    driver_name: input.driver_name,
    driver_id: input.driver_id,
    segments,
    baseline_segments: { ...segments },
    status: /** @type {const} */ ('STABLE'),
    window_opened_date: null,
    window_expires_date: null,
    cumulative_drift_minutes: 0,
    contributing_change_ids: [],
    payroll_rounded_total_minutes: null,
    reconciliation: null,
    pending_change_ids: [],
    review_history: [],
    change_reports: [],
    last_updated: input.last_updated ?? new Date().toISOString(),
  };
}

/**
 * Pure commit plan from accepted rows + current drivers.
 * Does not write — returns drivers to upsert and routes to write.
 *
 * @param {BulkImportPlannedRow[]} accepted
 * @param {import('../data/storage.js').Driver[]} existingDrivers
 * @param {BulkImportConflict[]} conflicts
 */
export function planBulkImportWrites(accepted, existingDrivers, conflicts = []) {
  const conflictByRow = new Map(conflicts.map((c) => [c.row_number, c]));
  /** @type {Map<string, import('../data/storage.js').Driver>} */
  const driversByName = new Map(
    existingDrivers.map((d) => [d.name.toLowerCase(), { ...d }])
  );

  /** @type {import('../data/storage.js').Driver[]} */
  const createdDrivers = [];
  /** @type {import('../data/storage.js').Driver[]} */
  const updatedDrivers = [];
  /** @type {{ route_id: string, entry: ReturnType<typeof buildSeededRouteState>, action: 'create' | 'overwrite' }[]} */
  const routes = [];

  const now = new Date().toISOString();

  for (const row of accepted) {
    const conflict = conflictByRow.get(row.row_number);
    const nameKey = row.driver_name.toLowerCase();
    let driver = driversByName.get(nameKey) ?? null;

    if (!driver) {
      if (!row.hire_date) {
        throw new Error(
          `hire_date is required when creating driver "${row.driver_name}".`
        );
      }
      driver = {
        driver_id: randomUUID(),
        name: row.driver_name,
        email: row.driver_email,
        hire_date: row.hire_date,
        tie_break: null,
      };
      driversByName.set(nameKey, driver);
      createdDrivers.push(driver);
    } else {
      let changed = false;
      let next = driver;
      if (
        conflict?.conflict_types.includes('existing_driver') &&
        row.driver_email &&
        row.driver_email !== driver.email
      ) {
        next = { ...next, email: row.driver_email };
        changed = true;
      }
      if (row.hire_date && row.hire_date !== driver.hire_date) {
        next = { ...next, hire_date: row.hire_date, tie_break: null };
        changed = true;
      }
      if (changed) {
        driver = next;
        driversByName.set(nameKey, driver);
        if (!updatedDrivers.some((d) => d.driver_id === driver.driver_id)) {
          updatedDrivers.push(driver);
        }
      }
    }

    const action =
      conflict?.conflict_types.includes('existing_route') ? 'overwrite' : 'create';

    routes.push({
      route_id: row.route_id,
      action,
      entry: buildSeededRouteState({
        driver_name: driver.name,
        driver_id: driver.driver_id,
        segments: row.segments,
        last_updated: now,
      }),
    });
  }

  return {
    createdDrivers,
    updatedDrivers,
    routes,
    allDrivers: [...driversByName.values()],
  };
}

/**
 * @param {{
 *   createdDrivers: import('../data/storage.js').Driver[],
 *   updatedDrivers: import('../data/storage.js').Driver[],
 *   routes: { route_id: string, action: 'create' | 'overwrite', entry: object }[],
 *   skipped_row_numbers: number[],
 *   entered_by: string,
 *   note: string,
 *   imported_at?: string,
 * }} input
 */
export function buildBulkImportEvent(input) {
  const imported_at = input.imported_at ?? new Date().toISOString();
  return {
    type: /** @type {const} */ ('BULK_IMPORT'),
    imported_at,
    entered_by: input.entered_by,
    note: input.note,
    created_drivers: input.createdDrivers.map((d) => ({
      driver_id: d.driver_id,
      name: d.name,
      email: d.email,
      hire_date: d.hire_date ?? null,
      tie_break: d.tie_break ?? null,
    })),
    updated_drivers: input.updatedDrivers.map((d) => ({
      driver_id: d.driver_id,
      name: d.name,
      email: d.email,
      hire_date: d.hire_date ?? null,
      tie_break: d.tie_break ?? null,
    })),
    created_routes: input.routes
      .filter((r) => r.action === 'create')
      .map((r) => ({
        route_id: r.route_id,
        driver_id: r.entry.driver_id,
        driver_name: r.entry.driver_name,
        segments: r.entry.segments,
      })),
    overwritten_routes: input.routes
      .filter((r) => r.action === 'overwrite')
      .map((r) => ({
        route_id: r.route_id,
        driver_id: r.entry.driver_id,
        driver_name: r.entry.driver_name,
        segments: r.entry.segments,
      })),
    skipped_row_numbers: input.skipped_row_numbers,
  };
}
