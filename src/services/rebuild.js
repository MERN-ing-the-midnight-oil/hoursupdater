import { getAsOfDate } from '../config.js';
import {
  buildLettersByRouteId,
  enqueueNotifications,
  readAppSettings,
  readBidSignupWorkbook,
  readChangeLog,
  readDrivers,
  readRouteState,
  readSchoolCalendar,
  writeRouteState,
} from '../data/storage.js';
import {
  finalizeClosedBidSignups,
  preserveBidSignupMeta,
} from '../logic/bidSignup.js';
import {
  applyBumpDecisions,
  preserveBumpDecisionMeta,
} from '../logic/bumpDecisions.js';
import { preservePayrollNotifiedAt } from '../logic/changeReport.js';
import { collectWindowFinalizationNotifications } from '../logic/notifications.js';
import { preservePaperBidMeta } from '../logic/paperBidSignup.js';
import {
  applyBidAwardResolutions,
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
  asOfDate = getAsOfDate()
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
        .filter(
          (entry) =>
            entry.type !== 'ADJUSTMENT' && entry.type !== 'BULK_IMPORT'
        )
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

  // Bid-award reassignments clear BID_PENDING into STABLE (survives rebuild).
  nextState = applyBidAwardResolutions(nextState, changeLog);

  // Preserve bump due dates / chain ids; then apply explicit Admin bump decisions.
  nextState = preserveBumpDecisionMeta(priorRouteState, nextState);
  nextState = applyBumpDecisions(nextState, changeLog, schoolCalendar);

  // Electronic bid sign-up: preserve due/snapshot, then finalize closed windows.
  nextState = preserveBidSignupMeta(priorRouteState, nextState);
  nextState = preservePaperBidMeta(priorRouteState, nextState);
  /** @type {{ paper_bid_signup_enabled?: boolean } | null} */
  let appSettingsForNotify = null;
  try {
    const [appSettings, drivers] = await Promise.all([
      readAppSettings(dataDir),
      readDrivers(dataDir),
    ]);
    appSettingsForNotify = appSettings;
    if (appSettings.electronic_bid_signup_enabled) {
      const workbook = await readBidSignupWorkbook(
        dataDir,
        appSettings.bid_signup_workbook
      );
      nextState = finalizeClosedBidSignups(nextState, {
        enabled: true,
        parse: workbook.parse,
        drivers,
        workbook_mtime: workbook.mtime,
        asOfDate,
      });
    }
  } catch (error) {
    console.error('Bid signup finalization failed after rebuild:', error);
  }

  await writeRouteState(nextState, dataDir);

  // Offer email notifications for newly finalized windows.
  try {
    const drivers = await readDrivers(dataDir);
    /** @type {Map<string, { name?: string, email?: string | null }>} */
    const driversById = new Map(
      drivers.map((d) => [d.driver_id, { name: d.name, email: d.email }])
    );
    if (!appSettingsForNotify) {
      appSettingsForNotify = await readAppSettings(dataDir);
    }
    const specs = collectWindowFinalizationNotifications(
      priorRouteState,
      nextState,
      {
        driversById,
        paperBidSignupEnabled:
          appSettingsForNotify?.paper_bid_signup_enabled === true,
      }
    );
    // Attach live driver emails when report lacked them.
    for (const spec of specs) {
      if (!spec.context.driver_email && spec.context.driver_id) {
        const d = driversById.get(String(spec.context.driver_id));
        if (d?.email) spec.context.driver_email = d.email;
      }
      if (!spec.context.driver_name && spec.context.driver_id) {
        const d = driversById.get(String(spec.context.driver_id));
        if (d?.name) spec.context.driver_name = d.name;
      }
    }
    await enqueueNotifications(specs, dataDir);
  } catch (error) {
    console.error('Notification enqueue failed after rebuild:', error);
  }

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
