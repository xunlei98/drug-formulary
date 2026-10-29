import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFloorStock, matchRow, buildIndex, norm } from '../public/shared/floorstock.js';
import { groupPar, parStatus } from '../public/shared/par.js';
import { importMaster, importItemMahal, importKuotaUnit, importPatients, importFloorStock, chunkDrugs, defaultLocations, demoPatients, splitPatient, isDemoPatient } from '../public/shared/importers.js';

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

test('par status: low only from a real balance, never from a missing one', () => {
  const g = groupPar([{ drug: 'D1', location: 'w', list: 'floor', max_qty: 30 }, { drug: 'D1', location: 'w', list: 'trolley', max_qty: 10 }]);
  assert.equal(g.get('D1|w').par, 40);
  assert.equal(parStatus(undefined, 40), 'uncounted');
  assert.equal(parStatus(0, 40), 'low');
  assert.equal(parStatus(39, 40), 'low');
  assert.equal(parStatus(40, 40), 'ok');
  assert.equal(parStatus(5, 0), 'nopar');
});

const MASTER = `Kategori,Kod PhIS,No Kod,Perihal Stok,Brand,Jenis Perolehan Stok,Kumpulan,PKU,SKU
Ubat,P1,D1,Demo Drug One 10mg Tablet,,LP,Tablet,pack,tab
Ubat,P2,D2,Demo Drug Two,,LP,Tablet,pack,tab
,,,,,,,,`;

test('importers: master, Item Mahal and Kuota by unit build the catalog', () => {
  const m = importMaster(MASTER);
  assert.equal(m.drugs.size, 2);
  const im = importItemMahal('ID,No Kod,Kuota,Tarikh Kemaskini,Nota\nr1,D1,6,04/08/2022\nr2,NOPE,1,', { drugs: m.drugs });
  assert.deepEqual([...im.mahal.keys()], ['D1']);
  assert.ok(im.result.skipped + im.result.errors.length >= 1);
  const ku = importKuotaUnit('ID,No Kod,Item,Tarikh Kemaskini,Kuantiti,Unit,Pegawai\nK1,D1,x,04/08/2022,4,Psychiatry,P', { mahal: im.mahal });
  assert.ok(JSON.stringify(ku.mahal.get('D1')).includes('Psychiatry'));
  assert.equal(chunkDrugs(m.drugs, 1).length, 2);
});

test('importers: the 19 Hospital Limbang locations', () => {
  const locs = Object.values(defaultLocations());
  assert.equal(locs.length, 19);
  assert.equal(locs.filter((l) => l.type === 'ward').length, 15);
});

test('importers: patients are refused unless DEMO or real data is explicitly allowed', () => {
  const head = 'KeyID,No Kod,Nama Pesakit,No Kad Pengenalan,Kategori,Unit\n';
  const real = `${head}K1,D1,SYNTHETIC NON DEMO NAME,111111-11-1111,Active,Medical\n`;
  const demo = `${head}K2,D1,DEMO PATIENT 001,000000-00-0001,Active,Medical\n`;
  const mahal = new Map([['D1', {}]]);
  assert.equal(importPatients(real, { mahal }).rows.length, 0);
  assert.equal(importPatients(demo, { mahal }).rows.length, 1);
  assert.equal(importPatients(real, { mahal, realAllowed: true }).rows.length, 1);
});

test('importers: the cached patient record holds no name or full IC', () => {
  const { minimal, identity } = splitPatient({ no_kod: 'D1', nama: 'DEMO PATIENT 001', ic: '000000-00-0001', kategori: 'Active' });
  assert.equal(JSON.stringify(minimal).includes('DEMO PATIENT'), false);
  assert.equal(minimal.ic4, '0001');
  assert.equal(identity.ic, '000000-00-0001');
  assert.ok(demoPatients(['D1']).every((p) => isDemoPatient(p.identity)));
});

test('importers: floor stock rows carry the location and matched drug', () => {
  const drugs = importMaster(MASTER).drugs;
  const r = importFloorStock(SAMPLE, { drugs, location: 'etd' });
  assert.equal(r.parsed, 6);
  assert.ok(r.rows.every((x) => x.location === 'etd'));
  assert.equal(r.rows[0].drug, 'D1');
});
