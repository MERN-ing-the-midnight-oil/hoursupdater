/**
 * Paper backup of clock ins and clock outs.
 * The print is the recent window, grouped by driver, in 10-point type.
 * Year-to-date is a separate download of every clock record since January 1.
 */

export const DEFAULT_BACKUP_HOURS = 24;
export const MIN_BACKUP_HOURS = 1;
export const MAX_BACKUP_HOURS = 24 * 31;

/**
 * Whole hours for the paper window. A blank or unusable value is 24 hours.
 * @param {unknown} raw
 */
export function normalizeBackupHours(raw) {
  if (raw == null || String(raw).trim() === '') return DEFAULT_BACKUP_HOURS;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_BACKUP_HOURS;
  const hours = Math.round(value);
  if (hours < MIN_BACKUP_HOURS) return MIN_BACKUP_HOURS;
  if (hours > MAX_BACKUP_HOURS) return MAX_BACKUP_HOURS;
  return hours;
}

/**
 * Reminders are on unless the office turns them off.
 * @param {unknown} raw
 */
export function normalizePaperBackupReminders(raw) {
  return !(raw === false || raw === 'false' || raw === 0 || raw === '0');
}

/**
 * @param {unknown} raw
 */
export function normalizePaperBackup(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const printed = String(source.lastPrintedAt || '').trim();
  const when = new Date(printed);
  return {
    hours: normalizeBackupHours(source.hours),
    reminders: normalizePaperBackupReminders(source.reminders),
    lastPrintedAt: printed && !Number.isNaN(when.getTime()) ? when.toISOString() : '',
  };
}

/**
 * Local settings win. The later print time wins, so one computer's backup
 * clears the reminder for the office.
 * @param {unknown} remoteRaw
 * @param {unknown} localRaw
 */
export function mergePaperBackup(remoteRaw, localRaw) {
  const remote = normalizePaperBackup(remoteRaw);
  const local = normalizePaperBackup(localRaw);
  return {
    hours: local.hours,
    reminders: local.reminders,
    lastPrintedAt: laterStamp(remote.lastPrintedAt, local.lastPrintedAt),
  };
}

/**
 * @param {string} left
 * @param {string} right
 */
function laterStamp(left, right) {
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (Number.isNaN(a) && Number.isNaN(b)) return '';
  if (Number.isNaN(a)) return new Date(b).toISOString();
  if (Number.isNaN(b)) return new Date(a).toISOString();
  return new Date(Math.max(a, b)).toISOString();
}

/**
 * @param {Date | string | number} now
 * @param {unknown} hours
 */
export function backupRange(now, hours) {
  const end = now instanceof Date ? now : new Date(now);
  const start = new Date(end.getTime() - normalizeBackupHours(hours) * 60 * 60 * 1000);
  return { start, end };
}

/**
 * January 1 of the local year through `now`.
 * @param {Date | string | number} now
 */
export function yearToDateRange(now) {
  const end = now instanceof Date ? now : new Date(now);
  return { start: new Date(end.getFullYear(), 0, 1), end };
}

/**
 * @param {object[] | null | undefined} punches
 * @param {Date} start
 * @param {Date} end
 */
export function punchesInRange(punches, start, end) {
  const from = start.getTime();
  const to = end.getTime();
  return (Array.isArray(punches) ? punches : []).filter((punch) => {
    if (!punch || punch.removed === true) return false;
    const at = new Date(punch.punched_at).getTime();
    return !Number.isNaN(at) && at >= from && at <= to;
  });
}

/**
 * @param {unknown} run
 */
export function paperRunLabel(run) {
  if (run === 'AM') return 'AM';
  if (run === 'MIDDAY') return 'Mid';
  if (run === 'PM') return 'PM';
  if (run === 'OTHER') return 'Other';
  return '';
}

/**
 * @param {Date} date
 */
export function formatPaperDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

/**
 * @param {Date} date
 */
