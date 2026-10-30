// Merges the Notion formulary (clinical text and kept-at lists) onto MASTER drugs.
//   node scripts/merge-notion.js --drugs <drugs.json> --places <places.json> [--report <file.md>] [--dry-run] [--yes]
// Uses the firebase login on this machine. Only formulary chunks whose items changed are written.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { arg, flag, projectId } from './admin-init.js';
import { mergeNotion } from '../public/shared/notioninfo.js';
import { chunkDrugs } from '../public/shared/importers.js';

const require = createRequire(import.meta.url);
const drugsFile = arg('drugs');
const placesFile = arg('places');
if (!drugsFile || !placesFile) {
  console.error('Usage: node scripts/merge-notion.js --drugs <drugs.json> --places <places.json> [--report <md>] [--dry-run] [--yes]');
  process.exit(2);
}

const id = projectId();
if (!flag('yes') && !flag('dry-run')) {
  console.error(`This writes to the REAL Firebase project "${id}". Re-run with --yes to confirm.`);
  process.exit(2);
}
const access = await loginToken();
console.log(`Notion merge on Firebase project ${id}${flag('dry-run') ? ' (dry run)' : ''}`);

const rows = JSON.parse(fs.readFileSync(drugsFile, 'utf8'));
const places = JSON.parse(fs.readFileSync(placesFile, 'utf8'));
const oldDocs = await listFormulary(id, access);
const rawByKod = new Map();
const drugs = new Map();
for (const doc of oldDocs) {
  for (const item of doc.fields?.items?.arrayValue?.values || []) {
    const plain = plainDrug(item);
    if (!plain.no_kod) continue;
    rawByKod.set(plain.no_kod, item);
    drugs.set(plain.no_kod, plain);
  }
}
const m = mergeNotion(drugs, rows, places);
console.log(`Notion rows ${rows.length}: matched ${m.matched.size} (${Object.entries(m.tiers).map(([k, v]) => `${k} ${v}`).join(', ')}), ambiguous ${m.ambiguous.length}, unmatched ${m.unmatched.length} (not added).`);
console.log(`Kept-at lists on ${m.keptDrugs} drugs. Location rows not attached: ${m.placesUnused}. Remarks left out because they contained an identity number: ${m.remarksLeftOut}. Removed ${m.removed.length} old-sheet-only drugs.`);

const report = arg('report');
if (report) fs.writeFileSync(report, reportMd(m, drugs, rows.length));

const stamped = new Map();
for (const [kod, d] of m.drugs) {
  const raw = rawByKod.get(kod);
  if (!raw) continue;
  stamped.set(kod, withInfo(raw, d.info));
}
let sizeN = 250;
let chunks = pack(stamped, sizeN);
let size = Math.max(...chunks.map(([, items]) => JSON.stringify(items).length));
while (size > 900_000 && sizeN > 80) {
  sizeN -= 40;
  chunks = pack(stamped, sizeN);
  size = Math.max(...chunks.map(([, items]) => JSON.stringify(items).length));
}
const before = new Map(oldDocs.map((doc) => [doc.name.split('/').pop(), JSON.stringify(doc.fields?.items?.arrayValue?.values || [])]));
const changed = chunks.filter(([cid, items]) => before.get(cid) !== JSON.stringify(items));
const keep = new Set(chunks.map(([cid]) => cid));
const gone = oldDocs.filter((doc) => !keep.has(doc.name.split('/').pop()));
console.log(`${changed.length} of ${chunks.length} chunks changed (${sizeN} drugs per chunk); ${gone.length} leftover chunks to delete; largest chunk ${Math.round(size / 1024)} KB.`);
if (size > 900_000) { console.error('A chunk is near the 1 MiB document limit.'); process.exit(1); }
if (flag('dry-run') || (!changed.length && !gone.length)) process.exit(0);

const base = `projects/${id}/databases/(default)/documents`;
const writes = [
  ...changed.map(([cid, items]) => ({
    update: { name: `${base}/formulary/${cid}`, fields: { items: { arrayValue: { values: items } } } },
    updateMask: { fieldPaths: ['items'] },
  })),
  ...gone.map((doc) => ({ delete: doc.name })),
  { transform: { document: `${base}/meta/catalog`, fieldTransforms: [{ fieldPath: 'formulary', increment: { integerValue: '1' } }] } },
];
const res = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ writes }),
});
if (!res.ok) { console.error(await res.text()); process.exit(1); }
console.log(`Wrote ${changed.length} chunks, deleted ${gone.length}, and bumped meta/catalog.formulary.`);

