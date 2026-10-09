import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBps2026_2027Calendar } from '../employee-tracker/src/bpsCalendar2026.js';
import { groupCalendarByMonth } from '../employee-tracker/src/snapshot.js';
import {
  calendarMonthsHtml,
  historyMonthsThroughNext,
} from '../office-tracker/src/historyMarkup.js';

const { calendar } = buildBps2026_2027Calendar();
const months = groupCalendarByMonth(calendar);

function labels(asOf) {
  return historyMonthsThroughNext(months, asOf).map((month) => month.label);
}

describe('route clock-time history months', () => {
  it('shows past months, the current month, and the next month', () => {
    const shown = labels('2026-10-09');
    assert.ok(shown.includes('September 2026'));
    assert.ok(shown.includes('October 2026'));
    assert.ok(shown.includes('November 2026'));
    assert.equal(shown.includes('December 2026'), false);
    assert.equal(shown.includes('June 2027'), false);
  });

  it('rolls the next month into the following year', () => {
    const shown = labels('2026-12-15');
    assert.ok(shown.includes('December 2026'));
    assert.ok(shown.includes('January 2027'));
    assert.equal(shown.includes('February 2027'), false);
  });

  it('renders only those months on the calendar', () => {
    const html = calendarMonthsHtml({
      calendar: { ...calendar, months },
      rows: [],
      asOf: '2026-10-09',
    });
    assert.match(html, /October 2026/);
    assert.match(html, /November 2026/);
    assert.doesNotMatch(html, /December 2026/);
  });
});
