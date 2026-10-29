# Handover (29 Oct 2026)

Live: https://limbang-formulary.web.app (Firebase project `limbang-formulary`, Spark free plan; never upgrade).
Branch `firebase` is the live app. Last deployed commit: `7ff0792`. Tests: `npm test` 33/33 pass.
Start with `README.md`, then `docs/deploy.md`, `docs/security.md`, `docs/domain.md`.

## Done recently
- White theme only, ignores device dark mode (`4089c6c`).
- Stay signed in until manual Sign out; no idle lock or offline time limit (`4673eeb`).
- Drug info from the old Google Sheet "DRUG FORMULARY" tab, columns C to X, merged in (`89cd89e`, script `scripts/merge-druginfo.js`, data shape in `public/shared/druginfo.js`).
- Notion-style card gallery and drug detail page (`89cd89e`, `7ff0792`).
- Admin > Locations: add, edit, delete never-used locations; admins cannot demote or disable themselves (`14a714e`, enforced in `firestore.rules`).
- Gallery and list sorted A to Z when the search box is empty (`7ff0792`).
- Prices are visible to every role (Alvin's choice).

## Open questions for Alvin
- Drug pictures are links to Google Drive / imgur (about 179). They don't load offline and break if a Drive file is unshared. Offer: host small copies inside the app. Not answered.
- Merge leftovers: 13 ambiguous and 16 similar-name matches, 69 drugs only in the old sheet; confirm MASTER wins on conflicts.
- Add a "store" role? Administration and Hepatic fields are missing from the sheet.

## Rules to keep
- Patient data stays DEMO only until hosting is approved.
- Firestore rules are the only security layer; every permission change needs a rules test (`npm run test:rules`).
- Never commit service-account keys or sheet CSVs (see `.gitignore`).
