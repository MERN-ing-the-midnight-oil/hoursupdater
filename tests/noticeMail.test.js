import assert from 'node:assert/strict';
import test from 'node:test';
import { exampleOfficeState } from '../office-tracker/web/exampleRoutes.js';
import { sectionsForDriver } from '../office-tracker/src/driverPacket.js';
import {
  changeNoticeMail,
  fillNoticeTemplate,
  isChangeNoticeSent,
  loadSentChangeIds,
  normalizeDriverNotice,
  noticeCalendarFilename,
  noticeFromChange,
  rememberChangeNoticeSent,
} from '../office-tracker/src/noticeMail.js';
import { loadDriverNotice, saveDriverNotice } from '../office-tracker/web/store.js';

function memoryStorage() {
  /** @type {Record<string, string>} */
  const data = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
  };
}

function changeRow(driverName, routeName, asOf) {
  const built = sectionsForDriver({
    driverName,
    profiles: Object.values(exampleOfficeState().profiles),
    asOf,
  });
  const section = built.sections.find((item) => item.routeName === routeName) || built.sections[0];
  const row = [...(section.snapshot?.schedule_history || [])]
    .reverse()
    .find((item) => item.kind === 'change');
  return { section, row };
}

test('fills the notice with the driver and that one change', () => {
  const text = fillNoticeTemplate('Hi {{driver_name}} on {{ routes }}.\n{{notices}}', {
    driver_name: 'Beverly Crusher',
    routes: 'route S5',
    notices: 'Route S5: the PM change is bump eligible.',
  });
  assert.match(text, /Hi Beverly Crusher on route S5/);
  assert.match(text, /bump eligible/);
});

test('a known bid date is named in that change’s email', () => {
  const { section, row } = changeRow('Jean-Luc Picard', 'S1', '2026-09-25');
  const mail = changeNoticeMail({
    driverName: 'Jean-Luc Picard',
    routeName: 'S1',
    row,
    asOf: '2026-09-25',
    history: section.snapshot?.schedule_history || [],
  });
  assert.equal(mail.subject, 'Clock-time notice for Jean-Luc Picard');
  assert.match(mail.body, /Hi Jean-Luc Picard/);
  assert.match(mail.body, /Route S1: the PM change from Fri, Sep 18, 2026 will be up for bid on Mon, Oct 26, 2026/);
  assert.match(mail.body, /Original clock times, established/);
  assert.match(mail.body, /Changes to date on route S1:/);
  assert.match(mail.body, /AM 6:10 AM-8:40 AM/);
  assert.match(mail.body, /Midday 10:50 AM-12:05 PM/);
  assert.match(mail.body, /PM 1:50 PM-4:15 PM/);
  assert.match(mail.body, /PM changed from 1:50 PM-4:15 PM to 1:50 PM-4:30 PM/);
  assert.doesNotMatch(mail.body, /\b(?:1[3-9]|2[0-3]):\d{2}\b/);
  const originalAt = mail.body.indexOf('Original clock times');
  const changeAt = mail.body.indexOf('PM changed from');
  assert.ok(originalAt >= 0 && changeAt > originalAt);
  assert.doesNotMatch(mail.body, /attached/i);
  assert.equal(noticeCalendarFilename('John Smith'), 'JohnSmith.pdf');
  assert.equal(noticeFromChange({ driverName: 'Jean-Luc Picard', routeName: 'S1', row }).type, 'bid_eligible');
});

test('a bump that has already happened is named in that change’s email', () => {
  const built = sectionsForDriver({
    driverName: 'Beverly Crusher',
    profiles: Object.values(exampleOfficeState().profiles),
    asOf: '2026-09-25',
  });
  const match = built.sections
    .flatMap((section) =>
      (section.snapshot?.schedule_history || [])
        .filter((row) => row.kind === 'change')
        .map((row) => ({
          routeName: section.routeName,
          row,
          history: section.snapshot?.schedule_history || [],
        }))
    )
    .find(
      (item) =>
        noticeFromChange({
          driverName: 'Beverly Crusher',
          routeName: item.routeName,
          row: item.row,
        }).type === 'bump'
    );
  assert.ok(match);
  const mail = changeNoticeMail({
    driverName: 'Beverly Crusher',
    routeName: match.routeName,
    row: match.row,
    asOf: '2026-09-25',
    history: match.history,
  });
  assert.match(mail.body, /is bump eligible as of/);
  assert.match(mail.body, new RegExp(`Route ${match.routeName}`));
  assert.match(mail.body, /Original clock times, established/);
});

test('a saved driver notice replaces the opening and keeps the change list', () => {
  const storage = memoryStorage();
  const fresh = loadDriverNotice(storage);
  assert.equal(fresh.subject, 'Clock-time notice for {{driver_name}}');
  assert.equal(fresh.noticeImmediately, false);
  assert.equal(fresh.noticeBeforeContract, false);
  assert.equal(fresh.schoolDaysBefore, 1);
  const timed = saveDriverNotice(
    { noticeImmediately: 'yes', noticeBeforeContract: true, schoolDaysBefore: 4 },
    storage
  );
  assert.equal(timed.noticeImmediately, true);
  assert.equal(timed.noticeBeforeContract, true);
  assert.equal(timed.schoolDaysBefore, 4);
  const saved = saveDriverNotice(
    {
      subject: '  Times changed for {{driver_name}}  ',
      body: '{{driver_name}}, your {{routes}} changed on {{date}}.\n\n{{notices}}',
    },
    storage
  );
  assert.equal(saved.subject, 'Times changed for {{driver_name}}');
  assert.equal(loadDriverNotice(storage).body, saved.body);
  assert.equal(normalizeDriverNotice({ subject: '  ', body: '' }).subject, 'Clock-time notice for {{driver_name}}');

  const { section, row } = changeRow('Jean-Luc Picard', 'S1', '2026-09-25');
  const mail = changeNoticeMail({
    driverName: 'Jean-Luc Picard',
    routeName: 'S1',
    row,
    asOf: '2026-09-25',
    history: section.snapshot?.schedule_history || [],
    subject: saved.subject,
    body: saved.body,
  });
  assert.equal(mail.subject, 'Times changed for Jean-Luc Picard');
  assert.match(mail.body, /^Jean-Luc Picard, your route S1 changed on/);
  assert.match(mail.body, /Original clock times, established/);
  const openingAt = mail.body.indexOf('Jean-Luc Picard, your route');
  const historyAt = mail.body.indexOf('Changes to date on route S1');
  assert.ok(openingAt >= 0 && historyAt > openingAt);
});

test('sending a notice remembers that change id', () => {
  const storage = memoryStorage();
  assert.equal(isChangeNoticeSent('route-12-pm', storage), false);
  rememberChangeNoticeSent('route-12-pm', storage);
  rememberChangeNoticeSent('route-12-pm', storage);
  rememberChangeNoticeSent('route-118-pm', storage);
  assert.deepEqual(loadSentChangeIds(storage), ['route-12-pm', 'route-118-pm']);
  assert.equal(isChangeNoticeSent('route-12-pm', storage), true);
  assert.equal(isChangeNoticeSent('', storage), false);
});
