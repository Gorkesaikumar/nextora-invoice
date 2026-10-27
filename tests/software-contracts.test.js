import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { makeClient, configureIssuer, OWNER } from './helpers.js';
import { extractPdf } from './pdf-text.js';

const ip = suffix => `10.9.8.${suffix}`;

async function withAdmin(suffix = 1) {
  const client = makeClient({ ip: ip(suffix) });
  await client.login(OWNER);
  await configureIssuer(client, {
    business_name: 'Nextora Creations',
    state_code: '36', // Telangana
    gstin: '36JTAPK9167A1ZK',
    phone: '7674981970',
    website: 'https://nextoracreations.co.in/',
  });
  return client;
}

const sampleSoftwareContract = (overrides = {}) => ({
  client_name: 'TechNova Solutions',
  client_legal_name: 'TechNova Solutions Private Limited',
  contact_person: 'Rajesh Kumar',
  client_email: 'rajesh@technova.example.com',
  client_phone: '+91 98765 12345',
  billing_address: 'Plot 42, Hitec City, Madhapur',
  city: 'Hyderabad',
  state_code: '36', // Telangana
  postal_code: '500081',
  country: 'India',
  client_gstin: '36AABCT1332L1ZV',
  client_pan: 'AABCT1332L',
  client_business_type: 'Private Limited',
  signatory_name: 'Rajesh Kumar',
  signatory_designation: 'Managing Director',

  title: 'Custom ERP & Inventory Management Portal',
  service_category: 'Custom software development',
  service_description: 'End-to-end custom ERP portal with inventory tracking, invoicing, and real-time dashboard.',
  business_objectives: 'Streamline multi-warehouse inventory management and automate billing workflows.',
  start_date: '2026-11-01',
  estimated_completion_date: '2026-12-01',
  development_duration: '1 Month',
  deployment_target: 'AWS ECS Cloud Container Infrastructure',
  hosting_responsibility: 'Client provides and funds AWS cloud accounts; Developer manages architecture and setup.',
  client_assets_access: 'AWS IAM developer keys, company logos, domain DNS access.',
  third_party_integrations: 'Razorpay Payment Gateway, AWS S3, Twilio SMS',
  acceptance_criteria: '7 business days User Acceptance Testing window upon staging deployment.',

  features: [
    {
      sno: 1,
      name: 'Authentication & Role-Based Access Control',
      description: 'Granular user permission management for admin, warehouse manager, and accountant roles.',
      deliverables: 'Secured login API, session token management, RBAC middleware',
      priority: 'High',
      acceptance_criteria: 'All roles correctly restricted from unauthorized endpoints',
      included: true,
      notes: '',
    },
    {
      sno: 2,
      name: 'Real-Time Inventory & Warehouse Tracking',
      description: 'Stock batch management, SKU barcode scanning, and multi-location transfers.',
      deliverables: 'Inventory ledger, warehouse stock view, low-stock threshold alerts',
      priority: 'High',
      acceptance_criteria: 'Atomic database transactions prevent negative stock quantities',
      included: true,
      notes: '',
    },
    {
      sno: 3,
      name: 'GST-Compliant Automated Invoicing Engine',
      description: 'Automated generation of B2B and B2C tax invoices, credit notes, and payment receipts.',
      deliverables: 'Invoice generation module with intra-state and interstate tax routing',
      priority: 'Critical',
      acceptance_criteria: 'Exact reconciliation of CGST, SGST, and IGST according to GSTIN place of supply',
      included: true,
      notes: '',
    },
    {
      sno: 4,
      name: 'Automated Daily Database Backups',
      description: 'Automated daily snapshots written to encrypted AWS S3 bucket.',
      deliverables: 'Nightly backup cron script and restore verification runner',
      priority: 'Normal',
      acceptance_criteria: 'Verified automated daily snapshot creation and retention lifecycle',
      included: true,
      notes: '',
    },
  ],

  included_services: 'Custom software engineering, staging environment deployment, UAT support, 3 months complimentary support.',
  excluded_services: 'Paid third-party API fees, recurring AWS hosting costs, domain name registrations.',
  client_responsibilities: 'Timely review of deliverables within 5 business days, providing required API credentials.',
  third_party_dependencies: 'Razorpay account activation and AWS cloud provisioning.',

  pricing_mode: 'EXCLUSIVE',
  base_price_minor: 10000000, // ₹1,00,000.00
  gst_rate_bp: 1800, // 18% GST
  gst_treatment: 'TAXABLE',
  discount_minor: 0,
  additional_charges_minor: 0,
  advance_percentage_bp: 1000, // 10.00% advance

  payment_milestones: [
    {
      name: 'Milestone 1: Architecture & Database Design Sign-Off',
      trigger: 'Approved database schemas and technical architecture documentation',
      due_date: '2026-11-08',
      amount_minor: 3000000, // ₹30,000.00
    },
    {
      name: 'Milestone 2: Core Development & Staging Release',
      trigger: 'Deployment of core inventory and invoicing modules to staging server',
      due_date: '2026-11-20',
      amount_minor: 4000000, // ₹40,000.00
    },
    {
      name: 'Milestone 3: Final Acceptance & Production Handover',
      trigger: 'Successful UAT sign-off, production deployment, and administrative credential handover',
      due_date: '2026-12-01',
      amount_minor: 3800000, // ₹38,000.00 (reconciling to ₹1,08,000.00 balance)
    },
  ],

  free_support_months: 3,
  support_start_date: '2026-12-01',
  support_end_date: '2027-03-01',
  support_scope: 'Correction of reproducible defects, bugs, and minor configuration alignments.',
  post_support_feature_rate_minor: 500000, // ₹5,000.00
  post_support_terms: 'New feature development after 3-month support period billed at ₹5,000 default rate per approved feature.',

  maintenance_included: false,
  maintenance_rate_minor: 200000, // ₹2,000.00
  maintenance_frequency: 'MONTHLY',
  maintenance_scope: 'Routine uptime checks, security dependency updates, application health monitoring.',
  maintenance_exclusions: 'New feature development, major design changes, cloud infrastructure costs.',

  nextora_signatory_name: 'Praveen G',
  nextora_signatory_title: 'Managing Director',
  client_signatory_name: 'Rajesh Kumar',
  client_signatory_title: 'Managing Director',
  ...overrides,
});

/* ------------------------------------------------------------- Test Cases */

