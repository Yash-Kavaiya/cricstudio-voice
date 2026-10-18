import { io, type Socket } from 'socket.io-client';
import type {
  CaptionLine,
  ChatMessage,
  CommentaryLine,
  CricketEvent,
  JoinResponse,
  MatchDetail,
  MatchListItem,
  OverlayId,
  Participant,
  Role,
  SceneId,
  SfxId,
  StudioState,
  SttProvider,
  SttSettings,
  Suggestion,
} from '@cricstudio/shared';
import { AudioEngine } from '../audio/engine';
import { LiveCaptions, speechSupported } from '../captions/speech';
import { AssemblyAIStreaming } from '../captions/aaiStreaming';
import { ProgramRecorder } from '../compositor/recorder';
import { HwProgramRecorder, hardwareEncodingSupported } from '../compositor/hwRecorder';
import { ProgramRenderer } from '../compositor/renderer';
import { MeshRTC, type RemoteMedia } from '../rtc/mesh';
import { VoiceProcessor, browserConstraintsChanged, normalizeVoiceFx, voiceIsolationSupported, type VoiceFx } from '../audio/voiceFx';
import { VideoProcessor, needsProcessing, normalizeVideoFx, type VideoFx } from '../rtc/videoFx';
import { LiveKitRTC } from '../rtc/livekit';
import { API_BASE, api } from './api';
import { prefs } from './storage';

export interface ClientOptions {
  studioId: string;
  token: string;
  role: Role;
  name: string;
  programToken?: string;
  /** cloud producer page: records + streams the program when the server asks */
  producer?: boolean;
  /** API origin when it differs from the page origin (e.g. producer in dev) */
  apiBase?: string;
}

const MAX_QUEUED_BYTES = 8 * 1024 * 1024; // ~10s of program while the socket reconnects

export type Listener = () => void;

export interface DeviceChoice {
  audioId?: string;
  videoId?: string;
  video?: VideoFx;
  voice?: VoiceFx;
}

function hiddenVideo(stream: MediaStream, muted = true): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = muted;
  v.playsInline = true;
  v.autoplay = true;
  v.srcObject = stream;
  void v.play().catch(() => undefined);
  return v;
}

/**
 * Everything a studio participant needs, framework-agnostic.
 * React components subscribe via `subscribe()` and read fields directly.
 */
export class StudioClient {
  socket: Socket;
  selfId = '';
  state: StudioState | null = null;
  match: MatchDetail | null = null;
  matches: MatchListItem[] = [];
  chat: ChatMessage[] = [];
  events: CricketEvent[] = [];
  suggestions: Suggestion[] = [];
  streamLog: string[] = [];
  caption: CaptionLine | null = null;
  error: string | null = null;
  connected = false;
  mediaMode: 'mesh' | 'livekit' = 'mesh';

  localStream: MediaStream | null = null;
  /** Untouched camera/mic; localStream carries the processed voice and (when effects are on) video. */
  private rawStream: MediaStream | null = null;
  private video: VideoProcessor | null = null;
  private voice: VoiceProcessor | null = null;
  devices: Pick<DeviceChoice, 'audioId' | 'videoId'> = {};
  videoFx: VideoFx = normalizeVideoFx(prefs.get<Partial<VideoFx> | null>('videoFx', null));
  voiceFx: VoiceFx = normalizeVoiceFx(prefs.get<Partial<VoiceFx> | null>('voiceFx', null));
  screenStream: MediaStream | null = null;
  remote = new Map<string, RemoteMedia>();
  peerStates = new Map<string, RTCPeerConnectionState>();
  mediaError: string | null = null;

  readonly renderer = new ProgramRenderer();
  audio: AudioEngine;
  private transport: MeshRTC | LiveKitRTC | null = null;
  private recorder: ProgramRecorder | HwProgramRecorder | null = null;
  /** which encoder feeds the server: GPU (WebCodecs) or MediaRecorder; null until producing */
  encoderKind: 'gpu' | 'mediarecorder' | null = null;
  private hwFailed = false;

  /** encoded output fps of the GPU encoder (null on MediaRecorder, which doesn't expose it) */
  sampleEncoderFps(): number | null {
    return this.recorder instanceof HwProgramRecorder ? this.recorder.sampleFps() : null;
  }
  private producing = false;
  private joined = false;
  private ingestQueue: { kind: 'reset' | 'chunk'; buf?: ArrayBuffer; mime?: string }[] = [];
  private queuedBytes = 0;
  private needFreshHeader = false;
  private heartbeat: number | null = null;
  private speechQueue: CommentaryLine[] = [];
  private speechBusy = false;
  commentary: CommentaryLine | null = null;
  private captions: LiveCaptions | null = null;
  private segmenter: AssemblyAIStreaming | null = null;
  /** hands-free producer: captions starting with the wake word are run as studio commands */
  voiceCommands = false;
  lastCommand: { text: string; result: string; ts: number } | null = null;
  private sttChain: Promise<void> = Promise.resolve();
  private sttPending = 0;
  private cloudFails = 0;
  private cloudFallbackUntil = 0;
  private captionRetry: ReturnType<typeof setTimeout> | null = null;
  /** what is producing your captions right now (shown in the UI) */
  captionStatus: { engine: 'off' | 'browser' | 'assemblyai'; fallback: boolean; error?: string; lastText?: string } = { engine: 'off', fallback: false };
  private remoteAudio = new Map<string, HTMLAudioElement>();
  private listeners = new Set<Listener>();
  private matchesTimer: number | null = null;
  private notifyQueued = false;

