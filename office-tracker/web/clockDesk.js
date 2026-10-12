/**
 * Office clock. A signed-in person records a driver's clock in or clock out.
 * The records stay on the shared office and feed the payroll spreadsheet.
 */

import { addOfficePunch, changeOfficePunch, removeOfficePunch } from '../src/officePunches.js';
import { punchRunLabel } from '../../src/logic/timesheets.js';
import { buildDriverClockRecord, CLOCK_RECORD_COLUMNS } from '../src/driverClockRecord.js';
import { driverPayStatusChoices, normalizeClockPayDefaults } from '../src/driverPay.js';
import { compareRouteNumbers, driversFromState } from './store.js';

/**
 * @param {{
 *   readState: () => { punches?: object[], profiles?: object },
 *   writePunches: (punches: object[]) => void,
 *   listNames: () => string[],
 *   asOf?: () => string,
 *   readAccount?: () => { id?: string, name?: string } | null,
 *   onOpenHistory?: (name: string) => void,
 * }} options
 */
export function mountClockDesk({ readState, writePunches, listNames, asOf, readAccount, onOpenHistory }) {
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
  let editingId = '';
  let removingId = '';
  /** @type {{ time: string, action: string, note: string, reasonIds: string[], adminNote: string, adminName: string } | null} */
  let editDraft = null;
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

  function driverInfo(name) {
    const state = readState() || {};
    const driver = driversFromState(state).find(
      (item) => item.name.trim().toLowerCase() === String(name || '').trim().toLowerCase()
    );
    const defaults = normalizeClockPayDefaults(state.clockPayDefaults);
    const statuses = driverPayStatusChoices(driver?.payStatuses, defaults.lines).map((line) => line.label);
    const routes = routesFor(name);
    /** @type {Array<[string, string]>} */
    const facts = [['Routes', routes.length ? routes.join(', ') : 'No route']];
    if (driver?.email) facts.push(['Email', driver.email]);
    if (driver?.phone) facts.push(['Phone', driver.phone]);
    if (driver?.pay?.serial) facts.push(['Serial number', driver.pay.serial]);
    if (driver?.pay?.rate) facts.push(['Hourly rate', driver.pay.rate]);
    if (driver?.pay?.account) facts.push(['Payroll account', driver.pay.account]);
    if (statuses.length) facts.push(['Pay status', statuses.join(', ')]);
    return facts;
  }

  function renderClockRecord() {
    const open = Boolean(openDriver) && driversMode() === 'payroll';
    if (!recordBody || !recordHead) return;
    if (!open) {
      recordHead.replaceChildren();
      recordBody.replaceChildren();
      recordJumps?.replaceChildren();
      driverFacts?.replaceChildren();
      return;
    }
    if (driverSheetTitle) driverSheetTitle.textContent = openDriver;
    if (driverFacts) {
      driverFacts.replaceChildren();
      for (const [label, value] of driverInfo(openDriver)) {
        const group = document.createElement('div');
        const term = document.createElement('dt');
        term.textContent = label;
        const detail = document.createElement('dd');
        detail.textContent = value;
        group.append(term, detail);
        driverFacts.append(group);
      }
    }
    const state = readState() || {};
    const periods = buildDriverClockRecord(
      state.punches,
      normalizeClockPayDefaults(state.clockPayDefaults).periods,
      openDriver,
      officeNow()
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
    const route = punchRunLabel(punch.run);
    const label = route ? `${kind} · ${route}` : kind;
    const covering = punch.substitute_name ? `${label} · ${punch.substitute_name}` : label;
    return punch.removed ? `${covering} · Removed` : covering;
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
    editDraft = null;
  }

  function beginEdit(punch) {
    editingId = punch.id;
    removingId = '';
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
    editDraft = null;
    removeDraft = { adminNote: '', adminName: rememberedName() };
    focusSelector = '[data-remove="admin-note"]';
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
    note.textContent = punch.note || '';
    const reasons = document.createElement('td');
    reasons.textContent = (Array.isArray(punch.reason_codes) ? punch.reason_codes : [])
      .map((code) => code.label)
      .filter(Boolean)
      .join(', ');
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
        ),
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

  function renderRows() {
    const punches = visiblePunches();
    if (editingId && !punches.some((punch) => punch.id === editingId && !punch.removed)) {
      editingId = '';
      editDraft = null;
    }
    if (removingId && !punches.some((punch) => punch.id === removingId && !punch.removed)) {
      removingId = '';
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
