import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chromeExecutable,
  escapeAppleScriptString,
  isEmailAddress,
  mailBatchScript,
  mailDraftScript,
  outlookDraftScript,
} from '../office-tracker/src/guideMail.js';

test('accepts a normal email and rejects a blank one', () => {
  assert.equal(isEmailAddress('driver@bps.k12.wa.us'), true);
  assert.equal(isEmailAddress('not an email'), false);
  assert.equal(isEmailAddress(''), false);
});

test('escapes quotes in AppleScript strings', () => {
  assert.equal(escapeAppleScriptString('Ann "Ace" Driver'), 'Ann \\"Ace\\" Driver');
});

test('mail draft addresses the driver and attaches the guide PDF', () => {
  const script = mailDraftScript({
    to: 'ace@example.com',
    name: 'Ace Driver',
    pdfPath: '/tmp/guide.pdf',
    subject: "A Bus Driver's Guide to Clock Hours",
    body: 'Hi Ace Driver,\n\nAttached is the guide.\n',
  });
  assert.match(script, /address:"ace@example.com"/);
  assert.match(script, /name:"Ace Driver"/);
  assert.match(script, /POSIX file "\/tmp\/guide.pdf"/);
  const withGuide = mailDraftScript({
    to: 'ace@example.com',
    name: 'Ace Driver',
    pdfPath: '/tmp/history.pdf',
    extraPdfPaths: ['/tmp/bus-drivers-guide.pdf'],
    subject: 'Clock-time history for Ace Driver',
    body: 'Hi Ace Driver,\n',
  });
  assert.match(withGuide, /POSIX file "\/tmp\/history.pdf"/);
  assert.match(withGuide, /POSIX file "\/tmp\/bus-drivers-guide.pdf"/);
  assert.doesNotMatch(script, /of content/);
  assert.match(script, /A Bus Driver's Guide to Clock Hours/);
  assert.match(script, /Hi Ace Driver,/);
});

test('batch script opens every draft and activates Mail once', () => {
  const script = mailBatchScript([
    {
      to: 'ace@example.com',
      name: 'Ace Driver',
      pdfPath: '/tmp/ace.pdf',
      subject: 'Notice for Ace',
      body: 'Hi Ace,\n',
    },
    {
      to: 'bee@example.com',
      name: 'Bee Driver',
      pdfPath: '/tmp/bee.pdf',
      subject: 'Notice for Bee',
      body: 'Hi Bee,\n',
    },
  ]);
  assert.match(script, /address:"ace@example.com"/);
  assert.match(script, /address:"bee@example.com"/);
  assert.match(script, /POSIX file "\/tmp\/ace.pdf"/);
  assert.match(script, /POSIX file "\/tmp\/bee.pdf"/);
  assert.equal(script.match(/activate/g).length, 1);
});

test('finds Chrome only among installed candidates', () => {
  assert.equal(
    chromeExecutable((candidate) => candidate.includes('Google Chrome')),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  );
  assert.equal(chromeExecutable(() => false), null);
});

test('Outlook script attaches the PDF and keeps apostrophes', () => {
  const script = outlookDraftScript([
    {
      to: "o'hara@example.com",
      name: "O'Hara",
      pdfPath: 'C:\\Mail Drafts\\ohara.pdf',
      subject: "O'Hara history",
      body: "Hi O'Hara,\n",
    },
  ]);
  assert.match(script, /Outlook.Application/);
  assert.match(script, /Attachments.Add\('C:\\Mail Drafts\\ohara.pdf'\)/);
  assert.match(script, /o''hara@example.com/);
});
