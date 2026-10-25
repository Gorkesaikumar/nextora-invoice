import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { makeClient, configureIssuer, baseClient, baseProduct, draft, line } from './helpers.js';
import { resolveDatePreset, DATE_PRESETS } from '../server/date-presets.js';
import { compareMetrics } from '../server/reports.js';

test('date presets and comparison bounds follow Indian Financial Year cycle', () => {
  // Base date: 15 October 2026 (FY 2026-27, Q3)
  const baseDate = new Date(2026, 9, 15);

  const thisFy = resolveDatePreset('this_fy', { baseDate });
  assert.equal(thisFy.from, '2026-04-01', 'Current FY starts April 1');
  assert.equal(thisFy.to, '2026-10-15');
  assert.equal(thisFy.prior.from, '2025-04-01');
  assert.equal(thisFy.prior.to, '2025-10-15');

  const lastFy = resolveDatePreset('last_fy', { baseDate });
  assert.equal(lastFy.from, '2025-04-01');
  assert.equal(lastFy.to, '2026-03-31');
  assert.equal(lastFy.prior.from, '2024-04-01');
  assert.equal(lastFy.prior.to, '2025-03-31');

  const thisQuarter = resolveDatePreset('this_quarter', { baseDate });
  assert.equal(thisQuarter.from, '2026-10-01', 'Q3 starts October 1');
  assert.equal(thisQuarter.to, '2026-10-15');
  assert.equal(thisQuarter.prior.from, '2026-07-01', 'Prior quarter Q2 starts July 1');
  assert.equal(thisQuarter.prior.to, '2026-09-30');

  const lastQuarter = resolveDatePreset('last_quarter', { baseDate });
  assert.equal(lastQuarter.from, '2026-07-01');
  assert.equal(lastQuarter.to, '2026-09-30');

  const thisMonth = resolveDatePreset('this_month', { baseDate });
  assert.equal(thisMonth.from, '2026-10-01');
  assert.equal(thisMonth.to, '2026-10-15');
  assert.equal(thisMonth.prior.from, '2026-09-01');
  assert.equal(thisMonth.prior.to, '2026-09-15');

  const lastMonth = resolveDatePreset('last_month', { baseDate });
  assert.equal(lastMonth.from, '2026-09-01');
  assert.equal(lastMonth.to, '2026-09-30');

  const last7Days = resolveDatePreset('last_7_days', { baseDate });
  assert.equal(last7Days.from, '2026-10-09');
  assert.equal(last7Days.to, '2026-10-15');

  const last30Days = resolveDatePreset('last_30_days', { baseDate });
  assert.equal(last30Days.from, '2026-09-16');
  assert.equal(last30Days.to, '2026-10-15');

  assert.equal(DATE_PRESETS.length, 14, 'All 14 presets defined');
});

test('compareMetrics computes percentage changes and handles zero-baselines correctly', () => {
  // Normal growth
  const growth = compareMetrics(1500000, 1000000);
  assert.equal(growth.diff, 500000);
  assert.equal(growth.percent, 50);
  assert.equal(growth.trend, 'up');

  // Normal decline
  const decline = compareMetrics(750000, 1000000);
  assert.equal(decline.diff, -250000);
  assert.equal(decline.percent, -25);
  assert.equal(decline.trend, 'down');

  // Zero-baseline: prior is 0 and current > 0 -> +100%
  const fromZero = compareMetrics(500000, 0);
  assert.equal(fromZero.diff, 500000);
  assert.equal(fromZero.percent, 100);
  assert.equal(fromZero.trend, 'up');

  // Zero-baseline: both 0 -> 0%
  const bothZero = compareMetrics(0, 0);
  assert.equal(bothZero.diff, 0);
  assert.equal(bothZero.percent, 0);
  assert.equal(bothZero.trend, 'flat');
});

