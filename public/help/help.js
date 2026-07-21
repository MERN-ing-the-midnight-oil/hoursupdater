import { GLOSSARY, GLOSSARY_PAGE_ORDER } from '../shared/glossary.js';
import { appendCitationLinks } from '../shared/contractCitationUi.js';
import { enhanceGlossaryTips } from '../shared/glossaryTip.js';
import { createIcon, enhanceIcons } from '../shared/icons.js';

enhanceIcons();

/** Icons for known glossary terms on the help page. */
const GLOSSARY_ICONS = {
  scheduled_time: 'clock',
  contracted_hours: 'lock',
  payroll_rounding: 'calculator',
  window: 'calendar-range',
  bid_threshold: 'scale',
  time_difference_to_accumulate: 'layers',
  lock_in: 'lock',
  accumulating: 'hourglass',
  needs_review: 'flag',
  self_resolved: 'rotate-ccw',
  admin_resolved: 'check-circle',
  bid_pending: 'gavel',
  bump_eligible: 'arrow-down-up',
  stable: 'check-circle',
  cumulative_drift: 'layers',
};

const root = document.getElementById('glossary-list');

for (const id of GLOSSARY_PAGE_ORDER) {
  const entry = GLOSSARY[id];
  if (!entry) continue;

  const article = document.createElement('article');
  article.className = 'glossary-entry';
  article.id = id;

  const heading = document.createElement('h2');
  heading.className = 'with-icon';
  const iconName = GLOSSARY_ICONS[id] || 'book-open';
  heading.append(createIcon(iconName), document.createTextNode(entry.term));
  article.appendChild(heading);

  const def = document.createElement('p');
  def.textContent = entry.definition;
  article.appendChild(def);

  if (entry.citation?.length) {
    const cite = document.createElement('p');
    cite.className = 'glossary-entry-cite';
    appendCitationLinks(cite, entry.citation);
    article.appendChild(cite);
  }

  if (entry.practiceNote) {
    const note = document.createElement('p');
    note.className = 'glossary-entry-practice';
    note.textContent = 'Office practice — not literal contract text.';
    article.appendChild(note);
  }

  root.appendChild(article);
}

enhanceGlossaryTips(root);
