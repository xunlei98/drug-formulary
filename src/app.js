import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { can } from '../shared/perm.js';
import { HttpError, compile, match, readJson, sendJson, serveStatic } from './http.js';
import { userFromToken, parseCookies } from './auth.js';
import { authRoutes } from './api/auth.js';
import { syncRoutes } from './api/sync.js';
import { catalogRoutes } from './api/catalog.js';
import { patientRoutes } from './api/patients.js';
import { adminRoutes } from './api/admin.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, '..', 'public');
const sharedDir = path.join(root, '..', 'shared');

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const ALLOW_WHILE_MUST_CHANGE = ['/api/password', '/api/logout', '/api/me'];

function buildId() {
  const h = crypto.createHash('sha1');
  for (const dir of [publicDir, sharedDir]) {
    for (const f of fs.readdirSync(dir, { recursive: true }).sort()) {
      const p = path.join(dir, String(f));
      if (fs.statSync(p).isFile()) h.update(f).update(fs.readFileSync(p));
    }
  }
  return h.digest('hex').slice(0, 12);
}

function shellFiles() {
  const list = ['/'];
  for (const [dir, prefix] of [[publicDir, '/'], [sharedDir, '/shared/']]) {
    for (const f of fs.readdirSync(dir, { recursive: true }).sort()) {
      const rel = String(f).split(path.sep).join('/');
      if (fs.statSync(path.join(dir, String(f))).isFile() && !(prefix === '/' && (rel === 'sw.js' || rel === 'index.html'))) list.push(prefix + rel);
    }
  }
  return list;
}

export function createApp({ db, config }) {
  const ctxBase = { db, config };
  const table = compile([
    ...authRoutes(ctxBase), ...syncRoutes(ctxBase), ...catalogRoutes(ctxBase), ...patientRoutes(ctxBase), ...adminRoutes(ctxBase),
  ]);
  const build = buildId();
  const shell = JSON.stringify(shellFiles());
  const transform = (rel, body) => (rel === '/sw.js' ? Buffer.from(body.toString().replaceAll('__BUILD__', build).replaceAll('__SHELL__', shell)) : body);

  async function handle(req, res) {
    res.setHeader('content-security-policy', CSP);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    if (config.secureCookies) res.setHeader('strict-transport-security', 'max-age=31536000');

    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(req, res, 405, { error: 'Method not allowed' });
      if (serveStatic(req, res, [['/shared/', sharedDir], ['/', publicDir]], url.pathname, transform)) return;
      return serveStatic(req, res, [['/', publicDir]], '/index.html', transform) || sendJson(req, res, 404, { error: 'Not found' });
    }

    try {
      const found = match(table, req.method, url.pathname);
      if (!found) throw new HttpError(404, 'Not found');
      if (req.method !== 'GET') {
        if (req.headers['x-requested-with'] !== 'formulary') throw new HttpError(403, 'Missing request header');
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Bad origin');
      }
      const token = parseCookies(req.headers.cookie).sid;
      const user = userFromToken(db, token, config);
      const { route, params } = found;
      if (route.perm !== null) {
        if (!user) throw new HttpError(401, 'Not signed in');
        if (user.must_change && !ALLOW_WHILE_MUST_CHANGE.includes(url.pathname)) throw new HttpError(403, 'must_change_password');
        if (route.perm !== 'any' && !can(user.role, route.perm)) throw new HttpError(403, 'Not allowed for your role');
      }
      const ip = config.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress;
      const body = req.method === 'GET' ? {} : await readJson(req);
      const out = await route.handler({ ...ctxBase, req, res, user, token, params, query: Object.fromEntries(url.searchParams), body, ip });
      if (out?.__reply) sendJson(req, res, out.status, out.data, out.headers);
      else sendJson(req, res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) {
        const headers = e.extra?.retryAfter ? { 'retry-after': String(e.extra.retryAfter) } : {};
        return sendJson(req, res, e.status, { error: e.message, ...e.extra }, headers);
      }
      console.error('server error:', e.message);
      sendJson(req, res, 500, { error: 'Server error' });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  return { server, build };
}
