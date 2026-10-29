import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBellingham2026_2027Calendar } from '../employee-tracker/src/bellinghamCalendar2026.js';
import {
  biddingDriverRoster,
  driverIsSeniorTo,
  eomMonthOptions,
  eomOutsidePostingSeasonMessage,
  fillPaperBidTemplate,
  isMonthlyBidPostingMonth,
  PAPER_BID_SHEET_DEFAULTS,
  periodForMonthKey,
  renderEomBiddingPacketHtml,
  routesApproachingBid,
  routesStillOpenForBid,
  routesUpForBid,
  signupDueDate,
} from '../office-tracker/src/eomBidding.js';
import { rememberContractNoticesSent } from '../office-tracker/src/contractNotice.js';

const { calendar } = buildBellingham2026_2027Calendar();

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

test('October–April months are monthly bid posting months', () => {
  assert.equal(isMonthlyBidPostingMonth('2026-11-20'), true);
  assert.equal(isMonthlyBidPostingMonth('2026-11'), true);
  assert.equal(isMonthlyBidPostingMonth('2026-05-01'), false);
  assert.equal(isMonthlyBidPostingMonth('2026-09-15'), false);
});

test('season message warns outside October–April', () => {
  assert.match(eomOutsidePostingSeasonMessage('2026-05-10'), /May or June/);
  assert.match(eomOutsidePostingSeasonMessage('2026-09-10'), /October/);
  assert.equal(eomOutsidePostingSeasonMessage('2026-11-10'), '');
});

