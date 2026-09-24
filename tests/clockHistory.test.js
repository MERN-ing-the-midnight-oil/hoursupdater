import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addSchoolDays, getSchoolDays } from '../src/logic/calendar.js';
import { buildBps2026_2027Calendar } from '../employee-tracker/src/bpsCalendar2026.js';
import {
  bidPeriodRanges,
  buildClockHistoryMarks,
  changeDetailLines,
  changeHoverLines,
  clockHistoryLabel,
} from '../employee-tracker/src/clockHistory.js';

const { calendar } = buildBps2026_2027Calendar();
const schoolDays = getSchoolDays(calendar);

function row(partial) {
  return {
    kind: 'change',
    date: '2026-10-06',
    segment: 'AM',
    delta_minutes: 15,
    delta_label: '+15 min',
    contracted: { status: 'predicted', becomes_on: null },
    ...partial,
  };
}

describe('clock history calendar marks', () => {
  it('marks only the established day when no later change opens a window', () => {
    const marks = buildClockHistoryMarks(
      [
        {
          kind: 'initial',
          date: '2026-09-02',
          contracted: { status: 'established' },
        },
      ],
      { schoolDays }
    );

    assert.equal(marks.has('2026-09-01'), false);
    assert.equal(marks.get('2026-09-02')?.established, true);
    assert.equal(marks.get('2026-09-02')?.toneIndex, 0);
    assert.equal(marks.get('2026-09-02')?.window, false);
    assert.equal(marks.has('2026-09-03'), false);
    assert.equal(marks.has('2027-06-22'), false);
  });

  it('does not paint a 15-day window for an under-30 change before October 1', () => {
    const marks = buildClockHistoryMarks(
      [
        {
          kind: 'initial',
          date: '2026-09-08',
          contracted: { status: 'established' },
        },
        row({
          date: '2026-09-08',
          delta_minutes: 7,
          delta_label: '+7 min',
          contracted: { status: 'predicted', becomes_on: '2026-10-01' },
        }),
      ],
      { schoolDays }
    );

    assert.equal(marks.get('2026-09-08')?.toneIndex, 1);
    assert.equal(marks.get('2026-09-08')?.established, true);
    assert.equal(marks.get('2026-09-08')?.arrowOrigin, true);
    assert.equal(marks.get('2026-09-08')?.arrowFromWindow, false);
    assert.equal(marks.get('2026-09-08')?.arrow, false);
    assert.equal(marks.get('2026-09-09')?.window, false);
    assert.equal(marks.get('2026-09-09')?.arrow, true);
    assert.equal(marks.get('2026-09-09')?.resolvesOn, '2026-10-01');
    assert.equal(marks.get('2026-09-30')?.arrow, true);
    assert.equal(marks.get('2026-09-30')?.arrowHead, true);
    assert.equal(marks.get('2026-10-01')?.contractedDay, true);
    assert.equal(marks.get('2026-10-01')?.toneIndex, 1);
    assert.equal(marks.get('2026-10-01')?.arrow, false);
    assert.equal(marks.has('2026-10-02'), false);
    assert.equal(
      clockHistoryLabel({ kind: 'change', segment: 'AM', delta_label: '+7 min' }),
      'AM change +7 min'
    );
  });

  it('colors the 15 school days after a post-October change', () => {
    const first = addSchoolDays(schoolDays, '2026-10-06', 1);
    const fifteenth = addSchoolDays(schoolDays, '2026-10-06', 15);
    const sixteenth = addSchoolDays(schoolDays, '2026-10-06', 16);
    const marks = buildClockHistoryMarks(
      [
        {
          kind: 'initial',
          date: '2026-09-08',
          contracted: { status: 'established' },
        },
        row({
          contracted: {
            status: 'predicted',
            becomes_on: addSchoolDays(schoolDays, fifteenth, 1),
          },
        }),
      ],
      { schoolDays }
    );

    assert.equal(marks.has('2026-10-05'), false);
    assert.equal(marks.get('2026-10-06')?.established, true);
    assert.equal(marks.get('2026-10-06')?.window, false);
    assert.equal(marks.get('2026-10-06')?.windowDay, null);
    assert.equal(marks.get(first)?.window, true);
    assert.equal(marks.get(first)?.windowDay, 1);
    assert.equal(marks.get(first)?.toneIndex, 1);
    assert.equal(marks.get(fifteenth)?.window, true);
    assert.equal(marks.get(fifteenth)?.windowDay, 15);
    assert.equal(marks.get(sixteenth)?.contractedDay, true);
    assert.equal(marks.get(sixteenth)?.window, false);
    assert.equal(marks.has('2027-01-04'), false);
  });

  it('stops a bid wait at day 15 and points an arrow at the posting period', () => {
    const fifteenth = addSchoolDays(schoolDays, '2026-10-09', 15);
    const marks = buildClockHistoryMarks(
      [
        row({
          date: '2026-10-09',
          delta_minutes: 35,
          delta_label: '+35 min',
          contracted: {
            status: 'predicted',
            projected_outcome: 'BID_PENDING',
            becomes_on: '2026-11-20',
          },
        }),
      ],
      { schoolDays }
    );
    const november = bidPeriodRanges(schoolDays).find((range) => range.start.startsWith('2026-11'));

    assert.equal(marks.get(fifteenth)?.windowDay, 15);
    assert.equal(marks.get('2026-11-03')?.arrow, true);
    assert.equal(marks.get('2026-11-03')?.window, false);
    assert.equal(marks.get('2026-11-19')?.arrowHead, true);
    assert.equal(marks.get('2026-11-19')?.goesToBid, true);
    assert.equal(Boolean(marks.get('2026-11-20')?.contractedDay), false);
    assert.equal(marks.has('2026-11-20'), false);
    assert.equal(marks.has('2026-12-01'), false);
    assert.equal(november?.start, '2026-11-20');
    assert.equal(november?.end, '2026-11-30');
    assert.deepEqual(november?.schoolDays, [
      '2026-11-20',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-30',
    ]);
  });

  it('stops an earlier 15-day window when the next change resets it', () => {
    const marks = buildClockHistoryMarks(
      [
        {
          kind: 'initial',
          date: '2026-09-08',
          contracted: { status: 'established' },
        },
        row({
          date: '2026-10-02',
          delta_minutes: 20,
          delta_label: '+20 min',
          contracted: { status: 'superseded', becomes_on: null },
        }),
        row({
          date: '2026-10-09',
          delta_minutes: 15,
          delta_label: '+15 min',
          contracted: {
            status: 'predicted',
            becomes_on: addSchoolDays(
              schoolDays,
              addSchoolDays(schoolDays, '2026-10-09', 15),
              1
            ),
          },
        }),
      ],
      { schoolDays }
    );

    assert.equal(marks.has('2026-10-01'), false);
    assert.equal(marks.get('2026-10-02')?.toneIndex, 1);
    assert.equal(marks.get('2026-10-02')?.established, true);
    assert.equal(marks.get('2026-10-08')?.toneIndex, 1);
    assert.equal(marks.get('2026-10-05')?.windowDay, 1);
    assert.equal(marks.get('2026-10-08')?.window, true);
    assert.equal(marks.get('2026-10-08')?.windowDay, 4);
    assert.equal(marks.get('2026-10-09')?.toneIndex, 2);
    assert.equal(marks.get('2026-10-09')?.window, false);
    assert.equal(marks.get('2026-10-09')?.windowDay, null);
    const firstAfter = addSchoolDays(schoolDays, '2026-10-09', 1);
    assert.equal(marks.get(firstAfter)?.window, true);
    assert.equal(marks.get(firstAfter)?.windowDay, 1);
    assert.equal(marks.get(firstAfter)?.toneIndex, 2);
  });

  it('points an arrow across the weekend after day 15 until the next school day', () => {
    const marks = buildClockHistoryMarks(
      [
        row({
          date: '2026-10-08',
          contracted: {
            status: 'predicted',
            becomes_on: '2026-11-02',
          },
        }),
      ],
      { schoolDays }
    );

    assert.equal(marks.get('2026-10-30')?.windowDay, 15);
    assert.equal(marks.get('2026-10-30')?.arrowOrigin, true);
    assert.equal(marks.get('2026-10-30')?.arrowFromWindow, true);
    assert.equal(marks.get('2026-10-30')?.arrow, false);
    assert.equal(marks.get('2026-10-31')?.arrowFromWindow, true);
    assert.equal(marks.get('2026-10-31')?.arrow, true);
    assert.equal(marks.get('2026-10-31')?.goesToBid, false);
    assert.equal(marks.get('2026-10-31')?.window, false);
    assert.equal(marks.get('2026-10-31')?.resolvesOn, '2026-11-02');
    assert.equal(marks.get('2026-11-01')?.arrowHead, true);
    assert.equal(marks.get('2026-11-02')?.contractedDay, true);
    assert.equal(marks.get('2026-11-02')?.arrow, false);
    assert.equal(marks.get('2026-11-02')?.window, false);
  });

  it('marks the change day when a decrease resolves that same day', () => {
    const marks = buildClockHistoryMarks(
      [
        row({
          date: '2026-09-09',
          delta_minutes: -35,
          delta_label: '−35 min',
          contracted: { status: 'bump_eligible', becomes_on: '2026-09-09' },
        }),
      ],
      { schoolDays }
    );

    assert.equal(marks.get('2026-09-09')?.established, true);
    assert.equal(marks.get('2026-09-09')?.arrow, false);
    assert.equal(marks.get('2026-09-09')?.window, false);
    assert.equal(marks.get('2026-09-09')?.windowDay, null);
    assert.equal(marks.has('2026-09-10'), false);
  });

  it('does not paint countdown squares after a same-day resolution', () => {
    const marks = buildClockHistoryMarks(
      [
        {
          kind: 'initial',
          date: '2026-09-08',
          contracted: { status: 'established' },
        },
        row({
          date: '2026-09-09',
          delta_minutes: -35,
          delta_label: '−35 min',
          contracted: { status: 'bump_eligible', becomes_on: '2026-09-09' },
        }),
        row({
          date: '2026-09-15',
          delta_minutes: 12,
          delta_label: '+12 min',
          contracted: { status: 'predicted', becomes_on: '2026-10-01' },
        }),
      ],
      { schoolDays }
    );

    assert.equal(marks.get('2026-09-09')?.established, true);
    assert.equal(marks.get('2026-09-09')?.window, false);
    assert.equal(marks.has('2026-09-10'), false);
    assert.equal(marks.has('2026-09-14'), false);
    assert.equal(marks.get('2026-09-15')?.established, true);
    assert.equal(marks.get('2026-09-15')?.windowDay, null);
  });

  it('lists the current change and a different cumulative total while that change is active', () => {
    const marks = buildClockHistoryMarks(
      [
        row({
          date: '2026-10-02',
          delta_minutes: 12,
          delta_label: '+12 min',
          cumulative_drift_minutes: 12,
          cumulative_drift_label: '+12 min',
        }),
        row({
          date: '2026-10-08',
          segment: 'PM',
          delta_minutes: 20,
          delta_label: '+20 min',
          cumulative_drift_minutes: 32,
          cumulative_drift_label: '+32 min',
          contracted: {
            status: 'predicted',
            projected_outcome: 'BID_PENDING',
            becomes_on: '2026-11-20',
          },
        }),
      ],
      { schoolDays }
    );
    const windowDay = addSchoolDays(schoolDays, '2026-10-08', 3);

    assert.deepEqual(changeHoverLines(marks.get('2026-10-02')), [
      'Current change: AM change +12 min',
    ]);
    assert.equal(marks.get('2026-10-02')?.cumulativeLabel, null);
    assert.deepEqual(changeHoverLines(marks.get('2026-10-08')), [
      'Current change: PM change +20 min',
      'Cumulative change: +32 min',
    ]);
    assert.deepEqual(changeHoverLines(marks.get(windowDay)), [
      'Current change: PM change +20 min',
      'Cumulative change: +32 min',
    ]);
    assert.equal(marks.get(windowDay)?.sourceIndex, 1);
    assert.deepEqual(
      changeDetailLines({
        kind: 'change',
        segment: 'PM',
        previous_time: '14:00-16:00',
        new_time: '13:40-16:00',
        note: 'Twenty more minutes.',
        contracted: { label: 'Predicted to become contracted on Fri, Nov 20, 2026' },
      }),
      [
        'PM 14:00-16:00 → 13:40-16:00',
        'Twenty more minutes.',
        'Predicted to become contracted on Fri, Nov 20, 2026',
      ]
    );
  });
});
