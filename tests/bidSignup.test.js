import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import {
  buildEligibleResponders,
  buildOpenBidPostingDraft,
  finalizeClosedBidSignups,
  isBidResponseWindowClosed,
  mapBidSignupHeader,
  matchFormEmailToDriver,
  parseBidSignupWorkbookBuffer,
  preserveBidSignupMeta,
  REQUIRED_BID_SIGNUP_COLUMNS,
} from '../src/logic/bidSignup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_XLSX = path.join(
  __dirname,
  '../sample-data/bid-signups-SAMPLE.xlsx'
);

describe('bidSignup Forms column mapping', () => {
  it('maps by header name, never position', () => {
    assert.equal(mapBidSignupHeader('Email'), 'email');
    assert.equal(mapBidSignupHeader('Name'), 'name');
    assert.equal(mapBidSignupHeader('Route ID'), 'route_id');
    assert.equal(mapBidSignupHeader('Initials'), 'initials');
    assert.equal(mapBidSignupHeader('Completion time'), 'completion_time');
    assert.equal(mapBidSignupHeader('Start time'), 'ignored');
    assert.equal(mapBidSignupHeader('ID'), 'ignored');
    assert.equal(mapBidSignupHeader('Mystery column'), null);
  });

  it('parses the real Forms sample workbook (skips Read Me sheet)', async () => {
    const buf = fs.readFileSync(SAMPLE_XLSX);
    const result = await parseBidSignupWorkbookBuffer(buf);
    assert.equal(result.status, 'ok');
    assert.equal(result.sheet_name, 'bid-signups');
    assert.deepEqual(result.missing_columns, []);
    assert.ok(result.found_headers.includes('Email'));
    assert.ok(result.found_headers.includes('Name'));
    assert.ok(result.responses.length >= 3);
    assert.equal(result.responses[0].route_id, 'S 20');
    assert.ok(result.responses[0].email.includes('@'));
    assert.match(result.responses[0].signed_at, /2026/);
  });

  it('fails loudly when Email column is missing', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('bid-signups');
    sheet.addRow([
      'ID',
      'Start time',
      'Completion time',
      'Name',
      'Route ID',
      'Initials',
    ]);
    sheet.addRow([
      '1',
      '10/6/2026 7:00:00 AM',
      '10/6/2026 7:14:41 AM',
      'Jane Driver',
      'S 30',
      'JD',
    ]);
    const buf = await wb.xlsx.writeBuffer();
    const result = await parseBidSignupWorkbookBuffer(buf);
    assert.equal(result.status, 'schema_error');
    assert.deepEqual(result.missing_columns, ['Email']);
    assert.match(
      result.message,
      /Bid sign-up file is missing an expected column: Email/
    );
    assert.equal(result.responses.length, 0);
  });

  it('still finds columns when Forms reorder questions', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Form1');
    sheet.addRow([
      'Completion time',
      'Initials',
      'Name',
      'Email',
      'Route ID',
    ]);
    sheet.addRow([
      '10/6/2026 7:14:41 AM',
      'JD',
      'Jane Driver',
      'Jane.Driver@district.edu',
      'S 30',
    ]);
    const buf = await wb.xlsx.writeBuffer();
    const result = await parseBidSignupWorkbookBuffer(buf);
    assert.equal(result.status, 'ok');
    assert.equal(result.responses.length, 1);
    assert.equal(result.responses[0].email, 'Jane.Driver@district.edu');
    assert.equal(result.responses[0].driver_name, 'Jane Driver');
    assert.equal(result.responses[0].route_id, 'S 30');
  });

  it('returns empty calm state when headers exist but no response rows', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('bid-signups');
    sheet.addRow(REQUIRED_BID_SIGNUP_COLUMNS);
    const buf = await wb.xlsx.writeBuffer();
    const result = await parseBidSignupWorkbookBuffer(buf);
    assert.equal(result.status, 'empty');
    assert.match(result.message, /No sign-up responses found yet/);
  });
});

