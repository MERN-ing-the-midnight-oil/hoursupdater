import { createClient } from '@supabase/supabase-js';
import { mountAuditGenie } from '../../office-tracker/web/auditGenie.js';
import {
  PAGE_PASSWORD,
  driverHistoryHtml,
  historyOptions,
  prepareCalendar,
  profilesFromPayload,
  routeHistoryHtml,
  shareMailHref,
  sharePayload,
  shareTextHref,
} from './publicHistory.js';

const SESSION_KEY = 'route-history-unlocked';
const PAGE_TITLE = 'Teamster Tools';

const gate = document.querySelector('#gate');
const landingShare = document.querySelector('#landing-share');
const back = document.querySelector('#back');
const gateForm = document.querySelector('#gate-form');
const passwordInput = document.querySelector('#password');
const gateStatus = document.querySelector('#gate-status');
const app = document.querySelector('#app');
const searchForm = document.querySelector('#search-form');
const modeInputs = [...document.querySelectorAll('input[name="by"]')];
const lookup = document.querySelector('#lookup');
const lookupLabel = document.querySelector('#lookup-label');
const history = document.querySelector('#history');
const pageStatus = document.querySelector('#page-status');
const historyTool = document.querySelector('#history-tool');
const auditTool = document.querySelector('#audit-tool');
const toolHome = document.querySelector('#tool-home');
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

function showHome() {
  if (toolHome) toolHome.hidden = false;
  if (historyTool) historyTool.hidden = true;
  if (auditTool) auditTool.hidden = true;
  document.querySelector('#audit-camera')?.close();
  document.title = PAGE_TITLE;
}

function showTool(tool) {
  const audit = tool === 'audit';
  if (toolHome) toolHome.hidden = true;
  if (historyTool) historyTool.hidden = audit;
  if (auditTool) auditTool.hidden = !audit;
  if (!audit) document.querySelector('#audit-camera')?.close();
  document.title = PAGE_TITLE;
  if (!audit) {
    fillLookup();
    lookup?.focus();
  }
}

function showLanding() {
  sessionStorage.removeItem(SESSION_KEY);
  document.querySelector('#audit-camera')?.close();
  guideDialog?.close();
  document.body.classList.remove('is-open');
  if (app) app.hidden = true;
  if (gate) gate.hidden = false;
  if (landingShare) landingShare.hidden = false;
  if (back) back.hidden = true;
  showHome();
  document.title = PAGE_TITLE;
  passwordInput?.focus();
}

function showApp() {
  if (gate) gate.hidden = true;
  if (landingShare) landingShare.hidden = true;
  if (back) back.hidden = false;
  document.body.classList.add('is-open');
  app.hidden = false;
  fillLookup();
  showHome();
}

function goBack() {
  const inTool = app && !app.hidden && toolHome?.hidden;
  if (inTool) {
    showHome();
    return;
  }
  showLanding();
}

function fillLookup() {
  if (!lookup) return;
  const by = mode();
  const options = historyOptions(profiles, { by });
  const blankLabel = by === 'route' ? 'Choose a route' : 'Choose a driver';
  if (lookupLabel) lookupLabel.textContent = by === 'route' ? 'Route' : 'Driver';
  lookup.replaceChildren();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = blankLabel;
  lookup.append(blank);
  for (const match of options) {
    const option = document.createElement('option');
    option.value = match.key;
    option.textContent = match.label;
    lookup.append(option);
  }
  lookup.disabled = options.length === 0;
  if (!options.length) {
    setStatus(pageStatus, by === 'route' ? 'No routes are recorded yet.' : 'No drivers are recorded yet.');
  } else {
    setStatus(pageStatus, '');
  }
}

function choose(match) {
  if (!match) return;
  if (lookup) lookup.value = match.key;
  setStatus(pageStatus, '');
  history.innerHTML =
    match.kind === 'route'
      ? routeHistoryHtml(profiles, match.key)
      : driverHistoryHtml(profiles, match.key);
  document.title =
    match.kind === 'route'
      ? `Route ${match.label} · ${PAGE_TITLE}`
      : `${match.label} · ${PAGE_TITLE}`;
}

function chooseFromLookup() {
  const key = lookup?.value || '';
  if (!key) {
    if (history) history.innerHTML = '';
    document.title = PAGE_TITLE;
    return;
  }
  const match = historyOptions(profiles, { by: mode() }).find((item) => item.key === key);
  choose(match);
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
  chooseFromLookup();
});

lookup?.addEventListener('change', () => {
  chooseFromLookup();
});

for (const input of modeInputs) {
  input.addEventListener('change', () => {
    if (history) history.innerHTML = '';
    document.title = PAGE_TITLE;
    fillLookup();
    lookup?.focus();
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

back?.addEventListener('click', goBack);

function installKind() {
  const ua = navigator.userAgent || '';
  const apple =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (apple) return 'apple';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

function showInstallSteps() {
  const help = document.querySelector('#add-to-desktop');
  if (!help) return;
  const kind = installKind();
  const ua = navigator.userAgent || '';
  const either = document.querySelector('#install-either');
  if (either) either.hidden = kind !== 'other';
  for (const section of help.querySelectorAll('[data-install]')) {
    section.hidden = kind !== 'other' && section.dataset.install !== kind;
  }
  if (kind === 'apple') {
    const note = help.querySelector('[data-install="apple"] .install-note');
    if (note && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) {
      note.textContent =
        'Open this page in Safari. Other iPhone browsers cannot add it to the home screen.';
    }
  }
  if (kind === 'android') {
    const note = help.querySelector('[data-install="android"] .install-note');
    const chrome = /Chrome/i.test(ua) && !/EdgA|OPR|SamsungBrowser|Firefox/i.test(ua);
    if (note && !chrome) note.textContent = 'Open this page in Chrome, then follow these steps.';
  }
}

const installDialog = document.querySelector('#install-dialog');
const disclaimerDialog = document.querySelector('#disclaimer-dialog');

showInstallSteps();

document.querySelector('#disclaimer-open')?.addEventListener('click', () => {
  disclaimerDialog?.showModal();
});

document.querySelector('#disclaimer-dialog-close')?.addEventListener('click', () => {
  disclaimerDialog?.close();
});

document.querySelector('#install-open')?.addEventListener('click', () => {
  showInstallSteps();
  installDialog?.showModal();
});

document.querySelector('#install-dialog-close')?.addEventListener('click', () => {
  installDialog?.close();
});

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

function openGuide() {
  if (guideFrame && guideFrame.dataset.loaded !== '1') {
    guideFrame.src = './clock-hours-guide.html';
    guideFrame.dataset.loaded = '1';
  }
  guideDialog?.showModal();
}

document.querySelector('#guide-dialog-close')?.addEventListener('click', () => {
  guideDialog?.close();
});

document.querySelector('#day-dialog-close')?.addEventListener('click', () => {
  dayDialog?.close();
});

for (const button of document.querySelectorAll('[data-home]')) {
  button.addEventListener('click', () => {
    const tool = button.dataset.home || 'history';
    if (tool === 'guide') openGuide();
    else showTool(tool);
  });
}

mountAuditGenie({ deviceOnly: true });

if (sessionStorage.getItem(SESSION_KEY) === '1') {
  unlock(PAGE_PASSWORD);
}
