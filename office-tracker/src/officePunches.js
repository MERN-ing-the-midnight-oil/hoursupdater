/**
 * Office changes to a clock record. Adding, changing, or removing one
 * requires a note and the name of the person who did it.
 * A signed-in account is that name. Otherwise the person types their name.
 */

import { NOTE_MAX } from '../../src/logic/clockKiosk.js';

const NAME_MAX = 80;

/**
 * @param {unknown} raw
 * @returns {Array<{ action: 'add' | 'change' | 'delete', note: string, by: string, by_user_id: string | null, at: string }>}
 */
export function normalizeOfficeEdits(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Array<{ action: 'add' | 'change' | 'delete', note: string, by: string, by_user_id: string | null, at: string }>} */
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

/**
 * The person recorded on an office change.
 * A signed-in name wins over anything typed.
 * @param {{ id?: string, name?: string } | null | undefined} account
 * @param {unknown} typedName
 */
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

/**
 * @param {unknown} note
 */
export function officeEditNote(note) {
  const text = String(note ?? '').trim();
  if (!text) throw new Error('Leave a note.');
  if (text.length > NOTE_MAX) throw new Error(`A note can be ${NOTE_MAX} characters or fewer.`);
  return text;
}

/**
 * @param {{ id?: string, name?: string } | null | undefined} account
 * @param {unknown} typedName
 * @param {unknown} note
 * @param {'add' | 'change' | 'delete'} action
 * @param {string | undefined} at
 */
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

/**
 * @param {unknown} note
 */
function recordNote(note) {
  return String(note ?? '').trim().slice(0, NOTE_MAX);
}

/**
 * @param {unknown} action
 */
function punchAction(action) {
  if (action === 'out') return 'out';
  if (action === 'in') return 'in';
  throw new Error('Choose clock in or clock out.');
}

/**
 * @param {object[] | null | undefined} punches
 * @param {{
 *   id?: string,
 *   driver_name: string,
 *   action: unknown,
 *   punched_at: string,
 *   recordNote?: unknown,
 *   reason_codes?: object[],
 *   account?: { id?: string, name?: string } | null,
 *   typedName?: unknown,
 *   note: unknown,
 *   at?: string,
 * }} input
 */
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

/**
 * @param {object[] | null | undefined} punches
 * @param {string} id
 */
function findPunch(punches, id) {
  const list = Array.isArray(punches) ? punches : [];
  const index = list.findIndex((punch) => punch?.id === id);
  if (index < 0) throw new Error('That record is not on the list.');
  if (list[index].removed === true) throw new Error('That record was already removed.');
  return { list, index };
}

/**
 * @param {object[] | null | undefined} punches
 * @param {string} id
 * @param {{
 *   action: unknown,
 *   punched_at: string,
 *   recordNote?: unknown,
 *   reason_codes?: object[],
 *   account?: { id?: string, name?: string } | null,
 *   typedName?: unknown,
 *   note: unknown,
 *   at?: string,
 * }} input
 */
export function changeOfficePunch(punches, id, input) {
  const { list, index } = findPunch(punches, id);
  const punched = new Date(input.punched_at);
  if (!input.punched_at || Number.isNaN(punched.getTime())) throw new Error('Choose a time.');
  const entry = editEntry(input.account, input.typedName, input.note, 'change', input.at);
  const current = list[index];
  const next = list.slice();
  next[index] = {
    ...current,
    action: punchAction(input.action),
    punched_at: punched.toISOString(),
    note: recordNote(input.recordNote),
    reason_codes: Array.isArray(input.reason_codes) ? input.reason_codes : current.reason_codes,
    office_edits: [...normalizeOfficeEdits(current.office_edits), entry],
  };
  return next;
}

/**
 * Keeps the record, marked removed, so the note and the admin stay with it.
 * Payroll and the driver screen skip a removed record.
 * @param {object[] | null | undefined} punches
 * @param {string} id
 * @param {{
 *   account?: { id?: string, name?: string } | null,
 *   typedName?: unknown,
 *   note: unknown,
 *   at?: string,
 * }} input
 */
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
