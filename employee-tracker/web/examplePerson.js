import { computeDeltaMinutes } from '../../src/logic/timeUtils.js';
import { EMPLOYEE_ROUTE_ID } from '../src/snapshot.js';
import { getCurrentProfile, loadState, saveState } from './store.js';

/** Stable id so a reload does not create a second copy. */
export const EXAMPLE_PROFILE_ID = 'example-morgan-hale';

/** Set after these examples have been offered once. Deleting a person keeps them gone. */
export const EXAMPLE_SEEDED_KEY = 'my-hours-tracker.example-seeded.v4';

/** Older seed flags. A deleted example stays deleted when the story is refreshed. */
const PRIOR_EXAMPLE_SEEDED_KEYS = ['my-hours-tracker.example-seeded.v3'];

const NAME = 'Morgan Hale (example)';
const START = '2026-09-08';

/**
 * @param {object} input
 */
function change(input) {
  const delta = computeDeltaMinutes(input.previous_time, input.new_time);
  return {
    id: input.id,
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: NAME,
    driver_id: null,
    segment: input.segment,
    submitted_at: input.submitted_at,
    effective_date: input.effective_date,
    previous_time: input.previous_time,
    new_time: input.new_time,
    computed_delta_minutes: delta,
    delta_minutes: delta,
    routing_adjustment: null,
    reason_category: 'OTHER',
    note: input.note,
    entered_by: NAME,
  };
}

/**
 * @param {string} segment
 * @param {string} range
 * @param {string} submittedAt
 */
function seed(segment, range, submittedAt) {
  return change({
    id: `example-seed-${segment.toLowerCase()}`,
    segment,
    previous_time: range,
    new_time: range,
    submitted_at: submittedAt,
    effective_date: START,
    note: 'Starting schedule',
  });
}

/** The calendar treats this day as today for Morgan Hale. */
export const EXAMPLE_VIEW_AS_OF = '2026-11-16';

/**
 * Fictional driver viewed as of Mon, Nov 16, 2026.
 * September shows a same-day bump, then a small window that locks on October 1.
 * October 6 adds 15 minutes and locks in on October 29.
 * November 2 adds 12 minutes, and November 9 adds 18 more (12 + 18 = 30).
 * On November 16 that countdown is on school day 4 and points at the December 17 bid.
 */
export function exampleProfile() {
  return {
    id: EXAMPLE_PROFILE_ID,
    name: NAME,
    start_date: START,
    setup_at: '2026-09-08T12:00:00.000Z',
    created_at: '2026-09-08T12:00:00.000Z',
    example: true,
    view_as_of: EXAMPLE_VIEW_AS_OF,
    changeLog: [
      seed('AM', '6:15-8:45', '2026-09-08T12:00:00.000Z'),
      seed('MIDDAY', '11:00-12:15', '2026-09-08T12:00:00.001Z'),
      seed('PM', '14:10-16:40', '2026-09-08T12:00:00.002Z'),
      change({
        id: 'example-am-decrease',
        segment: 'AM',
        previous_time: '6:15-8:45',
        new_time: '6:15-8:10',
        submitted_at: '2026-09-09T15:00:00.000Z',
        effective_date: '2026-09-09',
        note: 'AM clock-out moved earlier. Thirty-five minutes taken off before October 1, so this is bump-eligible the day it is written.',
      }),
      change({
        id: 'example-pm-increase',
        segment: 'PM',
        previous_time: '14:10-16:40',
        new_time: '13:58-16:40',
        submitted_at: '2026-09-15T15:00:00.000Z',
        effective_date: '2026-09-15',
        note: 'PM clock-in moved earlier. Twelve minutes added. A later change in this window replaced it.',
      }),
      change({
        id: 'example-midday-decrease',
        segment: 'MIDDAY',
        previous_time: '11:00-12:15',
        new_time: '11:00-12:07',
        submitted_at: '2026-09-18T15:00:00.000Z',
        effective_date: '2026-09-18',
        note: 'Midday clock-out moved earlier. Eight minutes taken off and added to the open window. The total stays under 30 minutes, so it waits until October 1.',
      }),
      change({
        id: 'example-oct-am-increase',
        segment: 'AM',
        previous_time: '6:15-8:10',
        new_time: '6:15-8:25',
        submitted_at: '2026-10-06T15:00:00.000Z',
        effective_date: '2026-10-06',
        note: 'Fifteen minutes added after October 1. Count 15 school days, then the new times become contracted on October 29.',
      }),
      change({
        id: 'example-nov-pm-increase',
        segment: 'PM',
        previous_time: '13:58-16:40',
        new_time: '13:46-16:40',
        submitted_at: '2026-11-02T15:00:00.000Z',
        effective_date: '2026-11-02',
        note: 'Twelve minutes added in November. The next change resets this count.',
      }),
      change({
        id: 'example-nov-midday-increase',
        segment: 'MIDDAY',
        previous_time: '11:00-12:07',
        new_time: '11:00-12:25',
        submitted_at: '2026-11-09T15:00:00.000Z',
        effective_date: '2026-11-09',
        note: 'Eighteen more minutes. 12 + 18 = 30, so this is a 30-minute increase. On November 16 the count is on school day 4. The bid waits for December 17.',
      }),
    ],
  };
}

