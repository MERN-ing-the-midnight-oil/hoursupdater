import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildNotificationMailto,
  collectWindowFinalizationNotifications,
  eventTypeForChangeReportOutcome,
  fillTemplate,
  formatNotificationPrompt,
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
  it('maps change-report outcomes to event types', () => {
    assert.equal(eventTypeForChangeReportOutcome('STABLE'), 'WINDOW_LOCKED_IN');
    assert.equal(
      eventTypeForChangeReportOutcome('BID_PENDING'),
      'WINDOW_BID_PENDING'
    );
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
      templates: {
        WINDOW_LOCKED_IN: {
          recipient: 'driver',
          subject: 'Route {{route_id}}',
          body: 'Hi {{driver_name}}',
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
  });

  it('collects only newly finalized reports', () => {
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
            id: 'r-new',
            outcome: 'BID_PENDING',
            window_opened_date: '2026-02-01',
            contributing_changes: [{ id: 'c2' }],
            driver_name: 'A',
            driver_id: null,
          },
        ],
      },
    };
    const specs = collectWindowFinalizationNotifications(prior, next);
    assert.equal(specs.length, 1);
    assert.equal(specs[0].event_type, 'WINDOW_BID_PENDING');
    assert.equal(specs[0].route_id, 'S 20');
  });

  it('formats prompts', () => {
    const prompt = formatNotificationPrompt({
      event_type: 'WINDOW_LOCKED_IN',
      route_id: 'S 20',
      context: { driver_email: 'jane@example.org' },
    });
    assert.match(prompt, /S 20 locked in/);
    assert.match(prompt, /jane@example\.org/);
  });
});
