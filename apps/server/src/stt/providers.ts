// Speech-to-text for live captions, powered by AssemblyAI.
//  • Realtime: browsers stream mic audio straight to Universal-Streaming with a temporary token
//    minted here (see 'stt:token'), so captions appear word-by-word.
//  • Phrase mode / "Test key": a 16 kHz WAV phrase goes through AssemblyAI async STT.
// API keys never leave the server.
import type { MatchDetail, SttProvider } from '@cricstudio/shared';
import { transcribe } from '../assemblyai';

export type CloudStt = Exclude<SttProvider, 'browser'>;
export const CLOUD_STT: CloudStt[] = ['assemblyai'];

export interface SttRequest {
  wav: Buffer;
  language: string; // BCP-47, e.g. en-IN
  key: string;
  /** cricket words + player names to boost (AssemblyAI keyterms) */
  hints: string[];
}

export async function transcribeWith(_provider: CloudStt, r: SttRequest): Promise<string> {
  const t = await transcribe(r.key, r.wav, { language: r.language, keyterms: r.hints });
  return String(t?.text ?? '').trim();
}

const CRICKET_TERMS = [
  'wicket', 'boundary', 'four', 'six', 'LBW', 'leg before', 'caught', 'bowled', 'stumped', 'run out', 'no ball', 'wide',
  'leg bye', 'maiden', 'over', 'powerplay', 'yorker', 'bouncer', 'googly', 'doosra', 'cover drive', 'pull shot',
  'sweep', 'reverse sweep', 'slip', 'gully', 'mid-wicket', 'third man', 'fine leg', 'square leg', 'mid-on', 'mid-off',
  'run rate', 'required rate', 'DRS', 'umpire', 'innings', 'century', 'fifty', 'hat-trick', 'free hit', 'death overs',
];

/** Vocabulary hints: cricket terms plus the names in the current match. */
export function cricketHints(m: MatchDetail | null): string[] {
  const names = new Set<string>();
  if (m) {
    for (const t of m.teams ?? []) {
      if (t?.name) names.add(t.name);
      if (t?.abbr) names.add(t.abbr);
    }
    for (const inn of m.innings ?? []) {
      for (const b of inn.batting ?? []) if (b?.name) names.add(b.name);
      for (const b of inn.bowling ?? []) if (b?.name) names.add(b.name);
    }
  }
  return [...names, ...CRICKET_TERMS];
}

/** A tiny valid 16 kHz WAV (0.5 s of silence) used by "Test key". */
export function silentWav(seconds = 0.5): Buffer {
  const n = Math.round(16000 * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  return b;
}
