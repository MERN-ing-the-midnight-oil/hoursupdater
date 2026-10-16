const STORAGE_KEY = 'timeclock-tour-edits-v1';

/** @type {{ id: string, title: string, text: string, image: string }[]} */
const clockPath = [
  {
    id: 'clock-hub',
    title: 'Clocking',
    text: 'Start Timeclock opens the driver screen and leaves it up.',
    image: 'clock-hub.png',
  },
  {
    id: 'clock-roster',
    title: 'Driver screen',
    text: 'Each name shows whether that driver is in or out.',
    image: 'clock-roster.png',
  },
  {
    id: 'clock-pin',
    title: 'Driver PIN',
    text: 'The driver enters a PIN before the punch buttons open.',
    image: 'clock-pin.png',
  },
  {
    id: 'clock-punch',
    title: 'Clock in or out',
    text: 'The punch stays on the minute it was tapped. A note and a reason can go with it.',
    image: 'clock-punch.png',
  },
  {
    id: 'clocked-in',
    title: 'Clocked in',
    text: 'The card names the driver, the minute, and the run.',
    image: '03-clocked-in.png',
  },
];

const payrollPath = [
  {
    id: 'clock-records-list',
    title: 'Clock records',
    text: 'The office opens a name to add, change, or remove a punch.',
    image: 'clock-records-list.png',
  },
  {
    id: 'clock-records-driver',
    title: 'One driver’s punches',
    text: 'September 15 is still the actual minutes: 6:13, 8:44, 11:06, 12:18, 2:02, 4:35.',
    image: 'clock-records-driver.png',
  },
  {
    id: 'payroll-home',
    title: 'Payroll',
    text: 'Choose an EX DRIVER and a pay period, then open the pay period info.',
    image: 'payroll-home.png',
  },
  {
    id: 'pay-period',
    title: 'Pay period info',
    text: 'The punched minute sits next to the quarter hour. 6:13 becomes 6:15. The yellow row is the time that counts.',
    image: 'payroll-pay-period-popup.png',
  },
  {
    id: 'monthly-summary',
    title: 'Monthly time summary',
    text: 'The same pay period, laid out as the summary sheet.',
    image: 'payroll-monthly-summary.png',
  },
  {
    id: 'payroll-row',
    title: 'Payroll Driver Times',
    text: 'The file keeps the latest completed clocks, snapped to the quarter hour. September 15 adds up to 6.25 hours.',
    image: '07-payroll-row.png',
  },
];

const clockMore = [
  ['clock-substitutes', 'Substitute drivers', 'A substitute picks their name, then the route they are covering.', 'clock-substitutes.png'],
  ['clock-edit', 'Change a punch', 'The office can change the time, note, name, and reason on a record.', 'clock-records-edit.png'],
  ['clock-pay-status', 'Pay status on a punch', 'EX DRIVER covers this whole clock period.', 'clock-records-pay-status.png'],
  ['clock-timecard', 'Timecard codes', 'Codes on a clock-out can add up to that period’s minutes or less.', 'clock-records-timecard.png'],
  ['clock-paper', 'Paper records', 'Full pages wait here until they are printed.', 'clock-paper-records.png'],
  ['settings-top', 'Timeclock settings', 'The office settings for the driver screen, all on one page.', 'clock-settings-top.png'],
  ['settings-lock', 'Admin lock code', 'This is how the office leaves the driver screen. A driver PIN does not open it.', 'clock-settings-admin-lock-code.png'],
  ['settings-paper', 'Paper records reminder', 'Clock records can say when a full page is waiting to print.', 'clock-settings-paper-records-reminder.png'],
  ['settings-flash', 'Name flash', 'A name can flash when a driver has not clocked in after their route time.', 'clock-settings-name-flash.png'],
  ['settings-early', 'Early release clock-in', 'On an early release day, the PM clock-in follows the first school on the route.', 'clock-settings-early-release-clock-in.png'],
  ['settings-rounding', 'Clock rounding', 'Snap rounding moves each clock to the nearest 0, 15, 30, or 45.', 'clock-settings-clock-rounding.png'],
  ['settings-overtime', 'Overtime rules', 'The same rules are on Payroll. They decide which minutes are overtime.', 'clock-settings-overtime-rules.png'],
  ['settings-badge', 'Name badge size', 'This is the size of each driver button on the timeclock.', 'clock-settings-name-badge-size.png'],
  ['settings-sounds', 'Punch sounds', 'Clock in and clock out can each play a sound.', 'clock-settings-punch-sounds.png'],
  ['settings-reasons', 'Reason codes', 'Drivers pick from this list on a clock in or clock out.', 'clock-settings-reason-codes.png'],
  ['settings-pins', 'Driver PINs', 'The office looks up a PIN here and can save a different one.', 'clock-settings-driver-pins.png'],
  ['settings-subs', 'Substitute list', 'People on this list can clock in for a route without that driver’s PIN.', 'clock-settings-substitute-drivers.png'],
  ['settings-periods', 'Pay period dates', 'Saving here changes the same dates on Payroll.', 'clock-settings-pay-period-dates.png'],
  ['settings-statuses', 'Pay status categories', 'The statuses a clock-in can use. The same list is used for a time summary.', 'clock-settings-pay-status-categories.png'],
  ['settings-driver-status', 'Driver pay statuses', 'Check every pay status a driver can use.', 'clock-settings-driver-pay-statuses.png'],
].map(([id, title, text, image]) => ({ id, title, text, image }));

