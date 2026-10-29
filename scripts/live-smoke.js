// Smoke test against the live site with the demo accounts. Never prints passwords.
//   GOOGLE_APPLICATION_CREDENTIALS=<key> SECRETS=<file> node scripts/live-smoke.js
// SECRETS holds lines "<username> temporary: <pw>" / "<username> current: <pw>". The ward's new password is appended there.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const BASE = process.env.BASE || 'https://limbang-formulary.web.app';
const SECRETS = process.env.SECRETS;
const DRUG = process.env.DRUG || '01.3003.10';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'limbang-formulary' }));

function pw(user) {
  const lines = fs.readFileSync(SECRETS, 'utf8').split('\n').map((l) => l.split(' ')).filter((p) => p[0] === user);
  const cur = lines.filter((p) => p[1] === 'current:').pop() || lines.filter((p) => p[1] === 'temporary:').pop();
  return cur?.[2];
}
const step = (s) => console.log('ok  ' + s);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
async function open(user) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text()) && !m.text().includes('cleardot.gif')) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE + '/');
  await page.fill('input[name=username]', user);
  await page.fill('input[name=password]', pw(user));
  await page.click('button[type=submit]');
  return { context, page, problems };
}
// Signs in; if the app forces a password change, picks a new random one, appends it to SECRETS, and saves it.
async function passForced(page, user) {
  const forced = page.getByText('Choose a new password');
  await Promise.race([forced.waitFor({ timeout: 20000 }), page.locator('.topbar').waitFor({ timeout: 20000 })]).catch(() => {});
  if (await forced.isVisible()) {
    const old = pw(user);
    const next = 'Lf-' + crypto.randomBytes(12).toString('base64url');
    if (await page.locator('input[aria-label="Current password"]').count()) await page.fill('input[aria-label="Current password"]', old);
    await page.fill('input[aria-label="New password"]', next);
    await page.fill('input[aria-label="Repeat new password"]', next);
    fs.appendFileSync(SECRETS, `${user} current: ${next}\n`, { mode: 0o600 });
    await page.getByRole('button', { name: 'Save password' }).click();
  }
  await page.locator('.topbar').waitFor({ timeout: 20000 });
}

let failed = 0;
async function check(name, fn) {
  try { await fn(); step(name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + String(e.message).split('\n')[0]); }
}

