import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  driverForTimecardName,
  fillTimecardCopyTemplate,
  timecardCopyDelivery,
  timecardCopyMail,
  timecardCopyTemplate,
} from '../office-tracker/src/timesheetCopyMail.js';
import { noticeMailto } from '../office-tracker/src/noticeMail.js';

describe('timecard copy mail', () => {
  it('matches a Last, First sticker to the driver list', () => {
    const drivers = [
      { name: 'Jean-Luc Picard', firstName: 'Jean-Luc', lastName: 'Picard', email: 'jean-luc.picard@example.com' },
      { name: 'William Riker', firstName: 'William', lastName: 'Riker', email: 'william.riker@example.com' },
    ];
    const match = driverForTimecardName(drivers, 'Picard, Jean-Luc');
    assert.equal(match?.email, 'jean-luc.picard@example.com');
    assert.equal(driverForTimecardName(drivers, 'Nobody'), null);
  });

  it('fills the saved email note and keeps the timecard table after it', () => {
    assert.equal(timecardCopyTemplate('  '), timecardCopyTemplate(''));
    assert.equal(
      fillTimecardCopyTemplate('Hello {{ first }}, this is for {{name}}.', 'Picard, Jean-Luc'),
      'Hello Jean-Luc, this is for Picard, Jean-Luc.'
    );
    assert.match(fillTimecardCopyTemplate('{{missing}}', 'Picard, Jean-Luc'), /\{\{missing\}\}/);
    const mail = timecardCopyMail({
      to: 'jean-luc.picard@example.com',
      driverName: 'Picard, Jean-Luc',
      sheetText: 'FRONT\nRun  Contract\nAM    2',
      template: 'Hi {{first}},\n\nHours for {{name}} are below.',
    });
    assert.equal(mail.to, 'jean-luc.picard@example.com');
    assert.equal(mail.subject, 'Completed timecard for Picard, Jean-Luc');
    assert.match(mail.body, /^Hi Jean-Luc,/);
    assert.match(mail.body, /Hours for Picard, Jean-Luc are below/);
    assert.match(mail.body, /FRONT/);
    assert.match(mail.body, /AM {4}2/);
  });

  it('keeps a short sheet in the draft and uses the saved note when the sheet must be pasted', () => {
    const template = 'Hi {{first}},\n\nPlease paste the timecard.';
    const short = timecardCopyDelivery({
      to: 'jean-luc.picard@example.com',
      driverName: 'Picard, Jean-Luc',
      sheetText: 'Front\nRun  Reg\nAM    2',
      template,
    });
    assert.equal(short.paste, false);
    assert.match(short.mail.body, /Please paste the timecard/);
    assert.match(short.mail.body, /AM {4}2/);
    assert.ok(noticeMailto(short.mail).length <= 1800);

    const long = timecardCopyDelivery({
      to: 'jean-luc.picard@example.com',
      driverName: 'Picard, Jean-Luc',
      sheetText: `${'Clock record row with hours and a run\n'.repeat(80)}`,
      template,
    });
    assert.equal(long.paste, true);
    assert.match(long.mail.body, /^Hi Jean-Luc,/);
    assert.match(long.mail.body, /Please paste the timecard/);
    assert.doesNotMatch(long.mail.body, /Clock record row/);
    assert.ok(noticeMailto(long.mail).length <= 1800);
  });
});
