/* Photos are sent with one request and are not stored. Keep this prompt short. */

export const FRONT_SLOT_COUNT = 13;
export const BACK_SLOT_COUNT = 15;
/** Clock Record lines on the front (two lines per Out/In pair). */
export const FRONT_LINE_COUNT = FRONT_SLOT_COUNT * 2;
/** Clock Record lines on the back (two lines per Out/In pair). */
export const BACK_LINE_COUNT = BACK_SLOT_COUNT * 2;

/**
 * @param {'front' | 'back'} side
 */
export function lineCountForSide(side) {
  return side === 'front' ? FRONT_LINE_COUNT : BACK_LINE_COUNT;
}

export const EXTRACTION_SYSTEM = `You read one side of a sky-blue paper timecard.

Look only at the far-right "Clock Record" column. Ignore every other column.
Read every Clock Record line from the top of the column to the bottom.
Front has exactly ${FRONT_LINE_COUNT} lines. Back has exactly ${BACK_LINE_COUNT} lines.

For each line return one of:
- null — blank
- "HANDWRITING" — handwritten (not a machine stamp)
- "illegible" — struck through, blurry, cut off, or not clearly readable
- one stamp string when month, day, AM or PM, and time are all clear — prefer "MON D AM|PM H:MM", e.g. "MAR 9 PM 2:00"

Never guess a month, day, AM/PM, or time. Prefer "illegible" over a guessed time.

On the FRONT photo, also read the white sticker at the top. Left column top to bottom: driver name (Last, First), route number after "Route #", contract hours line copied exactly as printed (e.g. "5.25 (2, 3.25)"). Right column: the date as MM/DD/YY or M/DD/YY. Return employee_name, route_number, contract_hours, and date_on_card. Use null when not clearly visible. Do not invent sticker fields from the Clock Record.
On the BACK photo, set those sticker fields to null.

Do not write notes, caveats, commentary, or explanations.
Return only the tool fields for this one photo.`;

/**
 * @param {'front' | 'back'} side
 * @param {number} lineCount
 */
export function extractionUserPrefix(side, lineCount) {
  const sticker =
    side === 'front'
      ? `Also read the white sticker at the top.
Left column: employee_name (Last, First), route_number (after "Route #"), contract_hours exactly as printed (e.g. "5.25 (2, 3.25)").
Right column: date_on_card as MM/DD/YY or M/DD/YY.
Use null when a part is not clearly visible. Do not invent sticker fields from the stamps.`
      : 'Set employee_name, route_number, contract_hours, and date_on_card to null. The sticker is only on the front.';
  return `This photo is the ${side.toUpperCase()} of a sky-blue paper timecard.
Fill report_clock_records with exactly ${lineCount} Clock Record lines, top to bottom.

For each line:
- null — blank
- "HANDWRITING" — handwritten (not machine-stamped)
- "illegible" — struck through, blurry, cut off, or not clearly legible
- one stamp string when clear — prefer "MON D AM|PM H:MM", e.g. "MAR 9 PM 2:00"

Never guess. Prefer "illegible" over a guessed time.
Ignore every other column.
${sticker}`;
}

/**
 * Forced tool so the model cannot emit freeform commentary.
 * @param {number} lineCount
 * @param {{ sticker?: boolean }} [options]
 */
export function clockRecordTool(lineCount, options = {}) {
  const sticker = options.sticker === true;
  const stampLine = {
    description: 'null, "HANDWRITING", "illegible", or one stamp string such as "MAR 9 PM 2:00".',
    anyOf: [
      { type: 'null' },
      { type: 'string', enum: ['HANDWRITING', 'illegible'] },
      { type: 'string' },
    ],
  };
  const properties = {
    slots: {
      type: 'array',
      minItems: lineCount,
      maxItems: lineCount,
      description: `${lineCount} Clock Record lines from top to bottom.`,
      items: stampLine,
    },
  };
  if (sticker) {
    properties.employee_name = {
      description: 'Driver name on the front white sticker (Last, First). null when not visible.',
      anyOf: [{ type: 'null' }, { type: 'string' }],
    };
    properties.route_number = {
      description: 'Route number after "Route #" on the front sticker. null when not visible.',
      anyOf: [{ type: 'null' }, { type: 'string' }],
    };
    properties.contract_hours = {
      description:
        'Contract hours line under the route, copied as printed (e.g. "5.25 (2, 3.25)"). null when missing.',
      anyOf: [{ type: 'null' }, { type: 'string' }, { type: 'number' }],
    };
    properties.date_on_card = {
      description: 'Date on the sticker right column as MM/DD/YY or M/DD/YY. null when not visible.',
      anyOf: [{ type: 'null' }, { type: 'string' }],
    };
  }
  return {
    name: 'report_clock_records',
    description: sticker
      ? `Report exactly ${lineCount} Clock Record lines plus the front sticker fields.`
      : `Report exactly ${lineCount} Clock Record lines. No other fields.`,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: sticker
        ? ['slots', 'employee_name', 'route_number', 'contract_hours', 'date_on_card']
        : ['slots'],
      properties,
    },
  };
}