test('posting periods and signup due dates follow the school calendar', () => {
  const november = periodForMonthKey(calendar, '2026-11');
  assert.ok(november);
  assert.equal(november.schoolDays.length <= 5, true);
  assert.equal(november.start <= november.end, true);
  const due = signupDueDate(calendar, november.end);
  assert.match(due, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(due > november.end);
  const options = eomMonthOptions(calendar, '2026-11-20');
  assert.ok(options.some((option) => option.value === '2026-11' && option.selected));
});

test('earlier bids that are still BID_PENDING appear as still open', () => {
  const snapshots = [
    {
      profile: { id: 'r80', name: '80', driver_name: 'Tonia Mark' },
      snap: {
        window: { status: 'BID_PENDING' },
        reports: [
          {
            outcome: 'BID_PENDING',
            finalized_at: '2026-09-24T00:00:00.000Z',
            contracted_hours_delta_minutes: 60,
            see_the_math: {
              before: { payroll_rounded_total_minutes: 255 },
              after: { payroll_rounded_total_minutes: 315 },
            },
            contributing_changes: [{ id: 'old-bid' }],
          },
        ],
        schedule_history: [
          {
            kind: 'change',
            change_ids: ['old-bid'],
            date: '2026-08-31',
            cumulative_drift_minutes: 50,
            cumulative_drift_label: '+50 min',
            schedule: {
              AM: { range: '6:00-8:50' },
              PM: { range: '14:00-16:00' },
            },
            contracted: {
              status: 'bid_pending',
              projected_outcome: 'BID_PENDING',
              becomes_on: '2026-09-24',
              label: 'Window closed Thu, Sep 24, 2026 · posted for bid',
            },
          },
        ],
      },
    },
  ];
  const stillOpen = routesStillOpenForBid({
    snapshots,
    calendar,
    monthKey: '2026-10',
    asOf: '2026-10-29',
  });
  assert.equal(stillOpen.length, 1);
  assert.equal(stillOpen[0].routeName, '80');
  assert.equal(stillOpen[0].carriedOver, true);
  assert.equal(stillOpen[0].becomesOn, '2026-09-24');
});

test('finalized BID_PENDING reports still post even when history is mislabeled', () => {
  const october = periodForMonthKey(calendar, '2026-10');
  const snapshots = [
    {
      profile: { id: 's10', name: 'S 10', driver_name: 'Rhys Smoker' },
      snap: {
        contracted: { label: '4 hr 45 min', minutes: 285 },
        reports: [
          {
            outcome: 'BID_PENDING',
            finalized_at: '2026-10-28T00:00:00.000Z',
            contracted_hours_delta_minutes: 30,
            see_the_math: {
              before: { payroll_rounded_total_minutes: 255 },
              after: { payroll_rounded_total_minutes: 285 },
            },
            contributing_changes: [{ id: 'c1' }, { id: 'c2' }],
          },
        ],
        schedule_history: [
          {
            kind: 'change',
            change_ids: ['c1', 'c2', 'c3'],
            date: '2026-10-06',
            cumulative_drift_minutes: 45,
            cumulative_drift_label: '+45 min',
            schedule: {
              AM: { range: '6:35-8:40' },
              PM: { range: '14:05-17:10' },
            },
            contracted: {
              status: 'separate_countdown',
              becomes_on: '2026-10-28',
              label: 'Own countdown finished. The bid date did not move.',
            },
          },
          {
            kind: 'change',
            change_ids: ['c5'],
            date: '2026-11-02',
            cumulative_drift_minutes: 40,
            cumulative_drift_label: '+40 min',
            schedule: {
              AM: { range: '6:50-9:20' },
              PM: { range: '14:05-17:10' },
            },
            contracted: {
              status: 'predicted',
              projected_outcome: 'BID_PENDING',
              becomes_on: '2026-11-25',
              label: 'Predicted up for bid 11/25–11/30',
            },
          },
        ],
      },
    },
  ];

  const octoberRoutes = routesUpForBid({
    snapshots,
    calendar,
    monthKey: '2026-10',
    asOf: '2026-10-29',
  });
  assert.equal(octoberRoutes.length, 1);
  assert.equal(octoberRoutes[0].routeName, 'S 10');
  assert.equal(octoberRoutes[0].becomesOn, '2026-10-28');
  assert.equal(octoberRoutes[0].predicted, false);
  assert.equal(octoberRoutes[0].increaseLabel, '+30 min');
  assert.equal(octoberRoutes[0].previousHours, '4 hr 15 min');
  assert.equal(octoberRoutes[0].contractHours, '4 hr 45 min');

  const approaching = routesApproachingBid({
    snapshots,
    calendar,
    monthKey: '2026-10',
    asOf: '2026-10-29',
  });
  assert.equal(approaching.length, 1);
  assert.equal(approaching[0].becomesOn, '2026-11-25');
  assert.ok(october);
});

test('routesUpForBid keeps routes whose becomes_on falls in the month window', () => {
  const november = periodForMonthKey(calendar, '2026-11');
  const snapshots = [
    {
      profile: { id: 'r50', name: '50', driver_name: 'Ada Lovelace' },
      snap: {
        contracted: { label: '5 hr 15 min' },
        schedule_history: [
          {
            kind: 'initial',
            date: '2026-09-01',
            schedule: {
              AM: { range: '6:00-8:00' },
              PM: { range: '14:00-16:00' },
            },
          },
          {
            kind: 'change',
            change_id: 'c-bid',
            change_ids: ['c-bid'],
            date: '2026-11-02',
            cumulative_drift_minutes: 35,
            cumulative_drift_label: '+35 min',
            schedule: {
              AM: { range: '6:00-8:00' },
              PM: { range: '14:00-16:35' },
            },
            contracted: {
              status: 'bid_pending',
              projected_outcome: 'BID_PENDING',
              becomes_on: november.start,
              label: 'Up for bid',
            },
          },
        ],
      },
    },
    {
      profile: { id: 'r60', name: '60', driver_name: 'Grace Hopper' },
      snap: {
        schedule_history: [
          {
            kind: 'change',
            change_id: 'c-later',
            date: '2026-12-01',
            cumulative_drift_minutes: 40,
            schedule: {
              AM: { range: '6:00-8:00' },
              PM: { range: '14:00-16:40' },
            },
            contracted: {
              status: 'predicted',
              projected_outcome: 'BID_PENDING',
              becomes_on: '2026-12-18',
              label: 'Predicted up for bid',
            },
          },
        ],
      },
    },
  ];

  const routes = routesUpForBid({
    snapshots,
    calendar,
    monthKey: '2026-11',
    asOf: november.start,
  });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].routeName, '50');
  assert.equal(routes[0].driverName, 'Ada Lovelace');
  assert.equal(routes[0].increaseLabel, '+35 min');
  assert.ok(routes[0].signupDue);

  const approaching = routesApproachingBid({
    snapshots,
    calendar,
    monthKey: '2026-11',
    asOf: november.start,
  });
  assert.equal(approaching.length, 1);
  assert.equal(approaching[0].routeName, '60');
});

