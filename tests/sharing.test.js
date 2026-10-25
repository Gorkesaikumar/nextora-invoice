import test from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, configureIssuer, baseProduct } from './helpers.js';
import { hashPassword } from '../server/auth.js';

const ip = suffix => `10.4.0.${suffix}`;
const RECIPIENT = { email: 'reader@example.test', password: 'reader-password-01' };

/** One owner workspace with an employee, a plan, a product and three customers. */
async function workspace(suffix) {
  const owner = makeClient({ ip: ip(suffix) });
  await owner.login();
  await configureIssuer(owner);
  const employee = owner.ok(await owner.json('POST', '/api/tracker/employees', { name: `Employee ${suffix}` })).employee;
  const plan = owner.ok(await owner.json('POST', '/api/tracker/plans', { label: `Yearly ${suffix}`, duration_months: 12 })).plan;
  const product = owner.ok(await owner.json('POST', '/api/products',
    baseProduct({ name: 'Nextora POS Desktop', sku: `NCPOS-SHARE-${suffix}` }))).product;
  const customer = (name, overrides = {}) => ({
    name, business_name: `${name} Traders`, address: '5 Market Road', employee_id: employee.id,
    remarks: `Private remark for ${name}`,
    subscription: { product_id: product.id, plan_id: plan.id, purchase_date: '2026-02-01',
      expiry_date: '2027-01-31', status: 'ACTIVE' },
    ...overrides,
  });
  const created = [];
  for (const name of ['Alpha Stores', 'Beta Stores', 'Gamma Stores']) {
    created.push(owner.ok(await owner.json('POST', '/api/tracker/customers', customer(name))).customer);
  }
  // A read-only account that will receive shares.
  await owner.db.query(`INSERT INTO inv.users(id,email,password_hash,role,display_name)
    VALUES($1,$2,$3,'ACCOUNTANT','Shared Reader') ON CONFLICT (email) DO NOTHING`,
  [`aaaaaaaa-0000-4000-8000-${String(suffix).padStart(12, '0')}`, RECIPIENT.email,
    await hashPassword(RECIPIENT.password)]);
  const reader = makeClient({ ip: `10.4.1.${suffix}` });
  await reader.login(RECIPIENT);
  return { owner, reader, employee, plan, product, customers: created, customer };
}

const sharePayload = (overrides = {}) => ({
  title: 'POS customer list', scope_all: false, customer_ids: [], columns: ['name', 'business_name'],
  allow_search: true, allow_filter: true, allow_download: false, expires_at: null, ...overrides,
});

