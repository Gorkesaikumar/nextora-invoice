# Nextora Creations Invoice Generator — Comprehensive Reporting & Analytics Audit

**Project:** Nextora Creations — Invoice Generator  
**Document:** `docs/REPORTING_AUDIT.md`  
**Date:** 2026-10-25  
**Author:** Reporting & Analytics Architecture Specialist  
**Status:** Complete — Proceeding to Implementation

---

## 1. Existing Report Capabilities

The application currently has a Reports view (`src/views/reports.js`) backed by endpoints in `server/api.js` and queries in `server/reports.js`.

### 1.1 Existing Report Tabs

1. **Invoice register (`/api/reports/invoices`):**
   - Columns: Invoice number, issue date, client, document status, payment state, taxable value, tax, invoice total, collected amount, balance due.
   - Filtering: Optional `from` and `to` dates (defaults to financial year to date).
   - Export: CSV supported.
2. **Collections (`/api/reports/collections`):**
   - Columns: Receipt number, payment date, client, invoice number, payment method, reference, amount.
   - Monthly summary: Grouped by `YYYY-MM` with receipt count and collected minor.
   - Export: CSV supported.
3. **Receivables and ageing (`/api/reports/receivables`):**
   - Fixed ageing buckets: `NOT_DUE`, `1-30`, `31-60`, `61-90`, `OVER_90`.
   - Columns: Invoice number, client, issue date, due date, days overdue, bucket, total, collected, balance due.
   - Export: CSV supported.
4. **Quotation performance (`/api/reports/quotations`):**
   - Metrics: Accepted count, rejected count, converted count, conversion rate basis points (`conversion_rate_bp`), total decided value.
   - Table: Quotation number, client, title, issue date, status, converted flag, value.
   - Export: No export currently enabled.
5. **Revenue by client (`/api/reports/revenue-by-client`):**
   - Basic aggregation: Client name, company name, total invoiced (`grand_total_minor` where status='ISSUED'), total collected.
   - Export: No export currently enabled.
6. **Revenue by product (`/api/reports/revenue-by-product`):**
   - Basic aggregation: Item description, category, total quantity milli, taxable value, tax, total invoiced, distinct invoice count.
   - Export: No export currently enabled.
7. **Tax summary (`/api/reports/tax-summary`):**
   - Groups by `hsn_sac` and `tax_rate_bp`, with breakdown of CGST, SGST, IGST, total tax, non-taxable (exempt/outside GST), and adjustment notes (credit/debit).
   - Export: CSV supported.
8. **Audit trail (`/api/audit`):**
   - Paginated list of audit events (`created_at`, `event`, `entity_type`, `actor_name/email`, `metadata`).
   - Export: No export.

---

## 2. Existing Database Schema & Relationships

The database utilizes SQLite for the desktop application (with PostgreSQL syntax translated via `server/sqlite/dialect.js`):

