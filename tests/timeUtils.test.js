import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPayrollRoundingBreakdown,
  computeDeltaMinutes,
  computeExactRouteDailyTotalMinutes,
  normalizeContractSnapBreaks,
  parseTimeRange,
  roundClockToQuarterHour,
  roundToQuarterHourForPayroll,
  snapContractClockToBreaks,
  snapContractTimeRange,
  snappedContractScheduleDeltaMinutes,
  toDateString,
} from '../src/logic/timeUtils.js';

describe('timeUtils', () => {
  it('snaps a clock to the nearest quarter hour', () => {
    assert.equal(roundClockToQuarterHour('6:07'), '6:00');
    assert.equal(roundClockToQuarterHour('6:08'), '6:15');
    assert.equal(roundClockToQuarterHour('5:50'), '5:45');
    assert.equal(roundClockToQuarterHour('8:10'), '8:15');
    assert.equal(roundClockToQuarterHour('23:53'), '0:00');
    assert.equal(roundClockToQuarterHour(''), '');
  });

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
    it('rounds a single run, not the delta that produced it', () => {
      const breakdown = buildPayrollRoundingBreakdown({
        AM: '6:28-8:55', // 147
        MIDDAY: null,
        PM: null,
      });
      assert.equal(breakdown.exact_total_minutes, 147);
      assert.equal(breakdown.segments[0].duration_minutes, 147);
      assert.equal(breakdown.segments[0].rounded_minutes, 150);
      assert.equal(breakdown.segments[1].rounded_minutes, null);
      assert.equal(breakdown.payroll_rounded_total_minutes, 150);
      // Old (wrong) approach would have rounded the +7 delta to 0.
      assert.equal(roundToQuarterHourForPayroll(7), 0);
      assert.notEqual(
        breakdown.payroll_rounded_total_minutes,
        roundToQuarterHourForPayroll(7)
      );
    });

    it('rounds each run, sums those minutes, then rounds the sum', () => {
      const breakdown = buildPayrollRoundingBreakdown({
        AM: '6:00-8:07', // 127 → 120
        MIDDAY: '11:00-12:07', // 67 → 60
        PM: '14:00-16:07', // 127 → 120
      });
      assert.equal(breakdown.exact_total_minutes, 321);
      assert.deepEqual(
        breakdown.segments.map((segment) => segment.rounded_minutes),
        [120, 60, 120]
      );
      assert.equal(breakdown.payroll_rounded_total_minutes, 300);
      assert.equal(roundToQuarterHourForPayroll(321), 315);
      assert.notEqual(breakdown.payroll_rounded_total_minutes, 315);
    });

    it('can snap contract clocks before counting official hours', () => {
      assert.equal(snapContractTimeRange('14:05-17:25'), '14:00-17:30');
      const exact = buildPayrollRoundingBreakdown({
        AM: null,
        MIDDAY: null,
        PM: '14:05-17:25', // 200 → 195
      });
      assert.equal(exact.payroll_rounded_total_minutes, 195);
      const snapped = buildPayrollRoundingBreakdown(
        {
          AM: null,
          MIDDAY: null,
          PM: '14:05-17:25',
        },
        { snapContractClocks: true }
      );
      assert.equal(snapped.exact_total_minutes, 200);
      assert.equal(snapped.segments[2].snapped_time, '14:00-17:30');
      assert.equal(snapped.segments[2].duration_minutes, 210);
      assert.equal(snapped.payroll_rounded_total_minutes, 210);
      assert.equal(snapped.snap_contract_clocks, true);
    });

    it('uses office minute bands instead of nearest-quarter for contract clocks', () => {
      assert.equal(snapContractClockToBreaks('6:00'), '6:00');
      assert.equal(snapContractClockToBreaks('6:06'), '6:00');
      assert.equal(snapContractClockToBreaks('6:07'), '6:15');
      assert.equal(snapContractClockToBreaks('6:21'), '6:15');
      assert.equal(snapContractClockToBreaks('6:22'), '6:30');
      assert.equal(snapContractClockToBreaks('6:36'), '6:30');
      assert.equal(snapContractClockToBreaks('6:37'), '6:45');
      assert.equal(snapContractClockToBreaks('6:51'), '6:45');
      assert.equal(snapContractClockToBreaks('6:52'), '7:00');
      assert.equal(snapContractClockToBreaks('6:59'), '7:00');
      assert.deepEqual(normalizeContractSnapBreaks({ toHour: 8, toQuarter: 5, toHalf: 40, toNextHour: 39 }), {
        toHour: 8,
        toQuarter: 9,
        toHalf: 40,
        toNextHour: 41,
      });
      assert.equal(
        snapContractClockToBreaks('6:08', { toHour: 8, toQuarter: 21, toHalf: 36, toNextHour: 52 }),
        '6:00'
      );
    });

    it('measures a schedule change by snapped contracted daily totals', () => {
      assert.equal(
        snappedContractScheduleDeltaMinutes(
          { AM: '6:40-8:40', MIDDAY: null, PM: '14:05-16:25' },
          { AM: '6:40-8:40', MIDDAY: null, PM: '14:05-16:45' }
        ),
        15
      );
      assert.equal(
        snappedContractScheduleDeltaMinutes(
          { AM: '6:40-8:40', MIDDAY: null, PM: '14:05-16:05' },
          { AM: '6:40-8:40', MIDDAY: null, PM: '14:05-16:34' }
        ),
        30
      );
    });
  });
});
