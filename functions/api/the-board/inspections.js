import { inspectionsToday } from '../../../office-tracker/src/zonarBoard.js';

export async function onRequestGet(context) {
  try {
    const inspections = await inspectionsToday({
      customer: context.env.ZONAR_CUSTOMER,
      username: context.env.ZONAR_USERNAME,
      password: context.env.ZONAR_PASSWORD,
    });
    return new Response(JSON.stringify({ inspections }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Student Checks are not available right now.' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}
