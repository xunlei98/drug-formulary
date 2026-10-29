import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, seedBasics, addUser, client, uuid, PW } from './helpers.js';
import { rebuild } from '../shared/ledger.js';
import { loadConfig } from '../src/config.js';

async function setup(env) {
  const s = await startServer(env);
  seedBasics(s.db);
  await addUser(s.db, 'ph', 'pharmacist');
  await addUser(s.db, 'adm', 'admin');
  await addUser(s.db, 'wa', 'ward', { location_id: 'wardA' });
  await addUser(s.db, 'wb', 'ward', { location_id: 'wardB' });
  const as = async (name) => { const c = client(s.base); const r = await c.login(name); assert.equal(r.status, 200); return c; };
  return { ...s, as };
}

const mv = (o) => ({ kind: 'movement', id: uuid(), movement: { drug: 'D1', qty: 10, ...o } });
const sync = (c, ops, mode = 'live') => c.post('/api/sync', { mode, ops });

test('config refuses insecure cookies away from localhost', () => {
  assert.throws(() => loadConfig({ SECURE_COOKIES: '0', HOST: '0.0.0.0' }), /SECURE_COOKIES/);
  assert.doesNotThrow(() => loadConfig({ SECURE_COOKIES: '0', HOST: '127.0.0.1' }));
  assert.equal(loadConfig({}).secureCookies, true);
});

test('login: wrong password, limiter, header and CSRF checks', async () => {
  const s = await setup({ LOGIN_MAX_FAILS: '3' });
  try {
    const c = client(s.base);
    for (let i = 0; i < 3; i++) assert.equal((await c.login('ph', 'wrong-password-x')).status, 401);
    const blocked = await c.login('ph');
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
    const raw = await fetch(s.base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'adm', password: PW }) });
    assert.equal(raw.status, 403, 'missing X-Requested-With header');
    const bad = await fetch(s.base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'formulary', origin: 'http://evil.example' }, body: '{}' });
    assert.equal(bad.status, 403, 'foreign origin');
  } finally { await s.close(); }
});