| Table | Relevant Fields & Types | Purpose |
| :--- | :--- | :--- |
| `inv.business_settings` | `business_name`, `legal_name`, `address`, `email`, `phone`, `website`, `gstin`, `state_code`, `pan`, `bank_*`, `pdf_accent_color` | Business letterhead and tax configuration for report branding. |
| `inv.clients` | `id`, `kind`, `name`, `company_name`, `email`, `phone`, `billing_address`, `gstin`, `state_code`, `status`, `created_at` | Customer entity records and tax details. |
| `inv.products` | `id`, `name`, `sku`, `description`, `category`, `unit`, `unit_price_minor`, `tax_treatment`, `tax_rate_bp`, `hsn_sac`, `status` | Catalog master data. |
| `inv.invoices` | `id`, `invoice_number`, `status` (`DRAFT`, `ISSUED`, `CANCELLED`, `VOID`), `client_id`, `issue_date`, `due_date`, `totals` (JSON), `snapshot` (JSON), `cancelled_at`, `cancel_reason` | Master financial documents. |
| `inv.invoice_items` | `id`, `invoice_id`, `product_id`, `description`, `category`, `hsn_sac`, `unit`, `quantity_milli`, `unit_price_minor`, `discount_minor`, `taxable_minor`, `cgst_minor`, `sgst_minor`, `igst_minor`, `tax_minor`, `total_minor` | Line items for product-level sales analytics. |
| `inv.payments` | `id`, `receipt_number`, `invoice_id`, `amount_minor`, `paid_on`, `method`, `reference`, `notes`, `created_at` | Money collected against issued invoices. |
| `inv.quotations` | `id`, `quotation_number`, `status` (`DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `CANCELLED`), `client_id`, `issue_date`, `expiry_date`, `converted_invoice_id`, `totals` (JSON) | Pre-sales estimates. |
| `inv.adjustment_notes` | `id`, `note_number`, `kind` (`CREDIT`, `DEBIT`), `invoice_id`, `issue_date`, `reason`, `totals` (JSON) | Credit and debit notes for netting sales/tax. |
| `inv.audit_logs` | `id`, `actor_id`, `event`, `entity_type`, `entity_id`, `metadata` (JSON), `created_at` | Security and compliance audit trail. |

---

## 3. Confirmed Gaps in the Current Implementation

1. **No PDF Export for Reports:**
   - Reports only support CSV export for 4 tabs (`invoices`, `collections`, `receivables`, `tax`).
   - The other 4 tabs (`quotations`, `clients`, `products`, `audit`) have no export buttons at all.
   - Zero PDF export exists for any report.
2. **Missing Date Presets:**
   - The current filter only has raw `<input type="date">` for `from` and `to`.
   - Lacks user-friendly presets: Today, Yesterday, This week, Last week, This month, Last month, Last 7 days, Last 30 days, This quarter, Last quarter, Current financial year, Previous financial year, All dates.
3. **No Business Overview KPI Dashboard on Reports:**
   - The Reports view immediately drops into raw tables without an executive summary banner or period-over-period comparison metrics.
4. **Limited Product Sales Analytics:**
   - Current `revenueByProduct` lacks SKU lookup, unit price averages, discounts, distinct customer counts, line item counts, percentage sales contribution, top 5/10/20 views, and zero-sales product tracking.
5. **Limited Customer-Wise Reporting:**
   - Current `revenueByClient` lacks GSTIN, contact details, first/last invoice dates, quotation counts, overdue amounts, overdue invoice counts, units purchased, and customer statements.
6. **Date Boundary Handling:**
   - Current range handling assumes standard dates but does not handle quarter boundaries or comparison period generation according to Indian Financial Year conventions.

---

## 4. Financial Calculation Rules

To ensure 100% accounting fidelity without altering historical records:
1. **Issued vs Non-Issued Documents:**
   - Only `status = 'ISSUED'` invoices are counted as valid invoiced sales.
   - `DRAFT`, `CANCELLED`, and `VOID` invoices are never counted as revenue or active receivables. Cancelled/voided invoices are counted exclusively in document count audits.
2. **Revenue vs Collections:**
   - Invoiced revenue is based on `i.totals->>'grand_total_minor'` from issued invoices.
   - Collections are strictly based on recorded `inv.payments` (`p.amount_minor`).
   - Invoiced value and collected value are never conflated or assumed equal.
3. **Outstanding Receivables & Ageing:**
   - Outstanding balance per invoice: `grand_total_minor - COALESCE(paid_minor, 0)`.
   - Overdue threshold: `i.due_date < CURRENT_DATE` and `balance > 0`.
   - Ageing buckets calculated relative to the due date: `NOT_DUE`, `1–30`, `31–60`, `61–90`, `OVER_90` days.
4. **Net Sales Calculation:**
   - Net Invoiced = $\sum \text{Gross Invoiced} - \sum \text{Discounts} - \sum \text{Credit Notes} + \sum \text{Debit Notes}$.
5. **Quotations:**
   - Quotations are pre-sales estimates and are **never** counted as revenue or sales.
6. **Zero-Baseline Comparisons:**
   - When calculating percentage change against a previous period:
     If $\text{prior} = 0$ and $\text{current} > 0$, change is $+100\%$; if both are 0, change is $0\%$.

---

## 5. Architecture for PDF Export & Reporting System

### 5.1 Reusable Date Presets (`src/lib/date-presets.js` & `server/date-presets.js`)
Calculates ISO dates (`YYYY-MM-DD`) for:
- `today`, `yesterday`, `this_week`, `last_week`, `this_month`, `last_month`, `last_7_days`, `last_30_days`, `this_quarter`, `last_quarter`, `this_fy`, `last_fy`, `all_time`, `custom`.
- Computes matching comparison periods for delta and percentage calculations.
- Follows Indian Financial Year rules: Q1 (Apr-Jun), Q2 (Jul-Sep), Q3 (Oct-Dec), Q4 (Jan-Mar); FY start on April 1.

### 5.2 Server-Side Analytics & Reporting Extension (`server/reports.js` & `server/api.js`)
- Add `businessOverview(db, url)`: Returns KPI summary cards and period comparisons.
- Enhance `revenueByProduct(db, url)`: Enriches line item data with SKU, discounts, distinct invoices/clients, averages, and contribution shares. Supports `limit` (5, 10, 20, all) and `zero_sales` mode.
- Enhance `revenueByClient(db, url)`: Enriches customer data with contact, first/last dates, overdue amounts, quotation counts, and customer statement generation.
- Add `/api/reports/overview`, `/api/reports/statement`, and `/api/reports/export-pdf`.

### 5.3 PDF Generation Architecture (`server/report-pdf.js` & `server/report-html.js`)
- **Semantic HTML Report Engine (`server/report-html.js`):**
  Constructs complete semantic HTML documents with `table`, `thead`, `tbody`, `tfoot`, `@media print`, `thead { display: table-header-group; }`, `tr { page-break-inside: avoid; }`, `@page { size: landscape; margin: 12mm; }`, and official branding.
- **Pure Node.js PDF Rendering (`server/report-pdf.js`):**
  Built on `pdf-lib` + `@pdf-lib/fontkit` and Noto Sans:
  - Generates A4 Landscape (for wide financial registers and analytics) and A4 Portrait (for statements and summaries).
  - Precomputes column coordinates and wraps long texts.
  - Automatically draws repeating table headers on page breaks.
  - Generates `Page X of Y` footers, timestamps, and confidentiality notices.
  - Works 100% in Node.js test runner (`npm test`), Netlify serverless, and packaged Electron.
- **Electron Desktop Bridge:**
  Works with existing `api.openDocument(path, { download })` and Electron's `doc:open` IPC handler.

---

## 6. Implementation & Test Strategy

1. **Step 1:** Implement date preset calculator in `server/date-presets.js` and `src/lib/date-presets.js`.
2. **Step 2:** Expand server analytics queries in `server/reports.js` (`businessOverview`, enhanced product/client analytics, customer statements).
3. **Step 3:** Implement report PDF engine in `server/report-pdf.js` and HTML engine in `server/report-html.js`.
4. **Step 4:** Wire API routes in `server/api.js` for JSON reports, CSV exports, and PDF generation.
5. **Step 5:** Enhance UI in `src/views/reports.js` with date preset dropdowns, Business Overview KPI cards, Export PDF button, and rich table views.
6. **Step 6:** Write automated test suites in `tests/reports.test.js` covering date presets, KPI calculations, product analytics, customer statements, and PDF export validation.
7. **Step 7:** Document outcomes in `docs/REPORTING_TEST_REPORT.md`.
