import { appendCitationLinks } from '../shared/contractCitationUi.js';
import { enhanceGlossaryTips } from '../shared/glossaryTip.js';
import { enhanceIcons, setLabeledIcon } from '../shared/icons.js';

enhanceGlossaryTips();
enhanceIcons();

const contractNoteEl = document.getElementById('seniority-tie-contract-note');
if (contractNoteEl) {
  contractNoteEl.appendChild(document.createTextNode(' '));
  appendCitationLinks(contractNoteEl, ['3.01']);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function showStatus(el, message, kind = 'ok') {
  el.textContent = message;
  el.className = `status visible ${kind}`;
}

const statusEl = document.getElementById('drivers-status');
const hireReminderEl = document.getElementById('hire-date-reminder');
const tieReminderEl = document.getElementById('seniority-tie-reminder');
const tieResolveEl = document.getElementById('seniority-tie-resolve');
const tieGroupsEl = document.getElementById('seniority-tie-groups');
const tieResolvedByEl = document.getElementById('seniority-tie-resolved-by');
const tieNoteEl = document.getElementById('seniority-tie-note');
const tieStatusEl = document.getElementById('seniority-tie-status');
const tieCancelBtn = document.getElementById('seniority-tie-cancel');
const listEl = document.getElementById('driver-list');
const searchEl = document.getElementById('driver-search');
const sortEl = document.getElementById('driver-sort');
const paginationEl = document.getElementById('driver-pagination');

const addDriverForm = document.getElementById('add-driver-form');
const addDriverFirstNameEl = document.getElementById('add-driver-first-name');
const addDriverLastNameEl = document.getElementById('add-driver-last-name');
const addDriverHireDateEl = document.getElementById('add-driver-hire-date');
const addDriverEmailEl = document.getElementById('add-driver-email');
const addDriverStatusEl = document.getElementById('add-driver-status');

const d2rForm = document.getElementById('driver-to-route-form');
const d2rDriverEl = document.getElementById('d2r-driver');
const d2rRouteEl = document.getElementById('d2r-route');
const d2rByEl = document.getElementById('d2r-by');
const d2rNoteEl = document.getElementById('d2r-note');
const d2rPreviewEl = document.getElementById('d2r-preview');
const d2rConfirmEl = document.getElementById('d2r-confirm');
const d2rAckEl = document.getElementById('d2r-ack');
const d2rSubmitEl = document.getElementById('d2r-submit');
const d2rStatusEl = document.getElementById('d2r-status');

const r2dForm = document.getElementById('route-to-driver-form');
const r2dRouteEl = document.getElementById('r2d-route');
const r2dDriverEl = document.getElementById('r2d-driver');
const r2dByEl = document.getElementById('r2d-by');
const r2dNoteEl = document.getElementById('r2d-note');
const r2dPreviewEl = document.getElementById('r2d-preview');
const r2dConfirmEl = document.getElementById('r2d-confirm');
const r2dAckEl = document.getElementById('r2d-ack');
const r2dSubmitEl = document.getElementById('r2d-submit');
const r2dStatusEl = document.getElementById('r2d-status');

const assignmentTools = [
  document.getElementById('tool-driver-to-route'),
  document.getElementById('tool-route-to-driver'),
].filter(Boolean);

const SORT_STORAGE_KEY = 'rct_driver_sort';
const SORT_OPTIONS = new Set(['first_name', 'last_name', 'route']);
const UNASSIGNED_VALUE = '__unassigned__';
/** Drivers shown per directory page — fits a typical screen without scrolling past the fold. */
const PAGE_SIZE = 20;

/** @type {number} */
let directoryPage = 1;

/** @type {Array<{ driver_id: string, name: string, email: string | null, hire_date?: string | null, tie_break?: number | null }>} */
let drivers = [];

/** @type {Array<{ route_id: string, driver_id?: string | null, driver_name?: string | null }>} */
let allRoutes = [];

/** @type {string[]} */
let staffNames = [];

/** @type {Map<string, string[]>} driver_id → sorted route ids */
const routesByDriverId = new Map();

/** @type {{ hire_date: string, drivers: { driver_id: string, name: string, email: string | null, hire_date: string, tie_break: number | null }[] }[]} */
let unresolvedTies = [];

/**
 * Local ordered lists for each hire_date being resolved (most senior first).
 * @type {Map<string, string[]>}
 */
const orderByHireDate = new Map();

/**
 * @param {string} name
 * @returns {{ first: string, last: string }}
 */
function splitDriverName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts[0], last: parts[parts.length - 1] };
}

