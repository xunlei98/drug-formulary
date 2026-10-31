# Security notes

This app is for Hospital Limbang staff only. It is built to hold patient names and IC numbers, so treat it like any patient record system.

**The trial Firebase project holds DEMO patients only.** Real patient data needs MOH data-governance and PDPA approval and the MOH-owned project first. The importer and seed refuse real rows unless `PATIENTS_REAL_ALLOWED=true` (see `docs/deploy.md`).

## Who enforces what

Firestore Security Rules (`firestore.rules`) are the only gate; the client hides buttons but is not trusted. Tests in `test/rules/` check every role.

- Every read and write needs a signed-in user whose `users/{uid}` doc has a role and `disabled: false`. Disabled or deleted users get nothing.
- Ward users cannot read `patients`, `patient_identity` or `patient_log`. They read and create movements only for their own ward (`locs` must contain it).
- Movements, reversals, patient log and audit entries are create-only. A reversal is allowed once per movement and must be the exact inverse.
- Only admins write users, roles, locations, the formulary and par levels. Pharmacists may edit quotas in `catalog/mahal`, patients, stats and checkpoints.
- A user can change only their own `must_change` (to false) and `last_login` (to server time).
- The web API key identifies the Firebase project in the browser. It is not in this repository: `public/js/firebase-config.js` is gitignored, and the key only works from this hospital's site. Data access is still enforced by Auth and the rules.

## Patient data on devices

- The cached `patients` docs hold initials, the last 4 IC digits, kategori, unit, prescriber and dates. No name, no full IC.
- `patient_identity` (name, IC, dose, notes) is fetched over REST with `cache: no-store`, never through a listener, and never stored by the app.
- The idle lock (`config/app.idleLockMin`, default 5 minutes, for roles that see patients) signs the user out. Sign-out terminates Firestore and runs `clearIndexedDbPersistence`, so no cached patient doc stays on the device.
- Unsynced movements stay in the app's own IndexedDB outbox across sign-out (drug codes, quantities, locations; no patient data).
- A cached session works offline for `config/app.offlineDays` (default 3).
- If a phone is lost: an admin disables the user at once. Their Firebase session still holds a valid token for up to an hour, but every rule checks `disabled`, so reads and writes fail immediately.

## Accounts

- Passwords are held by Firebase Auth. The app enforces 10+ characters, not a common password, 4+ distinct characters, not containing the username. Temporary passwords must be changed at first sign-in.
- Firebase Auth rate-limits sign-in attempts.
- The first admin is created by `npm run cloud:admin -- create-admin`, which prints a generated password once. No password is stored in the repo.
- The service account key used by the seed and admin scripts must stay outside the repo (`.gitignore` blocks the usual file names).

## Browser protections

- CSP: own origin plus `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`; no inline scripts or styles; no framing. The SDK's connectivity probe image (`www.google.com/images/cleardot.gif`) is blocked on purpose; it is not needed.
- nosniff, no-referrer, X-Frame-Options DENY, Permissions-Policy.
- The service worker caches the app shell only, never Firestore data.
- The front end never uses innerHTML.

## Known limits

- No two-factor sign-in.
- No cloud backups on Spark (see `docs/deploy.md`).
- Spark quotas (50k reads, 20k writes a day). When exceeded, reads fail until the daily reset; the app keeps working from the device cache.
- Rules cannot rate-limit a signed-in user who scripts reads; an abusive account can use up the daily read quota. Disable it.
- Real iOS Safari has not been tested.
