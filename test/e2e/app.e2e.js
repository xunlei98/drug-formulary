// End-to-end tests in headless Chrome against the Auth and Firestore emulators.
// Run with `npm run test:e2e` (firebase emulators:exec sets FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST).
// All data here is synthetic: Demo drugs and DEMO PATIENT rows only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { startStatic } from '../../scripts/serve-local.js';
import { importMaster, importItemMahal, chunkDrugs, defaultLocations, demoPatients } from '../../public/shared/importers.js';
import { parseInfoSheet, matchInfo, mergeInfo } from '../../public/shared/druginfo.js';

const PROJECT = 'demo-limbang-formulary';
const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const PW = `e2e-${crypto.randomUUID()}`;
const PORT = 5056;
const BASE = `http://127.0.0.1:${PORT}`;
let server, browser, db, auth;

const MASTER = `Kategori,Kod PhIS,No Kod,Perihal Stok,Brand,Jenis Perolehan Stok,Kumpulan,PKU,SKU
Ubat,P1,D1,Demo Drug One 10mg Tablet,Demobrand,LP,Tablet,pack,tab
Ubat,P2,D2,Demo Drug Two,,LP,Tablet,pack,tab`;

const INFO = `Item,Brand,Form,Prescriber Category,Pharmacologic Category,Indications,Dosage,PhIS Code,Item Code,Procurement,Price Per Pack (RM)
Demo Drug One 10 mg Tablet,Demobrand,Tablet / Capsule,A*,Demo class,"Demo indication line one
Demo indication line two",10 mg OD,P1,D1,APPL,12.5`;

async function addUser(username, role, location = null) {
  const email = `${username}@staff.formulary.local`;
  const u = await auth.createUser({ email, password: PW });
  await db.doc(`users/${u.uid}`).set({ username, email, name: username, role, location, disabled: false, must_change: false, last_login: null, created: FieldValue.serverTimestamp() });
}

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, 'run through npm run test:e2e');
  assert.ok(CHROME, 'Set CHROME_PATH to a Chrome or Chromium binary');
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  process.env.GOOGLE_CLOUD_PROJECT = PROJECT;
  const app = initializeApp({ projectId: PROJECT });
  db = getFirestore(app);
  auth = getAuth(app);

  const info = parseInfoSheet(INFO);
  const { drugs } = mergeInfo(importMaster(MASTER).drugs, matchInfo(info, importMaster(MASTER).drugs));
  const { mahal } = importItemMahal('ID,No Kod,Kuota,Tarikh Kemaskini,Nota\nr1,D1,6,04/08/2022', { drugs });
  const b = db.batch();
  chunkDrugs(drugs).forEach((items, i) => b.set(db.doc(`formulary/c00${i}`), { items }));
  b.set(db.doc('catalog/locations'), { byId: defaultLocations() });
  b.set(db.doc('catalog/mahal'), { items: Object.fromEntries(mahal) });
  b.set(db.doc('par/etd'), { rows: [{ list: 'floor', item_name: 'Demo Drug Two', sku_unit: 'tab', max_qty: 20, note: null, drug: 'D2', match: 'exact', score: 1 }] });
  b.set(db.doc('meta/catalog'), { formulary: 1, par: { etd: 1 } });
  b.set(db.doc('config/app'), { offlineDays: 3, idleLockMin: 5, nearPct: 80, wardStockScope: 'own', patientsRealAllowed: false });
  const byKey = {};
  for (const p of demoPatients(['D1'], 3)) {
    b.set(db.doc(`patients/${p.id}`), { ...p.minimal, updated_by: 'seed' });
    b.set(db.doc(`patient_identity/${p.id}`), p.identity);
    const k = `D1|${p.minimal.unit}|${p.minimal.kategori}`;
    byKey[k] = (byKey[k] || 0) + 1;
  }
  b.set(db.doc('stats/counts'), { byKey });
  await b.commit();
  await addUser('adm', 'admin');
  await addUser('pharm', 'pharmacist');
  await addUser('ward.etd', 'ward', 'etd');

  server = await startStatic(PORT);
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});

after(async () => { await browser?.close(); server?.close(); });

async function open(user, password = PW) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  const problems = [];
  // The SDK pings www.google.com/images/cleardot.gif to test connectivity while offline; CSP blocks it on purpose.
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text()) && !m.text().includes('cleardot.gif')) problems.push(m.text()); if (process.env.E2E_DEBUG && m.type() === 'error') console.log('console:', m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(BASE + '/');
  await page.fill('input[name=username]', user);
  await page.fill('input[name=password]', password);
  await page.click('button[type=submit]');
  return { context, page, problems };
}
const badge = (page) => page.locator('a.badge');

test('wrong password stays on the login screen', async () => {
  const { context, page } = await open('ward.etd', 'not-the-password');
  await page.getByText('Wrong username or password').waitFor();
  await context.close();
});

test('login and search the formulary', async () => {
  const { context, page, problems } = await open('pharm');
  await page.locator('.topbar').waitFor();
  await page.fill('input[type=search]', 'demobrand');
  await page.getByText('Demo Drug One 10mg Tablet').first().waitFor();
  assert.deepEqual(problems, []);
  await context.close();
});

