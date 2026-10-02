import { computeDeltaMinutes } from '../../src/logic/timeUtils.js';
import { EMPLOYEE_ROUTE_ID } from '../../employee-tracker/src/snapshot.js';
import { loadState, saveState } from './store.js';

const START = '2026-09-08';
const EXAMPLE_VERSION = 4;

const EXAMPLE_DRIVERS = [
  { id: 'driver-jean-luc-picard', name: 'Jean-Luc Picard', phone: '617-555-0101', email: 'jean-luc.picard@example.com' },
  { id: 'driver-william-riker', name: 'William Riker', phone: '617-555-0102', email: 'william.riker@example.com' },
  { id: 'driver-data', name: 'Data', phone: '617-555-0103', email: 'data@example.com' },
  { id: 'driver-geordi-la-forge', name: 'Geordi La Forge', phone: '617-555-0104', email: 'geordi.la.forge@example.com' },
  { id: 'driver-beverly-crusher', name: 'Beverly Crusher', phone: '617-555-0105', email: 'beverly.crusher@example.com' },
  { id: 'driver-deanna-troi', name: 'Deanna Troi', phone: '617-555-0106', email: 'deanna.troi@example.com' },
  { id: 'driver-worf', name: 'Worf', phone: '617-555-0107', email: 'worf@example.com' },
  { id: 'driver-wesley-crusher', name: 'Wesley Crusher', phone: '617-555-0108', email: 'wesley.crusher@example.com' },
];
const EXAMPLE_IDS = new Set([
  'route-s1',
  'route-s2',
  'route-s3',
  'route-s4',
  'route-s5',
  'route-s6',
  'route-s7',
  'route-s8',
  'route-12',
  'route-47',
  'route-76',
  'route-88',
  'route-104',
  'route-118',
  'route-209',
  'route-p32',
]);

/**
 * @param {string} routeId
 * @param {string} driver
 * @param {string} segment
 * @param {string} range
 * @param {number} index
 */
function seed(routeId, driver, segment, range, index) {
  return change(routeId, driver, {
    id: `${routeId}-start-${segment.toLowerCase()}`,
    segment,
    previous: range,
    next: range,
    date: START,
    note: 'Starting schedule',
    submitted_at: `2026-09-08T12:00:00.${String(index).padStart(3, '0')}Z`,
  });
}

/**
 * @param {string} routeId
 * @param {string} driver
 * @param {{ id?: string, segment: string, previous: string, next: string, date: string, note: string, submitted_at?: string }} input
 */
function change(routeId, driver, input) {
  const delta = computeDeltaMinutes(input.previous, input.next);
  return {
    id: input.id || `${routeId}-${input.date}-${input.segment.toLowerCase()}`,
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: driver,
    driver_id: null,
    segment: input.segment,
    submitted_at: input.submitted_at || `${input.date}T15:00:00.000Z`,
    effective_date: input.date,
    previous_time: input.previous,
    new_time: input.next,
    computed_delta_minutes: delta,
    delta_minutes: delta,
    routing_adjustment: null,
    reason_category: 'OTHER',
    note: input.note,
    entered_by: driver,
  };
}

/**
 * @param {string} id
 * @param {string} name
 * @param {string} driver
 * @param {Array<[string, string]>} starts
 * @param {object[]} changes
 */
function route(id, name, driver, starts, changes) {
  return {
    id,
    name,
    driver_name: driver,
    start_date: START,
    setup_at: '2026-09-08T12:00:00.000Z',
    created_at: '2026-09-08T12:00:00.000Z',
    changeLog: [
      ...starts.map(([segment, range], index) => seed(id, driver, segment, range, index)),
      ...changes.map((item) => change(id, driver, item)),
    ],
  };
}