test('1. Client and Project Data: Create contract with existing client, new client, and validation', async () => {
  const client = await withAdmin(1);

  // A. Create an existing master client in inv.clients
  const masterClient = client.ok(await client.json('POST', '/api/clients', {
    kind: 'BUSINESS',
    name: 'Apex Global Enterprises',
    company_name: 'Apex Global Enterprises LLP',
    contact_person: 'Vikram Mehta',
    email: 'vikram@apexglobal.example.com',
    phone: '+91 91234 56789',
    billing_address: '8th Floor, Cyber Gateway, Hitec City',
    state_code: '36', // Telangana
    country: 'India',
    gst_registered: true,
    gstin: '36AAHCA1234F1ZX',
  })).client;
  assert.ok(masterClient.id);

  // B. Create a software agreement linking to this master client
  const agrRes = client.ok(await client.json('POST', '/api/marketing/software-agreements', sampleSoftwareContract({
    client_id: masterClient.id,
    client_name: masterClient.name,
    client_legal_name: masterClient.company_name,
    client_email: masterClient.email,
    client_phone: masterClient.phone,
    billing_address: masterClient.billing_address,
    client_gstin: masterClient.gstin,
    state_code: masterClient.state_code,
  })));

  const agr = agrRes.agreement;
  assert.ok(agr.id);
  assert.equal(agr.client_id, masterClient.id);
  assert.ok(agr.contract_number.startsWith('NC/SDA/'));
  assert.equal(agr.status, 'DRAFT');
  assert.equal(agr.version, 1);

  // C. Update master client profile in inv.clients
  await client.json('PATCH', `/api/clients/${masterClient.id}`, {
    name: 'Apex Global Enterprises MODIFIED MASTER NAME',
    company_name: 'Apex Global Worldwide Corporation',
  });

  // Verify historical agreement snapshot retains original client details (Historical Immutability)
  const preview = client.ok(await client.json('GET', `/api/marketing/software-agreements/${agr.id}/preview`));
  assert.equal(preview.snapshot.client.name, 'Apex Global Enterprises', 'Historical contract client name must not silently change when master profile changes');
  assert.equal(preview.snapshot.client.legal_name, 'Apex Global Enterprises LLP');

  // D. Create a contract for a new client (manual entry without existing client_id)
  const manualAgr = client.ok(await client.json('POST', '/api/marketing/software-agreements', sampleSoftwareContract({
    client_id: null,
    client_name: 'Direct Startup Co',
    client_legal_name: 'Direct Startup Private Limited',
  }))).agreement;
  assert.ok(manualAgr.id);
  assert.equal(manualAgr.client_name, 'Direct Startup Co');

  // E. Required field validation: Reject missing client_name
  const invalidRes = await client.json('POST', '/api/marketing/software-agreements', sampleSoftwareContract({
    client_name: '',
  }));
  assert.equal(invalidRes.status, 400, 'Empty client_name must be rejected');
});

test('2. Financial Calculations: GST-Exclusive, Intra-state Telangana (CGST 9% + SGST 9%)', async () => {
  const client = await withAdmin(2);

  // Base: ₹1,00,000.00 (10000000 paise), 18% GST, Intra-state Telangana (36 -> 36)
  // Taxable: ₹1,00,000.00
  // CGST: 9% = ₹9,000.00 (900000 paise)
  // SGST: 9% = ₹9,000.00 (900000 paise)
  // Total GST: ₹18,000.00
  // Final Amount: ₹1,18,000.00
  // 10% Advance: ₹10,000.00 (10% of base price before GST)
  // Remaining Balance: ₹1,08,000.00

  const res = client.ok(await client.json('POST', '/api/marketing/software-agreements/calculate', {
    base_price_minor: 10000000,
    pricing_mode: 'EXCLUSIVE',
    gst_rate_bp: 1800,
    gst_treatment: 'TAXABLE',
    discount_minor: 0,
    additional_charges_minor: 0,
    client_state_code: '36', // Telangana
    advance_percentage_bp: 1000, // 10.00%
    payment_milestones: [
      { amount_minor: 5000000 },
      { amount_minor: 5800000 },
    ],
  }));

  const f = res.financials;
  assert.equal(f.pricing_mode, 'EXCLUSIVE');
  assert.equal(f.base_price_minor, 10000000);
  assert.equal(f.taxable_amount_minor, 10000000);
  assert.equal(f.supply_type, 'INTRA');
  assert.equal(f.cgst_minor, 900000, 'CGST must be exactly 9% (₹9,000.00)');
  assert.equal(f.sgst_minor, 900000, 'SGST must be exactly 9% (₹9,000.00)');
  assert.equal(f.igst_minor, 0);
  assert.equal(f.total_gst_minor, 1800000);
  assert.equal(f.final_amount_minor, 11800000, 'Final amount must be ₹1,18,000.00');
  assert.equal(f.advance_amount_minor, 1000000, 'Advance must be 10% of base before GST = ₹10,000.00');
  assert.equal(f.remaining_balance_minor, 10800000, 'Remaining balance must be ₹1,08,000.00');
  assert.equal(f.is_milestones_reconciled, true, 'Sum of milestones (50,000 + 58,000) matches remaining balance');
});

test('3. Financial Calculations: Interstate Supply to Karnataka (IGST 18%)', async () => {
  const client = await withAdmin(3);

  // Supplier in Telangana (36), Client in Karnataka (29)
  // Base: ₹2,00,000.00 (20000000 paise)
  // IGST: 18% = ₹36,000.00 (3600000 paise)
  // CGST: 0, SGST: 0
  // Final Amount: ₹2,36,000.00
  // 10% Advance: ₹20,000.00
  // Remaining Balance: ₹2,16,000.00

  const res = client.ok(await client.json('POST', '/api/marketing/software-agreements/calculate', {
    base_price_minor: 20000000,
    pricing_mode: 'EXCLUSIVE',
    gst_rate_bp: 1800,
    gst_treatment: 'TAXABLE',
    discount_minor: 0,
    additional_charges_minor: 0,
    client_state_code: '29', // Karnataka
    advance_percentage_bp: 1000,
    payment_milestones: [],
  }));

  const f = res.financials;
  assert.equal(f.supply_type, 'INTER');
  assert.equal(f.cgst_minor, 0);
  assert.equal(f.sgst_minor, 0);
  assert.equal(f.igst_minor, 3600000, 'Interstate supply routes full 18% to IGST');
  assert.equal(f.total_gst_minor, 3600000);
  assert.equal(f.final_amount_minor, 23600000);
  assert.equal(f.advance_amount_minor, 2000000);
  assert.equal(f.remaining_balance_minor, 21600000);
});

