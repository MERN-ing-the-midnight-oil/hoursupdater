// A driver can mark Leave Requested on an AM, midday, or PM route
// instead of clocking in and out. The hours are usually the contracted
// time for that route, and can be less.

import { formatDurationLabel, splitSegmentRange } from '../../employee-tracker/src/clockTimes.js';
import { parseClockTime } from '../../src/logic/timeUtils.js';
import { localDateKey, normalizePunchRun, punchRunLabel } from '../../src/logic/timesheets.js';
import { assignmentOnDate, sameDriver } from './assignments.js';

export const LEAVE_RUNS = ['AM', 'MIDDAY', 'PM'];

// Off until leave requests are ready for drivers. The kiosk button and clock-sheet labels stay hidden.
export const LEAVE_REQUESTS_ENABLED = false;

// Used when the route has no contracted time to compare against.
export const LEAVE_MINUTES_CAP = 12 * 60;

export function normalizeLeaveRun(value) {
  const run = normalizePunchRun(value);
  if (run === 'AM' || run === 'MIDDAY' || run === 'PM') return run;
  return '';
}

function dateKey(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return text;
}

function minuteCount(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1) return 0;
  return minutes;
}

// Leave saved on the office record and on each driver.
// A screen that does not know this field still keeps the copy on the driver.
export function officeLeaveRequests(office) {
  const rows = [];
  if (Array.isArray(office?.leaveRequests)) rows.push(...office.leaveRequests);
  if (Array.isArray(office?.drivers)) {
    for (const driver of office.drivers) {
      if (!Array.isArray(driver?.leaveRequests)) continue;
      const name = String(driver?.name || '').trim();
      for (const row of driver.leaveRequests) {
        rows.push(name && !row?.driver_name ? { ...row, driver_name: name } : row);
      }
    }
  }
  return normalizeLeaveRequests(rows);
}

export function applyLeaveRequests(drivers, requests) {
  const list = Array.isArray(drivers) ? drivers.map((driver) => ({ ...driver })) : [];
  const byName = new Map();
  for (const row of normalizeLeaveRequests(requests)) {
    const key = row.driver_name.toLowerCase();
    const bucket = byName.get(key) || [];
    bucket.push(row);
    byName.set(key, bucket);
  }
  for (const driver of list) {
    const key = String(driver?.name || '').trim().toLowerCase();
    const rows = key ? byName.get(key) || [] : [];
    if (rows.length) driver.leaveRequests = rows;
    else delete driver.leaveRequests;
  }
  return list;
}

export function normalizeLeaveRequests(raw) {
  if (!Array.isArray(raw)) return [];
  const bySlot = new Map();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    const driver_name = String(item.driver_name || '').trim();
    const date = dateKey(item.date);
    const run = normalizeLeaveRun(item.run);
    const minutes = minuteCount(item.minutes);
    const requested = new Date(item.requested_at);
    if (!id || !driver_name || driver_name.length > 80 || !date || !run || !minutes) continue;
    if (Number.isNaN(requested.getTime())) continue;
    const substitute_name = String(item.substitute_name || '').trim();
    const row = {
      id,
      driver_name,
      date,
      run,
      minutes,
      requested_at: requested.toISOString(),
    };
    if (substitute_name && substitute_name.length <= 80) row.substitute_name = substitute_name;
    const slot = `${driver_name.toLowerCase()}|${date}|${run}`;
    const previous = bySlot.get(slot);
    if (!previous || row.requested_at >= previous.requested_at) bySlot.set(slot, row);
  }
  return [...bySlot.values()];
}

export function leaveFor(requests, driverName, date, run) {
  const wanted = String(driverName || '').trim().toLowerCase();
  const day = dateKey(date);
  const segment = normalizeLeaveRun(run);
  if (!wanted || !day || !segment) return null;
  return (
    normalizeLeaveRequests(requests).find(
      (row) => row.driver_name.toLowerCase() === wanted && row.date === day && row.run === segment
    ) || null
  );
}

