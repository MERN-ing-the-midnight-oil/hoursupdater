/**
 * Art. 3.08 window timing — when a logged time change becomes contracted,
 * goes to bid, or becomes bump-eligible.
 *
 * Assumptions (CBA-faithful, documented so they are not silent):
 * - "Written determination" uses the change's effective_date (when Routing
 *   logged the decrease). There is no separate notice-sent timestamp.
 * - The CBA names 15-minute and 30-minute bands. Magnitudes 1–29 follow the
 *   15-minute lock-in clock; 30+ follow bid/bump.
 * - After October 1, district and union read both increases and decreases as
 *   cumulative over 15 school days, not as separate single events. An under-30
 *   decrease stays open for those 15 school days. A later change inside the
 *   window is added in. 20 + 15 = 35, which is the 30-minute rule.
 * - Further changes still reset the countdown from that latest change and
 *   re-sum exact minutes (existing Rule 3). The new net then picks the
 *   matching Art. 3.08 clock.
 * - +30 that finishes its 15 school days after April waits for the next
 *   October–April last-five-school-day posting window (Art. 3.08(b)(1)
 *   posting months).
 */

import {
  BID_THRESHOLD_MINUTES,
  MONTHLY_BID_POSTING_MONTHS,
  WINDOW_SCHOOL_DAYS,
} from './constants.js';
import {
  addSchoolDays,
  getSchoolDays,
  nextCalendarDate,
  previousCalendarDate,
} from './calendar.js';
import { toDateString } from './timeUtils.js';

/**
 * @typedef {
 *   | 'pre_october_1_lock'
 *   | 'pre_october_1_bid'
 *   | 'pre_october_1_bump'
 *   | 'post_october_1_increase_lock'
 *   | 'post_october_1_decrease_lock'
 *   | 'post_october_1_bid'
 *   | 'post_october_1_bump'
 * } ContractWindowRule
 *
 * @typedef {{
 *   regime: 'pre_october_1' | 'post_october_1',
 *   rule: ContractWindowRule,
 *   citation: string,
 *   window_expires_date: string,
 *   becomes_effective_on: string,
 * }} ContractWindowPlan
 */

const BID_POSTING_MONTH_SET = new Set(MONTHLY_BID_POSTING_MONTHS);

/**
 * October 1 of the school year containing `date`.
 * School year is July–June (Sept 2026 → 2026-10-01; Jan 2027 → 2026-10-01).
 *
 * @param {string | Date} date
 * @returns {string}
 */