test('a private share grants read-only access to exactly the chosen rows and columns', async () => {
  const { owner, reader, customers, customer } = await workspace(21);

  const created = owner.ok(await owner.json('POST', '/api/shares?type=private', sharePayload({
    customer_ids: [customers[0].id, customers[1].id], recipients: [RECIPIENT.email],
    columns: ['serial', 'name', 'business_name', 'employee_name'],
  })), 'private share');
  assert.equal(created.share.share_type, 'PRIVATE');
  assert.deepEqual(created.share.recipients, [RECIPIENT.email]);
  assert.equal(created.share.customer_count, 2);
  // A private share is not a link: nothing to forward.
  assert.equal(created.token, undefined);

  const shared = owner.ok(await reader.json('GET', `/api/shares/${created.share.id}/rows`), 'recipient read');
  assert.equal(shared.total, 2, 'only the shared records');
  assert.deepEqual(shared.rows.map(row => row.col_2).sort(), ['Alpha Stores', 'Beta Stores']);
  assert.deepEqual(shared.columns.map(column => column.key), ['col_1', 'col_2', 'col_3', 'col_4']);
  assert.equal(shared.permissions.download, false);
  assert.equal(JSON.stringify(shared).includes('Gamma Stores'), false, 'the third customer never leaves the server');
  assert.equal(JSON.stringify(shared).includes('Private remark'), false, 'an unshared column is not in the payload');

  // Search works inside the shared scope only.
  const searched = owner.ok(await reader.json('GET', `/api/shares/${created.share.id}/rows?search=Alpha`));
  assert.equal(searched.total, 1);
  const outside = owner.ok(await reader.json('GET', `/api/shares/${created.share.id}/rows?search=Gamma`));
  assert.equal(outside.total, 0);

  // The recipient cannot write anything anywhere, and cannot widen the share.
  for (const [method, path, payload] of [
    ['PATCH', `/api/tracker/customers/${customers[0].id}`, customer('Hacked')],
    ['POST', `/api/tracker/customers`, customer('Injected')],
    ['POST', `/api/tracker/fields`, { label: 'Sneaky', field_type: 'TEXT' }],
    ['PUT', `/api/tracker/customers/${customers[0].id}/fields`, { values: [] }],
    ['PUT', '/api/tracker/columns', { columns: [{ key: 'name' }] }],
    ['PATCH', `/api/shares/${created.share.id}`, { title: 'Mine now', columns: ['name', 'remarks'] }],
    ['POST', `/api/shares/${created.share.id}/revoke`, { reason: 'mine' }],
  ]) {
    const attempt = await reader.json(method, path, payload);
    assert.equal(attempt.status, 403, `${method} ${path} must be refused`);
  }
  // Downloads stay off until the owner turns them on.
  assert.equal((await reader.json('GET', `/api/shares/${created.share.id}/export?format=csv`)).status, 403);

  // The owner can grant exports, and only the shared rows are written out.
  owner.ok(await owner.json('PATCH', `/api/shares/${created.share.id}`, { can_download: true }));
  const download = await reader.raw('GET', `/api/shares/${created.share.id}/export?format=csv`);
  assert.equal(download.status, 200);
  const csv = await download.text();
  assert.match(csv, /Alpha Stores/);
  assert.equal(csv.includes('Gamma Stores'), false);
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}/.test(csv), false, 'no internal ids in a shared download');

  // A share granted to someone else is invisible to this account.
  const other = makeClient({ ip: ip(99) });
  await owner.db.query(`INSERT INTO inv.users(id,email,password_hash,role,display_name)
    VALUES('bbbbbbbb-0000-4000-8000-000000000099','stranger@example.test',$1,'FINANCE','Stranger')
    ON CONFLICT (email) DO NOTHING`, [await hashPassword('stranger-password-01')]);
  await other.login({ email: 'stranger@example.test', password: 'stranger-password-01' });
  const stranger = await other.json('GET', `/api/shares/${created.share.id}/rows`);
  assert.equal(stranger.status, 403, 'a share is granted to named accounts only');
  assert.equal((await other.json('GET', `/api/shares/${created.share.id}`)).status, 403);
  const anonymous = makeClient({ ip: ip(98) });
  assert.equal((await anonymous.json('GET', `/api/shares/${created.share.id}/rows`)).status, 401);
});

test('private shares refuse unknown recipients, record who shared what, and revoke immediately', async () => {
  const { owner, reader, customers } = await workspace(22);
  const unknown = await owner.json('POST', '/api/shares?type=private', sharePayload({
    customer_ids: [customers[0].id], recipients: ['nobody@example.test'],
  }));
  assert.equal(unknown.status, 422);
  assert.equal(unknown.data.code, 'UNKNOWN_RECIPIENT');
  assert.match(unknown.data.error, /No application account exists/);

  const created = owner.ok(await owner.json('POST', '/api/shares?type=private', sharePayload({
    customer_ids: [customers[0].id], recipients: [RECIPIENT.email], allow_download: true,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  })), 'share');
  assert.equal(created.share.password_protected, false);

  const listed = owner.ok(await owner.json('GET', '/api/shares'));
  const row = listed.shares.find(share => share.id === created.share.id);
  assert.deepEqual(row.recipients, [RECIPIENT.email]);
  assert.equal(row.customer_count, 1);
  assert.ok(listed.counts.private >= 1);

  const detail = owner.ok(await owner.json('GET', `/api/shares/${created.share.id}`));
  assert.equal(detail.customers.length, 1);
  assert.equal(detail.recipients.length, 1);
  assert.equal(owner.ok(await reader.json('GET', `/api/shares/${created.share.id}/rows`)).total, 1);

  // The audit trail names the actor, the recipients and the scope.
  const events = (await owner.db.query(`SELECT event, metadata FROM inv.audit_logs
    WHERE entity_type='SHARE' AND entity_id=$1`, [created.share.id])).rows;
  assert.equal(events[0].event, 'TRACKER_SHARED_PRIVATE');
  assert.deepEqual(events[0].metadata.recipients, [RECIPIENT.email]);

  const revoked = owner.ok(await owner.json('POST', `/api/shares/${created.share.id}/revoke`,
    { reason: 'Project ended' }), 'revoke');
  assert.ok(revoked.share.revoked_at);
  const after = await reader.json('GET', `/api/shares/${created.share.id}/rows`);
  assert.equal(after.status, 410, 'revocation takes effect on the next request');
  assert.equal(after.data.code, 'SHARE_REVOKED');

  // An expired share stops working too.
  const expiring = owner.ok(await owner.json('POST', '/api/shares?type=private', sharePayload({
    customer_ids: [customers[0].id], recipients: [RECIPIENT.email],
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  })));
  await owner.db.query('UPDATE inv.pos_shares SET expires_at=now()-interval \'1 hour\' WHERE id=$1', [expiring.share.id]);
  const expired = await reader.json('GET', `/api/shares/${expiring.share.id}/rows`);
  assert.equal(expired.status, 410);
  assert.equal(expired.data.code, 'SHARE_EXPIRED');
});

