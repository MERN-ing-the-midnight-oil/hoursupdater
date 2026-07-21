import { createStatusBadge, enhanceGlossaryTips } from '../shared/glossaryTip.js';
import { enhanceIcons } from '../shared/icons.js';
import { initRosterImportTip } from '../shared/rosterImportTip.js';

enhanceGlossaryTips();
enhanceIcons();
initRosterImportTip();

const form = document.getElementById('change-form');
const routeSearch = document.getElementById('route_search');
const routeIdInput = document.getElementById('route_id');
const routeListbox = document.getElementById('route-listbox');
const routeCombobox = document.getElementById('route-combobox');
const routeModeHint = document.getElementById('route-mode-hint');
const newRouteBtn = document.getElementById('new-route-btn');
const cancelNewRouteBtn = document.getElementById('cancel-new-route-btn');
const newRouteFields = document.getElementById('new-route-fields');
const newRouteIdInput = document.getElementById('new_route_id');

const driverSearch = document.getElementById('driver_search');
const driverIdInput = document.getElementById('driver_id');
const driverNameInput = document.getElementById('driver_name');
const driverListbox = document.getElementById('driver-listbox');
const driverCombobox = document.getElementById('driver-combobox');
const driverModeHint = document.getElementById('driver-mode-hint');
const segmentSelect = document.getElementById('segment');
const previousInput = document.getElementById('previous_time');
const previousTimeFormatHint = document.getElementById('previous-time-format-hint');
const newTimeField = document.getElementById('new-time-field');
const newTimeInput = document.getElementById('new_time');
const deltaBox = document.getElementById('delta-box');
const computedDeltaInput = document.getElementById('computed_delta');
const deltaUsedInput = document.getElementById('delta_minutes');
const adjustmentBlock = document.getElementById('adjustment-block');
const adjustmentReason = document.getElementById('adjustment_reason');
const reasonCategoryInput = document.getElementById('reason_category');
const enteredByInput = document.getElementById('entered_by');
const effectiveDateInput = document.getElementById('effective_date');
const statusEl = document.getElementById('status');
const recentList = document.getElementById('recent-list');
const submitBtn = document.getElementById('submit-btn');
const resetBtn = document.getElementById('reset-btn');

const DRIVER_HINT_EXISTING_HTML =
  'Pick a known driver from the list. Add someone new under <a href="/admin/drivers">Drivers/Routes</a>.';
const DRIVER_HINT_NEW_HTML =
  'Optional — leave blank to create the route as Unassigned. Assign a driver later under <a href="/admin/drivers">Drivers/Routes</a>.';
const SCHEDULE_FORMAT_PLACEHOLDER = 'H:MM-H:MM (e.g. 6:35-8:55)';

/** @type {Map<string, { route_id: string, driver_name: string, driver_id?: string|null, segments: Record<string, string|null> }>} */
const routesById = new Map();

/** @type {Map<string, { driver_id: string, name: string, email: string|null }>} */
const driversById = new Map();

/** @type {'existing' | 'new'} */
let routeMode = 'existing';
let computedDelta = null;
let previousLockedFromState = false;
let activeRouteOptionIndex = -1;
let activeDriverOptionIndex = -1;

function todayLocalDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
}

function showStatus(message, kind = 'ok') {
  statusEl.textContent = message;
  statusEl.className = `status visible ${kind}`;
}

function clearStatus() {
  statusEl.textContent = '';
  statusEl.className = 'status';
}

function parseClock(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time).trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 23) return null;
  return hours * 60 + minutes;
}

function parseScheduleRange(range) {
  const parts = String(range).trim().split('-');
  if (parts.length !== 2) return null;
  const start = parseClock(parts[0]);
  const end = parseClock(parts[1]);
  if (start == null || end == null || end <= start) return null;
  return { start, end, duration: end - start };
}

function computeDelta(previousTime, newTime) {
  const previous = parseScheduleRange(previousTime);
  const next = parseScheduleRange(newTime);
  if (!previous || !next) return null;
  return next.duration - previous.duration;
}