test('headers: CSP, nosniff, referrer policy on pages', async () => {
  const s = await setup();
  try {
    const r = await fetch(s.base + '/');
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.doesNotMatch(r.headers.get('content-security-policy'), /unsafe-inline/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  } finally { await s.close(); }
});

test('first login forces a password change, with rules', async () => {
  const s = await setup();
  try {
    await addUser(s.db, 'newbie', 'ward', { must_change: 1, location_id: 'wardA' });
    const c = client(s.base);
    assert.equal((await c.login('newbie')).body.user.must_change, true);
    assert.equal((await c.get('/api/snapshot')).status, 403);
    assert.equal((await c.post('/api/password', { current: PW, next: 'short' })).status, 400);
    assert.equal((await c.post('/api/password', { current: PW, next: 'password123' })).status, 400);
    assert.equal((await c.post('/api/password', { current: PW, next: 'newbie-is-my-name' })).status, 400);
    assert.equal((await c.post('/api/password', { current: PW, next: 'a-fine-new-passphrase' })).status, 200);
    assert.equal((await c.get('/api/snapshot')).status, 200);
  } finally { await s.close(); }
});

test('sessions: expired session is refused, disabled and deleted users are cut at the next request', async () => {
  const s = await setup();
  try {
    const exp = await s.as('ph');
    s.db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    assert.equal((await exp.get('/api/snapshot')).status, 401);

    const admin = await s.as('adm');
    const w = await s.as('wa');
    const id = s.db.prepare("SELECT id FROM users WHERE username = 'wa'").get().id;
    assert.equal((await w.get('/api/snapshot')).status, 200);
    assert.equal((await admin.patch(`/api/users/${id}`, { disabled: 1 })).status, 200);
    assert.equal((await w.get('/api/snapshot')).status, 401);

    const w2 = await s.as('wb');
    const id2 = s.db.prepare("SELECT id FROM users WHERE username = 'wb'").get().id;
    assert.equal((await admin.del(`/api/users/${id2}`)).status, 200);
    assert.equal((await w2.get('/api/snapshot')).status, 401);
    assert.equal((await admin.del(`/api/users/${s.db.prepare("SELECT id FROM users WHERE username='adm'").get().id}`)).status, 409);
  } finally { await s.close(); }
});

test('sessions: admin idle limit is shorter than staff', async () => {
  const s = await setup();
  try {
    await s.as('adm'); await s.as('wa');
    const rows = s.db.prepare('SELECT u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id').all();
    const hours = (r) => (Date.parse(r.expires_at) - Date.now()) / 3.6e6;
    assert.ok(hours(rows.find((r) => r.role === 'admin')) < 4.01);
    assert.ok(hours(rows.find((r) => r.role === 'ward')) > 11.9);
  } finally { await s.close(); }
});

test('ledger: live movement that overdraws is rejected, replayed one is accepted and flagged', async () => {
  const s = await setup();
  try {
    const ph = await s.as('ph');
    assert.equal((await sync(ph, [mv({ type: 'receive', to: 'store', qty: 5 })])).body.results[0].status, 'applied');
    const live = (await sync(ph, [mv({ type: 'issue', from: 'store', qty: 9 })], 'live')).body.results[0];
    assert.equal(live.status, 'rejected');
    const replay = (await sync(ph, [mv({ type: 'issue', from: 'store', qty: 9 })], 'replay')).body.results[0];
    assert.equal(replay.status, 'applied');
    assert.deepEqual(replay.negative, [{ drug: 'D1', location: 'store', qty: -4 }]);
    const flags = (await ph.get('/api/discrepancies')).body.items;
    assert.equal(flags.length, 1);
    assert.equal(flags[0].qty_after, -4);
    assert.equal((await ph.post(`/api/discrepancies/${flags[0].id}/resolve`, { note: 'recounted' })).status, 200);
    assert.equal((await ph.get('/api/discrepancies')).body.items.length, 0);
  } finally { await s.close(); }
});

test('sync: the same batch twice changes nothing, duplicate UUID returns the first result', async () => {
  const s = await setup();
  try {
    const ph = await s.as('ph');
    const ops = [mv({ type: 'receive', to: 'store', qty: 8 }), mv({ type: 'transfer', from: 'store', to: 'wardA', qty: 3 })];
    const first = (await sync(ph, ops, 'replay')).body.results;
    assert.deepEqual(first.map((r) => r.status), ['applied', 'applied']);
    const snap = () => JSON.stringify(s.db.prepare('SELECT * FROM balances ORDER BY drug, location').all()) + s.db.prepare('SELECT COUNT(*) n FROM movements').get().n;
    const before = snap();
    const second = (await sync(ph, ops, 'replay')).body.results;
    assert.deepEqual(second.map((r) => r.status), ['duplicate', 'duplicate']);
    assert.equal(snap(), before);
    const other = await s.as('adm');
    const clash = (await sync(other, [{ ...ops[0], movement: { ...ops[0].movement, qty: 99 } }], 'replay')).body.results[0];
    assert.equal(clash.status, 'duplicate');
    assert.equal(snap(), before);
  } finally { await s.close(); }
});

test('ledger: balance table equals a rebuild from movements, and movements are append-only', async () => {
  const s = await setup();
  try {
    const ph = await s.as('ph');
    await sync(ph, [
      mv({ type: 'receive', to: 'store', qty: 20 }), mv({ type: 'transfer', from: 'store', to: 'wardA', qty: 6 }),
      mv({ type: 'issue', from: 'wardA', qty: 2 }), mv({ type: 'stocktake', to: 'store', qty: 12 }), mv({ type: 'adjust', to: 'wardA', qty: 1 }),
    ], 'replay');
    const rows = s.db.prepare('SELECT * FROM movements ORDER BY seq').all().map((r) => ({ drug: r.drug, from: r.from_location, to: r.to_location, qty: r.qty, type: r.type }));
    const expected = rebuild(rows);
    const actual = new Map(s.db.prepare('SELECT drug, location, qty FROM balances').all().map((b) => [`${b.drug}|${b.location}`, b.qty]));
    assert.deepEqual([...actual].sort(), [...expected].sort());
    assert.equal(actual.get('D1|store'), 12);
    assert.throws(() => s.db.prepare("UPDATE movements SET qty = 1").run(), /append-only/);
    assert.throws(() => s.db.prepare('DELETE FROM movements').run(), /append-only/);
  } finally { await s.close(); }
});

test('ledger: undo is a reversing entry, allowed once, and must really be the reverse', async () => {
  const s = await setup();
  try {
    const ph = await s.as('ph');
    const recv = mv({ type: 'receive', to: 'store', qty: 5 });
    await sync(ph, [recv]);
    const wrong = { kind: 'movement', id: uuid(), movement: { drug: 'D1', type: 'issue', from: 'store', qty: 4, reverses: recv.id } };
    assert.equal((await sync(ph, [wrong])).body.results[0].status, 'rejected');
    const good = { kind: 'movement', id: uuid(), movement: { drug: 'D1', type: 'issue', from: 'store', qty: 5, reverses: recv.id } };
    assert.equal((await sync(ph, [good])).body.results[0].status, 'applied');
    const again = { ...good, id: uuid() };
    assert.equal((await sync(ph, [again])).body.results[0].reason, 'already undone');
    assert.equal(s.db.prepare("SELECT qty FROM balances WHERE drug='D1' AND location='store'").get().qty, 0);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM movements').get().n, 2);
  } finally { await s.close(); }
});

test('scope: a ward sees and logs only its own location', async () => {
  const s = await setup();
  try {
    const ph = await s.as('ph');
    await sync(ph, [mv({ type: 'receive', to: 'wardA', qty: 4 }), mv({ type: 'receive', to: 'wardB', qty: 7 }), mv({ type: 'receive', to: 'store', qty: 9 })]);
    const wa = await s.as('wa');
    const snap = (await wa.get('/api/snapshot')).body;
    assert.deepEqual(snap.balances.map((b) => b.location), ['wardA']);
    assert.ok(snap.movements.every((m) => [m.from, m.to].includes('wardA')));
    const deny = await sync(wa, [mv({ type: 'receive', to: 'wardB', qty: 1 })]);
    assert.equal(deny.body.results[0].status, 'rejected');
    assert.match(deny.body.results[0].reason, /location/);
    assert.equal((await sync(wa, [mv({ type: 'transfer', from: 'store', to: 'wardA', qty: 1 })])).body.results[0].status, 'applied');
    assert.equal((await sync(wa, [mv({ type: 'issue', from: 'wardA', qty: 1 })])).body.results[0].status, 'applied');
    assert.equal((await sync(wa, [mv({ type: 'transfer', from: 'wardB', to: 'store', qty: 1 })])).body.results[0].status, 'rejected');
    const open = await s.as('ph').then((c) => c.get('/api/snapshot'));
    assert.equal(open.body.balances.length, 3);
  } finally { await s.close(); }
});

const demo = (o = {}) => ({ no_kod: 'D1', nama: 'DEMO PATIENT 001', ic: '000000-00-0000', kategori: 'Active', unit: 'Medical', preskriber: 'Dr Demo', ...o });
const addPatient = (c, p = demo()) => { const id = uuid(); return c.post('/api/sync', { mode: 'live', ops: [{ kind: 'patient_create', id, patient: p }] }).then((r) => ({ id, r: r.body.results[0] })); };

test('patients: ward is refused everywhere, and snapshot carries no patient data for ward', async () => {
  const s = await setup();
  try {
    const ph = await s.as('ph');
    const { id } = await addPatient(ph);
    const wa = await s.as('wa');
    assert.equal((await wa.get('/api/patients')).status, 403);
    assert.equal((await wa.get(`/api/patients/${id}`)).status, 403);
    assert.equal((await wa.get(`/api/patients/${id}/log`)).status, 403);
    assert.equal((await wa.post(`/api/patients/${id}/reveal-ic`)).status, 403);
    const create = await wa.post('/api/sync', { mode: 'live', ops: [{ kind: 'patient_create', id: uuid(), patient: demo() }] });
    assert.equal(create.body.results[0].status, 'rejected');
    const snap = await wa.get('/api/snapshot');
    assert.equal(snap.body.patients, undefined);
    assert.doesNotMatch(JSON.stringify(snap.body), /DEMO PATIENT/);
    assert.ok(snap.body.counts.length > 0, 'ward still gets anonymous counts for quota');
  } finally { await s.close(); }
});

test('patients: snapshot for pharmacist holds minimal data only, full list is masked and no-store', async () => {
  const s = await setup();
  try {
    const ph = await s.as('ph');
    const { id } = await addPatient(ph, demo({ nama: 'DEMO PATIENT SMITH', ic: '000000-00-1234' }));
    const snap = (await ph.get('/api/snapshot')).body;
    const p = snap.patients.find((x) => x.id === id);
    assert.equal(p.initials, 'DPS');
    assert.equal(p.ic4, '1234');
    assert.doesNotMatch(JSON.stringify(snap), /DEMO PATIENT|000000-00/);
    const full = await ph.get('/api/patients');
    assert.equal(full.headers.get('cache-control'), 'no-store');
    assert.equal(full.body.patients[0].ic, '******-**-1234');
    const off = await setup({ OFFLINE_PATIENTS: 'off' });
    try {
      const p2 = await off.as('ph');
      await addPatient(p2);
      assert.equal((await p2.get('/api/snapshot')).body.patients, undefined);
    } finally { await off.close(); }
  } finally { await s.close(); }
});

test('patients: reveal IC writes an audit row without the IC or name', async () => {
  const s = await setup();
  try {
    const ph = await s.as('ph');
    const { id } = await addPatient(ph, demo({ ic: '000000-00-4321' }));
    assert.equal((await ph.post(`/api/patients/${id}/reveal-ic`)).body.ic, '000000-00-4321');
    const rows = s.db.prepare("SELECT * FROM audit WHERE action = 'patient.ic_reveal'").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].target, id);
    assert.doesNotMatch(JSON.stringify(s.db.prepare('SELECT * FROM audit').all()), /DEMO PATIENT|000000-00-4321/);
  } finally { await s.close(); }
});

