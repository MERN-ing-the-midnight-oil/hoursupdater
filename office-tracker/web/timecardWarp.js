import { formatAuditHours } from '../src/timesheetAudit.js';
import {
  TEMPLATE_HEIGHT,
  TEMPLATE_WIDTH,
  regOtSlotsForSide,
  templateCellPixel,
} from './timecardPrintTemplate.js';

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ reg?: number | null, ot?: number | null }} SlotHours
 */

/**
 * Solve an 8×8 linear system (Gaussian elimination with partial pivot).
 * @param {number[][]} a
 * @param {number[]} b
 * @returns {number[] | null}
 */
export function solveLinearSystem(a, b) {
  const n = b.length;
  const m = a.map((row, index) => [...row, b[index]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const swap = m[col];
      m[col] = m[pivot];
      m[pivot] = swap;
    }
    const div = m[col][col];
    for (let j = col; j <= n; j += 1) m[col][j] /= div;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = m[row][col];
      if (Math.abs(factor) < 1e-15) continue;
      for (let j = col; j <= n; j += 1) m[row][j] -= factor * m[col][j];
    }
  }
  return m.map((row) => row[n]);
}

/**
 * Homography mapping src quad → dst quad (3×3 row-major, h33 = 1).
 * Quads are TL, TR, BR, BL.
 * @param {Point[]} src
 * @param {Point[]} dst
 * @returns {number[] | null} length 9
 */
export function computeHomography(src, dst) {
  if (!Array.isArray(src) || !Array.isArray(dst) || src.length !== 4 || dst.length !== 4) {
    return null;
  }
  /** @type {number[][]} */
  const a = [];
  /** @type {number[]} */
  const b = [];
  for (let i = 0; i < 4; i += 1) {
    const { x: xs, y: ys } = src[i];
    const { x: xd, y: yd } = dst[i];
    if (![xs, ys, xd, yd].every((v) => Number.isFinite(v))) return null;
    a.push([xs, ys, 1, 0, 0, 0, -xd * xs, -xd * ys]);
    b.push(xd);
    a.push([0, 0, 0, xs, ys, 1, -yd * xs, -yd * ys]);
    b.push(yd);
  }
  const h = solveLinearSystem(a, b);
  if (!h) return null;
  return [...h, 1];
}

/**
 * @param {number[]} h length 9
 * @param {number} x
 * @param {number} y
 * @returns {Point | null}
 */
export function applyHomography(h, x, y) {
  if (!Array.isArray(h) || h.length < 9) return null;
  const w = h[6] * x + h[7] * y + h[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return null;
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
}

/**
 * Invert a 3×3 homography (row-major).
 * @param {number[]} h
 * @returns {number[] | null}
 */
export function invertHomography(h) {
  if (!Array.isArray(h) || h.length < 9) return null;
  const a = h[0];
  const b = h[1];
  const c = h[2];
  const d = h[3];
  const e = h[4];
  const f = h[5];
  const g = h[6];
  const i = h[7];
  const j = h[8];
  const A = e * j - f * i;
  const B = c * i - b * j;
  const C = b * f - c * e;
  const D = f * g - d * j;
  const E = a * j - c * g;
  const F = c * d - a * f;
  const G = d * i - e * g;
  const H = b * g - a * i;
  const I = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det];
}

/**
 * Axis-aligned crop rectangle as a TL,TR,BR,BL quad in pixel space.
 * @param {number} width
 * @param {number} height
 * @param {{ x: number, y: number, w: number, h: number }} crop normalized
 * @returns {Point[]}
 */
