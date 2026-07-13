#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DATA_DIRNAME } from '../src/config.js';
import { syncWorkbook } from '../src/services/workbookSync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const sampleDir = path.join(root, 'sample-data');
const sharedRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'data');
const appDataDir = path.join(sharedRoot, APP_DATA_DIRNAME);

await fs.mkdir(path.join(appDataDir, 'letters'), { recursive: true });

for (const name of [
  'school-calendar.json',
  'route-state.json',
  'change-log.json',
  'drivers.json',
]) {
  const dest = path.join(appDataDir, name);
  try {
    await fs.access(dest);
    console.log(`skip (exists): ${dest}`);
  } catch {
    await fs.copyFile(path.join(sampleDir, name), dest);
    console.log(`created: ${dest}`);
  }
}

const workbook = await syncWorkbook({ sharedRoot, appDataDir });
console.log(`workbook: ${workbook.status} → ${workbook.path}`);
console.log(`Sample data ready in ${appDataDir}`);
