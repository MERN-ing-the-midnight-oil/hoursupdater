import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  absenceDayLabel,
  absencePortionPosts,
  absenceSchedule,
  absenceSchedules,
  replaceAbsenceSchedule,
  absenceMarkup,
  absencesForDate,
  absentColumns,
  absentRouteBorder,
  absentRouteColor,
  absentRouteGroups,
  absentRouteNumber,
  calendarCells,
  isSpedRoute,
  pairedAbsenceBus,
  pairedAbsenceRoute,
  postAbsenceDays,
  toggleAbsenceDay,
  rememberedNames,
  resolveAbsenceRoute,
  addOutOfService,
  applyOutOfServiceSpares,
  assignOutOfServiceSpare,
  outOfServiceManagerView,
  placeOutOfServiceSpare,
  availableDrivers,
  availableMarkup,
  isSchoolZone,
  normalizeEarlyMinutes,
  noteSchoolVisits,
  noteYardReturns,
  darkBuses,
  startupDismissals,
  darkBusKey,
  darkBusLog,
  darkBusSkip,
  adoptScheduleClocks,
  routeGoesToSchools,
  spareAssignmentWarnings,
  spareAssignPrompt,
  spareForPortion,
  sparePortionWarnings,
  sparePoolChoiceMarkup,
  sparePoolMarkup,
  mainFleetFromSheet,
  mainFleetMarkup,
  mainFleetWarnings,
  normalizeSparePools,
  wheelchairCount,
  routeWheelchairNeed,
  setRouteWheelchairs,
  darkBusLogMarkup,
  darkBusMarkup,
  darkBusGroups,
  darkBusHasFlash,
  darkBusAlarmStatement,
  darkBusPillFacts,
  darkBusPageMarkup,
  darkBusPills,
  powerOnActivity,
  darkBusPillTone,
  darkBusScreen,
  darkBusSwitchNote,
  earlyReleaseWatch,
  restoreRegularPmClocks,
  powerOnForRun,
  indexPowerEvents,
  applyPowerOns,
  rememberAlertTimes,
  withAlertedAt,
  formatBoardClock,
  lookupStudents,
  normalizeDarkBusAlert,
  normalizeStudentCheckAlert,
  isStudentCheckConfig,
  countsAsStudentCheck,
  studentCheckSchoolVisits,
  studentCheckYardReturns,
  studentChecksByRun,
  studentCheckAlerts,
  studentCheckPills,
  studentCheckPageMarkup,
  studentCheckScreen,
  outOfServiceMarkup,
  boardRuns,
  pairingsToRuns,
  postAbsence,
  rememberStudent,
  removeAbsence,
  removeAbsencePortion,
  removeOutOfService,
  removePairing,
  routeRunChoices,
  savePairing,
  applyScheduleClocks,
  assignRouteBuses,
  availableBusSheet,
  availableBusSheetMarkup,
  routeBusSheet,
  routeBusSheetMarkup,
  savePostedBus,
  saveRouteBus,
  saveUsualStart,
  sendSpare,
  spareCovers,
  spareReplacementReady,
  watchOutOfService,
} from '../office-tracker/src/theBoard.js';
import {
  POSTED_REG_ED_SPARES,
  POSTED_ROUTE_BUSES,
  POSTED_SPED_SPARES,
  seedPostedRouteBuses,
} from '../office-tracker/src/postedRouteBuses.js';

const am = {
  route: '12',
  bus: '42',
  run: 'AM',
  clockIn: '6:15',
  clockOut: '8:45',
  poweredOnAt: '',
  lastStopVisited: false,
};

describe('dark bus alert', () => {
  it('waits five minutes and plays a sound unless the yard changes that', () => {
    assert.deepEqual(normalizeDarkBusAlert(null), {
      graceMinutes: 5,
      sound: true,
      flash: true,
      cover: true,
      midAt: '09:30',
      pmAt: '13:00',
      activityLog: false,
    });
    assert.deepEqual(normalizeDarkBusAlert({ graceMinutes: 0, sound: false, flash: false, cover: false }), {
      graceMinutes: 0,
      sound: false,
      flash: false,
      cover: false,
      midAt: '09:30',
      pmAt: '13:00',
      activityLog: false,
    });
    assert.equal(normalizeDarkBusAlert({ activityLog: true }).activityLog, true);
    assert.equal(normalizeDarkBusAlert({ midAt: '10:15', pmAt: '14:05' }).midAt, '10:15');
    assert.equal(normalizeDarkBusAlert({ midAt: '10:15', pmAt: '14:05' }).pmAt, '14:05');
    assert.equal(normalizeDarkBusAlert({ midAt: 'noon' }).midAt, '09:30');
    assert.equal(normalizeDarkBusAlert({ sound: false }).flash, true);
    assert.equal(normalizeDarkBusAlert({ sound: false }).cover, true);
    assert.equal(normalizeDarkBusAlert({ graceMinutes: 90 }).graceMinutes, 60);
    assert.equal(normalizeDarkBusAlert({ graceMinutes: 'soon' }).graceMinutes, 5);
  });

  it('shows every route bus and saves a run on a different bus', () => {
    const posted = savePostedBus([], { route: '4', bus: '86' });
    const saved = saveRouteBus(posted, { route: '12', bus: '49', run: 'AM', clockIn: '6:15', clockOut: '8:45' });
    const withPm = saveRouteBus(saved, { route: '12', bus: '49', run: 'PM', clockIn: '14:00', clockOut: '16:20' });
    const sheet = routeBusSheet(withPm, ['4', '12']);
    assert.deepEqual(sheet.find((row) => row.route === '4').buses, { AM: '86', MID: '86', PM: '86' });
    assert.equal(sheet.find((row) => row.route === '12').buses.AM, '49');
    assert.equal(sheet.find((row) => row.route === '12').buses.PM, '49');
    assert.equal(sheet.find((row) => row.route === '12').buses.MID, '');
    const markup = routeBusSheetMarkup(sheet);
    assert.match(markup, /data-route="12"/);
    assert.match(markup, /data-run="PM"/);
    assert.match(markup, /value="49"/);

    const next = assignRouteBuses(
      withPm,
      [
        { route: '12', run: 'AM', bus: '49' },
        { route: '12', run: 'MID', bus: '' },
        { route: '12', run: 'PM', bus: '15' },
      ],
      () => []
    );
    assert.equal(next.list.find((row) => row.route === '12' && row.run === 'PM').bus, '15');
    assert.equal(next.list.find((row) => row.route === '12' && row.run === 'PM').clockIn, '14:00');
    assert.equal(next.list.find((row) => row.route === '12' && row.run === 'AM').bus, '49');
    assert.equal(next.skipped.length, 0);

    const moved = assignRouteBuses(
      posted,
      [
        { route: '4', run: 'AM', bus: '86' },
        { route: '4', run: 'MID', bus: '' },
        { route: '4', run: 'PM', bus: '21' },
      ],
      () => [
        { run: 'AM', clockIn: '6:20', clockOut: '8:40' },
        { run: 'PM', clockIn: '14:05', clockOut: '16:10' },
      ]
    );
    assert.equal(moved.list.find((row) => row.run === 'AM').bus, '86');
    assert.equal(moved.list.find((row) => row.run === 'PM').bus, '21');
    assert.equal(moved.list.some((row) => row.route === '4' && !row.run), false);
    assert.equal(moved.list.find((row) => row.run === 'AM').clockIn, '06:20');
    assert.deepEqual(sheet.find((row) => row.route === '4').clocks, { AM: '', MID: '', PM: '' });

    const route10 = savePostedBus([], { route: '10', bus: '61' });
    const route10Sheet = routeBusSheet(route10, ['10']);
    assert.deepEqual(route10Sheet[0].buses, { AM: '61', MID: '61', PM: '61' });
    assert.deepEqual(route10Sheet[0].clocks, { AM: '', MID: '', PM: '' });
    assert.match(routeBusSheetMarkup(route10Sheet), /Route 10 AM clock-in/);
    assert.doesNotMatch(routeBusSheetMarkup(route10Sheet), /data-field="clock"/);

    const corrected = assignRouteBuses(
      route10,
      [
        { route: '10', run: 'AM', bus: '61', clockIn: '6:50' },
        { route: '10', run: 'MID', bus: '61', clockIn: '' },
        { route: '10', run: 'PM', bus: '70', clockIn: '14:05' },
      ],
      () => []
    );
    assert.equal(corrected.skipped.length, 0);
    assert.equal(corrected.list.find((row) => row.route === '10' && row.run === 'AM').bus, '61');
    assert.equal(corrected.list.find((row) => row.route === '10' && row.run === 'AM').clockIn, '06:50');
    assert.equal(corrected.list.find((row) => row.route === '10' && row.run === 'PM').bus, '70');
    assert.equal(corrected.list.find((row) => row.route === '10' && row.run === 'PM').clockIn, '14:05');
    assert.equal(corrected.list.find((row) => row.route === '10' && !row.run).bus, '61');
    assert.match(routeBusSheetMarkup(routeBusSheet(corrected.list, ['10'])), /6:50 AM/);
    const after = routeBusSheet(corrected.list, ['10'])[0];
    assert.equal(after.buses.AM, '61');
    assert.equal(after.clocks.AM, '06:50');
    assert.equal(after.buses.MID, '61');
    assert.equal(after.clocks.MID, '');
    assert.equal(after.buses.PM, '70');
  });

  it('watches a school route with no driver and leaves utility routes alone', () => {
    assert.equal(routeGoesToSchools('LOW, SHS/BHS, LOW'), true);
    assert.equal(routeGoesToSchools('No driver assigned.'), false);
    assert.equal(darkBusSkip({ name: 'S 10', note: 'LOW, SHS/BHS, LOW' }), '');
    assert.equal(darkBusSkip({ name: 'S 22', note: 'No driver assigned.' }).includes('no school stops'), true);
    assert.equal(darkBusSkip({ name: '56', note: 'Driver Trainer. No driver assigned.' }).includes('Driver trainer'), true);
    assert.equal(darkBusSkip({ name: 'Utility — Blakeslee', note: 'Utility day, 7:00 AM–3:00 PM.' }).includes('Utility'), true);
    assert.equal(darkBusSkip({ name: 'S 14', note: 'No driver assigned. ROO, SMS/ROO, WMS' }), '');

    const posted = savePostedBus([], { route: '10', bus: '61' });
    const withUtility = savePostedBus(posted, { route: '88', bus: '24' });
    const adopted = adoptScheduleClocks(withUtility, [
      { route: '10', runs: [{ run: 'AM', clockIn: '6:50', clockOut: '9:20' }, { run: 'PM', clockIn: '14:05', clockOut: '17:10' }] },
      { route: '88', runs: [{ run: 'AM', clockIn: '7:00', clockOut: '15:00' }], skip: 'Utility driver. Dark Bus does not watch this route.' },
    ]);
    assert.equal(adopted.find((row) => row.route === '10' && row.run === 'AM').clockIn, '06:50');
    assert.equal(adopted.find((row) => row.route === '10' && row.run === 'AM').bus, '61');
    assert.equal(adopted.find((row) => row.route === '88' && row.run === 'AM'), undefined);

    const kept = adoptScheduleClocks(adopted, [
      { route: '10', runs: [{ run: 'AM', clockIn: '6:10', clockOut: '9:20' }] },
    ]);
    assert.equal(kept.find((row) => row.route === '10' && row.run === 'AM').clockIn, '06:50');

    const skipped = [{ route: '88', reason: 'Utility driver. Dark Bus does not watch this route.' }];
    const log = darkBusLog(
      [{ route: '88', bus: '24', run: '', clockIn: '' }],
      [],
      {},
      8 * 60,
      1,
      [],
      skipped
    );
    assert.equal(log[0].verdict, 'Not watched');
    assert.match(log[0].detail, /Utility driver/);
    assert.equal(darkBuses([{ route: '88', bus: '24', run: 'AM', clockIn: '7:00', clockOut: '15:00' }], 8 * 60, 1, skipped).length, 0);
  });

  it('warns when a spare is the wrong kind or already on another route', () => {
    const sped = [{ bus: '38', kind: 'WC(2)' }];
    const reg = [{ bus: '9', kind: 'HDX 78P' }, { bus: '66', kind: 'HDX 84P' }];
    const assignments = [{ route: '12', bus: '49', run: 'AM' }];
    const spedRoute = spareAssignmentWarnings({
      route: 'S 10',
      spare: '9',
      assignments,
      sped: true,
      spedSpares: sped,
      regSpares: reg,
    });
    assert.match(spedRoute.join(' '), /regular-ed spare/);
    assert.match(spedRoute.join(' '), /sped route/);
    const regRoute = spareAssignmentWarnings({
      route: '50',
      spare: '38',
      assignments,
      sped: false,
      spedSpares: sped,
      regSpares: reg,
    });
    assert.match(regRoute.join(' '), /sped spare/);
    const taken = spareAssignmentWarnings({
      route: '50',
      spare: '49',
      assignments,
      sped: false,
      spedSpares: sped,
      regSpares: reg,
    });
    assert.match(taken.join(' '), /already assigned to route 12/);
    const same = spareAssignmentWarnings({
      route: '10',
      spare: '61',
      assignments: [{ route: 'S 10', bus: '61', run: 'AM' }],
      sped: true,
      spedSpares: sped,
      regSpares: reg,
    });
    assert.equal(same.length, 0);
    const other = spareAssignmentWarnings({
      route: '50',
      spare: '100',
      assignments,
      sped: false,
      spedSpares: sped,
      regSpares: reg,
    });
    assert.equal(other.length, 0);
    const chairs = [
      { bus: '15', kind: '36P' },
      { bus: '16', kind: 'WC(1)' },
      { bus: '38', kind: 'WC (2)' },
      { bus: '45', kind: 'WC(0)' },
    ];
    const short = spareAssignmentWarnings({
      route: 'S 10',
      spare: '16',
      sped: true,
      spedSpares: chairs,
      wheelchairsNeeded: 2,
    });
    assert.match(short.join(' '), /has 1 wheelchair/);
    assert.match(short.join(' '), /Route S 10 needs 2 wheelchairs/);
    assert.match(
      spareAssignmentWarnings({ route: 'S 10', spare: '15', sped: true, spedSpares: chairs, wheelchairsNeeded: 2 }).join(' '),
      /has no wheelchairs/
    );
    assert.match(
      spareAssignmentWarnings({ route: 'S 10', spare: '45', sped: true, spedSpares: chairs, wheelchairsNeeded: 2 }).join(' '),
      /has no wheelchairs/
    );
    assert.equal(
      spareAssignmentWarnings({ route: 'S 10', spare: '38', sped: true, spedSpares: chairs, wheelchairsNeeded: 2 }).length,
      0
    );
    assert.match(
      spareAssignmentWarnings({ route: 'S 10', spare: '100', sped: true, spedSpares: chairs, wheelchairsNeeded: 2 }).join(' '),
      /no wheelchair count listed/
    );
    assert.equal(
      spareAssignmentWarnings({ route: 'S 10', spare: '15', sped: true, spedSpares: chairs }).length,
      0
    );
    assert.equal(wheelchairCount('WC (2)'), 2);
    assert.equal(wheelchairCount('36P'), 0);
    assert.equal(routeWheelchairNeed(setRouteWheelchairs({}, 'S 10', 2), '10'), 2);
    assert.equal(routeWheelchairNeed(setRouteWheelchairs({ 's 10': 2 }, '10', ''), 's 10'), null);
    const chairSheet = routeBusSheet([{ route: '10', bus: '61' }], ['10'], { 's 10': 2 });
    assert.equal(chairSheet[0].wheelchairs, 2);
    assert.match(routeBusSheetMarkup(chairSheet), /Route 10 wheelchairs/);
    assert.match(routeBusSheetMarkup(chairSheet), /value="2"/);
    assert.match(sparePoolMarkup([{ bus: '38', kind: 'WC(2)' }], 'sped'), /value="38"/);
    assert.match(sparePoolMarkup([{ bus: '38', kind: 'WC(2)' }], 'sped'), /placeholder="WC\(2\)"/);
    assert.match(sparePoolMarkup([{ bus: '9', kind: 'HDX 78P' }], 'reg'), /placeholder="HDX 78P"/);
    assert.match(sparePoolMarkup([{ bus: '66', kind: 'HDX 84P' }], 'reg'), /Add bus/);
    assert.match(sparePoolMarkup([{ bus: '66', kind: 'HDX 84P' }], 'reg'), /value="66"/);
    const fleetSheet = [
      { route: '17', buses: { AM: '12', MID: '12', PM: '12' } },
      { route: '10', buses: { AM: '61', MID: '61', PM: '49' } },
    ];
    const fleet = mainFleetFromSheet(fleetSheet, { 17: ['AM', 'MID', 'PM'], 10: ['AM', 'PM'] });
    assert.deepEqual(
      fleet.find((item) => item.bus === '12').routes,
      [{ route: '17', portions: ['AM', 'MID', 'PM'] }]
    );
    assert.deepEqual(fleet.find((item) => item.bus === '61').routes, [{ route: '10', portions: ['AM'] }]);
    assert.deepEqual(fleet.find((item) => item.bus === '49').routes, [{ route: '10', portions: ['PM'] }]);
    assert.match(mainFleetWarnings({ bus: '12', portions: ['MID'], fleet }).join(' '), /midday route on route 17/);
    assert.equal(mainFleetWarnings({ bus: '61', portions: ['MID'], fleet }).length, 0);
    assert.match(mainFleetWarnings({ bus: '61', portions: ['AM', 'PM'], fleet }).join(' '), /morning route on route 10/);
    assert.doesNotMatch(mainFleetWarnings({ bus: '61', portions: ['AM', 'PM'], fleet }).join(' '), /afternoon/);
    const fleetList = mainFleetMarkup(fleet, '12');
    assert.match(fleetList, /data-spare-use="12"/);
    assert.match(fleetList, /Route 17 · AM, MID, PM/);
    assert.match(fleetList, /is-selected/);
    assert.equal(mainFleetFromSheet([{ route: '4', buses: { AM: '86', MID: '', PM: '' } }], { 4: [] }).find((item) => item.bus === '86').routes[0].portions.length, 0);
    assert.doesNotMatch(sparePoolMarkup([{ bus: '38', kind: 'WC(2)' }], 'sped'), /data-spare-use/);
    const choice = sparePoolChoiceMarkup([{ bus: '38', kind: 'WC(2)' }, { bus: '', kind: '' }], 'sped', '38');
    assert.match(choice, /data-spare-use="38"/);
    assert.match(choice, /is-selected/);
    assert.doesNotMatch(choice, /<input/);
    assert.equal(spareAssignPrompt('45', '11'), 'Assign Spare Bus 45 to replace Bus 11?');
    assert.equal(spareAssignPrompt('', ''), 'Assign Spare Bus __ to replace Bus __?');
    assert.equal(
      spareAssignPrompt({ AM: '45', MID: '45', PM: '45' }, '11'),
      'Assign Spare Bus 45 to replace Bus 11?'
    );
    assert.equal(
      spareAssignPrompt({ AM: '45', MID: '', PM: '9' }, '11'),
      'Assign spare 45 for AM and spare 9 for PM to replace bus 11? MID has no spare.'
    );
    const defaults = { sped: [{ bus: '38', kind: 'WC(2)' }], reg: [{ bus: '9', kind: 'HDX 78P' }] };
    assert.deepEqual(normalizeSparePools(null, defaults), defaults);
    assert.deepEqual(normalizeSparePools({ sped: [{ route: '15', spare: '36P' }], reg: [{ bus: '22', kind: 'HDX 84P' }] }, defaults), {
      sped: [{ bus: '15', kind: '36P' }],
      reg: [{ bus: '22', kind: 'HDX 84P' }],
    });
  });
});

