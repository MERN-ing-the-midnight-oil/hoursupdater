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

  it('stores front and back photos on a token', () => {
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

  it('publishes named cards for the phone carousel and accepts a rescan intent', () => {
    const share = createTimesheetCaptureShare({ token: () => 'carousel' });
    const opened = share.open();
    assert.deepEqual(opened.cards, []);
    assert.equal(opened.retake, null);
    const withCards = share.putCards(opened.token, [
      { id: 'session-1', name: 'Nguyen, Mai', front: true, back: true, status: 'ready' },
    ]);
    assert.equal(withCards?.cards.length, 1);
    assert.equal(withCards?.cards[0].name, 'Nguyen, Mai');
    assert.equal(withCards?.cards[0].card, 1);
    const listed = share.putCards(opened.token, [
      {
        id: 'session-1',
        name: 'Nguyen, Mai',
        employee: 'Nguyen, Mai',
        periodKey: '2026-11-15',
        periodLabel: 'Nov 15, 2026',
        card: 2,
        front: true,
        back: false,
        status: 'ready',
      },
    ]);
    assert.equal(listed?.cards[0].periodLabel, 'Nov 15, 2026');
    assert.equal(listed?.cards[0].card, 2);
    const retake = share.putRetake(opened.token, { cardId: 'session-1', side: 'front', card: 2 });
    assert.equal(retake?.retake?.cardId, 'session-1');
    assert.equal(retake?.retake?.side, 'front');
    assert.equal(retake?.retake?.card, 2);
    assert.equal(retake?.front, false);
    assert.equal(retake?.back, false);
    assert.equal(retake?.cards[0].front, true);
    const restarted = share.restart(opened.token);
    assert.equal(restarted?.retake, null);
    assert.equal(restarted?.cards[0].name, 'Nguyen, Mai');
  });

  it('lets one side be skipped and marks another card for the same driver', () => {
    const share = createTimesheetCaptureShare({ token: () => 'one-side' });
    const opened = share.open();
    assert.equal(opened.skipFront, false);
    assert.equal(opened.sameDriver, false);
    const tiny = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
    share.putPhoto(opened.token, 'front', { mime: 'image/jpeg', data: tiny });
    const skipped = share.skipSide(opened.token, 'back');
    assert.equal(skipped?.skipBack, true);
    assert.equal(skipped?.ready, true);
    assert.equal(skipped?.back, false);
    const same = share.setSameDriver(opened.token, true);
    assert.equal(same?.sameDriver, true);
    const restarted = share.restart(opened.token);
    assert.equal(restarted?.ready, false);
    assert.equal(restarted?.skipBack, false);
    assert.equal(restarted?.sameDriver, false);
    assert.equal(share.getPhoto(opened.token, 'front'), null);
  });

  it('refuses to skip both sides when no photo was taken', () => {
    const share = createTimesheetCaptureShare({ token: () => 'skip-both' });
    const opened = share.open();
    share.skipSide(opened.token, 'front');
    assert.throws(() => share.skipSide(opened.token, 'back'), /front or the back/i);
    assert.equal(share.read(opened.token)?.skipFront, true);
    assert.equal(share.read(opened.token)?.ready, false);
  });

  it('keeps a link open until the desk closes it and rejects bad uploads', () => {
    const share = createTimesheetCaptureShare({ token: () => 'only' });
    const opened = share.open();
    assert.equal(opened.expiresAt, undefined);
    assert.throws(
      () => share.putPhoto(opened.token, 'side', { mime: 'image/jpeg', data: 'aa' }),
      /front or back/i
    );
    assert.throws(
      () => share.putPhoto(opened.token, 'front', { mime: 'application/pdf', data: 'aa' }),
      /JPEG|HEIC|PNG|WebP/i
    );
    assert.equal(share.read(opened.token)?.token, 'only');
    assert.equal(share.close(opened.token), true);
    assert.equal(share.read(opened.token), null);
    assert.equal(share.putPhoto(opened.token, 'front', { mime: 'image/jpeg', data: 'aa' }), null);
  });
});
