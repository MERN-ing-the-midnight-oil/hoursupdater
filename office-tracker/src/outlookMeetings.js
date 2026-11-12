import { randomBytes } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

function isEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}

function psQuote(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function inviteesFrom(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const invitees = [];
  const seen = new Set();
  for (const item of list) {
    const email = String(item?.email ?? '').trim();
    if (!isEmailAddress(email)) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    invitees.push({
      email,
      name: String(item?.name ?? '').trim() || email.split('@')[0],
    });
  }
  return invitees;
}

function normalizeMeeting(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const subject = String(source.subject ?? '').trim();
  const body = String(source.body ?? '').trim();
  const startLocal = String(source.startLocal ?? '').trim();
  const endLocal = String(source.endLocal ?? '').trim();
  const invitees = inviteesFrom(source.invitees);
  if (!subject || !startLocal || !endLocal || !invitees.length) return null;
  return {
    subject,
    body,
    startLocal,
    endLocal,
    invitees,
    reminderDate: String(source.reminderDate ?? '').slice(0, 10),
    changeIds: Array.isArray(source.changeIds)
      ? source.changeIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [],
    routes: Array.isArray(source.routes)
      ? source.routes.map((name) => String(name || '').trim()).filter(Boolean)
      : [],
  };
}

export function normalizeOutlookMeetings(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.map(normalizeMeeting).filter(Boolean);
}

// Classic desktop Outlook on Windows: one free 1-minute meeting per reminder day.
// Display() opens each for review so admin can Send.
export function outlookPayrollMeetingScript(meetings) {
  const list = normalizeOutlookMeetings(meetings);
  if (!list.length) {
    throw new Error('There are no Outlook meetings to create.');
  }
  const blocks = list
    .map((meeting) => {
      const recipients = meeting.invitees
        .map((person) => `$null = $meeting.Recipients.Add(${psQuote(person.email)})`)
        .join('\n');
      return `$meeting = $outlook.CreateItem(1)
$meeting.MeetingStatus = 1
$meeting.BusyStatus = 0
$meeting.ReminderSet = $true
$meeting.ReminderMinutesBeforeStart = 0
$meeting.Subject = ${psQuote(meeting.subject)}
$meeting.Body = ${psQuote(meeting.body)}
$meeting.Start = [DateTime]${psQuote(meeting.startLocal)}
$meeting.End = [DateTime]${psQuote(meeting.endLocal)}
${recipients}
$null = $meeting.Recipients.ResolveAll()
$meeting.Display($false)
`;
    })
    .join('\n');
  return `$ErrorActionPreference = 'Stop'
$outlook = New-Object -ComObject Outlook.Application
${blocks}
`;
}

export function outlookAutomationSupported(platform = process.platform) {
  return platform === 'win32';
}

/**
 * @param {string} script
 * @param {{ execFile: Function, writeFile?: Function, unlink?: Function, tmpdir?: () => string }} options
 */
export async function runOutlookPowerShell(script, options) {
  const execFile = options?.execFile;
  if (typeof execFile !== 'function') {
    throw new Error('Outlook automation needs an execFile helper.');
  }
  if (!outlookAutomationSupported()) {
    throw new Error('Outlook calendar automation needs classic desktop Outlook on Windows.');
  }
  const write = options.writeFile || writeFile;
  const remove = options.unlink || unlink;
  const tmpdir = options.tmpdir || os.tmpdir;
  const scriptPath = path.join(tmpdir(), `teamster-outlook-${randomBytes(4).toString('hex')}.ps1`);
  await write(scriptPath, String(script ?? ''), 'utf8');
  try {
    await execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { timeout: 120000, windowsHide: true }
    );
  } finally {
    try {
      await remove(scriptPath);
    } catch {
      // Temp cleanup is best-effort.
    }
  }
}

// Meeting fields for one reminder-day event from the Payroll queue.
export function meetingFromReminderEvent(event, invitees) {
  const reminderDate = String(event?.reminderDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reminderDate)) return null;
  return normalizeMeeting({
    subject: event?.subject,
    body: event?.body,
    reminderDate,
    startLocal: `${reminderDate} 08:00:00`,
    endLocal: `${reminderDate} 08:01:00`,
    invitees,
    changeIds: event?.changeIds,
    routes: event?.routes,
  });
}
