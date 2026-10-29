import { Router } from 'express';
import QRCode from 'qrcode';
import { getAsOfTimestamp, getDataDir } from '../config.js';
import {
  readChangeLog,
  readClockPins,
  readClockPunches,
  readClockReasonCodes,
  createSubstituteDriver,
  deleteSubstituteDriver,
  readDrivers,
  readDriversIfPresent,
  readExtraWorkBoard,
  readRouteState,
  readSchoolCalendar,
  writeClockPunches,
  writeExtraWorkBoard,
} from '../data/storage.js';
import { assertPin, assertPinMatches, driversForPin } from '../logic/clockKiosk.js';
import { applyDriverClockEdit, buildDriverDashboard } from '../logic/driverDashboard.js';
import { driverPhotoSrc } from '../../office-tracker/web/driverPhotos.js';
import { periodFromQuery, routesHeldBy } from '../logic/timesheets.js';
import {
  closeDailyWorkSession,
  dailyWorkCookie,
  dailyWorkDriverId,
  openDailyWorkSession,
  readCookie,
  DAILY_WORK_COOKIE,
} from '../logic/dailyWorkSession.js';
import {
  awardPosting,
  availabilitySpan,
  closeDailyOfferings,
  createPosting,
  projectAvailability,
  setAvailabilitySchedule,
  setLateAvailability,
  deleteDraft,
  driverBoardPayload,
  publicBoardPayload,
  markNoticeRead,
  publishPosting,
  removeBid,
  updatePosting,
  upsertBid,
} from '../logic/extraWorkBoard.js';
import { driversWithSeniorityNumbers, readOfficeRoster } from '../logic/officeRoster.js';
import { getSeniorityOrder } from '../logic/seniority.js';
import { mondayOf } from '../../public/board/gantt.js';
import { pacificClock } from '../logic/dailyWorkClock.js';

const router = Router();

function dataDir() {
  return getDataDir();
}

/**
 * @param {import('express').Response} res
 * @param {unknown} error
 */
function boardError(res, error) {
  const message = error instanceof Error ? error.message : 'Request failed';
  const status = Number(error?.status) || 400;
  res.status(status).json({ error: message });
}

function sessionDriverId(req) {
  return dailyWorkDriverId(readCookie(req.headers.cookie, DAILY_WORK_COOKIE));
}

function compactName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Clock PINs are stored on the clock roster. The work board uses the office roster.
 * When the names match, the session is the office driver so free time and signups line up.
 * @param {{ driver_id: string, name?: string }} clockDriver
 * @param {{ driver_id: string, name?: string }[]} ranked
 */
