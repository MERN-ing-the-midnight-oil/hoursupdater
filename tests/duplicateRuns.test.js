import assert from 'node:assert/strict';
import test from 'node:test';
import { duplicateRunRoutes, joinRunLabels } from '../office-tracker/src/duplicateRuns.js';

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