/**
 * @param {string} a
 * @param {string} b
 */
function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}

/**
 * @param {string} driverId
 * @returns {string[]}
 */
function routesForDriver(driverId) {
  return routesByDriverId.get(driverId) ?? [];
}

/**
 * @param {string} routeId
 */
function findRoute(routeId) {
  return allRoutes.find((r) => r.route_id === routeId) ?? null;
}

/**
 * @param {string} driverId
 */
function findDriver(driverId) {
  return drivers.find((d) => d.driver_id === driverId) ?? null;
}

/**
 * @param {{ driver_id?: string | null, driver_name?: string | null }} route
 */
function currentHolderLabel(route) {
  const name = route.driver_name?.trim();
  if (name) return name;
  if (route.driver_id) {
    return findDriver(route.driver_id)?.name || route.driver_id;
  }
  return 'Unassigned';
}

/**
 * @param {typeof drivers} rows
 * @param {string} sortBy
 */
function sortDrivers(rows, sortBy) {
  const keyed = rows.map((driver, index) => {
    const { first, last } = splitDriverName(driver.name);
    const routes = routesForDriver(driver.driver_id);
    return {
      driver,
      index,
      first,
      last,
      routeKey: routes[0] || '',
      hasRoute: routes.length > 0,
    };
  });

  keyed.sort((a, b) => {
    if (sortBy === 'last_name') {
      const byLast = compareText(a.last, b.last);
      if (byLast !== 0) return byLast;
      const byFirst = compareText(a.first, b.first);
      if (byFirst !== 0) return byFirst;
    } else if (sortBy === 'route') {
      if (a.hasRoute !== b.hasRoute) return a.hasRoute ? -1 : 1;
      const byRoute = compareText(a.routeKey, b.routeKey);
      if (byRoute !== 0) return byRoute;
      const byLast = compareText(a.last, b.last);
      if (byLast !== 0) return byLast;
    } else {
      // first_name (default)
      const byFirst = compareText(a.first, b.first);
      if (byFirst !== 0) return byFirst;
      const byLast = compareText(a.last, b.last);
      if (byLast !== 0) return byLast;
    }
    return a.index - b.index;
  });

  return keyed.map((row) => row.driver);
}

/**
 * @param {Array<{ driver_id: string, name: string, email: string | null, hire_date?: string | null }>} rows
 */
function renderDrivers(rows) {
  listEl.innerHTML = '';
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = drivers.length
      ? 'No drivers match that search.'
      : 'No drivers in the directory yet.';
    listEl.appendChild(empty);
    return;
  }

  for (const driver of rows) {
    const li = document.createElement('li');
    li.className = 'driver-row';
    const routes = routesForDriver(driver.driver_id);
    const routeLabel = routes.length ? routes.join(', ') : 'No route';
    const href = `/admin/drivers/${encodeURIComponent(driver.driver_id)}`;
    li.innerHTML = `
      <a class="driver-name" href="${href}">${driver.name}</a>
      <span class="meta-route">${routeLabel}</span>
    `;
    listEl.appendChild(li);
  }
}

/**
 * @param {number} total
 * @param {number} totalPages
 */
