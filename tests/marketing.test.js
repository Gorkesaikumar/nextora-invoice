import test from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, configureIssuer, OWNER } from './helpers.js';
import { extractPdf } from './pdf-text.js';

const ip = suffix => `10.9.0.${suffix}`;

async function withAdmin(suffix = 1) {
  const client = makeClient({ ip: ip(suffix) });
  await client.login(OWNER);
  await configureIssuer(client);
  return client;
}

const sampleInfluencer = (overrides = {}) => ({
  legal_name: 'Aditi Sharma',
  display_name: 'Aditi Lifestyle',
  instagram_username: '@aditi_lifestyle',
  instagram_url: 'https://instagram.com/aditi_lifestyle',
  phone: '+91 98765 43210',
  email: 'aditi@example.com',
  address: '402, High Street, Bandra West',
  city: 'Mumbai',
  state_code: '27',
  postal_code: '400050',
  country: 'India',
  niche: 'Lifestyle & Retail Tech',
  follower_count: 85000,
  other_social_links: 'https://youtube.com/@aditilifestyle',
  internal_notes: 'Top performing retail tech creator in Maharashtra.',
  status: 'ACTIVE',
  ...overrides,
});

const sampleAgreement = (influencerId, overrides = {}) => ({
  influencer_id: influencerId,
  title: 'Influencer Marketing & Revenue-Sharing Agreement — Nextora POS',
  brand_name: 'Nextora Creations',
  product_name: 'Nextora POS',
  commission_basis_points: 1250, // 12.50%
  commission_basis: 'NET_SALES_EX_GST',
  custom_basis_description: '',
  product_tax_mode: 'EXCLUSIVE',
  commission_tax_terms: 'EXCLUSIVE',
  influencer_gst_registered: false,
  influencer_gstin: '',
  withholding_tax_rate_bp: 500, // 5% TDS
  withholding_section: '194H',
  start_date: '2026-11-01',
  end_date: '2027-10-31',
  is_indefinite: false,
  payment_frequency: 'MONTHLY',
  payment_due_days: 15,
  minimum_payout_minor: 100000, // ₹1,000.00
  deliverables: [
    {
      type: 'Instagram Reel',
      quantity: 2,
      frequency: 'Monthly',
      deadline: '15th of each month',
      required_tags: '@nextoracreations #NextoraPOS',
      approval_requirements: 'Script & draft preview 48h prior to posting',
      performance_metrics: 'Insights screenshot within 7 days',
    },
    {
      type: 'Product Demonstration',
      quantity: 1,
      frequency: 'Quarterly',
      deadline: 'End of quarter',
      required_tags: '@nextoracreations #NextoraPOSDemo',
      approval_requirements: 'Live demo outline approval',
      performance_metrics: 'Lead referral link clicks',
    }
  ],
  custom_clauses: {},
  special_terms: 'Exclusive retail point-of-sale partnership for the fashion & lifestyle niche in Mumbai.',
  signatory_name: 'Gorke Sai Kumar',
  signatory_title: 'Founder & CEO',
  influencer_signatory_name: 'Aditi Sharma',
  ...overrides,
});

test('Influencer creation, validation, and duplicate detection', async () => {
  const client = await withAdmin(1);

  // 1. Successful influencer creation
  const created = client.ok(await client.json('POST', '/api/marketing/influencers', sampleInfluencer()));
  assert.equal(created.influencer.legal_name, 'Aditi Sharma');
  assert.equal(created.influencer.instagram_username, '@aditi_lifestyle');
  assert.equal(created.influencer.status, 'ACTIVE');
  const infId = created.influencer.id;

  // 2. Fetch by ID
  const fetched = client.ok(await client.json('GET', `/api/marketing/influencers/${infId}`));
  assert.equal(fetched.influencer.id, infId);
  assert.equal(fetched.influencer.city, 'Mumbai');

  // 3. Validation: Missing required fields
  const invalidName = await client.json('POST', '/api/marketing/influencers', sampleInfluencer({ legal_name: '' }));
  assert.equal(invalidName.status, 400);

  // 4. Validation: Invalid Instagram URL
  const invalidUrl = await client.json('POST', '/api/marketing/influencers', sampleInfluencer({
    instagram_username: '@other_user',
    email: 'other@example.com',
    instagram_url: 'https://not-instagram.com/fake',
  }));
  assert.equal(invalidUrl.status, 400);

  // 5. Duplicate detection check endpoint
  const dupCheck = client.ok(await client.json('POST', '/api/marketing/influencers/check-duplicates', {
    instagram_username: 'aditi_lifestyle', // without @
    email: 'aditi@example.com',
  }));
  assert.ok(dupCheck.warnings.length >= 1, 'duplicate warning surfaced for existing handle');

  // 6. Update influencer
  const updated = client.ok(await client.json('PATCH', `/api/marketing/influencers/${infId}`, {
    follower_count: 92000,
    city: 'Navi Mumbai',
  }));
  assert.equal(updated.influencer.follower_count, 92000);
  assert.equal(updated.influencer.city, 'Navi Mumbai');
});

