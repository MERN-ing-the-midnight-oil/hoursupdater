import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDeltaMinutes } from '../src/logic/timeUtils.js';
import { EMPLOYEE_ROUTE_ID } from '../employee-tracker/src/snapshot.js';
import {
  PAGE_PASSWORD,
  PUBLISHED_SHARE_URL,
  driverHistoryHtml,
  driverSnapOptions,
  historyOptions,
  prepareCalendar,
  profilesFromPayload,
  routeHistoryHtml,
  searchHistory,
  shareMailHref,
  sharePayload,
  shareTextHref,
} from '../employee-tracker/web/publicHistory.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function route(name, driver, changes, clocks) {
  const start = '2026-08-31';
  const seeds = (clocks || [
    ['AM', '6:10-8:40'],
    ['MIDDAY', '10:50-12:05'],
    ['PM', '13:50-16:15'],
  ]).map(([segment, range], index) =>
    event(name, driver, segment, range, range, start, index, 'Starting schedule')
  );
  return {
    id: `route-${name}`,
    name,
    driver_name: driver,
    start_date: start,
    assignments: [{ driver_name: driver, from: start, until: null }],
    changeLog: [...seeds, ...changes],
  };
}

const profiles = [
  route('12', 'Ada Lovelace', [
    event('12', 'Ada Lovelace', 'AM', '6:10-8:40', '6:10-9:10', '2026-09-15', 4, 'AM runs later'),
  ]),
  route('4', 'Grace Hopper', []),
];

describe('public route history', () => {
  it('uses the shared Teamster Tools password', () => {
    assert.equal(PAGE_PASSWORD, '6111');
    const sql = fs.readFileSync(path.join(root, 'office-tracker/supabase/schema.sql'), 'utf8');
    const start = sql.indexOf('create or replace function public.public_route_history');
    const end = sql.indexOf('grant execute on function public.public_route_history', start);
    assert.notEqual(start, -1);
    assert.ok(end > start);
    const fn = sql.slice(start, end);
    assert.match(fn, /6111/);
    assert.doesNotMatch(fn, /punches/);
    assert.doesNotMatch(fn, /email/);
    assert.doesNotMatch(fn, /phone/);
  });

  it('shares the live link and keeps the password out of that link', () => {
    const payload = sharePayload();
    assert.equal(payload.url, undefined);
    assert.equal(payload.title, undefined);
    assert.equal(
      payload.text,
      `Teamster Tools\nBy Rhys- Get your real route change history, use an AI to scan your timecards, and more!\n${PUBLISHED_SHARE_URL}\nPassword: ${PAGE_PASSWORD}`
    );
    assert.doesNotMatch(PUBLISHED_SHARE_URL, new RegExp(PAGE_PASSWORD));
    const mail = shareMailHref();
    assert.match(mail, /^mailto:\?subject=/);
    assert.doesNotMatch(decodeURIComponent(mail), new RegExp(`[?&]pin=${PAGE_PASSWORD}`));
    assert.match(shareTextHref('Mozilla/5.0 (iPhone)'), /^sms:&body=/);
    assert.match(shareTextHref('Mozilla/5.0 (Linux; Android 14)'), /^sms:\?body=/);
  });

  it('lists and searches drivers and routes from the office payload', () => {
    prepareCalendar(null);
    const loaded = profilesFromPayload({ profiles });
    assert.deepEqual(
      historyOptions(loaded, { by: 'driver' }).map((item) => item.label),
      ['Ada Lovelace', 'Grace Hopper']
    );
    assert.deepEqual(
      historyOptions(loaded, { by: 'route' }).map((item) => item.label),
      ['4', '12']
    );
    assert.deepEqual(
      searchHistory(loaded, { by: 'driver', query: 'ada' }).map((item) => item.label),
      ['Ada Lovelace']
    );
    assert.deepEqual(
      searchHistory(loaded, { by: 'route', query: '4' }).map((item) => item.label),
      ['4']
    );
    assert.equal(searchHistory(loaded, { by: 'driver', query: '   ' }).length, 0);
  });

  it('shows one driver or one route, including the contracted history', () => {
    prepareCalendar(null);
    const driver = driverHistoryHtml(profiles, 'Ada Lovelace');
    assert.match(driver, /Ada Lovelace/);
    assert.match(driver, /Route 12/);
    assert.match(driver, /AM runs later/);
    assert.doesNotMatch(driver, /Grace Hopper/);

    const routeHtml = routeHistoryHtml(profiles, '4');
    assert.match(routeHtml, /Route 4/);
    assert.match(routeHtml, /Grace Hopper/);
    assert.match(routeHtml, /Clock times now/);
    assert.match(routeHtml, /What the rules say next/);
    assert.doesNotMatch(routeHtml, /Ada Lovelace/);
    assert.doesNotMatch(routeHtml, /Snap reads the clock times/);
  });

  it('states the rule result for an open count and leaves snap off that result', () => {
    prepareCalendar(null);
    const open = [
      {
        ...profiles[0],
        view_as_of: '2026-09-16',
      },
    ];
    const html = driverHistoryHtml(open, 'Ada Lovelace');
    assert.match(html, /Clock times now/);
    assert.match(html, /9:10 AM/);
    assert.match(html, /8:40 AM/);
    assert.match(html, /Contracted as of/);
    assert.match(html, /while this count is open/);
    assert.match(html, /This change is \+30 min/);
    assert.match(html, /should go up for bid/);
    assert.doesNotMatch(html, /Accepted contracted hours/);
    assert.doesNotMatch(html, /Snap reads the clock times/);
    assert.equal(driverSnapOptions(false).requireAcceptForStable, undefined);
    assert.equal(driverSnapOptions(true).requireAcceptForStable, undefined);
    assert.equal(driverSnapOptions(true).snapContractClocks, true);
    assert.equal(driverSnapOptions(true).bidBumpUseSnappedTimes, true);
  });

  it('lets a driver turn snap on and see when it changes the rule result', () => {
    prepareCalendar(null);
    const snappedRoute = route(
      '7',
      'Katherine Johnson',
      [event('7', 'Katherine Johnson', 'AM', '6:00-8:00', '6:52-8:36', '2026-09-15', 4, 'AM moved')],
      [
        ['AM', '6:00-8:00'],
        ['MIDDAY', '11:00-12:00'],
        ['PM', '14:00-16:00'],
      ]
    );
    snappedRoute.view_as_of = '2026-09-16';
    const off = driverHistoryHtml([snappedRoute], 'Katherine Johnson');
    const on = driverHistoryHtml([snappedRoute], 'Katherine Johnson', { snap: true });
    assert.match(off, /become the contracted hours/);
    assert.doesNotMatch(off, /bump-eligible/);
    assert.match(on, /bump-eligible/);
    assert.match(on, /Written clock times:/);
    assert.match(on, /Snap clock times:/);
    assert.match(on, /Snap reads the clock times/);
  });
});
