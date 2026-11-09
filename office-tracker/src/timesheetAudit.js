import { localDateKey } from '../../src/logic/timesheets.js';
import { parseCardPeriodEnd } from './auditPayPeriods.js';
import { parseStickerContractHours } from './timesheetGenieCard.js';
import { BACK_SLOT_COUNT, FRONT_SLOT_COUNT } from './timesheetPrompt.js';
import { inferDefaultYear, rowFromClockStamps } from './timesheetNormalize.js';
import { splitTotHoursIntoRegOt } from './timesheetRegOt.js';
import { snapRoundedForRow } from './timesheetSnap.js';
import { regOtGapHours } from './summaryMath.js';

const HOUR_FIELD = {
  description: 'null when the cell is blank, "illegible" when it cannot be read, or the number written. A bullet or 0 is 0. Do not calculate this.',
  anyOf: [{ type: 'null' }, { type: 'number' }, { type: 'string' }],
};

/**
 * Read Clock Record stamps and the Reg / OT / Tot. Hrs. already written in that slot.
 * The front also reports the pay-period date on the top sticker.
 * @param {number} slotCount
 * @param {{ periodEnd?: boolean }} [options]
 */
export function auditSlotTool(slotCount, options = {}) {
  const periodEnd = options.periodEnd === true;
  return {
    name: 'report_audit_slots',
    description: periodEnd
      ? `Report exactly ${slotCount} card slots, plus the pay-period ending date from the front sticker (and contract hours when that line is printed).`
      : `Report exactly ${slotCount} card slots, including written Reg, OT, and Tot. Hrs. No other fields.`,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      // period_end is required on the front. contract_hours is optional — many stickers omit it.
      required: periodEnd ? ['slots', 'period_end'] : ['slots'],
      properties: {
        ...(periodEnd
          ? {
              period_end: {
                description:
                  'REQUIRED. On the front sticker (top of the card): find the driver name in "Last, First" format in the upper left of the sticker rectangle. To the RIGHT of that name is the pay period ending date as MM/DD/YY or M/DD/YY (for example "10/15/26" or "3/15/26"). Copy that date exactly. It is always on the sticker. Use null only when the sticker itself is cropped out of the photo.',
                anyOf: [{ type: 'null' }, { type: 'string' }],
              },
              contract_hours: {
                description:
                  'OPTIONAL. On the front sticker, directly under the last name is the exact text "Route #", then the route number. Contract hours may appear on the line under that. Copy as printed (one number, or AM / midday / PM figures). Many stickers omit contract hours — return null when missing, blank, or unreadable. Never invent hours from the clocks or from Reg / OT.',
                anyOf: [{ type: 'null' }, { type: 'string' }, { type: 'number' }],
              },
            }
          : {}),
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

export const AUDIT_SYSTEM = `You read one side of a blue paper timecard that already has hours written on it.

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
On the FRONT photo, also read the printed sticker at the top of the card.
Where the sticker is: a rectangle at the top of the front side. It is about half the width of the card, and about half as tall as it is wide.
Sticker layout:
1. Upper left of the rectangle: the driver name in "Last, First" format.
2. To the RIGHT of that "Last, First" name: a date in MM/DD/YY or M/DD/YY format (for example "10/15/26" or "3/15/26"). THAT date is the pay period ending (last day of the pay period). It is always on the sticker. You MUST return it as period_end, copied exactly as shown. Use null only when the sticker is cropped out of this photo. Do not invent the date from the clock stamps, and do not use any other date on the card.
3. Just below the last name: the exact printed text "Route #", then the route number.
4. Contract hours may appear on the line under the route line. When printed, return it as contract_hours exactly as shown (one number, or AM / midday / PM figures). When the sticker has no contract-hours line, leave contract_hours null. Do not invent contract hours from the clock stamps or from Reg and OT.
On the BACK photo, do not return sticker fields. The sticker is only on the front.
Do not write notes. Return only the tool fields for this one photo.`;

/**
 * @param {'front' | 'back'} side
 * @param {number} slotCount
 */
export function auditUserPrefix(side, slotCount) {
  const periodLine =
    side === 'front'
      ? `Also read the sticker at the top of the front. It is a rectangle about half the card width and about half as tall as it is wide. period_end is required: in the upper left is the name "Last, First"; to the RIGHT of that name is the pay period ending date as MM/DD/YY or M/DD/YY — copy that date exactly. Just below the last name is the text "Route #". contract_hours is optional: copy the line under the route line when printed; return null when that line is missing.`
      : 'This is the back. Report only the slots. Do not invent a sticker date or contract hours.';
  return `This photo is the ${side.toUpperCase()} of the card.
Fill report_audit_slots with exactly ${slotCount} slots (bold-line blocks), top to bottom.

Reg is the first hours column, OT the next, Tot. Hrs. the one just left of Clock Record.
Copy those handwritten numbers. Do not invent them from the clock stamps.
A blank cell is null. A bullet or 0 is 0. Use "illegible" instead of a guess.
${periodLine}`;
}

/**
 * A handwritten hour cell.
 * @param {unknown} value
 * @returns {{ status: 'blank' | 'number' | 'illegible', hours: number | null }}
 */
export function parseAuditHours(value) {
  if (value == null) return { status: 'blank', hours: null };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { status: 'illegible', hours: null };
    return { status: 'number', hours: value };
  }
  const text = String(value).trim();
  if (!text || text.toLowerCase() === 'null' || text === '-' || text === '—' || text === '–') {
    return { status: 'blank', hours: null };
  }
  if (/^illegible$/i.test(text)) return { status: 'illegible', hours: null };
  if (text === '•' || text === '\u2022' || text === '·' || text === '.') {
    return { status: 'number', hours: 0 };
  }
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (mixed) {
    const den = Number(mixed[3]);
    if (den) return { status: 'number', hours: Number(mixed[1]) + Number(mixed[2]) / den };
  }
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (fraction) {
    const den = Number(fraction[2]);
    if (den) return { status: 'number', hours: Number(fraction[1]) / den };
  }
  const number = Number(text.replace(',', '.'));
  if (Number.isFinite(number)) return { status: 'number', hours: number };
  return { status: 'illegible', hours: null };
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
  return row;
}

/**
 * @param {unknown} slot
 * @param {number} rowIndex
 * @param {number} defaultYear
 */
export function rowFromAuditSlot(slot, rowIndex, defaultYear) {
  if (slot == null) return attachWritten(rowFromClockStamps([], rowIndex, defaultYear), null);
  if (typeof slot === 'string' || Array.isArray(slot)) {
    return attachWritten(rowFromClockStamps(Array.isArray(slot) ? slot : [slot], rowIndex, defaultYear), null);
  }
  if (typeof slot !== 'object') return attachWritten(rowFromClockStamps([], rowIndex, defaultYear), null);
  const stamps = slot.stamps;
  const row = rowFromClockStamps(
    stamps == null ? [] : Array.isArray(stamps) ? stamps : [stamps],
    rowIndex,
    defaultYear
  );
  return attachWritten(row, slot);
}

function padAuditSide(rawSlots, count, year) {
  const list = Array.isArray(rawSlots) ? rawSlots : [];
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    rows.push(rowFromAuditSlot(list[index], index + 1, year));
  }
  return rows;
}

/**
 * Turn audit-tool slots into card rows. Written Reg / OT / Tot. Hrs. are kept.
 * Missing photos become blank slots.
 * @param {unknown} parsed
 */
export function normalizeAuditExtraction(parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const periodEnd = parseCardPeriodEnd(
    source.period_end ?? source.periodEnd ?? source.header?.period_end ?? source.header?.periodEnd
  );
  const contract = parseStickerContractHours(
    source.contract_hours ?? source.contractHours ?? source.header?.contract_hours ?? source.header?.contractHours
  );
  const year = periodEnd ? Number(periodEnd.slice(0, 4)) : inferDefaultYear(null);
  const frontRaw = source.front ?? source.front_rows;
  const backRaw = source.back ?? source.back_rows;
  return {
    header: {
      period_end: periodEnd,
      contract_hours: contract?.total ?? null,
    },
    front_rows: padAuditSide(frontRaw, FRONT_SLOT_COUNT, year),
    back_rows: padAuditSide(backRaw, BACK_SLOT_COUNT, year),
  };
}

function roundHours(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100) / 100;
}

