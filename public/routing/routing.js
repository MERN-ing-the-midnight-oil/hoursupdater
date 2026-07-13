import { enhanceGlossaryTips } from '../shared/glossaryTip.js';

enhanceGlossaryTips();

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
const newDriverBtn = document.getElementById('new-driver-btn');
const cancelNewDriverBtn = document.getElementById('cancel-new-driver-btn');
const newDriverFields = document.getElementById('new-driver-fields');
const newDriverNameInput = document.getElementById('new_driver_name');
const newDriverEmailInput = document.getElementById('new_driver_email');

const segmentSelect = document.getElementById('segment');
const previousInput = document.getElementById('previous_time');
const newTimeInput = document.getElementById('new_time');
const computedDeltaInput = document.getElementById('computed_delta');
const deltaUsedInput = document.getElementById('delta_minutes');
const adjustmentBlock = document.getElementById('adjustment-block');
const adjustmentReason = document.getElementById('adjustment_reason');
const enteredByInput = document.getElementById('entered_by');
const effectiveDateInput = document.getElementById('effective_date');
const statusEl = document.getElementById('status');
const recentList = document.getElementById('recent-list');
const submitBtn = document.getElementById('submit-btn');
const resetBtn = document.getElementById('reset-btn');

/** @type {Map<string, { route_id: string, driver_name: string, driver_id?: string|null, segments: Record<string, string|null> }>} */
const routesById = new Map();

/** @type {Map<string, { driver_id: string, name: string, email: string|null }>} */
const driversById = new Map();

/** @type {'existing' | 'new'} */
let routeMode = 'existing';
/** @type {'existing' | 'new'} */
let driverMode = 'existing';
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

function computeDelta(previousTime, newTime) {
  const prevParts = String(previousTime).split('-');
  const nextParts = String(newTime).split('-');
  if (prevParts.length !== 2 || nextParts.length !== 2) return null;
  const prevStart = parseClock(prevParts[0]);
  const prevEnd = parseClock(prevParts[1]);
  const nextStart = parseClock(nextParts[0]);
  const nextEnd = parseClock(nextParts[1]);
  if ([prevStart, prevEnd, nextStart, nextEnd].some((v) => v == null)) return null;
  if (prevEnd <= prevStart || nextEnd <= nextStart) return null;
  return nextEnd - nextStart - (prevEnd - prevStart);
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
  if (driverMode !== 'existing') return;
  driverListbox.hidden = false;
  driverSearch.setAttribute('aria-expanded', 'true');
}

function renderRouteOptions(query = routeSearch.value) {
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
    li.textContent = `${route.route_id} — ${route.driver_name?.trim() || 'Unassigned'}`;
    li.addEventListener('mousedown', (event) => {
      event.preventDefault();
      selectExistingRoute(route.route_id);
    });
    routeListbox.appendChild(li);
  });

  openRouteListbox();
}

