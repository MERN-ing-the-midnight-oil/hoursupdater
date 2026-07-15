/**
 * Plain-language glossary for Route Change Tracker.
 * Single source for "?" popovers and the How this app works page.
 *
 * `citation` is an ordered list of IDs into contractCitations.js.
 * Entries with practiceNote and no citation stay plain text.
 *
 * @typedef {{
 *   term: string,
 *   definition: string,
 *   citation?: string[],
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
    citation: ['3.08'],
  },
  window: {
    term: 'The 15-school-day window',
    definition:
      "Every time a route's schedule changes, a 15-school-day countdown starts. Any further change to that route before the countdown ends joins the same tally and resets the countdown. If 15 school days pass with no new change, the window closes and the accumulated change becomes official.",
    citation: ['3.08(a)(8)', '3.08(b)'],
  },
  bid_threshold: {
    term: 'The 30-minute threshold',
    definition:
      'If the total change during an open window reaches 30 minutes or more, the contract requires the route to be posted for bid rather than simply updated.',
    citation: ['3.08(a)(8)(a)', '3.08(b)(1)'],
  },
  time_difference_to_accumulate: {
    term: 'Time Difference To Accumulate',
    definition:
      'The amount of time you are adding toward the 30-minute change that will trigger the route going up for bid. Should be equal to the Difference between Old and New Schedule',
    citation: ['3.08(a)(8)(a)', '3.08(b)(1)'],
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
      'This status only ever gets set by the app itself — nobody marks a route "Needs Review" on purpose. It happens automatically when a correction to an old route change would alter an outcome that\'s already been finalized and acted on — for example, a letter already went out to a driver, or a route was already posted for bid, based on the numbers as they stood at the time.',
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
      'The open window closed with an increase of 30 minutes or more. The route posts for bid. When electronic bid sign-up is enabled (Admin Settings), drivers are CC’d the open posting and must initial via Microsoft Forms within two school days — late or missing initials are a rejection. Award is from that finalized seniority-ordered list.',
    citation: ['3.08(a)(8)(a)', '3.08(b)(1)'],
  },
  bump_eligible: {
    term: 'Bump Eligible',
    definition:
      'The open window closed with a decrease of 30 minutes or more. The current driver may use seniority to bump a less-senior driver, or confirm they keep this assignment — they have two school days from written determination to decide. The app never auto-resolves: Admin records the decision (or confirms the office default after the deadline).',
    citation: ['3.08(a)(8)(b)', '3.08(b)(2)'],
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
  'time_difference_to_accumulate',
  'lock_in',
  'payroll_rounding',
  'accumulating',
  'bid_pending',
  'bump_eligible',
  'needs_review',
  'cumulative_drift',
  'stable',
];
