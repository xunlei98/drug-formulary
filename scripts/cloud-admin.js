// Account tasks the web app cannot do without Cloud Functions.
//   node scripts/cloud-admin.js create-admin <username> [--name "Full Name"] [--yes]
//   node scripts/cloud-admin.js reset-password <username> [--yes]
//   node scripts/cloud-admin.js delete-auth <username> [--yes]   (removes the sign-in; the users doc stays, disabled)
// Passwords are generated, printed once, and must be changed at first sign-in. None are stored or hardcoded.
import { init, arg, emailFor, tempPassword } from './admin-init.js';

const [cmd, username] = process.argv.slice(2);
if (!['create-admin', 'reset-password', 'delete-auth'].includes(cmd) || !username || username.startsWith('--')) {
  console.error('Usage: node scripts/cloud-admin.js create-admin|reset-password|delete-auth <username> [--name "Full Name"] [--yes]');
  process.exit(2);
}
const { db, auth, FieldValue } = init();
const email = emailFor(username);

if (cmd === 'create-admin') {
  const pw = tempPassword();
  const u = await auth.createUser({ email, password: pw });
  await db.doc(`users/${u.uid}`).set({
    username: username.toLowerCase(), email, name: arg('name', username), role: 'admin', location: null,
    disabled: false, must_change: true, last_login: null, created: FieldValue.serverTimestamp(),
  });
  console.log(`Created admin ${username}. Temporary password (shown once): ${pw}`);
} else {
  const u = await auth.getUserByEmail(email);
  if (cmd === 'reset-password') {
    const pw = tempPassword();
    await auth.updateUser(u.uid, { password: pw });
    await auth.revokeRefreshTokens(u.uid);
    await db.doc(`users/${u.uid}`).update({ must_change: true });
    console.log(`New temporary password for ${username} (shown once): ${pw}`);
  } else {
    await db.doc(`users/${u.uid}`).set({ disabled: true, role: FieldValue.delete(), location: FieldValue.delete() }, { merge: true });
    await auth.deleteUser(u.uid);
    console.log(`Deleted the sign-in for ${username}. Its users document stays, disabled, for the audit trail.`);
  }
}
