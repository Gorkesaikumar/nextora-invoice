import test from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, OWNER, configureIssuer } from './helpers.js';

test('business data is unreachable without a session', async () => {
  const client = makeClient({ ip: '10.0.0.1' });
  for (const path of ['/api/clients', '/api/invoices', '/api/quotations', '/api/dashboard', '/api/settings',
    '/api/reports/receivables', '/api/audit', '/api/payments', '/api/products']) {
    const result = await client.json('GET', path);
    assert.equal(result.status, 401, `${path} must require a session`);
  }
  // A randomly guessed document id is not readable either.
  const document = await client.json('GET', '/api/invoices/00000000-0000-0000-0000-000000000000');
  assert.equal(document.status, 401);
});

test('login rejects wrong credentials and unknown accounts identically', async () => {
  const client = makeClient({ ip: '10.0.0.2' });
  const wrong = await client.json('POST', '/api/auth/login', { email: OWNER.email, password: 'not-the-password' });
  assert.equal(wrong.status, 401);
  const unknown = await client.json('POST', '/api/auth/login', { email: 'nobody@example.test', password: 'whatever-1234' });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.data.error, unknown.data.error);
});

test('login is rate limited after repeated failures', async () => {
  // Uses a probe address so the shared owner account keeps its own budget.
  const client = makeClient({ ip: '10.0.0.3' });
  const probe = 'rate-limit-probe@example.test';
  let limited = false;
  for (let attempt = 0; attempt < 12 && !limited; attempt += 1) {
    const result = await client.json('POST', '/api/auth/login', { email: probe, password: `bad-password-${attempt}` });
    if (result.status === 429) limited = true;
  }
  assert.equal(limited, true, 'repeated failed logins must be throttled');
});

