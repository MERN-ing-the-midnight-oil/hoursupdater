/**
 * Office clock. A signed-in person records a driver's clock in or clock out.
 * The records stay on the shared office and feed the payroll spreadsheet.
 */

import { addOfficePunch, assignClockPeriodPay, changeOfficePunch, removeOfficePunch, setTimecardEntries } from '../src/officePunches.js';
import { formatTimecardMinutes, normalizeTimecardEntries, sessionForClockOut, timecardSummary } from '../src/timecardEntries.js';
import { pairClockPunches, punchRunLabel } from '../../src/logic/timesheets.js';
import { clockNoteText, normalizeStoredWorkPortions, normalizeTripTicket, stampTripTicket, TRIP_TICKET_WORK_TYPE, workTypeLabel } from '../../src/logic/workTypes.js';
import { buildDriverClockRecord, CLOCK_RECORD_COLUMNS } from '../src/driverClockRecord.js';
import {
  CLOCK_IN_TYPES,
  driverPayStatusChoices,
  normalizeClockPayDefaults,
  normalizeDriverPay,
  normalizePayStatusByRun,
  paySlicesForPair,
} from '../src/driverPay.js';
import { compareRouteNumbers, driversFromState } from './store.js';

/**
 * @param {{
 *   readState: () => { punches?: object[], profiles?: object },
 *   writePunches: (punches: object[]) => void,
 *   listNames: () => string[],
 *   asOf?: () => string,
 *   readAccount?: () => { id?: string, name?: string } | null,
 *   onOpenHistory?: (name: string) => void,
 *   saveDriverPay?: (driver: object, fields: { serial?: string, rate?: string, payStatuses?: string[], payStatusByRun?: object }) => Promise<void> | void,
 * }} options
 */
