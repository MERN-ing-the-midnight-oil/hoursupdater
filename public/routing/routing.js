import { createStatusBadge, enhanceGlossaryTips } from '../shared/glossaryTip.js';
import { enhanceIcons } from '../shared/icons.js';
import { initRosterImportTip } from '../shared/rosterImportTip.js';

enhanceGlossaryTips();
enhanceIcons();
initRosterImportTip();

const changeForm = document.getElementById('change-form');
const createForm = document.getElementById('create-route-form');
const routeSearch = document.getElementById('route_search');
const routeIdInput = document.getElementById('route_id');
const routeListbox = document.getElementById('route-listbox');
const routeCombobox = document.getElementById('route-combobox');
const routeModeHint = document.getElementById('route-mode-hint');

const driverSearch = document.getElementById('driver_search');
const driverIdInput = document.getElementById('driver_id');
const driverNameInput = document.getElementById('driver_name');
const driverListbox = document.getElementById('driver-listbox');
const driverCombobox = document.getElementById('driver-combobox');
const segmentSelect = document.getElementById('segment');
const previousInput = document.getElementById('previous_time');
const newTimeInput = document.getElementById('new_time');
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

const createEnteredByInput = document.getElementById('create_entered_by');
const createRouteIdInput = document.getElementById('create_route_id');
const createDriverSearch = document.getElementById('create_driver_search');
const createDriverIdInput = document.getElementById('create_driver_id');
const createDriverNameInput = document.getElementById('create_driver_name');
const createDriverListbox = document.getElementById('create-driver-listbox');
const createDriverCombobox = document.getElementById('create-driver-combobox');
const createEffectiveDateInput = document.getElementById('create_effective_date');
const createReasonCategoryInput = document.getElementById('create_reason_category');
const createScheduleAm = document.getElementById('create_schedule_am');
const createScheduleMidday = document.getElementById('create_schedule_midday');
const createSchedulePm = document.getElementById('create_schedule_pm');
const createNoteInput = document.getElementById('create_note');
const createStatusEl = document.getElementById('create-status');
const createSubmitBtn = document.getElementById('create-submit-btn');
const createResetBtn = document.getElementById('create-reset-btn');

const tabButtons = [...document.querySelectorAll('.routing-tab')];
const tabPanels = [...document.querySelectorAll('[data-tab-panel]')];

const SCHEDULE_FORMAT_PLACEHOLDER = 'H:MM-H:MM (e.g. 6:35-8:55)';
const ROUTE_HINT_HTML =
  'Pick a known route from the list. To add a route that isn’t in the system yet, use the <a href="#create-route" class="js-goto-create-route">Create new route</a> tab.';

/** @type {Map<string, { route_id: string, driver_name: string, driver_id?: string|null, segments: Record<string, string|null> }>} */
const routesById = new Map();

/** @type {Map<string, { driver_id: string, name: string, email: string|null }>} */
const driversById = new Map();

let computedDelta = null;
let previousLockedFromState = false;
let activeRouteOptionIndex = -1;
let activeDriverOptionIndex = -1;
let activeCreateDriverOptionIndex = -1;

function todayLocalDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
}

function showStatus(el, message, kind = 'ok') {
  el.textContent = message;
  el.className = `status visible ${kind}`;
}