/**
 * One route, AM 6:00–8:00 and PM 2:00–4:00, plus the listed clock changes.
 * @param {{ id: string, name: string, changes: { id: string, segment: string, date: string, new_time: string, note: string }[] }} input
 */
function scenarioProfile(input) {
  /** @type {Record<string, string>} */
  const running = { AM: '6:00-8:00', PM: '14:00-16:00' };
  const changeLog = ['AM', 'PM'].map((segment, index) =>
    changeFor(input.name, {
      id: `${input.id}-seed-${segment.toLowerCase()}`,
      segment,
      date: START,
      previous_time: running[segment],
      new_time: running[segment],
      submitted_at: `2026-09-08T12:00:00.00${index}Z`,
      note: 'Starting schedule',
    })
  );
  input.changes.forEach((item, index) => {
    const previous = running[item.segment];
    running[item.segment] = item.new_time;
    changeLog.push(
      changeFor(input.name, {
        id: item.id,
        segment: item.segment,
        date: item.date,
        previous_time: previous,
        new_time: item.new_time,
        submitted_at: `${item.date}T15:00:0${index}.000Z`,
        note: item.note,
      })
    );
  });
  return {
    id: input.id,
    name: input.name,
    start_date: START,
    setup_at: '2026-09-08T12:00:00.000Z',
    created_at: '2026-09-08T12:00:00.000Z',
    example: true,
    changeLog,
  };
}

/**
 * @param {string} name
 * @param {{ id: string, segment: string, date: string, previous_time: string, new_time: string, submitted_at: string, note: string }} item
 */
function changeFor(name, item) {
  const delta = computeDeltaMinutes(item.previous_time, item.new_time);
  return {
    id: item.id,
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: name,
    driver_id: null,
    segment: item.segment,
    submitted_at: item.submitted_at,
    effective_date: item.date,
    previous_time: item.previous_time,
    new_time: item.new_time,
    computed_delta_minutes: delta,
    delta_minutes: delta,
    routing_adjustment: null,
    reason_category: 'OTHER',
    note: item.note,
    entered_by: name,
  };
}

/**
 * Separate people so each calendar shows one contract pattern.
 * November and December patterns are meant to be viewed on December 10:
 * ?as_of=2026-12-10
 */
