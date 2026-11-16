import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_OVERTIME_RULES } from '../office-tracker/src/overtimeRules.js';
import {
  applyContractRegOtRows,
  applyRunExtraTotals,
  GENIE_CARD_SYSTEM,
  genieCardTool,
  genieCardUserPrefix,
  markContractHourRows,
  mergeSameDriverExtraction,
  normalizeGenieCardExtraction,
  parseStickerContractHours,
} from '../office-tracker/src/timesheetGenieCard.js';
import { DEFAULT_CONTRACT_SNAP_BREAKS } from '../src/logic/timeUtils.js';

const options = {
  breaks: DEFAULT_CONTRACT_SNAP_BREAKS,
  rules: { ...DEFAULT_OVERTIME_RULES },
  defaultYear: 2026,
};

function row(index, out, inn, written = {}) {
  return {
    row_index: index,
    clock_out_raw: out,
    clock_in_raw: inn,
    written_regular: written.reg ?? null,
    written_regular_status: written.regStatus || (written.reg == null ? 'blank' : 'number'),
    written_overtime: written.ot ?? null,
    written_overtime_status: written.otStatus || (written.ot == null ? 'blank' : 'number'),
    crossed_out: false,
  };
}

describe('sticker contract hours', () => {
  it('reads one number under the route number', () => {
    assert.deepEqual(parseStickerContractHours('6.50'), {
      total: 6.5,
      am: null,
      midday: null,
      pm: null,
    });
  });

  it('adds the AM, midday, and PM figures on that line', () => {
    assert.deepEqual(parseStickerContractHours('2.25  1.50  2.75'), {
      total: 6.5,
      am: 2.25,
      midday: 1.5,
      pm: 2.75,
    });
  });

  it('keeps total outside parentheses and splits the AM/PM breakdown', () => {
    assert.deepEqual(parseStickerContractHours('5.25 (2, 3.25)'), {
      total: 5.25,
      am: 2,
      midday: null,
      pm: 3.25,
    });
  });

  it('reads two parenthesis values as AM and PM with no midday', () => {
    assert.deepEqual(parseStickerContractHours('4.25 (2,2.5)'), {
      total: 4.25,
      am: 2,
      midday: null,
      pm: 2.5,
    });
  });

  it('reads three parenthesis values as AM, midday, and PM', () => {
    assert.deepEqual(parseStickerContractHours('6.50 (2.25, 1.50, 2.75)'), {
      total: 6.5,
      am: 2.25,
      midday: 1.5,
      pm: 2.75,
    });
  });

  it('does not invent hours from an empty or illegible line', () => {
    assert.equal(parseStickerContractHours(null), null);
    assert.equal(parseStickerContractHours('illegible'), null);
    assert.equal(parseStickerContractHours(''), null);
  });
});

