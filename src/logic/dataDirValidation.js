import fs from 'node:fs/promises';

/**
 * Plain-English guidance when the configured shared folder is missing or unusable.
 * Kept in one place so Start.bat preflight and server startup say the same thing.
 */
export const DATA_DIR_SETUP_HINT =
  'See SETUP-ONEDRIVE.md (Set Up on OneDrive): create the folder in File Explorer, ' +
  'then put that full path in the .env file as DATA_DIR.';

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isDataDirConfigError(error) {
  return (
    error instanceof Error &&
    (error.code === 'DATA_DIR_MISSING' ||
      error.code === 'DATA_DIR_NOT_DIR' ||
      error.code === 'DATA_DIR_UNSET' ||
      error.code === 'DATA_DIR_PLACEHOLDER' ||
      error.code === 'DATA_DIR_URL')
  );
}

/**
 * @param {string | undefined | null} configured
 * @returns {boolean}
 */
export function looksLikeUnsetOrPlaceholderDataDir(configured) {
  if (configured == null) return true;
  const text = String(configured).trim();
  if (!text) return true;
  const upper = text.toUpperCase();
  return (
    upper.includes('REPLACE_ME') ||
    upper.includes('YOUR_USERNAME') ||
    upper.includes('PATH\\TO\\') ||
    upper.includes('PATH/TO/') ||
    upper.includes('EXAMPLE')
  );
}

/**
 * True when DATA_DIR looks like a browser/share link instead of a folder path.
 * Common mistake: pasting a OneDrive sharing URL instead of "Copy as path".
 *
 * @param {string | undefined | null} configured
 * @returns {boolean}
 */
export function looksLikeWebUrlDataDir(configured) {
  if (configured == null) return false;
  const text = String(configured).trim().toLowerCase();
  return text.startsWith('http://') || text.startsWith('https://');
}

/**
 * Ensure DATA_DIR is set to a real folder that already exists.
 * Does not create the shared root — Rachel (or IT) creates it in OneDrive first.
 *
 * @param {string | undefined | null} sharedRoot absolute path
 * @param {{ configured?: string | null }} [options]
 * @returns {Promise<string>} absolute shared root
 */
export async function assertSharedRootReady(sharedRoot, options = {}) {
  const configured = options.configured;

  if (
    sharedRoot == null ||
    String(sharedRoot).trim() === '' ||
    looksLikeUnsetOrPlaceholderDataDir(configured ?? sharedRoot)
  ) {
    const error = new Error(
      'DATA_DIR is not set to a real folder yet.\n\n' +
        'Open the .env file next to Start.bat and set DATA_DIR to your OneDrive ' +
        'RouteChangeTracker folder path.\n\n' +
        DATA_DIR_SETUP_HINT
    );
    error.code = 'DATA_DIR_PLACEHOLDER';
    throw error;
  }

  const configuredText =
    configured != null ? String(configured).trim() : String(sharedRoot).trim();

  if (looksLikeWebUrlDataDir(configuredText)) {
    const error = new Error(
      'DATA_DIR looks like a web link, not a folder location.\n\n' +
        `  ${configuredText}\n\n` +
        "Please use 'Copy as path' from File Explorer instead of a sharing " +
        'link — see SETUP-ONEDRIVE.md.'
    );
    error.code = 'DATA_DIR_URL';
    throw error;
  }

  const root = String(sharedRoot).trim();

  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    const error = new Error(
      `The OneDrive data folder was not found:\n  ${root}\n\n` +
        'Common causes:\n' +
        '  • The folder was not created yet\n' +
        '  • The path in .env has a typo (spaces and dashes matter)\n' +
        '  • OneDrive is not signed in / not synced on this PC\n' +
        '  • The folder is under a different account name\n\n' +
        DATA_DIR_SETUP_HINT
    );
    error.code = 'DATA_DIR_MISSING';
    throw error;
  }

  if (!stat.isDirectory()) {
    const error = new Error(
      `DATA_DIR must be a folder, but this path is a file:\n  ${root}\n\n` +
        DATA_DIR_SETUP_HINT
    );
    error.code = 'DATA_DIR_NOT_DIR';
    throw error;
  }

  return root;
}
