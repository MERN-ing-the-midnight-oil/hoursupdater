import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(root, 'office-tracker', 'web');
const distDir = path.join(root, 'office-tracker', 'dist');
const vendorDir = path.join(distDir, 'vendor');

const vendorPackages = {
  '@supabase/supabase-js': 'supabase',
  exceljs: 'exceljs',
  jspdf: 'jspdf',
  html2canvas: 'html2canvas',
  qrcode: 'qrcode',
};

await fs.rm(vendorDir, { recursive: true, force: true });
await fs.mkdir(distDir, { recursive: true });
const previous = await fs.readdir(distDir);
await Promise.all(
  previous
    .filter((name) => name.endsWith('.js') || name.endsWith('.map'))
    .map((name) => fs.unlink(path.join(distDir, name)))
);

const shimDir = path.join(root, 'office-tracker', '.vendor-entry');
await fs.rm(shimDir, { recursive: true, force: true });
await fs.mkdir(shimDir, { recursive: true });
const vendorEntries = {};
for (const [specifier, name] of Object.entries(vendorPackages)) {
  const shimPath = path.join(shimDir, `${name}-entry.js`);
  const quoted = JSON.stringify(specifier);
  const source = specifier === 'jspdf' || specifier === '@supabase/supabase-js'
    ? `export * from ${quoted};\n`
    : `export { default } from ${quoted};\n`;
  await fs.writeFile(shimPath, source);
  vendorEntries[name] = shimPath;
}

try {
  await build({
    absWorkingDir: root,
    entryPoints: vendorEntries,
    outdir: vendorDir,
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    legalComments: 'none',
  });
} finally {
  await fs.rm(shimDir, { recursive: true, force: true });
}

const appBuild = await build({
  absWorkingDir: root,
  entryPoints: {
    app: path.join(webDir, 'app.js'),
    'math-page': path.join(webDir, 'mathPage.js'),
    'driver-clock': path.join(webDir, 'driverClockPage.js'),
    'driver-note': path.join(webDir, 'driverNotePage.js'),
  },
  outdir: distDir,
  bundle: true,
  splitting: true,
  minify: false,
  sourcemap: 'linked',
  sourcesContent: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  legalComments: 'none',
  packages: 'external',
  metafile: true,
});

const importMap = {
  imports: Object.fromEntries(
    Object.entries(vendorPackages).map(([specifier, name]) => [specifier, `./vendor/${name}.js`])
  ),
};
const importMapTag = `<script type="importmap">\n${JSON.stringify(importMap, null, 2)}\n</script>\n`;

const staticAssets = [
  'index.html',
  'styles.css',
  'office.css',
  'clock-hours-guide.html',
  'monthly-summary.html',
  'monthly-summary-math.html',
  'driver-clock.html',
  'driver-note.html',
  'favicon.ico',
  'favicon.svg',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'site.webmanifest',
];

for (const name of staticAssets) {
  const sourcePath = path.join(webDir, name);
  let contents = await fs.readFile(sourcePath);
  if (name.endsWith('.html')) {
    let html = contents.toString('utf8');
    if (html.includes('type="module"') && !html.includes('type="importmap"')) {
      html = html.includes('<head>')
        ? html.replace('<head>', `<head>\n    ${importMapTag}`)
        : `${importMapTag}${html}`;
    }
    contents = Buffer.from(html);
  }
  await fs.writeFile(path.join(distDir, name), contents);
}

await fs.cp(path.join(webDir, 'driver-photos'), path.join(distDir, 'driver-photos'), {
  recursive: true,
  force: true,
});

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

const shipped = Object.keys(appBuild.metafile.inputs)
  .filter((file) => !file.startsWith('node_modules/'))
  .sort();
await fs.writeFile(
  path.join(os.tmpdir(), 'office-pages-sources.txt'),
  `${shipped.join('\n')}\n`
);

console.log(`Wrote the Teamster Time Changes Dashboard to ${distDir}`);
