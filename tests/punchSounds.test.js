import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PUNCH_SOUND_IN,
  DEFAULT_PUNCH_SOUND_OUT,
  PUNCH_SOUNDS,
  normalizePunchSound,
  punchSoundFor,
} from '../office-tracker/web/punchSounds.js';
import { importState, loadState, mergeSharedDriverList, saveState } from '../office-tracker/web/store.js';

function memoryStorage() {
  /** @type {Map<string, string>} */
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

test('the punch sound list is long, and clock in and clock out start as a related pair', () => {
  assert.ok(PUNCH_SOUNDS.length >= 24);
  const ids = PUNCH_SOUNDS.map((sound) => sound.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(DEFAULT_PUNCH_SOUND_IN, DEFAULT_PUNCH_SOUND_OUT);
  assert.equal(ids.includes(DEFAULT_PUNCH_SOUND_IN), true);
  assert.equal(ids.includes(DEFAULT_PUNCH_SOUND_OUT), true);
  assert.equal(normalizePunchSound('Time-Clock-Stamp'), 'time-clock-stamp');
  assert.equal(normalizePunchSound('off'), 'off');
  assert.equal(normalizePunchSound('nope'), '');
  assert.equal(punchSoundFor('', DEFAULT_PUNCH_SOUND_IN), DEFAULT_PUNCH_SOUND_IN);
  assert.equal(punchSoundFor('off', DEFAULT_PUNCH_SOUND_IN), 'off');
});

test('punch sounds stay with the office', () => {
  const storage = memoryStorage();
  const state = loadState(storage);
  state.profiles = { 'route-12': { id: 'route-12', name: '12' } };
  state.clockPunchSoundIn = 'stapler';
  state.clockPunchSoundOut = 'off';
  saveState(state, storage);
  assert.equal(loadState(storage).clockPunchSoundIn, 'stapler');
  assert.equal(loadState(storage).clockPunchSoundOut, 'off');

  const remote = { ...loadState(storage), clockPunchSoundIn: 'desk-bell', clockPunchSoundOut: 'service-bell' };
  const localUnset = loadState(storage);
  delete localUnset.clockPunchSoundIn;
  delete localUnset.clockPunchSoundOut;
  assert.equal(mergeSharedDriverList(remote, localUnset).clockPunchSoundIn, 'desk-bell');
  assert.equal(mergeSharedDriverList(remote, localUnset).clockPunchSoundOut, 'service-bell');
  assert.equal(
    mergeSharedDriverList(remote, { ...localUnset, clockPunchSoundIn: 'ratchet', clockPunchSoundOut: 'off' })
      .clockPunchSoundIn,
    'ratchet'
  );

  const imported = importState(
    JSON.stringify({
      version: 1,
      profiles: state.profiles,
      clockPunchSoundIn: 'coin-drop',
      clockPunchSoundOut: 'not-a-sound',
    }),
    storage
  );
  assert.equal(imported.clockPunchSoundIn, 'coin-drop');
  assert.equal(Object.prototype.hasOwnProperty.call(imported, 'clockPunchSoundOut'), false);
});
