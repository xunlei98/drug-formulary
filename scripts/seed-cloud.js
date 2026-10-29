// Seeds a Firebase project (or the emulators) with the trial data:
// the formulary, Item Mahal, Kuota by unit, the 19 Hospital Limbang locations, floor stock par levels and DEMO patients.
//   node scripts/seed-cloud.js --data <dir> [--project <id>] [--yes] [--patients <csv>]
// <dir> holds master.csv, item-mahal.csv, kuota.csv and floorstock/<Ward name>.pdf|.txt (exported from the sheets),
// and optionally drug-formulary.csv (the old DRUG FORMULARY tab) for indications, dosage and supply details.
// Patients are always fake DEMO rows. A Pesakit CSV is refused unless PATIENTS_REAL_ALLOWED=true (see docs/deploy.md).
import fs from 'node:fs';
import path from 'node:path';
import { init, arg, EMULATOR } from './admin-init.js';
import { pdfToText } from './pdftotext.js';
import { parseInfoSheet, matchInfo, mergeInfo } from '../public/shared/druginfo.js';
import { importMaster, importItemMahal, importKuotaUnit, importPatients, importFloorStock, chunkDrugs, defaultLocations, demoPatients, WARDS } from '../public/shared/importers.js';

const REAL_ALLOWED = process.env.PATIENTS_REAL_ALLOWED === 'true';
const dir = arg('data');
if (!dir) { console.error('Usage: npm run seed:cloud -- --data <dir> [--yes]'); process.exit(2); }
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const say = (label, r) => console.log(`${label}: ${r.added} added, ${r.updated} updated, ${r.skipped} skipped${r.errors.length ? ` (first error line ${r.errors[0].line}: ${r.errors[0].message})` : ''}`);

const { id, db, FieldValue } = init();
console.log(`Seeding ${EMULATOR ? 'emulator' : 'Firebase'} project ${id}`);

const m = importMaster(read('master.csv'));
say('Formulary', m.result);
let formulary = m.drugs;
if (fs.existsSync(path.join(dir, 'drug-formulary.csv'))) {
  const rows = parseInfoSheet(read('drug-formulary.csv'));
  const mi = matchInfo(rows, formulary);
  const r = mergeInfo(formulary, mi, rows);
  formulary = r.drugs;
  console.log(`Drug info: ${mi.matched.size} matched, ${r.added.length} added, ${mi.ambiguous.length} ambiguous, ${mi.unmatched.length - r.added.length} left out`);
}
const im = importItemMahal(read('item-mahal.csv'), { drugs: m.drugs });
say('Item Mahal', im.result);
const ku = importKuotaUnit(read('kuota.csv'), { mahal: im.mahal });
say('Kuota by unit', ku.result);

const locations = defaultLocations();
const par = {};
const fsDir = path.join(dir, 'floorstock');
for (const [loc, name] of WARDS) {
  const pdf = path.join(fsDir, `${name}.pdf`);
  const txt = path.join(fsDir, `${name}.txt`);
  const text = fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8') : fs.existsSync(pdf) ? pdfToText(fs.readFileSync(pdf)) : null;
  if (!text) continue;
  const r = importFloorStock(text, { drugs: m.drugs, location: loc });
  par[loc] = r.rows.map(({ location: _, ...row }) => row);
  console.log(`Par ${name}: ${r.parsed} rows, ${r.matched} matched`);
}

let patients = demoPatients([...ku.mahal.keys()].sort());
const pesakit = arg('patients');
if (pesakit) {
  const r = importPatients(fs.readFileSync(pesakit, 'utf8'), { mahal: ku.mahal, realAllowed: REAL_ALLOWED });
  say('Patients file', r.result);
  if (r.result.skipped && !REAL_ALLOWED) console.log('Rows that are not DEMO PATIENT were refused: PATIENTS_REAL_ALLOWED is not true.');
  patients = r.rows;
}

const meta = (await db.doc('meta/catalog').get()).data() || {};
const ver = (v) => (Number(v) || 0) + 1;
const writes = [
  ['config/app', { offlineDays: 3, idleLockMin: 5, nearPct: 80, wardStockScope: 'own', patientsRealAllowed: REAL_ALLOWED }, true],
  ['catalog/locations', { byId: locations }, false],
  ['catalog/mahal', { items: Object.fromEntries(ku.mahal), updated: FieldValue.serverTimestamp() }, false],
];
const chunks = chunkDrugs(formulary);
chunks.forEach((items, i) => writes.push([`formulary/c${String(i).padStart(3, '0')}`, { items }, false]));
for (const [loc, rows] of Object.entries(par)) writes.push([`par/${loc}`, { rows, updated: FieldValue.serverTimestamp() }, false]);
const byKey = {};
for (const p of patients) {
  writes.push([`patients/${p.id}`, { ...p.minimal, updated_by: 'seed' }, false], [`patient_identity/${p.id}`, p.identity, false]);
  const k = `${p.minimal.no_kod}|${p.minimal.unit || ''}|${p.minimal.kategori}`;
  byKey[k] = (byKey[k] || 0) + 1;
}
writes.push(['stats/counts', { byKey }, false]);
writes.push(['meta/catalog', { formulary: ver(meta.formulary), par: Object.fromEntries(Object.keys(par).map((l) => [l, ver(meta.par?.[l])])) }, true]);

const old = await db.collection('formulary').get();
for (const d of old.docs) if (!writes.some(([p]) => p === `formulary/${d.id}`)) await d.ref.delete();
for (let i = 0; i < writes.length; i += 400) {
  const b = db.batch();
  for (const [p, data, merge] of writes.slice(i, i + 400)) b.set(db.doc(p), data, { merge });
  await b.commit();
}
console.log(`Wrote ${writes.length} documents: ${chunks.length} formulary chunks, ${Object.keys(par).length} par lists, ${patients.length} patients (${REAL_ALLOWED ? 'real allowed' : 'DEMO only'}).`);
