/**
 * Shared Admin queue / driver-detail renderers.
 * Keep ChangeEvent, ADJUSTMENT, review-history, and route-card markup here so
 * the queue and the per-driver view stay one slice of the same data.
 */
import {
  formatReportOutcome,
  formatSignedMinutes,
  renderSeeTheMath,
} from './seeTheMath.js';
import { appendGlossaryTip, createGlossaryTip } from './glossaryTip.js';

/** @type {Array<{ driver_id: string, name: string, email: string | null }> | null} */
let cachedDrivers = null;
/** @type {string[] | null} */
let cachedStaffNames = null;
/** @type {(() => void) | null} */
let reassignRefreshHandler = null;

/**
 * @param {() => void} handler
 */
export function setReassignRefreshHandler(handler) {
  reassignRefreshHandler = handler;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

async function loadDrivers() {
  if (cachedDrivers) return cachedDrivers;
  cachedDrivers = await fetchJson('/api/drivers');
  return cachedDrivers;
}

async function loadStaffNames() {
  if (cachedStaffNames) return cachedStaffNames;
  cachedStaffNames = await fetchJson('/api/staff-names');
  return cachedStaffNames;
}

/**
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function formatWhen(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString();
}

/**
 * @param {string | null | undefined} sinceIso
 * @returns {string}
 */
export function formatSittingDuration(sinceIso) {
  if (!sinceIso) return 'unknown duration';
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) return `since ${sinceIso}`;
  const ms = Date.now() - since.getTime();
  if (ms < 0) return `since ${formatWhen(sinceIso)}`;
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days === 0) return `since ${formatWhen(sinceIso)} (less than a day)`;
  if (days === 1) return `since ${formatWhen(sinceIso)} (1 day)`;
  return `since ${formatWhen(sinceIso)} (${days} days)`;
}

/**
 * @param {string} text
 * @returns {HTMLElement}
 */
export function emptyMessage(text) {
  const p = document.createElement('p');
  p.className = 'field-hint empty-section';
  p.textContent = text;
  return p;
}

/**
 * Display label for a live route assignment (Unassigned when empty).
 * @param {string | null | undefined} driverName
 * @returns {string}
 */
export function assignmentDriverLabel(driverName) {
  const name = driverName?.trim();
  return name || 'Unassigned';
}

/**
 * @param {string | null | undefined} driverId
 * @param {string | null | undefined} driverName
 * @returns {string} HTML for the driver label (linked when id is known)
 */
export function driverLabelHtml(driverId, driverName) {
  const name = assignmentDriverLabel(driverName);
  if (!driverId) return name;
  return `<a href="/admin/drivers/${encodeURIComponent(driverId)}">${name}</a>`;
}

/**
 * @param {Array<object>} changes
 * @param {{ showRoute?: boolean }} [options]
 * @returns {HTMLElement}
 */
export function renderChangeList(changes, options = {}) {
  const showRoute = options.showRoute === true;
  const list = document.createElement('ul');
  list.className = 'report-changes';
  if (!changes?.length) {
    const empty = document.createElement('li');
    empty.textContent = 'None recorded.';
    list.appendChild(empty);
    return list;
  }

  for (const change of changes) {
    const li = document.createElement('li');
    const routeBit =
      showRoute && change.route_id
        ? ` · <span class="meta-route">${change.route_id}</span>`
        : '';
    if (change.missing) {
      li.innerHTML = `<div><strong>${change.id}</strong>${routeBit}</div><div class="meta">Change not found in log.</div>`;
      list.appendChild(li);
      continue;
    }
    if (change.type === 'ADJUSTMENT') {
      li.innerHTML = `
        <div><strong>${change.start_date || '—'}</strong> · ADJUSTMENT${routeBit}</div>
        <div class="meta">
          ${change.previous_delta} → ${change.new_delta}
          · net ${formatSignedMinutes(change.delta_minutes)} min
          · ${change.reason || '—'}
          · by ${change.entered_by || '—'}
        </div>
        <div class="meta">${change.note || ''}</div>
      `;
    } else if (change.type === 'REASSIGNMENT') {
      li.innerHTML = `
        <div><strong>${change.start_date || '—'}</strong> · REASSIGNMENT${routeBit}</div>
        <div class="meta">
          ${change.previous_time || 'Unassigned'} → ${change.new_time || 'Unassigned'}
          · by ${change.entered_by || '—'}
        </div>
        <div class="meta">${change.note || ''}</div>
      `;
    } else {
      li.innerHTML = `
        <div><strong>${change.start_date || '—'}</strong> · ${change.segment || '—'}${routeBit}</div>
        <div class="meta">
          ${change.previous_time || '—'} → ${change.new_time || '—'}
          · ${formatSignedMinutes(change.delta_minutes)} min
          · entered by ${change.entered_by || '—'}
        </div>
        <div class="meta">${change.note || ''}</div>
      `;
    }
    list.appendChild(li);
  }
  return list;
}

