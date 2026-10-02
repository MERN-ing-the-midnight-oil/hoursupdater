import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attributionForChange } from '../office-tracker/web/attribution.js';

describe('change attribution', () => {
  it('records the signed-in person and keeps the comment separate', () => {
    assert.deepEqual(
      attributionForChange(
        { id: 'user-1', name: 'Rachel Smith' },
        '  preschool added a stop  '
      ),
      {
        note: 'preschool added a stop',
        entered_by: 'Rachel Smith',
        entered_by_user_id: 'user-1',
      }
    );
  });

  it('leaves the person blank when nobody is signed in', () => {
    assert.deepEqual(attributionForChange(null, 'a note'), {
      note: 'a note',
      entered_by: '',
      entered_by_user_id: null,
    });
  });
});
