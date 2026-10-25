import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { makeClient, baseProduct, configureIssuer } from './helpers.js';

const ip = suffix => `10.3.0.${suffix}`;

/**
 * Every test owns its own employee, plan and product so that the shared
 * database never makes one test depend on another's rows.
 */
async function withOwner(suffix) {
  const client = makeClient({ ip: ip(suffix) });
  await client.login();
  await configureIssuer(client);
  const employee = client.ok(await client.json('POST', '/api/tracker/employees', { name: `Employee ${suffix}` }), 'employee');
  const plan = client.ok(await client.json('POST', '/api/tracker/plans',
    { label: `Yearly ${suffix}`, duration_months: 12 }), 'plan');
  const product = client.ok(await client.json('POST', '/api/products', baseProduct({
    name: 'Nextora POS Desktop', sku: `NCPOS-DESK-${suffix}`,
  })), 'product');
  return {
    client, employee: employee.employee, plan: plan.plan, product: product.product,
    scope: `employee_id=${employee.employee.id}`,
  };
}

const customer = (setup, overrides = {}) => ({
  name: 'Srinu Reddy', business_name: 'Spice Route Restaurant', address: '12 MG Road\nHyderabad 500081',
  employee_id: setup.employee.id, remarks: 'Renewal discussed in March',
  subscription: {
    product_id: setup.product.id, plan_id: setup.plan.id, purchase_date: '2026-01-15',
    start_date: '2026-01-15', expiry_date: '2027-01-14', is_lifetime: false, status: 'ACTIVE',
  },
  ...overrides,
});

const listOf = async (client, query) => client.ok(await client.json('GET', `/api/tracker/customers?${query}`));

test('default columns are declared once and shown in order with a derived S.No.', async () => {
  const owner = await withOwner(1);
  for (const name of ['Cafe One', 'Cafe Two', 'Cafe Three']) {
    owner.client.ok(await owner.client.json('POST', '/api/tracker/customers', customer(owner, { name })));
  }
  const reference = owner.client.ok(await owner.client.json('GET', '/api/tracker/reference'));
  assert.deepEqual(reference.columns.map(column => column.label).slice(0, 10),
    ['S.No.', 'Customer Name', 'Customer Business Name', 'Address', 'Employee Assigned', 'Date of Purchase',
      'Product', 'Subscription', 'Date of Expiry', 'Remarks']);

  const list = await listOf(owner.client, `limit=100&sort=name&direction=asc&${owner.scope}`);
  assert.deepEqual(list.customers.map(row => row.serial), [1, 2, 3], 'S.No. is sequential over the filtered set');
  assert.deepEqual(list.customers.map(row => row.name), ['Cafe One', 'Cafe Three', 'Cafe Two']);
  const first = list.customers[0];
  assert.notEqual(first.id, first.serial, 'the display number is not the record identity');
  assert.equal(first.employee_name, 'Employee 1');
  assert.equal(first.product_name, 'Nextora POS Desktop');
  assert.equal(first.plan_label, 'Yearly 1');
  assert.equal(first.purchase_date, '2026-01-15');
  assert.equal(first.expiry_date, '2027-01-14');
});

test('a customer is created, edited with concurrency protection, archived and restored', async () => {
  const owner = await withOwner(2);
  const created = owner.client.ok(await owner.client.json('POST', '/api/tracker/customers', customer(owner)), 'create');
  assert.equal(created.customer.name, 'Srinu Reddy');
  assert.equal(created.subscriptions.length, 1);
  assert.equal(created.subscriptions[0].purchase_date, '2026-01-15');

  const edited = owner.client.ok(await owner.client.json('PATCH', `/api/tracker/customers/${created.customer.id}`,
    { ...customer(owner, { business_name: 'Spice Route Restaurant - Jubilee Hills' }),
      expected_updated_at: created.customer.updated_at }), 'edit');
  assert.equal(edited.customer.business_name, 'Spice Route Restaurant - Jubilee Hills');

  // A stale editor must not overwrite what someone else already saved.
  const stale = await owner.client.json('PATCH', `/api/tracker/customers/${created.customer.id}`,
    { ...customer(owner, { name: 'Overwritten' }), expected_updated_at: created.customer.updated_at });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'STALE_ROW');

  const archived = owner.client.ok(await owner.client.json('POST', `/api/tracker/customers/${created.customer.id}/status`,
    { status: 'ARCHIVED' }), 'archive');
  assert.equal(archived.customer.status, 'ARCHIVED');
  assert.ok(archived.customer.archived_at);
  assert.equal((await listOf(owner.client, owner.scope)).total, 0, 'an archived customer leaves the default view');
  assert.equal((await listOf(owner.client, `${owner.scope}&status=ARCHIVED`)).total, 1);
  const restored = owner.client.ok(await owner.client.json('POST', `/api/tracker/customers/${created.customer.id}/status`,
    { status: 'ACTIVE' }), 'restore');
  assert.equal(restored.customer.status, 'ACTIVE');
  assert.equal(restored.customer.archived_at, null, 'restoring clears the archive stamp');

  // Archiving never destroys the purchase history.
  const subscriptions = (await owner.client.db.query(
    'SELECT count(*)::int AS n FROM inv.pos_subscriptions WHERE customer_id=$1', [created.customer.id])).rows[0].n;
  assert.equal(subscriptions, 1);

  const missing = await owner.client.json('GET', '/api/tracker/customers/6f1a5c9e-0000-4000-8000-000000000000');
  assert.equal(missing.status, 404);
});

