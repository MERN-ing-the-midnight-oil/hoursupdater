import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySeniorityTieResolution,
  compareDriversBySeniority,
  driversMissingHireDate,
  findUnresolvedSeniorityTies,
  getDriverSeniorityRank,
  getSeniorityOrder,
  normalizeHireDate,
  normalizeTieBreak,
} from '../src/logic/seniority.js';

describe('seniority normalize', () => {
  it('accepts valid YYYY-MM-DD hire dates', () => {
    assert.equal(normalizeHireDate('2012-08-15'), '2012-08-15');
    assert.equal(normalizeHireDate(''), null);
    assert.equal(normalizeHireDate(null), null);
  });

  it('rejects invalid hire dates', () => {
    assert.throws(() => normalizeHireDate('08/15/2012'), /YYYY-MM-DD/);
    assert.throws(() => normalizeHireDate('2012-02-30'), /calendar date/);
  });

  it('accepts positive integer tie_break only', () => {
    assert.equal(normalizeTieBreak(2), 2);
    assert.equal(normalizeTieBreak(''), null);
    assert.throws(() => normalizeTieBreak(0), /positive integer/);
    assert.throws(() => normalizeTieBreak(1.5), /positive integer/);
  });
});

describe('getSeniorityOrder', () => {
  const drivers = [
    {
      driver_id: 'c',
      name: 'Casey',
      email: null,
      hire_date: '2020-01-10',
      tie_break: null,
    },
    {
      driver_id: 'a',
      name: 'Alex',
      email: null,
      hire_date: '2015-06-01',
      tie_break: null,
    },
    {
      driver_id: 'b1',
      name: 'Blair',
      email: null,
      hire_date: '2018-09-01',
      tie_break: 2,
    },
    {
      driver_id: 'b0',
      name: 'Brooke',
      email: null,
      hire_date: '2018-09-01',
      tie_break: 1,
    },
    {
      driver_id: 'z',
      name: 'Zed',
      email: null,
      hire_date: null,
      tie_break: null,
    },
  ];

  it('orders by hire_date ascending then tie_break', () => {
    const ordered = getSeniorityOrder(drivers);
    assert.deepEqual(
      ordered.map((d) => d.driver_id),
      ['a', 'b0', 'b1', 'c', 'z']
    );
    assert.equal(ordered[0].seniority_rank, 1);
    assert.equal(ordered[3].seniority_rank, 4);
    assert.equal(ordered[4].seniority_rank, null);
    assert.equal(ordered[0].seniority_total, 4);
    assert.equal(ordered[4].missing_hire_date, true);
  });

  it('compareDriversBySeniority prefers earlier hire', () => {
    assert.ok(
      compareDriversBySeniority(drivers[1], drivers[0]) < 0
    );
  });

  it('getDriverSeniorityRank returns current rank', () => {
    const rank = getDriverSeniorityRank(drivers, 'b0');
    assert.deepEqual(rank, {
      rank: 2,
      total: 4,
      missing_hire_date: false,
    });
    assert.equal(getDriverSeniorityRank(drivers, 'z')?.rank, null);
  });

  it('driversMissingHireDate lists unranked drivers', () => {
    assert.deepEqual(
      driversMissingHireDate(drivers).map((d) => d.driver_id),
      ['z']
    );
  });
});

describe('findUnresolvedSeniorityTies', () => {
  it('flags same-date drivers without recorded tie_break', () => {
    const ties = findUnresolvedSeniorityTies([
      {
        driver_id: 'a',
        name: 'Alex',
        email: null,
        hire_date: '2018-09-01',
        tie_break: null,
      },
      {
        driver_id: 'b',
        name: 'Blair',
        email: null,
        hire_date: '2018-09-01',
        tie_break: null,
      },
      {
        driver_id: 'c',
        name: 'Casey',
        email: null,
        hire_date: '2020-01-01',
        tie_break: null,
      },
    ]);
    assert.equal(ties.length, 1);
    assert.equal(ties[0].hire_date, '2018-09-01');
    assert.deepEqual(
      ties[0].drivers.map((d) => d.driver_id),
      ['a', 'b']
    );
  });

  it('treats fully distinct tie_break values as resolved', () => {
    const ties = findUnresolvedSeniorityTies([
      {
        driver_id: 'a',
        name: 'Alex',
        email: null,
        hire_date: '2018-09-01',
        tie_break: 1,
      },
      {
        driver_id: 'b',
        name: 'Blair',
        email: null,
        hire_date: '2018-09-01',
        tie_break: 2,
      },
    ]);
    assert.deepEqual(ties, []);
  });

  it('flags duplicate or partial tie_break values', () => {
    const dupes = findUnresolvedSeniorityTies([
      {
        driver_id: 'a',
        name: 'Alex',
        email: null,
        hire_date: '2018-09-01',
        tie_break: 1,
      },
      {
        driver_id: 'b',
        name: 'Blair',
        email: null,
        hire_date: '2018-09-01',
        tie_break: 1,
      },
    ]);
    assert.equal(dupes.length, 1);

    const partial = findUnresolvedSeniorityTies([
      {
        driver_id: 'a',
        name: 'Alex',
        email: null,
        hire_date: '2018-09-01',
        tie_break: 1,
      },
      {
        driver_id: 'b',
        name: 'Blair',
        email: null,
        hire_date: '2018-09-01',
        tie_break: null,
      },
    ]);
    assert.equal(partial.length, 1);
  });
});

describe('applySeniorityTieResolution', () => {
  const drivers = [
    {
      driver_id: 'a',
      name: 'Alex',
      email: null,
      hire_date: '2018-09-01',
      tie_break: null,
    },
    {
      driver_id: 'b',
      name: 'Blair',
      email: null,
      hire_date: '2018-09-01',
      tie_break: null,
    },
    {
      driver_id: 'c',
      name: 'Casey',
      email: null,
      hire_date: '2020-01-01',
      tie_break: null,
    },
  ];

  it('assigns ascending tie_break from most-senior-first order', () => {
    const next = applySeniorityTieResolution(drivers, {
      hire_date: '2018-09-01',
      ordered_driver_ids: ['b', 'a'],
    });
    assert.equal(next.find((d) => d.driver_id === 'b')?.tie_break, 1);
    assert.equal(next.find((d) => d.driver_id === 'a')?.tie_break, 2);
    assert.equal(next.find((d) => d.driver_id === 'c')?.tie_break, null);
    assert.deepEqual(findUnresolvedSeniorityTies(next), []);
  });

  it('rejects incomplete order lists', () => {
    assert.throws(
      () =>
        applySeniorityTieResolution(drivers, {
          hire_date: '2018-09-01',
          ordered_driver_ids: ['a'],
        }),
      /all 2 drivers/
    );
  });
});
