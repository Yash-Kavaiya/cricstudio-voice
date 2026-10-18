import { llmGateway, readBody, send } from './_lib.js';

const STYLES = {
  classic: 'Measured, warm, classic BBC Test Match Special style. Elegant phrasing, light wit.',
  hype: 'High-energy T20 hype-man. Short punchy bursts, big exclamations on boundaries and wickets.',
  analyst: 'Tactical analyst. Mention field, match situation, run rate and pressure in one crisp insight.',
  desi: 'Indian TV commentator flavour in English, with the odd Hindi exclamation like "kya shot hai!" or "arre wah!". Keep it understandable.',
};

// Writes ONE spoken commentary line for a ball using AssemblyAI's LLM Gateway.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const { ball, match = {}, recent = [], style = 'classic' } = await readBody(req);
  if (!ball) return send(res, 400, { error: 'ball required' });
  const situation = [
    match.title && `Match: ${match.title}`,
    match.summary && `Situation: ${match.summary}`,
    `Over ${ball.over}: ${ball.short}${ball.text ? ' — ' + ball.text : ''}`,
    `Outcome of this ball: ${ball.wicket ? 'WICKET' : ball.six ? 'SIX' : ball.four ? 'FOUR' : ball.type || ball.runs + ' runs'} (${ball.runs} run${ball.runs === 1 ? '' : 's'} scored)`,
    ball.wicket && `Dismissal: ${ball.wicketText}`,
    `Batting side: ${ball.team}. Score now ${ball.team} ${ball.score}${ball.runRate ? ` (RR ${ball.runRate})` : ''}${ball.target ? `, target ${ball.target}` : ''}`,
    ball.batter && `Batter ${ball.batter} ${ball.batterRuns ?? ''}${ball.batterBalls != null ? ` off ${ball.batterBalls}` : ''}`,
    ball.bowler && `Bowler ${ball.bowler} ${ball.bowlerFigures}`,
    ball.overComplete && `End of over, ${ball.overRuns} runs from it.`,
    recent.length && `Previous balls: ${recent.slice(-6).join(' | ')}`,
  ].filter(Boolean).join('\n');
  const len = ball.wicket || ball.six || ball.four || ball.overComplete ? '20-32 words' : '8-16 words';
  try {
    const out = await llmGateway([
      { role: 'system', content: `You are a live cricket TV commentator. ${STYLES[style] || STYLES.classic}\nDescribe ONLY what the data says happened on this ball (same runs, same outcome), then optionally one short reaction. Write exactly one spoken line (${len}) for the latest ball. It will be read aloud by a text-to-speech voice, so: no emojis, no hashtags, no stage directions, no quotation marks, write numbers the way a commentator says them. Never invent facts beyond the data: do not claim a result unless the situation says the match is won, and keep the batting side and bowling side straight.` },
      { role: 'user', content: situation },
    ], { temperature: 0.5 });
    send(res, 200, { line: out.text.replace(/^["']|["']$/g, ''), model: out.model, ms: out.ms });
  } catch (e) {
    // Graceful fallback so the broadcast never goes silent.
    send(res, 200, { line: ball.wicket ? `Wicket! ${ball.wicketText}` : ball.short, model: 'fallback', ms: 0, error: String(e.message || e) });
  }
}
