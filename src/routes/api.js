import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  SEGMENTS,
  getAppDataDir,
  getDataDir,
  getSharedRoot,
  getWorkbookPath,
  getAsOfDate,
  getAsOfTimestamp,
} from '../config.js';
import {
  appendAdjustmentEvent,
  appendBulkImportEvent,
  appendBumpDecisionEvent,
  appendChangeEvent,
  appendNeedsReviewResolutionEvent,
  appendReassignmentEvent,
  appendSeniorityTieResolutionEvent,
  createDriver,
  enqueueNotifications,
  findDriverById,
  findDriverByName,
  getCurrentSegmentTime,
  markNotification,
  readAdjustmentReasons,
  readAppSettings,
  readBidSignupWorkbook,
  readChangeLog,
  readDrivers,
  readEmailTemplates,
  readNotifications,
  readPayrollSettings,
  readPendingNotifications,
  readReasonCategories,
  readRouteState,
  readSchoolCalendar,
  readStaffNames,
  readWorkbookReconciliation,
  readWorkbookSyncStatus,
  updateDriver,
  writeAdjustmentReasons,
  writeAppSettings,
  writeDrivers,
  writeEmailTemplates,
  writePayrollSettings,
  writeReasonCategories,
  writeRouteState,
  writeSchoolCalendar,
  writeStaffNames,
} from '../data/storage.js';
import { buildOpenBidPostingDraft, emptyBidSignupState } from '../logic/bidSignup.js';
import {
  isStrictlyJuniorDriver,
  listBumpTargets,
  validateBumpDecisionEvent,
} from '../logic/bumpDecisions.js';
import {
  buildBulkImportEvent,
  planBulkImportWrites,
  previewBulkImport,
  resolveBulkImportPreview,
} from '../logic/bulkImport.js';
import {
  commitYearArchive,
  previewYearArchive,
} from '../services/yearArchive.js';
import { buildDriverEmailDraft } from '../logic/changeReport.js';
import {
  buildBidAwardPayrollSpec,
  buildNeedsReviewContradictionSpec,
  buildNotificationMailto,
  buildReassignmentNotificationSpec,
  collectBumpDecisionPayrollSpecs,
  EMAIL_NOTIFICATION_EVENT_TYPES,
  EVENT_LABELS,
  formatNotificationPrompt,
  TEMPLATE_PLACEHOLDERS,
} from '../logic/notifications.js';
import { buildPaperBidSheet } from '../logic/paperBidSignup.js';
import {
  buildPaperBidSheetDocxBuffer,
  paperBidSheetDocxFilename,
} from '../logic/paperBidSheetDocx.js';
import {
  findCalendarGenerationConflicts,
  generateSchoolYearCalendar,
  mergeGeneratedSchoolCalendar,
} from '../logic/schoolCalendarGenerate.js';
import {
  isAdjustmentEvent,
  isChangeEvent,
  resolveEffectiveDeltas,
  validateAdjustmentEvent,
  validateChangeEvent,
  validateNeedsReviewResolutionEvent,
  validateReassignmentEvent,
  validateSeniorityTieResolutionEvent,
} from '../logic/stateMachine.js';
import {
  applySeniorityTieResolution,
  findUnresolvedSeniorityTies,
} from '../logic/seniority.js';
import { computeDeltaMinutes } from '../logic/timeUtils.js';
import { buildAdminQueue, buildDriverDetail } from '../services/adminViews.js';
import { rebuildAndPersistRouteState } from '../services/rebuild.js';
import {
  discardWorkbookEdits,
  syncWorkbook,
} from '../services/workbookSync.js';

const router = Router();

function dataDir() {
  return getDataDir();
}

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    sharedRoot: getSharedRoot(),
    appDataDir: getAppDataDir(),
    workbookPath: getWorkbookPath(),
    dataDir: getDataDir(),
  });
});

