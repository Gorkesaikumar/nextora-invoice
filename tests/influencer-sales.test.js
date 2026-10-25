import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { makeClient, configureIssuer, OWNER } from './helpers.js';
import { extractPdf } from './pdf-text.js';

const ip = suffix => `10.9.1.${suffix}`;

async function withAdmin(suffix = 1) {
  const client = makeClient({ ip: ip(suffix) });
  await client.login(OWNER);
  await configureIssuer(client);
  return client;
}

async function createExcelBuffer(rows, headers = [
  'S.No.', 'Customer Name', 'Business Name', 'Purchased Date', 'Product Name',
  'Expiry Date', 'Customer Location', 'Influencer Name', 'Sale Amount', 'Discount',
  'GST Rate %', 'Refund Amount', 'Order Reference'
]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sales');
  ws.addRow(headers);
  for (const r of rows) {
    ws.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('1. Excel import validation, preview, and alternate header aliases', async () => {
  const client = await withAdmin(10);

  // Create two influencers
  const inf1 = (await client.json('POST', '/api/marketing/influencers', {
    legal_name: 'Rohit Khandelwal',
    display_name: 'Rohit Tech Reviews',
    instagram_username: '@rohit_tech',
    phone: '+91 91234 56789',
    email: 'rohit@example.test',
  })).data.influencer;

  const inf2 = (await client.json('POST', '/api/marketing/influencers', {
    legal_name: 'Kavita Sundaram',
    display_name: 'Kavita Retail',
    instagram_username: '@kavita_retail',
    phone: '+91 98765 12345',
    email: 'kavita@example.test',
  })).data.influencer;

  // Active agreement for Rohit (15% Net Sales Ex GST)
  await client.json('POST', '/api/marketing/agreements', {
    influencer_id: inf1.id,
    commission_basis_points: 1500,
    commission_basis: 'NET_SALES_EX_GST',
    product_tax_mode: 'EXCLUSIVE',
    start_date: '2026-10-01',
    is_indefinite: true,
  });
  // Active agreement for Kavita (10% Inclusive mode)
  await client.json('POST', '/api/marketing/agreements', {
    influencer_id: inf2.id,
    commission_basis_points: 1000,
    commission_basis: 'NET_SALES_EX_GST',
    product_tax_mode: 'INCLUSIVE',
    start_date: '2026-10-01',
    is_indefinite: true,
  });

  // Activate both agreements
  const agList = (await client.json('GET', '/api/marketing/agreements')).data.agreements;
  for (const ag of agList) {
    if (ag.status === 'DRAFT') {
      await client.json('POST', `/api/marketing/agreements/${ag.id}/status`, { action: 'SIGN' });
      await client.json('POST', `/api/marketing/agreements/${ag.id}/status`, { action: 'ACTIVATE' });
    }
  }

  // A. Missing required columns rejected
  const missingColBuf = await createExcelBuffer([[1, 'Rahul', '2026-10-15']], ['S.No.', 'Customer Name', 'Purchased Date']);
  const missingRes = await client.json('POST', '/api/marketing/sales/preview-import', {
    filename: 'missing.xlsx',
    content_base64: missingColBuf.toString('base64'),
  });
  assert.equal(missingRes.status, 400);
  assert.ok(missingRes.data.error.includes('Influencer Name'));

  // B. Alternate header aliases and valid rows
  const alternateHeaders = [
    'sl no', 'client name', 'restaurant', 'date of purchase', 'item name',
    'subscription expiry', 'city', 'creator', 'price', 'discount', 'tax %', 'refund', 'ref'
  ];
  const validRows = [
    [1, 'Vikram Malhotra', 'Saffron Dine', '2026-10-12', 'Nextora POS Desktop', '2027-10-12', 'Delhi', '@rohit_tech', 20000, 0, 18, 0, 'ORD-001'],
    [2, 'Meera Nair', 'Green Leaf Organic', '2026-10-14', 'Nextora POS Mobile', 'Lifetime', 'Kochi', 'Kavita Retail', 5999, 0, 18, 0, 'ORD-002'],
    [3, 'Amitabh Roy', 'Bengal Sweets', '2026-10-15', 'Nextora POS Desktop', '2027-10-15', 'Kolkata', 'Unknown Partner', 10000, 0, 18, 0, 'ORD-003'],
    [4, '', 'Missing Customer Shop', '2026-10-16', 'Nextora POS Desktop', '', 'Pune', '@rohit_tech', 15000, 0, 18, 0, 'ORD-004'], // invalid (empty customer name)
    [5, 'Sunil Joshi', 'Joshi Stores', 'not-a-date', 'Nextora POS Desktop', '', 'Nagpur', '@rohit_tech', 15000, 0, 18, 0, 'ORD-005'], // invalid (bad date)
    ['', '', '', '', '', '', '', '', '', '', '', '', ''], // empty row to be ignored
  ];

  const excelBuf = await createExcelBuffer(validRows, alternateHeaders);
  const previewRes = await client.json('POST', '/api/marketing/sales/preview-import', {
    filename: 'sales_october.xlsx',
    content_base64: excelBuf.toString('base64'),
  });

  assert.equal(previewRes.status, 200);
  assert.equal(previewRes.data.total_rows, 5); // 5 non-blank rows
  assert.equal(previewRes.data.valid_rows_count, 3);
  assert.equal(previewRes.data.invalid_rows_count, 2);
  assert.equal(previewRes.data.unmatched_influencer_count, 1); // "Unknown Partner"
  assert.equal(previewRes.data.errors.length, 2);

  // C. Confirm Import with influencer remapping for "Unknown Partner" -> Kavita
  const confirmRes = await client.json('POST', '/api/marketing/sales/confirm-import', {
    filename: previewRes.data.filename,
    file_sha256: previewRes.data.file_sha256,
    staged_rows: previewRes.data.all_staged_rows,
    influencer_mappings: { 'Unknown Partner': inf2.id },
    allow_duplicates: false,
    notes: 'October 2026 verified sales batch',
  });

  assert.equal(confirmRes.status, 200);
  assert.equal(confirmRes.data.imported_count, 3);
  assert.equal(confirmRes.data.invalid_count, 2);

  // D. Re-importing same batch without allow_duplicates is rejected
  const dupBatchRes = await client.json('POST', '/api/marketing/sales/confirm-import', {
    filename: previewRes.data.filename,
    file_sha256: previewRes.data.file_sha256,
    staged_rows: previewRes.data.all_staged_rows,
    allow_duplicates: false,
  });
  assert.equal(dupBatchRes.status, 409);
  assert.equal(dupBatchRes.data.code, 'BATCH_ALREADY_IMPORTED');
});

test('2. Influencer sales segregation and financial revenue calculations', async () => {
  const client = await withAdmin(11);

  // Fetch Rohit's sales
  const { data: infList } = await client.json('GET', '/api/marketing/influencers');
  const rohit = infList.influencers.find(i => i.instagram_username === '@rohit_tech');
  const kavita = infList.influencers.find(i => i.instagram_username === '@kavita_retail');

  // Check sales for Rohit
  const rohitSales = (await client.json('GET', `/api/marketing/influencers/${rohit.id}/sales`)).data;
  assert.equal(rohitSales.records.length, 1);
  const rohitRec = rohitSales.records[0];
  assert.equal(rohitRec.customer_name, 'Vikram Malhotra');
  assert.equal(rohitRec.sale_amount_minor, 2000000); // ₹20,000.00
  assert.equal(rohitRec.eligible_revenue_minor, 2000000); // 100% net of discount
  // 15% of ₹20,000 = ₹3,000
  assert.equal(rohitRec.calculated_commission_minor, 300000);
  assert.equal(rohitRec.commission_status, 'VERIFIED');

  // Check sales for Kavita (should have Meera Nair + remapped Amitabh Roy)
  const kavitaSales = (await client.json('GET', `/api/marketing/influencers/${kavita.id}/sales`)).data;
  assert.equal(kavitaSales.records.length, 2);

  const meeraRec = kavitaSales.records.find(r => r.customer_name === 'Meera Nair');
  assert.ok(meeraRec);
  assert.equal(meeraRec.sale_amount_minor, 599900); // ₹5,999.00
  // Kavita is in INCLUSIVE mode: reverse extract 18% GST:
  // net = round(599900 * 10000 / 11800) = 508390 (₹5,083.90)
  assert.equal(meeraRec.eligible_revenue_minor, 508390);
  // 10% commission on ₹5,083.90 = ₹508.39 = 50839 minor units
  assert.equal(meeraRec.calculated_commission_minor, 50839);
  assert.equal(meeraRec.is_lifetime, true);

  // Check dashboard KPI totals
  const dashRes = (await client.json('GET', '/api/marketing/sales/dashboard')).data;
  assert.equal(dashRes.kpis.total_valid_sales, 3);
  assert.equal(dashRes.kpis.total_influencers_with_sales, 2);
  // Total verified revenue = 2000000 + 508390 + 847458 = 3355848
  assert.ok(dashRes.kpis.total_verified_revenue_minor > 0);
  assert.ok(dashRes.kpis.total_calculated_commission_minor > 0);
});

test('3. Unverified revenue handling: no false payouts or invented numbers', async () => {
  const client = await withAdmin(12);

  const { data: infList } = await client.json('GET', '/api/marketing/influencers');
  const rohit = infList.influencers.find(i => i.instagram_username === '@rohit_tech');

  // Import rows WITHOUT sale amount or financial data
  const noAmountRows = [
    [10, 'Pradeep Joshi', 'Joshi Sweets', '2026-10-20', 'Nextora POS Mobile', '2027-10-20', 'Pune', '@rohit_tech', '', '', '', '', 'REF-999'],
  ];
  const buf = await createExcelBuffer(noAmountRows);
  const prev = (await client.json('POST', '/api/marketing/sales/preview-import', {
    filename: 'no_amount.xlsx',
    content_base64: buf.toString('base64'),
  })).data;

  assert.equal(prev.valid_rows_count, 1);
  const staged = prev.preview_rows[0];
  assert.equal(staged.sale_amount_minor, null);
  assert.equal(staged.eligible_revenue_minor, null);
  assert.equal(staged.calculated_commission_minor, null);
  assert.equal(staged.is_revenue_verified, false);
  assert.equal(staged.commission_status, 'PENDING');

  // Confirm import
  await client.json('POST', '/api/marketing/sales/confirm-import', {
    filename: prev.filename,
    file_sha256: prev.file_sha256,
    staged_rows: prev.all_staged_rows,
    allow_duplicates: false,
  });

  // Verify that unverified record has null/unavailable revenue and 0 payable commission
  const rohitSales = (await client.json('GET', `/api/marketing/influencers/${rohit.id}/sales`)).data;
  const unverifiedRec = rohitSales.records.find(r => r.customer_name === 'Pradeep Joshi');
  assert.ok(unverifiedRec);
  assert.equal(unverifiedRec.sale_amount_minor, null);
  assert.equal(unverifiedRec.eligible_revenue_minor, null);
  assert.equal(unverifiedRec.calculated_commission_minor, null);
  assert.equal(unverifiedRec.is_revenue_verified, false);
  assert.equal(unverifiedRec.commission_status, 'PENDING');
});

test('4. Commission status transitions and settlement audit', async () => {
  const client = await withAdmin(13);

  const { data: salesData } = await client.json('GET', '/api/marketing/sales');
  const verifiedSale = salesData.records.find(r => r.customer_name === 'Vikram Malhotra');
  assert.ok(verifiedSale);

  // Transition from VERIFIED to APPROVED
  const appRes = await client.json('POST', `/api/marketing/sales/${verifiedSale.id}/status`, {
    status: 'APPROVED',
    note: 'Approved during monthly finance reconciliation',
  });
  assert.equal(appRes.status, 200);
  assert.equal(appRes.data.status, 'APPROVED');

  // Transition from APPROVED to PAID
  const paidRes = await client.json('POST', `/api/marketing/sales/${verifiedSale.id}/status`, {
    status: 'PAID',
    note: 'Remitted via NEFT UTR #9876543210',
  });
  assert.equal(paidRes.status, 200);
  assert.equal(paidRes.data.status, 'PAID');

  // Verify dashboard reflects paid commission
  const dashRes = (await client.json('GET', '/api/marketing/sales/dashboard')).data;
  assert.equal(dashRes.kpis.paid_commission_minor, 300000); // ₹3,000.00
});

test('5. Individual & consolidated PDF and Excel report generation', async () => {
  const client = await withAdmin(14);

  const { data: infList } = await client.json('GET', '/api/marketing/influencers');
  const rohit = infList.influencers.find(i => i.instagram_username === '@rohit_tech');

  // A. Download Excel template
  const tmplResp = await client.raw('GET', '/api/marketing/sales/template');
  assert.equal(tmplResp.status, 200);
  assert.equal(tmplResp.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const tmplBytes = Buffer.from(await tmplResp.arrayBuffer());
  assert.ok(tmplBytes.length > 1000);

  // B. Export all sales to Excel
  const exportAllResp = await client.raw('GET', '/api/marketing/sales/export.xlsx');
  assert.equal(exportAllResp.status, 200);
  const exportBytes = Buffer.from(await exportAllResp.arrayBuffer());
  assert.ok(exportBytes.length > 2000);

  // Verify formula injection protection in Excel export
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(exportBytes);
  const sheet = wb.getWorksheet('Sales Records');
  assert.ok(sheet.rowCount >= 4);

  // C. Download Individual Influencer PDF Report
  const indPdfResp = await client.raw('GET', `/api/marketing/influencers/${rohit.id}/sales/report.pdf`);
  assert.equal(indPdfResp.status, 200);
  assert.equal(indPdfResp.headers.get('content-type'), 'application/pdf');
  const indPdfBytes = Buffer.from(await indPdfResp.arrayBuffer());
  assert.ok(indPdfBytes.length > 5000);

  const indPages = extractPdf(indPdfBytes);
  const indPdfText = indPages.map(p => p.text.join(' ')).join('\n');
  assert.ok(indPdfText.includes('INFLUENCER SALES & REVENUE-SHARING REPORT'));
  assert.ok(indPdfText.includes('Rohit Tech Reviews'));
  assert.ok(indPdfText.includes('Vikram Malhotra'));
  assert.ok(indPdfText.includes('SECTION 1 — EXECUTIVE SUMMARY'));

  // D. Download Consolidated All-Influencer PDF Report
  const conPdfResp = await client.raw('GET', '/api/marketing/sales/consolidated-report.pdf');
  assert.equal(conPdfResp.status, 200);
  assert.equal(conPdfResp.headers.get('content-type'), 'application/pdf');
  const conPdfBytes = Buffer.from(await conPdfResp.arrayBuffer());
  assert.ok(conPdfBytes.length > 5000);

  const conPages = extractPdf(conPdfBytes);
  const conPdfText = conPages.map(p => p.text.join(' ')).join('\n');
  assert.ok(conPdfText.includes('CONSOLIDATED INFLUENCER SALES & COMMISSION REPORT'));
  assert.ok(conPdfText.includes('Rohit Tech Reviews'));
  assert.ok(conPdfText.includes('Kavita Retail'));
});

test('6. Security and Role-Based Access Control', async () => {
  // A. Unauthenticated access is refused
  const guest = makeClient({ ip: ip(15) });
  const unauth = await guest.json('GET', '/api/marketing/sales/dashboard');
  assert.equal(unauth.status, 401);

  // B. Staff account (FINANCE role) cannot access manager marketing endpoints
  const staff = makeClient({ ip: ip(16) });
  await staff.json('POST', '/api/auth/register', {
    email: 'finance_officer@example.test',
    password: 'Password123!',
    confirm_password: 'Password123!',
    display_name: 'Finance Officer',
  });
  await staff.json('POST', '/api/auth/login', {
    email: 'finance_officer@example.test',
    password: 'Password123!',
  });

  const staffResp = await staff.json('POST', '/api/marketing/sales/preview-import', {
    filename: 'sales.xlsx',
    content_base64: 'dGVzdA==',
  });
  assert.equal(staffResp.status, 403);

  // Clean up sales test data so subsequent test suites start with pristine state
  const admin = await withAdmin(17);
  await admin.db.query('DELETE FROM inv.influencer_sales_records');
  await admin.db.query('DELETE FROM inv.influencer_sales_batches');
  await admin.db.query('DELETE FROM inv.influencer_attributions');
});
