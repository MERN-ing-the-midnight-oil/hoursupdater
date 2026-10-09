/**
 * Turns a driver's ordered lists into the sheet notation dispatch already reads.
 * No parentheses: one assignment, highest first.
 * Parentheses: every trip in that set that fits. A second group is the backup set.
 */

export const PREFERENCE_LIMIT = 240;

function cleanToken(token) {
  return String(token ?? '').replace(/\s+/g, ' ').trim();
}

function expandChunk(chunk) {
  const parts = String(chunk)
    .split(',')
    .map((part) => cleanToken(part))
    .filter(Boolean);
  const tokens = [];
  for (const part of parts) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (!range) {
      tokens.push(part);
      continue;
    }
    const start = Number(range[1]);
    const end = Number(range[2]);
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    if (high - low > 30) {
      tokens.push(part);
      continue;
    }
    for (let number = low; number <= high; number += 1) tokens.push(String(number));
  }
  return tokens;
}

/**
 * @param {'one' | 'many'} mode
 * @param {string[]} primaryTokens
 * @param {string[]} secondaryTokens
 * @returns {string}
 */
export function formatPreference(mode, primaryTokens, secondaryTokens = []) {
  const first = (primaryTokens || []).map(cleanToken).filter(Boolean);
  const second = (secondaryTokens || []).map(cleanToken).filter(Boolean);
  if (mode === 'many') {
    const groups = [];
    if (first.length) groups.push(`(${first.join(', ')})`);
    if (second.length) groups.push(`(${second.join(', ')})`);
    return groups.join(', ');
  }
  return [...first, ...second].join(', ');
}

/**
 * @param {string} text
 * @returns {{ mode: 'one' | 'many', groups: string[][] }}
 */
export function parsePreference(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { mode: 'one', groups: [] };
  const groups = [];
  const pattern = /\(([^)]*)\)/g;
  let match = pattern.exec(raw);
  let sawParen = false;
  while (match) {
    sawParen = true;
    const tokens = expandChunk(match[1]);
    if (tokens.length) groups.push(tokens);
    match = pattern.exec(raw);
  }
  if (!sawParen) return { mode: 'one', groups: [expandChunk(raw)] };
  return { mode: 'many', groups };
}

/**
 * @param {number} routeMinutes
 * @param {number} tripMinutes
 * @returns {number}
 */
export function totalDayMinutes(routeMinutes, tripMinutes) {
  return Math.max(0, routeMinutes) + Math.max(0, tripMinutes);
}

/** @param {number} minutes */
export function formatDuration(minutes) {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const mins = whole % 60;
  if (!hours) return `${mins} min`;
  if (!mins) return `${hours} h`;
  return `${hours} h ${mins} min`;
}
