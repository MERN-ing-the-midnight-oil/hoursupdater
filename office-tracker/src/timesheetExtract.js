import {
  AUDIT_SYSTEM,
  auditSlotTool,
  auditUserPrefix,
  normalizeAuditExtraction,
} from './timesheetAudit.js';
import {
  applyContractRegOtRows,
  GENIE_CARD_SYSTEM,
  genieCardTool,
  genieCardUserPrefix,
  normalizeGenieCardExtraction,
} from './timesheetGenieCard.js';
import {
  BACK_LINE_COUNT,
  FRONT_LINE_COUNT,
  clockRecordTool,
  EXTRACTION_SYSTEM,
  extractionUserPrefix,
  inferDefaultYear,
  parseJsonFromAssistantText,
  pairStampLines,
  sideFromSlotCount,
} from './timesheetNormalize.js';
import { DEFAULT_OVERTIME_RULES } from './overtimeRules.js';
import { DEFAULT_CONTRACT_SNAP_BREAKS } from '../../src/logic/timeUtils.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_BYTES = 12 * 1024 * 1024;

function base64ByteLength(base64) {
  const clean = String(base64 || '').replace(/\s/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

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
  const bytes = base64ByteLength(base64);
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
 * Shared card read for the Node office server and Cloudflare Pages.
 * @param {any} body
 * @param {{ apiKey?: string, model?: string, mode?: 'genie' | 'audit' }} [options]
 * @returns {Promise<{ status: number, json: Record<string, unknown> }>}
 */
export async function runTimesheetReadBody(body, options = {}) {
  const apiKey = String(options.apiKey ?? '').trim();
  if (!apiKey) {
    return { status: 500, json: { error: 'Server missing ANTHROPIC_API_KEY.' } };
  }
  const model = String(options.model ?? '').trim() || 'claude-sonnet-4-6';
  const mode = options.mode === 'audit' ? 'audit' : 'genie';

  let front;
  let back;
  try {
    front = imageBlock(body?.front, 'Front');
    back = imageBlock(body?.back, 'Back');
  } catch (error) {
    return {
      status: error.status || 400,
      json: { error: error.message || 'Invalid photo.' },
    };
  }
  if (!front && !back) {
    return { status: 400, json: { error: 'Attach at least one photo (front or back).' } };
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
            ...(audit
              ? auditReadOptions('front')
              : genieReadOptions('front')),
          })
        : null,
      back
        ? readOneSide({
            apiKey,
            model,
            image: back,
            side: 'back',
            ...(audit
              ? auditReadOptions('back')
              : genieReadOptions('back')),
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
          date_on_card: sideField(frontRead, 'dateOnCard'),
        });
    if (!audit) {
      // Reg / OT are app math from clocks (+ sticker contract), never model output.
      applyContractRegOtRows(extraction.front_rows, extraction.back_rows, extraction.header?.contract_hours, {
        breaks: DEFAULT_CONTRACT_SNAP_BREAKS,
        rules: DEFAULT_OVERTIME_RULES,
        defaultYear: inferDefaultYear(extraction.header?.date_on_card),
      });
    }
    return { status: 200, json: { extraction, model } };
  } catch (error) {
    return {
      status: error.status || 502,
      json: {
        error: error.message || 'Could not read that time card.',
        raw_text: error.raw_text,
      },
    };
  }
}

/**
 * Read one time card. The photos exist only for this request.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleTimesheetExtract(req, res) {
  return sendTimesheetRead(req, res, 'genie');
}

/**
 * Read a blue card that already has Reg and OT written on it.
 * Returns the stamps plus those written hours. The desk compares them.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleTimesheetAudit(req, res) {
  return sendTimesheetRead(req, res, 'audit');
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {'genie' | 'audit'} mode
 */
async function sendTimesheetRead(req, res, mode) {
  const result = await runTimesheetReadBody(req.body, {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL,
    mode,
  });
  res.status(result.status).json(result.json);
}

/**
 * Audit still uses Out/In slot blocks (13 / 15).
 * @param {'front' | 'back'} side
 */
function auditReadOptions(side) {
  const front = side === 'front';
  const slotCount = front ? 13 : 15;
  return {
    system: AUDIT_SYSTEM,
    userPrefix: auditUserPrefix(side, slotCount),
    // Sticker fields are only on the front tool. Back reports slots alone.
    tool: auditSlotTool(slotCount, { periodEnd: front }),
    expectedCount: slotCount,
    maxTokens: 2048,
    capturePeriodEnd: front,
    captureContract: front,
  };
}

/**
 * Genie reads flat Clock Record lines (26 front / 30 back); the app pairs Out/In.
 * @param {'front' | 'back'} side
 */
function genieReadOptions(side) {
  const lineCount = side === 'front' ? FRONT_LINE_COUNT : BACK_LINE_COUNT;
  return {
    system: GENIE_CARD_SYSTEM,
    userPrefix: genieCardUserPrefix(side, lineCount),
    tool: genieCardTool(lineCount, { sticker: side === 'front' }),
    expectedCount: lineCount,
    maxTokens: 2048,
    captureContract: true,
    captureDateOnCard: true,
  };
}

/**
 * One photo → stamp lines or slot blocks from the tool.
 */
function sideSlots(result) {
  if (!result) return null;
  const raw = Array.isArray(result) ? result : result.slots;
  return pairStampLines(raw);
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
  system = EXTRACTION_SYSTEM,
  userPrefix,
  tool,
  expectedCount,
  maxTokens = 1024,
  capturePeriodEnd = false,
  captureContract = false,
  captureDateOnCard = false,
}) {
  const lineCount = side === 'front' ? FRONT_LINE_COUNT : BACK_LINE_COUNT;
  const count = expectedCount ?? lineCount;
  const chosenTool = tool || clockRecordTool(lineCount, { sticker: side === 'front' });
  const prefix = userPrefix || extractionUserPrefix(side, lineCount);
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
  if (slots.length !== count) {
    const err = new Error(
      detected
        ? `${side} photo returned ${slots.length} values (looks like the ${detected}), expected ${count}.`
        : `${side} photo returned ${slots.length} values, expected ${count}.`
    );
    err.status = 502;
    throw err;
  }
  if (capturePeriodEnd || captureContract || captureDateOnCard) {
    return {
      slots,
      periodEnd: input?.period_end ?? null,
      contractHours: input?.contract_hours ?? null,
      employeeName: input?.employee_name ?? null,
      routeNumber: input?.route_number ?? null,
      dateOnCard: input?.date_on_card ?? null,
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
