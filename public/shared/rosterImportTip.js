/**
 * First-visit explainer for importing drivers/routes (localStorage).
 */
import { enhanceIcons } from './icons.js';

export const ROSTER_IMPORT_TIP_KEY = 'rct_roster_import_tip_seen';

/**
 * @returns {boolean}
 */
export function hasSeenRosterImportTip() {
  try {
    return localStorage.getItem(ROSTER_IMPORT_TIP_KEY) === '1';
  } catch {
    return false;
  }
}

export function markRosterImportTipSeen() {
  try {
    localStorage.setItem(ROSTER_IMPORT_TIP_KEY, '1');
  } catch {
    /* private mode / quota */
  }
}

/**
 * Build and show the tip dialog once per browser.
 * @param {{ onShowWhere?: () => void }} [options]
 */
export function initRosterImportTip(options = {}) {
  if (hasSeenRosterImportTip()) return;
  if (document.getElementById('roster-import-tip-backdrop')) return;

  const backdrop = document.createElement('div');
  backdrop.id = 'roster-import-tip-backdrop';
  backdrop.className = 'contract-modal-backdrop';
  backdrop.setAttribute('role', 'presentation');
  backdrop.innerHTML = `
    <div
      class="contract-modal roster-import-tip-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="roster-import-tip-title"
    >
      <button
        type="button"
        class="contract-modal-close"
        id="roster-import-tip-close"
        aria-label="Close"
      >
        &times;
      </button>
      <h2 id="roster-import-tip-title" class="contract-modal-title">
        Loading drivers and routes
      </h2>
      <div class="roster-import-tip-body">
        <p>
          When this app needs a <strong>new list of drivers and routes</strong>
          — for example while testing, or at the start of a new school year —
          you import them from outside the app.
        </p>
        <p>You can either:</p>
        <ul>
          <li>
            <strong>Download the example CSV</strong> under
            Admin Settings → Archive Year &amp; Import New Roster, fill it in
            (or replace the rows with your real roster), then upload it, or
          </li>
          <li>
            <strong>Paste rows directly</strong> into the import table on that
            same screen.
          </li>
        </ul>
        <p class="field-hint">
          Columns needed: driver name, hire date (YYYY-MM-DD for new drivers),
          route, and at least one of AM / Midday / PM time (H:MM-H:MM).
        </p>
      </div>
      <div class="contract-modal-actions roster-import-tip-actions">
        <button type="button" id="roster-import-tip-show" data-icon="table">
          Show me where
        </button>
        <button
          type="button"
          class="secondary"
          id="roster-import-tip-dismiss"
          data-icon="check"
        >
          Got it
        </button>
      </div>
    </div>
  `;

  const dismiss = () => {
    markRosterImportTipSeen();
    backdrop.remove();
    document.body.classList.remove('contract-modal-open');
  };

  document.body.appendChild(backdrop);
  document.body.classList.add('contract-modal-open');
  enhanceIcons(backdrop);
  backdrop.querySelector('#roster-import-tip-dismiss')?.focus();

  backdrop
    .querySelector('#roster-import-tip-dismiss')
    ?.addEventListener('click', dismiss);
  backdrop
    .querySelector('#roster-import-tip-close')
    ?.addEventListener('click', dismiss);
  backdrop
    .querySelector('#roster-import-tip-show')
    ?.addEventListener('click', () => {
      dismiss();
      if (typeof options.onShowWhere === 'function') {
        options.onShowWhere();
      } else {
        window.location.href = '/admin#settings-bulk-import';
      }
    });
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) dismiss();
  });
  document.addEventListener('keydown', function onKey(event) {
    if (event.key !== 'Escape') return;
    if (!document.body.contains(backdrop)) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    dismiss();
    document.removeEventListener('keydown', onKey);
  });
}
