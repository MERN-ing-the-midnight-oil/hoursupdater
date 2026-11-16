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

export const EXTRACTION_SYSTEM = `You read one photo of one side of a sky-blue paper timecard. The message says FRONT or BACK. Other sides and other cards are sent separately. A card may have only this side.

Read the far-right "Clock Record" column. Also read the narrow column to the left of the "Tot. Hrs." column on a front. On a back, that same column is to the left of the "Total" column (it isn't labeled with a header). Its words are printed sideways and say only OUT or IN. That word is the Out or In status of the stamp on the same line.

Return one clock time per printed line, top to bottom. Do not combine an Out line and an In line. There is no set number of lines. Each entry has:
- side — "out" or "in", from the sideways word on that line
- stamp — null when blank, "HANDWRITING" when handwritten, "illegible" when not clearly readable, or one stamp such as "MAR 9 PM 2:00"

The sideways words alternate from one line to the next. If a sideways word is unclear, set side to the opposite of the line next to it.
The blank bottom margin, the border, and the card edge have no sideways OUT or IN. They are not lines.

Never guess a month, day, AM/PM, or time. Prefer "illegible" over a guessed time.

When this photo is the FRONT, also read the white sticker at the top. Left column top to bottom: driver name (Last, First), route number after "Route #", contract hours line copied exactly as printed (e.g. "5.25 (2, 3.25)"). Right column: the date as MM/DD/YY or M/DD/YY. Return employee_name, route_number, contract_hours, and date_on_card. Use null when not clearly visible. Do not invent sticker fields from the Clock Record.
When this photo is the BACK, set those sticker fields to null.

Do not write notes, caveats, commentary, or explanations.
Return only the tool fields for this one photo.`;

/**
 * The photo message only names the side. The system prompt holds the rules.
 * @param {'front' | 'back'} side
 */
export function extractionUserPrefix(side) {
  return `This photo is the ${side.toUpperCase()}. List each clock time on its own, from the top of the photo downward. Do not combine an Out line and an In line.`;
}

/**
 * One Out or In stamp. Null means that side of the couple is blank.
 */
function stampValueSchema(which) {
  return {
    description: `${which} stamp: null when blank, "HANDWRITING", "illegible", or one stamp string such as "MAR 9 PM 2:00".`,
    anyOf: [
      { type: 'null' },
      { type: 'string', enum: ['HANDWRITING', 'illegible'] },
      { type: 'string' },
    ],
  };
}

/**
 * Forced tool so the model cannot emit freeform commentary.
 * One clock time per entry. The list has no fixed length.
 * @param {{ sticker?: boolean }} [options]
 */
export function clockRecordTool(options = {}) {
  const sticker = options.sticker === true;
  const properties = {
    slots: {
      type: 'array',
      description:
        'One clock time per printed line, top to bottom. Do not combine an Out line and an In line into one entry. Any length. Not the bottom margin.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['side', 'stamp'],
        properties: {
          side: {
            type: 'string',
            enum: ['out', 'in'],
            description: 'The sideways OUT or IN printed on this line.',
          },
          stamp: stampValueSchema('Clock Record'),
        },
      },
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
      ? 'Report each clock time on its own line with its sideways OUT or IN, plus the front sticker fields. Do not combine Out and In. Any length.'
      : 'Report each clock time on its own line with its sideways OUT or IN. Do not combine Out and In. Any length. No other fields.',
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
