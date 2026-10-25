# Nextora Invoice Generator — Authentication & Session Management Audit Report

**Date:** 2026-10-25  
**Auditor:** Senior Full-Stack & Application Security Engineer  
**Target:** Nextora Creations Invoice Generator (Desktop & Local API)  
**Status:** Audit Complete — Ready for Implementation  

---

## 1. Executive Summary & Existing Architecture

The **Nextora Creations Invoice Generator** is an internal business desktop and local web application built for managing quotations, tax invoices, receipts, and client accounts under the Indian GST framework.

### 1.1 Technology Stack
- **Desktop Runtime:** Electron (v44) with custom scheme `app://nextora` and strict Content Security Policy (`default-src 'self'`).
- **Frontend:** Vanilla JavaScript (ES modules) with Vite, Tailwind CSS, Material Design SVG icons, and a custom micro-component framework.
- **Backend / In-Process API:** Node.js HTTP request handler (`createAPI` in `server/api.js`) accepting standard Fetch `Request` / `Response` objects.
- **Database Engine:**
  - **Desktop:** Embedded SQLite via Node.js built-in `node:sqlite` (`DatabaseSync`) operating in WAL journal mode with database file located in `%APPDATA%\nextora-invoicing\nextora-invoicing.sqlite`.
  - **Server / Testing:** PostgreSQL 17 with `pg` connection pool.
  - **Dialect Translation:** In-flight PostgreSQL-to-SQLite SQL transpiler (`server/sqlite/dialect.js`) maintaining SQL parity across drivers.
