import {
  EXTRACTION_SYSTEM,
  EXTRACTION_USER_PREFIX,
  normalizeExtractionFromUnknown,
  parseJsonFromAssistantText,
} from './timesheetNormalize.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * @param {unknown} field
 * @param {string} label
 */
function imageBlock(field, label) {
  if (!field || typeof field !== 'object') return null;
  const mediaType = String(field.mediaType ?? '').toLowerCase();
  const base64 = String(field.base64 ?? '').replace(/\s/g, '');
  if (!base64) return null;
  if (mediaType === 'image/heic' || mediaType === 'image/heif') {
    const error = new Error(
      `${label}: HEIC is not supported. Export the photo as a JPEG and try again.`
    );
    error.status = 400;
    throw error;
  }
  if (!ALLOWED_TYPES.has(mediaType)) {
    const error = new Error(`${label}: use a JPEG, PNG, GIF, or WebP photo.`);
    error.status = 400;
    throw error;
  }
  const bytes = Buffer.from(base64, 'base64').length;
  if (!bytes) {
    const error = new Error(`${label} photo was empty.`);
    error.status = 400;
    throw error;
  }
  if (bytes > MAX_BYTES) {
    const error = new Error(`${label} photo exceeds 12MB.`);
    error.status = 400;
    throw error;
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaType,
      data: base64,
    },
  };
}

/**
 * Read one time card. The photos exist only for this request.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleTimesheetExtract(req, res) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (!apiKey) {
    res.status(500).json({ error: 'Server missing ANTHROPIC_API_KEY.' });
    return;
  }
  const model = String(process.env.ANTHROPIC_MODEL ?? '').trim() || 'claude-sonnet-4-6';

  let front;
  let back;
  try {
    front = imageBlock(req.body?.front, 'Front');
    back = imageBlock(req.body?.back, 'Back');
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || 'Invalid photo.' });
    return;
  }
  if (!front && !back) {
    res.status(400).json({ error: 'Attach at least one photo (front or back).' });
    return;
  }

  const content = [{ type: 'text', text: EXTRACTION_USER_PREFIX }];
  if (front) {
    content.push({ type: 'text', text: 'Image 1 — FRONT of time card:' });
    content.push(front);
  }
  if (back) {
    content.push({
      type: 'text',
      text: front
        ? 'Image 2 — BACK of time card:'
        : 'Image 1 — BACK of time card (no front provided):',
    });
    content.push(back);
  }

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: EXTRACTION_SYSTEM,
        messages: [{ role: 'user', content }],
      }),
    });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Could not reach the reader.' });
    return;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `The reader returned ${response.status}.`;
    res.status(502).json({ error: message });
    return;
  }

  const text = (payload?.content ?? [])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('');
  try {
    const extraction = normalizeExtractionFromUnknown(parseJsonFromAssistantText(text));
    res.json({ extraction, model });
  } catch {
    res.status(502).json({
      error: 'The reader returned something that was not a time card.',
      raw_text: text.slice(0, 500),
    });
  }
}
