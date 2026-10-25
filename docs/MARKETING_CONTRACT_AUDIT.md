# Marketing & Partnerships: Comprehensive Audit & Implementation Plan

**Target Application:** Nextora Creations Invoice Generator  
**Modules Audited:**
- Brand Assets & Logos (`src/views/marketing.js`, `server/marketing.js`, `server/api.js`, `server/service.js`, `electron/main.js`)
- Contracts & Agreements Preview & PDF Rendering (`src/views/marketing.js`, `server/contract-pdf.js`, `server/marketing.js`)
- Document Generation & Save IPC Bridge (`src/lib/api.js`, `electron/main.js`, `electron/preload.js`)
- Section 3 Deliverables Table & Section 4 Calculation Mechanics

---

## 1. Audit Findings & Root Cause Analysis

### 1.1 Brand Assets Upload: "Request body is too large" & Broken Image Previews

#### A. Root Cause: Default JSON Request Body Size Limit
- **Mechanism:** In `server/api.js`, the body parsing utility is defined as:
  ```javascript
  async function body(request, schema, limit = 262144)
  ```
  The parameter `limit` defaults to **262,144 bytes (256 KB)**.
- **Defect in Product Logo Endpoint:**
  ```javascript
  if ((path === '/api/settings/product-logo' || path === '/api/marketing/product-logo') && method === 'POST') {
    requireManager(actor);
    const input = await body(request, z.object({ logo: z.string().min(24).max(1800000) }).strict());
    ...
  ```
  `body(request, schema)` was invoked **without specifying the limit**.
- **Impact:** A 350 KB PNG or JPEG image, when serialized as a Base64 data URI in a JSON request body (`{"logo":"data:image/png;base64,..."}`), produces approximately **467 KB** of JSON text ($350000 \times 4/3 \approx 466,666$ bytes plus wrapper keys). When reading the incoming stream, `size > limit` triggered immediately at 256 KB, throwing:
  `HttpError(413, 'Request body is too large.', 'PAYLOAD_TOO_LARGE')`.
- **Defect in Corporate Logo Endpoint:**
  ```javascript
  if (path === '/api/settings/logo' && method === 'POST') {
    const input = await body(request, z.object({ png: z.string().min(24).max(900000) }).strict());
  ```
  Similarly, `body(request, ...)` defaulted to 256 KB, meaning any corporate logo larger than ~190 KB was rejected with the exact same error, despite the UI stating a 500 KB limit.

#### B. Root Cause: Broken Image Previews in Desktop Shell
- **Missing Corporate Logo GET Endpoint:** In `server/api.js`, there was no `GET /api/settings/logo` endpoint defined. An `<img>` pointing to `/api/settings/logo` returned 404 Not Found.
- **Electron Custom Protocol Handling:** In packaged mode, the renderer runs on `app://nextora/index.html`. In `electron/main.js`:
  ```javascript
  async function serveAppAsset(request) {
    const distDir = join(__dirname, '..', 'dist');
    const pathname = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    const target = normalize(join(distDir, pathname || 'index.html'));
  ```
  When the browser attempted to load `<img src="/api/marketing/product-logo">`, the request URL was `app://nextora/api/marketing/product-logo`. `serveAppAsset` looked for `dist/api/marketing/product-logo` on disk, which does not exist, and returned 404.
- **Frontend Fallback / Data Retrieval:** The UI did not load and cache the brand logo metadata and data URIs via the standard `api.get()` IPC channel, leaving the broken image icon displayed.

#### C. Dimension & Binary Validation Gaps
- `server/marketing.js` validated PNG magic bytes (`[137, 80, 78, 71, 13, 10, 26, 10]`) and extracted dimensions from the IHDR chunk.
- However, for JPEG images, magic bytes were checked (`[255, 216, 255]`), but dimensions were hardcoded to `width = 400; height = 200` without parsing the JPEG SOF markers or enforcing maximum dimension constraints (e.g., max 2000×2000 px).

---

### 1.2 Contract PDF Generation & Download Inconsistencies

#### A. Root Cause: "Generate PDF" Did Not Open Document
- In `src/views/marketing.js`:
  ```javascript
  ctx.on('generate-pdf-btn', async () => {
    await api.post(`/api/marketing/agreements/${agreementId}/generate-pdf`);
    toast('Contract PDF generated and snapshot preserved.');
    ctx.rerender();
  });
  ```
  This only recorded the snapshot timestamp on the server; it did not open the PDF for viewing or trigger a download.

#### B. Root Cause: "Download PDF" Used Unhandled Anchor Tag
- The "Download PDF" button was rendered as:
  ```html
  <a href="/api/marketing/agreements/${esc(s.contract_id)}/pdf" target="_blank">
  ```
  In the desktop application, clicking this anchor fails or attempts an internal navigation because the Electron IPC bridge (`window.electronAPI.openDocument({ path, download: true })`) is never called!
- In other views (Invoices, Quotations, Reports), the application uses:
  ```javascript
  api.openDocument(`/api/marketing/agreements/${agreementId}/pdf`, { download: true });
  ```
  This invokes `electron/main.js`'s `ipcMain.handle('doc:open')`, which triggers the native Windows `dialog.showSaveDialog`, saves the buffer safely, checks file existence and non-zero bytes, and returns a verified result.

---

### 1.3 Section 3 Deliverables Table

