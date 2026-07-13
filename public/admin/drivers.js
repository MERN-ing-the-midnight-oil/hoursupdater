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
const listEl = document.getElementById('driver-list');
const searchEl = document.getElementById('driver-search');

/** @type {Array<{ driver_id: string, name: string, email: string | null }>} */
let drivers = [];

/**
 * @param {Array<{ driver_id: string, name: string, email: string | null }>} rows
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
    li.innerHTML = `
      <div class="driver-info">
        <a href="/admin/drivers/${encodeURIComponent(driver.driver_id)}"><strong>${driver.name}</strong></a>
        <span class="meta">${driver.email || 'No email on file'}</span>
      </div>
      <span class="meta">${driver.driver_id}</span>
      <a class="secondary button-link" href="/admin/drivers/${encodeURIComponent(driver.driver_id)}">Open</a>
    `;
    listEl.appendChild(li);
  }
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

searchEl.addEventListener('input', applyFilter);

async function loadDrivers() {
  drivers = await fetchJson('/api/drivers');
  applyFilter();
  showStatus(
    statusEl,
    `Loaded ${drivers.length} driver${drivers.length === 1 ? '' : 's'}.`,
    'ok'
  );
}

loadDrivers().catch((error) => {
  showStatus(statusEl, error.message, 'error');
});
