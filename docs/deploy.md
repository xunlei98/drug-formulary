# Deploying

## Where to host (recommendation)

1. A hospital PC first. Put it on a UPS. Name one owner who is responsible for it, for updates and for backups. Staff reach it on the hospital network. This keeps patient data inside the hospital.
2. A Cloudflare tunnel only behind Cloudflare Access, and only with fake data, until MOH approves it.
3. A VPS only with MOH or IT approval.

Real patient data must not go onto any of these until MOH data governance and PDPA approval is given.

## HTTPS

Phones need HTTPS to install the app and to keep offline data. Only `localhost` is exempt. So:

- Test on the same PC at `http://localhost:3000` with `SECURE_COOKIES=0`.
- Anything else needs HTTPS. Use a reverse proxy (Caddy or nginx) with a certificate, or a Cloudflare tunnel. Set `TRUST_PROXY=1` when a proxy sits in front, so the real client IP is used for login limits. Only set it behind a proxy you control.
- Caddy example, in a Caddyfile:

```
formulary.example.org {
  reverse_proxy 127.0.0.1:3000
}
```

## First install

You need Node 20.

```
npm install
npm run seed
npm start
```

`seed` imports `data/master.csv`, `data/item-mahal.csv` and `data/kuota.csv` if present. It adds EXAMPLE locations and creates the first admin. It prints a temporary password once. Change it at first sign-in. To choose the admin name and password, set `ADMIN_USERNAME` and `ADMIN_PASSWORD` first.

Run it as a service so it restarts after a reboot (systemd or pm2). Run it as a normal user, never as root.

## Settings (environment variables)

| Name | Default | Meaning |
| --- | --- | --- |
| HOST | 127.0.0.1 | Address to listen on. Use 127.0.0.1 behind a proxy. |
| PORT | 3000 | Port. |
| DB_PATH | ./formulary.db | Database file. |
| SECURE_COOKIES | on | `0` only on localhost. |
| TRUST_PROXY | off | `1` behind a proxy you control. |
| SESSION_IDLE_HOURS | 12 | Idle timeout for staff. |
| ADMIN_IDLE_HOURS | 4 | Idle timeout for admin. |
| OFFLINE_DAYS | 3 | Days a cached sign-in works offline. |
| IDLE_LOCK_MIN | 5 | Minutes idle before patient roles are signed out. |
| OFFLINE_PATIENTS | minimal | `off` stops all patient caching on devices. |
| WARD_STOCK_SCOPE | own | `all` lets ward users see every location. |
| QUOTA_NEAR_PCT | 80 | Percent of quota where status turns "near". |
| LOGIN_MAX_FAILS | 5 | Failed sign-ins before lockout. |
| LOGIN_WINDOW_MIN | 15 | Window for the count. |
| BACKUP_DIR | backups | Where backups go. |
| BACKUP_KEY_FILE | data/backup.key | Key file. Created on first backup. |
| BACKUP_KEEP_DAYS | 14 | Older backups are deleted. |

## Nightly backup

Add to cron (run `crontab -e` as the service user):

```
15 2 * * * cd /path/to/formulary-app && DB_PATH=/path/to/formulary.db npm run -s backup >> backup.log 2>&1
```

Then copy `backups/` to a second place each night: another PC, a hospital file share or an external disk. Copy `data/backup.key` once, to a different place, and keep it safe. Decide who owns this copy.

Restore to a new file, then point the server at it:

```
node src/cli.js restore backups/<file>.db.enc /path/to/restored.db
DB_PATH=/path/to/restored.db npm start
```

Test a restore once after setup.

## Updating

Stop the server, take a backup, replace the code, run `npm install`, start again. Version 1 has no migration system. Missing tables are created at start, but a change to an existing table needs a manual step. Test an update on a restored copy of the backup first.

## Demo mode

```
DB_PATH=data/demo.db DEMO_PASSWORD='choose-one-12chars' npm run demo
DB_PATH=data/demo.db npm start
```

This adds fake DEMO patients and users admin, demo.pharm and demo.ward. Never use the demo database for real work.

## Importing real patients (later, by an admin, after approval)

Admin > Import > Patients accepts rows pasted from Google Sheets or Excel (with the header row), or a CSV file. Do it on the real server only. The command line `node src/cli.js import patients file.csv --dry-run` checks a file first. Never put patient files in the repository folder.
