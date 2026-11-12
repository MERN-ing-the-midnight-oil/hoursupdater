import { json } from './_timesheetCapture.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  return json({ origin: url.origin });
}