/**
 * @param {object} row
 * @returns {HTMLElement}
 */
export function renderSeeTheMathDetails(row) {
  const details = document.createElement('details');
  details.className = 'see-the-math';
  const summary = document.createElement('summary');
  summary.textContent = 'See the math';
  const body = document.createElement('div');
  body.className = 'see-the-math-body';
  renderSeeTheMath(body, row.see_the_math);
  details.append(summary, body);
  return details;
}

/**
 * @param {object} row
 * @param {{ includeRoute?: boolean }} [options]
 * @returns {DocumentFragment | HTMLElement}
 */
export function renderReviewHistory(row, options = {}) {
  const selfResolved = (row.review_history ?? []).filter(
    (item) => item.event === 'NEEDS_REVIEW_SELF_RESOLVED'
  );
  if (!selfResolved.length) return document.createDocumentFragment();

  const wrap = document.createElement('div');
  wrap.className = 'review-history';
  const title = document.createElement('h4');
  title.textContent = options.includeRoute
    ? `Self-resolved review history · ${row.route_id || '—'}`
    : 'Self-resolved review history';
  wrap.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'report-changes';
  for (const item of selfResolved) {
    const li = document.createElement('li');
    const adjustment = (row.related_adjustments ?? []).find(
      (adj) => adj.id === item.causing_adjustment_id
    );
    li.innerHTML = `
      <div><strong>NEEDS_REVIEW_SELF_RESOLVED</strong> · ${formatWhen(item.resolved_at)}</div>
      <div class="meta">
        Flag raised ${item.previous_flag_raised_at ? formatWhen(item.previous_flag_raised_at) : '—'}
        · causing adjustment ${item.causing_adjustment_id || '—'}
      </div>
      ${
        adjustment
          ? `<div class="meta">${adjustment.previous_delta} → ${adjustment.new_delta} · by ${adjustment.entered_by || '—'} · ${adjustment.note || ''}</div>`
          : ''
      }
    `;
    list.appendChild(li);
  }
  wrap.appendChild(list);
  return wrap;
}

/**
 * Searchable driver picker with an explicit Unassigned option.
 * @param {{
 *   drivers: Array<{ driver_id: string, name: string, email: string | null }>,
 *   currentDriverId?: string | null,
 *   currentDriverName?: string | null,
 * }} options
 * @returns {{ root: HTMLElement, getSelection: () => { unassigned: boolean, driver_id: string | null } }}
 */
