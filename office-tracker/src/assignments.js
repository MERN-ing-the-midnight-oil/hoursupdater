import { EMPLOYEE_ROUTE_ID } from '../../employee-tracker/src/snapshot.js';

/**
 * @param {unknown} value
 */
export function sameDriver(a, b) {
  const left = String(a ?? '').trim().toLowerCase();
  const right = String(b ?? '').trim().toLowerCase();
  return Boolean(left) && left === right;
}

/**
 * @param {string} iso
 */
export function dayBefore(iso) {
  const [year, month, day] = String(iso).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1));
  return date.toISOString().slice(0, 10);
}

/**
 * The drivers who have held a route, in order. A route with no recorded
 * assignments is treated as held by its current driver since the start.
 * @param {object | null | undefined} profile
 * @returns {Array<{ driver_name: string, from: string, until: string | null }>}
 */
export function routeAssignments(profile) {
  if (Array.isArray(profile?.assignments) && profile.assignments.length) {
    return profile.assignments
      .filter((item) => String(item?.driver_name ?? '').trim() && item.from)
      .map((item) => ({
        driver_name: String(item.driver_name).trim(),
        from: String(item.from),
        until: item.until ? String(item.until) : null,
      }))
      .sort((a, b) => a.from.localeCompare(b.from));
  }
  const name = String(profile?.driver_name ?? '').trim();
  const from = String(profile?.start_date ?? '').trim();
  if (!name || !from) return [];
  return [{ driver_name: name, from, until: null }];
}

/**
 * @param {object | null | undefined} profile
 * @param {string} driverName
 */
export function driverOwnsRoute(profile, driverName) {
  return routeAssignments(profile).some((item) => sameDriver(item.driver_name, driverName));
}

/**
 * @param {object} profile
 * @param {string} date
 */
export function driverForDate(profile, date) {
  const iso = String(date || '');
  const match = [...routeAssignments(profile)]
    .reverse()
    .find((item) => item.from <= iso && (!item.until || iso < item.until));
  return match?.driver_name || String(profile?.driver_name ?? '').trim();
}

/**
 * Record that `nextName` takes the route on `asOf`. The previous driver's
 * stint ends that day, so their history stays attached to them.
 * @param {object} profile
 * @param {string} nextName
 * @param {string} asOf
 */
export function assignRouteDriver(profile, nextName, asOf) {
  const next = String(nextName ?? '').trim();
  const current = String(profile.driver_name ?? '').trim();
  const date = asOf || profile.start_date;
  if (sameDriver(next, current)) {
    if (next && !Array.isArray(profile.assignments)) {
      profile.assignments = routeAssignments(profile);
    }
    return profile;
  }
  if (!current && next) {
    profile.driver_name = next;
    profile.assignments = [
      { driver_name: next, from: profile.start_date || date, until: null },
    ];
    return profile;
  }
  const assignments = routeAssignments(profile).map((item) => ({ ...item }));
  const open = [...assignments]
    .reverse()
    .find((item) => !item.until && sameDriver(item.driver_name, current));
  if (open) {
    if (date > open.from) open.until = date;
    else open.driver_name = next || open.driver_name;
  } else if (current && date) {
    assignments.push({
      driver_name: current,
      from: profile.start_date || date,
      until: date > (profile.start_date || date) ? date : null,
    });
  }
  if (next && !assignments.some((item) => sameDriver(item.driver_name, next) && !item.until)) {
    assignments.push({ driver_name: next, from: date || profile.start_date, until: null });
  }
  profile.driver_name = next;
  profile.assignments = assignments.filter((item) => item.until !== item.from);
  return profile;
}

/**
 * @param {object} profile
 * @param {string} previousName
 * @param {string} nextName
 */
export function renameDriverOnRoute(profile, previousName, nextName) {
  const next = String(nextName ?? '').trim();
  if (!next || sameDriver(previousName, next)) return profile;
  if (sameDriver(profile.driver_name, previousName)) profile.driver_name = next;
  if (Array.isArray(profile.assignments)) {
    for (const item of profile.assignments) {
      if (sameDriver(item.driver_name, previousName)) item.driver_name = next;
    }
  }
  return profile;
}

