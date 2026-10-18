import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'socket.io';
import { AAI_VOICES, BACKGROUNDS, DEFAULT_LLM_MODEL, EDGE_LANG_VOICES, SCENE_IDS, type LiveStatus, type AiCommentaryStatus, type ChatMessage, type CommentaryLine, type CricketEvent, type MatchDetail, type MatchListItem, type Participant, type StudioState, type SttProvider, type Suggestion } from '@cricstudio/shared';
import { aaiCommentary, aaiRecap, aaiSpeech, eventFacts, matchFacts } from '../commentary/ai';
import { envKey, llm, streamingToken, voiceAgentToken } from '../assemblyai';
import { AutomationEngine } from '../automation/rules';
import { Commentator } from '../commentary/commentator';
import { translateLine } from '../commentary/translate';
import { config } from '../config';
import { DEMO_KEY } from '../espn/demo';
import type { MatchHub } from '../espn/hub';
import { decrypt, encrypt } from '../store/crypto';
import { CLOUD_STT, cricketHints, silentWav, transcribeWith, type CloudStt } from '../stt/providers';
import type { Repo, StudioRecord } from '../store/repo';
import type { Bus } from '../bus';
import { LivePipeline, type StreamTarget } from '../stream/pipeline';
import { CloudProducer, findChrome } from '../worker/cloudProducer';

const LEASE_TTL_MS = 20_000;
const PERSISTED = ['scene', 'baseScene', 'automation', 'rules', 'music', 'brand', 'countdownTo', 'announcement', 'banner', 'spotlightId', 'autopilot', 'wantLive', 'stt'] as const;

export function defaultState(rec: StudioRecord): StudioState {
  return {
    id: rec.id,
    name: rec.name,
    matchKey: rec.matchKey,
    participants: [],
    scene: 'startingSoon',
    baseScene: 'startingSoon',
    sceneUntil: null,
    overlay: null,
    automation: 'auto',
    rules: {
      wicket: true,
      boundary: true,
      overEnd: true,
      milestones: true,
      inningsBreak: true,
      idleRotation: true,
      idleSeconds: 75,
    },
    pinnedUntil: 0,
    live: { state: 'idle', mode: 'mesh', destinations: [] },
    music: { track: 'stadium-anthem', playing: false, volume: 0.35, duck: true, ambience: { on: false, volume: 0.3, mood: 'buzzing' } },
    brand: {
      title: rec.name,
      ticker: 'Welcome to the live cricket show! Drop your predictions in the chat 🏏',
      accent: '#1a73e8',
      showScorebug: true,
      showTicker: true,
      captions: false,
      sfx: true,
      sfxVolume: 0.8,
      background: 'assemblyai',
      transition: 'mixed',
      fx3d: true,
      pollQuestion: 'Who wins this match? Vote in the comments!',
      camBubbles: false,
      camBubbleCorner: 'br',
      camBubbleSize: 220,
    },
    countdownTo: null,
    spotlightId: null,
    autopilot: {
      enabled: false,
      sceneSeconds: 45,
      scoreShare: 0.7,
      includeCameras: false,
      commentator: true,
      voice: config.ttsVoice,
      chatterSeconds: 35,
      autoMusic: true,
      autoMatch: false,
      cloud: false,
      writer: envKey() ? 'assemblyai' : 'templates',
      voiceEngine: envKey() ? 'assemblyai' : 'edge',
      aaiVoice: 'charles',
      llmModel: process.env.COMMENTARY_MODEL || DEFAULT_LLM_MODEL,
      commentaryLanguage: 'en-IN',
    },
    stt: { provider: envKey() ? 'assemblyai' : 'browser', language: 'en-IN', llmModel: process.env.COMMENTARY_MODEL || DEFAULT_LLM_MODEL, configured: { assemblyai: !!envKey() } },
    transition: 'fadeZoom',
    wantLive: false,
  };
}

/** prefer international cricket, then major T20 leagues, then everything else */
function matchRank(m: MatchListItem): number {
  const t = `${m.leagueName} ${m.description}`.toLowerCase();
  let r = m.state === 'in' ? 1000 : m.state === 'pre' ? 0 : -1000;
  if (/world cup|champions trophy|asia cup|tour of|test|odi|t20i/.test(t)) r += 300;
  if (/premier league|ipl|big bash|psl|caribbean|sa20|hundred|major league|ilt20|wpl/.test(t)) r += 200;
  if (/women/.test(t)) r += 20;
  if (m.teams.some((x) => x.score)) r += 10;
  return r;
}

export class StudioRoom {
  state: StudioState;
  automation: AutomationEngine;
  commentator: Commentator;
  chat: ChatMessage[] = [];
  pipeline: LivePipeline | null = null;
  cloud: CloudProducer | null = null;
  producerId: string | null = null; // cloud producer socket
  hostLeftTimer: NodeJS.Timeout | null = null;
  private unsubMatch: (() => void) | null = null;
  private emitQueued = false;
  private persistTimer: NodeJS.Timeout | null = null;
  private autoMatchTimer: NodeJS.Timeout;
  private postSince = 0;
  latestMatch: MatchDetail | null = null;
  private leaseTimer: NodeJS.Timeout | null = null;
  /** encrypted speech-to-text API keys (never broadcast) */
  private sttKeys: Partial<Record<CloudStt, string>> = {};

