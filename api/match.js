import { matchState, send } from './_lib.js';
export default async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const league = u.searchParams.get('league'), event = u.searchParams.get('event');
  if (!league || !event) return send(res, 400, { error: 'league and event are required' });
  try { send(res, 200, await matchState(league, event)); }
  catch (e) { send(res, 502, { error: String(e.message || e) }); }
}
