import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoutesCsv, stateFromRoutesCsv } from '../office-tracker/src/routesCsv.js';

const sample = [
  'Route,Driver,Kind,Date,Run,Clock in,Clock out,Note',
  '12,Alex Driver,start,2026-09-08,AM,6:15,8:45,',
  '12,Alex Driver,start,2026-09-08,Midday,11:00,12:15,',
  '12,Alex Driver,start,2026-09-08,PM,14:10,16:40,',
  '12,Alex Driver,change,2026-10-06,AM,6:15,9:00,Fifteen minutes added',
  'P32,Jordan Lee,start,2026-09-08,AM,6:30,8:50,',
  'P32,Jordan Lee,change,2026-09-15,AM,6:20,8:50,Ten minutes added',
].join('\r\n');

describe('transportation timechange CSV', () => {
  it('loads one profile per route and restores them from a download', () => {
    const state = stateFromRoutesCsv(sample, { currentRoute: 'P32' });
    const routes = Object.values(state.profiles).sort((a, b) =>
      String(a.name).localeCompare(String(b.name), undefined, { numeric: true })
    );
    assert.deepEqual(
      routes.map((route) => route.name),
      ['12', 'P32']
    );
    assert.equal(routes[0].driver_name, 'Alex Driver');
    assert.equal(
      routes[0].changeLog.filter((row) => row.delta_minutes !== 0).length,
      1
    );
    assert.equal(state.profiles[state.currentProfileId].name, 'P32');

    const roundTrip = stateFromRoutesCsv(buildRoutesCsv(state));
    const again = Object.values(roundTrip.profiles).sort((a, b) =>
      String(a.name).localeCompare(String(b.name), undefined, { numeric: true })
    );
    assert.equal(again[0].changeLog.find((row) => row.delta_minutes).new_time, '6:15-9:00');
    assert.equal(again[1].driver_name, 'Jordan Lee');
    assert.equal(again[1].changeLog.find((row) => row.delta_minutes).delta_minutes, 10);
  });

  it('rejects a file that is not this calculator’s CSV', () => {
    assert.throws(
      () => stateFromRoutesCsv('Name,Date\nAlex,2026-09-08\n'),
      /Transportation Timechange Calculator/
    );
  });
});
