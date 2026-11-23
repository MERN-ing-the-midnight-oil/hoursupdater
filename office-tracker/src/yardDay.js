import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pacificStamp } from './driverHabits.js';
import { assetPathXml, currentBusLocations, pacificMorningEpoch } from './zonarBoard.js';
import { fleetKey, transitionsFromPathXml, yardCenter } from './yardTransitions.js';

const cachePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/yard-transitions.json');
const FRESH_MS = 10 * 60 * 1000;
let cacheWrite = Promise.resolve();

function dayWindow(iso) {
  const [year, month, day] = String(iso).split('-').map(Number);
  const start = pacificMorningEpoch(new Date(Date.UTC(year, month - 1, day, 20, 0, 0)), 4);
  return { start, end: start + 16 * 3600 };
}

async function readCache() {
  try {
    const parsed = JSON.parse(await readFile(cachePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { center: null, fleets: {} };
    return {
      center: parsed.center || null,
      fleets: parsed.fleets && typeof parsed.fleets === 'object' ? parsed.fleets : {},
    };
  } catch {
    return { center: null, fleets: {} };
  }
}

async function writeCache(cache) {
  cacheWrite = cacheWrite.then(async () => {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(cache));
  });
  await cacheWrite;
}

async function mapPool(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(runners);
}

function fresh(entry, date, today) {
  if (!entry || !Array.isArray(entry.events)) return false;
  if (date < today) return true;
  return Date.now() - Number(entry.savedAt) < FRESH_MS;
}

// Yard leave and return minutes for the named buses on one Pacific date.
// Coordinates stay on the server. A finished day is kept. Today is reread after ten minutes.
export async function yardEventsForDate(date, fleets) {
  const iso = String(date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error('Choose a date.');
  const wanted = [...new Set((fleets || []).map(fleetKey).filter(Boolean))];
  if (!wanted.length) return { date: iso, events: [], cached: true };
  const today = pacificStamp(new Date())?.date || '';
  const cache = await readCache();
  const events = [];
  const missing = [];
  for (const fleet of wanted) {
    const hit = cache.fleets[`${iso}|${fleet}`];
    if (!fresh(hit, iso, today)) {
      missing.push(fleet);
      continue;
    }
    for (const event of hit.events) {
      if (event?.kind !== 'leave' && event?.kind !== 'return') continue;
      events.push({ bus: fleet, date: iso, at: Number(event.at), kind: event.kind });
    }
  }
  if (!missing.length) return { date: iso, events, cached: true };
  const locations = await currentBusLocations();
  const center = yardCenter(locations) || cache.center;
  if (!center) throw new Error('No bus is in the Transportation yard, so yard times cannot be read yet.');
  cache.center = { lat: center.lat, lon: center.lon };
  const ids = new Map(locations.map((bus) => [fleetKey(bus.fleet), bus.id]));
  const { start, end } = dayWindow(iso);
  await mapPool(missing, 8, async (fleet) => {
    const id = ids.get(fleet);
    if (!id) {
      cache.fleets[`${iso}|${fleet}`] = { savedAt: Date.now(), events: [] };
      return;
    }
    try {
      const xml = await assetPathXml(id, null, start, end);
      const transitions = transitionsFromPathXml(xml, center);
      cache.fleets[`${iso}|${fleet}`] = { savedAt: Date.now(), events: transitions };
      for (const event of transitions) events.push({ bus: fleet, date: iso, at: event.at, kind: event.kind });
    } catch {
      // Leave this bus uncached so the next open can try again.
    }
  });
  await writeCache(cache);
  return { date: iso, events, cached: false };
}
