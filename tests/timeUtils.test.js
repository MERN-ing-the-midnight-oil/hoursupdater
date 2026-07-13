import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPayrollRoundingBreakdown,
  computeDeltaMinutes,
  computeExactRouteDailyTotalMinutes,
  parseTimeRange,
  roundToQuarterHourForPayroll,
  toDateString,
} from '../src/logic/timeUtils.js';

describe('timeUtils', () => {
  it('parses a valid time range', () => {
    const parsed = parseTimeRange('6:35-8:55');
    assert.equal(parsed.startMinutes, 6 * 60 + 35);
    assert.equal(parsed.endMinutes, 8 * 60 + 55);
    assert.equal(parsed.durationMinutes, 140);
  });

  it('computes exact unrounded positive delta', () => {
    assert.equal(computeDeltaMinutes('6:35-8:55', '6:30-8:55'), 5);
  });

  it('stores a genuine 7-minute shift as 7, not 0 or 15', () => {
    assert.equal(computeDeltaMinutes('6:35-8:55', '6:28-8:55'), 7);
  });

  it('computes exact unrounded negative delta', () => {
    assert.equal(computeDeltaMinutes('6:30-8:55', '6:35-8:55'), -5);
    assert.equal(computeDeltaMinutes('6:28-8:55', '6:35-8:55'), -7);
  });

  it('rejects invalid time ranges', () => {
    assert.throws(() => parseTimeRange('8:55-6:35'), /end must be after start/);
    assert.throws(() => parseTimeRange('bad'), /Invalid time range/);
  });

  it('normalizes dates to YYYY-MM-DD', () => {
    assert.equal(toDateString('2025-09-15'), '2025-09-15');
    assert.equal(toDateString(new Date('2025-09-15T12:00:00Z')), '2025-09-15');
  });

  it('sums exact AM+MIDDAY+PM durations for one route only (no per-segment rounding)', () => {
    const total = computeExactRouteDailyTotalMinutes({
      AM: '6:35-8:55', // 140
      MIDDAY: null,
      PM: '2:10-4:45', // 155
    });
    assert.equal(total, 295);
    assert.notEqual(total, roundToQuarterHourForPayroll(total));
  });

  describe('roundToQuarterHourForPayroll', () => {
    it('rounds to nearest 15 minutes', () => {
      assert.equal(roundToQuarterHourForPayroll(0), 0);
      assert.equal(roundToQuarterHourForPayroll(7), 0);
      assert.equal(roundToQuarterHourForPayroll(8), 15);
      assert.equal(roundToQuarterHourForPayroll(22), 15);
      assert.equal(roundToQuarterHourForPayroll(23), 30);
      assert.equal(roundToQuarterHourForPayroll(30), 30);
      assert.equal(roundToQuarterHourForPayroll(37), 30);
      assert.equal(roundToQuarterHourForPayroll(38), 45);
    });

    it('preserves sign for negative values', () => {
      assert.equal(roundToQuarterHourForPayroll(-7), 0);
      assert.equal(roundToQuarterHourForPayroll(-8), -15);
      assert.equal(roundToQuarterHourForPayroll(-22), -15);
      assert.equal(roundToQuarterHourForPayroll(-23), -30);
    });

    it('is not used for intermediate deltas', () => {
      const exact = computeDeltaMinutes('6:35-8:55', '6:28-8:55');
      assert.equal(exact, 7);
      assert.notEqual(exact, roundToQuarterHourForPayroll(exact));
    });
  });

  describe('buildPayrollRoundingBreakdown', () => {
    it('rounds the exact daily total, not a delta', () => {
      const breakdown = buildPayrollRoundingBreakdown({
        AM: '6:28-8:55', // 147
        MIDDAY: null,
        PM: null,
      });
      assert.equal(breakdown.exact_total_minutes, 147);
      assert.equal(breakdown.payroll_rounded_total_minutes, 150);
      assert.equal(breakdown.segments[0].duration_minutes, 147);
      // Old (wrong) approach would have rounded the +7 delta to 0.
      assert.equal(roundToQuarterHourForPayroll(7), 0);
      assert.notEqual(
        breakdown.payroll_rounded_total_minutes,
        roundToQuarterHourForPayroll(7)
      );
    });
  });
});
