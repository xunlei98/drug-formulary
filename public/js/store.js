// App state and all Firestore access except patient identities (see rest.js).
// Reads are budgeted: catalog and par are version-gated into our own IndexedDB, balances start from checkpoints.
import { mainDb } from './idb.js';
import { db } from './fb.js';
import {
  doc, collection, query, where, orderBy, documentId, getDoc, getDocs, getDocFromServer, setDoc, updateDoc, writeBatch,
  onSnapshot, serverTimestamp, increment, Timestamp, FieldPath, waitForPendingWrites,
} from '/vendor/firebase.js';
import { applyMovement, keyOf } from '/shared/ledger.js';
import { cardRows } from '/shared/kad.js';
import { summarize, byUnit } from '/shared/quota.js';
import { indexDrug, search as fuzzy } from '/shared/search.js';
import { can, subtree } from '/shared/perm.js';
import { groupPar, parStatus } from '/shared/par.js';
import { isOldFormularyOnly } from '/shared/druginfo.js';
import { uuid } from './dom.js';

export const CHECKPOINT_EVERY = 100;
const DEFAULT_CONFIG = { offlineDays: 3, idleLockMin: 5, nearPct: 80, wardStockScope: 'own', patientsRealAllowed: false };

export const state = {
  user: null, config: { ...DEFAULT_CONFIG },
  drugs: [], drugMap: new Map(), index: [], mahal: new Map(), locations: [], locMap: new Map(),
  base: new Map(), asOf: null, par: new Map(), movements: [], counts: [], outbox: [], rejected: [],
  syncedAt: null, lastOnlineAt: null, syncing: false, online: navigator.onLine, fromCache: true,
};

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const notify = () => { for (const fn of listeners) fn(); };
export const can_ = (perm) => !!state.user && can(state.user.role, perm);
const isWard = () => state.user?.role === 'ward';

const tsIso = (t) => (t?.toDate ? t.toDate().toISOString() : t || null);
const ref = (path) => doc(db(), path);

/* Auditing. Without Cloud Functions this depends on the client; the rules only make entries create-only and signed. */
export function audit(action, target = null, detail = null) {
  setDoc(doc(collection(db(), 'audit')), {
    uid: state.user.uid, username: state.user.username, action, target, detail: detail == null ? null : String(detail).slice(0, 500), ts: serverTimestamp(),
  }).catch((e) => console.warn('audit not saved:', e.code || e.message));
}

/* Local load */

export async function loadLocal() {
  const [drugs, par, outbox, rejected, versions] = await Promise.all([
    mainDb.all('drugs'), mainDb.all('par'), mainDb.all('outbox'), mainDb.all('rejected'), mainDb.get('meta', 'versions'),
  ]);
  setDrugs(drugs);
  setPar(par);
  state.outbox = outbox.sort((a, b) => a.n - b.n);
  state.rejected = rejected;
  state.versions = versions || { formulary: null, par: {} };
  notify();
}

function setDrugs(drugs) {
  const current = drugs.filter((d) => !isOldFormularyOnly(d));
  state.drugs = current;
  state.drugMap = new Map(current.map((d) => [d.no_kod, d]));
  state.index = current.map(indexDrug);
}
function setPar(docs) {
  state.par = groupPar(docs.flatMap((d) => d.rows.filter((r) => r.drug).map((r) => ({ ...r, location: d.location }))));
}

/* Live data. Each listener costs one read per document on start and one per change. */

let unsubs = [];
export function stopLive() { for (const u of unsubs) u(); unsubs = []; }

