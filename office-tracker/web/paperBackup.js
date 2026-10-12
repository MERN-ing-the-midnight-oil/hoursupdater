/**
 * Paper backup page on Clocking. The sheet is what prints.
 * Duration and the reminder choice are saved with the office.
 */

import {
  backupRange,
  groupPunchesByDriver,
  normalizeBackupHours,
  normalizePaperBackup,
  paperBackupCsv,
  paperBackupHtml,
  paperBackupReminderDue,
  paperBackupReminderText,
  punchesInRange,
  yearToDateFilename,
  yearToDateRange,
} from '../src/paperClockBackup.js';

/**
 * @param {{
 *   readState: () => { punches?: object[], paperBackup?: object },
 *   writeState: (state: object) => void,
 * }} options
 */
export function mountPaperBackup({ readState, writeState }) {
  const view = document.querySelector('#paper-backup-view');
  const form = document.querySelector('#paper-backup-form');
  const hoursInput = document.querySelector('#paper-backup-hours');
  const remindersInput = document.querySelector('#paper-backup-reminders');
  const sheet = document.querySelector('#paper-backup-sheet');
  const status = document.querySelector('#paper-backup-status');
  const reminder = document.querySelector('#paper-backup-reminder');
  const reminderText = document.querySelector('#paper-backup-reminder-text');
  if (!(hoursInput instanceof HTMLInputElement) || !(remindersInput instanceof HTMLInputElement) || !sheet) {
    return { refresh() {} };
  }

  function saved() {
    return normalizePaperBackup(readState().paperBackup);
  }

  function punches() {
    const list = readState().punches;
    return Array.isArray(list) ? list : [];
  }

  /**
   * @param {Partial<{ hours: number, reminders: boolean, lastPrintedAt: string }>} partial
   */
  function save(partial) {
    const next = readState();
    next.paperBackup = { ...normalizePaperBackup(next.paperBackup), ...partial };
    writeState(next);
  }

  function setStatus(message) {
    if (!status) return;
    status.hidden = !message;
    status.textContent = message || '';
  }

  function fillForm() {
    const prefs = saved();
    if (document.activeElement !== hoursInput) hoursInput.value = String(prefs.hours);
    if (document.activeElement !== remindersInput) remindersInput.checked = prefs.reminders;
  }

  function commitForm() {
    const hours = normalizeBackupHours(hoursInput.value);
    hoursInput.value = String(hours);
    save({ hours, reminders: remindersInput.checked });
    return saved();
  }

  function renderSheet() {
    const now = new Date();
    const prefs = saved();
    const range = backupRange(now, prefs.hours);
    const groups = groupPunchesByDriver(punchesInRange(punches(), range.start, range.end));
    sheet.innerHTML = paperBackupHtml(groups, { hours: prefs.hours, start: range.start, end: range.end });
  }

  function renderReminder() {
    if (!reminder) return;
    const now = new Date();
    const prefs = saved();
    const due = paperBackupReminderDue({ ...prefs, punches: punches(), now });
    reminder.hidden = !due;
    if (reminderText) reminderText.textContent = due ? paperBackupReminderText(prefs) : '';
  }

  function refresh() {
    fillForm();
    renderSheet();
    renderReminder();
  }

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    commitForm();
    refresh();
    setStatus('Paper backup settings saved.');
  });
  hoursInput.addEventListener('change', () => {
    commitForm();
    renderSheet();
    renderReminder();
    setStatus('');
  });
  remindersInput.addEventListener('change', () => {
    commitForm();
    renderReminder();
    setStatus(remindersInput.checked ? 'Paper backup reminders are on.' : 'Paper backup reminders are off.');
  });

  document.querySelector('#paper-backup-print')?.addEventListener('click', () => {
    const prefs = commitForm();
    renderSheet();
    save({ lastPrintedAt: new Date().toISOString() });
    renderReminder();
    window.print();
    setStatus(
      prefs.reminders
        ? `Paper backup sent to the printer. The next reminder is in ${prefs.hours} hours.`
        : 'Paper backup sent to the printer.'
    );
  });

  document.querySelector('#paper-backup-ytd')?.addEventListener('click', () => {
    const now = new Date();
    const range = yearToDateRange(now);
    const groups = groupPunchesByDriver(punchesInRange(punches(), range.start, range.end));
    const csv = paperBackupCsv(groups);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = yearToDateFilename(now);
    link.click();
    URL.revokeObjectURL(url);
    const count = groups.reduce((sum, group) => sum + group.punches.length, 0);
    setStatus(
      count
        ? `Downloaded ${count} clock record${count === 1 ? '' : 's'} for ${now.getFullYear()}.`
        : `Downloaded clock records for ${now.getFullYear()}. There are no clock records yet this year.`
    );
  });

  window.setInterval(() => {
    renderReminder();
    if (view && !view.hidden) renderSheet();
  }, 60000);

  return { refresh };
}