export function mountClockDesk({ readState, writePunches, listNames, asOf, readAccount, onOpenHistory, saveDriverPay }) {
  const driverSelect = document.querySelector('#clock-driver');
  const timeInput = document.querySelector('#clock-time');
  const noteInput = document.querySelector('#clock-note');
  const adminNoteInput = document.querySelector('#clock-admin-note');
  const adminNameField = document.querySelector('#clock-admin-name-field');
  const adminNameInput = document.querySelector('#clock-admin-name');
  const adminWho = document.querySelector('#clock-admin-who');
  const status = document.querySelector('#clock-status');
  const table = document.querySelector('#clock-records tbody');
  if (!driverSelect || !timeInput || !noteInput || !status || !table) {
    return {
      refresh() {},
      openDriver() {
        return '';
      },
    };
  }

  const reasonSelect = document.querySelector('#clock-reason');
  const reasonPicks = document.querySelector('#clock-reason-picks');
  const clockHub = document.querySelector('#clock-hub');
  const driversPanel = document.querySelector('#clock-drivers');
  const driverList = document.querySelector('#clock-driver-list');
  const driverSummary = document.querySelector('#clock-driver-summary');
  const driverSheet = document.querySelector('#clock-driver-sheet');
  const driverSheetTitle = document.querySelector('#clock-driver-sheet-title');
  const driverFacts = document.querySelector('#clock-driver-facts');
  const driverPayStatus = document.querySelector('#clock-driver-pay-status');
  const recordJumps = document.querySelector('#clock-record-periods');
  const recordHead = document.querySelector('#clock-record-sheet thead tr');
  const recordBody = document.querySelector('#clock-record-sheet tbody');
  const clockingHub = document.querySelector('#clocking-hub');
  const clockingDrivers = document.querySelector('#clocking-drivers');
  const clockingDriverList = document.querySelector('#clocking-driver-list');
  const clockingDriverSummary = document.querySelector('#clocking-driver-summary');
  const clockingSheet = document.querySelector('#clocking-driver-sheet');
  const clockingSheetTitle = document.querySelector('#clocking-driver-sheet-title');
  const clockingSheetRoutes = document.querySelector('#clocking-driver-sheet-routes');
  /** @type {string[]} */
  let draftReasonIds = [];
  /** @type {string} */
  let openDriver = '';
  let factsDriver = '';
  let editingId = '';
  let removingId = '';
  let payEditingId = '';
  let timecardEditingId = '';
  /** @type {{ time: string, action: string, note: string, reasonIds: string[], adminNote: string, adminName: string } | null} */
  let editDraft = null;
  /** @type {{ payStatus: string, portions: Array<{ start: string, end: string, payStatus: string }>, adminNote: string, adminName: string } | null} */
  let payDraft = null;
  /** @type {{ rows: Array<{ id: string, hours: string, minutes: string, comment: string }>, adminNote: string, adminName: string } | null} */
  let timecardDraft = null;
  /** @type {{ adminNote: string, adminName: string }} */
  let removeDraft = { adminNote: '', adminName: '' };
  let officeName = '';
  /** @type {string} */
  let focusSelector = '';

  function driversMode() {
    return document.body.dataset.driversApp || '';
  }

  function closeDriverSheet() {
    const name = openDriver;
    const mode = driversMode();
    openDriver = '';
    refresh();
    const lists = mode === 'clocking' ? [clockingDriverList] : [driverList];
    const button = lists
      .flatMap((list) => [...(list?.querySelectorAll('[data-driver-name]') || [])])
      .find((item) => item.getAttribute('data-driver-name') === name);
    button?.focus();
    document.querySelector(mode === 'clocking' ? '#clocking-view' : '#payroll-view')?.scrollIntoView({ block: 'start' });
  }

  function openNamedDriver(event, view) {
    const button = event.target.closest('[data-driver-name]');
    if (!button) return;
    const name = button.getAttribute('data-driver-name') || '';
    if (!name) return;
    openDriver = name;
    refresh();
    document.querySelector(view)?.scrollIntoView({ block: 'start' });
  }

  document.querySelector('#clock-driver-sheet-close')?.addEventListener('click', closeDriverSheet);
  document.querySelector('#clocking-driver-sheet-close')?.addEventListener('click', closeDriverSheet);
  document.querySelector('#clock-driver-history')?.addEventListener('click', () => {
    if (openDriver) onOpenHistory?.(openDriver);
  });
  driverFacts?.addEventListener('focusout', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.payField === 'serial' || input.dataset.payField === 'rate') commitPayField(input);
  });
  driverFacts?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.payField !== 'serial' && input.dataset.payField !== 'rate') return;
    event.preventDefault();
    input.blur();
  });
  driverFacts?.addEventListener('change', (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    if (select.classList.contains('js-pay-status-run')) {
      savePayStatusRun(select);
      return;
    }
    if (select.dataset.payStatusAdd !== '1') return;
    if (select.value) addPayStatus();
  });
  driverFacts?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const remove = target?.closest('[data-remove-status]');
    if (remove instanceof HTMLButtonElement) {
      removePayStatus(remove.dataset.removeStatus || '');
      return;
    }
    if (target?.closest('[data-add-status]')) addPayStatus();
  });
  recordJumps?.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!(link instanceof HTMLAnchorElement)) return;
    const row = document.getElementById((link.getAttribute('href') || '').slice(1));
    if (!(row instanceof HTMLElement)) return;
    event.preventDefault();
    row.scrollIntoView({ block: 'start' });
  });
  driverList?.addEventListener('click', (event) => openNamedDriver(event, '#payroll-view'));
  clockingDriverList?.addEventListener('click', (event) => openNamedDriver(event, '#clocking-view'));

  document.querySelector('#clock-in')?.addEventListener('click', () => record('in'));
  document.querySelector('#clock-out')?.addEventListener('click', () => record('out'));
  document.querySelector('#clock-add-reason')?.addEventListener('click', () => {
    const id = reasonSelect?.value || '';
    if (!id || draftReasonIds.includes(id)) return;
    draftReasonIds.push(id);
    renderReasonPicks();
  });

  function punchesFromState() {
    return Array.isArray(readState()?.punches) ? readState().punches : [];
  }

  function setStatus(message, kind = '') {
    status.hidden = !message;
    status.textContent = message || '';
    status.className = kind ? `status is-${kind}` : 'status';
  }

  function signedInName() {
    return String(readAccount?.()?.name || '').trim();
  }

  function showActorFields() {
    const name = signedInName();
    if (adminNameField) adminNameField.hidden = Boolean(name);
    if (adminWho) {
      adminWho.hidden = !name;
      adminWho.textContent = name ? `Saving as ${name}.` : '';
    }
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

  function officeNow() {
    const stamp = String(asOf?.() || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(stamp);
    if (!match) return new Date();
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
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

  function strokeIcon(paths) {
    const holder = document.createElement('span');
    holder.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
    return holder.firstElementChild;
  }

  function fillDriverList(list, summary, heading, names, marked = false) {
    if (!list) return;
    if (summary) {
      const text = names.length ? `${heading} (${names.length})` : heading;
      const label = summary.querySelector('[data-heading-label]');
      if (label) label.textContent = text;
      else summary.textContent = text;
    }
    list.replaceChildren();
    for (const name of names) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary clock-driver';
      button.dataset.driverName = name;
      const label = document.createElement('span');
      label.textContent = name;
      const routes = document.createElement('span');
      routes.className = 'clock-driver-routes';
      const routeList = routesFor(name);
      routes.textContent = routeList.length ? routeList.join(', ') : 'No route';
      if (marked) {
        button.classList.add('is-marked');
        label.className = 'clock-driver-name';
        const mark = document.createElement('span');
        mark.className = 'clock-driver-mark';
        mark.append(strokeIcon('<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="3.5"/>'));
        const copy = document.createElement('span');
        copy.className = 'clock-driver-copy';
        copy.append(label, routes);
        button.append(mark, copy);
      } else {
        button.append(label, routes);
      }
      item.append(button);
      list.append(item);
    }
  }

  function renderDriverList() {
    const names = [...new Set(listNames().map((name) => String(name || '').trim()).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    if (openDriver && !names.some((name) => name === openDriver)) openDriver = '';
    fillDriverList(driverList, driverSummary, 'Drivers', names);
    fillDriverList(clockingDriverList, clockingDriverSummary, 'Clock records', names, true);
  }

  function renderChrome() {
    const open = Boolean(openDriver);
    const inDriversWindow = document.body.classList.contains('is-drivers-window');
    const mode = driversMode();
    const payrollOpen = open && mode === 'payroll';
    const clockingOpen = open && mode === 'clocking';
    if (clockHub) clockHub.hidden = inDriversWindow || payrollOpen;
    if (driversPanel) driversPanel.hidden = !(inDriversWindow && mode === 'payroll') || open;
    if (driverSheet) driverSheet.hidden = !payrollOpen;
    if (clockingHub) clockingHub.hidden = inDriversWindow || clockingOpen;
    if (clockingDrivers) clockingDrivers.hidden = !(inDriversWindow && mode === 'clocking') || open;
    if (clockingSheet) clockingSheet.hidden = !clockingOpen;
  }

  function renderOpenDriver() {
    if (!openDriver) return;
    const routes = routesFor(openDriver);
    const routeText = routes.length ? `Routes ${routes.join(', ')}` : 'No route on file.';
    if (driversMode() === 'clocking') {
      if (clockingSheetTitle) clockingSheetTitle.textContent = openDriver;
      if (clockingSheetRoutes) clockingSheetRoutes.textContent = routeText;
    }
    if (driverSelect.value !== openDriver) driverSelect.value = openDriver;
  }

  function openPayDriver() {
    const state = readState() || {};
    return (
      driversFromState(state).find(
        (item) => item.name.trim().toLowerCase() === String(openDriver || '').trim().toLowerCase()
      ) || null
    );
  }

  function payLines() {
    return normalizeClockPayDefaults(readState()?.clockPayDefaults).lines;
  }

  function setPayNote(message, kind = '') {
    if (!driverPayStatus) return;
    driverPayStatus.hidden = !message;
    driverPayStatus.textContent = message || '';
    driverPayStatus.className = kind ? `status is-${kind}` : 'status';
  }

  function factGroup(label, value) {
    const group = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    group.append(term, detail);
    return group;
  }

  function payField(label, field, value) {
    const group = document.createElement('div');
    group.className = 'clock-record-edit';
    const name = document.createElement('label');
    name.className = 'clock-record-label';
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.payField = field;
    input.value = value;
    input.setAttribute('aria-label', label);
    if (field === 'serial') input.maxLength = 20;
    if (field === 'rate') {
      input.inputMode = 'decimal';
      input.maxLength = 7;
      input.placeholder = '0.00';
    }
    name.append(input);
    group.append(name);
    return group;
  }

  function renderDriverFacts(force = false) {
    if (!driverFacts) return;
    if (!force && driverFacts.contains(document.activeElement)) return;
    if (factsDriver !== openDriver) {
      factsDriver = openDriver;
      setPayNote('');
    }
    const driver = openPayDriver();
    const lines = payLines();
    const chosen = driverPayStatusChoices(driver?.payStatuses, lines);
    const chosenIds = new Set(chosen.map((line) => line.id));
    const routes = routesFor(openDriver);
    driverFacts.replaceChildren();
    driverFacts.append(factGroup('Routes', routes.length ? routes.join(', ') : 'No route'));
    if (driver?.email) driverFacts.append(factGroup('Email', driver.email));
    if (driver?.phone) driverFacts.append(factGroup('Phone', driver.phone));
    driverFacts.append(payField('Serial number', 'serial', driver?.pay?.serial || ''));
    driverFacts.append(payField('Hourly rate', 'rate', driver?.pay?.rate || ''));
    if (driver?.pay?.account) driverFacts.append(factGroup('Payroll account', driver.pay.account));

    const statuses = document.createElement('div');
    statuses.className = 'clock-record-statuses';
    const heading = document.createElement('span');
    heading.className = 'clock-record-label';
    heading.textContent = 'Pay status';
    const list = document.createElement('ul');
    list.className = 'clock-record-status-lines';
    for (const line of chosen) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = line.label;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.dataset.removeStatus = line.id;
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${line.label}`);
      item.append(name, remove);
      list.append(item);
    }
    const select = document.createElement('select');
    select.dataset.payStatusAdd = '1';
    select.setAttribute('aria-label', 'Pay status to add');
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Add a pay status';
    select.append(blank);
    for (const line of lines) {
      if (chosenIds.has(line.id)) continue;
      const option = document.createElement('option');
      option.value = line.id;
      option.textContent = line.label;
      select.append(option);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'secondary';
    add.dataset.addStatus = '1';
    add.textContent = 'Add';
    add.disabled = select.options.length < 2;
    statuses.append(heading, list, select, add);
    if (driver) appendClockInPayMap(statuses, driver, chosen);
    driverFacts.append(statuses);
  }

  /**
   * @param {HTMLElement} parent
   * @param {NonNullable<ReturnType<typeof openPayDriver>>} driver
   * @param {Array<{ id: string, label: string }>} choices
   */
  function appendClockInPayMap(parent, driver, choices) {
    if (choices.length < 2) {
      const note = document.createElement('p');
      note.className = 'field-hint';
      note.textContent = `Every clock-in uses ${choices[0]?.label || 'that pay status'}.`;
      parent.append(note);
      return;
    }
    const map = normalizePayStatusByRun(
      driver.payStatusByRun,
      choices.map((line) => line.id)
    );
    const grid = document.createElement('div');
    grid.className = 'pay-run-map';
    for (const type of CLOCK_IN_TYPES) {
      const label = document.createElement('label');
      label.append(document.createTextNode(type.label));
      const select = document.createElement('select');
      select.className = 'js-pay-status-run';
      select.dataset.payRun = type.id;
      select.setAttribute('aria-label', `${type.label} pay status for ${driver.name}`);
      for (const line of choices) {
        const option = document.createElement('option');
        option.value = line.id;
        option.textContent = line.label;
        select.append(option);
      }
      select.value = map[type.id] || choices[0].id;
      label.append(select);
      grid.append(label);
    }
    parent.append(grid);
  }

  /**
   * @param {HTMLSelectElement} select
   */
  function savePayStatusRun(select) {
    const driver = openPayDriver();
    if (!driver) return;
    const lines = payLines();
    const choices = driverPayStatusChoices(driver.payStatuses, lines);
    const run = select.dataset.payRun || '';
    const type = CLOCK_IN_TYPES.find((item) => item.id === run);
    if (choices.length < 2 || !type || !choices.some((line) => line.id === select.value)) return;
    const map = normalizePayStatusByRun(
      driver.payStatusByRun,
      choices.map((line) => line.id)
    );
    map[run] = select.value;
    const line = choices.find((item) => item.id === select.value);
    savePay(
      driver,
      { payStatusByRun: map },
      `${type.label} for ${driver.name} uses ${line?.label || 'that pay status'}.`
    );
  }

  /**
   * @param {HTMLInputElement} input
   */
  function commitPayField(input) {
    const driver = openPayDriver();
    if (!driver || !saveDriverPay) return;
    const field = input.dataset.payField;
    const raw = input.value.trim();
    if (field === 'serial') {
      const serial = normalizeDriverPay({ serial: raw }).serial;
      if (serial === (driver.pay?.serial || '')) return;
      input.value = serial;
      savePay(driver, { serial }, serial ? `Serial number saved for ${driver.name}.` : `Serial number removed for ${driver.name}.`);
      return;
    }
    if (field !== 'rate') return;
    const rate = normalizeDriverPay({ rate: raw }).rate;
    if (raw && !rate) {
      input.value = driver.pay?.rate || '';
      setPayNote('Enter an hourly rate like 37.74.', 'error');
      return;
    }
    if (rate === (driver.pay?.rate || '')) return;
    input.value = rate;
    savePay(driver, { rate }, rate ? `Hourly rate saved for ${driver.name}.` : `Hourly rate removed for ${driver.name}.`);
  }

  function chosenStatusIds(driver) {
    return driverPayStatusChoices(driver?.payStatuses, payLines()).map((line) => line.id);
  }

  function addPayStatus() {
    const driver = openPayDriver();
    const select = driverFacts?.querySelector('[data-pay-status-add]');
    if (!driver || !(select instanceof HTMLSelectElement) || !select.value) return;
    const lines = payLines();
    const next = lines.map((line) => line.id).filter((id) => chosenStatusIds(driver).includes(id) || id === select.value);
    const added = lines.find((line) => line.id === select.value);
    savePay(driver, { payStatuses: next }, `${added?.label || 'Pay status'} added for ${driver.name}.`, true);
  }

  function removePayStatus(id) {
    const driver = openPayDriver();
    if (!driver || !id) return;
    const lines = payLines();
    const current = chosenStatusIds(driver);
    if (current.length < 2) {
      setPayNote('Leave at least one pay status for this driver.', 'error');
      return;
    }
    const next = lines.map((line) => line.id).filter((lineId) => current.includes(lineId) && lineId !== id);
    const removed = lines.find((line) => line.id === id);
    savePay(driver, { payStatuses: next }, `${removed?.label || 'Pay status'} removed for ${driver.name}.`, true);
  }

  /**
   * @param {NonNullable<ReturnType<typeof openPayDriver>>} driver
   * @param {{ serial?: string, rate?: string, payStatuses?: string[], payStatusByRun?: object }} fields
   * @param {string} message
   * @param {boolean} [redraw]
   */
  function savePay(driver, fields, message, redraw = false) {
    try {
      const pending = saveDriverPay?.(driver, fields);
      setPayNote(message, 'ok');
      if (redraw) renderDriverFacts(true);
      Promise.resolve(pending).catch((error) => {
        setPayNote(error instanceof Error ? error.message : 'Could not save that change.', 'error');
      });
    } catch (error) {
      setPayNote(error instanceof Error ? error.message : 'Could not save that change.', 'error');
    }
  }

  function renderClockRecord() {
    const open = Boolean(openDriver) && driversMode() === 'payroll';
    if (!recordBody || !recordHead) return;
    if (!open) {
      recordHead.replaceChildren();
      recordBody.replaceChildren();
      recordJumps?.replaceChildren();
      driverFacts?.replaceChildren();
      factsDriver = '';
      setPayNote('');
      return;
    }
    if (driverSheetTitle) driverSheetTitle.textContent = openDriver;
    renderDriverFacts();
    const state = readState() || {};
    const periods = buildDriverClockRecord(
      state.punches,
      normalizeClockPayDefaults(state.clockPayDefaults).periods,
      openDriver,
      officeNow(),
      state.leaveRequests
    );
    if (recordJumps) {
      recordJumps.replaceChildren();
      for (const period of periods) {
        const link = document.createElement('a');
        link.href = `#clock-period-${period.key}`;
        link.textContent = period.label;
        recordJumps.append(link);
      }
    }
    recordHead.replaceChildren();
    for (const column of CLOCK_RECORD_COLUMNS) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = column.label;
      recordHead.append(cell);
    }
    recordBody.replaceChildren();
    const rows = periods.flatMap((period) => period.rows.map((row) => ({ ...row, band: period.band, periodKey: period.key })));
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = CLOCK_RECORD_COLUMNS.length;
      cell.textContent = 'This driver has no clock record.';
      row.append(cell);
      recordBody.append(row);
      return;
    }
    for (const record of rows) {
      const row = document.createElement('tr');
      row.classList.add(record.band === 1 ? 'is-band-1' : 'is-band-0');
      if (record.periodStart) {
        row.id = `clock-period-${record.periodKey}`;
        row.classList.add('is-period-start');
      }
      if (record.weekend) row.classList.add('is-weekend');
      for (const column of CLOCK_RECORD_COLUMNS) {
        const cell = document.createElement('td');
        const value = String(record[column.key] || '');
        cell.textContent = value;
        if (column.text) cell.classList.add('is-text');
        if (!value) cell.classList.add('is-empty');
        row.append(cell);
      }
      recordBody.append(row);
    }
  }

  function punchKind(punch) {
    const kind = punch.action === 'out' ? 'Clock out' : 'Clock in';
    const work = workTypeLabel(punch.work_type);
    const route = work || punchRunLabel(punch.run);
    const label = route ? `${kind} · ${route}` : kind;
    const portions = normalizeStoredWorkPortions(punch.work_portions)
      .map((portion) => {
        const name = workTypeLabel(portion.work_type);
        return name ? `${name} ${clockTimeText(portion.start)}–${clockTimeText(portion.end)}` : '';
      })
      .filter(Boolean)
      .join(', ');
    const withPortions = portions ? `${label} · ${portions}` : label;
    const covering = punch.substitute_name ? `${withPortions} · ${punch.substitute_name}` : withPortions;
    const pay = punch.action === 'in' && !punch.removed ? payKindSuffix(punch) : '';
    const shown = pay ? `${covering} · ${pay}` : covering;
    return punch.removed ? `${covering} · Removed` : shown;
  }

  function payStatusName(id) {
    return payLines().find((line) => line.id === id)?.label || '';
  }

  function clockTimeText(value) {
    const when = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(when.getTime())) return '';
    return when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function periodFor(punch) {
    if (punch?.action !== 'in') return null;
    const driver = String(punch.driver_name || '').trim().toLowerCase();
    const { pairs } = pairClockPunches(
      punchesFromState().filter((item) => String(item?.driver_name || '').trim().toLowerCase() === driver)
    );
    return pairs.find((pair) => pair.clockIn?.id === punch.id) || null;
  }

  function payChoicesFor(punch) {
    const lines = payLines();
    const driver = driversFromState(readState() || {}).find(
      (item) => item.name.trim().toLowerCase() === String(punch.driver_name || '').trim().toLowerCase()
    );
    const chosen = driver ? driverPayStatusChoices(driver.payStatuses, lines) : [...lines];
    const extras = [punch.pay_status];
    for (const portion of Array.isArray(punch.pay_portions) ? punch.pay_portions : []) extras.push(portion.pay_status);
    for (const id of extras) {
      if (id && !chosen.some((line) => line.id === id)) {
        const line = lines.find((item) => item.id === id);
        if (line) chosen.push(line);
      }
    }
    return chosen.length ? chosen : lines.slice(0, 1);
  }

  function payKindSuffix(punch) {
    const name = payStatusName(punch.pay_status);
    const pair = periodFor(punch);
    const portions = Array.isArray(punch.pay_portions) ? punch.pay_portions : [];
    if (!pair || !portions.length) return name;
    const slices = paySlicesForPair(pair);
    if (slices.length < 2) return payStatusName(slices[0]?.pay_status) || name;
    return slices
      .map((slice) => {
        const label = payStatusName(slice.pay_status);
        const range = `${clockTimeText(slice.start)}–${clockTimeText(slice.end)}`;
        return label ? `${range} ${label}` : range;
      })
      .join(' · ');
  }

  function formatWhen(iso) {
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return '';
    return when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function rememberedName() {
    return String(adminNameInput?.value || officeName || '').trim();
  }

  function editorAccount() {
    return readAccount?.() || null;
  }

  function visiblePunches() {
    return [...punchesFromState()]
      .filter(
        (punch) =>
          !openDriver ||
          String(punch.driver_name || '').trim().toLowerCase() === openDriver.trim().toLowerCase()
      )
      .sort((a, b) => String(b.punched_at).localeCompare(String(a.punched_at)));
  }

  function closeEditors() {
    editingId = '';
    removingId = '';
    payEditingId = '';
    timecardEditingId = '';
    editDraft = null;
    payDraft = null;
    timecardDraft = null;
  }

  function beginEdit(punch) {
    editingId = punch.id;
    removingId = '';
    payEditingId = '';
    timecardEditingId = '';
    payDraft = null;
    timecardDraft = null;
    editDraft = {
      time: localStamp(new Date(punch.punched_at)),
      action: punch.action === 'out' ? 'out' : 'in',
      note: punch.note || '',
      reasonIds: (Array.isArray(punch.reason_codes) ? punch.reason_codes : []).map((code) => code.id),
      adminNote: '',
      adminName: rememberedName(),
    };
    focusSelector = '[data-edit="admin-note"]';
    setStatus('');
    renderRows();
  }

  function beginRemove(punch) {
    removingId = punch.id;
    editingId = '';
    payEditingId = '';
    timecardEditingId = '';
    editDraft = null;
    payDraft = null;
    timecardDraft = null;
    removeDraft = { adminNote: '', adminName: rememberedName() };
    focusSelector = '[data-remove="admin-note"]';
    setStatus('');
    renderRows();
  }

  function beginPay(punch) {
    const choices = payChoicesFor(punch);
    const current = choices.some((line) => line.id === punch.pay_status) ? punch.pay_status : choices[0]?.id || '';
    editingId = '';
    removingId = '';
    timecardEditingId = '';
    timecardDraft = null;
    editDraft = null;
    payEditingId = punch.id;
    payDraft = {
      payStatus: current,
      portions: (Array.isArray(punch.pay_portions) ? punch.pay_portions : []).map((portion) => ({
        start: localStamp(new Date(portion.start)),
        end: localStamp(new Date(portion.end)),
        payStatus: portion.pay_status,
      })),
      adminNote: '',
      adminName: rememberedName(),
    };
    focusSelector = '[data-pay="admin-note"]';
    setStatus('');
    renderRows();
  }

  function labeledField(labelText, control) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    if (!control.id) {
      control.id = `clock-field-${labelText.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    }
    label.htmlFor = control.id;
    label.textContent = labelText;
    wrap.append(label, control);
    return wrap;
  }

  function actorControls(draft, dataset) {
    /** @type {HTMLElement[]} */
    const nodes = [];
    const signedIn = signedInName();
    if (!signedIn) {
      const name = document.createElement('input');
      name.type = 'text';
      name.maxLength = 80;
      name.autocomplete = 'name';
      name.value = draft.adminName;
      name.dataset[dataset] = 'admin-name';
      name.addEventListener('input', () => {
        draft.adminName = name.value;
        officeName = name.value;
      });
      nodes.push(labeledField('Your name', name));
    }
    const note = document.createElement('input');
    note.type = 'text';
    note.maxLength = 500;
    note.value = draft.adminNote;
    note.dataset[dataset] = 'admin-note';
    note.addEventListener('input', () => {
      draft.adminNote = note.value;
    });
    const noteField = labeledField('Admin note', note);
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.textContent = 'Required. Your name is saved with this change.';
    noteField.append(hint);
    nodes.push(noteField);
    if (signedIn) {
      const who = document.createElement('p');
      who.className = 'field-hint clock-admin-who';
      who.textContent = `Saving as ${signedIn}.`;
      nodes.push(who);
    }
    return nodes;
  }

  function officeCell(punch) {
    const cell = document.createElement('td');
    const edits = Array.isArray(punch.office_edits) ? punch.office_edits : [];
    if (!edits.length) {
      cell.className = 'office-empty';
      cell.textContent = '—';
      return cell;
    }
    const log = document.createElement('div');
    log.className = 'office-log';
    for (const edit of [...edits].reverse()) {
      const block = document.createElement('p');
      const who = document.createElement('span');
      who.className = 'office-who';
      const verb = edit.action === 'delete' ? 'Removed' : edit.action === 'change' ? 'Changed' : 'Added';
      who.textContent = `${verb} by ${edit.by}`;
      const when = document.createElement('span');
      when.className = 'office-when';
      when.textContent = formatWhen(edit.at);
      const note = document.createElement('span');
      note.className = 'office-note';
      note.textContent = edit.note;
      block.append(who, when, note);
      log.append(block);
    }
    cell.append(log);
    return cell;
  }

  function punchKindCell(punch) {
    const cell = document.createElement('td');
    const pill = document.createElement('span');
    const out = punch.action === 'out';
    pill.className = `punch-kind${out ? ' is-out' : ' is-in'}${punch.removed ? ' is-removed' : ''}`;
    const icon = out
      ? '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'
      : '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>';
    pill.append(strokeIcon(icon), document.createTextNode(punchKind(punch)));
    cell.append(pill);
    return cell;
  }

  function actionButton(label, paths, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.append(strokeIcon(paths), document.createTextNode(label));
    button.addEventListener('click', onClick);
    return button;
  }

  function displayRow(punch) {
    const row = document.createElement('tr');
    row.classList.add(punch.action === 'out' ? 'is-punch-out' : 'is-punch-in');
    if (punch.removed) row.classList.add('is-removed');
    const when = document.createElement('td');
    when.textContent = formatWhen(punch.punched_at);
    const note = document.createElement('td');
    note.style.whiteSpace = 'pre-line';
    note.textContent = clockNoteText(punch);
    const reasons = document.createElement('td');
    const coded = (Array.isArray(punch.reason_codes) ? punch.reason_codes : [])
      .map((code) => code.label)
      .filter(Boolean);
    const timed = timecardSummary(normalizeTimecardEntries(punch.timecard_entries));
    reasons.style.whiteSpace = 'pre-line';
    reasons.textContent = [...coded, timed].filter(Boolean).join('\n');
    row.append(when, punchKindCell(punch), note, reasons, officeCell(punch));
    const action = document.createElement('td');
    if (!punch.removed) {
      const wrap = document.createElement('div');
      wrap.className = 'row-actions';
      wrap.append(
        actionButton(
          'Edit',
          '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
          () => beginEdit(punch)
        )
      );
      if (punch.action === 'in') {
        wrap.append(
          actionButton(
            'Pay status',
            '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
            () => beginPay(punch)
          )
        );
      }
      if (punch.action === 'out') {
        wrap.append(
          actionButton(
            'Timecard',
            '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
            () => beginTimecard(punch)
          )
        );
      }
      wrap.append(
        actionButton(
          'Remove',
          '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M8 7l1 13h6l1-13"/>',
          () => beginRemove(punch)
        )
      );
      action.append(wrap);
    }
    row.append(action);
    return row;
  }

  function syncEditDraft(form) {
    if (!editDraft) return;
    const time = form.querySelector('[data-edit="time"]');
    const action = form.querySelector('[data-edit="action"]');
    const note = form.querySelector('[data-edit="note"]');
    const adminNote = form.querySelector('[data-edit="admin-note"]');
    const adminName = form.querySelector('[data-edit="admin-name"]');
    if (time instanceof HTMLInputElement) editDraft.time = time.value;
    if (action instanceof HTMLSelectElement) editDraft.action = action.value;
    if (note instanceof HTMLInputElement) editDraft.note = note.value;
    if (adminNote instanceof HTMLInputElement) editDraft.adminNote = adminNote.value;
    if (adminName instanceof HTMLInputElement) {
      editDraft.adminName = adminName.value;
      officeName = adminName.value;
    }
  }

  function editReasonPicks(form) {
    const list = document.createElement('ul');
    list.className = 'reason-picks';
    const catalog = new Map(reasonCodes().map((code) => [code.id, code.label]));
    for (const id of editDraft?.reasonIds || []) {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = catalog.get(id) || id;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        syncEditDraft(form);
        if (editDraft) editDraft.reasonIds = editDraft.reasonIds.filter((itemId) => itemId !== id);
        renderRows();
      });
      item.append(label, remove);
      list.append(item);
    }
    return list;
  }

  function editRow(punch) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    const form = document.createElement('form');
    form.className = 'clock-record-edit';
    form.noValidate = true;
    const grid = document.createElement('div');
    grid.className = 'clock-edit-grid';
    const time = document.createElement('input');
    time.type = 'datetime-local';
    time.required = true;
    time.value = editDraft?.time || '';
    time.dataset.edit = 'time';
    const action = document.createElement('select');
    action.dataset.edit = 'action';
    for (const [value, label] of [
      ['in', 'Clock in'],
      ['out', 'Clock out'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      action.append(option);
    }
    action.value = editDraft?.action === 'out' ? 'out' : 'in';
    const note = document.createElement('input');
    note.type = 'text';
    note.maxLength = 200;
    note.value = editDraft?.note || '';
    note.dataset.edit = 'note';
    const reason = document.createElement('select');
    reason.dataset.edit = 'reason';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choose a reason';
    reason.append(blank);
    const selected = new Set(editDraft?.reasonIds || []);
    for (const code of reasonCodes()) {
      if (selected.has(code.id)) continue;
      const option = document.createElement('option');
      option.value = code.id;
      option.textContent = code.label;
      reason.append(option);
    }
    const addReason = document.createElement('button');
    addReason.type = 'button';
    addReason.className = 'secondary';
    addReason.textContent = 'Add to this record';
    addReason.addEventListener('click', () => {
      syncEditDraft(form);
      const id = reason.value;
      if (!editDraft || !id || editDraft.reasonIds.includes(id)) return;
      editDraft.reasonIds.push(id);
      renderRows();
    });
    const reasonField = labeledField('Reason code', reason);
    reasonField.append(addReason);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      closeEditors();
      setStatus('');
      renderRows();
    });
    actions.append(save, cancel);
    grid.append(
      labeledField('Time', time),
      labeledField('Kind', action),
      labeledField('Note', note),
      reasonField,
      editReasonPicks(form),
      ...actorControls(editDraft || { adminNote: '', adminName: '' }, 'edit'),
      actions
    );
    form.append(grid);
    form.addEventListener('input', () => syncEditDraft(form));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      syncEditDraft(form);
      saveEdit(punch.id);
    });
    cell.append(form);
    row.append(cell);
    return row;
  }

  function removeRow(punch) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    const form = document.createElement('form');
    form.className = 'clock-record-edit';
    form.noValidate = true;
    const grid = document.createElement('div');
    grid.className = 'clock-edit-grid';
    const lead = document.createElement('p');
    lead.className = 'field-hint clock-admin-who';
    lead.textContent = `Remove ${punchKind(punch)} at ${formatWhen(punch.punched_at)}?`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Remove';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      removingId = '';
      setStatus('');
      renderRows();
    });
    actions.append(save, cancel);
    grid.append(lead, ...actorControls(removeDraft, 'remove'), actions);
    form.append(grid);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const adminNote = form.querySelector('[data-remove="admin-note"]');
      const adminName = form.querySelector('[data-remove="admin-name"]');
      if (adminNote instanceof HTMLInputElement) removeDraft.adminNote = adminNote.value;
      if (adminName instanceof HTMLInputElement) {
        removeDraft.adminName = adminName.value;
        officeName = adminName.value;
      }
      saveRemoval(punch.id);
    });
    cell.append(form);
    row.append(cell);
    return row;
  }

  function payStatusSelect(choices, value, dataset) {
    const select = document.createElement('select');
    select.dataset.pay = dataset;
    for (const line of choices) {
      const option = document.createElement('option');
      option.value = line.id;
      option.textContent = line.label;
      select.append(option);
    }
    if (choices.some((line) => line.id === value)) select.value = value;
    return select;
  }

  function syncPayDraft(form) {
    if (!payDraft) return;
    const status = form.querySelector('[data-pay="status"]');
    if (status instanceof HTMLSelectElement) payDraft.payStatus = status.value;
    for (const row of form.querySelectorAll('[data-pay-portion]')) {
      const index = Number(row.getAttribute('data-pay-portion'));
      const portion = payDraft.portions[index];
      if (!portion) continue;
      const start = row.querySelector('[data-pay="start"]');
      const end = row.querySelector('[data-pay="end"]');
      const pay = row.querySelector('[data-pay="portion-status"]');
      if (start instanceof HTMLInputElement) portion.start = start.value;
      if (end instanceof HTMLInputElement) portion.end = end.value;
      if (pay instanceof HTMLSelectElement) portion.payStatus = pay.value;
    }
    const adminNote = form.querySelector('[data-pay="admin-note"]');
    const adminName = form.querySelector('[data-pay="admin-name"]');
    if (adminNote instanceof HTMLInputElement) payDraft.adminNote = adminNote.value;
    if (adminName instanceof HTMLInputElement) {
      payDraft.adminName = adminName.value;
      officeName = adminName.value;
    }
  }

  function payRow(punch) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    const form = document.createElement('form');
    form.className = 'clock-record-edit';
    form.noValidate = true;
    const grid = document.createElement('div');
    grid.className = 'clock-edit-grid';
    const choices = payChoicesFor(punch);
    const pair = periodFor(punch);
    const lead = document.createElement('p');
    lead.className = 'field-hint';
    const periodStart = pair ? (pair.start <= pair.end ? pair.start : pair.end) : null;
    const periodEnd = pair ? (pair.start <= pair.end ? pair.end : pair.start) : null;
    const range = periodStart && periodEnd ? `${formatWhen(periodStart)} – ${formatWhen(periodEnd)}` : formatWhen(punch.punched_at);
    lead.textContent = `Pay status for ${range}.`;
    const whole = payStatusSelect(choices, payDraft?.payStatus || '', 'status');
    whole.id = 'pay-period-status';
    const wholeField = labeledField(choices.length > 1 ? 'Whole period' : 'Pay status', whole);
    if (choices.length < 2) {
      const hint = document.createElement('p');
      hint.className = 'field-hint';
      hint.textContent = `${payStatusName(choices[0]?.id) || 'This pay status'} is used for the whole period.`;
      wholeField.append(hint);
    }
    /** @type {HTMLElement[]} */
    const portionNodes = [];
    if (choices.length > 1 && pair) {
      const block = document.createElement('div');
      block.className = 'pay-portion-block';
      const hint = document.createElement('p');
      hint.className = 'field-hint';
      hint.textContent = 'A part uses its own pay status. The rest of the period uses the whole-period pay status.';
      block.append(hint);
      (payDraft?.portions || []).forEach((portion, index) => {
        const portionRow = document.createElement('div');
        portionRow.className = 'pay-portion-row';
        portionRow.dataset.payPortion = String(index);
        const start = document.createElement('input');
        start.type = 'datetime-local';
        start.id = `pay-portion-${index}-start`;
        start.dataset.pay = 'start';
        start.value = portion.start;
        const end = document.createElement('input');
        end.type = 'datetime-local';
        end.id = `pay-portion-${index}-end`;
        end.dataset.pay = 'end';
        end.value = portion.end;
        const portionStatus = payStatusSelect(choices, portion.payStatus, 'portion-status');
        portionStatus.id = `pay-portion-${index}-status`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'secondary';
        remove.textContent = 'Remove part';
        remove.addEventListener('click', () => {
          syncPayDraft(form);
          if (payDraft) payDraft.portions.splice(index, 1);
          renderRows();
        });
        portionRow.append(
          labeledField('From', start),
          labeledField('Until', end),
          labeledField('Pay status', portionStatus),
          remove
        );
        block.append(portionRow);
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'secondary';
      add.textContent = 'Add a part';
      add.addEventListener('click', () => {
        syncPayDraft(form);
        if (!payDraft || !periodStart || !periodEnd) return;
        const other = choices.find((line) => line.id !== payDraft.payStatus) || choices[0];
        const hourLater = new Date(periodStart.getTime() + 60 * 60000);
        payDraft.portions.push({
          start: localStamp(periodStart),
          end: localStamp(hourLater < periodEnd ? hourLater : periodEnd),
          payStatus: other?.id || payDraft.payStatus,
        });
        focusSelector = `[data-pay-portion="${payDraft.portions.length - 1}"] [data-pay="start"]`;
        renderRows();
      });
      block.append(add);
      portionNodes.push(block);
    } else if (!pair) {
      const hint = document.createElement('p');
      hint.className = 'field-hint';
      hint.textContent = 'This clock in has no clock out yet. The pay status covers the whole period once they clock out.';
      portionNodes.push(hint);
    }
    const actions = document.createElement('div');
    actions.className = 'actions';
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save pay status';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      closeEditors();
      setStatus('');
      renderRows();
    });
    actions.append(save, cancel);
    grid.append(
      lead,
      wholeField,
      ...portionNodes,
      ...actorControls(payDraft || { adminNote: '', adminName: '' }, 'pay'),
      actions
    );
    form.append(grid);
    form.addEventListener('input', () => syncPayDraft(form));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      syncPayDraft(form);
      savePeriodPay(punch.id);
    });
    cell.append(form);
    row.append(cell);
    return row;
  }

  function beginTimecard(punch) {
    editingId = '';
    removingId = '';
    payEditingId = '';
    payDraft = null;
    editDraft = null;
    timecardEditingId = punch.id;
    const rows = normalizeTimecardEntries(punch.timecard_entries).map((entry) => ({
      id: entry.id,
      hours: String(Math.floor(entry.minutes / 60)),
      minutes: String(entry.minutes % 60),
      comment: entry.comment,
      ticket: '',
    }));
    if (normalizeTripTicket(punch.trip_ticket) && !rows.some((entry) => entry.id === TRIP_TICKET_WORK_TYPE)) {
      rows.unshift({
        id: TRIP_TICKET_WORK_TYPE,
        hours: '',
        minutes: '',
        comment: '',
        ticket: normalizeTripTicket(punch.trip_ticket),
      });
    }
    timecardDraft = {
      rows,
      adminNote: '',
      adminName: rememberedName(),
    };
    focusSelector = '[data-timecard="admin-note"]';
    setStatus('');
    renderRows();
  }

  function timecardCodeSelect(value) {
    const select = document.createElement('select');
    select.dataset.timecard = 'code';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choose a code';
    select.append(blank);
    for (const code of reasonCodes()) {
      const option = document.createElement('option');
      option.value = code.id;
      option.textContent = code.label;
      select.append(option);
    }
    if (reasonCodes().some((code) => code.id === value)) select.value = value;
    return select;
  }

  function timecardRow(punch) {
    if (!timecardDraft) return document.createElement('tr');
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    const form = document.createElement('form');
    form.className = 'clock-pay-form';
    const session = sessionForClockOut(punchesFromState(), punch.id);
    const title = document.createElement('p');
    title.className = 'lead';
    title.textContent = session
      ? `Timecard codes for this clock-out. The times can add up to ${formatTimecardMinutes(session.minutes)} or less.`
      : 'Timecard codes for this clock-out.';
    const list = document.createElement('div');
    list.className = 'clock-timecard-rows';
    timecardDraft.rows.forEach((entry, index) => {
      const block = document.createElement('div');
      block.className = 'clock-timecard-row';
      block.dataset.timecardRow = String(index);
      const code = timecardCodeSelect(entry.id);
      code.addEventListener('change', () => {
        timecardDraft.rows[index].id = code.value;
        renderRows();
      });
      const hours = document.createElement('input');
      hours.type = 'number';
      hours.min = '0';
      hours.max = '24';
      hours.value = entry.hours;
      hours.addEventListener('input', () => {
        timecardDraft.rows[index].hours = hours.value;
      });
      const minutes = document.createElement('input');
      minutes.type = 'number';
      minutes.min = '0';
      minutes.max = '59';
      minutes.value = entry.minutes;
      minutes.addEventListener('input', () => {
        timecardDraft.rows[index].minutes = minutes.value;
      });
      const comment = document.createElement('input');
      comment.type = 'text';
      comment.maxLength = 200;
      comment.value = entry.comment;
      comment.placeholder = 'Comment';
      comment.addEventListener('input', () => {
        timecardDraft.rows[index].comment = comment.value;
      });
      const ticket = document.createElement('input');
      ticket.type = 'text';
      ticket.maxLength = 40;
      ticket.value = entry.ticket || '';
      ticket.autocomplete = 'off';
      ticket.addEventListener('input', () => {
        timecardDraft.rows[index].ticket = ticket.value;
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        timecardDraft.rows.splice(index, 1);
        renderRows();
      });
      block.append(
        code,
        ...(entry.id === TRIP_TICKET_WORK_TYPE
          ? [labeledField('Trip ticket number', ticket)]
          : [labeledField('Hours', hours), labeledField('Minutes', minutes), labeledField('Comment', comment)]),
        remove
      );
      list.append(block);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'secondary';
    add.textContent = 'Add a code';
    add.addEventListener('click', () => {
      timecardDraft.rows.push({ id: '', hours: '', minutes: '', comment: '', ticket: '' });
      renderRows();
    });
    const actions = document.createElement('div');
    actions.className = 'clock-edit-actions';
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save codes';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      closeEditors();
      setStatus('');
      renderRows();
    });
    actions.append(save, cancel);
    form.append(title, list, add, ...actorControls(timecardDraft, 'timecard'), actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      saveTimecard(punch.id);
    });
    cell.append(form);
    row.append(cell);
    return row;
  }

  function saveTimecard(id) {
    if (!timecardDraft) return;
    const entries = [];
    let tripTicket = '';
    for (const row of timecardDraft.rows) {
      if (!row.id && !row.hours && !row.minutes && !row.comment.trim() && !String(row.ticket || '').trim()) continue;
      if (row.id === TRIP_TICKET_WORK_TYPE) {
        tripTicket = normalizeTripTicket(row.ticket);
        if (!tripTicket) {
          setStatus('Enter the trip ticket number.', 'error');
          return;
        }
        continue;
      }
      const hours = Number(row.hours);
      const minutes = Number(row.minutes);
      const total = hours * 60 + minutes;
      if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || minutes < 0 || minutes > 59 || total < 1) {
        setStatus('Enter the time for each code.', 'error');
        return;
      }
      entries.push({ id: row.id, minutes: total, comment: row.comment });
    }
    try {
      const punches = stampTripTicket(
        setTimecardEntries(punchesFromState(), id, {
          entries,
          catalog: reasonCodes(),
          office: true,
          account: editorAccount(),
          typedName: timecardDraft.adminName,
          note: timecardDraft.adminNote,
        }),
        id,
        tripTicket
      );
      writePunches(punches);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save those codes.', 'error');
      return;
    }
    rememberTypedName(timecardDraft.adminName);
    closeEditors();
    setStatus('Timecard codes saved.', 'ok');
    refresh();
  }

  function renderRows() {
    const punches = visiblePunches();
    if (editingId && !punches.some((punch) => punch.id === editingId && !punch.removed)) {
      editingId = '';
      editDraft = null;
    }
    if (removingId && !punches.some((punch) => punch.id === removingId && !punch.removed)) {
      removingId = '';
    }
    if (payEditingId && !punches.some((punch) => punch.id === payEditingId && punch.action === 'in' && !punch.removed)) {
      payEditingId = '';
      payDraft = null;
    }
    if (timecardEditingId && !punches.some((punch) => punch.id === timecardEditingId && punch.action === 'out' && !punch.removed)) {
      timecardEditingId = '';
      timecardDraft = null;
    }
    table.replaceChildren();
    if (!punches.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = openDriver ? 'No clock records for this driver yet.' : 'No clock records yet.';
      row.append(cell);
      table.append(row);
      return;
    }
    for (const punch of punches) {
      if (editingId === punch.id && editDraft && !punch.removed) table.append(editRow(punch));
      else if (removingId === punch.id && !punch.removed) table.append(removeRow(punch));
      else if (payEditingId === punch.id && payDraft && !punch.removed) table.append(payRow(punch));
      else if (timecardEditingId === punch.id && timecardDraft && !punch.removed) table.append(timecardRow(punch));
      else table.append(displayRow(punch));
    }
    if (focusSelector) {
      const target = table.querySelector(focusSelector);
      if (target instanceof HTMLElement) target.focus();
      focusSelector = '';
    }
  }

  function chosenReasons(ids, existing) {
    const catalog = new Map(reasonCodes().map((code) => [code.id, code]));
    const previous = new Map(
      (Array.isArray(existing) ? existing : [])
        .filter((code) => code && code.id && code.label)
        .map((code) => [code.id, { id: code.id, label: code.label }])
    );
    return ids.map((id) => catalog.get(id) || previous.get(id)).filter(Boolean);
  }

  function rememberTypedName(typedName) {
    if (!signedInName()) officeName = String(typedName || '').trim();
  }

  function record(action) {
    const driver_name = driverSelect.value.trim();
    const when = timeInput.value;
    if (!driver_name) {
      setStatus('Choose a driver.', 'error');
      return;
    }
    const punched = new Date(when);
    if (!when || Number.isNaN(punched.getTime())) {
      setStatus('Choose a time.', 'error');
      return;
    }
    try {
      const punches = addOfficePunch(punchesFromState(), {
        driver_name,
        action,
        punched_at: punched.toISOString(),
        recordNote: noteInput.value,
        reason_codes: chosenReasons(draftReasonIds),
        account: editorAccount(),
        typedName: adminNameInput?.value,
        note: adminNoteInput?.value,
      });
      writePunches(punches);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not add that record.', 'error');
      return;
    }
    rememberTypedName(adminNameInput?.value);
    noteInput.value = '';
    if (adminNoteInput) adminNoteInput.value = '';
    draftReasonIds = [];
    renderReasonPicks();
    setStatus(action === 'in' ? `${driver_name} clocked in.` : `${driver_name} clocked out.`, 'ok');
    refresh();
  }

  function saveEdit(id) {
    if (!editDraft) return;
    const punched = new Date(editDraft.time);
    if (!editDraft.time || Number.isNaN(punched.getTime())) {
      setStatus('Choose a time.', 'error');
      return;
    }
    const current = punchesFromState().find((punch) => punch.id === id);
    try {
      const punches = changeOfficePunch(punchesFromState(), id, {
        action: editDraft.action,
        punched_at: punched.toISOString(),
        recordNote: editDraft.note,
        reason_codes: chosenReasons(editDraft.reasonIds, current?.reason_codes),
        account: editorAccount(),
        typedName: editDraft.adminName,
        note: editDraft.adminNote,
      });
      writePunches(punches);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save that record.', 'error');
      return;
    }
    rememberTypedName(editDraft.adminName);
    closeEditors();
    setStatus('Record updated.', 'ok');
    refresh();
  }

  function savePeriodPay(id) {
    if (!payDraft) return;
    const punch = punchesFromState().find((item) => item.id === id);
    if (!punch) return;
    const canSplit = payChoicesFor(punch).length > 1 && periodFor(punch);
    const requested = canSplit
      ? payDraft.portions
          .filter((portion) => portion.start || portion.end || portion.payStatus)
          .map((portion) => ({
            start: portion.start ? new Date(portion.start).toISOString() : '',
            end: portion.end ? new Date(portion.end).toISOString() : '',
            pay_status: portion.payStatus,
          }))
      : [];
    try {
      const punches = assignClockPeriodPay(punchesFromState(), id, {
        pay_status: payDraft.payStatus,
        pay_portions: requested,
        allowed: payChoicesFor(punch).map((line) => line.id),
        account: editorAccount(),
        typedName: payDraft.adminName,
        note: payDraft.adminNote,
      });
      writePunches(punches);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save that pay status.', 'error');
      return;
    }
    rememberTypedName(payDraft.adminName);
    closeEditors();
    setStatus('Pay status updated.', 'ok');
    refresh();
  }

  function saveRemoval(id) {
    try {
      const punches = removeOfficePunch(punchesFromState(), id, {
        account: editorAccount(),
        typedName: removeDraft.adminName,
        note: removeDraft.adminNote,
      });
      writePunches(punches);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not remove that record.', 'error');
      return;
    }
    rememberTypedName(removeDraft.adminName);
    removingId = '';
    setStatus('Record removed.', 'ok');
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

  function syncSectionTitle() {
    if (document.body.classList.contains('is-timeclock')) return;
    const payrollShown = document.querySelector('#payroll-view');
    const clockingShown = document.querySelector('#clocking-view');
    const onPayroll = payrollShown && !payrollShown.hidden;
    const onClocking = clockingShown && !clockingShown.hidden;
    if (!onPayroll && !onClocking) return;
    const inDriversWindow = document.body.classList.contains('is-drivers-window');
    if (inDriversWindow) {
      const windowLabel = driversMode() === 'clocking' ? 'Clock records' : 'Drivers';
      document.title = openDriver
        ? `${openDriver} · ${windowLabel} · Teamster Tracker`
        : `${windowLabel} · Teamster Tracker`;
      return;
    }
    const appName = onClocking ? 'Clocking' : 'Payroll';
    document.title = openDriver ? `${openDriver} · ${appName} · Teamster Tracker` : `${appName} · Teamster Tracker`;
  }

  function refresh() {
    if (!timeInput.value) timeInput.value = localStamp(new Date());
    showActorFields();
    fillDrivers();
    fillReasons();
    renderReasonPicks();
    renderDriverList();
    renderChrome();
    renderOpenDriver();
    renderClockRecord();
    renderRows();
    syncSectionTitle();
  }

  return {
    refresh,
    openDriver() {
      return openDriver;
    },
  };
}
