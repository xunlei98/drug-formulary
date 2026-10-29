import { h, icon, clear } from '../dom.js';
import { state, can_, pendingFor } from '../store.js';
import { changePasswordForm } from './login.js';
import { toast } from '../ui.js';

export function more({ onLogout }) {
  const pw = h('div');
  const link = (href, ic, text, note) => h('li', null, h('a', { class: 'item', href }, icon(ic), h('div', { class: 'grow' }, h('div', { class: 'name' }, text), note && h('div', { class: 'meta' }, note)), icon('chevron')));
  const pending = pendingFor().length;
  const el = h('div', { class: 'stack' },
    h('section', { class: 'card card-pad' }, h('p', { class: 'label' }, 'Signed in'),
      h('div', { class: 'name' }, state.user.display_name || state.user.username),
      h('div', { class: 'sub' }, `${state.user.username} · ${state.user.role}${state.user.location_id ? ` · ${state.locMap.get(state.user.location_id)?.name || ''}` : ''}`)),
    h('section', { class: 'card' }, h('ul', { class: 'list' },
      link('#/sync', 'sync', 'Sync status', pending ? `${pending} waiting` : 'All synced'),
      can_('stock.review') && link('#/review', 'flag', 'Stock review', 'Balances flagged after offline sync'),
      can_('user.manage') && link('#/admin', 'users', 'Admin', 'Users, locations, import, audit'))),
    pw,
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn ghost', type: 'button', onClick: () => clear(pw, h('section', { class: 'card card-pad' }, changePasswordForm({ forced: false, username: state.user.username, onDone: () => { clear(pw); toast('Password changed'); }, onCancel: () => clear(pw) }))) }, icon('lock'), 'Change password'),
      h('button', { class: 'btn danger', type: 'button', onClick: () => {
        if (pending && !confirm(`${pending} movement(s) are still waiting to sync on this device. They stay saved, but only sync when you sign in again. Sign out anyway?`)) return;
        onLogout();
      } }, icon('out'), 'Sign out')),
    h('p', { class: 'sub' }, can_('patient.view') ? 'Patient records you open are cached as initials and last 4 digits of IC only. Names and full IC are never stored. Signing out or idle lock wipes the cache.' : 'No patient data is kept on this device.'));
  return { el, title: 'Account' };
}
