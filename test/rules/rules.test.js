// Security rules tests. Run with `npm run test:rules` (starts the Firestore emulator).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, writeBatch, serverTimestamp, Timestamp, deleteField } from 'firebase/firestore';

let env;
const PROJECT = 'demo-limbang-rules';

const USERS = {
  admin: { username: 'admin', email: 'admin@x.test', name: 'Admin', role: 'admin', location: null, disabled: false, must_change: false },
  pharm: { username: 'pharm', email: 'pharm@x.test', name: 'Pharm', role: 'pharmacist', location: null, disabled: false, must_change: false },
  ward: { username: 'ward', email: 'ward@x.test', name: 'Ward', role: 'ward', location: 'male-ward', disabled: false, must_change: true },
  ward2: { username: 'ward2', email: 'ward2@x.test', name: 'Ward 2', role: 'ward', location: 'female-ward', disabled: false, must_change: false },
  gone: { username: 'gone', email: 'gone@x.test', name: 'Gone', role: 'pharmacist', location: null, disabled: true, must_change: false },
};
const LOCS = {
  'main-store': { id: 'main-store', name: 'Main Store', type: 'store', parent_id: null, disabled: false },
  'male-ward': { id: 'male-ward', name: 'Male Ward', type: 'ward', parent_id: null, disabled: false },
  'male-fridge': { id: 'male-fridge', name: 'Fridge', type: 'shelf', parent_id: 'male-ward', disabled: false },
  'female-ward': { id: 'female-ward', name: 'Female Ward', type: 'ward', parent_id: null, disabled: false },
};

const as = (who) => env.authenticatedContext(who).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const mv = (who, over = {}) => ({
  drug: 'D1', type: 'transfer', from: 'main-store', to: 'male-ward', qty: 5, note: '', uid: who, username: USERS[who].username,
  device_time: new Date().toISOString(), server_time: serverTimestamp(), reverses: null, locs: ['main-store', 'male-ward'], ...over,
});
const demo = { no_kod: 'M1', nama: 'DEMO PATIENT 001', ic: '000000-00-0001', dos: '', kuantiti_setahun: null, nota: '', key_id: 'DEMO-001' };
const minimal = { no_kod: 'M1', initials: 'DP0', ic4: '0001', kategori: 'Active', unit: 'Medical', preskriber: '', tarikh_mula: null, tarikh_henti: null, tarikh_kemaskini: null };

before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, u] of Object.entries(USERS)) await setDoc(doc(db, 'users', uid), u);
    await setDoc(doc(db, 'config/app'), { wardStockScope: 'own', patientsRealAllowed: false, nearPct: 80 });
    await setDoc(doc(db, 'catalog/locations'), { byId: LOCS });
    await setDoc(doc(db, 'catalog/mahal'), { items: { M1: { quota: 5, nota: '', units: [] } } });
    await setDoc(doc(db, 'formulary/c0'), { items: [{ no_kod: 'D1', perihal: 'Drug one' }] });
    await setDoc(doc(db, 'movements/old1'), { ...mv('pharm'), server_time: Timestamp.now() });
    await setDoc(doc(db, 'movements/old2'), { ...mv('pharm', { from: 'main-store', to: 'female-ward', locs: ['main-store', 'female-ward'] }), server_time: Timestamp.now() });
    await setDoc(doc(db, 'patients/p1'), minimal);
    await setDoc(doc(db, 'patient_identity/p1'), demo);
  });
});

test('signed-out and disabled users get nothing', async () => {
  for (const db of [anon(), as('gone')]) {
    await assertFails(getDoc(doc(db, 'formulary/c0')));
    await assertFails(getDoc(doc(db, 'catalog/locations')));
    await assertFails(getDoc(doc(db, 'movements/old1')));
    await assertFails(getDoc(doc(db, 'patients/p1')));
    await assertFails(setDoc(doc(db, 'movements/m-new-0001'), mv('gone')));
  }
  await assertSucceeds(getDoc(doc(as('gone'), 'users/gone')));
});

