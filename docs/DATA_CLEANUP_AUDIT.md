# Nextora Creations Invoice Generator — Safe Business Data Cleanup, Export & Space Saving Audit

**Project:** Nextora Creations — Invoice Generator  
**Document:** `docs/DATA_CLEANUP_AUDIT.md`  
**Date:** 2026-10-25  
**Author:** Electron Application Engineer, Database Architect & Application Security Engineer  
**Status:** Complete — Proceeding to Implementation  

---

## 1. Executive Summary & Objectives

The **Nextora Creations Invoice Generator** is a local-first Electron application operating on SQLite (desktop) and PostgreSQL (hosted / containerized test suite). Over extended operational use, historical quotations and invoices accumulate in the local database file. 

Authorized administrators require a safe, auditable **Business Data Cleanup** facility to export historical quotation and invoice data to external archives (Excel, CSV, PDF, and structured JSON) and selectively delete historical records to reclaim storage without compromising relational integrity, accounting consistency, or statutory record-keeping.

### Strict Business Rules
1. **Scope:** Only quotation and invoice business data may ever be considered for cleanup.
2. **Master Preservations:** Products & Services, Clients, Business Settings, Tax Configuration, Payment Preferences, and User Accounts/Authentication must **never** be deleted.
3. **Schema Immutability:** Database schema, migrations (`inv_schema_migrations`), and application configuration must never be deleted.
4. **Export-First Mandate:** Deletion must never begin until required export files are generated, verified for completeness, checksummed (SHA-256), and explicitly approved by the administrator.
5. **No Silent Operations:** The application must never silently delete records, ignore failed cascades, or treat an export attempt as a completed backup.
6. **No Windows EXE Packaging:** Development validation only; do not package an installer or push to GitHub.

---

## 2. Comprehensive Database Schema & Relationship Audit

Inspection of migrations (`001_invoicing.sql` through `004_auth_recovery.sql`) reveals the following table architecture and relationships:

```
[inv_users]
   │ (1:N)
   ├──> [inv_clients] ──(1:N)──> [inv_quotations] ──(1:N)──> [inv_quotation_items] (CASCADE)
   │         │               │                 └──(1:N)──> [inv_quotation_milestones] (CASCADE)
   │         │               │                                   │
   │         │               ▼ (converted_invoice_id)            │ (quotation_id)
   │         └──(1:N)──> [inv_invoices] <────────────────────────┘
   │                         │
   │                         ├──(1:N)──> [inv_invoice_items] (CASCADE)
   │                         ├──(1:N)──> [inv_payments] (RESTRICT, Immutable)
   │                         ├──(1:N)──> [inv_adjustment_notes] (RESTRICT, Immutable)
   │                         │                 └──(1:N)──> [inv_adjustment_note_items] (CASCADE)
   │                         └──(1:N)──> [inv_pos_subscriptions] (RESTRICT)
   │
   ├──> [inv_products] (Independent catalog master)
   ├──> [inv_business_settings] & [inv_company_assets]
   ├──> [inv_document_status_history] (Immutable audit)
   └──> [inv_audit_logs] (Immutable audit)
```

### 2.1 Table Breakdown & Foreign Key Constraints

