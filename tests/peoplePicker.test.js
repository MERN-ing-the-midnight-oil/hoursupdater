import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultPeopleHighlight,
  peopleMenuItems,
  personLabel,
} from '../employee-tracker/web/peoplePicker.js';

const people = [
  { id: 'a', name: 'Alex' },
  { id: 'j', name: 'Jordan' },
  { id: 's', name: 'Sam' },
];

describe('person picker', () => {
  it('labels a blank name as Unnamed', () => {
    assert.equal(personLabel({ name: '  ' }), 'Unnamed');
    assert.equal(personLabel({ name: 'Sam' }), 'Sam');
  });

  it('lists everyone when the query is empty', () => {
    const items = peopleMenuItems(people, '');
    assert.deepEqual(
      items.map((item) => item.label),
      ['Alex', 'Jordan', 'Sam']
    );
    assert.equal(defaultPeopleHighlight(items, '', 's'), 2);
  });

  it('filters as you type and keeps a prefix match highlighted', () => {
    const items = peopleMenuItems(people, 'jor');
    assert.deepEqual(
      items.map((item) => [item.type, item.label]),
      [
        ['person', 'Jordan'],
        ['add', 'jor'],
      ]
    );
    assert.equal(items[0].id, 'j');
    assert.equal(defaultPeopleHighlight(items, 'jor', 's'), 0);
  });

  it('offers to add a name that is not already saved', () => {
    const items = peopleMenuItems(people, 'Samson');
    assert.deepEqual(
      items.map((item) => item.type),
      ['add']
    );
    assert.equal(items[0].label, 'Samson');
    assert.equal(defaultPeopleHighlight(items, 'Samson', 's'), 0);
  });

  it('does not offer to add a name that already exists', () => {
    const items = peopleMenuItems(people, 'sam');
    assert.deepEqual(
      items.map((item) => item.type),
      ['person']
    );
    assert.equal(items[0].id, 's');
  });
});
