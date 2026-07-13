import {
  emptyMessage,
  kindForStatus,
  renderChangeList,
  renderChangeReportCard,
  renderPendingChangesCard,
  renderRouteCard,
  setReassignRefreshHandler,
} from '../shared/queueRenderers.js';

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

function driverIdFromPath() {
  const parts = window.location.pathname.replace(/\/+$/, '').split('/');
  const idx = parts.indexOf('drivers');
  if (idx < 0 || !parts[idx + 1]) return null;
  return decodeURIComponent(parts[idx + 1]);
}

const statusEl = document.getElementById('driver-status');
const headerEl = document.getElementById('driver-header');
const rootEl = document.getElementById('driver-root');
const nameEl = document.getElementById('driver-name');
const emailEl = document.getElementById('driver-email');

const lists = {
  assignments: document.getElementById('list-assignments'),
  history: document.getElementById('list-history'),
  reports: document.getElementById('list-reports'),
  reviews: document.getElementById('list-reviews'),
};

const counts = {
  assignments: document.getElementById('count-assignments'),
  history: document.getElementById('count-history'),
  reports: document.getElementById('count-reports'),
  reviews: document.getElementById('count-reviews'),
};

/**
 * @param {HTMLElement} listEl
 * @param {HTMLElement[]} nodes
 * @param {string} emptyText
 */
function fillList(listEl, nodes, emptyText) {
  listEl.innerHTML = '';
  if (!nodes.length) {
    listEl.appendChild(emptyMessage(emptyText));
    return;
  }
  for (const node of nodes) {
    listEl.appendChild(node);
  }
}

/**
 * @param {object} detail
 */
function renderDetail(detail) {
  const { driver, assignments, change_history, change_reports, review_history } =
    detail;

  nameEl.textContent = driver.name;
  emailEl.textContent = driver.email || 'No email on file';
  document.title = `${driver.name} · Admin · Route Change Tracker`;

  headerEl.hidden = false;
  rootEl.hidden = false;

  counts.assignments.textContent = String(assignments.length);
  counts.history.textContent = String(change_history.length);
  counts.reports.textContent = String(change_reports.length);
  counts.reviews.textContent = String(review_history.length);

  const assignmentCards = [];
  for (const row of assignments) {
    assignmentCards.push(
      renderRouteCard(row, kindForStatus(row), {
        linkDriver: false,
        showSegments: true,
      })
    );
    if (
      row.status === 'NEEDS_REVIEW' &&
      (row.pending_change_ids?.length ?? 0) > 0
    ) {
      assignmentCards.push(
        renderPendingChangesCard(row, { linkDriver: false })
      );
    }
  }
  fillList(
    lists.assignments,
    assignmentCards,
    'No current route assignments for this driver.'
  );

  if (!change_history.length) {
    fillList(lists.history, [], 'No change-log entries involve this person.');
  } else {
    const wrap = document.createElement('article');
    wrap.className = 'queue-card';
    const title = document.createElement('h3');
    title.textContent = 'Chronological log';
    wrap.appendChild(title);
    wrap.appendChild(renderChangeList(change_history, { showRoute: true }));
    fillList(lists.history, [wrap], '');
  }

  fillList(
    lists.reports,
    change_reports.map((report) => renderChangeReportCard(report)),
    'No finalized Change Reports on this driver’s routes.'
  );

  fillList(
    lists.reviews,
    review_history.map((row) =>
      renderRouteCard(row, 'needs-review', { linkDriver: false })
    ),
    'No open or self-resolved review history for this driver.'
  );
}

async function loadDetail() {
  const driverId = driverIdFromPath();
  if (!driverId) {
    throw new Error('Missing driver id in URL.');
  }
  const detail = await fetchJson(
    `/api/admin/drivers/${encodeURIComponent(driverId)}`
  );
  renderDetail(detail);
  showStatus(
    statusEl,
    [
      `${detail.assignments.length} assignment${detail.assignments.length === 1 ? '' : 's'}`,
      `${detail.change_history.length} log entr${detail.change_history.length === 1 ? 'y' : 'ies'}`,
      `${detail.change_reports.length} report${detail.change_reports.length === 1 ? '' : 's'}`,
    ].join(' · '),
    'ok'
  );
}

loadDetail().catch((error) => {
  showStatus(statusEl, error.message, 'error');
});

setReassignRefreshHandler(() => {
  loadDetail().catch((error) => {
    showStatus(statusEl, error.message, 'error');
  });
});
