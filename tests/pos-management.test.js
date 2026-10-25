import test from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, baseProduct, baseClient, configureIssuer } from './helpers.js';

const ip = suffix => `10.4.0.${suffix}`;

async function withOwner(suffix) {
  const client = makeClient({ ip: ip(suffix) });
  await client.login();
  await configureIssuer(client);
  const employee = client.ok(await client.json('POST', '/api/tracker/employees', { name: `Staff ${suffix}` }), 'employee');
  const plan1Yr = client.ok(await client.json('POST', '/api/tracker/plans',
    { label: `1 Year Plan ${suffix}`, duration_months: 12 }), 'plan');
  const planLifetime = client.ok(await client.json('POST', '/api/tracker/plans',
    { label: `Lifetime Plan ${suffix}`, duration_months: 0, is_lifetime: true }), 'plan');
  const productDesktop = client.ok(await client.json('POST', '/api/products', baseProduct({
    name: `Nextora POS Desktop ${suffix}`, sku: `POS-DESK-${suffix}`, category: 'Nextora POS', license_duration_months: 12,
  })), 'product');
  const productMobile = client.ok(await client.json('POST', '/api/products', baseProduct({
    name: `Nextora POS Mobile App ${suffix}`, sku: `POS-MOB-${suffix}`, category: 'Nextora POS', license_duration_months: 12,
  })), 'product');
  return {
    client,
    employee: employee.employee,
    plan1Yr: plan1Yr.plan,
    planLifetime: planLifetime.plan,
    productDesktop: productDesktop.product,
    productMobile: productMobile.product,
  };
}

test('POS Customer: full customer editing persists all standard and custom fields', async () => {
  const setup = await withOwner(1);
  const client = setup.client;

  // 1. Create a custom field
  const customField = client.ok(await client.json('POST', '/api/tracker/fields', {
    label: 'GST Category 1', field_type: 'TEXT', description: 'Tax slab category',
    required: false, visible: true, width: 160, editor_roles: ['OWNER', 'ADMIN'],
  })).field;

  // 2. Create customer
  const created = client.ok(await client.json('POST', '/api/tracker/customers', {
    name: 'Initial Name',
    business_name: 'Initial Business',
    address: 'Initial Address',
    remarks: 'Initial Remarks',
    employee_id: setup.employee.id,
    phone: '+91 98765 43210',
    email: 'initial@customer.test',
    status: 'ACTIVE',
    subscription: {
      product_id: setup.productDesktop.id,
      plan_id: setup.plan1Yr.id,
      purchase_date: '2026-10-01',
      start_date: '2026-10-01',
      expiry_date: '2027-10-01',
      is_lifetime: false,
      status: 'ACTIVE',
    },
  })).customer;

  // Set custom field value
  await client.json('PUT', `/api/tracker/customers/${created.id}/fields`, {
    values: [{ definition_id: customField.id, value: 'Tier 1' }],
  });

  // 3. Edit customer with updated fields
  const updated = client.ok(await client.json('PATCH', `/api/tracker/customers/${created.id}`, {
    name: 'Updated Name Pvt Ltd',
    business_name: 'Updated Mega Stores',
    address: 'Suite 400, Financial District',
    remarks: 'Upgraded to premium support',
    employee_id: setup.employee.id,
    phone: '+91 99999 88888',
    email: 'updated@customer.test',
    status: 'ACTIVE',
    expected_updated_at: created.updated_at,
    custom_values: [{ definition_id: customField.id, value: 'Tier 2 Enterprise' }],
  })).customer;

  assert.equal(updated.name, 'Updated Name Pvt Ltd');
  assert.equal(updated.business_name, 'Updated Mega Stores');
  assert.equal(updated.address, 'Suite 400, Financial District');
  assert.equal(updated.remarks, 'Upgraded to premium support');
  assert.equal(updated.phone, '+91 99999 88888');
  assert.equal(updated.email, 'updated@customer.test');

  // Verify getCustomer reflects the updated customer and custom field
  const detail = client.ok(await client.json('GET', `/api/tracker/customers/${created.id}`));
  assert.equal(detail.customer.name, 'Updated Name Pvt Ltd');
  assert.equal(detail.customer.business_name, 'Updated Mega Stores');
  const fieldVal = detail.custom.find(c => c.definition_id === customField.id);
  assert.equal(fieldVal?.value, 'Tier 2 Enterprise');

  // Clean up custom field so subsequent tests see clean default columns
  await client.json('POST', `/api/tracker/fields/${customField.id}/status`, { status: 'ARCHIVED' });
});

