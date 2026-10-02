import { EXTRACTION_SYSTEM, EXTRACTION_USER_PREFIX } from './timesheetPrompt.js';

const FRONT_ENTRY_COUNT = 13;
const BACK_ENTRY_COUNT = 15;

const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export { EXTRACTION_SYSTEM, EXTRACTION_USER_PREFIX };

/**
 * @param {string | null | undefined} dateOnCard
 */
export function inferDefaultYear(dateOnCard) {
  if (dateOnCard) {
    const text = String(dateOnCard);
    const full = text.match(/\b(19|20)\d{2}\b/);
    if (full) return parseInt(full[0], 10);
    const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/);
    if (slash) {
      const year = parseInt(slash[3], 10);
      return year >= 70 ? 1900 + year : 2000 + year;
    }
  }
  return new Date().getFullYear();
}

/**
 * @param {Date} date
 */
export function toLocalWallIso(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const da = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${da}T${h}:${m}:${s}`;
}

/**
 * @param {string} raw
 * @param {number} defaultYear
 */
export function parseLegacyStampToDate(raw, defaultYear) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const wall = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (wall) {
    return new Date(
      Number(wall[1]),
      Number(wall[2]) - 1,
      Number(wall[3]),
      Number(wall[4]),
      Number(wall[5]),
      0,
      0
    );
  }

  let match = text.match(
    /^([A-Za-z]{3})\s+(\d{1,2})\s+(AM|PM)\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/i
  );
  if (match) return dateFromCardParts(match[1], match[2], match[4], match[5], match[3], defaultYear);

  match = text.match(
    /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)\s*$/i
  );
  if (match) return dateFromCardParts(match[1], match[2], match[3], match[4], match[6], defaultYear);

  match = text.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/i);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    if (month === undefined) return null;
    const hour = parseInt(match[3], 10);
    const minute = parseInt(match[4], 10);
    if (hour > 23 || minute > 59) return null;
    return new Date(defaultYear, month, parseInt(match[2], 10), hour, minute, 0, 0);
  }

  return null;
}

function dateFromCardParts(monthName, dayText, hourText, minuteText, ampm, defaultYear) {
  const month = MONTHS[String(monthName).toLowerCase()];
  if (month === undefined) return null;
  let hour = parseInt(hourText, 10);
  const minute = parseInt(minuteText, 10);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const isPm = String(ampm).toUpperCase() === 'PM';
  if (isPm && hour !== 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;
  return new Date(defaultYear, month, parseInt(dayText, 10), hour, minute, 0, 0);
}

/**
 * @param {string} text
 */
export function parseJsonFromAssistantText(text) {
  const trimmed = String(text ?? '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Model returned non-JSON output.');
  }
  return JSON.parse(body.slice(start, end + 1));
}

function coerceStringOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (text === '' || text.toLowerCase() === 'null') return null;
  return text;
}

function parseHourField(value) {
  if (value == null) return null;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '' || text.toLowerCase() === 'null') return null;
    if (text === '•' || text === '\u2022') return 0;
    if (text === 'REDACTED' || text === 'ILLEGIBLE') return text;
    const number = parseFloat(text.replace(',', '.'));
    if (!Number.isNaN(number)) return number;
    return text;
  }
  return null;
}

function clockFromModelValue(value, defaultYear) {
  if (value == null) return { raw: null, iso: null };
  if (value === 'REDACTED') return { raw: 'REDACTED', iso: null };
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '' || text.toLowerCase() === 'null') return { raw: null, iso: null };
    if (text === 'REDACTED') return { raw: 'REDACTED', iso: null };
    const date = parseLegacyStampToDate(text, defaultYear);
    return { raw: text, iso: date ? toLocalWallIso(date) : null };
  }
  if (typeof value !== 'object') return { raw: null, iso: null };
  const date = String(value.date ?? '').trim();
  const period = String(value.period ?? '').trim().toUpperCase();
  const time = String(value.time ?? '').trim();
  if (!date || !period || !time) return { raw: null, iso: null };
  const raw = `${date} ${period} ${time}`.replace(/\s+/g, ' ');
  if (period !== 'AM' && period !== 'PM') return { raw, iso: null };
  const parsed = parseLegacyStampToDate(raw, defaultYear);
  return { raw, iso: parsed ? toLocalWallIso(parsed) : null };
}

function blankRow(rowIndex) {
  return {
    row_index: rowIndex,
    description_of_work: null,
    hours_regular: null,
    hours_overtime: null,
    hours_secondary: null,
    total_hours: null,
    clock_in_raw: null,
    clock_out_raw: null,
    clock_in_iso: null,
    clock_out_iso: null,
    clock_in_override_iso: null,
    clock_out_override_iso: null,
    crossed_out: false,
    confidence_note: null,
  };
}

function normalizeOneRow(raw, fallbackIndex, defaultYear) {
  if (raw == null || typeof raw !== 'object') return blankRow(fallbackIndex);
  let clockInRaw = coerceStringOrNull(raw.clock_in_raw);
  let clockOutRaw = coerceStringOrNull(raw.clock_out_raw);
  let clockInIso = coerceStringOrNull(raw.clock_in_iso);
  let clockOutIso = coerceStringOrNull(raw.clock_out_iso);
  if (raw.clock_in !== undefined || raw.clock_out !== undefined) {
    const clockIn = clockFromModelValue(raw.clock_in, defaultYear);
    const clockOut = clockFromModelValue(raw.clock_out, defaultYear);
    if (clockIn.raw != null) {
      clockInRaw = clockIn.raw;
      clockInIso = clockIn.iso;
    }
    if (clockOut.raw != null) {
      clockOutRaw = clockOut.raw;
      clockOutIso = clockOut.iso;
    }
  }
  const rowIndex =
    typeof raw.row_index === 'number' && Number.isFinite(raw.row_index)
      ? Math.floor(raw.row_index)
      : fallbackIndex;
  return {
    row_index: rowIndex,
    description_of_work:
      coerceStringOrNull(raw.description_of_work) ?? coerceStringOrNull(raw.description),
    hours_regular:
      raw.hours_regular !== undefined
        ? parseHourField(raw.hours_regular)
        : raw.hours_reg !== undefined
          ? parseHourField(raw.hours_reg)
          : null,
    hours_overtime:
      raw.hours_overtime !== undefined
        ? parseHourField(raw.hours_overtime)
        : raw.hours_ot !== undefined
          ? parseHourField(raw.hours_ot)
          : null,
    hours_secondary: raw.hours_secondary !== undefined ? parseHourField(raw.hours_secondary) : null,
    total_hours:
      raw.total_hours !== undefined
        ? parseHourField(raw.total_hours)
        : raw.tot_hours !== undefined
          ? parseHourField(raw.tot_hours)
          : null,
    clock_in_raw: clockInRaw,
    clock_out_raw: clockOutRaw,
    clock_in_iso: clockInIso,
    clock_out_iso: clockOutIso,
    clock_in_override_iso: coerceStringOrNull(raw.clock_in_override_iso),
    clock_out_override_iso: coerceStringOrNull(raw.clock_out_override_iso),
    crossed_out: raw.crossed_out === true,
    confidence_note: coerceStringOrNull(raw.confidence_note),
  };
}

function stampCount(row) {
  const hasIn = Boolean(row.clock_in_iso?.trim()) || Boolean(String(row.clock_in_raw ?? '').trim());
  const hasOut = Boolean(row.clock_out_iso?.trim()) || Boolean(String(row.clock_out_raw ?? '').trim());
  return (hasIn ? 1 : 0) + (hasOut ? 1 : 0);
}

function needsLegacyStampCollapse(rows, slotCount) {
  if (rows.length <= slotCount) return false;
  const singles = rows.filter((row) => stampCount(row) === 1).length;
  return rows.length > slotCount || singles / Math.max(rows.length, 1) > 0.55;
}

function mergeLegacyPair(outRow, inRow, rowIndex) {
  return {
    row_index: rowIndex,
    description_of_work: outRow.description_of_work ?? inRow.description_of_work,
    hours_regular: outRow.hours_regular ?? inRow.hours_regular,
    hours_overtime: outRow.hours_overtime ?? inRow.hours_overtime,
    hours_secondary: outRow.hours_secondary ?? inRow.hours_secondary,
    total_hours: outRow.total_hours ?? inRow.total_hours,
    clock_out_raw: outRow.clock_out_raw,
    clock_out_iso: outRow.clock_out_iso,
    clock_in_raw: inRow.clock_in_raw,
    clock_in_iso: inRow.clock_in_iso,
    clock_in_override_iso: outRow.clock_in_override_iso ?? inRow.clock_in_override_iso,
    clock_out_override_iso: outRow.clock_out_override_iso ?? inRow.clock_out_override_iso,
    crossed_out: Boolean(outRow.crossed_out || inRow.crossed_out),
    confidence_note:
      [outRow.confidence_note, inRow.confidence_note].filter((note) => String(note ?? '').trim()).join(' · ') ||
      null,
  };
}

function collapseLegacyStampRows(rows) {
  const sorted = [...rows].sort((a, b) => a.row_index - b.row_index);
  const out = [];
  let index = 0;
  let nextIndex = 1;
  while (index < sorted.length) {
    const current = sorted[index];
    const next = sorted[index + 1];
    const hasOut = Boolean(current.clock_out_raw?.trim() || current.clock_out_iso?.trim());
    const hasIn = Boolean(current.clock_in_raw?.trim() || current.clock_in_iso?.trim());
    if (next && hasOut && !hasIn) {
      const nextIn = Boolean(next.clock_in_raw?.trim() || next.clock_in_iso?.trim());
      const nextOut = Boolean(next.clock_out_raw?.trim() || next.clock_out_iso?.trim());
      if (nextIn && !nextOut) {
        out.push(mergeLegacyPair(current, next, nextIndex));
        nextIndex += 1;
        index += 2;
        continue;
      }
    }
    if (next && hasIn && !hasOut) {
      const nextOut = Boolean(next.clock_out_raw?.trim() || next.clock_out_iso?.trim());
      const nextIn = Boolean(next.clock_in_raw?.trim() || next.clock_in_iso?.trim());
      if (nextOut && !nextIn) {
        out.push(mergeLegacyPair(next, current, nextIndex));
        nextIndex += 1;
        index += 2;
        continue;
      }
    }
    out.push({ ...current, row_index: nextIndex });
    nextIndex += 1;
    index += 1;
  }
  return out;
}

function reindexAndPad(rows, count) {
  const sorted = [...rows].sort((a, b) => a.row_index - b.row_index);
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const existing = sorted[index];
    out.push(existing ? { ...existing, row_index: index + 1 } : blankRow(index + 1));
  }
  return out;
}

function normalizeHeader(raw) {
  if (raw == null || typeof raw !== 'object') return null;
  return {
    employee_name: coerceStringOrNull(raw.employee_name),
    route_number: coerceStringOrNull(raw.route_number),
    date_on_card: coerceStringOrNull(raw.date_on_card),
  };
}

/**
 * @param {object} input
 */
export function normalizeTimeCardExtraction(input) {
  const header = input?.header ? normalizeHeader(input.header) : null;
  const defaultYear = inferDefaultYear(header?.date_on_card ?? null);
  let front = (input?.front_rows ?? []).map((row, index) => normalizeOneRow(row, index + 1, defaultYear));
  let back = (input?.back_rows ?? []).map((row, index) => normalizeOneRow(row, index + 1, defaultYear));
  if (needsLegacyStampCollapse(front, FRONT_ENTRY_COUNT)) front = collapseLegacyStampRows(front);
  if (needsLegacyStampCollapse(back, BACK_ENTRY_COUNT)) back = collapseLegacyStampRows(back);
  return {
    header,
    front_rows: reindexAndPad(front, FRONT_ENTRY_COUNT),
    back_rows: reindexAndPad(back, BACK_ENTRY_COUNT),
    front_reading_order_note: coerceStringOrNull(input?.front_reading_order_note),
    caveats: Array.isArray(input?.caveats) ? input.caveats.filter((item) => typeof item === 'string') : [],
  };
}

/**
 * @param {unknown} parsed
 */
export function normalizeExtractionFromUnknown(parsed) {
  if (parsed == null || typeof parsed !== 'object') {
    return normalizeTimeCardExtraction({
      header: null,
      front_rows: [],
      back_rows: [],
      front_reading_order_note: null,
      caveats: ['Invalid extraction payload'],
    });
  }
  const header = normalizeHeader(parsed.header);
  const year = inferDefaultYear(header?.date_on_card ?? null);
  const frontRaw = parsed.front_rows ?? parsed.front_entries;
  const backRaw = parsed.back_rows ?? parsed.back_entries;
  return normalizeTimeCardExtraction({
    header,
    front_rows: Array.isArray(frontRaw)
      ? frontRaw.map((row, index) => normalizeOneRow(row, index + 1, year))
      : [],
    back_rows: Array.isArray(backRaw)
      ? backRaw.map((row, index) => normalizeOneRow(row, index + 1, year))
      : [],
    front_reading_order_note: coerceStringOrNull(parsed.front_reading_order_note),
    caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((item) => typeof item === 'string') : [],
  });
}
