/**
 * Lightweight grayscale card-quad detection for print copies (no OpenCV).
 * Returns TL, TR, BR, BL in source pixel coordinates.
 */

/**
 * @typedef {{ x: number, y: number }} Point
 */

/**
 * @param {ImageData} image
 * @param {number} maxEdge
 * @returns {{ image: ImageData, scale: number }}
 */
function downscaleImageData(image, maxEdge = 800) {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  if (scale >= 0.999) return { image, scale: 1 };
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) {
    // Node / no DOM: nearest-neighbor shrink into a plain buffer.
    const out = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    };
    for (let y = 0; y < height; y += 1) {
      const sy = Math.min(image.height - 1, Math.floor(y / scale));
      for (let x = 0; x < width; x += 1) {
        const sx = Math.min(image.width - 1, Math.floor(x / scale));
        const si = (sy * image.width + sx) * 4;
        const di = (y * width + x) * 4;
        out.data[di] = image.data[si];
        out.data[di + 1] = image.data[si + 1];
        out.data[di + 2] = image.data[si + 2];
        out.data[di + 3] = 255;
      }
    }
    return { image: /** @type {ImageData} */ (out), scale };
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { image, scale: 1 };
  const tmp = document.createElement('canvas');
  tmp.width = image.width;
  tmp.height = image.height;
  tmp.getContext('2d')?.putImageData(image, 0, 0);
  ctx.drawImage(tmp, 0, 0, width, height);
  return { image: ctx.getImageData(0, 0, width, height), scale };
}

/**
 * @param {ImageData} image
 * @returns {Float32Array} luminance
 */
function luminance(image) {
  const { data, width, height } = image;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    out[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return out;
}

/**
 * Box blur (separable-ish 3×3 average).
 * @param {Float32Array} src
 * @param {number} width
 * @param {number} height
 */
function blur3(src, width, height) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dx = -1; dx <= 1; dx += 1) {
        const xx = Math.min(width - 1, Math.max(0, x + dx));
        sum += src[y * width + xx];
        count += 1;
      }
      tmp[y * width + x] = sum / count;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        sum += tmp[yy * width + x];
        count += 1;
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

/**
 * Sobel magnitude.
 * @param {Float32Array} src
 * @param {number} width
 * @param {number} height
 */
function sobelMagnitude(src, width, height) {
  const out = new Float32Array(src.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx =
        -src[i - width - 1] -
        2 * src[i - 1] -
        src[i + width - 1] +
        src[i - width + 1] +
        2 * src[i + 1] +
        src[i + width + 1];
      const gy =
        -src[i - width - 1] -
        2 * src[i - width] -
        src[i - width + 1] +
        src[i + width - 1] +
        2 * src[i + width] +
        src[i + width + 1];
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

/**
 * Score a candidate axis-aligned inset as a "card" by edge strength on its border.
 * @param {Float32Array} edges
 * @param {number} width
 * @param {number} height
 * @param {number} inset
 */
function borderScore(edges, width, height, inset) {
  const x0 = inset;
  const y0 = inset;
  const x1 = width - 1 - inset;
  const y1 = height - 1 - inset;
  if (x1 - x0 < width * 0.35 || y1 - y0 < height * 0.35) return 0;
  let sum = 0;
  let count = 0;
  for (let x = x0; x <= x1; x += 1) {
    sum += edges[y0 * width + x] + edges[y1 * width + x];
    count += 2;
  }
  for (let y = y0; y <= y1; y += 1) {
    sum += edges[y * width + x0] + edges[y * width + x1];
    count += 2;
  }
  return count ? sum / count : 0;
}

/**
 * Order four points as TL, TR, BR, BL.
 * @param {Point[]} points
 * @returns {Point[]}
 */
export function orderQuadPoints(points) {
  const list = points.map((p) => ({ x: p.x, y: p.y }));
  list.sort((a, b) => a.y - b.y || a.x - b.x);
  const top = list.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = list.slice(2).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

/**
 * Detect a card quad in a grayscale (or color) ImageData.
 * @param {ImageData} image
 * @returns {{ quad: Point[], confidence: 'high' | 'fallback' }}
 */
export function detectCardQuad(image) {
  const width = image?.width || 0;
  const height = image?.height || 0;
  if (!width || !height) {
    return {
      quad: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      confidence: 'fallback',
    };
  }

  const { image: small, scale } = downscaleImageData(image, 800);
  const w = small.width;
  const h = small.height;
  const lum = blur3(luminance(small), w, h);
  const edges = sobelMagnitude(lum, w, h);

  let bestInset = Math.round(Math.min(w, h) * 0.02);
  let bestScore = borderScore(edges, w, h, bestInset);
  const maxInset = Math.floor(Math.min(w, h) * 0.22);
  for (let inset = bestInset + 2; inset <= maxInset; inset += 2) {
    const score = borderScore(edges, w, h, inset);
    if (score > bestScore) {
      bestScore = score;
      bestInset = inset;
    }
  }

  // Typical interior card: stronger border than a thin outer frame.
  const fullScore = borderScore(edges, w, h, 1);
  const confidence = bestScore > fullScore * 1.08 && bestInset > 4 ? 'high' : 'fallback';
  const inset = confidence === 'high' ? bestInset : Math.max(1, Math.round(Math.min(w, h) * 0.01));

  const quadSmall = orderQuadPoints([
    { x: inset, y: inset },
    { x: w - 1 - inset, y: inset },
    { x: w - 1 - inset, y: h - 1 - inset },
    { x: inset, y: h - 1 - inset },
  ]);

  const inv = scale > 0 ? 1 / scale : 1;
  return {
    quad: quadSmall.map((p) => ({ x: p.x * inv, y: p.y * inv })),
    confidence,
  };
}
