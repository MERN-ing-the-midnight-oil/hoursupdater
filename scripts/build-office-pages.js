import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(root, 'office-tracker', 'web');
const distDir = path.join(root, 'office-tracker', 'dist');

await fs.mkdir(distDir, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: [path.join(webDir, 'app.js')],
  outfile: path.join(distDir, 'app.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  legalComments: 'none',
});

const staticAssets = [
  'index.html',
  'styles.css',
  'office.css',
  'clock-hours-guide.html',
  'favicon.ico',
  'favicon.svg',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'site.webmanifest',
];

for (const name of staticAssets) {
  await fs.copyFile(path.join(webDir, name), path.join(distDir, name));
}

console.log(`Wrote Transportation Timechange Calculator to ${distDir}`);
