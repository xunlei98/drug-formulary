// Admin SDK setup shared by the seed and account scripts.
// Cloud: needs GOOGLE_APPLICATION_CREDENTIALS pointing at a service account key kept outside the repo.
// Emulators: set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST instead; no credential is used.
import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

export const root = path.resolve(import.meta.dirname, '..');

export function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
export const flag = (name) => process.argv.includes(`--${name}`);

export const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;

export function projectId() {
  const rc = JSON.parse(fs.readFileSync(path.join(root, '.firebaserc'), 'utf8'));
  return arg('project') || process.env.FIREBASE_PROJECT || (EMULATOR ? 'demo-limbang-formulary' : rc.projects.default);
}

export function init() {
  const id = projectId();
  if (!EMULATOR && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the service account key file (see docs/deploy.md, "Credential").');
    process.exit(2);
  }
  if (!EMULATOR && !flag('yes')) {
    console.error(`This writes to the REAL Firebase project "${id}". Re-run with --yes to confirm.`);
    process.exit(2);
  }
  if (EMULATOR) process.env.GOOGLE_CLOUD_PROJECT = id;
  const app = initializeApp(EMULATOR ? { projectId: id } : { projectId: id, credential: applicationDefault() });
  return { id, db: getFirestore(app), auth: getAuth(app), FieldValue };
}

export const EMAIL_DOMAIN = 'staff.formulary.local';
export const emailFor = (u) => (u.includes('@') ? u : `${u}@${EMAIL_DOMAIN}`).toLowerCase();

export function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(14)), (n) => abc[n % abc.length]).join('');
}
