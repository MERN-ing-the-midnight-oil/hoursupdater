import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { kioskRosterLayout, rosterButtonFont, clockCardRows, clockedPhrase, clockedStatusLabel, kioskLiveClock, nameButtonColors, punchDisplayClock, reasonDurationMinutes } from '../office-tracker/web/timeclockKiosk.js';

const GAP = 6;

/**
 * @param {{ columns: number, rows: number, scroll: boolean, buttonHeight: number, rowGap: number }} layout
 * @param {number} count
 * @param {number} width
 * @param {number} height
 */
function cellSize(layout, count, width, height) {
  assert.ok(layout.columns * layout.rows >= count);
  const btnW = (width - GAP * (layout.columns - 1)) / layout.columns;
  const used = layout.buttonHeight * layout.rows + layout.rowGap * (layout.rows - 1);
  assert.ok(Math.abs(used - height) < 0.6, `rows fill the screen ${used} vs ${height}`);
  return { btnW, btnH: layout.buttonHeight };
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
    assert.ok(btnW >= btnH, `landscape ${btnW} x ${btnH}`);
    assert.ok(btnH >= 40);
  });

  it('keeps a short roster landscape so names and routes stay large', () => {
    const width = 1280;
    const height = 640;
    const layout = kioskRosterLayout({ count: 14, width, height, gap: GAP, size: 'regular' });
    assert.ok(layout);
    assert.equal(layout.scroll, false);
    const { btnW, btnH } = cellSize(layout, 14, width, height);
    assert.ok(btnW > btnH, `landscape ${btnW} x ${btnH}`);
    assert.ok(btnW / btnH < 2.6, `not a thin strip ${btnW} x ${btnH}`);
    const squareColumns = 6;
    const squareRows = Math.ceil(14 / squareColumns);
    const squareW = (width - GAP * (squareColumns - 1)) / squareColumns;
    const squareH = (height - GAP * (squareRows - 1)) / squareRows;
    assert.ok(
      rosterButtonFont(btnW, btnH) > rosterButtonFont(squareW, squareH),
      'landscape type is larger than a square grid'
    );
  });

  it('keeps every name on a shorter laptop window', () => {
    const width = 1240;
    const height = 560;
    const layout = kioskRosterLayout({ count: 65, width, height, gap: GAP, size: 'large' });
    assert.ok(layout);
    assert.equal(layout.scroll, false);
    const { btnW, btnH } = cellSize(layout, 65, width, height);
    assert.ok(btnW >= 96, `width ${btnW}`);
    assert.ok(btnW >= btnH, `landscape ${btnW} x ${btnH}`);
    assert.ok(btnH >= 40, `height ${btnH}`);
  });

  it('puts extra vertical space between rows instead of stretching the buttons', () => {
    const width = 1400;
    const height = 860;
    const layout = kioskRosterLayout({ count: 8, width, height, gap: GAP, size: 'regular' });
    assert.ok(layout);
    assert.equal(layout.scroll, false);
    assert.ok(layout.rows > 1);
    const btnW = (width - GAP * (layout.columns - 1)) / layout.columns;
    const stretched = (height - GAP * (layout.rows - 1)) / layout.rows;
    assert.ok(layout.buttonHeight <= btnW / 1.7, `landscape height ${layout.buttonHeight} vs width ${btnW}`);
    assert.ok(layout.buttonHeight < stretched - 8, `not stretched ${layout.buttonHeight} vs ${stretched}`);
    assert.ok(layout.rowGap > GAP + 8, `row gap ${layout.rowGap}`);
    const used = layout.buttonHeight * layout.rows + layout.rowGap * (layout.rows - 1);
    assert.ok(Math.abs(used - height) < 0.6);
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

  it('names the route on a clock-out under the driver name', () => {
    const punchedAt = at(6, 7).toISOString();
    assert.equal(clockedStatusLabel('out', { run: 'AM', punchedAt }), 'Clocked out for AM route at 6:07 AM');
    assert.equal(
      clockedStatusLabel('out', { run: 'MIDDAY', punchedAt: at(11, 7).toISOString() }),
      'Clocked out for Mid day route at 11:07 AM'
    );
    assert.equal(clockedStatusLabel('out', { run: 'PM', punchedAt: at(14, 30).toISOString() }), 'Clocked out for PM route at 2:30 PM');
    assert.equal(clockedStatusLabel('out', { run: 'OTHER', punchedAt }), 'Clocked out for Other at 6:07 AM');
    assert.equal(clockedStatusLabel('out', { punchedAt }), 'Clocked out at 6:07 AM');
    assert.equal(clockedStatusLabel('in', { run: 'AM', punchedAt }), 'Clocked In for the AM route at 6:07 AM');
  });
});

