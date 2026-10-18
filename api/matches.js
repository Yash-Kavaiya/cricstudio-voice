import { listMatches, send } from './_lib.js';
export default async function handler(_req, res) {
  try { send(res, 200, { matches: await listMatches() }); }
  catch (e) { send(res, 502, { error: String(e.message || e) }); }
}
