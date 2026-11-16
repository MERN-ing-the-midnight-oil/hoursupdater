import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONTRACT_SNAP_BREAKS } from '../src/logic/timeUtils.js';
import {
  alternateDayShade,
  snapsForCardRows,
  TIMESHEET_HOURS_MODE_QUARTER,
} from '../office-tracker/src/timesheetSnap.js';
import {
  DEFAULT_RUN_WINDOWS,
  contractHoursForRun,
  formatRunHours,
  formatRunLabel,
  formatWindowClock,
  normalizeRunWindows,
  runForStartDate,
  runTableSlots,
  timeValueToMinutes,
} from '../office-tracker/src/timesheetRunTable.js';

const breaks = DEFAULT_CONTRACT_SNAP_BREAKS;
const windows = DEFAULT_RUN_WINDOWS;

function at(hour, minute) {
  return new Date(2026, 10, 4, hour, minute, 0, 0);
}

function slotsFor(rows, contract, mode) {
  const snaps = snapsForCardRows(rows, breaks, 2026, mode);
  return runTableSlots(rows, snaps, windows, contract);
}

describe('run windows', () => {
  it('uses the default AM, MID, and PM start cutoffs', () => {
    assert.equal(runForStartDate(at(7, 59), windows), 'AM');
    assert.equal(runForStartDate(at(8, 0), windows), '');
    assert.equal(runForStartDate(at(9, 0), windows), '');
    assert.equal(runForStartDate(at(9, 1), windows), 'MID');
    assert.equal(runForStartDate(at(10, 59), windows), 'MID');
    assert.equal(runForStartDate(at(11, 0), windows), '');
    assert.equal(runForStartDate(at(11, 30), windows), '');
    assert.equal(runForStartDate(at(11, 31), windows), 'PM');
    assert.equal(runForStartDate(at(13, 50), windows), 'PM');
  });

  it('lets an admin replace the cutoffs, and AM wins when windows overlap', () => {
    const custom = normalizeRunWindows({
      amBefore: '10:00',
      midAfter: '09:00',
      midBefore: '11:00',
      pmAfter: '11:30',
    });
    assert.equal(custom.amBefore, 10 * 60);
    assert.equal(runForStartDate(at(9, 30), custom), 'AM');
    assert.equal(runForStartDate(at(10, 30), custom), 'MID');
  });

  it('falls back to the defaults when a cutoff is blank or not a time', () => {
    const restored = normalizeRunWindows({ amBefore: '', midAfter: 'nope', pmAfter: 11 * 60 + 30 });
    assert.deepEqual(restored, {
      amBefore: 8 * 60,
      midAfter: 9 * 60,
      midBefore: 11 * 60,
      pmAfter: 11 * 60 + 30,
    });
    assert.equal(timeValueToMinutes('08:00'), 8 * 60);
    assert.equal(formatWindowClock(8 * 60), '8:00 AM');
    assert.equal(formatWindowClock(11 * 60 + 30), '11:30 AM');
  });
});

