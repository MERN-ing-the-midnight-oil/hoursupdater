import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findGlossaryMatches } from '../public/shared/glossary.js';

describe('findGlossaryMatches', () => {
  it('matches canonical terms case-insensitively', () => {
    const matches = findGlossaryMatches('Status is bid pending after close.');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].termId, 'bid_pending');
    assert.equal(matches[0].text, 'bid pending');
  });

  it('matches Pending Bid as Bid Pending', () => {
    const matches = findGlossaryMatches('Moved to Pending Bid yesterday.');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].termId, 'bid_pending');
  });

  it('prefers Bump Eligible over Bump', () => {
    const matches = findGlossaryMatches('Route is Bump Eligible for review.');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].termId, 'bump_eligible');
    assert.equal(matches[0].text, 'Bump Eligible');
  });

  it('matches short Bump alias as Bump Eligible', () => {
    const matches = findGlossaryMatches('Driver may Bump by seniority.');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].termId, 'bump_eligible');
    assert.equal(matches[0].text, 'Bump');
  });

  it('does not match Bump inside longer words', () => {
    const matches = findGlossaryMatches('Bumper sticker inventory.');
    assert.equal(matches.length, 0);
  });

  it('matches machine status tokens', () => {
    const matches = findGlossaryMatches('Was BID_PENDING; now NEEDS_REVIEW.');
    assert.deepEqual(
      matches.map((m) => m.termId),
      ['bid_pending', 'needs_review']
    );
  });

  it('matches self-resolved and admin-resolved review phrases', () => {
    const matches = findGlossaryMatches(
      'Badge says self-resolved recently; later Admin Resolved it.'
    );
    assert.deepEqual(
      matches.map((m) => m.termId),
      ['self_resolved', 'admin_resolved']
    );
  });

  it('matches 15-school-day window phrasing', () => {
    const matches = findGlossaryMatches(
      'Only the 15-school-day window counts school days.'
    );
    assert.ok(matches.some((m) => m.termId === 'window'));
  });
});
