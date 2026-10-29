import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { now, audit } from './db.js';
import { HttpError } from './http.js';
import { COMMON } from './common-passwords.js';

const scrypt = promisify(crypto.scrypt);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

const DUMMY = await hashPassword('dummy-password-for-timing');

export async function verifyPassword(pw, stored) {
  const [alg, salt, hash] = (stored || DUMMY).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(pw, Buffer.from(salt, 'hex'), 64);
  const ok = crypto.timingSafeEqual(key, Buffer.from(hash, 'hex'));
  return ok && !!stored;
}

export const tempPassword = () => crypto.randomBytes(9).toString('base64url');

export function checkPasswordRules(pw, username = '') {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Password must be at least 10 characters');
  const low = pw.toLowerCase();
  if (COMMON.has(low) || new Set(low).size < 4) throw new HttpError(400, 'That password is too common. Pick another.');
  if (username && low.includes(username.toLowerCase())) throw new HttpError(400, 'Password must not contain the username');
}

export const idleMs = (config, role) => (role === 'admin' ? config.adminIdleHours : config.sessionIdleHours) * 3_600_000;

export function createSession(db, userId, ttlMs) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + ttlMs).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(sha(token), userId, now(), expires);
  return { token, expires };
}

export function userFromToken(db, token, config) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.username, u.display_name, u.role, u.must_change, u.disabled, u.location_id, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha(token));
  if (!row || row.disabled || row.expires_at < now()) return null;
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(new Date(Date.now() + idleMs(config, row.role)).toISOString(), sha(token));
  return row;
}

export const dropSession = (db, token) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
export const dropUserSessions = (db, userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

export function cookieHeader(token, expires, secure) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure ? '; Secure' : ''}`;
}

export const clearCookie = 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((p) => p.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));
}

export function makeLimiter(max, windowMs) {
  const fails = new Map();
  const recent = (key) => (fails.get(key) || []).filter((t) => Date.now() - t < windowMs);
  return {
    blocked(key) {
      const r = recent(key);
      fails.set(key, r);
      return r.length >= max ? Math.ceil((windowMs - (Date.now() - r[0])) / 1000) : 0;
    },
    fail(key) { fails.set(key, [...recent(key), Date.now()]); },
    clear(key) { fails.delete(key); },
  };
}

export async function createUser(db, { username, display_name = '', role, password, must_change = 1, location_id = null }, actor = null) {
  const hash = await hashPassword(password);
  const info = db.prepare('INSERT INTO users (username, display_name, role, password_hash, must_change, location_id, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(username, display_name, role, hash, must_change, location_id, now());
  audit(db, actor, 'user.create', username, role);
  return info.lastInsertRowid;
}
