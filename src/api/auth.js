import { HttpError, reply } from '../http.js';
import { publicConfig } from '../config.js';
import { audit, now } from '../db.js';
import { verifyPassword, hashPassword, idleMs, checkPasswordRules, createSession, dropSession, dropUserSessions, makeLimiter, cookieHeader, clearCookie } from '../auth.js';

const view = (u) => ({ id: u.id, username: u.username, display_name: u.display_name, role: u.role, must_change: !!u.must_change, location_id: u.location_id });

export function authRoutes({ db, config }) {
  const pairLimiter = makeLimiter(config.loginMaxFails, config.loginWindowMs);
  const userLimiter = makeLimiter(config.loginMaxFails * 6, config.loginWindowMs);
  const ipLimiter = makeLimiter(config.loginMaxFails * 4, config.loginWindowMs);

  return [
    ['POST', '/api/login', async (ctx) => {
      const username = String(ctx.body.username || '').trim();
      const keyPair = `${username.toLowerCase()}@${ctx.ip}`;
      const keyU = username.toLowerCase();
      const keyIp = ctx.ip;
      const wait = Math.max(pairLimiter.blocked(keyPair), userLimiter.blocked(keyU), ipLimiter.blocked(keyIp));
      if (wait) {
        audit(db, null, 'login.blocked', username);
        throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`, { retryAfter: wait });
      }
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      const ok = await verifyPassword(String(ctx.body.password || ''), row?.password_hash);
      if (!ok || row.disabled) {
        pairLimiter.fail(keyPair);
        userLimiter.fail(keyU);
        ipLimiter.fail(keyIp);
        audit(db, null, 'login.fail', username);
        throw new HttpError(401, 'Wrong username or password');
      }
      pairLimiter.clear(keyPair);
      db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now(), row.id);
      audit(db, row, 'login.ok', username);
      const s = createSession(db, row.id, idleMs(config, row.role));
      return reply({ user: view(row), config: publicConfig(config), serverTime: now() }, { headers: { 'set-cookie': cookieHeader(s.token, s.expires, config.secureCookies) } });
    }, null],

    ['POST', '/api/logout', (ctx) => {
      if (ctx.token) dropSession(db, ctx.token);
      if (ctx.user) audit(db, ctx.user, 'logout');
      return reply({ ok: true }, { headers: { 'set-cookie': clearCookie } });
    }, null],

    ['GET', '/api/me', (ctx) => {
      if (!ctx.user) throw new HttpError(401, 'Not signed in');
      return { user: view(ctx.user), config: publicConfig(config), serverTime: now() };
    }, null],

    ['POST', '/api/password', async (ctx) => {
      if (!ctx.user) throw new HttpError(401, 'Not signed in');
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
      if (!(await verifyPassword(String(ctx.body.current || ''), row.password_hash))) throw new HttpError(403, 'Current password is wrong');
      checkPasswordRules(ctx.body.next, row.username);
      if (ctx.body.next === ctx.body.current) throw new HttpError(400, 'New password must differ');
      db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(await hashPassword(ctx.body.next), row.id);
      audit(db, ctx.user, 'password.change');
      return { ok: true };
    }, null],
  ];
}
