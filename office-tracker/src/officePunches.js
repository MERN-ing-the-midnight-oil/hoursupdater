import { NOTE_MAX } from '../../src/logic/clockKiosk.js';
import { pairClockPunches } from '../../src/logic/timesheets.js';
import { isPayLineId, normalizePayPortions, payPortionError } from './driverPay.js';
import {
  normalizeTimecardEntries,
  payPeriodStillOpen,
  sessionForClockOut,
  timecardEntryError,
} from './timecardEntries.js';

const NAME_MAX = 80;

export function normalizeOfficeEdits(raw) {
  if (!Array.isArray(raw)) return [];
  const edits = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const action = item.action === 'add' || item.action === 'change' || item.action === 'delete' ? item.action : '';
    const note = String(item.note || '').trim();
    const by = String(item.by || '').trim();
    const at = String(item.at || '').trim();
    if (!action || !note || note.length > NOTE_MAX || !by || by.length > NAME_MAX) continue;
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) continue;
    const id = String(item.by_user_id || '').trim();
    edits.push({
      action,
      note,
      by,
      by_user_id: id || null,
      at: when.toISOString(),
    });
  }
  return edits;
}

// The person recorded on an office change.
// A signed-in name wins over anything typed.
export function officeEditor(account, typedName) {
  const signedIn = String(account?.name ?? '').trim();
  if (signedIn) {
    const id = String(account?.id ?? '').trim();
    return { by: signedIn.slice(0, NAME_MAX), by_user_id: id || null };
  }
  const by = String(typedName ?? '').trim();
  if (!by) throw new Error('Enter your name.');
  if (by.length > NAME_MAX) throw new Error(`A name can be ${NAME_MAX} characters or fewer.`);
  return { by, by_user_id: null };
}

export function officeEditNote(note) {
  const text = String(note ?? '').trim();
  if (!text) throw new Error('Leave a note.');
  if (text.length > NOTE_MAX) throw new Error(`A note can be ${NOTE_MAX} characters or fewer.`);
  return text;
}

function editEntry(account, typedName, note, action, at) {
  const when = at ? new Date(at) : new Date();
  if (Number.isNaN(when.getTime())) throw new Error('That time is not valid.');
  return {
    action,
    note: officeEditNote(note),
    ...officeEditor(account, typedName),
    at: when.toISOString(),
  };
}

function recordNote(note) {
  return String(note ?? '').trim().slice(0, NOTE_MAX);
}

function punchAction(action) {
  if (action === 'out') return 'out';
  if (action === 'in') return 'in';
  throw new Error('Choose clock in or clock out.');
}

export function addOfficePunch(punches, input) {
  const driver_name = String(input.driver_name ?? '').trim();
  if (!driver_name) throw new Error('Choose a driver.');
  const punched = new Date(input.punched_at);
  if (!input.punched_at || Number.isNaN(punched.getTime())) throw new Error('Choose a time.');
  const entry = editEntry(input.account, input.typedName, input.note, 'add', input.at);
  const punch = {
    id: String(input.id || '').trim() || crypto.randomUUID(),
    driver_name,
    action: punchAction(input.action),
    punched_at: punched.toISOString(),
    note: recordNote(input.recordNote),
    reason_codes: Array.isArray(input.reason_codes) ? input.reason_codes : [],
    office_edits: [entry],
  };
  return [...(Array.isArray(punches) ? punches : []), punch];
}

function findPunch(punches, id) {
  const list = Array.isArray(punches) ? punches : [];
  const index = list.findIndex((punch) => punch?.id === id);
  if (index < 0) throw new Error('That record is not on the list.');
  if (list[index].removed === true) throw new Error('That record was already removed.');
  return { list, index };
}

export function changeOfficePunch(punches, id, input) {
  const { list, index } = findPunch(punches, id);
  const punched = new Date(input.punched_at);
  if (!input.punched_at || Number.isNaN(punched.getTime())) throw new Error('Choose a time.');
  const entry = editEntry(input.account, input.typedName, input.note, 'change', input.at);
  const current = list[index];
  const next = list.slice();
  const punch = {
    ...current,
    action: punchAction(input.action),
    punched_at: punched.toISOString(),
    note: recordNote(input.recordNote),
    reason_codes: Array.isArray(input.reason_codes) ? input.reason_codes : current.reason_codes,
    office_edits: [...normalizeOfficeEdits(current.office_edits), entry],
  };
  if (punch.action !== 'in') delete punch.pay_portions;
  if (punch.action !== 'out') delete punch.timecard_entries;
  next[index] = punch;
  return next;
}