  constructor(
    readonly record: StudioRecord,
    private readonly io: Server,
    private readonly hub: MatchHub,
    private readonly repo: Repo,
    private readonly bus: Bus,
  ) {
    const base = defaultState(record);
    let saved: Partial<StudioState> = {};
    try {
      saved = JSON.parse(record.settings || '{}');
    } catch {
      /* ignore */
    }
    this.state = {
      ...base,
      ...Object.fromEntries(PERSISTED.filter((k) => saved[k] !== undefined).map((k) => [k, saved[k]])),
      rules: { ...base.rules, ...(saved.rules ?? {}) },
      brand: { ...base.brand, ...(saved.brand ?? {}), ...(BACKGROUNDS.some((x) => x.id === saved.brand?.background) ? {} : { background: base.brand.background }) },
      music: { ...base.music, ...(saved.music ?? {}), playing: false },
      // studios saved with the old 8 s default move to the new 45 s default
      autopilot: { ...base.autopilot, ...(saved.autopilot ?? {}), ...(saved.autopilot?.sceneSeconds === 8 ? { sceneSeconds: 45 } : {}) },
      stt: { ...base.stt, ...(saved.stt ?? {}) },
    };
    // speech-to-text API keys: encrypted at rest, kept out of the broadcast state
    const savedKeys = ((saved as { sttKeys?: Partial<Record<CloudStt, string>> }).sttKeys ?? {}) as Partial<Record<CloudStt, string>>;
    for (const p of CLOUD_STT) if (typeof savedKeys[p] === 'string' && savedKeys[p]) this.sttKeys[p] = savedKeys[p];
    migrateLegacyAi(this.state);
    this.state.stt.configured = { assemblyai: !!this.sttKey('assemblyai') };
    this.state.sceneUntil = null;
    if (this.state.scene !== this.state.baseScene) this.state.scene = this.state.baseScene;
    this.automation = new AutomationEngine({
      state: () => this.state,
      commit: () => this.commit(),
      suggest: (s) => this.suggest(s),
      match: () => this.latestMatch,
    });
    this.commentator = new Commentator({
      enabled: () => this.state.autopilot.commentator && (this.state.autopilot.enabled || this.isLive),
      voice: () => this.state.autopilot.voice,
      chatterSeconds: () => this.state.autopilot.chatterSeconds,
      match: () => this.latestMatch,
      poll: () => this.state.brand.pollQuestion,
      countdownTo: () => this.state.countdownTo,
      emit: (line) => this.speak(line),
      write: (ev, fallback, recent) => this.writeLine(ev, fallback, recent),
    });
    this.autoMatchTimer = setInterval(() => void this.autoMatch(), 60_000);
    this.autoMatchTimer.unref?.();
    if (record.matchKey) this.setMatch(record.matchKey);
  }

  get roomName() {
    return `studio:${this.state.id}`;
  }

  get host(): Participant | undefined {
    return this.state.participants.find((p) => p.role === 'host');
  }

  get isLive() {
    return !!this.pipeline?.running;
  }

  guests(): Participant[] {
    return this.state.participants.filter((p) => p.role === 'guest');
  }

  setMatch(key: string | null) {
    this.unsubMatch?.();
    this.unsubMatch = null;
    this.latestMatch = null;
    this.postSince = 0;
    this.state.matchKey = key;
    this.automation.refreshPlaylist();
    if (key) {
      let first = true;
      this.unsubMatch = this.hub.subscribe(key, ({ detail, events }) => {
        this.latestMatch = detail;
        this.io.to(this.roomName).emit('match:update', detail);
        if (first) {
          first = false;
          if (this.state.autopilot.enabled) this.commentator.intro(detail, this.state.brand.title);
        }
        if (events.length) {
          this.io.to(this.roomName).emit('match:events', events);
          this.automation.onEvents(events);
          this.commentator.onEvents(events);
        }
      });
    }
    void this.repo.updateStudio(this.state.id, { matchKey: key });
    this.commit();
  }

  /** 24/7: keep a live match on air; fall back to the demo replay when nothing is live. */
  async autoMatch(force = false) {
    const ap = this.state.autopilot;
    if (!ap.enabled || !ap.autoMatch) return;
    const cur = this.latestMatch;
    if (cur?.state === 'post') this.postSince ||= Date.now();
    const curDone = !!cur && cur.state === 'post' && Date.now() - this.postSince > 10 * 60_000;
    // a match the host picked stays on air (and in the commentary) until it is over, even before the first ball
    const curIdle = !this.state.matchKey || this.state.matchKey === DEMO_KEY;
    if (!force && !curDone && !curIdle) return;
    const list = (await this.hub.listMatches()).filter((m) => !m.isDemo);
    const best = list.filter((m) => m.state === 'in').sort((a, b) => matchRank(b) - matchRank(a))[0];
    const key = best ? `${best.leagueId}:${best.id}` : DEMO_KEY;
    if (key !== this.state.matchKey) {
      this.setMatch(key);
      const text = best ? `We're heading over to ${best.name}. ${best.statusText}.` : 'No live matches right now, so here is a classic replay.';
      void this.localize(text).then((l) => this.speakText(l.text, 2, l.lang));
    }
  }

