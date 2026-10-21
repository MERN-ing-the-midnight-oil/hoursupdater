import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { kioskRosterLayout, rosterButtonFont, clockCardPeriods, clockCardRows, extraTrackVisibleHeight, clockMoveTargets, clockedPhrase, clockedStatusLabel, kioskLiveClock, movePunchToRow, nameButtonColors, periodNoteText, periodReasonCodes, applyPeriodNote, punchDisplayClock, punchDisplayDay, reasonDurationMinutes } from '../office-tracker/web/timeclockKiosk.js';

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

  it('puts the weekday and short date under a punch time', () => {
    assert.equal(punchDisplayDay(new Date(2026, 9, 16, 7, 22)), 'FRI 10/16/26');
    assert.equal(punchDisplayDay(new Date(2026, 9, 22, 7, 22)), 'THU 10/22/26');
    assert.equal(punchDisplayDay(new Date(2026, 0, 5, 7, 22)), 'MON 1/5/26');
    assert.equal(punchDisplayDay(new Date(NaN)), '');
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
      ['EXTRA OUT', 'EXTRA IN', 'PM OUT', 'PM IN', 'AM OUT', 'AM IN']
    );
    assert.equal(rows[0].extra, true);
    assert.equal(rows[1].extra, true);
    assert.equal(rows[1].punched, false);
    assert.equal(rows[2].label, 'PM OUT');
    assert.equal(rows.at(-1).label, 'AM IN');
  });

  it('shows midday when the driver has a midday contract', () => {
    const rows = clockCardRows({ hasMidday: true, punches: [] });
    assert.deepEqual(
      rows.map((row) => row.label),
      ['EXTRA OUT', 'EXTRA IN', 'PM OUT', 'PM IN', 'MID OUT', 'MID IN', 'AM OUT', 'AM IN']
    );
  });

  it('keeps midday rows after a midday punch even without a contract', () => {
    const rows = clockCardRows({
      hasMidday: false,
      punches: [{ run: 'MIDDAY', action: 'in', punchedAt: '2026-10-15T18:00:00.000Z' }],
    });
    assert.equal(rows[0].label, 'EXTRA OUT');
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
      ['EXTRA OUT', 'EXTRA IN', 'PM OUT', 'PM IN', 'AM OUT', 'AM IN']
    );
    assert.equal(rows.find((row) => row.label === 'AM OUT')?.punched, true);
    assert.equal(rows.find((row) => row.label === 'AM IN')?.punched, true);
  });

  it('keeps extra rows above PM OUT and keeps AM IN last', () => {
    const rows = clockCardRows({
      hasMidday: false,
      punches: [
        { run: 'AM', action: 'in', punchedAt: '2026-10-15T13:12:00.000Z' },
        { run: 'OTHER', action: 'in', punchedAt: '2026-10-15T16:00:00.000Z' },
        { run: 'OTHER', action: 'out', punchedAt: '2026-10-15T18:00:00.000Z' },
      ],
    });
    assert.deepEqual(rows.map((row) => row.label).slice(0, 6), [
      'EXTRA OUT',
      'EXTRA IN',
      'EXTRA OUT',
      'EXTRA IN',
      'PM OUT',
      'PM IN',
    ]);
    assert.equal(rows[0].punched, false);
    assert.equal(rows[0].extraIndex, 2);
    assert.equal(rows[2].punched, true);
    assert.equal(rows[2].extraIndex, 1);
    assert.equal(rows[3].punched, true);
    assert.equal(rows.at(-1).label, 'AM IN');
    assert.equal(rows.filter((row) => row.run === 'OTHER').length, 4);
  });

  it('adds another extra period after an extra clock in', () => {
    const rows = clockCardRows({
      hasMidday: false,
      punches: [{ run: 'OTHER', action: 'in', punchedAt: '2026-10-15T16:00:00.000Z' }],
    });
    const extra = rows.filter((row) => row.extra);
    assert.deepEqual(
      extra.map((row) => `${row.extraIndex} ${row.label} ${row.punched}`),
      ['2 EXTRA OUT false', '2 EXTRA IN false', '1 EXTRA OUT false', '1 EXTRA IN true']
    );
  });

  it('does not add an extra period for an extra clock out alone', () => {
    const rows = clockCardRows({
      hasMidday: false,
      punches: [{ run: 'OTHER', action: 'out', punchedAt: '2026-10-15T18:00:00.000Z' }],
    });
    assert.equal(rows.filter((row) => row.extra).length, 2);
    assert.equal(rows.find((row) => row.action === 'out' && row.extra)?.punched, true);
    assert.equal(rows.find((row) => row.action === 'in' && row.extra)?.punched, false);
  });

  it('adds a fresh extra period after each extra clock in', () => {
    const rows = clockCardRows({
      hasMidday: false,
      punches: [
        { run: 'OTHER', action: 'in', punchedAt: '2026-10-15T16:00:00.000Z', extra_index: 1 },
        { run: 'OTHER', action: 'out', punchedAt: '2026-10-15T17:00:00.000Z', extra_index: 1 },
        { run: 'OTHER', action: 'in', punchedAt: '2026-10-15T18:00:00.000Z', extra_index: 2 },
      ],
    });
    const extra = rows.filter((row) => row.extra);
    assert.deepEqual(
      extra.map((row) => row.extraIndex),
      [3, 3, 2, 2, 1, 1]
    );
    assert.equal(extra[0].punched, false);
    assert.equal(extra.find((row) => row.extraIndex === 2 && row.action === 'in')?.punched, true);
    assert.equal(extra.find((row) => row.extraIndex === 1 && row.action === 'out')?.punched, true);
  });
});

