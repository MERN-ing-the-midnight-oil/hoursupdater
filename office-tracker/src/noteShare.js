import { NOTE_MAX, REASON_LABEL_MAX } from '../../src/logic/clockKiosk.js';

function randomToken() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const RUNS = new Set(['AM', 'MIDDAY', 'PM', 'OTHER']);
const ACTIONS = new Set(['in', 'out']);
const SLOT_NAME = { AM: 'AM', MIDDAY: 'MID', PM: 'PM', OTHER: 'OTHER' };
const DAY_MS = 36 * 60 * 60 * 1000;

export function noteSlotLabel(run, action) {
  const name = SLOT_NAME[String(run || '')];
  if (!name || !ACTIONS.has(String(action || ''))) return '';
  return `${name} ${action === 'in' ? 'IN' : 'OUT'}`;
}

export function noteShareUrl(origin, token) {
  const base = String(origin || '').replace(/\/$/, '');
  const link = String(token || '').trim();
  if (!base || !link) return '';
  return `${base}/driver-note.html?t=${encodeURIComponent(link)}`;
}

// One link for every punched row on this driver's day.
export function noteDayUrl(origin, token) {
  const base = String(origin || '').replace(/\/$/, '');
  const link = String(token || '').trim();
  if (!base || !link) return '';
  return `${base}/driver-note.html?d=${encodeURIComponent(link)}`;
}

function driverName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 80) throw new Error('Choose a driver.');
  return name;
}

function slotDate(value) {
  const date = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('That notes link is not valid.');
  return date;
}

function slotIdentity(run, action) {
  const route = String(run || '');
  const side = String(action || '');
  if (!RUNS.has(route) || !ACTIONS.has(side)) throw new Error('That notes link is not valid.');
  return { run: route, action: side };
}

function catalogFrom(raw) {
  if (!Array.isArray(raw)) return [];
  const codes = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    const label = String(item.label || '').trim();
    if (!id || !label || label.length > REASON_LABEL_MAX || seen.has(id)) continue;
    seen.add(id);
    codes.push({ id, label });
    if (codes.length >= 80) break;
  }
  return codes;
}

function noteText(raw) {
  const note = String(raw ?? '').trim();
  if (note.length > NOTE_MAX) throw new Error(`A note can be ${NOTE_MAX} characters or fewer.`);
  return note;
}

// Reasons already stored, plus the office list, are the only ones a phone can keep.
// A clock seeding the link skips a reason that has no time. A phone save does not.
function reasonsFrom(raw, catalog, already = [], strict = true) {
  if (!Array.isArray(raw)) {
    if (!strict) return [];
    throw new Error('Choose a reason.');
  }
  const allowed = new Map();
  for (const code of catalog) allowed.set(code.id, code.label);
  for (const code of already) {
    if (!allowed.has(code.id)) allowed.set(code.id, code.label);
  }
  const reasons = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      if (!strict) continue;
      throw new Error('Choose a reason.');
    }
    const id = String(item.id || '').trim();
    if (!id || !allowed.has(id) || seen.has(id)) {
      if (!strict) continue;
      throw new Error(seen.has(id) ? 'That reason is already on this note.' : 'Choose a reason.');
    }
    const minutes = Number(item.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) {
      if (!strict) continue;
      throw new Error('Use whole minutes, up to 1440.');
    }
    seen.add(id);
    reasons.push({ id, label: allowed.get(id) || '', minutes });
    if (reasons.length > 20) throw new Error('That note has too many reasons.');
  }
  return reasons;
}

function clockText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function editableUntilMs(value) {
  if (value == null || value === '') return null;
  const time = new Date(String(value)).getTime();
  if (!Number.isFinite(time)) throw new Error('That pay period end time is not valid.');
  return time;
}

function publicSlot(session, now) {
  const editableUntil = session.editableUntil;
  return {
    token: session.token,
    driverName: session.driverName,
    run: session.run,
    action: session.action,
    date: session.date,
    label: noteSlotLabel(session.run, session.action),
    note: session.note,
    reasons: session.reasons.map((reason) => ({ ...reason })),
    catalog: session.catalog.map((code) => ({ ...code })),
    revision: session.revision,
    editableUntil: editableUntil == null ? null : new Date(editableUntil).toISOString(),
    closed: editableUntil != null && now > editableUntil,
  };
}

