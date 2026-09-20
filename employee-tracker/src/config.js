import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localDateString } from './clockTimes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const employeeTrackerRoot = path.resolve(__dirname, '..');
export const projectRoot = path.resolve(__dirname, '../..');

export const EMPLOYEE_ROUTE_ID = 'SELF';
export const EMPLOYEE_PORT = Number(process.env.EMPLOYEE_PORT) || 3848;

/**
 * Isolated data folder — never the district Teamster Tracker DATA_DIR.
 * @returns {string}
 */
export function getEmployeeDataDir() {
  const configured = process.env.EMPLOYEE_DATA_DIR;
  if (configured?.trim()) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(projectRoot, configured);
  }
  return path.resolve(projectRoot, 'employee-data');
}

export function getAsOfDate() {
  return localDateString();
}

export function getAsOfTimestamp() {
  return new Date().toISOString();
}

export const FILE_NAMES = {
  profile: 'profile.json',
  changeLog: 'change-log.json',
  routeState: 'route-state.json',
  schoolCalendar: 'school-calendar.json',
};
