import {
  CONTRACT_PUBLISHED_INDEX_URL,
  contractCitations,
  publishedContractPdfUrl,
} from '../../public/shared/contractCitations.js';

/**
 * @param {string} citationId
 * @param {string} label
 */
export function citeLink(citationId, label) {
  const entry = contractCitations[citationId];
  const href = entry
    ? publishedContractPdfUrl(entry.page)
    : CONTRACT_PUBLISHED_INDEX_URL;
  return `<a class="contract-cite-link" href="${href}" target="_blank" rel="noopener noreferrer" data-citation="${citationId}">${label}</a>`;
}

export function initCitations() {
  const dialog = document.querySelector('#citation');
  const titleEl = document.querySelector('#citation-title');
  const pageEl = document.querySelector('#citation-page');
  const textEl = document.querySelector('#citation-text');
  const pdfLink = document.querySelector('#citation-pdf');
  const indexLink = document.querySelector('#citation-index');
  const closeBtn = document.querySelector('#citation-close');
  if (!dialog || !titleEl || !pageEl || !textEl || !pdfLink || !closeBtn) {
    return { openCitation() {} };
  }

  if (indexLink) {
    indexLink.href = CONTRACT_PUBLISHED_INDEX_URL;
  }

  function closeCitation() {
    if (dialog.open) {
      dialog.close();
    }
  }

  function openCitation(citationId) {
    const entry = contractCitations[citationId];
    if (!entry) return;
    titleEl.textContent = entry.label;
    pageEl.textContent = `Teamsters CBA 2024–2027 · p. ${entry.page}`;
    textEl.textContent = entry.text;
    pdfLink.href = publishedContractPdfUrl(entry.page);
    if (!dialog.open) {
      dialog.showModal();
    }
  }

  closeBtn.addEventListener('click', closeCitation);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      closeCitation();
    }
  });

  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-citation]');
    if (!link) return;
    const id = link.getAttribute('data-citation');
    if (!id || !contractCitations[id]) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    openCitation(id);
  });

  return { openCitation };
}
