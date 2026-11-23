import assert from 'node:assert/strict';
import test from 'node:test';
import { exampleOfficeState } from '../office-tracker/web/exampleRoutes.js';
import { sectionsForDriver } from '../office-tracker/src/driverPacket.js';
import {
  changeNoticeMail,
  fillNoticeTemplate,
  isChangeNoticeSent,
  loadSentChangeIds,
  loadSentChangeRecords,
  noticeSentLineForIds,
  memorandumById,
  memorandumMail,
  memorandumNoticeLength,
  memorandumSaveStatus,
  normalizeDriverNotice,
  noticeCcAddress,
  noticeMailto,
  noticeMailFits,
  compactMemorandumBody,
  noticeLetterEml,
  noticeLetterFilename,
  DEFAULT_OOS_NOTICE_SUBJECT,
  normalizeOutOfServiceNotice,
  outOfServiceLetterFilename,
  outOfServiceNoticeMail,
  MAILTO_SAFE_LIMIT,
  noticeCalendarFilename,
  noticeFromChange,
  routeHistoryFilename,
  routeHistoryMail,
  forgetChangeNoticesSent,
  rememberChangeNoticeSent,
  timeChangeNoticeDocument,
  timeChangeNoticeFilename,
} from '../office-tracker/src/noticeMail.js';
import { splitSegmentRange } from '../employee-tracker/src/clockTimes.js';
import { loadDriverNotice, loadOutOfServiceNotice, saveDriverNotice, saveOutOfServiceNotice } from '../office-tracker/web/store.js';

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

test('an out-of-service email names the driver, the bus, and the spare', () => {
  const mail = outOfServiceNoticeMail({
    driverName: 'Loriena Example',
    usualBus: '86',
    spareBus: '9',
    routeName: '4',
    covers: 3,
    note: 'In the shop',
    asOf: '2026-11-20',
  });
  assert.equal(mail.subject, 'Loriena Example: Bus 86 is out of service');
  assert.match(mail.body, /route 4/);
  assert.match(mail.body, /Spare bus 9 covers it for 3 days/);
  const today = outOfServiceNoticeMail({
    driverName: 'Loriena Example',
    usualBus: '86',
    spareBus: '9',
    routeName: '4',
    covers: 'today',
    asOf: '2026-11-20',
  });
  assert.match(today.body, /for today only/);
  assert.match(mail.body, /In the shop/);
  const custom = outOfServiceNoticeMail({
    subject: 'Spare {{spare_bus}} for {{driver_name}}',
    body: 'Bus {{usual_bus}} only.\n\n{{note}}',
    driverName: 'Loriena Example',
    usualBus: '86',
    spareBus: '9',
  });
  assert.equal(custom.subject, 'Spare 9 for Loriena Example');
  assert.equal(custom.body, 'Bus 86 only.\n');
  assert.equal(normalizeOutOfServiceNotice({ subject: '  ', body: '' }).subject, DEFAULT_OOS_NOTICE_SUBJECT);
  assert.equal(outOfServiceLetterFilename('11'), 'Bus11-out-of-service.eml');
  const mixed = outOfServiceNoticeMail({
    driverName: 'Loriena Example',
    usualBus: '11',
    spares: { AM: '45', MID: '', PM: '9' },
    days: { '2026-11-21': { AM: '12', MID: '', PM: '9' } },
    covers: 3,
    asOf: '2026-11-20',
  });
  assert.match(mixed.body, /Spare bus 45 covers AM/);
  assert.match(mixed.body, /MID has no spare/);
  assert.match(mixed.body, /Spare bus 9 covers PM/);
  assert.match(mixed.body, /for 3 days/);
  assert.match(mixed.body, /Some days use a different spare/);
  const storage = memoryStorage();
  saveOutOfServiceNotice({ subject: 'Bus {{usual_bus}}', body: 'Hi {{driver_name}}.' }, storage);
  assert.equal(loadOutOfServiceNotice(storage).subject, 'Bus {{usual_bus}}');
  assert.equal(loadOutOfServiceNotice(storage).body, 'Hi {{driver_name}}.');
});

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
  assert.equal(fresh.secretaryCc, '');
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
  assert.match(mail.body, /return your completed form to Jamie/);
  assert.match(mail.body, /Driver Signature:/);
  assert.match(mail.body, /Date: _+/);
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