export function driverClockedIn(punches, driverName, date, run) {
  const wanted = String(driverName || '').trim().toLowerCase();
  const day = dateKey(date);
  const segment = normalizeLeaveRun(run);
  if (!wanted || !day || !segment) return false;
  return (Array.isArray(punches) ? punches : []).some((punch) => {
    if (punch?.removed === true || punch?.action !== 'in') return false;
    if (String(punch?.driver_name || '').trim().toLowerCase() !== wanted) return false;
    if (normalizeLeaveRun(punch?.run) !== segment) return false;
    const when = new Date(punch?.punched_at);
    if (Number.isNaN(when.getTime())) return false;
    return localDateKey(when) === day;
  });
}

// The clock-in minute has passed, so this route was not clocked at its start.
export function clockInHasPassed(clock, now = new Date()) {
  try {
    const minutes = parseClockTime(String(clock ?? ''));
    return now.getHours() * 60 + now.getMinutes() > minutes;
  } catch {
    return false;
  }
}

// Assigned routes whose clock-in has passed, with no clock-in and no leave yet.
export function runsAwaitingLeave(input) {
  const now = input?.now instanceof Date ? input.now : new Date();
  const date = localDateKey(now);
  const awaiting = [];
  for (const run of LEAVE_RUNS) {
    const clock = input?.clockByRun?.[run];
    if (!clock || !clockInHasPassed(clock, now)) continue;
    if (driverClockedIn(input?.punches, input?.driverName || '', date, run)) continue;
    if (leaveFor(input?.requests, input?.driverName || '', date, run)) continue;
    awaiting.push(run);
  }
  return awaiting;
}

export function leaveMinuteLimit(contractedMinutes) {
  const contracted = Number(contractedMinutes);
  if (Number.isInteger(contracted) && contracted > 0) return contracted;
  return LEAVE_MINUTES_CAP;
}

export function leaveMinutesFromParts(hours, minutes) {
  const hourText = String(hours ?? '').trim();
  const minuteText = String(minutes ?? '').trim();
  if (!hourText && !minuteText) return null;
  if ((hourText && !/^\d+$/.test(hourText)) || (minuteText && !/^\d+$/.test(minuteText))) return null;
  const hourCount = Number(hourText || '0');
  const minuteCount = Number(minuteText || '0');
  if (minuteCount > 59) return null;
  const total = hourCount * 60 + minuteCount;
  if (total < 1) return null;
  return total;
}

export function leaveTimeParts(minutes) {
  const total = minuteCount(minutes);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

export function leaveContractLead(contractedMinutes) {
  const minutes = Number(contractedMinutes);
  if (!Number.isInteger(minutes) || minutes < 1) return '';
  return `Contracted time for this route is ${formatDurationLabel(minutes)}. Enter that time, or less.`;
}

export function leaveRequestLead(input) {
  const route = punchRunLabel(normalizeLeaveRun(input?.run)) || 'route';
  if (input?.clockedIn) return `You already clocked in for the ${route} on that day.`;
  if (input?.date && input?.today && input.date > input.today) {
    return `Enter the hours of leave requested for the ${route}.`;
  }
  return `You did not clock in for the ${route}. Enter the hours of leave requested.`;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// A quiet reminder for routes whose clock-in has passed. It does not replace clocking in.
export function missedClockInNote(runs, when) {
  const list = (Array.isArray(runs) ? runs : []).filter(
    (run) => run === 'AM' || run === 'MIDDAY' || run === 'PM'
  );
  if (!list.length || !(when instanceof Date) || Number.isNaN(when.getTime())) return '';
  const day = WEEKDAY_NAMES[when.getDay()];
  const phrases = list.map((run) => `your ${day} ${punchRunLabel(run)}`);
  const missed =
    phrases.length === 1
      ? phrases[0]
      : phrases.length === 2
        ? `${phrases[0]} or ${phrases[1]}`
        : `${phrases.slice(0, -1).join(', ')}, or ${phrases[phrases.length - 1]}`;
  return `You did not clock in for ${missed}. Please record your leave hours or write an explanation.`;
}

export function leaveDateLabel(dateKeyValue) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKeyValue || ''));
  if (!match) return '';
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

