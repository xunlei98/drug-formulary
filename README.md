# Hospital Limbang Drug Formulary

A staff-only app to look up drugs, watch Ubat Mahal quotas and patients, and log stock movements. It runs in the browser on iPhone, Android and PC. It keeps working with no internet and syncs when the connection returns.

![Drug detail](docs/screens/03-drug-detail.png)

More pictures are in `docs/screens/`.

## What you need

- A PC or server with Node 20 installed (nodejs.org, the LTS 20 version).
- This folder.

## Start it

Open a terminal in this folder and run:

```
npm install
npm run seed
npm start
```

`npm run seed` loads the drug list and quotas from the CSV files in `data/` (`master.csv`, `item-mahal.csv`, `kuota.csv`). It also makes the first admin account and prints a temporary password once. Write it down. You must change it at first sign-in.

Then open http://localhost:3000 in a browser.

To put the app on a phone, you need HTTPS. Read `docs/deploy.md` first.

## Try it with fake data

```
DB_PATH=data/demo.db DEMO_PASSWORD='pick-a-password-12' npm run demo
DB_PATH=data/demo.db npm start
```

Sign in as `admin`, `demo.pharm` or `demo.ward` with that password. The patients are all fake ("DEMO PATIENT 001"). Never use the demo database for real work.

## Who can do what

| Role | Can do |
| --- | --- |
| admin | Everything. Adds staff, edits locations, imports data, reads the audit log. |
| pharmacist | Edits drugs and quotas, logs stock, sees and edits patients. |
| ward | Searches drugs, sees quota counts and stock, logs movements for their ward. Sees no patients. |

There is no self sign-up. An admin creates each account.

## Using the app

- **Search**: find a drug by name, code or brand. Tap it for stock, quota and recent movements.
- **Log**: record Receive, Transfer, Issue, Adjust or Stocktake. Works offline. A badge shows Synced, Pending, Offline or Needs attention.
- **Quota**: slots left for each Ubat Mahal drug. Green is fine, amber is near the limit, full and over are red.
- **Patients** (admin and pharmacist): patients on each Ubat Mahal drug. The IC is hidden until you tap it. Every tap is recorded.
- **Admin**: Users, Locations, Import and Audit.

Locations are examples at first. Rename them in Admin > Locations.

## Updating the drug list

Admin > Import. Paste the rows from the Google Sheet with the header row, or choose a CSV file. Use "Dry run" first to see what would change.

## Backups

Run `npm run backup`. See `docs/deploy.md` to schedule it every night.

## Tests

```
npm test
npm run test:e2e
```

The second needs Google Chrome. Set `CHROME_PATH` if it is not at `/usr/bin/google-chrome`.

## More

- `docs/domain.md`: how the data is shaped.
- `docs/security.md`: what is stored where, and the risks.
- `docs/deploy.md`: hosting, HTTPS, backups, settings.
