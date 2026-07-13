/**
 * Plain-language glossary for Route Change Tracker.
 * Single source for "?" popovers and the How this app works page.
 *
 * @typedef {{
 *   term: string,
 *   definition: string,
 *   citation?: string | null,
 *   practiceNote?: boolean,
 * }} GlossaryEntry
 */

/** @type {Record<string, GlossaryEntry>} */
export const GLOSSARY = {
  scheduled_time: {
    term: 'Scheduled time',
    definition:
      "The driver's actual clock-in/out times right now, exactly as entered. This updates immediately every time Routing logs a change.",
  },
  contracted_hours: {
    term: 'Contracted hours',
    definition:
      'The official rounded figure (nearest 15 minutes) that determines pay classification, benefits, and other contract rights. This only updates when a 15-school-day review window closes — not every time the schedule changes.',
    citation: 'Art. 3.08',
  },
  window: {
    term: 'The 15-school-day window',
    definition:
      "Every time a route's schedule changes, a 15-school-day countdown starts. Any further change to that route before the countdown ends joins the same tally and resets the countdown. If 15 school days pass with no new change, the window closes and the accumulated change becomes official.",
    citation: 'Art. 3.08(a)(8), 3.08(b)',
  },
  bid_threshold: {
    term: 'The 30-minute threshold',
    definition:
      'If the total change during an open window reaches 30 minutes or more, the contract requires the route to be posted for bid rather than simply updated.',
    citation: 'Art. 3.08(a)(8)(a), 3.08(b)(1)',
  },
  lock_in: {
    term: 'Why changes under 30 minutes lock in',
    definition:
      'The contract explicitly describes this for exactly-15-minute changes. In practice, this office applies the same logic to any change under 30 minutes — it locks in as the new official time once the window closes, without going up for bid.',
    practiceNote: true,
  },
  needs_review: {
    term: 'Needs Review',
    definition:
      "Sometimes a correction to an old entry changes what a route's official outcome should have been — after a letter or bid posting already went out based on the old outcome. Rather than silently changing the record, the app pauses and asks a person to look, since something has already been communicated based on the old numbers.",
  },
  payroll_rounding: {
    term: 'Payroll rounding',
    definition:
      'Every number is tracked exactly, down to the minute, everywhere in this app. Rounding to the nearest 15 minutes happens in exactly one place — at the moment a window officially closes — never before that.',
  },
  accumulating: {
    term: 'Accumulating',
    definition:
      'A route currently inside an open 15-school-day window. Exact schedule changes are still being tallied; contracted hours have not updated yet.',
  },
  bid_pending: {
    term: 'Bid Pending',
    definition:
      'The open window closed (or the tally reached the threshold) with a total change of 30 minutes or more. The route is waiting to be posted for bid before the new contracted hours take effect.',
  },
  cumulative_drift: {
    term: 'Cumulative drift',
    definition:
      'The running exact-minute total of all schedule changes inside the current open window. It is never rounded while the window is open.',
  },
  stable: {
    term: 'Stable',
    definition:
      'No open review window. The route’s contracted hours are the current official figure until a new schedule change opens a window.',
  },
};

/** Ordered keys for the How this app works page (core concepts first). */
export const GLOSSARY_PAGE_ORDER = [
  'scheduled_time',
  'contracted_hours',
  'window',
  'bid_threshold',
  'lock_in',
  'payroll_rounding',
  'accumulating',
  'bid_pending',
  'needs_review',
  'cumulative_drift',
  'stable',
];
