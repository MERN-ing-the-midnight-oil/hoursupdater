import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildBidAwardPayrollSpec,
  buildNotificationMailto,
  buildPayrollHoursChangedSpec,
  collectBumpDecisionPayrollSpecs,
  collectWindowFinalizationNotifications,
  eventTypeForChangeReportOutcome,
  fillTemplate,
  formatNotificationPrompt,
  roundedContractedHoursChanged,
} from '../src/logic/notifications.js';
import { windowFinalizationOutcome } from '../src/logic/stateMachine.js';

describe('windowFinalizationOutcome (signed threshold)', () => {
  it('locks in under 30 minutes either direction', () => {
    assert.equal(windowFinalizationOutcome(0), 'STABLE');
    assert.equal(windowFinalizationOutcome(29), 'STABLE');
    assert.equal(windowFinalizationOutcome(-29), 'STABLE');
  });

  it('flags BID_PENDING on increase ≥ 30', () => {
    assert.equal(windowFinalizationOutcome(30), 'BID_PENDING');
    assert.equal(windowFinalizationOutcome(45), 'BID_PENDING');
  });

  it('flags BUMP_ELIGIBLE on decrease ≥ 30', () => {
    assert.equal(windowFinalizationOutcome(-30), 'BUMP_ELIGIBLE');
    assert.equal(windowFinalizationOutcome(-45), 'BUMP_ELIGIBLE');
  });
});

