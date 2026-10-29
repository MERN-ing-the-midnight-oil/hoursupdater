import { annotatePunch, changePunch } from './clockKiosk.js';
import { isChangeEvent } from './stateMachine.js';
import { driverNameOnChange } from './clockSheet.js';
import {
  buildTimesheet,
  listPeriods,
  localDateKey,
  periodFromDate,
  presentPeriod,
  segmentForClock,
} from './timesheets.js';

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function compactName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function samePeriod(left, right) {
  return left.year === right.year && left.monthIndex === right.monthIndex && left.half === right.half;
}

function clockLabel(date) {
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

function runLabel(date) {
  const segment = segmentForClock(date);
  if (segment === 'am') return 'AM';
  if (segment === 'midday') return 'Midday';
  return 'PM';
}

function roundHours(value) {
  return Math.round(value * 100) / 100;
}

/**
 * A punch belongs to this signed-in driver by id or by the office name.
 * @param {{ driver_id?: string, driver_name?: string }} punch
 * @param {{ ids?: string[], name?: string }} driver
 */
export function punchOwnedBy(punch, driver) {
  const ids = new Set((driver?.ids || []).map((id) => String(id || '').trim()).filter(Boolean));
  if (ids.has(String(punch?.driver_id || '').trim())) return true;
  const wanted = compactName(driver?.name);
  return Boolean(wanted) && compactName(punch?.driver_name) === wanted;
}

/**
 * Clock-time changes for one driver. Starting rows, where the time did not
 * move, stay off this list. The office writes these. A driver only reads them.
 * @param {Array<Record<string, unknown>>} changeLog
 * @param {{ ids?: string[], name?: string }} driver
 */
export function timeChangesForDriver(changeLog, driver) {
  const ids = new Set((driver?.ids || []).map((id) => String(id || '').trim()).filter(Boolean));
  const name = compactName(driver?.name);
  const rows = [];
  for (const entry of changeLog || []) {
    if (!isChangeEvent(entry) || !entry.route_id || !entry.segment) continue;
    const previous = String(entry.previous_time || '').trim();
    const next = String(entry.new_time || '').trim();
    if (!previous || !next || previous === next) continue;
    const held = driverNameOnChange(changeLog, entry);
    const stamped = String(entry.driver_id || '').trim();
    const named = compactName(entry.driver_name) === name || compactName(held) === name;
    if (!named && !ids.has(stamped)) continue;
    rows.push({
      id: String(entry.id || ''),
      route_id: String(entry.route_id),
      segment: runLabelFromSegment(entry.segment),
      date: String(entry.effective_date || '').slice(0, 10),
      previous_time: previous,
      new_time: next,
      note: String(entry.note || '').trim(),
    });
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
  return rows;
}

function runLabelFromSegment(segment) {
  if (segment === 'MIDDAY') return 'Midday';
  if (segment === 'AM' || segment === 'PM') return segment;
  return String(segment || '');
}

function timeOnSameDay(punchedAt, timeText) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeText || '').trim());
  if (!match) fail('Enter the clock time as hours and minutes.');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) fail('That clock time is not valid.');
  const original = new Date(punchedAt);
  if (Number.isNaN(original.getTime())) fail('That clock time is not on the card.');
  const next = new Date(original.getFullYear(), original.getMonth(), original.getDate(), hours, minutes, 0, 0);
  if (localDateKey(next) !== localDateKey(original)) {
    fail('A clock time stays on the day it was punched.');
  }
  return next.toISOString();
}

/**
 * Move a clock time, and replace the comment, on the driver's own punch.
 * The pay period that contains `now` is the only one a driver can change.
 * The day does not move, and the punch is not added or removed.
 * @param {Array<Record<string, unknown>>} punches
 * @param {string} punchId
 * @param {{
 *   driver: { ids?: string[], name?: string },
 *   time?: string,
 *   note?: string,
 *   now?: Date | string,
 *   catalog?: unknown[],
 * }} input
 */
export function applyDriverClockEdit(punches, punchId, input) {
  const list = Array.isArray(punches) ? punches : [];
  const current = list.find((row) => row?.id === punchId);
  if (!current) fail('That clock time is not on the card.', 404);
  if (!punchOwnedBy(current, input.driver)) fail('That record is for a different driver.', 403);
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  if (Number.isNaN(now.getTime())) fail('That clock time is not valid.');
  const open = periodFromDate(now);
  const punched = new Date(current.punched_at);
  if (Number.isNaN(punched.getTime()) || !samePeriod(periodFromDate(punched), open)) {
    fail('That pay period is closed. You can read it, not change it.');
  }
  let nextList = list;
  let punch = current;
  if (input.time != null && String(input.time).trim() !== '') {
    const punched_at = timeOnSameDay(current.punched_at, input.time);
    const moved = changePunch(nextList, punchId, { punched_at }, { now: now.toISOString() });
    nextList = moved.punches;
    punch = moved.punch;
  }
  if (input.note != null || Array.isArray(input.reasons)) {
    const reasons = Array.isArray(input.reasons) ? reasonPicks(input.reasons) : null;
    const noted = annotatePunch(nextList, punchId, {
      driver_id: punch.driver_id,
      note: input.note == null ? punch.note : input.note,
      ...(reasons ? { reason_code_ids: reasons.map((row) => row.id) } : {}),
      now: now.toISOString(),
      catalog: input.catalog || [],
    });
    nextList = noted.punches;
    punch = noted.punch;
    if (reasons) {
      const minutes = new Map(reasons.map((row) => [row.id, row.minutes]));
      punch = {
        ...punch,
        reason_codes: punch.reason_codes.map((code) => ({ ...code, minutes: minutes.get(code.id) })),
      };
      const index = nextList.findIndex((row) => row.id === punchId);
      nextList = nextList.slice();
      nextList[index] = punch;
    }
  }
  return { punches: nextList, punch };
}

