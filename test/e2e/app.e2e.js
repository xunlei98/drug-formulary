import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer, seedBasics, addUser, PW, client } from '../helpers.js';
import { createPatient } from '../../src/patients.js';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
let app;
let browser;

before(async () => {
  assert.ok(CHROME, 'Set CHROME_PATH to a Chrome or Chromium binary');
  app = await startServer();
  seedBasics(app.db);
  await addUser(app.db, 'ward.a', 'ward', { location_id: 'wardA' });
  await addUser(app.db, 'pharm', 'pharmacist');
  await addUser(app.db, 'newbie', 'ward', { location_id: 'wardA', must_change: 1 });
  const made = createPatient(app.db, crypto.randomUUID(), { no_kod: 'D1', nama: 'DEMO PATIENT 001', ic: '000000-00-0001', kategori: 'Active', unit: 'Medical' }, { id: null, username: 'seed' });
  assert.equal(made.status, 'applied');
  const seedStock = client(app.base);
  await addUser(app.db, 'seeder', 'pharmacist');
  await seedStock.login('seeder');
  await seedStock.post('/api/sync', { mode: 'live', ops: [{ id: crypto.randomUUID(), kind: 'movement', movement: { drug: 'D1', type: 'receive', to: 'store', qty: 100 } }] });
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});

after(async () => { await browser?.close(); await app?.close(); });

async function open(user, password = PW) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'allow' });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(app.base + '/');
  await page.fill('input[name=username]', user);
  await page.fill('input[name=password]', password);
  await page.click('button[type=submit]');
  return { context, page, problems };
}

const badge = (page) => page.locator('a.badge');

test('forced password change on first login, then the app opens', async () => {
  const { context, page, problems } = await open('newbie');
  await page.getByText('Choose a new password').waitFor();
  const [cur, n1, n2] = await page.locator('input[type=password]').all();
  await cur.fill(PW); await n1.fill('a-brand-new-passphrase-7'); await n2.fill('a-brand-new-passphrase-7');
  await page.click('button[type=submit]');
  await page.locator('.topbar').waitFor();
  assert.deepEqual(problems, []);
  await context.close();
});

test('wrong password shows an error and stays on the login screen', async () => {
  const { context, page } = await open('ward.a', 'not-the-password');
  await page.getByText('Wrong username or password').waitFor();
  await context.close();
});

test('search a drug, go offline, log a movement, come back online, it syncs and the balance updates', async () => {
  const { context, page, problems } = await open('ward.a');
  await page.locator('.topbar').waitFor();
  await page.fill('input[type=search]', 'demo drug one');
  await page.getByText('Demo Drug One 10mg Tablet').first().click();
  await page.getByText('Ubat Mahal slots left', { exact: false }).first().waitFor();

  await context.setOffline(true);
  await badge(page).filter({ hasText: 'Offline' }).waitFor();

  await page.evaluate(() => { location.hash = '#/log?drug=D1'; });
  await page.locator('select[aria-label=To]').waitFor();
  await page.selectOption('select[aria-label=To]', 'wardA');
  await page.fill('input[aria-label=Quantity]', '7');
  await page.getByRole('button', { name: 'Save movement' }).click();
  await page.getByText('Saved on this device').waitFor();
  await badge(page).filter({ hasText: '1 pending' }).or(badge(page).filter({ hasText: 'Offline, 1 pending' })).waitFor();

  const wardNow = await page.evaluate(() => document.body.innerText);
  assert.match(wardNow, /\b7\b/, 'the pending movement shows in the on-device balance');

  await context.setOffline(false);
  await badge(page).filter({ hasText: 'Synced' }).waitFor({ timeout: 15000 });

  const who = client(app.base);
  await who.login('pharm');
  const snap = await who.get('/api/snapshot');
  const bal = snap.body.balances.find((b) => b.drug === 'D1' && b.location === 'wardA');
  assert.equal(bal?.qty, 7);
  const moved = snap.body.movements.filter((m) => m.drug === 'D1' && m.to === 'wardA');
  assert.equal(moved.length, 1);
  assert.deepEqual(problems, []);
  await context.close();
});

test('the service worker serves the app shell with no network', async () => {
  const { context, page } = await open('ward.a');
  await page.locator('.topbar').waitFor();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.locator('.topbar').waitFor();
  await context.setOffline(true);
  await page.reload();
  await page.locator('.topbar').waitFor();
  await page.fill('input[type=search]', 'demo drug');
  await page.getByText('Demo Drug Two').first().waitFor();
  await context.close();
});

test('ward users have no Patients tab and cannot open the patient list', async () => {
  const { context, page } = await open('ward.a');
  await page.locator('.topbar').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Patients' }).count(), 0);
  await page.evaluate(() => { location.hash = '#/patients'; });
  await page.getByText('not available to you').waitFor();
  const stored = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  assert.ok(!stored.includes('fm-patients'), 'no patient database on a ward device');
  await context.close();
});

test('pharmacist sees masked IC, reveals it on tap, and signing out wipes the device patient cache', async () => {
  const { context, page } = await open('pharm');
  await page.locator('.topbar').waitFor();
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByText('DEMO PATIENT 001').waitFor();
  const text = await page.locator('main').innerText();
  assert.ok(!text.includes('000000-00-0001'), 'full IC is not in the list');
  await page.getByText('DEMO PATIENT 001').click();
  await page.getByRole('button', { name: /Show full IC/ }).click();
  await page.getByText('000000-00-0001').waitFor();
  const who = client(app.base);
  await who.login('pharm');
  const audit = await (async () => { const a = client(app.base); await addUser(app.db, 'boss', 'admin'); await a.login('boss'); return a.get('/api/audit'); })();
  assert.ok(audit.body.entries.some((e) => e.action === 'patient.ic_reveal'));
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  assert.ok(dbs.includes('fm-patients'));
  await page.goto(app.base + '/#/more');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.locator('input[name=username]').waitFor();
  const after = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  assert.ok(!after.includes('fm-patients'));
  await context.close();
});
