// Drug information from the old "DRUG FORMULARY" sheet (columns C to X), matched onto formulary drugs.
// Pure: parse, match and merge return data; the merge script and the seed write it.
import { parseRecords, num } from './csv.js';
import { norm, buildIndex, matchRow } from './floorstock.js';
import { DRUG_PHOTOS as EMPTY_PHOTOS } from './drug-photos.js';

// A hospital's own photo index, when scripts/host-drug-photos.js has written one. Absent in a fresh copy.
export let DRUG_PHOTOS = EMPTY_PHOTOS;
try {
  DRUG_PHOTOS = (await import('./drug-photos.local.js')).DRUG_PHOTOS ?? EMPTY_PHOTOS;
} catch {
  // This copy has no hosted pictures yet.
}

// Sheet column -> key in drug.info. Every key is optional.
export const INFO_COLUMNS = [
  ['Brand', 'brand'], ['Form', 'form'], ['Packaging Image', 'pack_img'], ['Image', 'img'],
  ['Pharmacologic Category', 'pharm_cat'], ['Prescriber Category', 'prescriber_cat'], ['Pregnancy Category', 'pregnancy'],
  ['Breastfeeding Consideration', 'breastfeeding'], ['Indications', 'indications'], ['Dosage', 'dosage'],
  ['Renal Dosage Adjustments', 'renal'], ['Dilution', 'dilution'], ['Source of origins', 'origin'], ['PhIS Code', 'phis'],
  ['Item Code', 'item_code'], ['Procurement', 'procurement'], ['Packaging', 'packaging'], ['SKU', 'sku'],
  ['Price Per Pack (RM)', 'price_pack'], ['Price Per Unit (RM)', 'price_unit'], ['Group', 'group'], ['Keep Buffer', 'keep_buffer'],
];
const NUMBER_KEYS = new Set(['price_pack', 'price_unit']);
export const INFO_KEYS = INFO_COLUMNS.map(([, k]) => k);

// One sheet row -> { line, item, info }. Empty cells are left out; line breaks are kept.
export function parseInfoSheet(text) {
  return parseRecords(text, ['Item', 'Item Code', 'PhIS Code', 'Indications', 'Dosage']).map((x) => {
    const info = {};
    for (const [col, key] of INFO_COLUMNS) {
      const v = x.get(col).replace(/\r\n?/g, '\n');
      if (!v) continue;
      if (NUMBER_KEYS.has(key)) { const n = num(v); if (n != null && !Number.isNaN(n)) info[key] = n; }
      else if (key === 'keep_buffer') { if (/^(true|false)$/i.test(v)) info[key] = /^true$/i.test(v); }
      else info[key] = v;
    }
    return { line: x.line, item: x.get('Item'), info };
  }).filter((r) => r.item);
}

const code = (s) => String(s || '').trim().toUpperCase();
const TIERS = ['item_code', 'phis', 'name'];

// Matches sheet rows to drugs. A row is applied only when exactly one drug fits at its strongest tier
// and no other row claims that drug at the same or a stronger tier. Everything else is reported, never guessed.
export function matchInfo(rows, drugs) {
  const list = [...drugs.values()];
  const byCode = new Map();
  const add = (k, d) => { if (!k) return; const s = byCode.get(k) || new Set(); s.add(d.no_kod); byCode.set(k, s); };
  for (const d of list) { add(code(d.no_kod), d); add(code(d.kod_phis), d); }
  const byName = new Map();
  for (const d of list) { const k = norm(d.perihal); byName.set(k, [...(byName.get(k) || []), d.no_kod]); }
  const index = buildIndex(list);

  const claims = [];
  const unmatched = [];
  const ambiguous = [];
  for (const r of rows) {
    const ic = code(r.info.item_code);
    const ph = code(r.info.phis);
    let tier = null;
    let cands = [];
    if (ic && drugs.has(r.info.item_code)) { tier = 'item_code'; cands = [r.info.item_code]; }
    else if (ic && byCode.has(ic)) { tier = 'phis'; cands = [...byCode.get(ic)]; }
    else if (ph && byCode.has(ph)) { tier = 'phis'; cands = [...byCode.get(ph)]; }
    else if (byName.has(norm(r.item))) { tier = 'name'; cands = byName.get(norm(r.item)); }
    if (cands.length > 1) { ambiguous.push({ ...brief(r), reason: `${tier} fits ${cands.length} drugs`, drugs: cands }); continue; }
    if (cands.length === 1) { claims.push({ row: r, drug: cands[0], tier }); continue; }
    const fuzzy = matchRow(r.item, index);
    unmatched.push({ ...brief(r), suggest: fuzzy.drug ? { drug: fuzzy.drug, match: fuzzy.match, score: fuzzy.score } : null });
  }

  const byDrug = new Map();
  for (const c of claims) byDrug.set(c.drug, [...(byDrug.get(c.drug) || []), c]);
  const matched = new Map();
  for (const [drug, cs] of byDrug) {
    const best = Math.min(...cs.map((c) => TIERS.indexOf(c.tier)));
    const top = cs.filter((c) => TIERS.indexOf(c.tier) === best);
    if (top.length === 1) matched.set(drug, top[0]);
    for (const c of cs) if (c !== matched.get(drug)) {
      ambiguous.push({ ...brief(c.row), reason: top.length > 1 ? `${top.length} sheet rows claim ${drug} by ${TIERS[best]}` : `${drug} already matched by ${TIERS[best]}`, drugs: [drug] });
    }
  }
  const covered = new Set(matched.keys());
  const noSheet = list.filter((d) => !covered.has(d.no_kod)).map((d) => d.no_kod);
  const tiers = Object.fromEntries(TIERS.map((t) => [t, [...matched.values()].filter((c) => c.tier === t).length]));
  return { matched, unmatched, ambiguous, noSheet, tiers };
}

