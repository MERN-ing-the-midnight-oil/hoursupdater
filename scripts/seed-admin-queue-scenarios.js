#!/usr/bin/env node
/**
 * Force-seed Admin queue demo scenarios into DATA_DIR/_app_data.
 * Overwrites change-log.json + route-state.json (and refreshes drivers/letters).
 *
 * Scenarios:
 *   S 20  ACCUMULATING   (+5 open window in July placeholder school days)
 *   S 30  BID_PENDING    (+35 finalized past window)
 *   S 40  NEEDS_REVIEW   (finalized flip + queued pending change)
 *   S 50  BID_PENDING    (self-resolved NEEDS_REVIEW history still visible)
 *   S 11  STABLE         (clean — for Stable section)
 *
 * Usage: npm run seed:queue-scenarios
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { APP_DATA_DIRNAME, getAppDataDir, getSharedRoot } from '../src/config.js';
import {
  appendAdjustmentEvent,
  appendChangeEvent,
  ensureDataDir,
  writeDrivers,
  writeLetter,
  writeRouteState,
} from '../src/data/storage.js';
import { rebuildAndPersistRouteState } from '../src/services/rebuild.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const sharedRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : (() => {
      try {
        return getSharedRoot();
      } catch {
        return path.join(root, 'data');
      }
    })();
const appDataDir = path.join(sharedRoot, APP_DATA_DIRNAME);

await ensureDataDir(appDataDir);

/** Wipe log so scenarios are deterministic. */
await fs.writeFile(path.join(appDataDir, 'change-log.json'), '[]\n', 'utf8');

const baselines = {
  'S 20': {
    driver_name: 'Jane Driver',
    driver_id: 'drv-jane',
    segments: { AM: '6:35-8:55', MIDDAY: null, PM: '2:10-4:45' },
    baseline_segments: { AM: '6:35-8:55', MIDDAY: null, PM: '2:10-4:45' },
    status: 'STABLE',
    window_opened_date: null,
    window_expires_date: null,
    cumulative_drift_minutes: 0,
    contributing_change_ids: [],
    payroll_rounded_total_minutes: null,
    reconciliation: null,
    pending_change_ids: [],
    review_history: [],
    last_updated: '2025-09-01T12:00:00.000Z',
  },
  'S 11': {
    driver_name: 'Tammy Trapp',
    driver_id: 'drv-tammy',
    segments: { AM: '6:40-9:20', MIDDAY: null, PM: '1:55-4:40' },
    baseline_segments: { AM: '6:40-9:20', MIDDAY: null, PM: '1:55-4:40' },
    status: 'STABLE',
    window_opened_date: null,
    window_expires_date: null,
    cumulative_drift_minutes: 0,
    contributing_change_ids: [],
    payroll_rounded_total_minutes: null,
    reconciliation: null,
    pending_change_ids: [],
    review_history: [],
    last_updated: '2025-09-01T12:00:00.000Z',
  },
  'S 30': {
    driver_name: 'Bid Pending Driver',
    driver_id: 'drv-bid',
    segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
    baseline_segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
    status: 'STABLE',
    window_opened_date: null,
    window_expires_date: null,
    cumulative_drift_minutes: 0,
    contributing_change_ids: [],
    payroll_rounded_total_minutes: null,
    reconciliation: null,
    pending_change_ids: [],
    review_history: [],
    last_updated: '2025-09-01T12:00:00.000Z',
  },
  'S 40': {
    driver_name: 'Needs Review Driver',
    driver_id: 'drv-review',
    segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
    baseline_segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
    status: 'STABLE',
    window_opened_date: null,
    window_expires_date: null,
    cumulative_drift_minutes: 0,
    contributing_change_ids: [],
    payroll_rounded_total_minutes: null,
    reconciliation: null,
    pending_change_ids: [],
    review_history: [],
    last_updated: '2025-09-01T12:00:00.000Z',
  },
  'S 50': {
    driver_name: 'Self Resolved Driver',
    driver_id: 'drv-self',
    segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
    baseline_segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
    status: 'STABLE',
    window_opened_date: null,
    window_expires_date: null,
    cumulative_drift_minutes: 0,
    contributing_change_ids: [],
    payroll_rounded_total_minutes: null,
    reconciliation: null,
    pending_change_ids: [],
    review_history: [],
    last_updated: '2025-09-01T12:00:00.000Z',
  },
};

await writeRouteState(baselines, appDataDir);
await writeDrivers(
  [
    { driver_id: 'drv-jane', name: 'Jane Driver', email: null },
    { driver_id: 'drv-tammy', name: 'Tammy Trapp', email: null },
    { driver_id: 'drv-bid', name: 'Bid Pending Driver', email: null },
    { driver_id: 'drv-review', name: 'Needs Review Driver', email: null },
    { driver_id: 'drv-self', name: 'Self Resolved Driver', email: null },
  ],
  appDataDir
);

function change({
  id,
  route_id,
  driver_name,
  driver_id,
  delta_minutes,
  effective_date,
  submitted_at,
  previous_time = '6:35-8:55',
  new_time,
  note = 'Seed scenario',
}) {
  return {
    id,
    route_id,
    driver_name,
    driver_id,
    segment: 'AM',
    submitted_at,
    effective_date,
    previous_time,
    new_time,
    computed_delta_minutes: delta_minutes,
    delta_minutes,
    routing_adjustment: null,
    reason_category: 'MV',
    note,
    entered_by: 'Routing Desk',
  };
}

