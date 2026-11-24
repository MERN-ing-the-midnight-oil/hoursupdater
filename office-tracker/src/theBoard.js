import { lastSchoolForSegment, schoolDestinationLabel } from '../../src/logic/earlyRelease.js';
import { parseClockTime } from '../../src/logic/timeUtils.js';

// A run is one route piece the yard is watching:
// { route, bus, run, clockIn, clockOut, poweredOnAt, note }
// Times are "H:MM" or minutes since midnight. poweredOnAt is empty until
// Zonar reports a Power On. note is the Time Changes school list for the route.

export function minutesNow(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

export function boardDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatBoardClock(minutes) {
  const hour24 = Math.floor(minutes / 60);
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minutes % 60).padStart(2, '0')} ${suffix}`;
}

function minutesOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').trim();
  if (!text) return null;
  try {
    return parseClockTime(text);
  } catch {
    return null;
  }
}

export function clockInputValue(value) {
  const minutes = minutesOf(value);
  if (minutes == null) return '';
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function clean(value) {
  return String(value ?? '').trim();
}

export function normalizeStudentName(name) {
  return clean(name).replace(/\s+/g, ' ');
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Dark Bus Alert waits this long after clock-in before a missing Power On pops up.
// Sound is on so a wall display is heard, not only seen.
export const DEFAULT_DARK_BUS_ALERT = Object.freeze({
  graceMinutes: 5,
  sound: true,
  flash: true,
  cover: true,
  // The open Dark Bus screen follows the clock from AM to MID, then MID to PM.
  midAt: '09:30',
  pmAt: '13:00',
  // A short list of Power On times paired with that run's clock-in.
  activityLog: false,
});

// Student Check waits this long after the bus is back in the yard.
// The clock starts once a Mid Day or PM bus has visited a school and returned.
export const DEFAULT_STUDENT_CHECK_ALERT = Object.freeze({
  graceMinutes: 10,
  sound: true,
  flash: true,
  cover: true,
});

// A return counts as Back Early when the bus reached the yard more than this
// many minutes before that run's clock-out.
export const DEFAULT_EARLY_MINUTES = 15;

export function normalizeEarlyMinutes(saved) {
  if (saved == null || saved === '') return DEFAULT_EARLY_MINUTES;
  const raw = typeof saved === 'object' ? saved.minutes : saved;
  if (raw == null || raw === '') return DEFAULT_EARLY_MINUTES;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes)) return DEFAULT_EARLY_MINUTES;
  return Math.min(180, Math.max(0, Math.round(minutes)));
}

function savedClock(value, fallback) {
  const minutes = minutesOf(value);
  if (minutes == null) return fallback;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function normalizeDarkBusAlert(saved) {
  const grace = Number(saved?.graceMinutes);
  const graceMinutes = Number.isFinite(grace)
    ? Math.min(60, Math.max(0, Math.round(grace)))
    : DEFAULT_DARK_BUS_ALERT.graceMinutes;
  return {
    graceMinutes,
    sound: saved?.sound == null ? DEFAULT_DARK_BUS_ALERT.sound : Boolean(saved.sound),
    flash: saved?.flash == null ? DEFAULT_DARK_BUS_ALERT.flash : Boolean(saved.flash),
    cover: saved?.cover == null ? DEFAULT_DARK_BUS_ALERT.cover : Boolean(saved.cover),
    midAt: savedClock(saved?.midAt, DEFAULT_DARK_BUS_ALERT.midAt),
    pmAt: savedClock(saved?.pmAt, DEFAULT_DARK_BUS_ALERT.pmAt),
    activityLog: saved?.activityLog == null ? DEFAULT_DARK_BUS_ALERT.activityLog : Boolean(saved.activityLog),
  };
}

export function normalizeStudentCheckAlert(saved) {
  const grace = Number(saved?.graceMinutes);
  const graceMinutes = Number.isFinite(grace)
    ? Math.min(60, Math.max(0, Math.round(grace)))
    : DEFAULT_STUDENT_CHECK_ALERT.graceMinutes;
  return {
    graceMinutes,
    sound: saved?.sound == null ? DEFAULT_STUDENT_CHECK_ALERT.sound : Boolean(saved.sound),
    flash: saved?.flash == null ? DEFAULT_STUDENT_CHECK_ALERT.flash : Boolean(saved.flash),
    cover: saved?.cover == null ? DEFAULT_STUDENT_CHECK_ALERT.cover : Boolean(saved.cover),
  };
}

const DARK_BUS_RUNS = ['AM', 'MID', 'PM'];

// Which tab the Dark Bus screen shows when nobody has picked one by hand.
export function darkBusScreen(nowMinutes, settings) {
  const mid = minutesOf(settings?.midAt);
  const pm = minutesOf(settings?.pmAt);
  const midAt = mid == null ? minutesOf(DEFAULT_DARK_BUS_ALERT.midAt) : mid;
  const pmAt = pm == null ? minutesOf(DEFAULT_DARK_BUS_ALERT.pmAt) : pm;
  if (nowMinutes >= pmAt) return 'PM';
  if (nowMinutes >= midAt) return 'MID';
  return 'AM';
}

export function darkBusSwitchNote(tab, scheduled, settings) {
  const mid = formatBoardClock(minutesOf(settings?.midAt) ?? minutesOf(DEFAULT_DARK_BUS_ALERT.midAt));
  const pm = formatBoardClock(minutesOf(settings?.pmAt) ?? minutesOf(DEFAULT_DARK_BUS_ALERT.pmAt));
  const shown = clean(tab).toUpperCase() || scheduled;
  if (settings?.earlyRelease) {
    if (shown !== scheduled) {
      return `Showing ${shown}. Early release day. The clock takes over again at the next switch. PM starts at ${pm}. Midday routes are not watched.`;
    }
    return `Early release day. AM until ${pm}, then PM. Midday routes are not watched.`;
  }
  if (shown !== scheduled) {
    return `Showing ${shown}. The clock takes over again at the next switch. MID starts at ${mid}. PM starts at ${pm}.`;
  }
  return `AM until ${mid}. MID until ${pm}.`;
}

const STUDENT_CHECK_RUNS = ['MID', 'PM'];

// Student Check has no AM tab. Before the MID switch it stays on MID.
export function studentCheckScreen(nowMinutes, settings) {
  const screen = darkBusScreen(nowMinutes, settings);
  return screen === 'AM' ? 'MID' : screen;
}

export function studentCheckSwitchNote(tab, scheduled, settings) {
  const pm = formatBoardClock(minutesOf(settings?.pmAt) ?? minutesOf(DEFAULT_DARK_BUS_ALERT.pmAt));
  const shown = clean(tab).toUpperCase() || scheduled;
  if (shown !== scheduled) {
    return `Showing ${shown}. The clock takes over again at the next switch. PM starts at ${pm}. AM routes are not watched.`;
  }
  return `MID until ${pm}. PM after that. AM routes are not watched.`;
}

// A standalone Student Check or Child Check. A Post Trip counts only when its
// detail includes the Student Check zone, which arrives as studentZone.
export function isStudentCheckConfig(label) {
  const text = clean(label).toLowerCase();
  return /student\s*check/.test(text) || /child\s*check/.test(text);
}

export function countsAsStudentCheck(inspection) {
  if (Number.isInteger(Number(inspection?.studentZone?.endAt))) return true;
  return Boolean(inspection?.verified) && isStudentCheckConfig(inspection?.label || inspection?.config);
}

// Afternoon alerts on an early release day use that route's posted clock-in.
// Morning clocks stay. Midday runs are left out: most of them do not go out.
export function earlyReleaseWatch(runs, clocksByRoute) {
  const clocks = new Map();
  const source = clocksByRoute instanceof Map ? clocksByRoute.entries() : Object.entries(clocksByRoute || {});
  for (const [key, value] of source) clocks.set(clean(key).toLowerCase(), value);
  const next = [];
  for (const run of runs || []) {
    const piece = clean(run?.run).toUpperCase();
    if (piece === 'MID') continue;
    if (piece !== 'PM') {
      next.push(run);
      continue;
    }
    const clockIn = clockInputValue(clocks.get(clean(run?.route).toLowerCase()));
    next.push(clockIn ? { ...run, clockIn } : run);
  }
  return { runs: next };
}

// A pill stays off the page until that route's start time.
// yellow: the start time has passed, the wait has not, and no Power On yet. Grey.
// pending: Power On has not been checked yet, so the pill stays quiet.
// dark: the wait is over, the run is still out, and this run has no Power On.
// missed: the run is over and no Power On was counted. Solid red, and the alarm stays quiet.
// on: a Power On was counted for this run. It stays green for the rest of the day.
export function darkBusPillTone(run, nowMinutes, graceMinutes = 0) {
  const clockIn = minutesOf(run?.clockIn);
  if (clockIn == null) return 'quiet';
  if (nowMinutes < clockIn) return 'waiting';
  if (minutesOf(run?.poweredOnAt) != null) return 'on';
  if (run?.powerPending) return 'pending';
  const grace = Number.isFinite(Number(graceMinutes)) ? Number(graceMinutes) : 0;
  const due = clockIn + grace;
  if (nowMinutes < due) return 'yellow';
  const clockOut = minutesOf(run?.clockOut);
  const ends = clockOut != null ? clockOut : due + OPEN_RUN_MINUTES;
  if (nowMinutes >= ends) return 'missed';
  return 'dark';
}

export function darkBusPills(runs, nowMinutes, graceMinutes = 0, acknowledged = []) {
  const quiet = new Set(Array.from(acknowledged || [], (key) => String(key || '')));
  return (runs || [])
    .map((run) => {
      const clockIn = minutesOf(run?.clockIn);
      const piece = clean(run?.run).toUpperCase();
      const pill = {
        route: clean(run?.route),
        bus: clean(run?.bus),
        run: piece,
        driver: clean(run?.driver),
        photo: clean(run?.photo),
        clockIn,
        poweredOnAt: minutesOf(run?.poweredOnAt),
        lastPowerOnAt: minutesOf(run?.lastPowerOnAt),
        tone: darkBusPillTone(run, nowMinutes, graceMinutes),
      };
      // Dismiss stops the flash. The badge stays red until Power On.
      if (pill.tone === 'dark' && quiet.has(darkBusKey(pill))) pill.tone = 'held';
      return pill;
    })
    .filter(
      (pill) =>
        DARK_BUS_RUNS.includes(pill.run) &&
        pill.clockIn != null &&
        nowMinutes >= pill.clockIn &&
        (pill.route || pill.bus)
    );
}

export function darkBusGroups(pills, run) {
  const want = clean(run).toUpperCase();
  const groups = new Map();
  for (const pill of pills || []) {
    if (pill.run !== want) continue;
    const list = groups.get(pill.clockIn) || [];
    list.push(pill);
    groups.set(pill.clockIn, list);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([clockIn, items]) => ({
      clockIn,
      label: formatBoardClock(clockIn),
      pills: items.sort(
        (a, b) => compareRoutes(a.route, b.route) || a.bus.localeCompare(b.bus, undefined, { numeric: true })
      ),
    }));
}

export function darkBusHasFlash(runs, nowMinutes, graceMinutes = 0, acknowledged = []) {
  return darkBusPills(runs, nowMinutes, graceMinutes, acknowledged).some((pill) => pill.tone === 'dark');
}

export function darkBusKey(alert) {
  return [alert?.bus, alert?.route, alert?.run, alert?.clockIn].map((part) => clean(part).toLowerCase()).join('|');
}

// Spoken when a route starts flashing. Names the clock-in and the wait that opened the alarm.
export function darkBusAlarmStatement(alert, graceMinutes = 0) {
  const who = clean(alert?.route) ? `Route ${clean(alert.route)}` : clean(alert?.bus) ? `Bus ${clean(alert.bus)}` : 'A route';
  const clockIn = minutesOf(alert?.clockIn);
  const clock = clockIn == null ? '' : formatBoardClock(clockIn);
  const grace = Number.isFinite(Number(graceMinutes)) ? Math.max(0, Math.round(Number(graceMinutes))) : 0;
  const wait = grace === 1 ? '1 minute' : `${grace} minutes`;
  return `${who}, ${clock ? `clock-in ${clock}` : 'no clock-in'}, wait ${wait}.`;
}

// Two lines for a route with no Power On for this run: minutes since clock-in, and that status.
// Grey, still inside the wait, says "Not yet powered on". After the wait, the words are
// "Never powered on". A later key-off does not turn a counted Power On red again.
export function darkBusPillFacts(pill, nowMinutes) {
  const clockIn = minutesOf(pill?.clockIn);
  const elapsed = clockIn == null || !Number.isInteger(nowMinutes) ? null : Math.max(0, nowMinutes - clockIn);
  const since =
    elapsed == null ? 'No clock-in' : elapsed === 1 ? '1 minute since clock-in' : `${elapsed} minutes since clock-in`;
  const powered = minutesOf(pill?.poweredOnAt);
  const never = pill?.tone === 'dark' || pill?.tone === 'held' || pill?.tone === 'missed';
  const missing = never ? 'Never powered on' : 'Not yet powered on';
  const power = powered == null ? missing : `Powered on at ${formatBoardClock(powered)}`;
  return [since, power];
}

// A bus is dark when its clock-in (plus any grace) has passed, the run is
// still out, and Zonar still has no Power On. Any Power On for this run
// closes the alert, including one that arrives after the deadline. Once
// clock-out passes, the run is over. A run with no clock-out stays dark for
// three hours after the deadline, so a morning miss does not stay up through
// the afternoon.
const OPEN_RUN_MINUTES = 180;

export function darkBuses(runs, nowMinutes, graceMinutes = 0, skipped = []) {
  const grace = Number.isFinite(graceMinutes) ? graceMinutes : 0;
  const quiet = new Set((skipped || []).map((item) => routeKey(item?.route)).filter(Boolean));
  const alerts = [];
  for (const run of runs || []) {
    if (run?.powerPending) continue;
    if (quiet.has(routeKey(run?.route))) continue;
    const clockIn = minutesOf(run?.clockIn);
    if (clockIn == null) continue;
    const due = clockIn + grace;
    if (nowMinutes < due) continue;
    const clockOut = minutesOf(run?.clockOut);
    const ends = clockOut != null ? clockOut : due + OPEN_RUN_MINUTES;
    if (nowMinutes >= ends) continue;
    if (minutesOf(run?.poweredOnAt) != null) continue;
    alerts.push({
      id: clean(run.id),
      bus: clean(run.bus),
      route: clean(run.route),
      run: clean(run.run),
      clockIn,
      due,
      poweredOnAt: null,
      source: clean(run.source),
    });
  }
  return alerts.sort((a, b) => a.clockIn - b.clockIn || a.route.localeCompare(b.route, undefined, { numeric: true }));
}

// Runs that already started. Their alerts are dismissed so a reload does not
// sound again before the next Zonar check.
export function startupDismissals(runs, nowMinutes, graceMinutes = 0, skipped = []) {
  const keys = [];
  for (const run of runs || []) {
    if (minutesOf(run?.poweredOnAt) == null) continue;
    const [alert] = darkBuses([{ ...run, poweredOnAt: '' }], nowMinutes, graceMinutes, skipped);
    if (alert) keys.push(darkBusKey(alert));
  }
  return keys;
}

// Group Zonar power events by bus number. Each event is { at, on, off }.
export function indexPowerEvents(events) {
  const byBus = new Map();
  for (const event of events || []) {
    const key = busKey(event?.bus ?? event?.fleet);
    if (!key || !Number.isInteger(event?.at)) continue;
    if (!byBus.has(key)) byBus.set(key, []);
    byBus.get(key).push({ at: event.at, on: Boolean(event.on), off: Boolean(event.off) });
  }
  for (const list of byBus.values()) list.sort((a, b) => a.at - b.at);
  return byBus;
}

// The last minute a Power On still belongs to this run. Clock-out does not
// end it. The next clock-in on this bus does: that key turn belongs to the
// later run. No later clock-in means any Power On still today counts.
function powerOnLatest(run, siblings) {
  const clockIn = minutesOf(run?.clockIn);
  if (clockIn == null) return null;
  const later = (siblings || [])
    .map((item) => minutesOf(item?.clockIn))
    .filter((at) => at != null && at > clockIn)
    .sort((a, b) => a - b)[0];
  if (later == null) return null;
  return Math.max(clockIn, later - 1);
}

// The Power On for this clock-in, once that clock-in has arrived. A bus that
// is already on at clock-in keeps the time the key was turned. One Power On
// after clock-in is enough for this AM, midday, or PM run, even if the bus
// is turned off again and even if that Power On is after clock-out. Before
// clock-in, nothing is assigned.
export function powerOnForRun(events, clockIn, nowMinutes, latest) {
  if (clockIn == null || !Number.isInteger(nowMinutes) || nowMinutes < clockIn) return null;
  const end = Number.isInteger(latest) ? Math.max(clockIn, latest) : null;
  const ordered = [...(events || [])]
    .filter((event) => Number.isInteger(event?.at))
    .sort((a, b) => a.at - b.at);
  let onAtClockIn = null;
  let after = null;
  for (const event of ordered) {
    if (event.at <= clockIn) {
      if (event.on) onAtClockIn = event.at;
      if (event.off) onAtClockIn = null;
      continue;
    }
    if (event.at > nowMinutes) break;
    if (end != null && event.at > end) break;
    if (event.on && after == null) after = event.at;
  }
  if (onAtClockIn != null) return onAtClockIn;
  return after;
}

export function applyPowerOns(runs, eventsByBus, nowMinutes) {
  if (!eventsByBus || !Number.isInteger(nowMinutes)) return runs || [];
  const byBus = new Map();
  for (const run of runs || []) {
    const key = busKey(run?.bus);
    if (!key) continue;
    const list = byBus.get(key) || [];
    list.push(run);
    byBus.set(key, list);
  }
  return (runs || []).map((run) => {
    const clockIn = minutesOf(run?.clockIn);
    if (clockIn == null) return run;
    const siblings = byBus.get(busKey(run?.bus)) || [];
    const events = eventsByBus.get(busKey(run?.bus)) || [];
    const at = powerOnForRun(events, clockIn, nowMinutes, powerOnLatest(run, siblings));
    let lastPowerOnAt = null;
    for (const event of events) {
      if (event?.on && Number.isInteger(event.at)) lastPowerOnAt = event.at;
    }
    return {
      ...run,
      poweredOnAt: at == null ? '' : at,
      lastPowerOnAt: lastPowerOnAt == null ? '' : lastPowerOnAt,
    };
  });
}

// Spare buses are not the bus on the run. Their Power On is looked up by bus and run.
export function sparePowerLive(runs, outOfService, eventsByBus, nowMinutes, date = '') {
  const live = {};
  if (!eventsByBus || !Number.isInteger(nowMinutes)) return live;
  for (const item of outOfService || []) {
    const covered = (runs || []).filter((run) => coversRun(item, run));
    for (const run of covered) {
      const spare = spareForPortion(item, run?.run, date);
      if (!spare) continue;
      const clockIn = minutesOf(run?.clockIn);
      if (clockIn == null) continue;
      const at = powerOnForRun(
        eventsByBus.get(busKey(spare)) || [],
        clockIn,
        nowMinutes,
        powerOnLatest(run, covered)
      );
      live[`${spare.toLowerCase()}|${clean(run?.run).toLowerCase()}`] = { poweredOnAt: at == null ? '' : at };
    }
  }
  return live;
}

// Buses whose run has started and has not ended. Those are the ones that can be dark.
export function busesInService(runs, nowMinutes) {
  const buses = new Set();
  for (const run of runs || []) {
    const clockIn = minutesOf(run?.clockIn);
    if (clockIn == null || nowMinutes < clockIn) continue;
    const clockOut = minutesOf(run?.clockOut);
    const ends = clockOut != null ? clockOut : clockIn + OPEN_RUN_MINUTES;
    if (nowMinutes >= ends) continue;
    const bus = busKey(run?.bus);
    if (bus) buses.add(bus);
  }
  return [...buses];
}

// Every bus whose clock-in has arrived today, including runs that already ended.
// A late check still needs those Power On times so a counted start stays green.
export function busesStarted(runs, nowMinutes) {
  const buses = new Set();
  for (const run of runs || []) {
    const clockIn = minutesOf(run?.clockIn);
    if (clockIn == null || nowMinutes < clockIn) continue;
    const bus = busKey(run?.bus);
    if (bus) buses.add(bus);
  }
  return [...buses];
}

function powerOnMemoryKey(run) {
  const clockIn = minutesOf(run?.clockIn);
  if (clockIn == null) return '';
  return darkBusKey({ bus: run?.bus, route: run?.route, run: run?.run, clockIn });
}

// A Power On counted today stays on that run until the date changes.
export function rememberPowerOns(saved, runs, date) {
  const stored = saved && saved.date === date && saved.ons && typeof saved.ons === 'object' ? saved.ons : {};
  const ons = { ...stored };
  for (const run of runs || []) {
    const at = minutesOf(run?.poweredOnAt);
    const key = powerOnMemoryKey(run);
    if (at == null || !key) continue;
    ons[key] = at;
  }
  return { date, ons };
}

export function withRememberedPowerOns(runs, saved, date) {
  const ons = saved && saved.date === date && saved.ons && typeof saved.ons === 'object' ? saved.ons : {};
  return (runs || []).map((run) => {
    if (minutesOf(run?.poweredOnAt) != null) return run;
    const at = Number(ons[powerOnMemoryKey(run)]);
    if (!Number.isInteger(at)) return run;
    return { ...run, poweredOnAt: at };
  });
}

// The first time an alert is shown today. A new day starts over. An alert that
// is already up when recording begins is stamped at its due time.
export function rememberAlertTimes(saved, alerts, nowMinutes, date) {
  const stored = saved && saved.date === date && saved.times && typeof saved.times === 'object' ? saved.times : null;
  const times = {};
  for (const alert of alerts || []) {
    const key = darkBusKey(alert);
    if (!key) continue;
    const existing = stored ? Number(stored[key]) : NaN;
    if (Number.isInteger(existing)) times[key] = existing;
    else if (!stored && alert.due != null) times[key] = alert.due;
    else times[key] = nowMinutes;
  }
  return { date, times };
}

export function withAlertedAt(alerts, saved) {
  const times = saved?.times || {};
  return (alerts || []).map((alert) => {
    const at = Number(times[darkBusKey(alert)]);
    return Number.isInteger(at) ? { ...alert, alertedAt: at } : alert;
  });
}

function darkLogLine(run, verdict, detail, extra = {}) {
  return {
    bus: clean(extra.bus ?? run?.bus),
    route: clean(run?.route),
    run: clean(run?.run),
    clockIn: extra.clockIn ?? null,
    verdict,
    detail,
  };
}

// One line per watched run: why it is dark, or why it is not.
// outOfService can swap the watched bus to a spare or drop the usual bus.
export function darkBusLog(runs, outOfService, live, nowMinutes, graceMinutes = 0, acknowledged = [], skipped = [], date = '') {
  const grace = Number.isFinite(graceMinutes) ? graceMinutes : 0;
  const acked = new Set(acknowledged || []);
  const list = Array.isArray(outOfService) ? outOfService : [];
  const outBuses = new Set(list.map((item) => busKey(item?.usualBus)).filter(Boolean));
  const skipByRoute = new Map(
    (skipped || []).flatMap((item) => {
      const key = routeKey(item?.route);
      const reason = clean(item?.reason);
      return key && reason ? [[key, reason]] : [];
    })
  );
  const timedRoutes = new Set(
    (runs || []).filter((run) => clean(run?.run) && minutesOf(run?.clockIn) != null).map((run) => routeKey(run.route))
  );
  const lines = [];
  for (const run of runs || []) {
    if (!clean(run?.run) && timedRoutes.has(routeKey(run?.route))) continue;
    const cover = list.find((item) => coversRun(item, run));
    let watched = run;
    let prefix = '';
    if (cover) {
      const spare = spareForPortion(cover, run.run, date);
      if (!spare) {
        lines.push(darkLogLine(run, 'Not watched', 'Out of service with no spare bus.'));
        continue;
      }
      if (busKey(run.bus) !== busKey(spare)) {
        const status = statusForBus(live, spare, run.run);
        watched = { ...run, bus: spare, poweredOnAt: status.poweredOnAt || '' };
        prefix = `Usual bus ${clean(run.bus)} is out. Watching spare ${spare}. `;
      }
    } else if (outBuses.has(busKey(run.bus))) {
      lines.push(darkLogLine(run, 'Not watched', 'This bus is out of service, and this run is not the one the spare covers.'));
      continue;
    }

    const rawClock = clean(watched.clockIn);
    const clockIn = minutesOf(watched.clockIn);
    if (clockIn == null) {
      const reason = skipByRoute.get(routeKey(watched.route));
      if (reason) {
        lines.push(darkLogLine(watched, 'Not watched', `${prefix}${reason}`, { clockIn: null }));
        continue;
      }
      const why = rawClock
        ? `Saved start "${rawClock}" is not a clock time, so this run cannot alert.`
        : 'No start time is saved, so this run cannot alert.';
      lines.push(darkLogLine(watched, 'No clock-in', `${prefix}${why}`, { clockIn: null }));
      continue;
    }
    const due = clockIn + grace;
    const dueLabel = formatBoardClock(due);
    const poweredOn = minutesOf(watched.poweredOnAt);
    if (nowMinutes < due) {
      lines.push(darkLogLine(watched, 'Waiting', `${prefix}Due at ${dueLabel}.`, { clockIn }));
      continue;
    }
    const clockOut = minutesOf(watched.clockOut);
    const ends = clockOut != null ? clockOut : due + OPEN_RUN_MINUTES;
    if (nowMinutes >= ends) {
      lines.push(darkLogLine(watched, 'Run over', `${prefix}The run ended at ${formatBoardClock(ends)}.`, { clockIn }));
      continue;
    }
    if (poweredOn != null) {
      const when =
        poweredOn <= due
          ? `Power On ${formatBoardClock(poweredOn)} was by the ${dueLabel} deadline.`
          : `Power On ${formatBoardClock(poweredOn)} was after the ${dueLabel} deadline, so the alert closed.`;
      lines.push(darkLogLine(watched, 'Powered on', `${prefix}${when}`, { clockIn }));
      continue;
    }
    const late = 'No Power On.';
    const key = darkBusKey({ bus: watched.bus, route: watched.route, run: watched.run, clockIn });
    if (acked.has(key)) {
      lines.push(darkLogLine(watched, 'Dismissed', `${prefix}Due at ${dueLabel}. ${late} Dismissed, so the popup stays closed.`, { clockIn }));
      continue;
    }
    lines.push(darkLogLine(watched, 'Dark', `${prefix}Due at ${dueLabel}. ${late}`, { clockIn }));
  }
  return lines.sort((a, b) => {
    if (a.clockIn == null && b.clockIn == null) return 0;
    if (a.clockIn == null) return 1;
    if (b.clockIn == null) return -1;
    return a.clockIn - b.clockIn || String(a.bus).localeCompare(String(b.bus), undefined, { numeric: true });
  });
}

export function darkBusLogMarkup(lines, { nowMinutes, graceMinutes = 0 } = {}) {
  const wait = graceMinutes === 1 ? '1 minute' : `${graceMinutes} minutes`;
  const now = Number.isFinite(nowMinutes) ? formatBoardClock(nowMinutes) : '';
  const head = `Now ${now}. Wait ${wait} after clock-in.`;
  if (!lines?.length) return `<p class="board-dark-log-now">${head}</p><p class="board-empty">No runs are being watched.</p>`;
  const rows = lines
    .map((line) => {
      const who = [
        line.bus ? `Bus ${escapeHtml(line.bus)}` : '',
        line.route ? `Route ${escapeHtml(line.route)}` : 'Usual start',
        runLabel(line.run),
        line.clockIn == null ? 'No clock-in' : `Clock-in ${formatBoardClock(line.clockIn)}`,
      ]
        .filter(Boolean)
        .join(' · ');
      const tone = String(line.verdict || '').toLowerCase().replace(/\s+/g, '-');
      return `<li class="board-dark-log-row is-${tone}"><span>${who}</span><span>${escapeHtml(line.verdict)}. ${escapeHtml(line.detail)}</span></li>`;
    })
    .join('');
  return `<p class="board-dark-log-now">${head}</p><ol class="board-dark-log">${rows}</ol>`;
}

// The transportation yard, as Zonar names that zone.
export function isYardZone(zone) {
  return clean(zone).toLowerCase() === 'transportation';
}

// Destination schools, as Zonar starts those zone names.
// "Bellingham High (South)" and "Squalicum (Lower)" count.
// A street, the propane tank, and the warehouse do not.
const DESTINATION_SCHOOLS = [
  'alderwood',
  'bellingham high',
  'birchwood',
  'carl cozier',
  'columbia',
  'community transitions',
  'cordata',
  'fairhaven',
  'geneva',
  'happy valley',
  'kulshan',
  'lowell',
  'northern heights',
  'parkview',
  'roosevelt',
  'sehome',
  'shuksan',
  'silver beach',
  'squalicum',
  'sunnyland',
  'wade king',
  'whatcom',
];

// Abbreviations written in Time Changes route notes, such as "LOW, SHS/BHS".
const SCHOOL_STOPS = new Set([
  'aw',
  'bhs',
  'bw',
  'cc',
  'col',
  'cor',
  'ct',
  'elc',
  'fms',
  'gen',
  'hv',
  'kms',
  'low',
  'nh',
  'pv',
  'roo',
  'rv',
  'shs',
  'sl',
  'sms',
  'sqhs',
  'swhs',
  'wdc',
  'wk',
  'wms',
]);

export function routeGoesToSchools(note) {
  const tokens = clean(note)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((token) => SCHOOL_STOPS.has(token));
}

// Utility drivers are not school runs. A route with no driver is watched only
// when the note lists school stops the way the other routes do.
export function darkBusSkip(profile) {
  const name = clean(profile?.name);
  const note = clean(profile?.note);
  if (/^utility\b/i.test(name) || /utility day/i.test(note)) {
    return 'Utility driver. Dark Bus does not watch this route.';
  }
  if (routeGoesToSchools(note)) return '';
  if (/driver trainer/i.test(note)) return 'Driver trainer with no school stops. Dark Bus does not watch this route.';
  if (/no driver assigned/i.test(note)) return 'No driver is assigned and no school stops are listed. Dark Bus does not watch this route.';
  return '';
}

export function isSchoolZone(zone) {
  const name = clean(zone)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!name || isYardZone(zone)) return false;
  return DESTINATION_SCHOOLS.some((school) => name === school || name.startsWith(`${school} `));
}

// The Zonar name for a route-note school code. An unknown code has no zone.
function schoolZoneLabel(code) {
  const key = clean(code).toUpperCase();
  if (!key) return '';
  const label = schoolDestinationLabel(key);
  if (!label || label.toUpperCase() === key) return '';
  return label;
}

// True when this zone is the last school on the run's own segment.
export function isLastSchoolZone(zone, run) {
  const label = schoolZoneLabel(lastSchoolForSegment(run?.note, run?.run));
  if (!label) return false;
  const name = clean(zone)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const school = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return name === school || name.startsWith(`${school} `);
}

function busKey(value) {
  return clean(value).toLowerCase().replace(/^0+(?=\d)/, '');
}

function zonesByBus(zones) {
  const zoneByBus = new Map();
  for (const zone of zones || []) {
    const key = busKey(zone?.fleet);
    if (key) zoneByBus.set(key, zone?.zone || '');
  }
  return zoneByBus;
}

function runIsDuring(run, nowMinutes) {
  const clockIn = minutesOf(run?.clockIn);
  const clockOut = minutesOf(run?.clockOut);
  return clockIn != null && clockOut != null && nowMinutes >= clockIn && nowMinutes < clockOut;
}

// One run's trip away from the yard. A morning departure does not count for the afternoon.
export function yardDepartureKey(run) {
  return [clean(run?.route), clean(run?.run), busKey(run?.bus)].join('|').toLowerCase();
}

// Runs seen at the last school on that segment. The note lists the schools in
// order, and the last one is the mark. A street, the propane tank, and the
// warehouse do not count, and neither does an earlier school on the same run.
export function noteSchoolVisits(runs, nowMinutes, zones = [], already = []) {
  const zoneByBus = zonesByBus(zones);
  const seen = new Set((already || []).map((key) => String(key || '').toLowerCase()).filter(Boolean));
  for (const run of runs || []) {
    if (!clean(run?.route) || !runIsDuring(run, nowMinutes)) continue;
    const zone = zoneByBus.get(busKey(run?.bus));
    if (!isLastSchoolZone(zone, run)) continue;
    seen.add(yardDepartureKey(run));
  }
  return [...seen].sort();
}

// The first minute a run is back in Transportation after its last school.
// That minute is what "more than X minutes before clock-out" is measured from.
export function noteYardReturns(runs, nowMinutes, zones = [], schoolKeys = [], already = []) {
  const zoneByBus = zonesByBus(zones);
  const schools = new Set((schoolKeys || []).map((key) => String(key || '').toLowerCase()).filter(Boolean));
  const seen = new Map();
  for (const item of already || []) {
    const key = String(item?.key || '').toLowerCase();
    const at = Number(item?.at);
    if (!key || !Number.isFinite(at)) continue;
    seen.set(key, at);
  }
  for (const run of runs || []) {
    if (!clean(run?.route) || !runIsDuring(run, nowMinutes)) continue;
    const key = yardDepartureKey(run);
    if (seen.has(key)) continue;
    if (!schools.has(key)) continue;
    const zone = zoneByBus.get(busKey(run?.bus));
    if (!(Boolean(run?.inYard) || isYardZone(zone))) continue;
    seen.set(key, nowMinutes);
  }
  return [...seen.entries()]
    .map(([key, at]) => ({ key, at }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.at - b.at);
}

function studentRunPiece(run) {
  const piece = clean(run?.run).toUpperCase();
  return STUDENT_CHECK_RUNS.includes(piece) ? piece : '';
}

// Mid Day and PM runs seen at any school. The last school is not required.
// A street, the propane tank, and the warehouse do not count. AM does not count.
export function studentCheckSchoolVisits(runs, nowMinutes, zones = [], already = []) {
  const zoneByBus = zonesByBus(zones);
  const seen = new Set((already || []).map((key) => String(key || '').toLowerCase()).filter(Boolean));
  for (const run of runs || []) {
    if (!studentRunPiece(run) || !clean(run?.route) || !runIsDuring(run, nowMinutes)) continue;
    const zone = zoneByBus.get(busKey(run?.bus));
    if (!isSchoolZone(zone)) continue;
    seen.add(yardDepartureKey(run));
  }
  return [...seen].sort();
}

// The first minute a visited Mid Day or PM run is back in Transportation.
// The return still counts after clock-out, because the check is owed to the yard.
export function studentCheckYardReturns(runs, nowMinutes, zones = [], schoolKeys = [], already = []) {
  const zoneByBus = zonesByBus(zones);
  const schools = new Set((schoolKeys || []).map((key) => String(key || '').toLowerCase()).filter(Boolean));
  const seen = new Map();
  for (const item of already || []) {
    const key = String(item?.key || '').toLowerCase();
    const at = Number(item?.at);
    if (!key || !Number.isFinite(at)) continue;
    seen.set(key, at);
  }
  for (const run of runs || []) {
    const clockIn = minutesOf(run?.clockIn);
    if (!studentRunPiece(run) || !clean(run?.route) || clockIn == null || nowMinutes < clockIn) continue;
    const key = yardDepartureKey(run);
    if (seen.has(key) || !schools.has(key)) continue;
    const zone = zoneByBus.get(busKey(run?.bus));
    if (!(Boolean(run?.inYard) || isYardZone(zone))) continue;
    seen.set(key, nowMinutes);
  }
  return [...seen.entries()]
    .map(([key, at]) => ({ key, at }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.at - b.at);
}

// The earliest completed Student Check that belongs to each run.
// A check belongs to the latest Mid Day or PM clock-in at or before its end time,
// so a morning check does not clear the afternoon and one check does not clear both.
export function studentChecksByRun(runs, inspections) {
  const byKey = new Map();
  for (const inspection of inspections || []) {
    if (!countsAsStudentCheck(inspection)) continue;
    const endAt = Number(inspection.studentZone?.endAt ?? inspection.endAt);
    if (!Number.isInteger(endAt)) continue;
    const bus = busKey(inspection.fleet ?? inspection.bus);
    if (!bus) continue;
    let chosen = null;
    let chosenIn = null;
    for (const run of runs || []) {
      if (busKey(run?.bus) !== bus || !studentRunPiece(run)) continue;
      const clockIn = minutesOf(run?.clockIn);
      if (clockIn == null || clockIn > endAt) continue;
      if (chosenIn == null || clockIn >= chosenIn) {
        chosen = run;
        chosenIn = clockIn;
      }
    }
    if (!chosen) continue;
    const key = yardDepartureKey(chosen);
    const prev = byKey.get(key);
    if (!prev || endAt < prev.endAt) byKey.set(key, { endAt });
  }
  return byKey;
}

export function studentCheckKey(alert) {
  return [alert?.bus, alert?.route, alert?.run, alert?.clockIn].map((part) => clean(part).toLowerCase()).join('|');
}

function studentCheckContext(context = {}) {
  const visits = new Set((context.visits || []).map((key) => String(key || '').toLowerCase()).filter(Boolean));
  const returns = new Map();
  for (const item of context.returns || []) {
    const key = String(item?.key || '').toLowerCase();
    const at = Number(item?.at);
    if (key && Number.isFinite(at)) returns.set(key, at);
  }
  const checks = context.checks instanceof Map ? context.checks : new Map();
  return { visits, returns, checks, inspectionsKnown: context.inspectionsKnown !== false };
}

// A route alerts after it has visited a school, come back to the yard, and
// waited out the grace with no completed Student Check. A check uploaded late
// still closes the alert. An unfinished inspection does not.
export function studentCheckAlerts(runs, nowMinutes, graceMinutes = 0, context = {}) {
  const grace = Number.isFinite(Number(graceMinutes)) ? Number(graceMinutes) : 0;
  const { visits, returns, checks, inspectionsKnown } = studentCheckContext(context);
  if (!inspectionsKnown) return [];
  const alerts = [];
  for (const run of runs || []) {
    const piece = studentRunPiece(run);
    const clockIn = minutesOf(run?.clockIn);
    if (!piece || clockIn == null || !busKey(run?.bus)) continue;
    const key = yardDepartureKey(run);
    if (!visits.has(key) || !returns.has(key)) continue;
    const returnedAt = returns.get(key);
    const due = returnedAt + grace;
    if (nowMinutes < due || checks.has(key)) continue;
    alerts.push({
      bus: clean(run.bus),
      route: clean(run.route),
      run: piece,
      driver: clean(run.driver),
      clockIn,
      returnedAt,
      due,
    });
  }
  return alerts.sort((a, b) => a.returnedAt - b.returnedAt || compareRoutes(a.route, b.route));
}

export function studentCheckPills(runs, nowMinutes, graceMinutes = 0, context = {}) {
  const grace = Number.isFinite(Number(graceMinutes)) ? Number(graceMinutes) : 0;
  const { visits, returns, checks, inspectionsKnown } = studentCheckContext(context);
  const quiet = new Set((context.acknowledged || []).map((key) => String(key || '')));
  return (runs || [])
    .map((run) => {
      const clockIn = minutesOf(run?.clockIn);
      const piece = studentRunPiece(run);
      const key = yardDepartureKey(run);
      const visited = visits.has(key);
      const returnedAt = returns.has(key) ? returns.get(key) : null;
      const check = checks.get(key);
      const due = returnedAt == null ? null : returnedAt + grace;
      let tone = 'neutral';
      if (check) tone = 'on';
      else if (busKey(run?.bus) && returnedAt != null && (nowMinutes < due || !inspectionsKnown)) tone = 'yellow';
      else if (busKey(run?.bus) && returnedAt != null && inspectionsKnown && nowMinutes >= due) tone = 'dark';
      const pill = {
        route: clean(run?.route),
        bus: clean(run?.bus),
        run: piece,
        driver: clean(run?.driver),
        photo: clean(run?.photo),
        clockIn,
        visited,
        returnedAt,
        due,
        checkedAt: check?.endAt ?? null,
        waitingOnZonar: Boolean(!check && returnedAt != null && !inspectionsKnown),
        tone,
      };
      if (pill.tone === 'dark' && quiet.has(studentCheckKey(pill))) pill.tone = 'held';
      return pill;
    })
    .filter((pill) => pill.run && pill.clockIn != null && nowMinutes >= pill.clockIn && (pill.route || pill.bus));
}

export function studentCheckPillFacts(pill, nowMinutes) {
  if (pill?.checkedAt != null) return [`Student Check at ${formatBoardClock(pill.checkedAt)}`];
  if (!clean(pill?.bus)) return ['No bus number'];
  if (pill?.returnedAt == null) {
    return pill?.visited ? ['Visited a school', 'Not back at the yard'] : ['No school visit yet'];
  }
  const back = `Back at ${formatBoardClock(pill.returnedAt)}`;
  if (pill.waitingOnZonar) return [back, 'Waiting for Zonar'];
  if (pill.tone === 'yellow' || pill.tone === 'on') {
    const left = Number.isInteger(nowMinutes) && pill.due != null ? Math.max(0, pill.due - nowMinutes) : null;
    const remain = left == null ? 'Waiting on the Student Check' : left === 1 ? '1 minute left' : `${left} minutes left`;
    return [back, remain];
  }
  return [back, 'No Student Check'];
}

export function studentCheckAlarmStatement(alert, graceMinutes = 0) {
  const who = clean(alert?.route) ? `Route ${clean(alert.route)}` : clean(alert?.bus) ? `Bus ${clean(alert.bus)}` : 'A route';
  const back = alert?.returnedAt == null ? '' : formatBoardClock(alert.returnedAt);
  const grace = Number.isFinite(Number(graceMinutes)) ? Math.max(0, Math.round(Number(graceMinutes))) : 0;
  const wait = grace === 1 ? '1 minute' : `${grace} minutes`;
  return `${who}, ${back ? `back at ${back}` : 'back at the yard'}, wait ${wait}.`;
}

// The run whose clock-out is the ordinary one right now: the run in progress,
// otherwise the next one, otherwise the one that most recently ended.
function ordinaryRun(runs, nowMinutes) {
  const timed = (runs || []).filter((run) => minutesOf(run?.clockIn) != null && minutesOf(run?.clockOut) != null);
  const active = timed.find((run) => minutesOf(run.clockIn) <= nowMinutes && nowMinutes < minutesOf(run.clockOut));
  if (active) return active;
  const upcoming = timed
    .filter((run) => minutesOf(run.clockIn) > nowMinutes)
    .sort((a, b) => minutesOf(a.clockIn) - minutesOf(b.clockIn))[0];
  if (upcoming) return upcoming;
  const past = timed
    .filter((run) => minutesOf(run.clockOut) <= nowMinutes)
    .sort((a, b) => minutesOf(b.clockOut) - minutesOf(a.clockOut))[0];
  return past || runs[0];
}

// Drivers who are available during the run in progress.
// "Empty" means this run is at the last school on its segment.
// "Back Early" means the bus then reached the yard more than earlyMinutes before clock-out.
export function availableDrivers(runs, nowMinutes, zones = [], schoolKeys = [], earlyMinutes = DEFAULT_EARLY_MINUTES, returns = []) {
  const zoneByBus = zonesByBus(zones);
  const schools = new Set((schoolKeys || []).map((key) => String(key || '').toLowerCase()));
  const backAt = new Map();
  for (const item of returns || []) {
    const key = String(item?.key || '').toLowerCase();
    const at = Number(item?.at);
    if (key && Number.isFinite(at)) backAt.set(key, at);
  }
  const early = normalizeEarlyMinutes(earlyMinutes);
  const byRoute = new Map();
  for (const run of runs || []) {
    const route = clean(run?.route);
    if (!route) continue;
    const key = route.toLowerCase();
    const list = byRoute.get(key) || [];
    list.push(run);
    byRoute.set(key, list);
  }
  const rows = [];
  for (const list of byRoute.values()) {
    const run = ordinaryRun(list, nowMinutes);
    const clockIn = minutesOf(run?.clockIn);
    const clockOut = minutesOf(run?.clockOut);
    const during = clockIn != null && clockOut != null && nowMinutes >= clockIn && nowMinutes < clockOut;
    if (!during) continue;
    const zone = zoneByBus.get(busKey(run?.bus));
    const inYard = Boolean(run?.inYard) || isYardZone(zone);
    const atLastSchool = schools.has(yardDepartureKey(run)) || isLastSchoolZone(zone, run);
    if (!atLastSchool) continue;
    const arrived = backAt.has(yardDepartureKey(run)) ? backAt.get(yardDepartureKey(run)) : nowMinutes;
    const status = inYard && clockOut - arrived > early ? 'Back Early' : inYard ? '' : 'Empty';
    if (!status) continue;
    rows.push({
      route: clean(run.route),
      driver: clean(run.driver) || 'OPEN',
      bus: clean(run.bus),
      clockOut,
      status,
    });
  }
  return rows.sort((a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }));
}

export function lookupStudents(roster, query) {
  const needle = normalizeStudentName(query).toLowerCase();
  if (!needle) return [];
  return (roster || [])
    .filter((student) => normalizeStudentName(student?.name).toLowerCase().includes(needle))
    .map((student) => ({
      name: normalizeStudentName(student.name),
      route: clean(student.route),
    }))
    .filter((student) => student.name && student.route)
    .sort((a, b) => a.name.localeCompare(b.name) || a.route.localeCompare(b.route, undefined, { numeric: true }));
}

export function rememberStudent(roster, student) {
  const name = normalizeStudentName(student?.name);
  const route = clean(student?.route);
  if (!name || !route) {
    throw new Error('A student needs a name and a route.');
  }
  const key = `${name.toLowerCase()}|${route.toLowerCase()}`;
  const next = (roster || []).filter((item) => {
    const itemKey = `${normalizeStudentName(item?.name).toLowerCase()}|${clean(item?.route).toLowerCase()}`;
    return itemKey !== key;
  });
  next.push({ name, route });
  next.sort((a, b) => a.name.localeCompare(b.name) || a.route.localeCompare(b.route, undefined, { numeric: true }));
  return next;
}

export function rememberedNames(roster) {
  const names = new Set();
  for (const student of roster || []) {
    const name = normalizeStudentName(student?.name);
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

const ABSENCE_PERIODS = ['AM', 'MID', 'PM'];

// AM, mid day, and PM. "Both" is the morning and the afternoon, not mid day.
export function absencePortions(value) {
  const found = [];
  const take = (token) => {
    if (token === 'am' || token === 'morning') found.push('AM');
    else if (token === 'pm' || token === 'afternoon') found.push('PM');
    else if (token === 'mid' || token === 'midday') found.push('MID');
    else if (token === 'both') found.push('AM', 'PM');
    else if (token === 'all') found.push('AM', 'MID', 'PM');
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      for (const part of absencePortions(item)) {
        if (!found.includes(part)) found.push(part);
      }
    }
  } else {
    const text = clean(value).toLowerCase();
    if (text) {
      for (const token of text.split(/[^a-z]+/)) take(token);
    }
  }
  return ABSENCE_PERIODS.filter((part) => found.includes(part));
}

export function absenceWhenValue(value) {
  const parts = absencePortions(value);
  if (parts.length === 2 && parts[0] === 'AM' && parts[1] === 'PM') return 'BOTH';
  return parts.join(',');
}

export function normalizeAbsenceWhen(value) {
  return absenceWhenValue(value);
}

function portionLabel(portion) {
  return portion === 'MID' ? 'mid day' : portion;
}

export function absenceDay(value) {
  const text = clean(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return text;
}

export function toggleAbsenceDay(days, day) {
  const valid = absenceDay(day);
  const next = [...new Set((days || []).map(absenceDay).filter(Boolean))];
  if (!valid) return next.sort();
  const index = next.indexOf(valid);
  if (index >= 0) next.splice(index, 1);
  else next.push(valid);
  return next.sort();
}

export function absenceDayLabel(count) {
  const total = Number(count) || 0;
  return total === 1 ? '1 day' : `${total} days`;
}

export function calendarCells(year, month, selected) {
  const picked = new Set((selected || []).map(absenceDay).filter(Boolean));
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const iso = boardDate(date);
    cells.push({
      date: iso,
      day: date.getDate(),
      inMonth: date.getMonth() === month,
      selected: picked.has(iso),
    });
  }
  return cells;
}

function absenceDayPlan(dates, when, days) {
  const plan = Array.isArray(days)
    ? days
        .map((item) => ({ date: absenceDay(item?.date), when: item?.when ?? when }))
        .filter((item) => item.date)
    : [...new Set((dates || []).map(absenceDay).filter(Boolean))].map((date) => ({ date, when }));
  plan.sort((a, b) => a.date.localeCompare(b.date));
  return plan;
}

export function absenceKind(value) {
  return clean(value).toLowerCase() === 'note' ? 'note' : 'student';
}

function sameAbsencePerson(item, name, route, kind) {
  return (
    normalizeStudentName(item?.name).toLowerCase() === normalizeStudentName(name).toLowerCase() &&
    routeKey(item?.route) === routeKey(route) &&
    absenceKind(item?.kind) === absenceKind(kind)
  );
}

export function postAbsenceDays(absences, { name, route, dates, when, days, kind }) {
  const plan = absenceDayPlan(dates, when, days);
  if (!plan.length) throw new Error('Choose at least one day.');
  return plan.reduce(
    (list, item) => postAbsence(list, { name, route, date: item.date, when: item.when, kind }),
    absences || []
  );
}

export function absenceSchedule(absences, { name, route, kind }) {
  const student = normalizeStudentName(name).toLowerCase();
  const key = routeKey(route);
  if (!student || !key) return [];
  return (absences || [])
    .filter((item) => sameAbsencePerson(item, name, route, kind))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.when).localeCompare(String(b.when)));
}

// Every day this name is posted, on every route. A note stays separate from a student.
export function absenceSchedules(absences, { name, kind }) {
  const student = normalizeStudentName(name).toLowerCase();
  if (!student) return [];
  const entry = absenceKind(kind);
  return (absences || [])
    .filter((item) => normalizeStudentName(item?.name).toLowerCase() === student && absenceKind(item?.kind) === entry)
    .sort(
      (a, b) =>
        String(a.date).localeCompare(String(b.date)) || routeKey(a.route).localeCompare(routeKey(b.route), undefined, { numeric: true })
    );
}

// The checked days become this name's schedule on the route. An empty list takes every day off.
export function replaceAbsenceSchedule(absences, { name, route, dates, when, days, previousName, previousRoute, kind, previousKind }) {
  const oldName = normalizeStudentName(previousName || name).toLowerCase();
  const oldRoute = routeKey(previousRoute || route);
  const oldKind = absenceKind(previousKind ?? kind);
  if (!oldName || !oldRoute) {
    throw new Error(oldKind === 'note' ? 'Write a note for a route.' : 'Choose a student on a route.');
  }
  const kept = (absences || []).filter((item) => !sameAbsencePerson(item, previousName || name, previousRoute || route, oldKind));
  const plan = absenceDayPlan(dates, when, days);
  if (!plan.length) return kept;
  return postAbsenceDays(kept, { name, route, days: plan, kind: kind ?? previousKind });
}

export function postAbsence(absences, { name, route, date, when, kind }) {
  const student = normalizeStudentName(name);
  const routeName = clean(route);
  const day = clean(date);
  const entry = absenceKind(kind);
  const portion = when == null || (typeof when !== 'object' && clean(when) === '') ? 'BOTH' : normalizeAbsenceWhen(when);
  if (!student || !routeName || !day) {
    throw new Error(entry === 'note' ? 'Write a note for a route.' : 'Choose a student on a route.');
  }
  if (!portion) throw new Error('Choose AM, mid day, or PM.');
  const id =
    entry === 'note'
      ? `${day}|note|${student.toLowerCase()}|${routeName.toLowerCase()}`
      : `${day}|${student.toLowerCase()}|${routeName.toLowerCase()}`;
  const list = Array.isArray(absences) ? absences : [];
  const existing = list.find((item) => item.id === id);
  const next = list.filter((item) => item.id !== id);
  const record = { id, name: existing?.name || student, route: routeName, date: day, when: portion };
  if (entry === 'note') record.kind = 'note';
  next.push(record);
  return next;
}

export function removeAbsence(absences, id) {
  return (absences || []).filter((item) => item.id !== id);
}

// Take a name off one part of the day. The other parts of that absence stay up.
export function removeAbsencePortion(absences, { name, route, portion, kind }) {
  const student = normalizeStudentName(name).toLowerCase();
  const key = routeKey(route);
  const side = absencePortions(portion)[0];
  if (!student || !key || !side) return absences || [];
  return (absences || []).flatMap((item) => {
    const same = sameAbsencePerson(item, name, route, kind);
    if (!same) return [item];
    const held = absencePortions(item?.when);
    const left = (held.length ? held : ['AM', 'PM']).filter((part) => part !== side);
    if (!left.length) return [];
    return [{ ...item, when: absenceWhenValue(left) }];
  });
}

export function absencesForDate(absences, date) {
  return (absences || [])
    .filter((item) => item.date === date)
    .sort((a, b) => a.name.localeCompare(b.name) || a.route.localeCompare(b.route, undefined, { numeric: true }));
}

function routeLabel(route) {
  return clean(route).replace(/\s+/g, ' ');
}

function routeKey(route) {
  return routeLabel(route).toLowerCase();
}

function compareRoutes(a, b) {
  return routeLabel(a).localeCompare(routeLabel(b), undefined, { numeric: true, sensitivity: 'base' });
}

// SPED route numbers begin with "S-". The yard also files them as "S 01" and "S1".
// A school code that merely starts with S, such as SHS, is not a route number.
export function isSpedRoute(route) {
  return /^s(?:-|\s+\d|\d)/i.test(routeLabel(route));
}

function routeNameOf(route) {
  if (typeof route === 'string') return routeLabel(route);
  return routeLabel(route?.name ?? route?.route);
}

function routeOrdinal(route) {
  const match = routeLabel(route).match(/(\d+)\s*$/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function compareAbsentRoutes(a, b) {
  const aNumber = routeOrdinal(a);
  const bNumber = routeOrdinal(b);
  if (aNumber != null && bNumber != null && aNumber !== bNumber) return aNumber - bNumber;
  if (aNumber != null && bNumber == null) return -1;
  if (aNumber == null && bNumber != null) return 1;
  return compareRoutes(a, b);
}

// The board shows the route's numerals. "S 01" and "S-01" both read as 01.
export function absentRouteNumber(route) {
  const label = routeLabel(route);
  const sped = label.match(/^s(?:-|\s+)?(\d+)$/i);
  if (sped) return sped[1];
  return label;
}

// Twenty-four light colors, one per route number. Neighbors down a column and across
// the two columns sit in different families, and a route keeps its color forever.
const ABSENT_ROUTE_PAINT = [
  ['#d7f5df', '#5eae78'],
  ['#d7e4fb', '#5e86c4'],
  ['#fbf3d4', '#c2ae5a'],
  ['#f8d7ea', '#c45e96'],
  ['#d7f6f2', '#4eaea0'],
  ['#fde2d4', '#d4845e'],
  ['#e4dcfb', '#8a74c4'],
  ['#f7f0c8', '#c2ae4e'],
  ['#f8d7d7', '#c45e5e'],
  ['#e5f6d4', '#78b44e'],
  ['#dce7f8', '#6e8ec4'],
  ['#fbe8d4', '#c49a5e'],
  ['#eadcf8', '#a06ec4'],
  ['#d4f3e4', '#4eae78'],
  ['#f8e0d4', '#c4845e'],
  ['#d7eef8', '#5e9ec4'],
  ['#f8f0d4', '#c4b45e'],
  ['#f3d7e8', '#c45e8a'],
  ['#d7f5ea', '#4eae96'],
  ['#e8dcf8', '#946ec4'],
  ['#f8e8d4', '#c4a46e'],
  ['#d7f8e0', '#5ec47a'],
  ['#f8dce4', '#c46e88'],
  ['#dceaf8', '#5e96c4'],
];

function absentRoutePaintIndex(route) {
  const ordinal = routeOrdinal(route);
  if (ordinal != null) return (ordinal - 1) % ABSENT_ROUTE_PAINT.length;
  let seed = 0;
  for (const char of routeLabel(route).toLowerCase()) seed = (seed * 33 + char.charCodeAt(0)) % ABSENT_ROUTE_PAINT.length;
  return seed;
}

export function absentRouteColor(route) {
  return ABSENT_ROUTE_PAINT[absentRoutePaintIndex(route)][0];
}

export function absentRouteBorder(route) {
  return ABSENT_ROUTE_PAINT[absentRoutePaintIndex(route)][1];
}

function sameNumber(left, right) {
  const a = clean(left).replace(/^0+/, '') || '0';
  const b = clean(right).replace(/^0+/, '') || '0';
  return a.toLowerCase() === b.toLowerCase();
}

export function matchBoardRoute(routes, typed) {
  const text = routeLabel(typed);
  if (!text) return '';
  const names = (routes || []).map(routeNameOf).filter(Boolean);
  const exact = names.find((name) => name.toLowerCase() === text.toLowerCase());
  if (exact) return exact;
  const ordinal = routeOrdinal(text.replace(/^s(?:-|\s+)?/i, '')) ?? routeOrdinal(text);
  if (ordinal == null) return '';
  const hits = names.filter((name) => routeOrdinal(name) === ordinal);
  const sped = hits.filter((name) => isSpedRoute(name));
  if (sped.length === 1) return sped[0];
  if (hits.length === 1) return hits[0];
  return '';
}

function postsForBus(routes, buses, typed, portions) {
  const hits = (buses || []).filter((row) => sameNumber(row?.bus, typed) && clean(row?.route));
  if (!hits.length) throw new Error('That bus is not on a route.');
  const wants = absencePortions(portions);
  const unique = (rows) => [
    ...new Set(rows.map((row) => matchBoardRoute(routes, row.route) || routeLabel(row.route))),
  ];
  const named = (row) => (row ? matchBoardRoute(routes, row.route) || routeLabel(row.route) : '');
  const byRoute = new Map();
  const add = (route, portion) => {
    const key = routeKey(route);
    if (!key) return;
    let post = byRoute.get(key);
    if (!post) {
      post = { route, portions: [] };
      byRoute.set(key, post);
    }
    if (!post.portions.includes(portion)) post.portions.push(portion);
  };
  const morningAndAfternoon = wants.length === 2 && wants[0] === 'AM' && wants[1] === 'PM';
  if (morningAndAfternoon) {
    const names = unique(hits);
    if (names.length === 1) return [{ route: names[0], when: 'BOTH' }];
    const am = hits.find((row) => clean(row.run).toUpperCase() === 'AM');
    const pm = hits.find((row) => clean(row.run).toUpperCase() === 'PM');
    if (am) add(named(am), 'AM');
    if (pm) add(named(pm), 'PM');
    if (!byRoute.size) throw new Error('That bus is on more than one route. Type the route number.');
    return [...byRoute.values()].map((post) => ({ route: post.route, when: absenceWhenValue(post.portions) }));
  }
  for (const portion of wants) {
    const runHits = hits.filter((row) => {
      const run = clean(row.run).toUpperCase();
      return run === portion || !run;
    });
    const names = unique(runHits);
    if (names.length === 1) add(names[0], portion);
    else if (!names.length) throw new Error(`That bus is not on a ${portionLabel(portion)} route.`);
    else throw new Error(`That bus is not on one ${portionLabel(portion)} route. Type the route number.`);
  }
  return [...byRoute.values()].map((post) => ({ route: post.route, when: absenceWhenValue(post.portions) }));
}

function busNumberKey(bus) {
  return clean(bus).replace(/^0+/, '') || '0';
}

// A typed "5" can mean the catalog route "S 05". A stored regular "1" is not "S 01".
function sameAbsenceRoute(routes, typed, stored) {
  const typedLabel = routeLabel(typed);
  const storedLabel = routeLabel(stored);
  if (!typedLabel || !storedLabel) return false;
  if (routeKey(typedLabel) === routeKey(storedLabel)) return true;
  const typedOrdinal = routeOrdinal(typedLabel);
  const storedOrdinal = routeOrdinal(storedLabel);
  if (
    isSpedRoute(typedLabel) === isSpedRoute(storedLabel) &&
    typedOrdinal != null &&
    typedOrdinal === storedOrdinal
  ) {
    return true;
  }
  const canonical = matchBoardRoute(routes, typedLabel);
  const storedCanonical = matchBoardRoute(routes, storedLabel);
  if (!canonical || !storedCanonical || routeKey(canonical) !== routeKey(storedCanonical)) return false;
  return routeKey(storedLabel) === routeKey(canonical);
}

// The bus that runs this route, when every run uses that same bus.
export function pairedAbsenceBus(routes, buses, route) {
  if (!routeLabel(route)) return '';
  const found = [];
  const seen = new Set();
  for (const row of buses || []) {
    const bus = clean(row?.bus);
    if (!bus || !sameAbsenceRoute(routes, route, row?.route)) continue;
    const key = busNumberKey(bus);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(bus);
  }
  return found.length === 1 ? found[0] : '';
}

// The route written on this bus, when that bus is posted on one route.
export function pairedAbsenceRoute(routes, buses, bus) {
  const typed = clean(bus);
  if (!typed) return '';
  const names = [];
  for (const row of buses || []) {
    if (!sameNumber(row?.bus, typed)) continue;
    const route = routeLabel(row?.route);
    if (!route || names.some((name) => routeKey(name) === routeKey(route))) continue;
    names.push(route);
  }
  return names.length === 1 ? names[0] : '';
}

// Route and bus are separate. A route number posts on that route.
// A bus number is translated to the route that bus is running.
export function resolveAbsenceRoute(routes, buses, input, when) {
  const portions = absencePortions(when);
  if (!portions.length) throw new Error('Choose AM, mid day, or PM.');
  const source = input && typeof input === 'object' ? input : {};
  const routeTyped = routeLabel(source.route);
  const busTyped = clean(source.bus);
  if (!routeTyped && !busTyped) throw new Error('Type a route number or a bus number.');
  const storedRoute = (buses || [])
    .map((row) => routeLabel(row?.route))
    .find((stored) => stored && routeKey(stored) === routeKey(routeTyped));
  const fromRoute = routeTyped ? storedRoute || matchBoardRoute(routes, routeTyped) : '';
  if (routeTyped && !fromRoute) throw new Error('That route is not on the board.');
  if (!busTyped) return [{ route: fromRoute, when: absenceWhenValue(portions) }];
  const busOnRoute = (buses || []).some((row) => {
    if (!sameNumber(row?.bus, busTyped) || routeKey(row?.route) !== routeKey(fromRoute)) return false;
    const run = clean(row?.run).toUpperCase();
    return !run || portions.includes(run);
  });
  if (routeTyped && busOnRoute) return [{ route: fromRoute, when: absenceWhenValue(portions) }];
  const fromBus = postsForBus(routes, buses, busTyped, portions);
  if (!routeTyped) return fromBus;
  const agrees = fromBus.some((post) => routeKey(post.route) === routeKey(fromRoute));
  if (!agrees) throw new Error('That bus is not on that route.');
  return [{ route: fromRoute, when: absenceWhenValue(portions) }];
}

// Each part of the day carries its own bus or route. Parts that land on one route are combined.
export function absencePortionPosts(routes, buses, rows, when) {
  const wanted = absencePortions(when);
  if (!wanted.length) throw new Error('Choose AM, mid day, or PM.');
  const byPortion = new Map();
  for (const row of rows || []) {
    const portion = absencePortions(row?.portion)[0];
    if (portion) byPortion.set(portion, row);
  }
  const grouped = new Map();
  for (const portion of wanted) {
    const row = byPortion.get(portion);
    const route = routeLabel(row?.route);
    const bus = clean(row?.bus);
    if (!route && !bus) throw new Error(`Choose a bus or route for ${portionLabel(portion)}.`);
    const posts = resolveAbsenceRoute(routes, buses, { route, bus }, portion);
    for (const post of posts) {
      const parts = grouped.get(post.route) || [];
      for (const part of absencePortions(post.when)) {
        if (!parts.includes(part)) parts.push(part);
      }
      grouped.set(post.route, parts);
    }
  }
  return [...grouped.entries()].map(([route, parts]) => ({ route, when: absenceWhenValue(parts) }));
}

// A route appears only when it has an absent student. The list is numerical.
export function absentRouteGroups(absences) {
  const byRoute = new Map();
  for (const item of absences || []) {
    const route = routeNameOf(item?.route);
    const name = normalizeStudentName(item?.name);
    if (!route || !name) continue;
    const key = routeKey(route);
    let group = byRoute.get(key);
    if (!group) {
      group = { route, sped: isSpedRoute(route), students: [] };
      byRoute.set(key, group);
    }
    group.students.push({
      id: item.id,
      name,
      route: group.route,
      when: normalizeAbsenceWhen(item?.when) || 'BOTH',
      kind: absenceKind(item?.kind),
    });
  }

  for (const group of byRoute.values()) {
    group.students.sort((a, b) => {
      const notes = (a.kind === 'note' ? 1 : 0) - (b.kind === 'note' ? 1 : 0);
      if (notes) return notes;
      return a.name.localeCompare(b.name);
    });
  }
  return [...byRoute.values()].sort((a, b) => compareAbsentRoutes(a.route, b.route));
}

// Routes with an absence read left to right, then down, in numerical order.
export function absentColumns(absences, routes) {
  const groups = absentRouteGroups(absences, routes);
  if (!groups.length) return { columns: [], lines: 0 };
  const columnCount = groups.length === 1 ? 1 : 2;
  const columns = Array.from({ length: columnCount }, (_, index) => ({
    routes: groups.filter((_, routeIndex) => routeIndex % columnCount === index),
  }));
  const lines = Math.max(...columns.map((column) => column.routes.length));
  return { columns, lines };
}

function runLabel(run) {
  return clean(run);
}

const PORTION_RUNS = ['AM', 'MID', 'PM'];

function portionRun(value) {
  const text = clean(value).toLowerCase();
  if (!text) return '';
  if (text.startsWith('am')) return 'AM';
  if (text.startsWith('pm')) return 'PM';
  if (text.startsWith('mid')) return 'MID';
  return '';
}

function hasPortionSpares(row) {
  return Boolean(row?.spares && typeof row.spares === 'object' && !Array.isArray(row.spares));
}

export function portionSpareMap(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    AM: clean(source.AM),
    MID: clean(source.MID),
    PM: clean(source.PM),
  };
}

export function portionSpareDays(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [day, map] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    out[day] = portionSpareMap(map);
  }
  return out;
}

function sharedSpare(map) {
  const spares = portionSpareMap(map);
  const same = PORTION_RUNS.every((run) => busKey(spares[run]) === busKey(spares.AM));
  return same ? spares.AM : '';
}

// null means that part of the day is not out. A blank string is out with no spare.
export function spareForPortion(row, run, date = '') {
  const portion = portionRun(run);
  if (!portion || !row) return null;
  if (hasPortionSpares(row)) {
    const days = row.days && typeof row.days === 'object' ? row.days : null;
    const day = date && days?.[date] && typeof days[date] === 'object' ? days[date] : null;
    if (day) return clean(day[portion]);
    return clean(row.spares?.[portion]);
  }
  const limited = portionRun(row.run);
  if (limited && limited !== portion) return null;
  return clean(row.spareBus);
}

function patternSpare(row, portion) {
  return spareForPortion(row, portion, '');
}

function portionDayLabel(day) {
  const [year, month, date] = String(day || '').split('-').map(Number);
  if (!year || !month || !date) return clean(day);
  return new Date(year, month - 1, date).toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

function outOfServiceId(route, run, usualBus) {
  const piece = clean(run).toLowerCase();
  if (clean(route)) return [clean(route).toLowerCase(), piece].filter(Boolean).join('|');
  return ['bus', clean(usualBus).toLowerCase(), piece].filter(Boolean).join('|');
}

function sortOutOfService(list) {
  return list.sort(
    (a, b) =>
      a.route.localeCompare(b.route, undefined, { numeric: true }) ||
      a.usualBus.localeCompare(b.usualBus, undefined, { numeric: true })
  );
}

function addPortionOutOfService(list, entry) {
  const route = clean(entry?.route);
  const usualBus = clean(entry?.usualBus);
  if (!usualBus) throw new Error('Enter the usual bus.');
  const spares = portionSpareMap(entry?.spares);
  const days = portionSpareDays(entry?.days);
  const note = clean(entry?.note);
  const covers = spareCovers(entry) || '';
  const id = outOfServiceId(route, '', usualBus);
  const replaceId = clean(entry?.replaceId);
  const next = (list || []).filter((item) => {
    if (item.id === id || (replaceId && item.id === replaceId)) return false;
    if (busKey(item.usualBus) !== busKey(usualBus)) return true;
    if (route && clean(item.route) && clean(item.route).toLowerCase() !== route.toLowerCase()) return true;
    return false;
  });
  next.push({
    id,
    route,
    run: '',
    usualBus,
    spareBus: sharedSpare(spares),
    note,
    covers,
    spares,
    ...(Object.keys(days).length ? { days } : {}),
  });
  return sortOutOfService(next);
}

export function addOutOfService(list, entry) {
  if (entry?.spares && typeof entry.spares === 'object') return addPortionOutOfService(list, entry);
  const route = clean(entry?.route);
  const usualBus = clean(entry?.usualBus);
  const spareBus = clean(entry?.spareBus);
  const note = clean(entry?.note);
  const run = normalizeRun(entry?.run);
  if (!usualBus || !spareBus) {
    throw new Error('Enter the usual bus and the spare that replaces it.');
  }
  const id = outOfServiceId(route, run, usualBus);
  const covers = spareCovers(entry) || '';
  const next = (list || []).filter((item) => item.id !== id);
  next.push({ id, route, run, usualBus, spareBus, note, covers });
  return sortOutOfService(next);
}

export function removeOutOfService(list, id) {
  return (list || []).filter((item) => item.id !== id);
}

function normalizeRun(value) {
  const text = clean(value).toLowerCase();
  if (!text) return '';
  if (text.startsWith('am')) return 'AM';
  if (text.startsWith('pm')) return 'PM';
  if (text.startsWith('mid')) return 'MID';
  throw new Error('The run should be AM, MID, or PM.');
}

function pairingKey(route, bus, run) {
  const piece = clean(run).toLowerCase();
  if (clean(route)) return `route|${clean(route).toLowerCase()}|${piece}`;
  return `bus|${clean(bus).toLowerCase()}|${piece}`;
}

function sortPairings(list) {
  return list.sort((a, b) => {
    const aStart = minutesOf(a.clockIn);
    const bStart = minutesOf(b.clockIn);
    if (aStart == null && bStart == null) return compareRoutes(a.route, b.route);
    if (aStart == null) return 1;
    if (bStart == null) return -1;
    const start = aStart - bStart;
    if (start) return start;
    return a.bus.localeCompare(b.bus, undefined, { numeric: true }) || compareRoutes(a.route, b.route);
  });
}

// A pairing is the bus Dark Bus watches, and the time it usually starts.
// The route is optional until the posted sheet is copied in.
// One route run has one bus. A bus with no route has one start per run.
export function savePairing(list, entry) {
  const bus = clean(entry?.bus);
  const route = clean(entry?.route);
  const run = normalizeRun(entry?.run);
  const clockIn = clockInputValue(entry?.clockIn);
  if (!bus) throw new Error('A bus number is required.');
  if (!clockIn) throw new Error('A start time is required.');
  const clockOutText = clean(entry?.clockOut);
  const clockOut = clockOutText ? clockInputValue(clockOutText) : '';
  if (clockOutText && !clockOut) throw new Error('Clock-out needs a time like 8:45.');
  const id = pairingKey(route, bus, run);
  const previous = clean(entry?.id);
  let next = (list || []).filter((item) => item.id !== id && item.id !== previous);
  if (route) {
    next = next.filter((item) => item.id !== pairingKey('', bus, run));
  }
  next.push({ id, bus, route, run, clockIn, clockOut });
  return sortPairings(next);
}

export function removePairing(list, id) {
  return (list || []).filter((item) => item.id !== id);
}

// A posted route assignment. The clock-in comes from that route's saved schedule.
export function saveRouteBus(list, entry) {
  const route = clean(entry?.route);
  const run = normalizeRun(entry?.run);
  if (!route) throw new Error('Pick a route.');
  if (!run) throw new Error('Pick AM, MID, or PM.');
  return savePairing(list, { ...entry, route, run });
}

// The posted sheet names the bus, but this route has no saved clock yet.
// It stays on the list and does not raise a dark-bus alert.
export function savePostedBus(list, entry) {
  const route = clean(entry?.route);
  const bus = clean(entry?.bus);
  if (!route) throw new Error('Pick a route.');
  if (!bus) throw new Error('A bus number is required.');
  if ((list || []).some((item) => clean(item.route).toLowerCase() === route.toLowerCase())) return list;
  const next = [...(list || []), { id: pairingKey(route, bus, ''), bus, route, run: '', clockIn: '', clockOut: '' }];
  return sortPairings(next);
}

const SHEET_RUNS = ['AM', 'MID', 'PM'];

function pairingForRun(saved, route, run) {
  const key = routeKey(route);
  const piece = clean(run).toUpperCase();
  return (saved || []).find((row) => routeKey(row.route) === key && clean(row.run).toUpperCase() === piece);
}

function postedBusRow(saved, route) {
  const key = routeKey(route);
  return (saved || []).find((row) => routeKey(row.route) === key && !clean(row.run));
}

// Every route the yard posts, with the bus on each run. A run with no bus of
// its own shows the posted bus so the sheet matches the hallway list.
export function routeBusSheet(saved, routeNames = [], wheelchairs = {}) {
  const names = new Map();
  for (const name of routeNames || []) {
    const route = routeLabel(name);
    if (route) names.set(routeKey(route), route);
  }
  for (const row of saved || []) {
    const route = routeLabel(row.route);
    if (route && !names.has(routeKey(route))) names.set(routeKey(route), route);
  }
  return [...names.values()].sort(compareRoutes).map((route) => {
    const posted = clean(postedBusRow(saved, route)?.bus);
    const buses = {};
    const clocks = {};
    for (const run of SHEET_RUNS) {
      const row = pairingForRun(saved, route, run);
      buses[run] = row ? clean(row.bus) : posted;
      clocks[run] = row?.clockIn ? clockInputValue(row.clockIn) : '';
    }
    const needed = routeWheelchairNeed(wheelchairs, route);
    return { route, buses, clocks, wheelchairs: needed || '' };
  });
}

export function routeBusSheetMarkup(rows) {
  if (!rows?.length) return '<p class="board-empty">No routes yet.</p>';
  const body = rows
    .map((row) => {
      const cells = SHEET_RUNS.map((run) => {
        const bus = row.buses?.[run] || '';
        const clock = row.clocks?.[run] || '';
        const [hour, minute] = clock.split(':').map(Number);
        const clockText = Number.isInteger(hour) && Number.isInteger(minute) ? formatBoardClock(hour * 60 + minute) : '—';
        return `<td><input data-route="${escapeHtml(row.route)}" data-run="${run}" data-field="bus" data-original="${escapeHtml(bus)}" value="${escapeHtml(bus)}" inputmode="numeric" autocomplete="off" aria-label="Route ${escapeHtml(row.route)} ${run} bus" /></td><td class="board-route-clock" aria-label="Route ${escapeHtml(row.route)} ${run} clock-in">${escapeHtml(clockText)}</td>`;
      }).join('');
      const chairs = row.wheelchairs ? String(row.wheelchairs) : '';
      const chairCell = `<td><input data-route="${escapeHtml(row.route)}" data-field="wheelchairs" value="${escapeHtml(chairs)}" type="number" min="1" max="20" step="1" inputmode="numeric" aria-label="Route ${escapeHtml(row.route)} wheelchairs" /></td>`;
      return `<tr><th scope="row">${escapeHtml(row.route)}</th>${cells}${chairCell}</tr>`;
    })
    .join('');
  return `<table class="board-route-sheet"><thead><tr><th scope="col">Route</th><th scope="col">AM bus</th><th scope="col">AM clock-in</th><th scope="col">MID bus</th><th scope="col">MID clock-in</th><th scope="col">PM bus</th><th scope="col">PM clock-in</th><th scope="col">Wheelchairs</th></tr></thead><tbody>${body}</tbody></table>`;
}

// One row per route run that Time Changes has a clock for, or that already has
// a bus. The clock-out is Time Changes when that run has one. The bus is the
// number Zonar watches. A run with no bus of its own shows the posted bus.
export function availableBusSheet(saved, schedules = []) {
  const clocks = new Map();
  for (const schedule of schedules || []) {
    const route = routeLabel(schedule?.route);
    if (!route) continue;
    const key = routeKey(route);
    if (!clocks.has(key)) clocks.set(key, { route, byRun: new Map() });
    const entry = clocks.get(key);
    for (const run of schedule?.runs || []) {
      let piece = '';
      try {
        piece = normalizeRun(run?.run);
      } catch {
        piece = '';
      }
      if (!SHEET_RUNS.includes(piece)) continue;
      const clockIn = clockInputValue(run?.clockIn);
      const clockOut = clockInputValue(run?.clockOut);
      if (!clockIn && !clockOut) continue;
      entry.byRun.set(piece, { clockIn, clockOut });
    }
  }

  const routes = new Map();
  for (const [key, entry] of clocks) routes.set(key, entry.route);
  for (const row of saved || []) {
    const route = routeLabel(row?.route);
    if (route && !routes.has(routeKey(route))) routes.set(routeKey(route), route);
  }

  const rows = [];
  for (const route of [...routes.values()].sort(compareRoutes)) {
    const byRun = clocks.get(routeKey(route))?.byRun || new Map();
    const posted = clean(postedBusRow(saved, route)?.bus);
    for (const run of SHEET_RUNS) {
      const choice = byRun.get(run);
      const pairing = pairingForRun(saved, route, run);
      if (!choice && !pairing) continue;
      const clockOut = choice?.clockOut || (pairing?.clockOut ? clockInputValue(pairing.clockOut) : '');
      rows.push({
        route,
        run,
        bus: pairing ? clean(pairing.bus) : posted,
        clockOut,
      });
    }
  }
  return rows;
}

export function availableBusSheetMarkup(rows) {
  if (!rows?.length) return '<p class="board-empty">No route clock-outs yet.</p>';
  const body = rows
    .map((row) => {
      const minutes = minutesOf(row.clockOut);
      const clock = minutes == null ? '—' : formatBoardClock(minutes);
      const bus = row.bus || '';
      return `<tr><th scope="row">${escapeHtml(row.route)}</th><td>${escapeHtml(row.run)}</td><td>${escapeHtml(clock)}</td><td><input data-route="${escapeHtml(row.route)}" data-run="${escapeHtml(row.run)}" data-original="${escapeHtml(bus)}" value="${escapeHtml(bus)}" inputmode="numeric" autocomplete="off" aria-label="Bus for route ${escapeHtml(row.route)} ${escapeHtml(row.run)}" /></td></tr>`;
    })
    .join('');
  return `<table class="board-route-sheet board-available-sheet"><thead><tr><th scope="col">Route</th><th scope="col">Run</th><th scope="col">Clock out</th><th scope="col">Bus</th></tr></thead><tbody>${body}</tbody></table>`;
}

function clocksForRun(clocksFor, route, run) {
  const clocks = typeof clocksFor === 'function' ? clocksFor(route) : [];
  const choice = (clocks || []).find((item) => clean(item?.run).toUpperCase() === run);
  return {
    clockIn: clockInputValue(choice?.clockIn),
    clockOut: choice?.clockOut ? clockInputValue(choice.clockOut) : '',
  };
}

// assignments are the three run cells for each route the yard changed.
// An empty cell takes that run off the bus. A route that still has only the
// posted bus keeps that one number until a run gets its own clock.
export function assignRouteBuses(list, assignments, clocksFor) {
  let next = Array.isArray(list) ? [...list] : [];
  const skipped = [];
  const groups = new Map();
  for (const assignment of assignments || []) {
    const route = routeLabel(assignment?.route);
    if (!route) continue;
    let run = '';
    try {
      run = normalizeRun(assignment?.run);
    } catch {
      skipped.push(route);
      continue;
    }
    if (!SHEET_RUNS.includes(run)) {
      skipped.push(`${route} ${run || 'run'}`.trim());
      continue;
    }
    const key = routeKey(route);
    if (!groups.has(key)) groups.set(key, { route, runs: [] });
    const runAssignment = { run, bus: clean(assignment?.bus) };
    if (assignment?.clockIn != null) runAssignment.clockIn = assignment.clockIn;
    groups.get(key).runs.push(runAssignment);
  }

  for (const group of groups.values()) {
    const missed = [];
    let wrote = false;
    for (const assignment of group.runs) {
      const existing = pairingForRun(next, group.route, assignment.run);
      if (!assignment.bus) {
        if (existing) next = removePairing(next, existing.id);
        continue;
      }
      const manualClock = assignment.clockIn != null;
      let clockIn = '';
      let clockOut = existing?.clockOut ? clockInputValue(existing.clockOut) : '';
      if (manualClock) {
        if (clean(assignment.clockIn) && !clockInputValue(assignment.clockIn)) {
          missed.push(`${group.route} ${assignment.run}`);
          continue;
        }
        clockIn = clockInputValue(assignment.clockIn);
      } else {
        clockIn = existing?.clockIn ? clockInputValue(existing.clockIn) : '';
        if (!clockIn) {
          const choice = clocksForRun(clocksFor, group.route, assignment.run);
          clockIn = choice.clockIn;
          clockOut = choice.clockOut;
        }
      }
      if (!clockIn) {
        if (existing && manualClock) next = removePairing(next, existing.id);
        else if (!manualClock) missed.push(`${group.route} ${assignment.run}`);
        continue;
      }
      const sameClockOut = (existing?.clockOut ? clockInputValue(existing.clockOut) : '') === clockOut;
      if (
        existing &&
        clean(existing.bus) === assignment.bus &&
        clockInputValue(existing.clockIn) === clockIn &&
        sameClockOut
      ) {
        wrote = true;
        continue;
      }
      next = saveRouteBus(next, {
        id: existing?.id,
        route: group.route,
        run: assignment.run,
        bus: assignment.bus,
        clockIn,
        clockOut,
      });
      wrote = true;
    }
    if (wrote) {
      skipped.push(...missed);
      const posted = postedBusRow(next, group.route);
      const held = group.runs.filter(
        (item) => item.bus && item.clockIn != null && !clockInputValue(item.clockIn) && !pairingForRun(next, group.route, item.run)
      );
      if (posted && !held.length) next = removePairing(next, posted.id);
      else if (posted && held.length && new Set(held.map((item) => item.bus)).size === 1) {
        const bus = held[0].bus;
        if (clean(posted.bus) !== bus) next = next.map((row) => (row.id === posted.id ? { ...row, bus } : row));
      }
      continue;
    }
    const filled = group.runs.filter((item) => item.bus);
    const unique = [...new Set(filled.map((item) => item.bus))];
    const posted = postedBusRow(next, group.route);
    if (unique.length > 1) {
      skipped.push(...missed);
      continue;
    }
    const bus = unique[0] || '';
    if (!bus) {
      if (posted) next = removePairing(next, posted.id);
      continue;
    }
    if (posted) {
      if (clean(posted.bus) !== bus) next = next.map((row) => (row.id === posted.id ? { ...row, bus } : row));
      continue;
    }
    const hasRun = SHEET_RUNS.some((run) => pairingForRun(next, group.route, run));
    if (!hasRun) next = savePostedBus(next, { route: group.route, bus });
  }
  return { list: next, skipped };
}

// A posted bus with no clock-in picks up the school-route clocks. A run that
// already has a clock-in keeps that start. Utility routes and routes with no
// school stops are left alone. Returns the same list when nothing changed.
export function adoptScheduleClocks(list, schedules) {
  let next = Array.isArray(list) ? [...list] : [];
  let changed = false;
  for (const schedule of schedules || []) {
    const route = routeLabel(schedule?.route);
    if (!route || clean(schedule?.skip)) continue;
    for (const choice of schedule?.runs || []) {
      let run = '';
      try {
        run = normalizeRun(choice?.run);
      } catch {
        continue;
      }
      if (!SHEET_RUNS.includes(run)) continue;
      const clockIn = clockInputValue(choice?.clockIn);
      if (!clockIn) continue;
      const existing = pairingForRun(next, route, run);
      if (existing?.clockIn) continue;
      const posted = postedBusRow(next, route);
      const bus = clean(existing?.bus) || clean(posted?.bus);
      if (!bus) continue;
      const clockOut = choice?.clockOut ? clockInputValue(choice.clockOut) : '';
      next = saveRouteBus(next, {
        id: existing?.id,
        route,
        run,
        bus,
        clockIn,
        clockOut,
      });
      changed = true;
    }
  }
  return changed ? next : list;
}

// A PM clock-in saved from an early-release day goes back to the regular
// schedule time. A different saved start is left alone. The alert uses the
// early-release time only while that day is in effect.
export function restoreRegularPmClocks(list, clocksFor, earlyClockFor, legacyClock = '11:55') {
  const rows = Array.isArray(list) ? list : [];
  const lookup = typeof clocksFor === 'function' ? clocksFor : () => [];
  const earlyFor = typeof earlyClockFor === 'function' ? earlyClockFor : () => '';
  const legacy = clockInputValue(legacyClock);
  let changed = false;
  const next = rows.map((row) => {
    let run = '';
    try {
      run = normalizeRun(row?.run);
    } catch {
      return row;
    }
    if (run !== 'PM') return row;
    const route = routeLabel(row?.route);
    if (!route) return row;
    const regular = clocksForRun(lookup, route, 'PM').clockIn;
    const stored = row?.clockIn ? clockInputValue(row.clockIn) : '';
    if (!regular || !stored || stored === regular) return row;
    const early = clockInputValue(earlyFor(route));
    if (stored !== early && stored !== legacy) return row;
    changed = true;
    return { ...row, clockIn: regular };
  });
  return changed ? next : rows;
}

// Clock-out on a route run follows Time Changes. A run that already has a
// clock-in keeps that start. Returns the same list when nothing changed.
export function applyScheduleClocks(list, clocksFor) {
  const rows = Array.isArray(list) ? list : [];
  let changed = false;
  const next = rows.map((row) => {
    const route = routeLabel(row?.route);
    let run = '';
    try {
      run = normalizeRun(row?.run);
    } catch {
      return row;
    }
    if (!route || !SHEET_RUNS.includes(run)) return row;
    const choice = clocksForRun(clocksFor, route, run);
    if (!choice.clockOut) return row;
    const existing = row?.clockOut ? clockInputValue(row.clockOut) : '';
    if (choice.clockOut === existing) return row;
    changed = true;
    return { ...row, clockOut: choice.clockOut };
  });
  return changed ? next : rows;
}

// A bus watched by the time it usually starts. No route number.
export function saveUsualStart(list, entry) {
  if (clean(entry?.route)) {
    throw new Error('A usual start has no route. Put that bus on the route instead.');
  }
  return savePairing(list, { ...entry, route: '' });
}

const SAME_WINDOW_MINUTES = 90;

function sameWatchWindow(routeRun, usualRun) {
  if (clean(routeRun?.bus).toLowerCase() !== clean(usualRun?.bus).toLowerCase()) return false;
  const routeStart = minutesOf(routeRun?.clockIn);
  const usualStart = minutesOf(usualRun?.clockIn);
  if (routeStart == null || usualStart == null) return false;
  const routePiece = clean(routeRun?.run).toLowerCase();
  const usualPiece = clean(usualRun?.run).toLowerCase();
  if (routePiece && usualPiece && routePiece === usualPiece) return true;
  return Math.abs(routeStart - usualStart) <= SAME_WINDOW_MINUTES;
}

// Route assignments and usual starts both feed Dark Bus.
// When both cover the same bus around the same time, the route assignment wins.
export function boardRuns(routeBuses, usualStarts, live = {}) {
  const fromRoutes = pairingsToRuns(routeBuses, live).map((run) => ({ ...run, source: 'route' }));
  const fromUsual = pairingsToRuns(usualStarts, live)
    .map((run) => ({ ...run, source: 'usual' }))
    .filter((start) => !fromRoutes.some((route) => sameWatchWindow(route, start)));
  return [...fromRoutes, ...fromUsual].sort((a, b) => {
    const start = minutesOf(a.clockIn) - minutesOf(b.clockIn);
    if (start) return start;
    return a.bus.localeCompare(b.bus, undefined, { numeric: true });
  });
}

function sameRunPiece(itemRun, runPiece) {
  const piece = clean(itemRun).toLowerCase();
  return !piece || piece === clean(runPiece).toLowerCase();
}

// An out-of-service row covers the route it names. A row with no route covers
// every run of that usual bus, including runs that name a route. A blank run
// covers every run of that route or bus.
function coversRun(item, run) {
  if (!sameRunPiece(item?.run, run?.run)) return false;
  const itemRoute = clean(item?.route).toLowerCase();
  const runRoute = clean(run?.route).toLowerCase();
  if (itemRoute) return itemRoute === runRoute;
  return busKey(item?.usualBus) === busKey(run?.bus);
}

function statusForBus(live, bus, run) {
  const piece = clean(run).toLowerCase();
  const raw = clean(bus).toLowerCase();
  const direct = live?.[`${raw}|${piece}`] || (piece ? null : live?.[raw]);
  if (direct) return direct;
  const want = busKey(bus);
  for (const [name, status] of Object.entries(live || {})) {
    const [busPart, runPart = ''] = name.split('|');
    if (busKey(busPart) !== want) continue;
    if (piece ? runPart.toLowerCase() === piece : !runPart) return status;
  }
  return {};
}

// A bus that is already out of service is not dark. The route is dark only
// when the spare assigned to it missed Power On.
export function watchOutOfService(runs, outOfService, live = {}, date = '') {
  const list = Array.isArray(outOfService) ? outOfService : [];
  const outBuses = new Set(list.map((item) => busKey(item?.usualBus)).filter(Boolean));
  return (runs || []).flatMap((run) => {
    const cover = list.find((item) => coversRun(item, run));
    if (cover) {
      const spare = spareForPortion(cover, run.run, date);
      if (!spare) return [];
      if (busKey(run.bus) === busKey(spare)) return [run];
      const status = statusForBus(live, spare, run.run);
      return [
        {
          ...run,
          bus: spare,
          poweredOnAt: status.poweredOnAt || '',
          lastStopVisited: Boolean(status.lastStopVisited),
        },
      ];
    }
    if (outBuses.has(busKey(run.bus))) return [];
    return [run];
  });
}

// Clock-ins already saved on a route. MIDDAY is stored as MID on The Board.
export function routeRunChoices(schedule) {
  const choices = [];
  for (const [segment, run] of [
    ['AM', 'AM'],
    ['MIDDAY', 'MID'],
    ['PM', 'PM'],
  ]) {
    const item = schedule?.[segment] || schedule?.[run];
    const clockIn = clockInputValue(item?.clock_in ?? item?.clockIn);
    if (!clockIn) continue;
    choices.push({
      run,
      clockIn,
      clockOut: clockInputValue(item?.clock_out ?? item?.clockOut),
    });
  }
  return choices;
}

function watchRow(routeBuses, usualStarts, alert) {
  const id = clean(alert?.id);
  const routeRow = (routeBuses || []).find((row) => row.id === id);
  if (routeRow) return { source: 'route', row: routeRow };
  const usualRow = (usualStarts || []).find((row) => row.id === id);
  if (usualRow) return { source: 'usual', row: usualRow };
  return null;
}

function outOfServiceForWatch(list, row) {
  const route = clean(row?.route).toLowerCase();
  const run = clean(row?.run).toLowerCase();
  const bus = clean(row?.bus).toLowerCase();
  return (list || []).find((item) => {
    if (route) {
      return clean(item.route).toLowerCase() === route && clean(item.run).toLowerCase() === run;
    }
    if (hasPortionSpares(item)) {
      const buses = PORTION_RUNS.map((part) => clean(item.spares?.[part]).toLowerCase());
      return buses.includes(bus) || clean(item.usualBus).toLowerCase() === bus;
    }
    return clean(item.spareBus).toLowerCase() === bus || clean(item.usualBus).toLowerCase() === bus;
  });
}

const MAX_SPARE_DAYS = 366;

function sameSpareRoute(left, right) {
  const a = clean(left).toLowerCase();
  const b = clean(right).toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const aNumber = a.match(/^(?:s[\s-]*)?0*(\d+)$/);
  const bNumber = b.match(/^(?:s[\s-]*)?0*(\d+)$/);
  if (!aNumber || !bNumber || aNumber[1] !== bNumber[1]) return false;
  return /^s/.test(a) !== /^s/.test(b);
}

function spareListKind(bus, spedSpares, regSpares) {
  const key = busKey(bus);
  if (!key) return '';
  if ((spedSpares || []).some((row) => busKey(row?.bus ?? row?.route) === key)) return 'sped';
  if ((regSpares || []).some((row) => busKey(row?.bus) === key)) return 'reg';
  return '';
}

// "WC(2)" and "WC (2)" are two wheelchair spots. A listed type with no WC has none.
export function wheelchairCount(kind) {
  const text = clean(kind);
  const match = text.match(/wc\s*\(\s*(\d+)\s*\)/i);
  if (match) return Number(match[1]);
  return text ? 0 : null;
}

function spareKind(bus, spedSpares, regSpares) {
  const key = busKey(bus);
  if (!key) return null;
  const row = [...(spedSpares || []), ...(regSpares || [])].find((item) => busKey(item?.bus ?? item?.route) === key);
  if (!row) return null;
  return clean(row.kind ?? row.spare);
}

const MAX_ROUTE_WHEELCHAIRS = 20;

function wheelchairPhrase(count) {
  return count === 1 ? '1 wheelchair' : `${count} wheelchairs`;
}

function routeNeedsWheelchairs(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return 0;
  return Math.min(number, MAX_ROUTE_WHEELCHAIRS);
}

export function normalizeRouteWheelchairs(saved) {
  const out = {};
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return out;
  for (const [route, count] of Object.entries(saved)) {
    const label = routeLabel(route);
    const number = Number(count);
    if (!label || !Number.isInteger(number) || number < 1 || number > MAX_ROUTE_WHEELCHAIRS) continue;
    out[routeKey(label)] = number;
  }
  return out;
}

// "S 10" and "10" share a count. An empty result means the route has no count yet.
export function routeWheelchairNeed(saved, route) {
  const map = normalizeRouteWheelchairs(saved);
  const key = routeKey(route);
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  for (const [existing, count] of Object.entries(map)) {
    if (sameSpareRoute(existing, route)) return count;
  }
  return null;
}

export function setRouteWheelchairs(saved, route, count) {
  const map = normalizeRouteWheelchairs(saved);
  const key = routeKey(route);
  if (!key) return map;
  for (const existing of Object.keys(map)) {
    if (existing !== key && sameSpareRoute(existing, route)) delete map[existing];
  }
  const needed = routeNeedsWheelchairs(count);
  if (!needed) delete map[key];
  else map[key] = needed;
  return map;
}

function wheelchairWarning(bus, kind, needed, routeName) {
  if (!needed) return '';
  const count = kind == null ? null : wheelchairCount(kind);
  const need = routeName ? `Route ${routeName} needs ${wheelchairPhrase(needed)}.` : `This route needs ${wheelchairPhrase(needed)}.`;
  if (count == null) return `Bus ${bus} has no wheelchair count listed. ${need}`;
  if (count >= needed) return '';
  const has = count === 0 ? 'no wheelchairs' : wheelchairPhrase(count);
  return `Bus ${bus} has ${has}. ${need}`;
}

// Warnings only. A mismatched spare or a bus already on another route can still be saved.
export function spareAssignmentWarnings({ route, spare, assignments, outOfService, sped = false, spedSpares, regSpares, wheelchairsNeeded } = {}) {
  const bus = clean(spare);
  if (!bus) return [];
  const warnings = [];
  const pool = spareListKind(bus, spedSpares, regSpares);
  const routeName = clean(route);
  const routeIsSped = Boolean(sped) || isSpedRoute(routeName);
  if (pool === 'reg' && routeIsSped) {
    warnings.push(`Bus ${bus} is a regular-ed spare. ${routeName ? `Route ${routeName} is a sped route.` : 'This is a sped route.'}`);
  }
  if (pool === 'sped' && routeName && !routeIsSped) {
    warnings.push(`Bus ${bus} is a sped spare. Route ${routeName} is a regular-ed route.`);
  }
  const chairs = wheelchairWarning(bus, spareKind(bus, spedSpares, regSpares), routeNeedsWheelchairs(wheelchairsNeeded), routeName);
  if (chairs) warnings.push(chairs);
  const routes = new Set();
  for (const row of assignments || []) {
    if (busKey(row?.bus) !== busKey(bus)) continue;
    const name = clean(row?.route);
    if (name && !sameSpareRoute(name, routeName)) routes.add(name);
  }
  for (const row of outOfService || []) {
    if (busKey(row?.spareBus) !== busKey(bus)) continue;
    const name = clean(row?.route);
    if (name && !sameSpareRoute(name, routeName)) routes.add(name);
  }
  if (routes.size) {
    const names = [...routes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    warnings.push(`Bus ${bus} is already assigned to route ${names.join(', ')}.`);
  }
  return warnings;
}

// A spare already covering another out bus for the same part of the day. Saving is still allowed.
export function sparePortionWarnings({ spares, days, outOfService, ignoreId, usualBus } = {}) {
  const pattern = portionSpareMap(spares);
  const overrides = portionSpareDays(days);
  const others = (outOfService || []).filter((row) => {
    if (ignoreId && row.id === ignoreId) return false;
    if (usualBus && busKey(row.usualBus) === busKey(usualBus)) return false;
    return Boolean(clean(row?.usualBus));
  });
  const warnings = [];
  const seen = new Set();
  const push = (text) => {
    if (seen.has(text)) return;
    seen.add(text);
    warnings.push(text);
  };
  const who = (row) => `bus ${clean(row.usualBus)}`;
  for (const portion of PORTION_RUNS) {
    const spare = pattern[portion];
    if (spare) {
      for (const row of others) {
        const theirs = patternSpare(row, portion);
        if (theirs == null || busKey(theirs) !== busKey(spare)) continue;
        push(`Bus ${spare} is already the ${portion} spare for ${who(row)}.`);
      }
      for (const row of others) {
        if (busKey(patternSpare(row, portion)) === busKey(spare)) continue;
        const rowDays = row.days && typeof row.days === 'object' ? row.days : {};
        for (const [day, map] of Object.entries(rowDays)) {
          if (busKey(map?.[portion]) !== busKey(spare)) continue;
          push(`Bus ${spare} is already the ${portion} spare for ${who(row)} on ${portionDayLabel(day)}.`);
        }
      }
    }
    for (const [day, map] of Object.entries(overrides)) {
      const daySpare = clean(map?.[portion]);
      if (!daySpare || busKey(daySpare) === busKey(spare)) continue;
      for (const row of others) {
        const theirs = spareForPortion(row, portion, day);
        if (theirs == null || busKey(theirs) !== busKey(daySpare)) continue;
        push(`Bus ${daySpare} is already the ${portion} spare for ${who(row)} on ${portionDayLabel(day)}.`);
      }
    }
  }
  return warnings;
}

function spareRow(row) {
  return {
    bus: clean(row?.bus ?? row?.route).replace(/^0+(?=\d)/, ''),
    kind: clean(row?.kind ?? row?.spare),
  };
}

// A saved list replaces the posted sheet. A missing list keeps the sheet.
export function normalizeSparePools(saved, defaults) {
  const fallback = defaults && typeof defaults === 'object' ? defaults : {};
  const source = saved && typeof saved === 'object' && (Array.isArray(saved.sped) || Array.isArray(saved.reg)) ? saved : fallback;
  const rows = (list, backup) => (Array.isArray(list) ? list : backup || []).map(spareRow);
  return {
    sped: rows(source.sped, fallback.sped),
    reg: rows(source.reg, fallback.reg),
  };
}

export function sparePoolMarkup(choices, pool = 'spare') {
  const rows = (choices || [])
    .map((choice, index) => {
      const bus = clean(choice?.bus);
      const kind = clean(choice?.kind);
      const label = pool === 'reg' ? 'Regular-ed' : 'Sped';
      const tagPlaceholder = pool === 'reg' ? 'HDX 78P' : 'WC(2)';
      return `<div class="board-spare-edit"><input data-spare-field="bus" value="${escapeHtml(bus)}" inputmode="numeric" autocomplete="off" aria-label="${label} spare bus ${index + 1}" /><input data-spare-field="kind" value="${escapeHtml(kind)}" placeholder="${tagPlaceholder}" autocomplete="off" aria-label="${label} spare tag ${index + 1}" /><button type="button" data-spare-remove aria-label="Remove ${label} spare ${escapeHtml(bus) || index + 1}">Remove</button></div>`;
    })
    .join('');
  return `${rows}<button type="button" class="board-spare-add" data-spare-add="${escapeHtml(pool)}">Add bus</button>`;
}

// The add-out-of-service charts. Each row is a spare the green button can select.
export function sparePoolChoiceMarkup(choices, pool = 'spare', selected = '') {
  const want = busKey(selected);
  const rows = (choices || [])
    .map((choice) => {
      const bus = clean(choice?.bus);
      if (!bus) return '';
      const kind = clean(choice?.kind);
      const label = pool === 'reg' ? 'Regular-ed' : 'Sped';
      const picked = want && busKey(bus) === want ? ' is-selected' : '';
      return `<div class="board-spare-choice${picked}"><span class="board-spare-choice-bus">${escapeHtml(bus)}</span><span class="board-spare-choice-kind">${escapeHtml(kind)}</span><button type="button" class="board-spare-use" data-spare-use="${escapeHtml(bus)}" aria-label="Select ${label} spare ${escapeHtml(bus)}">Use</button></div>`;
    })
    .join('');
  return rows || '<p class="board-empty">No spare buses.</p>';
}

const FLEET_PORTION_WORD = { AM: 'morning', MID: 'midday', PM: 'afternoon' };

function fleetPortionWord(portion) {
  return FLEET_PORTION_WORD[portion] || clean(portion).toLowerCase();
}

function fleetArticle(word) {
  return word === 'afternoon' ? 'an' : 'a';
}

// The buses already posted on routes, with the parts of the day each one runs.
// portionsByRoute names the runs a route actually has. A route with none still
// lists its bus, and that bus does not raise a time conflict.
export function mainFleetFromSheet(sheet, portionsByRoute = {}) {
  const grouped = new Map();
  const order = ['AM', 'MID', 'PM'];
  const knownPortions = (route) => {
    const direct = portionsByRoute?.[route];
    if (Array.isArray(direct)) return direct;
    const key = routeKey(route);
    if (Array.isArray(portionsByRoute?.[key])) return portionsByRoute[key];
    for (const [name, list] of Object.entries(portionsByRoute || {})) {
      if (routeKey(name) === key && Array.isArray(list)) return list;
    }
    return null;
  };
  const remember = (bus, route, portion) => {
    const key = busKey(bus);
    const routeName = clean(route);
    if (!key || !routeName) return;
    if (!grouped.has(key)) grouped.set(key, { bus: clean(bus).replace(/^0+(?=\d)/, ''), routes: [] });
    const entry = grouped.get(key);
    let job = entry.routes.find((item) => routeKey(item.route) === routeKey(routeName));
    if (!job) {
      job = { route: routeName, portions: [] };
      entry.routes.push(job);
    }
    if (portion && order.includes(portion) && !job.portions.includes(portion)) job.portions.push(portion);
  };
  for (const row of sheet || []) {
    const route = clean(row?.route);
    if (!route) continue;
    const listed = knownPortions(route);
    const portions = Array.isArray(listed) ? order.filter((part) => listed.map((item) => clean(item).toUpperCase()).includes(part)) : [];
    if (portions.length) {
      for (const portion of portions) remember(row?.buses?.[portion], route, portion);
      continue;
    }
    const bus = order.map((part) => clean(row?.buses?.[part])).find(Boolean);
    remember(bus, route, '');
  }
  return [...grouped.values()]
    .map((entry) => ({
      ...entry,
      routes: entry.routes.map((job) => ({ ...job, portions: order.filter((part) => job.portions.includes(part)) })),
    }))
    .sort((a, b) => a.bus.localeCompare(b.bus, undefined, { numeric: true }));
}

function fleetOverlapSentence(bus, route, portions) {
  const words = ['AM', 'MID', 'PM'].filter((part) => portions.includes(part)).map(fleetPortionWord);
  if (!words.length) return '';
  let when = `${fleetArticle(words[0])} ${words[0]} route`;
  if (words.length === 2) when = `${fleetArticle(words[0])} ${words[0]} route and ${fleetArticle(words[1])} ${words[1]} route`;
  if (words.length > 2) when = `${fleetArticle(words[0])} ${words[0]}, ${words[1]}, and ${words[2]} route`;
  return `Bus ${bus} already has ${when} on route ${route}.`;
}

// A main-fleet bus can still be saved. The warning is the part of the day it already runs.
export function mainFleetWarnings({ bus, portions, fleet } = {}) {
  const key = busKey(bus);
  const want = ['AM', 'MID', 'PM'].filter((part) => (portions || []).map((item) => clean(item).toUpperCase()).includes(part));
  if (!key || !want.length) return [];
  const row = (fleet || []).find((item) => busKey(item?.bus) === key);
  if (!row) return [];
  const warnings = [];
  for (const job of row.routes || []) {
    const overlap = want.filter((part) => (job.portions || []).includes(part));
    const sentence = fleetOverlapSentence(clean(bus).replace(/^0+(?=\d)/, ''), job.route, overlap);
    if (sentence) warnings.push(sentence);
  }
  return warnings;
}

export function mainFleetMarkup(fleet, selected = '') {
  const want = busKey(selected);
  const rows = (fleet || [])
    .map((item) => {
      const bus = clean(item?.bus);
      if (!bus) return '';
      const kind = (item.routes || [])
        .map((job) => {
          const route = clean(job?.route);
          const portions = ['AM', 'MID', 'PM'].filter((part) => (job?.portions || []).includes(part));
          if (!route) return portions.join(', ');
          return portions.length ? `Route ${route} · ${portions.join(', ')}` : `Route ${route}`;
        })
        .filter(Boolean)
        .join(' · ');
      const picked = want && busKey(bus) === want ? ' is-selected' : '';
      return `<div class="board-spare-choice${picked}"><span class="board-spare-choice-bus">${escapeHtml(bus)}</span><span class="board-spare-choice-kind">${escapeHtml(kind)}</span><button type="button" class="board-spare-use" data-spare-use="${escapeHtml(bus)}" aria-label="Select main fleet bus ${escapeHtml(bus)}">Use</button></div>`;
    })
    .join('');
  return rows || '<p class="board-empty">No buses on routes.</p>';
}

function portionAssignPrompt(spares, usual) {
  const map = portionSpareMap(spares);
  const bus = clean(usual) || '__';
  const filled = PORTION_RUNS.filter((run) => map[run]);
  const empty = PORTION_RUNS.filter((run) => !map[run]);
  const same = PORTION_RUNS.every((run) => busKey(map[run]) === busKey(map.AM));
  if (same) {
    if (!map.AM) return `Mark Bus ${bus} out of service with no spare?`;
    return `Assign Spare Bus ${map.AM} to replace Bus ${bus}?`;
  }
  const named = filled.map((run) => `spare ${map[run]} for ${run}`);
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
  let line = `Assign ${list} to replace bus ${bus}?`;
  if (empty.length === 1) line += ` ${empty[0]} has no spare.`;
  else if (empty.length > 1) line += ` ${empty.join(' and ')} have no spare.`;
  return line;
}

export function spareAssignPrompt(spare, usual) {
  if (spare && typeof spare === 'object') return portionAssignPrompt(spare, usual);
  return `Assign Spare Bus ${clean(spare) || '__'} to replace Bus ${clean(usual) || '__'}?`;
}

// A spare covers today only, a number of days, or it stays until someone takes it down.
export function spareCovers(duration) {
  if (duration === 'indefinitely' || duration?.indefinite === true) return 'indefinitely';
  if (duration === 'today' || duration?.today === true) return 'today';
  const raw = duration && typeof duration === 'object' ? (duration.covers ?? duration.days) : duration;
  if (raw === 'indefinitely') return 'indefinitely';
  if (raw === 'today') return 'today';
  const days = Number(raw);
  if (Number.isInteger(days) && days >= 1 && days <= MAX_SPARE_DAYS) return days;
  return null;
}

// Replace stays hidden until both a spare bus and a duration are chosen.
export function spareReplacementReady(spare, duration) {
  return Boolean(clean(spare)) && spareCovers(duration) != null;
}

// The dark bus leaves the watch. The spare is watched for the same start.
// A second spare keeps the original bus as the one that is out.
export function sendSpare(routeBuses, usualStarts, outOfService, alert, spareBus, duration) {
  const spare = clean(spareBus);
  if (!spare) throw new Error('Name the spare bus.');
  const covers = spareCovers(duration);
  if (covers == null) throw new Error('Choose today only, a number of days, or indefinitely.');
  const found = watchRow(routeBuses, usualStarts, alert);
  if (!found) throw new Error('That dark bus is no longer being watched.');
  const { source, row } = found;
  if (spare.toLowerCase() === clean(row.bus).toLowerCase()) {
    throw new Error('Pick a different bus than the one that is dark.');
  }
  const existing = outOfServiceForWatch(outOfService, row);
  const usualBus = existing?.usualBus || row.bus;
  if (spare.toLowerCase() === clean(usualBus).toLowerCase()) {
    throw new Error('That is the bus that is already out.');
  }
  const nextRoute = source === 'route' ? saveRouteBus(routeBuses, { ...row, bus: spare }) : routeBuses || [];
  const nextUsual = source === 'usual' ? saveUsualStart(usualStarts, { ...row, bus: spare }) : usualStarts || [];
  const nextOut = addOutOfService(outOfService, {
    route: row.route,
    run: row.run,
    usualBus,
    spareBus: spare,
    note: existing?.note || 'Dark bus',
    covers,
  });
  return { routeBuses: nextRoute, usualStarts: nextUsual, outOfService: nextOut };
}

// Live Zonar status is keyed by "bus|run". A morning Power On does not clear
// the afternoon start. A pairing with no run can use a bus-only status.
export function pairingsToRuns(pairings, live = {}) {
  return (pairings || []).map((pairing) => {
    const bus = clean(pairing?.bus).toLowerCase();
    const run = clean(pairing?.run).toLowerCase();
    const status = live[`${bus}|${run}`] || (run ? {} : live[bus]) || {};
    return {
      id: clean(pairing?.id),
      route: clean(pairing?.route),
      bus: clean(pairing?.bus),
      run: clean(pairing?.run),
      clockIn: pairing?.clockIn,
      clockOut: pairing?.clockOut || '',
      poweredOnAt: status.poweredOnAt || '',
      lastStopVisited: Boolean(status.lastStopVisited),
    };
  });
}

function coversLabel(covers) {
  if (covers === 'indefinitely') return 'Indefinitely';
  if (covers === 'today') return 'Today only';
  const days = Number(covers);
  if (Number.isInteger(days) && days >= 1) return days === 1 ? 'For 1 day' : `For ${days} days`;
  return '';
}

function neededPool(route, spedRoutes) {
  if (!clean(route)) return '';
  if (isSpedRoute(route)) return 'sped';
  const key = routeKey(route);
  const listed = (spedRoutes || []).some((name) => routeKey(name) === key);
  return listed ? 'sped' : 'reg';
}

function poolFit(bus, sped, reg) {
  if (!clean(bus)) return 'none';
  return spareListKind(bus, sped, reg) || 'other';
}

function spareFitsRoute(row, bus, sped, reg, spedRoutes) {
  if (!clean(bus) || busKey(bus) === busKey(row?.usualBus)) return false;
  const fit = poolFit(bus, sped, reg);
  if (fit === 'other') return true;
  const needed = neededPool(row?.route, spedRoutes);
  return !needed || fit === needed;
}

function outOfServiceWho(row, { capital = false } = {}) {
  if (clean(row?.route)) return `${capital ? 'Route' : 'route'} ${clean(row.route)}`;
  return `${capital ? 'Bus' : 'bus'} ${clean(row.usualBus)}`;
}

function copyOutOfServiceRow(row) {
  return {
    ...row,
    ...(hasPortionSpares(row) ? { spares: { ...row.spares } } : {}),
    ...(row?.days && typeof row.days === 'object' ? { days: { ...row.days } } : {}),
  };
}

function writePortion(row, portion, spare) {
  const limited = portionRun(row.run);
  if (!hasPortionSpares(row) && limited) {
    row.spareBus = clean(spare);
    return;
  }
  if (!hasPortionSpares(row)) {
    const current = clean(row.spareBus);
    row.spares = { AM: current, MID: current, PM: current };
    row.run = '';
  } else {
    row.spares = portionSpareMap(row.spares);
  }
  row.spares[portion] = clean(spare);
  row.spareBus = sharedSpare(row.spares);
}

function assignPortionSpare(list, id, spareBus, portion) {
  const source = Array.isArray(list) ? list : [];
  const target = source.find((row) => row.id === id);
  if (!target) throw new Error('That bus is no longer out of service.');
  const nextSpare = clean(spareBus);
  if (nextSpare && busKey(nextSpare) === busKey(target.usualBus)) {
    throw new Error('That is the bus that is already out.');
  }
  const current = patternSpare(target, portion);
  if (current == null) return source;
  if (busKey(nextSpare) === busKey(current)) return source;
  const rows = source.map(copyOutOfServiceRow);
  const copy = rows.find((row) => row.id === id);
  writePortion(copy, portion, nextSpare);
  if (nextSpare) {
    const holders = rows.filter((row) => row.id !== id && busKey(patternSpare(row, portion)) === busKey(nextSpare));
    if (holders.length) {
      writePortion(holders[0], portion, current);
      for (const extra of holders.slice(1)) writePortion(extra, portion, '');
    }
  }
  return rows;
}

function clearSpareBus(list, spare) {
  const key = busKey(spare);
  let changed = false;
  const next = (list || []).map((row) => {
    if (hasPortionSpares(row)) {
      const spares = portionSpareMap(row.spares);
      let touched = false;
      for (const portion of PORTION_RUNS) {
        if (busKey(spares[portion]) !== key) continue;
        spares[portion] = '';
        touched = true;
      }
      if (!touched) return row;
      changed = true;
      return { ...row, spares, spareBus: sharedSpare(spares) };
    }
    if (busKey(row.spareBus) !== key) return row;
    changed = true;
    return { ...row, spareBus: '' };
  });
  return changed ? next : list;
}

// A spare moves onto one out-of-service row. If another row already has that
// spare, the two rows trade, so a covered bus is not left without one.
// A portion trades only that part of the day.
export function assignOutOfServiceSpare(list, id, spareBus, portion = '') {
  const run = portionRun(portion);
  if (run) return assignPortionSpare(list, id, spareBus, run);
  const source = Array.isArray(list) ? list : [];
  const target = source.find((row) => row.id === id);
  if (!target) throw new Error('That bus is no longer out of service.');
  const nextSpare = clean(spareBus);
  if (nextSpare && busKey(nextSpare) === busKey(target.usualBus)) {
    throw new Error('That is the bus that is already out.');
  }
  if (busKey(nextSpare) === busKey(target.spareBus) && !hasPortionSpares(target)) return source;
  const rows = source.map(copyOutOfServiceRow);
  const copy = rows.find((row) => row.id === id);
  const holders = nextSpare
    ? rows.filter((row) => row.id !== id && busKey(row.spareBus) === busKey(nextSpare) && !hasPortionSpares(row))
    : [];
  const previous = clean(copy.spareBus);
  copy.spareBus = nextSpare;
  if (hasPortionSpares(copy)) {
    copy.spares = { AM: nextSpare, MID: nextSpare, PM: nextSpare };
  }
  if (holders.length) {
    holders[0].spareBus = previous;
    for (const extra of holders.slice(1)) extra.spareBus = '';
  }
  return rows;
}

// Point a spare at an out-of-service row, or clear it when the row id is blank.
// A portion id looks like "bus|11|AM".
export function placeOutOfServiceSpare(list, spareBus, oosId) {
  const spare = clean(spareBus);
  if (!spare) throw new Error('Name the spare bus.');
  const rows = Array.isArray(list) ? list : [];
  if (!clean(oosId)) return clearSpareBus(rows, spare);
  const split = clean(oosId).match(/^(.*)\|(AM|MID|PM)$/i);
  if (split) return assignOutOfServiceSpare(rows, split[1], spare, split[2]);
  return assignOutOfServiceSpare(rows, oosId, spare);
}

function chairsOk(row, bus, sped, reg, wheelchairs) {
  const needed = routeWheelchairNeed(wheelchairs, row?.route);
  if (!needed) return true;
  const kind = spareKind(bus, sped, reg);
  if (kind == null) return true;
  const count = wheelchairCount(kind);
  return count != null && count >= needed;
}

function assignmentOk(row, bus, ctx) {
  return spareFitsRoute(row, bus, ctx.sped, ctx.reg, ctx.spedRoutes) && chairsOk(row, bus, ctx.sped, ctx.reg, ctx.wheelchairs);
}

function openPoolBus(pool, used, out, row, ctx) {
  const found = (pool || []).find((item) => {
    const key = busKey(item?.bus);
    if (!key || used.has(key) || out.has(key) || key === busKey(row?.usualBus)) return false;
    return chairsOk(row, item.bus, ctx.sped, ctx.reg, ctx.wheelchairs);
  });
  return found ? clean(found.bus) : '';
}

// Keep a spare that already matches. Fill the rest from open spares of the
// right kind, then trade when two routes are each holding the other's spare.
function proposeSpareAssignments(rows, options = {}) {
  const sped = options.sped || [];
  const reg = options.reg || [];
  const spedRoutes = options.spedRoutes || [];
  const wheelchairs = options.wheelchairs || {};
  const ctx = { sped, reg, spedRoutes, wheelchairs };
  const source = Array.isArray(rows) ? rows : [];
  const assignment = new Map(source.map((row) => [row.id, clean(row.spareBus)]));
  const pools = { sped, reg };
  const out = new Set(source.map((row) => busKey(row.usualBus)).filter(Boolean));
  const used = new Set([...assignment.values()].map((bus) => busKey(bus)).filter(Boolean));

  const give = (row, bus) => {
    const previous = assignment.get(row.id);
    if (busKey(previous) && busKey(previous) !== busKey(bus)) used.delete(busKey(previous));
    assignment.set(row.id, clean(bus));
    used.add(busKey(bus));
  };

  const findOpen = (row, ignoreBus = '') => {
    const ignore = busKey(ignoreBus);
    if (ignore) used.delete(ignore);
    const needed = neededPool(row.route, spedRoutes);
    const kinds = needed ? [needed] : ['reg', 'sped'];
    let bus = '';
    for (const kind of kinds) {
      const found = openPoolBus(pools[kind], used, out, row, ctx);
      if (found && busKey(found) !== ignore && assignmentOk(row, found, ctx)) {
        bus = found;
        break;
      }
    }
    if (ignore) used.add(ignore);
    return bus;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const row of source) {
      if (assignmentOk(row, assignment.get(row.id), ctx)) continue;
      const bus = findOpen(row);
      if (!bus) continue;
      give(row, bus);
      changed = true;
    }
  }

  let moved = true;
  while (moved) {
    moved = false;
    for (const row of source) {
      if (assignmentOk(row, assignment.get(row.id), ctx)) continue;
      const current = assignment.get(row.id);
      for (const other of source) {
        if (other.id === row.id) continue;
        const theirs = assignment.get(other.id);
        if (!theirs || !assignmentOk(row, theirs, ctx)) continue;
        if (busKey(theirs) === busKey(row.usualBus) || busKey(current) === busKey(other.usualBus)) continue;
        if (current && assignmentOk(other, current, ctx)) {
          assignment.set(row.id, theirs);
          assignment.set(other.id, current);
          moved = true;
          break;
        }
        const open = findOpen(other, theirs);
        if (!open) continue;
        used.delete(busKey(theirs));
        if (current) used.delete(busKey(current));
        assignment.set(other.id, open);
        assignment.set(row.id, theirs);
        used.add(busKey(open));
        used.add(busKey(theirs));
        moved = true;
        break;
      }
      if (moved) break;
    }
  }
  return assignment;
}

function openSpareForPortion(row, portion, used, out, pools, ctx) {
  const needed = neededPool(row.route, ctx.spedRoutes);
  const kinds = needed ? [needed] : ['reg', 'sped'];
  for (const kind of kinds) {
    const found = (pools[kind] || []).find((item) => {
      const key = busKey(item?.bus);
      if (!key || used[portion].has(key) || out.has(key) || key === busKey(row?.usualBus)) return false;
      return assignmentOk(row, item.bus, ctx);
    });
    if (found) return clean(found.bus);
  }
  return '';
}

// Fill portions that have no spare. A portion that already has one stays as it is,
// and a spare used in the morning can still cover a different bus in the afternoon.
function fillEmptyPortions(rows, options = {}) {
  const source = Array.isArray(rows) ? rows : [];
  if (!source.some(hasPortionSpares)) return { rows: source, changed: false };
  const sped = options.sped || [];
  const reg = options.reg || [];
  const ctx = { sped, reg, spedRoutes: options.spedRoutes || [], wheelchairs: options.wheelchairs || {} };
  const pools = { sped, reg };
  const used = { AM: new Set(), MID: new Set(), PM: new Set() };
  const out = new Set(source.map((row) => busKey(row.usualBus)).filter(Boolean));
  for (const row of source) {
    for (const portion of PORTION_RUNS) {
      const key = busKey(patternSpare(row, portion));
      if (key) used[portion].add(key);
    }
  }
  let changed = false;
  const next = source.map((row) => {
    if (!hasPortionSpares(row)) return row;
    const spares = portionSpareMap(row.spares);
    let touched = false;
    for (const portion of PORTION_RUNS) {
      if (clean(spares[portion])) continue;
      const bus = openSpareForPortion(row, portion, used, out, pools, ctx);
      if (!bus) continue;
      spares[portion] = bus;
      used[portion].add(busKey(bus));
      touched = true;
    }
    if (!touched) return row;
    changed = true;
    return { ...row, spares, spareBus: sharedSpare(spares) };
  });
  return { rows: changed ? next : source, changed };
}

// Apply the matching proposal. A row that already has a bus is not left empty.
// Portion rows only gain a spare where that part of the day is blank.
export function applyOutOfServiceSpares(list, options = {}) {
  const source = Array.isArray(list) ? list : [];
  const legacy = source.filter((row) => !hasPortionSpares(row));
  const proposed = proposeSpareAssignments(legacy, options);
  let changed = false;
  const next = source.map((row) => {
    if (hasPortionSpares(row)) return row;
    const spare = proposed.get(row.id);
    if (spare == null || busKey(spare) === busKey(row.spareBus)) return row;
    changed = true;
    return { ...row, spareBus: clean(spare) };
  });
  const filled = fillEmptyPortions(changed ? next : source, options);
  if (!changed && !filled.changed) return source;
  return filled.rows;
}

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function assignmentFit(row, sped, reg, spedRoutes, wheelchairs) {
  const needed = neededPool(row?.route, spedRoutes);
  const fit = poolFit(row?.spareBus, sped, reg);
  if (fit === 'none') {
    if (needed === 'sped') return { ok: false, text: 'Needs a sped spare' };
    if (needed === 'reg') return { ok: false, text: 'Needs a regular-ed spare' };
    return { ok: false, text: 'Needs a spare' };
  }
  if (fit === 'other') return { ok: true, text: 'Covered by a bus that is not on the spare list' };
  if (needed && fit !== needed) {
    return {
      ok: false,
      text: fit === 'sped' ? 'Sped spare on a regular-ed route' : 'Regular-ed spare on a sped route',
    };
  }
  const neededChairs = routeWheelchairNeed(wheelchairs, row?.route);
  if (neededChairs && !chairsOk(row, row.spareBus, sped, reg, wheelchairs)) {
    const warning = wheelchairWarning(row.spareBus, spareKind(row.spareBus, sped, reg), neededChairs, clean(row.route));
    return { ok: false, text: warning || `Needs ${wheelchairPhrase(neededChairs)}.` };
  }
  return { ok: true, text: fit === 'sped' ? 'Sped spare' : 'Regular-ed spare' };
}

function spareOptionLabel(bus, kind, holder) {
  const type = clean(kind) ? ` · ${clean(kind)}` : '';
  if (!holder) return `${clean(bus)}${type}`;
  return `${clean(bus)}${type} · switch with ${outOfServiceWho(holder)}`;
}

function spareUses(bus, rows) {
  const found = [];
  for (const row of rows || []) {
    if (hasPortionSpares(row)) {
      for (const portion of PORTION_RUNS) {
        if (busKey(row.spares?.[portion]) !== busKey(bus)) continue;
        found.push({
          id: `${row.id}|${portion}`,
          who: `${outOfServiceWho(row)} ${portion}`,
          label: `${outOfServiceWho(row, { capital: true })} ${portion}`,
        });
      }
      continue;
    }
    if (busKey(row.spareBus) !== busKey(bus)) continue;
    found.push({ id: row.id, who: outOfServiceWho(row), label: outOfServiceWho(row, { capital: true }) });
  }
  return found;
}

function spareChoiceGroups(rows, target, sped, reg, portion = '') {
  const used = new Map();
  for (const row of rows) {
    const spare = portion ? patternSpare(row, portion) : clean(row.spareBus);
    const key = busKey(spare);
    if (key && row.id !== target.id && !used.has(key)) used.set(key, row);
  }
  const out = new Set(rows.map((row) => busKey(row.usualBus)).filter(Boolean));
  const currentSpare = portion ? patternSpare(target, portion) : clean(target.spareBus);
  const current = busKey(currentSpare);
  const seen = new Set();
  const groups = { sped: [], reg: [], other: [] };
  const push = (group, bus, kind, holder) => {
    const key = busKey(bus);
    if (!key || seen.has(key)) return;
    if (key === busKey(target.usualBus) && key !== current) return;
    if (key !== current && out.has(key)) return;
    seen.add(key);
    groups[group].push({ bus: clean(bus), kind: clean(kind), holder: holder || null });
  };
  for (const row of sped || []) push('sped', row.bus, row.kind, used.get(busKey(row.bus)));
  for (const row of reg || []) push('reg', row.bus, row.kind, used.get(busKey(row.bus)));
  if (current && !seen.has(current)) push('other', currentSpare, '', null);
  return groups;
}

function spareSelectMarkup(rows, target, sped, reg, portion = '') {
  const groups = spareChoiceGroups(rows, target, sped, reg, portion);
  const currentSpare = portion ? patternSpare(target, portion) : clean(target.spareBus);
  const current = busKey(currentSpare);
  const options = (choices) =>
    choices
      .map((choice) => {
        const selected = busKey(choice.bus) === current ? ' selected' : '';
        const holder = choice.holder
          ? portion
            ? { ...choice.holder, portion }
            : choice.holder
          : null;
        const label = holder && portion ? `${spareOptionLabel(choice.bus, choice.kind, holder)} ${portion}` : spareOptionLabel(choice.bus, choice.kind, choice.holder);
        return `<option value="${escapeHtml(choice.bus)}"${selected}>${escapeHtml(label)}</option>`;
      })
      .join('');
  const group = (label, choices) => (choices.length ? `<optgroup label="${escapeHtml(label)}">${options(choices)}</optgroup>` : '');
  const who = outOfServiceWho(target);
  const portionAttr = portion ? ` data-oos-portion="${escapeHtml(portion)}"` : '';
  const heading = portion || 'Spare';
  const named = portion ? `${portion} spare for ${who}` : `Spare for ${who}`;
  return `<label class="board-oos-assign">${escapeHtml(heading)}<select data-oos-assign="${escapeHtml(target.id)}"${portionAttr} aria-label="${escapeHtml(named)}"><option value=""${current ? '' : ' selected'}>No spare</option>${group('Sped spare buses', groups.sped)}${group('Regular-ed spares', groups.reg)}${group('Other bus', groups.other)}</select></label>`;
}

function coveringLabel(spareBus, rows) {
  const uses = spareUses(spareBus, rows);
  if (!uses.length) return 'Open';
  return `Covering ${uses.map((item) => item.who).join(' and ')}`;
}

function sparePlaceMarkup(bus, kind, rows) {
  const uses = spareUses(bus, rows);
  const held = new Set(uses.map((item) => item.id));
  const legacyChoices = (rows || [])
    .filter((row) => !hasPortionSpares(row) && (held.has(row.id) || busKey(row.usualBus) !== busKey(bus)))
    .map((row) => ({ id: row.id, label: outOfServiceWho(row, { capital: true }) }));
  const portionChoices = (rows || [])
    .filter((row) => hasPortionSpares(row) && busKey(row.usualBus) !== busKey(bus))
    .flatMap((row) => PORTION_RUNS.map((portion) => ({ id: `${row.id}|${portion}`, label: `${outOfServiceWho(row, { capital: true })} ${portion}` })));
  const choices = [...legacyChoices, ...portionChoices];
  const selectedId = uses.length === 1 ? uses[0].id : '';
  const options = choices
    .map((choice) => {
      const selected = choice.id === selectedId ? ' selected' : '';
      return `<option value="${escapeHtml(choice.id)}"${selected}>${escapeHtml(choice.label)}</option>`;
    })
    .join('');
  const openSelected = uses.length ? '' : ' selected';
  const several = uses.length > 1 ? '<option value="__several__" selected disabled>Several portions</option>' : '';
  const type = clean(kind) ? ` <span class="board-oos-spare-kind">${escapeHtml(kind)}</span>` : '';
  return `<li class="board-oos-spare-row"><p class="board-oos-spare-name"><strong>${escapeHtml(bus)}</strong>${type}</p><p class="board-oos-spare-use">${escapeHtml(coveringLabel(bus, rows))}</p><select data-spare-place="${escapeHtml(bus)}" aria-label="Assignment for spare ${escapeHtml(bus)}">${several}<option value=""${openSelected}>Open</option>${options}</select></li>`;
}

function rowFit(row, sped, reg, spedRoutes, wheelchairs) {
  if (!hasPortionSpares(row)) return assignmentFit(row, sped, reg, spedRoutes, wheelchairs);
  const parts = PORTION_RUNS.map((portion) => ({
    portion,
    ...assignmentFit({ ...row, spareBus: clean(row.spares?.[portion]) }, sped, reg, spedRoutes, wheelchairs),
  }));
  if (parts.every((part) => part.ok)) {
    const texts = [...new Set(parts.map((part) => part.text))];
    return { ok: true, text: texts.length === 1 ? texts[0] : parts.map((part) => `${part.portion} ${part.text}`).join('. ') };
  }
  return { ok: false, text: parts.filter((part) => !part.ok).map((part) => `${part.portion}: ${part.text}`).join(' ') };
}

function portionFillNotes(rows, sped, reg, spedRoutes, wheelchairs) {
  const filled = fillEmptyPortions(rows, { sped, reg, spedRoutes, wheelchairs });
  const moves = [];
  const shortages = [];
  for (const row of rows || []) {
    if (!hasPortionSpares(row)) continue;
    const after = filled.rows.find((item) => item.id === row.id) || row;
    for (const portion of PORTION_RUNS) {
      const before = clean(row.spares?.[portion]);
      const next = clean(after.spares?.[portion]);
      if (!next || busKey(next) === busKey(before)) continue;
      const kind = spareListKind(next, sped, reg);
      const kindLabel = kind === 'sped' ? 'a sped spare' : kind === 'reg' ? 'a regular-ed spare' : 'a spare';
      const listed = spareKind(next, sped, reg);
      const type = listed ? ` (${listed})` : '';
      moves.push(`${outOfServiceWho(row, { capital: true })} gets bus ${clean(next)} for ${portion}, ${kindLabel}${type}.`);
    }
    const still = PORTION_RUNS.filter((portion) => !clean(after.spares?.[portion]));
    if (still.length) {
      const needed = neededPool(row.route, spedRoutes);
      const kind = needed === 'sped' ? 'sped spare' : needed === 'reg' ? 'regular-ed spare' : 'spare';
      shortages.push(`No open ${kind} is left for ${outOfServiceWho(row)} ${still.join(' and ')}.`);
    }
  }
  return { moves, shortages };
}

function managerSummary(rows, sped, reg, spedRoutes, wheelchairs) {
  const openSped = (sped || []).filter((row) => clean(row.bus) && coveringLabel(row.bus, rows) === 'Open').length;
  const openReg = (reg || []).filter((row) => clean(row.bus) && coveringLabel(row.bus, rows) === 'Open').length;
  const open = `${countLabel(openSped, 'sped spare is', 'sped spares are')} open. ${countLabel(openReg, 'regular-ed spare is', 'regular-ed spares are')} open.`;
  if (!rows.length) return `No buses are out of service. ${open}`;
  const needy = rows.filter((row) => !rowFit(row, sped, reg, spedRoutes, wheelchairs).ok).length;
  const lead = rows.length === 1 ? '1 bus is out of service.' : `${rows.length} buses are out of service.`;
  let fit = 'Each one has an appropriate spare.';
  if (rows.length === 1 && needy === 0) fit = 'It has an appropriate spare.';
  else if (needy === 1) fit = '1 still needs an appropriate spare.';
  else if (needy > 1) fit = `${needy} still need an appropriate spare.`;
  return `${lead} ${fit} ${open}`;
}

function proposalNotes(rows, proposed, sped, reg, spedRoutes, wheelchairs) {
  const moves = [];
  const shortages = [];
  const ctx = { sped, reg, spedRoutes, wheelchairs };
  for (const row of rows) {
    const next = proposed.get(row.id);
    if (busKey(next) !== busKey(row.spareBus) && clean(next)) {
      const kind = spareListKind(next, sped, reg);
      const kindLabel = kind === 'sped' ? 'a sped spare' : kind === 'reg' ? 'a regular-ed spare' : 'a spare';
      const listed = spareKind(next, sped, reg);
      const type = listed ? ` (${listed})` : '';
      moves.push(`${outOfServiceWho(row, { capital: true })} gets bus ${clean(next)}, ${kindLabel}${type}.`);
    }
    if (!assignmentOk(row, next, ctx)) {
      const neededChairs = routeWheelchairNeed(wheelchairs, row.route);
      if (spareFitsRoute(row, next, sped, reg, spedRoutes) && neededChairs) {
        shortages.push(`No open spare with ${wheelchairPhrase(neededChairs)} is left for ${outOfServiceWho(row)}.`);
      } else {
        const needed = neededPool(row.route, spedRoutes);
        const kind = needed === 'sped' ? 'sped spare' : needed === 'reg' ? 'regular-ed spare' : 'spare';
        shortages.push(`No open ${kind} is left for ${outOfServiceWho(row)}.`);
      }
    }
  }
  return { moves, shortages };
}

export function outOfServiceManagerView(rows, { sped = [], reg = [], spedRoutes = [], wheelchairs = {} } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const legacy = list.filter((row) => !hasPortionSpares(row));
  const proposed = proposeSpareAssignments(legacy, { sped, reg, spedRoutes, wheelchairs });
  const notes = proposalNotes(legacy, proposed, sped, reg, spedRoutes, wheelchairs);
  const portionNotes = portionFillNotes(list, sped, reg, spedRoutes, wheelchairs);
  const lines = [...notes.moves, ...portionNotes.moves, ...notes.shortages, ...portionNotes.shortages];
  const button = notes.moves.length
    ? `<button type="button" data-oos-apply>${notes.moves.length > 1 ? 'Switch assignments' : 'Assign'}</button>`
    : '';
  const suggestions = lines.length
    ? `<div class="board-oos-suggestion"><ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>${button}</div>`
    : '';
  const buses = list.length
    ? list
        .map((row) => {
          const fit = rowFit(row, sped, reg, spedRoutes, wheelchairs);
          const note = row.note ? `<p class="board-card-detail">${escapeHtml(row.note)}</p>` : '';
          const title = row.route ? `Route ${escapeHtml(row.route)}` : `Bus ${escapeHtml(row.usualBus)}`;
          const chairs = routeWheelchairNeed(wheelchairs, row.route);
          const customDays = hasPortionSpares(row) ? Object.keys(portionSpareDays(row.days)).length : 0;
          const dayLine = customDays
            ? `<p class="board-card-detail">Some days use a different spare.</p><button type="button" data-oos-edit="${escapeHtml(row.id)}">Edit days</button>`
            : hasPortionSpares(row)
              ? `<button type="button" data-oos-edit="${escapeHtml(row.id)}">Edit days</button>`
              : '';
          const detail = [
            runLabel(row.run),
            `Usual bus ${escapeHtml(row.usualBus)} is out`,
            escapeHtml(coversLabel(row.covers)),
            chairs ? `Needs ${escapeHtml(wheelchairPhrase(chairs))}` : '',
          ]
            .filter(Boolean)
            .join(' · ');
          const selects = portionRun(row.run)
            ? spareSelectMarkup(list, row, sped, reg)
            : PORTION_RUNS.map((portion) => spareSelectMarkup(list, row, sped, reg, portion)).join('');
          return `<article class="board-card board-card-oos"><p class="board-card-title">${title}</p><p class="board-card-detail">${detail}</p>${note}${dayLine}${selects}<p class="board-oos-fit ${fit.ok ? 'is-ok' : 'is-bad'}">${escapeHtml(fit.text)}</p><button type="button" class="board-remove" data-oos-id="${escapeHtml(row.id)}">Take down</button></article>`;
        })
        .join('')
    : '<p class="board-empty">No buses are out of service.</p>';
  const known = new Set([...(sped || []), ...(reg || [])].map((row) => busKey(row.bus)));
  const other = [];
  for (const row of list) {
    const buses = hasPortionSpares(row) ? PORTION_RUNS.map((portion) => row.spares?.[portion]) : [row.spareBus];
    for (const spare of buses) {
      const key = busKey(spare);
      if (!key || known.has(key) || other.some((item) => busKey(item.bus) === key)) continue;
      other.push({ bus: clean(spare), kind: '' });
    }
  }
  const pool = (title, choices, tone) =>
    `<section class="board-spare-pool is-${tone}"><h3>${title}</h3><ul class="board-oos-spare-list">${(choices || []).filter((row) => clean(row.bus)).map((row) => sparePlaceMarkup(clean(row.bus), row.kind, list)).join('') || '<li class="board-oos-spare-row"><p class="board-oos-spare-use">None listed</p></li>'}</ul></section>`;
  const otherPool = other.length ? pool('Other buses in use', other, 'reg') : '';
  return {
    summary: managerSummary(list, sped, reg, spedRoutes, wheelchairs),
    suggestions,
    buses,
    spares: `<div class="board-spare-columns">${pool('Sped spare buses', sped, 'sped')}${pool('Reg ed spares', reg, 'reg')}</div>${otherPool}`,
  };
}

const BOARD_RUNS = ['AM', 'MID', 'PM'];

// A blank run is out for the whole day, so the same spare shows in every column.
function runsForOutOfService(row) {
  const run = clean(row?.run).toUpperCase();
  if (BOARD_RUNS.includes(run)) return [run];
  return BOARD_RUNS;
}

function outOfServicePair(row, run, date) {
  const usual = clean(row?.usualBus);
  if (hasPortionSpares(row)) {
    const spare = spareForPortion(row, run, date);
    return spare ? `${usual}-${spare}` : usual;
  }
  return `${usual}-${clean(row?.spareBus)}`;
}

function outOfServicePairLabel(row, run, date) {
  const bus = clean(row?.usualBus);
  const spare = hasPortionSpares(row) ? spareForPortion(row, run, date) : clean(row?.spareBus);
  return spare ? `Bus ${bus} out, spare ${spare}` : `Bus ${bus} out, no spare`;
}

// The board window is a status list: bus-spare under AM, MID, and PM.
// date picks that day's spare when a row has a calendar override.
export function outOfServiceMarkup(rows, date = '') {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => clean(row?.usualBus));
  if (!list.length) {
    return '<p class="board-empty">No buses are out of service.</p>';
  }
  const columns = BOARD_RUNS.map((run) => {
    const seen = new Set();
    const pairs = list
      .filter((row) => runsForOutOfService(row).includes(run))
      .sort((a, b) => clean(a.usualBus).localeCompare(clean(b.usualBus), undefined, { numeric: true }))
      .filter((row) => {
        const pair = outOfServicePair(row, run, date);
        if (seen.has(pair)) return false;
        seen.add(pair);
        return true;
      });
    const items = pairs.length
      ? pairs
          .map(
            (row) =>
              `<li aria-label="${escapeHtml(outOfServicePairLabel(row, run, date))}">${escapeHtml(outOfServicePair(row, run, date))}</li>`
          )
          .join('')
      : '<li class="board-oos-none">—</li>';
    return `<section class="board-oos-run" aria-label="${run}"><h3>${run}</h3><ul>${items}</ul></section>`;
  });
  return `<div class="board-oos-runs">${columns.join('')}</div>`;
}

const PILL_TONE_LABEL = {
  waiting: 'has not started',
  neutral: 'not yet powered on',
  yellow: 'not yet powered on',
  pending: 'checking Power On',
  dark: 'never powered on',
  held: 'dismissed, never powered on',
  missed: 'never powered on',
  on: 'powered on',
  quiet: '',
};

function personIcon() {
  return '<svg class="board-dark-person" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
}

function pillFactsMarkup(pill, nowMinutes) {
  if (pill.tone === 'on') return '';
  if (pill.tone === 'pending') {
    return `<span class="board-dark-spinner" role="status"><span class="visually-hidden">Checking Power On</span></span><span class="board-dark-facts"><span>Checking Power On</span></span>`;
  }
  const lines = darkBusPillFacts(pill, nowMinutes).map((line) => `<span>${escapeHtml(line)}</span>`).join('');
  return `<span class="board-dark-facts">${lines}</span>`;
}

export function darkBusPageMarkup(runs, { nowMinutes, graceMinutes = 0, tab = 'AM', acknowledged = [] } = {}) {
  const tabName = clean(tab).toUpperCase();
  const groups = darkBusGroups(darkBusPills(runs, nowMinutes, graceMinutes, acknowledged), tabName);
  if (!groups.length) {
    const later = (runs || []).some((run) => {
      const clockIn = minutesOf(run?.clockIn);
      return clean(run?.run).toUpperCase() === tabName && clockIn != null && nowMinutes < clockIn;
    });
    return later
      ? '<p class="board-empty">No clock-ins yet.</p>'
      : '<p class="board-empty">No routes on this run.</p>';
  }
  return groups
    .map((group) => {
      const cards = group.pills
        .map((pill) => {
          const who = pill.driver || 'No driver';
          const face = pill.photo
            ? `<img class="board-dark-photo" src="${escapeHtml(pill.photo)}" alt="" />`
            : personIcon();
          const title = pill.route ? `Route ${escapeHtml(pill.route)}` : `Bus ${escapeHtml(pill.bus)}`;
          const bus = pill.bus ? `<span class="board-dark-bus">Bus ${escapeHtml(pill.bus)}</span>` : '';
          const spoken = [pill.route ? `Route ${pill.route}` : `Bus ${pill.bus}`, who, PILL_TONE_LABEL[pill.tone]]
            .filter(Boolean)
            .join(', ');
          const facts = pillFactsMarkup(pill, nowMinutes);
          const text = `<span class="board-dark-face">${face}</span><span class="board-dark-pill-text"><span class="board-dark-route">${title}</span><span class="board-dark-driver">${escapeHtml(who)}</span>${bus}${facts}</span>`;
          // A flashing route owns its alarm. Clicking that pill stops only that route.
          if (pill.tone === 'dark') {
            const key = escapeHtml(darkBusKey(pill));
            const label = escapeHtml(`${spoken}. Click to stop this route's alarm`);
            return `<article class="board-dark-pill is-dark"><button type="button" class="board-dark-quiet" data-dark-key="${key}" aria-label="${label}">${text}</button></article>`;
          }
          return `<article class="board-dark-pill is-${pill.tone}" aria-label="${escapeHtml(spoken)}">${text}</article>`;
        })
        .join('');
      return `<section class="board-dark-group"><h3>${escapeHtml(group.label)}</h3><div class="board-dark-pills">${cards}</div></section>`;
    })
    .join('');
}

