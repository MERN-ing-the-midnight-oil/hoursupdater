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

function route(name, driver, changes) {
  const start = '2026-08-31';
  const seeds = [
    ['AM', '6:10-8:40'],
    ['MIDDAY', '10:50-12:05'],
    ['PM', '13:50-16:15'],
  ].map(([segment, range], index) =>
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
  it('uses the shared 8 digit password', () => {
    assert.equal(PAGE_PASSWORD, '07041776');
    const sql = fs.readFileSync(path.join(root, 'office-tracker/supabase/schema.sql'), 'utf8');
    const start = sql.indexOf('create or replace function public.public_route_history');
    const end = sql.indexOf('grant execute on function public.public_route_history', start);
    assert.notEqual(start, -1);
    assert.ok(end > start);
    const fn = sql.slice(start, end);
    assert.match(fn, /07041776/);
    assert.doesNotMatch(fn, /punches/);
    assert.doesNotMatch(fn, /email/);
    assert.doesNotMatch(fn, /phone/);
  });

  it('shares the live link and keeps the password out of that link', () => {
    const payload = sharePayload();
    assert.equal(payload.url, undefined);
    assert.match(payload.text, new RegExp(PAGE_PASSWORD));
    assert.match(payload.text, new RegExp(PUBLISHED_SHARE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(PUBLISHED_SHARE_URL, new RegExp(PAGE_PASSWORD));
    const mail = shareMailHref();
    assert.match(mail, /^mailto:\?subject=/);
    assert.doesNotMatch(decodeURIComponent(mail), new RegExp(`[?&]pin=${PAGE_PASSWORD}`));
    assert.match(shareTextHref('Mozilla/5.0 (iPhone)'), /^sms:&body=/);
    assert.match(shareTextHref('Mozilla/5.0 (Linux; Android 14)'), /^sms:\?body=/);
  });

  it('searches drivers and routes from the office payload', () => {
    prepareCalendar(null);
    const loaded = profilesFromPayload({ profiles });
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
    assert.doesNotMatch(routeHtml, /Ada Lovelace/);
  });
});
