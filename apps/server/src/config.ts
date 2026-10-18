import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = resolve(here, '..');
export const REPO_ROOT = resolve(SERVER_ROOT, '..', '..');

for (const f of [resolve(REPO_ROOT, '.env'), resolve(SERVER_ROOT, '.env')]) {
  if (existsSync(f)) {
    try {
      process.loadEnvFile(f);
    } catch {
      /* ignore malformed env */
    }
  }
}

const env = process.env;
const int = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  port: int(env.PORT, 8787),
  host: env.HOST ?? '0.0.0.0',
  publicUrl: env.PUBLIC_URL ?? `http://localhost:${int(env.WEB_PORT, 5180)}`,
  dataDir: resolve(REPO_ROOT, env.DATA_DIR ?? 'data'),
  webDist: resolve(REPO_ROOT, 'apps', 'web', 'dist'),
  demoDir: resolve(SERVER_ROOT, 'demo'),
  streamKeySecret: env.STREAM_KEY_SECRET ?? '',
  /** REDIS_URL, or KV_URL as injected by the Upstash integration on Vercel */
  redisUrl: env.REDIS_URL || env.KV_URL || '',
  databaseUrl: env.DATABASE_URL ?? '',
  mediaMode: (env.MEDIA_MODE === 'livekit' ? 'livekit' : 'mesh') as 'mesh' | 'livekit',
  livekit: {
    url: env.LIVEKIT_URL ?? '',
    apiKey: env.LIVEKIT_API_KEY ?? '',
    apiSecret: env.LIVEKIT_API_SECRET ?? '',
  },
  turn: {
    url: env.TURN_URL ?? '',
    username: env.TURN_USERNAME ?? '',
    credential: env.TURN_CREDENTIAL ?? '',
  },
  ffmpegPath: env.FFMPEG_PATH ?? 'ffmpeg',
  /** serverless hosts (Vercel) cut connections after a few minutes — refuse to start RTMP streams there */
  streamingDisabled: env.STREAMING_DISABLED === '1',
  videoBitrateKbps: int(env.VIDEO_BITRATE_KBPS, 4500),
  audioBitrateKbps: int(env.AUDIO_BITRATE_KBPS, 160),
  x264Preset: env.X264_PRESET ?? 'veryfast',
  /** auto = pass H.264 from the browser straight through; x264 = always re-encode */
  encoderMode: (env.ENCODER_MODE === 'x264' ? 'x264' : 'auto') as 'auto' | 'x264',
  pollLiveMs: int(env.POLL_LIVE_MS, 6000),
  pollIdleMs: int(env.POLL_IDLE_MS, 60000),
  scorepanelTtlMs: int(env.SCOREPANEL_TTL_MS, 20000),
  demoBallMs: int(env.DEMO_BALL_MS, 4500),
  /** headless Chrome/Chromium used by the 24/7 cloud producer */
  chromePath: env.CHROME_PATH ?? '',
  /** URL the cloud worker opens (defaults to this server when the web build exists, else the Vite dev server) */
  internalWebUrl: env.INTERNAL_WEB_URL ?? '',
  /** recycle the headless producer every N hours to keep memory flat (relays keep RTMP connected) */
  workerRecycleHours: Number(env.WORKER_RECYCLE_HOURS ?? 6),
  workerMaxHeapMb: int(env.WORKER_MAX_HEAP_MB, 900),
  /** failover: if the host's browser drops while live, hand the show to the cloud producer after N ms */
  hostFailoverMs: int(env.HOST_FAILOVER_MS, 8000),
  ttsVoice: env.TTS_VOICE ?? 'en-IN-PrabhatNeural',
  /** per-process secret the cloud producer uses to join studios (never leaves the server) */
  workerSecret: randomBytes(24).toString('base64url'),
};

for (const d of [config.dataDir, resolve(config.dataDir, 'uploads')]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

export function iceServers() {
  const list: { urls: string | string[]; username?: string; credential?: string }[] = [
    { urls: ['stun:stun.cloudflare.com:3478'] },
  ];
  if (config.turn.url) list.push({ urls: config.turn.url, username: config.turn.username, credential: config.turn.credential });
  return list;
}