| Table Name | Primary Key | Foreign Keys & Target | On Delete Behavior | Integrity Triggers / Notes |
| :--- | :--- | :--- | :--- | :--- |
| `inv_users` | `id` (TEXT) | None | N/A | Authentication accounts. Must be preserved. |
| `inv_sessions` | `token_hash` | `user_id -> inv_users(id)` | RESTRICT | Active sessions. |
| `inv_business_settings` | `id` (INTEGER) | `updated_by -> inv_users(id)` | RESTRICT | Singleton settings. Preserved. |
| `inv_company_assets` | `name` | `updated_by -> inv_users(id)` | RESTRICT | Logo PNG asset. Preserved. |
| `inv_clients` | `id` (TEXT) | `created_by -> inv_users(id)` | RESTRICT | Client master data. Preserved. |
| `inv_products` | `id` (TEXT) | `created_by -> inv_users(id)` | RESTRICT | Product/service catalog. Preserved. |
| `inv_document_sequences` | `(doc_type, fy)` | None | N/A | Numbering sequences. Preserved. |
| `inv_quotations` | `id` (TEXT) | `client_id -> inv_clients(id)`<br>`converted_invoice_id -> inv_invoices(id)`<br>`created_by -> inv_users(id)` | RESTRICT | Trigger `quotation_history_delete` prevents deleting issued quotations outside cleanup. |
| `inv_quotation_items` | `id` (TEXT) | `quotation_id -> inv_quotations(id)`<br>`product_id -> inv_products(id)` | **CASCADE** on quotation<br>RESTRICT on product | Trigger `quotation_items_guard_delete` protects issued items. |
| `inv_quotation_milestones`| `id` (TEXT) | `quotation_id -> inv_quotations(id)` | **CASCADE** on quotation | None. Milestones removed with quotation. |
| `inv_invoices` | `id` (TEXT) | `client_id -> inv_clients(id)`<br>`quotation_id -> inv_quotations(id)`<br>`created_by -> inv_users(id)` | RESTRICT | Trigger `invoice_history_delete` prevents deleting issued invoices outside cleanup. |
| `inv_invoice_items` | `id` (TEXT) | `invoice_id -> inv_invoices(id)`<br>`product_id -> inv_products(id)` | **CASCADE** on invoice<br>RESTRICT on product | Trigger `invoice_items_guard_delete` protects issued items. |
| `inv_payments` | `id` (TEXT) | `invoice_id -> inv_invoices(id)`<br>`recorded_by -> inv_users(id)` | **RESTRICT** | Trigger `payments_append_only_delete` aborts deletion. Financial transaction history! |
| `inv_adjustment_notes` | `id` (TEXT) | `invoice_id -> inv_invoices(id)`<br>`client_id -> inv_clients(id)`<br>`created_by -> inv_users(id)` | **RESTRICT** | Trigger `adjustment_notes_append_only_delete` aborts deletion. Credit/Debit notes! |
| `inv_adjustment_note_items`| `id` (TEXT) | `note_id -> inv_adjustment_notes(id)` | **CASCADE** on note | Line items of credit notes. |
| `inv_pos_customers` | `id` (TEXT) | `client_id -> inv_clients(id)`<br>`employee_id -> inv_pos_employees(id)` | RESTRICT | POS customers. Preserved. |
| `inv_pos_subscriptions` | `id` (TEXT) | `customer_id -> inv_pos_customers(id)`<br>`invoice_id -> inv_invoices(id)` | **RESTRICT** | Customer subscriptions linked to invoices. |
| `inv_document_status_history`| `id` (TEXT) | None (soft `document_id`) | N/A | Trigger `history_append_only_delete` aborts deletion. |
| `inv_audit_logs` | `id` (TEXT) | None (soft `entity_id`) | N/A | Trigger `audit_append_only_delete` aborts deletion. |
| `inv_schema_migrations` | `name` | None | N/A | Migration ledger. Never touched. |

---

## 3. Eligibility Matrix for Cleanup

To prevent corruption of accounting, tax calculations, and statutory history, every record is classified as strictly **Eligible** or **Ineligible (Blocked)**:

### 3.1 Quotations

| Category / Status | Condition | Cleanup Eligibility | Justification & Safeguards |
| :--- | :--- | :--- | :--- |
| **Draft Quotations** | `status = 'DRAFT'`, no converted invoice, no invoice referencing | **ELIGIBLE** | Unissued pre-sales draft. Cascade removes line items and milestones safely. |
| **Expired / Rejected / Cancelled Quotations** | `status IN ('EXPIRED','REJECTED','CANCELLED')`, no converted invoice, no invoice referencing | **ELIGIBLE** | Inactive commercial estimates. Safe to archive and remove when not referenced by an invoice. |
| **Standalone Issued / Accepted Quotations** | `status IN ('SENT','ACCEPTED')`, no converted invoice, no invoice referencing | **ELIGIBLE** | Issued quotation with no downstream invoice dependency. May be cleaned up after export. |
| **Converted Quotations** | `converted_invoice_id IS NOT NULL` OR referenced by `inv_invoices.quotation_id` | **BLOCKED** | An invoice was generated from this quotation. Deleting breaks invoice source traceability and violates foreign-key constraint. |

