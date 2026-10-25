import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { formulaLabel } from './pdf-labels.js';
import { formatDate, formatMinor } from './words.js';
import { rateLabel, supplyTypeLabel, treatmentLabel } from './gst.js';
import { stateName } from './states.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 36;
const CONTENT_WIDTH = A4.width - MARGIN * 2; // 523.28
const FOOTER_HEIGHT = 30;
const INK = rgb(0.067, 0.067, 0.067);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.925, 0.925, 0.925);
const SOFT = rgb(0.973, 0.976, 0.98);

const COLUMNS = [
  { key: 'index', label: '#', width: 20, align: 'left' },
  { key: 'description', label: 'DESCRIPTION', width: 185, align: 'left' },
  { key: 'quantity', label: 'QTY', width: 45, align: 'right' },
  { key: 'rate', label: 'RATE', width: 58, align: 'right' },
  { key: 'discount', label: 'DISC', width: 46, align: 'right' },
  { key: 'taxable', label: 'TAXABLE', width: 62, align: 'right' },
  { key: 'tax', label: 'GST', width: 52, align: 'right' },
  { key: 'total', label: 'AMOUNT', width: 55, align: 'right' },
];

const COLUMN_OFFSETS = COLUMNS.reduce((acc, col, i) => {
  acc.push(i === 0 ? MARGIN : acc[i - 1] + COLUMNS[i - 1].width);
  return acc;
}, []);

/**
 * Robust candidate path resolver for font assets across all execution contexts:
 * - Local development (`node scripts/test.js`, `vite`, `node scripts/dev.js`)
 * - Electron development (`electron .`)
 * - Packaged ASAR (`app.asar/server/assets/`)
 * - Unpacked ASAR (`app.asar.unpacked/server/assets/`)
 * - Standalone Electron resource (`process.resourcesPath`)
 */
export function resolveFontPath(fontName) {
  const candidates = [
    // 1. Direct module-relative path (works in dev and within app.asar)
    join(__dirname, 'assets', fontName),
    // 2. Unpacked ASAR path (when asarUnpack is used in electron-builder)
    join(__dirname.replace(/app\.asar$/, 'app.asar.unpacked').replace(/app\.asar[\\/]/, 'app.asar.unpacked' + (process.platform === 'win32' ? '\\' : '/')), 'assets', fontName),
    // 3. process.resourcesPath (Electron packaged runtime external resources)
    typeof process !== 'undefined' && process.resourcesPath ? join(process.resourcesPath, 'assets', fontName) : null,
    typeof process !== 'undefined' && process.resourcesPath ? join(process.resourcesPath, 'server', 'assets', fontName) : null,
    typeof process !== 'undefined' && process.resourcesPath ? join(process.resourcesPath, 'app.asar.unpacked', 'server', 'assets', fontName) : null,
    // 4. Working directory fallbacks
    resolve(process.cwd(), 'server', 'assets', fontName),
    resolve(process.cwd(), 'assets', fontName),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        const stat = statSync(candidate);
        if (stat.isFile() && stat.size > 0) {
          return candidate;
        }
      }
    } catch {
      // Continue checking next candidate
    }
  }

  // If no candidate was found with existsSync (e.g. strict virtual asar), return primary module path
  return join(__dirname, 'assets', fontName);
}

const fontCache = new Map();

export async function readFontBytes(fontName) {
  if (fontCache.has(fontName)) {
    return fontCache.get(fontName);
  }
  const resolvedPath = resolveFontPath(fontName);
  try {
    const bytes = await readFile(resolvedPath);
    if (!bytes || bytes.length === 0) {
      throw new Error(`Font file ${fontName} is empty at ${resolvedPath}`);
    }
    fontCache.set(fontName, bytes);
    return bytes;
  } catch (err) {
    // Attempt fallback to direct module URL in case fs.existsSync behaves differently
    try {
      const fallbackUrl = new URL(`./assets/${fontName}`, import.meta.url);
      const bytes = await readFile(fileURLToPath(fallbackUrl));
      if (bytes && bytes.length > 0) {
        fontCache.set(fontName, bytes);
        return bytes;
      }
    } catch {
      // Fall through to throw original error with diagnostic context
    }
    const error = new Error(`Required font asset "${fontName}" could not be loaded: ${err.message} (resolved path: ${resolvedPath})`);
    error.code = 'FONT_NOT_FOUND';
    error.status = 500;
    throw error;
  }
}