function boardDriverId(clockDriver, ranked) {
  const name = compactName(clockDriver?.name);
  const match = name ? ranked.find((row) => compactName(row.name) === name) : null;
  return match?.driver_id || clockDriver.driver_id;
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {string}
 */
function requireSession(req, res) {
  const driverId = sessionDriverId(req);
  if (!driverId) {
    res.status(401).json({ error: 'Enter your PIN to sign up.' });
    return '';
  }
  return driverId;
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
 * Real office drivers and routes when a roster file is present.
 * Otherwise the sample driver directory and route state.
 */
function substituteRows(drivers) {
  return (drivers || [])
    .filter((driver) => driver?.kind === 'substitute' && driver.driver_id && driver.name)
    .map((driver) => ({
      driver_id: driver.driver_id,
      name: driver.name,
      email: driver.email || null,
      kind: 'substitute',
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

async function boardDirectory() {
  const dir = dataDir();
  const roster = await readOfficeRoster(dir);
  if (roster) {
    return {
      ranked: driversWithSeniorityNumbers(roster.drivers),
      schedules: roster.schedules,
      routeNotes: roster.routeNotes,
      substitutes: substituteRows(await readDriversIfPresent(dir)),
    };
  }
  const [drivers, routeState] = await Promise.all([
    readDrivers(dir),
    readRouteState(dir),
  ]);
  return {
    ranked: getSeniorityOrder(drivers),
    schedules: scheduleRows(routeState),
    routeNotes: {},
    substitutes: substituteRows(drivers),
  };
}

function boardToday() {
  return pacificClock(new Date(getAsOfTimestamp())).date;
}

/**
 * Open days follow each driver's repeating week. Closed days stay frozen.
 * @param {import('../logic/extraWorkBoard.js').ExtraWorkBoard} board
 */
function presentedBoard(board) {
  const today = boardToday();
  if (!today) return board;
  return projectAvailability(board, availabilitySpan(today));
}

function publicDrivers(ranked) {
  return ranked.map((driver) => ({
    driver_id: driver.driver_id,
    name: driver.name,
    email: driver.email,
    seniority_rank: driver.seniority_rank,
    hire_date: driver.hire_date || null,
    tie_break: driver.tie_break ?? null,
    missing_hire_date: driver.missing_hire_date,
  }));
}

router.get('/extra-work', async (_req, res, next) => {
  try {
    const [board, directory] = await Promise.all([
      readExtraWorkBoard(dataDir()),
      boardDirectory(),
    ]);
    res.json({
      ...presentedBoard(board),
      drivers: publicDrivers(directory.ranked),
      substitutes: directory.substitutes,
      schedules: directory.schedules,
      route_notes: directory.routeNotes,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/extra-work/roster', async (_req, res, next) => {
  try {
    const directory = await boardDirectory();
    res.json({
      drivers: directory.ranked
        .map((driver) => ({
          driver_id: driver.driver_id,
          name: driver.name,
        }))
        .filter((driver) => driver.driver_id && driver.name)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/extra-work/mine', async (req, res, next) => {
  try {
    const driverId = sessionDriverId(req);
    if (!driverId) {
      res.status(401).json({ error: 'Enter your PIN.' });
      return;
    }
    const [board, directory] = await Promise.all([
      readExtraWorkBoard(dataDir()),
      boardDirectory(),
    ]);
    const ranked = directory.ranked.find((driver) => driver.driver_id === driverId);
    if (!ranked) {
      closeDailyWorkSession(readCookie(req.headers.cookie, DAILY_WORK_COOKIE));
      res.setHeader('Set-Cookie', dailyWorkCookie(''));
      res.status(401).json({ error: 'That PIN is not on the office driver list.' });
      return;
    }
    const list = req.query.sheet === 'roster' || req.query.sheet === 'weekly' ? req.query.sheet : 'daily';
    res.json({
      ...driverBoardPayload(board, {
        driver: ranked,
        schedules: directory.schedules,
        names: directory.ranked,
        list,
        today: boardToday(),
      }),
      substitutes: directory.substitutes,
    });
  } catch (error) {
    next(error);
  }
});

const DASHBOARD_TABS = new Set(['changes', 'card', 'summaries', 'weekly', 'daily', 'roster']);

function driverPortrait(name) {
  const src = driverPhotoSrc(name);
  return src ? `/${src}` : '';
}

function withPortrait(payload) {
  return { ...payload, photo: driverPortrait(payload?.name) };
}

/**
 * Phone QR target. Every driver sheet opens that tab on the driver dashboard.
 * A Monday week date stays on the link. A PIN on the link is dropped.
 * @param {unknown} value
 * @returns {string}
 */
export function dailyWorkQrTarget(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  const week = url.searchParams.get('week') || '';
  const lockedWeek = /^\d{4}-\d{2}-\d{2}$/.test(week) && mondayOf(week) === week ? week : '';
  const asked = url.searchParams.get('tab') || '';
  const tab = DASHBOARD_TABS.has(asked) ? asked : '';
  const driverLink = (nextTab) => {
    const params = new URLSearchParams();
    if (lockedWeek) params.set('week', lockedWeek);
    if (nextTab) params.set('tab', nextTab);
    const query = params.toString();
    return `${url.origin}/driver${query ? `?${query}` : ''}`;
  };
  if (url.pathname === '/driver' || url.pathname === '/driver/') return driverLink(tab);
  if (url.pathname !== '/board') return '';
  const sheet = url.searchParams.get('sheet');
  if (url.searchParams.get('as') !== 'driver') return '';
  if (sheet === 'weekly') return driverLink(lockedWeek ? '' : 'weekly');
  if (sheet === 'daily') return driverLink('daily');
  if (sheet === 'roster') return driverLink('roster');
  return '';
}

router.get('/extra-work/board', async (req, res, next) => {
  try {
    const [board, directory] = await Promise.all([
      readExtraWorkBoard(dataDir()),
      boardDirectory(),
    ]);
    const list = req.query.sheet === 'roster' || req.query.sheet === 'weekly' ? req.query.sheet : 'daily';
    res.json({
      ...publicBoardPayload(board, directory.ranked, list),
      substitutes: directory.substitutes,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/extra-work/qr', async (req, res) => {
  const target = dailyWorkQrTarget(req.query.url);
  if (!target) {
    res.status(400).json({ error: 'That is not the Daily Work phone address.' });
    return;
  }
  const png = await QRCode.toBuffer(target, { width: 280, margin: 1 });
  res.type('png').send(png);
});

router.post('/extra-work/enter', async (req, res) => {
  try {
    const pin = assertPin(req.body?.pin);
    const drivers = await readDrivers(dataDir());
    const pins = await readClockPins(dataDir());
    const requested = String(req.body?.driver_id || '').trim();
    const directory = await boardDirectory();
    const signInDrivers = directory.ranked.length
      ? directory.ranked.map((row) => ({ driver_id: row.driver_id, name: row.name }))
      : drivers;
    const openAs = (driver) => {
      const officeId = boardDriverId(driver, directory.ranked);
      const office = directory.ranked.find((row) => row.driver_id === officeId);
      const token = openDailyWorkSession(office?.driver_id || driver.driver_id);
      res.setHeader('Set-Cookie', dailyWorkCookie(token));
      const name = office?.name || driver.name;
      res.json({
        driver_id: office?.driver_id || driver.driver_id,
        name,
        photo: driverPortrait(name),
      });
    };
    if (requested) {
      const driver =
        signInDrivers.find((row) => row.driver_id === requested) ||
        drivers.find((row) => row.driver_id === requested);
      if (!driver) {
        res.status(400).json({ error: 'Choose your name.' });
        return;
      }
      assertPinMatches(pins, driver.driver_id, pin);
      openAs(driver);
      return;
    }
    const matches = driversForPin(signInDrivers, pins, pin);
    if (!matches.length) {
      res.status(401).json({ error: 'That PIN does not match.' });
      return;
    }
    if (matches.length > 1) {
      res.json({ matches });
      return;
    }
    openAs(matches[0]);
  } catch (error) {
    boardError(res, error);
  }
});

router.post('/extra-work/leave', (req, res) => {
  closeDailyWorkSession(readCookie(req.headers.cookie, DAILY_WORK_COOKIE));
  res.setHeader('Set-Cookie', dailyWorkCookie(''));
  res.json({ ok: true });
});

router.post('/extra-work', async (req, res) => {
  try {
    const board = await readExtraWorkBoard(dataDir());
    const saved = createPosting(board, req.body ?? {}, getAsOfTimestamp());
    await writeExtraWorkBoard(saved.board, dataDir());
    res.status(201).json(saved.posting);
  } catch (error) {
    boardError(res, error);
  }
});

router.post('/extra-work/notifications/:id/read', async (req, res) => {
  try {
    const driverId = requireSession(req, res);
    if (!driverId) return;
    const board = await readExtraWorkBoard(dataDir());
    const nextBoard = markNoticeRead(board, req.params.id, driverId);
    await writeExtraWorkBoard(nextBoard, dataDir());
    res.json({ ok: true });
  } catch (error) {
    boardError(res, error);
  }
});

router.put('/extra-work/:id', async (req, res) => {
  try {
    const board = await readExtraWorkBoard(dataDir());
    const saved = updatePosting(board, req.params.id, req.body ?? {}, getAsOfTimestamp());
    await writeExtraWorkBoard(saved.board, dataDir());
    res.json(saved.posting);
  } catch (error) {
    boardError(res, error);
  }
});

router.post('/extra-work/close', async (req, res) => {
  try {
    const [board, directory] = await Promise.all([readExtraWorkBoard(dataDir()), boardDirectory()]);
    const saved = closeDailyOfferings(board, {
      date: req.body?.date,
      drivers: directory.ranked,
      schedules: directory.schedules,
      now: getAsOfTimestamp(),
    });
    await writeExtraWorkBoard(saved.board, dataDir());
    res.json({
      closed_days: saved.board.closed_days,
      awarded: saved.awarded,
      left_open: saved.left_open,
    });
  } catch (error) {
    boardError(res, error);
  }
});

router.post('/extra-work/availability-schedule', async (req, res) => {
  try {
    const driverId = requireSession(req, res);
    if (!driverId) return;
    const board = await readExtraWorkBoard(dataDir());
    const next = setAvailabilitySchedule(board, {
      driverId,
      weekdays: req.body?.weekdays,
      exceptions: req.body?.exceptions,
      now: getAsOfTimestamp(),
      today: boardToday(),
    });
    await writeExtraWorkBoard(next, dataDir());
    res.json({ ok: true });
  } catch (error) {
    boardError(res, error);
  }
});

router.post('/extra-work/availability', async (req, res) => {
  try {
    const driverId = requireSession(req, res);
    if (!driverId) return;
    const board = await readExtraWorkBoard(dataDir());
    const next = setLateAvailability(board, {
      date: req.body?.date,
      driverId,
      ranges: req.body?.ranges,
      now: getAsOfTimestamp(),
      today: boardToday(),
    });
    await writeExtraWorkBoard(next, dataDir());
    res.json({ ok: true });
  } catch (error) {
    boardError(res, error);
  }
});

router.post('/extra-work/:id/post', async (req, res) => {
  try {
    const board = await readExtraWorkBoard(dataDir());
    const saved = publishPosting(board, req.params.id, getAsOfTimestamp());
    await writeExtraWorkBoard(saved.board, dataDir());
    res.json({ posting: saved.posting, board: saved.board });
  } catch (error) {
    boardError(res, error);
  }
});

router.delete('/extra-work/:id', async (req, res) => {
  try {
    const board = await readExtraWorkBoard(dataDir());
    const nextBoard = deleteDraft(board, req.params.id);
    await writeExtraWorkBoard(nextBoard, dataDir());
    res.json({ ok: true });
  } catch (error) {
    boardError(res, error);
  }
});

router.post('/extra-work/:id/bids', async (req, res) => {
  try {
    const driverId = requireSession(req, res);
    if (!driverId) return;
    const body = req.body ?? {};
    const directory = await boardDirectory();
    const driver =
      directory.ranked.find((row) => row.driver_id === driverId) ||
      (await readDrivers(dataDir())).find((row) => row.driver_id === driverId);
    if (!driver) {
      res.status(400).json({ error: 'That name is not in the driver directory.' });
      return;
    }
    const board = await readExtraWorkBoard(dataDir());
    const saved = upsertBid(
      board,
      req.params.id,
      {
        driver_id: driver.driver_id,
        initials: body.initials,
        preference: body.preference,
      },
      getAsOfTimestamp()
    );
    await writeExtraWorkBoard(saved.board, dataDir());
    res.json(saved.posting);
  } catch (error) {
    boardError(res, error);
  }
});

router.delete('/extra-work/:id/bids/:driverId', async (req, res) => {
  try {
    const driverId = requireSession(req, res);
    if (!driverId) return;
    if (driverId !== req.params.driverId) {
      res.status(403).json({ error: 'You can only take your own name off a trip.' });
      return;
    }
    const board = await readExtraWorkBoard(dataDir());
    const saved = removeBid(board, req.params.id, driverId, getAsOfTimestamp());
    await writeExtraWorkBoard(saved.board, dataDir());
    res.json(saved.posting);
  } catch (error) {
    boardError(res, error);
  }
});

async function signedInDriver(req) {
  const sessionId = sessionDriverId(req);
  if (!sessionId) return null;
  const [directory, drivers] = await Promise.all([boardDirectory(), readDrivers(dataDir())]);
  const office = directory.ranked.find((row) => row.driver_id === sessionId);
  const clock =
    drivers.find((row) => row.driver_id === sessionId) ||
    drivers.find((row) => compactName(row.name) === compactName(office?.name));
  const name = office?.name || clock?.name || '';
  const ids = [...new Set([sessionId, clock?.driver_id].filter(Boolean))];
  const officeId = office?.driver_id || sessionId;
  const fromOffice = (directory.schedules || []).filter((row) => row.driver_id === officeId);
  const fromRoutes = routesHeldBy(await readRouteState(dataDir()), {
    driver_id: clock?.driver_id || sessionId,
    name,
  });
  return {
    ids,
    name,
    email: clock?.email || office?.email || '',
    clock_id: clock?.driver_id || sessionId,
    routes: fromOffice.length ? fromOffice : fromRoutes,
  };
}

router.get('/extra-work/dashboard', async (req, res) => {
  try {
    const driver = await signedInDriver(req);
    if (!driver) {
      res.status(401).json({ error: 'Enter your PIN.' });
      return;
    }
    const now = getAsOfTimestamp();
    const [changeLog, punches, calendar, catalog] = await Promise.all([
      readChangeLog(dataDir()),
      readClockPunches(dataDir()),
      readSchoolCalendar(dataDir()),
      readClockReasonCodes(dataDir()),
    ]);
    const period = periodFromQuery(req.query, new Date(now));
    res.json(
      withPortrait(
      buildDriverDashboard({
        changeLog,
        punches,
        routes: driver.routes,
        calendar,
        catalog,
        driver,
        now: new Date(now),
        period,
      })
      )
    );
  } catch (error) {
    boardError(res, error);
  }
});

router.patch('/extra-work/time-card/:id', async (req, res) => {
  try {
    const driver = await signedInDriver(req);
    if (!driver) {
      res.status(401).json({ error: 'Enter your PIN.' });
      return;
    }
    const [punches, catalog, changeLog, calendar] = await Promise.all([
      readClockPunches(dataDir()),
      readClockReasonCodes(dataDir()),
      readChangeLog(dataDir()),
      readSchoolCalendar(dataDir()),
    ]);
    const now = getAsOfTimestamp();
    const saved = applyDriverClockEdit(punches, req.params.id, {
      driver,
      time: req.body?.time,
      note: req.body?.note,
      reasons: req.body?.reasons,
      now,
      catalog,
    });
    await writeClockPunches(saved.punches, dataDir());
    const period = periodFromQuery(req.query, new Date(now));
    res.json(
      withPortrait(
      buildDriverDashboard({
        changeLog,
        punches: saved.punches,
        routes: driver.routes,
        calendar,
        catalog,
        driver,
        now: new Date(now),
        period,
      })
      )
    );
  } catch (error) {
    boardError(res, error);
  }
});

function substituteNameFromBody(body) {
  const first = String(body?.first_name || '').trim();
  const last = String(body?.last_name || '').trim();
  if (first || last) return `${first} ${last}`.replace(/\s+/g, ' ').trim();
  return String(body?.name || '').trim().replace(/\s+/g, ' ');
}

router.get('/substitutes', async (_req, res) => {
  try {
    const drivers = await readDriversIfPresent(dataDir());
    res.json({ drivers: substituteRows(drivers) });
  } catch (error) {
    boardError(res, error);
  }
});

router.post('/substitutes', async (req, res) => {
  try {
    const driver = await createSubstituteDriver(
      {
        name: substituteNameFromBody(req.body),
        email: req.body?.email ?? null,
      },
      dataDir()
    );
    res.status(201).json(driver);
  } catch (error) {
    boardError(res, error);
  }
});

router.delete('/substitutes/:driverId', async (req, res) => {
  try {
    const driver = await deleteSubstituteDriver(req.params.driverId, dataDir());
    res.json(driver);
  } catch (error) {
    boardError(res, error);
  }
});

router.post('/extra-work/:id/award', async (req, res) => {
  try {
    const driverId = String(req.body?.driver_id || '').trim();
    const directory = await boardDirectory();
    const driver =
      directory.ranked.find((row) => row.driver_id === driverId) ||
      (await readDrivers(dataDir())).find((row) => row.driver_id === driverId);
    if (!driver) {
      res.status(400).json({ error: 'That name is not in the driver directory.' });
      return;
    }
    const board = await readExtraWorkBoard(dataDir());
    const saved = awardPosting(board, req.params.id, driver, getAsOfTimestamp());
    await writeExtraWorkBoard(saved.board, dataDir());
    res.json({ posting: saved.posting, email: saved.email, board: saved.board });
  } catch (error) {
    boardError(res, error);
  }
});

export default router;