  /* ---------------- commentary ---------------- */

  /**
   * Language the commentary is actually spoken in. Edge has no Punjabi voice, so Punjabi is
   * commentated in Hindi (AssemblyAI voices speak English and European languages).
   */
  private spokenLang(): string {
    const ap = this.state.autopilot;
    const lang = ap.commentaryLanguage ?? 'en-IN';
    if (lang.startsWith('en') || EDGE_LANG_VOICES[lang]) return lang;
    return 'hi-IN';
  }

  /** An English template/system line in the commentary language (free translation; English if it fails). */
  private async localize(text: string): Promise<{ text: string; lang: string }> {
    const lang = this.spokenLang();
    if (lang.startsWith('en')) return { text, lang };
    const out = await translateLine(text, lang, 5000, this.sttKey('assemblyai') ?? undefined);
    return out ? { text: out, lang } : { text, lang: 'en-IN' };
  }

  /** LLM Gateway rewrite of a commentary moment, or the template line translated into the commentary language. */
  private async writeLine(ev: CricketEvent | null, fallback: string, recent: string[]): Promise<{ text: string; ai: boolean; lang: string }> {
    const r = await this.writeAi(ev, fallback, recent);
    if (r.ai) return { ...r, lang: this.spokenLang() };
    return { ...(await this.localize(fallback)), ai: false };
  }

  /** LLM Gateway rewrite of a commentary moment; resolves to the template line whenever AI is off or failing. */
  private async writeAi(ev: CricketEvent | null, fallback: string, recent: string[]): Promise<{ text: string; ai: boolean }> {
    const ap = this.state.autopilot;
    if (ap.writer !== 'assemblyai') return { text: fallback, ai: false };
    if (Date.now() < this.llmDownUntil) return { text: fallback, ai: false }; // cooling off after a failure
    const key = this.sttKey('assemblyai');
    if (!key) {
      this.setAiStatus({ writer: 'fallback', error: 'AssemblyAI writer selected but no AssemblyAI API key is available' });
      return { text: fallback, ai: false };
    }
    try {
      const text = await aaiCommentary({
        key,
        model: this.llmModel(),
        language: this.spokenLang(),
        facts: matchFacts(this.latestMatch, this.state.countdownTo),
        event: eventFacts(ev, this.latestMatch),
        fallback,
        recent,
      });
      this.setAiStatus({ writer: 'assemblyai', error: undefined });
      return { text, ai: true };
    } catch (e) {
      this.llmDownUntil = Date.now() + 30_000; // don't make every line wait on a failing API
      this.setAiStatus({ writer: 'fallback', error: (e as Error).message });
      return { text: fallback, ai: false };
    }
  }

  private llmDownUntil = 0;
  private ttsDownUntil = 0;

  private llmModel() {
    return this.state.autopilot.llmModel || this.state.stt.llmModel || DEFAULT_LLM_MODEL;
  }

  /** AssemblyAI key for this studio (saved studio key, else ASSEMBLYAI_API_KEY). Never sent to browsers. */
  aaiKey(): string | null {
    return this.sttKey('assemblyai');
  }

  private setAiStatus(p: Partial<AiCommentaryStatus>) {
    const ap = this.state.autopilot;
    const base: AiCommentaryStatus = this.state.aiStatus ?? { writer: ap.writer === 'assemblyai' ? 'assemblyai' : 'templates', voice: ap.voiceEngine === 'assemblyai' ? 'assemblyai' : 'edge' };
    const next = { ...base, ...p };
    if (JSON.stringify(next) === JSON.stringify(this.state.aiStatus)) return;
    this.state.aiStatus = next;
    this.commit();
  }

  /** recent lines (id -> line + AssemblyAI audio) so 'commentary:tts' can only voice what the commentator said */
  private lines = new Map<string, { line: CommentaryLine; audio?: Promise<Buffer> }>();

