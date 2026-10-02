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

const envText = await fs.readFile(path.join(root, '.env'), 'utf8');
const envValue = (name) => {
  const match = envText.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match?.[1]?.trim() ?? '';
};
const url = envValue('SUPABASE_URL');
const anonKey = envValue('SUPABASE_ANON_KEY');
if (!url || !anonKey) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env before this build.');
}

await fs.writeFile(
  path.join(distDir, 'supabase-config.json'),
  `${JSON.stringify({ url, anonKey })}\n`
);

console.log(`Wrote the Teamster Time Changes Dashboard to ${distDir}`);
