import {
  emptyMessage,
  renderPendingChangesCard,
  renderRouteCard,
  setReassignRefreshHandler,
} from '../shared/queueRenderers.js';
import { enhanceGlossaryTips } from '../shared/glossaryTip.js';

enhanceGlossaryTips();

const queueStatusEl = document.getElementById('queue-status');
const showStableToggle = document.getElementById('show-stable');
const listStable = document.getElementById('list-stable');

const lists = {
  needsReview: document.getElementById('list-needs-review'),
  accumulating: document.getElementById('list-accumulating'),
  bidPending: document.getElementById('list-bid-pending'),
  pendingChanges: document.getElementById('list-pending-changes'),
  stable: listStable,
};

const counts = {
  needsReview: document.getElementById('count-needs-review'),
  accumulating: document.getElementById('count-accumulating'),
  bidPending: document.getElementById('count-bid-pending'),
  pendingChanges: document.getElementById('count-pending-changes'),
  stable: document.getElementById('count-stable'),
};

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
 * @param {object[]} rows
 * @param {{ payrollEmailConfigured?: boolean }} [options]
 */
function renderQueue(rows, options = {}) {
  const needsReview = rows.filter(
    (row) => row.status === 'NEEDS_REVIEW' || row.has_self_resolved_review
  );
  const accumulating = rows.filter((row) => row.status === 'ACCUMULATING');
  const bidPending = rows.filter((row) => row.status === 'BID_PENDING');
  const pendingBehindReview = rows.filter(
    (row) =>
      row.status === 'NEEDS_REVIEW' && (row.pending_change_ids?.length ?? 0) > 0
  );
  const stable = rows.filter((row) => row.status === 'STABLE');

  counts.needsReview.textContent = String(needsReview.length);
  counts.accumulating.textContent = String(accumulating.length);
  counts.bidPending.textContent = String(bidPending.length);
  counts.pendingChanges.textContent = String(pendingBehindReview.length);
  counts.stable.textContent = String(stable.length);

  const cardOptions = {
    showNotifyPayroll: true,
    payrollEmailConfigured: options.payrollEmailConfigured !== false,
    onPayrollNotified: () => {
      loadQueue().catch((error) =>
        showStatus(queueStatusEl, error.message, 'error')
      );
    },
  };

  fillList(
    lists.needsReview,
    needsReview.map((row) => renderRouteCard(row, 'needs-review', cardOptions)),
    'No routes need review right now.'
  );
  fillList(
    lists.accumulating,
    accumulating.map((row) =>
      renderRouteCard(row, 'accumulating', cardOptions)
    ),
    'No accumulating windows.'
  );
  fillList(
    lists.bidPending,
    bidPending.map((row) => renderRouteCard(row, 'bid-pending', cardOptions)),
    'No bid-pending routes.'
  );
  fillList(
    lists.pendingChanges,
    pendingBehindReview.map((row) => renderPendingChangesCard(row)),
    'No changes queued behind a review.'
  );
  fillList(
    lists.stable,
    stable.map((row) => renderRouteCard(row, 'stable', cardOptions)),
    'No stable routes.'
  );
}

function applyStableVisibility() {
  const show = showStableToggle.checked;
  listStable.hidden = !show;
}

/** @type {{ payroll_email: string, message_template: string } | null} */
let payrollSettings = null;

const payrollEmailInput = document.getElementById('payroll-email');
const payrollTemplateInput = document.getElementById('payroll-template');

async function loadPayrollSettings() {
  payrollSettings = await fetchJson('/api/payroll-settings');
  payrollEmailInput.value = payrollSettings.payroll_email || '';
  payrollTemplateInput.value = payrollSettings.message_template || '';
  return payrollSettings;
}

async function loadQueue() {
  const [rows, settings] = await Promise.all([
    fetchJson('/api/admin/queue'),
    payrollSettings
      ? Promise.resolve(payrollSettings)
      : fetchJson('/api/payroll-settings').then((s) => {
          payrollSettings = s;
          return s;
        }),
  ]);
  renderQueue(rows, {
    payrollEmailConfigured: Boolean(settings?.payroll_email?.trim()),
  });
  applyStableVisibility();
  const active =
    rows.filter((r) => r.status !== 'STABLE').length +
    rows.filter((r) => r.status === 'STABLE' && r.has_self_resolved_review)
      .length;
  showStatus(
    queueStatusEl,
    `Loaded ${rows.length} route${rows.length === 1 ? '' : 's'} · ${active} in active sections.`,
    'ok'
  );
}

