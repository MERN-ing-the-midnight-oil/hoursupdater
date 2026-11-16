import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CONTRACT_SNAP_BREAKS } from '../src/logic/timeUtils.js';
import { DEFAULT_RUN_WINDOWS } from '../office-tracker/src/timesheetRunTable.js';
import {
  buildTimecardCopySheet,
  renderTimecardCopyDocument,
  renderTimecardCopyHtml,
  renderTimecardCopyText,
} from '../office-tracker/src/timecardCopySheet.js';

const breaks = DEFAULT_CONTRACT_SNAP_BREAKS;
const windows = DEFAULT_RUN_WINDOWS;

function sampleSummary() {
  return {
    driverName: 'Ada Driver',
    jobTitle: 'Bus Driver',
    location: 'Transportation',
    serial: '100',
    rate: '22.00',
    account: '123-456',
    defaultPeriodKey: '2026-11-a',
    periods: [
      {
        key: '2026-11-a',
        label: 'November 1–15, 2026',
        ending: '11/15/2026',
        days: [1, 2, 3],
        contractedHours: ['4.25', '4.25', ''],
        grandTotal: '8.00',
        unpaired: [{ when: 'Nov 16, 2026, 6:00 AM', action: 'Clock in' }],
        lines: [
          {
            id: 'reg-driver',
            label: 'REG DRIVER',
            otFactor: 1,
            comment: 'route work',
            total: '8.00',
            cells: [
              { day: 1, value: '4.00' },
              { day: 2, value: '4.00' },
              { day: 3, value: '' },
            ],
          },
          {
            id: 'ex-driver',
            label: 'EX DRIVER',
            otFactor: 1,
            comment: '',
            total: '',
            cells: [
              { day: 1, value: '' },
              { day: 2, value: '' },
              { day: 3, value: '' },
            ],
          },
        ],
      },
    ],
  };
}

function sampleExtraction() {
  return {
    header: {
      employee_name: 'Ada Driver',
      route_number: '12',
      date_on_card: '11/4/26',
      contract_hours: 6.25,
      contract_am_hours: 2,
      contract_midday_hours: 1.25,
      contract_pm_hours: 3,
    },
    front_rows: [
      { clock_out_raw: 'NOV 4 AM 6:10' },
      {},
      {
        clock_in_raw: 'NOV 4 AM 8:40',
        written_regular_status: 'number',
        written_regular: 0.5,
        written_overtime_status: 'number',
        written_overtime: 0,
        total_hours: 2.5,
      },
      {
        clock_out_raw: 'NOV 4 PM 2:00',
        clock_in_raw: 'NOV 4 PM 4:00',
        crossed_out: true,
      },
    ],
    back_rows: [],
    extra_sides: [
      {
        side: 'front',
        card: 2,
        rows: [{ clock_out_raw: 'NOV 5 AM 6:00', clock_in_raw: 'NOV 5 AM 8:00' }],
      },
    ],
  };
}

describe('timecard copy sheet', () => {
  it('keeps clock records, hours, and the run table, and skips blank lines', () => {
    const sheet = buildTimecardCopySheet({
      extraction: sampleExtraction(),
      breaks,
      windows,
      known: { am: 2.25, driver: 'Ada Driver', route: '12', asOf: 'Nov 4, 2026' },
      summary: sampleSummary(),
    });
    assert.equal(sheet.driverName, 'Ada Driver');
    assert.deepEqual(sheet.identity, [
      'Route 12',
      'Date on card 11/4/26',
      'Contract 6.25 (AM 2, Mid 1.25, PM 3)',
    ]);
    const front = sheet.sides[0];
    assert.equal(front.title, 'Front');
    assert.deepEqual(front.headers, [
      'Run',
      'Contract',
      'Duration',
      'Extra Time',
      'Reg',
      'OT',
      'Tot. Hrs.',
      'Clock Record',
    ]);
    assert.equal(front.rows.length, 3);
    assert.equal(front.rows[0].cells[0], 'AM');
    assert.equal(front.rows[0].cells[1], '2 *');
    assert.equal(front.rows[0].runSpan, 2);
    assert.equal(front.rows[1].runSpan, 0);
    assert.match(front.rows[0].cells[7], /Out NOV 4 AM 6:10/);
    assert.match(front.rows[1].cells[7], /In NOV 4 AM 8:40/);
    assert.equal(front.rows[1].cells[4], '0.50');
    assert.equal(front.rows[1].cells[5], '0');
    assert.equal(front.rows[1].cells[6], '2.50');
    assert.match(front.rows[2].cells[7], /crossed out/);
    assert.match(front.notes[0], /AM contract on this card is 2 hours/);
    assert.match(front.notes[0], /Time Changes has 2.25 hours/);
    assert.equal(sheet.sides[1].title, 'Card 2 front');
    assert.equal(sheet.summary.periods[0].lines.length, 1);
    assert.equal(sheet.summary.periods[0].lines[0].label, 'REG DRIVER');
    assert.deepEqual(
      sheet.summary.periods[0].lines[0].days.map((day) => day.day),
      ['1', '2']
    );
    assert.deepEqual(
      sheet.summary.periods[0].contractDays.map((day) => day.day),
      ['1', '2']
    );
  });

  it('uses the same words in the email text and the printed page', () => {
    const sheet = buildTimecardCopySheet({
      extraction: sampleExtraction(),
      breaks,
      windows,
      known: { am: 2.25, driver: 'Ada Driver', route: '12', asOf: 'Nov 4, 2026' },
      summary: sampleSummary(),
    });
    const text = renderTimecardCopyText(sheet);
    const html = renderTimecardCopyHtml(sheet);
    const shared = [
      'Completed timecard',
      'Ada Driver',
      'Route 12',
      'Front',
      'Run',
      'Contract',
      'Duration',
      'Extra Time',
      'Tot. Hrs.',
      'Clock Record',
      'NOV 4 AM 6:10',
      'NOV 4 AM 8:40',
      'Card 2 front',
      'MONTHLY TIME SUMMARY',
      'Bellingham Public Schools',
      'Transportation',
      'Pay period ending 11/15/2026',
      'REG CONTR HRS',
      'REG DRIVER',
      'route work',
      'Day 1',
      '4.00',
      'TOTAL',
      '8.00',
      'Clock records left off this sheet',
      'Nov 16, 2026, 6:00 AM',
      'Clock in',
      'A clock in counts only after its clock out is recorded.',
      'I certify that the above hours were worked as reported.',
      'Employee signature',
      'Supervisor approval',
    ];
    for (const phrase of shared) {
      assert.match(text, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(html, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.doesNotMatch(text, /EX DRIVER/);
    assert.doesNotMatch(html, /EX DRIVER/);
    const documentHtml = renderTimecardCopyDocument([sheet]);
    assert.match(documentHtml, /Completed timecard for Ada Driver/);
    assert.match(documentHtml, /#d7eaf6/);
    assert.match(documentHtml, /MONTHLY TIME SUMMARY/);
  });

  it('says when a card has no clocks and no summary yet', () => {
    const sheet = buildTimecardCopySheet({ extraction: { header: { employee_name: 'Ada Driver' } } });
    const text = renderTimecardCopyText(sheet);
    assert.match(text, /No clock records on this card/);
    assert.match(text, /Monthly Time Summary is not available for this card yet/);
    assert.match(renderTimecardCopyHtml(sheet), /No clock records on this card/);
  });
});