function renderDriverOptions(query = driverSearch.value) {
  const matches = filteredDrivers(query);
  driverListbox.innerHTML = '';

  if (!matches.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = driversById.size
      ? 'No matching drivers. Use “Add new driver” if this is someone new.'
      : 'No drivers on file yet. Use “Add new driver”.';
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

function selectExistingDriver(driverId) {
  const driver = driversById.get(driverId);
  if (!driver) return;

  driverMode = 'existing';
  driverIdInput.value = driver.driver_id;
  driverNameInput.value = driver.name;
  driverSearch.value = driver.name;
  closeDriverListbox();
}

function selectExistingRoute(routeId) {
  const route = routesById.get(routeId);
  if (!route) return;

  routeMode = 'existing';
  routeIdInput.value = route.route_id;
  const driverLabel = route.driver_name?.trim() || 'Unassigned';
  routeSearch.value = `${route.route_id} — ${driverLabel}`;
  if (route.driver_id && driversById.has(route.driver_id)) {
    selectExistingDriver(route.driver_id);
  } else if (route.driver_name) {
    const match = [...driversById.values()].find(
      (d) => d.name.toLowerCase() === route.driver_name.toLowerCase()
    );
    if (match) {
      selectExistingDriver(match.driver_id);
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
  closeRouteListbox();
  fillPreviousTime();
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
  previousInput.value = '';
  previousInput.readOnly = false;
  previousLockedFromState = false;
  previousInput.placeholder = 'Enter the current (starting) time for this segment';
  routeModeHint.textContent =
    'Creating a new route. Enter the route ID and the current segment time — there is no prior state to auto-fill.';
  closeRouteListbox();
  newRouteIdInput.focus();
}

function exitNewRouteMode() {
  routeMode = 'existing';
  routeSearch.disabled = false;
  routeCombobox.classList.remove('is-disabled');
  newRouteFields.hidden = true;
  newRouteBtn.hidden = false;
  newRouteIdInput.required = false;
  newRouteIdInput.value = '';
  routeIdInput.value = '';
  routeSearch.value = '';
  previousInput.placeholder = '6:35-8:55';
  routeModeHint.textContent =
    'Pick a known route from the list. Use “Create new route” only for a route that isn’t in the system yet.';
  closeRouteListbox();
  routeSearch.focus();
}

function enterNewDriverMode() {
  driverMode = 'new';
  driverIdInput.value = '';
  driverNameInput.value = '';
  driverSearch.value = '';
  driverSearch.disabled = true;
  driverCombobox.classList.add('is-disabled');
  newDriverFields.hidden = false;
  newDriverBtn.hidden = true;
  newDriverNameInput.value = '';
  newDriverEmailInput.value = '';
  newDriverNameInput.required = true;
  driverModeHint.textContent =
    'Adding a new driver to the directory. Email is optional now — without it, draft emails stay disabled until Admin adds one.';
  closeDriverListbox();
  newDriverNameInput.focus();
}

function exitNewDriverMode() {
  driverMode = 'existing';
  driverSearch.disabled = false;
  driverCombobox.classList.remove('is-disabled');
  newDriverFields.hidden = true;
  newDriverBtn.hidden = false;
  newDriverNameInput.required = false;
  newDriverNameInput.value = '';
  newDriverEmailInput.value = '';
  driverIdInput.value = '';
  driverNameInput.value = '';
  driverSearch.value = '';
  driverModeHint.textContent =
    'Pick a known driver from the list. Use “Add new driver” only for someone who isn’t in the directory yet.';
  closeDriverListbox();
  driverSearch.focus();
}

function resolveSelectedRouteId() {
  if (routeMode === 'new') {
    return newRouteIdInput.value.trim();
  }
  return routeIdInput.value.trim();
}

function resolveSelectedDriver() {
  if (driverMode === 'new') {
    return {
      driver_id: null,
      driver_name: newDriverNameInput.value.trim(),
      driver_email: newDriverEmailInput.value.trim() || null,
      create_new_driver: true,
    };
  }
  return {
    driver_id: driverIdInput.value.trim() || null,
    driver_name: driverNameInput.value.trim(),
    driver_email: null,
    create_new_driver: false,
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
      'No staff names configured yet. Add names under Admin → Settings before submitting.',
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
    const pendingBadge = change.pending
      ? ' <span class="badge pending">Held · under review</span>'
      : '';
    li.innerHTML = `
      <div><strong>${change.route_id}</strong> · ${change.driver_name} · ${change.segment}${pendingBadge}</div>
      <div class="meta">
        ${change.previous_time} → ${change.new_time}
        · delta ${change.delta_minutes}${adjusted}
        · status ${change.route_status ?? '—'}
      </div>
      <div class="meta">
        start ${change.effective_date}
        · entered by ${change.entered_by}
        · ${new Date(change.submitted_at).toLocaleString()}
      </div>
    `;
    recentList.appendChild(li);
  }
}

async function fillPreviousTime() {
  const routeId = resolveSelectedRouteId();
  const segment = segmentSelect.value;
  if (!routeId || routeMode === 'new') {
    previousInput.readOnly = false;
    previousLockedFromState = false;
    return;
  }

  try {
    const data = await fetchJson(
      `/api/routes/${encodeURIComponent(routeId)}/segment-time?segment=${encodeURIComponent(segment)}`
    );
    if (data.driver_id && driversById.has(data.driver_id) && driverMode === 'existing') {
      selectExistingDriver(data.driver_id);
    } else if (data.driver_name && driverMode === 'existing' && !driverIdInput.value) {
      const match = [...driversById.values()].find(
        (d) => d.name.toLowerCase() === data.driver_name.toLowerCase()
      );
      if (match) selectExistingDriver(match.driver_id);
    }
    if (data.previous_time) {
      previousInput.value = data.previous_time;
      previousInput.readOnly = true;
      previousLockedFromState = true;
    } else {
      previousInput.readOnly = false;
      previousLockedFromState = false;
      previousInput.placeholder = 'No prior time on file for this segment — enter current time';
    }
    refreshComputedDelta();
  } catch (error) {
    previousInput.readOnly = false;
    previousLockedFromState = false;
    console.warn(error);
  }
}

function payloadNoteIsValid() {
  return Boolean(document.getElementById('note').value.trim());
}

function resetFormFields(keepEnteredBy) {
  const enteredBy = keepEnteredBy ?? enteredByInput.value;
  form.reset();
  effectiveDateInput.value = todayLocalDate();
  computedDelta = null;
  computedDeltaInput.value = '';
  deltaUsedInput.dataset.touched = '';
  previousInput.readOnly = false;
  previousInput.placeholder = '6:35-8:55';
  exitNewRouteMode();
  exitNewDriverMode();
  if (enteredBy) {
    enteredByInput.value = enteredBy;
  }
  syncAdjustmentVisibility();
}

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
    if (!driver.driver_name) {
      throw new Error(
        driverMode === 'new'
          ? 'Enter the new driver’s name.'
          : 'Select a driver from the list, or use “Add new driver”.'
      );
    }
    if (driverMode === 'existing' && !driver.driver_id) {
      throw new Error('Select a driver from the directory list.');
    }

    refreshComputedDelta();
    const used = Number(deltaUsedInput.value);
    if (computedDelta == null || Number.isNaN(used)) {
      throw new Error('Enter valid previous/new times so delta can be calculated.');
    }
    if (used !== computedDelta && !adjustmentReason.value) {
      throw new Error('Select a reason for adjusting the computed delta.');
    }
    if (!payloadNoteIsValid()) {
      throw new Error('A note is required for every submission, including new routes.');
    }
    if (!enteredByInput.value) {
      throw new Error('Select your name from the staff list.');
    }

    const payload = {
      route_id: routeId,
      create_new_route: routeMode === 'new',
      create_new_driver: driver.create_new_driver,
      driver_id: driver.driver_id,
      driver_name: driver.driver_name,
      driver_email: driver.driver_email,
      segment: segmentSelect.value,
      effective_date: effectiveDateInput.value,
      previous_time: previousInput.value.trim(),
      new_time: newTimeInput.value.trim(),
      delta_minutes: used,
      adjustment_reason: adjustmentReason.value || null,
      reason_category: document.getElementById('reason_category').value,
      note: document.getElementById('note').value.trim(),
      entered_by: enteredByInput.value.trim(),
    };

    const result = await fetchJson('/api/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    localStorage.setItem('rct_entered_by', payload.entered_by);
    showStatus(result.message, result.pending ? 'warn' : 'ok');
    resetFormFields(payload.entered_by);
    await Promise.all([loadRoutes(), loadDrivers(), loadRecent()]);
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

resetBtn.addEventListener('click', () => {
  resetFormFields();
  clearStatus();
});

newRouteBtn.addEventListener('click', enterNewRouteMode);
cancelNewRouteBtn.addEventListener('click', exitNewRouteMode);
newDriverBtn.addEventListener('click', enterNewDriverMode);
cancelNewDriverBtn.addEventListener('click', exitNewDriverMode);

routeSearch.addEventListener('focus', () => {
  if (routeMode === 'existing') renderRouteOptions();
});

routeSearch.addEventListener('input', () => {
  if (routeMode !== 'existing') return;
  routeIdInput.value = '';
  activeRouteOptionIndex = -1;
  renderRouteOptions();
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
  if (driverMode === 'existing') renderDriverOptions();
});

driverSearch.addEventListener('input', () => {
  if (driverMode !== 'existing') return;
  driverIdInput.value = '';
  driverNameInput.value = '';
  activeDriverOptionIndex = -1;
  renderDriverOptions();
});

driverSearch.addEventListener('keydown', (event) => {
  if (driverMode !== 'existing') return;
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
    if (driverMode === 'existing' && !driverIdInput.value) {
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
  exitNewRouteMode();
  exitNewDriverMode();
  await Promise.all([
    loadRoutes(),
    loadDrivers(),
    loadStaffNames(),
    loadAdjustmentReasons(),
    loadRecent(),
  ]);
}

init().catch((error) => {
  showStatus(error.message, 'error');
});