function renderPagination(total, totalPages) {
  if (!paginationEl) return;
  paginationEl.innerHTML = '';
  if (total === 0 || totalPages <= 1) {
    paginationEl.hidden = true;
    return;
  }

  paginationEl.hidden = false;
  const start = (directoryPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(directoryPage * PAGE_SIZE, total);

  const summary = document.createElement('p');
  summary.className = 'drivers-pagination-summary';
  summary.textContent = `Showing ${start}–${end} of ${total}`;

  const controls = document.createElement('div');
  controls.className = 'drivers-pagination-controls';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'secondary';
  prev.disabled = directoryPage <= 1;
  setLabeledIcon(prev, 'arrow-left', 'Previous');
  prev.addEventListener('click', () => {
    if (directoryPage <= 1) return;
    directoryPage -= 1;
    applyFilter();
  });

  const pageLabel = document.createElement('span');
  pageLabel.className = 'drivers-pagination-page';
  pageLabel.textContent = `Page ${directoryPage} of ${totalPages}`;

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'secondary';
  next.disabled = directoryPage >= totalPages;
  setLabeledIcon(next, 'arrow-right', 'Next');
  next.addEventListener('click', () => {
    if (directoryPage >= totalPages) return;
    directoryPage += 1;
    applyFilter();
  });

  controls.append(prev, pageLabel, next);
  paginationEl.append(summary, controls);
}

function updateHireDateReminder() {
  const missing = drivers.filter((d) => !d.hire_date);
  if (!missing.length) {
    hireReminderEl.hidden = true;
    hireReminderEl.textContent = '';
    return;
  }
  hireReminderEl.hidden = false;
  hireReminderEl.className = 'status visible warn';
  hireReminderEl.textContent =
    `${missing.length} driver${missing.length === 1 ? '' : 's'} missing hire date — ` +
    'backfill before seniority/bid notification depends on these ranks. Open each driver detail to sanity-check once filled.';
}

function updateSeniorityTieReminder() {
  if (!unresolvedTies.length) {
    tieReminderEl.hidden = true;
    tieReminderEl.textContent = '';
    return;
  }

  const driverCount = unresolvedTies.reduce(
    (sum, tie) => sum + tie.drivers.length,
    0
  );
  tieReminderEl.hidden = false;
  tieReminderEl.className = 'status visible warn';
  tieReminderEl.innerHTML = '';
  const text = document.createElement('span');
  text.textContent =
    `${unresolvedTies.length} seniority tie` +
    `${unresolvedTies.length === 1 ? '' : 's'} need resolving ` +
    `(${driverCount} driver${driverCount === 1 ? '' : 's'} sharing a hire date) — ` +
    'record office lots order (Art. 3.01). ';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'secondary';
  btn.textContent = 'Resolve ties';
  btn.addEventListener('click', () => {
    openTieResolvePanel();
  });
  tieReminderEl.append(text, btn);
}

function currentSort() {
  const value = sortEl?.value || 'first_name';
  return SORT_OPTIONS.has(value) ? value : 'first_name';
}

/**
 * @param {{ resetPage?: boolean }} [options]
 */
function applyFilter(options = {}) {
  if (options.resetPage) directoryPage = 1;
  const q = searchEl.value.trim().toLowerCase();
  const filtered = !q
    ? [...drivers]
    : drivers.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          (d.email && d.email.toLowerCase().includes(q)) ||
          d.driver_id.toLowerCase().includes(q) ||
          routesForDriver(d.driver_id).some((routeId) =>
            routeId.toLowerCase().includes(q)
          )
      );
  const sorted = sortDrivers(filtered, currentSort());
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  if (directoryPage > totalPages) directoryPage = totalPages;
  if (directoryPage < 1) directoryPage = 1;
  const start = (directoryPage - 1) * PAGE_SIZE;
  renderDrivers(sorted.slice(start, start + PAGE_SIZE));
  renderPagination(sorted.length, totalPages);
}

/**
 * @param {Array<{ route_id: string, driver_id?: string | null }>} routes
 */
function indexRoutesByDriver(routes) {
  routesByDriverId.clear();
  for (const route of routes) {
    const driverId = route.driver_id;
    if (!driverId) continue;
    const list = routesByDriverId.get(driverId) ?? [];
    list.push(route.route_id);
    routesByDriverId.set(driverId, list);
  }
  for (const [driverId, list] of routesByDriverId) {
    list.sort(compareText);
    routesByDriverId.set(driverId, list);
  }
}

function restoreSortPreference() {
  if (!sortEl) return;
  const saved = localStorage.getItem(SORT_STORAGE_KEY);
  if (saved && SORT_OPTIONS.has(saved)) {
    sortEl.value = saved;
  }
}

/**
 * @param {HTMLSelectElement} select
 * @param {string} placeholder
 * @param {string} [preserve]
 */
function fillStaffSelect(select, placeholder, preserve) {
  const previous = preserve ?? select.value;
  select.innerHTML = `<option value="">${placeholder}</option>`;
  for (const name of staffNames) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
  if (previous && staffNames.includes(previous)) {
    select.value = previous;
  }
}

