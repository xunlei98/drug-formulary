import { HttpError } from '../http.js';
import { publicConfig } from '../config.js';
import { can, canLog, viewScope } from '../../shared/perm.js';
import { summarize } from '../../shared/quota.js';
import { now } from '../db.js';
import { recordMovement, openDiscrepancies } from '../stock.js';
import { createPatient, updatePatient, minimalPatient, OFFLINE_PATCH_FIELDS } from '../patients.js';

const MAX_OPS = 200;

export function quotaFor(db, noKod, nearPct) {
  const item = db.prepare('SELECT quota FROM mahal_item WHERE no_kod = ?').get(noKod);
  if (!item) return null;
  const ps = db.prepare('SELECT kategori, unit FROM patients WHERE no_kod = ?').all(noKod);
  return summarize(item.quota, ps, nearPct);
}

function applyOp(db, config, user, op, mode, locations) {
  if (op.kind === 'movement') {
    if (!can(user.role, 'stock.log')) return { status: 'rejected', reason: 'not allowed' };
    const m = { ...op.movement, id: op.id };
    if (!canLog(user, m, locations)) return { status: 'rejected', reason: 'not allowed for your location' };
    return recordMovement(db, m, user, mode);
  }
  if (op.kind === 'patient_create') {
    if (!can(user.role, 'patient.edit')) return { status: 'rejected', reason: 'not allowed' };
    if (mode !== 'live') return { status: 'rejected', reason: 'new patients can only be added online' };
    const r = createPatient(db, op.id, op.patient || {}, user);
    return r.status === 'applied' ? withQuota(db, config, r, op.patient.no_kod) : r;
  }
  if (op.kind === 'patient_update') {
    if (!can(user.role, 'patient.edit')) return { status: 'rejected', reason: 'not allowed' };
    const patch = op.patch || {};
    if (mode !== 'live' && Object.keys(patch).some((k) => !OFFLINE_PATCH_FIELDS.includes(k))) return { status: 'rejected', reason: 'that change can only be made online' };
    const r = updatePatient(db, op.patient_id, patch, user);
    const row = db.prepare('SELECT no_kod FROM patients WHERE id = ?').get(op.patient_id);
    return r.status === 'applied' && row ? withQuota(db, config, r, row.no_kod) : r;
  }
  return { status: 'rejected', reason: 'unknown operation' };
}

function withQuota(db, config, r, noKod) {
  const q = quotaFor(db, noKod, config.nearPct);
  return q && (q.status === 'over') ? { ...r, warning: `Over quota by ${q.over}` } : r;
}

export const allLocations = (db) => db.prepare('SELECT id, name, type, parent_id, disabled, sort FROM locations ORDER BY sort, name').all();

export function syncRoutes({ db, config }) {
  const processed = db.prepare('SELECT result FROM applied_ops WHERE id = ?');
  const remember = db.prepare('INSERT INTO applied_ops (id, kind, user_id, applied_at, result) VALUES (?,?,?,?,?)');

  return [
    ['POST', '/api/sync', (ctx) => {
      const { ops, mode } = ctx.body;
      if (!Array.isArray(ops) || ops.length > MAX_OPS) throw new HttpError(400, `Send 1 to ${MAX_OPS} operations`);
      const locations = allLocations(db);
      const results = [];
      for (const op of ops) {
        if (!op || typeof op.id !== 'string' || op.id.length < 8) { results.push({ id: op?.id, status: 'rejected', reason: 'bad id' }); continue; }
        const done = processed.get(op.id);
        if (done) { results.push({ ...JSON.parse(done.result), id: op.id, status: 'duplicate' }); continue; }
        const r = db.transaction(() => {
          const out = applyOp(db, config, ctx.user, op, mode === 'live' ? 'live' : 'replay', locations);
          if (out.status === 'applied') remember.run(op.id, op.kind, ctx.user.id, now(), JSON.stringify(out));
          return out;
        })();
        results.push({ id: op.id, ...r });
      }
      return { results, serverTime: now() };
    }, 'any'],

    ['GET', '/api/snapshot', (ctx) => {
      const u = ctx.user;
      const locations = allLocations(db);
      const scope = viewScope(u, locations, config.wardStockScope);
      const inScope = (l) => !scope || scope.has(l);
      // Zero rows are kept: a counted zero is "low", a missing row is "not counted".
      const balances = db.prepare('SELECT drug, location, qty FROM balances').all().filter((b) => inScope(b.location));
      const par = db.prepare(`SELECT drug, location, list, max_qty, sku_unit, note FROM par_levels
        WHERE drug IS NOT NULL AND max_qty IS NOT NULL ORDER BY location, list, id`).all().filter((p) => inScope(p.location));
      const movements = db.prepare(`SELECT id, drug, from_location AS "from", to_location AS "to", qty, type, username, server_time, note, reverses
        FROM movements ORDER BY seq DESC LIMIT 2000`).all().filter((m) => inScope(m.from) || inScope(m.to)).slice(0, 1500);
      const mahal = db.prepare('SELECT no_kod, quota, nota, tarikh_kemaskini FROM mahal_item').all();
      const units = db.prepare('SELECT no_kod, unit, kuantiti FROM mahal_unit_quota').all();
      const snap = {
        serverTime: now(),
        config: publicConfig(config),
        drugs: db.prepare('SELECT * FROM drugs ORDER BY perihal').all(),
        mahal: mahal.map((m) => ({ ...m, units: units.filter((x) => x.no_kod === m.no_kod).map(({ unit, kuantiti }) => ({ unit, kuantiti })) })),
        counts: db.prepare('SELECT no_kod, unit, kategori, COUNT(*) AS n FROM patients GROUP BY no_kod, unit, kategori').all(),
        locations, balances, movements, par,
      };
      if (can(u.role, 'patient.view') && config.offlinePatients === 'minimal') {
        snap.patients = db.prepare('SELECT * FROM patients').all().map(minimalPatient);
      }
      return snap;
    }, 'drug.view'],

    ['GET', '/api/discrepancies', () => ({ items: openDiscrepancies(db) }), 'stock.review'],

    ['POST', '/api/discrepancies/:id/resolve', (ctx) => {
      const r = db.prepare('UPDATE discrepancies SET resolved_at = ?, resolved_by = ?, resolve_note = ? WHERE id = ? AND resolved_at IS NULL')
        .run(now(), ctx.user.username, String(ctx.body.note || '').slice(0, 300), ctx.params.id);
      if (!r.changes) throw new HttpError(404, 'Already resolved or not found');
      return { ok: true };
    }, 'stock.review'],
  ];
}
