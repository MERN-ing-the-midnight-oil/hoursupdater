import { SEGMENTS } from '../../src/logic/constants.js';
import { createId } from '../../src/logic/createId.js';
import { computeDeltaMinutes, toDateString } from '../../src/logic/timeUtils.js';
import {
  BPS_2026_2027_INPUT,
  BPS_2026_2027_SOURCE,
  buildBps2026_2027Calendar,
} from '../src/bpsCalendar2026.js';
import {
  formatSegmentRange,
  localDateString,
  normalizeClockTime,
  splitSegmentRange,
} from '../src/clockTimes.js';
import {
  EMPLOYEE_ROUTE_ID,
  buildEmployeeSnapshot,
  groupCalendarByMonth,
  previewEmployeeChange,
  rebuildEmployeeRouteState,
} from '../src/snapshot.js';
import * as employeeStore from './store.js';

/** Swappable so the office calculator can keep routes in its own store. */
let store = employeeStore;

export function bindCalculatorStore(next) {
  store = next;
}

let cachedCalendar = null;

export function getAsOfDate(profile) {
  if (typeof globalThis.location?.search === 'string') {
    const value = new URLSearchParams(globalThis.location.search).get('as_of');
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
  }
  if (profile?.view_as_of && /^\d{4}-\d{2}-\d{2}$/.test(profile.view_as_of)) {
    return profile.view_as_of;
  }
  return localDateString();
}

export function getCalendarPack() {
  if (!cachedCalendar) {
    const { calendar, summary, source } = buildBps2026_2027Calendar();
    cachedCalendar = {
      calendar,
      summary,
      source,
      months: groupCalendarByMonth(calendar),
      first_day: BPS_2026_2027_INPUT.first_day,
      last_day: BPS_2026_2027_INPUT.last_day,
    };
  }
  return cachedCalendar;
}

function calendarMeta() {
  const pack = getCalendarPack();
  return {
    calendarSummary: pack.summary,
    calendarSource: pack.source ?? BPS_2026_2027_SOURCE,
  };
}

function requireClockPair(clockIn, clockOut, label) {
  const inTrim = String(clockIn ?? '').trim();
  const outTrim = String(clockOut ?? '').trim();
  if (!inTrim && !outTrim) {
    return null;
  }
  if (!inTrim || !outTrim) {
    throw new Error(`${label} needs both a clock-in and a clock-out.`);
  }
  return formatSegmentRange(inTrim, outTrim);
}

function isSeedEvent(change) {
  return (
    change &&
    change.delta_minutes === 0 &&
    change.previous_time === change.new_time
  );
}

/**
 * After a correction, walk the log so later entries keep a consistent
 * previous → new chain on each run.
 * @param {object[]} changeLog
 * @param {string} [name]
 */
export function relinkChangeLog(changeLog, name = '') {
  const events = [...(changeLog ?? [])].sort((a, b) => {
    const dateCompare = toDateString(a.effective_date).localeCompare(
      toDateString(b.effective_date)
    );
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return String(a.submitted_at).localeCompare(String(b.submitted_at));
  });

  /** @type {Record<string, string | null>} */
  const current = { AM: null, MIDDAY: null, PM: null };

  return events.map((event) => {
    const next = {
      ...event,
      driver_name: name || event.driver_name,
      entered_by: name || event.entered_by || 'Self',
    };
    if (isSeedEvent(event)) {
      current[event.segment] = event.new_time;
      next.previous_time = event.new_time;
      next.computed_delta_minutes = 0;
      next.delta_minutes = 0;
      return next;
    }

    const previous = current[event.segment];
    if (!previous) {
      next.previous_time = event.new_time;
      next.computed_delta_minutes = 0;
      next.delta_minutes = 0;
      current[event.segment] = event.new_time;
      return next;
    }

    const delta = computeDeltaMinutes(previous, event.new_time);
    next.previous_time = previous;
    next.computed_delta_minutes = delta;
    next.delta_minutes = delta;
    current[event.segment] = event.new_time;
    return next;
  });
}

function persistRelinked(profile, storage) {
  profile.changeLog = relinkChangeLog(profile.changeLog, profile.name?.trim() || '');
  store.saveProfile(profile, storage);
  return currentSnapshot(storage);
}

