/**
 * Start Timeclock opens the driver screen and keeps this browser there
 * until the office lock code is entered. Driver PINs do not leave that screen.
 */

import { addReasonCode, DEFAULT_KIOSK_CODE, driverClockPin, removeReasonCode } from '../../src/logic/clockKiosk.js';
import { dueClockInKeys, flashingClockInKeys, normalizeLateFlashMinutes } from '../../src/logic/lateClockFlash.js';
import { normalizeClockNameSize, quarterHourClocksEnabled } from './store.js';

const LOCK_KEY = 'teamster-timeclock-lock';
const LATE_ACK_KEY = 'teamster-timeclock-late-ack';
const NAME_COLOR_KEY = 'teamster-timeclock-name-colors';

/**
 * @param {{
 *   readState: () => {
 *     punches?: object[],
 *     clockPins?: Record<string, string>,
 *     clockLockCode?: string,
 *     clockLateMinutes?: number | null,
 *     clockNameSize?: string,
 *   },
 *   writeState: (state: object) => void,
 *   listPeople: () => Array<{ id: string, name: string, routes: string[], clockIns?: string[] }>,
 * }} options
 */
export function mountTimeclock({ readState, writeState, listPeople }) {
  const startButton = document.querySelector('#start-timeclock');
  const lockForm = document.querySelector('#lock-form');
  const lockInput = document.querySelector('#lock-code');
  const pinForm = document.querySelector('#pin-form');
  const pinDriver = document.querySelector('#pin-driver');
  const pinValue = document.querySelector('#pin-value');
  const pinList = document.querySelector('#pin-list');
  const officeStatus = document.querySelector('#clock-status');
  const kiosk = document.querySelector('#timeclock-kiosk');
  const kioskNow = document.querySelector('#kiosk-now');
  const kioskList = document.querySelector('#kiosk-list');
  const kioskDetail = document.querySelector('#kiosk-detail');
  const kioskSearch = document.querySelector('#kiosk-search');
  const kioskRoster = document.querySelector('#kiosk-roster');
  const kioskListStatus = document.querySelector('#kiosk-list-status');
  const kioskBack = document.querySelector('#kiosk-back');
  const kioskDriver = document.querySelector('#kiosk-driver');
  const kioskRoutes = document.querySelector('#kiosk-routes');
  const kioskPinForm = document.querySelector('#kiosk-pin-form');
  const kioskPin = document.querySelector('#kiosk-pin');
  const kioskPinError = document.querySelector('#kiosk-pin-error');
  const kioskActions = document.querySelector('#kiosk-actions');
  const kioskLeave = document.querySelector('#kiosk-leave');
  const kioskLeaveCode = document.querySelector('#kiosk-leave-code');
  const kioskLeaveError = document.querySelector('#kiosk-leave-error');
  if (
    !startButton ||
    !lockForm ||
    !lockInput ||
    !pinForm ||
    !pinDriver ||
    !pinValue ||
    !pinList ||
    !kiosk ||
    !kioskNow ||
    !kioskList ||
    !kioskDetail ||
    !kioskSearch ||
    !kioskRoster ||
    !kioskPin ||
    !kioskActions ||
    !kioskLeave
  ) {
    return { refresh() {} };
  }

  /** @type {{ id: string, name: string, routes: string[], clockIns: string[] } | null} */
  let selected = null;
  let unlocked = false;
  /** @type {string[]} */
  let kioskReasonIds = [];
  const reasonForm = document.querySelector('#reason-form');
  const reasonLabel = document.querySelector('#reason-label');
  const reasonList = document.querySelector('#reason-list');
  const kioskReason = document.querySelector('#kiosk-reason');
  const kioskReasonPicks = document.querySelector('#kiosk-reason-picks');
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let clockTimer;

  const lateFlashForm = document.querySelector('#late-flash-form');
  const lateFlashMinutes = document.querySelector('#late-flash-minutes');
  const nameSizeForm = document.querySelector('#name-size-form');
  const nameSizeInput = document.querySelector('#name-size');
  const quarterClockForm = document.querySelector('#quarter-clock-form');
  const quarterClocksInput = document.querySelector('#quarter-clocks');

  startButton.addEventListener('click', startKiosk);
  lockForm.addEventListener('submit', onSaveLock);
  lateFlashForm?.addEventListener('submit', onSaveLateFlash);
  quarterClockForm?.addEventListener('submit', onSaveQuarterClocks);
  nameSizeForm?.addEventListener('submit', onSaveNameSize);
  pinForm.addEventListener('submit', onSavePin);
  reasonForm?.addEventListener('submit', onSaveReason);
  reasonList?.addEventListener('click', onRemoveReason);
  document.querySelector('#kiosk-add-reason')?.addEventListener('click', () => {
    const id = kioskReason?.value || '';
    if (!id || kioskReasonIds.includes(id)) return;
    kioskReasonIds.push(id);
    renderKioskReasons();
  });
  kioskSearch.addEventListener('input', renderRoster);
  kioskBack?.addEventListener('click', () => showList());
  kioskPin.addEventListener('input', onPinInput);
  kioskPinForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    checkPin(pinDigits(kioskPin.value));
  });
  document.querySelector('#kiosk-in')?.addEventListener('click', () => punch('in'));
  document.querySelector('#kiosk-out')?.addEventListener('click', () => punch('out'));
  kioskLeave.addEventListener('submit', onLeave);

  function state() {
    return readState() || {};
  }

  function pins() {
    const saved = state().clockPins;
    return saved && typeof saved === 'object' ? { ...saved } : {};
  }

  function lockCode() {
    const saved = String(state().clockLockCode || '').trim();
    return saved || DEFAULT_KIOSK_CODE;
  }

  function people() {
    return listPeople()
      .map((person) => ({
        id: String(person.id || '').trim(),
        name: String(person.name || '').trim(),
        routes: Array.isArray(person.routes) ? person.routes.filter(Boolean) : [],
        clockIns: Array.isArray(person.clockIns)
          ? person.clockIns.map((item) => String(item || '').trim()).filter(Boolean)
          : [],
      }))
      .filter((person) => person.id && person.name)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  }

  function setOfficeStatus(message, kind = '') {
    if (!officeStatus) return;
    officeStatus.hidden = !message;
    officeStatus.textContent = message || '';
    officeStatus.className = `status${kind ? ` is-${kind}` : ''}`;
  }

  function fillLockField() {
    if (document.activeElement === lockInput) return;
    lockInput.value = lockCode();
  }

  function fillPinDrivers() {
    const current = pinDriver.value;
    const roster = people();
    pinDriver.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choose a driver';
    pinDriver.append(blank);
    for (const person of roster) {
      const option = document.createElement('option');
      option.value = person.id;
      option.textContent = person.name;
      pinDriver.append(option);
    }
    if (roster.some((person) => person.id === current)) pinDriver.value = current;
  }

  function pinFor(driverId) {
    return driverClockPin(pins(), driverId);
  }

  function renderPinList() {
    const roster = people();
    pinList.replaceChildren();
    if (!roster.length) {
      const item = document.createElement('li');
      item.className = 'pin-empty';
      item.textContent = 'No drivers yet.';
      pinList.append(item);
      return;
    }
    for (const person of roster) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = person.name;
      const code = document.createElement('span');
      code.textContent = pinFor(person.id);
      item.append(name, code);
      pinList.append(item);
    }
  }

  function onSaveLock(event) {
    event.preventDefault();
    const code = lockInput.value.trim();
    if (!/^[A-Za-z0-9]{4,64}$/.test(code)) {
      setOfficeStatus('The lock code needs 4 to 64 letters or numbers.', 'error');
      return;
    }
    const next = state();
    next.clockLockCode = code;
    writeState(next);
    setOfficeStatus('Lock code saved.', 'ok');
  }

  function fillLateFlash() {
    if (!lateFlashMinutes || document.activeElement === lateFlashMinutes) return;
    const minutes = normalizeLateFlashMinutes(state().clockLateMinutes);
    lateFlashMinutes.value = minutes == null ? '' : String(minutes);
  }

  function onSaveLateFlash(event) {
    event.preventDefault();
    const raw = lateFlashMinutes?.value.trim() ?? '';
    if (raw !== '' && (!/^\d+$/.test(raw) || Number(raw) > 240)) {
      setOfficeStatus('Enter a whole number from 0 to 240, or leave the box blank to turn flashing off.', 'error');
      return;
    }
    const next = state();
    next.clockLateMinutes = raw === '' ? null : Number(raw);
    writeState(next);
    if (raw === '') setOfficeStatus('Driver names will stay steady.', 'ok');
    else if (raw === '0') setOfficeStatus('Names flash when a route clock-in time arrives and that driver has not clocked in.', 'ok');
    else setOfficeStatus(`Names flash ${raw} minutes after a route clock-in if that driver has not clocked in.`, 'ok');
    refresh();
  }

  function fillQuarterClocks() {
    if (!quarterClocksInput || document.activeElement === quarterClocksInput) return;
    quarterClocksInput.checked = quarterHourClocksEnabled(state());
  }

  function onSaveQuarterClocks(event) {
    event.preventDefault();
    const next = state();
    next.clockQuarterHourClocks = Boolean(quarterClocksInput?.checked);
    writeState(next);
    setOfficeStatus(
      next.clockQuarterHourClocks
        ? 'Clock in and clock out times round to the nearest quarter hour.'
        : 'Clock in and clock out times stay exact. Only the quarter-hour totals are rounded.',
      'ok'
    );
  }

  function fillNameSize() {
    if (!nameSizeInput || document.activeElement === nameSizeInput) return;
    nameSizeInput.value = normalizeClockNameSize(state().clockNameSize) || 'regular';
  }

  function applyNameSize() {
    const size = normalizeClockNameSize(state().clockNameSize) || 'regular';
    kioskRoster.classList.toggle('is-compact', size === 'compact');
    kioskRoster.classList.toggle('is-large', size === 'large');
  }

  function onSaveNameSize(event) {
    event.preventDefault();
    const size = normalizeClockNameSize(nameSizeInput?.value);
    if (!size) {
      setOfficeStatus('Choose a name badge size.', 'error');
      return;
    }
    const next = state();
    next.clockNameSize = size;
    writeState(next);
    applyNameSize();
    setOfficeStatus('Name badge size saved.', 'ok');
  }

  function catalog() {
    const saved = state().clockReasonCodes;
    return Array.isArray(saved) ? saved : [];
  }

  function renderReasonList() {
    if (!reasonList) return;
    reasonList.replaceChildren();
    const codes = catalog();
    if (!codes.length) {
      const item = document.createElement('li');
      item.className = 'pin-empty';
      item.textContent = 'No reason codes yet.';
      reasonList.append(item);
      return;
    }
    for (const code of codes) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = code.label;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.dataset.reasonId = code.id;
      remove.textContent = 'Remove';
      item.append(name, remove);
      reasonList.append(item);
    }
  }

  function fillKioskReasons() {
    if (!kioskReason) return;
    const current = kioskReason.value;
    kioskReason.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choose a reason';
    kioskReason.append(blank);
    for (const code of catalog()) {
      const option = document.createElement('option');
      option.value = code.id;
      option.textContent = code.label;
      kioskReason.append(option);
    }
    if ([...kioskReason.options].some((option) => option.value === current)) {
      kioskReason.value = current;
    }
  }

  function renderKioskReasons() {
    if (!kioskReasonPicks) return;
    const labels = new Map(catalog().map((code) => [code.id, code.label]));
    kioskReasonPicks.replaceChildren();
    for (const id of kioskReasonIds) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = labels.get(id) || id;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        kioskReasonIds = kioskReasonIds.filter((itemId) => itemId !== id);
        renderKioskReasons();
      });
      item.append(name, remove);
      kioskReasonPicks.append(item);
    }
  }

  function onSaveReason(event) {
    event.preventDefault();
    const label = reasonLabel?.value.trim() || '';
    try {
      const next = state();
      next.clockReasonCodes = addReasonCode(catalog(), label);
      writeState(next);
      if (reasonLabel) reasonLabel.value = '';
      setOfficeStatus('Reason code added.', 'ok');
      refresh();
    } catch (error) {
      setOfficeStatus(error instanceof Error ? error.message : 'Could not add that reason code.', 'error');
    }
  }

  /**
   * @param {Event} event
   */
  function onRemoveReason(event) {
    const button = event.target instanceof Element ? event.target.closest('[data-reason-id]') : null;
    if (!button) return;
    const id = button.getAttribute('data-reason-id') || '';
    try {
      const next = state();
      next.clockReasonCodes = removeReasonCode(catalog(), id);
      writeState(next);
      setOfficeStatus('Reason code removed.', 'ok');
      refresh();
    } catch (error) {
      setOfficeStatus(error instanceof Error ? error.message : 'Could not remove that reason code.', 'error');
    }
  }

  function onSavePin(event) {
    event.preventDefault();
    const driverId = pinDriver.value.trim();
    const pin = pinValue.value.trim();
    const person = people().find((item) => item.id === driverId);
    if (!person) {
      setOfficeStatus('Choose a driver.', 'error');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setOfficeStatus('PIN must be 4 digits.', 'error');
      return;
    }
    const next = state();
    next.clockPins = { ...pins(), [driverId]: pin };
    writeState(next);
    pinValue.value = '';
    setOfficeStatus(`PIN saved for ${person.name}.`, 'ok');
    refresh();
  }

  function pinDigits(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 4);
  }

  function showList(message = '') {
    if (selected) rememberLateVisit(selected);
    selected = null;
    unlocked = false;
    kioskList.hidden = false;
    kioskDetail.hidden = true;
    kioskActions.hidden = true;
    kioskPin.value = '';
    kioskReasonIds = [];
    renderKioskReasons();
    if (kioskPinError) kioskPinError.textContent = '';
    if (kioskListStatus) kioskListStatus.textContent = message;
    kioskSearch.value = '';
    renderRoster();
    kioskSearch.focus();
  }

  function renderRoster() {
    applyNameSize();
    const query = kioskSearch.value.trim().toLowerCase();
    const roster = people().filter((person) => person.name.toLowerCase().includes(query));
    kioskRoster.replaceChildren();
    if (!roster.length) {
      const empty = document.createElement('p');
      empty.className = 'kiosk-empty';
      empty.textContent = 'No drivers match that name.';
      kioskRoster.append(empty);
      return;
    }
    const colors = ensureNameColors(people());
    for (const person of roster) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'kiosk-name';
      button.dataset.driverId = person.id;
      button.dataset.driverName = person.name;
      button.dataset.clockIns = person.clockIns.join(',');
      const paint = nameButtonColors(colors.get(person.id) ?? 0);
      button.style.setProperty('--name-bg', paint.background);
      button.style.setProperty('--name-border', paint.border);
      const label = document.createElement('span');
      label.className = 'kiosk-name-label';
      label.textContent = person.name;
      const status = clockStatus(person.name);
      const badge = document.createElement('span');
      badge.className = `kiosk-status is-${status}`;
      badge.textContent = status === 'in' ? 'IN' : 'OUT';
      button.append(label, badge);
      paintLate(button, person);
      button.addEventListener('click', () => openDriver(person));
      kioskRoster.append(button);
    }
  }

  /**
   * Latest punch wins. No punch, or a last clock out, is Out.
   * @param {string} name
   * @returns {'in' | 'out'}
   */
  function clockStatus(name) {
    const wanted = name.trim().toLowerCase();
    let latest = null;
    for (const punch of Array.isArray(state().punches) ? state().punches : []) {
      if (String(punch?.driver_name || '').trim().toLowerCase() !== wanted) continue;
      if (!latest || String(punch.punched_at) > String(latest.punched_at)) latest = punch;
    }
    return latest?.action === 'in' ? 'in' : 'out';
  }

  /**
   * @param {string} driverId
   */
  function acknowledgements(driverId) {
    const all = readLateAcks();
    const list = all[driverId];
    return Array.isArray(list) ? list.map((item) => String(item)) : [];
  }

  function readLateAcks() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(LATE_ACK_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch {
      return {};
    }
  }

  /**
   * Opening this driver and coming back clears every clock-in that is already late.
   * A later run can still flash when its own clock-in passes.
   * @param {{ id: string, name: string, clockIns: string[] }} person
   */
  function rememberLateVisit(person) {
    const current = people().find((item) => item.id === person.id) || person;
    const keys = dueClockInKeys({
      now: new Date(),
      graceMinutes: state().clockLateMinutes,
      clockIns: current.clockIns,
    });
    if (!keys.length) return;
    const today = keys[0].slice(0, 10);
    const all = readLateAcks();
    const prior = acknowledgements(person.id).filter((key) => key.startsWith(`${today}|`));
    all[person.id] = [...new Set([...prior, ...keys])];
    sessionStorage.setItem(LATE_ACK_KEY, JSON.stringify(all));
  }

  /**
   * @param {HTMLButtonElement} button
   * @param {{ id: string, name: string, clockIns: string[] }} person
   */
  function paintLate(button, person) {
    const late =
      flashingClockInKeys({
        now: new Date(),
        graceMinutes: state().clockLateMinutes,
        clockIns: person.clockIns,
        punches: Array.isArray(state().punches) ? state().punches : [],
        driverName: person.name,
        acknowledged: acknowledgements(person.id),
      }).length > 0;
    button.classList.toggle('is-late', late);
    if (late) button.setAttribute('aria-label', `${person.name}, late to clock in`);
    else button.removeAttribute('aria-label');
  }

  function paintRosterLate() {
    if (kiosk.hidden || kioskList.hidden) return;
    const punches = Array.isArray(state().punches) ? state().punches : [];
    const graceMinutes = state().clockLateMinutes;
    const now = new Date();
    for (const button of kioskRoster.querySelectorAll('.kiosk-name')) {
      if (!(button instanceof HTMLButtonElement)) continue;
      const name = button.dataset.driverName || '';
      const next =
        flashingClockInKeys({
          now,
          graceMinutes,
          clockIns: (button.dataset.clockIns || '').split(',').filter(Boolean),
          punches,
          driverName: name,
          acknowledged: acknowledgements(button.dataset.driverId || ''),
        }).length > 0;
      if (button.classList.contains('is-late') === next) continue;
      button.classList.toggle('is-late', next);
      if (next) button.setAttribute('aria-label', `${name}, late to clock in`);
      else button.removeAttribute('aria-label');
    }
  }

  /**
   * @param {{ id: string, name: string, routes: string[] }} person
   */
  function openDriver(person) {
    selected = person;
    unlocked = false;
    kioskList.hidden = true;
    kioskDetail.hidden = false;
    if (kioskDriver) kioskDriver.textContent = person.name;
    if (kioskRoutes) {
      kioskRoutes.textContent = person.routes.length ? `Route ${person.routes.join(', ')}` : '';
    }
    kioskPin.value = '';
    kioskReasonIds = [];
    renderKioskReasons();
    kioskActions.hidden = true;
    if (kioskPinForm) kioskPinForm.hidden = false;
    if (kioskPinError) kioskPinError.textContent = '';
    kioskPin.focus();
  }

  function onPinInput() {
    const entered = pinDigits(kioskPin.value);
    if (kioskPin.value !== entered) kioskPin.value = entered;
    if (kioskPinError) kioskPinError.textContent = '';
    if (entered.length === 4) checkPin(entered);
  }

  /**
   * @param {string} entered
   */
  function checkPin(entered) {
    if (!selected || unlocked || !/^\d{4}$/.test(entered)) return;
    if (pinFor(selected.id) !== entered) {
      kioskPin.value = '';
      if (kioskPinError) kioskPinError.textContent = 'That PIN does not match.';
      kioskPin.focus();
      return;
    }
    unlocked = true;
    if (kioskPinForm) kioskPinForm.hidden = true;
    kioskReasonIds = [];
    fillKioskReasons();
    renderKioskReasons();
    kioskActions.hidden = false;
  }

  /**
   * @param {'in' | 'out'} action
   */
  function punch(action) {
    if (!selected || !unlocked) return;
    const next = state();
    const punches = Array.isArray(next.punches) ? next.punches : [];
    next.punches = [
      ...punches,
      {
        id: crypto.randomUUID(),
        driver_name: selected.name,
        action,
        punched_at: new Date().toISOString(),
        note: '',
        reason_codes: catalog().filter((code) => kioskReasonIds.includes(code.id)),
      },
    ];
    writeState(next);
    const verb = action === 'in' ? 'clocked in' : 'clocked out';
    showList(`${selected.name} ${verb}.`);
  }

  function tick() {
    kioskNow.textContent = new Date().toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
    paintRosterLate();
  }

  function holdBack() {
    history.pushState({ timeclock: true }, '', location.href);
  }

  function onPopState() {
    if (kiosk.hidden) return;
    holdBack();
  }

  async function startKiosk() {
    sessionStorage.setItem(LOCK_KEY, '1');
    kiosk.hidden = false;
    document.body.classList.add('is-timeclock');
    showList();
    tick();
    clearInterval(clockTimer);
    clockTimer = setInterval(tick, 1000);
    holdBack();
    window.addEventListener('popstate', onPopState);
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (typeof request === 'function') {
      try {
        await request.call(root);
      } catch {
        // Full screen is optional. The lock still holds this browser on the driver screen.
      }
    }
  }

  function onLeave(event) {
    event.preventDefault();
    if (kioskLeaveError) kioskLeaveError.textContent = '';
    if (kioskLeaveCode.value.trim() !== lockCode()) {
      kioskLeaveCode.value = '';
      if (kioskLeaveError) kioskLeaveError.textContent = 'That lock code does not match.';
      kioskLeaveCode.focus();
      return;
    }
    sessionStorage.removeItem(LOCK_KEY);
    kiosk.hidden = true;
    document.body.classList.remove('is-timeclock');
    clearInterval(clockTimer);
    window.removeEventListener('popstate', onPopState);
    kioskLeaveCode.value = '';
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }

  function refresh() {
    fillLockField();
    fillLateFlash();
    fillQuarterClocks();
    fillNameSize();
    applyNameSize();
    fillPinDrivers();
    renderPinList();
    renderReasonList();
    fillKioskReasons();
    if (!kiosk.hidden && kioskDetail.hidden) renderRoster();
  }

  if (sessionStorage.getItem(LOCK_KEY) === '1') {
    kiosk.hidden = false;
    document.body.classList.add('is-timeclock');
    showList();
    tick();
    clockTimer = setInterval(tick, 1000);
    window.addEventListener('popstate', onPopState);
  }

  return { refresh };
}

