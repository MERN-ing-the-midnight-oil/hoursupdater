const STORAGE_KEY = 'teamster-driver-dashboard';
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'ok'];
const KEY_LABEL = { clear: 'Clear', ok: 'OK' };
const RECORDS = [
  ['changes', 'My Time Changes'],
  ['card', 'Current Time Card'],
  ['summaries', 'My Time Summaries'],
];
const WORK = [
  ['weekly', 'My Weekly Work'],
  ['daily', 'My Daily/Late Work'],
  ['roster', 'My Roster Trips'],
];
const PANELS = [...RECORDS, ...WORK];
const ICONS = {
  weekly:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/></svg>',
  daily:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"/></svg>',
  roster:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16V8.5A2.5 2.5 0 0 1 6.5 6H16l4 4v6"/><path d="M16 6v4h4M4 16h16"/><circle cx="7.5" cy="17.5" r="1.6"/><circle cx="16.5" cy="17.5" r="1.6"/></svg>',
  changes:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h12M13 5l3 3-3 3M20 16H8M11 13l-3 3 3 3"/></svg>',
  card:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 14h6M7 17h3"/></svg>',
  summaries:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V10M12 19V5M19 19v-7"/><path d="M3 19h18"/></svg>',
};

const main = document.querySelector('#main');
const tabs = document.querySelector('#tabs');
const work = document.querySelector('#work');
const status = document.querySelector('#status');
const forget = document.querySelector('#forget');
const title = document.querySelector('#dash-title');
const photo = document.querySelector('#driver-photo');

const session = {
  pin: '',
  driverId: '',
  name: '',
  photo: '',
  panel: 'changes',
  dashboard: null,
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(message) {
  status.textContent = message || '';
}

function readSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '');
    if (!data || !/^\d{4}$/.test(String(data.pin || ''))) return null;
    return { pin: String(data.pin), driverId: String(data.driverId || '') };
  } catch {
    return null;
  }
}

function writeSaved(pin, driverId) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ pin, driverId }));
}

function clearSaved() {
  localStorage.removeItem(STORAGE_KEY);
}

async function enterPin(pin, driverId = '') {
  const response = await fetch('/api/extra-work/enter', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pin,
      ...(driverId ? { driver_id: driverId } : {}),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'That PIN does not match.');
  return data;
}

function dailyFrameSrc() {
  return '/board?as=driver&sheet=daily&view=phone&from=driver';
}

function rosterFrameSrc() {
  return '/board?as=driver&sheet=roster&view=phone&from=driver';
}

function weeklyFrameSrc() {
  const params = new URLSearchParams(location.search);
  let week = params.get('week') || '';
  const next = params.get('next') || '';
  try {
    const url = new URL(next, location.origin);
    if (!week && url.pathname === '/board') week = url.searchParams.get('week') || '';
  } catch {
    week = params.get('week') || '';
  }
  const query = new URLSearchParams({
    as: 'driver',
    sheet: 'weekly',
    view: 'phone',
    from: 'driver',
  });
  if (/^\d{4}-\d{2}-\d{2}$/.test(week)) query.set('week', week);
  return `/board?${query}`;
}

function startingPanel() {
  const params = new URLSearchParams(location.search);
  const asked = params.get('tab') || '';
  if (PANELS.some(([id]) => id === asked)) return asked;
  if (params.get('week')) return 'weekly';
  const next = params.get('next') || '';
  let sheet = '';
  try {
    sheet = new URL(next, location.origin).searchParams.get('sheet') || '';
  } catch {
    sheet = '';
  }
  if (sheet === 'weekly' || next.includes('sheet=weekly') || next.includes('sheet%3Dweekly')) return 'weekly';
  if (sheet === 'daily' || next.includes('sheet=daily') || next.includes('sheet%3Ddaily')) return 'daily';
  if (sheet === 'roster' || next.includes('sheet=roster') || next.includes('sheet%3Droster')) return 'roster';
  return 'changes';
}

function panelButton(id, label) {
  const on = session.panel === id;
  return `<button type="button" data-panel="${id}" class="${on ? 'is-on' : ''}" aria-pressed="${on ? 'true' : 'false'}">${ICONS[id] || ''}<span>${esc(label)}</span></button>`;
}

