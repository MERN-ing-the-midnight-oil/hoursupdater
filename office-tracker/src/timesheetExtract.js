import {
  BACK_SLOT_COUNT,
  FRONT_SLOT_COUNT,
  clockRecordTool,
  EXTRACTION_SYSTEM,
  extractionUserPrefix,
  normalizeExtractionFromUnknown,
  parseJsonFromAssistantText,
  sideFromSlotCount,
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

  try {
    const [frontSlots, backSlots] = await Promise.all([
      front ? readOneSide({ apiKey, model, image: front, side: 'front', slotCount: FRONT_SLOT_COUNT }) : null,
      back ? readOneSide({ apiKey, model, image: back, side: 'back', slotCount: BACK_SLOT_COUNT }) : null,
    ]);
    const extraction = normalizeExtractionFromUnknown({
      front: frontSlots,
      back: backSlots,
    });
    res.json({ extraction, model });
  } catch (error) {
    const status = error.status || 502;
    res.status(status).json({
      error: error.message || 'Could not read that time card.',
      raw_text: error.raw_text,
    });
  }
}

/**
 * One photo → one slots array. Length must match the labeled side (13 front / 15 back).
 * @param {{ apiKey: string, model: string, image: object, side: 'front' | 'back', slotCount: number }} options
 */
async function readOneSide({ apiKey, model, image, side, slotCount }) {
  const tool = clockRecordTool(slotCount);
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
        max_tokens: 1024,
        system: EXTRACTION_SYSTEM,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: extractionUserPrefix(side, slotCount) },
              { type: 'text', text: `${side.toUpperCase()} photo:` },
              image,
            ],
          },
        ],
      }),
    });
  } catch (error) {
    const err = new Error(error.message || 'Could not reach the reader.');
    err.status = 502;
    throw err;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(payload?.error?.message || `The reader returned ${response.status}.`);
    err.status = 502;
    throw err;
  }

  let slots;
  try {
    slots = slotsFromPayload(payload);
  } catch (error) {
    const text = (payload?.content ?? [])
      .filter((block) => block?.type === 'text')
      .map((block) => block.text)
      .join('');
    const err = new Error('The reader returned something that was not a time card.');
    err.status = 502;
    err.raw_text = text.slice(0, 500);
    throw err;
  }

  const detected = sideFromSlotCount(slots.length);
  if (slots.length !== slotCount) {
    const err = new Error(
      detected
        ? `${side} photo returned ${slots.length} slots (looks like the ${detected}), expected ${slotCount}.`
        : `${side} photo returned ${slots.length} slots, expected ${slotCount}.`
    );
    err.status = 502;
    throw err;
  }
  return slots;
}

/**
 * @param {any} payload
 */
function slotsFromPayload(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const tool = blocks.find((block) => block?.type === 'tool_use' && block.name === 'report_clock_records');
  if (tool?.input && typeof tool.input === 'object') {
    if (Array.isArray(tool.input.slots)) return tool.input.slots;
    // Legacy shape from older prompts.
    if (Array.isArray(tool.input.front)) return tool.input.front;
    if (Array.isArray(tool.input.back)) return tool.input.back;
  }
  const text = blocks
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('');
  const parsed = parseJsonFromAssistantText(text);
  if (Array.isArray(parsed?.slots)) return parsed.slots;
  if (Array.isArray(parsed?.front)) return parsed.front;
  if (Array.isArray(parsed?.back)) return parsed.back;
  if (Array.isArray(parsed)) return parsed;
  throw new Error('Missing slots.');
}
