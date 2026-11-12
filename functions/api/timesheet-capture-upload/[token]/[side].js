import {
  captureRedirect,
  normalizeSide,
  putPhotoFile,
} from '../../_timesheetCapture.js';

export async function onRequestPost(context) {
  const token = String(context.params.token || '').trim();
  const side = normalizeSide(context.params.side);
  const requestUrl = context.request.url;
  try {
    if (!side) {
      return captureRedirect(requestUrl, token, { err: 'Choose front or back.' });
    }
    const form = await context.request.formData();
    const file = form.get('photo');
    if (!(file instanceof File) || !file.size) {
      return captureRedirect(requestUrl, token, {
        err: 'That photo did not arrive. Try Take photo again.',
      });
    }
    const bytes = await file.arrayBuffer();
    const saved = await putPhotoFile(context.env, token, side, {
      mime: file.type || 'image/jpeg',
      name: file.name || `${side}-timecard.jpg`,
      bytes,
    });
    if (!saved) {
      return captureRedirect(requestUrl, token, {
        err: 'This photo link is not valid or has expired.',
      });
    }
    return captureRedirect(requestUrl, token, { saved: side });
  } catch (error) {
    try {
      return captureRedirect(requestUrl, token, {
        err: error?.message || 'That photo could not be saved.',
      });
    } catch {
      return new Response(error?.message || 'That photo could not be saved.', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  }
}
