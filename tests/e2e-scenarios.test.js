import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { makeClient, configureIssuer, OWNER, draft } from './helpers.js';
import { extractPdf } from './pdf-text.js';

const ip = suffix => `10.9.5.${suffix}`;

async function withAdmin(suffix = 1) {
  const client = makeClient({ ip: ip(suffix) });
  await client.login(OWNER);
  await configureIssuer(client);
  return client;
}

test('E2E Scenario 1: Customer creation in POS Customers Tracker', async () => {
  const client = await withAdmin(1);

  // 1. Fetch reference catalog
  const ref = (await client.json('GET', '/api/tracker/reference')).data;
  assert.ok(ref.columns.length > 0);

  // 2. Add Customer
  const createRes = await client.json('POST', '/api/tracker/customers', {
    name: 'E2E Cafe Royale',
    business_name: 'Royale F&B Ltd',
    address: '101 MG Road, Bengaluru',
    phone: '+91 99887 76655',
    email: 'contact@caferoyale.test',
  });
  assert.equal(createRes.status, 201);
  const customerId = createRes.data.customer.id;
  assert.ok(customerId);

  // 3. Verify record appears in customer list and persists
  const listRes = (await client.json('GET', '/api/tracker/customers?search=Royale')).data;
  const match = listRes.customers.find(c => c.id === customerId);
  assert.ok(match, 'Customer must appear in search results');
  assert.equal(match.name, 'E2E Cafe Royale');
  assert.equal(match.business_name, 'Royale F&B Ltd');
});

test('E2E Scenario 2: GST-exclusive invoice pricing (₹5,999 + 18% GST = ₹7,078.82)', async () => {
  const client = await withAdmin(2);

  // Ensure business setting is EXCLUSIVE
  await configureIssuer(client, { product_price_tax_mode: 'EXCLUSIVE' });

  // Create client
  const cRes = (await client.json('POST', '/api/clients', {
    kind: 'BUSINESS', name: 'Exclusive Buyer Ltd', state_code: '36', country: 'India',
  })).data.client;

  // Create invoice for ₹5,999 with 18% GST in EXCLUSIVE mode
  const invRes = (await client.json('POST', '/api/invoices', {
    client_id: cRes.id,
    title: 'POS License Invoice (Exclusive)',
    place_of_supply_state_code: '36',
    issue_date: '2026-10-25',
    payment_terms_days: 15,
    round_off_enabled: false, // exact paise before round-off
    items: [{
      description: 'Nextora POS Mobile License',
      unit: 'NOS',
      quantity_milli: 1000,
      unit_price_minor: 599900, // ₹5,999.00
      tax_rate_bp: 1800, // 18%
      tax_treatment: 'TAXABLE',
    }],
  })).data.invoice;

  // Expected totals before round-off:
  // Taxable: ₹5,999.00 = 599900 minor
  // Tax (18%): ₹1,079.82 = 107982 minor
  // Total: ₹7,078.82 = 707882 minor
  assert.equal(invRes.totals.taxable_total_minor, 599900);
  assert.equal(invRes.totals.tax_total_minor, 107982);
  assert.equal(invRes.totals.grand_total_minor, 707882);

  // Issue invoice & generate PDF
  await client.json('POST', `/api/invoices/${invRes.id}/issue`);
  const pdfBytes = Buffer.from(await (await client.raw('GET', `/api/invoices/${invRes.id}/pdf`)).arrayBuffer());
  const pages = extractPdf(pdfBytes);
  const pdfText = pages.map(p => p.text.join(' ')).join('\n');
  assert.ok(pdfText.includes('7,078.82'), 'PDF must reflect exact exclusive total');
});

