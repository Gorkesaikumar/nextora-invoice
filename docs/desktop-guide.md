# Nextora Invoicing — desktop guide

Operator and developer guide for the Windows desktop build (Electron + local
SQLite). Architecture detail lives in [desktop-architecture.md](desktop-architecture.md).

---

## For the person using the application

### Installing

1. Run `Nextora Invoice Generator Setup <version>.exe`.
2. Choose an install folder (the default is fine). The installer is per-user, so no
   administrator rights are required.
3. Launch **Nextora Invoicing** from the Start menu or the desktop shortcut.

### First run

The application opens on **Set up invoicing**. Enter your name, email and a password
of at least ten characters, then the business name and GST state code. This creates
the owner account for this computer; a local database is created next to your user
profile. Nothing is uploaded and no internet connection is used for this step.

After that the application opens on the dashboard. Sign in with the same email and
password on every later start.

### Where your data is stored

```text
%APPDATA%\nextora-invoicing\nextora-invoicing.sqlite
```

(Full path: `C:\Users\<you>\AppData\Roaming\nextora-invoicing\nextora-invoicing.sqlite`.)

Settings → **Local database** shows the exact path, the current size and how many
records are stored. `Open data folder` opens that folder in File Explorer.

Your data is **not** stored in the install folder, so updating or reinstalling the
application never overwrites it.

### Backing up

Settings → **Local database** → **Back up database**. Choose where to save the file
(for example a USB drive or a synced folder). The backup is a complete copy of the
database, and the application verifies its integrity and schema before reporting
success. Keep backups regularly; they are ordinary files you can copy or archive.

### Restoring

Settings → **Local database** → **Restore from backup**, choose a backup file and
confirm. Before anything is replaced the application:

1. verifies the file is a healthy SQLite database,
2. checks it contains the full application schema and matching migrations,
3. saves an automatic safety copy of your current database in the `backups`
   subfolder of the data folder.

Restoring signs you out, because the restored database has its own accounts. Backups
created by a newer version of the application are refused rather than partially
loaded — update the application first.

### Updating

Install the newer version over the existing one. On first start the application
upgrades its database schema in place; your records, users and settings are kept.
There is no automatic updater yet, so install a new build when it is provided.

### Files you can produce

- **PDF**: quotations, invoices, receipts and credit notes open in a preview window;
  use the native Print dialog (Ctrl+P) or save a copy from the preview.
- **Excel / CSV**: the POS customer tracker exports and imports `.xlsx` and `.csv`
  locally, including a preview, column mapping and a downloadable error report for
  rejected rows.

### Working offline

Quotations, invoices, clients, products, payments, POS customers, subscriptions,
custom columns, imports, exports, printing and backups all work with no network. The
only feature that cannot work offline is publishing a public share link, because
that requires a hosted service.

### Troubleshooting

| Symptom | What to do |
| --- | --- |
| "Your session ended" | Sign in again. Sessions expire after eight hours. |
| Forgot the owner password | There is no recovery email. Reset it from a terminal: `npm run owner:create` with `OWNER_EMAIL` and `OWNER_PASSWORD` set, run from a source checkout. |
| Application opens but shows an empty list | Check Settings → Local database that the size is not 0 bytes, then restore your latest backup. |
| "The selected file is not a valid SQLite database" | The file is not a backup this application made. Use a file produced by **Back up database**. |
| "The backup was created by a newer application version" | Install the newer application build, then restore. |
| Windows SmartScreen warning on first run | The installer is not code-signed. Choose *More info* → *Run anyway*, or configure a code-signing certificate when building. |
| Fonts look different / plain | Weights come from web fonts; offline the system fonts are used instead. Functionality is unaffected. |

---

## For the developer

### Requirements

- Node.js ≥ 22.15 (24.x recommended; matches the Electron runtime)
- npm
- Windows x64 for packaging

### Install and run

```bash
npm install
npm run dev:desktop     # Vite dev server + Electron, hot reload
```

`npm run dev` instead runs the *web* build (API server + Vite) against PostgreSQL.
The desktop build never starts that server.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev:desktop` | Desktop app in development (Vite + Electron) |
| `npm run dev` | Web build (API on :8888 + Vite on :5174) |
| `npm run build` | Build the renderer bundle into `dist/` |
| `npm run pack:desktop` | Unpacked build in `release/win-unpacked` (fast packaging check) |
| `npm run build:desktop` | Full NSIS installer in `release/` |
| `npm test` | Full suite against a disposable SQLite database |
| `npm run test:postgres` | Same suite against a disposable PostgreSQL container |
| `npm run smoke:desktop` | Launches the real Electron app and drives first-run setup |
| `npm run db:migrate` | Apply migrations to the database in `DATABASE_PATH` |
| `npm run owner:create` | Create or reset the owner account (web/dev use) |

### Data location in development

Development uses the same `app.getPath('userData')` directory as the installed app,
so a bug cannot be hidden by a different path. To keep an experiment separate:

```bash
DATABASE_PATH=/c/temp/scratch.sqlite npm run dev:desktop
```

### Verification before shipping a build

```bash
npm test                       # business logic, dialect, desktop config, backup/restore
npm run build && npm run smoke:desktop
npm run build:desktop          # produces release/Nextora Invoice Generator Setup <version>.exe
```

`npm run smoke:desktop` writes `tmp/desktop-smoke-result.json`; it exercises the
packaged code path (`app://` assets, CSP, IPC, SQLite inside userData), completes
first-run setup, opens the dashboard and the POS tracker, and asserts a foreign
origin is still refused. Run it after `npm run build`.

### Adding a migration

Add a new numbered `.sql` file to `server/migrations-sqlite/` (and to
`server/migrations/` if the PostgreSQL build must stay in step). Never edit a
migration that has been applied — the checksum is verified on every start and at
restore time. The required-table list used by backup validation is derived from
these files, so a new table is covered automatically.

### Adding an IPC action

Add the handler in `electron/main.js`, expose one narrow function in
`electron/preload.cjs`, and call it through `src/lib/api.js` with a
`window.electronAPI` guard so the web build keeps working unchanged.
