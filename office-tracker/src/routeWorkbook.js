import ExcelJS from 'exceljs';
import { buildBps2026_2027Calendar } from '../../employee-tracker/src/bpsCalendar2026.js';
import { formatClockMinutes, localDateString, normalizeClockTime } from '../../employee-tracker/src/clockTimes.js';
import {
  buildEmployeeSnapshot,
  rebuildEmployeeRouteState,
} from '../../employee-tracker/src/snapshot.js';
import { isForcedOctober1Contract } from '../../src/logic/contractWindows.js';
import { parseClockTime } from '../../src/logic/timeUtils.js';
import { routeAssignments } from './assignments.js';
import { workbookFileBytes } from './downloadName.js';
import {
  compareDrivers,
  compareRouteNumbers,
  driversFromState,
  joinPersonName,
  splitPersonName,
} from '../web/store.js';
import { contractColumnsForHistory } from './historyMarkup.js';
import { clockRowsFromState, stateFromClockRows } from './routesCsv.js';

const CLOCK_SHEET = 'Route clock times';
const DRIVERS_SHEET = 'Drivers';
const ABOUT_SHEET = 'How to read this file';

const SCHEDULE_HEADERS = [
  'Force Oct 1 Contract',
  'New Schedule Started',
  'AM start',
  'AM end',
  'Midday start',
  'Midday end',
  'PM start',
  'PM end',
  'Hours',
  'Contracted',
  'Contract Hours',
  'Notice sent?',
];

const RUN_COLUMNS = [
  { id: 'AM', label: 'AM', inKey: 'amIn', outKey: 'amOut', start: 3, end: 4 },
  { id: 'MIDDAY', label: 'Midday', inKey: 'middayIn', outKey: 'middayOut', start: 5, end: 6 },
  { id: 'PM', label: 'PM', inKey: 'pmIn', outKey: 'pmOut', start: 7, end: 8 },
];

const DRIVER_HEADERS = ['First name', 'Last name', 'Email'];

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1A4F86' },
};
const BAND_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF3F6FA' },
};
const CHANGED_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF4D6' },
};
const LABEL_FONT = { bold: true, size: 12, color: { argb: 'FF1A4F86' } };

/**
 * @param {unknown} value
 */
function unwrap(value) {
  if (value == null) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if (value.result != null) return unwrap(value.result);
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
  const raw = unwrap(value);
  if (raw instanceof Date) return '';
  return raw == null ? '' : String(raw).trim();
}

/**
 * @param {string} iso
 */
function excelDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!match) return iso || '';
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

/**
 * @param {string} clock
 */
function excelTime(clock) {
  const minutes = parseClockTime(normalizeClockTime(clock));
  return minutes / (24 * 60);
}

/**
 * @param {ExcelJS.Worksheet} sheet
 * @param {string[]} headers
 */
function writeHeader(sheet, headers) {
  const row = sheet.addRow(headers);
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(sheet.rowCount, 1), column: headers.length },
  };
}

/**
 * @param {string} name
 */
function driverIdFor(name) {
  return `driver-${String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}`;
}

/**
 * @param {object} state
 */
function driversForWorkbook(state) {
  /** @type {Map<string, { name: string, firstName: string, lastName: string, email: string }>} */
  const byName = new Map();
  for (const driver of driversFromState(state)) {
    const name = String(driver.name ?? '').trim();
    if (!name) continue;
    byName.set(name.toLowerCase(), {
      name,
      firstName: driver.firstName,
      lastName: driver.lastName,
      email: String(driver.email ?? ''),
    });
  }
  for (const row of clockRowsFromState(state)) {
    const name = String(row.driver ?? '').trim();
    if (!name || byName.has(name.toLowerCase())) continue;
    const parts = splitPersonName(name);
    byName.set(name.toLowerCase(), {
      name,
      firstName: parts.firstName,
      lastName: parts.lastName,
      email: '',
    });
  }
  return [...byName.values()].sort(compareDrivers);
}

/**
 * Excel sheet names cannot contain : \ / ? * [ ] and are limited to 31 characters.
 * @param {string} route
 * @param {Set<string>} used
 */
