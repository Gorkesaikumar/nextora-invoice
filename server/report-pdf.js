import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFontBytes } from './pdf.js';

const A4_PORTRAIT = { width: 595.28, height: 841.89 };
const A4_LANDSCAPE = { width: 841.89, height: 595.28 };
const MARGIN = 36;
const FOOTER_HEIGHT = 28;

const C_NAVY = rgb(0.06, 0.09, 0.16); // #0f172a
const C_DARK = rgb(0.12, 0.14, 0.17); // #1e242b
const C_MUTED = rgb(0.4, 0.45, 0.52); // #64748b
const C_BORDER = rgb(0.88, 0.9, 0.94); // #e2e8f0
const C_ZEBRA = rgb(0.97, 0.98, 0.99); // #f8fafc
const C_HEADER_BG = rgb(0.08, 0.12, 0.2);
const C_WHITE = rgb(1, 1, 1);
const C_RED = rgb(0.72, 0.11, 0.11);
const C_GREEN = rgb(0.09, 0.4, 0.2);

function formatInr(minor) {
  const value = Number(minor || 0) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const [y, m, d] = String(isoStr).slice(0, 10).split('-');
    if (!y || !m || !d) return isoStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
  } catch {
    return isoStr;
  }
}

function truncate(str, maxLen = 30) {
  if (!str) return '';
  const text = String(str);
  return text.length > maxLen ? `${text.slice(0, maxLen - 2)}..` : text;
}

