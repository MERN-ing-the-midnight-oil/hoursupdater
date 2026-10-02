import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBps2026_2027Calendar } from '../employee-tracker/src/bpsCalendar2026.js';
import {
  EMPLOYEE_ROUTE_ID,
  buildEmployeeSnapshot,
  rebuildEmployeeRouteState,
} from '../employee-tracker/src/snapshot.js';
import { contractWindowPlan, forcedOctober1ContractPlan } from '../src/logic/contractWindows.js';
import { applyChangeToRoute, applyWindowExpiration } from '../src/logic/stateMachine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const calendar = JSON.parse(
  await fs.readFile(path.join(__dirname, 'fixtures/school-calendar.json'), 'utf8')
);

function makeChange(overrides) {
  const delta = overrides.delta_minutes ?? 40;
  return {
    id: overrides.id ?? 'change-1',
    route_id: 'S 20',
    driver_name: 'Jane Driver',
    segment: 'AM',
    submitted_at: overrides.submitted_at ?? '2025-09-08T08:00:00.000Z',
    effective_date: overrides.effective_date ?? '2025-09-08',
    previous_time: overrides.previous_time ?? '6:35-8:55',
    new_time: overrides.new_time ?? '6:35-9:35',
    computed_delta_minutes: delta,
    delta_minutes: delta,
    routing_adjustment: null,
    reason_category: 'OTHER',
    note: '',
    entered_by: 'Office',
    force_oct1_contract: false,
    ...overrides,
  };
}

function apply(change, state = null, log = [change]) {
  return applyChangeToRoute(state, change, calendar, change.effective_date, change.delta_minutes, {
    changeLog: log,
  });
}

