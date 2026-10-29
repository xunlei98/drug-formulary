// Serves public/ with the same headers as Firebase Hosting, plus the emulator origins in connect-src.
// Used by `npm run dev` and the e2e tests. On localhost the app talks to the emulators only.
//   node scripts/serve-local.js [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pub = path.join(root, 'public');
const hosting = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8')).hosting;
const base = Object.fromEntries(hosting.headers[0].headers.map((h) => [h.key, h.value]));
const host = (h) => `http://${h}:9099 http://${h}:8080`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' };

export function startStatic(port = 5055) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(pub, decodeURIComponent(url.pathname));
    if (!file.startsWith(pub)) { res.writeHead(403).end(); return; }
    if (url.pathname === '/' || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(pub, 'index.html');
    const csp = base['Content-Security-Policy'].replace('connect-src', `connect-src ${host('localhost')} ${host('127.0.0.1')}`);
    res.writeHead(200, { ...base, 'Content-Security-Policy': csp, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === import.meta.filename) {
  const port = Number(process.argv[2]) || 5055;
  await startStatic(port);
  console.log(`http://127.0.0.1:${port} (emulators: auth 9099, firestore 8080)`);
}
