import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleTimesheetAudit } from '../../office-tracker/src/timesheetExtract.js';
import { EMPLOYEE_PORT, projectRoot } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(__dirname, '../../docs');

dotenv.config({ path: path.resolve(projectRoot, '.env') });

const app = express();
app.post('/api/timesheet-audit', express.json({ limit: '32mb' }), (req, res) => {
  handleTimesheetAudit(req, res).catch((error) => {
    if (res.headersSent) return;
    res.status(500).json({ error: error.message || 'Could not audit that time card.' });
  });
});
app.use(express.static(docsDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(docsDir, 'index.html'));
});

app.listen(EMPLOYEE_PORT, () => {
  console.log(`Route change history listening on http://localhost:${EMPLOYEE_PORT}`);
  console.log('Read-only page. Route history comes from the shared office record.');
  console.log('Leave this window open while you use the app.');
});