showStableToggle.addEventListener('change', applyStableVisibility);

setReassignRefreshHandler(() => {
  loadQueue().catch((error) => {
    showStatus(queueStatusEl, error.message, 'error');
  });
});

const settingsStatusEl = document.getElementById('settings-status');
const calendarList = document.getElementById('calendar-list');
const calendarYear = document.getElementById('calendar-year');
const calendarCount = document.getElementById('calendar-count');
const calendarCoverage = document.getElementById('calendar-coverage');
const calendarNewDate = document.getElementById('calendar-new-date');

/** @type {{ school_year: string | null, school_days?: string[], days?: Array<{date:string,is_school_day:boolean}>, coverage_start?: string, coverage_end?: string }} */
let schoolCalendar = { school_year: null, school_days: [] };

function activeSchoolDays() {
  if (Array.isArray(schoolCalendar.days) && schoolCalendar.days.length) {
    return schoolCalendar.days.filter((d) => d.is_school_day).map((d) => d.date);
  }
  return schoolCalendar.school_days || [];
}

function renderCalendarList() {
  calendarList.innerHTML = '';
  calendarYear.value = schoolCalendar.school_year || '';
  const days = activeSchoolDays();
  const total = schoolCalendar.days?.length ?? days.length;
  calendarCount.textContent = `${days.length} school day${days.length === 1 ? '' : 's'} marked`;
  calendarCoverage.textContent = schoolCalendar.coverage_start
    ? `Coverage ${schoolCalendar.coverage_start} → ${schoolCalendar.coverage_end} (${total} civil days)`
    : '';

  if (!days.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No school days marked yet.';
    calendarList.appendChild(empty);
    return;
  }

  // Newest first for easier snow-day edits near the end of coverage.
  for (const day of [...days].reverse()) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = day;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.textContent = 'Unmark';
    remove.addEventListener('click', async () => {
      try {
        await saveCalendar({
          school_year: calendarYear.value.trim() || null,
          school_days: days.filter((d) => d !== day),
        });
        showStatus(settingsStatusEl, `Unmarked ${day} (no longer a school day).`, 'ok');
        await loadQueue();
      } catch (error) {
        showStatus(settingsStatusEl, error.message, 'error');
      }
    });
    li.append(label, remove);
    calendarList.appendChild(li);
  }
}

async function saveCalendar(next) {
  schoolCalendar = await fetchJson('/api/school-calendar', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  });
  renderCalendarList();
  return schoolCalendar;
}

async function loadCalendar() {
  schoolCalendar = await fetchJson('/api/school-calendar');
  renderCalendarList();
}

document.getElementById('calendar-add').addEventListener('click', async () => {
  try {
    const day = calendarNewDate.value;
    if (!day) throw new Error('Pick a date to mark as a school day.');
    const days = activeSchoolDays();
    if (days.includes(day)) {
      throw new Error(`Already a school day: ${day}`);
    }
    await saveCalendar({
      school_year: calendarYear.value.trim() || null,
      school_days: [...days, day],
    });
    calendarNewDate.value = '';
    showStatus(settingsStatusEl, `Marked ${day} as a school day.`, 'ok');
    await loadQueue();
  } catch (error) {
    showStatus(settingsStatusEl, error.message, 'error');
  }
});

calendarYear.addEventListener('change', async () => {
  try {
    await saveCalendar({
      school_year: calendarYear.value.trim() || null,
      school_days: activeSchoolDays(),
    });
    showStatus(settingsStatusEl, 'School year label updated.', 'ok');
  } catch (error) {
    showStatus(settingsStatusEl, error.message, 'error');
  }
});

Promise.all([loadQueue(), loadCalendar(), loadPayrollSettings()]).catch((error) => {
  showStatus(queueStatusEl, error.message, 'error');
  showStatus(settingsStatusEl, error.message, 'error');
});

