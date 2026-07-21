/**
 * Accessible glossary popovers: "?" tips and auto-linked terms in copy.
 */
import { findGlossaryMatches, GLOSSARY } from './glossary.js';
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
  // Dismiss on any press outside the trigger — including presses on the
  // popover itself. Otherwise the panel can cover actions and feel stuck.
  document.addEventListener('pointerdown', (event) => {
    if (!openTip) return;
    const trigger = tipTrigger(openTip);
    if (trigger && trigger.contains(event.target)) return;
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

/**
 * @param {HTMLElement} wrap
 * @returns {HTMLElement | null}
 */
function tipTrigger(wrap) {
  const el = wrap.querySelector('.glossary-tip-btn, .glossary-term-link');
  return el instanceof HTMLElement ? el : null;
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
  const trigger = tipTrigger(openTip);
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  openTip = null;
}

/**
 * Pin the popover with position:fixed and clamp it inside the viewport so it
 * cannot be clipped by overflow ancestors or hang off-screen over actions.
 * @param {HTMLElement} wrap
 */
function positionOpenTip(wrap) {
  const pop = wrap.querySelector('.glossary-popover');
  const trigger = tipTrigger(wrap);
  if (!(pop instanceof HTMLElement) || !(trigger instanceof HTMLElement)) return;

  clearPopoverPosition(pop);

  const btnRect = trigger.getBoundingClientRect();
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
 * @param {HTMLElement} wrap
 * @param {HTMLElement} trigger
 */
function bindTipToggle(wrap, trigger) {
  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const willOpen = !wrap.classList.contains('is-open');
    closeOpenTip();
    if (willOpen) {
      wrap.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      openTip = wrap;
      positionOpenTip(wrap);
    }
  });
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
  bindTipToggle(wrap, btn);

  return wrap;
}

/**
 * Clickable phrase that opens the glossary popover for a term.
 * @param {string} termId
 * @param {string} displayText
 * @param {{ className?: string }} [options]
 * @returns {HTMLElement | null}
 */
export function createGlossaryTermLink(termId, displayText, options = {}) {
  const entry = GLOSSARY[termId];
  if (!entry) return null;

  ensureDocumentListeners();

  const wrap = document.createElement('span');
  wrap.className = 'glossary-tip glossary-term-tip';
  wrap.dataset.glossaryTerm = termId;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = options.className
    ? `glossary-term-link ${options.className}`
    : 'glossary-term-link';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', `Explain: ${entry.term}`);
  btn.textContent = displayText;

  const pop = buildPopover(entry);
  wrap.append(btn, pop);
  bindTipToggle(wrap, btn);

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
 * Status badge + glossary popover (when a glossary entry exists).
 * @param {string | null | undefined} status
 * @returns {DocumentFragment}
 */
export function createStatusBadge(status) {
  const frag = document.createDocumentFragment();
  const termId = STATUS_GLOSSARY_IDS[status];
  if (termId) {
    const link = createGlossaryTermLink(termId, status || '—', {
      className: 'badge',
    });
    if (link) {
      frag.appendChild(link);
      return frag;
    }
  }
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = status || '—';
  frag.appendChild(badge);
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
 * @param {Element | null} el
 * @returns {boolean}
 */
function shouldSkipGlossaryParent(el) {
  let node = el;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    if (!(node instanceof HTMLElement)) return true;
    const tag = node.tagName;
    if (
      tag === 'SCRIPT' ||
      tag === 'STYLE' ||
      tag === 'NOSCRIPT' ||
      tag === 'TEXTAREA' ||
      tag === 'OPTION' ||
      tag === 'CODE' ||
      tag === 'BUTTON' ||
      tag === 'INPUT' ||
      tag === 'SELECT' ||
      tag === 'A'
    ) {
      return true;
    }
    if (
      node.classList.contains('glossary-tip') ||
      node.classList.contains('glossary-popover') ||
      node.classList.contains('glossary-tip-btn-static') ||
      node.dataset.noGlossary != null
    ) {
      return true;
    }
    // Definitions page: term headings are the definition itself.
    if (
      /^H[1-4]$/.test(tag) &&
      node.closest('.glossary-entry')
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Wrap glossary phrases inside a text node with clickable term links.
 * @param {Text} textNode
 */
function linkTextNode(textNode) {
  const value = textNode.nodeValue;
  if (!value || !value.trim()) return;
  const matches = findGlossaryMatches(value);
  if (!matches.length) return;

  const parent = textNode.parentNode;
  if (!parent) return;

  const frag = document.createDocumentFragment();
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      frag.appendChild(
        document.createTextNode(value.slice(cursor, match.start))
      );
    }
    const link = createGlossaryTermLink(match.termId, match.text);
    if (link) frag.appendChild(link);
    else frag.appendChild(document.createTextNode(match.text));
    cursor = match.end;
  }
  if (cursor < value.length) {
    frag.appendChild(document.createTextNode(value.slice(cursor)));
  }
  parent.replaceChild(frag, textNode);
}

/**
 * Auto-link glossary terms (and aliases) in visible copy under root.
 * @param {ParentNode} [root=document]
 */
export function linkGlossaryTermsInTree(root = document) {
  const scope =
    root instanceof Document ? root.body : /** @type {ParentNode} */ (root);
  if (!scope) return;

  /** @type {Text[]} */
  const textNodes = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      if (shouldSkipGlossaryParent(node.parentElement)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) {
    textNodes.push(/** @type {Text} */ (walker.currentNode));
  }
  for (const textNode of textNodes) {
    linkTextNode(textNode);
  }
}

/**
 * Drop a "?" tip when the preceding content already links the same term.
 * @param {ParentNode} root
 */
function removeRedundantQuestionTips(root) {
  for (const tip of root.querySelectorAll('.glossary-tip[data-glossary-term]')) {
    if (!(tip instanceof HTMLElement)) continue;
    if (!tip.querySelector('.glossary-tip-btn')) continue;
    const termId = tip.dataset.glossaryTerm;
    if (!termId) continue;

    let prev = tip.previousSibling;
    while (prev && prev.nodeType === Node.TEXT_NODE && !prev.textContent?.trim()) {
      prev = prev.previousSibling;
    }
    if (
      prev instanceof HTMLElement &&
      prev.classList.contains('glossary-term-tip') &&
      prev.dataset.glossaryTerm === termId
    ) {
      tip.remove();
      continue;
    }
    // Term may be nested in the previous element (e.g. heading text + "?").
    if (prev instanceof HTMLElement) {
      const nested = prev.querySelector(
        `.glossary-term-tip[data-glossary-term="${CSS.escape(termId)}"]`
      );
      if (nested) tip.remove();
    }
  }
}

/**
 * Fill empty `[data-glossary="termId"]` placeholders and auto-link terms in copy.
 * @param {ParentNode} [root=document]
 */
export function enhanceGlossaryTips(root = document) {
  linkGlossaryTermsInTree(root);

  for (const host of root.querySelectorAll('[data-glossary]')) {
    if (!(host instanceof HTMLElement)) continue;
    if (host.querySelector('.glossary-tip-btn, .glossary-term-link')) continue;
    const termId = host.dataset.glossary;
    if (!termId) continue;

    // If nearby copy already links this term, drop the empty placeholder.
    const prev = host.previousSibling;
    const prevEl =
      prev instanceof HTMLElement
        ? prev
        : prev?.previousSibling instanceof HTMLElement
          ? prev.previousSibling
          : null;
    const alreadyLinked =
      (prevEl?.classList.contains('glossary-term-tip') &&
        prevEl.dataset.glossaryTerm === termId) ||
      (prevEl instanceof HTMLElement &&
        Boolean(
          prevEl.querySelector(
            `.glossary-term-tip[data-glossary-term="${CSS.escape(termId)}"]`
          )
        ));
    if (alreadyLinked) {
      host.remove();
      continue;
    }

    const tip = createGlossaryTip(termId);
    if (tip) host.replaceWith(tip);
  }

  removeRedundantQuestionTips(root);
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
