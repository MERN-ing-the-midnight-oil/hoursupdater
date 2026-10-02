import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBps2026_2027Calendar } from '../employee-tracker/src/bpsCalendar2026.js';
import {
  EMPLOYEE_ROUTE_ID,
  buildEmployeeSnapshot,
  rebuildEmployeeRouteState,
} from '../employee-tracker/src/snapshot.js';
import { computeDeltaMinutes } from '../src/logic/timeUtils.js';
import { contractColumnsForHistory } from '../office-tracker/src/historyMarkup.js';

const { calendar } = buildBps2026_2027Calendar();
const profile = { name: '12', start_date: '2026-09-08' };

function seed(segment, range) {
  return {
    id: `seed-${segment}`,
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: 'Alex Driver',
    driver_id: null,
    segment,
    submitted_at: '2026-09-08T08:00:00.000Z',
    effective_date: '2026-09-08',
    previous_time: range,
    new_time: range,
    computed_delta_minutes: 0,
    delta_minutes: 0,
    routing_adjustment: null,
    reason_category: 'OTHER',
    note: '',
    entered_by: 'Alex Driver',
  };
}

function change() {
  const previous = '6:35-8:55';
  const next = '6:28-8:55';
  const delta = computeDeltaMinutes(previous, next);
  return {
    id: 'change-1',
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: 'Alex Driver',
    driver_id: null,
    segment: 'AM',
    submitted_at: '2026-09-08T12:00:00.000Z',
    effective_date: '2026-09-08',
    previous_time: previous,
    new_time: next,
    computed_delta_minutes: delta,
    delta_minutes: delta,
    routing_adjustment: null,
    reason_category: 'OTHER',
    note: '',
    entered_by: 'Alex Driver',
  };
}

const log = [seed('AM', '6:35-8:55'), seed('PM', '14:05-16:25'), change()];

function columnsAsOf(asOf) {
  const entry = rebuildEmployeeRouteState(log, calendar, asOf);
  const snap = buildEmployeeSnapshot({
    profile,
    changeLog: log,
    entry,
    calendar,
    asOfDate: asOf,
  });
  return contractColumnsForHistory(snap.schedule_history);
}

describe('route clock time columns', () => {
  it('keeps contract hours at the previous figure until the predicted date', () => {
    const columns = columnsAsOf('2026-09-08');
    assert.deepEqual(columns[0], {
      hours: '4 hr 30 min',
      contractedDate: '09/08/2026',
      contractHours: '4 hr 30 min',
    });
    assert.deepEqual(columns[1], {
      hours: '4 hr 45 min',
      contractedDate: 'predicted: 10/01/2026',
      contractHours: '4 hr 30 min',
    });
  });

  it('shows the new contract hours once the window has closed', () => {
    const columns = columnsAsOf('2026-10-01');
    assert.deepEqual(columns[1], {
      hours: '4 hr 45 min',
      contractedDate: '10/01/2026',
      contractHours: '4 hr 45 min',
    });
  });
});
