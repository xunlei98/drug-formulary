import { mainDb, patientDb } from './idb.js';
import { get, post, ApiError } from './api.js';
import { applyMovement, keyOf } from '/shared/ledger.js';
import { summarize, byUnit } from '/shared/quota.js';
import { indexDrug, search as fuzzy } from '/shared/search.js';
import { can, subtree } from '/shared/perm.js';
import { uuid } from './dom.js';

export const state = {
  user: null, config: { offlineDays: 3, offlinePatients: 'minimal', idleLockMin: 5, nearPct: 80 },
  drugs: [], drugMap: new Map(), index: [], mahal: new Map(), locations: [], locMap: new Map(),
  base: new Map(), movements: [], counts: [], patients: [], outbox: [], rejected: [],
  syncedAt: null, lastOnlineAt: null, syncing: false, online: navigator.onLine,
};

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const notify = () => { for (const fn of listeners) fn(); };

export const can_ = (perm) => !!state.user && can(state.user.role, perm);

async function loadMain() {
  const [drugs, mahal, locations, balances, movements, outbox, rejected, meta] = await Promise.all(
    ['drugs', 'mahal', 'locations', 'balances', 'movements', 'outbox', 'rejected'].map((s) => mainDb.all(s)).concat(mainDb.get('meta', 'snapshot')),
  );
  state.drugs = drugs;
  state.drugMap = new Map(drugs.map((d) => [d.no_kod, d]));
  state.index = drugs.map(indexDrug);
  state.mahal = new Map(mahal.map((m) => [m.no_kod, m]));
  state.locations = locations;
  state.locMap = new Map(locations.map((l) => [l.id, l]));
  state.base = new Map(balances.map((b) => [b.key, b.qty]));
  state.movements = movements.sort((a, b) => (a.server_time < b.server_time ? 1 : -1));
  state.outbox = outbox.sort((a, b) => a.n - b.n);
  state.rejected = rejected;
  state.counts = meta?.counts || [];
  state.syncedAt = meta?.serverTime || null;
}

export async function loadPatients() {
  state.patients = await patientDb.all('patients');
}

export async function loadLocal() {
  await loadMain();
  await loadPatients();
  notify();
}

export async function refresh() {
  const snap = await get('/api/snapshot');
  await mainDb.replaceAll({
    drugs: snap.drugs, mahal: snap.mahal, locations: snap.locations,
    balances: snap.balances.map((b) => ({ key: keyOf(b.drug, b.location), qty: b.qty })),
    movements: snap.movements,
  });
  await mainDb.put('meta', { serverTime: snap.serverTime, counts: snap.counts }, 'snapshot');
  state.config = snap.config;
  await mainDb.put('meta', snap.config, 'config');
  if (snap.patients) await patientDb.replaceAll({ patients: snap.patients });
  else await patientDb.destroy();
  await loadMain();
  await loadPatients();
  state.lastOnlineAt = Date.now();
  await mainDb.put('meta', { user: state.user, lastOnlineAt: state.lastOnlineAt }, 'session');
  notify();
}

export async function wipePatients() {
  state.patients = [];
  await patientDb.destroy();
  notify();
}

export function pendingFor(user = state.user) {
  return state.outbox.filter((o) => o.user === user?.username);
}

