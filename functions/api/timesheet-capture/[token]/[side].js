import {
  getPhoto,
  json,
  normalizeSide,
  putPhotoBase64,
} from '../../_timesheetCapture.js';

export async function onRequestGet(context) {
  const photo = await getPhoto(context.env, context.params.token, context.params.side);
  if (!photo) {
    return json({ error: 'That photo is not ready yet.' }, 404);
  }
  const name = String(photo.name || 'timecard.jpg').replace(/"/g, '');
  return new Response(photo.bytes, {
    status: 200,
    headers: {
      'content-type': photo.mime || 'image/jpeg',
      'content-disposition': `inline; filename="${name}"`,
    },
  });
}

export async function onRequestPut(context) {
  const which = normalizeSide(context.params.side);
  if (!which) {
    return json({ error: 'Choose front or back.' }, 400);
  }
  try {
    const body = await context.request.json().catch(() => ({}));
    const saved = await putPhotoBase64(
      context.env,
      context.params.token,
      which,
      body ?? {}
    );
    if (!saved) {
      return json({ error: 'This photo link is not valid or has expired.' }, 404);
    }
    return json(saved);
  } catch (error) {
    return json({ error: error?.message || 'That photo could not be saved.' }, 400);
  }
}