test('a public link exposes only the selected columns and records, with no identifiers', async () => {
  const { owner, customers } = await workspace(23);
  const protectedColumns = ['remarks', 'employee_name'];

  const created = owner.ok(await owner.json('POST', '/api/shares?type=public', sharePayload({
    customer_ids: [customers[2].id], recipients: undefined,
    columns: ['serial', 'name', 'business_name', 'product_name', 'purchase_date', 'expiry_date'],
    confirm_public: true, allow_download: true,
  })), 'public share');
  assert.ok(created.token, 'the token is returned exactly once');
  assert.ok(created.share.share_type === 'PUBLIC');
  assert.match(created.warnings.join(' '), /Anyone with this link/);
  // Only a hash of the token is stored.
  const stored = (await owner.db.query('SELECT token_hash, password_hash FROM inv.pos_shares WHERE id=$1',
    [created.share.id])).rows[0];
  assert.notEqual(stored.token_hash, created.token);
  assert.equal(stored.token_hash.length, 64);
  assert.equal(stored.password_hash, null);

  // Anyone with the link can read the shared view without signing in.
  const visitor = makeClient({ ip: ip(24) });
  const meta = visitor.ok(await visitor.json('GET', `/api/public/${created.token}`));
  assert.equal(meta.columns.length, 6);
  assert.equal(meta.password_required, false);
  const data = visitor.ok(await visitor.json('POST', `/api/public/${created.token}/rows`, {}));
  assert.equal(data.total, 1);
  const serialised = JSON.stringify(data.rows);
  assert.match(serialised, /Gamma Stores/);
  for (const hidden of ['Alpha Stores', 'Beta Stores', ...protectedColumns, 'Private remark']) {
    assert.equal(serialised.includes(hidden), false, `${hidden} must not appear in a public payload`);
  }
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}/.test(serialised), false, 'no internal identifiers are published');
  assert.deepEqual(Object.keys(data.rows[0]).sort(), ['col_1', 'col_2', 'col_3', 'col_4', 'col_5', 'col_6']);

  const download = await visitor.raw('POST', `/api/public/${created.token}/export?format=csv`, {});
  assert.equal(download.status, 200);
  const csv = await download.text();
  assert.match(csv, /Gamma Stores/);
  assert.equal(csv.includes('Alpha Stores'), false);

  // Warnings are surfaced when a public link would include sensitive columns.
  const risky = owner.ok(await owner.json('POST', '/api/shares?type=public', sharePayload({
    customer_ids: [customers[0].id], columns: ['name', 'remarks'], confirm_public: true,
  })));
  assert.match(risky.warnings.join(' '), /remarks/);

  // Revoking a link stops it instantly, and an unknown token reveals nothing.
  owner.ok(await owner.json('POST', `/api/shares/${created.share.id}/revoke`, { reason: 'Finished' }));
  const revoked = await visitor.json('POST', `/api/public/${created.token}/rows`, {});
  assert.equal(revoked.status, 410);
  assert.equal(revoked.data.code, 'SHARE_REVOKED');
  assert.equal((await visitor.json('GET', '/api/public/not-a-real-token-at-all-1234')).status, 404);
  // The access log records views and refusals.
  const access = (await owner.db.query(`SELECT outcome FROM inv.pos_share_access WHERE share_id=$1 ORDER BY created_at`,
    [created.share.id])).rows.map(row => row.outcome);
  assert.ok(access.includes('VIEWED'));
  assert.ok(access.includes('DENIED'));
});