// In-memory notes for the office server. A phone and the clock share one slot.
// Nothing in here creates a punch.
export function createNoteShare(options = {}) {
  const now = options.now || (() => Date.now());
  const token = options.token || randomToken;
  const sessions = new Map();
  const bySlot = new Map();
  const days = new Map();
  const byDay = new Map();

  function prune() {
    const cutoff = now() - DAY_MS;
    for (const [link, session] of sessions) {
      if (session.touched >= cutoff) continue;
      sessions.delete(link);
      bySlot.delete(session.key);
    }
    for (const [link, day] of days) {
      if (day.touched >= cutoff) continue;
      days.delete(link);
      byDay.delete(day.key);
    }
  }

  function publicDay(day) {
    const moment = now();
    const editableUntil = day.editableUntil;
    const rows = [];
    for (const row of day.rows) {
      const session = sessions.get(row.token);
      if (!session) continue;
      rows.push({
        token: session.token,
        run: session.run,
        action: session.action,
        label: noteSlotLabel(session.run, session.action),
        clock: row.clock,
        note: session.note,
        reasons: session.reasons.map((reason) => ({ ...reason })),
        revision: session.revision,
      });
    }
    return {
      token: day.token,
      driverName: day.driverName,
      date: day.date,
      catalog: day.catalog.map((code) => ({ ...code })),
      rows,
      editableUntil: editableUntil == null ? null : new Date(editableUntil).toISOString(),
      closed: editableUntil != null && moment > editableUntil,
    };
  }

  // The clock sends only the rows that already have a punch.
  // Opening again replaces that list and does not erase a note the phone saved.
  function openDay(body) {
    prune();
    const name = driverName(body?.driverName);
    const date = slotDate(body?.date);
    const until = editableUntilMs(body?.editableUntil);
    const catalog = catalogFrom(body?.catalog);
    const rawRows = Array.isArray(body?.rows) ? body.rows.slice(0, 12) : [];
    const rows = [];
    const seen = new Set();
    for (const item of rawRows) {
      let identity;
      try {
        identity = slotIdentity(item?.run, item?.action);
      } catch {
        continue;
      }
      const id = `${identity.run}|${identity.action}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const slot = open({
        driverName: name,
        run: identity.run,
        action: identity.action,
        date,
        editableUntil: until == null ? undefined : new Date(until).toISOString(),
        note: item?.note,
        reasons: item?.reasons,
        catalog,
      });
      rows.push({ token: slot.token, clock: clockText(item?.clock) });
    }
    const key = `${name.toLowerCase()}|${date}|day`;
    const existingToken = byDay.get(key);
    const existing = existingToken ? days.get(existingToken) : null;
    if (existing) {
      existing.driverName = name;
      existing.catalog = catalog;
      existing.rows = rows;
      if (until != null) existing.editableUntil = until;
      existing.touched = now();
      return publicDay(existing);
    }
    const link = token();
    const day = {
      token: link,
      key,
      driverName: name,
      date,
      catalog,
      rows,
      editableUntil: until,
      touched: now(),
    };
    days.set(link, day);
    byDay.set(key, link);
    return publicDay(day);
  }

  function readDay(link) {
    prune();
    const day = days.get(String(link || '').trim());
    if (!day) return null;
    day.touched = now();
    return publicDay(day);
  }

  function open(body) {
    prune();
    const name = driverName(body?.driverName);
    const { run, action } = slotIdentity(body?.run, body?.action);
    const date = slotDate(body?.date);
    const key = `${name.toLowerCase()}|${date}|${run}|${action}`;
    const existingToken = bySlot.get(key);
    const existing = existingToken ? sessions.get(existingToken) : null;
    const until = editableUntilMs(body?.editableUntil);
    if (existing) {
      existing.driverName = name;
      existing.catalog = catalogFrom(body?.catalog);
      if (until != null) existing.editableUntil = until;
      existing.touched = now();
      return publicSlot(existing, now());
    }
    const link = token();
    const catalog = catalogFrom(body?.catalog);
    const session = {
      token: link,
      key,
      driverName: name,
      run,
      action,
      date,
      note: noteText(body?.note),
      reasons: reasonsFrom(body?.reasons, catalog, [], false),
      catalog,
      revision: 1,
      editableUntil: until,
      touched: now(),
    };
    sessions.set(link, session);
    bySlot.set(key, link);
    return publicSlot(session, now());
  }

  function read(link) {
    prune();
    const session = sessions.get(String(link || '').trim());
    if (!session) return null;
    session.touched = now();
    return publicSlot(session, now());
  }

  function save(link, body) {
    prune();
    const session = sessions.get(String(link || '').trim());
    if (!session) return null;
    if (session.editableUntil != null && now() > session.editableUntil) {
      throw new Error('That pay period is closed.');
    }
    const claimed = Number(body?.revision);
    if (!Number.isInteger(claimed) || claimed !== session.revision) {
      return { conflict: true, slot: publicSlot(session, now()) };
    }
    const note = noteText(body?.note);
    const reasons = reasonsFrom(body?.reasons, session.catalog, session.reasons);
    session.note = note;
    session.reasons = reasons;
    session.revision += 1;
    session.touched = now();
    return { conflict: false, slot: publicSlot(session, now()) };
  }

  return { open, read, save, openDay, readDay };
}
