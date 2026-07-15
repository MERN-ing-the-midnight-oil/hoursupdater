/**
 * Accessible "?" glossary popovers for UI terms.
 */
import { GLOSSARY } from './glossary.js';
import { appendCitationLinks } from './contractCitationUi.js';

/** Route status → glossary term id for clickable status badges. */
export const STATUS_GLOSSARY_IDS = {
  STABLE: 'stable',
  ACCUMULATING: 'accumulating',
  BID_PENDING: 'bid_pending',
  BUMP_ELIGIBLE: 'bump_eligible',
  NEEDS_REVIEW: 'needs_review',
};

let openTip = null;
let documentListenersBound = false;

function ensureDocumentListeners() {
  if (documentListenersBound) return;
  documentListenersBound = true;
  // Dismiss on any press outside the "?" button — including presses on the
  // popover itself. Otherwise the panel can cover actions and feel stuck.
  document.addEventListener('pointerdown', (event) => {
    if (!openTip) return;
    const btn = openTip.querySelector('.glossary-tip-btn');
    if (btn && btn.contains(event.target)) return;
    closeOpenTip();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeOpenTip();
  });
  window.addEventListener('resize', () => {
    if (openTip) positionOpenTip(openTip);
  });
  // Capture phase so nested overflow scrollers (calendar list, etc.) update too.
  document.addEventListener(
    'scroll',
    () => {
      if (openTip) positionOpenTip(openTip);
    },
    true
  );
}

function clearPopoverPosition(pop) {
  pop.style.top = '';
  pop.style.left = '';
  pop.style.right = '';
  pop.style.bottom = '';
  pop.style.width = '';
}

function closeOpenTip() {
  if (!openTip) return;
  const pop = openTip.querySelector('.glossary-popover');
  if (pop instanceof HTMLElement) clearPopoverPosition(pop);
  openTip.classList.remove('is-open');
  const btn = openTip.querySelector('.glossary-tip-btn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  openTip = null;
}

/**
 * Pin the popover with position:fixed and clamp it inside the viewport so it
 * cannot be clipped by overflow ancestors or hang off-screen over actions.
 * @param {HTMLElement} wrap
 */
function positionOpenTip(wrap) {
  const pop = wrap.querySelector('.glossary-popover');
  const btn = wrap.querySelector('.glossary-tip-btn');
  if (!(pop instanceof HTMLElement) || !(btn instanceof HTMLElement)) return;

  clearPopoverPosition(pop);

  const btnRect = btn.getBoundingClientRect();
  const margin = 12;
  const gap = 8;
  const maxWidth = Math.min(22 * 16, window.innerWidth - margin * 2);
  pop.style.width = `${maxWidth}px`;

  const popRect = pop.getBoundingClientRect();
  const width = popRect.width || maxWidth;
  const height = popRect.height;

  let top = btnRect.bottom + gap;
  if (top + height > window.innerHeight - margin) {
    top = btnRect.top - gap - height;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - margin - height));

  let left = btnRect.left;
  if (left + width > window.innerWidth - margin) {
    left = btnRect.right - width;
  }
  left = Math.max(margin, Math.min(left, window.innerWidth - margin - width));

  pop.style.top = `${Math.round(top)}px`;
  pop.style.left = `${Math.round(left)}px`;
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

  if (entry.citation?.length) {
    const cite = document.createElement('p');
    cite.className = 'glossary-popover-cite';
    appendCitationLinks(cite, entry.citation);
    pop.appendChild(cite);
  }

  if (entry.practiceNote) {
    const note = document.createElement('p');
    note.className = 'glossary-popover-practice';
    note.textContent = 'Office practice — not literal contract text.';
    pop.appendChild(note);
  }

  // If a tip is nested inside a <label>, clicks on the popover would otherwise
  // activate the labeled control. Close still happens via the document listener.
  pop.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

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
      positionOpenTip(wrap);
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
 * Status badge + "?" glossary tip (when a glossary entry exists).
 * @param {string | null | undefined} status
 * @returns {DocumentFragment}
 */
export function createStatusBadge(status) {
  const frag = document.createDocumentFragment();
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = status || '—';
  frag.appendChild(badge);
  const termId = STATUS_GLOSSARY_IDS[status];
  if (termId) {
    const tip = createGlossaryTip(termId);
    if (tip) frag.appendChild(tip);
  }
  return frag;
}

/**
 * Append a status badge (+ tip) into a host element.
 * @param {HTMLElement} host
 * @param {string | null | undefined} status
 */
export function appendStatusBadge(host, status) {
  host.appendChild(createStatusBadge(status));
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
