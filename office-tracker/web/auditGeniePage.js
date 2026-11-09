import { mountAuditGenie } from './auditGenie.js';
import { loadState } from './store.js';

const deviceOnly = new URLSearchParams(location.search).get('embed') === 'driver';
if (deviceOnly) document.body.classList.add('is-driver-embed');

const lead = document.querySelector('#audit-page-lead');
if (deviceOnly && lead) {
  lead.textContent =
    'Photograph the front and back of a blue time card. Use good lighting and hold the card still. The secretary\'s Reg, OT, and Tot. Hrs. math all gets automatically calculated and checked based on the Clock Record times and your route info on the sticker at the top of the front side.';
}

mountAuditGenie({
  readState: loadState,
  deviceOnly,
});
