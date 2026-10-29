import fs from 'node:fs/promises';
import path from 'node:path';
import { driverForDate } from '../../office-tracker/src/assignments.js';
import { driversFromState } from '../../office-tracker/web/store.js';
import {
  driversWithSeniorityNumbers,
  normalizeSeniorityNumber,
} from './seniority.js';

export { driversWithSeniorityNumbers, normalizeSeniorityNumber };

const SEGMENTS = ['AM', 'MIDDAY', 'PM'];

/**
 * Clock times in effect on `asOf`, from the route change log.
 * @param {Array<{ effective_date?: string, submitted_at?: string, segment?: string, new_time?: string }> | null | undefined} changeLog
 * @param {string} asOf
 * @returns {{ AM: string | null, MIDDAY: string | null, PM: string | null }}
 */
export function currentSegments(changeLog, asOf) {
  const running = { AM: null, MIDDAY: null, PM: null };
  const events = [...(changeLog || [])].sort((a, b) => {
    const byDate = String(a?.effective_date || '').localeCompare(String(b?.effective_date || ''));
    if (byDate !== 0) return byDate;
    return String(a?.submitted_at || '').localeCompare(String(b?.submitted_at || ''));
  });
  for (const event of events) {
    if (String(event?.effective_date || '') > asOf) break;
    if (!SEGMENTS.includes(event?.segment)) continue;
    const time = String(event?.new_time || '').trim();
    running[event.segment] = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(time) ? time : null;
  }
  return running;
}

/**
 * Drivers and the routes they hold on `asOf`, from the shared office record.
 * @param {object} state
 * @param {string} asOf
 */
export function rosterFromOfficeState(state, asOf) {
  const people = driversFromState(state || {});
  const drivers = [];
  const seen = new Set();
  for (const person of people) {
    const driver_id = String(person?.id || '').trim();
    const name = String(person?.name || '').trim();
    if (!driver_id || !name || seen.has(driver_id)) continue;
    seen.add(driver_id);
    const email = String(person?.email || '').trim();
    drivers.push({
      driver_id,
      name,
      email: email || null,
      hire_date: null,
      tie_break: null,
    });
  }
  const idByName = new Map(drivers.map((driver) => [driver.name.toLowerCase(), driver.driver_id]));
  const schedules = [];
  const routeNotes = {};
  for (const profile of Object.values(state?.profiles || {})) {
    const routeId = String(profile?.name || '').trim();
    if (!routeId) continue;
    const note = String(profile?.note || '').trim();
    if (note) routeNotes[routeId] = note;
    const driverId = idByName.get(String(driverForDate(profile, asOf) || '').trim().toLowerCase());
    if (!driverId) continue;
    const segments = currentSegments(profile?.changeLog, asOf);
    if (!segments.AM && !segments.MIDDAY && !segments.PM) continue;
    schedules.push({ route_id: routeId, driver_id: driverId, segments });
  }
  schedules.sort((a, b) =>
    a.route_id.localeCompare(b.route_id, undefined, { numeric: true, sensitivity: 'base' })
  );
  return { as_of: asOf, drivers, schedules, route_notes: routeNotes };
}

/**
 * @param {unknown} raw
 * @returns {{ drivers: object[], schedules: object[], routeNotes: Record<string, string> } | null}
 */
export function normalizeOfficeRoster(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (raw);
  const drivers = [];
  const seen = new Set();
  for (const row of Array.isArray(record.drivers) ? record.drivers : []) {
    const item = row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {};
    const driver_id = String(item.driver_id || '').trim();
    const name = String(item.name || '').trim();
    if (!driver_id || !name || seen.has(driver_id)) continue;
    seen.add(driver_id);
    const email = String(item.email || '').trim();
    drivers.push({
      driver_id,
      name,
      email: email || null,
      hire_date: null,
      tie_break: null,
      seniority_number: normalizeSeniorityNumber(item.seniority_number),
    });
  }
  if (!drivers.length) return null;
  const schedules = [];
  for (const row of Array.isArray(record.schedules) ? record.schedules : []) {
    const item = row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {};
    const route_id = String(item.route_id || '').trim();
    const driver_id = String(item.driver_id || '').trim();
    if (!route_id || !driver_id || !seen.has(driver_id)) continue;
    const source = item.segments && typeof item.segments === 'object' ? item.segments : {};
    const segments = currentSegments(
      SEGMENTS.filter((segment) => source[segment]).map((segment, index) => ({
        segment,
        new_time: source[segment],
        effective_date: '1970-01-01',
        submitted_at: String(index),
      })),
      '9999-12-31'
    );
    if (!segments.AM && !segments.MIDDAY && !segments.PM) continue;
    schedules.push({ route_id, driver_id, segments });
  }
  const routeNotes = {};
  const notes = record.route_notes && typeof record.route_notes === 'object' ? record.route_notes : {};
  for (const [routeId, note] of Object.entries(notes)) {
    const name = String(routeId || '').trim();
    const text = String(note || '').trim();
    if (name && text) routeNotes[name] = text;
  }
  return { drivers, schedules, routeNotes };
}

/**
 * @param {string} dataDir
 */
export async function readOfficeRoster(dataDir) {
  try {
    const raw = await fs.readFile(path.join(dataDir, 'office-roster.json'), 'utf8');
    return normalizeOfficeRoster(JSON.parse(raw));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}