test('duplicate customers are warned about, not blocked', async () => {
  const owner = await withOwner(3);
  const first = owner.client.ok(await owner.client.json('POST', '/api/tracker/customers', customer(owner)));
  const again = owner.client.ok(await owner.client.json('POST', '/api/tracker/customers', customer(owner, {
    business_name: 'Another Shop', remarks: 'Second outlet',
  })), 'second record');
  assert.ok(again.warnings.length >= 1, 'the operator is warned');
  assert.ok(again.duplicates.some(row => row.id === first.customer.id), 'the existing record is named in the warning');
  assert.ok(again.customer.id, 'the record is still created');
  const checked = owner.client.ok(await owner.client.json('POST', '/api/tracker/customers/check-duplicates',
    { name: 'Srinu Reddy', phone: '', email: '', business_name: 'Spice Route Restaurant' }));
  assert.ok(checked.duplicates.some(row => row.id === first.customer.id));
  assert.ok(checked.warnings.length >= 1);
});

test('custom columns are added, typed, reordered, renamed and archived without losing values', async () => {
  const owner = await withOwner(4);
  const created = owner.client.ok(await owner.client.json('POST', '/api/tracker/customers', customer(owner)));

  const field = owner.client.ok(await owner.client.json('POST', '/api/tracker/fields', {
    label: 'Activation Key', field_type: 'TEXT', description: 'POS activation key',
  }), 'add column');
  const status = owner.client.ok(await owner.client.json('POST', '/api/tracker/fields', {
    label: 'Payment Status', field_type: 'DROPDOWN', options: ['Paid', 'Pending', 'Partial'],
  }), 'add dropdown');

  owner.client.ok(await owner.client.json('PUT', `/api/tracker/customers/${created.customer.id}/fields`, {
    values: [{ definition_id: field.field.id, value: 'NCPOS-ACT-9931' },
      { definition_id: status.field.id, value: 'Paid' }],
  }), 'save values');
  const detail = owner.client.ok(await owner.client.json('GET', `/api/tracker/customers/${created.customer.id}`));
  assert.equal(detail.custom.length, 2);
  assert.equal(detail.custom.find(row => row.definition_id === field.field.id).value, 'NCPOS-ACT-9931');

  // Values are validated by type on the server, never only in the browser.
  const badOption = await owner.client.json('PUT', `/api/tracker/customers/${created.customer.id}/fields`, {
    values: [{ definition_id: status.field.id, value: 'Probably' }],
  });
  assert.equal(badOption.status, 422);
  assert.equal(badOption.data.code, 'INVALID_FIELD_VALUE');
  const dateField = owner.client.ok(await owner.client.json('POST', '/api/tracker/fields',
    { label: 'Renewal Date', field_type: 'DATE' }));
  const badDate = await owner.client.json('PUT', `/api/tracker/customers/${created.customer.id}/fields`, {
    values: [{ definition_id: dateField.field.id, value: '31-02-2026' }],
  });
  assert.equal(badDate.status, 422);
  const requiredField = owner.client.ok(await owner.client.json('POST', '/api/tracker/fields',
    { label: 'Transaction Reference', field_type: 'TEXT', required: true }));
  const blank = await owner.client.json('PUT', `/api/tracker/customers/${created.customer.id}/fields`, {
    values: [{ definition_id: requiredField.field.id, value: '  ' }],
  });
  assert.equal(blank.status, 422, 'a required custom field refuses an empty value');

  // Reordering columns and renaming a field keep every stored value.
  owner.client.ok(await owner.client.json('PUT', '/api/tracker/columns', {
    columns: [{ key: 'name', width: 240 }, { key: 'serial', width: 80 },
      { key: `custom:${field.field.id}`, width: 180, visible: true }, { key: 'address', visible: false }],
  }), 'layout');
  owner.client.ok(await owner.client.json('PATCH', `/api/tracker/fields/${field.field.id}`, {
    label: 'Activation Key (POS)', field_type: 'TEXT', description: 'Renamed', position: 1, width: 200,
  }), 'rename');
  const after = owner.client.ok(await owner.client.json('GET', `/api/tracker/customers/${created.customer.id}`));
  assert.equal(after.custom.find(row => row.definition_id === field.field.id).value, 'NCPOS-ACT-9931');
  const reference = owner.client.ok(await owner.client.json('GET', '/api/tracker/reference'));
  const addressColumn = reference.columns.find(column => column.key === 'address');
  assert.equal(addressColumn.visible, false, 'a hidden column stays hidden between requests');
  assert.equal(reference.columns.find(column => column.key === 'name').width, 240);
  assert.equal(reference.columns[0].key, 'name', 'the stored order is applied');

  // Archiving a column keeps its values and removes it from the grid.
  const archived = owner.client.ok(await owner.client.json('POST', `/api/tracker/fields/${field.field.id}/status`,
    { status: 'ARCHIVED' }), 'archive column');
  assert.equal(archived.field.status, 'ARCHIVED');
  assert.equal((await owner.client.db.query('SELECT value FROM inv.custom_field_values WHERE definition_id=$1',
    [field.field.id])).rows[0].value, 'NCPOS-ACT-9931');
  const grid = owner.client.ok(await owner.client.json('GET', '/api/tracker/reference'));
  assert.equal(grid.columns.some(column => column.key === `custom:${field.field.id}`), false);

  // Changing the type of a column that holds data would reinterpret it.
  const retype = await owner.client.json('PATCH', `/api/tracker/fields/${status.field.id}`,
    { label: 'Payment Status', field_type: 'NUMBER' });
  assert.equal(retype.status, 409);
  assert.equal(retype.data.code, 'FIELD_HAS_VALUES');
});

