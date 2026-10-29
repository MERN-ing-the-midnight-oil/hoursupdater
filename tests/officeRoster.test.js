import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  currentSegments,
  driversWithSeniorityNumbers,
  normalizeOfficeRoster,
  rosterFromOfficeState,
} from '../src/logic/officeRoster.js';

describe('office roster', () => {
  it('keeps the clock times in effect on a date', () => {
    const segments = currentSegments(
      [
        {
          segment: 'AM',
          new_time: '6:30-8:30',
          effective_date: '2026-09-01',
          submitted_at: '2026-09-01T12:00:00.000Z',
        },
        {
          segment: 'PM',
          new_time: '14:00-16:30',
          effective_date: '2026-09-01',
          submitted_at: '2026-09-01T12:00:01.000Z',
        },
        {
          segment: 'AM',
          new_time: '6:45-8:45',
          effective_date: '2026-10-20',
          submitted_at: '2026-10-20T12:00:00.000Z',
        },
        {
          segment: 'MIDDAY',
          new_time: '11:00-12:00',
          effective_date: '2026-11-02',
          submitted_at: '2026-11-02T12:00:00.000Z',
        },
      ],
      '2026-10-22'
    );
    assert.deepEqual(segments, {
      AM: '6:45-8:45',
      MIDDAY: null,
      PM: '14:00-16:30',
    });
  });

  it('builds drivers, the routes they hold, and school notes', () => {
    const roster = rosterFromOfficeState(
      {
        drivers: [
          { id: 'd-ada', name: 'Ada Lovelace', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
          { id: 'd-grace', name: 'Grace Hopper', firstName: 'Grace', lastName: 'Hopper', email: '' },
        ],
        profiles: {
          r50: {
            name: '50',
            note: 'NH, SMS/NH, SMS',
            driver_name: 'Ada Lovelace',
            start_date: '2026-09-01',
            changeLog: [
              {
                segment: 'AM',
                new_time: '6:50-9:20',
                effective_date: '2026-09-01',
                submitted_at: '2026-09-01T12:00:00.000Z',
                delta_minutes: 0,
                previous_time: '6:50-9:20',
              },
              {
                segment: 'PM',
                new_time: '14:00-16:40',
                effective_date: '2026-09-01',
                submitted_at: '2026-09-01T12:00:01.000Z',
                delta_minutes: 0,
                previous_time: '14:00-16:40',
              },
            ],
          },
          r51: {
            name: '51',
            note: 'SB, SQHS/SB, SQHS',
            driver_name: 'Grace Hopper',
            start_date: '2026-09-01',
            assignments: [{ driver_name: 'Grace Hopper', from: '2026-09-01', until: null }],
            changeLog: [
              {
                segment: 'AM',
                new_time: '7:00-9:00',
                effective_date: '2026-09-01',
                submitted_at: '2026-09-01T12:00:00.000Z',
                delta_minutes: 0,
                previous_time: '7:00-9:00',
              },
            ],
          },
        },
      },
      '2026-10-22'
    );
    assert.deepEqual(
      roster.drivers.map((driver) => driver.name).sort(),
      ['Ada Lovelace', 'Grace Hopper']
    );
    assert.equal(roster.drivers.find((driver) => driver.name === 'Ada Lovelace').email, 'ada@example.com');
    assert.equal(roster.schedules.length, 2);
    assert.equal(roster.schedules[0].route_id, '50');
    assert.equal(roster.schedules[0].segments.AM, '6:50-9:20');
    assert.equal(roster.schedules[0].segments.PM, '14:00-16:40');
    assert.equal(roster.route_notes['51'], 'SB, SQHS/SB, SQHS');
  });

  it('drops a schedule whose driver is not on the roster', () => {
    const roster = normalizeOfficeRoster({
      drivers: [{ driver_id: 'd1', name: 'Ada Lovelace', email: 'ada@example.com' }],
      schedules: [
        { route_id: '50', driver_id: 'd1', segments: { AM: '6:50-9:20', MIDDAY: '', PM: '14:00-16:40' } },
        { route_id: '99', driver_id: 'missing', segments: { AM: '6:00-8:00' } },
      ],
      route_notes: { '50': 'NH, SMS/NH, SMS', '': 'skip' },
    });
    assert.equal(roster.drivers[0].seniority_number, null);
    assert.equal(roster.schedules.length, 1);
    assert.equal(roster.schedules[0].segments.MIDDAY, null);
    assert.deepEqual(roster.routeNotes, { '50': 'NH, SMS/NH, SMS' });
  });

  it('keeps an office seniority number and uses it as the rank', () => {
    const roster = normalizeOfficeRoster({
      drivers: [
        { driver_id: 'd1', name: 'Lauren Adcox', seniority_number: 47 },
        { driver_id: 'd2', name: 'Bob Blakeslee', seniority_number: 3 },
        { driver_id: 'd3', name: 'Charlie Lane' },
      ],
      schedules: [],
    });
    assert.equal(roster.drivers.find((driver) => driver.driver_id === 'd1').seniority_number, 47);
    const ranked = driversWithSeniorityNumbers(roster.drivers);
    assert.equal(ranked.find((driver) => driver.driver_id === 'd2').seniority_rank, 3);
    assert.equal(ranked.find((driver) => driver.driver_id === 'd1').seniority_rank, 47);
    assert.equal(ranked.find((driver) => driver.driver_id === 'd3').seniority_rank, null);
  });
});
