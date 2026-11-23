const OMI_URL = 'https://omi.zonarsystems.net/interface.php';
const powerCache = new Map();
const inspectionCache = { at: 0, rows: null };
const postTripZoneCache = new Map();

function zonarAuth(auth) {
  return {
    customer: auth?.customer || process.env.ZONAR_CUSTOMER || '',
    username: auth?.username || process.env.ZONAR_USERNAME || '',
    password: auth?.password || process.env.ZONAR_PASSWORD || '',
  };
}

function fleetKey(value) {
  return String(value ?? '').trim().replace(/^0+(?=\d)/, '');
}

async function zonarXml(auth, params) {
  const response = await fetch(`${OMI_URL}?${new URLSearchParams({ ...zonarAuth(auth), ...params })}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  const xml = await response.text();
  if (!response.ok || /<code>\d+<\/code>/.test(xml)) {
    const code = (xml.match(/<code>([^<]*)<\/code>/) || [])[1] || '';
    const message = (xml.match(/<message>([^<]*)<\/message>/) || [])[1] || '';
    throw new Error(`Zonar ${response.status} ${code} ${message}`.trim());
  }
  return xml;
}

// Midnight-to-4:00 AM Pacific, as a unix second. Zonar stores the day's Power On events after that.
export function pacificMorningEpoch(now = new Date(), hour = 4) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  const offset = value('timeZoneName').match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const minutes = offset
    ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3] || 0))
    : -8 * 60;
  return Math.floor(Date.UTC(Number(value('year')), Number(value('month')) - 1, Number(value('day')), hour, 0, 0) / 1000) - minutes * 60;
}

function xmlAttr(tag, name) {
  return (String(tag).match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1] || '';
}

// Minutes since midnight in Pacific time. Inspection clocks arrive as unix seconds.
export function pacificMinutesOf(epochSeconds) {
  const epoch = Number(epochSeconds);
  if (!Number.isFinite(epoch)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epoch * 1000));
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return (hour === 24 ? 0 : hour) * 60 + minute;
}

// Completed and unfinished inspections. verified is true when every zone was marked.
// endAt is minutes since midnight, Pacific.
export function inspectionsFromXml(xml) {
  const rows = [];
  for (const match of String(xml || '').matchAll(/<insp\b([^>]*?)(?:\/>|>([^<]*))/g)) {
    const tag = match[1];
    const fleet = xmlAttr(tag, 'fleet').trim();
    const endAt = pacificMinutesOf(xmlAttr(tag, 'endtime') || xmlAttr(tag, 'timestamp'));
    if (!fleet || endAt == null) continue;
    const verifiedAttr = xmlAttr(tag, 'verified');
    const stat = xmlAttr(tag, 'stat').trim().toUpperCase();
    const verified = verifiedAttr === '1' || (verifiedAttr !== '0' && (stat === 'G' || stat === 'Y'));
    rows.push({
      id: (xmlAttr(tag, 'id') || match[2] || '').trim(),
      fleet,
      label: (xmlAttr(tag, 'cfglabel') || xmlAttr(tag, 'config')).trim(),
      config: xmlAttr(tag, 'config').trim(),
      endAt,
      verified,
      stat,
    });
  }
  return rows;
}

export function isPostTripLabel(label) {
  return /post[\s-]*trip/i.test(String(label || ''));
}

// The Student Check zone inside a post-trip, with the minute that zone was checked.
// A finished BUS POST-TRIP names it "INSIDE BUS/STUDENT CHECK". An unfinished report lists no zones.
export function studentCheckZoneFromXml(xml) {
  let found = null;
  for (const match of String(xml || '').matchAll(/<zone\b([^>]*)\/?>/g)) {
    const name = xmlAttr(match[1], 'name').trim();
    if (!/student\s*check/i.test(name)) continue;
    const endAt = pacificMinutesOf(xmlAttr(match[1], 'timestamp'));
    if (endAt == null) continue;
    if (!found || endAt < found.endAt) found = { name, endAt };
  }
  return found;
}

export function applyStudentZones(rows, zonesById = new Map()) {
  return (rows || []).map((row) => {
    const { id, ...rest } = row || {};
    if (!isPostTripLabel(rest.label) && !isPostTripLabel(rest.config)) return rest;
    const zone = zonesById.get(String(id || '')) || null;
    return zone ? { ...rest, studentZone: zone } : rest;
  });
}

function powerEventsFromXml(xml) {
  const events = [];
  for (const match of xml.matchAll(/<event\b([^>]*)\/>/g)) {
    const tag = match[1];
    const clock = ((tag.match(/\btime="([^"]*)"/) || [])[1] || '').match(/(\d{2}):(\d{2})/);
    if (!clock) continue;
    const reasons = ((tag.match(/\breasons="([^"]*)"/) || [])[1] || '').split(',');
    const on = reasons.includes('12');
    const off = reasons.includes('7');
    if (!on && !off) continue;
    events.push({ at: Number(clock[1]) * 60 + Number(clock[2]), on, off });
  }
  return events;
}

// Current zone name for each bus. Coordinates stay on Zonar.
export async function currentBusZones(auth) {
  const xml = await zonarXml(auth, {
    format: 'xml',
    version: '2',
    action: 'showposition',
    operation: 'current',
    logvers: '2',
    include_loi: '1',
  });
  const buses = [];
  for (const chunk of xml.split(/<asset\b/).slice(1)) {
    const fleet = (chunk.match(/\bfleet="([^"]*)"/) || [])[1] || '';
    const id = (chunk.match(/\bid="([^"]*)"/) || [])[1] || '';
    const zone = (chunk.match(/<loi>([^<]*)<\/loi>/) || [])[1] || '';
    if (!fleet.trim()) continue;
    buses.push({ id: id.trim(), fleet: fleet.trim(), zone: zone.trim() });
  }
  return buses;
}

// Current zone plus the coordinates used to recognize the yard.
// The habit report never sends these coordinates to the browser.
export async function currentBusLocations(auth) {
  const xml = await zonarXml(auth, {
    format: 'xml',
    version: '2',
    action: 'showposition',
    operation: 'current',
    logvers: '2',
    include_loi: '1',
  });
  const buses = [];
  for (const chunk of xml.split(/<asset\b/).slice(1)) {
    const fleet = (chunk.match(/\bfleet="([^"]*)"/) || [])[1] || '';
    const id = (chunk.match(/\bid="([^"]*)"/) || [])[1] || '';
    const zone = (chunk.match(/<loi>([^<]*)<\/loi>/) || [])[1] || '';
    const lat = Number((chunk.match(/<lat>([^<]*)<\/lat>/) || [])[1]);
    const lon = Number((chunk.match(/<long>([^<]*)<\/long>/) || [])[1]);
    if (!fleet.trim() || !id.trim()) continue;
    buses.push({
      id: id.trim(),
      fleet: fleet.trim(),
      zone: zone.trim(),
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
    });
  }
  return buses;
}

export async function assetPathXml(assetId, auth, start, end) {
  return zonarXml(auth, {
    format: 'xml',
    version: '2',
    action: 'showposition',
    operation: 'path',
    logvers: '3',
    reqtype: 'dbid',
    target: String(assetId),
    starttime: String(start),
    endtime: String(end),
  });
}

async function assetPowerEvents(assetId, auth, start, end) {
  const xml = await zonarXml(auth, {
    format: 'xml',
    version: '2',
    action: 'showposition',
    operation: 'path',
    logvers: '3',
    reqtype: 'dbid',
    target: String(assetId),
    starttime: String(start),
    endtime: String(end),
    poweron: '1',
    poweroff: '1',
  });
  return powerEventsFromXml(xml);
}

// Power On and Power Off today for the named buses. A bus we already asked about
// stays cached for a minute. Reason 12 is Power On and reason 7 is Power Off.
export async function powerEventsForBuses(fleets, auth) {
  const wanted = new Set((fleets || []).map(fleetKey).filter(Boolean));
  if (!wanted.size) return [];
  const zones = await currentBusZones(auth);
  const start = pacificMorningEpoch();
  const end = Math.floor(Date.now() / 1000);
  const events = [];
  const pending = [];
  for (const zone of zones) {
    if (!wanted.has(fleetKey(zone.fleet)) || !zone.id) continue;
    const hit = powerCache.get(zone.id);
    if (hit && Date.now() - hit.at < 60_000) {
      for (const event of hit.events) events.push({ ...event, bus: zone.fleet });
      continue;
    }
    pending.push(zone);
  }
  await Promise.all(
    pending.map(async (zone) => {
      const rows = await assetPowerEvents(zone.id, auth, start, end);
      powerCache.set(zone.id, { at: Date.now(), events: rows });
      for (const event of rows) events.push({ ...event, bus: zone.fleet });
    })
  );
  return events;
}

async function mapPool(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(runners);
}

// A completed post-trip keeps its Student Check zone. An unfinished one is asked again next time.
async function studentZonesForPostTrips(rows, auth) {
  const zonesById = new Map();
  const pending = [];
  for (const row of rows || []) {
    if (!row?.id || (!isPostTripLabel(row.label) && !isPostTripLabel(row.config))) continue;
    const cached = postTripZoneCache.get(row.id);
    const fresh = cached && (cached.zone ? Date.now() - cached.at < 6 * 60 * 60_000 : Date.now() - cached.at < 60_000);
    if (fresh) {
      if (cached.zone) zonesById.set(row.id, cached.zone);
      continue;
    }
    pending.push(row);
  }
  await mapPool(pending, 6, async (row) => {
    try {
      const xml = await zonarXml(auth, {
        format: 'xml',
        action: 'showopen',
        operation: 'showinsp',
        target: row.id,
        logvers: '2',
      });
      const zone = studentCheckZoneFromXml(xml);
      postTripZoneCache.set(row.id, { at: Date.now(), zone });
      if (zone) zonesById.set(row.id, zone);
    } catch {
      // This post-trip stays uncounted until the next check.
    }
  });
  return zonesById;
}

// Today's inspections for the whole fleet. One list, cached for a minute.
// start is 4:00 AM Pacific, the same morning boundary Power On uses.
// A post-trip gains studentZone when its detail includes the Student Check zone.
export async function inspectionsToday(auth) {
  if (inspectionCache.rows && Date.now() - inspectionCache.at < 60_000) return inspectionCache.rows;
  const xml = await zonarXml(auth, {
    format: 'xml',
    action: 'showopen',
    operation: 'insp',
    status: 'all',
    start: String(pacificMorningEpoch()),
    tstype: 'insp',
    logvers: '2',
  });
  const rows = inspectionsFromXml(xml);
  const zonesById = await studentZonesForPostTrips(rows, auth);
  const ready = applyStudentZones(rows, zonesById);
  inspectionCache.at = Date.now();
  inspectionCache.rows = ready;
  return ready;
}
