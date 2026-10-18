// CricStudio Voice — browser client.
// Score feed -> AssemblyAI LLM Gateway (writes the line) -> AssemblyAI Voice Agent API (speaks it, TTS)
// Viewer's mic -> Voice Agent API streaming STT -> agent answers out loud using a get_match_state tool.
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const label = (b) => (b.wicket ? 'W' : b.type === 'wide' ? 'wd' : b.type === 'no ball' ? 'nb' : String(b.runs));

const state = { source: { demo: true }, meta: null, balls: [], shown: [], running: false, lastSeq: 0, gen: 0 };
const stats = { llm: [], ttfa: [], stt: 0, lines: 0 };

// ---------------- Voice Agent (TTS + STT + LLM over one WebSocket) ----------------
class Commentator {
  constructor() { this.ws = null; this.ctx = null; this.next = 0; this.sources = new Set(); this.busy = false; this.waiters = []; this.toolCalls = []; this.capturing = false; }
  systemPrompt() {
    const m = state.meta;
    return `You are "Ravi", the lead commentator on a live cricket broadcast called CricStudio Voice.
Two kinds of turns happen:
1) Instructions starting with SAY VERBATIM: speak the given commentary text exactly, word for word, with vivid TV-commentator energy. Add nothing.
2) A viewer talks to you through their microphone. Answer like a commentator talking to a fan: warm, quick, 1-3 sentences. ALWAYS call get_match_state first for any question about the score, players, overs or what just happened, and only use facts from it.
Current match: ${m ? `${m.name}${m.summary ? ' — ' + m.summary : ''}` : 'loading'}.`;
  }
  async connect(voice) {
    this.close();
    const { token, error } = await fetch('/api/voice-token').then((r) => r.json());
    if (!token) throw new Error(error || 'no token');
    const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${token}`);
    this.ws = ws;
    await new Promise((resolve, reject) => {
      ws.onopen = () => ws.send(JSON.stringify({ type: 'session.update', session: {
        system_prompt: this.systemPrompt(),
        output: { voice },
        input: { keyterms: keyterms() },
        tools: [{ type: 'function', name: 'get_match_state', description: 'Live scorecard: teams, score, situation, current batter and bowler, and the last balls with ball-by-ball text.', parameters: { type: 'object', properties: {}, required: [] } }],
      } }));
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'session.ready') resolve(); else if (m.type === 'session.error') reject(new Error(m.message || m.code)); this.onEvent(m); };
      ws.onerror = () => reject(new Error('Voice Agent connection failed'));
      ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.setBusy(false); setApi('tts', false); setApi('stt', false); if (state.running) reconnectSoon(); } };
    });
    setApi('tts', true); setApi('stt', true);
  }
  close() { if (this.ws) { const w = this.ws; this.ws = null; try { w.send(JSON.stringify({ type: 'session.end' })); } catch {} setTimeout(() => { try { w.close(); } catch {} }, 300); } }
  send(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }
  updatePrompt() { this.send({ type: 'session.update', session: { system_prompt: this.systemPrompt(), input: { keyterms: keyterms() } } }); }
  setBusy(b) { this.busy = b; if (!b) { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); } }
  idle() { return this.busy ? new Promise((r) => this.waiters.push(r)) : Promise.resolve(); }
  async say(text) {
    await this.idle();
    if (!this.ws) return;
    this.sayStarted = performance.now(); this.firstAudio = true;
    this.setBusy(true);
    this.send({ type: 'reply.create', instructions: `SAY VERBATIM: ${text}` });
    await this.idle();
    await this.drain();
  }
  drain() { const ms = Math.max(0, (this.next - (this.ctx?.currentTime || 0)) * 1000); return sleep(ms); }
  play(b64) {
    const bin = atob(b64); const n = bin.length >> 1; const buf = this.ctx.createBuffer(1, n, 24000); const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v >= 32768) v -= 65536; d[i] = v / 32768; }
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.ctx.destination);
    const t = Math.max(this.ctx.currentTime + 0.03, this.next); src.start(t); this.next = t + buf.duration;
    this.sources.add(src); src.onended = () => this.sources.delete(src);
  }
  stopAudio() { this.sources.forEach((s) => { try { s.stop(); } catch {} }); this.sources.clear(); this.next = 0; }
  onEvent(m) {
    switch (m.type) {
      case 'reply.started': this.setBusy(true); captionStart(); break;
      case 'reply.audio':
        if (this.firstAudio && this.sayStarted) { stats.ttfa.push(performance.now() - this.sayStarted); this.firstAudio = false; renderStats(); }
        this.play(m.data); pulseApi('tts'); break;
      case 'transcript.agent.delta': captionWord(m.delta, m.start_ms); break;
      case 'transcript.agent': if (this.lastUserQ) { addFeed('🎙️ Ravi', m.text, 'q'); this.lastUserQ = false; } break;
      case 'tool.call': this.toolCalls.push(m); break;
      case 'reply.done':
        if (this.toolCalls.length) { const calls = this.toolCalls; this.toolCalls = []; calls.forEach((c) => this.send({ type: 'tool.result', call_id: c.call_id, result: JSON.stringify(matchSnapshot()) })); }
        else this.setBusy(false);
        break;
      case 'input.speech.started': this.stopAudio(); pulseApi('stt'); break;
      case 'transcript.user.delta': userCaption(m.text); pulseApi('stt'); break;
      case 'transcript.user': stats.stt++; addFeed('🗣️ You asked', m.text, 'q'); this.lastUserQ = true; renderStats(); break;
      case 'session.error': console.warn('voice agent', m); break;
    }
  }
  async startMic() {
    if (!this.mic) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      await this.ctx.audioWorklet.addModule('/mic-worklet.js');
      const node = new AudioWorkletNode(this.ctx, 'mic-processor');
      node.port.onmessage = (e) => { if (this.capturing) this.send({ type: 'input.audio', audio: b64(e.data) }); };
      this.ctx.createMediaStreamSource(stream).connect(node);
      this.mic = node;
    }
    this.stopAudio(); this.capturing = true;
  }
  stopMic() {
    this.capturing = false;
    const silence = new Int16Array(2400); // stream ~1s of silence so turn detection closes the turn
    for (let i = 0; i < 10; i++) setTimeout(() => this.send({ type: 'input.audio', audio: b64(silence.buffer) }), i * 100);
  }
}
const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const agent = new Commentator();
let reconnecting = false;
async function reconnectSoon() { if (reconnecting) return; reconnecting = true; await sleep(1500); try { await agent.connect($('#voice').value); } catch (e) { console.warn(e); } reconnecting = false; }

function keyterms() {
  const names = new Set();
  (state.meta?.teams || []).forEach((t) => { names.add(t.name); });
  state.shown.slice(-30).forEach((b) => { b.batter && names.add(b.batter); b.bowler && names.add(b.bowler); });
  return [...names].filter(Boolean).slice(0, 100);
}
function matchSnapshot() {
  const last = state.shown.at(-1) || {};
  return {
    match: state.meta?.name, status: state.meta?.summary || state.meta?.status,
    teams: (state.meta?.teams || []).map((t) => ({ team: t.name, score: t.score })),
    current: { battingTeam: last.team, score: last.score, over: last.over, runRate: last.runRate, target: last.target, batter: `${last.batter} ${last.batterRuns ?? ''} (${last.batterBalls ?? ''})`, bowler: `${last.bowler} ${last.bowlerFigures || ''}` },
    lastBalls: state.shown.slice(-12).map((b) => `${b.over}: ${b.short}${b.wicket ? ' — ' + b.wicketText : ''}${b.text ? ' — ' + b.text : ''}`),
  };
}

// ---------------- UI ----------------
function setApi(k, on) { $(`#api-${k}`).classList.toggle('on', on); }
function pulseApi(k) { const el = $(`#api-${k}`); el.classList.add('on'); }
let capWords = 0;
function captionStart() { const c = $('#caption'); c.className = 'caption speaking'; c.innerHTML = ''; capWords = 0; }
function captionWord(w, startMs) {
  const c = $('#caption'); const span = document.createElement('span'); span.className = 'w'; span.textContent = (capWords++ ? ' ' : '') + w;
  // align caption to audio playback time
  const delay = startMs != null && agent.ctx ? Math.max(0, startMs - 0) : 0; span.style.animationDelay = `${Math.min(delay, 8000)}ms`;
  c.appendChild(span);
}
function userCaption(t) { const c = $('#caption'); c.className = 'caption user'; c.textContent = `“${t}”`; }
function addFeed(who, text, cls = '') {
  const li = document.createElement('li'); li.className = cls; li.innerHTML = `<small>${esc(who)}</small>${esc(text)}`;
  $('#feed').prepend(li); while ($('#feed').children.length > 60) $('#feed').lastChild.remove();
}
function renderStats() {
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : '—');
  $('#stats').textContent = `LLM Gateway avg ${avg(stats.llm)} ms · TTS time-to-first-audio avg ${avg(stats.ttfa)} ms · lines voiced ${stats.lines} · questions heard ${stats.stt}`;
}
function renderBoard(meta, newBall) {
  if (meta) {
    $('#league').textContent = meta.leagueName || meta.short || '';
    $('#teams').innerHTML = (meta.teams || []).map((t) => `<div class="team">${t.logo ? `<img src="${esc(t.logo)}" alt="">` : '<span style="width:40px"></span>'}<span class="n">${esc(t.name)}</span><span class="s">${esc(t.score || 'Yet to bat')}</span></div>`).join('');
  }
  const last = state.shown.at(-1);
  if (last) {
    $('#batter').textContent = last.batter ? `${last.batter} ${last.batterRuns ?? ''}${last.batterBalls != null ? ` (${last.batterBalls})` : ''}` : '—';
    $('#bowler').textContent = last.bowler ? `${last.bowler} ${last.bowlerFigures}` : '—';
    $('#rr').textContent = last.runRate ?? '—';
    if (state.source.demo) {
      // update the chasing side's score live during the replay
      const rows = document.querySelectorAll('.team'); const idx = (meta?.teams || state.meta.teams).findIndex((t) => t.abbr === last.team);
      if (rows[idx]) rows[idx].querySelector('.s').textContent = `${last.score} (${last.over})`;
      const target = last.target || 156; const runs = Number(String(last.score).split('/')[0]);
      const ballsLeft = Math.max(0, 120 - (Math.floor(+last.over) * 6 + Math.round((+last.over % 1) * 10)));
      $('#summary').textContent = runs >= target ? state.meta.summary : `${last.team} need ${target - runs} from ${ballsLeft} balls`;
    } else $('#summary').textContent = meta?.summary || meta?.status || '';
  }
  const recent = state.shown.slice(-12);
  $('#ticker').innerHTML = recent.map((b, i) => {
    const l = label(b); const cls = b.wicket ? 'w' : b.six ? 'r6' : b.four ? 'r4' : /wd|nb/.test(l) ? 'x' : '';
    const sep = i > 0 && recent[i - 1].overComplete ? '<span class="b sep"></span>' : '';
    return `${sep}<span class="b ${cls} ${newBall && i === recent.length - 1 ? 'new' : ''}" title="${esc(b.over + ' ' + b.short)}">${l}</span>`;
  }).join('');
  if (newBall && (newBall.wicket || newBall.four || newBall.six)) {
    const f = $('#flash'); f.textContent = newBall.wicket ? 'WICKET!' : newBall.six ? 'SIX!' : 'FOUR!';
    f.className = `flash show ${newBall.wicket ? 'fw' : newBall.six ? 'f6' : 'f4'}`; setTimeout(() => (f.className = 'flash'), 2600);
  }
}

// ---------------- Commentary pipeline ----------------
const lineCache = new Map();
function writeLine(ball) {
  if (!lineCache.has(ball.seq)) {
    const prior = state.balls.filter((b) => b.seq < ball.seq).slice(-6).map((b) => `${b.over} ${b.short}`);
    lineCache.set(ball.seq, fetch('/api/commentary', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ball, recent: prior, style: $('#style').value, match: { title: state.meta?.name, summary: state.source.demo ? $('#summary').textContent : state.meta?.summary } }) })
      .then((r) => r.json()).then((j) => { if (j.ms) stats.llm.push(j.ms); setApi('llm', j.model !== 'fallback'); return j; })
      .catch(() => ({ line: ball.short })));
  }
  return lineCache.get(ball.seq);
}
async function voiceBall(ball, gen) {
  state.shown.push(ball); renderBoard(null, ball);
  const { line } = await writeLine(ball);
  if (gen !== state.gen) return;
  addFeed(`${ball.over} · ${ball.short}`, line, ball.wicket ? 'w' : ball.six ? 'r6' : ball.four ? 'r4' : '');
  stats.lines++; renderStats();
  await agent.say(line);
}

