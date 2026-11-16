const MAX_BYTES = 12 * 1024 * 1024;
const SIDES = new Set(['front', 'back']);
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

export function normalizeSide(value) {
  const side = String(value || '')
    .trim()
    .toLowerCase();
  return SIDES.has(side) ? side : '';
}

/**
 * A card can be sent with one side skipped. Ready means each side was either
 * photographed or skipped, and at least one photo is actually on the link.
 * @param {{ front?: unknown, back?: unknown, skipFront?: unknown, skipBack?: unknown }} session
 */
export function captureCardReady(session) {
  const front = Boolean(session?.front);
  const back = Boolean(session?.back);
  const skipFront = Boolean(session?.skipFront);
  const skipBack = Boolean(session?.skipBack);
  return (front || skipFront) && (back || skipBack) && (front || back);
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sessionKey(token) {
  return `session:${token}`;
}

function photoKey(token, side) {
  return `photo:${token}:${side}`;
}

/**
 * @param {unknown} list
 */
function captureCardNumber(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 20) return 1;
  return n;
}

export function normalizeCaptureCards(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list.slice(0, 80)) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    if (!id) continue;
    const name = String(item.name || '').trim() || 'Card';
    const employee = String(item.employee || name).trim() || name;
    const status = String(item.status || '').trim();
    out.push({
      id,
      name: name.slice(0, 80),
      employee: employee.slice(0, 80),
      periodKey: String(item.periodKey || '').trim().slice(0, 40),
      periodLabel: String(item.periodLabel || '').trim().slice(0, 40),
      card: captureCardNumber(item.card),
      front: Boolean(item.front),
      back: Boolean(item.back),
      status:
        status === 'reading' || status === 'needs_review' || status === 'ready'
          ? status
          : 'ready',
    });
  }
  return out;
}

/**
 * @param {unknown} value
 */
export function normalizeCaptureRetake(value) {
  if (!value || typeof value !== 'object') return null;
  const cardId = String(value.cardId || '').trim();
  const side = normalizeSide(value.side);
  if (!cardId || !side) return null;
  return { cardId: cardId.slice(0, 80), side, card: captureCardNumber(value.card) };
}

export const CAPTURE_LINK_INVALID =
  'This photo link is not valid. Scan the QR code on the desk again.';

function summary(meta) {
  return {
    token: meta.token,
    front: Boolean(meta.front),
    back: Boolean(meta.back),
    skipFront: Boolean(meta.skipFront),
    skipBack: Boolean(meta.skipBack),
    sameDriver: Boolean(meta.sameDriver),
    ready: captureCardReady(meta),
    cards: normalizeCaptureCards(meta.cards),
    retake: normalizeCaptureRetake(meta.retake),
  };
}

async function readMeta(env, token) {
  const key = String(token || '').trim();
  if (!key || !env.TIMECARD_CAPTURE) return null;
  const raw = await env.TIMECARD_CAPTURE.get(sessionKey(key), 'json');
  if (!raw || typeof raw !== 'object') return null;
  const meta = {
    token: key,
    front: Boolean(raw.front),
    back: Boolean(raw.back),
    skipFront: Boolean(raw.skipFront),
    skipBack: Boolean(raw.skipBack),
    sameDriver: Boolean(raw.sameDriver),
    cards: normalizeCaptureCards(raw.cards),
    retake: normalizeCaptureRetake(raw.retake),
  };
  // Older links were stored with a 15-minute Cloudflare expiration. Rewriting
  // once, with no expiration, keeps a QR that is still on the desk.
  if (raw.expiresAt) {
    await env.TIMECARD_CAPTURE.put(sessionKey(key), JSON.stringify(meta));
  }
  return meta;
}

export async function openSession(env) {
  if (!env.TIMECARD_CAPTURE) {
    throw new Error('Phone photo storage is not configured on this site.');
  }
  const token = randomToken();
  const meta = {
    token,
    front: false,
    back: false,
    skipFront: false,
    skipBack: false,
    sameDriver: false,
    cards: [],
    retake: null,
  };
  await env.TIMECARD_CAPTURE.put(sessionKey(token), JSON.stringify(meta));
  return summary(meta);
}

