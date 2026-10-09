import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatDuration,
  formatPreference,
  parsePreference,
  PREFERENCE_LIMIT,
  totalDayMinutes,
} from '../public/board/preference.js';

describe('extra-work preference lists', () => {
  it('writes one ranked assignment as a comma list', () => {
    assert.equal(formatPreference('one', ['9201', '9202'], []), '9201, 9202');
  });

  it('writes as many as fit as parenthetical sets', () => {
    assert.equal(
      formatPreference('many', ['9201', '9202'], ['9203']),
      '(9201, 9202), (9203)'
    );
  });

  it('puts the second list after the first when the driver wants only one', () => {
    assert.equal(formatPreference('one', ['9201'], ['9203']), '9201, 9203');
  });

  it('reads the sheet notation back into lists', () => {
    assert.deepEqual(parsePreference('9201, 9202'), {
      mode: 'one',
      groups: [['9201', '9202']],
    });
    assert.deepEqual(parsePreference('(9201, 9202), (9203)'), {
      mode: 'many',
      groups: [
        ['9201', '9202'],
        ['9203'],
      ],
    });
    assert.deepEqual(parsePreference('(1-3), (6-7)'), {
      mode: 'many',
      groups: [
        ['1', '2', '3'],
        ['6', '7'],
      ],
    });
  });

  it('round-trips a two-set bid', () => {
    const written = formatPreference('many', ['19826', '19821'], ['19823']);
    assert.equal(written.length < PREFERENCE_LIMIT, true);
    const parsed = parsePreference(written);
    assert.equal(parsed.mode, 'many');
    assert.deepEqual(parsed.groups[0], ['19826', '19821']);
    assert.deepEqual(parsed.groups[1], ['19823']);
  });

  it('adds regular runs and selected trips into one daily total', () => {
    assert.equal(totalDayMinutes(4 * 60 + 50, 3 * 60), 7 * 60 + 50);
    assert.equal(formatDuration(7 * 60 + 50), '7 h 50 min');
    assert.equal(formatDuration(120), '2 h');
  });
});