async function runDemo(gen) {
  const j = await fetch('/sample-match.json').then((r) => r.json());
  state.meta = { ...j.meta, leagueName: 'Demo replay · WBBL' }; state.balls = j.balls; state.shown = [];
  renderBoard({ ...state.meta, teams: state.meta.teams.map((t) => (t.abbr === 'MS-W' ? { ...t, score: '' } : t)) });
  agent.updatePrompt();
  await agent.say(`Welcome to CricStudio Voice! We join the Stars' chase in the final overs here. ${j.balls[0].team} need runs, the Sixers need wickets. Let's go!`);
  for (let i = 0; i < state.balls.length && gen === state.gen; i++) {
    writeLine(state.balls[i]); if (state.balls[i + 1]) writeLine(state.balls[i + 1]); // prefetch
    await voiceBall(state.balls[i], gen);
    await sleep(state.balls[i].overComplete ? 2500 : 900);
  }
  if (gen === state.gen) { $('#summary').textContent = state.meta.summary; await agent.say(`And that's the match! ${state.meta.summary}. What a finish. Hold the button and ask me anything about it.`); }
}

async function runLive(gen) {
  const { league, event } = state.source;
  let first = true;
  while (gen === state.gen) {
    try {
      const j = await fetch(`/api/match?league=${league}&event=${event}`).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      state.meta = j.meta || state.meta; state.balls = j.balls;
      if (first) {
        state.shown = j.balls.slice(0, -1); renderBoard(state.meta); agent.updatePrompt();
        await agent.say(`Welcome to CricStudio Voice, live from ${state.meta?.name || 'the ground'}. ${state.meta?.summary || ''}`);
        state.lastSeq = j.balls.at(-2)?.seq || 0; first = false;
      } else renderBoard(state.meta);
      const fresh = j.balls.filter((b) => b.seq > state.lastSeq).slice(-3);
      for (const b of fresh) { if (gen !== state.gen) return; state.lastSeq = b.seq; await voiceBall(b, gen); }
    } catch (e) { console.warn(e); }
    await sleep(12000);
  }
}

