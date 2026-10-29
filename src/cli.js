import fs from 'node:fs';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createUser, tempPassword, checkPasswordRules } from './auth.js';
import { IMPORTERS } from './import/index.js';
import { seedLocations, WARDS, STORES } from './stock.js';
import { LIST_LABEL, pdfToText } from './import/floorstock.js';
import { backup, restore } from './backup.js';

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
  const l = seedLocations(db);
  console.log(`Locations: ${l.added} added, ${l.removed} old example rows removed.`);
  for (const [kind, file] of [['master', 'master.csv'], ['item-mahal', 'item-mahal.csv'], ['kuota-unit', 'kuota.csv']]) {
    const p = `data/${file}`;
    if (!fs.existsSync(p)) { console.log(`No ${p}. Import ${kind} from Admin > Import later.`); continue; }
    const r = IMPORTERS[kind](db, fs.readFileSync(p, 'utf8'));
    console.log(`${kind}: ${r.added} added, ${r.updated} updated, ${r.errors.length} errors`);
  }
  if (!db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) await createAdmin(process.env.ADMIN_USERNAME || 'admin');
} else if (cmd === 'locations') {
  console.log(seedLocations(db));
} else if (cmd === 'import-floorstock') {
  importFloorStockDir(args[0] || 'data/floorstock', args[1] || 'docs/floorstock-unmatched.md');
} else if (cmd === 'import') {
  const [kind, file] = args;
  if (!IMPORTERS[kind] || !file) throw new Error(`Usage: import <${Object.keys(IMPORTERS).join('|')}> <file> [--location <id>] [--dry-run]`);
  const location = args[args.indexOf('--location') + 1];
  const text = file.endsWith('.pdf') ? pdfToText(fs.readFileSync(file)) : fs.readFileSync(file, 'utf8');
  const r = IMPORTERS[kind](db, text, { dryRun: args.includes('--dry-run'), location });
  console.log(JSON.stringify({ ...r, errors: r.errors.slice(0, 20) }, null, 1));
} else if (cmd === 'backup') {
  const r = backup(db, { dir: process.env.BACKUP_DIR || 'backups', keyFile: process.env.BACKUP_KEY_FILE || 'data/backup.key', keepDays: Number(process.env.BACKUP_KEEP_DAYS) || 14 });
  console.log(`Backup written: ${r.file}. Removed ${r.pruned.length} old file(s).`);
} else if (cmd === 'restore') {
  if (!args[0] || !args[1]) throw new Error('Usage: restore <backup.db.enc> <new-database-file>');
  restore(args[0], args[1], process.env.BACKUP_KEY_FILE || 'data/backup.key');
  console.log(`Restored to ${args[1]}. Point DB_PATH at it and restart.`);
} else if (cmd === 'demo') {
  const { addDemoData } = await import('./demo.js');
  console.log(addDemoData(db));
  const pw = process.env.DEMO_PASSWORD;
  if (pw) {
    for (const [username, role, location_id] of [['demo.pharm', 'pharmacist', null], ['demo.ward', 'ward', 'male-ward']]) {
      if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) await createUser(db, { username, display_name: `Demo ${role}`, role, password: pw, must_change: 0, location_id });
    }
    db.prepare("UPDATE users SET must_change = 0 WHERE username = 'admin'").run();
    console.log('Demo users: admin, demo.pharm, demo.ward (shared DEMO_PASSWORD). Never use this DB for real data.');
  }
} else {
  console.log('Commands: backup, restore <file> <new-db>, demo, seed, create-admin <username>, import <kind> <file> [--location <id>] [--dry-run], import-floorstock [dir] [report.md], locations');
}

// Imports "<Unit>.pdf" (or "<Unit>.txt") for every ward whose name matches the file name, then writes the review report.
function importFloorStockDir(dir, reportFile) {
  const byName = new Map([...STORES, ...WARDS].map(([id, name]) => [name.toLowerCase(), id]));
  const files = fs.readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).sort();
  const drugName = db.prepare('SELECT perihal FROM drugs WHERE no_kod = ?');
  const report = [];
  const totals = [];
  for (const f of files) {
    const unit = f.replace(/\.pdf$/i, '');
    const location = byName.get(unit.toLowerCase());
    if (!location) { console.log(`Skipped ${f}: no location named "${unit}"`); continue; }
    const r = IMPORTERS.floorstock(db, pdfToText(fs.readFileSync(`${dir}/${f}`)), { location });
    totals.push([unit, r.parsed, r.matched, r.unmatched.length, r.review.filter((x) => x.match === 'low').length]);
    report.push({ unit, r });
    console.log(`${unit.padEnd(18)} parsed ${String(r.parsed).padStart(3)}  matched ${String(r.matched).padStart(3)}  unmatched ${String(r.unmatched.length).padStart(2)}`);
  }
  const md = ['# Floor stock rows to check', '',
    `Generated ${new Date().toISOString().slice(0, 10)} by \`npm run cli -- import-floorstock\` from the 2026 "Senarai Floor Stock" PDFs.`,
    'Unmatched rows are stored with no formulary item, so they show on no drug screen. Fix the name in the PDF or add the item to MASTER, then re-import that unit.',
    'Low-confidence matches are used as par levels; confirm each one.', '',
    '| Unit | Parsed | Matched | Unmatched | Low confidence |', '| --- | ---: | ---: | ---: | ---: |',
    ...totals.map((t) => `| ${t.join(' | ')} |`), ''];
  md.push('## Unmatched rows', '', '| Unit | List | Item in PDF | SKU | Max |', '| --- | --- | --- | --- | ---: |');
  for (const { unit, r } of report) for (const x of r.unmatched) md.push(`| ${unit} | ${LIST_LABEL[x.list]} | ${x.name} | ${x.unit} | ${x.max ?? '(blank)'} |`);
  md.push('', '## Matches to confirm', '', 'Exact name matches are not listed. "high" is a token similarity of 0.8 or more with identical strengths; "low" is 0.6 to 0.8.', '',
    '| Unit | Item in PDF | Matched formulary item | No Kod | Confidence |', '| --- | --- | --- | --- | --- |');
  const seen = new Set();
  for (const { unit, r } of report) for (const x of r.review.sort((a, b) => a.score - b.score)) {
    const k = `${x.name}|${x.drug}`;
    if (seen.has(k)) continue;
    seen.add(k);
    md.push(`| ${unit} | ${x.name} | ${drugName.get(x.drug).perihal} | ${x.drug} | ${x.match} ${x.score} |`);
  }
  const blanks = report.flatMap(({ unit, r }) => r.errors.map((e) => `- ${unit}: ${e.message}`));
  if (blanks.length) md.push('', '## Rows with no quantity', '', ...blanks);
  fs.writeFileSync(reportFile, md.join('\n') + '\n');
  console.log(`Wrote ${reportFile}`);
}

db.close();