const brief = (r) => ({ line: r.line, item: r.item, item_code: r.info.item_code || '', phis: r.info.phis || '' });

export const OLD_FORMULARY_SOURCE = 'old-formulary-sheet';

// True for a drug that was created from the old sheet because it was not on the MASTER list.
export function isOldFormularyOnly(d) {
  return d?.source === OLD_FORMULARY_SOURCE;
}

// Sets info on matched MASTER drugs. A sheet row that matches no MASTER drug is not added.
// A drug already stored from the old sheet alone is removed.
export function mergeInfo(drugs, { matched }) {
  const out = new Map();
  const removed = [];
  for (const [kod, d] of drugs) {
    if (isOldFormularyOnly(d)) { removed.push(kod); continue; }
    out.set(kod, matched.has(kod) ? { ...d, info: matched.get(kod).row.info } : d);
  }
  return { drugs: out, added: [], removed };
}

// Picture URL the app may load: Drive links become the small lh3 thumbnail; anything not https (old AppSheet paths) is dropped.
export function imageUrl(u, width = 400) {
  const s = String(u || '').trim();
  if (!/^https:\/\//i.test(s)) return null;
  const drive = /^https:\/\/drive\.google\.com\//i.test(s) && (/[?&]id=([\w-]+)/.exec(s) || /\/d\/([\w-]+)/.exec(s));
  if (drive) return `https://lh3.googleusercontent.com/d/${drive[1]}=w${width}`;
  return /^https:\/\/i\.imgur\.com\//i.test(s) ? s : null;
}

// Compressed copy on Firebase Hosting: /drugs/<code>-pack.webp or -img.webp.
export function photoFile(no_kod, kind) {
  return `${encodeURIComponent(no_kod)}-${kind}.webp`;
}
export function hostedPhoto(no_kod, kind, photos) {
  if (!photos?.[no_kod]?.[kind]) return null;
  return `/drugs/${photoFile(no_kod, kind)}`;
}
export function pictureUrl(no_kod, raw, kind, photos = DRUG_PHOTOS) {
  return hostedPhoto(no_kod, kind, photos) || imageUrl(raw);
}

// One download per hostable picture. Old-sheet-only drugs and AppSheet paths are skipped.
export function photoJobs(drugs) {
  const jobs = [];
  for (const d of drugs) {
    if (isOldFormularyOnly(d) || !d.no_kod) continue;
    const i = d.info || {};
    for (const kind of ['pack', 'img']) {
      const raw = i[kind === 'pack' ? 'pack_img' : 'img'];
      const src = imageUrl(raw, 800);
      if (!src) continue;
      jobs.push({ no_kod: d.no_kod, kind, src, file: photoFile(d.no_kod, kind) });
    }
  }
  return jobs;
}

// Pill colour (an existing status class) for a prescriber category and a procurement route.
export function prescriberTone(c) {
  const k = String(c || '').trim().toUpperCase();
  return { 'A*': 's-over', A: 's-full', 'A/KK': 's-full', B: 's-ok', C: 's-near', 'C+': 's-near' }[k] || 's-none';
}
export function procurementTone(p) {
  const k = String(p || '').trim().toUpperCase();
  return { 'LOCAL PURCHASE': 's-over', LP: 's-over', CONTRACT: 's-ok', CC: 's-ok', APPL: 'blue' }[k] || 's-none';
}
const JENIS_LABEL = { LP: 'Local Purchase', CC: 'Contract', APPL: 'APPL' };

// The values a person reads for one drug: the MASTER (store) value first, Notion when MASTER has none.
export function drugView(d) {
  const i = d.info || {};
  const pick = (a, b) => (a != null && a !== '' ? a : b ?? null);
  return {
    brand: pick(d.brand, i.brand), form: i.form ?? null, pharm_cat: i.pharm_cat ?? null, prescriber_cat: i.prescriber_cat ?? null,
    indications: i.indications ?? null, dosage: i.dosage ?? null, administration: i.administration ?? null,
    dilution: i.dilution ?? null, renal: i.renal ?? null, hepatic: i.hepatic ?? null,
    pregnancy: i.pregnancy ?? null, breastfeeding: i.breastfeeding ?? null, remark: i.remark ?? null,
    phis: pick(d.kod_phis, i.phis), item_code: pick(i.item_code, d.no_kod), procurement: pick(i.procurement, JENIS_LABEL[d.jenis] || d.jenis),
    packaging: pick(d.pku, i.packaging), sku: pick(d.sku, i.sku), price_pack: pick(d.harga_pku, i.price_pack), price_unit: i.price_unit ?? null,
    group: pick(i.group, d.kumpulan), keep_buffer: i.keep_buffer ?? null, origin: i.origin ?? null,
    quota_url: /^https:\/\//i.test(i.quota_url || '') ? i.quota_url : null,
    kept: Array.isArray(i.kept) ? i.kept : [],
    pack_img: pictureUrl(d.no_kod, i.pack_img, 'pack'), img: pictureUrl(d.no_kod, i.img, 'img'),
  };
}
