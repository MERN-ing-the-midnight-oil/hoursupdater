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

await fs.copyFile(path.join(webDir, 'index.html'), path.join(docsDir, 'index.html'));
await fs.copyFile(path.join(webDir, 'styles.css'), path.join(docsDir, 'styles.css'));
await fs.writeFile(path.join(docsDir, '.nojekyll'), '');

console.log(`Wrote GitHub Pages site to ${docsDir}`);