/** Fictional office routes for an empty browser, as of late September 2026. */
export function exampleOfficeState() {
  const routes = [
    route(
      'route-s1',
      'S1',
      'Jean-Luc Picard',
      [
        ['AM', '6:10-8:40'],
        ['MIDDAY', '10:50-12:05'],
        ['PM', '13:50-16:15'],
      ],
      [
        {
          segment: 'AM',
          previous: '6:10-8:40',
          next: '6:10-8:55',
          date: '2026-09-11',
          note: 'AM traffic added 15 minutes.',
        },
        {
          segment: 'PM',
          previous: '13:50-16:15',
          next: '13:50-16:30',
          date: '2026-09-18',
          note: 'PM dismissal moved 15 minutes later.',
        },
      ]
    ),
    route(
      'route-s2',
      'S2',
      'William Riker',
      [
        ['AM', '6:25-8:55'],
        ['MIDDAY', '11:05-12:20'],
        ['PM', '14:05-16:30'],
      ],
      [
        {
          segment: 'AM',
          previous: '6:25-8:55',
          next: '6:25-9:10',
          date: '2026-09-15',
          note: 'Added a stop on Blue Hill Ave for a new kindergarten.',
        },
        {
          segment: 'MIDDAY',
          previous: '11:05-12:20',
          next: '11:05-12:35',
          date: '2026-09-18',
          note: 'Midday added one more school.',
        },
        {
          segment: 'PM',
          previous: '14:05-16:30',
          next: '14:05-16:45',
          date: '2026-09-22',
          note: 'PM run extended 15 minutes.',
        },
      ]
    ),
    route(
      'route-s3',
      'S3',
      'Data',
      [
        ['AM', '6:40-9:00'],
        ['PM', '14:20-16:50'],
      ],
      [
        {
          segment: 'PM',
          previous: '14:20-16:50',
          next: '14:20-16:30',
          date: '2026-09-16',
          note: 'One PM student moved to another route.',
        },
        {
          segment: 'AM',
          previous: '6:40-9:00',
          next: '6:40-9:15',
          date: '2026-09-10',
          note: 'AM bell moved 15 minutes later.',
        },
        {
          segment: 'AM',
          previous: '6:40-9:15',
          next: '6:30-9:15',
          date: '2026-09-22',
          note: 'AM clock-in moved 10 minutes earlier.',
        },
      ]
    ),
    route(
      'route-s4',
      'S4',
      'Geordi La Forge',
      [
        ['AM', '6:15-8:45'],
        ['MIDDAY', '11:00-12:30'],
        ['PM', '14:10-16:40'],
      ],
      [
        {
          segment: 'AM',
          previous: '6:15-8:45',
          next: '6:15-9:25',
          date: '2026-09-09',
          note: 'Extra AM school added; run grew by 40 minutes.',
        },
        {
          segment: 'MIDDAY',
          previous: '11:00-12:30',
          next: '11:00-12:45',
          date: '2026-09-14',
          note: 'Midday pickup added 15 minutes.',
        },
        {
          segment: 'PM',
          previous: '14:10-16:40',
          next: '14:10-16:55',
          date: '2026-09-21',
          note: 'PM route grew by 15 minutes.',
        },
      ]
    ),
    route(
      'route-s5',
      'S5',
      'Beverly Crusher',
      [
        ['AM', '6:00-8:20'],
        ['PM', '13:40-16:10'],
      ],
      [
        {
          segment: 'PM',
          previous: '13:40-16:10',
          next: '13:40-15:25',
          date: '2026-09-10',
          note: 'PM school closed its late program. Written decrease of 45 minutes.',
        },
        {
          segment: 'AM',
          previous: '6:00-8:20',
          next: '6:00-8:35',
          date: '2026-09-15',
          note: 'AM added a stop.',
        },
        {
          segment: 'AM',
          previous: '6:00-8:35',
          next: '6:00-8:50',
          date: '2026-09-22',
          note: 'Same AM stop took another 15 minutes.',
        },
      ]
    ),
    route(
      'route-s6',
      'S6',
      'Deanna Troi',
      [
        ['AM', '6:30-8:50'],
        ['PM', '14:00-16:20'],
      ],
      [
        {
          segment: 'AM',
          previous: '6:30-8:50',
          next: '6:30-9:00',
          date: '2026-09-11',
          note: 'Traffic pattern on Columbia Road added 10 minutes.',
        },
        {
          segment: 'AM',
          previous: '6:30-9:00',
          next: '6:30-9:12',
          date: '2026-09-18',
          note: 'Same AM run extended another 12 minutes.',
        },
        {
          segment: 'PM',
          previous: '14:00-16:20',
          next: '14:00-16:35',
          date: '2026-09-22',
          note: 'PM dismissal moved 15 minutes later.',
        },
      ]
    ),
    route(
      'route-s7',
      'S7',
      'Worf',
      [
        ['AM', '6:05-8:35'],
        ['MIDDAY', '10:40-12:10'],
        ['PM', '13:55-16:25'],
      ],
      [
        {
          segment: 'AM',
          previous: '6:05-8:35',
          next: '6:05-8:55',
          date: '2026-09-10',
          note: 'AM bell moved later by 20 minutes.',
        },
        {
          segment: 'AM',
          previous: '6:05-8:55',
          next: '6:05-9:10',
          date: '2026-09-22',
          note: 'A second AM stop added 15 more minutes.',
        },
        {
          segment: 'MIDDAY',
          previous: '10:40-12:10',
          next: '10:40-12:25',
          date: '2026-09-16',
          note: 'Midday added 15 minutes.',
        },
        {
          segment: 'PM',
          previous: '13:55-16:25',
          next: '13:55-16:10',
          date: '2026-09-23',
          note: 'One PM stop came off the route.',
        },
      ]
    ),
    route(
      'route-s8',
      'S8',
      'Wesley Crusher',
      [
        ['AM', '6:50-9:05'],
        ['MIDDAY', '11:15-12:30'],
        ['PM', '14:25-16:45'],
      ],
      [
        {
          segment: 'AM',
          previous: '6:50-9:05',
          next: '6:50-9:20',
          date: '2026-09-11',
          note: 'AM run grew by 15 minutes.',
        },
        {
          segment: 'PM',
          previous: '14:25-16:45',
          next: '14:25-17:00',
          date: '2026-09-17',
          note: 'PM clock-out moved 15 minutes later.',
        },
        {
          segment: 'MIDDAY',
          previous: '11:15-12:30',
          next: '11:15-12:45',
          date: '2026-09-24',
          note: 'Midday preschool added one more pickup today.',
        },
      ]
    ),
  ];
  return {
    version: 1,
    currentProfileId: 'route-s1',
    profiles: Object.fromEntries(routes.map((item) => [item.id, item])),
    drivers: EXAMPLE_DRIVERS,
    exampleVersion: EXAMPLE_VERSION,
  };
}