test('Agreement lifecycle, commission validation, and status transitions', async () => {
  const client = await withAdmin(2);

  const inf = client.ok(await client.json('POST', '/api/marketing/influencers', sampleInfluencer({
    legal_name: 'Rohan Mehra',
    display_name: 'TechWithRohan',
    instagram_username: '@techwithrohan',
    email: 'rohan@example.com',
  }))).influencer;

  // 1. Commission percentage validation: <= 0 is rejected
  const zeroCommission = await client.json('POST', '/api/marketing/agreements', sampleAgreement(inf.id, {
    commission_basis_points: 0,
  }));
  assert.equal(zeroCommission.status, 400);

  // 2. Commission percentage validation: > 100% (10000 bp) is rejected
  const over100Commission = await client.json('POST', '/api/marketing/agreements', sampleAgreement(inf.id, {
    commission_basis_points: 10001,
  }));
  assert.equal(over100Commission.status, 400);

  // 3. End date must be >= start date
  const invalidDates = await client.json('POST', '/api/marketing/agreements', sampleAgreement(inf.id, {
    start_date: '2026-11-01',
    end_date: '2026-10-01',
    is_indefinite: false,
  }));
  assert.equal(invalidDates.status, 400);

  // 4. Create valid agreement draft
  const created = client.ok(await client.json('POST', '/api/marketing/agreements', sampleAgreement(inf.id)));
  const agreement = created.agreement;
  assert.ok(agreement.contract_number.startsWith('NC/INF/'), 'contract number starts with configured prefix');
  assert.equal(agreement.status, 'DRAFT');
  assert.equal(agreement.commission_basis_points, 1250);

  // 5. Update draft agreement
  const updated = client.ok(await client.json('PATCH', `/api/marketing/agreements/${agreement.id}`, {
    commission_basis_points: 1500, // 15%
    payment_due_days: 20,
  }));
  assert.equal(updated.agreement.commission_basis_points, 1500);
  assert.equal(updated.agreement.payment_due_days, 20);

  // 6. Status transitions: SUBMIT_APPROVAL -> APPROVE -> SEND -> ACCEPT -> SIGN -> ACTIVATE
  const submitted = client.ok(await client.json('POST', `/api/marketing/agreements/${agreement.id}/status`, {
    action: 'SUBMIT_APPROVAL',
  }));
  assert.equal(submitted.agreement.status, 'PENDING_APPROVAL');

  const approved = client.ok(await client.json('POST', `/api/marketing/agreements/${agreement.id}/status`, {
    action: 'APPROVE',
  }));
  assert.equal(approved.agreement.status, 'DRAFT');

  const sent = client.ok(await client.json('POST', `/api/marketing/agreements/${agreement.id}/status`, {
    action: 'SEND',
    date: '2026-11-02',
  }));
  assert.equal(sent.agreement.status, 'SENT');

  const accepted = client.ok(await client.json('POST', `/api/marketing/agreements/${agreement.id}/status`, {
    action: 'ACCEPT',
    date: '2026-11-03',
  }));
  assert.equal(accepted.agreement.status, 'ACCEPTED');

  const signed = client.ok(await client.json('POST', `/api/marketing/agreements/${agreement.id}/status`, {
    action: 'SIGN',
    date: '2026-11-04',
  }));
  assert.equal(signed.agreement.status, 'SIGNED');

  const activated = client.ok(await client.json('POST', `/api/marketing/agreements/${agreement.id}/status`, {
    action: 'ACTIVATE',
  }));
  assert.equal(activated.agreement.status, 'ACTIVE');

  // 7. Modifying finalized terms is blocked
  const editBlocked = await client.json('PATCH', `/api/marketing/agreements/${agreement.id}`, {
    commission_basis_points: 2000,
  });
  assert.equal(editBlocked.status, 400);

  // 8. Duplicating active agreement creates a new editable draft with incremented version
  const duplicated = client.ok(await client.json('POST', `/api/marketing/agreements/${agreement.id}/duplicate`));
  assert.equal(duplicated.agreement.status, 'DRAFT');
  assert.equal(duplicated.agreement.version, 2);
  assert.notEqual(duplicated.agreement.contract_number, agreement.contract_number);

  // 9. Termination of agreement
  const terminated = client.ok(await client.json('POST', `/api/marketing/agreements/${agreement.id}/status`, {
    action: 'TERMINATE',
    reason: 'Mutual agreement to restructure campaign terms.',
  }));
  assert.equal(terminated.agreement.status, 'TERMINATED');
});

