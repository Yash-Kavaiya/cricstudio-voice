// AI commentary: AssemblyAI LLM Gateway writes the line, AssemblyAI TTS speaks it.
// Both are optional — the commentator falls back to templates and free Edge voices.
import type { CricketEvent, MatchDetail } from '@cricstudio/shared';
import { minutesToStart } from './commentator';
import { speakable } from './tts';
import { llm, speech } from '../assemblyai';

const LANG_NAMES: Record<string, string> = {
  'en-IN': 'Indian English (a little Hinglish flavour is fine)',
  'en-GB': 'British English',
  'en-US': 'American English',
  'en-AU': 'Australian English',
  'hi-IN': 'Hindi (Devanagari script)',
  'bn-IN': 'Bengali',
  'gu-IN': 'Gujarati',
  'kn-IN': 'Kannada',
  'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi',
  'pa-IN': 'Punjabi (Gurmukhi script)',
  'ta-IN': 'Tamil',
  'te-IN': 'Telugu',
};

/** Compact, factual match context so the model never has to guess numbers. */
export function matchFacts(d: MatchDetail | null, countdownTo: number | null = null): string {
  if (!d) return 'No live match attached.';
  const mins = minutesToStart(d, countdownTo);
  const captains = d.teams.map((t) => ({ t: t.name, c: t.squad.find((p) => p.captain)?.name })).filter((x) => x.c);
  const squads = d.teams.filter((t) => t.squad.length).map((t) => `${t.name} players: ${t.squad.slice(0, 11).map((p) => p.name).join(', ')}.`);
  const inn = d.innings.find((i) => i.number === d.currentInnings) ?? d.innings.at(-1);
  const bat = d.teams.find((t) => t.id === d.battingTeamId);
  const lines = [
    `Match: ${d.title}, ${d.description}${d.venue ? ` at ${d.venue}` : ''}.`,
    d.statusText && `Status: ${d.statusText}.`,
    d.series && `Series: ${d.series}.`,
    d.state === 'pre' && `Stage: pre-match build-up, the first ball has not been bowled${mins != null ? `; starts in about ${mins} minutes` : ''}.`,
    d.toss && `Toss: ${d.toss}.`,
    ...captains.map((x) => `${x.t} captain: ${x.c}.`),
    ...(d.state === 'pre' ? squads : []),
    inn && `${inn.teamName}: ${inn.runs}/${inn.wickets} in ${inn.overs} overs${inn.target ? `, chasing ${inn.target}` : ''}.`,
    d.need && `Need ${d.need.runs} from ${d.need.balls} balls${d.rrr ? ` (required rate ${d.rrr.toFixed(2)})` : ''}.`,
    d.crr ? `Current run rate ${d.crr.toFixed(2)}.` : '',
    ...d.currentBatters.map((b) => `Batter ${b.name}: ${b.runs} (${b.balls}b, ${b.fours}x4, ${b.sixes}x6).`),
    d.currentBowler && `Bowler ${d.currentBowler.name}: ${d.currentBowler.wickets}/${d.currentBowler.conceded} in ${d.currentBowler.overs} overs.`,
    d.partnership?.balls ? `Partnership ${d.partnership.runs} off ${d.partnership.balls}.` : '',
    d.recentBalls?.length ? `Last balls (oldest first): ${d.recentBalls.slice(-6).map((b) => `${b.over} ${b.short || b.label}`).join(' | ')}.` : '',
    bat && d.summary ? `Summary: ${d.summary}.` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

export function eventFacts(ev: CricketEvent | null, d: MatchDetail | null = null): string {
  if (!ev && d?.state === 'pre') return 'Pre-match build-up — preview this match, a player to watch, or ask viewers a question that names both teams.';
  if (!ev) return 'Quiet spell between deliveries — offer insight, a stat-driven observation or a question to viewers about this match.';
  const parts = [`Event: ${ev.type} — ${ev.title}`, ev.subtitle, ev.player && `player ${ev.player}`, ev.value != null && `value ${ev.value}`, ev.ball?.text && `delivery: ${ev.ball.text}`];
  return parts.filter(Boolean).join(', ') + '.';
}

export async function aaiCommentary(opts: {
  key: string;
  model: string;
  language: string;
  facts: string;
  event: string;
  fallback: string;
  recent: string[];
  timeoutMs?: number;
}): Promise<string> {
  const lang = LANG_NAMES[opts.language] ?? opts.language;
  const system = [
    'You are the lead TV commentator on a live cricket broadcast — energetic, knowledgeable, natural, never robotic.',
    `Write ONE spoken line (max 32 words) in ${lang} for this exact moment. It is read aloud by a text-to-speech voice.`,
    'Use ONLY the facts given; never invent scores, names, results or numbers. No hashtags, emojis, quotes, stage directions or labels.',
    'Talk ONLY about this match and its two teams. Never mention any other match, fixture, team or score elsewhere.',
    'Sound personal and warm: speak to the viewers directly, and when you ask them something, name the teams or players involved.',
  ].join('\n');
  const user = [
    'MATCH FACTS:',
    opts.facts,
    '',
    `MOMENT: ${opts.event}`,
    `(A plain, correct version for reference: "${opts.fallback}")`,
    opts.recent.length ? `Do not repeat these recent lines:\n${opts.recent.slice(-5).map((r) => `- ${r}`).join('\n')}` : '',
  ].join('\n');
  const { text } = await llm(opts.key, [{ role: 'system', content: system }, { role: 'user', content: user }], { model: opts.model, maxTokens: 160, temperature: 0.7, timeoutMs: opts.timeoutMs ?? 7000 });
  return text.slice(0, 320);
}

/** AssemblyAI TTS (Voice Agent API voices) → 24 kHz mono WAV. */
export async function aaiSpeech(opts: { key: string; text: string; voice: string; excited?: boolean }): Promise<Buffer> {
  return speech(opts.key, speakable(opts.text), opts.voice, { excited: opts.excited });
}

/** 45-60 word studio recap of the match so far, written by LLM Gateway. */
export async function aaiRecap(opts: { key: string; model: string; facts: string; recent: string[] }): Promise<string> {
  const { text } = await llm(opts.key, [
    { role: 'system', content: 'You are a cricket studio presenter. Give a 45-70 word spoken recap: where the match stands, momentum, key moments and what to watch next. Plain spoken English for text-to-speech, no lists, no emojis. Use only the facts given.' },
    { role: 'user', content: `${opts.facts}\nRecent commentary:\n${opts.recent.slice(-12).join('\n')}` },
  ], { model: opts.model, maxTokens: 260, temperature: 0.6, timeoutMs: 12000 });
  return text;
}
