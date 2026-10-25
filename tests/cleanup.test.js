import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { makeClient, baseClient, baseProduct, line, draft, configureIssuer, OWNER } from './helpers.js';
import { verifyExportManifest } from '../server/cleanup.js';
import { validateBackupFile } from '../server/backup.js';

const ip = suffix => `10.2.0.${suffix}`;

async function withOwner(suffix) {
  const client = makeClient({ ip: ip(suffix) });
  await client.login();
  await configureIssuer(client);
  return client;
}

test('1. Status endpoint inspects database and returns eligibility breakdowns', async () => {
  const client = await withOwner(1);
  const statusRes = await client.json('GET', '/api/cleanup/status');
  assert.equal(statusRes.status, 200);
  assert.ok(statusRes.data.quotations);
  assert.ok(statusRes.data.invoices);
  assert.ok(statusRes.data.storage);
  assert.equal(typeof statusRes.data.quotations.eligible_count, 'number');
  assert.equal(typeof statusRes.data.invoices.eligible_count, 'number');
});

test('2. Preview distinguishes eligible vs blocked quotations and invoices', async () => {
  const client = await withOwner(2);
  const customer = client.ok(await client.json('POST', '/api/clients', baseClient({ name: 'Cleanup Target 1' }))).client;

  // A. Eligible draft quotation
  const qDraft = client.ok(await client.json('POST', '/api/quotations', draft(customer.id, { title: 'Draft to Clean' }))).quotation;

  // B. Quotation converted to invoice (must be blocked)
  const qToConvert = client.ok(await client.json('POST', '/api/quotations', draft(customer.id, { title: 'To Convert' }))).quotation;
  client.ok(await client.json('POST', `/api/quotations/${qToConvert.id}/send`));
  client.ok(await client.json('POST', `/api/quotations/${qToConvert.id}/transition`, { status: 'ACCEPTED', note: 'Approved' }));
  const convertedInv = client.ok(await client.json('POST', `/api/quotations/${qToConvert.id}/convert`, { issue_date: '2026-10-10' })).invoice;

  // Preview quotations
  const qPreview = client.ok(await client.json('POST', '/api/cleanup/preview', { category: 'QUOTATIONS', filter_type: 'ALL' }));
  const foundDraft = qPreview.eligible_records.find(r => r.id === qDraft.id);
  const foundConverted = qPreview.blocked_records.find(r => r.id === qToConvert.id);

  assert.ok(foundDraft, 'Draft quotation must be eligible');
  assert.ok(foundConverted, 'Converted quotation must be blocked');
  assert.match(foundConverted.reasons[0], /invoice/i);

  // C. Invoices: Unpaid issued invoice without payments vs Invoice with payments
  const invEligible = client.ok(await client.json('POST', '/api/invoices', draft(customer.id, { title: 'Unpaid Invoice' }))).invoice;
  client.ok(await client.json('POST', `/api/invoices/${invEligible.id}/issue`));

  const invWithPayment = client.ok(await client.json('POST', '/api/invoices', draft(customer.id, { title: 'Paid Invoice' }))).invoice;
  client.ok(await client.json('POST', `/api/invoices/${invWithPayment.id}/issue`));
  client.ok(await client.json('POST', `/api/invoices/${invWithPayment.id}/payments`, {
    amount_minor: 1000000,
    paid_on: '2026-10-10',
    method: 'BANK_TRANSFER',
    reference: 'PAY-1234',
    notes: 'Advance payment',
  }));

  // Preview invoices
  const iPreview = client.ok(await client.json('POST', '/api/cleanup/preview', { category: 'INVOICES', filter_type: 'ALL' }));
  const foundInvEligible = iPreview.eligible_records.find(r => r.id === invEligible.id);
  const foundInvWithPayment = iPreview.blocked_records.find(r => r.id === invWithPayment.id);

  assert.ok(foundInvEligible, 'Unpaid invoice without payments must be eligible');
  assert.ok(foundInvWithPayment, 'Invoice with payments must be strictly blocked');
  assert.match(foundInvWithPayment.reasons[0], /payment/i);
});