test('a renewal appends a subscription and keeps the previous one', async () => {
  const owner = await withOwner(5);
  const created = owner.client.ok(await owner.client.json('POST', '/api/tracker/customers', customer(owner)));

  const renewed = owner.client.ok(await owner.client.json('POST',
    `/api/tracker/customers/${created.customer.id}/subscriptions`, {
      product_id: owner.product.id, plan_id: owner.plan.id, purchase_date: '2027-01-20', start_date: '2027-01-15',
      expiry_date: '2028-01-14', is_lifetime: false, status: 'ACTIVE', renews: true,
    }), 'renew');
  assert.equal(renewed.subscription.renewed_from, created.subscriptions[0].id);

  const detail = owner.client.ok(await owner.client.json('GET', `/api/tracker/customers/${created.customer.id}`));
  assert.equal(detail.subscriptions.length, 2, 'history keeps both purchases');
  assert.equal(detail.subscriptions.filter(row => row.status === 'CANCELLED').length, 1);
  const list = await listOf(owner.client, owner.scope);
  assert.equal(list.customers[0].purchase_date, '2027-01-20', 'the grid shows the current subscription');
  assert.equal(list.customers[0].subscription_count, 2);

  // A lifetime purchase carries no expiry date and needs none.
  const lifetime = owner.client.ok(await owner.client.json('POST', '/api/tracker/plans',
    { label: 'Lifetime', duration_months: 0, is_lifetime: true }));
  const lifetimeCustomer = owner.client.ok(await owner.client.json('POST', '/api/tracker/customers', customer(owner, {
    name: 'Lifetime Buyer',
    subscription: { product_id: owner.product.id, plan_id: lifetime.plan.id, purchase_date: '2026-02-01',
      is_lifetime: true, status: 'ACTIVE' },
  })));
  assert.equal(lifetimeCustomer.subscriptions[0].expiry_date, null);
  const lifetimeList = await listOf(owner.client, `${owner.scope}&subscription=LIFETIME`);
  assert.deepEqual(lifetimeList.customers.map(row => row.name), ['Lifetime Buyer']);

  const missingExpiry = await owner.client.json('POST', '/api/tracker/customers', customer(owner, {
    name: 'No Expiry', subscription: { product_id: owner.product.id, plan_id: null, plan_label: 'Custom',
      purchase_date: '2026-02-01', is_lifetime: false },
  }));
  assert.equal(missingExpiry.status, 400, 'a dated plan must state an expiry');
});