function syncAdjustmentVisibility() {
  const used = deltaUsedInput.value === '' ? null : Number(deltaUsedInput.value);
  const adjusted =
    computedDelta != null && used != null && !Number.isNaN(used) && used !== computedDelta;
  adjustmentBlock.classList.toggle('visible', adjusted);
  adjustmentReason.required = adjusted;
  if (!adjusted) {
    adjustmentReason.value = '';
  }
}

function refreshComputedDelta() {
  const delta = computeDelta(previousInput.value, newTimeInput.value);
  computedDelta = delta;
  computedDeltaInput.value = delta == null ? '' : String(delta);
  if (delta != null && (deltaUsedInput.value === '' || !deltaUsedInput.dataset.touched)) {
    deltaUsedInput.value = String(delta);
  }
  syncAdjustmentVisibility();
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function routeDisplayLabel(route) {
  return `${route.route_id} — ${route.driver_name?.trim() || 'Unassigned'}`;
}

function filteredRoutes(query) {
  const q = query.trim().toLowerCase();
  const all = [...routesById.values()];
  if (!q) return all;
  return all.filter(
    (route) =>
      route.route_id.toLowerCase().includes(q) ||
      String(route.driver_name || '')
        .toLowerCase()
        .includes(q) ||
      (!route.driver_name && 'unassigned'.includes(q))
  );
}

function filteredDrivers(query) {
  const q = query.trim().toLowerCase();
  const all = [...driversById.values()];
  if (!q) return all;
  return all.filter(
    (driver) =>
      driver.name.toLowerCase().includes(q) ||
      (driver.email && driver.email.toLowerCase().includes(q))
  );
}

/** While a committed selection is still showing, browse the full list. */
function getRouteFilterQuery() {
  if (routeIdInput.value) {
    const route = routesById.get(routeIdInput.value);
    if (route && routeSearch.value === routeDisplayLabel(route)) {
      return '';
    }
  }
  return routeSearch.value;
}

function getDriverFilterQuery() {
  if (driverIdInput.value) {
    const driver = driversById.get(driverIdInput.value);
    if (driver && driverSearch.value === driver.name) {
      return '';
    }
  }
  return driverSearch.value;
}

function findRouteForDriver(driver) {
  return [...routesById.values()].find(
    (route) =>
      (route.driver_id && route.driver_id === driver.driver_id) ||
      (route.driver_name &&
        route.driver_name.trim().toLowerCase() === driver.name.trim().toLowerCase())
  );
}

function closeRouteListbox() {
  routeListbox.hidden = true;
  routeSearch.setAttribute('aria-expanded', 'false');
  activeRouteOptionIndex = -1;
}

function openRouteListbox() {
  if (routeMode !== 'existing') return;
  routeListbox.hidden = false;
  routeSearch.setAttribute('aria-expanded', 'true');
}

function closeDriverListbox() {
  driverListbox.hidden = true;
  driverSearch.setAttribute('aria-expanded', 'false');
  activeDriverOptionIndex = -1;
}

function openDriverListbox() {
  driverListbox.hidden = false;
  driverSearch.setAttribute('aria-expanded', 'true');
}

function renderRouteOptions(query = getRouteFilterQuery()) {
  const matches = filteredRoutes(query);
  routeListbox.innerHTML = '';

  if (!matches.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = routesById.size
      ? 'No matching routes. Use “Create new route” if this is brand new.'
      : 'No routes on file yet. Use “Create new route”.';
    routeListbox.appendChild(empty);
    openRouteListbox();
    return;
  }

  matches.forEach((route, index) => {
    const li = document.createElement('li');
    li.id = `route-option-${index}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', index === activeRouteOptionIndex ? 'true' : 'false');
    li.dataset.routeId = route.route_id;
    li.textContent = routeDisplayLabel(route);
    li.addEventListener('mousedown', (event) => {
      event.preventDefault();
      selectExistingRoute(route.route_id);
    });
    routeListbox.appendChild(li);
  });

  openRouteListbox();
}

function renderDriverOptions(query = getDriverFilterQuery()) {
  const matches = filteredDrivers(query);
  driverListbox.innerHTML = '';

  if (!matches.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = driversById.size
      ? 'No matching drivers. Add someone new under Drivers/Routes.'
      : 'No drivers on file yet. Add them under Drivers/Routes.';
    driverListbox.appendChild(empty);
    openDriverListbox();
    return;
  }

  matches.forEach((driver, index) => {
    const li = document.createElement('li');
    li.id = `driver-option-${index}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', index === activeDriverOptionIndex ? 'true' : 'false');
    li.dataset.driverId = driver.driver_id;
    li.textContent = driver.email
      ? `${driver.name} · ${driver.email}`
      : `${driver.name} · no email`;
    li.addEventListener('mousedown', (event) => {
      event.preventDefault();
      selectExistingDriver(driver.driver_id);
    });
    driverListbox.appendChild(li);
  });

  openDriverListbox();
}

/**
 * @param {string} driverId
 * @param {{ syncRoute?: boolean }} [options]
 */
function selectExistingDriver(driverId, options = {}) {
  const { syncRoute = true } = options;
  const driver = driversById.get(driverId);
  if (!driver) return;

  driverIdInput.value = driver.driver_id;
  driverNameInput.value = driver.name;
  driverSearch.value = driver.name;
  closeDriverListbox();

  if (syncRoute && routeMode === 'existing') {
    const match = findRouteForDriver(driver);
    if (match) {
      selectExistingRoute(match.route_id, { syncDriver: false });
    }
  }
}

/**
 * @param {string} routeId
 * @param {{ syncDriver?: boolean }} [options]
 */
function selectExistingRoute(routeId, options = {}) {
  const { syncDriver = true } = options;
  const route = routesById.get(routeId);
  if (!route) return;

  routeMode = 'existing';
  routeIdInput.value = route.route_id;
  routeSearch.value = routeDisplayLabel(route);
  if (syncDriver) {
    if (route.driver_id && driversById.has(route.driver_id)) {
      selectExistingDriver(route.driver_id, { syncRoute: false });
    } else if (route.driver_name) {
      const match = [...driversById.values()].find(
        (d) => d.name.toLowerCase() === route.driver_name.toLowerCase()
      );
      if (match) {
        selectExistingDriver(match.driver_id, { syncRoute: false });
      } else {
        driverIdInput.value = '';
        driverNameInput.value = route.driver_name;
        driverSearch.value = route.driver_name;
      }
    } else {
      driverIdInput.value = '';
      driverNameInput.value = '';
      driverSearch.value = '';
    }
  }
  closeRouteListbox();
  fillPreviousTime();
}

function syncNewRouteFormChrome() {
  const isNew = routeMode === 'new';
  previousTimeFormatHint.hidden = !isNew;
  newTimeField.hidden = isNew;
  newTimeInput.required = !isNew;
  deltaBox.hidden = isNew;
  driverNameInput.required = !isNew;
  if (driverModeHint) {
    driverModeHint.innerHTML = isNew ? DRIVER_HINT_NEW_HTML : DRIVER_HINT_EXISTING_HTML;
  }
  if (isNew) {
    newTimeInput.value = '';
    computedDelta = 0;
    computedDeltaInput.value = '0';
    deltaUsedInput.value = '0';
    deltaUsedInput.dataset.touched = '';
    adjustmentBlock.classList.remove('visible');
    adjustmentReason.required = false;
    adjustmentReason.value = '';
  }
}

function enterNewRouteMode() {
  routeMode = 'new';
  routeIdInput.value = '';
  routeSearch.value = '';
  routeSearch.disabled = true;
  routeCombobox.classList.add('is-disabled');
  newRouteFields.hidden = false;
  newRouteBtn.hidden = true;
  newRouteIdInput.value = '';
  newRouteIdInput.required = true;
  clearPreviousSchedule({
    placeholder: SCHEDULE_FORMAT_PLACEHOLDER,
  });
  syncNewRouteFormChrome();
  routeModeHint.textContent =
    'Creating a new route. Enter the route ID and the current segment schedule — there is no prior state to auto-fill.';
  closeRouteListbox();
  newRouteIdInput.focus();
}

/**
 * @param {{ focus?: boolean }} [options]
 */
function exitNewRouteMode(options = {}) {
  const { focus = true } = options;
  routeMode = 'existing';
  routeSearch.disabled = false;
  routeCombobox.classList.remove('is-disabled');
  newRouteFields.hidden = true;
  newRouteBtn.hidden = false;
  newRouteIdInput.required = false;
  newRouteIdInput.value = '';
  routeIdInput.value = '';
  routeSearch.value = '';
  clearPreviousSchedule();
  syncNewRouteFormChrome();
  routeModeHint.textContent =
    'Pick a known route from the list. Use “Create new route” only for a route that isn’t in the system yet.';
  closeRouteListbox();
  if (focus) {
    routeSearch.focus();
  }
}

function clearDriverSelection() {
  driverIdInput.value = '';
  driverNameInput.value = '';
  driverSearch.value = '';
  closeDriverListbox();
}

function resolveSelectedRouteId() {
  if (routeMode === 'new') {
    return newRouteIdInput.value.trim();
  }
  return routeIdInput.value.trim();
}

function resolveSelectedDriver() {
  return {
    driver_id: driverIdInput.value.trim() || null,
    driver_name: driverNameInput.value.trim(),
  };
}

async function loadRoutes() {
  const routes = await fetchJson('/api/routes');
  routesById.clear();
  for (const route of routes) {
    routesById.set(route.route_id, route);
  }
}

async function loadDrivers() {
  const drivers = await fetchJson('/api/drivers');
  driversById.clear();
  for (const driver of drivers) {
    driversById.set(driver.driver_id, driver);
  }
}

async function loadStaffNames() {
  const names = await fetchJson('/api/staff-names');
  const previous = enteredByInput.value || localStorage.getItem('rct_entered_by') || '';
  enteredByInput.innerHTML = '<option value="">Select your name…</option>';
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    enteredByInput.appendChild(option);
  }
  if (previous && names.includes(previous)) {
    enteredByInput.value = previous;
  }
  if (!names.length) {
    showStatus(
      'No staff names configured yet. Use “Don\'t see your name?” below to add names in Admin Settings.',
      'warn'
    );
  }
}

