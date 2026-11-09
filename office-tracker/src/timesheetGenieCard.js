import { parseAuditHours } from './timesheetAudit.js';
import { FRONT_SLOT_COUNT, BACK_SLOT_COUNT } from './timesheetPrompt.js';
import { inferDefaultYear, rowFromClockStamps } from './timesheetNormalize.js';
import { splitTotHoursIntoRegOt } from './timesheetRegOt.js';
import { snapRoundedForRow } from './timesheetSnap.js';
import { localDateKey } from '../../src/logic/timesheets.js';

const HOUR_FIELD = {
  description:
    'null when the cell is blank, "illegible" when it cannot be read, or the number written. A bullet or 0 is 0. Do not calculate this.',
  anyOf: [{ type: 'null' }, { type: 'number' }, { type: 'string' }],
};

export const GENIE_CARD_SYSTEM = `You read one side of a blue paper timecard and copy what is printed on it.

A slot is one block between bold horizontal lines. Each slot lines up a Clock Record (far right) with the Reg, OT, and Tot. Hrs. cells in that same block.
Count the slots: front has ${FRONT_SLOT_COUNT}, back has ${BACK_SLOT_COUNT}.

For each slot return null when the Clock Record and the hour cells are all empty.
Otherwise return:
- stamps — null when blank, "HANDWRITING" when the clocks are handwritten, "illegible" when struck through or unreadable, or the stamp strings top to bottom exactly as printed, e.g. ["MAR 9 PM 2:00", "MAR 9 PM 5:15"]
- reg — the number written in Reg, or null when blank, or "illegible"
- ot — the number written in OT, or null when blank, or "illegible"
- tot — the number written in Tot. Hrs., or null when blank, or "illegible"

A bullet, dot, or 0 in an hour cell is 0. A blank hour cell is null.
Read only what is written. Never calculate Reg, OT, or Tot. Hrs. from the stamps.
Never guess a digit. If a number or stamp is not clearly legible, use "illegible".
Do not read Description of Work.

On the FRONT photo, also read the sticker at the top of the card.
The driver's name is on that sticker. The route number is the line directly under the driver's name.
The contract hours are the line directly under the route number. Return that line as contract_hours, exactly as printed.
Use null for contract_hours, employee_name, or route_number when that sticker line is not on this photo.
Do not invent the contract hours from the clock stamps or from Reg and OT.
On the BACK photo, contract_hours, employee_name, and route_number are null.
Do not write notes. Return only the tool fields for this one photo.`;

/**
 * @param {'front' | 'back'} side
 * @param {number} slotCount
 */
export function genieCardUserPrefix(side, slotCount) {
  const sticker =
    side === 'front'
      ? `Also set employee_name, route_number, and contract_hours from the sticker at the top.
The route number is the line under the driver's name. The contract hours are the line directly under the route number.
Copy that contract-hours line as printed. Use null if it is not visible. Do not invent it.`
      : 'Set employee_name, route_number, and contract_hours to null. This is the back. The sticker is only on the front.';
  return `This photo is the ${side.toUpperCase()} of the card.
Fill report_genie_card with exactly ${slotCount} slots (bold-line blocks), top to bottom.

Reg is the first hours column, OT the next, Tot. Hrs. the one just left of Clock Record.
Copy those handwritten numbers. Do not invent them from the clock stamps.
A blank cell is null. A bullet or 0 is 0. Use "illegible" instead of a guess.
${sticker}`;
}

/**
 * @param {number} slotCount
 * @param {{ sticker?: boolean }} [options]
 */