/**
 * @param {HTMLSelectElement} select
 * @param {{ includeUnassigned?: boolean, preserve?: string }} [options]
 */
function fillDriverSelect(select, options = {}) {
  const { includeUnassigned = false, preserve = select.value } = options;
  select.innerHTML = `<option value="">Select…</option>`;
  if (includeUnassigned) {
    const unassigned = document.createElement('option');
    unassigned.value = UNASSIGNED_VALUE;
    unassigned.textContent = 'Unassigned';
    select.appendChild(unassigned);
  }
  const sorted = [...drivers].sort((a, b) => compareText(a.name, b.name));
  for (const driver of sorted) {
    const option = document.createElement('option');
    option.value = driver.driver_id;
    const routes = routesForDriver(driver.driver_id);
    option.textContent = routes.length
      ? `${driver.name} · ${routes.join(', ')}`
      : `${driver.name} · no route`;
    select.appendChild(option);
  }
  if (
    preserve &&
    [...select.options].some((opt) => opt.value === preserve)
  ) {
    select.value = preserve;
  }
}

/**
 * @param {HTMLSelectElement} select
 * @param {string} [preserve]
 */
function fillRouteSelect(select, preserve = select.value) {
  select.innerHTML = `<option value="">Select a route…</option>`;
  const sorted = [...allRoutes].sort((a, b) =>
    compareText(a.route_id, b.route_id)
  );
  for (const route of sorted) {
    const option = document.createElement('option');
    option.value = route.route_id;
    option.textContent = `${route.route_id} · ${currentHolderLabel(route)}`;
    select.appendChild(option);
  }
  if (
    preserve &&
    [...select.options].some((opt) => opt.value === preserve)
  ) {
    select.value = preserve;
  }
}

function refreshToolSelects() {
  fillDriverSelect(d2rDriverEl);
  fillRouteSelect(d2rRouteEl);
  fillRouteSelect(r2dRouteEl);
  fillDriverSelect(r2dDriverEl, { includeUnassigned: true });
  const remembered = localStorage.getItem('rct_entered_by') || '';
  fillStaffSelect(d2rByEl, 'Select your name…', remembered);
  fillStaffSelect(r2dByEl, 'Select your name…', remembered);
  updateDriverToRouteGate();
  updateRouteToDriverGate();
}

function updateDriverToRouteGate() {
  const driverId = d2rDriverEl.value;
  const routeId = d2rRouteEl.value;
  const driver = driverId ? findDriver(driverId) : null;
  const route = routeId ? findRoute(routeId) : null;

  if (!driver || !route) {
    d2rPreviewEl.hidden = true;
    d2rPreviewEl.textContent = '';
    d2rSubmitEl.disabled = true;
    return;
  }

  const current = currentHolderLabel(route);
  const alreadyHolds =
    route.driver_id === driver.driver_id ||
    (route.driver_name || '').toLowerCase() === driver.name.toLowerCase();

  d2rPreviewEl.hidden = false;
  d2rPreviewEl.className = alreadyHolds
    ? 'assignment-preview warn'
    : 'assignment-preview';
  d2rPreviewEl.innerHTML = alreadyHolds
    ? `<strong>${driver.name}</strong> already holds <strong>${route.route_id}</strong>.`
    : `<strong>${driver.name}</strong> will take <strong>${route.route_id}</strong>, replacing <strong>${current}</strong>.` +
      `<br><span class="meta">Type <code>${route.route_id}</code> below to unlock Confirm.</span>`;

  const confirmOk = d2rConfirmEl.value.trim() === route.route_id;
  const ready =
    !alreadyHolds &&
    Boolean(d2rByEl.value.trim()) &&
    Boolean(d2rNoteEl.value.trim()) &&
    confirmOk &&
    d2rAckEl.checked;
  d2rSubmitEl.disabled = !ready;
}

function r2dConfirmPhrase(routeId, driverLabel) {
  return `${routeId} → ${driverLabel}`;
}

