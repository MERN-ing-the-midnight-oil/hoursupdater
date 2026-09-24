import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeDeltaMinutes } from '../src/logic/timeUtils.js';
import { buildBps2026_2027Calendar } from '../employee-tracker/src/bpsCalendar2026.js';
import { EMPLOYEE_ROUTE_ID } from '../employee-tracker/src/snapshot.js';
import {
  buildEmployeeSnapshot,
  rebuildEmployeeRouteState,
} from '../employee-tracker/src/snapshot.js';
import {
  buildChangesCsv,
  changesCsvFilename,
} from '../employee-tracker/src/changesCsv.js';

const { calendar } = buildBps2026_2027Calendar();

function parseCsv(csv) {
  const text = csv.replace(/^\uFEFF/, '').replace(/\r\n$/, '');
  return text.split('\r\n').map((line) => {
    /** @type {string[]} */
    const cells = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (quoted) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          current += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells;
  });
}

function makeSeed(segment, range, date = '2026-09-08') {
  return {
    id: `seed-${segment}`,
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: 'Alex Driver',
    driver_id: null,
    segment,
    submitted_at: `${date}T08:00:00.000Z`,
    effective_date: date,
    previous_time: range,
    new_time: range,
    computed_delta_minutes: 0,
    delta_minutes: 0,
    routing_adjustment: null,
    reason_category: 'OTHER',
    note: 'Starting schedule',
    entered_by: 'Alex Driver',
  };
}

function makeChange(overrides) {
  const previous = overrides.previous_time ?? '6:35-8:55';
  const next = overrides.new_time ?? '6:28-8:55';
  const delta = overrides.delta_minutes ?? computeDeltaMinutes(previous, next);
  return {
    id: overrides.id ?? 'change-1',
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: 'Alex Driver',
    driver_id: null,
    segment: overrides.segment ?? 'AM',
    submitted_at: overrides.submitted_at ?? '2026-09-08T12:00:00.000Z',
    effective_date: overrides.effective_date ?? '2026-09-08',
    previous_time: previous,
    new_time: next,
    computed_delta_minutes: delta,
    delta_minutes: delta,
    routing_adjustment: null,
    reason_category: 'OTHER',
    note: overrides.note ?? '',
    entered_by: 'Alex Driver',
    ...overrides,
  };
}

describe('clock-time changes CSV', () => {
  const profile = {
    name: 'Alex Driver',
    start_date: '2026-09-08',
    setup_at: '2026-09-08T08:00:00.000Z',
  };

  it('writes a header and one row per change, oldest first', () => {
    const log = [
      makeSeed('AM', '6:35-8:55'),
      makeSeed('PM', '14:05-16:25'),
      makeChange({
        id: 'change-am',
        segment: 'AM',
        previous_time: '6:35-8:55',
        new_time: '6:28-8:55',
        note: 'Earlier AM start',
        submitted_at: '2026-09-08T12:00:00.000Z',
        effective_date: '2026-09-08',
      }),
      makeChange({
        id: 'change-pm',
        segment: 'PM',
        previous_time: '14:05-16:25',
        new_time: '14:00-16:25',
        note: 'PM, "yard" move',
        submitted_at: '2026-09-10T12:00:00.000Z',
        effective_date: '2026-09-10',
      }),
    ];
    const entry = rebuildEmployeeRouteState(log, calendar, '2026-09-10');
    const snap = buildEmployeeSnapshot({
      profile,
      changeLog: log,
      entry,
      calendar,
      asOfDate: '2026-09-10',
    });
    const rows = parseCsv(buildChangesCsv(snap));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], [
      'Name',
      'Date',
      'Run',
      'Previous times',
      'New times',
      'Change minutes',
      'Cumulative minutes',
      'Note',
      'Contracted status',
      'Becomes contracted on',
      'Result',
      'AM',
      'Midday',
      'PM',
    ]);
    assert.equal(rows[1][0], 'Alex Driver');
    assert.equal(rows[1][1], '2026-09-08');
    assert.equal(rows[1][2], 'AM');
    assert.equal(rows[1][3], '6:35-8:55');
    assert.equal(rows[1][4], '6:28-8:55');
    assert.equal(rows[1][5], '7');
    assert.equal(rows[1][7], 'Earlier AM start');
    assert.equal(rows[1][11], '6:28-8:55');
    assert.equal(rows[1][13], '14:05-16:25');
    assert.equal(rows[2][1], '2026-09-10');
    assert.equal(rows[2][2], 'PM');
    assert.equal(rows[2][3], '14:05-16:25');
    assert.equal(rows[2][4], '14:00-16:25');
    assert.equal(rows[2][7], 'PM, "yard" move');
    assert.equal(
      Number(rows[2][6]),
      Number(rows[1][5]) + Number(rows[2][5])
    );
    assert.match(buildChangesCsv(snap), /^\uFEFF/);
  });

  it('omits the established starting schedule when nothing has changed', () => {
    const log = [makeSeed('AM', '6:35-8:55'), makeSeed('PM', '14:05-16:25')];
    const entry = rebuildEmployeeRouteState(log, calendar, '2026-09-08');
    const snap = buildEmployeeSnapshot({
      profile,
      changeLog: log,
      entry,
      calendar,
      asOfDate: '2026-09-08',
    });
    const rows = parseCsv(buildChangesCsv(snap));
    assert.equal(rows.length, 1);
    assert.equal(rows[0][0], 'Name');
  });

  it('names the file from the person', () => {
    assert.equal(
      changesCsvFilename('Morgan Hale (example)'),
      'morgan-hale-example-clock-time-changes.csv'
    );
    assert.equal(changesCsvFilename('  '), 'clock-time-changes.csv');
  });
});
