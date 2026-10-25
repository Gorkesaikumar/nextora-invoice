# Nextora Invoice Generator — User Account Recovery Guide

**Target System:** Nextora Creations Invoice Generator (Desktop & Local API)  
**Security Model:** Local Multi-User Desktop with Zero External Network Dependencies  

---

## 1. Overview & Architectural Principles

Nextora Invoice Generator is designed to operate locally on desktop workstations without requiring cloud accounts, third-party authentication services, or external SMTP servers. Consequently, password recovery does not rely on email transmission (which would introduce external network dependencies, deliverability risks, and plaintext token exposure).

Instead, the application provides an **Authorized Local Recovery Mechanism** based on a **Business Recovery Key** and role-delegated recovery controls.

---

## 2. The Business Recovery Key

### 2.1 What is the Business Recovery Key?
The Business Recovery Key is a confidential authorization passphrase managed by the business **Owner** or **Administrator**. It acts as an emergency reset authorization token that allows legitimate staff to reset their passwords locally on the machine.

### 2.2 Managing the Recovery Key
1. The Business Owner or Administrator signs into Nextora Invoicing.
2. Navigate to **Settings** (or press `Ctrl+8` / click the Settings gear).
3. Under the **Account** section, locate **Master Recovery Key**.
4. Enter a strong passphrase (minimum 8 characters) and click **Update recovery key**.
5. The key is hashed using salted `scrypt` with $N=32768, r=8, p=1$ and stored in the database (`inv_business_settings.recovery_key_hash`). Plaintext keys are never stored on disk.
6. The default deployment recovery key for initial setup is `NEXTORA-RECOVERY-2026`. Owners should update this key to their own custom internal key upon deployment.

---

## 3. Step-by-Step User Password Recovery Procedure

When an authorized staff member forgets their password:

### Step 1: Open Recovery Screen
1. Launch **Nextora Invoicing**.
2. On the sign-in screen, click the **Forgot password?** link.

### Step 2: Provide Account and Verification Details
1. **Email address:** Enter the exact email address used to register the account (e.g., `staff@nextoracreations.co.in`).
2. **Business recovery key:** Enter the active Business Recovery Key obtained from your company administrator or owner.
3. **New password:** Enter a new strong password (at least 10 characters).
4. **Confirm new password:** Re-enter the new password to confirm matching.

### Step 3: Complete Reset
1. Click **Reset password**.
2. The local API validates the recovery key and email against the database.
3. Upon validation:
   - The password hash is securely replaced using fresh `scrypt` salting.
   - All prior active sessions for that account are immediately invalidated and purged (`DELETE FROM inv_sessions WHERE user_id = ?`).
   - A `PASSWORD_RECOVERED` event is permanently recorded in the append-only audit trail (`inv_audit_logs`).
   - A success notification is displayed: `"Password reset successful! Please sign in with your new password."`
4. The user is redirected to the Sign In screen to authenticate with their new credentials.

---

## 4. Security Controls & Protections

1. **Brute-Force & Rate-Limiting Protection:**
   - Account recovery endpoints are protected by HMAC-SHA256 sliding-window rate limiters.
   - Excessive failed recovery attempts are throttled per IP address and per email address (maximum 5 attempts per 15 minutes).
2. **No Data Exposure:**
   - The recovery API never discloses stored password hashes, salts, or system credentials.
   - Non-existent or disabled accounts return safe, uniform error responses to prevent user enumeration.
3. **Audit Trail Accountability:**
   - Every password recovery action logs the actor ID, entity ID, target email address, and timestamp in the immutable audit log.
   - Business owners can review the audit log anytime in **Reports → Audit Trail**.
4. **Session Invalidation:**
   - Password reset immediately invalidates all active sessions across any concurrent windows or instances, preventing unauthorized session persistence.