function buildDriverReassignCombobox(options) {
  const { drivers, currentDriverId = null, currentDriverName = null } = options;
  const root = document.createElement('div');
  root.className = 'field';

  const label = document.createElement('label');
  label.textContent = 'Assign to';
  const combobox = document.createElement('div');
  combobox.className = 'combobox';
  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = 'Search drivers or choose Unassigned…';
  search.autocomplete = 'off';
  search.setAttribute('aria-autocomplete', 'list');
  const listbox = document.createElement('ul');
  listbox.className = 'route-listbox';
  listbox.setAttribute('role', 'listbox');
  listbox.hidden = true;

  /** @type {{ unassigned: boolean, driver_id: string | null, label: string }} */
  let selection = currentDriverId
    ? {
        unassigned: false,
        driver_id: currentDriverId,
        label: currentDriverName || currentDriverId,
      }
    : currentDriverName?.trim()
      ? {
          unassigned: false,
          driver_id: null,
          label: currentDriverName,
        }
      : {
          unassigned: true,
          driver_id: null,
          label: 'Unassigned',
        };

  search.value = selection.label;

  let activeIndex = -1;

  function filtered(query) {
    const q = query.trim().toLowerCase();
    const rows = [
      { kind: 'unassigned', driver_id: null, name: 'Unassigned', email: null },
      ...drivers.map((d) => ({ kind: 'driver', ...d })),
    ];
    if (!q) return rows;
    return rows.filter((row) => {
      if (row.kind === 'unassigned') {
        return 'unassigned'.includes(q) || 'none'.includes(q);
      }
      return (
        row.name.toLowerCase().includes(q) ||
        (row.email && row.email.toLowerCase().includes(q)) ||
        row.driver_id.toLowerCase().includes(q)
      );
    });
  }

  function closeList() {
    listbox.hidden = true;
    activeIndex = -1;
  }

  function openList() {
    listbox.hidden = false;
  }

  function renderOptions(query = search.value) {
    const matches = filtered(query);
    listbox.innerHTML = '';
    if (!matches.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'No matching drivers.';
      listbox.appendChild(empty);
      openList();
      return;
    }
    matches.forEach((row, index) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute(
        'aria-selected',
        index === activeIndex ? 'true' : 'false'
      );
      if (row.kind === 'unassigned') {
        li.textContent = 'Unassigned';
        li.className = 'reassign-unassigned-option';
      } else {
        li.textContent = row.email
          ? `${row.name} · ${row.email}`
          : row.name;
      }
      li.addEventListener('mousedown', (event) => {
        event.preventDefault();
        if (row.kind === 'unassigned') {
          selection = {
            unassigned: true,
            driver_id: null,
            label: 'Unassigned',
          };
        } else {
          selection = {
            unassigned: false,
            driver_id: row.driver_id,
            label: row.name,
          };
        }
        search.value = selection.label;
        closeList();
      });
      listbox.appendChild(li);
    });
    openList();
  }

  search.addEventListener('focus', () => renderOptions(search.value));
  search.addEventListener('input', () => {
    selection = {
      unassigned: false,
      driver_id: null,
      label: search.value,
    };
    renderOptions(search.value);
  });
  search.addEventListener('blur', () => {
    setTimeout(closeList, 120);
  });

  combobox.append(search, listbox);
  root.append(label, combobox);

  return {
    root,
    getSelection: () => ({
      unassigned: selection.unassigned,
      driver_id: selection.driver_id,
    }),
  };
}

/**
 * Reassign panel: searchable driver + Unassigned, staff name, required note.
 * @param {object} row
 * @returns {HTMLElement}
 */