export async function renderReportPdf(section, data, options = {}) {
  const isLandscape = ['invoices', 'collections', 'products', 'clients', 'receivables', 'tax', 'quotations', 'monthly_revenue', 'influencers', 'influencer_sales', 'imports'].includes(section);
  const pageSize = isLandscape ? A4_LANDSCAPE : A4_PORTRAIT;
  const contentWidth = pageSize.width - MARGIN * 2;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const regularFontBytes = await readFontBytes('NotoSans-Regular.ttf');
  const boldFontBytes = await readFontBytes('NotoSans-Bold.ttf');
  const regularFont = await pdfDoc.embedFont(regularFontBytes, { subset: true });
  const boldFont = await pdfDoc.embedFont(boldFontBytes, { subset: true });

  const generatedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const dateRange = options.rangeLabel || (options.from && options.to ? `${options.from} to ${options.to}` : 'All available dates');

  const pages = [];

  function newPage() {
    const page = pdfDoc.addPage([pageSize.width, pageSize.height]);
    pages.push(page);
    return page;
  }

  let currentPage = newPage();
  let currentY = pageSize.height - MARGIN;

  // Title configuration by section
  const TITLES = {
    overview: { title: 'BUSINESS OVERVIEW & SALES ANALYTICS', sub: 'Executive Financial Summary & Period Comparisons' },
    monthly_revenue: { title: 'MONTHLY COMPANY REVENUE REPORT', sub: 'Month-by-Month Financial Turnover & Collection Reconciliation' },
    invoices: { title: 'INVOICE REGISTER REPORT', sub: 'Invoices Issued, Taxable Value, Tax Slabs, and Balances' },
    collections: { title: 'COLLECTIONS & CASH RECEIPTS REPORT', sub: 'Recorded Payments and Money Received on Invoices' },
    products: { title: 'PRODUCT & SERVICE SALES ANALYTICS', sub: 'Quantities Sold, Realized Pricing, Revenue & Sales Contribution' },
    clients: { title: 'CUSTOMER-WISE REVENUE & RECEIVABLES', sub: 'Sales Totals, Cash Receipts, Outstanding Balances & Overdue Aging' },
    receivables: { title: 'ACCOUNTS RECEIVABLE & AGEING REPORT', sub: 'Unpaid Invoices Grouped by Due Date & Aging Schedule' },
    tax: { title: 'GST TAX SUMMARY & LIABILITY REPORT', sub: 'HSN/SAC Classification, Tax Slabs, and Net Adjustment Notes' },
    quotations: { title: 'QUOTATION PERFORMANCE REPORT', sub: 'Estimate Pipeline, Acceptance Ratio, and Invoice Conversions' },
    influencers: { title: 'INFLUENCER MARKETING PARTNERS REGISTER', sub: 'Partner Performance, Attributed Sales, Commission Earned and Payable' },
    influencer_sales: { title: 'INFLUENCER SALES ATTRIBUTION DETAIL', sub: 'Individual Attributed Transactions, Products, and Commission Calculations' },
    imports: { title: 'SALES EXCEL IMPORT BATCH AUDIT', sub: 'Import History, Record Counts, Gross Attributed Sales, and Commissions' },
    statement: { title: `CUSTOMER STATEMENT OF ACCOUNT`, sub: `Transaction Ledger & Reconciliation — ${data.client?.name || ''}` },
  };

  const info = TITLES[section] || { title: 'BUSINESS REPORT', sub: 'Nextora Creations Internal Report' };

  // Draw Page 1 Corporate Header
  function drawFirstPageHeader() {
    // Brand header
    currentPage.drawText('NEXTORA CREATIONS', {
      x: MARGIN,
      y: currentY - 14,
      size: 16,
      font: boldFont,
      color: C_NAVY,
    });

    // Date range & timestamp (right aligned)
    const metaRight = `Generated: ${generatedAt}`;
    const rangeRight = `Range: ${dateRange}`;
    const metaWidth = regularFont.widthOfTextAtSize(metaRight, 8.5);
    const rangeWidth = regularFont.widthOfTextAtSize(rangeRight, 8.5);

    currentPage.drawText(metaRight, {
      x: pageSize.width - MARGIN - metaWidth,
      y: currentY - 10,
      size: 8.5,
      font: regularFont,
      color: C_MUTED,
    });
    currentPage.drawText(rangeRight, {
      x: pageSize.width - MARGIN - rangeWidth,
      y: currentY - 22,
      size: 8.5,
      font: regularFont,
      color: C_MUTED,
    });

    currentY -= 28;

    // Report title & subtitle
    currentPage.drawText(info.title, {
      x: MARGIN,
      y: currentY - 10,
      size: 11,
      font: boldFont,
      color: C_DARK,
    });
    currentPage.drawText(info.sub, {
      x: MARGIN,
      y: currentY - 22,
      size: 8.5,
      font: regularFont,
      color: C_MUTED,
    });

    currentY -= 32;

    // Dividing rule
    currentPage.drawLine({
      start: { x: MARGIN, y: currentY },
      end: { x: pageSize.width - MARGIN, y: currentY },
      thickness: 1.5,
      color: C_NAVY,
    });

    currentY -= 14;
  }

  // Draw Stat KPI boxes
  function drawKpiCards(cards) {
    const count = cards.length;
    const gap = 10;
    const cardWidth = (contentWidth - gap * (count - 1)) / count;
    const cardHeight = 44;

    for (let i = 0; i < count; i++) {
      const card = cards[i];
      const cx = MARGIN + i * (cardWidth + gap);
      const cy = currentY - cardHeight;

      currentPage.drawRectangle({
        x: cx,
        y: cy,
        width: cardWidth,
        height: cardHeight,
        color: C_ZEBRA,
        borderColor: C_BORDER,
        borderWidth: 1,
      });

      currentPage.drawText(card.label.toUpperCase(), {
        x: cx + 8,
        y: cy + 30,
        size: 7,
        font: boldFont,
        color: C_MUTED,
      });

      currentPage.drawText(card.value, {
        x: cx + 8,
        y: cy + 14,
        size: 11,
        font: boldFont,
        color: card.alert ? C_RED : C_NAVY,
      });

      if (card.hint) {
        currentPage.drawText(card.hint, {
          x: cx + 8,
          y: cy + 4,
          size: 6.5,
          font: regularFont,
          color: C_MUTED,
        });
      }
    }

    currentY -= (cardHeight + 16);
  }

  // Draw Table with repeating headers
  function drawTable({ columns, rows, totalsRow }) {
    const rowHeight = 18;
    const headerHeight = 20;

    function renderTableHeader(targetPage, yPos) {
      targetPage.drawRectangle({
        x: MARGIN,
        y: yPos - headerHeight,
        width: contentWidth,
        height: headerHeight,
        color: C_HEADER_BG,
      });

      let colX = MARGIN;
      for (const col of columns) {
        const text = col.label;
        const size = 7.5;
        const textWidth = boldFont.widthOfTextAtSize(text, size);
        let tx = colX + 4;
        if (col.align === 'right') {
          tx = colX + col.width - textWidth - 4;
        } else if (col.align === 'center') {
          tx = colX + (col.width - textWidth) / 2;
        }

        targetPage.drawText(text, {
          x: tx,
          y: yPos - 13,
          size,
          font: boldFont,
          color: C_WHITE,
        });
        colX += col.width;
      }

      return yPos - headerHeight;
    }

    // Render initial header
    currentY = renderTableHeader(currentPage, currentY);

    if (!rows || rows.length === 0) {
      currentY -= 25;
      currentPage.drawText('No records found for the selected reporting period.', {
        x: MARGIN + 10,
        y: currentY + 8,
        size: 8.5,
        font: regularFont,
        color: C_MUTED,
      });
      currentY -= 15;
      return;
    }

    // Render Rows
    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const row = rows[rIdx];

      // Check if page break is needed
      if (currentY - rowHeight < MARGIN + FOOTER_HEIGHT + 10) {
        currentPage = newPage();
        currentY = pageSize.height - MARGIN;
        currentY = renderTableHeader(currentPage, currentY);
      }

      // Zebra stripe
      if (rIdx % 2 === 1) {
        currentPage.drawRectangle({
          x: MARGIN,
          y: currentY - rowHeight,
          width: contentWidth,
          height: rowHeight,
          color: C_ZEBRA,
        });
      }

      // Border line below row
      currentPage.drawLine({
        start: { x: MARGIN, y: currentY - rowHeight },
        end: { x: pageSize.width - MARGIN, y: currentY - rowHeight },
        thickness: 0.5,
        color: C_BORDER,
      });

      let colX = MARGIN;
      for (const col of columns) {
        const rawVal = col.render ? col.render(row, rIdx) : (row[col.key] ?? '');
        const valStr = truncate(String(rawVal), col.maxChars || 40);
        const size = col.size || 8;
        const font = col.bold ? boldFont : regularFont;
        const color = col.color || C_DARK;
        const textWidth = font.widthOfTextAtSize(valStr, size);

        let tx = colX + 4;
        if (col.align === 'right') {
          tx = colX + col.width - textWidth - 4;
        } else if (col.align === 'center') {
          tx = colX + (col.width - textWidth) / 2;
        }

        currentPage.drawText(valStr, {
          x: tx,
          y: currentY - 12,
          size,
          font,
          color,
        });
        colX += col.width;
      }

      currentY -= rowHeight;
    }

    // Totals row (if present)
    if (totalsRow) {
      if (currentY - (rowHeight + 4) < MARGIN + FOOTER_HEIGHT) {
        currentPage = newPage();
        currentY = pageSize.height - MARGIN;
        currentY = renderTableHeader(currentPage, currentY);
      }

      currentPage.drawRectangle({
        x: MARGIN,
        y: currentY - (rowHeight + 2),
        width: contentWidth,
        height: rowHeight + 2,
        color: C_ZEBRA,
      });

      currentPage.drawLine({
        start: { x: MARGIN, y: currentY },
        end: { x: pageSize.width - MARGIN, y: currentY },
        thickness: 1.5,
        color: C_NAVY,
      });
      currentPage.drawLine({
        start: { x: MARGIN, y: currentY - (rowHeight + 2) },
        end: { x: pageSize.width - MARGIN, y: currentY - (rowHeight + 2) },
        thickness: 1.5,
        color: C_NAVY,
      });

      let colX = MARGIN;
      for (const col of columns) {
        const val = totalsRow[col.key];
        if (val !== undefined && val !== null) {
          const valStr = String(val);
          const size = 8;
          const textWidth = boldFont.widthOfTextAtSize(valStr, size);
          let tx = colX + 4;
          if (col.align === 'right') {
            tx = colX + col.width - textWidth - 4;
          }
          currentPage.drawText(valStr, {
            x: tx,
            y: currentY - 14,
            size,
            font: boldFont,
            color: C_NAVY,
          });
        }
        colX += col.width;
      }
      currentY -= (rowHeight + 10);
    }
  }

  // Render content according to section
  drawFirstPageHeader();

  switch (section) {
    case 'overview': {
      const m = data.metrics || {};
      drawKpiCards([
        { label: 'Invoiced Sales', value: formatInr(m.invoiced?.current), hint: `${m.invoiced?.percent > 0 ? '+' : ''}${m.invoiced?.percent}% vs prior` },
        { label: 'Collections Received', value: formatInr(m.collected?.current), hint: `${m.collected?.percent > 0 ? '+' : ''}${m.collected?.percent}% vs prior` },
        { label: 'Current Receivables', value: formatInr(m.receivables?.total_minor), hint: `${m.receivables?.count || 0} active invoice(s)` },
        { label: 'Overdue Balance', value: formatInr(m.overdue?.total_minor), alert: m.overdue?.total_minor > 0, hint: `${m.overdue?.count || 0} overdue invoice(s)` },
      ]);

      drawKpiCards([
        { label: 'Taxable Turnover', value: formatInr(m.taxable?.current), hint: `${m.invoices_count?.current || 0} invoices issued` },
        { label: 'Total Output GST', value: formatInr(m.tax?.current), hint: `CGST+SGST+IGST` },
        { label: 'Active Clients', value: String(m.active_clients || 0), hint: `Billed in this period` },
        { label: 'Cancelled / Void', value: String(m.cancelled_count || 0), hint: `Excluded from revenue` },
      ]);

      drawKpiCards([
        { label: 'Quotation Pipeline', value: formatInr(m.quotations_issued?.current_value_minor || 0), hint: `${m.quotations_issued?.current || 0} quotes (${m.quotations_converted?.conversion_rate_pct || 0}% won)` },
        { label: 'Units / Volume Sold', value: Number(m.units_sold?.current || 0).toLocaleString('en-IN'), hint: `${m.invoices_count?.current || 0} direct invoices` },
        { label: 'Influencer Sales', value: formatInr(m.influencer_sales?.current || 0), hint: `${m.influencer_sales?.count || 0} attributed orders` },
        { label: 'Influencer Comm Due', value: formatInr(m.influencer_commission_payable?.current || 0), alert: (m.influencer_commission_payable?.current || 0) > 0, hint: `Earned: ${formatInr(m.influencer_commission_earned?.current || 0)}` },
      ]);

      currentPage.drawText('TOP PRODUCTS & SERVICES BY SALES', {
        x: MARGIN,
        y: currentY - 4,
        size: 9.5,
        font: boldFont,
        color: C_NAVY,
      });
      currentY -= 14;

      drawTable({
        columns: [
          { key: 'rank', label: '#', width: 30, align: 'left', render: (_, i) => String(i + 1) },
          { key: 'description', label: 'PRODUCT / SERVICE', width: 270, align: 'left', bold: true, maxChars: 45 },
          { key: 'qty', label: 'QTY SOLD', width: 85, align: 'right', render: r => (Number(r.quantity_milli || 0) / 1000).toLocaleString('en-IN') },
          { key: 'total', label: 'INVOICED AMOUNT', width: 138, align: 'right', bold: true, render: r => formatInr(r.total_minor) },
        ],
        rows: data.top_products || [],
      });

      currentY -= 10;
      currentPage.drawText('TOP CLIENTS BY INVOICED VALUE', {
        x: MARGIN,
        y: currentY - 4,
        size: 9.5,
        font: boldFont,
        color: C_NAVY,
      });
      currentY -= 14;

      drawTable({
        columns: [
          { key: 'rank', label: '#', width: 30, align: 'left', render: (_, i) => String(i + 1) },
          { key: 'client_name', label: 'CLIENT NAME', width: 330, align: 'left', bold: true, maxChars: 50 },
          { key: 'invoiced', label: 'INVOICED AMOUNT', width: 163, align: 'right', bold: true, render: r => formatInr(r.invoiced_minor) },
        ],
        rows: data.top_clients || [],
      });
      break;
    }

    case 'monthly_revenue': {
      const rows = data.rows || [];
      const tot = data.totals || {};
      drawKpiCards([
        { label: 'Total Invoiced Sales', value: formatInr(tot.net_invoiced_minor), hint: `${tot.invoices_count || 0} direct invoices` },
        { label: 'Collections Received', value: formatInr(tot.collected_minor), hint: `Net: ${formatInr(tot.net_collected_minor)}` },
        { label: 'Receivables Balance', value: formatInr(tot.receivables_minor), alert: tot.receivables_minor > 0 },
        { label: 'Influencer Sales', value: formatInr(tot.influencer_sales_minor), hint: `Attributed partner sales` },
        { label: 'Partner Comm Payable', value: formatInr(tot.influencer_commission_payable_minor), alert: tot.influencer_commission_payable_minor > 0, hint: `Earned: ${formatInr(tot.influencer_commission_earned_minor)}` },
      ]);

      drawTable({
        columns: [
          { key: 'month_label', label: 'MONTH', width: 75, align: 'left', bold: true },
          { key: 'invoices_count', label: 'INVS', width: 35, align: 'right', render: r => String(r.invoices_count || 0) },
          { key: 'net_invoiced_minor', label: 'INVOICED', width: 75, align: 'right', bold: true, render: r => formatInr(r.net_invoiced_minor) },
          { key: 'collected_minor', label: 'COLLECTIONS', width: 75, align: 'right', render: r => formatInr(r.collected_minor) },
          { key: 'net_collected_minor', label: 'NET COLL', width: 75, align: 'right', render: r => formatInr(r.net_collected_minor) },
          { key: 'receivables_minor', label: 'RECEIVABLES', width: 75, align: 'right', render: r => formatInr(r.receivables_minor) },
          { key: 'influencer_sales_minor', label: 'INF SALES', width: 80, align: 'right', render: r => formatInr(r.influencer_sales_minor) },
          { key: 'influencer_commission_earned_minor', label: 'COMM EARNED', width: 80, align: 'right', render: r => formatInr(r.influencer_commission_earned_minor) },
          { key: 'influencer_commission_payable_minor', label: 'COMM DUE', width: 75, align: 'right', render: r => formatInr(r.influencer_commission_payable_minor) },
          { key: 'growth_pct', label: 'MOM %', width: 55, align: 'right', render: r => (r.growth_pct !== null && r.growth_pct !== undefined ? `${r.growth_pct > 0 ? '+' : ''}${r.growth_pct}%` : '—') },
        ],
        rows,
        totalsRow: {
          month_label: `TOTAL (${rows.length})`,
          invoices_count: String(tot.invoices_count || 0),
          net_invoiced_minor: formatInr(tot.net_invoiced_minor),
          collected_minor: formatInr(tot.collected_minor),
          net_collected_minor: formatInr(tot.net_collected_minor),
          receivables_minor: formatInr(tot.receivables_minor),
          influencer_sales_minor: formatInr(tot.influencer_sales_minor),
          influencer_commission_earned_minor: formatInr(tot.influencer_commission_earned_minor),
          influencer_commission_payable_minor: formatInr(tot.influencer_commission_payable_minor),
          growth_pct: '—',
        },
      });
      break;
    }

    case 'invoices': {
      const rows = data.rows || [];
      drawKpiCards([
        { label: 'Invoices Issued', value: String(rows.length), hint: 'Total documents' },
        { label: 'Taxable Value', value: formatInr(data.taxable_minor) },
        { label: 'Total GST', value: formatInr(data.tax_minor) },
        { label: 'Grand Invoiced Total', value: formatInr(data.totals) },
        { label: 'Outstanding Balance', value: formatInr(data.balance_due_minor), alert: data.balance_due_minor > 0 },
      ]);

      drawTable({
        columns: [
          { key: 'invoice_number', label: 'INVOICE #', width: 65, align: 'left', bold: true },
          { key: 'issue_date', label: 'DATE', width: 55, align: 'left', render: r => formatDate(r.issue_date) },
          { key: 'due_date', label: 'DUE', width: 55, align: 'left', render: r => formatDate(r.due_date) },
          { key: 'client_name', label: 'CLIENT', width: 130, align: 'left', maxChars: 24 },
          { key: 'client_gstin', label: 'GSTIN', width: 85, align: 'left', render: r => r.client_gstin || '—' },
          { key: 'payment_status', label: 'STATUS', width: 65, align: 'left' },
          { key: 'taxable_minor', label: 'TAXABLE', width: 65, align: 'right', render: r => formatInr(r.taxable_minor) },
          { key: 'tax_minor', label: 'GST', width: 55, align: 'right', render: r => formatInr(Number(r.cgst_minor || 0) + Number(r.sgst_minor || 0) + Number(r.igst_minor || 0)) },
          { key: 'grand_total_minor', label: 'TOTAL', width: 70, align: 'right', bold: true, render: r => formatInr(r.grand_total_minor) },
          { key: 'paid_minor', label: 'PAID', width: 60, align: 'right', render: r => formatInr(r.paid_minor) },
          { key: 'balance_due_minor', label: 'BALANCE', width: 65, align: 'right', bold: true, render: r => formatInr(r.balance_due_minor) },
        ],
        rows,
        totalsRow: {
          invoice_number: `TOTAL (${rows.length})`,
          taxable_minor: formatInr(data.taxable_minor),
          tax_minor: formatInr(data.tax_minor),
          grand_total_minor: formatInr(data.totals),
          paid_minor: formatInr(data.paid_minor),
          balance_due_minor: formatInr(data.balance_due_minor),
        },
      });
      break;
    }

    case 'collections': {
      const rows = data.rows || [];
      drawKpiCards([
        { label: 'Total Receipts', value: String(rows.length), hint: 'Payment entries' },
        { label: 'Total Collected', value: formatInr(data.collected_minor), hint: 'Cash received' },
      ]);

      drawTable({
        columns: [
          { key: 'receipt_number', label: 'RECEIPT #', width: 80, align: 'left', bold: true },
          { key: 'paid_on', label: 'PAID ON', width: 70, align: 'left', render: r => formatDate(r.paid_on) },
          { key: 'client_name', label: 'CLIENT', width: 180, align: 'left', maxChars: 30 },
          { key: 'invoice_number', label: 'INVOICE #', width: 80, align: 'left', render: r => r.invoice_number || '—' },
          { key: 'method', label: 'METHOD', width: 80, align: 'left' },
          { key: 'reference', label: 'REFERENCE', width: 150, align: 'left', render: r => r.reference || '—' },
          { key: 'amount_minor', label: 'AMOUNT PAID', width: 130, align: 'right', bold: true, render: r => formatInr(r.amount_minor) },
        ],
        rows,
        totalsRow: {
          receipt_number: `TOTAL (${rows.length})`,
          amount_minor: formatInr(data.collected_minor),
        },
      });
      break;
    }

    case 'products': {
      const rows = data.rows || [];
      drawKpiCards([
        { label: 'Active Products Sold', value: String(rows.length) },
        { label: 'Taxable Turnover', value: formatInr(data.taxable_minor) },
        { label: 'GST Collected', value: formatInr(data.tax_minor) },
        { label: 'Total Invoiced Sales', value: formatInr(data.total_minor) },
      ]);

      drawTable({
        columns: [
          { key: 'rank', label: '#', width: 25, align: 'left', render: (_, i) => String(i + 1) },
          { key: 'description', label: 'ITEM NAME', width: 160, align: 'left', bold: true, maxChars: 28 },
          { key: 'sku', label: 'SKU', width: 65, align: 'left', render: r => r.sku || '—' },
          { key: 'category', label: 'CATEGORY', width: 75, align: 'left', render: r => r.category || '—' },
          { key: 'qty', label: 'QTY', width: 50, align: 'right', render: r => (Number(r.quantity_milli || 0) / 1000).toLocaleString('en-IN') },
          { key: 'unit', label: 'UNIT', width: 35, align: 'left', render: r => r.unit || 'NOS' },
          { key: 'invoices', label: 'INV', width: 45, align: 'right', render: r => String(r.invoices) },
          { key: 'avg_price', label: 'AVG PRICE', width: 65, align: 'right', render: r => formatInr(r.average_price_minor) },
          { key: 'taxable_minor', label: 'TAXABLE', width: 65, align: 'right', render: r => formatInr(r.taxable_minor) },
          { key: 'tax_minor', label: 'GST', width: 55, align: 'right', render: r => formatInr(r.tax_minor) },
          { key: 'total_minor', label: 'TOTAL', width: 75, align: 'right', bold: true, render: r => formatInr(r.total_minor) },
          { key: 'contribution_pct', label: 'SHARE', width: 55, align: 'right' },
        ],
        rows,
        totalsRow: {
          description: `TOTAL (${rows.length})`,
          taxable_minor: formatInr(data.taxable_minor),
          tax_minor: formatInr(data.tax_minor),
          total_minor: formatInr(data.total_minor),
          contribution_pct: '100.0%',
        },
      });
      break;
    }

    case 'clients': {
      const rows = data.rows || [];
      drawKpiCards([
        { label: 'Active Clients', value: String(rows.length) },
        { label: 'Total Invoiced', value: formatInr(data.total_invoiced_minor) },
        { label: 'Total Collected', value: formatInr(data.total_collected_minor) },
        { label: 'Current Balance', value: formatInr(data.total_balance_minor) },
        { label: 'Overdue Balance', value: formatInr(data.total_overdue_minor), alert: data.total_overdue_minor > 0 },
      ]);

      drawTable({
        columns: [
          { key: 'client_name', label: 'CLIENT NAME', width: 130, align: 'left', bold: true, render: r => r.client_name || r.name || '—', maxChars: 24 },
          { key: 'company_name', label: 'COMPANY', width: 110, align: 'left', render: r => r.company_name || '—', maxChars: 20 },
          { key: 'gstin', label: 'GSTIN', width: 90, align: 'left', render: r => r.gstin || '—' },
          { key: 'invoice_count', label: 'INVS', width: 50, align: 'right', render: r => String(r.invoice_count || 0) },
          { key: 'first_invoice_date', label: 'FIRST INV', width: 55, align: 'left', render: r => formatDate(r.first_invoice_date) },
          { key: 'last_invoice_date', label: 'LAST INV', width: 55, align: 'left', render: r => formatDate(r.last_invoice_date) },
          { key: 'invoiced_minor', label: 'INVOICED', width: 75, align: 'right', bold: true, render: r => formatInr(r.invoiced_minor) },
          { key: 'collected_minor', label: 'COLLECTED', width: 70, align: 'right', render: r => formatInr(r.collected_minor) },
          { key: 'balance_minor', label: 'BALANCE', width: 70, align: 'right', bold: true, render: r => formatInr(r.balance_minor) },
          { key: 'overdue_minor', label: 'OVERDUE', width: 65, align: 'right', render: r => formatInr(r.overdue_minor) },
        ],
        rows,
        totalsRow: {
          client_name: `TOTAL (${rows.length})`,
          invoiced_minor: formatInr(data.total_invoiced_minor),
          collected_minor: formatInr(data.total_collected_minor),
          balance_minor: formatInr(data.total_balance_minor),
          overdue_minor: formatInr(data.total_overdue_minor),
        },
      });
      break;
    }

    case 'statement': {
      const client = data.client || {};
      const txs = data.transactions || [];

      // Client info box
      currentPage.drawRectangle({
        x: MARGIN,
        y: currentY - 56,
        width: contentWidth,
        height: 56,
        color: C_ZEBRA,
        borderColor: C_BORDER,
        borderWidth: 1,
      });

      currentPage.drawText(`CLIENT: ${client.name || ''}`, {
        x: MARGIN + 10,
        y: currentY - 18,
        size: 9.5,
        font: boldFont,
        color: C_NAVY,
      });

      const subClient = `${client.company_name ? client.company_name + ' | ' : ''}GSTIN: ${client.gstin || 'Unregistered'} | Phone: ${client.phone || '—'}`;
      currentPage.drawText(subClient, {
        x: MARGIN + 10,
        y: currentY - 32,
        size: 8,
        font: regularFont,
        color: C_MUTED,
      });

      currentPage.drawText(`Opening Balance: ${formatInr(data.opening_balance_minor)}    Closing Balance: ${formatInr(data.closing_balance_minor)}`, {
        x: MARGIN + 10,
        y: currentY - 46,
        size: 8.5,
        font: boldFont,
        color: C_DARK,
      });

      currentY -= 68;

      drawTable({
        columns: [
          { key: 'trans_date', label: 'DATE', width: 65, align: 'left', render: r => formatDate(r.trans_date) },
          { key: 'trans_type', label: 'TYPE', width: 60, align: 'left', bold: true },
          { key: 'doc_number', label: 'DOC / RCPT #', width: 75, align: 'left', bold: true },
          { key: 'notes', label: 'NOTES / REF', width: 105, align: 'left', render: r => r.notes || r.method || '—', maxChars: 20 },
          { key: 'debit_minor', label: 'DEBIT (INV)', width: 70, align: 'right', render: r => (r.debit_minor > 0 ? formatInr(r.debit_minor) : '—') },
          { key: 'credit_minor', label: 'CREDIT (PAID)', width: 70, align: 'right', render: r => (r.credit_minor > 0 ? formatInr(r.credit_minor) : '—') },
          { key: 'balance_minor', label: 'BALANCE', width: 78, align: 'right', bold: true, render: r => formatInr(r.balance_minor) },
        ],
        rows: txs,
        totalsRow: {
          doc_number: 'PERIOD TOTALS',
          debit_minor: formatInr(data.total_debits_minor),
          credit_minor: formatInr(data.total_credits_minor),
          balance_minor: formatInr(data.closing_balance_minor),
        },
      });
      break;
    }

    case 'receivables': {
      const rows = data.rows || [];
      const b = data.buckets || {};
      drawKpiCards([
        { label: 'Not Due', value: formatInr(b.NOT_DUE) },
        { label: '1 - 30 Days', value: formatInr(b['1-30']), alert: b['1-30'] > 0 },
        { label: '31 - 60 Days', value: formatInr(b['31-60']), alert: b['31-60'] > 0 },
        { label: '61 - 90 Days', value: formatInr(b['61-90']), alert: b['61-90'] > 0 },
        { label: 'Over 90 Days', value: formatInr(b.OVER_90), alert: b.OVER_90 > 0 },
      ]);

      drawTable({
        columns: [
          { key: 'invoice_number', label: 'INVOICE #', width: 75, align: 'left', bold: true },
          { key: 'client_name', label: 'CLIENT', width: 160, align: 'left', maxChars: 30 },
          { key: 'issue_date', label: 'ISSUED', width: 65, align: 'left', render: r => formatDate(r.issue_date) },
          { key: 'due_date', label: 'DUE DATE', width: 65, align: 'left', render: r => formatDate(r.due_date) },
          { key: 'days_overdue', label: 'OVERDUE', width: 55, align: 'right', render: r => `${r.days_overdue} d` },
          { key: 'ageing', label: 'BUCKET', width: 60, align: 'left' },
          { key: 'grand_total_minor', label: 'TOTAL', width: 95, align: 'right', render: r => formatInr(r.grand_total_minor) },
          { key: 'paid_minor', label: 'PAID', width: 95, align: 'right', render: r => formatInr(r.paid_minor) },
          { key: 'balance_due_minor', label: 'BALANCE DUE', width: 100, align: 'right', bold: true, render: r => formatInr(r.balance_due_minor) },
        ],
        rows,
        totalsRow: {
          invoice_number: 'TOTAL RECEIVABLES',
          balance_due_minor: formatInr(data.total_minor),
        },
      });
      break;
    }

    case 'tax': {
      const net = data.net || {};
      const rows = data.output_rows || [];
      drawKpiCards([
        { label: 'Net Taxable Value', value: formatInr(net.taxable_minor) },
        { label: 'Central GST (CGST)', value: formatInr(net.cgst_minor) },
        { label: 'State GST (SGST)', value: formatInr(net.sgst_minor) },
        { label: 'Integrated GST (IGST)', value: formatInr(net.igst_minor) },
        { label: 'Total Output GST', value: formatInr(net.tax_minor) },
      ]);

      drawTable({
        columns: [
          { key: 'hsn_sac', label: 'HSN / SAC', width: 120, align: 'left', bold: true, render: r => r.hsn_sac || '—' },
          { key: 'tax_rate_bp', label: 'RATE %', width: 70, align: 'right', render: r => `${((Number(r.tax_rate_bp || 0) / 100)).toFixed(2)}%` },
          { key: 'taxable_minor', label: 'TAXABLE VALUE', width: 120, align: 'right', render: r => formatInr(r.taxable_minor) },
          { key: 'cgst_minor', label: 'CGST', width: 110, align: 'right', render: r => formatInr(r.cgst_minor) },
          { key: 'sgst_minor', label: 'SGST', width: 110, align: 'right', render: r => formatInr(r.sgst_minor) },
          { key: 'igst_minor', label: 'IGST', width: 110, align: 'right', render: r => formatInr(r.igst_minor) },
          { key: 'tax_minor', label: 'TOTAL GST', width: 130, align: 'right', bold: true, render: r => formatInr(r.tax_minor) },
        ],
        rows,
        totalsRow: {
          hsn_sac: 'NET TOTAL',
          taxable_minor: formatInr(net.taxable_minor),
          cgst_minor: formatInr(net.cgst_minor),
          sgst_minor: formatInr(net.sgst_minor),
          igst_minor: formatInr(net.igst_minor),
          tax_minor: formatInr(net.tax_minor),
        },
      });
      break;
    }

    case 'quotations': {
      const rows = data.rows || [];
      drawKpiCards([
        { label: 'Total Quotations', value: String(rows.length) },
        { label: 'Accepted', value: String(data.accepted || 0) },
        { label: 'Rejected', value: String(data.rejected || 0) },
        { label: 'Converted to Invoices', value: String(data.converted || 0) },
        { label: 'Acceptance Rate', value: `${((data.conversion_rate_bp || 0) / 100).toFixed(1)}%` },
      ]);

      drawTable({
        columns: [
          { key: 'quotation_number', label: 'QUOTE #', width: 85, align: 'left', bold: true },
          { key: 'client_name', label: 'CLIENT', width: 180, align: 'left', maxChars: 30 },
          { key: 'title', label: 'TITLE', width: 190, align: 'left', maxChars: 32 },
          { key: 'issue_date', label: 'ISSUED', width: 75, align: 'left', render: r => formatDate(r.issue_date) },
          { key: 'effective_status', label: 'STATUS', width: 75, align: 'left' },
          { key: 'converted', label: 'CONVERTED', width: 65, align: 'center', render: r => (r.converted ? 'YES' : 'NO') },
          { key: 'grand_total_minor', label: 'QUOTED VALUE', width: 100, align: 'right', bold: true, render: r => formatInr(r.grand_total_minor) },
        ],
        rows,
        totalsRow: {
          quotation_number: 'DECIDED ACCEPTED VALUE',
          grand_total_minor: formatInr(data.decided_value_minor),
        },
      });
      break;
    }

    case 'influencers': {
      const rows = data.rows || [];
      const tot = data.totals || {};
      drawKpiCards([
        { label: 'Active Partners', value: String(rows.length), hint: 'Marketing agreements' },
        { label: 'Attributed Sales', value: formatInr(tot.attributed_sales_minor), hint: 'Total gross sales' },
        { label: 'Commission Earned', value: formatInr(tot.commission_earned_minor) },
        { label: 'Commission Paid', value: formatInr(tot.commission_paid_minor) },
        { label: 'Commission Payable', value: formatInr(tot.commission_payable_minor), alert: tot.commission_payable_minor > 0 },
      ]);

      drawTable({
        columns: [
          { key: 'legal_name', label: 'PARTNER NAME', width: 130, align: 'left', bold: true, render: r => r.display_name || r.legal_name || '—', maxChars: 22 },
          { key: 'handle', label: 'HANDLE / CODE', width: 75, align: 'left', render: r => r.handle || '—' },
          { key: 'contract_number', label: 'CONTRACT #', width: 85, align: 'left', render: r => r.contract_number || '—' },
          { key: 'commission_rate_bp', label: 'RATE %', width: 45, align: 'right', render: r => `${((Number(r.commission_rate_bp || 0) / 100)).toFixed(1)}%` },
          { key: 'sales_count', label: 'ORDERS', width: 45, align: 'right', render: r => String(r.sales_count || 0) },
          { key: 'attributed_sales_minor', label: 'GROSS SALES', width: 85, align: 'right', bold: true, render: r => formatInr(r.attributed_sales_minor) },
          { key: 'eligible_revenue_minor', label: 'ELIGIBLE REV', width: 85, align: 'right', render: r => formatInr(r.eligible_revenue_minor) },
          { key: 'commission_earned_minor', label: 'COMM EARNED', width: 75, align: 'right', render: r => formatInr(r.commission_earned_minor) },
          { key: 'commission_paid_minor', label: 'PAID', width: 70, align: 'right', render: r => formatInr(r.commission_paid_minor) },
          { key: 'commission_payable_minor', label: 'PAYABLE', width: 75, align: 'right', bold: true, render: r => formatInr(r.commission_payable_minor) },
        ],
        rows,
        totalsRow: {
          legal_name: `TOTAL (${rows.length})`,
          sales_count: String(tot.sales_count || 0),
          attributed_sales_minor: formatInr(tot.attributed_sales_minor),
          eligible_revenue_minor: formatInr(tot.eligible_revenue_minor),
          commission_earned_minor: formatInr(tot.commission_earned_minor),
          commission_paid_minor: formatInr(tot.commission_paid_minor),
          commission_payable_minor: formatInr(tot.commission_payable_minor),
        },
      });
      break;
    }

    case 'influencer_sales': {
      const rows = data.rows || [];
      const tot = data.totals || {};
      drawKpiCards([
        { label: 'Attributed Orders', value: String(rows.length), hint: 'Recorded sales' },
        { label: 'Gross Sales Value', value: formatInr(tot.sale_amount_minor) },
        { label: 'Eligible Revenue', value: formatInr(tot.eligible_revenue_minor) },
        { label: 'Total Commission', value: formatInr(tot.commission_minor) },
      ]);

      drawTable({
        columns: [
          { key: 'sale_date', label: 'DATE', width: 60, align: 'left', render: r => formatDate(r.sale_date) },
          { key: 'customer_name', label: 'CUSTOMER', width: 110, align: 'left', render: r => r.customer_name || 'POS Customer', maxChars: 18 },
          { key: 'product_name', label: 'PRODUCT', width: 120, align: 'left', render: r => r.product_name || 'Item', maxChars: 20 },
          { key: 'influencer_name', label: 'PARTNER', width: 105, align: 'left', bold: true, render: r => r.influencer_name || '—', maxChars: 18 },
          { key: 'sale_amount_minor', label: 'SALE AMT', width: 75, align: 'right', bold: true, render: r => formatInr(r.sale_amount_minor) },
          { key: 'eligible_revenue_minor', label: 'ELIGIBLE', width: 75, align: 'right', render: r => formatInr(r.eligible_revenue_minor) },
          { key: 'commission_rate_bp', label: 'RATE %', width: 45, align: 'right', render: r => `${((Number(r.commission_rate_bp || 0) / 100)).toFixed(1)}%` },
          { key: 'commission_minor', label: 'COMMISSION', width: 75, align: 'right', bold: true, render: r => formatInr(r.commission_minor) },
          { key: 'payment_status', label: 'STATUS', width: 60, align: 'center', render: r => r.payment_status || 'PENDING' },
        ],
        rows,
        totalsRow: {
          sale_date: `TOTAL (${rows.length})`,
          sale_amount_minor: formatInr(tot.sale_amount_minor),
          eligible_revenue_minor: formatInr(tot.eligible_revenue_minor),
          commission_minor: formatInr(tot.commission_minor),
        },
      });
      break;
    }

    case 'imports': {
      const rows = data.rows || [];
      const tot = data.totals || {};
      drawKpiCards([
        { label: 'Total Batches', value: String(rows.length), hint: 'Excel imports' },
        { label: 'Valid Records', value: String(tot.valid_count || 0) },
        { label: 'Attributed Sales', value: formatInr(tot.total_sales_minor) },
        { label: 'Total Commission', value: formatInr(tot.total_commission_minor) },
      ]);

      drawTable({
        columns: [
          { key: 'id', label: 'BATCH ID', width: 55, align: 'left', bold: true },
          { key: 'imported_at', label: 'IMPORTED AT', width: 85, align: 'left', render: r => formatDate(r.imported_at) },
          { key: 'filename', label: 'SOURCE FILE', width: 200, align: 'left', render: r => r.filename || '—', maxChars: 34 },
          { key: 'row_count', label: 'ROWS', width: 50, align: 'right', render: r => String(r.row_count || 0) },
          { key: 'valid_count', label: 'VALID', width: 50, align: 'right', render: r => String(r.valid_count || 0) },
          { key: 'total_sales_minor', label: 'TOTAL SALES', width: 100, align: 'right', bold: true, render: r => formatInr(r.total_sales_minor) },
          { key: 'total_commission_minor', label: 'COMMISSION', width: 90, align: 'right', bold: true, render: r => formatInr(r.total_commission_minor) },
          { key: 'status', label: 'STATUS', width: 70, align: 'center', render: r => r.status || 'COMPLETED' },
        ],
        rows,
        totalsRow: {
          id: `TOTAL (${rows.length})`,
          row_count: String(tot.row_count || 0),
          valid_count: String(tot.valid_count || 0),
          total_sales_minor: formatInr(tot.total_sales_minor),
          total_commission_minor: formatInr(tot.total_commission_minor),
        },
      });
      break;
    }
  }

  // Draw Page Numbering and Footers across ALL pages (Second Pass)
  const totalPages = pages.length;
  for (let i = 0; i < totalPages; i++) {
    const page = pages[i];

    // Top subtle rule
    page.drawLine({
      start: { x: MARGIN, y: MARGIN + FOOTER_HEIGHT },
      end: { x: pageSize.width - MARGIN, y: MARGIN + FOOTER_HEIGHT },
      thickness: 0.5,
      color: C_BORDER,
    });

    // Left footer
    page.drawText('Nextora Creations — Internal Business Report', {
      x: MARGIN,
      y: MARGIN + 10,
      size: 7.5,
      font: regularFont,
      color: C_MUTED,
    });

    // Center footer
    const centerText = `Generated on ${generatedAt}`;
    const centerWidth = regularFont.widthOfTextAtSize(centerText, 7.5);
    page.drawText(centerText, {
      x: (pageSize.width - centerWidth) / 2,
      y: MARGIN + 10,
      size: 7.5,
      font: regularFont,
      color: C_MUTED,
    });

    // Right footer
    const pageNumText = `Page ${i + 1} of ${totalPages}`;
    const pageNumWidth = boldFont.widthOfTextAtSize(pageNumText, 7.5);
    page.drawText(pageNumText, {
      x: pageSize.width - MARGIN - pageNumWidth,
      y: MARGIN + 10,
      size: 7.5,
      font: boldFont,
      color: C_NAVY,
    });
  }

  return await pdfDoc.save();
}
