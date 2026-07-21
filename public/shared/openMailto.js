/**
 * Open a mailto: URL in the OS default email app.
 * Uses a temporary <a> click so the protocol handoff is less likely to be
 * swallowed after async work (fetch) in the same click handler.
 *
 * @param {string | null | undefined} url
 * @returns {boolean} true if a mailto: URL was invoked
 */
export function openMailto(url) {
  const href = String(url || '').trim();
  if (!href.toLowerCase().startsWith('mailto:')) return false;
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}
