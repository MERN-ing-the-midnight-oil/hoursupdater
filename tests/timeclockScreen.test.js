import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isExternalTimeclockSearch,
  otherTimeclockScreens,
  timeclockScreenLabel,
  timeclockWantsFill,
  timeclockWindowBounds,
  timeclockWindowFeatures,
  timeclockWindowUrl,
} from '../office-tracker/web/timeclockScreen.js';

const laptop = { left: 0, top: 0, width: 1440, height: 900, availLeft: 0, availTop: 25, availWidth: 1440, availHeight: 875, isInternal: true, isPrimary: true, label: 'Built-in' };
const door = { left: 1440, top: 0, width: 1920, height: 1080, availLeft: 1440, availTop: 0, availWidth: 1920, availHeight: 1080, isInternal: false, label: 'Dell' };
const leftDesk = { left: -1920, top: 0, width: 1920, height: 1080, availLeft: -1920, availTop: 0, availWidth: 1920, availHeight: 1040, isInternal: false, label: '' };

describe('timeclock screen placement', () => {
  it('keeps the office screen out of the choices', () => {
    const choices = otherTimeclockScreens({ screens: [laptop, door, leftDesk], currentScreen: laptop });
    assert.deepEqual(choices.map((screen) => screen.label), ['', 'Dell']);
    assert.equal(choices[0], leftDesk);
  });

  it('finds no other screen when this computer has one display', () => {
    assert.deepEqual(otherTimeclockScreens({ screens: [laptop], currentScreen: laptop }), []);
    assert.deepEqual(otherTimeclockScreens({ screens: [laptop] }), []);
  });

  it('names a monitor from its label, side, and size', () => {
    assert.equal(timeclockScreenLabel(door), 'Dell · 1920×1080');
    assert.equal(timeclockScreenLabel(leftDesk), 'External screen · on the left · 1920×1080');
  });

  it('opens a popup that fills the other monitor work area', () => {
    assert.deepEqual(timeclockWindowBounds(door), { left: 1440, top: 0, width: 1920, height: 1080 });
    assert.equal(timeclockWindowFeatures(door), 'popup,left=1440,top=0,width=1920,height=1080');
    assert.equal(timeclockWindowFeatures(null), 'popup,width=1280,height=800');
    assert.equal(timeclockWindowBounds(leftDesk)?.top, 0);
    assert.equal(timeclockWindowBounds(leftDesk)?.height, 1040);
  });

  it('marks the new window as the external timeclock', () => {
    const placed = timeclockWindowUrl('http://office.local/index.html?section=clocking#sheet', { fill: true });
    assert.equal(placed, 'http://office.local/?section=timeclock&fill=1');
    assert.equal(isExternalTimeclockSearch('?section=timeclock&fill=1'), true);
    assert.equal(timeclockWantsFill('?section=timeclock&fill=1'), true);
    assert.equal(timeclockWantsFill('?section=timeclock'), false);
    assert.equal(isExternalTimeclockSearch('?section=clocking'), false);
  });
});