export function october1ForDate(date) {
  const iso = toDateString(date);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-10-01`;
}

/**
 * True through the day before October 1 (Art. 3.08(a)(8) review period).
 * October 1 itself uses the after-October-1 monthly rules.
 *
 * @param {string | Date} date
 * @returns {boolean}
 */
export function isPreOctober1ReviewPeriod(date) {
  return toDateString(date) < october1ForDate(date);
}

/**
 * Last-five school days of each Oct–April month, in date order.
 *
 * @param {import('./calendar.js').SchoolCalendar | string[] | import('./calendar.js').SchoolCalendarDay[]} calendar
 * @returns {string[]}
 */
export function monthlyBidPostingDays(calendar) {
  /** @type {Map<string, string[]>} */
  const byMonth = new Map();
  for (const day of getSchoolDays(calendar)) {
    const month = Number(day.slice(5, 7));
    if (!BID_POSTING_MONTH_SET.has(month)) {
      continue;
    }
    const key = day.slice(0, 7);
    const group = byMonth.get(key);
    if (group) {
      group.push(day);
    } else {
      byMonth.set(key, [day]);
    }
  }

  /** @type {string[]} */
  const posting = [];
  for (const group of byMonth.values()) {
    posting.push(...group.slice(-5));
  }
  return posting.sort();
}

/**
 * First Oct–April last-five school day on or after `date`.
 *
 * @param {import('./calendar.js').SchoolCalendar | string[] | import('./calendar.js').SchoolCalendarDay[]} calendar
 * @param {string | Date} date
 * @returns {string}
 */
export function firstMonthlyBidPostingOnOrAfter(calendar, date) {
  const start = toDateString(date);
  const found = monthlyBidPostingDays(calendar).find((day) => day >= start);
  if (!found) {
    throw new Error(
      `No October–April last-five-school-day bid posting date on or after ${start}. ` +
        'Extend school-calendar.json coverage.'
    );
  }
  return found;
}

/**
 * @param {string} effectiveOn
 * @returns {{ window_expires_date: string, becomes_effective_on: string }}
 */
function openThroughDayBefore(effectiveOn) {
  return {
    window_expires_date: previousCalendarDate(effectiveOn),
    becomes_effective_on: effectiveOn,
  };
}

/**
 * Timing plan for a change on `changeDate` whose running exact drift is `drift`.
 *
 * `window_expires_date` is the last day the window is still open
 * (`isWindowExpired` is true the calendar day after that).
 *
 * @param {import('./calendar.js').SchoolCalendar | string[] | import('./calendar.js').SchoolCalendarDay[]} calendar
 * @param {string | Date} changeDate
 * @param {number} drift
 * @returns {ContractWindowPlan}
 */
export function contractWindowPlan(calendar, changeDate, drift) {
  const start = toDateString(changeDate);
  const oct1 = october1ForDate(start);
  const preOctober1 = start < oct1;
  const magnitude = Math.abs(drift);

  if (magnitude >= BID_THRESHOLD_MINUTES && drift < 0) {
    if (preOctober1) {
      const dates = openThroughDayBefore(start);
      return {
        regime: 'pre_october_1',
        rule: 'pre_october_1_bump',
        citation: '3.08(a)(8)(b)',
        ...dates,
      };
    }
    const fifteenth = addSchoolDays(calendar, start, WINDOW_SCHOOL_DAYS);
    return {
      regime: 'post_october_1',
      rule: 'post_october_1_bump',
      citation: '3.08(b)(2)',
      window_expires_date: fifteenth,
      becomes_effective_on: nextCalendarDate(fifteenth),
    };
  }

  if (magnitude >= BID_THRESHOLD_MINUTES) {
    const fifteenth = addSchoolDays(calendar, start, WINDOW_SCHOOL_DAYS);
    if (fifteenth < oct1) {
      return {
        regime: 'pre_october_1',
        rule: 'pre_october_1_bid',
        citation: '3.08(a)(8)(a)',
        window_expires_date: fifteenth,
        becomes_effective_on: nextCalendarDate(fifteenth),
      };
    }
    const postingDay = firstMonthlyBidPostingOnOrAfter(
      calendar,
      nextCalendarDate(fifteenth)
    );
    const dates = openThroughDayBefore(postingDay);
    return {
      regime: preOctober1 ? 'pre_october_1' : 'post_october_1',
      rule: 'post_october_1_bid',
      citation: '3.08(b)(1)',
      ...dates,
    };
  }

  if (preOctober1) {
    const dates = openThroughDayBefore(oct1);
    return {
      regime: 'pre_october_1',
      rule: 'pre_october_1_lock',
      citation: '3.08(a)(8)(c)',
      ...dates,
    };
  }

  // Under 30 minutes after October 1: both directions stay open for 15
  // school days so later changes in that period add together. The total
  // becomes official the next school day after the 15th. Art. 3.08(b)(3)
  // for an increase; Art. 3.08(b)(4) for a decrease, with the written
  // determination at the close of that cumulative window.
  const fifteenth = addSchoolDays(calendar, start, WINDOW_SCHOOL_DAYS);
  const effective = addSchoolDays(calendar, fifteenth, 1);
  const dates = openThroughDayBefore(effective);
  if (drift < 0) {
    return {
      regime: 'post_october_1',
      rule: 'post_october_1_decrease_lock',
      citation: '3.08(b)(4)',
      ...dates,
    };
  }
  return {
    regime: 'post_october_1',
    rule: 'post_october_1_increase_lock',
    citation: '3.08(b)(3)',
    ...dates,
  };
}

/**
 * @param {import('./calendar.js').SchoolCalendar | string[] | import('./calendar.js').SchoolCalendarDay[]} calendar
 * @param {string | Date} changeDate
 * @param {number} drift
 * @returns {string}
 */
export function computeWindowExpiresDate(calendar, changeDate, drift) {
  return contractWindowPlan(calendar, changeDate, drift).window_expires_date;
}
