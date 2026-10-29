// Pure importers shared by the in-app Import tab and the seed script.
// Each takes the pasted text plus the current model and returns what to write, never writing anything itself.
import { parseRecords, num, isoDate } from './csv.js';
import { KATEGORI, UNITS } from './patient-state.js';
import { parseFloorStock, buildIndex, matchRow } from './floorstock.js';

const result = () => ({ added: 0, updated: 0, skipped: 0, errors: [] });
const err = (r, line, message) => { r.errors.push({ line, message }); r.skipped++; };
const NUMBERS = ['harga_pku', 'yearly', 'monthly', 'min', 'max', 'buffer'];

// drugs: Map no_kod -> drug. Returns a new Map with the rows merged in.
export function importMaster(text, { drugs = new Map() } = {}) {
  const recs = parseRecords(text, ['Kategori', 'Kod PhIS', 'No Kod', 'Perihal Stok']);
  const r = result();
  const out = new Map(drugs);
  for (const x of recs) {
    const row = {
      no_kod: x.get('No Kod'), kategori: x.get('Kategori'), kod_phis: x.get('Kod PhIS'), perihal: x.get('Perihal Stok'),
      brand: x.get('Brand'), jenis: x.get('Jenis Perolehan Stok'), kumpulan: x.get('Kumpulan'), pku: x.get('PKU'), sku: x.get('SKU'),
      harga_pku: num(x.get('Harga PKU')), yearly: num(x.get('Yearly')), monthly: num(x.get('Monthly')),
      min: num(x.get('Min')), max: num(x.get('Max')), buffer: num(x.get('Buffer')),
    };
    if (!row.no_kod || !row.perihal) { err(r, x.line, 'No Kod and Perihal Stok are required'); continue; }
    if (row.no_kod.includes('/')) { err(r, x.line, 'No Kod must not contain "/"'); continue; }
    if (!['Ubat', 'Bukan Ubat'].includes(row.kategori)) { err(r, x.line, `Kategori must be Ubat or Bukan Ubat, got "${row.kategori}"`); continue; }
    if (NUMBERS.some((k) => Number.isNaN(row[k]))) { err(r, x.line, 'A number column is not a number'); continue; }
    if (out.has(row.no_kod)) r.updated++; else r.added++;
    out.set(row.no_kod, row);
  }
  return { result: r, drugs: out };
}

// mahal: Map no_kod -> { quota, nota, tarikh_kemaskini, units: [] }. Unit splits are kept.
export function importItemMahal(text, { drugs, mahal = new Map() }) {
  const recs = parseRecords(text, ['No Kod', 'Kuota']);
  const r = result();
  const out = new Map(mahal);
  for (const x of recs) {
    const kod = x.get('No Kod');
    const quota = num(x.get('Kuota'));
    const date = isoDate(x.get('Tarikh Kemaskini'));
    if (!drugs.has(kod)) { err(r, x.line, `No Kod ${kod} is not in the formulary. Import MASTER first.`); continue; }
    if (quota !== null && (Number.isNaN(quota) || !Number.isInteger(quota) || quota < 0)) { err(r, x.line, 'Kuota must be a whole number'); continue; }
    if (date === undefined) { err(r, x.line, 'Bad date. Use DD/MM/YYYY.'); continue; }
    if (out.has(kod)) r.updated++; else r.added++;
    out.set(kod, { units: [], ...out.get(kod), quota, nota: x.get('Nota'), tarikh_kemaskini: date });
  }
  return { result: r, mahal: out };
}

