import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * Download the route calendar that is on screen.
 * @param {string} filename
 */
export async function downloadCalendarPdf(filename) {
  const source = document.querySelector('#calendar-months')?.closest('section');
  const months = document.querySelector('#calendar-months');
  if (!source || !months?.childElementCount) {
    throw new Error('The calendar for this route is not on screen.');
  }
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'width:960px',
    'padding:24px',
    'background:#ffffff',
    'color:#1a1a1a',
    'z-index:100000',
  ].join(';');
  host.appendChild(source.cloneNode(true));
  host.querySelectorAll('.cal-hover').forEach((node) => node.remove());
  document.body.appendChild(host);
  try {
    const canvas = await html2canvas(host, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
    });
    if (!canvasHasInk(canvas)) {
      throw new Error('Could not draw the calendar.');
    }
    saveCanvasPdf(canvas, filename);
  } finally {
    host.remove();
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 */
function canvasHasInk(canvas) {
  const context = canvas.getContext('2d');
  if (!context) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let ink = 0;
  for (let index = 0; index < data.length; index += 64) {
    if (data[index] < 250 || data[index + 1] < 250 || data[index + 2] < 250) ink += 1;
  }
  return ink > 40;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} filename
 */
function saveCanvasPdf(canvas, filename) {
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 28;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const scale = contentWidth / canvas.width;
  const sliceHeightPx = Math.max(1, Math.floor(contentHeight / scale));
  let offset = 0;
  let page = 0;
  while (offset < canvas.height) {
    const slicePx = Math.min(sliceHeightPx, canvas.height - offset);
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = slicePx;
    const context = slice.getContext('2d');
    if (!context) throw new Error('Could not draw the calendar.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, slice.width, slice.height);
    context.drawImage(
      canvas,
      0,
      offset,
      canvas.width,
      slicePx,
      0,
      0,
      canvas.width,
      slicePx
    );
    if (page > 0) pdf.addPage();
    pdf.addImage(
      slice.toDataURL('image/jpeg', 0.92),
      'JPEG',
      margin,
      margin,
      contentWidth,
      slicePx * scale
    );
    offset += slicePx;
    page += 1;
  }
  pdf.save(filename);
}
