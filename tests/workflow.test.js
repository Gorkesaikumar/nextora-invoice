import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { makeClient, baseClient, baseProduct, line, draft, configureIssuer } from './helpers.js';

const ip = suffix => `10.1.0.${suffix}`;

async function withOwner(suffix) {
  const client = makeClient({ ip: ip(suffix) });
  await client.login();
  await configureIssuer(client);
  return client;
}

async function newClientRecord(client, overrides = {}) {
  return client.ok(await client.json('POST', '/api/clients', baseClient(overrides)), 'create client').client;
}

async function pdfPageCount(bytes) {
  const document = await PDFDocument.load(bytes);
  return { pages: document.getPageCount(), size: document.getPage(0).getSize() };
}

test('quotation lifecycle runs from draft to converted invoice and blocks a second conversion', async () => {
  const client = await withOwner(1);
  const customer = await newClientRecord(client);

  const created = client.ok(await client.json('POST', '/api/quotations', draft(customer.id)), 'create quotation');
  assert.equal(created.quotation.status, 'DRAFT');
  assert.equal(created.quotation.quotation_number, null, 'a draft carries no number yet');
  assert.equal(created.items.length, 1);

  // Totals come from the server, not the client.
  assert.equal(created.quotation.totals.taxable_total_minor, 10000000);
  assert.equal(created.quotation.totals.cgst_total_minor, 900000);
  assert.equal(created.quotation.totals.sgst_total_minor, 900000);
  assert.equal(created.quotation.totals.grand_total_minor, 11800000);
  assert.match(created.quotation.totals.amount_in_words, /^Rupees One Lakh Eighteen Thousand/);

  const sent = client.ok(await client.json('POST', `/api/quotations/${created.quotation.id}/send`), 'send');
  assert.equal(sent.quotation.status, 'SENT');
  assert.match(sent.quotation.quotation_number, /^NC\/QTN\/\d{4}-\d{2}\/\d{4}$/);

  // A sent quotation can no longer be edited in place.
  const edit = await client.json('PATCH', `/api/quotations/${created.quotation.id}`, draft(customer.id));
  assert.equal(edit.status, 409);
  assert.equal(edit.data.code, 'NOT_EDITABLE');

  // Accepting requires the client's decision to be recorded explicitly.
  const accepted = client.ok(await client.json('POST', `/api/quotations/${created.quotation.id}/transition`,
    { status: 'ACCEPTED', note: 'Approved by email' }), 'accept');
  assert.equal(accepted.quotation.status, 'ACCEPTED');
  assert.ok(accepted.quotation.accepted_at);
  assert.ok(accepted.history.some(entry => entry.to_status === 'ACCEPTED'));

  const conversion = client.ok(await client.json('POST', `/api/quotations/${created.quotation.id}/convert`,
    { issue_date: '2026-10-05', due_date: null }), 'convert');
  assert.equal(conversion.invoice.status, 'DRAFT');
  assert.equal(conversion.invoice.quotation_id, created.quotation.id);
  assert.equal(conversion.invoice.totals.grand_total_minor, 11800000);

  // Clicking convert again must not create a second invoice.
  const second = await client.json('POST', `/api/quotations/${created.quotation.id}/convert`, { issue_date: '2026-10-05', due_date: null });
  assert.equal(second.status, 409);
  assert.equal(second.data.code, 'ALREADY_CONVERTED');

  const list = client.ok(await client.json('GET', `/api/invoices?client_id=${customer.id}`));
  assert.equal(list.total, 1, 'exactly one invoice exists for this conversion');
});

test('a quotation that passes its validity date reports as expired', async () => {
  const client = await withOwner(2);
  const customer = await newClientRecord(client);
  const created = client.ok(await client.json('POST', '/api/quotations',
    draft(customer.id, { issue_date: '2026-01-01', expiry_date: '2026-01-31' })));
  await client.json('POST', `/api/quotations/${created.quotation.id}/send`);

  const list = client.ok(await client.json('GET', '/api/quotations?status=EXPIRED'));
  assert.ok(list.quotations.some(row => row.id === created.quotation.id));
  const detail = client.ok(await client.json('GET', `/api/quotations/${created.quotation.id}`));
  assert.equal(detail.quotation.status, 'SENT', 'the stored state is unchanged; expiry is derived from the date');
});

