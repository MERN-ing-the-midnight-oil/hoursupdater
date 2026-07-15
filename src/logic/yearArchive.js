/**
 * Year-archive preview / folder-name rules for "Archive Year & Import New Roster".
 * Archive itself is a file copy only — see services/yearArchive.js.
 */

/** Route statuses that are "mid-flight" and should be named in the archive preview. */
export const MID_FLIGHT_STATUSES = [
  'ACCUMULATING',
  'BID_PENDING',
  'BUMP_ELIGIBLE',
  'NEEDS_REVIEW',
];

export const ARCHIVE_PURPOSE =
  'This archive exists so a past year\'s decisions can be looked up later — for example, if a driver has a question or complaint about something decided in a previous year.';

export const FIRST_USE_NOTE =
  'No existing data found — nothing to archive. This will be the first roster import.';

const FOLDER_NAME_MAX = 120;
/** Letters, digits, spaces, and a short list of punctuation admins commonly want. */
const FOLDER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._'\-()&]*$/;

/**
 * @param {unknown[]} drivers
 * @param {Record<string, unknown>} routeState
 * @param {unknown[]} changeLog
 * @returns {boolean}
 */
export function hasMeaningfulAppData(drivers, routeState, changeLog) {
  const driverCount = Array.isArray(drivers) ? drivers.length : 0;
  const routeCount =
    routeState && typeof routeState === 'object' && !Array.isArray(routeState)
      ? Object.keys(routeState).length
      : 0;
  const logCount = Array.isArray(changeLog) ? changeLog.length : 0;
  return driverCount > 0 || routeCount > 0 || logCount > 0;
}

/**
 * @param {string} raw
 * @returns {string} trimmed folder name
 */
export function normalizeArchiveFolderName(raw) {
  return String(raw ?? '').trim();
}

/**
 * Admin-chosen archive folder name (not a path). Rejects traversal and odd chars.
 * @param {string} raw
 * @returns {string} normalized name
 */
export function validateArchiveFolderName(raw) {
  const name = normalizeArchiveFolderName(raw);
  if (!name) {
    throw Object.assign(new Error('Archive folder name is required.'), {
      code: 'INVALID_FOLDER_NAME',
    });
  }
  if (name.length > FOLDER_NAME_MAX) {
    throw Object.assign(
      new Error(
        `Archive folder name must be ${FOLDER_NAME_MAX} characters or fewer.`
      ),
      { code: 'INVALID_FOLDER_NAME' }
    );
  }
  if (name === '.' || name === '..') {
    throw Object.assign(new Error('Archive folder name is not allowed.'), {
      code: 'INVALID_FOLDER_NAME',
    });
  }
  if (
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.includes('..')
  ) {
    throw Object.assign(
      new Error(
        'Archive folder name cannot contain path separators or "..".'
      ),
      { code: 'INVALID_FOLDER_NAME' }
    );
  }
  if (!FOLDER_NAME_RE.test(name)) {
    throw Object.assign(
      new Error(
        'Archive folder name may use letters, numbers, spaces, and . _ \' - ( ) & only.'
      ),
      { code: 'INVALID_FOLDER_NAME' }
    );
  }
  return name;
}

/**
 * Confirm-by-retyping: confirm must match the chosen folder name exactly
 * (after trim on both sides).
 * @param {string} folderName
 * @param {string} confirmName
 */
export function assertFolderNameConfirmed(folderName, confirmName) {
  const chosen = normalizeArchiveFolderName(folderName);
  const confirm = normalizeArchiveFolderName(confirmName);
  if (!confirm) {
    throw Object.assign(
      new Error('Retype the archive folder name to confirm.'),
      { code: 'CONFIRM_MISMATCH' }
    );
  }
  if (confirm !== chosen) {
    throw Object.assign(
      new Error(
        'Confirmation does not match the archive folder name. Retype it exactly.'
      ),
      { code: 'CONFIRM_MISMATCH' }
    );
  }
}

/**
 * @typedef {Object} MidFlightRoute
 * @property {string} route_id
 * @property {string} status
 */

/**
 * @typedef {Object} YearArchivePreview
 * @property {boolean} has_meaningful_data
 * @property {number} drivers_count
 * @property {number} routes_count
 * @property {number} change_log_entries
 * @property {number} letters_count
 * @property {boolean} workbook_present
 * @property {MidFlightRoute[]} mid_flight_routes
 * @property {string} purpose
 * @property {string} first_use_note
 */

/**
 * Build a dry-run preview of what would be copied into an archive folder.
 * @param {object} args
 * @param {unknown[]} args.drivers
 * @param {Record<string, { status?: string }>} args.routeState
 * @param {unknown[]} args.changeLog
 * @param {number} [args.lettersCount]
 * @param {boolean} [args.workbookPresent]
 * @returns {YearArchivePreview}
 */
export function buildYearArchivePreview({
  drivers,
  routeState,
  changeLog,
  lettersCount = 0,
  workbookPresent = false,
}) {
  const safeDrivers = Array.isArray(drivers) ? drivers : [];
  const safeLog = Array.isArray(changeLog) ? changeLog : [];
  const safeState =
    routeState && typeof routeState === 'object' && !Array.isArray(routeState)
      ? routeState
      : {};

  /** @type {MidFlightRoute[]} */
  const midFlight = [];
  for (const [routeId, entry] of Object.entries(safeState)) {
    const status = entry?.status ? String(entry.status) : '';
    if (MID_FLIGHT_STATUSES.includes(status)) {
      midFlight.push({ route_id: routeId, status });
    }
  }
  midFlight.sort((a, b) => {
    const byStatus = a.status.localeCompare(b.status);
    return byStatus !== 0 ? byStatus : a.route_id.localeCompare(b.route_id);
  });

  return {
    has_meaningful_data: hasMeaningfulAppData(
      safeDrivers,
      safeState,
      safeLog
    ),
    drivers_count: safeDrivers.length,
    routes_count: Object.keys(safeState).length,
    change_log_entries: safeLog.length,
    letters_count: Number.isFinite(lettersCount) ? lettersCount : 0,
    workbook_present: Boolean(workbookPresent),
    mid_flight_routes: midFlight,
    purpose: ARCHIVE_PURPOSE,
    first_use_note: FIRST_USE_NOTE,
  };
}