test('PDF generation, logo embedding, and downloads', async () => {
  const client = await withAdmin(3);

  // 1. Upload Nextora POS product logo (1x1 transparent PNG)
  const productLogoPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const logoUpload = client.ok(await client.json('POST', '/api/marketing/product-logo', {
    logo: productLogoPng,
  }));
  assert.equal(logoUpload.logo.name, 'product_logo');

  // Verify retrieval
  const logoGet = await client.binary('GET', '/api/marketing/product-logo');
  assert.equal(logoGet.status, 200);
  assert.equal(logoGet.headers.get('content-type'), 'image/png');

  // 2. Create influencer & agreement
  const inf = client.ok(await client.json('POST', '/api/marketing/influencers', sampleInfluencer({
    legal_name: 'Pooja Verma',
    display_name: 'PoojaTech',
    instagram_username: '@poojatech',
    email: 'pooja@example.com',
  }))).influencer;

  const agr = client.ok(await client.json('POST', '/api/marketing/agreements', sampleAgreement(inf.id, {
    commission_basis_points: 1500, // 15%
  }))).agreement;

  // 3. Contract preview endpoint
  const preview = client.ok(await client.json('GET', `/api/marketing/agreements/${agr.id}/preview`));
  assert.equal(preview.snapshot.contract_number, agr.contract_number);
  assert.equal(preview.snapshot.commercial_terms.commission_percentage, '15.00');
  assert.ok(preview.snapshot.clauses.section_2_purpose.includes('independent marketing partner'));

  // 4. Generate PDF endpoint
  const generated = client.ok(await client.json('POST', `/api/marketing/agreements/${agr.id}/generate-pdf`));
  assert.equal(generated.success, true);
  assert.ok(generated.bytes_length > 1000);

  // 5. Download PDF binary
  const pdfResponse = await client.binary('GET', `/api/marketing/agreements/${agr.id}/pdf`);
  assert.equal(pdfResponse.status, 200);
  assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf');
  assert.ok(pdfResponse.headers.get('content-disposition').includes('attachment; filename='));
  assert.equal(pdfResponse.bytes.subarray(0, 5).toString(), '%PDF-');

  // 6. Verify PDF content extraction
  const pages = extractPdf(pdfResponse.bytes);
  assert.ok(pages.length >= 2, 'influencer contract spans multiple formatted pages');
  const fullText = pages.map(p => p.text.join('\n')).join('\n');

  assert.ok(fullText.includes('INFLUENCER MARKETING & REVENUE-SHARING AGREEMENT'));
  assert.ok(fullText.includes(agr.contract_number));
  assert.ok(fullText.includes('Pooja Verma'));
  assert.ok(fullText.includes('@poojatech'));
  assert.ok(fullText.includes('Nextora Creations'));
  assert.ok(fullText.includes('Nextora POS'));
  assert.ok(fullText.includes('SECTION 1: PARTIES TO THE AGREEMENT'));
  assert.ok(fullText.includes('SECTION 2: PURPOSE OF THE PARTNERSHIP'));
  assert.ok(fullText.includes('SECTION 3: SCOPE OF WORK & MARKETING DELIVERABLES'));
  assert.ok(fullText.includes('SECTION 4: REVENUE-SHARING TERMS & CALCULATION BASIS'));
  assert.ok(fullText.includes('SECTION 10: ACCEPTANCE & EXECUTION'));
  assert.ok(fullText.includes('FOR NEXTORA CREATIONS:'));
  assert.ok(fullText.includes('FOR INFLUENCER / MARKETING PARTNER:'));
  assert.ok(fullText.includes('Page 1 of'));
});

