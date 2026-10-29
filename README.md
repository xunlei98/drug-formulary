# Hospital Limbang Drug Formulary

A staff-only app to look up drugs, watch Ubat Mahal quotas and patients, and log stock movements. It runs in the browser on iPhone, Android and PC, keeps working with no internet, and syncs when the connection returns.

It is hosted on Firebase on the free Spark plan: Hosting for the app, Firestore for data, Firebase Auth for sign-in. There is no server code; `firestore.rules` enforces every permission.

![Drug detail](docs/screens/03-drug-detail.png)

## Quick start (local, emulators only)

Needs Node 20, Java 11+ (for the emulators) and Chrome (for e2e tests).

```
npm install
npm run emulators                                   # terminal 1
npm run seed:emulator -- --data /path/to/data       # terminal 2: formulary, quotas, locations, par, DEMO patients
npm run admin:emulator -- create-admin alvin        # prints a temporary password once
npm run dev                                         # open http://127.0.0.1:5055
```

On localhost the app only talks to the emulators. Deploying and seeding the real project: `docs/deploy.md`.

## Who can do what

| Role | Can do |
| --- | --- |
| admin | Everything. Adds staff, edits locations, imports data, reads the audit log. |
| pharmacist | Edits quotas, logs stock, sees and edits patients. |
| ward | Searches drugs, sees quota counts and stock, logs movements for their own ward. Sees no patients. |

No self sign-up. An admin creates each account in Admin > Users.

## Using the app

- **Search**: find a drug by name, code or brand. Tap it for stock, par, quota and recent movements.
- **Kad Stok**: each drug at each location has a stock card laid out like the pink paper card (Tarikh, No. PK/BTB/BPSS/BPSI/BPIN, Terima Daripada / Keluar Kepada, Terimaan, Keluaran, Baki, Nama Pegawai). Open it from a drug's stock rows. On a phone the table scrolls sideways with Tarikh pinned. See [docs/domain.md](docs/domain.md#kad-stok-stock-card-view).
- **Log** (Isi Kad Stok): fill one card row in card order: Tarikh, document, Terimaan / Keluaran / Kiraan stok, from or to (a location, a typed name, or Pelarasan stok), Kuantiti, optional Seunit (RM). Works offline. The badge shows Synced, Pending, Offline or Needs attention.
- **Quota**: slots left for each Ubat Mahal drug. Green is fine, amber from 80 percent, full and over are red.
- **Patients** (admin and pharmacist): choose a drug to list its patients. The IC is hidden until you tap it, and every tap is audited. Trial project: DEMO patients only.
- **Admin**: Users, Locations, Import and Audit.

## Tests

```
npm test            # unit tests
npm run test:rules  # security rules for admin, pharmacist, ward, disabled and signed-out users
npm run test:e2e    # headless Chrome against the emulators
npm run screens     # Kad Stok screenshots (docs/screens/12-14) on the emulators, synthetic data
```

## More

- `docs/deploy.md`: deploy, seed, credentials, read budget, moving to the MOH account.
- `docs/domain.md`: data shapes.
- `docs/security.md`: what is stored where, and the risks.
