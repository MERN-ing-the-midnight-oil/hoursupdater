/** Shared Teamster contract constants — safe for Node and the browser. */

export const BID_THRESHOLD_MINUTES = 30;

/** Art. 3.08 15-school-day persistence / increase lock-in count. */
export const WINDOW_SCHOOL_DAYS = 15;

/**
 * Art. 3.08(b)(1): monthly bid reposting is only during the last five
 * school days of October through April.
 */
export const MONTHLY_BID_POSTING_MONTHS = [10, 11, 12, 1, 2, 3, 4];

/** Art. 3.08(a)(8)(b) / (b)(2): days for driver to elect bump or keep assignment. */
export const BUMP_DECISION_SCHOOL_DAYS = 2;

/** Art. 3.08(c)(1): school days to initial the open-bid sign-up. */
export const BID_RESPONSE_SCHOOL_DAYS = 2;

export const SEGMENTS = ['AM', 'MIDDAY', 'PM'];
