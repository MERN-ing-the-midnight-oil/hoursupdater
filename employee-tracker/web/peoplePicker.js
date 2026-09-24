/**
 * @param {{ name?: string }} person
 */
export function personLabel(person) {
  const name = String(person?.name || '').trim();
  return name || 'Unnamed';
}

/**
 * @param {{ id: string, name?: string }[]} people
 * @param {string} query
 * @returns {{ type: 'person' | 'add', id: string | null, label: string }[]}
 */
export function peopleMenuItems(people, query) {
  const q = String(query || '').trim().toLowerCase();
  const labeled = people.map((person) => ({
    type: /** @type {'person'} */ ('person'),
    id: person.id,
    label: personLabel(person),
  }));
  const matches = q
    ? labeled.filter((item) => item.label.toLowerCase().includes(q))
    : labeled;
  const exactCount = q
    ? labeled.filter((item) => item.label.toLowerCase() === q).length
    : 0;
  /** @type {{ type: 'person' | 'add', id: string | null, label: string }[]} */
  const items = matches.map((item) => ({ ...item }));
  if (q && exactCount === 0) {
    items.push({
      type: 'add',
      id: null,
      label: String(query).trim(),
    });
  }
  return items;
}

/**
 * @param {{ type: string, id: string | null, label: string }[]} items
 * @param {string} query
 * @param {string | null | undefined} currentId
 */
export function defaultPeopleHighlight(items, query, currentId) {
  if (!items.length) return 0;
  const q = String(query || '').trim().toLowerCase();
  if (!q && currentId) {
    const currentIndex = items.findIndex((item) => item.id === currentId);
    if (currentIndex >= 0) return currentIndex;
  }
  const firstPerson = items.findIndex((item) => item.type === 'person');
  if (!q || (firstPerson >= 0 && items[firstPerson].label.toLowerCase().startsWith(q))) {
    return Math.max(firstPerson, 0);
  }
  const addIndex = items.findIndex((item) => item.type === 'add');
  return addIndex >= 0 ? addIndex : 0;
}
