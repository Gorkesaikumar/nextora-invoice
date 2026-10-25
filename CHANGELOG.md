# Changelog

All notable changes to the Nextora Creations Invoice Generator will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.2] - 2026-10-25

### Added
- **Business Data Cleanup & Space Saving Subsystem:**
  - Added administrative Business Data Cleanup page under Settings restricted to `OWNER` and `ADMIN` roles.
  - Independent cleanup operations for Quotations (Drafts, Issued, Expired, Rejected) and Invoices (Unpaid, Cancelled, Overdue without financial dependencies).
  - Multi-format export engine generating multi-sheet Excel workbooks (`.xlsx`), formula-sanitized CSV archives (`.csv`), compiled human-readable PDFs (`.pdf`), and complete structured JSON backups (`.json`).
  - Pre-deletion cryptographic verification verifying file existence, non-empty byte count, record and ID parity, and computing SHA-256 checksums.
  - Deletion safeguards requiring explicit confirmation phrase (`DELETE QUOTATIONS` or `DELETE INVOICES`).
  - Automated pre-cleanup database safety backup verified prior to mutation.
  - Transactional deletion engine utilizing ephemeral `inv_cleanup_context` session keys to safely bypass DDL guard triggers without compromising runtime immutability.
  - SQLite storage reclamation pipeline (`PRAGMA wal_checkpoint(TRUNCATE)`, connection statement cache eviction, and `VACUUM`) reporting measurable disk space reclaimed.
  - Comprehensive integration test suite in `tests/cleanup.test.js` covering 17 critical business workflows and edge cases.
- **Secure Repository & Version Control Configuration:**
  - Established root `.gitignore` securing sensitive credentials, `.env*` files, live SQLite databases (`data/`), backups, exports, build artifacts (`dist/`, `release/`), and temporary logs.
  - Official remote connection to `https://github.com/Gorkesaikumar/nextora-invoice.git`.

### Security
- Excluded live mutable databases, customer data, and development secrets from source control.
- Protected accounting integrity by strictly blocking invoices with payments, credit notes, or POS subscriptions from deletion.
- Guaranteed complete preservation of Products & Services, Clients, Business Settings, User Accounts, and Audit Trail during data cleanup.

---

## [1.1.1] - 2026-10-25

### Fixed
- **PDF Generation Asset Failure (`ENOENT: NotoSans-Regular.ttf`):**
  - Resolved root cause where `server/pdf.js` resolved fonts using `resolve(process.cwd(), 'server/assets/NotoSans-Regular.ttf')`, causing `ENOENT` crashes in packaged Windows installations located in `C:\Program Files\Nextora Invoice Generator\` because `process.cwd()` points to the install root where the asset is not directly on disk.
  - Implemented multi-candidate dynamic path resolution (`resolveFontPath`) probing:
    1. Module-relative path (`fileURLToPath(import.meta.url)` -> `server/assets/`)
    2. Unpacked ASAR asset directory (`process.resourcesPath/app.asar.unpacked/server/assets/`)
    3. External resources directory (`process.resourcesPath/assets/`)
    4. Working directory fallbacks (`process.cwd()/server/assets/`, `process.cwd()/assets/`)
  - Added in-memory font buffer caching (`fontCache`) to eliminate repeated filesystem I/O during batch or repeated document generation.
  - Added structured error handling with `FONT_NOT_FOUND` error code and human-readable diagnostics.
- **Packaging Asset Bundling:**
  - Configured `asarUnpack: ["server/assets/**/*"]` in `package.json` to ensure font binaries are cleanly extracted if required by native PDF engines.
  - Added `extraResources` entry copying `server/assets` to `assets` directory alongside `app.asar`.
- **Desktop Main Process `doc:open` IPC Reliability:**
  - Added comprehensive input validation on requested document paths (`/api/*`).
  - Added empty buffer detection preventing blank preview windows.
  - Converted unhandled IPC exceptions into structured error payloads `{ ok: false, status, error }` received gracefully by the renderer.

### Added
- **Automated Font Resolution Regression Tests:**
  - Added unit test cases verifying font path discovery and in-memory buffer loading in `tests/pdf.test.js`.
  - Added failure mode test ensuring structured `FONT_NOT_FOUND` error is thrown for missing font assets.
- **End-to-End Desktop Smoke Test for PDF Generation:**
  - Updated `scripts/desktop-smoke.mjs` to issue an invoice and invoke `openDocument` through the Electron preload IPC bridge in packaged mode, validating end-to-end PDF generation, font embedding, and preview window launching.

---

## [1.1.0] - 2026-10-25

### Fixed
- **Erroneous "Session Ended" Banner on Startup:**
  - Resolved root cause where cold-start probing of `/api/auth/me` unconditionally triggered the unauthenticated handler in `src/lib/api.js`.
  - Added silent probe mode for startup checks so unauthenticated launches display a clean sign-in screen without an error alert.
  - Restricted "Your session ended. Please sign in again." alert strictly to genuine mid-session expirations or invalidations.
- **Session Persistence Across Application Restarts:**
  - Added DPAPI/encrypted persistent local session storage via Electron `safeStorage` in `userData/local-session.dat`.
  - Valid user sessions now survive application restarts seamlessly until explicit sign-out or session expiration.

### Added
- **Create Account (Staff Registration):**
  - Added `POST /api/auth/register` API endpoint with rate limiting and schema validation.
  - Implemented staff registration form on the login screen with validation for email format, password matching, and minimum password length (10 characters).
  - Enforced internal staff security policy: new self-registered staff accounts are granted the `FINANCE` role (operational access to invoices and quotations, not administrative rights).
- **Forgot Password / Account Recovery:**
  - Added local account recovery workflow designed specifically for offline/desktop environments without external SMTP dependencies.
  - Added `POST /api/auth/recover` endpoint enabling password resets using a confidential Business Recovery Key.
  - Added recovery form on login screen allowing users to safely reset forgotten passwords.
  - Added Master Recovery Key configuration form under Settings (accessible only to Owners and Administrators).
  - Added `docs/USER_ACCOUNT_RECOVERY.md` providing comprehensive operator documentation for the recovery procedure.
- **Authentication UI/UX Modernization:**
  - Added show/hide password toggles on all password inputs across Sign In, Setup, Create Account, and Recovery screens.
  - Added smooth switching between Sign In, Create Account, and Forgot Password views.
  - Enhanced accessible focus management, loading states, and duplicate submission prevention.
- **Database Migration `004_auth_recovery.sql`:**
  - Added `recovery_key_hash` column to `inv_business_settings` (PostgreSQL and SQLite).
  - Added partial index on active user emails `users_email_active_idx`.
  - Preserved 100% of historical invoices, quotations, payments, and clients.
- **Comprehensive Authentication Test Suite:**
  - Created `tests/auth.test.js` covering all 20 required authentication scenarios.
  - Full suite expanded to 106 automated tests (all 106 passing).

### Security
- Used salted `scrypt` hashing ($N=32768, r=8, p=1$) for all newly created passwords and recovery keys.
- Applied HMAC-SHA256 rate-limiting on registration and recovery attempts per IP and per account.
- Purged all prior active user sessions immediately upon password reset.
- Maintained strict Electron sandboxing (`contextIsolation: true`, `nodeIntegration: false`, CSP `default-src 'self'`).

### Known Limitations
- Code signing certificate is not configured; Windows SmartScreen may present an unknown publisher prompt on first launch.
- Password recovery is local-only via the Business Recovery Key; automated remote email delivery is omitted by design for offline security.
