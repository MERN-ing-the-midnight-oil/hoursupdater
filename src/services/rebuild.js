import {
  buildLettersByRouteId,
  readChangeLog,
  readRouteState,
  readSchoolCalendar,
  writeRouteState,
} from '../data/storage.js';
import { preservePayrollNotifiedAt } from '../logic/changeReport.js';
import {
  applyResolvedDrivers,
  rebuildRouteStateFromChangeLog,
} from '../logic/stateMachine.js';
import { syncWorkbook } from './workbookSync.js';

/**
 * Rebuild route-state from the change log, reconciling against the last
 * written state, and persist the result. Then refresh the read-facing workbook
 * (or raise workbook reconciliation if it was edited externally).
 * @param {string} [dataDir]
 * @param {string | Date} [asOfDate]
 */
export async function rebuildAndPersistRouteState(
  dataDir,
  asOfDate = new Date()
) {
  const [changeLog, priorRouteState, schoolCalendar] = await Promise.all([
    readChangeLog(dataDir),
    readRouteState(dataDir),
    readSchoolCalendar(dataDir),
  ]);

  if (
    !schoolCalendar.school_days?.length &&
    !schoolCalendar.days?.some((d) => d.is_school_day)
  ) {
    throw new Error(
      'school-calendar.json has no school days. Import the district calendar before submitting changes.'
    );
  }

  const routeIds = [
    ...new Set([
      ...Object.keys(priorRouteState),
      ...changeLog
        .filter((entry) => entry.type !== 'ADJUSTMENT')
        .map((entry) => /** @type {{ route_id?: string }} */ (entry).route_id)
        .filter(Boolean),
    ]),
  ];

  const lettersByRouteId = await buildLettersByRouteId(routeIds, dataDir);

  let nextState = rebuildRouteStateFromChangeLog(
    changeLog,
    {},
    schoolCalendar,
    asOfDate,
    {
      priorRouteState,
      lettersByRouteId,
    }
  );

  // Routes with no change-log entries (e.g. seeded STABLE baselines) must survive rebuild.
  for (const [routeId, prior] of Object.entries(priorRouteState)) {
    if (!nextState[routeId]) {
      nextState[routeId] = prior;
    }
  }

  // Reassignments (and later changes) may only appear for preserved priors — resolve live assignment.
  Object.assign(
    nextState,
    applyResolvedDrivers(nextState, changeLog, asOfDate)
  );

  // Report ids are regenerated; keep payroll notify timestamps by stable match key.
  nextState = preservePayrollNotifiedAt(priorRouteState, nextState);

  await writeRouteState(nextState, dataDir);

  try {
    await syncWorkbook({
      appDataDir: dataDir,
      asOfDate,
    });
  } catch (error) {
    console.error('Workbook sync failed after route-state rebuild:', error);
  }

  return nextState;
}
