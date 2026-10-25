import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFontBytes } from './pdf.js';
import { formatDate, formatMinor } from './words.js';

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT_WIDTH = A4.width - MARGIN * 2; // 515.28
const FOOTER_HEIGHT = 35;
const PAGE_CONTENT_BOTTOM = MARGIN + FOOTER_HEIGHT; // 75
const FRESH_PAGE_USABLE_HEIGHT = (A4.height - 42) - PAGE_CONTENT_BOTTOM; // 724.89

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

export async function renderSoftwareContractPdf(snapshot, { companyLogo = null, productLogo = null } = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const [regularBytes, boldBytes] = await Promise.all([
    readFontBytes('NotoSans-Regular.ttf'),
    readFontBytes('NotoSans-Bold.ttf'),
  ]);
  const font = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });

  const mode = snapshot.branding_mode || 'COMPANY_ONLY';
  const allowCompany = mode === 'BOTH' || mode === 'COMPANY_ONLY';
  const allowProduct = mode === 'BOTH' || mode === 'PRODUCT_ONLY';

  const companyLogoImg = allowCompany ? await embedImage(doc, companyLogo) : null;
  const productLogoImg = allowProduct ? await embedImage(doc, productLogo) : null;

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

  function remainingSpace() {
    return y - PAGE_CONTENT_BOTTOM;
  }

  function ensureSpace(neededHeight) {
    if (y - neededHeight < PAGE_CONTENT_BOTTOM) {
      addPage();
      drawRunningHeader();
    }
  }

  function measureTextHeight(value, size = 8.5, useBold = false, max = CONTENT_WIDTH) {
    const content = String(value ?? '');
    if (!content.trim()) return 0;
    const activeFont = useBold ? bold : font;
    const lines = wrapText(activeFont, content, size, max);
    return lines.length * (size + 3);
  }

  function drawText(value, x, top, size = 8.5, useBold = false, color = INK, max = CONTENT_WIDTH) {
    const content = String(value ?? '');
    if (!content.trim()) return top;
    const activeFont = useBold ? bold : font;
    for (const line of wrapText(activeFont, content, size, max)) {
      if (top - size < PAGE_CONTENT_BOTTOM) {
        addPage();
        drawRunningHeader();
        top = y;
      }
      page.drawText(line, { x, y: top - size, size, font: activeFont, color });
      top -= size + 3;
    }
    return top;
  }

  function drawSectionHeading(num, title, minContentHeight = 35) {
    // Total vertical drop for heading is 38 (10 margin-top + 28 bottom drop)
    ensureSpace(38 + minContentHeight);
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

  if (productLogoImg) {
    const scaledP = productLogoImg.scaleToFit(130, 32);
    page.drawImage(productLogoImg, {
      x: A4.width - MARGIN - scaledP.width,
      y: rTop - scaledP.height,
      width: scaledP.width,
      height: scaledP.height,
    });
    rTop -= (scaledP.height + 6);
  }

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
  const s1Intro = snapshot.clauses?.section_1_parties || '';
  const s1IntroHeight = measureTextHeight(s1Intro, 7.5, false, CONTENT_WIDTH);
  const cardH = 75;
  const s1TotalHeight = 38 + s1IntroHeight + 8 + cardH + 14;
  if (s1TotalHeight <= FRESH_PAGE_USABLE_HEIGHT && remainingSpace() < s1TotalHeight) {
    addPage();
    drawRunningHeader();
  }
  drawSectionHeading(1, 'Parties to the Agreement', s1IntroHeight + 8 + cardH);
  y = drawText(s1Intro, MARGIN, y, 7.5, false, INK);
  y -= 8;

  // Client and Developer Side-by-Side Cards
  const cardW = (CONTENT_WIDTH - 12) / 2;

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

  let s2DetailsHeight = 0;
  for (const line of projDetails) {
    s2DetailsHeight += measureTextHeight(`• ${line}`, 7.5, false, CONTENT_WIDTH - 4);
  }
  const s2TotalHeight = 38 + s2DetailsHeight + 6;
  const s2MinStartSpace = 38 + measureTextHeight(`• ${projDetails[0]}`, 7.5, false, CONTENT_WIDTH - 4) + measureTextHeight(`• ${projDetails[1]}`, 7.5, false, CONTENT_WIDTH - 4) + 6;

  if (s2TotalHeight <= FRESH_PAGE_USABLE_HEIGHT) {
    if (remainingSpace() < s2TotalHeight) {
      addPage();
      drawRunningHeader();
    }
  } else if (remainingSpace() < s2MinStartSpace) {
    addPage();
    drawRunningHeader();
  }

  drawSectionHeading(2, 'Project & Service Details', s2MinStartSpace - 38);
  for (const line of projDetails) {
    y = drawText(`• ${line}`, MARGIN + 4, y, 7.5, false, INK);
  }
  y -= 6;

  // --- SECTION 3: REQUIREMENTS & FEATURE SCOPE (SCHEDULE A) ---
  const s3Intro = 'The software solution includes the following agreed features, deliverables, and acceptance criteria. Features not approved in writing herein are excluded from scope.';
  const s3IntroH = measureTextHeight(s3Intro, 7.5, false, CONTENT_WIDTH) + 8;

  const fCols = [
    { name: 'S.No', w: 32, align: 'left' },
    { name: 'Feature Name', w: 105, align: 'left' },
    { name: 'Description', w: 130, align: 'left' },
    { name: 'Deliverables', w: 90, align: 'left' },
    { name: 'Priority', w: 45, align: 'center' },
    { name: 'Scope', w: 45, align: 'center' },
    { name: 'Notes / Criteria', w: 68, align: 'left' },
  ];

  const features = snapshot.scope?.features || [];
  const featureRowHeights = [];
  let s3TableHeight = 0;
  if (features.length) {
    s3TableHeight += 18; // Table Header
    features.forEach(f => {
      const nameLines = wrapText(bold, f.name || '—', 7, fCols[1].w - 8);
      const descLines = wrapText(font, f.description || '—', 6.5, fCols[2].w - 8);
      const delLines = wrapText(font, f.deliverables || '—', 6.5, fCols[3].w - 8);
      const notes = f.acceptance_criteria || f.notes || '—';
      const notesLines = wrapText(font, notes, 6.5, fCols[6].w - 8);
      const maxLines = Math.max(nameLines.length, descLines.length, delLines.length, notesLines.length, 1);
      const rH = Math.max(18, maxLines * 8.5 + 6);
      featureRowHeights.push(rH);
      s3TableHeight += rH;
    });
    s3TableHeight += 8;
  } else {
    s3TableHeight += measureTextHeight('Features and functional specification to be confirmed prior to execution.', 7.5, false, MUTED) + 8;
  }

  const scopeNotes = [
    snapshot.scope?.included_services ? `Included Services: ${snapshot.scope.included_services}` : null,
    snapshot.scope?.excluded_services ? `Excluded Services: ${snapshot.scope.excluded_services}` : null,
    snapshot.scope?.client_responsibilities ? `Client Responsibilities: ${snapshot.scope.client_responsibilities}` : null,
    snapshot.scope?.third_party_dependencies ? `Third-Party Dependencies: ${snapshot.scope.third_party_dependencies}` : null,
    snapshot.scope?.technical_assumptions ? `Technical Assumptions: ${snapshot.scope.technical_assumptions}` : null,
    snapshot.scope?.scope_limitations ? `Scope Limitations: ${snapshot.scope.scope_limitations}` : null,
  ].filter(Boolean);

  let s3ScopeNotesHeight = 0;
  if (scopeNotes.length) {
    for (const sn of scopeNotes) {
      s3ScopeNotesHeight += measureTextHeight(`• ${sn}`, 7.5, false, CONTENT_WIDTH - 4);
    }
    s3ScopeNotesHeight += 6;
  }

  const s3TotalHeight = 38 + s3IntroH + s3TableHeight + s3ScopeNotesHeight;
  const s3MinStartSpace = features.length >= 2
    ? 38 + s3IntroH + 18 + featureRowHeights[0] + featureRowHeights[1] + 8
    : Math.min(s3TotalHeight, 150);

  // Section 3 pagination rule:
  // If the complete section fits on a fresh page, start it on the next page rather than splitting it.
  // If larger than a fresh page, require at least s3MinStartSpace so multiple rows fit.
  if (s3TotalHeight <= FRESH_PAGE_USABLE_HEIGHT) {
    if (remainingSpace() < s3TotalHeight) {
      addPage();
      drawRunningHeader();
    }
  } else if (remainingSpace() < s3MinStartSpace) {
    addPage();
    drawRunningHeader();
  }

  drawSectionHeading(3, 'Requirements & Feature Scope (Schedule A)', s3IntroH + (features.length ? 18 + featureRowHeights[0] : 20));
  y = drawText(s3Intro, MARGIN, y, 7.5, false, MUTED);
  y -= 8;

  function drawFeatureTableHeader() {
    page.drawRectangle({
      x: MARGIN, y: y - 18, width: CONTENT_WIDTH, height: 18, color: TABLE_HEADER_BG,
    });
    let curX = MARGIN;
    fCols.forEach(col => {
      page.drawText(col.name, { x: curX + 4, y: y - 12, size: 7, font: bold, color: INK });
      curX += col.w;
    });
    y -= 18;
  }

  if (features.length) {
    drawFeatureTableHeader();

    features.forEach((f, idx) => {
      const sno = String(f.sno || idx + 1);
      const name = f.name || '—';
      const desc = f.description || '—';
      const del = f.deliverables || '—';
      const priority = f.priority || 'Normal';
      const scopeStatus = f.included === false ? 'Excluded' : 'Included';
      const notes = f.acceptance_criteria || f.notes || '—';

      const rowHeight = featureRowHeights[idx];

      // Repeat table header on continuation pages
      if (y - (rowHeight + 5) < PAGE_CONTENT_BOTTOM) {
        addPage();
        drawRunningHeader();
        drawFeatureTableHeader();
      }

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
      const nameLines = wrapText(bold, name, 7, fCols[1].w - 8);
      nameLines.forEach(l => {
        page.drawText(l, { x: cellX + 4, y: topY, size: 7, font: bold, color: INK });
        topY -= 8.5;
      });
      cellX += fCols[1].w;

      // Desc
      topY = y - 11;
      const descLines = wrapText(font, desc, 6.5, fCols[2].w - 8);
      descLines.forEach(l => {
        page.drawText(l, { x: cellX + 4, y: topY, size: 6.5, font, color: INK });
        topY -= 8;
      });
      cellX += fCols[2].w;

      // Deliverables
      topY = y - 11;
      const delLines = wrapText(font, del, 6.5, fCols[3].w - 8);
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
      const notesLines = wrapText(font, notes, 6.5, fCols[6].w - 8);
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

  // Scope Notes
  if (scopeNotes.length) {
    if (s3ScopeNotesHeight <= FRESH_PAGE_USABLE_HEIGHT && remainingSpace() < s3ScopeNotesHeight) {
      addPage();
      drawRunningHeader();
    }
    for (const sn of scopeNotes) {
      y = drawText(`• ${sn}`, MARGIN + 4, y, 7.5, false, INK);
    }
    y -= 6;
  }

  // --- SECTION 4: PROJECT PRICING & GST BREAKDOWN ---
  const fin = snapshot.financials || {};
  const finBoxW = CONTENT_WIDTH;
  const finBoxH = 110;
  const s4TotalHeight = 38 + finBoxH + 12;

  // Always keep Section 4 heading and financial breakdown box together
  if (remainingSpace() < s4TotalHeight) {
    addPage();
    drawRunningHeader();
  }
  drawSectionHeading(4, 'Project Pricing & GST Calculations', finBoxH + 12);

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
  const milestones = snapshot.milestones?.payment_milestones || [];
  const mCols = [
    { name: 'S.No', w: 32 },
    { name: 'Milestone Name', w: 140 },
    { name: 'Trigger Event / Deliverable', w: 175 },
    { name: 'Due Date', w: 75 },
    { name: 'Amount (₹)', w: 93 },
  ];
  const milestoneRowHeights = [];
  let s5TableHeight = 0;
  if (milestones.length) {
    s5TableHeight += 18; // Table header
    milestones.forEach((m, idx) => {
      const nameLines = wrapText(bold, m.name || `Milestone ${idx + 1}`, 7, mCols[1].w - 8);
      const trigLines = wrapText(font, m.trigger || 'Upon deliverable completion', 6.5, mCols[2].w - 8);
      const maxLines = Math.max(nameLines.length, trigLines.length, 1);
      const rH = Math.max(18, maxLines * 8.5 + 6);
      milestoneRowHeights.push(rH);
      s5TableHeight += rH;
    });
    s5TableHeight += 8;
  } else {
    s5TableHeight += measureTextHeight('Remaining balance payable upon satisfactory delivery and deployment acceptance.', 7.5) + 8;
  }
  const s5TotalHeight = 38 + s5TableHeight;
  const s5MinStartSpace = milestones.length
    ? 38 + 18 + (milestoneRowHeights[0] || 18) + (milestoneRowHeights[1] || 18) + 8
    : s5TotalHeight;

  if (s5TotalHeight <= FRESH_PAGE_USABLE_HEIGHT) {
    if (remainingSpace() < s5TotalHeight) {
      addPage();
      drawRunningHeader();
    }
  } else if (remainingSpace() < s5MinStartSpace) {
    addPage();
    drawRunningHeader();
  }

  drawSectionHeading(5, 'Payment Terms & Milestones', s5MinStartSpace - 38);

  function drawMilestoneTableHeader() {
    page.drawRectangle({
      x: MARGIN, y: y - 18, width: CONTENT_WIDTH, height: 18, color: TABLE_HEADER_BG,
    });
    let curX = MARGIN;
    mCols.forEach(col => {
      page.drawText(col.name, { x: curX + 4, y: y - 12, size: 7, font: bold, color: INK });
      curX += col.w;
    });
    y -= 18;
  }

  if (milestones.length) {
    drawMilestoneTableHeader();

    milestones.forEach((m, idx) => {
      const mRowH = milestoneRowHeights[idx];
      // Repeat header on continuation pages
      if (y - (mRowH + 5) < PAGE_CONTENT_BOTTOM) {
        addPage();
        drawRunningHeader();
        drawMilestoneTableHeader();
      }

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

      let cellX = MARGIN;
      // S.No
      page.drawText(String(idx + 1), { x: cellX + 4, y: y - 12, size: 7, font, color: INK });
      cellX += mCols[0].w;

      // Milestone Name (wrapped cleanly)
      const nameLines = wrapText(bold, m.name || `Milestone ${idx + 1}`, 7, mCols[1].w - 8);
      let topY = y - 11;
      nameLines.forEach(l => {
        page.drawText(l, { x: cellX + 4, y: topY, size: 7, font: bold, color: INK });
        topY -= 8.5;
      });
      cellX += mCols[1].w;

      // Trigger / Deliverable (wrapped cleanly)
      const trigLines = wrapText(font, m.trigger || 'Upon deliverable completion', 6.5, mCols[2].w - 8);
      topY = y - 11;
      trigLines.forEach(l => {
        page.drawText(l, { x: cellX + 4, y: topY, size: 6.5, font, color: INK });
        topY -= 8;
      });
      cellX += mCols[2].w;

      // Due Date
      page.drawText(m.due_date ? formatDate(m.due_date) : 'On Acceptance', { x: cellX + 4, y: y - 12, size: 6.5, font, color: MUTED });
      cellX += mCols[3].w;

      // Amount
      const amtStr = formatMinor(m.amount_minor || 0);
      page.drawText(amtStr, { x: cellX + 4, y: y - 12, size: 7.5, font: bold, color: INK });

      y -= mRowH;
    });
  } else {
    y = drawText('Remaining balance payable upon satisfactory delivery and deployment acceptance.', MARGIN, y, 7.5, false, MUTED);
  }
  y -= 8;

  // --- SECTION 6: DEVELOPMENT SCHEDULE & TIMELINE ---
  const timeText = `The estimated project timeline is ${snapshot.project?.development_duration || 'approximately 1 month'}, commencing upon execution of this Agreement, receipt of the agreed 10% advance, and full delivery of client assets, credentials, and requirements sign-off. Delays in client feedback or dependencies shall extend the delivery date proportionally.`;
  const s6Height = 38 + measureTextHeight(timeText, 7.5) + 8;
  if (remainingSpace() < s6Height) {
    addPage();
    drawRunningHeader();
  }
  drawSectionHeading(6, 'Development Timeline', s6Height - 38);
  y = drawText(timeText, MARGIN, y, 7.5, false, INK);
  y -= 8;

  // --- SECTION 7: THREE MONTHS FREE SUPPORT & POST-SUPPORT TERMS ---
  const sup = snapshot.support_and_maintenance || {};
  const supText = [
    `1. Complimentary Support: A complimentary support period of ${sup.free_support_months ?? 3} months is provided commencing upon deployment/handover (${sup.support_start_date ? formatDate(sup.support_start_date) : 'commencement date'} to ${sup.support_end_date ? formatDate(sup.support_end_date) : '3 months thereafter'}).`,
    `2. Support Scope: Covers correction of reproducible software defects, bugs, and minor corrective alignments to the approved specification. Strictly excludes major new features, external third-party API deprecations, and unauthorized client modifications.`,
    `3. Post-Support Feature Development: After the free support period expires, new feature requests shall be billed at the standard rate of ${sup.post_support_feature_rate_formatted || '₹5,000.00'} per approved feature, subject to written scope confirmation and applicable GST.`,
    `4. Feature Request Distinction: Bug fixes restore intended functionality under approved specs. New modules, changed workflows, and additional integrations constitute paid feature enhancements.`,
  ];
  let s7TextHeight = 0;
  for (const st of supText) {
    s7TextHeight += measureTextHeight(st, 7.5);
  }
  const s7TotalHeight = 38 + s7TextHeight + 8;
  const s7MinStartSpace = 38 + measureTextHeight(supText[0], 7.5) + measureTextHeight(supText[1], 7.5) + 8;

  if (s7TotalHeight <= FRESH_PAGE_USABLE_HEIGHT) {
    if (remainingSpace() < s7TotalHeight) {
      addPage();
      drawRunningHeader();
    }
  } else if (remainingSpace() < s7MinStartSpace) {
    addPage();
    drawRunningHeader();
  }

  drawSectionHeading(7, 'Three Months Free Support & Post-Support Terms', s7MinStartSpace - 38);
  for (const st of supText) {
    y = drawText(st, MARGIN, y, 7.5, false, INK);
  }
  y -= 8;

  // --- SECTION 8: ONGOING MAINTENANCE ---
  const maintText = sup.maintenance_included
    ? `The Client has elected ongoing application maintenance at the agreed rate of ${sup.maintenance_rate_formatted || '₹2,000.00'} per month (plus applicable GST). This covers periodic application health monitoring, compatible dependency updates, and basic operational troubleshooting. It excludes new feature development, domain renewal, and cloud hosting costs. Maintenance may be cancelled by either party upon thirty (30) days written notice.`
    : `Ongoing monthly maintenance is available at the standard rate of ₹2,000.00 per month (plus applicable GST) upon mutual written election. Maintenance is not automatically active and requires a separate written confirmation or maintenance addendum upon completion of the free support period.`;

  const s8TotalHeight = 38 + measureTextHeight(maintText, 7.5) + 8;
  // Always keep Section 8 heading and explanatory text together!
  if (remainingSpace() < s8TotalHeight) {
    addPage();
    drawRunningHeader();
  }
  drawSectionHeading(8, 'Monthly Maintenance Plan', s8TotalHeight - 38);
  y = drawText(maintText, MARGIN, y, 7.5, false, sup.maintenance_included ? INK : MUTED);
  y -= 8;

  // --- SECTION 9: STANDARD TERMS & CONDITIONS ---
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

  const firstTermTitleH = measureTextHeight(termsList[0].title, 8, true);
  const firstTermMinH = 38 + firstTermTitleH + 25;
  if (remainingSpace() < firstTermMinH) {
    addPage();
    drawRunningHeader();
  }
  drawSectionHeading(9, 'Terms and Conditions', firstTermMinH - 38);

  for (const term of termsList) {
    const titleH = measureTextHeight(term.title, 8, true);
    const contentH = measureTextHeight(term.content || '', 7, false, CONTENT_WIDTH - 4);
    const fullTermH = titleH + contentH + 5;

    // Keep individual clause intact if it can fit on a fresh page
    if (fullTermH <= FRESH_PAGE_USABLE_HEIGHT) {
      if (remainingSpace() < fullTermH) {
        addPage();
        drawRunningHeader();
      }
    } else if (remainingSpace() < titleH + 30) {
      addPage();
      drawRunningHeader();
    }

    y = drawText(term.title, MARGIN, y, 8, true, INK);
    y = drawText(term.content || '', MARGIN + 4, y, 7, false, INK);
    y -= 5;
  }
  y -= 8;

  // Special Terms if any
  if (snapshot.special_terms?.trim()) {
    const spTitleH = measureTextHeight('Special Agreed Terms & Conditions:', 8, true);
    const spContentH = measureTextHeight(snapshot.special_terms, 7, false, CONTENT_WIDTH - 4);
    const spTotalH = spTitleH + spContentH + 8;
    if (spTotalH <= FRESH_PAGE_USABLE_HEIGHT && remainingSpace() < spTotalH) {
      addPage();
      drawRunningHeader();
    } else if (remainingSpace() < spTitleH + 30) {
      addPage();
      drawRunningHeader();
    }
    y = drawText('Special Agreed Terms & Conditions:', MARGIN, y, 8, true, INK);
    y = drawText(snapshot.special_terms, MARGIN + 4, y, 7, false, INK);
    y -= 8;
  }

  // --- SECTION 10: ACCEPTANCE & SIGNATURES ---
  const sigIntro = snapshot.clauses?.section_18_signatures || 'IN WITNESS WHEREOF, the Parties hereto have caused this Software Development Services Agreement to be duly executed by their authorized representatives as of the date(s) set forth below. Each signatory warrants that they possess full power and legal authority to bind their respective organization.\nGenerating or downloading this document in draft form does not constitute an executed contract; both Parties must formally sign to execute this Agreement.';
  const sigIntroH = measureTextHeight(sigIntro, 7.5, false, CONTENT_WIDTH);
  const sigBoxH = 95;
  const legalNoteH = measureTextHeight('Note: Generating or downloading this PDF document does not constitute formal execution or proof of signature. Both parties must execute this Agreement via verified signature before software development commencement.', 6, false, CONTENT_WIDTH);
  const s10TotalHeight = 38 + sigIntroH + 12 + sigBoxH + 12 + legalNoteH + 8;

  // Keep entire Section 10 together (heading + intro + both signature boxes + note)
  if (remainingSpace() < s10TotalHeight) {
    addPage();
    drawRunningHeader();
  }
  drawSectionHeading(10, 'Acceptance & Execution', s10TotalHeight - 38);
  y = drawText(sigIntro, MARGIN, y, 7.5, false, INK);
  y -= 12;

  const sigBoxW = (CONTENT_WIDTH - 20) / 2;

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
