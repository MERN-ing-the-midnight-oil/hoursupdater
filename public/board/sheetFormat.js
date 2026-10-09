/** Browser copy of the sheet-format helpers in src/logic/extraWorkBoard.js. */

export const SHEET_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export const TIME_FIELDS = [
  'clock_in',
  'leave_garage',
  'arrive_trip',
  'depart_school',
  'leave_destination',
  'clock_out',
];

export const TIME_LABELS = {
  clock_in: 'Clock in Time',
  leave_garage: 'Leave Bus Garage',
  arrive_trip: 'Arrive at Trip',
  depart_school: 'Depart School',
  leave_destination: 'Leave destination',
  clock_out: 'Clock out',
};

/**
 * @param {string} iso
 * @returns {string}
 */
export function sheetWeekday(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const names = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return names[dt.getUTCDay()] ?? '';
}

/**
 * @param {string} iso
 * @returns {string}
 */
export function formatSheetDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

/**
 * @param {string} time
 * @returns {{ display: string, meridiem: 'AM' | 'PM' | '' }}
 */
export function splitClock(time) {
  if (!time) return { display: '', meridiem: '' };
  const [hourText, minute] = time.split(':');
  const hour = Number(hourText);
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return { display: `${hour12}:${minute}`, meridiem };
}

/**
 * @param {string} name
 * @returns {string}
 */
export function rosterName(name) {
  const text = String(name || '').trim().replace(/\s+/g, ' ');
  if (!text || text.includes(',')) return text;
  const parts = text.split(' ');
  if (parts.length < 2) return text;
  const last = parts.pop();
  return `${last}, ${parts.join(' ')}`;
}

/**
 * @param {string} name
 * @returns {string}
 */
export function givenName(name) {
  const text = String(name || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.includes(',')) {
    return text.split(',').slice(1).join(',').trim() || text;
  }
  const parts = text.split(' ');
  if (parts.length < 2) return text;
  return parts.slice(0, -1).join(' ');
}

/**
 * @param {string} name
 * @returns {string}
 */
export function suggestedInitials(name) {
  const text = String(name || '').trim();
  const spoken = text.includes(',')
    ? `${text.split(',').slice(1).join(' ').trim()} ${text.split(',')[0].trim()}`
    : text;
  const parts = spoken.split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}
