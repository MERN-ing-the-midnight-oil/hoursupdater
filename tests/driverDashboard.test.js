import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDriverClockEdit,
  buildDriverDashboard,
  timeChangesForDriver,
} from '../src/logic/driverDashboard.js';

const driver = { ids: ['driver-james-kuhlman'], name: 'James Kuhlman', clock_id: 'driver-james-kuhlman' };
const now = new Date(2026, 9, 25, 11, 0, 0);

function punch(partial) {
  return {
    id: 'punch-1',
    driver_id: 'driver-james-kuhlman',
    driver_name: 'James Kuhlman',
    action: 'in',
    punched_at: new Date(2026, 9, 20, 7, 5, 0).toISOString(),
    note: '',
    note_at: null,
    reason_codes: [],
    ...partial,
  };
}

describe('driver time changes', () => {
  it('keeps real clock moves and leaves the starting schedule off the list', () => {
    const rows = timeChangesForDriver(
      [
        {
          id: 'seed',
          route_id: 'Utility — Kuhlman',
          driver_id: 'driver-james-kuhlman',
          driver_name: 'James Kuhlman',
          segment: 'AM',
          effective_date: '2026-09-01',
          previous_time: '7:00-15:00',
          new_time: '7:00-15:00',
          note: '',
        },
        {
          id: 'move',
          route_id: 'Utility — Kuhlman',
          driver_id: 'driver-james-kuhlman',
          driver_name: 'James Kuhlman',
          segment: 'AM',
          effective_date: '2026-10-06',
          previous_time: '7:00-15:00',
          new_time: '7:00-14:30',
          note: 'Shortened the afternoon',
        },
      ],
      driver
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].previous_time, '7:00-15:00');
    assert.equal(rows[0].new_time, '7:00-14:30');
    assert.equal(rows[0].note, 'Shortened the afternoon');
  });
});

describe('driver time card edits', () => {
  it('moves a clock time on the open pay period and keeps the day', () => {
    const saved = applyDriverClockEdit([punch()], 'punch-1', {
      driver,
      time: '07:40',
      note: 'Traffic on the guide',
      now,
    });
    const next = new Date(saved.punch.punched_at);
    assert.equal(next.getFullYear(), 2026);
    assert.equal(next.getMonth(), 9);
    assert.equal(next.getDate(), 20);
    assert.equal(next.getHours(), 7);
    assert.equal(next.getMinutes(), 40);
    assert.equal(saved.punch.note, 'Traffic on the guide');
    assert.equal(saved.punch.action, 'in');
  });

  it('records a reason with whole minutes and rejects a code that is not on the list', () => {
    const catalog = [{ id: 'late', label: 'Late start' }];
    const saved = applyDriverClockEdit([punch({ note: 'Already noted' })], 'punch-1', {
      driver,
      reasons: [{ id: 'late', minutes: 15 }],
      now,
      catalog,
    });
    assert.equal(saved.punch.note, 'Already noted');
    assert.equal(saved.punch.reason_codes[0].label, 'Late start');
    assert.equal(saved.punch.reason_codes[0].minutes, 15);
    const cleared = applyDriverClockEdit(saved.punches, 'punch-1', {
      driver,
      reasons: [],
      now,
      catalog,
    });
    assert.deepEqual(cleared.punch.reason_codes, []);
    assert.throws(
      () =>
        applyDriverClockEdit([punch()], 'punch-1', {
          driver,
          reasons: [{ id: 'late', minutes: 0 }],
          now,
          catalog,
        }),
      /whole minutes/
    );
    assert.throws(
      () =>
        applyDriverClockEdit([punch()], 'punch-1', {
          driver,
          reasons: [{ id: 'missing', minutes: 10 }],
          now,
          catalog,
        }),
      /not on the list/
    );
  });

  it('refuses a closed pay period and another driver', () => {
    const closed = punch({ punched_at: new Date(2026, 9, 8, 7, 5, 0).toISOString() });
    assert.throws(
      () => applyDriverClockEdit([closed], 'punch-1', { driver, time: '08:00', now }),
      /pay period is closed/
    );
    assert.throws(
      () =>
        applyDriverClockEdit([punch({ driver_id: 'other', driver_name: 'Someone Else' })], 'punch-1', {
          driver,
          note: 'No',
          now,
        }),
      /different driver/
    );
  });
});

describe('driver dashboard payload', () => {
  it('builds a read-only summary and an editable card for the open period', () => {
    const dashboard = buildDriverDashboard({
      changeLog: [],
      punches: [punch(), punch({ id: 'old', punched_at: new Date(2026, 9, 8, 8, 0, 0).toISOString() })],
      routes: [{ route_id: 'Utility — Kuhlman', segments: { AM: '7:00-15:00', MIDDAY: null, PM: null } }],
      catalog: [{ id: 'late', label: 'Late start' }],
      driver,
      now,
    });
    assert.equal(dashboard.card.punches.length, 1);
    assert.equal(dashboard.card.punches[0].editable, true);
    assert.equal(dashboard.card.punches[0].run, 'AM');
    assert.equal(dashboard.clocks[0].am, '7:00-15:00');
    assert.deepEqual(dashboard.reason_catalog, [{ id: 'late', label: 'Late start' }]);
    assert.ok(dashboard.summaries.periods.length >= 2);
    assert.equal(dashboard.summaries.selected.days.length > 0, true);
  });
});