test('written determination sent flag uses contract notice storage', () => {
  const storage = memoryStorage();
  rememberContractNoticesSent(['c-bid'], storage, 'Tester');
  const november = periodForMonthKey(calendar, '2026-11');
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    const routes = routesUpForBid({
      snapshots: [
        {
          profile: { id: 'r50', name: '50', driver_name: 'Ada Lovelace' },
          snap: {
            schedule_history: [
              {
                kind: 'change',
                change_id: 'c-bid',
                change_ids: ['c-bid'],
                date: '2026-11-02',
                cumulative_drift_minutes: 35,
                schedule: {
                  AM: { range: '6:00-8:00' },
                  PM: { range: '14:00-16:35' },
                },
                contracted: {
                  status: 'bid_pending',
                  projected_outcome: 'BID_PENDING',
                  becomes_on: november.start,
                },
              },
            ],
          },
        },
      ],
      calendar,
      monthKey: '2026-11',
      asOf: november.start,
    });
    assert.equal(routes[0].bidNoticeSent, true);
  } finally {
    globalThis.localStorage = previous;
  }
});

test('driver roster ranks by seniority number and marks seniors to the holder', () => {
  const roster = biddingDriverRoster({
    state: {
      drivers: [
        { id: 'd1', name: 'Ada Lovelace', seniority_number: 2 },
        { id: 'd2', name: 'Grace Hopper', seniority_number: 1 },
        { id: 'd3', name: 'Alan Turing', seniority_number: 3 },
      ],
      profiles: {
        a: { name: '50', driver_name: 'Ada Lovelace' },
        b: { name: '60', driver_name: 'Grace Hopper' },
      },
    },
    listedDrivers: [
      { id: 'd1', name: 'Ada Lovelace' },
      { id: 'd2', name: 'Grace Hopper' },
      { id: 'd3', name: 'Alan Turing' },
    ],
    asOf: '2026-11-20',
  });
  assert.equal(roster.hasSeniorityData, true);
  assert.deepEqual(
    roster.drivers.map((driver) => driver.name),
    ['Grace Hopper', 'Ada Lovelace', 'Alan Turing']
  );
  assert.equal(roster.drivers[0].currentRoutesLabel, '60');
  assert.equal(driverIsSeniorTo('Ada Lovelace', roster.drivers[0], roster.drivers), true);
  assert.equal(driverIsSeniorTo('Ada Lovelace', roster.drivers[2], roster.drivers), false);
});

test('print packet includes cover sheet and one page per route', () => {
  const november = periodForMonthKey(calendar, '2026-11');
  const routes = [
    {
      routeName: '50',
      driverName: 'Ada Lovelace',
      previousHours: '4 hr',
      contractHours: '4 hr 45 min',
      increaseLabel: '+45 min',
      postingWindowText: '11/20–11/30',
      becomesOn: november.start,
      signupDue: signupDueDate(calendar, november.start),
      bidNoticeSent: false,
    },
  ];
  const roster = biddingDriverRoster({
    state: {
      drivers: [
        { id: 'd1', name: 'Ada Lovelace', seniority_number: 2 },
        { id: 'd2', name: 'Grace Hopper', seniority_number: 1 },
      ],
      profiles: { a: { name: '50', driver_name: 'Ada Lovelace' } },
    },
    listedDrivers: [
      { id: 'd1', name: 'Ada Lovelace' },
      { id: 'd2', name: 'Grace Hopper' },
    ],
    asOf: november.start,
  });
  const html = renderEomBiddingPacketHtml({
    monthKey: '2026-11',
    period: november,
    calendar,
    routes,
    roster,
    paperBidSheet: PAPER_BID_SHEET_DEFAULTS,
    asOf: november.start,
  });
  assert.match(html, /End of Month Bidding/);
  assert.match(html, /Driver acknowledgment/);
  assert.match(html, /Route 50/);
  assert.match(html, /is-senior-bidder/);
  assert.match(html, /may not bid back/);
  assert.match(html, /Art\. 3\.08\(c\)\(1\)/);
  assert.match(html, /Sign-up closes after two \(2\) school days/);
  assert.equal(
    fillPaperBidTemplate('due {{bid_response_due_date}}', { bid_response_due_date: '11/24/2026' }),
    'due 11/24/2026'
  );
});
