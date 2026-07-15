#!/usr/bin/env node
/**
 * Seed local practice sandbox into practice-data/_app_data.
 *
 * - Short practice school calendar (~next 30 calendar days) via generateSchoolYearCalendar
 * - Drivers + routes via the same bulk-import plan/event path as Admin
 * - One Unassigned route included in the BULK_IMPORT audit event
 * - Attribution: entered_by "Practice Setup" (test-only)
 *
 * Usage: npm run seed:practice
 *        npm run seed:practice -- --force   (overwrite existing sandbox)
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  APP_DATA_DIRNAME,
  assertPracticeSharedRoot,
  getAppDataDir,
  isPracticeMode,
} from '../src/config.js';
import {
  appendBulkImportEvent,
  ensureDataDir,
  writeDrivers,
  writeRouteState,
  writeSchoolCalendar,
  writeStaffNames,
} from '../src/data/storage.js';
import {
  buildBulkImportEvent,
  buildSeededRouteState,
  planBulkImportWrites,
  previewBulkImport,
  resolveBulkImportPreview,
} from '../src/logic/bulkImport.js';
import { generateSchoolYearCalendar } from '../src/logic/schoolCalendarGenerate.js';
import { syncWorkbook } from '../src/services/workbookSync.js';

const PRACTICE_ENTERED_BY = 'Practice Setup';
const PRACTICE_NOTE =
  'Local sandbox seed data — not real';

const UNASSIGNED_ROUTE_ID = 'P U1';

/**
 * Five assigned practice routes (bulk-import CSV). Two additional junior drivers
 * are created in the same BULK_IMPORT batch with no route (bump/bid targets).
 */
const PRACTICE_CSV = `driver_name,driver_email,hire_date,route_id,am_time,midday_time,pm_time
Evelyn Marks,evelyn.marks@practice.invalid,2008-09-02,P 10,6:15-8:40,10:00-12:05,3:05-5:00
Marco Delgado,marco.delgado@practice.invalid,2011-03-15,P 20,6:40-8:55,10:15-12:20,2:55-4:50
Priya Shah,priya.shah@practice.invalid,2015-08-20,P 30,6:36-8:50,9:55-12:00,3:10-5:05
Jonah Blake,jonah.blake@practice.invalid,2018-01-10,P 40,6:22-8:45,10:05-12:10,3:00-4:55
Reese Callahan,reese.callahan@practice.invalid,2019-11-04,P 50,6:48-9:05,10:20-12:25,3:15-5:10
`;

/** Drivers with no initial route (still part of the same BULK_IMPORT event). */
const EXTRA_DRIVERS = [
  {
    name: 'Avery Nguyen',
    email: 'avery.nguyen@practice.invalid',
    hire_date: '2022-09-01',
  },
  {
    name: 'Sam Ortega',
    email: 'sam.ortega@practice.invalid',
    hire_date: '2024-04-18',
  },
];

/**
 * @param {Date} d
 * @returns {string}
 */
function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * @param {string} iso
 * @param {number} days
 * @returns {string}
 */
function addCalendarDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/**
 * @param {string} appDataDir
 * @returns {Promise<boolean>}
 */
async function practiceDataLooksSeeded(appDataDir) {
  try {
    const raw = await fs.readFile(
      path.join(appDataDir, 'change-log.json'),
      'utf8'
    );
    const log = JSON.parse(raw || '[]');
    if (Array.isArray(log) && log.length > 0) return true;
  } catch {
    // missing or empty
  }
  try {
    const raw = await fs.readFile(
      path.join(appDataDir, 'drivers.json'),
      'utf8'
    );
    const drivers = JSON.parse(raw || '[]');
    if (Array.isArray(drivers) && drivers.length > 0) return true;
  } catch {
    // missing or empty
  }
  return false;
}

/**
 * @param {{ force?: boolean }} [options]
 */
