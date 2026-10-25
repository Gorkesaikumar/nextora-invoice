import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFontBytes } from './pdf.js';
import { formatDate, formatMinor } from './words.js';

const PAGE_WIDTH = 841.89; // Landscape A4
const PAGE_HEIGHT = 595.28;
const MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // 769.89
const FOOTER_HEIGHT = 32;

const INK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.85, 0.86, 0.88);
const SOFT_BG = rgb(0.965, 0.97, 0.975);
const HEADER_BG = rgb(0.12, 0.14, 0.18);
const TABLE_HEADER_BG = rgb(0.92, 0.93, 0.95);
const ROW_ALT_BG = rgb(0.98, 0.985, 0.99);

function wrapText(font, text, size, maxWidth) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      let chunk = '';
      for (const char of word) {
        if (font.widthOfTextAtSize(chunk + char, size) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

async function embedImage(doc, asset) {
  if (!asset?.bytes) return null;
  try {
    if (asset.mimeType === 'image/jpeg') return await doc.embedJpg(asset.bytes);
    return await doc.embedPng(asset.bytes);
  } catch {
    try {
      return await doc.embedPng(asset.bytes);
    } catch {
      try {
        return await doc.embedJpg(asset.bytes);
      } catch {
        return null;
      }
    }
  }
}

/* ---------------------------------------------------- Individual Influencer Report */

export async function renderInfluencerSalesReportPdf(report, { companyLogo = null, productLogo = null } = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const [regularBytes, boldBytes] = await Promise.all([
    readFontBytes('NotoSans-Regular.ttf'),
    readFontBytes('NotoSans-Bold.ttf'),
  ]);
  const font = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });

  const compImg = await embedImage(doc, companyLogo);
  const prodImg = await embedImage(doc, productLogo);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const drawHeader = (isFirstPage = false) => {
    // Top banner
    if (isFirstPage) {
      // Company Logo left
      if (compImg) {
        const h = 28;
        const w = (compImg.width / compImg.height) * h;
        page.drawImage(compImg, { x: MARGIN, y: y - h, width: Math.min(130, w), height: h });
      } else {
        page.drawText('NEXTORA CREATIONS', { x: MARGIN, y: y - 18, size: 12, font: bold, color: INK });
      }

      // Product Logo right
      if (prodImg) {
        const h = 28;
        const w = (prodImg.width / prodImg.height) * h;
        page.drawImage(prodImg, { x: PAGE_WIDTH - MARGIN - Math.min(130, w), y: y - h, width: Math.min(130, w), height: h });
      } else {
        page.drawText('NEXTORA POS', { x: PAGE_WIDTH - MARGIN - 90, y: y - 18, size: 11, font: bold, color: INK });
      }

      // Title center
      const title = 'INFLUENCER SALES & REVENUE-SHARING REPORT';
      const titleW = bold.widthOfTextAtSize(title, 13);
      page.drawText(title, { x: (PAGE_WIDTH - titleW) / 2, y: y - 16, size: 13, font: bold, color: INK });

      y -= 38;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: LINE });
      y -= 12;

      // Metadata Bar
      page.drawRectangle({ x: MARGIN, y: y - 36, width: CONTENT_WIDTH, height: 36, color: SOFT_BG, borderColor: LINE, borderWidth: 0.5 });
      const colW = CONTENT_WIDTH / 4;

      // Col 1: Influencer Info
      page.drawText('INFLUENCER PARTNER', { x: MARGIN + 8, y: y - 12, size: 7, font: bold, color: MUTED });
      const infName = `${report.influencer.display_name} (${report.influencer.instagram_username || '-'})`;
      page.drawText(infName.slice(0, 38), { x: MARGIN + 8, y: y - 26, size: 8.5, font: bold, color: INK });

      // Col 2: Agreement Info
      page.drawText('AGREEMENT & RATE', { x: MARGIN + colW + 8, y: y - 12, size: 7, font: bold, color: MUTED });
      const rateText = report.agreement?.commission_basis_points
        ? `${(report.agreement.commission_basis_points / 100).toFixed(2)}% (${report.agreement.contract_number || 'ACTIVE'})`
        : 'Standard 10.00% (Draft)';
      page.drawText(rateText, { x: MARGIN + colW + 8, y: y - 26, size: 8.5, font, color: INK });

      // Col 3: Report Period
      page.drawText('REPORTING PERIOD', { x: MARGIN + colW * 2 + 8, y: y - 12, size: 7, font: bold, color: MUTED });
      page.drawText(report.period_label || 'All Transactions', { x: MARGIN + colW * 2 + 8, y: y - 26, size: 8.5, font, color: INK });

      // Col 4: Report Number & Date
      page.drawText('REPORT DETAILS', { x: MARGIN + colW * 3 + 8, y: y - 12, size: 7, font: bold, color: MUTED });
      page.drawText(`Ref: ${report.report_number || 'REP-INF'} | Date: ${formatDate(new Date())}`, { x: MARGIN + colW * 3 + 8, y: y - 26, size: 8, font, color: INK });

      y -= 46;
    } else {
      // Running compact header
      page.drawText(`Influencer Sales Report — ${report.influencer.display_name}`, { x: MARGIN, y: y - 12, size: 8, font: bold, color: MUTED });
      page.drawText(`Generated: ${formatDate(new Date())}`, { x: PAGE_WIDTH - MARGIN - 120, y: y - 12, size: 8, font, color: MUTED });
      y -= 18;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: LINE });
      y -= 12;
    }
  };

  drawHeader(true);

  // Section 1: Executive KPI Cards
  const kpiW = CONTENT_WIDTH / 6;
  const kpiH = 38;
  page.drawText('SECTION 1 — EXECUTIVE SUMMARY', { x: MARGIN, y: y - 2, size: 8, font: bold, color: MUTED });
  y -= 12;

  const kpis = [
    { label: 'ATTRIBUTED SALES', val: `${report.summary.total_sales || 0} Orders` },
    { label: 'VERIFIED REVENUE', val: report.summary.verified_revenue_minor ? formatMinor(report.summary.verified_revenue_minor) : 'Awaiting Verif.' },
    { label: 'COMMISSION RATE', val: report.agreement?.commission_basis_points ? `${(report.agreement.commission_basis_points / 100).toFixed(2)}%` : '10.00%' },
    { label: 'CALCULATED COMMISSION', val: report.summary.calculated_commission_minor ? formatMinor(report.summary.calculated_commission_minor) : 'Awaiting Verif.' },
    { label: 'PENDING PAYOUT', val: formatMinor(report.summary.pending_commission_minor || 0) },
    { label: 'PAID TO DATE', val: formatMinor(report.summary.paid_commission_minor || 0) },
  ];

  kpis.forEach((kpi, idx) => {
    const kx = MARGIN + idx * kpiW;
    page.drawRectangle({ x: kx, y: y - kpiH, width: kpiW - 4, height: kpiH, color: SOFT_BG, borderColor: LINE, borderWidth: 0.5 });
    page.drawText(kpi.label, { x: kx + 6, y: y - 12, size: 6.5, font: bold, color: MUTED });
    page.drawText(kpi.val, { x: kx + 6, y: y - 28, size: 8.5, font: bold, color: INK });
  });

  y -= (kpiH + 18);

  // Section 2: Detailed Customer Sales Table
  page.drawText('SECTION 2 — CUSTOMER SALES DETAILS', { x: MARGIN, y: y - 2, size: 8, font: bold, color: MUTED });
  y -= 10;

  const tableCols = [
    { key: 's_no', label: 'S.No.', width: 30, align: 'center' },
    { key: 'customer_name', label: 'Customer Name', width: 95, align: 'left' },
    { key: 'business_name', label: 'Business Name', width: 105, align: 'left' },
    { key: 'purchased_date', label: 'Purchased', width: 65, align: 'center' },
    { key: 'product_name', label: 'Product Name', width: 95, align: 'left' },
    { key: 'expiry_date', label: 'Expiry Date', width: 65, align: 'center' },
    { key: 'customer_location', label: 'Location', width: 85, align: 'left' },
    { key: 'influencer_name', label: 'Influencer', width: 80, align: 'left' },
    { key: 'eligible_revenue', label: 'Eligible Rev (₹)', width: 75, align: 'right' },
    { key: 'commission', label: 'Commission (₹)', width: 74, align: 'right' },
  ];

  const drawTableHeader = () => {
    const thH = 20;
    page.drawRectangle({ x: MARGIN, y: y - thH, width: CONTENT_WIDTH, height: thH, color: TABLE_HEADER_BG, borderColor: LINE, borderWidth: 0.5 });
    let cx = MARGIN;
    tableCols.forEach(col => {
      let tx = cx + 4;
      if (col.align === 'right') {
        const w = bold.widthOfTextAtSize(col.label, 7);
        tx = cx + col.width - w - 4;
      } else if (col.align === 'center') {
        const w = bold.widthOfTextAtSize(col.label, 7);
        tx = cx + (col.width - w) / 2;
      }
      page.drawText(col.label, { x: tx, y: y - 13, size: 7, font: bold, color: INK });
      cx += col.width;
    });
    y -= thH;
  };

  drawTableHeader();

  // Table rows
  const records = report.records || [];
  if (records.length === 0) {
    page.drawRectangle({ x: MARGIN, y: y - 28, width: CONTENT_WIDTH, height: 28, color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 0.5 });
    page.drawText('No sales records found for this influencer in the selected period.', {
      x: MARGIN + 20, y: y - 18, size: 8, font, color: MUTED
    });
    y -= 38;
  } else {
    records.forEach((rec, idx) => {
      const rowH = 18;
      // Check page overflow
      if (y - rowH < MARGIN + FOOTER_HEIGHT + 60) {
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
        drawHeader(false);
        drawTableHeader();
      }

      const bg = idx % 2 === 1 ? ROW_ALT_BG : rgb(1, 1, 1);
      page.drawRectangle({ x: MARGIN, y: y - rowH, width: CONTENT_WIDTH, height: rowH, color: bg, borderColor: LINE, borderWidth: 0.3 });

      const isVerified = rec.is_revenue_verified && rec.eligible_revenue_minor !== null;
      const revText = isVerified ? (rec.eligible_revenue_minor / 100).toFixed(2) : 'Awaiting';
      const commText = isVerified ? (rec.calculated_commission_minor / 100).toFixed(2) : 'Awaiting';
      const expText = rec.is_lifetime ? 'Lifetime' : (rec.expiry_date ? formatDate(rec.expiry_date) : '-');

      const values = {
        s_no: String(idx + 1),
        customer_name: (rec.customer_name || '-').slice(0, 18),
        business_name: (rec.business_name || '-').slice(0, 20),
        purchased_date: formatDate(rec.purchased_date),
        product_name: (rec.product_name || 'Nextora POS').slice(0, 18),
        expiry_date: expText,
        customer_location: (rec.customer_location || '-').slice(0, 16),
        influencer_name: (rec.influencer_display_name || report.influencer.display_name).slice(0, 15),
        eligible_revenue: revText,
        commission: commText,
      };

      let cx = MARGIN;
      tableCols.forEach(col => {
        const val = values[col.key] || '';
        let tx = cx + 4;
        if (col.align === 'right') {
          const w = font.widthOfTextAtSize(val, 7);
          tx = cx + col.width - w - 4;
        } else if (col.align === 'center') {
          const w = font.widthOfTextAtSize(val, 7);
          tx = cx + (col.width - w) / 2;
        }
        page.drawText(val, { x: tx, y: y - 12, size: 7, font, color: INK });
        cx += col.width;
      });

      y -= rowH;
    });
  }

  y -= 14;

  // Check overflow before Section 3 & 4
  if (y < MARGIN + FOOTER_HEIGHT + 70) {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    drawHeader(false);
  }

  // Section 3: Financial Calculation & Reconciliation Terms
  page.drawText('SECTION 3 — REVENUE CALCULATION BASIS & GST TREATMENT', { x: MARGIN, y: y - 2, size: 8, font: bold, color: MUTED });
  y -= 12;

  const basisDesc = report.agreement?.commission_basis === 'NET_SALES_EX_GST'
    ? 'Net Eligible Product Sales Revenue excluding GST. GST collected on behalf of tax authorities does not constitute commissionable turnover.'
    : report.agreement?.commission_basis === 'COLLECTED_NET_REFUNDS'
    ? 'Net Collected Revenue after subtracting approved customer refunds, cancellations, and product returns.'
    : 'Gross Collections or administrator-approved custom contractual basis.';

  const taxModeDesc = report.agreement?.product_tax_mode === 'INCLUSIVE'
    ? 'Product pricing is GST-inclusive; eligible revenue is calculated by reverse-extracting the statutory GST percentage prior to commission computation.'
    : 'Product pricing is GST-exclusive; commission applies directly to net sales value.';

  const termsText = [
    `• Commission Basis: ${basisDesc}`,
    `• GST Treatment: ${taxModeDesc}`,
    `• Attribution & Adjustments: Chargebacks, unpaid invoices, or refunded sales automatically reverse accrued commissions in the subsequent reconciliation cycle.`,
    `• Statutory Withholding: Remittances are subject to statutory Tax Deduction at Source (TDS) under prevailing Indian Income Tax provisions (Sec 194H/194J).`
  ].join('\n');

  for (const line of wrapText(font, termsText, 7, CONTENT_WIDTH)) {
    page.drawText(line, { x: MARGIN + 4, y: y - 9, size: 7, font, color: INK });
    y -= 10;
  }

  y -= 8;

  // Section 4: Data Source & Audit Notes
  page.drawText('SECTION 4 — AUDIT & DATA DISCLOSURES', { x: MARGIN, y: y - 2, size: 8, font: bold, color: MUTED });
  y -= 12;

  const auditText = `This report is generated from verified customer import batches and authenticated sales attribution records. Unverified rows indicate transactions awaiting independent invoice/order reconciliation. No payments are authorized solely on the generation of this document.`;
  for (const line of wrapText(font, auditText, 7, CONTENT_WIDTH)) {
    page.drawText(line, { x: MARGIN + 4, y: y - 9, size: 7, font: font, color: MUTED });
    y -= 10;
  }

  // Running Footers across all pages
  const totalPages = doc.getPageCount();
  doc.getPages().forEach((p, index) => {
    const fy = MARGIN + 12;
    p.drawLine({ start: { x: MARGIN, y: fy + 14 }, end: { x: PAGE_WIDTH - MARGIN, y: fy + 14 }, thickness: 0.5, color: LINE });

    const leftNote = 'Confidential — Nextora Creations & Authorized Marketing Partners';
    p.drawText(leftNote, { x: MARGIN, y: fy, size: 7, font, color: MUTED });

    const centerText = `Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`;
    const cw = font.widthOfTextAtSize(centerText, 7);
    p.drawText(centerText, { x: (PAGE_WIDTH - cw) / 2, y: fy, size: 7, font, color: MUTED });

    const pageStr = `Page ${index + 1} of ${totalPages}`;
    const pw = font.widthOfTextAtSize(pageStr, 7);
    p.drawText(pageStr, { x: PAGE_WIDTH - MARGIN - pw, y: fy, size: 7, font: bold, color: INK });
  });

  return Buffer.from(await doc.save());
}

