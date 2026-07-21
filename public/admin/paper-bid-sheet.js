import { enhanceIcons, setLabeledIcon } from '../shared/icons.js';

enhanceIcons();

const params = new URLSearchParams(window.location.search);
const routeId = String(params.get('route_id') || '').trim();

const statusEl = document.getElementById('sheet-status');
const sheetRoot = document.getElementById('sheet-root');
const startDateInput = document.getElementById('paper_bid_start_date');
const saveBtn = document.getElementById('save-start-date');
const printBtn = document.getElementById('print-sheet');
const exportDocxBtn = document.getElementById('export-docx');

/** @type {object | null} */
let sheet = null;

/**
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

/**
 * @param {HTMLElement | null} el
 * @param {string} message
 * @param {'ok' | 'error' | ''} [kind]
 */
function showStatus(el, message, kind = '') {
  if (!el) return;
  el.textContent = message;
  el.className = kind ? `status ${kind}` : 'status';
}

const NAME_BASE_PX = 15;
const NAME_MIN_PX = 9;

/**
 * Shrink each driver name until it fits its column cell (nowrap).
 * @param {ParentNode} root
 */
function fitDriverNameFonts(root) {
  const names = root.querySelectorAll('.paper-bid-name');
  for (const el of names) {
    if (!(el instanceof HTMLElement)) continue;
    el.style.fontSize = `${NAME_BASE_PX}px`;
    let size = NAME_BASE_PX;
    // Binary-ish shrink: step down until it fits or we hit the floor.
    while (size > NAME_MIN_PX && el.scrollWidth > el.clientWidth + 0.5) {
      size = Math.max(NAME_MIN_PX, size - 0.5);
      el.style.fontSize = `${size}px`;
    }
  }
}

/**
 * @param {object} driver
 * @returns {HTMLElement}
 */
function renderDriverRow(driver) {
  const row = document.createElement('div');
  row.className = driver.more_senior_than_holder
    ? 'paper-bid-driver is-senior'
    : 'paper-bid-driver';

  const rank = document.createElement('span');
  rank.className = 'paper-bid-rank';
  rank.textContent =
    driver.seniority_rank != null ? String(driver.seniority_rank) : '—';

  const name = document.createElement('span');
  name.className = 'paper-bid-name';
  name.textContent = driver.name || '—';
  name.title = driver.name || '';

  const initial = document.createElement('span');
  initial.className = 'paper-bid-initial-box';
  initial.setAttribute('aria-hidden', 'true');

  row.append(rank, name, initial);
  return row;
}

/**
 * @param {object} data
 */
function renderSheet(data) {
  sheetRoot.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'paper-bid-sheet-header';

  const title = document.createElement('h1');
  title.textContent = data.template?.title || 'Open Bid Sign-Up Sheet';
  header.appendChild(title);

  const meta = document.createElement('dl');
  meta.className = 'paper-bid-meta';
  const rows = [
    ['Route', data.route_id || '—'],
    ['Schedule', data.schedule || '—'],
    ['Start date', data.paper_bid_start_date || '—'],
    ['Current holder', data.driver_name || 'Unassigned'],
    ['Sign-up due', data.bid_response_due_date || '—'],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    meta.append(dt, dd);
  }
  header.appendChild(meta);

  if (data.template?.intro) {
    const intro = document.createElement('p');
    intro.className = 'paper-bid-intro';
    intro.textContent = data.template.intro;
    header.appendChild(intro);
  }

  sheetRoot.appendChild(header);

  const columnsEl = document.createElement('div');
  columnsEl.className = 'paper-bid-columns';

  /** Prefer `columns`; otherwise only include defined left/middle/right arrays. */
  let lists =
    Array.isArray(data.columns) && data.columns.length
      ? data.columns
      : [
          data.left_column,
          data.middle_column,
          data.right_column,
        ].filter((col) => Array.isArray(col));
  if (!lists.length) lists = [[], [], []];

  for (const list of lists) {
    const col = document.createElement('div');
    col.className = 'paper-bid-column';
    const colHead = document.createElement('div');
    colHead.className = 'paper-bid-column-head';
    colHead.innerHTML =
      '<span>#</span><span>Driver</span><span>Initials</span>';
    col.appendChild(colHead);
    for (const driver of list) {
      col.appendChild(renderDriverRow(driver));
    }
    columnsEl.appendChild(col);
  }
  sheetRoot.appendChild(columnsEl);

  if (data.template?.footer) {
    const footer = document.createElement('p');
    footer.className = 'paper-bid-footer';
    footer.textContent = data.template.footer;
    sheetRoot.appendChild(footer);
  }

  // Fit after layout so clientWidth is meaningful.
  requestAnimationFrame(() => fitDriverNameFonts(sheetRoot));

  const canExport = Boolean(data.paper_bid_start_date);
  if (printBtn) printBtn.disabled = !canExport;
  if (exportDocxBtn) exportDocxBtn.disabled = !canExport;
  if (!canExport) {
    showStatus(
      statusEl,
      'Set and save a route start date before printing or exporting.',
      ''
    );
  }
}

