import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  awardPosting,
  buildWinnerEmail,
  closeDailyOfferings,
  createPosting,
  driverBoardPayload,
  driverVisiblePostings,
  publicBoardPayload,
  emptyPosting,
  formatSheetDate,
  givenName,
  notificationsForDriver,
  publishPosting,
  updatePosting,
  rosterName,
  sheetWeekday,
  splitClock,
  suggestedInitials,
  upsertBid,
} from '../src/logic/extraWorkBoard.js';
import * as sheetFormat from '../public/board/sheetFormat.js';

const NOW = '2026-10-08T15:00:00.000Z';

function sampleBoard() {
  const created = createPosting(
    { postings: [], notifications: [] },
    {
      trip_number: '19815',
      trip_date: '2026-10-10',
      school: 'SMS',
      pickup_location: 'SMS',
      leg: 'whole',
      destination: 'Nooksack HS',
      activity: 'Volleyball',
      times: {
        clock_in: '09:30',
        depart_school: '10:00',
        leave_destination: '14:45',
      },
      buses: { big: true, small: false, wc: false },
    },
    NOW
  );
  return created;
}

describe('extra work sheet fields', () => {
  it('circles Saturday for the 10/10/26 volleyball trip', () => {
    assert.equal(sheetWeekday('2026-10-10'), 'SAT');
    assert.equal(formatSheetDate('2026-10-10'), '10/10/26');
    assert.equal(sheetFormat.sheetWeekday('2026-10-10'), sheetWeekday('2026-10-10'));
    assert.equal(sheetFormat.formatSheetDate('2026-10-10'), formatSheetDate('2026-10-10'));
    assert.deepEqual(sheetFormat.splitClock('09:30'), splitClock('09:30'));
    assert.equal(sheetFormat.rosterName('Darryl Ross'), rosterName('Darryl Ross'));
    assert.equal(sheetFormat.givenName('Darryl Ross'), givenName('Darryl Ross'));
    assert.equal(sheetFormat.suggestedInitials('Darryl Ross'), suggestedInitials('Darryl Ross'));
  });

  it('writes clock times the way the marker does', () => {
    assert.deepEqual(splitClock('09:30'), { display: '9:30', meridiem: 'AM' });
    assert.deepEqual(splitClock('14:45'), { display: '2:45', meridiem: 'PM' });
    assert.deepEqual(splitClock(''), { display: '', meridiem: '' });
  });

  it('prints roster names as Last, First and stamps the given name', () => {
    assert.equal(rosterName('Darryl Ross'), 'Ross, Darryl');
    assert.equal(givenName('Darryl Ross'), 'Darryl');
    assert.equal(givenName('Ross, Darryl'), 'Darryl');
    assert.equal(suggestedInitials('Darryl Ross'), 'DR');
  });
});

