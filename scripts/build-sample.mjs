// Captures a real finished match from the ESPN feed into data/sample-match.json for the offline demo replay.
// Usage: node scripts/build-sample.mjs <league> <event> [lastNBalls]
import { writeFileSync } from 'node:fs';
import { getJson, ESPN_SITE, normalizeBall, listMatches } from '../api/_lib.js';
const [league = '22804', event = '1558406', n = '36'] = process.argv.slice(2);
const first = await getJson(`${ESPN_SITE}/${league}/playbyplay?event=${event}&page=1`);
const pages = first.commentary.pageCount;
let items = [];
for (let p = Math.max(1, pages - 2); p <= pages; p++) items.push(...(await getJson(`${ESPN_SITE}/${league}/playbyplay?event=${event}&page=${p}`)).commentary.items);
const balls = items.map(normalizeBall).sort((a, b) => a.seq - b.seq).slice(-Number(n));
const meta = (await listMatches()).find((m) => m.event === event) || null;
writeFileSync(new URL('../public/sample-match.json', import.meta.url), JSON.stringify({ league, event, meta, balls }, null, 1));
console.log(`saved ${balls.length} balls`, meta?.name, '|', meta?.summary);
