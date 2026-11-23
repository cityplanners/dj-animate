import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('web');
const args = process.argv.slice(2);
const arg = key => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; };
const port = Number(arg('--port') || process.env.PORT || 3000);
const host = arg('--host') || '0.0.0.0';
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.mp3': 'audio/mpeg', '.json': 'application/json', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  try {
    const uri = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const file = path.resolve(root, '.' + (uri === '/' ? '/index.html' : uri));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, host, () => console.log(`dj-animate listening on ${host}:${port}`));
