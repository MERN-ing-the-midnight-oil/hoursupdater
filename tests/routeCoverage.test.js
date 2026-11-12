import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeCoverForSubstitute,
  assignRouteCoverage,
  buildCoverageBoard,
  certifyRouteCoverage,
  clearRouteCoverage,
  coverageForSubstitute,
  isRegularAbsentToday,
  normalizeRouteCoverage,
  routesCoveredBySubstitute,
} from '../src/logic/routeCoverage.js';

const day = '2026-11-12';

test('normalize keeps one assignment per date, route, and run', () => {
  const rows = normalizeRouteCoverage([
    {
      id: 'a',
      date: day,
      route_id: 'r12',
      route_name: '12',
      run: 'AM',
      substitute_id: 's1',
      substitute_name: 'Pat Lee',
      regular_driver_name: 'Alex Driver',
    },
    {
      id: 'b',
      date: day,
      route_id: 'r12',
      route_name: '12',
      run: 'am',
      substitute_id: 's2',
      substitute_name: 'Jordan Lee',
      regular_driver_name: 'Alex Driver',
    },
    { id: 'bad', date: day, route_id: 'r12', route_name: '12', run: 'OTHER', substitute_id: 's1', substitute_name: 'Pat Lee' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].substitute_name, 'Pat Lee');
  assert.equal(rows[0].run, 'AM');
});

test('assigning a substitute moves them off any other route that day', () => {
  let list = assignRouteCoverage([], {
    date: day,
    route_id: 'r12',
    route_name: '12',
    run: 'AM',
    substitute_id: 's1',
    substitute_name: 'Pat Lee',
    regular_driver_name: 'Alex Driver',
  });
  list = assignRouteCoverage(list, {
    date: day,
    route_id: 'r12',
    route_name: '12',
    run: 'PM',
    substitute_id: 's1',
    substitute_name: 'Pat Lee',
    regular_driver_name: 'Alex Driver',
  });
  list = assignRouteCoverage(list, {
    date: day,
    route_id: 'r15',
    route_name: '15',
    run: 'AM',
    substitute_id: 's1',
    substitute_name: 'Pat Lee',
    regular_driver_name: 'Sam Driver',
  });
  assert.deepEqual(
    coverageForSubstitute(list, day, 'Pat Lee').map((row) => `${row.route_name}:${row.run}`),
    ['15:AM']
  );
});

test('clear and certify coverage for a substitute route', () => {
  let list = assignRouteCoverage([], {
    date: day,
    route_id: 'r12',
    route_name: '12',
    run: 'AM',
    substitute_id: 's1',
    substitute_name: 'Pat Lee',
    regular_driver_name: 'Alex Driver',
  });
  list = assignRouteCoverage(list, {
    date: day,
    route_id: 'r12',
    route_name: '12',
    run: 'PM',
    substitute_id: 's1',
    substitute_name: 'Pat Lee',
    regular_driver_name: 'Alex Driver',
  });
  list = certifyRouteCoverage(list, { date: day, substitute_name: 'Pat Lee', route_id: 'r12' }, new Date(`${day}T15:00:00Z`));
  const covered = routesCoveredBySubstitute(list, day, 'Pat Lee');
  assert.equal(covered.length, 1);
  assert.equal(covered[0].certified, true);
  assert.deepEqual(covered[0].runs, ['AM', 'PM']);

  list = clearRouteCoverage(list, { date: day, route_id: 'r12', run: 'AM' });
  assert.deepEqual(
    coverageForSubstitute(list, day, 'Pat Lee').map((row) => row.run),
    ['PM']
  );
});

test('board marks uncovered, substitute, and regular-in pills', () => {
  const coverage = assignRouteCoverage([], {
    date: day,
    route_id: 'r12',
    route_name: '12',
    run: 'AM',
    substitute_id: 's1',
    substitute_name: 'Pat Lee',
    regular_driver_name: 'Alex Driver',
  });
  const punches = [
    {
      driver_name: 'Sam Driver',
      action: 'in',
      run: 'AM',
      punched_at: `${day}T14:05:00.000Z`,
    },
  ];
  const pills = buildCoverageBoard({
    date: day,
    coverage,
    punches,
    now: new Date(`${day}T16:00:00Z`),
    routes: [
      {
        id: 'r12',
        name: '12',
        regular_driver_name: 'Alex Driver',
        clockRuns: ['AM', 'PM'],
      },
      {
        id: 'r15',
        name: '15',
        regular_driver_name: 'Sam Driver',
        clockRuns: ['AM'],
      },
      {
        id: 'r18',
        name: '18',
        regular_driver_name: 'Riley Driver',
        clockRuns: ['AM'],
      },
    ],
  });
  assert.equal(pills.find((row) => row.route_name === '12' && row.run === 'AM').kind, 'substitute');
  assert.equal(pills.find((row) => row.route_name === '12' && row.run === 'PM').status, 'uncovered');
  assert.equal(pills.find((row) => row.route_name === '15' && row.run === 'AM').status, 'regular_in');
  assert.equal(pills.find((row) => row.route_name === '18' && row.run === 'AM').status, 'uncovered');
  assert.equal(isRegularAbsentToday('Alex Driver', coverage), true);
  assert.equal(isRegularAbsentToday('Sam Driver', coverage), false);
});

test('active cover locks a substitute already clocked in on another route', () => {
  const punches = [
    {
      driver_name: 'Alex Driver',
      substitute_name: 'Pat Lee',
      action: 'in',
      run: 'AM',
      punched_at: `${day}T14:05:00.000Z`,
    },
  ];
  const cover = activeCoverForSubstitute(punches, 'Pat Lee', new Date(`${day}T16:00:00Z`));
  assert.equal(cover.driver_name, 'Alex Driver');
  assert.equal(cover.run, 'AM');
});
