import { timesheetCaptureUrl } from '../src/timesheetCaptureShare.js';
import { pageShareOrigin } from '../src/clockShare.js';

async function readJson(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('json')) return null;
  return response.json().catch(() => null);
}

export async function loadCaptureShareOrigin() {
  try {
    const response = await fetch('/api/clock-share-origin', { cache: 'no-store' });
    const body = await readJson(response);
    const fromApi = pageShareOrigin(body?.origin);
    if (fromApi) return fromApi;
  } catch {
    /* Fall through to the page origin when the API is unavailable. */
  }
  return pageShareOrigin(window.location.origin);
}

export function captureShareUrl(origin, token, desk) {
  return timesheetCaptureUrl(origin, token, desk);
}

export async function openCaptureSession() {
  const response = await fetch('/api/timesheet-capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(body?.error || 'Could not start a phone photo link.');
  }
  if (!body?.token) throw new Error('Could not start a phone photo link.');
  return body;
}

export async function readCaptureSession(token) {
  const response = await fetch(`/api/timesheet-capture/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  });
  const body = await readJson(response);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(body?.error || 'Could not check the phone photo link.');
  }
  return body;
}

export async function fetchCapturePhoto(token, side) {
  const response = await fetch(
    `/api/timesheet-capture/${encodeURIComponent(token)}/${encodeURIComponent(side)}`,
    { cache: 'no-store' }
  );
  if (!response.ok) {
    const body = await readJson(response);
    throw new Error(body?.error || `The ${side} photo is not ready yet.`);
  }
  const blob = await response.blob();
  const type = blob.type || 'image/jpeg';
  return new File([blob], `${side}-timecard.jpg`, { type });
}

const CAPTURE_TOKEN_KEYS = {
  genie: 'timesheet-capture-token',
  audit: 'audit-capture-token',
};

function captureTokenKey(desk) {
  return CAPTURE_TOKEN_KEYS[desk] || CAPTURE_TOKEN_KEYS.genie;
}

/** Remember this tab's link so a refresh can close it if the page is torn down first. */
export function rememberCaptureToken(desk, token) {
  try {
    const link = String(token || '').trim();
    if (link) sessionStorage.setItem(captureTokenKey(desk), link);
    else sessionStorage.removeItem(captureTokenKey(desk));
  } catch {
    /* Private browsing can block storage. The open link still works. */
  }
}

export function rememberedCaptureToken(desk) {
  try {
    return sessionStorage.getItem(captureTokenKey(desk)) || '';
  } catch {
    return '';
  }
}

export async function closeCaptureSession(token, { keepalive = false } = {}) {
  const link = String(token || '').trim();
  if (!link) return;
  try {
    await fetch(`/api/timesheet-capture/${encodeURIComponent(link)}`, {
      method: 'DELETE',
      keepalive,
    });
  } catch {
    /* Closing is best-effort. */
  }
}

/**
 * Clear Front/Back on an existing link so the phone can shoot the next card.
 * The desk should call this only after both photos have been downloaded.
 */
export async function restartCaptureSession(token) {
  const link = String(token || '').trim();
  if (!link) return null;
  const response = await fetch(`/api/timesheet-capture/${encodeURIComponent(link)}/restart`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(body?.error || 'Could not reset the phone photo link.');
  }
  return body;
}

/**
 * Publish the desk session carousel onto the shared phone link.
 * @param {string} token
 * @param {Array<{ id: string, name: string, front?: boolean, back?: boolean, status?: string }>} cards
 */
export async function publishCaptureCards(token, cards) {
  const link = String(token || '').trim();
  if (!link) return null;
  const response = await fetch(`/api/timesheet-capture/${encodeURIComponent(link)}/cards`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cards: Array.isArray(cards) ? cards : [] }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(body?.error || 'Could not update the phone card list.');
  }
  return body;
}

/**
 * Ask the shared link to accept a replacement Front or Back for one card.
 * @param {string} token
 * @param {{ cardId: string, side: 'front' | 'back' }} retake
 */
/**
 * Tell the desk this side will not be photographed.
 * @param {string} token
 * @param {'front' | 'back'} side
 */
export async function skipCaptureSide(token, side) {
  const link = String(token || '').trim();
  if (!link) return null;
  const response = await fetch(`/api/timesheet-capture/${encodeURIComponent(link)}/skip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ side }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(body?.error || 'Could not skip that side.');
  }
  return body;
}

/**
 * The card being photographed now belongs to the driver already on the desk.
 * @param {string} token
 * @param {boolean} sameDriver
 */
export async function setCaptureSameDriver(token, sameDriver) {
  const link = String(token || '').trim();
  if (!link) return null;
  const response = await fetch(`/api/timesheet-capture/${encodeURIComponent(link)}/same-driver`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sameDriver: sameDriver === true }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(body?.error || 'Could not mark that card for the same driver.');
  }
  return body;
}

export async function requestCaptureRetake(token, retake) {
  const link = String(token || '').trim();
  if (!link) return null;
  const response = await fetch(`/api/timesheet-capture/${encodeURIComponent(link)}/retake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(retake || {}),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(body?.error || 'Could not start that rescan.');
  }
  return body;
}
