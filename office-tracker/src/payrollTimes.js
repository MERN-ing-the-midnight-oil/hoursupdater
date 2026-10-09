import ExcelJS from 'exceljs';
import { buildBps2026_2027Calendar } from '../../employee-tracker/src/bpsCalendar2026.js';
import { formatClockAmPm, formatClockMinutes, localDateString, normalizeClockTime } from '../../employee-tracker/src/clockTimes.js';
import { describeSchedule, rebuildEmployeeRouteState } from '../../employee-tracker/src/snapshot.js';
import { parseClockTime, roundClockToQuarterHour } from '../../src/logic/timeUtils.js';
import { pairClockPunches, segmentForClock } from '../../src/logic/timesheets.js';
import { driverForDate } from './assignments.js';
import { workbookFileBytes } from './downloadName.js';
import { compareRouteNumbers, driversFromState, quarterHourClocksEnabled } from '../web/store.js';

export const PAYROLL_SHEET = 'Payroll Driver Times';

export const PAYROLL_HEADERS = [
  'Email',
  'First name',
  'Last name',
  'Route number',
  'Contract started',
  'Contracted AM clock in',
  'Contracted AM clock out',
  'AM quarter-hour clocks',
  'AM total minutes',
  'AM rounded quarter hours',
  'Contracted midday clock in',
  'Contracted midday clock out',
  'Mid Day quarter-hour clocks',
  'Mid Day total minutes',
  'Mid Day rounded quarter hours',
  'Contracted PM clock in',
  'Contracted PM clock out',
  'PM quarter-hour clocks',
  'PM total minutes',
  'PM rounded quarter hours',
  'Full Day rounded quarter hours',
];

/** Shows 4.0, 4.25, 4.5, or 4.75. */
const QUARTER_HOUR_FORMAT = '0.0#';

/**
 * Character-widths that fit a laptop or desktop window at normal zoom.
 * Text columns give up space first when a long email would push past this.
 */
const PAYROLL_WIDTH_BUDGET = 250;

/**
 * Width follows the values, not the header. The minimum keeps a formatted
 * number visible and leaves room for the longest word in the header to wrap.
 */
const PAYROLL_COLUMN_FIT = [
  { min: 16, max: 28, pad: 2 },
  { min: 8, max: 16, pad: 2 },
  { min: 8, max: 16, pad: 2 },
  { min: 6, max: 10, pad: 2 },
  { min: 11, max: 12, pad: 1 },
  { min: 11, max: 12, pad: 1 },
  { min: 11, max: 12, pad: 1 },
  { min: 16, max: 20, pad: 1 },
  { min: 8, max: 10, pad: 1 },
  { min: 8, max: 10, pad: 1 },
  { min: 11, max: 12, pad: 1 },
  { min: 11, max: 12, pad: 1 },
  { min: 16, max: 20, pad: 1 },
  { min: 8, max: 10, pad: 1 },
  { min: 8, max: 10, pad: 1 },
  { min: 11, max: 12, pad: 1 },
  { min: 11, max: 12, pad: 1 },
  { min: 16, max: 20, pad: 1 },
  { min: 8, max: 10, pad: 1 },
  { min: 8, max: 10, pad: 1 },
  { min: 8, max: 10, pad: 1 },
];

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1A4F86' },
};
const CHANGED_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFF00' },
};
const BLACK_TEXT = 'FF000000';

/** Pale column tints. Headers and values both use black text. */
export const PAYROLL_RUN_COLORS = {
  AM: { fill: 'FFFFF8DC', font: BLACK_TEXT },
  MIDDAY: { fill: 'FFFFF1E6', font: BLACK_TEXT },
  PM: { fill: 'FFEAF3FB', font: BLACK_TEXT },
};

/** @type {Array<'AM' | 'MIDDAY' | 'PM' | null>} */
const COLUMN_RUN = [
  null,
  null,
  null,
  null,
  null,
  'AM',
  'AM',
  'AM',
  'AM',
  'AM',
  'MIDDAY',
  'MIDDAY',
  'MIDDAY',
  'MIDDAY',
  'MIDDAY',
  'PM',
  'PM',
  'PM',
  'PM',
  'PM',
  null,
];

const RUNS = [
  { id: 'AM', inKey: 'amIn', outKey: 'amOut', quarterKey: 'amQuarterClocks', minutesKey: 'amTotalMinutes' },
  {
    id: 'MIDDAY',
    inKey: 'middayIn',
    outKey: 'middayOut',
    quarterKey: 'middayQuarterClocks',
    minutesKey: 'middayTotalMinutes',
  },
  { id: 'PM', inKey: 'pmIn', outKey: 'pmOut', quarterKey: 'pmQuarterClocks', minutesKey: 'pmTotalMinutes' },
];

/**
 * First word is the first name. Everything after it is the last name.
 * @param {string} name
 */
