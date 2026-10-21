// Paper backup of clock ins and clock outs.
// The print is the recent window, grouped by driver, in 10-point type.
// Year-to-date is a separate download of every clock record since January 1.

import { formatTimecardMinutes } from './timecardEntries.js';

export const DEFAULT_BACKUP_HOURS = 24;
export const MIN_BACKUP_HOURS = 1;
export const MAX_BACKUP_HOURS = 24 * 31;

// Rows down one column of a letter page.
// Record lines are 8-point.
export const PAPER_COLUMN_ROWS = 70;
// Portrait letter columns that still show the time, the in or out,
// and 20 characters of the driver name.
export const PAPER_COLUMN_COUNT = 3;
export const PAPER_NAME_CHARACTERS = 20;
export const PAPER_PAGE_SIZE = PAPER_COLUMN_ROWS * PAPER_COLUMN_COUNT;

// Whole hours for the paper window. A blank or unusable value is 24 hours.
export function normalizeBackupHours(raw) {
  if (raw == null || String(raw).trim() === '') return DEFAULT_BACKUP_HOURS;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_BACKUP_HOURS;
  const hours = Math.round(value);
  if (hours < MIN_BACKUP_HOURS) return MIN_BACKUP_HOURS;
  if (hours > MAX_BACKUP_HOURS) return MAX_BACKUP_HOURS;
  return hours;
}

// Reminders are on unless the office turns them off.
export function normalizePaperBackupReminders(raw) {
  return !(raw === false || raw === 'false' || raw === 0 || raw === '0');
}

export function normalizePaperBackup(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const printed = String(source.lastPrintedAt || '').trim();
  const when = new Date(printed);
  return {
    hours: normalizeBackupHours(source.hours),
    reminders: normalizePaperBackupReminders(source.reminders),
    lastPrintedAt: printed && !Number.isNaN(when.getTime()) ? when.toISOString() : '',
    pages: normalizePaperPages(source.pages),
  };
}

// Local settings win. The later print time wins, so one computer's backup
// clears the reminder for the office.
export function mergePaperBackup(remoteRaw, localRaw) {
  const remote = normalizePaperBackup(remoteRaw);
  const local = normalizePaperBackup(localRaw);
  return {
    hours: local.hours,
    reminders: local.reminders,
    lastPrintedAt: laterStamp(remote.lastPrintedAt, local.lastPrintedAt),
    pages: mergePaperPages(remote.pages, local.pages),
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

function isoStamp(raw) {
  const text = String(raw || '').trim();
  const when = new Date(text);
  return text && !Number.isNaN(when.getTime()) ? when.toISOString() : '';
}

function normalizePaperRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const at = isoStamp(raw.punched_at);
  const id = String(raw.id || '').trim();
  if (!at || !id) return null;
  const run = raw.run === 'AM' || raw.run === 'MIDDAY' || raw.run === 'PM' || raw.run === 'OTHER' ? raw.run : '';
  return {
    id,
    driver_name: String(raw.driver_name || '').trim() || 'Unknown',
    action: raw.action === 'out' ? 'out' : 'in',
    punched_at: at,
    ...(run ? { run } : {}),
  };
}

export function normalizePaperPages(raw) {
  if (!Array.isArray(raw)) return [];
  const pages = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    const sealedAt = isoStamp(item.sealedAt);
    const rows = (Array.isArray(item.rows) ? item.rows : []).map(normalizePaperRow).filter(Boolean);
    if (!id || !sealedAt || !rows.length) continue;
    pages.push({
      id,
      sealedAt,
      printedAt: isoStamp(item.printedAt),
      rows,
    });
  }
  pages.sort((a, b) => a.sealedAt.localeCompare(b.sealedAt) || a.id.localeCompare(b.id));
  return pages;
}

