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
const carousel = document.querySelector('#timesheet-capture-carousel');
const cardsRoot = document.querySelector('#timesheet-capture-cards');
const periodSelect = document.querySelector('#timesheet-capture-period');
const cardPick = document.querySelector('#timesheet-capture-card-pick');
const sidePick = document.querySelector('#timesheet-capture-side-pick');
const retakeBtn = document.querySelector('#timesheet-capture-retake');
const retakeCancelBtn = document.querySelector('#timesheet-capture-retake-cancel');
const skipBtn = document.querySelector('#timesheet-capture-skip');
const sameBtn = document.querySelector('#timesheet-capture-same');
const genieScanner = params.get('desk') !== 'audit';

/** @type {{
 *   front: boolean,
 *   back: boolean,
 *   skipFront: boolean,
 *   skipBack: boolean,
 *   sameDriver: boolean,
 *   ready: boolean,
 *   cards: Array<{ id: string, name: string, employee?: string, periodKey?: string, periodLabel?: string, card?: number, front: boolean, back: boolean, status: string }>,
 *   retake: { cardId: string, side: 'front' | 'back', card?: number } | null,
 * } | null} */
let session = null;
/** @type {'front' | 'back'} */
let side = 'front';
let submitting = false;
/** True after a front and back have been sent, so the next front is a new card. */
let nextCardFront = false;
/** Cards already handed to the desk from this phone. */
let finishedCards = 0;
/** Next photos stay with the driver already on the desk. */
let sameDriverNext = false;
/** @type {{ cardId: string, side: 'front' | 'back', card: number, name: string } | null} */
let activeRetake = null;
/** The pay-period picker is open on top of the camera. */
let retakePickerOpen = false;
/** @type {string} */
let pickerPeriod = '';
/** @type {string} */
let pickerEmployee = '';
/** `${id}:${card}` for the physical card chosen in the picker. */
let pickerCardKey = '';
/** Skip redrawing the picker when a poll has not changed the choices. */
let pickerSignature = '';
/** @type {ReturnType<typeof setTimeout> | null} */
let backButtonTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let cardsPollTimer = null;

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

function retakeCameraLabel() {
  if (!activeRetake) return '';
  const which = activeRetake.side === 'back' ? 'Back' : 'Front';
  return `Rescan ${which} · Card ${activeRetake.card} · ${activeRetake.name}`;
}

function frontButtonLabel() {
  if (activeRetake) return retakeCameraLabel();
  if (sameDriverNext) return 'Take front photo · same driver';
  const scanned = Array.isArray(session?.cards) && session.cards.length > 0;
  if (nextCardFront || scanned) return 'Take next card front photo';
  return 'Take front photo';
}

function sessionFromBody(body, fallbackCards) {
  return {
    front: Boolean(body?.front),
    back: Boolean(body?.back),
    skipFront: Boolean(body?.skipFront),
    skipBack: Boolean(body?.skipBack),
    sameDriver: Boolean(body?.sameDriver),
    ready: Boolean(body?.ready),
    cards: Array.isArray(body?.cards) ? body.cards : fallbackCards || [],
    retake:
      body?.retake && typeof body.retake === 'object'
        ? {
            cardId: String(body.retake.cardId || ''),
            side: body.retake.side === 'back' ? 'back' : 'front',
            card: Number(body.retake.card) > 1 ? Number(body.retake.card) : 1,
          }
        : null,
  };
}

function paintChoiceButtons() {
  if (skipBtn instanceof HTMLButtonElement) {
    skipBtn.hidden = !genieScanner || Boolean(activeRetake) || submitting;
    skipBtn.textContent = side === 'back' ? 'Skip back' : 'Skip front';
  }
  const idle =
    !session?.front && !session?.back && !session?.skipFront && !session?.skipBack && side === 'front';
  const knownCards = finishedCards > 0 || (Array.isArray(session?.cards) && session.cards.length > 0);
  if (sameBtn instanceof HTMLButtonElement) {
    sameBtn.hidden = !genieScanner || Boolean(activeRetake) || submitting || retakePickerOpen || !idle || !knownCards;
    sameBtn.setAttribute('aria-pressed', sameDriverNext ? 'true' : 'false');
    const sameText = document.querySelector('#timesheet-capture-same-text');
    const sameLabel = sameDriverNext ? 'Same driver — tap for a new driver' : 'Another card, same driver';
    if (sameText) sameText.textContent = sameLabel;
    else sameBtn.textContent = sameLabel;
  }
  if (retakeBtn instanceof HTMLButtonElement) {
    retakeBtn.hidden = !genieScanner || Boolean(activeRetake) || submitting || retakePickerOpen || !idle || !knownCards;
  }
}