describe('extra row carousel', () => {
  it('shows a whole extra period on one advance', () => {
    assert.equal(extraTrackVisibleHeight([0], 220, 0), 0);
    assert.equal(extraTrackVisibleHeight([0], 220, 1), 220);
    assert.equal(extraTrackVisibleHeight([0, 220], 440, 1), 220);
    assert.equal(extraTrackVisibleHeight([0, 220], 440, 2), 440);
  });
});

describe('clock card periods', () => {
  it('keeps each route’s clock in and clock out in one period', () => {
    const rows = clockCardRows({
      hasMidday: true,
      punches: [
        { run: 'OTHER', action: 'out', punchedAt: '2026-10-15T18:00:00.000Z' },
        { run: 'OTHER', action: 'in', punchedAt: '2026-10-15T16:00:00.000Z' },
      ],
    });
    const periods = clockCardPeriods(rows);
    assert.deepEqual(
      periods.map((period) => period.period),
      ['OTHER:2', 'OTHER', 'PM', 'MIDDAY', 'AM']
    );
    assert.deepEqual(
      periods.find((period) => period.run === 'PM').rows.map((row) => row.label),
      ['PM OUT', 'PM IN']
    );
    assert.deepEqual(
      periods.find((period) => period.run === 'AM').rows.map((row) => row.label),
      ['AM OUT', 'AM IN']
    );
    assert.deepEqual(
      periods.find((period) => period.period === 'OTHER').rows.map((row) => row.label),
      ['EXTRA OUT', 'EXTRA IN']
    );
    assert.equal(
      periods.find((period) => period.period === 'OTHER:2').rows.every((row) => row.punched === false),
      true
    );
  });

  it('shows one note for the clock in and the clock out', () => {
    assert.equal(periodNoteText('Left late', ''), 'Left late');
    assert.equal(periodNoteText('', 'Traffic back'), 'Traffic back');
    assert.equal(periodNoteText('Same note', 'Same note'), 'Same note');
    assert.equal(periodNoteText('Left late', 'Traffic back'), 'Left late\nTraffic back');
  });

  it('counts a reason once for the period and keeps its minutes', () => {
    assert.deepEqual(
      periodReasonCodes(
        [{ id: 'traffic', label: 'Traffic' }],
        [
          { id: 'traffic', label: 'Traffic', minutes: 15 },
          { id: 'weather', label: 'Weather', minutes: 5 },
        ]
      ),
      [
        { id: 'traffic', label: 'Traffic', minutes: 15 },
        { id: 'weather', label: 'Weather', minutes: 5 },
      ]
    );
  });

  it('stores the period note on the clock in and clears the copy on the clock out', () => {
    const punches = [
      {
        id: 'in',
        driver_name: 'Ada',
        action: 'in',
        run: 'AM',
        punched_at: '2026-10-16T13:00:00.000Z',
        note: 'Left late',
        reason_codes: [{ id: 'traffic', label: 'Traffic' }],
        office_edits: [{ note: 'Yard called' }],
      },
      {
        id: 'out',
        driver_name: 'Ada',
        action: 'out',
        run: 'AM',
        punched_at: '2026-10-16T15:00:00.000Z',
        note: 'Traffic back',
        reason_codes: [{ id: 'traffic', label: 'Traffic', minutes: 15 }],
      },
      {
        id: 'pm',
        driver_name: 'Ada',
        action: 'in',
        run: 'PM',
        punched_at: '2026-10-16T21:00:00.000Z',
        note: 'PM only',
        reason_codes: [],
      },
    ];
    const next = applyPeriodNote(punches, {
      driverName: 'Ada',
      run: 'AM',
      date: '2026-10-16',
      note: 'Left late\nTraffic back',
      reasonCodes: [{ id: 'traffic', label: 'Traffic', minutes: 15 }],
    });
    assert.equal(next[0].note, 'Left late\nTraffic back');
    assert.deepEqual(next[0].reason_codes, [{ id: 'traffic', label: 'Traffic', minutes: 15 }]);
    assert.deepEqual(next[0].office_edits, punches[0].office_edits);
    assert.equal(next[1].note, '');
    assert.deepEqual(next[1].reason_codes, []);
    assert.equal(next[2].note, 'PM only');
    assert.equal(punches[1].note, 'Traffic back');
  });

  it('keeps each extra period’s note on that period', () => {
    const punches = [
      {
        id: 'in-1',
        driver_name: 'Ada',
        action: 'in',
        run: 'OTHER',
        extra_index: 1,
        punched_at: '2026-10-16T16:00:00.000Z',
        note: 'First',
        reason_codes: [],
      },
      {
        id: 'in-2',
        driver_name: 'Ada',
        action: 'in',
        run: 'OTHER',
        extra_index: 2,
        punched_at: '2026-10-16T18:00:00.000Z',
        note: '',
        reason_codes: [],
      },
    ];
    const next = applyPeriodNote(punches, {
      driverName: 'Ada',
      run: 'OTHER',
      extraIndex: 2,
      date: '2026-10-16',
      note: 'Second job',
      reasonCodes: [{ id: 'trip', label: 'Trip', minutes: 30 }],
    });
    assert.equal(next[0].note, 'First');
    assert.equal(next[1].note, 'Second job');
    assert.deepEqual(next[1].reason_codes, [{ id: 'trip', label: 'Trip', minutes: 30 }]);
  });

  it('leaves a replaced punch’s note where it was', () => {
    const punches = [
      {
        id: 'early',
        driver_name: 'Ada',
        action: 'in',
        run: 'AM',
        punched_at: '2026-10-16T13:00:00.000Z',
        note: 'First try',
        reason_codes: [],
      },
      {
        id: 'later',
        driver_name: 'Ada',
        action: 'in',
        run: 'AM',
        punched_at: '2026-10-16T13:10:00.000Z',
        note: '',
        reason_codes: [],
      },
    ];
    const next = applyPeriodNote(punches, {
      driverName: 'Ada',
      run: 'AM',
      date: '2026-10-16',
      note: 'Use this one',
    });
    assert.equal(next[0].note, 'First try');
    assert.equal(next[1].note, 'Use this one');
  });
});