describe('notification helpers', () => {
  it('maps change-report outcomes to driver-facing event types (not BID_PENDING)', () => {
    assert.equal(eventTypeForChangeReportOutcome('STABLE'), 'WINDOW_LOCKED_IN');
    assert.equal(eventTypeForChangeReportOutcome('BID_PENDING'), null);
    assert.equal(
      eventTypeForChangeReportOutcome('BUMP_ELIGIBLE'),
      'WINDOW_BUMP_ELIGIBLE'
    );
  });

  it('fills placeholders and leaves unknowns', () => {
    assert.equal(
      fillTemplate('Hi {{driver_name}} on {{route_id}} {{missing}}', {
        driver_name: 'Jane',
        route_id: 'S 20',
      }),
      'Hi Jane on S 20 {{missing}}'
    );
  });

  it('builds mailto drafts and disables when email missing', () => {
    const settings = {
      payroll_email: 'pay@example.org',
      payroll_cc: 'boss@example.org, hr@example.org',
      templates: {
        WINDOW_LOCKED_IN: {
          recipient: 'driver',
          subject: 'Route {{route_id}}',
          body: 'Hi {{driver_name}}',
        },
        PAYROLL_CONTRACTED_HOURS_CHANGED: {
          recipient: 'payroll',
          subject: 'Hours {{route_id}}',
          body: '{{before_payroll_rounded_total_minutes}} → {{after_payroll_rounded_total_minutes}}',
        },
      },
    };
    const pending = {
      id: 'n1',
      event_type: 'WINDOW_LOCKED_IN',
      route_id: 'S 20',
      source_key: 'k',
      created_at: '2026-07-13T00:00:00.000Z',
      status: 'pending',
      actioned_at: null,
      dismissed_at: null,
      context: { driver_name: 'Jane', driver_email: null, route_id: 'S 20' },
    };
    const blocked = buildNotificationMailto(pending, settings);
    assert.equal(blocked.can_send, false);
    assert.match(blocked.disabled_reason, /No email on file/);

    const ok = buildNotificationMailto(
      {
        ...pending,
        context: {
          driver_name: 'Jane',
          driver_email: 'jane@example.org',
          route_id: 'S 20',
        },
      },
      settings
    );
    assert.equal(ok.can_send, true);
    assert.match(ok.mailto_url, /^mailto:jane%40example\.org/);

    const payroll = buildNotificationMailto(
      {
        ...pending,
        event_type: 'PAYROLL_CONTRACTED_HOURS_CHANGED',
        context: {
          route_id: 'S 20',
          before_payroll_rounded_total_minutes: 300,
          after_payroll_rounded_total_minutes: 315,
        },
      },
      settings
    );
    assert.equal(payroll.can_send, true);
    assert.match(payroll.mailto_url, /^mailto:pay%40example\.org/);
    assert.match(
      payroll.mailto_url,
      /cc=boss%40example\.org%2Chr%40example\.org/
    );
    assert.equal(payroll.cc_email, 'boss@example.org,hr@example.org');
  });

  it('does not enqueue BID_PENDING; enqueues payroll only when lock-in hours change', () => {
    const prior = {
      'S 20': {
        change_reports: [
          {
            outcome: 'STABLE',
            window_opened_date: '2026-01-01',
            contributing_changes: [{ id: 'c1' }],
          },
        ],
      },
    };
    const next = {
      'S 20': {
        cumulative_drift_minutes: 35,
        bump_decision_due_date: null,
        change_reports: [
          {
            id: 'r-old',
            outcome: 'STABLE',
            window_opened_date: '2026-01-01',
            contributing_changes: [{ id: 'c1' }],
            driver_name: 'A',
            driver_id: null,
          },
          {
            id: 'r-bid',
            outcome: 'BID_PENDING',
            window_opened_date: '2026-02-01',
            contributing_changes: [{ id: 'c2' }],
            driver_name: 'A',
            driver_id: null,
            contracted_hours_changed: true,
            before: { math: { payroll_rounded_total_minutes: 300 } },
            after: { math: { payroll_rounded_total_minutes: 345 } },
          },
          {
            id: 'r-lock',
            outcome: 'STABLE',
            window_opened_date: '2026-03-01',
            contributing_changes: [{ id: 'c3' }],
            driver_name: 'A',
            driver_id: 'drv-a',
            contracted_hours_changed: true,
            before: { math: { payroll_rounded_total_minutes: 300 } },
            after: { math: { payroll_rounded_total_minutes: 315 } },
          },
        ],
      },
    };
    const specs = collectWindowFinalizationNotifications(prior, next);
    assert.equal(
      specs.some((s) => s.event_type === 'WINDOW_BID_PENDING'),
      false
    );
    assert.equal(
      specs.some((s) => s.event_type === 'PAPER_BID_SIGNUP'),
      false
    );
    assert.equal(
      specs.filter((s) => s.event_type === 'WINDOW_LOCKED_IN').length,
      1
    );
    const payroll = specs.filter(
      (s) => s.event_type === 'PAYROLL_CONTRACTED_HOURS_CHANGED'
    );
    assert.equal(payroll.length, 1);
    assert.equal(payroll[0].context.before_payroll_rounded_total_minutes, 300);
    assert.equal(payroll[0].context.after_payroll_rounded_total_minutes, 315);

    const withPaper = collectWindowFinalizationNotifications(prior, next, {
      paperBidSignupEnabled: true,
    });
    const paper = withPaper.filter((s) => s.event_type === 'PAPER_BID_SIGNUP');
    assert.equal(paper.length, 1);
    assert.equal(paper[0].route_id, 'S 20');
  });

  it('builds a print draft for PAPER_BID_SIGNUP (no mailto)', () => {
    const draft = buildNotificationMailto(
      {
        id: 'n-paper',
        event_type: 'PAPER_BID_SIGNUP',
        route_id: 'P 20',
        source_key: 'k',
        created_at: '2026-07-20T00:00:00.000Z',
        status: 'pending',
        actioned_at: null,
        dismissed_at: null,
        context: { route_id: 'P 20', driver_name: 'Bob' },
      },
      { payroll_email: '', payroll_cc: '', templates: {} }
    );
    assert.equal(draft.can_send, true);
    assert.equal(draft.action, 'print');
    assert.equal(
      draft.print_url,
      '/admin/paper-bid-sheet.html?route_id=P%2020'
    );
    assert.equal(draft.mailto_url, null);
    assert.equal(
      formatNotificationPrompt({
        event_type: 'PAPER_BID_SIGNUP',
        route_id: 'P 20',
        context: {},
      }),
      'Route P 20 is eligible for bid — print a paper sign-up sheet?'
    );
  });

  it('skips payroll when lock-in rounded hours are unchanged', () => {
    const specs = collectWindowFinalizationNotifications(
      {},
      {
        'S 20': {
          change_reports: [
            {
              id: 'r1',
              outcome: 'STABLE',
              window_opened_date: '2026-03-01',
              contributing_changes: [{ id: 'c1' }],
              contracted_hours_changed: false,
              before: { math: { payroll_rounded_total_minutes: 300 } },
              after: { math: { payroll_rounded_total_minutes: 300 } },
            },
          ],
        },
      }
    );
    assert.equal(
      specs.some((s) => s.event_type === 'PAYROLL_CONTRACTED_HOURS_CHANGED'),
      false
    );
    assert.equal(specs[0].event_type, 'WINDOW_LOCKED_IN');
  });

  it('builds bid-award payroll when awardee hours differ from prior assignment', () => {
    const priorState = {
      'P 10': {
        driver_id: 'drv-sam',
        driver_name: 'Sam',
        payroll_rounded_total_minutes: 300,
        segments: { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' },
        baseline_segments: { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' },
      },
      'P 40': {
        driver_id: 'drv-jonah',
        driver_name: 'Jonah',
        payroll_rounded_total_minutes: 360,
        segments: { AM: '5:30-8:00', MIDDAY: null, PM: '14:00-16:30' },
        baseline_segments: { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' },
      },
    };
    const nextState = {
      'P 10': {
        driver_id: null,
        driver_name: null,
        payroll_rounded_total_minutes: 300,
        segments: { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' },
        baseline_segments: { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' },
      },
      'P 40': {
        driver_id: 'drv-sam',
        driver_name: 'Sam',
        payroll_rounded_total_minutes: 360,
        segments: { AM: '5:30-8:00', MIDDAY: null, PM: '14:00-16:30' },
        baseline_segments: { AM: '5:30-8:00', MIDDAY: null, PM: '14:00-16:30' },
      },
    };
    const spec = buildBidAwardPayrollSpec({
      route_id: 'P 40',
      reassignment_id: 'r1',
      priorState,
      nextState,
      new_driver_id: 'drv-sam',
      new_driver_name: 'Sam',
      new_driver_email: 'sam@example.org',
    });
    assert.ok(spec);
    assert.equal(spec.event_type, 'PAYROLL_CONTRACTED_HOURS_CHANGED');
    assert.equal(spec.context.before_payroll_rounded_total_minutes, 300);
    assert.equal(spec.context.after_payroll_rounded_total_minutes, 360);
  });

  it('offers payroll on bump keep when baseline vs locked segments differ', () => {
    const priorState = {
      'P 50': {
        driver_id: 'drv-reese',
        driver_name: 'Reese',
        status: 'BUMP_ELIGIBLE',
        payroll_rounded_total_minutes: 285,
        baseline_segments: { AM: '6:00-8:30', MIDDAY: null, PM: '14:00-16:00' },
        segments: { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' },
      },
    };
    const nextState = {
      'P 50': {
        driver_id: 'drv-reese',
        driver_name: 'Reese',
        status: 'STABLE',
        payroll_rounded_total_minutes: 285,
        baseline_segments: { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' },
        segments: { AM: '6:00-8:00', MIDDAY: null, PM: '14:00-16:00' },
      },
    };
    const specs = collectBumpDecisionPayrollSpecs({
      decision: 'keep_assignment',
      decision_id: 'bd1',
      route_id: 'P 50',
      priorState,
      nextState,
      driversById: new Map([
        ['drv-reese', { name: 'Reese', email: 'reese@example.org' }],
      ]),
    });
    assert.equal(specs.length, 1);
    assert.equal(specs[0].event_type, 'PAYROLL_CONTRACTED_HOURS_CHANGED');
    assert.ok(
      roundedContractedHoursChanged(
        specs[0].context.before_payroll_rounded_total_minutes,
        specs[0].context.after_payroll_rounded_total_minutes
      )
    );
  });

  it('formats payroll prompt', () => {
    const prompt = formatNotificationPrompt({
      event_type: 'PAYROLL_CONTRACTED_HOURS_CHANGED',
      route_id: 'S 20',
      context: {
        before_payroll_rounded_total_minutes: 300,
        after_payroll_rounded_total_minutes: 315,
      },
    });
    assert.match(prompt, /Contracted hours changed on S 20/);
    assert.match(prompt, /300 → 315/);
    assert.match(prompt, /notify payroll/);
  });

  it('buildPayrollHoursChangedSpec returns null when unchanged', () => {
    assert.equal(
      buildPayrollHoursChangedSpec({
        route_id: 'S 20',
        source_key: 'k',
        before_payroll_rounded_total_minutes: 300,
        after_payroll_rounded_total_minutes: 300,
      }),
      null
    );
  });
});
