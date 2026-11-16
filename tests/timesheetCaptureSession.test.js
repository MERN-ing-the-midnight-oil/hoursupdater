import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  closeSession,
  openSession,
  putPhotoFile,
  readSession,
} from '../functions/api/_timesheetCapture.js';

function memoryKv() {
  const rows = new Map();
  return {
    puts: [],
    async get(key, type) {
      const row = rows.get(key);
      if (!row) return null;
      if (type === 'json') return JSON.parse(row.value);
      return row.value;
    },
    async put(key, value, options) {
      this.puts.push({ key, options: options || null });
      rows.set(key, {
        value: typeof value === 'string' ? value : value,
        metadata: options?.metadata || null,
      });
    },
    async delete(key) {
      rows.delete(key);
    },
    async getWithMetadata(key) {
      const row = rows.get(key);
      if (!row) return { value: null, metadata: null };
      return { value: row.value, metadata: row.metadata };
    },
  };
}

describe('timecard genie phone link storage', () => {
  it('keeps a link until the desk closes it', async () => {
    const kv = memoryKv();
    const env = { TIMECARD_CAPTURE: kv };
    const opened = await openSession(env);
    assert.equal(typeof opened.token, 'string');
    assert.equal(opened.expiresAt, undefined);
    assert.equal(
      kv.puts.every((put) => put.options?.expirationTtl == null),
      true
    );

    const stillOpen = await readSession(env, opened.token);
    assert.equal(stillOpen?.token, opened.token);

    await putPhotoFile(env, opened.token, 'front', {
      mime: 'image/jpeg',
      name: 'front-timecard.jpg',
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });
    assert.equal(
      kv.puts.every((put) => put.options?.expirationTtl == null),
      true
    );
    assert.equal((await readSession(env, opened.token))?.front, true);

    await closeSession(env, opened.token);
    assert.equal(await readSession(env, opened.token), null);
  });

  it('drops the old 15-minute deadline the next time a link is read', async () => {
    const kv = memoryKv();
    const env = { TIMECARD_CAPTURE: kv };
    await kv.put(
      'session:old-link',
      JSON.stringify({
        token: 'old-link',
        expiresAt: '2000-01-01T00:00:00.000Z',
        front: false,
        back: false,
        skipFront: false,
        skipBack: false,
        sameDriver: false,
        cards: [],
        retake: null,
      })
    );
    const session = await readSession(env, 'old-link');
    assert.equal(session?.token, 'old-link');
    assert.equal(session?.expiresAt, undefined);
    const stored = await kv.get('session:old-link', 'json');
    assert.equal(stored.expiresAt, undefined);
  });
});