// --- S 30: BID_PENDING (+35, window expired) ---
await appendChangeEvent(
  change({
    id: 'seed-s30-c1',
    route_id: 'S 30',
    driver_name: 'Bid Pending Driver',
    driver_id: 'drv-bid',
    delta_minutes: 35,
    effective_date: '2025-09-02',
    submitted_at: '2025-09-02T08:00:00.000Z',
    new_time: '6:00-8:55',
    note: 'Seed: large AM add → bid threshold',
  }),
  appDataDir
);
// Real 2025-26 calendar: 2025-09-02 + 15 school days = 2025-09-24 (inclusive).
// Finalize on the first day after that.
await rebuildAndPersistRouteState(appDataDir, '2025-09-25');

// --- S 40: NEEDS_REVIEW + pending change ---
await appendChangeEvent(
  change({
    id: 'seed-s40-c1',
    route_id: 'S 40',
    driver_name: 'Needs Review Driver',
    driver_id: 'drv-review',
    delta_minutes: 35,
    effective_date: '2025-09-02',
    submitted_at: '2025-09-02T08:05:00.000Z',
    new_time: '6:00-8:55',
    note: 'Seed: finalize as BID_PENDING then adjust',
  }),
  appDataDir
);
await rebuildAndPersistRouteState(appDataDir, '2025-09-25');
await writeLetter(
  'S40-bid-notice.txt',
  'Seed letter for S 40 — prior BID_PENDING action already communicated.\n',
  appDataDir
);
await appendAdjustmentEvent(
  {
    id: 'seed-s40-adj1',
    target_change_id: 'seed-s40-c1',
    previous_delta: 35,
    new_delta: 22,
    reason: 'Data entry correction',
    note: 'Seed: retroactive correction that would flip BID_PENDING → STABLE',
    adjusted_by: 'Admin Assistant',
    adjusted_at: '2025-09-26T10:00:00.000Z',
  },
  appDataDir
);
await rebuildAndPersistRouteState(appDataDir, '2025-09-26');
await appendChangeEvent(
  change({
    id: 'seed-s40-c2',
    route_id: 'S 40',
    driver_name: 'Needs Review Driver',
    driver_id: 'drv-review',
    delta_minutes: 5,
    effective_date: '2025-09-29',
    submitted_at: '2025-09-29T09:00:00.000Z',
    previous_time: '6:00-8:55',
    new_time: '5:55-8:55',
    note: 'Seed: queued behind open NEEDS_REVIEW',
  }),
  appDataDir
);
await rebuildAndPersistRouteState(appDataDir, '2025-09-29');

// --- S 50: self-resolved NEEDS_REVIEW → back to BID_PENDING with history ---
await appendChangeEvent(
  change({
    id: 'seed-s50-c1',
    route_id: 'S 50',
    driver_name: 'Self Resolved Driver',
    driver_id: 'drv-self',
    delta_minutes: 35,
    effective_date: '2025-09-02',
    submitted_at: '2025-09-02T08:10:00.000Z',
    new_time: '6:00-8:55',
    note: 'Seed: bid then ping-pong adjustments',
  }),
  appDataDir
);
await rebuildAndPersistRouteState(appDataDir, '2025-09-25');
await appendAdjustmentEvent(
  {
    id: 'seed-s50-adj1',
    target_change_id: 'seed-s50-c1',
    previous_delta: 35,
    new_delta: 22,
    reason: 'Data entry correction',
    note: 'Seed: first adjustment → NEEDS_REVIEW',
    adjusted_by: 'Admin Assistant',
    adjusted_at: '2025-09-26T10:00:00.000Z',
  },
  appDataDir
);
await rebuildAndPersistRouteState(appDataDir, '2025-09-26');
await appendAdjustmentEvent(
  {
    id: 'seed-s50-adj2',
    target_change_id: 'seed-s50-c1',
    previous_delta: 22,
    new_delta: 35,
    reason: 'Data entry correction',
    note: 'Seed: restore prior delta → self-resolve',
    adjusted_by: 'Admin Assistant',
    adjusted_at: '2025-09-29T10:00:00.000Z',
  },
  appDataDir
);
await rebuildAndPersistRouteState(appDataDir, '2025-09-29');

// --- S 20: ACCUMULATING (uses July placeholder school days in calendar) ---
await appendChangeEvent(
  change({
    id: 'seed-s20-c1',
    route_id: 'S 20',
    driver_name: 'Jane Driver',
    driver_id: 'drv-jane',
    delta_minutes: 5,
    effective_date: '2026-07-10',
    submitted_at: '2026-07-10T22:28:33.943Z',
    previous_time: '6:35-8:55',
    new_time: '6:30-8:55',
    note: 'Student added',
  }),
  appDataDir
);

// Final rebuild as of "today" so open windows / days_remaining match the Admin view.
const asOf = process.env.SEED_AS_OF || new Date().toISOString().slice(0, 10);
const finalState = await rebuildAndPersistRouteState(appDataDir, asOf);

const summary = Object.entries(finalState)
  .map(([id, entry]) => {
    const pending = entry.pending_change_ids?.length
      ? ` pending=${entry.pending_change_ids.length}`
      : '';
    const hist = entry.review_history?.length
      ? ` history=${entry.review_history.map((h) => h.event).join(',')}`
      : '';
    return `  ${id}  ${entry.status}${pending}${hist}`;
  })
  .sort()
  .join('\n');

console.log(`Admin queue scenarios seeded in ${appDataDir}`);
console.log(`asOf=${asOf}`);
console.log(summary);
console.log(`Shared root: ${sharedRoot}`);