describe('Form email → driver directory matching', () => {
  const drivers = [
    {
      driver_id: 'drv-junior',
      name: 'Blake Junior',
      email: 'blake.junior@district.edu',
      hire_date: '2018-01-01',
      tie_break: null,
    },
    {
      driver_id: 'drv-senior',
      name: 'Alex Senior',
      email: 'Alex.Senior@district.edu',
      hire_date: '2010-01-01',
      tie_break: null,
    },
    {
      driver_id: 'drv-no-email',
      name: 'Casey NoEmail',
      email: null,
      hire_date: '2015-01-01',
      tie_break: null,
    },
  ];

  it('exact case-insensitive email match succeeds', () => {
    const m = matchFormEmailToDriver('alex.senior@district.edu', drivers);
    assert.equal(m.status, 'matched');
    assert.equal(m.driver.driver_id, 'drv-senior');
  });

  it('does not match on Name typos — email is the key', () => {
    const m = matchFormEmailToDriver('nobody@elsewhere.edu', drivers);
    assert.equal(m.status, 'unmatched');
    assert.equal(m.driver, null);
    assert.deepEqual(m.suggestions, []);
  });

  it('flags ambiguous when two drivers share an email', () => {
    const dupDrivers = [
      ...drivers,
      {
        driver_id: 'drv-dup',
        name: 'Alex Alias',
        email: 'alex.senior@district.edu',
        hire_date: '2011-01-01',
        tie_break: null,
      },
    ];
    const m = matchFormEmailToDriver('Alex.Senior@district.edu', dupDrivers);
    assert.equal(m.status, 'ambiguous');
    assert.equal(m.driver, null);
    assert.equal(m.suggestions.length, 2);
  });

  it('buildEligibleResponders matches by email and surfaces unmatched addresses', () => {
    const { responders, match_issues } = buildEligibleResponders({
      route_id: 'S 30',
      due_date: '2025-10-03',
      drivers,
      responses: [
        {
          route_id: 'S 30',
          email: 'Alex.Senior@district.edu',
          driver_name: 'Alex Nickname',
          initials: 'AS',
          signed_at: '2025-10-02T09:00:00.000Z',
        },
        {
          route_id: 'S 30',
          email: 'BLAKE.JUNIOR@district.edu',
          driver_name: 'Blake Junior',
          initials: 'BJ',
          signed_at: '2025-10-02T10:00:00.000Z',
        },
        {
          route_id: 'S 30',
          email: 'unexpected@elsewhere.edu',
          driver_name: 'Casey NoEmail',
          initials: 'CN',
          signed_at: '2025-10-02T08:00:00.000Z',
        },
        {
          route_id: 'S 30',
          email: 'blake.junior@district.edu',
          driver_name: 'Blake Junior',
          initials: 'LATE',
          signed_at: '2025-10-04T10:00:00.000Z',
        },
      ],
    });
    assert.equal(responders.length, 2);
    assert.equal(responders[0].driver_id, 'drv-senior');
    assert.equal(responders[0].name, 'Alex Senior');
    assert.equal(responders[1].initials, 'BJ');
    assert.equal(match_issues.length, 1);
    assert.equal(match_issues[0].form_email, 'unexpected@elsewhere.edu');
    assert.equal(match_issues[0].form_name, 'Casey NoEmail');
  });

  it('treats post-due dates as closed', () => {
    assert.equal(isBidResponseWindowClosed('2025-10-03', '2025-10-03'), false);
    assert.equal(isBidResponseWindowClosed('2025-10-03', '2025-10-04'), true);
  });
});

