// Which clock minutes count as overtime, and the pay multiplier.
// The starting rules match the Teamsters contract and can be changed
// in Timeclock settings and on Payroll.

import { BELLINGHAM_2026_2027_INPUT } from '../../employee-tracker/src/bellinghamCalendar2026.js';
import { parseClockTime, roundClockToQuarterHour } from '../../src/logic/timeUtils.js';

export const DEFAULT_OVERTIME_RULES = {
  dailyHours: 8,
  weeklyHours: 40,
  eveningStart: '17:30',
  morningEnd: '05:30',
  weekendOvertime: true,
  holidayOvertime: true,
  multiplier: 1.5,
};

function optionalHours(value, max) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max) return null;
  return Math.round(number * 100) / 100;
}

function optionalClock(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function multiplierOf(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1 || number > 3) return DEFAULT_OVERTIME_RULES.multiplier;
  return Math.round(number * 100) / 100;
}

// Missing rules use the contract defaults. A blank hour or time turns that rule off.
export function normalizeOvertimeRules(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!source) return { ...DEFAULT_OVERTIME_RULES };
  const has = (key) => Object.prototype.hasOwnProperty.call(source, key);
  return {
    dailyHours: has('dailyHours') ? optionalHours(source.dailyHours, 24) : DEFAULT_OVERTIME_RULES.dailyHours,
    weeklyHours: has('weeklyHours') ? optionalHours(source.weeklyHours, 80) : DEFAULT_OVERTIME_RULES.weeklyHours,
    eveningStart: has('eveningStart') ? optionalClock(source.eveningStart) : DEFAULT_OVERTIME_RULES.eveningStart,
    morningEnd: has('morningEnd') ? optionalClock(source.morningEnd) : DEFAULT_OVERTIME_RULES.morningEnd,
    weekendOvertime: has('weekendOvertime') ? source.weekendOvertime !== false : true,
    holidayOvertime: has('holidayOvertime') ? source.holidayOvertime !== false : true,
    multiplier: has('multiplier') ? multiplierOf(source.multiplier) : DEFAULT_OVERTIME_RULES.multiplier,
  };
}

// School-calendar holidays. A holiday counts only when that rule is on.
export function overtimeHolidayDates(holidays) {
  const list = Array.isArray(holidays) ? holidays : BELLINGHAM_2026_2027_INPUT.holidays || [];
  return new Set(list.map((holiday) => holiday.date));
}

// Name of the school-calendar holiday on this date. Blank on every other day.
export function holidayLabelForDate(date, holidays) {
  const key = String(date || '');
  const list = Array.isArray(holidays) ? holidays : BELLINGHAM_2026_2027_INPUT.holidays || [];
  const holiday = list.find((item) => item.date === key);
  return holiday ? String(holiday.label || '').trim() : '';
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Monday that starts the work week containing this minute.
function weekKey(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay();
  const back = day === 0 ? 6 : day - 1;
  copy.setDate(copy.getDate() - back);
  return dateKey(copy);
}

function clockLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour = hours % 12 || 12;
  return `${hour}:${String(mins).padStart(2, '0')} ${suffix}`;
}