test('a public link is created only by the owner, needs an explicit confirmation, and can be password protected', async () => {
  const { owner, reader, customers } = await workspace(25);

  // Creating a public link without the explicit confirmation fails.
  const unconfirmed = await owner.json('POST', '/api/shares?type=public', sharePayload({
    customer_ids: [customers[0].id], columns: ['name'],
  }));
  assert.equal(unconfirmed.status, 400);
  assert.equal(unconfirmed.data.code, 'VALIDATION_ERROR');

  // The share endpoints are for owners and administrators.
  for (const [method, path, payload] of [['POST', '/api/shares?type=public', sharePayload({ scope_all: true,
    columns: ['name'], confirm_public: true })], ['GET', '/api/shares']]) {
    const attempt = await reader.json(method, path, payload);
    assert.ok([403, 404].includes(attempt.status), `${method} ${path} must not reach sharing`);
  }

  const created = owner.ok(await owner.json('POST', '/api/shares?type=public', sharePayload({
    scope_all: true, columns: ['name', 'business_name'], confirm_public: true, password: 'open-sesame-1',
    allow_search: false, allow_filter: false, allow_download: false,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  })), 'public share');
  assert.equal(created.share.password_protected, true);
  assert.match(created.warnings.join(' '), /public/i);

  const visitor = makeClient({ ip: ip(26) });
  assert.equal(visitor.ok(await visitor.json('GET', `/api/public/${created.token}`)).password_required, true);
  const refused = await visitor.json('POST', `/api/public/${created.token}/rows`, { password: 'wrong-password' });
  assert.equal(refused.status, 401);
  assert.equal(refused.data.code, 'PASSWORD_REQUIRED');
  const withPassword = visitor.ok(await visitor.json('POST', `/api/public/${created.token}/rows`,
    { password: 'open-sesame-1' }));
  // "Every customer" spans the whole tracker, which is why the owner had to
  // confirm the public link explicitly.
  assert.ok(withPassword.total >= 3, `a scope of every customer includes the tracked rows (got ${withPassword.total})`);
  assert.equal(withPassword.permissions.search, false);
  assert.equal(withPassword.permissions.download, false);
  // Search and download stay unavailable when the owner disabled them.
  const searched = visitor.ok(await visitor.json('POST',
    `/api/public/${created.token}/rows?search=Alpha`, { password: 'open-sesame-1' }));
  assert.equal(searched.total, withPassword.total, 'a disabled search filter is ignored, not honoured');
  const blocked = await visitor.raw('POST', `/api/public/${created.token}/export?format=csv`,
    { password: 'open-sesame-1' });
  assert.equal(blocked.status, 403);

  // A revoked link cannot be used even with the right password.
  owner.ok(await owner.json('PATCH', `/api/shares/${created.share.id}`, { revoked: true }));
  const after = await visitor.json('POST', `/api/public/${created.token}/rows`, { password: 'open-sesame-1' });
  assert.equal(after.status, 410);
});

test('shared views never contain fields the share did not list', async () => {
  const { owner, reader, customers } = await workspace(27);
  const created = owner.ok(await owner.json('POST', '/api/shares?type=private', sharePayload({
    customer_ids: [customers[0].id], recipients: [RECIPIENT.email], columns: ['name'],
  })));
  const data = owner.ok(await reader.json('GET', `/api/shares/${created.share.id}/rows`));
  assert.deepEqual(data.columns.map(column => column.label), ['Customer Name']);
  assert.equal(Object.keys(data.rows[0]).length, 1);
  const serialised = JSON.stringify(data);
  for (const leak of ['business_name', 'Alpha Stores Traders', 'Market Road', 'Private remark', '2026-02-01']) {
    assert.equal(serialised.includes(leak), false, `${leak} must not be sent`);
  }
  // Requesting extra columns does not widen the response.
  const wider = owner.ok(await reader.json('GET', `/api/shares/${created.share.id}/rows?columns=name,remarks`));
  assert.equal(Object.keys(wider.rows[0]).length, 1);
});