export async function startLive(onUserChange) {
  stopLive();
  const watch = (q, fn) => unsubs.push(onSnapshot(q, { includeMetadataChanges: true }, fn, (e) => console.warn('listener:', e.code || e.message)));
  watch(ref(`users/${state.user.uid}`), (s) => onUserChange(s.exists() ? s.data() : null));
  watch(ref('config/app'), (s) => { state.config = { ...DEFAULT_CONFIG, ...(s.data() || {}) }; notify(); });
  watch(ref('catalog/locations'), (s) => {
    state.locations = Object.entries(s.data()?.byId || {}).map(([id, l]) => ({ ...l, id })).sort((a, b) => (a.sort ?? 99) - (b.sort ?? 99) || a.name.localeCompare(b.name));
    state.locMap = new Map(state.locations.map((l) => [l.id, l]));
    notify();
  });
  watch(ref('catalog/mahal'), (s) => {
    state.mahal = new Map(Object.entries(s.data()?.items || {}).map(([k, m]) => [k, { units: [], ...m, no_kod: k }]));
    notify();
  });
  watch(ref('stats/counts'), (s) => {
    state.counts = Object.entries(s.data()?.byKey || {}).map(([k, n]) => { const [no_kod, unit, kategori] = k.split('|'); return { no_kod, unit, kategori, n }; });
    notify();
  });
  watch(ref('meta/catalog'), (s) => { if (!s.metadata.fromCache) syncCatalog(s.data() || {}).catch((e) => console.warn('catalog:', e.message)); });
  await startMovements(watch);
}

// Formulary and par levels are re-read only when the admin bumps their version in meta/catalog.
async function syncCatalog(meta) {
  const v = state.versions;
  if (meta.formulary != null && meta.formulary !== v.formulary) {
    const snap = await getDocs(collection(db(), 'formulary'));
    const drugs = snap.docs.flatMap((d) => d.data().items || []).filter((d) => !isOldFormularyOnly(d));
    await mainDb.replaceAll({ drugs });
    setDrugs(drugs);
    v.formulary = meta.formulary;
  }
  const scope = myScope();
  const wanted = Object.entries(meta.par || {}).filter(([loc]) => !scope || scope.has(loc));
  for (const [loc, ver] of wanted) {
    if (v.par[loc] === ver) continue;
    const s = await getDoc(ref(`par/${loc}`));
    await mainDb.put('par', { location: loc, rows: s.data()?.rows || [] });
    v.par[loc] = ver;
  }
  await mainDb.put('meta', v, 'versions');
  setPar(await mainDb.all('par'));
  state.syncedAt = new Date().toISOString();
  notify();
}

// Balances = latest checkpoint + every movement after it. Wards with own scope only see movements that touch them.
async function startMovements(watch) {
  const own = isWard() && state.config.wardStockScope !== 'all';
  const scope = own ? [...subtree(state.locations, state.user.location_id)] : null;
  const cps = await getDocs(scope ? query(collection(db(), 'checkpoints'), where(documentId(), 'in', scope.slice(0, 30))) : collection(db(), 'checkpoints'))
    .catch(() => ({ docs: [] }));
  const base = new Map();
  let asOf = null;
  for (const d of cps.docs) {
    const c = d.data();
    if (!asOf || c.asOf.toMillis() < asOf.toMillis()) asOf = c.asOf;
    for (const [drug, qty] of Object.entries(c.balances || {})) base.set(keyOf(drug, d.id), qty);
  }
  state.base = base;
  state.asOf = asOf;
  const conds = [where('server_time', '>', asOf || Timestamp.fromMillis(0)), orderBy('server_time')];
  if (own) conds.unshift(where('locs', 'array-contains', state.user.location_id));
  watch(query(collection(db(), 'movements'), ...conds), (snap) => {
    state.fromCache = snap.metadata.fromCache;
    state.movements = snap.docs.filter((d) => !d.metadata.hasPendingWrites)
      .map((d) => ({ ...d.data(), id: d.id, server_time: tsIso(d.data().server_time) }))
      .sort((a, b) => (a.server_time < b.server_time ? 1 : -1));
    const acked = new Set(state.movements.map((m) => m.id));
    const done = state.outbox.filter((o) => o.kind === 'movement' && acked.has(o.id));
    if (done.length) Promise.all(done.map((o) => mainDb.del('outbox', o.n))).then(reloadOutbox);
    if (!snap.metadata.fromCache) { state.lastOnlineAt = Date.now(); saveSession(); maybeCheckpoint(); }
    notify();
  });
}