function markNextCardFront() {
  nextCardFront = true;
  if (nativeText && !activeRetake) nativeText.textContent = frontButtonLabel();
}

function paintFront() {
  clearBackButtonTimer();
  hideBusy();
  side = 'front';
  if (nativeText) nativeText.textContent = frontButtonLabel();
  if (cameraForm instanceof HTMLElement) cameraForm.hidden = false;
  if (nativeBtn instanceof HTMLElement) nativeBtn.hidden = false;
  paintChoiceButtons();
}

function paintBackButton() {
  clearBackButtonTimer();
  hideBusy();
  side = 'back';
  if (nativeText) {
    nativeText.textContent = activeRetake ? retakeCameraLabel() : 'Take back photo';
  }
  if (cameraForm instanceof HTMLElement) cameraForm.hidden = false;
  if (nativeBtn instanceof HTMLElement) nativeBtn.hidden = false;
  paintChoiceButtons();
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
  clearBackButtonTimer();
  setStatus('Front is in. Take the back, or skip it.', '');
  paintBackButton();
}

/**
 * @param {string | null | undefined} name
 */
function captureNameParts(name) {
  const text = String(name || '').trim();
  const comma = text.indexOf(',');
  if (comma > 0) {
    return {
      last: text.slice(0, comma).trim() || text,
      first: text.slice(comma + 1).trim(),
    };
  }
  return { last: text || 'Card', first: '' };
}

function publishedCards() {
  return (Array.isArray(session?.cards) ? session.cards : []).map((card) => ({
    id: String(card.id || ''),
    employee: String(card.employee || card.name || 'Card'),
    periodKey: String(card.periodKey || 'none'),
    periodLabel: String(card.periodLabel || card.periodKey || 'No sticker date'),
    card: Number(card.card) > 1 ? Number(card.card) : 1,
    front: Boolean(card.front),
    back: Boolean(card.back),
  }));
}

function paintCarousel() {
  if (!(carousel instanceof HTMLElement) || !(cardsRoot instanceof HTMLElement)) return;
  const cards = publishedCards();
  if (!cards.length && retakePickerOpen) {
    retakePickerOpen = false;
    carousel.hidden = true;
    if (cameraForm instanceof HTMLElement && !submitting) cameraForm.hidden = false;
    return;
  }
  if (!retakePickerOpen || !cards.length) {
    carousel.hidden = true;
    return;
  }
  carousel.hidden = false;
  if (cameraForm instanceof HTMLElement) cameraForm.hidden = true;

  const periods = [];
  for (const card of cards) {
    if (periods.some((period) => period.key === card.periodKey)) continue;
    periods.push({ key: card.periodKey, label: card.periodLabel });
  }
  periods.sort((a, b) => a.key.localeCompare(b.key));
  if (!periods.some((period) => period.key === pickerPeriod)) {
    pickerPeriod = periods.at(-1)?.key || '';
    pickerEmployee = '';
    pickerCardKey = '';
  }
  if (periodSelect instanceof HTMLSelectElement) {
    const same =
      periodSelect.options.length === periods.length &&
      periods.every((period, index) => periodSelect.options[index]?.value === period.key);
    if (!same) {
      periodSelect.replaceChildren(
        ...periods.map((period) => {
          const option = document.createElement('option');
          option.value = period.key;
          option.textContent = period.label;
          return option;
        })
      );
    }
    periodSelect.value = pickerPeriod;
  }

  const inPeriod = cards.filter((card) => card.periodKey === pickerPeriod);
  const employees = [];
  for (const card of inPeriod) {
    if (!employees.includes(card.employee)) employees.push(card.employee);
  }
  if (!employees.includes(pickerEmployee)) {
    pickerEmployee = '';
    pickerCardKey = '';
  }
  const forEmployee = inPeriod.filter((card) => card.employee === pickerEmployee);
  const signature = JSON.stringify({
    pickerPeriod,
    pickerEmployee,
    pickerCardKey,
    employees,
    cards: inPeriod.map((card) => `${card.id}:${card.card}:${card.front}:${card.back}`),
  });
  if (signature === pickerSignature && cardsRoot.childElementCount) return;
  pickerSignature = signature;
  cardsRoot.replaceChildren();
  for (const employee of employees) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'timesheet-capture-chip';
    if (employee === pickerEmployee) {
      button.classList.add('is-selected');
      button.setAttribute('aria-current', 'true');
    }
    const parts = captureNameParts(employee);
    const last = document.createElement('span');
    last.className = 'timesheet-capture-chip-last';
    last.textContent = parts.last;
    button.append(last);
    if (parts.first) {
      const first = document.createElement('span');
      first.className = 'timesheet-capture-chip-first';
      first.textContent = parts.first;
      button.append(first);
    }
    button.addEventListener('click', () => {
      pickerEmployee = employee;
      const forEmployee = inPeriod.filter((card) => card.employee === employee);
      pickerCardKey = forEmployee.length === 1 ? `${forEmployee[0].id}:${forEmployee[0].card}` : '';
      paintCarousel();
    });
    cardsRoot.append(button);
  }

  paintCardChoices(forEmployee);
  paintSideChoices(forEmployee);
}