  private speak(lineIn: CommentaryLine) {
    const ap = this.state.autopilot;
    // commentator lines carry the language they were written/translated in; anything else is English
    const lang = lineIn.lang ?? (lineIn.ai ? this.spokenLang() : 'en-IN');
    const edgeVoice = lang.startsWith('en') ? ap.voice : (EDGE_LANG_VOICES[lang] ?? ap.voice);
    const aaiOk = ap.voiceEngine === 'assemblyai' && !!this.sttKey('assemblyai') && Date.now() >= this.ttsDownUntil && lang.startsWith('en');
    if (ap.voiceEngine === 'assemblyai' && !this.sttKey('assemblyai')) this.setAiStatus({ voice: 'fallback', error: 'AssemblyAI voice selected but no AssemblyAI API key is available' });
    const line: CommentaryLine = { ...lineIn, lang, voice: edgeVoice, engine: aaiOk ? 'assemblyai' : 'edge' };
    const entry: { line: CommentaryLine; audio?: Promise<Buffer> } = { line };
    if (aaiOk) {
      // start synthesis now so the audio is ready (or nearly) when the program page asks for it
      entry.audio = aaiSpeech({
        key: this.sttKey('assemblyai')!,
        text: line.text,
        voice: AAI_VOICES.some((v) => v.id === ap.aaiVoice) ? ap.aaiVoice! : 'charles',
        excited: line.priority >= 2,
      });
      entry.audio.then(
        () => this.setAiStatus({ voice: 'assemblyai' }),
        (e: Error) => {
          this.ttsDownUntil = Date.now() + 30_000;
          this.setAiStatus({ voice: 'fallback', error: e.message });
        },
      );
    }
    this.lines.set(line.id, entry);
    while (this.lines.size > 20) this.lines.delete(this.lines.keys().next().value!);
    this.io.to(this.roomName).emit('commentary:say', line);
    this.io.to(this.roomName).emit('captions:text', { from: 'AI Commentator', text: line.text, final: true, ts: Date.now() });
  }

  /** Host-typed announcement read out by the commentary voice, in the commentary language — even when the AI commentator is off. */
  announce(text: string) {
    void this.localize(text).then((l) => this.speak({ id: `a${Date.now()}`, text: l.text, voice: this.state.autopilot.voice, priority: 4, ts: Date.now(), lang: l.lang }));
  }

  speakText(text: string, priority = 2, lang?: string) {
    if (!this.state.autopilot.commentator) return;
    this.speak({ id: `m${Date.now()}`, text, voice: this.state.autopilot.voice, priority, ts: Date.now(), lang });
  }

  /** AssemblyAI audio for a line this room spoke (WAV), or null -> client uses the Edge fallback voice. */
  async ttsLine(id: string): Promise<Buffer | null> {
    const e = this.lines.get(id);
    if (!e?.audio) return null;
    try {
      return await e.audio;
    } catch {
      return null;
    }
  }

  /** Check the AI commentary setup end-to-end with a sample line. */
  async testCommentary(): Promise<{ text: string; ai: boolean; lang?: string; writerError?: string; voiceOk?: boolean; voiceError?: string; audio?: Buffer }> {
    const ap = this.state.autopilot;
    const fallback = 'What a shot! That races away to the boundary for four.';
    const out: { text: string; ai: boolean; lang?: string; writerError?: string; voiceOk?: boolean; voiceError?: string; audio?: Buffer } = { text: fallback, ai: false };
    if (ap.writer === 'assemblyai') {
      const key = this.sttKey('assemblyai');
      if (!key) out.writerError = 'No AssemblyAI API key available';
      else
        try {
          out.text = await aaiCommentary({ key, model: this.llmModel(), language: this.spokenLang(), facts: matchFacts(this.latestMatch), event: 'A cracking boundary just now.', fallback, recent: [] });
          out.ai = true;
        } catch (e) {
          out.writerError = (e as Error).message;
        }
    }
    let lang = out.ai ? this.spokenLang() : 'en-IN';
    if (!out.ai) ({ text: out.text, lang } = await this.localize(out.text));
    out.lang = lang;
    if (ap.voiceEngine === 'assemblyai') {
      const key = this.sttKey('assemblyai');
      if (!key) out.voiceError = 'No AssemblyAI API key available';
      else
        try {
          out.audio = await aaiSpeech({ key, text: out.text, voice: ap.aaiVoice ?? 'charles', excited: true });
          out.voiceOk = true;
        } catch (e) {
          out.voiceError = (e as Error).message;
        }
    }
    return out;
  }

  /* ---------------- live pipeline ---------------- */

  private internalWebUrl() {
    if (config.internalWebUrl) return config.internalWebUrl;
    // production serves the built UI itself; in development the Vite dev server has the latest code
    return process.env.NODE_ENV === 'production' && existsSync(config.webDist) ? `http://127.0.0.1:${config.port}` : config.publicUrl;
  }

  /** socket that must produce the WebM feed right now */
  producerSocket(): string | undefined {
    if (!this.pipeline) return undefined;
    return this.state.live.broadcaster === 'cloud' ? this.producerId ?? undefined : this.host?.id;
  }

  async loadTargets(): Promise<StreamTarget[]> {
    const dests = (await this.repo.listDestinations(this.state.id)).filter((d) => d.enabled);
    return dests.map((d) => ({ id: d.id, platform: d.platform, name: d.name, url: d.url, key: decrypt(d.keyEnc) }));
  }

