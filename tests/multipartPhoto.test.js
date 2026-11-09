import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMultipartPhoto } from '../office-tracker/src/multipartPhoto.js';

describe('multipart photo parse', () => {
  it('reads the photo file part from a phone form upload', () => {
    const boundary = '----TestBoundary123';
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x01, 0x02]);
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="photo"; filename="front.jpg"\r\n' +
          'Content-Type: image/jpeg\r\n' +
          '\r\n'
      ),
      jpeg,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const parsed = parseMultipartPhoto(body, `multipart/form-data; boundary=${boundary}`);
    assert.ok(parsed);
    assert.equal(parsed.mime, 'image/jpeg');
    assert.equal(parsed.name, 'front.jpg');
    assert.deepEqual(parsed.bytes, jpeg);
  });
});
