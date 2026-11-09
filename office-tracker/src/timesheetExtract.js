import {
  AUDIT_SYSTEM,
  auditSlotTool,
  auditUserPrefix,
  normalizeAuditExtraction,
} from './timesheetAudit.js';
import {
  GENIE_CARD_SYSTEM,
  genieCardTool,
  genieCardUserPrefix,
  normalizeGenieCardExtraction,
} from './timesheetGenieCard.js';
import {
  BACK_SLOT_COUNT,
  FRONT_SLOT_COUNT,
  clockRecordTool,
  EXTRACTION_SYSTEM,
  extractionUserPrefix,
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
  return runTimesheetRead(req, res, 'genie');
}

/**
 * Read a blue card that already has Reg and OT written on it.
 * Returns the stamps plus those written hours. The desk compares them.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleTimesheetAudit(req, res) {
  return runTimesheetRead(req, res, 'audit');
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {'genie' | 'audit'} mode
 */
async function runTimesheetRead(req, res, mode) {
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

  const audit = mode === 'audit';
  try {
    const [frontRead, backRead] = await Promise.all([
      front
        ? readOneSide({
            apiKey,
            model,
            image: front,
            side: 'front',
            slotCount: FRONT_SLOT_COUNT,
            ...(audit ? auditReadOptions('front', FRONT_SLOT_COUNT) : genieReadOptions('front', FRONT_SLOT_COUNT)),
          })
        : null,
      back
        ? readOneSide({
            apiKey,
            model,
            image: back,
            side: 'back',
            slotCount: BACK_SLOT_COUNT,
            ...(audit ? auditReadOptions('back', BACK_SLOT_COUNT) : genieReadOptions('back', BACK_SLOT_COUNT)),
          })
        : null,
    ]);
    const frontSlots = sideSlots(frontRead);
    const backSlots = sideSlots(backRead);
    const extraction = audit
      ? normalizeAuditExtraction({
          front: frontSlots,
          back: backSlots,
          period_end: sidePeriodEnd(frontRead),
          contract_hours: sideField(frontRead, 'contractHours'),
        })
      : normalizeGenieCardExtraction({
          front: frontSlots,
          back: backSlots,
          employee_name: sideField(frontRead, 'employeeName'),
          route_number: sideField(frontRead, 'routeNumber'),
          contract_hours: sideField(frontRead, 'contractHours'),
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
 * @param {'front' | 'back'} side
 * @param {number} slotCount
 */
function auditReadOptions(side, slotCount) {
  const front = side === 'front';
  return {
    system: AUDIT_SYSTEM,
    userPrefix: auditUserPrefix(side, slotCount),
    // Sticker fields are only on the front tool. Back reports slots alone.
    tool: auditSlotTool(slotCount, { periodEnd: front }),
    maxTokens: 2048,
    capturePeriodEnd: front,
    captureContract: front,
  };
}

/**
 * @param {'front' | 'back'} side
 * @param {number} slotCount
 */
function genieReadOptions(side, slotCount) {
  return {
    system: GENIE_CARD_SYSTEM,
    userPrefix: genieCardUserPrefix(side, slotCount),
    tool: genieCardTool(slotCount, { sticker: side === 'front' }),
    maxTokens: 2048,
    captureContract: true,
  };
}

/**
 * One photo → one slots array. Length must match the labeled side (13 front / 15 back).
 * @param {{ apiKey: string, model: string, image: object, side: 'front' | 'back', slotCount: number }} options
 */
function sideSlots(result) {
  if (!result) return null;
  return Array.isArray(result) ? result : result.slots;
}

function sidePeriodEnd(result) {
  if (!result || Array.isArray(result)) return null;
  return result.periodEnd ?? null;
}

function sideField(result, key) {
  if (!result || Array.isArray(result)) return null;
  return result[key] ?? null;
}

async function readOneSide({
  apiKey,
  model,
  image,
  side,
  slotCount,
  system = EXTRACTION_SYSTEM,
  userPrefix,
  tool,
  maxTokens = 1024,
  capturePeriodEnd = false,
  captureContract = false,
}) {
  const chosenTool = tool || clockRecordTool(slotCount);
  const prefix = userPrefix || extractionUserPrefix(side, slotCount);
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
        max_tokens: maxTokens,
        system,
        tools: [chosenTool],
        tool_choice: { type: 'tool', name: chosenTool.name },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prefix },
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

  let input;
  let slots;
  try {
    input = toolInputFromPayload(payload, chosenTool.name);
    slots = slotsFromToolInput(input);
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
  if (capturePeriodEnd || captureContract) {
    return {
      slots,
      periodEnd: input?.period_end ?? null,
      contractHours: input?.contract_hours ?? null,
      employeeName: input?.employee_name ?? null,
      routeNumber: input?.route_number ?? null,
    };
  }
  return slots;
}

/**
 * @param {any} payload
 */
function toolInputFromPayload(payload, toolName = 'report_clock_records') {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const tool = blocks.find((block) => block?.type === 'tool_use' && block.name === toolName);
  if (tool?.input && typeof tool.input === 'object') return tool.input;
  const text = blocks
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('');
  const parsed = parseJsonFromAssistantText(text);
  if (Array.isArray(parsed)) return { slots: parsed };
  if (parsed && typeof parsed === 'object') return parsed;
  throw new Error('Missing slots.');
}

function slotsFromToolInput(input) {
  if (Array.isArray(input?.slots)) return input.slots;
  // Legacy shape from older prompts.
  if (Array.isArray(input?.front)) return input.front;
  if (Array.isArray(input?.back)) return input.back;
  throw new Error('Missing slots.');
}
