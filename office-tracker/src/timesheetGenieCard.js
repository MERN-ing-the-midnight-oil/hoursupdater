import { parseAuditHours } from './timesheetAudit.js';
import { inferDefaultYear, pairStampLines, rowFromClockStamps } from './timesheetNormalize.js';
import { splitTotHoursIntoRegOt } from './timesheetRegOt.js';
import { runForStartDate } from './timesheetRunTable.js';
import { snapsForCardRows } from './timesheetSnap.js';
import { localDateKey } from '../../src/logic/timesheets.js';

export const GENIE_CARD_SYSTEM = `You read one photo of one side of a sky-blue paper timecard. The message says FRONT or BACK. Other sides and other cards are sent separately. A card may have only this side.

Read the far-right "Clock Record" column. Also read the narrow column to the left of the "Tot. Hrs." column on a front. On a back, that same column is to the left of the "Total" column (it isn't labeled with a header). Its words are printed sideways and say only OUT or IN. That word is the Out or In status of the stamp on the same line.

Return one entry for every printed Clock Record line, top to bottom on the photo. Begin with the line nearest the top of the photo and move downward. Do not sort lines by date or time. There is no set number of lines. Each entry is one clock time on one printed line. Do not combine an Out line and an In line into the same entry. Each entry has:
- side — "out" or "in", from the sideways word on that line
- stamp — one of
  - null — that stamp is blank
  - "HANDWRITING" — handwritten (not a machine stamp)
  - "illegible" — struck through, blurry, cut off, or not clearly readable
  - one stamp string when month, day, AM or PM, and time are all clear — prefer "MON D AM|PM H:MM", e.g. "MAR 9 PM 2:00"

The sideways words alternate from one line to the next. If a sideways word is unclear, set side to the opposite of the line next to it.
The blank bottom margin, the border, and the card edge have no sideways OUT or IN. They are not lines.

Never guess a month, day, AM/PM, or time. Prefer "illegible" over a guessed time.

When this photo is the FRONT, also read the white sticker at the top. It is always there.
Left column, top to bottom: driver name (Last, First), route number after "Route #", contract hours line copied exactly as printed. That line is the total, then up to three run hours in parentheses, comma-separated: AM, midday, and PM. Two numbers inside the parentheses are AM and PM and there is no midday, e.g. "4.25 (2, 2.5)" or "5.25 (2, 3.25)". Three numbers are AM, midday, and PM. A single number is the total only.
Right column: the date as MM/DD/YY or M/DD/YY.
Return employee_name, route_number, contract_hours, and date_on_card. Use null when not clearly visible. Do not invent sticker fields from the Clock Record.
When this photo is the BACK, set those sticker fields to null.

Do not write notes. Return only the tool fields for this one photo.`;

/**
 * The photo message only names the side. The system prompt holds the rules.
 * @param {'front' | 'back'} side
 */
export function genieCardUserPrefix(side) {
  return `This photo is the ${side.toUpperCase()}. List each clock time on its own, from the top of the photo downward. Do not combine an Out line and an In line.`;
}

/**
 * @param {string} which
 */
function stampValueSchema(which) {
  return {
    description: `${which} stamp: null when blank, "HANDWRITING", "illegible", or one stamp string such as "MAR 9 PM 2:00".`,
    anyOf: [
      { type: 'null' },
      { type: 'string', enum: ['HANDWRITING', 'illegible'] },
      { type: 'string' },
    ],
  };
}

/**
 * Forced tool. One clock time per entry. The list has no fixed length.
 * @param {{ sticker?: boolean }} [options]
 */
