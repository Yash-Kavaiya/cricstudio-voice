// Translation of template commentary lines into the commentary language via AssemblyAI LLM Gateway.
// Needs an AssemblyAI key (studio key or ASSEMBLYAI_API_KEY); failures fall back to English.
import { envKey, llm } from '../assemblyai';

const cache = new Map<string, string>();
const MAX_CACHE = 2000;
let downUntil = 0;

const NAMES: Record<string, string> = { hi: 'Hindi (Devanagari)', bn: 'Bengali', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', pa: 'Punjabi (Gurmukhi)', ta: 'Tamil', te: 'Telugu' };

/** "hi-IN" -> "hi"; English variants need no translation */
export function targetCode(lang: string | undefined): string | null {
  const code = (lang ?? 'en-IN').split('-')[0].toLowerCase();
  return code && code !== 'en' ? code : null;
}

/** Translate an English commentary line into `lang` (BCP-47). Resolves to null when not needed or unavailable. */
export async function translateLine(text: string, lang: string | undefined, timeoutMs = 5000, key = envKey()): Promise<string | null> {
  const tl = targetCode(lang);
  if (!tl || !text.trim() || !key) return null;
  const k = `${tl}|${text}`;
  const hit = cache.get(k);
  if (hit) return hit;
  if (Date.now() < downUntil) return null;
  try {
    const { text: out } = await llm(key, [
      { role: 'system', content: `Translate the cricket commentary line into natural spoken ${NAMES[tl] ?? tl}. Keep player and team names. Reply with the translation only.` },
      { role: 'user', content: text },
    ], { maxTokens: 200, temperature: 0.2, timeoutMs });
    cache.set(k, out);
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
    return out;
  } catch {
    downUntil = Date.now() + 30_000;
    return null;
  }
}
