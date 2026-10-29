CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('admin','pharmacist','ward')),
  password_hash TEXT NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 1,
  disabled INTEGER NOT NULL DEFAULT 0,
  location_id TEXT,
  created_at TEXT NOT NULL,
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);

CREATE TABLE IF NOT EXISTS applied_ops (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  user_id INTEGER,
  applied_at TEXT NOT NULL,
  result TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drugs (
  no_kod TEXT PRIMARY KEY,
  kategori TEXT NOT NULL,
  kod_phis TEXT NOT NULL DEFAULT '',
  perihal TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  jenis TEXT NOT NULL DEFAULT '',
  kumpulan TEXT NOT NULL DEFAULT '',
  pku TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  harga_pku REAL,
  yearly REAL,
  monthly REAL,
  min REAL,
  max REAL,
  buffer REAL
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('store','ward','shelf')),
  parent_id TEXT REFERENCES locations(id),
  disabled INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS movements (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  drug TEXT NOT NULL REFERENCES drugs(no_kod),
  from_location TEXT REFERENCES locations(id),
  to_location TEXT REFERENCES locations(id),
  qty INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('receive','transfer','issue','adjust','stocktake')),
  user_id INTEGER,
  username TEXT NOT NULL,
  device_time TEXT,
  server_time TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  variance INTEGER,
  reverses TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS movements_drug ON movements(drug, seq);

CREATE TABLE IF NOT EXISTS balances (
  drug TEXT NOT NULL REFERENCES drugs(no_kod),
  location TEXT NOT NULL REFERENCES locations(id),
  qty INTEGER NOT NULL,
  PRIMARY KEY (drug, location)
);

CREATE TABLE IF NOT EXISTS mahal_item (
  no_kod TEXT PRIMARY KEY REFERENCES drugs(no_kod),
  quota INTEGER,
  nota TEXT NOT NULL DEFAULT '',
  tarikh_kemaskini TEXT
);

CREATE TABLE IF NOT EXISTS mahal_unit_quota (
  id TEXT PRIMARY KEY,
  no_kod TEXT NOT NULL REFERENCES mahal_item(no_kod),
  unit TEXT NOT NULL,
  kuantiti INTEGER NOT NULL,
  tarikh_kemaskini TEXT,
  pegawai TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  key_id TEXT UNIQUE,
  no_kod TEXT NOT NULL REFERENCES mahal_item(no_kod),
  nama TEXT NOT NULL,
  ic TEXT NOT NULL DEFAULT '',
  kategori TEXT NOT NULL CHECK (kategori IN ('Waiting List','Active','Active - Pesara','Off','Defaulted')),
  dos TEXT NOT NULL DEFAULT '',
  kuantiti_setahun REAL,
  preskriber TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  tarikh_mula TEXT,
  tarikh_henti TEXT,
  nota TEXT NOT NULL DEFAULT '',
  tarikh_kemaskini TEXT
);
CREATE INDEX IF NOT EXISTS patients_drug ON patients(no_kod);

CREATE TABLE IF NOT EXISTS patient_log (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  from_kategori TEXT,
  to_kategori TEXT,
  detail TEXT
);

CREATE TRIGGER IF NOT EXISTS movements_no_update BEFORE UPDATE ON movements
BEGIN SELECT RAISE(ABORT, 'movements are append-only'); END;
CREATE TRIGGER IF NOT EXISTS movements_no_delete BEFORE DELETE ON movements
BEGIN SELECT RAISE(ABORT, 'movements are append-only'); END;

CREATE TABLE IF NOT EXISTS discrepancies (
  id INTEGER PRIMARY KEY,
  movement_id TEXT NOT NULL,
  drug TEXT NOT NULL,
  location TEXT NOT NULL,
  qty_after INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  resolve_note TEXT
);
CREATE INDEX IF NOT EXISTS discrepancies_open ON discrepancies(resolved_at);
