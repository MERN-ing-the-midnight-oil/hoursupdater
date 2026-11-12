const TTL_SECONDS = 15 * 60;
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

function summary(meta) {
  return {
    token: meta.token,
    expiresAt: meta.expiresAt,
    front: Boolean(meta.front),
    back: Boolean(meta.back),
    ready: Boolean(meta.front && meta.back),
  };
}

async function readMeta(env, token) {
  const key = String(token || '').trim();
  if (!key || !env.TIMECARD_CAPTURE) return null;
  const raw = await env.TIMECARD_CAPTURE.get(sessionKey(key), 'json');
  if (!raw || typeof raw !== 'object') return null;
  const expiresAt = Date.parse(String(raw.expiresAt || ''));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await closeSession(env, key);
    return null;
  }
  return {
    token: key,
    expiresAt: new Date(expiresAt).toISOString(),
    front: Boolean(raw.front),
    back: Boolean(raw.back),
  };
}

export async function openSession(env) {
  if (!env.TIMECARD_CAPTURE) {
    throw new Error('Phone photo storage is not configured on this site.');
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
  const meta = { token, expiresAt, front: false, back: false };
  await env.TIMECARD_CAPTURE.put(sessionKey(token), JSON.stringify(meta), {
    expirationTtl: TTL_SECONDS,
  });
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
  const ttlLeft = Math.max(
    60,
    Math.floor((Date.parse(meta.expiresAt) - Date.now()) / 1000)
  );
  await Promise.all([
    env.TIMECARD_CAPTURE.delete(photoKey(meta.token, 'front')),
    env.TIMECARD_CAPTURE.delete(photoKey(meta.token, 'back')),
  ]);
  const next = {
    token: meta.token,
    expiresAt: meta.expiresAt,
    front: false,
    back: false,
  };
  await env.TIMECARD_CAPTURE.put(sessionKey(meta.token), JSON.stringify(next), {
    expirationTtl: ttlLeft,
  });
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

  const ttlLeft = Math.max(
    60,
    Math.floor((Date.parse(meta.expiresAt) - Date.now()) / 1000)
  );
  await env.TIMECARD_CAPTURE.put(photoKey(meta.token, which), bytes, {
    expirationTtl: ttlLeft,
    metadata: { mime: storedMime, name },
  });

  const next = {
    token: meta.token,
    expiresAt: meta.expiresAt,
    front: which === 'front' ? true : meta.front,
    back: which === 'back' ? true : meta.back,
  };
  await env.TIMECARD_CAPTURE.put(sessionKey(meta.token), JSON.stringify(next), {
    expirationTtl: ttlLeft,
  });
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
