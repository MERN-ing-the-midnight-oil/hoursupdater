const params = new URLSearchParams(window.location.search);
const token = params.get('t')?.trim() || '';
const savedSide = params.get('saved')?.trim().toLowerCase() || '';
const errParam = params.get('err')?.trim() || '';
const deskName = params.get('desk') === 'audit' ? 'Blue Timecard Checker' : 'Timecard Genie';
const appName = document.querySelector('.app-name');
if (appName) appName.textContent = deskName;
document.title = `${deskName} photos`;

const status = document.querySelector('#timesheet-capture-status');
const main = document.querySelector('#timesheet-capture-main');
const busy = document.querySelector('#timesheet-capture-busy');
const busyText = document.querySelector('#timesheet-capture-busy-text');
const nativeText = document.querySelector('#timesheet-capture-native-text');
const nativeBtn = document.querySelector('#timesheet-capture-native');
const cameraForm = document.querySelector('#timesheet-capture-form-camera');
const cameraInput = document.querySelector('#timesheet-capture-file');

/** @type {{ front: boolean, back: boolean, ready: boolean } | null} */
let session = null;
/** @type {'front' | 'back'} */
let side = 'front';
let submitting = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let backButtonTimer = null;

function setStatus(message, kind = '') {
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || '';
  status.className = `status${kind ? ` is-${kind}` : ''}`;
}

function showBusy(message) {
  if (busyText) busyText.textContent = message || 'Sending photo…';
  if (busy instanceof HTMLElement) busy.hidden = false;
  if (cameraForm instanceof HTMLElement) cameraForm.hidden = true;
  if (nativeBtn instanceof HTMLElement) nativeBtn.hidden = true;
}

function hideBusy() {
  if (busy instanceof HTMLElement) busy.hidden = true;
}

function hideCameraButton() {
  if (cameraForm instanceof HTMLElement) cameraForm.hidden = true;
  if (nativeBtn instanceof HTMLElement) nativeBtn.hidden = true;
}

function clearBackButtonTimer() {
  if (backButtonTimer != null) {
    clearTimeout(backButtonTimer);
    backButtonTimer = null;
  }
}

function uploadAction(forSide) {
  return `/api/timesheet-capture-upload/${encodeURIComponent(token)}/${forSide}`;
}

function paintFront() {
  clearBackButtonTimer();
  hideBusy();
  side = 'front';
  if (nativeText) nativeText.textContent = 'Take front photo';
  if (cameraForm instanceof HTMLElement) cameraForm.hidden = false;
  if (nativeBtn instanceof HTMLElement) nativeBtn.hidden = false;
}

function paintBackButton() {
  clearBackButtonTimer();
  hideBusy();
  side = 'back';
  if (nativeText) nativeText.textContent = 'Take back photo';
  if (cameraForm instanceof HTMLElement) cameraForm.hidden = false;
  if (nativeBtn instanceof HTMLElement) nativeBtn.hidden = false;
}

function openCamera() {
  if (!(cameraInput instanceof HTMLInputElement) || submitting) return;
  cameraInput.value = '';
  requestAnimationFrame(() => {
    try {
      cameraInput.click();
    } catch {
      /* iOS may block programmatic camera open; the back button stays available. */
    }
  });
}

function offerBackCamera() {
  side = 'back';
  setStatus('');
  // Front button stays gone. Keep the spinner while we try to open the camera.
  showBusy('Opening back camera…');
  hideCameraButton();
  openCamera();
  clearBackButtonTimer();
  // If the OS blocked auto-open, show Take back photo only — never Take front photo.
  backButtonTimer = setTimeout(() => {
    if (side === 'back' && !submitting && session && !session.back) {
      paintBackButton();
    }
  }, 900);
}

