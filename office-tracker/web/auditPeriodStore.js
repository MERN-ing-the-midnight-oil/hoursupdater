const STORAGE_KEY = 'teamster-audit-pay-periods';

/**
 * @param {Storage | { getItem: (key: string) => string | null, setItem: (key: string, value: string) => void }} [storage]
 */
export function readAuditPeriodRecord(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || '');
    const byEnd = parsed?.byEnd;
    if (!byEnd || typeof byEnd !== 'object') return {};
    return byEnd;
  } catch {
    return {};
  }
}

/**
 * Remember one audited pay period in this browser. A later check of the same end date replaces it.
 * @param {{ iso: string, mistakeCount: number, uncheckedCount: number, result: string }} entry
 * @param {Storage | { getItem: (key: string) => string | null, setItem: (key: string, value: string) => void }} [storage]
 */
export function saveAuditPeriodResult(entry, storage = globalThis.localStorage) {
  const iso = String(entry?.iso || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return readAuditPeriodRecord(storage);
  const byEnd = readAuditPeriodRecord(storage);
  byEnd[iso] = {
    iso,
    auditedAt: new Date().toISOString(),
    mistakeCount: Number(entry.mistakeCount) || 0,
    uncheckedCount: Number(entry.uncheckedCount) || 0,
    result: String(entry.result || ''),
  };
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, byEnd }));
  } catch {
    /* A full browser store should not hide the check that just ran. */
  }
  return byEnd;
}

/**
 * Short result line stored next to a pay period.
 * @param {{ mistakeCount?: number, uncheckedCount?: number }} report
 */
export function auditPeriodResultText() {
  return 'Checked';
}
