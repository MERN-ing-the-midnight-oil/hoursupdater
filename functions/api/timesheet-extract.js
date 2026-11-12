import { runTimesheetReadBody } from '../../office-tracker/src/timesheetExtract.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Attach at least one photo (front or back).' }, 400);
  }

  const result = await runTimesheetReadBody(body, {
    apiKey: context.env.ANTHROPIC_API_KEY,
    model: context.env.ANTHROPIC_MODEL,
    mode: 'genie',
  });
  return json(result.json, result.status);
}
