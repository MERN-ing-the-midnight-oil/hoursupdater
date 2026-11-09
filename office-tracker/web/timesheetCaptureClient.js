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

export async function closeCaptureSession(token) {
  const link = String(token || '').trim();
  if (!link) return;
  try {
    await fetch(`/api/timesheet-capture/${encodeURIComponent(link)}`, { method: 'DELETE' });
  } catch {
    /* Closing is best-effort; expiry also clears the session. */
  }
}
