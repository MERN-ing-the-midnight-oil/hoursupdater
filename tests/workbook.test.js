import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendChangeEvent,
  ensureDataDir,
  readWorkbookReconciliation,
  writeRouteState,
  writeDrivers,
} from '../src/data/storage.js';
import {
  buildLogicalWorkbook,
  hashLogicalWorkbook,
  parseWorkbookBuffer,
  renderWorkbookBuffer,
} from '../src/services/workbook.js';
import {
  discardWorkbookEdits,
  syncWorkbook,
} from '../src/services/workbookSync.js';

async function seedMiniAppData(appDataDir) {
  await ensureDataDir(appDataDir);
  await writeDrivers(
    [{ driver_id: 'd1', name: 'Jane Driver', email: null }],
    appDataDir
  );
  await writeRouteState(
    {
      'S 20': {
        driver_name: 'Jane Driver',
        driver_id: 'd1',
        segments: { AM: '6:35-8:55', MIDDAY: null, PM: '2:10-4:45' },
        baseline_segments: { AM: '6:35-8:55', MIDDAY: null, PM: '2:10-4:45' },
        status: 'STABLE',
        window_opened_date: null,
        window_expires_date: null,
        cumulative_drift_minutes: 0,
        contributing_change_ids: [],
        payroll_rounded_total_minutes: null,
        change_reports: [],
        last_updated: '2025-09-01T12:00:00.000Z',
      },
    },
    appDataDir
  );
  await appendChangeEvent(
    {
      route_id: 'S 20',
      driver_name: 'Jane Driver',
      driver_id: 'd1',
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
    appDataDir
  );
  // Minimal calendar so days_remaining can compute if needed
  await fs.writeFile(
    path.join(appDataDir, 'school-calendar.json'),
    JSON.stringify({
      school_year: '2025-26',
      school_days: ['2025-09-02', '2025-09-03', '2025-09-04'],
    }) + '\n'
  );
}

describe('workbook sync', () => {
  it('writes RouteChangeTracker.xlsx as a sibling of _app_data', async () => {
    const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rct-wb-'));
    const appDataDir = path.join(sharedRoot, '_app_data');
    await seedMiniAppData(appDataDir);

    const result = await syncWorkbook({ sharedRoot, appDataDir });
    assert.equal(result.status, 'wrote');
    assert.equal(
      result.path,
      path.join(sharedRoot, 'RouteChangeTracker.xlsx')
    );
    await fs.access(result.path);

    const again = await syncWorkbook({ sharedRoot, appDataDir });
    assert.equal(again.status, 'wrote');
    assert.equal(await readWorkbookReconciliation(appDataDir), null);

    await fs.rm(sharedRoot, { recursive: true, force: true });
  });

  it('blocks overwrite when the workbook was edited externally', async () => {
    const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rct-wb-edit-'));
    const appDataDir = path.join(sharedRoot, '_app_data');
    await seedMiniAppData(appDataDir);

    const first = await syncWorkbook({ sharedRoot, appDataDir });
    assert.equal(first.status, 'wrote');

    const bytes = await fs.readFile(first.path);
    const logical = await parseWorkbookBuffer(bytes);
    logical.change_log[0].exact_delta_minutes = '99';
    const edited = await renderWorkbookBuffer(logical);
    await fs.writeFile(first.path, edited);

    const blocked = await syncWorkbook({ sharedRoot, appDataDir });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.reason, 'external_edit');

    const pending = await readWorkbookReconciliation(appDataDir);
    assert.equal(pending.status, 'PENDING');
    assert.ok(
      pending.diff.change_log.changes.some(
        (c) => c.key === logical.change_log[0].change_id && c.kind === 'modified'
      )
    );

    // File must still contain the edited value (not silently overwritten).
    const still = await parseWorkbookBuffer(await fs.readFile(first.path));
    assert.equal(still.change_log[0].exact_delta_minutes, '99');

    await discardWorkbookEdits({
      sharedRoot,
      appDataDir,
      resolved_by: 'Admin Assistant',
      note: 'Discarding accidental Excel edit',
    });
    const restored = await parseWorkbookBuffer(await fs.readFile(first.path));
    assert.equal(restored.change_log[0].exact_delta_minutes, '5');

    await fs.rm(sharedRoot, { recursive: true, force: true });
  });

  it('round-trips logical workbook through xlsx without hash drift', async () => {
    const logical = buildLogicalWorkbook({
      changeLog: [
        {
          id: 'c1',
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
          note: 'Note',
          entered_by: 'Routing Desk',
        },
      ],
      routeState: {
        'S 20': {
          driver_name: 'Jane Driver',
          driver_id: 'd1',
          segments: { AM: '6:30-8:55', MIDDAY: null, PM: null },
          baseline_segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
          status: 'ACCUMULATING',
          window_opened_date: '2025-09-02',
          window_expires_date: '2025-09-23',
          cumulative_drift_minutes: 5,
          contributing_change_ids: ['c1'],
          payroll_rounded_total_minutes: null,
          change_reports: [],
          last_updated: '2025-09-02T08:00:00.000Z',
        },
      },
      drivers: [{ driver_id: 'd1', name: 'Jane Driver', email: null }],
      schoolCalendar: {
        school_days: ['2025-09-02', '2025-09-03', '2025-09-04', '2025-09-05'],
      },
      asOfDate: '2025-09-03',
    });

    const buffer = await renderWorkbookBuffer(logical);
    const parsed = await parseWorkbookBuffer(buffer);
    assert.equal(hashLogicalWorkbook(parsed), hashLogicalWorkbook(logical));
  });

  it('records save_failed without crashing when rename is locked', async () => {
    const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rct-wb-lock-'));
    const appDataDir = path.join(sharedRoot, '_app_data');
    await seedMiniAppData(appDataDir);

    const first = await syncWorkbook({ sharedRoot, appDataDir });
    assert.equal(first.status, 'wrote');
    const lastOk = first.sync_status.last_successful_write_at;

    const lockedRename = async () => {
      const err = new Error('busy');
      // @ts-ignore
      err.code = 'EBUSY';
      throw err;
    };

    const failed = await syncWorkbook({
      sharedRoot,
      appDataDir,
      _renameFn: lockedRename,
    });
    assert.equal(failed.status, 'save_failed');
    assert.equal(failed.reason, 'file_locked');
    assert.match(failed.error, /locked|open/i);
    assert.equal(failed.sync_status.out_of_date, true);
    assert.equal(failed.sync_status.last_successful_write_at, lastOk);

    const { readWorkbookSyncStatus } = await import('../src/data/storage.js');
    const status = await readWorkbookSyncStatus(appDataDir);
    assert.equal(status.last_attempt_status, 'save_failed');
    assert.equal(status.out_of_date, true);

    const recovered = await syncWorkbook({ sharedRoot, appDataDir });
    assert.equal(recovered.status, 'wrote');
    assert.equal(recovered.sync_status.out_of_date, false);

    await fs.rm(sharedRoot, { recursive: true, force: true });
  });
});
