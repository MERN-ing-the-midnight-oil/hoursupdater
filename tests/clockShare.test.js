import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clockRecordCsv,
  clockRecordFilename,
  clockRecordMessage,
  clockShareOrigin,
  clockShareUrl,
  driverClockKey,
  looksLikeEmail,
} from '../office-tracker/src/clockShare.js';
import { DEFAULT_PAY_PERIODS } from '../office-tracker/src/driverPay.js';
import { buildDriverClockRecord } from '../office-tracker/src/driverClockRecord.js';

describe('driver clock share links', () => {
  it('builds a phone URL from a network address when the kiosk is on localhost', () => {
    assert.equal(
      clockShareOrigin({
        protocol: 'http',
        host: 'localhost:3849',
        port: 3849,
        addresses: ['192.168.1.20'],
      }),
      'http://192.168.1.20:3849'
    );
    assert.equal(
      clockShareOrigin({ protocol: 'https', host: 'office.example.com', port: 3849, addresses: [] }),
      'https://office.example.com'
    );
    assert.equal(clockShareOrigin({ host: '127.0.0.1:3849', port: 3849, addresses: [] }), '');
  });

  it('keeps the token in the clock page query', () => {
    assert.equal(driverClockKey('  Alex Driver '), 'alex driver');
    assert.equal(
      clockShareUrl('http://192.168.1.20:3849/', 'abc'),
      'http://192.168.1.20:3849/driver-clock.html?t=abc'
    );
    assert.equal(clockShareUrl('', 'abc'), '');
  });

  it('writes a spreadsheet and an email for one driver', () => {
    const punches = [
      {
        id: 'in',
        driver_name: 'Alex Driver',
        action: 'in',
        punched_at: new Date(2026, 9, 9, 6, 0).toISOString(),
        run: 'AM',
      },
      {
        id: 'out',
        driver_name: 'Alex Driver',
        action: 'out',
        punched_at: new Date(2026, 9, 9, 8, 30).toISOString(),
        run: 'AM',
      },
    ];
    const sheets = buildDriverClockRecord(punches, DEFAULT_PAY_PERIODS, 'Alex Driver', new Date(2026, 9, 9, 15));
    assert.equal(clockRecordFilename('Alex Driver'), 'alex-driver-clock-records.csv');
    assert.match(clockRecordCsv(sheets), /Date,Day,AM in,AM out/);
    assert.match(clockRecordCsv(sheets), /6:00 AM/);
    assert.match(clockRecordCsv(sheets), /8:30 AM/);
    const message = clockRecordMessage('Alex Driver', sheets);
    assert.match(message, /^Clock records for Alex Driver/);
    assert.match(message, /10\/9\/2026 Friday: AM in 6:00 AM; AM out 8:30 AM/);
    assert.equal(looksLikeEmail('alex@district.k12.wa.us'), true);
    assert.equal(looksLikeEmail('not an email'), false);
  });
});
