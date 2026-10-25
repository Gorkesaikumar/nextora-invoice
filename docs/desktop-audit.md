# Phase 1 — Codebase Audit (Electron + SQLite Conversion)

Date: 12 Oct 2026 · Repository: `D:\NEXTORA-INVOICE-GENERATOR`

## 1. Existing application architecture

Two-tier web application, single origin in production.

| Layer | Implementation |
| --- | --- |
| Frontend | Vite 5 + Tailwind 3 SPA, vanilla ES modules. Router in `src/main.js` (249 lines) with hash routes (`#/dashboard`, `#/invoices`, `#/tracker`, …), views in `src/views/`, shared UI kit `src/lib/ui.js`, API client `src/lib/api.js` (plain `fetch('/api/…')`) |
| Backend | Node ≥ 22 ESM. `server/local.js` is the only HTTP surface; it adapts `node:http` → `Request` and calls `createAPI(db, config)` from `server/api.js` (817 lines of routing), which returns a standard `Response` |
| Business logic | `service.js` (clients/products/settings), `documents.js` (quotations, invoices, payments, adjustment notes), `reports.js`, `tracker.js` (POS customers), `excel.js`, `sharing.js`, `money.js` + `gst.js` + `words.js` (pure calculation, no I/O), `pdf.js` + `pdf-labels.js` (PDF built with pdf-lib/fontkit — no browser print engine) |
| Validation | zod v4 schemas in `server/domain.js` (371 lines), shared by every endpoint |
| Auth | scrypt password hashing (`server/auth.js`), DB-backed sessions (token hash + CSRF token), origin/`sec-fetch-site` checks, per-key rate limits — all enforced inside `createAPI` |
| Database | PostgreSQL 17 (`compose.yaml`, `127.0.0.1:54330`), `pg` driver, schema `inv.*`, forward-only checksummed migrations (`scripts/migrate.js`) |
| Money | Integer minor units everywhere; `pg.types` parsers force bigint → safe integer and dates → plain strings |
| Tests | `node --test`, 8 files ≈ 1,900 lines. `scripts/test.js` boots a disposable Postgres container per run. **Tests call `createAPI` with real `Request` objects** (`tests/helpers.js`) — they never bind a socket |
| Deploy | Netlify functions build for the hosted path; `npm run dev` runs API + Vite together |

Not a git repository (no `.git`), so there are no uncommitted changes to preserve; file state is authoritative on disk.

## 2. Features and workflows that must be preserved

- Quotation lifecycle (draft → sent → accepted/rejected/expired/cancelled) with conversion to invoice.
- Invoice issue/cancel/void, GST (CGST/SGST/IGST, intra vs inter state), discounts, round-off, amount-in-words.
- Payment recording, receipts, balance due, ageing/receivables/tax/revenue reports.
- Immutable issued documents: append-only payments/audit/status-history and immutability triggers.
- POS customer tracker: 10 default columns, dynamic rows/columns (11 custom field types), subscriptions and expiry, employees, plans, Excel/CSV import + export with error reports.
- Sharing: private read-only shares and explicitly-configured public links (token hash, expiry, revoke, column scope).
- PDF preview/download/print, logo, business settings, audit trail, dashboard metrics.

## 3. Dependencies that require modification or replacement

| Dependency | Status | Action |
| --- | --- | --- |
| `pg` (PostgreSQL driver) | **Replace** for the desktop build | SQLite driver behind the same `db.query` / `db.transaction` interface; `pg` stays available only when `DATABASE_URL` is explicitly set (dev/web parity) |
| `server/local.js` (HTTP server) | **Remove from the desktop runtime** | Replaced by in-process IPC dispatch; no port is bound |
| `exceljs`, `pdf-lib`, `@pdf-lib/fontkit`, `zod` | Keep | Pure JS, run unchanged in the Electron main process |
| `server/db.js` type parsers | **Reimplement** | Boolean, bigint-safety, jsonb/array decode and bytea handling move into the SQLite adapter |
| PL/pgSQL trigger functions (001) | **Hand-port** | Procedural bodies cannot be translated; rewritten as native SQLite triggers |
| Vite/Tailwind | Keep | Build once, load from the app bundle (`vite build`) |

## 4. Electron integration approach

**Key enabler found in the audit:** `createAPI(db, config)` is a pure `(Request, {ip}) => Response` function and the entire test suite already drives it with synthetic `Request` objects. Therefore:

```
Renderer (unchanged views)                     Electron main process
  src/lib/api.js  ──IPC invoke──▶  preload contextBridge  ──▶ dispatch(method, path, headers, body)
      fetch() is replaced by the bridge only when window bridge exists
                                                             └─▶ createAPI(sqliteDb, config)
                                                                    └─▶ Request → Response (in process)
```

- No HTTP server, no port, no CORS: the same middleware (auth, CSRF, origin, rate limits) runs unchanged.
- The main process owns the session cookie (captured from `set-cookie`) and re-attaches it to each synthetic request, preserving the existing login/CSRF flow with zero renderer changes beyond the transport.
- `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, restrictive CSP delivered by a custom `app://` protocol (so the web build's CSP is untouched), external links opened by a main-process handler.
- Preload exposes exactly one operation, `request(spec)`, instead of a raw IPC surface.