function paintHeader() {
  const signedIn = session.panel !== 'pin' && session.name;
  title.textContent = signedIn ? session.name : 'Driver dashboard';
  if (!signedIn || !session.photo) {
    photo.hidden = true;
    photo.removeAttribute('src');
    return;
  }
  photo.alt = '';
  photo.onerror = () => {
    photo.hidden = true;
  };
  if (photo.getAttribute('src') !== session.photo) photo.src = session.photo;
  photo.hidden = false;
}

function renderWork() {
  work.hidden = false;
  work.innerHTML = WORK.map(([id, label]) => panelButton(id, label)).join('');
}

function renderTabs() {
  tabs.hidden = false;
  document.body.classList.add('has-tabs');
  tabs.innerHTML = RECORDS.map(([id, label]) => panelButton(id, label)).join('');
}

function clockRange(range) {
  const text = String(range || '').trim();
  if (!text) return 'No clock';
  return text.replace('-', '–');
}

function clockCards(clocks) {
  const cards = (clocks || [])
    .map(
      (row) => `<article class="clock-card">
        <h2>Route ${esc(row.route_id || '')}</h2>
        <dl>
          <dt>AM</dt><dd>${esc(clockRange(row.am))}</dd>
          <dt>Midday</dt><dd>${esc(clockRange(row.midday))}</dd>
          <dt>PM</dt><dd>${esc(clockRange(row.pm))}</dd>
        </dl>
      </article>`
    )
    .join('');
  return cards || '<article class="soon"><h2>Route clocks</h2><p>No route clock times are on file.</p></article>';
}

function recordActions() {
  return `<div class="sheet-actions">
    <button type="button" data-record="download">Download</button>
    <button type="button" data-record="email">Email</button>
    <button type="button" data-record="print">Print</button>
  </div>`;
}

function reasonText(reason) {
  const minutes = Number(reason?.minutes);
  const label = reason?.label || reason;
  if (!label) return '';
  return Number.isInteger(minutes) && minutes > 0 ? `${label} (${minutes} min)` : String(label);
}

function reasonEditor(punch, catalog) {
  const taken = new Set((punch.reasons || []).map((reason) => reason.id));
  const options = (catalog || [])
    .filter((code) => !taken.has(code.id))
    .map((code) => `<option value="${esc(code.id)}">${esc(code.label)}</option>`)
    .join('');
  const rows = (punch.reasons || [])
    .map(
      (reason) => `<li data-reason-id="${esc(reason.id)}">
        <span>${esc(reason.label)}</span>
        <input type="number" min="1" max="1440" step="1" inputmode="numeric" value="${esc(reason.minutes || '')}" aria-label="Minutes for ${esc(reason.label)}" required />
        <button type="button" data-remove-reason>Remove</button>
      </li>`
    )
    .join('');
  return `<div class="reasons">
    <p>Reasons</p>
    <ul class="reason-list">${rows}</ul>
    <div class="reason-add">
      <select data-reason-catalog>
        <option value="">${options ? 'Choose a reason' : 'No reasons left'}</option>
        ${options}
      </select>
      <input type="number" min="1" max="1440" step="1" inputmode="numeric" placeholder="Minutes" data-reason-minutes />
      <button type="button" data-add-reason>Add</button>
    </div>
  </div>`;
}

function renderChanges(data) {
  const rows = data.changes || [];
  const list = rows.length
    ? rows
        .map(
          (row) => `<article class="change">
            <h2>${esc(row.route_id)} · ${esc(row.segment)}</h2>
            <p>${esc(row.date)}</p>
            <p class="change-times">${esc(clockRange(row.previous_time))} → ${esc(clockRange(row.new_time))}</p>
            ${row.note ? `<p>${esc(row.note)}</p>` : ''}
          </article>`
        )
        .join('')
    : '<article class="soon"><h2>No clock-time changes</h2><p>Nothing on your routes has moved.</p></article>';
  main.innerHTML = `<section class="sheet">
    ${recordActions()}
    <div class="stack">${list}</div>
    <h2 class="sheet-title">Clocks on file</h2>
    <div class="stack">${clockCards(data.clocks)}</div>
  </section>`;
}

