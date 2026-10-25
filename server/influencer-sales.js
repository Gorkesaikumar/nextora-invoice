import { randomUUID, createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { assert, HttpError } from './domain.js';
import { audit } from './audit.js';
import { readSpreadsheet, sanitizeCell } from './excel.js';
import { percentOf, roundDiv, BP_PER_UNIT } from './money.js';
import { formatDate, formatMinor } from './words.js';

/* ---------------------------------------------------- Header Aliases & Auto-map */

const COLUMN_ALIASES = {
  s_no: ['s.no.', 's.no', 'sno', 'sl no', 'sl.no', 'sr no', 'sr.no', 'serial number', 'serial'],
  customer_name: ['customer name', 'customer', 'customer_name', 'client name', 'client', 'name'],
  business_name: ['business name', 'business_name', 'business', 'company name', 'restaurant name', 'restaurant', 'outlet'],
  purchased_date: ['purchased date', 'purchase date', 'purchased_date', 'purchase_date', 'date of purchase', 'sale date', 'date'],
  product_name: ['product name', 'product_name', 'product', 'item name', 'plan name', 'software'],
  expiry_date: ['expiry date', 'expiry_date', 'expiration date', 'subscription expiry', 'valid till', 'license expiry'],
  customer_location: ['customer location', 'customer_location', 'location', 'city', 'state', 'city/state', 'address'],
  influencer_name: ['influencer name', 'influencer_name', 'influencer', 'partner name', 'creator', 'affiliate', 'referred by'],
  // Extended financial columns
  sale_amount: ['sale amount', 'sale_amount', 'amount', 'price', 'gross amount', 'gross_amount', 'total amount', 'mrp'],
  discount: ['discount', 'discount amount', 'discount_amount'],
  gst_rate: ['gst rate', 'gst rate %', 'gst %', 'tax rate', 'gst_rate', 'tax %'],
  gst_amount: ['gst amount', 'gst_amount', 'tax amount'],
  refund_amount: ['refund amount', 'refund', 'cancellation amount', 'refund_amount'],
  order_reference: ['invoice reference', 'invoice number', 'order reference', 'order ref', 'order id', 'order_reference', 'ref']
};

const normalizeStr = val => String(val ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');

export function mapSalesHeaders(headers) {
  const mapping = {};
  for (const header of headers) {
    const cleanHeader = normalizeStr(header);
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (cleanHeader === normalizeStr(key) || aliases.includes(cleanHeader)) {
        mapping[header] = key;
        break;
      }
    }
  }
  return mapping;
}

/* ------------------------------------------------------- Date & Currency Parsing */

export function parseFlexibleDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^lifetime$/i.test(text)) return 'LIFETIME';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const d = new Date(`${text}T00:00:00Z`);
    return isNaN(d.getTime()) ? null : text;
  }
  // Try DD/MM/YYYY or DD-MM-YYYY or DD-Mon-YYYY
  const parts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
    || text.match(/^(\d{1,2})[ -]([A-Za-z]{3,})[ -](\d{2,4})$/);
  if (!parts) {
    // Try native parse
    const parsed = new Date(text);
    if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2000 && parsed.getFullYear() < 2100) {
      return parsed.toISOString().slice(0, 10);
    }
    return null;
  }
  let day, month, year;
  if (/^\d+$/.test(parts[2])) {
    day = Number(parts[1]);
    month = Number(parts[2]);
    year = Number(parts[3]);
  } else {
    day = Number(parts[1]);
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    month = monthNames.indexOf(parts[2].slice(0, 3).toLowerCase()) + 1;
    year = Number(parts[3]);
  }
  if (year < 100) year += 2000;
  if (!day || !month || !year) return null;
  const dateObj = new Date(Date.UTC(year, month - 1, day));
  if (dateObj.getUTCFullYear() !== year || dateObj.getUTCMonth() !== month - 1 || dateObj.getUTCDate() !== day) return null;
  return dateObj.toISOString().slice(0, 10);
}

export function parseAmountMinor(value) {
  if (value === null || value === undefined || value === '') return null;
  const clean = String(value).replace(/[^0-9.-]/g, '');
  if (!clean || isNaN(Number(clean))) return null;
  const num = Number(clean);
  if (num < 0) return 0;
  return Math.round(num * 100);
}

/* ---------------------------------------------------- Excel Template Generator */

