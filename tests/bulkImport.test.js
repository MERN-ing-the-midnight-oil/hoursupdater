import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBulkImportEvent,
  buildSeededRouteState,
  parseBulkImportText,
  planBulkImportWrites,
  previewBulkImport,
  resolveBulkImportPreview,
  validateBulkImportRow,
} from '../src/logic/bulkImport.js';
import { isBulkImportEvent, isChangeEvent } from '../src/logic/stateMachine.js';

const SAMPLE_CSV = `driver_name,driver_email,hire_date,route_id,am_time,midday_time,pm_time
Jane Driver,jane@example.org,2012-08-15,S 99,6:35-8:55,,2:10-4:45
Bob Bus,,2019-03-01,S 100,7:00-9:00,,
`;

describe('bulkImport parse/validate', () => {
  it('parses CSV with optional columns and row numbers', () => {
    const rows = parseBulkImportText(SAMPLE_CSV);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].row_number, 1);
    assert.equal(rows[0].driver_name, 'Jane Driver');
    assert.equal(rows[0].route_id, 'S 99');
    assert.equal(rows[0].hire_date, '2012-08-15');
    assert.equal(rows[1].am_time, '7:00-9:00');
    assert.equal(rows[1].driver_email, '');
  });

  it('parses tab-separated paste from a spreadsheet', () => {
    const text = [
      'driver_name\troute_id\thire_date\tam_time\tpm_time',
      'Ada\tR1\t2015-01-01\t6:00-7:00\t2:00-3:00',
    ].join('\n');
    const rows = parseBulkImportText(text);
    assert.equal(rows[0].route_id, 'R1');
    assert.equal(rows[0].hire_date, '2015-01-01');
    assert.equal(rows[0].pm_time, '2:00-3:00');
  });

  it('ignores blank rows and unrecognized columns', () => {
    const text = `driver_name,driver_email,hire_date,route_id,am_time,midday_time,pm_time,notes,extra
Jane Driver,jane@example.org,2012-08-15,S 99,6:35-8:55,,2:10-4:45,ignore me,also ignore

,,,,,,
,,,
Bob Bus,,2019-03-01,S 100,7:00-9:00,,,keep this note,xyz
`;
    const rows = parseBulkImportText(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].driver_name, 'Jane Driver');
    assert.equal(rows[0].route_id, 'S 99');
    assert.equal(rows[1].driver_name, 'Bob Bus');
    assert.equal(rows[1].am_time, '7:00-9:00');
    assert.equal(rows[1].row_number, 4);
  });

  it('rejects import that only has a header and blank rows', () => {
    const text = `driver_name,driver_email,hire_date,route_id,am_time,midday_time,pm_time
,,,,,,
`;
    assert.throws(
      () => parseBulkImportText(text),
      /at least one data row/
    );
  });

  it('rejects rows missing required fields or all times', () => {
    const missingName = validateBulkImportRow({
      row_number: 1,
      driver_name: '',
      driver_email: '',
      hire_date: '2015-01-01',
      tie_break: '',
      route_id: 'S 1',
      am_time: '6:00-7:00',
      midday_time: '',
      pm_time: '',
      raw: {},
    });
    assert.equal(missingName.ok, false);
    assert.match(missingName.reasons.join(' '), /driver_name/);

    const noTimes = validateBulkImportRow({
      row_number: 2,
      driver_name: 'Pat',
      driver_email: '',
      hire_date: '2015-01-01',
      tie_break: '',
      route_id: 'S 2',
      am_time: '',
      midday_time: '',
      pm_time: '',
      raw: {},
    });
    assert.equal(noTimes.ok, false);
    assert.match(noTimes.reasons.join(' '), /At least one/);
  });

  it('rejects invalid hire_date format', () => {
    const badHire = validateBulkImportRow({
      row_number: 1,
      driver_name: 'Pat',
      driver_email: '',
      hire_date: '01/15/2015',
      route_id: 'S 2',
      am_time: '6:00-7:00',
      midday_time: '',
      pm_time: '',
      raw: {},
    });
    assert.equal(badHire.ok, false);
    assert.match(badHire.reasons.join(' '), /hire_date/);
  });
});

