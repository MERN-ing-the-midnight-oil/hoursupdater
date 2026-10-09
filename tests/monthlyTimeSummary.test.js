import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMonthlyTimeSummary, renderMonthlyTimeSummaryHtml } from '../office-tracker/src/monthlyTimeSummary.js';

test('monthly time summary snaps a day into quarter-hour clocks and splits the month', () => {
  const summary = buildMonthlyTimeSummary({
    driverName: 'Goofy Goof',
    routes: ['D 21'],
    roundClocks: true,
    now: new Date(2026, 9, 9, 12, 0),
    punches: [
      {
        id: 'in',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 9, 8, 5, 54).toISOString(),
        note: 'Practice',
      },
      {
        id: 'out',
        driver_name: 'Goofy Goof',
        action: 'out',
        punched_at: new Date(2026, 9, 8, 8, 40).toISOString(),
        reason_codes: [{ id: 'traffic', label: 'Traffic' }],
      },
      {
        id: 'sep',
        driver_name: 'Goofy Goof',
        action: 'in',
        punched_at: new Date(2026, 8, 8, 6, 2).toISOString(),
      },
    ],
  });

  assert.equal(summary.defaultMonth, '2026-10');
  const october = summary.months.find((month) => month.key === '2026-10');
  const firstHalf = october.periods[0];
  assert.equal(firstHalf.label, 'October 1–15, 2026');
  assert.equal(firstHalf.rows.length, 1);
  assert.equal(firstHalf.rows[0].run, 'AM');
  assert.equal(firstHalf.rows[0].clockIn, '5:54 AM');
  assert.equal(firstHalf.rows[0].clockOut, '8:40 AM');
  assert.equal(firstHalf.rows[0].quarterClocks, '6:00 AM–8:45 AM');
  assert.equal(firstHalf.rows[0].minutes, '165');
  assert.equal(firstHalf.rows[0].quarterHours, '2.75');
  assert.match(firstHalf.rows[0].note, /Practice/);
  assert.match(firstHalf.rows[0].note, /Traffic/);
  assert.equal(october.periods[1].rows.length, 0);
  assert.equal(summary.months.find((month) => month.key === '2026-09').periods[0].rows[0].clockIn, '6:02 AM');

  const html = renderMonthlyTimeSummaryHtml(summary);
  assert.match(html, /MONTHLY TIME SUMMARY/);
  assert.match(html, /Goofy Goof/);
  assert.match(html, /6:00 AM–8:45 AM/);
});