test('4. Financial Calculations: GST-Inclusive Mode with Discount and Charges', async () => {
  const client = await withAdmin(4);

  // Entered price ₹59,000.00 (5900000 paise) GST-inclusive @ 18% GST
  // Discount: ₹5,000.00 (500000 paise) -> Net payable gross = ₹54,000.00
  // Taxable: roundDiv(5400000 * 10000, 11800) = 4576271 (₹45,762.71)
  // GST: 5400000 - 4576271 = 823729 (₹8,237.29)
  // Final Amount: ₹54,000.00
  // 10% Advance of gross = ₹5,400.00 (540000 paise)
  // Remaining Balance = ₹48,600.00 (4860000 paise)

  const res = client.ok(await client.json('POST', '/api/marketing/software-agreements/calculate', {
    base_price_minor: 5900000,
    pricing_mode: 'INCLUSIVE',
    gst_rate_bp: 1800,
    gst_treatment: 'TAXABLE',
    discount_minor: 500000,
    additional_charges_minor: 0,
    client_state_code: '36', // Telangana
    advance_percentage_bp: 1000,
  }));

  const f = res.financials;
  assert.equal(f.pricing_mode, 'INCLUSIVE');
  assert.equal(f.final_amount_minor, 5400000, 'In inclusive mode, final amount is net gross after discount');
  assert.equal(f.taxable_amount_minor, 4576271);
  assert.equal(f.total_gst_minor, 823729);
  assert.equal(f.cgst_minor, Math.floor(823729 / 2)); // 411864
  assert.equal(f.sgst_minor, 823729 - Math.floor(823729 / 2)); // 411865
  assert.equal(f.advance_amount_minor, 540000);
  assert.equal(f.remaining_balance_minor, 4860000);
});

test('5. Milestone Reconciliation: Detects mismatched remaining balance', async () => {
  const client = await withAdmin(5);

  const res = client.ok(await client.json('POST', '/api/marketing/software-agreements/calculate', {
    base_price_minor: 10000000, // ₹1,00,000.00
    pricing_mode: 'EXCLUSIVE',
    gst_rate_bp: 1800,
    advance_percentage_bp: 1000, // Advance = ₹10,000.00, Remaining = ₹1,08,000.00 (10800000 paise)
    payment_milestones: [
      { name: 'Milestone 1', amount_minor: 5000000 },
      { name: 'Milestone 2', amount_minor: 5000000 }, // Total = 1,00,000.00 (diff of 8,000.00)
    ],
  }));

  const f = res.financials;
  assert.equal(f.is_milestones_reconciled, false, 'Should flag mismatch when milestone sum != remaining balance');
  assert.equal(f.milestones_difference_minor, 800000, 'Difference must equal unallocated ₹8,000.00');
});

test('6. Support, Post-Support Feature Rates, and Maintenance Terms', async () => {
  const client = await withAdmin(6);

  const agr = client.ok(await client.json('POST', '/api/marketing/software-agreements', sampleSoftwareContract({
    free_support_months: 3,
    support_start_date: '2026-12-01',
    support_end_date: '2027-03-01',
    post_support_feature_rate_minor: 500000, // ₹5,000.00 default
    maintenance_included: true,
    maintenance_rate_minor: 200000, // ₹2,000.00 default
    maintenance_start_date: '2027-03-01',
  }))).agreement;

  assert.equal(agr.free_support_months, 3);
  assert.equal(agr.support_start_date, '2026-12-01');
  assert.equal(agr.support_end_date, '2027-03-01');
  assert.equal(agr.post_support_feature_rate_minor, 500000, 'Post-support feature rate defaults to ₹5,000');
  assert.equal(agr.maintenance_included, true);
  assert.equal(agr.maintenance_rate_minor, 200000, 'Monthly maintenance rate defaults to ₹2,000');

  // Preview verification
  const preview = client.ok(await client.json('GET', `/api/marketing/software-agreements/${agr.id}/preview`));
  const sup = preview.snapshot.support_and_maintenance;
  assert.equal(sup.free_support_months, 3);
  assert.equal(sup.post_support_feature_rate_formatted, '₹5,000.00');
  assert.equal(sup.maintenance_rate_formatted, '₹2,000.00');
  assert.equal(sup.maintenance_included, true);
});

test('7. Contract Lifecycle Transitions: Draft -> Pending -> Approved -> Sent -> Accepted -> Signed -> Active -> Completed', async () => {
  const client = await withAdmin(7);

  const agr = client.ok(await client.json('POST', '/api/marketing/software-agreements', sampleSoftwareContract())).agreement;
  assert.equal(agr.status, 'DRAFT');

  // DRAFT -> PENDING_APPROVAL
  const pending = client.ok(await client.json('POST', `/api/marketing/software-agreements/${agr.id}/status`, {
    action: 'SUBMIT_APPROVAL',
  })).agreement;
  assert.equal(pending.status, 'PENDING_APPROVAL');

  // PENDING_APPROVAL -> APPROVED
  const approved = client.ok(await client.json('POST', `/api/marketing/software-agreements/${agr.id}/status`, {
    action: 'APPROVE',
  })).agreement;
  assert.equal(approved.status, 'APPROVED');

  // APPROVED -> SENT
  const sent = client.ok(await client.json('POST', `/api/marketing/software-agreements/${agr.id}/status`, {
    action: 'SEND',
    date: '2026-11-02',
  })).agreement;
  assert.equal(sent.status, 'SENT');
  assert.ok(sent.sent_at);

  // SENT -> ACCEPTED
  const accepted = client.ok(await client.json('POST', `/api/marketing/software-agreements/${agr.id}/status`, {
    action: 'ACCEPT',
    date: '2026-11-03',
  })).agreement;
  assert.equal(accepted.status, 'ACCEPTED');

  // ACCEPTED -> SIGNED
  const signed = client.ok(await client.json('POST', `/api/marketing/software-agreements/${agr.id}/status`, {
    action: 'SIGN',
    date: '2026-11-04',
  })).agreement;
  assert.equal(signed.status, 'SIGNED');

  // SIGNED -> ACTIVE
  const active = client.ok(await client.json('POST', `/api/marketing/software-agreements/${agr.id}/status`, {
    action: 'ACTIVATE',
  })).agreement;
  assert.equal(active.status, 'ACTIVE');

  // ACTIVE -> COMPLETED
  const completed = client.ok(await client.json('POST', `/api/marketing/software-agreements/${agr.id}/status`, {
    action: 'COMPLETE',
  })).agreement;
  assert.equal(completed.status, 'COMPLETED');
});

