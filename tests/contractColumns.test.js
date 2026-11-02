import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBellingham2026_2027Calendar } from '../employee-tracker/src/bellinghamCalendar2026.js';
import {
  EMPLOYEE_ROUTE_ID,
  buildEmployeeSnapshot,
  rebuildEmployeeRouteState,
} from '../employee-tracker/src/snapshot.js';
import { computeDeltaMinutes } from '../src/logic/timeUtils.js';
import { addSchoolDays, getSchoolDays } from '../src/logic/calendar.js';
import {
  buildClockHistoryMarks,
  changeHoverLines,
  scheduleChangeKindLines,
} from '../employee-tracker/src/clockHistory.js';
import { contractColumnsForHistory, historyLegendHtml } from '../office-tracker/src/historyMarkup.js';

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
    assert.equal(columns[0].hours, '4 hr 30 min');
    assert.equal(columns[0].contractedDate, '09/08/2026');
    assert.match(columns[0].contractedDateTitle, /Starting schedule date/);
    assert.equal(columns[1].hours, '4 hr 45 min');
    assert.equal(columns[1].contractedDate, 'predicted: 10/01/2026');
    assert.match(columns[1].contractedDateTitle, /If nothing else changes/);
  });

  it('explains each Calculated Contract Date value on hover', () => {
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
      {
        kind: 'change',
        date: '2026-11-12',
        contracted: {
          status: 'bid_pending',
          becomes_on: '2026-11-20',
          projected_outcome: 'BID_PENDING',
          bid_through: '2026-11-30',
        },
      },
      {
        kind: 'change',
        date: '2026-11-13',
        contracted: { status: 'became_contracted', becomes_on: '2026-11-13' },
      },
      {
        kind: 'change',
        date: '2026-11-14',
        contracted: { status: 'superseded' },
      },
    ]);
    assert.match(columns[0].contractedDateTitle, /Earlier forecast that a later change replaced/);
    assert.match(columns[1].contractedDateTitle, /newer date the contract rules would use/i);
    assert.equal(columns[2].contractedDate, '11/20/2026');
    assert.equal(columns[2].contractedDateSecondary, 'Up for Bid: 11/20–11/30');
    assert.match(columns[2].contractedDateSecondaryTitle, /Bid posting date/);
    assert.match(columns[3].contractedDateTitle, /Calculated date under the contract rules/);
    assert.match(columns[4].contractedDateTitle, /No calculated contract date/);
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

  it('names a monthly bid on a second line under the calculated date', () => {
    const columns = contractColumnsForHistory([
      {
        kind: 'change',
        date: '2026-10-06',
        contracted: {
          status: 'predicted',
          becomes_on: '2026-10-28',
          projected_outcome: 'BID_PENDING',
          bid_through: '2026-10-30',
        },
      },
      {
        kind: 'change',
        date: '2026-10-14',
        contracted: {
          status: 'predicted',
          becomes_on: '2026-11-20',
          projected_outcome: 'BID_PENDING',
          bid_through: '2026-11-30',
        },
      },
      {
        kind: 'change',
        date: '2026-11-20',
        contracted: {
          status: 'bid_pending',
          becomes_on: '2026-11-20',
          projected_outcome: 'BID_PENDING',
          bid_through: '2026-11-30',
        },
      },
    ]);
    assert.equal(columns[0].contractedDate, 'old predicted: 10/28/2026');
    assert.equal(columns[0].contractedDateSecondary, 'Predicted Up for Bid: 10/28–10/30');
    assert.equal(columns[1].contractedDate, 'new predicted: 11/20/2026');
    assert.equal(columns[1].contractedDateSecondary, 'Predicted Up for Bid: 11/20–11/30');
    assert.equal(columns[2].contractedDate, '11/20/2026');
    assert.equal(columns[2].contractedDateSecondary, 'Up for Bid: 11/20–11/30');
  });

  it('puts a predicted bump on a second line', () => {
    const columns = contractColumnsForHistory([
      {
        kind: 'change',
        date: '2026-10-06',
        contracted: {
          status: 'predicted',
          becomes_on: '2026-10-28',
          projected_outcome: 'BUMP_ELIGIBLE',
        },
      },
    ]);
    assert.equal(columns[0].contractedDate, 'predicted: 10/28/2026');
    assert.equal(columns[0].contractedDateSecondary, 'Predicted Up for Bump: 10/28');
  });

  it('repeats the standing predicted date when a side countdown does not move it', () => {
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
    ], getSchoolDays(calendar));
    assert.equal(columns[0].contractedDate, 'predicted: 10/28/2026');
    assert.equal(columns[0].contractedDateSecondary, 'Predicted Up for Bid: 10/28–10/30');
    assert.equal(columns[1].contractedDate, 'predicted: 10/28/2026');
    assert.equal(columns[1].contractedDateSecondary, 'Predicted Up for Bid: 10/28–10/30');
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
      columns[index].contractedDateSecondary,
    ]);
    assert.deepEqual(dates, [
      ['2026-09-08', '09/08/2026', null],
      ['2026-10-05', '—', null],
      ['2026-10-06', 'predicted: 10/28/2026', 'Predicted Up for Bid: 10/28–10/30'],
      ['2026-10-20', 'predicted: 10/28/2026', 'Predicted Up for Bid: 10/28–10/30'],
    ]);
    const last = snap.schedule_history.at(-1);
    assert.equal(last.delta_label, '−15 min');
    assert.equal(last.cumulative_drift_minutes, 35);
    assert.equal(last.cumulative_drift_label, '+35 min');

    const schoolDays = getSchoolDays(calendar);
    const marks = buildClockHistoryMarks(snap.schedule_history, { schoolDays });
    const bidIndex = snap.schedule_history.findIndex((row) => row.date === '2026-10-06');
    const sideIndex = snap.schedule_history.findIndex((row) => row.date === '2026-10-20');
    const fifteenth = addSchoolDays(schoolDays, '2026-10-06', 15);
    const dayAfterSide = addSchoolDays(schoolDays, '2026-10-20', 1);
    assert.equal(marks.get(fifteenth)?.windowDay, 15);
    assert.equal(marks.get(fifteenth)?.sourceIndex, bidIndex);
    assert.equal(marks.get(dayAfterSide)?.sourceIndex, bidIndex);
    assert.equal(marks.get(dayAfterSide)?.window, true);
    assert.equal(marks.get(dayAfterSide)?.windowDay, 11);
    assert.deepEqual(
      (marks.get(dayAfterSide)?.extraWindows || []).map((item) => [
        item.sourceIndex,
        item.windowDay,
      ]),
      [[sideIndex, 1]]
    );
    assert.equal(marks.get('2026-10-20')?.established, true);
    assert.equal(marks.get('2026-10-20')?.window, true);
    assert.equal(marks.get('2026-10-20')?.windowDay, 10);
    assert.equal(marks.get('2026-10-20')?.sourceIndex, sideIndex);
    assert.equal(Boolean(marks.get('2026-11-12')?.contractedDay), false);
    assert.equal(marks.get('2026-11-12')?.resolvesOn ?? null, null);
    assert.deepEqual(changeHoverLines(marks.get('2026-10-20')), [
      'Current change: −15 min',
      'Cumulative change: +35 min',
    ]);
    const legend = historyLegendHtml(snap.schedule_history);
    assert.match(legend, /Change · −15 min/);
    assert.deepEqual(scheduleChangeKindLines(snap.schedule_history[1]), [
      'Change · +20 min',
      '10/05 Countdown, +20 min',
    ]);
    assert.deepEqual(scheduleChangeKindLines(snap.schedule_history[2]), [
      'Change · +30 min',
      '10/05 Countdown, +45 min',
      '10/06 Countdown, +5 min',
    ]);
    assert.deepEqual(scheduleChangeKindLines(last), [
      'Change · −15 min',
      '10/05 Countdown, +45 min',
      '10/06 Countdown, +5 min',
      '10/20 Countdown, −15 min',
    ]);
    assert.match(legend, /10\/20 Countdown, −15 min/);
    assert.doesNotMatch(legend, /Cumulative change/);
  });

  it('uses snapped Scheduled Hours for the Change column when snap is on', () => {
    function timed(id, segment, previous, next, date, submittedAt) {
      const delta = computeDeltaMinutes(previous, next);
      return {
        id,
        route_id: EMPLOYEE_ROUTE_ID,
        driver_name: 'Alex Driver',
        driver_id: null,
        segment,
        submitted_at: submittedAt || `${date}T15:00:00.000Z`,
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
      timed('plus-20', 'PM', '14:05-16:25', '14:05-16:45', '2026-10-05'),
    ];
    const entry = rebuildEmployeeRouteState(changes, calendar, '2026-10-05');
    const exact = buildEmployeeSnapshot({
      profile,
      changeLog: changes,
      entry,
      calendar,
      asOfDate: '2026-10-05',
    });
    const snapped = buildEmployeeSnapshot({
      profile,
      changeLog: changes,
      entry,
      calendar,
      asOfDate: '2026-10-05',
      snapContractClocks: true,
    });
    assert.deepEqual(scheduleChangeKindLines(exact.schedule_history[1]), [
      'Change · +20 min',
      '10/05 Countdown, +20 min',
    ]);
    // Snapped clocks: 14:05-16:25 → 14:00-16:30 (150), 14:05-16:45 → 14:00-16:45 (165).
    assert.deepEqual(scheduleChangeKindLines(snapped.schedule_history[1]), [
      'Change · +15 min',
      '10/05 Countdown, +15 min',
    ]);
    const columns = contractColumnsForHistory(
      snapped.schedule_history,
      undefined,
      { snapContractClocks: true }
    );
    assert.equal(columns[0].hours, '4 hr 30 min');
    assert.equal(columns[1].hours, '4 hr 45 min');
  });

  it('can drive bid/bump windows from snapped contracted totals', () => {
    function timed(id, segment, previous, next, date) {
      const delta = computeDeltaMinutes(previous, next);
      return {
        id,
        route_id: EMPLOYEE_ROUTE_ID,
        driver_name: 'Alex Driver',
        driver_id: null,
        segment,
        submitted_at: `${date}T15:00:00.000Z`,
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
      seed('PM', '14:05-16:05'),
      // Exact +29; snapped contracted daily total moves +30.
      timed('plus-29', 'PM', '14:05-16:05', '14:05-16:34', '2026-10-06'),
    ];
    const exactEntry = rebuildEmployeeRouteState(changes, calendar, '2026-10-27');
    const snappedEntry = rebuildEmployeeRouteState(changes, calendar, '2026-10-27', {}, {
      snapContractClocks: true,
      bidBumpUseSnappedTimes: true,
    });
    assert.equal(exactEntry.cumulative_drift_minutes, 29);
    assert.equal(exactEntry.status, 'ACCUMULATING');
    assert.equal(snappedEntry.cumulative_drift_minutes, 30);
    assert.equal(snappedEntry.status, 'ACCUMULATING');

    const exact = buildEmployeeSnapshot({
      profile,
      changeLog: changes,
      entry: exactEntry,
      calendar,
      asOfDate: '2026-10-27',
      snapContractClocks: true,
      bidBumpUseSnappedTimes: false,
    });
    const snapped = buildEmployeeSnapshot({
      profile,
      changeLog: changes,
      entry: snappedEntry,
      calendar,
      asOfDate: '2026-10-27',
      snapContractClocks: true,
      bidBumpUseSnappedTimes: true,
    });
    assert.equal(exact.schedule_history.at(-1).contracted.projected_outcome, 'STABLE');
    assert.match(exact.schedule_history.at(-1).contracted.label, /become contracted/);
    assert.equal(snapped.schedule_history.at(-1).contracted.projected_outcome, 'BID_PENDING');
    assert.match(snapped.schedule_history.at(-1).contracted.label, /up for bid 10\/28–10\/30/);
  });

  it('shows the bid window when a monthly bid changes the rounded hours', () => {
    function timed(id, segment, previous, next, date) {
      const delta = computeDeltaMinutes(previous, next);
      return {
        id,
        route_id: EMPLOYEE_ROUTE_ID,
        driver_name: 'Alex Driver',
        driver_id: null,
        segment,
        submitted_at: `${date}T15:00:00.000Z`,
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
      seed('AM', '6:35-8:35'),
      seed('PM', '14:05-16:05'),
      timed('plus-40', 'PM', '14:05-16:05', '14:05-16:45', '2026-10-14'),
    ];
    const entry = rebuildEmployeeRouteState(changes, calendar, '2026-10-27');
    const snap = buildEmployeeSnapshot({
      profile,
      changeLog: changes,
      entry,
      calendar,
      asOfDate: '2026-10-27',
    });
    const columns = contractColumnsForHistory(snap.schedule_history);
    const fifteenth = addSchoolDays(getSchoolDays(calendar), '2026-10-14', 15);
    assert.equal(fifteenth, '2026-11-04');
    assert.equal(columns.at(-1).hours, '4 hr 45 min');
    assert.equal(columns.at(-1).contractedDate, 'predicted: 11/20/2026');
    assert.equal(columns.at(-1).contractedDateSecondary, 'Predicted Up for Bid: 11/20–11/30');
  });

  it('keeps a predicted contract date when rounded hours do not move', () => {
    const columns = contractColumnsForHistory([
      {
        kind: 'initial',
        date: '2026-09-08',
        schedule: { AM: { range: '6:35-8:55' } },
        contracted: { status: 'established' },
      },
      {
        kind: 'change',
        date: '2026-09-10',
        schedule: { AM: { range: '6:33-8:55' } },
        contracted: { status: 'predicted', becomes_on: '2026-10-01' },
      },
    ]);
    assert.equal(columns[0].hours, '2 hr 15 min');
    assert.equal(columns[1].hours, '2 hr 15 min');
    assert.equal(columns[1].contractedDate, 'predicted: 10/01/2026');
  });

  it('shows the contract date once the window has closed', () => {
    const columns = columnsAsOf('2026-10-01');
    assert.equal(columns[1].hours, '4 hr 45 min');
    assert.equal(columns[1].contractedDate, '10/01/2026');
    assert.match(columns[1].contractedDateTitle, /Calculated date under the contract rules/);
  });
});