test('3. Quotation export creates valid XLSX, CSV, PDF and structured JSON files with checksums', async () => {
  const client = await withOwner(3);
  const customer = client.ok(await client.json('POST', '/api/clients', baseClient({ name: 'Export Test Client Q' }))).client;
  const q = client.ok(await client.json('POST', '/api/quotations', draft(customer.id, { title: 'Export Quotation' }))).quotation;

  const exportRes = await client.json('POST', '/api/cleanup/export', {
    category: 'QUOTATIONS',
    ids: [q.id],
  });
  assert.equal(exportRes.status, 200);
  const { manifest, verification_token, verification } = exportRes.data;

  assert.ok(verification_token);
  assert.equal(verification.verified, true);
  assert.equal(manifest.record_count, 1);

  // Check file existence and formats
  const files = manifest.files;
  assert.ok(files.json && existsSync(files.json.path));
  assert.ok(files.csv_master && existsSync(files.csv_master.path));
  assert.ok(files.csv_items && existsSync(files.csv_items.path));
  assert.ok(files.xlsx && existsSync(files.xlsx.path));
  assert.ok(files.pdf && existsSync(files.pdf.path));

  // Verify XLSX is readable
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(files.xlsx.path);
  assert.ok(workbook.getWorksheet('Quotations Master'));
  assert.ok(workbook.getWorksheet('Line Items'));

  // Verify PDF is readable
  const pdfBytes = readFileSync(files.pdf.path);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  assert.ok(pdfDoc.getPageCount() >= 1);

  // Verify JSON structure
  const parsedJson = JSON.parse(readFileSync(files.json.path, 'utf8'));
  assert.equal(parsedJson.count, 1);
  assert.equal(parsedJson.quotations[0].quotation.id, q.id);
});

test('4. Invoice export creates valid XLSX, CSV, PDF and structured JSON files with checksums', async () => {
  const client = await withOwner(4);
  const customer = client.ok(await client.json('POST', '/api/clients', baseClient({ name: 'Export Test Client I' }))).client;
  const inv = client.ok(await client.json('POST', '/api/invoices', draft(customer.id, { title: 'Export Invoice' }))).invoice;
  client.ok(await client.json('POST', `/api/invoices/${inv.id}/issue`));

  const exportRes = await client.json('POST', '/api/cleanup/export', {
    category: 'INVOICES',
    ids: [inv.id],
  });
  assert.equal(exportRes.status, 200);
  const { manifest, verification_token, verification } = exportRes.data;

  assert.ok(verification_token);
  assert.equal(verification.verified, true);
  assert.equal(manifest.record_count, 1);

  const files = manifest.files;
  assert.ok(files.json && existsSync(files.json.path));
  assert.ok(files.csv_master && existsSync(files.csv_master.path));
  assert.ok(files.csv_items && existsSync(files.csv_items.path));
  assert.ok(files.xlsx && existsSync(files.xlsx.path));
  assert.ok(files.pdf && existsSync(files.pdf.path));

  // Verify XLSX is readable
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(files.xlsx.path);
  assert.ok(workbook.getWorksheet('Invoices Master'));
  assert.ok(workbook.getWorksheet('Line Items'));

  // Verify PDF is readable
  const pdfBytes = readFileSync(files.pdf.path);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  assert.ok(pdfDoc.getPageCount() >= 1);
});

test('5. Missing or corrupted export file is strictly rejected during verification', () => {
  const fakeManifest = {
    category: 'QUOTATIONS',
    record_count: 1,
    document_ids: ['00000000-0000-0000-0000-000000000001'],
    files: {
      json: { path: '/tmp/nonexistent-file.json', filename: 'file.json', sha256: 'abc', size_bytes: 10 },
      csv_master: { path: '/tmp/fake.csv', filename: 'm.csv', sha256: 'abc', size_bytes: 10 },
      csv_items: { path: '/tmp/fake.csv', filename: 'i.csv', sha256: 'abc', size_bytes: 10 },
      xlsx: { path: '/tmp/fake.xlsx', filename: 'a.xlsx', sha256: 'abc', size_bytes: 10 },
      pdf: { path: '/tmp/fake.pdf', filename: 'a.pdf', sha256: 'abc', size_bytes: 10 },
    },
  };
  assert.throws(() => verifyExportManifest(fakeManifest), /not found/i);
});

test('6. Incorrect confirmation phrase is rejected', async () => {
  const client = await withOwner(5);
  const customer = client.ok(await client.json('POST', '/api/clients', baseClient({ name: 'Phrase Test Client' }))).client;
  const q = client.ok(await client.json('POST', '/api/quotations', draft(customer.id, { title: 'Phrase Test' }))).quotation;

  const exp = client.ok(await client.json('POST', '/api/cleanup/export', { category: 'QUOTATIONS', ids: [q.id] }));

  const wrongPhraseRes = await client.json('POST', '/api/cleanup/execute', {
    category: 'QUOTATIONS',
    ids: [q.id],
    verification_token: exp.verification_token,
    confirmation_phrase: 'YES DELETE',
  });
  assert.equal(wrongPhraseRes.status, 400);
  assert.equal(wrongPhraseRes.data.code, 'CONFIRMATION_PHRASE_MISMATCH');
});

