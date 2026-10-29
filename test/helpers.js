import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/auth.js';

export const PW = 'correct-horse-battery';

export async function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formulary-'));
  const config = loadConfig({ DB_PATH: path.join(dir, 't.db'), SECURE_COOKIES: '0', ...env });
  const db = openDb(config.dbPath);
  const { server } = createApp({ db, config });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((r) => { server.close(r); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { db, config, base, server, close, dir };
}

export function seedBasics(db) {
  db.exec(`
    INSERT INTO drugs (no_kod, kategori, perihal, jenis) VALUES ('D1','Ubat','Demo Drug One 10mg Tablet','CC'), ('D2','Ubat','Demo Drug Two','LP');
    INSERT INTO locations (id, name, type, parent_id) VALUES ('store','Store','store',NULL), ('wardA','Ward A','ward',NULL), ('wardB','Ward B','ward',NULL), ('wardA-shelf','Ward A shelf','shelf','wardA');
    INSERT INTO mahal_item (no_kod, quota, nota) VALUES ('D1', 2, '');`);
}

export async function addUser(db, username, role, extra = {}) {
  await createUser(db, { username, role, password: PW, must_change: 0, ...extra });
}

export function client(base) {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'x-requested-with': 'formulary', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.startsWith('sid=;') ? '' : set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
  return {
    get: (u, h) => call('GET', u, null, h),
    post: (u, b = {}, h) => call('POST', u, b, h),
    patch: (u, b, h) => call('PATCH', u, b, h),
    put: (u, b, h) => call('PUT', u, b, h),
    del: (u, h) => call('DELETE', u, null, h),
    login: (username, password = PW) => call('POST', '/api/login', { username, password }),
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
  };
}

export const uuid = () => crypto.randomUUID();
