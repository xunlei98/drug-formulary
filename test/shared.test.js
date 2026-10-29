import test from 'node:test';
import assert from 'node:assert/strict';
import { validateShape, applyMovement, rebuild, negativesAfter } from '../shared/ledger.js';
import { status, summarize, byUnit } from '../shared/quota.js';
import { can } from '../shared/perm.js';
import { maskIc } from '../shared/ic.js';
import { canMove, nextStates } from '../shared/patient-state.js';

let n = 0;
const mv = (o) => ({ id: `mv-${String(++n).padStart(8, '0')}`, drug: 'D1', qty: 10, ...o });

test('ledger: receive, transfer, issue derive the balance', () => {
  const ms = [
    mv({ type: 'receive', to: 'store' }),
    mv({ type: 'transfer', from: 'store', to: 'ward', qty: 4 }),
    mv({ type: 'issue', from: 'ward', qty: 1 }),
  ];
  const b = rebuild(ms);
  assert.equal(b.get('D1|store'), 6);
  assert.equal(b.get('D1|ward'), 3);
});

test('ledger: stocktake resets the balance and reports variance', () => {
  const b = rebuild([mv({ type: 'receive', to: 'store', qty: 10 })]);
  const r = applyMovement(b, mv({ type: 'stocktake', to: 'store', qty: 7 }));
  assert.equal(r.variance, -3);
  applyMovement(b, mv({ type: 'issue', from: 'store', qty: 2 }));
  assert.equal(b.get('D1|store'), 5);
});

test('ledger: shape rules', () => {
  assert.equal(validateShape(mv({ type: 'receive', to: 'a' })), null);
  assert.match(validateShape(mv({ type: 'transfer', from: 'a', to: 'a' })), /differ/);
  assert.match(validateShape(mv({ type: 'transfer', from: 'a' })), /to location required/);
  assert.match(validateShape(mv({ type: 'issue', from: 'a', to: 'b' })), /not allowed/);
  assert.match(validateShape(mv({ type: 'adjust', from: 'a', to: 'b' })), /exactly one/);
  assert.match(validateShape(mv({ type: 'receive', to: 'a', qty: 0 })), /above 0/);
  assert.match(validateShape(mv({ type: 'receive', to: 'a', qty: 1.5 })), /whole/);
  assert.equal(validateShape(mv({ type: 'stocktake', to: 'a', qty: 0 })), null);
});

test('ledger: negativesAfter flags an overdraw without mutating', () => {
  const b = rebuild([mv({ type: 'receive', to: 'a', qty: 2 })]);
  const neg = negativesAfter(b, mv({ type: 'issue', from: 'a', qty: 5 }));
  assert.deepEqual(neg, [{ key: 'D1|a', after: -3 }]);
  assert.equal(b.get('D1|a'), 2);
});

test('quota: counts Active and Active - Pesara, waiting apart', () => {
  const ps = ['Active', 'Active - Pesara', 'Waiting List', 'Off', 'Defaulted', 'Active'].map((kategori) => ({ kategori }));
  assert.deepEqual(summarize(5, ps), { quota: 5, used: 3, waiting: 1, remaining: 2, over: 0, status: 'ok' });
});

test('quota: status thresholds', () => {
  assert.equal(status(7, 10), 'ok');
  assert.equal(status(8, 10), 'near');
  assert.equal(status(9, 10), 'near');
  assert.equal(status(10, 10), 'full');
  assert.equal(status(11, 10), 'over');
  assert.equal(status(0, 0), 'full');
  assert.equal(status(1, 0), 'over');
  assert.equal(status(3, null), 'none');
});

test('quota: per unit breakdown', () => {
  const ps = [{ kategori: 'Active', unit: 'Medical' }, { kategori: 'Active', unit: 'Medical' }, { kategori: 'Active', unit: 'O&G' }];
  const rows = byUnit([{ unit: 'Medical', kuantiti: 2 }], ps);
  assert.deepEqual(rows.find((r) => r.unit === 'Medical').status, 'full');
  assert.equal(rows.find((r) => r.unit === 'O&G').status, 'none');
});

test('permissions: ward has no patient access', () => {
  for (const p of ['patient.view', 'patient.edit', 'patient.fullic', 'user.manage', 'import.run']) assert.equal(can('ward', p), false, p);
  assert.equal(can('ward', 'stock.log'), true);
  assert.equal(can('pharmacist', 'patient.view'), true);
  assert.equal(can('pharmacist', 'user.manage'), false);
  assert.equal(can('admin', 'audit.view'), true);
  assert.equal(can('nobody', 'drug.view'), false);
});

test('ic mask shows last 4 only', () => {
  assert.equal(maskIc('900101-13-5678'), '******-**-5678');
  assert.equal(maskIc('000000-00-0000'), '******-**-0000');
  assert.equal(maskIc(''), '');
});

test('patient states: transitions', () => {
  assert.equal(canMove('Waiting List', 'Active'), true);
  assert.equal(canMove('Active', 'Waiting List'), false);
  assert.equal(canMove('Off', 'Defaulted'), false);
  assert.ok(nextStates('Active').includes('Off'));
});

test('quota: slots left never negative, over is counted', () => {
  const ps = Array.from({ length: 5 }, () => ({ kategori: 'Active' }));
  const s = summarize(3, ps);
  assert.equal(s.remaining, 0);
  assert.equal(s.over, 2);
  assert.equal(s.status, 'over');
});