function clockText(date) {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function dateFromClock(base, clock) {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  date.setMinutes(parseClockTime(clock));
  return date;
}

// Clock in stays on its punched day. A clock out earlier than the clock in is the next day.
function spanFromClocks(anchor, clockIn, clockOut) {
  if (!clockIn || !clockOut) return null;
  const start = dateFromClock(anchor, clockIn);
  const end = dateFromClock(anchor, clockOut);
  if (parseClockTime(clockOut) < parseClockTime(clockIn)) end.setDate(end.getDate() + 1);
  if (end <= start) return null;
  return { start, end };
}

function prepared(rules) {
  return {
    ...rules,
    dailyMinutes: rules.dailyHours == null ? null : Math.round(rules.dailyHours * 60),
    weeklyMinutes: rules.weeklyHours == null ? null : Math.round(rules.weeklyHours * 60),
    eveningStartMin: rules.eveningStart ? parseClockTime(rules.eveningStart) : null,
    morningEndMin: rules.morningEnd ? parseClockTime(rules.morningEnd) : null,
  };
}

function countSpan(start, end, ledger, rules, holidays) {
  let minutes = 0;
  const reasons = new Set();
  const cursor = new Date(start);
  while (cursor < end) {
    const key = dateKey(cursor);
    const week = weekKey(cursor);
    const clock = cursor.getHours() * 60 + cursor.getMinutes();
    const daySoFar = ledger.day.get(key) || 0;
    const weekSoFar = ledger.week.get(week) || 0;
    const weekend = rules.weekendOvertime && (cursor.getDay() === 0 || cursor.getDay() === 6);
    const holiday = rules.holidayOvertime && holidays.has(key);
    const evening = rules.eveningStartMin != null && clock >= rules.eveningStartMin;
    const morning = rules.morningEndMin != null && clock < rules.morningEndMin;
    const overDay = rules.dailyMinutes != null && daySoFar >= rules.dailyMinutes;
    const overWeek = rules.weeklyMinutes != null && weekSoFar >= rules.weeklyMinutes;
    if (weekend || holiday || evening || morning || overDay || overWeek) {
      minutes += 1;
      if (weekend) reasons.add(cursor.getDay() === 0 ? 'Sunday' : 'Saturday');
      if (holiday) reasons.add('holiday');
      if (evening) reasons.add(`at or after ${clockLabel(rules.eveningStartMin)}`);
      if (morning) reasons.add(`before ${clockLabel(rules.morningEndMin)}`);
      if (overDay) reasons.add(`over ${rules.dailyHours} hours in the day`);
      if (overWeek) reasons.add(`over ${rules.weeklyHours} hours in the week`);
    }
    ledger.day.set(key, daySoFar + 1);
    ledger.week.set(week, weekSoFar + 1);
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return { minutes, reasons: [...reasons] };
}

export function pairOvertimeKey(pair) {
  return `${pair.clockIn?.id || ''}|${pair.clockOut?.id || ''}|${pair.start?.toISOString?.() || ''}`;
}

// Actual, snapped, and quarter-hour overtime minutes for each clock pair.
// Day and week totals count earlier pairs first, including pairs outside the sheet.
export function overtimeForPairs(pairs, rules, holidays) {
  const normalized = prepared(normalizeOvertimeRules(rules));
  const holidayDates = normalized.holidayOvertime ? overtimeHolidayDates(holidays) : new Set();
  const ordered = [...(pairs || [])].filter((pair) => pair?.start instanceof Date && pair?.end instanceof Date && pair.end > pair.start);
  ordered.sort((a, b) => a.start.getTime() - b.start.getTime() || pairOvertimeKey(a).localeCompare(pairOvertimeKey(b)));
  const out = new Map();
  const actualLedger = { day: new Map(), week: new Map() };
  for (const pair of ordered) {
    const span = spanFromClocks(pair.start, clockText(pair.start), clockText(pair.end));
    const counted = span ? countSpan(span.start, span.end, actualLedger, normalized, holidayDates) : { minutes: 0, reasons: [] };
    out.set(pairOvertimeKey(pair), {
      actual: counted.minutes,
      snap: 0,
      rounded: Math.round(counted.minutes / 15) * 15,
      reasons: counted.reasons,
      snapReasons: [],
    });
  }
  const snapLedger = { day: new Map(), week: new Map() };
  const snapped = ordered
    .map((pair) => {
      const span = spanFromClocks(pair.start, roundClockToQuarterHour(clockText(pair.start)), roundClockToQuarterHour(clockText(pair.end)));
      return span ? { pair, span } : null;
    })
    .filter(Boolean);
  snapped.sort((a, b) => a.span.start.getTime() - b.span.start.getTime() || pairOvertimeKey(a.pair).localeCompare(pairOvertimeKey(b.pair)));
  for (const item of snapped) {
    const counted = countSpan(item.span.start, item.span.end, snapLedger, normalized, holidayDates);
    const row = out.get(pairOvertimeKey(item.pair));
    if (!row) continue;
    row.snap = counted.minutes;
    row.snapReasons = counted.reasons;
  }
  return out;
}
