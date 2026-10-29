# Handover: Hospital Limbang drug formulary (29 Oct 2026)

This is a staff-only drug formulary PWA (an installable web app) for Hospital Limbang. It runs on iPhone, Android and PC browsers and works offline, syncing when back online.

## Where it lives
- Live site: https://limbang-formulary.web.app
- Firebase project: `limbang-formulary` under xunlei98@gmail.com, on the free **Spark plan**. Never add billing or upgrade to Blaze.
- Firestore region: asia-southeast1.
- Branch: `firebase`. Live commit 7ff0792 (BUILD 21b7c302d942); later commits only touch HANDOVER.md.

## Hard rules
- **Fake DEMO patients only.** Real Ubat Mahal patients (names, IC numbers) must not go on any server until the hospital approves hosting. `PATIENTS_REAL_ALLOWED` stays false.
- Free tier only. Live data is about 1.2 MB across 135 docs, and the drug list is split into 6 chunk docs in `formulary`, each under 1 MiB.
- Don't delete anything in the Firebase project without Alvin's OK.
- Never commit secrets. The service account key and account passwords live outside the repo.
- Theme: white only (never follow device dark mode). The look is a big bold number on top, rounded white cards with thin borders, small grey capitalised labels, a dark navy accent, and green/red only for good/bad numbers.
- Work style: data shapes first, small steps, each step proven by real tests.

## What's built
- Drug info: a Notion-style card gallery (A to Z when search is empty) and a label/value detail page. Data comes from the MASTER list plus the old Google Sheet `1Mh4llVd…` DRUG FORMULARY tab, columns C to X, merged by `scripts/merge-druginfo.js` (idempotent).
- Ubat Mahal quota: Kuota means patients allowed per drug, and "Near full" shows at 80%.
- Stock: 19 locations (Main Store, Prepacking, Substore OPD, Substore IPD, plus 15 wards/units) with par levels. The movement log (Kad Stok) copies the paper KEW.PS stock card, Bahagian B, Transaksi Stok, in the same column order.
- Roles: admin, pharmacist, ward. Admins (Drug Information Centre pharmacists) manage users and locations. They can delete never-used locations, and the last admin can't be removed.
- Sign-in stays until manual sign-out; there's no idle lock.

## Commands
- Build first, every time: `npm run build` (stamps the service-worker BUILD), then `npm run deploy`.
- Tests: `npm test` (33 unit), `npm run test:rules` (20), and `npm run test:e2e` (8). Rules and e2e need Java 11+ for the Firestore emulator.
- Admin and seed scripts need `GOOGLE_APPLICATION_CREDENTIALS` pointing at the service account JSON, which is not in the repo.
- `firebase login` is needed once on a new machine before deploying.

## Open questions waiting for Alvin
1. 13 sheet rows match more than one drug and 16 match only by similar name. These weren't applied (see the merge report from 29 Oct).
2. Should any of the 69 "Old formulary only" drugs be removed (for example, ranitidine)?
3. Where the sheet and the MASTER list disagree, the app shows MASTER. Is that right?
4. Is a separate store role wanted?
5. Drug pictures: 179 drugs have Drive/imgur links, 6 are AppSheet-only, and none work offline. Should compressed copies be hosted in Firebase Hosting?
6. Should the Administration and Hepatic Dosage fields be pulled from Notion?

## Later
Once the trial is accepted, ask JKNS ICT for work-account GCP access and move the project to the work account.

## Design rules (from Design)
- White theme only. Prescriber pills: A* purple, A pink, B green, C amber, D blue. Procurement pills: Local Purchase red, Contract green, APPL blue. Soft colours, dark text.
- Kad Stok header stays pink `#fdf2f6`.
- Drug photos shown whole on grey; grey picture icon when missing or broken.
- Drug page: labels left, values right; on a phone each value sits under its label.
- Tap targets at least 44px. Never put the text `file://` in the code.