// ---- ward ----
const wardUser = 'demo.ward';
const { context: wc, page: w, problems: wp } = await open(wardUser);
await check('ward signs in; forced password change saved (new value in secrets file only)', () => passForced(w, wardUser));
await check('ward search finds a drug', async () => {
  await w.fill('input[type=search]', 'paracetamol');
  await w.getByText('Paracetamol 120 mg/5 ml Syrup').first().waitFor({ timeout: 15000 });
});
const NOTE = 'Live smoke test';
const smokeMoves = async () => (await db.collection('movements').where('drug', '==', DRUG).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
async function poll(fn, ms = 20000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 1000))) { const v = await fn(); if (v) return v; }
  throw new Error('timed out waiting for the server');
}
const before = new Set((await smokeMoves()).map((m) => m.id));
await check('ward logs a test receive of 1 at Male Ward; it reaches the server and shows Synced', async () => {
  await w.evaluate((d) => { location.hash = `#/log?drug=${encodeURIComponent(d)}`; }, DRUG);
  await w.locator('select[aria-label=To]').waitFor();
  assert.equal(await w.locator('select[aria-label=To]').inputValue(), 'male-ward');
  await w.fill('input[aria-label=Quantity]', '1');
  await w.fill('input[aria-label=Note]', NOTE);
  await w.getByRole('button', { name: 'Save movement' }).click();
  const now = await poll(async () => { const n = (await smokeMoves()).filter((m) => !before.has(m.id)); return n.length ? n : null; });
  assert.equal(now.length, 1, 'one new movement on the server');
  assert.deepEqual([now[0].type, now[0].to, now[0].qty, now[0].username, now[0].note], ['receive', 'male-ward', 1, wardUser, NOTE]);
  await w.locator('a.badge').filter({ hasText: 'Synced' }).waitFor({ timeout: 20000 });
});
// Undoes every smoke-test movement still shown with an Undo button (also any left over from an earlier failed run).
await check('ward undoes the test movement(s) in the app; reversals on the server; Male Ward net change is 0', async () => {
  await w.evaluate((d) => { location.hash = `#/drug/${encodeURIComponent(d)}`; }, DRUG);
  const rows = () => w.locator('main li.item').filter({ hasText: NOTE }).filter({ has: w.getByRole('button', { name: 'Undo this movement' }) });
  await rows().first().waitFor({ timeout: 20000 });
  for (let i = 0; i < 5 && await rows().count(); i++) {
    await rows().first().getByRole('button', { name: 'Undo this movement' }).click();
    await w.waitForTimeout(1500);
  }
  const net = await poll(async () => {
    const all = await smokeMoves();
    const tests = all.filter((m) => m.note === NOTE && m.username === wardUser);
    const revs = all.filter((m) => tests.some((t) => t.id === m.reverses));
    if (revs.length < tests.length) return null;
    return { n: [...tests, ...revs].reduce((s, m) => s + (m.to === 'male-ward' ? m.qty : 0) - (m.from === 'male-ward' ? m.qty : 0), 0), count: tests.length };
  });
  assert.equal(net.n, 0, 'net effect at Male Ward');
  console.log(`    smoke movements reversed: ${net.count}`);
  await w.locator('a.badge').filter({ hasText: 'Synced' }).waitFor({ timeout: 20000 });
});
await check('ward cannot read patients (no tab, Firestore permission-denied)', async () => {
  assert.equal(await w.getByRole('link', { name: 'Patients' }).count(), 0);
  const codes = await w.evaluate(async () => {
    const { db } = await import('/js/fb.js');
    const { collection, getDocsFromServer, doc, getDocFromServer } = await import('/vendor/firebase.js');
    const out = [];
    for (const read of [() => getDocsFromServer(collection(db(), 'patients')), () => getDocsFromServer(collection(db(), 'patient_identity')), () => getDocFromServer(doc(db(), 'patients/k_DEMO-001'))]) {
      try { await read(); out.push('allowed'); } catch (e) { out.push(e.code); }
    }
    return out;
  });
  assert.deepEqual(codes, ['permission-denied', 'permission-denied', 'permission-denied']);
});
await check('ward session had no CSP or page errors', async () => assert.deepEqual(wp, []));
await wc.close();

// ---- pharmacist ----
const pharmUser = 'demo.pharm';
const demoDrug = (await db.doc('patients/k_DEMO-001').get()).data().no_kod;
const { context: pc, page: p, problems: pp } = await open(pharmUser);
await check('pharmacist signs in (forced password change; new value in secrets file only)', () => passForced(p, pharmUser));
await check('pharmacist Ubat Mahal quota screen loads with counts', async () => {
  await p.evaluate(() => { location.hash = '#/quota'; });
  await p.locator('main .list li:not(.empty)').first().waitFor({ timeout: 20000 });
  const n = await p.locator('main .list li:not(.empty)').count(); assert.ok(n >= 1, 'quota rows'); console.log('    quota rows shown: ' + n);
});
await check('pharmacist sees DEMO patients for a quota drug, IC masked', async () => {
  await p.evaluate((d) => { location.hash = `#/patients?drug=${encodeURIComponent(d)}`; }, demoDrug);
  await p.getByText('DEMO PATIENT 001').waitFor({ timeout: 15000 });
  assert.equal((await p.locator('main').innerText()).includes('000000-00-0001'), false);
  assert.equal(/DEMO PATIENT/.test(await p.locator('main').innerText()), true);
});
await check('pharmacist session had no CSP or page errors', async () => assert.deepEqual(pp, []));
await pc.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
await browser.close();
process.exit(failed ? 1 : 0);
