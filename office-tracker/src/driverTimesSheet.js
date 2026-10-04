import ExcelJS from 'exceljs';
import { parseClockTime } from '../../src/logic/timeUtils.js';
import { formatClockMinutes } from '../../employee-tracker/src/clockTimes.js';
import { clockFromCell } from './routeWorkbook.js';
import { parseCsv, stateFromClockRows } from './routesCsv.js';

/** Bid-day clocks are the established schedule. August 31 is the day before the school year. */
export const DRIVER_TIMES_START_DATE = '2026-08-31';

/** @deprecated Use DRIVER_TIMES_START_DATE. Kept so older imports still resolve. */
export const DRIVER_TIMES_CONTRACT_DATE = DRIVER_TIMES_START_DATE;

const COL = {
  route: 2,
  last: 3,
  first: 4,
  amIn: 5,
  amOut: 6,
  midIn: 10,
  midOut: 11,
  midTag: 12,
  midHours: 15,
  pmIn: 16,
  pmOut: 17,
  comments: 23,
};

/**
 * @param {string} value
 */
function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} raw
 */
function to24(raw) {
  const text = clean(raw);
  if (!text) return '';
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(text);
  if (!match) return '';
  let hours = Number(match[1]);
  const minutes = match[2];
  const meridiem = match[3].toUpperCase();
  if (meridiem === 'AM') {
    if (hours === 12) hours = 0;
  } else if (hours !== 12) {
    hours += 12;
  }
  return `${hours}:${minutes}`;
}

/**
 * @param {string} first
 * @param {string} last
 */
function personName(first, last) {
  return [clean(first), clean(last)].filter(Boolean).join(' ');
}

/**
 * @param {string} name
 */