  async startLive(broadcaster: 'host' | 'cloud'): Promise<{ ok: boolean; error?: string }> {
    if (this.pipeline?.running) return { ok: false, error: 'Already live' };
    if (config.streamingDisabled) {
      return {
        ok: false,
        error:
          'Live streaming is off on this hosted site: Vercel cuts every connection after ~5 minutes, which ends YouTube streams. ' +
          'Run CricStudio on your PC (npm run dev) and go live from http://localhost:5180.',
      };
    }
    const targets = await this.loadTargets();
    if (!targets.length) return { ok: false, error: 'Add and enable at least one destination (YouTube, Facebook, X, Twitch…).' };
    if (broadcaster === 'cloud' && !findChrome()) return { ok: false, error: 'Cloud producer needs Chrome/Chromium on the server (set CHROME_PATH).' };
    // one encoder per studio across all server instances — two would fight over the same stream keys
    if (!(await this.bus.tryLock(this.leaseKey, LEASE_TTL_MS))) {
      return { ok: false, error: 'This studio is already streaming from another server instance. Try again in ~20 seconds.' };
    }
    this.startLease();
    const p = new LivePipeline(this.state.id, targets, broadcaster);
    this.pipeline = p;
    let lastLogged = '';
    p.on('status', (s: LiveStatus) => {
      if (this.pipeline !== p) return;
      const sig = `${s.state}|${s.error ?? ''}|${s.destinations.map((d) => `${d.name}:${d.state}:${d.error ?? ''}`).join(',')}`;
      if (sig !== lastLogged) {
        lastLogged = sig;
        this.streamLog(`status ${s.state}${s.error ? ` · ${s.error}` : ''} · fps=${s.fps ?? '-'} speed=${s.speed ?? '-'} · ${s.destinations.map((d) => `${d.name}=${d.state}${d.error ? ` (${d.error})` : ''}`).join(', ')}`);
      }
      this.state.live = { ...s, mode: 'mesh', broadcaster: this.state.live.broadcaster ?? broadcaster };
      this.commit();
    });
    p.on('needRestart', () => {
      const id = this.producerSocket();
      if (id) this.io.to(id).emit('stream:restart');
    });
    p.on('log', (line: string) => this.logToHost(line));
    this.state.live = { ...this.state.live, broadcaster };
    p.start();
    this.state.wantLive = true;
    if (broadcaster === 'cloud') {
      this.state.autopilot = { ...this.state.autopilot, enabled: true, cloud: true };
      await this.ensureCloud();
    }
    this.commit();
    void this.persist();
    return { ok: true };
  }

  async ensureCloud() {
    if (this.cloud?.running) return;
    const web = this.internalWebUrl();
    // connect the producer's socket straight to this server (never through a dev proxy) — it carries ~6 Mbps
    const api = `http://127.0.0.1:${config.port}`;
    const url = `${web}/program/${this.state.id}?k=${encodeURIComponent(config.workerSecret)}&producer=1${web.startsWith(api) ? '' : `&api=${encodeURIComponent(api)}`}`;
    const c = new CloudProducer(this.state.id, url);
    this.cloud = c;
    c.on('log', (l: string) => this.logToHost(l));
    c.on('error', (e: Error) => {
      this.state.live = { ...this.state.live, state: 'error', error: e.message };
      this.commit();
    });
    await c.start();
  }

  /** producer (cloud page) connected → tell it to start recording if we're live */
  onProducerJoined(socketId: string) {
    this.producerId = socketId;
    if (this.pipeline?.running && this.state.live.broadcaster === 'cloud') this.io.to(socketId).emit('producer:start');
  }

  /** host browser dropped while it was the producer → hand the show to the cloud */
  scheduleFailover() {
    if (!this.pipeline?.running || this.state.live.broadcaster !== 'host') return;
    if (this.hostLeftTimer) clearTimeout(this.hostLeftTimer);
    this.hostLeftTimer = setTimeout(async () => {
      this.hostLeftTimer = null;
      if (this.host || !this.pipeline?.running) return;
      if (!findChrome()) {
        this.logToHost('Host disconnected and no cloud producer is available — stream paused.');
        return;
      }
      this.state.live = { ...this.state.live, broadcaster: 'cloud' };
      this.state.autopilot = { ...this.state.autopilot, enabled: true };
      this.commit();
      await this.ensureCloud();
    }, config.hostFailoverMs);
  }

  private get leaseKey() {
    return `cs:live:${this.state.id}`;
  }

  /** Renew the live lease; if another instance took it, stop our copy of the stream. */
  private startLease() {
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    this.leaseTimer = setInterval(async () => {
      if (!this.pipeline?.running) return;
      const ok = await this.bus.tryLock(this.leaseKey, LEASE_TTL_MS).catch(() => true);
      if (ok) return;
      this.logToHost('Another server instance took over this live stream — stopping the duplicate here.');
      this.stopLease();
      this.pipeline?.stop();
      this.pipeline = null;
      await this.cloud?.stop();
      this.cloud = null;
    }, 5000);
    this.leaseTimer.unref?.();
  }

  private stopLease() {
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    this.leaseTimer = null;
    void this.bus.release(this.leaseKey).catch(() => undefined);
  }