function makeSeedChange({ segment, range, startDate, name, submittedAt }) {
  return {
    id: createId(),
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: name,
    driver_id: null,
    segment,
    submitted_at: submittedAt,
    effective_date: startDate,
    previous_time: range,
    new_time: range,
    computed_delta_minutes: 0,
    delta_minutes: 0,
    routing_adjustment: null,
    reason_category: 'OTHER',
    note: 'Starting schedule',
    entered_by: name || 'Self',
  };
}

/**
 * @param {object | null} profile
 * @param {string} [asOfDate]
 */
export function buildSnapshot(profile, asOfDate = getAsOfDate()) {
  const pack = getCalendarPack();
  const asOf = toDateString(asOfDate);
  if (!profile) {
    return buildEmployeeSnapshot({
      profile: null,
      changeLog: [],
      entry: null,
      calendar: pack.calendar,
      asOfDate: asOf,
      ...calendarMeta(),
    });
  }
  const entry = rebuildEmployeeRouteState(
    profile.changeLog ?? [],
    pack.calendar,
    asOf
  );
  return buildEmployeeSnapshot({
    profile: {
      name: profile.name,
      start_date: profile.start_date,
    },
    changeLog: profile.changeLog ?? [],
    entry,
    calendar: pack.calendar,
    asOfDate: asOf,
    ...calendarMeta(),
  });
}

export function currentSnapshot(storage, asOfDate) {
  const profile = store.getCurrentProfile(storage);
  return buildSnapshot(profile, asOfDate || getAsOfDate(profile));
}

/**
 * @param {object} body
 * @param {Storage} [storage]
 */
export function setupProfile(body, storage) {
  const name = String(body.name ?? '').trim();
  const startDate = toDateString(body.start_date || getAsOfDate());
  const submittedAt = new Date().toISOString();

  /** @type {Array<{ segment: string, range: string }>} */
  const segments = [];
  for (const segment of SEGMENTS) {
    const key = segment.toLowerCase();
    const range = requireClockPair(
      body[`${key}_in`] ?? body[`${key}_clock_in`],
      body[`${key}_out`] ?? body[`${key}_clock_out`],
      segment
    );
    if (range) {
      segments.push({ segment, range });
    }
  }
  if (!segments.length) {
    throw new Error(
      'Enter clock-in and clock-out for at least one run (AM, Midday, or PM).'
    );
  }

  const seeds = segments.map((item, index) =>
    makeSeedChange({
      segment: item.segment,
      range: item.range,
      startDate,
      name,
      submittedAt: new Date(new Date(submittedAt).getTime() + index).toISOString(),
    })
  );

  const profile = {
    id: createId(),
    name,
    start_date: startDate,
    setup_at: submittedAt,
    created_at: submittedAt,
    changeLog: seeds,
  };
  store.saveProfile(profile, storage);
  return currentSnapshot(storage);
}

/**
 * @param {object} body
 * @param {Storage} [storage]
 */
export function previewChange(body, storage) {
  const profile = store.getCurrentProfile(storage);
  const pack = getCalendarPack();
  const asOf = toDateString(body.change_date || getAsOfDate());
  const entry = rebuildEmployeeRouteState(
    profile?.changeLog ?? [],
    pack.calendar,
    asOf
  );
  return previewEmployeeChange({
    entry,
    calendar: pack.calendar,
    segment: String(body.segment || '').trim(),
    clock_in: normalizeClockTime(body.clock_in),
    clock_out: normalizeClockTime(body.clock_out),
    change_date: asOf,
  });
}

/**
 * @param {object} body
 * @param {Storage} [storage]
 */