// Same page id keeps one snapshot. A later print time wins.
export function mergePaperPages(remotePages, localPages) {
  const byId = new Map();
  for (const page of [...normalizePaperPages(remotePages), ...normalizePaperPages(localPages)]) {
    const current = byId.get(page.id);
    if (!current) {
      byId.set(page.id, page);
      continue;
    }
    byId.set(page.id, {
      ...current,
      printedAt: laterStamp(current.printedAt, page.printedAt),
    });
  }
  return [...byId.values()].sort((a, b) => a.sealedAt.localeCompare(b.sealedAt) || a.id.localeCompare(b.id));
}

function paperRowId(punch) {
  const id = String(punch?.id || '').trim();
  if (id) return id;
  const at = isoStamp(punch?.punched_at);
  return at ? `at:${at}` : '';
}

function paperRowFromPunch(punch) {
  return normalizePaperRow({
    id: paperRowId(punch),
    driver_name: punch?.driver_name,
    action: punch?.action,
    punched_at: punch?.punched_at,
    run: punch?.run,
  });
}

function newestFirst(rows) {
  return [...rows].sort((a, b) => String(b.punched_at).localeCompare(String(a.punched_at)) || String(b.id).localeCompare(String(a.id)));
}

// Seal every full page of clock records that is not already on a page.
// Rows on a page run newest to oldest. The open page is the remainder.
export function syncPaperPages(punches, savedPages, options = {}) {
  const pageSize = options.pageSize || PAPER_PAGE_SIZE;
  const pages = normalizePaperPages(savedPages);
  const used = new Set(pages.flatMap((page) => page.rows.map((row) => row.id)));
  const fresh = [];
  for (const punch of Array.isArray(punches) ? punches : []) {
    if (!punch || punch.removed === true) continue;
    const row = paperRowFromPunch(punch);
    if (!row || used.has(row.id)) continue;
    used.add(row.id);
    fresh.push(row);
  }
  fresh.sort((a, b) => a.punched_at.localeCompare(b.punched_at) || a.id.localeCompare(b.id));
  const sealed = [...pages];
  while (fresh.length >= pageSize) {
    const batch = newestFirst(fresh.splice(0, pageSize));
    const newest = batch[0];
    const oldest = batch[batch.length - 1];
    sealed.push({
      id: `page-${oldest.id}-${newest.id}`,
      sealedAt: newest.punched_at,
      printedAt: '',
      rows: batch,
    });
  }
  sealed.sort((a, b) => a.sealedAt.localeCompare(b.sealedAt) || a.id.localeCompare(b.id));
  return { pages: sealed, open: newestFirst(fresh) };
}

export function waitingPaperPages(pages) {
  return normalizePaperPages(pages).filter((page) => !page.printedAt);
}

export function printedPaperPages(pages) {
  return normalizePaperPages(pages).filter((page) => page.printedAt);
}

export function backupRange(now, hours) {
  const end = now instanceof Date ? now : new Date(now);
  const start = new Date(end.getTime() - normalizeBackupHours(hours) * 60 * 60 * 1000);
  return { start, end };
}

// January 1 of the local year through `now`.
export function yearToDateRange(now) {
  const end = now instanceof Date ? now : new Date(now);
  return { start: new Date(end.getFullYear(), 0, 1), end };
}

export function punchesInRange(punches, start, end) {
  const from = start.getTime();
  const to = end.getTime();
  return (Array.isArray(punches) ? punches : []).filter((punch) => {
    if (!punch || punch.removed === true) return false;
    const at = new Date(punch.punched_at).getTime();
    return !Number.isNaN(at) && at >= from && at <= to;
  });
}

export function paperRunLabel(run) {
  if (run === 'AM') return 'AM';
  if (run === 'MIDDAY') return 'Mid';
  if (run === 'PM') return 'PM';
  if (run === 'OTHER') return 'Other';
  return '';
}

export function formatPaperDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

