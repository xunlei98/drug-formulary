// Drug information from the old "DRUG FORMULARY" sheet (columns C to X), matched onto formulary drugs.
// Pure: parse, match and merge return data; the merge script and the seed write it.
import { parseRecords, num } from './csv.js';
import { norm, buildIndex, matchRow } from './floorstock.js';

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

const JENIS = { APPL: 'APPL', 'LOCAL PURCHASE': 'LP', LP: 'LP', CONTRACT: 'CC', CC: 'CC' };

// A sheet row nobody matched becomes a new drug when it has a usable item code
// and no formulary name looks like it (those may be the same item under another code, so a person decides).
export function newDrugFrom(row) {
  const kod = row.info.item_code;
  if (!kod || kod.includes('/')) return null;
  const i = row.info;
  const d = { no_kod: kod, kategori: 'Ubat', kod_phis: i.phis || '', perihal: row.item, brand: i.brand || '', jenis: JENIS[code(i.procurement)] || '',
    kumpulan: i.group || '', pku: i.packaging || '', sku: i.sku || '', harga_pku: i.price_pack ?? null,
    yearly: null, monthly: null, min: null, max: null, buffer: null, source: 'old-formulary-sheet' };
  return d;
}

// Returns a new Map with info set on matched drugs and new drugs added. Drugs with no sheet row keep their info.
export function mergeInfo(drugs, { matched, unmatched }, rows, { addNew = true } = {}) {
  const out = new Map(drugs);
  for (const [kod, c] of matched) out.set(kod, { ...out.get(kod), info: c.row.info });
  const added = [];
  if (addNew) {
    const byLine = new Map(rows.map((r) => [r.line, r]));
    for (const u of unmatched) {
      if (u.suggest) continue;
      const d = newDrugFrom(byLine.get(u.line));
      if (!d || out.has(d.no_kod)) continue;
      out.set(d.no_kod, { ...d, info: byLine.get(u.line).info });
      added.push(d.no_kod);
    }
  }
  return { drugs: out, added };
}

// Picture URL the app may load: Drive links become the small lh3 thumbnail; anything not https (old AppSheet paths) is dropped.
export function imageUrl(u, width = 400) {
  const s = String(u || '').trim();
  if (!/^https:\/\//i.test(s)) return null;
  const drive = /^https:\/\/drive\.google\.com\//i.test(s) && (/[?&]id=([\w-]+)/.exec(s) || /\/d\/([\w-]+)/.exec(s));
  if (drive) return `https://lh3.googleusercontent.com/d/${drive[1]}=w${width}`;
  return /^https:\/\/i\.imgur\.com\//i.test(s) ? s : null;
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

// The values a person reads for one drug: the MASTER (store) value first, the old sheet's value when MASTER has none.
export function drugView(d) {
  const i = d.info || {};
  const pick = (a, b) => (a != null && a !== '' ? a : b ?? null);
  return {
    brand: pick(d.brand, i.brand), form: i.form ?? null, pharm_cat: i.pharm_cat ?? null, prescriber_cat: i.prescriber_cat ?? null,
    indications: i.indications ?? null, dosage: i.dosage ?? null, dilution: i.dilution ?? null, renal: i.renal ?? null,
    pregnancy: i.pregnancy ?? null, breastfeeding: i.breastfeeding ?? null,
    phis: pick(d.kod_phis, i.phis), item_code: pick(i.item_code, d.no_kod), procurement: pick(i.procurement, JENIS_LABEL[d.jenis] || d.jenis),
    packaging: pick(d.pku, i.packaging), sku: pick(d.sku, i.sku), price_pack: pick(d.harga_pku, i.price_pack), price_unit: i.price_unit ?? null,
    group: pick(i.group, d.kumpulan), keep_buffer: i.keep_buffer ?? null, origin: i.origin ?? null,
    pack_img: imageUrl(i.pack_img), img: imageUrl(i.img), old_sheet_only: d.source === 'old-formulary-sheet',
  };
}
