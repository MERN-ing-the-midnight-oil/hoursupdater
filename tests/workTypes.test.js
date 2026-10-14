import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_REASON_CODES } from '../src/logic/clockKiosk.js';
import { applyWorkChunk, clockNoteText, clocksOnSpan, IRREGULAR_WORK_TYPES, normalizeWorkType, workTypeLabel } from '../src/logic/workTypes.js';

function punch(id, action, hours, minutes, run, extra = {}) {
  return {
    id,
    driver_name: 'Alex Driver',
    action,
    punched_at: new Date(2026, 9, 9, hours, minutes).toISOString(),
    run,
    ...extra,
  };
}

describe('irregular work types', () => {
  it('keeps a contract work type and drops anything else', () => {
    assert.equal(normalizeWorkType('middle-school-sports'), 'middle-school-sports');
    assert.equal(workTypeLabel('field-trip'), 'Field trip');
    assert.equal(normalizeWorkType('lunch'), '');
    assert.equal(workTypeLabel(''), '');
  });

  it('uses the combined reason list for other paid time', () => {
    const otherPaid = IRREGULAR_WORK_TYPES.filter((type) => type.group === 'Other paid time');
    assert.deepEqual(
      otherPaid.map((type) => type.label),
      DEFAULT_REASON_CODES.map((code) => code.label)
    );
    assert.equal(workTypeLabel('reason-bus-cleaning'), 'Bus cleaning');
    assert.equal(workTypeLabel('reason-new-student'), 'New Student');
    assert.equal(otherPaid[0].label, 'Trip Ticket Number');
  });

  it('keeps a trip ticket with the clock the way a note is kept', () => {
    assert.equal(
      clockNoteText({ note: 'Bus was late', trip_ticket: '  4821  ' }),
      'Trip ticket 4821\nBus was late'
    );
    assert.equal(clockNoteText({ trip_ticket: '' }), '');
    const punches = [punch('in', 'in', 6, 0, 'AM'), punch('out', 'out', 9, 0, 'AM')];
    assert.throws(
      () => applyWorkChunk(punches, 'in', { workType: 'reason-trip-ticket', startClock: '7:15', endClock: '8:00' }),
      /trip ticket number/
    );
    const next = applyWorkChunk(punches, 'in', {
      workType: 'reason-trip-ticket',
      startClock: '7:15',
      endClock: '8:00',
      tripTicket: 'TT-19',
    });
    assert.equal(next[0].work_portions[0].trip_ticket, 'TT-19');
    assert.equal(clockNoteText(next[0]), 'Trip ticket TT-19');
  });

  it('places a part inside a route, including one that crosses midnight', () => {
    const start = new Date(2026, 9, 9, 22, 4);
    const end = new Date(2026, 9, 10, 1, 12);
    const part = clocksOnSpan(start, end, '23:00', '00:30');
    assert.equal(part.start.getHours(), 23);
    assert.equal(part.end.getDate(), 10);
    assert.equal(part.end.getHours(), 0);
    assert.equal(part.end.getMinutes(), 30);
    assert.throws(() => clocksOnSpan(start, end, '08:00', '09:00'), /inside the route/);
  });

  it('saves a part of a regular route as irregular work', () => {
    const punches = [punch('in', 'in', 6, 0, 'AM'), punch('out', 'out', 9, 0, 'AM')];
    const next = applyWorkChunk(punches, 'in', {
      workType: 'middle-school-sports',
      startClock: '7:15',
      endClock: '8:00',
    });
    assert.equal(next[0].run, 'AM');
    assert.equal(next[0].work_portions.length, 1);
    assert.equal(next[0].work_portions[0].work_type, 'middle-school-sports');
    assert.throws(
      () =>
        applyWorkChunk(next, 'in', {
          workType: 'field-trip',
          startClock: '7:30',
          endClock: '8:10',
        }),
      /overlap/
    );
  });

  it('turns the whole regular route into that kind of work', () => {
    const punches = [
      punch('in', 'in', 6, 2, 'AM', {
        work_portions: [
          {
            start: new Date(2026, 9, 9, 7, 0).toISOString(),
            end: new Date(2026, 9, 9, 7, 30).toISOString(),
            work_type: 'meeting',
          },
        ],
      }),
      punch('out', 'out', 8, 40, 'AM'),
    ];
    const next = applyWorkChunk(punches, 'in', {
      workType: 'field-trip',
      startClock: '6:02',
      endClock: '8:40',
    });
    assert.equal(next[0].run, 'OTHER');
    assert.equal(next[0].work_type, 'field-trip');
    assert.equal(next[0].work_portions, undefined);
    assert.equal(next[1].run, 'OTHER');
    assert.equal(next[1].work_type, 'field-trip');
  });
});
