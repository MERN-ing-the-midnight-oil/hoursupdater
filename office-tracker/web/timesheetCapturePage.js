const params = new URLSearchParams(window.location.search);
const token = params.get('t')?.trim() || '';
const savedSide = params.get('saved')?.trim().toLowerCase() || '';
const errParam = params.get('err')?.trim() || '';
const deskName = params.get('desk') === 'audit' ? 'Blue Timecard Checker' : 'Timecard Genie';
const appName = document.querySelector('.app-name');
if (appName) appName.textContent = deskName;
document.title = `${deskName} photos`;

const title = document.querySelector('#timesheet-capture-title');
const lead = document.querySelector('#timesheet-capture-lead');
if (lead && !lead.textContent.includes(deskName)) {
  lead.textContent = `Take the front, then the back. Photos go straight to the ${deskName} desk on the computer.`;
}
const status = document.querySelector('#timesheet-capture-status');
const main = document.querySelector('#timesheet-capture-main');
const frontPill = document.querySelector('#timesheet-capture-front-pill');
const backPill = document.querySelector('#timesheet-capture-back-pill');
const hint = document.querySelector('#timesheet-capture-hint');
const nativeText = document.querySelector('#timesheet-capture-native-text');
const nativeBtn = document.querySelector('#timesheet-capture-native');
const libraryWrap = document.querySelector('#timesheet-capture-library');
const cameraForm = document.querySelector('#timesheet-capture-form-camera');
const libraryForm = document.querySelector('#timesheet-capture-form-library');
const cameraInput = document.querySelector('#timesheet-capture-file');
const libraryInput = document.querySelector('#timesheet-capture-library-file');

/** @type {{ front: boolean, back: boolean, ready: boolean } | null} */
let session = null;
/** @type {'front' | 'back'} */
let side = 'front';
let submitting = false;

function setStatus(message, kind = '') {
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || '';
  status.className = `status${kind ? ` is-${kind}` : ''}`;
}

function uploadAction(forSide) {
  return `/api/timesheet-capture-upload/${encodeURIComponent(token)}/${forSide}`;
}

function wireForms() {
  if (!(cameraForm instanceof HTMLFormElement) || !(libraryForm instanceof HTMLFormElement)) return;
  cameraForm.action = uploadAction(side);
  libraryForm.action = uploadAction(side);
}

function paint() {
  frontPill?.classList.toggle('is-done', Boolean(session?.front));
  frontPill?.classList.toggle('is-active', side === 'front' && !session?.front);
  backPill?.classList.toggle('is-done', Boolean(session?.back));
  backPill?.classList.toggle('is-active', side === 'back' && !session?.back);

  const takeLabel = side === 'front' ? 'Take front photo' : 'Take back photo';
  if (nativeText) nativeText.textContent = takeLabel;
  wireForms();

  const done = Boolean(session?.ready);
  if (nativeBtn instanceof HTMLElement) nativeBtn.hidden = done;
  if (libraryWrap instanceof HTMLElement) libraryWrap.hidden = done;
  if (cameraForm instanceof HTMLElement) cameraForm.hidden = done;
  if (libraryForm instanceof HTMLElement) libraryForm.hidden = done;

  if (done) {
    if (title) title.textContent = 'Photos sent';
    if (lead) {
      lead.textContent =
        `Front and back are on the ${deskName} desk. You can close this page and finish on the computer.`;
    }
    if (hint) hint.textContent = 'Both sides arrived on the computer.';
    return;
  }

  if (side === 'back') {
    if (title) title.textContent = 'Back of the card';
    if (lead) lead.textContent = 'Flip the card, then take or choose the back photo.';
  } else {
    if (title) title.textContent = 'Front of the card';
    if (lead) {
      lead.textContent =
        'Take or choose the front photo. This page will reload when the computer has it.';
    }
  }
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
  paint();
  return session;
}

function clearQueryNoise() {
  if (!savedSide && !errParam) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('saved');
  url.searchParams.delete('err');
  window.history.replaceState({}, '', url);
}

function submitOnPick(input, form) {
  if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return;
  input.addEventListener('change', () => {
    if (!input.files?.length || submitting) return;
    submitting = true;
    setStatus(`Sending the ${side} photo…`, '');
    wireForms();
    form.submit();
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

  if (errParam) {
    setStatus(errParam, 'error');
  } else if (savedSide === 'front' || savedSide === 'back') {
    setStatus(
      session?.ready
        ? 'Front and back are on the computer.'
        : `${savedSide === 'front' ? 'Front' : 'Back'} received. ${
            side === 'back' ? 'Take the back next.' : 'Take the front next.'
          }`,
      'ok'
    );
  } else if (session?.ready) {
    setStatus('Front and back are already on the computer.', 'ok');
  } else {
    setStatus('Tap Take photo (Camera) or Choose from Photos.', '');
  }

  clearQueryNoise();
  paint();
  submitOnPick(cameraInput, cameraForm);
  submitOnPick(libraryInput, libraryForm);
}

boot();