test('subscription expiry drives filters and dashboard metrics', async () => {
  const owner = await withOwner(6);
  const shift = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const make = async (name, expiry) => owner.client.ok(await owner.client.json('POST', '/api/tracker/customers',
    customer(owner, { name, subscription: { product_id: owner.product.id, plan_id: owner.plan.id,
      purchase_date: '2026-01-01', start_date: '2026-01-01', expiry_date: expiry, is_lifetime: false,
      status: 'ACTIVE' } })));

  await make('Expiring In 5', shift(5));
  await make('Expiring In 20', shift(20));
  await make('Expired Already', shift(-10));
  const mobile = owner.client.ok(await owner.client.json('POST', '/api/products',
    baseProduct({ name: 'Nextora POS Mobile', sku: `NCPOS-MOB-${6}` })));
  owner.client.ok(await owner.client.json('POST', '/api/tracker/customers', customer(owner, {
    name: 'Mobile Only',
    subscription: { product_id: mobile.product.id, plan_id: owner.plan.id, purchase_date: '2026-03-01',
      expiry_date: shift(300), is_lifetime: false, status: 'ACTIVE' },
  })));

  assert.deepEqual((await listOf(owner.client, `${owner.scope}&subscription=EXPIRING_7`)).customers.map(row => row.name),
    ['Expiring In 5']);
  const listFive = await listOf(owner.client, `${owner.scope}&subscription=EXPIRING_7`);
  assert.match(listFive.customers[0].warnings.join(' '), /Expires on/);
  assert.deepEqual((await listOf(owner.client, `${owner.scope}&subscription=EXPIRED`)).customers.map(row => row.name),
    ['Expired Already']);
  assert.equal((await listOf(owner.client, `${owner.scope}&subscription=EXPIRING_15`)).total, 1);
  assert.equal((await listOf(owner.client, `${owner.scope}&subscription=EXPIRING_30`)).total, 2);
  assert.equal((await listOf(owner.client, `${owner.scope}&subscription=ACTIVE`)).total, 3,
    'three subscriptions are still running');
  assert.equal((await listOf(owner.client, `${owner.scope}&status=ALL`)).total, 4, '"ALL" includes every status');
  assert.equal((await listOf(owner.client, `${owner.scope}&product_id=${mobile.product.id}`)).total, 1);
  assert.equal((await listOf(owner.client, `${owner.scope}&purchase_from=2026-01-01&purchase_to=2026-01-31`)).total, 3);

  const metrics = owner.client.ok(await owner.client.json('GET', '/api/tracker/metrics'));
  const mine = metrics.by_employee.find(row => row.name === 'Employee 6');
  assert.equal(mine.customers, 4);
  assert.equal(mine.expired, 1);
  assert.ok(metrics.by_subscription.some(row => row.label === 'Yearly 6'));
  // The counters are monotonic windows and agree with the row-level counts.
  assert.ok(metrics.subscriptions.expiring_7 <= metrics.subscriptions.expiring_15);
  assert.ok(metrics.subscriptions.expiring_15 <= metrics.subscriptions.expiring_30);
  assert.equal(metrics.renewals_due, metrics.subscriptions.expired + metrics.subscriptions.expiring_30);
  const allActive = await listOf(owner.client, 'status=ACTIVE');
  assert.equal(metrics.totals.active_customers, allActive.total, 'the dashboard count matches the tracked rows');

  // An expiry that precedes the purchase is stored with a warning, not refused.
  const odd = owner.client.ok(await owner.client.json('POST', '/api/tracker/customers', customer(owner, {
    name: 'Odd Dates',
    subscription: { product_id: owner.product.id, plan_id: owner.plan.id, purchase_date: '2026-06-01',
      start_date: '2026-06-01', expiry_date: '2026-05-01', is_lifetime: false, status: 'ACTIVE' },
  })));
  assert.ok(odd.customer.id);
  const oddRow = await listOf(owner.client, `${owner.scope}&search=Odd+Dates`);
  assert.match(oddRow.customers[0].warnings.join(' '), /expiry date is before the purchase date/);
});