test('POS Customer: edit purchase updates only selected purchase and preserves history', async () => {
  const setup = await withOwner(2);
  const client = setup.client;

  // 1. Create customer with first purchase (Desktop)
  const created = client.ok(await client.json('POST', '/api/tracker/customers', {
    name: 'Multi Purchase Customer',
    business_name: 'Tech Cafe',
    address: 'Kondapur, Hyderabad',
    employee_id: setup.employee.id,
    subscription: {
      product_id: setup.productDesktop.id,
      plan_id: setup.plan1Yr.id,
      purchase_date: '2026-01-15',
      expiry_date: '2027-01-15',
      status: 'ACTIVE',
      amount_minor: 2500000,
      transaction_reference: 'TXN-001',
    },
  }));
  const customerId = created.customer.id;
  const firstSub = created.subscriptions[0];

  // 2. Add second purchase (Mobile renewal or expansion)
  const secondSub = client.ok(await client.json('POST', `/api/tracker/customers/${customerId}/subscriptions`, {
    product_id: setup.productMobile.id,
    plan_id: setup.planLifetime.id,
    purchase_date: '2026-06-20',
    is_lifetime: true,
    status: 'ACTIVE',
    amount_minor: 1500000,
    transaction_reference: 'TXN-002',
    notes: 'Mobile expansion licence',
  })).subscription;

  // 3. Edit the FIRST purchase only
  const editedFirstSub = client.ok(await client.json('PATCH', `/api/tracker/subscriptions/${firstSub.id}`, {
    product_id: setup.productDesktop.id,
    plan_id: setup.plan1Yr.id,
    purchase_date: '2026-02-01',
    expiry_date: '2027-02-01',
    is_lifetime: false,
    status: 'EXPIRED',
    amount_minor: 2800000,
    transaction_reference: 'TXN-001-CORRECTED',
    notes: 'Corrected purchase date to Feb 1',
  })).subscription;

  assert.equal(editedFirstSub.purchase_date, '2026-02-01');
  assert.equal(editedFirstSub.expiry_date, '2027-02-01');
  assert.equal(editedFirstSub.status, 'EXPIRED');
  assert.equal(editedFirstSub.transaction_reference, 'TXN-001-CORRECTED');

  // Verify full detail: second subscription remains completely intact and unchanged
  const detail = client.ok(await client.json('GET', `/api/tracker/customers/${customerId}`));
  assert.equal(detail.subscriptions.length, 2);
  const foundSecond = detail.subscriptions.find(s => s.id === secondSub.id);
  assert.ok(foundSecond, 'Second subscription must remain');
  assert.equal(foundSecond.purchase_date, '2026-06-20');
  assert.equal(foundSecond.is_lifetime, true);
  assert.equal(foundSecond.transaction_reference, 'TXN-002');
});

test('POS Customer: delete eligible customer permanently removes unlinked record', async () => {
  const setup = await withOwner(3);
  const client = setup.client;

  // Create isolated customer with unlinked subscription
  const created = client.ok(await client.json('POST', '/api/tracker/customers', {
    name: 'Deletable Customer',
    business_name: 'Disposable Retail',
    address: 'Secunderabad',
    employee_id: setup.employee.id,
    subscription: {
      product_id: setup.productDesktop.id,
      plan_id: setup.plan1Yr.id,
      purchase_date: '2026-10-01',
      expiry_date: '2027-10-01',
      is_lifetime: false,
      status: 'ACTIVE',
    },
  })).customer;

  // Delete customer
  const delRes = client.ok(await client.json('DELETE', `/api/tracker/customers/${created.id}`));
  assert.equal(delRes.deleted, true);

  // Customer must no longer exist in tracker
  const getRes = await client.json('GET', `/api/tracker/customers/${created.id}`);
  assert.equal(getRes.status, 404);

  // Verify subscriptions and custom fields are removed
  const subCount = (await client.db.query('SELECT count(*)::int AS n FROM inv.pos_subscriptions WHERE customer_id=$1', [created.id])).rows[0].n;
  assert.equal(subCount, 0);

  // Verify audit log has CUSTOMER_DELETED
  const auditLogs = (await client.db.query("SELECT * FROM inv.audit_logs WHERE event='CUSTOMER_DELETED' AND entity_id=$1", [created.id])).rows;
  assert.equal(auditLogs.length, 1);
});

