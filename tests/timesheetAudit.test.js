import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_OVERTIME_RULES } from '../office-tracker/src/overtimeRules.js';
import {
  auditWrittenHours,
  formatAuditHours,
  normalizeAuditExtraction,
  parseAuditHours,
} from '../office-tracker/src/timesheetAudit.js';
import { FRONT_SLOT_COUNT } from '../office-tracker/src/timesheetPrompt.js';
import { splitTotHoursIntoRegOt } from '../office-tracker/src/timesheetRegOt.js';
import { DEFAULT_CONTRACT_SNAP_BREAKS } from '../src/logic/timeUtils.js';

const rules = { ...DEFAULT_OVERTIME_RULES };
const breaks = DEFAULT_CONTRACT_SNAP_BREAKS;

function stamped(index, out, inn, written = {}) {
  const regStatus = written.regStatus || (written.reg == null ? 'blank' : 'number');
  const otStatus = written.otStatus || (written.ot == null ? 'blank' : 'number');
  const totStatus = written.totStatus || (written.tot == null ? 'blank' : 'number');
  return {
    row_index: index,
    clock_out_raw: out,
    clock_in_raw: inn,
    written_regular: written.reg ?? null,
    written_regular_status: regStatus,
    written_overtime: written.ot ?? null,
    written_overtime_status: otStatus,
    written_total: written.tot ?? null,
    written_total_status: totStatus,
    crossed_out: false,
  };
}

function audit(front, back = [], contractHours = null) {
  return auditWrittenHours(
    { header: { contract_hours: contractHours }, front_rows: front, back_rows: back },
    { breaks, rules, defaultYear: 2026 }
  );
}

describe('audit hour parsing', () => {
  it('reads blank, zero, fractions, and illegible cells', () => {
    assert.deepEqual(parseAuditHours(null), { status: 'blank', hours: null });
    assert.deepEqual(parseAuditHours(''), { status: 'blank', hours: null });
    assert.deepEqual(parseAuditHours('—'), { status: 'blank', hours: null });
    assert.deepEqual(parseAuditHours('•'), { status: 'number', hours: 0 });
    assert.deepEqual(parseAuditHours('1 1/4'), { status: 'number', hours: 1.25 });
    assert.deepEqual(parseAuditHours('1/2'), { status: 'number', hours: 0.5 });
    assert.deepEqual(parseAuditHours('1,25'), { status: 'number', hours: 1.25 });
    assert.deepEqual(parseAuditHours('illegible'), { status: 'illegible', hours: null });
    assert.equal(formatAuditHours(2), '2');
    assert.equal(formatAuditHours(1.5), '1.50');
  });
});

describe('audit extraction', () => {
  it('keeps written Reg and OT and pads the card', () => {
    const extraction = normalizeAuditExtraction({
      front: [
        {
          stamps: ['NOV 4 AM 6:00', 'NOV 4 AM 8:00'],
          reg: 2,
          ot: '•',
          tot: null,
        },
        null,
      ],
      back: null,
    });
    assert.equal(extraction.front_rows.length, FRONT_SLOT_COUNT);
    assert.equal(extraction.back_rows.length, 15);
    assert.equal(extraction.front_rows[0].clock_out_raw, 'NOV 4 AM 6:00');
    assert.equal(extraction.front_rows[0].written_regular, 2);
    assert.equal(extraction.front_rows[0].written_overtime, 0);
    assert.equal(extraction.front_rows[0].written_total_status, 'blank');
    assert.equal(extraction.front_rows[1].written_regular_status, 'blank');
    assert.equal(extraction.front_rows[1].clock_out_raw, null);
    const withContract = normalizeAuditExtraction({ front: [], back: [], contract_hours: '2.25 2.00 2.25' });
    assert.equal(withContract.header.contract_hours, 6.5);
  });
});

