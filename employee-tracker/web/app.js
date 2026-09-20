import {
  buildSnapshot,
  calendarPayload,
  correctCurrentTimes,
  currentSnapshot,
  deleteChange,
  getAsOfDate,
  importBackup,
  peopleList,
  previewChange,
  recordChange,
  removeCurrentPerson,
  setupProfile,
  startingScheduleFields,
  switchPerson,
  updateChange,
  updateStartingSchedule,
} from './engine.js';
import { exportState, getCurrentProfile } from './store.js';

const RUNS = [
  { id: 'AM', label: 'AM', inName: 'am_in', outName: 'am_out' },
  { id: 'MIDDAY', label: 'Midday', inName: 'midday_in', outName: 'midday_out' },
  { id: 'PM', label: 'PM', inName: 'pm_in', outName: 'pm_out' },
];

const setupView = document.querySelector('#setup-view');
const appView = document.querySelector('#app-view');
const setupRuns = document.querySelector('#setup-runs');
const setupForm = document.querySelector('#setup-form');
const setupStatus = document.querySelector('#setup-status');
const changeForm = document.querySelector('#change-form');
const changeStatus = document.querySelector('#change-status');
const previewBox = document.querySelector('#preview-box');
const hero = document.querySelector('#hero');
const scheduleCards = document.querySelector('#schedule-cards');
const scheduleLead = document.querySelector('#schedule-lead');
const historyList = document.querySelector('#history-list');
const reportList = document.querySelector('#report-list');
const calendarMonths = document.querySelector('#calendar-months');
const calendarPill = document.querySelector('#calendar-pill');
const profileSelect = document.querySelector('#profile_select');
const startEditForm = document.querySelector('#start-edit-form');
const startEditRuns = document.querySelector('#start-edit-runs');
const startEditStatus = document.querySelector('#start-edit-status');
const changeEditForm = document.querySelector('#change-edit-form');
const changeEditStatus = document.querySelector('#change-edit-status');

let snapshot = null;
let addingPerson = false;
let calendarRendered = false;

function toTimeInput(clock) {
  if (!clock) return '';
  const [h, m] = String(clock).split(':');
  return `${String(h).padStart(2, '0')}:${m}`;
}

