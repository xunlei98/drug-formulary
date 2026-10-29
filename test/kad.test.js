import test from 'node:test';
import assert from 'node:assert/strict';
import { cardRows, pageOf, validateCardFields } from '../public/shared/kad.js';
import { rebuild } from '../public/shared/ledger.js';

let n = 0;
const mv = (o) => ({ id: `mv-${String(++n).padStart(8, '0')}`, drug: 'D1', qty: 10, username: 'demo.pharm', server_time: `2026-10-${String(n).padStart(2, '0')}T01:00:00Z`, ...o });
const name = (x) => ({ ms: 'Main Store', etd: 'ETD' }[x] || x);

test('kad: running Baki after each row, in and out columns seen from the card location', () => {
  const ms = [
    mv({ type: 'receive', to: 'ms', qty: 100, doc_type: 'PK', doc_no: '123', party: 'Pharmaniaga', unit_price: 0.5 }),
    mv({ type: 'transfer', from: 'ms', to: 'etd', qty: 30, doc_type: 'BPSI', doc_no: 'S9' }),
    mv({ type: 'issue', from: 'ms', qty: 5, party: 'OPD' }),
    mv({ type: 'receive', to: 'etd', qty: 7 }), // other location: not on this card
    mv({ type: 'receive', to: 'ms', qty: 7, drug: 'D2' }), // other drug
  ];
  const c = cardRows(ms, { drug: 'D1', loc: 'ms', opening: 0, name });
  assert.deepEqual(c.rows.map((r) => [r.inQty, r.outQty, r.baki, r.party, r.doc]), [
    [100, null, 100, 'Pharmaniaga', 'PK 123'],
    [null, 30, 70, 'ETD', 'BPSI S9'],
    [null, 5, 65, 'OPD', null],
  ]);
  assert.equal(c.baki, rebuild(ms).get('D1|ms'), 'card Baki agrees with the ledger balance');
  const etd = cardRows(ms, { drug: 'D1', loc: 'etd', name });
  assert.deepEqual(etd.rows.map((r) => [r.party, r.inQty, r.baki]), [['Main Store', 30, 30], ['Pembekal / luar', 7, 37]]);
});

test('kad: Baki dibawa ke hadapan starts from the checkpoint and moves up when older rows are paged off', () => {
  const ms = [mv({ type: 'issue', from: 'ms', qty: 3 }), mv({ type: 'receive', to: 'ms', qty: 10 }), mv({ type: 'issue', from: 'ms', qty: 4 })];
  const c = cardRows(ms, { drug: 'D1', loc: 'ms', opening: 50, name });
  assert.deepEqual(c.rows.map((r) => r.baki), [47, 57, 53]);
  assert.deepEqual(pageOf(c, 10), { bf: 50, bfRm: null, rows: c.rows, older: 0 });
  const p = pageOf(c, 2);
  assert.equal(p.bf, 47);
  assert.equal(p.older, 1);
  assert.deepEqual(p.rows.map((r) => r.baki), [57, 53]);
});

test('kad: RM columns are Kuantiti x Seunit, carried from the last priced row, else "-" (null)', () => {
  const ms = [
    mv({ type: 'receive', to: 'ms', qty: 20 }), // no price yet
    mv({ type: 'receive', to: 'ms', qty: 10, unit_price: 1.25 }),
    mv({ type: 'issue', from: 'ms', qty: 4 }),
  ];
  const [a, b, c] = cardRows(ms, { drug: 'D1', loc: 'ms', name }).rows;
  assert.deepEqual([a.inPrice, a.inRm, a.bakiRm], [null, null, null]);
  assert.deepEqual([b.inPrice, b.inRm, b.baki, b.bakiRm], [1.25, 12.5, 30, 37.5]);
  assert.deepEqual([c.outRm, c.baki, c.bakiRm], [5, 26, 32.5]);
  const odd = cardRows([mv({ type: 'receive', to: 'ms', qty: 3, unit_price: 0.1 })], { drug: 'D1', loc: 'ms', name }).rows[0];
  assert.equal(odd.inRm, 0.3, 'rounded to sen');
});

