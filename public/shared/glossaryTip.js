/**
 * Accessible "?" glossary popovers for UI terms.
 */
import { GLOSSARY } from './glossary.js';

let openTip = null;
let documentListenersBound = false;

function ensureDocumentListeners() {
  if (documentListenersBound) return;
  documentListenersBound = true;
  document.addEventListener('pointerdown', (event) => {
    if (!openTip) return;
    if (openTip.contains(event.target)) return;
    closeOpenTip();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeOpenTip();
  });
}

function closeOpenTip() {
  if (!openTip) return;
  openTip.classList.remove('is-open');
  const btn = openTip.querySelector('.glossary-tip-btn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  openTip = null;
}

/**
 * @param {import('./glossary.js').GlossaryEntry} entry
 * @returns {HTMLElement}
 */
function buildPopover(entry) {
  const pop = document.createElement('div');
  pop.className = 'glossary-popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', entry.term);

  const title = document.createElement('strong');
  title.className = 'glossary-popover-term';
  title.textContent = entry.term;

  const def = document.createElement('p');
  def.className = 'glossary-popover-def';
  def.textContent = entry.definition;

  pop.append(title, def);

  if (entry.citation) {
    const cite = document.createElement('p');
    cite.className = 'glossary-popover-cite';
    cite.textContent = entry.citation;
    pop.appendChild(cite);
  }

  if (entry.practiceNote) {
    const note = document.createElement('p');
    note.className = 'glossary-popover-practice';
    note.textContent = 'Office practice — not literal contract text.';
    pop.appendChild(note);
  }

  return pop;
}

/**
 * Create a "?" control for a glossary term.
 * @param {string} termId
 * @returns {HTMLElement | null}
 */
export function createGlossaryTip(termId) {
  const entry = GLOSSARY[termId];
  if (!entry) return null;

  ensureDocumentListeners();

  const wrap = document.createElement('span');
  wrap.className = 'glossary-tip';
  wrap.dataset.glossaryTerm = termId;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'glossary-tip-btn';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', `Explain: ${entry.term}`);
  btn.textContent = '?';

  const pop = buildPopover(entry);
  wrap.append(btn, pop);

  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const willOpen = !wrap.classList.contains('is-open');
    closeOpenTip();
    if (willOpen) {
      wrap.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      openTip = wrap;
    }
  });

  return wrap;
}

/**
 * Append a glossary tip after a label node (or into a host element).
 * @param {HTMLElement} host
 * @param {string} termId
 */
export function appendGlossaryTip(host, termId) {
  const tip = createGlossaryTip(termId);
  if (tip) host.appendChild(tip);
}

/**
 * Fill empty `[data-glossary="termId"]` placeholders with tip controls.
 * @param {ParentNode} [root=document]
 */
export function enhanceGlossaryTips(root = document) {
  for (const host of root.querySelectorAll('[data-glossary]')) {
    if (!(host instanceof HTMLElement)) continue;
    if (host.querySelector('.glossary-tip-btn')) continue;
    const termId = host.dataset.glossary;
    if (!termId) continue;
    const tip = createGlossaryTip(termId);
    if (tip) host.replaceWith(tip);
  }
}

/**
 * Build a `<dt>` that includes a glossary tip.
 * @param {string} label
 * @param {string | null} [termId]
 * @returns {HTMLElement}
 */
export function dtWithGlossary(label, termId = null) {
  const dt = document.createElement('dt');
  dt.append(document.createTextNode(label));
  if (termId) appendGlossaryTip(dt, termId);
  return dt;
}
