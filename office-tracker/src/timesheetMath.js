import { buildBps2026_2027Calendar } from '../../employee-tracker/src/bpsCalendar2026.js';
import { getSchoolDays } from '../../src/logic/calendar.js';
import { parseLegacyStampToDate } from './timesheetNormalize.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * @param {Date} date
 */
export function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * @param {string} value
 */
function compact(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * @param {string} value
 */
function routeKey(value) {
  return compact(value).replace(/\s+/g, '');
}

/**
 * @param {object} row
 */
export function payrollRowKey(row) {
  return `${routeKey(row?.route)}|${compact(row?.lastName)}|${compact(row?.firstName)}`;
}

/**
 * @param {object | null | undefined} row
 */
export function payrollRowLabel(row) {
  if (!row) return '';
  const name = [row.lastName, row.firstName].filter(Boolean).join(', ');
  return row.route ? `${name} · Route ${row.route}` : name;
}

/**
 * @param {object | null | undefined} row
 */
export function formatContractClocks(row) {
  if (!row) return '';
  const runs = [
    ['AM', row.amIn, row.amOut],
    ['Midday', row.middayIn, row.middayOut],
    ['PM', row.pmIn, row.pmOut],
  ];
  return runs
    .filter(([, clockIn, clockOut]) => clockIn || clockOut)
    .map(([label, clockIn, clockOut]) => `${label} ${clockIn || '—'}–${clockOut || '—'}`)
    .join(' · ');
}

/**
 * Exact contracted duration for one day, from the dashboard's current clocks.
 * @param {object | null | undefined} row
 */
export function contractDailyHours(row) {
  if (!row) return 0;
  const parts = [row.amTotalMinutes, row.middayTotalMinutes, row.pmTotalMinutes].filter(
    (minutes) => typeof minutes === 'number' && Number.isFinite(minutes)
  );
  if (parts.length) {
    return Math.round((parts.reduce((sum, minutes) => sum + minutes, 0) / 60) * 100) / 100;
  }
  const rounded = Number(row.fullDayRoundedQuarterHours);
  return Number.isFinite(rounded) ? rounded : 0;
}

/**
 * @param {string | null | undefined} employeeName
 */
function nameForms(employeeName) {
  const raw = compact(employeeName);
  if (!raw) return [];
  const forms = new Set([raw]);
  const comma = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (comma.length >= 2) {
    forms.add(`${comma[0]}, ${comma.slice(1).join(' ')}`);
    forms.add(`${comma.slice(1).join(' ')} ${comma[0]}`);
  }
  return [...forms];
}

/**
 * Match a card header to a dashboard payroll row. Reads the rows; does not change them.
 * @param {object[]} rows
 * @param {{ employee_name?: string | null, route_number?: string | null } | null | undefined} header
 */
export function matchPayrollRow(rows, header) {
  const forms = nameForms(header?.employee_name);
  const route = routeKey(header?.route_number);
  const named = forms.length
    ? rows.filter((row) => {
        const lastFirst = compact(`${row.lastName}, ${row.firstName}`);
        const firstLast = compact(`${row.firstName} ${row.lastName}`);
        return forms.some((form) => form === lastFirst || form === firstLast);
      })
    : [];
  if (named.length === 1) return named[0];
  if (route) {
    const pool = named.length ? named : rows;
    const byRoute = pool.filter((row) => routeKey(row.route) === route);
    if (byRoute.length === 1) return byRoute[0];
  }
  return null;
}

/**
 * @param {number} year
 * @param {number} monthIndex
 * @param {1 | 2} half
 */
export function semiMonthlyDates(year, monthIndex, half) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const dates = [];
  const start = half === 1 ? 1 : 16;
  const end = half === 1 ? 15 : lastDay;
  for (let day = start; day <= end; day += 1) {
    dates.push(new Date(year, monthIndex, day));
  }
  return dates;
}

/**
 * @param {object} row
 * @param {number} defaultYear
 */
function clockDate(row, kind, defaultYear) {
  const iso = kind === 'in' ? row.clock_in_iso : row.clock_out_iso;
  const raw = kind === 'in' ? row.clock_in_raw : row.clock_out_raw;
  if (iso) {
    const parsed = parseLegacyStampToDate(iso, defaultYear);
    if (parsed) return parsed;
  }
  if (raw && raw !== 'REDACTED') return parseLegacyStampToDate(raw, defaultYear);
  return null;
}

function numericTotalHours(row) {
  const value = row.total_hours;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || /redacted/i.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
  }
  return null;
}

