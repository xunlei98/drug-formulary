import crypto from 'node:crypto';
import { HttpError } from '../http.js';
import { audit } from '../db.js';
import { quotaFor, allLocations } from './sync.js';

const DRUG_FIELDS = ['kategori', 'kod_phis', 'perihal', 'brand', 'jenis', 'kumpulan', 'pku', 'sku', 'harga_pku', 'yearly', 'monthly', 'min', 'max', 'buffer'];
const NUMERIC = ['harga_pku', 'yearly', 'monthly', 'min', 'max', 'buffer'];

export function catalogRoutes({ db, config }) {
  return [
    ['PATCH', '/api/drugs/:no_kod', (ctx) => {
      const cur = db.prepare('SELECT * FROM drugs WHERE no_kod = ?').get(ctx.params.no_kod);
      if (!cur) throw new HttpError(404, 'Drug not found');
      const next = { ...cur };
      for (const k of DRUG_FIELDS) if (k in ctx.body) next[k] = ctx.body[k];
      for (const k of NUMERIC) {
        if (next[k] === '' || next[k] === null) next[k] = null;
        else if (Number.isNaN(Number(next[k]))) throw new HttpError(400, `${k} must be a number`);
        else next[k] = Number(next[k]);
      }
      if (!['Ubat', 'Bukan Ubat'].includes(next.kategori) || !String(next.perihal).trim()) throw new HttpError(400, 'Kategori and Perihal Stok are required');
      db.prepare(`UPDATE drugs SET ${DRUG_FIELDS.map((k) => `${k} = @${k}`).join(', ')} WHERE no_kod = @no_kod`).run(next);
      audit(db, ctx.user, 'drug.edit', cur.no_kod, DRUG_FIELDS.filter((k) => String(cur[k]) !== String(next[k])).join(','));
      return { ok: true };
    }, 'drug.edit'],

    ['PUT', '/api/mahal/:no_kod', (ctx) => {
      const kod = ctx.params.no_kod;
      if (!db.prepare('SELECT 1 FROM drugs WHERE no_kod = ?').get(kod)) throw new HttpError(404, 'Drug not found');
      const q = ctx.body.quota === '' || ctx.body.quota === null || ctx.body.quota === undefined ? null : Number(ctx.body.quota);
      if (q !== null && (!Number.isInteger(q) || q < 0)) throw new HttpError(400, 'Kuota must be a whole number');
      const units = (ctx.body.units || []).filter((u) => u.unit);
      if (units.some((u) => !Number.isInteger(u.kuantiti) || u.kuantiti < 0)) throw new HttpError(400, 'Unit kuantiti must be a whole number');
      const day = new Date().toISOString().slice(0, 10);
      db.transaction(() => {
        db.prepare(`INSERT INTO mahal_item (no_kod, quota, nota, tarikh_kemaskini) VALUES (?,?,?,?)
          ON CONFLICT(no_kod) DO UPDATE SET quota = excluded.quota, nota = excluded.nota, tarikh_kemaskini = excluded.tarikh_kemaskini`)
          .run(kod, q, String(ctx.body.nota || '').slice(0, 300), day);
        db.prepare('DELETE FROM mahal_unit_quota WHERE no_kod = ?').run(kod);
        const ins = db.prepare('INSERT INTO mahal_unit_quota (id, no_kod, unit, kuantiti, tarikh_kemaskini, pegawai) VALUES (?,?,?,?,?,?)');
        for (const u of units) ins.run(crypto.randomUUID(), kod, u.unit, u.kuantiti, day, ctx.user.username);
      })();
      audit(db, ctx.user, 'quota.edit', kod, `quota ${q}`);
      return { ok: true };
    }, 'quota.edit'],

    ['DELETE', '/api/mahal/:no_kod', (ctx) => {
      const kod = ctx.params.no_kod;
      if (db.prepare('SELECT 1 FROM patients WHERE no_kod = ?').get(kod)) throw new HttpError(409, 'This drug still has patients. Move or remove them first.');
      db.prepare('DELETE FROM mahal_unit_quota WHERE no_kod = ?').run(kod);
      db.prepare('DELETE FROM mahal_item WHERE no_kod = ?').run(kod);
      audit(db, ctx.user, 'quota.remove', kod);
      return { ok: true };
    }, 'quota.edit'],

    ['GET', '/api/mahal/:no_kod/summary', (ctx) => {
      const s = quotaFor(db, ctx.params.no_kod, config.nearPct);
      if (!s) throw new HttpError(404, 'Not an Ubat Mahal drug');
      return s;
    }, 'quota.view'],

    ['POST', '/api/locations', (ctx) => {
      const { name, type, parent_id = null } = ctx.body;
      checkLocation(db, null, name, type, parent_id);
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO locations (id, name, type, parent_id, sort) VALUES (?,?,?,?,?)')
        .run(id, String(name).trim(), type, parent_id, (db.prepare('SELECT COALESCE(MAX(sort),0)+1 n FROM locations').get().n));
      audit(db, ctx.user, 'location.create', id, name);
      return { id };
    }, 'location.manage'],

    ['PATCH', '/api/locations/:id', (ctx) => {
      const cur = db.prepare('SELECT * FROM locations WHERE id = ?').get(ctx.params.id);
      if (!cur) throw new HttpError(404, 'Location not found');
      const next = { ...cur, ...ctx.body, id: cur.id };
      checkLocation(db, cur.id, next.name, next.type, next.parent_id);
      db.prepare('UPDATE locations SET name = ?, type = ?, parent_id = ?, disabled = ? WHERE id = ?')
        .run(String(next.name).trim(), next.type, next.parent_id || null, next.disabled ? 1 : 0, cur.id);
      audit(db, ctx.user, 'location.edit', cur.id, next.disabled ? 'disabled' : 'enabled');
      return { ok: true };
    }, 'location.manage'],

    ['GET', '/api/locations', () => ({ locations: allLocations(db) }), 'drug.view'],
  ];
}

function checkLocation(db, selfId, name, type, parentId) {
  if (!String(name || '').trim()) throw new HttpError(400, 'Name required');
  if (!['store', 'ward', 'shelf'].includes(type)) throw new HttpError(400, 'Type must be store, ward or shelf');
  if (type === 'shelf' && !parentId) throw new HttpError(400, 'A shelf needs a parent store or ward');
  if (parentId) {
    if (!db.prepare('SELECT 1 FROM locations WHERE id = ?').get(parentId)) throw new HttpError(400, 'Parent not found');
    for (let id = parentId; id; id = db.prepare('SELECT parent_id FROM locations WHERE id = ?').get(id)?.parent_id) {
      if (id === selfId) throw new HttpError(400, 'A location cannot sit under itself');
    }
  }
}
