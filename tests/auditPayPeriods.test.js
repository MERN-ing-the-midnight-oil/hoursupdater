import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WHOLE_MONTH_PAY_PERIODS } from '../office-tracker/src/driverPay.js';
import {
  auditSchoolYearLabel,
  parseCardPeriodEnd,
  payPeriodsInSchoolYear,
  schoolYearLabelForDate,
} from '../office-tracker/src/auditPayPeriods.js';
import {
  AUDIT_SYSTEM,
  auditSlotTool,
  auditUserPrefix,
  normalizeAuditExtraction,
} from '../office-tracker/src/timesheetAudit.js';
import { auditPeriodResultText, readAuditPeriodRecord, saveAuditPeriodResult } from '../office-tracker/web/auditPeriodStore.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
}

describe('pay periods in the school year', () => {
  it('lists 24 end dates from July 15 through June 30', () => {
    const periods = payPeriodsInSchoolYear('2026-2027');
    assert.equal(periods.length, 24);
    assert.equal(periods[0].iso, '2026-07-15');
    assert.equal(periods[1].iso, '2026-07-31');
    assert.equal(periods.at(-2).iso, '2027-06-15');
    assert.equal(periods.at(-1).iso, '2027-06-30');
    assert.equal(periods.some((period) => period.iso.startsWith('2026-06')), false);
  });

  it('uses the real last day of February', () => {
    const ordinary = payPeriodsInSchoolYear('2026-2027');
    assert.equal(ordinary.find((period) => period.iso.startsWith('2027-02') && period.id === '2')?.iso, '2027-02-28');
    const leap = payPeriodsInSchoolYear('2027-2028');
    assert.equal(leap.find((period) => period.iso.startsWith('2028-02') && period.id === '2')?.iso, '2028-02-29');
  });

  it('uses one period per month when the office pays monthly', () => {
    const periods = payPeriodsInSchoolYear('2026-2027', WHOLE_MONTH_PAY_PERIODS);
    assert.equal(periods.length, 12);
    assert.equal(periods[0].iso, '2026-07-31');
    assert.equal(periods.at(-1).iso, '2027-06-30');
  });

  it('reads the sticker date as the pay-period end', () => {
    assert.equal(parseCardPeriodEnd('11/15/26'), '2026-11-15');
    assert.equal(parseCardPeriodEnd('11/15/2026'), '2026-11-15');
    assert.equal(parseCardPeriodEnd('10-15-26'), '2026-10-15');
    assert.equal(parseCardPeriodEnd('2026-10-15'), '2026-10-15');
    assert.equal(parseCardPeriodEnd(' 02/28/27 '), '2027-02-28');
    assert.equal(parseCardPeriodEnd('02/29/27'), null);
    assert.equal(parseCardPeriodEnd(null), null);
  });

  it('uses the saved school year, otherwise the year that contains today', () => {
    assert.equal(schoolYearLabelForDate(new Date(2026, 10, 5)), '2026-2027');
    assert.equal(schoolYearLabelForDate(new Date(2027, 0, 15)), '2026-2027');
    assert.equal(schoolYearLabelForDate(new Date(2027, 6, 1)), '2027-2028');
    assert.equal(auditSchoolYearLabel({ schoolYear: { school_year: '2025-2026' } }), '2025-2026');
    assert.equal(auditSchoolYearLabel(null, new Date(2026, 10, 5)), '2026-2027');
  });
});

describe('audited pay periods in browser storage', () => {
  it('keeps the latest result for a pay-period end', () => {
    const storage = memoryStorage();
    assert.deepEqual(readAuditPeriodRecord(storage), {});
    saveAuditPeriodResult({ iso: '2026-11-15', mistakeCount: 2, uncheckedCount: 0, result: 'Checked' }, storage);
    saveAuditPeriodResult({ iso: '2026-11-15', mistakeCount: 0, uncheckedCount: 0, result: 'Checked' }, storage);
    const record = readAuditPeriodRecord(storage);
    assert.equal(record['2026-11-15'].result, 'Checked');
    assert.equal(record['2026-11-15'].mistakeCount, 0);
    assert.equal(auditPeriodResultText({ mistakeCount: 1, uncheckedCount: 4 }), 'Checked');
    assert.equal(auditPeriodResultText({ mistakeCount: 0, uncheckedCount: 2 }), 'Checked');
    assert.equal(auditPeriodResultText({ mistakeCount: 0, uncheckedCount: 0 }), 'Checked');
  });

  it('adds a marked pay-period end so the checked list can show it', () => {
    const storage = memoryStorage();
    const saved = saveAuditPeriodResult(
      { iso: '2026-10-31', mistakeCount: 0, uncheckedCount: 0, result: 'Checked' },
      storage
    );
    assert.ok(saved['2026-10-31']);
    assert.deepEqual(Object.keys(readAuditPeriodRecord(storage)), ['2026-10-31']);
    saveAuditPeriodResult(
      { iso: '2026-11-15', mistakeCount: 1, uncheckedCount: 0, result: 'Checked' },
      storage
    );
    assert.deepEqual(Object.keys(readAuditPeriodRecord(storage)).sort(), ['2026-10-31', '2026-11-15']);
  });
});

describe('audit sticker date', () => {
  it('requires the pay-period date and allows missing contract hours', () => {
    assert.match(AUDIT_SYSTEM, /Last, First/);
    assert.match(AUDIT_SYSTEM, /half the width of the card/);
    assert.match(AUDIT_SYSTEM, /Route #/);
    assert.match(AUDIT_SYSTEM, /MM\/DD\/YY or M\/DD\/YY/);
    assert.match(AUDIT_SYSTEM, /MUST return it as period_end/);
    assert.match(AUDIT_SYSTEM, /no contract-hours line/);
    assert.match(auditUserPrefix('front', 13), /period_end is required/);
    assert.match(auditUserPrefix('front', 13), /Last, First/);
    assert.match(auditUserPrefix('front', 13), /contract_hours is optional/);
    assert.match(auditUserPrefix('back', 15), /Report only the slots/);
    const frontTool = auditSlotTool(13, { periodEnd: true });
    assert.deepEqual(frontTool.input_schema.required, ['slots', 'period_end']);
    assert.match(frontTool.input_schema.properties.period_end.description, /Last, First/);
    assert.equal(Object.prototype.hasOwnProperty.call(frontTool.input_schema.properties, 'contract_hours'), true);
    const backTool = auditSlotTool(15, { periodEnd: false });
    assert.deepEqual(backTool.input_schema.required, ['slots']);
    assert.equal(Object.prototype.hasOwnProperty.call(backTool.input_schema.properties, 'period_end'), false);
  });

  it('keeps the sticker date on the extraction', () => {
    const extraction = normalizeAuditExtraction({ front: [], back: [], period_end: '11/15/26' });
    assert.equal(extraction.header.period_end, '2026-11-15');
    assert.equal(
      normalizeAuditExtraction({ front: [], back: [], period_end: '2026-10-15' }).header.period_end,
      '2026-10-15'
    );
    assert.equal(
      normalizeAuditExtraction({ front: [], back: [], period_end: '10/15/26', contract_hours: null }).header
        .contract_hours,
      null
    );
    assert.equal(normalizeAuditExtraction({ front: [], back: [] }).header.period_end, null);
  });
});