function pack(stampedDrugs, size) {
  const map = new Map([...stampedDrugs.keys()].map((kod) => [kod, { no_kod: kod }]));
  return chunkDrugs(map, size).map((items, i) => [`c${String(i).padStart(3, '0')}`, items.map((d) => stampedDrugs.get(d.no_kod))]);
}

function plainDrug(item) {
  const f = item.mapValue?.fields || {};
  const info = {};
  for (const [k, v] of Object.entries(f.info?.mapValue?.fields || {})) {
    if (v.stringValue != null) info[k] = v.stringValue;
    else if (v.booleanValue != null) info[k] = v.booleanValue;
    else if (v.integerValue != null) info[k] = Number(v.integerValue);
    else if (v.doubleValue != null) info[k] = v.doubleValue;
  }
  const s = (key) => f[key]?.stringValue || '';
  return {
    no_kod: s('no_kod'), perihal: s('perihal'), kod_phis: s('kod_phis'), kategori: s('kategori'),
    brand: s('brand'), jenis: s('jenis'), source: s('source') || undefined,
    info: Object.keys(info).length ? info : undefined,
  };
}

function withInfo(raw, info) {
  const fields = { ...raw.mapValue.fields };
  if (info && Object.keys(info).length) fields.info = toValue(info);
  else delete fields.info;
  return { mapValue: { fields } };
}

function toValue(v) {
  if (v == null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  const fields = {};
  for (const [k, val] of Object.entries(v)) if (val !== undefined) fields[k] = toValue(val);
  return { mapValue: { fields } };
}

async function loginToken() {
  const { getAccessToken, getGlobalDefaultAccount } = require('firebase-tools/lib/auth.js');
  const acct = getGlobalDefaultAccount();
  if (!acct?.tokens?.refresh_token) {
    console.error('Run firebase login, or set up a service account and use the Firebase console.');
    process.exit(2);
  }
  const tok = await getAccessToken(acct.tokens.refresh_token, []);
  return tok.access_token;
}

async function listFormulary(project, accessToken) {
  const docs = [];
  let pageToken = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/formulary`);
    url.searchParams.set('pageSize', '20');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) { console.error(await res.text()); process.exit(1); }
    const body = await res.json();
    docs.push(...(body.documents || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return docs;
}

function reportMd(m, drugs, rowCount) {
  const name = (k) => drugs.get(k)?.perihal || k;
  const cells = (r) => `${String(r.item || '').replace(/\|/g, '/')} | ${r.item_code || '-'}`;
  return [
    '# Notion merge report', '',
    `Notion rows: ${rowCount}. Matched: ${m.matched.size} (item code ${m.tiers.item_code}, PhIS code ${m.tiers.phis}, exact name ${m.tiers.name}).`,
    `Ambiguous (not applied): ${m.ambiguous.length}. Unmatched (not added): ${m.unmatched.length}. Removed old-sheet-only drugs: ${m.removed.length}.`,
    `Drugs with a kept-at list: ${m.keptDrugs}. Location rows not attached: ${m.placesUnused}.`,
    `Remarks left out because they contained an identity number: ${m.remarksLeftOut}. The text is not copied here.`, '',
    '## Ambiguous: a person must decide', '', '| Item | Item code | Why | App drug |', '| --- | --- | --- | --- |',
    ...m.ambiguous.map((a) => `| ${cells(a)} | ${a.reason} | ${a.drugs.map((k) => `${k} ${name(k)}`).join('; ')} |`), '',
    '## Unmatched with a similar formulary name: not applied', '', '| Item | Item code | Closest drug |', '| --- | --- | --- |',
    ...m.unmatched.filter((u) => u.suggest).map((u) => `| ${cells(u)} | ${u.suggest.drug} ${name(u.suggest.drug)} (${u.suggest.match} ${u.suggest.score}) |`), '',
    '## Unmatched: not added', '', '| Item | Item code |', '| --- | --- |',
    ...m.unmatched.filter((u) => !u.suggest).map((u) => `| ${cells(u)} |`), '',
  ].join('\n');
}