const STUDENT_TONE_LABEL = {
  neutral: 'Student Check has not started',
  yellow: 'back at the yard, waiting on the Student Check',
  dark: 'Student Check is late',
  held: 'dismissed, still no Student Check',
  on: 'Student Check done',
};

function studentFactsMarkup(pill, nowMinutes) {
  if (pill.tone === 'on') {
    const line = studentCheckPillFacts(pill, nowMinutes)[0] || '';
    return line ? `<span class="board-dark-facts"><span>${escapeHtml(line)}</span></span>` : '';
  }
  const lines = studentCheckPillFacts(pill, nowMinutes).map((line) => `<span>${escapeHtml(line)}</span>`).join('');
  return `<span class="board-dark-facts">${lines}</span>`;
}

export function studentCheckPageMarkup(runs, { nowMinutes, graceMinutes = 0, tab = 'MID', acknowledged = [], visits = [], returns = [], checks = new Map(), inspectionsKnown = true } = {}) {
  const tabName = clean(tab).toUpperCase();
  const context = { visits, returns, checks, acknowledged, inspectionsKnown };
  const groups = darkBusGroups(studentCheckPills(runs, nowMinutes, graceMinutes, context), tabName);
  if (!groups.length) {
    const later = (runs || []).some((run) => {
      const clockIn = minutesOf(run?.clockIn);
      return clean(run?.run).toUpperCase() === tabName && clockIn != null && nowMinutes < clockIn;
    });
    return later
      ? '<p class="board-empty">No clock-ins yet.</p>'
      : '<p class="board-empty">No routes on this run.</p>';
  }
  return groups
    .map((group) => {
      const cards = group.pills
        .map((pill) => {
          const who = pill.driver || 'No driver';
          const face = pill.photo
            ? `<img class="board-dark-photo" src="${escapeHtml(pill.photo)}" alt="" />`
            : personIcon();
          const title = pill.route ? `Route ${escapeHtml(pill.route)}` : `Bus ${escapeHtml(pill.bus)}`;
          const bus = pill.bus ? `<span class="board-dark-bus">Bus ${escapeHtml(pill.bus)}</span>` : '';
          const spoken = [pill.route ? `Route ${pill.route}` : `Bus ${pill.bus}`, who, STUDENT_TONE_LABEL[pill.tone]]
            .filter(Boolean)
            .join(', ');
          const facts = studentFactsMarkup(pill, nowMinutes);
          const text = `<span class="board-dark-face">${face}</span><span class="board-dark-pill-text"><span class="board-dark-route">${title}</span><span class="board-dark-driver">${escapeHtml(who)}</span>${bus}${facts}</span>`;
          if (pill.tone === 'dark') {
            const key = escapeHtml(studentCheckKey(pill));
            const label = escapeHtml(`${spoken}. Click to stop this route's alarm`);
            return `<article class="board-dark-pill is-dark"><button type="button" class="board-dark-quiet" data-student-key="${key}" aria-label="${label}">${text}</button></article>`;
          }
          return `<article class="board-dark-pill is-${pill.tone}" aria-label="${escapeHtml(spoken)}">${text}</article>`;
        })
        .join('');
      return `<section class="board-dark-group"><h3>${escapeHtml(group.label)}</h3><div class="board-dark-pills">${cards}</div></section>`;
    })
    .join('');
}

