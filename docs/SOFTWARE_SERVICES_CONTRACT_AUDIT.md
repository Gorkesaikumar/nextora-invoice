# Audit & Architecture: Software Development Services Agreement Implementation

**Target Application:** Nextora Creations Invoice Generator  
**Feature:** Software Development Services Agreement Module  
**Date:** October 2026  
**Author:** Senior Full-Stack Engineer & Electron Architect  

---

## 1. Executive Summary & Audit Findings

Nextora Creations provides software development services, custom digital solutions, and digital products. This audit inspects the existing billing and contract generation architecture to design and implement a complete **Software Development Services Agreement** capability integrated within the existing **Contracts & Agreements** workflow.

### 1.1 Existing Architecture Inspection

1. **Marketing & Partnerships Module (`src/views/marketing.js`, `server/marketing.js`):**
   - Contains navigation tabs: Dashboard (`#/marketing`), Influencers (`#/marketing/influencers`), Contracts & Agreements (`#/marketing/contracts`), Import Sales Excel (`#/marketing/import`), Influencer Sales Reports (`#/marketing/reports`), and Brand Assets (`#/marketing/assets`).
   - The Contracts & Agreements view lists contracts with search, status filtering, preview modal, duplicate, PDF generation, and download capabilities.

2. **Existing Contract Model & Schema (`server/migrations/007_marketing_contracts.sql`):**
   - The existing contract table `inv.influencer_agreements` is tightly coupled to influencer partnerships: required `influencer_id REFERENCES inv.influencers(id)`, commission basis points, TDS withholding (Section 194H), social media deliverables, etc.
   - Forcing software development contracts into `inv.influencer_agreements` would pollute schemas with nullable foreign keys and unrelated columns.
   - **Architectural Decision:** Create a dedicated table `inv.software_agreements` with appropriate foreign keys (`client_id REFERENCES inv.clients(id)` optional for ad-hoc clients, but fully linked to `inv.clients` master records), structured JSONB for features/scope, payment milestones, support terms, and immutable snapshots.

3. **Contract Numbering & Document Identity (`server/numbering.js`):**
   - Atomic sequence allocation per financial year: `allocateNumber(tx, { docType, prefix, date })`.
   - `inv.document_sequences` has a check constraint for `doc_type`:
     `('QUOTATION','INVOICE','PAYMENT_RECEIPT','CREDIT_NOTE','DEBIT_NOTE','INFLUENCER_AGREEMENT')`.
   - We must expand this constraint to include `'SOFTWARE_SERVICES_AGREEMENT'`.
   - In `inv.business_settings`, add `software_contract_prefix` (default: `'NC/SDA'`).

4. **Contract Lifecycle & State Transitions:**
   - Influencer contracts support: `DRAFT`, `PENDING_APPROVAL`, `SENT`, `ACCEPTED`, `SIGNED`, `ACTIVE`, `EXPIRED`, `TERMINATED`.
   - Software development contracts require a matching professional lifecycle:
     - `DRAFT`: Initial draft, fully editable.
     - `PENDING_APPROVAL`: Submitted for internal review.
     - `APPROVED`: Internally approved.
     - `SENT`: Delivered to client for signature.
     - `ACCEPTED`: Client approved the agreement.
     - `SIGNED`: Duly executed with signatures recorded.
     - `ACTIVE`: Project development in progress.
     - `COMPLETED`: Project delivered and accepted.
     - `TERMINATED`: Formally cancelled.
   - Once finalized/signed, the contract snapshot is immutable. Scope revisions follow explicit amendments.

5. **Client Master Records (`server/service.js`, `src/views/clients.js`):**
   - `inv.clients` stores `name`, `company_name`, `contact_person`, `email`, `phone`, `billing_address`, `service_address`, `gstin`, `state_code`, `country`, `payment_terms_days`, `gst_registered`, `status`.
   - Duplicate warnings and GSTIN checksum validation are available.
   - Software contracts allow selecting an existing client from `inv.clients` or entering new client details.
   - Historical immutability: The contract stores a full snapshot of client details at the time of agreement. Updating a client in the master directory will not alter historical contracts.

6. **Brand Assets & Corporate Identity (`server/marketing.js`, `server/api.js`):**
   - Corporate logo: `company_logo` stored in `inv.brand_assets` (with fallback to `inv.company_assets`).
   - Retrieval via `brandLogoBytes(db, 'company_logo')` and `GET /api/settings/logo`.
   - If no logo is uploaded, the document renders the official text-based Nextora Creations letterhead.

7. **PDF Generation Engine (`server/contract-pdf.js`, `server/pdf.js`):**
   - Pure vector PDF generation via `pdf-lib` and `fontkit`, rendering with `NotoSans-Regular.ttf` and `NotoSans-Bold.ttf`.
   - Multi-page layout with dynamic wrapping, pagination, running headers, table drawing, footers with page numbers, and signature blocks.
   - We will implement a dedicated software services contract renderer `renderSoftwareContractPdf(snapshot, { companyLogo })` that renders professional A4 pages with all required software agreement sections, feature tables, milestone tables, GST breakdowns, support clauses, and signature boxes.

