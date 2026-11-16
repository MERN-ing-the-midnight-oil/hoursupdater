import { CAPTURE_LINK_INVALID, closeSession, json, readSession } from '../_timesheetCapture.js';

export async function onRequestGet(context) {
  const session = await readSession(context.env, context.params.token);
  if (!session) {
    return json({ error: CAPTURE_LINK_INVALID }, 404);
  }
  return json(session);
}

export async function onRequestDelete(context) {
  await closeSession(context.env, context.params.token);
  return new Response(null, { status: 204 });
}