function prettyDate(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function setStatus(el, message, kind = '') {
  el.hidden = !message;
  el.textContent = message || '';
  el.className = `status${kind ? ` is-${kind}` : ''}`;
}

function renderPeople() {
  const people = peopleList();
  const current = getCurrentProfile();
  profileSelect.innerHTML = '';
  if (!people.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Add a person…';
    profileSelect.append(option);
    return;
  }
  for (const person of people) {
    const option = document.createElement('option');
    option.value = person.id;
    option.textContent = person.name || 'Unnamed';
    profileSelect.append(option);
  }
  if (addingPerson) {
    const option = document.createElement('option');
    option.value = '__new__';
    option.textContent = 'New person…';
    profileSelect.append(option);
    profileSelect.value = '__new__';
  } else if (current) {
    profileSelect.value = current.id;
  }
}

function renderSetupRuns() {
  setupRuns.innerHTML = RUNS.map(
    (run) => `
      <div class="run-card">
        <h3>${run.label}</h3>
        <div class="pair">
          <div class="field">
            <label for="${run.inName}">Clock-in</label>
            <input id="${run.inName}" name="${run.inName}" type="time" step="60" />
          </div>
          <div class="field">
            <label for="${run.outName}">Clock-out</label>
            <input id="${run.outName}" name="${run.outName}" type="time" step="60" />
          </div>
        </div>
      </div>`
  ).join('');
}

function fillChangeFormFromSegment() {
  if (!snapshot?.schedule) return;
  const segment = document.querySelector('#change_segment').value;
  const current = snapshot.schedule[segment];
  document.querySelector('#clock_in').value = current
    ? toTimeInput(current.clock_in)
    : '';
  document.querySelector('#clock_out').value = current
    ? toTimeInput(current.clock_out)
    : '';
}

function renderHero() {
  const windowInfo = snapshot.window;
  const contracted = snapshot.contracted;
  const name = snapshot.employee?.name;
  const outcome = windowInfo?.projected_outcome;
  hero.className = `hero panel${
    outcome === 'BID_PENDING'
      ? ' outcome-bid'
      : outcome === 'BUMP_ELIGIBLE'
        ? ' outcome-bump'
        : ''
  }`;

  const title = windowInfo?.becomes_contracted_on
    ? `Becomes contracted on ${prettyDate(windowInfo.becomes_contracted_on)}`
    : windowInfo?.status === 'STABLE'
      ? 'No open window'
      : windowInfo?.status_label || 'Your hours';

  hero.innerHTML = `
    <p class="hero-kicker">${name ? `${name} · ` : ''}${windowInfo?.status_label || 'Not set up'}</p>
    <h1 class="hero-title">${title}</h1>
    <p class="hero-detail">${windowInfo?.headline || ''}</p>
    <ul class="stat-row">
      <li><span>Contracted hours</span><strong>${contracted?.label || '—'}</strong></li>
      <li><span>Current schedule total</span><strong>${snapshot.scheduled?.exact_label || '—'}</strong></li>
      <li><span>Accumulated difference</span><strong>${windowInfo?.cumulative_drift_label || '0 min'}</strong></li>
      <li><span>School days left in window</span><strong>${
        windowInfo?.days_remaining == null ? '—' : windowInfo.days_remaining
      }</strong></li>
    </ul>
    ${
      windowInfo?.projected_outcome_detail
        ? `<p class="hero-detail">${windowInfo.projected_outcome_detail}</p>`
        : ''
    }
    ${
      windowInfo?.contracted_hours_statement
        ? `<p class="hero-detail">${windowInfo.contracted_hours_statement}</p>`
        : ''
    }
  `;
}

function renderSchedule() {
  const start = snapshot.employee?.start_date;
  scheduleLead.textContent = start
    ? `Starting schedule as of ${prettyDate(start)}. Times below update as soon as you log a change; contracted hours wait for the window to close. Use Correct if you typed a time wrong.`
    : '';
  scheduleCards.innerHTML = RUNS.map((run) => {
    const item = snapshot.schedule?.[run.id];
    if (!item) {
      return `<article class="schedule-card"><h3>${run.label}</h3><p class="muted">Not on your schedule</p></article>`;
    }
    return `<article class="schedule-card" data-segment="${run.id}">
      <h3>${run.label}</h3>
      <p class="times">${item.clock_in} – ${item.clock_out}</p>
      <p class="muted">${item.duration_minutes} min</p>
      <div class="correct-fields" hidden>
        <div class="pair">
          <div class="field">
            <label>Clock-in</label>
            <input class="correct-in" type="time" step="60" value="${toTimeInput(item.clock_in)}" />
          </div>
          <div class="field">
            <label>Clock-out</label>
            <input class="correct-out" type="time" step="60" value="${toTimeInput(item.clock_out)}" />
          </div>
        </div>
        <div class="row-actions">
          <button type="button" class="js-save-correct">Save</button>
          <button type="button" class="secondary js-cancel-correct">Cancel</button>
        </div>
      </div>
      <div class="row-actions">
        <button type="button" class="secondary js-correct-times">Correct these times</button>
      </div>
    </article>`;
  }).join('');
}

function renderHistory() {
  const items = (snapshot.changes || []).filter((change) => !change.is_seed);
  if (!items.length) {
    historyList.innerHTML = '<li class="empty">No clock-time changes yet.</li>';
    return;
  }
  historyList.innerHTML = items
    .map(
      (change) => `<li data-change-id="${change.id}">
        <strong>${prettyDate(change.change_date)} · ${change.segment}</strong>
        <div>${change.previous_time} → ${change.new_time} (${change.delta_label})</div>
        ${change.note ? `<div class="meta">${change.note}</div>` : ''}
        <div class="row-actions">
          <button type="button" class="secondary js-edit-change">Edit</button>
          <button type="button" class="secondary js-delete-change">Remove</button>
        </div>
      </li>`
    )
    .join('');
}

function renderReports() {
  const reports = snapshot.reports || [];
  if (!reports.length) {
    reportList.innerHTML =
      '<li class="empty">No windows have closed yet. That is when changes become contracted.</li>';
    return;
  }
  reportList.innerHTML = reports
    .map((report) => {
      const when = report.finalized_at
        ? prettyDate(String(report.finalized_at).slice(0, 10))
        : '—';
      return `<li>
        <strong>${when} · ${report.outcome_label}</strong>
        <div>${report.contracted_hours_statement || ''}</div>
      </li>`;
    })
    .join('');
}

function renderCalendar() {
  if (calendarRendered) return;
  const calendar = calendarPayload();
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  calendarMonths.innerHTML = (calendar.months || [])
    .map((month) => {
      const first = month.days[0];
      const pad = first ? new Date(`${first.date}T00:00:00Z`).getUTCDay() : 0;
      const blanks = Array.from({ length: pad }, () => '<div class="cal-day"></div>');
      const days = month.days.map((day) => {
        const num = Number(day.date.slice(-2));
        const offReason = day.is_school_day ? '' : day.reason || 'Off';
        const skipLabel =
          !offReason ||
          offReason === 'Weekend' ||
          offReason.startsWith('Outside school year');
        const short =
          !day.is_school_day && !skipLabel
            ? offReason.replace(' (students off)', '')
            : '';
        return `<div class="cal-day ${day.is_school_day ? 'is-school' : 'is-off'}" title="${
          day.is_school_day ? 'School day' : offReason
        }"><span class="num">${num}</span>${
          short ? `<span class="why">${short}</span>` : ''
        }</div>`;
      });
      return `<div class="month-block">
        <h3>${month.label}</h3>
        <div class="month-grid">
          ${dows.map((d) => `<div class="dow">${d}</div>`).join('')}
          ${blanks.join('')}${days.join('')}
        </div>
      </div>`;
    })
    .join('');
  calendarRendered = true;
}

function showSetup(resetForm = false) {
  setupView.hidden = false;
  setupView.setAttribute('aria-hidden', 'false');
  appView.hidden = true;
  if (resetForm) {
    setupForm.reset();
    document.querySelector('#setup_start_date').value = getAsOfDate();
    setStatus(setupStatus, '');
  }
}

function renderApp() {
  renderPeople();
  const ready = Boolean(snapshot?.setup_complete) && !addingPerson;
  if (!ready) {
    showSetup(false);
    return;
  }
  setupView.hidden = true;
  setupView.setAttribute('aria-hidden', 'true');
  appView.hidden = false;
  renderHero();
  renderSchedule();
  renderHistory();
  renderReports();
  renderCalendar();
  fillChangeFormFromSegment();
}

function loadAll() {
  startEditForm.hidden = true;
  changeEditForm.hidden = true;
  snapshot = addingPerson ? buildSnapshot(null) : currentSnapshot();
  calendarPill.textContent = `BPS ${snapshot.calendar?.school_year || '2026-2027'} · ${
    snapshot.calendar?.school_day_count ?? 180
  } school days`;
  if (!document.querySelector('#setup_start_date').value) {
    document.querySelector('#setup_start_date').value = snapshot.as_of || getAsOfDate();
  }
  if (!document.querySelector('#change_date').value) {
    document.querySelector('#change_date').value = snapshot.as_of || getAsOfDate();
  }
  renderApp();
}

function updatePreview() {
  if (!snapshot?.setup_complete || addingPerson) return;
  const clockIn = document.querySelector('#clock_in').value;
  const clockOut = document.querySelector('#clock_out').value;
  const changeDate = document.querySelector('#change_date').value;
  const segment = document.querySelector('#change_segment').value;
  if (!clockIn || !clockOut || !changeDate) {
    previewBox.hidden = true;
    return;
  }
  try {
    const preview = previewChange({
      segment,
      clock_in: clockIn,
      clock_out: clockOut,
      change_date: changeDate,
    });
    previewBox.hidden = false;
    previewBox.innerHTML = `
      <strong>${preview.delta_label}</strong> exact difference
      · window ends <strong>${prettyDate(preview.window_expires_date)}</strong>
      · becomes contracted <strong>${prettyDate(preview.becomes_contracted_on)}</strong>
      · ${preview.projected_outcome_label}
      <div class="meta">${preview.contracted_hours_statement || ''}</div>
    `;
    setStatus(changeStatus, '');
  } catch (error) {
    previewBox.hidden = true;
    setStatus(changeStatus, error.message, 'error');
  }
}

setupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(setupForm));
  try {
    snapshot = setupProfile(data);
    addingPerson = false;
    setStatus(setupStatus, 'Starting times saved on this device.', 'ok');
    loadAll();
  } catch (error) {
    setStatus(setupStatus, error.message, 'error');
  }
});

changeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    snapshot = recordChange({
      segment: document.querySelector('#change_segment').value,
      change_date: document.querySelector('#change_date').value,
      clock_in: document.querySelector('#clock_in').value,
      clock_out: document.querySelector('#clock_out').value,
      note: document.querySelector('#change_note').value,
    });
    setStatus(changeStatus, 'Change recorded on this device.', 'ok');
    document.querySelector('#change_note').value = '';
    renderApp();
    updatePreview();
  } catch (error) {
    setStatus(changeStatus, error.message, 'error');
  }
});

document.querySelector('#change_segment').addEventListener('change', () => {
  fillChangeFormFromSegment();
  updatePreview();
});
document.querySelector('#change-reset').addEventListener('click', () => {
  fillChangeFormFromSegment();
  document.querySelector('#change_note').value = '';
  updatePreview();
});
for (const id of ['clock_in', 'clock_out', 'change_date']) {
  document.querySelector(`#${id}`).addEventListener('change', updatePreview);
}

document.querySelector('#reset-btn').addEventListener('click', () => {
  if (!confirm('Erase this person’s hours from this browser?')) return;
  snapshot = removeCurrentPerson();
  addingPerson = !getCurrentProfile();
  setupForm.reset();
  setStatus(setupStatus, '');
  loadAll();
});

