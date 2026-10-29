import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addIsoDays,
  clipInterval,
  contentAxis,
  freeWindows,
  subtractIntervals,
  isUtilityRoute,
  mondayOf,
  openDuty,
  regularRouteBars,
  runSchoolLists,
  schoolsForWindow,
  packLanes,
  weekDates,
  weekdayDates,
} from '../public/board/gantt.js';
import { driversForPin, setPin } from '../src/logic/clockKiosk.js';
import { dailyWorkQrTarget } from '../src/routes/extraWorkRouter.js';

describe('week chart lanes', () => {
  it('stacks trips that overlap and keeps trips that only touch side by side', () => {
    const lanes = packLanes([
      { start: 9 * 60, end: 11 * 60 },
      { start: 10 * 60, end: 12 * 60 },
      { start: 11 * 60, end: 13 * 60 },
    ]);
    assert.deepEqual(lanes, [0, 1, 0]);
  });

  it('uses Monday as the start of the wall-board week', () => {
    assert.equal(mondayOf('2026-10-21'), '2026-10-19');
    assert.equal(mondayOf('2026-10-18'), '2026-10-12');
    assert.deepEqual(weekDates('2026-10-19'), [
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
    assert.equal(addIsoDays('2026-10-19', 6), '2026-10-25');
    assert.deepEqual(weekdayDates('2026-10-19'), [
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
    ]);
  });

  it('sizes the driver board to the trips on it', () => {
    assert.deepEqual(contentAxis([]), { start: 6 * 60, end: 16 * 60 });
    assert.deepEqual(
      contentAxis([
        { start: 6 * 60 + 45, end: 9 * 60 + 30 },
        { start: 14 * 60, end: 16 * 60 + 30 },
      ]),
      { start: 6 * 60, end: 17 * 60 }
    );
    assert.deepEqual(contentAxis([{ start: 17 * 60 + 30, end: 18 * 60 + 45 }]), {
      start: 17 * 60,
      end: 19 * 60,
    });
    const axis = contentAxis([{ start: 8 * 60, end: 10 * 60 }]);
    assert.deepEqual(clipInterval({ start: 8 * 60, end: 10 * 60 }, axis), { start: 8 * 60, end: 10 * 60 });
  });
});

describe('driver free time', () => {
  it('opens one bar from the AM clock-out to the PM clock-in when there is no midday', () => {
    assert.deepEqual(
      freeWindows([
        { segment: 'AM', start: 6 * 60 + 15, end: 8 * 60 + 30 },
        { segment: 'PM', start: 14 * 60 + 5, end: 16 * 60 + 20 },
      ]),
      [{ start: 8 * 60 + 30, end: 14 * 60 + 5, from: 'AM', to: 'PM' }]
    );
  });

  it('opens a second bar from the midday clock-out to the PM clock-in', () => {
    assert.deepEqual(
      freeWindows([
        { segment: 'AM', start: 6 * 60, end: 8 * 60 + 5 },
        { segment: 'MIDDAY', start: 11 * 60 + 10, end: 12 * 60 + 25 },
        { segment: 'PM', start: 13 * 60 + 50, end: 16 * 60 + 5 },
      ]),
      [
        { start: 8 * 60 + 5, end: 11 * 60 + 10, from: 'AM', to: 'MIDDAY' },
        { start: 12 * 60 + 25, end: 13 * 60 + 50, from: 'MIDDAY', to: 'PM' },
      ]
    );
  });

  it('removes awarded weekly work from the middle of a free window', () => {
    const windows = freeWindows([
      { segment: 'AM', start: 6 * 60 + 25, end: 9 * 60 + 15 },
      { segment: 'PM', start: 14 * 60 + 5, end: 16 * 60 + 10 },
    ]);
    assert.deepEqual(
      subtractIntervals(windows, [{ start: 10 * 60, end: 12 * 60 }]).map((window) => ({
        start: window.start,
        end: window.end,
      })),
      [
        { start: 9 * 60 + 15, end: 10 * 60 },
        { start: 12 * 60, end: 14 * 60 + 5 },
      ]
    );
  });

  it('does not treat a utility day as a gap after a clock-out', () => {
    const schedules = [
      {
        route_id: 'Utility — Blakeslee',
        segments: { AM: '7:00-15:00', MIDDAY: null, PM: null },
      },
    ];
    assert.equal(isUtilityRoute('Utility — Blakeslee'), true);
    assert.equal(isUtilityRoute('56'), false);
    assert.deepEqual(regularRouteBars(schedules), []);
    assert.deepEqual(freeWindows(regularRouteBars(schedules)), []);
    assert.deepEqual(openDuty(schedules), {
      kind: 'utility',
      label: 'Utility Driver',
      start: 7 * 60,
      end: 15 * 60,
    });
  });

  it('marks a driver with no route clocks as open, and leaves a regular route alone', () => {
    assert.deepEqual(openDuty([]), {
      kind: 'open',
      label: 'No regular route',
      start: null,
      end: null,
    });
    assert.equal(
      openDuty([
        {
          route_id: '65',
          segments: { AM: '6:35-9:20', MIDDAY: null, PM: '14:05-17:10' },
        },
      ]),
      null
    );
  });

  it('skips a pair of runs that touch', () => {
    assert.deepEqual(
      freeWindows([
        { segment: 'AM', start: 6 * 60, end: 11 * 60 },
        { segment: 'MIDDAY', start: 11 * 60, end: 12 * 60 },
        { segment: 'PM', start: 14 * 60, end: 16 * 60 },
      ]),
      [{ start: 12 * 60, end: 14 * 60, from: 'MIDDAY', to: 'PM' }]
    );
  });
});

describe('schools that bookend free time', () => {
  it('uses the last school before the slash and the first school after it', () => {
    const lists = runSchoolLists('LOW, SHS/BHS, LOW');
    assert.deepEqual(lists.AM, ['LOW', 'SHS']);
    assert.deepEqual(lists.PM, ['BHS', 'LOW']);
    assert.deepEqual(schoolsForWindow({ from: 'AM', to: 'PM' }, lists), {
      fromSchool: 'SHS',
      toSchool: 'BHS',
    });
  });

  it('ignores the hours written before the school list', () => {
    const lists = runSchoolLists('3.5 hours/4 hr min RV, SQHS/RV, SQHS');
    assert.deepEqual(schoolsForWindow({ from: 'AM', to: 'PM' }, lists), {
      fromSchool: 'SQHS',
      toSchool: 'RV',
    });
  });

  it('uses a midday list when the route names one', () => {
    const lists = runSchoolLists({ AM: ['Everson'], MIDDAY: ['Birchwood'], PM: ['Sehome'] });
    assert.deepEqual(schoolsForWindow({ from: 'AM', to: 'MIDDAY' }, lists), {
      fromSchool: 'Everson',
      toSchool: 'Birchwood',
    });
    assert.deepEqual(schoolsForWindow({ from: 'MIDDAY', to: 'PM' }, lists), {
      fromSchool: 'Birchwood',
      toSchool: 'Sehome',
    });
  });
});

describe('clock PIN lookup', () => {
  it('returns every driver who shares a PIN and nobody else', () => {
    const now = '2026-10-21T12:00:00.000Z';
    let pins = {};
    pins = setPin(pins, 'ada', '1111', now);
    pins = setPin(pins, 'bea', '1111', now);
    pins = setPin(pins, 'cy', '2222', now);
    const drivers = [
      { driver_id: 'ada', name: 'Ada' },
      { driver_id: 'bea', name: 'Bea' },
      { driver_id: 'cy', name: 'Cy' },
      { driver_id: 'no-pin', name: 'No Pin' },
    ];
    assert.deepEqual(
      driversForPin(drivers, pins, '1111').map((row) => row.driver_id),
      ['ada', 'bea']
    );
    assert.deepEqual(driversForPin(drivers, pins, '9999'), []);
  });
});

describe('daily work phone link', () => {
  it('opens the matching driver dashboard tab and drops a PIN', () => {
    assert.equal(
      dailyWorkQrTarget('http://192.168.0.63:3849/board?as=driver&sheet=daily&view=phone'),
      'http://192.168.0.63:3849/driver?tab=daily'
    );
    assert.equal(
      dailyWorkQrTarget('http://192.168.0.63:3849/board?as=driver&sheet=daily&week=2026-10-19'),
      'http://192.168.0.63:3849/driver?week=2026-10-19&tab=daily'
    );
    assert.equal(
      dailyWorkQrTarget('http://192.168.0.63:3849/board?as=driver&sheet=roster&view=phone'),
      'http://192.168.0.63:3849/driver?tab=roster'
    );
    assert.equal(
      dailyWorkQrTarget(
        'http://192.168.0.63:3849/board?as=driver&sheet=weekly&view=phone&week=2026-10-19'
      ),
      'http://192.168.0.63:3849/driver?week=2026-10-19'
    );
    assert.equal(
      dailyWorkQrTarget(
        'http://192.168.0.63:3849/board?as=driver&sheet=weekly&view=phone&week=2026-10-21'
      ),
      'http://192.168.0.63:3849/driver?tab=weekly'
    );
    assert.equal(
      dailyWorkQrTarget('http://192.168.0.63:3849/driver?week=2026-10-19&pin=1111'),
      'http://192.168.0.63:3849/driver?week=2026-10-19'
    );
    assert.equal(
      dailyWorkQrTarget('http://192.168.0.63:3849/driver?tab=card&pin=1111'),
      'http://192.168.0.63:3849/driver?tab=card'
    );
    assert.equal(
      dailyWorkQrTarget('http://192.168.0.63:3849/driver?week=2026-10-21'),
      'http://192.168.0.63:3849/driver'
    );
    assert.equal(dailyWorkQrTarget('http://192.168.0.63:3849/not-the-board'), '');
  });
});