test('Financial integrity: Commission bases, GST distinctions, and no false payouts', async () => {
  const client = await withAdmin(4);

  // 1. Check marketing dashboard when no attributions exist
  const dashboardInitial = client.ok(await client.json('GET', '/api/marketing/dashboard'));
  assert.equal(dashboardInitial.total_attributed_revenue_minor, 0);
  assert.equal(dashboardInitial.total_commission_payable_minor, 0);
  assert.equal(dashboardInitial.has_verified_attribution, false);

  // 2. Create influencer & contract
  const inf = client.ok(await client.json('POST', '/api/marketing/influencers', sampleInfluencer({
    legal_name: 'Karan Patel',
    display_name: 'KaranTech',
    instagram_username: '@karan_tech',
    email: 'karan@example.com',
  }))).influencer;

  const agr = client.ok(await client.json('POST', '/api/marketing/agreements', sampleAgreement(inf.id, {
    commission_basis_points: 1000, // 10%
    commission_basis: 'NET_SALES_EX_GST',
    product_tax_mode: 'EXCLUSIVE',
  }))).agreement;

  // 3. Generating a PDF must NOT create a commission payment or change dashboard revenue
  await client.json('POST', `/api/marketing/agreements/${agr.id}/generate-pdf`);

  const dashboardAfterPdf = client.ok(await client.json('GET', '/api/marketing/dashboard'));
  assert.equal(dashboardAfterPdf.total_attributed_revenue_minor, 0, 'generating a contract does not fabricate revenue');
  assert.equal(dashboardAfterPdf.total_commission_payable_minor, 0, 'generating a contract does not trigger commission payout');
  assert.equal(dashboardAfterPdf.contracts_generated, dashboardInitial.contracts_generated + 1);

  // 4. Test illustrative calculation under different commission bases
  const preview = client.ok(await client.json('GET', `/api/marketing/agreements/${agr.id}/preview`));
  const calc = preview.snapshot.illustrative_calculation;
  assert.equal(calc.commission_rate_bp, 1000); // 10%
  assert.equal(calc.sample_sale_minor, 1000000); // ₹10,000.00
  assert.equal(calc.commission_base_minor, 1000000); // ₹10,000.00 (net excluding GST)
  assert.equal(calc.gross_commission_minor, 100000); // ₹1,000.00
  assert.equal(calc.withholding_minor, 5000); // ₹50.00 (5% TDS)
  assert.equal(calc.net_commission_payable_minor, 95000); // ₹950.00
  assert.ok(calc.disclaimer.includes('ILLUSTRATIVE CALCULATION EXAMPLE ONLY'));
});

test('Security & permissions: Non-administrators cannot access marketing module', async () => {
  const admin = await withAdmin(5);

  // Create a staff user with FINANCE role
  const financeUser = {
    email: 'finance_staff@example.test',
    password: 'Password1234!',
    confirm_password: 'Password1234!',
    display_name: 'Finance Staff',
  };
  admin.ok(await admin.json('POST', '/api/auth/register', financeUser));

  // Sign in as finance staff
  const staffClient = makeClient({ ip: ip(6) });
  await staffClient.login({ email: financeUser.email, password: financeUser.password });

  // Verify finance staff cannot access influencer creation or agreements
  const infAccess = await staffClient.json('GET', '/api/marketing/influencers');
  assert.equal(infAccess.status, 403);

  const createInf = await staffClient.json('POST', '/api/marketing/influencers', sampleInfluencer({
    instagram_username: '@unauth_test',
    email: 'unauth@test.com',
  }));
  assert.equal(createInf.status, 403);

  const agrAccess = await staffClient.json('GET', '/api/marketing/agreements');
  assert.equal(agrAccess.status, 403);

  const dashAccess = await staffClient.json('GET', '/api/marketing/dashboard');
  assert.equal(dashAccess.status, 403);
});