async function refreshSession() {
  const response = await fetch(`/api/timesheet-capture/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    throw new Error(body?.error || 'This photo link is not valid or has expired.');
  }
  session = {
    front: Boolean(body?.front),
    back: Boolean(body?.back),
    ready: Boolean(body?.ready),
  };
  if (!session.front) side = 'front';
  else if (!session.back) side = 'back';
  return session;
}

function clearQueryNoise() {
  if (!savedSide && !errParam) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('saved');
  url.searchParams.delete('err');
  window.history.replaceState({}, '', url);
}

function errorFromUploadResponse(response) {
  const location = response.headers.get('Location') || '';
  if (!location) return '';
  try {
    return new URL(location, window.location.origin).searchParams.get('err') || '';
  } catch {
    return '';
  }
}

async function uploadPhoto(file) {
  const formData = new FormData();
  formData.append('photo', file, file.name || `${side}-timecard.jpg`);
  const response = await fetch(uploadAction(side), {
    method: 'POST',
    body: formData,
    redirect: 'manual',
  });
  if (response.status === 303 || response.type === 'opaqueredirect') {
    const err = errorFromUploadResponse(response);
    if (err) throw new Error(err);
    return;
  }
  if (response.ok) return;
  const type = response.headers.get('content-type') || '';
  const body = type.includes('json') ? await response.json().catch(() => null) : null;
  throw new Error(
    body?.error || errorFromUploadResponse(response) || 'That photo could not be saved.'
  );
}

async function restartCapture() {
  if (!token) return;
  const response = await fetch(`/api/timesheet-capture/${encodeURIComponent(token)}/restart`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    throw new Error(body?.error || 'Could not start the next card. Scan a new QR code.');
  }
  session = {
    front: Boolean(body?.front),
    back: Boolean(body?.back),
    ready: Boolean(body?.ready),
  };
  side = 'front';
  if (cameraInput instanceof HTMLInputElement) cameraInput.value = '';
}

/**
 * Keep both photos on the server until the desk downloads them and restarts
 * the link. Clearing earlier races the desk poll and leaves Back as Waiting…
 */
async function waitForDeskThenNextCard() {
  clearBackButtonTimer();
  showBusy('Photos sent. Waiting for the desk…');
  hideCameraButton();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const live = await refreshSession();
      if (!live.front && !live.back) return;
    } catch {
      // Link expired or closed — treat as done so the phone can continue.
      return;
    }
  }
  // Desk never claimed the pair; clear so this phone can shoot the next card.
  await restartCapture();
}

async function afterPhotoSaved(which) {
  if (which === 'front') {
    session = { front: true, back: false, ready: false };
    submitting = false;
    offerBackCamera();
    return;
  }

  session = { front: true, back: true, ready: true };
  try {
    await waitForDeskThenNextCard();
    submitting = false;
    setStatus('');
    paintFront();
    openCamera();
  } catch (error) {
    submitting = false;
    paintFront();
    setStatus(error?.message || 'Could not start the next card. Scan a new QR code.', 'error');
  }
}

function submitOnPick(input) {
  if (!(input instanceof HTMLInputElement)) return;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file || submitting) return;
    submitting = true;
    const which = side;
    clearBackButtonTimer();
    showBusy(which === 'front' ? 'Sending front photo…' : 'Sending back photo…');
    hideCameraButton();
    setStatus('');
    uploadPhoto(file)
      .then(() => afterPhotoSaved(which))
      .catch((error) => {
        submitting = false;
        if (which === 'front') paintFront();
        else paintBackButton();
        setStatus(error?.message || 'That photo could not be saved.', 'error');
        if (cameraInput instanceof HTMLInputElement) cameraInput.value = '';
      });
  });
}

async function boot() {
  if (!token) {
    setStatus(`This photo link is missing. Scan the QR code from ${deskName} again.`, 'error');
    return;
  }

  try {
    await refreshSession();
  } catch (error) {
    setStatus(error?.message || 'This photo link is not valid or has expired.', 'error');
    return;
  }

  if (main) main.hidden = false;
  clearQueryNoise();
  submitOnPick(cameraInput);

  if (errParam) {
    setStatus(errParam, 'error');
    if (session?.front && !session?.back) paintBackButton();
    else paintFront();
    return;
  }

  if (savedSide === 'back' || session?.ready) {
    try {
      await waitForDeskThenNextCard();
      setStatus('');
      paintFront();
      openCamera();
    } catch (error) {
      paintFront();
      setStatus(error?.message || 'Could not start the next card. Scan a new QR code.', 'error');
    }
    return;
  }

  if (savedSide === 'front' || (session?.front && !session?.back)) {
    offerBackCamera();
    return;
  }

  setStatus('');
  paintFront();
}

boot();
