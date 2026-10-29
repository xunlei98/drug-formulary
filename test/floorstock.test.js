import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseFloorStock, matchRow, buildIndex, norm } from '../src/import/floorstock.js';
import { importFloorStock } from '../src/import/index.js';
import { seedLocations } from '../src/stock.js';
import { openDb } from '../src/db.js';
import { groupPar, parStatus } from '../shared/par.js';
import { startServer, seedBasics, addUser, client } from './helpers.js';

// Same layout pdftotext -layout produces for the 2026 lists, with made-up items.
const SAMPLE = `
                          Senarai Floor Stock 2026 Hospital Limbang
                                      Wad Contoh
                                                       Kuantiti
  Bil   Item                                            SKU      Maksimum   Inden   Bekal   Catatan
Tablets
  1     Demo Drug One 10 mg Tablet                      tab       30                        Luput 8 minggu
  2     Demo Drug Two                                   tab       1,000
Injectables
        Demo Long Injection Name 4mg/ml in 2ml Injection
  3                                                     amp       5
        (8mg/2ml)
       Demo Wrapped Tablet With Brand
  4                                                     tab
       (Brandname)                                                10
  5     Mystery Item 5 mg Injection                     vial
Nota: 1. Senarai ini diluluskan
Pihak Wad:                                            Farmasi:
  9     Signature line that is not a row                tab       99

                          Senarai Emergency Trolley 2026 Hospital Limbang
  Bil   Item                                            SKU      Maksimum
  1     Demo Drug One 10mg Tablet                       tab       10
`;

test('floor stock parser: rows, wraps, lists, blank quantity, Nota cutoff', () => {
  const rows = parseFloorStock(SAMPLE);
  assert.deepEqual(rows.map((r) => [r.list, r.name, r.unit, r.max]), [
    ['floor', 'Demo Drug One 10 mg Tablet', 'tab', 30],
    ['floor', 'Demo Drug Two', 'tab', 1000],
    ['floor', 'Demo Long Injection Name 4mg/ml in 2ml Injection (8mg/2ml)', 'amp', 5],
    ['floor', 'Demo Wrapped Tablet With Brand (Brandname)', 'tab', 10],
    ['floor', 'Mystery Item 5 mg Injection', 'vial', null],
    ['trolley', 'Demo Drug One 10mg Tablet', 'tab', 10],
  ]);
  assert.equal(rows[0].note, 'Luput 8 minggu');
});

test('floor stock matcher: exact after normalising, strengths must agree, no cross-molecule guesses', () => {
  const idx = buildIndex([
    { no_kod: 'A', perihal: 'Demo Drug One 10mg Tablet' },
    { no_kod: 'B', perihal: 'Demo Drug One 20mg Tablet' },
    { no_kod: 'C', perihal: 'Proparacaine HCl 0.5% Ophthalmic Drops' },
    { no_kod: 'D', perihal: 'Haloperidol 5 mg/ml Injection' },
    { no_kod: 'E', perihal: 'Insulin regular 100 IU/mL Penfill' },
  ]);
  assert.equal(norm('Proparacaine HCI 0.5 % lnjection'), 'proparacaine hcl 0.5% injection');
  assert.deepEqual(matchRow('Demo Drug One 10 mg Tablet', idx), { drug: 'A', match: 'exact', score: 1 });
  assert.equal(matchRow('Proparacaine HCI 0.5 % Ophthalmic Drops', idx).drug, 'C');
  assert.equal(matchRow('Demo Drug One 10 mg Sublingual Tablet', idx).drug, 'A');
  assert.equal(matchRow('Demo Drug One 15 mg Tablet', idx).drug, null);
  assert.equal(matchRow('Levobupivacaine 5mg/ml Injection', idx).drug, null);
  assert.equal(matchRow('Insulin regular 100 IU/mL Vial', idx).drug, null);
});

