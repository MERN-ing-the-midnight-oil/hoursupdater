/**
 * Place the driver timeclock on a monitor other than the one the office is using.
 * The Window Management API can see those screens after the browser asks permission.
 * Without it, the timeclock still opens in its own window so it can be moved across.
 */

/**
 * @param {string} search
 */
export function isExternalTimeclockSearch(search) {
  return new URLSearchParams(String(search || '')).get('section') === 'timeclock';
}

/**
 * @param {string} search
 */
export function timeclockWantsFill(search) {
  const params = new URLSearchParams(String(search || ''));
  return params.get('section') === 'timeclock' && params.get('fill') === '1';
}

/**
 * @param {string} baseHref
 * @param {{ fill?: boolean }} [options]
 */
export function timeclockWindowUrl(baseHref, { fill = false } = {}) {
  const url = new URL('./', baseHref);
  url.searchParams.set('section', 'timeclock');
  if (fill) url.searchParams.set('fill', '1');
  url.hash = '';
  return url.href;
}

/**
 * @param {object | null | undefined} screen
 * @returns {{ left: number, top: number, width: number, height: number } | null}
 */
export function timeclockWindowBounds(screen) {
  if (!screen) return null;
  return {
    left: Math.round(finite(screen.availLeft, screen.left, 0)),
    top: Math.round(finite(screen.availTop, screen.top, 0)),
    width: Math.max(640, Math.round(finite(screen.availWidth, screen.width, 1280))),
    height: Math.max(480, Math.round(finite(screen.availHeight, screen.height, 800))),
  };
}

/**
 * @param {object | null | undefined} screen
 */
export function timeclockWindowFeatures(screen) {
  const bounds = timeclockWindowBounds(screen);
  if (!bounds) return 'popup,width=1280,height=800';
  return `popup,left=${bounds.left},top=${bounds.top},width=${bounds.width},height=${bounds.height}`;
}

/**
 * A name a person can match to a monitor.
 * @param {object | null | undefined} screen
 */
export function timeclockScreenLabel(screen) {
  const width = Number(screen?.width) || 0;
  const height = Number(screen?.height) || 0;
  const size = width && height ? `${width}×${height}` : '';
  const given = String(screen?.label || '').trim();
  if (given) return size ? `${given} · ${size}` : given;
  const left = Number(screen?.left) || 0;
  const top = Number(screen?.top) || 0;
  const place = left < 0 ? 'on the left' : left > 0 ? 'on the right' : top < 0 ? 'above' : top > 0 ? 'below' : '';
  const kind = screen?.isInternal === false ? 'External screen' : 'Other screen';
  return [kind, place, size].filter(Boolean).join(' · ');
}

/**
 * Screens other than the one this window is on.
 * An external monitor comes before another built-in display, then left to right.
 * @param {{ screens?: object[], currentScreen?: object } | null | undefined} details
 */
export function otherTimeclockScreens(details) {
  const screens = Array.isArray(details?.screens) ? details.screens.filter(Boolean) : [];
  const current = details?.currentScreen || null;
  const others = screens.filter((screen) => {
    if (!current) return screen.isInternal === false;
    return screen !== current && !sameBounds(screen, current);
  });
  return others.sort((a, b) => {
    const aExternal = a.isInternal === false ? 0 : 1;
    const bExternal = b.isInternal === false ? 0 : 1;
    if (aExternal !== bExternal) return aExternal - bExternal;
    const aLeft = Number(a.left) || 0;
    const bLeft = Number(b.left) || 0;
    if (aLeft !== bLeft) return aLeft - bLeft;
    return (Number(a.top) || 0) - (Number(b.top) || 0);
  });
}

/**
 * @param {object} a
 * @param {object} b
 */
function sameBounds(a, b) {
  return (
    Number(a?.left) === Number(b?.left) &&
    Number(a?.top) === Number(b?.top) &&
    Number(a?.width) === Number(b?.width) &&
    Number(a?.height) === Number(b?.height)
  );
}

/**
 * @param {unknown} primary
 * @param {unknown} fallback
 * @param {number} empty
 */
function finite(primary, fallback, empty) {
  const first = Number(primary);
  if (Number.isFinite(first)) return first;
  const second = Number(fallback);
  if (Number.isFinite(second)) return second;
  return empty;
}
