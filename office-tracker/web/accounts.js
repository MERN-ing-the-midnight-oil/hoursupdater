import { createClient } from '@supabase/supabase-js';
import { loadState, onStateSaved, writeStateLocal } from './store.js';

const OFFICE_ROW = 'shared';

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let client = null;
/** @type {{ id: string, email: string, name: string } | null} */
let account = null;
let version = 0;
let pushing = false;
/** @type {() => void} */
let onReplace = () => {};
let pushChain = Promise.resolve();

/**
 * The person signed in on this browser, if accounts are turned on.
 */
export function currentAccount() {
  return account;
}

export function accountsEnabled() {
  return Boolean(client);
}

/**
 * @param {import('@supabase/supabase-js').User | null | undefined} user
 */
function accountFromUser(user) {
  if (!user) return null;
  const email = String(user.email ?? '').trim();
  const name =
    String(user.user_metadata?.display_name ?? '').trim() || email.split('@')[0] || 'Account';
  return { id: user.id, email, name };
}

function showGate(show) {
  const gate = document.querySelector('#account-gate');
  if (!gate) return;
  gate.hidden = !show;
  document.body.classList.toggle('needs-account', show);
  document.body.classList.remove('is-booting');
}

function showChip() {
  const chip = document.querySelector('#account-chip');
  const who = document.querySelector('#account-who');
  if (!chip || !who) return;
  if (!account) {
    chip.hidden = true;
    who.textContent = '';
    return;
  }
  who.textContent = account.name;
  chip.hidden = false;
}

/**
 * @param {unknown} state
 */
function remoteHasRoutes(state) {
  return Boolean(
    state &&
      typeof state === 'object' &&
      state.profiles &&
      Object.keys(state.profiles).length
  );
}

async function readOffice() {
  const { data, error } = await client
    .from('office_state')
    .select('state, version')
    .eq('id', OFFICE_ROW)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function reloadFromRemote() {
  const row = await readOffice();
  if (!row) return;
  version = row.version ?? 0;
  if (remoteHasRoutes(row.state)) {
    writeStateLocal(row.state);
  }
  onReplace();
}

/**
 * @param {ReturnType<typeof loadState>} state
 */
async function push(state) {
  if (!client || !account) return;
  pushing = true;
  try {
    const nextVersion = version + 1;
    const { data, error } = await client
      .from('office_state')
      .update({
        state,
        version: nextVersion,
        updated_at: new Date().toISOString(),
        updated_by: account.id,
      })
      .eq('id', OFFICE_ROW)
      .eq('version', version)
      .select('version')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      await reloadFromRemote();
      return;
    }
    version = data.version;
  } finally {
    pushing = false;
  }
}

/**
 * @param {ReturnType<typeof loadState>} state
 */
function enqueuePush(state) {
  const snapshot = JSON.parse(JSON.stringify(state));
  pushChain = pushChain.then(() => push(snapshot)).catch((error) => {
    const status = document.querySelector('#file-status');
    if (status) {
      status.hidden = false;
      status.textContent = error.message || 'Could not save the shared routes.';
      status.className = 'status is-error';
    }
    const recent = document.querySelector('#recent-changes');
    if (recent) recent.hidden = true;
  });
}

let subscribed = false;

function subscribe() {
  if (subscribed || !client) return;
  subscribed = true;
  client
    .channel('office-state')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'office_state', filter: `id=eq.${OFFICE_ROW}` },
      (payload) => {
        const next = payload.new?.version;
        if (pushing || next == null || next === version) return;
        reloadFromRemote().catch(() => {});
      }
    )
    .subscribe();
}

async function openOffice() {
  const row = await readOffice();
  if (!row) {
    throw new Error('The shared office record is missing. Run the Supabase setup SQL.');
  }
  version = row.version ?? 0;
  if (remoteHasRoutes(row.state) || version > 0) {
    writeStateLocal(
      row.state?.profiles
        ? row.state
        : { version: 1, currentProfileId: null, profiles: {}, drivers: [] }
    );
  }
  subscribe();
  showGate(false);
  showChip();
}

function setAccountStatus(message, kind) {
  const status = document.querySelector('#account-status');
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || '';
  status.className = `status${kind ? ` is-${kind}` : ''}`;
}

function bindAccountForm(onSignedIn) {
  const form = document.querySelector('#account-form');
  const signOut = document.querySelector('#account-sign-out');
  if (!form || form.dataset.bound === '1') return;
  form.dataset.bound = '1';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.querySelector('#account-email')?.value.trim() || '';
    const password = document.querySelector('#account-password')?.value || '';
    if (password.length < 8) {
      setAccountStatus('Use a password of at least 8 characters.', 'error');
      return;
    }
    setAccountStatus('Signing in…');
    const result = await client.auth.signInWithPassword({ email, password });
    if (result.error) {
      setAccountStatus(result.error.message, 'error');
      return;
    }
    account = accountFromUser(result.data.user);
    setAccountStatus('');
    await openOffice();
    onSignedIn();
  });
  signOut?.addEventListener('click', async () => {
    await client.auth.signOut();
    account = null;
    showChip();
    showGate(true);
    setAccountStatus('');
  });
}

/**
 * The published page ships supabase-config.json. The local program answers
 * /api/supabase-config. Either one turns sign-in on.
 */
async function loadAccountConfig() {
  try {
    const response = await fetch('./supabase-config.json', { cache: 'no-store' });
    const type = response.headers.get('content-type') || '';
    if (response.ok && type.includes('json')) {
      const body = await response.json();
      if (body?.url && body?.anonKey) {
        return { enabled: true, url: String(body.url), anonKey: String(body.anonKey) };
      }
    }
  } catch {
    // A missing file is the local page before a build writes the config.
  }
  try {
    const response = await fetch('/api/supabase-config');
    if (response.ok) return await response.json();
  } catch {
    // No local program, and no published config.
  }
  return { enabled: false };
}

/**
 * Ask for a Supabase sign-in when an account project is configured.
 * Otherwise the dashboard keeps using this browser only.
 * @param {{ onReady: () => void, onRemoteReset: () => void }} handlers
 */
export async function startAccounts(handlers) {
  onReplace = handlers.onRemoteReset;
  const config = await loadAccountConfig();
  if (!config?.enabled || !config.url || !config.anonKey) {
    document.body.classList.remove('is-booting');
    handlers.onReady();
    return;
  }
  client = createClient(config.url, config.anonKey);
  onStateSaved((state) => enqueuePush(state));
  bindAccountForm(handlers.onReady);
  const { data } = await client.auth.getSession();
  account = accountFromUser(data.session?.user);
  if (!account) {
    showGate(true);
    return;
  }
  try {
    await openOffice();
  } catch (error) {
    showGate(true);
    setAccountStatus(error.message || 'Could not load the shared routes.', 'error');
    return;
  }
  handlers.onReady();
}
