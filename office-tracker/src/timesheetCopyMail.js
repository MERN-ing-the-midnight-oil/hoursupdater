import { noticeMailto } from './noticeMail.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Chrome shows a 400 page when a mailto link is longer than this.
const MAILTO_LIMIT = 1800;

export const DEFAULT_TIMECARD_COPY_TEMPLATE = `Hi {{first}},

Your completed timecard is copied. Paste it below this line.`;

/**
 * Blank or missing text keeps the built-in note.
 * @param {unknown} saved
 */
export function timecardCopyTemplate(saved) {
  const text = String(saved ?? '').trim();
  return text || DEFAULT_TIMECARD_COPY_TEMPLATE;
}

/**
 * {{first}} is the greeting name. {{name}} is the full driver name.
 * @param {unknown} template
 * @param {unknown} driverName
 */
export function fillTimecardCopyTemplate(template, driverName) {
  const name = String(driverName || '').trim() || 'Driver';
  const values = { first: greetingName(name), name };
  return timecardCopyTemplate(template).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  );
}

function compact(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function nameForms(employeeName) {
  const raw = compact(employeeName);
  if (!raw) return [];
  const forms = [raw];
  const comma = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (comma.length >= 2) {
    forms.push(compact(`${comma.slice(1).join(' ')} ${comma[0]}`));
    forms.push(compact(`${comma[0]}, ${comma.slice(1).join(' ')}`));
  }
  return forms;
}

export function isTimecardEmail(value) {
  return EMAIL.test(String(value || '').trim());
}

/**
 * Match a sticker name ("Last, First") to a Driver Name List person.
 * @param {object[] | null | undefined} drivers
 * @param {string | null | undefined} employeeName
 */
export function driverForTimecardName(drivers, employeeName) {
  const forms = nameForms(employeeName);
  if (!forms.length) return null;
  for (const driver of Array.isArray(drivers) ? drivers : []) {
    const name = compact(driver?.name);
    const firstLast = compact(`${driver?.firstName || ''} ${driver?.lastName || ''}`);
    const lastFirst = compact(`${driver?.lastName || ''}, ${driver?.firstName || ''}`);
    if (forms.includes(name) || forms.includes(firstLast) || forms.includes(lastFirst)) return driver;
  }
  return null;
}

export function greetingName(driverName) {
  const text = String(driverName || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!text) return 'there';
  const comma = text.indexOf(',');
  if (comma >= 0) {
    const first = text.slice(comma + 1).trim().split(/\s+/)[0];
    if (first) return first;
  }
  return text.split(/\s+/)[0];
}

/**
 * Draft for one driver's completed timecard. The saved template is the note,
 * and a short sheet can follow it in the same message.
 * @param {{ to?: string, driverName?: string, sheetText?: string, template?: string }} mail
 */
export function timecardCopyMail({ to, driverName, sheetText, template }) {
  const name = String(driverName || '').trim() || 'Driver';
  const note = fillTimecardCopyTemplate(template, name);
  const sheet = String(sheetText || '').trim();
  const body = sheet ? `${note}\n\n${sheet}\n` : `${note}\n`;
  return {
    to: String(to || '').trim(),
    subject: `Completed timecard for ${name}`,
    body,
  };
}

/**
 * A full timecard makes a mailto link long enough that Chrome navigates to an
 * error page. Short sheets stay in the draft. Longer ones are copied, and the
 * draft is only the saved note.
 * @param {{ to?: string, driverName?: string, sheetText?: string, template?: string }} mail
 */
export function timecardCopyDelivery({ to, driverName, sheetText, template }) {
  const full = timecardCopyMail({ to, driverName, sheetText, template });
  const direct = noticeMailto(full);
  if (direct.length <= MAILTO_LIMIT) return { mail: full, paste: false };
  let note = fillTimecardCopyTemplate(template, driverName);
  let mail = { to: full.to, subject: full.subject, body: `${note}\n` };
  if (noticeMailto(mail).length > MAILTO_LIMIT) {
    note = fillTimecardCopyTemplate(DEFAULT_TIMECARD_COPY_TEMPLATE, driverName);
    mail = { to: full.to, subject: full.subject, body: `${note}\n` };
  }
  return { mail, paste: true };
}