test('a sent clock notice records who sent it and the date', () => {
  const storage = memoryStorage();
  const at = new Date(2026, 9, 3, 9, 30, 0);
  rememberChangeNoticeSent('route-12-pm', storage, {
    by: 'John Smith',
    by_user_id: 'user-1',
    at: at.toISOString(),
  });
  assert.equal(
    noticeSentLineForIds(['route-12-pm'], loadSentChangeRecords(storage)),
    'Sent By John Smith on 10/03/26'
  );
  rememberChangeNoticeSent('route-12-pm', storage);
  assert.equal(
    noticeSentLineForIds(['route-12-pm'], loadSentChangeRecords(storage)),
    'Sent By John Smith on 10/03/26'
  );
  const later = new Date(2026, 9, 4, 9, 0, 0);
  rememberChangeNoticeSent('route-12-pm', storage, { by: 'Ada Lovelace', at: later.toISOString() });
  assert.equal(
    noticeSentLineForIds(['route-12-pm', 'same-day'], loadSentChangeRecords(storage)),
    'Sent By Ada Lovelace on 10/04/26'
  );
  storage.setItem(
    'transportation-timechange.change-notice-sent.v1',
    JSON.stringify(['older-change'])
  );
  assert.equal(isChangeNoticeSent('older-change', storage), true);
  assert.equal(noticeSentLineForIds(['older-change'], loadSentChangeRecords(storage)), '');
  forgetChangeNoticesSent(['route-12-pm'], storage);
  assert.equal(isChangeNoticeSent('route-12-pm', storage), false);
  assert.equal(isChangeNoticeSent('older-change', storage), true);
});

test('a saved secretary address is copied on the driver notice', () => {
  const storage = memoryStorage();
  const saved = saveDriverNotice({ secretaryCc: '  Jamie@bps.org  ' }, storage);
  assert.equal(saved.secretaryCc, 'Jamie@bps.org');
  assert.equal(loadDriverNotice(storage).secretaryCc, 'Jamie@bps.org');
  assert.equal(normalizeDriverNotice({ secretaryCc: 'not an email' }).secretaryCc, '');
  assert.equal(noticeCcAddress('ada@bps.org', saved.secretaryCc), 'Jamie@bps.org');
  assert.equal(noticeCcAddress('Jamie@bps.org', 'jamie@bps.org'), '');

  const href = noticeMailto({
    to: 'ada@bps.org',
    cc: saved.secretaryCc,
    subject: 'Notice for Ada',
    body: 'Hello Ada\nLine two',
  });
  assert.equal(
    href,
    'mailto:ada%40bps.org?cc=Jamie%40bps.org&subject=Notice%20for%20Ada&body=Hello%20Ada%0ALine%20two'
  );
  const samePerson = noticeMailto({
    to: 'Jamie@bps.org',
    cc: 'jamie@bps.org',
    subject: 'Hi',
    body: 'There',
  });
  assert.match(samePerson, /^mailto:Jamie%40bps\.org\?subject=/);
  assert.doesNotMatch(samePerson, /[?&]cc=/);
});