document.getElementById('payroll-save').addEventListener('click', async () => {
  try {
    payrollSettings = await fetchJson('/api/payroll-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payroll_email: payrollEmailInput.value,
        message_template: payrollTemplateInput.value,
      }),
    });
    payrollEmailInput.value = payrollSettings.payroll_email || '';
    payrollTemplateInput.value = payrollSettings.message_template || '';
    showStatus(settingsStatusEl, 'Payroll settings saved.', 'ok');
    await loadQueue();
  } catch (error) {
    showStatus(settingsStatusEl, error.message, 'error');
  }
});

// --- Generate a school year ---

const genBreaksEl = document.getElementById('gen-breaks');
const genHolidaysEl = document.getElementById('gen-holidays');
const genPreviewPanel = document.getElementById('gen-preview-panel');
const genPreviewBody = document.getElementById('gen-preview-body');
const genCommitBtn = document.getElementById('gen-commit');

/** @type {object | null} */
let pendingGeneration = null;

function addBreakRow(values = {}) {
  const row = document.createElement('div');
  row.className = 'generate-row';
  row.innerHTML = `
    <label class="field">Start<input type="date" class="gen-break-start" value="${values.start || ''}" /></label>
    <label class="field">End<input type="date" class="gen-break-end" value="${values.end || ''}" /></label>
    <label class="field">Label<input type="text" class="gen-break-label" placeholder="Winter Break" value="${values.label || ''}" /></label>
    <button type="button" class="secondary gen-remove-row">Remove</button>
  `;
  row.querySelector('.gen-remove-row').addEventListener('click', () => row.remove());
  genBreaksEl.appendChild(row);
}

function addHolidayRow(values = {}) {
  const row = document.createElement('div');
  row.className = 'generate-row holiday-row';
  row.innerHTML = `
    <label class="field">Date<input type="date" class="gen-holiday-date" value="${values.date || ''}" /></label>
    <label class="field">Label<input type="text" class="gen-holiday-label" placeholder="Labor Day" value="${values.label || ''}" /></label>
    <button type="button" class="secondary gen-remove-row">Remove</button>
  `;
  row.querySelector('.gen-remove-row').addEventListener('click', () => row.remove());
  genHolidaysEl.appendChild(row);
}

document.getElementById('gen-add-break').addEventListener('click', () => addBreakRow());
document.getElementById('gen-add-holiday').addEventListener('click', () => addHolidayRow());

function collectGenerationInput() {
  const first_day = document.getElementById('gen-first-day').value;
  const last_day = document.getElementById('gen-last-day').value;
  if (!first_day || !last_day) {
    throw new Error('First day and last day of school are required.');
  }

  const breaks = [...genBreaksEl.querySelectorAll('.generate-row')]
    .map((row) => ({
      start: row.querySelector('.gen-break-start').value,
      end: row.querySelector('.gen-break-end').value,
      label: row.querySelector('.gen-break-label').value.trim(),
    }))
    .filter((b) => b.start || b.end || b.label);
  for (const b of breaks) {
    if (!b.start || !b.end) {
      throw new Error('Each break needs both a start and end date.');
    }
  }

  const holidays = [...genHolidaysEl.querySelectorAll('.generate-row')]
    .map((row) => ({
      date: row.querySelector('.gen-holiday-date').value,
      label: row.querySelector('.gen-holiday-label').value.trim(),
    }))
    .filter((h) => h.date || h.label);
  for (const h of holidays) {
    if (!h.date) throw new Error('Each holiday needs a date.');
  }

  return {
    first_day,
    last_day,
    school_year: document.getElementById('gen-school-year').value.trim() || null,
    breaks,
    holidays,
  };
}