export async function readSession(env, token) {
  const meta = await readMeta(env, token);
  return meta ? summary(meta) : null;
}

export async function closeSession(env, token) {
  const key = String(token || '').trim();
  if (!key || !env.TIMECARD_CAPTURE) return false;
  await Promise.all([
    env.TIMECARD_CAPTURE.delete(sessionKey(key)),
    env.TIMECARD_CAPTURE.delete(photoKey(key, 'front')),
    env.TIMECARD_CAPTURE.delete(photoKey(key, 'back')),
  ]);
  return true;
}

export async function restartSession(env, token) {
  const meta = await readMeta(env, token);
  if (!meta || !env.TIMECARD_CAPTURE) return null;
  await Promise.all([
    env.TIMECARD_CAPTURE.delete(photoKey(meta.token, 'front')),
    env.TIMECARD_CAPTURE.delete(photoKey(meta.token, 'back')),
  ]);
  const next = {
    token: meta.token,
    front: false,
    back: false,
    skipFront: false,
    skipBack: false,
    sameDriver: false,
    cards: normalizeCaptureCards(meta.cards),
    retake: null,
  };
  await env.TIMECARD_CAPTURE.put(sessionKey(meta.token), JSON.stringify(next));
  return summary(next);
}

/**
 * Mark one side as intentionally not photographed.
 * @param {any} env
 * @param {string} token
 * @param {unknown} side
 */
export async function skipSessionSide(env, token, side) {
  const meta = await readMeta(env, token);
  if (!meta || !env.TIMECARD_CAPTURE) return null;
  const which = normalizeSide(side);
  if (!which) throw new Error('Choose front or back.');
  if (meta[which]) {
    throw new Error(`The ${which} photo is already in. Skip is for a side you are not sending.`);
  }
  const skipFront = which === 'front' ? true : Boolean(meta.skipFront);
  const skipBack = which === 'back' ? true : Boolean(meta.skipBack);
  if (!meta.front && !meta.back && skipFront && skipBack) {
    throw new Error('Take a photo of the front or the back.');
  }
  const next = {
    ...meta,
    skipFront,
    skipBack,
  };
  await env.TIMECARD_CAPTURE.put(sessionKey(meta.token), JSON.stringify(next));
  return summary(next);
}

/**
 * The next card on this link belongs to the driver already on the desk.
 * @param {any} env
 * @param {string} token
 * @param {boolean} sameDriver
 */
export async function setSessionSameDriver(env, token, sameDriver) {
  const meta = await readMeta(env, token);
  if (!meta || !env.TIMECARD_CAPTURE) return null;
  const next = {
    ...meta,
    sameDriver: sameDriver === true,
  };
  await env.TIMECARD_CAPTURE.put(sessionKey(meta.token), JSON.stringify(next));
  return summary(next);
}

/**
 * Desk publishes the session carousel (names + which sides are on file).
 * @param {any} env
 * @param {string} token
 * @param {unknown} cards
 */
export async function putSessionCards(env, token, cards) {
  const meta = await readMeta(env, token);
  if (!meta || !env.TIMECARD_CAPTURE) return null;
  const next = {
    ...meta,
    cards: normalizeCaptureCards(cards),
  };
  await env.TIMECARD_CAPTURE.put(sessionKey(meta.token), JSON.stringify(next));
  return summary(next);
}

/**
 * Phone asks to replace one side of a named card already on the desk.
 * @param {any} env
 * @param {string} token
 * @param {unknown} body
 */
export async function putSessionRetake(env, token, body) {
  const meta = await readMeta(env, token);
  if (!meta || !env.TIMECARD_CAPTURE) return null;
  const retake = normalizeCaptureRetake(body);
  if (!retake) throw new Error('Choose a card and Front or Back to rescan.');
  const known = normalizeCaptureCards(meta.cards).some(
    (card) => card.id === retake.cardId && card.card === retake.card
  );
  if (!known) throw new Error('That card is not on this photo link yet.');
  const next = {
    token: meta.token,
    front: false,
    back: false,
    skipFront: false,
    skipBack: false,
    sameDriver: false,
    cards: normalizeCaptureCards(meta.cards),
    retake,
  };
  await Promise.all([
    env.TIMECARD_CAPTURE.delete(photoKey(meta.token, 'front')),
    env.TIMECARD_CAPTURE.delete(photoKey(meta.token, 'back')),
  ]);
  await env.TIMECARD_CAPTURE.put(sessionKey(meta.token), JSON.stringify(next));
  return summary(next);
}

