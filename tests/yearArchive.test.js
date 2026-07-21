import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertFolderNameConfirmed,
  buildYearArchivePreview,
  hasMeaningfulAppData,
  validateArchiveFolderName,
} from '../src/logic/yearArchive.js';
import {
  commitYearArchive,
  previewYearArchive,
} from '../src/services/yearArchive.js';
import {
  ensureDataDir,
  writeDrivers,
  writeRouteState,
  appendChangeEvent,
} from '../src/data/storage.js';
import { FILE_NAMES } from '../src/config.js';

describe('yearArchive logic', () => {
  it('treats empty drivers/routes/log as not meaningful', () => {
    assert.equal(hasMeaningfulAppData([], {}, []), false);
    assert.equal(hasMeaningfulAppData([{ driver_id: 'd1' }], {}, []), true);
    assert.equal(
      hasMeaningfulAppData([], { R1: { status: 'STABLE' } }, []),
      true
    );
    assert.equal(hasMeaningfulAppData([], {}, [{ id: 'c1' }]), true);
  });

  it('validates and confirms admin-chosen folder names', () => {
    assert.equal(
      validateArchiveFolderName('  2025-26 school year  '),
      '2025-26 school year'
    );
    assert.throws(
      () => validateArchiveFolderName('../escape'),
      /path separators|\.\./
    );
    assert.throws(() => validateArchiveFolderName('a/b'), /path separators/);
    assert.throws(() => validateArchiveFolderName(''), /required/);

    assertFolderNameConfirmed('2025-26 school year', '2025-26 school year');
    assert.throws(
      () => assertFolderNameConfirmed('2025-26 school year', '2025-26'),
      /does not match/
    );
  });

  it('builds preview with named mid-flight routes', () => {
    const preview = buildYearArchivePreview({
      drivers: [{ driver_id: 'd1', name: 'Ada' }],
      routeState: {
        'S 10': { status: 'STABLE' },
        'S 11': { status: 'ACCUMULATING' },
        'S 12': { status: 'BID_PENDING' },
        'S 13': { status: 'LOCKED_PENDING' },
        'S 14': { status: 'BUMP_ELIGIBLE' },
        'S 15': { status: 'NEEDS_REVIEW' },
      },
      changeLog: [{ id: '1' }, { id: '2' }],
      lettersCount: 3,
      workbookPresent: true,
    });

    assert.equal(preview.has_meaningful_data, true);
    assert.equal(preview.drivers_count, 1);
    assert.equal(preview.routes_count, 6);
    assert.equal(preview.change_log_entries, 2);
    assert.equal(preview.letters_count, 3);
    assert.equal(preview.workbook_present, true);
    assert.deepEqual(
      preview.mid_flight_routes.map((r) => r.route_id),
      ['S 11', 'S 12', 'S 14', 'S 15']
    );
    assert.ok(preview.purpose.includes('past year'));
    assert.ok(preview.first_use_note.includes('first roster import'));
  });
});