describe('dark bus screen', () => {
  const view = { midAt: '09:30', pmAt: '13:00' };
  const am = {
    route: '10',
    bus: '61',
    run: 'AM',
    clockIn: '6:50',
    clockOut: '8:30',
    driver: 'Rhys Smoker',
    photo: 'driver-photos/rhys-smoker.jpg',
  };
  const sameStart = {
    route: '12',
    bus: '49',
    run: 'AM',
    clockIn: '6:50',
    clockOut: '8:45',
    driver: 'Masoud Meskinimood',
    photo: '',
  };
  const earlier = { route: '2', bus: '79', run: 'AM', clockIn: '6:15', clockOut: '8:00', driver: 'Karen James' };
  const mid = { route: '17', bus: '12', run: 'MID', clockIn: '9:55', clockOut: '12:30', driver: 'Bonnie Glispy' };

  it('follows the clock from AM to MID to PM', () => {
    assert.equal(darkBusScreen(9 * 60 + 29, view), 'AM');
    assert.equal(darkBusScreen(9 * 60 + 30, view), 'MID');
    assert.equal(darkBusScreen(13 * 60, view), 'PM');
    assert.match(darkBusSwitchNote('AM', 'AM', view), /AM until 9:30 AM/);
    assert.match(darkBusSwitchNote('AM', 'AM', view), /MID until 1:00 PM/);
    assert.match(darkBusSwitchNote('PM', 'AM', view), /Showing PM/);
  });

  it('alerts the afternoon from the early release clock and leaves the morning alone', () => {
    const runs = [
      { route: '10', bus: '61', run: 'AM', clockIn: '06:50', clockOut: '08:30' },
      { route: '10', bus: '61', run: 'MID', clockIn: '10:15', clockOut: '12:00' },
      { route: '10', bus: '61', run: 'PM', clockIn: '14:05', clockOut: '16:30' },
      { route: '53', bus: '83', run: 'PM', clockIn: '14:10', clockOut: '16:40' },
    ];
    const watched = earlyReleaseWatch(runs, { 10: '11:55', 53: '11:50' });
    assert.equal(watched.runs.find((run) => run.run === 'AM').clockIn, '06:50');
    assert.equal(watched.runs.some((run) => run.run === 'MID'), false);
    assert.equal(watched.runs.find((run) => run.route === '10' && run.run === 'PM').clockIn, '11:55');
    assert.equal(watched.runs.find((run) => run.route === '53').clockIn, '11:50');
    const alerts = darkBuses(watched.runs, 11 * 60 + 56, 1);
    assert.deepEqual(
      alerts.map((alert) => alert.route),
      ['53', '10']
    );
    assert.equal(darkBuses(runs, 11 * 60 + 56, 1).some((alert) => alert.run === 'PM'), false);
    const earlyView = { midAt: '11:50', pmAt: '11:50', earlyRelease: true };
    assert.equal(darkBusScreen(11 * 60 + 49, earlyView), 'AM');
    assert.equal(darkBusScreen(11 * 60 + 50, earlyView), 'PM');
    assert.match(darkBusSwitchNote('AM', 'AM', earlyView), /AM until 11:50 AM/);
    assert.match(darkBusSwitchNote('AM', 'AM', earlyView), /Midday routes are not watched/);

    const stored = [
      { route: '10', run: 'PM', clockIn: '11:55' },
      { route: '53', run: 'PM', clockIn: '11:55' },
      { route: '65', run: 'PM', clockIn: '12:00' },
      { route: '12', run: 'AM', clockIn: '06:15' },
      { route: '4', run: 'PM', clockIn: '13:40' },
    ];
    const regular = (route) => {
      const clocks = { 10: '14:05', 53: '14:10', 65: '14:20', 4: '14:00' };
      return [{ run: 'PM', clockIn: clocks[route] || '' }];
    };
    const restored = restoreRegularPmClocks(stored, regular, (route) => ({ 10: '11:55', 53: '11:50', 65: '12:00' }[route] || ''));
    assert.equal(restored.find((row) => row.route === '10').clockIn, '14:05');
    assert.equal(restored.find((row) => row.route === '53').clockIn, '14:10');
    assert.equal(restored.find((row) => row.route === '65').clockIn, '14:20');
    assert.equal(restored.find((row) => row.route === '12').clockIn, '06:15');
    assert.equal(restored.find((row) => row.route === '4').clockIn, '13:40');
  });

  it('turns a route pill with the start, the wait, and Power On', () => {
    assert.equal(darkBusPillTone(am, 6 * 60 + 40, 5), 'waiting');
    assert.equal(darkBusPills([am], 6 * 60 + 40, 5).length, 0);
    assert.equal(darkBusPillTone(am, 6 * 60 + 52, 5), 'yellow');
    assert.equal(darkBusPillTone(am, 6 * 60 + 56, 5), 'dark');
    assert.equal(darkBusPillTone({ ...am, poweredOnAt: '6:51' }, 6 * 60 + 52, 5), 'on');
    assert.equal(darkBusPillTone(am, 9 * 60, 5), 'neutral');
    assert.equal(darkBusHasFlash([am], 6 * 60 + 52, 5), false);
    assert.equal(darkBusHasFlash([am, sameStart, earlier], 6 * 60, 5), false);
    assert.equal(darkBusHasFlash([am], 6 * 60 + 56, 5), true);
    assert.equal(darkBusHasFlash([am], 9 * 60, 5), false);
    assert.equal(darkBusHasFlash([{ ...am, poweredOnAt: 6 * 60 + 51 }], 6 * 60 + 56, 5), false);
    const flashing = darkBusPills([am], 6 * 60 + 56, 5);
    assert.equal(flashing[0].tone, 'dark');
    const held = darkBusPills([am], 6 * 60 + 56, 5, [darkBusKey(flashing[0])]);
    assert.equal(held[0].tone, 'held');
    assert.equal(darkBusHasFlash([am], 6 * 60 + 56, 5, [darkBusKey(flashing[0])]), false);
    const checking = { ...am, powerPending: true };
    assert.equal(darkBusPillTone(checking, 6 * 60 + 56, 5), 'pending');
    assert.equal(darkBuses([checking], 6 * 60 + 56, 5).length, 0);
    const pendingMarkup = darkBusPageMarkup([checking], { nowMinutes: 6 * 60 + 56, graceMinutes: 5, tab: 'AM' });
    assert.match(pendingMarkup, /is-pending/);
    assert.match(pendingMarkup, /board-dark-spinner/);
    assert.match(pendingMarkup, /Checking Power On/);
    assert.doesNotMatch(pendingMarkup, /is-dark/);
    assert.doesNotMatch(pendingMarkup, /Never powered on/);
  });

  it('groups route pills that share a start and shows the driver', () => {
    const runs = [sameStart, mid, am, earlier];
    const groups = darkBusGroups(darkBusPills(runs, 6 * 60 + 20, 5), 'AM');
    assert.deepEqual(
      groups.map((group) => group.label),
      ['6:15 AM']
    );
    const before = darkBusPageMarkup(runs, { nowMinutes: 6 * 60 + 14, graceMinutes: 5, tab: 'AM' });
    assert.match(before, /No clock-ins yet/);
    assert.doesNotMatch(before, /6:15 AM/);
    assert.doesNotMatch(before, /Route 2/);
    const atStart = darkBusPageMarkup([earlier], { nowMinutes: 6 * 60 + 15, graceMinutes: 5, tab: 'AM' });
    assert.match(atStart, /6:15 AM/);
    assert.match(atStart, /is-yellow/);
    assert.match(atStart, /board-dark-facts/);
    assert.match(atStart, /0 minutes since clock-in/);
    assert.match(atStart, /Not powered on/);
    assert.doesNotMatch(atStart, /board-dark-info/);
    assert.doesNotMatch(atStart, /data-dark-key/);
    assert.doesNotMatch(atStart, /is-dark/);
    assert.doesNotMatch(atStart, /is-neutral/);
    const poweredAtStart = darkBusPageMarkup([{ ...earlier, poweredOnAt: '6:10' }], {
      nowMinutes: 6 * 60 + 15,
      graceMinutes: 5,
      tab: 'AM',
    });
    assert.match(poweredAtStart, /is-on/);
    assert.doesNotMatch(poweredAtStart, /is-yellow/);
    assert.doesNotMatch(poweredAtStart, /board-dark-info/);
    const started = darkBusGroups(darkBusPills(runs, 6 * 60 + 52, 5), 'AM');
    assert.deepEqual(
      started[1].pills.map((pill) => pill.route),
      ['10', '12']
    );
    const markup = darkBusPageMarkup(runs, { nowMinutes: 6 * 60 + 52, graceMinutes: 5, tab: 'AM' });
    assert.match(markup, /6:15 AM/);
    assert.match(markup, /6:50 AM/);
    assert.match(markup, /Rhys Smoker/);
    assert.match(markup, /driver-photos\/rhys-smoker\.jpg/);
    assert.match(markup, /board-dark-person/);
    assert.match(markup, /Route 10/);
    assert.match(markup, /is-yellow/);
    assert.match(markup, /<article class="board-dark-pill is-yellow"/);
    assert.match(markup, /data-dark-key="79\|2\|am\|375"/);
    assert.match(markup, /Click to stop this route's alarm/);
    assert.match(markup, /board-dark-facts/);
    assert.doesNotMatch(markup, /board-dark-info/);
    assert.doesNotMatch(markup, /board-dark-pop/);
    assert.doesNotMatch(markup, /board-dark-activity-log/);
    assert.equal(darkBusAlarmStatement(earlier, 5), 'Route 2, clock-in 6:15 AM, wait 5 minutes.');
    assert.equal(darkBusAlarmStatement({ ...am, clockIn: 6 * 60 + 50 }, 1), 'Route 10, clock-in 6:50 AM, wait 1 minute.');
    assert.deepEqual(darkBusPillFacts({ ...earlier, clockIn: 6 * 60 + 15 }, 6 * 60 + 15), [
      '0 minutes since clock-in',
      'Not powered on',
    ]);
    assert.deepEqual(darkBusPillFacts({ clockIn: '6:50', poweredOnAt: '6:51' }, 6 * 60 + 51), [
      '1 minute since clock-in',
      'Powered on at 6:51 AM',
    ]);
    assert.match(markup, /37 minutes since clock-in/);
    assert.match(markup, /2 minutes since clock-in/);
    assert.match(markup, /Never powered on/);
    assert.match(markup, /Not powered on/);
    assert.doesNotMatch(markup, /Clock-in 6:15 AM/);
    assert.doesNotMatch(markup, /Wait 5 minutes/);
    const poweredLate = darkBusPageMarkup([{ ...earlier, lastPowerOnAt: '6:20' }], {
      nowMinutes: 6 * 60 + 30,
      graceMinutes: 5,
      tab: 'AM',
    });
    assert.match(poweredLate, /is-dark/);
    assert.match(poweredLate, /15 minutes since clock-in/);
    assert.match(poweredLate, /Never powered on/);
    assert.doesNotMatch(poweredLate, /Powered on at/);
    assert.doesNotMatch(markup, /Route 17/);
    const on = darkBusPageMarkup([{ ...am, poweredOnAt: '6:51' }], {
      nowMinutes: 6 * 60 + 56,
      graceMinutes: 5,
      tab: 'AM',
    });
    assert.match(on, /is-on/);
    assert.doesNotMatch(on, /is-dark/);
    assert.doesNotMatch(on, /board-dark-info/);
    assert.doesNotMatch(on, /minutes since clock-in/);
    const dismissed = darkBusPageMarkup([am], {
      nowMinutes: 6 * 60 + 56,
      graceMinutes: 5,
      tab: 'AM',
      acknowledged: [darkBusKey({ bus: am.bus, route: am.route, run: 'AM', clockIn: 6 * 60 + 50 })],
    });
    assert.match(dismissed, /is-held/);
    assert.match(dismissed, /6 minutes since clock-in/);
    assert.match(dismissed, /Never powered on/);
    assert.doesNotMatch(dismissed, /board-dark-info/);
    assert.doesNotMatch(dismissed, /is-dark/);
    assert.doesNotMatch(dismissed, /data-dark-key/);
    const finished = darkBusPageMarkup([am], { nowMinutes: 9 * 60, graceMinutes: 5, tab: 'AM' });
    assert.match(finished, /is-neutral/);
    assert.match(finished, /not powered on/);
    assert.doesNotMatch(finished, /is-dark/);
    assert.doesNotMatch(finished, /is-yellow/);
    assert.deepEqual(
      powerOnActivity([
        { ...am, driver: 'Angela Smith', clockIn: '6:50', poweredOnAt: '6:52' },
        { route: '12', bus: '49', run: 'AM', driver: 'Masoud', clockIn: '6:15', poweredOnAt: '' },
      ]).map((line) => line.text),
      ['Angela powered on at 6:52 AM for the 6:50 AM clock-in']
    );
  });
});

describe('dark buses', () => {
  it('alerts when clock-in has passed and the bus has not powered on', () => {
    const alerts = darkBuses([am], 6 * 60 + 20);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].bus, '42');
    assert.equal(alerts[0].route, '12');
    assert.match(darkBusMarkup(alerts), /Bus 42/);
    assert.match(darkBusMarkup(alerts), /Route 12/);
    assert.match(darkBusMarkup(alerts), /Clock-in 6:15 AM/);
    assert.doesNotMatch(darkBusMarkup(alerts), /Power On/);
  });

  it('closes the alert when the bus powers on after the deadline and logs the start', () => {
    const late = darkBuses([{ ...am, poweredOnAt: '6:28' }], 6 * 60 + 40);
    assert.equal(late.length, 0);
    const log = darkBusLog([{ ...am, poweredOnAt: '6:28' }], [], {}, 6 * 60 + 40);
    assert.equal(log[0].verdict, 'Powered on');
    assert.match(log[0].detail, /Power On 6:28 AM was after the 6:15 AM deadline, so the alert closed/);
    assert.deepEqual(startupDismissals([{ ...am, poweredOnAt: '6:28' }], 6 * 60 + 40), ['42|12|am|375']);
    assert.deepEqual(startupDismissals([am], 6 * 60 + 40), []);
  });

  it('uses the Power On for this run and keeps the minute the alert first appeared', () => {
    const events = indexPowerEvents([
      { bus: '12', at: 9 * 60 + 34, on: true, off: false },
      { bus: '12', at: 9 * 60 + 41, on: false, off: true },
      { bus: '12', at: 10 * 60 + 2, on: true, off: false },
      { bus: '86', at: 10 * 60 + 40, on: true, off: false },
    ]);
    const mid = { route: '17', bus: '12', run: 'MID', clockIn: '9:55', clockOut: '12:30' };
    const powered = applyPowerOns(
      [mid, { route: '4', bus: '86', run: 'MID', clockIn: '10:40', clockOut: '12:30' }],
      events,
      11 * 60
    );
    assert.equal(powerOnForRun(events.get('12'), 9 * 60 + 55, 11 * 60), 10 * 60 + 2);
    assert.equal(powered[0].poweredOnAt, 10 * 60 + 2);
    assert.equal(powered[1].poweredOnAt, 10 * 60 + 40);
    const morningOnly = indexPowerEvents([{ bus: '61', at: 6 * 60 + 27, on: true, off: false }]);
    const angelaRuns = [
      { route: '10', bus: '61', run: 'AM', driver: 'Angela', clockIn: '6:25', clockOut: '8:30' },
      { route: '10', bus: '61', run: 'PM', driver: 'Angela', clockIn: '14:00', clockOut: '16:20' },
    ];
    const beforeClockIn = applyPowerOns(angelaRuns, morningOnly, 6 * 60 + 24);
    assert.equal(beforeClockIn[0].poweredOnAt, '');
    assert.equal(beforeClockIn[1].poweredOnAt, '');
    const angela = applyPowerOns(angelaRuns, morningOnly, 6 * 60 + 30);
    assert.equal(angela[0].poweredOnAt, 6 * 60 + 27);
    assert.equal(angela[1].poweredOnAt, '');
    assert.deepEqual(
      powerOnActivity(angela).map((line) => line.text),
      ['Angela powered on at 6:27 AM for the 6:25 AM clock-in']
    );
    const stillOn = applyPowerOns(angelaRuns, morningOnly, 14 * 60);
    assert.equal(stillOn[1].poweredOnAt, 6 * 60 + 27);
    const parked = indexPowerEvents([
      { bus: '61', at: 6 * 60 + 27, on: true, off: false },
      { bus: '61', at: 8 * 60 + 30, on: false, off: true },
    ]);
    const afternoonOff = applyPowerOns(angelaRuns, parked, 14 * 60);
    assert.equal(afternoonOff[1].poweredOnAt, '');
    assert.equal(darkBuses([afternoonOff[1]], 14 * 60 + 4, 5).length, 0);
    assert.equal(darkBuses([afternoonOff[1]], 14 * 60 + 5, 5).length, 1);
    const duringWait = applyPowerOns(
      angelaRuns,
      indexPowerEvents([
        { bus: '61', at: 6 * 60 + 27, on: true, off: false },
        { bus: '61', at: 8 * 60 + 30, on: false, off: true },
        { bus: '61', at: 14 * 60 + 3, on: true, off: false },
      ]),
      14 * 60 + 3
    );
    assert.equal(duringWait[1].poweredOnAt, 14 * 60 + 3);
    assert.equal(darkBuses([duringWait[1]], 14 * 60 + 3, 5).length, 0);
    const darcie = applyPowerOns(
      [
        { route: '18', bus: '80', run: 'AM', driver: 'Darcie', clockIn: '6:20', clockOut: '8:40' },
        { route: '18', bus: '80', run: 'PM', driver: 'Darcie', clockIn: '14:05', clockOut: '16:30' },
      ],
      indexPowerEvents([
        { bus: '80', at: 6 * 60 + 26, on: true, off: false },
        { bus: '80', at: 8 * 60 + 40, on: false, off: true },
        { bus: '80', at: 13 * 60 + 58, on: true, off: false },
      ]),
      14 * 60 + 10
    );
    assert.equal(darcie[0].poweredOnAt, 6 * 60 + 26);
    assert.equal(darcie[1].poweredOnAt, 13 * 60 + 58);
    const earlyKey = indexPowerEvents([{ bus: '61', at: 6 * 60 + 22, on: true, off: false }]);
    assert.equal(powerOnForRun(earlyKey.get('61'), 6 * 60 + 25, 6 * 60 + 24), null);
    assert.equal(powerOnForRun(earlyKey.get('61'), 6 * 60 + 25, 6 * 60 + 25), 6 * 60 + 22);
    const afterClockOut = applyPowerOns(
      [
        { route: '10', bus: '61', run: 'AM', clockIn: '6:25', clockOut: '8:30' },
        { route: '10', bus: '61', run: 'PM', clockIn: '14:00', clockOut: '14:10' },
      ],
      indexPowerEvents([
        { bus: '61', at: 6 * 60 + 20, on: true, off: false },
        { bus: '61', at: 8 * 60 + 30, on: false, off: true },
        { bus: '61', at: 14 * 60 + 20, on: true, off: false },
        { bus: '61', at: 14 * 60 + 25, on: false, off: true },
      ]),
      15 * 60
    );
    assert.equal(afterClockOut[0].poweredOnAt, 6 * 60 + 20);
    assert.equal(afterClockOut[1].poweredOnAt, 14 * 60 + 20);
    const afternoonOnly = applyPowerOns(
      [
        { route: '10', bus: '61', run: 'AM', clockIn: '6:25', clockOut: '8:30' },
        { route: '10', bus: '61', run: 'PM', clockIn: '14:00', clockOut: '4:20' },
      ],
      indexPowerEvents([{ bus: '61', at: 14 * 60 + 5, on: true, off: false }]),
      15 * 60
    );
    assert.equal(afternoonOnly[0].poweredOnAt, '');
    assert.equal(afternoonOnly[1].poweredOnAt, 14 * 60 + 5);
    const late = darkBuses([powered[0]], 11 * 60, 1);
    assert.equal(late.length, 0);
    const started = darkBusLog([powered[0]], [], {}, 11 * 60, 1);
    assert.equal(started[0].verdict, 'Powered on');
    assert.match(started[0].detail, /Power On 10:02 AM was after the 9:56 AM deadline, so the alert closed/);
    const missed = darkBuses([{ ...powered[0], poweredOnAt: '' }], 11 * 60, 1);
    assert.equal(missed.length, 1);
    const first = rememberAlertTimes(null, missed, 11 * 60, '2026-11-19');
    assert.equal(first.times[darkBusKey(missed[0])], 9 * 60 + 56);
    const again = rememberAlertTimes(first, missed, 11 * 60 + 20, '2026-11-19');
    assert.equal(again.times[darkBusKey(missed[0])], 9 * 60 + 56);
    const shown = withAlertedAt(missed, again);
    assert.match(darkBusMarkup(shown), /Alerted 9:56 AM/);
    assert.doesNotMatch(darkBusMarkup(shown), /Power On/);
    assert.equal(darkBuses([powered[1]], 11 * 60, 1).length, 0);
  });

  it('explains bus 61 at a 6:50 clock-in with a one minute wait', () => {
    const bus61 = {
      route: '10',
      bus: '61',
      run: 'AM',
      clockIn: '6:50',
      clockOut: '9:05',
      poweredOnAt: '',
    };
    const atSixFifty = darkBusLog([bus61], [], {}, 6 * 60 + 50, 1);
    assert.equal(atSixFifty[0].verdict, 'Waiting');
    assert.match(atSixFifty[0].detail, /Due at 6:51 AM/);

    const missed = darkBusLog([bus61], [], {}, 6 * 60 + 51, 1);
    assert.equal(missed[0].verdict, 'Dark');
    assert.match(darkBusLogMarkup(missed, { nowMinutes: 6 * 60 + 51, graceMinutes: 1 }), /Bus 61/);
    assert.match(darkBusLogMarkup(missed, { nowMinutes: 6 * 60 + 51, graceMinutes: 1 }), /1 minute/);

    const onTime = darkBusLog([{ ...bus61, poweredOnAt: '6:50' }], [], {}, 6 * 60 + 51, 1);
    assert.equal(onTime[0].verdict, 'Powered on');

    const noStart = darkBusLog([{ ...bus61, clockIn: '' }], [], {}, 6 * 60 + 51, 1);
    assert.equal(noStart[0].verdict, 'No clock-in');

    const badStart = darkBusLog([{ ...bus61, clockIn: '6:50 AM' }], [], {}, 6 * 60 + 51, 1);
    assert.equal(badStart[0].verdict, 'No clock-in');
    assert.match(badStart[0].detail, /6:50 AM/);

    const key = darkBusKey({ bus: '61', route: '10', run: 'AM', clockIn: 6 * 60 + 50 });
    const dismissed = darkBusLog([bus61], [], {}, 6 * 60 + 51, 1, [key]);
    assert.equal(dismissed[0].verdict, 'Dismissed');

    const shop = darkBusLog(
      [bus61],
      [{ route: '10', run: '', usualBus: '61', spareBus: '7' }],
      { '7|am': { poweredOnAt: '6:48' } },
      6 * 60 + 51,
      1
    );
    assert.equal(shop[0].bus, '7');
    assert.match(shop[0].detail, /Usual bus 61 is out/);
    assert.equal(shop[0].verdict, 'Powered on');
  });

  it('stays quiet before clock-in and after a Power On by the deadline', () => {
    assert.equal(darkBuses([am], 6 * 60 + 10).length, 0);
    assert.equal(darkBuses([{ ...am, poweredOnAt: '6:14' }], 7 * 60).length, 0);
  });

  it('stops the alert once the run is over', () => {
    assert.equal(darkBuses([am], 10 * 60).length, 0);
    const open = { ...am, clockOut: '' };
    assert.equal(darkBuses([open], 7 * 60).length, 1);
    assert.equal(darkBuses([open], 6 * 60 + 15 + 180).length, 0);
  });

  it('honors a grace period and names the route when the bus number is missing', () => {
    assert.equal(darkBuses([am], 6 * 60 + 18, 5).length, 0);
    const alerts = darkBuses([{ ...am, bus: '' }], 6 * 60 + 30);
    assert.match(darkBusMarkup(alerts), /Route 12/);
    assert.doesNotMatch(darkBusMarkup(alerts), /Bus /);
  });
});

