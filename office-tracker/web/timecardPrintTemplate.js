/**
 * Canonical upright blue-card layout for Reg/OT burn-in after warp.
 * Coordinates are normalized 0–1 over the rectified card face.
 * Tuned for a typical 5×8 sky-blue school-bus card (front sticker + grid).
 */

export const TEMPLATE_WIDTH = 1000;
export const TEMPLATE_HEIGHT = 1600;

/** @typedef {{ x: number, y: number }} NormPoint */
/** @typedef {{ reg: NormPoint, ot: NormPoint, fontNorm: number }} SlotCells */

const FRONT_SLOTS = 13;
const BACK_SLOTS = 15;

/** Hours Reg / OT column centers on the printed grid. */
const REG_X = 0.455;
const OT_X = 0.535;

/**
 * Vertical band of the Clock Record / hours grid (below the front sticker).
 * Front leaves room for the white name sticker; back uses almost the full face.
 */
const FRONT_GRID = { top: 0.175, bottom: 0.965 };
const BACK_GRID = { top: 0.055, bottom: 0.965 };

/**
 * @param {number} slotCount
 * @param {{ top: number, bottom: number }} grid
 * @returns {SlotCells[]}
 */
function buildSlots(slotCount, grid) {
  const span = grid.bottom - grid.top;
  const band = span / slotCount;
  /** @type {SlotCells[]} */
  const slots = [];
  for (let index = 0; index < slotCount; index += 1) {
    const y = grid.top + (index + 0.5) * band;
    slots.push({
      reg: { x: REG_X, y },
      ot: { x: OT_X, y },
      fontNorm: Math.min(0.028, band * 0.55),
    });
  }
  return slots;
}

export const FRONT_REG_OT_SLOTS = buildSlots(FRONT_SLOTS, FRONT_GRID);
export const BACK_REG_OT_SLOTS = buildSlots(BACK_SLOTS, BACK_GRID);

/**
 * @param {'front' | 'back'} side
 */
export function slotCountForSide(side) {
  return side === 'back' ? BACK_SLOTS : FRONT_SLOTS;
}

/**
 * @param {'front' | 'back'} side
 * @returns {SlotCells[]}
 */
export function regOtSlotsForSide(side) {
  return side === 'back' ? BACK_REG_OT_SLOTS : FRONT_REG_OT_SLOTS;
}

/**
 * Pixel center for one Reg or OT cell on the template canvas.
 * @param {'front' | 'back'} side
 * @param {number} slotIndex zero-based
 * @param {'reg' | 'ot'} field
 * @param {number} [width]
 * @param {number} [height]
 */
export function templateCellPixel(side, slotIndex, field, width = TEMPLATE_WIDTH, height = TEMPLATE_HEIGHT) {
  const slots = regOtSlotsForSide(side);
  const slot = slots[slotIndex];
  if (!slot) return null;
  const point = field === 'ot' ? slot.ot : slot.reg;
  return {
    x: point.x * width,
    y: point.y * height,
    fontPx: Math.max(10, slot.fontNorm * height),
  };
}
