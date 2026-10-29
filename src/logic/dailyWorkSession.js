import { randomBytes } from 'node:crypto';

export const DAILY_WORK_COOKIE = 'daily_work';

/** A phone can reopen the board during the same school day. */
export const DAILY_WORK_MAX_AGE_SEC = 12 * 60 * 60;

const sessions = new Map();

/**
 * @param {string} driverId
 * @param {number} [now]
 * @returns {string}
 */
export function openDailyWorkSession(driverId, now = Date.now()) {
  const id = String(driverId || '').trim();
  if (!id) throw new Error('Choose your name.');
  const token = randomBytes(24).toString('hex');
  sessions.set(token, { driverId: id, expires: now + DAILY_WORK_MAX_AGE_SEC * 1000 });
  return token;
}

/**
 * @param {string} token
 * @param {number} [now]
 * @returns {string}
 */
export function dailyWorkDriverId(token, now = Date.now()) {
  const key = String(token || '');
  const row = sessions.get(key);
  if (!row) return '';
  if (row.expires <= now) {
    sessions.delete(key);
    return '';
  }
  return row.driverId;
}

/** @param {string} token */
export function closeDailyWorkSession(token) {
  sessions.delete(String(token || ''));
}

/**
 * @param {string | undefined} header
 * @param {string} name
 * @returns {string}
 */
export function readCookie(header, name) {
  const wanted = String(name || '');
  for (const part of String(header || '').split(';')) {
    const text = part.trim();
    const eq = text.indexOf('=');
    if (eq <= 0) continue;
    if (text.slice(0, eq) !== wanted) continue;
    try {
      return decodeURIComponent(text.slice(eq + 1));
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * @param {string} token
 * @returns {string}
 */
export function dailyWorkCookie(token) {
  const value = String(token || '');
  if (!value) {
    return `${DAILY_WORK_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  }
  return `${DAILY_WORK_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DAILY_WORK_MAX_AGE_SEC}`;
}
