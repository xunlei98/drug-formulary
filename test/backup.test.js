import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { backup, restore } from '../src/backup.js';

test('backup is encrypted, restores to the same data, refuses wrong key and overwrite, prunes old files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-bk-'));
  const db = openDb(path.join(dir, 'a.db'));
  db.prepare("INSERT INTO drugs (no_kod, kategori, perihal) VALUES ('B1','Ubat','Secret marker drug')").run();
  const keyFile = path.join(dir, 'k');
  const old = backup(db, { dir: path.join(dir, 'b'), keyFile, clock: Date.now() - 20 * 86400000 });
  fs.utimesSync(old.file, new Date(Date.now() - 20 * 86400000), new Date(Date.now() - 20 * 86400000));
  const r = backup(db, { dir: path.join(dir, 'b'), keyFile });
  assert.equal(r.pruned.length, 1);
  assert.ok(!fs.readFileSync(r.file).includes('Secret marker'));
  restore(r.file, path.join(dir, 'r.db'), keyFile);
  assert.equal(new Database(path.join(dir, 'r.db')).prepare('SELECT perihal FROM drugs').get().perihal, 'Secret marker drug');
  assert.throws(() => restore(r.file, path.join(dir, 'r.db'), keyFile), /already exists/);
  fs.writeFileSync(path.join(dir, 'k2'), '11'.repeat(32));
  assert.throws(() => restore(r.file, path.join(dir, 'r2.db'), path.join(dir, 'k2')), /Wrong key/);
  db.close();
});
