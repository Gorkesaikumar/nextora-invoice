# Changelog

All notable changes to the Nextora Creations Invoice Generator will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.7] - 2026-10-26

### Fixed
- **Influencer Contract Preview & Downloaded PDF Parity (Single Source of Truth)**:
  - Fixed discrepancy between influencer contract preview and downloaded PDF across document structure, logos, metadata, deliverables, and calculations.
  - Implemented authoritative `buildContractSnapshot` in `server/marketing.js` resolving base64 data URIs for company and Nextora POS product logos with SHA-256 integrity hashes.
  - Enforced snapshot immutability for finalized contracts (`ACCEPTED`, `SIGNED`, `ACTIVE`, `TERMINATED`, `ARCHIVED`) so future logo or business setting changes do not alter historical documents.
  - Added automatic cache invalidation (`snapshot = NULL`, `pdf_generated_at = NULL`) whenever draft agreements are edited.
  - Rewrote `server/influencer-contract-template.js` into an exact 3-page paginated A4 layout (`.nc-a4-page`) matching `server/contract-pdf.js` page-for-page and line-for-line.
  - Page 1 includes Header with dual logos (or text fallback), contract title, 4-column summary metadata box (`CONTRACT NUMBER`, `EFFECTIVE START DATE`, `REVENUE SHARE`, `GST TREATMENT`), Section 1 (Parties), Section 2 (Purpose), Section 3 (Scope of Work & Deliverables table), and Page 1 footer.
  - Page 2 includes Running Header, Section 4 (Revenue sharing calculation table, calculation mechanics, and Telangana intra-state / interstate GST breakdown cards), Section 5 (Confidentiality), Section 6 (Representations & Warranties), and Page 2 footer.
  - Page 3 includes Running Header, Section 7 (Payment schedule & TDS under 194H), Section 8 (Term & Termination), Section 9 (General Legal Provisions), Section 10 (Execution & Signature cards with disclaimer note), and Page 3 footer.
  - Unified all endpoints (`preview`, `html`, `generate-pdf`, `pdf`) to consume the identical canonical snapshot.
  - Updated frontend preview (`src/views/marketing.js`) to render the canonical HTML directly and display draft branding notices or sealed snapshot badges.

## [1.1.6] - 2026-10-26

### Fixed
- **Reports Export PDF Button Icon Rendering**:
  - Replaced unmapped ligature `file-text` in `src/views/reports.js` with `picture_as_pdf`.
  - Added inline SVG definitions to `SVG_ICONS` in `src/lib/ui.js` for `picture_as_pdf`, `file-text`, `file_text`, and `loyalty`, preventing raw text fallback (`FILE-TEXT`).
  - Preserved accessible name `Export PDF`, styling, alignment, and CSV export functionality.
- **Software Services Contract Preview & Downloaded PDF Parity (`NC/SDA/2026-27/0001`)**:
  - Upgraded Page 1 in `server/software-contract-pdf.js` to draw the canonical centered layout matching the on-screen preview.
  - Centered company logo, centered company name (`NEXTORA CREATIONS`), address, contact information, and GSTIN/State.
  - Added centered 4-pill metadata row (`CONTRACT NUMBER`, `DATE`, `STATUS`, `CATEGORY`).
  - Added full-width divider line and styled title banner with left accent stripe.
  - Added 4-column summary metadata card grid (Project Title, Timeline, Support, Status).
  - Maintained all 10 canonical sections, Schedule A feature tables, GST calculations, and multi-page continuity.
- **Client Archival and Delete Functionality**:
  - Restored `api.del` in `src/lib/api.js` (resolving `h.del is not a function`).
  - Implemented intelligent archival and safety deletion in `src/views/clients.js`.

### Added
- **Playwright End-to-End Verification Suite**:
  - Automated Chromium test suite (`tests/run_playwright_verification.py`) validating Reports button rendering, contract preview vs download parity, visual comparison, and zero browser console errors.

## [1.1.5] - 2026-10-26

### Fixed
- **Software Services Contract PDF Layout & Preview Parity**:
  - Implemented shared canonical HTML renderer (`server/software-contract-template.js`) providing a single source of truth for both on-screen contract preview and standalone HTML document export.
  - Replaced divergent 8-section preview template in `src/views/software-contract-editor.js` with canonical 10-section renderer matching the PDF output.
  - Dynamically recalculate and reconstruct fresh snapshot for `DRAFT` contracts during preview and PDF generation to guarantee preview and download reflect latest edits.
- **Centered Company Logo & Header Structure**:
  - Horizontally centered Nextora Creations company logo relative to page width in both PDF (`(A4.width - scaled.width) / 2`) and HTML (`nc-logo-wrap`).
  - Constrained logo to max 140 CSS px / pt width and 56 pt / 60 px height with `object-fit: contain` and strict aspect ratio preservation.
  - Centered company name, address, contact details, and GSTIN below logo, followed by 4-column metadata card and thin cyan divider line.
  - Added clean uppercase text fallback if logo asset is unavailable.