function clearStatus(el) {
  el.textContent = '';
  el.className = 'status';
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

function getDriverFilterQuery(searchInput, idInput) {
  if (idInput.value) {
    const driver = driversById.get(idInput.value);
    if (driver && searchInput.value === driver.name) {
      return '';
    }
  }
  return searchInput.value;
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

function closeCreateDriverListbox() {
  createDriverListbox.hidden = true;
  createDriverSearch.setAttribute('aria-expanded', 'false');
  activeCreateDriverOptionIndex = -1;
}

function openCreateDriverListbox() {
  createDriverListbox.hidden = false;
  createDriverSearch.setAttribute('aria-expanded', 'true');
}

function renderRouteOptions(query = getRouteFilterQuery()) {
  const matches = filteredRoutes(query);
  routeListbox.innerHTML = '';

  if (!matches.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.innerHTML = routesById.size
      ? 'No matching routes. Use the <a href="#create-route" class="js-goto-create-route">Create new route</a> tab if this is brand new.'
      : 'No routes on file yet. Use the <a href="#create-route" class="js-goto-create-route">Create new route</a> tab.';
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

/**
 * @param {HTMLUListElement} listbox
 * @param {() => void} openFn
 * @param {(driverId: string) => void} onSelect
 * @param {number} activeIndex
 * @param {string} idPrefix
 * @param {string} query
 */
function renderDriverOptionsInto(listbox, openFn, onSelect, activeIndex, idPrefix, query) {
  const matches = filteredDrivers(query);
  listbox.innerHTML = '';

  if (!matches.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = driversById.size
      ? 'No matching drivers. Add someone new under Drivers/Routes.'
      : 'No drivers on file yet. Add them under Drivers/Routes.';
    listbox.appendChild(empty);
    openFn();
    return;
  }

  matches.forEach((driver, index) => {
    const li = document.createElement('li');
    li.id = `${idPrefix}-${index}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
    li.dataset.driverId = driver.driver_id;
    li.textContent = driver.email
      ? `${driver.name} · ${driver.email}`
      : `${driver.name} · no email`;
    li.addEventListener('mousedown', (event) => {
      event.preventDefault();
      onSelect(driver.driver_id);
    });
    listbox.appendChild(li);
  });

  openFn();
}

function renderChangeDriverOptions(query = getDriverFilterQuery(driverSearch, driverIdInput)) {
  renderDriverOptionsInto(
    driverListbox,
    openDriverListbox,
    (driverId) => selectExistingDriver(driverId),
    activeDriverOptionIndex,
    'driver-option',
    query
  );
}

function renderCreateDriverOptions(
  query = getDriverFilterQuery(createDriverSearch, createDriverIdInput)
) {
  renderDriverOptionsInto(
    createDriverListbox,
    openCreateDriverListbox,
    (driverId) => selectCreateDriver(driverId),
    activeCreateDriverOptionIndex,
    'create-driver-option',
    query
  );
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

  if (syncRoute) {
    const match = findRouteForDriver(driver);
    if (match) {
      selectExistingRoute(match.route_id, { syncDriver: false });
    }
  }
}

function selectCreateDriver(driverId) {
  const driver = driversById.get(driverId);
  if (!driver) return;
  createDriverIdInput.value = driver.driver_id;
  createDriverNameInput.value = driver.name;
  createDriverSearch.value = driver.name;
  closeCreateDriverListbox();
}

/**
 * @param {string} routeId
 * @param {{ syncDriver?: boolean }} [options]
 */
function selectExistingRoute(routeId, options = {}) {
  const { syncDriver = true } = options;
  const route = routesById.get(routeId);
  if (!route) return;

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

function clearDriverSelection() {
  driverIdInput.value = '';
  driverNameInput.value = '';
  driverSearch.value = '';
  closeDriverListbox();
}

function clearCreateDriverSelection() {
  createDriverIdInput.value = '';
  createDriverNameInput.value = '';
  createDriverSearch.value = '';
  closeCreateDriverListbox();
}

function resolveSelectedRouteId() {
  return routeIdInput.value.trim();
}

function resolveSelectedDriver() {
  return {
    driver_id: driverIdInput.value.trim() || null,
    driver_name: driverNameInput.value.trim(),
  };
}

function resolveCreateDriver() {
  return {
    driver_id: createDriverIdInput.value.trim() || null,
    driver_name: createDriverNameInput.value.trim(),
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

/**
 * @param {HTMLSelectElement} select
 * @param {string} [prefer]
 */
async function fillStaffNames(select, prefer = '') {
  const names = await fetchJson('/api/staff-names');
  const previous = prefer || select.value || localStorage.getItem('rct_entered_by') || '';
  select.innerHTML = '<option value="">Select your name…</option>';
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
  if (previous && names.includes(previous)) {
    select.value = previous;
  }
  return names;
}

async function loadStaffNames() {
  const names = await Promise.all([
    fillStaffNames(enteredByInput),
    fillStaffNames(createEnteredByInput),
  ]);
  if (!names[0].length) {
    showStatus(
      statusEl,
      'No staff names configured yet. Use “Don\'t see your name?” below to add names in Admin Settings.',
      'warn'
    );
    showStatus(
      createStatusEl,
      'No staff names configured yet. Add names in Admin Settings before creating a route.',
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

/**
 * @param {HTMLSelectElement} select
 */
async function fillReasonCategories(select) {
  const categories = await fetchJson('/api/reason-categories');
  const previous = select.value;
  select.innerHTML = '<option value="">Select a category…</option>';
  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    select.appendChild(option);
  }
  if (previous && categories.includes(previous)) {
    select.value = previous;
  }
}

async function loadReasonCategories() {
  await Promise.all([
    fillReasonCategories(reasonCategoryInput),
    fillReasonCategories(createReasonCategoryInput),
  ]);
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
    top.innerHTML = `<strong>${change.route_id}</strong> · ${change.driver_name || 'Unassigned'} · ${change.segment}`;
    if (change.pending) {
      const pendingBadge = document.createElement('span');
      pendingBadge.className = 'badge pending';
      pendingBadge.textContent = 'Held · under review';
      top.append(document.createTextNode(' '), pendingBadge);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const isSeed =
      change.previous_time === change.new_time && change.delta_minutes === 0;
    meta.append(
      document.createTextNode(
        isSeed
          ? `schedule ${change.new_time} · seeded · status `
          : `${change.previous_time} → ${change.new_time} · time difference ${change.delta_minutes}${adjusted} · status `
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
  previousInput.placeholder = options.placeholder || SCHEDULE_FORMAT_PLACEHOLDER;
  refreshComputedDelta();
}

/**
 * @param {{ placeholder?: string }} [options]
 */
function clearPreviousSchedule(options = {}) {
  applyPreviousSchedule({
    value: '',
    locked: false,
    placeholder: options.placeholder || SCHEDULE_FORMAT_PLACEHOLDER,
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
  if (!routeId) {
    clearPreviousSchedule();
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

function resetChangeForm(keepEnteredBy) {
  const enteredBy = keepEnteredBy ?? enteredByInput.value;
  changeForm.reset();
  effectiveDateInput.value = todayLocalDate();
  computedDelta = null;
  computedDeltaInput.value = '';
  deltaUsedInput.dataset.touched = '';
  clearPreviousSchedule();
  clearDriverSelection();
  routeIdInput.value = '';
  if (enteredBy) {
    enteredByInput.value = enteredBy;
  }
  syncAdjustmentVisibility();
}

function resetCreateForm(keepEnteredBy) {
  const enteredBy = keepEnteredBy ?? createEnteredByInput.value;
  createForm.reset();
  createEffectiveDateInput.value = todayLocalDate();
  clearCreateDriverSelection();
  if (enteredBy) {
    createEnteredByInput.value = enteredBy;
  }
}

/** @param {'log-change' | 'create-route'} tab */
function setActiveTab(tab) {
  const next = tab === 'create-route' ? 'create-route' : 'log-change';
  for (const button of tabButtons) {
    const active = button.dataset.tab === next;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  for (const panel of tabPanels) {
    panel.hidden = panel.dataset.tabPanel !== next;
  }
  const hash = next === 'create-route' ? '#create-route' : '#log-change';
  if (window.location.hash !== hash) {
    history.replaceState(null, '', hash);
  }
  if (next === 'create-route') {
    createRouteIdInput.focus();
  }
}

function tabFromHash() {
  return window.location.hash === '#create-route' ? 'create-route' : 'log-change';
}

function bindComboboxKeyboard(searchInput, listbox, getActiveIndex, setActiveIndex, render, onEnterSelect) {
  searchInput.addEventListener('keydown', (event) => {
    const options = [...listbox.querySelectorAll('[role="option"]')];
    let activeIndex = getActiveIndex();

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (listbox.hidden) render();
      activeIndex = Math.min(activeIndex + 1, options.length - 1);
      setActiveIndex(activeIndex);
      render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      setActiveIndex(activeIndex);
      render();
    } else if (event.key === 'Enter') {
      if (!listbox.hidden && activeIndex >= 0 && options[activeIndex]) {
        event.preventDefault();
        onEnterSelect(options[activeIndex]);
      }
    } else if (event.key === 'Escape') {
      listbox.hidden = true;
      searchInput.setAttribute('aria-expanded', 'false');
      setActiveIndex(-1);
    }
  });
}

function preventEnterSubmit(form) {
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !form.contains(target)) return;
    if (target instanceof HTMLTextAreaElement) return;
    if (target instanceof HTMLButtonElement) return;
    event.preventDefault();
  });
}

preventEnterSubmit(changeForm);
preventEnterSubmit(createForm);

changeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearStatus(statusEl);
  submitBtn.disabled = true;

  try {
    const routeId = resolveSelectedRouteId();
    if (!routeId) {
      throw new Error('Select an existing route from the list.');
    }

    if (!routesById.has(routeId)) {
      throw new Error(
        'That route isn’t in the current route list. Select one from the dropdown, or use the Create new route tab.'
      );
    }

    const driver = resolveSelectedDriver();
    if (!driver.driver_id || !driver.driver_name) {
      throw new Error(
        'Select a driver from the directory. Add someone new under Drivers/Routes.'
      );
    }

    const previousTime = previousInput.value.trim();
    const newTime = newTimeInput.value.trim();
    refreshComputedDelta();
    const used = Number(deltaUsedInput.value);
    if (computedDelta == null || Number.isNaN(used)) {
      throw new Error(
        'Enter valid current/new schedules as H:MM-H:MM so the time difference can be calculated.'
      );
    }
    if (used !== computedDelta && !adjustmentReason.value) {
      throw new Error('Select a reason for adjusting Time Difference To Accumulate.');
    }

    if (!reasonCategoryInput.value) {
      throw new Error('Select a reason category.');
    }

    if (!enteredByInput.value) {
      throw new Error('Select your name from the staff list.');
    }

    const payload = {
      route_id: routeId,
      create_new_route: false,
      create_new_driver: false,
      driver_id: driver.driver_id,
      driver_name: driver.driver_name,
      segment: segmentSelect.value,
      effective_date: effectiveDateInput.value,
      previous_time: previousTime,
      new_time: newTime,
      delta_minutes: used,
      adjustment_reason: adjustmentReason.value || null,
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
    showStatus(statusEl, result.message, statusKind);

    const driverId = result.change?.driver_id || payload.driver_id;
    if (driverId) {
      sessionStorage.setItem(
        'rct_flash',
        JSON.stringify({ message: result.message, kind: statusKind })
      );
      window.setTimeout(() => {
        window.location.assign(
          `/admin/drivers/${encodeURIComponent(driverId)}#change-history`
        );
      }, 1200);
      return;
    }

    resetChangeForm(payload.entered_by);
    await Promise.all([loadRoutes(), loadDrivers(), loadRecent()]);
    submitBtn.disabled = false;
  } catch (error) {
    showStatus(statusEl, error.message, 'error');
    submitBtn.disabled = false;
  }
});

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearStatus(createStatusEl);
  createSubmitBtn.disabled = true;

  try {
    if (!createEnteredByInput.value) {
      throw new Error('Select your name from the staff list (Entered by).');
    }

    const routeId = createRouteIdInput.value.trim();
    if (!routeId) {
      throw new Error('Enter a new route ID.');
    }
    if (routesById.has(routeId)) {
      throw new Error(
        `Route “${routeId}” already exists. Switch to Log a time change and select it from the list.`
      );
    }

    if (!createReasonCategoryInput.value) {
      throw new Error('Select a reason category.');
    }

    if (!createEffectiveDateInput.value) {
      throw new Error('Choose a start date.');
    }

    const segments = {
      AM: createScheduleAm.value.trim(),
      MIDDAY: createScheduleMidday.value.trim(),
      PM: createSchedulePm.value.trim(),
    };

    const filled = Object.entries(segments).filter(([, time]) => time);
    if (!filled.length) {
      throw new Error(
        'Enter at least one segment schedule as H:MM-H:MM (e.g. 6:35-8:55).'
      );
    }
    for (const [seg, time] of filled) {
      if (parseScheduleRange(time) == null) {
        throw new Error(
          `${seg === 'MIDDAY' ? 'Midday' : seg} schedule must be H:MM-H:MM (e.g. 6:35-8:55).`
        );
      }
    }

    const driver = resolveCreateDriver();
    if (createDriverSearch.value.trim() && !driver.driver_id) {
      throw new Error(
        'Pick a driver from the list, or clear the driver field to leave the route Unassigned.'
      );
    }

    const payload = {
      route_id: routeId,
      create_new_route: true,
      create_new_driver: false,
      driver_id: driver.driver_id,
      driver_name: driver.driver_name,
      effective_date: createEffectiveDateInput.value,
      segments: {
        AM: segments.AM || null,
        MIDDAY: segments.MIDDAY || null,
        PM: segments.PM || null,
      },
      reason_category: createReasonCategoryInput.value,
      note: createNoteInput.value.trim(),
      entered_by: createEnteredByInput.value.trim(),
    };

    const result = await fetchJson('/api/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    localStorage.setItem('rct_entered_by', payload.entered_by);
    createEnteredByInput.value = payload.entered_by;
    enteredByInput.value = payload.entered_by;
    showStatus(createStatusEl, result.message, 'ok');

    const driverId = result.change?.driver_id || payload.driver_id;
    if (driverId) {
      sessionStorage.setItem(
        'rct_flash',
        JSON.stringify({ message: result.message, kind: 'ok' })
      );
      window.setTimeout(() => {
        window.location.assign(
          `/admin/drivers/${encodeURIComponent(driverId)}#change-history`
        );
      }, 1200);
      return;
    }

    resetCreateForm(payload.entered_by);
    await Promise.all([loadRoutes(), loadDrivers(), loadRecent()]);
    createSubmitBtn.disabled = false;
  } catch (error) {
    showStatus(createStatusEl, error.message, 'error');
    createSubmitBtn.disabled = false;
  }
});