export function recordChange(body, storage) {
  const profile = store.getCurrentProfile(storage);
  if (!profile) {
    throw new Error('Set up a person first.');
  }

  const segment = String(body.segment || '').trim();
  if (!SEGMENTS.includes(segment)) {
    throw new Error(`segment must be one of: ${SEGMENTS.join(', ')}.`);
  }

  const changeDate = toDateString(
    body.change_date || body.effective_date || getAsOfDate()
  );
  const pack = getCalendarPack();
  const entry = rebuildEmployeeRouteState(
    profile.changeLog,
    pack.calendar,
    changeDate
  );
  if (!entry) {
    throw new Error('Starting schedule is missing. Add this person again.');
  }

  const previous = entry.segments[segment];
  if (!previous) {
    throw new Error(
      `No ${segment} times on file. Add that run when you set up this person.`
    );
  }

  const newTime = formatSegmentRange(body.clock_in, body.clock_out);
  if (newTime === previous) {
    throw new Error('New times are the same as the current times.');
  }

  const delta = computeDeltaMinutes(previous, newTime);
  const name = profile.name?.trim() || 'Self';
  profile.changeLog = [
    ...profile.changeLog,
    {
      id: createId(),
      route_id: EMPLOYEE_ROUTE_ID,
      driver_name: name,
      driver_id: null,
      segment,
      submitted_at: new Date().toISOString(),
      effective_date: changeDate,
      previous_time: previous,
      new_time: newTime,
      computed_delta_minutes: delta,
      delta_minutes: delta,
      routing_adjustment: null,
      reason_category: 'OTHER',
      note: String(body.note ?? '').trim(),
      entered_by: name,
    },
  ];
  store.saveProfile(profile, storage);
  return currentSnapshot(storage);
}

/**
 * @param {string} changeId
 * @param {object} body
 * @param {Storage} [storage]
 */
export function updateChange(changeId, body, storage) {
  const profile = store.getCurrentProfile(storage);
  if (!profile) {
    throw new Error('Set up a person first.');
  }
  const index = profile.changeLog.findIndex((entry) => entry.id === changeId);
  if (index < 0) {
    throw new Error('That change was not found.');
  }
  const existing = profile.changeLog[index];
  if (isSeedEvent(existing)) {
    throw new Error(
      'Correct starting times from the established schedule row, not by editing a later change.'
    );
  }

  const newTime = formatSegmentRange(body.clock_in, body.clock_out);
  const changeDate = toDateString(body.change_date || existing.effective_date);
  profile.changeLog[index] = {
    ...existing,
    effective_date: changeDate,
    new_time: newTime,
    note: body.note != null ? String(body.note).trim() : existing.note,
  };
  profile.changeLog = relinkChangeLog(profile.changeLog, profile.name?.trim() || '');
  const updated = profile.changeLog.find((entry) => entry.id === changeId);
  if (updated && updated.previous_time === updated.new_time) {
    throw new Error('Those times match the previous times. Remove this change instead.');
  }
  store.saveProfile(profile, storage);
  return currentSnapshot(storage);
}

/**
 * @param {string} changeId
 * @param {Storage} [storage]
 */
export function deleteChange(changeId, storage) {
  const profile = store.getCurrentProfile(storage);
  if (!profile) {
    throw new Error('Set up a person first.');
  }
  const existing = profile.changeLog.find((entry) => entry.id === changeId);
  if (!existing) {
    throw new Error('That change was not found.');
  }
  if (isSeedEvent(existing)) {
    throw new Error('Starting times cannot be removed here.');
  }
  profile.changeLog = profile.changeLog.filter((entry) => entry.id !== changeId);
  return persistRelinked(profile, storage);
}

/**
 * Correct the current clock times for one run (edits the last write on that run).
 * @param {object} body
 * @param {Storage} [storage]
 */
export function correctCurrentTimes(body, storage) {
  const profile = store.getCurrentProfile(storage);
  if (!profile) {
    throw new Error('Set up a person first.');
  }
  const segment = String(body.segment || '').trim();
  if (!SEGMENTS.includes(segment)) {
    throw new Error(`segment must be one of: ${SEGMENTS.join(', ')}.`);
  }
  const newTime = formatSegmentRange(body.clock_in, body.clock_out);
  const last = [...profile.changeLog]
    .reverse()
    .find((entry) => entry.segment === segment);
  if (!last) {
    throw new Error(`No ${segment} times on file yet.`);
  }
  if (isSeedEvent(last)) {
    last.previous_time = newTime;
    last.new_time = newTime;
    last.computed_delta_minutes = 0;
    last.delta_minutes = 0;
    return persistRelinked(profile, storage);
  }
  last.new_time = newTime;
  profile.changeLog = relinkChangeLog(profile.changeLog, profile.name?.trim() || '');
  const updated = profile.changeLog.find((entry) => entry.id === last.id);
  if (updated && updated.previous_time === updated.new_time) {
    profile.changeLog = profile.changeLog.filter((entry) => entry.id !== last.id);
  }
  return persistRelinked(profile, storage);
}

