import { h, icon, clear, fmt } from '../dom.js';
import { state, refresh } from '../store.js';
import { get, post, patch, del } from '../api.js';
import { chips, toast } from '../ui.js';
import { ROLES } from '/shared/perm.js';

const field = (label, node) => h('label', { class: 'field' }, h('span', null, label), node);
const fail = (e) => toast(e.offline ? 'Needs a connection' : e.message, true);

export function admin(_, query) {
  let tab = query.get('tab') || 'users';
  const host = h('div', { class: 'stack' });
  const tabs = chips([['users', 'Users'], ['locations', 'Locations'], ['import', 'Import'], ['audit', 'Audit']], tab, (v) => { tab = v; show(); });
  const show = () => ({ users, locations, import: importTab, audit }[tab])(host).catch(fail);
  show();
  return { el: h('div', null, tabs, host), title: 'Admin' };
}

async function users(host) {
  const { users: rows } = await get('/api/users');
  const wards = state.locations.filter((l) => l.type === 'ward' && !l.disabled);
  const revealed = h('div');
  const f = { username: '', display_name: '', role: 'ward', location_id: '' };
  const roleSel = h('select', { 'aria-label': 'Role' }, ROLES.map((r) => h('option', { value: r }, r)));
  const wardSel = h('select', { 'aria-label': 'Ward' }, h('option', { value: '' }, 'No ward'), wards.map((w) => h('option', { value: w.id }, w.name)));
  const un = h('input', { type: 'text', autocapitalize: 'none', 'aria-label': 'Username' });
  const dn = h('input', { type: 'text', 'aria-label': 'Display name' });
  roleSel.value = 'ward';
  const showTemp = (title, username, pw) => clear(revealed, h('div', { class: 'notice good' }, h('b', null, `${title} ${username}. `), 'Temporary password, shown once: ', h('span', { class: 'mono' }, pw), '. They must change it at first sign-in.'));
  clear(host,
    h('section', { class: 'card card-pad' }, h('p', { class: 'label' }, 'Add staff account'),
      field('Username', un), field('Name', dn), field('Role', roleSel), field('Ward (for ward users)', wardSel),
      h('button', { class: 'btn', type: 'button', onClick: async () => {
        try {
          const r = await post('/api/users', { username: un.value.trim(), display_name: dn.value.trim(), role: roleSel.value, location_id: wardSel.value || null });
          showTemp('Created', r.username, r.tempPassword); users(host);
        } catch (e) { fail(e); }
      } }, icon('plus'), 'Create account')),
    revealed,
    h('section', { class: 'card scroll-x' }, h('table', null,
      h('thead', null, h('tr', null, ['User', 'Role', 'Ward', 'Last sign-in', ''].map((t) => h('th', null, t)))),
      h('tbody', null, rows.map((u) => h('tr', null,
        h('td', null, h('b', null, u.username), h('div', { class: 'sub' }, u.display_name), u.disabled ? h('span', { class: 'pill s-none' }, 'Disabled') : null),
        h('td', null, u.role), h('td', null, state.locMap.get(u.location_id)?.name || '-'), h('td', null, u.last_login ? fmt.dateTime(u.last_login) : 'Never'),
        h('td', null, h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn ghost', type: 'button', onClick: async () => { try { showTemp('Password reset for', u.username, (await post(`/api/users/${u.id}/reset-password`)).tempPassword); } catch (e) { fail(e); } } }, 'Reset password'),
          h('button', { class: 'btn ghost', type: 'button', onClick: async () => { try { await patch(`/api/users/${u.id}`, { disabled: u.disabled ? 0 : 1 }); users(host); } catch (e) { fail(e); } } }, u.disabled ? 'Enable' : 'Disable'),
          h('button', { class: 'btn danger', type: 'button', onClick: async () => { if (confirm(`Delete ${u.username}?`)) { try { await del(`/api/users/${u.id}`); users(host); } catch (e) { fail(e); } } } }, 'Delete')))))))));
}

