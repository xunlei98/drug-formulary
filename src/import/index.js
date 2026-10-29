import crypto from 'node:crypto';
import { parseRecords, num, isoDate } from './csv.js';
import { audit, now } from '../db.js';
import { KATEGORI, UNITS } from '../../shared/patient-state.js';
import { parseFloorStock, buildIndex, matchRow } from './floorstock.js';

class Rollback extends Error {}

function run(db, user, kind, dryRun, work) {
  const result = { added: 0, updated: 0, skipped: 0, errors: [] };
  try {
    db.transaction(() => {
      work(result);
      if (dryRun) throw new Rollback();
    })();
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  result.dryRun = !!dryRun;
  if (!dryRun) audit(db, user, `import.${kind}`, null, `added ${result.added}, updated ${result.updated}, errors ${result.errors.length}`);
  return result;
}

const err = (r, line, message) => { r.errors.push({ line, message }); r.skipped++; };

export function importMaster(db, text, { user = null, dryRun = false } = {}) {
  const recs = parseRecords(text, ['Kategori', 'Kod PhIS', 'No Kod', 'Perihal Stok']);
  return run(db, user, 'master', dryRun, (r) => {
    const exists = db.prepare('SELECT 1 FROM drugs WHERE no_kod = ?');
    const upsert = db.prepare(`INSERT INTO drugs (no_kod, kategori, kod_phis, perihal, brand, jenis, kumpulan, pku, sku, harga_pku, yearly, monthly, min, max, buffer)
      VALUES (@no_kod,@kategori,@kod_phis,@perihal,@brand,@jenis,@kumpulan,@pku,@sku,@harga_pku,@yearly,@monthly,@min,@max,@buffer)
      ON CONFLICT(no_kod) DO UPDATE SET kategori=excluded.kategori, kod_phis=excluded.kod_phis, perihal=excluded.perihal, brand=excluded.brand,
        jenis=excluded.jenis, kumpulan=excluded.kumpulan, pku=excluded.pku, sku=excluded.sku, harga_pku=excluded.harga_pku,
        yearly=excluded.yearly, monthly=excluded.monthly, min=excluded.min, max=excluded.max, buffer=excluded.buffer`);
    for (const x of recs) {
      const row = {
        no_kod: x.get('No Kod'), kategori: x.get('Kategori'), kod_phis: x.get('Kod PhIS'), perihal: x.get('Perihal Stok'),
        brand: x.get('Brand'), jenis: x.get('Jenis Perolehan Stok'), kumpulan: x.get('Kumpulan'), pku: x.get('PKU'), sku: x.get('SKU'),
        harga_pku: num(x.get('Harga PKU')), yearly: num(x.get('Yearly')), monthly: num(x.get('Monthly')),
        min: num(x.get('Min')), max: num(x.get('Max')), buffer: num(x.get('Buffer')),
      };
      if (!row.no_kod || !row.perihal) { err(r, x.line, 'No Kod and Perihal Stok are required'); continue; }
      if (!['Ubat', 'Bukan Ubat'].includes(row.kategori)) { err(r, x.line, `Kategori must be Ubat or Bukan Ubat, got "${row.kategori}"`); continue; }
      if (['harga_pku', 'yearly', 'monthly', 'min', 'max', 'buffer'].some((k) => Number.isNaN(row[k]))) { err(r, x.line, 'A number column is not a number'); continue; }
      if (exists.get(row.no_kod)) r.updated++; else r.added++;
      upsert.run(row);
    }
  });
}

export function importItemMahal(db, text, { user = null, dryRun = false } = {}) {
  const recs = parseRecords(text, ['No Kod', 'Kuota']);
  return run(db, user, 'item-mahal', dryRun, (r) => {
    const drug = db.prepare('SELECT 1 FROM drugs WHERE no_kod = ?');
    const exists = db.prepare('SELECT 1 FROM mahal_item WHERE no_kod = ?');
    const upsert = db.prepare(`INSERT INTO mahal_item (no_kod, quota, nota, tarikh_kemaskini) VALUES (?,?,?,?)
      ON CONFLICT(no_kod) DO UPDATE SET quota = excluded.quota, nota = excluded.nota, tarikh_kemaskini = excluded.tarikh_kemaskini`);
    for (const x of recs) {
      const kod = x.get('No Kod');
      const quota = num(x.get('Kuota'));
      const date = isoDate(x.get('Tarikh Kemaskini'));
      if (!drug.get(kod)) { err(r, x.line, `No Kod ${kod} is not in the formulary. Import MASTER first.`); continue; }
      if (quota !== null && (Number.isNaN(quota) || !Number.isInteger(quota) || quota < 0)) { err(r, x.line, 'Kuota must be a whole number'); continue; }
      if (date === undefined) { err(r, x.line, 'Bad date. Use DD/MM/YYYY.'); continue; }
      if (exists.get(kod)) r.updated++; else r.added++;
      upsert.run(kod, quota, x.get('Nota'), date);
    }
  });
}

export function importKuotaUnit(db, text, { user = null, dryRun = false } = {}) {
  const recs = parseRecords(text, ['ID', 'No Kod', 'Kuantiti', 'Unit']);
  return run(db, user, 'kuota-unit', dryRun, (r) => {
    const item = db.prepare('SELECT 1 FROM mahal_item WHERE no_kod = ?');
    const exists = db.prepare('SELECT 1 FROM mahal_unit_quota WHERE id = ?');
    const upsert = db.prepare(`INSERT INTO mahal_unit_quota (id, no_kod, unit, kuantiti, tarikh_kemaskini, pegawai) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET no_kod=excluded.no_kod, unit=excluded.unit, kuantiti=excluded.kuantiti, tarikh_kemaskini=excluded.tarikh_kemaskini, pegawai=excluded.pegawai`);
    for (const x of recs) {
      const qty = num(x.get('Kuantiti'));
      const date = isoDate(x.get('Tarikh Kemaskini'));
      if (!x.get('ID') || !x.get('Unit') || qty === null || Number.isNaN(qty)) { err(r, x.line, 'ID, Unit and Kuantiti are required'); continue; }
      if (!item.get(x.get('No Kod'))) { err(r, x.line, 'Drug is not in Item Mahal. Import Item Mahal first.'); continue; }
      if (date === undefined) { err(r, x.line, 'Bad date. Use DD/MM/YYYY.'); continue; }
      if (exists.get(x.get('ID'))) r.updated++; else r.added++;
      upsert.run(x.get('ID'), x.get('No Kod'), x.get('Unit'), qty, date, x.get('Pegawai'));
    }
  });
}

export function importPatients(db, text, { user = null, dryRun = false } = {}) {
  const recs = parseRecords(text, ['KeyID', 'No Kod', 'Nama Pesakit', 'Kategori']);
  return run(db, user, 'patients', dryRun, (r) => {
    const item = db.prepare('SELECT 1 FROM mahal_item WHERE no_kod = ?');
    const byKey = db.prepare('SELECT id FROM patients WHERE key_id = ?');
    const ins = db.prepare(`INSERT INTO patients (id, key_id, no_kod, nama, ic, kategori, dos, kuantiti_setahun, preskriber, unit, tarikh_mula, tarikh_henti, nota, tarikh_kemaskini)
      VALUES (@id,@key_id,@no_kod,@nama,@ic,@kategori,@dos,@kuantiti_setahun,@preskriber,@unit,@tarikh_mula,@tarikh_henti,@nota,@tarikh_kemaskini)
      ON CONFLICT(key_id) DO UPDATE SET no_kod=excluded.no_kod, nama=excluded.nama, ic=excluded.ic, kategori=excluded.kategori, dos=excluded.dos,
        kuantiti_setahun=excluded.kuantiti_setahun, preskriber=excluded.preskriber, unit=excluded.unit, tarikh_mula=excluded.tarikh_mula,
        tarikh_henti=excluded.tarikh_henti, nota=excluded.nota, tarikh_kemaskini=excluded.tarikh_kemaskini`);
    for (const x of recs) {
      const key = x.get('KeyID');
      const row = {
        id: crypto.randomUUID(), key_id: key, no_kod: x.get('No Kod'), nama: x.get('Nama Pesakit'), ic: x.get('No Kad Pengenalan'),
        kategori: x.get('Kategori'), dos: x.get('Dos'), kuantiti_setahun: num(x.get('Kuantiti Setahun')), preskriber: x.get('Preskriber'),
        unit: x.get('Unit'), tarikh_mula: isoDate(x.get('Tarikh Mula')), tarikh_henti: isoDate(x.get('Tarikh Henti')), nota: x.get('Nota'),
        tarikh_kemaskini: isoDate(x.get('Tarikh Kemaskini')),
      };
      const why = !key ? 'KeyID is required'
        : !row.nama ? 'Name is required'
        : !item.get(row.no_kod) ? 'No Kod is not in Item Mahal'
        : !KATEGORI.includes(row.kategori) ? 'Unknown Kategori'
        : row.unit && !UNITS.includes(row.unit) ? 'Unknown Unit'
        : [row.tarikh_mula, row.tarikh_henti, row.tarikh_kemaskini].includes(undefined) ? 'Bad date. Use DD/MM/YYYY.'
        : Number.isNaN(row.kuantiti_setahun) ? 'Kuantiti Setahun is not a number'
        : null;
      if (why) { err(r, x.line, why); continue; }
      if (byKey.get(key)) r.updated++; else r.added++;
      ins.run(row);
    }
  });
}

// Replaces every par level for one location with the rows parsed from its floor stock list.
export function importFloorStock(db, text, { user = null, dryRun = false, location } = {}) {
  const loc = db.prepare('SELECT id, disabled FROM locations WHERE id = ?').get(String(location || ''));
  if (!loc || loc.disabled) throw new Error('Choose an active location for this floor stock list.');
  const rows = parseFloorStock(text);
  if (!rows.length) throw new Error('No floor stock rows found. Is this a "Senarai Floor Stock" PDF?');
  const index = buildIndex(db.prepare('SELECT no_kod, perihal FROM drugs').all());
  const out = { matched: 0, unmatched: [], review: [] };
  const result = run(db, user, `floorstock:${loc.id}`, dryRun, (r) => {
    r.updated = db.prepare('DELETE FROM par_levels WHERE location = ?').run(loc.id).changes;
    const ins = db.prepare(`INSERT INTO par_levels (location, list, item_name, sku_unit, max_qty, note, drug, match, score, imported_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const at = now();
    for (const row of rows) {
      const m = matchRow(row.name, index);
      ins.run(loc.id, row.list, row.name, row.unit, row.max, row.note || null, m.drug, m.match, m.score, at);
      r.added++;
      if (row.max === null) r.errors.push({ line: row.line, message: `No approved quantity for "${row.name}"` });
      if (m.drug) out.matched++; else out.unmatched.push({ ...row, score: m.score });
      if (m.match === 'low' || m.match === 'high') out.review.push({ ...row, drug: m.drug, match: m.match, score: m.score });
    }
  });
  return { ...result, parsed: rows.length, ...out };
}

export const IMPORTERS = { floorstock: importFloorStock, master: importMaster, 'item-mahal': importItemMahal, 'kuota-unit': importKuotaUnit, patients: importPatients };