describe('bulkImport preview', () => {
  it('counts new drivers/routes and lists excluded invalid rows', () => {
    const text = `driver_name,route_id,hire_date,am_time,pm_time
New Person,NEW-1,2016-01-01,6:35-8:55,2:10-4:45
,MISSING-NAME,2016-01-01,6:00-7:00,
Also New,NEW-2,2017-01-01,7:00-8:00,
`;
    const preview = previewBulkImport(text, {
      drivers: [],
      routeState: {},
      changeLog: [],
    });
    assert.equal(preview.summary.new_drivers_count, 2);
    assert.equal(preview.summary.new_routes_count, 2);
    assert.equal(preview.summary.excluded_row_count, 1);
    assert.equal(preview.excluded_rows[0].row_number, 2);
    assert.equal(preview.requires_resolutions, false);
  });

  it('excludes new drivers missing hire_date', () => {
    const text = `driver_name,route_id,am_time
Newbie,NEW-9,6:35-8:55
`;
    const preview = previewBulkImport(text, {
      drivers: [],
      routeState: {},
      changeLog: [],
    });
    assert.equal(preview.summary.new_drivers_count, 0);
    assert.equal(preview.summary.excluded_row_count, 1);
    assert.match(preview.excluded_rows[0].reasons.join(' '), /hire_date/);
  });

  it('flags existing route_id and case-insensitive driver name conflicts', () => {
    const text = `driver_name,route_id,hire_date,am_time
jane driver,S 20,2012-08-15,6:35-8:55
Brand New,S 20B,2020-01-01,7:00-8:00
Other Person,EXISTING-ROUTE,2010-01-01,6:00-7:00
`;
    const preview = previewBulkImport(text, {
      drivers: [
        {
          driver_id: 'drv-jane',
          name: 'Jane Driver',
          email: null,
          hire_date: '2012-08-15',
          tie_break: null,
        },
      ],
      routeState: {
        'S 20': {
          driver_name: 'Jane Driver',
          driver_id: 'drv-jane',
          segments: { AM: '6:00-7:00', MIDDAY: null, PM: null },
          baseline_segments: { AM: '6:00-7:00', MIDDAY: null, PM: null },
          status: 'STABLE',
          window_opened_date: null,
          window_expires_date: null,
          cumulative_drift_minutes: 0,
          contributing_change_ids: [],
          payroll_rounded_total_minutes: null,
          last_updated: '2025-09-01T12:00:00.000Z',
        },
        'EXISTING-ROUTE': {
          driver_name: 'Prior',
          driver_id: 'drv-prior',
          segments: { AM: '6:00-7:00', MIDDAY: null, PM: null },
          baseline_segments: { AM: '6:00-7:00', MIDDAY: null, PM: null },
          status: 'STABLE',
          window_opened_date: null,
          window_expires_date: null,
          cumulative_drift_minutes: 0,
          contributing_change_ids: [],
          payroll_rounded_total_minutes: null,
          last_updated: '2025-09-01T12:00:00.000Z',
        },
      },
      changeLog: [],
    });
    assert.equal(preview.summary.conflict_row_count, 2);
    assert.equal(preview.summary.new_routes_count, 1);
    assert.equal(preview.requires_resolutions, true);
    const jane = preview.conflicts.find((c) => c.row_number === 1);
    assert.ok(jane.conflict_types.includes('existing_driver'));
    assert.ok(jane.conflict_types.includes('existing_route'));
    assert.equal(jane.overwrite_allowed, true);
    const routeOnly = preview.conflicts.find((c) => c.row_number === 3);
    assert.deepEqual(routeOnly.conflict_types, ['existing_route']);
  });

  it('blocks overwrite when the route has change-log history', () => {
    const text = `driver_name,route_id,hire_date,am_time
Someone,S 20,2011-01-01,6:35-8:55
`;
    const preview = previewBulkImport(text, {
      drivers: [],
      routeState: {
        'S 20': {
          driver_name: 'Old',
          status: 'STABLE',
          segments: { AM: '6:00-7:00', MIDDAY: null, PM: null },
          baseline_segments: { AM: '6:00-7:00', MIDDAY: null, PM: null },
          window_opened_date: null,
          window_expires_date: null,
          cumulative_drift_minutes: 0,
          contributing_change_ids: ['c1'],
          payroll_rounded_total_minutes: null,
          last_updated: '2025-09-01T12:00:00.000Z',
        },
      },
      changeLog: [
        {
          id: 'c1',
          route_id: 'S 20',
          driver_name: 'Old',
          segment: 'AM',
          submitted_at: '2025-09-01T12:00:00.000Z',
          effective_date: '2025-09-01',
          previous_time: '6:00-7:00',
          new_time: '6:05-7:05',
          computed_delta_minutes: 0,
          delta_minutes: 0,
          routing_adjustment: null,
          reason_category: 'OTHER',
          note: 'x',
          entered_by: 'Admin',
        },
      ],
    });
    assert.equal(preview.conflicts[0].overwrite_allowed, false);
    assert.match(preview.conflicts[0].overwrite_blocked_reason, /history/);
  });
});