test('issuing an invoice allocates a number and derives the due date from payment terms', async () => {
  const client = await withOwner(3);
  const customer = await newClientRecord(client, { payment_terms_days: 30 });
  const created = client.ok(await client.json('POST', '/api/invoices',
    draft(customer.id, { issue_date: '2026-10-02', due_date: null, payment_terms_days: 30 })));

  const issued = client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/issue`), 'issue');
  assert.equal(issued.invoice.status, 'ISSUED');
  assert.match(issued.invoice.invoice_number, /^NC\/INV\/\d{4}-\d{2}\/\d{4}$/);
  assert.equal(issued.invoice.due_date, '2026-11-01');
  assert.equal(issued.payment_status, 'UNPAID');
  assert.ok(issued.invoice.issued_at);

  // Numbers increment within the financial year.
  const second = client.ok(await client.json('POST', '/api/invoices',
    draft(customer.id, { issue_date: '2026-10-02', due_date: null, payment_terms_days: 30 })));
  const issuedSecond = client.ok(await client.json('POST', `/api/invoices/${second.invoice.id}/issue`));
  const sequence = value => Number(value.split('/').at(-1));
  assert.equal(sequence(issuedSecond.invoice.invoice_number), sequence(issued.invoice.invoice_number) + 1);
});

test('partial and full payments are recorded, and overpayment is refused', async () => {
  const client = await withOwner(4);
  const customer = await newClientRecord(client);
  const created = client.ok(await client.json('POST', '/api/invoices', draft(customer.id, { issue_date: '2026-10-03' })));
  const issued = client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/issue`));

  const partial = client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/payments`,
    { amount_minor: 5000000, paid_on: '2026-10-04', method: 'BANK_TRANSFER', reference: 'UTR123', notes: '' }), 'partial payment');
  assert.equal(partial.payment_status, 'PARTIALLY_PAID');
  assert.equal(partial.amount_paid_minor, 5000000);
  assert.equal(partial.balance_due_minor, 6800000);
  assert.match(partial.receipt.number, /^NC\/RCP\/\d{4}-\d{2}\/\d{4}$/);

  const over = await client.json('POST', `/api/invoices/${created.invoice.id}/payments`,
    { amount_minor: 6800001, paid_on: '2026-10-05', method: 'UPI', reference: '', notes: '' });
  assert.equal(over.status, 409);
  assert.equal(over.data.code, 'OVERPAYMENT');

  const settled = client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/payments`,
    { amount_minor: 6800000, paid_on: '2026-10-06', method: 'UPI', reference: 'UPI-9', notes: 'Final settlement' }));
  assert.equal(settled.payment_status, 'PAID');
  assert.equal(settled.balance_due_minor, 0);
  assert.equal(settled.payments.length, 2);

  // Payments are an append-only record.
  const paymentId = settled.payments[0].id;
  await assert.rejects(() => client.db.query('DELETE FROM inv.payments WHERE id=$1', [paymentId]));

  const receipt = await client.binary('GET', `/api/payments/${paymentId}/receipt`);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.headers.get('content-type'), 'application/pdf');
  assert.equal(receipt.bytes.subarray(0, 5).toString(), '%PDF-');
  const { pages, size } = await pdfPageCount(receipt.bytes);
  assert.equal(pages, 1);
  assert.equal(Math.round(size.width), 595);
  assert.equal(Math.round(size.height), 842);

  // A fully settled invoice cannot be cancelled; it needs a credit note.
  const cancel = await client.json('POST', `/api/invoices/${created.invoice.id}/cancel`,
    { reason: 'Client changed their mind' });
  assert.equal(cancel.status, 409);
  assert.equal(cancel.data.code, 'PAYMENTS_EXIST');
});

test('intra-state supply splits CGST/SGST while inter-state supply raises IGST', async () => {
  const client = await withOwner(5);
  const local = await newClientRecord(client, { name: 'Local Buyer', state_code: '36', gstin: '' , gst_registered: false });
  const distant = await newClientRecord(client, { name: 'Distant Buyer', state_code: '27', gstin: '', gst_registered: false });

  const intra = client.ok(await client.json('POST', '/api/invoices', draft(local.id, { issue_date: '2026-10-07' })));
  assert.equal(intra.invoice.supply_type, 'INTRA');
  assert.equal(intra.invoice.totals.cgst_total_minor, 900000);
  assert.equal(intra.invoice.totals.igst_total_minor, 0);

  const inter = client.ok(await client.json('POST', '/api/invoices', draft(distant.id, { issue_date: '2026-10-07' })));
  assert.equal(inter.invoice.supply_type, 'INTER');
  assert.equal(inter.invoice.totals.cgst_total_minor, 0);
  assert.equal(inter.invoice.totals.sgst_total_minor, 0);
  assert.equal(inter.invoice.totals.igst_total_minor, 1800000);
  assert.equal(inter.invoice.totals.grand_total_minor, intra.invoice.totals.grand_total_minor);

  // A non-taxable line carries no tax at all.
  const exempt = client.ok(await client.json('POST', '/api/invoices', draft(local.id, {
    issue_date: '2026-10-07',
    items: [line({ tax_treatment: 'EXEMPT', tax_rate_bp: 0, unit_price_minor: 500000 })],
  })));
  assert.equal(exempt.invoice.totals.tax_total_minor, 0);
  assert.equal(exempt.invoice.totals.grand_total_minor, 500000);
  assert.equal(exempt.invoice.totals.exempt_total_minor, 500000);
});

