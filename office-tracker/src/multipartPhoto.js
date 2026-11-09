/**
 * Pull one file named "photo" from a multipart/form-data body (phone Camera upload).
 * @param {Buffer} buffer
 * @param {string} contentType
 * @returns {{ mime: string, name: string, bytes: Buffer } | null}
 */
export function parseMultipartPhoto(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(contentType || ''));
  const boundary = (boundaryMatch?.[1] || boundaryMatch?.[2] || '').trim();
  if (!boundary) return null;

  const first = Buffer.from(`--${boundary}\r\n`);
  const sep = Buffer.from(`\r\n--${boundary}`);
  const endMarker = Buffer.from(`\r\n--${boundary}--`);

  let offset = buffer.indexOf(first);
  if (offset < 0) return null;
  let rest = buffer.subarray(offset + first.length);

  while (rest.length) {
    const headerEnd = rest.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd < 0) break;
    const headers = rest.subarray(0, headerEnd).toString('utf8');
    const body = rest.subarray(headerEnd + 4);

    const nextSep = body.indexOf(sep);
    const endAt = body.indexOf(endMarker);
    let partBody;
    if (nextSep >= 0 && (endAt < 0 || nextSep <= endAt)) {
      partBody = body.subarray(0, nextSep);
      const after = body.subarray(nextSep + 2); // `--boundary...`
      const nextFirst = Buffer.from(`--${boundary}\r\n`);
      const nextEnd = Buffer.from(`--${boundary}--`);
      if (after.subarray(0, nextEnd.length).equals(nextEnd)) {
        rest = Buffer.alloc(0);
      } else if (after.subarray(0, nextFirst.length).equals(nextFirst)) {
        rest = after.subarray(nextFirst.length);
      } else {
        rest = Buffer.alloc(0);
      }
    } else if (endAt >= 0) {
      partBody = body.subarray(0, endAt);
      rest = Buffer.alloc(0);
    } else {
      partBody = body;
      rest = Buffer.alloc(0);
    }

    const disposition = /content-disposition:\s*([^\r\n]+)/i.exec(headers)?.[1] || '';
    const field = /name="([^"]+)"/i.exec(disposition)?.[1] || '';
    if (field === 'photo') {
      const name = /filename="([^"]*)"/i.exec(disposition)?.[1] || 'timecard.jpg';
      const mime =
        /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim().toLowerCase() || 'image/jpeg';
      return { mime, name, bytes: Buffer.from(partBody) };
    }
  }
  return null;
}
