# Changelog

All notable changes to the Nextora Creations Invoice Generator will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.3] - 2026-10-25

### Added
- **Influencer Marketing & Revenue-Sharing Contracts Management:**
  - Added full administrative **Marketing & Partnerships** module with navigation items for Overview, Influencers, Contracts & Agreements, Import Sales Excel, Influencer Sales Reports, and Brand Assets.
  - Comprehensive Influencer Profiles storing legal name, display name, normalized Instagram handle (`@username`), profile URL, phone with country code, email, full address, social handles, niche, followers count, internal notes, and avatar/photo data URI.
  - Revenue-Sharing Agreement lifecycle (`DRAFT` → `PENDING_APPROVAL` → `APPROVED` → `SIGNED` → `ACTIVE` → `COMPLETED` / `TERMINATED` / `EXPIRED`).
  - Strict contract immutability once signed or activated, capturing full legal snapshots of brand settings, influencer details, commercial terms, and signature records.
  - Multi-tier and flat revenue-share calculation modes, milestone-based commission schedules, minimum sales thresholds, and TDS withholding support (Section 194H / 194J).
  - Agreement termination workflow with formal notice periods, effective dates, and audit trail recording.
- **Influencer Sales Tracking & Smart Excel Import Engine:**
  - Standardized Excel template generation (`/api/marketing/sales/template.xlsx`) prefilled with valid active products, influencers, and sample data.
  - Flexible column header alias resolution matching arbitrary user naming conventions (`Customer Name`, `customer_name`, `Client`, `Business Name`, `Company`, `Purchased Date`, `Txn Date`, `Product`, `Influencer`, etc.).
  - Robust multi-format date parser handling Excel serial numbers, ISO-8601 strings, `DD/MM/YYYY`, `MM/DD/YYYY`, and textual dates.
  - Pre-import validation preview returning valid, invalid, duplicate, and unmapped rows with detailed inline diagnostics before committing.
  - Safe import batch processing (`POST /api/marketing/sales/import`) with batch attribution, influencer remapping, and idempotent deduplication against both file records and historical database sales.
  - Per-sale status transitions (`PENDING_VERIFICATION` → `VERIFIED` → `COMMISSION_ACCRUED` → `SETTLED` / `DISPUTED` / `CANCELLED`).
  - Commission recalculation engine ensuring zero false payouts by restricting commission entitlement strictly to verified sales linked to active revenue-sharing agreements.
  - Export segregated sales records to stylized Excel workbooks (`.xlsx`) with automated totals and summary tabs.
- **High-Fidelity PDF Generation Engines:**
  - Legal Contract Generator (`server/contract-pdf.js`): Vector PDF renderer producing formal partnership agreements with Nextora Creations branding, optional influencer logo/photo, scope of work, commercial terms, confidentiality, intellectual property, termination clauses, and dual signature blocks.
  - Landscape A4 Sales Report Generator (`server/sales-report-pdf.js`): Multi-page tabular PDF generator featuring company branding, summary metric cards, repeated table headers across page breaks, Indian currency formatting, and page numbering.
- **Configurable GST Pricing Engine (Inclusive vs Exclusive):**
  - Added global business setting `product_price_tax_mode` (`EXCLUSIVE` | `INCLUSIVE`) with seamless UI toggle in Business Settings.
  - GST-inclusive pricing backward calculation: accurately splits entered gross price (e.g., ₹5,999 with 18% GST yields taxable ₹5,083.90, CGST ₹457.55, SGST ₹457.55, and final customer payable ₹5,999.00).
  - GST-exclusive pricing forward calculation: ₹5,999.00 taxable + 18% GST (₹1,079.82) yields final customer payable ₹7,078.82.
  - Invariant snapshot preservation: issued invoices and converted quotations preserve their original pricing tax mode immutably.
- **End-to-End Test Suite & Desktop Automation:**
  - Added `tests/e2e-scenarios.test.js` validating 9 comprehensive scenarios including customer tracker creation, GST-exclusive pricing, GST-inclusive pricing, contract lifecycle & PDF generation, Excel import & deduplication, sales report PDFs, document conversion, and security restrictions.
  - Added `tests/influencer-sales.test.js` and `tests/marketing.test.js`.
  - Expanded automated test suite from 106 to 161 tests with 100% pass rate.

### Fixed
- **Customer Tracker `r is not a function` Modal Crash:**
  - Resolved regression where minified production builds passed an array to `openCustomerModal` while the code invoked `employees()` as a function.
  - Safely normalized parameter handling to support both array and factory function inputs: `Array.isArray(employees) ? employees : (typeof employees === 'function' ? employees() : [])`.
  - Added debounce protection (`isSaving`) on the Add Customer submission handler to prevent accidental double-submits.
- **Products Catalog Responsive Layout Overflow:**
  - Resolved horizontal viewport clipping on mobile and compact screens by adding container responsiveness, padding constraints, and flexible table overflow wrappers.

### Security
- Applied strict role-based access control (`OWNER` and `ADMIN`) across all marketing, agreement, sales import, and commission mutation endpoints.
- Enforced complete database-level snapshotting preventing tampering with active or executed marketing agreements.
- Protected commission payouts by preventing automatic attribution on disputed, cancelled, or unverified sales.

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
