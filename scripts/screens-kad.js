// Screenshots of Kad Stok and its entry form at phone (360 px) and desktop widths, on the emulators with synthetic data.
//   npm run screens   (writes docs/screens/12-15-*.png)
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { startStatic } from './serve-local.js';
import { importMaster, chunkDrugs, defaultLocations } from '../public/shared/importers.js';

const PROJECT = 'demo-limbang-formulary';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const PW = `shots-${crypto.randomUUID()}`;
const PORT = 5071;
const OUT = new URL('../docs/screens/', import.meta.url).pathname;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT;
const app = initializeApp({ projectId: PROJECT });
const db = getFirestore(app);
const auth = getAuth(app);
await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });

const { drugs } = importMaster(`Kategori,Kod PhIS,No Kod,Perihal Stok,Brand,Jenis Perolehan Stok,Kumpulan,PKU,SKU,Harga PKU
Ubat,P1,D1,DEMO Paracetamol 500mg Tablet,Demobrand,APPL,Tablet,box of 100's,tablet,4.20`);
const b = db.batch();
chunkDrugs(drugs).forEach((items, i) => b.set(db.doc(`formulary/c00${i}`), { items }));
b.set(db.doc('catalog/locations'), { byId: defaultLocations() });
b.set(db.doc('catalog/mahal'), { items: {} });
b.set(db.doc('meta/catalog'), { formulary: 1, par: {} });
b.set(db.doc('config/app'), { offlineDays: 3, idleLockMin: 5, nearPct: 80, wardStockScope: 'own', patientsRealAllowed: false });
b.set(db.doc('checkpoints/main-store'), { asOf: Timestamp.fromDate(new Date('2026-09-30T16:00:00Z')), balances: { D1: 1200 }, uid: 'seed' });
const wards = ['etd', 'male-ward', 'female-ward', 'paeds-ward', 'icu'];
let day = 1;
const row = (o) => ({ drug: 'D1', from: null, to: null, note: '', uid: 'seed', username: 'demo.pharm', device_time: '', reverses: null, locs: [], ...o });
const rows = [
  row({ type: 'receive', to: 'main-store', qty: 2000, doc_type: 'PK', doc_no: 'PK2026/0815', party: 'DEMO Pembekal Sdn Bhd', unit_price: 0.042 }),
  row({ type: 'receive', to: 'main-store', qty: 300, username: 'alvin' }), // old shape: no card fields
];
for (let i = 0; i < 20; i++) rows.push(row({ type: 'transfer', from: 'main-store', to: wards[i % wards.length], qty: 50 + (i % 4) * 25, doc_type: 'BPSI', doc_no: `S${String(1201 + i)}`, username: i % 3 ? 'demo.pharm' : 'alvin' }));
rows.push(row({ type: 'issue', from: 'main-store', qty: 30, doc_type: 'LAIN', doc_no: 'RX-DEMO', party: 'DEMO PATIENT 001' }));
rows.push(row({ type: 'stocktake', to: 'main-store', qty: 1720, note: 'Kiraan bulanan' }));
for (const r of rows) {
  r.locs = [r.from, r.to].filter(Boolean);
  const t = new Date(`2026-10-${String(Math.min(28, day)).padStart(2, '0')}T02:00:00Z`);
  day += 1;
  r.server_time = Timestamp.fromDate(t);
  r.device_time = t.toISOString();
  r.tarikh = r.username === 'alvin' && !r.doc_type ? undefined : t.toISOString().slice(0, 10);
  if (r.tarikh === undefined) delete r.tarikh;
  b.set(db.collection('movements').doc(), r);
}
await b.commit();
const u = await auth.createUser({ email: 'demo.pharm@staff.formulary.local', password: PW });
await db.doc(`users/${u.uid}`).set({ username: 'demo.pharm', email: 'demo.pharm@staff.formulary.local', name: 'Demo Pharm', role: 'pharmacist', location: null, disabled: false, must_change: false, last_login: null, created: FieldValue.serverTimestamp() });

const server = await startStatic(PORT);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
for (const [tag, width, height] of [['360', 360, 1700], ['desktop', 1366, 900]]) {
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: 'light' })).newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.fill('input[name=username]', 'demo.pharm');
  await page.fill('input[name=password]', PW);
  await page.click('button[type=submit]');
  await page.locator('.topbar').waitFor();
  await page.evaluate(() => { location.hash = '#/kad/D1?loc=main-store'; });
  await page.locator('table.kad tbody tr:nth-child(3)').waitFor();
  await page.waitForTimeout(500);
  await page.getByText('DEMO Paracetamol').first().waitFor();
  await page.screenshot({ path: `${OUT}12-kad-stok-${tag}.png`, fullPage: true });
  if (width < 400) { // the table scrolled sideways on a phone: Tarikh stays pinned
    await page.locator('.kad-scroll').evaluate((el) => { el.scrollLeft = 520; });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}12-kad-stok-${tag}-scrolled.png`, fullPage: true });
  }
  await page.evaluate(() => { location.hash = '#/log?drug=D1&loc=main-store'; });
  await page.locator('select[aria-label="Jenis dokumen"]').waitFor();
  await page.selectOption('select[aria-label="Jenis dokumen"]', 'BPSI');
  await page.fill('input[aria-label="No. dokumen"]', 'S1221');
  await page.getByRole('button', { name: 'Keluaran' }).click();
  await page.selectOption('select[aria-label="Terima Daripada / Keluar Kepada"]', 'etd');
  await page.fill('input[aria-label=Kuantiti]', '120');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}13-kad-stok-entry-${tag}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Terimaan' }).click();
  await page.selectOption('select[aria-label="Terima Daripada / Keluar Kepada"]', 'text');
  await page.fill('input[aria-label^="Nama"]', 'DEMO Pembekal Sdn Bhd');
  await page.fill('input[aria-label="Seunit (RM)"]', '0.042');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}14-kad-stok-entry-terimaan-${tag}.png`, fullPage: true });
  await page.context().close();
}
await browser.close();
server.close();
console.log('screens written to', OUT);
process.exit(0);