test('floor stock import replaces one unit, never touches balances, and dry run saves nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-'));
  const db = openDb(path.join(dir, 't.db'));
  try {
    seedBasics(db);
    const dry = importFloorStock(db, SAMPLE, { location: 'wardA', dryRun: true });
    assert.equal(dry.parsed, 6);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM par_levels').get().n, 0);
    const a = importFloorStock(db, SAMPLE, { location: 'wardA' });
    assert.equal(a.matched, 3);
    assert.equal(a.unmatched.length, 3);
    assert.equal(a.errors.length, 1);
    const b = importFloorStock(db, SAMPLE, { location: 'wardA' });
    assert.equal(b.updated, 6);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM par_levels').get().n, 6);
    assert.equal(db.prepare('SELECT SUM(max_qty) s FROM par_levels WHERE drug = ?').get('D1').s, 40);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM balances').get().n, 0);
    assert.throws(() => importFloorStock(db, SAMPLE, { location: 'nowhere' }), /active location/);
    assert.throws(() => importFloorStock(db, 'hello', { location: 'wardA' }), /No floor stock rows/);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('par status: low only from a real balance, never from a missing one', () => {
  const g = groupPar([{ drug: 'D1', location: 'w', list: 'floor', max_qty: 30 }, { drug: 'D1', location: 'w', list: 'trolley', max_qty: 10 }]);
  assert.equal(g.get('D1|w').par, 40);
  assert.equal(parStatus(undefined, 40), 'uncounted');
  assert.equal(parStatus(0, 40), 'low');
  assert.equal(parStatus(39, 40), 'low');
  assert.equal(parStatus(40, 40), 'ok');
  assert.equal(parStatus(5, 0), 'nopar');
});

test('locations: real stores and wards replace unused examples; used ones are disabled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loc-'));
  const db = openDb(path.join(dir, 't.db'));
  try {
    db.exec(`INSERT INTO locations (id, name, type, parent_id) VALUES ('main-store','EXAMPLE Main Store','store',NULL),
      ('main-store-rack-a','EXAMPLE Rack A','shelf','main-store'), ('ward-medical','EXAMPLE Medical Ward','ward',NULL), ('ward-psych','EXAMPLE Psychiatry Ward','ward',NULL);
      INSERT INTO drugs (no_kod, kategori, perihal) VALUES ('X','Ubat','Demo X');
      INSERT INTO balances (drug, location, qty) VALUES ('X','ward-medical',3);`);
    seedLocations(db);
    const again = seedLocations(db);
    assert.deepEqual(again, { added: 0, removed: 0 });
    const rows = db.prepare('SELECT id, name, type, disabled FROM locations').all();
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(by['main-store'].name, 'Main Store');
    assert.equal(by['ward-medical'].disabled, 1);
    assert.equal(by['ward-psych'], undefined);
    assert.equal(rows.filter((r) => !r.disabled && r.type === 'store').length, 4);
    assert.equal(rows.filter((r) => !r.disabled && r.type === 'ward').length, 15);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('floor stock API: admin imports pasted text or a PDF; snapshot carries matched par levels in scope', async () => {
  const s = await startServer();
  try {
    seedBasics(s.db);
    await addUser(s.db, 'adm', 'admin');
    await addUser(s.db, 'wb', 'ward', { location_id: 'wardB' });
    const adm = client(s.base);
    await adm.login('adm');
    const r = await adm.post('/api/import/floorstock', { text: SAMPLE, location: 'wardA' });
    assert.equal(r.status, 200);
    assert.equal(r.body.matched, 3);
    const snap = (await adm.get('/api/snapshot')).body;
    assert.deepEqual(snap.par.map((p) => [p.drug, p.location, p.list, p.max_qty]), [['D1', 'wardA', 'floor', 30], ['D2', 'wardA', 'floor', 1000], ['D1', 'wardA', 'trolley', 10]]);
    const wb = client(s.base);
    await wb.login('wb');
    assert.equal((await wb.get('/api/snapshot')).body.par.length, 0);
    assert.equal((await wb.post('/api/import/floorstock', { text: SAMPLE, location: 'wardB' })).status, 403);
    let hasPdf = true;
    try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { hasPdf = false; }
    const bad = await adm.post('/api/import/floorstock', { pdf: Buffer.from('not a pdf').toString('base64'), location: 'wardB' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, hasPdf ? /Could not read/ : /pdftotext/);
  } finally { await s.close(); }
});
