import type { Server, Socket } from 'socket.io';
import {
  BACKGROUNDS,
  MAX_GUESTS,
  SCENE_IDS,
  TRANSITIONS,
  VOICES,
  AAI_VOICES,
  STT_LANGUAGES,
  type AutopilotSettings,
  type ChatMessage,
  type CricketEvent,
  type JoinRequest,
  type JoinResponse,
  type Participant,
  type StudioState,
} from '@cricstudio/shared';
import { pickTransition } from './automation/rules';
import { config, iceServers } from './config';
import type { MatchHub } from './espn/hub';
import { tokenMatches } from './store/crypto';
import { CLOUD_STT, type CloudStt } from './stt/providers';
import type { StudioManager } from './studio/manager';
import type { StudioRoom } from './studio/room';
import type { LiveKitService } from './stream/livekit';

interface SocketData {
  studioId?: string;
  role?: Participant['role'];
  name?: string;
  /** cloud producer (headless Chrome) */
  producer?: boolean;
}

type Ack = (res: any) => void;
const noop: Ack = () => {};
const clampNum = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

function sanitizeAutopilot(cur: AutopilotSettings, p: Partial<AutopilotSettings>): AutopilotSettings {
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : cur.enabled,
    sceneSeconds: p.sceneSeconds !== undefined ? Math.round(clampNum(p.sceneSeconds, 5, 600, cur.sceneSeconds)) : cur.sceneSeconds,
    scoreShare: p.scoreShare !== undefined ? clampNum(p.scoreShare, 0, 1, cur.scoreShare ?? 0.7) : (cur.scoreShare ?? 0.7),
    includeCameras: typeof p.includeCameras === 'boolean' ? p.includeCameras : cur.includeCameras,
    commentator: typeof p.commentator === 'boolean' ? p.commentator : cur.commentator,
    voice: p.voice && VOICES.some((v) => v.id === p.voice) ? p.voice : cur.voice,
    chatterSeconds: p.chatterSeconds !== undefined ? clampNum(p.chatterSeconds, 15, 180, cur.chatterSeconds) : cur.chatterSeconds,
    autoMusic: typeof p.autoMusic === 'boolean' ? p.autoMusic : cur.autoMusic,
    autoMatch: typeof p.autoMatch === 'boolean' ? p.autoMatch : cur.autoMatch,
    cloud: typeof p.cloud === 'boolean' ? p.cloud : cur.cloud,
    writer: p.writer === 'assemblyai' || p.writer === 'templates' ? p.writer : (cur.writer ?? 'templates'),
    voiceEngine: p.voiceEngine === 'assemblyai' || p.voiceEngine === 'edge' ? p.voiceEngine : (cur.voiceEngine ?? 'edge'),
    aaiVoice: p.aaiVoice && AAI_VOICES.some((v) => v.id === p.aaiVoice) ? p.aaiVoice : (cur.aaiVoice ?? 'charles'),
    llmModel: typeof p.llmModel === 'string' && /^[\w.\-/]{3,80}$/.test(p.llmModel) ? p.llmModel : cur.llmModel,
    commentaryLanguage:
      p.commentaryLanguage && STT_LANGUAGES.some((l) => l.code === p.commentaryLanguage) ? p.commentaryLanguage : (cur.commentaryLanguage ?? 'en-IN'),
  };
}