async function start() {
  const btn = $('#start');
  if (state.running) { stop(); return; }
  btn.disabled = true; btn.textContent = 'Connecting to AssemblyAI…';
  try {
    agent.ctx ||= new AudioContext(); await agent.ctx.resume();
    await agent.connect($('#voice').value);
    state.running = true; btn.textContent = '■ Stop'; btn.classList.add('stop'); $('#talk').disabled = false; $('#recap').disabled = false;
    const gen = ++state.gen;
    (state.source.demo ? runDemo(gen) : runLive(gen)).catch((e) => console.warn(e));
  } catch (e) { btn.textContent = '▶ Start commentary'; alert(`Could not start: ${e.message}`); }
  btn.disabled = false;
}
function stop() { state.running = false; state.gen++; agent.stopAudio(); agent.close(); agent.setBusy(false); $('#start').textContent = '▶ Start commentary'; $('#start').classList.remove('stop'); $('#talk').disabled = true; $('#recap').disabled = true; }
async function switchSource(src) {
  const wasRunning = state.running; if (wasRunning) stop();
  state.source = src; state.shown = []; state.lastSeq = 0; lineCache.clear(); $('#feed').innerHTML = '';
  $('#state').textContent = src.demo ? 'DEMO' : src.live ? 'LIVE' : 'MATCH'; $('#state').className = `pill ${src.demo ? 'demo' : ''}`;
  $('#summary').textContent = 'Press Start commentary to go live.'; $('#ticker').innerHTML = '';
  if (!src.demo) { state.meta = src.meta; renderBoard(src.meta); } else { const j = await fetch('/sample-match.json').then((r) => r.json()); state.meta = j.meta; renderBoard(j.meta); }
  if (wasRunning) start();
}