function activityName(run) {
  const driver = clean(run?.driver);
  if (driver && !/^open$/i.test(driver)) return driver.split(/\s+/)[0];
  if (clean(run?.route)) return `Route ${clean(run.route)}`;
  if (clean(run?.bus)) return `Bus ${clean(run.bus)}`;
  return 'A driver';
}

// One line for each run that has both a clock-in and a Power On.
// Newest Power On first, so the list reads as a running log.
export function powerOnActivity(runs) {
  return (runs || [])
    .flatMap((run) => {
      const clockIn = minutesOf(run?.clockIn);
      const poweredOn = minutesOf(run?.poweredOnAt);
      if (clockIn == null || poweredOn == null) return [];
      const name = activityName(run);
      return [
        {
          at: poweredOn,
          clockIn,
          name,
          text: `${name} powered on at ${formatBoardClock(poweredOn)} for the ${formatBoardClock(clockIn)} clock-in`,
        },
      ];
    })
    .sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
}

export function powerOnActivityMarkup(runs) {
  const lines = powerOnActivity(runs);
  if (!lines.length) return '<h2>Activity</h2><p class="board-empty">No Power Ons yet.</p>';
  const rows = lines.map((line) => `<li>${escapeHtml(line.text)}</li>`).join('');
  return `<h2>Activity</h2><ol class="board-dark-activity-log">${rows}</ol>`;
}

