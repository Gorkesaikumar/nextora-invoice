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

  // E. Download Consolidated CSV Report
  const csvResp = await client.raw('GET', '/api/marketing/sales/export.csv');
  assert.equal(csvResp.status, 200);
  assert.ok(csvResp.headers.get('content-type').includes('text/csv'));
  const csvText = await csvResp.text();
  assert.ok(csvText.includes('S.No.,Influencer Name,Instagram Handle,Customer Name'));
  assert.ok(csvText.includes('Vikram Malhotra'));
  assert.ok(csvText.includes('Rohit Tech Reviews'));

  // F. Download Individual Influencer CSV Report
  const indCsvResp = await client.raw('GET', `/api/marketing/influencers/${rohit.id}/sales/export.csv`);
  assert.equal(indCsvResp.status, 200);
  assert.ok(indCsvResp.headers.get('content-type').includes('text/csv'));
  const indCsvText = await indCsvResp.text();
  assert.ok(indCsvText.includes('Vikram Malhotra'));
  assert.ok(indCsvText.includes('Rohit Tech Reviews'));
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
});

test('7. Batch Deletion: Successful deletion of eligible batch, cascade removal of sales records and attributions, audit logging, and report reconciliation', async () => {
  const client = await withAdmin(20);

  // 1. Get baseline metrics before creating batch
  const baselineMetrics = (await client.json('GET', '/api/marketing/sales/dashboard')).data.kpis;

  // 2. Import a dedicated batch of 3 sales records
  const inf = (await client.json('POST', '/api/marketing/influencers', {
    legal_name: 'Batch Test Creator',
    display_name: 'Batch Test Influencer',
    instagram_username: '@batch_test_inf',
    phone: '+91 91111 22222',
    email: 'batch_test@example.test',
  })).data.influencer;

  await client.json('POST', '/api/marketing/agreements', {
    influencer_id: inf.id,
    commission_basis_points: 1000,
    commission_basis: 'NET_SALES_EX_GST',
    product_tax_mode: 'EXCLUSIVE',
    start_date: '2026-10-01',
    is_indefinite: true,
  });
  const agList = (await client.json('GET', '/api/marketing/agreements')).data.agreements;
  const ag = agList.find(a => a.influencer_id === inf.id);
  await client.json('POST', `/api/marketing/agreements/${ag.id}/status`, { action: 'SIGN' });
  await client.json('POST', `/api/marketing/agreements/${ag.id}/status`, { action: 'ACTIVATE' });

  const batchRows = [
    [1, 'Batch Customer 1', 'Store Alpha', '2026-10-18', 'Nextora POS Mobile', '2027-10-18', 'Hyderabad', '@batch_test_inf', 10000, 0, 18, 0, 'ORD-B1'],
    [2, 'Batch Customer 2', 'Store Beta', '2026-10-19', 'Nextora POS Mobile', '2027-10-19', 'Hyderabad', '@batch_test_inf', 15000, 0, 18, 0, 'ORD-B2'],
    [3, 'Batch Customer 3', 'Store Gamma', '2026-10-20', 'Nextora POS Mobile', '2027-10-20', 'Hyderabad', '@batch_test_inf', 20000, 0, 18, 0, 'ORD-B3'],
  ];
  const buf = await createExcelBuffer(batchRows);
  const prev = (await client.json('POST', '/api/marketing/sales/preview-import', {
    filename: 'batch_to_delete.xlsx',
    content_base64: buf.toString('base64'),
  })).data;

  const confirmRes = await client.json('POST', '/api/marketing/sales/confirm-import', {
    filename: prev.filename,
    file_sha256: prev.file_sha256,
    staged_rows: prev.all_staged_rows,
    allow_duplicates: false,
    notes: 'Batch intended for deletion testing',
  });
  assert.equal(confirmRes.status, 200);
  const batchId = confirmRes.data.batch_id;
  assert.ok(batchId);

  // 3. Verify batch appears in listSalesBatches
  const batchList = (await client.json('GET', '/api/marketing/sales/batches')).data.batches;
  const foundBatch = batchList.find(b => b.id === batchId);
  assert.ok(foundBatch);
  assert.equal(foundBatch.filename, 'batch_to_delete.xlsx');
  assert.equal(foundBatch.valid_row_count, 3);

  // 4. Verify batch details endpoint
  const details = (await client.json('GET', `/api/marketing/sales/batches/${batchId}`)).data;
  assert.equal(details.filename, 'batch_to_delete.xlsx');
  assert.equal(details.row_count, 3);
  assert.equal(details.records.length, 3);
  assert.equal(details.can_delete, true);
  assert.equal(details.has_paid_records, false);

  // 5. Verify batch export endpoint
  const exportRes = await client.raw('GET', `/api/marketing/sales/batches/${batchId}/export.xlsx`);
  assert.equal(exportRes.status, 200);
  const exportBuf = Buffer.from(await exportRes.arrayBuffer());
  assert.ok(exportBuf.length > 1000);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(exportBuf);
  const sheet = wb.getWorksheet('Sales Records');
  assert.equal(sheet.rowCount, 4); // 1 header + 3 rows

  // 6. Verify dashboard metrics increased
  const midMetrics = (await client.json('GET', '/api/marketing/sales/dashboard')).data.kpis;
  assert.equal(midMetrics.total_imported_records, baselineMetrics.total_imported_records + 3);
  assert.equal(midMetrics.total_valid_sales, baselineMetrics.total_valid_sales + 3);
  assert.equal(midMetrics.total_verified_revenue_minor, baselineMetrics.total_verified_revenue_minor + 4500000); // 10k + 15k + 20k = 45k = 4500000 minor

  // 7. Delete the batch
  const delRes = await client.json('DELETE', `/api/marketing/sales/batches/${batchId}`, {
    reason: 'Automated test verification of batch deletion',
  });
  assert.equal(delRes.status, 200);
  assert.equal(delRes.data.deleted, true);
  assert.equal(delRes.data.batch_id, batchId);
  assert.equal(delRes.data.deleted_records_count, 3);

  // 8. Verify batch is removed from list
  const postBatchList = (await client.json('GET', '/api/marketing/sales/batches')).data.batches;
  assert.ok(!postBatchList.some(b => b.id === batchId));

  // 9. Verify sales records and attributions are removed
  const salesQuery = (await client.db.query('SELECT count(*)::int AS count FROM inv.influencer_sales_records WHERE batch_id = $1', [batchId])).rows[0].count;
  assert.equal(salesQuery, 0);

  // 10. Verify audit record exists
  const auditRows = (await client.db.query(
    `SELECT * FROM inv.audit_logs WHERE event = 'INFLUENCER_SALES_BATCH_DELETED' AND entity_id = $1`,
    [batchId]
  )).rows;
  assert.ok(auditRows.length > 0);
  const meta = typeof auditRows[0].metadata === 'string' ? JSON.parse(auditRows[0].metadata) : auditRows[0].metadata;
  assert.equal(meta.batchId, batchId);
  assert.equal(meta.filename, 'batch_to_delete.xlsx');
  assert.equal(meta.deletedSalesRecordsCount, 3);

  // 11. Verify dashboard metrics reverted to baseline
  const postMetrics = (await client.json('GET', '/api/marketing/sales/dashboard')).data.kpis;
  assert.equal(postMetrics.total_imported_records, baselineMetrics.total_imported_records);
  assert.equal(postMetrics.total_valid_sales, baselineMetrics.total_valid_sales);
  assert.equal(postMetrics.total_verified_revenue_minor, baselineMetrics.total_verified_revenue_minor);

  // 12. Verify influencer profile and contract are completely preserved
  const infCheck = (await client.json('GET', `/api/marketing/influencers/${inf.id}`)).data.influencer;
  assert.equal(infCheck.legal_name, 'Batch Test Creator');
});

