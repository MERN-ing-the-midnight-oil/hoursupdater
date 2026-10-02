import dotenv from 'dotenv';
import express from 'express';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildDriverPacket, packetPdfBasename } from './driverPacket.js';
import {
  chromeExecutable,
  isEmailAddress,
  mailBatchScript,
  mailDraftScript,
  openMailDraft,
  writeGuidePdf,
} from './guideMail.js';
import {
  ROUTE_DATA_FILE_BASE,
  payrollWorkbookFilename,
  stampedWorkbookFilename,
  workbookTitleFromFilename,
} from './downloadName.js';
import { buildPayrollWorkbook, rowsFromPayrollWorkbook } from './payrollTimes.js';
import { buildRouteWorkbook, stateFromRouteWorkbook } from './routeWorkbook.js';
import { handleTimesheetExtract } from './timesheetExtract.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const PORT = Number(process.env.OFFICE_PORT) || 3849;

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * @param {string} body
 */
function mentionGuide(body) {
  const text = String(body ?? '');
  if (/bus driver's guide/i.test(text)) return text;
  return `${text.replace(/\s*$/, '')}\n\nThe bus driver's guide to clock hours is also attached.\n`;
}

const app = express();
app.post('/api/timesheet-extract', express.json({ limit: '32mb' }), (req, res) => {
  handleTimesheetExtract(req, res).catch((error) => {
    if (res.headersSent) return;
    res.status(500).json({ error: error.message || 'Could not read that time card.' });
  });
});
app.use(express.json({ limit: '2mb' }));
app.use(express.static(distDir));

function packetStylesheetHrefs() {
  return ['styles.css', 'office.css'].map((name) =>
    pathToFileURL(path.join(distDir, name)).href
  );
}

/** @type {Promise<string> | null} */
let guidePdf = null;

function guidePdfPath() {
  if (!guidePdf) {
    guidePdf = (async () => {
      const chromePath = chromeExecutable();
      if (!chromePath) {
        throw new Error('Chrome is needed to make the guide PDF, and it was not found.');
      }
      const pdfPath = path.join(os.tmpdir(), 'bus-drivers-guide-to-clock-hours.pdf');
      await writeGuidePdf({
        htmlUrl: pathToFileURL(path.join(distDir, 'clock-hours-guide.html')).href,
        pdfPath,
        chromePath,
        execFile: execFileAsync,
      });
      return pdfPath;
    })().catch((error) => {
      guidePdf = null;
      throw error;
    });
  }
  return guidePdf;
}

app.post('/api/email-driver-packet', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim();
  const profiles = Array.isArray(req.body?.profiles) ? req.body.profiles : [];
  const attachGuide = req.body?.attachGuide === true;
  if (!name) {
    res.status(400).json({ error: 'Choose a driver.' });
    return;
  }
  if (!isEmailAddress(email)) {
    res.status(400).json({ error: `${name} has no email on the Driver Name List.` });
    return;
  }
  const packet = buildDriverPacket({
    driverName: name,
    profiles,
    stylesheets: packetStylesheetHrefs(),
  });
  if (!packet) {
    res.status(400).json({ error: `${name} has no route history to send.` });
    return;
  }
  const chromePath = chromeExecutable();
  if (!chromePath) {
    res.status(500).json({
      error: 'Chrome is needed to make the history PDF, and it was not found.',
    });
    return;
  }
  const id = randomBytes(4).toString('hex');
  const base = packetPdfBasename(name);
  const htmlPath = path.join(os.tmpdir(), `${base}-${id}.html`);
  const pdfPath = path.join(os.tmpdir(), `${base}-${id}.pdf`);
  try {
    await writeFile(htmlPath, packet.html);
    await writeGuidePdf({
      htmlUrl: pathToFileURL(htmlPath).href,
      pdfPath,
      chromePath,
      execFile: execFileAsync,
    });
    const guidePath = attachGuide ? await guidePdfPath() : null;
    await openMailDraft(
      mailDraftScript({
        to: email,
        name,
        pdfPath,
        extraPdfPaths: guidePath ? [guidePath] : [],
        subject: packet.mail.subject,
        body: guidePath ? mentionGuide(packet.mail.body) : packet.mail.body,
      }),
      execFileAsync
    );
    res.json({ ok: true, routes: packet.routeNames });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not open the email.' });
  }
});