export async function seedPracticeData(options = {}) {
  if (!isPracticeMode()) {
    throw new Error(
      'PRACTICE_MODE is not set. Run via npm run seed:practice (loads .env.practice).'
    );
  }

  const sharedRoot = assertPracticeSharedRoot();
  const appDataDir = getAppDataDir();
  await ensureDataDir(appDataDir);

  const force = Boolean(options.force);
  if (!force && (await practiceDataLooksSeeded(appDataDir))) {
    throw new Error(
      `Practice data already exists in ${appDataDir}. Use npm run reset:practice to wipe and re-seed.`
    );
  }

  const today = toIsoDate(new Date());
  const lastDay = addCalendarDays(today, 29);
  const { calendar } = generateSchoolYearCalendar({
    first_day: today,
    last_day: lastDay,
    breaks: [],
    holidays: [],
    school_year: 'Practice sandbox',
  });
  await writeSchoolCalendar(calendar, appDataDir);

  await writeStaffNames([PRACTICE_ENTERED_BY], appDataDir);

  const preview = previewBulkImport(PRACTICE_CSV, {
    drivers: [],
    routeState: {},
    changeLog: [],
  });
  const resolved = resolveBulkImportPreview(preview, {});
  if (resolved.accepted.length === 0) {
    throw new Error('Practice bulk-import produced no accepted rows.');
  }

  const writes = planBulkImportWrites(
    resolved.accepted,
    [],
    preview.conflicts
  );

  const extraDrivers = EXTRA_DRIVERS.map((d) => ({
    driver_id: randomUUID(),
    name: d.name,
    email: d.email,
    hire_date: d.hire_date,
    tie_break: null,
  }));
  const allCreatedDrivers = [...writes.createdDrivers, ...extraDrivers];
  const allDrivers = [...writes.allDrivers, ...extraDrivers];

  const unassignedEntry = buildSeededRouteState({
    driver_name: '',
    driver_id: null,
    segments: {
      AM: '6:28-8:35',
      MIDDAY: null,
      PM: '3:08-4:58',
    },
  });

  const routeState = {};
  for (const route of writes.routes) {
    routeState[route.route_id] = route.entry;
  }
  routeState[UNASSIGNED_ROUTE_ID] = unassignedEntry;

  await writeDrivers(allDrivers, appDataDir);
  await writeRouteState(routeState, appDataDir);

  // Fresh sandbox — empty log then one BULK_IMPORT event (same shape as Admin commit).
  await fs.writeFile(path.join(appDataDir, 'change-log.json'), '[]\n', 'utf8');

  const eventPayload = buildBulkImportEvent({
    createdDrivers: allCreatedDrivers,
    updatedDrivers: writes.updatedDrivers,
    routes: [
      ...writes.routes,
      {
        route_id: UNASSIGNED_ROUTE_ID,
        action: /** @type {const} */ ('create'),
        entry: unassignedEntry,
      },
    ],
    skipped_row_numbers: resolved.skipped_row_numbers,
    entered_by: PRACTICE_ENTERED_BY,
    note: PRACTICE_NOTE,
  });
  await appendBulkImportEvent(eventPayload, appDataDir);

  const workbook = await syncWorkbook({ sharedRoot, appDataDir });

  const schoolDayCount = calendar.school_days?.length ?? 0;
  console.log(`Practice calendar: ${calendar.coverage_start} → ${calendar.coverage_end}`);
  console.log(
    `School days in window ${today}…${lastDay}: ${schoolDayCount} (weekends excluded by generator)`
  );
  console.log(
    `Drivers: ${allCreatedDrivers.length}; routes: ${writes.routes.length} assigned + 1 Unassigned (${UNASSIGNED_ROUTE_ID}); ${extraDrivers.length} drivers with no route`
  );
  console.log(`BULK_IMPORT entered_by="${PRACTICE_ENTERED_BY}"`);
  console.log(`Workbook: ${workbook.status} → ${workbook.path}`);
  console.log(`Practice data ready in ${path.join(sharedRoot, APP_DATA_DIRNAME)}`);
}

const force =
  process.argv.includes('--force') || process.argv.includes('--yes');

const isDirectRun = process.argv[1]?.includes('seed-practice-data');
if (isDirectRun) {
  try {
    await seedPracticeData({ force });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