export function splitDriverName(name) {
  const trimmed = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return { firstName: '', lastName: '' };
  const space = trimmed.indexOf(' ');
  if (space < 0) return { firstName: trimmed, lastName: '' };
  return {
    firstName: trimmed.slice(0, space),
    lastName: trimmed.slice(space + 1),
  };
}

/**
 * Clock times that match the contracted hours on the dashboard.
 * An open review window still pays the last contracted schedule.
 * After the window closes, the current schedule is the contracted one,
 * including a lock-in, a bid, or a bump.
 * @param {import('../../src/logic/stateMachine.js').RouteStateEntry | null | undefined} entry
 */
export function contractedSegments(entry) {
  /** @type {Record<'AM' | 'MIDDAY' | 'PM', string | null>} */
  const empty = { AM: null, MIDDAY: null, PM: null };
  if (!entry) return empty;
  const source =
    entry.status === 'ACCUMULATING'
      ? (entry.baseline_segments ?? entry.segments)
      : entry.segments;
  return {
    AM: source?.AM ?? null,
    MIDDAY: source?.MIDDAY ?? null,
    PM: source?.PM ?? null,
  };
}

/**
 * @param {string} clock
 */
function excelTime(clock) {
  return parseClockTime(clock) / (24 * 60);
}

/**
 * Same driver on the same route. Email identifies the person when it is present.
 * @param {{ email?: string, firstName?: string, lastName?: string, route?: string }} row
 */
export function payrollRowKey(row) {
  const route = String(row?.route ?? '').trim().toLowerCase();
  const email = String(row?.email ?? '').trim().toLowerCase();
  if (email) return `${email}|${route}`;
  const first = String(row?.firstName ?? '').trim().toLowerCase();
  const last = String(row?.lastName ?? '').trim().toLowerCase();
  return `${first}|${last}|${route}`;
}

/**
 * Nearest quarter hour of a run's total minutes, expressed in hours.
 * 135 minutes is 2.25. 127 minutes is 2.0.
 * @param {number | null | undefined} minutes
 * @returns {number | null}
 */
export function quarterHoursFromMinutes(minutes) {
  if (minutes == null || minutes === '') return null;
  const number = Number(minutes);
  if (!Number.isFinite(number)) return null;
  return Math.round(number / 15) / 4;
}

/**
 * Sum of the three already-rounded run totals. This is not rounded again.
 * A missing run is left out. 2 + 1 + 2.25 is 5.25.
 * @param {Array<number | null | undefined>} parts
 * @returns {number | null}
 */
export function sumRoundedQuarterHours(parts) {
  const present = (parts ?? []).filter((value) => value != null && value !== '');
  if (!present.length) return null;
  const sum = present.reduce((total, value) => total + Number(value), 0);
  if (!Number.isFinite(sum)) return null;
  return Math.round(sum * 4) / 4;
}

/**
 * 4.0, 4.25, 4.5, or 4.75.
 * @param {number | null | undefined} hours
 */
export function formatQuarterHours(hours) {
  if (hours == null || hours === '') return '';
  const number = Number(hours);
  if (!Number.isFinite(number)) return '';
  const quarters = Math.round(number * 4);
  const negative = quarters < 0;
  const abs = Math.abs(quarters);
  const whole = Math.floor(abs / 4);
  const fraction = ['.0', '.25', '.5', '.75'][abs % 4];
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/**
 * @param {number | null | undefined} value
 */
function minutesToken(value) {
  if (value == null || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number)) : '';
}

/**
 * @param {string | null | undefined} clock
 */
function clockToken(clock) {
  const text = String(clock ?? '').trim();
  if (!text) return '';
  return normalizeClockTime(text);
}

/**
 * Values payroll would compare, ignoring highlight formatting.
 * @param {object} row
 */
export function payrollRowSignature(row) {
  return [
    String(row.email ?? '').trim().toLowerCase(),
    String(row.firstName ?? '').trim().toLowerCase(),
    String(row.lastName ?? '').trim().toLowerCase(),
    String(row.route ?? '').trim().toLowerCase(),
    clockToken(row.amIn),
    clockToken(row.amOut),
    String(row.amQuarterClocks ?? '').trim(),
    minutesToken(row.amTotalMinutes),
    formatQuarterHours(row.amRoundedQuarterHours),
    clockToken(row.middayIn),
    clockToken(row.middayOut),
    String(row.middayQuarterClocks ?? '').trim(),
    minutesToken(row.middayTotalMinutes),
    formatQuarterHours(row.middayRoundedQuarterHours),
    clockToken(row.pmIn),
    clockToken(row.pmOut),
    String(row.pmQuarterClocks ?? '').trim(),
    minutesToken(row.pmTotalMinutes),
    formatQuarterHours(row.pmRoundedQuarterHours),
    formatQuarterHours(row.fullDayRoundedQuarterHours),
    String(row.contractStarted ?? '').slice(0, 10),
  ].join('|');
}