function updateRouteToDriverGate() {
  const routeId = r2dRouteEl.value;
  const driverValue = r2dDriverEl.value;
  const route = routeId ? findRoute(routeId) : null;
  const unassigned = driverValue === UNASSIGNED_VALUE;
  const driver = !unassigned && driverValue ? findDriver(driverValue) : null;
  const nextLabel = unassigned ? 'Unassigned' : driver?.name || '';

  if (!route || (!unassigned && !driver)) {
    r2dPreviewEl.hidden = true;
    r2dPreviewEl.textContent = '';
    r2dSubmitEl.disabled = true;
    return;
  }

  const current = currentHolderLabel(route);
  const sameAssignment =
    (unassigned && !route.driver_id && !route.driver_name?.trim()) ||
    (!unassigned &&
      (route.driver_id === driver.driver_id ||
        (route.driver_name || '').toLowerCase() === driver.name.toLowerCase()));

  const phrase = r2dConfirmPhrase(route.route_id, nextLabel);
  r2dPreviewEl.hidden = false;
  r2dPreviewEl.className = sameAssignment
    ? 'assignment-preview warn'
    : 'assignment-preview';
  r2dPreviewEl.innerHTML = sameAssignment
    ? `<strong>${route.route_id}</strong> is already held by <strong>${current}</strong>.`
    : `<strong>${route.route_id}</strong> moves from <strong>${current}</strong> to <strong>${nextLabel}</strong>.` +
      `<br><span class="meta">Type <code>${phrase}</code> below to unlock Confirm.</span>`;

  const confirmOk = r2dConfirmEl.value.trim() === phrase;
  const ready =
    !sameAssignment &&
    Boolean(r2dByEl.value.trim()) &&
    Boolean(r2dNoteEl.value.trim()) &&
    confirmOk &&
    r2dAckEl.checked;
  r2dSubmitEl.disabled = !ready;
}

/**
 * @param {string} hireDate
 * @param {number} index
 * @param {-1 | 1} direction
 */
function moveInOrder(hireDate, index, direction) {
  const order = orderByHireDate.get(hireDate);
  if (!order) return;
  const next = index + direction;
  if (next < 0 || next >= order.length) return;
  const copy = [...order];
  const tmp = copy[index];
  copy[index] = copy[next];
  copy[next] = tmp;
  orderByHireDate.set(hireDate, copy);
  renderTieGroups();
}

function renderTieGroups() {
  tieGroupsEl.innerHTML = '';
  for (const tie of unresolvedTies) {
    const order =
      orderByHireDate.get(tie.hire_date) ??
      tie.drivers.map((d) => d.driver_id);
    orderByHireDate.set(tie.hire_date, order);

    const block = document.createElement('div');
    block.className = 'seniority-tie-group';

    const heading = document.createElement('h3');
    heading.textContent = `Hired ${tie.hire_date}`;
    block.appendChild(heading);

    const list = document.createElement('ol');
    list.className = 'seniority-tie-order';
    order.forEach((driverId, index) => {
      const driver = tie.drivers.find((d) => d.driver_id === driverId);
      const li = document.createElement('li');
      li.innerHTML = `<strong>${driver?.name ?? driverId}</strong>`;
      const actions = document.createElement('div');
      actions.className = 'seniority-tie-move';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'secondary';
      up.textContent = 'Up';
      up.disabled = index === 0;
      up.addEventListener('click', () => moveInOrder(tie.hire_date, index, -1));
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'secondary';
      down.textContent = 'Down';
      down.disabled = index === order.length - 1;
      down.addEventListener('click', () =>
        moveInOrder(tie.hire_date, index, 1)
      );
      actions.append(up, down);
      li.appendChild(actions);
      list.appendChild(li);
    });
    block.appendChild(list);

    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = `Save lots order for ${tie.hire_date}`;
    save.addEventListener('click', () => resolveTie(tie.hire_date));
    block.appendChild(save);

    tieGroupsEl.appendChild(block);
  }
  enhanceIcons(tieGroupsEl);
}

async function loadStaffNames() {
  staffNames = await fetchJson('/api/staff-names');
  const previous =
    tieResolvedByEl.value || localStorage.getItem('rct_entered_by') || '';
  fillStaffSelect(tieResolvedByEl, 'Select your name…', previous);
  fillStaffSelect(d2rByEl, 'Select your name…', previous);
  fillStaffSelect(r2dByEl, 'Select your name…', previous);
}

