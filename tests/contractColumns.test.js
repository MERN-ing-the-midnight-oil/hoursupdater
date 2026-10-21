import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBellingham2026_2027Calendar } from '../employee-tracker/src/bellinghamCalendar2026.js';
import {
  EMPLOYEE_ROUTE_ID,
  buildEmployeeSnapshot,
  rebuildEmployeeRouteState,
} from '../employee-tracker/src/snapshot.js';
import { computeDeltaMinutes } from '../src/logic/timeUtils.js';
import { contractColumnsForHistory } from '../office-tracker/src/historyMarkup.js';

const { calendar } = buildBellingham2026_2027Calendar();
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
  it('shows the rounded schedule total and a predicted contract date', () => {
    const columns = columnsAsOf('2026-09-08');
    assert.deepEqual(columns[0], {
      hours: '4 hr 30 min',
      contractedDate: '09/08/2026',
    });
    assert.deepEqual(columns[1], {
      hours: '4 hr 45 min',
      contractedDate: 'predicted: 10/01/2026',
    });
  });

  it('labels a replaced forecast old and the later date new', () => {
    const columns = contractColumnsForHistory([
      {
        kind: 'change',
        date: '2026-10-06',
        contracted: { status: 'predicted', becomes_on: '2026-10-28' },
      },
      {
        kind: 'change',
        date: '2026-10-20',
        contracted: { status: 'predicted', becomes_on: '2026-11-12' },
      },
    ]);
    assert.equal(columns[0].contractedDate, 'old predicted: 10/28/2026');
    assert.equal(columns[1].contractedDate, 'new predicted: 11/12/2026');
  });

  it('keeps one standing forecast as predicted when the date does not change', () => {
    const columns = contractColumnsForHistory([
      {
        kind: 'change',
        date: '2026-10-06',
        contracted: { status: 'predicted', becomes_on: '2026-10-28' },
      },
      {
        kind: 'change',
        date: '2026-10-20',
        contracted: { status: 'predicted', becomes_on: '2026-10-28' },
      },
    ]);
    assert.equal(columns[0].contractedDate, 'predicted: 10/28/2026');
    assert.equal(columns[1].contractedDate, 'predicted: 10/28/2026');
  });

  it('does not call a side countdown the predicted contract date', () => {
    const columns = contractColumnsForHistory([
      {
        kind: 'change',
        date: '2026-10-06',
        contracted: {
          status: 'predicted',
          becomes_on: '2026-10-28',
          projected_outcome: 'BID_PENDING',
        },
      },
      {
        kind: 'change',
        date: '2026-10-20',
        contracted: { status: 'side_countdown', becomes_on: '2026-11-12' },
      },
    ]);
    assert.equal(columns[0].contractedDate, 'predicted: 10/28/2026');
    assert.equal(columns[1].contractedDate, '—');
  });

  it('keeps the bid date when a later change stays at or above 30 minutes', () => {
    function timed(id, segment, previous, next, date, submitted) {
      const delta = computeDeltaMinutes(previous, next);
      return {
        id,
        route_id: EMPLOYEE_ROUTE_ID,
        driver_name: 'Alex Driver',
        driver_id: null,
        segment,
        submitted_at: submitted,
        effective_date: date,
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
    const changes = [
      seed('AM', '6:40-8:40'),
      seed('PM', '14:05-16:25'),
      timed('plus-20', 'PM', '14:05-16:25', '14:05-16:45', '2026-10-05', '2026-10-05T15:00:00.000Z'),
      timed('plus-25', 'PM', '14:05-16:45', '14:05-17:10', '2026-10-06', '2026-10-06T15:00:00.000Z'),
      timed('plus-5', 'AM', '6:40-8:40', '6:35-8:40', '2026-10-06', '2026-10-09T15:00:00.000Z'),
      timed('minus-15', 'AM', '6:35-8:40', '6:50-8:40', '2026-10-20', '2026-10-19T21:00:00.000Z'),
    ];
    const entry = rebuildEmployeeRouteState(changes, calendar, '2026-10-20');
    const snap = buildEmployeeSnapshot({
      profile,
      changeLog: changes,
      entry,
      calendar,
      asOfDate: '2026-10-20',
    });
    const columns = contractColumnsForHistory(snap.schedule_history);
    const dates = snap.schedule_history.map((row, index) => [
      row.date,
      columns[index].contractedDate,
    ]);
    assert.deepEqual(dates, [
      ['2026-09-08', '09/08/2026'],
      ['2026-10-05', '—'],
      ['2026-10-06', 'predicted: 10/28/2026'],
      ['2026-10-20', '—'],
    ]);
  });

  it('shows the contract date once the window has closed', () => {
    const columns = columnsAsOf('2026-10-01');
    assert.deepEqual(columns[1], {
      hours: '4 hr 45 min',
      contractedDate: '10/01/2026',
    });
  });
});
