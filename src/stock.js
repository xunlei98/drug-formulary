import { validateShape, applyMovement, negativesAfter, isInverse } from '../shared/ledger.js';
import { now } from './db.js';

function balanceMap(db, drug, locs) {
  const map = new Map();
  const get = db.prepare('SELECT qty FROM balances WHERE drug = ? AND location = ?');
  for (const l of locs.filter(Boolean)) map.set(`${drug}|${l}`, get.get(drug, l)?.qty ?? 0);
  return map;
}

function checkRefs(db, m, mode) {
  if (!db.prepare('SELECT 1 FROM drugs WHERE no_kod = ?').get(m.drug)) return 'unknown drug';
  for (const l of [m.from, m.to].filter(Boolean)) {
    const loc = db.prepare('SELECT disabled FROM locations WHERE id = ?').get(l);
    if (!loc) return 'unknown location';
    if (loc.disabled && mode === 'live') return 'location is disabled';
  }
  return null;
}

export function recordMovement(db, m, user, mode) {
  const shape = validateShape(m);
  if (shape) return { status: 'rejected', reason: shape };
  const ref = checkRefs(db, m, mode);
  if (ref) return { status: 'rejected', reason: ref };

  if (m.reverses) {
    const orig = db.prepare('SELECT * FROM movements WHERE id = ?').get(m.reverses);
    if (!orig) return { status: 'rejected', reason: 'movement to undo not found' };
    if (db.prepare('SELECT 1 FROM movements WHERE reverses = ?').get(m.reverses)) return { status: 'rejected', reason: 'already undone' };
    const o = { id: orig.id, drug: orig.drug, type: orig.type, qty: orig.qty, from: orig.from_location, to: orig.to_location };
    if (!isInverse(o, m)) return { status: 'rejected', reason: 'not the reverse of that movement' };
  }

  const bal = balanceMap(db, m.drug, [m.from, m.to]);
  const neg = negativesAfter(bal, m);
  if (neg.length && mode === 'live') return { status: 'rejected', reason: 'not enough stock at that location' };

  const { variance } = applyMovement(bal, m);
  db.prepare(`INSERT INTO movements (id, drug, from_location, to_location, qty, type, user_id, username, device_time, server_time, note, variance, reverses)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(m.id, m.drug, m.from || null, m.to || null, m.qty, m.type, user.id, user.username, m.device_time || null, now(), String(m.note || '').slice(0, 300), variance ?? null, m.reverses || null);
  const put = db.prepare('INSERT INTO balances (drug, location, qty) VALUES (?,?,?) ON CONFLICT(drug, location) DO UPDATE SET qty = excluded.qty');
  for (const [k, qty] of bal) put.run(m.drug, k.split('|').slice(1).join('|'), qty);
  const negative = [...bal].filter(([, q]) => q < 0).map(([k, q]) => ({ drug: m.drug, location: k.split('|').slice(1).join('|'), qty: q }));
  const flag = db.prepare('INSERT INTO discrepancies (movement_id, drug, location, qty_after, created_at) VALUES (?,?,?,?,?)');
  for (const n of negative) flag.run(m.id, n.drug, n.location, n.qty, now());
  return { status: 'applied', variance: variance ?? undefined, negative: negative.length ? negative : undefined };
}

export function rebuildBalances(db) {
  const bal = new Map();
  for (const r of db.prepare('SELECT * FROM movements ORDER BY seq').all()) {
    applyMovement(bal, { drug: r.drug, from: r.from_location, to: r.to_location, qty: r.qty, type: r.type });
  }
  return bal;
}

export function openDiscrepancies(db) {
  return db.prepare(`SELECT x.id, x.movement_id, x.drug, d.perihal, x.location, l.name AS location_name, x.qty_after, b.qty AS qty_now, x.created_at
    FROM discrepancies x JOIN drugs d ON d.no_kod = x.drug JOIN locations l ON l.id = x.location
    LEFT JOIN balances b ON b.drug = x.drug AND b.location = x.location
    WHERE x.resolved_at IS NULL ORDER BY x.id`).all();
}

export function seedExampleLocations(db) {
  if (db.prepare('SELECT COUNT(*) n FROM locations').get().n) return 0;
  const rows = [
    ['main-store', 'EXAMPLE Main Store', 'store', null, 1],
    ['main-store-rack-a', 'EXAMPLE Rack A', 'shelf', 'main-store', 2],
    ['main-store-fridge', 'EXAMPLE Cold Room Fridge', 'shelf', 'main-store', 3],
    ['opd-pharmacy', 'EXAMPLE Outpatient Pharmacy', 'store', null, 4],
    ['ward-medical', 'EXAMPLE Medical Ward', 'ward', null, 5],
    ['ward-psych', 'EXAMPLE Psychiatry Ward', 'ward', null, 6],
    ['ward-onc', 'EXAMPLE Oncology Day Care', 'ward', null, 7],
  ];
  const ins = db.prepare('INSERT INTO locations (id, name, type, parent_id, sort) VALUES (?,?,?,?,?)');
  for (const [id, name, type, parent, sort] of rows) ins.run(id, name, type, parent, sort);
  return rows.length;
}
