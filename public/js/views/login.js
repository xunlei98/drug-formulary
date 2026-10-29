import { h, icon, clear } from '../dom.js';
import { post } from '../api.js';

const field = (label, node) => h('label', { class: 'field' }, h('span', null, label), node);

export function loginScreen({ message, onDone }) {
  const un = h('input', { type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', required: true });
  const pw = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const msg = h('div', { 'aria-live': 'polite' }, message && h('div', { class: 'notice warn' }, message));
  const go = h('button', { class: 'btn block', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'login' },
    h('div', { class: 'logo' }, icon('stock')),
    h('h1', null, 'Hospital Limbang Formulary'),
    h('p', { class: 'sub' }, 'Staff only. Accounts are created by the pharmacy administrator.'),
    h('div', { class: 'section' }),
    field('Username', un), field('Password', pw), msg, go);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true;
    try {
      onDone(await post('/api/login', { username: un.value.trim(), password: pw.value }));
    } catch (err) {
      pw.value = '';
      clear(msg, h('div', { class: 'notice bad' }, err.offline ? 'No connection. Signing in needs the network.' : err.message));
    } finally { go.disabled = false; }
  });
  return form;
}

export function changePasswordForm({ forced, onDone, onCancel }) {
  const cur = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Current password' });
  const n1 = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'New password' });
  const n2 = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'Repeat new password' });
  const msg = h('div', { 'aria-live': 'polite' });
  const form = h('form', { class: 'stack' },
    h('h2', null, forced ? 'Choose a new password' : 'Change password'),
    forced && h('p', { class: 'sub' }, 'This is your first sign-in, or your password was reset. Use at least 10 characters. Avoid common words and your username.'),
    field('Current (temporary) password', cur), field('New password', n1), field('Repeat new password', n2), msg,
    h('button', { class: 'btn block', type: 'submit' }, 'Save password'),
    onCancel && h('button', { class: 'btn ghost block', type: 'button', onClick: onCancel }, 'Cancel'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (n1.value !== n2.value) { clear(msg, h('div', { class: 'notice bad' }, 'The two new passwords differ.')); return; }
    try { await post('/api/password', { current: cur.value, next: n1.value }); onDone(); } catch (err) { clear(msg, h('div', { class: 'notice bad' }, err.offline ? 'Needs a connection.' : err.message)); }
  });
  return form;
}