// Unit rows are keyed by the sheet's ID, so a re-import updates them in place, even if the drug changed.
export function importKuotaUnit(text, { mahal }) {
  const recs = parseRecords(text, ['ID', 'No Kod', 'Kuantiti', 'Unit']);
  const r = result();
  const out = new Map([...mahal].map(([k, m]) => [k, { ...m, units: [...(m.units || [])] }]));
  for (const x of recs) {
    const id = x.get('ID');
    const kod = x.get('No Kod');
    const qty = num(x.get('Kuantiti'));
    const date = isoDate(x.get('Tarikh Kemaskini'));
    if (!id || !x.get('Unit') || qty === null || Number.isNaN(qty)) { err(r, x.line, 'ID, Unit and Kuantiti are required'); continue; }
    if (!out.has(kod)) { err(r, x.line, 'Drug is not in Item Mahal. Import Item Mahal first.'); continue; }
    if (date === undefined) { err(r, x.line, 'Bad date. Use DD/MM/YYYY.'); continue; }
    let found = false;
    for (const m of out.values()) {
      const i = m.units.findIndex((u) => u.id === id);
      if (i >= 0) { m.units.splice(i, 1); found = true; }
    }
    if (found) r.updated++; else r.added++;
    out.get(kod).units.push({ id, unit: x.get('Unit'), kuantiti: qty, tarikh_kemaskini: date, pegawai: x.get('Pegawai') });
  }
  return { result: r, mahal: out };
}

const initials = (name) => String(name).trim().split(/\s+/).slice(0, 3).map((w) => w[0]?.toUpperCase() || '').join('');
export const patientId = (keyId) => `k_${String(keyId).replace(/[^A-Za-z0-9_-]/g, '_')}`;

// Splits one patient into the cached minimal record and the identity record that is only ever read online.
export function splitPatient(p) {
  const minimal = {
    no_kod: p.no_kod, initials: initials(p.nama), ic4: String(p.ic || '').replace(/\D/g, '').slice(-4),
    kategori: p.kategori, unit: p.unit || '', preskriber: p.preskriber || '',
    tarikh_mula: p.tarikh_mula || null, tarikh_henti: p.tarikh_henti || null, tarikh_kemaskini: p.tarikh_kemaskini || null,
  };
  const identity = {
    no_kod: p.no_kod, nama: String(p.nama || '').trim().slice(0, 120), ic: String(p.ic || '').trim().slice(0, 20),
    dos: p.dos || '', kuantiti_setahun: p.kuantiti_setahun ?? null, nota: p.nota || '', key_id: p.key_id || null,
  };
  return { minimal, identity };
}

export const isDemoPatient = (p) => /^DEMO PATIENT \d+$/.test(p.nama) && /^000000-00-\d{4}$/.test(p.ic);

// Real patient rows are refused unless realAllowed is true. See docs/deploy.md, "Patient data".
export function importPatients(text, { mahal, known = new Set(), realAllowed = false }) {
  const recs = parseRecords(text, ['KeyID', 'No Kod', 'Nama Pesakit', 'Kategori']);
  const r = result();
  const rows = [];
  for (const x of recs) {
    const key = x.get('KeyID');
    const p = {
      key_id: key, no_kod: x.get('No Kod'), nama: x.get('Nama Pesakit'), ic: x.get('No Kad Pengenalan'),
      kategori: x.get('Kategori'), dos: x.get('Dos'), kuantiti_setahun: num(x.get('Kuantiti Setahun')), preskriber: x.get('Preskriber'),
      unit: x.get('Unit'), tarikh_mula: isoDate(x.get('Tarikh Mula')), tarikh_henti: isoDate(x.get('Tarikh Henti')), nota: x.get('Nota'),
      tarikh_kemaskini: isoDate(x.get('Tarikh Kemaskini')),
    };
    const why = !key ? 'KeyID is required'
      : !p.nama ? 'Name is required'
      : !realAllowed && !isDemoPatient(p) ? 'Real patient data is not allowed in this project. Only DEMO PATIENT rows with IC 000000-00-xxxx.'
      : !mahal.has(p.no_kod) ? 'No Kod is not in Item Mahal'
      : !KATEGORI.includes(p.kategori) ? 'Unknown Kategori'
      : p.unit && !UNITS.includes(p.unit) ? 'Unknown Unit'
      : [p.tarikh_mula, p.tarikh_henti, p.tarikh_kemaskini].includes(undefined) ? 'Bad date. Use DD/MM/YYYY.'
      : Number.isNaN(p.kuantiti_setahun) ? 'Kuantiti Setahun is not a number'
      : null;
    if (why) { err(r, x.line, why); continue; }
    const id = patientId(key);
    if (known.has(id)) r.updated++; else r.added++;
    rows.push({ id, ...splitPatient(p) });
  }
  return { result: r, rows };
}

