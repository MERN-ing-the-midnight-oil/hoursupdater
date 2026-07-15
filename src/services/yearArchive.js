import fs from 'node:fs/promises';
import path from 'node:path';
import {
  APP_DATA_DIRNAME,
  ARCHIVES_DIRNAME,
  LETTERS_DIR,
  WORKBOOK_FILENAME,
  getAppDataDir,
  getSharedRoot,
} from '../config.js';
import {
  assertFolderNameConfirmed,
  buildYearArchivePreview,
  validateArchiveFolderName,
} from '../logic/yearArchive.js';
import {
  readChangeLog,
  readDrivers,
  readRouteState,
} from '../data/storage.js';

/**
 * @param {string} dir
 * @returns {Promise<number>}
 */
async function countFilesInDir(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (entry.isFile()) count += 1;
    }
    return count;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

/**
 * @param {string} workbookPath
 * @returns {Promise<boolean>}
 */
async function workbookExists(workbookPath) {
  try {
    await fs.access(workbookPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Preview what a year archive would capture. Does not write.
 * @param {object} [options]
 * @param {string} [options.appDataDir]
 * @param {string} [options.sharedRoot]
 * @returns {Promise<import('../logic/yearArchive.js').YearArchivePreview>}
 */
export async function previewYearArchive(options = {}) {
  const appDataDir = options.appDataDir ?? getAppDataDir();
  const sharedRoot = options.sharedRoot ?? getSharedRoot();
  const workbookPath = path.join(sharedRoot, WORKBOOK_FILENAME);

  const [drivers, routeState, changeLog, lettersCount, workbookPresent] =
    await Promise.all([
      readDrivers(appDataDir),
      readRouteState(appDataDir),
      readChangeLog(appDataDir),
      countFilesInDir(path.join(appDataDir, LETTERS_DIR)),
      workbookExists(workbookPath),
    ]);

  return buildYearArchivePreview({
    drivers,
    routeState,
    changeLog,
    lettersCount,
    workbookPresent,
  });
}

/**
 * Copy `_app_data` and RouteChangeTracker.xlsx into archives/<folderName>/.
 * Source data is never deleted or modified.
 *
 * @param {object} args
 * @param {string} args.archive_folder_name
 * @param {string} args.confirm_folder_name
 * @param {string} args.entered_by
 * @param {string} args.note
 * @param {string} [args.appDataDir]
 * @param {string} [args.sharedRoot]
 * @param {string} [args.archived_at] ISO timestamp override (tests)
 */
export async function commitYearArchive(args) {
  const folderName = validateArchiveFolderName(args.archive_folder_name);
  assertFolderNameConfirmed(folderName, args.confirm_folder_name);

  const entered_by = String(args.entered_by ?? '').trim();
  const note = String(args.note ?? '').trim();
  if (!entered_by) {
    throw Object.assign(new Error('entered_by is required.'), {
      code: 'ATTRIBUTION',
    });
  }
  if (!note) {
    throw Object.assign(new Error('note is required.'), {
      code: 'ATTRIBUTION',
    });
  }

  const appDataDir = args.appDataDir ?? getAppDataDir();
  const sharedRoot = args.sharedRoot ?? getSharedRoot();
  const archivesRoot = path.join(sharedRoot, ARCHIVES_DIRNAME);
  const archiveDir = path.join(archivesRoot, folderName);

  const preview = await previewYearArchive({ appDataDir, sharedRoot });
  if (!preview.has_meaningful_data) {
    throw Object.assign(
      new Error(
        'Nothing to archive — current data is empty. Use Import new roster directly.'
      ),
      { code: 'NOTHING_TO_ARCHIVE' }
    );
  }

  try {
    await fs.access(archiveDir);
    throw Object.assign(
      new Error(
        `Archive folder "${folderName}" already exists. Choose a different name.`
      ),
      { code: 'FOLDER_EXISTS' }
    );
  } catch (error) {
    if (/** @type {any} */ (error).code === 'FOLDER_EXISTS') {
      throw error;
    }
    // ENOENT — good, folder does not exist yet
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
      throw error;
    }
  }

  const archivedAt = args.archived_at ?? new Date().toISOString();
  const destAppData = path.join(archiveDir, APP_DATA_DIRNAME);
  const workbookPath = path.join(sharedRoot, WORKBOOK_FILENAME);
  const destWorkbook = path.join(archiveDir, WORKBOOK_FILENAME);

  await fs.mkdir(archivesRoot, { recursive: true });
  // Create the archive folder first so a partial failure leaves a clear target.
  await fs.mkdir(archiveDir, { recursive: false });

  try {
    await fs.cp(appDataDir, destAppData, { recursive: true, errorOnExist: true });

    const hasWorkbook = await workbookExists(workbookPath);
    if (hasWorkbook) {
      await fs.copyFile(workbookPath, destWorkbook);
    }

    const meta = {
      archive_folder_name: folderName,
      archived_at: archivedAt,
      entered_by,
      note,
      drivers_count: preview.drivers_count,
      routes_count: preview.routes_count,
      change_log_entries: preview.change_log_entries,
      letters_count: preview.letters_count,
      workbook_copied: hasWorkbook,
      mid_flight_routes: preview.mid_flight_routes,
    };
    await fs.writeFile(
      path.join(archiveDir, 'archive-meta.json'),
      `${JSON.stringify(meta, null, 2)}\n`,
      'utf8'
    );

    return {
      archive_folder_name: folderName,
      archive_path: archiveDir,
      relative_path: path.join(ARCHIVES_DIRNAME, folderName),
      workbook_copied: hasWorkbook,
      preview,
      meta,
    };
  } catch (error) {
    // Best-effort cleanup of a failed partial archive so retries aren't blocked.
    await fs.rm(archiveDir, { recursive: true, force: true }).catch(() => null);
    throw error;
  }
}