const LEGACY_ROUTE_NAMES = {
  '12': 'S1',
  '47': 'S2',
  '88': 'S3',
  '104': 'S4',
  '118': 'S5',
  P32: 'S6',
  '209': 'S7',
  '76': 'S8',
};

const LEGACY_DRIVER_NAMES = {
  'priya raman': 'Jean-Luc Picard',
  'marcus ellison': 'William Riker',
  'elena voss': 'Data',
  'andre cole': 'Geordi La Forge',
  'samira okonkwo': 'Beverly Crusher',
  'jordan hale': 'Deanna Troi',
  'chris nguyen': 'Worf',
  'riley cho': 'Wesley Crusher',
};

/**
 * @param {string} name
 */
function legacyDriver(name) {
  const next = LEGACY_DRIVER_NAMES[String(name ?? '').trim().toLowerCase()];
  if (!next) return null;
  return EXAMPLE_DRIVERS.find((driver) => driver.name === next) ?? null;
}

/**
 * @param {unknown} value
 */
function rewriteLegacyPeople(value) {
  let text = String(value ?? '');
  const direct = legacyDriver(text);
  if (direct) return direct.name;
  for (const [legacy, name] of Object.entries(LEGACY_DRIVER_NAMES)) {
    const pattern = new RegExp(legacy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    text = text.replace(pattern, name);
  }
  return text;
}

/**
 * Rename the previous sample office in place. Clock times stay put.
 * Returns null when this is not that office.
 * @param {object} state
 */
export function migrateLegacyExampleOffice(state) {
  const profiles = Object.values(state?.profiles ?? {});
  const names = profiles.map((profile) => String(profile?.name ?? '').trim());
  const legacyNames = new Set(Object.keys(LEGACY_ROUTE_NAMES));
  if (!names.length || names.length !== legacyNames.size || names.some((name) => !legacyNames.has(name))) {
    return null;
  }
  const next = structuredClone(state);
  next.exampleVersion = EXAMPLE_VERSION;
  if (Array.isArray(next.drivers)) {
    next.drivers = next.drivers.map((driver) => legacyDriver(driver?.name) ?? driver);
  }
  for (const profile of Object.values(next.profiles ?? {})) {
    profile.name = LEGACY_ROUTE_NAMES[String(profile.name ?? '').trim()] || profile.name;
    profile.driver_name = rewriteLegacyPeople(profile.driver_name);
    if (Array.isArray(profile.assignments)) {
      for (const item of profile.assignments) {
        item.driver_name = rewriteLegacyPeople(item.driver_name);
      }
    }
    for (const entry of profile.changeLog ?? []) {
      entry.driver_name = rewriteLegacyPeople(entry.driver_name);
      entry.entered_by = rewriteLegacyPeople(entry.entered_by);
      entry.note = rewriteLegacyPeople(entry.note);
    }
  }
  return next;
}

/**
 * True when this browser has no routes yet, or only the fictional sample routes.
 * @param {{ profiles?: Record<string, object> } | null | undefined} state
 */
export function isSampleOffice(state) {
  if (state?.exampleVersion === EXAMPLE_VERSION) return true;
  const ids = Object.keys(state?.profiles ?? {});
  return !ids.length || ids.every((id) => EXAMPLE_IDS.has(id));
}

/**
 * Fill an empty browser with the fictional office routes.
 * An office that is still the previous sample is renamed to S1–S8.
 * Any other saved office is left alone.
 * @param {Storage} [storage]
 */
export function ensureExampleRoutes(storage) {
  const state = loadState(storage);
  const migrated = migrateLegacyExampleOffice(state);
  if (migrated) {
    saveState(migrated, storage);
    return migrated;
  }
  const ids = Object.keys(state.profiles ?? {});
  const onlyExamples = ids.every((id) => EXAMPLE_IDS.has(id));
  if (ids.length && (state.exampleVersion === EXAMPLE_VERSION || !onlyExamples)) {
    return state;
  }
  const next = exampleOfficeState();
  saveState(next, storage);
  return next;
}