export function genieCardTool(slotCount, options = {}) {
  const sticker = options.sticker === true;
  return {
    name: 'report_genie_card',
    description: sticker
      ? `Report exactly ${slotCount} card slots, plus the contract hours on the front sticker.`
      : `Report exactly ${slotCount} card slots, including written Reg, OT, and Tot. Hrs.`,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: sticker
        ? ['slots', 'employee_name', 'route_number', 'contract_hours']
        : ['slots', 'employee_name', 'route_number', 'contract_hours'],
      properties: {
        employee_name: {
          description: 'The driver name on the front sticker. null on the back, or when it is not visible.',
          anyOf: [{ type: 'null' }, { type: 'string' }],
        },
        route_number: {
          description:
            'The route number on the front sticker, the line directly under the driver name. null on the back, or when it is not visible.',
          anyOf: [{ type: 'null' }, { type: 'string' }],
        },
        contract_hours: {
          description:
            'The contract hours printed on the front sticker, the line directly under the route number. Copy the line as printed. null on the back, or when that line is not visible.',
          anyOf: [{ type: 'null' }, { type: 'string' }, { type: 'number' }],
        },
        slots: {
          type: 'array',
          minItems: slotCount,
          maxItems: slotCount,
          description: `${slotCount} slots between bold lines, top to bottom.`,
          items: {
            description: 'null when the whole slot is empty. Otherwise stamps plus the hours written in that slot.',
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['stamps', 'reg', 'ot', 'tot'],
                properties: {
                  stamps: {
                    description: 'null, "HANDWRITING", "illegible", or stamp strings top to bottom.',
                    anyOf: [
                      { type: 'null' },
                      { type: 'string', enum: ['HANDWRITING', 'illegible'] },
                      { type: 'array', items: { type: 'string' } },
                    ],
                  },
                  reg: HOUR_FIELD,
                  ot: HOUR_FIELD,
                  tot: HOUR_FIELD,
                },
              },
            ],
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
 * One number is the day's contract. Two or three numbers are the run hours, added together.
 * @param {unknown} value
 * @returns {{ total: number, am: number | null, midday: number | null, pm: number | null } | null}
 */
export function parseStickerContractHours(value) {
  if (value == null) return null;
  const text = typeof value === 'number' ? String(value) : String(value).trim();
  if (!text || /^null$/i.test(text) || /^illegible$/i.test(text)) return null;
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
    const stamps = Array.isArray(value.stamps) ? value.stamps : value.stamps ?? null;
    return attachWritten(rowFromClockStamps(stamps, rowIndex, year), value);
  }
  return attachWritten(rowFromClockStamps(null, rowIndex, year), null);
}

function padSide(raw, count, year) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (let index = 0; index < count; index += 1) {
    out.push(rowFromGenieSlot(list[index], index + 1, year));
  }
  return out;
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
    date_on_card: textOrNull(source.header?.date_on_card),
    contract_hours: contract?.total ?? null,
    contract_am_hours: contract?.am ?? null,
    contract_midday_hours: contract?.midday ?? null,
    contract_pm_hours: contract?.pm ?? null,
    default_pay_status: null,
  };
  const year = inferDefaultYear(header.date_on_card);
  const frontRaw = source.front ?? source.front_rows;
  const backRaw = source.back ?? source.back_rows;
  return {
    header,
    front_rows: padSide(frontRaw, FRONT_SLOT_COUNT, year),
    back_rows: padSide(backRaw, BACK_SLOT_COUNT, year),
    front_reading_order_note: null,
    caveats: [],
  };
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
 * Fill Reg / OT from clocks + contract hours (Genie does the math).
 * One residual past contract for the date goes on the first clocked row;
 * other same-day rows are cleared. Without contract hours, Reg / OT stay blank.
 * Mutates `hours_regular` / `hours_overtime` and the written_* fields used by the card.
 * @param {object[] | null | undefined} frontRows
 * @param {object[] | null | undefined} backRows
 * @param {unknown} contractHours
 * @param {object} [options]
 */
export function applyContractRegOtRows(frontRows, backRows, contractHours, options = {}) {
  const lists = [frontRows, backRows].map((rows) => (Array.isArray(rows) ? rows : []));
  const year = options.defaultYear ?? inferDefaultYear(null);
  const contract = Number(contractHours);
  const hasContract = Number.isFinite(contract) && contract > 0;

  if (!hasContract) {
    for (const rows of lists) {
      for (const row of rows) {
        if (!row) continue;
        const snapped = snapRoundedForRow(row, options.breaks, year, options.mode);
        if (snapped.totalHours == null) continue;
        clearRegOtWriting(row);
      }
    }
    return;
  }

  const clones = lists.map((rows) =>
    rows.map((row) => ({ ...(row || {}), hours_regular: null, hours_overtime: null }))
  );
  /** @type {string[]} */
  const dayKeys = [];
  for (const rows of clones) {
    for (const row of rows) {
      const snapped = snapRoundedForRow(row, options.breaks, year, options.mode);
      if (snapped.totalHours == null || !snapped.spanStart) continue;
      dayKeys.push(localDateKey(snapped.spanStart));
    }
  }
  const contractedByDay = new Map(dayKeys.map((key) => [key, String(contract)]));
  splitTotHoursIntoRegOt(clones, {
    breaks: options.breaks,
    rules: options.rules,
    holidays: options.holidays,
    defaultYear: year,
    mode: options.mode,
    contractedByDay,
  });

  lists.forEach((rows, listIndex) => {
    rows.forEach((row, index) => {
      if (!row) return;
      const snapped = snapRoundedForRow(row, options.breaks, year, options.mode);
      if (snapped.totalHours == null) return;
      const calc = clones[listIndex][index];
      writeRegOt(row, calc?.hours_regular, calc?.hours_overtime);
    });
  });
}

/**
 * Mark each day whose written Reg + OT sum does not match the residual past
 * contract for that date (Tot. Hrs. minus contract when clocks ran long; zero
 * when at or under). One expected combo per date. Illegible hours leave the
 * day unmarked. Rows with no clock total are left unmarked.
 * Sets `hours_add_up` to true, false, or null.
 * @param {object[] | null | undefined} frontRows
 * @param {object[] | null | undefined} backRows
 * @param {unknown} contractHours
 * @param {object} [options]
 */
export function markContractHourRows(frontRows, backRows, contractHours, options = {}) {
  const lists = [frontRows, backRows].map((rows) => (Array.isArray(rows) ? rows : []));
  for (const rows of lists) {
    for (const row of rows) {
      if (row) row.hours_add_up = null;
    }
  }
  const contract = Number(contractHours);
  if (!Number.isFinite(contract) || contract <= 0) return;

  const year = options.defaultYear ?? inferDefaultYear(null);
  const clones = lists.map((rows) =>
    rows.map((row) => ({ ...(row || {}), hours_regular: null, hours_overtime: null }))
  );
  /** @type {string[]} */
  const dayKeys = [];
  for (const rows of clones) {
    for (const row of rows) {
      const snapped = snapRoundedForRow(row, options.breaks, year, options.mode);
      if (snapped.totalHours == null || !snapped.spanStart) continue;
      dayKeys.push(localDateKey(snapped.spanStart));
    }
  }
  const contractedByDay = new Map(dayKeys.map((key) => [key, String(contract)]));
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
    rows.forEach((row, index) => {
      if (!row) return;
      const snapped = snapRoundedForRow(row, options.breaks, year, options.mode);
      if (snapped.totalHours == null || !snapped.spanStart) return;
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
