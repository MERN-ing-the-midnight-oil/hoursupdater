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
import {
  appendGlossaryTip,
  createGlossaryTip,
  createStatusBadge,
} from './glossaryTip.js';
import { setLabeledIcon } from './icons.js';
import { openMailto } from './openMailto.js';

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
 * Latest Change Report finalized_at for a given outcome (original window close).
 * @param {object} row
 * @param {string | null | undefined} outcome
 * @returns {string | null}
 */
function priorOutcomeFinalizedAt(row, outcome) {
  if (!outcome) return null;
  const reports = (row.change_reports ?? []).filter(
    (report) => report.outcome === outcome
  );
  if (!reports.length) return null;
  return reports[reports.length - 1].finalized_at ?? null;
}

/**
 * Plain-language ADJUSTMENT delta for the contradiction narrative.
 * @param {object | null | undefined} adj
 * @returns {string}
 */
function formatAdjustmentCorrectionPhrase(adj) {
  if (!adj) return 'details not available';
  const previous = adj.previous_delta;
  const next = adj.new_delta;
  const net = adj.delta_minutes;
  if (previous == null || next == null || net == null) {
    return adj.note?.trim() || adj.reason || 'details not available';
  }
  return `the recorded change was ${previous} min, corrected to ${next} min — a net change of ${formatSignedMinutes(net)} min`;
}

/**
 * Plain-language contradiction summary with clickable status badges.
 * @param {object} row
 * @param {object} recon
 * @returns {HTMLElement}
 */