test('search covers customer, business, address, employee, product and custom fields', async () => {
  const owner = await withOwner(7);
  const created = owner.client.ok(await owner.client.json('POST', '/api/tracker/customers', customer(owner, {
    name: 'Kiran Babu', business_name: 'Green Leaf Cafe', address: '45 Banjara Hills',
  })));
  const field = owner.client.ok(await owner.client.json('POST', '/api/tracker/fields', { label: 'Device ID', field_type: 'TEXT' }));
  owner.client.ok(await owner.client.json('PUT', `/api/tracker/customers/${created.customer.id}/fields`,
    { values: [{ definition_id: field.field.id, value: 'DEV-778812' }] }));

  for (const [term, expected] of [['Kiran', 1], ['Green Leaf', 1], ['Banjara', 1], ['Employee 7', 1],
    ['Nextora POS Desktop', 1], ['DEV-778812', 1], ['Nothing Here', 0]]) {
    const found = await listOf(owner.client, `${owner.scope}&search=${encodeURIComponent(term)}`);
    assert.equal(found.total, expected, `search "${term}"`);
  }
  assert.equal((await listOf(owner.client, `${owner.scope}&expiry_from=2027-01-01&expiry_to=2027-12-31`)).total, 1);
});

test('the tracker is for operating roles, and a read-only role cannot reach it directly', async () => {
  const owner = await withOwner(8);
  const created = owner.client.ok(await owner.client.json('POST', '/api/tracker/customers', customer(owner)));

  const { hashPassword } = await import('../server/auth.js');
  const accountant = makeClient({ ip: '10.3.0.200' });
  await owner.client.db.query(`INSERT INTO inv.users(id,email,password_hash,role,display_name)
    VALUES($1,$2,$3,'ACCOUNTANT','Read Only')`,
  ['11111111-2222-4333-8444-555555555555', 'accountant@example.test', await hashPassword('accountant-password-1')]);
  await accountant.login({ email: 'accountant@example.test', password: 'accountant-password-1' });

  // Direct tracker reads are refused: shared data is the only route in.
  for (const path of ['/api/tracker/customers', '/api/tracker/reference', '/api/tracker/metrics',
    '/api/tracker/export?format=csv', `/api/tracker/customers/${created.customer.id}`]) {
    const attempt = await accountant.json('GET', path);
    assert.equal(attempt.status, 403, `GET ${path} must be refused`);
    assert.equal(attempt.data.code, 'FORBIDDEN');
  }
  for (const [method, path, payload] of [
    ['POST', '/api/tracker/customers', customer(owner, { name: 'Nope' })],
    ['PATCH', `/api/tracker/customers/${created.customer.id}`, customer(owner)],
    ['POST', `/api/tracker/customers/${created.customer.id}/status`, { status: 'ARCHIVED' }],
    ['POST', '/api/tracker/fields', { label: 'Sneaky', field_type: 'TEXT' }],
    ['PUT', '/api/tracker/columns', { columns: [{ key: 'name' }] }],
    ['POST', '/api/tracker/plans', { label: 'Free Forever' }],
    ['POST', '/api/tracker/employees', { name: 'Ghost' }],
    ['PUT', `/api/tracker/customers/${created.customer.id}/fields`, { values: [] }],
    ['POST', '/api/tracker/import/preview', { filename: 'x.csv', content_base64: 'a' }],
  ]) {
    const attempt = await accountant.json(method, path, payload);
    assert.equal(attempt.status, 403, `${method} ${path} must be refused`);
    assert.equal(attempt.data.code, 'FORBIDDEN');
  }
  const anonymous = makeClient({ ip: '10.3.0.201' });
  assert.equal((await anonymous.json('GET', '/api/tracker/customers')).status, 401);
});