function renderCard(data) {
  const card = data.card || { punches: [], period: {} };
  const punches = card.punches || [];
  const rows = punches.length
    ? punches
        .map((punch) => {
          const reasons = (punch.reasons || []).length
            ? `<p class="pin-lead">${esc((punch.reasons || []).map(reasonText).join(', '))}</p>`
            : '';
          if (!punch.editable) {
            return `<article class="punch">
              <h2>${esc(punch.run)} ${esc(punch.action)}</h2>
              <p>${esc(punch.label)}</p>
              ${punch.note ? `<p>${esc(punch.note)}</p>` : ''}
              ${reasons}
            </article>`;
          }
          return `<form class="punch" data-punch="${esc(punch.id)}">
            <h2>${esc(punch.run)} ${esc(punch.action)}</h2>
            <p class="pin-lead">${esc(punch.date)}</p>
            <label>Clock time <input type="time" name="time" value="${esc(punch.time_value)}" required /></label>
            <label>Comment <textarea name="note" maxlength="500" rows="2">${esc(punch.note)}</textarea></label>
            ${reasonEditor(punch, data.reason_catalog)}
            <button type="submit">Save this clock</button>
          </form>`;
        })
        .join('')
    : '<article class="soon"><h2>No clock times yet</h2><p>This pay period has no clock in or clock out.</p></article>';
  main.innerHTML = `<section class="sheet">
    <p class="pin-lead">Current time card, ${esc(card.period?.label || '')}.</p>
    ${recordActions()}
    <div class="stack">${clockCards(data.clocks)}</div>
    <div class="stack">${rows}</div>
  </section>`;
}

function renderSummaries(data) {
  const summaries = data.summaries || { periods: [], selected: { days: [], totals: {} } };
  const selected = summaries.selected || { days: [], totals: {}, period: {} };
  const options = (summaries.periods || [])
    .map((period) => {
      const value = `${period.year}-${period.month}-${period.half}`;
      const current = `${selected.period?.year}-${selected.period?.month}-${selected.period?.half}`;
      return `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(period.label)}</option>`;
    })
    .join('');
  const totals = selected.totals || {};
  const days = (selected.days || [])
    .filter((day) => day.clock_hours || day.contract_hours)
    .map(
      (day) => `<tr>
        <th scope="row">${esc(day.label)}</th>
        <td>${Number(day.clock_hours).toFixed(2)}</td>
        <td>${Number(day.contract_hours).toFixed(2)}</td>
        <td>${Number(day.regular).toFixed(2)}</td>
        <td>${Number(day.overtime).toFixed(2)}</td>
      </tr>`
    )
    .join('');
  main.innerHTML = `<section class="sheet">
    ${recordActions()}
    <label class="period-pick">Pay period
      <select data-summary-period>${options}</select>
    </label>
    <p class="pin-lead">${esc(selected.contract_text || '')}</p>
    <div class="table-wrap">
      <table class="summary">
        <thead>
          <tr><th>Day</th><th>Clock</th><th>Contract</th><th>Regular</th><th>Overtime</th></tr>
        </thead>
        <tbody>
          ${days || '<tr><td colspan="5">No clock hours in this pay period.</td></tr>'}
          <tr class="is-total">
            <th scope="row">Total</th>
            <td>${Number(totals.clock_hours || 0).toFixed(2)}</td>
            <td>${Number(totals.contract_hours || 0).toFixed(2)}</td>
            <td>${Number(totals.regular || 0).toFixed(2)}</td>
            <td>${Number(totals.overtime || 0).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>`;
}

