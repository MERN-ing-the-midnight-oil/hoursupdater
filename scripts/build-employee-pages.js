import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(root, 'employee-tracker', 'web');
const docsDir = path.join(root, 'docs');

await fs.mkdir(docsDir, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: [path.join(webDir, 'app.js')],
  outfile: path.join(docsDir, 'app.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  legalComments: 'none',
});

const staticAssets = [
  'index.html',
  'styles.css',
  'clock-hours-guide.html',
  'favicon.ico',
  'favicon.svg',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'site.webmanifest',
];

for (const name of staticAssets) {
  await fs.copyFile(path.join(webDir, name), path.join(docsDir, name));
}

await fs.writeFile(path.join(docsDir, '.nojekyll'), '');

console.log(`Wrote GitHub Pages site to ${docsDir}`);
