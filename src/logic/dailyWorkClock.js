/**
 * At 8:00 a.m. Pacific, close that calendar day's morning offerings and award them.
 * A restart after 8:00 still closes today. A day that is already closed is left alone.
 * Late additions are not awarded here.
 */

import { getAsOfTimestamp, getDataDir } from '../config.js';
import { readDrivers, readExtraWorkBoard, readRouteState, writeExtraWorkBoard } from '../data/storage.js';
import { closeDailyOfferings, isDayClosed } from './extraWorkBoard.js';
import { driversWithSeniorityNumbers, readOfficeRoster } from './officeRoster.js';
import { getSeniorityOrder } from './seniority.js';

const AWARD_MINUTES = 8 * 60;

/**
 * @param {Date} [now]
 * @returns {{ date: string, minutes: number }}
 */
export function pacificClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  const hour = Number(pick('hour'));
  const minute = Number(pick('minute'));
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    minutes: (Number.isFinite(hour) ? hour % 24 : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
  };
}

/**
 * @param {Date} [now]
 */
export function awardIsDue(now = new Date()) {
  return pacificClock(now).minutes >= AWARD_MINUTES;
}

/**
 * @param {Record<string, { driver_id?: string, segments?: object }>} routeState
 */
function scheduleRows(routeState) {
  return Object.entries(routeState || {}).flatMap(([route_id, entry]) => {
    if (!entry?.driver_id) return [];
    const segments = entry.segments || {};
    return [
      {
        route_id,
        driver_id: entry.driver_id,
        segments: {
          AM: segments.AM ?? null,
          MIDDAY: segments.MIDDAY ?? null,
          PM: segments.PM ?? null,
        },
      },
    ];
  });
}

/**
 * Close today's morning board once local time is 8:00 or later.
 * @param {Date} [now]
 */
export async function awardDueDay(now = new Date()) {
  const clock = pacificClock(now);
  if (clock.minutes < AWARD_MINUTES) return { ran: false, reason: 'before 8:00' };
  const dataDir = getDataDir();
  const board = await readExtraWorkBoard(dataDir);
  if (isDayClosed(board, clock.date)) return { ran: false, reason: 'closed', date: clock.date };
  const roster = await readOfficeRoster(dataDir);
  const drivers = roster
    ? driversWithSeniorityNumbers(roster.drivers)
    : getSeniorityOrder(await readDrivers(dataDir));
  const schedules = roster ? roster.schedules : scheduleRows(await readRouteState(dataDir));
  const saved = closeDailyOfferings(board, {
    date: clock.date,
    drivers,
    schedules,
    now: getAsOfTimestamp(),
  });
  await writeExtraWorkBoard(saved.board, dataDir);
  return { ran: true, date: clock.date, awarded: saved.awarded.length };
}

let timer = null;

export function startDailyAwardClock() {
  if (timer) return;
  const tick = () => {
    awardDueDay().then((result) => {
      if (result.ran) console.log(`Daily work for ${result.date} awarded at 8:00.`);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Daily work award failed';
      if (/already closed/i.test(message)) return;
      console.error(`Daily work 8:00 award failed: ${message}`);
    });
  };
  tick();
  timer = setInterval(tick, 30_000);
  if (typeof timer.unref === 'function') timer.unref();
}