export async function saveSession() {
  await mainDb.put('meta', { uid: state.user.uid, lastOnlineAt: state.lastOnlineAt }, 'session');
}

// A pharmacist device rolls the ledger into checkpoints so later sign-ins read at most ~CHECKPOINT_EVERY movements.
// asOf is the newest movement older than two minutes, so a write still in flight cannot fall behind the checkpoint.
let checkpointing = false;
async function maybeCheckpoint() {
  if (checkpointing || isWard() || state.movements.length < CHECKPOINT_EVERY * 2) return;
  const cutoff = new Date(Date.now() - 120000).toISOString();
  const older = state.movements.filter((m) => m.server_time <= cutoff).reverse();
  if (older.length < CHECKPOINT_EVERY) return;
  checkpointing = true;
  try {
    const bal = new Map(state.base);
    for (const m of older) applyMovement(bal, m);
    const asOf = Timestamp.fromDate(new Date(older[older.length - 1].server_time));
    const byLoc = Object.fromEntries(state.locations.map((l) => [l.id, {}]));
    for (const [k, qty] of bal) { const [drug, loc] = k.split('|'); if (qty !== 0) (byLoc[loc] ||= {})[drug] = qty; }
    const b = writeBatch(db());
    for (const [loc, balances] of Object.entries(byLoc)) b.set(ref(`checkpoints/${loc}`), { asOf, balances, uid: state.user.uid });
    await b.commit();
  } catch (e) { console.warn('checkpoint skipped:', e.code || e.message); } finally { checkpointing = false; }
}

/* Derived views */

export function pendingFor(user = state.user) {
  return state.outbox.filter((o) => o.uid === user?.uid);
}

function pendingMovements() {
  const seen = new Set(state.movements.map((m) => m.id));
  return pendingFor().filter((o) => o.kind === 'movement' && !seen.has(o.id));
}

export function balances() {
  const map = new Map(state.base);
  for (const m of [...state.movements].reverse()) applyMovement(map, m);
  for (const o of pendingMovements()) applyMovement(map, o.movement);
  const scope = myScope();
  if (scope) for (const k of [...map.keys()]) if (!scope.has(k.split('|')[1])) map.delete(k);
  return map;
}

export function stockFor(noKod) {
  const out = [];
  for (const [k, qty] of balances()) {
    const [drug, location] = k.split('|');
    if (drug === noKod && qty !== 0) out.push({ location, qty, name: state.locMap.get(location)?.name || location });
  }
  return out.sort((a, b) => b.qty - a.qty);
}

// Balance against par for every location that has either. Balances are never filled in from par.
export function parLines({ drug = null, location = null } = {}) {
  const bal = balances();
  const scope = myScope();
  const keys = new Set([...[...state.par.keys()].filter((k) => !scope || scope.has(k.split('|')[1])), ...[...bal.keys()].filter((k) => bal.get(k) !== 0)]);
  const out = [];
  for (const k of keys) {
    const [d, l] = k.split('|');
    if ((drug && d !== drug) || (location && l !== location)) continue;
    const p = state.par.get(k);
    const qty = bal.has(k) ? bal.get(k) : undefined;
    out.push({ drug: d, location: l, qty, par: p?.par || 0, lists: p?.lists || [], status: parStatus(qty, p?.par || 0) });
  }
  return out;
}

export const totalFor = (noKod) => stockFor(noKod).reduce((s, x) => s + x.qty, 0);

// Negative balances are allowed (offline entries arrive late) and listed for a pharmacist to review.
export const negatives = () => [...balances()].filter(([, q]) => q < 0).map(([k, qty]) => { const [drug, location] = k.split('|'); return { key: k, drug, location, qty }; });