test('E2E Scenario 3: GST-inclusive invoice pricing (₹5,999 includes 18% GST -> ₹5,999.00 customer total)', async () => {
  const client = await withAdmin(3);

  // Switch business setting to INCLUSIVE
  await configureIssuer(client, { product_price_tax_mode: 'INCLUSIVE' });

  // Create client
  const cRes = (await client.json('POST', '/api/clients', {
    kind: 'INDIVIDUAL', name: 'Inclusive Retailer', state_code: '36', country: 'India',
  })).data.client;

  // Create invoice for ₹5,999 with 18% GST in INCLUSIVE mode
  const invRes = (await client.json('POST', '/api/invoices', {
    client_id: cRes.id,
    title: 'POS License Invoice (Inclusive)',
    place_of_supply_state_code: '36',
    issue_date: '2026-10-25',
    payment_terms_days: 15,
    items: [{
      description: 'Nextora POS Mobile License (All-Inclusive)',
      unit: 'NOS',
      quantity_milli: 1000,
      unit_price_minor: 599900, // ₹5,999.00
      tax_rate_bp: 1800, // 18%
      tax_treatment: 'TAXABLE',
    }],
  })).data.invoice;

  // Expected totals:
  // Grand total remains ₹5,999.00 = 599900 minor
  // Taxable: round(599900 * 10000 / 11800) = 508390 (₹5,083.90)
  // Tax: 599900 - 508390 = 91510 (₹915.10)
  assert.equal(invRes.totals.grand_total_minor, 599900, 'Customer total remains exactly ₹5,999.00 in inclusive mode');
  assert.equal(invRes.totals.taxable_total_minor, 508390);
  assert.equal(invRes.totals.tax_total_minor, 91510);

  // Issue invoice & generate PDF
  await client.json('POST', `/api/invoices/${invRes.id}/issue`);
  const pdfBytes = Buffer.from(await (await client.raw('GET', `/api/invoices/${invRes.id}/pdf`)).arrayBuffer());
  const pages = extractPdf(pdfBytes);
  const pdfText = pages.map(p => p.text.join(' ')).join('\n');
  assert.ok(pdfText.includes('5,999.00'), 'PDF grand total must be ₹5,999.00');
});

test('E2E Scenario 4: Influencer agreement creation, commercial terms, and PDF download', async () => {
  const client = await withAdmin(4);

  // 1. Create Influencer
  const inf = (await client.json('POST', '/api/marketing/influencers', {
    legal_name: 'Sneha Sengupta',
    display_name: 'Sneha Tech Guides',
    instagram_username: '@sneha_tech',
    phone: '+91 97766 55443',
    email: 'sneha@example.test',
    city: 'Kolkata',
    state_code: '19',
  })).data.influencer;

  // 2. Configure Agreement with 12% commission, Net Sales Ex GST basis
  const agr = (await client.json('POST', '/api/marketing/agreements', {
    influencer_id: inf.id,
    title: 'Influencer Marketing Partnership — Nextora POS',
    commission_basis_points: 1200, // 12%
    commission_basis: 'NET_SALES_EX_GST',
    product_tax_mode: 'EXCLUSIVE',
    start_date: '2026-11-01',
    end_date: '2027-10-31',
    payment_frequency: 'MONTHLY',
    payment_due_days: 15,
  })).data.agreement;

  assert.equal(agr.commission_basis_points, 1200);
  assert.equal(agr.status, 'DRAFT');

  // 3. Status Lifecycle: Sign and Activate
  await client.json('POST', `/api/marketing/agreements/${agr.id}/status`, { action: 'SIGN' });
  await client.json('POST', `/api/marketing/agreements/${agr.id}/status`, { action: 'ACTIVATE' });

  // 4. Generate & Download Contract PDF
  const pdfResp = await client.raw('GET', `/api/marketing/agreements/${agr.id}/pdf`);
  assert.equal(pdfResp.status, 200);
  assert.equal(pdfResp.headers.get('content-type'), 'application/pdf');

  const pdfBytes = Buffer.from(await pdfResp.arrayBuffer());
  const pages = extractPdf(pdfBytes);
  const fullText = pages.map(p => p.text.join(' ')).join('\n');
  assert.ok(fullText.includes('INFLUENCER MARKETING & REVENUE-SHARING AGREEMENT'));
  assert.ok(fullText.includes('Sneha Sengupta'));
  assert.ok(fullText.includes('12.00%'));
  assert.ok(fullText.includes('SECTION 10: ACCEPTANCE & EXECUTION'));
});