async function loadDashboard(period) {
  const query = new URLSearchParams();
  if (period?.year && period?.month && period?.half) {
    query.set('year', String(period.year));
    query.set('month', String(period.month));
    query.set('half', String(period.half));
  }
  const response = await fetch(`/api/extra-work/dashboard?${query}`, { credentials: 'same-origin' });
  if (response.status === 401) {
    clearSaved();
    showPin('Enter your PIN again.');
    return null;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The dashboard could not be loaded.');
  session.dashboard = data;
  if (data.name) session.name = data.name;
  if (data.photo) session.photo = data.photo;
  paintHeader();
  return data;
}

function showLoaded(id, data) {
  if (id === 'changes') renderChanges(data);
  else if (id === 'card') renderCard(data);
  else renderSummaries(data);
}

async function showRecord(id) {
  main.innerHTML = `<p class="who">Loading ${esc(session.name || 'your records')}…</p>`;
  const data = await loadDashboard();
  if (!data || session.panel !== id) return;
  showLoaded(id, data);
}

function showPanel(id) {
  session.panel = id;
  forget.hidden = false;
  paintHeader();
  renderWork();
  renderTabs();
  setStatus('');
  if (id === 'weekly') {
    main.innerHTML = `<iframe class="week-frame" title="My weekly work" src="${esc(weeklyFrameSrc())}"></iframe>`;
    return;
  }
  if (id === 'daily') {
    main.innerHTML = `<iframe class="week-frame" title="My daily and late work" src="${esc(dailyFrameSrc())}"></iframe>`;
    return;
  }
  if (id === 'roster') {
    main.innerHTML = `<iframe class="week-frame" title="My roster trips" src="${esc(rosterFrameSrc())}"></iframe>`;
    return;
  }
  showRecord(id).catch((error) => setStatus(error.message));
}

function showHome() {
  showPanel(startingPanel());
}

function showNames(matches) {
  main.innerHTML = `<h2>Who is this?</h2>
    <div class="choices">
      ${matches
        .map(
          (driver) =>
            `<button type="button" class="choice" data-driver="${esc(driver.driver_id)}">${esc(driver.name)}</button>`
        )
        .join('')}
    </div>`;
}

function showPin(message = '') {
  session.panel = 'pin';
  session.dashboard = null;
  session.photo = '';
  tabs.hidden = true;
  work.hidden = true;
  work.innerHTML = '';
  document.body.classList.remove('has-tabs');
  forget.hidden = true;
  paintHeader();
  setStatus(message);
  main.innerHTML = `<p class="pin-dots" id="pin-dots" aria-label="PIN digits entered"><span></span><span></span><span></span><span></span></p>
    <div class="pin-keys" id="pin-keys">
      ${KEYS.map(
        (key) => `<button type="button" data-key="${key}">${esc(KEY_LABEL[key] || key)}</button>`
      ).join('')}
    </div>`;
  paintDots();
}

function paintDots() {
  const dots = document.querySelectorAll('#pin-dots span');
  dots.forEach((dot, index) => dot.classList.toggle('is-on', index < session.pin.length));
}

async function finishSignIn(pin, driverId) {
  const result = await enterPin(pin, driverId);
  if (result.matches) {
    session.pin = pin;
    showNames(result.matches);
    return;
  }
  session.pin = '';
  session.driverId = result.driver_id || driverId;
  session.name = result.name || '';
  session.photo = result.photo || '';
  writeSaved(pin, session.driverId);
  setStatus('');
  showHome();
}

async function restore() {
  const saved = readSaved();
  if (!saved) {
    showPin();
    return;
  }
  try {
    await finishSignIn(saved.pin, saved.driverId);
  } catch {
    clearSaved();
    showPin('Enter your PIN again.');
  }
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function recordLines() {
  const data = session.dashboard;
  if (!data) return [];
  if (session.panel === 'changes') {
    const lines = [['Route', 'Run', 'Date', 'Previous', 'New', 'Note']];
    for (const row of data.changes || []) {
      lines.push([row.route_id, row.segment, row.date, row.previous_time, row.new_time, row.note]);
    }
    return lines;
  }
  if (session.panel === 'card') {
    const lines = [['Date', 'Run', 'Action', 'Time', 'Comment', 'Reasons']];
    for (const punch of data.card?.punches || []) {
      lines.push([
        punch.date,
        punch.run,
        punch.action,
        punch.label,
        punch.note,
        (punch.reasons || []).map(reasonText).join('; '),
      ]);
    }
    return lines;
  }
  const lines = [['Day', 'Clock', 'Contract', 'Regular', 'Overtime']];
  for (const day of data.summaries?.selected?.days || []) {
    lines.push([day.label, day.clock_hours, day.contract_hours, day.regular, day.overtime]);
  }
  return lines;
}

function recordTitle() {
  const name = session.dashboard?.name || session.name || 'Driver';
  const label = PANELS.find(([id]) => id === session.panel)?.[1] || 'Driver dashboard';
  return `${label} — ${name}`;
}

function downloadRecord() {
  const lines = recordLines();
  if (!lines.length) return;
  const csv = lines.map((line) => line.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${recordTitle().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus('Downloaded.');
}

function emailRecord() {
  const lines = recordLines();
  const body = [recordTitle(), '', ...lines.map((line) => line.join('\t'))].join('\n');
  const href = `mailto:?subject=${encodeURIComponent(recordTitle())}&body=${encodeURIComponent(body)}`;
  window.location.href = href;
  setStatus('Opening your email app.');
}

async function savePunch(form) {
  const id = form.dataset.punch;
  const time = form.querySelector('[name="time"]')?.value || '';
  const note = form.querySelector('[name="note"]')?.value || '';
  const reasons = [...form.querySelectorAll('[data-reason-id]')].map((row) => ({
    id: row.dataset.reasonId,
    minutes: Number(row.querySelector('input')?.value),
  }));
  setStatus('');
  const response = await fetch(`/api/extra-work/time-card/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ time, note, reasons }),
  });
  if (response.status === 401) {
    clearSaved();
    showPin('Enter your PIN again.');
    return;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'That clock time could not be saved.');
  session.dashboard = data;
  if (session.panel === 'card') renderCard(data);
  setStatus('Saved.');
}

main.addEventListener('click', (event) => {
  const key = event.target.closest('[data-key]');
  if (key && session.panel === 'pin') {
    const name = key.dataset.key;
    if (name === 'clear') session.pin = '';
    else if (name === 'ok') {
      finishSignIn(session.pin).catch((error) => setStatus(error.message));
      return;
    } else if (session.pin.length < 4) session.pin += name;
    paintDots();
    setStatus('');
    if (session.pin.length === 4) {
      finishSignIn(session.pin).catch((error) => setStatus(error.message));
    }
    return;
  }
  const driver = event.target.closest('[data-driver]');
  if (driver) {
    const saved = readSaved();
    const pin = session.pin || saved?.pin || '';
    finishSignIn(pin, driver.dataset.driver).catch((error) => setStatus(error.message));
    return;
  }
  const panel = event.target.closest('[data-panel]');
  if (panel) {
    showPanel(panel.dataset.panel);
    return;
  }
  const removeReason = event.target.closest('[data-remove-reason]');
  if (removeReason) {
    removeReason.closest('li')?.remove();
    return;
  }
  const addReason = event.target.closest('[data-add-reason]');
  if (addReason) {
    const box = addReason.closest('.reasons');
    const select = box?.querySelector('[data-reason-catalog]');
    const minutes = box?.querySelector('[data-reason-minutes]');
    const option = select?.selectedOptions?.[0];
    const count = Number(minutes?.value);
    if (!option?.value) {
      setStatus('Choose a reason.');
      return;
    }
    if (!Number.isInteger(count) || count < 1 || count > 1440) {
      setStatus('Use whole minutes, up to 1440.');
      return;
    }
    const list = box.querySelector('.reason-list');
    const item = document.createElement('li');
    item.dataset.reasonId = option.value;
    item.innerHTML = `<span></span><input type="number" min="1" max="1440" step="1" inputmode="numeric" required /><button type="button" data-remove-reason>Remove</button>`;
    item.querySelector('span').textContent = option.textContent;
    item.querySelector('input').value = String(count);
    item.querySelector('input').setAttribute('aria-label', `Minutes for ${option.textContent}`);
    list.append(item);
    option.remove();
    select.value = '';
    minutes.value = '';
    setStatus('');
    return;
  }
  const record = event.target.closest('[data-record]');
  if (!record) return;
  if (record.dataset.record === 'download') downloadRecord();
  else if (record.dataset.record === 'email') emailRecord();
  else if (record.dataset.record === 'print') window.print();
});

main.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-punch]');
  if (!form) return;
  event.preventDefault();
  savePunch(form).catch((error) => setStatus(error.message));
});

main.addEventListener('change', (event) => {
  const select = event.target.closest('[data-summary-period]');
  if (!select || session.panel !== 'summaries') return;
  const [year, month, half] = select.value.split('-');
  loadDashboard({ year, month, half })
    .then((data) => {
      if (data && session.panel === 'summaries') renderSummaries(data);
    })
    .catch((error) => setStatus(error.message));
});

function openPanel(event) {
  const panel = event.target.closest('[data-panel]');
  if (!panel) return;
  showPanel(panel.dataset.panel);
}

tabs.addEventListener('click', openPanel);
work.addEventListener('click', openPanel);

forget.addEventListener('click', async () => {
  clearSaved();
  session.pin = '';
  session.driverId = '';
  session.name = '';
  session.photo = '';
  session.dashboard = null;
  try {
    await fetch('/api/extra-work/leave', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // The phone forgets the PIN even if the office session is already gone.
  }
  showPin();
});

restore();
