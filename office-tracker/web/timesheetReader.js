import {
  formatStampParts,
  inferDefaultYear,
  parseLegacyStampToDate,
  parseStampParts,
  toLocalWallIso,
} from '../src/timesheetNormalize.js';
import {
  driverPayStatusChoices,
  isPayLineId,
  normalizeClockPayDefaults,
  normalizePayPortions,
  payPortionError,
  payStatusForClockIn,
} from '../src/driverPay.js';
import { holidayListForState } from '../../src/logic/schoolYear.js';
import { matchPayrollRow } from '../src/timesheetMath.js';
import { payrollDriverRows } from '../src/payrollTimes.js';
import {
  buildMonthlyTimeSummary,
  monthlyTimeSummaryEmbedMarkup,
} from '../src/monthlyTimeSummary.js';
import { localDateKey } from '../../src/logic/timesheets.js';
import { punchesFromCardExtraction } from '../src/timesheetRegOt.js';
import { formatAuditHours, parseAuditHours } from '../src/timesheetAudit.js';
import {
  applyContractRegOtRows,
  markContractHourRows,
  parseStickerContractHours,
} from '../src/timesheetGenieCard.js';
import {
  normalizeTimesheetHoursMode,
  snapRoundedForRow,
  TIMESHEET_HOURS_MODE_QUARTER,
  TIMESHEET_HOURS_MODE_SNAP,
} from '../src/timesheetSnap.js';
import { DEFAULT_CONTRACT_SNAP_BREAKS } from '../../src/logic/timeUtils.js';
import QRCode from 'qrcode';
import {
  captureShareUrl,
  closeCaptureSession,
  fetchCapturePhoto,
  loadCaptureShareOrigin,
  openCaptureSession,
  readCaptureSession,
} from './timesheetCaptureClient.js';
import {
  buildPrintPdfBlob,
  clampPrintCrop,
  deletePrintCard,
  FULL_PRINT_CROP,
  imageFileToPrintJpeg,
  listPrintCards,
  printPdfBlob,
  savePrintCrops,
  upsertPrintCard,
} from './timesheetPrintStore.js';
import {
  clockRoundingMode,
  compareRouteNumbers,
  contractSnapBreaksFromState,
  driversFromState,
} from './store.js';

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const CAMERA_KEY = 'teamster-timesheet-camera';
const ROW_HEIGHT_KEY = 'teamster-timesheet-row-height';
const HOURS_MODE_KEY = 'teamster-timesheet-hours-mode';
const PRINT_SAVE_KEY = 'teamster-timesheet-save-for-print';
const ROW_HEIGHT_MIN = 28;
const ROW_HEIGHT_MAX = 120;
const ROW_HEIGHT_DEFAULT = 52;
const HOURS_MODE_LABELS = {
  [TIMESHEET_HOURS_MODE_SNAP]: 'Snap rounded times',
  [TIMESHEET_HOURS_MODE_QUARTER]: 'Quarter hour rounding',
};
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
  const review = document.querySelector('#timesheet-camera-review');
  const retake = document.querySelector('#timesheet-camera-retake');
  const usePhoto = document.querySelector('#timesheet-camera-use');
  const canReview = review instanceof HTMLImageElement && retake instanceof HTMLButtonElement && usePhoto instanceof HTMLButtonElement;
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
  /** @type {'live' | 'review'} */
  let phase = 'live';
  /** @type {File | null} */
  let pendingFile = null;
  let reviewUrl = '';
  let starting = false;
  let switchedToPreferred = false;

  deviceSelect.addEventListener('change', () => {
    const deviceId = deviceSelect.value;
    if (!deviceId) return;
    rememberCamera(deviceId);
    startStream(deviceId).catch((error) => setCameraStatus(error.message, 'error'));
  });
  shutter.addEventListener('click', takePhoto);
  retake?.addEventListener('click', retakePhoto);
  usePhoto?.addEventListener('click', acceptPhoto);
  document.querySelector('#timesheet-camera-cancel')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    stopStream();
    pendingFile = null;
    clearReviewImage();
    side = 'front';
    paintStep('live');
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  // Space always trips the shutter while the dialog is open, including when the
  // camera <select> has focus (common with two cameras after showModal).
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.code !== 'Space') return;
    if (!dialog.open || phase !== 'live' || shutter.hidden || shutter.disabled) return;
    const tag = event.target instanceof Element ? event.target.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    event.preventDefault();
    if (event.repeat) return;
    takePhoto();
  });
  navigator.mediaDevices?.addEventListener('devicechange', () => {
    if (!dialog.open) return;
    refreshDeviceList().catch(() => {});
  });

  async function open(nextSide) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot use a camera.');
    }
    side = nextSide === 'back' ? 'back' : 'front';
    switchedToPreferred = false;
    pendingFile = null;
    clearReviewImage();
    paintStep('live');
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
          : 'No camera was found. Connect a built-in or USB camera and try again.',
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
        if (!canReview) {
          onCapture(side, file);
          dialog.close();
          return;
        }
        pendingFile = file;
        if (reviewUrl) URL.revokeObjectURL(reviewUrl);
        reviewUrl = URL.createObjectURL(file);
        review.src = reviewUrl;
        review.alt = side === 'front' ? 'Front of the time card' : 'Back of the time card';
        setCameraStatus('');
        paintStep('review');
        retake.focus();
      },
      'image/jpeg',
      0.92
    );
  }

  function paintStep(nextPhase) {
    phase = nextPhase;
    const reviewing = phase === 'review';
    const title = document.querySelector('#timesheet-camera-title');
    const lead = document.querySelector('#timesheet-camera-lead');
    if (title) {
      title.textContent = side === 'front' ? 'Front of the time card' : 'Back of the time card';
    }
    if (lead) {
      if (side === 'front' && !reviewing) {
        lead.textContent =
          'Point the camera at the front of the card. The bright screen helps light it. Press Space to take the photo.';
      } else if (side === 'front') {
        lead.textContent = 'Check the front. Retake it, or go on to the back.';
      } else if (!reviewing) {
        lead.textContent = 'Flip the card and point the camera at the back. Press Space to take the photo.';
      } else {
        lead.textContent = 'Check the back. Retake it, or keep this photo.';
      }
    }
    video.hidden = reviewing;
    if (canReview) {
      review.hidden = !reviewing;
      shutter.hidden = reviewing;
      retake.hidden = !reviewing;
      usePhoto.hidden = !reviewing;
      usePhoto.textContent = side === 'front' ? 'Take the back photo' : 'Use this photo';
    }
    shutter.disabled = reviewing || !stream;
  }

  function clearReviewImage() {
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    reviewUrl = '';
    if (review instanceof HTMLImageElement) {
      review.removeAttribute('src');
      review.alt = '';
      review.hidden = true;
    }
  }

  function retakePhoto() {
    if (phase !== 'review') return;
    pendingFile = null;
    clearReviewImage();
    paintStep('live');
    video.play().catch(() => {});
    if (!shutter.disabled) shutter.focus();
  }

  function acceptPhoto() {
    if (phase !== 'review' || !pendingFile || !dialog.open) return;
    const file = pendingFile;
    const accepted = side;
    pendingFile = null;
    onCapture(accepted, file);
    if (accepted === 'front') {
      side = 'back';
      clearReviewImage();
      paintStep('live');
      video.play().catch(() => {});
      if (!shutter.disabled) shutter.focus();
      return;
    }
    dialog.close();
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

function sidePreviewNodes(side) {
  if (side === 'front') {
    return [
      document.querySelector('#timesheet-front-preview'),
      document.querySelector('#timesheet-phone-front-preview'),
    ];
  }
  return [
    document.querySelector('#timesheet-back-preview'),
    document.querySelector('#timesheet-phone-back-preview'),
  ];
}

function showSidePreview(side, file) {
  const sideBox = document.querySelector(side === 'front' ? '#timesheet-front-side' : '#timesheet-back-side');
  const phoneState = document.querySelector(
    side === 'front' ? '#timesheet-phone-front-state' : '#timesheet-phone-back-state'
  );
  if (previewUrls[side]) URL.revokeObjectURL(previewUrls[side]);
  const url = URL.createObjectURL(file);
  previewUrls[side] = url;
  for (const preview of sidePreviewNodes(side)) {
    if (!(preview instanceof HTMLImageElement)) continue;
    preview.src = url;
    preview.alt = side === 'front' ? 'Front of the time card' : 'Back of the time card';
    preview.hidden = false;
  }
  if (sideBox instanceof HTMLElement) sideBox.hidden = false;
  if (phoneState) {
    phoneState.textContent = 'Received';
    phoneState.classList.add('is-ready');
  }
}

function clearSidePreview(side) {
  const sideBox = document.querySelector(side === 'front' ? '#timesheet-front-side' : '#timesheet-back-side');
  const phoneState = document.querySelector(
    side === 'front' ? '#timesheet-phone-front-state' : '#timesheet-phone-back-state'
  );
  if (previewUrls[side]) URL.revokeObjectURL(previewUrls[side]);
  previewUrls[side] = '';
  for (const preview of sidePreviewNodes(side)) {
    if (!(preview instanceof HTMLImageElement)) continue;
    preview.removeAttribute('src');
    preview.alt = '';
    preview.hidden = true;
  }
  if (sideBox instanceof HTMLElement) sideBox.hidden = true;
  if (phoneState) {
    phoneState.textContent = 'Waiting…';
    phoneState.classList.remove('is-ready');
  }
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
  let reading = false;

  const camera = mountTimesheetCamera({
    onCapture: (side, file) => {
      setSideFile(side, file);
      setStatus('');
    },
  });

  const descDialog = mountDescriptionDialog({
    getRows(side) {
      if (!extraction) return null;
      return side === 'back' ? extraction.back_rows : extraction.front_rows;
    },
  });

  const sliceDialog = mountSliceDialog({
    getRows(side) {
      if (!extraction) return null;
      return side === 'back' ? extraction.back_rows : extraction.front_rows;
    },
    readState: () => {
      try {
        return typeof options.readState === 'function' ? options.readState() : null;
      } catch {
        return null;
      }
    },
    getMode: () => hoursMode,
    getBreaks: () => snapBreaks(),
    onChange() {
      if (!extraction) return;
      refreshPayPeriodInfo(extraction, snapBreaks(), officeState(), hoursMode);
    },
    onClose() {
      if (!extraction) return;
      refreshDerivedFromExtraction();
      paintCardSheet(frontCard, extraction.front_rows ?? [], FRONT_SLOT_COUNT, hoursMode);
      paintCardSheet(backCard, extraction.back_rows ?? [], BACK_SLOT_COUNT, hoursMode);
      bindCardEditors(frontCard, extraction.front_rows, FRONT_SLOT_COUNT, {
        snapBody: frontSnap,
        breaks: snapBreaks(),
        getMode: () => hoursMode,
        onStampChange: refreshDerivedFromExtraction,
        onHoursChange: markAndPaintHourRows,
      });
      bindCardEditors(backCard, extraction.back_rows, BACK_SLOT_COUNT, {
        snapBody: backSnap,
        breaks: snapBreaks(),
        getMode: () => hoursMode,
        onStampChange: refreshDerivedFromExtraction,
        onHoursChange: markAndPaintHourRows,
      });
      alignSnapRows(frontCard, frontSnap);
      alignSnapRows(backCard, backSnap);
      markAndPaintHourRows();
    },
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    readCard().catch((error) => setStatus(error.message || 'Could not read that card.', 'error'));
  });
  document.querySelector('#timesheet-clear')?.addEventListener('click', clearCard);
  document.querySelector('#timesheet-scan')?.addEventListener('click', () => {
    camera.open('front').catch((error) => setStatus(error.message || 'Could not open the camera.', 'error'));
  });
  document.querySelector('#timesheet-front')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) setSideFile('front', file);
  });
  document.querySelector('#timesheet-back')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) setSideFile('back', file);
  });

  let phoneCapture;
  const printCopies = mountPrintCopies({
    setStatus,
    currentPair() {
      const front = document.querySelector('#timesheet-front');
      const back = document.querySelector('#timesheet-back');
      return {
        token: phoneCapture?.currentToken?.() || '',
        front: front instanceof HTMLInputElement ? front.files?.[0] || null : null,
        back: back instanceof HTMLInputElement ? back.files?.[0] || null : null,
      };
    },
  });
  phoneCapture = mountPhoneCapture({
    setSideFile,
    setStatus,
    onPhonePhoto(side, file, sessionToken) {
      printCopies.notePhoto(sessionToken, side, file).catch((error) => {
        setStatus(error?.message || 'Could not save that print copy.', 'error');
      });
    },
  });

  new MutationObserver(() => {
    if (view.hidden) {
      camera.close();
      descDialog.close();
      sliceDialog.close();
      printCopies.close();
      phoneCapture.pause();
      return;
    }
    phoneCapture.resume();
  }).observe(view, { attributes: true, attributeFilter: ['hidden'] });

  document.querySelector('#timesheet-cards')?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const pair = target.closest('.timesheet-card-pair');
    const tr = target.closest('tr[data-row-index]');
    if (!pair || !tr) return;
    const side = pair.getAttribute('data-side') === 'back' ? 'back' : 'front';
    const index = Number(tr.dataset.rowIndex) || 0;
    const rows = side === 'back' ? extraction?.back_rows : extraction?.front_rows;
    const row = Array.isArray(rows) ? rows[index - 1] : null;

    const descButton = target.closest('.timesheet-desc-open');
    if (descButton instanceof HTMLButtonElement) {
      descDialog.open(side, index, descButton);
      return;
    }

    const deleteButton = target.closest('.timesheet-row-delete');
    if (deleteButton instanceof HTMLButtonElement) {
      if (!row || !extraction) return;
      clearCardRow(row);
      renderResult();
      return;
    }

    const sliceButton = target.closest('.timesheet-row-slice');
    if (sliceButton instanceof HTMLButtonElement) {
      if (!row || !extraction) return;
      sliceDialog.open(side, index);
    }
  });

  mountRowHeightControl({
    cards: document.querySelector('#timesheet-cards'),
    input: document.querySelector('#timesheet-row-height'),
    down: document.querySelector('#timesheet-row-height-down'),
    up: document.querySelector('#timesheet-row-height-up'),
    valueOut: document.querySelector('#timesheet-row-height-value'),
    realign() {
      if (result.hidden) return;
      alignSnapRows(frontCard, frontSnap);
      alignSnapRows(backCard, backSnap);
    },
  });

  /** @type {'snap' | 'quarter'} */
  let hoursMode = readStoredHoursMode();
  const hoursModeControl = mountHoursModeControl({
    mode: hoursMode,
    onChange(next) {
      hoursMode = next;
      if (extraction) refreshDerivedFromExtraction();
    },
  });

  function officeState() {
    try {
      return typeof options.readState === 'function' ? options.readState() : null;
    } catch {
      return null;
    }
  }

  function asOfDate() {
    try {
      return typeof options.asOf === 'function' ? options.asOf() : '';
    } catch {
      return '';
    }
  }

  const cardHeader = mountCardHeaderForm({
    readState: officeState,
    asOf: asOfDate,
    getExtraction: () => extraction,
    setExtractionHeader(header) {
      if (!extraction) return;
      extraction.header = header;
      applyHeaderDefaultPayStatus(extraction, header?.default_pay_status);
      refreshPayPeriodInfo(extraction, snapBreaks(), officeState(), hoursMode);
      // Contract hours drive Reg / OT fill — recalculate when the sticker changes.
      applyContractDerivedFields();
      markAndPaintHourRows();
    },
  });

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

  function contractHourOptions() {
    const state = officeState() || {};
    return {
      breaks: snapBreaks(),
      rules: state.overtimeRules,
      holidays: holidayListForState(state),
      defaultYear: inferDefaultYear(extraction?.header?.date_on_card),
      mode: hoursMode,
    };
  }

  function applyContractDerivedFields() {
    if (!extraction) return;
    applyContractRegOtRows(
      extraction.front_rows,
      extraction.back_rows,
      extraction.header?.contract_hours,
      contractHourOptions()
    );
    paintRegOtFields(frontCard, extraction.front_rows);
    paintRegOtFields(backCard, extraction.back_rows);
  }

  function markAndPaintHourRows() {
    if (!extraction) return;
    markContractHourRows(
      extraction.front_rows,
      extraction.back_rows,
      extraction.header?.contract_hours,
      contractHourOptions()
    );
    paintHourFlags(frontCard, extraction.front_rows);
    paintHourFlags(backCard, extraction.back_rows);
  }

  function refreshDerivedFromExtraction() {
    if (!extraction) return;
    const breaks = snapBreaks();
    const mode = hoursMode;
    hoursModeControl.setMode(mode);
    applySnapDerivedFields(extraction.front_rows, FRONT_SLOT_COUNT, breaks, frontCard, mode);
    applySnapDerivedFields(extraction.back_rows, BACK_SLOT_COUNT, breaks, backCard, mode);
    applyContractDerivedFields();
    markAndPaintHourRows();
    paintSnapSheet(frontSnap, extraction.front_rows ?? [], FRONT_SLOT_COUNT, breaks, mode);
    paintSnapSheet(backSnap, extraction.back_rows ?? [], BACK_SLOT_COUNT, breaks, mode);
    alignSnapRows(frontCard, frontSnap);
    alignSnapRows(backCard, backSnap);
    refreshPayPeriodInfo(extraction, breaks, officeState(), mode);
  }

  function renderResult() {
    if (!extraction) {
      result.hidden = true;
      return;
    }
    result.hidden = false;
    if (!extraction.header || typeof extraction.header !== 'object') {
      extraction.header = blankCardHeader();
    }
    cardHeader.syncFromExtraction(extraction.header);
    const breaks = snapBreaks();
    const mode = hoursMode;
    hoursModeControl.setMode(mode);
    paintCardSheet(frontCard, extraction.front_rows ?? [], FRONT_SLOT_COUNT, mode);
    paintCardSheet(backCard, extraction.back_rows ?? [], BACK_SLOT_COUNT, mode);
    applySnapDerivedFields(extraction.front_rows, FRONT_SLOT_COUNT, breaks, frontCard, mode);
    applySnapDerivedFields(extraction.back_rows, BACK_SLOT_COUNT, breaks, backCard, mode);
    applyContractDerivedFields();
    markAndPaintHourRows();
    paintSnapSheet(frontSnap, extraction.front_rows ?? [], FRONT_SLOT_COUNT, breaks, mode);
    paintSnapSheet(backSnap, extraction.back_rows ?? [], BACK_SLOT_COUNT, breaks, mode);
    bindCardEditors(frontCard, extraction.front_rows, FRONT_SLOT_COUNT, {
      snapBody: frontSnap,
      breaks,
      getMode: () => hoursMode,
      onStampChange: refreshDerivedFromExtraction,
      onHoursChange: markAndPaintHourRows,
    });
    bindCardEditors(backCard, extraction.back_rows, BACK_SLOT_COUNT, {
      snapBody: backSnap,
      breaks,
      getMode: () => hoursMode,
      onStampChange: refreshDerivedFromExtraction,
      onHoursChange: markAndPaintHourRows,
    });
    alignSnapRows(frontCard, frontSnap);
    alignSnapRows(backCard, backSnap);
    refreshPayPeriodInfo(extraction, breaks, officeState(), mode);
  }

  async function readCard() {
    if (reading) return;
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
    reading = true;
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
        'Reading the contract hours under the route number…',
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
      const rows = [...(extraction?.front_rows ?? []), ...(extraction?.back_rows ?? [])];
      const off = rows.some((row) => row?.hours_add_up === false);
      setStatus(
        off
          ? 'Copied the card. Red rows are hours that do not add up.'
          : 'Copied the card.',
        off ? 'error' : 'ok'
      );
    } catch (error) {
      stopProgressMessages();
      setStatus(error?.message || 'Could not read that card.', 'error');
    } finally {
      stopProgressMessages();
      reading = false;
      button.disabled = false;
      if (clearButton) clearButton.disabled = false;
    }
  }

  function maybeAutoRead() {
    const front = document.querySelector('#timesheet-front');
    const back = document.querySelector('#timesheet-back');
    const hasFront = front instanceof HTMLInputElement && Boolean(front.files?.[0]);
    const hasBack = back instanceof HTMLInputElement && Boolean(back.files?.[0]);
    if (!hasFront || !hasBack || reading) return;
    readCard().catch((error) => setStatus(error.message || 'Could not read that card.', 'error'));
  }

  function setSideFile(side, file) {
    const input = document.querySelector(side === 'front' ? '#timesheet-front' : '#timesheet-back');
    if (input && input.files?.[0] !== file) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    }
    showSidePreview(side, file);
    maybeAutoRead();
  }

  function clearCard() {
    stopProgressMessages();
    extraction = null;
    camera.close();
    descDialog.close();
    sliceDialog.close();
    phoneCapture.reset();
    cardHeader.clear();
    form.reset();
    clearSidePreview('front');
    clearSidePreview('back');
    frontCard.replaceChildren();
    backCard.replaceChildren();
    frontSnap.replaceChildren();
    backSnap.replaceChildren();
    const payPeriod = document.querySelector('#timesheet-pay-period');
    if (payPeriod) payPeriod.replaceChildren();
    const caveats = document.querySelector('#timesheet-caveats');
    if (caveats) {
      caveats.hidden = true;
      caveats.textContent = '';
    }
    result.hidden = true;
    setStatus('');
  }

  return { refresh };
}