export function genieCardTool(options = {}) {
  const sticker = options.sticker === true;
  return {
    name: 'report_genie_card',
    description: sticker
      ? 'Report each clock time on its own line with its sideways OUT or IN, plus the front sticker fields. Do not combine Out and In. Any length.'
      : 'Report each clock time on its own line with its sideways OUT or IN. Do not combine Out and In. Any length. Sticker fields are null on the back.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['slots', 'employee_name', 'route_number', 'contract_hours', 'date_on_card'],
      properties: {
        employee_name: {
          description: 'The driver name on the front white sticker (Last, First). null on the back, or when it is not visible.',
          anyOf: [{ type: 'null' }, { type: 'string' }],
        },
        route_number: {
          description:
            'The route number after "Route #" on the front sticker. null on the back, or when it is not visible.',
          anyOf: [{ type: 'null' }, { type: 'string' }],
        },
        contract_hours: {
          description:
            'Contract hours line under the route, copied as printed. Total, then AM, midday, and PM in parentheses, comma-separated. Two numbers inside the parentheses are AM and PM with no midday, e.g. "4.25 (2, 2.5)" or "5.25 (2, 3.25)". null on the back, or when missing.',
          anyOf: [{ type: 'null' }, { type: 'string' }, { type: 'number' }],
        },
        date_on_card: {
          description:
            'Date on the front sticker right column as MM/DD/YY or M/DD/YY. null on the back, or when not visible.',
          anyOf: [{ type: 'null' }, { type: 'string' }],
        },
        slots: {
          type: 'array',
          description:
            'One clock time per printed line, top to bottom on the photo. Begin at the top of the photo and move downward. Do not sort by date or time. Do not combine an Out line and an In line into one entry. Any length. Not the bottom margin.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['side', 'stamp'],
            properties: {
              side: {
                type: 'string',
                enum: ['out', 'in'],
                description: 'The sideways OUT or IN printed on this line.',
              },
              stamp: stampValueSchema('Clock Record'),
            },
          },
        },
      },
    },
  };
}

function roundHours(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * The contract-hours line under the route number.
 * One number is the day's contract. "5.25 (2, 3.25)" is total with AM/PM in parentheses.
 * Two or three plain numbers are the run hours, added together.
 * @param {unknown} value
 * @returns {{ total: number, am: number | null, midday: number | null, pm: number | null } | null}
 */
export function parseStickerContractHours(value) {
  if (value == null) return null;
  const text = typeof value === 'number' ? String(value) : String(value).trim();
  if (!text || /^null$/i.test(text) || /^illegible$/i.test(text)) return null;

  const withParen = text.match(/^(\d+(?:\.\d+)?)\s*\(([^)]+)\)\s*$/);
  if (withParen) {
    const total = Number(withParen[1]);
    if (!(Number.isFinite(total) && total > 0 && total <= 24)) return null;
    const parts = [...withParen[2].matchAll(/\d+(?:\.\d+)?/g)]
      .map((match) => Number(match[0]))
      .filter((number) => Number.isFinite(number) && number > 0 && number <= 24);
    if (!parts.length || parts.length > 3) return null;
    if (parts.length === 1) return { total: roundHours(total), am: parts[0], midday: null, pm: null };
    if (parts.length === 2) {
      return { total: roundHours(total), am: parts[0], midday: null, pm: parts[1] };
    }
    return { total: roundHours(total), am: parts[0], midday: parts[1], pm: parts[2] };
  }

  const numbers = [...text.matchAll(/\d+(?:\.\d+)?/g)]
    .map((match) => Number(match[0]))
    .filter((number) => Number.isFinite(number) && number > 0 && number <= 24);
  if (!numbers.length || numbers.length > 3) return null;
  const total = roundHours(numbers.reduce((sum, number) => sum + number, 0));
  if (!(total > 0)) return null;
  if (numbers.length === 1) return { total, am: null, midday: null, pm: null };
  if (numbers.length === 2) return { total, am: numbers[0], midday: null, pm: numbers[1] };
  return { total, am: numbers[0], midday: numbers[1], pm: numbers[2] };
}

function textOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || /^null$/i.test(text)) return null;
  return text;
}

function attachWritten(row, raw) {
  const reg = parseAuditHours(raw?.reg);
  const ot = parseAuditHours(raw?.ot);
  const tot = parseAuditHours(raw?.tot);
  row.written_regular = reg.hours;
  row.written_regular_status = reg.status;
  row.written_overtime = ot.hours;
  row.written_overtime_status = ot.status;
  row.written_total = tot.hours;
  row.written_total_status = tot.status;
  row.hours_regular = reg.status === 'number' ? reg.hours : null;
  row.hours_overtime = ot.status === 'number' ? ot.hours : null;
  row.hours_add_up = null;
  return row;
}

function rowFromGenieSlot(value, rowIndex, year) {
  if (value == null) return attachWritten(rowFromClockStamps(null, rowIndex, year), null);
  if (typeof value === 'string' || Array.isArray(value)) {
    return attachWritten(rowFromClockStamps(value, rowIndex, year), null);
  }
  if (value && typeof value === 'object') {
    if ('out' in value || 'in' in value) {
      return attachWritten(rowFromClockStamps([value.out, value.in], rowIndex, year), value);
    }
    const stamps = Array.isArray(value.stamps) ? value.stamps : value.stamps ?? null;
    return attachWritten(rowFromClockStamps(stamps, rowIndex, year), value);
  }
  return attachWritten(rowFromClockStamps(null, rowIndex, year), null);
}