describe('Force Oct 1 Contract', () => {
  it('contracts a 30+ increase on October 1 instead of bidding it', () => {
    const change = makeChange({ force_oct1_contract: true });
    const plain = contractWindowPlan(calendar, change.effective_date, 40);
    assert.notEqual(plain.becomes_effective_on, '2025-10-01');

    let state = apply(change);
    assert.equal(state.status, 'ACCUMULATING');
    assert.equal(state.window_rule, 'forced_october_1_contract');
    assert.equal(state.window_expires_date, '2025-09-30');
    assert.equal(forcedOctober1ContractPlan(change.effective_date).becomes_effective_on, '2025-10-01');

    state = applyWindowExpiration(state, '2025-10-01', {
      routeId: change.route_id,
      changeLog: [change],
      schoolCalendar: calendar,
    });
    assert.equal(state.status, 'STABLE');
    assert.notEqual(state.status, 'BID_PENDING');
    assert.equal(state.change_reports.at(-1).outcome, 'STABLE');
    assert.equal(state.change_reports.at(-1).forced_october_1, true);
    assert.equal(String(state.change_reports.at(-1).finalized_at).slice(0, 10), '2025-10-01');
  });

  it('contracts a 30+ decrease on October 1 instead of an immediate bump', () => {
    const forced = makeChange({
      id: 'cut',
      delta_minutes: -40,
      previous_time: '6:35-8:55',
      new_time: '6:35-8:15',
      force_oct1_contract: true,
    });
    const open = apply(forced);
    assert.equal(open.status, 'ACCUMULATING');
    assert.equal(open.window_expires_date, '2025-09-30');

    const bump = apply(makeChange({ ...forced, id: 'bump', force_oct1_contract: false }));
    assert.equal(bump.status, 'BUMP_ELIGIBLE');
  });

  it('still contracts on October 1 when the change is too late for a 15-school-day countdown', () => {
    const change = makeChange({
      id: 'late',
      effective_date: '2025-09-25',
      submitted_at: '2025-09-25T08:00:00.000Z',
      force_oct1_contract: true,
    });
    const plain = contractWindowPlan(calendar, change.effective_date, 40);
    assert.notEqual(plain.rule, 'pre_october_1_lock');
    const state = apply(change);
    assert.equal(state.window_rule, 'forced_october_1_contract');
    assert.equal(state.window_expires_date, '2025-09-30');
    assert.equal(state.status, 'ACCUMULATING');
  });

  it('uses the mark on the latest change when a later schedule is added', () => {
    const first = makeChange({ id: 'c1', force_oct1_contract: true });
    const second = makeChange({
      id: 'c2',
      delta_minutes: 5,
      previous_time: '6:35-9:35',
      new_time: '6:30-9:35',
      effective_date: '2025-09-12',
      submitted_at: '2025-09-12T08:00:00.000Z',
      force_oct1_contract: false,
    });
    const kept = apply(second, apply(first, null, [first]), [first, second]);
    assert.notEqual(kept.window_rule, 'forced_october_1_contract');

    const alsoForced = makeChange({ ...second, id: 'c3', force_oct1_contract: true });
    const forced = apply(alsoForced, apply(first, null, [first]), [first, alsoForced]);
    assert.equal(forced.window_rule, 'forced_october_1_contract');
    assert.equal(forced.cumulative_drift_minutes, 45);
    assert.equal(forced.window_expires_date, '2025-09-30');
  });

  it('contracts a change after October 1 on that October 1 immediately', () => {
    const change = makeChange({
      id: 'after',
      effective_date: '2025-10-06',
      submitted_at: '2025-10-06T08:00:00.000Z',
      force_oct1_contract: true,
    });
    const state = apply(change);
    assert.equal(state.status, 'STABLE');
    assert.equal(state.change_reports.at(-1).outcome, 'STABLE');
    assert.equal(String(state.change_reports.at(-1).finalized_at).slice(0, 10), '2025-10-01');
  });

  it('shows October 1 on the office schedule history for a forced change', () => {
    const { calendar: schoolYear } = buildBps2026_2027Calendar();
    const start = '2026-09-08';
    const seeds = ['AM', 'MIDDAY', 'PM'].map((segment, index) => ({
      id: `seed-${segment}`,
      route_id: EMPLOYEE_ROUTE_ID,
      driver_name: 'Alex Driver',
      segment,
      submitted_at: `${start}T08:00:0${index}.000Z`,
      effective_date: start,
      previous_time: segment === 'AM' ? '6:35-8:55' : segment === 'MIDDAY' ? '11:00-12:15' : '14:10-16:40',
      new_time: segment === 'AM' ? '6:35-8:55' : segment === 'MIDDAY' ? '11:00-12:15' : '14:10-16:40',
      computed_delta_minutes: 0,
      delta_minutes: 0,
      routing_adjustment: null,
      reason_category: 'OTHER',
      note: 'Starting schedule',
      entered_by: 'Office',
    }));
    const change = {
      id: 'am-plus-40',
      route_id: EMPLOYEE_ROUTE_ID,
      driver_name: 'Alex Driver',
      segment: 'AM',
      submitted_at: '2026-09-20T15:00:00.000Z',
      effective_date: '2026-09-20',
      previous_time: '6:35-8:55',
      new_time: '6:35-9:35',
      computed_delta_minutes: 40,
      delta_minutes: 40,
      routing_adjustment: null,
      reason_category: 'OTHER',
      note: '',
      entered_by: 'Office',
      force_oct1_contract: true,
    };
    const log = [...seeds, change];

    function rowAt(asOf) {
      const entry = rebuildEmployeeRouteState(log, schoolYear, asOf);
      return buildEmployeeSnapshot({
        profile: { name: '12', start_date: start },
        changeLog: log,
        entry,
        calendar: schoolYear,
        asOfDate: asOf,
      }).schedule_history.find((item) => item.change_id === change.id);
    }

    const before = rowAt('2026-09-21');
    assert.equal(before.force_oct1_contract, true);
    assert.equal(before.contracted.status, 'predicted');
    assert.equal(before.contracted.becomes_on, '2026-10-01');
    assert.equal(before.contracted.projected_outcome, 'STABLE');
    assert.match(before.contracted.detail, /Force Oct 1 Contract is on/);

    const after = rowAt('2026-10-02');
    assert.equal(after.contracted.status, 'became_contracted');
    assert.equal(after.contracted.becomes_on, '2026-10-01');
    assert.equal(after.contracted.projected_outcome, 'STABLE');

    const unforcedLog = [...seeds, { ...change, id: 'plain', force_oct1_contract: false }];
    const unforcedEntry = rebuildEmployeeRouteState(unforcedLog, schoolYear, '2026-09-21');
    const unforced = buildEmployeeSnapshot({
      profile: { name: '12', start_date: start },
      changeLog: unforcedLog,
      entry: unforcedEntry,
      calendar: schoolYear,
      asOfDate: '2026-09-21',
    }).schedule_history.find((item) => item.change_id === 'plain');
    assert.equal(unforced.force_oct1_contract, false);
    assert.notEqual(unforced.contracted.becomes_on, '2026-10-01');
  });
});