/**
 * @param {object | null | undefined} extraction
 */
export function hasIllegibleClockStamps(extraction) {
  const rows = [...(extraction?.front_rows ?? []), ...(extraction?.back_rows ?? [])];
  return rows.some(
    (row) =>
      /^illegible$/i.test(String(row?.clock_out_raw ?? '').trim()) ||
      /^illegible$/i.test(String(row?.clock_in_raw ?? '').trim())
  );
}

/**
 * Text shown in a Reg or OT cell. Illegible stays as the word the user can replace.
 * @param {object} row
 * @param {'reg' | 'ot'} field
 */
function hourFieldValue(row, field) {
  const status = field === 'reg' ? row?.written_regular_status : row?.written_overtime_status;
  const hours = field === 'reg' ? row?.written_regular : row?.written_overtime;
  if (status === 'illegible') return 'illegible';
  if (status === 'number' && hours != null) return formatAuditHours(hours);
  const legacy = field === 'reg' ? row?.hours_regular : row?.hours_overtime;
  if (typeof legacy === 'number' && Number.isFinite(legacy)) return formatAuditHours(legacy);
  return legacy == null ? '' : String(legacy);
}

/**
 * @param {HTMLElement | null} body
 * @param {object[] | null | undefined} rows
 */
function paintHourFlags(body, rows) {
  if (!body || !Array.isArray(rows)) return;
  for (const row of rows) {
    const index = Number(row?.row_index) || 0;
    const tr = body.querySelector(`tr[data-row-index="${index}"]`);
    if (tr) tr.classList.toggle('is-hours-off', row?.hours_add_up === false);
  }
}