async function loadAdjustmentReasons() {
  const reasons = await fetchJson('/api/adjustment-reasons');
  adjustmentReason.innerHTML = '<option value="">Select a reason…</option>';
  for (const reason of reasons) {
    const option = document.createElement('option');
    option.value = reason;
    option.textContent = reason;
    adjustmentReason.appendChild(option);
  }
}

async function loadReasonCategories() {
  const categories = await fetchJson('/api/reason-categories');
  const previous = reasonCategoryInput.value;
  reasonCategoryInput.innerHTML = '<option value="">Select a category…</option>';
  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    reasonCategoryInput.appendChild(option);
  }
  if (previous && categories.includes(previous)) {
    reasonCategoryInput.value = previous;
  }
}

async function loadRecent() {
  const changes = await fetchJson('/api/changes/recent?limit=20');
  recentList.innerHTML = '';
  if (!changes.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No changes submitted yet.';
    recentList.appendChild(empty);
    return;
  }

  for (const change of changes) {
    const li = document.createElement('li');
    const adjusted =
      change.computed_delta_minutes !== change.delta_minutes
        ? ` · adjusted from ${change.computed_delta_minutes}`
        : '';
    const top = document.createElement('div');
    top.innerHTML = `<strong>${change.route_id}</strong> · ${change.driver_name} · ${change.segment}`;
    if (change.pending) {
      const pendingBadge = document.createElement('span');
      pendingBadge.className = 'badge pending';
      pendingBadge.textContent = 'Held · under review';
      top.append(document.createTextNode(' '), pendingBadge);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.append(
      document.createTextNode(
        `${change.previous_time} → ${change.new_time} · time difference ${change.delta_minutes}${adjusted} · status `
      ),
      createStatusBadge(change.route_status ?? '—')
    );

    const when = document.createElement('div');
    when.className = 'meta';
    when.textContent = `start ${change.effective_date} · entered by ${change.entered_by} · ${new Date(change.submitted_at).toLocaleString()}`;

    li.append(top, meta, when);
    recentList.appendChild(li);
  }
  enhanceGlossaryTips(recentList);
}

/**
 * @param {{ value?: string, locked?: boolean, placeholder?: string }} [options]
 */
function applyPreviousSchedule(options = {}) {
  const value = options.value ? String(options.value).trim() : '';
  previousInput.value = value;
  previousLockedFromState = Boolean(options.locked && value);
  previousInput.readOnly = previousLockedFromState;
  previousInput.placeholder = options.placeholder || '';
  refreshComputedDelta();
}

/**
 * @param {{ placeholder?: string }} [options]
 */
function clearPreviousSchedule(options = {}) {
  applyPreviousSchedule({
    value: '',
    locked: false,
    placeholder: options.placeholder || '',
  });
}

/**
 * Prefer the route’s known segment time over any example placeholder.
 * @param {string} routeId
 * @param {string} segment
 * @returns {string|null}
 */
function localSegmentTime(routeId, segment) {
  const route = routesById.get(routeId);
  const time = route?.segments?.[segment];
  return time ? String(time).trim() : null;
}

async function fillPreviousTime() {
  const routeId = resolveSelectedRouteId();
  const segment = segmentSelect.value;
  if (!routeId || routeMode === 'new') {
    if (routeMode !== 'new') {
      clearPreviousSchedule();
    }
    return;
  }

  const cached = localSegmentTime(routeId, segment);
  if (cached) {
    applyPreviousSchedule({ value: cached, locked: true });
  } else {
    clearPreviousSchedule({
      placeholder: 'No prior schedule on file for this segment — enter current schedule',
    });
  }

  try {
    const data = await fetchJson(
      `/api/routes/${encodeURIComponent(routeId)}/segment-time?segment=${encodeURIComponent(segment)}`
    );
    if (resolveSelectedRouteId() !== routeId || segmentSelect.value !== segment) {
      return;
    }
    if (data.driver_id && driversById.has(data.driver_id)) {
      selectExistingDriver(data.driver_id, { syncRoute: false });
    } else if (data.driver_name && !driverIdInput.value) {
      const match = [...driversById.values()].find(
        (d) => d.name.toLowerCase() === data.driver_name.toLowerCase()
      );
      if (match) selectExistingDriver(match.driver_id, { syncRoute: false });
    }
    if (data.previous_time) {
      applyPreviousSchedule({ value: data.previous_time, locked: true });
    } else {
      clearPreviousSchedule({
        placeholder: 'No prior schedule on file for this segment — enter current schedule',
      });
    }
  } catch (error) {
    if (!cached) {
      previousInput.readOnly = false;
      previousLockedFromState = false;
    }
    console.warn(error);
  }
}

function resetFormFields(keepEnteredBy) {
  const enteredBy = keepEnteredBy ?? enteredByInput.value;
  form.reset();
  effectiveDateInput.value = todayLocalDate();
  computedDelta = null;
  computedDeltaInput.value = '';
  deltaUsedInput.dataset.touched = '';
  clearPreviousSchedule();
  exitNewRouteMode({ focus: false });
  clearDriverSelection();
  if (enteredBy) {
    enteredByInput.value = enteredBy;
  }
  syncAdjustmentVisibility();
}

// Enter in a text/select field submits the form by default. That accidentally
// logs a change (Entered by is often restored from localStorage) and clears the
// form via reset — which also focused Driver. Combobox handlers still call
// preventDefault when Enter selects a list option.
form.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !form.contains(target)) return;
  if (target instanceof HTMLTextAreaElement) return;
  if (target instanceof HTMLButtonElement) return;
  if (target === submitBtn) return;
  event.preventDefault();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearStatus();
  submitBtn.disabled = true;

  try {
    const routeId = resolveSelectedRouteId();
    if (!routeId) {
      throw new Error(
        routeMode === 'new'
          ? 'Enter a new route ID.'
          : 'Select an existing route from the list, or use “Create new route”.'
      );
    }

    if (routeMode === 'existing' && !routesById.has(routeId)) {
      throw new Error(
        'That route isn’t in the current route list. Select one from the dropdown, or use “Create new route”.'
      );
    }

    if (routeMode === 'new' && routesById.has(routeId)) {
      throw new Error(
        `Route “${routeId}” already exists. Cancel create-new and select it from the list instead.`
      );
    }

    const driver = resolveSelectedDriver();
    if (routeMode !== 'new' && (!driver.driver_id || !driver.driver_name)) {
      throw new Error(
        'Select a driver from the directory. Add someone new under Drivers/Routes.'
      );
    }

    let previousTime = previousInput.value.trim();
    let newTime = newTimeInput.value.trim();
    let used;

    if (routeMode === 'new') {
      if (!previousTime || parseScheduleRange(previousTime) == null) {
        throw new Error(
          'Enter the current schedule as H:MM-H:MM (e.g. 6:35-8:55).'
        );
      }
      // Creating a route seeds the segment — there is no prior→new change.
      newTime = previousTime;
      computedDelta = 0;
      used = 0;
    } else {
      refreshComputedDelta();
      used = Number(deltaUsedInput.value);
      if (computedDelta == null || Number.isNaN(used)) {
        throw new Error(
          'Enter valid current/new schedules so the time difference can be calculated.'
        );
      }
      if (used !== computedDelta && !adjustmentReason.value) {
        throw new Error('Select a reason for adjusting Time Difference To Accumulate.');
      }
    }

    if (!reasonCategoryInput.value) {
      throw new Error('Select a reason category.');
    }

    if (!enteredByInput.value) {
      throw new Error('Select your name from the staff list.');
    }

    const payload = {
      route_id: routeId,
      create_new_route: routeMode === 'new',
      create_new_driver: false,
      driver_id: driver.driver_id,
      driver_name: driver.driver_name,
      segment: segmentSelect.value,
      effective_date: effectiveDateInput.value,
      previous_time: previousTime,
      new_time: newTime,
      delta_minutes: used,
      adjustment_reason: routeMode === 'new' ? null : adjustmentReason.value || null,
      reason_category: reasonCategoryInput.value,
      note: document.getElementById('note').value.trim(),
      entered_by: enteredByInput.value.trim(),
    };

    const result = await fetchJson('/api/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    localStorage.setItem('rct_entered_by', payload.entered_by);
    const statusKind = result.pending ? 'warn' : 'ok';
    showStatus(result.message, statusKind);

    const driverId = result.change?.driver_id || payload.driver_id;
    if (driverId) {
      sessionStorage.setItem(
        'rct_flash',
        JSON.stringify({ message: result.message, kind: statusKind })
      );
      // Brief pause so the success message is visible before leaving the form.
      window.setTimeout(() => {
        window.location.assign(
          `/admin/drivers/${encodeURIComponent(driverId)}#change-history`
        );
      }, 1200);
      return; // leave Submit disabled until navigation
    }

    resetFormFields(payload.entered_by);
    await Promise.all([loadRoutes(), loadDrivers(), loadRecent()]);
    submitBtn.disabled = false;
  } catch (error) {
    showStatus(error.message, 'error');
    submitBtn.disabled = false;
  }
});