export function renderReassignPanel(row) {
  const details = document.createElement('details');
  details.className = 'reassign-panel';
  const summary = document.createElement('summary');
  summary.textContent = 'Reassign driver';
  details.appendChild(summary);

  const form = document.createElement('form');
  form.className = 'reassign-form';
  form.noValidate = true;

  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent =
    'Changes who currently holds this route. Does not reset the window, drift, or countdown.';
  form.appendChild(hint);

  const status = document.createElement('p');
  status.className = 'status';
  status.setAttribute('role', 'status');

  const pickerHost = document.createElement('div');
  /** @type {ReturnType<typeof buildDriverReassignCombobox> | null} */
  let picker = null;

  const staffField = document.createElement('div');
  staffField.className = 'field';
  staffField.innerHTML = `<label>Reassigned by</label>`;
  const staffSelect = document.createElement('select');
  staffSelect.required = true;
  staffSelect.innerHTML = `<option value="">Select…</option>`;
  staffField.appendChild(staffSelect);

  const noteField = document.createElement('div');
  noteField.className = 'field';
  noteField.innerHTML = `<label>Note</label>`;
  const note = document.createElement('textarea');
  note.required = true;
  note.rows = 2;
  note.placeholder = 'Why is this route being reassigned?';
  noteField.appendChild(note);

  const actions = document.createElement('div');
  actions.className = 'reassign-actions';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Save reassignment';
  actions.appendChild(submit);

  form.append(pickerHost, staffField, noteField, actions, status);
  details.appendChild(form);

  details.addEventListener('toggle', async () => {
    if (!details.open || picker) return;
    try {
      const [drivers, staffNames] = await Promise.all([
        loadDrivers(),
        loadStaffNames(),
      ]);
      picker = buildDriverReassignCombobox({
        drivers,
        currentDriverId: row.driver_id ?? null,
        currentDriverName: row.driver_name ?? null,
      });
      pickerHost.appendChild(picker.root);
      for (const name of staffNames) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        staffSelect.appendChild(opt);
      }
    } catch (error) {
      status.textContent = error.message;
      status.className = 'status visible error';
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!picker) {
      status.textContent = 'Driver list is still loading.';
      status.className = 'status visible error';
      return;
    }
    const selection = picker.getSelection();
    if (!selection.unassigned && !selection.driver_id) {
      status.textContent =
        'Pick a driver from the list, or choose Unassigned.';
      status.className = 'status visible error';
      return;
    }
    if (!staffSelect.value.trim()) {
      status.textContent = 'Reassigned by is required.';
      status.className = 'status visible error';
      return;
    }
    if (!note.value.trim()) {
      status.textContent = 'Note is required.';
      status.className = 'status visible error';
      return;
    }

    submit.disabled = true;
    try {
      const result = await fetchJson(
        `/api/routes/${encodeURIComponent(row.route_id)}/reassign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unassigned: selection.unassigned,
            new_driver_id: selection.unassigned ? null : selection.driver_id,
            reassigned_by: staffSelect.value.trim(),
            note: note.value.trim(),
          }),
        }
      );
      status.textContent = result.message || 'Reassignment saved.';
      status.className = 'status visible ok';
      cachedDrivers = null;
      if (reassignRefreshHandler) {
        reassignRefreshHandler();
      }
    } catch (error) {
      status.textContent = error.message;
      status.className = 'status visible error';
    } finally {
      submit.disabled = false;
    }
  });

  return details;
}

/**
 * @param {string} label
 * @param {string} value
 * @param {string | null} [glossaryId]
 * @returns {HTMLElement}
 */
function statRow(label, value, glossaryId = null) {
  const row = document.createElement('div');
  const dt = document.createElement('dt');
  dt.append(document.createTextNode(label));
  if (glossaryId) appendGlossaryTip(dt, glossaryId);
  const dd = document.createElement('dd');
  dd.textContent = value;
  row.append(dt, dd);
  return row;
}

/**
 * @param {object} row
 * @param {'needs-review' | 'accumulating' | 'bid-pending' | 'stable'} kind
 * @param {{ linkDriver?: boolean, showSegments?: boolean, enableReassign?: boolean }} [options]
 * @returns {HTMLElement}
 */
/**
 * @param {object} row
 * @param {'needs-review' | 'accumulating' | 'bid-pending' | 'stable'} kind
 * @param {{
 *   linkDriver?: boolean,
 *   showSegments?: boolean,
 *   enableReassign?: boolean,
 *   showNotifyPayroll?: boolean,
 *   payrollEmailConfigured?: boolean,
 *   onPayrollNotified?: () => void,
 * }} [options]
 */
export function renderRouteCard(row, kind, options = {}) {
  const linkDriver = options.linkDriver !== false;
  const showSegments = options.showSegments === true;
  const enableReassign = options.enableReassign !== false;
  const showNotifyPayroll = options.showNotifyPayroll === true;
  const payrollEmailConfigured = options.payrollEmailConfigured !== false;
  const card = document.createElement('article');
  card.className = 'queue-card';
  if (kind === 'needs-review' && row.status !== 'NEEDS_REVIEW') {
    card.classList.add('queue-card-self-resolved');
  }

  const header = document.createElement('header');
  const title = document.createElement('h3');
  const driverPart = linkDriver
    ? driverLabelHtml(row.driver_id, row.driver_name)
    : assignmentDriverLabel(row.driver_name);
  title.innerHTML = `${row.route_id} · ${driverPart}`;
  header.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.innerHTML = `Status <span class="badge">${row.status}</span>`;
  if (kind === 'needs-review' && row.status !== 'NEEDS_REVIEW') {
    meta.innerHTML +=
      ' · <span class="badge badge-self-resolved">self-resolved recently</span>';
  }
  header.appendChild(meta);
  card.appendChild(header);

  if (kind === 'needs-review' && row.reconciliation) {
    const recon = row.reconciliation;
    const block = document.createElement('div');
    block.className = 'recon-block';

    const heading = document.createElement('h4');
    heading.textContent = 'Discrepancy';
    block.appendChild(heading);

    const statusLine = document.createElement('p');
    statusLine.className = 'meta';
    statusLine.innerHTML = `
      Previous finalized <span class="badge">${recon.previous_finalized_status}</span>
      → computed <span class="badge">${recon.computed_status}</span>
    `;
    block.appendChild(statusLine);

    const stats = document.createElement('dl');
    stats.className = 'recon-stats';
    stats.append(
      statRow(
        'Computed cumulative drift',
        `${formatSignedMinutes(recon.computed_cumulative_drift_minutes)} min`,
        'cumulative_drift'
      ),
      statRow(
        'Computed payroll rounded total',
        recon.computed_payroll_rounded_total_minutes == null
          ? '—'
          : `${recon.computed_payroll_rounded_total_minutes} min`,
        'payroll_rounding'
      ),
      statRow(
        'Letter or action exists',
        recon.letter_or_action_exists ? 'Yes' : 'No'
      ),
      statRow('Raised', formatWhen(recon.raised_at))
    );
    block.appendChild(stats);
    card.appendChild(block);

    const causingTitle = document.createElement('h4');
    causingTitle.textContent = 'Causing ADJUSTMENT';
    card.appendChild(causingTitle);
    card.appendChild(
      renderChangeList(row.causing_adjustment ? [row.causing_adjustment] : [])
    );
  } else if (kind === 'needs-review' && row.status !== 'NEEDS_REVIEW') {
    const note = document.createElement('p');
    note.className = 'field-hint';
    note.textContent =
      'No open review — shown because a NEEDS_REVIEW flag self-resolved (ping-pong visibility).';
    card.appendChild(note);
  }

  if (kind === 'accumulating' || kind === 'bid-pending') {
    const stats = document.createElement('dl');
    stats.className = 'recon-stats';
    stats.append(
      statRow(
        'Cumulative drift (exact)',
        `${formatSignedMinutes(row.cumulative_drift_minutes)} min`,
        'cumulative_drift'
      ),
      statRow(
        'Days remaining in window',
        row.days_remaining == null ? '—' : String(row.days_remaining),
        'window'
      ),
      statRow('Window expires', row.window_expires_date || '—', 'window')
    );
    if (kind === 'bid-pending') {
      stats.append(
        statRow(
          'Sitting in BID_PENDING',
          formatSittingDuration(row.bid_pending_since),
          'bid_pending'
        )
      );
    }
    card.appendChild(stats);

    const changesTitle = document.createElement('h4');
    changesTitle.textContent = 'Contributing changes';
    card.appendChild(changesTitle);
    card.appendChild(renderChangeList(row.contributing_changes));
  }

  if (kind === 'stable') {
    const stats = document.createElement('p');
    stats.className = 'meta';
    const parts = [
      document.createTextNode(
        `Drift ${formatSignedMinutes(row.cumulative_drift_minutes)} min`
      ),
    ];
    if (row.payroll_rounded_total_minutes != null) {
      parts.push(document.createTextNode(' · contracted '));
      const contracted = document.createElement('span');
      contracted.textContent = `${row.payroll_rounded_total_minutes} min`;
      parts.push(contracted);
      const tip = createGlossaryTip('contracted_hours');
      if (tip) parts.push(tip);
    }
    if (row.last_updated) {
      parts.push(
        document.createTextNode(` · updated ${formatWhen(row.last_updated)}`)
      );
    }
    stats.append(...parts);
    card.appendChild(stats);
  }

  if (showSegments && row.segments) {
    const segments = document.createElement('p');
    segments.className = 'meta';
    segments.textContent = ['AM', 'MIDDAY', 'PM']
      .map((seg) => `${seg}: ${row.segments[seg] || '—'}`)
      .join(' · ');
    card.appendChild(segments);
  }

  card.appendChild(renderReviewHistory(row));
  card.appendChild(renderSeeTheMathDetails(row));
  if (
    showNotifyPayroll &&
    kind === 'bid-pending' &&
    row.bid_pending_report
  ) {
    card.appendChild(
      renderNotifyPayrollRow(row, {
        payrollEmailConfigured,
        onPayrollNotified: options.onPayrollNotified,
      })
    );
  }
  if (enableReassign) {
    card.appendChild(renderReassignPanel(row));
  }
  return card;
}

/**
 * @param {object} row
 * @param {{ payrollEmailConfigured?: boolean, onPayrollNotified?: () => void }} [options]
 * @returns {HTMLElement}
 */
function renderNotifyPayrollRow(row, options = {}) {
  const report = row.bid_pending_report;
  const rowEl = document.createElement('div');
  rowEl.className = 'email-draft-row';

  const notifiedAt = report?.payroll_notified_at ?? null;
  if (notifiedAt) {
    const notified = document.createElement('p');
    notified.className = 'meta';
    notified.textContent = `Notified payroll on ${formatWhen(notifiedAt)}`;
    rowEl.appendChild(notified);
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'secondary';
  btn.textContent = 'Notify Payroll';
  const hint = document.createElement('p');
  hint.className = 'field-hint';

  const configured = options.payrollEmailConfigured !== false;
  if (!configured) {
    btn.disabled = true;
    hint.textContent =
      'Payroll email not set — configure in Admin Settings';
    hint.className = 'field-hint warn-text';
  }

  rowEl.append(btn, hint);

  btn.addEventListener('click', async () => {
    if (!report?.id) return;
    btn.disabled = true;
    hint.textContent = '';
    hint.className = 'field-hint';
    try {
      const draft = await fetchJson(
        `/api/routes/${encodeURIComponent(row.route_id)}/change-reports/${encodeURIComponent(report.id)}/payroll-draft`
      );
      if (!draft.can_send) {
        hint.textContent =
          draft.disabled_reason || 'Payroll draft unavailable.';
        hint.className = 'field-hint warn-text';
        btn.disabled = !configured;
        return;
      }
      await fetchJson(
        `/api/routes/${encodeURIComponent(row.route_id)}/change-reports/${encodeURIComponent(report.id)}/payroll-notified`,
        { method: 'POST' }
      );
      window.location.href = draft.mailto_url;
      if (typeof options.onPayrollNotified === 'function') {
        options.onPayrollNotified();
      }
    } catch (error) {
      hint.textContent = error.message;
      hint.className = 'field-hint warn-text';
      btn.disabled = !configured;
    }
  });

  return rowEl;
}

/**
 * @param {object} row
 * @param {{ linkDriver?: boolean }} [options]
 * @returns {HTMLElement}
 */
export function renderPendingChangesCard(row, options = {}) {
  const linkDriver = options.linkDriver !== false;
  const card = document.createElement('article');
  card.className = 'queue-card queue-card-pending';

  const header = document.createElement('header');
  const driverPart = linkDriver
    ? driverLabelHtml(row.driver_id, row.driver_name)
    : assignmentDriverLabel(row.driver_name);
  header.innerHTML = `
    <h3>${row.route_id} · ${driverPart}</h3>
    <p class="meta">
      Status <span class="badge">${row.status}</span>
      · <span class="badge pending">queued behind review</span>
    </p>
  `;
  card.appendChild(header);

  const notice = document.createElement('p');
  notice.className = 'pending-notice';
  notice.textContent =
    'Will process once review is resolved. These changes are held and do not affect live drift yet.';
  card.appendChild(notice);

  const title = document.createElement('h4');
  title.textContent = 'Queued changes';
  card.appendChild(title);
  card.appendChild(renderChangeList(row.pending_changes));
  card.appendChild(renderSeeTheMathDetails(row));
  return card;
}

/**
 * Pick the queue-card kind for a live assignment row.
 * @param {object} row
 * @returns {'needs-review' | 'accumulating' | 'bid-pending' | 'stable'}
 */
export function kindForStatus(row) {
  if (row.status === 'NEEDS_REVIEW' || row.has_self_resolved_review) {
    return 'needs-review';
  }
  if (row.status === 'ACCUMULATING') return 'accumulating';
  if (row.status === 'BID_PENDING') return 'bid-pending';
  return 'stable';
}

/**
 * Finalized Change Report card — reuses see-the-math, does not recompute payroll.
 * @param {object} report
 * @returns {HTMLElement}
 */
export function renderChangeReportCard(report) {
  const card = document.createElement('article');
  card.className = 'queue-card change-report-card';

  const header = document.createElement('header');
  const driverLabel = assignmentDriverLabel(report.driver_name);
  const title = document.createElement('h3');
  title.append(
    document.createTextNode(
      `${report.route_id || '—'} · ${formatReportOutcome(report)}`
    )
  );
  if (report.outcome === 'BID_PENDING') {
    appendGlossaryTip(title, 'bid_pending');
  } else if (report.outcome === 'STABLE') {
    appendGlossaryTip(title, 'lock_in');
  }
  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.innerHTML = `
      Outcome <span class="badge">${report.outcome || '—'}</span>
      · driver ${driverLabel}
      · finalized ${formatWhen(report.finalized_at)}
      ${
        report.window_opened_date
          ? `· window opened ${report.window_opened_date}`
          : ''
      }
    `;
  header.append(title, meta);
  card.appendChild(header);

  if (report.contracted_hours_statement || report.see_the_math?.statement) {
    const statement = document.createElement('p');
    statement.className = 'meta';
    statement.textContent =
      report.contracted_hours_statement || report.see_the_math.statement;
    card.appendChild(statement);
  }

  const changesTitle = document.createElement('h4');
  changesTitle.textContent = 'Contributing changes';
  card.appendChild(changesTitle);
  card.appendChild(renderChangeList(report.contributing_changes ?? []));

  const details = document.createElement('details');
  details.className = 'see-the-math';
  const summary = document.createElement('summary');
  summary.textContent = 'See the math';
  const body = document.createElement('div');
  body.className = 'see-the-math-body';
  renderSeeTheMath(body, report.see_the_math);
  details.append(summary, body);
  card.appendChild(details);

  const emailRow = document.createElement('div');
  emailRow.className = 'email-draft-row';
  const emailBtn = document.createElement('button');
  emailBtn.type = 'button';
  emailBtn.className = 'secondary';
  emailBtn.textContent = 'Draft email to driver';
  const emailHint = document.createElement('p');
  emailHint.className = 'field-hint';
  emailRow.append(emailBtn, emailHint);
  card.appendChild(emailRow);

  emailBtn.addEventListener('click', async () => {
    emailBtn.disabled = true;
    emailHint.textContent = '';
    emailHint.className = 'field-hint';
    try {
      const draft = await fetchJson(
        `/api/routes/${encodeURIComponent(report.route_id)}/change-reports/${encodeURIComponent(report.id)}/email-draft`
      );
      if (!draft.can_send) {
        emailHint.textContent =
          draft.disabled_reason || 'Email draft unavailable.';
        emailHint.className = 'field-hint warn-text';
        return;
      }
      window.location.href = draft.mailto_url;
    } catch (error) {
      emailHint.textContent = error.message;
      emailHint.className = 'field-hint warn-text';
    } finally {
      emailBtn.disabled = false;
    }
  });

  return card;
}