/**
 * Sync Reg / OT inputs after Genie fills (or clears) calculated hours.
 * @param {HTMLElement | null} body
 * @param {object[] | null | undefined} rows
 */
function paintRegOtFields(body, rows) {
  if (!body || !Array.isArray(rows)) return;
  for (const row of rows) {
    const index = Number(row?.row_index) || 0;
    if (!index) continue;
    const tr = body.querySelector(`tr[data-row-index="${index}"]`);
    if (!tr) continue;
    const reg = tr.querySelector('input[data-field="hours_regular"]');
    const ot = tr.querySelector('input[data-field="hours_overtime"]');
    if (reg instanceof HTMLInputElement) reg.value = hourFieldValue(row, 'reg');
    if (ot instanceof HTMLInputElement) ot.value = hourFieldValue(row, 'ot');
  }
}

/**
 * One side of the blue card: every cell editable.
 * @param {HTMLElement} body
 * @param {object[]} rows
 * @param {number} slotCount
 * @param {string | null | undefined} [mode]
 */
export function paintCardSheet(body, rows, slotCount, mode) {
  const hoursMode = normalizeTimesheetHoursMode(mode);
  const totSource = HOURS_MODE_LABELS[hoursMode];
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
    const portionCount = Array.isArray(row.pay_portions) ? row.pay_portions.length : 0;
    if (blank) tr.classList.add('is-quiet');
    if (row.crossed_out) tr.classList.add('is-crossed');
    if (row.hours_add_up === false) tr.classList.add('is-hours-off');
    if (portionCount) tr.classList.add('has-slices');
    tr.innerHTML = `
      <td class="timesheet-card-blank timesheet-card-desc">
        ${descriptionOpenHtml(row.description_of_work, index)}
      </td>
      <td class="timesheet-card-blank timesheet-card-reg">
        <input class="timesheet-edit" data-field="hours_regular" type="text"
          value="${escapeAttr(hourFieldValue(row, 'reg'))}" aria-label="Reg hours row ${index}">
      </td>
      <td class="timesheet-card-blank timesheet-card-ot">
        <input class="timesheet-edit" data-field="hours_overtime" type="text"
          value="${escapeAttr(hourFieldValue(row, 'ot'))}" aria-label="OT hours row ${index}">
      </td>
      <td class="timesheet-card-blank timesheet-card-tot">
        <input class="timesheet-edit timesheet-tot-hrs" data-field="total_hours" type="text"
          value="${escapeAttr(row.total_hours)}" readonly tabindex="-1"
          aria-label="Tot. Hrs. row ${index} from ${totSource}">
      </td>
      <td class="timesheet-card-clock">
        ${stampEditorHtml('out', row.clock_out_raw, index)}
        ${stampEditorHtml('in', row.clock_in_raw, index)}
      </td>
      <td class="timesheet-card-actions">
        <button type="button" class="timesheet-row-slice${portionCount ? ' has-slices' : ''}"
          ${blank || row.crossed_out ? 'disabled' : ''}
          aria-label="Slice pay status for row ${index}${portionCount ? ` (${portionCount} parts)` : ''}"
          title="Slice clock time by pay status">✂</button>
        <button type="button" class="timesheet-row-delete"
          ${blank && !row.description_of_work && !portionCount ? 'disabled' : ''}
          aria-label="Delete row ${index}"
          title="Delete this line">×</button>
      </td>`;
    body.append(tr);
  }
}

/**
 * Keep the extraction rows in sync as the user edits the card tables.
 * @param {HTMLElement} body
 * @param {object[]} rows
 * @param {number} slotCount
 * @param {{
 *   snapBody?: HTMLElement | null,
 *   breaks?: object,
 *   getMode?: () => string,
 *   onStampChange?: () => void,
 * }} [extras]
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
      if (field === 'hours_regular' || field === 'hours_overtime') {
        const parsed = parseAuditHours(text);
        const writtenKey = field === 'hours_regular' ? 'written_regular' : 'written_overtime';
        const statusKey = field === 'hours_regular' ? 'written_regular_status' : 'written_overtime_status';
        row[statusKey] = parsed.status;
        row[writtenKey] = parsed.hours;
        row[field] = parsed.status === 'number' ? parsed.hours : null;
        if (typeof extras.onHoursChange === 'function') extras.onHoursChange();
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
    const mode =
      typeof extras.getMode === 'function' ? extras.getMode() : TIMESHEET_HOURS_MODE_SNAP;
    updateRowSnapDerived(tr, row, breaks, mode);
    if (typeof extras.onStampChange === 'function') extras.onStampChange();
  };
}

/**
 * @param {object[]} rows
 * @param {number} slotCount
 * @param {object} breaks
 * @param {HTMLElement} body
 * @param {string | null | undefined} [mode]
 */
function applySnapDerivedFields(rows, slotCount, breaks, body, mode) {
  if (!Array.isArray(rows)) return;
  for (let index = 1; index <= slotCount; index += 1) {
    const row = rows[index - 1];
    if (!row) continue;
    const snapped = snapRoundedForRow(row, breaks, null, mode);
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
 * @param {string | null | undefined} [mode]
 */
function updateRowSnapDerived(tr, row, breaks, mode) {
  const snapped = snapRoundedForRow(row, breaks, null, mode);
  row.total_hours = snapped.totalHours;
  const input = tr.querySelector('input[data-field="total_hours"]');
  if (input instanceof HTMLInputElement) {
    input.value = snapped.totalHours == null ? '' : String(snapped.totalHours);
  }
}

/**
 * @param {object} extraction
 * @param {object} breaks
 * @param {object | null} state
 * @param {string | null | undefined} [mode]
 */
function cardDayFigures(extraction, breaks, _state, mode) {
  const year = inferDefaultYear(extraction?.header?.date_on_card);
  const totHoursByDay = new Map();
  for (const rows of [extraction?.front_rows, extraction?.back_rows]) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || row.crossed_out) continue;
      const snapped = snapRoundedForRow(row, breaks, year, mode);
      if (snapped.totalHours == null || !snapped.spanStart) continue;
      const key = localDateKey(snapped.spanStart);
      totHoursByDay.set(key, (totHoursByDay.get(key) || 0) + snapped.totalHours);
    }
  }
  return { totHoursByDay };
}

/**
 * @param {object} extraction
 * @param {object} breaks
 * @param {object | null} state
 * @param {string | null | undefined} [mode]
 */
