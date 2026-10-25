import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFontBytes } from './pdf.js';
import { formatDate, formatMinor } from './words.js';

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT_WIDTH = A4.width - MARGIN * 2; // 515.28
const FOOTER_HEIGHT = 35;
const INK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.88, 0.89, 0.91);
const SOFT_BG = rgb(0.965, 0.97, 0.975);
const TABLE_HEADER_BG = rgb(0.93, 0.94, 0.95);

function hexToRgb(hex) {
  const value = /^#[0-9A-Fa-f]{6}$/.test(hex || '') ? hex : '#00AEEF';
  return rgb(
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255
  );
}

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
      for (const character of word) {
        if (font.widthOfTextAtSize(chunk + character, size) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = character;
        } else {
          chunk += character;
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
    if (asset.mimeType === 'image/jpeg') {
      return await doc.embedJpg(asset.bytes);
    }
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

export async function renderContractPdf(snapshot, { companyLogo = null, productLogo = null } = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const [regularBytes, boldBytes] = await Promise.all([
    readFontBytes('NotoSans-Regular.ttf'),
    readFontBytes('NotoSans-Bold.ttf'),
  ]);
  const font = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });

  const companyLogoImg = await embedImage(doc, companyLogo);
  const productLogoImg = await embedImage(doc, productLogo);

  const accent = hexToRgb(snapshot.business?.pdf_accent_color);
  const pages = [];
  let page;
  let y;

  function addPage() {
    page = doc.addPage([A4.width, A4.height]);
    pages.push(page);
    // Subtle top border stripe
    page.drawRectangle({ x: 0, y: A4.height - 4, width: A4.width, height: 4, color: accent });
    y = A4.height - MARGIN - 10;
    return page;
  }

  function ensureSpace(neededHeight) {
    if (y - neededHeight < MARGIN + FOOTER_HEIGHT) {
      addPage();
      drawRunningHeader();
    }
  }

  function drawRunningHeader() {
    page.drawText('INFLUENCER MARKETING & REVENUE-SHARING AGREEMENT', {
      x: MARGIN, y: A4.height - 24, size: 7.5, font: bold, color: MUTED,
    });
    const contractNoText = `Contract: ${snapshot.contract_number}`;
    const noWidth = font.widthOfTextAtSize(contractNoText, 7.5);
    page.drawText(contractNoText, {
      x: A4.width - MARGIN - noWidth, y: A4.height - 24, size: 7.5, font, color: MUTED,
    });
    page.drawLine({
      start: { x: MARGIN, y: A4.height - 28 },
      end: { x: A4.width - MARGIN, y: A4.height - 28 },
      thickness: 0.5,
      color: LINE,
    });
    y = A4.height - 42;
  }

  function drawText(value, x, top, size = 9, useBold = false, color = INK, max = CONTENT_WIDTH) {
    const content = String(value ?? '');
    if (!content.trim()) return top;
    const activeFont = useBold ? bold : font;
    for (const line of wrapText(activeFont, content, size, max)) {
      if (top - size < MARGIN + FOOTER_HEIGHT) {
        addPage();
        drawRunningHeader();
        top = y;
      }
      page.drawText(line, { x, y: top - size, size, font: activeFont, color });
      top -= size + 3;
    }
    return top;
  }

  function drawSectionHeading(num, title) {
    ensureSpace(35);
    y -= 10;
    page.drawRectangle({
      x: MARGIN, y: y - 22, width: CONTENT_WIDTH, height: 22, color: SOFT_BG,
    });
    page.drawRectangle({
      x: MARGIN, y: y - 22, width: 3, height: 22, color: accent,
    });
    page.drawText(`SECTION ${num}: ${title.toUpperCase()}`, {
      x: MARGIN + 8, y: y - 15, size: 9.5, font: bold, color: INK,
    });
    y -= 28;
  }

  // --- Start Page 1 ---
  addPage();

  // Primary Header
  const headerTop = y;
  let leftHeaderBottom = headerTop;
  let rightHeaderBottom = headerTop;

  // Company Logo or Text
  if (companyLogoImg) {
    const scaled = companyLogoImg.scaleToFit(140, 48);
    page.drawImage(companyLogoImg, {
      x: MARGIN, y: headerTop - scaled.height, width: scaled.width, height: scaled.height,
    });
    leftHeaderBottom = headerTop - scaled.height - 6;
  } else {
    page.drawText(snapshot.business?.business_name || 'NEXTORA CREATIONS', {
      x: MARGIN, y: headerTop - 14, size: 14, font: bold, color: INK,
    });
    leftHeaderBottom = headerTop - 20;
  }

  // Business contact details on left
  let bTop = leftHeaderBottom;
  if (snapshot.business?.legal_name && snapshot.business.legal_name !== snapshot.business.business_name) {
    bTop = drawText(snapshot.business.legal_name, MARGIN, bTop, 8, false, MUTED, 240);
  }
  if (snapshot.business?.address) {
    bTop = drawText(snapshot.business.address, MARGIN, bTop, 7.5, false, MUTED, 240);
  }
  const busContact = [
    snapshot.business?.email,
    snapshot.business?.phone,
    snapshot.business?.website,
  ].filter(Boolean).join(' · ');
  if (busContact) {
    bTop = drawText(busContact, MARGIN, bTop, 7.5, false, MUTED, 240);
  }
  if (snapshot.business?.gstin) {
    bTop = drawText(`GSTIN: ${snapshot.business.gstin}`, MARGIN, bTop, 7.5, true, MUTED, 240);
  }
  if (snapshot.business?.pan) {
    bTop = drawText(`PAN: ${snapshot.business.pan}`, MARGIN, bTop, 7.5, false, MUTED, 240);
  }

  // Product Logo on Right
  if (productLogoImg) {
    const scaled = productLogoImg.scaleToFit(140, 48);
    const pX = A4.width - MARGIN - scaled.width;
    page.drawImage(productLogoImg, {
      x: pX, y: headerTop - scaled.height, width: scaled.width, height: scaled.height,
    });
    rightHeaderBottom = headerTop - scaled.height - 6;
  } else {
    const prodTitle = snapshot.product_name || 'Nextora POS';
    const prodWidth = bold.widthOfTextAtSize(prodTitle, 13);
    page.drawText(prodTitle, {
      x: A4.width - MARGIN - prodWidth, y: headerTop - 13, size: 13, font: bold, color: INK,
    });
    const subText = 'Product Marketing Partnership';
    const subWidth = font.widthOfTextAtSize(subText, 8);
    page.drawText(subText, {
      x: A4.width - MARGIN - subWidth, y: headerTop - 25, size: 8, font, color: MUTED,
    });
    rightHeaderBottom = headerTop - 30;
  }

  // Position below both headers
  y = Math.min(bTop, rightHeaderBottom) - 16;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 1,
    color: LINE,
  });
  y -= 18;

  // Document Title Banner
  page.drawRectangle({
    x: MARGIN, y: y - 32, width: CONTENT_WIDTH, height: 32, color: SOFT_BG,
  });
  page.drawText('INFLUENCER MARKETING & REVENUE-SHARING AGREEMENT', {
    x: MARGIN + 12, y: y - 18, size: 11, font: bold, color: INK,
  });
  page.drawText(`Commercial Partnership for ${snapshot.product_name || 'Nextora POS'}`, {
    x: MARGIN + 12, y: y - 27, size: 8, font, color: MUTED,
  });
  y -= 44;

  // Summary Metadata Table (Contract #, Dates, Version, Status)
  const metaBoxHeight = 52;
  page.drawRectangle({
    x: MARGIN, y: y - metaBoxHeight, width: CONTENT_WIDTH, height: metaBoxHeight,
    borderWidth: 0.5, borderColor: LINE, color: rgb(1, 1, 1),
  });

  const colW = CONTENT_WIDTH / 4;
  // Col 1: Contract # & Version
  page.drawText('CONTRACT NUMBER', { x: MARGIN + 8, y: y - 14, size: 7, font: bold, color: MUTED });
  page.drawText(snapshot.contract_number, { x: MARGIN + 8, y: y - 27, size: 9, font: bold, color: INK });
  page.drawText(`Version ${snapshot.version || 1} · Status: ${snapshot.status}`, { x: MARGIN + 8, y: y - 40, size: 7.5, font, color: MUTED });

  // Col 2: Effective Period
  page.drawText('EFFECTIVE START DATE', { x: MARGIN + colW + 8, y: y - 14, size: 7, font: bold, color: MUTED });
  page.drawText(formatDate(snapshot.effective_start_date), { x: MARGIN + colW + 8, y: y - 27, size: 8.5, font, color: INK });
  page.drawText(snapshot.is_indefinite ? 'Duration: Indefinite' : `Until: ${formatDate(snapshot.effective_end_date)}`, {
    x: MARGIN + colW + 8, y: y - 40, size: 7.5, font, color: MUTED,
  });

  // Col 3: Revenue-Sharing Rate
  page.drawText('REVENUE SHARE', { x: MARGIN + colW * 2 + 8, y: y - 14, size: 7, font: bold, color: MUTED });
  page.drawText(`${snapshot.commercial_terms.commission_percentage}%`, { x: MARGIN + colW * 2 + 8, y: y - 27, size: 11, font: bold, color: INK });
  page.drawText(`Basis: ${snapshot.commercial_terms.commission_basis.replace(/_/g, ' ')}`, {
    x: MARGIN + colW * 2 + 8, y: y - 40, size: 7, font, color: MUTED,
  });

  // Col 4: GST Treatment
  page.drawText('GST TREATMENT', { x: MARGIN + colW * 3 + 8, y: y - 14, size: 7, font: bold, color: MUTED });
  page.drawText(`Sales: GST ${snapshot.commercial_terms.product_tax_mode}`, { x: MARGIN + colW * 3 + 8, y: y - 27, size: 8, font: bold, color: INK });
  page.drawText(`Commission: GST ${snapshot.commercial_terms.commission_tax_terms}`, {
    x: MARGIN + colW * 3 + 8, y: y - 40, size: 7, font, color: MUTED,
  });

  y -= metaBoxHeight + 16;

  // --- SECTION 1: PARTIES ---
  drawSectionHeading(1, 'Parties to the Agreement');

  const partyBoxWidth = (CONTENT_WIDTH - 12) / 2;
  const partyBoxHeight = 85;

  // Nextora Creations Box
  page.drawRectangle({
    x: MARGIN, y: y - partyBoxHeight, width: partyBoxWidth, height: partyBoxHeight,
    borderWidth: 0.5, borderColor: LINE, color: SOFT_BG,
  });
  page.drawText('BRAND & PRODUCT OWNER:', { x: MARGIN + 8, y: y - 14, size: 7, font: bold, color: MUTED });
  page.drawText(snapshot.business?.business_name || 'Nextora Creations', { x: MARGIN + 8, y: y - 27, size: 9, font: bold, color: INK });
  page.drawText(`Owner of ${snapshot.product_name || 'Nextora POS'}`, { x: MARGIN + 8, y: y - 38, size: 7.5, font, color: MUTED });
  page.drawText(`Address: ${snapshot.business?.address || '—'}`, { x: MARGIN + 8, y: y - 49, size: 7, font, color: MUTED });
  page.drawText(`GSTIN: ${snapshot.business?.gstin || '—'} · PAN: ${snapshot.business?.pan || '—'}`, { x: MARGIN + 8, y: y - 60, size: 7, font, color: MUTED });
  page.drawText(`Contact: ${snapshot.business?.email || '—'}`, { x: MARGIN + 8, y: y - 71, size: 7, font, color: MUTED });

  // Influencer Box
  const infX = MARGIN + partyBoxWidth + 12;
  page.drawRectangle({
    x: infX, y: y - partyBoxHeight, width: partyBoxWidth, height: partyBoxHeight,
    borderWidth: 0.5, borderColor: LINE, color: SOFT_BG,
  });
  page.drawText('MARKETING PARTNER / INFLUENCER:', { x: infX + 8, y: y - 14, size: 7, font: bold, color: MUTED });
  page.drawText(snapshot.influencer?.legal_name || '—', { x: infX + 8, y: y - 27, size: 9, font: bold, color: INK });
  page.drawText(`Display Name: ${snapshot.influencer?.display_name || '—'} · Handle: ${snapshot.influencer?.instagram_username || '—'}`, {
    x: infX + 8, y: y - 38, size: 7.5, font, color: MUTED,
  });
  page.drawText(`Address: ${[snapshot.influencer?.address, snapshot.influencer?.city, snapshot.influencer?.postal_code].filter(Boolean).join(', ') || '—'}`, {
    x: infX + 8, y: y - 49, size: 7, font, color: MUTED,
  });
  page.drawText(`Email: ${snapshot.influencer?.email || '—'} · Phone: ${snapshot.influencer?.phone || '—'}`, {
    x: infX + 8, y: y - 60, size: 7, font, color: MUTED,
  });
  page.drawText(`GST Status: ${snapshot.commercial_terms.influencer_gst_registered ? `Registered (${snapshot.commercial_terms.influencer_gstin})` : 'Unregistered'}`, {
    x: infX + 8, y: y - 71, size: 7, font, color: MUTED,
  });

  y -= partyBoxHeight + 16;

  // --- SECTION 2: PURPOSE OF THE PARTNERSHIP ---
  drawSectionHeading(2, 'Purpose of the Partnership');
  y = drawText(snapshot.clauses.section_2_purpose, MARGIN, y, 8, false, INK);

  // --- SECTION 3: SCOPE OF WORK & RESPONSIBILITIES ---
  drawSectionHeading(3, 'Scope of Work & Marketing Deliverables');
  y = drawText('The Influencer agrees to deliver the promotional commitments outlined below during the term of this Agreement:', MARGIN, y, 8, false, INK);
  y -= 4;

  const deliverables = snapshot.deliverables || [];
  if (deliverables.length > 0) {
    ensureSpace(40);
    // Table Header
    const rowH = 16;
    page.drawRectangle({
      x: MARGIN, y: y - rowH, width: CONTENT_WIDTH, height: rowH, color: TABLE_HEADER_BG,
    });
    page.drawText('DELIVERABLE', { x: MARGIN + 6, y: y - 11, size: 7, font: bold, color: INK });
    page.drawText('MIN. QTY', { x: MARGIN + 160, y: y - 11, size: 7, font: bold, color: INK });
    page.drawText('FREQUENCY', { x: MARGIN + 230, y: y - 11, size: 7, font: bold, color: INK });
    page.drawText('REQUIRED INSTAGRAM HANDLES', { x: MARGIN + 320, y: y - 11, size: 7, font: bold, color: INK });
    y -= rowH;

    for (const d of deliverables) {
      const isReel = String(d.type || '').toLowerCase().includes('reel');
      const isDemo = String(d.type || '').toLowerCase().includes('demonstration');
      const qty = isReel ? Math.max(4, Number(d.quantity || 4)) : (d.quantity || 1);
      const handles = (isReel || isDemo)
        ? '@nextora_pos, @nextora_creations'
        : (d.required_tags || '@nextora_pos, @nextora_creations');

      const lines = wrapText(font, handles, 7, 185);
      const rowHeight = Math.max(18, lines.length * 9 + 8);
      ensureSpace(rowHeight + 4);

      page.drawRectangle({
        x: MARGIN, y: y - rowHeight, width: CONTENT_WIDTH, height: rowHeight,
        borderWidth: 0.5, borderColor: LINE, color: rgb(1, 1, 1),
      });

      page.drawText(d.type || 'Deliverable', { x: MARGIN + 6, y: y - 12, size: 7.5, font: bold, color: INK });
      page.drawText(String(qty), { x: MARGIN + 160, y: y - 12, size: 7.5, font, color: INK });
      page.drawText(d.frequency || 'Monthly', { x: MARGIN + 230, y: y - 12, size: 7.5, font, color: INK });

      let textY = y - 11;
      for (const line of lines) {
        page.drawText(line, { x: MARGIN + 320, y: textY, size: 7, font, color: INK });
        textY -= 9;
      }
      y -= rowHeight;
    }
  } else {
    y = drawText('Marketing deliverables shall be agreed upon mutually in writing via campaign schedules.', MARGIN, y, 8, false, MUTED);
  }

  // --- SECTION 4: REVENUE-SHARING TERMS & CALCULATION ---
  drawSectionHeading(4, 'Revenue-Sharing Terms & Calculation Basis');
  y = drawText(snapshot.clauses.section_4_revenue_terms, MARGIN, y, 8, false, INK);

  // Illustrative Calculation Table (Two Nextora POS Products)
  const calc = snapshot.illustrative_calculation;
  if (calc) {
    const products = calc.products || [
      {
        name: 'Nextora POS Mobile App',
        gross_sale_minor: 599900,
        gst_rate_percent: '18%',
        gst_amount_minor: 91510,
        net_sale_minor: 508390,
        commission_rate_percent: `${calc.commission_percentage || '50.00'}%`,
        commission_minor: 254195,
      },
      {
        name: 'Nextora POS Desktop',
        gross_sale_minor: 799900,
        gst_rate_percent: '18%',
        gst_amount_minor: 122019,
        net_sale_minor: 677881,
        commission_rate_percent: `${calc.commission_percentage || '50.00'}%`,
        commission_minor: 338941,
      },
    ];

    ensureSpace(160);
    y -= 4;
    page.drawText('ILLUSTRATIVE CALCULATION EXAMPLE (NON-BINDING)', {
      x: MARGIN, y: y - 10, size: 8, font: bold, color: INK,
    });
    y -= 14;

    // Table Header
    const rowH = 16;
    page.drawRectangle({
      x: MARGIN, y: y - rowH, width: CONTENT_WIDTH, height: rowH, color: TABLE_HEADER_BG,
    });
    page.drawText('PRODUCT', { x: MARGIN + 6, y: y - 11, size: 6.5, font: bold, color: INK });
    page.drawText('PRICE (INCL. GST)', { x: MARGIN + 135, y: y - 11, size: 6.5, font: bold, color: INK });
    page.drawText('GST RATE', { x: MARGIN + 215, y: y - 11, size: 6.5, font: bold, color: INK });
    page.drawText('GST AMOUNT', { x: MARGIN + 265, y: y - 11, size: 6.5, font: bold, color: INK });
    page.drawText('NET VALUE (EX. GST)', { x: MARGIN + 330, y: y - 11, size: 6.5, font: bold, color: INK });
    page.drawText('COMM. %', { x: MARGIN + 415, y: y - 11, size: 6.5, font: bold, color: INK });
    page.drawText('INFLUENCER COMM.', { x: MARGIN + 455, y: y - 11, size: 6.5, font: bold, color: INK });
    y -= rowH;

    for (const p of products) {
      ensureSpace(18);
      page.drawRectangle({
        x: MARGIN, y: y - 16, width: CONTENT_WIDTH, height: 16,
        borderWidth: 0.5, borderColor: LINE, color: rgb(1, 1, 1),
      });
      page.drawText(p.name, { x: MARGIN + 6, y: y - 11, size: 7, font: bold, color: INK });
      page.drawText(`₹${(p.gross_sale_minor / 100).toFixed(2)}`, { x: MARGIN + 135, y: y - 11, size: 7, font, color: INK });
      page.drawText(p.gst_rate_percent, { x: MARGIN + 215, y: y - 11, size: 7, font, color: MUTED });
      page.drawText(`₹${(p.gst_amount_minor / 100).toFixed(2)}`, { x: MARGIN + 265, y: y - 11, size: 7, font, color: MUTED });
      page.drawText(`₹${(p.net_sale_minor / 100).toFixed(2)}`, { x: MARGIN + 330, y: y - 11, size: 7, font, color: INK });
      page.drawText(p.commission_rate_percent, { x: MARGIN + 415, y: y - 11, size: 7, font, color: INK });
      page.drawText(`₹${(p.commission_minor / 100).toFixed(2)}`, { x: MARGIN + 455, y: y - 11, size: 7, font: bold, color: accent });
      y -= 16;
    }

    // GST Breakdown Box (Intra-State vs Interstate)
    ensureSpace(68);
    const boxH = 56;
    page.drawRectangle({
      x: MARGIN, y: y - boxH - 4, width: CONTENT_WIDTH, height: boxH,
      borderWidth: 0.5, borderColor: LINE, color: SOFT_BG,
    });
    page.drawText('GST TREATMENT & CLASSIFICATION BREAKDOWN', {
      x: MARGIN + 6, y: y - 14, size: 6.5, font: bold, color: INK,
    });
    page.drawText('Eligible Telangana Intra-State Supplies (CGST 9% + SGST 9%):', {
      x: MARGIN + 6, y: y - 25, size: 6, font: bold, color: INK,
    });
    page.drawText('• Mobile App: CGST ₹457.55 + SGST ₹457.55 = Total GST ₹915.10   |   • Desktop: CGST ₹610.10 + SGST ₹610.09 = Total GST ₹1,220.19', {
      x: MARGIN + 12, y: y - 34, size: 5.8, font, color: MUTED,
    });
    page.drawText('Eligible Interstate Supplies (IGST 18%):', {
      x: MARGIN + 6, y: y - 44, size: 6, font: bold, color: INK,
    });
    page.drawText('• Mobile App: IGST ₹915.10 (18%)   |   • Desktop: IGST ₹1,220.19 (18%)   — Commission calculated on Net Sale Value excluding GST.', {
      x: MARGIN + 12, y: y - 53, size: 5.8, font, color: MUTED,
    });
    y -= boxH + 8;

    // Disclaimer
    const discLines = wrapText(font, calc.disclaimer || 'Illustrative calculation based on the listed retail prices and the stated GST rate. Actual commission is calculated on verified eligible sales under this agreement, subject to applicable cancellations, refunds, chargebacks, and other agreed adjustments.', 5.5, CONTENT_WIDTH - 8);
    ensureSpace(discLines.length * 7 + 4);
    for (const dLine of discLines) {
      page.drawText(dLine, { x: MARGIN + 4, y: y - 6, size: 5.5, font, color: MUTED });
      y -= 7;
    }
    y -= 8;
  }

  // --- SECTION 5: MARKETING OBLIGATIONS & CONDUCT ---
  drawSectionHeading(5, 'Marketing Obligations & Professional Conduct');
  y = drawText(snapshot.clauses.section_5_conduct_obligations, MARGIN, y, 8, false, INK);

  // --- SECTION 6: BRAND ASSETS & INTELLECTUAL PROPERTY ---
  drawSectionHeading(6, 'Brand Assets & Intellectual Property');
  y = drawText(snapshot.clauses.section_6_brand_intellectual_property, MARGIN, y, 8, false, INK);

  // --- SECTION 7: PAYMENT, INVOICING & TAXATION ---
  drawSectionHeading(7, 'Payment, Invoicing & Statutory Deductions');
  y = drawText(snapshot.clauses.section_7_payment_invoicing, MARGIN, y, 8, false, INK);

  // --- SECTION 8: TERM, TERMINATION & SURVIVAL ---
  drawSectionHeading(8, 'Term, Termination & Survival');
  y = drawText(snapshot.clauses.section_8_term_termination, MARGIN, y, 8, false, INK);

  // --- SECTION 9: GENERAL LEGAL TERMS ---
  drawSectionHeading(9, 'General Legal Provisions');
  y = drawText(snapshot.clauses.section_9_general_legal, MARGIN, y, 8, false, INK);

  // Special terms if configured
  if (snapshot.special_terms?.trim()) {
    drawSectionHeading('9A', 'Special Agreed Terms & Conditions');
    y = drawText(snapshot.special_terms, MARGIN, y, 8, false, INK);
  }

  // --- SECTION 10: ACCEPTANCE & SIGNATURES ---
  // Ensure the entire signature block fits on one page
  ensureSpace(150);
  drawSectionHeading(10, 'Acceptance & Execution');
  y = drawText('IN WITNESS WHEREOF, the parties hereto have caused this Agreement to be duly executed by their authorized representatives as of the dates set forth below:', MARGIN, y, 8, false, INK);
  y -= 10;

  const sigBoxW = (CONTENT_WIDTH - 20) / 2;
  const sigBoxH = 95;

  // Nextora Creations Signatory Block
  page.drawRectangle({
    x: MARGIN, y: y - sigBoxH, width: sigBoxW, height: sigBoxH,
    borderWidth: 0.5, borderColor: LINE, color: rgb(1, 1, 1),
  });
  page.drawText('FOR NEXTORA CREATIONS:', { x: MARGIN + 10, y: y - 14, size: 7.5, font: bold, color: MUTED });
  page.drawLine({
    start: { x: MARGIN + 10, y: y - 48 },
    end: { x: MARGIN + sigBoxW - 10, y: y - 48 },
    thickness: 0.5,
    color: MUTED,
  });
  page.drawText('Authorized Signature', { x: MARGIN + 10, y: y - 56, size: 6.5, font, color: MUTED });
  page.drawText(`Name: ${snapshot.business?.signatory_name || 'Authorized Signatory'}`, { x: MARGIN + 10, y: y - 68, size: 7.5, font: bold, color: INK });
  page.drawText(`Designation: ${snapshot.business?.signatory_title || 'Director'}`, { x: MARGIN + 10, y: y - 79, size: 7, font, color: MUTED });
  page.drawText('Date: ________________________', { x: MARGIN + 10, y: y - 90, size: 7, font, color: MUTED });

  // Influencer Signatory Block
  const iSigX = MARGIN + sigBoxW + 20;
  page.drawRectangle({
    x: iSigX, y: y - sigBoxH, width: sigBoxW, height: sigBoxH,
    borderWidth: 0.5, borderColor: LINE, color: rgb(1, 1, 1),
  });
  page.drawText('FOR INFLUENCER / MARKETING PARTNER:', { x: iSigX + 10, y: y - 14, size: 7.5, font: bold, color: MUTED });
  page.drawLine({
    start: { x: iSigX + 10, y: y - 48 },
    end: { x: iSigX + sigBoxW - 10, y: y - 48 },
    thickness: 0.5,
    color: MUTED,
  });
  page.drawText('Influencer Signature', { x: iSigX + 10, y: y - 56, size: 6.5, font, color: MUTED });
  page.drawText(`Name: ${snapshot.influencer?.legal_name || '—'}`, { x: iSigX + 10, y: y - 68, size: 7.5, font: bold, color: INK });
  page.drawText(`Instagram: ${snapshot.influencer?.instagram_username || '—'}`, { x: iSigX + 10, y: y - 79, size: 7, font, color: MUTED });
  page.drawText('Date: ________________________', { x: iSigX + 10, y: y - 90, size: 7, font, color: MUTED });

  y -= sigBoxH + 12;

  // Legal Notice
  page.drawText('Note: Generating or downloading this PDF document does not constitute formal execution or proof of signature. Both parties must execute this Agreement via verified electronic signature or ink signature before the partnership becomes active.', {
    x: MARGIN, y: y - 8, size: 6, font, color: MUTED,
  });

  // Footers across all pages
  const totalPages = pages.length;
  pages.forEach((p, index) => {
    p.drawLine({
      start: { x: MARGIN, y: FOOTER_HEIGHT + 6 },
      end: { x: A4.width - MARGIN, y: FOOTER_HEIGHT + 6 },
      thickness: 0.5,
      color: LINE,
    });
    p.drawText(`Nextora Creations · ${snapshot.product_name || 'Nextora POS'} Influencer Partnership Agreement · ${snapshot.contract_number}`, {
      x: MARGIN, y: FOOTER_HEIGHT - 6, size: 6.5, font, color: MUTED,
    });
    const pageStr = `Page ${index + 1} of ${totalPages}`;
    const pW = font.widthOfTextAtSize(pageStr, 6.5);
    p.drawText(pageStr, {
      x: A4.width - MARGIN - pW, y: FOOTER_HEIGHT - 6, size: 6.5, font, color: MUTED,
    });
  });

  return await doc.save();
}
