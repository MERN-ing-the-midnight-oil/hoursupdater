import { localDateString } from '../../employee-tracker/src/clockTimes.js';
import {
  barPercents,
  chartAxis,
  formatClock,
  routeBars,
  segmentInterval,
} from '../../public/board/gantt.js';
import {
  assignRouteCoverage,
  buildCoverageBoard,
  clearRouteCoverage,
  coverageRunLabel,
  normalizeRouteCoverage,
  normalizeRouteCoverageNeeds,
  routeNeedsSubstitute,
  toggleRouteCoverageNeed,
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

function hourTick(minutes) {
  return formatClock(minutes).replace(':00', '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function groupPillsByRoute(pills) {
  const groups = [];
  const index = new Map();
  for (const pill of pills) {
    const key = pill.route_id;
    let group = index.get(key);
    if (!group) {
      group = {
        route_id: pill.route_id,
        route_name: pill.route_name,
        regular_driver_name: pill.regular_driver_name,
        segments: [],
      };
      index.set(key, group);
      groups.push(group);
    }
    group.segments.push(pill);
  }
  return groups;
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

  let jumpFlashTimer = 0;

  root.innerHTML = `
    <div class="route-coverage-desk">
      <div class="route-coverage-head">
        <h2 class="route-coverage-title">Route Coverage Today</h2>
        <p class="route-coverage-lead">
          Tap routes that need a substitute first. Marked routes appear on the day chart and open the assign menus.
        </p>
        <p class="route-coverage-summary" data-coverage-summary></p>
        <form class="route-coverage-jump" data-coverage-jump novalidate>
          <label for="route-coverage-jump-input">Jump to route</label>
          <div class="route-coverage-jump-row">
            <input
              id="route-coverage-jump-input"
              data-coverage-jump-input
              type="text"
              inputmode="numeric"
              autocomplete="off"
              placeholder="Route number"
            />
            <button type="submit">Jump</button>
          </div>
          <p class="route-coverage-jump-status" data-coverage-jump-status role="status" hidden></p>
        </form>
      </div>
      <section class="route-coverage-gantt-panel" data-coverage-gantt aria-label="Needs substitute day chart"></section>
      <div class="route-coverage-pills" data-coverage-pills></div>
      <p class="status" data-coverage-status role="status" hidden></p>
    </div>
  `;

  const pillsEl = root.querySelector('[data-coverage-pills]');
  const ganttEl = root.querySelector('[data-coverage-gantt]');
  const summaryEl = root.querySelector('[data-coverage-summary]');
  const statusEl = root.querySelector('[data-coverage-status]');
  const jumpForm = root.querySelector('[data-coverage-jump]');
  const jumpInput = root.querySelector('[data-coverage-jump-input]');
  const jumpStatus = root.querySelector('[data-coverage-jump-status]');

  function setStatus(message, kind = '') {
    if (!(statusEl instanceof HTMLElement)) return;
    statusEl.hidden = !message;
    statusEl.textContent = message || '';
    statusEl.className = `status${kind ? ` is-${kind}` : ''}`;
  }

  function setJumpStatus(message, kind = '') {
    if (!(jumpStatus instanceof HTMLElement)) return;
    jumpStatus.hidden = !message;
    jumpStatus.textContent = message || '';
    jumpStatus.className = `route-coverage-jump-status${kind ? ` is-${kind}` : ''}`;
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
        segments:
          route.segments && typeof route.segments === 'object' && !Array.isArray(route.segments)
            ? route.segments
            : {},
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

  function saveStatePatch(patch) {
    const state = readState();
    Object.assign(state, patch);
    writeState(state);
    onChange?.();
    refresh();
  }

  function saveCoverage(nextRows) {
    saveStatePatch({ routeCoverage: normalizeRouteCoverage(nextRows) });
  }

  function saveNeeds(nextRows) {
    saveStatePatch({ routeCoverageNeeds: normalizeRouteCoverageNeeds(nextRows) });
  }

  function markRouteNeed(group, needed) {
    try {
      const next = toggleRouteCoverageNeed(readState().routeCoverageNeeds, {
        date: today(),
        route_id: group.route_id,
        route_name: group.route_name,
        needed,
      });
      saveNeeds(next);
      setStatus(
        needed
          ? `Route ${group.route_name} marked as needing a substitute.`
          : `Route ${group.route_name} unmarked.`,
        'ok'
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not update that route.', 'error');
    }
  }

  function assignSegment(pill, substituteId) {
    const route = routes().find((item) => item.id === pill.route_id);
    if (!route) {
      setStatus('That route could not be found.', 'error');
      return;
    }
    if (!substituteId) {
      const next = clearRouteCoverage(readState().routeCoverage, {
        date: today(),
        route_id: pill.route_id,
        run: pill.run,
      });
      saveCoverage(next);
      setStatus(`Cleared ${pill.route_name} ${coverageRunLabel(pill.run)}.`, 'ok');
      return;
    }
    const person = substitutes().find((item) => item.id === substituteId);
    if (!person) {
      setStatus('Choose a substitute driver.', 'error');
      return;
    }
    try {
      const state = readState();
      const nextCoverage = assignRouteCoverage(state.routeCoverage, {
        date: today(),
        route_id: route.id,
        route_name: route.name,
        run: pill.run,
        substitute_id: person.id,
        substitute_name: person.name,
        regular_driver_name: route.regular_driver_name,
      });
      const nextNeeds = routeNeedsSubstitute(state.routeCoverageNeeds, today(), route.id)
        ? state.routeCoverageNeeds
        : toggleRouteCoverageNeed(state.routeCoverageNeeds, {
            date: today(),
            route_id: route.id,
            route_name: route.name,
            needed: true,
          });
      saveStatePatch({
        routeCoverage: normalizeRouteCoverage(nextCoverage),
        routeCoverageNeeds: normalizeRouteCoverageNeeds(nextNeeds),
      });
      setStatus(`Assigned ${person.name} to ${pill.route_name} ${coverageRunLabel(pill.run)}.`, 'ok');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not assign that substitute.', 'error');
      refresh();
    }
  }

  function fillSegmentSelect(select, pill) {
    const roster = substitutes();
    const regularLabel = pill.regular_driver_name
      ? `Regular · ${pill.regular_driver_name}`
      : 'Regular / clear';
    select.replaceChildren();

    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = regularLabel;
    select.append(blank);

    for (const person of roster) {
      const option = document.createElement('option');
      option.value = person.id;
      option.textContent = person.name;
      if (pill.assignment?.substitute_id === person.id) option.selected = true;
      select.append(option);
    }

    if (!roster.length) {
      blank.textContent = pill.assignment
        ? `${pill.assignment.substitute_name} (no roster)`
        : 'No substitute drivers yet';
    }
  }

  function normalizeJumpQuery(value) {
    return String(value || '')
      .trim()
      .replace(/^route\s+/i, '')
      .toLowerCase();
  }

  function focusRouteShell(match) {
    if (!(match instanceof HTMLElement)) return;
    const shells = [
      ...(pillsEl?.querySelectorAll('[data-coverage-route]') || []),
      ...(ganttEl?.querySelectorAll('[data-coverage-gantt-route]') || []),
    ];
    shells.forEach((el) => el.classList.remove('is-jump-target'));
    window.clearTimeout(jumpFlashTimer);
    match.classList.add('is-jump-target');
    match.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusEl =
      match.querySelector('select') ||
      match.querySelector('[data-coverage-toggle]') ||
      match;
    if (focusEl instanceof HTMLElement) {
      focusEl.focus({ preventScroll: true });
    }
    jumpFlashTimer = window.setTimeout(() => {
      match.classList.remove('is-jump-target');
    }, 2200);
  }

  function jumpToRoute(event) {
    event?.preventDefault?.();
    const query = normalizeJumpQuery(jumpInput?.value);
    if (!query) {
      setJumpStatus('Enter a route number.', 'error');
      jumpInput?.focus();
      return;
    }
    const groups = [...(pillsEl?.querySelectorAll('[data-coverage-route]') || [])];
    const match =
      groups.find((el) => normalizeJumpQuery(el.dataset.routeName) === query) ||
      groups.find((el) => normalizeJumpQuery(el.dataset.routeName).startsWith(query));
    if (!match) {
      setJumpStatus(`No route matches “${query}”.`, 'error');
      return;
    }
    setJumpStatus('');
    focusRouteShell(match);
    const ganttRow = ganttEl?.querySelector(
      `[data-coverage-gantt-route][data-route-id="${CSS.escape(match.dataset.routeId || '')}"]`
    );
    if (ganttRow instanceof HTMLElement) {
      ganttRow.classList.add('is-jump-target');
      window.setTimeout(() => ganttRow.classList.remove('is-jump-target'), 2200);
    }
  }

  function barClassForStatus(status, kind) {
    if (status === 'clocked_in' || status === 'regular_in') return 'is-in';
    if (status === 'assigned' || status === 'certified' || kind === 'substitute') return 'is-assigned';
    return 'is-open';
  }

  function renderGantt(neededGroups, routeById) {
    if (!(ganttEl instanceof HTMLElement)) return;
    if (!neededGroups.length) {
      ganttEl.innerHTML = `
        <div class="route-coverage-gantt-empty">
          <h3 class="route-coverage-gantt-title">Needs substitute chart</h3>
          <p>Mark routes below to add them to today’s day chart.</p>
        </div>
      `;
      return;
    }

    const schedules = neededGroups.map((group) => ({
      route_id: group.route_name,
      segments: routeById.get(group.route_id)?.segments || {},
    }));
    const bars = routeBars(schedules);
    const statusByKey = new Map();
    for (const group of neededGroups) {
      for (const pill of group.segments) {
        statusByKey.set(`${group.route_name}|${pill.run}`, pill);
      }
    }

    const axis = chartAxis(bars);
    const ticks = [];
    for (let minute = axis.start; minute <= axis.end; minute += 60) ticks.push(minute);
    const hours = (axis.end - axis.start) / 60;
    const scale = ticks
      .map((minute) => {
        const left = barPercents({ start: minute, end: minute + 1 }, axis).left;
        return `<span class="route-coverage-gantt-tick" style="left:${left}%">${escapeHtml(hourTick(minute))}</span>`;
      })
      .join('');

    const rows = neededGroups
      .map((group) => {
        const routeSegments = routeById.get(group.route_id)?.segments || {};
        const groupBars = ['AM', 'MIDDAY', 'PM']
          .map((run) => {
            const range = routeSegments[run];
            const interval = segmentInterval(run, range);
            if (!interval) return '';
            const pill = statusByKey.get(`${group.route_name}|${run}`);
            const status = pill?.status || 'uncovered';
            const who = pill?.display_name || group.regular_driver_name || 'Unassigned';
            const pos = barPercents(interval, axis);
            const title = `${group.route_name} ${coverageRunLabel(run)} · ${formatClock(interval.start)}–${formatClock(interval.end)} · ${who}`;
            const text = `${runShort(run)} · ${who}`;
            return `<button
              type="button"
              class="route-coverage-gantt-bar ${barClassForStatus(status, pill?.kind)}"
              style="left:${pos.left}%;width:${pos.width}%"
              title="${escapeHtml(title)}"
              data-coverage-gantt-bar
              data-route-id="${escapeHtml(group.route_id)}"
              data-run="${escapeHtml(run)}"
            >${escapeHtml(text)}</button>`;
          })
          .join('');

        const missing = !groupBars
          ? '<span class="route-coverage-gantt-missing">No clock times on file</span>'
          : '';
        const subName =
          group.segments.find((pill) => pill.assignment)?.assignment?.substitute_name || '';
        const labelExtra = subName ? `<span class="route-coverage-gantt-sub">${escapeHtml(subName)}</span>` : '';

        return `<div class="route-coverage-gantt-label" data-coverage-gantt-route data-route-id="${escapeHtml(group.route_id)}" data-route-name="${escapeHtml(group.route_name)}">
            <strong>${escapeHtml(group.route_name)}</strong>
            ${labelExtra}
          </div>
          <div class="route-coverage-gantt-track" style="--hours:${hours}" data-coverage-gantt-route data-route-id="${escapeHtml(group.route_id)}" data-route-name="${escapeHtml(group.route_name)}">
            ${groupBars}${missing}
          </div>`;
      })
      .join('');

    ganttEl.innerHTML = `
      <div class="route-coverage-gantt">
        <div class="route-coverage-gantt-head">
          <h3 class="route-coverage-gantt-title">Needs substitute chart</h3>
          <p class="route-coverage-gantt-legend">
            <span class="route-coverage-swatch is-open"></span> Open
            <span class="route-coverage-swatch is-assigned"></span> Assigned
            <span class="route-coverage-swatch is-in"></span> Clocked in
          </p>
        </div>
        <div class="route-coverage-gantt-scroll">
          <div class="route-coverage-gantt-grid">
            <div class="route-coverage-gantt-label"></div>
            <div class="route-coverage-gantt-scale">${scale}</div>
            ${rows}
          </div>
        </div>
      </div>
    `;

    ganttEl.querySelectorAll('[data-coverage-gantt-bar]').forEach((button) => {
      button.addEventListener('click', () => {
        const routeId = button.getAttribute('data-route-id') || '';
        const run = button.getAttribute('data-run') || '';
        const shell = pillsEl?.querySelector(
          `[data-coverage-route][data-route-id="${CSS.escape(routeId)}"]`
        );
        if (!(shell instanceof HTMLElement)) return;
        focusRouteShell(shell);
        const select = shell.querySelector(`select[data-run="${CSS.escape(run)}"]`);
        if (select instanceof HTMLSelectElement) {
          select.focus({ preventScroll: true });
        }
      });
    });
  }

  function renderSegment(pill, { needsSub, index, total }) {
    const segment = document.createElement('div');
    segment.className = needsSub
      ? `route-coverage-segment is-${pill.kind} is-${pill.status}`
      : 'route-coverage-segment is-drab';
    if (index === 0) segment.classList.add('is-first');
    if (index === total - 1) segment.classList.add('is-last');

    const head = document.createElement('div');
    head.className = 'route-coverage-segment-head';

    const run = document.createElement('span');
    run.className = 'route-coverage-segment-run';
    run.textContent = runShort(pill.run);

    const meta = document.createElement('span');
    meta.className = 'route-coverage-segment-meta';
    meta.textContent = needsSub ? statusLabel(pill.status) : statusLabel(pill.status) || '—';

    head.append(run, meta);

    if (needsSub) {
      const label = document.createElement('label');
      label.className = 'route-coverage-segment-label';
      const labelText = document.createElement('span');
      labelText.className = 'visually-hidden';
      labelText.textContent = `Substitute for route ${pill.route_name} ${coverageRunLabel(pill.run)}`;

      const select = document.createElement('select');
      select.className = 'route-coverage-segment-select';
      select.dataset.routeId = pill.route_id;
      select.dataset.run = pill.run;
      fillSegmentSelect(select, pill);
      select.addEventListener('change', () => assignSegment(pill, select.value));

      label.append(labelText, select);
      segment.append(head, label);
      return segment;
    }

    const who = document.createElement('span');
    who.className = 'route-coverage-segment-who';
    who.textContent = pill.display_name || 'Unassigned';
    segment.append(head, who);
    return segment;
  }

  function renderGroup(group, needsSub) {
    const shell = document.createElement('article');
    shell.className = needsSub
      ? 'route-coverage-route is-needs-sub'
      : 'route-coverage-route is-drab';
    shell.dataset.coverageRoute = '';
    shell.dataset.routeId = group.route_id;
    shell.dataset.routeName = group.route_name;
    shell.dataset.needsSub = needsSub ? '1' : '0';
    shell.tabIndex = -1;

    const number = document.createElement('button');
    number.type = 'button';
    number.className = 'route-coverage-route-number';
    number.dataset.coverageToggle = '';
    number.setAttribute('aria-pressed', needsSub ? 'true' : 'false');
    number.title = needsSub
      ? `Unmark route ${group.route_name} as needing a substitute`
      : `Mark route ${group.route_name} as needing a substitute`;
    number.textContent = group.route_name;
    number.addEventListener('click', () => markRouteNeed(group, !needsSub));

    const body = document.createElement('div');
    body.className = 'route-coverage-route-body';

    const regular = document.createElement('p');
    regular.className = 'route-coverage-route-regular';
    regular.textContent = group.regular_driver_name
      ? `Regular: ${group.regular_driver_name}`
      : 'Regular: Unassigned';

    const mark = document.createElement('p');
    mark.className = 'route-coverage-route-mark';
    mark.textContent = needsSub ? 'Needs substitute · on chart' : 'Tap route number to mark';

    const segments = document.createElement('div');
    segments.className = 'route-coverage-segments';
    segments.dataset.count = String(group.segments.length);

    group.segments.forEach((pill, index) => {
      segments.append(
        renderSegment(pill, {
          needsSub,
          index,
          total: group.segments.length,
        })
      );
    });

    body.append(regular, mark, segments);
    shell.append(number, body);
    return shell;
  }

  function refresh() {
    const state = readState();
    const routeList = routes();
    const routeById = new Map(routeList.map((route) => [route.id, route]));
    const pills = buildCoverageBoard({
      routes: routeList,
      coverage: state.routeCoverage,
      punches: state.punches,
      date: today(),
      now: new Date(),
    });
    const groups = groupPillsByRoute(pills);
    const neededGroups = groups.filter((group) =>
      routeNeedsSubstitute(state.routeCoverageNeeds, today(), group.route_id)
    );
    const covered = pills.filter((pill) => pill.assignment).length;
    const clocked = pills.filter((pill) => pill.clocked_in).length;
    if (summaryEl) {
      summaryEl.textContent = `${groups.length} routes · ${neededGroups.length} marked for substitutes · ${covered} assigned · ${clocked} clocked in`;
    }

    renderGantt(neededGroups, routeById);

    if (!pillsEl) return;
    pillsEl.replaceChildren();
    if (!groups.length) {
      const empty = document.createElement('p');
      empty.className = 'route-coverage-empty';
      empty.textContent = 'No routes on file yet.';
      pillsEl.append(empty);
      return;
    }
    for (const group of groups) {
      const needsSub = routeNeedsSubstitute(state.routeCoverageNeeds, today(), group.route_id);
      pillsEl.append(renderGroup(group, needsSub));
    }
  }

  jumpForm?.addEventListener('submit', jumpToRoute);
  refresh();
  return { refresh, closeAssign() {} };
}
