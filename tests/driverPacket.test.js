import assert from 'node:assert/strict';
import test from 'node:test';
import { assignRouteDriver } from '../office-tracker/src/assignments.js';
import { exampleOfficeState } from '../office-tracker/web/exampleRoutes.js';
import {
  buildDriverPacket,
  packetPdfBasename,
  profilesForDriver,
} from '../office-tracker/src/driverPacket.js';

const AS_OF = '2026-09-25';

function officeProfiles() {
  return Object.values(exampleOfficeState().profiles);
}

test('keeps only the named driver, ignoring case and other routes', () => {
  const profiles = officeProfiles();
  const matched = profilesForDriver(profiles, '  JEAN-LUC PICARD ');
  assert.deepEqual(
    matched.map((profile) => profile.name),
    ['S1']
  );
  assert.equal(profilesForDriver(profiles, '').length, 0);
  assert.equal(profilesForDriver(profiles, 'Nobody').length, 0);
});

test('packet contains that driver only', () => {
  const packet = buildDriverPacket({
    driverName: 'Jean-Luc Picard',
    profiles: officeProfiles(),
    asOf: AS_OF,
  });
  assert.ok(packet);
  assert.deepEqual(packet.routeNames, ['S1']);
  assert.match(packet.html, /Clock-time history for Jean-Luc Picard/);
  assert.match(packet.html, /only the route assigned to Jean-Luc Picard: S1/);
  assert.match(packet.html, /AM traffic added 15 minutes/);
  assert.match(packet.html, /September 2026/);
  assert.match(packet.html, /history-pip/);
  assert.match(packet.html, /class="calendar-months"/);
  assert.doesNotMatch(packet.html, /William Riker/);
  assert.doesNotMatch(packet.html, /Deanna Troi/);
  assert.doesNotMatch(packet.html, /Blue Hill Ave/);
  assert.doesNotMatch(packet.html, /Wesley Crusher/);
  assert.match(packet.mail.subject, /Clock-time history for Jean-Luc Picard/);
  assert.match(packet.mail.body, /route S1/);
  assert.match(packet.mail.body, /written explanation of those changes/);
  assert.match(packet.mail.body, /only the routes assigned to you/);
  assert.match(packet.html, /What changed/);
  const narrative = packet.html.match(/<div class="packet-narrative">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.match(narrative, /Starting times were established on Tue, Sep 8, 2026/);
  assert.match(
    narrative,
    /The AM change was established on Fri, Sep 11, 2026\. It resolved on Fri, Sep 18, 2026, replaced by a later change/
  );
  assert.match(
    narrative,
    /The PM change was established on Fri, Sep 18, 2026\. It resolves on Mon, Oct 26, 2026, posted for bid/
  );
  assert.doesNotMatch(narrative, /square|numbered|arrow|minutes longer/);
  assert.doesNotMatch(packet.mail.body, /Riker|Troi|Worf|Wesley/);
  assert.equal(buildDriverPacket({ driverName: 'Nobody', profiles: officeProfiles(), asOf: AS_OF }), null);
});

test('a notice packet keeps the chosen pages and routes', () => {
  const packet = buildDriverPacket({
    driverName: 'Jean-Luc Picard',
    profiles: officeProfiles(),
    asOf: AS_OF,
    include: { summary: true, narrative: true, history: false, calendar: false },
    onlyRouteNames: ['S1'],
    mail: {
      subject: 'Clock-time notice for Jean-Luc Picard',
      body: 'Custom note for route S1.\n',
    },
  });
  assert.deepEqual(packet.routeNames, ['S1']);
  assert.match(packet.html, /What changed/);
  assert.match(packet.html, /Contracted hours/);
  assert.doesNotMatch(packet.html, /class="calendar-months"/);
  assert.doesNotMatch(packet.html, /<h3>Change history<\/h3>/);
  assert.equal(packet.mail.subject, 'Clock-time notice for Jean-Luc Picard');
  assert.match(packet.mail.body, /Custom note for route S1/);
});

test('includes every route assigned to the driver and no one else', () => {
  const profiles = officeProfiles();
  const second = structuredClone(profiles.find((profile) => profile.name === 'S2'));
  second.id = 'route-s9';
  second.name = 'S9';
  second.driver_name = 'Jean-Luc Picard';
  const packet = buildDriverPacket({
    driverName: 'Jean-Luc Picard',
    profiles: [...profiles, second],
    asOf: AS_OF,
  });
  assert.deepEqual(packet.routeNames, ['S1', 'S9']);
  assert.match(packet.html, /Route S1/);
  assert.match(packet.html, /Route S9/);
  assert.match(packet.mail.body, /routes S1, S9/);
  assert.doesNotMatch(packet.html, /William Riker/);
  assert.doesNotMatch(packet.html, /Route S3/);
});

test('a new route keeps the driver from the day the route started', () => {
  const profile = {
    name: '3',
    start_date: '2026-09-08',
    driver_name: '',
    changeLog: [],
  };
  assignRouteDriver(profile, 'Jean-Luc Picard', '2026-09-25');
  assert.equal(profile.driver_name, 'Jean-Luc Picard');
  assert.deepEqual(profile.assignments, [
    { driver_name: 'Jean-Luc Picard', from: '2026-09-08', until: null },
  ]);
});

test('history follows a driver across route assignments', () => {
  const profiles = officeProfiles().map((profile) => structuredClone(profile));
  const routeS1 = profiles.find((profile) => profile.name === 'S1');
  const routeS2 = profiles.find((profile) => profile.name === 'S2');
  assignRouteDriver(routeS1, 'William Riker', '2026-10-01');
  assignRouteDriver(routeS2, 'Jean-Luc Picard', '2026-10-01');

  const priya = buildDriverPacket({
    driverName: 'Jean-Luc Picard',
    profiles,
    asOf: '2026-10-02',
  });
  assert.deepEqual(priya.routeNames, ['S1', 'S2']);
  assert.match(priya.html, /across routes S1, S2/);
  assert.match(priya.html, /AM traffic added 15 minutes/);
  assert.match(priya.html, /The AM change was established on Fri, Sep 11, 2026/);
  assert.match(priya.html, /Starting times were established on Thu, Oct 1, 2026/);
  assert.doesNotMatch(priya.html, /Blue Hill/);
  assert.doesNotMatch(priya.html, /William Riker/);

  const marcus = buildDriverPacket({
    driverName: 'William Riker',
    profiles,
    asOf: '2026-10-02',
  });
  assert.deepEqual(marcus.routeNames, ['S2', 'S1']);
  assert.match(marcus.html, /Blue Hill/);
  assert.match(marcus.html, /Starting times were established on Thu, Oct 1, 2026/);
  assert.doesNotMatch(marcus.html, /AM traffic/);
});

test('a route with no later changes does not invent a countdown', () => {
  const priya = structuredClone(
    officeProfiles().find((profile) => profile.driver_name === 'Jean-Luc Picard')
  );
  priya.changeLog = priya.changeLog.filter(
    (change) => change.delta_minutes === 0 && change.previous_time === change.new_time
  );
  const packet = buildDriverPacket({
    driverName: 'Jean-Luc Picard',
    profiles: [priya],
    asOf: AS_OF,
  });
  const narrative = packet.html.match(/<div class="packet-narrative">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.match(narrative, /Starting times were established on Tue, Sep 8, 2026/);
  assert.doesNotMatch(narrative, /It resolved|It resolves|posted for bid/);
  assert.doesNotMatch(narrative, /AM traffic/);
});

test('escapes notes and names in the packet', () => {
  const profiles = officeProfiles();
  const priya = structuredClone(profiles.find((profile) => profile.driver_name === 'Jean-Luc Picard'));
  priya.driver_name = 'Ann <Ace>';
  priya.changeLog = priya.changeLog.map((change) =>
    String(change.note).includes('traffic')
      ? { ...change, note: '<script>alert(1)</script>' }
      : change
  );
  const packet = buildDriverPacket({
    driverName: 'Ann <Ace>',
    profiles: [priya],
    asOf: AS_OF,
  });
  assert.match(packet.html, /Ann &lt;Ace&gt;/);
  assert.match(packet.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(packet.html, /<script>/);
});

test('pdf basename is a safe slug', () => {
  assert.equal(packetPdfBasename('Jean-Luc Picard'), 'jean-luc-picard-clock-history');
  assert.equal(packetPdfBasename('Ann "Ace" Driver'), 'ann-ace-driver-clock-history');
  assert.equal(packetPdfBasename('   '), 'driver-clock-history');
});
