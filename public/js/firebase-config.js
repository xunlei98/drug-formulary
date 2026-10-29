// Public web config of the Firebase project. Safe to commit: access is controlled by Auth and firestore.rules.
// To move the app to another project (for example the MOH work account), replace this object and
// run `npx firebase use --add` (see docs/deploy.md).
export const firebaseConfig = {
  apiKey: 'AIzaSyA5Uz-Vg76xTGp7a6R58EoFHA6kWf3N-bM',
  authDomain: 'limbang-formulary.firebaseapp.com',
  projectId: 'limbang-formulary',
  storageBucket: 'limbang-formulary.firebasestorage.app',
  messagingSenderId: '51090716313',
  appId: '1:51090716313:web:e6c6b9faade19f5793aa08',
};

// Usernames without "@" sign in as username@EMAIL_DOMAIN. Firebase never sends mail to these addresses.
export const EMAIL_DOMAIN = 'staff.formulary.local';
