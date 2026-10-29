// The only Firebase SDK functions the app uses. Bundled to public/vendor/firebase.js by scripts/build.js.
export { initializeApp, deleteApp } from 'firebase/app';
export {
  initializeAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  sendPasswordResetEmail, indexedDBLocalPersistence, inMemoryPersistence,
} from 'firebase/auth';
export {
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager,
  terminate, clearIndexedDbPersistence, enableNetwork, disableNetwork, waitForPendingWrites,
  doc, collection, query, where, orderBy, limit, documentId, getDoc, getDocs, getDocFromServer, getDocsFromServer,
  setDoc, updateDoc, writeBatch, onSnapshot, serverTimestamp, increment, deleteField, Timestamp, FieldPath,
} from 'firebase/firestore';