function rowsFromSide(raw, year) {
  const list = Array.isArray(raw) ? raw : [];
  const rows = [];
  for (const item of list) {
    const row = rowFromGenieSlot(item, rows.length + 1, year);
    if (!row.clock_out_raw && !row.clock_in_raw) continue;
    row.row_index = rows.length + 1;
    rows.push(row);
  }
  return rows;
}

/**
 * Copy of a blue card: stamps, the hours written in each slot, and the sticker contract hours.
 * @param {object | null | undefined} parsed
 */
export function normalizeGenieCardExtraction(parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const contract = parseStickerContractHours(source.contract_hours);
  const header = {
    employee_name: textOrNull(source.employee_name ?? source.header?.employee_name),
    route_number: textOrNull(source.route_number ?? source.header?.route_number),
    date_on_card: textOrNull(source.date_on_card ?? source.header?.date_on_card),
    contract_hours: contract?.total ?? null,
    contract_am_hours: contract?.am ?? null,
    contract_midday_hours: contract?.midday ?? null,
    contract_pm_hours: contract?.pm ?? null,
    default_pay_status: null,
  };
  const year = inferDefaultYear(header.date_on_card);
  const frontRaw = pairStampLines(source.front ?? source.front_rows);
  const backRaw = pairStampLines(source.back ?? source.back_rows);
  return {
    header,
    front_rows: rowsFromSide(frontRaw, year),
    back_rows: rowsFromSide(backRaw, year),
    front_reading_order_note: null,
    caveats: [],
  };
}

function contractHoursValue(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 100) / 100;
}

function roundQuarter(value) {
  return Math.round(Number(value) * 4) / 4;
}

/**
 * AM, midday, and PM contract hours from a sticker header or `{ am, midday, pm }`.
 * Null when the sticker has only a single daily total.
 * An explicit 0 stays 0. A missing run is 0 when another run has hours, so that work is all extra.
 * @param {object | null | undefined} source
 */
export function contractRunParts(source) {
  if (!source || typeof source !== 'object') return null;
  const am = contractHoursValue(source.am ?? source.contract_am_hours);
  const midday = contractHoursValue(source.midday ?? source.contract_midday_hours);
  const pm = contractHoursValue(source.pm ?? source.contract_pm_hours);
  if (am == null && midday == null && pm == null) return null;
  return { am: am ?? 0, midday: midday ?? 0, pm: pm ?? 0 };
}

function rowListsFrom(frontRows, backRows, moreRows) {
  const more = Array.isArray(moreRows) ? moreRows : [];
  return [frontRows, backRows, ...more].map((rows) => (Array.isArray(rows) ? rows : []));
}

function rowSnaps(rows, options) {
  const year = options.defaultYear ?? inferDefaultYear(null);
  return snapsForCardRows(rows, options.breaks, year, options.mode);
}

/**
 * Contract-part key for a span start, using the same AM / MID / PM windows as
 * the extra-time column. A start outside those windows is not a run.
 * @param {Date} date
 * @param {unknown} windows
 * @returns {'am' | 'midday' | 'pm' | ''}
 */
function contractRunKey(date, windows) {
  const run = runForStartDate(date, windows);
  if (run === 'AM') return 'am';
  if (run === 'MID') return 'midday';
  if (run === 'PM') return 'pm';
  return '';
}

/**
 * Clock spans for Tot. Hrs., plus the extra and short past each run contract.
 * Tot. Hrs. is the time between an Out and its In, including when those stamps
 * sit on neighboring lines. The start time picks the run with the same windows
 * as the extra-time column. A run at or under its contract adds no extra, and
 * a short run does not shrink another run. A start outside the windows is not
 * extra. Reg / OT uses that extra.
 * With no run parts, the maps are unused and Tot. Hrs. is still the span.
 * @param {object[][]} rowLists
 * @param {object | null | undefined} contractRuns
 * @param {object} [options]
 * @returns {{ extraByDay: Map<string, number>, shortByDay: Map<string, number>, rawByDay: Map<string, number> } | null}
 */
