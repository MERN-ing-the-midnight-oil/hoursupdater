import {
  formatStampParts,
  inferDefaultYear,
  parseLegacyStampToDate,
  parseStampParts,
  toLocalWallIso,
} from '../src/timesheetNormalize.js';
import { snapRoundedForRow } from '../src/timesheetSnap.js';
import { DEFAULT_CONTRACT_SNAP_BREAKS } from '../../src/logic/timeUtils.js';
import { contractSnapBreaksFromState } from './store.js';

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const CAMERA_KEY = 'teamster-timesheet-camera';
// Live view and shutter crop match the blue paper cards: about 5 wide by 8 tall.
const CARD_ASPECT_WIDTH = 5;
const CARD_ASPECT_HEIGHT = 8;
const FRONT_SLOT_COUNT = 13;
const BACK_SLOT_COUNT = 15;
const previewUrls = { front: '', back: '' };

/**
 * @param {{ onCapture: (side: 'front' | 'back', file: File) => void }} options
 */
function mountTimesheetCamera({ onCapture }) {
  const dialog = document.querySelector('#timesheet-camera');
  const video = document.querySelector('#timesheet-camera-video');
  const picker = document.querySelector('#timesheet-camera-picker');
  const deviceSelect = document.querySelector('#timesheet-camera-device');
  const cameraStatus = document.querySelector('#timesheet-camera-status');
  const shutter = document.querySelector('#timesheet-camera-shutter');
  if (!dialog || !video || !picker || !deviceSelect || !cameraStatus || !shutter) {
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
  let switchedToPreferred = false;

  deviceSelect.addEventListener('change', () => {
    const deviceId = deviceSelect.value;
    if (!deviceId) return;
    rememberCamera(deviceId);
    startStream(deviceId).catch((error) => setCameraStatus(error.message, 'error'));
  });
  shutter.addEventListener('click', takePhoto);
  document.querySelector('#timesheet-camera-cancel')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', stopStream);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  navigator.mediaDevices?.addEventListener('devicechange', () => {
    if (!dialog.open) return;
    refreshDeviceList().catch(() => {});
  });

  async function open(nextSide) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot use a camera. Choose a file instead.');
    }
    side = nextSide;
    switchedToPreferred = false;
    document.querySelector('#timesheet-camera-title').textContent =
      nextSide === 'front' ? 'Front of the time card' : 'Back of the time card';
    setCameraStatus('');
    shutter.disabled = true;
    if (!dialog.open) dialog.showModal();
    await startStream(savedCameraId());
    shutter.disabled = Boolean(stream) === false;
  }

  function close() {
    if (dialog.open) dialog.close();
    else stopStream();
  }

  async function startStream(deviceId) {
    if (starting) return;
    starting = true;
    stopStream();
    setCameraStatus('Starting the camera…', '');
    try {
      stream = await openStream(deviceId);
      video.srcObject = stream;
      await video.play().catch(() => {});
      const currentId = stream.getVideoTracks()[0]?.getSettings?.().deviceId || deviceId || '';
      const devices = await refreshDeviceList(currentId);
      const saved = savedCameraId();
      const builtIn = devices.find((device) => /built-?in|facetime|integrated|internal/i.test(device.label));
      const prefer = devices.some((device) => device.deviceId === saved)
        ? saved
        : builtIn?.deviceId || '';
      if (prefer && prefer !== currentId && !switchedToPreferred) {
        switchedToPreferred = true;
        rememberCamera(prefer);
        starting = false;
        await startStream(prefer);
        return;
      }
      if (currentId) rememberCamera(currentId);
      setCameraStatus('');
    } catch (error) {
      const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
      setCameraStatus(
        denied
          ? 'Allow the camera in the browser prompt, then try again.'
          : 'No camera was found. Connect a built-in or USB camera, or choose a file.',
        'error'
      );
      shutter.disabled = true;
    } finally {
      starting = false;
    }
  }

  async function refreshDeviceList(selectedId = deviceSelect.value) {
    const devices = await listCameras();
    const previous = selectedId;
    deviceSelect.replaceChildren();
    for (const [index, device] of devices.entries()) {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${index + 1}`;
      deviceSelect.append(option);
    }
    picker.hidden = devices.length < 2;
    if (devices.some((device) => device.deviceId === previous)) deviceSelect.value = previous;
    return devices;
  }

  function takePhoto() {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width < 2 || height < 2) {
      setCameraStatus('The camera is not ready yet. Wait a moment and try again.', 'error');
      return;
    }
    const crop = coverCropRect(width, height, CARD_ASPECT_WIDTH, CARD_ASPECT_HEIGHT);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(crop.sw));
    canvas.height = Math.max(1, Math.round(crop.sh));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
    shutter.disabled = true;
    canvas.toBlob(
      (blob) => {
        shutter.disabled = false;
        if (!dialog.open) return;
        if (!blob) {
          setCameraStatus('Could not save that photo. Try again.', 'error');
          return;
        }
        const file = new File([blob], `${side}-timecard.jpg`, { type: 'image/jpeg' });
        onCapture(side, file);
        dialog.close();
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
  } catch (error) {
    if (!deviceId) {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    forgetCamera();
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

/**
 * Source rectangle that fills a target aspect the way CSS object-fit: cover does.
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {number} aspectWidth
 * @param {number} aspectHeight
 */
export function coverCropRect(sourceWidth, sourceHeight, aspectWidth, aspectHeight) {
  const target = aspectWidth / aspectHeight;
  const source = sourceWidth / sourceHeight;
  if (source > target) {
    const sw = sourceHeight * target;
    return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight };
  }
  const sh = sourceWidth / target;
  return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh };
}

async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'videoinput' && device.deviceId);
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

function forgetCamera() {
  try {
    localStorage.removeItem(CAMERA_KEY);
  } catch {
    /* ignore */
  }
}

function showSidePreview(side, file) {
  const preview = document.querySelector(side === 'front' ? '#timesheet-front-preview' : '#timesheet-back-preview');
  const button = document.querySelector(side === 'front' ? '#timesheet-front-camera' : '#timesheet-back-camera');
  if (previewUrls[side]) URL.revokeObjectURL(previewUrls[side]);
  const url = URL.createObjectURL(file);
  previewUrls[side] = url;
  if (preview) {
    preview.src = url;
    preview.alt = side === 'front' ? 'Front of the time card' : 'Back of the time card';
    preview.hidden = false;
  }
  if (button) button.textContent = side === 'front' ? 'Retake front photo' : 'Retake back photo';
}

function clearSidePreview(side) {
  const preview = document.querySelector(side === 'front' ? '#timesheet-front-preview' : '#timesheet-back-preview');
  const button = document.querySelector(side === 'front' ? '#timesheet-front-camera' : '#timesheet-back-camera');
  if (previewUrls[side]) URL.revokeObjectURL(previewUrls[side]);
  previewUrls[side] = '';
  if (preview) {
    preview.removeAttribute('src');
    preview.alt = '';
    preview.hidden = true;
  }
  if (button) button.textContent = side === 'front' ? 'Take front photo' : 'Take back photo';
}

/**
 * Timecard Genie desk. Reads Clock Record stamps from paper-card photos.
 * @param {{ readState?: () => object, asOf?: () => string }} [options]
 */
export function mountTimesheetReader(options = {}) {
  const view = document.querySelector('#timecard-genie-view');
  const form = document.querySelector('#timesheet-form');
  const status = document.querySelector('#timesheet-status');
  const statusText = status?.querySelector('.timesheet-progress-text') || status;
  const result = document.querySelector('#timesheet-result');
  const frontCard = document.querySelector('#timesheet-front-card tbody');
  const backCard = document.querySelector('#timesheet-back-card tbody');
  const frontSnap = document.querySelector('#timesheet-front-snap tbody');
  const backSnap = document.querySelector('#timesheet-back-snap tbody');
  if (!view || !form || !status || !result || !frontCard || !backCard || !frontSnap || !backSnap) {
    return { refresh() {} };
  }

  function snapBreaks() {
    try {
      const state = typeof options.readState === 'function' ? options.readState() : null;
      return contractSnapBreaksFromState(state || {});
    } catch {
      return { ...DEFAULT_CONTRACT_SNAP_BREAKS };
    }
  }

  /** @type {object | null} */
  let extraction = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let progressTimer = null;

  const camera = mountTimesheetCamera({
    onCapture: (side, file) => {
      setSideFile(side, file);
      setStatus('');
    },
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    readCard().catch((error) => setStatus(error.message || 'Could not read that card.', 'error'));
  });
  document.querySelector('#timesheet-clear')?.addEventListener('click', clearCard);
  document.querySelector('#timesheet-front-camera')?.addEventListener('click', () => {
    camera.open('front').catch((error) => setStatus(error.message || 'Could not open the camera.', 'error'));
  });
  document.querySelector('#timesheet-back-camera')?.addEventListener('click', () => {
    camera.open('back').catch((error) => setStatus(error.message || 'Could not open the camera.', 'error'));
  });
  document.querySelector('#timesheet-front-file')?.addEventListener('click', () => {
    document.querySelector('#timesheet-front')?.click();
  });
  document.querySelector('#timesheet-back-file')?.addEventListener('click', () => {
    document.querySelector('#timesheet-back')?.click();
  });
  document.querySelector('#timesheet-front')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) setSideFile('front', file);
  });
  document.querySelector('#timesheet-back')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) setSideFile('back', file);
  });
  new MutationObserver(() => {
    if (view.hidden) camera.close();
  }).observe(view, { attributes: true, attributeFilter: ['hidden'] });

  function setStatus(message, kind = '') {
    stopProgressMessages();
    status.hidden = !message;
    if (statusText) statusText.textContent = message || '';
    else status.textContent = message || '';
    status.className = kind
      ? `status timesheet-progress is-${kind}`
      : 'status timesheet-progress';
  }

  function setBusyStatus(message) {
    status.hidden = !message;
    if (statusText) statusText.textContent = message || '';
    else status.textContent = message || '';
    status.className = 'status timesheet-progress is-busy';
  }

  function stopProgressMessages() {
    if (progressTimer != null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  /**
   * Step through waiting copy while the model works on the photos.
   * @param {string[]} messages
   * @param {number} [everyMs]
   */
  function startProgressMessages(messages, everyMs = 2800) {
    stopProgressMessages();
    const lines = messages.filter(Boolean);
    if (!lines.length) return;
    let index = 0;
    setBusyStatus(lines[0]);
    if (lines.length === 1) return;
    progressTimer = setInterval(() => {
      index = (index + 1) % lines.length;
      setBusyStatus(lines[index]);
    }, everyMs);
  }

  function refresh() {
    if (extraction) renderResult();
  }

  function renderResult() {
    if (!extraction) {
      result.hidden = true;
      return;
    }
    result.hidden = false;
    const who = extraction.header?.employee_name;
    const route = extraction.header?.route_number ? ` · route ${extraction.header.route_number}` : '';
    const cardDate = extraction.header?.date_on_card ? ` · card date ${extraction.header.date_on_card}` : '';
    document.querySelector('#timesheet-who').textContent = who
      ? `${who}${route}${cardDate}`
      : 'Clock Record';
    const breaks = snapBreaks();
    paintCardSheet(frontCard, extraction.front_rows ?? [], FRONT_SLOT_COUNT);
    paintCardSheet(backCard, extraction.back_rows ?? [], BACK_SLOT_COUNT);
    applySnapDerivedFields(extraction.front_rows, FRONT_SLOT_COUNT, breaks, frontCard);
    applySnapDerivedFields(extraction.back_rows, BACK_SLOT_COUNT, breaks, backCard);
    paintSnapSheet(frontSnap, extraction.front_rows ?? [], FRONT_SLOT_COUNT, breaks);
    paintSnapSheet(backSnap, extraction.back_rows ?? [], BACK_SLOT_COUNT, breaks);
    bindCardEditors(frontCard, extraction.front_rows, FRONT_SLOT_COUNT, {
      snapBody: frontSnap,
      breaks,
    });
    bindCardEditors(backCard, extraction.back_rows, BACK_SLOT_COUNT, {
      snapBody: backSnap,
      breaks,
    });
    alignSnapRows(frontCard, frontSnap);
    alignSnapRows(backCard, backSnap);

    const caveats = document.querySelector('#timesheet-caveats');
    caveats.hidden = true;
    caveats.textContent = '';
  }

  async function readCard() {
    const front = document.querySelector('#timesheet-front').files?.[0] ?? null;
    const back = document.querySelector('#timesheet-back').files?.[0] ?? null;
    if (!front && !back) {
      setStatus('Take a photo of the front, the back, or both.', 'error');
      return;
    }
    validateFile(front, 'Front');
    validateFile(back, 'Back');
    const button = document.querySelector('#timesheet-read');
    const clearButton = document.querySelector('#timesheet-clear');
    button.disabled = true;
    if (clearButton) clearButton.disabled = true;
    const sides = [front && 'front', back && 'back'].filter(Boolean);
    const photoLabel =
      sides.length === 2 ? 'photos' : sides[0] === 'front' ? 'front photo' : 'back photo';
    try {
      setBusyStatus(
        sides.length === 2 ? 'Preparing the front and back photos…' : `Preparing the ${photoLabel}…`
      );
      const frontPayload = front ? await filePayload(front) : null;
      const backPayload = back ? await filePayload(back) : null;

      setBusyStatus(
        sides.length === 2
          ? 'Sending photos for analysis…'
          : `Sending ${photoLabel} for analysis…`
      );
      const waiting = [
        sides.length === 2 ? 'Reading the photos…' : `Reading the ${photoLabel}…`,
        'Looking for Clock Record stamps…',
        'Still analyzing the card…',
        'Almost done…',
      ];
      startProgressMessages(waiting);

      const response = await fetch('/api/timesheet-extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          front: frontPayload,
          back: backPayload,
        }),
      });
      stopProgressMessages();
      setBusyStatus('Building the Front and Back card tables…');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Could not read that card.');
      }
      extraction = payload.extraction;
      renderResult();
      setStatus('Read the Clock Record stamps from the card.', 'ok');
    } catch (error) {
      stopProgressMessages();
      setStatus(error?.message || 'Could not read that card.', 'error');
    } finally {
      stopProgressMessages();
      button.disabled = false;
      if (clearButton) clearButton.disabled = false;
    }
  }

  function setSideFile(side, file) {
    const input = document.querySelector(side === 'front' ? '#timesheet-front' : '#timesheet-back');
    if (input && input.files?.[0] !== file) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    }
    showSidePreview(side, file);
  }

  function clearCard() {
    stopProgressMessages();
    extraction = null;
    camera.close();
    form.reset();
    clearSidePreview('front');
    clearSidePreview('back');
    frontCard.replaceChildren();
    backCard.replaceChildren();
    frontSnap.replaceChildren();
    backSnap.replaceChildren();
    result.hidden = true;
    setStatus('');
  }

  return { refresh };
}

/**
 * One side of the blue card: every cell editable.
 * @param {HTMLElement} body
 * @param {object[]} rows
 * @param {number} slotCount
 */
export function paintCardSheet(body, rows, slotCount) {
  body.replaceChildren();
  const byIndex = new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [Number(row?.row_index) || 0, row])
  );
  for (let index = 1; index <= slotCount; index += 1) {
    const row = byIndex.get(index) || { row_index: index };
    if (Array.isArray(rows) && !rows[index - 1]) rows[index - 1] = row;
    const tr = document.createElement('tr');
    tr.dataset.rowIndex = String(index);
    const out = stampText(row.clock_out_raw);
    const inn = stampText(row.clock_in_raw);
    const blank = !out && !inn;
    if (blank) tr.classList.add('is-quiet');
    if (row.crossed_out) tr.classList.add('is-crossed');
    tr.innerHTML = `
      <td class="timesheet-card-blank">
        <input class="timesheet-edit" data-field="description_of_work" type="text"
          value="${escapeAttr(row.description_of_work)}" aria-label="Description of Work row ${index}">
      </td>
      <td class="timesheet-card-blank">
        <input class="timesheet-edit" data-field="hours_regular" type="text"
          value="${escapeAttr(row.hours_regular)}" aria-label="Hours row ${index}">
      </td>
      <td class="timesheet-card-blank">
        <input class="timesheet-edit timesheet-tot-hrs" data-field="total_hours" type="text"
          value="${escapeAttr(row.total_hours)}" readonly tabindex="-1"
          aria-label="Tot. Hrs. row ${index} from snap rounded times">
      </td>
      <td class="timesheet-card-clock">
        ${stampEditorHtml('out', row.clock_out_raw, index)}
        ${stampEditorHtml('in', row.clock_in_raw, index)}
      </td>`;
    body.append(tr);
  }
}

/**
 * Keep the extraction rows in sync as the user edits the card tables.
 * @param {HTMLElement} body
 * @param {object[]} rows
 * @param {number} slotCount
 * @param {{ snapBody?: HTMLElement | null, breaks?: object }} [extras]
 */
function bindCardEditors(body, rows, slotCount, extras = {}) {
  if (!body || !Array.isArray(rows)) return;
  for (let index = 1; index <= slotCount; index += 1) {
    if (!rows[index - 1]) {
      rows[index - 1] = {
        row_index: index,
        description_of_work: null,
        hours_regular: null,
        hours_overtime: null,
        hours_secondary: null,
        total_hours: null,
        clock_out_raw: null,
        clock_in_raw: null,
        clock_out_iso: null,
        clock_in_iso: null,
        crossed_out: false,
      };
    }
  }
  const year = inferDefaultYear(null);
  const breaks = extras.breaks || DEFAULT_CONTRACT_SNAP_BREAKS;
  const snapBody = extras.snapBody || null;

  body.oninput = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('timesheet-edit')) {
      return;
    }
    if (target.dataset.field === 'total_hours') return;
    const tr = target.closest('tr[data-row-index]');
    if (!tr) return;
    const index = Number(tr.dataset.rowIndex) || 0;
    const row = rows[index - 1];
    if (!row) return;

    if (target.dataset.field) {
      const field = target.dataset.field;
      const text = target.value.trim();
      if (field === 'hours_regular') {
        if (!text) row[field] = null;
        else {
          const number = Number(text);
          row[field] = Number.isFinite(number) ? number : text;
        }
      } else {
        row[field] = text || null;
      }
      refreshRowState(tr, row);
      return;
    }

    const stamp = target.closest('[data-stamp]');
    if (!stamp) return;
    const which = stamp.dataset.stamp;
    if (which !== 'out' && which !== 'in') return;
    applyStampEdits(row, which, stamp, year);
    refreshRowState(tr, row);
    if (target.dataset.role === 'illegible' && !/^illegible$/i.test(target.value.trim())) {
      stamp.outerHTML = stampEditorHtml(which, row[`clock_${which}_raw`], index);
      tr.querySelector(`[data-stamp="${which}"] input`)?.focus();
    }
    updateRowSnapDerived(tr, row, breaks);
    if (snapBody) {
      paintSnapSheet(snapBody, rows, slotCount, breaks);
      alignSnapRows(body, snapBody);
    }
  };
}

/**
 * @param {object[]} rows
 * @param {number} slotCount
 * @param {object} breaks
 * @param {HTMLElement} body
 */
function applySnapDerivedFields(rows, slotCount, breaks, body) {
  if (!Array.isArray(rows)) return;
  for (let index = 1; index <= slotCount; index += 1) {
    const row = rows[index - 1];
    if (!row) continue;
    const snapped = snapRoundedForRow(row, breaks);
    row.total_hours = snapped.totalHours;
    const input = body?.querySelector(
      `tr[data-row-index="${index}"] input[data-field="total_hours"]`
    );
    if (input instanceof HTMLInputElement) {
      input.value = snapped.totalHours == null ? '' : String(snapped.totalHours);
    }
  }
}

/**
 * @param {HTMLTableRowElement} tr
 * @param {object} row
 * @param {object} breaks
 */
function updateRowSnapDerived(tr, row, breaks) {
  const snapped = snapRoundedForRow(row, breaks);
  row.total_hours = snapped.totalHours;
  const input = tr.querySelector('input[data-field="total_hours"]');
  if (input instanceof HTMLInputElement) {
    input.value = snapped.totalHours == null ? '' : String(snapped.totalHours);
  }
}

/**
 * @param {HTMLElement} body
 * @param {object[]} rows
 * @param {number} slotCount
 * @param {object} breaks
 */
export function paintSnapSheet(body, rows, slotCount, breaks) {
  if (!body) return;
  body.replaceChildren();
  for (let index = 1; index <= slotCount; index += 1) {
    const row = Array.isArray(rows) ? rows[index - 1] : null;
    const snapped = snapRoundedForRow(row, breaks);
    const tr = document.createElement('tr');
    tr.dataset.rowIndex = String(index);
    const blank = !snapped.outLabel && !snapped.inLabel;
    if (blank) tr.classList.add('is-quiet');
    tr.innerHTML = `
      <td>
        <div class="timesheet-snap-stamp">
          <span class="timesheet-card-label">Out</span>
          <span class="timesheet-snap-value${snapped.outIllegible ? ' is-illegible' : ''}">${escapeHtml(snapped.outLabel || '—')}</span>
        </div>
        <div class="timesheet-snap-stamp">
          <span class="timesheet-card-label">In</span>
          <span class="timesheet-snap-value${snapped.inIllegible ? ' is-illegible' : ''}">${escapeHtml(snapped.inLabel || '—')}</span>
        </div>
      </td>`;
    body.append(tr);
  }
}

/**
 * Keep snap rows lined up with the blue card rows.
 * @param {HTMLElement} cardBody
 * @param {HTMLElement} snapBody
 */
function alignSnapRows(cardBody, snapBody) {
  if (!cardBody || !snapBody) return;
  const cardRows = [...cardBody.querySelectorAll('tr[data-row-index]')];
  const snapRows = [...snapBody.querySelectorAll('tr[data-row-index]')];
  const count = Math.min(cardRows.length, snapRows.length);
  for (let index = 0; index < count; index += 1) {
    snapRows[index].style.height = '';
  }
  // Force layout, then match heights.
  for (let index = 0; index < count; index += 1) {
    const height = Math.max(cardRows[index].getBoundingClientRect().height, 1);
    snapRows[index].style.height = `${height}px`;
  }
  const cardHead = cardBody.closest('table')?.querySelector('thead tr');
  const snapHead = snapBody.closest('table')?.querySelector('thead tr');
  if (cardHead && snapHead) {
    snapHead.style.height = '';
    snapHead.style.height = `${cardHead.getBoundingClientRect().height}px`;
  }
}

/**
 * @param {object} row
 * @param {'out' | 'in'} which
 * @param {Element} stamp
 * @param {number} year
 */
function applyStampEdits(row, which, stamp, year) {
  const illegibleInput = stamp.querySelector('input[data-role="illegible"]');
  if (illegibleInput) {
    const text = illegibleInput.value.trim();
    if (!text || /^illegible$/i.test(text)) {
      row[`clock_${which}_raw`] = text ? 'illegible' : null;
      row[`clock_${which}_iso`] = null;
    } else {
      const parts = parseStampParts(text);
      row[`clock_${which}_raw`] = formatStampParts({ ...parts, illegible: false });
      const isoDate =
        row[`clock_${which}_raw`] && !parts.illegible
          ? parseLegacyStampToDate(row[`clock_${which}_raw`], year)
          : null;
      row[`clock_${which}_iso`] = isoDate ? toLocalWallIso(isoDate) : null;
    }
  } else {
    const parts = {
      month: stamp.querySelector('[data-part="month"]')?.value ?? '',
      day: stamp.querySelector('[data-part="day"]')?.value ?? '',
      period: stamp.querySelector('[data-part="period"]')?.value ?? '',
      time: stamp.querySelector('[data-part="time"]')?.value ?? '',
      illegible: false,
    };
    row[`clock_${which}_raw`] = formatStampParts(parts);
    const isoDate = row[`clock_${which}_raw`]
      ? parseLegacyStampToDate(row[`clock_${which}_raw`], year)
      : null;
    row[`clock_${which}_iso`] = isoDate ? toLocalWallIso(isoDate) : null;
  }
  row.crossed_out =
    isIllegibleRaw(row.clock_out_raw) || isIllegibleRaw(row.clock_in_raw);
}

/**
 * @param {HTMLTableRowElement} tr
 * @param {object} row
 */
function refreshRowState(tr, row) {
  const blank = !stampText(row.clock_out_raw) && !stampText(row.clock_in_raw);
  tr.classList.toggle('is-quiet', blank);
  tr.classList.toggle('is-crossed', Boolean(row.crossed_out));
}

/**
 * @param {'out' | 'in'} which
 * @param {string | null | undefined} raw
 * @param {number} rowIndex
 */
function stampEditorHtml(which, raw, rowIndex) {
  const label = which === 'out' ? 'Out' : 'In';
  const parts = parseStampParts(raw);
  if (parts.illegible) {
    return `<div class="timesheet-stamp timesheet-stamp-${which}" data-stamp="${which}">
      <span class="timesheet-card-label">${label}</span>
      <input class="timesheet-edit timesheet-stamp-illegible" data-role="illegible" type="text"
        value="illegible" aria-label="${label} stamp row ${rowIndex}">
    </div>`;
  }
  return `<div class="timesheet-stamp timesheet-stamp-${which}" data-stamp="${which}">
    <span class="timesheet-card-label">${label}</span>
    <span class="timesheet-stamp-parts">
      <input class="timesheet-edit" data-part="month" type="text" maxlength="3"
        value="${escapeAttr(parts.month)}" placeholder="oct" aria-label="${label} month row ${rowIndex}">
      <input class="timesheet-edit" data-part="day" type="text" maxlength="2"
        value="${escapeAttr(parts.day)}" placeholder="7" aria-label="${label} day row ${rowIndex}">
      <input class="timesheet-edit" data-part="period" type="text" maxlength="2"
        value="${escapeAttr(parts.period)}" placeholder="AM" aria-label="${label} AM or PM row ${rowIndex}">
      <input class="timesheet-edit" data-part="time" type="text" maxlength="5"
        value="${escapeAttr(parts.time)}" placeholder="8:50" aria-label="${label} time row ${rowIndex}">
    </span>
  </div>`;
}

function stampText(value) {
  const text = String(value ?? '').trim();
  return text || '';
}

function isIllegibleRaw(value) {
  return /^illegible$/i.test(String(value ?? '').trim());
}

function escapeAttr(value) {
  if (value == null || value === '') return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
      const base64 = dataUrl.split(',')[1] || '';
      resolve({ mediaType: file.type || 'image/jpeg', base64 });
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
