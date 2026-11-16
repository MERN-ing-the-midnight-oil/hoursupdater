import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENIE_CARD_ARCHIVE_KEY,
  archiveCardsFromSession,
  genieScanBackupFilename,
  genieScanBackupHtml,
  loadGenieCardArchive,
  payPeriodSummarySnapshot,
  saveGenieCardArchive,
} from '../office-tracker/src/genieCardArchive.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function card(extra = {}) {
  return {
    id: 'session-picard',
    example: false,
    status: 'ready',
    updatedAt: 10,
    hoursMode: 'quarter',
    frontFile: { name: 'front.jpg', size: 99999 },
    extraction: {
      header: {
        employee_name: 'Picard, Jean-Luc',
        route_number: 'S1',
        date_on_card: '11/15/26',
        contract_hours: 5.25,
        contract_am_hours: 2,
        contract_pm_hours: 3.25,
      },
      front_rows: [
        {
          clock_out_raw: 'NOV 2 AM 6:10',
          clock_in_raw: 'NOV 2 AM 8:40',
          hours_regular: 2.5,
          hours_overtime: null,
          total_hours: 2.5,
          pay_status: 'reg-driver',
          description_of_work: 'AM run',
          preview: 'data:image/jpeg;base64,AAAA',
        },
      ],
      back_rows: [],
      caveats: [],
    },
    summary: {
      driverName: 'Jean-Luc Picard',
      periods: [
        {
          key: '2026-11-1',
          label: 'November 1–15, 2026',
          ending: '11/15/2026',
          days: [2],
          contractedHours: ['5.25'],
          grandTotal: '2.50',
          lines: [
            {
              id: 'reg-driver',
              label: 'REG DRIVER',
              total: '2.50',
              cells: [{ day: 2, value: '2.50' }],
            },
            {
              id: 'ot-trainer',
              label: 'OT DR TRAINER',
              total: '',
              cells: [{ day: 2, value: '' }],
            },
          ],
          unpaired: [],
        },
      ],
    },
    ...extra,
  };
}

describe('genie card archive', () => {
  it('saves constructed cards and summaries without photos', () => {
    const storage = memoryStorage();
    const cards = archiveCardsFromSession([
      card(),
      card({
        id: 'example-1',
        example: true,
        extraction: {
          header: { employee_name: 'Data', date_on_card: '11/15/26' },
          front_rows: [],
          back_rows: [],
        },
      }),
      card({ id: 'session-reading', status: 'reading' }),
    ]);
    assert.equal(saveGenieCardArchive({ cards }, storage), true);
    const raw = storage.getItem(GENIE_CARD_ARCHIVE_KEY);
    assert.doesNotMatch(raw, /front\.jpg/);
    assert.doesNotMatch(raw, /data:image/);
    assert.doesNotMatch(raw, /Data/);
    const loaded = loadGenieCardArchive(storage);
    assert.equal(loaded.cards.length, 1);
    assert.equal(loaded.cards[0].extraction.header.employee_name, 'Picard, Jean-Luc');
    assert.equal(loaded.cards[0].extraction.front_rows[0].clock_out_raw, 'NOV 2 AM 6:10');
    assert.equal(loaded.cards[0].extraction.front_rows[0].row_index, 1);
    assert.equal(loaded.cards[0].summary.periods[0].grandTotal, '2.50');
    assert.equal(loaded.cards[0].summary.periods[0].lines.length, 1);
    assert.equal(loaded.cards[0].frontFile, undefined);
    assert.equal(loaded.cards[0].printed, false);
    assert.equal(loaded.cards[0].printId, '');
  });

  it('keeps the print copy id, the printed mark, and extra-side photo ids', () => {
    const source = card({
      printId: 'card-abc',
      printed: true,
      extraction: {
        ...card().extraction,
        extra_sides: [{ id: 'e1', card: 2, side: 'front', printId: 'card-extra', rows: [] }],
      },
    });
    const cards = archiveCardsFromSession([source]);
    assert.equal(cards[0].printId, 'card-abc');
    assert.equal(cards[0].printed, true);
    assert.equal(cards[0].extraction.extra_sides[0].printId, 'card-extra');
    const storage = memoryStorage();
    assert.equal(saveGenieCardArchive({ cards }, storage), true);
    const loaded = loadGenieCardArchive(storage);
    assert.equal(loaded.cards[0].printId, 'card-abc');
    assert.equal(loaded.cards[0].printed, true);
    assert.equal(loaded.cards[0].printQueued, false);
    assert.equal(loaded.cards[0].extraction.extra_sides[0].printId, 'card-extra');
  });

  it('keeps an empty archive when storage is unreadable', () => {
    assert.deepEqual(loadGenieCardArchive(null).cards, []);
    const storage = memoryStorage();
    storage.setItem(GENIE_CARD_ARCHIVE_KEY, '{not json');
    assert.deepEqual(loadGenieCardArchive(storage).cards, []);
  });

  it('writes a readable backup grouped by pay period', () => {
    const october = card({
      id: 'session-riker',
      updatedAt: 5,
      extraction: {
        header: {
          employee_name: 'Riker, William',
          route_number: 'S2',
          date_on_card: '10/31/26',
          contract_hours: 6,
        },
        front_rows: [
          {
            clock_out_raw: 'OCT 26 AM 6:25',
            clock_in_raw: 'illegible',
            total_hours: null,
            pay_status: 'ex-driver',
          },
        ],
        back_rows: [],
        caveats: ['Blurry photo'],
      },
      summary: null,
    });
    const html = genieScanBackupHtml({ cards: archiveCardsFromSession([card(), october]) }, new Date('2026-11-15T16:00:00'));
    assert.match(html, /Pay period ending 10\/31\/26/);
    assert.match(html, /Pay period ending 11\/15\/26/);
    assert.match(html, /Picard, Jean-Luc/);
    assert.match(html, /Riker, William/);
    assert.match(html, /NOV 2 AM 6:10/);
    assert.match(html, /OCT 26 AM 6:25/);
    assert.match(html, /REG DRIVER/);
    assert.match(html, /EX DRIVER/);
    assert.match(html, /November 1–15, 2026/);
    assert.match(html, /Grand total/);
    assert.match(html, /2\.50/);
    assert.match(html, /Contract 5\.25 \(2, 3\.25\)/);
    assert.match(html, /Blurry photo/);
    assert.match(html, /Monthly Time Summary is not available/);
    assert.doesNotMatch(html, /data:image/);
    assert.doesNotMatch(html, /front\.jpg/);
    const octoberAt = html.indexOf('Pay period ending 10/31/26');
    const novemberAt = html.indexOf('Pay period ending 11/15/26');
    assert.ok(octoberAt < novemberAt);
    assert.equal(genieScanBackupFilename(new Date('2026-11-15T16:00:00')), 'timecard-genie-scans-2026-11-15.html');
    assert.equal(payPeriodSummarySnapshot(null), null);
  });
});