export function applyRunExtraTotals(rowLists, contractRuns, options = {}) {
  const parts = contractRunParts(contractRuns);
  const lists = (Array.isArray(rowLists) ? rowLists : []).filter(Array.isArray);
  if (!parts) {
    for (const rows of lists) {
      const snaps = rowSnaps(rows, options);
      rows.forEach((row, index) => {
        if (!row) return;
        if (row.crossed_out) {
          row.total_hours = null;
          return;
        }
        row.total_hours = snaps[index]?.totalHours ?? null;
      });
    }
    return null;
  }

  /** @type {Map<string, { row: object, worked: number }[]>} */
  const groups = new Map();
  /** @type {Map<string, number>} */
  const rawByDay = new Map();
  for (const rows of lists) {
    const snaps = rowSnaps(rows, options);
    rows.forEach((row, index) => {
      if (!row) return;
      if (row.crossed_out) {
        row.total_hours = null;
        return;
      }
      const snapped = snaps[index];
      if (snapped?.totalHours == null || !snapped.spanStart) {
        row.total_hours = null;
        return;
      }
      const day = localDateKey(snapped.spanStart);
      const run = contractRunKey(snapped.spanStart, options.windows);
      rawByDay.set(day, roundQuarter((rawByDay.get(day) || 0) + snapped.totalHours));
      if (!run) {
        row.total_hours = snapped.totalHours;
        return;
      }
      const key = `${day}\t${run}`;
      const list = groups.get(key) || [];
      list.push({ row, worked: snapped.totalHours });
      groups.set(key, list);
    });
  }

  /** @type {Map<string, number>} */
  const extraByDay = new Map();
  /** @type {Map<string, number>} */
  const shortByDay = new Map();
  for (const [key, items] of groups) {
    const [day, run] = key.split('\t');
    const worked = roundQuarter(items.reduce((sum, item) => sum + item.worked, 0));
    const contract = parts[run] ?? 0;
    const extra = Math.max(0, roundQuarter(worked - contract));
    const short = Math.max(0, roundQuarter(contract - worked));
    items.forEach((item) => {
      item.row.total_hours = item.worked;
    });
    if (extra > 0) extraByDay.set(day, roundQuarter((extraByDay.get(day) || 0) + extra));
    if (short > 0) shortByDay.set(day, roundQuarter((shortByDay.get(day) || 0) + short));
  }
  return { extraByDay, shortByDay, rawByDay };
}

/**
 * Contract figure `scaleRegOtToContractGap` subtracts from the day's clock span
 * so the residual equals the extra past the run contracts. A single daily
 * total stays the subtractand when the sticker has no run parts.
 * @param {object[][]} lists
 * @param {unknown} contractHours
 * @param {object} [options]
 * @returns {Map<string, string> | null}
 */
function contractedByDayFor(lists, contractHours, options = {}) {
  const extras = applyRunExtraTotals(lists, options.contractRuns, options);
  if (extras) {
    const contracted = new Map();
    for (const [day, raw] of extras.rawByDay) {
      const effective = roundQuarter(raw - (extras.extraByDay.get(day) || 0));
      if (effective > 0) contracted.set(day, String(effective));
    }
    return contracted.size ? contracted : null;
  }
  const contract = Number(contractHours);
  if (!Number.isFinite(contract) || contract <= 0) return null;
  /** @type {string[]} */
  const dayKeys = [];
  for (const rows of lists) {
    const snaps = rowSnaps(rows, options);
    rows.forEach((row, index) => {
      if (!row || row.crossed_out) return;
      const snapped = snaps[index];
      if (snapped?.totalHours == null || !snapped.spanStart) return;
      dayKeys.push(localDateKey(snapped.spanStart));
    });
  }
  if (!dayKeys.length) return null;
  return new Map(dayKeys.map((key) => [key, String(contract)]));
}

function writtenOf(row, field) {
  const statusKey = field === 'reg' ? 'written_regular_status' : 'written_overtime_status';
  const hoursKey = field === 'reg' ? 'written_regular' : 'written_overtime';
  const legacyKey = field === 'reg' ? 'hours_regular' : 'hours_overtime';
  if (row && (row[statusKey] === 'blank' || row[statusKey] === 'number' || row[statusKey] === 'illegible')) {
    return {
      status: row[statusKey],
      hours: row[statusKey] === 'number' ? roundHours(row[hoursKey]) : null,
    };
  }
  return parseAuditHours(row?.[legacyKey]);
}

