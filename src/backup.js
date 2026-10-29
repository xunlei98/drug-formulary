import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAGIC = Buffer.from('FMB1');
const DAY = 86400000;

function loadKey(keyFile, create) {
  if (!fs.existsSync(keyFile)) {
    if (!create) throw new Error(`Key file not found: ${keyFile}`);
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    console.log(`New backup key written to ${keyFile}. Copy it somewhere safe and separate. Backups cannot be restored without it.`);
  }
  const key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  if (key.length !== 32) throw new Error('Backup key must be 64 hex characters');
  return key;
}

export function encrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function decrypt(blob, key) {
  if (!blob.subarray(0, 4).equals(MAGIC)) throw new Error('Not a formulary backup file');
  const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(4, 16));
  d.setAuthTag(blob.subarray(16, 32));
  try {
    return Buffer.concat([d.update(blob.subarray(32)), d.final()]);
  } catch {
    throw new Error('Wrong key or damaged file');
  }
}

export function backup(db, { dir, keyFile, keepDays = 14, clock = Date.now() }) {
  const key = loadKey(keyFile, true);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.tmp-${process.pid}.db`);
  fs.rmSync(tmp, { force: true });
  db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
  const stamp = new Date(clock).toISOString().replace(/[-:]/g, '').slice(0, 13);
  const out = path.join(dir, `formulary-${stamp}.db.enc`);
  fs.writeFileSync(out, encrypt(fs.readFileSync(tmp), key), { mode: 0o600 });
  fs.rmSync(tmp);
  const pruned = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (/^formulary-.*\.db\.enc$/.test(f) && clock - fs.statSync(p).mtimeMs > keepDays * DAY) { fs.rmSync(p); pruned.push(f); }
  }
  return { file: out, pruned };
}

export function restore(file, outFile, keyFile) {
  if (fs.existsSync(outFile)) throw new Error(`${outFile} already exists. Move it away first. Restore never overwrites.`);
  const plain = decrypt(fs.readFileSync(file), loadKey(keyFile, false));
  fs.writeFileSync(outFile, plain, { mode: 0o600 });
}