test('E2E Scenario 5: Excel sales import, preview, influencer remapping, and confirmation', async () => {
  const client = await withAdmin(5);

  const { data: infList } = await client.json('GET', '/api/marketing/influencers');
  const sneha = infList.influencers.find(i => i.instagram_username === '@sneha_tech');
  assert.ok(sneha);

  // Build Excel with 1 matched, 1 unmatched, 1 duplicate, 1 unverified
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sales');
  ws.addRow([
    'S.No.', 'Customer Name', 'Business Name', 'Purchased Date', 'Product Name',
    'Expiry Date', 'Customer Location', 'Influencer Name', 'Sale Amount', 'Discount',
    'GST Rate %', 'Refund Amount', 'Order Reference'
  ]);
  ws.addRow([1, 'Anil Kapoor', 'Kapoor Stores', '2026-10-10', 'Nextora POS Desktop', '2027-10-10', 'Mumbai', '@sneha_tech', 15000, 0, 18, 0, 'E2E-ORD-1']);
  ws.addRow([2, 'Deepa Sen', 'Sen Opticals', '2026-10-12', 'Nextora POS Mobile', 'Lifetime', 'Kolkata', 'Unmatched Creator', 5999, 0, 18, 0, 'E2E-ORD-2']);
  ws.addRow([3, 'Anil Kapoor', 'Kapoor Stores', '2026-10-10', 'Nextora POS Desktop', '2027-10-10', 'Mumbai', '@sneha_tech', 15000, 0, 18, 0, 'E2E-ORD-1']); // duplicate

  const excelBytes = Buffer.from(await wb.xlsx.writeBuffer());

  // Preview
  const preview = (await client.json('POST', '/api/marketing/sales/preview-import', {
    filename: 'e2e_sales.xlsx',
    content_base64: excelBytes.toString('base64'),
  })).data;

  assert.equal(preview.total_rows, 3);
  assert.equal(preview.valid_rows_count, 2);
  assert.equal(preview.duplicate_rows_count, 1);
  assert.equal(preview.unmatched_influencer_count, 1);

  // Confirm with remapping 'Unmatched Creator' -> sneha.id
  const confirm = (await client.json('POST', '/api/marketing/sales/confirm-import', {
    filename: preview.filename,
    file_sha256: preview.file_sha256,
    staged_rows: preview.all_staged_rows,
    influencer_mappings: { 'Unmatched Creator': sneha.id },
    allow_duplicates: false,
  })).data;

  assert.equal(confirm.imported_count, 2);
  assert.equal(confirm.duplicate_count, 1);

  // Verify batch appears in history
  const batches = (await client.json('GET', '/api/marketing/sales/batches')).data.batches;
  assert.ok(batches.some(b => b.filename === 'e2e_sales.xlsx'));
});

test('E2E Scenario 6: Revenue calculation and reproducible financial settlement', async () => {
  const client = await withAdmin(6);

  const { data: infList } = await client.json('GET', '/api/marketing/influencers');
  const sneha = infList.influencers.find(i => i.instagram_username === '@sneha_tech');

  const sales = (await client.json('GET', `/api/marketing/influencers/${sneha.id}/sales`)).data.records;
  assert.equal(sales.length, 2);

  // Sale 1: Anil Kapoor, ₹15,000, 12% commission
  const sale1 = sales.find(s => s.customer_name === 'Anil Kapoor');
  assert.ok(sale1);
  assert.equal(sale1.sale_amount_minor, 1500000);
  assert.equal(sale1.eligible_revenue_minor, 1500000);
  // 12% of 15,000 = 1,800.00 = 180000 minor
  assert.equal(sale1.calculated_commission_minor, 180000);
  assert.equal(sale1.commission_status, 'VERIFIED');

  // Verify settlement transition: approve and mark paid
  await client.json('POST', `/api/marketing/sales/${sale1.id}/status`, { status: 'APPROVED' });
  await client.json('POST', `/api/marketing/sales/${sale1.id}/status`, { status: 'PAID' });

  const updatedSale1 = (await client.json('GET', `/api/marketing/influencers/${sneha.id}/sales`)).data.records
    .find(s => s.id === sale1.id);
  assert.equal(updatedSale1.commission_status, 'PAID');
});

