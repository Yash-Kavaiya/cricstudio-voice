// Captures mic audio, downsamples to 24 kHz mono PCM16 for AssemblyAI's Voice Agent API.
class MicProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 24000; this.acc = []; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (; this.pos < ch.length; this.pos += this.ratio) this.acc.push(ch[Math.floor(this.pos)]);
    this.pos -= ch.length;
    if (this.acc.length >= 2400) { // 100 ms
      const out = new Int16Array(this.acc.length);
      for (let i = 0; i < out.length; i++) { const s = Math.max(-1, Math.min(1, this.acc[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
      this.port.postMessage(out.buffer, [out.buffer]);
      this.acc = [];
    }
    return true;
  }
}
registerProcessor('mic-processor', MicProcessor);