export function darkBusMarkup(alerts, { editable = false, acknowledged = [] } = {}) {
  const acked = new Set(acknowledged || []);
  const visible = (alerts || []).filter((alert) => !acked.has(darkBusKey(alert)));
  if (!visible.length) {
    return '<p class="board-empty">No dark buses right now.</p>';
  }
  return visible
    .map((alert) => {
      const title = alert.bus ? `Bus ${escapeHtml(alert.bus)}` : `Route ${escapeHtml(alert.route)}`;
      const detail = [
        alert.route ? `Route ${escapeHtml(alert.route)}` : alert.source === 'usual' ? 'Usual start' : '',
        runLabel(alert.run),
        `Clock-in ${formatBoardClock(alert.clockIn)}`,
        alert.due == null ? '' : `Due ${formatBoardClock(alert.due)}`,
        alert.poweredOnAt == null ? '' : `Power On ${formatBoardClock(alert.poweredOnAt)}`,
        alert.alertedAt == null ? '' : `Alerted ${formatBoardClock(alert.alertedAt)}`,
      ]
        .filter(Boolean)
        .join(' · ');
      const key = darkBusKey(alert);
      const dismiss = `<button type="button" class="board-alert-dismiss" data-dark-dismiss="${escapeHtml(key)}">Dismiss</button>`;
      return `<article class="board-card board-card-alert"><div class="board-alert-head"><p class="board-card-title">${title}</p><p class="board-card-detail">${detail}</p>${dismiss}</div></article>`;
    })
    .join('');
}

