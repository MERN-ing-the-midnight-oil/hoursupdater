import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRouteSheet } from '../src/services/routeSheet.js';
import { packetForDriver } from '../src/services/logPacket.js';

const calendar = {
  school_year: '2025-26',
  school_days: ['2025-09-02', '2025-09-03', '2025-09-04'],
};

const change = {
  id: 'c1',
  type: 'CHANGE',
  route_id: 'S 20',
  driver_name: 'Jane Driver',
  driver_id: 'd1',
  segment: 'AM',
  submitted_at: '2025-09-02T15:00:00.000Z',
  effective_date: '2025-09-02',
  previous_time: '6:35-8:55',
  new_time: '6:30-8:55',
  delta_minutes: -5,
  note: 'Student added',
  entered_by: 'Routing Desk',
};

const entry = {
  driver_name: 'Jane Driver',
  driver_id: 'd1',
  segments: { AM: '6:30-8:55', MIDDAY: null, PM: null },
  status: 'STABLE',
  cumulative_drift_minutes: 0,
  window_expires_date: null,
  change_reports: [],
  contributing_change_ids: [],
};

test('route sheet shows the clock change and a calendar day', () => {
  const sheet = buildRouteSheet({
    routeId: 'S 20',
    entry,
    changeLog: [change],
    calendar,
    asOf: '2025-09-04',
  });
  assert.equal(sheet.rows.at(-1).note, 'Student added');
  assert.equal(sheet.rows.at(-1).entered_by, 'Routing Desk');
  assert.match(sheet.history_html, /Student added/);
  assert.match(sheet.calendar_html, /cal-day/);
  assert.match(sheet.legend_html, /Sep 2, 2025/);
});

test('history packet is addressed to the driver email person', () => {
  const packet = packetForDriver({
    driver: { driver_id: 'd1', name: 'Jane Driver', email: 'jane@example.com' },
    changeLog: [change],
    routeState: { 'S 20': entry },
    calendar,
    asOf: '2025-09-04',
  });
  assert.ok(packet);
  assert.deepEqual(packet.routeNames, ['S 20']);
  assert.match(packet.html, /Clock-time history for Jane Driver/);
  assert.match(packet.mail.subject, /Jane Driver/);
  assert.equal(
    packetForDriver({
      driver: { driver_id: 'd2', name: 'Other Person', email: 'other@example.com' },
      changeLog: [change],
      routeState: { 'S 20': entry },
      calendar,
      asOf: '2025-09-04',
    }),
    null
  );
});