export function saveLeaveRequest(requests, input) {
  const driver_name = String(input?.driver_name || '').trim();
  if (!driver_name) throw new Error('Choose a driver.');
  const date = dateKey(input?.date);
  if (!date) throw new Error('Choose a date.');
  const run = normalizeLeaveRun(input?.run);
  if (!run) throw new Error('Choose AM, MIDDAY, or PM.');
  if (driverClockedIn(input?.punches, driver_name, date, run)) {
    throw new Error(`You already clocked in for the ${punchRunLabel(run)} on that day.`);
  }
  const minutes = minuteCount(input?.minutes);
  if (!minutes) throw new Error('Enter the hours of leave requested.');
  const limit = leaveMinuteLimit(input?.contractedMinutes);
  if (minutes > limit) {
    const contracted = Number(input?.contractedMinutes);
    if (Number.isInteger(contracted) && contracted > 0) {
      throw new Error(`That is more than the contracted time of ${formatDurationLabel(contracted)}.`);
    }
    throw new Error('Enter 12 hours or less.');
  }
  const requested = input?.requested_at ? new Date(input.requested_at) : new Date();
  if (Number.isNaN(requested.getTime())) throw new Error('That time is not valid.');
  const current = normalizeLeaveRequests(requests);
  const existing = leaveFor(current, driver_name, date, run);
  const substitute_name = String(input?.substitute_name || '').trim();
  const row = {
    id: existing?.id || String(input?.id || '').trim() || crypto.randomUUID(),
    driver_name,
    date,
    run,
    minutes,
    requested_at: requested.toISOString(),
  };
  if (substitute_name) row.substitute_name = substitute_name.slice(0, 80);
  const slot = `${driver_name.toLowerCase()}|${date}|${run}`;
  const next = current.filter((item) => `${item.driver_name.toLowerCase()}|${item.date}|${item.run}` !== slot);
  next.push(row);
  return next;
}

// Clocking in for that route replaces a leave request for the same day.
export function dropLeaveForClockIn(requests, input) {
  const driver_name = String(input?.driver_name || '').trim().toLowerCase();
  const date = dateKey(input?.date);
  const run = normalizeLeaveRun(input?.run);
  if (!driver_name || !date || !run) return normalizeLeaveRequests(requests);
  return normalizeLeaveRequests(requests).filter(
    (row) => !(row.driver_name.toLowerCase() === driver_name && row.date === date && row.run === run)
  );
}

// Contracted minutes for each run this driver holds on a date.
// The route assigned first supplies a run. A later route fills a run only when that first route does not have it.
export function contractedRunMinutes(profiles, driverName, dateKeyValue, segmentsFor) {
  const result = { AM: null, MIDDAY: null, PM: null };
  const day = dateKey(dateKeyValue);
  if (!String(driverName || '').trim() || !day || typeof segmentsFor !== 'function') return result;
  const held = [];
  const list = profiles && typeof profiles === 'object' ? Object.values(profiles) : [];
  for (const profile of list) {
    const assignment = assignmentOnDate(profile, day);
    if (!assignment || !sameDriver(assignment.driver_name, driverName)) continue;
    let segments = {};
    try {
      segments = segmentsFor(profile, day) || {};
    } catch {
      segments = {};
    }
    const minutes = { AM: null, MIDDAY: null, PM: null };
    for (const run of LEAVE_RUNS) {
      const split = splitSegmentRange(segments?.[run]);
      minutes[run] = split && split.duration_minutes > 0 ? split.duration_minutes : null;
    }
    held.push({
      assignedFrom: assignment.from,
      name: String(profile?.name || ''),
      minutes,
    });
  }
  held.sort((a, b) => {
    const byFrom = String(a.assignedFrom || '9999-99-99').localeCompare(String(b.assignedFrom || '9999-99-99'));
    if (byFrom !== 0) return byFrom;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
  for (const route of held) {
    for (const run of LEAVE_RUNS) {
      if (result[run] || !route.minutes[run]) continue;
      result[run] = route.minutes[run];
    }
  }
  return result;
}