8. **Desktop IPC Bridge & Downloads (`electron/main.js`, `src/lib/api.js`):**
   - `api.openDocument(path, { download: true })` calls `window.electronAPI.openDocument` in Electron, triggering `dialog.showSaveDialog` and verifying written file existence and non-zero bytes.
   - Browser fallback creates a download link with `URL.createObjectURL(blob)`.

9. **Financial Integrity & Indian GST Calculations (`server/money.js`, `server/gst.js`):**
   - Deterministic integer paise arithmetic (`toMinor`, `roundDiv`, `percentOf`).
   - GST-exclusive mode: $\text{Taxable} = \text{Base Price} - \text{Discount} + \text{Charges}$; $\text{GST} = \text{percentOf}(\text{Taxable}, \text{Rate})$; $\text{Total} = \text{Taxable} + \text{GST}$.
   - GST-inclusive mode: $\text{Gross} = \text{Entered Price}$; $\text{Taxable} = \text{roundDiv}(\text{Gross} \times 10000, 10000 + \text{Rate BP})$; $\text{GST} = \text{Gross} - \text{Taxable}$.
   - Intra-state (Telangana `36`): Splits tax 50/50 into CGST and SGST.
   - Interstate (outside Telangana or export `96`): Routes entire tax to IGST.
   - 10% advance default: $\text{Advance} = \text{roundDiv}(\text{Total} \times 10, 100)$ (or on taxable value based on configuration).
   - Milestone balance reconciliation: Sum of milestones must exactly reconcile with the remaining project balance.

10. **Business Defaults:**
    - Advance: 10% of agreed project price before taxes (configurable).
    - Timeline: 1 month estimated development duration (configurable).
    - Free support: 3 months from handover/acceptance (configurable).
    - Post-support features: ₹5,000 per approved feature default (configurable).
    - Monthly maintenance: ₹2,000 per month default (configurable, opt-in).

---

## 2. Proposed Architecture & Implementation Plan

### 2.1 Database Migrations (`009_software_services_contracts.sql`)
1. Create `inv.software_agreements` in both PostgreSQL and SQLite.
2. Update `inv.document_sequences` doc_type check constraint.
3. Add `software_contract_prefix` to `inv.business_settings`.

### 2.2 Server Services & Business Logic (`server/software-contracts.js`)
1. CRUD operations for software agreements.
2. Status transitions with audit logging.
3. Financial calculation engine supporting EXCLUSIVE and INCLUSIVE GST, Telangana intra-state CGST/SGST vs Interstate IGST, 10% advance, milestone reconciliation.
4. Comprehensive contract snapshot builder with clauses 12.1 through 12.18.
5. Duplication and PDF generation tracking.

### 2.3 Vector PDF Generation (`server/software-contract-pdf.js`)
1. Multi-page A4 document rendered using `pdf-lib` and Noto Sans fonts.
2. Running headers, footers with "Page X of Y", company branding / logo.
3. Client details section, project overview, structured feature table, financial breakdown table, payment milestones, support & maintenance terms, standard legal clauses, and dual signature blocks.

### 2.4 API Routes (`server/api.js`)
- `GET /api/marketing/contracts`: Consolidated list of all agreements (Influencer & Software).
- `GET /api/marketing/software-agreements`: List and filter software agreements.
- `POST /api/marketing/software-agreements`: Create new software agreement draft.
- `GET /api/marketing/software-agreements/:id`: Get agreement details.
- `PATCH /api/marketing/software-agreements/:id`: Update draft.
- `POST /api/marketing/software-agreements/:id/status`: Transition status.
- `POST /api/marketing/software-agreements/:id/duplicate`: Duplicate agreement.
- `GET /api/marketing/software-agreements/:id/preview`: Contract snapshot for preview.
- `POST /api/marketing/software-agreements/:id/generate-pdf`: Render and record PDF snapshot.
- `GET /api/marketing/software-agreements/:id/pdf`: Download/view PDF binary.

### 2.5 UI Implementation (`src/views/marketing.js` & `src/views/software-contract-editor.js`)
1. Agreement type selection modal when clicking "New Agreement":
   - "Influencer Marketing & Revenue-Sharing Agreement"
   - "Software Development Services Agreement"
2. Interactive multi-section software contract editor:
   - Client picker / manual entry with GSTIN validation.
   - Project & Service Details (service category, title, objectives, dates, deployment target).
   - Feature Scope Table (add, edit, remove feature rows with S.No, Name, Description, Deliverables, Priority, Acceptance Criteria, Included/Excluded, Notes).
   - Financial & GST configuration (Price, Tax Mode, GST Rate, Advance %, Milestones with live balance reconciliation).
   - Support & Maintenance configuration (3-month free support, ₹5,000 post-support feature rate, ₹2,000 monthly maintenance toggle).
   - Terms & Conditions customization.
3. Interactive HTML Contract Preview with status banner, PDF generation, and download buttons.

### 2.6 Test Strategy (`tests/software-contracts.test.js`)
- Unit and integration tests covering client selection, financial calculations (exclusive/inclusive, intra/inter-state), milestone reconciliation, support periods, PDF vector generation, text extraction, status transitions, and regression testing for existing influencer agreements.
