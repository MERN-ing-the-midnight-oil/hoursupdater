import assert from 'node:assert/strict';
import test from 'node:test';
import { exampleOfficeState } from '../office-tracker/web/exampleRoutes.js';
import { sectionsForDriver } from '../office-tracker/src/driverPacket.js';
import {
  changeNoticeMail,
  fillNoticeTemplate,
  isChangeNoticeSent,
  loadSentChangeIds,
  memorandumById,
  memorandumMail,
  normalizeDriverNotice,
  noticeCalendarFilename,
  noticeFromChange,
  routeHistoryFilename,
  routeHistoryMail,
  rememberChangeNoticeSent,
  timeChangeNoticeDocument,
  timeChangeNoticeFilename,
} from '../office-tracker/src/noticeMail.js';
import { splitSegmentRange } from '../employee-tracker/src/clockTimes.js';
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
  const changeAt = mail.body.indexOf('PM changed from', originalAt);
  assert.ok(originalAt >= 0 && changeAt > originalAt);
  assert.doesNotMatch(mail.body, /attached/i);
  assert.equal(noticeCalendarFilename('John Smith'), 'JohnSmith.pdf');
  assert.equal(timeChangeNoticeFilename('John Smith'), 'JohnSmith-time-change-notice.pdf');
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
  assert.equal(fresh.memorandumId, 'student-route-time');
  assert.deepEqual(fresh.memorandumTemplates, {});
  assert.equal(fresh.attachTimeChangeNotice, false);
  assert.equal(Object.hasOwn(fresh, 'noticeImmediately'), false);
  assert.equal(Object.hasOwn(fresh, 'noticeBeforeContract'), false);
  assert.equal(Object.hasOwn(fresh, 'schoolDaysBefore'), false);
  const saved = saveDriverNotice(
    {
      subject: '  Times changed for {{driver_name}}  ',
      body: '{{driver_name}}, your {{routes}} changed on {{date}}.\n\n{{notices}}',
    },
    storage
  );
  assert.equal(saved.subject, 'Times changed for {{driver_name}}');
  assert.equal(saved.memorandumId, 'student-route-time');
  assert.equal(saved.attachTimeChangeNotice, false);
  assert.equal(loadDriverNotice(storage).body, saved.body);
  assert.equal(normalizeDriverNotice({ subject: '  ', body: '' }).subject, 'Clock-time notice for {{driver_name}}');
  const chosen = normalizeDriverNotice({
    memorandumId: 'not-a-memorandum',
    attachTimeChangeNotice: 'yes',
  });
  assert.equal(chosen.memorandumId, 'student-route-time');
  assert.equal(chosen.attachTimeChangeNotice, true);
  assert.equal(memorandumById('not-a-memorandum').id, 'student-route-time');

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
  const attachment = timeChangeNoticeDocument({
    driverName: 'Jean-Luc Picard',
    routeName: 'S1',
    row,
    asOf: '2026-09-25',
    history: section.snapshot?.schedule_history || [],
    subject: saved.subject,
    body: saved.body,
  });
  assert.equal(attachment.filename, 'JeanLucPicard-time-change-notice.pdf');
  assert.match(attachment.text, /^Times changed for Jean-Luc Picard/);
  assert.match(attachment.text, /Original clock times, established/);
});