export function balances() {
  const map = new Map(state.base);
  for (const o of pendingFor()) if (o.kind === 'movement') applyMovement(map, { ...o.movement, drug: o.movement.drug });
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

export function totalFor(noKod) {
  return stockFor(noKod).reduce((s, x) => s + x.qty, 0);
}

export function movementsFor(noKod, limit = 30) {
  const pending = pendingFor().filter((o) => o.kind === 'movement' && o.movement.drug === noKod)
    .map((o) => ({ ...o.movement, id: o.id, username: state.user.username, server_time: o.created, pending: true }));
  const server = state.movements.filter((m) => m.drug === noKod);
  return [...pending.reverse(), ...server].slice(0, limit);
}

export function undoneIds() {
  return new Set([...state.movements.map((m) => m.reverses), ...pendingFor().map((o) => o.movement?.reverses)].filter(Boolean));
}

function effectivePatients() {
  if (!state.patients.length) {
    return state.counts.flatMap((c) => Array.from({ length: c.n }, () => ({ no_kod: c.no_kod, unit: c.unit, kategori: c.kategori })));
  }
  const patch = new Map();
  for (const o of pendingFor()) if (o.kind === 'patient_update' && o.patch.kategori) patch.set(o.patient_id, o.patch.kategori);
  return state.patients.map((p) => (patch.has(p.id) ? { ...p, kategori: patch.get(p.id) } : p));
}

export function quotaSummary(noKod) {
  const m = state.mahal.get(noKod);
  if (!m) return null;
  return { ...summarize(m.quota, effectivePatients().filter((p) => p.no_kod === noKod), state.config.nearPct), units: m.units, nota: m.nota, no_kod: noKod };
}

export function unitSummaries(noKod) {
  const m = state.mahal.get(noKod);
  return m ? byUnit(m.units, effectivePatients().filter((p) => p.no_kod === noKod), state.config.nearPct) : [];
}

export function allQuotas() {
  const ps = effectivePatients();
  const by = new Map();
  for (const p of ps) (by.get(p.no_kod) || by.set(p.no_kod, []).get(p.no_kod)).push(p);
  return [...state.mahal.values()].map((m) => ({
    drug: state.drugMap.get(m.no_kod), ...summarize(m.quota, by.get(m.no_kod) || [], state.config.nearPct), no_kod: m.no_kod,
  })).filter((q) => q.drug);
}

export function searchDrugs(q, kind = 'all', limit = 50) {
  let rows = q.trim() ? fuzzy(state.index, q, 400) : state.drugs.slice(0, 400);
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

export const myScope = () => (state.user?.role === 'ward' && state.user.location_id ? subtree(state.locations, state.user.location_id) : null);

/* Outbox and sync */

export async function enqueue(op) {
  const row = { ...op, user: state.user.username, created: new Date().toISOString() };
  await mainDb.put('outbox', row);
  state.outbox = (await mainDb.all('outbox')).sort((a, b) => a.n - b.n);
  notify();
  syncSoon();
}

let timer = null;
export function syncSoon() {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, 150);
}

export async function syncNow() {
  if (state.syncing || !state.user || !navigator.onLine) return;
  state.syncing = true;
  notify();
  try {
    for (;;) {
      const batch = pendingFor().slice(0, 100);
      if (!batch.length) break;
      const { results } = await post('/api/sync', {
        mode: 'replay',
        ops: batch.map(({ id, kind, movement, patient_id, patch }) => ({ id, kind, movement, patient_id, patch })),
      });
      for (const r of results) {
        const item = batch.find((b) => b.id === r.id);
        if (!item) continue;
        if (r.status === 'rejected') await mainDb.put('rejected', { id: item.id, kind: item.kind, movement: item.movement, patch: item.patch, reason: r.reason, created: item.created, user: item.user });
        await mainDb.del('outbox', item.n);
      }
      state.outbox = (await mainDb.all('outbox')).sort((a, b) => a.n - b.n);
      state.rejected = await mainDb.all('rejected');
    }
    await refresh();
  } catch (e) {
    if (!(e instanceof ApiError && e.offline)) console.warn('sync failed:', e.message);
  } finally {
    state.syncing = false;
    notify();
  }
}

export async function dismissRejected(id) {
  await mainDb.del('rejected', id);
  state.rejected = await mainDb.all('rejected');
  notify();
}

export function syncStatus() {
  const pending = pendingFor().length;
  const attention = state.rejected.filter((r) => r.user === state.user?.username).length;
  if (attention) return { kind: 'attention', n: attention, label: `${attention} need attention` };
  if (!state.online) return { kind: 'offline', n: pending, label: pending ? `Offline, ${pending} pending` : 'Offline' };
  if (state.syncing) return { kind: 'syncing', label: 'Syncing' };
  if (pending) return { kind: 'pending', n: pending, label: `${pending} pending` };
  return { kind: 'synced', label: 'Synced' };
}

export async function submitOps(ops, mode) {
  return (await post('/api/sync', { mode, ops })).results;
}

export async function logMovement(movement) {
  const id = uuid();
  const m = { ...movement, device_time: new Date().toISOString() };
  const canLive = navigator.onLine && !pendingFor().length;
  if (canLive) {
    try {
      const [r] = await submitOps([{ id, kind: 'movement', movement: m }], 'live');
      if (r.status === 'applied') { refresh().catch(() => {}); return { status: 'applied', id }; }
      return { status: 'rejected', reason: r.reason };
    } catch (e) {
      if (!(e instanceof ApiError && e.offline)) throw e;
    }
  }
  await enqueue({ id, kind: 'movement', movement: m });
  return { status: 'queued', id };
}

export async function changeKategori(patientId, patch) {
  const id = uuid();
  if (navigator.onLine && !pendingFor().length) {
    try {
      const [r] = await submitOps([{ id, kind: 'patient_update', patient_id: patientId, patch }], 'live');
      if (r.status === 'applied') { refresh().catch(() => {}); return r; }
      return r;
    } catch (e) {
      if (!(e instanceof ApiError && e.offline)) throw e;
    }
  }
  await enqueue({ id, kind: 'patient_update', patient_id: patientId, patch });
  return { status: 'queued', id };
}

export function startNetworkWatch() {
  const set = () => { state.online = navigator.onLine; notify(); if (state.online) syncSoon(); };
  addEventListener('online', set);
  addEventListener('offline', set);
  setInterval(() => { if (navigator.onLine) syncSoon(); }, 30000);
}
