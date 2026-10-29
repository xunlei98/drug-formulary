import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(schema);
  return db;
}

export const now = () => new Date().toISOString();

export function audit(db, user, action, target = null, detail = null) {
  db.prepare('INSERT INTO audit (ts, user_id, username, action, target, detail) VALUES (?,?,?,?,?,?)')
    .run(now(), user?.id ?? null, user?.username ?? null, action, target, detail === null ? null : String(detail));
}
