import { h, icon, clear, fmt } from '../dom.js';
import { state, locationOptions, audit as auditLog } from '../store.js';
import { db, emailFor, createAuthUser } from '../fb.js';
import { doc, collection, query, where, orderBy, limit, getDoc, getDocs, setDoc, updateDoc, writeBatch, serverTimestamp, increment, deleteField, FieldPath } from '/vendor/firebase.js';
import { commit, setWrite } from '../rest.js';
import { recountStats } from '../patients-data.js';
import { importMaster, importItemMahal, importKuotaUnit, importPatients, importFloorStock, chunkDrugs } from '/shared/importers.js';
import { chips, toast } from '../ui.js';
import { ROLES } from '/shared/perm.js';

const field = (label, node) => h('label', { class: 'field' }, h('span', null, label), node);
const fail = (e) => toast(!navigator.onLine ? 'Needs a connection' : e.code === 'permission-denied' ? 'Not allowed' : e.message, true);
const ref = (path) => doc(db(), path);

export function admin(_, query) {
  let tab = query.get('tab') || 'users';
  const host = h('div', { class: 'stack' });
  const tabs = chips([['users', 'Users'], ['locations', 'Locations'], ['import', 'Import'], ['audit', 'Audit']], tab, (v) => { tab = v; show(); });
  const show = () => ({ users, locations, import: importTab, audit }[tab])(host).catch(fail);
  show();
  return { el: h('div', null, tabs, host), title: 'Admin' };
}

// 14 characters from an unambiguous alphabet, from the browser's CSPRNG.
function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(14)), (n) => abc[n % abc.length]).join('');
}

