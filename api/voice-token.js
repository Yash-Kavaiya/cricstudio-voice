import { voiceAgentToken, send } from './_lib.js';
// Browser never sees the API key: it gets a single-use, short-lived Voice Agent token.
export default async function handler(_req, res) {
  try { send(res, 200, { token: await voiceAgentToken(300, 3600) }); }
  catch (e) { send(res, 500, { error: String(e.message || e) }); }
}