describe('run table slots', () => {
  const contract = {
    contract_am_hours: 2,
    contract_midday_hours: 1.25,
    contract_pm_hours: 3,
  };

  it('labels each pair and subtracts that run’s contract from its duration', () => {
    const rows = [
      { clock_out_raw: 'NOV 4 AM 6:00', clock_in_raw: 'NOV 4 AM 8:30' },
      { clock_out_raw: 'NOV 4 AM 10:00', clock_in_raw: 'NOV 4 AM 10:45' },
      { clock_out_raw: 'NOV 4 PM 1:00', clock_in_raw: 'NOV 4 PM 4:15' },
    ];
    const slots = slotsFor(rows, contract);
    assert.equal(slots[0].role, 'pair');
    assert.equal(slots[0].run, 'AM');
    assert.equal(formatRunLabel(slots[0].run, slots[0].contract), 'AM 2');
    assert.equal(formatRunLabel(slots[1].run, slots[1].contract), 'MID 1.25');
    assert.equal(formatRunLabel(slots[2].run, slots[2].contract), 'PM 3');
    assert.equal(formatRunLabel('', null), '—');
    assert.equal(formatRunLabel('PM', null), 'PM');
    assert.equal(slots[0].duration, 2.5);
    assert.equal(slots[0].extra, 0.5);
    assert.equal(slots[1].run, 'MID');
    assert.equal(slots[1].duration, 0.75);
    assert.equal(slots[1].extra, -0.5);
    assert.equal(slots[2].run, 'PM');
    assert.equal(slots[2].duration, 3.25);
    assert.equal(slots[2].extra, 0.25);
    assert.equal(formatRunHours(slots[0].extra), '0.5');
    assert.equal(formatRunHours(slots[1].extra), '-0.5');
  });

  it('spans an Out line and the following In line as one pair', () => {
    const rows = [
      { clock_out_raw: 'NOV 4 AM 6:10' },
      {},
      { clock_in_raw: 'NOV 4 AM 8:40' },
      { clock_out_raw: 'NOV 4 PM 2:00', clock_in_raw: 'NOV 4 PM 4:00' },
    ];
    const slots = slotsFor(rows, contract);
    assert.equal(slots.length, 4);
    assert.equal(slots[0].role, 'pair');
    assert.equal(slots[0].rowspan, 3);
    assert.equal(slots[0].run, 'AM');
    assert.equal(slots[0].duration, 2.5);
    assert.equal(slots[1].role, 'continue');
    assert.equal(slots[2].role, 'continue');
    assert.equal(slots[3].role, 'pair');
    assert.equal(slots[3].run, 'PM');
    assert.equal(slots[3].rowspan, 1);
  });

  it('leaves a start in a gap unclassified and does not invent extra time', () => {
    const rows = [{ clock_out_raw: 'NOV 4 AM 8:15', clock_in_raw: 'NOV 4 AM 9:00' }];
    const slots = slotsFor(rows, contract);
    assert.equal(slots[0].run, '');
    assert.equal(slots[0].duration, 0.75);
    assert.equal(slots[0].extra, null);
  });

  it('classifies from the snapped start when snap times move the pair across a cutoff', () => {
    const rows = [{ clock_out_raw: 'NOV 4 AM 7:53', clock_in_raw: 'NOV 4 AM 9:00' }];
    const snapped = slotsFor(rows, contract);
    const quartered = slotsFor(rows, contract, TIMESHEET_HOURS_MODE_QUARTER);
    assert.equal(snapped[0].run, '');
    assert.equal(quartered[0].run, 'AM');
    assert.equal(quartered[0].extra, quartered[0].duration - 2);
  });

  it('skips a crossed-out pair and a sticker that has no run contracts', () => {
    const rows = [
      { clock_out_raw: 'NOV 4 AM 6:00', clock_in_raw: 'NOV 4 AM 8:00', crossed_out: true },
      { clock_out_raw: 'NOV 4 PM 2:00', clock_in_raw: 'NOV 4 PM 4:00' },
    ];
    const slots = slotsFor(rows, { contract_hours: 5.25 });
    assert.equal(slots[0].role, 'blank');
    assert.equal(slots[1].run, 'PM');
    assert.equal(slots[1].extra, null);
    assert.equal(contractHoursForRun({ contract_hours: 5.25 }, 'PM'), null);
  });

  it('treats a missing midday contract as zero when the sticker names other runs', () => {
    const rows = [{ clock_out_raw: 'NOV 4 AM 10:00', clock_in_raw: 'NOV 4 AM 11:00' }];
    const header = { contract_am_hours: 2, contract_pm_hours: 2.5 };
    const slots = slotsFor(rows, header);
    assert.equal(slots[0].run, 'MID');
    assert.equal(contractHoursForRun(header, 'MID'), 0);
    assert.equal(slots[0].extra, 1);
    assert.equal(formatRunLabel(slots[0].run, slots[0].contract), 'MID 0');
  });
});

describe('alternate day shade', () => {
  it('keeps one day’s runs together and shades every other day', () => {
    const rows = [
      { clock_out_raw: 'NOV 2 AM 6:10', clock_in_raw: 'NOV 2 AM 8:40' },
      { clock_out_raw: 'NOV 2 AM 11:00', clock_in_raw: 'NOV 2 AM 12:15' },
      { clock_out_raw: 'NOV 2 PM 1:50', clock_in_raw: 'NOV 2 PM 4:30' },
      { clock_out_raw: 'NOV 3 AM 6:10', clock_in_raw: 'NOV 3 AM 8:40' },
      { clock_out_raw: 'NOV 3 PM 1:50', clock_in_raw: 'NOV 3 PM 4:30' },
      { clock_out_raw: 'NOV 4 AM 6:10', clock_in_raw: 'NOV 4 AM 8:40' },
    ];
    assert.deepEqual(alternateDayShade(rows, 2026), [false, false, false, true, true, false]);
  });

  it('keeps a split pair, including the blank line between Out and In, on that day', () => {
    const rows = [
      { clock_out_raw: 'NOV 2 AM 6:10' },
      {},
      { clock_in_raw: 'NOV 2 AM 8:40' },
      { clock_out_raw: 'NOV 3 PM 1:50', clock_in_raw: 'NOV 3 PM 4:30' },
    ];
    assert.deepEqual(alternateDayShade(rows, 2026), [false, false, false, true]);
  });

  it('does not pull a blank line between two days into either day', () => {
    const rows = [
      { clock_out_raw: 'NOV 2 AM 6:10', clock_in_raw: 'NOV 2 AM 8:40' },
      { clock_out_raw: 'NOV 3 AM 6:10', clock_in_raw: 'NOV 3 AM 8:40' },
      {},
      { clock_out_raw: 'NOV 4 AM 6:10', clock_in_raw: 'NOV 4 AM 8:40' },
    ];
    assert.deepEqual(alternateDayShade(rows, 2026), [false, true, false, false]);
  });
});
