# Nextora Invoice Generator — PDF Generation & Font Resolution Regression Test Report

**Project:** Nextora Creations — Invoice Generator  
**Application Version:** 1.1.1  
**Date:** 2026-10-25  
**Platform:** Windows 10/11 x64 (Node.js v24.21.0, Electron 34.3.0)  
**Status:** PASS (109 / 109 Automated Tests Passed, 100% Desktop Smoke Test Passed)

---

## 1. Executive Summary

A critical issue in the packaged desktop build (`C:\Program Files\Nextora Invoice Generator\`) caused document generation to crash with:
`Error invoking remote method 'doc:open': Error: ENOENT: no such file or directory, open 'C:\Program Files\Nextora Invoice Generator\server\assets\NotoSans-Regular.ttf'`.

The issue was traced to `server/pdf.js` using `resolve(process.cwd(), 'server/assets/NotoSans-Regular.ttf')`, which in an installed Electron environment resolves relative to the current working directory (`C:\Program Files\Nextora Invoice Generator\`) rather than looking inside `resources/app.asar/` or `resources/app.asar.unpacked/`.

The font resolution architecture was redesigned to dynamically probe candidate paths (`fileURLToPath(import.meta.url)`, `process.resourcesPath`, `app.asar.unpacked`, and cwd fallbacks), cache loaded font buffers in-memory, and fail with structured error responses if missing. In addition, `package.json` was updated to explicitly unpack `server/assets/**/*` via `asarUnpack` and copy them into `extraResources`.

Comprehensive regression testing across 109 automated unit/integration tests and an end-to-end packaged desktop Electron smoke test confirmed that PDF generation and IPC previewing now function reliably without regressions.

---

## 2. Test Execution Overview

### 2.1 Test Suites Summary

| Test Suite | Purpose | Tests Run | Passed | Failed | Status |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `tests/auth.test.js` | Authentication, password reset, account recovery, CSRF | 20 | 20 | 0 | PASS |
| `tests/pdf.test.js` | PDF generation, font resolution, font caching, pagination, rupee symbol | 7 | 7 | 0 | PASS |
| `tests/api.test.js` | Core API validation, permissions, HTTP status codes | 10 | 10 | 0 | PASS |
| `tests/desktop.test.js` | Desktop main process bridge, database backup/restore | 3 | 3 | 0 | PASS |
| `tests/gstin.test.js` | GSTIN check digits & state code validation | 4 | 4 | 0 | PASS |
| `tests/money.test.js` | Money math, tax splits, round-off, discount rules | 14 | 14 | 0 | PASS |
| `tests/tracker.test.js` | POS customer tracker, CSV/Excel export, custom columns | 11 | 11 | 0 | PASS |
| `tests/sqlite-dialect.test.js` | PostgreSQL to SQLite query rewrite dialect | 15 | 15 | 0 | PASS |
| `tests/workflow.test.js` | Quotation-to-invoice lifecycle, payments, credit notes, audit | 25 | 25 | 0 | PASS |
| **Total Automated** | `npm test` | **109** | **109** | **0** | **PASS** |

### 2.2 End-to-End Desktop Smoke Test

Command: `npm run smoke:desktop`  
Mode: Packaged (`app://nextora` origin with Content-Security-Policy `default-src 'self'`)

| Step | Verification Target | Result | Detail |
| :---: | :--- | :---: | :--- |
| 1 | Renderer window load | PASS | `app://nextora/index.html` |
| 2 | Content Security Policy | PASS | Verified `default-src 'self'` |
| 3 | First-run setup display | PASS | "Set up invoicing" heading visible |
| 4 | First-run setup submission | PASS | Owner account and company configured |
| 5 | Post-setup navigation | PASS | Navigated to `#/dashboard` |
| 6 | IPC request via preload bridge | PASS | `GET /api/clients` returned HTTP 200 |
| 7 | **PDF Generation & Preview** | **PASS** | `doc:open` generated PDF and launched preview window (`previewed: true`) |
| 8 | Foreign origin refusal | PASS | `PUT /api/settings` with external origin returned HTTP 403 |
| 9 | POS customer tracker grid | PASS | Grid rendered with 12 schema columns |
| 10 | Initial setup state check | PASS | `setup_required: false` |
| 11 | SQLite database integrity | PASS | 30 tables, 4 applied migrations, 1 user, 5 audit events |

**Final Smoke Result:** `SMOKE_OK` (0 problems).

---

## 3. Detailed PDF Feature Verification

### 3.1 Font Resolution & Loading Verification

- **Module-Relative Resolution:**  
  `resolveFontPath('NotoSans-Regular.ttf')` resolves against `fileURLToPath(import.meta.url)` (`server/assets/NotoSans-Regular.ttf`), ensuring clean operation in development, unit test runners, and within ASAR archives.
- **Unpacked & External Asset Fallback:**  
  If accessed from an unpacked directory, candidate paths include `process.resourcesPath/app.asar.unpacked/server/assets/` and `process.resourcesPath/assets/`.
- **Buffer Caching:**  
  Loaded font buffers are cached in a module-level `Map` (`fontCache`). Subsequent document generations do not hit the filesystem.
- **Structured Error Handling:**  
  When an unresolvable font filename is requested, `readFontBytes()` throws a structured error with `code: 'FONT_NOT_FOUND'` and `status: 500`.

### 3.2 PDF Rendering Integrity

- **Quotation PDF Generation:**  
  Accurately prints quoted line items, milestone schedules, inclusions/exclusions, warranty terms, and totals.
- **Invoice PDF Generation:**  
  Prints formal tax invoice with intra-state (CGST + SGST) or inter-state (IGST) breakdowns, GSTIN, HSN/SAC codes, reverse charge indicator, and amounts in words.
- **Multi-Page Pagination:**  
  Tested with an invoice of 42 lines. Spans 3+ pages without overlapping or drawing past margins. Each page displays sequential `Page X of Y` footers.
- **Indian Rupee Symbol (₹):**  
  Correctly mapped via Noto Sans UTF-8 glyph support. Does not render as missing glyph boxes or raw character entities.
- **Payment Receipts:**  
  Renders payment receipt snapshot with amount received, transaction reference, payment mode, and remaining balance due.
- **Draft Watermark / Preview:**  
  Unissued invoices rendered with `preview: true` display a diagonal "DRAFT" watermark; issued invoices render without watermark.

### 3.3 IPC Bridge & Electron Main Process (`doc:open`)

- **Input Validation:**  
  Rejects non-string paths and paths not starting with `/api/` with status 400.
- **Error Handling:**  
  Catches generation errors, parses server JSON error response if present, and returns `{ ok: false, status, error: message }` to the renderer instead of unhandled IPC rejections.
- **Preview Isolation:**  
  Opens PDF previews in a sandboxed, isolated `BrowserWindow` with native PDF viewer enabled (`plugins: true`, `sandbox: true`, `nodeIntegration: false`).
- **Download Mode:**  
  Presents native Windows `showSaveDialog` with appropriate file extension filters and writes the buffer safely to disk.

---

## 4. Packaging Verification

- **`package.json` Version:** `1.1.1`
- **`asarUnpack` Configuration:** Added `"server/assets/**/*"` ensuring `NotoSans-Regular.ttf` is accessible on the physical filesystem if required by native loaders.
- **`extraResources` Configuration:** Added `{ "from": "server/assets", "to": "assets", "filter": ["**/*"] }` to ensure font files reside in `resources/assets/`.

---

## 5. Conclusion

All font resolution failure modes have been addressed and verified through both unit test suites and packaged Electron runtime simulation. PDF generation is fully operational and ready for production deployment.