/**
 * Keys of current rows that are new or no longer match the last file sent to payroll.
 * @param {object[]} currentRows
 * @param {object[]} previousRows
 */
export function changedPayrollKeys(currentRows, previousRows) {
  /** @type {Map<string, string>} */
  const previous = new Map();
  for (const row of previousRows ?? []) {
    previous.set(payrollRowKey(row), payrollRowSignature(row));
  }
  /** @type {string[]} */
  const keys = [];
  for (const row of currentRows ?? []) {
    const key = payrollRowKey(row);
    if (previous.get(key) !== payrollRowSignature(row)) keys.push(key);
  }
  return keys;
}

/**
 * The fields a later payroll file compares. Highlight formatting is left out.
 * @param {object[] | null | undefined} rows
 */
export function payrollBaselineRows(rows) {
  return (rows ?? []).map((row) => ({
    email: String(row?.email ?? '').trim(),
    firstName: String(row?.firstName ?? '').trim(),
    lastName: String(row?.lastName ?? '').trim(),
    route: String(row?.route ?? '').trim(),
    contractStarted: String(row?.contractStarted ?? '').slice(0, 10),
    amIn: String(row?.amIn ?? '').trim(),
    amOut: String(row?.amOut ?? '').trim(),
    amQuarterClocks: String(row?.amQuarterClocks ?? '').trim(),
    amTotalMinutes: baselineNumber(row?.amTotalMinutes),
    amRoundedQuarterHours: baselineNumber(row?.amRoundedQuarterHours),
    middayIn: String(row?.middayIn ?? '').trim(),
    middayOut: String(row?.middayOut ?? '').trim(),
    middayQuarterClocks: String(row?.middayQuarterClocks ?? '').trim(),
    middayTotalMinutes: baselineNumber(row?.middayTotalMinutes),
    middayRoundedQuarterHours: baselineNumber(row?.middayRoundedQuarterHours),
    pmIn: String(row?.pmIn ?? '').trim(),
    pmOut: String(row?.pmOut ?? '').trim(),
    pmQuarterClocks: String(row?.pmQuarterClocks ?? '').trim(),
    pmTotalMinutes: baselineNumber(row?.pmTotalMinutes),
    pmRoundedQuarterHours: baselineNumber(row?.pmRoundedQuarterHours),
    fullDayRoundedQuarterHours: baselineNumber(row?.fullDayRoundedQuarterHours),
  }));
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function baselineNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Labels for rows that are new or no longer match the last payroll file.
 * @param {object[]} currentRows
 * @param {object[] | null | undefined} previousRows
 */
export function changedPayrollLabels(currentRows, previousRows) {
  const keys = new Set(changedPayrollKeys(currentRows, previousRows));
  return (currentRows ?? [])
    .filter((row) => keys.has(payrollRowKey(row)))
    .map((row) => {
      const route = String(row?.route ?? '').trim();
      const name = [row?.firstName, row?.lastName].filter(Boolean).join(' ');
      if (route && name) return `${route} · ${name}`;
      return route || name || 'Unassigned';
    })
    .sort((a, b) => compareRouteNumbers(a, b));
}

/**
 * @param {unknown} value
 */
function unwrapCell(value) {
  if (value == null) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if (value.result != null) return unwrapCell(value.result);
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? '').join('');
    }
    if (value.text != null) return value.text;
  }
  return value;
}

/**
 * @param {unknown} value
 */
function cellText(value) {
  const raw = unwrapCell(value);
  if (raw instanceof Date) return '';
  return raw == null ? '' : String(raw).trim();
}

/**
 * @param {unknown} value
 */
function clockFromCell(value) {
  const raw = unwrapCell(value);
  if (raw == null || raw === '') return '';
  if (raw instanceof Date) {
    return formatClockMinutes(raw.getUTCHours() * 60 + raw.getUTCMinutes());
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const minutes = Math.round((raw % 1) * 24 * 60);
    return formatClockMinutes((minutes + 24 * 60) % (24 * 60));
  }
  const text = String(raw).trim();
  if (!text) return '';
  const ampm = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])\.?m\.?$/i.exec(text);
  if (ampm) {
    let hours = Number(ampm[1]);
    const minutes = Number(ampm[2]);
    const meridian = ampm[3].toLowerCase();
    if (meridian === 'p' && hours < 12) hours += 12;
    if (meridian === 'a' && hours === 12) hours = 0;
    return formatClockMinutes(hours * 60 + minutes);
  }
  return normalizeClockTime(text);
}

/**
 * @param {unknown} value
 */