### 3.2 Invoices

| Category / Status | Condition | Cleanup Eligibility | Justification & Safeguards |
| :--- | :--- | :--- | :--- |
| **Draft Invoices** | `status = 'DRAFT'`, unissued, 0 payments, 0 credit notes, 0 subscriptions | **ELIGIBLE** | Unissued internal draft. Cascade removes line items safely. |
| **Cancelled / Void Invoices without Payments/Notes** | `status IN ('CANCELLED','VOID')`, 0 payments, 0 credit notes, 0 subscriptions | **ELIGIBLE** | Voided/cancelled historical documents with zero monetary transactions or tax adjustments. |
| **Issued Invoices without Payments/Notes/Subscriptions** | `status = 'ISSUED'`, 0 payments, 0 credit notes, 0 subscriptions | **ELIGIBLE** | Historical unpaid/closed invoices where no payment was ever received, no credit notes issued, and no POS subscriptions reference it. |
| **Invoices with Payments** | Has 1+ rows in `inv_payments` | **STRICTLY BLOCKED** | **CRITICAL ACCOUNTING SAFEGUARD:** Payments are legal banking and cash receipts. Deleting would violate statutory accounting rules and trigger SQLite foreign key failures (`inv_payments.invoice_id RESTRICT`). |
| **Invoices with Credit/Debit Notes** | Has 1+ rows in `inv_adjustment_notes` | **STRICTLY BLOCKED** | **CRITICAL TAX SAFEGUARD:** Adjustment notes are statutory GST documents filed with tax authorities. Cannot be removed. |
| **Invoices with POS Subscriptions** | Has 1+ rows in `inv_pos_subscriptions` | **STRICTLY BLOCKED** | Active customer license records depend on invoice reference. |
| **Invoices referenced by Quotations** | `inv_quotations.converted_invoice_id` references this invoice | **STRICTLY BLOCKED** (unless quotation is cleaned up first or reference cleared) | Foreign-key relational constraint. |

---

## 4. Protected Business Data (Never Cleaned Up)

The following datasets must **never** be selected, queried for deletion, or affected by cascading triggers:
1. **Products & Services (`inv_products`):** The master product catalog is completely independent of document lifecycles.
2. **Clients (`inv_clients`):** Client contact details, GSTIN, and billing addresses must remain intact.
3. **Payments (`inv_payments`):** Receipts and collected funds ledger.
4. **Adjustment Notes (`inv_adjustment_notes`, `inv_adjustment_note_items`):** GST statutory adjustments.
5. **Business Settings & Brand Assets (`inv_business_settings`, `inv_company_assets`):** Issuer profile and logo.
6. **Users & Credentials (`inv_users`, `inv_sessions`, `inv_rate_limits`):** System access and security.
7. **Audit & History (`inv_audit_logs`, `inv_document_status_history`):** Compliance audit trail.

---

## 5. Risks of Deleting Historical Documents & Impact on Reports

Inspection of `server/reports.js` reveals how reports interact with historical document records:

1. **Collections Report (`collectionReport`):**  
   Performs `JOIN inv.invoices i ON i.id = p.invoice_id`. If invoices with payments could be deleted, payment records would disappear from the collection register or trigger foreign key violations. **Blocking invoices with payments protects this report.**
2. **Receivables & Ageing (`receivables`):**  
   Calculates balances due for unpaid issued invoices. Deleting historical unpaid invoices removes them from receivables. Exporting before deletion ensures auditability.
3. **Revenue by Client & Product (`revenueByClient`, `revenueByProduct`):**  
   Aggregates totals from `inv.invoices` and `inv.invoice_items`. Deleting an invoice reduces the historical revenue totals shown in active database queries for that time period.  
   *Policy:* The application does not fabricate phantom figures from thin air; active reports strictly report on data resident in the active database. Deletion is accompanied by verifiable, permanent export files (Excel/CSV/PDF/JSON) that serve as the official historical reporting archive.
4. **Tax Summary (`taxSummary`):**  
   Nets GST output tax from `inv.invoice_items` against `inv.adjustment_notes`. Invoices with credit notes are blocked from deletion, ensuring credit note references remain valid.