  constructor(readonly opts: ClientOptions) {
    const base = opts.apiBase ?? API_BASE;
    this.socket = base ? io(base, { transports: ['websocket'], autoConnect: false }) : io({ transports: ['websocket'], autoConnect: false });
    const isProgram = opts.role === 'program';
    this.audio = new AudioEngine({
      program: opts.role !== 'guest',
      monitorVoices: isProgram,
      monitorLevel: isProgram ? 1 : opts.role === 'host' ? prefs.get('monitorLevel', 0.6) : 0.35,
    });
    this.renderer.onOverlay = (o) => {
      if (o.sfx && this.state?.brand.sfx) this.audio.sfx(o.sfx, this.state.brand.sfxVolume);
    };
    let first = true;
    this.renderer.onSceneChange = () => {
      if (!first && this.state?.brand.sfx) this.audio.sfx('whoosh', (this.state.brand.sfxVolume ?? 0.8) * 0.6);
      first = false;
    };
    this.bindSocket();
    if (import.meta.env.DEV) (window as any).__studio = this;
  }

  /* ---------------- subscription ---------------- */

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  notifyAll() {
    this.notify();
  }

  private notify() {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    requestAnimationFrame(() => {
      this.notifyQueued = false;
      for (const l of this.listeners) l();
    });
  }

  get self(): Participant | undefined {
    return this.state?.participants.find((p) => p.id === this.selfId);
  }

  get isHost() {
    return this.opts.role === 'host';
  }

  /* ---------------- lifecycle ---------------- */

  async start(devices: DeviceChoice = {}) {
    // join immediately; camera/mic attach whenever the browser grants them
    this.socket.connect();
    if (this.opts.role !== 'program') void this.openMedia(devices);
    this.renderer.start(30);
    void this.refreshMatches();
    this.matchesTimer = window.setInterval(() => void this.refreshMatches(), 30_000);
  }

  async refreshMatches() {
    try {
      this.matches = await api.matches();
      this.renderer.setMatches(this.matches);
      this.notify();
    } catch {
      /* offline */
    }
  }

