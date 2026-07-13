import { GLOSSARY, GLOSSARY_PAGE_ORDER } from '../shared/glossary.js';

const root = document.getElementById('glossary-list');

for (const id of GLOSSARY_PAGE_ORDER) {
  const entry = GLOSSARY[id];
  if (!entry) continue;

  const article = document.createElement('article');
  article.className = 'glossary-entry';
  article.id = id;

  const heading = document.createElement('h2');
  heading.textContent = entry.term;
  article.appendChild(heading);

  const def = document.createElement('p');
  def.textContent = entry.definition;
  article.appendChild(def);

  if (entry.citation) {
    const cite = document.createElement('p');
    cite.className = 'glossary-entry-cite';
    cite.textContent = entry.citation;
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
