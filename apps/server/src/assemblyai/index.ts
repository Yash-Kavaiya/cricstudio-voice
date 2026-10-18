// AssemblyAI client — the single voice + language stack for CricStudio Voice.
//  • Voice Agent API  → commentator voice (TTS) and the talk-to-commentator agent
//  • Universal-Streaming (v3) → realtime live captions / voice commands (browser, via temp token)
//  • Async STT (v2) + LLM Gateway → phrase transcription, match recaps, highlights
//  • LLM Gateway      → commentary writer, recaps, translation
// Keys stay on the server. A studio can save its own key; otherwise ASSEMBLYAI_API_KEY is used.
import { DEFAULT_LLM_MODEL } from '@cricstudio/shared';

export const envKey = () => process.env.ASSEMBLYAI_API_KEY?.trim() || '';

const LLM_URL = 'https://llm-gateway.assemblyai.com/v1/chat/completions';

export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }

/** OpenAI-compatible chat completion through AssemblyAI LLM Gateway, with model fallback. */
export async function llm(key: string, messages: ChatMsg[], opts: { model?: string; maxTokens?: number; temperature?: number; timeoutMs?: number } = {}): Promise<{ text: string; model: string; ms: number }> {
  const models = [...new Set([opts.model, DEFAULT_LLM_MODEL].filter(Boolean) as string[])];
  let last: Error | null = null;
  for (const model of models) {
    const t0 = Date.now();
    try {
      const res = await fetch(LLM_URL, {
        method: 'POST',
        headers: { authorization: key, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: opts.maxTokens ?? 200, temperature: opts.temperature ?? 0.8 }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      });
      const j: any = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`LLM Gateway ${res.status}: ${j?.metadata?.errors?.[0] ?? j?.message ?? 'request failed'}`);
      const text = String(j?.choices?.[0]?.message?.content ?? '').replace(/\s+/g, ' ').replace(/^["'“”*]+|["'“”*]+$/g, '').trim();
      if (!text) throw new Error('LLM Gateway returned no text');
      return { text, model, ms: Date.now() - t0 };
    } catch (e) {
      last = e as Error;
      if (/401|Invalid API key/i.test(last.message)) break; // a bad key won't work with another model
    }
  }
  throw last ?? new Error('LLM Gateway failed');
}

/** Single-use token for the Voice Agent API (browser talk-to-commentator). */
export async function voiceAgentToken(key: string, expires = 300, maxSession = 3600): Promise<string> {
  const u = new URL('https://agents.assemblyai.com/v1/token');
  u.searchParams.set('expires_in_seconds', String(expires));
  u.searchParams.set('max_session_duration_seconds', String(maxSession));
  const r = await fetch(u, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(r.status === 401 || r.status === 404 ? 'AssemblyAI API key rejected' : `Voice Agent token ${r.status}`);
  return ((await r.json()) as any).token;
}

/** Temporary token for Universal-Streaming v3 realtime STT (browser captions / voice commands). */
export async function streamingToken(key: string, expires = 600): Promise<string> {
  const r = await fetch(`https://streaming.assemblyai.com/v3/token?expires_in_seconds=${expires}`, { headers: { Authorization: key }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(r.status === 401 ? 'AssemblyAI API key rejected' : `Streaming token ${r.status}`);
  return ((await r.json()) as any).token;
}

function wav(pcm: Buffer, rate = 24000): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * AssemblyAI text-to-speech → 24 kHz mono WAV. Uses the production TTS voices of the Voice Agent API
 * (the standalone TTS-1 endpoint is early access; swap it in here when it is public).
 */
export async function speech(key: string, text: string, voice = 'charles', opts: { excited?: boolean; timeoutMs?: number } = {}): Promise<Buffer> {
  const token = await voiceAgentToken(key, 60, 120);
  return await new Promise<Buffer>((resolve, reject) => {
    const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${encodeURIComponent(token)}`);
    const chunks: Buffer[] = [];
    const done = (err: Error | null, out?: Buffer) => {
      clearTimeout(timer);
      try { ws.send(JSON.stringify({ type: 'session.end' })); } catch { /* closed */ }
      setTimeout(() => { try { ws.close(); } catch { /* closed */ } }, 200);
      err ? reject(err) : resolve(out!);
    };
    const timer = setTimeout(() => done(new Error('AssemblyAI TTS timed out')), opts.timeoutMs ?? 20_000);
    ws.onopen = () => ws.send(JSON.stringify({
      type: 'session.update',
      session: {
        system_prompt: `You are the voice of a live cricket TV broadcast. When given a line, speak exactly that line, word for word, ${opts.excited ? 'with big, excited' : 'with lively'} commentator delivery. Never add, drop or change words and never read instructions aloud.`,
        output: { voice },
      },
    }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.type === 'session.ready') ws.send(JSON.stringify({ type: 'reply.create', instructions: `Say exactly this and nothing else: ${text}` }));
      else if (m.type === 'reply.audio') chunks.push(Buffer.from(m.data, 'base64'));
      else if (m.type === 'reply.done') {
        const pcm = Buffer.concat(chunks);
        pcm.length < 2000 ? done(new Error('AssemblyAI TTS returned no audio')) : done(null, wav(pcm));
      } else if (m.type === 'session.error') done(new Error(`AssemblyAI TTS: ${m.message ?? m.code}`));
    };
    ws.onerror = () => done(new Error('AssemblyAI TTS connection failed'));
  });
}

/** Async (pre-recorded) STT for one phrase or a clip: upload → transcript → poll. */
export async function transcribe(key: string, audio: Buffer, opts: { language?: string; keyterms?: string[]; timeoutMs?: number; extras?: Record<string, unknown> } = {}): Promise<any> {
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  const up = await fetch('https://api.assemblyai.com/v2/upload', { method: 'POST', headers: { authorization: key, 'content-type': 'application/octet-stream' }, body: new Uint8Array(audio), signal: AbortSignal.timeout(15_000) });
  if (!up.ok) throw new Error(up.status === 401 ? 'API key rejected (401)' : `AssemblyAI upload ${up.status}`);
  const { upload_url } = (await up.json()) as any;
  const lang = (opts.language ?? 'en').split('-')[0];
  const body: any = { audio_url: upload_url, speech_models: ['universal-3-5-pro', 'universal-2'], language_code: lang, punctuate: true, format_text: true, ...opts.extras };
  if (opts.keyterms?.length && lang === 'en') body.keyterms_prompt = opts.keyterms.filter((k) => k.length <= 50).slice(0, 100);
  const cr = await fetch('https://api.assemblyai.com/v2/transcript', { method: 'POST', headers: { authorization: key, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  let t: any = await cr.json().catch(() => null);
  if (!cr.ok) throw new Error(`AssemblyAI transcript ${cr.status}: ${t?.error ?? ''}`);
  while (t.status !== 'completed') {
    if (t.status === 'error') throw new Error(`AssemblyAI: ${t.error}`);
    if (Date.now() > deadline) throw new Error('AssemblyAI transcription timed out');
    await new Promise((r) => setTimeout(r, 700));
    t = await (await fetch(`https://api.assemblyai.com/v2/transcript/${t.id}`, { headers: { authorization: key } })).json();
  }
  return t;
}