describe('genie card copy', () => {
  it('asks for ordered Out/In pairs and does not name a line count', () => {
    assert.match(GENIE_CARD_SYSTEM, /sky-blue/i);
    assert.match(GENIE_CARD_SYSTEM, /sideways/i);
    assert.match(GENIE_CARD_SYSTEM, /OUT or IN/i);
    assert.match(GENIE_CARD_SYSTEM, /left of the "Tot\. Hrs\." column/i);
    assert.match(GENIE_CARD_SYSTEM, /left of the "Total" column/i);
    assert.equal(
      genieCardUserPrefix('front'),
      'This photo is the FRONT. List each clock time on its own, from the top of the photo downward. Do not combine an Out line and an In line.'
    );
    assert.equal(
      genieCardUserPrefix('back'),
      'This photo is the BACK. List each clock time on its own, from the top of the photo downward. Do not combine an Out line and an In line.'
    );
    assert.match(GENIE_CARD_SYSTEM, /one clock time on one printed line/i);
    assert.match(GENIE_CARD_SYSTEM, /Do not combine an Out line and an In line/i);
    assert.doesNotMatch(GENIE_CARD_SYSTEM, /Ignore every other column/i);
    assert.match(GENIE_CARD_SYSTEM, /no set number of lines/i);
    assert.match(GENIE_CARD_SYSTEM, /side — "out" or "in"/i);
    assert.doesNotMatch(GENIE_CARD_SYSTEM, /one pair/i);
    assert.doesNotMatch(GENIE_CARD_SYSTEM, /exactly \d+/i);
    assert.doesNotMatch(GENIE_CARD_SYSTEM, /\b26\b/);
    assert.doesNotMatch(GENIE_CARD_SYSTEM, /\b30\b/);
    assert.match(GENIE_CARD_SYSTEM, /blank bottom margin/i);
    assert.match(GENIE_CARD_SYSTEM, /white sticker/i);
    assert.match(GENIE_CARD_SYSTEM, /5\.25 \(2, 3\.25\)/);
    assert.match(GENIE_CARD_SYSTEM, /date_on_card/);
    assert.match(GENIE_CARD_SYSTEM, /set those sticker fields to null/i);
    assert.match(GENIE_CARD_SYSTEM, /Other sides and other cards are sent separately/i);
    const tool = genieCardTool({ sticker: true });
    assert.equal(tool.input_schema.properties.slots.minItems, undefined);
    assert.equal(tool.input_schema.properties.slots.maxItems, undefined);
    assert.deepEqual(tool.input_schema.properties.slots.items.required, ['side', 'stamp']);
  });

  it('prints each AI clock line in arrival order without pairing or sorting', () => {
    assert.match(GENIE_CARD_SYSTEM, /top to bottom/i);
    assert.match(GENIE_CARD_SYSTEM, /nearest the top of the photo/i);
    assert.match(GENIE_CARD_SYSTEM, /do not sort lines by date or time/i);
    const lines = normalizeGenieCardExtraction({
      front: [
        { side: 'in', stamp: 'NOV 6 PM 4:00' },
        { side: 'out', stamp: 'NOV 6 PM 1:00' },
        { side: 'in', stamp: 'NOV 5 AM 8:00' },
        { side: 'out', stamp: 'NOV 4 AM 6:00' },
      ],
    });
    assert.equal(lines.front_rows.length, 4);
    assert.equal(lines.front_rows[0].clock_in_raw, 'NOV 6 PM 4:00');
    assert.equal(lines.front_rows[0].clock_out_raw, null);
    assert.equal(lines.front_rows[1].clock_out_raw, 'NOV 6 PM 1:00');
    assert.equal(lines.front_rows[1].clock_in_raw, null);
    assert.equal(lines.front_rows[2].clock_in_raw, 'NOV 5 AM 8:00');
    assert.equal(lines.front_rows[2].clock_out_raw, null);
    assert.equal(lines.front_rows[3].clock_out_raw, 'NOV 4 AM 6:00');
    assert.equal(lines.front_rows[3].clock_in_raw, null);
  });

  it('does not reorder lines by when the punches were made', () => {
    const earlierFirst = normalizeGenieCardExtraction({
      front: [
        { side: 'out', stamp: 'NOV 4 AM 6:00' },
        { side: 'in', stamp: 'NOV 4 AM 8:00' },
        { side: 'out', stamp: 'NOV 6 PM 1:00' },
        { side: 'in', stamp: 'NOV 6 PM 4:00' },
      ],
    });
    assert.equal(earlierFirst.front_rows[0].clock_out_raw, 'NOV 4 AM 6:00');
    assert.equal(earlierFirst.front_rows[1].clock_in_raw, 'NOV 4 AM 8:00');
    assert.equal(earlierFirst.front_rows[2].clock_out_raw, 'NOV 6 PM 1:00');
    assert.equal(earlierFirst.front_rows[3].clock_in_raw, 'NOV 6 PM 4:00');
  });

  it('keeps labeled Out/In pairs in order without padding or truncating', () => {
    const pairs = [
      { out: 'NOV 4 AM 6:00', in: 'NOV 4 AM 8:00' },
      { out: 'NOV 4 PM 1:00', in: null },
      { out: null, in: null },
      { out: 'illegible', in: 'NOV 4 PM 5:00' },
    ];
    for (let index = 0; index < 14; index += 1) {
      pairs.push({ out: `NOV ${5 + index} AM 6:00`, in: `NOV ${5 + index} AM 8:00` });
    }
    const extraction = normalizeGenieCardExtraction({
      employee_name: 'Ada Driver',
      route_number: '79',
      contract_hours: '5.25 (2, 3.25)',
      date_on_card: '11/15/26',
      front: pairs,
    });
    assert.equal(extraction.front_rows.length, 17);
    assert.equal(extraction.back_rows.length, 0);
    assert.equal(extraction.header.employee_name, 'Ada Driver');
    assert.equal(extraction.header.route_number, '79');
    assert.equal(extraction.header.contract_hours, 5.25);
    assert.equal(extraction.header.contract_am_hours, 2);
    assert.equal(extraction.header.contract_pm_hours, 3.25);
    assert.equal(extraction.header.date_on_card, '11/15/26');
    assert.equal(extraction.front_rows[0].clock_out_raw, 'NOV 4 AM 6:00');
    assert.equal(extraction.front_rows[0].clock_in_raw, 'NOV 4 AM 8:00');
    assert.equal(extraction.front_rows[1].clock_out_raw, 'NOV 4 PM 1:00');
    assert.equal(extraction.front_rows[1].clock_in_raw, null);
    assert.equal(extraction.front_rows[2].clock_out_raw, 'illegible');
    assert.equal(extraction.front_rows[2].clock_in_raw, 'NOV 4 PM 5:00');
    assert.equal(extraction.front_rows[16].clock_out_raw, 'NOV 18 AM 6:00');
  });
});