test('business overview, sales comparisons, product analytics, and customer statements', async () => {
  const client = makeClient({ ip: '10.9.9.9' });
  await client.login();
  await configureIssuer(client);

  // Setup customers
  const custAlpha = client.ok(await client.json('POST', '/api/clients',
    baseClient({ name: 'Alpha Reports Co', company_name: 'Alpha Reports Pvt Ltd', gstin: '36AABCU9603R1ZO' })));
  const custBeta = client.ok(await client.json('POST', '/api/clients',
    baseClient({ name: 'Beta Reports Co', company_name: 'Beta Reports LLP', gstin: '36BBBCU9603R1Z1' })));

  // Setup products
  const prodPos = client.ok(await client.json('POST', '/api/products',
    baseProduct({ name: 'Nextora POS Pro Rep', sku: 'NCPOS-REP', unit_price_minor: 5000000, category: 'Software' })));
  const prodCustom = client.ok(await client.json('POST', '/api/products',
    baseProduct({ name: 'Custom Cloud Rep', sku: 'NCS-REP', unit_price_minor: 10000000, category: 'Services' })));
  const prodUnused = client.ok(await client.json('POST', '/api/products',
    baseProduct({ name: 'Hardware Scanner Rep', sku: 'NCHW-REP', unit_price_minor: 3500000, category: 'Hardware' })));

  // Invoice 1: Client Alpha, 2 units of POS Pro on 2026-09-10
  const draft1 = client.ok(await client.json('POST', '/api/invoices',
    draft(custAlpha.client.id, {
      issue_date: '2026-09-10',
      due_date: '2026-09-25',
      place_of_supply_state_code: '36',
      items: [line({
        product_id: prodPos.product.id,
        description: 'Nextora POS Pro Rep',
        quantity_milli: 2000,
        unit_price_minor: 5000000,
        tax_rate_bp: 1800,
      })],
    })));
  const inv1 = client.ok(await client.json('POST', `/api/invoices/${draft1.invoice.id}/issue`));

  // Invoice 2: Client Beta, 1 unit of Custom Cloud on 2026-09-15
  const draft2 = client.ok(await client.json('POST', '/api/invoices',
    draft(custBeta.client.id, {
      issue_date: '2026-09-15',
      due_date: '2026-09-30',
      place_of_supply_state_code: '36',
      items: [line({
        product_id: prodCustom.product.id,
        description: 'Custom Cloud Rep',
        quantity_milli: 1000,
        unit_price_minor: 10000000,
        tax_rate_bp: 1800,
      })],
    })));
  const inv2 = client.ok(await client.json('POST', `/api/invoices/${draft2.invoice.id}/issue`));

  // Record payment on Invoice 1: 4,000,000 minor on 2026-09-20
  client.ok(await client.json('POST', `/api/invoices/${inv1.invoice.id}/payments`, {
    amount_minor: 4000000,
    paid_on: '2026-09-20',
    method: 'BANK_TRANSFER',
    reference: 'UTR-ALPHA-01',
    notes: 'Advance installment',
  }));

  /* ------------------- 1. Test Business Overview API ------------------- */
  const overviewRes = client.ok(await client.json('GET', '/api/reports/overview?from=2026-09-01&to=2026-09-30'));
  assert.ok(overviewRes.metrics, 'Overview returns metrics');
  assert.ok(overviewRes.metrics.invoiced.current >= 23600000, 'Invoiced sales reflects issued invoices');
  assert.equal(overviewRes.metrics.collected.current, 4000000, 'Collections reflects recorded payments');
  assert.ok(overviewRes.metrics.receivables.total_minor >= 19600000, 'Receivables reflects balance due');
  assert.equal(overviewRes.metrics.active_clients, 2, '2 active clients in range');
  assert.ok(overviewRes.top_products.length >= 2, 'Top products listed');
  assert.ok(overviewRes.top_clients.length >= 2, 'Top clients listed');

  /* ------------------- 2. Test Product Sales Analytics ------------------- */
  const prodRes = client.ok(await client.json('GET', '/api/reports/revenue-by-product?from=2026-09-01&to=2026-09-30'));
  assert.ok(prodRes.rows.length >= 2);
  const posRow = prodRes.rows.find(r => r.sku === 'NCPOS-REP');
  assert.ok(posRow, 'POS Pro found with SKU');
  assert.equal(posRow.quantity_milli, 2000, 'Quantity sold matches');
  assert.equal(posRow.invoices, 1, 'Distinct invoice count matches');
  assert.equal(posRow.clients, 1, 'Distinct client count matches');
  assert.equal(posRow.average_price_minor, 5000000, 'Average price computed accurately');
  assert.ok(posRow.contribution_pct, 'Contribution percentage computed');

  // Test zero-sales products
  const zeroRes = client.ok(await client.json('GET', '/api/reports/revenue-by-product?from=2026-09-01&to=2026-09-30&zero_sales=true'));
  assert.ok(zeroRes.zero_sales_rows.some(r => r.sku === 'NCHW-REP'), 'Zero-sales catalog item identified');

  // Test limit
  const limitRes = client.ok(await client.json('GET', '/api/reports/revenue-by-product?from=2026-09-01&to=2026-09-30&limit=1'));
  assert.equal(limitRes.rows.length, 1, 'Limit parameter restricts returned row count');

  /* ------------------- 3. Test Revenue By Client ------------------- */
  const clientRes = client.ok(await client.json('GET', '/api/reports/revenue-by-client?from=2026-09-01&to=2026-09-30'));
  const alphaRow = clientRes.rows.find(r => r.id === custAlpha.client.id);
  assert.ok(alphaRow, 'Client Alpha found');
  assert.equal(alphaRow.invoiced_minor, 11800000, 'Client invoiced minor matches');
  assert.equal(alphaRow.collected_minor, 4000000, 'Client collected minor matches');
  assert.equal(alphaRow.balance_minor, 7800000, 'Client balance minor matches');
  assert.equal(alphaRow.invoice_count, 1, 'Client invoice count matches');
  assert.equal(alphaRow.first_invoice_date, '2026-09-10');

  /* ------------------- 4. Test Customer Statement ------------------- */
  const statementRes = client.ok(await client.json('GET', `/api/reports/statement?client_id=${custAlpha.client.id}&from=2026-09-01&to=2026-09-30`));
  assert.equal(statementRes.client.id, custAlpha.client.id);
  assert.equal(statementRes.opening_balance_minor, 0, 'Opening balance is 0 before period');
  assert.equal(statementRes.transactions.length, 2, '2 transactions (1 invoice + 1 payment)');
  assert.equal(statementRes.transactions[0].trans_type, 'INVOICE');
  assert.equal(statementRes.transactions[0].debit_minor, 11800000);
  assert.equal(statementRes.transactions[0].balance_minor, 11800000);
  assert.equal(statementRes.transactions[1].trans_type, 'PAYMENT');
  assert.equal(statementRes.transactions[1].credit_minor, 4000000);
  assert.equal(statementRes.transactions[1].balance_minor, 7800000);
  assert.equal(statementRes.closing_balance_minor, 7800000, 'Closing balance reconciled');

  /* ------------------- 5. Test PDF Export for All Sections ------------------- */
  const sectionsToTest = [
    { section: 'overview', landscape: false },
    { section: 'invoices', landscape: true },
    { section: 'collections', landscape: true },
    { section: 'receivables', landscape: true },
    { section: 'quotations', landscape: true },
    { section: 'products', landscape: true },
    { section: 'clients', landscape: true },
    { section: 'tax', landscape: true },
    { section: 'statement', landscape: false, extra: `&client_id=${custAlpha.client.id}` },
  ];

  for (const item of sectionsToTest) {
    const url = `/api/reports/export-pdf?section=${item.section}&from=2026-09-01&to=2026-09-30${item.extra || ''}`;
    const pdfBin = await client.binary('GET', url);
    assert.equal(pdfBin.status, 200, `${item.section} PDF export returned 200`);
    assert.match(pdfBin.headers.get('content-type'), /application\/pdf/, `${item.section} returns application/pdf`);

    // Verify it is a valid, parseable PDF document
    const parsedPdf = await PDFDocument.load(pdfBin.bytes);
    assert.ok(parsedPdf.getPageCount() >= 1, `${item.section} generated at least 1 page`);

    const firstPage = parsedPdf.getPage(0);
    const { width, height } = firstPage.getSize();
    if (item.landscape) {
      assert.ok(width > height, `${item.section} orientation is landscape (width: ${width} > height: ${height})`);
    } else {
      assert.ok(height > width, `${item.section} orientation is portrait (height: ${height} > width: ${width})`);
    }
  }

  /* ------------------- 6. Test Semantic HTML Export ------------------- */
  const htmlRes = await client.raw('GET', '/api/reports/export-pdf?section=overview&format=html&from=2026-09-01&to=2026-09-30');
  assert.equal(htmlRes.status, 200);
  assert.match(htmlRes.headers.get('content-type'), /text\/html/);
  const htmlText = await htmlRes.text();
  assert.match(htmlText, /<!DOCTYPE html>/, 'HTML report has doctype');
  assert.match(htmlText, /table-header-group/, 'Print CSS repeating header rule included');
  assert.match(htmlText, /Executive Business Overview/, 'Report title present');
  assert.match(htmlText, /Alpha Reports Co/, 'Client data present in HTML table');

  /* ------------------- 7. Test CSV Exports Preservation ------------------- */
  const prodCsv = await client.binary('GET', '/api/reports/revenue-by-product?from=2026-09-01&to=2026-09-30&format=csv');
  assert.equal(prodCsv.status, 200);
  const prodCsvBody = prodCsv.bytes.toString('utf8');
  assert.match(prodCsvBody, /Item description,SKU,Category/);
  assert.match(prodCsvBody, /NCPOS-REP/);

  const clientCsv = await client.binary('GET', '/api/reports/revenue-by-client?from=2026-09-01&to=2026-09-30&format=csv');
  assert.equal(clientCsv.status, 200);
  const clientCsvBody = clientCsv.bytes.toString('utf8');
  assert.match(clientCsvBody, /Client name,Company/);
  assert.match(clientCsvBody, /Alpha Reports Co/);

  const stmtCsv = await client.binary('GET', `/api/reports/statement?client_id=${custAlpha.client.id}&from=2026-09-01&to=2026-09-30&format=csv`);
  assert.equal(stmtCsv.status, 200);
  const stmtCsvBody = stmtCsv.bytes.toString('utf8');
  assert.match(stmtCsvBody, /Date,Type,Document/);
  assert.match(stmtCsvBody, /Running Balance/);
});