test('8. PDF Vector Generation, Text Extraction, and Download', async () => {
  const client = await withAdmin(8);

  // 1. Create a detailed software agreement
  const agr = client.ok(await client.json('POST', '/api/marketing/software-agreements', sampleSoftwareContract({
    title: 'Custom High-Performance Cloud CRM Platform',
    base_price_minor: 15000000, // ₹1,50,000.00
  }))).agreement;

  // 2. Generate PDF endpoint
  const genRes = client.ok(await client.json('POST', `/api/marketing/software-agreements/${agr.id}/generate-pdf`));
  assert.equal(genRes.success, true);
  assert.ok(genRes.bytes_length > 1000);

  // 3. Download binary endpoint
  const pdfRes = await client.binary('GET', `/api/marketing/software-agreements/${agr.id}/pdf`);
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
  assert.ok(pdfRes.headers.get('content-disposition').includes('Software_Development_Agreement.pdf'));
  assert.equal(pdfRes.bytes.subarray(0, 5).toString(), '%PDF-');

  // 4. Extract and inspect text across all pages
  const pages = extractPdf(pdfRes.bytes);
  assert.ok(pages.length >= 2, 'Software contract must span multiple professionally formatted A4 pages');
  const fullText = pages.map(p => p.text.join('\n')).join('\n');
  const normalizedText = fullText.replace(/\s+/g, ' ');

  // Header and branding verification
  assert.ok(fullText.includes('SOFTWARE DEVELOPMENT SERVICES AGREEMENT'));
  assert.ok(fullText.includes('Nextora Creations'));
  assert.ok(fullText.includes(agr.contract_number));
  assert.ok(fullText.includes('36JTAPK9167A1ZK')); // Nextora GSTIN
  assert.ok(fullText.includes('7674981970')); // Phone

  // Client verification
  assert.ok(fullText.includes('TechNova Solutions'));
  assert.ok(fullText.includes('36AABCT1332L1ZV')); // Client GSTIN

  // Sections
  assert.ok(fullText.includes('SECTION 1: PARTIES TO THE AGREEMENT'));
  assert.ok(fullText.includes('SECTION 2: PROJECT & SERVICE DETAILS'));
  assert.ok(fullText.includes('SECTION 3: REQUIREMENTS & FEATURE SCOPE (SCHEDULE A)'));
  assert.ok(fullText.includes('SECTION 4: PROJECT PRICING & GST CALCULATIONS'));
  assert.ok(fullText.includes('SECTION 5: PAYMENT TERMS & MILESTONES'));
  assert.ok(fullText.includes('SECTION 6: DEVELOPMENT TIMELINE'));
  assert.ok(fullText.includes('SECTION 7: THREE MONTHS FREE SUPPORT & POST-SUPPORT TERMS'));
  assert.ok(fullText.includes('SECTION 8: MONTHLY MAINTENANCE PLAN'));
  assert.ok(fullText.includes('SECTION 10: ACCEPTANCE & EXECUTION'));

  // Features in Schedule A (may wrap across lines in table cells)
  assert.ok(normalizedText.includes('Authentication & Role-Based Access Control'));
  assert.ok(normalizedText.includes('Real-Time Inventory & Warehouse Tracking'));
  assert.ok(normalizedText.includes('GST-Compliant Automated Invoicing Engine'));

  // Signatures
  assert.ok(fullText.includes('FOR NEXTORA CREATIONS:'));
  assert.ok(fullText.includes('FOR CLIENT / CUSTOMER:'));
  assert.ok(fullText.includes('Page 1 of'));
});

test('9. Unified Contracts Endpoint: Returns both software and influencer agreements', async () => {
  const client = await withAdmin(9);

  // Create an influencer
  const inf = client.ok(await client.json('POST', '/api/marketing/influencers', {
    legal_name: 'Sneha Patel',
    display_name: 'Sneha Retail',
    instagram_username: '@sneharetail',
    phone: '+91 98765 43210',
    email: 'sneha@example.test',
  })).influencer;

  // Create an influencer agreement
  const infAgr = client.ok(await client.json('POST', '/api/marketing/agreements', {
    influencer_id: inf.id,
    title: 'Influencer Agreement — Nextora POS',
    start_date: '2026-11-01',
    end_date: '2027-10-31',
    is_indefinite: false,
    commission_basis_points: 1200,
  })).agreement;

  // Create a software services agreement
  const swAgr = client.ok(await client.json('POST', '/api/marketing/software-agreements', sampleSoftwareContract({
    client_name: 'Delta Logistics LLP',
  }))).agreement;

  // Query unified contracts endpoint
  const unified = client.ok(await client.json('GET', '/api/marketing/contracts'));
  assert.ok(unified.contracts.length >= 2);

  const foundInf = unified.contracts.find(c => c.id === infAgr.id);
  assert.ok(foundInf);
  assert.equal(foundInf.contract_type, 'INFLUENCER');
  assert.equal(foundInf.counterparty_name, 'Sneha Patel');

  const foundSw = unified.contracts.find(c => c.id === swAgr.id);
  assert.ok(foundSw);
  assert.equal(foundSw.contract_type, 'SOFTWARE_SERVICES');
  assert.equal(foundSw.counterparty_name, 'Delta Logistics LLP');
});

