import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PORT,
  getAppDataDir,
  getConfiguredDataDir,
  getSharedRoot,
  getWorkbookPath,
} from './config.js';
import apiRouter from './routes/api.js';
import { ensureDataDir } from './data/storage.js';
import {
  assertSharedRootReady,
  isDataDirConfigError,
} from './logic/dataDirValidation.js';
import { syncWorkbook } from './services/workbookSync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

const app = express();

app.use(express.json({ limit: '1mb' }));

app.use('/api', apiRouter);

// Page routes before static so /admin and /routing are not stolen by
// express.static directory redirects for public/admin and public/routing.
app.get('/', (_req, res) => {
  res.redirect('/routing');
});

app.get(['/routing', '/routing/'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'routing', 'index.html'));
});

app.get(['/admin', '/admin/'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin', 'index.html'));
});

app.get(['/admin/drivers', '/admin/drivers/'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin', 'drivers.html'));
});

app.get('/admin/drivers/:driverId', (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin', 'driver.html'));
});

app.get(['/help', '/help/'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'help', 'index.html'));
});

app.use(express.static(publicDir));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: error instanceof Error ? error.message : 'Unexpected server error',
    dataDir: (() => {
      try {
        return getAppDataDir();
      } catch {
        return null;
      }
    })(),
  });
});

try {
  await assertSharedRootReady(getSharedRoot(), {
    configured: getConfiguredDataDir(),
  });
} catch (error) {
  if (isDataDirConfigError(error)) {
    console.error('\n*** Cannot start Teamster Tracker ***\n');
    console.error(error instanceof Error ? error.message : error);
    console.error('');
    process.exit(1);
  }
  throw error;
}

await ensureDataDir(getAppDataDir());
try {
  const workbook = await syncWorkbook();
  console.log(
    `Workbook sync on startup: ${workbook.status}${
      workbook.reason ? ` (${workbook.reason})` : ''
    }`
  );
} catch (error) {
  console.error('Workbook sync on startup failed:', error);
}

app.listen(PORT, () => {
  console.log(`Teamster Tracker listening on http://localhost:${PORT}`);
  console.log(`Shared root (DATA_DIR)=${getSharedRoot()}`);
  console.log(`App data=_app_data → ${getAppDataDir()}`);
  console.log(`Workbook=${getWorkbookPath()}`);
  console.log(`Routing: http://localhost:${PORT}/routing`);
  console.log('');
  console.log('If your browser did not open, paste this into Edge:');
  console.log(`  http://localhost:${PORT}`);
  console.log('');
  console.log('Leave this window open while you use the app.');
  console.log('Close it (or press Ctrl+C) to stop the app.');
});
