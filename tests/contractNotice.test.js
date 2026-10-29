import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBellingham2026_2027Calendar } from '../employee-tracker/src/bellinghamCalendar2026.js';
import { contractCitations } from '../public/shared/contractCitations.js';
import {
  CONTRACT_NOTICE_KINDS,
  contractNoticeMail,
  describeContractNotice,
  forgetContractNoticesSent,
  isContractNoticeSent,
  loadSentContractIds,
  loadSentContractRecords,
  normalizeContractNotice,
  rememberContractNoticesSent,
} from '../office-tracker/src/contractNotice.js';
import { isChangeNoticeSent, loadSentChangeRecords, noticeSentLineForIds } from '../office-tracker/src/noticeMail.js';
import { getSchoolDays, previousCalendarDate } from '../src/logic/calendar.js';
import { contractWindowPlan } from '../src/logic/contractWindows.js';

const { calendar } = buildBellingham2026_2027Calendar();

function schedule(pmOut = '16:00') {
  return {
    AM: { range: '6:00-8:00' },
    PM: { range: `14:00-${pmOut}` },
  };
}

function change(overrides = {}) {
  return {
    kind: 'change',
    change_id: 'change-1',
    change_ids: ['change-1'],
    date: '2026-11-02',
    cumulative_drift_minutes: 35,
    schedule: schedule('16:30'),
    contracted: {
      status: 'predicted',
      projected_outcome: 'BID_PENDING',
      becomes_on: '2026-11-20',
      label: 'Predicted up for bid',
    },
    ...overrides,
  };
}

function mailFor(described) {
  return contractNoticeMail({
    described,
    driverName: 'Ada Lovelace',
    routeName: '50',
    asOf: '2026-11-02',
  });
}

function decreaseDueOn(changeDate, drift) {
  const plan = contractWindowPlan(calendar, changeDate, drift);
  let prior = '';
  for (const day of getSchoolDays(calendar)) {
    if (day < plan.becomes_effective_on) prior = day;
    else break;
  }
  return prior;
}

