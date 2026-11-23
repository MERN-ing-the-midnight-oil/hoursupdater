import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyStudentZones, inspectionsFromXml, pacificMinutesOf, studentCheckZoneFromXml } from '../office-tracker/src/zonarBoard.js';

describe('zonar inspections', () => {
  it('reads a completed inspection as Pacific minutes', () => {
    const epoch = Date.parse('2026-11-24T00:10:00Z') / 1000;
    assert.equal(pacificMinutesOf(epoch), 16 * 60 + 10);
    const xml = `<insplist><insp timestamp="${epoch}" endtime="${epoch}" stat="G" fleet="40" verified="1" config="STUDENT-1.0" cfglabel="Student Check">55</insp></insplist>`;
    assert.deepEqual(inspectionsFromXml(xml), [
      {
        id: '55',
        fleet: '40',
        label: 'Student Check',
        config: 'STUDENT-1.0',
        endAt: 16 * 60 + 10,
        verified: true,
        stat: 'G',
      },
    ]);
  });

  it('keeps an unfinished inspection from counting as done', () => {
    const epoch = Date.parse('2026-11-24T00:10:00Z') / 1000;
    const xml = `<insplist><insp endtime="${epoch}" stat="R" fleet="41" verified="0" cfglabel="Post Trip" /></insplist>`;
    const [row] = inspectionsFromXml(xml);
    assert.equal(row.fleet, '41');
    assert.equal(row.verified, false);
    assert.equal(row.label, 'Post Trip');
  });

  it('reads the Student Check zone inside a post-trip and ignores a report with no zones', () => {
    const epoch = Date.parse('2026-11-24T00:12:00Z') / 1000;
    const xml = `<inspinfo><zone name="DRIVERS SEAT AREA" timestamp="${epoch - 120}" status="ZOV"/><zone name="INSIDE BUS/STUDENT CHECK" timestamp="${epoch}" status="ZOV"/></inspinfo>`;
    assert.deepEqual(studentCheckZoneFromXml(xml), { name: 'INSIDE BUS/STUDENT CHECK', endAt: 16 * 60 + 12 });
    assert.equal(studentCheckZoneFromXml('<inspinfo><stat>R</stat></inspinfo>'), null);
    const rows = applyStudentZones(
      [
        { id: '9', fleet: '40', label: 'BUS POST-TRIP', endAt: 16 * 60 + 20, verified: true, stat: 'G' },
        { id: '10', fleet: '41', label: 'BUS POST-TRIP', endAt: 16 * 60 + 20, verified: false, stat: 'R' },
        { id: '11', fleet: '42', label: 'STUDENT CHECK', endAt: 16 * 60 + 3, verified: true, stat: 'G' },
      ],
      new Map([['9', { name: 'INSIDE BUS/STUDENT CHECK', endAt: 16 * 60 + 12 }]])
    );
    assert.equal(rows[0].studentZone.endAt, 16 * 60 + 12);
    assert.equal(rows[0].id, undefined);
    assert.equal(rows[1].studentZone, undefined);
    assert.equal(rows[2].label, 'STUDENT CHECK');
    assert.equal(rows[2].studentZone, undefined);
  });
});