resetBtn.addEventListener('click', () => {
  resetChangeForm();
  clearStatus(statusEl);
});

createResetBtn.addEventListener('click', () => {
  resetCreateForm();
  clearStatus(createStatusEl);
});

for (const button of tabButtons) {
  button.addEventListener('click', () => {
    setActiveTab(/** @type {'log-change' | 'create-route'} */ (button.dataset.tab));
  });
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest('.js-goto-create-route');
  if (link) {
    event.preventDefault();
    setActiveTab('create-route');
  }
});

window.addEventListener('hashchange', () => {
  setActiveTab(tabFromHash());
});

routeSearch.addEventListener('focus', () => {
  renderRouteOptions();
  routeSearch.select();
});

routeSearch.addEventListener('input', () => {
  routeIdInput.value = '';
  clearPreviousSchedule();
  activeRouteOptionIndex = -1;
  renderRouteOptions(routeSearch.value);
});

bindComboboxKeyboard(
  routeSearch,
  routeListbox,
  () => activeRouteOptionIndex,
  (value) => {
    activeRouteOptionIndex = value;
  },
  () => renderRouteOptions(),
  (option) => selectExistingRoute(option.dataset.routeId)
);

routeSearch.addEventListener('blur', () => {
  setTimeout(() => {
    closeRouteListbox();
    if (!routeIdInput.value) {
      routeSearch.value = '';
    }
  }, 120);
});

