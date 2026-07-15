/**
 * Persistent banner when the server is running under .env.practice.
 * Safe no-op when practice_mode is false or the request fails.
 */
import { createIcon } from './icons.js';

const BANNER_TEXT =
  'PRACTICE MODE — test data only, not connected to real records.';

export async function showPracticeBannerIfNeeded() {
  try {
    const res = await fetch('/api/meta');
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.practice_mode) return;
  } catch {
    return;
  }

  if (document.getElementById('practice-mode-banner')) return;

  document.documentElement.classList.add('practice-mode');
  document.body.classList.add('practice-mode');

  const banner = document.createElement('div');
  banner.id = 'practice-mode-banner';
  banner.className = 'practice-mode-banner with-icon';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.append(createIcon('flask-conical'), document.createTextNode(BANNER_TEXT));
  document.body.prepend(banner);

  if (!document.title.startsWith('PRACTICE ·')) {
    document.title = `PRACTICE · ${document.title}`;
  }
}

// Run immediately on import so every screen that loads this module shows the banner.
showPracticeBannerIfNeeded();