#### A. Discrepancies
- The current template and default configuration include a `Deadline` column (`15th of each month`, `End of quarter`), which is obsolete per business requirements.
- The column header is named `Required Tags / CTA` instead of `Required Instagram Handles`.
- The Instagram handles are `@nextoracreations #NextoraPOS` rather than `@nextora_pos, @nextora_creations`.
- The default quantity for Instagram Reels was set to `2` instead of the required minimum of `4` per month.

---

### 1.4 Section 4 Calculation Mechanics & GST Separation

#### A. Discrepancies
- Currently displays a single generic hypothetical sale of ₹10,000.00 with arbitrary figures.
- Does not present the two actual Nextora POS products:
  1. **Nextora POS Mobile App:** ₹5,999.00 GST-inclusive
  2. **Nextora POS Desktop:** ₹7,999.00 GST-inclusive
- Does not present the distinct Telangana intra-state (CGST 9% + SGST 9%) vs Interstate (IGST 18%) tax breakdowns.
- Lacks a unified calculation function shared between on-screen preview and vector PDF rendering.

---

### 1.5 Monthly Commission Settlement Clause

#### A. Discrepancies
- The contract text in Section 4 and Section 7 currently references general payment schedules without specifying the required "first week of each calendar month" settlement window.

---

## 2. Planned Changes & Implementation Strategy

### 2.1 Server & API Fixes (`server/api.js`, `server/marketing.js`, `server/service.js`, `electron/main.js`)
1. **Request Body Size Limits:**
   - In `server/api.js`, set body limits explicitly:
     - `POST /api/settings/product-logo` & `POST /api/marketing/product-logo`: limit = `2097152` (2 MB, easily accommodating 1 MB binary encoded as Base64 JSON).
     - `POST /api/settings/logo`: limit = `1048576` (1 MB, easily accommodating 500 KB binary encoded as Base64 JSON).
2. **Logo Endpoints & Data Retrieval:**
   - Implement `GET /api/settings/logo` in `server/api.js` returning the stored company logo binary with appropriate mime-type and cache headers.
   - Implement `GET /api/marketing/brand-assets` returning structured metadata and Base64 data URIs for both `product_logo` and `company_logo` for reliable rendering in any environment.
3. **Electron Protocol Routing:**
   - In `electron/main.js`, update `serveAppAsset` so requests matching `app://nextora/api/*` are directly dispatched through `dispatchApi`, enabling standard `<img>` tags to work seamlessly in packaged desktop builds.
4. **Image Parsing & Validation:**
   - In `server/marketing.js`, parse JPEG SOF markers (SOF0, SOF2) to extract real width and height, enforcing $40 \le \text{width} \le 2000$ and $20 \le \text{height} \le 2000$.
   - Preserve PNG transparency and prevent distortion.

### 2.2 Section 3 Deliverables Table
1. Default `Instagram Reels` to minimum **4 Monthly**.
2. Remove `Deadline` column.
3. Set column header to `Required Instagram Handles`.
4. Render `@nextora_pos, @nextora_creations`.
5. Preserve additional deliverables (`Product Demonstration`, etc.).

### 2.3 Section 4 Shared Product Calculation Engine
Create a single shared calculation module used identically by preview and PDF:
- For any GST-inclusive price $P$ at 18% GST:
  $$\text{Net Sale Value} = \text{round}\left(\frac{P \times 100}{118}\right)$$
  $$\text{GST Total} = P - \text{Net Sale Value}$$
  $$\text{Commission} = \text{round}\left(\text{Net Sale Value} \times \frac{\text{Rate}}{100}\right)$$
- **Nextora POS Mobile App (₹5,999.00):**
  - Net Sale Value: ₹5,083.90
  - GST Amount: ₹915.10
    - Telangana Intra-state: CGST 9% = ₹457.55, SGST 9% = ₹457.55
    - Interstate: IGST 18% = ₹915.10
  - Influencer Commission @ 50%: ₹2,541.95
- **Nextora POS Desktop (₹7,999.00):**
  - Net Sale Value: ₹6,778.81
  - GST Amount: ₹1,220.19
    - Telangana Intra-state: CGST 9% = ₹610.10, SGST 9% = ₹610.09 (reconciling to ₹1,220.19)
    - Interstate: IGST 18% = ₹1,220.19
  - Influencer Commission @ 50%: ₹3,389.41

### 2.4 Monthly Payment Schedule Clause
Update `DEFAULT_CONTRACT_CLAUSES.section_4_revenue_terms` and `section_7_payment_invoicing`:
```
Monthly Commission Settlement: Subject to reconciliation of verified eligible sales, applicable deductions, and any required documentation, commission payments shall be processed during the first week of each calendar month for the preceding settlement period. The payable amount shall be calculated using the agreed commission rate on eligible net sales revenue excluding GST, after accounting for approved refunds, cancellations, chargebacks, and other agreed adjustments.
```

### 2.5 Contract PDF Generation & Download Workflow
1. Wire `Generate PDF` button to generate the snapshot and immediately open preview via `api.openDocument(path, { download: false })`.
2. Wire `Download PDF` button to trigger native save dialog via `api.openDocument(path, { download: true })`.
3. Update `server/contract-pdf.js` to render the new Section 3 deliverables table, the two-product Section 4 calculations with intra-state / interstate breakdown, and the updated payment settlement clause.