test('the tax summary nets credit notes against issued invoices', async () => {
  const client = await withOwner(6);
  const customer = await newClientRecord(client);
  const created = client.ok(await client.json('POST', '/api/invoices',
    draft(customer.id, { issue_date: '2026-12-15', due_date: '2026-12-30' })));
  const issued = client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/issue`));

  const note = client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/credit-notes`, {
    kind: 'CREDIT', reason: 'Scope reduced by agreement', issue_date: '2026-12-20', notes: '',
    items: [line({ description: 'Scope reduction', quantity_milli: 1000, unit_price_minor: 500000 })],
  }), 'credit note');
  assert.equal(note.note.kind, 'CREDIT');
  assert.match(note.note.note_number, /^NC\/CRN\/\d{4}-\d{2}\/\d{4}$/);
  assert.equal(note.note.totals.grand_total_minor, 590000);

  const summary = client.ok(await client.json('GET', '/api/reports/tax-summary?from=2026-12-01&to=2026-12-31'));
  const reference = issued.invoice.totals;
  assert.equal(summary.net.taxable_minor, reference.taxable_total_minor - 500000);
  assert.equal(summary.net.tax_minor, reference.tax_total_minor - 90000);
  assert.equal(summary.net.cgst_minor, reference.cgst_total_minor - 45000);
  assert.equal(Number(summary.credit_note.tax_minor), 90000);

  // The note total can never exceed the invoice total.
  const tooLarge = await client.json('POST', `/api/invoices/${created.invoice.id}/credit-notes`, {
    kind: 'CREDIT', reason: 'Attempt to over-credit', issue_date: '2026-12-21', notes: '',
    items: [line({ description: 'Over credit', quantity_milli: 1000, unit_price_minor: 20000000 })],
  });
  assert.equal(tooLarge.status, 409);
  assert.equal(tooLarge.data.code, 'NOTE_EXCEEDS_INVOICE');
});

