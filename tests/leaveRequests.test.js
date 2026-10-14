import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clockInHasPassed,
  contractedRunMinutes,
  driverClockedIn,
  dropLeaveForClockIn,
  leaveContractLead,
  leaveFor,
  leaveMinutesFromParts,
  leaveRequestLead,
  normalizeLeaveRequests,
  runsAwaitingLeave,
  saveLeaveRequest,
} from '../office-tracker/src/leaveRequests.js';
import { loadState, saveState } from '../office-tracker/web/store.js';

const driver = 'Alex Driver';

function request(overrides = {}) {
  return {
    id: 'leave-1',
    driver_name: driver,
    date: '2026-10-14',
    run: 'AM',
    minutes: 140,
    requested_at: '2026-10-14T15:00:00.000Z',
    ...overrides,
  };
}

describe('leave requests', () => {
  it('keeps one request per driver, day, and route', () => {
    const saved = normalizeLeaveRequests([
      request({ minutes: 140, requested_at: '2026-10-14T15:00:00.000Z' }),
      request({ id: 'leave-2', minutes: 90, requested_at: '2026-10-14T16:00:00.000Z' }),
      request({ id: 'leave-3', run: 'PM', minutes: 150 }),
      { id: '', driver_name: driver, date: '2026-10-14', run: 'AM', minutes: 60 },
    ]);
    assert.equal(saved.length, 2);
    assert.equal(leaveFor(saved, driver, '2026-10-14', 'AM')?.minutes, 90);
    assert.equal(leaveFor(saved, driver, '2026-10-14', 'PM')?.minutes, 150);
  });

  it('saves the contracted time, or a lesser amount', () => {
    const full = saveLeaveRequest([], {
      id: 'leave-1',
      driver_name: driver,
      date: '2026-10-20',
      run: 'MIDDAY',
      minutes: 75,
      contractedMinutes: 75,
      requested_at: '2026-10-14T15:00:00.000Z',
    });
    assert.equal(full[0].run, 'MIDDAY');
    assert.equal(full[0].minutes, 75);
    const less = saveLeaveRequest(full, {
      driver_name: driver,
      date: '2026-10-20',
      run: 'MIDDAY',
      minutes: 60,
      contractedMinutes: 75,
      requested_at: '2026-10-14T16:00:00.000Z',
    });
    assert.equal(less.length, 1);
    assert.equal(less[0].id, 'leave-1');
    assert.equal(less[0].minutes, 60);
    assert.throws(
      () =>
        saveLeaveRequest([], {
          driver_name: driver,
          date: '2026-10-20',
          run: 'AM',
          minutes: 150,
          contractedMinutes: 140,
        }),
      /more than the contracted time/
    );
  });

  it('rejects leave after a clock-in, and drops leave when the driver clocks in', () => {
    const local = [
      {
        id: 'in',
        driver_name: driver,
        action: 'in',
        run: 'AM',
        punched_at: new Date(2026, 9, 14, 6, 35).toISOString(),
      },
    ];
    assert.equal(driverClockedIn(local, driver, '2026-10-14', 'AM'), true);
    assert.equal(driverClockedIn(local, driver, '2026-10-14', 'PM'), false);
    assert.throws(
      () =>
        saveLeaveRequest([], {
          driver_name: driver,
          date: '2026-10-14',
          run: 'AM',
          minutes: 140,
          contractedMinutes: 140,
          punches: local,
        }),
      /already clocked in/
    );
    const dropped = dropLeaveForClockIn([request()], {
      driver_name: driver,
      date: '2026-10-14',
      run: 'AM',
    });
    assert.deepEqual(dropped, []);
  });

  it('asks for hours when a route clock-in has passed and the driver never clocked in', () => {
    const now = new Date(2026, 9, 14, 11, 5);
    assert.equal(clockInHasPassed('6:35', now), true);
    assert.equal(clockInHasPassed('11:05', now), false);
    assert.deepEqual(
      runsAwaitingLeave({
        clockByRun: { AM: '6:35', MIDDAY: '11:05', PM: '14:10' },
        punches: [],
        requests: [],
        driverName: driver,
        now,
      }),
      ['AM']
    );
    assert.deepEqual(
      runsAwaitingLeave({
        clockByRun: { AM: '6:35' },
        punches: [{ driver_name: driver, action: 'in', run: 'AM', punched_at: new Date(2026, 9, 14, 6, 40).toISOString() }],
        driverName: driver,
        now,
      }),
      []
    );
    assert.match(leaveRequestLead({ run: 'AM', date: '2026-10-14', today: '2026-10-14' }), /did not clock in for the AM route/);
    assert.match(leaveRequestLead({ run: 'PM', date: '2026-10-20', today: '2026-10-14' }), /hours of leave requested for the PM route/);
    assert.match(leaveContractLead(140), /2 hr 20 min/);
    assert.equal(leaveMinutesFromParts('2', '20'), 140);
    assert.equal(leaveMinutesFromParts('0', '0'), null);
  });

  it('keeps a leave request an older save stored only on the driver', () => {
    const storage = {
      /** @type {Map<string, string>} */
      data: new Map(),
      getItem(key) {
        return this.data.get(key) ?? null;
      },
      setItem(key, value) {
        this.data.set(key, String(value));
      },
    };
    saveState(
      {
        version: 1,
        profiles: {},
        drivers: [
          {
            id: 'driver-alex',
            name: driver,
            leaveRequests: [request({ minutes: 90 })],
          },
        ],
        punches: [],
      },
      storage
    );
    const loaded = loadState(storage);
    assert.equal(loaded.leaveRequests[0].minutes, 90);
    assert.equal(loaded.drivers[0].leaveRequests[0].run, 'AM');
    const raw = JSON.parse(storage.getItem('transportation-timechange.v1'));
    delete raw.leaveRequests;
    storage.setItem('transportation-timechange.v1', JSON.stringify(raw));
    const survived = loadState(storage);
    assert.equal(survived.leaveRequests[0].minutes, 90);
    assert.equal(survived.drivers[0].leaveRequests[0].minutes, 90);
  });

  it('uses the first assigned route for each run', () => {
    const profiles = {
      later: {
        name: '20',
        assignments: [{ driver_name: driver, from: '2026-10-01', until: null }],
      },
      first: {
        name: '4',
        assignments: [{ driver_name: driver, from: '2026-09-08', until: null }],
      },
    };
    const minutes = contractedRunMinutes(profiles, driver, '2026-10-14', (profile) =>
      profile.name === '4'
        ? { AM: '6:35-8:55', MIDDAY: null, PM: '14:10-16:40' }
        : { AM: '7:00-9:00', MIDDAY: '11:00-12:15', PM: '14:00-16:00' }
    );
    assert.deepEqual(minutes, { AM: 140, MIDDAY: 75, PM: 150 });
  });
});