  /** Server instance shutting down: stop cleanly but keep `wantLive` so the next instance resumes. */
  async suspendLive() {
    if (!this.pipeline?.running) return;
    this.pipeline.stop();
    this.pipeline = null;
    await this.cloud?.stop();
    this.cloud = null;
    this.stopLease();
    await this.persist();
  }

  async stopLive() {
    this.streamLog('stop requested (End broadcast)');
    this.state.wantLive = false;
    this.stopLease();
    this.pipeline?.stop();
    this.pipeline = null;
    await this.cloud?.stop();
    this.cloud = null;
    const id = this.producerId;
    if (id) this.io.to(id).emit('producer:stop');
    this.state.live = {
      ...this.state.live,
      state: 'idle',
      startedAt: undefined,
      error: undefined,
      destinations: this.state.live.destinations.map((d) => ({ ...d, state: 'idle' })),
    };
    this.commit();
    void this.persist();
  }

  private logToHost(line: string) {
    this.streamLog(line);
    const h = this.host;
    if (h) this.io.to(h.id).emit('stream:log', line);
  }

  /** Append to data/logs/stream-<id>.log (kept small) so a stopped stream can always be diagnosed later. */
  streamLog(line: string) {
    try {
      const dir = resolve(config.dataDir, 'logs');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const file = resolve(dir, `stream-${this.state.id}.log`);
      if (existsSync(file) && statSync(file).size > 2_000_000) renameSync(file, `${file}.1`);
      appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    } catch {
      /* logging must never break streaming */
    }
  }

  /** Host browser (re)joined: if the show should be live from this browser, restart the encoder and ask it to send again. */
  async resumeHostStream(socketId: string) {
    if (!this.state.wantLive || this.pipeline?.running) return;
    if ((this.state.live.broadcaster ?? 'host') !== 'host') return;
    const res = await this.startLive('host');
    this.streamLog(`host rejoined → resume live: ${res.ok ? 'ok' : res.error}`);
    if (res.ok) this.io.to(socketId).emit('producer:start');
  }

  /* ---------------- state sync ---------------- */