/**
 * @param {ReturnType<typeof publishedCards>} forEmployee
 */
function paintCardChoices(forEmployee) {
  if (!(cardPick instanceof HTMLElement)) return;
  cardPick.replaceChildren();
  if (!pickerEmployee || !forEmployee.length) {
    cardPick.hidden = true;
    return;
  }
  cardPick.hidden = false;
  const label = document.createElement('p');
  label.className = 'timesheet-capture-pick-label';
  label.textContent = 'Card';
  const row = document.createElement('div');
  row.className = 'timesheet-capture-choice-row';
  forEmployee.forEach((card, index) => {
    const key = `${card.id}:${card.card}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'timesheet-capture-choice';
    button.textContent = `Card ${index + 1}`;
    if (key === pickerCardKey) {
      button.classList.add('is-selected');
      button.setAttribute('aria-pressed', 'true');
    }
    button.addEventListener('click', () => {
      pickerCardKey = key;
      paintCarousel();
    });
    row.append(button);
  });
  cardPick.append(label, row);
}

/**
 * @param {ReturnType<typeof publishedCards>} forEmployee
 */
function paintSideChoices(forEmployee) {
  if (!(sidePick instanceof HTMLElement)) return;
  sidePick.replaceChildren();
  const chosen = forEmployee.find((card) => `${card.id}:${card.card}` === pickerCardKey);
  if (!chosen) {
    sidePick.hidden = true;
    return;
  }
  sidePick.hidden = false;
  const label = document.createElement('p');
  label.className = 'timesheet-capture-pick-label';
  label.textContent = 'Side';
  const row = document.createElement('div');
  row.className = 'timesheet-capture-choice-row';
  for (const which of /** @type {const} */ (['front', 'back'])) {
    if (!chosen[which]) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'timesheet-capture-choice';
    button.textContent = which === 'front' ? 'Retake front' : 'Retake back';
    button.addEventListener('click', () => {
      startRescan(chosen.id, which, chosen.employee, chosen.card).catch((error) => {
        setStatus(error?.message || 'Could not start that rescan.', 'error');
      });
    });
    row.append(button);
  }
  sidePick.append(label, row);
}

function openRetakePicker() {
  retakePickerOpen = true;
  pickerSignature = '';
  pickerEmployee = '';
  pickerCardKey = '';
  if (cameraForm instanceof HTMLElement) cameraForm.hidden = true;
  paintCarousel();
  paintChoiceButtons();
}

function closeRetakePicker() {
  retakePickerOpen = false;
  paintCarousel();
  if (side === 'back') paintBackButton();
  else paintFront();
}

async function refreshSession() {
  const response = await fetch(`/api/timesheet-capture/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    throw new Error(body?.error || 'This photo link is not valid. Scan the QR code on the desk again.');
  }
  session = sessionFromBody(body);
  if (!session.front && !session.skipFront) side = 'front';
  else if (!session.back && !session.skipBack) side = 'back';
  if (!session.front && !session.back && !session.skipFront && !session.skipBack) {
    sameDriverNext = Boolean(session.sameDriver);
  }
  paintCarousel();
  paintChoiceButtons();
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
  session = sessionFromBody(body, session?.cards || []);
  session.retake = null;
  side = 'front';
  activeRetake = null;
  if (cameraInput instanceof HTMLInputElement) cameraInput.value = '';
  paintCarousel();
}

/**
 * Keep both photos on the server until the desk downloads them and restarts
 * the link. Clearing earlier races the desk poll and leaves Back as Waiting…
 */
async function waitForDeskThenNextCard() {
  clearBackButtonTimer();
  showBusy('Card sent. Waiting for the desk…');
  hideCameraButton();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const live = await refreshSession();
      if (!live.front && !live.back && !live.retake) return;
    } catch {
      // Link expired or closed — treat as done so the phone can continue.
      return;
    }
  }
  // Desk never claimed the pair; clear so this phone can shoot the next card.
  await restartCapture();
}

