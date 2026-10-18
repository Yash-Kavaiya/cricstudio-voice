import { llmGateway, readBody, send } from './_lib.js';
// Match-so-far recap for the "Studio recap" button, written by the LLM Gateway.
export default async function handler(req, res) {
  const { match = {}, balls = [] } = await readBody(req);
  try {
    const out = await llmGateway([
      { role: 'system', content: 'You are a cricket studio presenter. Give a 45-60 word spoken recap of the passage of play: momentum, key moments, what to watch next. Plain spoken English for text-to-speech, no lists, no emojis.' },
      { role: 'user', content: `${match.title || ''}\n${match.summary || ''}\n${balls.map((b) => `${b.over} ${b.short}${b.wicket ? ' WICKET ' + b.wicketText : ''} (${b.team} ${b.score})`).join('\n')}` },
    ], { max_tokens: 220, temperature: 0.7 });
    send(res, 200, { recap: out.text, model: out.model, ms: out.ms });
  } catch (e) { send(res, 502, { error: String(e.message || e) }); }
}
