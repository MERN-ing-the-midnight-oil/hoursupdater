/**
 * Plain-language glossary for Teamster Tracker.
 * Single source for "?" popovers, clickable terms, and the Definitions page.
 *
 * `citation` is an ordered list of IDs into contractCitations.js.
 * Entries with practiceNote and no citation stay plain text.
 * `aliases` are additional phrases that should link to the same definition.
 *
 * @typedef {{
 *   term: string,
 *   definition: string,
 *   citation?: string[],
 *   practiceNote?: boolean,
 *   aliases?: string[],
 * }} GlossaryEntry
 */

/** @type {Record<string, GlossaryEntry>} */
export const GLOSSARY = {
  scheduled_time: {
    term: 'Scheduled time',
    definition:
      "The driver's current clock-in/out times.",
    aliases: ['scheduled times', 'Exact scheduled total'],
  },
  contracted_hours: {
    term: 'Contracted hours',
    definition:
      'The official rounded figure (nearest 15 minutes) used for pay classification, benefits, and other contract rights.',
    aliases: ['contracted hour', 'Rounded contracted hours'],
  },
  window: {
    term: 'The 15-school-day window',
    definition:
      'A 15-school-day review period that starts when a route’s schedule changes and resets on any further change to that route.',
    aliases: [
      '15-school-day window',
      '15 school-day window',
      '15-school-day review period',
    ],
  },
  bid_threshold: {
    term: 'The 30-minute threshold',
    definition:
      'The magnitude of accumulated time difference at which a closed window requires the route to be posted for bid (increase) or treated as bump-eligible (decrease).',
    aliases: ['30-minute threshold', '30 minute threshold'],
  },
  time_difference_to_accumulate: {
    term: 'Time Difference To Accumulate',
    definition:
      'Enter the "Difference between old and new schedule" in most cases.',
    aliases: ['Time Differences To Accumulate'],
  },
  lock_in: {
    term: 'Lock in',
    definition:
      'When an open window closes with a change under 30 minutes, contracted hours update to the new official time without posting for bid.',
    aliases: ['Locked in', 'locks in', 'lock-in', 'locked-in'],
  },
  needs_review: {
    term: 'Needs Review',
    definition:
      'A status set automatically when a correction would change an outcome that has already been finalized and acted on. For example: a route locks in as Bid Pending and a letter goes out to the driver. Two weeks later, someone catches that one of the changes behind that decision was logged wrong — say, a change recorded as 20 minutes was really only 5. Fixing it would mean the route’s real total was actually under 30 minutes all along. The admin can decide what to do next.',
    aliases: ['NEEDS_REVIEW', 'needs-review'],
  },
  self_resolved: {
    term: 'Self Resolved',
    definition:
      'A route was flagged Needs Review, but then was adjusted so that there was no longer a discrepancy between its status and the status that had already been finalized. The review flag clears on its own; the route may still appear briefly in the review queue so Admin can see what happened.',
    aliases: [
      'self-resolved',
      'self resolved',
      'self-resolved recently',
      'NEEDS_REVIEW_SELF_RESOLVED',
    ],
  },
  admin_resolved: {
    term: 'Admin Resolved',
    definition:
      'Admin closed a Needs Review flag by choosing either to accept the newly computed status or to keep the status that had already been finalized.',
    aliases: [
      'admin-resolved',
      'admin resolved',
      'NEEDS_REVIEW_ADMIN_RESOLVED',
    ],
  },
  payroll_rounding: {
    term: 'Payroll rounding',
    definition:
      'Rounding exact minutes to the nearest 15 minutes. Applied only when a window closes.',
  },
  accumulating: {
    term: 'Accumulating',
    definition:
      'A route currently inside an open 15-school-day window.',
    aliases: ['ACCUMULATING'],
  },
  bid_pending: {
    term: 'Bid Pending',
    definition:
      'Status after an open window closes with an increase of 30 minutes or more; the route posts for bid.',
    citation: ['3.08(a)(8)(a)', '3.08(b)(1)'],
    aliases: [
      'Pending Bid',
      'BID_PENDING',
      'bid-pending',
      'bid pending',
      'pending bid',
    ],
  },
  bump_eligible: {
    term: 'Bump Eligible',
    definition:
      'Status after an open window closes with a decrease of 30 minutes or more; the current driver may bump by seniority or keep the assignment.',
    citation: ['3.08(a)(8)(b)', '3.08(b)(2)'],
    aliases: ['Bump', 'BUMP_ELIGIBLE', 'bump-eligible', 'bump eligible'],
  },
  cumulative_drift: {
    term: 'Accumulated time difference',
    definition:
      'The running exact-minute total of Time Differences To Accumulate in the current open window.',
    aliases: [
      'Computed accumulated time difference',
      'accumulated time differences',
    ],
  },
  stable: {
    term: 'Stable',
    definition:
      'No open review window; contracted hours are the current official figure.',
    aliases: ['STABLE'],
  },
};

/** Ordered keys for the Definitions page (core concepts first). */
export const GLOSSARY_PAGE_ORDER = [
  'scheduled_time',
  'contracted_hours',
  'window',
  'bid_threshold',
  'time_difference_to_accumulate',
  'cumulative_drift',
  'lock_in',
  'payroll_rounding',
  'accumulating',
  'bid_pending',
  'bump_eligible',
  'needs_review',
  'self_resolved',
  'admin_resolved',
  'stable',
];

/**
 * @typedef {{ phrase: string, termId: string }} GlossaryPhraseMatch
 */

/** @type {GlossaryPhraseMatch[] | null} */
let cachedPhrases = null;

/**
 * All linkable phrases (canonical term + aliases), longest first.
 * @returns {GlossaryPhraseMatch[]}
 */
export function getGlossaryPhrases() {
  if (cachedPhrases) return cachedPhrases;
  /** @type {GlossaryPhraseMatch[]} */
  const phrases = [];
  for (const [termId, entry] of Object.entries(GLOSSARY)) {
    const seen = new Set();
    for (const phrase of [entry.term, ...(entry.aliases || [])]) {
      const key = phrase.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      phrases.push({ phrase, termId });
    }
  }
  phrases.sort((a, b) => b.phrase.length - a.phrase.length);
  cachedPhrases = phrases;
  return phrases;
}

/**
 * @param {string | undefined} ch
 * @returns {boolean}
 */
function isWordChar(ch) {
  return Boolean(ch && /[A-Za-z0-9]/.test(ch));
}

/**
 * Find non-overlapping glossary phrase matches in text (case-insensitive).
 * Longer phrases win over shorter ones (e.g. "Bump Eligible" before "Bump").
 * @param {string} text
 * @returns {{ start: number, end: number, termId: string, text: string }[]}
 */
export function findGlossaryMatches(text) {
  if (!text) return [];
  const phrases = getGlossaryPhrases();
  const lower = text.toLowerCase();
  /** @type {{ start: number, end: number, termId: string, text: string }[]} */
  const matches = [];
  let i = 0;
  while (i < text.length) {
    let found = null;
    for (const { phrase, termId } of phrases) {
      const needle = phrase.toLowerCase();
      if (!lower.startsWith(needle, i)) continue;
      const end = i + needle.length;
      const before = i === 0 ? '' : text[i - 1];
      const after = end >= text.length ? '' : text[end];
      if (isWordChar(before) || isWordChar(after)) continue;
      found = {
        start: i,
        end,
        termId,
        text: text.slice(i, end),
      };
      break;
    }
    if (found) {
      matches.push(found);
      i = found.end;
    } else {
      i += 1;
    }
  }
  return matches;
}