describe('out of service', () => {
  it('keeps one spare assignment per route and names the usual bus', () => {
    const once = addOutOfService([], { route: '12', usualBus: '42', spareBus: '7', note: 'In the shop' });
    const replaced = addOutOfService(once, { route: ' 12 ', usualBus: '42', spareBus: '9', note: '' });
    const both = addOutOfService(replaced, { route: '4', usualBus: '15', spareBus: '3', note: 'Flat' });
    assert.deepEqual(
      both.map((row) => [row.route, row.spareBus]),
      [
        ['4', '3'],
        ['12', '9'],
      ]
    );
    const markup = outOfServiceMarkup(both);
    assert.match(markup, /42-9/);
    assert.match(markup, /15-3/);
    assert.equal(markup.match(/42-9/g).length, 3);
    assert.doesNotMatch(markup, /Take down/);
    assert.equal(removeOutOfService(both, '12').length, 1);
    assert.match(outOfServiceMarkup([]), /No buses are out of service/);
    assert.throws(() => addOutOfService([], { route: '12', usualBus: '42', spareBus: '' }), /spare/);
    assert.match(outOfServiceMarkup([{ route: '12', usualBus: '42', spareBus: '', note: '' }]), /42-/);
    const morning = outOfServiceMarkup([
      { route: '6', usualBus: '11', spareBus: '45', run: 'AM' },
      { route: '12', usualBus: '49', spareBus: '9', run: 'PM' },
    ]);
    const am = morning.match(/aria-label="AM"[\s\S]*?<\/section>/)?.[0] || '';
    const mid = morning.match(/aria-label="MID"[\s\S]*?<\/section>/)?.[0] || '';
    const pm = morning.match(/aria-label="PM"[\s\S]*?<\/section>/)?.[0] || '';
    assert.match(am, /11-45/);
    assert.doesNotMatch(am, /49-9/);
    assert.match(mid, /board-oos-none/);
    assert.doesNotMatch(mid, /11-45|49-9/);
    assert.match(pm, /49-9/);
    assert.doesNotMatch(pm, /11-45/);
  });

  it('switches spare assignments so each out-of-service bus can get an appropriate bus', () => {
    const sped = [
      { bus: '38', kind: 'WC(2)' },
      { bus: '45', kind: 'WC(0)' },
    ];
    const reg = [{ bus: '9', kind: 'HDX 78P' }];
    const crossed = [
      { id: 's4', route: 'S 4', usualBus: '13', spareBus: '9', note: '', covers: 'indefinitely' },
      { id: '12', route: '12', usualBus: '49', spareBus: '38', note: 'Shop', covers: 2 },
    ];
    const swapped = applyOutOfServiceSpares(crossed, { sped: [{ bus: '38', kind: 'WC(2)' }], reg });
    assert.equal(swapped.find((row) => row.id === 's4').spareBus, '38');
    assert.equal(swapped.find((row) => row.id === '12').spareBus, '9');
    const switched = applyOutOfServiceSpares(crossed, { sped, reg });
    assert.equal(switched.find((row) => row.id === 's4').spareBus, '45');
    assert.equal(switched.find((row) => row.id === '12').spareBus, '9');
    const view = outOfServiceManagerView(crossed, { sped, reg });
    assert.match(view.summary, /2 buses are out of service/);
    assert.match(view.summary, /2 still need an appropriate spare/);
    assert.match(view.buses, /Route S 4/);
    assert.match(view.buses, /switch with route 12/);
    assert.match(view.spares, /Covering route S 4/);
    assert.match(view.spares, />Open</);
    assert.match(view.suggestions, /Switch assignments/);
    assert.match(view.suggestions, /bus 45, a sped spare \(WC\(0\)\)/);

    const openChair = applyOutOfServiceSpares(
      [
        { id: 's4', route: 'S 4', usualBus: '13', spareBus: '45', covers: '' },
        { id: '12', route: '12', usualBus: '49', spareBus: '9', covers: '' },
      ],
      { sped, reg, wheelchairs: { 's 4': 2 } }
    );
    assert.equal(openChair.find((row) => row.id === 's4').spareBus, '38');
    assert.equal(openChair.find((row) => row.id === '12').spareBus, '9');

    const kept = applyOutOfServiceSpares(
      [
        { id: 's4', route: 'S 4', usualBus: '13', spareBus: '', covers: '' },
        { id: '12', route: '12', usualBus: '49', spareBus: '38', covers: '' },
      ],
      { sped: [{ bus: '38', kind: 'WC(2)' }], reg: [] }
    );
    assert.equal(kept.find((row) => row.id === '12').spareBus, '38');
    assert.equal(kept.find((row) => row.id === 's4').spareBus, '');
    const short = outOfServiceManagerView(kept, { sped: [{ bus: '38', kind: 'WC(2)' }], reg: [] });
    assert.match(short.suggestions, /No open sped spare is left for route S 4/);
    assert.doesNotMatch(short.suggestions, /data-oos-apply/);

    const traded = assignOutOfServiceSpare(crossed, 's4', '38');
    assert.equal(traded.find((row) => row.id === 's4').spareBus, '38');
    assert.equal(traded.find((row) => row.id === '12').spareBus, '9');
    const cleared = placeOutOfServiceSpare(traded, '9', '');
    assert.equal(cleared.find((row) => row.id === '12').spareBus, '');
    const moved = placeOutOfServiceSpare(cleared, '9', '12');
    assert.equal(moved.find((row) => row.id === '12').spareBus, '9');
    assert.throws(() => assignOutOfServiceSpare(crossed, '12', '49'), /already out/);
    assert.throws(() => assignOutOfServiceSpare(crossed, 'missing', '9'), /no longer out of service/);
  });

  it('does not call an out-of-service bus dark, and watches the spare instead', () => {
    const routes = saveRouteBus([], { route: '12', bus: '42', run: 'AM', clockIn: '6:15', clockOut: '8:45' });
    const afternoon = saveRouteBus(routes, { route: '12', bus: '42', run: 'PM', clockIn: '14:00', clockOut: '16:20' });
    const elsewhere = saveRouteBus(afternoon, { route: '4', bus: '42', run: 'AM', clockIn: '6:15', clockOut: '8:45' });
    const out = addOutOfService([], { route: '12', usualBus: '42', spareBus: '7', note: 'In the shop' });
    const runs = boardRuns(elsewhere, []);

    const powered = watchOutOfService(runs, out, { '7|am': { poweredOnAt: '6:10' }, '7|pm': { poweredOnAt: '13:50' } });
    assert.equal(powered.find((run) => run.route === '12' && run.run === 'AM').bus, '7');
    assert.equal(darkBuses(powered, 7 * 60).length, 0);
    assert.equal(darkBuses(powered, 15 * 60).some((alert) => alert.bus === '42'), false);

    const dark = watchOutOfService(runs, out, {});
    const morning = darkBuses(dark, 7 * 60);
    assert.deepEqual(
      morning.map((alert) => [alert.bus, alert.route]),
      [['7', '12']]
    );
    assert.equal(dark.some((run) => run.route === '4'), false);

    const untouched = darkBuses(boardRuns(routes, []), 7 * 60);
    assert.equal(untouched[0].bus, '42');

    const byBus = addOutOfService([], { usualBus: '42', spareBus: '7' });
    const covered = watchOutOfService(runs, byBus, {});
    assert.equal(covered.find((run) => run.route === '12' && run.run === 'AM').bus, '7');
    assert.equal(covered.find((run) => run.route === '4' && run.run === 'AM').bus, '7');
    assert.equal(covered.some((run) => run.bus === '42'), false);
  });

  it('gives each part of the day its own spare, including a different spare on one day', () => {
    const saved = addOutOfService([], {
      usualBus: '11',
      spares: { AM: '45', MID: '', PM: '9' },
      days: { '2026-11-21': { AM: '12', MID: '', PM: '9' } },
      covers: 'indefinitely',
    });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].spareBus, '');
    assert.equal(spareForPortion(saved[0], 'AM', '2026-11-20'), '45');
    assert.equal(spareForPortion(saved[0], 'MID', '2026-11-20'), '');
    assert.equal(spareForPortion(saved[0], 'AM', '2026-11-21'), '12');
    const usual = outOfServiceMarkup(saved, '2026-11-20');
    const am = usual.match(/aria-label="AM"[\s\S]*?<\/section>/)?.[0] || '';
    const mid = usual.match(/aria-label="MID"[\s\S]*?<\/section>/)?.[0] || '';
    const pm = usual.match(/aria-label="PM"[\s\S]*?<\/section>/)?.[0] || '';
    assert.match(am, /aria-label="Bus 11 out, spare 45"/);
    assert.match(am, /11-45/);
    assert.match(mid, /aria-label="Bus 11 out, no spare"/);
    assert.match(mid, />11</);
    assert.doesNotMatch(mid, /11-/);
    assert.match(pm, /11-9/);
    const later = outOfServiceMarkup(saved, '2026-11-21');
    assert.match(later.match(/aria-label="AM"[\s\S]*?<\/section>/)?.[0] || '', /11-12/);
    assert.match(outOfServiceMarkup(saved, '2026-11-22'), /11-45/);

    const other = addOutOfService(saved, { usualBus: '49', spares: { AM: '', MID: '', PM: '45' } });
    const clear = sparePortionWarnings({
      spares: { AM: '', MID: '', PM: '45' },
      outOfService: saved,
      usualBus: '49',
    });
    assert.equal(clear.length, 0);
    const taken = sparePortionWarnings({
      spares: { AM: '45', MID: '', PM: '' },
      outOfService: saved,
      usualBus: '49',
    });
    assert.match(taken.join(' '), /Bus 45 is already the AM spare for bus 11/);
    const day = sparePortionWarnings({
      spares: { AM: '', MID: '', PM: '' },
      days: { '2026-11-21': { AM: '12', MID: '', PM: '' } },
      outOfService: saved,
      usualBus: '49',
    });
    assert.match(day.join(' '), /Bus 12 is already the AM spare for bus 11 on Nov 21/);

    const routes = saveRouteBus([], { route: '12', bus: '11', run: 'AM', clockIn: '6:15', clockOut: '8:45' });
    const afternoon = saveRouteBus(routes, { route: '12', bus: '11', run: 'PM', clockIn: '14:00', clockOut: '16:20' });
    const watched = watchOutOfService(boardRuns(afternoon, []), saved, {}, '2026-11-20');
    assert.equal(watched.find((run) => run.run === 'AM').bus, '45');
    assert.equal(watched.find((run) => run.run === 'PM').bus, '9');
    const moved = assignOutOfServiceSpare(saved, saved[0].id, '7', 'PM');
    assert.equal(moved[0].spares.AM, '45');
    assert.equal(moved[0].spares.PM, '7');
    assert.equal(moved[0].spares.MID, '');
    const view = outOfServiceManagerView(saved, { reg: [{ bus: '9', kind: '' }, { bus: '45', kind: '' }] });
    assert.match(view.buses, /data-oos-portion="AM"/);
    assert.match(view.buses, /data-oos-portion="PM"/);
    assert.match(view.buses, /Edit days/);
    assert.equal(other.length, 2);
  });
});

