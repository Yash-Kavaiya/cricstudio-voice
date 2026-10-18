// "Talk to the commentator" — AssemblyAI Voice Agent API in the browser.
// One WebSocket does streaming STT (your question), LLM reasoning (with a live-scorecard tool) and TTS (the answer).
// The studio server mints a single-use token; the API key never reaches the browser.

const MIC_WORKLET = `
class Mic24 extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 24000; this.pos = 0; this.acc = []; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (; this.pos < ch.length; this.pos += this.ratio) this.acc.push(ch[Math.floor(this.pos)]);
      this.pos -= ch.length;
      if (this.acc.length >= 2400) {
        const out = new Int16Array(this.acc.length);
        for (let i = 0; i < out.length; i++) { const s = Math.max(-1, Math.min(1, this.acc[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
        this.port.postMessage(out.buffer, [out.buffer]); this.acc = [];
      }
    }
    return true;
  }
}
registerProcessor('cs-mic24', Mic24);
`;

const b64 = (buf: ArrayBuffer) => {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

export type AgentEvent =
  | { kind: 'status'; status: 'idle' | 'connecting' | 'ready' | 'listening' | 'thinking' | 'speaking' | 'error'; error?: string }
  | { kind: 'user'; text: string; final: boolean }
  | { kind: 'agent'; text: string; final: boolean }
  | { kind: 'tool'; name: string }
  | { kind: 'latency'; ms: number };

export interface AgentSession {
  token: string;
  voice: string;
  context: string;
  keyterms: string[];
}

export class VoiceAgent {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private mic: { node: AudioWorkletNode; stream: MediaStream } | null = null;
  private capturing = false;
  private calls: { call_id: string; name: string }[] = [];
  private agentText = '';
  private askedAt = 0;

  constructor(
    private readonly emit: (e: AgentEvent) => void,
    private readonly getContext: () => Promise<string>,
  ) {}

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(session: AgentSession) {
    this.close();
    this.emit({ kind: 'status', status: 'connecting' });
    this.ctx ??= new AudioContext();
    await this.ctx.resume();
    const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${encodeURIComponent(session.token)}`);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              system_prompt:
                'You are the lead commentator of a live cricket broadcast, chatting with a fan between deliveries. Be warm, vivid and quick: one to three spoken sentences. ' +
                'For anything about the score, players, overs, required rate or what just happened, call get_match_state first and use only its facts. Never invent numbers.\n\nMatch at session start:\n' +
                session.context,
              greeting: "You're live with the commentary box! Ask me anything about this match.",
              output: { voice: session.voice || 'charles' },
              input: { keyterms: session.keyterms.slice(0, 100), turn_detection: { vad_threshold: 0.5 } },
              tools: [
                {
                  type: 'function',
                  name: 'get_match_state',
                  description: 'Live scorecard right now: teams, score, overs, batters, bowler, partnership, required rate and the last balls.',
                  parameters: { type: 'object', properties: {}, required: [] },
                },
              ],
            },
          }),
        );
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        if (m.type === 'session.ready') resolve();
        else if (m.type === 'session.error' && !this.connected) reject(new Error(m.message ?? m.code));
        void this.onEvent(m);
      };
      ws.onerror = () => reject(new Error('Voice Agent connection failed'));
      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
          this.emit({ kind: 'status', status: 'idle' });
        }
      };
    });
    this.emit({ kind: 'status', status: 'ready' });
  }

  private send(o: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }

  private play(data: string) {
    const ctx = this.ctx!;
    const bin = atob(data);
    const n = bin.length >> 1;
    const buf = ctx.createBuffer(1, n, 24000);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      if (v >= 32768) v -= 65536;
      d[i] = v / 32768;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const t = Math.max(ctx.currentTime + 0.03, this.next);
    src.start(t);
    this.next = t + buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  private stopAudio() {
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* ended */
      }
    });
    this.sources.clear();
    this.next = 0;
  }

  private async onEvent(m: any) {
    switch (m.type) {
      case 'input.speech.started':
        this.stopAudio(); // barge-in
        this.emit({ kind: 'status', status: 'listening' });
        break;
      case 'transcript.user.delta':
        this.emit({ kind: 'user', text: m.text, final: false });
        break;
      case 'transcript.user':
        this.askedAt = performance.now();
        this.emit({ kind: 'user', text: m.text, final: true });
        this.emit({ kind: 'status', status: 'thinking' });
        break;
      case 'reply.started':
        this.agentText = '';
        break;
      case 'reply.audio':
        if (this.askedAt && performance.now() - this.askedAt > 80) {
          this.emit({ kind: 'latency', ms: Math.round(performance.now() - this.askedAt) });
          this.askedAt = 0;
        }
        this.emit({ kind: 'status', status: 'speaking' });
        this.play(m.data);
        break;
      case 'transcript.agent.delta':
        this.agentText += (this.agentText ? ' ' : '') + m.delta;
        this.emit({ kind: 'agent', text: this.agentText, final: false });
        break;
      case 'transcript.agent':
        this.emit({ kind: 'agent', text: m.text, final: true });
        break;
      case 'tool.call':
        this.calls.push({ call_id: m.call_id, name: m.name });
        this.emit({ kind: 'tool', name: m.name });
        break;
      case 'reply.done':
        if (this.calls.length) {
          const calls = this.calls;
          this.calls = [];
          const context = await this.getContext();
          for (const c of calls) this.send({ type: 'tool.result', call_id: c.call_id, result: JSON.stringify({ scorecard: context }) });
        } else {
          const wait = Math.max(0, (this.next - (this.ctx?.currentTime ?? 0)) * 1000);
          setTimeout(() => this.connected && this.emit({ kind: 'status', status: this.capturing ? 'listening' : 'ready' }), wait);
        }
        break;
      case 'session.error':
        this.emit({ kind: 'status', status: 'error', error: m.message ?? m.code });
        break;
    }
  }

  async startTalking() {
    if (!this.ctx || !this.connected) return;
    if (!this.mic) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      const url = URL.createObjectURL(new Blob([MIC_WORKLET], { type: 'application/javascript' }));
      try {
        await this.ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(this.ctx, 'cs-mic24');
      node.port.onmessage = (e) => this.capturing && this.send({ type: 'input.audio', audio: b64(e.data as ArrayBuffer) });
      this.ctx.createMediaStreamSource(stream).connect(node);
      this.mic = { node, stream };
    }
    this.stopAudio();
    this.capturing = true;
    this.emit({ kind: 'status', status: 'listening' });
  }

  stopTalking() {
    if (!this.capturing) return;
    this.capturing = false;
    // ~1 s of silence lets turn detection close the turn right away
    const silence = new Int16Array(2400).buffer;
    for (let i = 0; i < 10; i++) setTimeout(() => this.send({ type: 'input.audio', audio: b64(silence) }), i * 100);
  }

  /** ask by typing — injected as a user message, then the agent replies out loud */
  ask(text: string) {
    this.askedAt = performance.now();
    this.send({ type: 'conversation.message', role: 'user', content: text });
    this.send({ type: 'reply.create' });
    this.emit({ kind: 'status', status: 'thinking' });
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.send(JSON.stringify({ type: 'session.end' }));
      } catch {
        /* closed */
      }
      setTimeout(() => ws.close(), 300);
    }
    this.stopAudio();
    this.mic?.stream.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.capturing = false;
  }
}
