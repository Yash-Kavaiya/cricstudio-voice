import { createWriteStream, existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PLATFORM_PRESETS, type DestinationPublic, type Platform, type StudioCreateResponse, type SttProvider } from '@cricstudio/shared';
import { CLOUD_STT, type CloudStt } from './stt/providers';
import { config } from './config';
import { envKey, speech } from './assemblyai';
import { AAI_VOICES } from '@cricstudio/shared';
import { DEMO_KEY } from './espn/demo';
import type { MatchHub } from './espn/hub';
import { decrypt, encrypt, hashToken, maskKey, newId, newToken, tokenMatches } from './store/crypto';
import type { DestinationRecord, Repo } from './store/repo';
import type { TtsService } from './commentary/tts';
import type { StudioManager } from './studio/manager';

const PLATFORMS = Object.keys(PLATFORM_PRESETS) as Platform[];
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.webm', '.flac']);

const toPublic = (d: DestinationRecord): DestinationPublic => {
  let keyMasked = '••••';
  try {
    keyMasked = maskKey(decrypt(d.keyEnc));
  } catch {
    /* secret rotated */
  }
  return { id: d.id, platform: d.platform, name: d.name, url: d.url, keyMasked, enabled: d.enabled };
};

export function registerHttp(app: FastifyInstance, hub: MatchHub, repo: Repo, studios: StudioManager, tts: TtsService) {
  const hostGuard = async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const studio = await repo.getStudio(req.params.id);
    const token = (req.headers['x-host-token'] as string | undefined) ?? '';
    if (!studio || !tokenMatches(token, studio.hostTokenHash)) {
      const err = new Error('Unauthorized') as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }
    return studio;
  };

  /* ---------------- AssemblyAI (server key) ---------------- */
  app.get('/api/assemblyai/status', async () => ({ configured: !!envKey(), products: ['voice-agent-tts', 'universal-streaming', 'async-stt', 'llm-gateway'] }));
  // AssemblyAI text-to-speech as WAV — e.g. curl "/api/aai/tts?text=What%20a%20finish&voice=charles" -o a.wav
  const aaiHits = new Map<string, number[]>();
  app.get<{ Querystring: { text?: string; voice?: string } }>('/api/aai/tts', async (req, reply) => {
    const key = envKey();
    if (!key) return reply.code(503).send({ error: 'ASSEMBLYAI_API_KEY is not configured' });
    const now = Date.now();
    const hits = (aaiHits.get(req.ip) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= 10) return reply.code(429).send({ error: 'Slow down — 10 requests per minute' });
    aaiHits.set(req.ip, [...hits, now]);
    const text = String(req.query.text || 'Welcome to CricStudio Voice — live cricket, called by AssemblyAI.').slice(0, 400);
    const voice = AAI_VOICES.some((v) => v.id === req.query.voice) ? req.query.voice! : 'charles';
    try {
      const wav = await speech(key, text, voice);
      return reply.header('content-type', 'audio/wav').header('cache-control', 'no-store').send(wav);
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.get('/api/health', async () => ({
    ok: true,
    mediaMode: config.mediaMode,
    pollers: hub.stats(),
    studios: studios.stats(),
    uptime: process.uptime(),
  }));

  /* ---------------- AI commentator voice (free neural TTS) ---------------- */

  const ttsHits = new Map<string, { n: number; t: number }>();
  app.get<{ Querystring: { text?: string; voice?: string; rate?: string } }>('/api/tts', async (req, reply) => {
    const text = (req.query.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'text required' });
    // ~60 lines/minute per client is plenty for a commentator
    const ip = req.ip;
    const now = Date.now();
    const h = ttsHits.get(ip) ?? { n: 0, t: now };
    if (now - h.t > 60_000) Object.assign(h, { n: 0, t: now });
    if (++h.n > 60) return reply.code(429).send({ error: 'slow down' });
    ttsHits.set(ip, h);
    if (ttsHits.size > 5000) ttsHits.clear();
    const rate = /^[+-]\d{1,2}%$/.test(req.query.rate ?? '') ? req.query.rate! : '+4%';
    try {
      const buf = await tts.synth(text, req.query.voice, rate);
      return reply.header('cache-control', 'public, max-age=86400').type('audio/mpeg').send(buf);
    } catch (e) {
      return reply.code(503).send({ error: `TTS unavailable: ${(e as Error).message}` });
    }
  });

  /* ---------------- matches ---------------- */

  app.get('/api/matches', async () => ({ matches: await hub.listMatches() }));

  app.get<{ Params: { league: string; event: string } }>('/api/matches/:league/:event', async (req, reply) => {
    const key = req.params.league === 'demo' ? DEMO_KEY : `${req.params.league}:${req.params.event}`;
    try {
      return { match: await hub.fetchDetail(key) };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  /* ---------------- studios ---------------- */

  app.post<{ Body: { name?: string; matchKey?: string | null } }>('/api/studios', async (req) => {
    const name = (req.body?.name ?? '').trim().slice(0, 80) || 'Cricket Live Show';
    const hostToken = newToken();
    const guestToken = newToken();
    const programToken = newToken();
    const id = newId();
    await repo.createStudio({
      id,
      name,
      matchKey: req.body?.matchKey ?? null,
      hostTokenHash: hashToken(hostToken),
      guestTokenHash: hashToken(guestToken),
      programTokenHash: hashToken(programToken),
      guestTokenEnc: encrypt(guestToken),
      settings: '{}',
      createdAt: Date.now(),
    });
    const res: StudioCreateResponse = { id, name, hostToken, guestToken: `${id}.${guestToken}`, programToken };
    return res;
  });

  app.get<{ Params: { id: string } }>('/api/studios/:id', async (req, reply) => {
    const s = await repo.getStudio(req.params.id);
    if (!s) return reply.code(404).send({ error: 'Not found' });
    return { id: s.id, name: s.name, matchKey: s.matchKey };
  });

  app.get<{ Params: { id: string } }>('/api/studios/:id/invite', async (req) => {
    const s = await hostGuard(req);
    return { guestToken: `${s.id}.${decrypt(s.guestTokenEnc)}` };
  });

  /* ---------------- destinations ---------------- */

  app.get<{ Params: { id: string } }>('/api/studios/:id/destinations', async (req) => {
    await hostGuard(req);
    return { destinations: (await repo.listDestinations(req.params.id)).map(toPublic) };
  });

  app.post<{ Params: { id: string }; Body: { platform: Platform; name?: string; url?: string; key: string; enabled?: boolean } }>(
    '/api/studios/:id/destinations',
    async (req, reply) => {
      await hostGuard(req);
      const b = req.body ?? ({} as any);
      if (!PLATFORMS.includes(b.platform)) return reply.code(400).send({ error: 'Unknown platform' });
      const url = (b.url || PLATFORM_PRESETS[b.platform].url).trim();
      if (!/^rtmps?:\/\//i.test(url)) return reply.code(400).send({ error: 'URL must start with rtmp:// or rtmps://' });
      if (!b.key?.trim() && b.platform !== 'custom') return reply.code(400).send({ error: 'Stream key is required' });
      const d: DestinationRecord = {
        id: newId(),
        studioId: req.params.id,
        platform: b.platform,
        name: (b.name || PLATFORM_PRESETS[b.platform].label).slice(0, 60),
        url,
        keyEnc: encrypt((b.key ?? '').trim()),
        enabled: b.enabled !== false,
        createdAt: Date.now(),
      };
      await repo.addDestination(d);
      return { destination: toPublic(d) };
    },
  );

  app.patch<{ Params: { id: string; did: string }; Body: { name?: string; url?: string; key?: string; enabled?: boolean } }>(
    '/api/studios/:id/destinations/:did',
    async (req, reply) => {
      await hostGuard(req);
      const b = req.body ?? {};
      if (b.url && !/^rtmps?:\/\//i.test(b.url)) return reply.code(400).send({ error: 'URL must start with rtmp:// or rtmps://' });
      await repo.updateDestination(req.params.did, req.params.id, {
        ...(b.name !== undefined ? { name: b.name.slice(0, 60) } : {}),
        ...(b.url !== undefined ? { url: b.url.trim() } : {}),
        ...(b.key ? { keyEnc: encrypt(b.key.trim()) } : {}),
        ...(b.enabled !== undefined ? { enabled: !!b.enabled } : {}),
      });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string; did: string } }>('/api/studios/:id/destinations/:did', async (req) => {
    await hostGuard(req);
    await repo.deleteDestination(req.params.did, req.params.id);
    return { ok: true };
  });

  /* ---------------- speech-to-text settings (live captions) ---------------- */

  // Keys are write-only: saved encrypted on the server, the browser only learns whether one is set.
  app.put<{ Params: { id: string }; Body: { provider?: SttProvider; language?: string; llmModel?: string; keys?: Partial<Record<CloudStt, string | null>> } }>(
    '/api/studios/:id/stt',
    async (req, reply) => {
      await hostGuard(req);
      const room = await studios.load(req.params.id);
      if (!room) return reply.code(404).send({ error: 'Studio not found' });
      return { stt: room.setStt(req.body ?? {}) };
    },
  );

  app.post<{ Params: { id: string }; Body: { provider: CloudStt; key?: string } }>('/api/studios/:id/stt/test', async (req, reply) => {
    await hostGuard(req);
    const room = await studios.load(req.params.id);
    if (!room) return reply.code(404).send({ error: 'Studio not found' });
    if (!CLOUD_STT.includes(req.body?.provider)) return reply.code(400).send({ error: 'Unknown provider' });
    return room.testStt(req.body.provider, req.body.key);
  });

  /* ---------------- music uploads ---------------- */

  app.post<{ Params: { id: string } }>('/api/studios/:id/music', async (req, reply) => {
    await hostGuard(req);
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file' });
    const ext = extname(file.filename).toLowerCase();
    if (!AUDIO_EXT.has(ext)) return reply.code(400).send({ error: 'Audio files only (mp3, wav, ogg, m4a, aac, flac)' });
    const name = `${req.params.id}-${newId()}${ext}`;
    await pipeline(file.file, createWriteStream(resolve(config.dataDir, 'uploads', name)));
    if (file.file.truncated) return reply.code(413).send({ error: 'File too large (max 40 MB)' });
    return { url: `/uploads/${name}`, title: file.filename.replace(/\.[^.]+$/, '') };
  });

  app.get<{ Params: { file: string } }>('/uploads/:file', async (req, reply) => {
    const f = req.params.file;
    if (!/^[\w.-]+$/.test(f)) return reply.code(400).send();
    const p = resolve(config.dataDir, 'uploads', f);
    if (!existsSync(p)) return reply.code(404).send();
    return reply.sendFile(f, resolve(config.dataDir, 'uploads'));
  });
}