function openTieResolvePanel() {
  if (!unresolvedTies.length) return;
  orderByHireDate.clear();
  for (const tie of unresolvedTies) {
    orderByHireDate.set(
      tie.hire_date,
      tie.drivers.map((d) => d.driver_id)
    );
  }
  tieResolveEl.hidden = false;
  tieStatusEl.className = 'status';
  tieStatusEl.textContent = '';
  renderTieGroups();
  tieResolveEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeTieResolvePanel() {
  tieResolveEl.hidden = true;
  tieNoteEl.value = '';
  tieStatusEl.className = 'status';
  tieStatusEl.textContent = '';
}

/**
 * @param {string} hireDate
 */
async function resolveTie(hireDate) {
  const ordered = orderByHireDate.get(hireDate);
  const resolved_by = tieResolvedByEl.value.trim();
  const note = tieNoteEl.value.trim();
  if (!ordered?.length) {
    showStatus(tieStatusEl, 'Nothing to resolve for that hire date.', 'error');
    return;
  }
  if (!resolved_by) {
    showStatus(tieStatusEl, 'Select your name.', 'error');
    return;
  }
  if (!note) {
    showStatus(
      tieStatusEl,
      'Add a note (e.g. when/where lots were drawn).',
      'error'
    );
    return;
  }

  try {
    const result = await fetchJson('/api/admin/seniority-ties/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hire_date: hireDate,
        ordered_driver_ids: ordered,
        resolved_by,
        note,
      }),
    });
    localStorage.setItem('rct_entered_by', resolved_by);
    showStatus(tieStatusEl, result.message || 'Lots order recorded.', 'ok');
    await loadDrivers();
    if (!unresolvedTies.length) {
      closeTieResolvePanel();
    } else {
      openTieResolvePanel();
    }
  } catch (error) {
    showStatus(tieStatusEl, error.message, 'error');
  }
}

/**
 * @param {HTMLFormElement} form
 */
function resetAssignmentForm(form) {
  form.reset();
  if (form === d2rForm) {
    d2rPreviewEl.hidden = true;
    d2rPreviewEl.textContent = '';
    d2rSubmitEl.disabled = true;
    d2rStatusEl.className = 'status';
    d2rStatusEl.textContent = '';
  } else if (form === r2dForm) {
    r2dPreviewEl.hidden = true;
    r2dPreviewEl.textContent = '';
    r2dSubmitEl.disabled = true;
    r2dStatusEl.className = 'status';
    r2dStatusEl.textContent = '';
  }
  const remembered = localStorage.getItem('rct_entered_by') || '';
  if (remembered) {
    if (form === d2rForm && staffNames.includes(remembered)) {
      d2rByEl.value = remembered;
    }
    if (form === r2dForm && staffNames.includes(remembered)) {
      r2dByEl.value = remembered;
    }
  }
}

searchEl.addEventListener('input', () => applyFilter({ resetPage: true }));
sortEl?.addEventListener('change', () => {
  localStorage.setItem(SORT_STORAGE_KEY, currentSort());
  applyFilter({ resetPage: true });
});
tieCancelBtn.addEventListener('click', closeTieResolvePanel);

for (const tool of assignmentTools) {
  tool.addEventListener('toggle', () => {
    if (!tool.open) {
      const form = tool.querySelector('form');
      if (form instanceof HTMLFormElement) resetAssignmentForm(form);
      return;
    }
    for (const other of assignmentTools) {
      if (other !== tool && other.open) other.open = false;
    }
  });
}

addDriverForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const first = addDriverFirstNameEl.value.trim();
  const last = addDriverLastNameEl.value.trim();
  const hire_date = addDriverHireDateEl.value.trim();
  const email = addDriverEmailEl.value.trim() || null;
  if (!first) {
    showStatus(addDriverStatusEl, 'Enter a first name.', 'error');
    return;
  }
  if (!last) {
    showStatus(addDriverStatusEl, 'Enter a last name.', 'error');
    return;
  }
  const name = `${first} ${last}`.replace(/\s+/g, ' ').trim();
  if (!hire_date) {
    showStatus(addDriverStatusEl, 'Hire date is required for seniority.', 'error');
    return;
  }

  const submitBtn = addDriverForm.querySelector('button[type="submit"]');
  if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;
  try {
    const created = await fetchJson('/api/drivers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, hire_date, email }),
    });
    showStatus(
      addDriverStatusEl,
      `Added ${created.name} to the directory.`,
      'ok'
    );
    addDriverForm.reset();
    await loadDrivers();
  } catch (error) {
    showStatus(addDriverStatusEl, error.message, 'error');
  } finally {
    if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
  }
});