describe('extra work signup and award', () => {
  it('keeps a draft off the driver board until the office posts it', () => {
    const { board, posting } = sampleBoard();
    assert.equal(posting.status, 'draft');
    assert.equal(driverVisiblePostings(board).length, 0);
    const posted = publishPosting(board, posting.id, NOW);
    assert.equal(posted.posting.status, 'posted');
    assert.equal(driverVisiblePostings(posted.board).length, 1);
    assert.equal(posted.board.notifications[0].kind, 'posted');
    assert.equal(posted.board.notifications[0].audience, 'all');
  });

  it('stores a preference with parentheses as more than one assignment', () => {
    const { board, posting } = sampleBoard();
    const posted = publishPosting(board, posting.id, NOW);
    const signed = upsertBid(
      posted.board,
      posting.id,
      { driver_id: 'darryl', initials: 'DR', preference: '(3,7)' },
      NOW
    );
    assert.equal(signed.posting.bids[0].preference, '(3,7)');
    const again = upsertBid(
      signed.board,
      posting.id,
      { driver_id: 'darryl', initials: 'DR', preference: '4' },
      NOW
    );
    assert.equal(again.posting.bids.length, 1);
    assert.equal(again.posting.bids[0].preference, '4');
    const longPreference = `(${Array.from({ length: 12 }, (_, index) => 9200 + index).join(', ')})`;
    const stored = upsertBid(
      again.board,
      posting.id,
      { driver_id: 'darryl', initials: 'DR', preference: longPreference },
      NOW
    );
    assert.equal(stored.posting.bids[0].preference, longPreference);
  });

  it('refuses a bid on a sheet that is still a draft', () => {
    const { board, posting } = sampleBoard();
    assert.throws(
      () => upsertBid(board, posting.id, { driver_id: 'darryl', initials: 'DR' }, NOW),
      /posts it/
    );
  });

  it('awards the driver who initialed and generates the office email', () => {
    const { board, posting } = sampleBoard();
    const posted = publishPosting(board, posting.id, NOW);
    const signed = upsertBid(
      posted.board,
      posting.id,
      { driver_id: 'darryl', initials: 'DR', preference: 'D64' },
      NOW
    );
    signed.board = upsertBid(
      signed.board,
      posting.id,
      { driver_id: 'becky', initials: 'BV', preference: 'B/3' },
      NOW
    ).board;
    const awarded = awardPosting(
      signed.board,
      posting.id,
      { driver_id: 'darryl', name: 'Darryl Ross', email: 'darryl@bps.k12.wa.us' },
      NOW
    );
    assert.equal(awarded.posting.status, 'awarded');
    assert.equal(awarded.posting.awarded_driver_id, 'darryl');
    assert.equal(awarded.email.can_send, true);
    assert.match(awarded.email.subject, /Trip #19815/);
    assert.match(awarded.email.body, /Hi Darryl/);
    assert.match(awarded.email.body, /Nooksack HS/);
    assert.match(awarded.email.body, /9:30 AM/);
    assert.match(awarded.email.mailto_url, /^mailto:darryl%40bps\.k12\.wa\.us/);
    const forDarryl = notificationsForDriver(awarded.board, 'darryl').map((n) => n.kind);
    const forBecky = notificationsForDriver(awarded.board, 'becky').map((n) => n.kind);
    assert.ok(forDarryl.includes('awarded'));
    assert.ok(forDarryl.includes('posted'));
    assert.equal(forDarryl.includes('passed_over'), false);
    assert.ok(forBecky.includes('passed_over'));
    assert.equal(forBecky.includes('awarded'), false);
  });

  it('still writes the email when the winner has no address on file', () => {
    const posting = {
      ...emptyPosting(NOW),
      id: 'sheet-1',
      trip_number: '19815',
      trip_date: '2026-10-10',
      destination: 'Nooksack HS',
    };
    const email = buildWinnerEmail(posting, { driver_id: 'darryl', name: 'Darryl Ross', email: null }, NOW);
    assert.equal(email.can_send, false);
    assert.match(email.disabled_reason, /No email on file/);
    assert.match(email.body, /Hi Darryl/);
    assert.equal(email.mailto_url, null);
  });

  it('keeps a roster sheet on the roster list', () => {
    const created = createPosting({ postings: [], notifications: [] }, { list: 'roster', trip_number: '1' }, NOW);
    assert.equal(created.posting.list, 'roster');
    const updated = updatePosting(created.board, created.posting.id, { trip_number: '2' }, NOW);
    assert.equal(updated.posting.list, 'roster');
    const daily = createPosting({ postings: [], notifications: [] }, { trip_number: '3' }, NOW);
    assert.equal(daily.posting.list, 'daily');
  });

  it('gives a driver their own runs and hides other preferences', () => {
    const { board, posting } = sampleBoard();
    const posted = publishPosting(board, posting.id, NOW);
    const darryl = upsertBid(
      posted.board,
      posting.id,
      { driver_id: 'darryl', initials: 'DR', preference: '(3,7)' },
      NOW
    );
    const both = upsertBid(
      darryl.board,
      posting.id,
      { driver_id: 'becky', initials: 'BV', preference: '3' },
      NOW
    );
    const roster = createPosting(
      both.board,
      { list: 'roster', trip_number: '9', trip_date: '2026-10-10', destination: 'Mt Baker' },
      NOW
    );
    const publishedRoster = publishPosting(roster.board, roster.posting.id, NOW);
    const view = driverBoardPayload(publishedRoster.board, {
      driver: { driver_id: 'darryl', name: 'Darryl Ross', seniority_rank: 33 },
      schedules: [
        { route_id: '12', driver_id: 'darryl', segments: { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' } },
        { route_id: '9', driver_id: 'becky', segments: { AM: '7:00-9:00', MIDDAY: null, PM: null } },
      ],
      list: 'daily',
    });
    assert.equal(view.drivers.length, 1);
    assert.equal(view.drivers[0].email, null);
    assert.equal(view.schedules.length, 1);
    assert.equal(view.schedules[0].route_id, '12');
    assert.equal(view.postings.length, 1);
    assert.equal(view.postings[0].id, posting.id);
    assert.equal(view.postings[0].signup_count, 2);
    assert.equal(view.postings[0].bids.length, 1);
    assert.equal(view.postings[0].bids[0].preference, '(3,7)');
    assert.equal(view.postings[0].winner_email, null);
    assert.deepEqual(view.held_work, []);
    assert.equal(JSON.stringify(view).includes('becky'), false);
    const wall = publicBoardPayload(publishedRoster.board, [
      { driver_id: 'darryl', name: 'Darryl Ross' },
      { driver_id: 'becky', name: 'Becky Vanderyacht' },
    ]);
    assert.equal(wall.postings.length, 1);
    assert.equal(wall.postings[0].signup_count, 2);
    assert.equal(wall.postings[0].bids.length, 0);
    assert.equal(wall.drivers.length, 0);
    assert.equal(JSON.stringify(wall).includes('(3,7)'), false);
    assert.equal(JSON.stringify(wall).includes('Becky'), false);
  });

  it('awards a substitute who did not initial the sheet', () => {
    const { board, posting } = sampleBoard();
    const posted = publishPosting(board, posting.id, NOW);
    const awarded = awardPosting(posted.board, posting.id, {
      driver_id: 'sub-taylor',
      name: 'Taylor Rawls',
      email: null,
      kind: 'substitute',
    });
    assert.equal(awarded.posting.status, 'awarded');
    assert.equal(awarded.posting.awarded_driver_id, 'sub-taylor');
  });

  it('will not award a driver who did not initial', () => {
    const { board, posting } = sampleBoard();
    const posted = publishPosting(board, posting.id, NOW);
    assert.throws(
      () =>
        awardPosting(posted.board, posting.id, {
          driver_id: 'darryl',
          name: 'Darryl Ross',
          email: 'darryl@bps.k12.wa.us',
        }),
      /initialed/
    );
  });
});

describe('closing a daily offering', () => {
  it('awards the senior signed-up driver and then refuses another signup', () => {
    const { board, posting } = sampleBoard();
    const posted = publishPosting(board, posting.id, NOW);
    const senior = upsertBid(
      posted.board,
      posting.id,
      { driver_id: 'senior', initials: 'SR', preference: '19815' },
      NOW
    );
    const signed = upsertBid(
      senior.board,
      posting.id,
      { driver_id: 'junior', initials: 'JR', preference: '19815' },
      NOW
    );
    const closed = closeDailyOfferings(signed.board, {
      date: '2026-10-10',
      drivers: [
        { driver_id: 'senior', name: 'Senior Driver', seniority_rank: 1, hire_date: '2012-08-15' },
        { driver_id: 'junior', name: 'Junior Driver', seniority_rank: 4, hire_date: '2016-03-14' },
      ],
      schedules: [],
      now: NOW,
    });
    const sheet = closed.board.postings.find((row) => row.id === posting.id);
    assert.equal(sheet.status, 'awarded');
    assert.equal(sheet.awarded_driver_id, 'senior');
    assert.equal(closed.awarded[0].name, 'Senior Driver');
    assert.equal(closed.board.closed_days[0].date, '2026-10-10');
    assert.throws(
      () => upsertBid(closed.board, posting.id, { driver_id: 'late', initials: 'LT', preference: '19815' }, NOW),
      /closed/
    );
  });

  it('keeps roster signup open after the morning daily close', () => {
    const created = createPosting(
      { postings: [], notifications: [], closed_days: [{ date: '2026-10-26', closed_at: NOW }] },
      {
        list: 'roster',
        trip_number: 'R2610',
        trip_date: '2026-10-26',
        school: 'Nooksack High School',
        destination: 'Lynden High School',
        activity: 'Basketball',
        times: { clock_in: '17:15', clock_out: '21:00' },
      },
      NOW
    );
    const posted = publishPosting(created.board, created.posting.id, NOW);
    const signed = upsertBid(
      posted.board,
      posted.posting.id,
      { driver_id: 'driver-david-balle', initials: 'DB', preference: 'R2610' },
      NOW
    );
    assert.equal(signed.posting.bids[0].driver_id, 'driver-david-balle');
    assert.equal(signed.posting.list, 'roster');
  });
});
