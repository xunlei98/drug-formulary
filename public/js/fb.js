// Firebase setup: one app, Auth kept in IndexedDB, Firestore with a persistent multi-tab cache.
// On localhost the app talks to the Emulator Suite under a demo project, never to the real project.
import {
  initializeApp, deleteApp, initializeAuth, connectAuthEmulator, indexedDBLocalPersistence, inMemoryPersistence,
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager, terminate, clearIndexedDbPersistence,
  createUserWithEmailAndPassword, signOut,
} from '/vendor/firebase.js';
import { firebaseConfig, EMAIL_DOMAIN } from './firebase-config.js';

export const EMULATOR = ['localhost', '127.0.0.1'].includes(location.hostname);
const config = EMULATOR ? { ...firebaseConfig, projectId: 'demo-limbang-formulary', apiKey: 'demo-key' } : firebaseConfig;
export const PROJECT_ID = config.projectId;
export const FIRESTORE_ORIGIN = EMULATOR ? `http://${location.hostname}:8080` : 'https://firestore.googleapis.com';

export const app = initializeApp(config);
export const auth = initializeAuth(app, { persistence: indexedDBLocalPersistence });
if (EMULATOR) connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });

const cacheOptions = () => ({ localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
let firestore = null;
export function db() {
  if (!firestore) {
    firestore = initializeFirestore(app, cacheOptions());
    if (EMULATOR) connectFirestoreEmulator(firestore, location.hostname, 8080);
  }
  return firestore;
}

// Removes every cached document and queued SDK write from this device. Our own outbox mirror keeps unsynced movements.
// clearIndexedDbPersistence needs a Firestore instance that has not started, so terminate, then use a fresh one.
export async function wipeCache() {
  if (firestore) await terminate(firestore);
  const fresh = initializeFirestore(app, cacheOptions());
  firestore = null;
  try { await clearIndexedDbPersistence(fresh); return true; } catch (e) { console.warn('cache not cleared:', e.message); return false; } finally { await terminate(fresh); }
}

export const emailFor = (username) => (username.includes('@') ? username : `${username}@${EMAIL_DOMAIN}`).toLowerCase();

// Creates an Auth account without signing the admin out: a second app with in-memory auth does the signup.
export async function createAuthUser(email, password) {
  const second = initializeApp(config, `admin-create-${Date.now()}`);
  try {
    const a2 = initializeAuth(second, { persistence: inMemoryPersistence });
    if (EMULATOR) connectAuthEmulator(a2, `http://${location.hostname}:9099`, { disableWarnings: true });
    const cred = await createUserWithEmailAndPassword(a2, email, password);
    await signOut(a2);
    return cred.user.uid;
  } finally { await deleteApp(second); }
}
