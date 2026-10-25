# Release Test Report: Nextora Invoice Generator v1.1.2

**Date:** 2026-10-25  
**Application Version:** `1.1.2`  
**Platform:** Windows 10/11 x64 (Node.js v24.21.0, Electron 44.7.0)  
**Execution Environment:** Local Node test runner (`node:test`) + Electron Desktop Runner  
**Status:** ALL 132 INTEGRATION TESTS PASSED (0 Failures, 0 Skipped, 0 Regressions) + DESKTOP SMOKE PASSED (`SMOKE_OK`)  

---

## 1. Automated Test Suites Execution

Command: `npm test` (`node scripts/test.js`)  
Execution Time: ~40.08s  

```text
Applied 001_invoicing.sql
Applied 002_pos_customers.sql
Applied 003_tracker_layout.sql
Applied 004_auth_recovery.sql
Applied 005_business_data_cleanup.sql
Migrations up to date.
Owner account created for owner@example.test. Remove OWNER_PASSWORD from your environment now.

ℹ tests 132
ℹ suites 0
ℹ pass 132
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 40087.6594
```

### Suite Breakdown
1. **API Security & Origin Validation (`tests/api.test.js` - 10 tests):**
   - Business data unreachable without session.
   - Login credential evaluation and timing attack resistance.
   - Login rate-limiting after repeated failures.
   - CSRF token validation and cross-origin request blocking.
   - Stolen cookie session pinning.
   - Payload schema validation and structured error responses.
   - Issuer tax configuration validation.
2. **Authentication, Sessions & Recovery (`tests/auth.test.js` - 20 tests):**
   - Password hash verification using salted `scrypt`.
   - Session restoration after application restart via persistent cookie.
   - Session expiration handling (`401 SESSION_EXPIRED`).
   - Secure password reset via 16-character business recovery key.
   - Registration validation and role assignment (`FINANCE`).
   - Clean user logout and session invalidation.
3. **Business Data Cleanup & Space Saving (`tests/cleanup.test.js` - 17 tests):**
   - Database inspection and eligibility status endpoint (`GET /api/cleanup/status`).
   - Date range filtering and quotation/invoice eligibility preview (`POST /api/cleanup/preview`).
   - Multi-format archive exports (`.xlsx`, `.csv`, `.pdf`, `.json`) with SHA-256 manifest generation.
   - Corrupted or tampered export file detection.
   - Confirmation phrase enforcement (`DELETE QUOTATIONS` / `DELETE INVOICES`).
   - Non-admin and unauthenticated request rejection (`requireManager`).
   - Strict preservation of Products & Services, Clients, Settings, and User accounts.
   - Accounting immutability protection for invoices with payments, credit notes, or subscriptions.
   - Pre-cleanup database backup creation and validation.
   - Storage reclamation via SQLite WAL checkpoint, cache clearance, and `VACUUM`.
4. **Desktop IPC & Backup Integrity (`tests/desktop.test.js` - 3 tests):**
   - Desktop renderer origin verification.
   - Owner bootstrap on fresh installation.
   - SQLite backup verification and restore replacement.
5. **GST Calculations & Tax Jurisdictions (`tests/gst.test.js` - 4 tests):**
   - GSTIN check digit validation algorithms.
   - Place-of-supply tax split (CGST/SGST vs IGST).
   - Complete state and union territory tax mapping.
6. **Financial Mathematics & Rounding (`tests/money.test.js` - 14 tests):**
   - Integer-based paisa arithmetic (zero floating-point artifacts).
   - Rounding half-away-from-zero (`roundDiv`).
   - Multi-tier invoice and item discounts.
   - Proportional tax allocation and round-off balancing.
7. **PDF Generation & Font Resolution (`tests/pdf.test.js` - 12 tests):**
   - Dynamic multi-candidate font path resolution (`resolveFontPath`).
   - Structured `FONT_NOT_FOUND` error handling.
   - Indian Rupee symbol (`₹`) font rendering.
   - Invoice and quotation document layout, tables, and pagination.
   - Quantity formatting for decimal, large, and zero values.
8. **Reports, Analytics & FY Cycles (`tests/reports.test.js` - 3 tests):**
   - Indian Financial Year (April–March) cycle preset calculations.
   - Sales comparisons, growth metrics, and product analytics.
   - Customer statement summaries.
9. **Private & Public Document Sharing (`tests/sharing.test.js` - 5 tests):**
   - Column-level filtering and field exclusion.
   - Revocation and access logs.
   - Public link password protection and expiry.
10. **SQLite Dialect Translation (`tests/sqlite-dialect.test.js` - 16 tests):**
    - Dynamic rewrite of PostgreSQL schema and operators to SQLite syntax.
    - Forward migration compatibility.
11. **POS Customer Tracker (`tests/tracker.test.js` - 11 tests):**
    - Customer CRUD, concurrency version checks, and archiving.
    - Custom column definitions and subscription renewal cycles.
    - CSV/Excel imports with duplicate detection.
12. **Indian Number Formatting & Words (`tests/words.test.js` - 4 tests):**
    - Indian numbering system groupings (`Lakhs`, `Crores`).
    - Formal tax-invoice words representation.
13. **Full Invoicing Lifecycle (`tests/workflow.test.js` - 13 tests):**
    - Quotation drafting, issuance, acceptance, and invoice conversion.
    - Invoice sequential numbering, due dates, and partial payments.
    - Milestone schedule validation and audit event logging.

---

## 2. Desktop Packaged Smoke Test

Command: `npm run smoke:desktop` (`electron scripts/desktop-smoke.mjs`)  
Mode: Packaged (`app://nextora` + Production CSP)  
Result: **`SMOKE_OK`**

### Validated Steps:
- Renderer loaded from `app://nextora/index.html`.
- Production CSP active (`default-src 'self'`).
- First-run setup executed and transitioned to dashboard.
- Context-isolated preload IPC bridge operational (`GET /api/clients -> 200`).
- Invoice generated and PDF preview launched via `doc:open` bridge.
- Foreign origin mutation rejected (`PUT /api/settings -> 403`).
- POS customer tracker verified (12 columns, 0 rows).
- Products & Services table layout verified without window overflow.
- SQLite database verified with 31 tables, 5 migrations applied.