---

## 6. Export Requirements & Multi-Tier Verification Workflow

Before the Delete button is enabled, a multi-tier export and verification pipeline must succeed:

### 6.1 Required Formats
1. **Excel Workbook (`.xlsx`):** Multi-sheet export using `ExcelJS`. Detailed sheets for Document Master, Line Items, and (for quotations) Milestones. Formula-injection sanitized.
2. **CSV Archive (`.csv`):** Standard CSV files formatted with RFC 4180 rules and formula guards.
3. **Human-Readable PDF Archive (`.pdf`):** Complete compiled PDF document containing formatted invoices/quotations with letterhead, line items, taxes, and amounts in words, generated via `pdf-lib`.
4. **Structured JSON Backup (`.json`):** Full relational representation preserving snapshot JSON, line items, timestamps, UUIDs, and foreign keys.

### 6.2 Pre-Deletion Verification Checklist
- [x] All export files exist on disk at the specified paths.
- [x] File size > 0 bytes (non-empty).
- [x] Structured JSON parsed back to confirm JSON validity.
- [x] Exported record count reconciles exactly with selected record count.
- [x] Every selected document ID is verified present in the export payload.
- [x] Line items, totals, and financial breakdown verified present.
- [x] SHA-256 cryptographic checksum computed for each file.
- [x] Explicit confirmation phrase (`DELETE QUOTATIONS` or `DELETE INVOICES`) required from administrator.

---

## 7. Transaction, SQLite Maintenance & Recovery Strategy

### 7.1 Database Migration `005_business_data_cleanup.sql`
The existing triggers (`quotation_history_delete`, `invoice_history_delete`, etc.) unconditionally abort any deletion of issued documents (`WHEN OLD.quotation_number IS NOT NULL`). To maintain strict daily immutability while permitting verified administrative cleanup:
- Introduce table `inv_cleanup_context ( active INTEGER PRIMARY KEY DEFAULT 1 )`.
- Adjust the deletion triggers to check `AND NOT EXISTS (SELECT 1 FROM inv_cleanup_context)`.
- During ordinary usage, `inv_cleanup_context` is empty. Normal queries attempting to delete issued documents are aborted with `'Issued quotations cannot be deleted'` / `'Issued invoices cannot be deleted'` (preserving all existing test assertions).
- During an authorized cleanup operation inside a transaction, `INSERT INTO inv_cleanup_context VALUES (1)` enables the deletion of strictly verified, eligible records.
- At the end of the cleanup transaction, the context is deleted, re-arming normal enforcement.

### 7.2 Safety Backup Before Cleanup
Before initiating destructive deletion:
- Call `createBackup(db, safetyBackupPath)` using native SQLite backup API.
- Verify backup with `validateBackupFile`.
- If backup fails or is unreadable, abort cleanup immediately.

### 7.3 Post-Deletion Storage Maintenance (SQLite Space Reclamation)
Deleting rows inside SQLite marks database pages as "free" on the internal freelist, but **does not shrink the `.sqlite` file on disk**.
- After deletion transaction commits:
  1. `PRAGMA wal_checkpoint(TRUNCATE)`: Flushes changes from WAL journal into the main database file.
  2. `PRAGMA integrity_check`: Confirms B-tree and relational validity.
  3. `VACUUM`: Rewrites the database file from scratch, discarding freed pages and shrinking file size on disk.
  4. Measure file size before and after to report exact reclaimed disk space.

### 7.4 Audit Logging
Record `BUSINESS_DATA_CLEANUP` in `inv_audit_logs`:
- Actor ID, email, timestamp.
- Category (`QUOTATIONS` or `INVOICES`).
- Selected count, deleted count, eligible/ineligible breakdown.
- Export file paths and SHA-256 checksums.
- Storage before and after vacuum.

---

## 8. Conclusion & Implementation Plan

The audit confirms that safe business data cleanup can be implemented without violating relational integrity or damaging financial history. Invoices with recorded payments, credit notes, or POS customer subscriptions will be blocked with clear explanations, while eligible historical documents and drafts can be safely exported, verified, deleted, and vacuumed. Proceeding to Phase 2.