test('drug info: gallery card, then the detail page shows Indications and Dosage', async () => {
  const { context, page, problems } = await open('ward.etd');
  await page.locator('.topbar').waitFor();
  await page.fill('input[type=search]', 'demo drug one');
  const card = page.locator('a.dcard').filter({ hasText: 'Demo Drug One 10mg Tablet' });
  await card.getByText('A*').waitFor();
  await card.click();
  const row = (label) => page.locator('.prow').filter({ has: page.locator('.pl', { hasText: new RegExp(`^${label}$`) }) }).locator('.pv');
  assert.equal(await row('Indications').innerText(), 'Demo indication line one\nDemo indication line two');
  assert.equal(await row('Dosage').innerText(), '10 mg OD');
  assert.equal(await row('Dilution').innerText(), 'Empty');
  assert.equal(await row('Price Per Pack').innerText(), 'RM 12.50');
  await page.getByText('Stock vs par by location').waitFor();
  await page.goto(BASE + '/#/');
  await page.getByRole('button', { name: 'List' }).click();
  await page.locator('a.item').filter({ hasText: 'Demo Drug One 10mg Tablet' }).waitFor();
  assert.deepEqual(problems, []);
  await context.close();
});

test('ward logs a movement offline, it shows pending, then syncs online', async () => {
  const { context, page, problems } = await open('ward.etd');
  await page.locator('.topbar').waitFor();
  await badge(page).filter({ hasText: 'Synced' }).waitFor();

  await context.setOffline(true);
  await badge(page).filter({ hasText: 'Offline' }).waitFor();
  await page.evaluate(() => { location.hash = '#/log?drug=D2'; });
  await page.locator('select[aria-label="Lokasi kad"]').waitFor();
  assert.equal(await page.locator('select[aria-label="Lokasi kad"]').inputValue(), 'etd', 'a ward user fills its own ward card');
  assert.ok(await page.locator('select[aria-label="Terima Daripada / Keluar Kepada"] option[value=main-store]').count(), 'a ward can receive from Main Store');
  await page.selectOption('select[aria-label="Jenis dokumen"]', 'BTB');
  await page.fill('input[aria-label="No. dokumen"]', 'E2E-1');
  await page.selectOption('select[aria-label="Terima Daripada / Keluar Kepada"]', 'text');
  await page.fill('input[aria-label^="Nama"]', 'Pembekal DEMO');
  await page.fill('input[aria-label=Kuantiti]', '7');
  await page.fill('input[aria-label="Seunit (RM)"]', '0.5');
  await page.getByText('Baki selepas baris ini').waitFor();
  await page.getByRole('button', { name: 'Simpan baris' }).click();
  await page.getByText('Disimpan dalam peranti').waitFor();
  await badge(page).filter({ hasText: 'Offline, 1 pending' }).waitFor();
  await page.locator('table.kad tr.pending').getByText('Belum sync').waitFor();

  await context.setOffline(false);
  await badge(page).filter({ hasText: 'Synced' }).waitFor({ timeout: 20000 });
  const moved = (await db.collection('movements').where('drug', '==', 'D2').get()).docs.map((d) => d.data());
  assert.equal(moved.length, 1);
  assert.deepEqual([moved[0].type, moved[0].to, moved[0].qty, moved[0].username, moved[0].locs], ['receive', 'etd', 7, 'ward.etd', ['etd']]);
  assert.deepEqual([moved[0].doc_type, moved[0].doc_no, moved[0].party, moved[0].unit_price, moved[0].tarikh.length], ['BTB', 'E2E-1', 'Pembekal DEMO', 0.5, 10]);
  // The Kad Stok row: B/F 0, Terimaan 7 x 0.50 = 3.50, Baki 7, Nama Pegawai = the ward user.
  const row = page.locator('table.kad tbody tr').nth(1);
  await row.filter({ hasNotText: 'Belum sync' }).waitFor();
  const cells = await row.locator('td').allInnerTexts();
  assert.deepEqual(cells.slice(1).map((c) => c.trim()), ['BTB E2E-1', 'Pembekal DEMO', '7', '0.50', '3.50', '', '', '7', '3.50', 'ward.etd']);
  assert.match(await page.locator('table.kad tr.bf').innerText(), /Baki dibawa ke hadapan/);
  assert.deepEqual(problems, []);
  await context.close();
});

test('ward has no patient access: no tab, no page, and Firestore refuses the read', async () => {
  const { context, page } = await open('ward.etd');
  await page.locator('.topbar').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Patients' }).count(), 0);
  await page.evaluate(() => { location.hash = '#/patients'; });
  await page.getByText('not available to you').waitFor();
  const codes = await page.evaluate(async () => {
    const { db } = await import('/js/fb.js');
    const { collection, getDocsFromServer, doc, getDocFromServer } = await import('/vendor/firebase.js');
    const out = [];
    for (const read of [() => getDocsFromServer(collection(db(), 'patients')), () => getDocsFromServer(collection(db(), 'patient_identity')), () => getDocFromServer(doc(db(), 'patient_identity/k_DEMO-001'))]) {
      try { await read(); out.push('allowed'); } catch (e) { out.push(e.code); }
    }
    return out;
  });
  assert.deepEqual(codes, ['permission-denied', 'permission-denied', 'permission-denied']);
  await context.close();
});

