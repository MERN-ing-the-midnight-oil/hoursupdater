import { jsPDF } from 'jspdf';

const DB_NAME = 'teamster-timesheet-print';
const STORE = 'cards';
const DB_VERSION = 1;
const MAX_EDGE = 2600;

export const FULL_PRINT_CROP = { x: 0, y: 0, w: 1, h: 1 };

/**
 * @param {{ x: number, y: number, w: number, h: number }} rect
 */
export function clampPrintCrop(rect) {
  let x = Number(rect?.x);
  let y = Number(rect?.y);
  let w = Number(rect?.w);
  let h = Number(rect?.h);
  if (![x, y, w, h].every((value) => Number.isFinite(value))) return { ...FULL_PRINT_CROP };
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));
  w = Math.max(0.02, Math.min(1, w));
  h = Math.max(0.02, Math.min(1, h));
  if (x + w > 1) x = 1 - w;
  if (y + h > 1) y = 1 - h;
  return { x, y, w, h };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('Could not open print copies.'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Print copy storage failed.'));
  });
}

/**
 * Grayscale JPEG, longest side at most 2600px. Stays in the browser for printing.
 * @param {Blob} file
 */
export async function imageFileToPrintJpeg(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not prepare that print copy.');
    context.drawImage(bitmap, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    const data = image.data;
    for (let index = 0; index < data.length; index += 4) {
      const lum = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      data[index] = lum;
      data[index + 1] = lum;
      data[index + 2] = lum;
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (out) => (out ? resolve(out) : reject(new Error('Could not prepare that print copy.'))),
        'image/jpeg',
        0.82
      );
    });
    return blob;
  } finally {
    bitmap.close?.();
  }
}

/**
 * @param {Blob} blob
 * @param {{ x: number, y: number, w: number, h: number }} crop
 */
export async function cropJpegBlob(blob, crop) {
  const frame = clampPrintCrop(crop);
  const bitmap = await createImageBitmap(blob);
  try {
    const sx = Math.round(frame.x * bitmap.width);
    const sy = Math.round(frame.y * bitmap.height);
    const sw = Math.max(1, Math.round(frame.w * bitmap.width));
    const sh = Math.max(1, Math.round(frame.h * bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not crop that print copy.');
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (out) => (out ? resolve(out) : reject(new Error('Could not crop that print copy.'))),
        'image/jpeg',
        0.88
      );
    });
  } finally {
    bitmap.close?.();
  }
}

/**
 * @param {string} id
 * @param {Blob} front
 * @param {Blob} back
 */
export async function upsertPrintCard(id, front, back) {
  const key = String(id || '').trim();
  if (!key) throw new Error('That print copy has no id.');
  const db = await openDb();
  try {
    const existing = await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
    const record = {
      id: key,
      createdAt: existing?.createdAt || Date.now(),
      front,
      back,
      frontCrop: { ...FULL_PRINT_CROP },
      backCrop: { ...FULL_PRINT_CROP },
    };
    await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record, key));
    return record;
  } finally {
    db.close();
  }
}

export async function listPrintCards() {
  const db = await openDb();
  try {
    const all = await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    return (Array.isArray(all) ? all : [])
      .filter((item) => item?.front && item?.back)
      .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  } finally {
    db.close();
  }
}

/**
 * @param {string} id
 * @param {{ x: number, y: number, w: number, h: number }} frontCrop
 * @param {{ x: number, y: number, w: number, h: number }} backCrop
 */
export async function savePrintCrops(id, frontCrop, backCrop) {
  const db = await openDb();
  try {
    const existing = await requestToPromise(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
    );
    if (!existing) return null;
    existing.frontCrop = clampPrintCrop(frontCrop);
    existing.backCrop = clampPrintCrop(backCrop);
    await requestToPromise(
      db.transaction(STORE, 'readwrite').objectStore(STORE).put(existing, id)
    );
    return existing;
  } finally {
    db.close();
  }
}

export async function deletePrintCard(id) {
  const db = await openDb();
  try {
    await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
  } finally {
    db.close();
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read that print copy.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Letter pages: each card is front, then back.
 * @param {object[]} cards
 */
export async function buildPrintPdfBlob(cards) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const pageW = 612;
  const pageH = 792;
  const margin = 36;
  const innerW = pageW - margin * 2;
  const innerH = pageH - margin * 2;
  let started = false;
  for (const card of cards) {
    const front = await cropJpegBlob(card.front, card.frontCrop || FULL_PRINT_CROP);
    const back = await cropJpegBlob(card.back, card.backCrop || FULL_PRINT_CROP);
    for (const blob of [front, back]) {
      if (started) doc.addPage();
      started = true;
      const url = await blobToDataUrl(blob);
      const props = doc.getImageProperties(url);
      const scale = Math.min(innerW / props.width, innerH / props.height);
      const width = props.width * scale;
      const height = props.height * scale;
      const x = margin + (innerW - width) / 2;
      const y = margin + (innerH - height) / 2;
      doc.addImage(url, 'JPEG', x, y, width, height);
    }
  }
  return doc.output('blob');
}

export function printPdfBlob(blob) {
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.title = 'Timecard print copies';
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;';
  iframe.src = url;
  let printed = false;
  const cleanup = () => {
    URL.revokeObjectURL(url);
    iframe.remove();
  };
  const tryPrint = () => {
    if (printed || !iframe.contentWindow) return;
    printed = true;
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    window.setTimeout(cleanup, 90_000);
  };
  iframe.onload = () => tryPrint();
  document.body.append(iframe);
  window.setTimeout(() => {
    if (!printed) tryPrint();
  }, 1200);
}
