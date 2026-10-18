// Realtime captions with AssemblyAI Universal-Streaming (v3 WebSocket).
// The server mints a short-lived token; the browser streams 16 kHz PCM16 straight to AssemblyAI
// and gets partial + formatted final turns back (~300 ms latency). The API key never reaches the browser.

const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.pos = 0; this.acc = []; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (; this.pos < ch.length; this.pos += this.ratio) this.acc.push(ch[Math.floor(this.pos)]);
      this.pos -= ch.length;
      if (this.acc.length >= 1600) { // 100 ms
        const out = new Int16Array(this.acc.length); let sum = 0;
        for (let i = 0; i < out.length; i++) { const s = Math.max(-1, Math.min(1, this.acc[i])); sum += s * s; out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
        this.port.postMessage({ pcm: out.buffer, rms: Math.sqrt(sum / out.length) }, [out.buffer]);
        this.acc = [];
      }
    }
    return true;
  }
}
registerProcessor('cs-aai-pcm16', Pcm16);
`;

export interface StreamingOptions {
  getToken: () => Promise<string>;
  language?: string;
  keyterms?: () => string[];
  onText: (text: string, final: boolean) => void;
  onError?: (msg: string) => void;
}

export class AssemblyAIStreaming {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private stopped = false;
  private retry = 0;
  /** 0..1 live level, for UI meters */
  level = 0;
  paused = false;

  constructor(private readonly opts: StreamingOptions) {}

  async start(stream: MediaStream) {
    this.stop();
    this.stopped = false;
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    if (!track) return false;
    const ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    this.ctx = ctx;
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    this.node = new AudioWorkletNode(ctx, 'cs-aai-pcm16');
    this.node.port.onmessage = (e) => {
      const { pcm, rms } = e.data as { pcm: ArrayBuffer; rms: number };
      this.level = Math.min(1, rms * 8);
      if (!this.paused && this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm);
    };
    src.connect(this.node);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(ctx.destination);
    void ctx.resume();
    await this.connect();
    return true;
  }

  private async connect() {
    if (this.stopped) return;
    let token: string;
    try {
      token = await this.opts.getToken();
    } catch (e) {
      this.opts.onError?.((e as Error).message);
      return;
    }
    const english = !this.opts.language || this.opts.language.startsWith('en');
    const u = new URL('wss://streaming.assemblyai.com/v3/ws');
    u.searchParams.set('token', token);
    u.searchParams.set('sample_rate', '16000');
    u.searchParams.set('encoding', 'pcm_s16le');
    u.searchParams.set('format_turns', 'true');
    u.searchParams.set('speech_model', english ? 'universal-streaming-english' : 'universal-streaming-multilingual');
    const terms = (this.opts.keyterms?.() ?? []).filter((t) => t.length <= 50).slice(0, 100);
    if (terms.length) u.searchParams.set('keyterms_prompt', JSON.stringify(terms));
    const ws = new WebSocket(u);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => (this.retry = 0);
    ws.onmessage = (ev) => {
      let m: any;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.type === 'Turn' && m.transcript) {
        const final = !!m.end_of_turn && !!m.turn_is_formatted;
        if (m.end_of_turn && !m.turn_is_formatted) return; // wait for the formatted final
        this.opts.onText(m.transcript, final);
      } else if (m.type === 'Error' || m.error) this.opts.onError?.(m.error ?? 'AssemblyAI streaming error');
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      if (ev.code === 1008 || ev.code === 4001 || ev.code === 3005) this.opts.onError?.(`AssemblyAI streaming closed: ${ev.reason || ev.code}`);
      // sessions are capped and tokens are single-use: reconnect with a fresh token
      const wait = Math.min(15_000, 500 * 2 ** this.retry++);
      setTimeout(() => void this.connect(), wait);
    };
  }

  stop() {
    this.stopped = true;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'Terminate' }));
        ws.close();
      } catch {
        /* closed */
      }
    }
    this.node?.disconnect();
    this.node = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.level = 0;
  }
}