test('every role reads the formulary, locations and config', async () => {
  for (const who of ['admin', 'pharm', 'ward']) {
    await assertSucceeds(getDoc(doc(as(who), 'formulary/c0')));
    await assertSucceeds(getDoc(doc(as(who), 'catalog/locations')));
    await assertSucceeds(getDoc(doc(as(who), 'config/app')));
  }
});

test('ward cannot read patients or identities', async () => {
  const db = as('ward');
  await assertFails(getDoc(doc(db, 'patients/p1')));
  await assertFails(getDocs(collection(db, 'patients')));
  await assertFails(getDoc(doc(db, 'patient_identity/p1')));
  await assertFails(setDoc(doc(db, 'patients/p2'), minimal));
  for (const who of ['pharm', 'admin']) {
    await assertSucceeds(getDoc(doc(as(who), 'patients/p1')));
    await assertSucceeds(getDoc(doc(as(who), 'patient_identity/p1')));
  }
});

test('ward logs movements only for its own location', async () => {
  const db = as('ward');
  await assertSucceeds(setDoc(doc(db, 'movements/m-ward-0001'), mv('ward')));
  await assertSucceeds(setDoc(doc(db, 'movements/m-ward-0002'), mv('ward', { type: 'issue', from: 'male-fridge', to: null, locs: ['male-fridge', 'male-ward'] })));
  await assertFails(setDoc(doc(db, 'movements/m-ward-0003'), mv('ward', { to: 'female-ward', locs: ['main-store', 'female-ward'] })));
  // Padding locs with its own ward does not help.
  await assertFails(setDoc(doc(db, 'movements/m-ward-0004'), mv('ward', { to: 'female-ward', locs: ['main-store', 'female-ward', 'male-ward'] })));
  // Shelf movement must list the parent too.
  await assertFails(setDoc(doc(db, 'movements/m-ward-0005'), mv('ward', { type: 'issue', from: 'male-fridge', to: null, locs: ['male-fridge'] })));
});

test('ward reads only movements that touch its location', async () => {
  const db = as('ward');
  await assertSucceeds(getDoc(doc(db, 'movements/old1')));
  await assertFails(getDoc(doc(db, 'movements/old2')));
  await assertSucceeds(getDocs(query(collection(db, 'movements'), where('locs', 'array-contains', 'male-ward'))));
  await assertFails(getDocs(collection(db, 'movements')));
  await assertSucceeds(getDocs(collection(as('pharm'), 'movements')));
});

test('ward stock scope "all" lets wards read every movement', async () => {
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'config/app'), { wardStockScope: 'all' }));
  await assertSucceeds(getDocs(collection(as('ward'), 'movements')));
});

test('movements are create-only and validated', async () => {
  const db = as('pharm');
  await assertSucceeds(setDoc(doc(db, 'movements/m-ph-0001'), mv('pharm')));
  await assertFails(setDoc(doc(db, 'movements/m-ph-0001'), mv('pharm', { qty: 9 })));
  await assertFails(updateDoc(doc(db, 'movements/old1'), { qty: 1 }));
  await assertFails(deleteDoc(doc(db, 'movements/old1')));
  await assertFails(deleteDoc(doc(as('admin'), 'movements/old1')));
  await assertFails(setDoc(doc(db, 'movements/m-ph-0002'), mv('pharm', { uid: 'ward' })));
  await assertFails(setDoc(doc(db, 'movements/m-ph-0003'), mv('pharm', { server_time: Timestamp.fromDate(new Date('2020-01-01')) })));
  await assertFails(setDoc(doc(db, 'movements/m-ph-0004'), mv('pharm', { qty: 0 })));
  await assertFails(setDoc(doc(db, 'movements/m-ph-0005'), mv('pharm', { qty: 1.5 })));
  await assertFails(setDoc(doc(db, 'movements/m-ph-0006'), mv('pharm', { to: 'nowhere', locs: ['main-store', 'nowhere'] })));
  await assertFails(setDoc(doc(db, 'movements/m-ph-0007'), mv('pharm', { type: 'receive' })));
  await assertSucceeds(setDoc(doc(db, 'movements/m-ph-0008'), mv('pharm', { type: 'stocktake', from: null, qty: 0, locs: ['male-ward'] })));
  await assertFails(setDoc(doc(db, 'movements/m-ph-0009'), { ...mv('pharm'), extra: 1 }));
});