describe('clock card rows', () => {
  it('hides midday when the driver has no midday route', () => {
    const rows = clockCardRows({ hasMidday: false, punches: [] });
    assert.deepEqual(
      rows.map((row) => row.label),
      ['PM OUT', 'PM IN', 'AM OUT', 'AM IN']
    );
    assert.equal(rows[0].label, 'PM OUT');
    assert.equal(rows.at(-1).label, 'AM IN');
  });

  it('shows midday when the driver has a midday contract', () => {
    const rows = clockCardRows({ hasMidday: true, punches: [] });
    assert.deepEqual(
      rows.map((row) => row.label),
      ['PM OUT', 'PM IN', 'MID OUT', 'MID IN', 'AM OUT', 'AM IN']
    );
  });

  it('keeps midday rows after a midday punch even without a contract', () => {
    const rows = clockCardRows({
      hasMidday: false,
      punches: [{ run: 'MIDDAY', action: 'in', punchedAt: '2026-10-15T18:00:00.000Z' }],
    });
    assert.equal(rows[0].label, 'PM OUT');
    assert.equal(rows.at(-1).label, 'AM IN');
    const midIn = rows.find((row) => row.label === 'MID IN');
    assert.equal(midIn?.punched, true);
    assert.ok(rows.some((row) => row.label === 'MID OUT' && row.punched === false));
    assert.ok(rows.findIndex((row) => row.label === 'MID OUT') < rows.findIndex((row) => row.label === 'MID IN'));
  });

  it('keeps later segments above earlier ones after a punch', () => {
    const rows = clockCardRows({
      hasMidday: false,
      punches: [
        { run: 'AM', action: 'in', punchedAt: '2026-10-15T13:12:00.000Z' },
        { run: 'AM', action: 'out', punchedAt: '2026-10-15T15:47:00.000Z' },
      ],
    });
    assert.deepEqual(
      rows.map((row) => row.label),
      ['PM OUT', 'PM IN', 'AM OUT', 'AM IN']
    );
    assert.equal(rows.find((row) => row.label === 'AM OUT')?.punched, true);
    assert.equal(rows.find((row) => row.label === 'AM IN')?.punched, true);
  });

  it('puts a punched other row under PM OUT and keeps AM IN last', () => {
    const rows = clockCardRows({
      hasMidday: false,
      punches: [
        { run: 'AM', action: 'in', punchedAt: '2026-10-15T13:12:00.000Z' },
        { run: 'OTHER', action: 'in', punchedAt: '2026-10-15T16:00:00.000Z' },
        { run: 'OTHER', action: 'out', punchedAt: '2026-10-15T18:00:00.000Z' },
      ],
    });
    assert.deepEqual(rows.map((row) => row.label).slice(0, 3), ['PM OUT', 'OTHER OUT', 'OTHER IN']);
    assert.equal(rows.at(-1).label, 'AM IN');
    assert.equal(rows.filter((row) => row.run === 'OTHER').length, 2);
  });
});

describe('reason time on a punch', () => {
  it('reads minutes for a reason, and leaves a blank field unset', () => {
    assert.deepEqual(reasonDurationMinutes('', ''), { ok: true, minutes: null });
    assert.deepEqual(reasonDurationMinutes('', '20'), { ok: true, minutes: 20 });
    assert.deepEqual(reasonDurationMinutes('', '75'), { ok: true, minutes: 75 });
    assert.deepEqual(reasonDurationMinutes('', '0'), { ok: true, minutes: 0 });
    assert.deepEqual(reasonDurationMinutes('', String(24 * 60)), { ok: true, minutes: 24 * 60 });
    assert.deepEqual(reasonDurationMinutes('', String(24 * 60 + 1)), { ok: false });
    assert.deepEqual(reasonDurationMinutes('', '1.5'), { ok: false });
    assert.deepEqual(reasonDurationMinutes('1', '15'), { ok: true, minutes: 75 });
    assert.deepEqual(reasonDurationMinutes('2', '60'), { ok: false });
    assert.equal(kioskLiveClock(new Date(2026, 9, 15, 13, 21, 8)).includes('1:21'), true);
  });
});