resetBtn.addEventListener('click', () => {
  resetFormFields();
  clearStatus();
});

newRouteBtn.addEventListener('click', enterNewRouteMode);
cancelNewRouteBtn.addEventListener('click', exitNewRouteMode);

routeSearch.addEventListener('focus', () => {
  if (routeMode !== 'existing') return;
  renderRouteOptions();
  routeSearch.select();
});

routeSearch.addEventListener('input', () => {
  if (routeMode !== 'existing') return;
  routeIdInput.value = '';
  clearPreviousSchedule();
  activeRouteOptionIndex = -1;
  renderRouteOptions(routeSearch.value);
});

routeSearch.addEventListener('keydown', (event) => {
  if (routeMode !== 'existing') return;
  const options = [...routeListbox.querySelectorAll('[role="option"]')];

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (routeListbox.hidden) renderRouteOptions();
    activeRouteOptionIndex = Math.min(activeRouteOptionIndex + 1, options.length - 1);
    renderRouteOptions();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeRouteOptionIndex = Math.max(activeRouteOptionIndex - 1, 0);
    renderRouteOptions();
  } else if (event.key === 'Enter') {
    if (!routeListbox.hidden && activeRouteOptionIndex >= 0 && options[activeRouteOptionIndex]) {
      event.preventDefault();
      selectExistingRoute(options[activeRouteOptionIndex].dataset.routeId);
    }
  } else if (event.key === 'Escape') {
    closeRouteListbox();
  }
});