function closeHours(left, right) {
  const a = roundHours(left);
  const b = roundHours(right);
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= 0.01;
}

/**
 * Hours text for an audit note. Whole hours stay whole; fractions keep two decimals.
 * @param {unknown} value
 */
export function formatAuditHours(value) {
  const number = roundHours(value);
  if (number == null || Math.abs(number) <= 0.001) return '0';
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(2);
}

function writtenOf(row, field) {
  const statusKey = field === 'reg' ? 'written_regular_status' : field === 'ot' ? 'written_overtime_status' : 'written_total_status';
  const hoursKey = field === 'reg' ? 'written_regular' : field === 'ot' ? 'written_overtime' : 'written_total';
  const status = row?.[statusKey];
  if (status === 'blank' || status === 'number' || status === 'illegible') {
    return { status, hours: status === 'number' ? roundHours(row[hoursKey]) : null };
  }
  return parseAuditHours(row?.[hoursKey]);
}

function writtenPresent(row) {
  return ['reg', 'ot', 'tot'].some((field) => {
    const written = writtenOf(row, field);
    return written.status === 'number' || written.status === 'illegible';
  });
}

function clockProblem(row, totHours) {
  if (totHours != null) return '';
  const out = String(row?.clock_out_raw ?? '').trim();
  const inn = String(row?.clock_in_raw ?? '').trim();
  const blob = `${out} ${inn}`.toLowerCase();
  if (/\billegible\b/.test(blob)) return 'illegible';
  if (blob.includes('handwriting')) return 'handwriting';
  if (!out && !inn) return 'missing';
  return 'unreadable';
}