export function movementsFor(noKod, limit = 30) {
  const pending = pendingMovements().filter((o) => o.movement.drug === noKod)
    .map((o) => ({ ...o.movement, id: o.id, username: state.user.username, server_time: o.created, pending: true }));
  return [...pending.reverse(), ...state.movements.filter((m) => m.drug === noKod)].slice(0, limit);
}

// One drug's Kad Stok at one location, oldest row first. Opening balance is the checkpoint, so no extra reads.
export function cardFor(drug, loc) {
  const pending = pendingMovements().map((o) => ({ ...o.movement, id: o.id, username: state.user.username, server_time: o.created, pending: true }));
  const ms = [...state.movements].reverse().concat(pending);
  const name = (id) => state.locMap.get(id)?.name || id;
  return { ...cardRows(ms, { drug, loc, opening: state.base.get(keyOf(drug, loc)) || 0, name }), asOf: tsIso(state.asOf) };
}

export function undoneIds() {
  return new Set([...state.movements.map((m) => m.reverses), ...pendingFor().map((o) => o.movement?.reverses)].filter(Boolean));
}

// Quota use comes from stats/counts, so ward staff see it without any access to patient records.
function countedPatients() {
  return state.counts.flatMap((c) => Array.from({ length: Math.max(0, c.n) }, () => ({ no_kod: c.no_kod, unit: c.unit, kategori: c.kategori })));
}

export function quotaSummary(noKod) {
  const m = state.mahal.get(noKod);
  if (!m) return null;
  return { ...summarize(m.quota, countedPatients().filter((p) => p.no_kod === noKod), state.config.nearPct), units: m.units, nota: m.nota, no_kod: noKod };
}

export function unitSummaries(noKod) {
  const m = state.mahal.get(noKod);
  return m ? byUnit(m.units, countedPatients().filter((p) => p.no_kod === noKod), state.config.nearPct) : [];
}

export function allQuotas() {
  const by = new Map();
  for (const p of countedPatients()) (by.get(p.no_kod) || by.set(p.no_kod, []).get(p.no_kod)).push(p);
  return [...state.mahal.values()].map((m) => ({
    drug: state.drugMap.get(m.no_kod), ...summarize(m.quota, by.get(m.no_kod) || [], state.config.nearPct), no_kod: m.no_kod,
  })).filter((q) => q.drug);
}

export function searchDrugs(q, kind = 'all', limit = 50) {
  let rows = q.trim() ? fuzzy(state.index, q, 400) : [...state.drugs].sort((a, b) => a.perihal.localeCompare(b.perihal));
  if (kind === 'mahal') rows = rows.filter((d) => state.mahal.has(d.no_kod));
  else if (kind === 'ubat') rows = rows.filter((d) => d.kategori === 'Ubat');
  else if (kind === 'bukan') rows = rows.filter((d) => d.kategori === 'Bukan Ubat');
  return rows.slice(0, limit);
}

export function locationOptions() {
  return state.locations.filter((l) => !l.disabled).map((l) => ({ ...l, label: pathName(l) }));
}

function pathName(l) {
  const parent = l.parent_id ? state.locMap.get(l.parent_id) : null;
  return parent ? `${parent.name} / ${l.name}` : l.name;
}

export const myScope = () => (isWard() && state.user.location_id && state.config.wardStockScope !== 'all' ? subtree(state.locations, state.user.location_id) : null);

/* Outbox. Our IndexedDB mirror is the durable record; the Firestore SDK queue is only the transport.
   The mirror survives the cache wipe at sign-out, and every write has a client id, so a re-send is idempotent. */

async function reloadOutbox() {
  state.outbox = (await mainDb.all('outbox')).sort((a, b) => a.n - b.n);
  state.rejected = await mainDb.all('rejected');
  notify();
}

const parentOf = (id) => state.locMap.get(id)?.parent_id || null;
const locsOf = (m) => [...new Set([m.from, m.to, parentOf(m.from), parentOf(m.to)].filter(Boolean))];

