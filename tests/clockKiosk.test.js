import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  addReasonCode,
  annotatePunch,
  DEFAULT_REASON_CODES,
  appendPunch,
  assertPinMatches,
  assertKioskCode,
  buildRoster,
  changePunch,
  DEFAULT_DRIVER_PIN,
  DEFAULT_KIOSK_CODE,
  driverClockPin,
  kioskCookieHeader,
  latestStatusByDriver,
  normalizeKioskSettings,
  normalizePinFile,
  normalizePunchLog,
  relabelReasonCode,
  removeReasonCode,
  renameReasonCode,
  requestHasKioskLock,
  presentPunches,
  removePunch,
  selectReasonCodes,
  setPin,
} from '../src/logic/clockKiosk.js';
import {
  readClockPins,
  readClockPunches,
  readClockReasonCodes,
  writeClockPins,
  writeClockPunches,
  writeClockReasonCodes,
} from '../src/data/storage.js';

const NOW = '2026-10-08T15:04:00.000Z';
const LATER = '2026-10-08T18:30:00.000Z';

describe('clock kiosk', () => {
  it('stores a PIN as the number the office can read', () => {
    const pins = setPin({}, 'drv-jane', '2468', NOW);
    assert.equal(pins['drv-jane'].pin, '2468');
    assert.doesNotThrow(() => assertPinMatches(pins, 'drv-jane', '2468'));
    assert.throws(() => assertPinMatches(pins, 'drv-jane', '0000'), /does not match/);
    assert.throws(() => assertPinMatches(pins, 'drv-missing', '2468'), /No PIN on file/);
    assert.throws(() => setPin(pins, 'drv-jane', '12', NOW), /4 digits/);
    assert.throws(() => setPin(pins, 'drv-jane', '24680', NOW), /4 digits/);
    assert.deepEqual(
      normalizePinFile({
        'drv-old': { salt: 'abc', hash: 'def', updated_at: NOW },
      }),
      {}
    );
  });

  it('keeps the timeclock lock code separate from driver PINs', () => {
    assert.equal(normalizeKioskSettings({}).unlock_pin, DEFAULT_KIOSK_CODE);
    assert.equal(
      normalizeKioskSettings({ unlock_pin: 'TeamsterTracker2026' }).unlock_pin,
      'TeamsterTracker2026'
    );
    assert.equal(normalizeKioskSettings({ unlock_pin: '1111' }).unlock_pin, '1111');
    assert.equal(normalizeKioskSettings({ unlock_pin: 'no' }).unlock_pin, DEFAULT_KIOSK_CODE);
    assert.equal(normalizeKioskSettings({ unlock_pin: 'has space' }).unlock_pin, DEFAULT_KIOSK_CODE);
    assert.doesNotThrow(() => assertKioskCode({ unlock_pin: 'TeamsterTracker2026' }, 'TeamsterTracker2026'));
    assert.throws(() => assertKioskCode({ unlock_pin: 'TeamsterTracker2026' }, '1234'), /lock code/);
    assert.equal(requestHasKioskLock('clock_kiosk=1'), true);
    assert.equal(requestHasKioskLock('theme=dark; clock_kiosk=1'), true);
    assert.equal(requestHasKioskLock('clock_kiosk=0'), false);
    assert.match(kioskCookieHeader(true), /clock_kiosk=1/);
    assert.match(kioskCookieHeader(false), /Max-Age=0/);
  });

  it('saves clock in and clock out as separate records', () => {
    const first = appendPunch([], {
      driver_id: 'drv-jane',
      driver_name: 'Jane Driver',
      action: 'in',
      punched_at: NOW,
    });
    const second = appendPunch(first.punches, {
      driver_id: 'drv-jane',
      driver_name: 'Jane Driver',
      action: 'out',
      punched_at: LATER,
    });
    assert.equal(second.punches.length, 2);
    assert.deepEqual(
      second.punches.map((row) => row.action),
      ['in', 'out']
    );
    assert.throws(
      () =>
        appendPunch(second.punches, {
          driver_id: 'drv-jane',
          driver_name: 'Jane Driver',
          action: 'sideways',
          punched_at: LATER,
        }),
      /clock in or clock out/
    );
  });

  it('lets the office change or remove a record', () => {
    const saved = appendPunch([], {
      driver_id: 'drv-jane',
      driver_name: 'Jane Driver',
      action: 'in',
      punched_at: NOW,
    });
    const edited = changePunch(saved.punches, saved.punch.id, {
      action: 'out',
      punched_at: '2026-10-08T16:00:00.000Z',
    });
    assert.equal(edited.punch.action, 'out');
    assert.equal(edited.punch.punched_at, '2026-10-08T16:00:00.000Z');
    assert.equal(removePunch(edited.punches, saved.punch.id).length, 0);
    assert.throws(() => removePunch(edited.punches, 'missing'), /Punch not found/);
  });

  it('lists every driver, and includes the PIN only for the office', () => {
    const pins = setPin({}, 'drv-jane', '1357', NOW);
    const roster = buildRoster(
      [
        { driver_id: 'drv-bob', name: 'Bob Bus' },
        { driver_id: 'drv-jane', name: 'Jane Driver' },
      ],
      { 'S 20': { driver_id: 'drv-jane' }, 'S 3': { driver_id: 'drv-bob' } },
      pins
    );
    assert.deepEqual(
      roster.map((row) => row.name),
      ['Bob Bus', 'Jane Driver']
    );
    assert.equal(roster[1].pin_set, true);
    assert.equal(roster[0].pin_set, false);
    assert.equal(roster[1].pin, undefined);
    assert.deepEqual(roster[1].routes, ['S 20']);
    const office = buildRoster(
      [
        { driver_id: 'drv-bob', name: 'Bob Bus' },
        { driver_id: 'drv-jane', name: 'Jane Driver' },
      ],
      {},
      pins,
      { includePin: true }
    );
    assert.equal(office[1].pin, '1357');
    assert.equal(office[0].pin, null);
    assert.equal(roster[0].clock_status, 'out');
    assert.equal(DEFAULT_DRIVER_PIN, '1234');
    assert.equal(driverClockPin({}, 'drv-bob'), '1234');
    assert.equal(driverClockPin({ 'drv-jane': '1003' }, 'drv-jane'), '1003');
    assert.equal(driverClockPin({ 'drv-jane': '12' }, 'drv-jane'), '1234');
    const status = latestStatusByDriver([
      {
        id: 'p-early',
        driver_id: 'drv-jane',
        driver_name: 'Jane Driver',
        action: 'in',
        punched_at: NOW,
      },
      {
        id: 'p-late',
        driver_id: 'drv-jane',
        driver_name: 'Jane Driver',
        action: 'out',
        punched_at: LATER,
      },
      {
        id: 'p-bob',
        driver_id: 'drv-bob',
        driver_name: 'Bob Bus',
        action: 'in',
        punched_at: NOW,
      },
    ]);
    assert.equal(status['drv-jane'], 'out');
    assert.equal(status['drv-bob'], 'in');
    const marked = buildRoster(
      [
        { driver_id: 'drv-bob', name: 'Bob Bus' },
        { driver_id: 'drv-jane', name: 'Jane Driver' },
      ],
      {},
      {},
      { statusByDriver: status }
    );
    assert.equal(marked[0].clock_status, 'in');
    assert.equal(marked[1].clock_status, 'out');
    const shown = presentPunches(
      [
        {
          id: 'p1',
          driver_id: 'drv-jane',
          driver_name: 'Old Name',
          action: 'in',
          punched_at: NOW,
        },
      ],
      [{ driver_id: 'drv-jane', name: 'Jane Driver' }]
    );
    assert.equal(shown[0].driver_name, 'Jane Driver');
  });

  it('stamps a note and keeps several reason codes on a record', () => {
    const codes = addReasonCode(addReasonCode([], 'Late bus'), 'Extra stop');
    assert.throws(() => addReasonCode(codes, 'late bus'), /already on the list/);
    const saved = appendPunch([], {
      driver_id: 'drv-jane',
      driver_name: 'Jane Driver',
      action: 'in',
      punched_at: NOW,
      now: LATER,
      note: '  Waiting on a student  ',
      reason_code_ids: [codes[0].id, codes[0].id, codes[1].id],
      catalog: codes,
    });
    assert.equal(saved.punch.note, 'Waiting on a student');
    assert.equal(saved.punch.note_at, LATER);
    assert.deepEqual(
      saved.punch.reason_codes.map((code) => code.label),
      ['Late bus', 'Extra stop']
    );
    const sameWords = annotatePunch(saved.punches, saved.punch.id, {
      driver_id: 'drv-jane',
      note: 'Waiting on a student',
      reason_code_ids: [codes[1].id],
      catalog: codes,
      now: '2026-10-08T19:00:00.000Z',
    });
    assert.equal(sameWords.punch.note_at, LATER);
    assert.deepEqual(
      sameWords.punch.reason_codes.map((code) => code.id),
      [codes[1].id]
    );
    const rewritten = annotatePunch(sameWords.punches, saved.punch.id, {
      driver_id: 'drv-jane',
      note: 'Student boarded',
      reason_code_ids: [codes[1].id],
      catalog: codes,
      now: '2026-10-08T19:05:00.000Z',
    });
    assert.equal(rewritten.punch.note_at, '2026-10-08T19:05:00.000Z');
    const cleared = annotatePunch(rewritten.punches, saved.punch.id, {
      driver_id: 'drv-jane',
      note: '   ',
      catalog: codes,
      now: '2026-10-08T19:06:00.000Z',
    });
    assert.equal(cleared.punch.note, '');
    assert.equal(cleared.punch.note_at, null);
    assert.equal(cleared.punch.reason_codes.length, 1);
    assert.throws(
      () =>
        annotatePunch(cleared.punches, saved.punch.id, {
          driver_id: 'drv-bob',
          note: 'Not mine',
          catalog: codes,
          now: LATER,
        }),
      /different driver/
    );
  });

  it('keeps a retired reason code on old records and renames the ones still in use', () => {
    const codes = addReasonCode([], 'Late bus');
    const saved = appendPunch([], {
      driver_id: 'drv-jane',
      driver_name: 'Jane Driver',
      action: 'out',
      punched_at: NOW,
      reason_code_ids: [codes[0].id],
      catalog: codes,
    });
    const renamed = renameReasonCode(codes, codes[0].id, 'Bus running late');
    const relabeled = relabelReasonCode(saved.punches, codes[0].id, renamed[0].label);
    assert.equal(relabeled[0].reason_codes[0].label, 'Bus running late');
    const retired = removeReasonCode(renamed, codes[0].id);
    assert.equal(retired.length, 0);
    assert.deepEqual(
      selectReasonCodes(saved.punch.reason_codes, [codes[0].id], retired).map((code) => code.label),
      ['Late bus']
    );
    assert.throws(
      () => selectReasonCodes([], [codes[0].id], retired),
      /not on the list/
    );
    const legacy = normalizePunchLog([
      {
        id: 'p1',
        driver_id: 'drv-jane',
        driver_name: 'Jane Driver',
        action: 'in',
        punched_at: NOW,
      },
    ]);
    assert.equal(legacy[0].note, '');
    assert.equal(legacy[0].note_at, null);
    assert.deepEqual(legacy[0].reason_codes, []);
  });

  it('starts the reason code list with the office defaults', async () => {
    assert.deepEqual(
      DEFAULT_REASON_CODES.map((code) => code.label),
      ['Fueling Bus', 'Traffic', 'Delay at Stop or School', 'Meeting', 'Paperwork']
    );
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clock-reasons-'));
    const first = await readClockReasonCodes(dataDir);
    assert.deepEqual(
      first.map((code) => code.label),
      DEFAULT_REASON_CODES.map((code) => code.label)
    );
    assert.deepEqual(await readClockReasonCodes(dataDir), first);
    await writeClockReasonCodes([], dataDir);
    assert.deepEqual(await readClockReasonCodes(dataDir), []);
  });

  it('round-trips punches and pins through the data files', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clock-kiosk-'));
    const pins = setPin({}, 'drv-jane', '1357', NOW);
    await writeClockPins(pins, dataDir);
    const saved = appendPunch([], {
      driver_id: 'drv-jane',
      driver_name: 'Jane Driver',
      action: 'in',
      punched_at: NOW,
    });
    await writeClockPunches(saved.punches, dataDir);
    const loadedPins = await readClockPins(dataDir);
    const loadedPunches = await readClockPunches(dataDir);
    assert.equal(loadedPins['drv-jane'].pin, '1357');
    assert.equal(loadedPunches.length, 1);
    assert.equal(loadedPunches[0].action, 'in');
    const raw = await fs.readFile(path.join(dataDir, 'clock-pins.json'), 'utf8');
    assert.equal(raw.includes('1357'), true);
    const codes = addReasonCode([], 'Charter');
    await writeClockReasonCodes(codes, dataDir);
    const loadedCodes = await readClockReasonCodes(dataDir);
    assert.equal(loadedCodes[0].label, 'Charter');
  });
});
