import assert from 'node:assert/strict';
import test from 'node:test';
import { duplicateRunRoutes, joinRunLabels, runClocksFromOriginalRoute } from '../office-tracker/src/duplicateRuns.js';

test('duplicateRunRoutes finds routes that share a run with the one just assigned', () => {
  const overlap = duplicateRunRoutes(
    [
      { id: 'a', name: '50', types: ['AM', 'PM'] },
      { id: 'b', name: '62', types: ['AM'] },
      { id: 'c', name: '70', types: ['MIDDAY'] },
    ],
    'b'
  );
  assert.deepEqual(overlap.types, ['AM']);
  assert.deepEqual(
    overlap.routes.map((route) => route.name),
    ['62', '50']
  );
  assert.deepEqual(overlap.routes[1].types, ['AM']);
});

test('duplicateRunRoutes includes every route that shares any duplicated run', () => {
  const overlap = duplicateRunRoutes(
    [
      { id: 'new', name: 'S 01', types: ['AM', 'PM'] },
      { id: 'am', name: '12', types: ['AM'] },
      { id: 'pm', name: '14', types: ['PM'] },
      { id: 'mid', name: '80', types: ['MIDDAY'] },
    ],
    'new'
  );
  assert.deepEqual(overlap.types, ['AM', 'PM']);
  assert.deepEqual(
    overlap.routes.map((route) => route.id),
    ['new', 'am', 'pm']
  );
});

test('duplicateRunRoutes stays quiet when the driver has no matching run', () => {
  assert.equal(
    duplicateRunRoutes(
      [
        { id: 'a', name: '50', types: ['AM', 'PM'] },
        { id: 'b', name: '80', types: ['MIDDAY'] },
      ],
      'b'
    ),
    null
  );
  assert.equal(
    duplicateRunRoutes([{ id: 'a', name: '50', types: ['AM', 'MIDDAY', 'PM'] }], 'a'),
    null
  );
  assert.equal(duplicateRunRoutes([{ id: 'a', name: '50', types: [] }], 'a'), null);
});

test('joinRunLabels names Midday with the other runs', () => {
  assert.equal(joinRunLabels(['AM']), 'AM');
  assert.equal(joinRunLabels(['AM', 'MIDDAY']), 'AM and Midday');
  assert.equal(joinRunLabels(['AM', 'MIDDAY', 'PM']), 'AM, Midday, and PM');
});

test('runClocksFromOriginalRoute keeps the earlier route when a run is duplicated', () => {
  const clocks = runClocksFromOriginalRoute([
    {
      name: '62',
      assignedFrom: '2026-10-09',
      clocks: { AM: '7:00', MIDDAY: '11:30' },
    },
    {
      name: '50',
      assignedFrom: '2026-08-31',
      clocks: { AM: '6:30', PM: '14:00' },
    },
  ]);
  assert.equal(clocks.AM, '6:30');
  assert.equal(clocks.PM, '14:00');
  assert.equal(clocks.MIDDAY, '11:30');
});

test('runClocksFromOriginalRoute ignores a blank clock and a missing start date', () => {
  const clocks = runClocksFromOriginalRoute([
    { name: '80', assignedFrom: '', clocks: { AM: '8:00' } },
    { name: '12', assignedFrom: '2026-09-01', clocks: { AM: '6:10', PM: '' } },
  ]);
  assert.equal(clocks.AM, '6:10');
  assert.equal(clocks.PM, undefined);
});