/**
 * Fill Reg / OT on the app side from snapped clocks (Genie never reads those cells).
 * Without contract hours: each row gets the overtime-rules split of its clock span.
 * With only a daily contract total: the residual past that total, on the first
 * clocked row. At or under contract both stay blank.
 * With AM / midday / PM contract hours: Tot. Hrs. stays each pair's clock span.
 * Reg / OT is the sum of time past each run for the date (still one combo, on the
 * first clocked row), using the same run windows as the extra-time column.
 * A short run does not reduce the extra from another run.
 * Mutates `hours_regular` / `hours_overtime`, `total_hours`, and the written_* fields.
 * @param {object[] | null | undefined} frontRows
 * @param {object[] | null | undefined} backRows
 * @param {unknown} contractHours
 * @param {object} [options]
 */
export function applyContractRegOtRows(frontRows, backRows, contractHours, options = {}) {
  const lists = rowListsFrom(frontRows, backRows, options.moreRows);
  const year = options.defaultYear ?? inferDefaultYear(null);
  const contractedByDay = contractedByDayFor(lists, contractHours, options);

  const clones = lists.map((rows) =>
    rows.map((row) => ({ ...(row || {}), hours_regular: null, hours_overtime: null }))
  );

  splitTotHoursIntoRegOt(clones, {
    breaks: options.breaks,
    rules: options.rules,
    holidays: options.holidays,
    defaultYear: year,
    mode: options.mode,
    contractedByDay,
  });

  lists.forEach((rows, listIndex) => {
    const snaps = rowSnaps(rows, { ...options, defaultYear: year });
    rows.forEach((row, index) => {
      if (!row) return;
      const snapped = snaps[index];
      if (snapped?.totalHours == null) {
        clearRegOtWriting(row);
        return;
      }
      const calc = clones[listIndex][index];
      writeRegOt(row, calc?.hours_regular, calc?.hours_overtime);
    });
  });
}

/**
 * Mark each day whose written Reg + OT sum does not match that day's extra.
 * With run contract hours the extra is the sum of time past each run.
 * With only a daily total it is the clock span past that total.
 * At or under contract the expected extra is zero. One expected combo per date.
 * Illegible hours leave the day unmarked. Rows with no clock total are left unmarked.
 * Sets `hours_add_up` to true, false, or null.
 * @param {object[] | null | undefined} frontRows
 * @param {object[] | null | undefined} backRows
 * @param {unknown} contractHours
 * @param {object} [options]
 */
export function markContractHourRows(frontRows, backRows, contractHours, options = {}) {
  const lists = rowListsFrom(frontRows, backRows, options.moreRows);
  for (const rows of lists) {
    for (const row of rows) {
      if (row) row.hours_add_up = null;
    }
  }
  const contract = Number(contractHours);
  const parts = contractRunParts(options.contractRuns);
  if ((!Number.isFinite(contract) || contract <= 0) && !parts) return;

  const year = options.defaultYear ?? inferDefaultYear(null);
  const clones = lists.map((rows) =>
    rows.map((row) => ({ ...(row || {}), hours_regular: null, hours_overtime: null }))
  );
  const contractedByDay = contractedByDayFor(lists, contractHours, options);
  splitTotHoursIntoRegOt(clones, {
    breaks: options.breaks,
    rules: options.rules,
    holidays: options.holidays,
    defaultYear: year,
    mode: options.mode,
    contractedByDay,
  });

  /** @type {Map<string, { row: object, calc: object }[]>} */
  const byDay = new Map();
  lists.forEach((rows, listIndex) => {
    const snaps = rowSnaps(rows, { ...options, defaultYear: year });
    rows.forEach((row, index) => {
      if (!row) return;
      const snapped = snaps[index];
      if (snapped?.totalHours == null || !snapped.spanStart) return;
      const key = localDateKey(snapped.spanStart);
      const list = byDay.get(key) || [];
      list.push({ row, calc: clones[listIndex][index] });
      byDay.set(key, list);
    });
  });

  for (const items of byDay.values()) {
    let illegible = false;
    let written = 0;
    let expected = 0;
    /** @type {object[]} */
    const writers = [];
    for (const item of items) {
      const writtenReg = writtenOf(item.row, 'reg');
      const writtenOt = writtenOf(item.row, 'ot');
      if (writtenReg.status === 'illegible' || writtenOt.status === 'illegible') {
        illegible = true;
      }
      written = roundHours(written + (writtenReg.hours || 0) + (writtenOt.hours || 0));
      expected = roundHours(
        expected + (item.calc?.hours_regular || 0) + (item.calc?.hours_overtime || 0)
      );
      if (writtenReg.status === 'number' || writtenOt.status === 'number') {
        writers.push(item.row);
      }
    }
    if (illegible) continue;
    const match = Math.abs(written - expected) < 0.02;
    const flagRows = writers.length ? writers : [items[0].row];
    for (const item of items) {
      if (match) {
        item.row.hours_add_up = true;
      } else {
        item.row.hours_add_up = flagRows.includes(item.row) ? false : true;
      }
    }
  }
}