// Timecard codes, times, and comments on a clock-out.
// A driver can save while the pay period is open.
// The office can save later, and that save records an admin note.
export function setTimecardEntries(punches, id, input) {
  const { list, index } = findPunch(punches, id);
  const current = list[index];
  if (current.action !== 'out') throw new Error('Timecard codes go on the clock out.');
  const session = sessionForClockOut(list, id);
  if (!session) throw new Error('Clock in before adding timecard codes.');
  const catalog = Array.isArray(input.catalog) ? input.catalog : [];
  const requested = Array.isArray(input.entries) ? input.entries : [];
  const error = timecardEntryError(requested, session.minutes, catalog);
  if (error) throw new Error(error);
  if (!input.office) {
    const when = new Date(current.punched_at);
    if (
      !payPeriodStillOpen(
        when,
        input.periods,
        input.now instanceof Date ? input.now : new Date(),
        input.periodEndsAt
      )
    ) {
      throw new Error('That pay period is closed.');
    }
  }
  const entries = normalizeTimecardEntries(requested, catalog);
  const punch = { ...current };
  if (entries.length) punch.timecard_entries = entries;
  else delete punch.timecard_entries;
  if (input.office) {
    const entry = editEntry(input.account, input.typedName, input.note, 'change', input.at);
    punch.office_edits = [...normalizeOfficeEdits(current.office_edits), entry];
  }
  const next = list.slice();
  next[index] = punch;
  return next;
}

// The clock in's pay status covers the whole period.
// pay_portions, when present, covers only those parts.
export function assignClockPeriodPay(punches, id, input) {
  const { list, index } = findPunch(punches, id);
  const current = list[index];
  if (current.action !== 'in') throw new Error('Set the pay status on the clock in.');
  const status = String(input.pay_status || '').trim();
  if (!isPayLineId(status)) throw new Error('Choose a pay status.');
  const entry = editEntry(input.account, input.typedName, input.note, 'change', input.at);
  const requested = Array.isArray(input.pay_portions) ? input.pay_portions : [];
  let portions = [];
  let periodStatus = status;
  if (requested.length) {
    const driver = String(current.driver_name || '').trim().toLowerCase();
    const { pairs } = pairClockPunches(
      list.filter((punch) => String(punch?.driver_name || '').trim().toLowerCase() === driver)
    );
    const pair = pairs.find((item) => item.clockIn?.id === current.id);
    if (!pair) throw new Error('Clock out before assigning part of the period.');
    const start = pair.start <= pair.end ? pair.start : pair.end;
    const end = pair.start <= pair.end ? pair.end : pair.start;
    const error = payPortionError(requested, start, end, input.allowed);
    if (error) throw new Error(error);
    portions = normalizePayPortions(requested, start, end, input.allowed);
    const only = portions.length === 1 ? portions[0] : null;
    if (
      only &&
      new Date(only.start).getTime() <= start.getTime() &&
      new Date(only.end).getTime() >= end.getTime()
    ) {
      periodStatus = only.pay_status;
      portions = [];
    }
  }
  const next = list.slice();
  const punch = {
    ...current,
    pay_status: periodStatus,
    office_edits: [...normalizeOfficeEdits(current.office_edits), entry],
  };
  if (portions.length) punch.pay_portions = portions;
  else delete punch.pay_portions;
  next[index] = punch;
  return next;
}

// Keeps the record, marked removed, so the note and the admin stay with it.
// Payroll and the driver screen skip a removed record.
export function removeOfficePunch(punches, id, input) {
  const { list, index } = findPunch(punches, id);
  const entry = editEntry(input.account, input.typedName, input.note, 'delete', input.at);
  const next = list.slice();
  next[index] = {
    ...list[index],
    removed: true,
    office_edits: [...normalizeOfficeEdits(list[index].office_edits), entry],
  };
  return next;
}
