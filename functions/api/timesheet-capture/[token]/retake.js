import { CAPTURE_LINK_INVALID, json, putSessionRetake } from '../../_timesheetCapture.js';

export async function onRequestPost(context) {
  try {
    let body = {};
    try {
      body = await context.request.json();
    } catch {
      body = {};
    }
    const updated = await putSessionRetake(context.env, context.params.token, body);
    if (!updated) {
      return json({ error: CAPTURE_LINK_INVALID }, 404);
    }
    return json(updated);
  } catch (error) {
    return json({ error: error?.message || 'Could not start that rescan.' }, 400);
  }
}