/* ---------------------------------------------------- Consolidated All-Influencer Report */

export async function renderConsolidatedSalesReportPdf(report, { companyLogo = null, productLogo = null } = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const [regularBytes, boldBytes] = await Promise.all([
    readFontBytes('NotoSans-Regular.ttf'),
    readFontBytes('NotoSans-Bold.ttf'),
  ]);
  const font = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });

  const compImg = await embedImage(doc, companyLogo);
  const prodImg = await embedImage(doc, productLogo);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const drawHeader = (isFirstPage = false) => {
    if (isFirstPage) {
      if (compImg) {
        const h = 28;
        const w = (compImg.width / compImg.height) * h;
        page.drawImage(compImg, { x: MARGIN, y: y - h, width: Math.min(130, w), height: h });
      } else {
        page.drawText('NEXTORA CREATIONS', { x: MARGIN, y: y - 18, size: 12, font: bold, color: INK });
      }

      if (prodImg) {
        const h = 28;
        const w = (prodImg.width / prodImg.height) * h;
        page.drawImage(prodImg, { x: PAGE_WIDTH - MARGIN - Math.min(130, w), y: y - h, width: Math.min(130, w), height: h });
      } else {
        page.drawText('NEXTORA POS', { x: PAGE_WIDTH - MARGIN - 90, y: y - 18, size: 11, font: bold, color: INK });
      }

      const title = 'CONSOLIDATED INFLUENCER SALES & COMMISSION REPORT';
      const titleW = bold.widthOfTextAtSize(title, 13);
      page.drawText(title, { x: (PAGE_WIDTH - titleW) / 2, y: y - 16, size: 13, font: bold, color: INK });

      y -= 38;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: LINE });
      y -= 14;
    } else {
      page.drawText('Consolidated Influencer Sales Report — Nextora Creations', { x: MARGIN, y: y - 12, size: 8, font: bold, color: MUTED });
      page.drawText(`Generated: ${formatDate(new Date())}`, { x: PAGE_WIDTH - MARGIN - 120, y: y - 12, size: 8, font, color: MUTED });
      y -= 18;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: LINE });
      y -= 12;
    }
  };

  drawHeader(true);

  // Section 1: Consolidated KPI Cards
  const kpiW = CONTENT_WIDTH / 6;
  const kpiH = 38;
  page.drawText('SECTION 1 — EXECUTIVE SUMMARY', { x: MARGIN, y: y - 2, size: 8, font: bold, color: MUTED });
  y -= 12;

  const kpis = [
    { label: 'TOTAL INFLUENCERS', val: `${report.kpis.total_influencers_with_sales || 0} Partners` },
    { label: 'TOTAL ORDERS', val: `${report.kpis.total_valid_sales || 0} Sales` },
    { label: 'VERIFIED REVENUE', val: formatMinor(report.kpis.total_verified_revenue_minor || 0) },
    { label: 'TOTAL COMMISSION', val: formatMinor(report.kpis.total_calculated_commission_minor || 0) },
    { label: 'PENDING COMMISSION', val: formatMinor(report.kpis.pending_commission_minor || 0) },
    { label: 'SETTLED COMMISSION', val: formatMinor(report.kpis.paid_commission_minor || 0) },
  ];

  kpis.forEach((kpi, idx) => {
    const kx = MARGIN + idx * kpiW;
    page.drawRectangle({ x: kx, y: y - kpiH, width: kpiW - 4, height: kpiH, color: SOFT_BG, borderColor: LINE, borderWidth: 0.5 });
    page.drawText(kpi.label, { x: kx + 6, y: y - 12, size: 6.5, font: bold, color: MUTED });
    page.drawText(kpi.val, { x: kx + 6, y: y - 28, size: 8.5, font: bold, color: INK });
  });

  y -= (kpiH + 18);

  // Section 2: Influencer Summary Breakdown Table
  page.drawText('SECTION 2 — INFLUENCER PERFORMANCE & COMMISSION SUMMARY', { x: MARGIN, y: y - 2, size: 8, font: bold, color: MUTED });
  y -= 10;

  const summaryCols = [
    { label: 'Influencer Name', width: 140, align: 'left' },
    { label: 'Instagram Handle', width: 100, align: 'left' },
    { label: 'Agreement / Ref', width: 90, align: 'left' },
    { label: 'Total Orders', width: 65, align: 'center' },
    { label: 'Verified Rev (₹)', width: 95, align: 'right' },
    { label: 'Comm Rate', width: 65, align: 'center' },
    { label: 'Calculated Comm (₹)', width: 110, align: 'right' },
    { label: 'Pending (₹)', width: 55, align: 'right' },
    { label: 'Paid (₹)', width: 49, align: 'right' },
  ];

  const drawSummaryTableHeader = () => {
    const thH = 20;
    page.drawRectangle({ x: MARGIN, y: y - thH, width: CONTENT_WIDTH, height: thH, color: TABLE_HEADER_BG, borderColor: LINE, borderWidth: 0.5 });
    let cx = MARGIN;
    summaryCols.forEach(col => {
      let tx = cx + 4;
      if (col.align === 'right') {
        const w = bold.widthOfTextAtSize(col.label, 7);
        tx = cx + col.width - w - 4;
      } else if (col.align === 'center') {
        const w = bold.widthOfTextAtSize(col.label, 7);
        tx = cx + (col.width - w) / 2;
      }
      page.drawText(col.label, { x: tx, y: y - 13, size: 7, font: bold, color: INK });
      cx += col.width;
    });
    y -= thH;
  };

  drawSummaryTableHeader();

  const influencers = report.influencers || [];
  if (influencers.length === 0) {
    page.drawRectangle({ x: MARGIN, y: y - 28, width: CONTENT_WIDTH, height: 28, color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 0.5 });
    page.drawText('No influencer sales records available to summarize.', { x: MARGIN + 20, y: y - 18, size: 8, font, color: MUTED });
    y -= 38;
  } else {
    influencers.forEach((inf, idx) => {
      const rowH = 18;
      if (y - rowH < MARGIN + FOOTER_HEIGHT + 60) {
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
        drawHeader(false);
        drawSummaryTableHeader();
      }

      const bg = idx % 2 === 1 ? ROW_ALT_BG : rgb(1, 1, 1);
      page.drawRectangle({ x: MARGIN, y: y - rowH, width: CONTENT_WIDTH, height: rowH, color: bg, borderColor: LINE, borderWidth: 0.3 });

      const rateStr = inf.commission_basis_points ? `${(inf.commission_basis_points / 100).toFixed(1)}%` : '10.0%';
      const values = [
        (inf.display_name || inf.legal_name || '-').slice(0, 24),
        (inf.instagram_username || '-').slice(0, 18),
        (inf.contract_number || 'ACTIVE').slice(0, 14),
        String(inf.total_sales || 0),
        (inf.verified_revenue_minor / 100).toFixed(2),
        rateStr,
        (inf.calculated_commission_minor / 100).toFixed(2),
        (inf.pending_commission_minor / 100).toFixed(2),
        (inf.paid_commission_minor / 100).toFixed(2),
      ];

      let cx = MARGIN;
      summaryCols.forEach((col, cIdx) => {
        const val = values[cIdx];
        let tx = cx + 4;
        if (col.align === 'right') {
          const w = font.widthOfTextAtSize(val, 7);
          tx = cx + col.width - w - 4;
        } else if (col.align === 'center') {
          const w = font.widthOfTextAtSize(val, 7);
          tx = cx + (col.width - w) / 2;
        }
        page.drawText(val, { x: tx, y: y - 12, size: 7, font, color: INK });
        cx += col.width;
      });

      y -= rowH;
    });
  }

  y -= 14;

  // Notes & Footer
  if (y < MARGIN + FOOTER_HEIGHT + 60) {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    drawHeader(false);
  }

  page.drawText('SECTION 3 — RECONCILIATION & GOVERNANCE NOTES', { x: MARGIN, y: y - 2, size: 8, font: bold, color: MUTED });
  y -= 12;

  const notesText = [
    '• Revenue-sharing figures are subject to final reconciliation against bank transaction settlements and approved refund adjustments.',
    '• Figures marked unverified or awaiting verification are excluded from payable balances until independently validated.',
    '• All payouts require valid tax invoices and adherence to statutory TDS withholding guidelines under Indian Income Tax Act regulations.'
  ].join('\n');

  for (const line of wrapText(font, notesText, 7, CONTENT_WIDTH)) {
    page.drawText(line, { x: MARGIN + 4, y: y - 9, size: 7, font, color: INK });
    y -= 10;
  }

  // Running Footers across all pages
  const totalPages = doc.getPageCount();
  doc.getPages().forEach((p, index) => {
    const fy = MARGIN + 12;
    p.drawLine({ start: { x: MARGIN, y: fy + 14 }, end: { x: PAGE_WIDTH - MARGIN, y: fy + 14 }, thickness: 0.5, color: LINE });

    const leftNote = 'Confidential — Nextora Creations Management & Finance';
    p.drawText(leftNote, { x: MARGIN, y: fy, size: 7, font, color: MUTED });

    const centerText = `Consolidated Report • Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`;
    const cw = font.widthOfTextAtSize(centerText, 7);
    p.drawText(centerText, { x: (PAGE_WIDTH - cw) / 2, y: fy, size: 7, font, color: MUTED });

    const pageStr = `Page ${index + 1} of ${totalPages}`;
    const pw = font.widthOfTextAtSize(pageStr, 7);
    p.drawText(pageStr, { x: PAGE_WIDTH - MARGIN - pw, y: fy, size: 7, font: bold, color: INK });
  });

  return Buffer.from(await doc.save());
}