  async openMedia(d: DeviceChoice = {}) {
    const wasMuted = this.localStream ? this.isMicMuted() : false;
    const wasCamOff = this.localStream ? this.isCamOff() : false;
    const { video, voice, ...ids } = d;
    this.devices = { ...this.devices, ...ids };
    if (video) this.saveVideoFx(video);
    if (voice) this.saveVoiceFx(voice);
    const { audioId, videoId } = this.devices;
    const vf = this.voiceFx;
    this.releaseMedia();
    const audioC = (a?: string): MediaTrackConstraints =>
      ({
        deviceId: a ? { exact: a } : undefined,
        echoCancellation: vf.echoCancellation,
        noiseSuppression: vf.noiseSuppression,
        autoGainControl: vf.autoGainControl,
        ...(vf.voiceIsolation && voiceIsolationSupported() ? { voiceIsolation: true } : {}),
        channelCount: 1,
        sampleRate: 48000,
      }) as MediaTrackConstraints;
    const get = (a?: string, v?: string) =>
      navigator.mediaDevices.getUserMedia({
        audio: audioC(a),
        video: { deviceId: v ? { exact: v } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
    try {
      try {
        this.rawStream = await get(audioId, videoId);
      } catch (e) {
        // chosen device unplugged/busy → fall back to the default camera & mic
        if (!audioId && !videoId) throw e;
        this.rawStream = await get();
      }
      this.mediaError = null;
    } catch (e) {
      // fall back to audio-only, then nothing — the studio still works for score-only shows
      try {
        this.rawStream = await navigator.mediaDevices.getUserMedia({ audio: audioC(audioId) });
        this.mediaError = 'Camera unavailable — joined with microphone only.';
      } catch {
        this.rawStream = null;
        this.mediaError = `Camera/mic unavailable: ${(e as Error).message}`;
      }
    }
    // remember the actual devices so settings show them even when "default" was requested
    const aId = this.rawStream?.getAudioTracks()[0]?.getSettings().deviceId;
    const vId = this.rawStream?.getVideoTracks()[0]?.getSettings().deviceId;
    this.devices = { ...this.devices, audioId: aId ?? audioId, videoId: vId ?? videoId };
    this.buildLocal();
    if (wasMuted) this.localStream?.getAudioTracks().forEach((t) => (t.enabled = false));
    if (wasCamOff) this.localStream?.getVideoTracks().forEach((t) => (t.enabled = false));
    this.syncLocalMedia();
    if (this.selfId) this.socket.emit('participant:update', { muted: this.isMicMuted(), camOff: this.isCamOff() });
    this.notify();
  }

  private saveVideoFx(fx: VideoFx) {
    this.videoFx = normalizeVideoFx(fx);
    prefs.set('videoFx', this.videoFx);
  }

  private saveVoiceFx(fx: VoiceFx) {
    this.voiceFx = normalizeVoiceFx(fx);
    prefs.set('voiceFx', this.voiceFx);
  }

  /** Camera effects: blur, virtual background, green screen, colour. Live updates don't restart the camera. */
  setVideoFx(fx: VideoFx) {
    this.saveVideoFx(fx);
    if (this.video && needsProcessing(this.videoFx)) {
      this.video.setFx(this.videoFx);
    } else if (!!this.video !== needsProcessing(this.videoFx)) {
      this.rebuildLocal();
    }
    this.notify();
  }

  /** Voice chain settings. Browser DSP toggles reopen the mic; everything else is live. */
  setVoiceFx(fx: VoiceFx) {
    const prev = this.voiceFx;
    this.saveVoiceFx(fx);
    if (browserConstraintsChanged(prev, this.voiceFx)) void this.openMedia();
    else this.voice?.apply(this.voiceFx);
    this.notify();
  }

  get videoStatus() {
    return this.video?.status ?? null;
  }

  /** output level of my processed mic, 0..1 (for meters) */
  get voiceAnalyser() {
    return this.voice?.analyser ?? null;
  }

  /** Guess the green-screen colour from the camera frame border. */
  sampleKeyColor() {
    return this.video?.sampleKeyColor() ?? null;
  }

  private rebuildLocal() {
    const muted = this.isMicMuted();
    const camOff = this.isCamOff();
    this.video?.stop();
    this.video = null;
    this.voice?.stop();
    this.voice = null;
    this.buildLocal();
    if (muted) this.localStream?.getAudioTracks().forEach((t) => (t.enabled = false));
    if (camOff) this.localStream?.getVideoTracks().forEach((t) => (t.enabled = false));
    this.syncLocalMedia();
  }

  private buildLocal() {
    const raw = this.rawStream;
    if (!raw) {
      this.localStream = null;
      return;
    }
    const tracks: MediaStreamTrack[] = [];
    const mic = raw.getAudioTracks()[0];
    if (mic) {
      try {
        this.voice = new VoiceProcessor(mic, this.voiceFx);
        tracks.push(this.voice.track);
      } catch {
        tracks.push(mic); // WebAudio unavailable → raw mic
      }
    }
    const cam = raw.getVideoTracks()[0];
    if (cam && needsProcessing(this.videoFx)) {
      this.video = new VideoProcessor(raw, this.videoFx);
      this.video.onStatus = () => {
        if (this.video?.status === 'error') this.mediaError = 'This camera effect is unavailable on this device.';
        this.notify();
      };
      tracks.push(this.video.track);
    } else if (cam) tracks.push(cam);
    this.localStream = new MediaStream(tracks);
    // the phrase detector listens to the processed mic — follow mic changes
    if (this.segmenter) void this.segmenter.start(this.localStream);
  }

  private releaseMedia() {
    this.video?.stop();
    this.video = null;
    this.voice?.stop();
    this.voice = null;
    this.rawStream?.getTracks().forEach((t) => t.stop());
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.rawStream = null;
  }

  dispose() {
    if (this.matchesTimer) clearInterval(this.matchesTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.recorder instanceof HwProgramRecorder) this.recorder.dispose();
    else this.recorder?.stop();
    this.speechQueue = [];
    this.captions?.stop();
    this.segmenter?.stop();
    if (this.captionRetry) clearTimeout(this.captionRetry);
    this.transport?.close();
    this.renderer.dispose();
    this.audio.close();
    this.releaseMedia();
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.remoteAudio.forEach((a) => a.pause());
    this.socket.disconnect();
    this.listeners.clear();
  }

  /* ---------------- socket ---------------- */

  private bindSocket() {
    const s = this.socket;
    s.on('connect', () => {
      this.connected = true;
      s.emit(
        'studio:join',
        { studioId: this.opts.studioId, token: this.opts.token, name: this.opts.name, role: this.opts.role },
        (res: JoinResponse) => void this.onJoined(res),
      );
    });
    s.on('disconnect', () => {
      this.connected = false;
      this.joined = false;
      this.notify();
    });
    s.on('producer:start', () => this.startProducing());
    s.on('producer:stop', () => this.stopProducing());
    s.on('commentary:say', (line: CommentaryLine) => this.enqueueSpeech(line));
    s.on('studio:state', (st: StudioState) => this.applyState(st));
    s.on('match:update', (m: MatchDetail) => {
      this.match = m;
      this.renderer.setMatch(m);
      this.notify();
    });
    s.on('match:events', (evs: CricketEvent[]) => {
      this.events = [...evs, ...this.events].slice(0, 80);
      this.notify();
    });
    s.on('peer:joined', (p: Participant) => {
      // the newcomer initiates; we only respond to its offer (see MeshRTC.onSignal)
    });
    s.on('peer:left', (id: string) => {
      if (this.transport instanceof MeshRTC) this.transport.drop(id);
      this.dropRemote(id);
    });
    s.on('chat:history', (msgs: ChatMessage[]) => {
      this.chat = msgs;
      this.notify();
    });
    s.on('chat:msg', (m: ChatMessage) => {
      this.chat = [...this.chat, m].slice(-200);
      this.notify();
    });
    s.on('captions:text', (c: CaptionLine) => {
      this.caption = c;
      this.renderer.setCaption(c);
      this.notify();
    });
    s.on('automation:suggestion', (sg: Suggestion) => {
      this.suggestions = [sg, ...this.suggestions].slice(0, 5);
      this.notify();
    });
    s.on('stream:restart', () => this.recorder?.restart());
    s.on('stream:log', (line: string) => {
      this.streamLog = [...this.streamLog, line].slice(-30);
      this.notify();
    });
    s.on('participant:muteRequest', () => this.setMuted(true));
    s.on('studio:kicked', () => {
      this.error = 'You were removed from the studio by the host.';
      this.notify();
    });
    s.on('studio:replaced', () => {
      this.error = 'This studio was opened in another tab.';
      this.notify();
    });
  }

  private async onJoined(res: JoinResponse) {
    if (!res.ok || !res.state || !res.selfId) {
      this.error = res.error ?? 'Could not join';
      this.notify();
      return;
    }
    this.selfId = res.selfId;
    this.joined = true;
    this.startHeartbeat();
    this.mediaMode = res.mediaMode ?? 'mesh';
    this.flushIngest();
    this.transport?.close();
    this.remote.clear();
    if (this.mediaMode === 'livekit') {
      const lk = new LiveKitRTC();
      this.transport = lk;
      lk.onMedia = (id, m) => this.setRemote(id, m);
      lk.onPeerGone = (id) => this.dropRemote(id);
      const tok: { ok: boolean; token?: string; url?: string } = await this.socket.emitWithAck('livekit:token', {});
      if (tok.ok && tok.token && tok.url) await lk.connect(tok.url, tok.token);
    } else {
      const mesh = new MeshRTC(this.socket, this.selfId, res.iceServers ?? [], this.opts.role !== 'program');
      this.transport = mesh;
      mesh.onMedia = (id, m) => this.setRemote(id, m);
      mesh.onPeerGone = (id) => this.dropRemote(id);
      mesh.onState = (id, st) => {
        this.peerStates.set(id, st);
        this.notify();
      };
    }
    this.syncLocalMedia();
    this.applyState(res.state);
    // newcomer connects to everyone already present
    if (this.transport instanceof MeshRTC) {
      for (const p of res.state.participants) if (p.id !== this.selfId) this.transport.connect(p.id);
    }
    if (this.opts.role !== 'program') {
      this.socket.emit('participant:update', { muted: this.isMicMuted(), camOff: this.isCamOff() });
    }
  }

  private applyState(st: StudioState) {
    const prev = this.state;
    this.state = st;
    this.renderer.setState(st);
    this.audio.applyMusic(st.music);
    this.audio.sfxVolume = st.brand.sfxVolume;
    this.syncVoices();
    const sttSig = (x?: StudioState | null) => (x ? `${x.brand.captions}|${x.stt?.provider}|${JSON.stringify(x.stt?.configured)}|${x.stt?.language}` : '');
    if (this.opts.role !== 'program' && sttSig(prev) !== sttSig(st)) this.updateCaptions();
    this.notify();
  }

  /* ---------------- media plumbing ---------------- */

  private syncLocalMedia() {
    // renderer source for my own camera
    if (this.selfId) {
      const cam = this.localStream?.getVideoTracks().length ? hiddenVideo(this.localStream, true) : undefined;
      const screen = this.screenStream ? hiddenVideo(this.screenStream, true) : undefined;
      const prev = this.renderer.videos.get(this.selfId);
      prev?.cam?.pause();
      prev?.screen?.pause();
      this.renderer.videos.set(this.selfId, { cam, screen, mirror: false });
    }
    if (this.transport) void this.transport.setLocal(this.localStream, this.screenStream);
    this.syncVoices();
  }

  private setRemote(id: string, m: RemoteMedia) {
    this.remote.set(id, m);
    const prev = this.renderer.videos.get(id);
    const camVid = m.cam && m.cam.getVideoTracks().length ? (prev?.cam?.srcObject === m.cam ? prev.cam : hiddenVideo(m.cam)) : undefined;
    const scrVid = m.screen ? (prev?.screen?.srcObject === m.screen ? prev.screen : hiddenVideo(m.screen)) : undefined;
    this.renderer.videos.set(id, { cam: camVid, screen: scrVid });
    // remote audio playback (also works around Chrome needing an element for WebAudio on remote tracks)
    if (m.cam && m.cam.getAudioTracks().length) {
      let a = this.remoteAudio.get(id);
      if (!a) {
        a = new Audio();
        a.autoplay = true;
        this.remoteAudio.set(id, a);
      }
      if (a.srcObject !== m.cam) {
        a.srcObject = m.cam;
        void a.play().catch(() => undefined);
      }
      // program pages hear voices through the mixer only
      a.muted = this.opts.role === 'program';
    }
    this.syncVoices();
    this.notify();
  }

  private dropRemote(id: string) {
    this.remote.delete(id);
    this.renderer.videos.delete(id);
    const a = this.remoteAudio.get(id);
    if (a) {
      a.pause();
      a.srcObject = null;
      this.remoteAudio.delete(id);
    }
    this.syncVoices();
    this.notify();
  }

  /** Program mix = voices of everyone on stage (host page + program page). */
  private syncVoices() {
    if (this.opts.role === 'guest' || !this.state) return;
    const keep = new Set<string>();
    for (const p of this.state.participants) {
      if (p.role === 'program') continue;
      const stream = p.id === this.selfId ? this.localStream : this.remote.get(p.id)?.cam ?? null;
      const live = p.onStage && !p.muted;
      if (stream) {
        this.audio.setVoice(p.id, stream, live ? 1 : 0);
        keep.add(p.id);
      }
    }
    this.audio.removeMissingVoices(keep);
  }

  isMicMuted() {
    const t = this.localStream?.getAudioTracks()[0];
    return !t || !t.enabled;
  }

  isCamOff() {
    const t = this.localStream?.getVideoTracks()[0];
    return !t || !t.enabled;
  }

  setMuted(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.rawStream?.getAudioTracks().forEach((t) => (t.enabled = !muted)); // also silences "hear yourself"
    this.socket.emit('participant:update', { muted });
    this.notify();
  }

  setCamOff(off: boolean) {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = !off));
    this.rawStream?.getVideoTracks().forEach((t) => (t.enabled = !off));
    this.socket.emit('participant:update', { camOff: off });
    this.notify();
  }

  async toggleScreen() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
      this.socket.emit('participant:update', { screenSharing: false });
    } else {
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, width: { ideal: 1920 } }, audio: false });
        s.getVideoTracks()[0].onended = () => {
          if (this.screenStream === s) void this.toggleScreen();
        };
        this.screenStream = s;
        this.socket.emit('participant:update', { screenSharing: true });
        if (this.isHost) this.setScene('screenShare');
      } catch {
        return;
      }
    }
    this.syncLocalMedia();
    this.notify();
  }

  /**
   * Live captions. AssemblyAI Universal-Streaming gets the processed mic over a realtime WebSocket
   * (temporary token from the studio server); when it's unavailable or failing we fall back to the
   * browser's free Web Speech recognition (Chrome/Edge) and retry AssemblyAI a minute later.
   */
  private updateCaptions() {
    const st = this.state;
    const on = !!st?.brand.captions && this.opts.role !== 'program';
    const stt = st?.stt;
    const cloudReady = !!stt && stt.provider !== 'browser' && Object.values(stt.configured ?? {}).some(Boolean);
    const fallback = cloudReady && this.cloudFallbackUntil > Date.now();
    const mode: 'off' | 'browser' | 'cloud' = !on ? 'off' : cloudReady && !fallback ? 'cloud' : 'browser';

    if (mode !== 'browser' && this.captions) {
      this.captions.stop();
      this.captions = null;
    }
    if (mode !== 'cloud' && this.segmenter) {
      this.segmenter.stop();
      this.segmenter = null;
    }
    if (mode === 'browser' && !this.captions && speechSupported()) {
      this.captions = new LiveCaptions((text, final) => {
        if (!this.isMicMuted() && this.self?.onStage) this.socket.emit('captions:text', { text, final });
      }, stt?.language || undefined);
      this.captions.start();
    }
    if (mode === 'cloud' && !this.segmenter) {
      this.segmenter = new AssemblyAIStreaming({
        language: stt?.language,
        getToken: async () => {
          const r = await this.socket.timeout(10_000).emitWithAck('stt:token', {});
          if (!r?.ok) throw new Error(r?.error ?? 'No streaming token');
          return r.token as string;
        },
        keyterms: () => this.keyterms(),
        onText: (text, final) => this.onStreamText(text, final),
        onError: (msg) => this.cloudFailed(msg),
      });
      if (this.localStream) void this.segmenter.start(this.localStream);
    }
    const prevErr = this.captionStatus.error;
    this.captionStatus =
      mode === 'off'
        ? { engine: 'off', fallback: false }
        : mode === 'cloud'
          ? { engine: 'assemblyai', fallback: false, lastText: this.captionStatus.lastText }
          : { engine: 'browser', fallback, error: fallback ? prevErr : speechSupported() ? undefined : 'This browser has no built-in speech recognition — use Chrome/Edge or add a cloud API key.' };
    this.notify();
  }

  /** player + team names to boost in Universal-Streaming */
  keyterms(): string[] {
    const m = this.match;
    const names = new Set<string>();
    for (const t of m?.teams ?? []) {
      if (t.name) names.add(t.name);
      for (const p of t.squad ?? []) if (p.name) names.add(p.name);
    }
    for (const b of m?.currentBatters ?? []) names.add(b.name);
    if (m?.currentBowler) names.add(m.currentBowler.name);
    return [...names, 'wicket', 'boundary', 'LBW', 'yorker', 'powerplay', 'run rate', 'DRS'].slice(0, 100);
  }

  private onStreamText(text: string, final: boolean) {
    if (this.isMicMuted() || !this.self?.onStage) return;
    const wake = /^\s*(hey\s+)?(studio|producer)[,.!]?\s+/i;
    if (this.voiceCommands && this.isHost && wake.test(text)) {
      if (final) void this.voiceCommand(text.replace(wake, ''));
      return; // commands are not captioned
    }
    this.socket.emit('captions:text', { text, final });
    this.cloudFails = 0;
    if (final) {
      this.captionStatus = { engine: 'assemblyai', fallback: false, lastText: text };
      this.notify();
    }
  }

  /** Host: run a spoken/typed command through AssemblyAI LLM Gateway ("show the batting card"). */
  async voiceCommand(text: string) {
    const r = await this.socket.timeout(20_000).emitWithAck('voice:command', { text }).catch((e: Error) => ({ ok: false, error: e.message }));
    const result = r?.ok ? (r.action === 'scene' ? `Switched to ${r.scene}` : r.action === 'recap' ? 'Recap on air' : r.action === 'say' ? `Said: ${r.say}` : 'No action') : `Failed: ${r?.error}`;
    this.lastCommand = { text, result, ts: Date.now() };
    this.notify();
    return r;
  }

  /** Host: LLM Gateway recap of the match so far, read on air. */
  recap(): Promise<{ ok: boolean; text?: string; error?: string }> {
    return this.socket.timeout(30_000).emitWithAck('ai:recap', {});
  }

  /** Voice Agent session (token + match context) for talk-to-commentator. */
  agentSession(): Promise<{ ok: boolean; token?: string; voice?: string; context?: string; keyterms?: string[]; error?: string }> {
    return this.socket.timeout(15_000).emitWithAck('agent:session', {}).catch((e: Error) => ({ ok: false, error: e.message }));
  }

  agentContext(): Promise<string> {
    return this.socket.timeout(8_000).emitWithAck('agent:context', {}).then((r: any) => r?.context ?? '').catch(() => '');
  }

  private sendPhrase(wav: ArrayBuffer) {
    if (this.isMicMuted() || !this.self?.onStage) return;
    if (this.sttPending >= 3) return; // provider is slower than speech — drop rather than lag behind
    this.sttPending++;
    this.sttChain = this.sttChain.then(async () => {
      try {
        const r = await this.socket.timeout(20_000).emitWithAck('stt:segment', wav);
        if (r?.ok) {
          this.cloudFails = 0;
          this.captionStatus = { engine: r.provider ?? this.captionStatus.engine, fallback: false, lastText: r.text || this.captionStatus.lastText };
          this.notify();
        } else if (r?.error !== 'busy') this.cloudFailed(r?.error ?? 'Speech-to-text failed');
      } catch {
        this.cloudFailed('Speech-to-text timed out');
      } finally {
        this.sttPending--;
      }
    });
  }

  private cloudFailed(error: string) {
    this.captionStatus = { ...this.captionStatus, error };
    // a rejected key won't fix itself — switch to browser speech right away; otherwise allow one blip
    const fatal = /API key rejected|No speech-to-text API key/i.test(error);
    if (!fatal && ++this.cloudFails < 2) return this.notify();
    // two failures in a row → browser captions for a minute, then try the cloud engine again
    this.cloudFails = 0;
    this.cloudFallbackUntil = Date.now() + 60_000;
    this.updateCaptions();
    if (this.captionRetry) clearTimeout(this.captionRetry);
    this.captionRetry = setTimeout(() => this.updateCaptions(), 61_000);
  }

  /** live level of the caption phrase detector (0..1) for the settings meter */
  captionLevel() {
    return this.segmenter?.level ?? 0;
  }

  /* ---------------- host actions ---------------- */

  private emit(ev: string, payload: unknown = {}): Promise<any> {
    return this.socket.emitWithAck(ev, payload).then((r: any) => {
      if (r && r.ok === false && r.error) throw new Error(r.error);
      return r;
    });
  }

  setScene(scene: SceneId) {
    return this.emit('studio:scene', { scene });
  }
  patch(p: Partial<StudioState>) {
    return this.emit('studio:patch', p);
  }
  overlay(o: { id?: OverlayId; title: string; subtitle?: string; ms?: number; sfx?: SfxId } | null) {
    return this.emit('studio:overlay', o);
  }
  setStage(participantId: string, onStage: boolean) {
    return this.emit('studio:stage', { participantId, onStage });
  }
  kick(participantId: string) {
    return this.emit('studio:kick', { participantId });
  }
  requestMute(participantId: string) {
    this.socket.emit('participant:muteRequest', { participantId });
  }
  simulate(type: CricketEvent['type']) {
    return this.emit('dev:simulate', { type });
  }
  demoStep(n = 1) {
    return this.emit('demo:step', { n });
  }
  acceptSuggestion(s: Suggestion) {
    this.suggestions = this.suggestions.filter((x) => x.id !== s.id);
    this.notify();
    return this.emit('automation:accept', { event: s.event });
  }
  dismissSuggestion(id: string) {
    this.suggestions = this.suggestions.filter((x) => x.id !== id);
    this.notify();
  }
  sendChat(text: string) {
    this.socket.emit('chat:send', { text });
  }
  playSfxLocal(id: SfxId) {
    this.audio.sfx(id, this.state?.brand.sfxVolume ?? 0.8);
  }

  async goLive(broadcaster: 'host' | 'cloud' = 'host') {
    await this.audio.resume();
    const r = await this.emit('stream:start', { broadcaster, programToken: this.opts.programToken });
    if (r.mode === 'mesh' && broadcaster === 'host') this.startProducing();
    this.notify();
  }

  async endLive() {
    this.stopProducing();
    await this.emit('stream:stop', {});
    this.notify();
  }

  /* ---------------- producing the program feed ---------------- */

  get isProducing() {
    return this.producing;
  }

  startProducing() {
    if (this.opts.role === 'guest') return;
    this.producing = true;
    if (this.recorder) {
      // a fresh header is always safe after (re)connecting
      this.recorder.start();
      this.needFreshHeader = false;
      return;
    }
    const gen = ++this.recorderGen;
    void this.pickEncoder().then((gpu) => {
      if (!this.producing || this.recorder || gen !== this.recorderGen) return;
      this.recorder = gpu ? this.gpuRecorder() : this.mediaRecorder();
      this.encoderKind = gpu ? 'gpu' : 'mediarecorder';
      this.recorder.start();
      this.needFreshHeader = false;
      this.notify();
    });
  }

  private recorderGen = 0;

  private get ingestSink() {
    return {
      reset: (mime: string) => this.sendIngest({ kind: 'reset', mime }),
      chunk: (buf: ArrayBuffer) => this.sendIngest({ kind: 'chunk', buf }),
    };
  }

  /** GPU encoding unless unsupported, previously failed, or turned off (localStorage cricstudio.encoder = "mediarecorder"). */
  private async pickEncoder(): Promise<boolean> {
    if (this.hwFailed) return false;
    try {
      if (localStorage.getItem('cricstudio.encoder')?.includes('mediarecorder')) return false;
    } catch {
      /* storage blocked */
    }
    return hardwareEncodingSupported();
  }

  private mediaRecorder() {
    return new ProgramRecorder(this.renderer.canvas, this.audio.programStream, this.ingestSink);
  }

  private gpuRecorder() {
    return new HwProgramRecorder(this.renderer.canvas, this.audio.programStream, this.ingestSink, (why) => {
      // any GPU encoder problem: switch this session to MediaRecorder without stopping the show
      console.warn('[encoder] GPU encoder failed, falling back to MediaRecorder:', why);
      this.hwFailed = true;
      const old = this.recorder;
      if (old instanceof HwProgramRecorder) old.dispose();
      this.recorder = null;
      this.encoderKind = null;
      if (this.producing) {
        this.recorder = this.mediaRecorder();
        this.encoderKind = 'mediarecorder';
        this.recorder.start();
      }
      this.notify();
    });
  }

  /** cloud producer liveness for the server watchdog (fps + JS heap) */
  private startHeartbeat() {
    if (!this.opts.producer || this.heartbeat) return;
    const beat = () => {
      const mem = (performance as any).memory?.usedJSHeapSize ?? 0;
      this.socket.emit('producer:heartbeat', { fps: this.renderer.fps, heapMb: Math.round(mem / 1048576) });
    };
    beat();
    this.heartbeat = window.setInterval(beat, 5000);
  }

  stopProducing() {
    this.producing = false;
    this.recorderGen++;
    if (this.recorder instanceof HwProgramRecorder) this.recorder.dispose();
    else this.recorder?.stop();
    this.recorder = null;
    this.encoderKind = null;
    this.ingestQueue = [];
    this.queuedBytes = 0;
  }

  /** Ordered, bounded delivery: queue while the socket reconnects, then flush in order. */
  private sendIngest(item: { kind: 'reset' | 'chunk'; buf?: ArrayBuffer; mime?: string }) {
    if (this.socket.connected && this.joined && !this.ingestQueue.length) {
      if (item.kind === 'reset') this.socket.emit('ingest:reset', { mime: item.mime });
      else this.socket.emit('ingest:chunk', item.buf);
      return;
    }
    if (this.needFreshHeader) return; // dropping until we can restart cleanly
    this.ingestQueue.push(item);
    this.queuedBytes += item.buf?.byteLength ?? 0;
    if (this.queuedBytes > MAX_QUEUED_BYTES) {
      // too long offline: drop the backlog, restart the recorder once we're back
      this.ingestQueue = [];
      this.queuedBytes = 0;
      this.needFreshHeader = true;
    }
  }

  private flushIngest() {
    if (!this.producing) return;
    if (this.needFreshHeader) {
      this.needFreshHeader = false;
      this.recorder?.restart();
      return;
    }
    const q = this.ingestQueue;
    this.ingestQueue = [];
    this.queuedBytes = 0;
    for (const it of q) {
      if (it.kind === 'reset') this.socket.emit('ingest:reset', { mime: it.mime });
      else this.socket.emit('ingest:chunk', it.buf);
    }
  }

  /* ---------------- AI commentator ---------------- */

  private enqueueSpeech(line: CommentaryLine) {
    // guests hear the commentary through the program; host + producer pages play it
    if (this.opts.role === 'guest') return;
    this.speechQueue.push(line);
    this.speechQueue.sort((a, b) => b.priority - a.priority || a.ts - b.ts);
    if (this.speechQueue.length > 3) this.speechQueue.length = 3;
    void this.drainSpeech();
  }

  private async drainSpeech() {
    if (this.speechBusy) return;
    this.speechBusy = true;
    try {
      while (this.speechQueue.length) {
        const line = this.speechQueue.shift()!;
        if (Date.now() - line.ts > 20_000) continue; // stale — the moment has passed
        this.commentary = line;
        this.notify();
        try {
          let audio: ArrayBuffer | null = null;
          if (line.engine === 'assemblyai') {
            // AssemblyAI voice is synthesised by the studio server; fall back to Edge on any failure
            const r = await this.socket.timeout(15_000).emitWithAck('commentary:tts', { id: line.id }).catch(() => null);
            if (r?.ok && r.audio) audio = r.audio as ArrayBuffer;
          }
          if (!audio) {
            const res = await fetch(`${this.opts.apiBase ?? API_BASE}/api/tts?voice=${encodeURIComponent(line.voice)}&text=${encodeURIComponent(line.text)}`);
            if (!res.ok) throw new Error(`tts ${res.status}`);
            audio = await res.arrayBuffer();
          }
          await this.audio.speak(audio);
        } catch {
          // offline fallback: browser voice (local monitor only)
          if ('speechSynthesis' in window && this.opts.role === 'host') {
            await new Promise<void>((resolve) => {
              const u = new SpeechSynthesisUtterance(line.text);
              u.rate = 1.05;
              u.onend = () => resolve();
              u.onerror = () => resolve();
              speechSynthesis.speak(u);
              setTimeout(resolve, 15_000);
            });
          }
        }
        await new Promise((r) => setTimeout(r, 350));
      }
    } finally {
      this.speechBusy = false;
      this.commentary = null;
      this.notify();
    }
  }

  /** Host: save speech/AI settings or keys (null clears a key). Keys are write-only. */
  saveStt(body: { provider?: SttProvider; language?: string; llmModel?: string; keys?: Partial<Record<'assemblyai', string | null>> }) {
    return this.emit('stt:save', body).then((r: any) => r.stt as SttSettings);
  }

  /** Host: verify a key (the saved one when `key` is omitted). */
  testStt(provider: 'assemblyai', key?: string): Promise<{ ok: boolean; error?: string; ms: number }> {
    return this.socket
      .timeout(25_000)
      .emitWithAck('stt:test', { provider, key })
      .catch((e: Error) => ({ ok: false, error: e.message, ms: 0 }));
  }

  /** Host: try the AI commentary setup with a sample line (returns AssemblyAI audio when the voice works). */
  testCommentary(): Promise<{ ok: boolean; text: string; ai: boolean; writerError?: string; voiceOk?: boolean; voiceError?: string; audio?: ArrayBuffer; error?: string }> {
    return this.socket.timeout(30_000).emitWithAck('commentary:test', {}).catch((e: Error) => ({ ok: false, text: '', ai: false, error: e.message }));
  }

  /** Host: put a typed message on air (Announcement scene) and optionally have the commentary voice read it. */
  announce(a: { title: string; text: string; show?: boolean; speak?: boolean } | null) {
    return this.emit('studio:announce', a);
  }

  sayNow(text: string) {
    return this.emit('commentary:say', { text });
  }
}