export function calendarExampleProfiles() {
  return [
    scenarioProfile({
      id: 'example-before-small',
      name: 'Ex before · small +12',
      changes: [
        {
          id: 'before-small',
          segment: 'AM',
          date: '2026-09-10',
          new_time: '5:48-8:00',
          note: 'Twelve minutes added before October 1. Under 30, so this waits until October 1. No 15-day count.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-before-big-up',
      name: 'Ex before · big +35',
      changes: [
        {
          id: 'before-big-up',
          segment: 'AM',
          date: '2026-09-08',
          new_time: '5:25-8:00',
          note: 'Thirty-five minutes added on the first day. The 15 school days finish September 29, before October 1, so the route goes up for bid on September 30.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-before-big-down',
      name: 'Ex before · big −35',
      changes: [
        {
          id: 'before-big-down',
          segment: 'AM',
          date: '2026-09-09',
          new_time: '6:35-8:00',
          note: 'Thirty-five minutes taken off before October 1. Bump-eligible that same day. No 15-day count.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-before-add-up',
      name: 'Ex before · +12 then +25',
      changes: [
        {
          id: 'before-add-1',
          segment: 'AM',
          date: '2026-09-09',
          new_time: '5:48-8:00',
          note: 'Twelve minutes added. A later change in this window replaces it.',
        },
        {
          id: 'before-add-2',
          segment: 'PM',
          date: '2026-09-16',
          new_time: '13:35-16:00',
          note: 'Twenty-five more minutes. 12 + 25 = 37, so this is now a 30-minute increase. The 15 school days run past October 1, so the bid waits for the last five school days of October.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-after-small',
      name: 'Ex after · small +15',
      changes: [
        {
          id: 'after-small',
          segment: 'AM',
          date: '2026-10-06',
          new_time: '5:45-8:00',
          note: 'Fifteen minutes added after October 1. Count 15 school days, then the new times become contracted on the next school day. A 15-minute decrease uses this same calendar shape.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-after-big-up',
      name: 'Ex after · big +40',
      changes: [
        {
          id: 'after-big-up',
          segment: 'AM',
          date: '2026-10-06',
          new_time: '5:20-8:00',
          note: 'Forty minutes added after October 1. After 15 school days it is posted for bid. Day 15 is October 28, so the bid day is October 29, inside that month’s bid week.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-after-big-down',
      name: 'Ex after · big −40',
      changes: [
        {
          id: 'after-big-down',
          segment: 'AM',
          date: '2026-10-06',
          new_time: '6:40-8:00',
          note: 'Forty minutes taken off after October 1. Bump-eligible the day after the 15th school day, October 29. That day is not a contracted-hours box.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-after-add-up',
      name: 'Ex after · +12 then +20',
      changes: [
        {
          id: 'after-add-up-1',
          segment: 'AM',
          date: '2026-10-02',
          new_time: '5:48-8:00',
          note: 'Twelve minutes added. The next change resets this count.',
        },
        {
          id: 'after-add-up-2',
          segment: 'PM',
          date: '2026-10-08',
          new_time: '13:40-16:00',
          note: 'Twenty more minutes. 12 + 20 = 32, so this is a 30-minute increase. The bid is the last five school days of November, starting November 20.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-after-add-down',
      name: 'Ex after · −12 then −20',
      changes: [
        {
          id: 'after-add-down-1',
          segment: 'AM',
          date: '2026-10-02',
          new_time: '6:12-8:00',
          note: 'Twelve minutes taken off. The next change resets this count.',
        },
        {
          id: 'after-add-down-2',
          segment: 'PM',
          date: '2026-10-08',
          new_time: '14:20-16:00',
          note: 'Twenty more minutes taken off. 12 + 20 = 32 the other way, so this is a 30-minute decrease. Bump-eligible the day after school day 15, October 31. No contracted-hours box.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-nov-small',
      name: 'Ex Nov · small +15',
      changes: [
        {
          id: 'nov-small',
          segment: 'AM',
          date: '2026-11-02',
          new_time: '5:45-8:00',
          note: 'Fifteen minutes added in November. Count 15 school days, then the new times become contracted on November 25. A 15-minute decrease uses this same shape.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-nov-big-up',
      name: 'Ex Nov · big +40',
      changes: [
        {
          id: 'nov-big-up',
          segment: 'AM',
          date: '2026-11-09',
          new_time: '5:20-8:00',
          note: 'Forty minutes added November 9. School day 15 is December 3. The bid waits for December 17, the first day of December’s bid week.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-nov-big-down',
      name: 'Ex Nov · big −40',
      changes: [
        {
          id: 'nov-big-down',
          segment: 'AM',
          date: '2026-11-09',
          new_time: '6:40-8:00',
          note: 'Forty minutes taken off November 9. Bump-eligible December 4, the day after school day 15. No contracted-hours box.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-nov-add-up',
      name: 'Ex Nov · +12 then +20',
      changes: [
        {
          id: 'nov-add-up-1',
          segment: 'AM',
          date: '2026-11-02',
          new_time: '5:48-8:00',
          note: 'Twelve minutes added. The next change resets this count.',
        },
        {
          id: 'nov-add-up-2',
          segment: 'PM',
          date: '2026-11-09',
          new_time: '13:40-16:00',
          note: 'Twenty more minutes. 12 + 20 = 32, so this is a 30-minute increase. The arrow points at December 17.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-nov-add-down',
      name: 'Ex Nov · −12 then −20',
      changes: [
        {
          id: 'nov-add-down-1',
          segment: 'AM',
          date: '2026-11-02',
          new_time: '6:12-8:00',
          note: 'Twelve minutes taken off. The next change resets this count.',
        },
        {
          id: 'nov-add-down-2',
          segment: 'PM',
          date: '2026-11-09',
          new_time: '14:20-16:00',
          note: 'Twenty more minutes taken off. 12 + 20 = 32 the other way. Bump-eligible December 4. No contracted-hours box.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-dec-small',
      name: 'Ex Dec · small +15',
      changes: [
        {
          id: 'dec-small',
          segment: 'AM',
          date: '2026-12-01',
          new_time: '5:45-8:00',
          note: 'Fifteen minutes added December 1. On December 10 this count is still open. It becomes contracted December 23.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-dec-big-up',
      name: 'Ex Dec · big +40',
      changes: [
        {
          id: 'dec-big-up',
          segment: 'AM',
          date: '2026-12-01',
          new_time: '5:20-8:00',
          note: 'Forty minutes added December 1. School day 15 is December 22, so the bid day is December 23, inside December’s bid week.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-dec-big-down',
      name: 'Ex Dec · big −40',
      changes: [
        {
          id: 'dec-big-down',
          segment: 'AM',
          date: '2026-12-01',
          new_time: '6:40-8:00',
          note: 'Forty minutes taken off December 1. Bump-eligible December 23. No contracted-hours box.',
        },
      ],
    }),
    scenarioProfile({
      id: 'example-dec-add-up',
      name: 'Ex Dec · +12 then +25',
      changes: [
        {
          id: 'dec-add-up-1',
          segment: 'AM',
          date: '2026-12-01',
          new_time: '5:48-8:00',
          note: 'Twelve minutes added. The next change resets this count.',
        },
        {
          id: 'dec-add-up-2',
          segment: 'PM',
          date: '2026-12-07',
          new_time: '13:35-16:00',
          note: 'Twenty-five more minutes. 12 + 25 = 37. School day 15 is January 7, so the bid waits for January 25.',
        },
      ],
    }),
  ];
}

/** Morgan Hale plus one person for each calendar pattern. */
export function exampleProfiles() {
  return [exampleProfile(), ...calendarExampleProfiles()];
}

/**
 * Add the example people once, without replacing someone already selected.
 * @param {Storage} [storage]
 */
export function ensureExamplePerson(storage = globalThis.localStorage) {
  if (!storage || storage.getItem(EXAMPLE_SEEDED_KEY) === '1') {
    return getCurrentProfile(storage);
  }
  const alreadySeeded = PRIOR_EXAMPLE_SEEDED_KEYS.some(
    (key) => storage.getItem(key) === '1'
  );
  const state = loadState(storage);
  let changed = false;
  for (const profile of exampleProfiles()) {
    const existing = state.profiles[profile.id];
    if (!existing) {
      if (alreadySeeded) continue;
      state.profiles[profile.id] = profile;
      changed = true;
    } else if (existing.example) {
      state.profiles[profile.id] = profile;
      changed = true;
    }
  }
  if (!state.currentProfileId && state.profiles[EXAMPLE_PROFILE_ID]) {
    state.currentProfileId = EXAMPLE_PROFILE_ID;
  }
  if (changed) {
    saveState(state, storage);
  }
  storage.setItem(EXAMPLE_SEEDED_KEY, '1');
  return getCurrentProfile(storage);
}
