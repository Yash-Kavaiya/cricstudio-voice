// Shared helpers: ESPN's key-less cricket feed + AssemblyAI clients.
export const ESPN_SITE_WEB = 'https://site.web.api.espn.com/apis/site/v2/sports/cricket';
export const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/cricket';
const UA = { accept: 'application/json', 'user-agent': 'CricStudioVoice/1.0' };

export async function getJson(url, init = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, headers: { ...UA, ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

export const stripHtml = (s = '') => String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

export function normalizeBall(x) {
  const o = x.over || {};
  const d = x.dismissal || {};
  const runs = Number(x.scoreValue || 0);
  const type = x.playType?.description || '';
  const wicket = !!d.dismissal;
  return {
    seq: x.sequence,
    over: o.number ? `${o.number - 1}.${o.ball}` : String(o.actual ?? ''),
    overComplete: !!o.complete,
    overRuns: o.runs ?? null,
    innings: x.period,
    inningsText: x.periodText,
    team: x.team?.abbreviation || x.team?.name || '',
    short: x.shortText || '',
    text: stripHtml([x.preText, x.text, x.postText].filter(Boolean).join(' ')),
    runs,
    type,
    four: type === 'four' || (runs === 4 && /four/i.test(x.shortText || '')),
    six: type === 'six' || (runs === 6 && /six/i.test(x.shortText || '')),
    wicket,
    wicketText: wicket ? stripHtml(d.text || d.type || 'OUT') : '',
    batter: x.batsman?.athlete?.displayName || '',
    batterRuns: x.batsman?.totalRuns ?? null,
    batterBalls: x.batsman?.faced ?? null,
    bowler: x.bowler?.athlete?.displayName || '',
    bowlerFigures: x.bowler ? `${x.bowler.wickets}-${x.bowler.conceded} (${x.bowler.overs})` : '',
    score: x.innings ? `${x.innings.runs}/${x.innings.wickets}` : x.homeScore,
    runRate: x.innings?.runRate ?? null,
    target: x.innings?.target || null,
  };
}

export function ballLabel(b) {
  if (b.wicket) return 'W';
  if (b.type === 'wide') return 'wd';
  if (b.type === 'no ball') return 'nb';
  return String(b.runs);
}

function competitor(c) {
  return {
    name: c.team?.displayName || c.team?.name,
    abbr: c.team?.abbreviation,
    logo: c.team?.logo || null,
    score: c.score || '',
    home: c.homeAway === 'home',
  };
}

export async function listMatches() {
  const j = await getJson(`${ESPN_SITE_WEB}/scorepanel`);
  const out = [];
  for (const s of j.scores || []) {
    const league = s.leagues?.[0];
    for (const e of s.events || []) {
      const comp = e.competitions?.[0] || {};
      out.push({
        league: league?.id, leagueName: league?.name || league?.abbreviation || '',
        event: e.id, name: e.name, short: e.shortName,
        state: e.status?.type?.state, status: e.status?.type?.detail || '',
        summary: comp.status?.summary || e.status?.summary || '',
        teams: (comp.competitors || []).map(competitor),
      });
    }
  }
  const rank = { in: 0, pre: 1, post: 2 };
  return out.sort((a, b) => (rank[a.state] ?? 3) - (rank[b.state] ?? 3));
}

export async function matchState(league, event, limit = 18) {
  const [panel, first] = await Promise.all([
    listMatches().catch(() => []),
    getJson(`${ESPN_SITE}/${encodeURIComponent(league)}/playbyplay?event=${encodeURIComponent(event)}&page=1`),
  ]);
  const meta = panel.find((m) => String(m.event) === String(event)) || null;
  const pages = first.commentary?.pageCount || 1;
  let items = [];
  if (pages <= 1) items = first.commentary?.items || [];
  else {
    const last = await getJson(`${ESPN_SITE}/${league}/playbyplay?event=${event}&page=${pages}`);
    items = last.commentary?.items || [];
    if (items.length < limit) {
      const prev = await getJson(`${ESPN_SITE}/${league}/playbyplay?event=${event}&page=${pages - 1}`);
      items = [...(prev.commentary?.items || []), ...items];
    }
  }
  const balls = items.map(normalizeBall).sort((a, b) => a.seq - b.seq).slice(-limit);
  return { league, event, meta, balls, fetchedAt: new Date().toISOString() };
}

// ---------- AssemblyAI ----------
export const AAI_KEY = () => {
  const k = process.env.ASSEMBLYAI_API_KEY;
  if (!k) throw new Error('ASSEMBLYAI_API_KEY is not configured');
  return k;
};

/** Mint a single-use temporary token for the Voice Agent API (STT + LLM + TTS over one WebSocket). */
export async function voiceAgentToken(expires = 300, maxSession = 3600) {
  const u = new URL('https://agents.assemblyai.com/v1/token');
  u.searchParams.set('expires_in_seconds', String(expires));
  u.searchParams.set('max_session_duration_seconds', String(maxSession));
  const r = await fetch(u, { headers: { Authorization: `Bearer ${AAI_KEY()}` } });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).token;
}

/** AssemblyAI LLM Gateway (OpenAI-compatible chat completions) with model fallback. */
export async function llmGateway(messages, { models, max_tokens = 160, temperature = 0.9 } = {}) {
  const list = models || [...new Set([process.env.COMMENTARY_MODEL, 'qwen3.5-4b-32k-fast'].filter(Boolean))];
  let lastErr;
  for (const model of list) {
    try {
      const t0 = Date.now();
      const r = await fetch('https://llm-gateway.assemblyai.com/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: AAI_KEY(), 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens, temperature }),
      });
      if (!r.ok) throw new Error(`${model} ${r.status}`);
      const j = await r.json();
      const text = j.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error(`${model} empty`);
      return { text, model, ms: Date.now() - t0 };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** Server-side text-to-speech through the Voice Agent API. Returns 24 kHz mono PCM16. */
export async function synthesize(text, voice = 'charles') {
  const token = await voiceAgentToken(60, 60);
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${token}`);
    const chunks = [];
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('tts timeout')); }, 25000);
    ws.onopen = () => ws.send(JSON.stringify({
      type: 'session.update',
      session: {
        system_prompt: 'You are a text-to-speech voice for a live cricket broadcast. When given text, speak it exactly as written with lively TV-commentator delivery. Never add, remove or change words.',
        output: { voice },
      },
    }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'session.ready') ws.send(JSON.stringify({ type: 'reply.create', instructions: `Say exactly this and nothing else: ${text}` }));
      else if (m.type === 'reply.audio') chunks.push(Buffer.from(m.data, 'base64'));
      else if (m.type === 'reply.done') { ws.send(JSON.stringify({ type: 'session.end' })); clearTimeout(timer); resolve(Buffer.concat(chunks)); setTimeout(() => { try { ws.close(); } catch {} }, 200); }
      else if (m.type === 'session.error') { clearTimeout(timer); reject(new Error(m.message || m.code || 'session error')); }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('websocket error')); };
  });
}

export function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let s = ''; for await (const c of req) s += c;
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}
export const send = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