test('Kad Stok fields are optional and type-checked; old-shape movements still pass', async () => {
  const db = as('pharm');
  const card = { tarikh: '2026-10-29', doc_type: 'BPSI', doc_no: 'S-123', party: 'Pharmaniaga', unit_price: 1.25 };
  await assertSucceeds(setDoc(doc(db, 'movements/m-kad-0001'), mv('pharm', card)));
  await assertSucceeds(setDoc(doc(db, 'movements/m-kad-0002'), mv('pharm', { type: 'receive', from: null, locs: ['male-ward'], doc_type: 'PK', unit_price: 2 })));
  await assertSucceeds(setDoc(doc(as('ward'), 'movements/m-kad-0003'), mv('ward', { doc_type: 'LAIN', party: null })));
  await assertSucceeds(setDoc(doc(db, 'movements/m-kad-0004'), mv('pharm')), 'old shape, no card fields');
  for (const [i, bad] of [{ tarikh: '29/10/2026' }, { doc_type: 'XX' }, { doc_no: 'x'.repeat(41) }, { party: 'x'.repeat(121) },
    { unit_price: -1 }, { unit_price: '1.20' }, { unit_price: 2000000 }, { doc_no: 5 }, { surprise: 1 }].entries()) {
    await assertFails(setDoc(doc(db, `movements/m-kad-bad-${i}`), mv('pharm', bad)));
  }
});

test('an undo must be the exact inverse, written with its marker, and only once', async () => {
  const db = as('ward');
  const undo = mv('ward', { from: 'male-ward', to: 'main-store', reverses: 'old1', locs: ['male-ward', 'main-store'] });
  const b0 = writeBatch(db);
  b0.set(doc(db, 'movements/m-undo-0000'), undo);
  await assertFails(b0.commit()); // marker missing
  const bad = writeBatch(db);
  bad.set(doc(db, 'movements/m-undo-0001'), { ...undo, qty: 4 });
  bad.set(doc(db, 'reversals/old1'), { by: 'm-undo-0001', uid: 'ward' });
  await assertFails(bad.commit());
  const ok = writeBatch(db);
  ok.set(doc(db, 'movements/m-undo-0002'), undo);
  ok.set(doc(db, 'reversals/old1'), { by: 'm-undo-0002', uid: 'ward' });
  await assertSucceeds(ok.commit());
  const ph = as('pharm');
  const again = writeBatch(ph);
  again.set(doc(ph, 'movements/m-undo-0003'), mv('pharm', { from: 'male-ward', to: 'main-store', reverses: 'old1', locs: ['male-ward', 'main-store'] }));
  again.set(doc(ph, 'reversals/old1'), { by: 'm-undo-0003', uid: 'pharm' });
  await assertFails(again.commit());
});

test('only admins write users, locations, formulary, par and meta; nobody writes config', async () => {
  for (const who of ['pharm', 'ward']) {
    const db = as(who);
    await assertFails(setDoc(doc(db, 'users/new1'), { ...USERS.ward, username: 'x' }));
    await assertFails(updateDoc(doc(db, 'users/ward2'), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'catalog/locations'), { 'byId.x': { id: 'x' } }));
    await assertFails(setDoc(doc(db, 'formulary/c0'), { items: [] }));
    await assertFails(setDoc(doc(db, 'par/male-ward'), { rows: [] }));
    await assertFails(setDoc(doc(db, 'meta/catalog'), { version: 2 }));
  }
  const db = as('admin');
  await assertSucceeds(setDoc(doc(db, 'users/new1'), { ...USERS.ward, username: 'new1' }));
  await assertFails(setDoc(doc(db, 'users/new2'), { ...USERS.ward, role: 'superuser' }));
  await assertSucceeds(updateDoc(doc(db, 'catalog/locations'), { 'byId.x': { id: 'x', name: 'X', type: 'shelf', parent_id: 'main-store', disabled: false } }));
  await assertSucceeds(setDoc(doc(db, 'par/male-ward'), { rows: [] }));
  await assertFails(setDoc(doc(db, 'config/app'), { patientsRealAllowed: true }));
  await assertFails(deleteDoc(doc(db, 'users/ward2')));
});

