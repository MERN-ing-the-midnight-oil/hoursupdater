import QRCode from 'qrcode';
import { holidayListForState } from '../../src/logic/schoolYear.js';
import { DEFAULT_CONTRACT_SNAP_BREAKS } from '../../src/logic/timeUtils.js';
import { parseCardPeriodEnd } from '../src/auditPayPeriods.js';
import { parseStickerContractHours } from '../src/timesheetGenieCard.js';
import {
  auditWrittenHours,
  formatAuditHours,
  parseAuditHours,
} from '../src/timesheetAudit.js';
import { auditPeriodResultText, readAuditPeriodRecord, saveAuditPeriodResult } from './auditPeriodStore.js';
import { formatStampParts, inferDefaultYear, parseStampParts } from '../src/timesheetNormalize.js';
import { BACK_SLOT_COUNT, FRONT_SLOT_COUNT } from '../src/timesheetPrompt.js';
import { normalizeTimesheetHoursMode, TIMESHEET_HOURS_MODE_SNAP } from '../src/timesheetSnap.js';
import { contractSnapBreaksFromState } from './store.js';
import {
  captureShareUrl,
  closeCaptureSession,
  fetchCapturePhoto,
  loadCaptureShareOrigin,
  openCaptureSession,
  readCaptureSession,
} from './timesheetCaptureClient.js';

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const CAMERA_KEY = 'teamster-timesheet-camera';
const HOURS_MODE_KEY = 'teamster-audit-hours-mode';
const CARD_ASPECT_WIDTH = 5;
const CARD_ASPECT_HEIGHT = 8;

/**
 * Blue Timecard Checker desk. Reads Reg and OT already written on a blue card and
 * compares them with the hours the Clock Record stamps produce.
 * @param {{ readState?: () => object, deviceOnly?: boolean }} [options]
 */
