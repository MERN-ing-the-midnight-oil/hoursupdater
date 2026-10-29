function ensureHelpDialog() {
  let dialog = document.getElementById('help-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'help-dialog';
  dialog.className = 'help-dialog';
  dialog.setAttribute('aria-labelledby', 'help-dialog-title');
  dialog.innerHTML = `<form method="dialog">
      <header class="help-dialog-bar">
        <h2 id="help-dialog-title"></h2>
        <button type="submit" class="secondary help-dialog-close">Close</button>
      </header>
      <div id="help-dialog-body" class="help-dialog-body"></div>
    </form>`;
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.appendChild(dialog);
  return dialog;
}

function helpTitle(button) {
  const label = button.getAttribute('aria-label') || 'About';
  return label.replace(/^About\s+/i, '') || 'About';
}

function presentHelpNode(node) {
  const copy = node.cloneNode(true);
  if (copy.nodeType !== Node.ELEMENT_NODE) return copy;
  copy.removeAttribute('id');
  copy.classList.remove('lead', 'field-hint', 'section-lead', 'daily-work-hint');
  copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  return copy;
}

function fillHelpBody(body, source) {
  const nodes = [...source.childNodes].filter(
    (node) => node.nodeType !== Node.TEXT_NODE || node.textContent.trim()
  );
  if (!nodes.length) return false;
  const block = nodes.every(
    (node) => node.nodeType === Node.ELEMENT_NODE && node.matches('p, ul, ol, div')
  );
  if (block) {
    for (const node of nodes) body.appendChild(presentHelpNode(node));
    return true;
  }
  const paragraph = document.createElement('p');
  for (const node of nodes) paragraph.appendChild(presentHelpNode(node));
  body.appendChild(paragraph);
  return true;
}

function openHelp(button) {
  const dialog = ensureHelpDialog();
  const body = dialog.querySelector('#help-dialog-body');
  body.replaceChildren();
  const source = button.dataset.help ? document.getElementById(button.dataset.help) : null;
  let filled = false;
  if (source) filled = fillHelpBody(body, source);
  else if (button.dataset.helpText) {
    const paragraph = document.createElement('p');
    paragraph.textContent = button.dataset.helpText;
    body.appendChild(paragraph);
    filled = true;
  }
  if (!filled) return;
  dialog.querySelector('#help-dialog-title').textContent = helpTitle(button);
  if (!dialog.open) dialog.showModal();
}

function plainText(node) {
  return (node?.textContent || '').replace(/\s+/g, ' ').trim();
}

function controlText(node) {
  if (!node) return '';
  const clone = node.cloneNode(true);
  clone.querySelectorAll('button, svg, .icon, .help-mark').forEach((el) => el.remove());
  return plainText(clone);
}

function shouldFold(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (node.closest('#timeclock-kiosk, .help-dialog, .help-source')) return false;
  if (node.hidden) return false;
  if (node.querySelector('button, input, select, textarea')) return false;
  const text = plainText(node);
  if (text.length < 20 || text.includes('{{')) return false;
  if (node.classList.contains('lead') || node.classList.contains('section-lead')) return true;
  return text.length >= 80;
}

function meaningfulPrev(node) {
  let prev = node.previousElementSibling;
  while (prev) {
    const empty = !plainText(prev) && !prev.querySelector('h1, h2, h3, h4, legend, label');
    const skip = prev.hidden || prev.matches('.status, .help-source, script') || empty;
    if (!skip) return prev;
    prev = prev.previousElementSibling;
  }
  return null;
}

function headingInside(el) {
  if (!el) return null;
  if (el.matches('h1, h2, h3, h4, legend, label')) return el;
  return el.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > legend') || null;
}

function detailsAnchor(node) {
  const details = node.closest('details');
  if (!details) return null;
  const summary = details.querySelector(':scope > summary');
  if (!summary) return null;
  const heading = summary.querySelector('h1, h2, h3, h4') || summary;
  if (!plainText(heading)) return null;
  const body = [...details.children].find((el) => el !== summary && el.contains(node));
  if (!body) return null;
  let cursor = node;
  while (cursor && cursor !== body) {
    if (meaningfulPrev(cursor)) return null;
    cursor = cursor.parentElement;
  }
  return heading;
}

function anchorFor(node) {
  if (node.parentElement?.matches('fieldset')) {
    const legend = node.parentElement.querySelector(':scope > legend');
    if (legend) return legend;
  }

  const prev = meaningfulPrev(node);
  if (prev?.matches('h1, h2, h3, h4, legend, label')) return prev;
  if (prev?.matches('.field')) {
    const label = prev.querySelector(':scope > label');
    if (label) return label;
  }

  const wrapped = headingInside(prev);
  if (wrapped && wrapped !== prev && !controlText(prev).replace(controlText(wrapped), '').trim()) {
    return wrapped;
  }

  const parent = node.parentElement;
  if (parent?.matches('label')) {
    return parent.querySelector(':scope > span') || parent;
  }
  if (parent?.matches('.field')) {
    const label = parent.querySelector(':scope > label');
    if (label) return label;
  }

  return detailsAnchor(node);
}

function ariaLabel(anchor, node) {
  const heading = controlText(anchor);
  if (heading && !anchor.querySelector('.help-mark')) return `About ${heading}`;
  const sentence = plainText(node).split(/(?<=\.)\s/)[0] || 'this';
  const short = sentence.length > 72 ? `${sentence.slice(0, 69)}…` : sentence;
  return heading ? `About ${heading}: ${short}` : `About ${short}`;
}

let helpCopySeq = 0;

function connected(previous, next) {
  if (!previous.anchor || previous.anchor !== next.anchor) return false;
  if (previous.node.parentElement !== next.node.parentElement) return false;
  let cursor = previous.node.nextElementSibling;
  while (cursor && cursor !== next.node) {
    if (!cursor.matches('.status, .help-source, script') && plainText(cursor)) return false;
    cursor = cursor.nextElementSibling;
  }
  return cursor === next.node;
}

function placeGroup(group) {
  const anchor = group[0].anchor;
  const box = document.createElement('div');
  box.className = 'help-source';
  box.hidden = true;
  box.id = `help-copy-${++helpCopySeq}`;
  const first = group[0].node;
  first.before(box);
  for (const item of group) box.appendChild(item.node);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = anchor ? 'help-mark' : 'help-mark is-standalone';
  button.dataset.help = box.id;
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-label', ariaLabel(anchor, first));
  button.textContent = '?';
  if (anchor) anchor.append(button);
  else box.before(button);
}

function foldExplanations(root = document) {
  const items = [...root.querySelectorAll('p.lead, p.section-lead, p.field-hint, p.daily-work-hint')]
    .filter(shouldFold)
    .map((node) => ({ node, anchor: anchorFor(node) }));

  let index = 0;
  while (index < items.length) {
    const group = [items[index]];
    let next = index + 1;
    while (next < items.length && connected(group[group.length - 1], items[next])) {
      group.push(items[next]);
      next += 1;
    }
    placeGroup(group);
    index = next;
  }
}

document.addEventListener(
  'click',
  (event) => {
    const button = event.target.closest?.('.help-mark');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    openHelp(button);
  },
  true
);

foldExplanations();