test('an increase of 30 minutes quotes the bid article and does not link to it', () => {
  const described = describeContractNotice({
    row: change({
      contracted: {
        status: 'bid_pending',
        projected_outcome: 'BID_PENDING',
        becomes_on: '2026-11-30',
        label: 'Up for bid',
      },
    }),
    previousRow: { kind: 'initial', schedule: schedule() },
    calendar,
    asOf: '2026-11-30',
  });
  assert.equal(described.kind, 'bid');
  assert.equal(described.kindIcon, 'bid');
  assert.equal(described.citationId, '3.08(b)(1)');
  const mail = mailFor(described);
  assert.match(mail.subject, /will go up for bid/);
  assert.match(mail.body, /written determination that route 50 has increased/i);
  assert.match(mail.body, /Your contracted hours has changed from/);
  assert.match(mail.body, /This is an increase of 30 minutes or more/);
  assert.match(mail.body, /You are receiving a written determination of the increase and notice that the route will go up for bid/);
  assert.match(mail.body, /will go up for bid/);
  assert.match(mail.body, /Please "REPLY ALL" to this notice and write "Received" in the subject line/);
  assert.doesNotMatch(mail.body, /"Retain" or "Bump"/);
  assert.doesNotMatch(mail.body, /separate clock-time notice/);
  assert.match(mail.body, new RegExp(contractCitations['3.08(b)(1)'].text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(mail.body.includes('Art. 3.08(b)(1)'), true);
  assert.doesNotMatch(mail.body, /https?:\/\//);
  assert.doesNotMatch(mail.subject, /https?:\/\//);
});

test('a 30-minute decrease before October 1 quotes the bump article', () => {
  const described = describeContractNotice({
    row: change({
      date: '2026-09-14',
      cumulative_drift_minutes: -40,
      contracted: {
        status: 'bump_eligible',
        projected_outcome: 'BUMP_ELIGIBLE',
        becomes_on: '2026-09-14',
        label: 'Bump eligible',
      },
    }),
    previousRow: { schedule: schedule('16:30') },
    calendar,
  });
  assert.equal(described.kind, 'bump');
  assert.equal(described.kindIcon, 'bump');
  assert.equal(described.citationId, '3.08(a)(8)(b)');
  const mail = mailFor(described);
  assert.match(mail.body, /Your contracted hours has changed from/);
  assert.match(mail.body, /This is a decrease of 30 minutes or more/);
  assert.match(mail.body, /You are receiving a written determination of the decrease and notice that you may bump/);
  assert.match(mail.body, /two school days from this notification/);
  assert.match(mail.body, /bump a driver with less seniority/);
  assert.match(mail.body, /retain this route/);
  assert.match(mail.body, /Please "REPLY ALL" to this notice with "Retain" or "Bump" in the subject line/);
  assert.doesNotMatch(mail.body, /"Received"/);
  assert.match(mail.body, /3\.08\(a\)\(8\)\(b\)/);
  assert.match(mail.body, /written determination of a decrease/i);
  assert.doesNotMatch(mail.body, /https?:\/\//);
});

test('a smaller increase is left off the notice list', () => {
  const described = describeContractNotice({
    row: change({
      cumulative_drift_minutes: 15,
      contracted: {
        status: 'predicted',
        projected_outcome: 'STABLE',
        becomes_on: '2026-11-24',
        label: 'Automatically contracted',
      },
    }),
    previousRow: { schedule: schedule() },
    calendar,
  });
  assert.equal(described.skip, true);
});

test('a smaller decrease before October 1 is left off the notice list', () => {
  const described = describeContractNotice({
    row: change({
      date: '2026-09-14',
      cumulative_drift_minutes: -15,
      schedule: schedule('15:45'),
      contracted: {
        status: 'predicted',
        projected_outcome: 'STABLE',
        becomes_on: '2026-10-01',
        label: 'Automatically contracted',
      },
    }),
    previousRow: { schedule: schedule() },
    calendar,
  });
  assert.equal(described.skip, true);
});

test('a smaller decrease after October 1 is a written determination without a bump', () => {
  const due = decreaseDueOn('2026-11-02', -15);
  const described = describeContractNotice({
    row: change({
      cumulative_drift_minutes: -15,
      schedule: schedule('15:30'),
      contracted: {
        status: 'predicted',
        projected_outcome: 'STABLE',
        becomes_on: '2026-11-24',
        label: 'Automatically contracted',
      },
    }),
    previousRow: { schedule: schedule() },
    calendar,
    asOf: due,
  });
  assert.equal(described.kind, 'decrease');
  assert.equal(described.kindIcon, 'decrease');
  assert.equal(described.citationId, '3.08(b)(4)');
  const mail = mailFor(described);
  assert.match(mail.body, /written determination that route 50 has decreased/i);
  assert.match(mail.body, /Your contracted hours has changed from/);
  assert.match(mail.body, /This is a decrease under 30 minutes/);
  assert.match(mail.body, /You are receiving a written determination of the decrease and do not have the option to bump/);
  assert.match(mail.body, /do not have the option to bump/);
  assert.match(mail.body, /Please "REPLY ALL" to this notice and write "Received" in the subject line/);
  assert.match(mail.body, /workday after this written notice/);
  assert.match(mail.body, /written notice of determination/);
  assert.doesNotMatch(mail.body, /https?:\/\//);
});

test('a letter stays off the list until the day it is due to be sent', () => {
  const predictedBid = describeContractNotice({
    row: change(),
    previousRow: { schedule: schedule() },
    calendar,
    asOf: '2026-11-02',
  });
  assert.equal(predictedBid.skip, true);

  const predictedBump = describeContractNotice({
    row: change({
      cumulative_drift_minutes: -40,
      contracted: {
        status: 'predicted',
        projected_outcome: 'BUMP_ELIGIBLE',
        becomes_on: '2026-11-24',
        label: 'Predicted bump',
      },
    }),
    previousRow: { schedule: schedule('16:30') },
    calendar,
    asOf: '2026-11-02',
  });
  assert.equal(predictedBump.skip, true);

  const due = decreaseDueOn('2026-11-02', -15);
  const decreaseRow = change({
    cumulative_drift_minutes: -15,
    schedule: schedule('15:30'),
    contracted: {
      status: 'predicted',
      projected_outcome: 'STABLE',
      becomes_on: '2026-11-24',
      label: 'Automatically contracted',
    },
  });
  const before = describeContractNotice({
    row: decreaseRow,
    previousRow: { schedule: schedule() },
    calendar,
    asOf: previousCalendarDate(due),
  });
  assert.equal(before.skip, true);
  const onDue = describeContractNotice({
    row: decreaseRow,
    previousRow: { schedule: schedule() },
    calendar,
    asOf: due,
  });
  assert.equal(onDue.kind, 'decrease');
  assert.doesNotMatch(onDue.timing, /predicted result/);
});

test('unchanged contract hours are left off the notice list', () => {
  const described = describeContractNotice({
    row: change({
      cumulative_drift_minutes: 0,
      schedule: schedule(),
      contracted: { status: 'predicted', projected_outcome: null, label: 'No open window' },
    }),
    previousRow: { schedule: schedule() },
    calendar,
  });
  assert.equal(described.skip, true);
});

test('the notice templates are the three written determinations', () => {
  assert.deepEqual(
    CONTRACT_NOTICE_KINDS.map((kind) => kind.id),
    ['bid', 'bump', 'decrease']
  );
  assert.deepEqual(
    CONTRACT_NOTICE_KINDS.map((kind) => kind.icon),
    ['bid', 'bump', 'decrease']
  );
  assert.deepEqual(CONTRACT_NOTICE_KINDS.find((kind) => kind.id === 'decrease').citations, ['3.08(b)(4)']);
  for (const kind of CONTRACT_NOTICE_KINDS) {
    assert.match(kind.rationale, /Art\. 3\.08/);
    assert.match(kind.generated, /Letters appear here the day they are due to be sent/);
    assert.match(kind.generated, /Please check for letters here daily/);
  }
  const saved = normalizeContractNotice({
    templates: {
      increase: { subject: 'Old increase', body: 'Old increase body' },
      unchanged: { subject: 'Old unchanged', body: 'Old unchanged body' },
      decrease: { subject: 'Custom decrease', body: 'Custom decrease body' },
    },
  });
  assert.equal(saved.templates.increase, undefined);
  assert.equal(saved.templates.unchanged, undefined);
  assert.equal(saved.templates.decrease.subject, 'Custom decrease');
});

test('a replaced change is left off the notice list', () => {
  const described = describeContractNotice({
    row: change({
      contracted: { status: 'superseded', label: 'Replaced by a later change' },
    }),
    previousRow: { schedule: schedule() },
    calendar,
  });
  assert.equal(described.skip, true);
});

test('a saved wording is kept, and the usual wording is not stored twice', () => {
  const saved = normalizeContractNotice({
    secretaryCc: ' Jamie@bps.org ',
    templates: {
      bid: { subject: 'Custom bid subject', body: 'Custom bid body' },
      bump: { subject: '', body: '' },
    },
  });
  assert.equal(saved.secretaryCc, 'Jamie@bps.org');
  assert.equal(saved.templates.bid.subject, 'Custom bid subject');
  assert.equal(saved.templates.bump, undefined);
  const mail = contractNoticeMail({
    described: describeContractNotice({
      row: change({
        contracted: {
          status: 'bid_pending',
          projected_outcome: 'BID_PENDING',
          becomes_on: '2026-11-30',
          label: 'Up for bid',
        },
      }),
      previousRow: { schedule: schedule() },
      calendar,
      asOf: '2026-11-30',
    }),
    templates: saved.templates,
    driverName: 'Ada Lovelace',
    routeName: '50',
    asOf: '2026-11-02',
  });
  assert.equal(mail.subject, 'Custom bid subject');
  assert.match(mail.body, /Custom bid body/);
});

test('a contract notice sent mark is separate from a clock-time notice', () => {
  const storage = { store: new Map(), getItem(key) { return this.store.get(key) ?? null; }, setItem(key, value) { this.store.set(key, value); } };
  assert.equal(isContractNoticeSent('route-50', storage), false);
  rememberContractNoticesSent(['route-50', 'route-50-am'], storage);
  assert.deepEqual(loadSentContractIds(storage), ['route-50', 'route-50-am']);
  assert.equal(isContractNoticeSent('route-50', storage), true);
  assert.equal(isChangeNoticeSent('route-50', storage), false);
  const at = new Date(2026, 9, 3, 9, 30, 0);
  rememberContractNoticesSent(['route-50'], storage, { by: 'John Smith', at: at.toISOString() });
  assert.equal(
    noticeSentLineForIds(['route-50', 'route-50-am'], loadSentContractRecords(storage)),
    'Sent By John Smith on 10/03/26'
  );
  assert.equal(noticeSentLineForIds(['route-50'], loadSentChangeRecords(storage)), '');
  forgetContractNoticesSent(['route-50'], storage);
  assert.equal(isContractNoticeSent('route-50', storage), false);
  assert.equal(isContractNoticeSent('route-50-am', storage), true);
});
