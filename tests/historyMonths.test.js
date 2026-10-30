import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBellingham2026_2027Calendar } from '../employee-tracker/src/bellinghamCalendar2026.js';
import { groupCalendarByMonth } from '../employee-tracker/src/snapshot.js';
import {
  calendarMonthsHtml,
  contractNoticeCalendarHtml,
  historyMonthsThroughNext,
  monthsSpanningIsoDates,
  prettyDate,
} from '../office-tracker/src/historyMarkup.js';

const { calendar } = buildBellingham2026_2027Calendar();
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

  it('renders a BID result square on the bid posting date', () => {
    const html = calendarMonthsHtml({
      calendar: { ...calendar, months },
      rows: [
        {
          kind: 'change',
          date: '2026-10-09',
          segment: 'AM',
          delta_minutes: 35,
          delta_label: '+35 min',
          contracted: {
            status: 'predicted',
            projected_outcome: 'BID_PENDING',
            becomes_on: '2026-11-20',
          },
        },
      ],
      asOf: '2026-11-20',
    });
    assert.match(html, /history-pip is-result[^>]*>BID</);
  });
});

describe('contract notice calendar months', () => {
  it('spans only the months that hold notice send-by dates', () => {
    const shown = monthsSpanningIsoDates(months, ['2026-09-24', '2026-11-30']).map(
      (month) => month.label
    );
    assert.deepEqual(shown, ['September 2026', 'October 2026', 'November 2026']);
  });

  it('plots a notice mark on its send-by date', () => {
    assert.equal(prettyDate('2026-09-24'), 'Thu, Sep 24, 2026');
    const mark =
      '<span class="contract-notice-marks"><span class="contract-notice-mark contract-notice-mark-bid" title="Annie Porter · Route 74 · Up for bid · Send by Thu, Sep 24, 2026"><span class="contract-kind-badge contract-kind-bid">gavel</span><span class="contract-notice-route">74</span></span></span>';
    const html = contractNoticeCalendarHtml({
      calendar: { ...calendar, months },
      months: monthsSpanningIsoDates(months, ['2026-09-24']),
      marksByDate: { '2026-09-24': mark },
      asOf: '2026-10-30',
    });
    assert.match(html, /September 2026/);
    assert.match(html, /has-contract-notice/);
    assert.match(html, /contract-notice-route">74</);
    assert.match(html, /contract-notice-mark-bid/);
    assert.match(html, /Send by Thu, Sep 24, 2026/);
  });

  it('shades end-of-month bid periods like the route history calendar', () => {
    const html = contractNoticeCalendarHtml({
      calendar: { ...calendar, months },
      months: monthsSpanningIsoDates(months, ['2026-10-01', '2026-11-30']),
      marksByDate: {},
      asOf: '2026-10-30',
    });
    assert.match(html, /is-bid-period/);
    assert.match(html, /bid-rect/);
    assert.match(html, /End-of-month bid period/);
  });
});