export async function generateSalesTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Nextora Creations';
  workbook.created = new Date();

  // Sheet 1: Sales Records
  const sheet = workbook.addWorksheet('Sales Records');
  sheet.columns = [
    { header: 'S.No.', key: 's_no', width: 8 },
    { header: 'Customer Name', key: 'customer_name', width: 24 },
    { header: 'Business Name', key: 'business_name', width: 26 },
    { header: 'Purchased Date', key: 'purchased_date', width: 16 },
    { header: 'Product Name', key: 'product_name', width: 24 },
    { header: 'Expiry Date', key: 'expiry_date', width: 16 },
    { header: 'Customer Location', key: 'customer_location', width: 22 },
    { header: 'Influencer Name', key: 'influencer_name', width: 22 },
    // Financial Extension Columns (Option A)
    { header: 'Sale Amount', key: 'sale_amount', width: 16 },
    { header: 'Discount', key: 'discount', width: 14 },
    { header: 'GST Rate %', key: 'gst_rate', width: 12 },
    { header: 'Refund Amount', key: 'refund_amount', width: 16 },
    { header: 'Order Reference', key: 'order_reference', width: 20 },
  ];

  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 28;

  // Add sample rows
  const sample1 = sheet.addRow({
    s_no: 1,
    customer_name: 'Rahul Sharma',
    business_name: 'The Royal Bistro & Cafe',
    purchased_date: '2026-10-15',
    product_name: 'Nextora POS Desktop',
    expiry_date: '2027-10-15',
    customer_location: 'Mumbai, Maharashtra',
    influencer_name: 'Priya Patel (@priyatech)',
    sale_amount: 15000,
    discount: 1000,
    gst_rate: 18,
    refund_amount: 0,
    order_reference: 'ORD-2026-1001',
  });
  sample1.font = { italic: false, color: { argb: 'FF111827' } };

  const sample2 = sheet.addRow({
    s_no: 2,
    customer_name: 'Ananya Verma',
    business_name: 'Fresh Greens Grocery',
    purchased_date: '2026-10-18',
    product_name: 'Nextora POS Mobile',
    expiry_date: 'Lifetime',
    customer_location: 'Bengaluru, Karnataka',
    influencer_name: 'Vikram Mehta',
    sale_amount: 5999,
    discount: 0,
    gst_rate: 18,
    refund_amount: 0,
    order_reference: 'ORD-2026-1002',
  });
  sample2.font = { italic: false, color: { argb: 'FF111827' } };

  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  // Sheet 2: Import Instructions
  const guide = workbook.addWorksheet('Import Instructions');
  guide.columns = [
    { header: 'Column Name', key: 'col', width: 22 },
    { header: 'Required / Optional', key: 'req', width: 20 },
    { header: 'Description & Format', key: 'desc', width: 60 },
  ];
  guide.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  guide.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  guide.getRow(1).height = 26;

  guide.addRow({ col: 'S.No.', req: 'Optional', desc: 'Display sequence number (e.g. 1, 2, 3)' });
  guide.addRow({ col: 'Customer Name', req: 'REQUIRED', desc: 'Full legal name or customer contact name' });
  guide.addRow({ col: 'Business Name', req: 'Optional', desc: 'Name of the cafe, restaurant, or business enterprise' });
  guide.addRow({ col: 'Purchased Date', req: 'REQUIRED', desc: 'Date of customer purchase in YYYY-MM-DD or DD/MM/YYYY format' });
  guide.addRow({ col: 'Product Name', req: 'REQUIRED', desc: 'Product purchased (e.g. Nextora POS Desktop, Nextora POS Mobile)' });
  guide.addRow({ col: 'Expiry Date', req: 'Optional', desc: 'License/subscription expiry in YYYY-MM-DD format or "Lifetime"' });
  guide.addRow({ col: 'Customer Location', req: 'Optional', desc: 'City, state, or location (e.g. Mumbai, Maharashtra)' });
  guide.addRow({ col: 'Influencer Name', req: 'REQUIRED', desc: 'Influencer display name or Instagram username (@handle)' });
  guide.addRow({ col: 'Sale Amount', req: 'Recommended', desc: 'Total purchase amount in INR (numbers only, e.g. 15000)' });
  guide.addRow({ col: 'Discount', req: 'Optional', desc: 'Discount applied to sale in INR (e.g. 1000)' });
  guide.addRow({ col: 'GST Rate %', req: 'Optional', desc: 'Statutory GST rate applicable (e.g. 18)' });
  guide.addRow({ col: 'Refund Amount', req: 'Optional', desc: 'Approved refund or cancellation deductions (e.g. 0)' });
  guide.addRow({ col: 'Order Reference', req: 'Optional', desc: 'Unique invoice or order ID from the billing system' });

  guide.addRow({});
  guide.addRow({ col: 'FINANCIAL NOTE', req: 'CRITICAL', desc: 'If Sale Amount is omitted, records will be imported with "Awaiting revenue verification" status. Commission will only be computed once verified transaction amounts are provided.' });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/* ---------------------------------------------------- File Import & Validation */

