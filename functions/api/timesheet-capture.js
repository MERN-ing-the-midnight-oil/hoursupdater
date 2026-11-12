import { json, openSession } from './_timesheetCapture.js';

export async function onRequestPost(context) {
  try {
    const opened = await openSession(context.env);
    return json(opened);
  } catch (error) {
    return json(
      { error: error?.message || 'Could not start a phone photo link.' },
      500
    );
  }
}
