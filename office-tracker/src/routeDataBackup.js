// Office settings for the Current Route Data spreadsheet backup.
// Reminds the office to download on a chosen schedule. Daily is the default.

import { ROUTE_DATA_FILE_BASE, stampedWorkbookFilename } from './downloadName.js';

export const ROUTE_BACKUP_REMINDERS = ['off', 'daily', 'weekly', 'monthly'];
export const DEFAULT_ROUTE_BACKUP_REMINDER = 'daily';

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeRouteBackupReminder(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  return ROUTE_BACKUP_REMINDERS.includes(value) ? value : DEFAULT_ROUTE_BACKUP_REMINDER;
}

// Strip path and wildcard characters. Colon stays, because creation stamps use it.
function sanitizeFilePart(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/[\\/?*"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

// Safe spreadsheet base name. Blank values use Current_Route_Data.
export function normalizeRouteBackupFileBase(raw) {
  let name = sanitizeFilePart(String(raw ?? '').trim().replace(/\.xlsx$/i, ''));
  if (!name) return ROUTE_DATA_FILE_BASE;
  if (name.length > 120) name = name.slice(0, 120).trim();
  return name || ROUTE_DATA_FILE_BASE;
}

// Full download name the office typed. Always ends in .xlsx.
export function normalizeRouteBackupFilename(raw, date = new Date()) {
  let name = sanitizeFilePart(raw);
  if (!name) return stampedWorkbookFilename(ROUTE_DATA_FILE_BASE, date);
  if (!/\.xlsx$/i.test(name)) name = `${name}.xlsx`;
  if (name.length > 160) {
    const stem = name.replace(/\.xlsx$/i, '').slice(0, 155).trim() || ROUTE_DATA_FILE_BASE;
    name = `${stem}.xlsx`;
  }
  return name;
}

// Suggested name from the saved base, with a fresh creation stamp.
export function suggestedRouteBackupFilename(fileBase, date = new Date()) {
  return stampedWorkbookFilename(normalizeRouteBackupFileBase(fileBase), date);
}

// Keep a stable base when the office downloads a stamped name.
export function fileBaseFromRouteBackupFilename(filename) {
  const full = normalizeRouteBackupFilename(filename);
  const stem = full.replace(/\.xlsx$/i, '');
  // Drop a trailing _MONDD_HH:MM stamp when present, so the next suggestion stays clean.
  const withoutStamp = stem.replace(/_[A-Z]{3}\d{1,2}_\d{2}[:_]\d{2}$/, '');
  return normalizeRouteBackupFileBase(withoutStamp || stem);
}

function isoStamp(raw) {
  const text = String(raw || '').trim();
  const when = new Date(text);
  return text && !Number.isNaN(when.getTime()) ? when.toISOString() : '';
}

function normalizeLastFilename(raw) {
  const name = String(raw || '').trim();
  if (!name) return '';
  return normalizeRouteBackupFilename(name);
}

export function normalizeRouteDataBackup(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    reminder: normalizeRouteBackupReminder(source.reminder),
    fileBase: normalizeRouteBackupFileBase(source.fileBase ?? source.filename),
    lastDownloadedAt: isoStamp(source.lastDownloadedAt),
    lastFilename: normalizeLastFilename(source.lastFilename),
  };
}

// Local settings win. The later download time wins, so one computer clears the flash for the office.
export function mergeRouteDataBackup(remoteRaw, localRaw) {
  const remote = normalizeRouteDataBackup(remoteRaw);
  const local = normalizeRouteDataBackup(localRaw);
  const remoteTime = Date.parse(remote.lastDownloadedAt);
  const localTime = Date.parse(local.lastDownloadedAt);
  const useLocalFile =
    Number.isNaN(remoteTime) || (!Number.isNaN(localTime) && localTime >= remoteTime);
  return {
    reminder: local.reminder,
    fileBase: local.fileBase,
    lastDownloadedAt: laterStamp(remote.lastDownloadedAt, local.lastDownloadedAt),
    lastFilename: useLocalFile ? local.lastFilename || remote.lastFilename : remote.lastFilename || local.lastFilename,
  };
}

function laterStamp(left, right) {
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (Number.isNaN(a) && Number.isNaN(b)) return '';
  if (Number.isNaN(a)) return new Date(b).toISOString();
  if (Number.isNaN(b)) return new Date(a).toISOString();
  return new Date(Math.max(a, b)).toISOString();
}

function localDayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// True when the reminder is on and nobody has downloaded within the chosen window.
export function routeDataBackupReminderDue(prefs, now = new Date()) {
  const settings = normalizeRouteDataBackup(prefs);
  if (settings.reminder === 'off') return false;
  if (!settings.lastDownloadedAt) return true;
  const last = new Date(settings.lastDownloadedAt);
  if (Number.isNaN(last.getTime())) return true;
  if (settings.reminder === 'daily') {
    return localDayKey(last) < localDayKey(now);
  }
  if (settings.reminder === 'weekly') {
    return now.getTime() - last.getTime() >= 7 * DAY_MS;
  }
  if (settings.reminder === 'monthly') {
    return last.getFullYear() < now.getFullYear() || last.getMonth() < now.getMonth();
  }
  return false;
}

export function routeDataBackupReminderLabel(reminder) {
  const value = normalizeRouteBackupReminder(reminder);
  if (value === 'off') return 'Reminders are off.';
  if (value === 'weekly') return 'Remind weekly if nobody has downloaded.';
  if (value === 'monthly') return 'Remind monthly if nobody has downloaded.';
  return 'Remind daily if nobody has downloaded.';
}
