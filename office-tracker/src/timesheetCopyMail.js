const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export function timecardCopyFilename(driverName) {
  const slug = String(driverName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'driver'}-timecard.pdf`;
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
 * Draft for one driver's completed timecard. The image is downloaded beside this draft.
 * @param {{ to?: string, driverName?: string }} mail
 */
export function timecardCopyMail({ to, driverName }) {
  const name = String(driverName || '').trim() || 'Driver';
  return {
    to: String(to || '').trim(),
    subject: `Completed timecard for ${name}`,
    body: `Hi ${greetingName(name)},\n\nA copy of your completed timecard is attached.\n`,
    filename: timecardCopyFilename(name),
  };
}
