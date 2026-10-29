import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInfoSheet, matchInfo, mergeInfo, imageUrl, drugView, prescriberTone } from '../public/shared/druginfo.js';
import { importMaster } from '../public/shared/importers.js';
import { indexDrug, search } from '../public/shared/search.js';

const HEAD = 'DrugsID,Item,Brand,Form,Packaging Image,Image,Pharmacologic Category,Prescriber Category,Pregnancy Category,Breastfeeding Consideration,Indications,Dosage,Renal Dosage Adjustments,Dilution,Source of origins,PhIS Code,Item Code,Procurement,Packaging,SKU,Price Per Pack (RM),Price Per Unit (RM),Group,Keep Buffer';
const row = (o) => ['', o.item, o.brand || '', o.form || '', o.pack || '', '', o.cat || '', o.pc || '', '', '', o.ind || '', o.dose || '', '', '', '', o.phis || '', o.code || '', o.proc || '', '', '', o.price || '', '', '', o.buffer || '']
  .map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',');
const sheet = (...rows) => [HEAD, ...rows.map(row)].join('\r\n');
const drug = (no_kod, perihal, kod_phis = '') => [no_kod, { no_kod, perihal, kod_phis, kategori: 'Ubat', brand: '' }];

test('parseInfoSheet keeps line breaks, types prices and the buffer flag, drops empty cells', () => {
  const [r] = parseInfoSheet(sheet({ item: 'Acetazolamide 250 mg Tablet', ind: 'Glaucoma\r\nEpilepsy', dose: '250mg OD-QID', code: '02.0001.02', price: '45.86', buffer: 'TRUE', pc: 'B' }));
  assert.equal(r.item, 'Acetazolamide 250 mg Tablet');
  assert.equal(r.info.indications, 'Glaucoma\nEpilepsy');
  assert.equal(r.info.price_pack, 45.86);
  assert.equal(r.info.keep_buffer, true);
  assert.equal(r.info.prescriber_cat, 'B');
  assert.equal('dilution' in r.info, false);
});

test('matchInfo: item code, then PhIS code, then exact name; ties are reported, not guessed', () => {
  const drugs = new Map([drug('02.0001.02', 'Acetazolamide 250mg Tablet'), drug('D02.0430.02', 'Clonazepam 2mg Tablet', '02.0430.02'),
    drug('X1', 'Artesunate 60mg injection'), drug('Y1', 'Rabies Vaccine Injection'), drug('Z9', 'Unrelated Cream')]);
  const rows = parseInfoSheet(sheet(
    { item: 'Acetazolamide 250 mg Tablet', code: '02.0001.02' },
    { item: 'Clonazepam 2 mg Tablet (Pack of 500)', code: '02.0430.02' },
    { item: 'Artesunate 60 mg Injection', code: 'P01XX.01' },
    { item: 'Rabies Vaccine Injection', code: 'Y1' },
    { item: 'Rabies Human Diploid Cell Vaccine', code: 'Y1' },
    { item: 'Brand New Drug 5 mg Tablet', code: 'NEW01' },
    { item: 'No Code Drug Tablet' }));
  const m = matchInfo(rows, drugs);
  assert.deepEqual([...m.matched.keys()].sort(), ['02.0001.02', 'D02.0430.02', 'X1']);
  assert.deepEqual(Object.values(m.tiers), [1, 1, 1]);
  assert.equal(m.ambiguous.length, 2);
  assert.ok(m.ambiguous.every((a) => a.drugs[0] === 'Y1'));
  assert.deepEqual(m.unmatched.map((u) => u.item), ['Brand New Drug 5 mg Tablet', 'No Code Drug Tablet']);
  assert.deepEqual(m.noSheet.sort(), ['Y1', 'Z9']);

  const { drugs: out, added } = mergeInfo(drugs, m, rows);
  assert.deepEqual(added, ['NEW01']);
  assert.equal(out.get('NEW01').source, 'old-formulary-sheet');
  assert.equal(out.get('X1').info.item_code, 'P01XX.01');
  assert.equal(out.get('Z9').info, undefined);
  // Re-running on the merged formulary changes nothing.
  const again = mergeInfo(out, matchInfo(rows, out), rows);
  assert.deepEqual(again.added, []);
  assert.deepEqual(JSON.stringify([...again.drugs]), JSON.stringify([...out]));
});

test('a sheet row whose name looks like an existing drug is not added as a new drug', () => {
  const drugs = new Map([drug('A1', 'Clindamycin 150mg/ml Injection', 'J01FF01162P3001a')]);
  const rows = parseInfoSheet(sheet({ item: 'Clindamycin Phosphate 150 mg/ml Injection', code: 'J01FF01162P3001XX' }));
  const m = matchInfo(rows, drugs);
  assert.equal(m.unmatched[0].suggest.drug, 'A1');
  assert.deepEqual(mergeInfo(drugs, m, rows).added, []);
});

test('a MASTER re-import keeps the drug info', () => {
  const csv = 'Kategori,Kod PhIS,No Kod,Perihal Stok\nUbat,P1,K1,Drug One';
  const first = importMaster(csv).drugs;
  first.set('K1', { ...first.get('K1'), info: { dosage: '1 tab OD' } });
  assert.equal(importMaster(csv, { drugs: first }).drugs.get('K1').info.dosage, '1 tab OD');
});

test('imageUrl turns Drive links into thumbnails and drops what the app cannot load', () => {
  assert.equal(imageUrl('https://drive.google.com/uc?export=view&id=1WQb-_x'), 'https://lh3.googleusercontent.com/d/1WQb-_x=w400');
  assert.equal(imageUrl('https://drive.google.com/file/d/abc123/view'), 'https://lh3.googleusercontent.com/d/abc123=w400');
  assert.equal(imageUrl('https://i.imgur.com/XXASYdZ.jpg'), 'https://i.imgur.com/XXASYdZ.jpg');
  assert.equal(imageUrl('DRUG FORMULARY_Images/x.jpg'), null);
  assert.equal(imageUrl('http://i.imgur.com/a.jpg'), null);
  assert.equal(imageUrl(''), null);
});

test('drugView prefers MASTER values and falls back to the sheet', () => {
  const v = drugView({ no_kod: 'K1', perihal: 'X', brand: '', jenis: 'LP', harga_pku: 10, info: { brand: 'Diamox', price_pack: 45.86, price_unit: 0.46, prescriber_cat: 'B' } });
  assert.equal(v.brand, 'Diamox');
  assert.equal(v.price_pack, 10);
  assert.equal(v.price_unit, 0.46);
  assert.equal(v.procurement, 'Local Purchase');
  assert.equal(v.item_code, 'K1');
  assert.equal(prescriberTone(v.prescriber_cat), 's-ok');
});

test('search finds a drug by sheet brand and class, and by indication below name hits', () => {
  const a = { no_kod: 'A', perihal: 'Acetazolamide 250mg Tablet', info: { brand: 'Diamox', pharm_cat: 'Carbonic Anhydrase Inhibitor', indications: 'Reduction of intraocular pressure in glaucoma' } };
  const b = { no_kod: 'B', perihal: 'Glaucoma Eye Drops' };
  const idx = [a, b].map(indexDrug);
  assert.deepEqual(search(idx, 'diamox').map((d) => d.no_kod), ['A']);
  assert.deepEqual(search(idx, 'anhydrase').map((d) => d.no_kod), ['A']);
  assert.deepEqual(search(idx, 'glaucoma').map((d) => d.no_kod), ['B', 'A']);
});
