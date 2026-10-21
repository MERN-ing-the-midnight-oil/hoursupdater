import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleClockDiffers,
  scheduleClockKey,
  scheduleHistoryTableHtml,
} from '../office-tracker/src/historyMarkup.js';

describe('schedule clock differences', () => {
  it('treats blank clocks as the same and ignores hour padding', () => {
    assert.equal(scheduleClockKey(''), '');
    assert.equal(scheduleClockKey('  '), '');
    assert.equal(scheduleClockKey('06:10'), '6:10');
    assert.equal(scheduleClockDiffers('06:10', '6:10'), false);
    assert.equal(scheduleClockDiffers('', ''), false);
    assert.equal(scheduleClockDiffers('8:55', '8:40'), true);
    assert.equal(scheduleClockDiffers('', '8:40'), true);
  });

  it('highlights only the clock that differs from the previous row', () => {
    const html = scheduleHistoryTableHtml({
      schedule_history: [
        {
          kind: 'initial',
          date: '2026-09-08',
          schedule: {
            AM: { clock_in: '6:10', clock_out: '8:40' },
            MIDDAY: { clock_in: '10:50', clock_out: '12:05' },
            PM: { clock_in: '13:50', clock_out: '16:15' },
          },
        },
        {
          kind: 'change',
          date: '2026-09-11',
          segment: 'AM',
          delta_minutes: 15,
          delta_label: '+15 min',
          cumulative_drift_minutes: 15,
          cumulative_drift_label: '+15 min',
          schedule: {
            AM: { clock_in: '06:10', clock_out: '8:55' },
            MIDDAY: { clock_in: '10:50', clock_out: '12:05' },
            PM: { clock_in: '13:50', clock_out: '16:15' },
          },
        },
        {
          kind: 'change',
          date: '2026-09-18',
          segment: 'PM',
          delta_minutes: 15,
          delta_label: '+15 min',
          cumulative_drift_minutes: 30,
          cumulative_drift_label: '+30 min',
          schedule: {
            AM: { clock_in: '6:10', clock_out: '8:55' },
            PM: { clock_in: '13:50', clock_out: '16:30' },
          },
        },
      ],
    });
    const rows = [...html.matchAll(/<tr class="is-history[\s\S]*?<\/tr>/g)].map((match) => match[0]);
    const marks = (row) =>
      [...row.matchAll(/<span class="times([^"]*)"[^>]*>([^<]*)<\/span>/g)].map((match) => ({
        diff: match[1].includes('is-time-diff'),
        text: match[2],
      }));

    assert.equal(rows.length, 3);
    assert.equal(marks(rows[0]).some((cell) => cell.diff), false);

    const changedAm = marks(rows[1]);
    assert.deepEqual(
      changedAm.map((cell) => cell.diff),
      [false, true, false, false, false, false]
    );
    assert.equal(changedAm[1].text, '8:55');
    assert.match(rows[1], /Change · \+15 min/);
    assert.match(rows[1], /Cumulative change · \+15 min/);
    assert.match(rows[2], /Change · \+15 min/);
    assert.match(rows[2], /Cumulative change · \+30 min/);

    const changedPm = marks(rows[2]);
    assert.deepEqual(
      changedPm.map((cell) => [cell.text, cell.diff]),
      [
        ['6:10', false],
        ['8:55', false],
        ['—', true],
        ['—', true],
        ['13:50', false],
        ['16:30', true],
      ]
    );
  });
});
