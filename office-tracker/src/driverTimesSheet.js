import { parseCsv, stateFromClockRows } from './routesCsv.js';

/** Starting snapshot for the 2026-27 roster. These times are the contract from this day. */
export const DRIVER_TIMES_CONTRACT_DATE = '2026-10-01';

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
        date: DRIVER_TIMES_CONTRACT_DATE,
        run,
        clockIn,
        clockOut,
        note: '',
      });
    }
  });

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
