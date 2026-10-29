import { h, icon, clear } from '../dom.js';
import { auth, emailFor } from '../fb.js';
import { signInWithEmailAndPassword, reauthenticateWithCredential, updatePassword, EmailAuthProvider } from '/vendor/firebase.js';
import { passwordProblem } from '/shared/common-passwords.js';

const AUTH_ERRORS = {
  'auth/invalid-credential': 'Wrong username or password.', 'auth/wrong-password': 'Wrong username or password.', 'auth/user-not-found': 'Wrong username or password.',
  'auth/invalid-email': 'Wrong username or password.', 'auth/user-disabled': 'This account is disabled.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.', 'auth/network-request-failed': 'No connection. This needs the network.',
  'auth/weak-password': 'Password is too weak.', 'auth/requires-recent-login': 'Sign in again, then change the password.',
};
export const authMessage = (e) => AUTH_ERRORS[e.code] || e.message;

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
      onDone();
      await signInWithEmailAndPassword(auth, emailFor(un.value.trim()), pw.value);
    } catch (err) {
      pw.value = '';
      clear(msg, h('div', { class: 'notice bad' }, authMessage(err)));
    } finally { go.disabled = false; }
  });
  return form;
}

export function changePasswordForm({ forced, username = '', onDone, onCancel }) {
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
    const problem = passwordProblem(n1.value, username);
    if (problem) { clear(msg, h('div', { class: 'notice bad' }, problem)); return; }
    try {
      const u = auth.currentUser;
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, cur.value));
      await updatePassword(u, n1.value);
      await onDone();
    } catch (err) { clear(msg, h('div', { class: 'notice bad' }, authMessage(err))); }
  });
  return form;
}
