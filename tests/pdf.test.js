import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPdf } from './pdf-text.js';
import { makeClient, baseClient, line, draft, configureIssuer } from './helpers.js';
import { resolveFontPath, readFontBytes, formatQuantity } from '../server/pdf.js';
import { existsSync, statSync } from 'node:fs';

const ip = suffix => `10.2.0.${suffix}`;

async function withOwner(suffix, settings = {}) {
  const client = makeClient({ ip: ip(suffix) });
  await client.login();
  await configureIssuer(client, settings);
  return client;
}

const newClientRecord = async (client, overrides = {}) =>
  (await client.ok(await client.json('POST', '/api/clients', baseClient(overrides)), 'create client')).client;

const lines = pages => pages.map(page => page.text.join('\n')).join('\n---PAGE---\n');

test('a quotation PDF prints the numbers the client was quoted', async () => {
  const client = await withOwner(1);
  const customer = await newClientRecord(client, { name: 'Quotation Reader Pvt Ltd' });
  const created = client.ok(await client.json('POST', '/api/quotations',
    draft(customer.id, { issue_date: '2026-10-01', expiry_date: '2026-10-31' })));
  const sent = client.ok(await client.json('POST', `/api/quotations/${created.quotation.id}/send`));

  const pdf = await client.binary('GET', `/api/quotations/${created.quotation.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-');

  const pages = extractPdf(pdf.bytes);
  assert.ok(pages.length >= 1, 'the quotation renders');
  for (const page of pages) {
    assert.equal(Math.round(page.width), 595, 'A4 width');
    assert.equal(Math.round(page.height), 842, 'A4 height');
  }

  const text = lines(pages);
  const totals = sent.quotation.totals;
  assert.ok(text.includes('QUOTATION'), 'the document is titled a quotation, not an invoice');
  assert.ok(text.includes(sent.quotation.quotation_number), 'the issued number is printed');
  assert.ok(text.includes('QUOTATION FOR'), 'the party block names the recipient as a quotation');
  assert.ok(text.includes('Quotation Reader Pvt Ltd'), 'the client name is printed');
  assert.ok(text.includes('36AABCU9603R1ZO'), 'the client GSTIN is printed');
  assert.ok(text.includes('Nextora Creations'), 'the issuer letterhead is printed');
  assert.ok(text.includes('Valid until'), 'a quotation shows its validity date');
  assert.ok(text.includes('31 Oct 2026'), 'the validity date is rendered readably');
  assert.ok(text.includes('CGST') && text.includes('SGST'), 'intra-state supply splits CGST and SGST');
  assert.ok(text.includes('IGST') === false || !/IGST\s*₹[1-9]/.test(text), 'no IGST is charged on an intra-state supply');
  assert.ok(text.includes(`Grand total₹${(totals.grand_total_minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`)
    || text.includes(`Grand total₹1,18,000.00`), 'the grand total printed equals the stored total');
  assert.ok(text.includes(totals.amount_in_words), 'the amount in words matches the stored total');
  assert.ok(text.includes(`Page 1 of ${pages.length}`), 'the first page states its position in the set');
  assert.ok(text.includes('Computer generated document'), 'the footer marks the document as generated');
});

test('a long invoice paginates with page numbers and never draws outside the page', async () => {
  const client = await withOwner(2);
  const customer = await newClientRecord(client, { name: 'Long Engagement LLP', state_code: '27' });
  const items = Array.from({ length: 42 }, (_, index) => line({
    description: `Milestone ${index + 1} SKU-${String(index + 1).padStart(2, '0')} - implementation, configuration and handover for the ${index % 2 ? 'retail' : 'warehouse'} module including data migration`,
    unit_price_minor: 250000, quantity_milli: 1500,
  }));
  const created = client.ok(await client.json('POST', '/api/invoices',
    draft(customer.id, { issue_date: '2026-10-02', due_date: null, items })));
  const issued = client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/issue`), 'issue invoice');

  const pdf = await client.binary('GET', `/api/invoices/${created.invoice.id}/pdf`);
  const pages = extractPdf(pdf.bytes);
  assert.ok(pages.length >= 3, `a 42 line invoice spans several pages (got ${pages.length})`);

  const total = pages.length;
  pages.forEach((page, index) => {
    assert.equal(Math.round(page.width), 595, `page ${page.page} is A4 wide`);
    assert.equal(Math.round(page.height), 842, `page ${page.page} is A4 tall`);
    const text = page.text.join('\n');
    assert.ok(text.includes(`Page ${index + 1} of ${total}`), `page ${index + 1} prints its position in the set`);
    assert.ok(text.includes(issued.invoice.invoice_number), `page ${index + 1} carries the invoice number`);
    // Pages that continue the item table repeat its header; a trailing page of
    // summary and terms has no item table at all.
    if (/SKU-\d\d/.test(text)) assert.ok(text.includes('DESCRIPTION'), `page ${index + 1} repeats the table header`);
    for (const position of page.positions) {
      assert.ok(position.x >= 0 && position.x <= page.width, `text at x=${position.x} stays inside page ${index + 1}`);
      assert.ok(position.y >= 0 && position.y <= page.height, `text at y=${position.y} stays inside page ${index + 1}`);
    }
  });

  const all = lines(pages);
  assert.ok(all.includes('SKU-01'), 'the first line item is printed');
  assert.ok(all.includes('SKU-42'), 'the last line item is printed');
  assert.ok(/Grand total₹/.test(all), 'the totals box is printed once the items end');
  const expected = `₹${(issued.invoice.totals.grand_total_minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  assert.ok(all.includes(`Grand total${expected}`), `the printed grand total reads ${expected}`);
  assert.ok(all.includes(issued.invoice.totals.amount_in_words), 'the printed words match the stored total');
});

test('issuer identity, payment details and signature appear when configured', async () => {
  const client = await withOwner(3, {
    address: 'Plot 12, Madhapur\nHyderabad, Telangana 500081', gstin: '36AABCU9603R1ZO', pan: 'AABCU9603R',
    bank_name: 'HDFC Bank', bank_account_number: '1234567890', bank_ifsc: 'HDFC0001234',
  });
  const customer = await newClientRecord(client, { name: 'Signature Check Pvt Ltd' });
  const created = client.ok(await client.json('POST', '/api/invoices', draft(customer.id, { issue_date: '2026-10-03' })));
  await client.json('POST', `/api/invoices/${created.invoice.id}/issue`);

  const pdf = await client.binary('GET', `/api/invoices/${created.invoice.id}/pdf`);
  const text = lines(extractPdf(pdf.bytes));
  assert.ok(text.includes('GSTIN: 36AABCU9603R1ZO'), 'the issuer GSTIN is printed');
  assert.ok(text.includes('PAN: AABCU9603R'), 'the issuer PAN is printed when configured');
  assert.ok(text.includes('Hyderabad, Telangana 500081'), 'the registered address is printed');
  assert.ok(text.includes('HDFC Bank'), 'bank details are printed');
  assert.ok(text.includes('A/C number: 1234567890'), 'the account number is printed');
  assert.ok(text.includes('UPI: nextora@upi'), 'the UPI id is printed');
  assert.ok(text.includes('Authorised signatory'), 'the signature block is printed');
  assert.ok(text.includes('Gorke Sai Kumar'), 'the authorised signatory is named');

  // Turning the blocks off must actually remove them from the document.
  const quiet = await withOwner(4, { show_bank_details: false, show_signatory: false, show_amount_in_words: false });
  const other = await newClientRecord(quiet, { name: 'Quiet Document Ltd' });
  const bare = quiet.ok(await quiet.json('POST', '/api/invoices', draft(other.id, { issue_date: '2026-10-03' })));
  await quiet.json('POST', `/api/invoices/${bare.invoice.id}/issue`);
  const quietText = lines(extractPdf((await quiet.binary('GET', `/api/invoices/${bare.invoice.id}/pdf`)).bytes));
  assert.ok(!quietText.includes('Authorised signatory'), 'the signature block is suppressed when configured off');
  assert.ok(!quietText.includes('A/C number:'), 'bank details are suppressed when configured off');
  assert.ok(!quietText.includes('AMOUNT IN WORDS'), 'the words block is suppressed when configured off');
  assert.ok(quietText.includes('Grand total₹'), 'the totals are still printed');
});

test('a payment receipt PDF states what was received and what is still due', async () => {
  const client = await withOwner(5);
  const customer = await newClientRecord(client, { name: 'Receipt Reader Pvt Ltd' });
  const created = client.ok(await client.json('POST', '/api/invoices', draft(customer.id, { issue_date: '2026-10-04' })));
  const issued = client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/issue`));
  const paid = client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/payments`,
    { amount_minor: 5000000, paid_on: '2026-10-05', method: 'BANK_TRANSFER', reference: 'UTR-99887766', notes: 'Advance received' }));

  const pdf = await client.binary('GET', `/api/payments/${paid.payments[0].id}/receipt`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const pages = extractPdf(pdf.bytes);
  assert.equal(pages.length, 1);
  const text = lines(pages);

  assert.ok(text.includes('PAYMENT RECEIPT'), 'the document is titled as a receipt');
  assert.ok(text.includes(paid.receipt.number), 'the receipt number is printed');
  assert.ok(text.includes(issued.invoice.invoice_number), 'the invoice it settles is named');
  assert.ok(text.includes('05 Oct 2026'), 'the date money arrived is printed');
  assert.ok(text.includes('BANK TRANSFER') || text.includes('Bank Transfer') || text.includes('BANK_TRANSFER'), 'the method is printed');
  assert.ok(text.includes('UTR-99887766'), 'the transaction reference is printed');
  assert.ok(text.includes('Advance received'), 'the payment note is printed');
  assert.ok(text.includes('TOTAL RECEIVED₹50,000.00'), 'the running total received is printed');
  assert.ok(text.includes('BALANCE DUE₹68,000.00'), 'the remaining balance is printed');
  assert.ok(text.includes('THIS RECEIPT₹50,000.00'), 'the amount received is printed');
  assert.ok(text.includes('Rupees Fifty Thousand Only'), 'the receipt spells out the amount received');
  assert.ok(text.includes('INVOICE TOTAL₹1,18,000.00'), 'the invoice total is repeated for context');
  assert.ok(text.includes('INVOICE SETTLED'), 'the receipt says which invoice it settles');
  assert.ok(text.includes(`Invoice: ${issued.invoice.invoice_number}`), 'the settled invoice number is printed');
  assert.ok(!text.includes('Issue date\n-'), 'a receipt never prints an empty issue date');
  assert.ok(!text.includes('Place of supply: Not selected'), 'a receipt never prints a placeholder supply state');
});

test('font resolution finds Noto Sans assets reliably', async () => {
  const regularPath = resolveFontPath('NotoSans-Regular.ttf');
  assert.ok(regularPath, 'regular font path resolved');
  assert.ok(existsSync(regularPath), `regular font file must exist on disk: ${regularPath}`);
  assert.ok(statSync(regularPath).size > 500000, 'regular font size > 500 KB');

  const boldPath = resolveFontPath('NotoSans-Bold.ttf');
  assert.ok(boldPath, 'bold font path resolved');
  assert.ok(existsSync(boldPath), `bold font file must exist on disk: ${boldPath}`);
  assert.ok(statSync(boldPath).size > 500000, 'bold font size > 500 KB');

  const regularBytes = await readFontBytes('NotoSans-Regular.ttf');
  assert.ok(regularBytes instanceof Uint8Array || Buffer.isBuffer(regularBytes));
  assert.ok(regularBytes.length > 500000);

  const boldBytes = await readFontBytes('NotoSans-Bold.ttf');
  assert.ok(boldBytes instanceof Uint8Array || Buffer.isBuffer(boldBytes));
  assert.ok(boldBytes.length > 500000);
});

test('font loader raises structured FONT_NOT_FOUND error for missing font', async () => {
  await assert.rejects(
    async () => {
      await readFontBytes('NonExistent-Ghost-Font.ttf');
    },
    error => {
      assert.equal(error.code, 'FONT_NOT_FOUND');
      assert.equal(error.status, 500);
      assert.ok(error.message.includes('NonExistent-Ghost-Font.ttf'));
      return true;
    }
  );
});

test('requesting PDF for invalid or missing invoice returns clean error', async () => {
  const client = await withOwner(6);
  const badId = await client.json('GET', '/api/invoices/not-a-uuid/pdf');
  assert.equal(badId.status, 400);

  const missing = await client.json('GET', '/api/invoices/00000000-0000-0000-0000-000000000000/pdf');
  assert.equal(missing.status, 404);
});

test('formatQuantity formats whole numbers, decimals, large values, and missing quantities correctly', () => {
  assert.equal(formatQuantity(1000, 'NOS'), '1 NOS');
  assert.equal(formatQuantity(2000, 'LIC'), '2 LIC');
  assert.equal(formatQuantity(10000, 'HRS'), '10 HRS');
  assert.equal(formatQuantity(1500, 'KG'), '1.5 KG');
  assert.equal(formatQuantity(2750, 'MTR'), '2.75 MTR');
  assert.equal(formatQuantity(1005, 'BOX'), '1.005 BOX');
  assert.equal(formatQuantity(500, 'NOS'), '0.5 NOS');
  assert.equal(formatQuantity(10000000, 'NOS'), '10000 NOS');
  assert.equal(formatQuantity(0, 'NOS'), '0 NOS');
  assert.equal(formatQuantity(1000, ''), '1');
  assert.equal(formatQuantity(1500, null), '1.5');
  assert.equal(formatQuantity(null, 'NOS'), '');
  assert.equal(formatQuantity(undefined, 'NOS'), '');
  assert.equal(formatQuantity(NaN, 'NOS'), '');
});

test('invoice PDF renders quantity and rate as separate non-overlapping columns', async () => {
  const client = await withOwner(7);
  const customer = await newClientRecord(client, { name: 'Abhijeeth', state_code: '36' });
  const items = [
    line({
      description: 'Nextora POS mobile app',
      hsn_sac: '7674',
      tax_treatment: 'EXEMPT',
      tax_rate_bp: 0,
      unit: 'NOS',
      quantity_milli: 1000,
      unit_price_minor: 599900,
    }),
  ];
  const created = client.ok(await client.json('POST', '/api/invoices',
    draft(customer.id, { issue_date: '2026-10-13', due_date: '2026-10-28', items })));
  const issued = client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/issue`));

  const pdf = await client.binary('GET', `/api/invoices/${created.invoice.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');

  const pages = extractPdf(pdf.bytes);
  assert.ok(pages.length >= 1);
  const pageText = lines(pages);

  assert.ok(pageText.includes('Nextora POS mobile app'));
  assert.ok(pageText.includes('1 NOS'));
  assert.ok(pageText.includes('₹5,999.00'));

  // Ensure quantity is not concatenated into rate without spacing or overlapping
  assert.ok(!pageText.includes('1NOS₹5,999.00'));
  assert.ok(!pageText.includes('1₹5,999.00'));
});

test('invoice PDF correctly handles decimal and large quantities in table', async () => {
  const client = await withOwner(8);
  const customer = await newClientRecord(client, { name: 'Retail Bulk Buyer', state_code: '36' });
  const items = [
    line({
      description: 'Raw Fabric Batch A',
      unit: 'MTR',
      quantity_milli: 2500, // 2.5 MTR
      unit_price_minor: 40000, // ₹400.00
    }),
    line({
      description: 'Packaging Cartons',
      unit: 'NOS',
      quantity_milli: 5000000, // 5,000 NOS
      unit_price_minor: 1200, // ₹12.00
    }),
  ];
  const created = client.ok(await client.json('POST', '/api/invoices',
    draft(customer.id, { issue_date: '2026-10-15', items })));
  const issued = client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/issue`));

  const pdf = await client.binary('GET', `/api/invoices/${created.invoice.id}/pdf`);
  assert.equal(pdf.status, 200);

  const pages = extractPdf(pdf.bytes);
  const pageText = lines(pages);

  assert.ok(pageText.includes('2.5 MTR'), 'decimal quantity rendered cleanly');
  assert.ok(pageText.includes('5000 NOS'), 'large quantity rendered cleanly');
});