test('patients: quota counting via the API, state machine, offline limits', async () => {
  const s = await setup();
  try {
    const ph = await s.as('ph');
    const a = await addPatient(ph, demo({ nama: 'DEMO PATIENT 001' }));
    await addPatient(ph, demo({ nama: 'DEMO PATIENT 002', kategori: 'Active - Pesara' }));
    await addPatient(ph, demo({ nama: 'DEMO PATIENT 003', kategori: 'Waiting List' }));
    const sum = (await ph.get('/api/mahal/D1/summary')).body;
    assert.deepEqual({ used: sum.used, waiting: sum.waiting, remaining: sum.remaining, status: sum.status }, { used: 2, waiting: 1, remaining: 0, status: 'full' });

    const move = (kategori, extra = {}, mode = 'live') => ph.post('/api/sync', { mode, ops: [{ kind: 'patient_update', id: uuid(), patient_id: a.id, patch: { kategori, ...extra } }] }).then((r) => r.body.results[0]);
    assert.equal((await move('Waiting List')).status, 'rejected');
    assert.match((await move('Off')).reason, /stop date/);
    assert.equal((await move('Off', { tarikh_henti: '2026-10-01' })).status, 'applied');
    assert.equal((await ph.get('/api/mahal/D1/summary')).body.used, 1);
    const log = (await ph.get(`/api/patients/${a.id}/log`)).body.log;
    const k = log.find((l) => l.action === 'kategori');
    assert.deepEqual([k.from_kategori, k.to_kategori], ['Active', 'Off']);
    assert.equal(log.find((l) => l.action === 'edit').detail, 'tarikh_henti');

    const sneaky = await ph.post('/api/sync', { mode: 'replay', ops: [{ kind: 'patient_update', id: uuid(), patient_id: a.id, patch: { nama: 'X' } }] });
    assert.match(sneaky.body.results[0].reason, /online/);
    const over = await move('Active', {}, 'replay');
    assert.equal(over.status, 'applied');
    await addPatient(ph, demo({ nama: 'DEMO PATIENT 004' }));
    const warn = (await addPatient(ph, demo({ nama: 'DEMO PATIENT 005' }))).r;
    assert.match(warn.warning, /Over quota by 2/);
  } finally { await s.close(); }
});

