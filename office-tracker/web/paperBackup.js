import {
  groupPunchesByDriver,
  markPaperPagesPrinted,
  normalizePaperBackup,
  paperBackupCsv,
  paperBackupReminderDue,
  paperBackupReminderText,
  paperPageSpan,
  PAPER_PAGE_SIZE,
  paperPagesHtml,
  printedPaperPages,
  punchesInRange,
  syncPaperPages,
  waitingPaperPages,
  yearToDateFilename,
  yearToDateRange,
} from '../src/paperClockBackup.js';

export function mountPaperBackup({ readState, writeState }) {
  const view = document.querySelector('#paper-backup-view');
  const remindersInput = document.querySelector('#paper-backup-reminders');
  const sheet = document.querySelector('#paper-backup-sheet');
  const status = document.querySelector('#paper-backup-status');
  const reminder = document.querySelector('#paper-backup-reminder');
  const reminderText = document.querySelector('#paper-backup-reminder-text');
  const waitingList = document.querySelector('#paper-record-waiting');
  const printedList = document.querySelector('#paper-record-printed');
  const openNote = document.querySelector('#paper-record-open');
  if (!(remindersInput instanceof HTMLInputElement) || !sheet) {
    return { refresh() {} };
  }

  function punches() {
    const list = readState().punches;
    return Array.isArray(list) ? list : [];
  }

  function remember(pages, reminders = remindersInput.checked) {
    const next = readState();
    const current = normalizePaperBackup(next.paperBackup);
    next.paperBackup = { ...current, reminders, pages };
    writeState(next);
  }

  // Seal any new full pages into the shared queue.
  function currentPages() {
    const saved = normalizePaperBackup(readState().paperBackup);
    const synced = syncPaperPages(punches(), saved.pages);
    const before = saved.pages.map((page) => page.id).join('\n');
    const after = synced.pages.map((page) => page.id).join('\n');
    if (before !== after) remember(synced.pages, saved.reminders);
    return {
      prefs: normalizePaperBackup(readState().paperBackup),
      pages: synced.pages,
      open: synced.open,
    };
  }

  function setStatus(message) {
    if (!status) return;
    status.hidden = !message;
    status.textContent = message || '';
  }

  function showPages(pages) {
    sheet.innerHTML = paperPagesHtml(pages);
  }

  function renderReminder(pages) {
    if (!reminder) return;
    const prefs = normalizePaperBackup(readState().paperBackup);
    const waiting = waitingPaperPages(pages);
    const due = paperBackupReminderDue({ reminders: prefs.reminders, pages });
    reminder.hidden = !due;
    if (reminderText) reminderText.textContent = due ? paperBackupReminderText(waiting.length) : '';
  }

  function fillPageList(list, pages, emptyText) {
    if (!list) return;
    list.replaceChildren();
    if (!pages.length) {
      const item = document.createElement('li');
      item.textContent = emptyText;
      list.append(item);
      return;
    }
    pages.forEach((page, index) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      const number = page.number || index + 1;
      label.textContent = `Page ${number} · ${paperPageSpan(page.rows)}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = 'Print';
      button.addEventListener('click', () => printPages([page], false));
      item.append(label, button);
      list.append(item);
    });
  }

  function renderQueue() {
    const { prefs, pages, open } = currentPages();
    if (document.activeElement !== remindersInput) remindersInput.checked = prefs.reminders;
    const waiting = waitingPaperPages(pages).map((page, index) => ({
      ...page,
      number: pages.findIndex((item) => item.id === page.id) + 1 || index + 1,
      title: `Page ${pages.findIndex((item) => item.id === page.id) + 1}`,
    }));
    const printed = printedPaperPages(pages).map((page) => ({
      ...page,
      number: pages.findIndex((item) => item.id === page.id) + 1,
      title: `Page ${pages.findIndex((item) => item.id === page.id) + 1}`,
    }));
    fillPageList(waitingList, waiting, 'No pages are waiting.');
    fillPageList(printedList, printed, 'No pages have been printed yet.');
    const printWaiting = document.querySelector('#paper-record-print-waiting');
    if (printWaiting instanceof HTMLButtonElement) printWaiting.disabled = waiting.length === 0;
    if (openNote) {
      const remaining = PAPER_PAGE_SIZE - open.length;
      openNote.textContent = open.length
        ? `The current page has ${open.length} clock record${open.length === 1 ? '' : 's'}. ${remaining} more fill the next page.`
        : 'The current page is empty. Clock records fill it until a whole page is ready.';
    }
    showPages(
      waiting.length
        ? waiting
        : open.length
          ? [{ title: 'Current page', rows: open }]
          : []
    );
    renderReminder(pages);
    return { waiting, printed, open, pages };
  }

  function printPages(selected, clearWaiting) {
    const { pages } = currentPages();
    const printable = selected.filter((page) => page.rows?.length);
    if (!printable.length) {
      setStatus('There are no clock records to print.');
      return;
    }
    showPages(printable);
    if (clearWaiting) {
      const ids = printable.map((page) => page.id).filter(Boolean);
      remember(markPaperPagesPrinted(pages, ids, new Date().toISOString()));
    } else {
      const unprinted = printable.filter((page) => page.id && !page.printedAt).map((page) => page.id);
      if (unprinted.length) remember(markPaperPagesPrinted(pages, unprinted, new Date().toISOString()));
    }
    renderQueue();
    showPages(printable);
    window.print();
    const count = printable.length;
    setStatus(
      count === 1 ? '1 page was sent to the printer.' : `${count} pages were sent to the printer.`
    );
  }

  function refresh() {
    renderQueue();
  }

  document.querySelector('#paper-backup-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const { pages } = currentPages();
    remember(pages, remindersInput.checked);
    renderReminder(pages);
    setStatus('Paper record reminder saved.');
  });
  remindersInput.addEventListener('change', () => {
    const { pages } = currentPages();
    remember(pages, remindersInput.checked);
    renderReminder(pages);
    setStatus(remindersInput.checked ? 'Paper record reminders are on.' : 'Paper record reminders are off.');
  });

  document.querySelector('#paper-record-print-waiting')?.addEventListener('click', () => {
    const { waiting } = renderQueue();
    printPages(waiting, true);
  });
  document.querySelector('#paper-record-print-open')?.addEventListener('click', () => {
    const { open } = currentPages();
    if (!open.length) {
      setStatus('The current page has no clock records yet.');
      return;
    }
    showPages([{ title: 'Current page', rows: open }]);
    window.print();
    setStatus('The current page was sent to the printer. It stays open until it is full.');
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
    if (view && !view.hidden) renderQueue();
    else renderReminder(normalizePaperBackup(readState().paperBackup).pages);
  }, 60000);

  return { refresh };
}