router.get('/meta', async (_req, res, next) => {
  try {
    res.json({
      segments: SEGMENTS,
      reason_categories: await readReasonCategories(dataDir()),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/adjustment-reasons', async (_req, res, next) => {
  try {
    res.json(await readAdjustmentReasons(dataDir()));
  } catch (error) {
    next(error);
  }
});

router.put('/adjustment-reasons', async (req, res, next) => {
  try {
    const updated = await writeAdjustmentReasons(req.body ?? [], dataDir());
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.get('/reason-categories', async (_req, res, next) => {
  try {
    res.json(await readReasonCategories(dataDir()));
  } catch (error) {
    next(error);
  }
});

router.put('/reason-categories', async (req, res, next) => {
  try {
    const updated = await writeReasonCategories(req.body ?? [], dataDir());
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.get('/staff-names', async (_req, res, next) => {
  try {
    res.json(await readStaffNames(dataDir()));
  } catch (error) {
    next(error);
  }
});

router.put('/staff-names', async (req, res, next) => {
  try {
    const updated = await writeStaffNames(req.body ?? [], dataDir());
    await syncWorkbook({ appDataDir: dataDir() }).catch(() => null);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.get('/payroll-settings', async (_req, res, next) => {
  try {
    res.json(await readPayrollSettings(dataDir()));
  } catch (error) {
    next(error);
  }
});

router.put('/payroll-settings', async (req, res, next) => {
  try {
    const updated = await writePayrollSettings(req.body ?? {}, dataDir());
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.get('/app-settings', async (_req, res, next) => {
  try {
    res.json(await readAppSettings(dataDir()));
  } catch (error) {
    next(error);
  }
});

router.put('/app-settings', async (req, res, next) => {
  try {
    const prior = await readAppSettings(dataDir());
    const updated = await writeAppSettings(req.body ?? {}, dataDir());
    // Rebuild so bid-signup windows finalize if the toggle was just enabled.
    await rebuildAndPersistRouteState(dataDir()).catch(() => null);

    // When paper bid is newly activated, offer print sheets for routes
    // already sitting in BID_PENDING (deduped by source_key).
    if (
      updated.paper_bid_signup_enabled &&
      !prior.paper_bid_signup_enabled
    ) {
      try {
        const state = await readRouteState(dataDir());
        /** @type {import('../logic/notifications.js').NotificationEnqueueSpec[]} */
        const specs = [];
        for (const [routeId, entry] of Object.entries(state)) {
          if (entry.status !== 'BID_PENDING') continue;
          specs.push({
            event_type: 'PAPER_BID_SIGNUP',
            route_id: routeId,
            source_key: `PAPER_BID_SIGNUP|${routeId}|active`,
            context: {
              route_id: routeId,
              driver_name: entry.driver_name ?? null,
              driver_id: entry.driver_id ?? null,
              bid_response_due_date: entry.bid_response_due_date ?? null,
              outcome: 'BID_PENDING',
            },
          });
        }
        if (specs.length) await enqueueNotifications(specs, dataDir());
      } catch (error) {
        console.error(
          'Paper bid signup notify-on-enable failed:',
          error
        );
      }
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.get('/email-templates', async (_req, res, next) => {
  try {
    const settings = await readEmailTemplates(dataDir());
    res.json({
      ...settings,
      event_types: EMAIL_NOTIFICATION_EVENT_TYPES,
      event_labels: EVENT_LABELS,
      placeholders: TEMPLATE_PLACEHOLDERS,
    });
  } catch (error) {
    next(error);
  }
});

router.put('/email-templates', async (req, res, next) => {
  try {
    const updated = await writeEmailTemplates(req.body ?? {}, dataDir());
    res.json({
      ...updated,
      event_types: EMAIL_NOTIFICATION_EVENT_TYPES,
      event_labels: EVENT_LABELS,
      placeholders: TEMPLATE_PLACEHOLDERS,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/notifications', async (req, res, next) => {
  try {
    const pendingOnly = String(req.query.pending || '') === '1';
    const list = pendingOnly
      ? await readPendingNotifications(dataDir())
      : await readNotifications(dataDir());
    const settings = await readEmailTemplates(dataDir());
    res.json({
      notifications: list.map((n) => ({
        ...n,
        prompt: formatNotificationPrompt(n),
        draft: buildNotificationMailto(n, settings),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/notifications/:id/action', async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    const settings = await readEmailTemplates(dataDir());
    const list = await readNotifications(dataDir());
    const note = list.find((n) => n.id === id);
    if (!note) {
      res.status(404).json({ error: `Notification not found: ${id}` });
      return;
    }
    const draft = buildNotificationMailto(note, settings);
    if (!draft.can_send) {
      res.status(400).json({
        error:
          draft.disabled_reason ||
          (note.event_type === 'PAPER_BID_SIGNUP'
            ? 'Cannot open paper sign-up sheet for this notification.'
            : 'Cannot draft email for this notification.'),
        draft,
      });
      return;
    }
    const updated = await markNotification(id, 'actioned', dataDir());
    res.json({
      notification: {
        ...updated,
        prompt: formatNotificationPrompt(updated),
        draft,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/notifications/:id/dismiss', async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    const updated = await markNotification(id, 'dismissed', dataDir());
    res.json({
      notification: {
        ...updated,
        prompt: formatNotificationPrompt(updated),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/school-calendar', async (_req, res, next) => {
  try {
    res.json(await readSchoolCalendar(dataDir()));
  } catch (error) {
    next(error);
  }
});

router.put('/school-calendar', async (req, res, next) => {
  try {
    const updated = await writeSchoolCalendar(req.body ?? {}, dataDir());
    // Open windows recompute expires dates from the calendar on rebuild.
    await rebuildAndPersistRouteState(dataDir()).catch((error) => {
      console.error('Rebuild after school-calendar update failed:', error);
    });
    await syncWorkbook({ appDataDir: dataDir() }).catch(() => null);
    res.json(updated);
  } catch (error) {
    if (error instanceof Error && /school day|school_days|school_year|Duplicate|Invalid|Coverage|outside calendar/i.test(error.message)) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

/**
 * Preview a generated school year — does not write.
 * Body: { first_day, last_day, breaks?, holidays?, school_year? }
 */
router.post('/school-calendar/generate', async (req, res, next) => {
  try {
    const existing = await readSchoolCalendar(dataDir());
    const generated = generateSchoolYearCalendar(req.body ?? {});
    const conflicts = findCalendarGenerationConflicts(
      existing,
      generated.calendar
    );
    res.json({
      preview: generated.calendar,
      summary: generated.summary,
      coverage_boundary: generated.coverage_boundary,
      conflicts,
      requires_confirm: conflicts.has_overlap,
    });
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

/**
 * Commit a generated school year into school-calendar.json.
 * Body: generation fields + optional confirm_replace: true when overlaps exist.
 */
router.post('/school-calendar/generate/commit', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const existing = await readSchoolCalendar(dataDir());
    const generated = generateSchoolYearCalendar(body);
    const conflicts = findCalendarGenerationConflicts(
      existing,
      generated.calendar
    );

    if (conflicts.has_overlap && body.confirm_replace !== true) {
      res.status(409).json({
        error:
          'Generated dates overlap existing calendar data. Confirm replace to continue.',
        conflicts,
        summary: generated.summary,
        coverage_boundary: generated.coverage_boundary,
        requires_confirm: true,
      });
      return;
    }

    const merged = mergeGeneratedSchoolCalendar(existing, generated.calendar);
    const updated = await writeSchoolCalendar(merged, dataDir());
    await rebuildAndPersistRouteState(dataDir()).catch((error) => {
      console.error('Rebuild after calendar generate commit failed:', error);
    });
    await syncWorkbook({ appDataDir: dataDir() }).catch(() => null);

    res.json({
      calendar: updated,
      summary: generated.summary,
      coverage_boundary: generated.coverage_boundary,
      conflicts,
      replaced_overlap: conflicts.has_overlap,
    });
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

/**
 * Preview (or first-use check) for Archive Year — does not write.
 * Returns counts, named mid-flight routes, and whether archive can be skipped.
 */
router.get('/year-archive/preview', async (_req, res, next) => {
  try {
    const preview = await previewYearArchive();
    res.json(preview);
  } catch (error) {
    next(error);
  }
});

/**
 * Copy current `_app_data` + workbook into archives/<admin-named folder>/.
 * Does not delete source data and does not start the roster import.
 * Body: { archive_folder_name, confirm_folder_name, entered_by, note }
 */
router.post('/year-archive/commit', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const archive_folder_name = String(body.archive_folder_name ?? '');
    const confirm_folder_name = String(body.confirm_folder_name ?? '');
    const entered_by = String(body.entered_by ?? '').trim();
    const note = String(body.note ?? '').trim();

    const staffNames = await readStaffNames(dataDir());
    if (!entered_by) {
      res.status(400).json({ error: 'entered_by is required.' });
      return;
    }
    if (staffNames.length === 0) {
      res.status(400).json({
        error:
          'No staff names configured. Add names in Admin settings before archiving.',
      });
      return;
    }
    if (!staffNames.includes(entered_by)) {
      res.status(400).json({
        error: 'entered_by must be one of the configured staff names.',
      });
      return;
    }
    if (!note) {
      res.status(400).json({ error: 'note is required.' });
      return;
    }

    const result = await commitYearArchive({
      archive_folder_name,
      confirm_folder_name,
      entered_by,
      note,
    });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof Error) {
      const code = /** @type {any} */ (error).code;
      const status =
        code === 'FOLDER_EXISTS'
          ? 409
          : code === 'NOTHING_TO_ARCHIVE'
            ? 400
            : 400;
      res.status(status).json({ error: error.message, code });
      return;
    }
    next(error);
  }
});

/**
 * Preview a bulk roster import — does not write.
 * Body: { text: string } (CSV / pasted table)
 */
router.post('/bulk-import/preview', async (req, res, next) => {
  try {
    const text = String(req.body?.text ?? '');
    const [drivers, routeState, changeLog] = await Promise.all([
      readDrivers(dataDir()),
      readRouteState(dataDir()),
      readChangeLog(dataDir()),
    ]);
    const preview = previewBulkImport(text, {
      drivers,
      routeState,
      changeLog,
    });
    res.json(preview);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

/**
 * Commit a bulk roster import.
 * Body: { text, entered_by, note, resolutions?: { [row_number]: 'skip'|'overwrite' } }
 */
router.post('/bulk-import/commit', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const text = String(body.text ?? '');
    const entered_by = String(body.entered_by ?? '').trim();
    const note = String(body.note ?? '').trim();
    /** @type {Record<string, 'skip' | 'overwrite'>} */
    const resolutions = body.resolutions && typeof body.resolutions === 'object'
      ? body.resolutions
      : {};

    const staffNames = await readStaffNames(dataDir());
    if (entered_by && staffNames.length && !staffNames.includes(entered_by)) {
      res.status(400).json({
        error: 'entered_by must be one of the configured staff names.',
      });
      return;
    }

    const [drivers, routeState, changeLog] = await Promise.all([
      readDrivers(dataDir()),
      readRouteState(dataDir()),
      readChangeLog(dataDir()),
    ]);
    const preview = previewBulkImport(text, {
      drivers,
      routeState,
      changeLog,
    });

    let resolved;
    try {
      resolved = resolveBulkImportPreview(preview, resolutions);
    } catch (error) {
      if (
        error instanceof Error &&
        /** @type {any} */ (error).code === 'UNRESOLVED_CONFLICTS'
      ) {
        res.status(409).json({
          error: error.message,
          conflicts: preview.conflicts,
          requires_resolutions: true,
        });
        return;
      }
      throw error;
    }

    if (resolved.accepted.length === 0) {
      res.status(400).json({
        error:
          'Nothing to import — every row was excluded or skipped. Fix the file and preview again.',
      });
      return;
    }

    const writes = planBulkImportWrites(
      resolved.accepted,
      drivers,
      preview.conflicts
    );

    await writeDrivers(writes.allDrivers, dataDir());

    const nextRouteState = { ...routeState };
    for (const route of writes.routes) {
      nextRouteState[route.route_id] = route.entry;
    }
    await writeRouteState(nextRouteState, dataDir());

    const eventPayload = buildBulkImportEvent({
      createdDrivers: writes.createdDrivers,
      updatedDrivers: writes.updatedDrivers,
      routes: writes.routes,
      skipped_row_numbers: resolved.skipped_row_numbers,
      entered_by,
      note,
    });
    const event = await appendBulkImportEvent(eventPayload, dataDir());

    await syncWorkbook({ appDataDir: dataDir() }).catch(() => null);

    res.status(201).json({
      event,
      summary: resolved.summary,
      excluded_rows: preview.excluded_rows,
    });
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.get('/drivers', async (_req, res, next) => {
  try {
    const drivers = await readDrivers(dataDir());
    res.json(
      [...drivers].sort((a, b) => a.name.localeCompare(b.name))
    );
  } catch (error) {
    next(error);
  }
});

router.post('/drivers', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const driver = await createDriver(
      {
        name: body.name,
        email: body.email ?? null,
        hire_date: body.hire_date,
        // Lots outcomes are recorded only via seniority-tie resolve.
        tie_break: null,
      },
      dataDir()
    );
    await syncWorkbook({ appDataDir: dataDir() }).catch(() => null);
    res.status(201).json(driver);
  } catch (error) {
    const message = /** @type {Error} */ (error).message;
    if (
      message.includes('already exists') ||
      message.includes('required') ||
      message.includes('hire_date') ||
      message.includes('tie_break')
    ) {
      res.status(400).json({ error: message });
      return;
    }
    next(error);
  }
});

router.put('/drivers/:driverId', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (body.tie_break !== undefined) {
      res.status(400).json({
        error:
          'tie_break cannot be set here. Resolve same-date seniority ties on the Drivers/Routes page after office lots (Art. 3.01).',
      });
      return;
    }
    /** @type {{ name?: string, email?: string | null, hire_date?: string | null }} */
    const patch = {
      name: body.name,
      email: body.email,
    };
    if (body.hire_date !== undefined) patch.hire_date = body.hire_date;
    const driver = await updateDriver(req.params.driverId, patch, dataDir());
    await syncWorkbook({ appDataDir: dataDir() }).catch(() => null);
    res.json(driver);
  } catch (error) {
    const message = /** @type {Error} */ (error).message;
    if (message.startsWith('Driver not found')) {
      res.status(404).json({ error: message });
      return;
    }
    if (
      message.includes('required') ||
      message.includes('hire_date') ||
      message.includes('tie_break')
    ) {
      res.status(400).json({ error: message });
      return;
    }
    next(error);
  }
});

router.put('/drivers', async (req, res, next) => {
  try {
    const updated = await writeDrivers(req.body ?? [], dataDir());
    await syncWorkbook({ appDataDir: dataDir() }).catch(() => null);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.get('/admin/seniority-ties', async (_req, res, next) => {
  try {
    const drivers = await readDrivers(dataDir());
    const ties = findUnresolvedSeniorityTies(drivers).map((tie) => ({
      hire_date: tie.hire_date,
      drivers: tie.drivers.map((d) => ({
        driver_id: d.driver_id,
        name: d.name,
        email: d.email,
        hire_date: d.hire_date,
        tie_break: d.tie_break ?? null,
      })),
    }));
    res.json({ ties });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/seniority-ties/resolve', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const hire_date = String(body.hire_date || '').trim();
    const ordered_driver_ids = Array.isArray(body.ordered_driver_ids)
      ? body.ordered_driver_ids.map((id) => String(id || '').trim())
      : [];
    const resolved_by = String(body.resolved_by || '').trim();
    const note = String(body.note || '').trim();

    const staffNames = await readStaffNames(dataDir());
    const drivers = await readDrivers(dataDir());

    let nextDrivers;
    try {
      nextDrivers = applySeniorityTieResolution(drivers, {
        hire_date,
        ordered_driver_ids,
      });
    } catch (error) {
      res.status(400).json({
        error: /** @type {Error} */ (error).message,
      });
      return;
    }

    const assignments = ordered_driver_ids.map((driverId, index) => {
      const driver = nextDrivers.find((d) => d.driver_id === driverId);
      return {
        driver_id: driverId,
        driver_name: driver?.name ?? driverId,
        tie_break: index + 1,
      };
    });

    /** @type {import('../logic/stateMachine.js').SeniorityTieResolutionEvent} */
    const event = {
      type: 'SENIORITY_TIE_RESOLUTION',
      hire_date,
      assignments,
      note,
      resolved_by,
      resolved_at: getAsOfTimestamp(),
    };

    const errors = validateSeniorityTieResolutionEvent(event, staffNames);
    if (errors.length) {
      res.status(400).json({ error: errors.join(' ') });
      return;
    }

    await writeDrivers(nextDrivers, dataDir());
    const saved = await appendSeniorityTieResolutionEvent(event, dataDir());
    await syncWorkbook({ appDataDir: dataDir() }).catch(() => null);

    res.status(201).json({
      resolution: saved,
      ties: findUnresolvedSeniorityTies(nextDrivers).map((tie) => ({
        hire_date: tie.hire_date,
        drivers: tie.drivers.map((d) => ({
          driver_id: d.driver_id,
          name: d.name,
          tie_break: d.tie_break ?? null,
        })),
      })),
      message: `Recorded lots order for hire date ${hire_date}.`,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/routes', async (_req, res, next) => {
  try {
    const state = await readRouteState(dataDir());
    const routes = Object.entries(state)
      .map(([route_id, entry]) => ({
        route_id,
        driver_name: entry.driver_name,
        driver_id: entry.driver_id ?? null,
        status: entry.status,
        segments: entry.segments,
        cumulative_drift_minutes: entry.cumulative_drift_minutes,
        window_expires_date: entry.window_expires_date,
        pending_change_ids: entry.pending_change_ids ?? [],
        change_reports: entry.change_reports ?? [],
        payroll_rounded_total_minutes: entry.payroll_rounded_total_minutes,
      }))
      .sort((a, b) => a.route_id.localeCompare(b.route_id));
    res.json(routes);
  } catch (error) {
    next(error);
  }
});

router.get('/admin/queue', async (_req, res, next) => {
  try {
    res.json(await buildAdminQueue(dataDir()));
  } catch (error) {
    next(error);
  }
});

router.get('/admin/drivers/:driverId', async (req, res, next) => {
  try {
    const detail = await buildDriverDetail(req.params.driverId, dataDir());
    if (!detail) {
      res.status(404).json({
        error: `Driver not found: ${req.params.driverId}`,
      });
      return;
    }
    res.json(detail);
  } catch (error) {
    next(error);
  }
});

router.get('/routes/:routeId', async (req, res, next) => {
  try {
    const state = await readRouteState(dataDir());
    const entry = state[req.params.routeId];
    if (!entry) {
      res.status(404).json({ error: `Route not found: ${req.params.routeId}` });
      return;
    }
    res.json({ route_id: req.params.routeId, ...entry });
  } catch (error) {
    next(error);
  }
});

router.get(
  '/routes/:routeId/change-reports/:reportId/email-draft',
  async (req, res, next) => {
    try {
      const state = await readRouteState(dataDir());
      const entry = state[req.params.routeId];
      if (!entry) {
        res.status(404).json({ error: `Route not found: ${req.params.routeId}` });
        return;
      }

      const report = (entry.change_reports ?? []).find(
        (item) => item.id === req.params.reportId
      );
      if (!report) {
        res.status(404).json({
          error: `Change report not found: ${req.params.reportId}`,
        });
        return;
      }

      let driver = report.driver_id
        ? await findDriverById(report.driver_id, dataDir())
        : null;
      if (!driver && report.driver_name?.trim()) {
        driver = await findDriverByName(report.driver_name, dataDir());
      }

      const isUnassigned = !report.driver_id && !report.driver_name?.trim();
      const draft = buildDriverEmailDraft(
        report,
        isUnassigned
          ? null
          : {
              name: driver?.name || report.driver_name || 'Driver',
              email: driver?.email ?? null,
            }
      );

      res.json({
        report_id: report.id,
        route_id: req.params.routeId,
        driver: isUnassigned
          ? {
              driver_id: null,
              name: null,
              email: null,
            }
          : driver
            ? {
                driver_id: driver.driver_id,
                name: driver.name,
                email: driver.email,
              }
            : {
                driver_id: null,
                name: report.driver_name,
                email: null,
              },
        ...draft,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/routes/:routeId/change-reports/:reportId/payroll-draft',
  (_req, res) => {
    res.status(410).json({
      error:
        'Notify Payroll on BID_PENDING was removed. Payroll is offered via Admin toasts when rounded contracted hours actually change.',
    });
  }
);

router.post(
  '/routes/:routeId/change-reports/:reportId/payroll-notified',
  (_req, res) => {
    res.status(410).json({
      error:
        'Notify Payroll on BID_PENDING was removed. Use the payroll contracted-hours toast when offered.',
    });
  }
);

router.get('/routes/:routeId/open-bid-draft', async (req, res, next) => {
  try {
    const routeId = String(req.params.routeId || '').trim();
    const [appSettings, drivers, state, emailTemplates] = await Promise.all([
      readAppSettings(dataDir()),
      readDrivers(dataDir()),
      readRouteState(dataDir()),
      readEmailTemplates(dataDir()),
    ]);
    if (!appSettings.electronic_bid_signup_enabled) {
      res.status(400).json({
        error:
          'Electronic bid sign-up is off. Enable it in Admin Settings only after office + Union agreement.',
      });
      return;
    }
    const route = state[routeId];
    if (!route) {
      res.status(404).json({ error: `Route not found: ${routeId}` });
      return;
    }
    if (route.status !== 'BID_PENDING') {
      res.status(400).json({
        error: 'Open bid posting is only available while the route is BID_PENDING.',
      });
      return;
    }
    const template = emailTemplates.templates.OPEN_BID_POSTING ?? {
      subject: 'Route {{route_id}} — open for bid (sign-up)',
      body: 'Route {{route_id}} is posted for bid. Sign up by {{bid_response_due_date}}.',
    };
    const draft = buildOpenBidPostingDraft({
      route_id: routeId,
      bid_response_due_date: route.bid_response_due_date,
      drivers,
      template,
      to_email: appSettings.open_bid_posting_to_email,
    });
    res.json({
      route_id: routeId,
      bid_response_due_date: route.bid_response_due_date,
      drivers_notified_at: route.bid_signup?.drivers_notified_at ?? null,
      ...draft,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/routes/:routeId/open-bid-notified', async (req, res, next) => {
  try {
    const routeId = String(req.params.routeId || '').trim();
    const [appSettings, state] = await Promise.all([
      readAppSettings(dataDir()),
      readRouteState(dataDir()),
    ]);
    if (!appSettings.electronic_bid_signup_enabled) {
      res.status(400).json({ error: 'Electronic bid sign-up is off.' });
      return;
    }
    const entry = state[routeId];
    if (!entry || entry.status !== 'BID_PENDING') {
      res.status(400).json({
        error: 'Route must be BID_PENDING to record open-bid notification.',
      });
      return;
    }
    const drivers_notified_at = getAsOfTimestamp();
    const prior = entry.bid_signup ?? emptyBidSignupState();
    state[routeId] = {
      ...entry,
      bid_signup: {
        ...prior,
        drivers_notified_at,
      },
    };
    await writeRouteState(state, dataDir());
    res.json({ route_id: routeId, drivers_notified_at });
  } catch (error) {
    next(error);
  }
});

/**
 * Load a paper bid sheet for a BID_PENDING route (shared by JSON + docx).
 * @param {string} routeId
 * @returns {Promise<
 *   | { ok: true, sheet: ReturnType<typeof buildPaperBidSheet> }
 *   | { ok: false, status: number, error: string }
 * >}
 */
async function loadPaperBidSheetForRoute(routeId) {
  const [appSettings, drivers, state] = await Promise.all([
    readAppSettings(dataDir()),
    readDrivers(dataDir()),
    readRouteState(dataDir()),
  ]);
  if (!appSettings.paper_bid_signup_enabled) {
    return {
      ok: false,
      status: 400,
      error:
        'Paper bid sign-up is off. Enable it in Admin Settings → Paper bid sign-up.',
    };
  }
  const route = state[routeId];
  if (!route) {
    return { ok: false, status: 404, error: `Route not found: ${routeId}` };
  }
  if (route.status !== 'BID_PENDING') {
    return {
      ok: false,
      status: 400,
      error:
        'Paper sign-up sheets are only available while the route is BID_PENDING.',
    };
  }
  return {
    ok: true,
    sheet: buildPaperBidSheet({
      route_id: routeId,
      driver_id: route.driver_id,
      driver_name: route.driver_name,
      segments: route.segments,
      bid_response_due_date: route.bid_response_due_date,
      paper_bid_start_date: route.paper_bid_start_date,
      drivers,
      template: appSettings.paper_bid_sheet,
    }),
  };
}

router.get('/routes/:routeId/paper-bid-sheet', async (req, res, next) => {
  try {
    const routeId = String(req.params.routeId || '').trim();
    const result = await loadPaperBidSheetForRoute(routeId);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result.sheet);
  } catch (error) {
    next(error);
  }
});

router.get('/routes/:routeId/paper-bid-sheet.docx', async (req, res, next) => {
  try {
    const routeId = String(req.params.routeId || '').trim();
    const result = await loadPaperBidSheetForRoute(routeId);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    if (!result.sheet.paper_bid_start_date) {
      res.status(400).json({
        error:
          'Set a route start date before exporting the paper sign-up sheet.',
      });
      return;
    }
    const buffer = await buildPaperBidSheetDocxBuffer(result.sheet);
    const filename = paperBidSheetDocxFilename(routeId);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
});

router.put('/routes/:routeId/paper-bid-start-date', async (req, res, next) => {
  try {
    const routeId = String(req.params.routeId || '').trim();
    const raw = req.body?.paper_bid_start_date;
    const startDate =
      raw == null || String(raw).trim() === ''
        ? null
        : String(raw).trim();
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      res.status(400).json({
        error: 'paper_bid_start_date must be YYYY-MM-DD or empty.',
      });
      return;
    }
    const [appSettings, state] = await Promise.all([
      readAppSettings(dataDir()),
      readRouteState(dataDir()),
    ]);
    if (!appSettings.paper_bid_signup_enabled) {
      res.status(400).json({ error: 'Paper bid sign-up is off.' });
      return;
    }
    const entry = state[routeId];
    if (!entry || entry.status !== 'BID_PENDING') {
      res.status(400).json({
        error: 'Route must be BID_PENDING to set a paper sign-up start date.',
      });
      return;
    }
    state[routeId] = {
      ...entry,
      paper_bid_start_date: startDate,
    };
    await writeRouteState(state, dataDir());
    res.json({
      route_id: routeId,
      paper_bid_start_date: startDate,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/routes/:routeId/segment-time', async (req, res, next) => {
  try {
    const segment = String(req.query.segment || '').toUpperCase();
    if (!SEGMENTS.includes(segment)) {
      res.status(400).json({ error: `segment must be one of: ${SEGMENTS.join(', ')}` });
      return;
    }
    const state = await readRouteState(dataDir());
    const previous_time = getCurrentSegmentTime(
      state,
      req.params.routeId,
      /** @type {'AM'|'MIDDAY'|'PM'} */ (segment)
    );
    const route = state[req.params.routeId] ?? null;
    res.json({
      route_id: req.params.routeId,
      segment,
      previous_time,
      driver_name: route?.driver_name ?? null,
      driver_id: route?.driver_id ?? null,
      status: route?.status ?? null,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/changes/recent', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const [log, routeState] = await Promise.all([
      readChangeLog(dataDir()),
      readRouteState(dataDir()),
    ]);

    const changes = log
      .filter(isChangeEvent)
      .slice()
      .reverse()
      .slice(0, limit)
      .map((entry) => {
        const change = /** @type {import('../logic/stateMachine.js').ChangeEvent} */ (
          entry
        );
        const route = routeState[change.route_id];
        return {
          ...change,
          route_status: route?.status ?? null,
          pending: route?.pending_change_ids?.includes(change.id) ?? false,
        };
      });

    res.json(changes);
  } catch (error) {
    next(error);
  }
});

router.post('/changes', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const [reasons, staffNames, reasonCategories, state, drivers] = await Promise.all([
      readAdjustmentReasons(dataDir()),
      readStaffNames(dataDir()),
      readReasonCategories(dataDir()),
      readRouteState(dataDir()),
      readDrivers(dataDir()),
    ]);

    const routeId = String(body.route_id || '').trim();
    const createNewRoute = body.create_new_route === true;
    const createNewDriver = body.create_new_driver === true;
    const routeExists = Object.prototype.hasOwnProperty.call(state, routeId);

    if (!routeId) {
      res.status(400).json({ error: 'route_id is required.' });
      return;
    }

    if (!createNewRoute && !routeExists) {
      res.status(400).json({
        error: `Unknown route "${routeId}". Select an existing route, or submit with create_new_route=true.`,
      });
      return;
    }

    if (createNewRoute && routeExists) {
      res.status(400).json({
        error: `Route "${routeId}" already exists. Select it from the existing-route list instead of creating new.`,
      });
      return;
    }

    let driverId = String(body.driver_id || '').trim() || null;
    let driverName = String(body.driver_name || '').trim();

    if (createNewDriver) {
      if (!driverName) {
        res.status(400).json({ error: 'driver_name is required when creating a new driver.' });
        return;
      }
      let created;
      try {
        created = await createDriver(
          {
            name: driverName,
            email: body.driver_email ?? null,
            hire_date: body.hire_date,
            tie_break: null,
          },
          dataDir()
        );
      } catch (error) {
        res.status(400).json({
          error: /** @type {Error} */ (error).message,
        });
        return;
      }
      driverId = created.driver_id;
      driverName = created.name;
    } else if (driverId) {
      const known = drivers.find((d) => d.driver_id === driverId);
      if (!known) {
        res.status(400).json({
          error: `Unknown driver_id "${driverId}". Select an existing driver, or submit with create_new_driver=true.`,
        });
        return;
      }
      driverName = known.name;
    } else if (driverName) {
      const known = drivers.find(
        (d) => d.name.toLowerCase() === driverName.toLowerCase()
      );
      if (!known) {
        res.status(400).json({
          error: `Unknown driver "${driverName}". Select an existing driver, or add them under Drivers/Routes.`,
        });
        return;
      }
      driverId = known.driver_id;
      driverName = known.name;
    } else if (state[routeId]?.driver_name) {
      driverName = state[routeId].driver_name;
      driverId = state[routeId].driver_id ?? null;
      if (!driverId) {
        const known = drivers.find(
          (d) => d.name.toLowerCase() === driverName.toLowerCase()
        );
        driverId = known?.driver_id ?? null;
      }
    }

    // New routes may be created Unassigned; existing changes still need a driver
    // (from the form or the route's current assignment above).
    if (!driverName && !createNewRoute) {
      res.status(400).json({ error: 'Select a driver from the directory, or add a new one.' });
      return;
    }

    const segment = String(body.segment || '').toUpperCase();
    const knownPrevious = getCurrentSegmentTime(state, routeId, segment);
    const previousTime = String(body.previous_time || knownPrevious || '').trim();
    // Creating a route seeds the segment — there is no prior→new change.
    const newTime = createNewRoute
      ? previousTime
      : String(body.new_time || '').trim();

    let computedDelta;
    try {
      if (createNewRoute) {
        computeDeltaMinutes(previousTime, previousTime); // validate format
        computedDelta = 0;
      } else {
        computedDelta = computeDeltaMinutes(previousTime, newTime);
      }
    } catch (error) {
      res.status(400).json({ error: /** @type {Error} */ (error).message });
      return;
    }

    const deltaOverride =
      createNewRoute ||
      body.delta_minutes === undefined ||
      body.delta_minutes === null ||
      body.delta_minutes === ''
        ? null
        : Number(body.delta_minutes);

    const deltaMinutes =
      createNewRoute || deltaOverride === null || Number.isNaN(deltaOverride)
        ? computedDelta
        : deltaOverride;

    const wasAdjusted = !createNewRoute && deltaMinutes !== computedDelta;
    const enteredBy = String(body.entered_by || '').trim();

    /** @type {import('../logic/stateMachine.js').ChangeEvent} */
    const event = {
      route_id: routeId,
      driver_name: driverName || '',
      driver_id: driverId,
      segment: /** @type {'AM'|'MIDDAY'|'PM'} */ (segment),
      submitted_at: getAsOfTimestamp(),
      effective_date: String(body.effective_date || '').trim(),
      previous_time: previousTime,
      new_time: newTime,
      computed_delta_minutes: computedDelta,
      delta_minutes: deltaMinutes,
      routing_adjustment: wasAdjusted
        ? {
            reason: String(body.adjustment_reason || '').trim(),
            adjusted_by: enteredBy,
            adjusted_at: getAsOfTimestamp(),
          }
        : null,
      reason_category: String(body.reason_category || '').trim(),
      note: String(body.note || ''),
      entered_by: enteredBy,
    };

    const errors = validateChangeEvent(event, reasons, staffNames);
    if (!reasonCategories.length) {
      errors.push(
        'No reason categories configured. Add categories in Admin settings before submitting.'
      );
    } else if (!reasonCategories.includes(event.reason_category)) {
      errors.push(
        `reason_category must be one of: ${reasonCategories.join(', ')}`
      );
    }
    if (errors.length) {
      res.status(400).json({ error: errors.join(' ') });
      return;
    }

    const saved = await appendChangeEvent(event, dataDir());
    const routeState = await rebuildAndPersistRouteState(dataDir());
    const route = routeState[saved.route_id] ?? null;

    res.status(201).json({
      change: saved,
      route_status: route?.status ?? null,
      pending: route?.pending_change_ids?.includes(saved.id) ?? false,
      message: route?.pending_change_ids?.includes(saved.id)
        ? 'Change logged. This route is under review — the change is held until Admin resolves NEEDS_REVIEW.'
        : createNewRoute
          ? 'New route created and first change logged successfully.'
          : 'Change logged successfully.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/adjustments', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const [reasons, staffNames, log] = await Promise.all([
      readAdjustmentReasons(dataDir()),
      readStaffNames(dataDir()),
      readChangeLog(dataDir()),
    ]);

    const targetId = String(body.target_change_id || '').trim();
    const target = log.find(
      (entry) => isChangeEvent(entry) && entry.id === targetId
    );
    if (!target) {
      res.status(404).json({ error: `ChangeEvent not found: ${targetId}` });
      return;
    }

    const effectiveDeltas = resolveEffectiveDeltas(log);
    const previousDelta = effectiveDeltas.has(targetId)
      ? effectiveDeltas.get(targetId)
      : /** @type {import('../logic/stateMachine.js').ChangeEvent} */ (target)
          .delta_minutes;

    /** @type {import('../logic/stateMachine.js').AdjustmentEvent} */
    const event = {
      type: 'ADJUSTMENT',
      target_change_id: targetId,
      previous_delta: previousDelta,
      new_delta: Number(body.new_delta),
      reason: String(body.reason || '').trim(),
      note: String(body.note || ''),
      adjusted_by: String(body.adjusted_by || '').trim(),
      adjusted_at: getAsOfTimestamp(),
    };

    const errors = validateAdjustmentEvent(event, reasons, staffNames);
    if (errors.length) {
      res.status(400).json({ error: errors.join(' ') });
      return;
    }

    const saved = await appendAdjustmentEvent(event, dataDir());
    const routeState = await rebuildAndPersistRouteState(dataDir());
    const routeId = /** @type {import('../logic/stateMachine.js').ChangeEvent} */ (
      target
    ).route_id;

    res.status(201).json({
      adjustment: saved,
      route_id: routeId,
      route: routeState[routeId] ?? null,
      message: 'Adjustment logged successfully.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/routes/:routeId/reassign', async (req, res, next) => {
  try {
    const routeId = String(req.params.routeId || '').trim();
    const body = req.body ?? {};
    const [staffNames, drivers, state] = await Promise.all([
      readStaffNames(dataDir()),
      readDrivers(dataDir()),
      readRouteState(dataDir()),
    ]);

    const route = state[routeId];
    if (!route) {
      res.status(404).json({ error: `Route not found: ${routeId}` });
      return;
    }

    const newDriverIdRaw =
      body.new_driver_id === undefined || body.new_driver_id === null
        ? null
        : String(body.new_driver_id).trim() || null;
    const unassigned = body.unassigned === true || !newDriverIdRaw;

    let newDriverId = null;
    let newDriverName = null;

    if (!unassigned) {
      newDriverId = newDriverIdRaw;
      const known = drivers.find((d) => d.driver_id === newDriverId);
      if (!known) {
        res.status(400).json({
          error: `Unknown driver_id "${newDriverId}". Pick a driver from the directory, or choose Unassigned.`,
        });
        return;
      }
      newDriverName = known.name;
    }

    const previousDriverId = route.driver_id ?? null;
    const previousDriverName = route.driver_name?.trim() || null;

    const sameAssignment =
      previousDriverId === newDriverId &&
      (previousDriverName || null) === (newDriverName || null);
    if (sameAssignment) {
      res.status(400).json({
        error: newDriverId
          ? 'Route is already assigned to that driver.'
          : 'Route is already unassigned.',
      });
      return;
    }

    /** @type {import('../logic/stateMachine.js').ReassignmentEvent} */
    const event = {
      type: 'REASSIGNMENT',
      route_id: routeId,
      previous_driver_id: previousDriverId,
      previous_driver_name: previousDriverName,
      new_driver_id: newDriverId,
      new_driver_name: newDriverName,
      note: String(body.note || ''),
      resolution:
        body.resolution === 'bid_awarded' ? 'bid_awarded' : 'routine',
      reassigned_by: String(body.reassigned_by || '').trim(),
      reassigned_at: getAsOfTimestamp(),
    };

    if (
      event.resolution === 'bid_awarded' &&
      route.status !== 'BID_PENDING'
    ) {
      res.status(400).json({
        error:
          'resolution "bid_awarded" is only valid while the route is BID_PENDING.',
      });
      return;
    }

    const appSettings = await readAppSettings(dataDir());
    if (
      event.resolution === 'bid_awarded' &&
      appSettings.electronic_bid_signup_enabled
    ) {
      const signup = route.bid_signup;
      if (!signup?.finalized_at || !Array.isArray(signup.eligible_responders)) {
        res.status(400).json({
          error:
            'Electronic bid sign-up is on — wait until the 2-school-day sign-up window closes and the eligible list is finalized before awarding.',
        });
        return;
      }
      if (!newDriverId) {
        res.status(400).json({
          error:
            'Bid award requires selecting a driver from the finalized eligible sign-up list.',
        });
        return;
      }
      const eligible = signup.eligible_responders.some(
        (r) => r.driver_id === newDriverId
      );
      if (!eligible) {
        res.status(400).json({
          error:
            'That driver did not initial in time (or is not on the finalized eligible list). Award only from the Forms sign-up record.',
        });
        return;
      }
    }

    const errors = validateReassignmentEvent(event, staffNames);
    if (errors.length) {
      res.status(400).json({ error: errors.join(' ') });
      return;
    }

    const priorState = state;
    const saved = await appendReassignmentEvent(event, dataDir());
    const routeState = await rebuildAndPersistRouteState(dataDir());
    const next = routeState[routeId] ?? null;

    const newDriver = newDriverId
      ? drivers.find((d) => d.driver_id === newDriverId)
      : null;
    const notificationSpecs = [
      buildReassignmentNotificationSpec({
        route_id: routeId,
        resolution: event.resolution ?? 'routine',
        reassignment_id: saved.id,
        new_driver_name: newDriverName,
        new_driver_email: newDriver?.email?.trim() || null,
        previous_driver_name: previousDriverName,
      }),
    ];
    if (event.resolution === 'bid_awarded') {
      const payrollSpec = buildBidAwardPayrollSpec({
        route_id: routeId,
        reassignment_id: saved.id,
        priorState,
        nextState: routeState,
        new_driver_id: newDriverId,
        new_driver_name: newDriverName,
        new_driver_email: newDriver?.email?.trim() || null,
      });
      if (payrollSpec) notificationSpecs.push(payrollSpec);
    }
    await enqueueNotifications(notificationSpecs, dataDir());

    res.status(201).json({
      reassignment: saved,
      route_id: routeId,
      route: next,
      message: newDriverId
        ? event.resolution === 'bid_awarded'
          ? `Bid awarded to ${newDriverName}.`
          : `Route reassigned to ${newDriverName}.`
        : 'Route set to Unassigned.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Admin resolve for an open NEEDS_REVIEW.
 * Appends NEEDS_REVIEW_RESOLUTION then rebuilds so keep_prior / accept_computed
 * stick across future rebuilds for that specific discrepancy only.
 * body: { resolution, note, resolved_by }
 * accept_computed + letter_or_action_exists → contradiction notification.
 */
router.post('/routes/:routeId/resolve-review', async (req, res, next) => {
  try {
    const routeId = String(req.params.routeId || '').trim();
    const resolution = String(req.body?.resolution || '').trim();
    const note = String(req.body?.note || '').trim();
    const resolvedBy = String(req.body?.resolved_by || '').trim();
    if (resolution !== 'accept_computed' && resolution !== 'keep_prior') {
      res.status(400).json({
        error: 'resolution must be "accept_computed" or "keep_prior".',
      });
      return;
    }

    const [state, staffNames, drivers] = await Promise.all([
      readRouteState(dataDir()),
      readStaffNames(dataDir()),
      readDrivers(dataDir()),
    ]);

    const route = state[routeId];
    if (!route) {
      res.status(404).json({ error: `Route not found: ${routeId}` });
      return;
    }
    if (route.status !== 'NEEDS_REVIEW' || !route.reconciliation) {
      res.status(400).json({
        error: 'Route is not in an open NEEDS_REVIEW state.',
      });
      return;
    }

    const letterExists = route.reconciliation.letter_or_action_exists === true;
    /** @type {import('../logic/stateMachine.js').NeedsReviewResolutionEvent} */
    const event = {
      type: 'NEEDS_REVIEW_RESOLUTION',
      route_id: routeId,
      resolution,
      causing_adjustment_id:
        route.reconciliation.causing_adjustment_id ?? null,
      previous_finalized_status:
        route.reconciliation.previous_finalized_status,
      computed_status: route.reconciliation.computed_status,
      note,
      resolved_by: resolvedBy,
      resolved_at: getAsOfTimestamp(),
    };

    const errors = validateNeedsReviewResolutionEvent(event, staffNames);
    if (errors.length) {
      res.status(400).json({ error: errors.join(' ') });
      return;
    }

    const saved = await appendNeedsReviewResolutionEvent(event, dataDir());
    const rebuilt = await rebuildAndPersistRouteState(dataDir());
    const next = rebuilt[routeId] ?? null;

    if (resolution === 'accept_computed' && letterExists) {
      const driver =
        (next?.driver_id &&
          drivers.find((d) => d.driver_id === next.driver_id)) ||
        null;
      await enqueueNotifications(
        [
          buildNeedsReviewContradictionSpec({
            route_id: routeId,
            resolve_id: saved.id,
            driver_name:
              driver?.name?.trim() || next?.driver_name?.trim() || null,
            driver_email: driver?.email?.trim() || null,
          }),
        ],
        dataDir()
      );
    }

    res.json({
      route_id: routeId,
      route: next,
      resolution,
      resolution_event: saved,
      contradicted_letter: resolution === 'accept_computed' && letterExists,
      message:
        resolution === 'accept_computed'
          ? letterExists
            ? 'Accepted computed status. A prior letter may need a correction notice.'
            : 'Accepted computed status.'
          : 'Kept prior finalized status.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Eligible bump targets: drivers junior to the electing driver who currently hold a route.
 */
router.get('/routes/:routeId/bump-targets', async (req, res, next) => {
  try {
    const routeId = String(req.params.routeId || '').trim();
    const [drivers, state] = await Promise.all([
      readDrivers(dataDir()),
      readRouteState(dataDir()),
    ]);
    const route = state[routeId];
    if (!route) {
      res.status(404).json({ error: `Route not found: ${routeId}` });
      return;
    }
    if (route.status !== 'BUMP_ELIGIBLE') {
      res.status(400).json({
        error: 'Bump targets are only listed while the route is BUMP_ELIGIBLE.',
      });
      return;
    }
    const electingId = route.driver_id;
    if (!electingId) {
      res.json({ targets: [] });
      return;
    }
    res.json({
      electing_driver_id: electingId,
      electing_driver_name: route.driver_name,
      bump_kind: route.bump_kind ?? 'original_decrease',
      bump_chain_id: route.bump_chain_id ?? null,
      bump_chain_link: route.bump_chain_link ?? 1,
      targets: listBumpTargets({
        electing_driver_id: electingId,
        electing_route_id: routeId,
        drivers,
        routeState: state,
      }),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Admin bump decision — keep / elect bump / accept unassigned. Never auto-applied.
 */
router.post('/routes/:routeId/bump-decision', async (req, res, next) => {
  try {
    const routeId = String(req.params.routeId || '').trim();
    const body = req.body ?? {};
    const [staffNames, drivers, state, schoolCalendar] = await Promise.all([
      readStaffNames(dataDir()),
      readDrivers(dataDir()),
      readRouteState(dataDir()),
      readSchoolCalendar(dataDir()),
    ]);
    void schoolCalendar;

    const route = state[routeId];
    if (!route) {
      res.status(404).json({ error: `Route not found: ${routeId}` });
      return;
    }
    if (route.status !== 'BUMP_ELIGIBLE') {
      res.status(400).json({
        error: 'Bump decisions are only valid while the route is BUMP_ELIGIBLE.',
      });
      return;
    }

    const bump_kind = route.bump_kind ?? 'original_decrease';
    const decision = String(body.decision || '').trim();
    const decided_at = getAsOfTimestamp();
    const electing_driver_id = route.driver_id ?? null;
    const electing_driver_name = route.driver_name?.trim() || null;

    /** @type {Omit<import('../logic/stateMachine.js').BumpDecisionEvent, 'id'> & { id?: string }} */
    const event = {
      type: 'BUMP_DECISION',
      route_id: routeId,
      decision: /** @type {'keep_assignment' | 'elect_bump' | 'accept_unassigned'} */ (
        decision
      ),
      bump_kind,
      bump_chain_id: route.bump_chain_id || randomUUID(),
      bump_chain_link: route.bump_chain_link ?? 1,
      electing_driver_id,
      electing_driver_name,
      target_route_id: null,
      target_driver_id: null,
      target_driver_name: null,
      note: String(body.note || ''),
      decided_by: String(body.decided_by || '').trim(),
      decided_at,
    };

    if (decision === 'elect_bump') {
      const targetRouteId = String(body.target_route_id || '').trim();
      const targetDriverId = String(body.target_driver_id || '').trim();
      const targetRoute = state[targetRouteId];
      if (!targetRoute) {
        res.status(400).json({ error: `Unknown target route: ${targetRouteId}` });
        return;
      }
      if (targetRoute.driver_id !== targetDriverId) {
        res.status(400).json({
          error:
            'target_driver_id does not currently hold the selected target route.',
        });
        return;
      }
      const elector = drivers.find((d) => d.driver_id === electing_driver_id);
      const targetDriver = drivers.find((d) => d.driver_id === targetDriverId);
      if (!elector || !targetDriver || !isStrictlyJuniorDriver(elector, targetDriver)) {
        res.status(400).json({
          error:
            'Bump target must be a driver with less seniority (later hire date) than the electing driver.',
        });
        return;
      }
      event.target_route_id = targetRouteId;
      event.target_driver_id = targetDriverId;
      event.target_driver_name = targetDriver.name;
    }

    const errors = validateBumpDecisionEvent(event, staffNames);
    if (errors.length) {
      res.status(400).json({ error: errors.join(' ') });
      return;
    }

    const saved = await appendBumpDecisionEvent(event, dataDir());

    if (decision === 'elect_bump') {
      const targetRouteId = event.target_route_id;
      const targetRoute = state[targetRouteId];
      // Claim target route for the electing driver.
      await appendReassignmentEvent(
        {
          route_id: targetRouteId,
          previous_driver_id: targetRoute.driver_id ?? null,
          previous_driver_name: targetRoute.driver_name?.trim() || null,
          new_driver_id: electing_driver_id,
          new_driver_name: electing_driver_name,
          note: `Bump elect (chain ${event.bump_chain_id}, link ${event.bump_chain_link}): ${event.note}`,
          resolution: 'routine',
          reassigned_by: event.decided_by,
          reassigned_at: decided_at,
        },
        dataDir()
      );
      // Park displaced driver on the vacated electing route — no auto-Unassigned.
      await appendReassignmentEvent(
        {
          route_id: routeId,
          previous_driver_id: electing_driver_id,
          previous_driver_name: electing_driver_name,
          new_driver_id: event.target_driver_id,
          new_driver_name: event.target_driver_name,
          note: `Bump displacement park (chain ${event.bump_chain_id}, link ${event.bump_chain_link + 1}): ${event.note}`,
          resolution: 'routine',
          reassigned_by: event.decided_by,
          reassigned_at: decided_at,
        },
        dataDir()
      );
    } else if (decision === 'accept_unassigned') {
      await appendReassignmentEvent(
        {
          route_id: routeId,
          previous_driver_id: electing_driver_id,
          previous_driver_name: electing_driver_name,
          new_driver_id: null,
          new_driver_name: null,
          note: `Bump accept Unassigned (chain ${event.bump_chain_id}, link ${event.bump_chain_link}): ${event.note}`,
          resolution: 'routine',
          reassigned_by: event.decided_by,
          reassigned_at: decided_at,
        },
        dataDir()
      );
    }

    const priorState = state;
    const rebuilt = await rebuildAndPersistRouteState(dataDir());
    const next = rebuilt[routeId] ?? null;

    const driversById = new Map(
      drivers.map((d) => [d.driver_id, { name: d.name, email: d.email }])
    );
    const payrollSpecs = collectBumpDecisionPayrollSpecs({
      decision: /** @type {'keep_assignment' | 'elect_bump' | 'accept_unassigned'} */ (
        decision
      ),
      decision_id: saved.id,
      route_id: routeId,
      target_route_id: event.target_route_id,
      priorState,
      nextState: rebuilt,
      driversById,
    });
    if (payrollSpecs.length) {
      await enqueueNotifications(payrollSpecs, dataDir());
    }

    let message = 'Bump decision recorded.';
    if (decision === 'keep_assignment') {
      message = 'Kept current assignment — decreased hours locked in (STABLE).';
    } else if (decision === 'accept_unassigned') {
      message = 'Accepted Unassigned for this displacement — route cleared to STABLE.';
    } else if (decision === 'elect_bump') {
      message =
        `Elected bump onto ${event.target_route_id}. Displaced driver is parked on ${routeId} for the next chain decision — nothing further is automatic.`;
    }

    res.status(201).json({
      route_id: routeId,
      route: next,
      decision: saved,
      message,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/workbook/status', async (_req, res, next) => {
  try {
    const [reconciliation, sync_status] = await Promise.all([
      readWorkbookReconciliation(dataDir()),
      readWorkbookSyncStatus(dataDir()),
    ]);
    res.json({
      workbook_path: getWorkbookPath(),
      app_data_dir: getAppDataDir(),
      shared_root: getSharedRoot(),
      sync_status,
      reconciliation:
        reconciliation?.status === 'PENDING' ? reconciliation : null,
      last_reconciliation:
        reconciliation && reconciliation.status !== 'PENDING'
          ? reconciliation
          : null,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/workbook/sync', async (_req, res, next) => {
  try {
    const result = await syncWorkbook({ appDataDir: dataDir() });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/workbook/discard', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const resolvedBy = String(body.resolved_by || '').trim();
    const note = String(body.note || '').trim();
    const staffNames = await readStaffNames(dataDir());
    if (!resolvedBy) {
      res.status(400).json({ error: 'resolved_by is required.' });
      return;
    }
    if (staffNames.length && !staffNames.includes(resolvedBy)) {
      res.status(400).json({
        error: 'resolved_by must be one of the configured staff names.',
      });
      return;
    }
    if (!note) {
      res.status(400).json({ error: 'note is required.' });
      return;
    }
    const result = await discardWorkbookEdits({
      resolved_by: resolvedBy,
      note,
      appDataDir: dataDir(),
    });
    if (result.status === 'save_failed') {
      res.status(409).json({
        ...result,
        error:
          result.error ||
          'Could not regenerate workbook (file may be open in Excel). Close it and try again — or wait for the next automatic retry.',
      });
      return;
    }
    res.json({
      ...result,
      message:
        'External workbook edits discarded. RouteChangeTracker.xlsx regenerated from _app_data/.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Pull a Change Log delta correction from the edited workbook into _app_data
 * as a proper attributed ADJUSTMENT, then attempt workbook sync again.
 *
 * Only Change Log `exact_delta_minutes` edits are importable. Routes / Drivers /
 * Change Reports are computed output — edits there must be discarded, never
 * imported as truth (that would bypass the state machine).
 */
router.post('/workbook/import-adjustment', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const [reasons, staffNames, log, reconciliation] = await Promise.all([
      readAdjustmentReasons(dataDir()),
      readStaffNames(dataDir()),
      readChangeLog(dataDir()),
      readWorkbookReconciliation(dataDir()),
    ]);

    if (reconciliation?.status !== 'PENDING') {
      res.status(400).json({
        error: 'No pending workbook reconciliation to import from.',
      });
      return;
    }

    const targetId = String(body.target_change_id || '').trim();
    const target = log.find(
      (entry) => isChangeEvent(entry) && entry.id === targetId
    );
    if (!target) {
      res.status(404).json({ error: `ChangeEvent not found: ${targetId}` });
      return;
    }

    const changeDiffs =
      reconciliation.diff?.change_log?.changes?.filter(
        (change) => change.key === targetId && change.kind === 'modified'
      ) ?? [];
    const deltaField = changeDiffs[0]?.fields?.find(
      (field) => field.field === 'exact_delta_minutes'
    );

    if (!deltaField) {
      res.status(400).json({
        error:
          'Only Change Log exact_delta_minutes edits can be imported as ADJUSTMENTs. ' +
          'Edits on Routes, Drivers, or Change Reports are computed output — discard them instead.',
      });
      return;
    }

    const fileDelta = Number(deltaField.file);
    if (Number.isNaN(fileDelta)) {
      res.status(400).json({
        error: 'Workbook Change Log exact_delta_minutes is not a number.',
      });
      return;
    }

    if (
      body.new_delta !== undefined &&
      body.new_delta !== null &&
      body.new_delta !== '' &&
      Number(body.new_delta) !== fileDelta
    ) {
      res.status(400).json({
        error:
          'new_delta must match the edited Change Log exact_delta_minutes value from the workbook diff.',
      });
      return;
    }

    const newDelta = fileDelta;

    const effectiveDeltas = resolveEffectiveDeltas(log);
    const previousDelta = effectiveDeltas.has(targetId)
      ? effectiveDeltas.get(targetId)
      : /** @type {import('../logic/stateMachine.js').ChangeEvent} */ (target)
          .delta_minutes;

    /** @type {import('../logic/stateMachine.js').AdjustmentEvent} */
    const event = {
      type: 'ADJUSTMENT',
      target_change_id: targetId,
      previous_delta: previousDelta,
      new_delta: newDelta,
      reason: String(body.reason || 'Other').trim(),
      note: String(body.note || '').trim(),
      adjusted_by: String(body.adjusted_by || '').trim(),
      adjusted_at: getAsOfTimestamp(),
    };

    const errors = validateAdjustmentEvent(event, reasons, staffNames);
    if (errors.length) {
      res.status(400).json({ error: errors.join(' ') });
      return;
    }

    const saved = await appendAdjustmentEvent(event, dataDir());
    const routeState = await rebuildAndPersistRouteState(dataDir());
    const routeId = /** @type {import('../logic/stateMachine.js').ChangeEvent} */ (
      target
    ).route_id;
    const workbook = await syncWorkbook({ appDataDir: dataDir() });

    res.status(201).json({
      adjustment: saved,
      route_id: routeId,
      route: routeState[routeId] ?? null,
      workbook,
      message:
        workbook.status === 'wrote'
          ? 'Adjustment imported from Change Log edit; workbook regenerated.'
          : workbook.status === 'save_failed'
            ? 'Adjustment imported into _app_data, but workbook could not be saved (file may be open). It will retry on the next change.'
            : 'Adjustment imported. Workbook still differs — review remaining diffs.',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
