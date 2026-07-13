import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/**
 * Shared OneDrive folder root (what people open in Explorer/Finder).
 * Contains `_app_data/` (internal JSON) and `RouteChangeTracker.xlsx` (read-facing).
 * @returns {string}
 */
export function getSharedRoot() {
  const configured = process.env.DATA_DIR;
  if (!configured) {
    throw new Error(
      'DATA_DIR is not set. Copy .env.example to .env and set DATA_DIR to your local OneDrive path.'
    );
  }
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(projectRoot, configured);
}

/** Internal JSON / letters live here — not for direct hand-editing. */
export const APP_DATA_DIRNAME = '_app_data';

/** Read-facing workbook — sibling of `_app_data/`, regenerated from app data. */
export const WORKBOOK_FILENAME = 'RouteChangeTracker.xlsx';

/**
 * Absolute path to `_app_data` (source-of-truth JSON).
 * @returns {string}
 */
export function getAppDataDir() {
  return path.join(getSharedRoot(), APP_DATA_DIRNAME);
}

/**
 * @deprecated Prefer getAppDataDir() — kept as alias for older call sites.
 * @returns {string}
 */
export function getDataDir() {
  return getAppDataDir();
}

/** @returns {string} */
export function getWorkbookPath() {
  return path.join(getSharedRoot(), WORKBOOK_FILENAME);
}

export const FILE_NAMES = {
  changeLog: 'change-log.json',
  routeState: 'route-state.json',
  schoolCalendar: 'school-calendar.json',
  adjustmentReasons: 'adjustment-reasons.json',
  staffNames: 'staff-names.json',
  payrollSettings: 'payroll-settings.json',
  drivers: 'drivers.json',
  workbookWriteMeta: 'workbook-write-meta.json',
  workbookReconciliation: 'workbook-reconciliation.json',
  workbookSyncStatus: 'workbook-sync-status.json',
};

export const LETTERS_DIR = 'letters';

export const BID_THRESHOLD_MINUTES = 30;

export const PORT = Number(process.env.PORT) || 3847;

export const SEGMENTS = ['AM', 'MIDDAY', 'PM'];

export const REASON_CATEGORIES = ['MV', 'SPED', 'OTHER'];

export const ROUTE_STATUSES = [
  'STABLE',
  'ACCUMULATING',
  'LOCKED_PENDING',
  'BID_PENDING',
  'NEEDS_REVIEW',
];
