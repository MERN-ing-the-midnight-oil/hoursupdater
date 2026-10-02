import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recentRouteChanges } from '../office-tracker/src/recentChanges.js';

function entry(overrides) {
  return {
    id: 'change-1',
    segment: 'AM',
    submitted_at: '2026-09-11T15:00:00.000Z',
    effective_date: '2026-09-11',
    previous_time: '6:10-8:40',
    new_time: '6:10-8:55',
    delta_minutes: 15,
    note: 'AM traffic',
    entered_by: 'Rachel Smith',
    entered_by_user_id: 'user-1',
    ...overrides,
  };
}

describe('recent route changes', () => {
  it('lists clock-time changes newest first, with the route, times, and user', () => {
    const changes = recentRouteChanges({
      profiles: {
        s1: {
          id: 'route-s1',
          name: 'S1',
          changeLog: [
            entry({
              id: 'seed',
              previous_time: '6:10-8:40',
              new_time: '6:10-8:40',
              delta_minutes: 0,
              note: 'Starting schedule',
              entered_by: 'S1',
              submitted_at: '2026-09-08T12:00:00.000Z',
            }),
            entry({ id: 'older', submitted_at: '2026-09-11T15:00:00.000Z' }),
          ],
        },
        s2: {
          id: 'route-s2',
          name: 'S2',
          changeLog: [
            entry({
              id: 'newest',
              segment: 'PM',
              submitted_at: '2026-09-22T18:04:00.000Z',
              effective_date: '2026-09-22',
              previous_time: '14:05-16:30',
              new_time: '14:05-16:45',
              note: 'PM run extended',
              entered_by: 'Chris Lee',
            }),
          ],
        },
      },
    });

    assert.deepEqual(
      changes.map((item) => item.id),
      ['newest', 'older']
    );
    assert.deepEqual(changes[0], {
      id: 'newest',
      routeId: 'route-s2',
      routeName: 'S2',
      segment: 'PM',
      segmentLabel: 'PM',
      previousTime: '14:05-16:30',
      newTime: '14:05-16:45',
      effectiveDate: '2026-09-22',
      submittedAt: '2026-09-22T18:04:00.000Z',
      enteredBy: 'Chris Lee',
      note: 'PM run extended',
    });
  });

  it('labels midday runs and leaves the user blank when no account was stored', () => {
    const [change] = recentRouteChanges({
      profiles: {
        s3: {
          id: 'route-s3',
          name: 'S3',
          changeLog: [
            entry({
              segment: 'MIDDAY',
              entered_by: 'S3',
              note: 'S3',
            }),
            entry({
              id: 'blank',
              entered_by: '   ',
              note: '',
              submitted_at: '2026-09-01T15:00:00.000Z',
            }),
          ],
        },
      },
    });

    assert.equal(change.segmentLabel, 'Midday');
    assert.equal(change.enteredBy, '');
    assert.equal(change.note, '');
  });

  it('returns nothing when the office has no profiles', () => {
    assert.deepEqual(recentRouteChanges(null), []);
    assert.deepEqual(recentRouteChanges({ profiles: {} }), []);
  });
});