// Kad Stok fields are written only when set, so the doc stays identical to the old shape otherwise.
const CARD_FIELDS = ['tarikh', 'doc_type', 'doc_no', 'party', 'unit_price'];
const cardFields = (m) => Object.fromEntries(CARD_FIELDS.filter((k) => m[k] != null && m[k] !== '').map((k) => [k, m[k]]));

function movementDoc(o) {
  const m = o.movement;
  return {
    drug: m.drug, type: m.type, from: m.from || null, to: m.to || null, qty: m.qty, note: m.note || '',
    uid: o.uid, username: o.user, device_time: m.device_time, server_time: serverTimestamp(), reverses: m.reverses || null, locs: locsOf(m),
    ...cardFields(m),
  };
}

// Writes one outbox entry. Resolves when the server acknowledges it; offline it stays pending in the SDK queue.
function send(o) {
  if (o.kind === 'movement') {
    if (!o.movement.reverses) return setDoc(ref(`movements/${o.id}`), movementDoc(o));
    const b = writeBatch(db());
    b.set(ref(`movements/${o.id}`), movementDoc(o));
    b.set(ref(`reversals/${o.movement.reverses}`), { by: o.id, uid: o.uid });
    return b.commit();
  }
  return kategoriBatch(o).commit();
}

export const statKey = (kod, unit, kat) => `${kod}|${unit || ''}|${kat}`;

function kategoriBatch(o) {
  const { patient_id, patch, prev } = o;
  const b = writeBatch(db());
  b.update(ref(`patients/${patient_id}`), { kategori: patch.kategori, tarikh_henti: patch.tarikh_henti || null, tarikh_kemaskini: o.created.slice(0, 10), updated_by: o.user });
  b.set(ref(`patient_log/${o.id}`), { patient_id, uid: o.uid, username: o.user, action: 'kategori', from: prev.kategori, to: patch.kategori, detail: null, ts: serverTimestamp() });
  if (prev.kategori !== patch.kategori) {
    b.set(ref('stats/counts'), { byKey: { [statKey(prev.no_kod, prev.unit, prev.kategori)]: increment(-1), [statKey(prev.no_kod, prev.unit, patch.kategori)]: increment(1) } }, { merge: true });
  }
  return b;
}

async function settle(o, promise) {
  try {
    await promise;
    await mainDb.del('outbox', o.n);
  } catch (e) {
    if (e.code !== 'permission-denied' && e.code !== 'invalid-argument' && e.code !== 'not-found') throw e;
    // A create on an id that already exists is refused. That means an earlier send already landed.
    if (await landed(o)) await mainDb.del('outbox', o.n);
    else {
      await mainDb.put('rejected', { id: o.id, kind: o.kind, movement: o.movement, patch: o.patch, reason: refusal(e), created: o.created, user: o.user, uid: o.uid });
      await mainDb.del('outbox', o.n);
    }
  } finally { await reloadOutbox(); }
}

const refusal = (e) => (e.code === 'permission-denied' ? 'Not allowed for your account or location, or the entry is invalid.' : e.message);

async function landed(o) {
  const path = o.kind === 'movement' ? `movements/${o.id}` : `patient_log/${o.id}`;
  try { return (await getDocFromServer(ref(path))).exists(); } catch { return false; }
}

async function enqueue(op) {
  const o = { ...op, uid: state.user.uid, user: state.user.username, created: new Date().toISOString() };
  o.n = await mainDb.put('outbox', o);
  await reloadOutbox();
  const acked = settle(o, send(o));
  acked.catch(() => {});
  return { o, acked };
}

const within = (p, ms) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);

export async function logMovement(movement) {
  const id = uuid();
  const m = { ...movement, note: movement.note || '', device_time: new Date().toISOString() };
  const { acked } = await enqueue({ id, kind: 'movement', movement: m });
  if (!navigator.onLine) return { status: 'queued', id };
  const ok = await within(acked, 5000).catch(() => false);
  const rej = state.rejected.find((r) => r.id === id);
  if (rej) return { status: 'rejected', reason: rej.reason };
  return { status: ok ? 'applied' : 'queued', id };
}