function renderGenerationPreview(result) {
  pendingGeneration = {
    input: collectGenerationInput(),
    requires_confirm: result.requires_confirm,
    conflicts: result.conflicts,
  };

  const s = result.summary;
  const c = result.conflicts;
  const boundary = result.coverage_boundary;

  genPreviewBody.innerHTML = '';

  const stats = document.createElement('dl');
  stats.className = 'gen-preview-stats';
  stats.innerHTML = `
    <div><dt>School days</dt><dd>${s.school_day_count}</dd></div>
    <div><dt>Civil days in coverage</dt><dd>${s.civil_day_count}</dd></div>
    <div><dt>Weekends</dt><dd>${s.weekend_count}</dd></div>
    <div><dt>Break days</dt><dd>${s.break_day_count}</dd></div>
    <div><dt>Holiday days</dt><dd>${s.holiday_day_count}</dd></div>
    <div><dt>Outside school year (summer pad)</dt><dd>${s.summer_day_count}</dd></div>
    <div><dt>Coverage</dt><dd>${boundary.coverage_start} → ${boundary.coverage_end}</dd></div>
  `;
  genPreviewBody.appendChild(stats);

  const boundaryNote = document.createElement('p');
  boundaryNote.className = 'field-hint';
  boundaryNote.textContent = boundary.boundary_rule;
  genPreviewBody.appendChild(boundaryNote);

  if (s.breaks_applied?.length) {
    const ul = document.createElement('ul');
    ul.className = 'report-changes';
    for (const b of s.breaks_applied) {
      const li = document.createElement('li');
      li.textContent = `${b.label}: ${b.start} → ${b.end}`;
      ul.appendChild(li);
    }
    const title = document.createElement('h4');
    title.textContent = 'Breaks applied';
    genPreviewBody.append(title, ul);
  }

  if (s.holidays_applied?.length) {
    const ul = document.createElement('ul');
    ul.className = 'report-changes';
    for (const h of s.holidays_applied) {
      const li = document.createElement('li');
      li.textContent = `${h.label}: ${h.date}`;
      ul.appendChild(li);
    }
    const title = document.createElement('h4');
    title.textContent = 'Holidays applied';
    genPreviewBody.append(title, ul);
  }

  if (c?.has_overlap) {
    const box = document.createElement('div');
    box.className = 'gen-conflict-box';
    box.innerHTML = `
      <strong>Overlap with existing calendar</strong>
      <p>${c.overlapping_date_count} date(s) already exist in school-calendar.json
      (${c.differing_count} differ in school-day flag or reason).</p>
      <p class="field-hint">Sample: ${(c.sample_overlapping_dates || []).join(', ') || '—'}</p>
      <p>Committing will replace those overlapping dates with the generated values. Non-overlapping dates are kept.</p>
    `;
    genPreviewBody.appendChild(box);
    genCommitBtn.textContent = 'Replace overlap & commit';
  } else {
    genCommitBtn.textContent = 'Commit to calendar';
  }

  genCommitBtn.hidden = false;
  genPreviewPanel.hidden = false;
}

document.getElementById('gen-preview').addEventListener('click', async () => {
  try {
    const input = collectGenerationInput();
    const result = await fetchJson('/api/school-calendar/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    // Re-store input (collectGenerationInput already validated)
    pendingGeneration = { input, requires_confirm: result.requires_confirm, conflicts: result.conflicts };
    renderGenerationPreview(result);
    showStatus(
      settingsStatusEl,
      result.requires_confirm
        ? 'Preview ready — overlap needs confirmation before commit.'
        : 'Preview ready — review counts, then commit.',
      result.requires_confirm ? 'warn' : 'ok'
    );
  } catch (error) {
    showStatus(settingsStatusEl, error.message, 'error');
  }
});

document.getElementById('gen-cancel-preview').addEventListener('click', () => {
  pendingGeneration = null;
  genPreviewPanel.hidden = true;
  genCommitBtn.hidden = true;
  genPreviewBody.innerHTML = '';
});

document.getElementById('gen-commit').addEventListener('click', async () => {
  try {
    if (!pendingGeneration?.input) {
      throw new Error('Generate a preview first.');
    }
    const body = {
      ...pendingGeneration.input,
      confirm_replace: pendingGeneration.requires_confirm === true,
    };
    const result = await fetchJson('/api/school-calendar/generate/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    schoolCalendar = result.calendar;
    renderCalendarList();
    pendingGeneration = null;
    genPreviewPanel.hidden = true;
    genCommitBtn.hidden = true;
    showStatus(
      settingsStatusEl,
      result.replaced_overlap
        ? `Committed with ${result.conflicts.overlapping_date_count} overlapping date(s) replaced.`
        : `Committed ${result.summary.school_day_count} school days.`,
      'ok'
    );
    await loadQueue();
  } catch (error) {
    showStatus(settingsStatusEl, error.message, 'error');
  }
});
