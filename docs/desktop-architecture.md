# Desktop architecture: Electron + local SQLite

Reference for the desktop build of the Nextora Creations Invoice & Quotation
Generator. Complements [desktop-audit.md](desktop-audit.md) (the pre-change code
audit); this document records what was actually built and how it was verified.

## 1. Shape of the application

```text
Electron Desktop Application (single process + renderer)
│
├── Renderer process — src/ (unchanged views, Vite bundle)
│   └── src/lib/api.js  ──┐  uses the bridge when it exists, fetch() otherwise
│                          │
├── Preload bridge — electron/preload.cjs (contextBridge, one operation)
│                          │
└── Electron main process — electron/main.js
    ├── In-process API: createAPI(sqliteDb, config)  (server/api.js, unchanged)
    │   └── service · documents · reports · tracker · excel · sharing · pdf
    ├── SQLite service — server/db.js (translation + connection + transactions)
    ├── Migrations — scripts/migrate.js + server/migrations-sqlite/*
    ├── Backup / restore — server/backup.js
    └── Native dialogs, printing, file paths, app:// asset serving
```

No HTTP server, no port, no database server, no background daemon. The renderer is
a static bundle; every data operation is a function call inside the main process.

## 2. Renderer transport

`createAPI(db, config)` is a pure `(Request, { ip }) => Response` function, which is
what makes the desktop build small: the entire HTTP-shaped API is reused verbatim
in-process. The renderer keeps calling `/api/...`; only the transport changes.

| | Browser build | Desktop build |
| --- | --- | --- |
| Transport | `fetch('/api/…')` on one origin | `window.electronAPI.request({ method, path, headers, body })` |
| Session cookie | Browser cookie jar | Held by the main process, re-attached to each synthetic request |
| Response | `Response` | `{ status, statusText, headers, body }`; binary bodies base64-encoded |
| PDF / Excel | Blob URL in a tab | Native save dialog or a dedicated PDF preview window |

The preload exposes exactly one request operation plus a small set of native
actions (`openDocument`, `backupDatabase`, `restoreDatabase`, `print`,
`openDataFolder`, `openFile`, `saveFile`, `setUnsavedChanges`, `onNavigate`).
There is no raw IPC surface and no filesystem access in the renderer. Because the
same middleware still runs, origin, CSRF, session and role checks are unchanged —
the smoke test asserts a foreign origin still receives `403`.

## 3. SQLite driver decision (measured, not assumed)

Probed against the installed runtime — Electron 44.7.0 / Node 24.21.0:

| Check | Result |
| --- | --- |
| `require('node:sqlite')` inside Electron | loads natively (`DatabaseSync`, `StatementSync`, `backup`, `Session`) |
| SQLite version | 3.53.4 |
| `StatementSync.columns()` | returns declared column types (used for type restoration) |
| User-defined functions (`db.function`) | supported (used for `REGEXP`, `subset_of`) |
| `FILTER (WHERE …)`, `RETURNING`, `ON CONFLICT`/`excluded`, window functions, `json_each` | all native |
| `backup(source, path)` | supported — used for consistent online backups |
| Native compilation required | **none** — no compiler toolchain on the target machine |

Chosen: **`node:sqlite` (built into Electron)**. No `better-sqlite3`, no prebuilds,
nothing to rebuild per Electron version.

## 4. SQL dialect layer

`server/sqlite/dialect.js` rewrites the PostgreSQL-flavoured SQL that the existing
`server/*.js` modules already contain. It is a lossless rewriter: it walks strings
and comments so literals are never touched, and it **fails loudly on any construct
it does not recognise** instead of guessing.

Rewritten (with tests per rule): `$n` → `@pn`; schema folding `inv.table` →
`inv_table`; `::date`/`::int`/`::bigint`/`::uuid` casts; `now()`, `current_date`,
`date_trunc`, `to_char` → `strftime`/`printf`; `ILIKE` → `LIKE`; `= ANY(…)` →
`IN (json_each(…))`; `json_agg`/`array_agg`; intervals → datetime modifiers;
`FOR UPDATE` → dropped (the writer lock serialises everything anyway).