test('10. Software contract branding mode, draft deletion, and archival', async () => {
  const client = await withAdmin(10);

  // 1. Create with default or explicit branding_mode
  const draft = client.ok(await client.json('POST', '/api/marketing/software-agreements', sampleSoftwareContract({
    client_name: 'Branding Test Client',
    branding_mode: 'COMPANY_ONLY',
  }))).agreement;
  assert.equal(draft.branding_mode, 'COMPANY_ONLY');

  // Preview contains branding_mode
  const prev = client.ok(await client.json('GET', `/api/marketing/software-agreements/${draft.id}/preview`));
  assert.equal(prev.snapshot.branding_mode, 'COMPANY_ONLY');

  // 2. Update branding_mode to BOTH
  const updated = client.ok(await client.json('PATCH', `/api/marketing/software-agreements/${draft.id}`, {
    branding_mode: 'BOTH',
  })).agreement;
  assert.equal(updated.branding_mode, 'BOTH');

  // 3. Delete draft software agreement
  const delRes = client.ok(await client.json('DELETE', `/api/marketing/software-agreements/${draft.id}`));
  assert.equal(delRes.deleted, true);

  // Verify 404
  const getDeleted = await client.json('GET', `/api/marketing/software-agreements/${draft.id}`);
  assert.equal(getDeleted.status, 404);

  // 4. Create another and advance to SIGNED
  const activeSw = client.ok(await client.json('POST', '/api/marketing/software-agreements', sampleSoftwareContract({
    client_name: 'Archived SW Client',
    branding_mode: 'PRODUCT_ONLY',
  }))).agreement;

  await client.json('POST', `/api/marketing/software-agreements/${activeSw.id}/status`, { action: 'SUBMIT_APPROVAL' });
  await client.json('POST', `/api/marketing/software-agreements/${activeSw.id}/status`, { action: 'APPROVE' });
  await client.json('POST', `/api/marketing/software-agreements/${activeSw.id}/status`, { action: 'SEND' });
  await client.json('POST', `/api/marketing/software-agreements/${activeSw.id}/status`, { action: 'ACCEPT' });
  await client.json('POST', `/api/marketing/software-agreements/${activeSw.id}/status`, { action: 'SIGN' });

  // Delete fails for non-draft
  const blockedDel = await client.json('DELETE', `/api/marketing/software-agreements/${activeSw.id}`);
  assert.equal(blockedDel.status, 409);
  assert.equal(blockedDel.data.code, 'NOT_DELETABLE');

  // Archival succeeds
  const archived = client.ok(await client.json('POST', `/api/marketing/software-agreements/${activeSw.id}/archive`));
  assert.equal(archived.agreement.status, 'ARCHIVED');
});

function makeTestPng(width = 80, height = 80) {
  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * rowLen + 1 + x * 3;
      raw[idx] = 0; raw[idx + 1] = 174; raw[idx + 2] = 239;
    }
  }
  const idatData = zlib.deflateSync(raw);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type);
    let crc = 0xFFFFFFFF;
    for (const b of Buffer.concat([t, data])) {
      crc ^= b;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    const c = Buffer.alloc(4); c.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0, 0);
    return Buffer.concat([len, t, data, c]);
  };
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))]);
}