async function fontBytes() {
  const [regular, bold] = await Promise.all([
    readFontBytes('NotoSans-Regular.ttf'),
    readFontBytes('NotoSans-Bold.ttf'),
  ]);
  return [regular, bold];
}

function hexToRgb(hex) {
  const value = /^#[0-9A-Fa-f]{6}$/.test(hex || '') ? hex : '#00AEEF';
  return rgb(parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255);
}

/** Manual word wrapping so long descriptions never clip or overflow a column. */
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
      // A single word longer than the column is broken across lines rather than clipped.
      let chunk = '';
      for (const character of word) {
        if (font.widthOfTextAtSize(chunk + character, size) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = character;
        } else chunk += character;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

function fit(font, text, size, maxWidth) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return size;
  return Math.max(4, size * maxWidth / font.widthOfTextAtSize(text, size));
}

export async function renderDocument(snapshot, { logoPng = null, preview = false } = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await fontBytes();
  const font = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  const accent = hexToRgb(snapshot.business?.pdf_accent_color);
  const supported = new Set(font.getCharacterSet());
  const rupee = supported.has(0x20b9) ? '₹' : 'Rs. ';
  const showMinor = supported.has(0x20b9);
  const money = minor => {
    const value = formatMinor(minor, { symbol: rupee });
    return showMinor ? value : value.replace(/\s+/, ' ');
  };
  const business = snapshot.business || {};
  const client = snapshot.client || {};
  const details = snapshot.document || {};
  const totals = snapshot.totals || {};
  const labels = formulaLabel(snapshot.kind);

  const pages = [];
  let page;
  let y;

  const isShort = snapshot.kind === 'PAYMENT_RECEIPT';

  function startPage() {
    page = doc.addPage([A4.width, A4.height]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: A4.height - 20, width: A4.width, height: 20, color: accent });
    y = A4.height - MARGIN - 12;
    return page;
  }

  function text(value, x, top, size = 8, useBold = false, color = INK, max = CONTENT_WIDTH) {
    const content = String(value ?? '');
    if (!content.trim()) return top;
    const activeFont = useBold ? bold : font;
    for (const line of wrapText(activeFont, content, size, max)) {
      page.drawText(line, { x, y: top - size, size, font: activeFont, color });
      top -= size + 2.4;
    }
    return top;
  }

  function rightAligned(value, right, top, size = 8, useBold = false, color = INK) {
    const activeFont = useBold ? bold : font;
    const content = String(value ?? '');
    const size2 = fit(activeFont, content, size, CONTENT_WIDTH / 2);
    page.drawText(content, { x: right - activeFont.widthOfTextAtSize(content, size2), y: top - size2, size: size2, font: activeFont, color });
    return top - size2 - 2.4;
  }

  function ensure(space) {
    if (y - space < MARGIN + FOOTER_HEIGHT) startPage();
  }

  function drawSectionTitle(title) {
    ensure(22);
    y -= 12;
    page.drawText(String(title).toUpperCase(), { x: MARGIN, y, size: 7, font: bold, color: MUTED });
    y -= 4;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, thickness: 0.5, color: LINE });
    y -= 10;
  }

  function keyValues(entries) {
    for (const [label, value] of entries) {
      if (!value) continue;
      ensure(12);
      page.drawText(String(label).toUpperCase(), { x: MARGIN, y: y - 8, size: 6.5, font: bold, color: MUTED });
      const content = String(value);
      const size = fit(font, content, 8, CONTENT_WIDTH - 110);
      page.drawText(content, { x: MARGIN + 110, y: y - 8, size, font, color: INK });
      y -= 12;
    }
  }

  /* ------------------------------------------------------------- letterhead */

  startPage();
  const headerTop = y;
  if (logoPng) {
    try {
      const logo = await doc.embedPng(logoPng);
      const scaled = logo.scaleToFit(120, 42);
      page.drawImage(logo, { x: MARGIN, y: headerTop - scaled.height, ...scaled });
    } catch { /* an unreadable logo must not block an invoice */ }
  } else {
    page.drawText(business.business_name || 'Nextora Creations', { x: MARGIN, y: headerTop - 16, size: 14, font: bold, color: INK });
  }
  const rightEdge = MARGIN + CONTENT_WIDTH;
  let headerY = headerTop;
  for (const [value, size, useBold, color] of [
    [business.business_name || 'Nextora Creations', 13, true, INK],
    ...(business.legal_name ? [[business.legal_name, 7.5, false, MUTED]] : []),
    ...String(business.address || '').split('\n').map(line => [line, 7.5, false, MUTED]),
    [[business.email, business.phone].filter(Boolean).join('  |  '), 7.5, false, MUTED],
    [business.website, 7.5, false, MUTED],
    [[business.gstin ? `GSTIN: ${business.gstin}` : '', business.pan ? `PAN: ${business.pan}` : '',
      business.state_code ? `State code: ${business.state_code}` : ''].filter(Boolean).join('   '), 7.5, false, INK],
  ]) {
    if (!String(value || '').trim()) continue;
    headerY = rightAligned(value, rightEdge, headerY, size, useBold, color);
  }
  y = Math.min(headerTop - 54, headerY - 8);
  page.drawLine({ start: { x: MARGIN, y }, end: { x: rightEdge, y }, thickness: 0.8, color: LINE });
  y -= 18;

  /* ------------------------------------------------------------- doc header */

  page.drawText(labels.title, { x: MARGIN, y: y - 18, size: 19, font: bold, color: INK });
  page.drawText(labels.subtitle, { x: MARGIN, y: y - 30, size: 7.5, font, color: MUTED });
  page.drawText(snapshot.number ? String(snapshot.number) : 'DRAFT - not yet numbered', {
    x: MARGIN, y: y - 44, size: 10, font: bold, color: snapshot.number ? accent : MUTED,
  });
  let metaY = y - 2;
  const metaRight = rightEdge;
  for (const [label, value] of labels.meta(details, snapshot)) {
    page.drawText(`${label}`, { x: metaRight - 210, y: metaY - 8, size: 7, font, color: MUTED });
    metaY = rightAligned(value, metaRight, metaY, 8.5, true, INK) - 3;
  }
  y -= 58;

  /* -------------------------------------------------------- parties + supply */

  const half = CONTENT_WIDTH / 2 - 10;
  const billTop = y;
  page.drawText(labels.partyLabel.toUpperCase(), { x: MARGIN, y: y - 8, size: 7, font: bold, color: MUTED });
  let leftY = text(client.name || '', MARGIN, y - 12, 9.5, true, INK, half);
  leftY = text(client.company_name && client.company_name !== client.name ? client.company_name : '', MARGIN, leftY, 8, false, INK, half);
  leftY = text(client.contact_person ? `Attn: ${client.contact_person}` : '', MARGIN, leftY, 7.5, false, MUTED, half);
  leftY = text(client.billing_address || '', MARGIN, leftY, 7.5, false, INK, half);
  leftY = text([client.email, client.phone].filter(Boolean).join('  |  '), MARGIN, leftY, 7.5, false, MUTED, half);
  leftY = text(client.gstin ? `GSTIN: ${client.gstin}` : (client.country && client.country !== 'India' ? `Country: ${client.country}` : ''), MARGIN, leftY, 7.5, true, INK, half);

  const supplyRight = rightEdge;
  page.drawText(labels.supplyLabel.toUpperCase(), { x: rightEdge - half, y: y - 8, size: 7, font: bold, color: MUTED });
  let rightY;
  if (isShort) {
    // A receipt is not itself a supply: it identifies the invoice it settles.
    rightY = rightAligned(`Invoice: ${snapshot.invoice?.number || 'Not linked'}`, supplyRight, y - 12, 8, true, INK);
    rightY = rightAligned(`Invoice date: ${displayDate(snapshot.invoice?.issue_date)}`, supplyRight, rightY, 7.5, false, MUTED);
    if (snapshot.invoice?.due_date) rightY = rightAligned(`Invoice due: ${displayDate(snapshot.invoice.due_date)}`, supplyRight, rightY, 7.5, false, MUTED);
    rightY = rightAligned(`Invoice total: ${money(snapshot.invoice?.grand_total_minor || 0)}`, supplyRight, rightY, 7.5, false, INK);
  } else {
    rightY = rightAligned(supplyTypeLabel(details.supply_type), supplyRight, y - 12, 8, false, INK);
    if (details.place_of_supply_state_code) {
      rightY = rightAligned(`Place of supply: ${stateLabel(details.place_of_supply_state_code)}`, supplyRight, rightY, 7.5, false, MUTED);
    }
    rightY = rightAligned(details.project_reference ? `Project: ${details.project_reference}` : '', supplyRight, rightY, 7.5, false, MUTED);
    rightY = rightAligned(details.po_reference ? `PO: ${details.po_reference}` : '', supplyRight, rightY, 7.5, false, MUTED);
    if (snapshot.kind === 'QUOTATION' && details.expiry_date) {
      rightY = rightAligned(`Valid until: ${displayDate(details.expiry_date)}`, supplyRight, rightY, 7.5, false, INK);
    }
    if (business.reverse_charge) rightY = rightAligned('Reverse charge: Yes', supplyRight, rightY, 7.5, false, INK);
  }

  y = Math.min(leftY, rightY) - 12;

  if (isShort) {
    drawReceiptBody();
  } else {
    drawItemsTable();
    drawTaxSummary();
    drawTotals();
    drawNotes();
  }

  drawPaymentAndSignature();
  drawFooters();

  doc.setTitle(`${labels.title} ${snapshot.number || 'draft'}`);
  doc.setAuthor(business.business_name || 'Nextora Creations');
  doc.setSubject(snapshot.number || 'Draft document');
  doc.setProducer('Nextora Creations Invoicing');
  if (preview) doc.setCreationDate(new Date());
  return Buffer.from(await doc.save());

  /* ----------------------------------------------------------- sub-renders */

  function drawItemsTable() {
    const headerHeight = 16;
    const drawHeader = top => {
      page.drawRectangle({ x: MARGIN, y: top - headerHeight, width: CONTENT_WIDTH, height: headerHeight, color: SOFT });
      for (let i = 0; i < COLUMNS.length; i++) {
        const column = COLUMNS[i];
        const colLeft = COLUMN_OFFSETS[i];
        const labelWidth = bold.widthOfTextAtSize(column.label, 6.5);
        const headerX = column.align === 'right' ? colLeft + column.width - labelWidth - 4 : colLeft + 4;
        page.drawText(column.label, { x: headerX, y: top - 11, size: 6.5, font: bold, color: MUTED });
      }
      return top - headerHeight;
    };
    ensure(headerHeight + 30);
    y = drawHeader(y);

    const lines = snapshot.lines || [];
    lines.forEach((line, index) => {
      const descriptionLines = wrapText(font, line.description || '', 7.5, COLUMNS[1].width - 10);
      const meta = [line.hsn_sac ? `HSN/SAC ${line.hsn_sac}` : '', line.tax_treatment !== 'TAXABLE' ? treatmentLabel(line.tax_treatment) : '']
        .filter(Boolean).join('  ·  ');
      const metaLines = meta ? wrapText(font, meta, 6, COLUMNS[1].width - 10) : [];
      const rowHeight = Math.max(15, descriptionLines.length * 8 + 6 + metaLines.length * 7);
      if (y - rowHeight < MARGIN + FOOTER_HEIGHT) {
        startPage();
        y = drawHeader(y);
      }
      const top = y;
      if (index % 2 === 1) {
        page.drawRectangle({ x: MARGIN, y: top - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: SOFT });
      }
      const cell = (columnIndex, value, useBold = false, color = INK) => {
        const column = COLUMNS[columnIndex];
        const colLeft = COLUMN_OFFSETS[columnIndex];
        const useFont = useBold ? bold : font;
        const strVal = String(value ?? '');
        const size = fit(useFont, strVal, 7.5, column.width - 8);
        const textWidth = useFont.widthOfTextAtSize(strVal, size);
        const textX = column.align === 'right'
          ? colLeft + column.width - textWidth - 4
          : colLeft + 4;
        page.drawText(strVal, {
          x: textX,
          y: top - 10,
          size,
          font: useFont,
          color,
        });
      };
      cell(0, String(index + 1), false, MUTED);
      let descriptionY = top - 4;
      for (const lineText of descriptionLines) {
        page.drawText(lineText, { x: COLUMN_OFFSETS[1] + 4, y: descriptionY - 7, size: 7.5, font, color: INK });
        descriptionY -= 8;
      }
      for (const metaLine of metaLines) {
        page.drawText(metaLine, { x: COLUMN_OFFSETS[1] + 4, y: descriptionY - 6, size: 6, font, color: MUTED });
        descriptionY -= 7;
      }
      cell(2, formatQuantity(line.quantity_milli, line.unit));
      cell(3, money(line.unit_price_minor));
      cell(4, (line.item_discount_minor || 0) + (line.invoice_discount_minor || 0) > 0
        ? money((line.item_discount_minor || 0) + (line.invoice_discount_minor || 0)) : '-');
      cell(5, money(line.taxable_minor));
      cell(6, line.tax_minor > 0 ? `${rateLabel(line.tax_rate_bp)} ${money(line.tax_minor)}` : '-');
      cell(7, money(line.total_minor), true);
      page.drawLine({ start: { x: MARGIN, y: top - rowHeight }, end: { x: MARGIN + CONTENT_WIDTH, y: top - rowHeight }, thickness: 0.4, color: LINE });
      y = top - rowHeight;
    });

    for (const charge of snapshot.charges || []) {
      ensure(15);
      const top = y;
      page.drawText(charge.label, { x: COLUMN_OFFSETS[1] + 4, y: top - 10, size: 7.5, font, color: INK });
      const qtyStr = formatQuantity(1000, '');
      page.drawText(qtyStr, { x: COLUMN_OFFSETS[2] + COLUMNS[2].width - font.widthOfTextAtSize(qtyStr, 7.5) - 4, y: top - 10, size: 7.5, font, color: MUTED });
      const amtStr = money(charge.amount_minor);
      page.drawText(amtStr, { x: COLUMN_OFFSETS[3] + COLUMNS[3].width - font.widthOfTextAtSize(amtStr, 7.5) - 4, y: top - 10, size: 7.5, font, color: INK });
      const taxLabel = charge.tax_minor > 0 ? `${rateLabel(charge.tax_rate_bp)} ${money(charge.tax_minor)}` : treatmentLabel(charge.tax_treatment);
      page.drawText(taxLabel, { x: COLUMN_OFFSETS[6] + COLUMNS[6].width - font.widthOfTextAtSize(taxLabel, 7.5) - 4, y: top - 10, size: 7.5, font, color: MUTED });
      const totalStr = money(charge.total_minor);
      page.drawText(totalStr, { x: COLUMN_OFFSETS[7] + COLUMNS[7].width - bold.widthOfTextAtSize(totalStr, 7.5) - 4, y: top - 10, size: 7.5, font: bold, color: INK });
      y = top - 15;
    }
    y -= 4;
  }

  function drawTaxSummary() {
    const taxable = totals.taxable_total_minor || 0;
    const tax = totals.tax_total_minor || 0;
    if (!tax) return;
    drawSectionTitle('Tax summary');
    const groups = new Map();
    for (const line of [...(snapshot.lines || []), ...(snapshot.charges || [])]) {
      if (!line.tax_minor) continue;
      const key = `${line.tax_rate_bp}|${line.hsn_sac || ''}`;
      const current = groups.get(key) || { rate: line.tax_rate_bp, hsn: line.hsn_sac || '', taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      current.taxable += line.taxable_minor ?? line.amount_minor ?? 0;
      current.cgst += line.cgst_minor;
      current.sgst += line.sgst_minor;
      current.igst += line.igst_minor;
      groups.set(key, current);
    }
    const summaryCols = [210, 90, 70, 70, 83];
    const positions = summaryCols.reduce((acc, width, index) => {
      acc.push(index === 0 ? MARGIN : acc[index - 1] + summaryCols[index - 1]);
      return acc;
    }, []);
    const headers = ['HSN/SAC · Rate', 'Taxable value', 'CGST', 'SGST', 'IGST'];
    headers.forEach((header, index) => {
      page.drawText(header, { x: positions[index] + (index === 0 ? 0 : summaryCols[index] - bold.widthOfTextAtSize(header, 6.5) - 4),
        y: y - 8, size: 6.5, font: bold, color: MUTED });
    });
    y -= 13;
    for (const group of groups.values()) {
      ensure(13);
      const row = [`${group.hsn || '-'} · ${rateLabel(group.rate)}`, money(group.taxable),
        group.cgst ? money(group.cgst) : '-', group.sgst ? money(group.sgst) : '-', group.igst ? money(group.igst) : '-'];
      row.forEach((value, index) => {
        page.drawText(value, { x: positions[index] + (index === 0 ? 0 : summaryCols[index] - font.widthOfTextAtSize(value, 7) - 4),
          y: y - 8, size: 7, font, color: INK });
      });
      y -= 12;
    }
    ensure(13);
    const totalRow = [`Total (taxable value ${money(taxable)})`, '', money((totals.cgst_total_minor || 0) || 0),
      money((totals.sgst_total_minor || 0) || 0), money((totals.igst_total_minor || 0) || 0)];
    totalRow.forEach((value, index) => {
      if (index === 2 && !totals.cgst_total_minor) value = '-';
      if (index === 3 && !totals.sgst_total_minor) value = '-';
      if (index === 4 && !totals.igst_total_minor) value = '-';
      page.drawText(value, { x: positions[index] + (index === 0 ? 0 : summaryCols[index] - bold.widthOfTextAtSize(value, 7) - 4),
        y: y - 8, size: 7, font: bold, color: INK });
    });
    y -= 14;
  }

  function drawTotals() {
    const rows = labels.totals(totals, money);
    const boxWidth = 240;
    const boxHeight = rows.length * 12 + 12;
    ensure(boxHeight + 46);
    const top = y - 4;
    page.drawRectangle({ x: MARGIN + CONTENT_WIDTH - boxWidth, y: top - boxHeight, width: boxWidth, height: boxHeight, color: SOFT });
    let rowY = top - 6;
    for (const [label, value, emphasise] of rows) {
      const useFont = emphasise ? bold : font;
      const size = emphasise ? 9.5 : 8;
      page.drawText(label, { x: MARGIN + CONTENT_WIDTH - boxWidth + 10, y: rowY - size, size, font: useFont, color: emphasise ? INK : MUTED });
      const content = String(value);
      page.drawText(content, { x: MARGIN + CONTENT_WIDTH - 10 - useFont.widthOfTextAtSize(content, size), y: rowY - size, size, font: useFont, color: INK });
      rowY -= emphasise ? 16 : 12;
    }
    y = top - boxHeight - 8;
    if (business.show_amount_in_words !== false && totals.amount_in_words) {
      ensure(24);
      page.drawText('AMOUNT IN WORDS', { x: MARGIN, y: y - 7, size: 6.5, font: bold, color: MUTED });
      y = text(totals.amount_in_words, MARGIN, y - 10, 8, true, INK) - 6;
    }
  }

  function drawNotes() {
    const sections = labels.sections(details, snapshot);
    if (!sections.length) return;
    for (const [title, body] of sections) {
      if (!String(body || '').trim()) continue;
      drawSectionTitle(title);
      y = text(body, MARGIN, y, 7.5, false, INK) - 6;
    }
    const milestones = snapshot.milestones || [];
    if (milestones.length) {
      drawSectionTitle('Payment milestones');
      for (const milestone of milestones) {
        ensure(24);
        const label = `${milestone.title}  ·  ${(milestone.share_bp / 100).toFixed(2)}%  ·  ${money(milestone.amount_minor)}`;
        y = text(label, MARGIN, y, 8, true, INK);
        if (milestone.description) y = text(milestone.description, MARGIN + 12, y, 7.5, false, MUTED);
        y -= 4;
      }
    }
  }

  function drawReceiptBody() {
    drawSectionTitle('Payment received');
    keyValues([
      ['Receipt no', snapshot.number],
      ['Invoice', `${snapshot.invoice?.number || ''} dated ${displayDate(snapshot.invoice?.issue_date)}`],
      ['Paid on', displayDate(snapshot.receipt?.paid_on)],
      ['Method', String(snapshot.receipt?.method || '').replace(/_/g, ' ')],
      ['Reference', snapshot.receipt?.reference],
      ['Invoice total', money(snapshot.invoice?.grand_total_minor || 0)],
      ['This receipt', money(snapshot.amount_minor || 0)],
      ['Total received', money(snapshot.paid_to_date_minor || 0)],
      ['Balance due', money(snapshot.balance_due_minor || 0)],
    ]);
    if (snapshot.amount_in_words) {
      drawSectionTitle('Amount in words');
      y = text(snapshot.amount_in_words, MARGIN, y, 8.5, true, INK) - 6;
    }
    if (snapshot.receipt?.notes) {
      drawSectionTitle('Notes');
      y = text(snapshot.receipt.notes, MARGIN, y, 7.5, false, INK) - 6;
    }
  }

  function drawPaymentAndSignature() {
    const wantBank = business.show_bank_details !== false
      && (business.bank_account_number || business.upi_id || business.bank_name);
    const wantSignature = business.show_signatory !== false && business.signatory_name;
    if (!wantBank && !wantSignature) return;
    ensure(96);
    const startTop = y;
    if (wantBank) {
      page.drawText('PAYMENT DETAILS', { x: MARGIN, y: startTop - 7, size: 6.5, font: bold, color: MUTED });
      let bankY = startTop - 11;
      for (const entry of [
        business.bank_account_name && `Account name: ${business.bank_account_name}`,
        business.bank_name && `Bank: ${business.bank_name}${business.bank_branch ? `, ${business.bank_branch}` : ''}`,
        business.bank_account_number && `A/C number: ${business.bank_account_number}`,
        business.bank_ifsc && `IFSC: ${business.bank_ifsc}`,
        business.upi_id && `UPI: ${business.upi_id}`,
      ].filter(Boolean)) {
        bankY = text(entry, MARGIN, bankY, 7.5, false, INK, CONTENT_WIDTH / 2 + 30);
      }
      y = Math.min(y, bankY);
    }
    if (wantSignature) {
      const signRight = MARGIN + CONTENT_WIDTH;
      const lineTop = startTop - 46;
      page.drawLine({ start: { x: signRight - 190, y: lineTop }, end: { x: signRight, y: lineTop }, thickness: 0.6, color: MUTED });
      rightAligned(`For ${business.business_name || ''}`, signRight, lineTop - 4, 8, true, INK);
      rightAligned(business.signatory_name, signRight, lineTop - 16, 8, false, INK);
      rightAligned(business.signatory_title, signRight, lineTop - 27, 7.5, false, MUTED);
      rightAligned('Authorised signatory', signRight, lineTop - 38, 7, false, MUTED);
      y = Math.min(y, lineTop - 44);
    }
  }

  function drawFooters() {
    pages.forEach((current, index) => {
      const footerTop = MARGIN + 18;
      current.drawLine({ start: { x: MARGIN, y: footerTop + 8 }, end: { x: MARGIN + CONTENT_WIDTH, y: footerTop + 8 }, thickness: 0.5, color: LINE });
      const left = `${labels.footer}${snapshot.number ? `  ·  ${snapshot.number}` : ''}`;
      current.drawText(left, { x: MARGIN, y: footerTop, size: 6.5, font, color: MUTED });
      const pageLabel = `Page ${index + 1} of ${pages.length}`;
      current.drawText(pageLabel, { x: MARGIN + CONTENT_WIDTH - font.widthOfTextAtSize(pageLabel, 6.5), y: footerTop, size: 6.5, font, color: MUTED });
      if (index === 0) current.drawText('Computer generated document', { x: MARGIN, y: footerTop - 9, size: 6, font, color: MUTED });
    });
  }
}

function formatQuantity(quantityMilli, unit) {
  if (quantityMilli === null || quantityMilli === undefined || Number.isNaN(Number(quantityMilli))) {
    return '';
  }
  const milli = Number(quantityMilli);
  const sign = milli < 0 ? '-' : '';
  const absMilli = Math.abs(milli);
  const whole = Math.floor(absMilli / 1000);
  const fraction = absMilli % 1000;
  let numStr;
  if (fraction === 0) {
    numStr = String(whole);
  } else {
    const fracStr = String(fraction).padStart(3, '0').replace(/0+$/, '');
    numStr = `${whole}.${fracStr}`;
  }
  const formattedNum = `${sign}${numStr}`;
  return unit ? `${formattedNum} ${unit}` : formattedNum;
}

const quantityText = formatQuantity;

const displayDate = formatDate;

const stateLabel = code => stateName(code) || 'Not selected';

export { formatQuantity, quantityText, displayDate, wrapText, rateLabel };
