import { jsPDF } from 'jspdf';

/**
 * Download a plain-text notice as a letter-size PDF.
 * @param {string} filename
 * @param {string} text
 */
export function downloadTextPdf(filename, text) {
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const margin = 54;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = 16;
  pdf.setFont('times', 'normal');
  pdf.setFontSize(12);
  const paragraphs = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  let y = margin;
  for (const paragraph of paragraphs) {
    const lines = paragraph ? pdf.splitTextToSize(paragraph, maxWidth) : [''];
    for (const line of lines) {
      if (y > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      if (line) pdf.text(line, margin, y);
      y += lineHeight;
    }
  }
  pdf.save(filename);
}