describe('hours that do not add up', () => {
  it('leaves a row clear when Reg and OT are blank under the contract', () => {
    const front = [row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', {})];
    markContractHourRows(front, [], 6.5, options);
    assert.equal(front[0].hours_add_up, true);
  });

  it('marks a row when Reg is written while Tot is still under the contract', () => {
    const front = [row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { reg: 4.5, ot: 0 })];
    markContractHourRows(front, [], 6.5, options);
    assert.equal(front[0].hours_add_up, false);
  });

  it('leaves a day clear when Reg and OT match the residual on one row', () => {
    // 3h AM + 4h PM = 7 Tot vs 5.25 contract → 1.75 residual on the day.
    const front = [
      row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 9:00', { reg: 1.75, ot: 0 }),
      row(2, 'NOV 4 PM 1:00', 'NOV 4 PM 5:00', {}),
    ];
    markContractHourRows(front, [], 5.25, options);
    assert.equal(front[0].hours_add_up, true);
    assert.equal(front[1].hours_add_up, true);
  });

  it('accepts split handwriting when the day sum still matches the residual', () => {
    const split = [
      row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 9:00', { reg: 0.75, ot: 0 }),
      row(2, 'NOV 4 PM 1:00', 'NOV 4 PM 5:00', { reg: 1, ot: 0 }),
    ];
    markContractHourRows(split, [], 5.25, options);
    assert.equal(split[0].hours_add_up, true);
    assert.equal(split[1].hours_add_up, true);
  });

  it('marks the day when written Reg / OT do not match the residual', () => {
    const front = [
      row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 9:00', { reg: 0.5, ot: 0 }),
      row(2, 'NOV 4 PM 1:00', 'NOV 4 PM 5:00', {}),
    ];
    markContractHourRows(front, [], 5.25, options);
    assert.equal(front[0].hours_add_up, false);
    assert.equal(front[1].hours_add_up, true);
  });

  it('does not mark an illegible hour or a card with no contract hours', () => {
    const illegible = [row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { regStatus: 'illegible', ot: 0 })];
    markContractHourRows(illegible, [], 6.5, options);
    assert.equal(illegible[0].hours_add_up, null);
    const missing = [row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { reg: 2, ot: 0 })];
    markContractHourRows(missing, [], null, options);
    assert.equal(missing[0].hours_add_up, null);
  });
});