describe('moving a clock time to another row', () => {
  it('offers every other route row and leaves this row out', () => {
    assert.deepEqual(
      clockMoveTargets('AM', 'in').map((row) => row.label),
      ['PM OUT', 'PM IN', 'MID OUT', 'MID IN', 'AM OUT']
    );
    assert.deepEqual(
      clockMoveTargets('OTHER', 'out').map((row) => row.label),
      ['PM OUT', 'PM IN', 'MID OUT', 'MID IN', 'AM OUT', 'AM IN']
    );
  });

  it('moves the punch onto the other row and keeps the clock time', () => {
    const punches = [
      {
        id: 'p1',
        driver_name: 'Ada',
        action: 'in',
        run: 'AM',
        punched_at: '2026-10-16T13:07:00.000Z',
        note: 'traffic',
        reason_codes: [{ id: 'reason-traffic', label: 'Traffic' }],
        pay_status: 'reg-driver',
        pay_portions: [{ start: '2026-10-16T13:07:00.000Z', end: '2026-10-16T14:00:00.000Z', pay_status: 'reg-driver' }],
        work_type: 'extra',
      },
      { id: 'p2', action: 'out', run: 'AM', punched_at: '2026-10-16T15:00:00.000Z' },
    ];
    const next = movePunchToRow(punches, 'p1', { run: 'PM', action: 'in' }, { payStatus: 'ot-trainer' });
    assert.equal(next[0].punched_at, '2026-10-16T13:07:00.000Z');
    assert.equal(next[0].run, 'PM');
    assert.equal(next[0].action, 'in');
    assert.equal(next[0].note, 'traffic');
    assert.deepEqual(next[0].reason_codes, punches[0].reason_codes);
    assert.equal(next[0].pay_status, 'ot-trainer');
    assert.deepEqual(next[0].pay_portions, punches[0].pay_portions);
    assert.equal(next[0].work_type, undefined);
    assert.equal(next[1], punches[1]);
    assert.equal(punches[0].run, 'AM');
    assert.equal(punches[0].punched_at, '2026-10-16T13:07:00.000Z');
  });

  it('drops clock-in pay when the time moves to a clock-out row', () => {
    const next = movePunchToRow(
      [
        {
          id: 'p1',
          action: 'in',
          run: 'AM',
          punched_at: '2026-10-16T13:07:00.000Z',
          pay_status: 'reg-driver',
          pay_portions: [{ start: 'a', end: 'b', pay_status: 'reg-driver' }],
        },
      ],
      'p1',
      { run: 'MIDDAY', action: 'out' }
    );
    assert.equal(next[0].punched_at, '2026-10-16T13:07:00.000Z');
    assert.equal(next[0].run, 'MIDDAY');
    assert.equal(next[0].action, 'out');
    assert.equal(next[0].pay_status, undefined);
    assert.equal(next[0].pay_portions, undefined);
  });

  it('keeps a clock-out timecard when that clock-out moves to another route', () => {
    const entries = [{ label: 'Extra', minutes: 15 }];
    const next = movePunchToRow(
      [{ id: 'p1', action: 'out', run: 'AM', punched_at: '2026-10-16T15:00:00.000Z', timecard_entries: entries }],
      'p1',
      { run: 'PM', action: 'out' }
    );
    assert.equal(next[0].punched_at, '2026-10-16T15:00:00.000Z');
    assert.equal(next[0].run, 'PM');
    assert.equal(next[0].timecard_entries, entries);
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