async function loadMatches() {
  try {
    const { matches = [] } = await fetch('/api/matches').then((r) => r.json());
    const groups = {};
    matches.filter((m) => m.state !== 'pre').slice(0, 40).forEach((m) => { (groups[m.leagueName || 'Other'] ||= []).push(m); });
    $('#matches').innerHTML = Object.entries(groups).map(([lg, ms]) => `<div class="league-h">${esc(lg)}</div>` + ms.map((m) =>
      `<button class="match" data-league="${m.league}" data-event="${m.event}"><span class="live-dot ${m.state === 'in' ? '' : 'post-dot'}"></span><div><b>${esc(m.name)}</b><small>${esc(m.teams.map((t) => `${t.abbr} ${t.score}`).join(' · '))}</small><small>${esc(m.summary || m.status)}</small></div></button>`).join('')).join('') || '<p class="muted">No live matches right now — try the demo.</p>';
    document.querySelectorAll('.match[data-event]').forEach((b) => b.onclick = () => {
      document.querySelectorAll('.match').forEach((x) => x.classList.remove('active')); b.classList.add('active');
      const m = matches.find((x) => x.event === b.dataset.event);
      switchSource({ league: b.dataset.league, event: b.dataset.event, meta: m, live: m.state === 'in' });
    });
  } catch { $('#matches').innerHTML = '<p class="muted">Live feed unavailable — the demo still works.</p>'; }
}