async function waitForRetakeClaimed() {
  clearBackButtonTimer();
  showBusy('Rescan sent. Waiting for the desk…');
  hideCameraButton();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const live = await refreshSession();
      if (!live.retake && !live.front && !live.back) {
        activeRetake = null;
        return;
      }
    } catch {
      activeRetake = null;
      return;
    }
  }
  activeRetake = null;
  await restartCapture();
}

async function startRescan(cardId, which, name, cardNumber = 1) {
  if (submitting || activeRetake) return;
  const physical = Number(cardNumber) > 1 ? Number(cardNumber) : 1;
  const response = await fetch(`/api/timesheet-capture/${encodeURIComponent(token)}/retake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cardId, side: which, card: physical }),
  });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    throw new Error(body?.error || 'Could not start that rescan.');
  }
  session = sessionFromBody(body, session?.cards || []);
  if (!session.retake) session.retake = { cardId, side: which, card: physical };
  retakePickerOpen = false;
  activeRetake = { cardId, side: which, card: physical, name: String(name || 'Card') };
  side = which;
  paintCarousel();
  setStatus(retakeCameraLabel(), '');
  if (which === 'front') paintFront();
  else paintBackButton();
  openCamera();
}

async function afterPhotoSaved(which) {
  if (activeRetake) {
    const label = activeRetake.name || 'Card';
    submitting = false;
    try {
      await waitForRetakeClaimed();
      submitting = false;
      activeRetake = null;
      markNextCardFront();
      setStatus(`${label} ${which} resent.`, 'ok');
      paintFront();
      paintCarousel();
    } catch (error) {
      submitting = false;
      activeRetake = null;
      markNextCardFront();
      paintFront();
      setStatus(error?.message || 'Could not finish that rescan.', 'error');
    }
    return;
  }

  if (which === 'front') {
    session = {
      ...(session || { cards: [], retake: null, skipFront: false, skipBack: false, sameDriver: false }),
      front: true,
      back: false,
      skipFront: false,
      ready: false,
    };
    submitting = false;
    offerBackCamera();
    return;
  }

  finishedCards += 1;
  await finishCardOnDesk();
}

async function finishCardOnDesk() {
  submitting = true;
  markNextCardFront();
  try {
    await waitForDeskThenNextCard();
    submitting = false;
    sameDriverNext = false;
    setStatus(
      genieScanner ? 'Card sent. Take the next card, or mark it as the same driver.' : '',
      genieScanner ? 'ok' : ''
    );
    paintFront();
  } catch (error) {
    submitting = false;
    paintFront();
    setStatus(error?.message || 'Could not start the next card. Scan a new QR code.', 'error');
  }
}

async function skipCurrentSide() {
  if (!genieScanner || submitting || activeRetake || !token) return;
  const which = side;
  submitting = true;
  clearBackButtonTimer();
  showBusy(which === 'front' ? 'Skipping front…' : 'Skipping back…');
  setStatus('');
  try {
    const response = await fetch(`/api/timesheet-capture/${encodeURIComponent(token)}/skip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ side: which }),
    });
    const type = response.headers.get('content-type') || '';
    const body = type.includes('json') ? await response.json().catch(() => null) : null;
    if (!response.ok) throw new Error(body?.error || 'Could not skip that side.');
    session = sessionFromBody(body, session?.cards || []);
    if (session.ready) {
      finishedCards += 1;
      await finishCardOnDesk();
      return;
    }
    submitting = false;
    if (which === 'front') {
      setStatus('Front skipped. Take the back, or skip it if this card has no back.', '');
      paintBackButton();
      return;
    }
    setStatus('Take a photo of the front or the back.', 'error');
    paintFront();
  } catch (error) {
    submitting = false;
    if (which === 'back') paintBackButton();
    else paintFront();
    setStatus(error?.message || 'Could not skip that side.', 'error');
  }
}

