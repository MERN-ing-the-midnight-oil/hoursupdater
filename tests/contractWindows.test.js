import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addSchoolDays,
  nextCalendarDate,
  previousCalendarDate,
} from '../src/logic/calendar.js';
import {
  contractWindowPlan,
  firstMonthlyBidPostingOnOrAfter,
  isPreOctober1ReviewPeriod,
  monthlyBidPostingDays,
  october1ForDate,
} from '../src/logic/contractWindows.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const calendar = JSON.parse(
  await fs.readFile(path.join(__dirname, 'fixtures/school-calendar.json'), 'utf8')
);

describe('Art. 3.08 October 1 window timing', () => {
  it('places September in the pre-October 1 review period', () => {
    assert.equal(october1ForDate('2025-09-02'), '2025-10-01');
    assert.equal(isPreOctober1ReviewPeriod('2025-09-30'), true);
    assert.equal(isPreOctober1ReviewPeriod('2025-10-01'), false);
    assert.equal(october1ForDate('2026-01-15'), '2025-10-01');
  });

  it('locks under-30 changes before Oct 1 on October 1', () => {
    const plan = contractWindowPlan(calendar, '2025-09-02', 15);
    assert.equal(plan.rule, 'pre_october_1_lock');
    assert.equal(plan.citation, '3.08(a)(8)(c)');
    assert.equal(plan.becomes_effective_on, '2025-10-01');
    assert.equal(plan.window_expires_date, '2025-09-30');
  });

  it('makes a 30+ decrease before Oct 1 bump-eligible on the determination date', () => {
    const plan = contractWindowPlan(calendar, '2025-09-08', -30);
    assert.equal(plan.rule, 'pre_october_1_bump');
    assert.equal(plan.citation, '3.08(a)(8)(b)');
    assert.equal(plan.becomes_effective_on, '2025-09-08');
    assert.equal(plan.window_expires_date, '2025-09-07');
  });

  it('bids a 30+ increase that completes 15 school days before Oct 1 after those 15 days', () => {
    const plan = contractWindowPlan(calendar, '2025-09-02', 35);
    const fifteenth = addSchoolDays(calendar, '2025-09-02', 15);
    assert.equal(fifteenth, '2025-09-23');
    assert.equal(plan.rule, 'pre_october_1_bid');
    assert.equal(plan.window_expires_date, fifteenth);
    assert.equal(plan.becomes_effective_on, '2025-09-24');
  });

  it('locks a post-Oct 1 15-minute increase on the workday after the 15th school day', () => {
    const plan = contractWindowPlan(calendar, '2025-10-02', 15);
    const fifteenth = addSchoolDays(calendar, '2025-10-02', 15);
    const effective = addSchoolDays(calendar, fifteenth, 1);
    assert.equal(plan.rule, 'post_october_1_increase_lock');
    assert.equal(plan.citation, '3.08(b)(3)');
    assert.equal(plan.becomes_effective_on, effective);
    assert.equal(plan.window_expires_date, previousCalendarDate(effective));
  });

  it('keeps a post-Oct 1 under-30 decrease open for 15 school days', () => {
    const plan = contractWindowPlan(calendar, '2025-10-06', -15);
    const fifteenth = addSchoolDays(calendar, '2025-10-06', 15);
    const effective = addSchoolDays(calendar, fifteenth, 1);
    assert.equal(plan.rule, 'post_october_1_decrease_lock');
    assert.equal(plan.citation, '3.08(b)(4)');
    assert.equal(plan.becomes_effective_on, effective);
    assert.equal(plan.window_expires_date, previousCalendarDate(effective));
    assert.ok(plan.becomes_effective_on > addSchoolDays(calendar, '2025-10-06', 1));
  });

  it('posts a post-Oct 1 30+ increase in the last five school days of the month', () => {
    const plan = contractWindowPlan(calendar, '2025-10-02', 30);
    const fifteenth = addSchoolDays(calendar, '2025-10-02', 15);
    const posting = firstMonthlyBidPostingOnOrAfter(
      calendar,
      nextCalendarDate(fifteenth)
    );
    assert.equal(plan.rule, 'post_october_1_bid');
    assert.equal(plan.citation, '3.08(b)(1)');
    assert.equal(plan.becomes_effective_on, posting);
    assert.ok(monthlyBidPostingDays(calendar).includes(posting));
    assert.equal(posting.slice(0, 7), '2025-10');
  });

  it('waits 15 school days for a post-Oct 1 30+ decrease before bump', () => {
    const plan = contractWindowPlan(calendar, '2025-10-06', -30);
    assert.equal(plan.rule, 'post_october_1_bump');
    assert.equal(plan.citation, '3.08(b)(2)');
    assert.equal(
      plan.window_expires_date,
      addSchoolDays(calendar, '2025-10-06', 15)
    );
  });
});
