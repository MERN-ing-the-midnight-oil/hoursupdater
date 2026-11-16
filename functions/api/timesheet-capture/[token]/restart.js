import { CAPTURE_LINK_INVALID, json, restartSession } from '../../_timesheetCapture.js';

export async function onRequestPost(context) {
  try {
    const restarted = await restartSession(context.env, context.params.token);
    if (!restarted) {
      return json({ error: CAPTURE_LINK_INVALID }, 404);
    }
    return json(restarted);
  } catch (error) {
    return json(
      { error: error?.message || 'Could not start again. Scan a new QR code.' },
      500
    );
  }
}