function numberFromCell(value) {
  const raw = unwrapCell(value);
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const text = String(raw).trim().replace(/hrs/i, '');
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

const PAYROLL_IDENTITY_HEADERS = [
  'Email',
  'First name',
  'Last name',
  'Route number',
  'Contracted AM clock in',
  'Contracted AM clock out',
  'Contracted midday clock in',
  'Contracted midday clock out',
  'Contracted PM clock in',
  'Contracted PM clock out',
];

/**
 * Older files stored one exact total per run and one rounded daily hour figure.
 * @param {Map<string, number>} found
 */
function hasPayrollMinuteColumns(found) {
  const hasNew = found.has('am total minutes') || found.has('am total');
  const hasOld = found.has('am minutes');
  return hasNew || hasOld;
}

/**
 * Column numbers keyed by header. Contract started may be absent on an older file.
 * Minute columns accept the current names and the previous payroll file.
 * @param {ExcelJS.Worksheet} sheet
 * @returns {Map<string, number> | null}
 */
function payrollColumnIndex(sheet) {
  const header = sheet.getRow(1);
  /** @type {Map<string, number>} */
  const found = new Map();
  header.eachCell({ includeEmpty: false }, (cell, column) => {
    const label = cellText(cell.value).toLowerCase();
    if (label) found.set(label, column);
  });
  const identityMissing = PAYROLL_IDENTITY_HEADERS.some(
    (label) => !found.has(label.toLowerCase())
  );
  if (identityMissing || !hasPayrollMinuteColumns(found)) return null;
  return found;
}

/**
 * @param {Map<string, number>} columns
 * @param {string[]} labels
 */
function columnFor(columns, labels) {
  for (const label of labels) {
    const column = columns.get(label.toLowerCase());
    if (column) return column;
  }
  return 0;
}

/**
 * @param {unknown} value
 */
function dateFromCell(value) {
  const raw = unwrapCell(value);
  if (raw == null || raw === '') return '';
  if (raw instanceof Date) {
    const year = raw.getUTCFullYear();
    const month = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const day = String(raw.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000;
    return dateFromCell(new Date(utc));
  }
  const text = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!us) return '';
  return `${us[3]}-${String(Number(us[1])).padStart(2, '0')}-${String(Number(us[2])).padStart(2, '0')}`;
}

/**
 * @param {string} iso
 */
function excelDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

/**
 * @param {Record<string, string | null | undefined>} left
 * @param {Record<string, string | null | undefined>} right
 */
function sameSegments(left, right) {
  return RUNS.every((run) => (left?.[run.id] || null) === (right?.[run.id] || null));
}

/**
 * The day the contracted clock times on this row became the official schedule.
 * A change still inside its review window keeps the earlier contract date.
 * @param {import('../../src/logic/stateMachine.js').RouteStateEntry | null | undefined} entry
 * @param {{ startDate?: string | null, changeLog?: object[] }} [source]
 */
export function contractStartedOn(entry, source = {}) {
  const contracted = contractedSegments(entry);
  if (!RUNS.some((run) => contracted[run.id])) return '';
  const reports = [...(entry?.change_reports ?? [])].reverse();
  for (const report of reports) {
    const after = report?.after?.segments;
    if (!after || !sameSegments(after, contracted)) continue;
    const established =
      report.outcome === 'STABLE' || sameSegments(after, entry?.segments ?? {});
    const date = String(report.finalized_at || '').slice(0, 10);
    if (established && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  }
  let started = String(source.startDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(started)) started = '';
  for (const event of source.changeLog ?? []) {
    if (!event || (event.type && event.type !== 'CHANGE')) continue;
    const seed = event.delta_minutes === 0 && event.previous_time === event.new_time;
    if (!seed) continue;
    if ((contracted[event.segment] || null) !== (event.new_time || null)) continue;
    const date = String(event.effective_date || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date > started) started = date;
  }
  return started;
}

/**
 * @param {Buffer | ArrayBuffer | Uint8Array} buffer
 */
export async function rowsFromPayrollWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet =
    workbook.worksheets.find((item) => payrollColumnIndex(item)) ?? null;
  const columns = sheet ? payrollColumnIndex(sheet) : null;
  if (!sheet || !columns) {
    throw new Error(
      'That file is not a Payroll Driver Times spreadsheet. Upload the file that was last sent to payroll.'
    );
  }
  /**
   * @param {ExcelJS.Row} row
   * @param {string[]} labels
   * @param {(value: unknown) => string | number | null} read
   */
  const cell = (row, labels, read) => {
    const column = columnFor(columns, labels);
    if (!column) return read === numberFromCell ? null : '';
    return read(row.getCell(column).value);
  };
  /** @type {object[]} */
  const rows = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const email = cell(row, ['Email'], cellText);
    const firstName = cell(row, ['First name'], cellText);
    const lastName = cell(row, ['Last name'], cellText);
    const route = cell(row, ['Route number'], cellText);
    if (!email && !firstName && !lastName && !route) return;
    rows.push({
      email,
      firstName,
      lastName,
      route,
      contractStarted: cell(row, ['Contract started'], dateFromCell),
      amIn: cell(row, ['Contracted AM clock in'], clockFromCell),
      amOut: cell(row, ['Contracted AM clock out'], clockFromCell),
      amQuarterClocks: cell(row, ['AM quarter-hour clocks'], cellText),
      middayIn: cell(row, ['Contracted midday clock in'], clockFromCell),
      middayOut: cell(row, ['Contracted midday clock out'], clockFromCell),
      middayQuarterClocks: cell(row, ['Mid Day quarter-hour clocks'], cellText),
      pmIn: cell(row, ['Contracted PM clock in'], clockFromCell),
      pmOut: cell(row, ['Contracted PM clock out'], clockFromCell),
      pmQuarterClocks: cell(row, ['PM quarter-hour clocks'], cellText),
      amTotalMinutes: cell(row, ['AM total minutes', 'AM total', 'AM minutes'], numberFromCell),
      amRoundedQuarterHours: readRoundedQuarterHours(
        row,
        ['AM rounded quarter hours'],
        ['AM rounded minutes', 'AM rounded']
      ),
      middayTotalMinutes: cell(
        row,
        ['Mid Day total minutes', 'Mid Day total', 'Midday minutes'],
        numberFromCell
      ),
      middayRoundedQuarterHours: readRoundedQuarterHours(
        row,
        ['Mid Day rounded quarter hours'],
        ['Mid Day rounded minutes', 'Mid Day rounded']
      ),
      pmTotalMinutes: cell(row, ['PM total minutes', 'PM total', 'PM minutes'], numberFromCell),
      pmRoundedQuarterHours: readRoundedQuarterHours(
        row,
        ['PM rounded quarter hours'],
        ['PM rounded minutes', 'PM rounded']
      ),
      fullDayRoundedQuarterHours: readRoundedQuarterHours(
        row,
        ['Full Day rounded quarter hours', 'Rounded clock hours'],
        ['Full Day rounded minutes', 'Full Day rounded']
      ),
    });
  });
  return rows;
}

