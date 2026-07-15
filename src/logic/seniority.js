/**
 * Computed seniority order from hire dates (Art. 3.01).
 * Rank is never stored — always derived from hire_date (+ optional tie_break).
 */

/**
 * @typedef {import('../data/storage.js').Driver} Driver
 *
 * @typedef {Driver & {
 *   seniority_rank: number | null,
 *   seniority_total: number,
 *   missing_hire_date: boolean,
 * }} RankedDriver
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeHireDate(value) {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(
      `hire_date must be YYYY-MM-DD (got "${text}").`
    );
  }
  const [y, m, d] = text.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new Error(`hire_date is not a valid calendar date: "${text}".`);
  }
  return text;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function normalizeTieBreak(value) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `tie_break must be a positive integer (got "${value}").`
    );
  }
  return n;
}

/**
 * Compare two drivers for seniority: earlier hire_date = more senior.
 * Same-date ties use tie_break ascending (lots outcome). Missing hire_date
 * sorts after everyone with a date (cannot be ranked).
 *
 * @param {Driver} a
 * @param {Driver} b
 * @returns {number}
 */
export function compareDriversBySeniority(a, b) {
  const aDate = a.hire_date ?? null;
  const bDate = b.hire_date ?? null;
  if (aDate && bDate) {
    const byDate = aDate.localeCompare(bDate);
    if (byDate !== 0) return byDate;
    const aTie = a.tie_break ?? Number.POSITIVE_INFINITY;
    const bTie = b.tie_break ?? Number.POSITIVE_INFINITY;
    if (aTie !== bTie) return aTie - bTie;
    return a.name.localeCompare(b.name);
  }
  if (aDate && !bDate) return -1;
  if (!aDate && bDate) return 1;
  return a.name.localeCompare(b.name);
}

/**
 * All drivers sorted by seniority. Rank is 1-based among drivers who have
 * hire_date; drivers missing hire_date get seniority_rank: null.
 *
 * @param {Driver[]} drivers
 * @returns {RankedDriver[]}
 */
export function getSeniorityOrder(drivers) {
  const sorted = [...(drivers ?? [])].sort(compareDriversBySeniority);
  const withDates = sorted.filter((d) => d.hire_date);
  const total = withDates.length;
  /** @type {Map<string, number>} */
  const rankById = new Map();
  withDates.forEach((driver, index) => {
    rankById.set(driver.driver_id, index + 1);
  });

  return sorted.map((driver) => ({
    ...driver,
    seniority_rank: driver.hire_date
      ? (rankById.get(driver.driver_id) ?? null)
      : null,
    seniority_total: total,
    missing_hire_date: !driver.hire_date,
  }));
}

/**
 * @param {Driver[]} drivers
 * @param {string} driverId
 * @returns {{ rank: number | null, total: number, missing_hire_date: boolean } | null}
 */
export function getDriverSeniorityRank(drivers, driverId) {
  const ordered = getSeniorityOrder(drivers);
  const row = ordered.find((d) => d.driver_id === driverId);
  if (!row) return null;
  return {
    rank: row.seniority_rank,
    total: row.seniority_total,
    missing_hire_date: row.missing_hire_date,
  };
}

/**
 * @param {Driver[]} drivers
 * @returns {Driver[]}
 */
export function driversMissingHireDate(drivers) {
  return (drivers ?? []).filter((d) => !d.hire_date);
}

/**
 * Same hire_date groups of 2+ where lots order is not fully recorded:
 * any missing tie_break, or duplicate tie_break values.
 *
 * @param {Driver[]} drivers
 * @returns {{ hire_date: string, drivers: Driver[] }[]}
 */
export function findUnresolvedSeniorityTies(drivers) {
  /** @type {Map<string, Driver[]>} */
  const byDate = new Map();
  for (const driver of drivers ?? []) {
    if (!driver.hire_date) continue;
    const group = byDate.get(driver.hire_date) ?? [];
    group.push(driver);
    byDate.set(driver.hire_date, group);
  }

  /** @type {{ hire_date: string, drivers: Driver[] }[]} */
  const ties = [];
  const dates = [...byDate.keys()].sort((a, b) => a.localeCompare(b));
  for (const hire_date of dates) {
    const group = byDate.get(hire_date) ?? [];
    if (group.length < 2) continue;
    const values = group.map((d) => d.tie_break ?? null);
    const anyMissing = values.some((v) => v == null);
    const present = values.filter((v) => v != null);
    const hasDuplicates = present.length !== new Set(present).size;
    if (anyMissing || hasDuplicates) {
      ties.push({
        hire_date,
        drivers: [...group].sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
  }
  return ties;
}

/**
 * Apply lots order for one hire_date group. ordered_driver_ids is most senior first
 * (tie_break 1, 2, 3, …). Must list every driver with that hire_date exactly once.
 *
 * @param {Driver[]} drivers
 * @param {{ hire_date: string, ordered_driver_ids: string[] }} input
 * @returns {Driver[]}
 */
export function applySeniorityTieResolution(drivers, input) {
  const hire_date = normalizeHireDate(input.hire_date);
  if (!hire_date) {
    throw new Error('hire_date is required.');
  }
  const ordered = (input.ordered_driver_ids ?? []).map((id) =>
    String(id || '').trim()
  );
  if (!ordered.length || ordered.some((id) => !id)) {
    throw new Error('ordered_driver_ids must list every tied driver.');
  }
  if (new Set(ordered).size !== ordered.length) {
    throw new Error('ordered_driver_ids must not contain duplicates.');
  }

  const group = (drivers ?? []).filter((d) => d.hire_date === hire_date);
  if (group.length < 2) {
    throw new Error(
      `No seniority tie to resolve for hire_date ${hire_date} (need 2+ drivers).`
    );
  }
  const groupIds = new Set(group.map((d) => d.driver_id));
  if (ordered.length !== group.length) {
    throw new Error(
      `ordered_driver_ids must include all ${group.length} drivers hired on ${hire_date}.`
    );
  }
  for (const id of ordered) {
    if (!groupIds.has(id)) {
      throw new Error(
        `Driver "${id}" is not in the ${hire_date} hire-date tie group.`
      );
    }
  }

  /** @type {Map<string, number>} */
  const rankById = new Map(
    ordered.map((id, index) => [id, index + 1])
  );
  return (drivers ?? []).map((driver) => {
    const tie_break = rankById.get(driver.driver_id);
    if (tie_break == null) return driver;
    return { ...driver, tie_break };
  });
}
