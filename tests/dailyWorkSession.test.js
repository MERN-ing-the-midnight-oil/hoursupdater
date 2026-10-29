import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DAILY_WORK_COOKIE,
  DAILY_WORK_MAX_AGE_SEC,
  closeDailyWorkSession,
  dailyWorkCookie,
  dailyWorkDriverId,
  openDailyWorkSession,
  readCookie,
} from '../src/logic/dailyWorkSession.js';

describe('daily work PIN session', () => {
  it('keeps a driver signed in for the school day and then drops the session', () => {
    const now = 1_700_000_000_000;
    const token = openDailyWorkSession('darryl', now);
    assert.equal(dailyWorkDriverId(token, now + 1000), 'darryl');
    assert.equal(
      dailyWorkDriverId(token, now + DAILY_WORK_MAX_AGE_SEC * 1000),
      ''
    );
    assert.match(dailyWorkCookie(token), new RegExp(`${DAILY_WORK_COOKIE}=${token}`));
    assert.match(dailyWorkCookie(''), /Max-Age=0/);
  });

  it('reads the session cookie and forgets it on leave', () => {
    const token = openDailyWorkSession('becky');
    const header = `other=1; ${DAILY_WORK_COOKIE}=${encodeURIComponent(token)}`;
    assert.equal(readCookie(header, DAILY_WORK_COOKIE), token);
    assert.equal(dailyWorkDriverId(readCookie(header, DAILY_WORK_COOKIE)), 'becky');
    closeDailyWorkSession(token);
    assert.equal(dailyWorkDriverId(token), '');
  });
});
