import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPaperBidSheet,
  fitPaperBidNameFontPx,
  formatPaperBidSchedule,
  isMoreSeniorThanHolder,
  preservePaperBidMeta,
  splitIntoColumns,
} from '../src/logic/paperBidSignup.js';
import {
  buildPaperBidSheetDocxBuffer,
  paperBidSheetDocxFilename,
} from '../src/logic/paperBidSheetDocx.js';

const drivers = [
  {
    driver_id: 'd1',
    name: 'Alice Senior',
    hire_date: '2010-01-01',
    tie_break: 1,
  },
  {
    driver_id: 'd2',
    name: 'Bob Mid',
    hire_date: '2015-06-01',
    tie_break: 1,
  },
  {
    driver_id: 'd3',
    name: 'Cara Junior',
    hire_date: '2020-09-01',
    tie_break: 1,
  },
  {
    driver_id: 'd4',
    name: 'Dana Unknown',
    hire_date: null,
    tie_break: null,
  },
];

describe('paperBidSignup helpers', () => {
  it('formats schedule for all segments', () => {
    assert.equal(
      formatPaperBidSchedule({
        AM: '6:30-8:40',
        MIDDAY: '11:00-12:15',
        PM: '14:00-16:20',
      }),
      'AM: 6:30-8:40 · MIDDAY: 11:00-12:15 · PM: 14:00-16:20'
    );
  });

  it('marks drivers more senior than the holder', () => {
    const holder = drivers[1];
    assert.equal(isMoreSeniorThanHolder(drivers[0], holder), true);
    assert.equal(isMoreSeniorThanHolder(drivers[1], holder), false);
    assert.equal(isMoreSeniorThanHolder(drivers[2], holder), false);
    assert.equal(isMoreSeniorThanHolder(drivers[3], holder), false);
  });

  it('splits roster into three columns', () => {
    const [a, b, c] = splitIntoColumns([1, 2, 3, 4, 5, 6, 7], 3);
    assert.deepEqual(a, [1, 2, 3]);
    assert.deepEqual(b, [4, 5, 6]);
    assert.deepEqual(c, [7]);
  });

  it('shrinks estimated name font for long names', () => {
    assert.equal(fitPaperBidNameFontPx('Ann Lee', { basePx: 15, maxCharsAtBase: 12 }), 15);
    assert.ok(
      fitPaperBidNameFontPx('Christopher Montgomery-Smythe III', {
        basePx: 15,
        minPx: 9,
        maxCharsAtBase: 12,
      }) < 15
    );
  });

  it('builds a printable sheet with bold-senior flags and filled template', () => {
    const sheet = buildPaperBidSheet({
      route_id: 'P 20',
      driver_id: 'd2',
      driver_name: 'Bob Mid',
      segments: { AM: '7:00-8:30', MIDDAY: null, PM: '14:00-16:00' },
      bid_response_due_date: '2026-07-22',
      paper_bid_start_date: '2026-08-01',
      drivers,
      template: {
        title: 'Bid sheet — {{route_id}}',
        intro: 'Due {{bid_response_due_date}} · start {{start_date}}',
        footer: 'Schedule: {{schedule}}',
      },
    });

    assert.equal(sheet.route_id, 'P 20');
    assert.equal(sheet.paper_bid_start_date, '2026-08-01');
    assert.equal(sheet.template.title, 'Bid sheet — P 20');
    assert.match(sheet.template.intro, /2026-07-22/);
    assert.match(sheet.template.footer, /AM: 7:00-8:30/);

    const alice = sheet.drivers.find((d) => d.driver_id === 'd1');
    const bob = sheet.drivers.find((d) => d.driver_id === 'd2');
    const cara = sheet.drivers.find((d) => d.driver_id === 'd3');
    assert.equal(alice?.more_senior_than_holder, true);
    assert.equal(bob?.more_senior_than_holder, false);
    assert.equal(cara?.more_senior_than_holder, false);
    assert.equal(sheet.columns.length, 3);
    assert.equal(
      sheet.columns[0].length +
        sheet.columns[1].length +
        sheet.columns[2].length,
      4
    );
  });

  it('preservePaperBidMeta keeps start date while BID_PENDING', () => {
    const prior = {
      'P 20': {
        status: 'BID_PENDING',
        paper_bid_start_date: '2026-08-01',
      },
    };
    const next = {
      'P 20': {
        status: 'BID_PENDING',
        paper_bid_start_date: null,
      },
      'P 21': {
        status: 'STABLE',
        paper_bid_start_date: '2026-09-01',
      },
    };
    const preserved = preservePaperBidMeta(prior, next);
    assert.equal(preserved['P 20'].paper_bid_start_date, '2026-08-01');
    assert.equal(preserved['P 21'].paper_bid_start_date, null);
  });

  it('builds a downloadable .docx buffer without nested tables', async () => {
    assert.equal(
      paperBidSheetDocxFilename('P 20'),
      'paper-bid-signup_P_20.docx'
    );
    const sheet = buildPaperBidSheet({
      route_id: 'P 20',
      driver_id: 'd2',
      driver_name: 'Bob Mid',
      segments: { AM: '7:00-8:30', MIDDAY: null, PM: '14:00-16:00' },
      bid_response_due_date: '2026-07-22',
      paper_bid_start_date: '2026-08-01',
      drivers,
    });
    const buffer = await buildPaperBidSheetDocxBuffer(sheet);
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 1000);
    // DOCX is a ZIP package.
    assert.equal(buffer.subarray(0, 2).toString('utf8'), 'PK');

    // Pages flattens nested tables to text — keep a single flat roster table.
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    assert.ok(documentXml);
    const tblStarts = documentXml.match(/<w:tbl[\s>]/g) || [];
    assert.equal(tblStarts.length, 1, 'expected a single flat table (Pages-safe)');
    assert.match(documentXml, /Initials/);
  });
});
