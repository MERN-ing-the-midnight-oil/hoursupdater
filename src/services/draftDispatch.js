import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  chromeExecutable,
  mailBatchScript,
  mailDraftScript,
  openMailDraft,
  outlookDraftScript,
  writeGuidePdf,
} from '../../office-tracker/src/guideMail.js';

const execFileAsync = promisify(execFile);

/**
 * @param {{ to: string, subject: string, body: string }} draft
 */
export function mailtoUrl(draft) {
  const query = new URLSearchParams({
    subject: draft.subject || '',
    body: draft.body || '',
  });
  return `mailto:${encodeURIComponent(draft.to)}?${query.toString()}`;
}

/**
 * @param {{ html: string, pdfBasename: string }} input
 */
export async function renderHtmlPdf({ html, pdfBasename }) {
  const chromePath = chromeExecutable();
  if (!chromePath) {
    throw new Error(
      'Chrome or Edge is needed to make the PDF, and neither was found.'
    );
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const htmlPath = path.join(os.tmpdir(), `${pdfBasename}-${id}.html`);
  const pdfPath = path.join(os.tmpdir(), `${pdfBasename}-${id}.pdf`);
  await fs.writeFile(htmlPath, html);
  await writeGuidePdf({
    htmlUrl: pathToFileURL(htmlPath).href,
    pdfPath,
    chromePath,
    execFile: execFileAsync,
  });
  return pdfPath;
}

/**
 * @param {number} port
 */
export function packetStylesheetHrefs(port) {
  return [`http://127.0.0.1:${port}/styles.css`, `http://127.0.0.1:${port}/sheet.css`];
}

/**
 * @param {number} port
 */
export async function renderGuidePdfFile(port) {
  const pdfPath = path.join(os.tmpdir(), 'bus-drivers-guide-to-clock-hours.pdf');
  await renderUrlPdf(
    `http://127.0.0.1:${port}/help/clock-hours-guide.html`,
    pdfPath
  );
  return pdfPath;
}

export async function renderUrlPdf(htmlUrl, pdfPath) {
  const chromePath = chromeExecutable();
  if (!chromePath) {
    throw new Error(
      'Chrome or Edge is needed to make the PDF, and neither was found.'
    );
  }
  await writeGuidePdf({
    htmlUrl,
    pdfPath,
    chromePath,
    execFile: execFileAsync,
  });
  return pdfPath;
}

/**
 * Mac Mail attaches the PDF. Windows opens Outlook with the attachment when
 * Outlook is installed. Otherwise the PDF is saved in the shared folder.
 *
 * @param {Array<{ to: string, name: string, pdfPath: string, subject: string, body: string }>} drafts
 * @param {string} sharedRoot
 */
export async function openDrafts(drafts, sharedRoot) {
  if (!drafts.length) {
    return { mode: 'none', files: [] };
  }
  if (process.platform === 'darwin') {
    const script =
      drafts.length === 1 ? mailDraftScript(drafts[0]) : mailBatchScript(drafts);
    await openMailDraft(script, execFileAsync);
    return { mode: 'mail', files: [] };
  }
  if (process.platform === 'win32') {
    const scriptPath = path.join(os.tmpdir(), `teamster-outlook-${Date.now()}.ps1`);
    await fs.writeFile(scriptPath, outlookDraftScript(drafts));
    try {
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { timeout: 30000 }
      );
      return { mode: 'outlook', files: [] };
    } catch {
      // Outlook is not available. Save the PDFs and return a filled draft.
    }
  }
  const dir = path.join(sharedRoot, 'Mail Drafts');
  await fs.mkdir(dir, { recursive: true });
  const files = [];
  for (const draft of drafts) {
    const base = path.basename(draft.pdfPath);
    const dest = path.join(dir, base);
    await fs.copyFile(draft.pdfPath, dest);
    files.push({
      name: draft.name,
      to: draft.to,
      file: base,
      path: dest,
      mailto: mailtoUrl(draft),
    });
  }
  return { mode: 'saved', files };
}