- **Authentication & Security Architecture:**
  - Password Hashing: `scrypt` with salt ($N=32768, r=8, p=1$, 64-byte key length) and timing-safe comparison (`crypto.timingSafeEqual`).
  - Session Management: 32-byte cryptographically secure random session tokens stored as SHA-256 digests in `inv_sessions` / `inv.sessions` with 8-hour lifespan.
  - CSRF Protection: Cryptographic CSRF tokens bound to session records and verified on all state-mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`).
  - Rate Limiting: Key-hashed HMAC-SHA256 sliding-window throttling for IP addresses and account credentials.
  - Electron Security: `contextIsolation: true`, `nodeIntegration: false`, preload bridge (`electron/preload.cjs`) exposing only curated IPC channels.

---

## 2. Root Cause Analysis: "Your session ended. Please sign in again."

### 2.1 The Confirmed Root Causes

#### Primary Cause: Unconditional 401 Interception During Startup Boot Probe
- **Location:** `src/lib/api.js` (lines 24–27 & 58–61) and `src/main.js` (lines 220–224, 255–267).
- **Mechanism:**
  1. When the application launches, `boot()` in `src/main.js` calls `await api.get('/api/auth/me')` to check if a valid session already exists.
  2. If the user is not currently logged in (such as on cold application launch or fresh restart), the backend API returns HTTP `401 Unauthorized` with code `UNAUTHENTICATED`.
  3. Inside `src/lib/api.js`, the generic `request()` function intercepted **any and all** 401 responses:
     ```javascript
     if (result.status === 401) {
       onUnauthenticated();
       throw new ApiError(401, 'Your session has ended. Please sign in again.', 'UNAUTHENTICATED');
     }
     ```
  4. The registered `onUnauthenticated()` callback in `src/main.js` immediately invoked:
     ```javascript
     renderLogin('Your session ended. Please sign in again.');
     ```
  5. Consequently, even on a clean, normal startup with no prior active session, the red error banner **"Your session ended. Please sign in again."** was forcefully rendered to the user.

#### Secondary Cause: In-Memory Only Session Cookie in Electron Main Process
- **Location:** `electron/main.js` (lines 26, 149–181).
- **Mechanism:**
  1. In the Electron main process, `let cookieHeader = null;` was stored solely in process memory.
  2. When the user signed in, `cookieHeader` held the session cookie for subsequent IPC requests.
  3. When the user quit and relaunched the desktop application, `cookieHeader` was destroyed and reset to `null`.
  4. The desktop application never persisted the session cookie to disk.
  5. Thus, every single application launch started in an unauthenticated state, triggered the startup 401 probe, and displayed the "session ended" banner.

---

## 3. Current Database & User Account Structure

### 3.1 Existing Tables
- **`inv_users`**:
  - `id` (UUID text primary key)
  - `email` (unique text, lowercase-enforced)
  - `password_hash` (`scrypt:<salt>:<hex>`)
  - `role` (enum: `'OWNER'`, `'ADMIN'`, `'FINANCE'`, `'ACCOUNTANT'`)
  - `display_name` (text)
  - `disabled` (boolean integer)
  - `must_change_password` (boolean integer)
  - `created_at` (timestamptz)
- **`inv_sessions`**:
  - `token_hash` (text primary key, SHA-256 of session token)
  - `user_id` (foreign key -> `inv_users.id`)
  - `csrf_token` (text)
  - `expires_at` (timestamptz)
  - `created_at` (timestamptz)
- **`inv_business_settings`**:
  - Holds business identity, recovery parameters, invoice prefixes, and settings.

### 3.2 Access & Roles Model
- `OWNER`: Full administrative privileges, user management, and business settings.
- `ADMIN`: Administrative access and document management.
- `FINANCE`: Operational rights to create, issue, and manage invoices and payments.
- `ACCOUNTANT`: Read-only access to audit records, journals, and financial reports.

---

## 4. Existing Security Weaknesses & Missing Capabilities

1. **No Staff Self-Registration / Create Account Flow:**
   - Currently, user accounts can only be bootstrapped via initial setup (one owner) or via script. Staff members cannot create accounts from the login screen.
2. **No Local Password Recovery Flow:**
   - Because the application is a local desktop application without an external SMTP service or cloud backend, users who forget passwords had no recovery mechanism short of manual SQLite manipulation.
3. **Session Loss on Application Close:**
   - Absence of encrypted persistent session token storage causes unnecessary sign-ins on every desktop launch.
4. **Login UX Limitations:**
   - No show/hide password visibility toggle.
   - Missing dedicated navigation between Sign In, Registration, and Password Recovery.

---

## 5. Implementation Plan

### Phase 2: Authentication & Session Lifecycle Fix
- Update `src/lib/api.js` to allow silent status probing during `boot()` so cold-start 401s do not trigger `onUnauthenticated()`.
- Only trigger `onUnauthenticated()` when an established session genuinely expires during an active user workflow.
- In `electron/main.js`, persist session tokens securely in `app.getPath('userData')` using `safeStorage` (Windows DPAPI) or restricted-mode local file storage (`0o600`), restoring valid sessions seamlessly across application launches.
- Clear stored session tokens on explicit sign-out or session revocation.

### Phase 3: Create Account (Staff Registration)
- Add API route `POST /api/auth/register` with input validation (name, email format, password strength >= 10 chars, confirmation check).
- Enforce the internal-use security model: Newly registered accounts are assigned the standard staff role (`FINANCE`), never `OWNER` or `ADMIN`.
- Record `USER_REGISTERED` in the audit log.
- Add registration UI to `src/views/login.js` with toggle link to Sign In.

### Phase 4: Local Password Recovery
- Implement a secure local recovery system:
  - Add a Master Recovery Key (cryptographically generated during initial setup or configurable by the Owner in Settings).
  - Add API route `POST /api/auth/recover` allowing authorized account password resets via registered email + Recovery Key.
  - Record `PASSWORD_RECOVERED` in the audit log.
  - Document the recovery procedure in `docs/USER_ACCOUNT_RECOVERY.md`.
  - Add Forgot Password UI in `src/views/login.js`.

### Phase 5: Database Safety & Migrations
- Create migration `004_auth_recovery.sql` (both PostgreSQL and SQLite versions) to add `recovery_key_hash` to `inv_business_settings`.
- Preserve 100% of existing user data, invoices, quotations, and payments.

### Phase 6: Authentication UI/UX Enhancements
- Modernize `src/views/login.js`:
  - Show/hide password visibility toggle on all password inputs.
  - Seamless tabs/modes for Sign In, Create Account, and Forgot Password.
  - Accessible forms with loading indicators, error banners, and keyboard shortcuts.

### Phase 7: Automated Testing & Verification
- Implement comprehensive automated tests in `tests/auth.test.js` covering all 20 required authentication test cases.
- Run complete regression suite (86+ tests) to guarantee zero regressions.
- Generate `docs/AUTHENTICATION_TEST_REPORT.md`.

### Phase 8: Version Management & Release
- Increment version to `1.1.0` in `package.json`.
- Update `CHANGELOG.md`.
- Build the Windows x64 NSIS installer using `npm run build:desktop`.
- Generate SHA-256 checksum and release artifacts in `release/`.