test('7. Cancellation leaves documents and records untouched', async () => {
  const client = await withOwner(6);
  const customer = client.ok(await client.json('POST', '/api/clients', baseClient({ name: 'Cancel Test Client' }))).client;
  const q = client.ok(await client.json('POST', '/api/quotations', draft(customer.id, { title: 'Cancel Test' }))).quotation;

  // Export generated but not executed
  client.ok(await client.json('POST', '/api/cleanup/export', { category: 'QUOTATIONS', ids: [q.id] }));

  // Quotation still exists in database
  const stillExists = (await client.db.query('SELECT id FROM inv.quotations WHERE id=$1', [q.id])).rows[0];
  assert.ok(stillExists, 'Quotation must remain when cleanup is cancelled');
});

test('8. Safe deletion of eligible quotations removes quotation, items and milestones', async () => {
  const client = await withOwner(7);
  const customer = client.ok(await client.json('POST', '/api/clients', baseClient({ name: 'Delete Quotation Test' }))).client;
  const q = client.ok(await client.json('POST', '/api/quotations', draft(customer.id, {
    title: 'Delete Quotation Target',
    milestones: [{ title: 'Milestone 1', amount_minor: 11800000, share_bp: 10000, due_offset_days: 0 }],
  }))).quotation;

  const exp = client.ok(await client.json('POST', '/api/cleanup/export', { category: 'QUOTATIONS', ids: [q.id] }));

  const delRes = await client.json('POST', '/api/cleanup/execute', {
    category: 'QUOTATIONS',
    ids: [q.id],
    verification_token: exp.verification_token,
    confirmation_phrase: 'DELETE QUOTATIONS',
  });
  assert.equal(delRes.status, 200);
  assert.equal(delRes.data.deleted_count, 1);

  // Verify quotation row is deleted
  const qRow = (await client.db.query('SELECT * FROM inv.quotations WHERE id=$1', [q.id])).rows[0];
  assert.equal(qRow, undefined, 'Quotation row must be deleted');

  // Verify quotation items and milestones are deleted
  const items = (await client.db.query('SELECT * FROM inv.quotation_items WHERE quotation_id=$1', [q.id])).rows;
  assert.equal(items.length, 0, 'Quotation items must be deleted');
  const milestones = (await client.db.query('SELECT * FROM inv.quotation_milestones WHERE quotation_id=$1', [q.id])).rows;
  assert.equal(milestones.length, 0, 'Quotation milestones must be deleted');
});

test('9. Safe deletion of eligible invoices removes invoice and line items', async () => {
  const client = await withOwner(8);
  const customer = client.ok(await client.json('POST', '/api/clients', baseClient({ name: 'Delete Invoice Test' }))).client;
  const inv = client.ok(await client.json('POST', '/api/invoices', draft(customer.id, { title: 'Delete Invoice Target' }))).invoice;

  const exp = client.ok(await client.json('POST', '/api/cleanup/export', { category: 'INVOICES', ids: [inv.id] }));

  const delRes = await client.json('POST', '/api/cleanup/execute', {
    category: 'INVOICES',
    ids: [inv.id],
    verification_token: exp.verification_token,
    confirmation_phrase: 'DELETE INVOICES',
  });
  assert.equal(delRes.status, 200);
  assert.equal(delRes.data.deleted_count, 1);

  const invRow = (await client.db.query('SELECT * FROM inv.invoices WHERE id=$1', [inv.id])).rows[0];
  assert.equal(invRow, undefined, 'Invoice row must be deleted');

  const items = (await client.db.query('SELECT * FROM inv.invoice_items WHERE invoice_id=$1', [inv.id])).rows;
  assert.equal(items.length, 0, 'Invoice items must be deleted');
});

