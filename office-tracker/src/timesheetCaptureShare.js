const TTL_MS = 15 * 60 * 1000;
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

function randomToken() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function timesheetCaptureUrl(origin, token, desk) {
  const base = String(origin || '').replace(/\/$/, '');
  const link = String(token || '').trim();
  if (!base || !link) return '';
  const params = new URLSearchParams();
  params.set('t', link);
  if (String(desk || '').trim().toLowerCase() === 'audit') params.set('desk', 'audit');
  return `${base}/timesheet-capture.html?${params.toString()}`;
}

export function normalizeCaptureSide(value) {
  const side = String(value || '').trim().toLowerCase();
  return SIDES.has(side) ? side : '';
}

/**
 * Short-lived Front/Back photo drop for Timecard Genie phone capture.
 * Photos live in memory on the office server until the session expires.
 * @param {{ now?: () => number, token?: () => string, ttlMs?: number }} [options]
 */
export function createTimesheetCaptureShare(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const tokenFn = typeof options.token === 'function' ? options.token : randomToken;
  const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : TTL_MS;
  /** @type {Map<string, {
   *   token: string,
   *   createdAt: number,
   *   expiresAt: number,
   *   front: { mime: string, bytes: Buffer, name: string } | null,
   *   back: { mime: string, bytes: Buffer, name: string } | null,
   * }>} */
  const sessions = new Map();

  function purge() {
    const stamp = now();
    for (const [key, session] of sessions) {
      if (session.expiresAt <= stamp) sessions.delete(key);
    }
  }

  function getLive(token) {
    purge();
    const key = String(token || '').trim();
    if (!key) return null;
    const session = sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= now()) {
      sessions.delete(key);
      return null;
    }
    return session;
  }

  function summary(session) {
    return {
      token: session.token,
      expiresAt: new Date(session.expiresAt).toISOString(),
      front: Boolean(session.front),
      back: Boolean(session.back),
      ready: Boolean(session.front && session.back),
    };
  }

  return {
    open() {
      purge();
      const token = tokenFn();
      const createdAt = now();
      const session = {
        token,
        createdAt,
        expiresAt: createdAt + ttlMs,
        front: null,
        back: null,
      };
      sessions.set(token, session);
      return summary(session);
    },

    read(token) {
      const session = getLive(token);
      return session ? summary(session) : null;
    },

    /**
     * @param {string} token
     * @param {string} side
     * @param {{ mime?: string, bytes?: Buffer, name?: string }} file
     */
    putPhotoFile(token, side, file = {}) {
      const session = getLive(token);
      if (!session) return null;
      const which = normalizeCaptureSide(side);
      if (!which) throw new Error('Choose front or back.');
      let mime = String(file.mime || 'image/jpeg').trim().toLowerCase();
      if (mime === 'image/jpg') mime = 'image/jpeg';
      if (!ALLOWED_MIME.has(mime)) {
        throw new Error('Use a JPEG, PNG, HEIC, GIF, or WebP photo.');
      }
      const bytes = Buffer.isBuffer(file.bytes) ? file.bytes : null;
      if (!bytes?.length) throw new Error('That photo did not arrive.');
      if (bytes.length > MAX_BYTES) {
        throw new Error('That photo is too large. Try again a little farther from the card.');
      }
      const storedMime =
        mime === 'image/heic' || mime === 'image/heif' ? mime : mime === 'image/jpeg' ? 'image/jpeg' : mime;
      const name =
        String(file.name || `${which}-timecard.jpg`).trim().slice(0, 80) || `${which}-timecard.jpg`;
      session[which] = { mime: storedMime, bytes, name };
      return summary(session);
    },

    /**
     * @param {string} token
     * @param {string} side
     * @param {{ mime?: string, data?: string, name?: string }} body
     */
    putPhoto(token, side, body = {}) {
      const raw = String(body.data || '').replace(/^data:[^;]+;base64,/, '').trim();
      if (!raw) throw new Error('That photo did not arrive.');
      let bytes;
      try {
        bytes = Buffer.from(raw, 'base64');
      } catch {
        throw new Error('That photo could not be read.');
      }
      return this.putPhotoFile(token, side, {
        mime: body.mime,
        name: body.name,
        bytes,
      });
    },

    getPhoto(token, side) {
      const session = getLive(token);
      if (!session) return null;
      const which = normalizeCaptureSide(side);
      if (!which) return null;
      return session[which] || null;
    },

    close(token) {
      const key = String(token || '').trim();
      if (!key) return false;
      return sessions.delete(key);
    },
  };
}
