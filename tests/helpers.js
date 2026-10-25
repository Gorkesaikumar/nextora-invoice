import { getDatabase } from '../server/db.js';
import { configuration, createAPI } from '../server/api.js';

import { createHmac } from 'node:crypto';

export const OWNER = { email: 'owner@example.test', password: 'test-owner-password' };

/** Mirrors server/auth.js rateLimit key hashing so tests can target one counter. */
const accountKey = (email, secret) => createHmac('sha256', secret).update(`account:${email}`).digest('hex');

/**
 * Exercises the production request handler directly with real Request objects,
 * real SQL and real PDFs. Nothing is mocked, so a passing test is evidence the
 * deployed code path works.
 */
export function makeClient({ ip = '127.0.0.1' } = {}) {
  const db = getDatabase();
  const config = configuration();
  const api = createAPI(db, config);
  let cookie = '';
  let csrfToken = '';

  async function call(method, path, payload, options = {}) {
    const headers = {
      origin: options.origin ?? config.appOrigin,
      'sec-fetch-site': options.secFetchSite ?? 'same-origin',
    };
    if (payload !== undefined) headers['content-type'] = options.contentType ?? 'application/json';
    if (cookie) headers.cookie = options.cookie ?? cookie;
    if (csrfToken && !['GET', 'HEAD'].includes(method)) headers['x-csrf-token'] = options.csrf ?? csrfToken;
    const response = await api(new Request(new URL(path, config.appOrigin), {
      method, headers, body: payload === undefined ? undefined : JSON.stringify(payload),
    }), { ip: options.ip ?? ip });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = options.keepCookie ? cookie : setCookie.split(';')[0];
    return response;
  }

  const client = {
    db,
    config,
    get csrf() { return csrfToken; },
    get cookie() { return cookie; },
    setCookie(value) { cookie = value; },
    setCsrf(value) { csrfToken = value; },
    raw: call,
    async json(method, path, payload, options) {
      const response = await call(method, path, payload, options);
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { status: response.status, data, headers: response.headers };
    },
    async binary(method, path, options) {
      const response = await call(method, path, undefined, options);
      return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
    },
    async login(credentials = OWNER) {
      // Login throttling has its own dedicated test. Clear only the counters that
      // this shared owner account would otherwise consume across test cases.
      await db.query("DELETE FROM inv.rate_limits WHERE key=$1", [accountKey(credentials.email, config.rateSecret)]);
      const result = await this.json('POST', '/api/auth/login', credentials);
      if (result.status !== 200) throw new Error(`login failed with ${result.status}: ${JSON.stringify(result.data)}`);
      csrfToken = result.data.csrf_token;
      return result;
    },
    ok(result, message = 'request') {
      if (result.status >= 400) {
        throw new Error(`${message} failed with ${result.status}: ${JSON.stringify(result.data)}`);
      }
      return result.data;
    },
  };
  return client;
}

export const baseClient = (overrides = {}) => ({
  kind: 'BUSINESS', name: 'Acme Systems', company_name: 'Acme Systems Pvt Ltd', contact_person: 'Ravi Kumar',
  email: 'accounts@acme.test', phone: '+91 90000 00000', billing_address: 'Plot 12, Madhapur\nHyderabad 500081',
  service_address: '', gstin: '36AABCU9603R1ZO', state_code: '36', country: 'India', notes: '',
  payment_terms_days: 15, gst_registered: true, ...overrides,
});

export const baseProduct = (overrides = {}) => ({
  name: 'Nextora POS Desktop', sku: 'NCPOS-DESK', description: 'Desktop POS licence', category: 'Nextora POS',
  unit: 'LIC', unit_price_minor: 2500000, tax_treatment: 'TAXABLE', tax_rate_bp: 1800, hsn_sac: '998314',
  status: 'ACTIVE', billing_interval: 'YEARLY', license_duration_months: 12, validity_notes: '', ...overrides,
});

export const line = (overrides = {}) => ({
  product_id: null, description: 'Custom software development', category: 'Development', hsn_sac: '998314',
  unit: 'NOS', quantity_milli: 1000, unit_price_minor: 10000000, discount_bp: 0, discount_minor: 0,
  tax_rate_bp: 1800, tax_treatment: 'TAXABLE', ...overrides,
});

export const draft = (clientId, overrides = {}) => ({
  client_id: clientId, title: 'Enterprise platform build', description: 'Phase one delivery',
  scope_of_work: 'Design, build and deploy', inclusions: 'Source code', exclusions: 'Third-party licences',
  assumptions: 'Client provides staging access', warranty_terms: '60 days defect support',
  delivery_timeline: '12 weeks from advance', notes: '', terms: 'Payment as per milestones',
  issue_date: '2026-10-01', expiry_date: null, due_date: null,
  place_of_supply_state_code: '', payment_terms_days: 15, payment_terms: '50% advance, 50% on delivery',
  po_reference: '', project_reference: 'NC-PROJ-001', invoice_discount_bp: 0, invoice_discount_minor: 0,
  round_off_enabled: true, items: [line()], additional_charges: [], milestones: [], ...overrides,
});

/** Sets the issuer state so intra/inter-state tax decisions are deterministic. */
export async function configureIssuer(client, overrides = {}) {
  const result = await client.json('PUT', '/api/settings', {
    business_name: 'Nextora Creations', legal_name: '', address: 'Hyderabad, Telangana', email: 'billing@nextora.test',
    phone: '+91 90000 11111', website: 'https://nextoracreations.co.in', gstin: '', state_code: '36', pan: '',
    bank_account_name: 'Nextora Creations', bank_account_number: '1234567890', bank_ifsc: 'HDFC0001234',
    bank_name: 'HDFC Bank', bank_branch: 'Madhapur', upi_id: 'nextora@upi', signatory_name: 'Gorke Sai Kumar',
    signatory_title: 'Founder', default_quotation_validity_days: 30, default_payment_terms_days: 15,
    default_currency: 'INR', rounding_mode: 'NEAREST_RUPEE', default_tax_rate_bp: 1800, reverse_charge: false,
    quotation_prefix: 'NC/QTN', invoice_prefix: 'NC/INV', receipt_prefix: 'NC/RCP', credit_note_prefix: 'NC/CRN',
    terms: 'Payment within 15 days.', quotation_terms: 'Prices valid for 30 days.', pdf_accent_color: '#00AEEF',
    show_bank_details: true, show_signatory: true, show_amount_in_words: true, ...overrides,
  });
  return client.ok(result, 'configure issuer');
}
