import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeNotion, keptRow } from '../public/shared/notioninfo.js';
import { drugView } from '../public/shared/druginfo.js';

const drug = (no_kod, perihal, extra = {}) => [no_kod, { no_kod, perihal, kod_phis: extra.kod_phis || '', kategori: 'Ubat', brand: '', ...extra }];

test('mergeNotion copies clinical text and kept-at rows, and keeps the photo', () => {
  const drugs = new Map([
    drug('02.0001.02', 'Acetazolamide 250mg Tablet', { info: { pack_img: 'https://i.imgur.com/a.jpg', indications: 'old sheet', origin: 'old' } }),
    drug('OLD1', 'Ranitidine', { source: 'old-formulary-sheet' }),
  ]);
  const rows = [{
    url: 'https://app.notion.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    item: 'Acetazolamide 250 mg Tablet', item_code: '02.0001.02', phis: 'S01EC01000T1001XX',
    indications: 'Glaucoma', dosage: '250 mg', administration: 'With food', hepatic: 'Avoid',
    remark: 'Fridge', price_pack: 45.86, quota: 'https://tinyurl.com/ubatmahalhl',
  }];
  const places = [
    { loc: 'Wad Lelaki', stock: 'Floor Stock', qty: '10', tags: '["https://app.notion.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]' },
    { loc: 'Endoscopy', stock: 'Emergency Trolley', qty: '2', note: 'Adult', tags: '["https://app.notion.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]' },
    { loc: 'mat', stock: 'AOH', qty: '1', tags: '["https://app.notion.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]' },
  ];
  const r = mergeNotion(drugs, rows, places);
  assert.deepEqual(r.removed, ['OLD1']);
  assert.equal(r.drugs.has('OLD1'), false);
  const info = r.drugs.get('02.0001.02').info;
  assert.equal(info.indications, 'Glaucoma');
  assert.equal(info.administration, 'With food');
  assert.equal(info.hepatic, 'Avoid');
  assert.equal(info.pack_img, 'https://i.imgur.com/a.jpg');
  assert.equal('origin' in info, false);
  assert.equal(info.quota_url, 'https://tinyurl.com/ubatmahalhl');
  assert.deepEqual(info.kept.map((k) => [k.kind, k.loc, k.loc_id || null]), [
    ['floor', 'Wad Lelaki', 'male-ward'],
    ['aoh', 'mat', null],
    ['trolley', 'Endoscopy', 'unit-endoscopy'],
  ]);
  const view = drugView(r.drugs.get('02.0001.02'));
  assert.equal(view.administration, 'With food');
  assert.equal(view.kept[0].loc_id, 'male-ward');
});

test('a remark that contains an identity number is left out, and a new Notion drug is not added', () => {
  const drugs = new Map([drug('E1', 'Eplerenone 50mg Tablet')]);
  const rows = [{
    url: 'https://app.notion.com/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    item: 'Eplerenone 50 mg Tablet', item_code: 'E1',
    indications: 'Heart failure',
    remark: 'Named patient 510101135239',
  }, {
    url: 'https://app.notion.com/cccccccccccccccccccccccccccccccc',
    item: 'Brand New Drug', item_code: 'NEW1', indications: 'Nope',
  }];
  const r = mergeNotion(drugs, rows, []);
  assert.equal(r.remarksLeftOut, 1);
  assert.equal(r.drugs.get('E1').info.indications, 'Heart failure');
  assert.equal('remark' in r.drugs.get('E1').info, false);
  assert.equal(r.drugs.has('NEW1'), false);
  assert.equal(r.unmatched.length, 1);
});

test('two stock kinds at one ward both stay, and an unmatched drug drops old sheet text', () => {
  const drugs = new Map([
    drug('A1', 'Adrenaline Injection'),
    drug('B1', 'Only On Master', { info: { indications: 'from the old sheet', img: 'https://i.imgur.com/b.jpg' } }),
  ]);
  const rows = [{ url: 'https://app.notion.com/dddddddddddddddddddddddddddddddd', item: 'Adrenaline Injection', item_code: 'A1' }];
  const places = [
    { loc: 'Endoscopy', stock: 'Floor Stock', qty: '5', tags: '["https://app.notion.com/dddddddddddddddddddddddddddddddd"]' },
    { loc: 'Endoscopy', stock: 'Emergency Trolley', qty: '2', tags: '["https://app.notion.com/dddddddddddddddddddddddddddddddd"]' },
    { loc: 'ICU', stock: 'DDA', qty: '1', tags: '["https://app.notion.com/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]' },
  ];
  const r = mergeNotion(drugs, rows, places);
  assert.deepEqual(r.drugs.get('A1').info.kept.map((k) => k.kind), ['floor', 'trolley']);
  assert.equal(r.drugs.get('B1').info.indications, undefined);
  assert.equal(r.drugs.get('B1').info.img, 'https://i.imgur.com/b.jpg');
  assert.equal(r.placesUnused, 1);
  assert.equal(keptRow({ loc: 'Wad Maternity (1)', stock: 'Floor Stock' }).loc_id, 'maternity-ward');
});

test('Notion line breaks become real lines', () => {
  const drugs = new Map([drug('A1', 'Abacavir 300 mg Tablet')]);
  const r = mergeNotion(drugs, [{
    url: 'https://app.notion.com/p/73882215818a4fa2b6ee7e18efb458c4',
    Item: 'Abacavir 300 mg Tablet', 'Item Code': 'A1',
    Indications: 'Line one<br />Line two',
    Administration: 'May be taken with or without food. \\[Lexicomp\\]',
  }], []);
  assert.equal(r.drugs.get('A1').info.indications, 'Line one\nLine two');
  assert.equal(r.drugs.get('A1').info.administration, 'May be taken with or without food. [Lexicomp]');
});
