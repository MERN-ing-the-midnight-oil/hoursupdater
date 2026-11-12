import { closeSession, json, readSession } from '../_timesheetCapture.js';

export async function onRequestGet(context) {
  const session = await readSession(context.env, context.params.token);
  if (!session) {
    return json({ error: 'This photo link is not valid or has expired.' }, 404);
  }
  return json(session);
}

export async function onRequestDelete(context) {
  await closeSession(context.env, context.params.token);
  return new Response(null, { status: 204 });
}
