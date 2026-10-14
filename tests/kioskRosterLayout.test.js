import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { kioskRosterLayout, clockedPhrase, nameButtonColors, punchDisplayClock } from '../office-tracker/web/timeclockKiosk.js';

const GAP = 6;

/**
 * @param {{ columns: number, rows: number, scroll: boolean }} layout
 * @param {number} count
 * @param {number} width
 * @param {number} height
 */
function cellSize(layout, count, width, height) {
  assert.ok(layout.columns * layout.rows >= count);
  const btnW = (width - GAP * (layout.columns - 1)) / layout.columns;
  const btnH = (height - GAP * (layout.rows - 1)) / layout.rows;
  return { btnW, btnH };
}

describe('kiosk name grid', () => {
  it('fits a full driver list on a laptop without scrolling', () => {
    const width = 1400;
    const height = 780;
    const layout = kioskRosterLayout({ count: 65, width, height, gap: GAP, size: 'regular' });
    assert.ok(layout);
    assert.equal(layout.scroll, false);
    const { btnW, btnH } = cellSize(layout, 65, width, height);
    assert.ok(btnW >= 96, `width ${btnW}`);
    assert.ok(Math.max(btnW, btnH) >= 96);
    assert.ok(btnH >= 40);
  });

  it('keeps every name on a shorter laptop window', () => {
    const width = 1240;
    const height = 560;
    const layout = kioskRosterLayout({ count: 65, width, height, gap: GAP, size: 'large' });
    assert.ok(layout);
    assert.equal(layout.scroll, false);
    const { btnW, btnH } = cellSize(layout, 65, width, height);
    assert.ok(btnW >= 96, `width ${btnW}`);
    assert.ok(btnH >= 40, `height ${btnH}`);
  });

  it('uses a one-inch button and scrolls only when the screen cannot hold every name', () => {
    const layout = kioskRosterLayout({ count: 65, width: 390, height: 500, gap: GAP });
    assert.ok(layout);
    assert.equal(layout.scroll, true);
    const btnW = (390 - GAP * (layout.columns - 1)) / layout.columns;
    assert.ok(btnW >= 96, `width ${btnW}`);
  });
});

describe('timeclock name buttons', () => {
  it('gives every button its own fill and border combination', () => {
    const fills = new Set();
    const borders = new Set();
    const combos = new Set();
    for (let index = 0; index < 144; index += 1) {
      const paint = nameButtonColors(index);
      const fill = paint.background;
      const border = `${paint.look}|${paint.border}|${paint.alt}`;
      const combo = `${fill}|${border}`;
      assert.equal(fills.has(fill), false, fill);
      assert.equal(borders.has(border), false, border);
      assert.equal(combos.has(combo), false, combo);
      fills.add(fill);
      borders.add(border);
      combos.add(combo);
    }
  });
});

describe('timeclock punch clock', () => {
  const at = (hours, minutes) => new Date(2026, 9, 10, hours, minutes, 30);

  it('shows the actual minute right after a clock', () => {
    assert.equal(punchDisplayClock(at(6, 7)), '6:07 AM');
    assert.equal(punchDisplayClock(at(6, 8)), '6:08 AM');
    assert.equal(punchDisplayClock(at(18, 8)), '6:08 PM');
    assert.equal(punchDisplayClock(at(23, 53)), '11:53 PM');
  });

  it('names the route and clock-in time when a driver is clocked in', () => {
    const punchedAt = at(6, 7).toISOString();
    assert.equal(clockedPhrase('out', { run: 'AM', punchedAt }), 'is Clocked Out');
    assert.equal(clockedPhrase('in', { run: 'AM', punchedAt }), 'is Clocked In for the AM route at 6:07 AM');
    assert.equal(
      clockedPhrase('in', { run: 'MIDDAY', punchedAt: at(11, 7).toISOString() }),
      'is Clocked In for the Mid day route at 11:07 AM'
    );
    assert.equal(clockedPhrase('in', { run: 'PM', punchedAt: at(14, 30).toISOString() }), 'is Clocked In for the PM route at 2:30 PM');
    assert.equal(clockedPhrase('in', { run: 'OTHER', punchedAt }), 'is Clocked In for Other at 6:07 AM');
    assert.equal(
      clockedPhrase('in', { run: 'OTHER', work_type: 'middle-school-sports', punchedAt }),
      'is Clocked In for Middle school sports at 6:07 AM'
    );
    assert.equal(clockedPhrase('in', { punchedAt }), 'is Clocked In at 6:07 AM');
  });
});
