import { createId } from '../../src/logic/createId.js';
import { computeDeltaMinutes, toDateString } from '../../src/logic/timeUtils.js';
import { EMPLOYEE_ROUTE_ID } from '../../employee-tracker/src/snapshot.js';
import { formatSegmentRange } from '../../employee-tracker/src/clockTimes.js';
import { compareRouteNumbers } from '../web/store.js';

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
    .toLowerCase();
  if (value === 'start' || value === 'change') {
    return value;
  }
  throw new Error('Kind must be start or change.');
}

/**
 * @param {{
 *   version: number,
 *   currentProfileId: string | null,
 *   profiles: Record<string, object>,
 * }} state
 */
export function buildRoutesCsv(state) {
  const profiles = Object.values(state?.profiles ?? {}).sort((a, b) =>
    compareRouteNumbers(a.name, b.name)
  );
  const lines = [HEADERS.map(csvCell).join(',')];
  for (const profile of profiles) {
    const route = String(profile.name ?? '').trim();
    const driver = String(profile.driver_name ?? '').trim();
    const events = [...(profile.changeLog ?? [])].sort((a, b) => {
      const dateCompare = String(a.effective_date).localeCompare(String(b.effective_date));
      if (dateCompare !== 0) return dateCompare;
      return String(a.submitted_at).localeCompare(String(b.submitted_at));
    });
    for (const event of events) {
      const seed =
        event.delta_minutes === 0 && event.previous_time === event.new_time;
      const [clockIn, clockOut] = String(event.new_time || '').split('-');
      lines.push(
        [
          route,
          driver,
          seed ? 'start' : 'change',
          event.effective_date || '',
          event.segment === 'MIDDAY' ? 'Midday' : event.segment || '',
          clockIn || '',
          clockOut || '',
          seed ? '' : event.note || '',
        ]
          .map(csvCell)
          .join(',')
      );
    }
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * @param {string} csv
 * @param {{ currentRoute?: string | null }} [options]
 */
export function stateFromRoutesCsv(csv, options = {}) {
  const table = parseCsv(csv);
  if (!table.length) {
    throw new Error('That CSV is empty.');
  }
  const header = table[0].map((cell) => cell.trim().toLowerCase());
  const expected = HEADERS.map((cell) => cell.toLowerCase());
  const missing = expected.filter((name) => !header.includes(name));
  if (missing.length) {
    throw new Error(
      'That file is not a Transportation Timechange Calculator backup. It needs columns: Route, Driver, Kind, Date, Run, Clock in, Clock out, Note.'
    );
  }
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  /** @type {Map<string, { route: string, driver: string, rows: object[] }>} */
  const groups = new Map();

  table.slice(1).forEach((cells, rowOffset) => {
    const line = rowOffset + 2;
    const cell = (name) => String(cells[index[name]] ?? '').trim();
    const route = cell('route');
    if (!route) {
      throw new Error(`Row ${line} is missing a route number.`);
    }
    const key = route.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { route, driver: '', rows: [] });
    }
    const group = groups.get(key);
    const driver = cell('driver');
    if (driver) group.driver = driver;
    let kind;
    let segment;
    let date;
    try {
      kind = normalizeKind(cell('kind'));
      segment = normalizeRun(cell('run'));
      const rawDate = cell('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        throw new Error(`Date must be YYYY-MM-DD (got "${rawDate}").`);
      }
      date = toDateString(rawDate);
    } catch (error) {
      throw new Error(`Row ${line}: ${error.message}`);
    }
    const clockIn = cell('clock in');
    const clockOut = cell('clock out');
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
      note: cell('note'),
      order: rowOffset,
    });
  });

  if (!groups.size) {
    throw new Error('That CSV has no routes.');
  }

  /** @type {Record<string, object>} */
  const profiles = {};
  for (const group of groups.values()) {
    const starts = group.rows.filter((row) => row.kind === 'start');
    const changes = group.rows
      .filter((row) => row.kind === 'change')
      .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
    if (!starts.length) {
      throw new Error(`Route ${group.route} needs at least one start row.`);
    }
    /** @type {Record<string, { date: string, range: string, order: number }>} */
    const startBySegment = {};
    for (const row of starts) {
      startBySegment[row.segment] = row;
    }
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
      });
    });

    const id = createId();
    profiles[id] = {
      id,
      name: group.route,
      driver_name: group.driver,
      start_date: startDate,
      setup_at: submittedBase,
      created_at: submittedBase,
      changeLog,
    };
  }

  const ordered = Object.values(profiles).sort((a, b) =>
    compareRouteNumbers(a.name, b.name)
  );
  const wanted = String(options.currentRoute ?? '').trim().toLowerCase();
  const current =
    ordered.find((profile) => String(profile.name).toLowerCase() === wanted) ??
    ordered[0];
  return {
    version: 1,
    currentProfileId: current?.id ?? null,
    profiles,
  };
}