const payrollMore = [
  ['payroll-drivers', 'Drivers', 'Click a name to open that driver’s clock record.', 'payroll-drivers-list.png'],
  ['payroll-record', 'Clock record', 'AM, midday, and PM for each day. These times are not rounded.', 'payroll-clock-record.png'],
  ['driver-info', 'Driver info', 'Name, email, phone, serial number, hourly rate, payroll account, and pay status.', 'payroll-driver-info.png'],
  ['pay-periods', 'Pay period dates', 'The usual periods are days 1–15 and days 16 through the end of the month.', 'payroll-pay-periods.png'],
  ['pay-status', 'Pay status categories', 'REG DRIVER, OT DR TRAINER, EX DR TRAINER, and EX DRIVER start the list.', 'payroll-pay-status.png'],
  ['rounding', 'Clock rounding', 'The same three choices as Timeclock settings.', 'payroll-rounding.png'],
  ['overtime', 'Overtime rules', 'Daily, weekly, evening, early morning, weekend, and holiday.', 'payroll-overtime.png'],
  ['period-sheet', 'Pay period sheet', 'Another view of September 1–15, with the clock notes under the table.', '06-pay-period-info.png'],
  ['period-zoom', 'Pay period, closer', 'A closer crop of the clock-in rows and the yellow snap-minutes row.', '06-pay-period-zoom.png'],
].map(([id, title, text, image]) => ({ id, title, text, image }));

const earlier = [
  ['earlier-clocking', 'Clocking, earlier shot', 'The same Clocking page, from the first capture.', '02-clocking.png'],
  ['earlier-roster', 'Roster, earlier shot', 'The driver screen from the first capture.', '03-roster.png'],
  ['earlier-ready', 'Punch screen, earlier shot', 'Donald’s punch buttons before the later capture.', '03-ready.png'],
  ['earlier-record', 'Clock record, earlier shot', 'September 1–15 on the payroll clock record.', '04-clock-record.png'],
  ['earlier-payroll', 'Payroll, earlier shot', 'Payroll with September 1–15 already chosen.', '05-payroll-form.png'],
].map(([id, title, text, image]) => ({ id, title, text, image }));

const groups = {
  'clock-path': clockPath,
  'payroll-path': payrollPath,
  'clock-more': clockMore,
  'payroll-more': payrollMore,
  earlier,
};

const liveEdit = document.body.dataset.liveEdit !== 'false';
let edits = loadEdits();
let openGroup = 'clock-path';
let openIndex = 0;

const tour = document.querySelector('#tour');
const dialog = document.querySelector('#screen-dialog');
const screenImage = document.querySelector('#screen-image');
const screenTitle = document.querySelector('#screen-title');
const screenText = document.querySelector('#screen-text');

function loadEdits() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveEdits() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
}

function field(id, name, fallback) {
  const key = `${id}:${name}`;
  return Object.prototype.hasOwnProperty.call(edits, key) ? edits[key] : fallback;
}

function bindEditable(el, id, name, fallback) {
  el.textContent = field(id, name, fallback);
  if (!liveEdit) return;
  el.contentEditable = 'true';
  el.spellcheck = true;
  el.addEventListener('paste', (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') || '';
    document.execCommand('insertText', false, text);
  });
  el.addEventListener('input', () => {
    edits[`${id}:${name}`] = el.textContent;
    saveEdits();
  });
}