routeSearch.addEventListener('blur', () => {
  setTimeout(() => {
    closeRouteListbox();
    if (routeMode === 'existing' && !routeIdInput.value) {
      routeSearch.value = '';
    }
  }, 120);
});

driverSearch.addEventListener('focus', () => {
  renderDriverOptions();
  driverSearch.select();
});

driverSearch.addEventListener('input', () => {
  driverIdInput.value = '';
  driverNameInput.value = '';
  activeDriverOptionIndex = -1;
  renderDriverOptions(driverSearch.value);
});

driverSearch.addEventListener('keydown', (event) => {
  const options = [...driverListbox.querySelectorAll('[role="option"]')];

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (driverListbox.hidden) renderDriverOptions();
    activeDriverOptionIndex = Math.min(activeDriverOptionIndex + 1, options.length - 1);
    renderDriverOptions();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeDriverOptionIndex = Math.max(activeDriverOptionIndex - 1, 0);
    renderDriverOptions();
  } else if (event.key === 'Enter') {
    if (
      !driverListbox.hidden &&
      activeDriverOptionIndex >= 0 &&
      options[activeDriverOptionIndex]
    ) {
      event.preventDefault();
      selectExistingDriver(options[activeDriverOptionIndex].dataset.driverId);
    }
  } else if (event.key === 'Escape') {
    closeDriverListbox();
  }
});

driverSearch.addEventListener('blur', () => {
  setTimeout(() => {
    closeDriverListbox();
    if (!driverIdInput.value) {
      driverSearch.value = '';
      driverNameInput.value = '';
    }
  }, 120);
});

segmentSelect.addEventListener('change', fillPreviousTime);
previousInput.addEventListener('input', () => {
  if (!previousLockedFromState) refreshComputedDelta();
});
newTimeInput.addEventListener('input', refreshComputedDelta);
deltaUsedInput.addEventListener('input', () => {
  deltaUsedInput.dataset.touched = '1';
  syncAdjustmentVisibility();
});

document.addEventListener('click', (event) => {
  if (!routeCombobox.contains(event.target)) {
    closeRouteListbox();
  }
  if (!driverCombobox.contains(event.target)) {
    closeDriverListbox();
  }
});

async function init() {
  effectiveDateInput.value = todayLocalDate();
  exitNewRouteMode({ focus: false });
  clearDriverSelection();
  await Promise.all([
    loadRoutes(),
    loadDrivers(),
    loadStaffNames(),
    loadReasonCategories(),
    loadAdjustmentReasons(),
    loadRecent(),
  ]);
}

init().catch((error) => {
  showStatus(error.message, 'error');
});