export function cropRectToQuad(width, height, crop) {
  const x0 = (crop?.x ?? 0) * width;
  const y0 = (crop?.y ?? 0) * height;
  const x1 = x0 + (crop?.w ?? 1) * width;
  const y1 = y0 + (crop?.h ?? 1) * height;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * Template rectangle corners TL,TR,BR,BL.
 * @param {number} [width]
 * @param {number} [height]
 */
export function templateQuad(width = TEMPLATE_WIDTH, height = TEMPLATE_HEIGHT) {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

/**
 * @param {SlotHours[] | null | undefined} hours
 * @returns {{ index: number, field: 'reg' | 'ot', text: string }[]}
 */
export function stampLabelsFromHours(hours) {
  /** @type {{ index: number, field: 'reg' | 'ot', text: string }[]} */
  const labels = [];
  if (!Array.isArray(hours)) return labels;
  hours.forEach((slot, index) => {
    if (!slot || typeof slot !== 'object') return;
    for (const field of /** @type {const} */ (['reg', 'ot'])) {
      const value = slot[field];
      if (value == null) continue;
      const number = Number(value);
      if (!Number.isFinite(number) || number === 0) continue;
      labels.push({ index, field, text: formatAuditHours(number) });
    }
  });
  return labels;
}

/**
 * Draw Reg/OT labels onto an upright template canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {'front' | 'back'} side
 * @param {SlotHours[] | null | undefined} hours
 * @param {number} [width]
 * @param {number} [height]
 */
export function burnRegOtOnContext(ctx, side, hours, width = TEMPLATE_WIDTH, height = TEMPLATE_HEIGHT) {
  const labels = stampLabelsFromHours(hours);
  if (!labels.length) return { stamped: 0 };
  ctx.save();
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let stamped = 0;
  for (const label of labels) {
    const cell = templateCellPixel(side, label.index, label.field, width, height);
    if (!cell) continue;
    ctx.font = `600 ${Math.round(cell.fontPx)}px "Segoe Print", "Comic Sans MS", "Bradley Hand", cursive`;
    ctx.fillText(label.text, cell.x, cell.y);
    stamped += 1;
  }
  ctx.restore();
  return { stamped };
}

/**
 * Sample bilinear from ImageData.
 * @param {ImageData} image
 * @param {number} x
 * @param {number} y
 * @returns {[number, number, number, number]}
 */
function sampleBilinear(image, x, y) {
  const { width, height, data } = image;
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) {
    return [255, 255, 255, 255];
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;
  const idx = (ix, iy) => (iy * width + ix) * 4;
  const i00 = idx(x0, y0);
  const i10 = idx(x1, y0);
  const i01 = idx(x0, y1);
  const i11 = idx(x1, y1);
  /** @type {[number, number, number, number]} */
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c += 1) {
    const v0 = data[i00 + c] * (1 - fx) + data[i10 + c] * fx;
    const v1 = data[i01 + c] * (1 - fx) + data[i11 + c] * fx;
    out[c] = Math.round(v0 * (1 - fy) + v1 * fy);
  }
  return out;
}

/**
 * Warp source ImageData into a template-sized ImageData using src→template homography.
 * @param {ImageData} source
 * @param {Point[]} srcQuad TL,TR,BR,BL in source pixels
 * @param {number} [outW]
 * @param {number} [outH]
 * @returns {{ image: ImageData, usedFallbackHomography: boolean } | null}
 */
export function warpImageDataToTemplate(source, srcQuad, outW = TEMPLATE_WIDTH, outH = TEMPLATE_HEIGHT) {
  const dst = templateQuad(outW, outH);
  const forward = computeHomography(srcQuad, dst);
  if (!forward) return null;
  const inverse = invertHomography(forward);
  if (!inverse) return null;
  const out = new ImageData(outW, outH);
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const src = applyHomography(inverse, x + 0.5, y + 0.5);
      const pixel = src ? sampleBilinear(source, src.x, src.y) : [255, 255, 255, 255];
      const o = (y * outW + x) * 4;
      out.data[o] = pixel[0];
      out.data[o + 1] = pixel[1];
      out.data[o + 2] = pixel[2];
      out.data[o + 3] = pixel[3];
    }
  }
  return { image: out, usedFallbackHomography: false };
}

/**
 * @param {Blob} blob
 * @returns {Promise<ImageData>}
 */
export async function blobToImageData(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not read that print copy.');
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close?.();
  }
}

/**
 * @param {ImageData} image
 * @param {string} [type]
 * @param {number} [quality]
 * @returns {Promise<Blob>}
 */
export async function imageDataToBlob(image, type = 'image/jpeg', quality = 0.9) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not build the annotated print copy.');
  ctx.putImageData(image, 0, 0);
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error('Could not build the annotated print copy.'))),
      type,
      quality
    );
  });
}

/**
 * Rectify a cropped card photo and burn Reg/OT when present.
 * @param {Blob} croppedJpeg
 * @param {'front' | 'back'} side
 * @param {SlotHours[] | null | undefined} hours
 * @param {{
 *   detectQuad?: (image: ImageData) => { quad: Point[], confidence: 'high' | 'fallback' } | null
 * }} [options]
 */
export async function annotateCardJpeg(croppedJpeg, side, hours, options = {}) {
  const source = await blobToImageData(croppedJpeg);
  const detected =
    typeof options.detectQuad === 'function'
      ? options.detectQuad(source)
      : {
          quad: cropRectToQuad(source.width, source.height, { x: 0, y: 0, w: 1, h: 1 }),
          confidence: /** @type {const} */ ('fallback'),
        };
  const quad =
    detected?.quad ||
    cropRectToQuad(source.width, source.height, { x: 0, y: 0, w: 1, h: 1 });
  const confidence = detected?.confidence === 'high' ? 'high' : 'fallback';
  const warped = warpImageDataToTemplate(source, quad);
  if (!warped) {
    return {
      blob: croppedJpeg,
      stamped: 0,
      confidence: 'fallback',
      warning: 'Could not straighten that card; printed the crop as-is.',
    };
  }
  const canvas = document.createElement('canvas');
  canvas.width = TEMPLATE_WIDTH;
  canvas.height = TEMPLATE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not annotate that print copy.');
  ctx.putImageData(warped.image, 0, 0);
  const { stamped } = burnRegOtOnContext(ctx, side, hours);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error('Could not annotate that print copy.'))),
      'image/jpeg',
      0.9
    );
  });
  return {
    blob,
    stamped,
    confidence,
    warning:
      confidence === 'fallback'
        ? 'Card corners were estimated from the crop box; Reg/OT placement may be slightly off.'
        : null,
  };
}

export { regOtSlotsForSide, templateCellPixel };
