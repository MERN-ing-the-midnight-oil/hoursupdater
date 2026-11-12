import assert from 'node:assert/strict';
import test from 'node:test';
import {
  meetingFromReminderEvent,
  normalizeOutlookMeetings,
  outlookAutomationSupported,
  outlookPayrollMeetingScript,
  runOutlookPowerShell,
} from '../office-tracker/src/outlookMeetings.js';

test('Outlook automation is Windows-only', () => {
  assert.equal(outlookAutomationSupported('win32'), true);
  assert.equal(outlookAutomationSupported('darwin'), false);
  assert.equal(outlookAutomationSupported('linux'), false);
});

test('meeting payload keeps free one-minute Outlook meetings', () => {
  const meeting = meetingFromReminderEvent(
    {
      subject: "Route 50 · O'Hara",
      body: "Recorded hours for route 50.\nEffective Thu, Oct 1, 2026.",
      reminderDate: '2026-10-05',
      changeIds: ['change-1'],
      routes: ['50'],
    },
    [
      { email: 'payroll@bps.org', name: 'Payroll' },
      { email: 'Payroll@bps.org', name: 'Dup' },
      { email: 'not-an-email', name: 'Skip' },
    ]
  );
  assert.equal(meeting.startLocal, '2026-10-05 08:00:00');
  assert.equal(meeting.endLocal, '2026-10-05 08:01:00');
  assert.deepEqual(
    meeting.invitees.map((person) => person.email),
    ['payroll@bps.org']
  );
  const script = outlookPayrollMeetingScript([meeting]);
  assert.match(script, /Outlook\.Application/);
  assert.match(script, /CreateItem\(1\)/);
  assert.match(script, /MeetingStatus = 1/);
  assert.match(script, /BusyStatus = 0/);
  assert.match(script, /ReminderMinutesBeforeStart = 0/);
  assert.match(script, /Subject = 'Route 50 · O''Hara'/);
  assert.match(script, /Body = 'Recorded hours for route 50\.\nEffective Thu, Oct 1, 2026\.'/);
  assert.match(script, /Start = \[DateTime\]'2026-10-05 08:00:00'/);
  assert.match(script, /End = \[DateTime\]'2026-10-05 08:01:00'/);
  assert.match(script, /Recipients\.Add\('payroll@bps\.org'\)/);
  assert.match(script, /Display\(\$false\)/);
  assert.equal(normalizeOutlookMeetings([{ subject: 'Missing times' }]).length, 0);
});

test('PowerShell runner refuses non-Windows hosts', async () => {
  await assert.rejects(
    () =>
      runOutlookPowerShell('Write-Output ok', {
        execFile: async () => {},
      }),
    /Windows/
  );
});