test('the route-time memorandum is saved as an Outlook draft when mailto is too long', () => {
  const mail = memorandumMail({
    driverName: 'Athena Panagos',
    routeName: '42',
    row: {
      date: '2026-11-02',
      schedule: {
        AM: { clock_in: '6:15', clock_out: '8:30' },
        MIDDAY: { clock_in: '11:00', clock_out: '12:15' },
        PM: { clock_in: '14:10', clock_out: '16:40' },
      },
    },
    asOf: '2026-11-20',
  });
  const draft = {
    to: 'athena.panagos@bellinghamschools.org',
    cc: 'jamie@bellinghamschools.org',
    subject: mail.subject,
    body: mail.body,
  };
  assert.equal(noticeMailFits(draft), false);
  assert.ok(noticeMailto(draft).length > MAILTO_SAFE_LIMIT);
  const eml = noticeLetterEml(draft);
  assert.match(eml, /^To: athena\.panagos@bellinghamschools\.org\r\n/);
  assert.match(eml, /Cc: jamie@bellinghamschools\.org\r\n/);
  assert.match(eml, /X-Unsent: 1\r\n/);
  assert.match(eml, /Effective .+ your route times/);
  assert.match(eml, /return your completed form to Jamie/);
  assert.match(eml, /Driver Signature/);
  assert.equal(noticeLetterFilename('Athena Panagos'), 'AthenaPanagos-route-notice.eml');
  assert.equal(
    noticeMailFits({ to: 'ada@bps.org', subject: 'Hi', body: 'There' }),
    true
  );

  const longMail = memorandumMail({
    driverName: 'Mary-Elizabeth Montgomery',
    routeName: '142',
    row: {
      date: '2026-11-02',
      schedule: {
        AM: { clock_in: '6:15', clock_out: '8:30' },
        MIDDAY: { clock_in: '11:00', clock_out: '12:15' },
        PM: { clock_in: '14:10', clock_out: '16:40' },
      },
    },
    asOf: '2026-11-20',
  });
  const compact = compactMemorandumBody(longMail.body);
  const fitted = {
    to: 'mary.elizabeth.montgomery@bellinghamschools.org',
    cc: 'jamie.porter.transportation@bellinghamschools.org',
    subject: longMail.subject,
    body: compact,
  };
  assert.match(compact, /^FROM: Rachel Hrutfiord/);
  assert.match(compact, /Effective .+ your route times/);
  assert.match(compact, /timecard code #1/);
  assert.match(compact, /decrease is 30 minutes or more/);
  assert.match(compact, /return your completed form to Jamie/);
  assert.match(compact, /Driver Signature/);
  assert.match(compact, /Date: _+/);
  assert.doesNotMatch(compact, /Action Required|MEMORANDUM|\nTO:|\nDATE:|\nSUBJECT:/);
  assert.equal(noticeMailFits(fitted), false);
  assert.ok(noticeMailto(fitted).length > MAILTO_SAFE_LIMIT);
});

test('saving the memorandum states the letter length and warns when Outlook cannot open it', () => {
  const secretaryCc = 'jamie.porter.transportation@bellinghamschools.org';
  const usual = memorandumNoticeLength({ secretaryCc });
  const usualNote = memorandumSaveStatus(usual);
  assert.equal(usual.limit, MAILTO_SAFE_LIMIT);
  assert.equal(usualNote.kind, usual.length <= MAILTO_SAFE_LIMIT ? 'ok' : 'warn');
  assert.match(usualNote.message, new RegExp(`This letter is ${usual.length} characters`));

  const huge = memorandumNoticeLength({
    secretaryCc,
    templates: {
      'student-route-time': {
        subject: 'A long subject for {{driver_name}}',
        body: `${'Please read this extra sentence about the route change. '.repeat(40)}\n`,
      },
    },
  });
  const warn = memorandumSaveStatus(huge);
  assert.ok(huge.length > MAILTO_SAFE_LIMIT);
  assert.equal(warn.kind, 'warn');
  assert.match(warn.message, new RegExp(`This letter is ${huge.length} characters`));
  assert.match(warn.message, new RegExp(`${huge.length - MAILTO_SAFE_LIMIT} over the ${MAILTO_SAFE_LIMIT}`));
  assert.match(warn.message, /Shorten the template and save again/);
});