// Replaces one location's par rows with those parsed from its floor stock list text.
export function importFloorStock(text, { drugs, location }) {
  const parsed = parseFloorStock(text);
  if (!parsed.length) throw new Error('No floor stock rows found. Is this the text of a "Senarai Floor Stock" PDF?');
  const index = buildIndex([...drugs.values()].map((d) => ({ no_kod: d.no_kod, perihal: d.perihal })));
  const r = { ...result(), parsed: parsed.length, matched: 0, unmatched: [], review: [], rows: [] };
  for (const row of parsed) {
    const m = matchRow(row.name, index);
    r.rows.push({ location, list: row.list, item_name: row.name, sku_unit: row.unit, max_qty: row.max, note: row.note || null, drug: m.drug, match: m.match, score: m.score });
    r.added++;
    if (row.max === null) r.errors.push({ line: row.line, message: `No approved quantity for "${row.name}"` });
    if (m.drug) r.matched++; else r.unmatched.push({ ...row, score: m.score });
    if (m.match === 'low' || m.match === 'high') r.review.push({ ...row, drug: m.drug, match: m.match, score: m.score });
  }
  return r;
}

// Cuts the formulary into documents well under Firestore's 1 MiB limit.
export function chunkDrugs(drugs, size = 250) {
  const list = [...drugs.values()].sort((a, b) => a.no_kod.localeCompare(b.no_kod));
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export const STORES = [
  ['main-store', 'Main Store'], ['prepacking', 'Prepacking'], ['substore-opd', 'Substore OPD'], ['substore-ipd', 'Substore IPD'],
];
export const WARDS = [
  ['etd', 'ETD'], ['female-ward', 'Female Ward'], ['hdu', 'HDU'], ['icu', 'ICU'], ['klinik-mata', 'Klinik Mata'],
  ['klinik-pakar', 'Klinik Pakar'], ['klinik-psikiatrik', 'Klinik Psikiatrik'], ['male-ward', 'Male Ward'],
  ['maternity-ward', 'Maternity Ward'], ['opd-mo-room', 'OPD MO Room'], ['ot', 'OT'], ['paeds-ward', 'Paeds Ward'],
  ['treatment-room', 'Treatment Room'], ['unit-endoscopy', 'Unit Endoscopy'], ['unit-radiology', 'Unit Radiology'],
];

export function defaultLocations() {
  const byId = {};
  STORES.forEach(([id, name], i) => { byId[id] = { id, name, type: 'store', parent_id: null, disabled: false, sort: i + 1 }; });
  WARDS.forEach(([id, name], i) => { byId[id] = { id, name, type: 'ward', parent_id: null, disabled: false, sort: 10 + i }; });
  return byId;
}

// Demo patients for the trial project. Never real people.
export function demoPatients(mahalCodes, n = 24) {
  const units = UNITS;
  const kats = ['Active', 'Active', 'Active - Pesara', 'Waiting List', 'Off'];
  return Array.from({ length: n }, (_, i) => {
    const num3 = String(i + 1).padStart(3, '0');
    const kategori = kats[i % kats.length];
    const p = {
      key_id: `DEMO-${num3}`, no_kod: mahalCodes[i % mahalCodes.length], nama: `DEMO PATIENT ${num3}`, ic: `000000-00-${String(i + 1).padStart(4, '0')}`,
      kategori, dos: 'Demo dose', kuantiti_setahun: null, preskriber: 'Dr Demo', unit: units[i % units.length],
      tarikh_mula: '2026-01-15', tarikh_henti: kategori === 'Off' ? '2026-06-30' : null, nota: '', tarikh_kemaskini: '2026-10-01',
    };
    return { id: patientId(p.key_id), ...splitPatient(p) };
  });
}