function refreshPayPeriodInfo(extraction, breaks, state, mode) {
  const host = document.querySelector('#timesheet-pay-period');
  if (!(host instanceof HTMLElement)) return;
  const year = inferDefaultYear(extraction?.header?.date_on_card);
  const driverName = String(extraction?.header?.employee_name || '').trim() || 'Driver';
  const office = state && typeof state === 'object' ? state : {};
  const defaults = normalizeClockPayDefaults(office.clockPayDefaults);
  const drivers = driversFromState(office);
  const wanted = driverName.toLowerCase();
  const driver =
    drivers.find((item) => String(item?.name || '').trim().toLowerCase() === wanted) || null;
  const choices = driverPayStatusChoices(driver?.payStatuses, defaults.lines);
  const headerDefault = String(extraction?.header?.default_pay_status || '').trim();
  const defaultPayStatus =
    (isPayLineId(headerDefault) ? headerDefault : '') ||
    choices[0]?.id ||
    payStatusForClockIn(driver?.payStatuses, driver?.payStatusByRun, 'OTHER', defaults.lines);
  ensureCardRowPayDefaults(extraction, breaks, year, mode, defaultPayStatus);
  const punches = punchesFromCardExtraction(
    extraction,
    breaks,
    year,
    driver?.name || driverName,
    mode,
    defaultPayStatus
  );
  const { totHoursByDay } = cardDayFigures(extraction, breaks, office, mode);
  if (!punches.length) {
    host.innerHTML =
      '<p class="lead timesheet-pay-period-empty">Add readable Clock Record stamps to build the Monthly Time Summary.</p>';
    return;
  }
  let cardNow = null;
  for (const punch of punches) {
    const when = new Date(punch?.punched_at);
    if (Number.isNaN(when.getTime())) continue;
    if (!cardNow || when > cardNow) cardNow = when;
  }
  try {
    const lineIds = choices.map((line) => line.id);
    const summary = buildMonthlyTimeSummary({
      driverName: driver?.name || driverName,
      driverId: driver?.id || 'genie-card',
      email: driver?.email || '',
      pay: driver?.pay,
      defaults,
      edits: {},
      punches,
      officeState: office,
      rounding: clockRoundingMode(office),
      overtimeRules: office.overtimeRules,
      stickerContractHours: extraction?.header?.contract_hours,
      now: cardNow || new Date(),
      focus: lineIds.length ? { lineIds } : undefined,
      regOtFromContractGap: true,
      totHoursByDay,
    });
    const markup = monthlyTimeSummaryEmbedMarkup(summary);
    host.innerHTML = markup ||
      '<p class="lead timesheet-pay-period-empty">No pay period days match those stamps yet.</p>';
    const periodSelect = host.querySelector('[data-timesheet-mts-period]');
    if (periodSelect instanceof HTMLSelectElement) {
      periodSelect.addEventListener('change', () => {
        const key = periodSelect.value;
        host.querySelectorAll('.period-block').forEach((block) => {
          if (!(block instanceof HTMLElement)) return;
          block.hidden = block.dataset.period !== key;
        });
      });
    }
  } catch (error) {
    host.innerHTML = `<p class="lead timesheet-pay-period-empty">${escapeHtml(
      error?.message || 'Could not build the Monthly Time Summary.'
    )}</p>`;
  }
}

/**
 * @param {object} extraction
 * @param {object} breaks
 * @param {number} year
 * @param {string | null | undefined} mode
 * @param {string} defaultPayStatus
 */
function ensureCardRowPayDefaults(extraction, breaks, year, mode, defaultPayStatus) {
  const status = String(defaultPayStatus || '').trim();
  if (!status) return;
  for (const rows of [extraction?.front_rows, extraction?.back_rows]) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || row.crossed_out) continue;
      const snapped = snapRoundedForRow(row, breaks, year, mode);
      if (snapped.totalHours == null || !snapped.spanStart || !snapped.spanEnd) continue;
      if (!String(row.pay_status || '').trim()) row.pay_status = status;
    }
  }
}

/**
 * Push the header default onto every unsliced card row (no pay_portions yet).
 * @param {object | null | undefined} extraction
 * @param {string | null | undefined} defaultPayStatus
 */
function applyHeaderDefaultPayStatus(extraction, defaultPayStatus) {
  const status = String(defaultPayStatus || '').trim();
  if (!isPayLineId(status)) return;
  for (const rows of [extraction?.front_rows, extraction?.back_rows]) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || row.crossed_out) continue;
      if (Array.isArray(row.pay_portions) && row.pay_portions.length) continue;
      row.pay_status = status;
    }
  }
}

/**
 * @param {HTMLElement} body
 * @param {object[]} rows
 * @param {number} slotCount
 * @param {object} breaks
 * @param {string | null | undefined} [mode]
 */
