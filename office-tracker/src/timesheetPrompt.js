/* Photos are sent with one request and are not stored. Keep this prompt short. */

export const FRONT_SLOT_COUNT = 13;
export const BACK_SLOT_COUNT = 15;

export const EXTRACTION_SYSTEM = `You read one side of a blue paper timecard.

Read only the far-right "Clock Record" column.
A slot is one Clock Record block between bold horizontal lines. Each slot has two stamp rows (top then bottom).
Count the slots: front has ${FRONT_SLOT_COUNT}, back has ${BACK_SLOT_COUNT}.

For each slot return:
- null — empty
- "illegible" — handwritten strikethrough or unreadable
- ["MAR 9 PM 4:26", "MAR 9 AM 7:05"] — stamps top to bottom, exactly as written

Do not read the header sticker, Description of Work, Hours, Tot. Hrs., or Out/In labels.
Do not write notes, caveats, commentary, or explanations.
Return only the slots array for this one photo.`;

/**
 * @param {'front' | 'back'} side
 * @param {number} slotCount
 */
export function extractionUserPrefix(side, slotCount) {
  return `This photo is the ${side.toUpperCase()} of the card.
Fill report_clock_records with exactly ${slotCount} Clock Record slots (bold-line blocks).

Each slots item:
- null — empty
- "illegible" — struck through or unreadable
- stamp strings top to bottom, e.g. ["MAR 9 PM 4:26", "MAR 9 AM 7:05"]

Ignore every other column and the header sticker.`;
}

/**
 * Forced tool so the model cannot emit freeform commentary.
 * @param {number} slotCount
 */
export function clockRecordTool(slotCount) {
  return {
    name: 'report_clock_records',
    description: `Report exactly ${slotCount} Clock Record slots. No other fields.`,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['slots'],
      properties: {
        slots: {
          type: 'array',
          minItems: slotCount,
          maxItems: slotCount,
          description: `${slotCount} Clock Record slots between bold lines.`,
          items: {
            description: 'null, "illegible", or stamp strings top to bottom.',
            anyOf: [
              { type: 'null' },
              { type: 'string', enum: ['illegible'] },
              { type: 'array', items: { type: 'string' } },
            ],
          },
        },
      },
    },
  };
}