test('pharmacist sees masked DEMO patients, reveals an IC, and sign-out wipes the device cache', async () => {
  const { context, page, problems } = await open('pharm');
  await page.locator('.topbar').waitFor();
  await page.evaluate(() => { location.hash = '#/patients?drug=D1'; });
  await page.getByText('DEMO PATIENT 001').waitFor();
  assert.equal((await page.locator('main').innerText()).includes('000000-00-0001'), false, 'IC is masked in the list');
  await page.getByText('DEMO PATIENT 001').click();
  await page.getByRole('button', { name: /Show full IC/ }).click();
  await page.getByText('000000-00-0001').waitFor();
  const firestoreDbs = () => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => n.startsWith('firestore/')));
  assert.ok((await firestoreDbs()).length > 0, 'the SDK cache exists while signed in');

  await page.evaluate(() => { location.hash = '#/more'; });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.locator('input[name=username]').waitFor();
  assert.deepEqual(await firestoreDbs(), [], 'signing out deletes the Firestore cache');
  assert.deepEqual(problems, []);
  await context.close();
});

test('admin creates a ward user without being signed out, and the new user must change password', async () => {
  const { context, page, problems } = await open('adm');
  await page.locator('.topbar').waitFor();
  await page.evaluate(() => { location.hash = '#/admin'; });
  await page.locator('input[aria-label=Username]').fill('new.ward');
  await page.locator('select[aria-label=Role]').selectOption('ward');
  await page.locator('select[aria-label=Ward]').selectOption('icu');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Temporary password, shown once').waitFor({ timeout: 15000 }).catch(async (e) => { console.log(await page.locator('body').innerText()); throw e; });
  const temp = await page.locator('.notice.good .mono').innerText();
  await page.locator('.user-row', { hasText: 'new.ward' }).waitFor();
  const u = await auth.getUserByEmail('new.ward@staff.formulary.local');
  const doc = (await db.doc(`users/${u.uid}`).get()).data();
  assert.deepEqual([doc.role, doc.location, doc.must_change, doc.disabled], ['ward', 'icu', true, false]);
  assert.equal(await page.locator('.topbar').count(), 1, 'admin stays signed in');
  assert.deepEqual(problems, []);
  await context.close();

  const s2 = await open('new.ward', temp);
  await s2.page.getByText('Choose a new password').waitFor();
  await s2.context.close();
});

test('admin adds, renames and deletes an unused location; a used one can only be disabled', async () => {
  const { context, page, problems } = await open('adm');
  page.on('dialog', (d) => d.accept());
  await page.locator('.topbar').waitFor();
  await page.evaluate(() => { location.hash = '#/admin?tab=locations'; });
  await page.locator('input[aria-label=Name]').fill('E2E Fridge');
  await page.locator('section', { hasText: 'Add location' }).locator('select').nth(1).selectOption('main-store');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const row = page.locator('li.item').filter({ has: page.locator('input[aria-label="Name of E2E Fridge"]') });
  await row.locator('input').fill('E2E Cold Box');
  await row.getByRole('button', { name: 'Rename' }).click();
  await page.getByText('Saved').waitFor();
  const byId = async () => (await db.doc('catalog/locations').get()).data().byId;
  assert.equal((await byId())['main-store-e2e-fridge'].name, 'E2E Cold Box');

  // Never used: Delete removes it after the confirm.
  await row.getByRole('button', { name: 'Delete' }).click();
  await page.getByText('Deleted E2E Cold Box').waitFor();
  assert.equal((await byId())['main-store-e2e-fridge'], undefined);

  // ETD has a par list: Delete explains, Disable hides it.
  const etd = page.locator('li.item').filter({ has: page.locator('input[aria-label="Name of ETD"]') });
  await etd.getByRole('button', { name: 'Delete' }).click();
  await page.getByText('ETD has a par (floor stock) list, so it cannot be deleted').waitFor();
  assert.ok((await byId()).etd);
  await etd.getByRole('button', { name: 'Disable' }).click();
  await etd.getByRole('button', { name: 'Enable' }).waitFor();
  assert.equal((await byId()).etd.disabled, true);
  await etd.getByRole('button', { name: 'Enable' }).click();
  await etd.getByRole('button', { name: 'Disable' }).waitFor();

  // The admin's own row has no role picker; another user's does.
  await page.evaluate(() => { location.hash = '#/admin?tab=users'; });
  await page.locator('.user-row', { hasText: 'pharm' }).locator('select[aria-label="Role of pharm"]').waitFor();
  assert.equal(await page.locator('select[aria-label="Role of adm"]').count(), 0);
  assert.deepEqual(problems, []);
  await context.close();
});
