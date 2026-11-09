import { schoolYearSpan } from '../../src/logic/schoolYear.js';
import { DEFAULT_PAY_PERIODS, normalizePayPeriods } from './driverPay.js';

/**
 * School year that contains a calendar day. Years run July 1 through June 30.
 * @param {Date} date
 */
export function schoolYearLabelForDate(date) {
  const year = date.getFullYear();
  const start = date.getMonth() >= 6 ? year : year - 1;
  return `${start}-${start + 1}`;
}

/**
 * Pay-period ending from the card sticker or an AI read.
 * Accepts MM/DD/YY, MM/DD/YYYY, MM-DD-YY, or YYYY-MM-DD.
 * Returns the calendar day as YYYY-MM-DD, or null when it is not a real date.
 * @param {unknown} value
 */
export function parseCardPeriodEnd(value) {
  const text = String(value ?? '')
    .trim()
    .replace(/[\u2044\u2215\uFF0F]/g, '/')
    .replace(/[\u2013\u2014\u2212]/g, '-');
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return isoFromDate(date);
  }
  const match = text.match(/\b(\d{1,2})\s*[\/-]\s*(\d{1,2})\s*[\/-]\s*(\d{2}|\d{4})\b/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year = year >= 70 ? 1900 + year : 2000 + year;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return isoFromDate(date);
}

function isoFromDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function periodEndDate(year, monthIndex, period) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const end = Math.min(period.endDay, lastDay);
  if (period.startDay > end) return null;
  return new Date(year, monthIndex, end);
}

/**
 * Every pay-period end in a school year, oldest first.
 * The usual year has 24: the 15th, then the last day of each month from July through June.
 * @param {string} schoolYearLabel
 * @param {Array<{ id: string, startDay: number, endDay: number }> | undefined} periods
 */
export function payPeriodsInSchoolYear(schoolYearLabel, periods = DEFAULT_PAY_PERIODS) {
  const span = schoolYearSpan(schoolYearLabel);
  if (!span) return [];
  const normalized = normalizePayPeriods(periods);
  const start = new Date(`${span.first_day}T00:00:00`);
  const end = new Date(`${span.last_day}T00:00:00`);
  const rows = [];
  for (
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    cursor <= end;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  ) {
    for (const period of normalized) {
      const ending = periodEndDate(cursor.getFullYear(), cursor.getMonth(), period);
      if (!ending) continue;
      const iso = isoFromDate(ending);
      if (iso < span.first_day || iso > span.last_day) continue;
      rows.push({
        id: period.id,
        key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${period.id}`,
        iso,
        label: ending.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      });
    }
  }
  return rows;
}

/**
 * The school year Blue Timecard Checker should list. A saved office year wins. Otherwise the year that contains today.
 * @param {object | null | undefined} state
 * @param {Date} [today]
 */
export function auditSchoolYearLabel(state, today = new Date()) {
  const saved = schoolYearSpan(state?.schoolYear?.school_year);
  if (saved) return saved.school_year;
  return schoolYearLabelForDate(today);
}

/**
 * Pay periods configured in Teamster Tracker, or the usual 1st–15th and 16th–end split.
 * @param {object | null | undefined} state
 */
export function auditPayPeriodRules(state) {
  return normalizePayPeriods(state?.clockPayDefaults?.periods);
}