function clearRegOtWriting(row) {
  row.hours_regular = null;
  row.hours_overtime = null;
  row.written_regular = null;
  row.written_regular_status = 'blank';
  row.written_overtime = null;
  row.written_overtime_status = 'blank';
}

const HEADER_FILL_KEYS = [
  'employee_name',
  'route_number',
  'date_on_card',
  'contract_hours',
  'contract_am_hours',
  'contract_midday_hours',
  'contract_pm_hours',
  'default_pay_status',
];

/**
 * Clock rows from every photographed side, including overflow cards.
 * @param {object | null | undefined} extraction
 * @returns {object[][]}
 */
export function extractionRowLists(extraction) {
  const lists = [];
  if (Array.isArray(extraction?.front_rows)) lists.push(extraction.front_rows);
  if (Array.isArray(extraction?.back_rows)) lists.push(extraction.back_rows);
  const extras = Array.isArray(extraction?.extra_sides) ? extraction.extra_sides : [];
  for (const side of extras) {
    if (Array.isArray(side?.rows)) lists.push(side.rows);
  }
  return lists;
}

/**
 * Attach another physical card's sides to a driver already on the desk.
 * The first card keeps its header. Blank sticker fields fill from the new card.
 * Only sides that were actually photographed are appended.
 * @param {object | null | undefined} anchor
 * @param {object | null | undefined} incoming
 * @param {{ front?: boolean, back?: boolean }} [sides]
 */
export function mergeSameDriverExtraction(anchor, incoming, sides = {}) {
  const base = anchor && typeof anchor === 'object' ? anchor : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  const header = { ...(base.header && typeof base.header === 'object' ? base.header : {}) };
  const incomingHeader = next.header && typeof next.header === 'object' ? next.header : {};
  for (const key of HEADER_FILL_KEYS) {
    const current = header[key];
    const blank = current == null || current === '';
    const value = incomingHeader[key];
    if (blank && value != null && value !== '') header[key] = value;
  }
  const extras = (Array.isArray(base.extra_sides) ? base.extra_sides : []).map((side) => ({
    ...side,
    rows: Array.isArray(side?.rows) ? side.rows : [],
  }));
  const nextCard = extras.reduce((max, side) => Math.max(max, Number(side.card) || 1), 1) + 1;
  if (sides.front === true) {
    extras.push({
      id: `extra-${nextCard}-front`,
      card: nextCard,
      side: 'front',
      rows: Array.isArray(next.front_rows) ? next.front_rows : [],
    });
  }
  if (sides.back === true) {
    extras.push({
      id: `extra-${nextCard}-back`,
      card: nextCard,
      side: 'back',
      rows: Array.isArray(next.back_rows) ? next.back_rows : [],
    });
  }
  const caveats = [...(Array.isArray(base.caveats) ? base.caveats : []), ...(Array.isArray(next.caveats) ? next.caveats : [])].filter(
    (line) => String(line || '').trim()
  );
  return {
    ...base,
    header,
    front_rows: Array.isArray(base.front_rows) ? base.front_rows : [],
    back_rows: Array.isArray(base.back_rows) ? base.back_rows : [],
    extra_sides: extras,
    caveats,
    sides_present: base.sides_present || { front: true, back: true },
  };
}

function writeRegOt(row, reg, ot) {
  const regHours = Number.isFinite(Number(reg)) && Number(reg) !== 0 ? roundHours(Number(reg)) : null;
  const otHours = Number.isFinite(Number(ot)) && Number(ot) !== 0 ? roundHours(Number(ot)) : null;
  row.hours_regular = regHours;
  row.hours_overtime = otHours;
  row.written_regular = regHours;
  row.written_regular_status = regHours == null ? 'blank' : 'number';
  row.written_overtime = otHours;
  row.written_overtime_status = otHours == null ? 'blank' : 'number';
}