export async function parseAndValidateSalesFile(db, buffer, filename = 'sales.xlsx') {
  const fileSha = createHash('sha256').update(buffer).digest('hex');
  const parsed = await readSpreadsheet(buffer, filename);
  assert(parsed.headers.length > 0, 400, 'The uploaded spreadsheet has no header row.', 'EMPTY_FILE');

  const mapping = mapSalesHeaders(parsed.headers);
  const mappedCols = new Set(Object.values(mapping));
  assert(mappedCols.has('customer_name'), 400, 'Missing required column: "Customer Name"', 'MISSING_COLUMN');
  assert(mappedCols.has('purchased_date'), 400, 'Missing required column: "Purchased Date"', 'MISSING_COLUMN');
  assert(mappedCols.has('influencer_name'), 400, 'Missing required column: "Influencer Name"', 'MISSING_COLUMN');

  // Load active influencers and their active agreements
  const { rows: influencers } = await db.query(`
    SELECT i.id, i.legal_name, i.display_name, i.instagram_username, i.status,
           a.id AS agreement_id, a.contract_number, a.commission_basis_points,
           a.commission_basis, a.product_tax_mode, a.commission_tax_terms
    FROM inv.influencers i
    LEFT JOIN inv.influencer_agreements a
      ON a.influencer_id = i.id AND a.status = 'ACTIVE'
    WHERE i.status <> 'ARCHIVED'
  `);

  // Load existing sales records for duplicate detection
  const { rows: existingRecords } = await db.query(`
    SELECT lower(customer_name) AS customer_name, purchased_date::text AS purchased_date,
           lower(product_name) AS product_name, influencer_id
    FROM inv.influencer_sales_records
  `);

  const existingSet = new Set(
    existingRecords.map(r => `${r.customer_name}|${r.purchased_date}|${r.product_name}`)
  );

  // Helper to match influencer
  const matchInfluencer = rawName => {
    if (!rawName) return null;
    const clean = normalizeStr(rawName).replace(/^@/, '');
    return influencers.find(inf => {
      const handle = normalizeStr(inf.instagram_username).replace(/^@/, '');
      const legal = normalizeStr(inf.legal_name);
      const display = normalizeStr(inf.display_name);
      return clean === handle || clean === legal || clean === display ||
             clean.includes(handle) || clean.includes(display);
    }) || null;
  };

  const headerIndexes = new Map();
  parsed.headers.forEach((h, idx) => {
    const key = mapping[h];
    if (key) headerIndexes.set(key, idx);
  });

  const getCell = (row, key) => {
    if (!headerIndexes.has(key)) return '';
    const idx = headerIndexes.get(key);
    return row[idx] ?? '';
  };

  const stagedRows = [];
  const errors = [];
  const inMemorySet = new Set();
  let duplicateCount = 0;
  let unmatchedInfluencerCount = 0;

  parsed.rows.forEach((row, index) => {
    const rowNum = index + 2;
    // Skip entirely blank rows
    if (row.every(c => String(c ?? '').trim() === '')) return;

    const customerName = String(getCell(row, 'customer_name')).trim();
    const businessName = String(getCell(row, 'business_name')).trim();
    const rawDate = getCell(row, 'purchased_date');
    const productName = String(getCell(row, 'product_name')).trim() || 'Nextora POS';
    const rawExpiry = getCell(row, 'expiry_date');
    const customerLocation = String(getCell(row, 'customer_location')).trim();
    const rawInfluencer = String(getCell(row, 'influencer_name')).trim();
    const rawSerial = Number(getCell(row, 's_no')) || (stagedRows.length + 1);

    // Validation
    const rowErrors = [];
    if (!customerName) rowErrors.push('Customer Name is required');

    const purchasedDate = parseFlexibleDate(rawDate);
    if (!purchasedDate || purchasedDate === 'LIFETIME') {
      rowErrors.push(`Invalid Purchased Date: "${rawDate}"`);
    }

    let expiryDate = null;
    let isLifetime = false;
    if (rawExpiry) {
      const parsedExp = parseFlexibleDate(rawExpiry);
      if (parsedExp === 'LIFETIME') {
        isLifetime = true;
      } else if (parsedExp) {
        expiryDate = parsedExp;
      } else {
        rowErrors.push(`Invalid Expiry Date: "${rawExpiry}"`);
      }
    }

    if (!rawInfluencer) {
      rowErrors.push('Influencer Name is required');
    }

    const matchedInf = matchInfluencer(rawInfluencer);
    if (!matchedInf && rawInfluencer) {
      unmatchedInfluencerCount += 1;
    }

    // Duplicate detection
    const dedupKey = `${customerName.toLowerCase()}|${purchasedDate}|${productName.toLowerCase()}`;
    let isDuplicate = false;
    let duplicateReason = '';
    if (existingSet.has(dedupKey)) {
      isDuplicate = true;
      duplicateReason = 'Matches an existing sales record in database';
      duplicateCount += 1;
    } else if (inMemorySet.has(dedupKey)) {
      isDuplicate = true;
      duplicateReason = 'Duplicate row within this spreadsheet';
      duplicateCount += 1;
    } else if (purchasedDate) {
      inMemorySet.add(dedupKey);
    }

    // Financial parsing & calculations
    const rawSaleAmount = getCell(row, 'sale_amount');
    const rawDiscount = getCell(row, 'discount');
    const rawGstRate = getCell(row, 'gst_rate');
    const rawRefund = getCell(row, 'refund_amount');
    const orderRef = String(getCell(row, 'order_reference')).trim();

    const saleAmountMinor = parseAmountMinor(rawSaleAmount);
    const discountAmountMinor = parseAmountMinor(rawDiscount) || 0;
    const gstRateBp = rawGstRate ? Math.round(Number(String(rawGstRate).replace(/[^0-9.]/g, '')) * 100) : 1800; // default 18%
    const refundAmountMinor = parseAmountMinor(rawRefund) || 0;

    let eligibleRevenueMinor = null;
    let calculatedCommissionMinor = null;
    let commissionBasis = matchedInf?.commission_basis || 'NET_SALES_EX_GST';
    let commissionRateBp = matchedInf?.commission_basis_points || null;
    let isRevenueVerified = false;
    let commissionStatus = 'PENDING';

    if (saleAmountMinor !== null && saleAmountMinor > 0) {
      isRevenueVerified = true;
      commissionStatus = 'VERIFIED';
      const effectiveRateBp = commissionRateBp || 1000; // default 10% if agreement pending
      const taxMode = matchedInf?.product_tax_mode || 'EXCLUSIVE';

      let netRev = saleAmountMinor;
      if (taxMode === 'INCLUSIVE') {
        netRev = roundDiv(saleAmountMinor * BP_PER_UNIT, BP_PER_UNIT + gstRateBp);
      } else {
        netRev = Math.max(0, saleAmountMinor - discountAmountMinor);
      }

      if (commissionBasis === 'COLLECTED_NET_REFUNDS') {
        eligibleRevenueMinor = Math.max(0, netRev - refundAmountMinor);
      } else if (commissionBasis === 'GROSS_COLLECTED') {
        eligibleRevenueMinor = Math.max(0, saleAmountMinor - discountAmountMinor);
      } else {
        eligibleRevenueMinor = netRev;
      }

      calculatedCommissionMinor = percentOf(eligibleRevenueMinor, effectiveRateBp);
    }

    const candidate = {
      serial_number: rawSerial,
      customer_name: customerName,
      business_name: businessName,
      purchased_date: purchasedDate,
      product_name: productName,
      expiry_date: expiryDate,
      is_lifetime: isLifetime,
      customer_location: customerLocation,
      raw_influencer_name: rawInfluencer,
      influencer_id: matchedInf?.id || null,
      influencer_name: matchedInf?.display_name || matchedInf?.legal_name || null,
      influencer_handle: matchedInf?.instagram_username || null,
      agreement_id: matchedInf?.agreement_id || null,
      order_reference: orderRef,
      sale_amount_minor: saleAmountMinor,
      discount_amount_minor: discountAmountMinor,
      gst_rate_bp: gstRateBp,
      refund_amount_minor: refundAmountMinor,
      eligible_revenue_minor: eligibleRevenueMinor,
      commission_basis: commissionBasis,
      commission_rate_bp: commissionRateBp,
      calculated_commission_minor: calculatedCommissionMinor,
      commission_status: commissionStatus,
      is_revenue_verified: isRevenueVerified,
      revenue_source: saleAmountMinor !== null ? 'IMPORTED' : 'IMPORTED_UNVERIFIED',
      is_duplicate: isDuplicate,
      duplicate_reason: duplicateReason,
      is_valid: rowErrors.length === 0,
      errors: rowErrors,
      __row: rowNum
    };

    if (rowErrors.length > 0) {
      errors.push({
        row: rowNum,
        customer_name: customerName,
        error: rowErrors.join('; '),
        raw_data: row
      });
    }

    stagedRows.push(candidate);
  });

  const validRows = stagedRows.filter(r => r.is_valid && !r.is_duplicate);
  const invalidRows = stagedRows.filter(r => !r.is_valid);

  return {
    filename,
    file_sha256: fileSha,
    total_rows: stagedRows.length,
    valid_rows_count: validRows.length,
    invalid_rows_count: invalidRows.length,
    duplicate_rows_count: duplicateCount,
    unmatched_influencer_count: unmatchedInfluencerCount,
    preview_rows: stagedRows.slice(0, 50),
    all_staged_rows: stagedRows,
    errors,
    influencers: influencers.map(i => ({
      id: i.id,
      display_name: i.display_name,
      legal_name: i.legal_name,
      instagram_username: i.instagram_username
    }))
  };
}

