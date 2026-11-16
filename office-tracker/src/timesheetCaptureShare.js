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
  const side = normalizeCaptureSide(value.side);
  if (!cardId || !side) return null;
  return { cardId: cardId.slice(0, 80), side, card: captureCardNumber(value.card) };
}

/**
 * Front/Back photo drop for Timecard Genie phone capture.
 * The link stays valid until the desk closes it. Photos stay in memory until then.
 * @param {{ token?: () => string }} [options]
 */
export function createTimesheetCaptureShare(options = {}) {
  const tokenFn = typeof options.token === 'function' ? options.token : randomToken;
  /** @type {Map<string, {
   *   token: string,
   *   front: { mime: string, bytes: Buffer, name: string } | null,
   *   back: { mime: string, bytes: Buffer, name: string } | null,
   *   skipFront: boolean,
   *   skipBack: boolean,
   *   sameDriver: boolean,
   *   cards: ReturnType<typeof normalizeCaptureCards>,
   *   retake: ReturnType<typeof normalizeCaptureRetake>,
   * }>} */
  const sessions = new Map();

  function getLive(token) {
    const key = String(token || '').trim();
    if (!key) return null;
    return sessions.get(key) || null;
  }

  function summary(session) {
    return {
      token: session.token,
      front: Boolean(session.front),
      back: Boolean(session.back),
      skipFront: Boolean(session.skipFront),
      skipBack: Boolean(session.skipBack),
      sameDriver: Boolean(session.sameDriver),
      ready: captureCardReady(session),
      cards: normalizeCaptureCards(session.cards),
      retake: normalizeCaptureRetake(session.retake),
    };
  }

  return {
    open() {
      const token = tokenFn();
      const session = {
        token,
        front: null,
        back: null,
        skipFront: false,
        skipBack: false,
        sameDriver: false,
        cards: [],
        retake: null,
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
      if (which === 'front') session.skipFront = false;
      else session.skipBack = false;
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

    /**
     * @param {string} token
     * @param {unknown} cards
     */
    putCards(token, cards) {
      const session = getLive(token);
      if (!session) return null;
      session.cards = normalizeCaptureCards(cards);
      return summary(session);
    },

    /**
     * @param {string} token
     * @param {unknown} body
     */
    putRetake(token, body) {
      const session = getLive(token);
      if (!session) return null;
      const retake = normalizeCaptureRetake(body);
      if (!retake) throw new Error('Choose a card and Front or Back to rescan.');
      const known = normalizeCaptureCards(session.cards).some(
        (card) => card.id === retake.cardId && card.card === retake.card
      );
      if (!known) throw new Error('That card is not on this photo link yet.');
      session.front = null;
      session.back = null;
      session.skipFront = false;
      session.skipBack = false;
      session.sameDriver = false;
      session.retake = retake;
      return summary(session);
    },

    /**
     * Mark one side as intentionally not photographed.
     * @param {string} token
     * @param {string} side
     */
    skipSide(token, side) {
      const session = getLive(token);
      if (!session) return null;
      const which = normalizeCaptureSide(side);
      if (!which) throw new Error('Choose front or back.');
      if (session[which]) {
        throw new Error(`The ${which} photo is already in. Skip is for a side you are not sending.`);
      }
      const nextSkipFront = which === 'front' ? true : session.skipFront;
      const nextSkipBack = which === 'back' ? true : session.skipBack;
      if (!session.front && !session.back && nextSkipFront && nextSkipBack) {
        throw new Error('Take a photo of the front or the back.');
      }
      session.skipFront = nextSkipFront;
      session.skipBack = nextSkipBack;
      return summary(session);
    },

    /**
     * The next card on this link belongs to the driver already on the desk.
     * @param {string} token
     * @param {boolean} sameDriver
     */
    setSameDriver(token, sameDriver) {
      const session = getLive(token);
      if (!session) return null;
      session.sameDriver = sameDriver === true;
      return summary(session);
    },

    close(token) {
      const key = String(token || '').trim();
      if (!key) return false;
      return sessions.delete(key);
    },

    restart(token) {
      const session = getLive(token);
      if (!session) return null;
      session.front = null;
      session.back = null;
      session.skipFront = false;
      session.skipBack = false;
      session.sameDriver = false;
      session.retake = null;
      return summary(session);
    },
  };
}