test('CSV and Excel exports carry labels, real dates and no internal identifiers', async () => {
  const owner = await withOwner(9);
  owner.client.ok(await owner.client.json('POST', '/api/tracker/customers', customer(owner, {
    // A name Excel would otherwise treat as a formula.
    name: '=cmd|calc!A1', business_name: 'Spice Route', remarks: '@SUM(1+1)',
  })));
  owner.client.ok(await owner.client.json('POST', '/api/tracker/customers', customer(owner, { name: 'Normal Buyer' })));

  const defaultColumns = 'serial,name,business_name,address,employee_name,purchase_date,product_name,plan_label,expiry_date,remarks';
  const csv = await owner.client.raw('GET', `/api/tracker/export?format=csv&columns=${defaultColumns}`);
  assert.equal(csv.status, 200);
  const text = await csv.text();
  const header = text.replace(/^\uFEFF/, '').split('\r\n')[0];
  assert.equal(header, 'S.No.,Customer Name,Customer Business Name,Address,Employee Assigned,Date of Purchase,Product,Subscription,Date of Expiry,Remarks');
  assert.match(text, /'=cmd\|calc!A1/, 'a formula-looking name is neutralised');
  assert.match(text, /'@SUM\(1\+1\)/);
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}/.test(text), false, 'no internal ids are exported');

  const wholeCsv = await owner.client.raw('GET', '/api/tracker/export?format=csv');
  const wholeHeader = (await wholeCsv.text()).replace(/^\uFEFF/, '').split('\r\n')[0];
  for (const label of ['S.No.', 'Customer Name', 'Customer Business Name', 'Address', 'Employee Assigned',
    'Date of Purchase', 'Product', 'Subscription', 'Date of Expiry', 'Remarks']) {
    assert.ok(wholeHeader.includes(label), `the full export carries the ${label} column`);
  }

  const xlsx = await owner.client.binary('GET', `/api/tracker/export?format=xlsx&columns=${defaultColumns}`);
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers.get('content-type'), /spreadsheetml/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.bytes);
  const sheet = workbook.getWorksheet('Customers');
  assert.equal(sheet.getRow(1).getCell(2).value, 'Customer Name');
  assert.ok(sheet.getColumn(6).values.some(value => value instanceof Date), 'dates are written as dates');
  const meta = workbook.getWorksheet('Columns');
  assert.equal(meta.getRow(1).getCell(1).value, 'Column');
  assert.equal(meta.getRow(1).getCell(2).value, 'Label', 'custom field definitions travel in the metadata sheet');
  assert.ok(meta.rowCount >= 10, 'every column is described on the metadata sheet');

  // Selected rows and selected columns are honoured.
  const mine = await listOf(owner.client, `${owner.scope}&search=cmd`);
  const filtered = await owner.client.raw('GET',
    `/api/tracker/export?format=csv&ids=${mine.customers[0].id}&columns=name,business_name`);
  const filteredText = await filtered.text();
  assert.equal(filteredText.replace(/^\uFEFF/, '').split('\r\n')[0], 'Customer Name,Customer Business Name');
  assert.equal(filteredText.includes('Normal Buyer'), false);

  const template = await owner.client.binary('GET', '/api/tracker/export?format=template');
  const templateBook = new ExcelJS.Workbook();
  await templateBook.xlsx.load(template.bytes);
  assert.ok(templateBook.getWorksheet('How to import'));
  const templateHeader = templateBook.getWorksheet('Customers').getRow(1).values.filter(Boolean).map(String);
  for (const label of ['S.No.', 'Customer Name', 'Date of Expiry']) {
    assert.ok(templateHeader.includes(label), `the template offers the ${label} column`);
  }
});

