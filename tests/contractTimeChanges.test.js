import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEmployeeSnapshot,
  rebuildEmployeeRouteState,
} from '../employee-tracker/src/snapshot.js';
import {
  forcedContractOnDate,
  forcedContractOnPlan,
} from '../src/logic/contractWindows.js';
import { applyChangeToRoute, applyWindowExpiration } from '../src/logic/stateMachine.js';
import {
  compareSuggestions,
  contractAcceptUrl,
  contractAcceptanceMap,
  normalizeContractAcceptance,
  suggestionFromHistoryRow,
} from '../office-tracker/src/contractTimeChanges.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const calendar = JSON.parse(
  await fs.readFile(path.join(__dirname, 'fixtures/school-calendar.json'), 'utf8')
);

function makeChange(overrides = {}) {
  const delta = overrides.delta_minutes ?? 15;
  return {
    id: overrides.id ?? 'change-1',
    route_id: 'SELF',
    driver_name: 'Jane Driver',
    segment: 'AM',
    submitted_at: overrides.submitted_at ?? '2025-10-06T08:00:00.000Z',
    effective_date: overrides.effective_date ?? '2025-10-06',
    previous_time: overrides.previous_time ?? '6:35-8:55',
    new_time: overrides.new_time ?? '6:35-9:10',
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

function seedLog() {
  return [
    {
      id: 'seed-am',
      route_id: 'SELF',
      driver_name: 'Jane Driver',
      segment: 'AM',
      submitted_at: '2025-09-02T08:00:00.000Z',
      effective_date: '2025-09-02',
      previous_time: '6:35-8:55',
      new_time: '6:35-8:55',
      computed_delta_minutes: 0,
      delta_minutes: 0,
      reason_category: 'OTHER',
      note: '',
      entered_by: 'Office',
    },
  ];
}

describe('forcedContractOnPlan', () => {
  it('locks on the accepted date', () => {
    const plan = forcedContractOnPlan('2025-11-03', '2025-10-06');
    assert.equal(plan.rule, 'forced_contract_on');
    assert.equal(plan.becomes_effective_on, '2025-11-03');
    assert.equal(plan.window_expires_date, '2025-11-02');
    assert.equal(forcedContractOnDate('2025-11-03'), '2025-11-03');
  });
});

describe('requireAcceptForStable', () => {
  it('holds under-30 lock-in until force_contract_on is accepted', () => {
    const change = makeChange({ delta_minutes: 15 });
    let state = applyChangeToRoute(null, change, calendar, change.effective_date, 15, {
      changeLog: [change],
      requireAcceptForStable: true,
    });
    assert.equal(state.status, 'ACCUMULATING');

    state = applyWindowExpiration(state, '2025-12-01', {
      routeId: 'SELF',
      changeLog: [change],
      schoolCalendar: calendar,
      requireAcceptForStable: true,
    });
    assert.equal(state.status, 'ACCUMULATING');

    const accepted = { ...change, force_contract_on: '2025-10-28' };
    state = applyChangeToRoute(null, accepted, calendar, accepted.effective_date, 15, {
      changeLog: [accepted],
      requireAcceptForStable: true,
    });
    state = applyWindowExpiration(state, '2025-10-28', {
      routeId: 'SELF',
      changeLog: [accepted],
      schoolCalendar: calendar,
      requireAcceptForStable: true,
    });
    assert.equal(state.status, 'STABLE');
    assert.equal(state.change_reports.at(-1).outcome, 'STABLE');
    assert.equal(state.change_reports.at(-1).forced_contract_on, '2025-10-28');
  });

  it('still closes bid outcomes without Accept', () => {
    const change = makeChange({
      delta_minutes: 40,
      new_time: '6:35-9:35',
      effective_date: '2025-10-06',
      submitted_at: '2025-10-06T08:00:00.000Z',
    });
    let state = applyChangeToRoute(null, change, calendar, change.effective_date, 40, {
      changeLog: [change],
      requireAcceptForStable: true,
    });
    state = applyWindowExpiration(state, '2026-05-01', {
      routeId: 'SELF',
      changeLog: [change],
      schoolCalendar: calendar,
      requireAcceptForStable: true,
    });
    assert.equal(state.status, 'BID_PENDING');
  });
});

describe('contractTimeChanges helpers', () => {
  it('normalizes acceptances and builds deep links', () => {
    const record = normalizeContractAcceptance({
      changeId: 'c1',
      routeId: 'p1',
      effectiveDate: '2025-11-03',
      times: { AM: '6:35-9:10', MIDDAY: null, PM: '14:00-16:00' },
      acceptedBy: 'Pat',
    });
    assert.equal(record.reportedToPayroll, true);
    assert.equal(contractAcceptanceMap({ c1: record }).c1.routeId, 'p1');
    assert.match(
      contractAcceptUrl({
        origin: 'https://example.test',
        changeId: 'c1',
        pathname: '/office/',
      }),
      /sheet=contract-time-changes/
    );
  });

  it('marks overdue suggestions after becomes_on', () => {
    const change = makeChange({ id: 'open', delta_minutes: 15 });
    const log = [...seedLog(), change];
    const entry = rebuildEmployeeRouteState(log, calendar, '2025-10-06', {}, {
      requireAcceptForStable: true,
    });
    const snap = buildEmployeeSnapshot({
      profile: { name: '104', start_date: '2025-09-02' },
      changeLog: log,
      entry,
      calendar,
      asOfDate: '2025-10-06',
    });
    const row = (snap.schedule_history || []).find((item) => item.change_id === 'open');
    const pending = suggestionFromHistoryRow({
      profile: { id: 'p1', name: '104' },
      row,
      asOf: '2025-10-06',
    });
    assert.equal(pending?.accepted, false);
    const late = suggestionFromHistoryRow({
      profile: { id: 'p1', name: '104' },
      row,
      asOf: '2026-06-01',
    });
    assert.equal(late?.overdue, true);
    assert.equal(compareSuggestions(late, pending) < 0, true);
  });
});