async function toggleSameDriver() {
  if (!genieScanner || submitting || activeRetake || !token) return;
  const next = !sameDriverNext;
  sameBtn?.setAttribute('disabled', 'true');
  try {
    const response = await fetch(`/api/timesheet-capture/${encodeURIComponent(token)}/same-driver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sameDriver: next }),
    });
    const type = response.headers.get('content-type') || '';
    const body = type.includes('json') ? await response.json().catch(() => null) : null;
    if (!response.ok) throw new Error(body?.error || 'Could not mark that card for the same driver.');
    session = sessionFromBody(body, session?.cards || []);
    sameDriverNext = Boolean(session.sameDriver);
    setStatus(
      sameDriverNext ? 'This card stays with the same driver and pay period. Skip a blank side.' : '',
      sameDriverNext ? 'ok' : ''
    );
    paintFront();
  } catch (error) {
    setStatus(error?.message || 'Could not mark that card for the same driver.', 'error');
    paintChoiceButtons();
  } finally {
    sameBtn?.removeAttribute('disabled');
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
    showBusy(
      activeRetake
        ? `Sending ${which} rescan…`
        : which === 'front'
          ? 'Sending front photo…'
          : 'Sending back photo…'
    );
    hideCameraButton();
    setStatus('');
    uploadPhoto(file)
      .then(() => afterPhotoSaved(which))
      .catch((error) => {
        submitting = false;
        if (activeRetake) {
          if (which === 'front') paintFront();
          else paintBackButton();
        } else if (which === 'front') paintFront();
        else paintBackButton();
        setStatus(error?.message || 'That photo could not be saved.', 'error');
        if (cameraInput instanceof HTMLInputElement) cameraInput.value = '';
        paintCarousel();
      });
  });
}

function startCardsPoll() {
  if (cardsPollTimer != null) return;
  cardsPollTimer = setInterval(() => {
    if (submitting) return;
    refreshSession().catch(() => {});
  }, 2500);
}

async function boot() {
  if (!token) {
    setStatus(`This photo link is missing. Scan the QR code from ${deskName} again.`, 'error');
    return;
  }

  try {
    await refreshSession();
  } catch (error) {
    setStatus(error?.message || 'This photo link is not valid. Scan the QR code on the desk again.', 'error');
    return;
  }

  if (main) main.hidden = false;
  clearQueryNoise();
  submitOnPick(cameraInput);
  skipBtn?.addEventListener('click', () => {
    skipCurrentSide().catch((error) => {
      setStatus(error?.message || 'Could not skip that side.', 'error');
    });
  });
  sameBtn?.addEventListener('click', () => {
    toggleSameDriver().catch((error) => {
      setStatus(error?.message || 'Could not mark that card for the same driver.', 'error');
    });
  });
  retakeBtn?.addEventListener('click', () => openRetakePicker());
  retakeCancelBtn?.addEventListener('click', () => closeRetakePicker());
  periodSelect?.addEventListener('change', () => {
    if (!(periodSelect instanceof HTMLSelectElement)) return;
    pickerPeriod = periodSelect.value;
    pickerEmployee = '';
    pickerCardKey = '';
    paintCarousel();
  });
  startCardsPoll();

  if (errParam) {
    setStatus(errParam, 'error');
    if ((session?.front || session?.skipFront) && !session?.back && !session?.skipBack) paintBackButton();
    else paintFront();
    return;
  }

  if (session?.retake?.cardId) {
    const card = session.cards.find((item) => item.id === session.retake?.cardId);
    activeRetake = {
      cardId: session.retake.cardId,
      side: session.retake.side,
      card: Number(session.retake.card) > 1 ? Number(session.retake.card) : 1,
      name: card?.employee || card?.name || 'Card',
    };
    side = session.retake.side;
    paintCarousel();
    if (session.retake.side === 'back') paintBackButton();
    else paintFront();
    return;
  }

  if (savedSide === 'back' || session?.ready) {
    finishedCards += 1;
    try {
      await finishCardOnDesk();
    } catch (error) {
      paintFront();
      setStatus(error?.message || 'Could not start the next card. Scan a new QR code.', 'error');
    }
    return;
  }

  if (session?.skipFront && !session?.back && !session?.skipBack) {
    setStatus('Front skipped. Take the back, or skip it if this card has no back.', '');
    paintBackButton();
    return;
  }

  if (savedSide === 'front' || (session?.front && !session?.back && !session?.skipBack)) {
    offerBackCamera();
    return;
  }

  setStatus('');
  paintFront();
}

boot();
