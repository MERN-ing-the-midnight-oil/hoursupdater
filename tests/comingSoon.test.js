import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeDeltaMinutes } from '../src/logic/timeUtils.js';
import { EMPLOYEE_ROUTE_ID } from '../employee-tracker/src/snapshot.js';
import { comingSoonAnnouncements, comingSoonHtml } from '../employee-tracker/web/comingSoon.js';
import { prepareCalendar } from '../employee-tracker/web/publicHistory.js';

function event(routeId, driver, segment, previous, next, date, index, note) {
  const delta = computeDeltaMinutes(previous, next);
  return {
    id: `${routeId}-${index}`,
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: driver,
    segment,
    submitted_at: `${date}T12:00:00.${String(index).padStart(3, '0')}Z`,
    effective_date: date,
    previous_time: previous,
    new_time: next,
    computed_delta_minutes: delta,
    delta_minutes: delta,
    note,
  };
}

function route(name, driver, changes, asOf) {
  const start = '2026-08-31';
  const seeds = [
    ['AM', '6:00-8:00'],
    ['MIDDAY', '11:00-12:00'],
    ['PM', '14:00-16:00'],
  ].map(([segment, range], index) =>
    event(name, driver, segment, range, range, start, index, 'Starting schedule')
  );
  return {
    id: `route-${name}`,
    name,
    driver_name: driver,
    start_date: start,
    view_as_of: asOf,
    assignments: [{ driver_name: driver, from: start, until: null }],
    changeLog: [...seeds, ...changes],
  };
}

describe('coming soon announcements', () => {
  it('lists a route the rules say should go up for bid at the end of the month', () => {
    prepareCalendar(null);
    const profile = route(
      '12',
      'Ada Lovelace',
      [event('12', 'Ada Lovelace', 'AM', '6:00-8:00', '6:00-8:40', '2026-10-06', 4, 'AM grew')],
      '2026-10-08'
    );
    const built = comingSoonAnnouncements([profile], { asOf: '2026-10-08' });
    assert.match(built.month, /October 2026/);
    assert.equal(built.items.length, 1);
    assert.equal(built.items[0].routeName, '12');
    assert.equal(built.items[0].driverName, 'Ada Lovelace');
    assert.equal(built.items[0].kind, 'bid');
    assert.equal(built.items[0].status, 'likely');
    const html = comingSoonHtml([profile], { asOf: '2026-10-08' });
    assert.match(html, /Likely up for bid/);
    assert.match(html, /Route 12/);
    assert.match(html, /Ada Lovelace/);
    assert.match(html, /should go up for bid/);
  });

  it('marks a route no longer likely after a later change takes it off the list', () => {
    prepareCalendar(null);
    const profile = route(
      '4',
      'Grace Hopper',
      [
        event('4', 'Grace Hopper', 'AM', '6:00-8:00', '6:00-8:40', '2026-10-06', 4, 'AM grew'),
        event('4', 'Grace Hopper', 'AM', '6:00-8:40', '6:00-8:00', '2026-10-08', 5, 'AM returned'),
      ],
      '2026-10-09'
    );
    const built = comingSoonAnnouncements([profile], { asOf: '2026-10-09' });
    assert.equal(built.items.length, 1);
    assert.equal(built.items[0].status, 'no_longer');
    assert.equal(built.items[0].kind, 'bid');
    const html = comingSoonHtml([profile], { asOf: '2026-10-09' });
    assert.match(html, /No longer likely/);
    assert.match(html, /took it off that list/);
    assert.doesNotMatch(html, /Likely up for bid/);
  });

  it('lists a 30-minute cut as likely bump-eligible the same month', () => {
    prepareCalendar(null);
    const profile = route(
      '8',
      'Katherine Johnson',
      [event('8', 'Katherine Johnson', 'PM', '14:00-16:00', '14:40-16:00', '2026-10-06', 4, 'PM cut')],
      '2026-10-08'
    );
    const built = comingSoonAnnouncements([profile], { asOf: '2026-10-08' });
    assert.equal(built.items.length, 1);
    assert.equal(built.items[0].kind, 'bump');
    assert.equal(built.items[0].status, 'likely');
    assert.match(comingSoonHtml([profile], { asOf: '2026-10-08' }), /Likely bump-eligible/);
  });

  it('leaves a route with no 30-minute change off the list', () => {
    prepareCalendar(null);
    const profile = route('9', 'Katherine Johnson', [], '2026-10-08');
    const built = comingSoonAnnouncements([profile], { asOf: '2026-10-08' });
    assert.equal(built.items.length, 0);
    assert.match(comingSoonHtml([profile], { asOf: '2026-10-08' }), /No routes are likely/);
  });
});
