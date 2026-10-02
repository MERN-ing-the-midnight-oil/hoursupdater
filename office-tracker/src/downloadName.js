const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROUTE_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export const PAYROLL_FILE_BASE = 'Payroll Driver Times';
export const ROUTE_DATA_FILE_BASE = 'Current_Route_Data';

/**
 * Payroll creation stamp, such as Friday_Nov_17_1452 for 2:52 PM.
 * @param {Date} [date]
 */
export function payrollCreationStamp(date = new Date()) {
  const weekday = WEEKDAYS[date.getDay()];
  const month = MONTHS[date.getMonth()];
  const day = String(date.getDate());
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${weekday}_${month}_${day}_${hours}${minutes}`;
}

/**
 * Payroll download name, such as
 * Payroll Driver Times Friday_Nov_17_1452.xlsx.
 * @param {Date} [date]
 */
export function payrollWorkbookFilename(date = new Date()) {
  return `${PAYROLL_FILE_BASE} ${payrollCreationStamp(date)}.xlsx`;
}

/**
 * Local creation stamp for route backups, such as OCT15_14:25.
 * @param {Date} [date]
 */
export function workbookCreationStamp(date = new Date()) {
  const month = ROUTE_MONTHS[date.getMonth()];
  const day = String(date.getDate());
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}${day}_${hours}:${minutes}`;
}

/**
 * Download name with the creation stamp and .xlsx, such as
 * Payroll_Driver_Times_OCT15_14:25.xlsx.
 * @param {string} base
 * @param {Date} [date]
 */
export function stampedWorkbookFilename(base, date = new Date()) {
  return `${base}_${workbookCreationStamp(date)}.xlsx`;
}

/**
 * @param {string} filename
 */
export function workbookTitleFromFilename(filename) {
  return String(filename ?? '').replace(/\.xlsx$/i, '');
}

/**
 * @param {string | null | undefined} header
 */
export function filenameFromDisposition(header) {
  const match = /filename="([^"]+)"/i.exec(String(header ?? ''));
  return match ? match[1] : '';
}

/**
 * ExcelJS returns a Node Buffer on the server and an ArrayBuffer in the browser.
 * @param {ArrayBuffer | Uint8Array | Buffer} buffer
 */
export function workbookFileBytes(buffer) {
  if (typeof Buffer !== 'undefined') return Buffer.from(buffer);
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  return buffer;
}
