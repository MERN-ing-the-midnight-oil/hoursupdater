/**
 * Verbatim CBA excerpts keyed by citation ID.
 * `page` is the CBA printed footer number (not the PDF file page index).
 * Cover + TOC precede printed page 1, so PDF viewer pages are page + 2.
 */

export const CONTRACT_PDF_PATH = '/contract/Teamsters-CBA-2024-2027.pdf';

/** District HR page that lists the published Teamsters Local 231 CBA. */
export const CONTRACT_PUBLISHED_INDEX_URL =
  'https://www.bellinghamschools.org/about/departments/human-resources/collective-bargaining-agreements-and-salary-schedules';

/**
 * Official 2024–2027 Teamsters CBA PDF hosted by Bellingham Public Schools
 * (Finalsite resource for “Teamsters Union Local 231”).
 */
export const CONTRACT_PUBLISHED_PDF_URL =
  'https://resources.finalsite.net/images/v1786397695/bellinghamschoolsorg/lvay23uw9hvrfirn65td/2024-2027TeamstersCBA.pdf';

/** Printed footer page → PDF `#page=` index (cover + TOC). */
export const CONTRACT_PDF_PAGE_OFFSET = 2;

/**
 * @param {number} printedPage
 * @returns {string}
 */
export function contractPdfUrl(printedPage) {
  return `${CONTRACT_PDF_PATH}#page=${printedPage + CONTRACT_PDF_PAGE_OFFSET}`;
}

/**
 * @param {number} printedPage
 * @returns {string}
 */
export function publishedContractPdfUrl(printedPage) {
  return `${CONTRACT_PUBLISHED_PDF_URL}#page=${printedPage + CONTRACT_PDF_PAGE_OFFSET}`;
}

/**
 * @typedef {{
 *   label: string,
 *   page: number,
 *   text: string,
 * }} ContractCitation
 */

/** @type {Record<string, ContractCitation>} */
export const contractCitations = {
  "3.01": {
    label: "Art. 3.01",
    page: 3,
    text: `Definition of Seniority Date -- the employee's seniority date shall be defined as the date the employee commences regular employment with the District. The seniority order of employees hired on the same date shall be established by drawing lots.`
  },
  "3.08": {
    label: "Art. 3.08",
    page: 3,
    text: `Bus Driver Classification Vacancies -- The principles of seniority shall prevail when filling all vacant bus routes at the beginning of the school year, and thereafter when vacancies occur; provided, however, any employee successfully bidding from one bus route to another shall not be permitted to bid back to their previous route when it is subsequently posted as a result of their successful bid. This position and all changes resulting from the posting will go into effect on the same day.`
  },
  "3.08(a)(8)": {
    label: "Art. 3.08(a)(8)",
    page: 4,
    text: `8. On or before October 1, routes will be reviewed by the Transportation Director or their designee.`
  },
  "3.08(a)(8)(a)": {
    label: "Art. 3.08(a)(8)(a)",
    page: 4,
    text: `a. If an individual route has increased by thirty (30) minutes or more for fifteen (15) school days from the time of the initial bid, the route will go up for bid. Drivers will receive a written determination of an increase in their route and the notification that it will go up for bid.`
  },
  "3.08(a)(8)(b)": {
    label: "Art. 3.08(a)(8)(b)",
    page: 4,
    text: `b. If the route is decreased by thirty (30) minutes or more, that driver has the option of using their seniority to "bump" a driver with less seniority. Drivers will receive a written determination of a decrease in their route. Upon receipt of this written determination, the driver has two (2) school days to exercise their option to bump or confirm that they choose to retain their current assignment.`
  },
  "3.08(a)(8)(c)": {
    label: "Art. 3.08(a)(8)(c)",
    page: 4,
    text: `c. If a route increases or decreases by fifteen (15) minutes from the time of the initial bid, the time change will be made effective October 1.`
  },
  "3.08(b)": {
    label: "Art. 3.08(b)",
    page: 5,
    text: `b. Posting Routes Monthly After October 1st`
  },
  "3.08(b)(1)": {
    label: "Art. 3.08(b)(1)",
    page: 5,
    text: `1. During the last five (5) school days in each month from October through April, reposting will occur if a bus route is increased thirty (30) minutes or more for fifteen (15) school days or more. Drivers will receive a written determination of an increase in their route and the notification that it will go up for bid.`
  },
  "3.08(b)(2)": {
    label: "Art. 3.08(b)(2)",
    page: 5,
    text: `2. Upon determination that a route decreased thirty (30) minutes or more for fifteen (15) school days, that driver has the option of using their seniority to "bump" a driver with less seniority. Drivers will receive a written determination of a decrease in their route. Upon receipt of this written determination, the driver has two (2) school days to exercise their option to bump or confirm that they choose to retain their current assignment.`
  },
  "3.08(b)(3)": {
    label: "Art. 3.08(b)(3)",
    page: 5,
    text: `3. If a route increases by fifteen (15) minutes for fifteen (15) school days, the time change will be made effective on the workday following the 15th day.`
  },
  "3.08(b)(4)": {
    label: "Art. 3.08(b)(4)",
    page: 5,
    text: `4. Upon determination that a route decreased by fifteen (15) minutes, the driver will receive a written determination of a decrease in their route. The time change will be made effective the workday following the written notice of determination.`
  }
};
