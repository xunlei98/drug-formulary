# Deploy on Firebase (Spark, free)

The app is a static PWA on Firebase Hosting. Data is in Cloud Firestore (asia-southeast1). Sign-in is Firebase Auth (email and password). There is no server code: every check is in `firestore.rules`, so the project stays on the free Spark plan. **Never upgrade the plan.** Spark has no Cloud Functions and no scheduled backups, and the app needs neither.

## What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| App shell (HTML, JS, CSS, fonts) | Firebase Hosting | CSP, nosniff, no-referrer headers in `firebase.json`. The service worker caches the shell only. |
| Formulary, Item Mahal, Kuota, locations, par levels | Firestore, read by all staff | Chunked docs, version-gated through `meta/catalog`, copied into the device's own IndexedDB. |
| Movements | Firestore, one doc each, create-only | Client picks the id, so an offline retry cannot duplicate. Balances are computed on the device. |
| Patients | `patients` (minimal: initials, last 4 IC) and `patient_identity` (name, IC) | Identity is read over REST with no-store, never listened to and never cached. |
| Accounts | Firebase Auth + `users/{uid}` (role, ward, disabled) | Admin creates accounts in the app. |

## One-time setup on the admin PC

1. Install Node 20 and run `npm install` in this folder.
2. Sign in the Firebase CLI as a project owner: `npx firebase login` (opens a browser).
3. Credential for the seed and account scripts (the simpler route; no extra tools needed):
   Firebase console > Project settings (gear) > **Service accounts** > **Generate new private key** > Generate key.
   Save the JSON file **outside this folder**, for example `C:\keys\limbang-formulary.json` or `~/keys/limbang-formulary.json`. Never commit, email or upload it.
   Then, in the terminal you run the scripts from:
   - macOS/Linux: `export GOOGLE_APPLICATION_CREDENTIALS=~/keys/limbang-formulary.json`
   - Windows PowerShell: `$env:GOOGLE_APPLICATION_CREDENTIALS="C:\keys\limbang-formulary.json"`
   (The other route, `gcloud auth application-default login`, needs the Google Cloud SDK installed. The key file is simpler.)
   Delete the key in the same console page when the trial ends or if it may have leaked.

## Deploy