function pairHours(row, defaultYear) {
  const printed = numericTotalHours(row);
  if (printed != null) return printed;
  const clockOut = clockDate(row, 'out', defaultYear);
  const clockIn = clockDate(row, 'in', defaultYear);
  if (!clockOut || !clockIn) return null;
  const minutes = Math.round(Math.abs(clockOut.getTime() - clockIn.getTime()) / 60000);
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * @param {object} extraction
 */
export function inferPayPeriod(extraction) {
  const yearHint = extraction?.header?.date_on_card;
  const slash = String(yearHint ?? '').match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  let fallbackYear = new Date().getFullYear();
  let fallbackMonth = new Date().getMonth();
  let fallbackHalf = 1;
  if (slash) {
    const month = parseInt(slash[1], 10);
    const day = parseInt(slash[2], 10);
    let year = parseInt(slash[3], 10);
    if (year < 100) year = year >= 70 ? 1900 + year : 2000 + year;
    if (month >= 1 && month <= 12) {
      fallbackYear = year;
      fallbackMonth = month - 1;
      fallbackHalf = day <= 15 ? 1 : 2;
    }
  }
  const rows = [...(extraction?.front_rows ?? []), ...(extraction?.back_rows ?? [])];
  for (const row of rows) {
    const stamp = clockDate(row, 'in', fallbackYear) || clockDate(row, 'out', fallbackYear);
    if (!stamp) continue;
    return {
      year: stamp.getFullYear(),
      monthIndex: stamp.getMonth(),
      half: stamp.getDate() <= 15 ? 1 : 2,
    };
  }
  return { year: fallbackYear, monthIndex: fallbackMonth, half: fallbackHalf };
}

/**
 * @param {Date} date
 * @param {number} dailyHours
 * @param {{ coverage_start?: string, coverage_end?: string, school_days?: string[] } | null} calendar
 */
function contractedHoursForDate(date, dailyHours, calendar) {
  const key = localDateKey(date);
  const start = calendar?.coverage_start;
  const end = calendar?.coverage_end;
  if (calendar && start && end && key >= start && key <= end) {
    const schoolDays = getSchoolDays(calendar);
    return schoolDays.includes(key) ? dailyHours : 0;
  }
  const day = date.getDay();
  return day === 0 || day === 6 ? 0 : dailyHours;
}

/**
 * @param {object} extraction
 * @param {number} dailyContractHours
 * @param {{ coverage_start?: string, coverage_end?: string, school_days?: string[] } | null} [calendar]
 */
export function compareCardToContract(extraction, dailyContractHours, calendar = null) {
  const period = inferPayPeriod(extraction);
  const dates = semiMonthlyDates(period.year, period.monthIndex, period.half);
  const yearHint = period.year;
  const hoursByDay = new Map();
  const rows = [...(extraction?.front_rows ?? []), ...(extraction?.back_rows ?? [])];
  for (const row of rows) {
    if (row?.crossed_out) continue;
    const anchor = clockDate(row, 'out', yearHint) || clockDate(row, 'in', yearHint);
    if (!anchor) continue;
    const key = localDateKey(anchor);
    if (!dates.some((date) => localDateKey(date) === key)) continue;
    const hours = pairHours(row, yearHint);
    if (hours == null) continue;
    hoursByDay.set(key, Math.round(((hoursByDay.get(key) ?? 0) + hours) * 100) / 100);
  }

  const days = dates.map((date) => {
    const key = localDateKey(date);
    const clockHours = hoursByDay.get(key) ?? 0;
    const contractHours = contractedHoursForDate(date, dailyContractHours, calendar);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    let regular = 0;
    let overtime = 0;
    if (weekend) overtime = clockHours;
    else {
      regular = Math.min(8, clockHours);
      overtime = Math.max(0, Math.round((clockHours - 8) * 100) / 100);
    }
    return {
      date: key,
      label: `${WEEKDAYS[date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}`,
      clockHours,
      contractHours,
      difference: Math.round((clockHours - contractHours) * 100) / 100,
      regular: Math.round(regular * 100) / 100,
      overtime: Math.round(overtime * 100) / 100,
    };
  });

  const total = (field) => Math.round(days.reduce((sum, day) => sum + day[field], 0) * 100) / 100;
  const monthName = dates[0].toLocaleString('en-US', { month: 'long' });
  const last = dates[dates.length - 1].getDate();
  return {
    label: `${monthName} ${dates[0].getDate()}–${last}, ${period.year}`,
    days,
    totals: {
      clockHours: total('clockHours'),
      contractHours: total('contractHours'),
      difference: total('difference'),
      regular: total('regular'),
      overtime: total('overtime'),
    },
  };
}

let schoolCalendar;

export function dashboardSchoolCalendar() {
  if (!schoolCalendar) schoolCalendar = buildBps2026_2027Calendar().calendar;
  return schoolCalendar;
}