function driverId(name) {
  return `driver-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

/**
 * @param {string} decimal
 */
function hoursLabel(decimal) {
  const hours = Number(clean(decimal));
  if (!Number.isFinite(hours) || hours <= 0) return '';
  return hours.toFixed(2);
}

/**
 * @param {string[]} cells
 */
function readDriverRow(cells) {
  const route = clean(cells[COL.route]);
  const first = clean(cells[COL.first]);
  const last = clean(cells[COL.last]);
  const driver = personName(first, last);
  const amIn = to24(cells[COL.amIn]);
  const amOut = to24(cells[COL.amOut]);
  const midIn = to24(cells[COL.midIn]);
  const midOut = to24(cells[COL.midOut]);
  const pmIn = to24(cells[COL.pmIn]);
  const pmOut = to24(cells[COL.pmOut]);
  const midTag = clean(cells[COL.midTag]);
  const comments = clean(cells[COL.comments]);
  const unpaidMid =
    !midIn &&
    !midOut &&
    /^(shop|off)$/i.test(midTag);
  return {
    route,
    first,
    last,
    driver,
    amIn,
    amOut,
    midIn,
    midOut,
    pmIn,
    pmOut,
    midTag,
    midHours: hoursLabel(cells[COL.midHours]),
    comments,
    unpaidMid,
    utility: /^utility$/i.test(route),
  };
}

/**
 * @param {ReturnType<typeof readDriverRow>} row
 */
function routeLabel(row) {
  if (row.utility) {
    return row.last ? `Utility — ${row.last}` : 'Utility';
  }
  return row.route;
}

/**
 * @param {string[]} parts
 */
function joinNotes(parts) {
  let text = '';
  for (const part of parts.filter(Boolean)) {
    if (!text) {
      text = part;
      continue;
    }
    text += /[.!?]$/.test(text) ? ` ${part}` : `. ${part}`;
  }
  return text;
}

/**
 * @param {ReturnType<typeof readDriverRow>} row
 */
function routeNote(row) {
  /** @type {string[]} */
  const parts = [];
  if (row.comments && !(row.utility && /^utility$/i.test(row.comments))) parts.push(row.comments);
  if (row.unpaidMid) {
    const place = /^off$/i.test(row.midTag) ? 'Office' : 'Shop';
    const hours = row.midHours ? `${row.midHours} hours` : 'time';
    parts.push(
      `${place} ${hours} with no clock-in or clock-out. Left out of contracted hours.`
    );
  }
  if (row.utility) {
    parts.push('Utility day, 7:00 AM–3:00 PM. Recorded as one span, not an AM run and a PM run.');
  }
  if (!row.driver && (row.amIn || row.pmIn)) {
    parts.push('No driver assigned.');
  }
  return joinNotes(parts);
}

/**
 * Turn the 2026-27 driver-times sheet into October 1 starting routes.
 * Shop and office blocks without clocks are notes. Empty routes are skipped.
 * Clocked midday stays, including runs that do not happen every day.
 * @param {string} csv
 */
export function officeStateFromDriverTimesCsv(csv) {
  const table = parseCsv(csv);
  /** @type {Array<{ line: number, route: string, driver: string, kind: string, date: string, run: string, clockIn: string, clockOut: string, note: string }>} */
  const clockRows = [];
  /** @type {Map<string, string>} */
  const notes = new Map();
  /** @type {Map<string, { id: string, name: string, firstName: string, lastName: string, phone: string, email: string }>} */
  const drivers = new Map();

  table.forEach((cells, index) => {
    const row = readDriverRow(cells);
    if (!row.route || /^route$/i.test(row.route)) return;
    const hasClocks = Boolean(row.amIn || row.midIn || row.pmIn);
    if (!row.driver && !hasClocks) return;

    const route = routeLabel(row);
    const note = routeNote(row);
    if (note) notes.set(route.toLowerCase(), note);
    if (row.driver && !drivers.has(row.driver.toLowerCase())) {
      drivers.set(row.driver.toLowerCase(), {
        id: driverId(row.driver),
        name: row.driver,
        firstName: row.first,
        lastName: row.last,
        phone: '',
        email: '',
      });
    }

    const runs = [
      ['AM', row.amIn, row.amOut],
      ['Midday', row.midIn, row.midOut],
      ['PM', row.pmIn, row.pmOut],
    ];
    for (const [run, clockIn, clockOut] of runs) {
      if (!clockIn && !clockOut) continue;
      clockRows.push({
        line: index + 1,
        route,
        driver: row.driver,
        kind: 'start',
        date: DRIVER_TIMES_START_DATE,
        run,
        clockIn,
        clockOut,
        note: '',
      });
    }
  });

  return finishOfficeState(clockRows, notes, drivers);
}

/**
 * @param {Array<object>} clockRows
 * @param {Map<string, string>} notes
 * @param {Map<string, object>} drivers
 */
function finishOfficeState(clockRows, notes, drivers) {
  const state = stateFromClockRows(clockRows, {
    drivers: [...drivers.values()],
  });
  for (const profile of Object.values(state.profiles)) {
    const note = notes.get(String(profile.name ?? '').trim().toLowerCase());
    if (note) profile.note = note;
    if (!String(profile.driver_name ?? '').trim()) {
      for (const event of profile.changeLog ?? []) {
        event.driver_name = '';
        event.entered_by = '';
      }
    }
  }
  return state;
}

const BID = {
  route: 3,
  last: 4,
  first: 5,
  amIn: 6,
  amOut: 7,
  midIn: 11,
  midOut: 12,
  midTag: 13,
  midHours: 16,
  pmIn: 17,
  pmOut: 18,
  notes: 45,
};

const SEP = {
  amIn: 24,
  amOut: 25,
  midIn: 29,
  midOut: 30,
  midTag: 31,
  midHours: 34,
  pmIn: 35,
  pmOut: 36,
  notes: 44,
};

/**
 * This sheet stores a few September PM punches as morning times (2:05 AM)
 * or as text like "2:05PM". A PM column before noon is read as afternoon.
 * @param {unknown} value
 * @param {boolean} afternoon
 */
function readClock(value, afternoon) {
  if (value === 0 || value === '0') return '';
  const clock = clockFromCell(value);
  if (!clock || clock === '0:00') return '';
  if (!afternoon) return clock;
  const minutes = parseClockTime(clock);
  const hours = Math.floor(minutes / 60);
  if (hours >= 1 && hours < 12) return formatClockMinutes(minutes + 12 * 60);
  return clock;
}

/**
 * @param {unknown} value
 */
function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return '';
  if (typeof value === 'object') {
    if (value.result != null && value.result !== value) return cellText(value.result);
    if (Array.isArray(value.richText)) {
      return clean(value.richText.map((part) => part.text ?? '').join(''));
    }
    if (value.text != null) return clean(value.text);
  }
  const text = clean(value);
  if (text === '0' || text === '0.00') return '';
  return text;
}

/**
 * @param {import('exceljs').Cell} cell
 * @param {boolean} [afternoon]
 */
function clockAt(cell, afternoon = false) {
  return readClock(cell?.value, afternoon);
}

/**
 * @param {import('exceljs').Worksheet} sheet
 */
function assertDriverTimesShape(sheet) {
  const banner = cellText(sheet.getRow(2).getCell(SEP.amIn).value);
  const routeHeader = cellText(sheet.getRow(3).getCell(BID.route).value);
  const septemberAm = cellText(sheet.getRow(3).getCell(SEP.amIn).value);
  if (!/september adjustments/i.test(banner) || !/route/i.test(routeHeader) || !/am in/i.test(septemberAm)) {
    throw new Error('That workbook is not the 2026-27 driver times sheet with September Adjustments.');
  }
}

/**
 * Bid-day clocks are the established schedule, dated August 31.
 * September clocks that differ are one later schedule with no start date,
 * marked Force Oct 1 Contract.
 * A September run with no clocks removes that run. A route that only has
 * September clocks is established from those clocks.
 * @param {Buffer | Uint8Array | ArrayBuffer} bytes
 */
export async function officeStateFromDriverTimesWorkbook(bytes) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet('2026-2027') ?? workbook.worksheets[0];
  if (!sheet) throw new Error('That workbook has no sheets.');
  assertDriverTimesShape(sheet);

  /** @type {Array<object>} */
  const clockRows = [];
  /** @type {Map<string, string>} */
  const notes = new Map();
  /** @type {Map<string, object>} */
  const drivers = new Map();

  const runs = [
    ['AM', 'amIn', 'amOut', false],
    ['Midday', 'midIn', 'midOut', false],
    ['PM', 'pmIn', 'pmOut', true],
  ];

  for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const routeName = cellText(row.getCell(BID.route).value);
    if (!routeName || /^route$/i.test(routeName)) continue;

    const first = cellText(row.getCell(BID.first).value);
    const last = cellText(row.getCell(BID.last).value);
    const driver = personName(first, last);
    const utility = /^utility$/i.test(routeName);
    const midTag = cellText(row.getCell(BID.midTag).value);
    const sepMidTag = cellText(row.getCell(SEP.midTag).value);
    const comments = cellText(row.getCell(BID.notes).value);
    const sepNote = cellText(row.getCell(SEP.notes).value);

    /** @type {Record<string, { clockIn: string, clockOut: string } | null>} */
    const bid = {};
    /** @type {Record<string, { clockIn: string, clockOut: string } | null>} */
    const sep = {};
    for (const [run, inKey, outKey, afternoon] of runs) {
      const bidIn = clockAt(row.getCell(BID[inKey]), afternoon);
      const bidOut = clockAt(row.getCell(BID[outKey]), afternoon);
      const sepIn = clockAt(row.getCell(SEP[inKey]), afternoon);
      const sepOut = clockAt(row.getCell(SEP[outKey]), afternoon);
      if ((bidIn && !bidOut) || (!bidIn && bidOut)) {
        throw new Error(`Route ${routeName} bid ${run} needs both a clock-in and a clock-out.`);
      }
      if ((sepIn && !sepOut) || (!sepIn && sepOut)) {
        throw new Error(`Route ${routeName} September ${run} needs both a clock-in and a clock-out.`);
      }
      bid[run] = bidIn ? { clockIn: bidIn, clockOut: bidOut } : null;
      sep[run] = sepIn ? { clockIn: sepIn, clockOut: sepOut } : null;
    }

    const hasBid = Object.values(bid).some(Boolean);
    const hasSep = Object.values(sep).some(Boolean);
    if (!driver && !hasBid && !hasSep) continue;

    const label = routeLabel({ utility, last, route: routeName });
    const unpaidMid =
      !bid.Midday &&
      !sep.Midday &&
      (/^(shop|off)$/i.test(midTag) || /^(shop|off)$/i.test(sepMidTag));
    const note = routeNote({
      comments,
      utility,
      unpaidMid,
      midTag: /^(shop|off)$/i.test(midTag) ? midTag : sepMidTag,
      midHours: hoursLabel(row.getCell(BID.midHours).value || row.getCell(SEP.midHours).value),
      driver,
      amIn: bid.AM?.clockIn || sep.AM?.clockIn || '',
      pmIn: bid.PM?.clockIn || sep.PM?.clockIn || '',
    });
    if (note) notes.set(label.toLowerCase(), note);
    if (driver && !drivers.has(driver.toLowerCase())) {
      drivers.set(driver.toLowerCase(), {
        id: driverId(driver),
        name: driver,
        firstName: first,
        lastName: last,
        phone: '',
        email: '',
      });
    }

    for (const [run] of runs) {
      const established = bid[run] || (!hasBid ? sep[run] : null);
      if (!established) continue;
      clockRows.push({
        line: rowNumber,
        route: label,
        driver,
        kind: 'start',
        date: DRIVER_TIMES_START_DATE,
        run,
        clockIn: established.clockIn,
        clockOut: established.clockOut,
        note: '',
      });
    }
    if (!hasBid) continue;
    const scheduleId = `september-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    for (const [run] of runs) {
      const before = bid[run];
      const after = sep[run];
      if (!before && after) {
        clockRows.push({
          line: rowNumber,
          route: label,
          driver,
          kind: 'start',
          date: DRIVER_TIMES_START_DATE,
          run,
          clockIn: after.clockIn,
          clockOut: after.clockOut,
          note: '',
        });
        continue;
      }
      if (before && !after) {
        clockRows.push({
          line: rowNumber,
          route: label,
          driver,
          kind: 'change',
          date: '',
          run,
          clockIn: '',
          clockOut: '',
          note: sepNote,
          forceOct1: true,
          cleared: true,
          scheduleId,
        });
        continue;
      }
      if (!before || !after) continue;
      if (before.clockIn === after.clockIn && before.clockOut === after.clockOut) continue;
      clockRows.push({
        line: rowNumber,
        route: label,
        driver,
        kind: 'change',
        date: '',
        run,
        clockIn: after.clockIn,
        clockOut: after.clockOut,
        note: sepNote,
        scheduleId,
        forceOct1: true,
      });
    }
  }

  return finishOfficeState(clockRows, notes, drivers);
}
