// Clinical text and kept-at lists from the Notion formulary, matched onto MASTER drugs.
// A row that matches no MASTER drug is not added. Text that contains an identity-card number is left out.
import { matchInfo, isOldFormularyOnly } from './druginfo.js';

const IC = /(?:\b\d{6}-\d{2}-\d{4}\b|\b\d{12}\b)/;

export const KEPT_LOC = {
  'wad lelaki': 'male-ward',
  'wad perempuan': 'female-ward',
  etd: 'etd',
  icu: 'icu',
  hdu: 'hdu',
  endoscopy: 'unit-endoscopy',
  'wad maternity': 'maternity-ward',
  'wad maternity (1)': 'maternity-ward',
  'wad pediatrik': 'paeds-ward',
  'klinik psikiatri': 'klinik-psikiatrik',
  'klinik mata': 'klinik-mata',
  'klinik pakar': 'klinik-pakar',
  'bilik mo': 'opd-mo-room',
  ot: 'ot',
  'treatment room': 'treatment-room',
  radiology: 'unit-radiology',
};

const KIND = {
  'floor stock': 'floor',
  aoh: 'aoh',
  'emergency trolley': 'trolley',
  dda: 'dda',
};

const TEXT = [
  ['brand', ['brand', 'Brand']], ['form', ['form', 'Form']], ['pharm_cat', ['pharm_cat', 'Pharmacologic Category']],
  ['prescriber_cat', ['prescriber_cat', 'Prescriber Category']], ['pregnancy', ['pregnancy', 'Pregnancy Category']],
  ['breastfeeding', ['breastfeeding', 'Breastfeeding Consideration']], ['indications', ['indications', 'Indications']],
  ['dosage', ['dosage', 'Dosage']], ['administration', ['administration', 'Administration']], ['dilution', ['dilution', 'Dilution']],
  ['renal', ['renal', 'Renal Dosage Adjustments']], ['hepatic', ['hepatic', 'Hepatic Dosage Adjustments']],
  ['phis', ['phis', 'PhIS Code']], ['item_code', ['item_code', 'Item Code']], ['procurement', ['procurement', 'Procurement']],
  ['packaging', ['packaging', 'Packaging']], ['sku', ['sku', 'SKU']], ['group', ['grp', 'Group']], ['remark', ['remark', 'Remark']],
];

function pick(row, keys) {
  for (const k of keys) if (row[k] != null && String(row[k]).trim() !== '') return row[k];
}

export function notionId(url) {
  const m = String(url || '').match(/([0-9a-f]{32})/i);
  return m ? m[1].toLowerCase() : '';
}

function clean(v, dropped) {
  if (v == null) return;
  const s = String(v)
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<mention\b[^>]*\/>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\([<>[\]])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!s) return;
  if (IC.test(s)) { dropped.n += 1; return; }
  return s;
}

function price(v) {
  if (v == null || v === '') return;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function notionInfo(row, dropped = { n: 0 }) {
  const info = {};
  for (const [key, cols] of TEXT) {
    const v = clean(pick(row, cols), dropped);
    if (v) info[key] = v;
  }
  const pack = price(pick(row, ['price_pack', 'Price Per Pack (RM)']));
  const unit = price(pick(row, ['price_unit', 'Price Per Unit (RM)']));
  if (pack != null) info.price_pack = pack;
  if (unit != null) info.price_unit = unit;
  const quota = clean(pick(row, ['quota', 'Quota']), dropped);
  if (quota && /^https:\/\//i.test(quota)) info.quota_url = quota;
  return info;
}

function parseTags(tags) {
  if (!tags) return [];
  const raw = Array.isArray(tags) ? tags : (() => { try { return JSON.parse(tags); } catch { return [tags]; } })();
  return (Array.isArray(raw) ? raw : [raw]).map(notionId).filter(Boolean);
}

export function keptRow(place) {
  const loc = String(pick(place, ['loc', 'Location']) || '').trim();
  if (!loc) return null;
  const kind = KIND[String(pick(place, ['stock', 'Stock']) || '').trim().toLowerCase()] || 'other';
  const row = { loc, kind };
  const locId = KEPT_LOC[loc.toLowerCase()];
  if (locId) row.loc_id = locId;
  const qty = String(pick(place, ['qty', 'Quantity']) || '').trim();
  if (qty) row.qty = qty;
  const note = clean(pick(place, ['note', 'Remark']), { n: 0 });
  if (note) row.note = note;
  return row;
}

const KIND_ORDER = { floor: 0, aoh: 1, trolley: 2, dda: 3, other: 4 };

function sortKept(rows) {
  return [...rows].sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)
    || a.loc.localeCompare(b.loc) || String(a.qty || '').localeCompare(String(b.qty || '')));
}

// rows: Notion formulary pages. places: Floor Stock / AOH / Emergency Trolley pages.
// Photos already stored on the drug are kept. Other old-sheet text is replaced.
export function mergeNotion(drugs, rows, places) {
  const dropped = { n: 0 };
  const parsed = [];
  for (const row of rows) {
    const item = clean(pick(row, ['item', 'Item']), dropped);
    const page = notionId(row.url);
    if (!item || !page) continue;
    parsed.push({ line: page, item, page, info: notionInfo(row, dropped) });
  }
  const m = matchInfo(parsed, drugs);
  const pageToDrug = new Map();
  for (const [kod, claim] of m.matched) pageToDrug.set(claim.row.page, kod);

  const kept = new Map();
  let placesUnused = 0;
  for (const place of places) {
    const row = keptRow(place);
    const ids = parseTags(pick(place, ['tags', 'Tags']));
    const kods = [...new Set(ids.map((id) => pageToDrug.get(id)).filter(Boolean))];
    if (!row || !kods.length) { placesUnused += 1; continue; }
    for (const kod of kods) kept.set(kod, [...(kept.get(kod) || []), row]);
  }

  const out = new Map();
  const removed = [];
  for (const [kod, d] of drugs) {
    if (isOldFormularyOnly(d)) { removed.push(kod); continue; }
    const prev = d.info || {};
    const pics = {};
    if (prev.pack_img) pics.pack_img = prev.pack_img;
    if (prev.img) pics.img = prev.img;
    const placesFor = sortKept(kept.get(kod) || []);
    const info = m.matched.has(kod) ? { ...m.matched.get(kod).row.info, ...pics } : { ...pics };
    if (placesFor.length) info.kept = placesFor;
    const next = { ...d };
    if (Object.keys(info).length) next.info = info;
    else delete next.info;
    out.set(kod, next);
  }
  return {
    drugs: out, added: [], removed, remarksLeftOut: dropped.n,
    matched: m.matched, unmatched: m.unmatched, ambiguous: m.ambiguous, tiers: m.tiers, noSheet: m.noSheet,
    keptDrugs: kept.size, placesUnused,
  };
}
