import { fa } from './locale-fa.js';
import { pa } from './locale-pa.js';

// English is the source text for strings built in JavaScript.
// The page HTML keeps its own English. Punjabi and Persian override both.
export const en = {
  'office.unreachable': 'This page cannot reach the office record yet.',
  'office.unavailable': 'The office record is not available from this page yet.',
  'gate.wrong': 'That password is not right.',
  'gate.opening': 'Opening the office record…',
  'lookup.route': 'Route',
  'lookup.driver': 'Driver',
  'lookup.chooseRoute': 'Choose a route',
  'lookup.chooseDriver': 'Choose a driver',
  'lookup.noRoutes': 'No routes are recorded yet.',
  'lookup.noDrivers': 'No drivers are recorded yet.',
  'title.route': 'Route {label} · Teamster Tools',
  'title.person': '{label} · Teamster Tools',
  'snap.hintOn':
    'Snap is on. Each clock moves onto a quarter hour with the payroll bands, and the statement and the table are figured again from those clocks. Turn it off to go back to the written times. The office record stays as it is.',
  'snap.hintOff':
    'Snap is off. Turn it on to move each clock onto a quarter hour with the payroll bands and see if the hours or the date change. The office record stays as it is.',
  'install.safariOther':
    'Open this page in Safari. Other iPhone browsers cannot add it to the home screen.',
  'install.chromeOther': 'Open this page in Chrome, then follow these steps.',
  'day.fallback': 'Day',
  'run.midday': 'Midday',
  'empty.driver': 'No route history is recorded for {name}.',
  'empty.route': 'No route history is recorded for {route}.',
  'lead.one': 'Route {routes}, including each change while {name} held it.',
  'lead.many': 'Routes {routes}, including each change while {name} held them.',
  'held.since': 'Since {date}',
  'held.range': '{from} – {to}',
  'route.heading': 'Route {label}',
  'holders.none': 'No driver is assigned.',
  'clocks.now': 'Clock times now',
  'started': 'Started {date}.',
  'contracted.today': 'Contracted today',
  'contracted.asOf': 'Contracted as of {date}',
  'contracted.same': 'The same clocks.',
  'hours.open': 'These stay the contracted hours while this count is open.',
  'hours.rules': 'These are the hours the rules call contracted.',
  'rules.next': 'What the rules say next',
  'rules.bidOpen':
    'This change is {drift}. If nothing else is logged, the route should go up for bid {dates}.',
  'rules.bumpOpen':
    'This change is {drift}. If nothing else is logged, the route should be bump-eligible on {date}.',
  'rules.hoursOpen':
    'This change is {drift}. If nothing else is logged, these hours should become the contracted hours on {date}.',
  'rules.nothingWaiting': 'Nothing is waiting on a count. These clock times are the contracted hours.',
  'rules.bidClosedDates': 'The count has closed. The route should be up for bid {dates}.',
  'rules.bidClosed': 'The count has closed. The route should be up for bid.',
  'rules.bumpClosedDate': 'The count has closed. The route should be bump-eligible as of {date}.',
  'rules.bumpClosed': 'The count has closed. The route should be bump-eligible.',
  'rules.hoursClosedDate':
    'The count has closed. These clock times should be the contracted hours as of {date}.',
  'rules.hoursAre': 'These clock times are the contracted hours.',
  'snap.reads': 'Snap reads the clock times as {clocks}.',
  'snap.sameWithMove': 'The contracted hours and what the rules say next stay the same.',
  'snap.sameNoMove':
    'Snap leaves the clock times, the contracted hours, and what the rules say next the same.',
  'snap.hours': 'Snap moves the contracted hours from {from} to {to}.',
  'snap.compare': 'Written clock times: {written} Snap clock times: {snap}',
  'history.calendar': 'Calendar',
  'side.ownDate': 'its own date',
  'side.bidClock': 'its own bid countdown, through {when}',
  'side.dayClock': 'its own 15 school day countdown, through {when}',
  'side.note':
    'A later change of {amount} keeps the route at 30 minutes or more, so the bid date stays. That change runs {clock}.',
  'col.started': 'New Schedule Started',
  'col.amStart': 'AM start',
  'col.amEnd': 'AM end',
  'col.midStart': 'Midday start',
  'col.midEnd': 'Midday end',
  'col.pmStart': 'PM start',
  'col.pmEnd': 'PM end',
  'col.change': 'Change',
  'col.hours': 'Scheduled Hours',
  'col.contractDate': 'Calculated Contract Date',
  'col.empty': 'No clock times recorded yet.',
  'col.diffTitle': 'Different from the row above',
  'legend.bidNote':
    'End-of-month bid period: the last five school days of October through April, when a 30-minute increase is posted for bid.',
  'dow.sun': 'Sun',
  'dow.mon': 'Mon',
  'dow.tue': 'Tue',
  'dow.wed': 'Wed',
  'dow.thu': 'Thu',
  'dow.fri': 'Fri',
  'dow.sat': 'Sat',
  'cal.schoolDay': 'School day',
  'cal.today': "Today's date",
  'cal.bidPeriod': 'End-of-month bid period',
  'cal.off': 'Off',
  'cal.weekend': 'Weekend',
  'cal.outside': 'Outside school year',
  'cal.goesToBid': 'Goes to bid {when}',
  'cal.pointsTo': 'Points to {when}',
  'cal.established': 'established',
  'cal.schoolDayN': 'school day {n} of 15',
  'cal.became': 'became contracted',
  'cal.postedBid': 'posted for bid',
  'cal.bump': 'bump eligible',
  'cal.resolution': 'resolution',
  'home.coming': 'Coming Soon',
  'share.text':
    'Teamster Tools\nBy Rhys- Get your real route change history, use an AI to scan your timecards, and more!\n{url}\nPassword: {password}',
  'coming.lead':
    'Routes the contract rules say are likely to be up for bid or bump-eligible at the end of this month. A later time change can take a route off this list. These follow the written clock times, not an office posting.',
  'coming.period': 'End of {month}',
  'coming.window': 'Bid posting days are the last five school days, {dates}.',
  'coming.empty': 'No routes are likely for bid or bump at the end of this month.',
  'coming.noneSeason':
    'There is no end-of-month bid or bump list ahead in this school year. Those lists run October through April.',
  'coming.likelyBid': 'Likely up for bid',
  'coming.likelyBump': 'Likely bump-eligible',
  'coming.eligibleBid': 'Should be up for bid',
  'coming.eligibleBump': 'Should be bump-eligible',
  'coming.noLonger': 'No longer likely',
  'coming.bidOpen':
    'This change is {drift}. If nothing else is logged, this route should go up for bid {dates}.',
  'coming.bumpOpen':
    'This change is {drift}. If nothing else is logged, this route should be bump-eligible on {date}.',
  'coming.bidNow': 'The count has closed. This route should be up for bid {dates}.',
  'coming.bumpNow': 'The count has closed. This route should be bump-eligible as of {date}.',
  'coming.dropped':
    'This route was headed for {kind} at the end of {month}. A later change took it off that list.',
  'coming.kindBid': 'a bid',
  'coming.kindBump': 'a bump',
  'coming.route': 'Route {label}',
};