function sheetNameForRoute(route, used) {
  let base = String(route ?? '')
    .split('')
    .map((char) => (':\\/?*[]'.includes(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) base = 'Route';
  if (base.length > 31) base = base.slice(0, 31).trim();
  const reserved = new Set([DRIVERS_SHEET, ABOUT_SHEET, CLOCK_SHEET].map((name) => name.toLowerCase()));
  if (reserved.has(base.toLowerCase())) {
    const suffix = ' (route)';
    base = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
  }
  let name = base;
  let count = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${count})`;
    name = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
    count += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

/**
 * @param {string} asOf
 */
function asOfDate(asOf) {
  const value = String(asOf ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : localDateString();
}

/**
 * @param {object} profile
 * @param {string} asOf
 * @param {import('../../src/logic/calendar.js').SchoolCalendar} calendar
 */
function scheduleHistoryFor(profile, asOf, calendar) {
  const changeLog = profile?.changeLog ?? [];
  const entry = rebuildEmployeeRouteState(changeLog, calendar, asOf);
  return (
    buildEmployeeSnapshot({
      profile: { name: profile?.name, start_date: profile?.start_date ?? null },
      changeLog,
      entry,
      calendar,
      asOfDate: asOf,
    }).schedule_history ?? []
  );
}

/**
 * @param {object} row
 * @param {{ contractedDate: string }} column
 */
function contractedCellText(row, column) {
  /** @type {string[]} */
  const lines = [column.contractedDate];
  const note = row.kind === 'change' ? String(row.note ?? '').trim() : '';
  if (note) lines.push(`Note: ${note.replace(/\s*\n\s*/g, ' ')}`);
  return lines.join('\n');
}

/**
 * @param {object} row
 * @param {Set<string>} sent
 */
function noticeCell(row, sent) {
  if (row.kind !== 'change' || !row.change_id) return '';
  return sent.has(String(row.change_id)) ? 'Yes' : 'No';
}

/**
 * @param {object} row
 */
function forceOct1Cell(row) {
  if (row.kind !== 'change') return '';
  return row.force_oct1_contract ? 'On' : 'Off';
}

/**
 * @param {string} clock
 */
function excelClock(clock) {
  return clock ? excelTime(clock) : null;
}

/**
 * @param {ExcelJS.Worksheet} sheet
 * @param {string} label
 * @param {string} value
 */
function writeLabelRow(sheet, label, value) {
  const row = sheet.addRow([label, value]);
  row.getCell(1).font = LABEL_FONT;
  row.getCell(2).font = { size: 12 };
  row.getCell(2).alignment = { vertical: 'middle' };
  sheet.mergeCells(row.number, 2, row.number, SCHEDULE_HEADERS.length);
  return row;
}

/**
 * @param {ExcelJS.Worksheet} sheet
 * @param {Array<{ driver_name: string, from: string, until: string | null }>} assignments
 */
function writeAssignmentTable(sheet, assignments) {
  const header = sheet.addRow(['Driver', 'From', 'Until']);
  header.eachCell((cell) => {
    cell.font = LABEL_FONT;
  });
  for (const item of assignments) {
    const row = sheet.addRow([
      item.driver_name,
      excelDate(item.from),
      item.until ? excelDate(item.until) : null,
    ]);
    row.getCell(2).numFmt = 'm/d/yyyy';
    if (item.until) row.getCell(3).numFmt = 'm/d/yyyy';
  }
}

/**
 * @param {ExcelJS.Workbook} workbook
 * @param {object} profile
 * @param {object[]} history
 * @param {Set<string>} sent
 * @param {Set<string>} usedNames
 */
function writeRouteSheet(workbook, profile, history, sent, usedNames) {
  const route = String(profile.name ?? '').trim();
  const sheet = workbook.addWorksheet(sheetNameForRoute(route, usedNames), {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  [18, 24, 14, 14, 16, 16, 14, 14, 14, 22, 16, 16].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  writeLabelRow(sheet, 'Route', route);
  const note = String(profile.note ?? '').trim();
  if (note) writeLabelRow(sheet, 'Note', note);
  const assignments = routeAssignments(profile);
  if (assignments.length > 1) {
    writeAssignmentTable(sheet, assignments);
  } else {
    writeLabelRow(
      sheet,
      'Driver',
      String(profile.driver_name || assignments[0]?.driver_name || '').trim()
    );
  }
  sheet.addRow([]);

  const header = sheet.addRow(SCHEDULE_HEADERS);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  const headerRow = header.number;

  let shaded = false;
  const columns = contractColumnsForHistory(history);
  history.forEach((row, index) => {
    const schedule = row.schedule ?? {};
    const column = columns[index];
    const added = sheet.addRow([
      forceOct1Cell(row),
      excelDate(row.date),
      excelClock(schedule.AM?.clock_in),
      excelClock(schedule.AM?.clock_out),
      excelClock(schedule.MIDDAY?.clock_in),
      excelClock(schedule.MIDDAY?.clock_out),
      excelClock(schedule.PM?.clock_in),
      excelClock(schedule.PM?.clock_out),
      column.hours,
      contractedCellText(row, column),
      column.contractHours,
      noticeCell(row, sent),
    ]);
    for (let col = 1; col <= SCHEDULE_HEADERS.length; col += 1) {
      const cell = added.getCell(col);
      cell.alignment = {
        vertical: 'middle',
        wrapText: col === 10,
        horizontal: col === 12 ? 'center' : 'left',
      };
      if (shaded) cell.fill = BAND_FILL;
    }
    added.getCell(2).numFmt = 'm/d/yyyy';
    for (const col of [3, 4, 5, 6, 7, 8]) {
      if (added.getCell(col).value != null && added.getCell(col).value !== '') {
        added.getCell(col).numFmt = 'h:mm AM/PM';
      }
    }
    const changed = RUN_COLUMNS.find((run) => run.id === row.segment);
    if (changed) {
      for (const col of [changed.start, changed.end]) {
        const cell = added.getCell(col);
        cell.font = { bold: true };
        cell.fill = CHANGED_FILL;
      }
    }
    if (String(added.getCell(10).value ?? '').includes('\n')) added.height = 48;
    shaded = !shaded;
  });

  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: Math.max(sheet.rowCount, headerRow), column: SCHEDULE_HEADERS.length },
  };
  return sheet;
}

/**
 * @param {object} state
 * @param {{ title?: string, createdAt?: Date, asOf?: string }} [options]
 * @returns {Promise<Buffer>}
 */
export async function buildRouteWorkbook(state, options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Teamster Time Changes Dashboard';
  workbook.title = options.title || 'Current Route Data';
  workbook.subject = 'Route clock times for the Teamster Time Changes Dashboard';
  workbook.created = options.createdAt || new Date();

  const asOf = asOfDate(options.asOf || state?.asOf);
  const calendar = buildBps2026_2027Calendar().calendar;
  const sent = new Set(
    (Array.isArray(state?.noticeSentIds) ? state.noticeSentIds : [])
      .map((id) => String(id || ''))
      .filter(Boolean)
  );
  const usedNames = new Set(
    [DRIVERS_SHEET, ABOUT_SHEET, CLOCK_SHEET].map((name) => name.toLowerCase())
  );
  const profiles = Object.values(state?.profiles ?? {}).sort((a, b) =>
    compareRouteNumbers(a?.name, b?.name)
  );
  for (const profile of profiles) {
    if (!String(profile?.name ?? '').trim()) continue;
    writeRouteSheet(
      workbook,
      profile,
      scheduleHistoryFor(profile, asOf, calendar),
      sent,
      usedNames
    );
  }

  const driverSheet = workbook.addWorksheet(DRIVERS_SHEET);
  writeHeader(driverSheet, DRIVER_HEADERS);
  driverSheet.columns = [{ width: 18 }, { width: 22 }, { width: 36 }];
  for (const driver of driversForWorkbook(state)) {
    driverSheet.addRow([driver.firstName, driver.lastName, driver.email]);
  }
  driverSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(driverSheet.rowCount, 1), column: DRIVER_HEADERS.length },
  };

  const about = workbook.addWorksheet(ABOUT_SHEET);
  about.getColumn(1).width = 108;
  const aboutLines = [
    ['Current route data', { bold: true, size: 18 }],
    [''],
    [
      'This workbook is a backup of the routes in the Teamster Time Changes Dashboard. It opens in Excel. Keep the file if you want a copy. The live routes stay with the signed-in accounts.',
    ],
    [''],
    ['One sheet per route', { bold: true, size: 14 }],
    [
      'Each route has its own sheet, named with the route number. Route and Driver at the top match the route open in the dashboard.',
    ],
    [
      'If more than one driver has held the route, those drivers are listed with From and Until.',
    ],
    [''],
    ['Route clock times', { bold: true, size: 14 }],
    [
      'The column headings match Route clock times in the dashboard: Force Oct 1 Contract, New Schedule Started, AM start, AM end, Midday start, Midday end, PM start, PM end, Hours, Contracted, Contract Hours, and Notice sent?.',
    ],
    [
      'The first row of times is the established starting schedule. Later rows are changes, oldest to newest. Bold highlighted times are the run that changed.',
    ],
    [
      'Force Oct 1 Contract is On or Off. On contracts that schedule on October 1 and skips the usual rules for the size of the change and the 15-school-day countdown. Off is the usual rules. Hours is the rounded total of the clock times on that row. Contracted is the date those hours became the contract, or "predicted: mm/dd/yyyy". Contract Hours is the official total, which stays at the previous figure until that date. A line that starts with Note: is the note for that change. Notice sent? is Yes when a notice was sent for that change.',
    ],
    [
      'This sheet is a copy of the dashboard. Change clock times in the dashboard. Do not rename the column headings.',
    ],
    [''],
    ['Drivers', { bold: true, size: 14 }],
    [
      'The driver list: first name, last name, and email. Any of those can be left blank.',
    ],
  ];
  aboutLines.forEach((entry, index) => {
    const [text, font] = entry;
    const row = about.getRow(index + 1);
    row.getCell(1).value = text;
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    if (font) row.getCell(1).font = font;
    if (text && !font) row.height = 36;
    if (font?.size >= 14) row.height = 24;
  });

  workbook.views = [{ activeTab: 0, firstSheet: 0 }];
  return workbookFileBytes(await workbook.xlsx.writeBuffer());
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function isoDateFromCell(value, label) {
  const raw = unwrap(value);
  if (raw instanceof Date) {
    const year = raw.getUTCFullYear();
    const month = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const day = String(raw.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000;
    return isoDateFromCell(new Date(utc), label);
  }
  const text = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) {
    const month = String(Number(us[1])).padStart(2, '0');
    const day = String(Number(us[2])).padStart(2, '0');
    return `${us[3]}-${month}-${day}`;
  }
  throw new Error(`${label} must be a date (got "${text}").`);
}

/**
 * @param {unknown} value
 */
function clockFromCell(value) {
  const raw = unwrap(value);
  if (raw == null || raw === '') return '';
  if (raw instanceof Date) {
    return formatClockMinutes(raw.getUTCHours() * 60 + raw.getUTCMinutes());
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const minutes = Math.round((raw % 1) * 24 * 60);
    return formatClockMinutes((minutes + 24 * 60) % (24 * 60));
  }
  const text = String(raw ?? '').trim();
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
 * @param {string[]} labels
 * @param {Record<string, string[]>} columns
 */
function matchHeaders(labels, columns) {
  /** @type {Record<string, number>} */
  const index = {};
  for (const [key, names] of Object.entries(columns)) {
    const found = labels.findIndex((label) => names.includes(label));
    if (found < 0 && key !== 'note') return null;
    index[key] = found;
  }
  return index;
}

/**
 * @param {ExcelJS.Worksheet} sheet
 */
function clockHeader(sheet) {
  const last = Math.min(sheet.rowCount || 1, 8);
  for (let rowNumber = 1; rowNumber <= last; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    /** @type {string[]} */
    const labels = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      labels[col - 1] = cellText(cell.value).toLowerCase();
    });
    const index = matchHeaders(labels, {
      route: ['route number', 'route'],
      driver: ['driver'],
      kind: ['what this row is', 'kind'],
      date: ['date'],
      run: ['run'],
      clockIn: ['clock in'],
      clockOut: ['clock out'],
      note: ['note'],
    });
    if (index) return { rowNumber, index };
  }
  return null;
}

/**
 * @param {ExcelJS.Worksheet} sheet
 * @param {{ rowNumber: number, index: Record<string, number> }} header
 */
function clockRowsFromSheet(sheet, header) {
  /** @type {Array<{ line: number, route: string, driver: string, kind: string, date: string, run: string, clockIn: string, clockOut: string, note: string }>} */
  const rows = [];
  const at = (row, index) => (index < 0 ? '' : unwrap(row.getCell(index + 1).value));
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= header.rowNumber) return;
    const route = cellText(at(row, header.index.route));
    const kind = cellText(at(row, header.index.kind));
    const run = cellText(at(row, header.index.run));
    const dateRaw = at(row, header.index.date);
    const clockInRaw = at(row, header.index.clockIn);
    const clockOutRaw = at(row, header.index.clockOut);
    const blank =
      !route &&
      !kind &&
      !run &&
      (dateRaw == null || dateRaw === '') &&
      (clockInRaw == null || clockInRaw === '') &&
      (clockOutRaw == null || clockOutRaw === '');
    if (blank) return;
    let date = '';
    let clockIn = '';
    let clockOut = '';
    try {
      date = isoDateFromCell(dateRaw, 'Date');
      clockIn = clockFromCell(clockInRaw);
      clockOut = clockFromCell(clockOutRaw);
    } catch (error) {
      throw new Error(`Row ${rowNumber}: ${error.message}`);
    }
    rows.push({
      line: rowNumber,
      route,
      driver: cellText(at(row, header.index.driver)),
      kind,
      date,
      run,
      clockIn,
      clockOut,
      note: cellText(at(row, header.index.note)),
    });
  });
  return rows;
}

/**
 * @param {ExcelJS.Workbook} workbook
 */
function driversFromWorkbook(workbook) {
  const sheet =
    workbook.worksheets.find((item) => item.name.trim().toLowerCase() === DRIVERS_SHEET.toLowerCase()) ??
    workbook.worksheets.find((item) => {
      const header = String(item.getRow(1).getCell(1).value ?? '')
        .trim()
        .toLowerCase();
      return header === 'driver' || header === 'name' || header === 'first name';
    });
  if (!sheet) return [];
  const labels = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    labels[col - 1] = cellText(cell.value).toLowerCase();
  });
  const firstCol = labels.findIndex((label) => label === 'first name' || label === 'first');
  const lastCol = labels.findIndex((label) => label === 'last name' || label === 'last');
  const nameCol = labels.findIndex((label) => label === 'driver' || label === 'name');
  if (firstCol < 0 && nameCol < 0) return [];
  const phoneCol = labels.findIndex((label) => label === 'phone');
  const emailCol = labels.findIndex((label) => label === 'email');
  /** @type {Array<{ id: string, name: string, firstName: string, lastName: string, phone: string, email: string }>} */
  const drivers = [];
  const seen = new Set();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const firstName = firstCol < 0 ? '' : cellText(row.getCell(firstCol + 1).value);
    const lastName = lastCol < 0 ? '' : cellText(row.getCell(lastCol + 1).value);
    const combined = firstCol >= 0 ? joinPersonName(firstName, lastName) : '';
    const name = combined || (nameCol < 0 ? '' : cellText(row.getCell(nameCol + 1).value));
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    const parts = firstCol >= 0 ? { firstName, lastName } : splitPersonName(name);
    drivers.push({
      id: driverIdFor(name),
      name,
      firstName: parts.firstName,
      lastName: parts.lastName,
      phone: phoneCol < 0 ? '' : cellText(row.getCell(phoneCol + 1).value),
      email: emailCol < 0 ? '' : cellText(row.getCell(emailCol + 1).value),
    });
  });
  return drivers;
}

/**
 * @param {unknown} value
 */
function isEmptyCell(value) {
  const raw = unwrap(value);
  if (raw == null || raw === '') return true;
  if (raw instanceof Date || typeof raw === 'number') return false;
  return String(raw).trim() === '';
}

/**
 * @param {unknown} value
 */
function noteFromContracted(value) {
  const text = cellText(value).replace(/\r\n/g, '\n');
  const lined = text.match(/(?:^|\n)\s*Note:\s*([\s\S]*)$/i);
  if (lined) return lined[1].trim();
  const inline = text.match(/Note:\s*(.+)$/i);
  return inline ? inline[1].trim() : '';
}

/**
 * @param {ExcelJS.Worksheet} sheet
 */
function scheduleHeader(sheet) {
  const last = Math.min(sheet.rowCount || 1, 40);
  for (let rowNumber = 1; rowNumber <= last; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    /** @type {string[]} */
    const labels = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      labels[col - 1] = cellText(cell.value).toLowerCase();
    });
    const index = matchHeaders(labels, {
      date: ['effective', 'new schedule started'],
      amIn: ['am start'],
      amOut: ['am end'],
      middayIn: ['midday start'],
      middayOut: ['midday end'],
      pmIn: ['pm start'],
      pmOut: ['pm end'],
    });
    if (!index) continue;
    return {
      rowNumber,
      index,
      contracted: labels.findIndex((label) => label === 'contracted'),
      force: labels.findIndex((label) => label === 'force oct 1 contract'),
    };
  }
  return null;
}

/**
 * @param {Array<{ driver: string, from: string, until: string }>} assignments
 * @param {string} fallback
 * @param {string} date
 */
function driverForAssignments(assignments, fallback, date) {
  if (!assignments.length) return fallback;
  const match = [...assignments]
    .reverse()
    .find((item) => item.from && item.from <= date && (!item.until || date < item.until));
  return match?.driver || fallback || assignments.at(-1)?.driver || '';
}

/**
 * @param {ExcelJS.Worksheet} sheet
 * @param {number} headerRow
 */
function readPreamble(sheet, headerRow) {
  let route = '';
  let driver = '';
  let note = '';
  /** @type {Array<{ driver: string, from: string, until: string }>} */
  const assignments = [];
  let inTable = false;
  for (let rowNumber = 1; rowNumber < headerRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const a = cellText(row.getCell(1).value);
    const bRaw = row.getCell(2).value;
    const cRaw = row.getCell(3).value;
    const aKey = a.toLowerCase();
    const bKey = cellText(bRaw).toLowerCase();
    const cKey = cellText(cRaw).toLowerCase();
    if (aKey === 'route') {
      route = cellText(bRaw);
      continue;
    }
    if (aKey === 'note') {
      note = cellText(bRaw);
      continue;
    }
    if (aKey === 'driver' && bKey === 'from' && cKey === 'until') {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (!a) continue;
      let from = '';
      let until = '';
      try {
        from = isoDateFromCell(bRaw, 'From');
        if (!isEmptyCell(cRaw)) until = isoDateFromCell(cRaw, 'Until');
      } catch (error) {
        throw new Error(`${sheet.name} row ${rowNumber}: ${error.message}`);
      }
      assignments.push({ driver: a, from, until });
      continue;
    }
    if (aKey === 'driver') driver = cellText(bRaw);
  }
  if (!route) route = sheet.name.replace(/\s+\(route\)$/i, '').replace(/\s+\(\d+\)$/i, '').trim();
  return { route, driver, assignments, note };
}

/**
 * @param {ExcelJS.Worksheet} sheet
 * @param {{ rowNumber: number, index: Record<string, number>, contracted: number }} header
 */
function clockRowsFromScheduleSheet(sheet, header) {
  const { route, driver, assignments, note } = readPreamble(sheet, header.rowNumber);
  if (!route) {
    throw new Error(`Sheet "${sheet.name}" is missing a route number.`);
  }
  const fallback = driver || assignments.at(-1)?.driver || '';
  /** @type {Array<{ line: number, route: string, driver: string, kind: string, date: string, run: string, clockIn: string, clockOut: string, note: string }>} */
  const rows = [];
  /** @type {Record<string, { clockIn: string, clockOut: string } | null>} */
  let previous = { AM: null, MIDDAY: null, PM: null };
  let seen = false;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= header.rowNumber) return;
    const dateRaw = row.getCell(header.index.date + 1).value;
    /** @type {Record<string, { clockIn: string, clockOut: string } | null>} */
    const runs = {};
    let any = false;
    for (const run of RUN_COLUMNS) {
      const inRaw = row.getCell(header.index[run.inKey] + 1).value;
      const outRaw = row.getCell(header.index[run.outKey] + 1).value;
      if (isEmptyCell(inRaw) && isEmptyCell(outRaw)) {
        runs[run.id] = null;
        continue;
      }
      any = true;
      let clockIn = '';
      let clockOut = '';
      try {
        clockIn = clockFromCell(inRaw);
        clockOut = clockFromCell(outRaw);
      } catch (error) {
        throw new Error(`${sheet.name} row ${rowNumber}: ${error.message}`);
      }
      if (!clockIn || !clockOut) {
        throw new Error(`${sheet.name} row ${rowNumber}: ${run.label} needs both a start and an end.`);
      }
      runs[run.id] = { clockIn, clockOut };
    }
    if (!any && isEmptyCell(dateRaw)) return;
    let date = '';
    try {
      date = isoDateFromCell(dateRaw, 'Effective');
    } catch (error) {
      throw new Error(`${sheet.name} row ${rowNumber}: ${error.message}`);
    }
    const note =
      header.contracted >= 0 ? noteFromContracted(row.getCell(header.contracted + 1).value) : '';
    const forceOct1 =
      header.force >= 0 &&
      isForcedOctober1Contract(row.getCell(header.force + 1).value);
    const rowDriver = driverForAssignments(assignments, fallback, date);
    if (!seen) {
      for (const run of RUN_COLUMNS) {
        const times = runs[run.id];
        if (!times) continue;
        rows.push({
          line: rowNumber,
          route,
          driver: rowDriver,
          kind: 'start',
          date,
          run: run.label,
          clockIn: times.clockIn,
          clockOut: times.clockOut,
          note: '',
        });
      }
      seen = true;
    } else {
      for (const run of RUN_COLUMNS) {
        const times = runs[run.id];
        const prior = previous[run.id];
        if (!times) continue;
        if (prior && prior.clockIn === times.clockIn && prior.clockOut === times.clockOut) continue;
        rows.push({
          line: rowNumber,
          route,
          driver: rowDriver,
          kind: prior ? 'change' : 'start',
          date,
          run: run.label,
          clockIn: times.clockIn,
          clockOut: times.clockOut,
          note: prior ? note : '',
          forceOct1: prior ? forceOct1 : false,
        });
      }
    }
    previous = runs;
  });
  return { rows, route, note };
}

/**
 * @param {{ profiles?: Record<string, object> }} state
 * @param {Map<string, string>} notes
 */
function attachRouteNotes(state, notes) {
  for (const profile of Object.values(state.profiles ?? {})) {
    const note = notes.get(String(profile.name ?? '').trim().toLowerCase());
    if (note) profile.note = note;
  }
  return state;
}

/**
 * @param {Buffer | Uint8Array | ArrayBuffer} bytes
 * @param {{ currentRoute?: string | null }} [options]
 */
export async function stateFromRouteWorkbook(bytes, options = {}) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch {
    throw new Error(
      'That file is not an Excel workbook. Download Current Route Data.xlsx from the dashboard, or open the file in Excel and save it as .xlsx.'
    );
  }
  const scheduleSheets = workbook.worksheets
    .map((sheet) => ({ sheet, header: scheduleHeader(sheet) }))
    .filter((item) => item.header);
  if (scheduleSheets.length) {
    /** @type {Map<string, string>} */
    const notes = new Map();
    const rows = scheduleSheets.flatMap(({ sheet, header }) => {
      const parsed = clockRowsFromScheduleSheet(sheet, header);
      const note = String(parsed.note ?? '').trim();
      if (note) notes.set(parsed.route.trim().toLowerCase(), note);
      return parsed.rows;
    });
    return attachRouteNotes(
      stateFromClockRows(rows, {
        currentRoute: options.currentRoute,
        drivers: driversFromWorkbook(workbook),
      }),
      notes
    );
  }
  const sheet =
    workbook.worksheets.find((item) => clockHeader(item) && item.name.trim().toLowerCase() === CLOCK_SHEET.toLowerCase()) ??
    workbook.worksheets.find((item) => clockHeader(item));
  const header = sheet ? clockHeader(sheet) : null;
  if (!sheet || !header) {
    throw new Error(
      'Each route needs its own sheet with columns for New Schedule Started, AM start, AM end, Midday start, Midday end, PM start, and PM end. Older files that say Effective still upload. A file with one "Route clock times" sheet still uploads.'
    );
  }
  const rows = clockRowsFromSheet(sheet, header);
  return stateFromClockRows(rows, {
    currentRoute: options.currentRoute,
    drivers: driversFromWorkbook(workbook),
  });
}
