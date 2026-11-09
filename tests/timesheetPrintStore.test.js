import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clampPrintCrop, FULL_PRINT_CROP } from '../office-tracker/web/timesheetPrintStore.js';

describe('timecard print crops', () => {
  it('keeps a full-frame crop and clamps a drag that runs off the photo', () => {
    assert.deepEqual(clampPrintCrop(FULL_PRINT_CROP), FULL_PRINT_CROP);
    const clamped = clampPrintCrop({ x: 0.9, y: -0.2, w: 0.4, h: 0.5 });
    assert.equal(clamped.y, 0);
    assert.ok(clamped.x + clamped.w <= 1);
    assert.ok(clamped.w >= 0.02);
  });
});
