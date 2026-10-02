import { isChangeEvent, resolveDriverAssignment } from './stateMachine.js';

/**
 * @param {string} segment
 */
function runLabel(segment) {
  if (segment === 'MIDDAY') return 'Midday';
  if (segment === 'AM' || segment === 'PM') return segment;
  return segment || '';
}

/**
 * @param {string} range
 */
function splitRange(range) {
  const [clockIn, clockOut] = String(range || '').split('-');
  return { clock_in: clockIn || '', clock_out: clockOut || '' };
}

/**
 * Who held the route on the change's effective date.
 * The log stays the source of truth: a change stamps the driver, and a
 * later reassignment overrides from that moment forward.
 *
 * @param {import('./stateMachine.js').LogEntry[]} changeLog
 * @param {import('./stateMachine.js').ChangeEvent} change
 */
export function driverNameOnChange(changeLog, change) {
  const date = String(change.effective_date || '').slice(0, 10);
  const asOf = date ? `${date}T23:59:59.999Z` : change.submitted_at;
  const held = resolveDriverAssignment(changeLog, change.route_id, asOf || '');
  return (held.found && held.driver_name) || change.driver_name || '';
}

/**
 * One row per run, in the Teamster Time Changes Dashboard column layout.
 * @param {import('./stateMachine.js').LogEntry[]} changeLog
 */
export function clockTimeRows(changeLog) {
  const rows = [];
  for (const entry of changeLog) {
    if (!isChangeEvent(entry)) continue;
    const seed =
      entry.delta_minutes === 0 && entry.previous_time === entry.new_time;
    const times = splitRange(entry.new_time);
    rows.push({
      route: entry.route_id,
      driver: driverNameOnChange(changeLog, entry),
      kind: seed ? 'start' : 'change',
      date: entry.effective_date || '',
      run: runLabel(entry.segment),
      clock_in: times.clock_in,
      clock_out: times.clock_out,
      note: seed ? '' : entry.note || '',
      change_id: entry.id,
    });
  }
  rows.sort((a, b) => {
    const route = String(a.route).localeCompare(String(b.route), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    if (route !== 0) return route;
    const date = String(a.date).localeCompare(String(b.date));
    if (date !== 0) return date;
    return String(a.change_id).localeCompare(String(b.change_id));
  });
  return rows;
}

/**
 * Routes currently held by the driver with this email.
 * Email is the person. The log still stores driver_id.
 *
 * @param {Array<{ driver_id: string, name: string, email?: string | null }>} drivers
 * @param {Record<string, { driver_id?: string | null, driver_name?: string | null }>} routeState
 * @param {string} email
 */
export function routeIdsForEmail(drivers, routeState, email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return [];
  const people = drivers.filter(
    (driver) => String(driver.email || '').trim().toLowerCase() === key
  );
  const ids = new Set(people.map((driver) => driver.driver_id));
  const names = new Set(people.map((driver) => driver.name.toLowerCase()));
  return Object.entries(routeState)
    .filter(([, entry]) => {
      if (entry.driver_id && ids.has(entry.driver_id)) return true;
      return names.has(String(entry.driver_name || '').trim().toLowerCase());
    })
    .map(([routeId]) => routeId)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Every route this person holds now or has been stamped on.
 * Email is the person when it is present. The log still stores driver_id.
 *
 * @param {import('./stateMachine.js').LogEntry[]} changeLog
 * @param {Record<string, { driver_id?: string | null, driver_name?: string | null }>} routeState
 * @param {{ driver_id?: string | null, name?: string | null, email?: string | null }} driver
 */
export function routeIdsForDriver(changeLog, routeState, driver) {
  /** @type {Set<string>} */
  const ids = new Set(routeIdsForEmail([driver], routeState, driver.email || ''));
  const name = String(driver.name || '').trim().toLowerCase();
  const driverId = driver.driver_id || '';
  for (const [routeId, entry] of Object.entries(routeState ?? {})) {
    if (driverId && entry.driver_id === driverId) ids.add(routeId);
    if (name && String(entry.driver_name || '').trim().toLowerCase() === name) {
      ids.add(routeId);
    }
  }
  for (const event of changeLog ?? []) {
    const routeId = event.route_id;
    if (!routeId) continue;
    if (driverId && event.driver_id === driverId) ids.add(routeId);
    if (name && String(event.driver_name || '').trim().toLowerCase() === name) {
      ids.add(routeId);
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