export function formatPaperTime(date) {
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours %= 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${suffix}`;
}

export function formatPaperWhen(date) {
  return `${formatPaperDate(date)} ${formatPaperTime(date)}`;
}

// Driver name, then oldest clock first inside that name.
export function groupPunchesByDriver(punches) {
  const groups = new Map();
  for (const punch of punches) {
    const name = String(punch?.driver_name || '').trim() || 'Unknown';
    const key = name.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { name, punches: [] };
      groups.set(key, group);
    }
    group.punches.push(punch);
  }
  const listed = [...groups.values()];
  for (const group of listed) {
    group.punches.sort((a, b) => String(a.punched_at).localeCompare(String(b.punched_at)));
    const earliest = String(group.punches[0]?.driver_name || '').trim();
    if (earliest) group.name = earliest;
  }
  listed.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return listed;
}

export function paperBackupReminderDue({ reminders, pages }) {
  if (!normalizePaperBackupReminders(reminders)) return false;
  return waitingPaperPages(pages).length > 0;
}

export function paperBackupReminderText(count) {
  const pages = Math.max(0, Math.round(Number(count) || 0));
  if (pages === 1) return '1 page of clock records is waiting to print.';
  return `${pages} pages of clock records are waiting to print.`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Split driver groups into two columns of similar length.
function paperColumns(groups) {
  const weight = (group) => group.punches.length + 1;
  const total = groups.reduce((sum, group) => sum + weight(group), 0);
  const left = [];
  let used = 0;
  let index = 0;
  while (index < groups.length) {
    if (left.length && used >= total / 2) break;
    left.push(groups[index]);
    used += weight(groups[index]);
    index += 1;
  }
  return [left, groups.slice(index)];
}

// When, and in or out. A run stays on the in/out cell so the row is two columns.
function paperPunchCells(punch) {
  const at = new Date(punch.punched_at);
  const when = Number.isNaN(at.getTime()) ? '' : formatPaperWhen(at);
  const kind = punch.action === 'out' ? 'Out' : 'In';
  const run = paperRunLabel(punch.run);
  return { when, kind: run ? `${kind} ${run}` : kind };
}

// Newest time through oldest time, matching the order down the page.
export function paperPageSpan(rows) {
  if (!rows?.length) return '';
  const newest = new Date(rows[0].punched_at);
  const oldest = new Date(rows[rows.length - 1].punched_at);
  if (Number.isNaN(newest.getTime()) || Number.isNaN(oldest.getTime())) return '';
  return `${formatPaperWhen(newest)} – ${formatPaperWhen(oldest)}`;
}

// Month and day plus the time. The page heading already carries the year.
function formatPaperRowWhen(date) {
  return `${date.getMonth() + 1}/${date.getDate()} ${formatPaperTime(date)}`;
}

// The printed name keeps the first 20 characters.
function paperNameText(name) {
  const chars = [...name];
  if (chars.length <= PAPER_NAME_CHARACTERS) return name;
  return chars.slice(0, PAPER_NAME_CHARACTERS).join('');
}

function paperRecordRowHtml(row) {
  const at = new Date(row.punched_at);
  const when = Number.isNaN(at.getTime()) ? '' : formatPaperRowWhen(at);
  const cells = paperPunchCells(row);
  const name = String(row.driver_name || '');
  return `<tr><td class="paper-when">${escapeHtml(when)}</td><td class="paper-name" title="${escapeHtml(name)}">${escapeHtml(paperNameText(name))}</td><td class="paper-kind">${escapeHtml(cells.kind)}</td></tr>`;
}

// Left to right, each column newest to oldest.
function splitPaperPageColumns(rows, columnRows, columnCount) {
  return Array.from({ length: columnCount }, (_, index) => rows.slice(index * columnRows, (index + 1) * columnRows));
}

// One or more sealed pages. Each page reads newest to oldest down the columns, left to right.
export function paperPagesHtml(pages, options = {}) {
  const columnRows = options.columnRows || PAPER_COLUMN_ROWS;
  const columnCount = options.columnCount || PAPER_COLUMN_COUNT;
  const list = Array.isArray(pages) ? pages : [];
  if (!list.length) {
    return '<div class="paper-backup-print" style="font-size:10pt;line-height:1.15"><p class="paper-empty">No paper records to print.</p></div>';
  }
  const body = list
    .map((page, index) => {
      const rows = Array.isArray(page.rows) ? page.rows : [];
      const columns = splitPaperPageColumns(rows, columnRows, columnCount);
      const title = page.title || `Page ${index + 1}`;
      return `<section class="paper-page"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(paperPageSpan(rows))}</p><div class="paper-columns">${columns
        .map((column) => `<div class="paper-col"><table><tbody>${column.map(paperRecordRowHtml).join('')}</tbody></table></div>`)
        .join('')}</div></section>`;
    })
    .join('');
  return `<div class="paper-backup-print" style="font-size:10pt;line-height:1.15">${body}</div>`;
}

export function markPaperPagesPrinted(pages, ids, printedAt) {
  const chosen = new Set(ids);
  const at = isoStamp(printedAt) || new Date().toISOString();
  return normalizePaperPages(pages).map((page) =>
    chosen.has(page.id) && !page.printedAt ? { ...page, printedAt: at } : page
  );
}

function paperColumnHtml(groups) {
  return groups
    .map((group) => {
      const lines = group.punches
        .map((punch) => {
          const cells = paperPunchCells(punch);
          return `<tr><td>${escapeHtml(cells.when)}</td><td>${escapeHtml(cells.kind)}</td></tr>`;
        })
        .join('');
      return `<section class="paper-driver"><h2>${escapeHtml(group.name)}</h2><table><tbody>${lines}</tbody></table></section>`;
    })
    .join('');
}

// Two columns of clock records. Each row is the time and the in or out.
// Notes, reason codes, and substitute status stay off the paper.
export function paperBackupHtml(groups, range) {
  const hours = normalizeBackupHours(range.hours);
  const heading = `Last ${hours} hour${hours === 1 ? '' : 's'} · ${formatPaperWhen(range.start)} – ${formatPaperWhen(range.end)}`;
  const body = groups.length
    ? `<div class="paper-columns">${paperColumns(groups)
        .map((column) => `<div class="paper-col">${paperColumnHtml(column)}</div>`)
        .join('')}</div>`
    : `<p class="paper-empty">No clock ins or clock outs in the last ${hours} hour${hours === 1 ? '' : 's'}.</p>`;
  return `<div class="paper-backup-print" style="font-size:10pt;line-height:1.15"><h1>Paper clock backup</h1><p>${escapeHtml(heading)}</p>${body}</div>`;
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

// Every clock record in the groups, driver by driver.
export function paperBackupCsv(groups) {
  const lines = ['Driver,Date,Time,Kind,Run,Note,Reason codes,Substitute'];
  for (const group of groups) {
    for (const punch of group.punches) {
      const at = new Date(punch.punched_at);
      const reasons = (Array.isArray(punch.reason_codes) ? punch.reason_codes : [])
        .map((code) => {
          const label = String(code?.label || '').trim();
          if (!label) return '';
          const minutes = Number(code?.minutes);
          return Number.isInteger(minutes) && minutes >= 0 ? `${label} (${formatTimecardMinutes(minutes)})` : label;
        })
        .filter(Boolean)
        .join('; ');
      lines.push(
        [
          group.name,
          Number.isNaN(at.getTime()) ? '' : formatPaperDate(at),
          Number.isNaN(at.getTime()) ? '' : formatPaperTime(at),
          punch.action === 'out' ? 'Clock out' : 'Clock in',
          paperRunLabel(punch.run),
          String(punch.note || '').trim(),
          reasons,
          String(punch.substitute_name || '').trim(),
        ]
          .map(csvCell)
          .join(',')
      );
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function yearToDateFilename(now) {
  const year = (now instanceof Date ? now : new Date(now)).getFullYear();
  return `Clock records ${year} year-to-date.csv`;
}