function card(item, group) {
  const article = document.createElement('article');
  article.className = 'card';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'thumb';
  button.dataset.open = item.id;
  button.dataset.group = group;
  button.setAttribute('aria-label', item.title);
  const img = document.createElement('img');
  img.src = `./screens/${item.image}`;
  img.alt = '';
  button.append(img);
  const title = document.createElement('h3');
  const text = document.createElement('p');
  bindEditable(title, item.id, 'title', item.title);
  bindEditable(text, item.id, 'text', item.text);
  article.append(button, title, text);
  return article;
}

function lane(className, heading, hint, items, group, flow) {
  const section = document.createElement('section');
  section.className = `lane ${className}`;
  const title = document.createElement('h2');
  title.textContent = heading;
  section.append(title);
  if (hint) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = hint;
    section.append(note);
  }
  const wrap = document.createElement('div');
  wrap.className = flow ? 'flow' : 'grid';
  for (const item of items) wrap.append(card(item, group));
  section.append(wrap);
  return section;
}

tour.append(
  lane('lane-clock', 'From the driver screen', 'Follow the arrows. These are the clock screens in order.', clockPath, 'clock-path', true),
  lane('lane-payroll', 'Into payroll', 'The punches from the driver screen land on these payroll screens.', payrollPath, 'payroll-path', true),
  lane('lane-clock', 'Every other clock screen', 'Timeclock settings, paper records, and the office tools on a punch.', clockMore, 'clock-more', false),
  lane('lane-payroll', 'Every other payroll screen', 'Driver info, pay periods, rounding, overtime, and the pay period sheet.', payrollMore, 'payroll-more', false),
  lane('', 'Earlier screenshots', 'The first captures. Same places, kept so you can choose.', earlier, 'earlier', false)
);

function itemAt(group, index) {
  const list = groups[group];
  return list[(index + list.length) % list.length];
}

function show(group, index) {
  openGroup = group;
  openIndex = index;
  const item = itemAt(group, index);
  screenImage.src = `./screens/${item.image}`;
  screenImage.alt = field(item.id, 'title', item.title);
  screenTitle.textContent = field(item.id, 'title', item.title);
  screenText.textContent = field(item.id, 'text', item.text);
  if (!dialog.open) dialog.showModal();
}

tour.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-open]') : null;
  if (!button) return;
  const group = button.dataset.group;
  const index = groups[group].findIndex((item) => item.id === button.dataset.open);
  show(group, index < 0 ? 0 : index);
});

document.querySelector('#screen-prev').addEventListener('click', () => show(openGroup, openIndex - 1));
document.querySelector('#screen-next').addEventListener('click', () => show(openGroup, openIndex + 1));

if (liveEdit) {
  bindEditable(screenTitle, 'dialog', 'unused', '');
  screenTitle.removeAttribute('contenteditable');
  bindEditable(screenText, 'dialog', 'unused', '');
  screenText.removeAttribute('contenteditable');
  screenTitle.contentEditable = 'true';
  screenText.contentEditable = 'true';
  const syncOpen = (el, name) => {
    el.addEventListener('input', () => {
      const item = itemAt(openGroup, openIndex);
      edits[`${item.id}:${name}`] = el.textContent;
      saveEdits();
      const cardTitle = [...tour.querySelectorAll('.card')].find((node) => node.querySelector(`[data-open="${item.id}"]`));
      const target = name === 'title' ? cardTitle?.querySelector('h3') : cardTitle?.querySelector('p');
      if (target && target.textContent !== el.textContent) target.textContent = el.textContent;
    });
  };
  syncOpen(screenTitle, 'title');
  syncOpen(screenText, 'text');
}

document.querySelector('#download-edits')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(edits, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'tour-words.json';
  link.click();
  URL.revokeObjectURL(link.href);
});

document.querySelector('#load-edits')?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  edits = JSON.parse(await file.text());
  saveEdits();
  location.reload();
});

document.querySelector('#reset-edits')?.addEventListener('click', () => {
  if (!confirm('Put the original sentences back?')) return;
  edits = {};
  saveEdits();
  location.reload();
});

document.addEventListener('keydown', (event) => {
  if (!dialog.open) return;
  if (event.target instanceof HTMLElement && event.target.isContentEditable) return;
  if (event.key === 'ArrowLeft') show(openGroup, openIndex - 1);
  if (event.key === 'ArrowRight') show(openGroup, openIndex + 1);
});