function uncheckedMessage(problem) {
  if (problem === 'illegible') {
    return 'Clock stamps are illegible, so the written hours cannot be checked.';
  }
  if (problem === 'handwriting') {
    return 'Clock stamps are handwritten, so the written hours cannot be checked.';
  }
  if (problem === 'missing') {
    return 'Clock stamps are missing, so the written hours cannot be checked.';
  }
  return 'Those clock stamps could not be turned into hours, so the written hours cannot be checked.';
}

function fieldLabel(field) {
  if (field === 'reg') return 'Reg';
  if (field === 'ot') return 'OT';
  return 'Tot. Hrs.';
}

/**
 * @param {object} row
 * @param {object} calc
 * @param {'front' | 'back'} side
 * @param {object} options
 */
function differsFromHandwriting(written, expected) {
  if (expected == null) return false;
  if (written.status === 'illegible') return true;
  const handwritten = written.status === 'number' ? written.hours : 0;
  return !closeHours(handwritten, expected);
}

function issueSeverity(issues) {
  if (issues.some((issue) => issue.severity === 'mistake')) return 'mistake';
  if (issues.length) return 'unchecked';
  return 'ok';
}

function pushHoursIssue(issues, field, written, expected) {
  // Illegible handwriting is not compared — the card just shows the calculated value.
  if (written.status === 'illegible') return;
  if (!differsFromHandwriting(written, expected)) return;
  const handwritten = written.status === 'blank' ? 'blank' : formatAuditHours(written.hours);
  issues.push({
    severity: 'mistake',
    field,
    message: `${fieldLabel(field)} is ${handwritten}; calculated ${formatAuditHours(expected)}.`,
  });
}

function dayWrittenField(rows, statusKey, hoursKey) {
  let illegible = false;
  let hours = 0;
  let numbered = false;
  for (const row of rows) {
    const status = row?.[statusKey];
    if (status === 'illegible') {
      illegible = true;
      continue;
    }
    if (status === 'number') {
      numbered = true;
      hours += Number(row?.[hoursKey]) || 0;
    }
  }
  if (illegible) return { status: 'illegible', hours: null };
  if (!numbered) return { status: 'blank', hours: null };
  return { status: 'number', hours: roundHours(hours) ?? 0 };
}

