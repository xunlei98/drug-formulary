// Merges drug information (indications, dosage, supply details...) from the old "DRUG FORMULARY" sheet into the formulary.
//   node scripts/merge-druginfo.js --csv <DRUG FORMULARY.csv> [--report <file.md>] [--dry-run] [--yes]
// Safe to re-run: only formulary chunks whose content changed are written, and meta/catalog is bumped only then.
import fs from 'node:fs';
import { init, arg, flag, EMULATOR } from './admin-init.js';
import { parseInfoSheet, matchInfo, mergeInfo } from '../public/shared/druginfo.js';
import { chunkDrugs } from '../public/shared/importers.js';

const csv = arg('csv');
if (!csv) { console.error('Usage: node scripts/merge-druginfo.js --csv <file> [--report <md>] [--dry-run] [--yes]'); process.exit(2); }
const { id, db, FieldValue } = init();
console.log(`Drug info merge on ${EMULATOR ? 'emulator' : 'Firebase'} project ${id}${flag('dry-run') ? ' (dry run)' : ''}`);

const rows = parseInfoSheet(fs.readFileSync(csv, 'utf8'));
const old = await db.collection('formulary').get();
const drugs = new Map(old.docs.flatMap((d) => d.data().items).map((d) => [d.no_kod, d]));
const m = matchInfo(rows, drugs);
const { drugs: merged, added } = mergeInfo(drugs, m, rows);
console.log(`Sheet rows ${rows.length}: matched ${m.matched.size} (${Object.entries(m.tiers).map(([k, v]) => `${k} ${v}`).join(', ')}), ambiguous ${m.ambiguous.length}, unmatched ${m.unmatched.length}, added as new drugs ${added.length}. Drugs with no sheet row: ${m.noSheet.length}.`);

const report = arg('report');
if (report) fs.writeFileSync(report, reportMd(m, added, drugs));

// Firestore hands map keys back in its own order, so compare with sorted keys.
const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const before = new Map(old.docs.map((d) => [d.id, stable(d.data().items)]));
const chunks = chunkDrugs(merged).map((items, i) => [`c${String(i).padStart(3, '0')}`, items]);
const changed = chunks.filter(([cid, items]) => before.get(cid) !== stable(items));
const size = Math.max(...chunks.map(([, items]) => JSON.stringify(items).length));
console.log(`${changed.length} of ${chunks.length} chunks changed; largest chunk ${Math.round(size / 1024)} KB.`);
if (size > 900_000) { console.error('A chunk is near the 1 MiB document limit. Lower the chunk size first.'); process.exit(1); }
if (flag('dry-run') || !changed.length) process.exit(0);

const b = db.batch();
for (const [cid, items] of changed) b.set(db.doc(`formulary/${cid}`), { items });
b.set(db.doc('meta/catalog'), { formulary: FieldValue.increment(1) }, { merge: true });
await b.commit();
console.log(`Wrote ${changed.length} chunks and bumped meta/catalog.formulary.`);

function reportMd(m, added, drugs) {
  const name = (k) => drugs.get(k)?.perihal || k;
  const line = (r) => `| ${r.line} | ${r.item.replace(/\|/g, '/')} | ${r.item_code || '-'} |`;
  const ubatNoSheet = m.noSheet.filter((k) => drugs.get(k).kategori === 'Ubat');
  return [
    '# Drug info merge report', '',
    `Sheet rows: ${rows.length}. Matched: ${m.matched.size} (item code ${m.tiers.item_code}, PhIS code ${m.tiers.phis}, exact name ${m.tiers.name}).`,
    `Ambiguous (not applied): ${m.ambiguous.length}. Unmatched: ${m.unmatched.length}, of which ${added.length} added as new drugs.`,
    `Formulary drugs with no sheet row: ${m.noSheet.length} (${ubatNoSheet.length} Ubat, the rest Bukan Ubat).`, '',
    '## Ambiguous: a person must decide', '', '| Sheet row | Item | Item code | Why | App drug |', '| --- | --- | --- | --- | --- |',
    ...m.ambiguous.map((a) => `${line(a)} ${a.reason} | ${a.drugs.map((k) => `${k} ${name(k)}`).join('; ')} |`), '',
    '## Unmatched with a similar formulary name: not applied, not added', '', '| Sheet row | Item | Item code | Closest drug |', '| --- | --- | --- | --- |',
    ...m.unmatched.filter((u) => u.suggest).map((u) => `${line(u)} ${u.suggest.drug} ${name(u.suggest.drug)} (${u.suggest.match} ${u.suggest.score}) |`), '',
    '## Unmatched, added as new drugs (marked "Old formulary only")', '', '| Sheet row | Item | Item code |', '| --- | --- | --- |',
    ...m.unmatched.filter((u) => !u.suggest && added.includes(u.item_code)).map((u) => line(u)), '',
    '## Unmatched with no item code: not added', '', '| Sheet row | Item | Item code |', '| --- | --- | --- |',
    ...m.unmatched.filter((u) => !u.suggest && !added.includes(u.item_code)).map((u) => line(u)), '',
    '## Ubat in the formulary with no sheet row', '', ...ubatNoSheet.map((k) => `- ${k} ${name(k)}`), '',
  ].join('\n');
}