// ---------------- wire up ----------------
$('#start').onclick = start;
document.querySelector('.match.demo').onclick = (e) => { document.querySelectorAll('.match').forEach((x) => x.classList.remove('active')); e.currentTarget.classList.add('active'); switchSource({ demo: true }); };
$('#voice').onchange = () => { if (state.running) reconnectSoon(); };
const talk = $('#talk');
const down = async () => { if (talk.disabled || agent.capturing) return; talk.classList.add('rec'); talk.textContent = '🔴 Listening… release when done'; try { await agent.startMic(); } catch (e) { alert('Microphone blocked: ' + e.message); up(); } };
const up = () => { if (!agent.capturing) return; talk.classList.remove('rec'); talk.textContent = '🎙️ Hold to ask the commentator'; agent.stopMic(); };
talk.addEventListener('pointerdown', down); talk.addEventListener('pointerup', up); talk.addEventListener('pointerleave', up);
addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat && e.target === document.body) { e.preventDefault(); down(); } });
addEventListener('keyup', (e) => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); up(); } });
$('#recap').onclick = async () => {
  $('#recap').disabled = true;
  const j = await fetch('/api/recap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ match: { title: state.meta?.name, summary: $('#summary').textContent }, balls: state.shown.slice(-18) }) }).then((r) => r.json());
  if (j.recap) { addFeed('📝 Studio recap', j.recap, 'q'); await agent.say(j.recap); }
  $('#recap').disabled = false;
};
switchSource({ demo: true }); loadMatches(); setInterval(loadMatches, 60000); renderStats();
