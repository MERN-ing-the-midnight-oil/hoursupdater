/**
 * Spreadsheet export of logged clock-time changes.
 * One data row per change, oldest first. The established starting schedule
 * is omitted — those times are not a change.
 */

const HEADERS = [
  'Name',
  'Date',
  'Run',
  'Previous times',
  'New times',
  'Change minutes',
  'Cumulative minutes',
  'Note',
  'Contracted status',
  'Becomes contracted on',
  'Result',
  'AM',
  'Midday',
  'PM',
];

/**
 * @param {string | null | undefined} segment
 */
function runLabel(segment) {
  if (segment === 'MIDDAY') return 'Midday';
  return segment || '';
}

/**
 * @param {Record<string, { range?: string, clock_in?: string, clock_out?: string } | null | undefined> | null | undefined} schedule
 * @param {string} segment
 */
function scheduleRange(schedule, segment) {
  const item = schedule?.[segment];
  if (!item) return '';
  if (item.range) return item.range;
  if (item.clock_in && item.clock_out) {
    return `${item.clock_in}-${item.clock_out}`;
  }
  return '';
}

/**
 * @param {unknown} value
 */
function numberCell(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/**
 * @param {unknown} value
 */
function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

/**
 * @param {{ employee?: { name?: string }, schedule_history?: object[] } | null | undefined} snapshot
 * @returns {string}
 */
export function buildChangesCsv(snapshot) {
  const name = snapshot?.employee?.name?.trim() || '';
  const changes = (snapshot?.schedule_history ?? []).filter(
    (row) => row?.kind === 'change'
  );
  const lines = [
    HEADERS.map(csvCell).join(','),
    ...changes.map((row) =>
      [
        name,
        row.date || '',
        runLabel(row.segment),
        row.previous_time || '',
        row.new_time || '',
        numberCell(row.delta_minutes),
        numberCell(row.cumulative_drift_minutes),
        row.note || '',
        row.contracted?.label || '',
        row.contracted?.becomes_on || '',
        row.contracted?.projected_outcome_label || '',
        scheduleRange(row.schedule, 'AM'),
        scheduleRange(row.schedule, 'MIDDAY'),
        scheduleRange(row.schedule, 'PM'),
      ]
        .map(csvCell)
        .join(',')
    ),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * @param {string | null | undefined} name
 */
export function changesCsvFilename(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `${slug}-clock-time-changes.csv` : 'clock-time-changes.csv';
}
