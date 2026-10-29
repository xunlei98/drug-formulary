// Account tasks the web app cannot do without Cloud Functions.
//   node scripts/cloud-admin.js create-admin <username> [--name "Full Name"] [--yes]
//   node scripts/cloud-admin.js create-user <username> --role admin|pharmacist|ward [--location <id>] [--name "Full Name"] [--yes]
//   node scripts/cloud-admin.js reset-password <username> [--yes]
//   node scripts/cloud-admin.js delete-auth <username> [--yes]   (removes the sign-in; the users doc stays, disabled)
// Passwords are generated, printed once (or appended to --password-file <path>, mode 600, and not printed),
// and must be changed at first sign-in. None are stored in the repo or hardcoded.
import fs from 'node:fs';
import { init, arg, emailFor, tempPassword } from './admin-init.js';

function reveal(label, username, pw) {
  const file = arg('password-file');
  if (!file) return console.log(`${label} (shown once): ${pw}`);
  fs.appendFileSync(file, `${username} temporary: ${pw}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  console.log(`${label}: written to ${file}`);
}

const [cmd, username] = process.argv.slice(2);
if (!['create-admin', 'create-user', 'reset-password', 'delete-auth'].includes(cmd) || !username || username.startsWith('--')) {
  console.error('Usage: node scripts/cloud-admin.js create-admin|create-user|reset-password|delete-auth <username> [--role r] [--location id] [--name "Full Name"] [--password-file path] [--yes]');
  process.exit(2);
}
const { db, auth, FieldValue } = init();
const email = emailFor(username);

if (cmd === 'create-admin' || cmd === 'create-user') {
  const role = cmd === 'create-admin' ? 'admin' : arg('role');
  const location = arg('location');
  if (!['admin', 'pharmacist', 'ward'].includes(role)) { console.error('--role must be admin, pharmacist or ward'); process.exit(2); }
  if (role === 'ward') {
    const locs = (await db.doc('catalog/locations').get()).data()?.byId || {};
    if (!locs[location]) { console.error(`A ward user needs --location <id> from catalog/locations (got ${location}).`); process.exit(2); }
  }
  const pw = tempPassword();
  const u = await auth.createUser({ email, password: pw });
  await db.doc(`users/${u.uid}`).set({
    username: username.toLowerCase(), email, name: arg('name', username), role, location: role === 'ward' ? location : null,
    disabled: false, must_change: true, last_login: null, created: FieldValue.serverTimestamp(),
  });
  reveal(`Created ${role} ${username}. Temporary password`, username, pw);
} else {
  const u = await auth.getUserByEmail(email);
  if (cmd === 'reset-password') {
    const pw = tempPassword();
    await auth.updateUser(u.uid, { password: pw });
    await auth.revokeRefreshTokens(u.uid);
    await db.doc(`users/${u.uid}`).update({ must_change: true });
    reveal(`New temporary password for ${username}`, username, pw);
  } else {
    await db.doc(`users/${u.uid}`).set({ disabled: true, role: FieldValue.delete(), location: FieldValue.delete() }, { merge: true });
    await auth.deleteUser(u.uid);
    console.log(`Deleted the sign-in for ${username}. Its users document stays, disabled, for the audit trail.`);
  }
}
