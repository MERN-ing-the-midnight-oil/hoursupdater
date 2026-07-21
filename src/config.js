import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/** Optional absolute/relative path to .env (portable Start.bat sets this). */
const envFile = process.env.ENV_FILE
  ? path.isAbsolute(process.env.ENV_FILE)
    ? process.env.ENV_FILE
    : path.resolve(process.cwd(), process.env.ENV_FILE)
  : path.resolve(projectRoot, '.env');

dotenv.config({ path: envFile });

/**
 * Civil "today" (UTC) for window math and Admin queue ages.
 * @returns {string} YYYY-MM-DD
 */
export function getAsOfDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Timestamp for change-log / Admin event stamps (real clock).
 * @returns {string} ISO-8601 timestamp
 */
export function getAsOfTimestamp() {
  return new Date().toISOString();
}

/**
 * Shared folder root (typically OneDrive when live, or ./data locally).
 * Contains `_app_data/` (internal JSON) and `RouteChangeTracker.xlsx` (read-facing).
 * @returns {string}
 */
export function getSharedRoot() {
  const configured = process.env.DATA_DIR;
  if (!configured?.trim()) {
    const error = new Error(
      'DATA_DIR is not set. Copy .env.example to .env and set DATA_DIR ' +
        '(see SETUP-ONEDRIVE.md).'
    );
    error.code = 'DATA_DIR_UNSET';
    throw error;
  }
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(projectRoot, configured);
}

/** Raw DATA_DIR string from the environment (may be relative or a placeholder). */
export function getConfiguredDataDir() {
  return process.env.DATA_DIR ?? null;
}

/** Path to the .env file that was loaded (or attempted). */
export function getEnvFilePath() {
  return envFile;
}

/** Internal JSON / letters live here — not for direct hand-editing. */
export const APP_DATA_DIRNAME = '_app_data';

/** Read-facing workbook — sibling of `_app_data/`, regenerated from app data. */
export const WORKBOOK_FILENAME = 'RouteChangeTracker.xlsx';

/** Year-end snapshots live here — sibling of `_app_data/`, admin-named folders. */
export const ARCHIVES_DIRNAME = 'archives';

/**
 * Absolute path to the archives root under the shared DATA_DIR.
 * @returns {string}
 */
export function getArchivesDir() {
  return path.join(getSharedRoot(), ARCHIVES_DIRNAME);
}

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
  reasonCategories: 'reason-categories.json',
  staffNames: 'staff-names.json',
  payrollSettings: 'payroll-settings.json',
  emailTemplates: 'email-templates.json',
  notifications: 'notifications.json',
  drivers: 'drivers.json',
  appSettings: 'app-settings.json',
  workbookWriteMeta: 'workbook-write-meta.json',
  workbookReconciliation: 'workbook-reconciliation.json',
  workbookSyncStatus: 'workbook-sync-status.json',
};

export const LETTERS_DIR = 'letters';

export const BID_THRESHOLD_MINUTES = 30;

/** Art. 3.08(a)(8)(b) / (b)(2): days for driver to elect bump or keep assignment. */
export const BUMP_DECISION_SCHOOL_DAYS = 2;

/** Art. 3.08(c)(1): school days to initial the open-bid sign-up (rejection if missed). */
export const BID_RESPONSE_SCHOOL_DAYS = 2;

export const PORT = Number(process.env.PORT) || 3847;

export const SEGMENTS = ['AM', 'MIDDAY', 'PM'];

export const REASON_CATEGORIES = ['MV', 'SPED', 'OTHER'];

export const ROUTE_STATUSES = [
  'STABLE',
  'ACCUMULATING',
  'LOCKED_PENDING',
  'BID_PENDING',
  'BUMP_ELIGIBLE',
  'NEEDS_REVIEW',
];