describe('bulkImport resolve + plan', () => {
  it('requires resolutions before accepting conflict rows', () => {
    const preview = previewBulkImport(
      `driver_name,route_id,hire_date,am_time
Jane Driver,NEW-9,2012-08-15,6:35-8:55
`,
      {
        drivers: [
          {
            driver_id: 'drv-jane',
            name: 'Jane Driver',
            email: null,
            hire_date: '2012-08-15',
            tie_break: null,
          },
        ],
        routeState: {},
        changeLog: [],
      }
    );
    assert.throws(
      () => resolveBulkImportPreview(preview, {}),
      /Resolve all conflicts/
    );
    const skipped = resolveBulkImportPreview(preview, { 1: 'skip' });
    assert.equal(skipped.accepted.length, 0);
    assert.deepEqual(skipped.skipped_row_numbers, [1]);

    const linked = resolveBulkImportPreview(preview, { 1: 'overwrite' });
    assert.equal(linked.accepted.length, 1);
    assert.equal(linked.summary.linked_existing_drivers_count, 1);
    assert.equal(linked.summary.new_routes_count, 1);
  });

  it('builds STABLE seeded routes and a single BULK_IMPORT event payload', () => {
    const preview = previewBulkImport(SAMPLE_CSV, {
      drivers: [],
      routeState: {},
      changeLog: [],
    });
    const resolved = resolveBulkImportPreview(preview, {});
    const writes = planBulkImportWrites(
      resolved.accepted,
      [],
      preview.conflicts
    );
    assert.equal(writes.createdDrivers.length, 2);
    assert.equal(writes.createdDrivers[0].hire_date, '2012-08-15');
    assert.equal(writes.routes.length, 2);
    assert.equal(writes.routes[0].entry.status, 'STABLE');
    assert.equal(writes.routes[0].entry.window_opened_date, null);
    assert.deepEqual(
      writes.routes[0].entry.segments,
      writes.routes[0].entry.baseline_segments
    );
    assert.equal(writes.routes[0].entry.segments.AM, '6:35-8:55');
    assert.equal(writes.routes[0].entry.segments.MIDDAY, null);

    const event = buildBulkImportEvent({
      createdDrivers: writes.createdDrivers,
      updatedDrivers: [],
      routes: writes.routes,
      skipped_row_numbers: [],
      entered_by: 'Rachel',
      note: '2026-27 roster seed',
      imported_at: '2026-07-12T12:00:00.000Z',
    });
    assert.equal(event.type, 'BULK_IMPORT');
    assert.equal(event.created_routes.length, 2);
    assert.equal(event.created_drivers.length, 2);
    assert.equal(event.created_drivers[0].hire_date, '2012-08-15');
    assert.equal(event.entered_by, 'Rachel');
    assert.ok(isBulkImportEvent(event));
    assert.equal(isChangeEvent(event), false);
  });

  it('dedupes the same new driver across multiple routes in one batch', () => {
    const text = `driver_name,route_id,hire_date,am_time
Sam Same,R-A,2014-05-01,6:00-7:00
Sam Same,R-B,,7:00-8:00
`;
    const preview = previewBulkImport(text, {
      drivers: [],
      routeState: {},
      changeLog: [],
    });
    assert.equal(preview.summary.new_drivers_count, 1);
    assert.equal(preview.summary.new_routes_count, 2);
    const resolved = resolveBulkImportPreview(preview, {});
    const writes = planBulkImportWrites(resolved.accepted, [], []);
    assert.equal(writes.createdDrivers.length, 1);
    assert.equal(writes.createdDrivers[0].hire_date, '2014-05-01');
    assert.equal(writes.routes[0].entry.driver_id, writes.routes[1].entry.driver_id);
  });

  it('leaves tie_break null and flags same-date seniority ties for later resolve', () => {
    const text = `driver_name,route_id,hire_date,am_time
First,R-1,2018-09-01,6:00-7:00
Second,R-2,2018-09-01,7:00-8:00
`;
    const preview = previewBulkImport(text, {
      drivers: [],
      routeState: {},
      changeLog: [],
    });
    assert.equal(preview.unresolved_seniority_ties.length, 1);
    assert.equal(preview.unresolved_seniority_ties[0].hire_date, '2018-09-01');
    assert.equal(preview.unresolved_seniority_ties[0].drivers.length, 2);
    const resolved = resolveBulkImportPreview(preview, {});
    const writes = planBulkImportWrites(resolved.accepted, [], []);
    assert.equal(writes.createdDrivers.length, 2);
    assert.ok(writes.createdDrivers.every((d) => d.tie_break == null));
  });
});

describe('buildSeededRouteState', () => {
  it('mirrors create-new-route seed shape without opening a window', () => {
    const entry = buildSeededRouteState({
      driver_name: 'Pat',
      driver_id: 'drv-pat',
      segments: { AM: '6:00-7:00', MIDDAY: null, PM: '2:00-3:00' },
      last_updated: '2026-07-12T00:00:00.000Z',
    });
    assert.equal(entry.status, 'STABLE');
    assert.equal(entry.window_expires_date, null);
    assert.equal(entry.cumulative_drift_minutes, 0);
    assert.deepEqual(entry.contributing_change_ids, []);
  });
});
