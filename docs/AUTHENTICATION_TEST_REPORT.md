# Nextora Invoice Generator — Authentication & Account Management Test Report

**Date:** 2026-10-25  
**Test Suite:** `tests/auth.test.js` & Full Regression Suite (`scripts/test.js`)  
**Environment:** Node.js v24.21.0, Isolated Disposable SQLite Engine  
**Status:** ALL 106 TESTS PASSED (0 Failures, 0 Regressions)  

---

## 1. Authentication Test Results (Phase 8.1)

All 20 test specifications mandated by Phase 8 were executed against an isolated, disposable SQLite database:

| # | Test Case Description | Result | Execution Time |
|---|---|:---:|:---:|
| 1 | Valid login returns 200, session cookie, and CSRF token | PASS | 169.4 ms |
| 2 | Invalid password is rejected with 401 `INVALID_CREDENTIALS` | PASS | 119.5 ms |
| 3 | Unknown email is rejected with 401 identically to wrong password | PASS | 118.5 ms |
| 4 | Empty email and password rejected with 400 `VALIDATION_ERROR` | PASS | 4.3 ms |
| 5 | Invalid email format rejected with 400 `VALIDATION_ERROR` | PASS | 1.5 ms |
| 6 | Successful account creation creates staff account with `FINANCE` role | PASS | 120.7 ms |
| 7 | Duplicate email registration is rejected with 409 `DUPLICATE_EMAIL` | PASS | 1.8 ms |
| 8 | Registration password confirmation mismatch is rejected | PASS | 1.4 ms |
| 9 | Weak password (< 10 chars) is rejected on registration | PASS | 1.4 ms |
| 10 | Password hash verification uses salted `scrypt` ($N=32768, r=8, p=1$) | PASS | 470.7 ms |
| 11 | Session restoration after restart using stored session cookie | PASS | 120.9 ms |
| 12 | Expired session handling returns 401 `SESSION_EXPIRED` | PASS | 120.3 ms |
| 13 | Invalid session token handling returns 401 `UNAUTHENTICATED` | PASS | 1.1 ms |
| 14 | Successful password recovery resets password and allows sign-in | PASS | 473.3 ms |
| 15 | Invalid recovery key is rejected with 401 `INVALID_RECOVERY_KEY` | PASS | 1.9 ms |
| 16 | Non-existent account recovery is rejected with 404 `USER_NOT_FOUND` | PASS | 1.5 ms |
| 17 | Unauthorized recovery key modification is rejected (401/403) | PASS | 117.7 ms |
| 18 | Logout destroys session and prevents subsequent protected access | PASS | 132.5 ms |
| 19 | Initial administrator setup is refused when accounts exist | PASS | 123.0 ms |
| 20 | Existing database migration preserves all records | PASS | 7.0 ms |

---

## 2. Full Application Regression Test Results (Phase 8.2)

In addition to the 20 authentication test cases, the complete 86-test suite covering core business logic was executed:

- **Quotations, Invoices & Workflow:**
  - Quotation lifecycle from draft to converted invoice (PASS)
  - Quotation expiry verification (PASS)
  - Invoice sequential number allocation & payment terms due date (PASS)
  - Partial and full payments & overpayment rejection (PASS)
  - Intra-state vs. Inter-state GST calculation (CGST/SGST vs. IGST) (PASS)
  - Tax summary credit note netting (PASS)
  - Issued document immutability and deletion blocking (PASS)
  - Draft correction and single-discard protection (PASS)
  - Milestone amount derivation and validation (PASS)
  - Revenue, receivables, and aging reporting (PASS)
  - Multi-page PDF generation & pagination (PASS)
  - Audit logging of all critical actions (PASS)

- **GST & Indian Currency Mathematics:**
  - Strict integer paisa arithmetic without floating-point artifacts (PASS)
  - Exact round-half-away-from-zero rounding (PASS)
  - Line-level vs invoice-level discount apportioning (PASS)
  - Indian grouping formatting (e.g., ₹1,00,000.00) (PASS)
  - Amounts in words according to Indian tax invoice convention (PASS)
  - Indian April–March financial year calculations (PASS)

- **POS Customer Tracker & Data Sharing:**
  - POS customer CRUD and concurrency protections (PASS)
  - Custom column types and ordering (PASS)
  - Subscription management and expiration tracking (PASS)
  - Private and public link sharing with column and row filters (PASS)
  - Excel and CSV workbook exports (PASS)

- **Desktop-Specific Engine & Dialect:**
  - Custom scheme `app://nextora` origin validation (PASS)
  - SQLite dialect translation and forward-only migrations (PASS)
  - In-process SQLite backup and integrity-checked restore (PASS)

---

## 3. Summary

- **Total Tests:** 106
- **Passed:** 106
- **Failed:** 0
- **Skipped:** 0
- **Duration:** ~27.2 seconds
