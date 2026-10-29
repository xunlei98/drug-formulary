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

The seeded locations are placeholders. The admin edits them.

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
- A replayed request (from the offline outbox) is accepted. The balance may go negative. The Review screen lists every negative balance for a pharmacist to fix with an adjust or a stocktake.

## Ubat Mahal quota

`mahal_item { no_kod, quota, nota, tarikh_kemaskini }`. `quota` is the number of patients the hospital may have on that drug. This meaning is unconfirmed.

`mahal_unit_quota { id, no_kod, unit, kuantiti, tarikh_kemaskini, pegawai }` is an optional split by department.

Counting rule: Active and Active - Pesara count against the quota. Waiting List is shown apart. Off and Defaulted count for nothing.

Status by used / quota: `ok` below 80 percent, `near` from 80 percent up to but not including 100, `full` at exactly 100, `over` above 100. A quota of 0 with no patients is `full`. No quota row means the drug is not Ubat Mahal.

## Patient (Pesakit)

`patient { id, key_id?, no_kod, nama, ic, kategori, dos, kuantiti_setahun, preskriber, unit, tarikh_mula, tarikh_henti, nota, tarikh_kemaskini }`

Kategori is a state machine: Waiting List, Active, Active - Pesara, Off, Defaulted. Allowed moves are in `shared/patient-state.js`. Every move writes a `patient_log` row. Moving to Off or Defaulted needs a stop date.

IC is stored in full on the server. It is sent to clients masked (last 4 digits). Showing it in full needs a tap and writes an audit row.

## Sync

The client queues operations in an outbox (IndexedDB). Each has a client UUID. `POST /api/sync` takes a batch in order. The server records every applied id in `applied_ops`. An id seen before returns the stored result and changes nothing.

Operation kinds: `movement`, `patient_create`, `patient_update`.

## Modules

Each monitoring feature owns its tables and its route file under `src/api/`. Today: `stock` (locations, movements, balances) and `mahal` (quota, patients). A new feature adds a schema block, a route file and a screen.
