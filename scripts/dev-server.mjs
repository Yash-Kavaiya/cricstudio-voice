// Tiny local server that mimics Vercel: static files from /public and functions from /api.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif' };
http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path.startsWith('/api/')) {
      const mod = await import(join(root, 'api', path.slice(5).replace(/\/$/, '') + '.js'));
      return await mod.default(req, res);
    }
    const file = join(root, 'public', path === '/' ? 'index.html' : path);
    const buf = await readFile(file);
    res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
    res.end(buf);
  } catch (e) { res.statusCode = 404; res.end(String(e.message)); }
}).listen(process.env.PORT || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`));