describe('yearArchive commit (copy only)', () => {
  it('copies _app_data and workbook without modifying source', async () => {
    const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rct-arch-'));
    const appDataDir = path.join(sharedRoot, '_app_data');
    await ensureDataDir(appDataDir);

    await writeDrivers(
      [
        {
          driver_id: 'drv-1',
          name: 'Jane Driver',
          email: 'jane@example.org',
          hire_date: '2012-08-15',
          tie_break: null,
        },
      ],
      appDataDir
    );
    await writeRouteState(
      {
        'S 99': {
          route_id: 'S 99',
          status: 'ACCUMULATING',
          current_driver_id: 'drv-1',
          current_am: '6:00-8:00',
          current_midday: null,
          current_pm: '2:00-4:00',
          baseline_total_minutes: 240,
          current_total_minutes: 250,
          windows: { am: null, midday: null, pm: null },
          pending_changes: [],
          change_reports: [],
        },
      },
      appDataDir
    );
    await appendChangeEvent(
      {
        route_id: 'S 99',
        driver_name: 'Jane Driver',
        segment: 'AM',
        submitted_at: '2025-09-02T08:00:00.000Z',
        effective_date: '2025-09-02',
        previous_time: '6:00-8:00',
        new_time: '6:00-8:10',
        computed_delta_minutes: 10,
        delta_minutes: 10,
        routing_adjustment: null,
        reason_category: 'MV',
        note: 'Test change',
        entered_by: 'Routing Desk',
      },
      appDataDir
    );
    await fs.writeFile(
      path.join(appDataDir, 'letters', 'sample.txt'),
      'letter body\n',
      'utf8'
    );
    const workbookPath = path.join(sharedRoot, 'RouteChangeTracker.xlsx');
    await fs.writeFile(workbookPath, 'fake-xlsx');

    const beforeDrivers = await fs.readFile(
      path.join(appDataDir, FILE_NAMES.drivers),
      'utf8'
    );
    const beforeLog = await fs.readFile(
      path.join(appDataDir, FILE_NAMES.changeLog),
      'utf8'
    );

    const preview = await previewYearArchive({ appDataDir, sharedRoot });
    assert.equal(preview.has_meaningful_data, true);
    assert.equal(preview.mid_flight_routes[0].route_id, 'S 99');
    assert.equal(preview.mid_flight_routes[0].status, 'ACCUMULATING');
    assert.equal(preview.letters_count, 1);
    assert.equal(preview.workbook_present, true);

    const result = await commitYearArchive({
      archive_folder_name: '2025-26 school year',
      confirm_folder_name: '2025-26 school year',
      entered_by: 'Practice Setup',
      note: 'End of year snapshot',
      appDataDir,
      sharedRoot,
      archived_at: '2026-07-15T12:00:00.000Z',
    });

    assert.equal(result.archive_folder_name, '2025-26 school year');
    assert.equal(result.workbook_copied, true);
    assert.ok(Array.isArray(result.contents));
    assert.ok(
      result.contents.some(
        (row) => row.path === 'RouteChangeTracker.xlsx' && row.type === 'file'
      )
    );
    assert.ok(
      result.contents.some(
        (row) => row.path === '_app_data' && row.type === 'directory'
      )
    );
    assert.ok(
      result.contents.some(
        (row) =>
          row.path === `_app_data/${FILE_NAMES.drivers}` && row.type === 'file'
      )
    );

    const archivedDrivers = await fs.readFile(
      path.join(result.archive_path, '_app_data', FILE_NAMES.drivers),
      'utf8'
    );
    const archivedLetter = await fs.readFile(
      path.join(result.archive_path, '_app_data', 'letters', 'sample.txt'),
      'utf8'
    );
    const archivedWorkbook = await fs.readFile(
      path.join(result.archive_path, 'RouteChangeTracker.xlsx'),
      'utf8'
    );
    const meta = JSON.parse(
      await fs.readFile(
        path.join(result.archive_path, 'archive-meta.json'),
        'utf8'
      )
    );

    assert.equal(archivedDrivers, beforeDrivers);
    assert.equal(archivedLetter, 'letter body\n');
    assert.equal(archivedWorkbook, 'fake-xlsx');
    assert.equal(meta.entered_by, 'Practice Setup');
    assert.equal(meta.note, 'End of year snapshot');

    // Source untouched
    assert.equal(
      await fs.readFile(path.join(appDataDir, FILE_NAMES.drivers), 'utf8'),
      beforeDrivers
    );
    assert.equal(
      await fs.readFile(path.join(appDataDir, FILE_NAMES.changeLog), 'utf8'),
      beforeLog
    );
    assert.equal(await fs.readFile(workbookPath, 'utf8'), 'fake-xlsx');

    await assert.rejects(
      () =>
        commitYearArchive({
          archive_folder_name: '2025-26 school year',
          confirm_folder_name: '2025-26 school year',
          entered_by: 'Practice Setup',
          note: 'duplicate',
          appDataDir,
          sharedRoot,
        }),
      /already exists/
    );

    await fs.rm(sharedRoot, { recursive: true, force: true });
  });

  it('refuses archive when there is nothing meaningful to copy', async () => {
    const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rct-arch-empty-'));
    const appDataDir = path.join(sharedRoot, '_app_data');
    await ensureDataDir(appDataDir);

    const preview = await previewYearArchive({ appDataDir, sharedRoot });
    assert.equal(preview.has_meaningful_data, false);

    await assert.rejects(
      () =>
        commitYearArchive({
          archive_folder_name: 'empty-year',
          confirm_folder_name: 'empty-year',
          entered_by: 'Practice Setup',
          note: 'should fail',
          appDataDir,
          sharedRoot,
        }),
      /Nothing to archive/
    );

    await fs.rm(sharedRoot, { recursive: true, force: true });
  });
});
