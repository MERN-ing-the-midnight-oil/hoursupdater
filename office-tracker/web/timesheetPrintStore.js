import { jsPDF } from 'jspdf';
import { detectCardQuad } from './timecardQuadDetect.js';
import { annotateCardJpeg } from './timecardWarp.js';

const DB_NAME = 'teamster-timesheet-print';
const STORE = 'cards';
const DB_VERSION = 2;
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

/**
 * Compact Reg/OT snapshot for one card side (null when blank).
 * @param {object[] | null | undefined} rows
 * @returns {{ reg: number | null, ot: number | null }[]}
 */
export function hoursFromCardRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const reg = Number(row?.hours_regular ?? row?.written_regular);
    const ot = Number(row?.hours_overtime ?? row?.written_overtime);
    return {
      reg: Number.isFinite(reg) && reg !== 0 ? reg : null,
      ot: Number.isFinite(ot) && ot !== 0 ? ot : null,
    };
  });
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
      frontCrop: existing?.frontCrop ? clampPrintCrop(existing.frontCrop) : { ...FULL_PRINT_CROP },
      backCrop: existing?.backCrop ? clampPrintCrop(existing.backCrop) : { ...FULL_PRINT_CROP },
      frontHours: Array.isArray(existing?.frontHours) ? existing.frontHours : null,
      backHours: Array.isArray(existing?.backHours) ? existing.backHours : null,
    };
    await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record, key));
    return record;
  } finally {
    db.close();
  }
}

/**
 * Attach Genie-calculated Reg/OT (and optional driver label) to an existing print copy.
 * @param {string} id
 * @param {{ front?: object[] | null, back?: object[] | null, front_rows?: object[] | null, back_rows?: object[] | null, header?: { employee_name?: string | null } | null } | null | undefined} extractionOrRows
 */
export async function attachPrintHours(id, extractionOrRows) {
  const key = String(id || '').trim();
  if (!key) return null;
  const frontRows = extractionOrRows?.front_rows ?? extractionOrRows?.front ?? null;
  const backRows = extractionOrRows?.back_rows ?? extractionOrRows?.back ?? null;
  const driverName = String(extractionOrRows?.header?.employee_name || '').trim();
  const db = await openDb();
  try {
    const existing = await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
    if (!existing) return null;
    existing.frontHours = hoursFromCardRows(frontRows);
    existing.backHours = hoursFromCardRows(backRows);
    existing.hoursUpdatedAt = Date.now();
    if (driverName) existing.driverName = driverName;
    await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(existing, key));
    return existing;
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

function sideHasHours(hours) {
  return Array.isArray(hours) && hours.some((slot) => slot && (slot.reg != null || slot.ot != null));
}

/**
 * Crop, straighten, and burn Reg/OT for one side.
 * @param {object} card
 * @param {'front' | 'back'} side
 */
export async function prepareAnnotatedSide(card, side) {
  const blob = side === 'back' ? card.back : card.front;
  const crop = side === 'back' ? card.backCrop : card.frontCrop;
  const hours = side === 'back' ? card.backHours : card.frontHours;
  const cropped = await cropJpegBlob(blob, crop || FULL_PRINT_CROP);
  if (!sideHasHours(hours)) {
    return {
      blob: cropped,
      stamped: 0,
      confidence: 'n/a',
      warning: null,
      missingHours: true,
    };
  }
  return {
    ...(await annotateCardJpeg(cropped, side, hours, { detectQuad: detectCardQuad })),
    missingHours: false,
  };
}

/**
 * Letter pages: each card is front, then back. Reg/OT burned when linked hours exist.
 * @param {object[]} cards
 * @returns {Promise<{ blob: Blob, warnings: string[] }>}
 */
export async function buildPrintPdfBlob(cards) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const pageW = 612;
  const pageH = 792;
  const margin = 36;
  const innerW = pageW - margin * 2;
  const innerH = pageH - margin * 2;
  let started = false;
  /** @type {string[]} */
  const warnings = [];
  let index = 0;
  for (const card of cards) {
    index += 1;
    const label = `Card ${index}`;
    const front = await prepareAnnotatedSide(card, 'front');
    const back = await prepareAnnotatedSide(card, 'back');
    if (front.missingHours && back.missingHours) {
      warnings.push(`${label}: no Genie Reg/OT linked yet — photo only.`);
    } else if (front.missingHours) {
      warnings.push(`${label} front: no Reg/OT linked — photo only.`);
    } else if (back.missingHours) {
      warnings.push(`${label} back: no Reg/OT linked — photo only.`);
    }
    if (front.warning) warnings.push(`${label} front: ${front.warning}`);
    if (back.warning) warnings.push(`${label} back: ${back.warning}`);
    for (const side of [front, back]) {
      if (started) doc.addPage();
      started = true;
      const url = await blobToDataUrl(side.blob);
      const props = doc.getImageProperties(url);
      const scale = Math.min(innerW / props.width, innerH / props.height);
      const width = props.width * scale;
      const height = props.height * scale;
      const x = margin + (innerW - width) / 2;
      const y = margin + (innerH - height) / 2;
      doc.addImage(url, 'JPEG', x, y, width, height);
    }
  }
  return { blob: doc.output('blob'), warnings };
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
