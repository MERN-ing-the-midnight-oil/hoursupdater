#!/usr/bin/env node
/**
 * Portable Windows preflight — run by Start.bat before launching the server.
 * Exits 0 on success; prints plain-English errors and exits 1 on failure.
 */
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getConfiguredDataDir,
  getEnvFilePath,
  getSharedRoot,
  PORT,
} from '../src/config.js';
import {
  assertSharedRootReady,
  getAppFolderOneDriveWarning,
  isDataDirConfigError,
} from '../src/logic/dataDirValidation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fail(message) {
  console.error('');
  console.error('*** Teamster Tracker could not start ***');
  console.error('');
  console.error(message);
  console.error('');
  process.exit(1);
}

function warn(message) {
  console.warn('');
  console.warn('*** Warning (app will still start) ***');
  console.warn('');
  console.warn(message);
  console.warn('');
}

/**
 * Folder that contains Start.bat / .env (portable install root).
 * Falls back to the repo root when running outside the zip layout.
 */
function getInstallRoot() {
  const envFile = getEnvFilePath();
  if (envFile) {
    return path.dirname(envFile);
  }
  return path.resolve(__dirname, '..');
}

async function portLooksFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function main() {
  const envPath = getEnvFilePath();
  try {
    await fs.access(envPath);
  } catch {
    fail(
      `Missing .env file:\n  ${envPath}\n\n` +
        'Copy .env.example to .env (same folder as Start.bat), then follow SETUP-ONEDRIVE.md.'
    );
  }

  const installRoot = getInstallRoot();
  const oneDriveWarning = getAppFolderOneDriveWarning(installRoot);
  if (oneDriveWarning) {
    warn(oneDriveWarning);
  }

  let sharedRoot;
  try {
    sharedRoot = getSharedRoot();
  } catch (error) {
    if (isDataDirConfigError(error)) {
      fail(error.message);
    }
    throw error;
  }

  try {
    await assertSharedRootReady(sharedRoot, {
      configured: getConfiguredDataDir(),
    });
  } catch (error) {
    if (isDataDirConfigError(error)) {
      fail(error.message);
    }
    throw error;
  }

  const free = await portLooksFree(PORT);
  if (!free) {
    fail(
      `Port ${PORT} is already in use on this computer.\n\n` +
        'That usually means Teamster Tracker is already running in another ' +
        'black window, or another program took the port.\n\n' +
        'What to try:\n' +
        '  1. Look for another Teamster Tracker command window and close it\n' +
        `  2. Or open Edge to http://localhost:${PORT} — the app may already be up\n` +
        '  3. If something else owns the port, change PORT= in .env (e.g. 3848)'
    );
  }

  console.log('Preflight OK');
  console.log(`  .env       ${envPath}`);
  console.log(`  DATA_DIR   ${sharedRoot}`);
  console.log(`  PORT       ${PORT}`);
  console.log(`  install    ${installRoot}`);
  // Machine-readable line for Start.bat (do not reword)
  console.log(`PREFLIGHT_URL=http://localhost:${PORT}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack || error.message : String(error));
});