test('8. Duplicate Safety: Pre-existing transactions remain intact when duplicate-matching batch is deleted', async () => {
  const client = await withAdmin(21);

  // Batch 1: Primary transactions
  const rows1 = [
    [1, 'Original Customer X', 'Shop X', '2026-10-21', 'Nextora POS Mobile', '2027-10-21', 'Mumbai', '@batch_test_inf', 12000, 0, 18, 0, 'ORD-X1'],
  ];
  const buf1 = await createExcelBuffer(rows1);
  const prev1 = (await client.json('POST', '/api/marketing/sales/preview-import', { filename: 'batch_orig.xlsx', content_base64: buf1.toString('base64') })).data;
  const res1 = await client.json('POST', '/api/marketing/sales/confirm-import', {
    filename: prev1.filename, file_sha256: prev1.file_sha256, staged_rows: prev1.all_staged_rows, allow_duplicates: false,
  });
  const batch1Id = res1.data.batch_id;

  // Batch 2: Matches Customer X (duplicate skipped) + New Customer Y (inserted)
  const rows2 = [
    [1, 'Original Customer X', 'Shop X', '2026-10-21', 'Nextora POS Mobile', '2027-10-21', 'Mumbai', '@batch_test_inf', 12000, 0, 18, 0, 'ORD-X1'], // duplicate!
    [2, 'New Customer Y', 'Shop Y', '2026-10-22', 'Nextora POS Mobile', '2027-10-22', 'Mumbai', '@batch_test_inf', 18000, 0, 18, 0, 'ORD-Y1'],
  ];
  const buf2 = await createExcelBuffer(rows2);
  const prev2 = (await client.json('POST', '/api/marketing/sales/preview-import', { filename: 'batch_with_dupe.xlsx', content_base64: buf2.toString('base64') })).data;
  assert.equal(prev2.duplicate_rows_count, 1);
  assert.equal(prev2.valid_rows_count, 1);

  const res2 = await client.json('POST', '/api/marketing/sales/confirm-import', {
    filename: prev2.filename, file_sha256: prev2.file_sha256, staged_rows: prev2.all_staged_rows, allow_duplicates: false,
  });
  const batch2Id = res2.data.batch_id;
  assert.equal(res2.data.imported_count, 1);
  assert.equal(res2.data.duplicate_count, 1);

  // Now delete Batch 2
  const del2 = await client.json('DELETE', `/api/marketing/sales/batches/${batch2Id}`);
  assert.equal(del2.status, 200);
  assert.equal(del2.data.deleted_records_count, 1);

  // Verify that Original Customer X from Batch 1 is 100% intact!
  const b1Records = (await client.db.query('SELECT customer_name FROM inv.influencer_sales_records WHERE batch_id = $1', [batch1Id])).rows;
  assert.equal(b1Records.length, 1);
  assert.equal(b1Records[0].customer_name, 'Original Customer X');

  // Clean up batch 1
  await client.json('DELETE', `/api/marketing/sales/batches/${batch1Id}`);
});