/**
 * @param {object} body
 * @param {Storage} [storage]
 */
export function updateStartingSchedule(body, storage) {
  const profile = store.getCurrentProfile(storage);
  if (!profile) {
    throw new Error('Set up a person first.');
  }
  const name = String(body.name ?? profile.name ?? '').trim();
  const startDate = toDateString(body.start_date || profile.start_date || getAsOfDate());
  /** @type {Array<{ segment: string, range: string }>} */
  const segments = [];
  for (const segment of SEGMENTS) {
    const key = segment.toLowerCase();
    const range = requireClockPair(
      body[`${key}_in`] ?? body[`${key}_clock_in`],
      body[`${key}_out`] ?? body[`${key}_clock_out`],
      segment
    );
    if (range) {
      segments.push({ segment, range });
    }
  }
  if (!segments.length) {
    throw new Error('Enter clock-in and clock-out for at least one run.');
  }

  const laterBySegment = new Set(
    profile.changeLog.filter((entry) => !isSeedEvent(entry)).map((entry) => entry.segment)
  );
  for (const segment of laterBySegment) {
    if (!segments.some((item) => item.segment === segment)) {
      throw new Error(
        `Keep ${segment} starting times — later changes still depend on that run.`
      );
    }
  }

  const seeds = profile.changeLog.filter(isSeedEvent);
  const nonSeeds = profile.changeLog.filter((entry) => !isSeedEvent(entry));
  const nextSeeds = segments.map((item, index) => {
    const existing = seeds.find((seed) => seed.segment === item.segment);
    if (existing) {
      return {
        ...existing,
        driver_name: name,
        entered_by: name || 'Self',
        effective_date: startDate,
        previous_time: item.range,
        new_time: item.range,
        computed_delta_minutes: 0,
        delta_minutes: 0,
      };
    }
    return makeSeedChange({
      segment: item.segment,
      range: item.range,
      startDate,
      name,
      submittedAt: new Date(Date.now() + index).toISOString(),
    });
  });

  profile.name = name;
  profile.start_date = startDate;
  profile.changeLog = [...nextSeeds, ...nonSeeds];
  return persistRelinked(profile, storage);
}

/**
 * @param {Storage} [storage]
 */
export function startingScheduleFields(storage) {
  const profile = store.getCurrentProfile(storage);
  if (!profile) {
    return { name: '', start_date: getAsOfDate(), segments: {} };
  }
  /** @type {Record<string, ReturnType<typeof splitSegmentRange>>} */
  const segments = {};
  for (const seed of profile.changeLog.filter(isSeedEvent)) {
    segments[seed.segment] = splitSegmentRange(seed.new_time);
  }
  return {
    name: profile.name || '',
    start_date: profile.start_date || getAsOfDate(),
    segments,
  };
}

export function switchPerson(id, storage) {
  store.setCurrentProfile(id, storage);
  return currentSnapshot(storage);
}

export function removeCurrentPerson(storage) {
  const profile = store.getCurrentProfile(storage);
  if (!profile) {
    return currentSnapshot(storage);
  }
  store.deleteProfile(profile.id, storage);
  return currentSnapshot(storage);
}

export function peopleList(storage) {
  return store.listProfiles(storage).map((profile) => ({
    id: profile.id,
    name: profile.name || 'Unnamed',
    start_date: profile.start_date,
  }));
}

export function calendarPayload() {
  const pack = getCalendarPack();
  return {
    ...pack.calendar,
    months: pack.months,
    source: pack.source,
    first_day: pack.first_day,
    last_day: pack.last_day,
  };
}

export function importBackup(json, storage) {
  store.importState(json, storage);
  return currentSnapshot(storage);
}