test('an import previews, maps, validates, reports duplicates and applies clean rows', async () => {
  const owner = await withOwner(10);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Customers');
  sheet.addRow(['Customer Name', 'Customer Business Name', 'Address', 'Employee Assigned', 'Date of Purchase',
    'Product', 'Subscription', 'Date of Expiry', 'Remarks']);
  sheet.addRow(['Lakshmi Stores', 'Lakshmi Stores', 'Sultan Bazar', 'Employee 10', new Date(Date.UTC(2026, 4, 2)),
    'Nextora POS Desktop', 'Yearly 10', new Date(Date.UTC(2027, 4, 1)), 'Imported']);
  sheet.addRow(['Lakshmi Stores', 'Duplicate Row', 'Same name', 'Employee 10', '2026-05-02',
    'Nextora POS Desktop', 'Yearly 10', '2027-05-01', '']);
  sheet.addRow(['', 'Missing Name', '', '', '2026-05-02', 'Nextora POS Desktop', 'Yearly 10', '2027-05-01', '']);
  sheet.addRow(['Unknown Product Buyer', 'Test', '', 'Employee 10', '2026-05-02', 'Not A Product', 'Yearly 10', '2027-05-01', '']);
  const upload = Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');

  const preview = owner.client.ok(await owner.client.json('POST', '/api/tracker/import/preview', {
    filename: 'customers.xlsx', content_base64: upload,
  }), 'preview');
  assert.equal(preview.row_count, 4);
  assert.equal(preview.mapping['Customer Name'], 'name');
  assert.equal(preview.mapping['Date of Purchase'], 'purchase_date');
  assert.equal(preview.sample.length, 4);
  assert.deepEqual(preview.unmatched, []);

  const body = owner.client.ok(await owner.client.json('POST', '/api/tracker/import', {
    filename: 'customers.xlsx', content_base64: upload, mapping: preview.mapping,
  }), 'import');
  assert.equal(body.summary.read, 4);
  assert.equal(body.summary.created, 1, 'one valid row is imported');
  assert.equal(body.summary.failed, 2, 'the missing name and the unknown product are refused');
  assert.equal(body.summary.skipped, 1, 'the duplicate is skipped');
  assert.match(body.errors.map(entry => entry.error).join(' '), /Customer Name is required/);
  assert.match(body.errors.map(entry => entry.error).join(' '), /Unknown product/);
  assert.match(body.duplicates.map(entry => entry.error).join(' '), /Duplicate of row 2/);
  assert.match(body.errors_csv, /^row,error/);

  const imported = await listOf(owner.client, `${owner.scope}&search=Lakshmi`);
  assert.equal(imported.total, 1);
  assert.equal(imported.customers[0].business_name, 'Lakshmi Stores');
  assert.equal(imported.customers[0].purchase_date, '2026-05-02', 'an Excel date survives the round trip');
  assert.equal(imported.customers[0].plan_label, 'Yearly 10');
  assert.equal(imported.customers[0].expiry_date, '2027-05-01');

  // A CSV file imports through the same path.
  const csvUpload = Buffer.from('Customer Name,Customer Business Name,Date of Purchase,Product,Subscription,Date of Expiry\n'
    + 'Bhavani Traders,Bhavani Traders,2026-06-01,Nextora POS Desktop,Yearly 10,2027-05-31\n').toString('base64');
  const csvResult = owner.client.ok(await owner.client.json('POST', '/api/tracker/import', {
    filename: 'customers.csv', content_base64: csvUpload,
  }), 'csv import');
  assert.equal(csvResult.summary.created, 1);
  assert.equal((await owner.client.db.query(
    "SELECT count(*)::int AS n FROM inv.pos_customers WHERE name='Bhavani Traders'")).rows[0].n, 1);
});

test('the tracker leaves invoices, quotations and clients untouched', async () => {
  const owner = await withOwner(11);
  owner.client.ok(await owner.client.json('POST', '/api/tracker/customers', customer(owner)));

  const billing = owner.client.ok(await owner.client.json('POST', '/api/clients', {
    kind: 'BUSINESS', name: 'Acme Tracker Client', company_name: 'Acme Systems Pvt Ltd', billing_address: 'Plot 12',
    state_code: '36', gstin: '36AABCU9603R1ZO', country: 'India', payment_terms_days: 15, gst_registered: true,
  })).client;
  const quotation = owner.client.ok(await owner.client.json('POST', '/api/quotations', {
    client_id: billing.id, title: 'POS rollout', issue_date: '2026-10-01', place_of_supply_state_code: '36',
    items: [{ description: 'Nextora POS Desktop licence', unit: 'LIC', quantity_milli: 1000,
      unit_price_minor: 2500000, tax_rate_bp: 1800, tax_treatment: 'TAXABLE' }],
  }));
  assert.equal(quotation.quotation.totals.grand_total_minor, 2950000);
  const invoiceDashboard = owner.client.ok(await owner.client.json('GET', '/api/dashboard'));
  assert.ok(invoiceDashboard.invoiced && invoiceDashboard.quotations, 'the invoice dashboard still answers');
  assert.ok(owner.client.ok(await owner.client.json('GET', '/api/reports/tax-summary')).net);
  assert.equal((await owner.client.binary('GET', `/api/quotations/${quotation.quotation.id}/pdf`)).status, 200);
  const found = owner.client.ok(await owner.client.json('GET', '/api/clients?search=Acme Tracker Client'));
  assert.equal(found.total, 1);
});
