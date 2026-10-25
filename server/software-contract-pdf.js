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

export async function renderSoftwareContractPdf(snapshot, { companyLogo = null } = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const [regularBytes, boldBytes] = await Promise.all([
    readFontBytes('NotoSans-Regular.ttf'),
    readFontBytes('NotoSans-Bold.ttf'),
  ]);
  const font = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });

  const companyLogoImg = await embedImage(doc, companyLogo);

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

  function drawRunningHeader() {
    page.drawText('SOFTWARE DEVELOPMENT SERVICES AGREEMENT', {
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

  function ensureSpace(neededHeight) {
    if (y - neededHeight < MARGIN + FOOTER_HEIGHT) {
      addPage();
      drawRunningHeader();
    }
  }

  function drawText(value, x, top, size = 8.5, useBold = false, color = INK, max = CONTENT_WIDTH) {
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
    ensureSpace(40);
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
    bTop = drawText(snapshot.business.legal_name, MARGIN, bTop, 8, false, MUTED, 250);
  }
  if (snapshot.business?.address) {
    bTop = drawText(snapshot.business.address, MARGIN, bTop, 7.5, false, MUTED, 250);
  }
  const busContact = [
    snapshot.business?.phone || '7674981970',
    snapshot.business?.website || 'https://nextoracreations.co.in/',
    snapshot.business?.email,
  ].filter(Boolean).join(' · ');
  if (busContact) {
    bTop = drawText(busContact, MARGIN, bTop, 7.5, false, MUTED, 250);
  }
  if (snapshot.business?.gstin) {
    bTop = drawText(`GSTIN: ${snapshot.business.gstin}`, MARGIN, bTop, 7.5, true, MUTED, 250);
  }

  // Contract Identity on Right
  const rightX = A4.width - MARGIN - 180;
  let rTop = headerTop - 2;
  page.drawRectangle({
    x: rightX, y: rTop - 45, width: 180, height: 45,
    color: SOFT_BG, borderWidth: 0.5, borderColor: LINE,
  });
  page.drawText('CONTRACT NUMBER', { x: rightX + 8, y: rTop - 12, size: 6.5, font: bold, color: MUTED });
  page.drawText(snapshot.contract_number, { x: rightX + 8, y: rTop - 24, size: 9, font: bold, color: INK });
  page.drawText(`Date: ${formatDate(snapshot.project?.start_date || snapshot.created_at)} · Status: ${snapshot.status}`, {
    x: rightX + 8, y: rTop - 36, size: 6.5, font, color: MUTED,
  });
  rightHeaderBottom = rTop - 52;

  // Position below both headers
  y = Math.min(bTop, rightHeaderBottom) - 14;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 1,
    color: LINE,
  });
  y -= 16;

  // Document Title Banner
  page.drawRectangle({
    x: MARGIN, y: y - 32, width: CONTENT_WIDTH, height: 32, color: SOFT_BG,
  });
  page.drawText('SOFTWARE DEVELOPMENT SERVICES AGREEMENT', {
    x: MARGIN + 12, y: y - 18, size: 11, font: bold, color: INK,
  });
  page.drawText(`Service Category: ${snapshot.service_category} · Engagement Title: ${snapshot.title}`, {
    x: MARGIN + 12, y: y - 27, size: 8, font, color: MUTED,
  });
  y -= 44;

  // Metadata Box
  const metaBoxHeight = 44;
  page.drawRectangle({
    x: MARGIN, y: y - metaBoxHeight, width: CONTENT_WIDTH, height: metaBoxHeight,
    borderWidth: 0.5, borderColor: LINE, color: rgb(1, 1, 1),
  });
  const colW = CONTENT_WIDTH / 4;
  const metaItems = [
    { label: 'PROJECT TITLE', value: snapshot.title },
    { label: 'ESTIMATED TIMELINE', value: snapshot.project?.development_duration || '1 Month' },
    { label: 'FREE SUPPORT', value: `${snapshot.support_and_maintenance?.free_support_months ?? 3} Months Included` },
    { label: 'CONTRACT STATUS', value: snapshot.status },
  ];
  metaItems.forEach((item, idx) => {
    const mX = MARGIN + idx * colW + 8;
    page.drawText(item.label, { x: mX, y: y - 14, size: 6.5, font: bold, color: MUTED });
    const valText = font.widthOfTextAtSize(item.value, 8) > colW - 12
      ? item.value.slice(0, 22) + '...'
      : item.value;
    page.drawText(valText, { x: mX, y: y - 28, size: 8, font: bold, color: INK });
  });
  y -= metaBoxHeight + 14;

  // --- SECTION 1: PARTIES ---
  drawSectionHeading(1, 'Parties to the Agreement');
  y = drawText(snapshot.clauses?.section_1_parties || '', MARGIN, y, 7.5, false, INK);
  y -= 8;

  // Client and Developer Side-by-Side Cards
  ensureSpace(80);
  const cardW = (CONTENT_WIDTH - 12) / 2;
  const cardH = 75;

  // Developer Card
  page.drawRectangle({
    x: MARGIN, y: y - cardH, width: cardW, height: cardH,
    color: SOFT_BG, borderWidth: 0.5, borderColor: LINE,
  });
  page.drawText('DEVELOPER / SERVICE PROVIDER', { x: MARGIN + 8, y: y - 12, size: 7, font: bold, color: MUTED });
  page.drawText(snapshot.business?.business_name || 'Nextora Creations', { x: MARGIN + 8, y: y - 24, size: 8.5, font: bold, color: INK });
  page.drawText(snapshot.business?.address || 'Hyderabad, Telangana, India', { x: MARGIN + 8, y: y - 35, size: 7, font, color: MUTED, maxWidth: cardW - 16 });
  page.drawText(`Phone: ${snapshot.business?.phone || '7674981970'} · Web: ${snapshot.business?.website || 'nextoracreations.co.in'}`, { x: MARGIN + 8, y: y - 46, size: 7, font, color: MUTED });
  page.drawText(`GSTIN: ${snapshot.business?.gstin || '36JTAPK9167A1ZK'} · State: Telangana (36)`, { x: MARGIN + 8, y: y - 57, size: 7, font: bold, color: INK });
  page.drawText(`Signatory: ${snapshot.business?.signatory_name || 'Authorized Signatory'} (${snapshot.business?.signatory_title || 'Director'})`, { x: MARGIN + 8, y: y - 68, size: 7, font, color: MUTED });

  // Client Card
  const cX = MARGIN + cardW + 12;
  page.drawRectangle({
    x: cX, y: y - cardH, width: cardW, height: cardH,
    color: SOFT_BG, borderWidth: 0.5, borderColor: LINE,
  });
  page.drawText('CLIENT / CUSTOMER', { x: cX + 8, y: y - 12, size: 7, font: bold, color: MUTED });
  page.drawText(snapshot.client?.legal_name || snapshot.client?.name || '—', { x: cX + 8, y: y - 24, size: 8.5, font: bold, color: INK });
  const clientAddr = [snapshot.client?.billing_address, snapshot.client?.city, snapshot.client?.postal_code].filter(Boolean).join(', ');
  page.drawText(clientAddr || 'Address on file', { x: cX + 8, y: y - 35, size: 7, font, color: MUTED, maxWidth: cardW - 16 });
  page.drawText(`Contact: ${snapshot.client?.contact_person || '—'} · Email: ${snapshot.client?.email || '—'} · Phone: ${snapshot.client?.phone || '—'}`, { x: cX + 8, y: y - 46, size: 7, font, color: MUTED, maxWidth: cardW - 16 });
  page.drawText(`GSTIN: ${snapshot.client?.gstin || 'Unregistered'} · PAN: ${snapshot.client?.pan || '—'} · State Code: ${snapshot.client?.state_code || '36'}`, { x: cX + 8, y: y - 57, size: 7, font: bold, color: INK });
  page.drawText(`Signatory: ${snapshot.client?.signatory_name || '—'} (${snapshot.client?.signatory_designation || 'Authorized Representative'})`, { x: cX + 8, y: y - 68, size: 7, font, color: MUTED });

  y -= cardH + 14;

  // --- SECTION 2: PROJECT & SERVICE DETAILS ---
  drawSectionHeading(2, 'Project & Service Details');
  ensureSpace(60);
  const projDetails = [
    `Service Category: ${snapshot.service_category}`,
    snapshot.project?.service_description ? `Description: ${snapshot.project.service_description}` : null,
    snapshot.project?.business_objectives ? `Business Objectives: ${snapshot.project.business_objectives}` : null,
    `Project Start Date: ${formatDate(snapshot.project?.start_date)} · Estimated Completion: ${snapshot.project?.estimated_completion_date ? formatDate(snapshot.project.estimated_completion_date) : 'Approximately 1 Month'}`,
    snapshot.project?.deployment_target ? `Deployment Target: ${snapshot.project.deployment_target}` : null,
    snapshot.project?.hosting_responsibility ? `Hosting Responsibility: ${snapshot.project.hosting_responsibility}` : null,
    snapshot.project?.third_party_integrations ? `Third-Party Integrations: ${snapshot.project.third_party_integrations}` : null,
    snapshot.project?.client_assets_access ? `Client-Provided Assets & Access: ${snapshot.project.client_assets_access}` : null,
    snapshot.project?.acceptance_criteria ? `Acceptance Criteria: ${snapshot.project.acceptance_criteria}` : null,
  ].filter(Boolean);

  for (const line of projDetails) {
    y = drawText(`• ${line}`, MARGIN + 4, y, 7.5, false, INK);
  }
  y -= 6;

  // --- SECTION 3: REQUIREMENTS & FEATURE SCOPE (SCHEDULE A) ---
  drawSectionHeading(3, 'Requirements & Feature Scope (Schedule A)');
  y = drawText('The software solution includes the following agreed features, deliverables, and acceptance criteria. Features not approved in writing herein are excluded from scope.', MARGIN, y, 7.5, false, MUTED);
  y -= 8;

  const features = snapshot.scope?.features || [];
  if (features.length) {
    ensureSpace(40);
    // Table Header
    const fCols = [
      { name: 'S.No', w: 32, align: 'left' },
      { name: 'Feature Name', w: 105, align: 'left' },
      { name: 'Description', w: 130, align: 'left' },
      { name: 'Deliverables', w: 90, align: 'left' },
      { name: 'Priority', w: 45, align: 'center' },
      { name: 'Scope', w: 45, align: 'center' },
      { name: 'Notes / Criteria', w: 68, align: 'left' },
    ];
    page.drawRectangle({
      x: MARGIN, y: y - 18, width: CONTENT_WIDTH, height: 18, color: TABLE_HEADER_BG,
    });
    let curX = MARGIN;
    fCols.forEach(col => {
      page.drawText(col.name, { x: curX + 4, y: y - 12, size: 7, font: bold, color: INK });
      curX += col.w;
    });
    y -= 18;

    features.forEach((f, idx) => {
      const sno = String(f.sno || idx + 1);
      const name = f.name || '—';
      const desc = f.description || '—';
      const del = f.deliverables || '—';
      const priority = f.priority || 'Normal';
      const scopeStatus = f.included === false ? 'Excluded' : 'Included';
      const notes = f.acceptance_criteria || f.notes || '—';

      // Estimate row height based on text wrap
      const nameLines = wrapText(bold, name, 7, fCols[1].w - 8);
      const descLines = wrapText(font, desc, 6.5, fCols[2].w - 8);
      const delLines = wrapText(font, del, 6.5, fCols[3].w - 8);
      const notesLines = wrapText(font, notes, 6.5, fCols[6].w - 8);
      const maxLines = Math.max(nameLines.length, descLines.length, delLines.length, notesLines.length, 1);
      const rowHeight = Math.max(18, maxLines * 8.5 + 6);

      ensureSpace(rowHeight + 5);

      // Zebra background
      if (idx % 2 === 1) {
        page.drawRectangle({
          x: MARGIN, y: y - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: SOFT_BG,
        });
      }
      // Row bottom border
      page.drawLine({
        start: { x: MARGIN, y: y - rowHeight },
        end: { x: A4.width - MARGIN, y: y - rowHeight },
        thickness: 0.5,
        color: LINE,
      });

      let cellX = MARGIN;
      // S.No
      page.drawText(sno, { x: cellX + 4, y: y - 12, size: 7, font, color: INK });
      cellX += fCols[0].w;

      // Name
      let topY = y - 11;
      nameLines.forEach(l => {
        page.drawText(l, { x: cellX + 4, y: topY, size: 7, font: bold, color: INK });
        topY -= 8.5;
      });
      cellX += fCols[1].w;

      // Desc
      topY = y - 11;
      descLines.forEach(l => {
        page.drawText(l, { x: cellX + 4, y: topY, size: 6.5, font, color: INK });
        topY -= 8;
      });
      cellX += fCols[2].w;

      // Deliverables
      topY = y - 11;
      delLines.forEach(l => {
        page.drawText(l, { x: cellX + 4, y: topY, size: 6.5, font, color: MUTED });
        topY -= 8;
      });
      cellX += fCols[3].w;

      // Priority
      page.drawText(priority, { x: cellX + 4, y: y - 12, size: 6.5, font, color: MUTED });
      cellX += fCols[4].w;

      // Scope
      page.drawText(scopeStatus, {
        x: cellX + 4, y: y - 12, size: 6.5, font: bold,
        color: scopeStatus === 'Included' ? rgb(0.1, 0.5, 0.2) : rgb(0.7, 0.2, 0.2),
      });
      cellX += fCols[5].w;

      // Notes
      topY = y - 11;
      notesLines.forEach(l => {
        page.drawText(l, { x: cellX + 4, y: topY, size: 6.5, font, color: MUTED });
        topY -= 8;
      });

      y -= rowHeight;
    });
  } else {
    y = drawText('Features and functional specification to be confirmed prior to execution.', MARGIN, y, 7.5, false, MUTED);
  }
  y -= 8;

  // Scope Notes (Included/Excluded, Responsibilities)
  const scopeNotes = [
    snapshot.scope?.included_services ? `Included Services: ${snapshot.scope.included_services}` : null,
    snapshot.scope?.excluded_services ? `Excluded Services: ${snapshot.scope.excluded_services}` : null,
    snapshot.scope?.client_responsibilities ? `Client Responsibilities: ${snapshot.scope.client_responsibilities}` : null,
    snapshot.scope?.third_party_dependencies ? `Third-Party Dependencies: ${snapshot.scope.third_party_dependencies}` : null,
    snapshot.scope?.technical_assumptions ? `Technical Assumptions: ${snapshot.scope.technical_assumptions}` : null,
    snapshot.scope?.scope_limitations ? `Scope Limitations: ${snapshot.scope.scope_limitations}` : null,
  ].filter(Boolean);

  if (scopeNotes.length) {
    ensureSpace(40);
    for (const sn of scopeNotes) {
      y = drawText(`• ${sn}`, MARGIN + 4, y, 7.5, false, INK);
    }
    y -= 6;
  }

  // --- SECTION 4: PROJECT PRICING & GST BREAKDOWN ---
  drawSectionHeading(4, 'Project Pricing & GST Calculations');
  const fin = snapshot.financials || {};
  ensureSpace(120);

  // Financial Breakdown Table
  const finBoxW = CONTENT_WIDTH;
  const finBoxH = 110;
  page.drawRectangle({
    x: MARGIN, y: y - finBoxH, width: finBoxW, height: finBoxH,
    color: SOFT_BG, borderWidth: 0.5, borderColor: LINE,
  });

  const finLeftX = MARGIN + 12;
  const finRightX = MARGIN + CONTENT_WIDTH / 2 + 12;

  let fY = y - 14;
  page.drawText(`Pricing Mode: ${fin.pricing_mode === 'INCLUSIVE' ? 'GST-Inclusive Pricing' : 'GST-Exclusive Pricing'}`, { x: finLeftX, y: fY, size: 7.5, font: bold, color: INK });
  page.drawText(`Tax Classification: ${fin.supply_type_label || 'Intra-state (CGST + SGST)'}`, { x: finRightX, y: fY, size: 7.5, font: bold, color: INK });
  fY -= 14;

  page.drawText(`1. Project Base Price: ${formatMinor(fin.base_price_minor)}`, { x: finLeftX, y: fY, size: 7.5, font, color: INK });
  page.drawText(`5. Final Project Amount: ${formatMinor(fin.final_amount_minor)}`, { x: finRightX, y: fY, size: 8, font: bold, color: INK });
  fY -= 13;

  if (fin.discount_minor > 0) {
    page.drawText(`2. Agreed Discount: -${formatMinor(fin.discount_minor)}`, { x: finLeftX, y: fY, size: 7.5, font, color: INK });
  } else {
    page.drawText(`2. Discount: ₹0.00`, { x: finLeftX, y: fY, size: 7.5, font, color: MUTED });
  }
  page.drawText(`6. Advance Percentage: ${fin.advance_percentage_label || '10.00%'}`, { x: finRightX, y: fY, size: 7.5, font, color: INK });
  fY -= 13;

  page.drawText(`3. Taxable Amount: ${formatMinor(fin.taxable_amount_minor)}`, { x: finLeftX, y: fY, size: 7.5, font: bold, color: INK });
  page.drawText(`7. Advance Payable: ${formatMinor(fin.advance_amount_minor)}`, { x: finRightX, y: fY, size: 8, font: bold, color: accent });
  fY -= 13;

  if (fin.supply_type === 'INTRA') {
    page.drawText(`4. GST (${fin.gst_rate_percent}%): CGST (${(fin.gst_rate_bp/200).toFixed(1)}%) = ${formatMinor(fin.cgst_minor)} · SGST (${(fin.gst_rate_bp/200).toFixed(1)}%) = ${formatMinor(fin.sgst_minor)}`, {
      x: finLeftX, y: fY, size: 7, font, color: INK,
    });
  } else {
    page.drawText(`4. GST (${fin.gst_rate_percent}%): IGST (${fin.gst_rate_percent}%) = ${formatMinor(fin.igst_minor)}`, {
      x: finLeftX, y: fY, size: 7, font, color: INK,
    });
  }
  page.drawText(`8. Remaining Balance: ${formatMinor(fin.remaining_balance_minor)}`, { x: finRightX, y: fY, size: 8, font: bold, color: INK });
  fY -= 13;

  page.drawText(`Total GST: ${formatMinor(fin.total_gst_minor)}`, { x: finLeftX, y: fY, size: 7, font: bold, color: MUTED });
  page.drawText(`Balance Allocation: ${fin.is_milestones_reconciled ? 'Fully Reconciled with Milestones' : 'Reconciliation Pending'}`, {
    x: finRightX, y: fY, size: 7, font: bold,
    color: fin.is_milestones_reconciled ? rgb(0.1, 0.5, 0.2) : rgb(0.7, 0.2, 0.2),
  });

  y -= finBoxH + 12;

  // --- SECTION 5: PAYMENT TERMS & MILESTONES ---
  drawSectionHeading(5, 'Payment Terms & Milestones');
  const milestones = snapshot.milestones?.payment_milestones || [];
  if (milestones.length) {
    ensureSpace(40);
    // Table of Milestones
    const mCols = [
      { name: 'S.No', w: 32 },
      { name: 'Milestone Name', w: 140 },
      { name: 'Trigger Event / Deliverable', w: 175 },
      { name: 'Due Date', w: 75 },
      { name: 'Amount (₹)', w: 93 },
    ];
    page.drawRectangle({
      x: MARGIN, y: y - 18, width: CONTENT_WIDTH, height: 18, color: TABLE_HEADER_BG,
    });
    let curX = MARGIN;
    mCols.forEach(col => {
      page.drawText(col.name, { x: curX + 4, y: y - 12, size: 7, font: bold, color: INK });
      curX += col.w;
    });
    y -= 18;

    milestones.forEach((m, idx) => {
      ensureSpace(20);
      const mRowH = 18;
      if (idx % 2 === 1) {
        page.drawRectangle({
          x: MARGIN, y: y - mRowH, width: CONTENT_WIDTH, height: mRowH, color: SOFT_BG,
        });
      }
      page.drawLine({
        start: { x: MARGIN, y: y - mRowH },
        end: { x: A4.width - MARGIN, y: y - mRowH },
        thickness: 0.5,
        color: LINE,
      });

      let mX = MARGIN;
      page.drawText(String(idx + 1), { x: mX + 4, y: y - 12, size: 7, font, color: INK });
      mX += mCols[0].w;
      page.drawText(m.name || `Milestone ${idx + 1}`, { x: mX + 4, y: y - 12, size: 7, font: bold, color: INK });
      mX += mCols[1].w;
      page.drawText(m.trigger || 'Upon deliverable completion', { x: mX + 4, y: y - 12, size: 6.5, font, color: INK });
      mX += mCols[2].w;
      page.drawText(m.due_date ? formatDate(m.due_date) : 'On Acceptance', { x: mX + 4, y: y - 12, size: 6.5, font, color: MUTED });
      mX += mCols[3].w;
      const amtStr = formatMinor(m.amount_minor || 0);
      page.drawText(amtStr, { x: mX + 4, y: y - 12, size: 7.5, font: bold, color: INK });

      y -= mRowH;
    });
  } else {
    y = drawText('Remaining balance payable upon satisfactory delivery and deployment acceptance.', MARGIN, y, 7.5, false, MUTED);
  }
  y -= 8;

  // --- SECTION 6: DEVELOPMENT SCHEDULE & TIMELINE ---
  drawSectionHeading(6, 'Development Timeline');
  ensureSpace(40);
  const timeText = `The estimated project timeline is ${snapshot.project?.development_duration || 'approximately 1 month'}, commencing upon execution of this Agreement, receipt of the agreed 10% advance, and full delivery of client assets, credentials, and requirements sign-off. Delays in client feedback or dependencies shall extend the delivery date proportionally.`;
  y = drawText(timeText, MARGIN, y, 7.5, false, INK);
  y -= 8;

  // --- SECTION 7: THREE MONTHS FREE SUPPORT & POST-SUPPORT TERMS ---
  drawSectionHeading(7, 'Three Months Free Support & Post-Support Terms');
  ensureSpace(70);
  const sup = snapshot.support_and_maintenance || {};
  const supText = [
    `1. Complimentary Support: A complimentary support period of ${sup.free_support_months ?? 3} months is provided commencing upon deployment/handover (${sup.support_start_date ? formatDate(sup.support_start_date) : 'commencement date'} to ${sup.support_end_date ? formatDate(sup.support_end_date) : '3 months thereafter'}).`,
    `2. Support Scope: Covers correction of reproducible software defects, bugs, and minor corrective alignments to the approved specification. Strictly excludes major new features, external third-party API deprecations, and unauthorized client modifications.`,
    `3. Post-Support Feature Development: After the free support period expires, new feature requests shall be billed at the standard rate of ${sup.post_support_feature_rate_formatted || '₹5,000.00'} per approved feature, subject to written scope confirmation and applicable GST.`,
    `4. Feature Request Distinction: Bug fixes restore intended functionality under approved specs. New modules, changed workflows, and additional integrations constitute paid feature enhancements.`,
  ];
  for (const st of supText) {
    y = drawText(st, MARGIN, y, 7.5, false, INK);
  }
  y -= 8;

  // --- SECTION 8: ONGOING MAINTENANCE ---
  drawSectionHeading(8, 'Monthly Maintenance Plan');
  ensureSpace(50);
  if (sup.maintenance_included) {
    const maintText = `The Client has elected ongoing application maintenance at the agreed rate of ${sup.maintenance_rate_formatted || '₹2,000.00'} per month (plus applicable GST). This covers periodic application health monitoring, compatible dependency updates, and basic operational troubleshooting. It excludes new feature development, domain renewal, and cloud hosting costs. Maintenance may be cancelled by either party upon thirty (30) days written notice.`;
    y = drawText(maintText, MARGIN, y, 7.5, false, INK);
  } else {
    const maintText = `Ongoing monthly maintenance is available at the standard rate of ₹2,000.00 per month (plus applicable GST) upon mutual written election. Maintenance is not automatically active and requires a separate written confirmation or maintenance addendum upon completion of the free support period.`;
    y = drawText(maintText, MARGIN, y, 7.5, false, MUTED);
  }
  y -= 8;

  // --- SECTION 9: STANDARD TERMS & CONDITIONS ---
  drawSectionHeading(9, 'Terms and Conditions');
  const clauses = snapshot.clauses || {};
  const termsList = [
    { title: 'Intellectual Property Ownership', content: clauses.section_11_intellectual_property },
    { title: 'Confidentiality & Data Protection', content: clauses.section_12_confidentiality },
    { title: 'Third-Party Services & Infrastructure', content: clauses.section_13_third_party_services },
    { title: 'Testing, Review & Acceptance', content: clauses.section_7_testing_acceptance },
    { title: 'Change Requests & Scope Modifications', content: clauses.section_6_change_requests },
    { title: 'Suspension & Termination', content: clauses.section_15_suspension_termination },
    { title: 'Limitation of Liability', content: clauses.section_16_limitation_liability },
    { title: 'Dispute Resolution & Governing Law', content: clauses.section_17_dispute_resolution },
  ];

  for (const term of termsList) {
    ensureSpace(45);
    y = drawText(term.title, MARGIN, y, 8, true, INK);
    y = drawText(term.content || '', MARGIN + 4, y, 7, false, INK);
    y -= 5;
  }
  y -= 8;

  // Special Terms if any
  if (snapshot.special_terms) {
    ensureSpace(35);
    y = drawText('Special Agreed Terms & Conditions:', MARGIN, y, 8, true, INK);
    y = drawText(snapshot.special_terms, MARGIN + 4, y, 7, false, INK);
    y -= 8;
  }

  // --- SECTION 10: ACCEPTANCE & SIGNATURES ---
  ensureSpace(160);
  drawSectionHeading(10, 'Acceptance & Execution');
  y = drawText(snapshot.clauses?.section_18_signatures || 'IN WITNESS WHEREOF, the Parties hereto have caused this Agreement to be duly executed by their authorized representatives as of the dates set forth below:', MARGIN, y, 7.5, false, INK);
  y -= 12;

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
  page.drawText(`Designation: ${snapshot.business?.signatory_title || 'Managing Partner'}`, { x: MARGIN + 10, y: y - 79, size: 7, font, color: MUTED });
  page.drawText('Date: ________________________', { x: MARGIN + 10, y: y - 90, size: 7, font, color: MUTED });

  // Client Signatory Block
  const cSigX = MARGIN + sigBoxW + 20;
  page.drawRectangle({
    x: cSigX, y: y - sigBoxH, width: sigBoxW, height: sigBoxH,
    borderWidth: 0.5, borderColor: LINE, color: rgb(1, 1, 1),
  });
  page.drawText('FOR CLIENT / CUSTOMER:', { x: cSigX + 10, y: y - 14, size: 7.5, font: bold, color: MUTED });
  page.drawLine({
    start: { x: cSigX + 10, y: y - 48 },
    end: { x: cSigX + sigBoxW - 10, y: y - 48 },
    thickness: 0.5,
    color: MUTED,
  });
  page.drawText('Authorized Client Signature', { x: cSigX + 10, y: y - 56, size: 6.5, font, color: MUTED });
  page.drawText(`Name: ${snapshot.client?.signatory_name || snapshot.client?.name || '—'}`, { x: cSigX + 10, y: y - 68, size: 7.5, font: bold, color: INK });
  page.drawText(`Designation: ${snapshot.client?.signatory_designation || 'Authorized Signatory'}`, { x: cSigX + 10, y: y - 79, size: 7, font, color: MUTED });
  page.drawText('Date: ________________________', { x: cSigX + 10, y: y - 90, size: 7, font, color: MUTED });

  y -= sigBoxH + 12;

  // Legal Notice
  page.drawText('Note: Generating or downloading this PDF document does not constitute formal execution or proof of signature. Both parties must execute this Agreement via verified signature before software development commencement.', {
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
    p.drawText(`Nextora Creations · Software Development Services Agreement · ${snapshot.contract_number}`, {
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