export async function changeKategori(patientId, patch, prev) {
  const id = uuid();
  const { acked } = await enqueue({ id, kind: 'patient_update', patient_id: patientId, patch, prev });
  if (!navigator.onLine) return { status: 'queued', id };
  const ok = await within(acked, 5000).catch(() => false);
  const rej = state.rejected.find((r) => r.id === id);
  if (rej) return { status: 'rejected', reason: rej.reason };
  return { status: ok ? 'applied' : 'queued', id };
}

// Flushes the SDK queue, then checks every mirrored entry against the server and re-sends what is missing.
export async function syncNow() {
  if (state.syncing || !state.user || !navigator.onLine) return;
  state.syncing = true;
  notify();
  try {
    await within(waitForPendingWrites(db()), 15000);
    for (const o of pendingFor()) {
      if (await landed(o)) await mainDb.del('outbox', o.n);
      else await settle(o, send(o)).catch((e) => console.warn('sync:', e.code || e.message));
    }
    state.syncedAt = new Date().toISOString();
  } catch (e) {
    console.warn('sync failed:', e.code || e.message);
  } finally {
    state.syncing = false;
    await reloadOutbox();
  }
}

let timer = null;
export function syncSoon() {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, 300);
}

export async function dismissRejected(id) {
  await mainDb.del('rejected', id);
  await reloadOutbox();
}

export function syncStatus() {
  const pending = pendingFor().length;
  const attention = state.rejected.filter((r) => r.uid === state.user?.uid).length;
  if (attention) return { kind: 'attention', n: attention, label: `${attention} need attention` };
  if (!state.online) return { kind: 'offline', n: pending, label: pending ? `Offline, ${pending} pending` : 'Offline' };
  if (state.syncing) return { kind: 'syncing', label: 'Syncing' };
  if (pending) return { kind: 'pending', n: pending, label: `${pending} pending` };
  return { kind: 'synced', label: 'Synced' };
}

// Pending writes of this user must reach the server before sign-out wipes the SDK queue. Waits at most 5 s.
export async function flushBeforeSignOut() {
  if (!navigator.onLine || !pendingFor().length) return;
  await within(waitForPendingWrites(db()), 5000);
  await syncNow();
}

export async function refresh() {
  const s = await getDoc(ref('meta/catalog'));
  await syncCatalog(s.data() || {});
}

export function startNetworkWatch() {
  const set = () => { state.online = navigator.onLine; notify(); if (state.online) syncSoon(); };
  addEventListener('online', set);
  addEventListener('offline', set);
  setInterval(() => { if (navigator.onLine && pendingFor().length) syncSoon(); }, 30000);
}

/* Quota edits and reviews */

export async function saveQuota(kod, quota, nota) {
  const q = quota === '' || quota == null ? null : Number(quota);
  if (q !== null && (!Number.isInteger(q) || q < 0)) throw new Error('Kuota must be a whole number, 0 or more, or empty');
  const m = state.mahal.get(kod);
  const { no_kod, ...rest } = m;
  await updateDoc(ref('catalog/mahal'), new FieldPath('items', kod), { ...rest, quota: q, nota: String(nota || '').slice(0, 300) }, 'updated', serverTimestamp());
  audit('quota.edit', kod, `quota ${m.quota ?? '-'} -> ${q ?? '-'}`);
}

export async function loadReviews() {
  const snap = await getDocs(collection(db(), 'reviews'));
  return new Map(snap.docs.map((d) => [d.id, d.data()]));
}

export async function markReviewed(n, note) {
  await setDoc(ref(`reviews/${n.key}`), { drug: n.drug, location: n.location, qty: n.qty, note: String(note || '').slice(0, 300), uid: state.user.uid, username: state.user.username, at: serverTimestamp() });
}
