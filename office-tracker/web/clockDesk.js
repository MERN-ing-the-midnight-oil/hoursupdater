/**
 * Office clock. A signed-in person records a driver's clock in or clock out.
 * The records stay on the shared office and feed the payroll spreadsheet.
 */

import { formatClockAmPm } from '../../employee-tracker/src/clockTimes.js';
import {
  PAYROLL_HEADERS,
  formatQuarterHours,
  payrollDriverRows,
  payrollRowsForDriver,
} from '../src/payrollTimes.js';
import { compareRouteNumbers } from './store.js';

/**
 * @param {{
 *   readState: () => { punches?: object[], profiles?: object },
 *   writePunches: (punches: object[]) => void,
 *   listNames: () => string[],
 *   asOf?: () => string,
 * }} options
 */
export function mountClockDesk({ readState, writePunches, listNames, asOf }) {
  const driverSelect = document.querySelector('#clock-driver');
  const timeInput = document.querySelector('#clock-time');
  const noteInput = document.querySelector('#clock-note');
  const status = document.querySelector('#clock-status');
  const table = document.querySelector('#clock-records tbody');
  if (!driverSelect || !timeInput || !noteInput || !status || !table) {
    return { refresh() {} };
  }

  const reasonSelect = document.querySelector('#clock-reason');
  const reasonPicks = document.querySelector('#clock-reason-picks');
  const driverList = document.querySelector('#clock-driver-list');
  const driverSheet = document.querySelector('#clock-driver-sheet');
  const driverSheetTitle = document.querySelector('#clock-driver-sheet-title');
  const payrollHead = document.querySelector('#clock-payroll-sheet thead tr');
  const payrollBody = document.querySelector('#clock-payroll-sheet tbody');
  /** @type {string[]} */
  let draftReasonIds = [];
  /** @type {string} */
  let openDriver = '';

  document.querySelector('#clock-driver-sheet-close')?.addEventListener('click', () => {
    openDriver = '';
    refresh();
  });
  driverList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-driver-name]');
    if (!button) return;
    const name = button.getAttribute('data-driver-name') || '';
    openDriver = openDriver === name ? '' : name;
    refresh();
    if (openDriver) driverSheet?.scrollIntoView({ block: 'nearest' });
  });

  document.querySelector('#clock-in')?.addEventListener('click', () => record('in'));
  document.querySelector('#clock-out')?.addEventListener('click', () => record('out'));
  document.querySelector('#clock-add-reason')?.addEventListener('click', () => {
    const id = reasonSelect?.value || '';
    if (!id || draftReasonIds.includes(id)) return;
    draftReasonIds.push(id);
    renderReasonPicks();
  });
  table.addEventListener('click', (event) => {
    const button = event.target.closest('[data-punch-id]');
    if (!button) return;
    const id = button.getAttribute('data-punch-id');
    const punches = punchesFromState().filter((punch) => punch.id !== id);
    writePunches(punches);
    setStatus('Record removed.');
    refresh();
  });

  function punchesFromState() {
    return Array.isArray(readState()?.punches) ? readState().punches : [];
  }

  function setStatus(message) {
    status.hidden = !message;
    status.textContent = message || '';
  }

  function localStamp(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fillDrivers() {
    const current = driverSelect.value;
    const names = [...new Set(listNames().map((name) => String(name || '').trim()).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    driverSelect.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choose a driver';
    driverSelect.append(blank);
    for (const name of names) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      driverSelect.append(option);
    }
    if (names.includes(current)) driverSelect.value = current;
  }

  function routesFor(name) {
    const wanted = String(name || '').trim().toLowerCase();
    /** @type {string[]} */
    const routes = [];
    for (const profile of Object.values(readState()?.profiles || {})) {
      if (String(profile?.driver_name || '').trim().toLowerCase() !== wanted) continue;
      const route = String(profile?.name || '').trim();
      if (route) routes.push(route);
    }
    return routes.sort(compareRouteNumbers);
  }

  function renderDriverList() {
    if (!driverList) return;
    const names = [...new Set(listNames().map((name) => String(name || '').trim()).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    if (openDriver && !names.some((name) => name === openDriver)) openDriver = '';
    driverList.replaceChildren();
    for (const name of names) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `secondary clock-driver${name === openDriver ? ' is-open' : ''}`;
      button.dataset.driverName = name;
      button.setAttribute('aria-expanded', name === openDriver ? 'true' : 'false');
      const label = document.createElement('span');
      label.textContent = name;
      const routes = document.createElement('span');
      routes.className = 'clock-driver-routes';
      const routeList = routesFor(name);
      routes.textContent = routeList.length ? routeList.join(', ') : 'No route';
      button.append(label, routes);
      item.append(button);
      if (name === openDriver && driverSheet) item.append(driverSheet);
      driverList.append(item);
    }
    if (!openDriver && driverSheet) driverList.after(driverSheet);
  }

  function payrollCell(row, header) {
    if (header === 'Email') return row.email || '';
    if (header === 'First name') return row.firstName || '';
    if (header === 'Last name') return row.lastName || '';
    if (header === 'Route number') return row.route || '';
    if (header === 'Contract started') return contractDate(row.contractStarted);
    if (header === 'Contracted AM clock in') return clockLabel(row.amIn);
    if (header === 'Contracted AM clock out') return clockLabel(row.amOut);
    if (header === 'AM quarter-hour clocks') return row.amQuarterClocks || '';
    if (header === 'AM total minutes') return minutesLabel(row.amTotalMinutes);
    if (header === 'AM rounded quarter hours') return formatQuarterHours(row.amRoundedQuarterHours);
    if (header === 'Contracted midday clock in') return clockLabel(row.middayIn);
    if (header === 'Contracted midday clock out') return clockLabel(row.middayOut);
    if (header === 'Mid Day quarter-hour clocks') return row.middayQuarterClocks || '';
    if (header === 'Mid Day total minutes') return minutesLabel(row.middayTotalMinutes);
    if (header === 'Mid Day rounded quarter hours') return formatQuarterHours(row.middayRoundedQuarterHours);
    if (header === 'Contracted PM clock in') return clockLabel(row.pmIn);
    if (header === 'Contracted PM clock out') return clockLabel(row.pmOut);
    if (header === 'PM quarter-hour clocks') return row.pmQuarterClocks || '';
    if (header === 'PM total minutes') return minutesLabel(row.pmTotalMinutes);
    if (header === 'PM rounded quarter hours') return formatQuarterHours(row.pmRoundedQuarterHours);
    if (header === 'Full Day rounded quarter hours') return formatQuarterHours(row.fullDayRoundedQuarterHours);
    return '';
  }

  function clockLabel(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    return formatClockAmPm(text);
  }

  function minutesLabel(value) {
    if (value == null || value === '') return '';
    const number = Number(value);
    return Number.isFinite(number) ? String(Math.round(number)) : '';
  }

  function contractDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
    if (!match) return '';
    return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
  }

  function renderPayrollSheet() {
    if (!driverSheet || !payrollHead || !payrollBody) return;
    const open = Boolean(openDriver);
    driverSheet.hidden = !open;
    if (!open) return;
    if (driverSheetTitle) driverSheetTitle.textContent = openDriver;
    if (driverSelect.value !== openDriver) driverSelect.value = openDriver;
    payrollHead.replaceChildren();
    for (const header of PAYROLL_HEADERS) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = header;
      payrollHead.append(cell);
    }
    const rows = payrollRowsForDriver(
      payrollDriverRows(readState(), { asOf: asOf?.() }),
      openDriver
    );
    payrollBody.replaceChildren();
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = PAYROLL_HEADERS.length;
      cell.textContent = 'This driver has no payroll row.';
      row.append(cell);
      payrollBody.append(row);
      return;
    }
    for (const payrollRow of rows) {
      const row = document.createElement('tr');
      for (const header of PAYROLL_HEADERS) {
        const cell = document.createElement('td');
        cell.textContent = payrollCell(payrollRow, header);
        row.append(cell);
      }
      payrollBody.append(row);
    }
  }

  function renderRows() {
    const punches = [...punchesFromState()]
      .filter(
        (punch) =>
          !openDriver ||
          String(punch.driver_name || '').trim().toLowerCase() === openDriver.trim().toLowerCase()
      )
      .sort((a, b) => String(b.punched_at).localeCompare(String(a.punched_at)));
    table.replaceChildren();
    if (!punches.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = openDriver ? 'No clock records for this driver yet.' : 'No clock records yet.';
      row.append(cell);
      table.append(row);
      return;
    }
    for (const punch of punches) {
      const when = new Date(punch.punched_at);
      const row = document.createElement('tr');
      for (const text of [
        Number.isNaN(when.getTime())
          ? ''
          : when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
        punch.substitute_name
          ? `${punch.action === 'out' ? 'Clock out' : 'Clock in'} · ${punch.substitute_name}`
          : punch.action === 'out'
            ? 'Clock out'
            : 'Clock in',
        punch.note || '',
        (Array.isArray(punch.reason_codes) ? punch.reason_codes : [])
          .map((code) => code.label)
          .filter(Boolean)
          .join(', '),
      ]) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.append(cell);
      }
      const action = document.createElement('td');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.dataset.punchId = punch.id;
      remove.textContent = 'Remove';
      action.append(remove);
      row.append(action);
      table.append(row);
    }
  }

  function record(action) {
    const driver_name = driverSelect.value.trim();
    const when = timeInput.value;
    if (!driver_name) {
      setStatus('Choose a driver.');
      return;
    }
    const punched = new Date(when);
    if (!when || Number.isNaN(punched.getTime())) {
      setStatus('Choose a time.');
      return;
    }
    const punches = [
      ...punchesFromState(),
      {
        id: crypto.randomUUID(),
        driver_name,
        action,
        punched_at: punched.toISOString(),
        note: noteInput.value.trim(),
        reason_codes: reasonCodes().filter((code) => draftReasonIds.includes(code.id)),
      },
    ];
    writePunches(punches);
    noteInput.value = '';
    draftReasonIds = [];
    renderReasonPicks();
    setStatus(action === 'in' ? `${driver_name} clocked in.` : `${driver_name} clocked out.`);
    refresh();
  }

  function reasonCodes() {
    const saved = readState()?.clockReasonCodes;
    return Array.isArray(saved) ? saved : [];
  }

  function fillReasons() {
    if (!reasonSelect) return;
    const current = reasonSelect.value;
    reasonSelect.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choose a reason';
    reasonSelect.append(blank);
    for (const code of reasonCodes()) {
      const option = document.createElement('option');
      option.value = code.id;
      option.textContent = code.label;
      reasonSelect.append(option);
    }
    if ([...reasonSelect.options].some((option) => option.value === current)) {
      reasonSelect.value = current;
    }
  }

  function renderReasonPicks() {
    if (!reasonPicks) return;
    const catalog = new Map(reasonCodes().map((code) => [code.id, code.label]));
    reasonPicks.replaceChildren();
    for (const id of draftReasonIds) {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = catalog.get(id) || id;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        draftReasonIds = draftReasonIds.filter((itemId) => itemId !== id);
        renderReasonPicks();
      });
      item.append(label, remove);
      reasonPicks.append(item);
    }
  }

  function refresh() {
    if (!timeInput.value) timeInput.value = localStamp(new Date());
    fillDrivers();
    fillReasons();
    renderReasonPicks();
    renderDriverList();
    renderPayrollSheet();
    renderRows();
  }

  return { refresh };
}