export function formatPaperTime(date) {
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours %= 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${suffix}`;
}

/**
 * @param {Date} date
 */
export function formatPaperWhen(date) {
  return `${formatPaperDate(date)} ${formatPaperTime(date)}`;
}

/**
 * Note, substitute, and reason codes on one short line.
 * @param {object} punch
 */
export function paperDetail(punch) {
  /** @type {string[]} */
  const bits = [];
  const note = String(punch?.note || '').trim();
  if (note) bits.push(note);
  const substitute = String(punch?.substitute_name || '').trim();
  if (substitute) bits.push(`Sub ${substitute}`);
  const reasons = (Array.isArray(punch?.reason_codes) ? punch.reason_codes : [])
    .map((code) => String(code?.label || '').trim())
    .filter(Boolean);
  if (reasons.length) bits.push(reasons.join(', '));
  return bits.join(' · ');
}

/**
 * Driver name, then oldest clock first inside that name.
 * @param {object[]} punches
 */
export function groupPunchesByDriver(punches) {
  /** @type {Map<string, { name: string, punches: object[] }>} */
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

/**
 * @param {{
 *   reminders?: unknown,
 *   lastPrintedAt?: unknown,
 *   hours?: unknown,
 *   punches?: object[] | null,
 *   now: Date,
 * }} input
 */
export function paperBackupReminderDue({ reminders, lastPrintedAt, hours, punches, now }) {
  if (!normalizePaperBackupReminders(reminders)) return false;
  const list = (Array.isArray(punches) ? punches : []).filter(
    (punch) => punch && punch.removed !== true && punch.punched_at
  );
  if (!list.length) return false;
  const span = normalizeBackupHours(hours) * 60 * 60 * 1000;
  const at = now instanceof Date ? now : new Date(now);
  const printed = String(lastPrintedAt || '').trim();
  if (printed) {
    const last = new Date(printed);
    if (!Number.isNaN(last.getTime())) return at.getTime() - last.getTime() >= span;
  }
  let oldest = Infinity;
  for (const punch of list) {
    const time = new Date(punch.punched_at).getTime();
    if (!Number.isNaN(time) && time < oldest) oldest = time;
  }
  return Number.isFinite(oldest) && at.getTime() - oldest >= span;
}

/**
 * @param {{ hours?: unknown, lastPrintedAt?: unknown }} input
 */
export function paperBackupReminderText({ hours, lastPrintedAt }) {
  const span = normalizeBackupHours(hours);
  if (String(lastPrintedAt || '').trim()) {
    return `Print a paper backup. It has been more than ${span} hours since the last one.`;
  }
  return `Print a paper backup of the last ${span} hours of clock records.`;
}

/**
 * @param {string} value
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Compact 10-point sheet. One table, a heading row for each driver.
 * @param {Array<{ name: string, punches: object[] }>} groups
 * @param {{ hours: number, start: Date, end: Date }} range
 */
export function paperBackupHtml(groups, range) {
  const hours = normalizeBackupHours(range.hours);
  const heading = `Last ${hours} hour${hours === 1 ? '' : 's'} · ${formatPaperWhen(range.start)} – ${formatPaperWhen(range.end)}`;
  const rows = groups
    .map((group) => {
      const lines = group.punches
        .map((punch) => {
          const at = new Date(punch.punched_at);
          const when = Number.isNaN(at.getTime()) ? '' : formatPaperWhen(at);
          const kind = punch.action === 'out' ? 'Out' : 'In';
          return `<tr><td>${escapeHtml(when)}</td><td>${kind}</td><td>${escapeHtml(paperRunLabel(punch.run))}</td><td>${escapeHtml(paperDetail(punch))}</td></tr>`;
        })
        .join('');
      return `<tr class="driver"><th colspan="4">${escapeHtml(group.name)}</th></tr>${lines}`;
    })
    .join('');
  const body = rows
    ? `<table><thead><tr><th>When</th><th>In/Out</th><th>Run</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="paper-empty">No clock ins or clock outs in the last ${hours} hour${hours === 1 ? '' : 's'}.</p>`;
  return `<div class="paper-backup-print" style="font-size:10pt;line-height:1.15"><h1>Paper clock backup</h1><p>${escapeHtml(heading)}</p>${body}</div>`;
}

/**
 * @param {string} value
 */
function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Every clock record in the groups, driver by driver.
 * @param {Array<{ name: string, punches: object[] }>} groups
 */
export function paperBackupCsv(groups) {
  const lines = ['Driver,Date,Time,Kind,Run,Note,Reason codes,Substitute'];
  for (const group of groups) {
    for (const punch of group.punches) {
      const at = new Date(punch.punched_at);
      const reasons = (Array.isArray(punch.reason_codes) ? punch.reason_codes : [])
        .map((code) => String(code?.label || '').trim())
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

/**
 * @param {Date} now
 */
export function yearToDateFilename(now) {
  const year = (now instanceof Date ? now : new Date(now)).getFullYear();
  return `Clock records ${year} year-to-date.csv`;
}
