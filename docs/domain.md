# Domain model

This file is the source of truth for the data shapes. Code follows it.

## Roles

| Role | Can do |
| --- | --- |
| admin | Everything a pharmacist can, plus users, locations, imports, audit log. These are the Drug Information Centre pharmacists. |
| pharmacist | Edit drugs and quotas, log stock, see and edit patients. |
| ward | View drug info, quota counts, stock and locations. Log movements. Never sees patients. |

The client uses the table in `public/shared/perm.js` only to hide buttons. `firestore.rules` enforces the same roles on every read and write. Roles live in `users/{uid}` (`role`, `location`, `disabled`). Admins change other users' roles in Admin > Users. An admin can never change their own role or disable themselves (rules enforce it), so the last admin cannot be removed.

## Drug (formulary item)

Natural key is `no_kod`. It is unique in the MASTER sheet.

`kategori` (Ubat or Bukan Ubat), `kod_phis`, `no_kod`, `perihal` (Perihal Stok), `brand`, `jenis` (APPL, LP or CC), `kumpulan`, `pku`, `sku`, `harga_pku`, `yearly`, `monthly`, `min`, `max`, `buffer`.

Optional `info` (drug information from the old "DRUG FORMULARY" Google Sheet, columns C to X; every key optional, empty cells omitted, line breaks kept): `brand`, `form`, `pack_img`, `img`, `pharm_cat`, `prescriber_cat`, `pregnancy`, `breastfeeding`, `indications`, `dosage`, `renal`, `dilution`, `origin`, `phis`, `item_code`, `procurement`, `packaging`, `sku`, `price_pack` (number), `price_unit` (number), `group`, `keep_buffer` (boolean). Merged by `scripts/merge-druginfo.js` (or the seed, when `drug-formulary.csv` sits in the data folder). A sheet row matches a drug by Item Code = `no_kod`, then by Item Code or PhIS code against `no_kod`/`kod_phis`, then by exact normalised name. Rows that hit more than one drug, or that compete for one drug at the same tier, are reported as ambiguous and not applied. A MASTER re-import keeps `info`. Screens show the MASTER value first and the sheet value when MASTER is empty. The sheet has no Administration or Hepatic Dosage column.

Drugs added from the sheet alone (code-bearing rows with no similar drug name) carry `source: 'old-formulary-sheet'` and show an "Old formulary only" pill.

Derived: `is_ubat_mahal` is true when a `mahal_item` row exists. `quota` comes from that row.

## Location

A typed tree. `type` is `store`, `ward` or `shelf`. A `shelf` must have a parent. Stores and wards may have a parent too. Disabled locations keep their history but cannot receive new movements.

Shelf or rack text is a `shelf` node named for the rack, for example "Rack B2", under a store. This lets balances answer "which rack".

Seeded locations (Hospital Limbang): stores Main Store, Prepacking, Substore OPD, Substore IPD; wards and units ETD, Female Ward, HDU, ICU, Klinik Mata, Klinik Pakar, Klinik Psikiatrik, Male Ward, Maternity Ward, OPD MO Room, OT, Paeds Ward, Treatment Room, Unit Endoscopy, Unit Radiology. They live in one doc, `catalog/locations` (`byId`). Admins add, rename or disable them in Admin > Locations. Delete works only for a location that was never used: no child locations, `par` list, checkpoint, movements or assigned users. The app checks all of these; rules check one key removed at a time, named in `deleted_last`, with no `par/{id}` or `checkpoints/{id}` (rules cannot query movements). Used locations can only be disabled.

## Par level

The approved floor-stock maximum of a drug at a ward or unit, from that unit's 2026 "Senarai Floor Stock" PDF (lists: floor stock, DDA, after office hours, emergency trolley, recovery). `par/{location}` (one doc per location) keeps every parsed row with its match to the formulary (`exact`, `high`, `low`, `none`) and score. Unmatched rows (`drug` null) are never shown. Par for a drug at a location is the sum across its lists.

Status: no balance row is "Not counted", balance below par is "Low", otherwise "OK". Par never creates a balance; balances come only from logged movements and stock counts.

## Stock ledger

Stock is an append-only list of movements. Nobody edits a balance.

```
Movement { id (client UUID, idempotency key), drug (no_kod), from?, to?, qty (> 0),
           type, user, device_time, server_time, note, variance? }
```

| type | from | to | effect |
| --- | --- | --- | --- |
| receive | none | required | to += qty |
| transfer | required | required, different | from -= qty, to += qty |
| issue | required | none | from -= qty |
| adjust | one of them | the other none | to += qty or from -= qty |
| stocktake | none | required | balance at to is set to qty. `variance` is counted minus the balance before. |

Stored as `movements/{id}` with `uid`, `username`, `device_time`, `server_time` (set by Firestore) and `locs` (locations touched plus their parents). Order is `server_time`. Device time is kept for audit only.

`balance(drug, location)` is computed on the device: the latest `checkpoints/{location}` (balances as of `asOf`) plus every movement after it. A pharmacist device writes new checkpoints when it holds 200+ movements, so a sign-in reads at most a few hundred.

Negative balances are never blocked. They are flagged, and the Review screen lists them for a pharmacist to resolve with an adjust or a stocktake (`reviews/{drug|location}` hides an item while its quantity is unchanged).

Immutability and reversal:
- Rules allow create only on `movements`; no update or delete.
- A mistake is undone by a reversing movement (the inverse) written in one batch with `reversals/{originalId}`. That marker can be created once, so a movement can be reversed once. Adjust and stocktake cannot be undone this way.