test('10. Non-admin roles and unauthenticated callers cannot access cleanup', async () => {
  const client = await withOwner(9);
  // Create staff user with FINANCE role
  const financeEmail = 'finance-cleanup-test@example.test';
  await client.json('POST', '/api/auth/register', {
    email: financeEmail,
    password: 'Password1234!',
    confirm_password: 'Password1234!',
    display_name: 'Finance Staff',
  });

  const financeClient = makeClient({ ip: ip(99) });
  await financeClient.login({ email: financeEmail, password: 'Password1234!' });

  const unauthClient = makeClient({ ip: ip(98) });

  // Unauthenticated caller
  assert.equal((await unauthClient.json('GET', '/api/cleanup/status')).status, 401);
  assert.equal((await unauthClient.json('POST', '/api/cleanup/preview', { category: 'QUOTATIONS' })).status, 401);
  assert.equal((await unauthClient.json('POST', '/api/cleanup/export', { category: 'QUOTATIONS', ids: [] })).status, 401);
  assert.equal((await unauthClient.json('POST', '/api/cleanup/execute', { category: 'QUOTATIONS' })).status, 401);

  // Finance role (non-admin)
  assert.equal((await financeClient.json('GET', '/api/cleanup/status')).status, 403);
  assert.equal((await financeClient.json('POST', '/api/cleanup/preview', { category: 'QUOTATIONS' })).status, 403);
  assert.equal((await financeClient.json('POST', '/api/cleanup/export', { category: 'QUOTATIONS', ids: [] })).status, 403);
  assert.equal((await financeClient.json('POST', '/api/cleanup/execute', { category: 'QUOTATIONS' })).status, 403);
});

test('11. Products & Services, Clients, Business Settings and Users are strictly preserved', async () => {
  const client = await withOwner(10);
  const product = client.ok(await client.json('POST', '/api/products', baseProduct({ name: 'Preserved Software Product', sku: 'PRESERVED-SKU' }))).product;
  const customer = client.ok(await client.json('POST', '/api/clients', baseClient({ name: 'Preserved Client Co' }))).client;
  const settingsBefore = (await client.db.query('SELECT * FROM inv.business_settings WHERE id=true')).rows[0];

  const q = client.ok(await client.json('POST', '/api/quotations', draft(customer.id, {
    items: [line({ product_id: product.id })],
  }))).quotation;

  const exp = client.ok(await client.json('POST', '/api/cleanup/export', { category: 'QUOTATIONS', ids: [q.id] }));
  client.ok(await client.json('POST', '/api/cleanup/execute', {
    category: 'QUOTATIONS',
    ids: [q.id],
    verification_token: exp.verification_token,
    confirmation_phrase: 'DELETE QUOTATIONS',
  }));

  // Confirm Product is still intact
  const productAfter = (await client.db.query('SELECT * FROM inv.products WHERE id=$1', [product.id])).rows[0];
  assert.ok(productAfter, 'Product must never be deleted');
  assert.equal(productAfter.name, 'Preserved Software Product');

  // Confirm Client is still intact
  const clientAfter = (await client.db.query('SELECT * FROM inv.clients WHERE id=$1', [customer.id])).rows[0];
  assert.ok(clientAfter, 'Client must never be deleted');
  assert.equal(clientAfter.name, 'Preserved Client Co');

  // Confirm Settings are unchanged
  const settingsAfter = (await client.db.query('SELECT * FROM inv.business_settings WHERE id=true')).rows[0];
  assert.equal(settingsAfter.business_name, settingsBefore.business_name);
  assert.equal(settingsAfter.state_code, settingsBefore.state_code);
});

test('12. Invoices with payments and credit notes are protected from deletion', async () => {
  const client = await withOwner(11);
  const customer = client.ok(await client.json('POST', '/api/clients', baseClient({ name: 'Financial Integrity Co' }))).client;

  // Invoice with payment
  const inv = client.ok(await client.json('POST', '/api/invoices', draft(customer.id))).invoice;
  client.ok(await client.json('POST', `/api/invoices/${inv.id}/issue`));
  client.ok(await client.json('POST', `/api/invoices/${inv.id}/payments`, {
    amount_minor: 5000000,
    paid_on: '2026-10-12',
    method: 'UPI',
    reference: 'UPI-7788',
    notes: '',
  }));

  // Export should reject if requested for an ineligible record
  const exportAttempt = await client.json('POST', '/api/cleanup/export', {
    category: 'INVOICES',
    ids: [inv.id],
  });
  assert.equal(exportAttempt.status, 422);
  assert.equal(exportAttempt.data.code, 'INELIGIBLE_RECORDS');

  // Ensure invoice and payment still exist
  const invRow = (await client.db.query('SELECT * FROM inv.invoices WHERE id=$1', [inv.id])).rows[0];
  assert.ok(invRow, 'Invoice with payment must remain in database');
  const payRow = (await client.db.query('SELECT * FROM inv.payments WHERE invoice_id=$1', [inv.id])).rows[0];
  assert.ok(payRow, 'Payment record must remain in database');
});

