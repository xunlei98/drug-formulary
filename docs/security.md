# Security notes

This app is for Hospital Limbang staff only. It can hold patient names and IC numbers. Treat it like any other patient record system.

Do not put real patient data on a server until MOH data governance and PDPA approval is in place. Until then use the demo database.

## Offline caching puts patient data on the device

The app works offline. To do that it stores data in the browser on each phone or PC.

- Formulary, locations, balances and recent movements are cached. They hold no patient data.
- Patient data is cached only when `OFFLINE_PATIENTS=minimal` (the default). Then a device keeps initials and the last 4 IC digits for roles that may see patients. Full names and full IC numbers are not cached. Ward users get no patient data at all.
- Set `OFFLINE_PATIENTS=off` and restart to stop all patient caching. This is the admin switch. Devices delete their patient cache the next time they open the app.
- The patient cache is deleted on sign-out, on the idle lock (`IDLE_LOCK_MIN`, default 5 minutes, for roles that see patients) and when the offline window ends.
- If a phone is lost, the minimal cache is still readable by someone who unlocks the phone and uses the browser tools. Ask staff to use a phone passcode and to sign out on shared PCs. An admin can disable the user at once. The server then refuses that user when the device next connects.
- The outbox of queued changes holds ids, drug codes, quantities and kategori values. It holds no names or IC numbers.

## Accounts and sessions

- No self sign-up. An admin creates every account. The first admin comes from `npm run create-admin` or env vars at first seed.
- Passwords use scrypt. Rules: 10 or more characters, not on a common password list, 4 or more different characters, not containing the username. A temporary password must be changed at first login.
- Login is rate limited per user and IP, per user and per IP. After `LOGIN_MAX_FAILS` (default 5) in `LOGIN_WINDOW_MIN` (default 15) the server answers 429 with Retry-After.
- Sessions live on the server. The cookie holds a random token and the database holds only its hash. Cookie flags: HttpOnly, SameSite=Lax, Secure. Idle timeout 12 h for staff and 4 h for admin.
- `SECURE_COOKIES=0` is allowed only when HOST is localhost. The server refuses to start otherwise.
- Every request to the API that changes data needs the header `X-Requested-With: formulary` and a matching Origin. This blocks cross-site form posts.

## Browser protections

- Content Security Policy: own origin only, no inline scripts or styles, no framing.
- Also sent: nosniff, no referrer, X-Frame-Options DENY, and HSTS when cookies are secure.
- The service worker never caches `/api`. It caches the app shell only.
- The front end never uses innerHTML.

## Patient data on the server

- IC is stored in full on the server. Clients get it masked. Showing the full IC needs a tap and writes an audit entry.
- Roles: admin, pharmacist, ward. Only admin and pharmacist see patients. Permissions are checked on the server for every route.
- The audit log records sign-ins and failures, user changes, full-IC views, patient edits and imports. Admin reads it in Admin > Audit.

## Ledger integrity

Stock movements cannot be edited or deleted. Database triggers refuse it. Mistakes are fixed with a reversing entry. Offline entries that overdraw stock are accepted, flagged, and listed for a pharmacist to resolve.

## Backups

`npm run backup` writes an encrypted copy (AES-256-GCM) of the database. The key is in `data/backup.key` (file mode 0600). Keep the key somewhere other than the backups. Without the key a backup cannot be restored. Restore never overwrites a live database.

## Known limits

- No two-factor sign-in.
- No per-field encryption of the database file. Use full-disk encryption on the host.
- A device that stays offline keeps its cached data until it reconnects or the window expires on the next app open.
- Real iOS Safari has not been tested.