test('12. Canonical HTML Preview, Centered Company Logo Parity, Reference Contract (NC/SDA/2026-27/0001) Layout and Standalone HTML', async () => {
  const client = await withAdmin(12);

  // 1. Test Fallback when company logo is absent
  const draftNoLogo = client.ok(await client.json('POST', '/api/marketing/software-agreements', sampleSoftwareContract({
    client_name: 'Fallback Client',
    title: 'Text-Only Logo Agreement',
  }))).agreement;

  const prevNoLogo = client.ok(await client.json('GET', `/api/marketing/software-agreements/${draftNoLogo.id}/preview`));
  assert.ok(prevNoLogo.html, 'Preview endpoint must return canonical HTML');
  assert.ok(prevNoLogo.html.includes('nc-contract-doc'));
  assert.ok(prevNoLogo.html.includes('nc-logo-fallback-text'));
  assert.ok(prevNoLogo.html.includes('NEXTORA CREATIONS'));

  // 2. Upload Company Logo via /api/settings/logo
  const pngBytes = makeTestPng(120, 120);
  const pngDataUri = `data:image/png;base64,${pngBytes.toString('base64')}`;
  client.ok(await client.json('POST', '/api/settings/logo', { png: pngDataUri }));

  // 3. Create reference contract matching NC/SDA/2026-27/0001 (Sevajobs / Raghava)
  const refContract = client.ok(await client.json('POST', '/api/marketing/software-agreements', {
    client_name: 'Sevajobs',
    contact_person: 'Raghava',
    client_email: 'raghava@sevajobs.example.com',
    client_phone: '+91 98765 43210',
    billing_address: 'Hitech City, Madhapur',
    city: 'Hyderabad',
    state_code: '36',
    postal_code: '500081',
    country: 'India',
    client_business_type: 'Individual',
    signatory_name: 'Raghava',
    signatory_designation: 'Founder / Managing Director',

    title: 'Seva jobs project',
    service_category: 'Custom software development',
    service_description: 'Full-stack software development services for Sevajobs employment portal and mobile application.',
    business_objectives: 'Build scalable job portal linking local job seekers with verified employers.',
    start_date: '2026-04-01',
    estimated_completion_date: '2026-05-01',
    development_duration: '1 Month',
    deployment_target: 'Production Cloud Server (Linux / Node.js / PostgreSQL)',
    hosting_responsibility: 'Client provides server environment and API credentials.',
    client_assets_access: 'Logo assets, branding guidelines, SMS gateway keys.',
    third_party_integrations: 'Payment Gateway, WhatsApp Notifications API',
    acceptance_criteria: '7 business days UAT review window upon staging deployment.',

    pricing_mode: 'INCLUSIVE',
    base_price_minor: 2000000, // ₹20,000.00
    advance_percentage_bp: 1000, // 10% -> ₹2,000.00
    free_support_months: 3,
    post_support_feature_rate_minor: 500000, // ₹5,000.00 per feature
    maintenance_included: true,
    maintenance_rate_minor: 200000, // ₹2,000.00 / month

    features: [
      {
        sno: 1,
        name: 'Job Seeker Registration & Verified Profile Builder with Document Uploads',
        description: 'Complete user registration flow with phone OTP verification and resume/certificate uploads.',
        deliverables: 'Registration UI, secure backend endpoints, cloud storage integration',
        priority: 'High',
        included: true,
      },
      {
        sno: 2,
        name: 'Employer Job Posting, Filtering & Candidate Application Management System',
        description: 'Dashboard for employers to create job listings, review applicants, and schedule interviews.',
        deliverables: 'Employer dashboard, applicant management workflow, email notifications',
        priority: 'High',
        included: true,
      },
      {
        sno: 3,
        name: 'Admin Governance, Role-Based Access Control & Real-Time Activity Monitoring',
        description: 'Super-admin panel for content moderation, employer verification, and dispute resolution.',
        deliverables: 'Admin console, RBAC middleware, audit log viewer',
        priority: 'Critical',
        included: true,
      },
    ],

    payment_milestones: [
      {
        name: 'Milestone 1 — Core Backend, Database Schema & Authentication Architecture',
        trigger: 'Completion of database schemas, user authentication APIs, and cloud environment deployment with test accounts.',
        amount_minor: 900000, // ₹9,000.00
        due_date: '2026-04-15',
      },
      {
        name: 'Milestone 2 — Web Frontend, Employer Portal, UAT Sign-Off & Final Production Handover',
        trigger: 'Full delivery of responsive client portal, verification of all features, and handover of administrative credentials.',
        amount_minor: 900000, // ₹9,000.00
        due_date: '2026-05-01',
      },
    ],
  })).agreement;

  // 4. Verify Preview Endpoint response and Canonical HTML
  const prev = client.ok(await client.json('GET', `/api/marketing/software-agreements/${refContract.id}/preview`));
  assert.ok(prev.snapshot);
  assert.ok(prev.html);
  assert.ok(prev.logoDataUri);
  assert.ok(prev.logoDataUri.startsWith('data:image/png;base64,'));

  // Centered logo in HTML
  assert.ok(prev.html.includes('class="nc-logo-wrap"'));
  assert.ok(prev.html.includes('class="nc-logo-img"'));
  assert.ok(prev.html.includes(prev.logoDataUri));

  // Canonical 10 Sections in HTML
  assert.ok(prev.html.includes('SECTION 1: PARTIES TO THE AGREEMENT'));
  assert.ok(prev.html.includes('SECTION 2: PROJECT &amp; SERVICE DETAILS'));
  assert.ok(prev.html.includes('SECTION 3: REQUIREMENTS &amp; FEATURE SCOPE (SCHEDULE A)'));
  assert.ok(prev.html.includes('SECTION 4: PROJECT PRICING &amp; GST CALCULATIONS'));
  assert.ok(prev.html.includes('SECTION 5: PAYMENT TERMS &amp; MILESTONES'));
  assert.ok(prev.html.includes('SECTION 6: DEVELOPMENT TIMELINE'));
  assert.ok(prev.html.includes('SECTION 7: THREE MONTHS FREE SUPPORT &amp; POST-SUPPORT TERMS'));
  assert.ok(prev.html.includes('SECTION 8: MONTHLY MAINTENANCE PLAN'));
  assert.ok(prev.html.includes('SECTION 9: TERMS AND CONDITIONS'));
  assert.ok(prev.html.includes('SECTION 10: ACCEPTANCE &amp; EXECUTION'));

  // Commercial / Financial terms verification for GST-inclusive ₹20,000
  assert.equal(prev.snapshot.financials.pricing_mode, 'INCLUSIVE');
  assert.equal(prev.snapshot.financials.final_amount_minor, 2000000); // ₹20,000.00
  assert.equal(prev.snapshot.financials.advance_amount_minor, 200000); // ₹2,000.00 (10%)
  assert.equal(prev.snapshot.financials.remaining_balance_minor, 1800000); // ₹18,000.00
  assert.equal(prev.snapshot.financials.taxable_amount_minor, 1694915); // ₹16,949.15
  assert.equal(prev.snapshot.financials.cgst_minor, 152542); // ₹1,525.42
  assert.equal(prev.snapshot.financials.sgst_minor, 152543); // ₹1,525.43
  assert.equal(prev.snapshot.financials.total_gst_minor, 305085); // ₹3,050.85
  assert.equal(prev.snapshot.financials.is_milestones_reconciled, true);

  // Formatted amounts in HTML
  assert.ok(prev.html.includes('₹20,000.00'));
  assert.ok(prev.html.includes('₹2,000.00'));
  assert.ok(prev.html.includes('₹18,000.00'));
  assert.ok(prev.html.includes('₹16,949.15'));
  assert.ok(prev.html.includes('₹1,525.42'));
  assert.ok(prev.html.includes('₹1,525.43'));
  assert.ok(prev.html.includes('₹3,050.85'));
  assert.ok(prev.html.includes('₹5,000.00'));
  assert.ok(prev.html.includes('₹2,000.00 per month'));

  // 5. Standalone HTML Endpoint (GET /api/marketing/software-agreements/:id/html)
  const htmlRes = await client.raw('GET', `/api/marketing/software-agreements/${refContract.id}/html`);
  assert.equal(htmlRes.status, 200);
  assert.ok(htmlRes.headers.get('content-type').includes('text/html'));
  assert.ok(htmlRes.headers.get('content-disposition').includes('Software_Development_Agreement.html'));
  const htmlText = await htmlRes.text();
  assert.ok(htmlText.includes('<!DOCTYPE html>'));
  assert.ok(htmlText.includes('nc-contract-doc'));
  assert.ok(htmlText.includes('@page {'));

  // 6. PDF Generation & Parity Verification
  const genRes = client.ok(await client.json('POST', `/api/marketing/software-agreements/${refContract.id}/generate-pdf`));
  assert.equal(genRes.success, true);

  const pdfRes = await client.binary('GET', `/api/marketing/software-agreements/${refContract.id}/pdf`);
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');

  const pdfPages = extractPdf(pdfRes.bytes);
  assert.ok(pdfPages.length >= 3 && pdfPages.length <= 5, `Expected 3-5 pages, got ${pdfPages.length}`);

  const pdfFullText = pdfPages.map(p => p.text.join('\n')).join('\n');

  // All 10 sections present in PDF text
  assert.ok(pdfFullText.includes('SECTION 1: PARTIES TO THE AGREEMENT'));
  assert.ok(pdfFullText.includes('SECTION 2: PROJECT & SERVICE DETAILS'));
  assert.ok(pdfFullText.includes('SECTION 3: REQUIREMENTS & FEATURE SCOPE (SCHEDULE A)'));
  assert.ok(pdfFullText.includes('SECTION 4: PROJECT PRICING & GST CALCULATIONS'));
  assert.ok(pdfFullText.includes('SECTION 5: PAYMENT TERMS & MILESTONES'));
  assert.ok(pdfFullText.includes('SECTION 6: DEVELOPMENT TIMELINE'));
  assert.ok(pdfFullText.includes('SECTION 7: THREE MONTHS FREE SUPPORT & POST-SUPPORT TERMS'));
  assert.ok(pdfFullText.includes('SECTION 8: MONTHLY MAINTENANCE PLAN'));
  assert.ok(pdfFullText.includes('SECTION 9: TERMS AND CONDITIONS'));
  assert.ok(pdfFullText.includes('SECTION 10: ACCEPTANCE & EXECUTION'));

  // Identical business numbers in PDF
  assert.ok(pdfFullText.includes('20,000.00'));
  assert.ok(pdfFullText.includes('2,000.00'));
  assert.ok(pdfFullText.includes('18,000.00'));
  assert.ok(pdfFullText.includes('16,949.15'));
  assert.ok(pdfFullText.includes('1,525.42'));
  assert.ok(pdfFullText.includes('1,525.43'));
  assert.ok(pdfFullText.includes('3,050.85'));
  assert.ok(pdfFullText.includes('5,000.00'));

  // Signatures on final page and page count
  const lastPageText = pdfPages[pdfPages.length - 1].text.join('\n');
  assert.ok(lastPageText.includes('FOR NEXTORA CREATIONS:'));
  assert.ok(lastPageText.includes('FOR CLIENT / CUSTOMER:'));
  assert.ok(lastPageText.includes('SECTION 10: ACCEPTANCE & EXECUTION'));
  assert.ok(lastPageText.includes(`Page ${pdfPages.length} of ${pdfPages.length}`));

  // Legal footnote present on final page without clipping
  assert.ok(lastPageText.includes('Both parties must execute this Agreement via verified signature'));
});