`npm run deploy` needs either `npx firebase login` as a project owner, or `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service account that has these roles (IAM & Admin > IAM): **Service Usage Consumer** (firebase-tools checks the APIs first; without it every deploy stops with `403 Permission denied to get service`), **Firebase Hosting Admin**, **Firebase Rules Admin**, **Cloud Datastore Index Admin**. The default `firebase-adminsdk` key has none of the first two, so with it the deploy fails before uploading anything. It is enough for the seed and account scripts.

```
npm run deploy          # firestore.rules + firestore.indexes.json + Hosting (builds first)
```

The site is then at https://limbang-formulary.web.app.

## Seed the trial data

Export the sheets as CSV into a folder outside the repo (`master.csv`, `item-mahal.csv`, `kuota.csv`) with the floor stock PDFs in `floorstock/<Ward name>.pdf` (needs `pdftotext` from poppler-utils; `.txt` from `pdftotext -layout` also works).

```
npm run seed:cloud -- --data /path/to/data --yes
npm run cloud:admin -- create-admin alvin --name "Alvin Lim" --yes
```

The seed writes the formulary, Item Mahal, Kuota by unit, the 19 locations, par levels, `config/app`, and 24 **DEMO** patients. It is safe to run again: it overwrites the same documents and bumps the catalog version, so devices download the new catalog once. `create-admin` prints a temporary password once; it must be changed at first sign-in. Nothing in this repo holds a password.

Without `--yes` both scripts refuse to touch a real project.

## Patient data: PATIENTS_REAL_ALLOWED

Default `false`. With it false, the seed and the in-app importer accept only `DEMO PATIENT nnn` rows with IC `000000-00-nnnn` and refuse everything else. Reason: real names and IC numbers need MOH data-governance and PDPA approval before they go to any cloud project, and this trial project is on a personal Google account. Only after approval, and after the project has moved to the MOH account, set `PATIENTS_REAL_ALLOWED=true` for the seed run (`config/app.patientsRealAllowed` follows it and unlocks the in-app importer).

## Accounts

- Admin > Users creates staff (a second Firebase app instance does the sign-up, so the admin stays signed in). The temporary password is shown once.
- "Delete" removes the role and ward and sets `disabled`. The account then gets nothing: rules check `users/{uid}` on every read and write, and the app signs a disabled user out at once. To remove the sign-in itself: Firebase console > Authentication > Users > ⋮ > Delete account, or `npm run cloud:admin -- delete-auth <username> --yes`.
- Password reset needs admin rights the browser does not have: `npm run cloud:admin -- reset-password <username> --yes`.
- More accounts from the terminal: `npm run cloud:admin -- create-user demo.ward --role ward --location male-ward --name "Demo Ward" --yes`. Add `--password-file <path>` to append the temporary password to a file (mode 600) instead of printing it.
- First admin: `cloud:admin create-admin` above. Console alternative: Authentication > Add user (email `alvin@staff.formulary.local`), then Firestore > `users/<that UID>` with `username`, `email`, `name` strings, `role: "admin"`, `location: null`, `disabled: false`, `must_change: true`.
- Usernames without `@` sign in as `<username>@staff.formulary.local`. No mail is ever sent to these.

## Moving to the MOH work account

1. Create the project there (Spark), enable Email/Password Auth and Firestore in asia-southeast1, add a Web app.
2. Put its web config in `public/js/firebase-config.js`.
3. `npx firebase use --add` (alias e.g. `moh`), or set `FIREBASE_PROJECT=<id>` for `npm run deploy`. The scripts take `--project <id>` or `FIREBASE_PROJECT`.
4. New service account key from the new project, then deploy, seed and create the first admin as above.

## Daily read estimate (~100 staff)

Assumptions: 15 pharmacists/admins and 85 ward staff, each opening the app 4 times a day after the cache went stale, about 300 movements a day.

| What | Reads/day |
| --- | --- |
| Ward opens: 6 small docs + own checkpoint + own-ward movements since it (~40 per open × 340) | 13,600 |
| Pharmacist opens: 6 docs + 19 checkpoints + at most ~200 movements (~230 × 60) | 13,800 |
| Live movement fan-out (each new movement reaches ~13 open listeners) | 3,900 |
| One catalog update that day (6 formulary chunks + par docs, once per device) | 2,100 |
| Patients, drug-first (~40 reads per drug viewed, 75 views) | 3,000 |
| Rule lookups (each query or write re-reads `users/{uid}`, and `config/app` or `catalog/locations` where needed; ~10 per open, ~3 per write) | 5,000 |
| **Total** | **~41,000 of 50,000** |

Writes stay under 2,000 a day (limit 20,000); storage is a few MB (limit 1 GB). What would break the budget: frequent "All drugs" patient lists (one read per patient each time), many re-imports of the formulary in one day, or far more than 100 daily users. Firebase console > Usage shows real numbers. The quota resets at midnight Pacific time (15:00 or 16:00 Malaysia time). If a limit is hit, reads fail until then; the app keeps working offline from the device cache and syncs after.

## Backups

Spark has no scheduled backups, and managed Firestore export needs the paid plan, so there are none in the cloud. The catalog (formulary, Item Mahal, Kuota, par) can always be re-seeded from the Google Sheets and PDFs. Movements and patient records exist only in Firestore. That is acceptable for a trial; before live use, move to the MOH account on a plan with backups, or add an Admin SDK export script run by hand.

## Local development and tests

```
npm test               # unit tests
npm run test:rules     # rules, every role, Firestore emulator (needs Java 11+)
npm run test:e2e       # headless Chrome against the Auth + Firestore emulators (needs Chrome; CHROME_PATH)
npm run emulators      # in one terminal
npm run seed:emulator -- --data /path/to/data
npm run admin:emulator -- create-admin alvin
npm run dev            # http://127.0.0.1:5055, talks to the emulators only
```

On localhost the app always uses the emulators under a `demo-` project id, so local work can never touch the real project.
