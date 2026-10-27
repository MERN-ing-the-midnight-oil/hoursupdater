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
  entryPoints: [path.join(webDir, 'historyPage.js')],
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

const envPath = path.join(root, '.env');
let envText = '';
try {
  envText = await fs.readFile(envPath, 'utf8');
} catch {
  envText = '';
}
const envValue = (name) => {
  const match = envText.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match?.[1]?.trim() ?? '';
};
const url = envValue('SUPABASE_URL');
const anonKey = envValue('SUPABASE_ANON_KEY');
await fs.writeFile(
  path.join(docsDir, 'supabase-config.json'),
  `${JSON.stringify(url && anonKey ? { url, anonKey } : { enabled: false })}\n`
);

console.log(`Wrote GitHub Pages site to ${docsDir}`);