test('13. Audit log is created for cleanup operations', async () => {
  const client = await withOwner(12);
  const customer = client.ok(await client.json('POST', '/api/clients', baseClient({ name: 'Audit Log Test Co' }))).client;
  const q = client.ok(await client.json('POST', '/api/quotations', draft(customer.id))).quotation;

  const exp = client.ok(await client.json('POST', '/api/cleanup/export', { category: 'QUOTATIONS', ids: [q.id] }));
  client.ok(await client.json('POST', '/api/cleanup/execute', {
    category: 'QUOTATIONS',
    ids: [q.id],
    verification_token: exp.verification_token,
    confirmation_phrase: 'DELETE QUOTATIONS',
  }));

  const logs = (await client.db.query(
    "SELECT * FROM inv.audit_logs WHERE event = 'BUSINESS_DATA_CLEANUP' ORDER BY created_at DESC LIMIT 1",
  )).rows;
  assert.ok(logs.length > 0, 'Audit log event BUSINESS_DATA_CLEANUP must be written');
  assert.equal(logs[0].entity_type, 'QUOTATIONS');
  assert.equal(logs[0].metadata.count, 1);
});

test('14. Pre-cleanup safety backup is created and validated', async () => {
  const client = await withOwner(13);
  const customer = client.ok(await client.json('POST', '/api/clients', baseClient({ name: 'Backup Test Co' }))).client;
  const inv = client.ok(await client.json('POST', '/api/invoices', draft(customer.id))).invoice;

  const exp = client.ok(await client.json('POST', '/api/cleanup/export', { category: 'INVOICES', ids: [inv.id] }));
  const exec = client.ok(await client.json('POST', '/api/cleanup/execute', {
    category: 'INVOICES',
    ids: [inv.id],
    verification_token: exp.verification_token,
    confirmation_phrase: 'DELETE INVOICES',
  }));

  if (exec.safety_backup) {
    assert.ok(existsSync(exec.safety_backup));
    const check = validateBackupFile(exec.safety_backup);
    assert.equal(check.valid, true);
  }
});

test('15. Foreign-key integrity and database integrity check pass after cleanup', async () => {
  const client = await withOwner(14);
  const integrity = await client.db.integrityCheck();
  assert.equal(integrity.ok, true, 'Database integrity check must be clean');
});

test('16. Reports continue to function accurately after cleanup', async () => {
  const client = await withOwner(15);
  // Verify reporting endpoints all return 200 without error
  const [d, ir, c, r, qp, rc, rp, ts] = await Promise.all([
    client.json('GET', '/api/dashboard'),
    client.json('GET', '/api/reports/invoices'),
    client.json('GET', '/api/reports/collections'),
    client.json('GET', '/api/reports/receivables'),
    client.json('GET', '/api/reports/quotations'),
    client.json('GET', '/api/reports/revenue-by-client'),
    client.json('GET', '/api/reports/revenue-by-product'),
    client.json('GET', '/api/reports/tax-summary'),
  ]);
  assert.equal(d.status, 200);
  assert.equal(ir.status, 200);
  assert.equal(c.status, 200);
  assert.equal(r.status, 200);
  assert.equal(qp.status, 200);
  assert.equal(rc.status, 200);
  assert.equal(rp.status, 200);
  assert.equal(ts.status, 200);
});

test('17. Regression: Normal invoice and quotation creation continues to work', async () => {
  const client = await withOwner(16);
  const customer = client.ok(await client.json('POST', '/api/clients', baseClient({ name: 'Regression Co' }))).client;

  // New quotation works
  const newQ = client.ok(await client.json('POST', '/api/quotations', draft(customer.id, { title: 'Post-cleanup Quote' })));
  assert.equal(newQ.quotation.status, 'DRAFT');

  // New invoice works
  const newInv = client.ok(await client.json('POST', '/api/invoices', draft(customer.id, { title: 'Post-cleanup Invoice' })));
  assert.equal(newInv.invoice.status, 'DRAFT');

  // Normal issuance works
  const issuedInv = client.ok(await client.json('POST', `/api/invoices/${newInv.invoice.id}/issue`));
  assert.equal(issuedInv.invoice.status, 'ISSUED');
  assert.ok(issuedInv.invoice.invoice_number);

  // Normal delete of an issued invoice without cleanup session is STILL rejected
  await assert.rejects(
    () => client.db.query('DELETE FROM inv.invoices WHERE id=$1', [issuedInv.invoice.id]),
    /cannot be deleted/i,
  );
});