const catalogs = { en, pa, fa };

function storedLang() {
  try {
    const stored = globalThis.localStorage?.getItem('teamster-tools-lang');
    if (stored === 'pa' || stored === 'fa' || stored === 'en') return stored;
  } catch {
    // Private mode or a non-browser test can block storage.
  }
  return '';
}

export function pageLang() {
  const forced = globalThis.__TEAMSTER_LANG__;
  if (forced === 'pa' || forced === 'fa' || forced === 'en') return forced;
  try {
    const requested = new URLSearchParams(globalThis.location?.search || '').get('lang');
    if (requested === 'pa' || requested === 'fa' || requested === 'en') return requested;
  } catch {
    // No page URL in this runtime.
  }
  return storedLang() || 'en';
}

export function rememberLang() {
  const lang = pageLang();
  try {
    globalThis.localStorage?.setItem('teamster-tools-lang', lang);
  } catch {
    // Ignore storage failures.
  }
  return lang;
}

export function dateLocaleFor(lang = pageLang()) {
  if (lang === 'pa') return 'pa-IN-u-ca-gregory-nu-latn';
  if (lang === 'fa') return 'fa-IR-u-ca-gregory-nu-latn';
  return 'en-US';
}

export function translate(key, vars = {}) {
  const lang = pageLang();
  const localized = lang === 'en' ? undefined : catalogs[lang]?.[key];
  let text = localized ?? en[key] ?? '';
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value ?? ''));
  }
  return text;
}

function applyPack(root, pack) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const value = pack[el.getAttribute('data-i18n')];
    if (value) el.textContent = value;
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    const value = pack[el.getAttribute('data-i18n-aria')];
    if (value) el.setAttribute('aria-label', value);
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    const value = pack[el.getAttribute('data-i18n-placeholder')];
    if (value) el.setAttribute('placeholder', value);
  }
  for (const el of root.querySelectorAll('[data-i18n-alt]')) {
    const value = pack[el.getAttribute('data-i18n-alt')];
    if (value) el.setAttribute('alt', value);
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    const value = pack[el.getAttribute('data-i18n-title')];
    if (value) el.setAttribute('title', value);
  }
}

export function applyDom(root = globalThis.document) {
  if (!root?.querySelectorAll) return pageLang();
  const lang = rememberLang();
  const html = root.documentElement;
  if (html) {
    html.lang = lang;
    html.dir = lang === 'fa' ? 'rtl' : 'ltr';
  }
  const pack = catalogs[lang];
  globalThis.__TEAMSTER_PHRASES__ = lang === 'en' ? null : pack;
  if (lang !== 'en' && pack) applyPack(root, pack);
  return lang;
}

export { fa, pa };