async function loadSheet() {
  if (!routeId) {
    sheetRoot.innerHTML =
      '<p class="field-hint warn-text">Missing route_id in the URL.</p>';
    if (printBtn) printBtn.disabled = true;
    if (exportDocxBtn) exportDocxBtn.disabled = true;
    return;
  }
  sheet = await fetchJson(
    `/api/routes/${encodeURIComponent(routeId)}/paper-bid-sheet`
  );
  if (startDateInput) {
    startDateInput.value = sheet.paper_bid_start_date || '';
  }
  document.title = `Paper bid · ${sheet.route_id} · Teamster Tracker`;
  renderSheet(sheet);
}

saveBtn?.addEventListener('click', async () => {
  if (!routeId) return;
  saveBtn.disabled = true;
  try {
    const value = startDateInput?.value?.trim() || '';
    if (!value) {
      throw new Error('Choose a route start date first.');
    }
    await fetchJson(
      `/api/routes/${encodeURIComponent(routeId)}/paper-bid-start-date`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper_bid_start_date: value }),
      }
    );
    await loadSheet();
    showStatus(statusEl, 'Start date saved.', 'ok');
  } catch (error) {
    showStatus(statusEl, error.message, 'error');
  } finally {
    saveBtn.disabled = false;
  }
});

printBtn?.addEventListener('click', () => {
  if (!sheet?.paper_bid_start_date) {
    showStatus(
      statusEl,
      'Set and save a route start date before printing or exporting.',
      'error'
    );
    return;
  }
  fitDriverNameFonts(sheetRoot);
  window.print();
});

window.addEventListener('resize', () => {
  if (sheetRoot) fitDriverNameFonts(sheetRoot);
});

window.addEventListener('beforeprint', () => {
  if (sheetRoot) fitDriverNameFonts(sheetRoot);
});

exportDocxBtn?.addEventListener('click', async () => {
  if (!routeId) return;
  if (!sheet?.paper_bid_start_date) {
    showStatus(
      statusEl,
      'Set and save a route start date before printing or exporting.',
      'error'
    );
    return;
  }
  exportDocxBtn.disabled = true;
  try {
    const res = await fetch(
      `/api/routes/${encodeURIComponent(routeId)}/paper-bid-sheet.docx`
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Export failed (${res.status})`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = /filename="([^"]+)"/.exec(disposition);
    const filename = match?.[1] || `paper-bid-signup_${routeId}.docx`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showStatus(statusEl, 'Word document downloaded.', 'ok');
  } catch (error) {
    showStatus(statusEl, error.message, 'error');
  } finally {
    exportDocxBtn.disabled = !sheet?.paper_bid_start_date;
  }
});

if (saveBtn) setLabeledIcon(saveBtn, 'save', 'Save start date');
if (printBtn) setLabeledIcon(printBtn, 'printer', 'Print sign-up sheet');
if (exportDocxBtn) {
  setLabeledIcon(exportDocxBtn, 'download', 'Export Word (.docx)');
}

loadSheet().catch((error) => {
  sheetRoot.innerHTML = `<p class="field-hint warn-text">${error.message}</p>`;
  showStatus(statusEl, error.message, 'error');
});