export function paintSnapSheet(body, rows, slotCount, breaks, mode) {
  if (!body) return;
  body.replaceChildren();
  for (let index = 1; index <= slotCount; index += 1) {
    const row = Array.isArray(rows) ? rows[index - 1] : null;
    const snapped = snapRoundedForRow(row, breaks, null, mode);
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

function blankCardHeader() {
  return {
    employee_name: null,
    route_number: null,
    date_on_card: null,
    contract_am_hours: null,
    contract_midday_hours: null,
    contract_pm_hours: null,
    contract_hours: null,
    default_pay_status: null,
  };
}

/**
 * Clear a front/back card line so it no longer feeds the Monthly Time Summary.
 * Slot stays in place so the paper-card row alignment is unchanged.
 * @param {object | null | undefined} row
 */
export function clearCardRow(row) {
  if (!row || typeof row !== 'object') return row;
  row.description_of_work = null;
  row.hours_regular = null;
  row.hours_overtime = null;
  row.hours_secondary = null;
  row.total_hours = null;
  row.clock_out_raw = null;
  row.clock_in_raw = null;
  row.clock_out_iso = null;
  row.clock_in_iso = null;
  row.clock_out_override_iso = null;
  row.clock_in_override_iso = null;
  row.crossed_out = false;
  row.pay_status = null;
  delete row.pay_portions;
  return row;
}

/**
 * Append an hours-based pay-status slice onto a clock period.
 * Hours are taken from the next unallocated start of the Out→In span.
 * @param {{
 *   periodStart: Date,
 *   periodEnd: Date,
 *   hours: number | string,
 *   payStatus: string,
 *   existingPortions?: object[],
 *   allowed?: string[] | null,
 * }} input
 */
export function allocateHoursToPayStatus(input) {
  const periodStart = input?.periodStart;
  const periodEnd = input?.periodEnd;
  const startMs = periodStart?.getTime?.();
  const endMs = periodEnd?.getTime?.();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { error: 'This row needs a readable Out and In before it can be sliced.', portions: [] };
  }
  const payStatus = String(input?.payStatus || '').trim();
  const allowed = Array.isArray(input?.allowed) ? input.allowed.filter((id) => isPayLineId(id)) : null;
  if (!isPayLineId(payStatus) || (allowed && !allowed.includes(payStatus))) {
    return { error: 'Choose a pay status.', portions: Array.isArray(input?.existingPortions) ? input.existingPortions : [] };
  }
  const rawHours = Number(input?.hours);
  if (!Number.isFinite(rawHours) || rawHours <= 0) {
    return { error: 'Enter an amount of hours to allocate.', portions: Array.isArray(input?.existingPortions) ? input.existingPortions : [] };
  }
  const quarterHours = Math.round(rawHours * 4) / 4;
  const minutes = Math.round(quarterHours * 60);
  if (minutes < 1) {
    return { error: 'Enter at least 0.25 hours.', portions: Array.isArray(input?.existingPortions) ? input.existingPortions : [] };
  }
  const existing = normalizePayPortions(input?.existingPortions, periodStart, periodEnd, allowed);
  let cursor = startMs;
  for (const portion of existing) {
    cursor = Math.max(cursor, new Date(portion.end).getTime());
  }
  const remainingMs = endMs - cursor;
  const needMs = minutes * 60000;
  if (needMs > remainingMs + 999) {
    const remainingHours = Math.round((remainingMs / 3600000) * 100) / 100;
    return {
      error: remainingHours > 0
        ? `Only ${remainingHours} hour${remainingHours === 1 ? '' : 's'} left to allocate on this period.`
        : 'This period is already fully sliced.',
      portions: existing,
    };
  }
  const nextEnd = Math.min(endMs, cursor + needMs);
  const requested = [
    ...existing,
    {
      start: new Date(cursor).toISOString(),
      end: new Date(nextEnd).toISOString(),
      pay_status: payStatus,
    },
  ];
  const message = payPortionError(requested, periodStart, periodEnd, allowed);
  if (message) return { error: message, portions: existing };
  return {
    error: '',
    portions: normalizePayPortions(requested, periodStart, periodEnd, allowed),
  };
}

/**
 * Driver / route / contract-hours strip above the Front and Back cards.
 * @param {{
 *   readState: () => object | null,
 *   asOf: () => string,
 *   getExtraction: () => object | null,
 *   setExtractionHeader: (header: object) => void,
 * }} options
 */
function mountCardHeaderForm(options) {
  const form = document.querySelector('#timesheet-card-header');
  const driverInput = document.querySelector('#timesheet-header-driver');
  const routeInput = document.querySelector('#timesheet-header-route');
  const amInput = document.querySelector('#timesheet-header-am');
  const midInput = document.querySelector('#timesheet-header-mid');
  const pmInput = document.querySelector('#timesheet-header-pm');
  const contractInput = document.querySelector('#timesheet-header-contract');
  const payStatusSelect = document.querySelector('#timesheet-header-pay-status');
  const driverList = document.querySelector('#timesheet-driver-options');
  const routeList = document.querySelector('#timesheet-route-options');
  if (!form || !driverInput || !routeInput || !amInput || !midInput || !pmInput) {
    return {
      syncFromExtraction() {},
      clear() {},
    };
  }

  let fillingFromMatch = false;

  function payrollRows() {
    try {
      const state = options.readState() || {};
      const asOf = String(options.asOf() || '').trim();
      return payrollDriverRows(state, {
        asOf: asOf || undefined,
        usePunches: false,
      });
    } catch {
      return [];
    }
  }

  function knownPayLines() {
    try {
      const state = options.readState() || {};
      return normalizeClockPayDefaults(state.clockPayDefaults).lines;
    } catch {
      return normalizeClockPayDefaults(null).lines;
    }
  }

  function suggestedPayStatusForDriver(driverName) {
    const wanted = String(driverName || '').trim().toLowerCase();
    if (!wanted) return '';
    try {
      const state = options.readState() || {};
      const defaults = normalizeClockPayDefaults(state.clockPayDefaults);
      const driver =
        driversFromState(state).find(
          (item) => String(item?.name || '').trim().toLowerCase() === wanted
        ) || null;
      const choices = driverPayStatusChoices(driver?.payStatuses, defaults.lines);
      return (
        choices[0]?.id ||
        payStatusForClockIn(driver?.payStatuses, driver?.payStatusByRun, 'OTHER', defaults.lines) ||
        ''
      );
    } catch {
      return '';
    }
  }

  function refreshPayStatusChoices(selected) {
    if (!(payStatusSelect instanceof HTMLSelectElement)) return;
    const lines = knownPayLines();
    const current = String(selected || payStatusSelect.value || '').trim();
    payStatusSelect.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choose a pay status';
    payStatusSelect.append(blank);
    for (const line of lines) {
      const option = document.createElement('option');
      option.value = line.id;
      option.textContent = line.label;
      payStatusSelect.append(option);
    }
    if (current && [...payStatusSelect.options].some((option) => option.value === current)) {
      payStatusSelect.value = current;
    } else {
      payStatusSelect.value = '';
    }
  }

  function refreshChoices() {
    const state = options.readState() || {};
    const drivers = driversFromState(state)
      .map((driver) => String(driver?.name || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const routes = Object.values(state.profiles || {})
      .map((profile) => String(profile?.name || '').trim())
      .filter(Boolean)
      .sort(compareRouteNumbers);
    if (driverList) {
      driverList.replaceChildren(
        ...drivers.map((name) => {
          const option = document.createElement('option');
          option.value = name;
          return option;
        })
      );
    }
    if (routeList) {
      routeList.replaceChildren(
        ...routes.map((name) => {
          const option = document.createElement('option');
          option.value = name;
          return option;
        })
      );
    }
    refreshPayStatusChoices();
  }

  function readHeaderFromForm() {
    const extraction = options.getExtraction();
    const previous = extraction?.header && typeof extraction.header === 'object'
      ? extraction.header
      : blankCardHeader();
    const payStatus =
      payStatusSelect instanceof HTMLSelectElement ? payStatusSelect.value.trim() : '';
    return {
      ...blankCardHeader(),
      ...previous,
      employee_name: driverInput.value.trim() || null,
      route_number: routeInput.value.trim() || null,
      contract_am_hours: parseHoursInput(amInput.value),
      contract_midday_hours: parseHoursInput(midInput.value),
      contract_pm_hours: parseHoursInput(pmInput.value),
      contract_hours:
        contractInput instanceof HTMLInputElement
          ? parseStickerContractHours(contractInput.value)?.total ?? null
          : previous.contract_hours ?? null,
      default_pay_status: isPayLineId(payStatus) ? payStatus : null,
    };
  }

  function writeHeaderToForm(header) {
    const next = header && typeof header === 'object' ? header : blankCardHeader();
    driverInput.value = next.employee_name ? String(next.employee_name) : '';
    routeInput.value = next.route_number ? String(next.route_number) : '';
    amInput.value = hoursFieldText(next.contract_am_hours);
    midInput.value = hoursFieldText(next.contract_midday_hours);
    pmInput.value = hoursFieldText(next.contract_pm_hours);
    if (contractInput instanceof HTMLInputElement) {
      contractInput.value = next.contract_hours == null ? '' : formatAuditHours(next.contract_hours);
    }
    refreshPayStatusChoices(next.default_pay_status);
  }

  function applyMatchedSuggestions(header, { fillDriver = false, fillRoute = false } = {}) {
    const row = matchPayrollRow(payrollRows(), header);
    const next = { ...header };
    if (row) {
      if (fillDriver && !next.employee_name) {
        const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
        if (name) next.employee_name = name;
      }
      if (fillRoute && !next.route_number && row.route) {
        next.route_number = String(row.route);
      }
      next.contract_am_hours = contractHoursFromPayroll(row, 'am');
      next.contract_midday_hours = contractHoursFromPayroll(row, 'midday');
      next.contract_pm_hours = contractHoursFromPayroll(row, 'pm');
    }
    const suggested = suggestedPayStatusForDriver(next.employee_name);
    if (suggested) next.default_pay_status = suggested;
    return next;
  }

  function commitForm({ matchFrom } = {}) {
    if (!options.getExtraction()) return;
    let header = readHeaderFromForm();
    if (matchFrom === 'driver' && header.employee_name) {
      header = applyMatchedSuggestions(header, { fillRoute: true });
    } else if (matchFrom === 'route' && header.route_number) {
      header = applyMatchedSuggestions(header, { fillDriver: true });
    }
    options.setExtractionHeader(header);
    if (matchFrom) {
      fillingFromMatch = true;
      writeHeaderToForm(header);
      fillingFromMatch = false;
    }
  }

  form.addEventListener('submit', (event) => event.preventDefault());
  driverInput.addEventListener('change', () => {
    if (fillingFromMatch) return;
    commitForm({ matchFrom: 'driver' });
  });
  routeInput.addEventListener('change', () => {
    if (fillingFromMatch) return;
    commitForm({ matchFrom: 'route' });
  });
  for (const input of [driverInput, routeInput, amInput, midInput, pmInput, contractInput]) {
    if (!input) continue;
    input.addEventListener('input', () => {
      if (fillingFromMatch) return;
      commitForm();
    });
  }
  if (payStatusSelect instanceof HTMLSelectElement) {
    payStatusSelect.addEventListener('change', () => {
      if (fillingFromMatch) return;
      commitForm();
    });
  }

  return {
    syncFromExtraction(header) {
      refreshChoices();
      writeHeaderToForm(header);
    },
    clear() {
      writeHeaderToForm(blankCardHeader());
    },
  };
}

/**
 * Hours-based pay-status slicer for one Front/Back card row.
 * @param {{
 *   getRows: (side: 'front' | 'back') => object[] | null | undefined,
 *   readState: () => object | null,
 *   getMode: () => string,
 *   getBreaks: () => object,
 *   onChange: () => void,
 *   onClose?: () => void,
 * }} options
 */
function mountSliceDialog(options) {
  const dialog = document.querySelector('#timesheet-slice-dialog');
  const title = document.querySelector('#timesheet-slice-title');
  const lead = document.querySelector('#timesheet-slice-lead');
  const remainingEl = document.querySelector('#timesheet-slice-remaining');
  const partsEl = document.querySelector('#timesheet-slice-parts');
  const statusSelect = document.querySelector('#timesheet-slice-status');
  const hoursInput = document.querySelector('#timesheet-slice-hours');
  const errorEl = document.querySelector('#timesheet-slice-error');
  const addBtn = document.querySelector('#timesheet-slice-add');
  const doneBtn = document.querySelector('#timesheet-slice-done');
  if (
    !(dialog instanceof HTMLDialogElement) ||
    !(statusSelect instanceof HTMLSelectElement) ||
    !(hoursInput instanceof HTMLInputElement) ||
    !(addBtn instanceof HTMLButtonElement) ||
    !(doneBtn instanceof HTMLButtonElement)
  ) {
    return { open() {}, close() {} };
  }

  /** @type {{ side: 'front' | 'back', index: number, start: Date, end: Date } | null} */
  let editing = null;

  function close() {
    if (dialog.open) dialog.close();
  }

  function setError(message) {
    if (!(errorEl instanceof HTMLElement)) return;
    errorEl.hidden = !message;
    errorEl.textContent = message || '';
  }

  function knownLines() {
    try {
      return normalizeClockPayDefaults(options.readState()?.clockPayDefaults).lines;
    } catch {
      return normalizeClockPayDefaults(null).lines;
    }
  }

  function fillStatusChoices(selected) {
    const lines = knownLines();
    const current = String(selected || '').trim();
    statusSelect.replaceChildren();
    for (const line of lines) {
      const option = document.createElement('option');
      option.value = line.id;
      option.textContent = line.label;
      statusSelect.append(option);
    }
    if (current && [...statusSelect.options].some((option) => option.value === current)) {
      statusSelect.value = current;
    } else if (statusSelect.options.length) {
      statusSelect.selectedIndex = 0;
    }
  }

  function labelForStatus(id) {
    const line = knownLines().find((item) => item.id === id);
    return line?.label || id;
  }

  function currentRow() {
    if (!editing) return null;
    const rows = options.getRows(editing.side);
    return Array.isArray(rows) ? rows[editing.index - 1] || null : null;
  }

  function remainingHours() {
    if (!editing) return 0;
    const existing = normalizePayPortions(
      currentRow()?.pay_portions,
      editing.start,
      editing.end,
      knownLines().map((line) => line.id)
    );
    let cursor = editing.start.getTime();
    for (const portion of existing) {
      cursor = Math.max(cursor, new Date(portion.end).getTime());
    }
    return Math.max(0, Math.round(((editing.end.getTime() - cursor) / 3600000) * 100) / 100);
  }

  function paintParts() {
    const row = currentRow();
    if (!(partsEl instanceof HTMLElement) || !editing || !row) return;
    const allowed = knownLines().map((line) => line.id);
    const portions = normalizePayPortions(row.pay_portions, editing.start, editing.end, allowed);
    partsEl.replaceChildren();
    if (!portions.length) {
      partsEl.hidden = true;
      return;
    }
    partsEl.hidden = false;
    const heading = document.createElement('h3');
    heading.className = 'timesheet-slice-parts-title';
    heading.textContent = 'Allocated parts';
    partsEl.append(heading);
    portions.forEach((portion, index) => {
      const item = document.createElement('div');
      item.className = 'timesheet-slice-part';
      const hours =
        Math.round(
          ((new Date(portion.end).getTime() - new Date(portion.start).getTime()) / 3600000) * 100
        ) / 100;
      const text = document.createElement('span');
      text.textContent = `${hours} hr · ${labelForStatus(portion.pay_status)}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        const next = portions.filter((_, i) => i !== index);
        if (next.length) row.pay_portions = next;
        else delete row.pay_portions;
        setError('');
        paintParts();
        paintRemaining();
        options.onChange();
      });
      item.append(text, remove);
      partsEl.append(item);
    });
  }

  function paintRemaining() {
    if (!(remainingEl instanceof HTMLElement) || !editing) return;
    const left = remainingHours();
    remainingEl.textContent =
      left > 0
        ? `${left} hour${left === 1 ? '' : 's'} still on the default pay status.`
        : 'This period is fully sliced into pay statuses.';
  }

  function addSlice() {
    const row = currentRow();
    if (!editing || !row) return;
    const allowed = knownLines().map((line) => line.id);
    const result = allocateHoursToPayStatus({
      periodStart: editing.start,
      periodEnd: editing.end,
      hours: hoursInput.value,
      payStatus: statusSelect.value,
      existingPortions: row.pay_portions,
      allowed,
    });
    if (result.error) {
      setError(result.error);
      paintParts();
      return;
    }
    if (result.portions.length) row.pay_portions = result.portions;
    else delete row.pay_portions;
    hoursInput.value = '';
    setError('');
    paintParts();
    paintRemaining();
    options.onChange();
  }

  addBtn.addEventListener('click', addSlice);
  doneBtn.addEventListener('click', close);
  dialog.addEventListener('close', () => {
    editing = null;
    if (typeof options.onClose === 'function') options.onClose();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  hoursInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addSlice();
  });

  return {
    close,
    /**
     * @param {'front' | 'back'} side
     * @param {number} index
     */
    open(side, index) {
      const rows = options.getRows(side);
      const row = Array.isArray(rows) ? rows[index - 1] : null;
      if (!row) return;
      const year = inferDefaultYear(null);
      const snapped = snapRoundedForRow(row, options.getBreaks(), year, options.getMode());
      if (snapped.totalHours == null || !snapped.spanStart || !snapped.spanEnd) {
        return;
      }
      editing = {
        side,
        index,
        start: snapped.spanStart,
        end: snapped.spanEnd,
      };
      const sideLabel = side === 'back' ? 'Back' : 'Front';
      if (title) title.textContent = 'Slice clock time';
      if (lead) {
        lead.textContent = `${sideLabel} row ${index} · ${snapped.totalHours} Tot. Hrs. Pick a pay status and how many hours belong to it.`;
      }
      const headerPay = document.querySelector('#timesheet-header-pay-status');
      const headerDefault =
        headerPay instanceof HTMLSelectElement ? headerPay.value.trim() : '';
      fillStatusChoices(String(row.pay_status || headerDefault).trim());
      hoursInput.value = '';
      setError('');
      paintParts();
      paintRemaining();
      if (!dialog.open) dialog.showModal();
      hoursInput.focus();
    },
  };
}

/**
 * @param {object | null | undefined} row
 * @param {'am' | 'midday' | 'pm'} run
 */
function contractHoursFromPayroll(row, run) {
  const roundedKey =
    run === 'am'
      ? 'amRoundedQuarterHours'
      : run === 'midday'
        ? 'middayRoundedQuarterHours'
        : 'pmRoundedQuarterHours';
  const minutesKey =
    run === 'am' ? 'amTotalMinutes' : run === 'midday' ? 'middayTotalMinutes' : 'pmTotalMinutes';
  const rounded = row?.[roundedKey];
  if (typeof rounded === 'number' && Number.isFinite(rounded)) return rounded;
  const minutes = row?.[minutesKey];
  if (typeof minutes === 'number' && Number.isFinite(minutes)) {
    return Math.round((minutes / 60) * 100) / 100;
  }
  return null;
}

function parseHoursInput(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}

function hoursFieldText(value) {
  if (value == null || value === '') return '';
  return String(value);
}

/**
 * Fine row-height dial so a paper card held to the screen can match the on-screen slots.
 * @param {{
 *   cards: Element | null,
 *   input: HTMLInputElement | null,
 *   down: HTMLButtonElement | null,
 *   up: HTMLButtonElement | null,
 *   valueOut: HTMLOutputElement | null,
 *   realign: () => void,
 * }} parts
 */
function mountRowHeightControl({ cards, input, down, up, valueOut, realign }) {
  if (!cards || !input || !down || !up || !valueOut) return;

  function apply(px, { save = true } = {}) {
    const next = Math.min(ROW_HEIGHT_MAX, Math.max(ROW_HEIGHT_MIN, Math.round(Number(px) || ROW_HEIGHT_DEFAULT)));
    cards.style.setProperty('--timesheet-row-height', `${next}px`);
    input.value = String(next);
    input.setAttribute('aria-valuetext', `${next} pixels`);
    valueOut.textContent = `${next}px`;
    if (save) {
      try {
        localStorage.setItem(ROW_HEIGHT_KEY, String(next));
      } catch {
        /* Preference can stay for this visit only. */
      }
    }
    realign();
  }

  apply(savedRowHeight(), { save: false });
  input.min = String(ROW_HEIGHT_MIN);
  input.max = String(ROW_HEIGHT_MAX);
  input.step = '1';
  input.addEventListener('input', () => apply(input.value));
  bindHoldRepeat(down, () => apply(Number(input.value) - 1));
  bindHoldRepeat(up, () => apply(Number(input.value) + 1));
}

function savedRowHeight() {
  try {
    const raw = Number(localStorage.getItem(ROW_HEIGHT_KEY));
    if (Number.isFinite(raw)) return raw;
  } catch {
    /* Use the default. */
  }
  return ROW_HEIGHT_DEFAULT;
}

/**
 * Local grayscale copies of phone scans, for cropping and printing later.
 */
function mountPrintCopies({ setStatus, currentPair } = {}) {
  const dialog = document.querySelector('#timesheet-print-dialog');
  const list = document.querySelector('#timesheet-print-list');
  const cropPanel = document.querySelector('#timesheet-print-crop');
  const rangePanel = document.querySelector('#timesheet-print-range');
  const status = document.querySelector('#timesheet-print-status');
  const toggle = document.querySelector('#timesheet-save-for-print');
  const openButton = document.querySelector('#timesheet-print-open');
  const fromInput = document.querySelector('#timesheet-print-from');
  const toInput = document.querySelector('#timesheet-print-to');
  const cropImage = document.querySelector('#timesheet-print-crop-image');
  const cropBox = document.querySelector('#timesheet-print-crop-box');
  const cropLayer = document.querySelector('#timesheet-print-crop-layer');
  const cropLabel = document.querySelector('#timesheet-print-crop-label');
  if (!(dialog instanceof HTMLDialogElement) || !list) {
    return {
      notePhoto() {
        return Promise.resolve();
      },
      close() {},
    };
  }

  /** @type {Map<string, { front?: File, back?: File }>} */
  const pending = new Map();
  /** @type {object[]} */
  let cards = [];
  /** @type {object | null} */
  let cropping = null;
  /** @type {'front' | 'back'} */
  let cropSide = 'front';
  /** @type {{ x: number, y: number, w: number, h: number }} */
  let draftFront = { ...FULL_PRINT_CROP };
  /** @type {{ x: number, y: number, w: number, h: number }} */
  let draftBack = { ...FULL_PRINT_CROP };
  /** @type {{ ax: number, ay: number, bx: number, by: number } | null} */
  let drag = null;
  let cropUrl = '';

  function saveEnabled() {
    return toggle instanceof HTMLInputElement && toggle.checked;
  }

  function setPrintStatus(message, kind = '') {
    if (!(status instanceof HTMLElement)) return;
    status.hidden = !message;
    status.textContent = message || '';
    status.className = kind ? `status is-${kind}` : 'status';
  }

  function formatWhen(stamp) {
    const date = new Date(Number(stamp) || Date.now());
    if (Number.isNaN(date.getTime())) return 'Card';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function showList() {
    if (cropPanel instanceof HTMLElement) cropPanel.hidden = true;
    if (rangePanel instanceof HTMLElement) rangePanel.hidden = false;
    list.hidden = false;
    if (cropUrl) {
      URL.revokeObjectURL(cropUrl);
      cropUrl = '';
    }
  }

  function paintBox() {
    if (!(cropBox instanceof HTMLElement)) return;
    const crop = cropSide === 'front' ? draftFront : draftBack;
    const live = drag
      ? clampPrintCrop({
          x: Math.min(drag.ax, drag.bx),
          y: Math.min(drag.ay, drag.by),
          w: Math.abs(drag.bx - drag.ax),
          h: Math.abs(drag.by - drag.ay),
        })
      : crop;
    cropBox.style.left = `${live.x * 100}%`;
    cropBox.style.top = `${live.y * 100}%`;
    cropBox.style.width = `${live.w * 100}%`;
    cropBox.style.height = `${live.h * 100}%`;
  }

  function paintList() {
    showList();
    list.replaceChildren();
    if (!cards.length) {
      const empty = document.createElement('p');
      empty.className = 'lead';
      empty.textContent = 'No print copies yet. Turn on Save for printing, then scan a front and a back.';
      list.append(empty);
      return;
    }
    const ol = document.createElement('ol');
    ol.className = 'timesheet-print-cards';
    cards.forEach((card, index) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${index + 1}. ${formatWhen(card.createdAt)}`;
      const cropBtn = document.createElement('button');
      cropBtn.type = 'button';
      cropBtn.className = 'secondary';
      cropBtn.textContent = 'Crop';
      cropBtn.addEventListener('click', () => openCrop(card));
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'secondary';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        deletePrintCard(card.id)
          .then(() => refreshList())
          .catch((error) => setPrintStatus(error?.message || 'Could not remove that copy.', 'error'));
      });
      item.append(label, cropBtn, removeBtn);
      ol.append(item);
    });
    list.append(ol);
    if (fromInput instanceof HTMLInputElement) fromInput.value = '1';
    if (toInput instanceof HTMLInputElement) toInput.value = String(cards.length);
  }

  async function refreshList() {
    cards = await listPrintCards();
    if (dialog.open) paintList();
  }

  function openCrop(card) {
    cropping = card;
    cropSide = 'front';
    draftFront = clampPrintCrop(card.frontCrop || FULL_PRINT_CROP);
    draftBack = clampPrintCrop(card.backCrop || FULL_PRINT_CROP);
    drag = null;
    if (cropPanel instanceof HTMLElement) cropPanel.hidden = false;
    if (rangePanel instanceof HTMLElement) rangePanel.hidden = true;
    list.hidden = true;
    if (cropLabel) cropLabel.textContent = `Card ${cards.indexOf(card) + 1}`;
    document.querySelector('#timesheet-print-crop-front')?.setAttribute('aria-pressed', 'true');
    document.querySelector('#timesheet-print-crop-back')?.setAttribute('aria-pressed', 'false');
    showCropSide();
  }

  function showCropSide() {
    if (!(cropImage instanceof HTMLImageElement) || !cropping) return;
    if (cropUrl) URL.revokeObjectURL(cropUrl);
    const blob = cropSide === 'front' ? cropping.front : cropping.back;
    cropUrl = URL.createObjectURL(blob);
    cropImage.src = cropUrl;
    cropImage.alt = cropSide === 'front' ? 'Front print copy' : 'Back print copy';
    paintBox();
  }

  function pointerNorm(event) {
    if (!(cropLayer instanceof HTMLElement)) return { x: 0, y: 0 };
    const box = cropLayer.getBoundingClientRect();
    const x = box.width ? (event.clientX - box.left) / box.width : 0;
    const y = box.height ? (event.clientY - box.top) / box.height : 0;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  async function notePhoto(sessionToken, side, file) {
    const key = String(sessionToken || '').trim();
    if (!saveEnabled() || !key || (side !== 'front' && side !== 'back')) return;
    const slot = pending.get(key) || {};
    slot[side] = file;
    if (!slot.front || !slot.back) {
      const pair = typeof currentPair === 'function' ? currentPair() : null;
      if (pair?.token === key) {
        if (!slot.front && pair.front) slot.front = pair.front;
        if (!slot.back && pair.back) slot.back = pair.back;
      }
    }
    pending.set(key, slot);
    if (!slot.front || !slot.back) return;
    const [front, back] = await Promise.all([
      imageFileToPrintJpeg(slot.front),
      imageFileToPrintJpeg(slot.back),
    ]);
    await upsertPrintCard(key, front, back);
    pending.delete(key);
    if (typeof setStatus === 'function') {
      setStatus('Front and back saved in this browser for printing.', 'ok');
    }
    if (dialog.open) await refreshList();
  }

  async function printCards(subset) {
    if (!subset.length) {
      setPrintStatus('Choose at least one card to print.', 'error');
      return;
    }
    setPrintStatus('Preparing the print job…', '');
    const blob = await buildPrintPdfBlob(subset);
    printPdfBlob(blob);
    setPrintStatus(
      subset.length === 1 ? 'Printing 1 card.' : `Printing ${subset.length} cards.`,
      'ok'
    );
  }

  if (toggle instanceof HTMLInputElement) {
    try {
      toggle.checked = localStorage.getItem(PRINT_SAVE_KEY) === '1';
    } catch {
      toggle.checked = false;
    }
    toggle.addEventListener('change', () => {
      try {
        localStorage.setItem(PRINT_SAVE_KEY, toggle.checked ? '1' : '0');
      } catch {
        /* Preference can stay for this visit only. */
      }
      if (!toggle.checked) return;
      const pair = typeof currentPair === 'function' ? currentPair() : null;
      if (!pair?.token || !pair.front || !pair.back) return;
      notePhoto(pair.token, 'front', pair.front)
        .then(() => notePhoto(pair.token, 'back', pair.back))
        .catch((error) => {
          if (typeof setStatus === 'function') {
            setStatus(error?.message || 'Could not save that print copy.', 'error');
          }
        });
    });
  }

  openButton?.addEventListener('click', () => {
    setPrintStatus('');
    if (!dialog.open) dialog.showModal();
    refreshList().catch((error) => setStatusSafe(error));
  });
  document.querySelector('#timesheet-print-close')?.addEventListener('click', () => dialog.close());
  document.querySelector('#timesheet-print-all')?.addEventListener('click', () => {
    printCards(cards).catch((error) => setPrintStatus(error?.message || 'Could not print.', 'error'));
  });
  document.querySelector('#timesheet-print-range-btn')?.addEventListener('click', () => {
    const from = Math.max(1, Number(fromInput instanceof HTMLInputElement ? fromInput.value : 1) || 1);
    const last = Math.max(cards.length, 1);
    const to = Math.min(
      last,
      Math.max(from, Number(toInput instanceof HTMLInputElement ? toInput.value : from) || from)
    );
    printCards(cards.slice(from - 1, to)).catch((error) => {
      setPrintStatus(error?.message || 'Could not print.', 'error');
    });
  });
  document.querySelector('#timesheet-print-crop-front')?.addEventListener('click', () => {
    cropSide = 'front';
    document.querySelector('#timesheet-print-crop-front')?.setAttribute('aria-pressed', 'true');
    document.querySelector('#timesheet-print-crop-back')?.setAttribute('aria-pressed', 'false');
    drag = null;
    showCropSide();
  });
  document.querySelector('#timesheet-print-crop-back')?.addEventListener('click', () => {
    cropSide = 'back';
    document.querySelector('#timesheet-print-crop-front')?.setAttribute('aria-pressed', 'false');
    document.querySelector('#timesheet-print-crop-back')?.setAttribute('aria-pressed', 'true');
    drag = null;
    showCropSide();
  });
  document.querySelector('#timesheet-print-crop-reset')?.addEventListener('click', () => {
    if (cropSide === 'front') draftFront = { ...FULL_PRINT_CROP };
    else draftBack = { ...FULL_PRINT_CROP };
    drag = null;
    paintBox();
  });
  document.querySelector('#timesheet-print-crop-back-list')?.addEventListener('click', () => {
    cropping = null;
    paintList();
  });
  document.querySelector('#timesheet-print-crop-save')?.addEventListener('click', () => {
    if (!cropping) return;
    savePrintCrops(cropping.id, draftFront, draftBack)
      .then((saved) => {
        if (saved) {
          cropping.frontCrop = saved.frontCrop;
          cropping.backCrop = saved.backCrop;
        }
        setPrintStatus('Crop saved.', 'ok');
      })
      .catch((error) => setPrintStatus(error?.message || 'Could not save that crop.', 'error'));
  });
  cropLayer?.addEventListener('pointerdown', (event) => {
    if (!(event instanceof PointerEvent)) return;
    cropLayer.setPointerCapture?.(event.pointerId);
    const point = pointerNorm(event);
    drag = { ax: point.x, ay: point.y, bx: point.x, by: point.y };
    paintBox();
  });
  cropLayer?.addEventListener('pointermove', (event) => {
    if (!drag || !(event instanceof PointerEvent)) return;
    const point = pointerNorm(event);
    drag.bx = point.x;
    drag.by = point.y;
    paintBox();
  });
  cropLayer?.addEventListener('pointerup', (event) => {
    if (!drag || !(event instanceof PointerEvent)) return;
    const point = pointerNorm(event);
    drag.bx = point.x;
    drag.by = point.y;
    const next = clampPrintCrop({
      x: Math.min(drag.ax, drag.bx),
      y: Math.min(drag.ay, drag.by),
      w: Math.abs(drag.bx - drag.ax),
      h: Math.abs(drag.by - drag.ay),
    });
    if (cropSide === 'front') draftFront = next;
    else draftBack = next;
    drag = null;
    paintBox();
  });
  dialog.addEventListener('close', () => {
    cropping = null;
    showList();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  function setStatusSafe(error) {
    setPrintStatus(error?.message || 'Could not open print copies.', 'error');
  }

  return { notePhoto, close: () => { if (dialog.open) dialog.close(); } };
}

function readStoredHoursMode() {
  try {
    return normalizeTimesheetHoursMode(localStorage.getItem(HOURS_MODE_KEY));
  } catch {
    return TIMESHEET_HOURS_MODE_SNAP;
  }
}

/**
 * Desktop Genie: QR for phone capture, poll until Front/Back land in the form.
 * @param {{
 *   setSideFile: (side: 'front' | 'back', file: File) => void,
 *   setStatus: (message: string, kind?: string) => void,
 *   onPhonePhoto?: (side: 'front' | 'back', file: File, token: string) => void | Promise<void>,
 * }} options
 */
function mountPhoneCapture({ setSideFile, setStatus, onPhonePhoto }) {
  const computerPanel = document.querySelector('#timesheet-computer-capture');
  const phonePanel = document.querySelector('#timesheet-phone-capture');
  const canvas = document.querySelector('#timesheet-phone-qr');
  const phoneStatus = document.querySelector('#timesheet-phone-status');
  const refreshBtn = document.querySelector('#timesheet-phone-refresh');
  const sourceRoot = document.querySelector('#timesheet-capture-source');
  const sourceButtons = sourceRoot
    ? [...sourceRoot.querySelectorAll('[data-capture-source]')]
    : [];
  if (!computerPanel || !phonePanel || !(canvas instanceof HTMLCanvasElement)) {
    return {
      pause() {},
      reset() {},
      currentToken() {
        return '';
      },
    };
  }

  /** @type {'computer' | 'phone'} */
  let source = 'phone';
  /** @type {string} */
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
      button.setAttribute(
        'aria-pressed',
        button.dataset.captureSource === source ? 'true' : 'false'
      );
    }
    computerPanel.hidden = source !== 'computer';
    phonePanel.hidden = source !== 'phone';
  }

  async function drawQr(url) {
    await QRCode.toCanvas(canvas, url, {
      width: 288,
      margin: 1,
      color: { dark: '#1f4b66', light: '#ffffff' },
    });
  }

  async function pullSide(side) {
    if (seen[side]) return;
    const file = await fetchCapturePhoto(token, side);
    setSideFile(side, file);
    seen[side] = true;
    if (typeof onPhonePhoto === 'function') {
      await onPhonePhoto(side, file, token);
    }
  }

  async function pollOnce() {
    if (!token || source !== 'phone') return;
    try {
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
      if (session.front && !seen.front) await pullSide('front');
      if (session.back && !seen.back) await pullSide('back');
      if (session.ready || (seen.front && seen.back)) {
        setPhoneStatus('Front and back arrived. Ready for the next card.', 'ok');
        setStatus('Front and back arrived from your phone. Ready to read.', 'ok');
        return;
      }
      if (seen.front) setPhoneStatus('Front is in. Waiting for the back…', '');
      else if (seen.back) setPhoneStatus('Back is in. Waiting for the front…', '');
      else setPhoneStatus('Waiting for photos from your phone…', '');
    } catch (error) {
      setPhoneStatus(error?.message || 'Could not check for phone photos.', 'error');
    }
  }

  async function startSession() {
    if (starting) return;
    starting = true;
    stopPolling();
    setPhoneStatus('Making a photo link…', '');
    try {
      await endSession();
      const [origin, opened] = await Promise.all([
        loadCaptureShareOrigin(),
        openCaptureSession(),
      ]);
      const url = captureShareUrl(origin, opened.token);
      if (!url) {
        throw new Error(
          'This computer’s address is not reachable from a phone. Use the office app on this network, or take photos on this computer.'
        );
      }
      token = opened.token;
      await drawQr(url);
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
    const wanted = next === 'phone' ? 'phone' : 'computer';
    if (wanted === source && wanted === 'phone' && token) {
      paintSource();
      return;
    }
    source = wanted;
    paintSource();
    if (source === 'phone') {
      await startSession();
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
    startSession().catch((error) => {
      setPhoneStatus(error?.message || 'Could not make a new QR code.', 'error');
    });
  });

  function genieVisible() {
    const view = document.querySelector('#timecard-genie-view');
    return view instanceof HTMLElement && !view.hidden;
  }

  paintSource();
  if (genieVisible()) {
    setSource('phone').catch((error) => {
      setPhoneStatus(error?.message || 'Could not start phone capture.', 'error');
    });
  }

  return {
    pause() {
      stopPolling();
    },
    resume() {
      if (source !== 'phone') return;
      if (!token) {
        startSession().catch((error) => {
          setPhoneStatus(error?.message || 'Could not start phone capture.', 'error');
        });
        return;
      }
      if (pollTimer != null) return;
      pollTimer = setInterval(() => {
        pollOnce().catch(() => {});
      }, 1500);
      pollOnce().catch(() => {});
    },
    currentToken() {
      return token;
    },
    reset() {
      source = 'phone';
      paintSource();
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      endSession()
        .then(() => {
          if (genieVisible()) return startSession();
          setPhoneStatus('');
          return null;
        })
        .catch((error) => {
          setPhoneStatus(error?.message || 'Could not start phone capture.', 'error');
        });
    },
  };
}

/**
 * Toggle Tot. Hrs. between snapped clocks and exact-span quarter-hour rounding.
 * @param {{ mode: string, onChange: (mode: 'snap' | 'quarter') => void }} options
 */
function mountHoursModeControl({ mode, onChange }) {
  const root = document.querySelector('#timesheet-hours-mode');
  const buttons = root
    ? [...root.querySelectorAll('[data-hours-mode]')]
    : [];
  const headings = [
    document.querySelector('#timesheet-front-snap-heading'),
    document.querySelector('#timesheet-back-snap-heading'),
  ];
  const labels = [...document.querySelectorAll('[data-timesheet-hours-mode-label]')];

  function setMode(next, { save = true, notify = false } = {}) {
    const modeNext = normalizeTimesheetHoursMode(next);
    const title = HOURS_MODE_LABELS[modeNext];
    for (const button of buttons) {
      if (!(button instanceof HTMLButtonElement)) continue;
      button.setAttribute(
        'aria-pressed',
        button.dataset.hoursMode === modeNext ? 'true' : 'false'
      );
    }
    for (const heading of headings) {
      if (heading) heading.textContent = title;
    }
    for (const label of labels) {
      label.textContent = title;
    }
    if (save) {
      try {
        localStorage.setItem(HOURS_MODE_KEY, modeNext);
      } catch {
        /* Preference can stay for this visit only. */
      }
    }
    if (notify && typeof onChange === 'function') onChange(modeNext);
  }

  for (const button of buttons) {
    if (!(button instanceof HTMLButtonElement)) continue;
    button.addEventListener('click', () => {
      setMode(button.dataset.hoursMode, { notify: true });
    });
  }
  setMode(mode, { save: false });
  return { setMode: (next) => setMode(next, { save: true, notify: false }) };
}

/**
 * Keep firing while a nudge button is held, for fine matching against a paper card.
 * @param {HTMLButtonElement} button
 * @param {() => void} action
 */
function bindHoldRepeat(button, action) {
  let delay = null;
  let timer = null;
  const clear = () => {
    if (delay != null) clearTimeout(delay);
    if (timer != null) clearInterval(timer);
    delay = null;
    timer = null;
  };
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    action();
    delay = setTimeout(() => {
      timer = setInterval(action, 45);
    }, 320);
  });
  button.addEventListener('pointerup', clear);
  button.addEventListener('pointerleave', clear);
  button.addEventListener('pointercancel', clear);
  button.addEventListener('blur', clear);
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
  const parts = {
    month: stamp.querySelector('[data-part="month"]')?.value ?? '',
    day: stamp.querySelector('[data-part="day"]')?.value ?? '',
    period: stamp.querySelector('[data-part="period"]')?.value ?? '',
    time: stamp.querySelector('[data-part="time"]')?.value ?? '',
    illegible: false,
    handwriting: false,
  };
  row[`clock_${which}_raw`] = formatStampParts(parts);
  const isoDate = row[`clock_${which}_raw`]
    ? parseLegacyStampToDate(row[`clock_${which}_raw`], year)
    : null;
  row[`clock_${which}_iso`] = isoDate ? toLocalWallIso(isoDate) : null;
  row.crossed_out =
    isBlockedStampRaw(row.clock_out_raw) || isBlockedStampRaw(row.clock_in_raw);
}

/**
 * @param {Element | null} stamp
 * @param {string | null | undefined} raw
 */
function updateStampNote(stamp, raw) {
  if (!(stamp instanceof Element)) return;
  const note = stamp.querySelector('.timesheet-stamp-note');
  if (!(note instanceof HTMLElement)) return;
  const parts = parseStampParts(raw);
  if (parts.handwriting) {
    note.hidden = false;
    note.textContent = 'HANDWRITING';
  } else if (parts.illegible) {
    note.hidden = false;
    note.textContent = 'illegible';
  } else {
    note.hidden = true;
    note.textContent = '';
  }
}

/**
 * @param {HTMLTableRowElement} tr
 * @param {object} row
 */
function refreshRowState(tr, row) {
  const blank = !stampText(row.clock_out_raw) && !stampText(row.clock_in_raw);
  tr.classList.toggle('is-quiet', blank);
  tr.classList.toggle('is-crossed', Boolean(row.crossed_out));
  updateStampNote(tr.querySelector('[data-stamp="out"]'), row.clock_out_raw);
  updateStampNote(tr.querySelector('[data-stamp="in"]'), row.clock_in_raw);
}

/**
 * Narrow Description of Work cell: preview only; full edit opens in a dialog.
 * @param {string | null | undefined} value
 * @param {number} rowIndex
 */
function descriptionOpenHtml(value, rowIndex) {
  const text = String(value ?? '').trim();
  const empty = !text;
  const label = empty
    ? `Add Description of Work for row ${rowIndex}`
    : `Edit Description of Work for row ${rowIndex}`;
  return `<button type="button" class="timesheet-desc-open${empty ? ' is-empty' : ''}"
      aria-label="${escapeAttr(label)}" title="${escapeAttr(text || 'Description of Work')}">
      ${empty ? '+' : '✎'}
    </button>`;
}

/**
 * @param {{ getRows: (side: 'front' | 'back') => object[] | null | undefined }} options
 */
function mountDescriptionDialog({ getRows }) {
  const dialog = document.querySelector('#timesheet-desc-dialog');
  const title = document.querySelector('#timesheet-desc-title');
  const lead = document.querySelector('#timesheet-desc-lead');
  const textarea = document.querySelector('#timesheet-desc-text');
  const save = document.querySelector('#timesheet-desc-save');
  const cancel = document.querySelector('#timesheet-desc-cancel');
  if (
    !(dialog instanceof HTMLDialogElement) ||
    !(textarea instanceof HTMLTextAreaElement) ||
    !(save instanceof HTMLButtonElement) ||
    !(cancel instanceof HTMLButtonElement)
  ) {
    return { open() {}, close() {} };
  }

  /** @type {{ side: 'front' | 'back', index: number, button: HTMLButtonElement } | null} */
  let editing = null;

  function close() {
    if (dialog.open) dialog.close();
  }

  function applyPreview(button, value) {
    const text = String(value ?? '').trim();
    const empty = !text;
    button.classList.toggle('is-empty', empty);
    button.textContent = empty ? '+' : '✎';
    button.title = text || 'Description of Work';
    const rowIndex = Number(button.closest('tr[data-row-index]')?.dataset.rowIndex) || 0;
    button.setAttribute(
      'aria-label',
      empty
        ? `Add Description of Work for row ${rowIndex}`
        : `Edit Description of Work for row ${rowIndex}`
    );
  }

  function saveEdit() {
    if (!editing) {
      close();
      return;
    }
    const rows = getRows(editing.side);
    const row = Array.isArray(rows) ? rows[editing.index - 1] : null;
    const text = textarea.value.trim();
    if (row) row.description_of_work = text || null;
    applyPreview(editing.button, text);
    close();
  }

  cancel.addEventListener('click', close);
  save.addEventListener('click', saveEdit);
  dialog.addEventListener('close', () => {
    editing = null;
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveEdit();
    }
  });

  return {
    close,
    /**
     * @param {'front' | 'back'} side
     * @param {number} index
     * @param {HTMLButtonElement} button
     */
    open(side, index, button) {
      const rows = getRows(side);
      const row = Array.isArray(rows) ? rows[index - 1] : null;
      if (!row) return;
      editing = { side, index, button };
      const sideLabel = side === 'back' ? 'Back' : 'Front';
      if (title) title.textContent = 'Description of Work';
      if (lead) lead.textContent = `${sideLabel} card, row ${index}.`;
      textarea.value = String(row.description_of_work ?? '');
      if (!dialog.open) dialog.showModal();
      textarea.focus();
      textarea.select();
    },
  };
}

