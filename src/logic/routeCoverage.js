import { normalizePunchRun } from './timesheets.js';
import { localClockParts } from './lateClockFlash.js';

export const COVERAGE_RUNS = ['AM', 'MIDDAY', 'PM'];

function trimName(value) {
  return String(value ?? '').trim();
}

function nameKey(value) {
  return trimName(value).toLowerCase();
}

export function normalizeCoverageRun(raw) {
  const run = normalizePunchRun(raw);
  return COVERAGE_RUNS.includes(run) ? run : '';
}

export function coverageRunLabel(run) {
  if (run === 'AM') return 'AM';
  if (run === 'MIDDAY') return 'Midday';
  if (run === 'PM') return 'PM';
  return '';
}

export function normalizeRouteCoverage(raw) {
  if (!Array.isArray(raw)) return [];
  const rows = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = trimName(item.id);
    const date = trimName(item.date);
    const route_id = trimName(item.route_id);
    const route_name = trimName(item.route_name);
    const run = normalizeCoverageRun(item.run);
    const substitute_id = trimName(item.substitute_id);
    const substitute_name = trimName(item.substitute_name);
    const regular_driver_name = trimName(item.regular_driver_name);
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !route_id || !route_name || !run) continue;
    if (!substitute_id || !substitute_name || substitute_name.length > 80) continue;
    const key = `${date}|${route_id}|${run}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = {
      id,
      date,
      route_id,
      route_name,
      run,
      substitute_id,
      substitute_name,
      regular_driver_name,
    };
    const certified = trimName(item.certified_at);
    if (certified) row.certified_at = certified;
    rows.push(row);
  }
  return rows.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate) return byDate;
    const byRoute = a.route_name.localeCompare(b.route_name, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    if (byRoute) return byRoute;
    return COVERAGE_RUNS.indexOf(a.run) - COVERAGE_RUNS.indexOf(b.run);
  });
}

export function coverageForDate(list, date) {
  const day = trimName(date);
  return normalizeRouteCoverage(list).filter((row) => row.date === day);
}

export function coverageForRouteRun(list, date, routeId, run) {
  const wantedRun = normalizeCoverageRun(run);
  const route = trimName(routeId);
  return (
    coverageForDate(list, date).find(
      (row) => row.route_id === route && row.run === wantedRun
    ) || null
  );
}

export function coverageForSubstitute(list, date, substituteName) {
  const wanted = nameKey(substituteName);
  if (!wanted) return [];
  return coverageForDate(list, date).filter((row) => nameKey(row.substitute_name) === wanted);
}

export function routesCoveredBySubstitute(list, date, substituteName) {
  const rows = coverageForSubstitute(list, date, substituteName);
  const byRoute = new Map();
  for (const row of rows) {
    const current = byRoute.get(row.route_id) || {
      route_id: row.route_id,
      route_name: row.route_name,
      regular_driver_name: row.regular_driver_name,
      runs: [],
      certified: true,
    };
    current.runs.push(row.run);
    if (!row.certified_at) current.certified = false;
    if (!current.regular_driver_name && row.regular_driver_name) {
      current.regular_driver_name = row.regular_driver_name;
    }
    byRoute.set(row.route_id, current);
  }
  return [...byRoute.values()].map((item) => ({
    ...item,
    runs: COVERAGE_RUNS.filter((run) => item.runs.includes(run)),
  }));
}

// One substitute covers one route per day. Assigning them elsewhere clears the old route.
export function assignRouteCoverage(list, input = {}) {
  const date = trimName(input.date);
  const route_id = trimName(input.route_id);
  const route_name = trimName(input.route_name);
  const run = normalizeCoverageRun(input.run);
  const substitute_id = trimName(input.substitute_id);
  const substitute_name = trimName(input.substitute_name).replace(/\s+/g, ' ');
  const regular_driver_name = trimName(input.regular_driver_name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a coverage date.');
  if (!route_id || !route_name) throw new Error('Choose a route.');
  if (!run) throw new Error('Choose AM, Midday, or PM.');
  if (!substitute_id || !substitute_name) throw new Error('Choose a substitute driver.');
  if (substitute_name.length > 80) throw new Error('That substitute name is too long.');

  const next = normalizeRouteCoverage(list).filter((row) => {
    if (row.date !== date) return true;
    if (row.route_id === route_id && row.run === run) return false;
    if (nameKey(row.substitute_name) === nameKey(substitute_name) && row.route_id !== route_id) {
      return false;
    }
    return true;
  });

  next.push({
    id: trimName(input.id) || `coverage-${date}-${route_id}-${run}`,
    date,
    route_id,
    route_name,
    run,
    substitute_id,
    substitute_name,
    regular_driver_name,
  });
  return normalizeRouteCoverage(next);
}

export function clearRouteCoverage(list, { date, route_id, run } = {}) {
  const day = trimName(date);
  const route = trimName(route_id);
  const wantedRun = normalizeCoverageRun(run);
  return normalizeRouteCoverage(list).filter((row) => {
    if (row.date !== day) return true;
    if (row.route_id !== route) return true;
    if (wantedRun && row.run !== wantedRun) return true;
    return false;
  });
}

export function certifyRouteCoverage(list, { date, substitute_name, route_id } = {}, at = new Date()) {
  const day = trimName(date);
  const sub = nameKey(substitute_name);
  const route = trimName(route_id);
  if (!day || !sub || !route) throw new Error('Choose the route to certify.');
  const when = at instanceof Date && !Number.isNaN(at.getTime()) ? at.toISOString() : new Date().toISOString();
  let found = false;
  const next = normalizeRouteCoverage(list).map((row) => {
    if (row.date !== day || row.route_id !== route || nameKey(row.substitute_name) !== sub) {
      return row;
    }
    found = true;
    return { ...row, certified_at: when };
  });
  if (!found) throw new Error('That substitute is not assigned to that route today.');
  return next;
}

// Latest open covering punch for this substitute today, if any.
export function activeCoverForSubstitute(punches, substituteName, now = new Date()) {
  const wanted = nameKey(substituteName);
  if (!wanted || !(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const day = localClockParts(now).date;
  const latestByDriver = new Map();
  for (const punch of Array.isArray(punches) ? punches : []) {
    if (punch?.removed === true) continue;
    if (nameKey(punch?.substitute_name) !== wanted) continue;
    const when = new Date(punch.punched_at || '');
    if (Number.isNaN(when.getTime())) continue;
    if (localClockParts(when).date !== day) continue;
    const driver = trimName(punch.driver_name);
    if (!driver) continue;
    const prev = latestByDriver.get(nameKey(driver));
    if (!prev || String(punch.punched_at) > String(prev.punched_at)) {
      latestByDriver.set(nameKey(driver), punch);
    }
  }
  for (const punch of latestByDriver.values()) {
    if (punch.action === 'in') {
      return {
        driver_name: trimName(punch.driver_name),
        run: normalizeCoverageRun(punch.run) || normalizePunchRun(punch.run) || '',
        punched_at: punch.punched_at,
      };
    }
  }
  return null;
}

export function isRegularAbsentToday(regularDriverName, coverageRows) {
  const wanted = nameKey(regularDriverName);
  if (!wanted) return false;
  return (Array.isArray(coverageRows) ? coverageRows : []).some(
    (row) => nameKey(row.regular_driver_name) === wanted
  );
}

export function coverageClockStatus(row, punches, now = new Date()) {
  if (!row) return 'assigned';
  if (row.certified_at) {
    const day = localClockParts(now).date;
    const driver = nameKey(row.regular_driver_name);
    const sub = nameKey(row.substitute_name);
    let latest = null;
    for (const punch of Array.isArray(punches) ? punches : []) {
      if (punch?.removed === true) continue;
      if (nameKey(punch?.driver_name) !== driver) continue;
      if (normalizeCoverageRun(punch.run) !== row.run) continue;
      const when = new Date(punch.punched_at || '');
      if (Number.isNaN(when.getTime()) || localClockParts(when).date !== day) continue;
      if (!latest || String(punch.punched_at) > String(latest.punched_at)) latest = punch;
    }
    if (latest?.action === 'in' && (!sub || nameKey(latest.substitute_name) === sub || !latest.substitute_name)) {
      return 'clocked_in';
    }
    return 'certified';
  }
  return 'assigned';
}

export function buildCoverageBoard({
  routes = [],
  coverage = [],
  punches = [],
  date,
  now = new Date(),
} = {}) {
  const day = trimName(date) || localClockParts(now).date;
  const rows = coverageForDate(coverage, day);
  const byKey = new Map(rows.map((row) => [`${row.route_id}|${row.run}`, row]));
  const pills = [];
  for (const route of Array.isArray(routes) ? routes : []) {
    const route_id = trimName(route.id || route.route_id);
    const route_name = trimName(route.name || route.route_name);
    if (!route_id || !route_name) continue;
    const regular_driver_name = trimName(route.regular_driver_name || route.driver_name);
    const runs = Array.isArray(route.clockRuns) && route.clockRuns.length
      ? route.clockRuns.map(normalizeCoverageRun).filter(Boolean)
      : COVERAGE_RUNS.filter((run) => {
          const clocks = route.clockInsByRun || route.clocks || {};
          return Boolean(clocks[run]);
        });
    const routeRuns = runs.length ? runs : ['AM', 'PM'];
    for (const run of routeRuns) {
      const assignment = byKey.get(`${route_id}|${run}`) || null;
      const status = assignment
        ? coverageClockStatus(assignment, punches, now)
        : regularClockedIn(regular_driver_name, run, punches, now)
          ? 'regular_in'
          : 'uncovered';
      pills.push({
        route_id,
        route_name,
        run,
        regular_driver_name,
        assignment,
        status,
        kind: assignment ? 'substitute' : 'regular',
        display_name: assignment ? assignment.substitute_name : regular_driver_name || 'Unassigned',
        clocked_in: status === 'clocked_in' || status === 'regular_in',
      });
    }
  }
  return pills.sort((a, b) => {
    const byRoute = a.route_name.localeCompare(b.route_name, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    if (byRoute) return byRoute;
    return COVERAGE_RUNS.indexOf(a.run) - COVERAGE_RUNS.indexOf(b.run);
  });
}

function regularClockedIn(driverName, run, punches, now) {
  const wanted = nameKey(driverName);
  const wantedRun = normalizeCoverageRun(run);
  if (!wanted || !wantedRun) return false;
  const day = localClockParts(now).date;
  let latest = null;
  for (const punch of Array.isArray(punches) ? punches : []) {
    if (punch?.removed === true) continue;
    if (nameKey(punch?.driver_name) !== wanted) continue;
    if (normalizeCoverageRun(punch.run) !== wantedRun) continue;
    if (trimName(punch.substitute_name)) continue;
    const when = new Date(punch.punched_at || '');
    if (Number.isNaN(when.getTime()) || localClockParts(when).date !== day) continue;
    if (!latest || String(punch.punched_at) > String(latest.punched_at)) latest = punch;
  }
  return latest?.action === 'in';
}