/**
 * Quarter-hour columns are already in hours. Older files stored rounded minutes.
 * @param {ExcelJS.Row} row
 * @param {string[]} hourLabels
 * @param {string[]} minuteLabels
 */
function readRoundedQuarterHours(row, hourLabels, minuteLabels) {
  const columns = row.worksheet && payrollColumnIndex(row.worksheet);
  if (!columns) return null;
  const hourColumn = columnFor(columns, hourLabels);
  if (hourColumn) {
    const hours = numberFromCell(row.getCell(hourColumn).value);
    if (hours == null) return null;
    return Math.round(hours * 4) / 4;
  }
  const minuteColumn = columnFor(columns, minuteLabels);
  if (!minuteColumn) return null;
  return quarterHoursFromMinutes(numberFromCell(row.getCell(minuteColumn).value));
}

/**
 * Excel's h:mm AM/PM display. 16:15 is "4:15 PM".
 * @param {string | null | undefined} clock
 */
function clockExcelLabel(clock) {
  const text = String(clock ?? '').trim();
  if (!text) return '';
  const minutes = parseClockTime(text);
  const hour24 = Math.floor(minutes / 60);
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minutes % 60).padStart(2, '0')} ${suffix}`;
}

/**
 * Excel's m/d/yyyy display.
 * @param {string | null | undefined} iso
 */
function contractDateLabel(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!match) return '';
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

/**
 * What payroll sees in the cell, used to size the column.
 * @param {object} row
 */
function payrollCellLabels(row) {
  const minutes = (value) => (value == null || value === '' ? '' : String(value));
  return [
    String(row.email ?? ''),
    String(row.firstName ?? ''),
    String(row.lastName ?? ''),
    String(row.route ?? ''),
    contractDateLabel(row.contractStarted),
    clockExcelLabel(row.amIn),
    clockExcelLabel(row.amOut),
    String(row.amQuarterClocks ?? ''),
    minutes(row.amTotalMinutes),
    formatQuarterHours(row.amRoundedQuarterHours),
    clockExcelLabel(row.middayIn),
    clockExcelLabel(row.middayOut),
    String(row.middayQuarterClocks ?? ''),
    minutes(row.middayTotalMinutes),
    formatQuarterHours(row.middayRoundedQuarterHours),
    clockExcelLabel(row.pmIn),
    clockExcelLabel(row.pmOut),
    String(row.pmQuarterClocks ?? ''),
    minutes(row.pmTotalMinutes),
    formatQuarterHours(row.pmRoundedQuarterHours),
    formatQuarterHours(row.fullDayRoundedQuarterHours),
  ];
}

/**
 * @param {object[]} rows
 * @returns {number[]}
 */
function payrollColumnWidths(rows) {
  const longest = PAYROLL_HEADERS.map(() => 0);
  for (const row of rows ?? []) {
    payrollCellLabels(row).forEach((label, index) => {
      longest[index] = Math.max(longest[index], label.length);
    });
  }
  const widths = longest.map((length, index) => {
    const spec = PAYROLL_COLUMN_FIT[index];
    const fitted = Math.min(spec.max, Math.max(spec.min, length + spec.pad));
    // exceljs treats 9 as the default width and does not save it.
    return fitted === 9 ? 10 : fitted;
  });
  let extra = widths.reduce((sum, width) => sum + width, 0) - PAYROLL_WIDTH_BUDGET;
  for (const index of [0, 1, 2, 3]) {
    if (extra <= 0) break;
    const room = widths[index] - PAYROLL_COLUMN_FIT[index].min;
    const cut = Math.min(Math.max(room, 0), extra);
    widths[index] -= cut;
    extra -= cut;
  }
  return widths;
}

/**
 * @param {string} label
 * @param {number} width
 */
function headerLineCount(label, width) {
  const capacity = Math.max(1, Math.floor(width));
  const words = String(label).split(/\s+/).filter(Boolean);
  let lines = 1;
  let used = 0;
  for (const word of words) {
    if (used === 0) {
      used = word.length;
      continue;
    }
    if (used + 1 + word.length <= capacity) used += 1 + word.length;
    else {
      lines += 1;
      used = word.length;
    }
  }
  return lines;
}

/**
 * @param {ExcelJS.Worksheet} sheet
 * @param {object[]} rows
 * @param {ExcelJS.Row} header
 */
function fitPayrollColumns(sheet, rows, header) {
  const widths = payrollColumnWidths(rows);
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  const lines = Math.max(
    ...PAYROLL_HEADERS.map((label, index) => headerLineCount(label, widths[index]))
  );
  header.height = Math.max(36, lines * 14);
}

/**
 * @param {string} argb
 */
function solidFill(argb) {
  return {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb },
  };
}

/**
 * @param {ExcelJS.Cell} cell
 * @param {'AM' | 'MIDDAY' | 'PM'} run
 */
function paintRunCell(cell, run) {
  const colors = PAYROLL_RUN_COLORS[run];
  cell.fill = solidFill(colors.fill);
  const font = cell.font ? { ...cell.font } : {};
  cell.font = { ...font, color: { argb: colors.font } };
}

/**
 * @param {ExcelJS.Row} row
 */
function paintRunColumns(row) {
  COLUMN_RUN.forEach((run, index) => {
    if (!run) return;
    paintRunCell(row.getCell(index + 1), run);
  });
}

/**
 * Name columns turn yellow. Run columns keep their color and turn bold.
 * @param {ExcelJS.Row} row
 */
function highlightChangedRow(row) {
  for (let column = 1; column <= PAYROLL_HEADERS.length; column += 1) {
    const cell = row.getCell(column);
    const font = cell.font ? { ...cell.font } : {};
    cell.font = { ...font, bold: true, color: { argb: BLACK_TEXT } };
    if (!COLUMN_RUN[column - 1]) cell.fill = CHANGED_FILL;
  }
}

/**
 * @param {object} state
 * @param {{ asOf?: string, calendar?: import('../../src/logic/calendar.js').SchoolCalendar, roundClocks?: boolean }} [options]
 */
export function payrollDriverRows(state, options = {}) {
  const asOf = options.asOf || localDateString();
  const calendar = options.calendar || buildBps2026_2027Calendar().calendar;
  const directory = new Map(
    driversFromState(state).map((driver) => [driver.name.trim().toLowerCase(), driver])
  );
  /** @type {Set<string>} */
  const assigned = new Set();
  /** @type {ReturnType<typeof rowForRoute>[]} */
  const rows = [];

  const roundClocks = options.roundClocks ?? quarterHourClocksEnabled(state);
  const profiles = Object.values(state?.profiles ?? {}).sort((a, b) =>
    compareRouteNumbers(a?.name, b?.name)
  );
  for (const profile of profiles) {
    const driverName = driverForDate(profile, asOf);
    if (!driverName) continue;
    assigned.add(driverName.toLowerCase());
    const driver = directory.get(driverName.toLowerCase());
    const entry = rebuildEmployeeRouteState(profile.changeLog ?? [], calendar, asOf);
    rows.push(
      rowForRoute(driver?.email ?? '', driverName, profile.name, entry, {
        startDate: profile.start_date,
        changeLog: profile.changeLog,
        punches: state?.punches,
        roundClocks,
      })
    );
  }

  for (const driver of directory.values()) {
    if (assigned.has(driver.name.trim().toLowerCase())) continue;
    rows.push(
      rowForRoute(driver.email, driver.name, '', null, {
        punches: state?.punches,
        roundClocks,
      })
    );
  }

  rows.sort((a, b) => {
    const last = a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' });
    if (last !== 0) return last;
    const first = a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' });
    if (first !== 0) return first;
    return compareRouteNumbers(a.route, b.route);
  });
  return rows;
}

/**
 * Payroll rows for one driver. The name is the first and last name joined.
 * @param {object[] | null | undefined} rows
 * @param {string | null | undefined} name
 */
export function payrollRowsForDriver(rows, name) {
  const wanted = String(name ?? '').trim().toLowerCase();
  if (!wanted) return [];
  return (rows ?? []).filter((row) => {
    const full = [row?.firstName, row?.lastName].filter(Boolean).join(' ').trim().toLowerCase();
    return full === wanted;
  });
}

/**
 * @param {string} email
 * @param {string} name
 * @param {string} route
 * @param {import('../../src/logic/stateMachine.js').RouteStateEntry | null} entry
 * @param {{ startDate?: string | null, changeLog?: object[], punches?: object[], roundClocks?: boolean }} [source]
 */
function rowForRoute(email, name, route, entry, source = {}) {
  const { firstName, lastName } = splitDriverName(name);
  const punched = segmentsFromPunches(source.punches, name);
  const segments = punched || contractedSegments(entry);
  const schedule = describeSchedule(segments);
  const roundClocks = source.roundClocks !== false;
  /** @type {Record<string, string>} */
  const clocks = {};
  /** @type {Record<string, string>} */
  const quarterClocks = {};
  /** @type {Record<string, number | null>} */
  const totals = {};
  for (const run of RUNS) {
    const piece = schedule[run.id];
    const clockIn = piece?.clock_in ?? '';
    const clockOut = piece?.clock_out ?? '';
    clocks[run.inKey] = clockIn;
    clocks[run.outKey] = clockOut;
    const used = clocksUsedForMinutes(clockIn, clockOut, roundClocks);
    quarterClocks[run.quarterKey] = used.label;
    totals[run.minutesKey] = used.minutes;
  }
  const amRoundedQuarterHours = quarterHoursFromMinutes(totals.amTotalMinutes);
  const middayRoundedQuarterHours = quarterHoursFromMinutes(totals.middayTotalMinutes);
  const pmRoundedQuarterHours = quarterHoursFromMinutes(totals.pmTotalMinutes);
  return {
    email: String(email ?? '').trim(),
    firstName,
    lastName,
    route: String(route ?? '').trim(),
    contractStarted: contractStartedOn(entry, source),
    ...clocks,
    ...quarterClocks,
    amTotalMinutes: totals.amTotalMinutes,
    amRoundedQuarterHours,
    middayTotalMinutes: totals.middayTotalMinutes,
    middayRoundedQuarterHours,
    pmTotalMinutes: totals.pmTotalMinutes,
    pmRoundedQuarterHours,
    fullDayRoundedQuarterHours: sumRoundedQuarterHours([
      amRoundedQuarterHours,
      middayRoundedQuarterHours,
      pmRoundedQuarterHours,
    ]),
  };
}

/**
 * The clocks the minute total is counted from, and that count.
 * Rounding snaps each clock to the nearest quarter hour first.
 * @param {string} clockIn
 * @param {string} clockOut
 * @param {boolean} roundClocks
 */
function clocksUsedForMinutes(clockIn, clockOut, roundClocks) {
  if (!clockIn || !clockOut) return { label: '', minutes: null };
  const start = roundClocks ? roundClockToQuarterHour(clockIn) : clockIn;
  const end = roundClocks ? roundClockToQuarterHour(clockOut) : clockOut;
  if (!start || !end) return { label: '', minutes: null };
  return {
    label: `${formatClockAmPm(start)}–${formatClockAmPm(end)}`,
    minutes: clockMinutesApart(start, end),
  };
}

/**
 * @param {string} clockIn
 * @param {string} clockOut
 * @returns {number | null}
 */
function clockMinutesApart(clockIn, clockOut) {
  const start = parseClockTime(clockIn);
  let end = parseClockTime(clockOut);
  if (end < start) end += 24 * 60;
  return end - start;
}

/**
 * Latest completed clock-in and clock-out in each run.
 * The earlier stamp decides the run: before 8:00 is AM, until 1:00 is midday, and after that is PM.
 * A driver with no completed pair keeps the contracted clocks.
 * @param {object[] | null | undefined} punches
 * @param {string} driverName
 * @returns {Record<'AM' | 'MIDDAY' | 'PM', string | null> | null}
 */
function segmentsFromPunches(punches, driverName) {
  const wanted = String(driverName || '').trim().toLowerCase();
  const mine = (Array.isArray(punches) ? punches : []).filter(
    (punch) => String(punch?.driver_name || '').trim().toLowerCase() === wanted
  );
  if (!mine.length) return null;
  const { pairs } = pairClockPunches(mine);
  if (!pairs.length) return null;
  /** @type {Record<string, { start: Date, end: Date }>} */
  const latest = {};
  for (const pair of pairs) {
    const earlier = pair.start <= pair.end ? pair.start : pair.end;
    const segment = segmentForClock(earlier);
    const key = segment === 'am' ? 'AM' : segment === 'midday' ? 'MIDDAY' : 'PM';
    const prev = latest[key];
    if (!prev || pair.start.getTime() > prev.start.getTime()) latest[key] = pair;
  }
  const label = (date) => `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  return {
    AM: latest.AM ? `${label(latest.AM.start)}-${label(latest.AM.end)}` : null,
    MIDDAY: latest.MIDDAY ? `${label(latest.MIDDAY.start)}-${label(latest.MIDDAY.end)}` : null,
    PM: latest.PM ? `${label(latest.PM.start)}-${label(latest.PM.end)}` : null,
  };
}

