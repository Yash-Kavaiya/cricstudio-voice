// Cuts a live mic into spoken phrases (16 kHz WAV) — used for AssemblyAI async phrase transcription.
// An AudioWorklet reports 20 ms frames; an adaptive energy VAD opens a phrase on speech and closes
// it after a pause (or at a hard cap), then the phrase is resampled to 16 kHz mono 16-bit WAV.

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.n = 0; this.size = Math.round(sampleRate * 0.02); }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      this.buf.push(new Float32Array(ch)); this.n += ch.length;
      if (this.n >= this.size) {
        const out = new Float32Array(this.n); let o = 0;
        for (const b of this.buf) { out.set(b, o); o += b.length; }
        this.port.postMessage(out, [out.buffer]); this.buf = []; this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('cs-stt-tap', Tap);
`;

export interface SegmenterOptions {
  /** silence that closes a phrase */
  hangMs?: number;
  /** force a cut on long monologues so captions keep flowing */
  maxMs?: number;
  /** ignore blips shorter than this */
  minSpeechMs?: number;
}

export class SpeechSegmenter {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private floor = 0.004;
  private frames: Float32Array[] = [];
  private pre: Float32Array[] = []; // ~200 ms of pre-roll so first syllables aren't clipped
  private speaking = false;
  private speechMs = 0;
  private silenceMs = 0;
  private phraseMs = 0;
  /** 0..1 live level, for UI meters */
  level = 0;
  paused = false;

  constructor(
    private readonly onPhrase: (wav: ArrayBuffer, ms: number) => void,
    private readonly opts: SegmenterOptions = {},
  ) {}

  async start(stream: MediaStream) {
    this.stop();
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
    this.src = ctx.createMediaStreamSource(new MediaStream([track]));
    this.node = new AudioWorkletNode(ctx, 'cs-stt-tap');
    this.node.port.onmessage = (e) => this.frame(e.data as Float32Array);
    this.src.connect(this.node);
    // keep the graph pulled without making sound
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(ctx.destination);
    void ctx.resume();
    return true;
  }

  private frame(f: Float32Array) {
    const ms = (f.length / (this.ctx?.sampleRate ?? 48000)) * 1000;
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
    const rms = Math.sqrt(sum / f.length);
    this.level = Math.min(1, rms * 8);
    if (this.paused) {
      this.reset();
      return;
    }
    // adaptive noise floor: falls fast, rises slowly
    this.floor = rms < this.floor ? this.floor * 0.9 + rms * 0.1 : this.floor * 0.999 + rms * 0.001;
    const voiced = rms > Math.max(0.012, this.floor * 3.2);
    const { hangMs = 650, maxMs = 12_000, minSpeechMs = 280 } = this.opts;

    if (!this.speaking) {
      this.pre.push(f);
      if (this.pre.length > 10) this.pre.shift();
      if (voiced) {
        this.speaking = true;
        this.frames = [...this.pre];
        this.pre = [];
        this.speechMs = ms;
        this.silenceMs = 0;
        this.phraseMs = ms * this.frames.length;
      }
      return;
    }
    this.frames.push(f);
    this.phraseMs += ms;
    if (voiced) {
      this.speechMs += ms;
      this.silenceMs = 0;
    } else this.silenceMs += ms;
    if (this.silenceMs >= hangMs || this.phraseMs >= maxMs) {
      const frames = this.frames;
      const speech = this.speechMs;
      const total = this.phraseMs;
      this.reset();
      if (speech >= minSpeechMs) this.onPhrase(encodeWav16k(frames, this.ctx?.sampleRate ?? 48000), total);
    }
  }

  private reset() {
    this.speaking = false;
    this.frames = [];
    this.speechMs = this.silenceMs = this.phraseMs = 0;
  }

  stop() {
    this.reset();
    this.node?.port.close();
    this.src?.disconnect();
    this.node?.disconnect();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.node = null;
    this.src = null;
  }
}

/** Resample float frames to 16 kHz mono PCM16 and wrap in a WAV header. */
export function encodeWav16k(frames: Float32Array[], rate: number): ArrayBuffer {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const ratio = rate / 16000;
  const n = Math.floor(total / ratio);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * 2, true);
  // flatten once, then average each output sample's window (simple anti-aliasing low-pass)
  const all = new Float32Array(total);
  let o = 0;
  for (const f of frames) {
    all.set(f, o);
    o += f.length;
  }
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(total, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += all[j];
    const x = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return buf;
}
