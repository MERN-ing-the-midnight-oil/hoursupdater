import assert from 'node:assert/strict';
import test from 'node:test';
import { exampleOfficeState } from '../office-tracker/web/exampleRoutes.js';
import { sectionsForDriver } from '../office-tracker/src/driverPacket.js';
import {
  changeNoticeMail,
  fillNoticeTemplate,
  isChangeNoticeSent,
  loadSentChangeIds,
  noticeCalendarFilename,
  noticeFromChange,
  rememberChangeNoticeSent,
} from '../office-tracker/src/noticeMail.js';

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
  assert.match(mail.body, /PM changed from .+ to .+/);
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
