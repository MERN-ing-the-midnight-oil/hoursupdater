import { appendCitationLinks } from '../shared/contractCitationUi.js';
import { enhanceIcons } from '../shared/icons.js';
import '../shared/practiceBanner.js';

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

/** @type {Array<{ driver_id: string, name: string, email: string | null, hire_date?: string | null, tie_break?: number | null }>} */
let drivers = [];

/** @type {{ hire_date: string, drivers: { driver_id: string, name: string, email: string | null, hire_date: string, tie_break: number | null }[] }[]} */
let unresolvedTies = [];

/**
 * Local ordered lists for each hire_date being resolved (most senior first).
 * @type {Map<string, string[]>}
 */
const orderByHireDate = new Map();

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
    const missingHire = !driver.hire_date;
    const hireLabel = missingHire
      ? 'Hire date missing'
      : `Hired ${driver.hire_date}`;
    li.innerHTML = `
      <div class="driver-info">
        <a href="/admin/drivers/${encodeURIComponent(driver.driver_id)}"><strong>${driver.name}</strong></a>
        <span class="meta">${driver.email || 'No email on file'} · ${hireLabel}</span>
      </div>
      <span class="meta">${driver.driver_id}</span>
      <a class="secondary button-link with-icon" href="/admin/drivers/${encodeURIComponent(driver.driver_id)}" data-icon="arrow-right">Open</a>
    `;
    listEl.appendChild(li);
  }
  enhanceIcons(listEl);
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

function applyFilter() {
  const q = searchEl.value.trim().toLowerCase();
  if (!q) {
    renderDrivers(drivers);
    return;
  }
  renderDrivers(
    drivers.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.email && d.email.toLowerCase().includes(q)) ||
        d.driver_id.toLowerCase().includes(q)
    )
  );
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
  const names = await fetchJson('/api/staff-names');
  const previous =
    tieResolvedByEl.value || localStorage.getItem('rct_entered_by') || '';
  tieResolvedByEl.innerHTML = '<option value="">Select your name…</option>';
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    tieResolvedByEl.appendChild(option);
  }
  if (previous && names.includes(previous)) {
    tieResolvedByEl.value = previous;
  }
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

searchEl.addEventListener('input', applyFilter);
tieCancelBtn.addEventListener('click', closeTieResolvePanel);

async function loadDrivers() {
  const [driverRows, tiePayload] = await Promise.all([
    fetchJson('/api/drivers'),
    fetchJson('/api/admin/seniority-ties'),
  ]);
  drivers = driverRows;
  unresolvedTies = tiePayload.ties ?? [];
  applyFilter();
  updateHireDateReminder();
  updateSeniorityTieReminder();
  showStatus(
    statusEl,
    `Loaded ${drivers.length} driver${drivers.length === 1 ? '' : 's'}.`,
    'ok'
  );
}

Promise.all([loadStaffNames(), loadDrivers()]).catch((error) => {
  showStatus(statusEl, error.message, 'error');
});
