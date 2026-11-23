import { powerEventsForBuses } from '../../../office-tracker/src/zonarBoard.js';

export async function onRequestGet(context) {
  const buses = new URL(context.request.url).searchParams.get('buses') || '';
  const names = buses
    .split(',')
    .map((bus) => bus.trim())
    .filter(Boolean);
  try {
    const events = await powerEventsForBuses(names, {
      customer: context.env.ZONAR_CUSTOMER,
      username: context.env.ZONAR_USERNAME,
      password: context.env.ZONAR_PASSWORD,
    });
    return new Response(JSON.stringify({ events }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Power On times are not available right now.' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}
