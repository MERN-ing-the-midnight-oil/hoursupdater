import { createId } from '../../src/logic/createId.js';
import { isForcedOctober1Contract } from '../../src/logic/contractWindows.js';
import { computeDeltaMinutes, toDateString } from '../../src/logic/timeUtils.js';
import { EMPLOYEE_ROUTE_ID } from '../../employee-tracker/src/snapshot.js';
import { formatSegmentRange } from '../../employee-tracker/src/clockTimes.js';
import { compareRouteNumbers } from '../web/store.js';
import { assignmentsFromDatedDrivers, driverForDate } from './assignments.js';

const HEADERS = ['Route', 'Driver', 'Kind', 'Date', 'Run', 'Clock in', 'Clock out', 'Note'];

const RUNS = {
  am: 'AM',
  midday: 'MIDDAY',
  pm: 'PM',
};

/**
 * @param {unknown} value
 */
function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

/**
 * @param {string} csv
 * @returns {string[][]}
 */
export function parseCsv(csv) {
  const text = String(csv ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else if (char === '\n') {
      cells.push(current);
      if (cells.some((cell) => cell.trim())) {
        rows.push(cells);
      }
      cells = [];
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  if (cells.some((cell) => cell.trim())) {
    rows.push(cells);
  }
  return rows;
}

/**
 * @param {string} run
 */
function normalizeRun(run) {
  const key = String(run ?? '')
    .trim()
    .toLowerCase();
  const segment = RUNS[key];
  if (!segment) {
    throw new Error(`Run must be AM, Midday, or PM (got "${run}").`);
  }
  return segment;
}

/**
 * @param {string} kind
 */
function normalizeKind(kind) {
  const value = String(kind ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  if (value === 'start' || value === 'starting' || value === 'starting times') {
    return 'start';
  }
  if (value === 'change' || value === 'clock time change') {
    return 'change';
  }
  throw new Error(
    'What this row is must be "Starting times" or "Clock-time change".'
  );
}

/**
 * @param {{
 *   version: number,
 *   currentProfileId: string | null,
 *   profiles: Record<string, object>,
 * }} state
 */
/**
 * One row per run, in route order. Kind is "start" or "change".
 * @param {{
 *   profiles?: Record<string, object>,
 * }} state
 */
export function clockRowsFromState(state) {
  const profiles = Object.values(state?.profiles ?? {}).sort((a, b) =>
    compareRouteNumbers(a.name, b.name)
  );
  /** @type {Array<{ route: string, driver: string, kind: string, date: string, run: string, clockIn: string, clockOut: string, note: string }>} */
  const rows = [];
  for (const profile of profiles) {
    const route = String(profile.name ?? '').trim();
    const events = [...(profile.changeLog ?? [])].sort((a, b) => {
      const dateCompare = String(a.effective_date).localeCompare(String(b.effective_date));
      if (dateCompare !== 0) return dateCompare;
      return String(a.submitted_at).localeCompare(String(b.submitted_at));
    });
    for (const event of events) {
      const seed =
        event.delta_minutes === 0 && event.previous_time === event.new_time;
      const [clockIn, clockOut] = String(event.new_time || '').split('-');
      rows.push({
        route,
        driver: driverForDate(profile, event.effective_date),
        kind: seed ? 'start' : 'change',
        date: event.effective_date || '',
        run: event.segment === 'MIDDAY' ? 'Midday' : event.segment || '',
        clockIn: clockIn || '',
        clockOut: clockOut || '',
        note: seed ? '' : event.note || '',
      });
    }
  }
  return rows;
}

/**
 * @param {{
 *   profiles?: Record<string, object>,
 * }} state
 */
export function buildRoutesCsv(state) {
  const lines = [HEADERS.map(csvCell).join(',')];
  for (const row of clockRowsFromState(state)) {
    lines.push(
      [row.route, row.driver, row.kind, row.date, row.run, row.clockIn, row.clockOut, row.note]
        .map(csvCell)
        .join(',')
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * @param {string} csv
 * @param {{ currentRoute?: string | null }} [options]
 */
/**
 * @param {string[]} header
 * @param {string[]} names
 */
function headerIndex(header, names) {
  for (const name of names) {
    const index = header.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

/**
 * @param {string} csv
 * @param {{ currentRoute?: string | null, drivers?: object[] }} [options]
 */
export function stateFromRoutesCsv(csv, options = {}) {
  const table = parseCsv(csv);
  if (!table.length) {
    throw new Error('That CSV is empty.');
  }
  const header = table[0].map((cell) => cell.trim().toLowerCase());
  const columns = {
    route: headerIndex(header, ['route', 'route number']),
    driver: headerIndex(header, ['driver']),
    kind: headerIndex(header, ['kind', 'what this row is']),
    date: headerIndex(header, ['date']),
    run: headerIndex(header, ['run']),
    clockIn: headerIndex(header, ['clock in']),
    clockOut: headerIndex(header, ['clock out']),
    note: headerIndex(header, ['note']),
  };
  const missing = Object.entries(columns)
    .filter(([name, index]) => name !== 'note' && index < 0)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(
      'That file is not a Teamster Time Changes Dashboard backup. It needs columns: Route, Driver, Kind, Date, Run, Clock in, Clock out, Note.'
    );
  }
  const cell = (cells, index) => (index < 0 ? '' : String(cells[index] ?? '').trim());
  return stateFromClockRows(
    table.slice(1).map((cells, rowOffset) => ({
      line: rowOffset + 2,
      route: cell(cells, columns.route),
      driver: cell(cells, columns.driver),
      kind: cell(cells, columns.kind),
      date: cell(cells, columns.date),
      run: cell(cells, columns.run),
      clockIn: cell(cells, columns.clockIn),
      clockOut: cell(cells, columns.clockOut),
      note: cell(cells, columns.note),
    })),
    options
  );
}

/**
 * @param {Array<{
 *   line?: number,
 *   route?: string,
 *   driver?: string,
 *   kind?: string,
 *   date?: string,
 *   run?: string,
 *   clockIn?: string,
 *   clockOut?: string,
 *   note?: string,
 * }>} rawRows
 * @param {{ currentRoute?: string | null, drivers?: object[] }} [options]
 */
export function stateFromClockRows(rawRows, options = {}) {
  /** @type {Map<string, { route: string, driver: string, rows: object[] }>} */
  const groups = new Map();

  rawRows.forEach((raw, rowOffset) => {
    const line = raw.line ?? rowOffset + 2;
    const route = String(raw.route ?? '').trim();
    if (!route) {
      throw new Error(`Row ${line} is missing a route number.`);
    }
    const key = route.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { route, driver: '', rows: [] });
    }
    const group = groups.get(key);
    const driver = String(raw.driver ?? '').trim();
    if (driver) group.driver = driver;
    let kind;
    let segment;
    let date;
    try {
      kind = normalizeKind(raw.kind);
      segment = normalizeRun(raw.run);
      const rawDate = String(raw.date ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        throw new Error(`Date must be YYYY-MM-DD (got "${rawDate}").`);
      }
      date = toDateString(rawDate);
    } catch (error) {
      throw new Error(`Row ${line}: ${error.message}`);
    }
    const clockIn = String(raw.clockIn ?? '').trim();
    const clockOut = String(raw.clockOut ?? '').trim();
    if (!clockIn || !clockOut) {
      throw new Error(`Row ${line} needs both a clock-in and a clock-out.`);
    }
    let range;
    try {
      range = formatSegmentRange(clockIn, clockOut);
    } catch (error) {
      throw new Error(`Row ${line}: ${error.message}`);
    }
    group.rows.push({
      kind,
      segment,
      date,
      range,
      note: String(raw.note ?? '').trim(),
      forceOct1: isForcedOctober1Contract(raw.forceOct1),
      driver,
      order: rowOffset,
    });
  });

  if (!groups.size) {
    throw new Error('That file has no routes.');
  }

  /** @type {Record<string, object>} */
  const profiles = {};
  for (const group of groups.values()) {
    const starts = group.rows.filter((row) => row.kind === 'start');
    const changes = group.rows
      .filter((row) => row.kind === 'change')
      .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
    if (!starts.length) {
      throw new Error(`Route ${group.route} needs at least one Starting times row.`);
    }
    /** @type {Record<string, { date: string, range: string, order: number }>} */
    const startBySegment = {};
    for (const row of starts) {
      startBySegment[row.segment] = row;
    }
    const assignments = assignmentsFromDatedDrivers(group.rows);
    const currentDriver =
      [...assignments].reverse().find((item) => !item.until)?.driver_name ||
      assignments.at(-1)?.driver_name ||
      group.driver;
    const startDate = starts
      .map((row) => row.date)
      .sort()[0];
    /** @type {Record<string, string>} */
    const current = {};
    const submittedBase = `${startDate}T12:00:00.000Z`;
    const seeds = Object.entries(startBySegment)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([segment, row], index) => {
        current[segment] = row.range;
        return {
          id: createId(),
          route_id: EMPLOYEE_ROUTE_ID,
          driver_name: group.driver || group.route,
          driver_id: null,
          segment,
          submitted_at: new Date(new Date(submittedBase).getTime() + index).toISOString(),
          effective_date: row.date || startDate,
          previous_time: row.range,
          new_time: row.range,
          computed_delta_minutes: 0,
          delta_minutes: 0,
          routing_adjustment: null,
          reason_category: 'OTHER',
          note: 'Starting schedule',
          entered_by: group.driver || group.route,
        };
      });

    const changeLog = [...seeds];
    changes.forEach((row, index) => {
      const previous = current[row.segment];
      if (!previous) {
        throw new Error(
          `Route ${group.route} has a ${row.segment} change without starting times for that run.`
        );
      }
      const delta = computeDeltaMinutes(previous, row.range);
      if (delta === 0) {
        throw new Error(
          `Route ${group.route} ${row.segment} change on ${row.date} matches the previous times.`
        );
      }
      current[row.segment] = row.range;
      changeLog.push({
        id: createId(),
        route_id: EMPLOYEE_ROUTE_ID,
        driver_name: group.driver || group.route,
        driver_id: null,
        segment: row.segment,
        submitted_at: new Date(
          new Date(`${row.date}T15:00:00.000Z`).getTime() + index
        ).toISOString(),
        effective_date: row.date,
        previous_time: previous,
        new_time: row.range,
        computed_delta_minutes: delta,
        delta_minutes: delta,
        routing_adjustment: null,
        reason_category: 'OTHER',
        note: row.note,
        entered_by: group.driver || group.route,
        force_oct1_contract: Boolean(row.forceOct1),
      });
    });

    const id = createId();
    profiles[id] = {
      id,
      name: group.route,
      driver_name: currentDriver,
      start_date: startDate,
      setup_at: submittedBase,
      created_at: submittedBase,
      changeLog,
      assignments,
    };
  }

  const ordered = Object.values(profiles).sort((a, b) =>
    compareRouteNumbers(a.name, b.name)
  );
  const wanted = String(options.currentRoute ?? '').trim().toLowerCase();
  const current =
    ordered.find((profile) => String(profile.name).toLowerCase() === wanted) ??
    ordered[0];
  /** @type {{ version: number, currentProfileId: string | null, profiles: Record<string, object>, drivers?: object[] }} */
  const state = {
    version: 1,
    currentProfileId: current?.id ?? null,
    profiles,
  };
  if (Array.isArray(options.drivers)) {
    state.drivers = options.drivers;
  }
  return state;
}
