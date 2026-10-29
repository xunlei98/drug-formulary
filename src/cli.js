import fs from 'node:fs';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createUser, tempPassword, checkPasswordRules } from './auth.js';
import { IMPORTERS } from './import/index.js';
import { seedExampleLocations } from './stock.js';

const [cmd, ...args] = process.argv.slice(2);
const config = loadConfig();
const db = openDb(config.dbPath);

async function createAdmin(username) {
  if (!username) throw new Error('Usage: create-admin <username>');
  const password = process.env.ADMIN_PASSWORD || tempPassword() + 'a1';
  if (process.env.ADMIN_PASSWORD) checkPasswordRules(password, username);
  await createUser(db, { username, display_name: username, role: 'admin', password });
  console.log(`Admin "${username}" created.`);
  if (!process.env.ADMIN_PASSWORD) console.log(`Temporary password (shown once): ${password}`);
  console.log('You must change it at first login.');
}

if (cmd === 'create-admin') await createAdmin(args[0]);
else if (cmd === 'seed') {
  const n = seedExampleLocations(db);
  if (n) console.log(`Added ${n} EXAMPLE locations. Edit them in Admin > Locations.`);
  for (const [kind, file] of [['master', 'master.csv'], ['item-mahal', 'item-mahal.csv'], ['kuota-unit', 'kuota.csv']]) {
    const p = `data/${file}`;
    if (!fs.existsSync(p)) { console.log(`No ${p}. Import ${kind} from Admin > Import later.`); continue; }
    const r = IMPORTERS[kind](db, fs.readFileSync(p, 'utf8'));
    console.log(`${kind}: ${r.added} added, ${r.updated} updated, ${r.errors.length} errors`);
  }
  if (!db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) await createAdmin(process.env.ADMIN_USERNAME || 'admin');
} else if (cmd === 'import') {
  const [kind, file] = args;
  if (!IMPORTERS[kind] || !file) throw new Error(`Usage: import <${Object.keys(IMPORTERS).join('|')}> <file.csv> [--dry-run]`);
  const r = IMPORTERS[kind](db, fs.readFileSync(file, 'utf8'), { dryRun: args.includes('--dry-run') });
  console.log(JSON.stringify({ ...r, errors: r.errors.slice(0, 20) }, null, 1));
} else {
  console.log('Commands: seed, create-admin <username>, import <kind> <file> [--dry-run]');
}
db.close();
