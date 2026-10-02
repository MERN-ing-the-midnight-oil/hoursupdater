import { escapeHtml, prettyDate } from './historyMarkup.js';

/**
 * @param {string} segment
 */
function runLabel(segment) {
  if (segment === 'MIDDAY') return 'midday';
  if (segment === 'AM' || segment === 'PM') return segment;
  return 'clock-time';
}

/**
 * @param {object} row
 */
function howPhrase(row) {
  const outcome = row.contracted?.projected_outcome;
  const status = row.contracted?.status;
  if (
    row.force_oct1_contract &&
    (outcome === 'STABLE' || status === 'became_contracted' || status === 'predicted')
  ) {
    return 'contracted on October 1';
  }
  if (outcome === 'BID_PENDING' || status === 'bid_pending') return 'posted for bid';
  if (outcome === 'BUMP_ELIGIBLE' || status === 'bump_eligible') return 'bump eligible';
  if (outcome === 'STABLE' || status === 'became_contracted') return 'automatically contracted';
  return '';
}

/**
 * @param {object} row
 * @param {object | undefined} next
 * @param {string | undefined} asOf
 */
function resolutionSentence(row, next, asOf) {
  const status = row.contracted?.status;
  const when = row.contracted?.becomes_on;
  const how = howPhrase(row);

  if (status === 'superseded') {
    return next?.date
      ? `It resolved on ${prettyDate(next.date)}, replaced by a later change.`
      : 'It resolved, replaced by a later change.';
  }

  if (when && how) {
    const settled =
      status === 'became_contracted' ||
      status === 'bid_pending' ||
      status === 'bump_eligible' ||
      (asOf && when < asOf && status !== 'predicted');
    const verb = settled ? 'resolved' : 'resolves';
    return `It ${verb} on ${prettyDate(when)}, ${how}.`;
  }

  if (how) return `It resolved, ${how}.`;
  return 'It has not resolved.';
}

/**
 * One sentence for the starting times, then one sentence per change:
 * when it was established, when it resolved, and how.
 * @param {{ routeName: string, snapshot: object, calendar?: object, assignment?: object }} input
 */
export function routeNarrativeParagraphs({ routeName, snapshot }) {
  const rows = snapshot?.schedule_history || [];
  const route = String(routeName || 'this route').trim() || 'this route';
  if (!rows.length) {
    return [`Route ${route} has no clock times recorded yet.`];
  }

  const initial = rows.find((row) => row.kind === 'initial') || rows[0];
  const paragraphs = [`Starting times were established on ${prettyDate(initial.date)}.`];
  const asOf = snapshot?.as_of;

  rows.forEach((row, index) => {
    if (row.kind !== 'change') return;
    const next = rows.slice(index + 1).find((item) => item.kind === 'change');
    paragraphs.push(
      `The ${runLabel(row.segment)} change was established on ${prettyDate(row.date)}. ${resolutionSentence(row, next, asOf)}`
    );
  });

  return paragraphs;
}

/**
 * @param {{ routeName: string, snapshot: object, calendar?: object, assignment?: object }} input
 */
export function routeNarrativeHtml(input) {
  const paragraphs = routeNarrativeParagraphs(input)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('');
  return `<h3>What changed</h3><div class="packet-narrative">${paragraphs}</div>`;
}