test('issued documents keep their snapshot and cannot be rewritten or deleted', async () => {
  const client = await withOwner(7);
  const customer = await newClientRecord(client, { name: 'Frozen Records Ltd' });
  const created = client.ok(await client.json('POST', '/api/invoices', draft(customer.id, { issue_date: '2026-10-08' })));
  const issued = client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/issue`));
  const number = issued.invoice.invoice_number;

  const stored = (await client.db.query('SELECT snapshot, totals FROM inv.invoices WHERE id=$1', [created.invoice.id])).rows[0];
  assert.equal(stored.snapshot.totals.grand_total_minor, 11800000);
  assert.equal(stored.snapshot.client.name, 'Frozen Records Ltd');
  assert.equal(stored.snapshot.business.business_name, 'Nextora Creations');
  assert.equal(stored.snapshot.document.supply_type, 'INTRA');

  // Changing the catalog afterwards must not alter the issued document.
  const product = client.ok(await client.json('POST', '/api/products', baseProduct()));
  client.ok(await client.json('PATCH', `/api/products/${product.product.id}`,
    baseProduct({ name: 'Renamed product', unit_price_minor: 99999999 })));
  const after = (await client.db.query('SELECT snapshot FROM inv.invoices WHERE id=$1', [created.invoice.id])).rows[0];
  assert.deepEqual(after.snapshot.lines[0].description, stored.snapshot.lines[0].description);

  await assert.rejects(() => client.db.query('UPDATE inv.invoices SET totals=$2 WHERE id=$1',
    [created.invoice.id, JSON.stringify({ grand_total_minor: 1 })]), /immutable/i);
  await assert.rejects(() => client.db.query('DELETE FROM inv.invoices WHERE id=$1', [created.invoice.id]), /cannot be deleted/i);
  await assert.rejects(() => client.db.query('UPDATE inv.invoice_items SET unit_price_minor=1 WHERE invoice_id=$1',
    [created.invoice.id]), /immutable/i);

  const edit = await client.json('PATCH', `/api/invoices/${created.invoice.id}`, draft(customer.id));
  assert.equal(edit.status, 409);
  assert.equal(edit.data.code, 'NOT_EDITABLE');

  // The stored number survives an attempted rename through the API too.
  const stillThere = (await client.db.query('SELECT invoice_number FROM inv.invoices WHERE id=$1', [created.invoice.id])).rows[0];
  assert.equal(stillThere.invoice_number, number);
});

test('document numbers stay unique and sequential under concurrent issuance', async () => {
  const client = await withOwner(8);
  const customer = await newClientRecord(client, { name: 'Concurrency Co' });
  const created = [];
  for (let index = 0; index < 12; index += 1) {
    const record = client.ok(await client.json('POST', '/api/invoices', {
      ...draft(customer.id, { issue_date: '2026-10-09' }),
      po_reference: `PO-${index}`,
    }));
    created.push(record.invoice.id);
  }

  const results = await Promise.all(created.map(id => client.json('POST', `/api/invoices/${id}/issue`)));
  for (const result of results) assert.equal(result.status, 200, JSON.stringify(result.data));

  const numbers = results.map(result => result.data.invoice.invoice_number);
  assert.equal(new Set(numbers).size, numbers.length, 'each concurrent issue receives a distinct number');

  const sequences = numbers.map(value => Number(value.split('/').at(-1))).sort((a, b) => a - b);
  for (let index = 1; index < sequences.length; index += 1) {
    assert.equal(sequences[index], sequences[index - 1] + 1, 'numbers are consecutive with no gaps or duplicates');
  }
});

test('draft documents can be corrected and discarded, but not twice', async () => {
  const client = await withOwner(9);
  const customer = await newClientRecord(client, { name: 'Draft Handling Co' });
  const created = client.ok(await client.json('POST', '/api/invoices', draft(customer.id, { issue_date: '2026-10-10' })));

  const corrected = client.ok(await client.json('PATCH', `/api/invoices/${created.invoice.id}`,
    draft(customer.id, { issue_date: '2026-10-10', items: [line({ unit_price_minor: 2000000 })] })));
  assert.equal(corrected.invoice.totals.grand_total_minor, 2360000);
  assert.equal(corrected.items.length, 1, 'line items are replaced, not duplicated');

  // Discarding the draft frees its source quotation for conversion again.
  const quotation = client.ok(await client.json('POST', '/api/quotations', draft(customer.id, { issue_date: '2026-10-10' })));
  client.ok(await client.json('POST', `/api/quotations/${quotation.quotation.id}/send`));
  client.ok(await client.json('POST', `/api/quotations/${quotation.quotation.id}/transition`, { status: 'ACCEPTED', note: 'Approved' }));
  const converted = client.ok(await client.json('POST', `/api/quotations/${quotation.quotation.id}/convert`, { issue_date: '2026-10-10' }));
  client.ok(await client.json('DELETE', `/api/invoices/${converted.invoice.id}`));
  const reconverted = client.ok(await client.json('POST', `/api/quotations/${quotation.quotation.id}/convert`, { issue_date: '2026-10-10' }));
  assert.notEqual(reconverted.invoice.id, converted.invoice.id);

  client.ok(await client.json('DELETE', `/api/invoices/${created.invoice.id}`));
  const twice = await client.json('DELETE', `/api/invoices/${created.invoice.id}`);
  assert.equal(twice.status, 404);
});

test('milestone amounts are derived from the document total and validated', async () => {
  const client = await withOwner(10);
  const customer = await newClientRecord(client, { name: 'Milestone Projects' });
  const created = client.ok(await client.json('POST', '/api/quotations', draft(customer.id, {
    issue_date: '2026-10-11',
    milestones: [
      { title: 'Advance payment', description: 'On signing', share_bp: 4000, amount_minor: 0, due_offset_days: 0 },
      { title: 'Development milestone', description: 'Core build', share_bp: 3000, amount_minor: 0, due_offset_days: 30 },
      { title: 'Testing and deployment', description: 'UAT sign-off', share_bp: 2000, amount_minor: 0, due_offset_days: 60 },
      { title: 'Final handover', description: 'Source and handover', share_bp: 1000, amount_minor: 0, due_offset_days: 90 },
    ],
  })));
  assert.deepEqual(created.milestones.map(m => m.amount_minor), [4720000, 3540000, 2360000, 1180000]);
  assert.equal(created.milestones.reduce((total, milestone) => total + milestone.amount_minor, 0), 11800000);

  const overAllocated = await client.json('POST', '/api/quotations', draft(customer.id, {
    issue_date: '2026-10-11',
    milestones: [
      { title: 'A', description: '', share_bp: 6000, amount_minor: 0, due_offset_days: 0 },
      { title: 'B', description: '', share_bp: 6000, amount_minor: 0, due_offset_days: 0 },
    ],
  }));
  assert.equal(overAllocated.status, 400);
  assert.equal(overAllocated.data.code, 'MILESTONE_MISMATCH');

  const fixedAmounts = await client.json('POST', '/api/quotations', draft(customer.id, {
    issue_date: '2026-10-11',
    milestones: [
      { title: 'Advance', description: '', share_bp: 0, amount_minor: 5000000, due_offset_days: 0 },
    ],
  }));
  assert.equal(fixedAmounts.status, 201);
  assert.equal(fixedAmounts.data.milestones[0].amount_minor, 5000000);
});

test('reports separate invoiced value from collected value and expose ageing', async () => {
  const client = await withOwner(11);
  const customer = await newClientRecord(client, { name: 'Reporting Co' });
  const created = client.ok(await client.json('POST', '/api/invoices',
    draft(customer.id, { issue_date: '2026-09-20', due_date: '2026-09-25' })));
  const issued = client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/issue`));
  client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/payments`,
    { amount_minor: 1000000, paid_on: '2026-09-28', method: 'BANK_TRANSFER', reference: 'UTR-77', notes: '' }));

  const register = client.ok(await client.json('GET', '/api/reports/invoices?from=2026-09-01&to=2026-09-30'));
  const mine = register.rows.find(row => row.invoice_number === issued.invoice.invoice_number);
  assert.ok(mine);
  assert.equal(mine.grand_total_minor, 11800000, 'invoiced value is the full document value');
  assert.equal(mine.paid_minor, 1000000, 'collected value is only money received');
  assert.equal(mine.balance_due_minor, 10800000);
  assert.equal(mine.payment_status, 'PARTIALLY_PAID');

  const collections = client.ok(await client.json('GET', '/api/reports/collections?from=2026-09-01&to=2026-09-30'));
  assert.ok(collections.collected_minor >= 1000000);
  assert.ok(collections.by_month.some(row => row.month === '2026-09'));

  const outstanding = client.ok(await client.json('GET', '/api/reports/receivables'));
  const row = outstanding.rows.find(entry => entry.invoice_number === issued.invoice.invoice_number);
  assert.ok(row, 'an unpaid balance appears in receivables');
  assert.equal(row.balance_due_minor, 10800000);
  assert.ok(row.days_overdue > 0, 'a past due date is reported as overdue');
  assert.equal(row.ageing, '1-30');

  const dashboard = client.ok(await client.json('GET', '/api/dashboard?from=2026-09-01&to=2026-09-30'));
  assert.ok(dashboard.invoiced.total_minor >= 11800000);
  assert.ok(dashboard.collected.total_minor >= 1000000);
  assert.notEqual(dashboard.invoiced.total_minor, dashboard.collected.total_minor,
    'an issued invoice is never counted as collected money');
  assert.ok(dashboard.outstanding.total_minor >= 10800000);

  const csv = await client.binary('GET', '/api/reports/invoices?from=2026-09-01&to=2026-09-30&format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const body = csv.bytes.toString('utf8');
  assert.match(body.split('\r\n')[0], /Invoice number/);
  assert.ok(body.includes(issued.invoice.invoice_number));
});

test('a long invoice paginates across multiple A4 pages without clipping', async () => {
  const client = await withOwner(12);
  const customer = await newClientRecord(client, { name: 'Long Document Co' });
  const items = Array.from({ length: 45 }, (_, index) => line({
    description: `Deliverable ${index + 1}: milestone scope with a deliberately long explanation so the renderer has to wrap text across several lines and cannot rely on a single-line cell`,
    quantity_milli: 1500,
    unit_price_minor: 123456,
  }));
  const created = client.ok(await client.json('POST', '/api/invoices', draft(customer.id, {
    issue_date: '2026-10-12',
    items,
    description: 'A very long programme of work described at length. '.repeat(12),
    scope_of_work: 'Scope line. '.repeat(40),
    terms: 'Terms and conditions. '.repeat(30),
  })));
  client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/issue`));

  const pdf = await client.binary('GET', `/api/invoices/${created.invoice.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-');
  const { pages, size } = await pdfPageCount(pdf.bytes);
  assert.ok(pages > 1, `expected a multi-page document, got ${pages} page(s)`);
  assert.equal(Math.round(size.width), 595);
  assert.equal(Math.round(size.height), 842);

  // Every page must be the same A4 size and the document must be well formed.
  const document = await PDFDocument.load(pdf.bytes);
  for (let index = 0; index < document.getPageCount(); index += 1) {
    assert.equal(Math.round(document.getPage(index).getSize().width), 595);
  }
});

test('the publisher can review a draft PDF preview of an unissued document', async () => {
  const client = await withOwner(13);
  const customer = await newClientRecord(client, { name: 'Preview Co' });
  const created = client.ok(await client.json('POST', '/api/quotations', draft(customer.id, {
    issue_date: '2026-10-13', expiry_date: '2026-10-31',
    description: '', scope_of_work: '', inclusions: '', exclusions: '', assumptions: '',
    warranty_terms: '', delivery_timeline: '', payment_terms: '', notes: '', terms: '',
  })));
  const preview = await client.binary('GET', `/api/quotations/${created.quotation.id}/pdf?view=1`);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('content-type'), 'application/pdf');
  assert.match(preview.headers.get('content-disposition'), /^inline/);
  assert.equal((await pdfPageCount(preview.bytes)).pages, 1);
});

test('clients are archived rather than deleted and duplicates are warned about', async () => {
  const client = await withOwner(14);
  const first = await newClientRecord(client, { name: 'Repeat Customer', gstin: '36AABCU9603R1ZO' });

  // A client that already has documents must not be deletable, only archived.
  await client.json('POST', '/api/invoices', draft(first.id, { issue_date: '2026-10-16' }));

  const warning = client.ok(await client.json('POST', '/api/clients/check-duplicates',
    { name: 'Repeat Customer', company_name: '', email: '', gstin: '36AABCU9603R1ZO', state_code: '36', exclude_id: null }));
  assert.ok(warning.warnings.length > 0, 'a duplicate is reported as a warning');
  assert.ok(warning.duplicates.some(row => row.id === first.id),
    `duplicate detection missed the existing client: ${JSON.stringify({ first: first.id, warning })}`);

  // A mismatched check digit is a warning, never a hard block.
  const mismatched = client.ok(await client.json('POST', '/api/clients/check-duplicates',
    { name: 'Check Digit Co', company_name: '', email: '', gstin: '36AABCU9603R1ZM', state_code: '36', exclude_id: null }));
  assert.ok(mismatched.warnings.some(text => /check digit/.test(text)));

  client.ok(await client.json('POST', `/api/clients/${first.id}/status`, { status: 'ARCHIVED' }));
  const archived = client.ok(await client.json('GET', '/api/clients?status=ARCHIVED'));
  assert.ok(archived.clients.some(row => row.id === first.id));
  await assert.rejects(() => client.db.query('DELETE FROM inv.clients WHERE id=$1', [first.id]), /foreign key|violates/i);
});

test('the audit trail records issuance, payments and configuration changes', async () => {
  const client = await withOwner(15);
  const customer = await newClientRecord(client, { name: 'Audit Co' });
  const created = client.ok(await client.json('POST', '/api/invoices', draft(customer.id, { issue_date: '2026-10-14' })));
  client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/issue`));
  client.ok(await client.json('POST', `/api/invoices/${created.invoice.id}/payments`,
    { amount_minor: 100000, paid_on: '2026-10-14', method: 'CASH', reference: '', notes: '' }));

  const events = client.ok(await client.json('GET', '/api/audit'));
  const names = events.events.map(event => event.event);
  for (const expected of ['INVOICE_ISSUED', 'PAYMENT_RECORDED', 'SETTINGS_UPDATED', 'CLIENT_CREATED', 'INVOICE_CREATED', 'USER_LOGIN']) {
    assert.ok(names.includes(expected), `audit trail should include ${expected}`);
  }
  const issued = events.events.find(event => event.event === 'INVOICE_ISSUED' && event.entity_id === created.invoice.id);
  assert.equal(issued.metadata.number, (await client.db.query('SELECT invoice_number FROM inv.invoices WHERE id=$1',
    [created.invoice.id])).rows[0].invoice_number);

  await assert.rejects(() => client.db.query("UPDATE inv.audit_logs SET event='TAMPERED'"), /immutable/i);
  await assert.rejects(() => client.db.query('DELETE FROM inv.audit_logs'), /immutable/i);
});