Ward scoping:
- A ward user has one `location`. With `config/app.wardStockScope = 'own'` (default) they see and log only movements whose `locs` contain their ward. `all` lets them see every location.

## Kad Stok (stock card view)

The movement log looks and fills like the pink paper card (KEW.PS, M.S. 7/13, Bahagian B, Transaksi Stok). One card is one drug at one location: `#/kad/<no_kod>?loc=<location>`. It is a view over the ledger above, so it costs no extra Firestore reads.

Optional card fields on a movement (all may be missing; older movements have none):

| field | meaning | rule |
| --- | --- | --- |
| `tarikh` | Tarikh on the card, `YYYY-MM-DD` | defaults to today in the form; rows are still ordered by `server_time` |
| `doc_type` | `PK`, `BTB`, `BPSS`, `BPSI`, `BPIN` or `LAIN` (Lain-lain) | enum |
| `doc_no` | document number | string, 40 chars max |
| `party` | free-text Terima Daripada / Keluar Kepada (supplier, patient, other hospital) | string, 120 chars max |
| `unit_price` | Seunit (RM), entered on Terimaan | number from 0 to 1,000,000 |

How a card row maps onto a movement:

| On the card | Movement |
| --- | --- |
| Terimaan from a location | `transfer`, from that location |
| Terimaan from a typed name | `receive` + `party` |
| Keluaran to a location | `transfer`, to that location |
| Keluaran to a typed name | `issue` + `party` |
| Terima Daripada / Keluar Kepada = Pelarasan stok | `adjust` |
| Kiraan stok | `stocktake`: Baki becomes the count, the difference shows under Terimaan or Keluaran |

Columns:
- Baki dibawa ke hadapan: the checkpoint balance, or the balance before the first row shown when older rows are hidden (20 rows a page, newest last).
- Baki: the running balance after each row. Negative is red and flagged, never blocked.
- RM: Jumlah = Kuantiti × Seunit. Seunit is the row's `unit_price`. Keluaran and Baki use the last Seunit seen on the card. With no price, the column shows `-`. Harga PKU is per pack, so it is only shown as a hint and never used as Seunit.
- Nama Pegawai: the `username` of whoever saved the row (the signed-in user).
- A reversal shows as `Batal: <party of the cancelled row>`.

Code: `public/shared/kad.js` (`cardRows`, `pageOf`, `entryToMovement`, `validateCardFields`), views `kad.js` and `log.js`. Rules: `cardOk()` in `firestore.rules`.

## Ubat Mahal quota

`catalog/mahal.items[no_kod] = { quota, nota, tarikh_kemaskini, units }`. `quota` is the number of patients the hospital may have on that drug (confirmed). It may be empty (12 rows in the real sheet). Then the drug is monitored but shows "quota not set".

`units` is the optional split by department from the Kuota sheet (`unit`, `kuantiti`, `tarikh_kemaskini`, `pegawai`). Patients are counted per unit against this split. The drug screen shows both the total and the per-unit table.

Counting rule: Active and Active - Pesara count against the quota. Waiting List is shown apart. Off and Defaulted count for nothing.

Status by used / quota: `ok` below 80 percent, `near` from 80 percent up to but not including 100, `full` at exactly 100, `over` above 100 (shown as Over +N). Slots left never go below 0. Kuota is the number of patients allowed per drug per unit. The 80 percent line was confirmed by Alvin (`config/app.nearPct`). Counts come from `stats/counts.byKey["no_kod|unit|kategori"]`, kept in step by every patient write, so quota screens never read patient docs. Admin > Import > Recount rebuilds it. A quota of 0 with no patients is `full`. No `mahal_item` row means the drug is not Ubat Mahal.

## Patient (Pesakit)

Split in two collections with the same id (`k_<KeyID>`):
- `patients/{id}`: `no_kod, initials, ic4, kategori, unit, preskriber, tarikh_mula, tarikh_henti, tarikh_kemaskini, updated_by`. Cached by the SDK for pharmacists.
- `patient_identity/{id}`: `no_kod, nama, ic, dos, kuantiti_setahun, nota, key_id`. Read over REST with no-store only, never listened to, never cached. Showing the full IC writes an audit entry.

Kategori is a state machine: Waiting List, Active, Active - Pesara, Off, Defaulted. Allowed moves are in `public/shared/patient-state.js` and repeated in the rules. Every move writes `patient_log/{id}`. Off or Defaulted needs a stop date. Creating a patient and editing identity fields are online only (one REST commit). Kategori changes can be queued offline.

The trial project accepts only `DEMO PATIENT nnn` with IC `000000-00-nnnn` unless `PATIENTS_REAL_ALLOWED` is true.

## Sessions and passwords

Firebase Auth. Usernames map to `<username>@staff.formulary.local`. A cached session works offline for `config/app.offlineDays` (default 3). Passwords: at least 10 characters, not a common password, at least 4 distinct characters, must not contain the username. First login forces a change. Sign-out and the idle lock wipe the Firestore cache.

## Sync

Every movement and kategori change gets a client UUID and goes into the app's own IndexedDB outbox, then to Firestore as a write with that id. The SDK's persistent cache queues it while offline. The badge counts outbox entries (`hasPendingWrites`, `waitForPendingWrites`). A retry of an id that already landed is refused by the create-only rules, and the app then confirms it landed and clears it. A write the rules refuse goes to "Needs attention".

## Catalog

`formulary/c000…` hold the formulary in chunks of 250 drugs. `meta/catalog` holds a version for the formulary and one per par doc. Devices listen to `meta/catalog` only and download chunks or par docs when a version changes.
