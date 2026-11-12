import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_OVERTIME_RULES } from '../office-tracker/src/overtimeRules.js';
import {
  applyContractRegOtRows,
  GENIE_CARD_SYSTEM,
  genieCardUserPrefix,
  markContractHourRows,
  normalizeGenieCardExtraction,
  parseStickerContractHours,
} from '../office-tracker/src/timesheetGenieCard.js';
import { FRONT_SLOT_COUNT } from '../office-tracker/src/timesheetPrompt.js';
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

  it('does not invent hours from an empty or illegible line', () => {
    assert.equal(parseStickerContractHours(null), null);
    assert.equal(parseStickerContractHours('illegible'), null);
    assert.equal(parseStickerContractHours(''), null);
  });
});

describe('genie card copy', () => {
  it('asks for flat Clock Record lines and the white sticker', () => {
    assert.match(GENIE_CARD_SYSTEM, /sky-blue/i);
    assert.match(GENIE_CARD_SYSTEM, /exactly 26 lines/i);
    assert.match(GENIE_CARD_SYSTEM, /white sticker/i);
    assert.match(GENIE_CARD_SYSTEM, /5\.25 \(2, 3\.25\)/);
    assert.match(genieCardUserPrefix('front', 26), /exactly 26 Clock Record lines/i);
    assert.match(genieCardUserPrefix('front', 26), /date_on_card/i);
    assert.match(genieCardUserPrefix('back', 30), /contract_hours, and date_on_card to null/i);
  });

  it('pairs flat stamp lines and keeps the sticker contract on the copy', () => {
    const extraction = normalizeGenieCardExtraction({
      employee_name: 'Ada Driver',
      route_number: '79',
      contract_hours: '5.25 (2, 3.25)',
      date_on_card: '11/15/26',
      front: ['NOV 4 AM 6:00', 'NOV 4 AM 8:00', null, null],
    });
    assert.equal(extraction.front_rows.length, FRONT_SLOT_COUNT);
    assert.equal(extraction.header.employee_name, 'Ada Driver');
    assert.equal(extraction.header.route_number, '79');
    assert.equal(extraction.header.contract_hours, 5.25);
    assert.equal(extraction.header.contract_am_hours, 2);
    assert.equal(extraction.header.contract_pm_hours, 3.25);
    assert.equal(extraction.header.date_on_card, '11/15/26');
    assert.equal(extraction.front_rows[0].clock_out_raw, 'NOV 4 AM 6:00');
    assert.equal(extraction.front_rows[0].clock_in_raw, 'NOV 4 AM 8:00');
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

  it('clears Reg and OT when contract hours are missing', () => {
    const front = [row(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { reg: 2, ot: 0 })];
    applyContractRegOtRows(front, [], null, options);
    assert.equal(front[0].hours_regular, null);
    assert.equal(front[0].written_regular_status, 'blank');
  });
});