profileSelect.addEventListener('change', () => {
  const id = profileSelect.value;
  if (!id || id === '__new__') {
    return;
  }
  addingPerson = false;
  snapshot = switchPerson(id);
  loadAll();
});

document.querySelector('#add-person-btn').addEventListener('click', () => {
  addingPerson = true;
  showSetup(true);
  renderPeople();
});

document.querySelector('#export-btn').addEventListener('click', () => {
  const blob = new Blob([exportState()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'my-hours-tracker-backup.json';
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelector('#import-btn').addEventListener('click', () => {
  document.querySelector('#import-file').click();
});

function fillStartEditForm() {
  const fields = startingScheduleFields();
  document.querySelector('#start_edit_name').value = fields.name;
  document.querySelector('#start_edit_date').value = fields.start_date;
  startEditRuns.innerHTML = RUNS.map((run) => {
    const item = fields.segments[run.id];
    return `
      <div class="run-card">
        <h3>${run.label}</h3>
        <div class="pair">
          <div class="field">
            <label for="start_edit_${run.inName}">Clock-in</label>
            <input id="start_edit_${run.inName}" name="${run.inName}" type="time" step="60" value="${
              item ? toTimeInput(item.clock_in) : ''
            }" />
          </div>
          <div class="field">
            <label for="start_edit_${run.outName}">Clock-out</label>
            <input id="start_edit_${run.outName}" name="${run.outName}" type="time" step="60" value="${
              item ? toTimeInput(item.clock_out) : ''
            }" />
          </div>
        </div>
      </div>`;
  }).join('');
}

document.querySelector('#edit-start-btn').addEventListener('click', () => {
  fillStartEditForm();
  startEditForm.hidden = false;
  setStatus(startEditStatus, '');
  startEditForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

document.querySelector('#start-edit-cancel').addEventListener('click', () => {
  startEditForm.hidden = true;
  setStatus(startEditStatus, '');
});

startEditForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(startEditForm));
  try {
    snapshot = updateStartingSchedule(data);
    startEditForm.hidden = true;
    setStatus(changeStatus, 'Starting times corrected.', 'ok');
    renderApp();
  } catch (error) {
    setStatus(startEditStatus, error.message, 'error');
  }
});

scheduleCards.addEventListener('click', (event) => {
  const card = event.target.closest('.schedule-card');
  if (!card) return;
  const fields = card.querySelector('.correct-fields');
  if (event.target.closest('.js-correct-times')) {
    if (fields) fields.hidden = false;
    return;
  }
  if (event.target.closest('.js-cancel-correct')) {
    if (fields) fields.hidden = true;
    return;
  }
  if (event.target.closest('.js-save-correct')) {
    try {
      snapshot = correctCurrentTimes({
        segment: card.dataset.segment,
        clock_in: card.querySelector('.correct-in').value,
        clock_out: card.querySelector('.correct-out').value,
      });
      setStatus(changeStatus, 'Clock times corrected.', 'ok');
      renderApp();
    } catch (error) {
      setStatus(changeStatus, error.message, 'error');
    }
  }
});

function openChangeEditor(changeId) {
  const change = (snapshot.changes || []).find((item) => item.id === changeId);
  if (!change) return;
  document.querySelector('#change_edit_id').value = change.id;
  document.querySelector('#change_edit_date').value = change.change_date;
  document.querySelector('#change_edit_segment').textContent = change.segment;
  document.querySelector('#change_edit_in').value = toTimeInput(change.next?.clock_in);
  document.querySelector('#change_edit_out').value = toTimeInput(change.next?.clock_out);
  document.querySelector('#change_edit_note').value = change.note || '';
  changeEditForm.hidden = false;
  setStatus(changeEditStatus, '');
  changeEditForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

historyList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-change-id]');
  if (!row) return;
  const changeId = row.dataset.changeId;
  if (event.target.closest('.js-edit-change')) {
    openChangeEditor(changeId);
    return;
  }
  if (event.target.closest('.js-delete-change')) {
    if (!confirm('Remove this recorded change? The hours math will be rebuilt without it.')) {
      return;
    }
    try {
      snapshot = deleteChange(changeId);
      changeEditForm.hidden = true;
      setStatus(changeStatus, 'Change removed.', 'ok');
      renderApp();
    } catch (error) {
      setStatus(changeStatus, error.message, 'error');
    }
  }
});

changeEditForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    snapshot = updateChange(document.querySelector('#change_edit_id').value, {
      change_date: document.querySelector('#change_edit_date').value,
      clock_in: document.querySelector('#change_edit_in').value,
      clock_out: document.querySelector('#change_edit_out').value,
      note: document.querySelector('#change_edit_note').value,
    });
    changeEditForm.hidden = true;
    setStatus(changeStatus, 'Change corrected.', 'ok');
    renderApp();
  } catch (error) {
    setStatus(changeEditStatus, error.message, 'error');
  }
});

document.querySelector('#change-edit-cancel').addEventListener('click', () => {
  changeEditForm.hidden = true;
  setStatus(changeEditStatus, '');
});

document.querySelector('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    snapshot = importBackup(await file.text());
    addingPerson = false;
    loadAll();
  } catch (error) {
    setStatus(setupStatus, error.message, 'error');
    setupView.hidden = false;
  }
});

renderSetupRuns();
try {
  loadAll();
} catch (error) {
  setStatus(setupStatus, error.message, 'error');
  setupView.hidden = false;
}