describe('finalize + mailto', () => {
  it('snapshots eligible list once when window closed and parse is ok', () => {
    const state = {
      'S 30': {
        status: 'BID_PENDING',
        bid_response_due_date: '2025-10-03',
        bid_signup: {
          drivers_notified_at: '2025-10-01T12:00:00.000Z',
          finalized_at: null,
          eligible_responders: null,
          match_issues: null,
          workbook_mtime: null,
        },
        driver_id: 'x',
        driver_name: 'X',
        segments: { AM: null, MIDDAY: null, PM: null },
        baseline_segments: { AM: null, MIDDAY: null, PM: null },
        window_opened_date: null,
        window_expires_date: null,
        cumulative_drift_minutes: 35,
        contributing_change_ids: [],
        payroll_rounded_total_minutes: 100,
        last_updated: 't',
      },
    };
    const drivers = [
      {
        driver_id: 'drv-a',
        name: 'Alex Senior',
        email: 'a@example.com',
        hire_date: '2010-01-01',
        tie_break: null,
      },
    ];
    const next = finalizeClosedBidSignups(state, {
      enabled: true,
      asOfDate: '2025-10-05',
      drivers,
      parse: {
        status: 'ok',
        message: null,
        missing_columns: [],
        found_headers: [],
        responses: [
          {
            route_id: 'S 30',
            email: 'A@example.com',
            driver_name: 'Alex Senior',
            initials: 'AS',
            signed_at: '2025-10-02T12:00:00.000Z',
          },
        ],
        sheet_name: 'bid-signups',
      },
      workbook_mtime: '2025-10-05T00:00:00.000Z',
    });
    assert.ok(next['S 30'].bid_signup.finalized_at);
    assert.equal(next['S 30'].bid_signup.eligible_responders.length, 1);

    const again = finalizeClosedBidSignups(next, {
      enabled: true,
      asOfDate: '2025-10-06',
      drivers,
      parse: {
        status: 'ok',
        message: null,
        missing_columns: [],
        found_headers: [],
        responses: [],
        sheet_name: 'bid-signups',
      },
      workbook_mtime: null,
    });
    assert.equal(
      again['S 30'].bid_signup.eligible_responders.length,
      1,
      'does not re-open once finalized'
    );
  });

  it('does not finalize when schema is broken', () => {
    const state = {
      'S 30': {
        status: 'BID_PENDING',
        bid_response_due_date: '2025-10-03',
        bid_signup: {
          drivers_notified_at: null,
          finalized_at: null,
          eligible_responders: null,
          match_issues: null,
          workbook_mtime: null,
        },
      },
    };
    const next = finalizeClosedBidSignups(state, {
      enabled: true,
      asOfDate: '2025-10-05',
      drivers: [],
      parse: {
        status: 'schema_error',
        message: 'Bid sign-up file is missing an expected column: Email',
        missing_columns: ['Email'],
        found_headers: ['Name'],
        responses: [],
        sheet_name: 'bid-signups',
      },
    });
    assert.equal(next['S 30'].bid_signup.finalized_at, null);
  });

  it('does nothing when electronic mode is off', () => {
    const state = {
      'S 30': {
        status: 'BID_PENDING',
        bid_response_due_date: '2025-10-03',
        bid_signup: null,
      },
    };
    const next = finalizeClosedBidSignups(state, {
      enabled: false,
      asOfDate: '2025-10-05',
      drivers: [],
      parse: {
        status: 'ok',
        message: null,
        missing_columns: [],
        found_headers: [],
        responses: [],
        sheet_name: null,
      },
    });
    assert.equal(next['S 30'].bid_signup, null);
  });

  it('builds CC mailto for the full directory', () => {
    const draft = buildOpenBidPostingDraft({
      route_id: 'S 30',
      bid_response_due_date: '2025-10-03',
      to_email: 'office@example.org',
      drivers: [
        {
          driver_id: '1',
          name: 'A',
          email: 'a@example.com',
          hire_date: null,
          tie_break: null,
        },
        {
          driver_id: '2',
          name: 'B',
          email: 'b@example.com',
          hire_date: null,
          tie_break: null,
        },
        {
          driver_id: '3',
          name: 'C',
          email: null,
          hire_date: null,
          tie_break: null,
        },
      ],
      template: {
        subject: 'Route {{route_id}} bid',
        body: 'Due {{bid_response_due_date}}',
      },
    });
    assert.equal(draft.can_send, true);
    assert.equal(draft.cc_count, 2);
    assert.equal(draft.missing_email_count, 1);
    assert.match(draft.mailto_url, /cc=/);
    assert.match(draft.subject, /S 30/);
  });

  it('preserveBidSignupMeta keeps due date and snapshot', () => {
    const prior = {
      'S 30': {
        status: 'BID_PENDING',
        bid_response_due_date: '2025-10-03',
        bid_signup: {
          drivers_notified_at: 't',
          finalized_at: 't2',
          eligible_responders: [],
          match_issues: [],
          workbook_mtime: null,
        },
      },
    };
    const computed = {
      'S 30': {
        status: 'BID_PENDING',
        bid_response_due_date: '2099-01-01',
        bid_signup: null,
      },
    };
    const preserved = preserveBidSignupMeta(prior, computed);
    assert.equal(preserved['S 30'].bid_response_due_date, '2025-10-03');
    assert.equal(preserved['S 30'].bid_signup.finalized_at, 't2');
  });
});