/* ---------------------------------------------------- Apply / Confirm Import */

export async function confirmSalesImport(db, actor, {
  filename,
  file_sha256,
  staged_rows,
  influencer_mappings = {},
  allow_duplicates = false,
  notes = ''
}) {
  assert(staged_rows?.length > 0, 400, 'No rows provided to import.', 'EMPTY_IMPORT');

  // Check if identical batch already completed
  const { rows: existingBatches } = await db.query(
    `SELECT id, filename, imported_at FROM inv.influencer_sales_batches WHERE file_sha256 = $1 AND status = 'COMPLETED'`,
    [file_sha256]
  );
  if (existingBatches.length > 0 && !allow_duplicates) {
    throw new HttpError(
      409,
      `This file was already imported on ${existingBatches[0].imported_at.toISOString().slice(0, 10)}. Enable "Allow Duplicates" to re-import.`,
      'BATCH_ALREADY_IMPORTED'
    );
  }

  const batchId = randomUUID();
  let validCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;

  // Fetch active influencers to resolve influencer mappings
  const { rows: allInfluencers } = await db.query(`
    SELECT i.id, a.id AS agreement_id, a.commission_basis_points, a.commission_basis, a.product_tax_mode
    FROM inv.influencers i
    LEFT JOIN inv.influencer_agreements a ON a.influencer_id = i.id AND a.status = 'ACTIVE'
    WHERE i.status <> 'ARCHIVED'
  `);
  const influencerMap = new Map(allInfluencers.map(i => [i.id, i]));

  await db.transaction(async tx => {
    // 1. Insert Batch record
    await tx.query(`
      INSERT INTO inv.influencer_sales_batches (
        id, filename, file_sha256, row_count, valid_row_count, invalid_row_count,
        duplicate_row_count, status, notes, imported_by, imported_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED', $8, $9, now())
    `, [
      batchId, filename, file_sha256, staged_rows.length, 0, 0, 0, notes, actor.id
    ]);

    // 2. Insert Valid Records
    for (const row of staged_rows) {
      if (!row.is_valid) {
        invalidCount += 1;
        continue;
      }
      if (row.is_duplicate && !allow_duplicates) {
        duplicateCount += 1;
        continue;
      }

      // Check if user re-mapped influencer in preview UI
      let effectiveInfluencerId = row.influencer_id;
      if (!effectiveInfluencerId && influencer_mappings[row.raw_influencer_name]) {
        effectiveInfluencerId = influencer_mappings[row.raw_influencer_name];
      }

      let agreementId = row.agreement_id;
      let commissionBasis = row.commission_basis;
      let commissionRateBp = row.commission_rate_bp;
      let eligibleRevMinor = row.eligible_revenue_minor;
      let commissionMinor = row.calculated_commission_minor;
      let isVerified = row.is_revenue_verified;
      let commStatus = row.commission_status;

      if (effectiveInfluencerId && influencerMap.has(effectiveInfluencerId)) {
        const infData = influencerMap.get(effectiveInfluencerId);
        agreementId = infData.agreement_id || agreementId;
        commissionBasis = infData.commission_basis || commissionBasis;
        commissionRateBp = infData.commission_basis_points || commissionRateBp;

        if (row.sale_amount_minor !== null && row.sale_amount_minor > 0) {
          isVerified = true;
          commStatus = 'VERIFIED';
          const rate = commissionRateBp || 1000;
          let net = row.sale_amount_minor;
          if (infData.product_tax_mode === 'INCLUSIVE') {
            net = roundDiv(row.sale_amount_minor * BP_PER_UNIT, BP_PER_UNIT + row.gst_rate_bp);
          } else {
            net = Math.max(0, row.sale_amount_minor - row.discount_amount_minor);
          }
          if (commissionBasis === 'COLLECTED_NET_REFUNDS') {
            eligibleRevMinor = Math.max(0, net - row.refund_amount_minor);
          } else if (commissionBasis === 'GROSS_COLLECTED') {
            eligibleRevMinor = Math.max(0, row.sale_amount_minor - row.discount_amount_minor);
          } else {
            eligibleRevMinor = net;
          }
          commissionMinor = percentOf(eligibleRevMinor, rate);
        }
      }

      const recordId = randomUUID();
      const snapshot = JSON.stringify({
        imported_at: new Date().toISOString(),
        raw_influencer: row.raw_influencer_name,
        commission_basis: commissionBasis,
        commission_rate_bp: commissionRateBp,
        tax_calculation: {
          sale_amount_minor: row.sale_amount_minor,
          eligible_revenue_minor: eligibleRevMinor,
          commission_minor: commissionMinor
        }
      });

      await tx.query(`
        INSERT INTO inv.influencer_sales_records (
          id, batch_id, serial_number, customer_name, business_name, purchased_date,
          product_name, expiry_date, is_lifetime, customer_location, raw_influencer_name,
          influencer_id, agreement_id, order_reference, sale_amount_minor, discount_amount_minor,
          gst_rate_bp, gst_amount_minor, refund_amount_minor, eligible_revenue_minor,
          commission_basis, commission_rate_bp, calculated_commission_minor,
          commission_status, is_revenue_verified, revenue_source, snapshot,
          created_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16,
          $17, $18, $19, $20,
          $21, $22, $23,
          $24, $25, $26, $27,
          $28, now(), now()
        )
      `, [
        recordId, batchId, row.serial_number, row.customer_name, row.business_name || '', row.purchased_date,
        row.product_name, row.is_lifetime ? null : row.expiry_date, row.is_lifetime, row.customer_location || '',
        row.raw_influencer_name, effectiveInfluencerId, agreementId, row.order_reference || '',
        row.sale_amount_minor, row.discount_amount_minor || 0, row.gst_rate_bp || 0, 0, row.refund_amount_minor || 0,
        eligibleRevMinor, commissionBasis, commissionRateBp, commissionMinor,
        commStatus, isVerified, row.revenue_source || 'IMPORTED', snapshot,
        actor.id
      ]);

      // If verified and has influencer, synchronize with inv.influencer_attributions
      if (effectiveInfluencerId && isVerified && eligibleRevMinor !== null) {
        await tx.query(`
          INSERT INTO inv.influencer_attributions (
            id, influencer_id, agreement_id, referral_code, order_reference,
            customer_name, sale_amount_minor, net_revenue_minor, commission_minor,
            status, attributed_at, verified_at, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'VERIFIED', now(), now(), now())
          ON CONFLICT (id) DO NOTHING
        `, [
          recordId, effectiveInfluencerId, agreementId, '', row.order_reference || '',
          row.customer_name, row.sale_amount_minor || 0, eligibleRevMinor || 0, commissionMinor || 0
        ]);
      }

      validCount += 1;
    }

    // Update batch counts
    await tx.query(`
      UPDATE inv.influencer_sales_batches
      SET valid_row_count = $1, duplicate_row_count = $2, invalid_row_count = $3
      WHERE id = $4
    `, [validCount, duplicateCount, invalidCount, batchId]);

    await audit(tx, 'INFLUENCER_SALES_IMPORTED', {
      actorId: actor.id,
      entityType: 'SALES_BATCH',
      metadata: { batchId, filename, validCount, duplicateCount, invalidCount }
    });
  });

  return {
    batch_id: batchId,
    imported_count: validCount,
    duplicate_count: duplicateCount,
    invalid_count: invalidCount
  };
}