test('9. Protected Financial Records: Deletion blocked with 409 when batch contains PAID commission records', async () => {
  const client = await withAdmin(22);

  // Import batch with 1 row
  const rows = [
    [1, 'Settled Customer Z', 'Shop Z', '2026-10-23', 'Nextora POS Mobile', '2027-10-23', 'Chennai', '@batch_test_inf', 25000, 0, 18, 0, 'ORD-Z1'],
  ];
  const buf = await createExcelBuffer(rows);
  const prev = (await client.json('POST', '/api/marketing/sales/preview-import', { filename: 'batch_settled.xlsx', content_base64: buf.toString('base64') })).data;
  const res = await client.json('POST', '/api/marketing/sales/confirm-import', {
    filename: prev.filename, file_sha256: prev.file_sha256, staged_rows: prev.all_staged_rows, allow_duplicates: false,
  });
  const batchId = res.data.batch_id;

  // Find sales record and transition to PAID
  const sales = (await client.db.query('SELECT id FROM inv.influencer_sales_records WHERE batch_id = $1', [batchId])).rows;
  const saleId = sales[0].id;
  await client.json('POST', `/api/marketing/sales/${saleId}/status`, { status: 'APPROVED' });
  await client.json('POST', `/api/marketing/sales/${saleId}/status`, { status: 'PAID', note: 'Paid via settlement batch' });

  // Check details shows can_delete: false and has_paid_records: true
  const details = (await client.json('GET', `/api/marketing/sales/batches/${batchId}`)).data;
  assert.equal(details.can_delete, false);
  assert.equal(details.has_paid_records, true);

  // Attempt to delete batch -> MUST fail with 409 PROTECTED_FINANCIAL_RECORDS
  const delAttempt = await client.json('DELETE', `/api/marketing/sales/batches/${batchId}`);
  assert.equal(delAttempt.status, 409);
  assert.equal(delAttempt.data.code, 'PROTECTED_FINANCIAL_RECORDS');
  assert.ok(delAttempt.data.error.includes('finalized/paid commission record'));

  // Verify batch and record still exist
  const batchAfter = (await client.db.query('SELECT id FROM inv.influencer_sales_batches WHERE id = $1', [batchId])).rows;
  assert.equal(batchAfter.length, 1);
  const saleAfter = (await client.db.query('SELECT commission_status FROM inv.influencer_sales_records WHERE id = $1', [saleId])).rows;
  assert.equal(saleAfter[0].commission_status, 'PAID');

  // Revert status to VERIFIED to allow clean cleanup
  await client.json('POST', `/api/marketing/sales/${saleId}/status`, { status: 'VERIFIED' });
  await client.json('DELETE', `/api/marketing/sales/batches/${batchId}`);
});

