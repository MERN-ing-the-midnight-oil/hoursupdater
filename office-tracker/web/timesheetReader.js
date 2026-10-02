import { driverForDate } from '../src/assignments.js';
import { payrollDriverRows } from '../src/payrollTimes.js';
import {
  compareCardToContract,
  contractDailyHours,
  dashboardSchoolCalendar,
  formatContractClocks,
  matchPayrollRow,
  payrollRowKey,
  payrollRowLabel,
} from '../src/timesheetMath.js';

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const CAMERA_KEY = 'teamster-timesheet-camera';
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
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0);
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
  const exact = deviceId ? { video: { deviceId: { exact: deviceId } }, audio: false } : null;
  try {
    return await navigator.mediaDevices.getUserMedia(exact || { video: true, audio: false });
  } catch (error) {
    if (!deviceId) throw error;
    forgetCamera();
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
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
 * Timesheet reader desk. It reads dashboard state and never writes it.
 * @param {{ readState: () => object, asOf: () => string }} options
 */
export function mountTimesheetReader({ readState, asOf }) {
  const view = document.querySelector('#timesheet-view');
  const form = document.querySelector('#timesheet-form');
  const status = document.querySelector('#timesheet-status');
  const result = document.querySelector('#timesheet-result');
  const driverSelect = document.querySelector('#timesheet-driver');
  if (!view || !form || !status || !result || !driverSelect) {
    return { refresh() {} };
  }

  /** @type {object[]} */
  let contractRows = [];
  /** @type {object | null} */
  let officeState = null;
  let asOfDate = '';
  /** @type {object | null} */
  let extraction = null;
  let selectedKey = '';

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
  driverSelect.addEventListener('change', () => {
    selectedKey = driverSelect.value;
    renderResult();
  });

  function setStatus(message, kind) {
    status.hidden = !message;
    status.textContent = message || '';
    status.className = kind ? `status is-${kind}` : 'status';
  }

  function contractRowsNow() {
    officeState = readState();
    asOfDate = asOf();
    return payrollDriverRows(officeState, { asOf: asOfDate });
  }

  function optionLabel(row) {
    const profile = Object.values(officeState?.profiles ?? {}).find(
      (item) => String(item?.name ?? '') === String(row.route ?? '')
    );
    const name = profile ? driverForDate(profile, asOfDate) : '';
    if (name && row.route) return `${name} · Route ${row.route}`;
    if (name) return name;
    return payrollRowLabel(row);
  }

  function selectedRow() {
    return contractRows.find((row) => payrollRowKey(row) === selectedKey) ?? null;
  }

  function fillDrivers() {
    const previous = selectedKey;
    driverSelect.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = contractRows.length
      ? 'Choose a driver'
      : 'No drivers on the dashboard yet';
    driverSelect.append(placeholder);
    for (const row of contractRows) {
      const option = document.createElement('option');
      option.value = payrollRowKey(row);
      option.textContent = optionLabel(row);
      driverSelect.append(option);
    }
    if (previous && contractRows.some((row) => payrollRowKey(row) === previous)) {
      driverSelect.value = previous;
      selectedKey = previous;
    } else if (extraction) {
      const match = matchPayrollRow(contractRows, extraction.header);
      selectedKey = match ? payrollRowKey(match) : '';
      driverSelect.value = selectedKey;
    } else {
      selectedKey = '';
      driverSelect.value = '';
    }
  }

  function refresh() {
    contractRows = contractRowsNow();
    fillDrivers();
    if (extraction) renderResult();
  }

  function renderResult() {
    if (!extraction) {
      result.hidden = true;
      return;
    }
    result.hidden = false;
    const row = selectedRow();
    const who = extraction.header?.employee_name || 'Unread name';
    const route = extraction.header?.route_number ? ` · route ${extraction.header.route_number}` : '';
    const cardDate = extraction.header?.date_on_card ? ` · card date ${extraction.header.date_on_card}` : '';
    document.querySelector('#timesheet-who').textContent = `${who}${route}${cardDate}`;
    const clocks = formatContractClocks(row);
    const daily = contractDailyHours(row);
    document.querySelector('#timesheet-contract').textContent = row
      ? `Current contracted clocks: ${clocks || 'none recorded'}. Contracted day: ${daily.toFixed(2)} hours.`
      : 'Choose the driver on the dashboard to compare these stamps with current contracted clocks.';

    const comparison = compareCardToContract(
      extraction,
      daily,
      dashboardSchoolCalendar()
    );
    document.querySelector('#timesheet-period').textContent = comparison.label;
    const table = document.querySelector('#timesheet-compare');
    table.innerHTML = `<thead><tr>
      <th scope="col">Day</th>
      <th scope="col">Contract hours</th>
      <th scope="col">Clock hours</th>
      <th scope="col">Clock − contract</th>
      <th scope="col">Regular</th>
      <th scope="col">Overtime</th>
    </tr></thead>`;
    const body = document.createElement('tbody');
    for (const day of comparison.days) {
      const tr = document.createElement('tr');
      if (day.clockHours === 0 && day.contractHours === 0) tr.className = 'is-quiet';
      tr.innerHTML = `
        <th scope="row">${escapeHtml(day.label)}</th>
        <td>${day.contractHours.toFixed(2)}</td>
        <td>${day.clockHours.toFixed(2)}</td>
        <td class="${differenceClass(day.difference)}">${formatDifference(day.difference)}</td>
        <td>${day.regular.toFixed(2)}</td>
        <td>${day.overtime.toFixed(2)}</td>`;
      body.append(tr);
    }
    const totals = comparison.totals;
    const totalRow = document.createElement('tr');
    totalRow.innerHTML = `
      <th scope="row">Period</th>
      <td>${totals.contractHours.toFixed(2)}</td>
      <td>${totals.clockHours.toFixed(2)}</td>
      <td class="${differenceClass(totals.difference)}">${formatDifference(totals.difference)}</td>
      <td>${totals.regular.toFixed(2)}</td>
      <td>${totals.overtime.toFixed(2)}</td>`;
    body.append(totalRow);
    table.append(body);

    const stamps = document.querySelector('#timesheet-stamps');
    stamps.innerHTML = `<thead><tr>
      <th scope="col">Side</th>
      <th scope="col">Slot</th>
      <th scope="col">Out</th>
      <th scope="col">In</th>
      <th scope="col">Hours</th>
      <th scope="col">Note</th>
    </tr></thead>`;
    const stampBody = document.createElement('tbody');
    const visible = stampRows(extraction);
    if (!visible.length) {
      const empty = document.createElement('tr');
      empty.innerHTML = '<td colspan="6">No stamps were read on this card.</td>';
      stampBody.append(empty);
    }
    for (const stamp of visible) {
      const tr = document.createElement('tr');
      if (stamp.crossed_out) tr.className = 'is-quiet';
      tr.innerHTML = `
        <td>${escapeHtml(stamp.side)}</td>
        <td>${stamp.row_index}</td>
        <td>${escapeHtml(stamp.clock_out_raw || '')}</td>
        <td>${escapeHtml(stamp.clock_in_raw || '')}</td>
        <td>${escapeHtml(hoursText(stamp))}</td>
        <td>${escapeHtml(stamp.confidence_note || stamp.description_of_work || '')}</td>`;
      stampBody.append(tr);
    }
    stamps.append(stampBody);

    const caveats = document.querySelector('#timesheet-caveats');
    const notes = extraction.caveats ?? [];
    caveats.hidden = notes.length === 0;
    caveats.textContent = notes.join(' ');
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
    button.disabled = true;
    setStatus('Reading the card…', '');
    try {
      const response = await fetch('/api/timesheet-extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          front: front ? await filePayload(front) : null,
          back: back ? await filePayload(back) : null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Could not read that card.');
      }
      extraction = payload.extraction;
      contractRows = contractRowsNow();
      const match = matchPayrollRow(contractRows, extraction.header);
      selectedKey = match ? payrollRowKey(match) : '';
      fillDrivers();
      renderResult();
      setStatus(
        match
          ? `Read the card and matched ${optionLabel(match)}.`
          : 'Read the card. Choose the driver to compare contracted clocks.',
        'ok'
      );
    } finally {
      button.disabled = false;
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
    extraction = null;
    selectedKey = '';
    camera.close();
    form.reset();
    clearSidePreview('front');
    clearSidePreview('back');
    result.hidden = true;
    fillDrivers();
    setStatus('');
  }

  return { refresh };
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

function stampRows(extraction) {
  const sides = [
    ['Front', extraction.front_rows ?? []],
    ['Back', extraction.back_rows ?? []],
  ];
  const rows = [];
  for (const [side, list] of sides) {
    for (const row of list) {
      const hasStamp = row.clock_in_raw || row.clock_out_raw || row.total_hours != null;
      const hasNote = row.description_of_work || row.confidence_note;
      if (!hasStamp && !hasNote) continue;
      rows.push({ ...row, side });
    }
  }
  return rows;
}

function hoursText(row) {
  if (row.total_hours == null || row.total_hours === '') return '';
  return String(row.total_hours);
}

function formatDifference(value) {
  if (value === 0) return '0.00';
  const text = Math.abs(value).toFixed(2);
  return value > 0 ? `+${text}` : `−${text}`;
}

function differenceClass(value) {
  if (value > 0) return 'timesheet-diff is-over';
  if (value < 0) return 'timesheet-diff is-under';
  return 'timesheet-diff';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