test('an admin cannot change their own role or disable themselves, so one admin always remains', async () => {
  const db = as('admin');
  await assertFails(updateDoc(doc(db, 'users/admin'), { role: 'pharmacist' }));
  await assertFails(updateDoc(doc(db, 'users/admin'), { disabled: true }));
  await assertFails(updateDoc(doc(db, 'users/admin'), { role: deleteField() }));
  await assertSucceeds(updateDoc(doc(db, 'users/admin'), { name: 'Admin One' }));
  await assertSucceeds(updateDoc(doc(db, 'users/pharm'), { role: 'admin' }));
  await assertSucceeds(updateDoc(doc(as('pharm'), 'users/admin'), { role: 'pharmacist' }));
});

test('a location is deleted only if unused: one at a time, named, no par list and no checkpoint', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'par/male-ward'), { rows: [] });
    await setDoc(doc(ctx.firestore(), 'checkpoints/main-store'), { asOf: Timestamp.now(), balances: { D1: 3 }, uid: 'pharm' });
  });
  const del = (db, id, named = id) => updateDoc(doc(db, 'catalog/locations'), { [`byId.${id}`]: deleteField(), deleted_last: named });
  await assertFails(del(as('pharm'), 'female-ward'));
  await assertFails(del(as('admin'), 'female-ward', 'male-fridge'));
  await assertFails(updateDoc(doc(as('admin'), 'catalog/locations'), { 'byId.female-ward': deleteField(), 'byId.male-fridge': deleteField(), deleted_last: 'female-ward' }));
  await assertFails(del(as('admin'), 'male-ward'));
  await assertFails(del(as('admin'), 'main-store'));
  await assertFails(deleteDoc(doc(as('admin'), 'catalog/locations')));
  // female-ward has movements, but rules cannot query them: the app checks movements before it offers Delete.
  await assertSucceeds(del(as('admin'), 'female-ward'));
  await assertSucceeds(updateDoc(doc(as('admin'), 'catalog/locations'), { 'byId.male-ward.disabled': true }));
});

test('delete = disable and drop the role; the user then gets nothing', async () => {
  await assertSucceeds(updateDoc(doc(as('admin'), 'users/ward2'), { disabled: true, role: deleteField() }));
  await assertFails(getDoc(doc(as('ward2'), 'formulary/c0')));
});

test('users read only their own doc and may only clear must_change', async () => {
  const db = as('ward');
  await assertSucceeds(getDoc(doc(db, 'users/ward')));
  await assertFails(getDoc(doc(db, 'users/pharm')));
  await assertFails(getDocs(collection(db, 'users')));
  await assertSucceeds(getDocs(collection(as('admin'), 'users')));
  await assertFails(updateDoc(doc(db, 'users/ward'), { role: 'admin' }));
  await assertFails(updateDoc(doc(db, 'users/ward'), { location: 'female-ward' }));
  await assertSucceeds(updateDoc(doc(db, 'users/ward'), { must_change: false, last_login: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'users/ward'), { must_change: true }));
});

test('pharmacists edit quotas only inside the mahal doc', async () => {
  await assertSucceeds(updateDoc(doc(as('pharm'), 'catalog/mahal'), { 'items.M1': { quota: 7, nota: '', units: [] }, updated: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('pharm'), 'catalog/mahal'), { other: 1 }));
  await assertFails(updateDoc(doc(as('ward'), 'catalog/mahal'), { 'items.M1': { quota: 9 } }));
});

test('patient identities accept demo data only unless the console flag allows real data', async () => {
  const db = as('pharm');
  await assertSucceeds(setDoc(doc(db, 'patient_identity/p2'), { ...demo, nama: 'DEMO PATIENT 002', ic: '000000-00-0002' }));
  await assertFails(setDoc(doc(db, 'patient_identity/p3'), { ...demo, nama: 'Real Person' }));
  await assertFails(setDoc(doc(db, 'patient_identity/p4'), { ...demo, ic: '900101-13-1234' }));
  await assertFails(setDoc(doc(as('admin'), 'patient_identity/p5'), { ...demo, nama: 'Real Person' }));
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'config/app'), { patientsRealAllowed: true }));
  await assertSucceeds(setDoc(doc(db, 'patient_identity/p6'), { ...demo, nama: 'Allowed Later' }));
});

