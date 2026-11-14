import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createTimesheetCaptureShare,
  timesheetCaptureUrl,
} from '../office-tracker/src/timesheetCaptureShare.js';

describe('timecard genie phone capture share', () => {
  it('builds a phone capture URL from the share origin', () => {
    assert.equal(
      timesheetCaptureUrl('http://192.168.1.20:3847/', 'abc'),
      'http://192.168.1.20:3847/timesheet-capture.html?t=abc'
    );
    assert.equal(timesheetCaptureUrl('', 'abc'), '');
    assert.equal(timesheetCaptureUrl('http://192.168.1.20:3847/', ''), '');
    assert.equal(
      timesheetCaptureUrl('http://192.168.1.20:3847/', 'abc', 'audit'),
      'http://192.168.1.20:3847/timesheet-capture.html?t=abc&desk=audit'
    );
  });

  it('stores front and back photos on a short-lived token', () => {
    let issued = 0;
    const share = createTimesheetCaptureShare({ token: () => `tok-${++issued}` });
    const opened = share.open();
    assert.equal(opened.token, 'tok-1');
    assert.equal(opened.front, false);
    assert.equal(opened.back, false);
    assert.equal(opened.ready, false);

    const tiny = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
    const afterFront = share.putPhoto(opened.token, 'front', {
      mime: 'image/jpeg',
      data: tiny,
      name: 'front-timecard.jpg',
    });
    assert.equal(afterFront.front, true);
    assert.equal(afterFront.back, false);
    assert.equal(afterFront.ready, false);

    const afterBack = share.putPhoto(opened.token, 'back', {
      mime: 'image/jpeg',
      data: tiny,
    });
    assert.equal(afterBack.ready, true);
    assert.equal(share.getPhoto(opened.token, 'front')?.name, 'front-timecard.jpg');
    assert.equal(share.getPhoto(opened.token, 'back')?.mime, 'image/jpeg');
  });

  it('keeps both photos until restart so the desk can download the back', () => {
    const share = createTimesheetCaptureShare({ token: () => 'again' });
    const opened = share.open();
    const tiny = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
    share.putPhoto(opened.token, 'front', { mime: 'image/jpeg', data: tiny });
    share.putPhoto(opened.token, 'back', { mime: 'image/jpeg', data: tiny });
    assert.equal(share.read(opened.token)?.ready, true);
    // Desk must be able to fetch back before anyone clears the pair.
    assert.equal(share.getPhoto(opened.token, 'back')?.mime, 'image/jpeg');
    const restarted = share.restart(opened.token);
    assert.equal(restarted?.front, false);
    assert.equal(restarted?.back, false);
    assert.equal(restarted?.ready, false);
    assert.equal(share.getPhoto(opened.token, 'front'), null);
    assert.equal(share.getPhoto(opened.token, 'back'), null);
  });

  it('expires sessions and rejects bad uploads', () => {
    let clock = 1_000;
    const share = createTimesheetCaptureShare({
      now: () => clock,
      token: () => 'only',
      ttlMs: 100,
    });
    const opened = share.open();
    assert.throws(
      () => share.putPhoto(opened.token, 'side', { mime: 'image/jpeg', data: 'aa' }),
      /front or back/i
    );
    assert.throws(
      () => share.putPhoto(opened.token, 'front', { mime: 'application/pdf', data: 'aa' }),
      /JPEG|HEIC|PNG|WebP/i
    );
    clock = 1_200;
    assert.equal(share.read(opened.token), null);
    assert.equal(share.putPhoto(opened.token, 'front', { mime: 'image/jpeg', data: 'aa' }), null);
  });
});