/**
 * Always show the four stamp fields. Illegible / HANDWRITING stay as a red note
 * in the cell margin so an admin can type a real stamp over them.
 * @param {'out' | 'in'} which
 * @param {string | null | undefined} raw
 * @param {number} rowIndex
 */
function stampEditorHtml(which, raw, rowIndex) {
  const label = which === 'out' ? 'Out' : 'In';
  const parts = parseStampParts(raw);
  const blocked = parts.handwriting || parts.illegible;
  const note = parts.handwriting ? 'HANDWRITING' : parts.illegible ? 'illegible' : '';
  const month = blocked ? '' : parts.month;
  const day = blocked ? '' : parts.day;
  const period = blocked ? '' : parts.period;
  const time = blocked ? '' : parts.time;
  return `<div class="timesheet-stamp timesheet-stamp-${which}" data-stamp="${which}">
    <span class="timesheet-card-label">${label}</span>
    <span class="timesheet-stamp-parts">
      <input class="timesheet-edit" data-part="month" type="text" maxlength="3"
        value="${escapeAttr(month)}" placeholder="oct" aria-label="${label} month row ${rowIndex}">
      <input class="timesheet-edit" data-part="day" type="text" maxlength="2"
        value="${escapeAttr(day)}" placeholder="7" aria-label="${label} day row ${rowIndex}">
      <input class="timesheet-edit" data-part="period" type="text" maxlength="2"
        value="${escapeAttr(period)}" placeholder="AM" aria-label="${label} AM or PM row ${rowIndex}">
      <input class="timesheet-edit" data-part="time" type="text" maxlength="5"
        value="${escapeAttr(time)}" placeholder="8:50" aria-label="${label} time row ${rowIndex}">
    </span>
    <span class="timesheet-stamp-note" ${note ? '' : 'hidden'}>${escapeHtml(note)}</span>
  </div>`;
}

function stampText(value) {
  const text = String(value ?? '').trim();
  return text || '';
}

function isBlockedStampRaw(value) {
  const text = String(value ?? '').trim();
  return /^illegible$/i.test(text) || /^handwriting$/i.test(text);
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