## 5. SQLite data model and migration strategy

- Schema stays identical in meaning: all `inv.*` tables are ported 1:1 (clients, products, quotations, quotation_items, quotation_milestones, invoices, invoice_items, payments, adjustment_notes, document_status_history, audit_logs, business_settings, company_assets, sessions, users, rate_limits, document_sequences, and the POS tables: pos_customers, pos_subscriptions, pos_employees, pos_subscription_plans, custom_field_definitions, custom_field_values, pos_shares, pos_share_recipients, pos_share_customers, pos_share_access, pos_column_layout).
- `inv.` schema prefix becomes the `inv_` table-name prefix (SQLite has no schemas).
- Custom fields remain **rows, not columns**: definitions + values tables, so adding a spreadsheet column never needs a migration.
- Money stays `INTEGER` minor units; dates stay `TEXT` (`YYYY-MM-DD`), timestamps `TEXT` UTC — matching the current parsers exactly.
- JSON payloads (`totals`, `snapshot`, `additional_charges`, `metadata`) stay JSON text; the adapter decodes/encodes them by declared column type so JS code sees the same objects `pg` produced.
- `text[]` (`editor_roles`) is stored as a JSON array text with the same decode behaviour.
- Same forward-only checksummed migration mechanism (`schema_migrations`), separate DDL directory `server/migrations-sqlite/` because DDL is genuinely dialect-specific (triggers, `REGEXP` checks, array defaults).
- Concurrency: single writer, WAL, `busy_timeout`, foreign keys on; transactions serialized through one connection (SQLite's own locking model).

**Dialect surface measured (not guessed):** `$n` placeholders, `ILIKE` (50), `::date` (63), `::bigint` (55), `::int` (51), `::uuid` (17), `now()` (47), `current_date` (43), `date_trunc` (2), `to_char` (1), `json_agg`/`array_agg` (1 each), `= ANY()` (1), two `interval` expressions, one `LEFT JOIN LATERAL`. `FILTER (WHERE …)`, `RETURNING`, `NULLS LAST`, `ON CONFLICT`/`EXCLUDED` are **native SQLite ≥ 3.30** and need no translation. The two `LATERAL`/`array_agg` sites are rewritten by hand to portable equivalents.

## 6. Expected storage footprint and optimization plan

- SQLite is a single file; business records of this scale are expected to stay in the low MBs. No PDFs, exports or previews are persisted — PDFs are generated on demand (pdf-lib, streaming to a temp file only when the OS needs a path), exports are generated per request and discarded.
- WAL enabled; `wal_autocheckpoint` default. **No auto-vacuum on every launch** — integrity and history outrank marginal savings; `VACUUM INTO` is used only for backups, never as cleanup.
- Logo stored once, compressed (existing 24 B–500 KB check retained), served from the DB as bytes rather than duplicated on disk.
- Temporary files (PDF/print) go to a dedicated app temp directory and are cleaned at exit.
- Audit payloads stay small (existing metadata JSON, append-only triggers preserved).

## 7. Windows packaging and update strategy

- **electron-builder** `nsis` target, x64, per-user install; `appId` `co.nextoracreations.invoicing`.
- App data lives in `app.getPath('userData')` (`%APPDATA%\nextora-invoicing\`) — never in `Program Files`, so upgrades preserve data.
- NSIS config keeps user data on uninstall and on upgrade (`deleteAppDataOnUninstall: false`); migrations run on every start before the window opens, so an upgraded binary upgrades the schema in place with the existing checksummed runner.
- Updates: electron-builder's NSIS web-update channel can be enabled later with a signed feed; until a release feed exists, the documented path is "build new installer → run it over the old version". Documented as a limitation.
- Native module risk: decided by probe (see §9) — the chosen driver must load inside Electron without a compiler toolchain on the target machine.

## 8. Potential compatibility and security risks

| Risk | Assessment / mitigation |
| --- | --- |
| SQL dialect translation errors | Mitigated by the existing 1,900-line suite, which drives the real handler and is run against SQLite; every translation rule has a unit test |
| PL/pgSQL triggers lost in translation | Immutability guards are re-expressed as native SQLite triggers and re-tested (issued-document immutability is covered by tests) |
| Timestamp format change (`timestamptz` → UTC text) | Renderer only slices dates and parses them; verified by tests + UI check |
| Money precision | SQLite INTEGER + the existing safe-integer guard; never a float |
| Session/auth regression in IPC transport | Login, CSRF and role checks run unchanged inside `createAPI`; covered by API tests over the bridge |
| Renderer reaching the network | CSP allows only app assets and Google Fonts (degrades gracefully offline); no remote API |
| Public share links | **Cannot work offline by definition** — kept as a local foundation and documented as requiring a hosted service (Phase 6) |
| `node:sqlite` / native driver availability in Electron | Resolved empirically by probing the installed Electron runtime (see §9), not by assumption |

## 9. Driver decision (empirical)

Probed against the installed Electron runtime: which SQLite API loads natively (no compile step), whether it supports user-defined functions and `VACUUM INTO` for backups. Result recorded in `docs/desktop-architecture.md`.