describe('bus assignments', () => {
  it('watches a bus by the time it usually starts, with or without a route', () => {
    const busOnly = savePairing([], { bus: '01', run: 'AM', clockIn: '6:15' });
    assert.equal(busOnly[0].route, '');
    assert.equal(busOnly[0].clockIn, '06:15');
    const withRoute = savePairing(busOnly, { bus: '01', route: '12', run: 'am', clockIn: '6:15', clockOut: '8:45' });
    assert.equal(withRoute.length, 1);
    const oneStart = savePairing([], { bus: '04', clockIn: '6:40' });
    const named = savePairing(oneStart, { id: oneStart[0].id, bus: '04', route: '8', run: 'AM', clockIn: '6:40' });
    assert.equal(named.length, 1);
    assert.equal(named[0].route, '8');
    assert.equal(withRoute[0].route, '12');
    assert.equal(withRoute[0].run, 'AM');
    assert.equal(withRoute[0].clockOut, '08:45');

    const afternoon = savePairing(withRoute, { bus: '01', route: '12', run: 'PM', clockIn: '14:00', clockOut: '16:20' });
    assert.equal(afternoon.length, 2);
    const moved = savePairing(afternoon, { bus: '07', route: '12', run: 'AM', clockIn: '6:20' });
    assert.equal(moved.find((row) => row.run === 'AM').bus, '07');
    assert.equal(removePairing(moved, moved.find((row) => row.run === 'PM').id).length, 1);
  });

  it('keeps a morning Power On from clearing the afternoon start', () => {
    const pairings = savePairing([], { bus: '01', run: 'PM', clockIn: '14:00' });
    const runs = pairingsToRuns(pairings, { '01|am': { poweredOnAt: '6:10' } });
    assert.equal(darkBuses(runs, 14 * 60 + 10).length, 1);
    const started = pairingsToRuns(pairings, { '01|pm': { poweredOnAt: '13:58' } });
    assert.equal(darkBuses(started, 14 * 60 + 10).length, 0);
  });

  it('rejects a pairing with no bus or no start time', () => {
    assert.throws(() => savePairing([], { bus: '', clockIn: '6:15' }), /bus number/);
    assert.throws(() => savePairing([], { bus: '01', clockIn: '' }), /start time/);
    assert.throws(() => savePairing([], { bus: '01', clockIn: '6:15', clockOut: 'later' }), /Clock-out/);
  });

  it('reads a route clock and a usual start, and lets the route win the same window', () => {
    assert.deepEqual(
      routeRunChoices({
        AM: { clock_in: '6:15', clock_out: '8:45' },
        MIDDAY: { clock_in: '11:00', clock_out: '12:10' },
        PM: { clock_in: '' },
      }).map((choice) => choice.run),
      ['AM', 'MID']
    );
    const routes = saveRouteBus([], { route: '12', bus: '11', run: 'AM', clockIn: '6:15', clockOut: '8:45' });
    const afternoon = saveUsualStart([], { bus: '11', run: 'PM', clockIn: '14:00' });
    const usual = saveUsualStart(afternoon, { bus: '11', clockIn: '6:20' });
    const watched = boardRuns(routes, usual);
    assert.deepEqual(
      watched.map((run) => [run.source, run.bus, run.route, run.run]),
      [
        ['route', '11', '12', 'AM'],
        ['usual', '11', '', 'PM'],
      ]
    );
    const alerts = darkBuses(watched, 14 * 60 + 10);
    const form = darkBusMarkup(alerts, { editable: true });
    assert.doesNotMatch(form, /data-spare-for/);
    assert.doesNotMatch(form, /Replace/);
    assert.match(form, /data-dark-dismiss="/);
    assert.match(form, />Dismiss</);
    const closed = darkBusMarkup(alerts, { acknowledged: alerts.map(darkBusKey) });
    assert.match(closed, /No dark buses right now/);
    assert.doesNotMatch(closed, /data-dark-dismiss/);
    assert.doesNotMatch(closed, /Usual start/);
    assert.doesNotMatch(darkBusMarkup(alerts), /Replace/);
    assert.match(darkBusMarkup(alerts), /Usual start/);
    assert.equal(spareReplacementReady('4', { days: 2 }), true);
    assert.equal(spareReplacementReady('4', 'indefinitely'), true);
    assert.equal(spareCovers('today'), 'today');
    assert.equal(spareCovers({ covers: 'today' }), 'today');
    assert.equal(spareReplacementReady('4', 'today'), true);
    assert.match(
      outOfServiceManagerView([{ id: 't', route: '4', usualBus: '11', spareBus: '9', note: '', covers: 'today' }]).buses,
      /Today only/
    );
    assert.equal(spareReplacementReady('  ', { days: 2 }), false);
    assert.equal(spareReplacementReady('4', null), false);
    assert.equal(spareReplacementReady('4', { days: 0 }), false);
    assert.throws(() => saveUsualStart([], { bus: '11', route: '12', clockIn: '6:15' }), /no route/);
  });

  it('replaces a dark bus with a spare and keeps the original bus if the spare is replaced again', () => {
    const routes = saveRouteBus([], { route: '12', bus: '11', run: 'AM', clockIn: '6:15', clockOut: '8:45' });
    const alert = darkBuses(boardRuns(routes, []), 7 * 60)[0];
    const once = sendSpare(routes, [], [], alert, '4', { days: 3 });
    assert.equal(once.routeBuses[0].bus, '4');
    assert.equal(once.outOfService[0].usualBus, '11');
    assert.equal(once.outOfService[0].spareBus, '4');
    assert.equal(once.outOfService[0].covers, 3);
    const morningBoard = outOfServiceMarkup(once.outOfService);
    assert.match(morningBoard.match(/aria-label="AM"[\s\S]*?<\/section>/)?.[0] || '', /11-4/);
    assert.doesNotMatch(morningBoard.match(/aria-label="PM"[\s\S]*?<\/section>/)?.[0] || '', /11-4/);
    const againAlert = darkBuses(boardRuns(once.routeBuses, []), 7 * 60)[0];
    const twice = sendSpare(once.routeBuses, [], once.outOfService, againAlert, '9', 'indefinitely');
    assert.equal(twice.routeBuses[0].bus, '9');
    assert.equal(twice.outOfService.length, 1);
    assert.equal(twice.outOfService[0].usualBus, '11');
    assert.equal(twice.outOfService[0].spareBus, '9');
    assert.equal(twice.outOfService[0].covers, 'indefinitely');
    assert.match(outOfServiceMarkup(twice.outOfService), /11-9/);
    assert.throws(() => sendSpare(routes, [], [], alert, '4'), /number of days/);
    assert.throws(() => sendSpare(routes, [], [], alert, '11', { days: 1 }), /different bus/);
    assert.throws(() => sendSpare(routes, [], [], { id: 'missing' }, '4', { days: 1 }), /no longer being watched/);
  });
});

describe('available drivers', () => {
  const routeNote = 'LOW, SHS/BHS, LOW';
  const rhys = [
    { route: '10', driver: 'Rhys', bus: '61', run: 'AM', clockIn: '6:20', clockOut: '9:00', note: routeNote },
    { route: '10', driver: 'Rhys', bus: '61', run: 'PM', clockIn: '14:00', clockOut: '16:30', note: routeNote },
  ];
  const angela = {
    route: '68',
    driver: 'Angela',
    bus: '1',
    run: 'AM',
    clockIn: '6:25',
    clockOut: '9:20',
    note: 'AW, BHS/LOW, BHS',
  };

  it('lists only drivers who are empty or back early', () => {
    const drivers = availableDrivers([...rhys, angela, { ...am, driver: '' }], 8 * 60, [
      { fleet: '61', zone: 'Sehome' },
    ]);
    assert.deepEqual(
      drivers.map((driver) => [driver.route, driver.driver, driver.status]),
      [['10', 'Rhys', 'Empty']]
    );
    assert.equal(drivers[0].clockOut, 9 * 60);
    const markup = availableMarkup(drivers);
    assert.match(markup, /Rhys/);
    assert.match(markup, /Empty/);
    assert.match(markup, /9:00 AM/);
    assert.match(markup, /Clock out/);
    assert.doesNotMatch(markup, /Angela/);
    assert.equal(normalizeEarlyMinutes(null), 15);
    assert.equal(normalizeEarlyMinutes({ minutes: 200 }), 180);
    assert.equal(normalizeEarlyMinutes('soon'), 15);
  });

  it('uses Empty at the morning school and Back Early only for an early return', () => {
    const yard = [{ fleet: '01', zone: 'Transportation' }];
    assert.equal(availableDrivers([angela], 8 * 60, yard).length, 0);
    assert.equal(isSchoolZone('Lowell'), true);
    assert.equal(isSchoolZone('Sehome High School'), true);
    assert.equal(isSchoolZone('Columbia'), true);
    assert.equal(isSchoolZone('Bellingham High (South)'), true);
    assert.equal(isSchoolZone('Fraser St'), false);
    assert.equal(isSchoolZone('propane'), false);
    assert.equal(isSchoolZone('Warehouse / Kitchen'), false);
    assert.equal(isSchoolZone('AldrichNW-COR'), false);
    for (const zone of ['Fraser St', 'propane', 'Warehouse / Kitchen', 'AldrichNW-COR']) {
      assert.deepEqual(noteSchoolVisits([angela], 8 * 60, [{ fleet: '01', zone }]), []);
    }
    const school = [{ fleet: '01', zone: 'Bellingham High (South)' }];
    assert.deepEqual(noteSchoolVisits([angela], 8 * 60, [{ fleet: '01', zone: 'Alderwood' }]), []);
    const left = noteSchoolVisits([angela], 8 * 60, school);
    assert.deepEqual(left, ['68|am|1']);
    assert.equal(availableDrivers([angela], 8 * 60, school, left)[0].status, 'Empty');
    assert.deepEqual(noteYardReturns([angela], 8 * 60, school, left), []);
    const returned = noteYardReturns([angela], 8 * 60, yard, left);
    assert.deepEqual(returned, [{ key: '68|am|1', at: 8 * 60 }]);
    const back = availableDrivers([angela], 8 * 60, yard, left, 15, returned);
    assert.equal(back[0].status, 'Back Early');
    const late = availableDrivers([angela], 9 * 60 + 10, yard, left, 15, [{ key: '68|am|1', at: 9 * 60 + 10 }]);
    assert.equal(late.length, 0);
    const stillEarly = availableDrivers([angela], 9 * 60 + 10, yard, left, 15, returned);
    assert.equal(stillEarly[0].status, 'Back Early');
    const pmRun = {
      route: '68',
      driver: 'Angela',
      bus: '1',
      run: 'PM',
      clockIn: '14:00',
      clockOut: '16:30',
      note: 'AW, BHS/LOW, BHS',
    };
    assert.deepEqual(noteSchoolVisits([pmRun], 15 * 60, [{ fleet: '01', zone: 'Lowell' }]), []);
    const pmLeft = noteSchoolVisits([pmRun], 15 * 60, school);
    assert.deepEqual(pmLeft, ['68|pm|1']);
    assert.equal(availableDrivers([pmRun], 15 * 60, school, pmLeft)[0].status, 'Empty');
    const pmBack = noteYardReturns([pmRun], 15 * 60 + 40, yard, pmLeft);
    assert.equal(availableDrivers([pmRun], 15 * 60 + 40, yard, pmLeft, 15, pmBack)[0].status, 'Back Early');
    assert.equal(availableDrivers([angela, pmRun], 15 * 60, yard, left).length, 0);
    const finished = availableDrivers([{ ...angela, inYard: true }], 9 * 60 + 10, yard, left, 15, [
      { key: '68|am|1', at: 9 * 60 + 10 },
    ]);
    assert.equal(finished.length, 0);
    const afternoon = availableDrivers(rhys, 15 * 60, [{ fleet: '61', zone: 'Bellingham High (South)' }]);
    assert.equal(afternoon.length, 0);
    const done = availableDrivers([rhys[1]], 15 * 60, [{ fleet: '61', zone: 'Lowell' }]);
    assert.equal(done[0].status, 'Empty');
    const midday = {
      route: '50',
      driver: 'Angela',
      bus: '1',
      run: 'MID',
      clockIn: '11:00',
      clockOut: '12:30',
      note: 'NH, SMS/NH, SMS, MD BW',
    };
    assert.deepEqual(noteSchoolVisits([midday], 11 * 60 + 30, [{ fleet: '01', zone: 'Shuksan' }]), []);
    assert.deepEqual(noteSchoolVisits([midday], 11 * 60 + 30, [{ fleet: '01', zone: 'Birchwood' }]), ['50|mid|1']);
    assert.match(availableMarkup([]), /No drivers are available/);
  });

  it('reassigns a Zonar bus to a route and uses that route’s Time Changes clock-out', () => {
    const saved = saveRouteBus([], { route: '10', bus: '61', run: 'AM', clockIn: '6:20', clockOut: '9:00' });
    const withPm = saveRouteBus(saved, { route: '10', bus: '61', run: 'PM', clockIn: '14:00', clockOut: '16:30' });
    const schedules = [
      {
        route: '10',
        runs: [
          { run: 'AM', clockIn: '6:25', clockOut: '9:05' },
          { run: 'PM', clockIn: '14:10', clockOut: '16:40' },
        ],
      },
      { route: '12', runs: [{ run: 'AM', clockIn: '6:15', clockOut: '8:45' }] },
    ];
    const sheet = availableBusSheet(withPm, schedules);
    assert.equal(sheet.find((row) => row.route === '10' && row.run === 'AM').bus, '61');
    assert.equal(sheet.find((row) => row.route === '10' && row.run === 'AM').clockOut, '09:05');
    assert.equal(sheet.find((row) => row.route === '12' && row.run === 'AM').bus, '');
    assert.equal(sheet.some((row) => row.run === 'MID'), false);
    const markup = availableBusSheetMarkup(sheet);
    assert.match(markup, /9:05 AM/);
    assert.match(markup, /data-route="10"/);
    assert.match(markup, /data-run="AM"/);
    assert.match(markup, /value="61"/);
    assert.match(markup, /Bus for route 10 AM/);

    const posted = savePostedBus([], { route: '4', bus: '86' });
    const postedSheet = availableBusSheet(posted, [
      { route: '4', runs: [{ run: 'AM', clockIn: '6:20', clockOut: '8:40' }] },
    ]);
    assert.equal(postedSheet[0].bus, '86');
    assert.equal(postedSheet[0].clockOut, '08:40');
    assert.match(availableBusSheetMarkup([]), /No route clock-outs yet/);

    const clocks = (route) =>
      route === '10'
        ? [
            { run: 'AM', clockIn: '6:25', clockOut: '9:05' },
            { run: 'PM', clockIn: '14:10', clockOut: '16:40' },
          ]
        : [];
    assert.equal(applyScheduleClocks(withPm, () => []), withPm);
    const reassigned = assignRouteBuses(
      withPm,
      [
        { route: '10', run: 'AM', bus: '70' },
        { route: '10', run: 'PM', bus: '61' },
      ],
      clocks
    );
    const synced = applyScheduleClocks(reassigned.list, clocks);
    assert.equal(synced.find((row) => row.run === 'AM').bus, '70');
    assert.equal(synced.find((row) => row.run === 'AM').clockIn, '06:20');
    assert.equal(synced.find((row) => row.run === 'AM').clockOut, '09:05');
    assert.equal(synced.find((row) => row.run === 'PM').clockOut, '16:40');

    const runs = pairingsToRuns(synced).map((run) => ({ ...run, driver: 'Rhys', note: 'SHS, LOW/BHS' }));
    const drivers = availableDrivers(runs, 8 * 60, [{ fleet: '70', zone: 'Lowell' }]);
    assert.equal(drivers.length, 1);
    assert.equal(drivers[0].route, '10');
    assert.equal(drivers[0].bus, '70');
    assert.equal(drivers[0].status, 'Empty');
    assert.equal(drivers[0].clockOut, 9 * 60 + 5);
    assert.equal(availableDrivers(runs, 8 * 60, [{ fleet: '61', zone: 'Lowell' }]).length, 0);
  });
});

describe('absent students', () => {
  const roster = [
    { name: 'Maya Chen', route: '12' },
    { name: 'Maya Lopez', route: '7' },
    { name: 'Jonah Hale', route: '12' },
  ];

  it('looks a name up across routes', () => {
    assert.deepEqual(lookupStudents(roster, 'maya').map((student) => student.route), ['12', '7']);
    assert.equal(lookupStudents(roster, '   ').length, 0);
  });

  it('posts the name with the route and keeps a second call from duplicating it', () => {
    const once = postAbsence([], { name: 'Maya Chen', route: '12', date: '2026-11-16', when: 'AM' });
    const twice = postAbsence(once, { name: '  maya chen ', route: '12', date: '2026-11-16', when: 'PM' });
    assert.equal(twice.length, 1);
    assert.equal(twice[0].when, 'PM');
    assert.equal(absencesForDate(twice, '2026-11-17').length, 0);
    const markup = absenceMarkup(absencesForDate(twice, '2026-11-16'));
    assert.match(markup, /Maya Chen/);
    assert.match(markup, /board-route-name">12/);
    assert.doesNotMatch(markup, /Take down|Update|Both|Edit|Delete/);
    assert.equal(removeAbsence(twice, twice[0].id).length, 0);
    const bothDays = postAbsenceDays([], {
      name: 'Maya Chen',
      route: 'S 05',
      dates: ['2026-11-16', '2026-11-17'],
      when: 'BOTH',
    });
    const morningsGone = removeAbsencePortion(bothDays, { name: 'Maya Chen', route: 'S 05', portion: 'AM' });
    assert.deepEqual(
      morningsGone.map((row) => row.when),
      ['PM', 'PM']
    );
    assert.deepEqual(removeAbsencePortion(morningsGone, { name: 'Maya Chen', route: 'S 05', portion: 'PM' }), []);
    assert.match(absenceMarkup([]), /No absent students/);
    const midday = postAbsence([], { name: 'Luis Ortiz', route: '12', date: '2026-11-16', when: 'MID' });
    assert.equal(midday[0].when, 'MID');
    const allDay = postAbsence(midday, { name: 'Luis Ortiz', route: '12', date: '2026-11-16', when: ['AM', 'MID', 'PM'] });
    assert.equal(allDay[0].when, 'AM,MID,PM');
    assert.equal(removeAbsencePortion(allDay, { name: 'Luis Ortiz', route: '12', portion: 'MID' })[0].when, 'BOTH');
    assert.throws(() => postAbsence([], { name: 'Maya', route: '12', date: '2026-11-16', when: 'noon' }), /AM, mid day, or PM/);
  });

  it('shows only routes that have an absent student, in numerical order', () => {
    const routes = ['12', 'S 10', 's 02', 'SHS', 'S-04', 'S1', '50', 'S 02'];
    assert.equal(isSpedRoute('S-04'), true);
    assert.equal(isSpedRoute('s-12'), true);
    assert.equal(isSpedRoute('S 02'), true);
    assert.equal(isSpedRoute('S1'), true);
    assert.equal(isSpedRoute('12'), false);
    assert.equal(isSpedRoute('SHS'), false);
    assert.equal(isSpedRoute('SB'), false);

    assert.deepEqual(absentRouteGroups([], routes), []);
    const clear = absenceMarkup([], { routes });
    assert.match(clear, /No absent students/);
    assert.doesNotMatch(clear, /None|board-route-name/);
    assert.equal(absentRouteNumber('S 01'), '01');
    assert.equal(absentRouteNumber('S-04'), '04');
    assert.equal(absentRouteNumber('S1'), '1');

    const posted = absentRouteGroups(
      [
        { id: 'maya', name: 'Maya Chen', route: 'S 10' },
        { id: 'jonah', name: 'Jonah Hale', route: '12' },
        { id: 'ava', name: 'Ava Singh', route: 'S 03' },
      ],
      routes
    );
    assert.deepEqual(
      posted.map((group) => [group.route, group.students.map((student) => student.name)]),
      [
        ['S 03', ['Ava Singh']],
        ['S 10', ['Maya Chen']],
        ['12', ['Jonah Hale']],
      ]
    );
    const markup = absenceMarkup(
      [
        { id: 'maya', name: 'Maya Chen', route: 'S 10' },
        { id: 'jonah', name: 'Jonah Hale', route: '12' },
      ],
      { routes }
    );
    assert.match(markup, /Maya Chen/);
    assert.match(markup, /Jonah Hale/);
    assert.doesNotMatch(markup, /None|data-absence-edit|Both|Edit|Delete|board-route-name">02/);
    assert.ok(markup.indexOf('board-route-name">10') < markup.indexOf('board-route-name">12'));
    const editing = absenceMarkup(
      [{ id: 'maya', name: 'Maya Chen', route: 'S 10', when: 'BOTH' }],
      { routes, controls: true }
    );
    assert.match(editing, /data-absence-edit="maya"/);
    assert.match(editing, /data-absence-portion="AM"/);
    assert.match(editing, /data-absence-portion="PM"/);
    assert.doesNotMatch(editing, /data-absence-portion="MID"/);
    assert.match(editing, />Edit</);
    assert.match(editing, />Delete</);
    assert.doesNotMatch(editing, /Both/);
  });

  it('lists the routes that have absences from lowest number to highest', () => {
    const routes = ['S 01', 'S 02', 'S 03', 'S 04', 'S 05', 'S 06'];
    const board = absentColumns(
      [
        { id: 'a', name: 'Jonah Hale', route: '57' },
        { id: 'b', name: 'Maya Chen', route: '12' },
        { id: 'c', name: 'Ava Singh', route: '50' },
        { id: 'd', name: 'Luis Ortiz', route: '14' },
        { id: 'e', name: 'Riley Cho', route: 'S 05' },
      ],
      routes
    );
    assert.equal(board.lines, 3);
    assert.deepEqual(
      board.columns.map((column) => column.routes.map((group) => group.route)),
      [
        ['S 05', '14', '57'],
        ['12', '50'],
      ]
    );
    const markup = absenceMarkup(
      [
        { id: 'b', name: 'Maya Chen', route: 'S 02' },
        { id: 'a', name: 'Jonah Hale', route: 'S 01' },
      ],
      { routes }
    );
    assert.match(markup, /--board-lines:1/);
    assert.ok(markup.indexOf('board-route-name">01') < markup.indexOf('board-route-name">02'));
    assert.doesNotMatch(markup, /None|board-route-name">03|board-route-name">04/);
    assert.equal(absentRouteColor('S 01'), absentRouteColor('S-01'));
    assert.equal(absentRouteColor('S 01'), absentRouteColor('1'));
    assert.notEqual(absentRouteColor('S 01'), absentRouteColor('S 02'));
    assert.equal(absentRouteBorder('S 05'), absentRouteBorder('S 05'));
    assert.match(markup, new RegExp(`background-color:${absentRouteColor('S 01').replace(/[()]/g, '\\$&')}`));
    assert.match(markup, new RegExp(`background-color:${absentRouteColor('S 02').replace(/[()]/g, '\\$&')}`));
  });

  it('keeps AM, mid day, and PM on one board, separated inside each route', () => {
    const rows = [
      { id: 'am', name: 'Maya Chen', route: 'S 05', when: 'AM' },
      { id: 'mid', name: 'Luis Ortiz', route: 'S 05', when: 'MID' },
      { id: 'pm', name: 'Jonah Hale', route: 'S 05', when: 'PM' },
      { id: 'both', name: 'Ava Singh', route: 'S 01', when: 'BOTH' },
    ];
    const markup = absenceMarkup(rows, { routes: ['S 01', 'S 05'] });
    const cards = markup.split('<article').slice(1);
    const first = cards.find((card) => card.includes('board-route-name">01'));
    const fifth = cards.find((card) => card.includes('board-route-name">05'));
    assert.match(first, /board-period-am[\s\S]*Ava Singh/);
    assert.match(first, /board-period-pm[\s\S]*Ava Singh/);
    assert.doesNotMatch(first, /Mid day/);
    assert.match(fifth, /board-period-am[\s\S]*Maya Chen/);
    assert.match(fifth, /board-period-mid[\s\S]*Luis Ortiz/);
    assert.match(fifth, /board-period-pm[\s\S]*Jonah Hale/);
    assert.ok(fifth.indexOf('board-period-am') < fifth.indexOf('board-period-mid'));
    assert.ok(fifth.indexOf('board-period-mid') < fifth.indexOf('board-period-pm'));
    assert.doesNotMatch(markup, /Absent students AM|Absent students PM|Both/);
  });

  it('keeps each chosen day on its own date', () => {
    const days = toggleAbsenceDay(['2026-11-17'], '2026-11-19');
    assert.deepEqual(days, ['2026-11-17', '2026-11-19']);
    assert.deepEqual(toggleAbsenceDay(days, '2026-11-17'), ['2026-11-19']);
    assert.equal(absenceDayLabel(1), '1 day');
    assert.equal(absenceDayLabel(3), '3 days');
    const posted = postAbsenceDays([], {
      name: 'Casey Ng',
      route: 'S 05',
      dates: ['2026-11-17', '2026-11-19', 'nope'],
      when: 'AM',
    });
    assert.deepEqual(
      posted.map((row) => row.date),
      ['2026-11-17', '2026-11-19']
    );
    assert.equal(absencesForDate(posted, '2026-11-19')[0].name, 'Casey Ng');
    assert.equal(absencesForDate(posted, '2026-11-18').length, 0);
    const byDay = postAbsenceDays([], {
      name: 'Casey Ng',
      route: 'S 05',
      days: [
        { date: '2026-11-18', when: ['AM', 'MID', 'PM'] },
        { date: '2026-11-17', when: 'AM' },
      ],
    });
    assert.deepEqual(
      byDay.map((row) => [row.date, row.when]),
      [
        ['2026-11-17', 'AM'],
        ['2026-11-18', 'AM,MID,PM'],
      ]
    );
    assert.throws(() => postAbsenceDays([], { name: 'Casey Ng', route: 'S 05', dates: [], when: 'AM' }), /at least one day/);
    const changed = replaceAbsenceSchedule(posted, {
      name: 'Casey Ng',
      route: 'S 05',
      dates: ['2026-11-18', '2026-11-19'],
      when: 'PM',
      previousName: 'Casey Ng',
      previousRoute: 'S 05',
    });
    assert.deepEqual(
      absenceSchedule(changed, { name: 'Casey Ng', route: 'S 05' }).map((row) => [row.date, row.when]),
      [
        ['2026-11-18', 'PM'],
        ['2026-11-19', 'PM'],
      ]
    );
    assert.equal(absenceSchedule(changed, { name: 'Casey Ng', route: 'S 05' }).some((row) => row.date === '2026-11-17'), false);
    const cleared = replaceAbsenceSchedule(changed, {
      name: 'Casey Ng',
      route: 'S 05',
      dates: [],
      when: 'PM',
      previousName: 'Casey Ng',
      previousRoute: 'S 05',
    });
    assert.deepEqual(absenceSchedule(cleared, { name: 'Casey Ng', route: 'S 05' }), []);
  });

  it('posts a note on a route without replacing a student of the same words', () => {
    const note = postAbsence([], {
      name: 'Wheelchair pickup',
      route: '12',
      date: '2026-11-20',
      when: 'AM',
      kind: 'note',
    });
    const both = postAbsence(note, {
      name: 'Wheelchair pickup',
      route: '12',
      date: '2026-11-20',
      when: 'PM',
    });
    assert.equal(both.length, 2);
    assert.equal(both.find((row) => row.kind === 'note').when, 'AM');
    assert.equal(both.find((row) => row.kind !== 'note').when, 'PM');
    const markup = absenceMarkup(both);
    assert.match(markup, /class="board-student is-note"/);
    assert.match(markup, /board-note-tag">Note</);
    assert.match(markup, /Wheelchair pickup/);
    const noteGone = removeAbsencePortion(both, {
      name: 'Wheelchair pickup',
      route: '12',
      portion: 'AM',
      kind: 'note',
    });
    assert.equal(noteGone.length, 1);
    assert.equal(noteGone[0].kind, undefined);
    const studentKept = replaceAbsenceSchedule(both, {
      name: 'Meet the driver',
      route: '12',
      dates: ['2026-11-21'],
      when: 'PM',
      kind: 'note',
      previousName: 'Wheelchair pickup',
      previousRoute: '12',
      previousKind: 'note',
    });
    assert.equal(studentKept.filter((row) => row.kind !== 'note').length, 1);
    assert.equal(absenceSchedule(studentKept, { name: 'Meet the driver', route: '12', kind: 'note' })[0].date, '2026-11-21');
    assert.equal(absenceSchedule(studentKept, { name: 'Wheelchair pickup', route: '12' }).length, 1);
    const cells = calendarCells(2026, 10, ['2026-11-17']);
    assert.equal(cells.length, 42);
    assert.equal(cells.find((cell) => cell.date === '2026-11-17').selected, true);
    assert.equal(cells.find((cell) => cell.date === '2026-11-17').inMonth, true);
  });

  it('finds a route from its number or from the bus, and remembers the name', () => {
    const routes = ['S 05', 'S 07', '12'];
    const buses = [
      { bus: '42', route: 'S 05', run: 'AM' },
      { bus: '42', route: 'S 07', run: 'PM' },
      { bus: '18', route: 'S 05', run: 'PM' },
    ];
    assert.deepEqual(resolveAbsenceRoute(routes, buses, { route: '05' }, 'AM'), [{ route: 'S 05', when: 'AM' }]);
    assert.deepEqual(resolveAbsenceRoute(routes, buses, { route: 'S 05' }, 'BOTH'), [{ route: 'S 05', when: 'BOTH' }]);
    assert.deepEqual(resolveAbsenceRoute(routes, buses, { bus: '18' }, 'PM'), [{ route: 'S 05', when: 'PM' }]);
    assert.deepEqual(
      resolveAbsenceRoute(routes, [{ bus: '85', route: '5', run: 'AM' }], { bus: '85' }, 'AM'),
      [{ route: 'S 05', when: 'AM' }]
    );
    assert.deepEqual(
      resolveAbsenceRoute(['85', 'S 05'], [{ bus: '85', route: '5', run: 'AM' }], { route: '85' }, 'AM'),
      [{ route: '85', when: 'AM' }]
    );
    assert.deepEqual(resolveAbsenceRoute(routes, buses, { bus: '42' }, 'BOTH'), [
      { route: 'S 05', when: 'AM' },
      { route: 'S 07', when: 'PM' },
    ]);
    assert.deepEqual(
      resolveAbsenceRoute(
        routes,
        [
          { bus: '42', route: 'S 05', run: 'AM' },
          { bus: '42', route: 'S 05', run: 'MID' },
          { bus: '42', route: 'S 07', run: 'PM' },
        ],
        { bus: '42' },
        ['AM', 'MID', 'PM']
      ),
      [
        { route: 'S 05', when: 'AM,MID' },
        { route: 'S 07', when: 'PM' },
      ]
    );
    assert.deepEqual(resolveAbsenceRoute(routes, buses, { route: 'S 05' }, 'MID'), [{ route: 'S 05', when: 'MID' }]);
    assert.throws(() => resolveAbsenceRoute(routes, buses, { route: '12', bus: '18' }, 'PM'), /not on that route/);
    assert.throws(() => resolveAbsenceRoute(routes, buses, {}, 'AM'), /route number or a bus/);
    assert.throws(() => resolveAbsenceRoute(routes, buses, { bus: '99' }, 'AM'), /not on a route/);
    assert.throws(() => resolveAbsenceRoute(routes, buses, { route: '99' }, 'AM'), /not on the board/);
    assert.equal(pairedAbsenceBus(routes, buses, 'S 05'), '');
    assert.equal(pairedAbsenceBus(routes, [{ bus: '42', route: 'S 05', run: 'AM' }, { bus: '42', route: 'S 05', run: 'PM' }], '05'), '42');
    assert.equal(pairedAbsenceBus(routes, [{ bus: '70', route: '12', run: 'AM' }, { bus: '71', route: '12', run: 'PM' }], '12'), '');
    assert.equal(pairedAbsenceRoute(routes, buses, '18'), 'S 05');
    assert.equal(pairedAbsenceRoute(routes, buses, '42'), '');
    assert.equal(pairedAbsenceRoute(routes, buses, '99'), '');
    const regularAndSped = ['S 01', '1'];
    const routeOne = [{ bus: '60', route: '1', run: 'AM' }];
    assert.equal(pairedAbsenceBus(regularAndSped, routeOne, '1'), '60');
    assert.equal(pairedAbsenceBus(regularAndSped, routeOne, 'S 01'), '');
    assert.equal(pairedAbsenceRoute(regularAndSped, routeOne, '60'), '1');
    assert.deepEqual(resolveAbsenceRoute(regularAndSped, routeOne, { route: '1', bus: '60' }, 'AM'), [{ route: '1', when: 'AM' }]);
    assert.deepEqual(resolveAbsenceRoute(regularAndSped, routeOne, { route: '1' }, 'AM'), [{ route: '1', when: 'AM' }]);
    assert.deepEqual(
      absencePortionPosts(
        routes,
        buses,
        [
          { portion: 'AM', route: '12' },
          { portion: 'MID', route: '', bus: '' },
          { portion: 'PM', bus: '18' },
        ],
        ['AM', 'PM']
      ),
      [
        { route: '12', when: 'AM' },
        { route: 'S 05', when: 'PM' },
      ]
    );
    assert.deepEqual(
      absencePortionPosts(routes, buses, [
        { portion: 'AM', route: '12' },
        { portion: 'PM', route: '12' },
      ], ['AM', 'PM']),
      [{ route: '12', when: 'BOTH' }]
    );
    assert.throws(
      () => absencePortionPosts(routes, buses, [{ portion: 'AM', route: '12' }], ['AM', 'MID']),
      /bus or route for mid day/
    );
    const split = postAbsence([], { name: 'Maya Chen', route: '12', date: '2026-11-20', when: 'AM' });
    const bothRoutes = postAbsence(split, { name: 'Maya Chen', route: 'S 05', date: '2026-11-20', when: 'PM' });
    assert.deepEqual(
      absenceSchedules(bothRoutes, { name: 'Maya Chen' }).map((row) => [row.route, row.when]),
      [
        ['12', 'AM'],
        ['S 05', 'PM'],
      ]
    );
    const remembered = rememberStudent([], { name: 'Ava Singh', route: 'S 05' });
    assert.deepEqual(rememberedNames(remembered), ['Ava Singh']);
    assert.deepEqual(rememberedNames(rememberStudent(remembered, { name: 'Ava Singh', route: 'S 07' })), ['Ava Singh']);
  });

  it('remembers a new student for the next phone call', () => {
    const next = rememberStudent(roster, { name: 'Ava Singh', route: '18' });
    assert.equal(lookupStudents(next, 'ava')[0].route, '18');
    assert.throws(() => rememberStudent(roster, { name: 'Ava', route: '' }), /route/);
    assert.equal(formatBoardClock(16 * 60 + 5), '4:05 PM');
  });
});

describe('posted route buses', () => {
  const clocks = (route) => {
    if (route === '10') {
      return [
        { run: 'AM', clockIn: '6:20', clockOut: '9:00' },
        { run: 'PM', clockIn: '14:00', clockOut: '16:30' },
      ];
    }
    if (route === '50') return [{ run: 'AM', clockIn: '6:25', clockOut: '9:20' }];
    return [];
  };

  it('reads the hallway By Route # sheet', () => {
    const bus = (route) => POSTED_ROUTE_BUSES.find((row) => row.route === route)?.bus;
    assert.equal(bus('10'), '61');
    assert.equal(bus('24'), '42');
    assert.equal(bus('50'), '82');
    assert.equal(bus('51'), '3');
    assert.equal(bus('68'), '1');
    assert.equal(bus('89'), '62');
    assert.equal(bus('26'), undefined);
    assert.equal(POSTED_ROUTE_BUSES.filter((row) => !row.driver).map((row) => row.route).join(','), '22,23,24,25,56');
    assert.equal(POSTED_SPED_SPARES.find((row) => row.route === '57').spare, 'A-24P');
    assert.equal(POSTED_REG_ED_SPARES.find((row) => row.bus === '9').kind, 'HDX 78P');
  });

  it('seeds saved clocks, keeps an edited bus, and lists a route that has no clock', () => {
    const seeded = seedPostedRouteBuses([], clocks);
    assert.deepEqual(
      seeded.filter((row) => row.clockIn).map((row) => [row.route, row.bus, row.run]),
      [
        ['10', '61', 'AM'],
        ['50', '82', 'AM'],
        ['10', '61', 'PM'],
      ]
    );
    assert.equal(seeded.find((row) => row.route === '24').bus, '42');
    assert.equal(seeded.find((row) => row.route === '24').clockIn, '');
    assert.equal(seeded.find((row) => row.route === '9').bus, '37');
    const edited = [{ route: '50', bus: '11', run: 'AM', clockIn: '06:25', clockOut: '09:20' }];
    const next = seedPostedRouteBuses(edited, clocks);
    assert.equal(next.find((row) => row.route === '50').bus, '11');
    assert.equal(next.filter((row) => row.route === '50').length, 1);
    assert.equal(next.find((row) => row.route === '10' && row.run === 'AM').bus, '61');
    assert.equal(seedPostedRouteBuses([], () => []).find((row) => row.route === '68').bus, '1');
  });
});

describe('student check alerts', () => {
  const pm = { route: '12', bus: '40', run: 'PM', clockIn: 14 * 60, clockOut: 17 * 60, driver: 'Ada' };
  const school = [{ fleet: '40', zone: 'Bellingham High' }];
  const yard = [{ fleet: '40', zone: 'Transportation' }];
  const visits = ['12|pm|40'];
  const returns = [{ key: '12|pm|40', at: 16 * 60 }];

  it('starts the wait at 10 minutes', () => {
    assert.equal(normalizeStudentCheckAlert(null).graceMinutes, 10);
    assert.equal(normalizeStudentCheckAlert({ graceMinutes: 90 }).graceMinutes, 60);
    assert.equal(normalizeStudentCheckAlert({ graceMinutes: -4 }).graceMinutes, 0);
    assert.equal(studentCheckScreen(8 * 60, { midAt: '09:30', pmAt: '13:00' }), 'MID');
    assert.equal(studentCheckScreen(14 * 60, { midAt: '09:30', pmAt: '13:00' }), 'PM');
  });

  it('remembers a school visit on Mid Day or PM, and the yard return after clock-out', () => {
    assert.deepEqual(studentCheckSchoolVisits([pm], 15 * 60, school, []), visits);
    assert.deepEqual(studentCheckSchoolVisits([{ ...pm, run: 'AM' }], 15 * 60, school, []), []);
    assert.deepEqual(studentCheckSchoolVisits([pm], 15 * 60, [{ fleet: '40', zone: 'Transportation' }], []), []);
    const back = studentCheckYardReturns([pm], 17 * 60 + 5, yard, visits, []);
    assert.equal(back[0].at, 17 * 60 + 5);
  });

  it('counts a standalone Student Check and a Post Trip that includes the zone', () => {
    assert.equal(isStudentCheckConfig('STUDENT CHECK'), true);
    assert.equal(isStudentCheckConfig('Child Check'), true);
    assert.equal(isStudentCheckConfig('BUS POST-TRIP'), false);
    assert.equal(isStudentCheckConfig('BUS C-2 PRE-TRIP'), false);
    const postTrip = {
      fleet: '40',
      label: 'BUS POST-TRIP',
      verified: true,
      endAt: 16 * 60 + 20,
      studentZone: { name: 'INSIDE BUS/STUDENT CHECK', endAt: 16 * 60 + 8 },
    };
    assert.equal(countsAsStudentCheck(postTrip), true);
    assert.equal(countsAsStudentCheck({ fleet: '40', label: 'BUS POST-TRIP', verified: true, endAt: 16 * 60 + 4 }), false);
    const runs = [pm, { ...pm, run: 'MID', clockIn: 11 * 60, clockOut: 13 * 60 }];
    const checks = studentChecksByRun(runs, [
      { fleet: '040', label: 'BUS POST-TRIP', verified: true, endAt: 16 * 60 + 4 },
      { fleet: '40', label: 'STUDENT CHECK', verified: false, endAt: 16 * 60 + 5 },
      { fleet: '40', label: 'STUDENT CHECK', verified: true, endAt: 12 * 60 },
      postTrip,
    ]);
    assert.equal(checks.get('12|mid|40').endAt, 12 * 60);
    assert.equal(checks.get('12|pm|40').endAt, 16 * 60 + 8);
  });

  it('alerts after the wait and clears when the check is in', () => {
    const context = { visits, returns, checks: new Map(), inspectionsKnown: true };
    assert.equal(studentCheckAlerts([pm], 16 * 60 + 9, 10, context).length, 0);
    const late = studentCheckAlerts([pm], 16 * 60 + 10, 10, context);
    assert.equal(late.length, 1);
    assert.equal(late[0].route, '12');
    assert.equal(studentCheckAlerts([pm], 16 * 60 + 10, 10, { ...context, inspectionsKnown: false }).length, 0);
    const done = new Map([['12|pm|40', { endAt: 16 * 60 + 12 }]]);
    assert.equal(studentCheckAlerts([pm], 16 * 60 + 20, 10, { ...context, checks: done }).length, 0);
    const pills = studentCheckPills([pm], 16 * 60 + 20, 10, { ...context, checks: done });
    assert.equal(pills[0].tone, 'on');
    const waiting = studentCheckPills([pm], 16 * 60 + 4, 10, context);
    assert.equal(waiting[0].tone, 'yellow');
    const markup = studentCheckPageMarkup([pm], {
      nowMinutes: 16 * 60 + 10,
      graceMinutes: 10,
      tab: 'PM',
      ...context,
    });
    assert.match(markup, /Route 12/);
    assert.match(markup, /data-student-key="40\|12\|pm\|840"/);
    assert.match(markup, /No Student Check/);
  });
});