/**
 * @param {number} index
 */
function hueForColorIndex(index) {
  return (index * 47) % 360;
}

/**
 * @param {number} a
 * @param {number} b
 */
function hueDistance(a, b) {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

/**
 * Pick an unused palette slot whose hue is as far as possible from colors already in use.
 * @param {Set<number>} used
 */
function nextColorIndex(used) {
  const limit = Math.max(used.size + 36, 12);
  let best = 0;
  let bestDistance = -1;
  for (let index = 0; index < limit; index += 1) {
    if (used.has(index)) continue;
    const hue = hueForColorIndex(index);
    let nearest = 180;
    for (const taken of used) nearest = Math.min(nearest, hueDistance(hue, hueForColorIndex(taken)));
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = index;
    }
  }
  return best;
}

/**
 * @param {number} index
 */
function nameButtonColors(index) {
  const hue = hueForColorIndex(index);
  const band = index % 3;
  const saturation = [52, 64, 42][band];
  const lightness = [86, 80, 91][band];
  return {
    background: `hsl(${hue} ${saturation}% ${lightness}%)`,
    border: `hsl(${hue} ${Math.min(saturation + 12, 78)}% ${lightness - 18}%)`,
  };
}

function readStoredNameColors() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NAME_COLOR_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Keep a stable color for each driver. New people get a free color; saved ones stay put.
 * @param {Array<{ id: string, name: string }>} drivers
 */
function ensureNameColors(drivers) {
  const stored = readStoredNameColors();
  /** @type {Map<string, number>} */
  const assigned = new Map();
  const used = new Set();
  const ordered = [...drivers].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  for (const driver of ordered) {
    const saved = stored[driver.id];
    if (!Number.isInteger(saved) || saved < 0 || used.has(saved)) continue;
    assigned.set(driver.id, saved);
    used.add(saved);
  }
  let changed = false;
  for (const driver of ordered) {
    if (assigned.has(driver.id)) continue;
    const index = nextColorIndex(used);
    assigned.set(driver.id, index);
    used.add(index);
    stored[driver.id] = index;
    changed = true;
  }
  if (changed) {
    try {
      localStorage.setItem(NAME_COLOR_KEY, JSON.stringify(stored));
    } catch {
      // The colors still apply for this visit when storage is blocked.
    }
  }
  return assigned;
}