function finiteHours(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * Office practice: one Reg / OT total for the whole date. Tot. Hrs. can still
 * have one handwritten value per Clock Record combo. Fold Reg / OT expectations
 * onto a single row for that date and compare the day's handwriting once.
 *
 * Reg / OT is only the residual past contract: Tot. Hrs. minus contract hours when
 * the clocks ran long. When Tot. Hrs. is at or under contract, expected Reg and OT
 * are zero — the old "fill up to contract" shortfall is not written in Reg / OT.
 *
 * @param {ReturnType<typeof judgeRow>[]} judged
 * @param {unknown} contractHours
 */
function foldDayRegOt(judged, contractHours) {
  /** @type {Map<string, typeof judged>} */
  const byDay = new Map();
  for (const row of judged) {
    if (!row.dateKey) continue;
    const list = byDay.get(row.dateKey) || [];
    list.push(row);
    byDay.set(row.dateKey, list);
  }

  for (const rows of byDay.values()) {
    const withExpected = rows.filter((row) => row.expectedReg != null || row.expectedOt != null);
    if (!withExpected.length) continue;

    const regSum = roundHours(withExpected.reduce((sum, row) => sum + finiteHours(row.expectedReg), 0)) ?? 0;
    const otSum = roundHours(withExpected.reduce((sum, row) => sum + finiteHours(row.expectedOt), 0)) ?? 0;
    const dayTot =
      roundHours(rows.reduce((sum, row) => sum + finiteHours(row.totHours), 0)) ?? 0;
    // contract - tot: positive when under contract, negative when clocks ran long.
    const gap = regOtGapHours(contractHours, dayTot);

    let dayExpectedReg = regSum;
    let dayExpectedOt = otSum;
    if (gap != null) {
      if (gap >= 0) {
        // At or under contract — nothing belongs in Reg / OT for the residual check.
        dayExpectedReg = 0;
        dayExpectedOt = 0;
      } else {
        // Beyond contract — residual is Tot. Hrs. minus contract.
        const residual = roundHours(-gap) ?? 0;
        const parts = Math.abs(regSum) + Math.abs(otSum);
        if (parts < 0.001) {
          dayExpectedReg = residual;
          dayExpectedOt = 0;
        } else {
          const regRatio = Math.abs(regSum) / parts;
          dayExpectedReg = roundHours(residual * regRatio) ?? 0;
          dayExpectedOt = roundHours(residual - dayExpectedReg) ?? 0;
        }
      }
    }

    const dayWrittenReg = dayWrittenField(rows, 'writtenRegStatus', 'writtenReg');
    const dayWrittenOt = dayWrittenField(rows, 'writtenOtStatus', 'writtenOt');
    const anchor =
      rows.find(
        (row) =>
          row.writtenRegStatus === 'number' ||
          row.writtenRegStatus === 'illegible' ||
          row.writtenOtStatus === 'number' ||
          row.writtenOtStatus === 'illegible'
      ) || withExpected[0];

    for (const row of rows) {
      row.issues = row.issues.filter((issue) => issue.field !== 'reg' && issue.field !== 'ot');
      if (row === anchor) {
        row.expectedReg = dayExpectedReg;
        row.expectedOt = dayExpectedOt;
        pushHoursIssue(row.issues, 'reg', dayWrittenReg, dayExpectedReg);
        pushHoursIssue(row.issues, 'ot', dayWrittenOt, dayExpectedOt);
      } else {
        row.expectedReg = null;
        row.expectedOt = null;
      }
      row.severity = issueSeverity(row.issues);
    }
  }
}

function judgeRow(row, calc, side, options) {
  const snapped = snapRoundedForRow(row, options.breaks, options.defaultYear, options.mode);
  const totHours = snapped.totalHours;
  const writtenReg = writtenOf(row, 'reg');
  const writtenOt = writtenOf(row, 'ot');
  const writtenTot = writtenOf(row, 'tot');
  const problem = clockProblem(row, totHours);
  const expectedTot = problem ? null : totHours;
  // Per-row Reg / OT are temporary. foldDayRegOt keeps one day total on one row.
  const expectedReg = !problem && options.useContract ? roundHours(calc?.hours_regular) ?? 0 : null;
  const expectedOt = !problem && options.useContract ? roundHours(calc?.hours_overtime) ?? 0 : null;
  /** @type {{ severity: 'mistake' | 'unchecked', field: string, message: string }[]} */
  const issues = [];

  if (!problem) {
    // Reg / OT mistakes are added after the day fold. Tot. Hrs. stays per combo.
    pushHoursIssue(issues, 'tot', writtenTot, expectedTot);
  } else if (writtenPresent(row)) {
    issues.push({ severity: 'unchecked', field: 'clocks', message: uncheckedMessage(problem) });
  }

  const show = totHours != null || writtenPresent(row);

  return {
    show,
    side,
    rowIndex: Number(row?.row_index) || 0,
    dateKey: snapped.spanStart ? localDateKey(snapped.spanStart) : '',
    clockOut: String(row?.clock_out_raw ?? '').trim(),
    clockIn: String(row?.clock_in_raw ?? '').trim(),
    totHours: expectedTot,
    writtenReg: writtenReg.hours,
    writtenRegStatus: writtenReg.status,
    writtenOt: writtenOt.hours,
    writtenOtStatus: writtenOt.status,
    writtenTot: writtenTot.hours,
    writtenTotStatus: writtenTot.status,
    expectedReg,
    expectedOt,
    issues,
    severity: issueSeverity(issues),
  };
}

function contractDays(rows, contractHours, options, year) {
  const contract = Number(contractHours);
  if (!Number.isFinite(contract) || contract <= 0) return null;
  const days = new Map();
  for (const row of rows) {
    const snapped = snapRoundedForRow(row, options.breaks, year, options.mode);
    if (snapped.totalHours == null || !snapped.spanStart) continue;
    days.set(localDateKey(snapped.spanStart), String(contract));
  }
  return days.size ? days : null;
}

/**
 * Compare the handwriting on a blue card with the hours the clocks and contract produce.
 * Tot. Hrs. is checked per Clock Record combo (snap-rounded or quarter-hour rounded).
 * Reg + OT is one residual for the date when Tot. Hrs. runs past the contract hours
 * (Tot minus contract), split by the same overtime mix as the clocked day. When Tot is
 * at or under contract, expected Reg and OT are zero. The red Reg / OT figure is shown
 * on one row for that date — the row that has the handwriting, or the first clocked row.
 * Without contract hours, Reg and OT are not calculated.
 *
 * Blank handwriting counts as zero.
 *
 * @param {object | null | undefined} extraction
 * @param {{
 *   breaks?: object | null,
 *   rules?: object | null,
 *   holidays?: { date: string, label?: string }[] | null,
 *   defaultYear?: number | null,
 *   mode?: string | null,
 * }} [options]
 */
export function auditWrittenHours(extraction, options = {}) {
  const year = options.defaultYear ?? inferDefaultYear(null);
  const front = Array.isArray(extraction?.front_rows) ? extraction.front_rows : [];
  const back = Array.isArray(extraction?.back_rows) ? extraction.back_rows : [];
  const frontCalc = front.map((row) => ({ ...row, hours_regular: null, hours_overtime: null }));
  const backCalc = back.map((row) => ({ ...row, hours_regular: null, hours_overtime: null }));
  const contractedByDay = contractDays([...front, ...back], extraction?.header?.contract_hours, options, year);
  // Clock-based Reg/OT only here. foldDayRegOt applies the over-contract residual.
  splitTotHoursIntoRegOt([frontCalc, backCalc], {
    breaks: options.breaks,
    rules: options.rules,
    holidays: options.holidays,
    defaultYear: year,
    mode: options.mode,
    contractedByDay: null,
  });
  const judgeOptions = { ...options, defaultYear: year, useContract: contractedByDay != null };
  const judged = [
    ...front.map((row, index) => judgeRow(row, frontCalc[index], 'front', judgeOptions)),
    ...back.map((row, index) => judgeRow(row, backCalc[index], 'back', judgeOptions)),
  ].filter((row) => row.show);
  foldDayRegOt(judged, extraction?.header?.contract_hours);
  return {
    front: judged.filter((row) => row.side === 'front'),
    back: judged.filter((row) => row.side === 'back'),
    mistakeCount: judged.filter((row) => row.severity === 'mistake').length,
    uncheckedCount: judged.filter((row) => row.severity === 'unchecked').length,
  };
}