/**
 * Build assignments from dated driver names, earliest first.
 * @param {Array<{ driver?: string, date?: string, order?: number }>} rows
 */
export function assignmentsFromDatedDrivers(rows) {
  const sorted = [...rows]
    .filter((row) => String(row?.driver ?? '').trim() && row?.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.order ?? 0) - (b.order ?? 0));
  /** @type {Array<{ driver_name: string, from: string, until: string | null }>} */
  const assignments = [];
  for (const row of sorted) {
    const driver = String(row.driver).trim();
    const last = assignments.at(-1);
    if (!last) {
      assignments.push({ driver_name: driver, from: row.date, until: null });
    } else if (!sameDriver(last.driver_name, driver)) {
      if (row.date > last.from) {
        last.until = row.date;
        assignments.push({ driver_name: driver, from: row.date, until: null });
      } else {
        last.driver_name = driver;
      }
    }
  }
  return assignments;
}

/**
 * @param {object} event
 */
function isSeed(event) {
  return event?.delta_minutes === 0 && event?.previous_time === event?.new_time;
}

/**
 * @param {object[]} changeLog
 */
function orderedLog(changeLog) {
  return [...(changeLog ?? [])].sort((a, b) => {
    const byDate = String(a.effective_date).localeCompare(String(b.effective_date));
    if (byDate !== 0) return byDate;
    return String(a.submitted_at).localeCompare(String(b.submitted_at));
  });
}

/**
 * @param {object[]} changeLog
 * @param {string} date
 */
function scheduleBefore(changeLog, date) {
  /** @type {Record<string, string | null>} */
  const running = { AM: null, MIDDAY: null, PM: null };
  for (const event of orderedLog(changeLog)) {
    if (String(event.effective_date) >= date) break;
    if (event.segment) running[event.segment] = event.new_time;
  }
  return running;
}

/**
 * @param {string} date
 * @param {{ from: string, until: string | null }} stint
 */
function inStint(date, stint) {
  return date >= stint.from && (!stint.until || date < stint.until);
}

/**
 * One slice per stint this driver held on the route. Later drivers' changes
 * are left out, and an earlier driver's changes are not inherited as notes.
 * @param {object} profile
 * @param {string} driverName
 */
export function slicesForDriver(profile, driverName) {
  const stints = routeAssignments(profile).filter((item) =>
    sameDriver(item.driver_name, driverName)
  );
  /** @type {Array<{ profile: object, assignment: { from: string, until: string | null, routeStarted: string } }>} */
  const slices = [];
  const log = orderedLog(profile?.changeLog);
  for (const stint of stints) {
    if (stint.until && stint.until <= stint.from) continue;
    const routeStarted = String(profile.start_date || stint.from);
    const startedHere = stint.from <= routeStarted;
    const during = log.filter((event) => inStint(String(event.effective_date), stint));
    let changeLog;
    let startDate;
    if (startedHere) {
      changeLog = during;
      startDate = routeStarted;
    } else {
      const inherited = scheduleBefore(log, stint.from);
      const seeds = ['AM', 'MIDDAY', 'PM']
        .filter((segment) => inherited[segment])
        .map((segment, index) => ({
          id: `${profile.id || 'route'}-${stint.from}-start-${segment.toLowerCase()}`,
          route_id: EMPLOYEE_ROUTE_ID,
          driver_name: stint.driver_name,
          driver_id: null,
          segment,
          submitted_at: `${stint.from}T12:00:00.${String(index).padStart(3, '0')}Z`,
          effective_date: stint.from,
          previous_time: inherited[segment],
          new_time: inherited[segment],
          computed_delta_minutes: 0,
          delta_minutes: 0,
          routing_adjustment: null,
          reason_category: 'OTHER',
          note: 'Starting schedule',
          entered_by: stint.driver_name,
        }));
      changeLog = [...seeds, ...during.filter((event) => !isSeed(event))];
      startDate = stint.from;
    }
    if (!changeLog.length) continue;
    slices.push({
      profile: {
        ...profile,
        driver_name: stint.driver_name,
        start_date: startDate,
        changeLog,
        assignments: [{ ...stint }],
      },
      assignment: {
        from: stint.from,
        until: stint.until,
        routeStarted,
      },
    });
  }
  return slices;
}