test('POS Customer: delete protected customer linked to issued invoice is blocked with 409', async () => {
  const setup = await withOwner(4);
  const client = setup.client;

  // Create billing client
  const billingClient = client.ok(await client.json('POST', '/api/clients', baseClient({
    name: 'Protected POS Buyer Ltd',
  }))).client;

  // Create invoice with POS product and issue it
  const inv = client.ok(await client.json('POST', '/api/invoices', {
    client_id: billingClient.id,
    title: 'POS Desktop Rollout',
    issue_date: '2026-10-20',
    place_of_supply_state_code: '36',
    items: [{
      product_id: setup.productDesktop.id,
      description: 'Nextora POS Desktop licence',
      unit: 'LIC',
      quantity_milli: 1000,
      unit_price_minor: 2500000,
      tax_treatment: 'TAXABLE',
      tax_rate_bp: 1800,
    }],
  })).invoice;

  // Issue the invoice (triggers sync)
  await client.json('POST', `/api/invoices/${inv.id}/issue`);

  // Find customer created by sync
  const posCustomer = (await client.db.query('SELECT * FROM inv.pos_customers WHERE client_id=$1', [billingClient.id])).rows[0];
  assert.ok(posCustomer, 'Customer should be auto-synced');

  // Attempt permanent deletion - must be BLOCKED with 409
  const delRes = await client.json('DELETE', `/api/tracker/customers/${posCustomer.id}`);
  assert.equal(delRes.status, 409);
  assert.equal(delRes.data.code, 'CUSTOMER_PROTECTED');
  assert.ok(delRes.data.error.includes('associated financial records'));

  // Verify customer still exists
  const check = client.ok(await client.json('GET', `/api/tracker/customers/${posCustomer.id}`));
  assert.equal(check.customer.name, 'Protected POS Buyer Ltd');

  // Verify archiving still works as the permitted alternative
  const archiveRes = client.ok(await client.json('POST', `/api/tracker/customers/${posCustomer.id}/status`, { status: 'ARCHIVED' }));
  assert.equal(archiveRes.customer.status, 'ARCHIVED');
});

test('POS Customer: delete eligible purchase removes only target purchase; protected purchase blocked', async () => {
  const setup = await withOwner(5);
  const client = setup.client;

  // Create customer with 2 purchases
  const created = client.ok(await client.json('POST', '/api/tracker/customers', {
    name: 'Dual Purchase Client',
    business_name: 'Dual Shop',
    address: 'Madhapur',
    employee_id: setup.employee.id,
    subscription: {
      product_id: setup.productDesktop.id,
      plan_id: setup.plan1Yr.id,
      purchase_date: '2026-03-01',
      expiry_date: '2027-03-01',
      status: 'ACTIVE',
    },
  }));
  const customerId = created.customer.id;
  const sub1 = created.subscriptions[0];

  const sub2 = client.ok(await client.json('POST', `/api/tracker/customers/${customerId}/subscriptions`, {
    product_id: setup.productMobile.id,
    plan_id: setup.planLifetime.id,
    purchase_date: '2026-04-01',
    is_lifetime: true,
    status: 'ACTIVE',
  })).subscription;

  // 1. Delete eligible purchase (sub2)
  const delSubRes = client.ok(await client.json('DELETE', `/api/tracker/subscriptions/${sub2.id}`));
  assert.equal(delSubRes.deleted, true);

  // Customer should now have only sub1
  const detailAfter = client.ok(await client.json('GET', `/api/tracker/customers/${customerId}`));
  assert.equal(detailAfter.subscriptions.length, 1);
  assert.equal(detailAfter.subscriptions[0].id, sub1.id);

  // 2. Test protected purchase: link sub1 to a real invoice to test safeguard
  const buyerForSub = client.ok(await client.json('POST', '/api/clients', baseClient({
    name: 'Invoice Client For Sub',
  }))).client;
  const realInvoice = client.ok(await client.json('POST', '/api/invoices', {
    client_id: buyerForSub.id,
    title: 'POS Lic',
    issue_date: '2026-03-01',
    place_of_supply_state_code: '36',
    items: [{
      description: 'Nextora POS Desktop licence',
      unit: 'LIC',
      quantity_milli: 1000,
      unit_price_minor: 2500000,
      tax_treatment: 'TAXABLE',
      tax_rate_bp: 1800,
    }],
  })).invoice;
  await client.db.query('UPDATE inv.pos_subscriptions SET invoice_id=$1 WHERE id=$2', [realInvoice.id, sub1.id]);

  const delProtectedRes = await client.json('DELETE', `/api/tracker/subscriptions/${sub1.id}`);
  assert.equal(delProtectedRes.status, 409);
  assert.equal(delProtectedRes.data.code, 'PURCHASE_PROTECTED');
});

