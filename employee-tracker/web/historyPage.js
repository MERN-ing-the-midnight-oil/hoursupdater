import { createClient } from '@supabase/supabase-js';
import {
  PAGE_PASSWORD,
  driverHistoryHtml,
  prepareCalendar,
  profilesFromPayload,
  routeHistoryHtml,
  searchHistory,
  shareMailHref,
  sharePayload,
  shareTextHref,
} from './publicHistory.js';

const SESSION_KEY = 'route-history-unlocked';
const SUGGEST_LIMIT = 12;

const gate = document.querySelector('#gate');
const gateForm = document.querySelector('#gate-form');
const passwordInput = document.querySelector('#password');
const gateStatus = document.querySelector('#gate-status');
const app = document.querySelector('#app');
const searchForm = document.querySelector('#search-form');
const modeInputs = [...document.querySelectorAll('input[name="by"]')];
const queryInput = document.querySelector('#query');
const suggest = document.querySelector('#suggest');
const suggestMore = document.querySelector('#suggest-more');
const history = document.querySelector('#history');
const pageStatus = document.querySelector('#page-status');
const shareDialog = document.querySelector('#share-dialog');
const guideDialog = document.querySelector('#guide-dialog');
const guideFrame = document.querySelector('#guide-frame');
const dayDialog = document.querySelector('#day-dialog');
const dayTitle = document.querySelector('#day-dialog-title');
const dayList = document.querySelector('#day-dialog-list');

let profiles = [];

function setStatus(node, message) {
  if (!node) return;
  node.textContent = message || '';
}

function mode() {
  return modeInputs.find((input) => input.checked)?.value === 'route' ? 'route' : 'driver';
}

function placeholder() {
  return mode() === 'route' ? 'Type a route number' : 'Type a driver name';
}

async function loadConfig() {
  const response = await fetch('./supabase-config.json', { cache: 'no-store' });
  if (!response.ok) return null;
  const config = await response.json();
  if (!config?.url || !config?.anonKey) return null;
  return config;
}

async function loadOffice(pass) {
  const config = await loadConfig();
  if (!config) {
    throw new Error('This page cannot reach the office record yet.');
  }
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc('public_route_history', { pass });
  if (error) throw new Error('The office record is not available from this page yet.');
  if (!data || typeof data !== 'object') {
    const rejected = new Error('That password is not right.');
    rejected.rejected = true;
    throw rejected;
  }
  prepareCalendar(data.schoolYear);
  profiles = profilesFromPayload(data);
}

function showApp() {
  gate.hidden = true;
  app.hidden = false;
  queryInput.placeholder = placeholder();
  queryInput.focus();
}

function showSuggestions() {
  const matches = searchHistory(profiles, { by: mode(), query: queryInput.value });
  suggest.replaceChildren();
  const shown = matches.slice(0, SUGGEST_LIMIT);
  for (const match of shown) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = match.label;
    button.addEventListener('click', () => choose(match));
    item.append(button);
    suggest.append(item);
  }
  const extra = matches.length - shown.length;
  suggest.hidden = shown.length === 0;
  suggestMore.hidden = extra <= 0;
  suggestMore.textContent = extra > 0 ? 'Keep typing to narrow the list.' : '';
  if (!queryInput.value.trim()) {
    suggest.hidden = true;
    suggestMore.hidden = true;
    setStatus(pageStatus, profiles.length ? '' : 'No routes are recorded yet.');
  } else if (!shown.length) {
    setStatus(pageStatus, mode() === 'route' ? 'No route matches that.' : 'No driver matches that.');
  } else {
    setStatus(pageStatus, '');
  }
}

function choose(match) {
  queryInput.value = match.label;
  suggest.hidden = true;
  suggestMore.hidden = true;
  setStatus(pageStatus, '');
  history.innerHTML =
    match.kind === 'route'
      ? routeHistoryHtml(profiles, match.key)
      : driverHistoryHtml(profiles, match.key);
  document.title =
    match.kind === 'route' ? `Route ${match.label} · Route change history` : `${match.label} · Route change history`;
}

async function unlock(pass) {
  setStatus(gateStatus, 'Opening the office record…');
  try {
    await loadOffice(pass);
  } catch (error) {
    setStatus(gateStatus, error.rejected ? 'That password is not right.' : error.message);
    if (error.rejected) passwordInput.focus();
    return;
  }
  sessionStorage.setItem(SESSION_KEY, '1');
  setStatus(gateStatus, '');
  showApp();
}

gateForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const pass = passwordInput.value.trim();
  if (pass !== PAGE_PASSWORD) {
    setStatus(gateStatus, 'That password is not right.');
    passwordInput.focus();
    return;
  }
  unlock(pass);
});

searchForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const matches = searchHistory(profiles, { by: mode(), query: queryInput.value });
  const exact = matches.find((match) => match.label.toLowerCase() === queryInput.value.trim().toLowerCase());
  if (exact) choose(exact);
  else if (matches.length === 1) choose(matches[0]);
  else showSuggestions();
});

queryInput?.addEventListener('input', showSuggestions);

for (const input of modeInputs) {
  input.addEventListener('change', () => {
    queryInput.value = '';
    queryInput.placeholder = placeholder();
    history.innerHTML = '';
    document.title = 'Route change history';
    suggest.hidden = true;
    suggestMore.hidden = true;
    setStatus(pageStatus, '');
    queryInput.focus();
  });
}

history?.addEventListener('click', (event) => {
  const day = event.target.closest?.('.cal-day[data-date]');
  if (!day || !dayDialog || !dayList || !dayTitle) return;
  const lines = [...day.querySelectorAll('.cal-hover li')].map((item) => item.textContent || '').filter(Boolean);
  if (!lines.length) return;
  dayTitle.textContent = day.dataset.date || 'Day';
  dayList.replaceChildren();
  for (const line of lines) {
    const item = document.createElement('li');
    item.textContent = line;
    dayList.append(item);
  }
  dayDialog.showModal();
});

function openShareFallback() {
  const email = document.querySelector('#share-email');
  const text = document.querySelector('#share-text');
  if (email) email.href = shareMailHref();
  if (text) text.href = shareTextHref(navigator.userAgent);
  shareDialog?.showModal();
}

document.querySelector('#share-open')?.addEventListener('click', async () => {
  if (navigator.share) {
    try {
      await navigator.share(sharePayload());
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  openShareFallback();
});

document.querySelector('#share-dialog-close')?.addEventListener('click', () => {
  shareDialog?.close();
});

document.querySelector('#guide-open')?.addEventListener('click', () => {
  if (guideFrame && guideFrame.dataset.loaded !== '1') {
    guideFrame.src = './clock-hours-guide.html';
    guideFrame.dataset.loaded = '1';
  }
  guideDialog?.showModal();
});

document.querySelector('#guide-dialog-close')?.addEventListener('click', () => {
  guideDialog?.close();
});

document.querySelector('#day-dialog-close')?.addEventListener('click', () => {
  dayDialog?.close();
});

if (sessionStorage.getItem(SESSION_KEY) === '1') {
  unlock(PAGE_PASSWORD);
}