test('kad: old movements without card fields still display; stocktake, adjust and reversal rows read sensibly', () => {
  const ms = [
    mv({ type: 'receive', to: 'ms', qty: 10, username: 'alvin' }),
    mv({ type: 'stocktake', to: 'ms', qty: 8 }),
    mv({ type: 'adjust', to: 'ms', qty: 2 }),
    mv({ type: 'issue', from: 'ms', qty: 2, reverses: 'x' }),
    mv({ type: 'issue', from: 'ms', qty: 3, party: 'DEMO PATIENT 001', doc_type: 'LAIN', doc_no: 'RX1' }),
  ];
  ms[4].id = 'orig';
  ms.push(mv({ type: 'receive', to: 'ms', qty: 3, reverses: 'orig' }));
  const r = cardRows(ms, { drug: 'D1', loc: 'ms', name }).rows;
  assert.deepEqual(r[0], { id: r[0].id, pending: false, type: 'receive', tarikh: '2026-10-' + r[0].tarikh.slice(8), doc: null, party: 'Pembekal / luar', note: '', inQty: 10, inPrice: null, inRm: null, outQty: null, outRm: null, baki: 10, bakiRm: null, negative: false, pegawai: 'alvin' });
  assert.deepEqual([r[1].outQty, r[1].baki, r[1].party], [2, 8, 'Kiraan stok: 8']);
  assert.deepEqual([r[2].inQty, r[2].party], [2, 'Pelarasan']);
  assert.deepEqual([r[3].outQty, r[3].party, r[3].baki], [2, 'Batal: Pesakit / luar', 8]);
  assert.deepEqual([r[4].doc, r[4].party, r[5].party, r[5].inQty, r[5].baki], ['RX1', 'DEMO PATIENT 001', 'Batal: DEMO PATIENT 001', 3, 8], 'a reversal names the row it cancels; Lain-lain shows just the number');
  assert.equal(cardRows([mv({ type: 'issue', from: 'ms', qty: 1, tarikh: '2026-01-05' })], { drug: 'D1', loc: 'ms', name }).rows[0].negative, true);
  assert.equal(cardRows([mv({ type: 'issue', from: 'ms', qty: 1, tarikh: '2026-01-05' })], { drug: 'D1', loc: 'ms', name }).rows[0].tarikh, '2026-01-05', 'Tarikh entered wins over server time');
});

test('kad: card field validation', () => {
  assert.equal(validateCardFields({}), null);
  assert.equal(validateCardFields({ doc_type: 'BTB', doc_no: 'A1', party: 'x', tarikh: '2026-10-29', unit_price: 0 }), null);
  assert.match(validateCardFields({ doc_type: 'XX' }), /document type/);
  assert.match(validateCardFields({ tarikh: '29/10/2026' }), /Tarikh/);
  assert.match(validateCardFields({ unit_price: -1 }), /Seunit/);
  assert.match(validateCardFields({ doc_no: 'x'.repeat(41) }), /too long/);
});

test('kad: entry form maps onto the existing movement types', async () => {
  const { entryToMovement } = await import('../public/shared/kad.js');
  const { validateShape } = await import('../public/shared/ledger.js');
  const base = { drug: 'D1', loc: 'ms', qty: 5, tarikh: '2026-10-29', doc_type: 'PK', doc_no: '77', note: '' };
  const cases = [
    [{ dir: 'in', with: 'text', party: 'Pharmaniaga', unit_price: '0.50' }, { type: 'receive', to: 'ms', party: 'Pharmaniaga', unit_price: 0.5 }],
    [{ dir: 'in', with: 'etd' }, { type: 'transfer', from: 'etd', to: 'ms' }],
    [{ dir: 'out', with: 'etd', unit_price: '3' }, { type: 'transfer', from: 'ms', to: 'etd' }], // Seunit is a Terimaan column only
    [{ dir: 'out', with: 'text', party: 'DEMO PATIENT 001' }, { type: 'issue', from: 'ms', party: 'DEMO PATIENT 001' }],
    [{ dir: 'in', with: 'adjust' }, { type: 'adjust', to: 'ms' }],
    [{ dir: 'out', with: 'adjust' }, { type: 'adjust', from: 'ms' }],
    [{ dir: 'count', with: 'etd', qty: 0 }, { type: 'stocktake', to: 'ms', qty: 0 }],
  ];
  for (const [e, want] of cases) {
    const m = entryToMovement({ ...base, ...e });
    assert.deepEqual(m, { drug: 'D1', qty: 5, tarikh: '2026-10-29', doc_type: 'PK', doc_no: '77', ...want });
    assert.equal(validateShape({ id: 'preview-id', ...m }), null, JSON.stringify(e));
    assert.equal(validateCardFields(m), null);
  }
  assert.match(validateShape({ id: 'preview-id', ...entryToMovement({ ...base, dir: 'in', with: '' }) }), /from location required/);
});
