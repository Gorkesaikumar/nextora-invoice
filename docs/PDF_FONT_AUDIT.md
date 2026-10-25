# Nextora Invoice Generator — PDF Font & Document Generation Audit Report

**Date:** 2026-10-25  
**Auditor:** Senior Electron, Node.js & Application Security Engineer  
**Target:** PDF Document Generation & Font Asset Resolution  
**Status:** Audit Complete — Root Cause Identified  

---

## 1. Executive Summary

When clicking the **PDF** action on the Invoices screen in the installed Windows application (`C:\Program Files\Nextora Invoice Generator\`), the application crashes the document opening IPC pipeline and displays the following error toast:

```text
Error invoking remote method 'doc:open': Error: ENOENT: no such file or directory, open 'C:\Program Files\Nextora Invoice Generator\server\assets\NotoSans-Regular.ttf'
```

---

## 2. Root Cause Analysis

### 2.1 The Confirmed Root Cause: Flawed `process.cwd()` Path Resolution in `server/pdf.js`
- **Source Code Location:** [`server/pdf.js`](file:///d:/NEXTORA-INVOICE-GENERATOR/server/pdf.js) lines 30–37:
  ```javascript
  let cachedFonts;
  async function fontBytes() {
    cachedFonts ||= Promise.all([
      readFile(resolve(process.cwd(), 'server/assets/NotoSans-Regular.ttf')),
      readFile(resolve(process.cwd(), 'server/assets/NotoSans-Bold.ttf')),
    ]);
    return cachedFonts;
  }
  ```
- **Mechanism:**
  1. In development, the working directory is the project root (`D:\NEXTORA-INVOICE-GENERATOR`), so `resolve(process.cwd(), 'server/assets/NotoSans-Regular.ttf')` accidentally succeeds.
  2. In the packaged and installed Windows desktop application:
     - The application is installed at `C:\Program Files\Nextora Invoice Generator\`.
     - When launched from the Start menu or desktop shortcut, `process.cwd()` evaluates to `C:\Program Files\Nextora Invoice Generator`.
     - However, Electron Builder packages `server/**/*` inside the ASAR archive: `C:\Program Files\Nextora Invoice Generator\resources\app.asar\server\assets\NotoSans-Regular.ttf`.
     - There is **no** `server/assets` folder on the physical filesystem under `C:\Program Files\Nextora Invoice Generator\`.
     - Calling `resolve(process.cwd(), 'server/assets/NotoSans-Regular.ttf')` therefore yields `C:\Program Files\Nextora Invoice Generator\server\assets\NotoSans-Regular.ttf`, completely bypassing the ASAR bundle.
     - Node's `fs/promises.readFile()` attempts to open this non-existent path on disk and throws `ENOENT`.

### 2.2 Contributing Factors
- **Absence of Module-Relative Resolution (`import.meta.url`):** The PDF generator did not resolve its asset directory relative to its own module location (`import.meta.url`).
- **Packaging Configuration:** While `server/**/*` was included in the `files` array of `package.json`, `asarUnpack` was not defined for `server/assets/**/*`, nor were candidate fallback paths (`process.resourcesPath`, unpacked ASAR paths, or module paths) queried.
- **IPC Error Handling in `doc:open`:** In `electron/main.js`, `doc:open` called `dispatchApi()` which received a 500 internal server error from `api(request)` when `readFile` threw. Because `dispatchApi` returned the 500 error, `doc:open` returned `{ ok: false, status: 500, error: err.error }`. The renderer caught this and displayed the internal filesystem error message.

---

## 3. Font Assets Inventory in `server/assets/`

The repository already contains the complete, licensed Google Noto font family:
- `NotoSans-Regular.ttf` (569,208 bytes) — Primary font, embedded for body text, numbers, and ₹ rupee glyph (`0x20b9`).
- `NotoSans-Bold.ttf` (575,740 bytes) — Header and prominent labels font.
- `NotoSerif-Regular.ttf` (616,196 bytes) — Secondary serif variant.
- `NotoSerif-Bold.ttf` (638,164 bytes) — Secondary serif bold variant.
- `OFL.txt` (4,377 bytes) — SIL Open Font License, Version 1.1.

---

## 4. Proposed Fix Architecture

### 4.1 Resilient Font Path Resolution (`server/pdf.js`)
Implement a robust font locator function that tests candidate paths in order of priority:
1. **Module URL (`import.meta.url`):**
   `fileURLToPath(new URL('./assets/' + fontName, import.meta.url))`
   Works in dev (`D:\...\server\assets\...`) and inside `app.asar` (`resources\app.asar\server\assets\...`).
2. **Unpacked ASAR directory:**
   `fileURLToPath(new URL('./assets/' + fontName, import.meta.url)).replace('app.asar', 'app.asar.unpacked')`
   Provides physical disk access if `asarUnpack` is used.
3. **Electron Resources (`process.resourcesPath`):**
   `join(process.resourcesPath, 'assets', fontName)` and `join(process.resourcesPath, 'server', 'assets', fontName)`.
4. **Electron App Path (`app.getAppPath()`):**
   Resolved if running within Electron main process.
5. **Filesystem Fallback:**
   Relative to `process.cwd()` and `__dirname`.

The resolver will verify file existence, file size (> 0 bytes), and readability, caching the confirmed file paths or buffers so filesystem checks are never repeated.

### 4.2 Electron Packaging Configuration (`package.json`)
Add `asarUnpack` for `server/assets/**/*` in `package.json`:
```json
"asarUnpack": [
  "server/assets/**/*"
]
```
This ensures that font assets are both packaged in the bundle and unpacked into `resources/app.asar.unpacked/server/assets/`, guaranteeing compatibility with any low-level filesystem or native font loader.

### 4.3 Error Handling & IPC Resilience
- In `server/pdf.js`, wrap font loading with explicit, diagnostic error handling so that if any font is missing, a clear `FONT_NOT_FOUND` error is raised instead of an untracked Node.js `ENOENT`.
- In `electron/main.js`, improve `doc:open` error interception to provide clean, user-friendly notifications if document generation fails.
- Update `scripts/desktop-smoke.mjs` to include end-to-end PDF generation and IPC verification.

---

## 5. Verification & Testing Strategy
1. **Automated Unit & Integration Tests:** Add test cases in `tests/pdf.test.js` verifying font path resolution across candidate locations.
2. **Regression Testing:** Run the full 106+ test suite to verify invoices, quotations, and reports generate pixel-perfect PDFs with correct ₹ glyphs and totals.
3. **Packaged Smoke Test:** Run `scripts/desktop-smoke.mjs` asserting that `doc:open` succeeds and generates a non-empty PDF preview file.
4. **Release:** Produce new Windows NSIS installer v1.1.1 with verified SHA-256 checksum.