test('POS Customer: automatic sync from Desktop and Mobile invoice generation', async () => {
  const setup = await withOwner(6);
  const client = setup.client;

  // 1. Create client
  const buyer = client.ok(await client.json('POST', '/api/clients', baseClient({
    name: 'Sync Verification Store',
    company_name: 'Sync Retail Hub',
    phone: '+91 91111 22222',
    email: 'sync.verification@store.test',
  }))).client;

  // 2. Issue invoice with Nextora POS Mobile product
  const invoice1 = client.ok(await client.json('POST', '/api/invoices', {
    client_id: buyer.id,
    title: 'POS Mobile Purchase',
    issue_date: '2026-10-24',
    place_of_supply_state_code: '36',
    items: [{
      product_id: setup.productMobile.id,
      description: 'Nextora POS Mobile App licence',
      unit: 'LIC',
      quantity_milli: 1000,
      unit_price_minor: 599900,
      tax_treatment: 'TAXABLE',
      tax_rate_bp: 1800,
    }],
  })).invoice;

  const issued1 = client.ok(await client.json('POST', `/api/invoices/${invoice1.id}/issue`));
  assert.ok(issued1.invoice.invoice_number);

  // Verify customer was created and matched
  const custRow = (await client.db.query('SELECT * FROM inv.pos_customers WHERE client_id=$1', [buyer.id])).rows[0];
  assert.ok(custRow, 'Customer must be created in tracker');
  assert.equal(custRow.name, 'Sync Verification Store');
  assert.equal(custRow.business_name, 'Sync Retail Hub');

  // Verify subscription details: 1-year expiry from 2026-10-24 -> 2027-10-24
  const subs = (await client.db.query('SELECT * FROM inv.pos_subscriptions WHERE customer_id=$1', [custRow.id])).rows;
  assert.equal(subs.length, 1);
  assert.equal(subs[0].product_id, setup.productMobile.id);
  assert.equal(subs[0].purchase_date, '2026-10-24');
  assert.equal(subs[0].expiry_date, '2027-10-24');
  assert.equal(subs[0].invoice_id, invoice1.id);
  assert.equal(subs[0].transaction_reference, issued1.invoice.invoice_number);

  // 3. Issue a second invoice for the SAME client (Nextora POS Desktop)
  const invoice2 = client.ok(await client.json('POST', '/api/invoices', {
    client_id: buyer.id,
    title: 'POS Desktop Expansion',
    issue_date: '2026-10-25',
    place_of_supply_state_code: '36',
    items: [{
      product_id: setup.productDesktop.id,
      description: 'Nextora POS Desktop licence',
      unit: 'LIC',
      quantity_milli: 1000,
      unit_price_minor: 2500000,
      tax_treatment: 'TAXABLE',
      tax_rate_bp: 1800,
    }],
  })).invoice;

  const issued2 = client.ok(await client.json('POST', `/api/invoices/${invoice2.id}/issue`));

  // Must NOT create a duplicate customer profile
  const custCount = (await client.db.query('SELECT count(*)::int AS n FROM inv.pos_customers WHERE client_id=$1', [buyer.id])).rows[0].n;
  assert.equal(custCount, 1, 'Repeated invoices must not create duplicate customers');

  // Must add second purchase correctly
  const allSubs = (await client.db.query('SELECT * FROM inv.pos_subscriptions WHERE customer_id=$1 ORDER BY purchase_date ASC', [custRow.id])).rows;
  assert.equal(allSubs.length, 2);
  assert.equal(allSubs[1].product_id, setup.productDesktop.id);
  assert.equal(allSubs[1].purchase_date, '2026-10-25');
  assert.equal(allSubs[1].expiry_date, '2027-10-25');
  assert.equal(allSubs[1].invoice_id, invoice2.id);
});