test('patient kategori changes follow the allowed moves', async () => {
  const db = as('pharm');
  await assertSucceeds(updateDoc(doc(db, 'patients/p1'), { kategori: 'Active - Pesara' }));
  await assertFails(updateDoc(doc(db, 'patients/p1'), { kategori: 'Waiting List' }));
  await assertFails(updateDoc(doc(db, 'patients/p1'), { kategori: 'Off' })); // needs a stop date
  await assertSucceeds(updateDoc(doc(db, 'patients/p1'), { kategori: 'Off', tarikh_henti: '2026-10-29' }));
  await assertFails(setDoc(doc(db, 'patients/p9'), { ...minimal, no_kod: 'NOT-MAHAL' }));
  await assertFails(setDoc(doc(db, 'patients/p9'), { ...minimal, nama: 'Full Name' }));
  await assertFails(deleteDoc(doc(db, 'patients/p1')));
});

test('audit and patient log entries are create-only', async () => {
  for (const who of ['ward', 'pharm']) {
    await assertSucceeds(setDoc(doc(as(who), `audit/a-${who}`), { uid: who, username: who, action: 'x', target: null, detail: null, ts: serverTimestamp() }));
  }
  await assertFails(setDoc(doc(as('pharm'), 'audit/a-fake'), { uid: 'admin', username: 'admin', action: 'x', target: null, detail: null, ts: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('admin'), 'audit/a-pharm'), { action: 'y' }));
  await assertFails(deleteDoc(doc(as('admin'), 'audit/a-pharm')));
  await assertFails(getDoc(doc(as('pharm'), 'audit/a-pharm')));
  await assertSucceeds(getDoc(doc(as('admin'), 'audit/a-pharm')));
  const entry = { patient_id: 'p1', uid: 'pharm', username: 'pharm', action: 'kategori', from: 'Active', to: 'Off', detail: null, ts: serverTimestamp() };
  await assertSucceeds(setDoc(doc(as('pharm'), 'patient_log/l1'), entry));
  await assertFails(updateDoc(doc(as('pharm'), 'patient_log/l1'), { to: 'Active' }));
  await assertFails(setDoc(doc(as('ward'), 'patient_log/l2'), { ...entry, uid: 'ward' }));
});

test('checkpoints only move forward and only pharmacists write them', async () => {
  const t1 = Timestamp.fromMillis(Date.now() - 60000);
  await assertSucceeds(setDoc(doc(as('pharm'), 'checkpoints/main-store'), { asOf: t1, balances: { D1: 3 }, uid: 'pharm' }));
  await assertFails(setDoc(doc(as('pharm'), 'checkpoints/main-store'), { asOf: Timestamp.fromMillis(t1.toMillis() - 1000), balances: {}, uid: 'pharm' }));
  await assertFails(setDoc(doc(as('pharm'), 'checkpoints/male-ward'), { asOf: Timestamp.fromMillis(Date.now() + 3600000), balances: {}, uid: 'pharm' }));
  await assertFails(setDoc(doc(as('ward'), 'checkpoints/male-ward'), { asOf: t1, balances: {}, uid: 'ward' }));
  await assertSucceeds(getDoc(doc(as('ward'), 'checkpoints/main-store')));
});

test('reviews of negative balances are pharmacist-only', async () => {
  const r = { drug: 'D1', location: 'male-ward', qty: -3, note: 'recounted', at: serverTimestamp() };
  await assertSucceeds(setDoc(doc(as('pharm'), 'reviews/D1|male-ward'), { ...r, uid: 'pharm', username: 'pharm' }));
  await assertFails(setDoc(doc(as('ward'), 'reviews/D1|male-ward'), { ...r, uid: 'ward', username: 'ward' }));
  assert.ok(true);
});