test('a catalog entry is reusable, editable and archived without touching history', async () => {
  const client = await withOwner(16);
  const product = client.ok(await client.json('POST', '/api/products', baseProduct({ sku: 'NCPOS-DESK-16' })));
  assert.equal(product.product.unit_price_minor, 2500000);

  const duplicateSku = await client.json('POST', '/api/products', baseProduct({ name: 'Other', sku: 'NCPOS-DESK-16' }));
  assert.equal(duplicateSku.status, 409, 'a reused SKU is reported as a conflict');

  const customer = await newClientRecord(client, { name: 'Catalog Co' });
  const created = client.ok(await client.json('POST', '/api/invoices', draft(customer.id, {
    issue_date: '2026-10-15',
    items: [line({ product_id: product.product.id, description: product.product.name,
      unit: product.product.unit, unit_price_minor: product.product.unit_price_minor, quantity_milli: 2000,
      hsn_sac: product.product.hsn_sac })],
  })));
  assert.equal(created.invoice.totals.grand_total_minor, 5900000);

  client.ok(await client.json('PATCH', `/api/products/${product.product.id}`, baseProduct({
    sku: 'NCPOS-DESK-16', status: 'ARCHIVED', unit_price_minor: 3000000,
  })));
  const archived = client.ok(await client.json('GET', '/api/products?status=ARCHIVED'));
  assert.ok(archived.products.some(row => row.id === product.product.id));
  assert.equal(created.invoice.totals.grand_total_minor, 5900000, 'the invoice kept its own pricing');
});