test('11. Section-Aware Pagination: Reference contract layout, repeat table headers, orphan prevention, and multi-page continuity', async () => {
  const client = await withAdmin(11);

  // Reference contract fixture (Sevajobs / NC/SDA/2026-27/0001)
  const refAgr = client.ok(await client.json('POST', '/api/marketing/software-agreements', {
    client_name: 'Raghava',
    client_legal_name: 'Sevajobs',
    contact_person: 'Raghava',
    client_email: 'raghava@gmail.com',
    client_phone: '7674981970',
    billing_address: 'Nizamabad, ambedkar colony',
    city: 'Nizamabad',
    state_code: '36', // Telangana
    postal_code: '503001',
    country: 'India',
    client_gstin: '',
    client_pan: '',
    client_business_type: 'private limited',
    signatory_name: 'Raghava',
    signatory_designation: 'Authorized Representative',
    title: 'Seva jobs project',
    service_category: 'Web application development',
    service_description: 'project developmenet',
    business_objectives: 'project developmenet',
    start_date: '2026-10-25',
    estimated_completion_date: '2026-11-25',
    development_duration: '1 Month',
    deployment_target: 'Cloud VPS / Docker / Client Infrastructure',
    hosting_responsibility: 'Client provides and funds hosting; Developer configures deployment',
    client_assets_access: 'Branding logos, domain DNS access, third-party API keys, and content',
    acceptance_criteria: '7 business days User Acceptance Testing window upon staging deployment',
    pricing_mode: 'INCLUSIVE',
    base_price_minor: 2000000, // ₹20,000.00
    gst_rate_bp: 1800,
    gst_treatment: 'TAXABLE',
    discount_minor: 0,
    additional_charges_minor: 0,
    advance_percentage_bp: 1000, // 10.00%
    features: [
      {
        sno: 1,
        name: 'System Architecture & Database Design',
        description: 'Design of database schemas, technical architecture, and system specifications.',
        deliverables: 'Entity Relationship Diagram, Architecture Documentation',
        priority: 'High',
        included: true,
        notes: '',
      },
      {
        sno: 2,
        name: 'Core Application Development',
        description: 'Implementation of primary business logic, functional workflows, and data processing.',
        deliverables: 'Functional software modules in staging environment',
        priority: 'High',
        included: true,
        notes: '',
      },
      {
        sno: 3,
        name: 'Responsive User Interface & Portal',
        description: 'Front-end interface optimized for desktop, tablet, and mobile browsers.',
        deliverables: 'Web / desktop interface screens and components',
        priority: 'Normal',
        included: true,
        notes: '',
      },
      {
        sno: 4,
        name: 'API & Third-Party Service Integration',
        description: 'Integration of payment gateway, external notifications, and third-party APIs.',
        deliverables: 'Configured webhook handlers and integrated API clients',
        priority: 'Normal',
        included: true,
        notes: '',
      },
      {
        sno: 5,
        name: 'Deployment, Testing & Handover',
        description: 'End-to-end testing, user acceptance review, and production deployment configuration.',
        deliverables: 'Deployed application, admin credentials, source code repository',
        priority: 'Critical',
        included: true,
        notes: '',
      },
    ],
    included_services: 'Software engineering, architecture, code reviews, staging deployment, 3 months complimentary support.',
    excluded_services: 'Paid third-party API usage, cloud hosting fees, domain renewals, graphic design creation.',
    client_responsibilities: 'Timely feedback within 5 business days, providing credentials and content assets.',
    third_party_dependencies: 'External payment processor verification, domain registrar access, SMS gateway.',
    payment_milestones: [
      {
        name: 'Milestone 1: Project Kickoff & Architecture Sign-Off',
        trigger: 'Approval of system specifications and database design',
        due_date: '',
        amount_minor: 0,
      },
      {
        name: 'Milestone 2: Core Development & Staging Release',
        trigger: 'Deployment of core functional modules to staging environment',
        due_date: '',
        amount_minor: 0,
      },
      {
        name: 'Milestone 3: Final Acceptance & Production Handover',
        trigger: 'Successful UAT sign-off, production deployment, and credential handover',
        due_date: '',
        amount_minor: 0,
      },
    ],
    free_support_months: 3,
    support_start_date: '2026-11-25',
    support_end_date: '2027-02-25',
    maintenance_included: false,
    maintenance_rate_minor: 200000,
    nextora_signatory_name: 'Authorized Signatory',
    nextora_signatory_title: 'Managing Partner',
    client_signatory_name: 'Raghava',
    client_signatory_title: 'Authorized Representative',
  })).agreement;

  // A. Generate and Download PDF
  const genRes = client.ok(await client.json('POST', `/api/marketing/software-agreements/${refAgr.id}/generate-pdf`));
  assert.equal(genRes.success, true);

  const pdfRes = await client.binary('GET', `/api/marketing/software-agreements/${refAgr.id}/pdf`);
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.bytes.subarray(0, 5).toString(), '%PDF-');

  // B. Page-by-page text and section inspection
  const pages = extractPdf(pdfRes.bytes);
  assert.equal(pages.length, 4, 'Reference contract must span exactly 4 pages');

  const p1Norm = pages[0].text.join('\n').replace(/\s+/g, ' ');
  const p2Norm = pages[1].text.join('\n').replace(/\s+/g, ' ');
  const p3Norm = pages[2].text.join('\n').replace(/\s+/g, ' ');
  const p4Norm = pages[3].text.join('\n').replace(/\s+/g, ' ');

  // Scenario 1: Section 3 starts on page 2 in the reference contract
  assert.ok(p2Norm.includes('SECTION 3: REQUIREMENTS & FEATURE SCOPE (SCHEDULE A)'), 'Section 3 heading must be on page 2');
  assert.ok(!p1Norm.includes('SECTION 3: REQUIREMENTS & FEATURE SCOPE (SCHEDULE A)'), 'Section 3 heading must NOT be on page 1');

  // Scenario 2: Section 3 does not leave its first feature row isolated on page 1
  assert.ok(!p1Norm.includes('System Architecture & Database Design'), 'First feature row must NOT be on page 1');
  assert.ok(p2Norm.includes('System Architecture & Database Design'), 'First feature row must appear on page 2 with Section 3');
  assert.ok(p2Norm.includes('Core Application Development'), 'Row 2 on page 2');
  assert.ok(p2Norm.includes('Responsive User Interface & Portal'), 'Row 3 on page 2');
  assert.ok(p2Norm.includes('API & Third-Party Service Integration'), 'Row 4 on page 2');
  assert.ok(p2Norm.includes('Deployment, Testing & Handover'), 'Row 5 on page 2');
  assert.ok(p2Norm.includes('Included Services: Software engineering'), 'Scope notes on page 2');

  // Page 1 contains Section 1 and Section 2 cleanly
  assert.ok(p1Norm.includes('SECTION 1: PARTIES TO THE AGREEMENT'));
  assert.ok(p1Norm.includes('SECTION 2: PROJECT & SERVICE DETAILS'));
  assert.ok(p1Norm.includes('Acceptance Criteria: 7 business days'));

  // Page 2 contains Section 4, 5, 6
  assert.ok(p2Norm.includes('SECTION 4: PROJECT PRICING & GST CALCULATIONS'));
  assert.ok(p2Norm.includes('Taxable Amount: ₹16,949.15'));
  assert.ok(p2Norm.includes('Final Project Amount: ₹20,000.00'));
  assert.ok(p2Norm.includes('SECTION 5: PAYMENT TERMS & MILESTONES'));
  assert.ok(p2Norm.includes('Milestone 1: Project Kickoff'));
  assert.ok(p2Norm.includes('SECTION 6: DEVELOPMENT TIMELINE'));
  assert.ok(!p2Norm.includes('SECTION 8: MONTHLY MAINTENANCE PLAN'), 'Section 8 must NOT start on page 2');

  // Scenario 3 & 4: Section 8 heading and introductory paragraph remain together on page 3
  assert.ok(p3Norm.includes('SECTION 7: THREE MONTHS FREE SUPPORT & POST-SUPPORT TERMS'));
  assert.ok(p3Norm.includes('SECTION 8: MONTHLY MAINTENANCE PLAN'), 'Section 8 heading must be on page 3');
  assert.ok(p3Norm.includes('Ongoing monthly maintenance is available at the standard rate of ₹2,000.00 per month'), 'Section 8 text must be on page 3 with its heading');
  assert.ok(p3Norm.includes('SECTION 9: TERMS AND CONDITIONS'), 'Section 9 heading starts on page 3');

  // Scenario 7: Section 9 remains readable across multiple pages (pages 3 and 4)
  assert.ok(p3Norm.includes('Intellectual Property Ownership'));
  assert.ok(p3Norm.includes('Confidentiality & Data Protection'));
  assert.ok(p4Norm.includes('Suspension & Termination'));
  assert.ok(p4Norm.includes('Limitation of Liability'));
  assert.ok(p4Norm.includes('Dispute Resolution & Governing Law'));

  // Scenario 8: Signature blocks not split awkwardly, on page 4 with Section 10
  assert.ok(p4Norm.includes('SECTION 10: ACCEPTANCE & EXECUTION'));
  assert.ok(p4Norm.includes('FOR NEXTORA CREATIONS:'));
  assert.ok(p4Norm.includes('FOR CLIENT / CUSTOMER:'));
  assert.ok(p4Norm.includes('Authorized Signatory'));
  assert.ok(p4Norm.includes('Raghava'));
  assert.ok(p4Norm.includes('Note: Generating or downloading this PDF document does not constitute formal execution'));

  // Scenario 9 & 10: Footers and Page Numbers across all 4 pages
  assert.ok(p1Norm.includes('Page 1 of 4'));
  assert.ok(p2Norm.includes('Page 2 of 4'));
  assert.ok(p3Norm.includes('Page 3 of 4'));
  assert.ok(p4Norm.includes('Page 4 of 4'));

  // Scenario 12: GST calculations intact
  const preview = client.ok(await client.json('GET', `/api/marketing/software-agreements/${refAgr.id}/preview`));
  assert.equal(preview.snapshot.financials.pricing_mode, 'INCLUSIVE');
  assert.equal(preview.snapshot.financials.final_amount_minor, 2000000);
  assert.equal(preview.snapshot.financials.advance_amount_minor, 200000);
  assert.equal(preview.snapshot.financials.remaining_balance_minor, 1800000);
  assert.equal(preview.snapshot.financials.taxable_amount_minor, 1694915);
  assert.equal(preview.snapshot.financials.total_gst_minor, 305085);

  // Scenario 5 & 6: Long table with 14 features spans multiple pages and repeats table headers
  const manyFeatures = Array.from({ length: 14 }, (_, i) => ({
    sno: i + 1,
    name: `Enterprise Scalability Module ${i + 1}`,
    description: `Detailed technical description and architecture for scalability module ${i + 1} with high throughput.`,
    deliverables: `Module code, test suites, API docs ${i + 1}`,
    priority: i === 0 ? 'Critical' : 'Normal',
    included: true,
    notes: `Acceptance criteria specification ${i + 1}`,
  }));

  const longSwAgr = client.ok(await client.json('POST', '/api/marketing/software-agreements', sampleSoftwareContract({
    title: 'High-Volume Enterprise Scale Software Agreement',
    features: manyFeatures,
  }))).agreement;

  const longPdfRes = await client.binary('GET', `/api/marketing/software-agreements/${longSwAgr.id}/pdf`);
  const longPages = extractPdf(longPdfRes.bytes);
  assert.ok(longPages.length >= 4, 'Long contract spans multiple pages');

  // Verify table header repetition on continuation pages where feature table continues
  const continuationPageWithFeatures = longPages.find((p, idx) => {
    if (idx === 0) return false;
    const txt = p.text.join('\n');
    return txt.includes('Enterprise Scalability Module') && !txt.includes('SECTION 3: REQUIREMENTS');
  });
  if (continuationPageWithFeatures) {
    const contText = continuationPageWithFeatures.text.join('\n');
    assert.ok(contText.includes('Feature Name'), 'Table header column "Feature Name" must repeat on continuation page');
    assert.ok(contText.includes('Deliverables'), 'Table header column "Deliverables" must repeat on continuation page');
    assert.ok(contText.includes('Priority'), 'Table header column "Priority" must repeat on continuation page');
  }
});
