import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendAdjustmentEvent,
  appendChangeEvent,
  createDriver,
  readAdjustmentReasons,
  readChangeLog,
  readDrivers,
  readRouteState,
  readStaffNames,
  readPayrollSettings,
  writeAdjustmentReasons,
  writeDrivers,
  writePayrollSettings,
  writeRouteState,
  writeStaffNames,
} from '../src/data/storage.js';
import {
  validateAdjustmentEvent,
  validateChangeEvent,
} from '../src/logic/stateMachine.js';

const staff = ['Routing Desk', 'Admin Assistant'];
const reasons = ['Data entry correction', 'Other', 'Known driving-time discrepancy'];

describe('storage', () => {
  it('creates files and appends to change-log safely', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rct-data-'));

    const entry = await appendChangeEvent(
      {
        route_id: 'S 20',
        driver_name: 'Jane Driver',
        segment: 'AM',
        submitted_at: '2025-09-02T08:00:00.000Z',
        effective_date: '2025-09-02',
        previous_time: '6:35-8:55',
        new_time: '6:30-8:55',
        computed_delta_minutes: 5,
        delta_minutes: 5,
        routing_adjustment: null,
        reason_category: 'MV',
        note: 'Student added',
        entered_by: 'Routing Desk',
      },
      dataDir
    );

    assert.ok(entry.id);
    const log = await readChangeLog(dataDir);
    assert.equal(log.length, 1);
    assert.equal(log[0].route_id, 'S 20');
    assert.equal(log[0].computed_delta_minutes, 5);

    await appendChangeEvent(
      {
        route_id: 'S 21',
        driver_name: 'Other Driver',
        segment: 'PM',
        submitted_at: '2025-09-03T08:00:00.000Z',
        effective_date: '2025-09-03',
        previous_time: '2:10-4:45',
        new_time: '2:10-4:50',
        computed_delta_minutes: 5,
        delta_minutes: 5,
        routing_adjustment: null,
        reason_category: 'SPED',
        note: 'Midday coverage change',
        entered_by: 'Routing Desk',
      },
      dataDir
    );

    const updatedLog = await readChangeLog(dataDir);
    assert.equal(updatedLog.length, 2);

    await writeRouteState(
      {
        'S 20': {
          driver_name: 'Jane Driver',
          segments: { AM: '6:30-8:55', MIDDAY: null, PM: null },
          baseline_segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
          status: 'ACCUMULATING',
          window_opened_date: '2025-09-02',
          window_expires_date: '2025-09-23',
          cumulative_drift_minutes: 5,
          contributing_change_ids: [entry.id],
          payroll_rounded_total_minutes: null,
          last_updated: '2025-09-02T08:00:00.000Z',
        },
      },
      dataDir
    );

    const state = await readRouteState(dataDir);
    assert.equal(state['S 20'].status, 'ACCUMULATING');

    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('appends Admin ADJUSTMENT without mutating the original ChangeEvent', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rct-adj-'));

    const original = await appendChangeEvent(
      {
        route_id: 'S 20',
        driver_name: 'Jane Driver',
        segment: 'AM',
        submitted_at: '2025-09-02T08:00:00.000Z',
        effective_date: '2025-09-02',
        previous_time: '6:35-8:55',
        new_time: '6:28-8:55',
        computed_delta_minutes: 7,
        delta_minutes: 7,
        routing_adjustment: null,
        reason_category: 'MV',
        note: 'Initial logged change',
        entered_by: 'Routing Desk',
      },
      dataDir
    );

    await appendAdjustmentEvent(
      {
        target_change_id: original.id,
        previous_delta: 7,
        new_delta: 12,
        reason: 'Known driving-time discrepancy',
        note: 'Correcting for known hill climb time',
        adjusted_by: 'Admin Assistant',
        adjusted_at: '2025-09-03T09:00:00.000Z',
      },
      dataDir
    );

    const log = await readChangeLog(dataDir);
    assert.equal(log.length, 2);
    assert.equal(log[0].delta_minutes, 7);
    assert.equal(log[0].computed_delta_minutes, 7);
    assert.equal(log[1].type, 'ADJUSTMENT');
    assert.equal(log[1].new_delta, 12);
    assert.equal(log[1].note, 'Correcting for known hill climb time');

    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('seeds and updates adjustment-reasons.json from defaults', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rct-reasons-'));

    const seeded = await readAdjustmentReasons(dataDir);
    assert.ok(seeded.length > 0);
    assert.ok(seeded.includes('Data entry correction'));

    const updated = await writeAdjustmentReasons(
      ['Custom reason A', 'Custom reason B'],
      dataDir
    );
    assert.deepEqual(updated, ['Custom reason A', 'Custom reason B']);
    assert.deepEqual(await readAdjustmentReasons(dataDir), updated);

    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('seeds and updates staff-names.json from defaults', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rct-staff-'));

    const seeded = await readStaffNames(dataDir);
    assert.deepEqual(seeded, []);

    const updated = await writeStaffNames(['Alex Rivera', 'Sam Chen'], dataDir);
    assert.deepEqual(updated, ['Alex Rivera', 'Sam Chen']);
    assert.deepEqual(await readStaffNames(dataDir), updated);

    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('seeds and updates payroll-settings.json from defaults', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rct-payroll-'));

    const seeded = await readPayrollSettings(dataDir);
    assert.equal(seeded.payroll_email, '');
    assert.match(seeded.message_template, /\{\{route_id\}\}/);
    assert.match(seeded.message_template, /\{\{driver_name\}\}/);

    const updated = await writePayrollSettings(
      {
        payroll_email: ' payroll@district.org ',
        message_template: 'Hello {{driver_name}} on {{route_id}}',
      },
      dataDir
    );
    assert.equal(updated.payroll_email, 'payroll@district.org');
    assert.equal(updated.message_template, 'Hello {{driver_name}} on {{route_id}}');
    assert.deepEqual(await readPayrollSettings(dataDir), updated);

    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('migrates distinct driver names from route-state into drivers.json', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rct-drivers-'));

    await writeRouteState(
      {
        'S 20': {
          driver_name: 'Jane Driver',
          segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
          baseline_segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
          status: 'STABLE',
          window_opened_date: null,
          window_expires_date: null,
          cumulative_drift_minutes: 0,
          contributing_change_ids: [],
          payroll_rounded_total_minutes: null,
          last_updated: '2025-09-01T12:00:00.000Z',
        },
        'S 11': {
          driver_name: 'Tammy Trapp',
          segments: { AM: '6:40-9:20', MIDDAY: null, PM: null },
          baseline_segments: { AM: '6:40-9:20', MIDDAY: null, PM: null },
          status: 'STABLE',
          window_opened_date: null,
          window_expires_date: null,
          cumulative_drift_minutes: 0,
          contributing_change_ids: [],
          payroll_rounded_total_minutes: null,
          last_updated: '2025-09-01T12:00:00.000Z',
        },
      },
      dataDir
    );

    const migrated = await readDrivers(dataDir);
    assert.equal(migrated.length, 2);
    assert.deepEqual(
      migrated.map((d) => d.name).sort(),
      ['Jane Driver', 'Tammy Trapp']
    );
    assert.ok(migrated.every((d) => d.driver_id && d.email === null));

    const created = await createDriver(
      { name: 'New Driver', email: 'new@example.com' },
      dataDir
    );
    assert.equal(created.email, 'new@example.com');
    assert.equal((await readDrivers(dataDir)).length, 3);

    await writeDrivers(
      migrated.map((d) =>
        d.name === 'Jane Driver' ? { ...d, email: 'jane@example.com' } : d
      ),
      dataDir
    );
    const jane = (await readDrivers(dataDir)).find((d) => d.name === 'Jane Driver');
    assert.equal(jane.email, 'jane@example.com');

    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('returns empty defaults when change-log and route-state are missing', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rct-empty-'));
    const log = await readChangeLog(dataDir);
    const state = await readRouteState(dataDir);
    assert.deepEqual(log, []);
    assert.deepEqual(state, {});
    await fs.rm(dataDir, { recursive: true, force: true });
  });
});

describe('attribution validation', () => {
  it('requires routing_adjustment when delta differs from computed', () => {
    const errors = validateChangeEvent(
      {
        route_id: 'S 20',
        driver_name: 'Jane',
        segment: 'AM',
        effective_date: '2025-09-02',
        previous_time: '6:35-8:55',
        new_time: '6:28-8:55',
        computed_delta_minutes: 7,
        delta_minutes: 10,
        routing_adjustment: null,
        note: 'Override attempt',
        entered_by: 'Routing Desk',
      },
      reasons,
      staff
    );
    assert.ok(errors.some((e) => e.includes('routing_adjustment is required')));
  });

  it('requires a non-empty note on every ChangeEvent', () => {
    const errors = validateChangeEvent(
      {
        route_id: 'S 20',
        driver_name: 'Jane',
        segment: 'AM',
        effective_date: '2025-09-02',
        previous_time: '6:35-8:55',
        new_time: '6:30-8:55',
        computed_delta_minutes: 5,
        delta_minutes: 5,
        routing_adjustment: null,
        note: '   ',
        entered_by: 'Routing Desk',
      },
      reasons,
      staff
    );
    assert.ok(errors.some((e) => e.includes('note is required')));
  });

  it('requires entered_by from staff-names.json', () => {
    const errors = validateChangeEvent(
      {
        route_id: 'S 20',
        driver_name: 'Jane',
        segment: 'AM',
        effective_date: '2025-09-02',
        previous_time: '6:35-8:55',
        new_time: '6:30-8:55',
        computed_delta_minutes: 5,
        delta_minutes: 5,
        routing_adjustment: null,
        note: 'Student added',
        entered_by: 'Not On List',
      },
      reasons,
      staff
    );
    assert.ok(errors.some((e) => e.includes('configured staff names')));
  });

  it('accepts a valid Routing adjustment with staff + note', () => {
    const errors = validateChangeEvent(
      {
        route_id: 'S 20',
        driver_name: 'Jane',
        segment: 'AM',
        effective_date: '2025-09-02',
        previous_time: '6:35-8:55',
        new_time: '6:28-8:55',
        computed_delta_minutes: 7,
        delta_minutes: 10,
        routing_adjustment: {
          reason: 'Data entry correction',
          adjusted_by: 'Routing Desk',
          adjusted_at: '2025-09-02T08:00:00.000Z',
        },
        note: 'Correcting known discrepancy',
        entered_by: 'Routing Desk',
      },
      reasons,
      staff
    );
    assert.deepEqual(errors, []);
  });

  it('requires note + staff name for new-route style ChangeEvents', () => {
    const missing = validateChangeEvent(
      {
        route_id: 'S 99',
        driver_name: 'New Driver',
        segment: 'AM',
        effective_date: '2025-09-02',
        previous_time: '6:00-8:00',
        new_time: '6:00-8:15',
        computed_delta_minutes: 15,
        delta_minutes: 15,
        routing_adjustment: null,
        note: '',
        entered_by: '',
      },
      reasons,
      staff
    );
    assert.ok(missing.some((e) => e.includes('note is required')));
    assert.ok(missing.some((e) => e.includes('entered_by is required')));

    const ok = validateChangeEvent(
      {
        route_id: 'S 99',
        driver_name: 'New Driver',
        segment: 'AM',
        effective_date: '2025-09-02',
        previous_time: '6:00-8:00',
        new_time: '6:00-8:15',
        computed_delta_minutes: 15,
        delta_minutes: 15,
        routing_adjustment: null,
        note: 'Opening new route for overflow',
        entered_by: 'Routing Desk',
      },
      reasons,
      staff
    );
    assert.deepEqual(ok, []);
  });

  it('validates Admin ADJUSTMENT events require note and staff name', () => {
    assert.deepEqual(
      validateAdjustmentEvent(
        {
          type: 'ADJUSTMENT',
          target_change_id: 'c1',
          previous_delta: 7,
          new_delta: 10,
          reason: 'Other',
          note: 'Manual correction after review',
          adjusted_by: 'Admin Assistant',
          adjusted_at: '2025-09-03T08:00:00.000Z',
        },
        reasons,
        staff
      ),
      []
    );

    const badReason = validateAdjustmentEvent(
      {
        type: 'ADJUSTMENT',
        target_change_id: 'c1',
        previous_delta: 7,
        new_delta: 10,
        reason: 'Not in list',
        note: 'Has a note',
        adjusted_by: 'Admin Assistant',
        adjusted_at: '2025-09-03T08:00:00.000Z',
      },
      reasons,
      staff
    );
    assert.ok(badReason.some((e) => e.includes('configured adjustment reasons')));

    const missingNote = validateAdjustmentEvent(
      {
        type: 'ADJUSTMENT',
        target_change_id: 'c1',
        previous_delta: 7,
        new_delta: 10,
        reason: 'Other',
        note: '  ',
        adjusted_by: 'Admin Assistant',
        adjusted_at: '2025-09-03T08:00:00.000Z',
      },
      reasons,
      staff
    );
    assert.ok(missingNote.some((e) => e.includes('note is required')));
  });
});
