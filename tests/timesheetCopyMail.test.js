import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  driverForTimecardName,
  timecardCopyFilename,
  timecardCopyMail,
} from '../office-tracker/src/timesheetCopyMail.js';

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

  it('drafts a driver email and a download name for the timecard image', () => {
    const mail = timecardCopyMail({
      to: 'jean-luc.picard@example.com',
      driverName: 'Picard, Jean-Luc',
    });
    assert.equal(mail.to, 'jean-luc.picard@example.com');
    assert.equal(mail.subject, 'Completed timecard for Picard, Jean-Luc');
    assert.match(mail.body, /^Hi Jean-Luc,/);
    assert.match(mail.body, /completed timecard is attached/);
    assert.equal(mail.filename, 'picard-jean-luc-timecard.pdf');
    assert.equal(timecardCopyFilename(''), 'driver-timecard.pdf');
  });
});
