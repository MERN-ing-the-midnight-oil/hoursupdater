#!/usr/bin/env node
/**
 * Build a portable Windows package:
 *   dist/TeamsterTracker-win/
 *   dist/TeamsterTracker-win.zip
 *
 * Downloads official Node.js win-x64 binaries, copies the app + production
 * node_modules, and includes Start.bat + setup/troubleshooting docs.
 *
 * Usage: npm run build:portable-win
 */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const NODE_VERSION = process.env.PORTABLE_NODE_VERSION || '20.19.5';
const NODE_DIST = `node-v${NODE_VERSION}-win-x64`;
const NODE_ZIP_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.zip`;

const outDir = path.join(root, 'dist', 'TeamsterTracker-win');
const cacheDir = path.join(root, 'dist', '.cache');
const zipPath = path.join(root, 'dist', 'TeamsterTracker-win.zip');

/**
 * @param {string} url
 * @param {string} dest
 */
async function download(url, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    const stat = await fs.stat(dest);
    if (stat.size > 1_000_000) {
      console.log(`cache hit: ${dest}`);
      return;
    }
  }
  console.log(`download: ${url}`);
  await new Promise((resolve, reject) => {
    const follow = (currentUrl, redirectsLeft) => {
      https
        .get(currentUrl, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location &&
            redirectsLeft > 0
          ) {
            follow(res.headers.location, redirectsLeft - 1);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          const out = createWriteStream(dest);
          pipeline(res, out).then(resolve).catch(reject);
        })
        .on('error', reject);
    };
    follow(url, 5);
  });
}

/**
 * Extract a single file from a zip using system `unzip` (macOS/Linux build hosts).
 * @param {string} zipFile
 * @param {string} member
 * @param {string} destFile
 */
async function extractZipMember(zipFile, member, destFile) {
  const buf = execFileSync('unzip', ['-p', zipFile, member], {
    maxBuffer: 120 * 1024 * 1024,
  });
  await fs.writeFile(destFile, buf);
}

/**
 * @param {string} from
 * @param {string} to
 */
async function copyDir(from, to) {
  await fs.cp(from, to, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      if (base === 'node_modules' || base === '.git' || base === 'dist') {
        return false;
      }
      return true;
    },
  });
}

async function main() {
  console.log(`Building portable Windows package → ${outDir}`);
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.rm(zipPath, { force: true });
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });

  const nodeZip = path.join(cacheDir, `${NODE_DIST}.zip`);
  await download(NODE_ZIP_URL, nodeZip);

  const runtimeDir = path.join(outDir, 'runtime');
  await fs.mkdir(runtimeDir, { recursive: true });
  const nodeExe = path.join(runtimeDir, 'node.exe');
  console.log(`extract: ${NODE_DIST}/node.exe`);
  await extractZipMember(nodeZip, `${NODE_DIST}/node.exe`, nodeExe);

  await fs.copyFile(
    path.join(root, 'portable', 'windows', 'Start.bat'),
    path.join(outDir, 'Start.bat')
  );
  await fs.copyFile(
    path.join(root, 'portable', 'windows', 'README.txt'),
    path.join(outDir, 'README.txt')
  );
  await fs.copyFile(
    path.join(root, 'portable', 'windows', '.env.example'),
    path.join(outDir, '.env.example')
  );
  await fs.copyFile(
    path.join(root, 'portable', 'windows', '.env.example'),
    path.join(outDir, '.env')
  );

  for (const doc of ['SETUP-ONEDRIVE.md', 'TROUBLESHOOTING.md', 'HANDOFF.md']) {
    await fs.copyFile(path.join(root, doc), path.join(outDir, doc));
  }

  const pkg = JSON.parse(
    await fs.readFile(path.join(root, 'package.json'), 'utf8')
  );
  let gitSha = 'unknown';
  try {
    gitSha = execSync('git rev-parse --short HEAD', {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const dirty = execSync('git status --porcelain', {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    if (dirty) gitSha += '-dirty';
  } catch {
    // ignore — build hosts without git still produce a package
  }
  const buildInfo = [
    'Teamster Tracker — portable Windows package',
    `version: ${pkg.version}`,
    `git:     ${gitSha}`,
    `built:   ${new Date().toISOString()}`,
    `node:    ${NODE_VERSION} (bundled win-x64)`,
    '',
    'Includes:',
    '  - Routing UI: separate Log Change / Create Route tabs',
    '  - DATA_DIR web-link detection (http/https → Copy as path message)',
    '  - Warning when the app folder itself is under OneDrive',
    '',
  ].join('\n');
  await fs.writeFile(path.join(outDir, 'BUILD_INFO.txt'), buildInfo);

  const appDir = path.join(outDir, 'app');
  await fs.mkdir(appDir, { recursive: true });
  // sample-data stays out of the portable zip — roster CSVs are emailed separately.
  for (const name of ['src', 'public', 'defaults', 'scripts']) {
    await copyDir(path.join(root, name), path.join(appDir, name));
  }
  await fs.copyFile(
    path.join(root, 'package.json'),
    path.join(appDir, 'package.json')
  );
  await fs.copyFile(
    path.join(root, 'package-lock.json'),
    path.join(appDir, 'package-lock.json')
  );

  console.log('npm ci --omit=dev (into package app/)');
  execSync('npm ci --omit=dev', {
    cwd: appDir,
    stdio: 'inherit',
    env: process.env,
  });

  // Zip for handoff (exclude macOS junk if present)
  console.log(`zip → ${zipPath}`);
  execSync(
    `zip -qry "${zipPath}" TeamsterTracker-win -x "*.DS_Store"`,
    { cwd: path.join(root, 'dist'), stdio: 'inherit' }
  );

  const nodeStat = await fs.stat(nodeExe);
  const zipStat = await fs.stat(zipPath);
  console.log('');
  console.log('Portable package ready:');
  console.log(`  folder: ${outDir}`);
  console.log(`  zip:    ${zipPath} (${Math.round(zipStat.size / 1024 / 1024)} MB)`);
  console.log(`  node:   runtime/node.exe (${Math.round(nodeStat.size / 1024 / 1024)} MB)`);
  console.log('');
  console.log('Before sending to Rachel: open the zip yourself, confirm');
  console.log('runtime\\node.exe is present, and share via OneDrive/Teams');
  console.log('(email often blocks .exe / large zips).');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