function reasonPicks(reasons) {
  const picks = [];
  const seen = new Set();
  for (const item of reasons) {
    const id = String(item?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const minutes = Number(item?.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) {
      fail('Use whole minutes, up to 1440.');
    }
    picks.push({ id, minutes });
  }
  return picks;
}

function presentPunch(punch, now) {
  const date = new Date(punch.punched_at);
  const open = !Number.isNaN(date.getTime()) && samePeriod(periodFromDate(date), periodFromDate(now));
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return {
    id: punch.id,
    action: punch.action === 'out' ? 'Clock out' : 'Clock in',
    punched_at: punch.punched_at,
    label: Number.isNaN(date.getTime()) ? '' : clockLabel(date),
    time_value: Number.isNaN(date.getTime()) ? '' : `${hours}:${minutes}`,
    date: Number.isNaN(date.getTime()) ? '' : localDateKey(date),
    run: Number.isNaN(date.getTime()) ? '' : runLabel(date),
    note: String(punch.note || ''),
    reasons: (punch.reason_codes || [])
      .filter((code) => code?.id && code?.label)
      .map((code) => ({
        id: String(code.id),
        label: String(code.label),
        minutes: Number.isInteger(code.minutes) ? code.minutes : null,
      })),
    editable: open,
  };
}

function clockLines(routes) {
  return (routes || []).map((route) => ({
    route_id: String(route.route_id || ''),
    am: route.segments?.AM || '',
    midday: route.segments?.MIDDAY || '',
    pm: route.segments?.PM || '',
  }));
}

function summaryFromSheet(sheet) {
  const days = (sheet.days || []).map((day) => ({
    date: day.date,
    label: day.label,
    clock_hours: day.clockHours,
    contract_hours: day.contractHours,
    difference: day.difference,
    regular: day.regular,
    overtime: day.overtime,
  }));
  const totals = days.reduce(
    (sum, day) => ({
      clock_hours: roundHours(sum.clock_hours + day.clock_hours),
      contract_hours: roundHours(sum.contract_hours + day.contract_hours),
      regular: roundHours(sum.regular + day.regular),
      overtime: roundHours(sum.overtime + day.overtime),
    }),
    { clock_hours: 0, contract_hours: 0, regular: 0, overtime: 0 }
  );
  return {
    period: sheet.period,
    contract_text: sheet.contract_text,
    totals,
    days,
  };
}

/**
 * Read-only changes and summaries, plus the open time card.
 * @param {{
 *   changeLog?: Array<Record<string, unknown>>,
 *   punches?: Array<Record<string, unknown>>,
 *   routes?: Array<{ route_id?: string, segments?: object }>,
 *   calendar?: object,
 *   driver: { ids?: string[], name?: string, email?: string, clock_id?: string },
 *   now?: Date,
 *   period?: { year: number, monthIndex: number, half: number },
 *   catalog?: Array<{ id?: string, label?: string }>,
 * }} input
 */
export function buildDriverDashboard(input) {
  const now = input.now instanceof Date ? input.now : new Date();
  const driver = input.driver;
  const mine = (input.punches || []).filter((punch) => punchOwnedBy(punch, driver));
  const clockId = String(driver.clock_id || mine[0]?.driver_id || driver.ids?.[0] || '');
  const aligned = mine.map((punch) => ({ ...punch, driver_id: clockId }));
  const summaryPeriod = input.period || periodFromDate(now);
  const sheet = buildTimesheet({
    driver: { driver_id: clockId, name: driver.name || '', email: driver.email || '' },
    punches: aligned,
    routes: input.routes || [],
    calendar: input.calendar,
    period: summaryPeriod,
    extraByDate: {},
  });
  const open = periodFromDate(now);
  return {
    name: driver.name || '',
    reason_catalog: (input.catalog || [])
      .filter((code) => code?.id && code?.label)
      .map((code) => ({ id: String(code.id), label: String(code.label) })),
    changes: timeChangesForDriver(input.changeLog || [], driver),
    clocks: clockLines(input.routes),
    card: {
      period: presentPeriod(open),
      punches: aligned
        .filter((punch) => {
          const date = new Date(punch.punched_at);
          return !Number.isNaN(date.getTime()) && samePeriod(periodFromDate(date), open);
        })
        .sort((a, b) => String(a.punched_at).localeCompare(String(b.punched_at)))
        .map((punch) => presentPunch(punch, now)),
    },
    summaries: {
      periods: listPeriods(aligned, now).map((period) => presentPeriod(period)),
      selected: summaryFromSheet(sheet),
    },
  };
}