const ABSENCE_PERIOD_MARK = [
  { id: 'AM', label: 'AM', className: 'board-period-am' },
  { id: 'MID', label: 'Mid day', className: 'board-period-mid' },
  { id: 'PM', label: 'PM', className: 'board-period-pm' },
];

function absentPeriodMarkup(students, period, controls) {
  const rows = students
    .filter((student) => absencePortions(student.when).includes(period.id))
    .map((student) => {
      const actions = controls
        ? `<span class="board-student-actions"><button type="button" class="board-name-edit" data-absence-edit="${escapeHtml(student.id)}">Edit</button><button type="button" class="board-name-delete" data-absence-delete="${escapeHtml(student.id)}" data-absence-portion="${period.id}">Delete</button></span>`
        : '';
      const note = student.kind === 'note';
      const tag = note ? '<span class="board-note-tag">Note</span>' : '';
      return `<li class="board-student${note ? ' is-note' : ''}">${tag}<span class="board-student-name">${escapeHtml(student.name)}</span>${actions}</li>`;
    })
    .join('');
  if (!rows) return '';
  return `<section class="board-period ${period.className}"><h4 class="board-period-label">${period.label}</h4><ul class="board-route-students">${rows}</ul></section>`;
}

function absentRouteMarkup(group, controls) {
  const periods = ABSENCE_PERIOD_MARK.map((period) => absentPeriodMarkup(group.students, period, controls)).join('');
  if (!periods) return '';
  const paint = `background-color:${absentRouteColor(group.route)};border-color:${absentRouteBorder(group.route)}`;
  return `<article class="board-route has-absent" style="${paint}"><h3 class="board-route-name">${escapeHtml(absentRouteNumber(group.route))}</h3><div class="board-route-periods">${periods}</div></article>`;
}

