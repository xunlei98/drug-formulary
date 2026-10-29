import { HttpError } from '../http.js';
import { audit } from '../db.js';
import { createUser, tempPassword, hashPassword, dropUserSessions } from '../auth.js';
import { IMPORTERS } from '../import/index.js';
import { pdfToText } from '../import/floorstock.js';
import { ROLES } from '../../shared/perm.js';

const USERNAME = /^[a-z0-9._-]{3,30}$/i;

function adminCount(db) {
  return db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND disabled = 0").get().n;
}

export function adminRoutes({ db }) {
  return [
    ['GET', '/api/users', () => ({
      users: db.prepare('SELECT id, username, display_name, role, disabled, must_change, location_id, last_login FROM users ORDER BY username').all(),
    }), 'user.manage'],

    ['POST', '/api/users', async (ctx) => {
      const { username, display_name = '', role, location_id = null } = ctx.body;
      if (!USERNAME.test(username || '')) throw new HttpError(400, 'Username: 3 to 30 letters, digits, dot, dash or underscore');
      if (!ROLES.includes(role)) throw new HttpError(400, 'Bad role');
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'Username already taken');
      const password = tempPassword() + 'a1';
      await createUser(db, { username, display_name: String(display_name).slice(0, 80), role, password, location_id }, ctx.user);
      return { username, tempPassword: password };
    }, 'user.manage'],

    ['PATCH', '/api/users/:id', (ctx) => {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
      if (!u) throw new HttpError(404, 'User not found');
      const next = { ...u, ...ctx.body, id: u.id };
      if (!ROLES.includes(next.role)) throw new HttpError(400, 'Bad role');
      const losesAdmin = u.role === 'admin' && !u.disabled && (next.role !== 'admin' || next.disabled);
      if (losesAdmin && (u.id === ctx.user.id || adminCount(db) <= 1)) throw new HttpError(409, 'You cannot remove the last active admin, or yourself');
      db.prepare('UPDATE users SET display_name = ?, role = ?, disabled = ?, location_id = ? WHERE id = ?')
        .run(String(next.display_name).slice(0, 80), next.role, next.disabled ? 1 : 0, next.location_id || null, u.id);
      if (next.disabled) dropUserSessions(db, u.id);
      audit(db, ctx.user, 'user.edit', u.username, `role ${next.role}, disabled ${next.disabled ? 1 : 0}`);
      return { ok: true };
    }, 'user.manage'],

    ['POST', '/api/users/:id/reset-password', async (ctx) => {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
      if (!u) throw new HttpError(404, 'User not found');
      const password = tempPassword() + 'a1';
      db.prepare('UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?').run(await hashPassword(password), u.id);
      dropUserSessions(db, u.id);
      audit(db, ctx.user, 'user.reset_password', u.username);
      return { tempPassword: password };
    }, 'user.manage'],

    ['DELETE', '/api/users/:id', (ctx) => {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
      if (!u) throw new HttpError(404, 'User not found');
      if (u.id === ctx.user.id || (u.role === 'admin' && !u.disabled && adminCount(db) <= 1)) throw new HttpError(409, 'You cannot delete yourself or the last admin');
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
      audit(db, ctx.user, 'user.delete', u.username);
      return { ok: true };
    }, 'user.manage'],

    ['GET', '/api/audit', (ctx) => {
      const before = Number(ctx.query.before) || Number.MAX_SAFE_INTEGER;
      return { entries: db.prepare('SELECT * FROM audit WHERE id < ? ORDER BY id DESC LIMIT 200').all(before) };
    }, 'audit.view'],

    ['POST', '/api/import/:kind', (ctx) => {
      const fn = IMPORTERS[ctx.params.kind];
      if (!fn) throw new HttpError(404, 'Unknown import');
      try {
        const text = ctx.body.pdf ? pdfToText(Buffer.from(String(ctx.body.pdf), 'base64')) : String(ctx.body.text || '');
        return fn(db, text, { user: ctx.user, dryRun: !!ctx.body.dryRun, location: ctx.body.location });
      } catch (e) {
        throw new HttpError(400, e.message);
      }
    }, 'import.run'],
  ];
}
