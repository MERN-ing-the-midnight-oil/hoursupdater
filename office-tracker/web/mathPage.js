import { renderMonthlySummaryMathHtml } from '../src/summaryMath.js';

const modelKey = 'teamster-monthly-summary-math-model';
const htmlKey = 'teamster-monthly-summary-math';

function show(html) {
  document.open();
  document.write(html);
  document.close();
}

function savedHtml() {
  return localStorage.getItem(htmlKey) || sessionStorage.getItem(htmlKey);
}

const raw = localStorage.getItem(modelKey);
if (raw) {
  try {
    show(renderMonthlySummaryMathHtml(JSON.parse(raw)));
  } catch {
    const html = savedHtml();
    if (html) show(html);
    else document.body.textContent = 'Open this page from Driver Pay period info on Payroll.';
  }
} else {
  const html = savedHtml();
  if (html) show(html);
  else document.body.textContent = 'Open this page from Driver Pay period info on Payroll.';
}
