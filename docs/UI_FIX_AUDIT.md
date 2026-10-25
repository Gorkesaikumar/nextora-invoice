# Nextora Invoice Generator — Audit & Fix Plan: PDF Quantity Formatting & Products Page Spacing

**Project:** Nextora Creations — Invoice Generator  
**Date:** 2026-10-25  
**Document:** `docs/UI_FIX_AUDIT.md`  
**Status:** Audit Complete — Ready for Implementation

---

## 1. Issue 1: Quantity Formatting & Line-Item Overlap in Invoice PDF

### 1.1 Problem Observed
In generated invoice PDFs, the quantity column appears crowded and severely overlapped with text from adjacent columns (Rate, Discount, Taxable, GST, Amount). The QTY/RATE region displays a garbled black smudge of text (e.g. `1₹5,999.00` overlapping into one another), while columns further to the right (DISC, TAXABLE, GST, AMOUNT) appear blank or misaligned in the line-item row.

### 1.2 Root Cause Analysis
Inspecting [`server/pdf.js`](file:///D:/NEXTORA-INVOICE-GENERATOR/server/pdf.js) in `drawItemsTable()` (lines 364–394):

```javascript
let x = MARGIN;
const cell = (columnIndex, value, useBold = false, color = INK) => {
  const column = COLUMNS[columnIndex];
  const useFont = useBold ? bold : font;
  const size = fit(useFont, value, 7.5, column.width - 8);
  page.drawText(String(value), {
    x: column.align === 'right' ? x + column.width - useFont.widthOfTextAtSize(String(value), size) - 4 : x + 4,
    y: top - 10, size, font: useFont, color,
  });
};
cell(0, String(index + 1), false, MUTED);
// ... description drawn manually ...
x += COLUMNS[0].width + COLUMNS[1].width;
cell(2, quantityText(line.quantity_milli, line.unit));
cell(3, money(line.unit_price_minor));
cell(4, (line.item_discount_minor || 0) + (line.invoice_discount_minor || 0) > 0
  ? money((line.item_discount_minor || 0) + (line.invoice_discount_minor || 0)) : '-');
cell(5, money(line.taxable_minor));
cell(6, line.tax_minor > 0 ? `${rateLabel(line.tax_rate_bp)} ${money(line.tax_minor)}` : '-');
cell(7, money(line.total_minor), true);
```

**The Bug:**
1. `x` starts at `MARGIN` (`36`).
2. After drawing index (column 0) and description (column 1), `x` is incremented once:
   `x += COLUMNS[0].width + COLUMNS[1].width;` -> `x = 36 + 20 + 190 = 246`.
3. Then `cell(2)` through `cell(7)` are called sequentially, but `x` is **never incremented again**!
4. Consequently:
   - `cell(2)` (QTY) renders at `x + 40 - width` (`286 - width`)
   - `cell(3)` (RATE) renders at `x + 58 - width` (`304 - width`)
   - `cell(4)` (DISC) renders at `x + 46 - width` (`292 - width`)
   - `cell(5)` (TAXABLE) renders at `x + 62 - width` (`308 - width`)
   - `cell(6)` (GST) renders at `x + 52 - width` (`298 - width`)
   - `cell(7)` (AMOUNT) renders at `x + 55 - width` (`301 - width`)

All 6 data fields are drawn within the same 60-pixel slice between $x = 246$ and $x = 308$, right on top of each other in the QTY and RATE area. The columns to the right remain completely empty because their true coordinate offsets ($x > 340$) were never passed.

### 1.3 Numeric Quantity Formatting Analysis
`quantityText(quantityMilli, unit)` in `server/pdf.js` handles positive integer quantities, but needs robust edge-case handling for:
- Negative values (without losing sign or producing `"-1.-500"`).
- Decimals (stripping trailing zeros cleanly, e.g. `1.500` -> `1.5`).
- Null, undefined, or missing values (clean empty fallback).
- Column width: `COLUMNS[2]` is currently 40 points. Reallocating 5 points from `DESCRIPTION` (190 -> 185) to `QTY` (40 -> 45) provides comfortable breathing room for `1,000 NOS` or `125.500 KG` without font downsizing.

### 1.4 Implementation Plan for Issue 1
1. **Precomputed Column Offsets:** In `server/pdf.js`, calculate `COLUMN_OFFSETS` once from `COLUMNS`:
   ```javascript
   const COLUMN_OFFSETS = COLUMNS.reduce((acc, col, i) => {
     acc.push(i === 0 ? MARGIN : acc[i - 1] + COLUMNS[i - 1].width);
     return acc;
   }, []);
   ```
2. **Independent Cell Coordinate Positioning:** In `cell(columnIndex, value, ...)`:
   ```javascript
   const colLeft = COLUMN_OFFSETS[columnIndex];
   const colWidth = COLUMNS[columnIndex].width;
   const textX = column.align === 'right'
     ? colLeft + colWidth - useFont.widthOfTextAtSize(strVal, size) - 4
     : colLeft + 4;
   ```
3. **Dedicated `formatQuantity` Helper:** Implement and export `formatQuantity(quantityMilli, unit)` with comprehensive tests for whole numbers, fractions, large numbers, and null safety.
4. **Column Width Optimization:** Set `description: 185`, `quantity: 45` within total `523` printable width.

---

## 2. Issue 2: Products & Services Page Padding & Alignment

### 2.1 Problem Observed
On the Products & Services screen:
1. The table headers and cells have no left padding (`first:pl-0`), placing the product name directly against the card border.
2. The search/filter bar has `px-5 py-4` and the pagination footer has `px-5 py-3`, so the filters and footer are indented 20px while the table content sits at 0px, causing visual misalignment.
3. In smaller or resized windows, the table's `min-w-[960px]` without `min-w-0` on `#content` causes horizontal page blowout, scrolling the fixed navigation sidebar off-screen to the left (showing only the last letters "es" of "Products & Services", as captured in the user screenshot).

### 2.2 Root Cause Analysis
1. **Missing Table Cell Padding:**
   In [`src/style.css`](file:///D:/NEXTORA-INVOICE-GENERATOR/src/style.css):
   ```css
   .data-table th {
     @apply label-technical border-b border-outline py-2 pr-4 text-left align-bottom font-mono;
   }
   .data-table td {
     @apply border-b border-outline py-3 pr-4 align-top text-sm;
   }
   ```
   There is no `first:pl-*` or `last:pr-*` rule. The first `th`/`td` has zero left padding.
2. **Container Overflow Containment:**
   In [`src/main.js`](file:///D:/NEXTORA-INVOICE-GENERATOR/src/main.js):
   ```html
   <main id="content" class="mx-auto w-full max-w-container-max px-4 py-6 md:px-8 md:py-8"></main>
   ```
   `#content` does not have `min-w-0`. When a nested child has `min-w-[960px]`, standard block flex/grid items expand to fit the minimum content width if unconstrained, causing full-window horizontal scrolling instead of confining table overflow to `overflow-x-auto`.

### 2.3 Implementation Plan for Issue 2
1. **Table Cell Padding & Alignment:**
   In `src/style.css`, update `.data-table th` and `.data-table td` with:
   - `first:pl-6` (or `first:pl-5` to match card header/footer)
   - `last:pr-6` (or `last:pr-5`)
   This aligns the first column (`Name`) with the filter inputs above and the record count below, and aligns the last column (`Edit`) with the action buttons.
2. **Card Internal Spacing & Containment:**
   In [`src/views/products.js`](file:///D:/NEXTORA-INVOICE-GENERATOR/src/views/products.js):
   - Wrap view in a clean `<div class="space-y-6 w-full min-w-0">` container.
   - Use consistent `px-6` (or `px-5`) padding across the filter form and pagination.
   - Ensure the card has `w-full max-w-full overflow-hidden`.
3. **Page Container Containment:**
   In [`src/main.js`](file:///D:/NEXTORA-INVOICE-GENERATOR/src/main.js), ensure `<main id="content">` has `min-w-0` so horizontal table scrolling remains strictly contained within `.overflow-x-auto`.

---

## 3. Scope & Regression Safety
- **No changes to financial calculations:** unit prices, discounts, taxes, and totals remain untouched.
- **No changes to database schema or migrations.**
- **No Windows EXE packaging or version increments.**
- **Preserve existing functionality across Invoices, Quotations, and Reports.**
