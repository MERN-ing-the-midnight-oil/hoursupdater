import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defaultNotifyPrefs,
  filterNotificationsByPrefs,
  isInQuietHours,
  normalizeNotifyPrefs,
  shouldShowDesktopPopup,
} from '../public/admin/notificationPrefs.js';

describe('notificationPrefs', () => {
  it('defaults enable every channel and trigger', () => {
    const prefs = defaultNotifyPrefs();
    assert.equal(prefs.channels.toast, true);
    assert.equal(prefs.channels.desktop, true);
    assert.equal(prefs.triggers.statuses.NEEDS_REVIEW, true);
    assert.equal(prefs.triggers.events.WINDOW_BUMP_ELIGIBLE, true);
  });

  it('normalize fills missing keys without wiping known disables', () => {
    const prefs = normalizeNotifyPrefs({
      channels: { toast: false },
      triggers: {
        statuses: { BID_PENDING: false },
        events: { WINDOW_LOCKED_IN: false },
      },
    });
    assert.equal(prefs.channels.toast, false);
    assert.equal(prefs.channels.badge, true);
    assert.equal(prefs.triggers.statuses.BID_PENDING, false);
    assert.equal(prefs.triggers.statuses.NEEDS_REVIEW, true);
    assert.equal(prefs.triggers.events.WINDOW_LOCKED_IN, false);
    assert.equal(prefs.triggers.events.BID_AWARDED, true);
  });

  it('filters notifications by event trigger prefs', () => {
    const prefs = defaultNotifyPrefs();
    prefs.triggers.events.WINDOW_LOCKED_IN = false;
    const filtered = filterNotificationsByPrefs(prefs, [
      { id: '1', event_type: 'WINDOW_LOCKED_IN' },
      { id: '2', event_type: 'BID_AWARDED' },
    ]);
    assert.deepEqual(
      filtered.map((n) => n.id),
      ['2']
    );
  });

  it('detects quiet hours that wrap midnight', () => {
    const prefs = defaultNotifyPrefs();
    prefs.when.quietHoursEnabled = true;
    prefs.when.quietHoursStart = '18:00';
    prefs.when.quietHoursEnd = '08:00';
    assert.equal(isInQuietHours(prefs, new Date(2026, 6, 20, 19, 0)), true);
    assert.equal(isInQuietHours(prefs, new Date(2026, 6, 20, 7, 0)), true);
    assert.equal(isInQuietHours(prefs, new Date(2026, 6, 20, 12, 0)), false);
  });

  it('gates desktop popups by channel, permission, focus, and quiet hours', () => {
    const prefs = defaultNotifyPrefs();
    assert.equal(
      shouldShowDesktopPopup(prefs, {
        permission: 'granted',
        documentHidden: false,
      }),
      true
    );

    prefs.channels.desktop = false;
    assert.equal(
      shouldShowDesktopPopup(prefs, {
        permission: 'granted',
        documentHidden: true,
      }),
      false
    );

    prefs.channels.desktop = true;
    prefs.when.desktopOnlyWhenHidden = true;
    assert.equal(
      shouldShowDesktopPopup(prefs, {
        permission: 'granted',
        documentHidden: false,
      }),
      false
    );
    assert.equal(
      shouldShowDesktopPopup(prefs, {
        permission: 'granted',
        documentHidden: true,
      }),
      true
    );

    prefs.when.desktopOnlyWhenHidden = false;
    prefs.when.quietHoursEnabled = true;
    prefs.when.quietHoursStart = '00:00';
    prefs.when.quietHoursEnd = '23:59';
    assert.equal(
      shouldShowDesktopPopup(prefs, {
        permission: 'granted',
        documentHidden: true,
        now: new Date(2026, 6, 20, 12, 0),
      }),
      false
    );
  });
});
