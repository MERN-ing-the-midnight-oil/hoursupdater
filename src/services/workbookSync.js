import fs from 'node:fs/promises';
import path from 'node:path';
import {
  APP_DATA_DIRNAME,
  WORKBOOK_FILENAME,
  getAppDataDir,
  getAsOfDate,
  getSharedRoot,
  getWorkbookPath,
} from '../config.js';
import {
  ensureDataDir,
  readChangeLog,
  readDrivers,
  readRouteState,
  readSchoolCalendar,
  readWorkbookReconciliation,
  readWorkbookSyncStatus,
  readWorkbookWriteMeta,
  writeWorkbookReconciliation,
  writeWorkbookSyncStatus,
  writeWorkbookWriteMeta,
} from '../data/storage.js';
import {
  buildLogicalWorkbook,
  diffHasChanges,
  diffLogicalWorkbooks,
  hashBytes,
  hashLogicalWorkbook,
  parseWorkbookBuffer,
  renderWorkbookBuffer,
} from './workbook.js';

/**
 * @param {{ sharedRoot?: string, appDataDir?: string }} options
 */
function resolvePaths(options = {}) {
  if (options.sharedRoot) {
    return {
      sharedRoot: options.sharedRoot,
      appDataDir:
        options.appDataDir ?? path.join(options.sharedRoot, APP_DATA_DIRNAME),
      workbookPath: path.join(options.sharedRoot, WORKBOOK_FILENAME),
    };
  }
  if (options.appDataDir) {
    if (path.basename(options.appDataDir) === APP_DATA_DIRNAME) {
      const sharedRoot = path.dirname(options.appDataDir);
      return {
        sharedRoot,
        appDataDir: options.appDataDir,
        workbookPath: path.join(sharedRoot, WORKBOOK_FILENAME),
      };
    }
    return {
      sharedRoot: options.appDataDir,
      appDataDir: options.appDataDir,
      workbookPath: path.join(options.appDataDir, WORKBOOK_FILENAME),
    };
  }
  return {
    sharedRoot: getSharedRoot(),
    appDataDir: getAppDataDir(),
    workbookPath: getWorkbookPath(),
  };
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isWorkbookLockError(error) {
  const code = /** @type {NodeJS.ErrnoException} */ (error)?.code;
  return (
    code === 'EBUSY' ||
    code === 'EPERM' ||
    code === 'EACCES' ||
    code === 'EAGAIN' ||
    code === 'ETXTBSY'
  );
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function formatWorkbookSaveError(error) {
  if (isWorkbookLockError(error)) {
    return (
      'Could not save RouteChangeTracker.xlsx — the file appears to be open or locked ' +
      '(close it in Excel/OneDrive and the app will retry on the next change). ' +
      `System code: ${/** @type {NodeJS.ErrnoException} */ (error).code}.`
    );
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Load app JSON and build the expected logical workbook + buffer.
 * @param {string} [appDataDir]
 * @param {string | Date} [asOfDate]
 */
export async function buildExpectedWorkbook(
  appDataDir = getAppDataDir(),
  asOfDate = getAsOfDate()
) {
  const [changeLog, routeState, drivers, schoolCalendar] = await Promise.all([
    readChangeLog(appDataDir),
    readRouteState(appDataDir),
    readDrivers(appDataDir),
    readSchoolCalendar(appDataDir),
  ]);

  const logical = buildLogicalWorkbook({
    changeLog,
    routeState,
    drivers,
    schoolCalendar,
    asOfDate,
  });
  const buffer = await renderWorkbookBuffer(logical);
  return {
    logical,
    buffer,
    logical_sha256: hashLogicalWorkbook(logical),
    content_sha256: hashBytes(buffer),
  };
}

/**
 * @param {string} appDataDir
 * @param {string} workbookPath
 * @param {Partial<import('../data/storage.js').WorkbookSyncStatus>} patch
 */
async function recordSyncStatus(appDataDir, workbookPath, patch) {
  const prior = (await readWorkbookSyncStatus(appDataDir)) ?? {
    last_successful_write_at: null,
    last_attempt_at: new Date().toISOString(),
    last_attempt_status: /** @type {const} */ ('wrote'),
    last_error: null,
    last_error_code: null,
    out_of_date: false,
    workbook_path: workbookPath,
  };

  /** @type {import('../data/storage.js').WorkbookSyncStatus} */
  const next = {
    last_successful_write_at: prior.last_successful_write_at,
    last_attempt_at: new Date().toISOString(),
    last_attempt_status: patch.last_attempt_status ?? prior.last_attempt_status,
    last_error: patch.last_error !== undefined ? patch.last_error : prior.last_error,
    last_error_code:
      patch.last_error_code !== undefined
        ? patch.last_error_code
        : prior.last_error_code,
    out_of_date:
      patch.out_of_date !== undefined ? patch.out_of_date : prior.out_of_date,
    workbook_path: workbookPath,
  };

  if (patch.last_attempt_status === 'wrote') {
    next.last_successful_write_at = next.last_attempt_at;
    next.last_error = null;
    next.last_error_code = null;
    next.out_of_date = false;
  }

  await writeWorkbookSyncStatus(next, appDataDir);
  return next;
}

/**
 * Regenerate RouteChangeTracker.xlsx from `_app_data`, unless an external edit
 * is detected. Lock/save failures are recorded (no crash) and retried on the
 * next sync cycle.
 *
 * @param {{
 *   sharedRoot?: string,
 *   appDataDir?: string,
 *   force?: boolean,
 *   asOfDate?: string | Date,
 *   _renameFn?: typeof fs.rename,
 * }} [options]
 */
export async function syncWorkbook(options = {}) {
  const { sharedRoot, appDataDir, workbookPath } = resolvePaths(options);
  const renameFn = options._renameFn ?? fs.rename;

  await ensureDataDir(appDataDir);
  await fs.mkdir(sharedRoot, { recursive: true });

  const expected = await buildExpectedWorkbook(appDataDir, options.asOfDate);
  const pending = await readWorkbookReconciliation(appDataDir);

  /**
   * @param {boolean} [forced]
   * @param {string} [reason]
   */
  async function tryWrite(forced = false, reason = undefined) {
    try {
      await writeWorkbookFile(workbookPath, expected, appDataDir, renameFn);
      const sync_status = await recordSyncStatus(appDataDir, workbookPath, {
        last_attempt_status: 'wrote',
      });
      return {
        status: /** @type {const} */ ('wrote'),
        path: workbookPath,
        forced,
        reason,
        sync_status,
      };
    } catch (error) {
      const sync_status = await recordSyncStatus(appDataDir, workbookPath, {
        last_attempt_status: 'save_failed',
        last_error: formatWorkbookSaveError(error),
        last_error_code:
          /** @type {NodeJS.ErrnoException} */ (error)?.code ?? null,
        out_of_date: true,
      });
      return {
        status: /** @type {const} */ ('save_failed'),
        path: workbookPath,
        forced,
        reason: isWorkbookLockError(error) ? 'file_locked' : 'save_error',
        error: formatWorkbookSaveError(error),
        sync_status,
      };
    }
  }

  if (options.force) {
    return tryWrite(true);
  }

  let existingBytes = null;
  try {
    existingBytes = await fs.readFile(workbookPath);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
      const sync_status = await recordSyncStatus(appDataDir, workbookPath, {
        last_attempt_status: 'save_failed',
        last_error: formatWorkbookSaveError(error),
        last_error_code:
          /** @type {NodeJS.ErrnoException} */ (error)?.code ?? null,
        out_of_date: true,
      });
      return {
        status: 'save_failed',
        path: workbookPath,
        reason: 'read_error',
        error: formatWorkbookSaveError(error),
        sync_status,
      };
    }
  }

  if (!existingBytes) {
    return tryWrite(false, 'missing');
  }

  const meta = await readWorkbookWriteMeta(appDataDir);
  let fileLogical;
  try {
    fileLogical = await parseWorkbookBuffer(existingBytes);
  } catch (error) {
    const record = {
      status: /** @type {const} */ ('PENDING'),
      detected_at: new Date().toISOString(),
      resolved_at: null,
      file_logical_sha256: 'unreadable',
      app_logical_sha256: expected.logical_sha256,
      diff: {
        error: `Could not parse existing workbook: ${
          error instanceof Error ? error.message : String(error)
        }`,
        change_log: { sheet: 'Change Log', key_field: 'change_id', changes: [] },
        routes: { sheet: 'Routes', key_field: 'route_id', changes: [] },
        drivers: { sheet: 'Drivers', key_field: 'driver_id', changes: [] },
        change_reports: {
          sheet: 'Change Reports',
          key_field: 'report_id',
          changes: [],
        },
      },
      has_changes: true,
    };
    await writeWorkbookReconciliation(record, appDataDir);
    const sync_status = await recordSyncStatus(appDataDir, workbookPath, {
      last_attempt_status: 'blocked',
      last_error: null,
      last_error_code: null,
      out_of_date: false,
    });
    return {
      status: 'blocked',
      path: workbookPath,
      reason: 'unreadable',
      reconciliation: record,
      sync_status,
    };
  }

  const fileLogicalHash = hashLogicalWorkbook(fileLogical);

  if (
    (meta && fileLogicalHash === meta.logical_sha256) ||
    fileLogicalHash === expected.logical_sha256
  ) {
    const written = await tryWrite(
      false,
      fileLogicalHash === expected.logical_sha256
        ? 'already_current'
        : 'unchanged_since_write'
    );
    if (written.status === 'wrote' && pending?.status === 'PENDING') {
      await writeWorkbookReconciliation(null, appDataDir);
    }
    return written;
  }

  // External edit detected — do not overwrite.
  const diff = diffLogicalWorkbooks(expected.logical, fileLogical);
  const record = {
    status: /** @type {const} */ ('PENDING'),
    detected_at:
      pending?.status === 'PENDING'
        ? pending.detected_at
        : new Date().toISOString(),
    resolved_at: null,
    file_logical_sha256: fileLogicalHash,
    app_logical_sha256: expected.logical_sha256,
    diff,
    has_changes: diffHasChanges(diff),
  };
  await writeWorkbookReconciliation(record, appDataDir);
  const sync_status = await recordSyncStatus(appDataDir, workbookPath, {
    last_attempt_status: 'blocked',
    last_error: null,
    last_error_code: null,
    out_of_date: false,
  });
  return {
    status: 'blocked',
    path: workbookPath,
    reason: 'external_edit',
    reconciliation: record,
    sync_status,
  };
}

/**
 * @param {string} workbookPath
 * @param {{ buffer: Buffer, content_sha256: string, logical_sha256: string }} expected
 * @param {string} appDataDir
 */
async function writeWorkbookFile(
  workbookPath,
  expected,
  appDataDir,
  renameFn = fs.rename
) {
  const tempPath = `${workbookPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, expected.buffer);
    await renameFn(tempPath, workbookPath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // temp may not exist or may also be locked
    }
    throw error;
  }
  await writeWorkbookWriteMeta(
    {
      written_at: new Date().toISOString(),
      content_sha256: expected.content_sha256,
      logical_sha256: expected.logical_sha256,
      byte_length: expected.buffer.byteLength,
    },
    appDataDir
  );
}

/**
 * Discard external Excel edits and regenerate from `_app_data`.
 * @param {{ resolved_by: string, note: string, sharedRoot?: string, appDataDir?: string }} input
 */
export async function discardWorkbookEdits(input) {
  const paths = resolvePaths(input);
  const pending = await readWorkbookReconciliation(paths.appDataDir);
  const result = await syncWorkbook({
    sharedRoot: paths.sharedRoot,
    appDataDir: paths.appDataDir,
    force: true,
  });

  if (result.status === 'save_failed') {
    return result;
  }

  await writeWorkbookReconciliation(
    {
      status: 'DISCARDED',
      detected_at: pending?.detected_at ?? new Date().toISOString(),
      resolved_at: new Date().toISOString(),
      resolved_by: input.resolved_by,
      resolve_note: input.note,
      file_logical_sha256: pending?.file_logical_sha256 ?? '',
      app_logical_sha256: pending?.app_logical_sha256 ?? '',
      diff: pending?.diff ?? {},
      has_changes: pending?.has_changes ?? false,
    },
    paths.appDataDir
  );
  return result;
}