Native and passed through untouched: `RETURNING`, `NULLS LAST`, `FILTER (WHERE …)`,
`ON CONFLICT … DO UPDATE … EXCLUDED`, window functions, `LIKE`, `CASE`.

## 5. Schema and migrations

- All `inv.*` tables are ported 1:1 to `inv_` prefixed tables; `server/migrations-sqlite/`
  holds hand-written SQLite DDL because triggers are dialect-specific.
- One migration runner (`scripts/migrate.js`) serves both drivers: forward-only,
  checksummed, recorded in `inv_schema_migrations`; editing an applied migration
  is refused. Migrations run on every application start, before the window opens,
  so upgrading the binary upgrades the schema in place.
- Custom spreadsheet columns stay **rows, not columns** (`custom_field_definitions`
  + `custom_field_values`), so adding a column never needs a migration.
- A dialect test asserts the hand-written SQLite DDL passes through the rewriter
  unchanged, so a table name or default value can never be silently rewritten.

### Type parity

The adapter restores exactly what `node-postgres` returned, keyed off the declared
column type:

| Stored | Returned as |
| --- | --- |
| `BOOLEAN` | `true`/`false` |
| `JSONB` / JSON text columns / `text[]` | parsed objects, arrays |
| `TIMESTAMPTZ` | JS `Date` (the `pg` default parser) |
| `DATE` | plain `YYYY-MM-DD` string (the app's own override) |
| `BIGINT` money | exact safe `Number`, else the same overflow error `pg` raised |
| `BYTEA` | `Buffer` |

Money is always integer minor units; dates are sortable text; `bigint` reads are
enabled on every prepared statement so a stored amount can never arrive as a float.

## 6. Concurrency model

SQLite with one process and one writer, deliberately simple and safe:

- one connection, `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`,
  `enableForeignKeyConstraints: true`;
- every statement goes through a serialised promise queue;
- `transaction()` starts `BEGIN IMMEDIATE` inside an `AsyncLocalStorage` context, so
  nested calls become `SAVEPOINT`s and a rollback cannot escape its own scope;
- multi-step financial operations (issue, payment, conversion, numbering) keep the
  transactional guarantees they had on PostgreSQL — the existing tests assert
  concurrent issuance cannot collide.

Constraint failures are translated back to the SQLSTATE codes the API already
understands, so error handling is identical on both drivers: `23505` → duplicate,
`23503` → still referenced, `23502` not-null, `23514` check, `P1` trigger `RAISE`.

## 7. Security controls

| Control | Implementation |
| --- | --- |
| Renderer isolation | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` |
| IPC surface | One request operation + named native actions; arguments validated by the API itself |
| Content Security Policy | `default-src 'self'; script-src 'self'; … object-src 'none'` served with every `app://` asset |
| Origin of record | Assets served from `app://nextora` (a scheme with a real origin), never `file://` |
| Network access | `connect-src 'self'`; the app makes no outbound request for core features |
| Navigation | `will-navigate` restricted to the app origin; `setWindowOpenHandler` opens only `https:`/`mailto:` externally |
| API access | Session cookie held by the main process; origin, `sec-fetch-site`, CSRF token, role and rate-limit checks all unchanged |
| Secrets | Passwords hashed with scrypt; the local rate-limit key is a per-install secret file, never in the repository |
| Data files | Live in `app.getPath('userData')`, outside the install directory, so upgrades cannot overwrite business data |

## 8. Where data lives

```text
%APPDATA%\nextora-invoicing\            (app.getPath('userData'))
├── nextora-invoicing.sqlite            the business database
├── nextora-invoicing.sqlite-wal        write-ahead log (normal while running)
├── nextora-invoicing.sqlite-shm
├── local-security.key                  per-install rate-limit secret
└── backups\pre-restore-safety-*.sqlite automatic copy made before each restore
```

Nothing is written to the install directory, the application bundle, the source
tree or a temp folder. PDFs and exports are generated on demand into the OS temp
directory and are never kept.

## 9. Backup and restore

`server/backup.js`:

1. `createBackup` uses SQLite's own `backup()` API (a consistent online copy, safe
   while the app is open), then validates the result.