app.post('/api/email-notice-batch', async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const profiles = Array.isArray(req.body?.profiles) ? req.body.profiles : [];
  const asOf = String(req.body?.asOf ?? '').trim();
  const include = {
    summary: true,
    narrative: true,
    history: true,
    calendar: true,
    guide: true,
  };
  if (!messages.length) {
    res.status(400).json({ error: 'Choose a clock-time change to send.' });
    return;
  }
  if (messages.length > 40) {
    res.status(400).json({
      error: 'That is more than 40 drafts. Narrow the dates or notice types, then generate again.',
    });
    return;
  }
  const chromePath = chromeExecutable();
  if (!chromePath) {
    res.status(500).json({
      error: 'Chrome is needed to make the history PDF, and it was not found.',
    });
    return;
  }
  /** @type {Array<{ to: string, name: string, pdfPath: string, subject: string, body: string }>} */
  const drafts = [];
  try {
    for (const message of messages) {
      const name = String(message?.name ?? '').trim();
      const email = String(message?.email ?? '').trim();
      const routes = Array.isArray(message?.routes) ? message.routes : [];
      if (!name) {
        res.status(400).json({ error: 'Choose a driver.' });
        return;
      }
      if (!isEmailAddress(email)) {
        res.status(400).json({ error: `${name} has no email on the Driver Name List.` });
        return;
      }
      const packet = buildDriverPacket({
        driverName: name,
        profiles,
        stylesheets: packetStylesheetHrefs(),
        asOf: asOf || undefined,
        include,
        onlyRouteNames: routes,
        mail: {
          subject: message?.subject,
          body: message?.body,
        },
      });
      if (!packet) {
        res.status(400).json({ error: `${name} has no route history to send.` });
        return;
      }
      const id = randomBytes(4).toString('hex');
      const base = packetPdfBasename(name);
      const htmlPath = path.join(os.tmpdir(), `${base}-${id}.html`);
      const pdfPath = path.join(os.tmpdir(), `${base}-${id}.pdf`);
      await writeFile(htmlPath, packet.html);
      await writeGuidePdf({
        htmlUrl: pathToFileURL(htmlPath).href,
        pdfPath,
        chromePath,
        execFile: execFileAsync,
      });
      const guidePath = include.guide ? await guidePdfPath() : null;
      drafts.push({
        to: email,
        name,
        pdfPath,
        extraPdfPaths: guidePath ? [guidePath] : [],
        subject: packet.mail.subject,
        body: guidePath ? mentionGuide(packet.mail.body) : packet.mail.body,
      });
    }
    await openMailDraft(mailBatchScript(drafts), execFileAsync);
    res.json({ ok: true, count: drafts.length });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not open the emails.' });
  }
});

/**
 * @param {import('express').Response} res
 * @param {Buffer} buffer
 * @param {string} filename
 */
function sendWorkbook(res, buffer, filename) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

app.post('/api/payroll-workbook', async (req, res) => {
  try {
    const body = req.body ?? {};
    const previousPayroll = body.previousPayroll;
    const state = { ...body };
    delete state.previousPayroll;
    /** @type {object[] | null} */
    let previousRows = null;
    if (previousPayroll) {
      previousRows = await rowsFromPayrollWorkbook(
        Buffer.from(String(previousPayroll), 'base64')
      );
    }
    const createdAt = new Date();
    const filename = payrollWorkbookFilename(createdAt);
    /** @type {{ changedCount?: number }} */
    const result = {};
    const buffer = await buildPayrollWorkbook(state, {
      title: workbookTitleFromFilename(filename),
      createdAt,
      previousRows,
      result,
    });
    if (previousRows) {
      res.setHeader('X-Payroll-Changed-Count', String(result.changedCount ?? 0));
    }
    sendWorkbook(res, buffer, filename);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not create the payroll spreadsheet.' });
  }
});

app.post('/api/route-workbook', async (req, res) => {
  try {
    const createdAt = new Date();
    const filename = stampedWorkbookFilename(ROUTE_DATA_FILE_BASE, createdAt);
    const buffer = await buildRouteWorkbook(req.body ?? {}, {
      title: workbookTitleFromFilename(filename),
      createdAt,
    });
    sendWorkbook(res, buffer, filename);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not create the Excel file.' });
  }
});

app.post(
  '/api/route-workbook/read',
  express.raw({ type: '*/*', limit: '12mb' }),
  async (req, res) => {
    try {
      const state = await stateFromRouteWorkbook(req.body, {
        currentRoute: String(req.query.route ?? ''),
      });
      res.json(state);
    } catch (error) {
      res.status(400).json({ error: error.message || 'Could not read that Excel file.' });
    }
  }
);

app.get('/api/supabase-config', (_req, res) => {
  const url = String(process.env.SUPABASE_URL ?? '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !anonKey) {
    res.json({ enabled: false });
    return;
  }
  res.json({ enabled: true, url, anonKey });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Teamster Time Changes Dashboard listening on http://localhost:${PORT}`);
  console.log('Each route is a tab. Signed-in changes are saved to the shared account.');
  console.log('Leave this window open while you use the app.');
});
