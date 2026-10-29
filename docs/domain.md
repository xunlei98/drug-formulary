# Domain model

This file is the source of truth for the data shapes. Code follows it.

## Roles

| Role | Can do |
| --- | --- |
| admin | Everything a pharmacist can, plus users, locations, imports, audit log. These are the Drug Information Centre pharmacists. |
| pharmacist | Edit drugs and quotas, log stock, see and edit patients. |
| ward | View drug info, quota counts, stock and locations. Log movements. Never sees patients. |

Permissions live in one table in `shared/perm.js`. The server checks it on every route. The client uses it only to hide buttons.

## Drug (formulary item)

Natural key is `no_kod`. It is unique in the MASTER sheet.

`kategori` (Ubat or Bukan Ubat), `kod_phis`, `no_kod`, `perihal` (Perihal Stok), `brand`, `jenis` (APPL, LP or CC), `kumpulan`, `pku`, `sku`, `harga_pku`, `yearly`, `monthly`, `min`, `max`, `buffer`.

Derived: `is_ubat_mahal` is true when a `mahal_item` row exists. `quota` comes from that row.

## Location

A typed tree. `type` is `store`, `ward` or `shelf`. A `shelf` must have a parent. Stores and wards may have a parent too. Disabled locations keep their history but cannot receive new movements.

Shelf or rack text is a `shelf` node named for the rack, for example "Rack B2", under a store. This lets balances answer "which rack".

Seeded locations (Hospital Limbang): stores Main Store, Prepacking, Substore OPD, Substore IPD; wards and units ETD, Female Ward, HDU, ICU, Klinik Mata, Klinik Pakar, Klinik Psikiatrik, Male Ward, Maternity Ward, OPD MO Room, OT, Paeds Ward, Treatment Room, Unit Endoscopy, Unit Radiology. Re-seeding adds missing ones, deletes unused old EXAMPLE locations and disables used ones.

## Par level

The approved floor-stock maximum of a drug at a ward or unit, from that unit's 2026 "Senarai Floor Stock" PDF (lists: floor stock, DDA, after office hours, emergency trolley, recovery). `par_levels` keeps every parsed row with its match to the formulary (`exact`, `high`, `low`, `none`) and score. Unmatched rows (`drug` null) are never shown. Par for a drug at a location is the sum across its lists.

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

Order is arrival order on the server (`seq`). Device time is kept for audit only.

`balance(drug, location)` is a projection of the ledger. It can be rebuilt from the ledger at any time and a test proves they match.

Negative balances:
- A live request (client online) that would go negative is rejected.
- A replayed request (from the offline outbox) is accepted and flagged. The balance may go negative. A `discrepancies` row is written. The Review screen lists open ones for a pharmacist to resolve with an adjust or a stocktake.

Immutability and reversal:
- SQLite triggers block UPDATE and DELETE on `movements`. The `balances` table is a projection and can be rebuilt.
- A mistake is undone by a reversing movement (the inverse). Its `reverses` column points at the original and is UNIQUE, so a movement can be reversed once. Adjust and stocktake cannot be undone this way. A live reversal that would overdraw is rejected.

Ward scoping:
- A ward user has one `location_id`. With `WARD_STOCK_SCOPE=own` (default) they see and log only for that ward and its shelves. `all` lets them see every location.

## Ubat Mahal quota

`mahal_item { no_kod, quota, nota, tarikh_kemaskini }`. `quota` is the number of patients the hospital may have on that drug. This meaning is unconfirmed (it could be units, boxes or a yearly quantity). It may be empty (12 rows in the real sheet). Then the drug is monitored but shows "quota not set".

`mahal_unit_quota { id, no_kod, unit, kuantiti, tarikh_kemaskini, pegawai }` is an optional split by department. Patients are counted per unit against this split. The drug screen shows both the total and the per-unit table.

Counting rule: Active and Active - Pesara count against the quota. Waiting List is shown apart. Off and Defaulted count for nothing.

Status by used / quota: `ok` below 80 percent, `near` from 80 percent up to but not including 100, `full` at exactly 100, `over` above 100 (shown as Over +N). Slots left never go below 0. Kuota is the number of patients allowed per drug per unit. The 80 percent line was confirmed by Alvin (`QUOTA_NEAR_PCT`). A quota of 0 with no patients is `full`. No `mahal_item` row means the drug is not Ubat Mahal.

## Patient (Pesakit)

`patient { id, key_id?, no_kod, nama, ic, kategori, dos, kuantiti_setahun, preskriber, unit, tarikh_mula, tarikh_henti, nota, tarikh_kemaskini }`

Kategori is a state machine: Waiting List, Active, Active - Pesara, Off, Defaulted. Allowed moves are in `shared/patient-state.js`. Every move writes a `patient_log` row. Moving to Off or Defaulted needs a stop date.

IC is stored in full on the server. It is sent to clients masked (last 4 digits). Showing it in full needs a tap and writes an audit row.

## Offline patient cache

Controlled by `OFFLINE_PATIENTS` (`minimal` default, `off`).
- `off`: no patient data is sent to or kept on any device.
- `minimal`: only initials and the last 4 IC digits are cached, for roles with `patient.view`, in a separate IndexedDB (`fm-patients`). Ward users never get it. Sign-out, idle lock and expiry of the offline window delete it.
- The full patient list is fetched online with no-store and is never kept on the device.
- Creating a patient and editing identity fields are online only. Kategori and dates can be queued offline.
- The outbox holds ids and values only. It holds no names or IC numbers.

## Sessions and passwords

Server-side sessions, token hashed in the database. Idle timeout 12 h for staff and 4 h for admin, sliding. A cached session works offline for `OFFLINE_DAYS` (default 3). Passwords: at least 10 characters, not a common password, at least 4 distinct characters, must not contain the username. First login forces a change.

## Sync

The client queues operations in an outbox (IndexedDB). Each has a client UUID. `POST /api/sync` takes a batch in order. The server records every applied id in `applied_ops`. An id seen before returns the stored result and changes nothing.

Operation kinds: `movement`, `patient_create` (live only), `patient_update`. In replay mode `patient_update` may only change kategori, tarikh_henti and tarikh_mula. A batch holds at most 200 operations. `mode` is `live` (the client was online when it acted) or `replay` (it came from the outbox).

## Modules

Each monitoring feature owns its tables and its route file under `src/api/`. Today: `stock` (locations, movements, balances) and `mahal` (quota, patients). A new feature adds a schema block, a route file and a screen.
