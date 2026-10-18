import { synthesize, wav, readBody, send } from './_lib.js';
const VOICES = new Set(['alba','eve','george','jane','jean','mary','michael','anna','charles','paul','vera']);
// GET /api/tts?text=...&voice=charles  -> audio/wav (AssemblyAI TTS via the Voice Agent API)
export default async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const body = req.method === 'POST' ? await readBody(req) : {};
  const text = String(body.text || u.searchParams.get('text') || 'Welcome to CricStudio Voice, live cricket commentary powered by AssemblyAI.').slice(0, 600);
  const v = String(body.voice || u.searchParams.get('voice') || 'charles');
  try {
    const t0 = Date.now();
    const pcm = await synthesize(text, VOICES.has(v) ? v : 'charles');
    res.statusCode = 200;
    res.setHeader('content-type', 'audio/wav');
    res.setHeader('x-tts-ms', String(Date.now() - t0));
    res.end(wav(pcm));
  } catch (e) { send(res, 502, { error: String(e.message || e) }); }
}