  /** Coalesce state broadcasts to one per tick. */
  commit() {
    if (!this.emitQueued) {
      this.emitQueued = true;
      queueMicrotask(() => {
        this.emitQueued = false;
        this.io.to(this.roomName).emit('studio:state', this.state);
      });
    }
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persist(), 1500);
  }

  /* ---------------- speech-to-text (live captions) ---------------- */

  /** Update provider/language/model and save or clear API keys (null/'' clears). */
  setStt(p: { provider?: SttProvider; language?: string; llmModel?: string; keys?: Partial<Record<CloudStt, string | null>> }) {
    const stt = { ...this.state.stt };
    if (p.provider && (p.provider === 'browser' || CLOUD_STT.includes(p.provider))) stt.provider = p.provider;
    if (typeof p.language === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(p.language)) stt.language = p.language;
    if (typeof p.llmModel === 'string' && /^[\w.\-/]{3,80}$/.test(p.llmModel.trim())) stt.llmModel = p.llmModel.trim();
    for (const k of CLOUD_STT) {
      const v = p.keys?.[k];
      if (v === undefined) continue;
      if (v === null || !String(v).trim()) delete this.sttKeys[k];
      else this.sttKeys[k] = encrypt(String(v).trim().slice(0, 400));
    }
    this.state.stt = stt;
    stt.configured = { assemblyai: !!this.sttKey('assemblyai') };
    this.state.aiStatus = undefined; // keys changed: let the AI commentary status re-evaluate
    this.llmDownUntil = this.ttsDownUntil = 0;
    this.commit();
    void this.persist();
    return stt;
  }

  private sttKey(p: CloudStt): string | null {
    try {
      return this.sttKeys[p] ? decrypt(this.sttKeys[p]!) : envKey() || null;
    } catch {
      return envKey() || null; // secret rotated
    }
  }

  /** Chosen provider first, then any other provider with a key. Throws when every cloud engine fails. */
  async transcribe(wav: Buffer): Promise<{ text: string; provider: CloudStt }> {
    const stt = this.state.stt;
    const order = [stt.provider, ...CLOUD_STT].filter((p, i, a): p is CloudStt => p !== 'browser' && a.indexOf(p) === i);
    const hints = cricketHints(this.latestMatch);
    let lastErr: Error | null = null;
    for (const p of order) {
      const key = this.sttKey(p);
      if (!key) continue;
      try {
        return { text: await transcribeWith(p, { wav, language: stt.language, key, hints }), provider: p };
      } catch (e) {
        lastErr = e as Error;
        console.warn(`[stt] ${p} failed: ${lastErr.message}`);
      }
    }
    throw lastErr ?? new Error('No AssemblyAI API key available');
  }

  /** Check a key (the saved one when `key` is omitted) with half a second of silence. */
  async testStt(p: CloudStt, key?: string): Promise<{ ok: boolean; error?: string; ms: number }> {
    const k = key?.trim() || this.sttKey(p);
    const t0 = Date.now();
    if (!k) return { ok: false, error: 'No API key saved', ms: 0 };
    try {
      await transcribeWith(p, { wav: silentWav(), language: this.state.stt.language, key: k, hints: [] });
      return { ok: true, ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: (e as Error).message, ms: Date.now() - t0 };
    }
  }

  /* ---------------- AssemblyAI extras ---------------- */

  /** Temporary token for Universal-Streaming realtime captions / voice commands. */
  async sttToken(): Promise<string> {
    const k = this.aaiKey();
    if (!k) throw new Error('No AssemblyAI API key available');
    return streamingToken(k);
  }

  /** Single-use Voice Agent token + live context for the talk-to-commentator agent. */
  async agentSession(): Promise<{ token: string; voice: string; context: string; keyterms: string[] }> {
    const k = this.aaiKey();
    if (!k) throw new Error('No AssemblyAI API key available');
    return {
      token: await voiceAgentToken(k),
      voice: this.state.autopilot.aaiVoice ?? 'charles',
      context: matchFacts(this.latestMatch, this.state.countdownTo),
      keyterms: cricketHints(this.latestMatch).slice(0, 100),
    };
  }

  /** Live scorecard facts for agent tool calls. */
  matchContext(): string {
    return matchFacts(this.latestMatch, this.state.countdownTo);
  }

  private recentLines(): string[] {
    return [...this.lines.values()].map((e) => e.line.text).slice(-12);
  }

  /** LLM Gateway studio recap of the match so far, spoken by the commentator. */
  async recap(speak = true): Promise<{ ok: boolean; text?: string; error?: string }> {
    const k = this.aaiKey();
    if (!k) return { ok: false, error: 'No AssemblyAI API key available' };
    try {
      const text = await aaiRecap({ key: k, model: this.llmModel(), facts: this.matchContext(), recent: this.recentLines() });
      if (speak) this.speak({ id: `r${Date.now()}`, text, voice: this.state.autopilot.voice, priority: 3, ts: Date.now(), lang: 'en-IN', ai: true });
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /**
   * Hands-free producer: a spoken command (transcribed by Universal-Streaming in the host's browser)
   * is turned into a studio action by LLM Gateway — "show the batting card", "give me a recap", ...
   */
  async voiceCommand(text: string): Promise<{ ok: boolean; action?: string; scene?: string; say?: string; error?: string }> {
    const k = this.aaiKey();
    if (!k) return { ok: false, error: 'No AssemblyAI API key available' };
    const scenes = SCENE_IDS.join(', ');
    // fast path: obvious scene names never need the LLM
    const quick = quickScene(text);
    if (quick) return this.applySceneCommand(quick);
    if (/\b(recap|summary|summari[sz]e|catch me up)\b/i.test(text)) {
      const r = await this.recap(true);
      return { ok: r.ok, action: 'recap', say: r.text, error: r.error };
    }
    try {
      const { text: out } = await llm(k, [
        { role: 'system', content: `You control a live cricket broadcast studio. Map the producer's spoken command to ONE JSON object and reply with JSON only.\nShapes: {"action":"scene","scene":"<id>"} | {"action":"recap"} | {"action":"say","text":"<line for the commentator>"} | {"action":"none"}.\nScene ids: ${scenes}.\nExamples: "show the scorecard" -> scoreHero; "batting card" -> battingCard; "bowling figures" -> bowlingCard; "worm"/"run chase graph" -> worm; "win probability" -> winPredictor; "take a break" -> break.` },
        { role: 'user', content: text },
      ], { model: this.llmModel(), maxTokens: 80, temperature: 0, timeoutMs: 6000 });
      const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
      if (j.action === 'scene' && SCENE_IDS.includes(j.scene)) return this.applySceneCommand(j.scene);
      if (j.action === 'recap') {
        const r = await this.recap(true);
        return { ok: r.ok, action: 'recap', say: r.text, error: r.error };
      }
      if (j.action === 'say' && typeof j.text === 'string') {
        this.announce(j.text.slice(0, 300));
        return { ok: true, action: 'say', say: j.text };
      }
      return { ok: true, action: 'none' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private applySceneCommand(scene: StudioState['scene']) {
    this.state.scene = scene;
    this.state.baseScene = scene;
    this.state.sceneUntil = null;
    this.state.pinnedUntil = Date.now() + 30_000;
    this.automation.noteManualScene();
    this.commit();
    return { ok: true, action: 'scene', scene };
  }

  async persist() {
    const settings = JSON.stringify({ ...Object.fromEntries(PERSISTED.map((k) => [k, this.state[k]])), sttKeys: this.sttKeys });
    await this.repo.updateStudio(this.state.id, { settings, name: this.state.name });
  }

  suggest(s: Suggestion) {
    const host = this.host;
    if (host) this.io.to(host.id).emit('automation:suggestion', s);
  }

  simulate(type: CricketEvent['type']): CricketEvent {
    const last = this.latestMatch?.recentBalls.at(-1);
    const titles: Record<string, [string, string?, number?]> = {
      FOUR: ['FOUR!', last ? `${last.batsman?.name ?? 'Batter'} finds the rope` : 'Cracking shot to the fence'],
      SIX: ['SIX!', last ? `${last.batsman?.name ?? 'Batter'} goes downtown` : 'Into the stands!'],
      WICKET: ['WICKET!', last?.batsman ? `${last.batsman.name} has to go` : 'Big breakthrough', (last?.inningsWickets ?? 0) + 1],
      MILESTONE_BAT: [`FIFTY! ${last?.batsman?.name ?? ''}`.trim(), 'Raises the bat to the dressing room', 50],
      MILESTONE_BOWL: [`FIVE-WICKET HAUL! ${last?.bowler?.name ?? ''}`.trim(), 'A spell to remember', 5],
      PARTNERSHIP: ['50 PARTNERSHIP', [last?.batsman?.name, last?.nonStriker?.name].filter(Boolean).join(' & '), 50],
      HATTRICK_WATCH: ['ON A HAT-TRICK!', `${last?.bowler?.name ?? 'Bowler'} — two in two`],
      OVER_END: [`End of over ${last?.overNumber ?? 1}`, `${last?.overRuns ?? 0} runs`, last?.overNumber ?? 1],
      INNINGS_END: ['Innings Break', 'Time for the experts'],
      MATCH_END: ['Match Over', this.latestMatch?.summary ?? ''],
    };
    const [title, subtitle, value] = titles[type] ?? [type];
    const ev: CricketEvent = {
      type,
      matchKey: this.state.matchKey ?? 'sim',
      ball: last,
      title,
      subtitle,
      value,
      player: last?.batsman?.name,
      ts: Date.now(),
    };
    this.io.to(this.roomName).emit('match:events', [ev]);
    this.automation.applyEvent(ev);
    this.commentator.onEvents([ev]);
    return ev;
  }

  get keepAlive() {
    return this.isLive || this.state.wantLive;
  }

  dispose() {
    this.stopLease();
    this.unsubMatch?.();
    this.automation.dispose();
    this.commentator.dispose();
    clearInterval(this.autoMatchTimer);
    this.pipeline?.stop();
    void this.cloud?.stop();
    if (this.persistTimer) clearTimeout(this.persistTimer);
    void this.persist();
  }
}

/** Studios saved before the AssemblyAI migration used other AI providers — map their settings over. */
function migrateLegacyAi(st: StudioState) {
  const ap = st.autopilot as any;
  if (ap.writer && ap.writer !== 'templates' && ap.writer !== 'assemblyai') ap.writer = 'assemblyai';
  if (ap.voiceEngine && ap.voiceEngine !== 'edge' && ap.voiceEngine !== 'assemblyai') ap.voiceEngine = 'assemblyai';
  for (const k of Object.keys(ap)) if (/Voice$/.test(k) && k !== 'aaiVoice') delete ap[k];
  if (!AAI_VOICES.some((v) => v.id === ap.aaiVoice)) ap.aaiVoice = 'charles';
  const stt = st.stt as any;
  if (stt.provider !== 'browser' && stt.provider !== 'assemblyai') stt.provider = 'assemblyai';
  if (!stt.llmModel) stt.llmModel = DEFAULT_LLM_MODEL;
  for (const k of Object.keys(stt)) if (/Model$/.test(k) && k !== 'llmModel') delete stt[k];
}

const SCENE_WORDS: [RegExp, StudioState['scene']][] = [
  [/batting (card|scorecard)|batting/i, 'battingCard'],
  [/bowling (card|figures)|bowling|bowlers/i, 'bowlingCard'],
  [/ball.?by.?ball|last balls|recent balls/i, 'ballByBall'],
  [/worm/i, 'worm'],
  [/manhattan/i, 'manhattan'],
  [/win (predictor|probability)|who (will|is going to) win/i, 'winPredictor'],
  [/projected score|projection/i, 'projectedScore'],
  [/partnership/i, 'partnerships'],
  [/fall of wickets/i, 'fallOfWickets'],
  [/wagon ?wheel/i, 'wagonWheel'],
  [/run ?rate/i, 'runRateGraph'],
  [/chase|calculator|equation/i, 'chaseCalculator'],
  [/playing (xi|eleven)|line.?ups?|squads?/i, 'playingXI'],
  [/(at the )?crease|batters/i, 'batters'],
  [/key moments|highlights/i, 'keyMoments'],
  [/match report/i, 'matchReport'],
  [/(live )?score(board)?|scorecard/i, 'scoreHero'],
  [/commentary desk/i, 'commentaryDesk'],
  [/panel|experts?/i, 'panel'],
  [/break|brb/i, 'break'],
  [/starting soon/i, 'startingSoon'],
];

function quickScene(text: string): StudioState['scene'] | null {
  if (!/\b(show|switch|go|cut|put|bring|take|open|display|pull)\b/i.test(text) && text.split(/\s+/).length > 4) return null;
  for (const [re, id] of SCENE_WORDS) if (re.test(text) && SCENE_IDS.includes(id)) return id;
  return null;
}