describe('Genie fills Reg / OT from the contract', () => {
  it('clears Reg and OT when Tot is under the contract', () => {
    const front = [row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { reg: 4.5, ot: 0 })];
    applyContractRegOtRows(front, [], 6.5, options);
    assert.equal(front[0].hours_regular, null);
    assert.equal(front[0].hours_overtime, null);
    assert.equal(front[0].written_regular_status, 'blank');
  });

  it('puts the day residual on the first clocked row only', () => {
    const front = [
      row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 9:00', {}),
      row(2, 'NOV 4 PM 1:00', 'NOV 4 PM 5:00', {}),
    ];
    applyContractRegOtRows(front, [], 5.25, options);
    assert.equal((front[0].hours_regular || 0) + (front[0].hours_overtime || 0), 1.75);
    assert.equal(front[1].hours_regular, null);
    assert.equal(front[1].hours_overtime, null);
    assert.equal(front[1].written_regular_status, 'blank');
  });

  it('splits Tot into Reg and OT when contract hours are missing', () => {
    const front = [row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { reg: 2, ot: 0 })];
    applyContractRegOtRows(front, [], null, options);
    assert.equal(front[0].hours_regular, 2);
    assert.equal(front[0].hours_overtime, null);
    assert.equal(front[0].written_regular_status, 'number');
    assert.equal(front[0].written_regular, 2);
  });

  it('counts an extra card side when splitting the day', () => {
    const front = [row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 9:00', {})];
    const extra = [row(1, 'NOV 4 PM 1:00', 'NOV 4 PM 5:00', {})];
    applyContractRegOtRows(front, [], 5.25, { ...options, moreRows: [extra] });
    assert.equal((front[0].hours_regular || 0) + (front[0].hours_overtime || 0), 1.75);
    assert.equal(extra[0].hours_regular, null);
    assert.equal(extra[0].hours_overtime, null);
  });

  it('sets Tot. Hrs. to each run’s extra past its own contract', () => {
    // "4.25 (2, 2.5)": 3h AM past 2 is 1, 3h PM past 2.5 is 0.5, total 1.5.
    // The daily total 4.25 is not the subtractand (that would be 6 − 4.25 = 1.75).
    const front = [
      row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 9:00', {}),
      row(2, 'NOV 4 PM 1:00', 'NOV 4 PM 4:00', {}),
    ];
    const runs = { ...options, contractRuns: { am: 2, pm: 2.5 } };
    applyContractRegOtRows(front, [], 4.25, runs);
    assert.equal(front[0].total_hours, 1);
    assert.equal(front[1].total_hours, 0.5);
    assert.equal((front[0].total_hours || 0) + (front[1].total_hours || 0), 1.5);
    assert.equal((front[0].hours_regular || 0) + (front[0].hours_overtime || 0), 1.5);
    assert.equal(front[1].hours_regular, null);
    assert.equal(front[1].hours_overtime, null);

    front[0].written_regular = 1.5;
    front[0].written_regular_status = 'number';
    front[0].written_overtime = 0;
    front[0].written_overtime_status = 'number';
    markContractHourRows(front, [], 4.25, runs);
    assert.equal(front[0].hours_add_up, true);
    assert.equal(front[1].hours_add_up, true);
  });

  it('does not let a short run reduce the extra from another run', () => {
    const front = [
      row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 7:00', {}),
      row(2, 'NOV 4 PM 1:00', 'NOV 4 PM 4:00', {}),
    ];
    const runs = { am: 2, pm: 2.5 };
    applyContractRegOtRows(front, [], 4.25, { ...options, contractRuns: runs });
    assert.equal(front[0].total_hours, null);
    assert.equal(front[1].total_hours, 0.5);
    assert.equal((front[0].hours_regular || 0) + (front[0].hours_overtime || 0), 0.5);
    const parts = applyRunExtraTotals([front], runs, options);
    assert.equal(parts.extraByDay.get('2026-11-04'), 0.5);
    assert.equal(parts.shortByDay.get('2026-11-04'), 1);
  });

  it('adds every clock row in a run before subtracting that run’s contract', () => {
    const front = [
      row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 7:30', {}),
      row(2, 'NOV 4 AM 7:30', 'NOV 4 AM 9:00', {}),
    ];
    applyContractRegOtRows(front, [], 4.25, { ...options, contractRuns: { am: 2, pm: 2.5 } });
    assert.equal(front[0].total_hours, 1);
    assert.equal(front[1].total_hours, null);
  });

  it('counts midday work with no midday contract as extra', () => {
    const front = [row(1, 'NOV 4 AM 10:00', 'NOV 4 AM 11:00', {})];
    applyContractRegOtRows(front, [], 4.25, { ...options, contractRuns: { am: 2, pm: 2.5 } });
    assert.equal(front[0].total_hours, 1);
    assert.equal((front[0].hours_regular || 0) + (front[0].hours_overtime || 0), 1);
  });
});

describe('same driver overflow cards', () => {
  it('keeps the first sticker and appends only the photographed sides', () => {
    const anchor = {
      header: { employee_name: 'Nguyen, Mai', contract_hours: '5.25', date_on_card: '11/14/26' },
      front_rows: [row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00')],
      back_rows: [],
      sides_present: { front: true, back: false },
      caveats: ['Check the front.'],
    };
    const incoming = {
      header: { employee_name: 'Someone Else', route_number: '12', contract_hours: '9' },
      front_rows: [row(1, 'NOV 5 AM 6:00', 'NOV 5 AM 8:00')],
      back_rows: [row(1, 'NOV 5 PM 2:00', 'NOV 5 PM 4:00')],
      caveats: ['Soft stamp.'],
    };
    const merged = mergeSameDriverExtraction(anchor, incoming, { front: true, back: false });
    assert.equal(merged.header.employee_name, 'Nguyen, Mai');
    assert.equal(merged.header.contract_hours, '5.25');
    assert.equal(merged.header.route_number, '12');
    assert.equal(merged.front_rows.length, 1);
    assert.equal(merged.extra_sides.length, 1);
    assert.equal(merged.extra_sides[0].side, 'front');
    assert.equal(merged.extra_sides[0].card, 2);
    assert.equal(merged.extra_sides[0].rows[0].clock_out_raw, 'NOV 5 AM 6:00');
    assert.deepEqual(merged.caveats, ['Check the front.', 'Soft stamp.']);
    const again = mergeSameDriverExtraction(merged, incoming, { front: false, back: true });
    assert.equal(again.extra_sides.length, 2);
    assert.equal(again.extra_sides[1].card, 3);
    assert.equal(again.extra_sides[1].side, 'back');
  });
});
