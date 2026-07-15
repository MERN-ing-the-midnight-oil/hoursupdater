/**
 * Clickable CBA citations: verbatim text modal + embedded PDF viewer.
 */
import {
  contractCitations,
  contractPdfUrl,
} from './contractCitations.js';

let citeModal = null;
let pdfModal = null;
let previouslyFocused = null;
let listenersBound = false;

function ensureListeners() {
  if (listenersBound) return;
  listenersBound = true;
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (pdfModal?.classList.contains('is-open')) {
      closePdfModal();
      event.preventDefault();
      return;
    }
    if (citeModal?.classList.contains('is-open')) {
      closeCitationModal();
      event.preventDefault();
    }
  });
}

function ensureCiteModal() {
  if (citeModal) return citeModal;
  ensureListeners();

  const backdrop = document.createElement('div');
  backdrop.className = 'contract-modal-backdrop';
  backdrop.dataset.modal = 'citation';
  backdrop.setAttribute('hidden', '');

  backdrop.innerHTML = `
    <div class="contract-modal contract-modal--cite" role="dialog" aria-modal="true" aria-labelledby="contract-cite-title">
      <button type="button" class="contract-modal-close" aria-label="Close">&times;</button>
      <h2 id="contract-cite-title" class="contract-modal-title"></h2>
      <p class="contract-modal-page"></p>
      <blockquote class="contract-modal-text"></blockquote>
      <div class="contract-modal-actions">
        <button type="button" class="contract-pdf-btn">View this page in the full contract</button>
      </div>
    </div>
  `;

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeCitationModal();
  });
  backdrop.querySelector('.contract-modal-close')?.addEventListener('click', () => {
    closeCitationModal();
  });
  backdrop.querySelector('.contract-pdf-btn')?.addEventListener('click', () => {
    const id = citeModal?.dataset.citationId;
    const entry = id ? contractCitations[id] : null;
    if (entry) openContractPdfModal(entry.page, entry.label);
  });

  document.body.appendChild(backdrop);
  citeModal = backdrop;
  return citeModal;
}

function ensurePdfModal() {
  if (pdfModal) return pdfModal;
  ensureListeners();

  const backdrop = document.createElement('div');
  backdrop.className = 'contract-modal-backdrop contract-modal-backdrop--pdf';
  backdrop.dataset.modal = 'pdf';
  backdrop.setAttribute('hidden', '');

  backdrop.innerHTML = `
    <div class="contract-modal contract-modal--pdf" role="dialog" aria-modal="true" aria-labelledby="contract-pdf-title">
      <div class="contract-modal-pdf-header">
        <h2 id="contract-pdf-title" class="contract-modal-title">Teamsters CBA 2024–2027</h2>
        <button type="button" class="contract-modal-close" aria-label="Close">&times;</button>
      </div>
      <iframe class="contract-pdf-frame" title="Collective Bargaining Agreement PDF"></iframe>
    </div>
  `;

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closePdfModal();
  });
  backdrop.querySelector('.contract-modal-close')?.addEventListener('click', () => {
    closePdfModal();
  });

  document.body.appendChild(backdrop);
  pdfModal = backdrop;
  return pdfModal;
}

/**
 * @param {string} citationId
 */
export function openCitationModal(citationId) {
  const entry = contractCitations[citationId];
  if (!entry) return;

  const modal = ensureCiteModal();
  previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  modal.dataset.citationId = citationId;
  const title = modal.querySelector('.contract-modal-title');
  const page = modal.querySelector('.contract-modal-page');
  const text = modal.querySelector('.contract-modal-text');
  if (title) title.textContent = entry.label;
  if (page) page.textContent = `CBA p. ${entry.page}`;
  if (text) text.textContent = entry.text;

  modal.removeAttribute('hidden');
  modal.classList.add('is-open');
  document.body.classList.add('contract-modal-open');
  modal.querySelector('.contract-modal-close')?.focus();
}

export function closeCitationModal() {
  if (!citeModal) return;
  citeModal.classList.remove('is-open');
  citeModal.setAttribute('hidden', '');
  delete citeModal.dataset.citationId;
  if (!pdfModal?.classList.contains('is-open')) {
    document.body.classList.remove('contract-modal-open');
  }
  previouslyFocused?.focus?.();
  previouslyFocused = null;
}

/**
 * @param {number} printedPage
 * @param {string} [label]
 */
export function openContractPdfModal(printedPage, label) {
  const modal = ensurePdfModal();
  const title = modal.querySelector('#contract-pdf-title');
  const frame = modal.querySelector('.contract-pdf-frame');
  if (title) {
    title.textContent = label
      ? `${label} · Teamsters CBA 2024–2027`
      : 'Teamsters CBA 2024–2027';
  }
  if (frame instanceof HTMLIFrameElement) {
    frame.src = contractPdfUrl(printedPage);
  }

  modal.removeAttribute('hidden');
  modal.classList.add('is-open');
  document.body.classList.add('contract-modal-open');
  modal.querySelector('.contract-modal-close')?.focus();
}

export function closePdfModal() {
  if (!pdfModal) return;
  pdfModal.classList.remove('is-open');
  pdfModal.setAttribute('hidden', '');
  const frame = pdfModal.querySelector('.contract-pdf-frame');
  if (frame instanceof HTMLIFrameElement) frame.src = '';
  if (!citeModal?.classList.contains('is-open')) {
    document.body.classList.remove('contract-modal-open');
  } else {
    citeModal.querySelector('.contract-pdf-btn')?.focus();
  }
}

/**
 * Append individually clickable citation links into a host element.
 * Matches prior display: "Art. 3.08(a)(8), 3.08(b)" (Art. only on the first).
 * @param {HTMLElement} host
 * @param {string[]} citationIds
 */
export function appendCitationLinks(host, citationIds) {
  if (!citationIds?.length) return;

  citationIds.forEach((id, index) => {
    if (index > 0) host.appendChild(document.createTextNode(', '));

    const entry = contractCitations[id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'contract-cite-link';
    btn.dataset.citationId = id;

    let label = entry?.label ?? id;
    if (index > 0) label = label.replace(/^Art\.\s*/, '');
    btn.textContent = label;
    btn.setAttribute(
      'aria-label',
      entry ? `View contract text: ${entry.label}` : `View contract citation ${id}`
    );

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openCitationModal(id);
    });

    host.appendChild(btn);
  });
}
