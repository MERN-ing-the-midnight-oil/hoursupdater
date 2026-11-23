// A bus is in the yard when it stays near the buses Zonar currently places in
// the Transportation zone. Path history has coordinates, not zone names, so a
// short visit to the edge of that circle does not count as a leave or a return.

export const YARD_RADIUS_METERS = 150;
export const YARD_HOLD_MINUTES = 3;

export function fleetKey(value) {
  return String(value ?? '').trim().replace(/^0+(?=\d)/, '');
}

export function metersBetween(from, to) {
  const lat = ((Number(from?.lat) + Number(to?.lat)) / 2) * (Math.PI / 180);
  const north = (Number(to?.lat) - Number(from?.lat)) * 111320;
  const east = (Number(to?.lon) - Number(from?.lon)) * 111320 * Math.cos(lat);
  return Math.hypot(north, east);
}

// The middle of the buses sitting in Transportation right now.
export function yardCenter(buses) {
  const parked = (buses || []).filter(
    (bus) =>
      String(bus?.zone || '').trim().toLowerCase() === 'transportation' &&
      Number.isFinite(Number(bus?.lat)) &&
      Number.isFinite(Number(bus?.lon))
  );
  if (!parked.length) return null;
  return {
    lat: parked.reduce((sum, bus) => sum + Number(bus.lat), 0) / parked.length,
    lon: parked.reduce((sum, bus) => sum + Number(bus.lon), 0) / parked.length,
  };
}

function clockMinutes(time) {
  const clock = String(time || '').match(/(\d{2}):(\d{2})/);
  if (!clock) return null;
  return Number(clock[1]) * 60 + Number(clock[2]);
}

// points are { at, inside } in time order. `at` is minutes from midnight.
// A crossing counts only after the bus has stayed on the new side for holdMinutes.
export function transitionsFromPoints(points, holdMinutes = YARD_HOLD_MINUTES) {
  const rows = (points || [])
    .filter((point) => Number.isFinite(Number(point?.at)) && typeof point?.inside === 'boolean')
    .map((point) => ({ at: Number(point.at), inside: point.inside }))
    .sort((a, b) => a.at - b.at);
  if (!rows.length) return [];
  const hold = Number(holdMinutes);
  const changes = [];
  let state = rows[0].inside;
  let pending = null;
  for (const point of rows) {
    if (point.inside === state) {
      pending = null;
      continue;
    }
    if (!pending || pending.inside !== point.inside) pending = { inside: point.inside, at: point.at };
    if (point.at - pending.at >= hold) {
      state = point.inside;
      changes.push({ at: pending.at, kind: state ? 'return' : 'leave' });
      pending = null;
    }
  }
  return changes;
}

export function transitionsFromPathXml(xml, center, radius = YARD_RADIUS_METERS, holdMinutes = YARD_HOLD_MINUTES) {
  if (!center || !Number.isFinite(Number(center.lat)) || !Number.isFinite(Number(center.lon))) return [];
  const points = [];
  for (const match of String(xml || '').matchAll(/<event\b([^>]*)\/>/g)) {
    const tag = match[1];
    const at = clockMinutes((tag.match(/\btime="([^"]*)"/) || [])[1]);
    const lat = Number((tag.match(/\blat="([^"]*)"/) || [])[1]);
    const lon = Number((tag.match(/\blong="([^"]*)"/) || [])[1]);
    if (at == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    points.push({
      at,
      inside: metersBetween(center, { lat, lon }) <= radius,
    });
  }
  return transitionsFromPoints(points, holdMinutes);
}