2. `validateBackupFile` checks the SQLite magic header, `PRAGMA integrity_check`,
   `PRAGMA foreign_key_check`, that every table the shipped DDL creates is present
   (the list is read from the migrations, so it cannot drift), and that the applied
   migration names and checksums match this build. A backup from a newer version is
   refused with `NEWER_SCHEMA_VERSION` rather than half-restored.
3. `restoreBackup` copies the candidate to a staging file, re-validates it, writes an
   automatic safety backup of the live database, then swaps the file atomically and
   reopens the connection. The session belongs to the database that was replaced, so
   the user signs in again.

Every validation failure returns a specific `4xx` code (`BACKUP_NOT_FOUND`,
`INVALID_BACKUP`, `CORRUPT_BACKUP`, `INCOMPATIBLE_SCHEMA`, `NEWER_SCHEMA_VERSION`)
so the Settings screen can explain what is wrong with a file.

## 10. Storage footprint

- The database is a single file; this application's data volumes sit in the low MBs.
- WAL is enabled but never auto-vacuumed on launch — integrity and history outrank
  marginal savings. `VACUUM INTO` is only ever used to produce a backup.
- No PDFs, exports or previews are persisted; the logo is stored once and reused.
- The packaged app ships the Vite bundle (~200 KB of JS plus the CSS), the server
  modules, `pdf-lib`, `exceljs` and `zod`. `compression: maximum`, `asar` packing and
  `electronLanguages: ["en-US"]` keep the installer small by dropping the unused
  Electron locale bundles.

## 11. Packaging and updates

- **electron-builder**, NSIS target, x64, per-user install (`perMachine: false`),
  `deleteAppDataOnUninstall: false` so business data survives uninstall.
- `appId` `co.nextoracreations.invoicing`, product name *Nextora Invoice Generator*.
- Update path today: build a new installer and run it over the existing version —
  migrations upgrade the schema in place on first start, and userData is untouched.
  electron-builder's NSIS web-update channel can be enabled later behind a signed
  release feed; until such a feed exists, this is documented rather than implied.

## 12. How the architecture was verified

| Layer | Evidence |
| --- | --- |
| Business logic, on SQLite | `npm test` — 86 integration tests driving the real handler against SQLite (quotations, invoices, GST, payments, tracker, Excel import/export, shares, PDFs, reports, audit) |
| Dialect translation | `tests/sqlite-dialect.test.js` — one test per rewrite rule, plus DDL pass-through |
| Desktop config and first run | `tests/desktop.test.js` — desktop origin accepted only in a desktop build; a clean database bootstraps its owner and issues a usable session; a second attempt is refused |
| Backup and restore | `tests/desktop.test.js` — create, verify, refuse junk and missing files, restore, prove the post-backup change was rolled back and the API still serves |
| The real application | `npm run smoke:desktop` — launches the actual Electron main process on the packaged code path (`app://`, CSP, IPC, SQLite in userData), completes first-run setup, renders the dashboard and the POS tracker, and asserts a foreign origin is refused |

## 13. Known limitations

1. **Public share links cannot work offline.** A public link is by definition
   reachable by someone else, so it needs the hosted build. The local database keeps
   the entire sharing model (definition, hashes, expiry, revoke, column scope) and
   private shares within the app work; publishing a link to the internet does not.
2. Single-writer database. One desktop process at a time; opening the same userData
   from two instances is not supported.
3. The installer is unsigned unless a code-signing certificate is configured, so
   Windows SmartScreen may warn on first run.
4. `pg` remains a dependency of the shared codebase so the web build keeps working;
   it is bundled but unused when `DATABASE_URL` is unset.
5. Web fonts are requested from Google Fonts on first run; offline the UI falls back
   to system fonts without affecting any function.