describe('audit written Reg / OT against clock stamps', () => {
  it('accepts a blank Reg when Tot. Hrs. is under the contract', () => {
    const report = audit([
      stamped(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { otStatus: 'blank', tot: 2 }),
    ], [], 6.5);
    assert.equal(report.front[0].totHours, 2);
    assert.equal(report.front[0].expectedReg, 0);
    assert.equal(report.front[0].expectedOt, 0);
    assert.equal(report.mistakeCount, 0);
    assert.equal(report.uncheckedCount, 0);
    assert.equal(report.front[0].severity, 'ok');
  });

  it('does not invent Reg when Tot. Hrs. is under the contract', () => {
    const report = audit(
      [stamped(1, 'MAR 6 PM 1:53', 'MAR 6 PM 4:52', { tot: 3 })],
      [],
      5.25
    );
    assert.equal(report.front[0].totHours, 3);
    assert.equal(report.front[0].expectedReg, 0);
    assert.equal(report.front[0].expectedOt, 0);
    assert.equal(report.front[0].issues.some((issue) => issue.field === 'reg'), false);
  });

  it('keeps a two-run day under contract at zero Reg, not a shortfall fill', () => {
    const report = audit(
      [
        stamped(1, 'JAN 20 AM 6:36', 'JAN 20 AM 9:32', {}),
        stamped(2, 'JAN 20 PM 2:02', 'JAN 20 PM 5:00', {}),
      ],
      [],
      6.75
    );
    const worked = report.front.reduce((sum, row) => sum + (row.totHours || 0), 0);
    assert.equal(worked, 6);
    const anchor = report.front.find((row) => row.expectedReg != null || row.expectedOt != null);
    assert.equal(anchor.expectedReg, 0);
    assert.equal(anchor.expectedOt, 0);
  });

  it('shows Reg / OT only for hours worked beyond the contract', () => {
    // One 3-hour AM and one 4-hour PM = 7 Tot vs 5.25 contract → 1.75 residual.
    const report = audit(
      [
        stamped(1, 'NOV 4 AM 6:00', 'NOV 4 AM 9:00', { tot: 3 }),
        stamped(2, 'NOV 4 PM 1:00', 'NOV 4 PM 5:00', { tot: 4 }),
      ],
      [],
      5.25
    );
    const worked = report.front.reduce((sum, row) => sum + (row.totHours || 0), 0);
    assert.equal(worked, 7);
    const anchor = report.front.find((row) => row.expectedReg != null);
    assert.equal(anchor.expectedReg + anchor.expectedOt, 1.75);
    assert.ok(anchor.expectedReg + anchor.expectedOt > 0);
  });

  it('does not calculate Reg or OT until the contract hours are known', () => {
    const report = audit([
      stamped(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { reg: 2, otStatus: 'blank', tot: 2 }),
    ]);
    assert.equal(report.front[0].expectedReg, null);
    assert.equal(report.front[0].expectedOt, null);
    assert.equal(report.front[0].totHours, 2);
    assert.equal(report.mistakeCount, 0);
  });

  it('flags Reg written when Tot. Hrs. is still under the contract', () => {
    const report = audit([
      stamped(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { reg: 2, otStatus: 'blank', tot: 2 }),
    ], [], 6.5);
    assert.equal(report.mistakeCount, 1);
    assert.equal(report.front[0].severity, 'mistake');
    const reg = report.front[0].issues.find((issue) => issue.field === 'reg');
    assert.match(reg.message, /Reg is 2; calculated 0/);
    assert.equal(report.front[0].issues.some((issue) => issue.field === 'ot'), false);
  });

  it('does not flag a blank Reg when Tot. Hrs. is under the contract', () => {
    const report = audit([
      stamped(2, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { tot: 2 }),
    ], [], 6.5);
    assert.equal(report.front[0].expectedReg, 0);
    assert.equal(report.front[0].issues.some((issue) => issue.field === 'reg'), false);
    assert.equal(report.mistakeCount, 0);
  });

  it('skips comparison for illegible Reg and still flags a wrong Tot. Hrs.', () => {
    const report = audit([
      stamped(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', {
        regStatus: 'illegible',
        ot: 0,
        tot: 3,
      }),
    ], [], 6.5);
    assert.equal(report.front[0].writtenRegStatus, 'illegible');
    assert.equal(report.front[0].expectedReg, 0);
    const fields = report.front[0].issues.map((issue) => issue.field);
    assert.deepEqual(fields, ['tot']);
    assert.match(report.front[0].issues[0].message, /Tot\. Hrs\. is 3; calculated 2/);
  });

  it('shows a calculated Tot. Hrs. when the handwriting is blank', () => {
    const report = audit([
      stamped(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { reg: 0, ot: 0 }),
    ], [], 6.5);
    assert.equal(report.front[0].totHours, 2);
    assert.equal(report.front[0].issues.some((issue) => issue.field === 'tot'), true);
  });

  it('marks written hours as unchecked when the stamps cannot be read', () => {
    const report = audit([
      stamped(3, 'illegible', 'illegible', { reg: 2, ot: 0 }),
    ]);
    assert.equal(report.mistakeCount, 0);
    assert.equal(report.uncheckedCount, 1);
    assert.match(report.front[0].issues[0].message, /illegible/);
  });

  it('skips empty slots', () => {
    const report = audit([
      stamped(1, null, null, {}),
      stamped(2, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { reg: 2, ot: 0 }),
    ]);
    assert.equal(report.front.length, 1);
    assert.equal(report.front[0].rowIndex, 2);
  });

  it('leaves the written hours on the card rows alone', () => {
    const row = stamped(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { reg: 1, ot: 0 });
    audit([row]);
    assert.equal(row.written_regular, 1);
    assert.equal(row.hours_regular, undefined);
  });

  it('compares one Reg / OT total for the date across multiple clock combos', () => {
    const report = audit(
      [
        stamped(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { tot: 2 }),
        stamped(2, 'NOV 4 PM 2:00', 'NOV 4 PM 4:00', { tot: 2 }),
      ],
      [],
      6.5
    );
    assert.equal(report.front.length, 2);
    assert.equal(report.front[0].expectedReg, 0);
    assert.equal(report.front[0].expectedOt, 0);
    assert.equal(report.front[1].expectedReg, null);
    assert.equal(report.front[1].expectedOt, null);
    assert.equal(report.front[0].totHours, 2);
    assert.equal(report.front[1].totHours, 2);
    assert.equal(report.mistakeCount, 0);
    assert.equal(report.front[0].severity, 'ok');
    assert.equal(report.front[1].severity, 'ok');
  });

  it('still checks Tot. Hrs. on each combo when Reg / OT is only on one row', () => {
    const report = audit(
      [
        stamped(1, 'NOV 4 AM 6:00', 'NOV 4 AM 8:00', { tot: 2 }),
        stamped(2, 'NOV 4 PM 2:00', 'NOV 4 PM 4:00', { tot: 3 }),
      ],
      [],
      6.5
    );
    assert.equal(report.front[0].expectedReg, 0);
    assert.equal(report.front[1].expectedReg, null);
    assert.equal(report.mistakeCount, 1);
    assert.equal(report.front[1].severity, 'mistake');
    assert.match(report.front[1].issues[0].message, /Tot\. Hrs\. is 3; calculated 2/);
    assert.equal(report.front[0].issues.some((issue) => issue.field === 'reg'), false);
  });
});