export function absenceMarkup(absences, { routes = [], controls = false } = {}) {
  const board = absentColumns(absences, routes);
  if (!board.columns.length) {
    return '<p class="board-empty">No absent students.</p>';
  }
  const columns = board.columns
    .map((column) => {
      const cards = column.routes.map((group) => absentRouteMarkup(group, controls)).join('');
      return `<div class="board-absent-col">${cards}</div>`;
    })
    .join('');
  return `<div class="board-absent-columns" style="--board-lines:${board.lines}">${columns}</div>`;
}

export function availableMarkup(drivers) {
  if (!drivers.length) {
    return '<p class="board-empty">No drivers are available.</p>';
  }
  const rows = drivers
    .map((driver) => {
      const status = driver.status
        ? `<span class="board-available-status">${escapeHtml(driver.status)}</span>`
        : '<span class="board-available-status is-quiet">—</span>';
      const clock = driver.clockOut == null ? '—' : formatBoardClock(driver.clockOut);
      const available = driver.status ? ' is-available' : '';
      return `<li class="board-available-row${available}"><span class="board-available-route">${escapeHtml(driver.route)}</span><span class="board-available-driver">${escapeHtml(driver.driver)}</span>${status}<span class="board-available-out">${clock}</span></li>`;
    })
    .join('');
  return `<div class="board-available"><div class="board-available-head"><span>Route</span><span>Driver</span><span>Status</span><span>Clock out</span></div><ul class="board-available-list">${rows}</ul></div>`;
}