export function mountAuditGenie(options = {}) {
  const view = document.querySelector('#audit-genie-view');
  const form = document.querySelector('#audit-form');
  const status = document.querySelector('#audit-status');
  const statusText = status?.querySelector('.timesheet-progress-text') || status;
  const result = document.querySelector('#audit-result');
  if (!view || !form || !status || !result) return { refresh() {} };

  /** @type {object | null} */
  let extraction = null;
  /** Pay-period end already marked from this read. */
  let markedFor = '';
  /** Shown on the pay-period list when Mark as Checked cannot save. */
  let periodNote = '';
  /** @type {ReturnType<typeof setInterval> | null} */
  let progressTimer = null;
  let hoursMode = readStoredHoursMode();
  const deviceOnly = options.deviceOnly === true;

  const camera = mountAuditCamera({
    onCapture(side, file) {
      setSideFile(side, file);
      setStatus('');
      // Front, then back, then the check. A later retake of either photo starts again from that step.
      if (side === 'front') {
        camera.open('back').catch((error) => setStatus(error?.message || 'Could not open the camera.', 'error'));
        return;
      }
      readCard().catch((error) => setStatus(error?.message || 'Could not audit that card.', 'error'));
    },
  });
  const phoneCapture = deviceOnly
    ? { pause() {}, resume() {}, reset() {} }
    : mountAuditPhone({
        setSideFile,
        setStatus,
      });
  if (deviceOnly) {
    document.querySelector('#audit-capture-source')?.setAttribute('hidden', '');
    const computer = document.querySelector('#audit-computer-capture');
    const phone = document.querySelector('#audit-phone-capture');
    if (computer instanceof HTMLElement) computer.hidden = false;
    if (phone instanceof HTMLElement) phone.hidden = true;
  }

  new MutationObserver(() => {
    if (view.hidden) {
      camera.close();
      phoneCapture.pause();
      return;
    }
    phoneCapture.resume();
  }).observe(view, { attributes: true, attributeFilter: ['hidden'] });

  paintHoursMode();
  paintPeriods();
  document.querySelector('#audit-hours-mode')?.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-hours-mode]') : null;
    if (!(button instanceof HTMLButtonElement)) return;
    hoursMode = normalizeTimesheetHoursMode(button.dataset.hoursMode);
    try {
      localStorage.setItem(HOURS_MODE_KEY, hoursMode);
    } catch {
      /* The choice still applies to this card. */
    }
    paintHoursMode();
    if (extraction) renderResult();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    readCard().catch((error) => setStatus(error?.message || 'Could not audit that card.', 'error'));
  });
  document.querySelector('#audit-clear')?.addEventListener('click', () => clearCard());
  document.querySelector('#audit-mark-checked')?.addEventListener('click', () => markChecked());
  document.querySelector('#audit-recalculate')?.addEventListener('click', () => recalculate());
  document.querySelector('#audit-sticker-date')?.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !extraction) return;
    if (!extraction.header || typeof extraction.header !== 'object') extraction.header = {};
    extraction.header.period_end = parseCardPeriodEnd(input.value);
    paintStickerDate(true);
    paintMarkButton(true);
    paintPeriods(periodNote);
  });
  document.querySelector('#audit-contract-hours')?.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const parsed = parseStickerContractHours(input.value);
    paintContractLabel(parsed?.total ?? null);
    if (!extraction) return;
    if (!extraction.header || typeof extraction.header !== 'object') extraction.header = {};
    extraction.header.contract_hours = parsed?.total ?? null;
    renderResult();
  });
  document.querySelector('#audit-front-file')?.addEventListener('click', () => {
    document.querySelector('#audit-front')?.click();
  });
  document.querySelector('#audit-back-file')?.addEventListener('click', () => {
    document.querySelector('#audit-back')?.click();
  });
  document.querySelector('#audit-front')?.addEventListener('change', (event) => {
    const file = event.target instanceof HTMLInputElement ? event.target.files?.[0] : null;
    if (file) setSideFile('front', file);
  });
  document.querySelector('#audit-back')?.addEventListener('change', (event) => {
    const file = event.target instanceof HTMLInputElement ? event.target.files?.[0] : null;
    if (file) setSideFile('back', file);
  });
  document.querySelector('#audit-front-camera')?.addEventListener('click', () => {
    camera.open('front').catch((error) => setStatus(error?.message || 'Could not open the camera.', 'error'));
  });
  document.querySelector('#audit-back-camera')?.addEventListener('click', () => {
    camera.open('back').catch((error) => setStatus(error?.message || 'Could not open the camera.', 'error'));
  });

  document.querySelector('#audit-result')?.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !extraction) return;
    const tr = input.closest('tr[data-row-index]');
    if (!tr) return;
    const side = tr.dataset.side === 'back' ? 'back' : 'front';
    const index = Number(tr.dataset.rowIndex) || 0;
    const rows = side === 'back' ? extraction.back_rows : extraction.front_rows;
    const row = Array.isArray(rows) ? rows[index - 1] : null;
    if (!row) return;
    if (input.dataset.part) {
      const stamp = input.closest('[data-stamp]');
      const which = stamp?.dataset.stamp === 'in' ? 'in' : 'out';
      row[`clock_${which}_raw`] = stamp instanceof HTMLElement ? readStamp(stamp) : null;
      renderResult();
      return;
    }
    const field = input.dataset.written;
    if (field !== 'reg' && field !== 'ot' && field !== 'tot') return;
    applyWrittenInput(row, field, input.value);
    renderResult();
  });

  const descDialog = document.querySelector('#audit-desc-dialog');
  const descTitle = document.querySelector('#audit-desc-title');
  const descText = document.querySelector('#audit-desc-text');
  const descSave = document.querySelector('#audit-desc-save');
  /** @type {{ row: object, button: HTMLButtonElement } | null} */
  let descTarget = null;
  document.querySelector('#audit-result')?.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('.timesheet-desc-open') : null;
    if (!(button instanceof HTMLButtonElement) || !extraction || !(descDialog instanceof HTMLDialogElement)) return;
    if (!(descText instanceof HTMLTextAreaElement)) return;
    const tr = button.closest('tr[data-row-index]');
    if (!tr) return;
    const side = tr.dataset.side === 'back' ? 'back' : 'front';
    const index = Number(tr.dataset.rowIndex) || 0;
    const rows = side === 'back' ? extraction.back_rows : extraction.front_rows;
    const row = Array.isArray(rows) ? rows[index - 1] : null;
    if (!row) return;
    descTarget = { row, button };
    if (descTitle) descTitle.textContent = `${side === 'back' ? 'Back' : 'Front'} row ${index}`;
    descText.value = row.description_of_work || '';
    if (!descDialog.open) descDialog.showModal();
    descText.focus();
  });
  descSave?.addEventListener('click', () => {
    if (!descTarget || !(descText instanceof HTMLTextAreaElement) || !(descDialog instanceof HTMLDialogElement)) return;
    const text = descText.value.trim();
    descTarget.row.description_of_work = text || null;
    descTarget.button.classList.toggle('is-empty', !text);
    descTarget.button.textContent = text ? '✎' : '+';
    descTarget.button.title = text || 'Description of Work';
    descDialog.close();
  });
  document.querySelector('#audit-desc-cancel')?.addEventListener('click', () => {
    if (descDialog instanceof HTMLDialogElement) descDialog.close();
  });

  function officeState() {
    try {
      return typeof options.readState === 'function' ? options.readState() : null;
    } catch {
      return null;
    }
  }

  function snapBreaks() {
    try {
      return contractSnapBreaksFromState(officeState() || {});
    } catch {
      return { ...DEFAULT_CONTRACT_SNAP_BREAKS };
    }
  }

  function currentReport() {
    const state = officeState() || {};
    return auditWrittenHours(extraction, {
      breaks: snapBreaks(),
      rules: state.overtimeRules,
      holidays: holidayListForState(state),
      defaultYear: inferDefaultYear(null),
      mode: hoursMode,
    });
  }

  function paintHoursMode() {
    for (const button of document.querySelectorAll('#audit-hours-mode [data-hours-mode]')) {
      if (!(button instanceof HTMLButtonElement)) continue;
      button.setAttribute('aria-pressed', button.dataset.hoursMode === hoursMode ? 'true' : 'false');
    }
  }

  function rememberPeriod(report) {
    const iso = resolvedPeriodEndIso();
    if (!iso) {
      return {
        note: 'Type the pay period ending date from the sticker. It is the MM/DD/YY to the right of the driver\'s name.',
        record: null,
      };
    }
    if (!extraction.header || typeof extraction.header !== 'object') extraction.header = {};
    extraction.header.period_end = iso;
    const record = saveAuditPeriodResult({
      iso,
      mistakeCount: report.mistakeCount,
      uncheckedCount: report.uncheckedCount,
      result: auditPeriodResultText(report),
    });
    if (!record?.[iso]) {
      return {
        note: 'Could not save that checked pay period in this browser.',
        record: null,
      };
    }
    return { note: '', record };
  }

  function resolvedPeriodEndIso() {
    const fromHeader = String(extraction?.header?.period_end || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromHeader)) return fromHeader;
    const parsedHeader = parseCardPeriodEnd(fromHeader);
    if (parsedHeader) return parsedHeader;
    const input = document.querySelector('#audit-sticker-date');
    if (input instanceof HTMLInputElement) return parseCardPeriodEnd(input.value) || '';
    return '';
  }

  function paintMarkButton(hasCard) {
    const actions = document.querySelector('#audit-result-actions');
    if (actions instanceof HTMLElement) actions.hidden = !hasCard;
    const markActions = document.querySelector('#audit-mark-actions');
    if (markActions instanceof HTMLElement) markActions.hidden = !hasCard;
    const button = document.querySelector('#audit-mark-checked');
    if (!(button instanceof HTMLButtonElement)) return;
    const iso = resolvedPeriodEndIso();
    if (extraction?.header && iso && extraction.header.period_end !== iso) {
      extraction.header.period_end = iso;
    }
    const dateLabel = formatStickerDate(iso);
    const marked = Boolean(hasCard && iso && markedFor === iso);
    button.disabled = marked;
    button.classList.toggle('is-marked', marked);
    if (!dateLabel) {
      button.textContent = marked ? 'Marked as checked' : 'Mark as Checked?';
      return;
    }
    button.textContent = marked ? `Marked ${dateLabel} as checked` : `Mark ${dateLabel} as Checked?`;
  }

  function syncCardFromEditors() {
    if (!extraction) return;
    if (!extraction.header || typeof extraction.header !== 'object') extraction.header = {};
    const periodInput = document.querySelector('#audit-sticker-date');
    if (periodInput instanceof HTMLInputElement) {
      const typed = parseCardPeriodEnd(periodInput.value);
      if (typed) extraction.header.period_end = typed;
      else if (!String(periodInput.value || '').trim()) extraction.header.period_end = null;
    }
    const contractInput = document.querySelector('#audit-contract-hours');
    if (contractInput instanceof HTMLInputElement) {
      const parsed = parseStickerContractHours(contractInput.value);
      extraction.header.contract_hours = parsed?.total ?? null;
    }
    // Reg/OT inputs stay blank until contract hours are set, so do not read those
    // empty cells back into the extraction or the AI handwriting is wiped.
    const showRegOt = hasContractHours();
    for (const side of ['front', 'back']) {
      const rows = side === 'back' ? extraction.back_rows : extraction.front_rows;
      if (!Array.isArray(rows)) continue;
      const body = document.querySelector(side === 'front' ? '#audit-front-body' : '#audit-back-body');
      if (!(body instanceof HTMLElement)) continue;
      for (const tr of body.querySelectorAll('tr[data-row-index]')) {
        if (!(tr instanceof HTMLTableRowElement)) continue;
        const index = Number(tr.dataset.rowIndex) || 0;
        const row = rows[index - 1];
        if (!row) continue;
        const outStamp = tr.querySelector('[data-stamp="out"]');
        const inStamp = tr.querySelector('[data-stamp="in"]');
        if (outStamp instanceof HTMLElement) row.clock_out_raw = readStamp(outStamp);
        if (inStamp instanceof HTMLElement) row.clock_in_raw = readStamp(inStamp);
        const fields = showRegOt ? ['reg', 'ot', 'tot'] : ['tot'];
        for (const field of fields) {
          const input = tr.querySelector(`input[data-written="${field}"]`);
          if (!(input instanceof HTMLInputElement)) continue;
          applyWrittenInput(row, field, input.value);
        }
      }
    }
  }

  function recalculate() {
    if (!extraction) {
      setStatus('Check a card first.', 'error');
      return;
    }
    syncCardFromEditors();
    renderResult();
    setStatus('Recalculated from the contract hours and Clock Record.', 'ok');
  }

  function markChecked() {
    if (!extraction) return;
    const remembered = rememberPeriod(currentReport());
    periodNote = remembered.note;
    const iso = extraction.header?.period_end || '';
    if (!periodNote && iso) {
      markedFor = iso;
      setStatus(`${stickerDayLabel(iso)} marked as checked.`, 'ok');
    } else if (periodNote) {
      setStatus(periodNote, 'error');
    }
    paintPeriods(periodNote, {
      record: remembered.record || undefined,
      open: !periodNote && Boolean(iso),
    });
    paintStickerDate(true);
    paintMarkButton(true);
  }

  function paintStickerDate(visible) {
    const wrap = document.querySelector('#audit-sticker');
    const label = document.querySelector('#audit-sticker-label');
    const input = document.querySelector('#audit-sticker-date');
    if (!(wrap instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
    wrap.hidden = !visible;
    if (!visible) {
      input.value = '';
      if (label) label.textContent = 'Pay period ending';
      return;
    }
    const iso = resolvedPeriodEndIso();
    if (extraction?.header && iso) extraction.header.period_end = iso;
    const dateLabel = formatStickerDate(iso);
    if (label) {
      label.textContent = dateLabel ? `Pay period ending ${dateLabel}` : 'Pay period ending';
    }
    if (document.activeElement !== input) input.value = dateLabel;
    paintContract();
  }

  function paintContractLabel(hours) {
    const contractLabel = document.querySelector('#audit-contract-label');
    if (!(contractLabel instanceof HTMLElement)) return;
    contractLabel.textContent =
      hours == null || !(Number(hours) > 0)
        ? 'Daily contract hours'
        : `Daily contract hours ${formatAuditHours(hours)}`;
  }

  function paintContract() {
    const field = document.querySelector('#audit-contract-hours');
    if (!(field instanceof HTMLInputElement)) return;
    const hours = extraction?.header?.contract_hours;
    paintContractLabel(hours);
    if (hours != null && Number(hours) > 0 && document.activeElement !== field) {
      field.value = formatAuditHours(hours);
    }
  }

  function readTypedContractHours() {
    const field = document.querySelector('#audit-contract-hours');
    if (!(field instanceof HTMLInputElement)) return null;
    return parseStickerContractHours(field.value);
  }

  function hasContractHours() {
    const typed = readTypedContractHours()?.total;
    if (typed != null && Number(typed) > 0) return true;
    const hours = Number(extraction?.header?.contract_hours);
    return Number.isFinite(hours) && hours > 0;
  }

  function paintPeriods(note = '', options = {}) {
    let box = document.querySelector('#audit-periods');
    if (!box) {
      box = document.createElement('section');
      box.id = 'audit-periods';
      box.className = 'audit-periods';
      box.setAttribute('aria-label', 'Checked pay periods');
    }
    // Keep the list just above Mark as Checked so the new date is visible after a click.
    const markActions = document.querySelector('#audit-mark-actions');
    if (markActions?.parentNode) {
      markActions.parentNode.insertBefore(box, markActions);
    } else if (!box.isConnected) {
      view.append(box);
    }
    const record = options.record && typeof options.record === 'object'
      ? options.record
      : readAuditPeriodRecord();
    const current = extraction?.header?.period_end || resolvedPeriodEndIso() || '';
    const saved = Object.values(record)
      .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry?.iso || ''))
      .sort((a, b) => String(b.iso).localeCompare(String(a.iso)));
    const wasOpen = box.querySelector('details')?.open === true;
    box.replaceChildren();
    const details = document.createElement('details');
    if (options.open || wasOpen) details.open = true;
    const summary = document.createElement('summary');
    const heading = document.createElement('h2');
    heading.textContent = 'Checked pay periods';
    const count = document.createElement('p');
    count.className = 'audit-periods-count';
    count.textContent = saved.length ? `${saved.length} checked` : 'No cards checked yet.';
    summary.append(heading, count);
    if (note) {
      const noteEl = document.createElement('p');
      noteEl.className = 'audit-periods-note';
      noteEl.textContent = note;
      summary.append(noteEl);
    }
    const list = document.createElement('ul');
    list.className = 'audit-period-list';
    for (const entry of saved) {
      const item = document.createElement('li');
      item.className = 'audit-period is-clear';
      if (entry.iso === current) item.classList.add('is-current');
      const when = document.createElement('span');
      when.textContent = stickerDayLabel(entry.iso);
      const result = document.createElement('span');
      result.textContent = 'Checked';
      item.append(when, result);
      list.append(item);
    }
    details.append(summary, list);
    box.append(details);
  }

  function renderResult() {
    if (!extraction) return;
    if (!extraction.header || typeof extraction.header !== 'object') extraction.header = {};
    const report = currentReport();
    const showRegOt = hasContractHours();
    paintSide('front', extraction.front_rows, report.front, showRegOt);
    paintSide('back', extraction.back_rows, report.back, showRegOt);
    result.hidden = false;
    const hasCard = report.front.length + report.back.length > 0;
    paintStickerDate(true);
    paintMarkButton(true);
    const iso = resolvedPeriodEndIso();
    paintPeriods(periodNote);
    paintResultHint(showRegOt);
    if (!hasCard) {
      setStatus('No clock stamps or written hours were found on those photos.', 'error');
    } else if (!iso) {
      setStatus('Could not read the pay period ending date from the sticker. Type the MM/DD/YY to the right of the driver\'s name.', 'error');
    } else if (!showRegOt) {
      setStatus('Daily contract hours are required to check Reg and OT.', 'error');
    } else if (markedFor && markedFor === iso) {
      setStatus(`${stickerDayLabel(iso)} marked as checked.`, 'ok');
    } else {
      setStatus('The front and back cards are ready to edit.', 'ok');
    }
  }

  function paintResultHint(showRegOt) {
    const hint =
      document.querySelector('#audit-result .hint') ||
      document.querySelector('#audit-result .field-hint');
    if (!(hint instanceof HTMLElement)) return;
    hint.textContent = showRegOt
      ? 'Blue handwriting is what was written on the card. A red number is the calculated hours when they differ.'
      : 'Daily contract hours are required to show and check Reg and OT. Tot. Hrs. still compares each Clock Record combo.';
  }

  function refresh() {
    if (extraction) renderResult();
  }

  async function readCard() {
    const front = document.querySelector('#audit-front');
    const back = document.querySelector('#audit-back');
    const frontFile = front instanceof HTMLInputElement ? front.files?.[0] ?? null : null;
    const backFile = back instanceof HTMLInputElement ? back.files?.[0] ?? null : null;
    if (!frontFile && !backFile) {
      setStatus('Take a photo of the front, the back, or both.', 'error');
      return;
    }
    const contract = readTypedContractHours();
    if (!contract?.total) {
      setStatus('Enter the daily contract hours before submitting the photos.', 'error');
      document.querySelector('#audit-contract-hours')?.focus();
      return;
    }
    validateFile(frontFile, 'Front');
    validateFile(backFile, 'Back');
    const button = document.querySelector('#audit-read');
    const clearButton = document.querySelector('#audit-clear');
    if (button instanceof HTMLButtonElement) button.disabled = true;
    if (clearButton instanceof HTMLButtonElement) clearButton.disabled = true;
    const sides = [frontFile && 'front', backFile && 'back'].filter(Boolean);
    try {
      setBusyStatus(sides.length === 2 ? 'Preparing the front and back photos…' : 'Preparing the photo…');
      const frontPayload = frontFile ? await filePayload(frontFile) : null;
      const backPayload = backFile ? await filePayload(backFile) : null;
      startProgressMessages([
        'Reading the written Reg and OT…',
        'Reading the pay period ending date on the sticker…',
        'Reading the Clock Record stamps…',
        'Comparing the hours with the clocks…',
      ]);
      const response = await fetch('/api/timesheet-audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ front: frontPayload, back: backPayload }),
      });
      stopProgressMessages();
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not audit that card.');
      extraction = payload.extraction;
      if (!extraction.header || typeof extraction.header !== 'object') extraction.header = {};
      // The typed daily contract hours are required for Reg/OT and win over any sticker read.
      extraction.header.contract_hours = contract.total;
      markedFor = '';
      periodNote = '';
      renderResult();
    } catch (error) {
      stopProgressMessages();
      setStatus(error?.message || 'Could not audit that card.', 'error');
    } finally {
      stopProgressMessages();
      if (button instanceof HTMLButtonElement) button.disabled = false;
      if (clearButton instanceof HTMLButtonElement) clearButton.disabled = false;
    }
  }

  function clearCard() {
    stopProgressMessages();
    extraction = null;
    markedFor = '';
    periodNote = '';
    paintMarkButton(false);
    paintStickerDate(false);
    paintContractLabel(null);
    const actions = document.querySelector('#audit-result-actions');
    if (actions instanceof HTMLElement) actions.hidden = true;
    const markActions = document.querySelector('#audit-mark-actions');
    if (markActions instanceof HTMLElement) markActions.hidden = true;
    camera.close();
    phoneCapture.reset();
    form.reset();
    clearSidePreview('front');
    clearSidePreview('back');
    for (const id of ['#audit-front-body', '#audit-back-body']) {
      const body = document.querySelector(id);
      if (!(body instanceof HTMLElement)) continue;
      body.replaceChildren();
      delete body.dataset.signature;
    }
    result.hidden = true;
    setStatus('');
    paintPeriods();
  }

  function setSideFile(side, file) {
    const input = document.querySelector(side === 'front' ? '#audit-front' : '#audit-back');
    if (input instanceof HTMLInputElement && input.files?.[0] !== file) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    }
    showSidePreview(side, file);
  }

  function setStatus(message, kind = '') {
    status.hidden = !message;
    status.className = `status timesheet-progress${kind ? ` is-${kind}` : ''}`;
    if (statusText) statusText.textContent = message || '';
    else status.textContent = message || '';
  }

  function setBusyStatus(message) {
    status.hidden = !message;
    status.className = 'status timesheet-progress is-busy';
    if (statusText) statusText.textContent = message || '';
    else status.textContent = message || '';
  }

  function startProgressMessages(messages) {
    stopProgressMessages();
    if (!messages.length) return;
    let index = 0;
    setBusyStatus(messages[0]);
    progressTimer = setInterval(() => {
      index = (index + 1) % messages.length;
      setBusyStatus(messages[index]);
    }, 4000);
  }

  function stopProgressMessages() {
    if (progressTimer != null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  return { refresh };
}

function readStoredHoursMode() {
  try {
    return normalizeTimesheetHoursMode(localStorage.getItem(HOURS_MODE_KEY));
  } catch {
    return TIMESHEET_HOURS_MODE_SNAP;
  }
}

function paintSide(side, sourceRows, judgedRows, showRegOt = false) {
  const body = document.querySelector(side === 'front' ? '#audit-front-body' : '#audit-back-body');
  if (!(body instanceof HTMLElement)) return;
  const slotCount = side === 'front' ? FRONT_SLOT_COUNT : BACK_SLOT_COUNT;
  const signature = `${side}:${slotCount}`;
  if (body.dataset.signature !== signature) {
    body.dataset.signature = signature;
    body.replaceChildren();
    const rows = Array.isArray(sourceRows) ? sourceRows : [];
    for (let index = 1; index <= slotCount; index += 1) {
      body.append(buildCardRow(side, index, rows[index - 1], showRegOt));
    }
  }
  const judged = Array.isArray(judgedRows) ? judgedRows : [];
  const source = Array.isArray(sourceRows) ? sourceRows : [];
  for (let index = 1; index <= slotCount; index += 1) {
    const tr = body.querySelector(`tr[data-row-index="${index}"]`);
    if (!(tr instanceof HTMLTableRowElement)) continue;
    const judgedRow = judged.find((row) => row.rowIndex === index) || null;
    const sourceRow = source[index - 1] || null;
    syncRow(tr, judgedRow, sourceRow, showRegOt);
  }
}

function buildCardRow(side, index, source, showRegOt = false) {
  const row = source && typeof source === 'object' ? source : {};
  const sideLabel = side === 'back' ? 'Back' : 'Front';
  const description = String(row.description_of_work ?? '').trim();
  const tr = document.createElement('tr');
  tr.id = `audit-${side}-${index}`;
  tr.dataset.side = side;
  tr.dataset.rowIndex = String(index);
  if (cardRowIsQuiet(row)) tr.classList.add('is-quiet');
  const regValue = showRegOt ? writtenInputValue(row.written_regular_status, row.written_regular) : '';
  const otValue = showRegOt ? writtenInputValue(row.written_overtime_status, row.written_overtime) : '';
  tr.innerHTML = `
    <td class="timesheet-card-blank timesheet-card-desc">
      <button type="button" class="timesheet-desc-open${description ? '' : ' is-empty'}"
        aria-label="${description ? 'Edit' : 'Add'} Description of Work, ${sideLabel} row ${index}"
        title="${escapeAttr(description || 'Description of Work')}">${description ? '✎' : '+'}</button>
    </td>
    <td class="timesheet-card-blank timesheet-card-reg" data-audit-field="reg">
      <input class="timesheet-edit audit-handwriting" data-written="reg" type="text" inputmode="decimal"
        aria-label="Reg handwriting, ${sideLabel} row ${index}"
        value="${escapeAttr(regValue)}"${showRegOt ? '' : ' disabled'}>
      <span class="audit-calculated" data-audit-calculated="reg" hidden></span>
    </td>
    <td class="timesheet-card-blank timesheet-card-ot" data-audit-field="ot">
      <input class="timesheet-edit audit-handwriting" data-written="ot" type="text" inputmode="decimal"
        aria-label="OT handwriting, ${sideLabel} row ${index}"
        value="${escapeAttr(otValue)}"${showRegOt ? '' : ' disabled'}>
      <span class="audit-calculated" data-audit-calculated="ot" hidden></span>
    </td>
    <td class="timesheet-card-blank timesheet-card-tot" data-audit-field="tot">
      <input class="timesheet-edit audit-handwriting" data-written="tot" type="text" inputmode="decimal"
        aria-label="Tot. Hrs. handwriting, ${sideLabel} row ${index}"
        value="${escapeAttr(writtenInputValue(row.written_total_status, row.written_total))}">
      <span class="audit-calculated" data-audit-calculated="tot" hidden></span>
    </td>
    <td class="timesheet-card-clock" data-audit-field="clocks">
      ${stampEditorHtml('out', row.clock_out_raw, sideLabel, index)}
      ${stampEditorHtml('in', row.clock_in_raw, sideLabel, index)}
    </td>`;
  return tr;
}

function cardRowIsQuiet(row) {
  const written = ['written_regular_status', 'written_overtime_status', 'written_total_status'].some(
    (key) => row?.[key] === 'number' || row?.[key] === 'illegible'
  );
  return (
    !String(row?.description_of_work || '').trim() &&
    !String(row?.clock_out_raw || '').trim() &&
    !String(row?.clock_in_raw || '').trim() &&
    !written
  );
}

function stampEditorHtml(which, raw, sideLabel, rowIndex) {
  const label = which === 'out' ? 'Out' : 'In';
  const parts = parseStampParts(raw);
  const blocked = parts.handwriting || parts.illegible;
  const note = parts.handwriting ? 'HANDWRITING' : parts.illegible ? 'illegible' : '';
  return `<div class="timesheet-stamp timesheet-stamp-${which}" data-stamp="${which}">
    <span class="timesheet-card-label">${label}</span>
    <span class="timesheet-stamp-parts">
      <input class="timesheet-edit" data-part="month" type="text" maxlength="3"
        value="${escapeAttr(blocked ? '' : parts.month)}" placeholder="oct"
        aria-label="${label} month, ${sideLabel} row ${rowIndex}">
      <input class="timesheet-edit" data-part="day" type="text" maxlength="2"
        value="${escapeAttr(blocked ? '' : parts.day)}" placeholder="7"
        aria-label="${label} day, ${sideLabel} row ${rowIndex}">
      <input class="timesheet-edit" data-part="period" type="text" maxlength="2"
        value="${escapeAttr(blocked ? '' : parts.period)}" placeholder="AM"
        aria-label="${label} AM or PM, ${sideLabel} row ${rowIndex}">
      <input class="timesheet-edit" data-part="time" type="text" maxlength="5"
        value="${escapeAttr(blocked ? '' : parts.time)}" placeholder="8:50"
        aria-label="${label} time, ${sideLabel} row ${rowIndex}">
    </span>
    <span class="timesheet-stamp-note"${note ? '' : ' hidden'}>${escapeHtml(note)}</span>
  </div>`;
}

function readStamp(stamp) {
  return formatStampParts({
    month: stamp.querySelector('[data-part="month"]')?.value ?? '',
    day: stamp.querySelector('[data-part="day"]')?.value ?? '',
    period: stamp.querySelector('[data-part="period"]')?.value ?? '',
    time: stamp.querySelector('[data-part="time"]')?.value ?? '',
  });
}

function syncRow(tr, judgedRow, sourceRow, showRegOt) {
  const regInput = tr.querySelector('input[data-written="reg"]');
  const otInput = tr.querySelector('input[data-written="ot"]');
  const writtenRegStatus = judgedRow?.writtenRegStatus ?? sourceRow?.written_regular_status;
  const writtenReg = judgedRow?.writtenReg ?? sourceRow?.written_regular;
  const writtenOtStatus = judgedRow?.writtenOtStatus ?? sourceRow?.written_overtime_status;
  const writtenOt = judgedRow?.writtenOt ?? sourceRow?.written_overtime;
  if (regInput instanceof HTMLInputElement) {
    regInput.disabled = !showRegOt;
    if (document.activeElement !== regInput) {
      regInput.value = showRegOt ? writtenInputValue(writtenRegStatus, writtenReg) : '';
    }
  }
  if (otInput instanceof HTMLInputElement) {
    otInput.disabled = !showRegOt;
    if (document.activeElement !== otInput) {
      otInput.value = showRegOt ? writtenInputValue(writtenOtStatus, writtenOt) : '';
    }
  }
  paintCalculated(
    tr,
    'reg',
    writtenRegStatus,
    writtenReg,
    showRegOt ? judgedRow?.expectedReg : null
  );
  paintCalculated(
    tr,
    'ot',
    writtenOtStatus,
    writtenOt,
    showRegOt ? judgedRow?.expectedOt : null
  );
  paintCalculated(
    tr,
    'tot',
    judgedRow?.writtenTotStatus ?? sourceRow?.written_total_status,
    judgedRow?.writtenTot ?? sourceRow?.written_total,
    judgedRow?.totHours
  );
}

function paintCalculated(tr, field, status, handwritten, expected) {
  const span = tr.querySelector(`[data-audit-calculated="${field}"]`);
  if (!(span instanceof HTMLElement)) return;
  const show = expected != null && differsFromHandwriting(status, handwritten, expected);
  span.hidden = !show;
  span.textContent = show ? formatAuditHours(expected) : '';
}

function differsFromHandwriting(status, handwritten, expected) {
  if (expected == null) return false;
  if (status === 'illegible') return true;
  const written = status === 'number' ? Number(handwritten) : 0;
  return Math.abs(written - Number(expected)) > 0.01;
}

function formatStickerDate(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${Number(match[2])}/${Number(match[3])}/${match[1].slice(2)}`;
}

function stickerDayLabel(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 'this pay period';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function writtenInputValue(status, hours) {
  // Illegible cells stay empty; the red calculated value fills in instead.
  if (status === 'illegible') return '';
  if (status !== 'number' || hours == null) return '';
  return formatAuditHours(hours);
}

function applyWrittenInput(row, field, rawValue) {
  const text = String(rawValue ?? '').trim();
  const statusKey =
    field === 'reg' ? 'written_regular_status' : field === 'ot' ? 'written_overtime_status' : 'written_total_status';
  const hoursKey = field === 'reg' ? 'written_regular' : field === 'ot' ? 'written_overtime' : 'written_total';
  // Empty display for an illegible AI read must keep that status so the red calc stays.
  if (!text && row[statusKey] === 'illegible') {
    row[hoursKey] = null;
    return;
  }
  const parsed = parseAuditHours(text);
  row[hoursKey] = parsed.hours;
  row[statusKey] = parsed.status;
}

const previewUrls = { front: '', back: '' };

function showSidePreview(side, file) {
  const preview = document.querySelector(side === 'front' ? '#audit-front-preview' : '#audit-back-preview');
  const phonePreview = document.querySelector(
    side === 'front' ? '#audit-phone-front-preview' : '#audit-phone-back-preview'
  );
  const phoneState = document.querySelector(side === 'front' ? '#audit-phone-front-state' : '#audit-phone-back-state');
  const button = document.querySelector(side === 'front' ? '#audit-front-camera' : '#audit-back-camera');
  if (previewUrls[side]) URL.revokeObjectURL(previewUrls[side]);
  previewUrls[side] = URL.createObjectURL(file);
  for (const image of [preview, phonePreview]) {
    if (!(image instanceof HTMLImageElement)) continue;
    image.src = previewUrls[side];
    image.alt = side === 'front' ? 'Front of the time card' : 'Back of the time card';
    image.hidden = false;
  }
  if (button) button.textContent = side === 'front' ? 'Retake front photo' : 'Retake back photo';
  if (phoneState) {
    phoneState.textContent = 'Received';
    phoneState.classList.add('is-ready');
  }
}

function clearSidePreview(side) {
  const button = document.querySelector(side === 'front' ? '#audit-front-camera' : '#audit-back-camera');
  const phoneState = document.querySelector(side === 'front' ? '#audit-phone-front-state' : '#audit-phone-back-state');
  if (previewUrls[side]) URL.revokeObjectURL(previewUrls[side]);
  previewUrls[side] = '';
  for (const id of side === 'front'
    ? ['#audit-front-preview', '#audit-phone-front-preview']
    : ['#audit-back-preview', '#audit-phone-back-preview']) {
    const image = document.querySelector(id);
    if (!(image instanceof HTMLImageElement)) continue;
    image.removeAttribute('src');
    image.alt = '';
    image.hidden = true;
  }
  if (button) button.textContent = side === 'front' ? 'Take front photo' : 'Take back photo';
  if (phoneState) {
    phoneState.textContent = 'Waiting…';
    phoneState.classList.remove('is-ready');
  }
}

function mountAuditPhone({ setSideFile, setStatus }) {
  const computerPanel = document.querySelector('#audit-computer-capture');
  const phonePanel = document.querySelector('#audit-phone-capture');
  const canvas = document.querySelector('#audit-phone-qr');
  const phoneStatus = document.querySelector('#audit-phone-status');
  const refreshBtn = document.querySelector('#audit-phone-refresh');
  const sourceRoot = document.querySelector('#audit-capture-source');
  const sourceButtons = sourceRoot ? [...sourceRoot.querySelectorAll('[data-capture-source]')] : [];
  if (!computerPanel || !phonePanel || !(canvas instanceof HTMLCanvasElement)) {
    return { pause() {}, resume() {}, reset() {} };
  }

  let source = 'phone';
  let token = '';
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null;
  let starting = false;
  const seen = { front: false, back: false };

  function setPhoneStatus(message, kind = '') {
    if (!(phoneStatus instanceof HTMLElement)) return;
    phoneStatus.hidden = !message;
    phoneStatus.textContent = message || '';
    phoneStatus.className = kind ? `status is-${kind}` : 'status';
  }

  function stopPolling() {
    if (pollTimer != null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function endSession() {
    stopPolling();
    const prior = token;
    token = '';
    seen.front = false;
    seen.back = false;
    if (prior) await closeCaptureSession(prior);
  }

  function paintSource() {
    for (const button of sourceButtons) {
      if (!(button instanceof HTMLButtonElement)) continue;
      button.setAttribute('aria-pressed', button.dataset.captureSource === source ? 'true' : 'false');
    }
    computerPanel.hidden = source !== 'computer';
    phonePanel.hidden = source !== 'phone';
  }

  function auditVisible() {
    const desk = document.querySelector('#audit-genie-view');
    return desk instanceof HTMLElement && !desk.hidden;
  }

  async function pollOnce() {
    if (!token || source !== 'phone') return;
    const session = await readCaptureSession(token);
    if (!session) {
      setPhoneStatus('That photo link expired. Make a new QR code.', 'error');
      stopPolling();
      return;
    }
    // Phone resets the same link for the next card after both sides land.
    if (!session.front && !session.back && (seen.front || seen.back)) {
      seen.front = false;
      seen.back = false;
      setPhoneStatus('Ready for the next card…', '');
      return;
    }
    if (session.front && !seen.front) {
      setSideFile('front', await fetchCapturePhoto(token, 'front'));
      seen.front = true;
    }
    if (session.back && !seen.back) {
      setSideFile('back', await fetchCapturePhoto(token, 'back'));
      seen.back = true;
    }
    if (session.ready || (seen.front && seen.back)) {
      setPhoneStatus('Front and back arrived. Ready for the next card.', 'ok');
      setStatus('Front and back arrived from your phone. Ready to check.', 'ok');
      return;
    }
    if (seen.front) setPhoneStatus('Front is in. Waiting for the back…', '');
    else if (seen.back) setPhoneStatus('Back is in. Waiting for the front…', '');
    else setPhoneStatus('Waiting for photos from your phone…', '');
  }

  async function startSession() {
    if (starting) return;
    starting = true;
    stopPolling();
    setPhoneStatus('Making a photo link…', '');
    try {
      await endSession();
      const [origin, opened] = await Promise.all([loadCaptureShareOrigin(), openCaptureSession()]);
      const url = captureShareUrl(origin, opened.token, 'audit');
      if (!url) {
        throw new Error(
          'This computer’s address is not reachable from a phone. Use the office app on this network, or take photos on this computer.'
        );
      }
      token = opened.token;
      await QRCode.toCanvas(canvas, url, {
        width: 288,
        margin: 1,
        color: { dark: '#6b370c', light: '#ffffff' },
      });
      setPhoneStatus('Scan the QR code with your phone.', '');
      pollTimer = setInterval(() => {
        pollOnce().catch(() => {});
      }, 1500);
      await pollOnce();
    } catch (error) {
      setPhoneStatus(error?.message || 'Could not start phone capture.', 'error');
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    } finally {
      starting = false;
    }
  }

  async function setSource(next) {
    source = next === 'phone' ? 'phone' : 'computer';
    paintSource();
    if (source === 'phone') {
      if (!token) await startSession();
      return;
    }
    await endSession();
    setPhoneStatus('');
  }

  for (const button of sourceButtons) {
    if (!(button instanceof HTMLButtonElement)) continue;
    button.addEventListener('click', () => {
      setSource(button.dataset.captureSource || 'computer').catch((error) => {
        setStatus(error?.message || 'Could not switch photo source.', 'error');
      });
    });
  }
  refreshBtn?.addEventListener('click', () => {
    startSession().catch((error) => setPhoneStatus(error?.message || 'Could not make a new QR code.', 'error'));
  });

  paintSource();
  if (auditVisible()) {
    setSource('phone').catch((error) => setPhoneStatus(error?.message || 'Could not start phone capture.', 'error'));
  }

  return {
    pause() {
      stopPolling();
    },
    resume() {
      if (source !== 'phone' || !auditVisible()) return;
      if (!token) {
        startSession().catch((error) => setPhoneStatus(error?.message || 'Could not start phone capture.', 'error'));
        return;
      }
      if (pollTimer != null) return;
      pollTimer = setInterval(() => {
        pollOnce().catch(() => {});
      }, 1500);
      pollOnce().catch(() => {});
    },
    reset() {
      source = 'phone';
      paintSource();
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      endSession()
        .then(() => (auditVisible() ? startSession() : null))
        .catch((error) => setPhoneStatus(error?.message || 'Could not start phone capture.', 'error'));
    },
  };
}

function mountAuditCamera({ onCapture }) {
  const dialog = document.querySelector('#audit-camera');
  const video = document.querySelector('#audit-camera-video');
  const picker = document.querySelector('#audit-camera-picker');
  const deviceSelect = document.querySelector('#audit-camera-device');
  const cameraStatus = document.querySelector('#audit-camera-status');
  const shutter = document.querySelector('#audit-camera-shutter');
  if (
    !(dialog instanceof HTMLDialogElement) ||
    !(video instanceof HTMLVideoElement) ||
    !(picker instanceof HTMLElement) ||
    !(deviceSelect instanceof HTMLSelectElement) ||
    !(cameraStatus instanceof HTMLElement) ||
    !(shutter instanceof HTMLButtonElement)
  ) {
    return {
      open() {
        return Promise.reject(new Error('The camera dialog is missing.'));
      },
      close() {},
    };
  }

  /** @type {MediaStream | null} */
  let stream = null;
  /** @type {'front' | 'back'} */
  let side = 'front';
  let starting = false;
  // Bumped when the dialog closes so a shutter press that was cancelled is not saved.
  let shotToken = 0;

  deviceSelect.addEventListener('change', () => {
    if (!deviceSelect.value) return;
    rememberCamera(deviceSelect.value);
    startStream(deviceSelect.value).catch((error) => setCameraStatus(error.message, 'error'));
  });
  shutter.addEventListener('click', takePhoto);
  document.querySelector('#audit-camera-cancel')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    shotToken += 1;
    stopStream();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.code !== 'Space') return;
    if (!dialog.open || shutter.disabled) return;
    const tag = event.target instanceof Element ? event.target.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    event.preventDefault();
    if (event.repeat) return;
    takePhoto();
  });

  async function open(nextSide) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot use a camera. Choose a file instead.');
    }
    side = nextSide;
    const title = document.querySelector('#audit-camera-title');
    if (title) title.textContent = nextSide === 'front' ? 'Front of the time card' : 'Back of the time card';
    setCameraStatus('');
    shutter.disabled = true;
    if (!dialog.open) dialog.showModal();
    await startStream(savedCameraId());
    shutter.disabled = !stream;
    if (dialog.open && !shutter.disabled) shutter.focus();
  }

  function close() {
    if (dialog.open) dialog.close();
    else stopStream();
  }

  async function startStream(deviceId) {
    if (starting) return;
    starting = true;
    stopStream();
    setCameraStatus('Starting the camera…');
    try {
      stream = await openStream(deviceId);
      video.srcObject = stream;
      await video.play().catch(() => {});
      const currentId = stream.getVideoTracks()[0]?.getSettings?.().deviceId || deviceId || '';
      await refreshDeviceList(currentId);
      if (currentId) rememberCamera(currentId);
      setCameraStatus('');
    } catch (error) {
      const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
      setCameraStatus(
        denied
          ? 'Allow the camera in the browser prompt, then try again.'
          : 'No camera was found. Connect a camera, or choose a file.',
        'error'
      );
      shutter.disabled = true;
    } finally {
      starting = false;
    }
  }

  async function refreshDeviceList(selectedId) {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'videoinput' && device.deviceId
    );
    deviceSelect.replaceChildren();
    devices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${index + 1}`;
      deviceSelect.append(option);
    });
    picker.hidden = devices.length < 2;
    if (devices.some((device) => device.deviceId === selectedId)) deviceSelect.value = selectedId;
  }

  function takePhoto() {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width < 2 || height < 2) {
      setCameraStatus('The camera is not ready yet. Wait a moment and try again.', 'error');
      return;
    }
    const crop = coverCropRect(width, height, CARD_ASPECT_WIDTH, CARD_ASPECT_HEIGHT);
    const shot = document.createElement('canvas');
    shot.width = Math.max(1, Math.round(crop.sw));
    shot.height = Math.max(1, Math.round(crop.sh));
    const context = shot.getContext('2d');
    if (!context) return;
    context.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, shot.width, shot.height);
    shutter.disabled = true;
    const shotId = ++shotToken;
    const capturedSide = side;
    shot.toBlob(
      (blob) => {
        shutter.disabled = false;
        if (shotId !== shotToken) return;
        if (!blob) {
          setCameraStatus('Could not save that photo. Try again.', 'error');
          return;
        }
        // Close before the next step. The next camera or the card check starts after this dialog is gone.
        if (dialog.open) dialog.close();
        onCapture(capturedSide, new File([blob], `${capturedSide}-timecard.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92
    );
  }

  function setCameraStatus(message, kind) {
    cameraStatus.hidden = !message;
    cameraStatus.textContent = message || '';
    cameraStatus.className = kind ? `status is-${kind}` : 'status';
  }

  function stopStream() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
  }

  return { open, close };
}

async function openStream(deviceId) {
  const facing = {
    width: { ideal: 1200 },
    height: { ideal: 1920 },
    aspectRatio: { ideal: CARD_ASPECT_WIDTH / CARD_ASPECT_HEIGHT },
  };
  const exact = deviceId
    ? { video: { deviceId: { exact: deviceId }, ...facing }, audio: false }
    : { video: facing, audio: false };
  try {
    return await navigator.mediaDevices.getUserMedia(exact);
  } catch {
    if (!deviceId) return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    try {
      localStorage.removeItem(CAMERA_KEY);
    } catch {
      /* The next visit can ask the browser for a camera again. */
    }
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

function coverCropRect(sourceWidth, sourceHeight, aspectWidth, aspectHeight) {
  const target = aspectWidth / aspectHeight;
  const source = sourceWidth / sourceHeight;
  if (source > target) {
    const sw = sourceHeight * target;
    return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight };
  }
  const sh = sourceWidth / target;
  return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh };
}

function savedCameraId() {
  try {
    return localStorage.getItem(CAMERA_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

function rememberCamera(deviceId) {
  if (!deviceId) return;
  try {
    localStorage.setItem(CAMERA_KEY, deviceId);
  } catch {
    /* The next visit can ask the browser for a camera again. */
  }
}

function validateFile(file, label) {
  if (!file) return;
  const name = file.name.toLowerCase();
  if (file.type === 'image/heic' || file.type === 'image/heif' || /\.(heic|heif)$/.test(name)) {
    throw new Error(`${label}: HEIC is not supported. Export the photo as a JPEG.`);
  }
  if (file.type && !ALLOWED.has(file.type)) {
    throw new Error(`${label}: use a JPEG, PNG, GIF, or WebP photo.`);
  }
  if (file.size > MAX_BYTES) throw new Error(`${label} photo exceeds 12MB.`);
}

function filePayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      resolve({ mediaType: file.type || 'image/jpeg', base64: dataUrl.split(',')[1] || '' });
    };
    reader.onerror = () => reject(new Error('Could not read that photo.'));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
