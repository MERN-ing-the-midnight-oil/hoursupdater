import fs from 'node:fs/promises';
import path from 'node:path';
import { FILE_NAMES, getEmployeeDataDir } from './config.js';
import { buildBps2026_2027Calendar } from './bpsCalendar2026.js';

/**
 * @param {string} [dataDir]
 */
export async function ensureEmployeeDataDir(dataDir = getEmployeeDataDir()) {
  await fs.mkdir(dataDir, { recursive: true });
  await ensureBuiltInCalendar(dataDir);
}

/**
 * Always keep the built-in BPS 2026–27 calendar in place (overwrite stale copies
 * so the official year ships with the app, not a leftover practice file).
 * @param {string} dataDir
 */
export async function ensureBuiltInCalendar(dataDir = getEmployeeDataDir()) {
  const { calendar } = buildBps2026_2027Calendar();
  const dest = path.join(dataDir, FILE_NAMES.schoolCalendar);
  await writeJson(dest, calendar);
  return calendar;
}

/**
 * @param {string} filePath
 * @param {unknown} fallback
 */
async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

/**
 * @param {string} filePath
 * @param {unknown} value
 */
async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

/** @param {string} [dataDir] */
export async function readProfile(dataDir = getEmployeeDataDir()) {
  return readJson(path.join(dataDir, FILE_NAMES.profile), null);
}

/** @param {object} profile @param {string} [dataDir] */
export async function writeProfile(profile, dataDir = getEmployeeDataDir()) {
  await writeJson(path.join(dataDir, FILE_NAMES.profile), profile);
}

/** @param {string} [dataDir] */
export async function readChangeLog(dataDir = getEmployeeDataDir()) {
  const log = await readJson(path.join(dataDir, FILE_NAMES.changeLog), []);
  return Array.isArray(log) ? log : [];
}

/** @param {object[]} log @param {string} [dataDir] */
export async function writeChangeLog(log, dataDir = getEmployeeDataDir()) {
  await writeJson(path.join(dataDir, FILE_NAMES.changeLog), log);
}

/** @param {object} entry @param {string} [dataDir] */
export async function appendChange(entry, dataDir = getEmployeeDataDir()) {
  const log = await readChangeLog(dataDir);
  log.push(entry);
  await writeChangeLog(log, dataDir);
  return entry;
}

/** @param {string} [dataDir] */
export async function readRouteState(dataDir = getEmployeeDataDir()) {
  const state = await readJson(path.join(dataDir, FILE_NAMES.routeState), {});
  return state && typeof state === 'object' ? state : {};
}

/** @param {object} state @param {string} [dataDir] */
export async function writeRouteState(state, dataDir = getEmployeeDataDir()) {
  await writeJson(path.join(dataDir, FILE_NAMES.routeState), state);
}

/** @param {string} [dataDir] */
export async function readSchoolCalendar(dataDir = getEmployeeDataDir()) {
  const existing = await readJson(path.join(dataDir, FILE_NAMES.schoolCalendar), null);
  if (existing?.days?.length) {
    return existing;
  }
  return ensureBuiltInCalendar(dataDir);
}

/** @param {string} [dataDir] */
export async function resetEmployeeData(dataDir = getEmployeeDataDir()) {
  await fs.mkdir(dataDir, { recursive: true });
  await writeJson(path.join(dataDir, FILE_NAMES.profile), null);
  await writeChangeLog([], dataDir);
  await writeRouteState({}, dataDir);
  await ensureBuiltInCalendar(dataDir);
}