test('comprehensive business intelligence: monthly revenue, influencer registers, imports, and multi-format exports (PDF, Excel, CSV)', async () => {
  const client = makeClient({ ip: '10.9.9.10' });
  await client.login();
  await configureIssuer(client);

  // 1. Monthly Revenue endpoint
  const monthlyRes = client.ok(await client.json('GET', '/api/reports/monthly-revenue?from=2026-04-01&to=2027-03-31'));
  assert.ok(Array.isArray(monthlyRes.rows), 'Monthly revenue returns rows array');
  assert.ok(monthlyRes.totals, 'Monthly revenue returns totals');
  assert.ok('net_invoiced_minor' in monthlyRes.totals, 'Totals has net_invoiced_minor');

  // 2. Client Register endpoint
  const clientRegRes = client.ok(await client.json('GET', '/api/reports/client-register?from=2026-04-01&to=2027-03-31'));
  assert.ok(Array.isArray(clientRegRes.rows), 'Client register returns rows array');
  assert.ok(clientRegRes.totals, 'Client register returns totals');

  // 3. Influencer Register endpoint
  const infRegRes = client.ok(await client.json('GET', '/api/reports/influencer-register?from=2026-04-01&to=2027-03-31'));
  assert.ok(Array.isArray(infRegRes.rows), 'Influencer register returns rows');
  assert.ok(infRegRes.totals, 'Influencer register returns totals');

  // 4. Influencer Sales Detail endpoint
  const infSalesRes = client.ok(await client.json('GET', '/api/reports/influencer-sales?from=2026-04-01&to=2027-03-31'));
  assert.ok(Array.isArray(infSalesRes.rows), 'Influencer sales detail returns rows');
  assert.ok(infSalesRes.totals, 'Influencer sales detail returns totals');

  // 5. Import Batches endpoint
  const importBatchesRes = client.ok(await client.json('GET', '/api/reports/import-batches'));
  assert.ok(Array.isArray(importBatchesRes.rows), 'Import batches returns rows');
  assert.ok(importBatchesRes.totals, 'Import batches returns totals');

  // 6. Test Multi-format Excel (.xlsx) exports across all sections
  const excelSections = [
    'overview',
    'monthly_revenue',
    'clients',
    'invoices',
    'quotations',
    'products',
    'influencers',
    'influencer_sales',
    'collections',
    'receivables',
    'tax',
    'imports',
  ];

  for (const sec of excelSections) {
    const res = await client.binary('GET', `/api/reports/export-excel?section=${sec}&from=2026-04-01&to=2027-03-31`);
    assert.equal(res.status, 200, `Excel export for ${sec} returns 200`);
    assert.match(res.headers.get('content-type'), /spreadsheetml\.sheet/, `Excel export for ${sec} has correct content-type`);
    assert.ok(res.bytes.length > 500, `Excel workbook for ${sec} contains binary data (> 500 bytes)`);
  }

  // 7. Test PDF exports for all new sections
  const newPdfSections = [
    'monthly_revenue',
    'influencers',
    'influencer_sales',
    'imports',
  ];

  for (const sec of newPdfSections) {
    const res = await client.binary('GET', `/api/reports/export-pdf?section=${sec}&from=2026-04-01&to=2027-03-31`);
    assert.equal(res.status, 200, `PDF export for ${sec} returns 200`);
    assert.match(res.headers.get('content-type'), /application\/pdf/, `PDF export for ${sec} has application/pdf`);
    const parsed = await PDFDocument.load(res.bytes);
    assert.ok(parsed.getPageCount() >= 1, `PDF for ${sec} generates valid pages`);
  }

  // 8. Test CSV exports for new sections
  const csvEndpoints = [
    '/api/reports/monthly-revenue',
    '/api/reports/client-register',
    '/api/reports/influencer-register',
    '/api/reports/influencer-sales',
    '/api/reports/import-batches',
  ];

  for (const ep of csvEndpoints) {
    const res = await client.binary('GET', `${ep}?format=csv&from=2026-04-01&to=2027-03-31`);
    assert.equal(res.status, 200, `CSV export for ${ep} returns 200`);
    const text = res.bytes.toString('utf8');
    assert.ok(text.length > 10, `CSV for ${ep} returns non-empty CSV text`);
  }
});
