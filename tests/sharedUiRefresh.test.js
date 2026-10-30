import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldDeferSharedUiRefresh } from '../office-tracker/src/sharedUiRefresh.js';

describe('shared UI refresh deferral for Route clock times', () => {
  it('lets a quiet screen refresh immediately', () => {
    assert.equal(shouldDeferSharedUiRefresh({}), false);
  });

  it('waits while an edit form or change dialog is open', () => {
    assert.equal(shouldDeferSharedUiRefresh({ startEditOpen: true }), true);
    assert.equal(shouldDeferSharedUiRefresh({ changeEditOpen: true }), true);
    assert.equal(shouldDeferSharedUiRefresh({ changeDialogOpen: true }), true);
  });

  it('waits while focus is inside the schedule table or editors', () => {
    assert.equal(shouldDeferSharedUiRefresh({ focusInScheduleHistory: true }), true);
    assert.equal(shouldDeferSharedUiRefresh({ focusInStartEdit: true }), true);
    assert.equal(shouldDeferSharedUiRefresh({ focusInChangeEdit: true }), true);
  });

  it('waits while the add-route setup form has focus', () => {
    assert.equal(shouldDeferSharedUiRefresh({ setupVisible: true, focusInSetup: true }), true);
    assert.equal(shouldDeferSharedUiRefresh({ setupVisible: true, focusInSetup: false }), false);
  });
});
