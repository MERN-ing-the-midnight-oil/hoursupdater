import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BACK_REG_OT_SLOTS,
  FRONT_REG_OT_SLOTS,
  TEMPLATE_HEIGHT,
  TEMPLATE_WIDTH,
  templateCellPixel,
} from '../office-tracker/web/timecardPrintTemplate.js';
import { orderQuadPoints } from '../office-tracker/web/timecardQuadDetect.js';
import {
  applyHomography,
  computeHomography,
  cropRectToQuad,
  invertHomography,
  stampLabelsFromHours,
  templateQuad,
} from '../office-tracker/web/timecardWarp.js';
import { hoursFromCardRows } from '../office-tracker/web/timesheetPrintStore.js';

describe('timecard print template', () => {
  it('exposes 13 front and 15 back Reg/OT slot centers', () => {
    assert.equal(FRONT_REG_OT_SLOTS.length, 13);
    assert.equal(BACK_REG_OT_SLOTS.length, 15);
    const first = templateCellPixel('front', 0, 'reg');
    const last = templateCellPixel('front', 12, 'ot');
    assert.ok(first);
    assert.ok(last);
    assert.ok(first.y < last.y);
    assert.ok(first.x < last.x);
    assert.equal(first.x, REG_X_PIXEL());
    assert.ok(first.y > 0.15 * TEMPLATE_HEIGHT);
    assert.ok(last.y < TEMPLATE_HEIGHT);
  });
});

function REG_X_PIXEL() {
  return 0.455 * TEMPLATE_WIDTH;
}

describe('homography warp math', () => {
  it('maps a rectangle onto the template and round-trips through the inverse', () => {
    const src = cropRectToQuad(400, 640, { x: 0.1, y: 0.05, w: 0.8, h: 0.9 });
    const dst = templateQuad(TEMPLATE_WIDTH, TEMPLATE_HEIGHT);
    const forward = computeHomography(src, dst);
    assert.ok(forward);
    assert.equal(forward.length, 9);
    const tl = applyHomography(forward, src[0].x, src[0].y);
    assert.ok(Math.abs(tl.x) < 0.01);
    assert.ok(Math.abs(tl.y) < 0.01);
    const br = applyHomography(forward, src[2].x, src[2].y);
    assert.ok(Math.abs(br.x - TEMPLATE_WIDTH) < 0.05);
    assert.ok(Math.abs(br.y - TEMPLATE_HEIGHT) < 0.05);
    const inverse = invertHomography(forward);
    assert.ok(inverse);
    const midSrc = { x: (src[0].x + src[2].x) / 2, y: (src[0].y + src[2].y) / 2 };
    const midDst = applyHomography(forward, midSrc.x, midSrc.y);
    const back = applyHomography(inverse, midDst.x, midDst.y);
    assert.ok(Math.abs(back.x - midSrc.x) < 0.05);
    assert.ok(Math.abs(back.y - midSrc.y) < 0.05);
  });

  it('orders disordered corners as TL TR BR BL', () => {
    const ordered = orderQuadPoints([
      { x: 80, y: 90 },
      { x: 10, y: 12 },
      { x: 85, y: 10 },
      { x: 8, y: 95 },
    ]);
    assert.deepEqual(
      ordered.map((p) => [Math.round(p.x), Math.round(p.y)]),
      [
        [10, 12],
        [85, 10],
        [80, 90],
        [8, 95],
      ]
    );
  });
});

describe('Reg/OT stamp labels', () => {
  it('skips null and zero hours and formats the rest', () => {
    assert.deepEqual(stampLabelsFromHours(null), []);
    assert.deepEqual(
      stampLabelsFromHours([
        { reg: 1.75, ot: null },
        { reg: null, ot: 0 },
        { reg: 2, ot: 0.5 },
      ]),
      [
        { index: 0, field: 'reg', text: '1.75' },
        { index: 2, field: 'reg', text: '2' },
        { index: 2, field: 'ot', text: '0.50' },
      ]
    );
  });

  it('snapshots card rows for IndexedDB attach', () => {
    assert.deepEqual(
      hoursFromCardRows([
        { hours_regular: 1.75, hours_overtime: null },
        { written_regular: 0, hours_overtime: 2 },
        { hours_regular: null, hours_overtime: null },
      ]),
      [
        { reg: 1.75, ot: null },
        { reg: null, ot: 2 },
        { reg: null, ot: null },
      ]
    );
  });
});