for (const el of [
  d2rDriverEl,
  d2rRouteEl,
  d2rByEl,
  d2rNoteEl,
  d2rConfirmEl,
  d2rAckEl,
]) {
  el.addEventListener('input', updateDriverToRouteGate);
  el.addEventListener('change', updateDriverToRouteGate);
}

d2rForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  updateDriverToRouteGate();
  if (d2rSubmitEl.disabled) {
    showStatus(
      d2rStatusEl,
      'Finish the preview, typed confirmation, note, staff name, and acknowledgment first.',
      'error'
    );
    return;
  }

  const driverId = d2rDriverEl.value;
  const routeId = d2rRouteEl.value;
  const reassigned_by = d2rByEl.value.trim();
  const note = d2rNoteEl.value.trim();
  d2rSubmitEl.disabled = true;
  try {
    const result = await fetchJson(
      `/api/routes/${encodeURIComponent(routeId)}/reassign`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unassigned: false,
          new_driver_id: driverId,
          reassigned_by,
          note,
          resolution: 'routine',
        }),
      }
    );
    localStorage.setItem('rct_entered_by', reassigned_by);
    const message = result.message || 'Assignment saved.';
    resetAssignmentForm(d2rForm);
    showStatus(d2rStatusEl, message, 'ok');
    await loadDrivers();
  } catch (error) {
    showStatus(d2rStatusEl, error.message, 'error');
    updateDriverToRouteGate();
  }
});

for (const el of [
  r2dRouteEl,
  r2dDriverEl,
  r2dByEl,
  r2dNoteEl,
  r2dConfirmEl,
  r2dAckEl,
]) {
  el.addEventListener('input', updateRouteToDriverGate);
  el.addEventListener('change', updateRouteToDriverGate);
}

r2dForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  updateRouteToDriverGate();
  if (r2dSubmitEl.disabled) {
    showStatus(
      r2dStatusEl,
      'Finish the preview, typed confirmation, note, staff name, and acknowledgment first.',
      'error'
    );
    return;
  }

  const routeId = r2dRouteEl.value;
  const driverValue = r2dDriverEl.value;
  const unassigned = driverValue === UNASSIGNED_VALUE;
  const reassigned_by = r2dByEl.value.trim();
  const note = r2dNoteEl.value.trim();
  r2dSubmitEl.disabled = true;
  try {
    const result = await fetchJson(
      `/api/routes/${encodeURIComponent(routeId)}/reassign`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unassigned,
          new_driver_id: unassigned ? null : driverValue,
          reassigned_by,
          note,
          resolution: 'routine',
        }),
      }
    );
    localStorage.setItem('rct_entered_by', reassigned_by);
    const message = result.message || 'Assignment saved.';
    resetAssignmentForm(r2dForm);
    showStatus(r2dStatusEl, message, 'ok');
    await loadDrivers();
  } catch (error) {
    showStatus(r2dStatusEl, error.message, 'error');
    updateRouteToDriverGate();
  }
});

async function loadDrivers() {
  const [driverRows, tiePayload, routes] = await Promise.all([
    fetchJson('/api/drivers'),
    fetchJson('/api/admin/seniority-ties'),
    fetchJson('/api/routes'),
  ]);
  drivers = driverRows;
  unresolvedTies = tiePayload.ties ?? [];
  allRoutes = Array.isArray(routes) ? routes : [];
  indexRoutesByDriver(allRoutes);
  applyFilter();
  updateHireDateReminder();
  updateSeniorityTieReminder();
  refreshToolSelects();
  showStatus(
    statusEl,
    `Loaded ${drivers.length} driver${drivers.length === 1 ? '' : 's'} · ${allRoutes.length} route${allRoutes.length === 1 ? '' : 's'}.`,
    'ok'
  );
}

restoreSortPreference();

Promise.all([loadStaffNames(), loadDrivers()]).catch((error) => {
  showStatus(statusEl, error.message, 'error');
});