test('the email is the student route-time memorandum', () => {
  const { section, row } = changeRow('Jean-Luc Picard', 'S1', '2026-09-25');
  assert.ok(section);
  const mail = memorandumMail({
    driverName: 'Jean-Luc Picard',
    routeName: 'S1',
    row,
    asOf: '2026-09-25',
  });
  assert.equal(
    mail.subject,
    'Jean-Luc Picard: Route Time Changes due to added student(s) or loss of student(s) on or after October 1'
  );
  assert.match(mail.body, /^Action Required/);
  assert.match(mail.body, /MEMORANDUM/);
  assert.match(mail.body, /TO: Jean-Luc Picard/);
  assert.match(mail.body, /FROM: Rachel Hrutfiord, Transportation Director/);
  assert.match(mail.body, /DATE: Fri, Sep 25, 2026/);
  assert.match(
    mail.body,
    /SUBJECT: Route Time Changes due to added student\(s\) or loss of student\(s\) on or after October 1/
  );
  assert.match(
    mail.body,
    /Effective Fri, Sep 18, 2026 your route times \(punch-in and punch-out time\) will be: route S1, AM punch-in 6:10 AM, punch-out 8:55 AM; Midday punch-in 10:50 AM, punch-out 12:05 PM; PM punch-in 1:50 PM, punch-out 4:30 PM/
  );
  assert.match(mail.body, /timecard code #1/);
  assert.match(mail.body, /Driver Signature:/);
  assert.doesNotMatch(mail.body, /Changes to date/);
  assert.doesNotMatch(mail.body, /Original clock times/);
  assert.doesNotMatch(mail.body, /Hi Jean-Luc Picard/);
});

test('a saved template replaces that memorandum and the usual wording stays put', () => {
  const usual = memorandumById('student-route-time');
  const untouched = normalizeDriverNotice({
    memorandumTemplates: {
      'student-route-time': { subject: ` ${usual.subject} `, body: usual.body },
      missing: { subject: 'Ignore', body: 'Ignore' },
    },
  });
  assert.deepEqual(untouched.memorandumTemplates, {});

  const storage = memoryStorage();
  const saved = saveDriverNotice(
    {
      memorandumTemplates: {
        'student-route-time': {
          subject: '  Notice for {{driver_name}}  ',
          body: '   ',
        },
      },
    },
    storage
  );
  assert.equal(saved.memorandumTemplates['student-route-time'].subject, 'Notice for {{driver_name}}');
  assert.equal(saved.memorandumTemplates['student-route-time'].body, usual.body.trim());

  const { row } = changeRow('Jean-Luc Picard', 'S1', '2026-09-25');
  const mail = memorandumMail({
    memorandumId: saved.memorandumId,
    templates: saved.memorandumTemplates,
    driverName: 'Jean-Luc Picard',
    routeName: 'S1',
    row,
    asOf: '2026-09-25',
  });
  assert.equal(mail.subject, 'Notice for Jean-Luc Picard');
  assert.match(mail.body, /TO: Jean-Luc Picard/);
  assert.match(mail.body, /Effective Fri, Sep 18, 2026/);

  const rewritten = memorandumMail({
    memorandumId: 'student-route-time',
    templates: {
      'student-route-time': {
        subject: 'Hello {{driver_name}}',
        body: 'Custom note for {{driver_name}} on {{effective_date}}. {{route_times}}',
      },
    },
    driverName: 'Jean-Luc Picard',
    routeName: 'S1',
    row,
    asOf: '2026-09-25',
  });
  assert.equal(rewritten.subject, 'Hello Jean-Luc Picard');
  assert.match(rewritten.body, /^Custom note for Jean-Luc Picard on Fri, Sep 18, 2026\. route S1,/);
  assert.doesNotMatch(rewritten.body, /MEMORANDUM/);
});

test('a route history email is the full clock-time history for that route', () => {
  const { section } = changeRow('Jean-Luc Picard', 'S1', '2026-09-25');
  const mail = routeHistoryMail({
    driverName: 'William Riker',
    routeName: 'S1',
    history: section.snapshot?.schedule_history || [],
  });
  assert.equal(mail.subject, 'Route clock-time history for route S1');
  assert.match(mail.body, /^Hi William Riker/);
  assert.match(mail.body, /Changes to date on route S1:/);
  assert.match(mail.body, /Original clock times, established/);
  assert.match(mail.body, /PM changed from/);
  assert.equal(routeHistoryFilename('D 03'), 'RouteD03-clock-history.pdf');
});

function clocks(am, pm) {
  return {
    AM: am ? splitSegmentRange(am) : null,
    MIDDAY: null,
    PM: pm ? splitSegmentRange(pm) : null,
  };
}

test('a notice separates a longer run from a shorter one when dates were left blank', () => {
  const history = [
    {
      kind: 'initial',
      date: '2026-08-31',
      schedule: clocks('7:10-8:30', '13:35-15:35'),
    },
    {
      kind: 'change',
      date: null,
      segment: null,
      segments: ['AM', 'PM'],
      previous_time: '13:35-15:35',
      new_time: '13:35-17:30',
      note: 'POST',
      schedule: clocks('7:10-9:25', '13:35-17:30'),
    },
    {
      kind: 'change',
      date: null,
      segment: 'AM',
      previous_time: '7:10-9:25',
      new_time: '7:10-8:40',
      note: '',
      schedule: clocks('7:10-8:40', '13:35-17:30'),
      contracted: {
        status: 'bid_pending',
        becomes_on: '2026-09-29',
        label: 'Posted for bid',
      },
    },
  ];
  const mail = changeNoticeMail({
    driverName: 'Charlie Lane',
    routeName: 'S 20',
    row: history[2],
    history,
  });
  assert.match(
    mail.body,
    /Route S 20: the AM change, date not recorded, is posted for bid as of Tue, Sep 29, 2026\. AM changed from 7:10 AM-9:25 AM to 7:10 AM-8:40 AM, 45 min shorter\./
  );
  assert.match(mail.body, /These runs were entered together:/);
  assert.match(
    mail.body,
    /AM changed from 7:10 AM-8:30 AM to 7:10 AM-9:25 AM, 55 min longer\./
  );
  assert.match(
    mail.body,
    /PM changed from 1:35 PM-3:35 PM to 1:35 PM-5:30 PM, 1 hr 55 min longer\./
  );
  assert.match(mail.body, /POST/);
  assert.match(
    mail.body,
    /Date not recorded\. AM changed from 7:10 AM-9:25 AM to 7:10 AM-8:40 AM, 45 min shorter\./
  );
  assert.match(mail.body, /not known to be the same day/);
  assert.doesNotMatch(mail.body, /from —/);
  assert.doesNotMatch(mail.body, /Clock time changed/);
});

test('changes that share a recorded date say they are the same day', () => {
  const history = [
    {
      kind: 'initial',
      date: '2026-08-31',
      schedule: clocks('7:10-8:30', '13:35-15:35'),
    },
    {
      kind: 'change',
      date: '2026-09-29',
      segment: 'PM',
      schedule: clocks('7:10-8:30', '13:35-17:30'),
    },
    {
      kind: 'change',
      date: '2026-09-29',
      segment: 'AM',
      schedule: clocks('7:10-8:40', '13:35-17:30'),
    },
  ];
  const mail = routeHistoryMail({
    driverName: 'Charlie Lane',
    routeName: 'S 20',
    history,
  });
  assert.match(mail.body, /Tue, Sep 29, 2026\. PM changed from/);
  assert.match(mail.body, /Tue, Sep 29, 2026, same day as the change above\. AM changed from/);
  assert.doesNotMatch(mail.body, /Date not recorded/);
  assert.doesNotMatch(mail.body, /entered together/);
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