- **Table Formatting & Overflow Prevention**:
  - Wrapped Milestone Name and Trigger/Deliverable columns dynamically in Section 5 with multi-line height calculation, eliminating text overlap.
  - Enforced minimum follow-up height checks in `drawSectionHeading` to prevent orphaned headings (e.g. Section 8 Monthly Maintenance Plan separated from its terms).
  - Wrapped Section 10 legal footnote to page content width to prevent margin clipping.
- **Document Export Endpoints**:
  - Added `GET /api/marketing/software-agreements/:id/html` for standalone contract HTML downloads with full stylesheet.

### Added
- **Automated Regression Test Suite Expansion**:
  - Added integration test validating canonical HTML preview, centered company logo parity, reference contract `NC/SDA/2026-27/0001` commercial calculations (₹20,000 base, ₹2,000 advance, ₹18,000 balance), Section 5 wrapping, and multi-page vector PDF generation (176 total passing tests).

## [1.1.4] - 2026-10-25

### Fixed
- **Brand Assets & Nextora POS Product Logo Upload (Resolving HTTP 413 "Request body is too large")**:
  - Expanded request body size limits in `server/api.js`: raised product logo endpoints (`POST /api/settings/product-logo` & `POST /api/marketing/product-logo`) limit to 2 MB (`2097152`), and corporate logo (`POST /api/settings/logo`) to 1 MB (`1048576`).
  - Added binary JPEG SOF segment parsing and PNG IHDR chunk inspection, enforcing dimensions between $40 \times 20$ and $2500 \times 2500$ px without image distortion.
  - Implemented `GET /api/settings/logo` returning binary image stream with correct `image/png` content-type and cache headers.
  - Implemented `GET /api/marketing/brand-assets` returning structured metadata and Base64 data URIs for product and company brand assets.
  - Updated Electron `serveAppAsset` in `electron/main.js` to dispatch `app://nextora/api/*` internally, preventing 404 broken image placeholders in desktop packaged builds.
- **Contract PDF Generation & Download Workflow**:
  - Replaced unhandled `<a href="..." target="_blank">` tags with application-standard `api.openDocument(path, { download })` bridge calling Electron `doc:open`.
  - Wired contract preview "Generate PDF" and "Download PDF" buttons and agreement list actions to trigger native Windows save dialogs with verified file writing.
  - Standardized contract PDF download attachment filename to `${contract_number}_Influencer_Agreement.pdf`.
- **Section 3 Marketing Deliverables Table Alignment**:
  - Removed obsolete `Deadline` column.
  - Standardized column headers: `DELIVERABLE`, `MIN. QTY`, `FREQUENCY`, `REQUIRED INSTAGRAM HANDLES`.
  - Enforced a minimum quantity of 4 Monthly for Instagram Reels.
  - Rendered official handles `@nextora_pos, @nextora_creations`.
- **Section 4 Shared Calculation Engine & Telangana GST Separation**:
  - Implemented `calculateContractProductIllustrations(commissionBasisPoints)` providing verified, reproducible financial math shared identically by on-screen preview and vector PDF rendering.
  - Displays accurate prices, net values, GST amounts, and influencer commissions for both Nextora POS products:
    - **Nextora POS Mobile App** (₹5,999.00 GST-inclusive @ 18% GST): Net Sale Value ₹5,083.90, GST ₹915.10, Commission @ 50% ₹2,541.95, Telangana Intra-State split CGST ₹457.55 + SGST ₹457.55 = ₹915.10, Interstate IGST ₹915.10.
    - **Nextora POS Desktop** (₹7,999.00 GST-inclusive @ 18% GST): Net Sale Value ₹6,778.81, GST ₹1,220.19, Commission @ 50% ₹3,389.41, Telangana Intra-State split CGST ₹610.10 + SGST ₹610.09 = ₹1,220.19, Interstate IGST ₹1,220.19.
  - Included statutory non-binding illustrative disclaimer.
- **Monthly Commission Payment Settlement Clause**:
  - Updated contract clauses (Section 4 and Section 7) to specify that commission payments are processed during the first week of each calendar month for the preceding settlement period.

### Added
- **Software Development Services Contracts Module**:
  - Full end-to-end management for custom software development contracts, multi-milestone payment schedules, timeline deliverables, 3-month complimentary support clauses, post-support feature pricing, and optional monthly maintenance plans.
  - Dedicated multi-page vector PDF generation engine for software service agreements (`server/software-contract-pdf.js`).
  - Unified contracts index in Marketing & Partnerships supporting both Software Services and Influencer Marketing agreements.
- **Expanded Test Suite**:
  - Expanded automated test suite to 171 tests covering 350 KB logo uploads, JPEG/PNG dimension bounds, GST intra-state/interstate calculations, deliverable headers, software services contracts, and multi-page vector PDF generation.

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
