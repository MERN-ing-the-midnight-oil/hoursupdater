import { Router } from 'express';
import {
  REASON_CATEGORIES,
  SEGMENTS,
  getAppDataDir,
  getDataDir,
  getSharedRoot,
  getWorkbookPath,
} from '../config.js';
import {
  appendAdjustmentEvent,
  appendChangeEvent,
  appendReassignmentEvent,
  createDriver,
  findDriverById,
  findDriverByName,
  getCurrentSegmentTime,
  readAdjustmentReasons,
  readChangeLog,
  readDrivers,
  readPayrollSettings,
  readRouteState,
  readSchoolCalendar,
  readStaffNames,
  readWorkbookReconciliation,
  readWorkbookSyncStatus,
  updateDriver,
  writeAdjustmentReasons,
  writeDrivers,
  writePayrollSettings,
  writeRouteState,
  writeSchoolCalendar,
  writeStaffNames,
} from '../data/storage.js';
import {
  buildDriverEmailDraft,
  buildPayrollEmailDraft,
} from '../logic/changeReport.js';
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
  validateReassignmentEvent,
} from '../logic/stateMachine.js';
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

router.get('/meta', (_req, res) => {
  res.json({
    segments: SEGMENTS,
    reason_categories: REASON_CATEGORIES,
  });
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
      },
      dataDir()
    );
    await syncWorkbook({ appDataDir: dataDir() }).catch(() => null);
    res.status(201).json(driver);
  } catch (error) {
    const message = /** @type {Error} */ (error).message;
    if (
      message.includes('already exists') ||
      message.includes('required')
    ) {
      res.status(400).json({ error: message });
      return;
    }
    next(error);
  }
});