/* ---------------------------------------------------- Batches & Sales Queries */

export async function listSalesBatches(db, { page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;
  const { rows } = await db.query(`
    SELECT b.id, b.filename, b.row_count, b.valid_row_count, b.invalid_row_count,
           b.duplicate_row_count, b.status, b.notes, b.imported_at,
           u.display_name AS imported_by_name
    FROM inv.influencer_sales_batches b
    JOIN inv.users u ON u.id = b.imported_by
    ORDER BY b.imported_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  const total = (await db.query(`SELECT count(*)::integer AS count FROM inv.influencer_sales_batches`)).rows[0]?.count || 0;
  return { batches: rows, total, page, limit };
}

export async function getSalesDashboardMetrics(db, { fromDate = '', toDate = '', productId = '', influencerId = '' } = {}) {
  const conditions = [];
  const binds = [];

  if (fromDate) {
    binds.push(fromDate);
    conditions.push(`r.purchased_date >= $${binds.length}`);
  }
  if (toDate) {
    binds.push(toDate);
    conditions.push(`r.purchased_date <= $${binds.length}`);
  }
  if (productId) {
    binds.push(productId);
    conditions.push(`r.product_name = $${binds.length}`);
  }
  if (influencerId) {
    binds.push(influencerId);
    conditions.push(`r.influencer_id = $${binds.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // KPI Metrics
  const summaryQuery = `
    SELECT
      count(*)::integer AS total_sales_records,
      count(CASE WHEN r.influencer_id IS NOT NULL THEN 1 END)::integer AS total_attributed_sales,
      count(DISTINCT r.influencer_id)::integer AS total_influencers_with_sales,
      COALESCE(SUM(CASE WHEN r.is_revenue_verified THEN r.eligible_revenue_minor ELSE 0 END), 0)::bigint AS verified_revenue_minor,
      COALESCE(SUM(CASE WHEN r.is_revenue_verified THEN r.calculated_commission_minor ELSE 0 END), 0)::bigint AS total_calculated_commission_minor,
      COALESCE(SUM(CASE WHEN r.commission_status IN ('PENDING','VERIFIED') THEN COALESCE(r.calculated_commission_minor,0) ELSE 0 END), 0)::bigint AS pending_commission_minor,
      COALESCE(SUM(CASE WHEN r.commission_status = 'APPROVED' THEN COALESCE(r.calculated_commission_minor,0) ELSE 0 END), 0)::bigint AS approved_commission_minor,
      COALESCE(SUM(CASE WHEN r.commission_status = 'PAID' THEN COALESCE(r.calculated_commission_minor,0) ELSE 0 END), 0)::bigint AS paid_commission_minor,
      count(CASE WHEN NOT r.is_revenue_verified THEN 1 END)::integer AS unverified_revenue_count
    FROM inv.influencer_sales_records r
    ${whereClause}
  `;
  const summary = (await db.query(summaryQuery, binds)).rows[0] || {};

  // Influencer-wise Aggregated Summary Table
  const influencerTableQuery = `
    SELECT
      i.id AS influencer_id,
      i.display_name,
      i.legal_name,
      i.instagram_username,
      a.contract_number,
      a.commission_basis_points,
      count(r.id)::integer AS total_sales,
      count(CASE WHEN r.is_revenue_verified THEN 1 END)::integer AS verified_sales_count,
      count(CASE WHEN NOT r.is_revenue_verified THEN 1 END)::integer AS unverified_sales_count,
      COALESCE(SUM(CASE WHEN r.is_revenue_verified THEN r.eligible_revenue_minor ELSE 0 END), 0)::bigint AS verified_revenue_minor,
      COALESCE(SUM(CASE WHEN r.is_revenue_verified THEN r.calculated_commission_minor ELSE 0 END), 0)::bigint AS calculated_commission_minor,
      COALESCE(SUM(CASE WHEN r.commission_status IN ('PENDING','VERIFIED') THEN COALESCE(r.calculated_commission_minor,0) ELSE 0 END), 0)::bigint AS pending_commission_minor,
      COALESCE(SUM(CASE WHEN r.commission_status = 'APPROVED' THEN COALESCE(r.calculated_commission_minor,0) ELSE 0 END), 0)::bigint AS approved_commission_minor,
      COALESCE(SUM(CASE WHEN r.commission_status = 'PAID' THEN COALESCE(r.calculated_commission_minor,0) ELSE 0 END), 0)::bigint AS paid_commission_minor
    FROM inv.influencers i
    JOIN inv.influencer_sales_records r ON r.influencer_id = i.id
    LEFT JOIN inv.influencer_agreements a ON a.influencer_id = i.id AND a.status = 'ACTIVE'
    ${whereClause}
    GROUP BY i.id, i.display_name, i.legal_name, i.instagram_username, a.contract_number, a.commission_basis_points
    ORDER BY total_sales DESC, verified_revenue_minor DESC
  `;
  const { rows: influencerSummaries } = await db.query(influencerTableQuery, binds);

  return {
    kpis: {
      total_imported_records: Number(summary.total_sales_records || 0),
      total_valid_sales: Number(summary.total_attributed_sales || 0),
      total_influencers_with_sales: Number(summary.total_influencers_with_sales || 0),
      total_verified_revenue_minor: Number(summary.verified_revenue_minor || 0),
      total_calculated_commission_minor: Number(summary.total_calculated_commission_minor || 0),
      pending_commission_minor: Number(summary.pending_commission_minor || 0),
      approved_commission_minor: Number(summary.approved_commission_minor || 0),
      paid_commission_minor: Number(summary.paid_commission_minor || 0),
      unverified_revenue_count: Number(summary.unverified_revenue_count || 0)
    },
    influencers: influencerSummaries.map(inf => ({
      ...inf,
      total_sales: Number(inf.total_sales),
      verified_sales_count: Number(inf.verified_sales_count),
      unverified_sales_count: Number(inf.unverified_sales_count),
      verified_revenue_minor: Number(inf.verified_revenue_minor),
      calculated_commission_minor: Number(inf.calculated_commission_minor),
      pending_commission_minor: Number(inf.pending_commission_minor),
      approved_commission_minor: Number(inf.approved_commission_minor),
      paid_commission_minor: Number(inf.paid_commission_minor)
    }))
  };
}

export async function listSalesRecords(db, {
  influencerId = null,
  search = '',
  fromDate = '',
  toDate = '',
  productId = '',
  status = '',
  page = 1,
  limit = 25,
  sort = 'purchased_date_desc'
} = {}) {
  const conditions = [];
  const binds = [];

  if (influencerId) {
    binds.push(influencerId);
    conditions.push(`r.influencer_id = $${binds.length}`);
  }
  if (fromDate) {
    binds.push(fromDate);
    conditions.push(`r.purchased_date >= $${binds.length}`);
  }
  if (toDate) {
    binds.push(toDate);
    conditions.push(`r.purchased_date <= $${binds.length}`);
  }
  if (productId) {
    binds.push(productId);
    conditions.push(`r.product_name = $${binds.length}`);
  }
  if (status) {
    binds.push(status);
    conditions.push(`r.commission_status = $${binds.length}`);
  }
  if (search) {
    binds.push(`%${search.trim().toLowerCase()}%`);
    conditions.push(`(
      lower(r.customer_name) LIKE $${binds.length}
      OR lower(r.business_name) LIKE $${binds.length}
      OR lower(r.customer_location) LIKE $${binds.length}
      OR lower(r.order_reference) LIKE $${binds.length}
      OR lower(r.raw_influencer_name) LIKE $${binds.length}
    )`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  let orderBy = 'r.purchased_date DESC, r.serial_number ASC';
  if (sort === 'purchased_date_asc') orderBy = 'r.purchased_date ASC, r.serial_number ASC';
  else if (sort === 'revenue_desc') orderBy = 'r.eligible_revenue_minor DESC NULLS LAST';
  else if (sort === 'customer_asc') orderBy = 'r.customer_name ASC';

  const countQuery = `SELECT count(*)::integer AS count FROM inv.influencer_sales_records r ${whereClause}`;
  const total = (await db.query(countQuery, binds)).rows[0]?.count || 0;

  const offset = (page - 1) * limit;
  const dataQuery = `
    SELECT
      r.id, r.batch_id, r.serial_number, r.customer_name, r.business_name,
      r.purchased_date::text AS purchased_date, r.product_name,
      r.expiry_date::text AS expiry_date, r.is_lifetime, r.customer_location,
      r.raw_influencer_name, r.influencer_id, r.order_reference,
      r.sale_amount_minor, r.discount_amount_minor, r.gst_rate_bp,
      r.refund_amount_minor, r.eligible_revenue_minor, r.commission_basis,
      r.commission_rate_bp, r.calculated_commission_minor, r.commission_status,
      r.is_revenue_verified, r.revenue_source, r.created_at,
      i.display_name AS influencer_display_name,
      i.legal_name AS influencer_legal_name,
      i.instagram_username AS influencer_handle,
      a.contract_number
    FROM inv.influencer_sales_records r
    LEFT JOIN inv.influencers i ON i.id = r.influencer_id
    LEFT JOIN inv.influencer_agreements a ON a.id = r.agreement_id
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT $${binds.length + 1} OFFSET $${binds.length + 2}
  `;

  const { rows } = await db.query(dataQuery, [...binds, limit, offset]);

  return {
    records: rows.map(r => ({
      ...r,
      sale_amount_minor: r.sale_amount_minor !== null ? Number(r.sale_amount_minor) : null,
      eligible_revenue_minor: r.eligible_revenue_minor !== null ? Number(r.eligible_revenue_minor) : null,
      calculated_commission_minor: r.calculated_commission_minor !== null ? Number(r.calculated_commission_minor) : null,
      is_lifetime: Boolean(r.is_lifetime),
      is_revenue_verified: Boolean(r.is_revenue_verified)
    })),
    total,
    page,
    limit
  };
}

/* ---------------------------------------------------- Status Transition */

export async function updateSaleRecordStatus(db, actor, saleId, { status, note = '' }) {
  assert(['PENDING', 'VERIFIED', 'APPROVED', 'PAID', 'REVERSED', 'DISPUTED'].includes(status), 400, 'Invalid status', 'INVALID_STATUS');

  const { rows } = await db.query(`SELECT id, commission_status, influencer_id FROM inv.influencer_sales_records WHERE id = $1`, [saleId]);
  assert(rows.length > 0, 404, 'Sale record not found', 'NOT_FOUND');

  await db.transaction(async tx => {
    await tx.query(`
      UPDATE inv.influencer_sales_records
      SET commission_status = $1, updated_at = now()
      WHERE id = $2
    `, [status, saleId]);

    // Also update inv.influencer_attributions if present
    await tx.query(`
      UPDATE inv.influencer_attributions
      SET status = $1
      WHERE id = $2
    `, [status === 'APPROVED' ? 'VERIFIED' : status, saleId]);

    await audit(tx, 'INFLUENCER_SALE_STATUS_UPDATED', {
      actorId: actor.id,
      entityType: 'SALES_RECORD',
      metadata: { saleId, from: rows[0].commission_status, to: status, note }
    });
  });

  return { id: saleId, status };
}

export async function bulkUpdateSalesStatus(db, actor, { ids, status, note = '' }) {
  assert(Array.isArray(ids) && ids.length > 0, 400, 'Select at least one record', 'EMPTY_SELECTION');
  assert(['PENDING', 'VERIFIED', 'APPROVED', 'PAID', 'REVERSED', 'DISPUTED'].includes(status), 400, 'Invalid status', 'INVALID_STATUS');

  let updatedCount = 0;
  await db.transaction(async tx => {
    for (const id of ids) {
      await tx.query(`
        UPDATE inv.influencer_sales_records
        SET commission_status = $1, updated_at = now()
        WHERE id = $2
      `, [status, id]);

      await tx.query(`
        UPDATE inv.influencer_attributions
        SET status = $1
        WHERE id = $2
      `, [status === 'APPROVED' ? 'VERIFIED' : status, id]);
      updatedCount += 1;
    }

    await audit(tx, 'INFLUENCER_SALES_BULK_STATUS_UPDATED', {
      actorId: actor.id,
      entityType: 'SALES_RECORD',
      metadata: { count: updatedCount, status, note }
    });
  });

  return { updated_count: updatedCount, status };
}

/* ---------------------------------------------------- Excel Export Generator */

export async function exportSalesToExcel({ records, influencer = null, filters = {} }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Nextora Creations';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Sales Records');
  sheet.columns = [
    { header: 'S.No.', key: 's_no', width: 8 },
    { header: 'Customer Name', key: 'customer_name', width: 24 },
    { header: 'Business Name', key: 'business_name', width: 26 },
    { header: 'Purchased Date', key: 'purchased_date', width: 16 },
    { header: 'Product Name', key: 'product_name', width: 22 },
    { header: 'Expiry Date', key: 'expiry_date', width: 16 },
    { header: 'Customer Location', key: 'customer_location', width: 22 },
    { header: 'Influencer Name', key: 'influencer_name', width: 22 },
    { header: 'Eligible Revenue (₹)', key: 'eligible_revenue', width: 20 },
    { header: 'Commission Rate', key: 'commission_rate', width: 18 },
    { header: 'Commission (₹)', key: 'commission', width: 18 },
    { header: 'Commission Status', key: 'commission_status', width: 18 },
    { header: 'Revenue Verification', key: 'verification_status', width: 22 },
    { header: 'Order Reference', key: 'order_reference', width: 20 },
  ];

  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 26;

  records.forEach((r, idx) => {
    const isVerified = r.is_revenue_verified && r.eligible_revenue_minor !== null;
    const rateText = r.commission_rate_bp ? `${(r.commission_rate_bp / 100).toFixed(2)}%` : '-';
    const expText = r.is_lifetime ? 'Lifetime' : (r.expiry_date || '-');

    const row = sheet.addRow({
      s_no: idx + 1,
      customer_name: sanitizeCell(r.customer_name),
      business_name: sanitizeCell(r.business_name || '-'),
      purchased_date: r.purchased_date,
      product_name: sanitizeCell(r.product_name),
      expiry_date: expText,
      customer_location: sanitizeCell(r.customer_location || '-'),
      influencer_name: sanitizeCell(r.influencer_display_name || r.raw_influencer_name || '-'),
      eligible_revenue: isVerified ? r.eligible_revenue_minor / 100 : 'Awaiting verification',
      commission_rate: rateText,
      commission: isVerified ? r.calculated_commission_minor / 100 : 'Awaiting verification',
      commission_status: r.commission_status,
      verification_status: isVerified ? 'Verified' : 'Pending Verification',
      order_reference: sanitizeCell(r.order_reference || '-'),
    });

    if (isVerified) {
      row.getCell('eligible_revenue').numFmt = '₹#,##0.00';
      row.getCell('commission').numFmt = '₹#,##0.00';
    }
  });

  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  // Sheet 2: Summary Sheet
  const meta = workbook.addWorksheet('Summary');
  meta.columns = [{ width: 28 }, { width: 40 }];
  meta.addRow(['Metric / Parameter', 'Value']);
  meta.getRow(1).font = { bold: true };

  meta.addRow(['Report Title', influencer ? `Influencer Sales: ${influencer.display_name}` : 'All Influencer Sales']);
  meta.addRow(['Export Timestamp', new Date().toISOString()]);
  meta.addRow(['Total Exported Records', records.length]);

  const verifiedCount = records.filter(r => r.is_revenue_verified).length;
  const verifiedRevenueMinor = records.reduce((sum, r) => sum + (r.eligible_revenue_minor || 0), 0);
  const totalCommissionMinor = records.reduce((sum, r) => sum + (r.calculated_commission_minor || 0), 0);

  meta.addRow(['Verified Records Count', verifiedCount]);
  meta.addRow(['Unverified Records Count', records.length - verifiedCount]);
  meta.addRow(['Total Verified Eligible Revenue', formatMinor(verifiedRevenueMinor)]);
  meta.addRow(['Total Calculated Commission', formatMinor(totalCommissionMinor)]);

  for (const [k, v] of Object.entries(filters)) {
    if (v) meta.addRow([`Filter: ${k}`, String(v)]);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
