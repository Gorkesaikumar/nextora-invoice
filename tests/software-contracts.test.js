import test from 'node:test';
import assert from 'node:assert/strict';
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
