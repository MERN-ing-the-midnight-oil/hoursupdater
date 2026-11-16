import { DEFAULT_CONTRACT_SNAP_BREAKS } from '../../src/logic/timeUtils.js';
import { DEFAULT_OVERTIME_RULES } from './overtimeRules.js';
import { inferDefaultYear } from './timesheetNormalize.js';
import { applyContractRegOtRows, normalizeGenieCardExtraction } from './timesheetGenieCard.js';

/**
 * Sample-office Star Trek drivers, plus Miles O'Brien and Guinan so the
 * local carousel has ten people. The office roster itself has the first eight.
 */
const CREW = [
  { name: 'Picard, Jean-Luc', route: 'S1', contract: '5.25 (2, 3.25)', am: ['6:10', '8:40'], pm: ['1:50', '4:30'] },
  { name: 'Riker, William', route: 'S2', contract: '6.00 (2.50, 3.50)', am: ['6:25', '9:10'], pm: ['2:05', '4:45'], review: true },
  { name: 'Data', route: 'S3', contract: '5.50', am: ['6:40', '9:00'], pm: ['2:20', '4:50'] },
  { name: 'La Forge, Geordi', route: 'S4', contract: '7.00 (2.50, 1.25, 3.25)', am: ['6:15', '8:45'], mid: ['11:00', '12:15'], pm: ['2:10', '5:25'] },
  { name: 'Crusher, Beverly', route: 'S5', contract: '5.00 (2.50, 2.50)', am: ['6:00', '8:30'], pm: ['1:40', '4:10'] },
  { name: 'Troi, Deanna', route: 'S6', contract: '5.25 (2.50, 2.75)', am: ['6:30', '9:00'], pm: ['2:00', '4:45'] },
  { name: 'Worf', route: 'S7', contract: '7.25 (2.50, 1.50, 3.25)', am: ['6:05', '8:35'], mid: ['10:40', '12:10'], pm: ['1:55', '5:10'] },
  { name: 'Crusher, Wesley', route: 'S8', contract: '6.50 (2.25, 1.25, 3.00)', am: ['6:50', '9:05'], mid: ['11:15', '12:30'], pm: ['2:25', '5:25'] },
  { name: "O'Brien, Miles", route: '12', contract: '5.75 (2.25, 3.50)', am: ['6:20', '8:35'], pm: ['1:45', '5:15'] },
  { name: 'Guinan', route: '47', contract: '4.75 (2, 2.75)', am: ['6:35', '8:35'], pm: ['2:10', '4:55'] },
];

/**
 * Current period first, then earlier ones.
 * Today is inside Nov 1–15. Earlier periods end Oct 31, Oct 15, and Sep 30.
 */
const PERIODS = [
  { sticker: '11/15/26', month: 'NOV', days: [2, 3, 4, 5] },
  { sticker: '10/31/26', month: 'OCT', days: [26, 27, 28, 29] },
  { sticker: '10/15/26', month: 'OCT', days: [12, 13, 14, 15] },
  { sticker: '9/30/26', month: 'SEP', days: [21, 22, 23, 24] },
];

function stamp(month, day, period, time) {
  return `${month} ${day} ${period} ${time}`;
}

function dayRows(person, period, day, blurIn) {
  const rows = [
    {
      out: stamp(period.month, day, 'AM', person.am[0]),
      in: blurIn ? 'illegible' : stamp(period.month, day, 'AM', person.am[1]),
    },
  ];
  if (person.mid) {
    rows.push({
      out: stamp(period.month, day, 'AM', person.mid[0]),
      in: stamp(period.month, day, 'PM', person.mid[1]),
    });
  }
  rows.push({
    out: stamp(period.month, day, 'PM', person.pm[0]),
    in: stamp(period.month, day, 'PM', person.pm[1]),
  });
  return rows;
}

function readFor(person, period) {
  const rows = period.days.flatMap((day, index) =>
    dayRows(person, period, day, person.review === true && period.sticker === '11/15/26' && index === 0)
  );
  const split = Math.ceil(rows.length / 2);
  return {
    employee_name: person.name,
    route_number: person.route,
    contract_hours: person.contract,
    date_on_card: period.sticker,
    front: rows.slice(0, split),
    back: rows.slice(split),
  };
}

const EXAMPLE_GENIE_READS = PERIODS.flatMap((period) => CREW.map((person) => readFor(person, period)));

/**
 * @param {string | null | undefined} hostname
 */
export function isLocalGenieHost(hostname) {
  const host = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Fresh copies of the local example reads, with Reg/OT filled the same way a live read is.
 */
export function localExampleGenieExtractions() {
  return EXAMPLE_GENIE_READS.map((card) => {
    const extraction = normalizeGenieCardExtraction(card);
    applyContractRegOtRows(
      extraction.front_rows,
      extraction.back_rows,
      extraction.header?.contract_hours,
      {
        breaks: DEFAULT_CONTRACT_SNAP_BREAKS,
        rules: DEFAULT_OVERTIME_RULES,
        defaultYear: inferDefaultYear(extraction.header?.date_on_card),
        contractRuns: extraction.header,
      }
    );
    return extraction;
  });
}
