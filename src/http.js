import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const reply = (data, { status = 200, headers = {} } = {}) => ({ __reply: true, data, status, headers });

export function compile(routes) {
  return routes.map(([method, pattern, handler, perm]) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    return { method, re, keys, handler, perm };
  });
}

export function match(table, method, pathname) {
  for (const r of table) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname);
    if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export async function readJson(req, limit = 8_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Request too large');
    chunks.push(c);
  }
  if (!size) return {};
  if (!(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'JSON only');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Bad JSON');
  }
}

export function sendJson(req, res, status, data, headers = {}) {
  const body = Buffer.from(JSON.stringify(data));
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers };
  if (body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    h['content-encoding'] = 'gzip';
    res.writeHead(status, h);
    res.end(zlib.gzipSync(body));
  } else {
    res.writeHead(status, h);
    res.end(body);
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

export function serveStatic(req, res, roots, pathname, transform) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  for (const [prefix, dir] of roots) {
    if (!rel.startsWith(prefix)) continue;
    const file = path.join(dir, rel.slice(prefix.length));
    if (!file.startsWith(dir + path.sep)) return false;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    let body = fs.readFileSync(file);
    if (transform) body = transform(rel, body);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
    return true;
  }
  return false;
}
