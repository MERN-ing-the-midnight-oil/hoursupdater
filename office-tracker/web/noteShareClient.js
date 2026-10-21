import { createClient } from '@supabase/supabase-js';

let transport = null;
let anonPromise = null;

function rpcMessage(error) {
  const message = String(error && typeof error === 'object' && 'message' in error ? error.message : '')
    .replace(/^.*ERROR:\s*/i, '')
    .trim();
  return message || 'That note could not be saved.';
}

function rpcBody(data) {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data ?? null;
}

async function anonClient() {
  if (!anonPromise) {
    anonPromise = (async () => {
      try {
        const response = await fetch('./supabase-config.json', { cache: 'no-store' });
        const type = response.headers.get('content-type') || '';
        if (response.ok && type.includes('json')) {
          const config = await response.json();
          if (config?.url && config?.anonKey) {
            return createClient(String(config.url), String(config.anonKey), {
              auth: { persistSession: false, autoRefreshToken: false },
            });
          }
        }
      } catch {
        // The local program answers the same config.
      }
      try {
        const response = await fetch('/api/supabase-config', { cache: 'no-store' });
        const type = response.headers.get('content-type') || '';
        if (!response.ok || !type.includes('json')) return null;
        const config = await response.json();
        if (!config?.enabled || !config.url || !config.anonKey) return null;
        return createClient(String(config.url), String(config.anonKey), {
          auth: { persistSession: false, autoRefreshToken: false },
        });
      } catch {
        return null;
      }
    })();
  }
  return anonPromise;
}

async function tryApi(url, options) {
  if (transport === 'supabase') return null;
  let response;
  try {
    response = await fetch(url, { cache: 'no-store', ...options });
  } catch {
    transport = 'supabase';
    return null;
  }
  const type = response.headers.get('content-type') || '';
  if (!type.includes('json')) {
    transport = 'supabase';
    return null;
  }
  transport = 'api';
  const body = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body };
}

async function shareClient(preferred) {
  if (preferred) return preferred;
  return anonClient();
}

export async function openClockNote(payload, client) {
  const api = await tryApi('/api/clock-note', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (api) return api;
  const supabase = await shareClient(client);
  if (!supabase) return { ok: false, status: 401, body: { error: 'Sign in to open a notes link.' } };
  const { data, error } = await supabase.rpc('open_clock_note', { payload });
  if (error) return { ok: false, status: 400, body: { error: rpcMessage(error) } };
  const body = rpcBody(data);
  if (!body) return { ok: false, status: 404, body: { error: 'That notes link is not valid.' } };
  return { ok: true, status: 200, body };
}

export async function openClockNoteDay(payload, client) {
  const api = await tryApi('/api/clock-note-day', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (api) return api;
  const supabase = await shareClient(client);
  if (!supabase) return { ok: false, status: 401, body: { error: 'Sign in to open a notes link.' } };
  const { data, error } = await supabase.rpc('open_clock_note_day', { payload });
  if (error) return { ok: false, status: 400, body: { error: rpcMessage(error) } };
  const body = rpcBody(data);
  if (!body) return { ok: false, status: 404, body: { error: 'That notes link is not valid.' } };
  return { ok: true, status: 200, body };
}

export async function readClockNote(token) {
  const api = await tryApi(`/api/clock-note/${encodeURIComponent(token)}`);
  if (api) return api;
  const supabase = await anonClient();
  if (!supabase) return { ok: false, status: 404, body: { error: 'This notes link is not valid.' } };
  const { data, error } = await supabase.rpc('read_clock_note', { link_token: token });
  if (error) return { ok: false, status: 400, body: { error: rpcMessage(error) } };
  const body = rpcBody(data);
  if (!body) return { ok: false, status: 404, body: { error: 'This notes link is not valid.' } };
  return { ok: true, status: 200, body };
}

export async function readClockNoteDay(token) {
  const api = await tryApi(`/api/clock-note-day/${encodeURIComponent(token)}`);
  if (api) return api;
  const supabase = await anonClient();
  if (!supabase) return { ok: false, status: 404, body: { error: 'This notes link is not valid.' } };
  const { data, error } = await supabase.rpc('read_clock_note_day', { link_token: token });
  if (error) return { ok: false, status: 400, body: { error: rpcMessage(error) } };
  const body = rpcBody(data);
  if (!body) return { ok: false, status: 404, body: { error: 'This notes link is not valid.' } };
  return { ok: true, status: 200, body };
}

export async function saveClockNote(token, payload, client) {
  const api = await tryApi(`/api/clock-note/${encodeURIComponent(token)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (api) return api;
  const supabase = await shareClient(client);
  if (!supabase) return { ok: false, status: 404, body: { error: 'This notes link is not valid.' } };
  const { data, error } = await supabase.rpc('save_clock_note', { link_token: token, payload });
  if (error) return { ok: false, status: 400, body: { error: rpcMessage(error) } };
  const wrapped = rpcBody(data);
  if (!wrapped?.slot) return { ok: false, status: 404, body: { error: 'This notes link is not valid.' } };
  if (wrapped.conflict) return { ok: false, status: 409, body: wrapped.slot };
  return { ok: true, status: 200, body: wrapped.slot };
}
