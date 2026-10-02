import { existsSync } from 'node:fs';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

/**
 * @param {string} value
 */
export function isEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}

/**
 * @param {string} value
 */
export function escapeAppleScriptString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * @param {{ to: string, name: string, pdfPath: string, subject: string, body: string }} draft
 */
/**
 * The history or notice PDF, plus any extra files such as the clock-hours guide.
 * @param {{ pdfPath?: string, extraPdfPaths?: string[] }} draft
 */
export function attachmentPaths(draft) {
  return [draft?.pdfPath, ...(draft?.extraPdfPaths || [])].filter(Boolean);
}

function mailMessageBlock(draft) {
  const to = escapeAppleScriptString(draft.to);
  const name = escapeAppleScriptString(draft.name);
  const subject = escapeAppleScriptString(draft.subject);
  const body = escapeAppleScriptString(draft.body);
  const attachments = attachmentPaths(draft)
    .map(
      (pdfPath) =>
        `    make new attachment with properties {file name:POSIX file "${escapeAppleScriptString(pdfPath)}"} at after the last paragraph`
    )
    .join('\n');
  return `  set theMessage to make new outgoing message with properties {visible:true, subject:"${subject}", content:"${body}"}
  tell theMessage
    make new to recipient at end of to recipients with properties {name:"${name}", address:"${to}"}
${attachments}
  end tell`;
}

/**
 * @param {{ to: string, name: string, pdfPath: string, subject: string, body: string }} draft
 */
export function mailDraftScript(draft) {
  return `tell application "Mail"
${mailMessageBlock(draft)}
  activate
end tell`;
}

/**
 * One Mail activation for every draft in the batch.
 * @param {Array<{ to: string, name: string, pdfPath: string, subject: string, body: string }>} drafts
 */
export function mailBatchScript(drafts) {
  const blocks = (drafts ?? []).map((draft) => mailMessageBlock(draft)).join('\n');
  return `tell application "Mail"
${blocks}
  activate
end tell`;
}

/**
 * @param {(path: string) => boolean} [exists]
 */
export function chromeExecutable(exists = existsSync) {
  return CHROME_CANDIDATES.find((candidate) => exists(candidate)) ?? null;
}

/**
 * @param {{ htmlUrl: string, pdfPath: string, chromePath: string, execFile: Function }} options
 */
export async function writeGuidePdf({ htmlUrl, pdfPath, chromePath, execFile }) {
  await execFile(
    chromePath,
    [
      '--headless',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdfPath}`,
      htmlUrl,
    ],
    { timeout: 60000 }
  );
}

/**
 * @param {string} script
 * @param {Function} execFile
 */
export function openMailDraft(script, execFile) {
  return execFile('osascript', ['-e', script], { timeout: 20000 });
}

/**
 * PowerShell that opens one Outlook draft per message, with the PDF attached.
 * @param {Array<{ to: string, name: string, pdfPath: string, subject: string, body: string }>} drafts
 */
export function outlookDraftScript(drafts) {
  const quote = (value) => `'${String(value ?? '').replaceAll("'", "''")}'`;
  const blocks = (drafts ?? [])
    .map((draft) => {
      const attachments = attachmentPaths(draft)
        .map((pdfPath) => `$mail.Attachments.Add(${quote(pdfPath)})`)
        .join('\n');
      return `$mail = $outlook.CreateItem(0)
$mail.To = ${quote(draft.to)}
$mail.Subject = ${quote(draft.subject)}
$mail.Body = ${quote(draft.body)}
${attachments}
$mail.Display()`;
    })
    .join('\n');
  return `$outlook = New-Object -ComObject Outlook.Application
${blocks}
`;
}