router.put('/drivers/:driverId', async (req, res, next) => {
  try {
    const driver = await updateDriver(
      req.params.driverId,
      {
        name: req.body?.name,
        email: req.body?.email,
      },
      dataDir()
    );
    await syncWorkbook({ appDataDir: dataDir() }).catch(() => null);
    res.json(driver);
  } catch (error) {
    const message = /** @type {Error} */ (error).message;
    if (message.startsWith('Driver not found')) {
      res.status(404).json({ error: message });
      return;
    }
    if (message.includes('required')) {
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
      if (report.outcome !== 'BID_PENDING') {
        res.status(400).json({
          error: 'Notify Payroll is only available for BID_PENDING Change Reports.',
        });
        return;
      }

      const settings = await readPayrollSettings(dataDir());

      // Prefer live route assignment; fall back to whoever was on the report.
      const liveDriverId = entry.driver_id ?? report.driver_id ?? null;
      const liveDriverName =
        entry.driver_name?.trim() || report.driver_name?.trim() || null;

      let driver = liveDriverId
        ? await findDriverById(liveDriverId, dataDir())
        : null;
      if (!driver && liveDriverName) {
        driver = await findDriverByName(liveDriverName, dataDir());
      }

      const draft = buildPayrollEmailDraft(report, settings, {
        name: driver?.name || liveDriverName,
        email: driver?.email ?? null,
      });

      res.json({
        report_id: report.id,
        route_id: req.params.routeId,
        payroll_email: settings.payroll_email,
        payroll_notified_at: report.payroll_notified_at ?? null,
        ...draft,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/routes/:routeId/change-reports/:reportId/payroll-notified',
  async (req, res, next) => {
    try {
      const state = await readRouteState(dataDir());
      const entry = state[req.params.routeId];
      if (!entry) {
        res.status(404).json({ error: `Route not found: ${req.params.routeId}` });
        return;
      }

      const reports = entry.change_reports ?? [];
      const index = reports.findIndex(
        (item) => item.id === req.params.reportId
      );
      if (index < 0) {
        res.status(404).json({
          error: `Change report not found: ${req.params.reportId}`,
        });
        return;
      }

      const report = reports[index];
      if (report.outcome !== 'BID_PENDING') {
        res.status(400).json({
          error: 'Notify Payroll is only available for BID_PENDING Change Reports.',
        });
        return;
      }

      const payroll_notified_at = new Date().toISOString();
      const updatedReport = { ...report, payroll_notified_at };
      const updatedReports = [...reports];
      updatedReports[index] = updatedReport;
      state[req.params.routeId] = {
        ...entry,
        change_reports: updatedReports,
      };
      await writeRouteState(state, dataDir());

      res.json({
        report_id: updatedReport.id,
        route_id: req.params.routeId,
        payroll_notified_at,
      });
    } catch (error) {
      next(error);
    }
  }
);

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
    const [reasons, staffNames, state, drivers] = await Promise.all([
      readAdjustmentReasons(dataDir()),
      readStaffNames(dataDir()),
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
      const created = await createDriver(
        {
          name: driverName,
          email: body.driver_email ?? null,
        },
        dataDir()
      );
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
          error: `Unknown driver "${driverName}". Select an existing driver, or use “Add new driver”.`,
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

    if (!driverName) {
      res.status(400).json({ error: 'Select a driver from the directory, or add a new one.' });
      return;
    }

    const segment = String(body.segment || '').toUpperCase();
    const knownPrevious = getCurrentSegmentTime(state, routeId, segment);
    const previousTime = String(body.previous_time || knownPrevious || '').trim();
    const newTime = String(body.new_time || '').trim();

    let computedDelta;
    try {
      computedDelta = computeDeltaMinutes(previousTime, newTime);
    } catch (error) {
      res.status(400).json({ error: /** @type {Error} */ (error).message });
      return;
    }

    const deltaOverride =
      body.delta_minutes === undefined || body.delta_minutes === null || body.delta_minutes === ''
        ? null
        : Number(body.delta_minutes);

    const deltaMinutes =
      deltaOverride === null || Number.isNaN(deltaOverride)
        ? computedDelta
        : deltaOverride;

    const wasAdjusted = deltaMinutes !== computedDelta;
    const enteredBy = String(body.entered_by || '').trim();

    /** @type {import('../logic/stateMachine.js').ChangeEvent} */
    const event = {
      route_id: routeId,
      driver_name: driverName,
      driver_id: driverId,
      segment: /** @type {'AM'|'MIDDAY'|'PM'} */ (segment),
      submitted_at: new Date().toISOString(),
      effective_date: String(body.effective_date || '').trim(),
      previous_time: previousTime,
      new_time: newTime,
      computed_delta_minutes: computedDelta,
      delta_minutes: deltaMinutes,
      routing_adjustment: wasAdjusted
        ? {
            reason: String(body.adjustment_reason || '').trim(),
            adjusted_by: enteredBy,
            adjusted_at: new Date().toISOString(),
          }
        : null,
      reason_category: /** @type {'MV'|'SPED'|'OTHER'} */ (
        String(body.reason_category || '').toUpperCase()
      ),
      note: String(body.note || ''),
      entered_by: enteredBy,
    };

    const errors = validateChangeEvent(event, reasons, staffNames);
    if (!REASON_CATEGORIES.includes(event.reason_category)) {
      errors.push(`reason_category must be one of: ${REASON_CATEGORIES.join(', ')}`);
    }
    if (createNewRoute && !event.note?.trim()) {
      errors.push('note is required when creating a new route.');
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
      adjusted_at: new Date().toISOString(),
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
      reassigned_by: String(body.reassigned_by || '').trim(),
      reassigned_at: new Date().toISOString(),
    };

    const errors = validateReassignmentEvent(event, staffNames);
    if (errors.length) {
      res.status(400).json({ error: errors.join(' ') });
      return;
    }

    const saved = await appendReassignmentEvent(event, dataDir());
    const routeState = await rebuildAndPersistRouteState(dataDir());
    const next = routeState[routeId] ?? null;

    res.status(201).json({
      reassignment: saved,
      route_id: routeId,
      route: next,
      message: newDriverId
        ? `Route reassigned to ${newDriverName}.`
        : 'Route set to Unassigned.',
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
      adjusted_at: new Date().toISOString(),
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