test('mutations from a foreign origin are refused', async () => {
  const client = makeClient({ ip: '10.0.0.4' });
  await client.login();
  const foreign = await client.json('POST', '/api/clients', { name: 'x' }, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  const crossSite = await client.json('POST', '/api/clients', { name: 'x' }, { secFetchSite: 'cross-site' });
  assert.equal(crossSite.status, 403);
});

test('a mutation without the session CSRF token is refused', async () => {
  const client = makeClient({ ip: '10.0.0.5' });
  await client.login();
  const result = await client.json('POST', '/api/clients', { name: 'x' }, { csrf: 'forged-token' });
  assert.equal(result.status, 403);
  assert.equal(result.data.code, 'CSRF_FAILED');
});

test('a stolen session cookie from another client is still bound to a csrf token', async () => {
  const owner = makeClient({ ip: '10.0.0.6' });
  await owner.login();
  const attacker = makeClient({ ip: '10.0.0.7' });
  attacker.setCookie(owner.cookie);
  attacker.setCsrf('guessed-token-value');
  const result = await attacker.json('POST', '/api/products', { name: 'x' });
  assert.equal(result.status, 403);
  // And no session means no data at all.
  const anonymous = makeClient({ ip: '10.0.0.8' });
  assert.equal((await anonymous.json('GET', '/api/products')).status, 401);
});

test('unreadable, unparsable and invalid payloads are rejected with field details', async () => {
  const client = makeClient({ ip: '10.0.0.9' });
  await client.login();
  await configureIssuer(client);

  const wrongType = await client.json('POST', '/api/clients', { name: 'x' }, { contentType: 'text/plain' });
  assert.equal(wrongType.status, 415);

  const invalid = await client.json('POST', '/api/clients', {
    kind: 'BUSINESS', name: '', state_code: '99', gstin: 'NOTAGSTIN', extra_field: true,
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.code, 'VALIDATION_ERROR');
  const fields = invalid.data.fields.map(field => field.field);
  assert.ok(fields.includes('name'));
  assert.ok(fields.includes('state_code'));
  assert.ok(fields.includes('gstin'));

  // Unknown keys are rejected rather than silently ignored.
  const unexpected = await client.json('POST', '/api/products', { name: 'ok', unexpected: 1 });
  assert.equal(unexpected.status, 400);
});

test('unknown endpoints and malformed identifiers return clean errors', async () => {
  const client = makeClient({ ip: '10.0.0.10' });
  await client.login();
  assert.equal((await client.json('GET', '/api/does-not-exist')).status, 404);
  assert.equal((await client.json('GET', '/api/invoices/not-a-uuid')).status, 400);
  assert.equal((await client.json('GET', '/api/whatever')).status, 404);
});

test('the issuer must be configured before tax can be determined', async () => {
  const client = makeClient({ ip: '10.0.0.11' });
  await client.login();
  // Clear the state code so place of supply cannot be resolved.
  await configureIssuer(client, { state_code: '', gstin: '' });
  const clientRecord = await client.json('POST', '/api/clients', {
    kind: 'BUSINESS', name: 'Unconfigured Co', state_code: '27', gstin: '',
    company_name: '', contact_person: '', email: '', phone: '', billing_address: '', service_address: '',
    country: 'India', notes: '', payment_terms_days: 15, gst_registered: false,
  });
  const created = client.ok(clientRecord);
  const quotation = await client.json('POST', '/api/quotations', {
    client_id: created.client.id, title: 'Test', description: '', scope_of_work: '', inclusions: '', exclusions: '',
    assumptions: '', warranty_terms: '', delivery_timeline: '', notes: '', terms: '',
    issue_date: '2026-10-01', expiry_date: null, due_date: null, place_of_supply_state_code: '27',
    payment_terms_days: 15, payment_terms: '', po_reference: '', project_reference: '',
    invoice_discount_bp: 0, invoice_discount_minor: 0, round_off_enabled: true,
    items: [{ description: 'Build', unit: 'NOS', quantity_milli: 1000, unit_price_minor: 100000,
      discount_bp: 0, discount_minor: 0, tax_rate_bp: 1800, tax_treatment: 'TAXABLE', product_id: null,
      category: '', hsn_sac: '' }],
    additional_charges: [], milestones: [],
  });
  assert.equal(quotation.status, 409);
  assert.equal(quotation.data.code, 'SUPPLIER_STATE_REQUIRED');
  await configureIssuer(client);
});

test('a missing place of supply is refused instead of assuming intra-state', async () => {
  const client = makeClient({ ip: '10.0.0.12' });
  await client.login();
  await configureIssuer(client);
  const created = client.ok(await client.json('POST', '/api/clients', {
    kind: 'BUSINESS', name: 'No State Co', state_code: '', gstin: '', company_name: '', contact_person: '',
    email: '', phone: '', billing_address: '', service_address: '', country: 'India', notes: '',
    payment_terms_days: 15, gst_registered: false,
  }));
  const quotation = await client.json('POST', '/api/quotations', {
    client_id: created.client.id, title: 'Test', description: '', scope_of_work: '', inclusions: '', exclusions: '',
    assumptions: '', warranty_terms: '', delivery_timeline: '', notes: '', terms: '',
    issue_date: '2026-10-01', expiry_date: null, due_date: null, place_of_supply_state_code: '',
    payment_terms_days: 15, payment_terms: '', po_reference: '', project_reference: '',
    invoice_discount_bp: 0, invoice_discount_minor: 0, round_off_enabled: true,
    items: [{ description: 'Build', unit: 'NOS', quantity_milli: 1000, unit_price_minor: 100000,
      discount_bp: 0, discount_minor: 0, tax_rate_bp: 1800, tax_treatment: 'TAXABLE', product_id: null,
      category: '', hsn_sac: '' }],
    additional_charges: [], milestones: [],
  });
  assert.equal(quotation.status, 400);
  assert.equal(quotation.data.code, 'PLACE_OF_SUPPLY_REQUIRED');
});
