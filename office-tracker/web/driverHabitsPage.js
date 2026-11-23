import { buildDriverHabits, busForRoute, publishedMinutes, recentWeekdays } from '../src/driverHabits.js';
import { POSTED_ROUTE_BUSES } from '../src/postedRouteBuses.js';
import { fleetKey } from '../src/yardTransitions.js';
import { listProfiles } from './store.js';

const WINDOW = 20;
let bound = false;
let threshold = 20;
let showUnsettled = false;
let selected = '';
let transitions = [];
let loadedDates = new Set();
let running = false;
let started = false;
let generation = 0;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(message, kind = '') {
  const status = document.querySelector('#driver-habits-status');
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || '';
  status.className = `status${kind ? ` is-${kind}` : ''}`;
}

function reportDates() {
  return recentWeekdays(WINDOW);
}

function routeHasPublishedClock(profile, date) {
  return ['AM', 'MIDDAY', 'PM'].some(
    (segment) =>
      publishedMinutes(profile, date, segment, 'in') != null ||
      publishedMinutes(profile, date, segment, 'out') != null
  );
}

function busList() {
  const buses = [];
  try {
    const saved = JSON.parse(localStorage.getItem('the-board-route-buses') || '[]');
    for (const row of Array.isArray(saved) ? saved : []) {
      if (row?.route && row?.bus) buses.push({ route: row.route, bus: row.bus });
    }
  } catch {
    // The yard list is optional. The posted route sheet still works.
  }
  return [...buses, ...POSTED_ROUTE_BUSES];
}

function busesOn(date) {
  const buses = new Set();
  const list = busList();
  for (const profile of listProfiles()) {
    if (!routeHasPublishedClock(profile, date)) continue;
    const bus = busForRoute(list, profile.name);
    if (bus) buses.add(bus);
  }
  return [...buses];
}

function paint(done = false) {
  const body = document.querySelector('#driver-habits-body');
  if (!body) return;
  const dates = reportDates();
  if (!dates.length) {
    body.replaceChildren();
    if (done) setStatus('No weekdays are in this window.');
    return;
  }
  const waiting = dates.some((date) => !loadedDates.has(date));
  const report = {
    transitions,
    profiles: listProfiles(),
    posted: busList(),
    dates,
    showUnsettled,
  };
  const rows = buildDriverHabits({ ...report, threshold });
  if (done && !waiting) {
    const paired = buildDriverHabits({ ...report, threshold: 1 });
    if (!transitions.length) {
      setStatus('Those weekdays did not include a yard leave or return for these routes.');
    } else if (!paired.length) {
      setStatus('No published clock lined up with a yard leave or return. A route with no posted bus is left out.');
    } else {
      setStatus(
        rows.length
          ? `${rows.length} ${rows.length === 1 ? 'clock is' : 'clocks are'} off by at least ${threshold} minutes.`
          : `No published clock is off by ${threshold} minutes or more.`
      );
    }
  }
  const selectedRow = rows.find((row) => row.id === selected);
  body.innerHTML = `${tableHtml(rows)}${selectedRow ? detailHtml(selectedRow) : ''}`;
}

function tableHtml(rows) {
  if (!rows.length) return '';
  const body = rows
    .map((row) => {
      const strip = row.strip
        .map((day) => {
          const gap = day.gap == null ? 'No yard time' : `${day.gap > 0 ? '+' : ''}${day.gap} min`;
          return `<span class="habit-day is-${day.tone}" title="${escapeHtml(`${day.label}: ${gap}`)}"></span>`;
        })
        .join('');
      const note = row.unsettled ? '<div class="habit-unsettled-note">No stable habit</div>' : '';
      return `<tr>
        <td><button type="button" class="habit-open" data-habit-id="${escapeHtml(row.id)}">${escapeHtml(row.route)}</button>${note}</td>
        <td>${escapeHtml(row.driver)}</td>
        <td>${escapeHtml(row.pieceLabel)}</td>
        <td>${escapeHtml(row.publishedLabel)}</td>
        <td>${escapeHtml(row.usualLabel)}</td>
        <td>${escapeHtml(row.habitPhrase)}</td>
        <td>${row.daysOver} of ${row.dayCount}</td>
        <td><span class="habit-strip">${strip}</span></td>
      </tr>`;
    })
    .join('');
  return `<div class="table-wrap"><table class="habit-table">
    <thead>
      <tr>
        <th scope="col">Route</th>
        <th scope="col">Driver</th>
        <th scope="col">Clock</th>
        <th scope="col">Published</th>
        <th scope="col">Usual yard time</th>
        <th scope="col">Compared with published</th>
        <th scope="col">Days over the line</th>
        <th scope="col">Recent days</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function detailHtml(row) {
  const lines = row.observations
    .map((day) => {
      const move = day.yard == null ? 'no yard time' : `${day.yardLabel} ${row.yardKind === 'leave' ? 'left' : 'back'}`;
      const gap = day.gap == null ? '' : ` · ${day.gap > 0 ? '+' : ''}${day.gap} min`;
      return `<p class="habit-day-line"><span>${escapeHtml(day.label)}</span><span>published ${escapeHtml(day.publishedLabel)} · ${escapeHtml(move)}${escapeHtml(gap)}</span></p>`;
    })
    .join('');
  return `<section class="habit-detail" aria-label="${escapeHtml(row.route)} ${escapeHtml(row.pieceLabel)}">
    <h2>Route ${escapeHtml(row.route)} · ${escapeHtml(row.pieceLabel)}</h2>
    ${lines}
  </section>`;
}

function bind() {
  if (bound) return;
  bound = true;
  document.querySelector('.habit-threshold')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-habit-threshold]');
    if (!button) return;
    threshold = Number(button.dataset.habitThreshold) || 20;
    for (const item of document.querySelectorAll('[data-habit-threshold]')) {
      item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
    }
    paint(loadedDates.size > 0 && !running);
  });
  document.querySelector('#driver-habits-unsettled')?.addEventListener('change', (event) => {
    showUnsettled = Boolean(event.target.checked);
    paint(!running);
  });
  document.querySelector('#driver-habits-body')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-habit-id]');
    if (!button) return;
    selected = selected === button.dataset.habitId ? '' : button.dataset.habitId;
    paint(!running);
  });
}

async function load(token) {
  const dates = reportDates();
  for (const date of [...dates].reverse()) {
    if (token !== generation) return;
    if (loadedDates.has(date)) continue;
    const buses = busesOn(date);
    if (!buses.length) {
      loadedDates.add(date);
      continue;
    }
    setStatus(`Reading yard times for ${dateLabel(date)}…`);
    try {
      const response = await fetch(`/api/driver-habits/yard?date=${date}&buses=${buses.map(fleetKey).join(',')}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Yard times are not available right now.');
      transitions.push(...(body.events || []));
      loadedDates.add(date);
      if (token === generation) paint(false);
    } catch (error) {
      if (token !== generation) return;
      setStatus(error.message || 'Yard times are not available right now.', 'error');
      running = false;
      return;
    }
  }
  running = false;
  if (token === generation) paint(true);
}

function dateLabel(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function startDriverHabits() {
  bind();
  if (started) {
    paint(false);
    return;
  }
  started = true;
  running = true;
  const token = ++generation;
  paint(false);
  void load(token);
}