function renderContradictionNarrative(row, recon) {
  const p = document.createElement('p');
  p.className = 'recon-narrative';

  const finalizedAt = priorOutcomeFinalizedAt(
    row,
    recon.previous_finalized_status
  );
  const correctionAt =
    row.causing_adjustment?.adjusted_at ?? recon.raised_at ?? null;

  p.append(
    document.createTextNode(`On ${formatWhen(finalizedAt)}, this route was decided to be `)
  );
  p.appendChild(createStatusBadge(recon.previous_finalized_status));
  p.append(
    document.createTextNode(
      `. On ${formatWhen(correctionAt)}, a correction was made: ${formatAdjustmentCorrectionPhrase(row.causing_adjustment)}. Using the corrected numbers, this route would now be `
    )
  );
  p.appendChild(createStatusBadge(recon.computed_status));
  p.append(document.createTextNode(' instead.'));
  return p;
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
    } else if (change.type === 'SENIORITY_TIE_RESOLUTION') {
      li.innerHTML = `
        <div><strong>${change.start_date || '—'}</strong> · SENIORITY TIE (lots)</div>
        <div class="meta">
          Hired ${change.previous_time || '—'} → ${change.new_time || '—'}
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
  setLabeledIcon(summary, 'calculator', 'See the math');
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
  const entries = (row.review_history ?? []).filter(
    (item) =>
      item.event === 'NEEDS_REVIEW_SELF_RESOLVED' ||
      item.event === 'NEEDS_REVIEW_ADMIN_RESOLVED'
  );
  if (!entries.length) return document.createDocumentFragment();

  const wrap = document.createElement('div');
  wrap.className = 'review-history';
  const title = document.createElement('h4');
  title.textContent = options.includeRoute
    ? `Review history · ${row.route_id || '—'}`
    : 'Review history';
  wrap.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'report-changes';
  for (const item of entries) {
    const li = document.createElement('li');
    const adjustment = (row.related_adjustments ?? []).find(
      (adj) => adj.id === item.causing_adjustment_id
    );
    const adminBits =
      item.event === 'NEEDS_REVIEW_ADMIN_RESOLVED'
        ? ` · ${item.resolution || '—'}${
            item.resolved_by ? ` by ${item.resolved_by}` : ''
          }`
        : '';
    li.innerHTML = `
      <div><strong>${item.event}</strong> · ${formatWhen(item.resolved_at)}${adminBits}</div>
      <div class="meta">
        Flag raised ${item.previous_flag_raised_at ? formatWhen(item.previous_flag_raised_at) : '—'}
        · causing adjustment ${item.causing_adjustment_id || '—'}
      </div>
      ${item.note ? `<div class="meta">${item.note}</div>` : ''}
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
  setLabeledIcon(label, 'user', 'Assign to');
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
 * @param {{ electronicBidSignupEnabled?: boolean }} [options]
 * @returns {HTMLElement}
 */
export function renderReassignPanel(row, options = {}) {
  const electronic = options.electronicBidSignupEnabled === true;
  const eligible =
    electronic &&
    row.status === 'BID_PENDING' &&
    Array.isArray(row.bid_signup?.eligible_responders)
      ? row.bid_signup.eligible_responders
      : null;
  const awaitingFinalize =
    electronic &&
    row.status === 'BID_PENDING' &&
    !row.bid_signup?.finalized_at;

  const details = document.createElement('details');
  details.className = 'reassign-panel';
  const summary = document.createElement('summary');
  setLabeledIcon(
    summary,
    eligible || awaitingFinalize ? 'award' : 'user-cog',
    eligible || awaitingFinalize ? 'Award bid / reassign' : 'Reassign route'
  );
  details.appendChild(summary);

  const form = document.createElement('form');
  form.className = 'reassign-form';
  form.noValidate = true;

  const hint = document.createElement('p');
  hint.className = 'field-hint';
  if (awaitingFinalize) {
    hint.textContent =
      'Electronic sign-up is on — wait until the 2-school-day window closes so the Forms list can finalize before awarding the bid.';
  } else if (eligible) {
    hint.textContent =
      'Award only from drivers who initialed in time (Forms record, seniority order). This is the official sign-up sheet.';
  } else {
    hint.textContent =
      'Changes who currently holds this route. Does not reset the window, drift, or countdown.';
  }
  form.appendChild(hint);

  const status = document.createElement('p');
  status.className = 'status';
  status.setAttribute('role', 'status');

  const pickerHost = document.createElement('div');
  /** @type {ReturnType<typeof buildDriverReassignCombobox> | null} */
  let picker = null;

  /** @type {HTMLSelectElement | null} */
  let eligibleSelect = null;
  if (eligible) {
    const field = document.createElement('label');
    field.className = 'field';
    field.appendChild(document.createTextNode('Eligible responder (seniority order)'));
    eligibleSelect = document.createElement('select');
    eligibleSelect.required = true;
    eligibleSelect.innerHTML = `<option value="">Select awardee…</option>`;
    if (!eligible.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No eligible responders (none initialed in time)';
      eligibleSelect.appendChild(opt);
      eligibleSelect.disabled = true;
    } else {
      for (const r of eligible) {
        const opt = document.createElement('option');
        opt.value = r.driver_id;
        opt.textContent = `#${r.seniority_rank ?? '—'} ${r.name} · initials ${r.initials}`;
        eligibleSelect.appendChild(opt);
      }
    }
    field.appendChild(eligibleSelect);
    pickerHost.appendChild(field);
  }

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

  /** @type {HTMLLabelElement | null} */
  let bidAwardLabel = null;
  /** @type {HTMLInputElement | null} */
  let bidAwardCheck = null;
  if (row.status === 'BID_PENDING' && !eligible) {
    bidAwardLabel = document.createElement('label');
    bidAwardLabel.className = 'field checkbox-field';
    bidAwardCheck = document.createElement('input');
    bidAwardCheck.type = 'checkbox';
    bidAwardCheck.name = 'bid_awarded';
    bidAwardLabel.append(
      bidAwardCheck,
      document.createTextNode(' This reassignment awards the pending bid')
    );
  }

  const actions = document.createElement('div');
  actions.className = 'reassign-actions';
  const submit = document.createElement('button');
  submit.type = 'submit';
  setLabeledIcon(
    submit,
    eligible ? 'award' : 'user-cog',
    eligible ? 'Award bid' : 'Save reassignment'
  );
  if (awaitingFinalize || (eligible && !eligible.length)) {
    submit.disabled = true;
  }
  actions.appendChild(submit);

  form.append(pickerHost, staffField, noteField);
  if (bidAwardLabel) form.appendChild(bidAwardLabel);
  form.append(actions, status);
  details.appendChild(form);

  details.addEventListener('toggle', async () => {
    if (!details.open) return;
    if (eligible) {
      if (staffSelect.options.length > 1) return;
      try {
        const staffNames = await loadStaffNames();
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
      return;
    }
    if (picker) return;
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
    /** @type {{ unassigned: boolean, driver_id: string | null }} */
    let selection;
    /** @type {'routine' | 'bid_awarded'} */
    let resolution = 'routine';

    if (eligible) {
      const driverId = eligibleSelect?.value?.trim() || '';
      if (!driverId) {
        status.textContent = 'Select an eligible responder to award.';
        status.className = 'status visible error';
        return;
      }
      selection = { unassigned: false, driver_id: driverId };
      resolution = 'bid_awarded';
    } else {
      if (!picker) {
        status.textContent = 'Driver list is still loading.';
        status.className = 'status visible error';
        return;
      }
      selection = picker.getSelection();
      if (!selection.unassigned && !selection.driver_id) {
        status.textContent =
          'Pick a driver from the list, or choose Unassigned.';
        status.className = 'status visible error';
        return;
      }
      resolution = bidAwardCheck?.checked ? 'bid_awarded' : 'routine';
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
            resolution,
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

/** Open accumulation window length in school days. */
const WINDOW_SCHOOL_DAYS = 15;

/**
 * Compact summary for collapsed Accumulating cards: route, driver, days left + bar.
 * @param {object} row
 * @param {boolean} linkDriver
 * @returns {HTMLElement}
 */
function renderAccumulatingCompactSummary(row, linkDriver) {
  const summary = document.createElement('summary');
  summary.className = 'queue-card-compact';

  const identity = document.createElement('div');
  identity.className = 'queue-card-compact-identity';
  const title = document.createElement('h3');
  const driverPart = linkDriver
    ? driverLabelHtml(row.driver_id, row.driver_name)
    : assignmentDriverLabel(row.driver_name);
  title.innerHTML = `${row.route_id} · ${driverPart}`;
  for (const link of title.querySelectorAll('a')) {
    link.addEventListener('click', (event) => event.stopPropagation());
  }
  identity.appendChild(title);

  const windowMeta = document.createElement('div');
  windowMeta.className = 'queue-card-compact-window';

  const days =
    typeof row.days_remaining === 'number' && Number.isFinite(row.days_remaining)
      ? Math.max(0, row.days_remaining)
      : null;
  const daysLabel = document.createElement('span');
  daysLabel.className = 'queue-card-compact-days';
  if (days == null) {
    daysLabel.textContent = 'School days remaining —';
  } else if (days === 1) {
    daysLabel.textContent = '1 school day remaining';
  } else {
    daysLabel.textContent = `${days} school days remaining`;
  }

  const clamped = days == null ? 0 : Math.min(days, WINDOW_SCHOOL_DAYS);
  const bar = document.createElement('div');
  bar.className = 'window-days-progress';
  if (days != null && days <= 3) bar.classList.add('is-urgent');
  else if (days != null && days <= 7) bar.classList.add('is-soon');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(WINDOW_SCHOOL_DAYS));
  bar.setAttribute('aria-valuenow', String(clamped));
  bar.setAttribute(
    'aria-label',
    days == null
      ? 'School days remaining unknown'
      : `${clamped} of ${WINDOW_SCHOOL_DAYS} school days remaining`
  );
  const track = document.createElement('div');
  track.className = 'window-days-progress-track';
  track.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < WINDOW_SCHOOL_DAYS; i += 1) {
    const day = document.createElement('span');
    day.className = 'window-days-progress-day';
    if (i < clamped) day.classList.add('is-filled');
    track.appendChild(day);
  }
  bar.appendChild(track);

  windowMeta.append(daysLabel, bar);
  summary.append(identity, windowMeta);
  return summary;
}

/**
 * @param {object} row
 * @param {'needs-review' | 'accumulating' | 'bid-pending' | 'bump-eligible' | 'stable'} kind
 * @param {{
 *   linkDriver?: boolean,
 *   showSegments?: boolean,
 *   enableReassign?: boolean,
 *   showNotifyPayroll?: boolean,
 *   payrollEmailConfigured?: boolean,
 *   onPayrollNotified?: () => void,
 *   onOpenBidNotified?: () => void,
 *   onReviewResolved?: () => void,
 *   onBumpDecided?: () => void,
 *   electronicBidSignupEnabled?: boolean,
 *   paperBidSignupEnabled?: boolean,
 * }} [options]
 */
export function renderRouteCard(row, kind, options = {}) {
  const linkDriver = options.linkDriver !== false;
  const showSegments = options.showSegments === true;
  const enableReassign =
    options.enableReassign !== false && kind !== 'bump-eligible';
  const electronicBidSignupEnabled = options.electronicBidSignupEnabled === true;
  const paperBidSignupEnabled = options.paperBidSignupEnabled === true;
  const isAccumulating = kind === 'accumulating';
  const card = document.createElement(isAccumulating ? 'details' : 'article');
  card.className = 'queue-card';
  if (isAccumulating) {
    card.classList.add('queue-card-accumulating');
  }
  if (kind === 'needs-review' && row.status !== 'NEEDS_REVIEW') {
    card.classList.add('queue-card-self-resolved');
  }

  if (isAccumulating) {
    card.appendChild(renderAccumulatingCompactSummary(row, linkDriver));
  } else {
    const header = document.createElement('header');
    const title = document.createElement('h3');
    const driverPart = linkDriver
      ? driverLabelHtml(row.driver_id, row.driver_name)
      : assignmentDriverLabel(row.driver_name);
    title.innerHTML = `${row.route_id} · ${driverPart}`;
    header.appendChild(title);

    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.append(document.createTextNode('Stage '), createStatusBadge(row.status));
    if (kind === 'needs-review' && row.status !== 'NEEDS_REVIEW') {
      meta.append(document.createTextNode(' · '));
      const selfBadge = document.createElement('span');
      selfBadge.className = 'badge badge-self-resolved';
      selfBadge.textContent = 'self-resolved recently';
      meta.appendChild(selfBadge);
    }
    header.appendChild(meta);
    card.appendChild(header);
  }

  if (kind === 'needs-review' && row.reconciliation) {
    const recon = row.reconciliation;
    const block = document.createElement('div');
    block.className = 'recon-block';

    const heading = document.createElement('h4');
    setLabeledIcon(heading, 'git-compare', 'Contradiction');
    block.appendChild(heading);

    block.appendChild(renderContradictionNarrative(row, recon));

    const stats = document.createElement('dl');
    stats.className = 'recon-stats';
    stats.append(
      statRow(
        'Computed accumulated time difference',
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

    const resolveRow = document.createElement('div');
    resolveRow.className = 'review-resolve-row';

    const staffField = document.createElement('label');
    staffField.className = 'field';
    staffField.appendChild(document.createTextNode('Resolved by'));
    const staffSelect = document.createElement('select');
    staffSelect.required = true;
    staffSelect.innerHTML = `<option value="">Select…</option>`;
    staffField.appendChild(staffSelect);

    const noteField = document.createElement('label');
    noteField.className = 'field';
    noteField.appendChild(document.createTextNode('Note'));
    const noteInput = document.createElement('textarea');
    noteInput.required = true;
    noteInput.rows = 2;
    noteInput.placeholder = 'Why are you keeping prior / accepting computed?';
    noteField.appendChild(noteInput);

    const actions = document.createElement('div');
    actions.className = 'email-draft-row';
    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    setLabeledIcon(acceptBtn, 'check', 'Accept computed status');
    const keepBtn = document.createElement('button');
    keepBtn.type = 'button';
    keepBtn.className = 'secondary';
    setLabeledIcon(keepBtn, 'lock', 'Keep prior finalized');
    const resolveHint = document.createElement('p');
    resolveHint.className = 'field-hint';
    actions.append(acceptBtn, keepBtn, resolveHint);
    resolveRow.append(staffField, noteField, actions);
    card.appendChild(resolveRow);

    loadStaffNames()
      .then((staffNames) => {
        for (const name of staffNames) {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          staffSelect.appendChild(opt);
        }
      })
      .catch((error) => {
        resolveHint.textContent = error.message;
        resolveHint.className = 'field-hint warn-text';
      });

    const runResolve = async (resolution) => {
      if (!staffSelect.value.trim()) {
        resolveHint.textContent = 'Resolved by is required.';
        resolveHint.className = 'field-hint warn-text';
        return;
      }
      if (!noteInput.value.trim()) {
        resolveHint.textContent = 'Note is required.';
        resolveHint.className = 'field-hint warn-text';
        return;
      }
      acceptBtn.disabled = true;
      keepBtn.disabled = true;
      resolveHint.textContent = '';
      try {
        const result = await fetchJson(
          `/api/routes/${encodeURIComponent(row.route_id)}/resolve-review`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              resolution,
              note: noteInput.value.trim(),
              resolved_by: staffSelect.value.trim(),
            }),
          }
        );
        resolveHint.textContent = result.message || 'Resolved.';
        resolveHint.className = 'field-hint';
        if (typeof options.onReviewResolved === 'function') {
          options.onReviewResolved();
        }
      } catch (error) {
        resolveHint.textContent = error.message;
        resolveHint.className = 'field-hint warn-text';
        acceptBtn.disabled = false;
        keepBtn.disabled = false;
      }
    };
    acceptBtn.addEventListener('click', () => runResolve('accept_computed'));
    keepBtn.addEventListener('click', () => runResolve('keep_prior'));

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

  if (
    kind === 'accumulating' ||
    kind === 'bid-pending' ||
    kind === 'bump-eligible'
  ) {
    const stats = document.createElement('dl');
    stats.className = 'recon-stats';
    stats.append(
      statRow(
        'Accumulated time difference',
        `${formatSignedMinutes(row.cumulative_drift_minutes)} min`,
        'cumulative_drift'
      ),
      statRow(
        'School days remaining in window',
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
        ),
        statRow(
          'Sign-up due',
          row.bid_response_due_date || '—',
          'bid_pending'
        )
      );
    }
    if (kind === 'bump-eligible') {
      stats.append(
        statRow(
          'Bump decision due',
          row.bump_decision_due_date || '—',
          'bump_eligible'
        ),
        statRow(
          'Sitting in BUMP_ELIGIBLE',
          formatSittingDuration(row.bid_pending_since),
          'bump_eligible'
        )
      );
      if (row.bump_chain_id) {
        stats.append(
          statRow(
            'Vacancy chain',
            `link ${row.bump_chain_link ?? 1} of an ongoing vacancy chain`
          )
        );
      }
      if (row.bump_kind === 'displacement') {
        stats.append(statRow('Decision type', 'Displacement chain'));
      }
    }
    card.appendChild(stats);

    const changesTitle = document.createElement('h4');
    setLabeledIcon(changesTitle, 'list', 'Contributing changes');
    card.appendChild(changesTitle);
    card.appendChild(renderChangeList(row.contributing_changes));
  }

  if (kind === 'stable') {
    const stats = document.createElement('p');
    stats.className = 'meta';
    const parts = [];
    if (row.payroll_rounded_total_minutes != null) {
      parts.push(
        document.createTextNode(
          'Route schedule rounds to current contract hours'
        )
      );
      parts.push(document.createTextNode(' · contracted '));
      const contracted = document.createElement('span');
      contracted.textContent = `${row.payroll_rounded_total_minutes} min`;
      parts.push(contracted);
      const tip = createGlossaryTip('contracted_hours');
      if (tip) parts.push(tip);
    }
    if (row.last_updated) {
      if (parts.length) parts.push(document.createTextNode(' · '));
      parts.push(
        document.createTextNode(`updated ${formatWhen(row.last_updated)}`)
      );
    }
    if (parts.length) {
      stats.append(...parts);
      card.appendChild(stats);
    }
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
  if (kind === 'bid-pending' && electronicBidSignupEnabled) {
    card.appendChild(
      renderOpenBidSignupPanel(row, {
        onOpenBidNotified: options.onOpenBidNotified,
      })
    );
  }
  if (kind === 'bid-pending' && paperBidSignupEnabled) {
    card.appendChild(renderPaperBidSignupPanel(row));
  }
  if (kind === 'bump-eligible') {
    card.appendChild(
      renderBumpDecisionPanel(row, { onBumpDecided: options.onBumpDecided })
    );
  }
  if (enableReassign) {
    card.appendChild(
      renderReassignPanel(row, { electronicBidSignupEnabled })
    );
  }
  return card;
}

/**
 * Admin bump decision UI — reminders only; never auto-resolves.
 * @param {object} row
 * @param {{ onBumpDecided?: () => void }} [options]
 * @returns {HTMLElement}
 */
function renderBumpDecisionPanel(row, options = {}) {
  const panel = document.createElement('div');
  panel.className = 'bump-decision-panel';

  const isDisplacement = row.bump_kind === 'displacement';
  const overdue = row.bump_decision_overdue === true;

  if (overdue) {
    const banner = document.createElement('div');
    banner.className = 'bump-overdue-banner';
    banner.setAttribute('role', 'status');
    const text = document.createElement('p');
    text.textContent = isDisplacement
      ? 'Driver has not responded in 2 school days. Office practice is to default to Unassigned — mark this resolved that way?'
      : 'Driver has not responded in 2 school days. Office practice is to default to keeping the current assignment — mark this resolved that way?';
    banner.appendChild(text);
    panel.appendChild(banner);
  }

  const heading = document.createElement('h4');
  heading.textContent = isDisplacement
    ? 'Displacement decision'
    : 'Bump decision';
  panel.appendChild(heading);

  const lead = document.createElement('p');
  lead.className = 'field-hint';
  lead.textContent = isDisplacement
    ? 'Admin must choose: elect to bump someone junior, or accept Unassigned. The app will not decide this on its own.'
    : 'Admin must choose: keep the current assignment, or elect to bump a less-senior driver. The app will not decide this on its own.';
  panel.appendChild(lead);

  const form = document.createElement('div');
  form.className = 'review-resolve-row';

  const staffField = document.createElement('label');
  staffField.className = 'field';
  staffField.appendChild(document.createTextNode('Decided by'));
  const staffSelect = document.createElement('select');
  staffSelect.required = true;
  staffSelect.innerHTML = `<option value="">Select…</option>`;
  staffField.appendChild(staffSelect);

  const noteField = document.createElement('label');
  noteField.className = 'field';
  noteField.appendChild(document.createTextNode('Note'));
  const noteInput = document.createElement('textarea');
  noteInput.required = true;
  noteInput.rows = 2;
  noteInput.placeholder = 'Record why this decision is being logged.';
  noteField.appendChild(noteInput);

  const targetField = document.createElement('label');
  targetField.className = 'field';
  targetField.hidden = true;
  targetField.appendChild(document.createTextNode('Bump target (junior driver)'));
  const targetSelect = document.createElement('select');
  targetSelect.innerHTML = `<option value="">Select target…</option>`;
  targetField.appendChild(targetSelect);

  const actions = document.createElement('div');
  actions.className = 'email-draft-row';

  const keepBtn = document.createElement('button');
  keepBtn.type = 'button';
  setLabeledIcon(
    keepBtn,
    isDisplacement ? 'check' : 'anchor',
    isDisplacement ? 'Accept Unassigned' : 'Keep current assignment'
  );

  const electBtn = document.createElement('button');
  electBtn.type = 'button';
  electBtn.className = 'secondary';
  setLabeledIcon(electBtn, 'arrow-down-up', 'Elect to bump…');

  const confirmElectBtn = document.createElement('button');
  confirmElectBtn.type = 'button';
  setLabeledIcon(confirmElectBtn, 'check', 'Confirm bump');
  confirmElectBtn.hidden = true;

  const cancelElectBtn = document.createElement('button');
  cancelElectBtn.type = 'button';
  cancelElectBtn.className = 'secondary';
  setLabeledIcon(cancelElectBtn, 'x', 'Cancel');
  cancelElectBtn.hidden = true;

  const reminderKeepBtn = document.createElement('button');
  reminderKeepBtn.type = 'button';
  reminderKeepBtn.className = 'secondary';
  setLabeledIcon(
    reminderKeepBtn,
    'check',
    isDisplacement
      ? 'Confirm default: Unassigned'
      : 'Confirm default: keep assignment'
  );
  reminderKeepBtn.hidden = !overdue;

  const hint = document.createElement('p');
  hint.className = 'field-hint';

  actions.append(keepBtn, electBtn, confirmElectBtn, cancelElectBtn);
  if (overdue) actions.appendChild(reminderKeepBtn);
  actions.appendChild(hint);

  form.append(staffField, noteField, targetField, actions);
  panel.appendChild(form);

  /** @type {{ route_id: string, driver_id: string, driver_name: string }[]} */
  let targets = [];

  loadStaffNames()
    .then((staffNames) => {
      for (const name of staffNames) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        staffSelect.appendChild(opt);
      }
    })
    .catch((error) => {
      hint.textContent = error.message;
      hint.className = 'field-hint warn-text';
    });

  const requireAttribution = () => {
    if (!staffSelect.value.trim()) {
      hint.textContent = 'Decided by is required.';
      hint.className = 'field-hint warn-text';
      return false;
    }
    if (!noteInput.value.trim()) {
      hint.textContent = 'Note is required.';
      hint.className = 'field-hint warn-text';
      return false;
    }
    return true;
  };

  const setBusy = (busy) => {
    keepBtn.disabled = busy;
    electBtn.disabled = busy;
    confirmElectBtn.disabled = busy;
    cancelElectBtn.disabled = busy;
    reminderKeepBtn.disabled = busy;
  };

  const submitDecision = async (decision) => {
    if (!requireAttribution()) return;
    /** @type {Record<string, unknown>} */
    const body = {
      decision,
      decided_by: staffSelect.value.trim(),
      note: noteInput.value.trim(),
    };
    if (decision === 'elect_bump') {
      const raw = targetSelect.value;
      if (!raw) {
        hint.textContent = 'Select a junior driver to bump.';
        hint.className = 'field-hint warn-text';
        return;
      }
      const [route_id, driver_id] = raw.split('::');
      body.target_route_id = route_id;
      body.target_driver_id = driver_id;
    }
    setBusy(true);
    hint.textContent = '';
    try {
      const result = await fetchJson(
        `/api/routes/${encodeURIComponent(row.route_id)}/bump-decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      hint.textContent = result.message || 'Recorded.';
      hint.className = 'field-hint';
      if (typeof options.onBumpDecided === 'function') {
        options.onBumpDecided();
      } else if (typeof reassignRefreshHandler === 'function') {
        reassignRefreshHandler();
      }
    } catch (error) {
      hint.textContent = error.message;
      hint.className = 'field-hint warn-text';
      setBusy(false);
    }
  };

  keepBtn.addEventListener('click', () => {
    submitDecision(isDisplacement ? 'accept_unassigned' : 'keep_assignment');
  });
  reminderKeepBtn.addEventListener('click', () => {
    submitDecision(isDisplacement ? 'accept_unassigned' : 'keep_assignment');
  });

  electBtn.addEventListener('click', async () => {
    electBtn.hidden = true;
    keepBtn.hidden = true;
    reminderKeepBtn.hidden = true;
    targetField.hidden = false;
    confirmElectBtn.hidden = false;
    cancelElectBtn.hidden = false;
    hint.textContent = 'Loading eligible junior drivers…';
    try {
      const data = await fetchJson(
        `/api/routes/${encodeURIComponent(row.route_id)}/bump-targets`
      );
      targets = data.targets ?? [];
      targetSelect.innerHTML = `<option value="">Select target…</option>`;
      if (!targets.length) {
        hint.textContent =
          'No eligible junior drivers currently hold a route (or hire dates are missing).';
        hint.className = 'field-hint warn-text';
        return;
      }
      for (const t of targets) {
        const opt = document.createElement('option');
        opt.value = `${t.route_id}::${t.driver_id}`;
        opt.textContent = `${t.driver_name} · ${t.route_id}${
          t.hire_date ? ` · hired ${t.hire_date}` : ''
        }`;
        targetSelect.appendChild(opt);
      }
      hint.textContent =
        'Only drivers with less seniority than the electing driver are listed.';
      hint.className = 'field-hint';
    } catch (error) {
      hint.textContent = error.message;
      hint.className = 'field-hint warn-text';
    }
  });

  cancelElectBtn.addEventListener('click', () => {
    electBtn.hidden = false;
    keepBtn.hidden = false;
    reminderKeepBtn.hidden = !overdue;
    targetField.hidden = true;
    confirmElectBtn.hidden = true;
    cancelElectBtn.hidden = true;
    hint.textContent = '';
  });

  confirmElectBtn.addEventListener('click', () => {
    submitDecision('elect_bump');
  });

  return panel;
}

/**
 * Paper open-bid sign-up sheet (printable).
 * @param {object} row
 * @returns {HTMLElement}
 */
function renderPaperBidSignupPanel(row) {
  const panel = document.createElement('div');
  panel.className = 'bid-signup-panel paper-bid-panel';

  const heading = document.createElement('h4');
  setLabeledIcon(heading, 'printer', 'Paper bid sign-up');
  panel.appendChild(heading);

  const meta = document.createElement('p');
  meta.className = 'meta';
  const start = row.paper_bid_start_date
    ? `Start date ${row.paper_bid_start_date}`
    : 'Start date not set yet';
  const due = row.bid_response_due_date
    ? ` · sign-up due ${row.bid_response_due_date}`
    : '';
  meta.textContent = `${start}${due}`;
  panel.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'email-draft-row';
  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'secondary';
  setLabeledIcon(printBtn, 'printer', 'Open sign-up sheet');
  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent =
    'Opens the printable sheet. Set the route start date there before printing. Drivers more senior than the current holder print in bold.';
  actions.append(printBtn, hint);
  panel.appendChild(actions);

  printBtn.addEventListener('click', () => {
    const url = `/admin/paper-bid-sheet.html?route_id=${encodeURIComponent(row.route_id)}`;
    window.open(url, '_blank', 'noopener');
  });

  return panel;
}

/**
 * Electronic open-bid posting + Forms Excel sign-up (read-only external file).
 * @param {object} row
 * @param {{ onOpenBidNotified?: () => void }} [options]
 * @returns {HTMLElement}
 */
function renderOpenBidSignupPanel(row, options = {}) {
  const panel = document.createElement('div');
  panel.className = 'bid-signup-panel';

  const heading = document.createElement('h4');
  setLabeledIcon(heading, 'file-signature', 'Open bid sign-up');
  panel.appendChild(heading);

  const meta = document.createElement('p');
  meta.className = 'meta';
  const due = row.bid_response_due_date || '—';
  const notified = row.bid_signup?.drivers_notified_at
    ? ` · drivers notified ${formatWhen(row.bid_signup.drivers_notified_at)}`
    : '';
  meta.textContent = row.bid_response_closed
    ? `Sign-up window closed (due ${due})${notified}`
    : `Sign-up open until ${due}${notified}`;
  panel.appendChild(meta);

  const file = row.bid_signup_file;
  const fileStatus = file?.status ?? null;
  if (fileStatus === 'schema_error' || fileStatus === 'unreadable') {
    const err = document.createElement('p');
    err.className = 'field-hint warn-text';
    err.textContent =
      file?.message ||
      'Bid sign-up file has an unexpected shape. Fix it in Forms/Excel — this app never writes that file.';
    panel.appendChild(err);
  } else if (fileStatus === 'missing' || fileStatus === 'empty') {
    const calm = document.createElement('p');
    calm.className = 'field-hint';
    calm.textContent = 'No sign-up responses found yet.';
    panel.appendChild(calm);
  } else if (fileStatus === 'ok' && Array.isArray(file.responses)) {
    const forRoute = file.responses.filter(
      (r) =>
        String(r.route_id || '')
          .trim()
          .toLowerCase() ===
        String(row.route_id || '')
          .trim()
          .toLowerCase()
    );
    if (!forRoute.length && !row.bid_signup?.finalized_at) {
      const calm = document.createElement('p');
      calm.className = 'field-hint';
      calm.textContent = 'No sign-up responses found yet.';
      panel.appendChild(calm);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'email-draft-row';
  const notifyBtn = document.createElement('button');
  notifyBtn.type = 'button';
  notifyBtn.className = 'secondary';
  setLabeledIcon(notifyBtn, 'bell', 'Notify drivers');
  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent =
    'CC entire driver directory. Responses live in the Microsoft Forms → Excel file (read-only here). Correct names/routes in the Form itself.';
  actions.append(notifyBtn, hint);
  panel.appendChild(actions);

  notifyBtn.addEventListener('click', async () => {
    notifyBtn.disabled = true;
    hint.textContent = '';
    hint.className = 'field-hint';
    try {
      const draft = await fetchJson(
        `/api/routes/${encodeURIComponent(row.route_id)}/open-bid-draft`
      );
      if (!draft.can_send) {
        hint.textContent = draft.disabled_reason || 'Draft unavailable.';
        hint.className = 'field-hint warn-text';
        notifyBtn.disabled = false;
        return;
      }
      await fetchJson(
        `/api/routes/${encodeURIComponent(row.route_id)}/open-bid-notified`,
        { method: 'POST' }
      );
      openMailto(draft.mailto_url);
      if (draft.missing_email_count) {
        hint.textContent = `Opened draft with ${draft.cc_count} CC — ${draft.missing_email_count} driver(s) have no email.`;
      } else {
        hint.textContent = `Opened draft with ${draft.cc_count} driver CC.`;
      }
      if (typeof options.onOpenBidNotified === 'function') {
        options.onOpenBidNotified();
      }
    } catch (error) {
      hint.textContent = error.message;
      hint.className = 'field-hint warn-text';
      notifyBtn.disabled = false;
    }
  });

  const responders = row.bid_signup?.eligible_responders;
  const matchIssues = row.bid_signup?.match_issues;
  const listWrap = document.createElement('div');
  listWrap.className = 'bid-signup-responders';
  const listTitle = document.createElement('h4');
  if (row.bid_signup?.finalized_at && Array.isArray(responders)) {
    listTitle.textContent = `Eligible responders (finalized) · ${responders.length}`;
    listWrap.appendChild(listTitle);
    if (!responders.length) {
      const empty = document.createElement('p');
      empty.className = 'field-hint warn-text';
      empty.textContent =
        'No matched drivers initialed in time — treated as rejections per Art. 3.08(c)(1).';
      listWrap.appendChild(empty);
    } else {
      const ol = document.createElement('ol');
      ol.className = 'bid-responder-list';
      for (const r of responders) {
        const li = document.createElement('li');
        li.textContent = `#${r.seniority_rank ?? '—'} ${r.name} · initials ${r.initials} · ${formatWhen(r.signed_at)}`;
        ol.appendChild(li);
      }
      listWrap.appendChild(ol);
    }
    if (Array.isArray(matchIssues) && matchIssues.length) {
      const issueTitle = document.createElement('h4');
      issueTitle.textContent = 'Email matches needing Admin attention';
      listWrap.appendChild(issueTitle);
      const ul = document.createElement('ul');
      ul.className = 'bid-match-issues';
      for (const issue of matchIssues) {
        const li = document.createElement('li');
        li.className = 'warn-text';
        const who = issue.form_name
          ? `${issue.form_name} <${issue.form_email || '—'}>`
          : issue.form_email || '—';
        const tip =
          issue.suggestions?.length > 0
            ? ` · matches multiple directory records: ${issue.suggestions.join(', ')}`
            : '';
        li.textContent =
          issue.kind === 'ambiguous'
            ? `Ambiguous Forms email for ${who} (${issue.initials})${tip}. Fix emails in the driver directory — this app does not edit Form responses.`
            : `Unmatched Forms email for ${who} (${issue.initials}). Add that email to the driver directory (or confirm they used the expected M365 address).`;
        ul.appendChild(li);
      }
      listWrap.appendChild(ul);
    }
  } else if (fileStatus === 'schema_error' || fileStatus === 'unreadable') {
    listTitle.textContent = 'Eligible list';
    listWrap.appendChild(listTitle);
    const pending = document.createElement('p');
    pending.className = 'field-hint warn-text';
    pending.textContent =
      'Cannot finalize until the Forms workbook columns match Email, Name, Route ID, Initials, and Completion time.';
    listWrap.appendChild(pending);
  } else if (!row.bid_response_closed) {
    listTitle.textContent = 'Eligible list';
    listWrap.appendChild(listTitle);
    const pending = document.createElement('p');
    pending.className = 'field-hint';
    pending.textContent =
      'Finalized after the due date from the Forms workbook — non-responders count as rejections. Eligibility matches Forms Email (M365 sign-in) to the driver directory; Name is shown for confirmation only.';
    listWrap.appendChild(pending);
  } else {
    listTitle.textContent = 'Eligible list';
    listWrap.appendChild(listTitle);
    const pending = document.createElement('p');
    pending.className = 'field-hint';
    pending.textContent =
      fileStatus === 'missing' || fileStatus === 'empty'
        ? 'Window closed — no sign-up responses found yet. List finalizes empty once the next rebuild runs.'
        : 'Window closed — list finalizes on the next rebuild from the Forms file in _app_data (read-only).';
    listWrap.appendChild(pending);
  }
  panel.appendChild(listWrap);

  return panel;
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
  setLabeledIcon(btn, 'mail', 'Notify Payroll');
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
      openMailto(draft.mailto_url);
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
  const title = document.createElement('h3');
  title.innerHTML = `${row.route_id} · ${driverPart}`;
  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.append(document.createTextNode('Stage '), createStatusBadge(row.status));
  meta.append(document.createTextNode(' · '));
  const pendingBadge = document.createElement('span');
  pendingBadge.className = 'badge pending';
  pendingBadge.textContent = 'queued behind review';
  meta.appendChild(pendingBadge);
  header.append(title, meta);
  card.appendChild(header);

  const notice = document.createElement('p');
  notice.className = 'pending-notice';
  notice.textContent =
    'Will process once review is resolved. These changes are held and do not affect live drift yet.';
  card.appendChild(notice);

  const queuedHeading = document.createElement('h4');
  setLabeledIcon(queuedHeading, 'layers', 'Queued changes');
  card.appendChild(queuedHeading);
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
  if (row.status === 'BUMP_ELIGIBLE') return 'bump-eligible';
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
  } else if (report.outcome === 'BUMP_ELIGIBLE') {
    appendGlossaryTip(title, 'bump_eligible');
  } else if (report.outcome === 'STABLE') {
    appendGlossaryTip(title, 'lock_in');
  }
  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.append(document.createTextNode('Outcome '), createStatusBadge(report.outcome || '—'));
  meta.append(
    document.createTextNode(
      ` · driver ${driverLabel} · finalized ${formatWhen(report.finalized_at)}`
    )
  );
  if (report.window_opened_date) {
    meta.append(
      document.createTextNode(` · window opened ${report.window_opened_date}`)
    );
  }
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
  setLabeledIcon(changesTitle, 'list', 'Contributing changes');
  card.appendChild(changesTitle);
  card.appendChild(renderChangeList(report.contributing_changes ?? []));

  const details = document.createElement('details');
  details.className = 'see-the-math';
  const summary = document.createElement('summary');
  setLabeledIcon(summary, 'calculator', 'See the math');
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
  setLabeledIcon(emailBtn, 'mail', 'Draft email to driver');
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
      openMailto(draft.mailto_url);
    } catch (error) {
      emailHint.textContent = error.message;
      emailHint.className = 'field-hint warn-text';
    } finally {
      emailBtn.disabled = false;
    }
  });

  return card;
}
