import { CAPTURE_LINK_INVALID, json, setSessionSameDriver } from '../../_timesheetCapture.js';

export async function onRequestPost(context) {
  try {
    let body = {};
    try {
      body = await context.request.json();
    } catch {
      body = {};
    }
    const updated = await setSessionSameDriver(
      context.env,
      context.params.token,
      body?.sameDriver === true
    );
    if (!updated) {
      return json({ error: CAPTURE_LINK_INVALID }, 404);
    }
    return json(updated);
  } catch (error) {
    return json({ error: error?.message || 'Could not mark that card.' }, 400);
  }
}
