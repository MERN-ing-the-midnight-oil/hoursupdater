import { localDateString } from '../../employee-tracker/src/clockTimes.js';
import {
  assignRouteCoverage,
  buildCoverageBoard,
  clearRouteCoverage,
  coverageRunLabel,
  normalizeRouteCoverage,
} from '../../src/logic/routeCoverage.js';
import { compareRouteNumbers } from './store.js';

function runShort(run) {
  if (run === 'MIDDAY') return 'MID';
  return coverageRunLabel(run) || run;
}

function statusLabel(status) {
  if (status === 'clocked_in') return 'In';
  if (status === 'regular_in') return 'In';
  if (status === 'certified') return 'Certified';
  if (status === 'assigned') return 'Assigned';
  if (status === 'uncovered') return 'Open';
  return '';
}

export function mountRouteCoverageDesk({
  root,
  readState,
  writeState,
  listRoutes,
  listSubstitutes,
  onChange,
}) {
  if (!(root instanceof HTMLElement)) {
    return { refresh() {} };
  }

  let selectedRouteId = '';
  let selectedRun = '';

  root.innerHTML = `
    <div class="route-coverage-desk">
      <div class="route-coverage-head">
        <h2 class="route-coverage-title">Route Coverage Today</h2>
        <p class="route-coverage-lead">
          Assign substitutes by route run. This list is the source of truth for who is covering which route today.
        </p>
        <p class="route-coverage-summary" data-coverage-summary></p>
      </div>
      <div class="route-coverage-pills" data-coverage-pills></div>
      <form class="route-coverage-assign" data-coverage-form hidden>
        <p class="route-coverage-assign-label" data-coverage-assign-label></p>
        <label>
          Substitute driver
          <select data-coverage-sub required>
            <option value="">Choose a substitute</option>
          </select>
        </label>
        <div class="route-coverage-assign-actions">
          <button type="submit">Assign substitute</button>
          <button type="button" class="secondary" data-coverage-clear>Clear assignment</button>
          <button type="button" class="secondary" data-coverage-cancel>Cancel</button>
        </div>
        <p class="status" data-coverage-status role="status" hidden></p>
      </form>
    </div>
  `;

  const pillsEl = root.querySelector('[data-coverage-pills]');
  const summaryEl = root.querySelector('[data-coverage-summary]');
  const form = root.querySelector('[data-coverage-form]');
  const assignLabel = root.querySelector('[data-coverage-assign-label]');
  const subSelect = root.querySelector('[data-coverage-sub]');
  const statusEl = root.querySelector('[data-coverage-status]');
  const clearBtn = root.querySelector('[data-coverage-clear]');
  const cancelBtn = root.querySelector('[data-coverage-cancel]');

  function setStatus(message, kind = '') {
    if (!(statusEl instanceof HTMLElement)) return;
    statusEl.hidden = !message;
    statusEl.textContent = message || '';
    statusEl.className = `status${kind ? ` is-${kind}` : ''}`;
  }

  function today() {
    return localDateString();
  }

  function routes() {
    return (typeof listRoutes === 'function' ? listRoutes() : [])
      .map((route) => ({
        id: String(route.id || '').trim(),
        name: String(route.name || '').trim(),
        regular_driver_name: String(route.regular_driver_name || route.driver_name || '').trim(),
        clockRuns: Array.isArray(route.clockRuns) ? route.clockRuns : [],
        clockIns: Array.isArray(route.clockIns) ? route.clockIns : [],
      }))
      .filter((route) => route.id && route.name)
      .sort((a, b) => compareRouteNumbers(a.name, b.name));
  }

  function substitutes() {
    return (typeof listSubstitutes === 'function' ? listSubstitutes() : [])
      .map((person) => ({
        id: String(person.id || person.driver_id || '').trim(),
        name: String(person.name || '').trim(),
      }))
      .filter((person) => person.id && person.name)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  }

  function fillSubstituteOptions(selectedId = '') {
    if (!(subSelect instanceof HTMLSelectElement)) return;
    const roster = substitutes();
    subSelect.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = roster.length ? 'Choose a substitute' : 'No substitute drivers yet';
    subSelect.append(blank);
    for (const person of roster) {
      const option = document.createElement('option');
      option.value = person.id;
      option.textContent = person.name;
      if (person.id === selectedId) option.selected = true;
      subSelect.append(option);
    }
  }

  function openAssign(pill) {
    selectedRouteId = pill.route_id;
    selectedRun = pill.run;
    if (assignLabel) {
      assignLabel.textContent = `Route ${pill.route_name} · ${coverageRunLabel(pill.run)} · Regular: ${
        pill.regular_driver_name || 'Unassigned'
      }`;
    }
    fillSubstituteOptions(pill.assignment?.substitute_id || '');
    if (form) form.hidden = false;
    setStatus('');
    subSelect?.focus();
  }

  function closeAssign() {
    selectedRouteId = '';
    selectedRun = '';
    if (form) form.hidden = true;
    setStatus('');
  }

  function saveCoverage(nextRows) {
    const state = readState();
    state.routeCoverage = normalizeRouteCoverage(nextRows);
    writeState(state);
    onChange?.();
    refresh();
  }

  function onAssign(event) {
    event.preventDefault();
    const route = routes().find((item) => item.id === selectedRouteId);
    if (!route || !selectedRun) {
      setStatus('Choose a route run first.', 'error');
      return;
    }
    const subId = subSelect instanceof HTMLSelectElement ? subSelect.value : '';
    const person = substitutes().find((item) => item.id === subId);
    if (!person) {
      setStatus('Choose a substitute driver.', 'error');
      return;
    }
    try {
      const next = assignRouteCoverage(readState().routeCoverage, {
        date: today(),
        route_id: route.id,
        route_name: route.name,
        run: selectedRun,
        substitute_id: person.id,
        substitute_name: person.name,
        regular_driver_name: route.regular_driver_name,
      });
      saveCoverage(next);
      closeAssign();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not assign that substitute.', 'error');
    }
  }

  function onClear() {
    if (!selectedRouteId || !selectedRun) return;
    const next = clearRouteCoverage(readState().routeCoverage, {
      date: today(),
      route_id: selectedRouteId,
      run: selectedRun,
    });
    saveCoverage(next);
    closeAssign();
  }

  function refresh() {
    const state = readState();
    const pills = buildCoverageBoard({
      routes: routes(),
      coverage: state.routeCoverage,
      punches: state.punches,
      date: today(),
      now: new Date(),
    });
    const uncovered = pills.filter((pill) => pill.status === 'uncovered').length;
    const covered = pills.filter((pill) => pill.assignment).length;
    const clocked = pills.filter((pill) => pill.clocked_in).length;
    if (summaryEl) {
      summaryEl.textContent = `${pills.length} runs · ${covered} covered by substitutes · ${clocked} clocked in · ${uncovered} open`;
    }
    if (!pillsEl) return;
    pillsEl.replaceChildren();
    if (!pills.length) {
      const empty = document.createElement('p');
      empty.className = 'route-coverage-empty';
      empty.textContent = 'No routes on file yet.';
      pillsEl.append(empty);
      return;
    }
    for (const pill of pills) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `route-coverage-pill is-${pill.kind} is-${pill.status}`;
      button.dataset.routeId = pill.route_id;
      button.dataset.run = pill.run;
      const route = document.createElement('span');
      route.className = 'route-coverage-pill-route';
      route.textContent = `${pill.route_name} · ${runShort(pill.run)}`;
      const who = document.createElement('span');
      who.className = 'route-coverage-pill-who';
      who.textContent = pill.display_name || 'Unassigned';
      const meta = document.createElement('span');
      meta.className = 'route-coverage-pill-meta';
      meta.textContent = statusLabel(pill.status);
      button.append(route, who, meta);
      button.addEventListener('click', () => openAssign(pill));
      pillsEl.append(button);
    }
  }

  form?.addEventListener('submit', onAssign);
  clearBtn?.addEventListener('click', onClear);
  cancelBtn?.addEventListener('click', closeAssign);

  refresh();
  return { refresh, closeAssign };
}