async function locations(host) {
  const rows = (await get('/api/locations')).locations;
  const f = { name: '', type: 'shelf', parent_id: '' };
  const name = h('input', { type: 'text', 'aria-label': 'Name' });
  const type = h('select', null, ['store', 'ward', 'shelf'].map((t) => h('option', { value: t }, t)));
  type.value = 'shelf';
  const parent = h('select', null, h('option', { value: '' }, 'No parent'), rows.filter((l) => l.type !== 'shelf').map((l) => h('option', { value: l.id }, l.name)));
  clear(host,
    h('div', { class: 'notice warn' }, 'Seeded locations are EXAMPLES. Rename or disable them to match the real stores, wards and racks.'),
    h('section', { class: 'card card-pad' }, h('p', { class: 'label' }, 'Add location'), field('Name', name), field('Type', type), field('Under', parent),
      h('button', { class: 'btn', type: 'button', onClick: async () => { try { await post('/api/locations', { name: name.value, type: type.value, parent_id: parent.value || null }); await refresh(); locations(host); } catch (e) { fail(e); } } }, 'Add')),
    h('section', { class: 'card' }, h('ul', { class: 'list' }, rows.map((l) => {
      const nm = h('input', { type: 'text', value: l.name, 'aria-label': `Name of ${l.name}` });
      return h('li', { class: 'item' }, h('span', { class: 'pill' }, l.type), h('div', { class: 'grow' }, nm, h('div', { class: 'meta' }, l.parent_id ? `under ${rows.find((x) => x.id === l.parent_id)?.name}` : 'top level')),
        h('button', { class: 'btn ghost', type: 'button', onClick: async () => { try { await patch(`/api/locations/${l.id}`, { name: nm.value }); await refresh(); toast('Saved'); } catch (e) { fail(e); } } }, 'Rename'),
        h('button', { class: 'btn ghost', type: 'button', onClick: async () => { try { await patch(`/api/locations/${l.id}`, { disabled: l.disabled ? 0 : 1 }); await refresh(); locations(host); } catch (e) { fail(e); } } }, l.disabled ? 'Enable' : 'Disable'));
    }))));
}

async function importTab(host) {
  const KINDS = [['master', 'Formulary (MASTER)'], ['item-mahal', 'Item Mahal'], ['kuota-unit', 'Kuota by unit'], ['patients', 'Pesakit (patients)']];
  let kind = 'master';
  const area = h('textarea', { rows: 8, placeholder: 'Paste rows copied from Google Sheets (with the header row), or choose a CSV file below.', 'aria-label': 'Data to import' });
  const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt', 'aria-label': 'CSV file' });
  const out = h('div');
  file.addEventListener('change', async () => { if (file.files[0]) area.value = await file.files[0].text(); });
  const run = async (dryRun) => {
    try {
      const r = await post(`/api/import/${kind}`, { text: area.value, dryRun });
      clear(out, h('div', { class: `notice ${r.errors.length ? 'warn' : 'good'}` }, h('b', null, r.dryRun ? 'Dry run, nothing saved. ' : 'Imported. '), `${r.added} new, ${r.updated} updated, ${r.skipped} skipped.`,
        r.errors.slice(0, 15).map((e) => h('div', null, `Line ${e.line}: ${e.message}`))));
      if (!dryRun) { area.value = ''; await refresh(); }
    } catch (e) { clear(out, h('div', { class: 'notice bad' }, e.message)); }
  };
  clear(host,
    h('div', { class: 'notice' }, 'Import in this order: MASTER, Item Mahal, Kuota by unit, then Pesakit. Re-importing the same rows updates them and never duplicates. Always do a dry run first. Patient rows are real personal data: only import on an approved server.'),
    h('section', { class: 'card card-pad stack' }, chips(KINDS, kind, (v) => { kind = v; clear(out); }), area, file, h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn ghost', type: 'button', onClick: () => run(true) }, 'Dry run'), h('button', { class: 'btn', type: 'button', onClick: () => run(false) }, 'Import'))), out);
}

async function audit(host) {
  const { entries } = await get('/api/audit');
  clear(host, h('section', { class: 'card scroll-x' }, h('table', null,
    h('thead', null, h('tr', null, ['Time', 'User', 'Action', 'Target', 'Detail'].map((t) => h('th', null, t)))),
    h('tbody', null, entries.map((e) => h('tr', null, h('td', { class: 'mono' }, fmt.dateTime(e.ts)), h('td', null, e.username || '-'), h('td', null, e.action), h('td', { class: 'mono' }, (e.target || '').slice(0, 12)), h('td', null, e.detail || '')))))));
}