test('permissions: forbidden calls per role', async () => {
  const s = await setup();
  try {
    const wa = await s.as('wa');
    const ph = await s.as('ph');
    const forbidden = [
      ['get', '/api/users'], ['get', '/api/audit'], ['post', '/api/import/master', { text: 'x' }], ['post', '/api/locations', { name: 'x', type: 'store' }],
      ['patch', '/api/drugs/D1', { perihal: 'x' }], ['put', '/api/mahal/D1', { quota: 5 }], ['get', '/api/discrepancies'],
    ];
    for (const [m, u, b] of forbidden) assert.equal((await wa[m](u, b)).status, 403, `ward ${m} ${u}`);
    for (const [m, u, b] of forbidden.filter((f) => /users|audit|import|locations/.test(f[1]))) assert.equal((await ph[m](u, b)).status, 403, `pharmacist ${m} ${u}`);
    assert.equal((await ph.put('/api/mahal/D1', { quota: 5, units: [{ unit: 'Medical', kuantiti: 2 }] })).status, 200);
    assert.equal((await client(s.base).get('/api/snapshot')).status, 401);
    assert.equal((await wa.get('/api/snapshot')).status, 200);
  } finally { await s.close(); }
});

test('admin: creates staff, resets passwords, manages locations, imports, audit holds no secrets', async () => {
  const s = await setup();
  try {
    const adm = await s.as('adm');
    const made = (await adm.post('/api/users', { username: 'siti', display_name: 'Siti', role: 'ward', location_id: 'wardA' })).body;
    assert.ok(made.tempPassword.length >= 10);
    const siti = client(s.base);
    const r = await siti.login('siti', made.tempPassword);
    assert.equal(r.body.user.must_change, true);
    const id = s.db.prepare("SELECT id FROM users WHERE username='siti'").get().id;
    const reset = (await adm.post(`/api/users/${id}/reset-password`)).body;
    assert.equal((await siti.get('/api/me')).status, 401, 'reset cuts sessions');
    assert.equal((await client(s.base).login('siti', reset.tempPassword)).status, 200);
    assert.equal((await adm.post('/api/locations', { name: 'Rack Z', type: 'shelf' })).status, 400);
    const loc = (await adm.post('/api/locations', { name: 'Rack Z', type: 'shelf', parent_id: 'store' })).body.id;
    assert.equal((await adm.patch(`/api/locations/store`, { parent_id: loc })).status, 400, 'no cycles');
    const imp = (await adm.post('/api/import/master', { dryRun: true, text: 'Kategori,Kod PhIS,No Kod,Perihal Stok,Yearly\nUbat,K1,X1,Demo X,"1,250"\nUbat,K2,X2,Demo Y,abc' })).body;
    assert.deepEqual([imp.added, imp.errors.length, imp.dryRun], [1, 1, true]);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM drugs WHERE no_kod='X1'").get().n, 0, 'dry run rolls back');
    await adm.post('/api/import/master', { text: 'Kategori,Kod PhIS,No Kod,Perihal Stok,Yearly\nUbat,K1,X1,Demo X,"1,250"' });
    assert.equal(s.db.prepare("SELECT yearly FROM drugs WHERE no_kod='X1'").get().yearly, 1250);
    const dump = JSON.stringify(s.db.prepare('SELECT * FROM audit').all());
    assert.doesNotMatch(dump, new RegExp(made.tempPassword));
    assert.ok(s.db.prepare("SELECT 1 FROM audit WHERE action='login.ok'").get());
  } finally { await s.close(); }
});
