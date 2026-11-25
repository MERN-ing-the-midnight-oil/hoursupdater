import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { en, fa, pa, translate } from '../employee-tracker/web/i18n.js';
import { driverHistoryHtml, prepareCalendar, sharePayload } from '../employee-tracker/web/publicHistory.js';
import { computeDeltaMinutes } from '../src/logic/timeUtils.js';
import { EMPLOYEE_ROUTE_ID } from '../employee-tracker/src/snapshot.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function markedKeys(file) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  return [...html.matchAll(/data-i18n(?:-aria|-placeholder|-alt|-title)?="([^"]+)"/g)].map((match) => match[1]);
}

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

describe('employee language copies', () => {
  it('has a Punjabi and a Persian string for every English sentence and every marked phrase', () => {
    for (const key of Object.keys(en)) {
      assert.equal(typeof pa[key], 'string', `pa ${key}`);
      assert.equal(typeof fa[key], 'string', `fa ${key}`);
      assert.ok(pa[key].trim(), `pa ${key}`);
      assert.ok(fa[key].trim(), `fa ${key}`);
    }
    const marked = [
      ...markedKeys('employee-tracker/web/index.html'),
      ...markedKeys('employee-tracker/web/clock-hours-guide.html'),
    ];
    assert.ok(marked.includes('home.history'));
    assert.ok(marked.includes('guide.lede'));
    for (const key of marked) {
      assert.equal(typeof pa[key], 'string', `pa ${key}`);
      assert.equal(typeof fa[key], 'string', `fa ${key}`);
    }
  });

  it('keeps the English share text and translates the history the driver reads', () => {
    assert.match(sharePayload().text, /^Teamster Tools\nBy Rhys-/);
    prepareCalendar(null);
    const profiles = [
      {
        id: 'route-12',
        name: '12',
        driver_name: 'Ada Lovelace',
        start_date: '2026-08-31',
        assignments: [{ driver_name: 'Ada Lovelace', from: '2026-08-31', until: null }],
        changeLog: [
          event('12', 'Ada Lovelace', 'AM', '6:10-8:40', '6:10-8:40', '2026-08-31', 1, 'Starting schedule'),
        ],
      },
    ];
    globalThis.__TEAMSTER_LANG__ = 'pa';
    try {
      const html = driverHistoryHtml(profiles, 'Ada Lovelace');
      assert.match(html, /ਘੜੀ/);
      assert.equal(translate('gate.open'), 'ਖੋਲ੍ਹੋ');
      assert.doesNotMatch(html, /Clock times now/);
    } finally {
      delete globalThis.__TEAMSTER_LANG__;
    }
    globalThis.__TEAMSTER_LANG__ = 'fa';
    try {
      const html = driverHistoryHtml(profiles, 'Ada Lovelace');
      assert.match(html, /ساعت‌های الان/);
      assert.equal(translate('gate.open'), 'باز کردن');
      assert.match(html, /31 اوت 2026/);
    } finally {
      delete globalThis.__TEAMSTER_LANG__;
    }
    const english = driverHistoryHtml(profiles, 'Ada Lovelace');
    assert.match(english, /Clock times now/);
    assert.match(english, /What the rules say next/);
  });
});
