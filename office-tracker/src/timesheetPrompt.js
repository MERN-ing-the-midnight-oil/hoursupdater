/* Photos are sent with one request and are not stored. Keep this prompt short. */

export const FRONT_SLOT_COUNT = 13;
export const BACK_SLOT_COUNT = 15;

export const EXTRACTION_SYSTEM = `You read one side of a blue paper timecard.

Read only the far-right "Clock Record" column.
A slot is one Clock Record block between bold horizontal lines. Each slot has two stamp rows (top then bottom).
Count the slots: front has ${FRONT_SLOT_COUNT}, back has ${BACK_SLOT_COUNT}.

For each slot return:
- null — empty
- "HANDWRITING" — handwritten clock times (not a machine stamp)
- "illegible" — struck through, blurry, cut off, or not clearly legible
- ["MAR 9 PM 2:00", "MAR 9 PM 5:15"] — stamps top to bottom, exactly as written
A stamp string may also be "HANDWRITING" or "illegible" when only that row is handwritten or unreadable.

Never guess or invent a stamp. If any clock time is not clearly legible, return "illegible" for that stamp or slot.
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
- "HANDWRITING" — handwritten (not machine-stamped)
- "illegible" — struck through, blurry, cut off, or not clearly legible
- stamp strings top to bottom, e.g. ["MAR 9 PM 2:00", "MAR 9 PM 5:15"]
A stamp may be "HANDWRITING" or "illegible" on its own.

Never guess. Prefer "illegible" over a guessed time.
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
            description: 'null, "HANDWRITING", "illegible", or stamp strings top to bottom.',
            anyOf: [
              { type: 'null' },
              { type: 'string', enum: ['HANDWRITING', 'illegible'] },
              { type: 'array', items: { type: 'string' } },
            ],
          },
        },
      },
    },
  };
}
