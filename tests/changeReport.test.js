import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChangeReport,
  buildDriverEmailDraft,
  buildPayrollEmailDraft,
  changeReportMatchKey,
  fillPayrollMessageTemplate,
  preservePayrollNotifiedAt,
} from '../src/logic/changeReport.js';

function makeChange(overrides = {}) {
  return {
    id: 'c1',
    route_id: 'S 20',
    driver_name: 'Jane Driver',
    segment: 'AM',
    submitted_at: '2025-09-02T08:00:00.000Z',
    effective_date: '2025-09-02',
    previous_time: '6:35-8:55',
    new_time: '6:30-8:55',
    computed_delta_minutes: 5,
    delta_minutes: 5,
    routing_adjustment: null,
    reason_category: 'MV',
    note: 'Student added near end of run',
    entered_by: 'Routing Desk',
    ...overrides,
  };
}

describe('changeReport', () => {
  it('builds a report with before/after math and contracted-hours statement', () => {
    const report = buildChangeReport({
      route_id: 'S 20',
      driver_name: 'Jane Driver',
      driver_id: 'drv-jane',
      outcome: 'STABLE',
      finalized_at: '2025-09-24T00:00:00.000Z',
      window_opened_date: '2025-09-02',
      before_segments: {
        AM: '6:35-8:55',
        MIDDAY: null,
        PM: '2:10-4:45',
      },
      after_segments: {
        AM: '6:30-8:55',
        MIDDAY: null,
        PM: '2:10-4:45',
      },
      contributing_changes: [makeChange()],
    });

    assert.equal(report.route_id, 'S 20');
    assert.equal(report.outcome, 'STABLE');
    assert.equal(report.contributing_changes.length, 1);
    assert.equal(report.contributing_changes[0].delta_minutes, 5);
    assert.equal(report.contributing_changes[0].entered_by, 'Routing Desk');
    assert.equal(report.before.math.exact_total_minutes, 295);
    assert.equal(report.after.math.exact_total_minutes, 300);
    assert.equal(report.before.math.payroll_rounded_total_minutes, 300);
    assert.equal(report.after.math.payroll_rounded_total_minutes, 300);
    assert.equal(report.contracted_hours_changed, false);
    assert.match(report.contracted_hours_statement, /did not change/);
    assert.match(report.contracted_hours_statement, /same quarter-hour/);
    assert.equal(report.see_the_math.statement, report.contracted_hours_statement);
  });

  it('states when contracted hours did change', () => {
    const report = buildChangeReport({
      route_id: 'S 20',
      driver_name: 'Jane Driver',
      outcome: 'BID_PENDING',
      finalized_at: '2025-09-24T00:00:00.000Z',
      window_opened_date: '2025-09-02',
      before_segments: {
        AM: '6:35-8:55',
        MIDDAY: null,
        PM: null,
      },
      after_segments: {
        AM: '6:00-8:55',
        MIDDAY: null,
        PM: null,
      },
      contributing_changes: [
        makeChange({
          previous_time: '6:35-8:55',
          new_time: '6:00-8:55',
          delta_minutes: 35,
          effective_delta_minutes: 35,
        }),
      ],
    });

    assert.equal(report.contracted_hours_changed, true);
    assert.ok(report.contracted_hours_delta_minutes !== 0);
    assert.match(report.contracted_hours_statement, /Contracted hours changed/);
  });

  it('disables email draft when no email is on file', () => {
    const report = buildChangeReport({
      route_id: 'S 20',
      driver_name: 'Jane Driver',
      outcome: 'STABLE',
      finalized_at: '2025-09-24T00:00:00.000Z',
      window_opened_date: '2025-09-02',
      before_segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
      after_segments: { AM: '6:30-8:55', MIDDAY: null, PM: null },
      contributing_changes: [makeChange()],
    });

    const draft = buildDriverEmailDraft(report, {
      name: 'Jane Driver',
      email: null,
    });

    assert.equal(draft.can_send, false);
    assert.equal(draft.mailto_url, null);
    assert.match(draft.disabled_reason, /No email on file/);
    assert.match(draft.subject, /hours update/);
    assert.match(draft.body, /Jane/);
    assert.doesNotMatch(draft.body, /interim pay is/);
  });

  it('builds a mailto draft when email exists, without interim-pay claims', () => {
    const report = buildChangeReport({
      route_id: 'S 20',
      driver_name: 'Jane Driver',
      outcome: 'BID_PENDING',
      finalized_at: '2025-09-24T00:00:00.000Z',
      window_opened_date: '2025-09-02',
      before_segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
      after_segments: { AM: '6:00-8:55', MIDDAY: null, PM: null },
      contributing_changes: [makeChange({ delta_minutes: 35 })],
    });

    const draft = buildDriverEmailDraft(report, {
      name: 'Jane Driver',
      email: 'jane@example.com',
    });

    assert.equal(draft.can_send, true);
    assert.ok(draft.mailto_url?.startsWith('mailto:'));
    assert.match(draft.mailto_url, /jane%40example\.com|jane@example\.com/);
    assert.match(draft.subject, /bid pending/i);
    assert.match(draft.body, /bid threshold/);
    assert.match(draft.body, /does not state interim pay/);
  });

  it('disables email draft when the route is unassigned', () => {
    const report = buildChangeReport({
      route_id: 'S 20',
      driver_name: null,
      driver_id: null,
      outcome: 'STABLE',
      finalized_at: '2025-09-24T00:00:00.000Z',
      window_opened_date: '2025-09-02',
      before_segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
      after_segments: { AM: '6:30-8:55', MIDDAY: null, PM: null },
      contributing_changes: [makeChange()],
    });

    const draft = buildDriverEmailDraft(report, null);

    assert.equal(draft.can_send, false);
    assert.equal(draft.mailto_url, null);
    assert.match(draft.disabled_reason, /No driver assigned/);
  });

  it('fills payroll template placeholders and blanks missing values', () => {
    const filled = fillPayrollMessageTemplate(
      'Route {{route_id}} (driver: {{driver_name}}, {{driver_email}}) done.',
      {
        route_id: 'S 20',
        driver_name: null,
        driver_email: 'jane@example.com',
      }
    );
    assert.equal(
      filled,
      'Route S 20 (driver: , jane@example.com) done.'
    );
  });

  it('disables payroll draft when payroll email is not configured', () => {
    const report = buildChangeReport({
      route_id: 'S 20',
      driver_name: 'Jane Driver',
      outcome: 'BID_PENDING',
      finalized_at: '2025-09-24T00:00:00.000Z',
      window_opened_date: '2025-09-02',
      before_segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
      after_segments: { AM: '6:00-8:55', MIDDAY: null, PM: null },
      contributing_changes: [makeChange({ delta_minutes: 35 })],
    });

    const draft = buildPayrollEmailDraft(
      report,
      {
        payroll_email: '',
        message_template:
          'Route {{route_id}} (driver: {{driver_name}}) pending.',
      },
      { name: 'Jane Driver', email: 'jane@example.com' }
    );

    assert.equal(draft.can_send, false);
    assert.equal(draft.mailto_url, null);
    assert.match(draft.disabled_reason, /Payroll email not set/);
    assert.match(draft.body, /Route S 20 \(driver: Jane Driver\) pending\./);
  });

  it('builds a payroll mailto draft with substituted template', () => {
    const report = buildChangeReport({
      route_id: 'S 20',
      driver_name: 'Jane Driver',
      outcome: 'BID_PENDING',
      finalized_at: '2025-09-24T00:00:00.000Z',
      window_opened_date: '2025-09-02',
      before_segments: { AM: '6:35-8:55', MIDDAY: null, PM: null },
      after_segments: { AM: '6:00-8:55', MIDDAY: null, PM: null },
      contributing_changes: [makeChange({ delta_minutes: 35 })],
    });

    const draft = buildPayrollEmailDraft(
      report,
      {
        payroll_email: 'payroll@district.org',
        message_template:
          'Route {{route_id}} (driver: {{driver_name}}) email {{driver_email}} pending.',
      },
      { name: 'Jane Driver', email: 'jane@example.com' }
    );

    assert.equal(draft.can_send, true);
    assert.ok(draft.mailto_url?.startsWith('mailto:'));
    assert.match(draft.mailto_url, /payroll%40district\.org|payroll@district\.org/);
    assert.match(draft.subject, /bid pending/i);
    assert.match(draft.body, /Route S 20 \(driver: Jane Driver\) email jane@example\.com pending\./);
  });

  it('preserves payroll_notified_at across rebuild-style report id changes', () => {
    const priorReport = {
      id: 'old-id',
      outcome: 'BID_PENDING',
      window_opened_date: '2025-09-02',
      contributing_changes: [{ id: 'c1' }],
      payroll_notified_at: '2025-09-25T12:00:00.000Z',
    };
    const nextReport = {
      id: 'new-id',
      outcome: 'BID_PENDING',
      window_opened_date: '2025-09-02',
      contributing_changes: [{ id: 'c1' }],
    };
    assert.equal(
      changeReportMatchKey(priorReport),
      changeReportMatchKey(nextReport)
    );

    const preserved = preservePayrollNotifiedAt(
      { 'S 20': { change_reports: [priorReport] } },
      { 'S 20': { change_reports: [nextReport] } }
    );

    assert.equal(
      preserved['S 20'].change_reports[0].payroll_notified_at,
      '2025-09-25T12:00:00.000Z'
    );
    assert.equal(preserved['S 20'].change_reports[0].id, 'new-id');
  });
});
