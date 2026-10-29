import { KATEGORI, UNITS, NEEDS_STOP_DATE, canMove } from '../shared/patient-state.js';
import { maskIc } from '../shared/ic.js';
import { now, audit } from './db.js';

const FIELDS = ['no_kod', 'nama', 'ic', 'kategori', 'dos', 'kuantiti_setahun', 'preskriber', 'unit', 'tarikh_mula', 'tarikh_henti', 'nota'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => now().slice(0, 10);

export function validatePatient(p, existing) {
  const v = { ...existing, ...p };
  if (!v.nama || !String(v.nama).trim()) return 'name required';
  if (!KATEGORI.includes(v.kategori)) return 'bad kategori';
  if (v.unit && !UNITS.includes(v.unit)) return 'bad unit';
  for (const f of ['tarikh_mula', 'tarikh_henti']) if (v[f] && !DATE.test(v[f])) return `${f} must be YYYY-MM-DD`;
  if (NEEDS_STOP_DATE.includes(v.kategori) && !v.tarikh_henti) return 'stop date required for Off or Defaulted';
  if (v.kuantiti_setahun !== null && v.kuantiti_setahun !== undefined && v.kuantiti_setahun !== '' && Number.isNaN(Number(v.kuantiti_setahun))) return 'kuantiti setahun must be a number';
  return null;
}

const clean = (p) => ({
  ...p,
  ic: String(p.ic ?? '').trim().slice(0, 20),
  nama: String(p.nama ?? '').trim().slice(0, 120),
  kuantiti_setahun: p.kuantiti_setahun === '' || p.kuantiti_setahun === undefined ? null : p.kuantiti_setahun,
  tarikh_henti: p.tarikh_henti || null,
  tarikh_mula: p.tarikh_mula || null,
});

export function createPatient(db, id, input, user) {
  const p = clean(input);
  if (!db.prepare('SELECT 1 FROM mahal_item WHERE no_kod = ?').get(p.no_kod)) return { status: 'rejected', reason: 'drug is not Ubat Mahal' };
  const bad = validatePatient(p);
  if (bad) return { status: 'rejected', reason: bad };
  db.prepare(`INSERT INTO patients (id, no_kod, nama, ic, kategori, dos, kuantiti_setahun, preskriber, unit, tarikh_mula, tarikh_henti, nota, tarikh_kemaskini)
    VALUES (@id,@no_kod,@nama,@ic,@kategori,@dos,@kuantiti_setahun,@preskriber,@unit,@tarikh_mula,@tarikh_henti,@nota,@upd)`)
    .run({ dos: '', preskriber: '', unit: '', nota: '', ...p, id, upd: today() });
  logChange(db, id, user, 'create', null, p.kategori);
  audit(db, user, 'patient.create', id);
  return { status: 'applied' };
}

export function updatePatient(db, id, patch, user) {
  const cur = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
  if (!cur) return { status: 'rejected', reason: 'patient not found' };
  const fields = Object.keys(patch).filter((k) => FIELDS.includes(k));
  const next = clean({ ...cur, ...Object.fromEntries(fields.map((k) => [k, patch[k]])) });
  if (fields.includes('no_kod') && !db.prepare('SELECT 1 FROM mahal_item WHERE no_kod = ?').get(next.no_kod)) return { status: 'rejected', reason: 'drug is not Ubat Mahal' };
  if (!canMove(cur.kategori, next.kategori)) return { status: 'rejected', reason: `cannot move from ${cur.kategori} to ${next.kategori}` };
  const bad = validatePatient(next);
  if (bad) return { status: 'rejected', reason: bad };
  const set = FIELDS.map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE patients SET ${set}, tarikh_kemaskini = @upd WHERE id = @id`).run({ ...next, id, upd: today() });
  const changed = fields.filter((f) => String(cur[f] ?? '') !== String(next[f] ?? ''));
  if (cur.kategori !== next.kategori) logChange(db, id, user, 'kategori', cur.kategori, next.kategori);
  if (changed.filter((f) => f !== 'kategori').length) logChange(db, id, user, 'edit', null, null, changed.filter((f) => f !== 'kategori').join(','));
  audit(db, user, 'patient.edit', id, changed.join(','));
  return { status: 'applied' };
}

function logChange(db, id, user, action, from, to, detail = null) {
  db.prepare('INSERT INTO patient_log (ts, patient_id, username, action, from_kategori, to_kategori, detail) VALUES (?,?,?,?,?,?,?)')
    .run(now(), id, user.username, action, from, to, detail);
}

export const fullPatient = (r) => ({ ...r, ic: maskIc(r.ic) });

const initials = (name) => String(name).trim().split(/\s+/).slice(0, 3).map((w) => w[0]?.toUpperCase() || '').join('');

export const minimalPatient = (r) => ({
  id: r.id, no_kod: r.no_kod, initials: initials(r.nama), ic4: String(r.ic).replace(/\D/g, '').slice(-4),
  kategori: r.kategori, unit: r.unit, preskriber: r.preskriber, tarikh_mula: r.tarikh_mula, tarikh_henti: r.tarikh_henti,
});

export const OFFLINE_PATCH_FIELDS = ['kategori', 'tarikh_henti', 'tarikh_mula'];