driverSearch.addEventListener('focus', () => {
  renderChangeDriverOptions();
  driverSearch.select();
});

driverSearch.addEventListener('input', () => {
  driverIdInput.value = '';
  driverNameInput.value = '';
  activeDriverOptionIndex = -1;
  renderChangeDriverOptions(driverSearch.value);
});

bindComboboxKeyboard(
  driverSearch,
  driverListbox,
  () => activeDriverOptionIndex,
  (value) => {
    activeDriverOptionIndex = value;
  },
  () => renderChangeDriverOptions(),
  (option) => selectExistingDriver(option.dataset.driverId)
);

driverSearch.addEventListener('blur', () => {
  setTimeout(() => {
    closeDriverListbox();
    if (!driverIdInput.value) {
      driverSearch.value = '';
      driverNameInput.value = '';
    }
  }, 120);
});

createDriverSearch.addEventListener('focus', () => {
  renderCreateDriverOptions();
  createDriverSearch.select();
});

createDriverSearch.addEventListener('input', () => {
  createDriverIdInput.value = '';
  createDriverNameInput.value = '';
  activeCreateDriverOptionIndex = -1;
  renderCreateDriverOptions(createDriverSearch.value);
});

bindComboboxKeyboard(
  createDriverSearch,
  createDriverListbox,
  () => activeCreateDriverOptionIndex,
  (value) => {
    activeCreateDriverOptionIndex = value;
  },
  () => renderCreateDriverOptions(),
  (option) => selectCreateDriver(option.dataset.driverId)
);

createDriverSearch.addEventListener('blur', () => {
  setTimeout(() => {
    closeCreateDriverListbox();
    if (!createDriverIdInput.value) {
      createDriverSearch.value = '';
      createDriverNameInput.value = '';
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
  if (!createDriverCombobox.contains(event.target)) {
    closeCreateDriverListbox();
  }
});

async function init() {
  effectiveDateInput.value = todayLocalDate();
  createEffectiveDateInput.value = todayLocalDate();
  clearDriverSelection();
  clearCreateDriverSelection();
  if (routeModeHint) {
    routeModeHint.innerHTML = ROUTE_HINT_HTML;
  }
  setActiveTab(tabFromHash());
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
  showStatus(statusEl, error.message, 'error');
  showStatus(createStatusEl, error.message, 'error');
});