// Accounts: Firebase Auth holds the password; users/{uid} holds the role. Without Cloud Functions the app cannot
// delete an Auth account or set someone else's password, so "Delete" removes the role and disables the account.
async function users(host, flash = null) {
  const snap = await getDocs(collection(db(), 'users'));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.username.localeCompare(b.username));
  const wards = state.locations.filter((l) => l.type === 'ward' && !l.disabled);
  const revealed = h('div', null, flash);
  const roleSel = h('select', { 'aria-label': 'Role' }, ROLES.map((r) => h('option', { value: r }, r)));
  const wardSel = h('select', { 'aria-label': 'Ward' }, h('option', { value: '' }, 'No ward'), wards.map((w) => h('option', { value: w.id }, w.name)));
  const un = h('input', { type: 'text', autocapitalize: 'none', 'aria-label': 'Username' });
  const dn = h('input', { type: 'text', 'aria-label': 'Display name' });
  roleSel.value = 'ward';
  const showTemp = (title, username, pw) => (h('div', { class: 'notice good' }, h('b', null, `${title} ${username}. `), 'Temporary password, shown once: ', h('span', { class: 'mono' }, pw), '. They must change it at first sign-in.'));
  const create = async () => {
    const username = un.value.trim().toLowerCase();
    const role = roleSel.value;
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) { toast('Username: 3 to 40 letters, digits, dot, dash or underscore', true); return; }
    if (role === 'ward' && !wardSel.value) { toast('Choose the ward for a ward user', true); return; }
    if (rows.some((u) => u.username === username)) { toast('That username exists', true); return; }
    const pw = tempPassword();
    const email = emailFor(username);
    const uid = await createAuthUser(email, pw).catch((e) => { throw new Error(e.code === 'auth/email-already-in-use' ? 'That username is still in Firebase Auth. Delete it in the Firebase console first.' : e.message); });
    await setDoc(ref(`users/${uid}`), { username, email, name: dn.value.trim() || username, role, location: role === 'ward' ? wardSel.value : (wardSel.value || null), disabled: false, must_change: true, last_login: null, created: serverTimestamp() });
    auditLog('user.create', username, role);
    users(host, showTemp('Created', username, pw));
  };
  const setUser = async (u, data, action) => { await updateDoc(ref(`users/${u.id}`), data); auditLog(action, u.username); users(host); };
  clear(host,
    h('section', { class: 'card card-pad' }, h('p', { class: 'label' }, 'Add staff account'),
      field('Username', un), field('Name', dn), field('Role', roleSel), field('Ward (for ward users)', wardSel),
      h('button', { class: 'btn', type: 'button', onClick: () => create().catch(fail) }, icon('plus'), 'Create account')),
    revealed,
    h('section', { class: 'card' }, rows.map((u) => h('div', { class: 'user-row' },
      h('div', { class: 'row-between' },
        h('div', null, h('b', null, u.username), h('div', { class: 'sub' }, u.name)),
        h('div', { class: 'chips' }, h('span', { class: 'pill s-none' }, u.role || 'no role'), u.disabled ? h('span', { class: 'pill s-over' }, u.role ? 'Disabled' : 'Deleted') : null)),
      h('div', { class: 'sub' }, `${state.locMap.get(u.location)?.name || 'No ward'} · Last sign-in ${u.last_login?.toDate ? fmt.dateTime(u.last_login.toDate().toISOString()) : 'never'}`),
      u.role ? h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn ghost', type: 'button', onClick: () => clear(revealed, h('div', { class: 'notice' }, `To reset ${u.username}'s password, run on the admin computer: npm run cloud:admin -- reset-password ${u.username}. It prints a new temporary password.`)) }, 'Reset password'),
        u.id !== state.user.uid && roleSelect(u, (role) => setUser(u, { role }, 'user.role').catch((e) => { fail(e); users(host); })),
        u.id !== state.user.uid && h('button', { class: 'btn ghost', type: 'button', onClick: () => setUser(u, { disabled: !u.disabled }, u.disabled ? 'user.enable' : 'user.disable').catch(fail) }, u.disabled ? 'Enable' : 'Disable'),
        u.id !== state.user.uid && h('button', { class: 'btn danger', type: 'button', onClick: () => { if (confirm(`Delete ${u.username}? The account loses all access. Remove the sign-in itself in the Firebase console.`)) setUser(u, { disabled: true, role: deleteField(), location: deleteField() }, 'user.delete').catch(fail); } }, 'Delete'))
        : h('div', { class: 'sub' }, 'No access. Remove the sign-in in Firebase console > Authentication.'),
      u.id === state.user.uid && h('div', { class: 'sub' }, 'Your own role and access can only be changed by another admin, so there is always at least one admin.')))));
}

function roleSelect(u, onPick) {
  const sel = h('select', { 'aria-label': `Role of ${u.username}`, onChange: () => onPick(sel.value) }, ROLES.map((r) => h('option', { value: r }, r)));
  sel.value = u.role;
  return sel;
}

// Why a location cannot be deleted, or null when it was never used.
async function usedBecause(l) {
  if (state.locations.some((x) => x.parent_id === l.id)) return 'locations under it';
  if ((await getDoc(ref(`par/${l.id}`))).exists()) return 'a par (floor stock) list';
  if ((await getDoc(ref(`checkpoints/${l.id}`))).exists()) return 'a stock balance';
  if (!(await getDocs(query(collection(db(), 'movements'), where('locs', 'array-contains', l.id), limit(1)))).empty) return 'stock movements';
  if (!(await getDocs(query(collection(db(), 'users'), where('location', '==', l.id), limit(1)))).empty) return 'staff accounts assigned to it';
  return null;
}

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

async function locations(host) {
  const rows = state.locations;
  const name = h('input', { type: 'text', 'aria-label': 'Name' });
  const type = h('select', null, ['store', 'ward', 'shelf'].map((t) => h('option', { value: t }, t)));
  type.value = 'shelf';
  const parent = h('select', null, h('option', { value: '' }, 'No parent'), rows.filter((l) => l.type !== 'shelf').map((l) => h('option', { value: l.id }, l.name)));
  const save = async (path, value, action, target) => { await updateDoc(ref('catalog/locations'), new FieldPath('byId', ...path), value); auditLog(action, target); };
  const add = async () => {
    const nm = name.value.trim();
    const id = slug(parent.value ? `${parent.value}-${nm}` : nm);
    if (!nm || !id) throw new Error('Name is required');
    if (state.locMap.has(id)) throw new Error('A location with that name exists');
    if (type.value === 'shelf' && !parent.value) throw new Error('A shelf must be under a store or ward');
    await save([id], { id, name: nm.slice(0, 80), type: type.value, parent_id: parent.value || null, disabled: false, sort: 100 + rows.length }, 'location.add', id);
    locations(host);
  };
  const msg = h('div');
  clear(host, msg,
    h('div', { class: 'notice' }, 'Hospital Limbang stores and wards are preset. Add shelves or fridges under a store if you count stock there. Delete works only for a location that was never used; otherwise Disable it.'),
    h('section', { class: 'card card-pad' }, h('p', { class: 'label' }, 'Add location'), field('Name', name), field('Type', type), field('Under', parent),
      h('button', { class: 'btn', type: 'button', onClick: () => add().catch(fail) }, 'Add')),
    h('section', { class: 'card' }, h('ul', { class: 'list' }, rows.map((l) => {
      const nm = h('input', { type: 'text', value: l.name, 'aria-label': `Name of ${l.name}` });
      return h('li', { class: 'item' }, h('span', { class: 'pill' }, l.type), h('div', { class: 'grow' }, nm, h('div', { class: 'meta' }, l.parent_id ? `under ${state.locMap.get(l.parent_id)?.name}` : 'top level')),
        h('button', { class: 'btn ghost', type: 'button', onClick: () => (nm.value.trim() ? save([l.id, 'name'], nm.value.trim().slice(0, 80), 'location.rename', l.id).then(() => toast('Saved')) : Promise.reject(new Error('Name is required'))).catch(fail) }, 'Rename'),
        h('button', { class: 'btn ghost', type: 'button', onClick: () => save([l.id, 'disabled'], !l.disabled, 'location.disable', l.id).then(() => locations(host)).catch(fail) }, l.disabled ? 'Enable' : 'Disable'),
        h('button', { class: 'btn danger', type: 'button', title: 'Only for a location that was never used', onClick: () => remove(l).catch(fail) }, 'Delete'));
    }))));
  async function remove(was) {
    const l = state.locMap.get(was.id) || was; // the row may show a name renamed since it rendered
    const why = await usedBecause(l);
    if (why) { clear(msg, h('div', { class: 'notice warn' }, `${l.name} has ${why}, so it cannot be deleted. Use Disable: it is hidden from pickers and new movements, and its history and Kad Stok stay readable.`)); return; }
    if (!confirm(`Delete ${l.name}? This can't be undone.`)) return;
    await updateDoc(ref('catalog/locations'), new FieldPath('byId', l.id), deleteField(), 'deleted_last', l.id);
    auditLog('location.delete', l.id);
    toast(`Deleted ${l.name}`);
    locations(host);
  }
}

const stripKod = (mahal) => Object.fromEntries([...mahal].map(([k, { no_kod, ...m }]) => [k, m]));

// Each import computes the new data with the shared importers, then writes it. A version bump in meta/catalog
// tells every device to fetch the new formulary or par levels once.
async function write(kind, text, location, dryRun) {
  if (kind === 'master') {
    const { result, drugs } = importMaster(text, { drugs: state.drugMap });
    if (!dryRun) {
      const chunks = chunkDrugs(drugs);
      const old = await getDocs(collection(db(), 'formulary'));
      const b = writeBatch(db());
      const ids = chunks.map((_, i) => `c${String(i).padStart(3, '0')}`);
      chunks.forEach((items, i) => b.set(ref(`formulary/${ids[i]}`), { items }));
      for (const d of old.docs) if (!ids.includes(d.id)) b.delete(d.ref);
      b.set(ref('meta/catalog'), { formulary: increment(1) }, { merge: true });
      await b.commit();
    }
    return result;
  }
  if (kind === 'item-mahal' || kind === 'kuota-unit') {
    const { result, mahal } = kind === 'item-mahal' ? importItemMahal(text, { drugs: state.drugMap, mahal: state.mahal }) : importKuotaUnit(text, { mahal: state.mahal });
    if (!dryRun) await setDoc(ref('catalog/mahal'), { items: stripKod(mahal), updated: serverTimestamp() });
    return result;
  }
  if (kind === 'patients') {
    const { result, rows } = importPatients(text, { mahal: state.mahal, realAllowed: state.config.patientsRealAllowed === true });
    if (!dryRun && rows.length) {
      for (let i = 0; i < rows.length; i += 200) {
        await commit(rows.slice(i, i + 200).flatMap((r) => [
          setWrite(`patients/${r.id}`, { ...r.minimal, updated_by: state.user.username }), setWrite(`patient_identity/${r.id}`, r.identity)]));
      }
      await recountStats();
    }
    return result;
  }
  const r = importFloorStock(text, { drugs: state.drugMap, location });
  if (!dryRun) {
    const b = writeBatch(db());
    b.set(ref(`par/${location}`), { rows: r.rows.map(({ location: _, ...row }) => row), updated: serverTimestamp() });
    b.set(ref('meta/catalog'), { par: { [location]: increment(1) } }, { merge: true });
    await b.commit();
  }
  return r;
}

async function importTab(host) {
  const KINDS = [['master', 'Formulary (MASTER)'], ['item-mahal', 'Item Mahal'], ['kuota-unit', 'Kuota by unit'], ['patients', 'Pesakit (patients)'], ['floorstock', 'Floor stock list']];
  let kind = 'master';
  const area = h('textarea', { rows: 8, placeholder: 'Paste rows copied from Google Sheets (with the header row), or choose a CSV file below.', 'aria-label': 'Data to import' });
  const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt', 'aria-label': 'File to import' });
  const recount = h('button', { class: 'btn ghost', type: 'button', onClick: async () => { try { toast(`Recounted ${await recountStats()} patients`); } catch (e) { fail(e); } } }, 'Recount quota use');
  const loc = h('select', { 'aria-label': 'Ward or unit' }, locationOptions().filter((l) => l.type !== 'shelf').map((l) => h('option', { value: l.id }, l.label)));
  const locField = field('Ward or unit this list belongs to', loc);
  const out = h('div');
  const setKind = (v) => {
    kind = v; file.value = ''; clear(out);
    const fs = kind === 'floorstock';
    locField.classList.toggle('hidden', !fs);
    file.accept = fs ? '.txt' : '.csv,.tsv,.txt';
    area.placeholder = fs ? 'Paste the text of the unit\'s "Senarai Floor Stock" PDF (pdftotext -layout). PDFs themselves go through npm run seed:cloud.' : 'Paste rows copied from Google Sheets (with the header row), or choose a CSV file below.';
  };
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    area.value = await f.text();
  });
  const run = async (dryRun) => {
    try {
      if (!dryRun && !navigator.onLine) throw new Error('Importing needs a connection.');
      const r = await write(kind, area.value, loc.value, dryRun);
      if (!dryRun) auditLog(`import.${kind}`, kind === 'floorstock' ? loc.value : null, `${r.added} added, ${r.updated} updated, ${r.skipped} skipped`);
      const summary = kind === 'floorstock'
        ? `${r.parsed} rows read, ${r.matched} matched to the formulary, ${r.unmatched.length} unmatched. Replaces this unit's par levels.`
        : `${r.added} new, ${r.updated} updated, ${r.skipped} skipped.`;
      clear(out, h('div', { class: `notice ${r.errors.length || r.unmatched?.length ? 'warn' : 'good'}` }, h('b', null, dryRun ? 'Dry run, nothing saved. ' : 'Imported. '), summary,
        r.errors.slice(0, 15).map((e) => h('div', null, `Line ${e.line}: ${e.message}`)),
        (r.unmatched || []).slice(0, 30).map((x) => h('div', null, `Unmatched: ${x.name} (${x.max ?? '-'} ${x.unit})`)),
        (r.review || []).filter((x) => x.match === 'low').slice(0, 30).map((x) => h('div', null, `Check: ${x.name} → ${state.drugMap.get(x.drug)?.perihal || x.drug} (${x.score})`))));
      if (!dryRun) { area.value = ''; file.value = ''; }
    } catch (e) { clear(out, h('div', { class: 'notice bad' }, e.message)); }
  };
  setKind(kind);
  clear(host,
    h('div', { class: 'notice' }, 'Import in this order: MASTER, Item Mahal, Kuota by unit, then Pesakit. Re-importing the same rows updates them and never duplicates. Always do a dry run first. This trial project accepts only DEMO PATIENT rows (IC 000000-00-xxxx); real patients are refused until the project is approved for patient data. A floor stock list replaces that unit\'s par levels; stock balances are not changed.'),
    h('section', { class: 'card card-pad stack' }, chips(KINDS, kind, setKind), locField, area, file, h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn ghost', type: 'button', onClick: () => run(true) }, 'Dry run'), h('button', { class: 'btn', type: 'button', onClick: () => run(false) }, 'Import'), recount)), out);
}

async function audit(host) {
  const snap = await getDocs(query(collection(db(), 'audit'), orderBy('ts', 'desc'), limit(200)));
  const entries = snap.docs.map((d) => ({ ...d.data(), ts: d.data().ts?.toDate?.().toISOString() }));
  clear(host, h('section', { class: 'card scroll-x' }, h('table', null,
    h('thead', null, h('tr', null, ['Time', 'User', 'Action', 'Target', 'Detail'].map((t) => h('th', null, t)))),
    h('tbody', null, entries.map((e) => h('tr', null, h('td', { class: 'mono' }, fmt.dateTime(e.ts)), h('td', null, e.username || '-'), h('td', null, e.action), h('td', { class: 'mono' }, (e.target || '').slice(0, 24)), h('td', null, e.detail || '')))))));
}