test('E2E Scenario 7: Individual influencer sales report PDF generation', async () => {
  const client = await withAdmin(7);

  const { data: infList } = await client.json('GET', '/api/marketing/influencers');
  const sneha = infList.influencers.find(i => i.instagram_username === '@sneha_tech');

  const pdfResp = await client.raw('GET', `/api/marketing/influencers/${sneha.id}/sales/report.pdf`);
  assert.equal(pdfResp.status, 200);
  assert.equal(pdfResp.headers.get('content-type'), 'application/pdf');

  const pdfBytes = Buffer.from(await pdfResp.arrayBuffer());
  assert.ok(pdfBytes.length > 5000);
  const pages = extractPdf(pdfBytes);
  const pdfText = pages.map(p => p.text.join(' ')).join('\n');
  assert.ok(pdfText.includes('INFLUENCER SALES & REVENUE-SHARING REPORT'));
  assert.ok(pdfText.includes('Sneha Tech Guides'));
  assert.ok(pdfText.includes('Anil Kapoor'));
  assert.ok(pdfText.includes('Deepa Sen'));
  assert.ok(pdfText.includes('SECTION 1 — EXECUTIVE SUMMARY'));
});

test('E2E Scenario 8: Consolidated all-influencer sales report PDF generation', async () => {
  const client = await withAdmin(8);

  const pdfResp = await client.raw('GET', '/api/marketing/sales/consolidated-report.pdf');
  assert.equal(pdfResp.status, 200);
  assert.equal(pdfResp.headers.get('content-type'), 'application/pdf');

  const pdfBytes = Buffer.from(await pdfResp.arrayBuffer());
  assert.ok(pdfBytes.length > 5000);
  const pages = extractPdf(pdfBytes);
  const pdfText = pages.map(p => p.text.join(' ')).join('\n');
  assert.ok(pdfText.includes('CONSOLIDATED INFLUENCER SALES & COMMISSION REPORT'));
  assert.ok(pdfText.includes('Sneha Tech Guides'));
  assert.ok(pdfText.includes('SECTION 1 — EXECUTIVE SUMMARY'));
});

test('E2E Scenario 9: Existing application regression (quotations, payments, exports)', async () => {
  const client = await withAdmin(9);

  // 1. Create client
  const cRes = (await client.json('POST', '/api/clients', {
    kind: 'INDIVIDUAL', name: 'Regression Client', state_code: '36', country: 'India',
  })).data.client;

  // 2. Create quotation
  const qCreated = client.ok(await client.json('POST', '/api/quotations', draft(cRes.id, {
    title: 'Regression Quotation',
    issue_date: '2026-10-25',
  }))).quotation;
  assert.equal(qCreated.status, 'DRAFT');

  // 3. Send quotation & convert to invoice
  await client.json('POST', `/api/quotations/${qCreated.id}/send`);
  await client.json('POST', `/api/quotations/${qCreated.id}/transition`, { status: 'ACCEPTED', note: 'Customer accepted' });
  const convertRes = client.ok(await client.json('POST', `/api/quotations/${qCreated.id}/convert`, { issue_date: '2026-10-25' }));
  const invoiceId = convertRes.invoice.id;
  assert.ok(invoiceId);

  // 4. Issue invoice and record full payment
  await client.json('POST', `/api/invoices/${invoiceId}/issue`);
  const invoiceData = client.ok(await client.json('GET', `/api/invoices/${invoiceId}`)).invoice;

  const payRes = await client.json('POST', `/api/invoices/${invoiceId}/payments`, {
    amount_minor: invoiceData.totals.grand_total_minor,
    method: 'BANK_TRANSFER',
    paid_on: '2026-10-25',
    reference: 'E2E-UTR-12345',
  });
  assert.equal(payRes.status, 201);

  // 5. Verify payment status is PAID
  const paidInvoice = client.ok(await client.json('GET', `/api/invoices/${invoiceId}`));
  assert.equal(paidInvoice.payment_status, 'PAID');
  assert.equal(paidInvoice.balance_due_minor, 0);

  // Clean up sales test data so subsequent test suites start clean
  await client.db.query('DELETE FROM inv.influencer_sales_records');
  await client.db.query('DELETE FROM inv.influencer_sales_batches');
  await client.db.query('DELETE FROM inv.influencer_attributions');
  await client.db.query('DELETE FROM inv.influencer_agreements');
  await client.db.query('DELETE FROM inv.influencers');
});