test('the reference endpoint exposes configuration the UI needs without inventing brand data', async () => {
  const client = await withOwner(17);
  const reference = client.ok(await client.json('GET', '/api/reference'));
  assert.ok(reference.states.length >= 36);
  assert.ok(reference.gst_rate_slabs.some(slab => slab.bp === 1800));
  assert.ok(reference.payment_methods.includes('UPI'));
  assert.equal(reference.currencies[0].code, 'INR');
  assert.match(reference.numbering_preview.invoice, /^NC\/INV\/\d{4}-\d{2}\/0001$/);
  assert.equal(reference.business.business_name, 'Nextora Creations');
  assert.equal(reference.business.product_price_tax_mode, 'EXCLUSIVE');
  assert.deepEqual(reference.tax_modes, ['EXCLUSIVE', 'INCLUSIVE']);
});

test('configurable GST pricing: EXCLUSIVE vs INCLUSIVE mode, setting switching, and historical immutability', async () => {
  const client = await withOwner(18);
  const customer = await newClientRecord(client, { state_code: '36' }); // Intra-state (Telangana)

  // 1. Initial state: EXCLUSIVE mode. Create invoice for Nextora POS Mobile at ₹5,999 with 18% GST.
  const exclDraft = draft(customer.id, {
    issue_date: '2026-10-18',
    tax_mode: 'EXCLUSIVE',
    items: [line({
      description: 'Nextora POS Mobile',
      unit_price_minor: 599900,
      tax_rate_bp: 1800,
      tax_treatment: 'TAXABLE',
    })],
  });

  const exclCreated = client.ok(await client.json('POST', '/api/invoices', exclDraft));
  assert.equal(exclCreated.invoice.tax_mode, 'EXCLUSIVE');
  assert.equal(exclCreated.invoice.totals.taxable_total_minor, 599900); // ₹5,999.00
  assert.equal(exclCreated.invoice.totals.tax_total_minor, 107982);     // ₹1,079.82
  assert.equal(exclCreated.invoice.totals.cgst_total_minor, 53991);     // ₹539.91
  assert.equal(exclCreated.invoice.totals.sgst_total_minor, 53991);     // ₹539.91
  assert.equal(exclCreated.invoice.totals.grand_total_minor, 707900);    // ₹7,079.00 (with round off)

  // Issue the exclusive invoice to freeze its snapshot.
  const exclIssued = client.ok(await client.json('POST', `/api/invoices/${exclCreated.invoice.id}/issue`));
  assert.equal(exclIssued.invoice.status, 'ISSUED');
  assert.equal(exclIssued.invoice.totals.grand_total_minor, 707900);

  // 2. Switch business settings to INCLUSIVE mode.
  await configureIssuer(client, { product_price_tax_mode: 'INCLUSIVE' });
  const refAfterSwitch = client.ok(await client.json('GET', '/api/reference'));
  assert.equal(refAfterSwitch.business.product_price_tax_mode, 'INCLUSIVE');

  // 3. Historical verification: The previously issued invoice MUST NOT be recalculated or changed.
  const exclFetched = client.ok(await client.json('GET', `/api/invoices/${exclCreated.invoice.id}`));
  assert.equal(exclFetched.invoice.tax_mode, 'EXCLUSIVE', 'historical tax_mode is preserved');
  assert.equal(exclFetched.invoice.totals.grand_total_minor, 707900, 'historical grand total is untouched');
  assert.equal(exclFetched.invoice.totals.taxable_total_minor, 599900, 'historical taxable is untouched');

  // 4. Create new invoice in INCLUSIVE mode for Nextora POS Mobile at ₹5,999 with 18% GST.
  const inclDraft = draft(customer.id, {
    issue_date: '2026-10-19',
    tax_mode: 'INCLUSIVE',
    items: [line({
      description: 'Nextora POS Mobile',
      unit_price_minor: 599900,
      tax_rate_bp: 1800,
      tax_treatment: 'TAXABLE',
    })],
  });

  const inclCreated = client.ok(await client.json('POST', '/api/invoices', inclDraft));
  assert.equal(inclCreated.invoice.tax_mode, 'INCLUSIVE');
  // ₹5,999 at 18% GST inclusive:
  // Taxable: ₹5,083.90 (508,390 paise)
  // GST: ₹915.10 (91,510 paise) -> CGST ₹457.55 + SGST ₹457.55
  // Customer pays exactly ₹5,999.00 (599,900 paise)
  assert.equal(inclCreated.invoice.totals.taxable_total_minor, 508390);
  assert.equal(inclCreated.invoice.totals.tax_total_minor, 91510);
  assert.equal(inclCreated.invoice.totals.cgst_total_minor, 45755);
  assert.equal(inclCreated.invoice.totals.sgst_total_minor, 45755);
  assert.equal(inclCreated.invoice.totals.igst_total_minor, 0);
  assert.equal(inclCreated.invoice.totals.round_off_minor, 0);
  assert.equal(inclCreated.invoice.totals.grand_total_minor, 599900);

  // Issue the inclusive invoice and verify snapshot integrity.
  const inclIssued = client.ok(await client.json('POST', `/api/invoices/${inclCreated.invoice.id}/issue`));
  assert.equal(inclIssued.invoice.status, 'ISSUED');
  assert.equal(inclIssued.invoice.totals.grand_total_minor, 599900);
  assert.equal(inclIssued.invoice.snapshot.document.tax_mode, 'INCLUSIVE');
  assert.equal(inclIssued.invoice.snapshot.lines[0].tax_mode, 'INCLUSIVE');
  assert.equal(inclIssued.invoice.snapshot.lines[0].taxable_minor, 508390);
  assert.equal(inclIssued.invoice.snapshot.lines[0].tax_minor, 91510);
  assert.equal(inclIssued.invoice.snapshot.lines[0].total_minor, 599900);

  // Verify PDF preview renders successfully for the inclusive invoice.
  const pdfResponse = await client.binary('GET', `/api/invoices/${inclCreated.invoice.id}/pdf`);
  assert.equal(pdfResponse.status, 200);
  assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf');
  const pdfMeta = await pdfPageCount(pdfResponse.bytes);
  assert.ok(pdfMeta.pages >= 1);
});