/**
 * @param {any} env
 * @param {string} token
 * @param {string} side
 * @param {{ mime?: string, name?: string, bytes: ArrayBuffer | Uint8Array }} file
 */
export async function putPhotoFile(env, token, side, file) {
  const meta = await readMeta(env, token);
  if (!meta) return null;
  const which = normalizeSide(side);
  if (!which) throw new Error('Choose front or back.');

  let mime = String(file.mime || 'image/jpeg')
    .trim()
    .toLowerCase();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error('Use a JPEG, PNG, HEIC, GIF, or WebP photo.');
  }

  const bytes =
    file.bytes instanceof ArrayBuffer
      ? new Uint8Array(file.bytes)
      : file.bytes instanceof Uint8Array
        ? file.bytes
        : null;
  if (!bytes?.length) throw new Error('That photo did not arrive.');
  if (bytes.length > MAX_BYTES) {
    throw new Error('That photo is too large. Try again a little farther from the card.');
  }

  const storedMime =
    mime === 'image/heic' || mime === 'image/heif'
      ? mime
      : mime === 'image/jpeg'
        ? 'image/jpeg'
        : mime;
  const name =
    String(file.name || `${which}-timecard.jpg`)
      .trim()
      .slice(0, 80) || `${which}-timecard.jpg`;

  await env.TIMECARD_CAPTURE.put(photoKey(meta.token, which), bytes, {
    metadata: { mime: storedMime, name },
  });

  const next = {
    token: meta.token,
    front: which === 'front' ? true : Boolean(meta.front),
    back: which === 'back' ? true : Boolean(meta.back),
    skipFront: which === 'front' ? false : Boolean(meta.skipFront),
    skipBack: which === 'back' ? false : Boolean(meta.skipBack),
    sameDriver: Boolean(meta.sameDriver),
    cards: normalizeCaptureCards(meta.cards),
    retake: normalizeCaptureRetake(meta.retake),
  };
  await env.TIMECARD_CAPTURE.put(sessionKey(meta.token), JSON.stringify(next));
  return summary(next);
}

export async function putPhotoBase64(env, token, side, body = {}) {
  const raw = String(body.data || '')
    .replace(/^data:[^;]+;base64,/, '')
    .trim();
  if (!raw) throw new Error('That photo did not arrive.');
  let binary;
  try {
    const bin = atob(raw);
    binary = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) binary[i] = bin.charCodeAt(i);
  } catch {
    throw new Error('That photo could not be read.');
  }
  return putPhotoFile(env, token, side, {
    mime: body.mime,
    name: body.name,
    bytes: binary,
  });
}

export async function getPhoto(env, token, side) {
  const meta = await readMeta(env, token);
  if (!meta) return null;
  const which = normalizeSide(side);
  if (!which || !env.TIMECARD_CAPTURE) return null;
  const key = photoKey(meta.token, which);
  const got = await env.TIMECARD_CAPTURE.getWithMetadata(key, 'arrayBuffer');
  if (!got?.value) return null;
  return {
    bytes: got.value,
    mime: String(got.metadata?.mime || 'image/jpeg'),
    name: String(got.metadata?.name || `${which}-timecard.jpg`),
  };
}

/**
 * Workers require an absolute URL for Response.redirect.
 * @param {string | URL} requestUrl
 * @param {string} token
 * @param {Record<string, string>} [query]
 */
export function captureRedirect(requestUrl, token, query) {
  const params = new URLSearchParams({ t: String(token || '') });
  for (const [key, value] of Object.entries(query || {})) {
    if (value != null && value !== '') params.set(key, String(value));
  }
  const target = new URL('/timesheet-capture.html', requestUrl);
  target.search = params.toString();
  return Response.redirect(target.toString(), 303);
}