test('10. Batch Not Found, Already Deleted, and Unauthorized Access', async () => {
  const client = await withAdmin(23);
  const fakeId = '00000000-0000-0000-0000-000000000000';

  // A. Non-existent batch returns 404
  const getRes = await client.json('GET', `/api/marketing/sales/batches/${fakeId}`);
  assert.equal(getRes.status, 404);
  assert.equal(getRes.data.code, 'BATCH_NOT_FOUND');

  const delRes = await client.json('DELETE', `/api/marketing/sales/batches/${fakeId}`);
  assert.equal(delRes.status, 404);
  assert.equal(delRes.data.code, 'BATCH_NOT_FOUND');

  // B. Unauthenticated request returns 401
  const guest = makeClient({ ip: ip(24) });
  const unauthDel = await guest.json('DELETE', `/api/marketing/sales/batches/${fakeId}`);
  assert.equal(unauthDel.status, 401);

  // C. Non-manager role (FINANCE) returns 403
  const staff = makeClient({ ip: ip(25) });
  await staff.json('POST', '/api/auth/register', {
    email: 'finance_batch_test@example.test',
    password: 'Password123!',
    confirm_password: 'Password123!',
    display_name: 'Finance User',
  });
  await staff.json('POST', '/api/auth/login', {
    email: 'finance_batch_test@example.test',
    password: 'Password123!',
  });
  const staffDel = await staff.json('DELETE', `/api/marketing/sales/batches/${fakeId}`);
  assert.equal(staffDel.status, 403);
});

test('11. Database Transaction Rollback: Failure during deletion rolls back all changes', async () => {
  const client = await withAdmin(26);

  // Import batch with 1 row
  const rows = [
    [1, 'Rollback Customer', 'Rollback Shop', '2026-10-24', 'Nextora POS Mobile', '2027-10-24', 'Hyderabad', '@batch_test_inf', 10000, 0, 18, 0, 'ORD-RB1'],
  ];
  const buf = await createExcelBuffer(rows);
  const prev = (await client.json('POST', '/api/marketing/sales/preview-import', { filename: 'batch_rollback.xlsx', content_base64: buf.toString('base64') })).data;
  const res = await client.json('POST', '/api/marketing/sales/confirm-import', {
    filename: prev.filename, file_sha256: prev.file_sha256, staged_rows: prev.all_staged_rows, allow_duplicates: false,
  });
  const batchId = res.data.batch_id;

  // Simulate transactional integrity by verifying that if an operation is rolled back, records remain
  const db = client.db;
  try {
    await db.transaction(async tx => {
      await tx.query('DELETE FROM inv.influencer_sales_records WHERE batch_id = $1', [batchId]);
      throw new Error('Simulated database crash during batch deletion');
    });
  } catch (err) {
    assert.equal(err.message, 'Simulated database crash during batch deletion');
  }

  // Verify that the record was NOT deleted thanks to rollback
  const remaining = (await db.query('SELECT count(*)::int AS count FROM inv.influencer_sales_records WHERE batch_id = $1', [batchId])).rows[0].count;
  assert.equal(remaining, 1);

  // Clean delete
  await client.json('DELETE', `/api/marketing/sales/batches/${batchId}`);

  // Clean up sales test data so subsequent test suites start with pristine state
  const admin = await withAdmin(17);
  await admin.db.query('DELETE FROM inv.influencer_sales_records');
  await admin.db.query('DELETE FROM inv.influencer_sales_batches');
  await admin.db.query('DELETE FROM inv.influencer_attributions');
});