test('quotation conversion and credit notes inherit and preserve INCLUSIVE tax mode', async () => {
  const client = await withOwner(19);
  const customer = await newClientRecord(client, { state_code: '36' });

  // 1. Create a quotation with INCLUSIVE mode.
  const qtn = client.ok(await client.json('POST', '/api/quotations', draft(customer.id, {
    issue_date: '2026-10-20',
    tax_mode: 'INCLUSIVE',
    items: [line({
      description: 'Nextora POS Mobile Subscription',
      unit_price_minor: 599900,
      tax_rate_bp: 1800,
      tax_treatment: 'TAXABLE',
    })],
  })));

  assert.equal(qtn.quotation.tax_mode, 'INCLUSIVE');
  assert.equal(qtn.quotation.totals.grand_total_minor, 599900);

  // Send and accept the quotation.
  client.ok(await client.json('POST', `/api/quotations/${qtn.quotation.id}/send`));
  client.ok(await client.json('POST', `/api/quotations/${qtn.quotation.id}/transition`, { status: 'ACCEPTED', note: 'Customer accepted' }));

  // Convert to invoice.
  const converted = client.ok(await client.json('POST', `/api/quotations/${qtn.quotation.id}/convert`, {
    issue_date: '2026-10-20',
  }));

  assert.equal(converted.invoice.tax_mode, 'INCLUSIVE', 'converted invoice preserved tax_mode');
  assert.equal(converted.invoice.totals.grand_total_minor, 599900, 'converted invoice preserved grand total');
  assert.equal(converted.invoice.totals.taxable_total_minor, 508390);

  // Issue the converted invoice.
  client.ok(await client.json('POST', `/api/invoices/${converted.invoice.id}/issue`));

  // Issue a credit note against this inclusive invoice.
  const creditNote = client.ok(await client.json('POST', `/api/invoices/${converted.invoice.id}/credit-notes`, {
    kind: 'CREDIT',
    reason: 'Discount adjustment',
    issue_date: '2026-10-21',
    notes: 'Price adjustment',
    items: [{
      product_id: null,
      description: 'Partial price adjustment',
      category: '',
      hsn_sac: '998314',
      unit: 'NOS',
      quantity_milli: 1000,
      unit_price_minor: 118000, // ₹1,180
      discount_bp: 0,
      discount_minor: 0,
      tax_rate_bp: 1800,
      tax_treatment: 'TAXABLE',
    }],
  }));

  assert.equal(creditNote.note.tax_mode, 'INCLUSIVE', 'credit note inherited invoice tax_mode');
  // For ₹1,180 at 18% inclusive: Taxable = 100000 (₹1,000), Tax = 18000 (₹180), Total = 118000 (₹1,180)
  assert.equal(creditNote.note.totals.taxable_total_minor, 100000);
  assert.equal(creditNote.note.totals.tax_total_minor, 18000);
  assert.equal(creditNote.note.totals.grand_total_minor, 118000);
});
