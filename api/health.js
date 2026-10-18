import { send } from './_lib.js';
export default function handler(_req, res) {
  send(res, 200, { ok: true, assemblyai: !!process.env.ASSEMBLYAI_API_KEY, time: new Date().toISOString() });
}