/**
 * @param {object} state
 * @param {{
 *   asOf?: string,
 *   calendar?: import('../../src/logic/calendar.js').SchoolCalendar,
 *   title?: string,
 *   createdAt?: Date,
 *   previousRows?: object[] | null,
 *   highlightRoutes?: string[] | null,
 *   result?: { changedCount?: number },
 * }} [options]
 * @returns {Promise<Buffer>}
 */
export async function buildPayrollWorkbook(state, options = {}) {
  const asOf = state?.asOf || options.asOf;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Teamster Time Changes Dashboard';
  workbook.title = options.title || 'Payroll Driver Times';
  workbook.subject = 'Contracted driver clock times for payroll';
  workbook.created = options.createdAt || new Date();

  const sheet = workbook.addWorksheet(PAYROLL_SHEET, {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const header = sheet.addRow(PAYROLL_HEADERS);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  paintRunColumns(header);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const rows = payrollDriverRows(state, { asOf, calendar: options.calendar });
  const changed = new Set(
    options.previousRows ? changedPayrollKeys(rows, options.previousRows) : []
  );
  const highlightRoutes = new Set(
    (options.highlightRoutes ?? [])
      .map((name) => String(name ?? '').trim().toLowerCase())
      .filter(Boolean)
  );
  for (const row of rows) {
    const route = String(row.route ?? '').trim().toLowerCase();
    if (route && highlightRoutes.has(route)) changed.add(payrollRowKey(row));
  }
  if (options.result) options.result.changedCount = changed.size;

  for (const row of rows) {
    const added = sheet.addRow([
      row.email,
      row.firstName,
      row.lastName,
      row.route,
      excelDate(row.contractStarted),
      row.amIn ? excelTime(row.amIn) : null,
      row.amOut ? excelTime(row.amOut) : null,
      row.amQuarterClocks || null,
      row.amTotalMinutes,
      row.amRoundedQuarterHours,
      row.middayIn ? excelTime(row.middayIn) : null,
      row.middayOut ? excelTime(row.middayOut) : null,
      row.middayQuarterClocks || null,
      row.middayTotalMinutes,
      row.middayRoundedQuarterHours,
      row.pmIn ? excelTime(row.pmIn) : null,
      row.pmOut ? excelTime(row.pmOut) : null,
      row.pmQuarterClocks || null,
      row.pmTotalMinutes,
      row.pmRoundedQuarterHours,
      row.fullDayRoundedQuarterHours,
    ]);
    added.eachCell((cell) => {
      cell.alignment = { vertical: 'middle' };
    });
    const startedColumn = PAYROLL_HEADERS.indexOf('Contract started') + 1;
    if (added.getCell(startedColumn).value != null) {
      added.getCell(startedColumn).numFmt = 'm/d/yyyy';
    }
    for (const label of [
      'Contracted AM clock in',
      'Contracted AM clock out',
      'Contracted midday clock in',
      'Contracted midday clock out',
      'Contracted PM clock in',
      'Contracted PM clock out',
    ]) {
      const column = PAYROLL_HEADERS.indexOf(label) + 1;
      if (added.getCell(column).value != null) {
        added.getCell(column).numFmt = 'h:mm AM/PM';
      }
    }
    for (const label of [
      'AM rounded quarter hours',
      'Mid Day rounded quarter hours',
      'PM rounded quarter hours',
      'Full Day rounded quarter hours',
    ]) {
      const column = PAYROLL_HEADERS.indexOf(label) + 1;
      if (added.getCell(column).value != null) {
        added.getCell(column).numFmt = QUARTER_HOUR_FORMAT;
      }
    }
    paintRunColumns(added);
    if (changed.has(payrollRowKey(row))) highlightChangedRow(added);
  }

  fitPayrollColumns(sheet, rows, header);
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(sheet.rowCount, 1), column: PAYROLL_HEADERS.length },
  };
  return workbookFileBytes(await workbook.xlsx.writeBuffer());
}
