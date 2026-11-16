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
  applyRunExtraTotals,
  contractRunParts,
  extractionRowLists,
  markContractHourRows,
  mergeSameDriverExtraction,
  parseStickerContractHours,
} from '../src/timesheetGenieCard.js';
import {
  normalizeTimesheetHoursMode,
  snapRoundedForRow,
  TIMESHEET_HOURS_MODE_QUARTER,
  TIMESHEET_HOURS_MODE_SNAP,
} from '../src/timesheetSnap.js';
import { DEFAULT_CONTRACT_SNAP_BREAKS } from '../../src/logic/timeUtils.js';
import { driverPhotoSrc } from './driverPhotos.js';
import QRCode from 'qrcode';
import {
  captureShareUrl,
  closeCaptureSession,
  rememberCaptureToken,
  rememberedCaptureToken,
  fetchCapturePhoto,
  loadCaptureShareOrigin,
  openCaptureSession,
  publishCaptureCards,
  readCaptureSession,
  restartCaptureSession,
} from './timesheetCaptureClient.js';
import {
  attachPrintHours,
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
import { noticeMailto } from '../src/noticeMail.js';
import {
  driverForTimecardName,
  isTimecardEmail,
  timecardCopyMail,
} from '../src/timesheetCopyMail.js';
import {
  clockRoundingMode,
  compareRouteNumbers,
  contractSnapBreaksFromState,
  driversFromState,
} from './store.js';
import {
  auditPayPeriodRules,
  auditSchoolYearLabel,
  defaultPayPeriodIso,
  parseCardPeriodEnd,
  payPeriodMismatchWarning,
  payPeriodsInSchoolYear,
} from '../src/auditPayPeriods.js';
import { isLocalGenieHost, localExampleGenieExtractions } from '../src/exampleGenieCards.js';
import {
  archiveCardsFromSession,
  emptyGenieCardArchive,
  genieScanBackupFilename,
  genieScanBackupHtml,
  loadGenieCardArchive,
  payPeriodSummarySnapshot,
  saveGenieCardArchive,
} from '../src/genieCardArchive.js';

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const CAMERA_KEY = 'teamster-timesheet-camera';
const ROW_HEIGHT_KEY = 'teamster-timesheet-row-height';
const HOURS_MODE_KEY = 'teamster-timesheet-hours-mode';
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
function shownSlotCount(rows) {
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * @param {{
 *   onCapture: (side: 'front' | 'back', file: File) => void,
 *   onSkip?: (side: 'front' | 'back') => void,
 *   onDismiss?: () => void,
 * }} options
 */
function mountTimesheetCamera({ onCapture, onSkip, onDismiss }) {
  const dialog = document.querySelector('#timesheet-camera');
  const video = document.querySelector('#timesheet-camera-video');
  const picker = document.querySelector('#timesheet-camera-picker');
  const deviceSelect = document.querySelector('#timesheet-camera-device');
  const cameraStatus = document.querySelector('#timesheet-camera-status');
  const shutter = document.querySelector('#timesheet-camera-shutter');
  const review = document.querySelector('#timesheet-camera-review');
  const retake = document.querySelector('#timesheet-camera-retake');
  const usePhoto = document.querySelector('#timesheet-camera-use');
  const skipSideBtn = document.querySelector('#timesheet-camera-skip');
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
  /** When true, accepting a front photo closes instead of flipping to the back. */
  let singleSide = false;
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
  skipSideBtn?.addEventListener('click', skipCurrentSide);
  document.querySelector('#timesheet-camera-cancel')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    stopStream();
    pendingFile = null;
    clearReviewImage();
    side = 'front';
    singleSide = false;
    paintStep('live');
    onDismiss?.();
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

  /**
   * @param {'front' | 'back'} nextSide
   * @param {{ single?: boolean }} [options]
   */
  async function open(nextSide, options = {}) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot use a camera.');
    }
    side = nextSide === 'back' ? 'back' : 'front';
    singleSide = options.single === true;
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
      } else if (side === 'front' && singleSide) {
        lead.textContent = 'Check the front. Retake it, or use this photo.';
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
      usePhoto.textContent =
        side === 'front' && !singleSide ? 'Take the back photo' : 'Use this photo';
      usePhoto.title =
        side === 'front' && !singleSide
          ? 'Keep this front photo and photograph the back.'
          : 'Keep this photo and add it to the card.';
    }
    if (skipSideBtn instanceof HTMLButtonElement) {
      skipSideBtn.hidden = singleSide;
      skipSideBtn.textContent = side === 'front' ? 'Skip front' : 'Skip back';
      skipSideBtn.title =
        side === 'front'
          ? 'Leave the front blank and photograph the back.'
          : 'Leave the back blank and finish with the front only.';
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

  function skipCurrentSide() {
    if (!dialog.open || singleSide) return;
    const skipped = side;
    pendingFile = null;
    clearReviewImage();
    if (skipped === 'front') {
      onSkip?.('front');
      side = 'back';
      paintStep('live');
      video.play().catch(() => {});
      if (!shutter.disabled) shutter.focus();
      return;
    }
    onSkip?.('back');
    dialog.close();
  }

  function acceptPhoto() {
    if (phase !== 'review' || !pendingFile || !dialog.open) return;
    const file = pendingFile;
    const accepted = side;
    pendingFile = null;
    onCapture(accepted, file);
    if (accepted === 'front' && !singleSide) {
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
  /**
   * In-memory batch of cards for this Genie visit.
   * @type {{
   *   id: string,
   *   printId: string,
   *   status: 'reading' | 'needs_review' | 'ready',
   *   extraction: object,
   *   updatedAt: number,
   *   frontFile?: File | null,
   *   backFile?: File | null,
   * }[]}
   */
  let sessionCards = [];
  /** @type {string} */
  let activeSessionId = '';
  /** Which face of the open card is on screen. */
  /** @type {'front' | 'back'} */
  let cardFace = 'front';
  /** Session card the face belongs to, so switching drivers starts on the front. */
  let cardFaceForId = '';
  /** Face for each extra physical card, keyed by card number. */
  /** @type {Record<string, 'front' | 'back'>} */
  let extraFaces = {};
  /** Which physical card (1 = front/back pair) is on screen for the open driver. */
  let physicalCardNumber = 1;
  /** Session card that physicalCardNumber belongs to. */
  let physicalCardForId = '';
  /** Pay period currently shown in the card carousel. */
  let carouselPeriodKey = '';
  /** When true, the carousel stays on the open card’s pay period. */
  let carouselFollowsActive = false;
  /** Session card whose timecard image is being prepared for email. */
  let mailingCardId = '';
  /** Print id for photos currently being collected (unique per card, not the phone QR token). */
  let activePrintId = '';
  /** Print id linked to the extraction on screen. */
  let linkedPrintId = '';
  /** Most recently completed print pair (may belong to the next unread photos). */
  let lastSavedPrintId = '';
  /** Block auto-read of the next card until the desk continues. */
  let awaitingReview = false;
  /** Desk camera skipped the front, so the back photo can be read alone. */
  let skippedFrontForThisCard = false;
  /** Read as soon as one side is present. Set when the other side was skipped. */
  let singleSideReady = false;
  /** Fold the next read into the driver card already on screen. */
  let pendingSameDriver = false;
  /** @type {Array<{ iso: string, label: string, key: string, id: string }>} */
  let payPeriodOptions = [];
  /** Avoid switching the open card again while a period change is already doing that. */
  let aligningDeskToPeriod = false;

  const camera = mountTimesheetCamera({
    onCapture: (side, file) => {
      if (side === 'back' && skippedFrontForThisCard) {
        skippedFrontForThisCard = false;
        singleSideReady = true;
      }
      setSideFile(side, file);
      setStatus('');
    },
    onSkip(side) {
      clearSideFile(side);
      if (side === 'front') {
        skippedFrontForThisCard = true;
        setStatus('Front skipped. Photograph the back, or skip that too if you already took a front.', '');
        return;
      }
      skippedFrontForThisCard = false;
      singleSideReady = true;
      maybeAutoRead();
    },
    onDismiss() {
      if (reading) return;
      const front = document.querySelector('#timesheet-front');
      const back = document.querySelector('#timesheet-back');
      const hasFront = front instanceof HTMLInputElement && Boolean(front.files?.[0]);
      const hasBack = back instanceof HTMLInputElement && Boolean(back.files?.[0]);
      if (!hasFront && !hasBack) pendingSameDriver = false;
    },
  });

  refreshPayPeriodOptions();
  const descDialog = mountDescriptionDialog({
    getRows(side, extraIndex = -1) {
      return rowsForSide(side, extraIndex);
    },
  });

  const sliceDialog = mountSliceDialog({
    getRows(side, extraIndex = -1) {
      return rowsForSide(side, extraIndex);
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
      paintCardSheet(frontCard, extraction.front_rows ?? [], shownSlotCount(extraction.front_rows), hoursMode);
      paintCardSheet(backCard, extraction.back_rows ?? [], shownSlotCount(extraction.back_rows), hoursMode);
      bindCardEditors(frontCard, extraction.front_rows, shownSlotCount(extraction.front_rows), {
        snapBody: frontSnap,
        breaks: snapBreaks(),
        getMode: () => hoursMode,
        onStampChange: refreshDerivedFromExtraction,
        onHoursChange: markAndPaintHourRows,
      });
      bindCardEditors(backCard, extraction.back_rows, shownSlotCount(extraction.back_rows), {
        snapBody: backSnap,
        breaks: snapBreaks(),
        getMode: () => hoursMode,
        onStampChange: refreshDerivedFromExtraction,
        onHoursChange: markAndPaintHourRows,
      });
      alignSnapRows(frontCard, frontSnap);
      alignSnapRows(backCard, backSnap);
      paintExtraSides();
      markAndPaintHourRows();
    },
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    readCard().catch((error) => setStatus(error.message || 'Could not read that card.', 'error'));
  });
  document.querySelector('#timesheet-clear')?.addEventListener('click', clearLiveCard);
  document.querySelector('#timesheet-session-clear')?.addEventListener('click', clearSession);
  document.querySelector('#timesheet-print-queue')?.addEventListener('click', openPrintQueue);
  document.querySelector('#timesheet-queue-close')?.addEventListener('click', () => {
    document.querySelector('#timesheet-queue-dialog')?.close();
  });
  document.querySelector('#timesheet-queue-print-range')?.addEventListener('click', () => {
    printQueuedRange().catch((error) => setQueueStatus(error?.message || 'Could not print that range.', 'error'));
  });
  document.querySelector('#timesheet-queue-print-selected')?.addEventListener('click', () => {
    printQueuedSelection().catch((error) => setQueueStatus(error?.message || 'Could not print that selection.', 'error'));
  });
  document.querySelector('#timesheet-queue-all')?.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    for (const box of document.querySelectorAll('#timesheet-queue-list input[data-queue-id]')) {
      if (box instanceof HTMLInputElement) box.checked = input.checked;
    }
  });
  document.querySelector('#timesheet-queue-list')?.addEventListener('change', () => {
    const boxes = [...document.querySelectorAll('#timesheet-queue-list input[data-queue-id]')];
    const selectAll = document.querySelector('#timesheet-queue-all');
    if (!(selectAll instanceof HTMLInputElement)) return;
    selectAll.checked =
      boxes.length > 0 && boxes.every((box) => box instanceof HTMLInputElement && box.checked);
  });
  const queueDialog = document.querySelector('#timesheet-queue-dialog');
  if (queueDialog instanceof HTMLDialogElement) {
    queueDialog.addEventListener('click', (event) => {
      if (event.target === queueDialog) queueDialog.close();
    });
  }
  document.querySelector('#timesheet-session-backup')?.addEventListener('click', backupAllScans);
  document.querySelector('#timesheet-carousel-period')?.addEventListener('change', (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    carouselFollowsActive = false;
    carouselPeriodKey = select.value;
    paintSessionChips();
  });
  document.querySelector('#timesheet-carousel-prev')?.addEventListener('click', () => {
    scrollSessionCarousel(-1);
  });
  document.querySelector('#timesheet-carousel-next')?.addEventListener('click', () => {
    scrollSessionCarousel(1);
  });
  document.querySelector('#timesheet-driver-card-prev')?.addEventListener('click', () => {
    stepDriverCard(-1);
  });
  document.querySelector('#timesheet-driver-card-next')?.addEventListener('click', () => {
    stepDriverCard(1);
  });
  document.querySelector('#timesheet-session-chips')?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const chip = target.closest('.timesheet-session-chip');
    if (!(chip instanceof HTMLElement)) return;
    const id = chip.dataset.sessionId || '';
    if (!id) return;
    if (target.closest('[data-chip-queue]')) {
      event.preventDefault();
      toggleChipQueue(id);
      return;
    }
    if (target.closest('[data-chip-print-single]')) {
      event.preventDefault();
      printSingleChip(id).catch((error) => {
        setStatus(error?.message || 'Could not print that card.', 'error');
      });
      return;
    }
    if (target.closest('[data-chip-email]')) {
      event.preventDefault();
      emailChipCopy(id).catch((error) => {
        setStatus(error?.message || 'Could not email that timecard.', 'error');
      });
      return;
    }
    if (target.closest('.timesheet-session-chip-open')) {
      selectSessionCard(id).catch((error) => {
        setStatus(error?.message || 'Could not open that card.', 'error');
      });
    }
  });
  document.querySelector('#timesheet-session-chips')?.addEventListener('scroll', syncCarouselNav, { passive: true });
  window.addEventListener('resize', syncCarouselNav);
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
      const frontFile = front instanceof HTMLInputElement ? front.files?.[0] || null : null;
      const backFile = back instanceof HTMLInputElement ? back.files?.[0] || null : null;
      const token =
        activePrintId ||
        (frontFile && backFile
          ? printIdForCapture()
          : linkedPrintId || lastSavedPrintId || '');
      return {
        token,
        front: frontFile,
        back: backFile,
      };
    },
    onCardSaved(id) {
      if (!id) return;
      lastSavedPrintId = id;
      if (activePrintId === id) activePrintId = '';
    },
    getSessionPrintIds() {
      const ids = [];
      for (const card of sessionCards) {
        if (card.printId) ids.push(card.printId);
        const extras = Array.isArray(card.extraction?.extra_sides) ? card.extraction.extra_sides : [];
        for (const side of extras) {
          if (side?.printId && !ids.includes(side.printId)) ids.push(side.printId);
        }
      }
      return ids;
    },
  });
  phoneCapture = mountPhoneCapture({
    setSideFile,
    setStatus,
    onPhonePhoto(side, file) {
      const id = printIdForCapture();
      printCopies.notePhoto(id, side, file).catch((error) => {
        setStatus(error?.message || 'Could not save that print copy.', 'error');
      });
    },
    onRetakePhoto(cardId, side, file, cardNumber) {
      applyPhoneRetake(cardId, side, file, cardNumber).catch((error) => {
        setStatus(error?.message || 'Could not apply that phone rescan.', 'error');
      });
    },
    getCarouselCards: phoneCarouselCards,
    onLink() {
      publishPhoneCarousel();
    },
    onCardReady(card) {
      acceptPhoneCard(card).catch((error) => {
        setStatus(error?.message || 'Could not read that phone card.', 'error');
      });
    },
  });

  /**
   * Phone rescan of one side for a card already on the desk.
   * Card 1 is the constructed card's own front and back. Later numbers are extra cards for that driver.
   * @param {string} cardId
   * @param {'front' | 'back'} side
   * @param {File} file
   * @param {number} [cardNumber]
   */
  async function applyPhoneRetake(cardId, side, file, cardNumber = 1) {
    const card = sessionCards.find((item) => item.id === cardId);
    if (!card) throw new Error('That scanned card is no longer in this session.');
    const physical = Number(cardNumber) > 1 ? Number(cardNumber) : 1;
    if (physical > 1) {
      await applyExtraCardRetake(card, side, file, physical);
      return;
    }
    const other = side === 'front' ? 'back' : 'front';
    const otherFile = other === 'front' ? card.frontFile : card.backFile;
    flushActiveSessionCard();
    activeSessionId = card.id;
    extraction = card.extraction;
    linkedPrintId = card.printId || '';
    awaitingReview = card.status === 'needs_review';
    if (otherFile) putSideFile(other, otherFile);
    else clearSideFile(other);
    putSideFile(side, file);
    if (!otherFile) singleSideReady = true;
    if (side === 'front') card.frontFile = file;
    else card.backFile = file;
    renderResult();
    paintSessionChips();
    await readCard({ replaceActive: true });
  }

  /**
   * Replace one side of an extra physical card and read that pair again.
   * @param {object} card
   * @param {'front' | 'back'} side
   * @param {File} file
   * @param {number} cardNumber
   */
  async function applyExtraCardRetake(card, side, file, cardNumber) {
    if (!card.extraction || typeof card.extraction !== 'object') {
      card.extraction = { header: blankCardHeader(), front_rows: [], back_rows: [], caveats: [], extra_sides: [] };
    }
    const extras = Array.isArray(card.extraction.extra_sides) ? card.extraction.extra_sides : [];
    card.extraction.extra_sides = extras;
    let target = extras.find((item) => Number(item?.card) === cardNumber && item?.side === side);
    if (!target) {
      target = { id: `extra-${cardNumber}-${side}`, card: cardNumber, side, rows: [] };
      extras.push(target);
    }
    target.file = file;
    const otherSide = side === 'front' ? 'back' : 'front';
    const other = extras.find((item) => Number(item?.card) === cardNumber && item?.side === otherSide);
    flushActiveSessionCard();
    activeSessionId = card.id;
    extraction = card.extraction;
    linkedPrintId = card.printId || '';
    focusCarouselOn(card);
    setStatus(`Re-reading card ${cardNumber} ${side}…`, '');
    const frontFile = side === 'front' ? file : other?.file || null;
    const backFile = side === 'back' ? file : other?.file || null;
    const response = await fetch('/api/timesheet-extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        front: frontFile ? await filePayload(frontFile) : null,
        back: backFile ? await filePayload(backFile) : null,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Could not read that card.');
    const next = payload.extraction;
    if (frontFile) {
      const frontExtra =
        extras.find((item) => Number(item?.card) === cardNumber && item?.side === 'front') || target;
      frontExtra.rows = Array.isArray(next?.front_rows) ? next.front_rows : frontExtra.rows || [];
      frontExtra.file = frontFile;
    }
    if (backFile && other) {
      other.rows = Array.isArray(next?.back_rows) ? next.back_rows : other.rows || [];
      other.file = backFile;
    }
    card.status = sessionCardNeedsReview(card.extraction) ? 'needs_review' : 'ready';
    card.updatedAt = Date.now();
    extraction = card.extraction;
    awaitingReview = card.status === 'needs_review';
    renderResult();
    paintCaveats(extraction);
    paintSessionChips();
    schedulePersistConstructedCards();
  }

  function printIdForCapture() {
    if (!activePrintId) activePrintId = mintPrintCardId();
    return activePrintId;
  }

  function activeSessionCard() {
    return sessionCards.find((card) => card.id === activeSessionId) || null;
  }

  async function ensurePrintCardFromFiles() {
    const front = document.querySelector('#timesheet-front');
    const back = document.querySelector('#timesheet-back');
    const frontFile = front instanceof HTMLInputElement ? front.files?.[0] : null;
    const backFile = back instanceof HTMLInputElement ? back.files?.[0] : null;
    if (!frontFile && !backFile) {
      return activeSessionCard()?.printId || linkedPrintId || lastSavedPrintId;
    }
    // Pair already saved for these photos — do not mint a second print id.
    if (lastSavedPrintId && !activePrintId) {
      linkedPrintId = lastSavedPrintId;
      return linkedPrintId;
    }
    const id = printIdForCapture();
    await printCopies.saveSides(id, frontFile, backFile);
    linkedPrintId = id;
    lastSavedPrintId = id;
    if (activePrintId === id) activePrintId = '';
    return id;
  }

  async function syncPrintHoursFromExtraction() {
    if (!extraction) return null;
    const id =
      activeSessionCard()?.printId ||
      linkedPrintId ||
      (await ensurePrintCardFromFiles().catch(() => lastSavedPrintId)) ||
      lastSavedPrintId;
    if (!id) return null;
    linkedPrintId = id;
    const active = activeSessionCard();
    if (active) active.printId = id;
    return printCopies.syncHours(id, extraction);
  }

  function downloadBlobFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function openCardMailto(mail) {
    const link = document.createElement('a');
    link.href = noticeMailto(mail);
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  }

  function explainTimecardDownload(filename) {
    const dialog = document.querySelector('#notice-download-dialog');
    const message = document.querySelector('#notice-download-message');
    const title = document.querySelector('#notice-download-title');
    if (!(dialog instanceof HTMLDialogElement) || !(message instanceof HTMLElement)) return;
    if (title instanceof HTMLElement) title.textContent = 'Attach the timecard';
    message.textContent = `Please look for ${filename} in your downloads folder and attach it.`;
    if (!dialog.open) dialog.showModal();
  }

  async function printRecordsForCard(card) {
    /** @type {{ id: string, extraction: object }[]} */
    const jobs = [];
    const seen = new Set();
    const header = card?.extraction?.header || null;
    const add = (id, extraction) => {
      const key = String(id || '').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      jobs.push({ id: key, extraction });
    };
    add(card?.printId, {
      header,
      front_rows: card?.extraction?.front_rows,
      back_rows: card?.extraction?.back_rows,
    });
    /** @type {Map<string, object>} */
    const extras = new Map();
    for (const side of Array.isArray(card?.extraction?.extra_sides) ? card.extraction.extra_sides : []) {
      const id = String(side?.printId || '').trim();
      if (!id) continue;
      const bucket = extras.get(id) || { header, front_rows: null, back_rows: null };
      if (side?.side === 'back') bucket.back_rows = side.rows;
      else bucket.front_rows = side.rows;
      extras.set(id, bucket);
    }
    for (const [id, extraction] of extras) add(id, extraction);
    if (!jobs.length) {
      const wanted = String(header?.employee_name || '').trim().toLowerCase();
      if (wanted) {
        const all = await listPrintCards();
        const match = all.filter((item) => String(item?.driverName || '').trim().toLowerCase() === wanted).at(-1);
        if (match?.id) {
          card.printId = match.id;
          add(match.id, {
            header,
            front_rows: card?.extraction?.front_rows,
            back_rows: card?.extraction?.back_rows,
          });
        }
      }
    }
    /** @type {object[]} */
    const records = [];
    for (const job of jobs) {
      const saved = await attachPrintHours(job.id, job.extraction);
      if (saved?.front || saved?.back) records.push(saved);
    }
    return records;
  }

  async function emailChipCopy(id) {
    const card = sessionCards.find((item) => item.id === id);
    if (!card || mailingCardId) return false;
    if (card.status === 'reading') {
      setStatus('That card is still being read.', 'error');
      return false;
    }
    if (card.id === activeSessionId) flushActiveSessionCard();
    const name = sessionCardDriverName(card.extraction, Math.max(0, sessionCards.indexOf(card)));
    const driver = driverForTimecardName(driversFromState(officeState()), card.extraction?.header?.employee_name);
    const email = String(driver?.email || '').trim();
    if (!isTimecardEmail(email)) {
      setStatus(`Add an email for ${name} on the Driver Name List before sending a timecard.`, 'error');
      return false;
    }
    mailingCardId = card.id;
    paintSessionChips();
    try {
      const records = await printRecordsForCard(card);
      if (!records.length) {
        setStatus(`There is no scan photo for ${name} in this browser, so there is no timecard image to send.`, 'error');
        return false;
      }
      setBusyStatus('Preparing the timecard image…');
      const result = await buildPrintPdfBlob(records);
      const mail = timecardCopyMail({ to: email, driverName: driver?.name || name });
      downloadBlobFile(result.blob, mail.filename);
      openCardMailto(mail);
      explainTimecardDownload(mail.filename);
      const warning = Array.isArray(result?.warnings) && result.warnings[0] ? ` ${result.warnings[0]}` : '';
      setStatus(`Email is open for ${name}. Attach ${mail.filename} from your downloads.${warning}`, 'ok');
      return true;
    } catch (error) {
      setStatus(error?.message || 'Could not email that timecard.', 'error');
      return false;
    } finally {
      mailingCardId = '';
      paintSessionChips();
    }
  }

  function toggleChipQueue(id) {
    const card = sessionCards.find((item) => item.id === id);
    if (!card || card.status === 'reading') return;
    const name = sessionCardDriverName(card.extraction, Math.max(0, sessionCards.indexOf(card)));
    if (card.printQueued === true) {
      card.printQueued = false;
      card.printQueuedAt = 0;
      setStatus(`${name} removed from the print queue.`, 'ok');
    } else {
      card.printQueued = true;
      card.printQueuedAt = Date.now();
      setStatus(`${name} added to the print queue.`, 'ok');
    }
    schedulePersistConstructedCards();
    paintSessionChips();
    const dialog = document.querySelector('#timesheet-queue-dialog');
    if (dialog instanceof HTMLDialogElement && dialog.open) paintPrintQueue();
  }

  /**
   * @param {object[]} cards
   */
  async function printCopiesForSessionCards(cards) {
    /** @type {object[]} */
    const records = [];
    /** @type {string[]} */
    const missing = [];
    for (const card of cards) {
      if (card?.id === activeSessionId) flushActiveSessionCard();
      const name = sessionCardDriverName(card?.extraction, Math.max(0, sessionCards.indexOf(card)));
      const found = await printRecordsForCard(card);
      if (!found.length) missing.push(name);
      else records.push(...found);
    }
    return { records, missing };
  }

  /**
   * @param {object[]} cards
   * @param {(message: string, kind?: string) => void} report
   */
  async function printSessionCardCopies(cards, report) {
    if (!cards.length) {
      report('Choose at least one employee square.', 'error');
      return;
    }
    report('Preparing the print job…', '');
    const { records, missing } = await printCopiesForSessionCards(cards);
    if (!records.length) {
      report(
        missing.length === 1
          ? `There is no scan photo for ${missing[0]} in this browser, so there is no card copy to print.`
          : 'None of those squares have a scan photo in this browser yet.',
        'error'
      );
      return;
    }
    const result = await buildPrintPdfBlob(records);
    printPdfBlob(result.blob || result);
    const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
    const skipped = missing.length
      ? ` ${missing.length === 1 ? `${missing[0]} has no scan photo.` : `${missing.length} squares have no scan photo.`}`
      : '';
    const extra = warnings[0] ? ` ${warnings[0]}` : '';
    report(
      `${records.length === 1 ? 'Printing 1 card copy.' : `Printing ${records.length} card copies.`}${skipped}${extra}`,
      missing.length || warnings.length ? 'error' : 'ok'
    );
  }

  async function printSingleChip(id) {
    const card = sessionCards.find((item) => item.id === id);
    if (!card || mailingCardId) return;
    if (card.status === 'reading') {
      setStatus('That card is still being read.', 'error');
      return;
    }
    mailingCardId = card.id;
    paintSessionChips();
    try {
      await printSessionCardCopies([card], setStatus);
    } finally {
      mailingCardId = '';
      paintSessionChips();
    }
  }

  function queuedForOpenPeriod() {
    return queuedCardsInPeriod(sessionCards, carouselPeriodKey);
  }

  function setQueueStatus(message, kind = '') {
    const status = document.querySelector('#timesheet-queue-status');
    if (!(status instanceof HTMLElement)) return;
    status.hidden = !message;
    status.textContent = message || '';
    status.className = kind ? `status is-${kind}` : 'status';
  }

  function paintPrintQueue() {
    const lead = document.querySelector('#timesheet-queue-lead');
    const list = document.querySelector('#timesheet-queue-list');
    const fromInput = document.querySelector('#timesheet-queue-from');
    const toInput = document.querySelector('#timesheet-queue-to');
    const selectAll = document.querySelector('#timesheet-queue-all');
    if (!(list instanceof HTMLElement)) return;
    const queued = queuedForOpenPeriod();
    const periodLabel =
      document.querySelector('#timesheet-carousel-period') instanceof HTMLSelectElement
        ? document.querySelector('#timesheet-carousel-period').selectedOptions[0]?.textContent || 'this pay period'
        : 'this pay period';
    if (lead instanceof HTMLElement) {
      lead.textContent = queued.length
        ? `${queued.length} employee square${queued.length === 1 ? '' : 's'} for ${periodLabel}. Print a numbered range, or check the ones you want.`
        : `No employee squares are in the queue for ${periodLabel}. Use + queue on a square to add one.`;
    }
    list.replaceChildren();
    if (!queued.length) return;
    const ol = document.createElement('ol');
    ol.className = 'timesheet-queue-cards';
    queued.forEach((card, index) => {
      const item = document.createElement('li');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.dataset.queueId = card.id;
      check.checked = true;
      check.setAttribute('aria-label', `Select ${sessionCardDriverName(card.extraction, index)}`);
      const name = sessionCardDriverName(card.extraction, Math.max(0, sessionCards.indexOf(card)));
      const label = document.createElement('span');
      label.textContent = `${index + 1}. ${name}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary timesheet-queue-remove';
      remove.innerHTML =
        '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg><span>Remove</span>';
      remove.title = 'Take this employee square out of the print queue.';
      remove.addEventListener('click', () => toggleChipQueue(card.id));
      item.append(check, label, remove);
      ol.append(item);
    });
    list.append(ol);
    if (fromInput instanceof HTMLInputElement) fromInput.value = '1';
    if (toInput instanceof HTMLInputElement) {
      toInput.value = String(queued.length);
      toInput.max = String(queued.length);
    }
    if (fromInput instanceof HTMLInputElement) fromInput.max = String(queued.length);
    if (selectAll instanceof HTMLInputElement) selectAll.checked = true;
  }

  function openPrintQueue() {
    const dialog = document.querySelector('#timesheet-queue-dialog');
    if (!(dialog instanceof HTMLDialogElement)) return;
    setQueueStatus('');
    paintPrintQueue();
    if (!dialog.open) dialog.showModal();
  }

  async function printQueuedRange() {
    const queued = queuedForOpenPeriod();
    const fromInput = document.querySelector('#timesheet-queue-from');
    const toInput = document.querySelector('#timesheet-queue-to');
    const from = Math.max(1, Number(fromInput instanceof HTMLInputElement ? fromInput.value : 1) || 1);
    const to = Math.min(
      queued.length,
      Math.max(from, Number(toInput instanceof HTMLInputElement ? toInput.value : from) || from)
    );
    await printSessionCardCopies(queued.slice(from - 1, to), setQueueStatus);
  }

  async function printQueuedSelection() {
    const queued = queuedForOpenPeriod();
    const chosen = new Set(
      [...document.querySelectorAll('#timesheet-queue-list input[data-queue-id]:checked')].map((box) =>
        box instanceof HTMLInputElement ? box.dataset.queueId : ''
      )
    );
    await printSessionCardCopies(
      queued.filter((card) => chosen.has(card.id)),
      setQueueStatus
    );
  }

  function phoneCarouselCards() {
    const periods = carouselPayPeriods(sessionCards, payPeriodOptions);
    const labels = new Map(periods.map((period) => [period.key, period.label]));
    /** @type {object[]} */
    const out = [];
    sessionCards.forEach((card, index) => {
      const employee = sessionCardDriverName(card.extraction, index);
      const periodKey = carouselPeriodKeyForCard(card);
      const present = card.extraction?.sides_present;
      const base = {
        id: card.id,
        name: employee,
        employee,
        periodKey,
        periodLabel: labels.get(periodKey) || periodKey,
        status: card.status,
      };
      out.push({
        ...base,
        card: 1,
        front: present ? present.front !== false : Boolean(card.frontFile) || card.example === true,
        back: present ? present.back !== false : Boolean(card.backFile) || card.example === true,
      });
      const extras = Array.isArray(card.extraction?.extra_sides) ? card.extraction.extra_sides : [];
      /** @type {Map<number, { front: boolean, back: boolean }>} */
      const byCard = new Map();
      for (const extra of extras) {
        const number = Number(extra?.card) || 0;
        if (number < 2) continue;
        const sides = byCard.get(number) || { front: false, back: false };
        if (extra?.side === 'back') sides.back = true;
        else sides.front = true;
        byCard.set(number, sides);
      }
      for (const [number, sides] of [...byCard.entries()].sort((a, b) => a[0] - b[0])) {
        out.push({ ...base, card: number, front: sides.front, back: sides.back });
      }
    });
    return out;
  }

  function publishPhoneCarousel() {
    const link = phoneCapture?.currentToken?.() || '';
    if (!link) return;
    publishCaptureCards(link, phoneCarouselCards()).catch(() => null);
  }

  function focusCarouselOn(card) {
    carouselFollowsActive = true;
    const key = carouselPeriodKeyForCard(card);
    if (key) carouselPeriodKey = key;
  }

  function paintCarouselPeriodSelect(periods) {
    const select = document.querySelector('#timesheet-carousel-period');
    if (!(select instanceof HTMLSelectElement)) return;
    const same =
      select.options.length === periods.length &&
      periods.every(
        (period, index) =>
          select.options[index]?.value === period.key && select.options[index]?.textContent === period.label
      );
    if (!same) {
      select.replaceChildren(
        ...periods.map((period) => {
          const option = document.createElement('option');
          option.value = period.key;
          option.textContent = period.label;
          return option;
        })
      );
    }
    if (carouselPeriodKey && periods.some((period) => period.key === carouselPeriodKey)) {
      select.value = carouselPeriodKey;
    }
  }

  function scrollSessionCarousel(direction) {
    const chips = document.querySelector('#timesheet-session-chips');
    if (!(chips instanceof HTMLElement)) return;
    const first = chips.querySelector('.timesheet-session-chip');
    const chipWidth = first instanceof HTMLElement ? first.getBoundingClientRect().width : 0;
    const gap = chipWidth ? Math.max(0, (chips.scrollWidth - chipWidth * chips.childElementCount) / Math.max(1, chips.childElementCount - 1)) : 0;
    const page = Math.max(chipWidth + gap, chips.clientWidth - chipWidth);
    chips.scrollBy({ left: direction * page, behavior: 'smooth' });
  }

  function revealActiveChip(chips) {
    const active = chips.querySelector('.timesheet-session-chip.is-active');
    if (!(active instanceof HTMLElement)) return;
    const chipsRect = chips.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    if (rect.left < chipsRect.left) chips.scrollLeft -= chipsRect.left - rect.left;
    else if (rect.right > chipsRect.right) chips.scrollLeft += rect.right - chipsRect.right;
  }

  function syncCarouselNav() {
    const chips = document.querySelector('#timesheet-session-chips');
    const prev = document.querySelector('#timesheet-carousel-prev');
    const next = document.querySelector('#timesheet-carousel-next');
    if (!(chips instanceof HTMLElement)) return;
    const max = chips.scrollWidth - chips.clientWidth;
    const atStart = chips.scrollLeft <= 1;
    const atEnd = chips.scrollLeft >= max - 1;
    if (prev instanceof HTMLButtonElement) prev.disabled = max <= 1 || atStart;
    if (next instanceof HTMLButtonElement) next.disabled = max <= 1 || atEnd;
  }

  function paintSessionChips() {
    const root = document.querySelector('#timesheet-session');
    const chips = document.querySelector('#timesheet-session-chips');
    const label = document.querySelector('#timesheet-session-label');
    if (!(root instanceof HTMLElement) || !(chips instanceof HTMLElement)) return;
    const periods = carouselPayPeriods(sessionCards, payPeriodOptions);
    root.hidden = periods.length === 0;
    if (label instanceof HTMLElement) label.textContent = 'All pay periods';
    if (carouselFollowsActive) {
      const activeKey = carouselPeriodKeyForCard(activeSessionCard());
      if (activeKey && periods.some((period) => period.key === activeKey)) carouselPeriodKey = activeKey;
    }
    if (!periods.some((period) => period.key === carouselPeriodKey)) {
      const iso = defaultPayPeriodIso(periods);
      carouselPeriodKey = periods.find((period) => period.key === iso)?.key || '';
    }
    paintCarouselPeriodSelect(periods);
    const visible = cardsInCarouselPeriod(sessionCards, carouselPeriodKey);
    if (
      !aligningDeskToPeriod &&
      visible.length &&
      activeSessionId &&
      !visible.some((card) => card.id === activeSessionId)
    ) {
      aligningDeskToPeriod = true;
      try {
        selectSessionCard(visible[0].id);
      } finally {
        aligningDeskToPeriod = false;
      }
      return;
    }
    const queueCount = queuedCardsInPeriod(visible, carouselPeriodKey).length;
    const queueCountEl = document.querySelector('#timesheet-print-queue-count');
    const queueBtn = document.querySelector('#timesheet-print-queue');
    if (queueCountEl) queueCountEl.textContent = String(queueCount);
    if (queueBtn instanceof HTMLButtonElement) {
      queueBtn.classList.toggle('has-queued', queueCount > 0);
      queueBtn.setAttribute(
        'aria-label',
        `Print queue, ${queueCount} employee square${queueCount === 1 ? '' : 's'} in this pay period`
      );
      queueBtn.title = `Open the employee squares marked for printing. ${queueCount} ${queueCount === 1 ? 'is' : 'are'} in this pay period.`;
    }
    chips.replaceChildren();
    visible.forEach((card, index) => {
      const chip = document.createElement('div');
      chip.className = 'timesheet-session-chip';
      chip.dataset.sessionId = card.id;
      if (card.id === activeSessionId) {
        chip.classList.add('is-active');
        chip.setAttribute('aria-current', 'true');
      }
      if (card.status === 'needs_review') {
        chip.classList.add('is-needs-review');
        const alert = document.createElement('span');
        alert.className = 'timesheet-session-chip-alert';
        alert.title = 'Needs review';
        alert.setAttribute('aria-hidden', 'true');
        alert.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#d31b1b"/><path d="M12 6.4v7.2" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.35" fill="#fff"/></svg>';
        chip.append(alert);
      }
      if (card.status === 'reading') chip.classList.add('is-reading');
      if (card.id === mailingCardId) chip.setAttribute('aria-busy', 'true');
      const statusLabel =
        card.status === 'needs_review'
          ? 'Needs review'
          : card.status === 'reading'
            ? 'Reading…'
            : 'Ready';
      const name = sessionCardDriverName(card.extraction, index);
      const parts = driverNameParts(name);
      const side = sessionSideNote(card);
      const queued = card.printQueued === true;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'timesheet-session-chip-open';
      open.title = `Open this constructed card. ${name}${side}. ${statusLabel}.`;
      open.setAttribute('aria-label', `${name}${side}. ${statusLabel}.`);
      const nameEl = document.createElement('span');
      nameEl.className = 'timesheet-session-chip-name';
      const last = document.createElement('span');
      last.className = 'timesheet-session-chip-last';
      last.textContent = parts.last;
      nameEl.append(last);
      if (parts.first) {
        const first = document.createElement('span');
        first.className = 'timesheet-session-chip-first';
        first.textContent = parts.first;
        nameEl.append(first);
      }
      const photoSrc = driverPhotoSrc(name);
      if (photoSrc) {
        const photo = document.createElement('img');
        photo.className = 'timesheet-session-chip-photo';
        photo.alt = '';
        photo.src = photoSrc;
        photo.addEventListener('error', () => {
          photo.remove();
          open.classList.remove('has-photo');
        });
        open.classList.add('has-photo');
        open.append(photo);
      }
      open.append(nameEl);
      const actions = document.createElement('div');
      actions.className = 'timesheet-session-chip-actions';
      const queueBtn = document.createElement('button');
      queueBtn.type = 'button';
      queueBtn.className = 'timesheet-chip-action timesheet-chip-queue';
      queueBtn.dataset.chipQueue = 'true';
      queueBtn.textContent = queued ? 'In queue' : '+ queue';
      queueBtn.setAttribute('aria-pressed', queued ? 'true' : 'false');
      queueBtn.title = queued
        ? `Take ${name} out of the print queue for this pay period.`
        : `Add ${name} to the print queue for this pay period.`;
      queueBtn.setAttribute('aria-label', queued ? `Remove ${name} from the print queue` : `Add ${name} to the print queue`);
      const printBtn = document.createElement('button');
      printBtn.type = 'button';
      printBtn.className = 'timesheet-chip-action timesheet-chip-print';
      printBtn.dataset.chipPrintSingle = 'true';
      printBtn.textContent = 'Print single';
      printBtn.title = `Print ${name}'s card by itself, front and back as separate pages.`;
      printBtn.setAttribute('aria-label', `Print single card for ${name}`);
      const emailBtn = document.createElement('button');
      emailBtn.type = 'button';
      emailBtn.className = 'timesheet-chip-action timesheet-chip-email';
      emailBtn.dataset.chipEmail = 'true';
      emailBtn.textContent = 'Email copies';
      emailBtn.title = `Email ${name} the pay-period copies for this card.`;
      emailBtn.setAttribute('aria-label', `Email copies to ${name}`);
      const busy = card.id === mailingCardId || card.status === 'reading';
      queueBtn.disabled = busy;
      printBtn.disabled = busy;
      emailBtn.disabled = busy;
      const printRow = document.createElement('div');
      printRow.className = 'timesheet-chip-print-row';
      printRow.append(queueBtn, printBtn);
      actions.append(printRow, emailBtn);
      chip.append(open, actions);
      chips.append(chip);
    });
    publishPhoneCarousel();
    requestAnimationFrame(() => {
      revealActiveChip(chips);
      syncCarouselNav();
    });
  }

  function flushActiveSessionCard() {
    if (!extraction || !activeSessionId) return;
    const card = activeSessionCard();
    if (!card) return;
    card.extraction = extraction;
    card.printId = card.printId || linkedPrintId || lastSavedPrintId || '';
    card.status = sessionCardNeedsReview(extraction) ? 'needs_review' : 'ready';
    card.updatedAt = Date.now();
    rememberCardSummary(card);
    schedulePersistConstructedCards();
    syncPrintHoursFromExtraction().catch(() => null);
  }

  function clearCaptureFilesOnly() {
    const front = document.querySelector('#timesheet-front');
    const back = document.querySelector('#timesheet-back');
    if (front instanceof HTMLInputElement) front.value = '';
    if (back instanceof HTMLInputElement) back.value = '';
    activePrintId = '';
  }

  async function selectSessionCard(sessionId) {
    const target = sessionCards.find((card) => card.id === sessionId);
    if (!target) return;
    if (target.id === activeSessionId) return;
    flushActiveSessionCard();
    activeSessionId = target.id;
    focusCarouselOn(target);
    extraction = target.extraction;
    linkedPrintId = target.printId || '';
    awaitingReview = target.status === 'needs_review';
    renderResult();
    paintSessionChips();
    paintCaveats(extraction);
    setStatus(awaitingReview ? 'This card needs a look before you rely on the hours.' : '', awaitingReview ? 'error' : '');
  }

  function upsertSessionFromExtraction(nextExtraction, printId) {
    const needsReview = sessionCardNeedsReview(nextExtraction);
    const status = needsReview ? 'needs_review' : 'ready';
    let card = activeSessionCard();
    if (!card || card.status !== 'reading') {
      card = {
        id: `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        printId: printId || '',
        status,
        extraction: nextExtraction,
        updatedAt: Date.now(),
      };
      sessionCards.push(card);
    } else {
      card.extraction = nextExtraction;
      card.printId = printId || card.printId || '';
      card.status = status;
      card.updatedAt = Date.now();
    }
    activeSessionId = card.id;
    linkedPrintId = card.printId || linkedPrintId;
    awaitingReview = needsReview;
    focusCarouselOn(card);
    rememberCardSummary(card);
    schedulePersistConstructedCards();
    paintSessionChips();
    return card;
  }

  function selectedPayPeriodIso() {
    const key = String(carouselPeriodKey || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '';
  }

  function refreshPayPeriodOptions() {
    const state = officeState();
    const label = auditSchoolYearLabel(state);
    payPeriodOptions = payPeriodsInSchoolYear(label, auditPayPeriodRules(state));
    const yearSelect = document.querySelector('#timesheet-school-year');
    if (yearSelect instanceof HTMLSelectElement && label) {
      let option = yearSelect.options[0];
      if (!(option instanceof HTMLOptionElement)) {
        option = document.createElement('option');
        yearSelect.append(option);
      }
      option.value = label;
      option.textContent = label;
      yearSelect.value = label;
    }
  }

  function paintPeriodMismatch(nextExtraction) {
    const box = document.querySelector('#timesheet-period-mismatch');
    if (!(box instanceof HTMLElement)) return;
    const warning = payPeriodMismatchWarning(
      selectedPayPeriodIso(),
      nextExtraction?.header?.date_on_card,
      payPeriodOptions
    );
    box.hidden = !warning;
    box.textContent = warning || '';
  }

  function paintCaveats(nextExtraction) {
    const caveats = document.querySelector('#timesheet-caveats');
    if (!(caveats instanceof HTMLElement)) return;
    const lines = [];
    if (Array.isArray(nextExtraction?.caveats)) {
      for (const line of nextExtraction.caveats) {
        const text = String(line || '').trim();
        if (text) lines.push(text);
      }
    }
    if (hasIllegibleClockStamps(nextExtraction)) {
      lines.push('Some Clock Record stamps could not be read — type over illegible values.');
    }
    if (parseStickerContractHours(nextExtraction?.header?.contract_hours) == null) {
      lines.push('Contract hours are missing — type the sticker contract if you know it.');
    }
    const rows = extractionRowLists(nextExtraction).flat();
    if (rows.some((row) => row?.hours_add_up === false)) {
      lines.push('Red rows are hours that do not add up for that sticker contract.');
    }
    const periodWarning = payPeriodMismatchWarning(
      selectedPayPeriodIso(),
      nextExtraction?.header?.date_on_card,
      payPeriodOptions
    );
    if (periodWarning) lines.push(periodWarning);
    caveats.hidden = lines.length === 0;
    caveats.textContent = lines.join(' ');
    paintPeriodMismatch(nextExtraction);
  }

  function clearSession() {
    if (!sessionCards.length) {
      clearLiveCard();
      return;
    }
    const ok = window.confirm(
      'Clear every constructed card saved in this browser? Pay period summaries are removed too. Print copies stay until you remove them.'
    );
    if (!ok) return;
    sessionCards = [];
    activeSessionId = '';
    awaitingReview = false;
    clearLiveCard();
    persistConstructedCards();
    seedLocalExampleCards();
  }

  new MutationObserver(() => {
    if (view.hidden) {
      camera.close();
      descDialog.close();
      sliceDialog.close();
      document.querySelector('#timesheet-delete-side-dialog')?.close();
      printCopies.close();
      phoneCapture.pause();
      return;
    }
    phoneCapture.resume();
  }).observe(view, { attributes: true, attributeFilter: ['hidden'] });

  document.querySelector('#timesheet-cards')?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const faceButton = target.closest('.timesheet-face-toggle-btn');
    if (faceButton instanceof HTMLButtonElement) {
      const want = faceButton.dataset.face === 'back' ? 'back' : 'front';
      showConstructedFace(faceButton.closest('.timesheet-card-pair'), want);
      return;
    }
    const deleteSideButton = target.closest('.timesheet-delete-side');
    if (deleteSideButton instanceof HTMLButtonElement) {
      openDeleteSideDialog(deleteSideButton.closest('.timesheet-card-pair'));
      return;
    }
    const pair = target.closest('.timesheet-card-pair');
    const tr = target.closest('tr[data-row-index]');
    if (!pair || !tr) return;
    const side = pair.getAttribute('data-side') === 'back' ? 'back' : 'front';
    const extraIndex = pair.hasAttribute('data-extra-index') ? Number(pair.dataset.extraIndex) : -1;
    const index = Number(tr.dataset.rowIndex) || 0;
    const rows =
      extraIndex >= 0
        ? extraction?.extra_sides?.[extraIndex]?.rows
        : side === 'back'
          ? extraction?.back_rows
          : extraction?.front_rows;
    const row = Array.isArray(rows) ? rows[index - 1] : null;

    const descButton = target.closest('.timesheet-desc-open');
    if (descButton instanceof HTMLButtonElement) {
      descDialog.open(side, index, descButton, extraIndex);
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
      sliceDialog.open(side, index, extraIndex);
    }
  });

  mountRowHeightControl({
    cards: document.querySelector('#timesheet-cards'),
    realign() {
      if (result.hidden) return;
      alignSnapRows(frontCard, frontSnap);
      alignSnapRows(backCard, backSnap);
      eachExtraSide((pair) => {
        alignSnapRows(
          pair.querySelector('.timesheet-card-sheet tbody'),
          pair.querySelector('.timesheet-snap-sheet tbody')
        );
      });
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
      flushActiveSessionCard();
      paintCaveats(extraction);
      paintSessionChips();
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
    refreshPayPeriodOptions();
    paintSessionChips();
    if (extraction) {
      renderResult();
      paintCaveats(extraction);
    } else {
      paintPeriodMismatch(null);
    }
  }

  function contractHourOptions() {
    const state = officeState() || {};
    return {
      breaks: snapBreaks(),
      rules: state.overtimeRules,
      holidays: holidayListForState(state),
      defaultYear: inferDefaultYear(extraction?.header?.date_on_card),
      mode: hoursMode,
      moreRows: (Array.isArray(extraction?.extra_sides) ? extraction.extra_sides : [])
        .map((side) => side?.rows)
        .filter(Array.isArray),
      contractRuns: extraction?.header || null,
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
    const runExtras = Boolean(contractRunParts(extraction.header));
    paintRegOtFields(frontCard, extraction.front_rows);
    paintRegOtFields(backCard, extraction.back_rows);
    paintTotHourFields(frontCard, extraction.front_rows, runExtras);
    paintTotHourFields(backCard, extraction.back_rows, runExtras);
    eachExtraSide((pair, extra) => {
      const body = pair.querySelector('.timesheet-card-sheet tbody');
      paintRegOtFields(body, extra.rows);
      paintTotHourFields(body, extra.rows, runExtras);
    });
    syncPrintHoursFromExtraction().catch(() => {
      /* Print copy may not exist yet for this session. */
    });
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
    eachExtraSide((pair, extra) => {
      paintHourFlags(pair.querySelector('.timesheet-card-sheet tbody'), extra.rows);
    });
    const card = activeSessionCard();
    if (card && card.extraction === extraction) {
      card.status = sessionCardNeedsReview(extraction) ? 'needs_review' : 'ready';
      card.updatedAt = Date.now();
      schedulePersistConstructedCards();
      paintCaveats(extraction);
      paintSessionChips();
    }
  }

  function refreshDerivedFromExtraction() {
    if (!extraction) return;
    const breaks = snapBreaks();
    const mode = hoursMode;
    hoursModeControl.setMode(mode);
    applySnapDerivedFields(extraction.front_rows, shownSlotCount(extraction.front_rows), breaks, frontCard, mode);
    applySnapDerivedFields(extraction.back_rows, shownSlotCount(extraction.back_rows), breaks, backCard, mode);
    applyContractDerivedFields();
    markAndPaintHourRows();
    paintSnapSheet(frontSnap, extraction.front_rows ?? [], shownSlotCount(extraction.front_rows), breaks, mode);
    paintSnapSheet(backSnap, extraction.back_rows ?? [], shownSlotCount(extraction.back_rows), breaks, mode);
    alignSnapRows(frontCard, frontSnap);
    alignSnapRows(backCard, backSnap);
    eachExtraSide((pair, extra) => {
      const slotCount = shownSlotCount(extra.rows);
      applySnapDerivedFields(
        extra.rows,
        slotCount,
        breaks,
        pair.querySelector('.timesheet-card-sheet tbody'),
        mode
      );
      paintSnapSheet(
        pair.querySelector('.timesheet-snap-sheet tbody'),
        extra.rows,
        slotCount,
        breaks,
        mode
      );
      alignSnapRows(
        pair.querySelector('.timesheet-card-sheet tbody'),
        pair.querySelector('.timesheet-snap-sheet tbody')
      );
    });
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
    paintCardSheet(frontCard, extraction.front_rows ?? [], shownSlotCount(extraction.front_rows), mode);
    paintCardSheet(backCard, extraction.back_rows ?? [], shownSlotCount(extraction.back_rows), mode);
    applySnapDerivedFields(extraction.front_rows, shownSlotCount(extraction.front_rows), breaks, frontCard, mode);
    applySnapDerivedFields(extraction.back_rows, shownSlotCount(extraction.back_rows), breaks, backCard, mode);
    applyContractDerivedFields();
    markAndPaintHourRows();
    paintSnapSheet(frontSnap, extraction.front_rows ?? [], shownSlotCount(extraction.front_rows), breaks, mode);
    paintSnapSheet(backSnap, extraction.back_rows ?? [], shownSlotCount(extraction.back_rows), breaks, mode);
    bindCardEditors(frontCard, extraction.front_rows, shownSlotCount(extraction.front_rows), {
      snapBody: frontSnap,
      breaks,
      getMode: () => hoursMode,
      onStampChange: refreshDerivedFromExtraction,
      onHoursChange: markAndPaintHourRows,
    });
    bindCardEditors(backCard, extraction.back_rows, shownSlotCount(extraction.back_rows), {
      snapBody: backSnap,
      breaks,
      getMode: () => hoursMode,
      onStampChange: refreshDerivedFromExtraction,
      onHoursChange: markAndPaintHourRows,
    });
    alignSnapRows(frontCard, frontSnap);
    alignSnapRows(backCard, backSnap);
    paintExtraSides();
    paintSideVisibility();
    refreshPayPeriodInfo(extraction, breaks, officeState(), mode);
  }

  /**
   * @param {{ replaceActive?: boolean }} [options]
   */
  async function readCard(options = {}) {
    const replaceActive = options.replaceActive === true;
    if (reading) return;
    const front = document.querySelector('#timesheet-front').files?.[0] ?? null;
    const back = document.querySelector('#timesheet-back').files?.[0] ?? null;
    if (!front && !back) {
      setStatus('Take a photo of the front, the back, or both.', 'error');
      return;
    }
    if (front) validateFile(front, 'Front');
    if (back) validateFile(back, 'Back');
    const attach = pendingSameDriver;
    const attachToId = attach ? activeSessionId : '';
    pendingSameDriver = false;
    singleSideReady = false;
    const previousExtraction = replaceActive ? activeSessionCard()?.extraction || null : null;
    const button = document.querySelector('#timesheet-read');
    const clearButton = document.querySelector('#timesheet-clear');
    let readingCard = replaceActive ? activeSessionCard() : null;
    if (replaceActive && readingCard) {
      flushActiveSessionCard();
      readingCard.status = 'reading';
      readingCard.updatedAt = Date.now();
      activeSessionId = readingCard.id;
    } else {
      flushActiveSessionCard();
      readingCard = {
        id: `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        printId: lastSavedPrintId && !activePrintId ? lastSavedPrintId : activePrintId || '',
        status: /** @type {'reading'} */ ('reading'),
        extraction: extraction || { header: blankCardHeader(), front_rows: [], back_rows: [], caveats: [] },
        updatedAt: Date.now(),
        frontFile: null,
        backFile: null,
      };
      sessionCards.push(readingCard);
      activeSessionId = readingCard.id;
    }
    paintSessionChips();
    reading = true;
    if (button instanceof HTMLButtonElement) button.disabled = true;
    if (clearButton instanceof HTMLButtonElement) clearButton.disabled = true;
    try {
      setBusyStatus(front && back ? 'Preparing the front and back photos…' : 'Preparing the photo…');
      const frontPayload = front ? await filePayload(front) : null;
      const backPayload = back ? await filePayload(back) : null;

      setBusyStatus('Sending photos for analysis…');
      const waiting = [
        'Reading the photos…',
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
      setBusyStatus(front && back ? 'Building the Front and Back card tables…' : 'Building the card table…');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Could not read that card.');
      }
      extraction = payload.extraction;
      if (!extraction || typeof extraction !== 'object') {
        throw new Error('Could not read that card.');
      }
      const previousCard = attachToId
        ? sessionCards.find((card) => card.id === attachToId && card.id !== readingCard.id)
        : null;
      if (previousCard?.extraction) {
        const merged = mergeSameDriverExtraction(previousCard.extraction, extraction, {
          front: Boolean(front),
          back: Boolean(back),
        });
        const extraPrintId = mintPrintCardId();
        if (front || back) {
          await printCopies.saveSides(extraPrintId, front, back).catch(() => null);
        }
        const newest = merged.extra_sides.reduce((max, side) => Math.max(max, Number(side.card) || 0), 0);
        for (const side of merged.extra_sides) {
          if (Number(side.card) !== newest) continue;
          side.printId = extraPrintId;
          if (side.side === 'front' && front) side.file = front;
          if (side.side === 'back' && back) side.file = back;
        }
        if (!previousCard.groupId) previousCard.groupId = mintGroupId();
        previousCard.extraction = merged;
        previousCard.status = sessionCardNeedsReview(merged) ? 'needs_review' : 'ready';
        previousCard.updatedAt = Date.now();
        sessionCards = sessionCards.filter((card) => card.id !== readingCard.id);
        activeSessionId = previousCard.id;
        extraction = merged;
        physicalCardForId = previousCard.id;
        physicalCardNumber = newest || 2;
        linkedPrintId = previousCard.printId || linkedPrintId;
        awaitingReview = previousCard.status === 'needs_review';
        renderResult();
        paintCaveats(extraction);
        await syncPrintHoursFromExtraction().catch(() => null);
        clearCaptureFilesOnly();
        const label = sessionCardChipLabel(extraction, sessionCards.indexOf(previousCard));
        const periodWarning = payPeriodMismatchWarning(
          selectedPayPeriodIso(),
          extraction?.header?.date_on_card,
          payPeriodOptions
        );
        if (awaitingReview) {
          setStatus(
            periodWarning
              ? `${periodWarning} Needs review before the next card.`
              : `${label} updated with another card. Needs review before the next driver.`,
            'error'
          );
        } else if (periodWarning) {
          setStatus(`${label} updated with another card. ${periodWarning}`, 'error');
        } else {
          setStatus(`${label} updated with another card for this pay period.`, 'ok');
        }
        return;
      }
      rememberUnsentSides(extraction, previousExtraction, { front: Boolean(front), back: Boolean(back) });
      const printId = (await ensurePrintCardFromFiles().catch(() => null)) || lastSavedPrintId || linkedPrintId || '';
      linkedPrintId = printId;
      const card = upsertSessionFromExtraction(extraction, printId);
      if (!card.groupId) card.groupId = mintGroupId();
      card.frontFile = front || card.frontFile || null;
      card.backFile = back || card.backFile || null;
      renderResult();
      paintCaveats(extraction);
      await syncPrintHoursFromExtraction().catch(() => null);
      clearCaptureFilesOnly();
      const label = sessionCardChipLabel(extraction, sessionCards.indexOf(card));
      const periodWarning = payPeriodMismatchWarning(
        selectedPayPeriodIso(),
        extraction?.header?.date_on_card,
        payPeriodOptions
      );
      if (awaitingReview) {
        setStatus(
          periodWarning
            ? `${periodWarning} Needs review before the next card.`
            : 'This card needs a look. Fix what you can, then scan the next one.',
          'error'
        );
      } else if (periodWarning) {
        setStatus(`${label} ready. ${periodWarning}`, 'error');
      } else {
        setStatus('');
      }
    } catch (error) {
      stopProgressMessages();
      if (!replaceActive) {
        sessionCards = sessionCards.filter((card) => card.id !== readingCard.id || card.status !== 'reading');
      } else if (readingCard) {
        readingCard.status = sessionCardNeedsReview(readingCard.extraction) ? 'needs_review' : 'ready';
      }
      if (activeSessionId === readingCard.id) {
        activeSessionId = sessionCards[sessionCards.length - 1]?.id || '';
        const prior = activeSessionCard();
        extraction = prior?.extraction || null;
        linkedPrintId = prior?.printId || '';
        if (extraction) renderResult();
        else result.hidden = true;
      }
      paintSessionChips();
      setStatus(error?.message || 'Could not read that card.', 'error');
    } finally {
      stopProgressMessages();
      reading = false;
      if (button instanceof HTMLButtonElement) button.disabled = false;
      if (clearButton instanceof HTMLButtonElement) clearButton.disabled = false;
    }
  }

  function maybeAutoRead() {
    const front = document.querySelector('#timesheet-front');
    const back = document.querySelector('#timesheet-back');
    const hasFront = front instanceof HTMLInputElement && Boolean(front.files?.[0]);
    const hasBack = back instanceof HTMLInputElement && Boolean(back.files?.[0]);
    if (reading) return;
    if (hasFront && hasBack) {
      readCard().catch((error) => setStatus(error.message || 'Could not read that card.', 'error'));
      return;
    }
    if (singleSideReady && (hasFront || hasBack)) {
      readCard().catch((error) => setStatus(error.message || 'Could not read that card.', 'error'));
    }
  }

  /**
   * @param {{ front?: File | null, back?: File | null, sameDriver?: boolean, single?: boolean }} card
   */
  async function acceptPhoneCard(card) {
    if (card?.sameDriver) pendingSameDriver = true;
    if (card?.single || Boolean(card?.front) !== Boolean(card?.back)) singleSideReady = true;
    if (card?.front) putSideFile('front', card.front);
    else clearSideFile('front');
    if (card?.back) putSideFile('back', card.back);
    else clearSideFile('back');
    const label = card?.front && card?.back ? 'Front and back' : card?.front ? 'Front' : 'Back';
    const extra = card?.sameDriver ? ' Same driver, another card.' : '';
    setStatus(`${label} arrived from your phone.${extra}`, 'ok');
    maybeAutoRead();
  }

  /**
   * @param {'front' | 'back'} side
   * @param {File} file
   */
  function putSideFile(side, file) {
    const input = document.querySelector(side === 'front' ? '#timesheet-front' : '#timesheet-back');
    if (!(input instanceof HTMLInputElement)) return;
    if (input.files?.[0] === file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
  }

  function clearSideFile(side) {
    const input = document.querySelector(side === 'front' ? '#timesheet-front' : '#timesheet-back');
    if (input instanceof HTMLInputElement) input.value = '';
  }

  function setSideFile(side, file) {
    putSideFile(side, file);
    maybeAutoRead();
  }

  function clearLiveCard() {
    stopProgressMessages();
    flushActiveSessionCard();
    extraction = null;
    activeSessionId = '';
    linkedPrintId = '';
    awaitingReview = false;
    camera.close();
    descDialog.close();
    sliceDialog.close();
    cardHeader.clear();
    // Keep the phone QR / session chips; only clear the live capture + result.
    form.reset();
    clearCaptureFilesOnly();
    frontCard.replaceChildren();
    backCard.replaceChildren();
    frontSnap.replaceChildren();
    backSnap.replaceChildren();
    const payPeriod = document.querySelector('#timesheet-pay-period');
    if (payPeriod) payPeriod.replaceChildren();
    paintCaveats(null);
    result.hidden = true;
    paintSessionChips();
    setStatus(sessionCards.length ? 'Live card cleared. Session chips are still here.' : '');
  }

  function rowsForSide(side, extraIndex = -1) {
    if (!extraction) return null;
    if (Number.isFinite(extraIndex) && extraIndex >= 0) {
      return extraction.extra_sides?.[extraIndex]?.rows || null;
    }
    return side === 'back' ? extraction.back_rows : extraction.front_rows;
  }

  function eachExtraSide(fn) {
    const host = document.querySelector('#timesheet-extra-sides');
    if (!(host instanceof HTMLElement) || !extraction) return;
    const extras = Array.isArray(extraction.extra_sides) ? extraction.extra_sides : [];
    const pairs = [...host.querySelectorAll('.timesheet-card-pair')];
    pairs.forEach((pair, index) => {
      const extra = extras[index];
      if (extra) fn(pair, extra, index);
    });
  }

  /**
   * @param {'front' | 'back'} face
   * @returns {'front' | 'back'}
   */
  function otherCardFace(face) {
    return face === 'back' ? 'front' : 'back';
  }

  /**
   * @param {'front' | 'back'} which
   */
  function sideIsShown(which) {
    const present = extraction?.sides_present;
    if (!present || typeof present !== 'object') return true;
    return present[which] !== false;
  }

  function rememberCardFace() {
    if (cardFaceForId === activeSessionId) return;
    cardFaceForId = activeSessionId;
    cardFace = 'front';
    extraFaces = {};
  }

  function shownPhysicalCardNumber() {
    if (physicalCardForId !== activeSessionId) {
      physicalCardForId = activeSessionId;
      physicalCardNumber = 1;
    }
    const numbers = physicalCardNumbers(extraction);
    if (!numbers.includes(physicalCardNumber)) physicalCardNumber = numbers[0] || 1;
    return physicalCardNumber;
  }

  /**
   * @param {number} delta
   */
  function stepDriverCard(delta) {
    const steps = driverPayPeriodCardSteps(sessionCards, activeSessionId);
    const currentNumber = shownPhysicalCardNumber();
    let index = steps.findIndex((step) => step.id === activeSessionId && step.cardNumber === currentNumber);
    if (index < 0) index = 0;
    const target = steps[index + delta];
    if (!target) return;
    physicalCardForId = target.id;
    physicalCardNumber = target.cardNumber;
    if (target.id !== activeSessionId) {
      selectSessionCard(target.id).catch((error) => {
        setStatus(error?.message || 'Could not open that card.', 'error');
      });
      return;
    }
    paintSideVisibility();
  }

  function paintDriverCardNav() {
    const prev = document.querySelector('#timesheet-driver-card-prev');
    const next = document.querySelector('#timesheet-driver-card-next');
    const label = document.querySelector('#timesheet-driver-card-label');
    const steps = extraction && !result.hidden ? driverPayPeriodCardSteps(sessionCards, activeSessionId) : [];
    const multiple = steps.length > 1;
    const currentNumber = multiple ? shownPhysicalCardNumber() : 1;
    let index = steps.findIndex((step) => step.id === activeSessionId && step.cardNumber === currentNumber);
    if (index < 0) index = 0;
    if (prev instanceof HTMLButtonElement) {
      prev.hidden = !multiple;
      prev.disabled = !multiple || index <= 0;
    }
    if (next instanceof HTMLButtonElement) {
      next.hidden = !multiple;
      next.disabled = !multiple || index >= steps.length - 1;
    }
    if (label instanceof HTMLElement) {
      label.hidden = !multiple;
      label.textContent = multiple ? `Card ${index + 1} of ${steps.length}` : '';
    }
  }

  /**
   * @param {Element | null} pair
   */
  /**
   * @param {Element | null} pair
   * @param {'front' | 'back'} want
   */
  function showConstructedFace(pair, want) {
    if (!(pair instanceof HTMLElement)) return;
    const next = want === 'back' ? 'back' : 'front';
    rememberCardFace();
    if (pair.hasAttribute('data-extra-index')) {
      const cardNo = pair.dataset.card || pair.dataset.extraIndex || '';
      const current = extraFaces[cardNo] === 'back' ? 'back' : 'front';
      if (current === next) return;
      extraFaces[cardNo] = next;
    } else if ((cardFace === 'back' ? 'back' : 'front') === next) {
      return;
    } else {
      cardFace = next;
    }
    paintSideVisibility();
  }

  /**
   * @param {HTMLElement} pair
   * @param {'front' | 'back'} showing
   * @param {boolean} canFlip
   */
  function paintFaceToggle(pair, showing, canFlip) {
    for (const button of pair.querySelectorAll('.timesheet-face-toggle-btn')) {
      if (!(button instanceof HTMLButtonElement)) continue;
      const face = button.dataset.face === 'back' ? 'back' : 'front';
      const on = face === showing;
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.disabled = !on && !canFlip;
    }
  }

  function paintSideVisibility() {
    rememberCardFace();
    const present = extraction?.sides_present;
    const frontShown = sideIsShown('front');
    const backShown = sideIsShown('back');
    if (cardFace === 'front' && !frontShown && backShown) cardFace = 'back';
    if (cardFace === 'back' && !backShown && frontShown) cardFace = 'front';
    const face = cardFace === 'back' ? 'back' : 'front';
    const physical = shownPhysicalCardNumber();

    for (const pair of document.querySelectorAll('#timesheet-driver-card-frame > .timesheet-card-pair')) {
      if (!(pair instanceof HTMLElement)) continue;
      const which = pair.getAttribute('data-side') === 'back' ? 'back' : 'front';
      const absent = Boolean(present) && present[which] === false;
      pair.hidden = physical !== 1 || absent || which !== face;
      paintFaceToggle(pair, which, sideIsShown(otherCardFace(which)));
    }

    const host = document.querySelector('#timesheet-extra-sides');
    if (!(host instanceof HTMLElement)) {
      paintDriverCardNav();
      return;
    }
    /** @type {Map<string, HTMLElement[]>} */
    const groups = new Map();
    for (const pair of host.querySelectorAll('.timesheet-card-pair')) {
      if (!(pair instanceof HTMLElement)) continue;
      const cardNo = pair.dataset.card || pair.dataset.extraIndex || 'extra';
      const list = groups.get(cardNo) || [];
      list.push(pair);
      groups.set(cardNo, list);
    }
    for (const [cardNo, pairs] of groups) {
      const available = [...new Set(pairs.map((pair) => (pair.getAttribute('data-side') === 'back' ? 'back' : 'front')))];
      let faceForCard = extraFaces[cardNo] === 'back' ? 'back' : 'front';
      if (!available.includes(faceForCard)) faceForCard = available[0] === 'back' ? 'back' : 'front';
      extraFaces[cardNo] = faceForCard;
      for (const pair of pairs) {
        const which = pair.getAttribute('data-side') === 'back' ? 'back' : 'front';
        const cardNumber = Number(pair.dataset.card) || Number(cardNo) || 0;
        pair.hidden = cardNumber !== physical || which !== faceForCard;
        paintFaceToggle(pair, which, available.includes(otherCardFace(which)));
      }
    }
    paintDriverCardNav();
  }

  function sideDeleteButton() {
    const sample = document.querySelector('#timesheet-driver-card-frame .timesheet-delete-side');
    if (sample) {
      const button = sample.cloneNode(true);
      return button;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary timesheet-delete-side';
    button.setAttribute('aria-label', 'Delete this side');
    button.title = 'Remove this photographed side. If it is the last side, the whole constructed card is removed.';
    button.innerHTML = `<svg class="timesheet-delete-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6.5 7l.8 12.2A1 1 0 0 0 8.3 20.2h7.4a1 1 0 0 0 1-.98L17.5 7"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
    return button;
  }

  /** @type {{ side: 'front' | 'back', extraIndex: number } | null} */
  let pendingSideDelete = null;

  function openDeleteSideDialog(pair) {
    const dialog = document.querySelector('#timesheet-delete-side-dialog');
    const lead = document.querySelector('#timesheet-delete-side-lead');
    if (!(pair instanceof HTMLElement) || !(dialog instanceof HTMLDialogElement) || !extraction) return;
    const side = pair.getAttribute('data-side') === 'back' ? 'back' : 'front';
    const extraIndex = pair.hasAttribute('data-extra-index') ? Number(pair.dataset.extraIndex) : -1;
    pendingSideDelete = { side, extraIndex };
    if (lead instanceof HTMLElement) lead.textContent = deleteSideWarning(extraction, pendingSideDelete);
    if (!dialog.open) dialog.showModal();
    document.querySelector('#timesheet-delete-side-cancel')?.focus();
  }

  function closeDeleteSideDialog() {
    pendingSideDelete = null;
    document.querySelector('#timesheet-delete-side-dialog')?.close();
  }

  function confirmDeleteSide() {
    const pending = pendingSideDelete;
    pendingSideDelete = null;
    document.querySelector('#timesheet-delete-side-dialog')?.close();
    if (!pending || !extraction) return;
    const card = activeSessionCard();
    if (!card) return;
    const removed = deleteConstructedSide(extraction, pending);
    if (pending.extraIndex < 0 && pending.side === 'front') card.frontFile = null;
    if (pending.extraIndex < 0 && pending.side === 'back') card.backFile = null;
    const label = pending.side === 'back' ? 'back' : 'front';
    if (removed.empty) {
      const index = sessionCards.findIndex((item) => item.id === card.id);
      activeSessionId = '';
      extraction = null;
      sessionCards = sessionCards.filter((item) => item.id !== card.id);
      schedulePersistConstructedCards();
      const next = sessionCards[Math.max(0, Math.min(index, sessionCards.length - 1))] || null;
      if (next) {
        selectSessionCard(next.id).catch(() => null);
      } else {
        clearLiveCard();
      }
      setStatus('Deleted the constructed card.', 'ok');
      return;
    }
    card.status = sessionCardNeedsReview(extraction) ? 'needs_review' : 'ready';
    card.updatedAt = Date.now();
    rememberCardSummary(card);
    schedulePersistConstructedCards();
    renderResult();
    paintCaveats(extraction);
    paintSessionChips();
    syncPrintHoursFromExtraction().catch(() => null);
    setStatus(`Deleted the ${label}.`, 'ok');
  }

  document.querySelector('#timesheet-delete-side-cancel')?.addEventListener('click', closeDeleteSideDialog);
  document.querySelector('#timesheet-delete-side-confirm')?.addEventListener('click', confirmDeleteSide);
  document.querySelector('#timesheet-delete-side-dialog')?.addEventListener('click', (event) => {
    const dialog = document.querySelector('#timesheet-delete-side-dialog');
    if (event.target === dialog) closeDeleteSideDialog();
  });
  document.querySelector('#timesheet-delete-side-dialog')?.addEventListener('close', () => {
    pendingSideDelete = null;
  });

  function faceToggle() {
    const sample = document.querySelector('#timesheet-driver-card-frame .timesheet-face-toggle');
    if (sample) return sample.cloneNode(true);
    const group = document.createElement('div');
    group.className = 'timesheet-face-toggle';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Card side');
    group.innerHTML = `<button type="button" class="timesheet-face-toggle-btn" data-face="front" aria-pressed="true" title="Show the front of this card.">Front</button><button type="button" class="timesheet-face-toggle-btn" data-face="back" aria-pressed="false" title="Show the back of this card.">Back</button>`;
    return group;
  }

  function paintExtraSides() {
    const host = document.querySelector('#timesheet-extra-sides');
    if (!(host instanceof HTMLElement)) return;
    host.replaceChildren();
    const extras = Array.isArray(extraction?.extra_sides) ? extraction.extra_sides : [];
    const breaks = snapBreaks();
    const mode = hoursMode;
    extras.forEach((extra, extraIndex) => {
      const which = extra?.side === 'back' ? 'back' : 'front';
      const cardNo = Number(extra?.card) || extraIndex + 2;
      const pair = document.createElement('div');
      pair.className = 'timesheet-card-pair';
      pair.dataset.side = which;
      pair.dataset.extraIndex = String(extraIndex);
      pair.dataset.card = String(cardNo);
      const stage = document.createElement('div');
      stage.className = 'timesheet-card-stage';
      const face = document.createElement('div');
      face.className = 'timesheet-card-face';
      const heading = document.createElement('h3');
      heading.className = 'visually-hidden';
      heading.textContent = which === 'back' ? 'Back' : 'Front';
      face.append(faceToggle(), heading);
      const article = document.createElement('article');
      article.className = 'timesheet-card-panel';
      article.append(sideDeleteButton());
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap timesheet-card-wrap';
      const table = document.createElement('table');
      table.className = 'timesheet-card-sheet';
      table.innerHTML = `<thead><tr>
        <th scope="col" class="timesheet-card-desc"><span class="visually-hidden">Description of Work</span><span class="timesheet-card-desc-label" aria-hidden="true">Desc</span></th>
        <th scope="col" class="timesheet-card-reg">Reg</th>
        <th scope="col" class="timesheet-card-ot">OT</th>
        <th scope="col" class="timesheet-card-tot">Tot. Hrs.</th>
        <th scope="col" class="timesheet-card-clock">Clock Record</th>
        <th scope="col" class="timesheet-card-actions"><span class="visually-hidden">Row actions</span></th>
      </tr></thead>`;
      const body = document.createElement('tbody');
      table.append(body);
      wrap.append(table);
      article.append(wrap);
      const aside = document.createElement('aside');
      aside.className = 'timesheet-snap-panel';
      const snapWrap = document.createElement('div');
      snapWrap.className = 'table-wrap timesheet-snap-wrap';
      const snapTable = document.createElement('table');
      snapTable.className = 'timesheet-snap-sheet';
      const snapHead = document.createElement('thead');
      const snapLabel = document.createElement('th');
      snapLabel.textContent = HOURS_MODE_LABELS[mode] || 'Snap rounded times';
      const snapRow = document.createElement('tr');
      snapRow.append(snapLabel);
      snapHead.append(snapRow);
      const snapBody = document.createElement('tbody');
      snapTable.append(snapHead, snapBody);
      snapWrap.append(snapTable);
      aside.append(snapWrap);
      stage.append(face, article, aside);
      pair.append(stage);
      host.append(pair);
      const rows = Array.isArray(extra.rows) ? extra.rows : [];
      extra.rows = rows;
      const slotCount = shownSlotCount(rows);
      paintCardSheet(body, rows, slotCount, mode);
      paintSnapSheet(snapBody, rows, slotCount, breaks, mode);
      bindCardEditors(body, rows, slotCount, {
        snapBody,
        breaks,
        getMode: () => hoursMode,
        onStampChange: refreshDerivedFromExtraction,
        onHoursChange: markAndPaintHourRows,
      });
      alignSnapRows(body, snapBody);
    });
    paintSideVisibility();
  }

  let archiveReady = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let persistTimer = null;
  restoreSavedCards();
  archiveReady = true;
  seedLocalExampleCards();
  window.addEventListener('pagehide', persistConstructedCards);

  return { refresh };

  function restoreSavedCards() {
    const archive = loadGenieCardArchive(browserStorage());
    sessionCards = archive.cards.map((record) => ({
      id: record.id,
      printId: record.printId || '',
      printed: record.printed === true,
      printQueued: record.printQueued === true,
      printQueuedAt: Number(record.printQueuedAt) || 0,
      status: record.status,
      extraction: record.extraction,
      updatedAt: record.updatedAt,
      frontFile: null,
      backFile: null,
      example: false,
      hoursMode: record.hoursMode,
      summary: record.summary,
    }));
  }

  function seedLocalExampleCards() {
    if (isLocalGenieHost(window.location.hostname)) {
      const saved = sessionCards.filter((card) => card.example !== true);
      const examples = localExampleGenieExtractions().map((cardExtraction, index) => ({
        id: `example-${index + 1}`,
        printId: '',
        status: sessionCardNeedsReview(cardExtraction) ? 'needs_review' : 'ready',
        extraction: cardExtraction,
        updatedAt: 0,
        frontFile: null,
        backFile: null,
        example: true,
      }));
      sessionCards = [...examples, ...saved];
    }
    showActiveCard();
  }

  function showActiveCard() {
    if (!sessionCards.length) {
      extraction = null;
      activeSessionId = '';
      awaitingReview = false;
      paintSessionChips();
      return;
    }
    const periods = carouselPayPeriods(sessionCards, payPeriodOptions);
    if (!periods.some((period) => period.key === carouselPeriodKey)) {
      const iso = defaultPayPeriodIso(periods);
      carouselPeriodKey = periods.find((period) => period.key === iso)?.key || '';
    }
    const inPeriod = cardsInCarouselPeriod(sessionCards, carouselPeriodKey);
    const saved = inPeriod.filter((card) => card.example !== true);
    const newest = saved.reduce(
      (best, card) => (!best || card.updatedAt > best.updatedAt ? card : best),
      null
    );
    const active = newest || inPeriod.find((card) => card.status === 'ready') || inPeriod[0] || null;
    if (!active) {
      extraction = null;
      activeSessionId = '';
      awaitingReview = false;
      paintSessionChips();
      return;
    }
    activeSessionId = active.id;
    extraction = active.extraction;
    awaitingReview = active.status === 'needs_review';
    renderResult();
    paintCaveats(extraction);
    paintSessionChips();
  }

  function rememberCardSummary(card) {
    if (!card || card.example === true || card.status === 'reading' || !card.extraction) return;
    card.hoursMode = hoursMode;
    try {
      card.summary = payPeriodSummarySnapshot(
        buildGenieCardMonthlySummary(card.extraction, snapBreaks(), officeState(), hoursMode)
      );
    } catch {
      card.summary = card.summary || null;
    }
  }

  function schedulePersistConstructedCards() {
    if (persistTimer != null) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistConstructedCards();
    }, 400);
  }

  function persistConstructedCards() {
    if (!archiveReady) return;
    if (persistTimer != null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    try {
      const active = activeSessionCard();
      if (active) rememberCardSummary(active);
      for (const card of sessionCards) {
        if (card.example === true || card.status === 'reading' || card.summary) continue;
        rememberCardSummary(card);
      }
      const saved = saveGenieCardArchive(
        { ...emptyGenieCardArchive(), cards: archiveCardsFromSession(sessionCards) },
        browserStorage()
      );
      if (!saved && sessionCards.some((card) => card.example !== true && card.status !== 'reading')) {
        setStatus('This browser is full, so the latest card could not be saved. Download a backup, then clear older cards.', 'error');
      }
    } catch {
      setStatus('Could not save the constructed cards in this browser.', 'error');
    }
  }

  function backupAllScans() {
    flushActiveSessionCard();
    persistConstructedCards();
    const archive = {
      ...emptyGenieCardArchive(),
      cards: archiveCardsFromSession(sessionCards),
    };
    if (!archive.cards.length) {
      setStatus('No constructed cards are saved in this browser yet.', 'error');
      return;
    }
    const html = genieScanBackupHtml(archive, new Date());
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = genieScanBackupFilename(new Date());
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setStatus(`Downloaded ${archive.cards.length} constructed card${archive.cards.length === 1 ? '' : 's'}.`, 'ok');
  }

  function browserStorage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
}

/**
 * @param {object | null | undefined} extraction
 */
export function hasIllegibleClockStamps(extraction) {
  const rows = extractionRowLists(extraction).flat();
  return rows.some(
    (row) =>
      /^illegible$/i.test(String(row?.clock_out_raw ?? '').trim()) ||
      /^illegible$/i.test(String(row?.clock_in_raw ?? '').trim())
  );
}

/**
 * Whether the desk should pause batch scanning for a human look.
 * @param {object | null | undefined} extraction
 */
export function sessionCardNeedsReview(extraction) {
  if (!extraction || typeof extraction !== 'object') return true;
  const caveats = Array.isArray(extraction.caveats) ? extraction.caveats.filter(Boolean) : [];
  if (caveats.length) return true;
  if (hasIllegibleClockStamps(extraction)) return true;
  const contract = parseStickerContractHours(extraction.header?.contract_hours);
  if (contract == null) return true;
  const rows = extractionRowLists(extraction).flat();
  if (rows.some((row) => row?.hours_add_up === false)) return true;
  return false;
}

/**
 * Driver name shown on a carousel card, or "Card N" when the sticker has no name.
 * @param {object | null | undefined} extraction
 * @param {number} index
 */
export function sessionCardDriverName(extraction, index) {
  const name = String(extraction?.header?.employee_name || '').trim();
  if (name) return name;
  const n = Number(index) + 1;
  return `Card ${Number.isFinite(n) && n > 0 ? n : 1}`;
}

/**
 * Split a "Last, First" sticker name so a square button can stack it.
 * @param {string | null | undefined} name
 */
export function driverNameParts(name) {
  const text = String(name || '').trim();
  const comma = text.indexOf(',');
  if (comma > 0) {
    return {
      last: text.slice(0, comma).trim() || text,
      first: text.slice(comma + 1).trim(),
    };
  }
  return { last: text, first: '' };
}

/**
 * Short chip label for a session card.
 * @param {object | null | undefined} extraction
 * @param {number} index
 */
export function sessionCardChipLabel(extraction, index) {
  const who = sessionCardDriverName(extraction, index);
  const date = String(extraction?.header?.date_on_card || '').trim();
  return date ? `${who} · ${date}` : who;
}

/**
 * Stable carousel key for a card: the sticker pay-period end, or a fallback bucket.
 * @param {object | null | undefined} card
 */
export function carouselPeriodKeyForCard(card) {
  const iso = parseCardPeriodEnd(card?.extraction?.header?.date_on_card);
  if (iso) return iso;
  const sticker = String(card?.extraction?.header?.date_on_card || '').trim();
  return sticker ? `sticker:${sticker}` : 'none';
}

/**
 * Every calculated school-year pay period, oldest first, plus a card whose
 * sticker date is not already one of those endings. An empty period stays in
 * the list; this does not invent cards for it.
 * @param {object[] | null | undefined} cards
 * @param {Array<{ iso?: string, label?: string }> | null | undefined} knownPeriods
 */
export function carouselPayPeriods(cards, knownPeriods = []) {
  /** @type {Map<string, { key: string, iso: string, label: string }>} */
  const groups = new Map();
  for (const period of Array.isArray(knownPeriods) ? knownPeriods : []) {
    const iso = String(period?.iso || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || groups.has(iso)) continue;
    groups.set(iso, { key: iso, iso, label: String(period?.label || iso) });
  }
  for (const card of Array.isArray(cards) ? cards : []) {
    const key = carouselPeriodKeyForCard(card);
    if (groups.has(key)) continue;
    const iso = key === 'none' || key.startsWith('sticker:') ? '' : key;
    const sticker = String(card?.extraction?.header?.date_on_card || '').trim();
    const label = key === 'none' ? 'No sticker date' : sticker || iso;
    groups.set(key, { key, iso, label });
  }
  return [...groups.values()].sort((a, b) => {
    if (a.iso && b.iso) return a.iso.localeCompare(b.iso);
    if (a.iso) return -1;
    if (b.iso) return 1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Cards whose sticker date belongs to the selected carousel pay period.
 * @param {object[] | null | undefined} cards
 * @param {string | null | undefined} periodKey
 */
export function cardsInCarouselPeriod(cards, periodKey) {
  const key = String(periodKey || '');
  return (Array.isArray(cards) ? cards : []).filter((card) => carouselPeriodKeyForCard(card) === key);
}

/**
 * Employee squares added to the print queue for one pay period, oldest first.
 * @param {object[] | null | undefined} cards
 * @param {string | null | undefined} periodKey
 */
export function queuedCardsInPeriod(cards, periodKey) {
  return cardsInCarouselPeriod(cards, periodKey)
    .filter((card) => card?.printQueued === true)
    .sort((a, b) => (Number(a.printQueuedAt) || 0) - (Number(b.printQueuedAt) || 0));
}

/**
 * Physical cards on one constructed record. Card 1 is the front/back pair.
 * Later numbers are extra cards photographed for that same driver.
 * @param {object | null | undefined} extraction
 * @returns {number[]}
 */
export function physicalCardNumbers(extraction) {
  const numbers = new Set([1]);
  const extras = Array.isArray(extraction?.extra_sides) ? extraction.extra_sides : [];
  for (const side of extras) {
    const number = Number(side?.card) || 0;
    if (number >= 2) numbers.add(number);
  }
  return [...numbers].sort((a, b) => a - b);
}

/**
 * Front-and-back cards for one driver in one pay period, in desk order.
 * Separate session cards with the same sticker name and period are included,
 * as are extra physical cards stored on one extraction.
 * @param {object[] | null | undefined} cards
 * @param {string | null | undefined} activeId
 * @returns {{ id: string, cardNumber: number }[]}
 */
export function driverPayPeriodCardSteps(cards, activeId) {
  const list = Array.isArray(cards) ? cards : [];
  const active = list.find((card) => card?.id === activeId) || null;
  if (!active) return [];
  const period = carouselPeriodKeyForCard(active);
  const name = String(active.extraction?.header?.employee_name || '').trim().toLowerCase();
  const pool = name
    ? list.filter(
        (card) =>
          carouselPeriodKeyForCard(card) === period &&
          String(card.extraction?.header?.employee_name || '').trim().toLowerCase() === name
      )
    : [active];
  /** @type {{ id: string, cardNumber: number }[]} */
  const steps = [];
  for (const card of pool) {
    for (const cardNumber of physicalCardNumbers(card.extraction)) {
      steps.push({ id: card.id, cardNumber });
    }
  }
  return steps;
}

function mintGroupId() {
  return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {object | null | undefined} card
 */
function sessionSideNote(card) {
  const present = card?.extraction?.sides_present;
  const extras = Array.isArray(card?.extraction?.extra_sides) ? card.extraction.extra_sides.length : 0;
  let count = extras;
  if (!present || present.front !== false) count += 1;
  if (!present || present.back !== false) count += 1;
  if (count > 2) return ` · ${count} sides`;
  if (present?.front === false) return ' · back only';
  if (present?.back === false) return ' · front only';
  return '';
}

/**
 * Keep rows for a side that was not in this read (skipped or already on file).
 * @param {object} next
 * @param {object | null | undefined} previous
 * @param {{ front: boolean, back: boolean }} sent
 */
function rememberUnsentSides(next, previous, sent) {
  if (!next || typeof next !== 'object') return;
  if (previous && !sent.front) {
    next.front_rows = Array.isArray(previous.front_rows) ? previous.front_rows : [];
    if (previous.header) next.header = previous.header;
  }
  if (previous && !sent.back) {
    next.back_rows = Array.isArray(previous.back_rows) ? previous.back_rows : [];
  }
  if (Array.isArray(previous?.extra_sides)) next.extra_sides = previous.extra_sides;
  const prior = previous?.sides_present;
  next.sides_present = {
    front: sent.front || prior?.front === true,
    back: sent.back || prior?.back === true,
  };
}

function mintPrintCardId() {
  return `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
function paintTotHourFields(body, rows, runExtras) {
  if (!body || !Array.isArray(rows)) return;
  for (const row of rows) {
    const index = Number(row?.row_index) || 0;
    if (!index) continue;
    const input = body.querySelector(`tr[data-row-index="${index}"] input[data-field="total_hours"]`);
    if (!(input instanceof HTMLInputElement)) continue;
    input.value = row?.total_hours == null || row.total_hours === '' ? '' : String(row.total_hours);
    input.title = runExtras && input.value ? 'Hours worked past this run’s contract' : '';
  }
}

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
        ${clockRecordHtml(row, index)}
      </td>
      <td class="timesheet-card-actions">
        <button type="button" class="timesheet-row-slice${portionCount ? ' has-slices' : ''}"
          ${blank || row.crossed_out ? 'disabled' : ''}
          aria-label="Slice pay status for row ${index}${portionCount ? ` (${portionCount} parts)` : ''}"
          title="Split this clock period across pay statuses. Hours are taken from the start of the period.">✂</button>
        <button type="button" class="timesheet-row-delete"
          ${blank && !row.description_of_work && !portionCount ? 'disabled' : ''}
          aria-label="Delete row ${index}"
          title="Remove this clock line and its hours from the card.">×</button>
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
  for (const rows of extractionRowLists(extraction)) {
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
  try {
    const summary = buildGenieCardMonthlySummary(extraction, breaks, state, mode);
    if (!summary) {
      host.innerHTML =
        '<p class="lead timesheet-pay-period-empty">Add readable Clock Record stamps to build the Monthly Time Summary.</p>';
      return;
    }
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
 * Monthly Time Summary for one constructed card. Null when the stamps cannot fill a sheet.
 * @param {object} extraction
 * @param {object} breaks
 * @param {object | null} state
 * @param {string | null | undefined} [mode]
 */
function buildGenieCardMonthlySummary(extraction, breaks, state, mode) {
  if (!extraction) return null;
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
  if (!punches.length) return null;
  const { totHoursByDay } = cardDayFigures(extraction, breaks, office, mode);
  const runExtras = applyRunExtraTotals(extractionRowLists(extraction), extraction?.header, {
    breaks,
    defaultYear: year,
    mode,
  });
  let cardNow = null;
  for (const punch of punches) {
    const when = new Date(punch?.punched_at);
    if (Number.isNaN(when.getTime())) continue;
    if (!cardNow || when > cardNow) cardNow = when;
  }
  const regDriverHoursByDay = runExtras
    ? new Map([...runExtras.shortByDay].map(([day, hours]) => [day, -hours]))
    : null;
  return buildMonthlyTimeSummary({
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
    regOtFromContractGap: true,
    totHoursByDay,
    exDriverHoursByDay: runExtras?.extraByDay || null,
    regDriverHoursByDay,
  });
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
  for (const rows of extractionRowLists(extraction)) {
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
  for (const rows of extractionRowLists(extraction)) {
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
        ${snapRecordHtml(row, snapped)}
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
/**
 * Photographed sides still on a constructed card.
 * Card 1 counts a side unless sides_present marks it absent.
 * @param {object | null | undefined} extraction
 * @returns {{ side: 'front' | 'back', extraIndex: number, card: number }[]}
 */
export function constructedCardSides(extraction) {
  const present = extraction?.sides_present;
  /** @type {{ side: 'front' | 'back', extraIndex: number, card: number }[]} */
  const sides = [];
  if (!present || present.front !== false) sides.push({ side: 'front', extraIndex: -1, card: 1 });
  if (!present || present.back !== false) sides.push({ side: 'back', extraIndex: -1, card: 1 });
  const extras = Array.isArray(extraction?.extra_sides) ? extraction.extra_sides : [];
  extras.forEach((extra, extraIndex) => {
    sides.push({
      side: extra?.side === 'back' ? 'back' : 'front',
      extraIndex,
      card: Number(extra?.card) || extraIndex + 2,
    });
  });
  return sides;
}

/**
 * Warning copy before a constructed side is deleted.
 * @param {object | null | undefined} extraction
 * @param {{ side?: string, extraIndex?: number } | null | undefined} target
 */
export function deleteSideWarning(extraction, target) {
  const side = target?.side === 'back' ? 'back' : 'front';
  const extraIndex = Number(target?.extraIndex);
  const extras = Array.isArray(extraction?.extra_sides) ? extraction.extra_sides : [];
  const cardNo = extraIndex >= 0 ? Number(extras[extraIndex]?.card) || extraIndex + 2 : 1;
  const who = String(extraction?.header?.employee_name || '').trim();
  const place = cardNo > 1 ? `card ${cardNo} ${side}` : `the ${side}`;
  const whose = who ? ` for ${who}` : '';
  if (constructedCardSides(extraction).length <= 1) {
    return `Delete ${place}${whose}? This is the last side, so the whole constructed card will be removed.`;
  }
  return `Delete ${place}${whose}? The hours on this side come off the constructed card. The other side stays.`;
}

/**
 * Remove one photographed side from a constructed card. Mutates the extraction.
 * @param {object | null | undefined} extraction
 * @param {{ side?: string, extraIndex?: number } | null | undefined} target
 * @returns {{ empty: boolean }}
 */
export function deleteConstructedSide(extraction, target) {
  if (!extraction || typeof extraction !== 'object') return { empty: true };
  const side = target?.side === 'back' ? 'back' : 'front';
  const extraIndex = Number(target?.extraIndex);
  if (Number.isInteger(extraIndex) && extraIndex >= 0) {
    const extras = Array.isArray(extraction.extra_sides) ? extraction.extra_sides.slice() : [];
    if (extraIndex < extras.length) extras.splice(extraIndex, 1);
    extraction.extra_sides = extras;
  } else if (side === 'back') {
    extraction.back_rows = [];
    extraction.sides_present = {
      front: extraction.sides_present?.front !== false,
      back: false,
    };
  } else {
    extraction.front_rows = [];
    extraction.sides_present = {
      front: false,
      back: extraction.sides_present?.back !== false,
    };
  }
  return { empty: constructedCardSides(extraction).length === 0 };
}

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
  const dateInput = document.querySelector('#timesheet-header-date');
  const contractInput = document.querySelector('#timesheet-header-contract');
  const contractAmInput = document.querySelector('#timesheet-header-contract-am');
  const contractMidInput = document.querySelector('#timesheet-header-contract-mid');
  const contractPmInput = document.querySelector('#timesheet-header-contract-pm');
  const payStatusSelect = document.querySelector('#timesheet-header-pay-status');
  const driverList = document.querySelector('#timesheet-driver-options');
  const routeList = document.querySelector('#timesheet-route-options');
  if (!form || !driverInput || !routeInput) {
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

  function readContractNumber(input) {
    if (!(input instanceof HTMLInputElement)) return null;
    const text = input.value.trim();
    if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
    const number = Number(text);
    if (!Number.isFinite(number) || number <= 0 || number > 24) return null;
    return Math.round(number * 100) / 100;
  }

  function contractFieldText(value) {
    if (value == null || value === '') return '';
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '';
    return formatAuditHours(number);
  }

  /**
   * Total outside the parentheses is the day's contract for Reg / OT.
   * A pasted line such as "4.25 (2, 2.5)" fills total, AM, and PM, with midday empty.
   * Editing a run portion rebuilds the total from AM + midday + PM.
   * @param {'part' | 'line' | ''} [contractFrom]
   */
  function readStickerContract(contractFrom = '') {
    const totalRaw = contractInput instanceof HTMLInputElement ? contractInput.value.trim() : '';
    const pasted = /\(/.test(totalRaw) ? parseStickerContractHours(totalRaw) : null;
    if (pasted) return pasted;
    let am = readContractNumber(contractAmInput);
    let midday = readContractNumber(contractMidInput);
    let pm = readContractNumber(contractPmInput);
    let total = readContractNumber(contractInput);
    const parts = [am, midday, pm].filter((value) => value != null);
    if (contractFrom === 'part' && parts.length) {
      total = Math.round(parts.reduce((sum, value) => sum + value, 0) * 100) / 100;
    } else if (total == null && parts.length) {
      total = Math.round(parts.reduce((sum, value) => sum + value, 0) * 100) / 100;
    }
    return { total, am, midday, pm };
  }

  function readHeaderFromForm(contractFrom = '') {
    const extraction = options.getExtraction();
    const previous = extraction?.header && typeof extraction.header === 'object'
      ? extraction.header
      : blankCardHeader();
    const payStatus =
      payStatusSelect instanceof HTMLSelectElement ? payStatusSelect.value.trim() : '';
    const stickerContract = readStickerContract(contractFrom);
    const dateText =
      dateInput instanceof HTMLInputElement ? dateInput.value.trim() : '';
    return {
      ...blankCardHeader(),
      ...previous,
      employee_name: driverInput.value.trim() || null,
      route_number: routeInput.value.trim() || null,
      date_on_card: dateText || null,
      contract_am_hours: stickerContract?.am ?? null,
      contract_midday_hours: stickerContract?.midday ?? null,
      contract_pm_hours: stickerContract?.pm ?? null,
      contract_hours: stickerContract?.total ?? null,
      default_pay_status: isPayLineId(payStatus) ? payStatus : null,
    };
  }

  function writeHeaderToForm(header) {
    const next = header && typeof header === 'object' ? header : blankCardHeader();
    driverInput.value = next.employee_name ? String(next.employee_name) : '';
    routeInput.value = next.route_number ? String(next.route_number) : '';
    if (dateInput instanceof HTMLInputElement) {
      dateInput.value = next.date_on_card ? String(next.date_on_card) : '';
    }
    if (contractInput instanceof HTMLInputElement) {
      contractInput.value = contractFieldText(next.contract_hours);
    }
    if (contractAmInput instanceof HTMLInputElement) {
      contractAmInput.value = contractFieldText(next.contract_am_hours);
    }
    if (contractMidInput instanceof HTMLInputElement) {
      contractMidInput.value = contractFieldText(next.contract_midday_hours);
    }
    if (contractPmInput instanceof HTMLInputElement) {
      contractPmInput.value = contractFieldText(next.contract_pm_hours);
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
      if (next.contract_am_hours == null) next.contract_am_hours = contractHoursFromPayroll(row, 'am');
      if (next.contract_midday_hours == null) next.contract_midday_hours = contractHoursFromPayroll(row, 'midday');
      if (next.contract_pm_hours == null) next.contract_pm_hours = contractHoursFromPayroll(row, 'pm');
      const parts = [next.contract_am_hours, next.contract_midday_hours, next.contract_pm_hours]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
      if (parts.length && !(Number(next.contract_hours) > 0)) {
        next.contract_hours = Math.round(parts.reduce((sum, value) => sum + value, 0) * 100) / 100;
      }
    }
    const suggested = suggestedPayStatusForDriver(next.employee_name);
    if (suggested) next.default_pay_status = suggested;
    return next;
  }

  function commitForm({ matchFrom = '', contractFrom = '' } = {}) {
    if (!options.getExtraction()) return;
    let header = readHeaderFromForm(contractFrom);
    if (matchFrom === 'driver' && header.employee_name) {
      header = applyMatchedSuggestions(header, { fillRoute: true });
    } else if (matchFrom === 'route' && header.route_number) {
      header = applyMatchedSuggestions(header, { fillDriver: true });
    }
    options.setExtractionHeader(header);
    if (matchFrom || contractFrom === 'line') {
      fillingFromMatch = true;
      writeHeaderToForm(header);
      fillingFromMatch = false;
    } else if (contractFrom === 'part' && contractInput instanceof HTMLInputElement) {
      fillingFromMatch = true;
      contractInput.value = contractFieldText(header.contract_hours);
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
  for (const input of [driverInput, routeInput, dateInput]) {
    if (!input) continue;
    input.addEventListener('input', () => {
      if (fillingFromMatch) return;
      commitForm();
    });
  }
  if (contractInput instanceof HTMLInputElement) {
    contractInput.addEventListener('input', () => {
      if (fillingFromMatch) return;
      const pasted = /\(/.test(contractInput.value);
      commitForm({ contractFrom: pasted ? 'line' : '' });
    });
  }
  for (const input of [contractAmInput, contractMidInput, contractPmInput]) {
    if (!(input instanceof HTMLInputElement)) continue;
    input.addEventListener('input', () => {
      if (fillingFromMatch) return;
      commitForm({ contractFrom: 'part' });
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

  /** @type {{ side: 'front' | 'back', index: number, extraIndex: number, start: Date, end: Date } | null} */
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
    const rows = options.getRows(editing.side, editing.extraIndex);
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
      remove.title = 'Take these hours off this pay status and return them to the clock period.';
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
     * @param {number} [extraIndex]
     */
    open(side, index, extraIndex = -1) {
      const rows = options.getRows(side, extraIndex);
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
        extraIndex,
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

/**
 * Header row-height control. Size every constructed card so a paper card can sit next to the screen.
 * @param {{ cards: Element | null, realign: () => void }} parts
 */
function mountRowHeightControl({ cards, realign }) {
  if (!(cards instanceof HTMLElement)) return;
  const host = cards.closest('#timecard-genie-view');
  const root = host instanceof HTMLElement ? host : cards;
  let current = savedRowHeight();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let delay = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;

  function clearHold() {
    if (delay != null) clearTimeout(delay);
    if (timer != null) clearInterval(timer);
    delay = null;
    timer = null;
  }

  function apply(px, { save = true } = {}) {
    current = Math.min(ROW_HEIGHT_MAX, Math.max(ROW_HEIGHT_MIN, Math.round(Number(px) || ROW_HEIGHT_DEFAULT)));
    cards.style.setProperty('--timesheet-row-height', `${current}px`);
    for (const out of root.querySelectorAll('.timesheet-row-height-value')) {
      out.textContent = `${current}px`;
    }
    if (save) {
      try {
        localStorage.setItem(ROW_HEIGHT_KEY, String(current));
      } catch {
        /* Preference can stay for this visit only. */
      }
    }
    realign();
  }

  function step(delta) {
    apply(current + delta);
  }

  /** Pointer clicks already step on pointerdown; the click listener covers keyboard only. */
  let fromPointer = false;

  root.addEventListener('pointerdown', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-row-height]') : null;
    if (!(button instanceof HTMLButtonElement) || event.button !== 0) return;
    event.preventDefault();
    fromPointer = true;
    const delta = Number(button.dataset.rowHeight) || 0;
    step(delta);
    delay = setTimeout(() => {
      timer = setInterval(() => step(delta), 45);
    }, 320);
  });
  root.addEventListener('click', (event) => {
    if (fromPointer) {
      fromPointer = false;
      return;
    }
    const button = event.target instanceof Element ? event.target.closest('[data-row-height]') : null;
    if (!(button instanceof HTMLButtonElement)) return;
    step(Number(button.dataset.rowHeight) || 0);
  });
  root.addEventListener('pointerout', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-row-height]') : null;
    if (!(button instanceof HTMLButtonElement)) return;
    const next = event.relatedTarget;
    if (next instanceof Node && button.contains(next)) return;
    clearHold();
  });
  window.addEventListener('pointerup', clearHold);
  window.addEventListener('pointercancel', clearHold);
  apply(current, { save: false });
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
function mountPrintCopies({ setStatus, currentPair, onCardSaved, getSessionPrintIds } = {}) {
  const dialog = document.querySelector('#timesheet-print-dialog');
  const list = document.querySelector('#timesheet-print-list');
  const cropPanel = document.querySelector('#timesheet-print-crop');
  const rangePanel = document.querySelector('#timesheet-print-range');
  const status = document.querySelector('#timesheet-print-status');
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
      syncHours() {
        return Promise.resolve(null);
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
      empty.textContent = 'No print copies yet. Scan a front and a back, and they are kept here.';
      list.append(empty);
      return;
    }
    const ol = document.createElement('ol');
    ol.className = 'timesheet-print-cards';
    cards.forEach((card, index) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      const hoursReady = (hours) =>
        Array.isArray(hours) &&
        hours.some((slot) => slot && (slot.reg != null || slot.ot != null || slot.tot != null));
      const hasHours = hoursReady(card.frontHours) || hoursReady(card.backHours);
      const driver = String(card.driverName || '').trim();
      label.textContent = `${index + 1}. ${driver ? `${driver} · ` : ''}${formatWhen(card.createdAt)}${
        hasHours ? ' · Reg/OT ready' : ' · photo only'
      }`;
      const cropBtn = document.createElement('button');
      cropBtn.type = 'button';
      cropBtn.className = 'secondary';
      cropBtn.textContent = 'Crop';
      cropBtn.title = 'Choose which part of this photo prints.';
      cropBtn.addEventListener('click', () => openCrop(card));
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'secondary';
      removeBtn.textContent = 'Remove';
      removeBtn.title = 'Delete this saved print copy.';
      removeBtn.addEventListener('click', () => {
        deletePrintCard(card.id)
          .then(() => refreshList())
          .catch((error) => setPrintStatus(error?.message || 'Could not remove that copy.', 'error'));
      });
      item.append(label, cropBtn, removeBtn);
      ol.append(item);
    });
    list.append(ol);
    const sessionIds = typeof getSessionPrintIds === 'function' ? getSessionPrintIds() : [];
    const sessionIndexes = cards
      .map((card, index) => (sessionIds.includes(card.id) ? index + 1 : -1))
      .filter((n) => n > 0);
    const from = sessionIndexes.length ? Math.min(...sessionIndexes) : 1;
    const to = sessionIndexes.length ? Math.max(...sessionIndexes) : cards.length;
    if (fromInput instanceof HTMLInputElement) fromInput.value = String(from);
    if (toInput instanceof HTMLInputElement) toInput.value = String(to);
  }

  async function refreshList() {
    cards = await listPrintCards();
    if (dialog.open) paintList();
  }

  function openCrop(card) {
    cropping = card;
    cropSide = card.front ? 'front' : 'back';
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
    let blob = cropSide === 'front' ? cropping.front : cropping.back;
    if (!blob) {
      cropSide = cropping.front ? 'front' : 'back';
      blob = cropSide === 'front' ? cropping.front : cropping.back;
    }
    if (!blob) return;
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
    if (!key || (side !== 'front' && side !== 'back')) return;
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
    if (typeof onCardSaved === 'function') onCardSaved(key);
    if (dialog.open) await refreshList();
  }

  async function saveSides(id, frontFile, backFile) {
    const key = String(id || '').trim();
    if (!key || (!frontFile && !backFile)) return null;
    const front = frontFile ? await imageFileToPrintJpeg(frontFile) : null;
    const back = backFile ? await imageFileToPrintJpeg(backFile) : null;
    await upsertPrintCard(key, front, back);
    pending.delete(key);
    if (typeof onCardSaved === 'function') onCardSaved(key);
    if (dialog.open) await refreshList();
    return key;
  }

  async function syncHours(id, extraction) {
    const key = String(id || '').trim();
    if (!key || !extraction) return null;
    return attachPrintHours(key, extraction);
  }

  async function printCards(subset) {
    if (!subset.length) {
      setPrintStatus('Choose at least one card to print.', 'error');
      return;
    }
    setPrintStatus('Preparing the print job…', '');
    const result = await buildPrintPdfBlob(subset);
    const blob = result?.blob || result;
    const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
    printPdfBlob(blob);
    if (warnings.length) {
      setPrintStatus(
        `${subset.length === 1 ? 'Printing 1 card.' : `Printing ${subset.length} cards.`} ${warnings[0]}`,
        'ok'
      );
    } else {
      setPrintStatus(
        subset.length === 1 ? 'Printing 1 card.' : `Printing ${subset.length} cards.`,
        'ok'
      );
    }
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

  return {
    notePhoto,
    saveSides,
    syncHours,
    close: () => {
      if (dialog.open) dialog.close();
    },
  };
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
 *   onRetakePhoto?: (cardId: string, side: 'front' | 'back', file: File, cardNumber?: number) => void | Promise<void>,
 *   onCardReady?: (card: { front: File | null, back: File | null, sameDriver: boolean, single: boolean }) => void | Promise<void>,
 *   getCarouselCards?: () => Array<{ id: string, name: string, front: boolean, back: boolean, status: string }>,
 * }} options
 */
function mountPhoneCapture({
  setSideFile,
  setStatus,
  onPhonePhoto,
  onRetakePhoto,
  onCardReady,
  onLink,
  getCarouselCards,
}) {
  const phonePanel = document.querySelector('#timesheet-phone-capture');
  const canvas = document.querySelector('#timesheet-phone-qr');
  const phoneStatus = document.querySelector('#timesheet-phone-status');
  const refreshBtn = document.querySelector('#timesheet-phone-refresh');
  if (!phonePanel || !(canvas instanceof HTMLCanvasElement)) {
    return {
      pause() {},
      reset() {},
      currentToken() {
        return '';
      },
    };
  }

  /** @type {string} */
  let token = '';
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null;
  let starting = false;
  let pollInFlight = false;
  let pairClaimed = false;
  const seen = { front: false, back: false };
  const buffered = { front: null, back: null };

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
    const prior = token || rememberedCaptureToken('genie');
    token = '';
    rememberCaptureToken('genie', '');
    seen.front = false;
    seen.back = false;
    buffered.front = null;
    buffered.back = null;
    pairClaimed = false;
    if (prior) await closeCaptureSession(prior);
  }

  let qrUrl = '';
  let qrPaint = 0;

  function qrPixelSize() {
    const slot = canvas.parentElement;
    const css = slot instanceof HTMLElement ? Math.max(slot.clientWidth, slot.clientHeight) : 0;
    const logical = Math.max(144, Math.round(css || 144));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    return Math.min(720, Math.round(logical * ratio));
  }

  async function paintQr() {
    if (!qrUrl) return;
    const generation = ++qrPaint;
    await QRCode.toCanvas(canvas, qrUrl, {
      width: qrPixelSize(),
      margin: 1,
      color: { dark: '#1f4b66', light: '#ffffff' },
    });
    if (generation !== qrPaint) return;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }

  async function drawQr(url) {
    qrUrl = url;
    await paintQr();
  }

  if (typeof ResizeObserver !== 'undefined' && canvas.parentElement instanceof HTMLElement) {
    let lastSize = 0;
    const observer = new ResizeObserver(() => {
      const next = qrPixelSize();
      if (!qrUrl || Math.abs(next - lastSize) < 32) return;
      lastSize = next;
      paintQr().catch(() => null);
    });
    observer.observe(canvas.parentElement);
  }

  async function pullSide(side) {
    if (seen[side]) return;
    const file = await fetchCapturePhoto(token, side);
    buffered[side] = file;
    seen[side] = true;
    if (typeof onPhonePhoto === 'function') {
      await onPhonePhoto(side, file, token);
    }
  }

  function cardSettled(session) {
    const frontDone = Boolean(session?.front || session?.skipFront);
    const backDone = Boolean(session?.back || session?.skipBack);
    return frontDone && backDone && (seen.front || seen.back);
  }

  async function publishCards() {
    if (!token || typeof getCarouselCards !== 'function') return;
    try {
      await publishCaptureCards(token, getCarouselCards());
    } catch {
      /* Phone list is best-effort; scanning can continue. */
    }
  }

  async function claimPairForNextCard(session) {
    if (pairClaimed || !token) return;
    pairClaimed = true;
    try {
      const front = buffered.front;
      const back = buffered.back;
      const sameDriver = Boolean(session?.sameDriver);
      const single = Boolean(session?.skipFront || session?.skipBack);
      // Desk clears the shared photos only after the downloads succeed, so the
      // phone never races us and leaves a side stuck on Waiting…
      await restartCaptureSession(token);
      seen.front = false;
      seen.back = false;
      buffered.front = null;
      buffered.back = null;
      pairClaimed = false;
      await publishCards();
      setPhoneStatus('');
      if (typeof onCardReady === 'function') {
        await onCardReady({ front, back, sameDriver, single });
      } else {
        if (front) setSideFile('front', front);
        if (back) setSideFile('back', back);
        const label = front && back ? 'Front and back' : front ? 'Front' : 'Back';
        setStatus(`${label} arrived from your phone. Ready to read.`, 'ok');
      }
    } catch (error) {
      pairClaimed = false;
      setPhoneStatus(error?.message || 'Could not reset the phone link for the next card.', 'error');
    }
  }

  async function claimRetake(cardId, side, cardNumber = 1) {
    if (pairClaimed || !token) return;
    pairClaimed = true;
    try {
      const file = await fetchCapturePhoto(token, side);
      if (typeof onRetakePhoto === 'function') {
        await onRetakePhoto(cardId, side, file, cardNumber);
      } else {
        setSideFile(side, file);
      }
      await restartCaptureSession(token);
      seen.front = false;
      seen.back = false;
      buffered.front = null;
      buffered.back = null;
      pairClaimed = false;
      await publishCards();
      setPhoneStatus(`Rescan ${side} received. Ready for the next card.`, 'ok');
      setStatus(`Phone rescan for ${side} is in. Re-reading that card…`, 'ok');
    } catch (error) {
      pairClaimed = false;
      setPhoneStatus(error?.message || 'Could not apply that phone rescan.', 'error');
    }
  }

  async function pollOnce() {
    if (!token || pollInFlight) return;
    pollInFlight = true;
    try {
      const session = await readCaptureSession(token);
      if (!session) {
        setPhoneStatus('That photo link is closed. Make a new QR code.', 'error');
        stopPolling();
        return;
      }
      if (session.retake?.cardId && session.retake?.side) {
        const side = session.retake.side === 'back' ? 'back' : 'front';
        const cardNumber = Number(session.retake.card) > 1 ? Number(session.retake.card) : 1;
        if (session[side]) {
          await claimRetake(session.retake.cardId, side, cardNumber);
          return;
        }
        setPhoneStatus(
          `Waiting for phone rescan of ${side}…`,
          ''
        );
        return;
      }
      // After we claim a pair we restart the link; empty + partial seen means a
      // photo vanished before both sides arrived here.
      if (!session.front && !session.back && !session.skipFront && !session.skipBack && (seen.front || seen.back) && !pairClaimed) {
        if (seen.front && seen.back) {
          seen.front = false;
          seen.back = false;
          buffered.front = null;
          buffered.back = null;
          setPhoneStatus('');
          return;
        }
        const missing = seen.front ? 'back' : 'front';
        seen.front = false;
        seen.back = false;
        buffered.front = null;
        buffered.back = null;
        setPhoneStatus(
          `The ${missing} photo disappeared before it arrived here. Take both sides again.`,
          'error'
        );
        return;
      }
      if (session.front && !seen.front) await pullSide('front');
      if (session.back && !seen.back) await pullSide('back');
      if (cardSettled(session)) {
        await claimPairForNextCard(session);
        return;
      }
      if (session.skipFront && !seen.back) setPhoneStatus('Front skipped. Waiting for the back…', '');
      else if (session.skipBack && !seen.front) setPhoneStatus('Back skipped. Waiting for the front…', '');
      else if (seen.front && !session.skipBack) setPhoneStatus('Front is in. Waiting for the back…', '');
      else if (seen.back && !session.skipFront) setPhoneStatus('Back is in. Waiting for the front…', '');
      else setPhoneStatus('');
    } catch (error) {
      setPhoneStatus(error?.message || 'Could not check for phone photos.', 'error');
    } finally {
      pollInFlight = false;
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
          'This computer’s address is not reachable from a phone. Use the office app on this network.'
        );
      }
      token = opened.token;
      rememberCaptureToken('genie', token);
      await drawQr(url);
      setPhoneStatus('');
      pollTimer = setInterval(() => {
        pollOnce().catch(() => {});
      }, 1500);
      await pollOnce();
      if (typeof onLink === 'function') onLink();
    } catch (error) {
      setPhoneStatus(error?.message || 'Could not start phone capture.', 'error');
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    } finally {
      starting = false;
    }
  }

  refreshBtn?.addEventListener('click', () => {
    startSession().catch((error) => {
      setPhoneStatus(error?.message || 'Could not make a new QR code.', 'error');
    });
  });

  window.addEventListener('pagehide', (event) => {
    if (event.persisted || !token) return;
    closeCaptureSession(token, { keepalive: true });
  });

  function genieVisible() {
    const view = document.querySelector('#timecard-genie-view');
    return view instanceof HTMLElement && !view.hidden;
  }

  phonePanel.hidden = false;
  if (genieVisible()) {
    startSession().catch((error) => {
      setPhoneStatus(error?.message || 'Could not start phone capture.', 'error');
    });
  }

  return {
    pause() {
      stopPolling();
    },
    resume() {
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
  const parts = parseStampParts(raw);
  const hints = stampHints(parts.illegible);
  stamp.classList.toggle('is-illegible', parts.illegible);
  for (const part of ['month', 'day', 'period', 'time']) {
    const input = stamp.querySelector(`[data-part="${part}"]`);
    if (input instanceof HTMLInputElement) input.placeholder = hints[part];
  }
  const note = stamp.querySelector('.timesheet-stamp-note');
  if (!(note instanceof HTMLElement)) return;
  if (parts.handwriting) {
    note.hidden = false;
    note.textContent = 'HANDWRITING';
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
      aria-label="${escapeAttr(label)}" title="${escapeAttr(text ? `Edit the Description of Work. ${text}` : 'Add the Description of Work for this clock line.')}">
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

  /** @type {{ side: 'front' | 'back', index: number, extraIndex: number, button: HTMLButtonElement } | null} */
  let editing = null;

  function close() {
    if (dialog.open) dialog.close();
  }

  function applyPreview(button, value) {
    const text = String(value ?? '').trim();
    const empty = !text;
    button.classList.toggle('is-empty', empty);
    button.textContent = empty ? '+' : '✎';
    button.title = text
      ? `Edit the Description of Work. ${text}`
      : 'Add the Description of Work for this clock line.';
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
    const rows = getRows(editing.side, editing.extraIndex);
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
     * @param {number} [extraIndex]
     */
    open(side, index, button, extraIndex = -1) {
      const rows = getRows(side, extraIndex);
      const row = Array.isArray(rows) ? rows[index - 1] : null;
      if (!row) return;
      editing = { side, index, extraIndex, button };
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

const STAMP_HINTS = { month: 'oct', day: '7', period: 'AM', time: '8:50' };
const ILLEGIBLE_HINTS = { month: '?', day: '?', period: '?', time: '?' };

function stampHints(illegible) {
  return illegible ? ILLEGIBLE_HINTS : STAMP_HINTS;
}

/**
 * One clock line from the AI list prints as one record. A row that already
 * holds both an Out and an In still shows both.
 * @param {object | null | undefined} row
 * @param {number} rowIndex
 */
function clockRecordHtml(row, rowIndex) {
  const hasOut = Boolean(stampText(row?.clock_out_raw));
  const hasIn = Boolean(stampText(row?.clock_in_raw));
  if (hasIn && !hasOut) return stampEditorHtml('in', row.clock_in_raw, rowIndex);
  if (hasOut && !hasIn) return stampEditorHtml('out', row.clock_out_raw, rowIndex);
  return `${stampEditorHtml('out', row?.clock_out_raw, rowIndex)}${stampEditorHtml('in', row?.clock_in_raw, rowIndex)}`;
}

/**
 * @param {object | null | undefined} row
 * @param {{ outLabel?: string, inLabel?: string, outIllegible?: boolean, inIllegible?: boolean }} snapped
 */
function snapRecordHtml(row, snapped) {
  const out = `<div class="timesheet-snap-stamp">
          <span class="timesheet-card-label">Out</span>
          <span class="timesheet-snap-value${snapped?.outIllegible ? ' is-illegible' : ''}">${escapeHtml(snapped?.outLabel || '—')}</span>
        </div>`;
  const inn = `<div class="timesheet-snap-stamp">
          <span class="timesheet-card-label">In</span>
          <span class="timesheet-snap-value${snapped?.inIllegible ? ' is-illegible' : ''}">${escapeHtml(snapped?.inLabel || '—')}</span>
        </div>`;
  const hasOut = Boolean(stampText(row?.clock_out_raw));
  const hasIn = Boolean(stampText(row?.clock_in_raw));
  if (hasIn && !hasOut) return inn;
  if (hasOut && !hasIn) return out;
  return `${out}${inn}`;
}

/**
 * Always show the four stamp fields. An illegible clock shows question marks
 * instead of the sample fillers. HANDWRITING stays as a red note so an admin
 * can type a real stamp over it.
 * @param {'out' | 'in'} which
 * @param {string | null | undefined} raw
 * @param {number} rowIndex
 */
function stampEditorHtml(which, raw, rowIndex) {
  const label = which === 'out' ? 'Out' : 'In';
  const parts = parseStampParts(raw);
  const blocked = parts.handwriting || parts.illegible;
  const note = parts.handwriting ? 'HANDWRITING' : '';
  const hints = stampHints(parts.illegible);
  const month = blocked ? '' : parts.month;
  const day = blocked ? '' : parts.day;
  const period = blocked ? '' : parts.period;
  const time = blocked ? '' : parts.time;
  return `<div class="timesheet-stamp timesheet-stamp-${which}${parts.illegible ? ' is-illegible' : ''}" data-stamp="${which}">
    <span class="timesheet-card-label">${label}</span>
    <span class="timesheet-stamp-parts">
      <input class="timesheet-edit" data-part="month" type="text" maxlength="3"
        value="${escapeAttr(month)}" placeholder="${hints.month}" aria-label="${label} month row ${rowIndex}">
      <input class="timesheet-edit" data-part="day" type="text" maxlength="2"
        value="${escapeAttr(day)}" placeholder="${hints.day}" aria-label="${label} day row ${rowIndex}">
      <input class="timesheet-edit" data-part="period" type="text" maxlength="2"
        value="${escapeAttr(period)}" placeholder="${hints.period}" aria-label="${label} AM or PM row ${rowIndex}">
      <input class="timesheet-edit" data-part="time" type="text" maxlength="5"
        value="${escapeAttr(time)}" placeholder="${hints.time}" aria-label="${label} time row ${rowIndex}">
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