export function registerSocket(io: Server, studios: StudioManager, hub: MatchHub, livekit: LiveKitService) {
  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;

    const room = (): StudioRoom | undefined => (data.studioId ? studios.get(data.studioId) : undefined);
    const self = (): Participant | undefined => room()?.state.participants.find((p) => p.id === socket.id);
    const asHost = (fn: (r: StudioRoom, ...args: any[]) => unknown) => (...args: any[]) => {
      const r = room();
      const ack = typeof args.at(-1) === 'function' ? (args.at(-1) as Ack) : noop;
      if (!r || data.role !== 'host') return ack({ ok: false, error: 'Host only' });
      Promise.resolve()
        .then(() => fn(r, ...args))
        .catch((e) => ack({ ok: false, error: (e as Error).message }));
    };

    socket.on('studio:join', async (req: JoinRequest, ack: (r: JoinResponse) => void = noop) => {
      try {
        const r = await studios.load(req.studioId);
        if (!r) return ack({ ok: false, error: 'Studio not found' });
        const rec = r.record;
        const isWorker = req.role === 'program' && req.token === config.workerSecret;
        const hash = req.role === 'host' ? rec.hostTokenHash : req.role === 'guest' ? rec.guestTokenHash : rec.programTokenHash;
        const ok = isWorker || tokenMatches(req.token, hash) || (req.role === 'program' && tokenMatches(req.token, rec.hostTokenHash));
        if (!ok) return ack({ ok: false, error: 'Invalid or expired link' });
        if (req.role === 'guest' && r.guests().length >= MAX_GUESTS) {
          return ack({ ok: false, error: `This studio is full — max ${MAX_GUESTS} guest speakers + 1 host.` });
        }
        if (req.role === 'host') {
          const prev = r.host;
          if (prev && prev.id !== socket.id) {
            io.to(prev.id).emit('studio:replaced');
            io.sockets.sockets.get(prev.id)?.disconnect(true);
            r.state.participants = r.state.participants.filter((p) => p.id !== prev.id);
          }
          if (r.hostLeftTimer) {
            clearTimeout(r.hostLeftTimer);
            r.hostLeftTimer = null;
          }
          // server restarted mid-show: pick the stream back up once the host is in the room
          setTimeout(() => void r.resumeHostStream(socket.id), 1500);
        }
        data.studioId = r.state.id;
        data.role = req.role;
        data.producer = isWorker;
        data.name = (req.name || (req.role === 'host' ? 'Host' : 'Guest')).slice(0, 40);
        const p: Participant = {
          id: socket.id,
          name: isWorker ? 'Cloud producer' : data.name,
          role: req.role,
          onStage: req.role === 'host',
          muted: false,
          camOff: false,
          screenSharing: false,
          joinedAt: Date.now(),
        };
        r.state.participants.push(p);
        await socket.join(r.roomName);
        socket.to(r.roomName).emit('peer:joined', p);
        r.state.live.mode = livekit.enabled ? 'livekit' : 'mesh';
        r.automation.refreshPlaylist();
        r.commit();
        ack({ ok: true, selfId: socket.id, state: r.state, iceServers: iceServers(), mediaMode: r.state.live.mode });
        if (r.latestMatch) socket.emit('match:update', r.latestMatch);
        socket.emit('chat:history', r.chat.slice(-50));
        if (isWorker) r.onProducerJoined(socket.id);
        // host browser reconnected while it is the producer → resume feeding the pipeline
        if (req.role === 'host' && r.isLive && r.state.live.broadcaster === 'host') socket.emit('producer:start');
      } catch (e) {
        ack({ ok: false, error: (e as Error).message });
      }
    });

    socket.on('disconnect', () => {
      const r = room();
      if (!r) return;
      r.state.participants = r.state.participants.filter((p) => p.id !== socket.id);
      if (r.state.spotlightId === socket.id) r.state.spotlightId = null;
      if (r.producerId === socket.id) r.producerId = null;
      socket.to(r.roomName).emit('peer:left', socket.id);
      r.automation.refreshPlaylist();
      r.commit();
      if (data.role === 'host') r.scheduleFailover();
      setTimeout(() => studios.maybeUnload(r.state.id), 30_000).unref();
    });

    /* ---------------- host controls ---------------- */

    socket.on(
      'studio:scene',
      asHost((r, { scene, pinSeconds = 30 }: { scene: StudioState['scene']; pinSeconds?: number }, ack: Ack = noop) => {
        if (!SCENE_IDS.includes(scene)) return ack({ ok: false, error: 'Unknown scene' });
        if (r.state.scene !== scene) r.state.transition = pickTransition(r.state, r.state.transition);
        r.state.scene = scene;
        r.state.baseScene = scene;
        r.state.sceneUntil = null;
        r.state.pinnedUntil = Date.now() + pinSeconds * 1000;
        r.automation.noteManualScene();
        r.commit();
        ack({ ok: true });
      }),
    );

    socket.on(
      'studio:announce',
      asHost((r, a: { title?: string; text?: string; show?: boolean; speak?: boolean } | null, ack: Ack = noop) => {
        const s = r.state;
        if (!a) {
          s.announcement = undefined;
          r.commit();
          return ack({ ok: true });
        }
        const title = String(a.title ?? '').trim().slice(0, 60);
        const text = String(a.text ?? '').trim().slice(0, 400);
        if (!title && !text) return ack({ ok: false, error: 'Type a message first' });
        s.announcement = { title, text, ts: Date.now() };
        if (a.show !== false && s.scene !== 'message') {
          s.transition = pickTransition(s, s.transition);
          s.scene = 'message';
          s.baseScene = 'message';
          s.sceneUntil = null;
          s.pinnedUntil = Date.now() + 30_000;
          r.automation.noteManualScene();
        }
        r.commit();
        // the host's typed words, read out by the commentary voice (their own mic isn't on air)
        if (a.speak) r.announce([title, text].filter(Boolean).join('. '));
        ack({ ok: true });
      }),
    );

    socket.on(
      'studio:overlay',
      asHost((r, o: { id: any; title: string; subtitle?: string; ms?: number; sfx?: any } | null, ack: Ack = noop) => {
        if (!o) {
          r.state.overlay = null;
          r.commit();
        } else r.automation.showOverlay({ id: o.id ?? 'custom', title: o.title, subtitle: o.subtitle, sfx: o.sfx, ms: Math.min(o.ms ?? 6000, 60000) });
        ack({ ok: true });
      }),
    );

    socket.on(
      'studio:patch',
      asHost(async (r, patch: Partial<StudioState>, ack: Ack = noop) => {
        const s = r.state;
        if (patch.automation && ['auto', 'assist', 'manual'].includes(patch.automation)) s.automation = patch.automation;
        if (patch.rules) s.rules = { ...s.rules, ...patch.rules };
        if (patch.music) {
          // a person pressing Stop must win over the autopilot's music bed (it would restart it within 0.5 s)
          if (patch.music.playing === false && s.music.playing && s.autopilot.autoMusic) s.autopilot = { ...s.autopilot, autoMusic: false };
          s.music = { ...s.music, ...patch.music };
        }
        if (patch.brand) {
          const b = { ...s.brand, ...patch.brand };
          if (!BACKGROUNDS.some((x) => x.id === b.background)) b.background = s.brand.background;
          if (b.transition !== 'mixed' && !TRANSITIONS.some((t) => t.id === b.transition)) b.transition = s.brand.transition;
          b.camBubbles = !!b.camBubbles;
          if (!['br', 'bl', 'tr', 'tl'].includes(b.camBubbleCorner as string)) b.camBubbleCorner = s.brand.camBubbleCorner ?? 'br';
          b.camBubbleSize = Math.round(clampNum(b.camBubbleSize, 120, 400, s.brand.camBubbleSize ?? 220));
          b.sponsors = Array.isArray(b.sponsors) ? b.sponsors.map((x) => String(x).trim().slice(0, 90)).filter(Boolean).slice(0, 12) : [];
          s.brand = b;
        }
        if (patch.autopilot) {
          const was = s.autopilot.enabled;
          const prevAi = `${s.autopilot.writer}|${s.autopilot.voiceEngine}`;
          s.autopilot = sanitizeAutopilot(s.autopilot, patch.autopilot);
          if (`${s.autopilot.writer}|${s.autopilot.voiceEngine}` !== prevAi) s.aiStatus = undefined; // fresh status for the new engines
          r.automation.refreshPlaylist();
          if (!was && s.autopilot.enabled) {
            r.commentator.intro(r.latestMatch, s.brand.title);
            void r.autoMatch(true);
          }
          if (was && !s.autopilot.enabled && s.music.playing && s.autopilot.autoMusic) s.music = { ...s.music, playing: false };
        }
        if (patch.countdownTo !== undefined) s.countdownTo = patch.countdownTo;
        if (patch.banner !== undefined) {
          const kind = patch.banner?.kind;
          s.banner = kind === 'sponsor' || kind === 'quickScore' ? { kind, since: Date.now() } : null;
        }
        if (patch.spotlightId !== undefined) s.spotlightId = patch.spotlightId;
        if (typeof patch.name === 'string' && patch.name.trim()) s.name = patch.name.trim().slice(0, 80);
        if (patch.matchKey !== undefined && patch.matchKey !== s.matchKey) r.setMatch(patch.matchKey);
        if (patch.countdownTo !== undefined && patch.countdownTo && r.latestMatch) r.commentator.countdownSet(r.latestMatch);
        r.commit();
        ack({ ok: true });
      }),
    );

    socket.on(
      'studio:stage',
      asHost((r, { participantId, onStage }: { participantId: string; onStage: boolean }, ack: Ack = noop) => {
        const p = r.state.participants.find((x) => x.id === participantId);
        if (!p || p.role === 'program') return ack({ ok: false, error: 'Not found' });
        p.onStage = onStage;
        r.automation.refreshPlaylist();
        r.commit();
        ack({ ok: true });
      }),
    );

    socket.on(
      'studio:kick',
      asHost((r, { participantId }: { participantId: string }, ack: Ack = noop) => {
        const target = io.sockets.sockets.get(participantId);
        if (target && (target.data as SocketData).studioId === r.state.id && participantId !== socket.id) {
          target.emit('studio:kicked');
          target.disconnect(true);
        }
        ack({ ok: true });
      }),
    );

    socket.on(
      'participant:muteRequest',
      asHost((r, { participantId }: { participantId: string }) => {
        if (r.state.participants.some((p) => p.id === participantId)) io.to(participantId).emit('participant:muteRequest');
      }),
    );

    socket.on(
      'automation:accept',
      asHost((r, { event }: { event: CricketEvent }, ack: Ack = noop) => {
        r.automation.applyEvent(event);
        ack({ ok: true });
      }),
    );

    socket.on(
      'dev:simulate',
      asHost((r, { type }: { type: CricketEvent['type'] }, ack: Ack = noop) => {
        ack({ ok: true, event: r.simulate(type) });
      }),
    );

    socket.on(
      'demo:step',
      asHost((_r, { n = 1 }: { n?: number }, ack: Ack = noop) => {
        hub.demoStep(Math.max(1, Math.min(30, n)));
        ack({ ok: true });
      }),
    );

    socket.on(
      'commentary:say',
      asHost((r, { text }: { text: string }, ack: Ack = noop) => {
        const t = String(text ?? '').trim().slice(0, 300);
        if (t) r.speakText(t, 3);
        ack({ ok: true });
      }),
    );

    /* ---------------- participants ---------------- */

    socket.on('participant:update', (patch: Partial<Pick<Participant, 'muted' | 'camOff' | 'screenSharing' | 'name'>>) => {
      const r = room();
      const p = self();
      if (!r || !p) return;
      if (typeof patch.muted === 'boolean') p.muted = patch.muted;
      if (typeof patch.camOff === 'boolean') p.camOff = patch.camOff;
      if (typeof patch.screenSharing === 'boolean') p.screenSharing = patch.screenSharing;
      if (typeof patch.name === 'string' && patch.name.trim()) p.name = patch.name.trim().slice(0, 40);
      r.commit();
    });

    socket.on('rtc:signal', (msg: { to: string; data: unknown }) => {
      const r = room();
      if (!r || !msg?.to) return;
      const target = io.sockets.sockets.get(msg.to);
      if (!target || (target.data as SocketData).studioId !== r.state.id) return;
      target.emit('rtc:signal', { from: socket.id, data: msg.data });
    });

    socket.on('chat:send', ({ text }: { text: string }) => {
      const r = room();
      if (!r || !text?.trim() || data.role === 'program') return;
      const msg: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        from: data.name ?? 'Anon',
        role: data.role ?? 'guest',
        text: text.trim().slice(0, 500),
        ts: Date.now(),
      };
      r.chat.push(msg);
      if (r.chat.length > 200) r.chat.shift();
      io.to(r.roomName).emit('chat:msg', msg);
    });

    let lastCaption = 0;
    socket.on('captions:text', ({ text, final }: { text: string; final: boolean }) => {
      const r = room();
      if (!r || !text) return;
      const now = Date.now();
      if (!final && now - lastCaption < 250) return;
      lastCaption = now;
      io.to(r.roomName).emit('captions:text', { from: data.name ?? '', text: String(text).slice(-200), final: !!final, ts: now });
    });

    // live captions via a cloud STT engine: the browser sends one spoken phrase (16 kHz mono WAV)
    let sttBusy = false;
    socket.on('stt:segment', async (audio: ArrayBuffer | Buffer, ack: Ack = noop) => {
      const r = room();
      const me = self();
      if (!r || !me || !r.state.brand.captions || r.state.stt.provider === 'browser') return ack({ ok: false, error: 'Cloud captions off' });
      const wav = Buffer.isBuffer(audio) ? audio : Buffer.from(audio ?? new ArrayBuffer(0));
      if (wav.length < 1000 || wav.length > 2_000_000) return ack({ ok: false, error: 'Bad audio size' });
      if (sttBusy) return ack({ ok: false, error: 'busy' });
      sttBusy = true;
      try {
        const { text, provider } = await r.transcribe(wav);
        if (text) io.to(r.roomName).emit('captions:text', { from: data.name ?? '', text: text.slice(-200), final: true, ts: Date.now() });
        ack({ ok: true, text, provider });
      } catch (e) {
        ack({ ok: false, error: (e as Error).message });
      } finally {
        sttBusy = false;
      }
    });

    // AssemblyAI: Universal-Streaming temp token for realtime captions (anyone on stage)
    socket.on('stt:token', async (_p: unknown, ack: Ack = noop) => {
      const r = room();
      if (!r || !self()) return ack({ ok: false, error: 'Not in a studio' });
      try {
        ack({ ok: true, token: await r.sttToken() });
      } catch (e) {
        ack({ ok: false, error: (e as Error).message });
      }
    });

    // realtime caption text from AssemblyAI streaming (partials + finals) -> everyone + program output
    socket.on('stt:caption', ({ text, final }: { text: string; final: boolean }) => {
      const r = room();
      if (!r || typeof text !== 'string' || !text.trim()) return;
      io.to(r.roomName).emit('captions:text', { from: data.name ?? '', text: text.slice(-200), final: !!final, ts: Date.now() });
    });

    // AssemblyAI Voice Agent: talk to the commentator (anyone in the studio)
    socket.on('agent:session', async (_p: unknown, ack: Ack = noop) => {
      const r = room();
      if (!r) return ack({ ok: false, error: 'Not in a studio' });
      try {
        ack({ ok: true, ...(await r.agentSession()) });
      } catch (e) {
        ack({ ok: false, error: (e as Error).message });
      }
    });
    socket.on('agent:context', (_p: unknown, ack: Ack = noop) => {
      const r = room();
      ack(r ? { ok: true, context: r.matchContext() } : { ok: false });
    });

    // AssemblyAI LLM Gateway: studio recap + hands-free voice commands (host)
    socket.on('ai:recap', asHost(async (r, _p: unknown, ack: Ack = noop) => ack(await r.recap(true))));
    socket.on(
      'voice:command',
      asHost(async (r, p: { text: string }, ack: Ack = noop) => {
        if (typeof p?.text !== 'string' || !p.text.trim()) return ack({ ok: false, error: 'Empty command' });
        ack(await r.voiceCommand(p.text.slice(0, 300)));
      }),
    );

    // AssemblyAI voice for a commentary line (only lines this room actually spoke)
    socket.on('commentary:tts', async ({ id }: { id: string }, ack: Ack = noop) => {
      const r = room();
      if (!r || typeof id !== 'string') return ack({ ok: false });
      const audio = await r.ttsLine(id);
      ack(audio ? { ok: true, audio } : { ok: false });
    });

    // speech/AI keys + settings go through the host socket so they land on the instance that owns the room
    socket.on(
      'stt:save',
      asHost(async (r, p: Parameters<StudioRoom['setStt']>[0] = {}, ack: Ack = noop) => {
        ack({ ok: true, stt: r.setStt(p ?? {}) });
      }),
    );
    socket.on(
      'stt:test',
      asHost(async (r, p: { provider: CloudStt; key?: string }, ack: Ack = noop) => {
        if (!CLOUD_STT.includes(p?.provider)) return ack({ ok: false, error: 'Unknown provider', ms: 0 });
        ack(await r.testStt(p.provider, p.key));
      }),
    );

    socket.on(
      'commentary:test',
      asHost(async (r, _p: unknown, ack: Ack = noop) => {
        const t = await r.testCommentary();
        ack({ ok: true, ...t });
      }),
    );

    socket.on('livekit:token', async (_: unknown, ack: Ack = noop) => {
      const r = room();
      if (!r || !livekit.enabled) return ack({ ok: false, error: 'LiveKit disabled' });
      try {
        const token = await livekit.token(r.state.id, socket.id, data.name ?? '', data.role !== 'program');
        ack({ ok: true, token, url: config.livekit.url });
      } catch (e) {
        ack({ ok: false, error: (e as Error).message });
      }
    });

    /* ---------------- going live ---------------- */

    socket.on(
      'stream:start',
      asHost(async (r, opts: { broadcaster?: 'host' | 'cloud'; programToken?: string } = {}, ack: Ack = noop) => {
        if (livekit.enabled) {
          const targets = await r.loadTargets();
          if (!targets.length) return ack({ ok: false, error: 'Add and enable at least one destination.' });
          const url = `${config.publicUrl}/program/${r.state.id}?k=${encodeURIComponent(opts.programToken ?? '')}`;
          await livekit.startEgress(r.state.id, url, targets);
          r.state.wantLive = true;
          r.state.live = {
            state: 'live',
            mode: 'livekit',
            broadcaster: 'cloud',
            startedAt: Date.now(),
            destinations: targets.map((t) => ({ id: t.id, platform: t.platform, name: t.name, state: 'live' })),
          };
          r.commit();
          return ack({ ok: true, mode: 'livekit' });
        }
        const broadcaster = opts.broadcaster === 'cloud' ? 'cloud' : 'host';
        const res = await r.startLive(broadcaster);
        ack({ ...res, mode: 'mesh', broadcaster });
      }),
    );

    const isProducer = (r: StudioRoom) =>
      !!r.pipeline?.running &&
      ((r.state.live.broadcaster === 'host' && data.role === 'host') || (r.state.live.broadcaster === 'cloud' && !!data.producer));

    /** producer's MediaRecorder (re)started → next chunk is a fresh WebM header */
    socket.on('ingest:reset', (info?: { mime?: string }) => {
      const r = room();
      if (r && isProducer(r)) r.pipeline!.resetIngest(info?.mime);
    });

    socket.on('ingest:chunk', (chunk: ArrayBuffer | Buffer) => {
      const r = room();
      if (!r || !isProducer(r)) return;
      r.pipeline!.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    socket.on('producer:heartbeat', (h: { fps: number; heapMb: number }) => {
      const r = room();
      if (r && data.producer) r.cloud?.heartbeat({ fps: Number(h?.fps) || 0, heapMb: Number(h?.heapMb) || 0 });
    });

    socket.on(
      'stream:stop',
      asHost(async (r, _opts: unknown, ack: Ack = noop) => {
        if (livekit.enabled) await livekit.stopEgress(r.state.id);
        await r.stopLive();
        ack({ ok: true });
      }),
    );
  });
}
