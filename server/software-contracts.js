import { randomUUID } from 'node:crypto';
import { assert, HttpError, uuid, basisPoints, minorUnits } from './domain.js';
import { audit } from './audit.js';
import { allocateNumber, previewNumber } from './numbering.js';
import { roundDiv, percentOf, BP_PER_UNIT, splitTax, toMinor } from './money.js';
import { formatMinor, formatDate } from './words.js';
import { supplyTypeFor, supplyTypeLabel, gstinChecksumValid, gstinStateCode } from './gst.js';
import { brandLogoBytes } from './marketing.js';
import { requireWriter } from './service.js';

/* ---------------------------------------------------- Standard Clauses */

export const DEFAULT_SERVICE_CATEGORIES = Object.freeze([
  'Custom software development',
  'Website development',
  'Web application development',
  'Mobile application development',
  'Desktop application development',
  'API development and integration',
  'E-commerce development',
  'SaaS development',
  'Automation and AI solutions',
  'Existing application enhancement',
  'Other custom services',
]);

export const DEFAULT_SOFTWARE_CONTRACT_CLAUSES = Object.freeze({
  section_1_parties: `This Software Development Services Agreement ("Agreement") is entered into by and between:
1. NEXTORA CREATIONS, a technology and digital solutions enterprise having its registered operations in Telangana, India (hereinafter referred to as the "Developer" or "Service Provider", which expression shall include its successors and permitted assigns); and
2. The Client specified in Section 1 of this Agreement (hereinafter referred to as the "Client", which expression shall include its legal representatives, successors, and permitted assigns).
Both parties are collectively referred to as the "Parties" and individually as a "Party". This Agreement sets forth the terms and conditions under which the Developer shall design, develop, test, and deliver the software solution described herein.`,

  section_2_scope_of_work: `1. Agreed Deliverables: The Developer agrees to deliver the software modules, features, and technical assets specifically itemized in the Requirements & Feature Scope (Schedule A) of this Agreement.
2. Scope Exclusivity: Only those features, integrations, and services explicitly marked as "Included" shall form part of this engagement. Any capability, platform, integration, data migration, or third-party service not expressly identified in Schedule A is excluded from the project scope.
3. Pre-Approval Requirement: The feature scope and acceptance criteria documented herein represent the mutual agreement of the Parties upon project commencement. Features or deliverables requested subsequent to contract execution must follow the formal Change Request process defined herein.`,

  section_3_requirements_approvals: `1. Client Obligations & Prerequisites: Timely performance by the Developer is conditioned upon the Client providing:
   a. Comprehensive, finalized, and approved functional requirements and design direction;
   b. Necessary branding assets, logos, graphic design collateral, written copy, and multimedia assets;
   c. Operational third-party credentials, developer access keys, domain registrar access, and server/cloud hosting credentials;
   d. Prompt written feedback and technical sign-offs.
2. Review Window: The Client agrees to review deliverables and provide written feedback or approval within five (5) business days of submission. If no feedback is provided within this window, the deliverable shall be deemed accepted.
3. Dependency Delays: The Developer shall not be liable for delivery delays or project suspension resulting from incomplete requirements, unavailable third-party APIs, or delayed Client feedback.`,

  section_4_development_schedule: `1. Estimated Timeline: The estimated development timeline specified in this Agreement is approximately one (1) month from the satisfaction of all Project Prerequisites, unless a different timeline has been mutually configured.
2. Prerequisites for Commencement: Work shall commence only after:
   a. Execution of this Agreement by authorized representatives of both Parties;
   b. Receipt of the agreed advance payment in cleared funds;
   c. Completion of requirements sign-off and receipt of all required Client credentials and assets.
3. Timeline Adjustments: The estimated delivery date is a good-faith operational estimate. Delays caused by scope changes, third-party platform limitations, infrastructure failures, delayed Client approvals, or force majeure events shall automatically extend the delivery schedule proportionally.`,

  section_5_payment_obligations: `1. Advance Payment: The Client shall pay an advance payment of 10% of the agreed project price (or as configured herein) upon contract execution. Development shall not commence until the advance is received.
2. Milestone Payments: The remaining balance shall be payable upon satisfaction of agreed milestone events as defined in the Payment Milestones schedule.
3. Taxes: Applicable Goods and Services Tax (GST) shall be charged and accounted for in accordance with prevailing Indian tax regulations and the agreed pricing mode.
4. Due Conditions & Invoicing: Invoices shall be issued upon achievement of each milestone and are due within the payment due days specified herein.
5. Delayed Payment & Work Suspension: Unpaid milestone invoices exceeding seven (7) business days past due date may result in immediate suspension of development, deployment, or support activities until all outstanding amounts are settled.
6. Handover Condition: Full source code, deployment assets, production credentials, and administrative handover shall occur only upon receipt of 100% of the agreed project price in cleared funds.`,

  section_6_change_requests: `1. Scope Changes: Any modification, addition, deletion, or substantial enhancement to the agreed Feature Scope shall constitute a "Change Request".
2. Evaluation Process: Upon receipt of a written Change Request from the Client, the Developer shall assess technical feasibility, estimate additional costs, and determine timeline impacts.
3. Written Approval: Work on requested changes shall not begin until both Parties have executed a written Scope Amendment or approved Change Order specifying the revised fee and delivery timeline.`,

  section_7_testing_acceptance: `1. Acceptance Testing: Upon notification of milestone completion or release candidate deployment, the Client shall conduct User Acceptance Testing (UAT) in the designated staging environment within seven (7) business days.
2. Defect Reporting: If the deliverable fails to conform to the approved functional specification, the Client shall submit a detailed, reproducible written defect report.
3. Rectification: The Developer shall promptly investigate and correct confirmed reproducible defects that deviate from the agreed specification at no additional charge.
4. Deemed Acceptance: If the Client utilizes the software in a production or live commercial environment, or fails to report defects within the review window, the software shall be conclusively deemed accepted.`,

  section_8_free_support: `1. Three Months Complimentary Support: The Developer provides a complimentary support period of three (3) months commencing from the agreed Support Commencement Date (handover or deployment).
2. Covered Support Scope:
   a. Correction of reproducible bugs and technical errors in delivered features;
   b. Assistance with the intended functionality of delivered components;
   c. Minor corrective configuration adjustments required to align with the approved specification.
3. Exclusions from Free Support: Complimentary support strictly excludes:
   a. New modules, material enhancements, or new third-party integrations;
   b. Issues arising from Client modifications, unauthorized server configuration changes, or third-party API deprecations;
   c. Data recovery, migration, or infrastructure restoration resulting from external factors.
4. Distinction Between Fixes and Features: Bug fixes address non-conformance with approved specifications. Requests for new fields, changed workflows, or new reports constitute feature requests subject to Section 9.`,

  section_9_paid_features: `1. Post-Support Feature Rate: Following expiry of the three-month free support period (or for new modules during the project), new feature requests shall be billed at the standard rate of ₹5,000 per approved feature (exclusive/inclusive of GST as configured), subject to technical scope evaluation.
2. Written Scope: Each feature request requires a written specification confirmed by the Developer.
3. Complex Features: Major architectural changes, complex multi-system integrations, mobile application rewrites, or payment gateway overhauls may require a bespoke quotation rather than the standard per-feature rate.
4. Authorization: Development shall commence only after the Client approves the written feature quotation and satisfies advance payment conditions.`,

  section_10_maintenance: `1. Optional Ongoing Maintenance: The Developer offers an ongoing maintenance plan at the default rate of ₹2,000 per month (plus applicable GST), activated only upon written opt-in by the Client.
2. Covered Maintenance Scope:
   a. Routine application health and uptime monitoring;
   b. Compatible security patches and dependency updates where technically feasible;
   c. Basic troubleshooting of covered application components;
   d. Periodic database backup verification assistance (subject to hosting arrangements).
3. Maintenance Exclusions: The monthly maintenance fee covers operational care and strictly excludes new feature development, major redesigns, paid hosting costs, cloud subscriptions, domain renewals, and third-party license fees.
4. Billing & Cancellation: Maintenance is billed periodically in advance. Either Party may cancel ongoing maintenance with thirty (30) days written notice.`,

  section_11_intellectual_property: `1. Project Deliverables Ownership: Upon full and final settlement of all invoiced fees and applicable taxes, the intellectual property rights in project-specific custom code created exclusively for the Client shall transfer to the Client.
2. Developer Pre-Existing IP: The Developer retains exclusive ownership of all pre-existing software frameworks, libraries, proprietary utilities, architectural designs, algorithms, developer tools, and reusable components utilized in building the solution. The Client is granted a perpetual, non-exclusive, royalty-free license to use such pre-existing components as integrated within the deliverable software.
3. Third-Party & Open Source: Third-party software and open-source libraries remain subject to their respective licenses.`,

  section_12_confidentiality: `1. Confidential Information: Each Party agrees to preserve the confidentiality of all proprietary, technical, and commercial information disclosed by the other Party during the engagement.
2. Standard of Care: The Developer shall protect Client access keys, database credentials, and business data using reasonable industry-standard administrative and technical safeguards.
3. Exceptions: Confidentiality obligations do not apply to information that is publicly known, already known to the recipient, independently developed, or required to be disclosed by applicable law or judicial process.`,

  section_13_third_party_services: `1. Independent Services: The Client acknowledges that hosting infrastructure (AWS, DigitalOcean, Hetzner, etc.), domain names, SSL certificates, external SMS/email gateways, payment processor accounts (Razorpay, Stripe, Cashfree), and third-party APIs are independent external services.
2. Client Responsibility: The Client shall be directly responsible for all recurring subscription fees, licensing costs, usage limits, and account maintenance for such third-party providers unless otherwise agreed in writing.
3. Third-Party Outages: The Developer assumes no liability for service interruptions, rate limits, or API policy changes initiated by external third-party service providers.`,

  section_14_security_backups: `1. Security Best Practices: The Developer implements commercially reasonable security practices during development, including password hashing, SQL injection mitigation, and basic authorization controls.
2. Production Backups: The Client is responsible for maintaining routine automated backups of production databases and hosted assets, unless a specific managed backup service has been contracted in writing with the Developer.
3. Warranties: No software system is inherently impervious to all vulnerabilities or cyber threats; the Developer does not warrant that the software will be entirely uninterrupted or error-free under malicious attack.`,

  section_15_suspension_termination: `1. Termination for Convenience: Either Party may terminate this Agreement prior to project completion by providing fourteen (14) days prior written notice.
2. Termination for Material Breach: Either Party may terminate immediately if the other Party commits a material breach and fails to cure such breach within ten (10) days of receiving written notice.
3. Payment on Termination: Upon termination, the Client shall immediately pay for all work completed, milestone progress achieved, and approved expenses incurred up to the effective termination date.
4. Handover of Deliverables: Paid deliverables completed up to the termination date shall be delivered to the Client; work in progress that has not been paid for remains the property of the Developer.
5. Non-Refundable Advance: The initial advance payment represents project setup, discovery, resource allocation, and technical onboarding and is non-refundable once development has commenced.`,

  section_16_limitation_liability: `1. Consequential Damages Waiver: To the maximum extent permitted by applicable law, neither Party shall be liable for indirect, incidental, punitive, special, or consequential damages, including loss of profits, revenue, data, business goodwill, or commercial opportunities.
2. Aggregate Liability Cap: The total cumulative liability of the Developer arising out of or related to this Agreement, whether in contract, tort (including negligence), or otherwise, shall not exceed the total project fees actually received by the Developer from the Client under this specific Agreement.`,

  section_17_dispute_resolution: `1. Amicable Settlement: In the event of any dispute or controversy arising out of or in connection with this Agreement, the Parties shall first endeavor to resolve the dispute through good-faith executive consultation within fifteen (15) business days.
2. Arbitration / Jurisdiction: If unresolved, disputes shall be referred to arbitration in accordance with the Arbitration and Conciliation Act, 1996, before a sole arbitrator mutually appointed by the Parties. The seat and venue of arbitration shall be Hyderabad, Telangana, India. The courts having jurisdiction over Hyderabad, Telangana shall have exclusive jurisdiction over any legal proceedings arising hereunder.`,

  section_18_signatures: `IN WITNESS WHEREOF, the Parties hereto have caused this Software Development Services Agreement to be duly executed by their authorized representatives as of the date(s) set forth below. Each signatory warrants that they possess full power and legal authority to bind their respective organization.
Generating or downloading this document in draft form does not constitute an executed contract; both Parties must formally sign to execute this Agreement.`,
});

/* ----------------------------------------------- Financial Calculations */

export function calculateSoftwareContractFinancials({
  base_price_minor = 0,
  pricing_mode = 'EXCLUSIVE',
  gst_rate_bp = 1800,
  gst_treatment = 'TAXABLE',
  discount_minor = 0,
  additional_charges_minor = 0,
  supplier_state_code = '36', // Telangana
  client_state_code = '36',
  advance_percentage_bp = 1000, // 10.00%
  payment_milestones = [],
}) {
  const mode = ['EXCLUSIVE', 'INCLUSIVE'].includes(pricing_mode) ? pricing_mode : 'EXCLUSIVE';
  const rateBp = Math.max(0, Number(gst_rate_bp || 0));
  const isTaxable = gst_treatment === 'TAXABLE' && rateBp > 0;

  const baseMinor = Math.max(0, Number(base_price_minor || 0));
  const discountMinor = Math.min(Math.max(0, Number(discount_minor || 0)), baseMinor);
  const addMinor = Math.max(0, Number(additional_charges_minor || 0));

  let taxableMinor = 0;
  let totalGstMinor = 0;
  let finalAmountMinor = 0;

  if (mode === 'INCLUSIVE') {
    // Entered base price already includes GST
    const grossAfterDiscount = baseMinor - discountMinor + addMinor;
    if (isTaxable) {
      taxableMinor = roundDiv(grossAfterDiscount * BP_PER_UNIT, BP_PER_UNIT + rateBp);
      totalGstMinor = grossAfterDiscount - taxableMinor;
      finalAmountMinor = grossAfterDiscount;
    } else {
      taxableMinor = grossAfterDiscount;
      totalGstMinor = 0;
      finalAmountMinor = grossAfterDiscount;
    }
  } else {
    // EXCLUSIVE mode: GST is added on top of taxable amount
    const netTaxable = baseMinor - discountMinor + addMinor;
    taxableMinor = netTaxable;
    if (isTaxable) {
      totalGstMinor = percentOf(taxableMinor, rateBp);
    } else {
      totalGstMinor = 0;
    }
    finalAmountMinor = taxableMinor + totalGstMinor;
  }

  // Supply classification
  let supplyType = 'INTRA';
  try {
    supplyType = supplyTypeFor(supplier_state_code || '36', client_state_code || '36');
  } catch {
    supplyType = (supplier_state_code && client_state_code && supplier_state_code === client_state_code) ? 'INTRA' : 'INTER';
  }

  const taxSplit = splitTax(totalGstMinor, supplyType);

  // Advance calculation: Default 10% of base price before GST
  const advBp = Math.max(0, Math.min(10000, Number(advance_percentage_bp ?? 1000)));
  // If exclusive mode, advance on base price before tax:
  let advanceAmountMinor = 0;
  if (mode === 'EXCLUSIVE') {
    // 10% of agreed project price before applicable taxes
    advanceAmountMinor = roundDiv(baseMinor * advBp, BP_PER_UNIT);
  } else {
    // In inclusive mode, 10% of gross
    advanceAmountMinor = roundDiv(finalAmountMinor * advBp, BP_PER_UNIT);
  }

  const remainingBalanceMinor = Math.max(0, finalAmountMinor - advanceAmountMinor);

  // Validate and sum payment milestones
  const milestones = Array.isArray(payment_milestones) ? payment_milestones : [];
  const milestonesTotalMinor = milestones.reduce((acc, m) => acc + Math.max(0, Number(m.amount_minor || 0)), 0);
  const milestonesBalanceDifference = remainingBalanceMinor - milestonesTotalMinor;
  const isMilestonesReconciled = milestones.length === 0 || milestonesBalanceDifference === 0;

  return {
    pricing_mode: mode,
    base_price_minor: baseMinor,
    discount_minor: discountMinor,
    additional_charges_minor: addMinor,
    taxable_amount_minor: taxableMinor,
    gst_rate_bp: rateBp,
    gst_rate_percent: (rateBp / 100).toFixed(2),
    gst_treatment,
    is_taxable: isTaxable,
    supply_type: supplyType,
    supply_type_label: supplyTypeLabel(supplyType),
    cgst_minor: taxSplit.cgst_minor,
    sgst_minor: taxSplit.sgst_minor,
    igst_minor: taxSplit.igst_minor,
    total_gst_minor: totalGstMinor,
    final_amount_minor: finalAmountMinor,
    advance_percentage_bp: advBp,
    advance_percentage_label: (advBp / 100).toFixed(2) + '%',
    advance_amount_minor: advanceAmountMinor,
    remaining_balance_minor: remainingBalanceMinor,
    milestones_total_minor: milestonesTotalMinor,
    milestones_difference_minor: milestonesBalanceDifference,
    is_milestones_reconciled: isMilestonesReconciled,
  };
}

export function validateMilestonesReconciliation(remainingBalanceMinor, milestones = []) {
  if (!milestones.length) return true;
  const total = milestones.reduce((sum, m) => sum + Math.max(0, Number(m.amount_minor || 0)), 0);
  return total === remainingBalanceMinor;
}

/* ---------------------------------------------------- Snapshot Builder */

export async function buildSoftwareContractSnapshot(db, agreementId) {
  const { rows } = await db.query(`
    SELECT a.*,
      c.name AS master_client_name,
      c.company_name AS master_company_name,
      c.gstin AS master_gstin,
      c.email AS master_email,
      c.phone AS master_phone
    FROM inv.software_agreements a
    LEFT JOIN inv.clients c ON c.id = a.client_id
    WHERE a.id = $1
  `, [agreementId]);

  assert(rows[0], 404, 'Software development agreement not found.', 'AGREEMENT_NOT_FOUND');
  const a = rows[0];

  const { rows: settingsRows } = await db.query('SELECT * FROM inv.business_settings WHERE id = true');
  const business = settingsRows[0] || {};

  const supplierStateCode = business.state_code || '36'; // Default Telangana 36
  const clientStateCode = a.state_code || '36';

  const financials = calculateSoftwareContractFinancials({
    base_price_minor: a.base_price_minor,
    pricing_mode: a.pricing_mode,
    gst_rate_bp: a.gst_rate_bp,
    gst_treatment: a.gst_treatment,
    discount_minor: a.discount_minor,
    additional_charges_minor: a.additional_charges_minor,
    supplier_state_code: supplierStateCode,
    client_state_code: clientStateCode,
    advance_percentage_bp: a.advance_percentage_bp,
    payment_milestones: typeof a.payment_milestones === 'string' ? JSON.parse(a.payment_milestones) : a.payment_milestones,
  });

  const customClauses = typeof a.custom_clauses === 'string'
    ? JSON.parse(a.custom_clauses || '{}')
    : (a.custom_clauses || {});

  const fullClauses = {
    ...DEFAULT_SOFTWARE_CONTRACT_CLAUSES,
    ...customClauses,
  };

  const features = typeof a.features === 'string' ? JSON.parse(a.features || '[]') : (a.features || []);
  const paymentMilestones = typeof a.payment_milestones === 'string' ? JSON.parse(a.payment_milestones || '[]') : (a.payment_milestones || []);
  const timelineMilestones = typeof a.timeline_milestones === 'string' ? JSON.parse(a.timeline_milestones || '[]') : (a.timeline_milestones || []);

  return {
    contract_type: 'SOFTWARE_DEVELOPMENT_SERVICES_AGREEMENT',
    contract_id: a.id,
    contract_number: a.contract_number,
    version: a.version,
    status: a.status,
    title: a.title,
    service_category: a.service_category === 'Other custom services' && a.service_category_custom
      ? a.service_category_custom
      : a.service_category,
    service_category_raw: a.service_category,
    service_category_custom: a.service_category_custom,
    branding_mode: a.branding_mode || 'COMPANY_ONLY',
    created_at: a.created_at,
    updated_at: a.updated_at,
    pdf_generated_at: a.pdf_generated_at,

    business: {
      business_name: business.business_name || 'Nextora Creations',
      legal_name: business.legal_name || 'Nextora Creations',
      trade_name: business.trade_name || 'Nextora Creations',
      address: business.address || 'Hyderabad, Telangana, India',
      state_code: supplierStateCode,
      country: business.country || 'India',
      gstin: business.gstin || '36JTAPK9167A1ZK',
      pan: business.pan || 'JTAPK9167A',
      email: business.email || 'support@nextoracreations.co.in',
      phone: business.phone || '7674981970',
      website: business.website || 'https://nextoracreations.co.in/',
      signatory_name: a.nextora_signatory_name || business.signatory_name || 'Authorized Signatory',
      signatory_title: a.nextora_signatory_title || business.signatory_title || 'Managing Partner',
      pdf_accent_color: business.pdf_accent_color || '#00AEEF',
    },

    client: {
      client_id: a.client_id,
      name: a.client_name,
      legal_name: a.client_legal_name || a.client_name,
      contact_person: a.contact_person,
      email: a.client_email,
      phone: a.client_phone,
      billing_address: a.billing_address,
      city: a.city,
      state_code: a.state_code,
      postal_code: a.postal_code,
      country: a.country || 'India',
      gstin: a.client_gstin,
      gstin_checksum_valid: a.client_gstin ? gstinChecksumValid(a.client_gstin) : null,
      pan: a.client_pan,
      business_type: a.client_business_type,
      signatory_name: a.client_signatory_name || a.signatory_name || a.contact_person || a.client_name,
      signatory_designation: a.client_signatory_title || a.signatory_designation || 'Authorized Representative',
    },

    project: {
      service_description: a.service_description,
      business_objectives: a.business_objectives,
      start_date: a.start_date,
      estimated_completion_date: a.estimated_completion_date,
      development_duration: a.development_duration || '1 Month',
      requirements_finalization_date: a.requirements_finalization_date,
      deployment_target: a.deployment_target,
      hosting_responsibility: a.hosting_responsibility,
      client_assets_access: a.client_assets_access,
      third_party_integrations: a.third_party_integrations,
      acceptance_criteria: a.acceptance_criteria,
      project_notes: a.project_notes,
    },

    scope: {
      features,
      included_services: a.included_services,
      excluded_services: a.excluded_services,
      client_responsibilities: a.client_responsibilities,
      third_party_dependencies: a.third_party_dependencies,
      technical_assumptions: a.technical_assumptions,
      scope_limitations: a.scope_limitations,
    },

    financials,

    milestones: {
      payment_milestones: paymentMilestones,
      payment_terms_notes: a.payment_terms_notes,
      timeline_milestones: timelineMilestones,
    },

    support_and_maintenance: {
      free_support_months: a.free_support_months ?? 3,
      support_start_date: a.support_start_date,
      support_end_date: a.support_end_date,
      support_scope: a.support_scope,
      support_reporting_process: a.support_reporting_process,
      post_support_feature_rate_minor: a.post_support_feature_rate_minor ?? 500000,
      post_support_feature_rate_formatted: formatMinor(a.post_support_feature_rate_minor ?? 500000),
      post_support_terms: a.post_support_terms,
      maintenance_included: Boolean(a.maintenance_included),
      maintenance_rate_minor: a.maintenance_rate_minor ?? 200000,
      maintenance_rate_formatted: formatMinor(a.maintenance_rate_minor ?? 200000),
      maintenance_start_date: a.maintenance_start_date,
      maintenance_frequency: a.maintenance_frequency || 'MONTHLY',
      maintenance_scope: a.maintenance_scope,
      maintenance_exclusions: a.maintenance_exclusions,
    },

    clauses: fullClauses,
    special_terms: a.special_terms,
  };
}

/* ------------------------------------------------ Agreement Management */

function normalizeAgreement(row) {
  if (!row) return row;
  return {
    ...row,
    maintenance_included: Boolean(row.maintenance_included),
  };
}

export async function listSoftwareAgreements(db, { clientId = null, status = '', search = '', page = 1, limit = 25 } = {}) {
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  const params = [];

  if (clientId) {
    params.push(clientId);
    conditions.push(`a.client_id = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }

  if (search.trim()) {
    params.push(`%${search.trim().replace(/[!%_]/g, '!$&')}%`);
    const p = params.length;
    conditions.push(`(a.contract_number ILIKE $${p} ESCAPE '!' OR a.title ILIKE $${p} ESCAPE '!' OR a.client_name ILIKE $${p} ESCAPE '!' OR a.service_category ILIKE $${p} ESCAPE '!')`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countSql = `
    SELECT count(*)::integer AS total
    FROM inv.software_agreements a
    ${whereClause}
  `;
  const total = (await db.query(countSql, params)).rows[0]?.total || 0;

  const dataSql = `
    SELECT a.*
    FROM inv.software_agreements a
    ${whereClause}
    ORDER BY a.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const { rows } = await db.query(dataSql, [...params, limit, offset]);

  return { agreements: rows.map(normalizeAgreement), total, page: Number(page), limit: Number(limit) };
}

export async function getSoftwareAgreement(db, id) {
  const { rows } = await db.query(`
    SELECT a.*,
      c.name AS master_client_name,
      c.company_name AS master_company_name,
      c.gstin AS master_gstin
    FROM inv.software_agreements a
    LEFT JOIN inv.clients c ON c.id = a.client_id
    WHERE a.id = $1
  `, [id]);
  assert(rows[0], 404, 'Software agreement not found.', 'AGREEMENT_NOT_FOUND');
  return normalizeAgreement(rows[0]);
}

export async function createSoftwareAgreement(db, actor, input) {
  assert(input.client_name?.trim(), 400, 'Client name is required.', 'VALIDATION_ERROR');
  assert(input.start_date, 400, 'Project start date is required.', 'VALIDATION_ERROR');

  const { rows: settingsRows } = await db.query('SELECT * FROM inv.business_settings WHERE id = true');
  const business = settingsRows[0] || {};
  const prefix = business.software_contract_prefix || 'NC/SDA';

  return db.transaction(async tx => {
    const allocated = await allocateNumber(tx, {
      docType: 'SOFTWARE_SERVICES_AGREEMENT',
      prefix,
      date: input.start_date || new Date().toISOString().slice(0, 10),
    });

    const id = randomUUID();

    const featuresJson = typeof input.features === 'string'
      ? input.features
      : JSON.stringify(input.features || []);

    const milestonesJson = typeof input.payment_milestones === 'string'
      ? input.payment_milestones
      : JSON.stringify(input.payment_milestones || []);

    const timelineJson = typeof input.timeline_milestones === 'string'
      ? input.timeline_milestones
      : JSON.stringify(input.timeline_milestones || []);

    const customClausesJson = typeof input.custom_clauses === 'string'
      ? input.custom_clauses
      : JSON.stringify({ ...DEFAULT_SOFTWARE_CONTRACT_CLAUSES, ...(input.custom_clauses || {}) });

    const financials = calculateSoftwareContractFinancials({
      base_price_minor: input.base_price_minor,
      pricing_mode: input.pricing_mode,
      gst_rate_bp: input.gst_rate_bp,
      gst_treatment: input.gst_treatment,
      discount_minor: input.discount_minor,
      additional_charges_minor: input.additional_charges_minor,
      supplier_state_code: business.state_code || '36',
      client_state_code: input.state_code || '36',
      advance_percentage_bp: input.advance_percentage_bp,
      payment_milestones: input.payment_milestones,
    });

    // Default support dates: 3 months from completion or start date
    const supportStart = input.support_start_date || input.estimated_completion_date || input.start_date;
    let supportEnd = input.support_end_date;
    if (!supportEnd && supportStart) {
      const d = new Date(supportStart);
      d.setMonth(d.getMonth() + (input.free_support_months ?? 3));
      supportEnd = d.toISOString().slice(0, 10);
    }

    const { rows } = await tx.query(`
      INSERT INTO inv.software_agreements (
        id, contract_number, version, status, branding_mode, client_id,
        client_name, client_legal_name, contact_person, client_email, client_phone,
        billing_address, city, state_code, postal_code, country, client_gstin, client_pan, client_business_type,
        signatory_name, signatory_designation,
        title, service_category, service_category_custom, service_description, business_objectives,
        start_date, estimated_completion_date, development_duration, requirements_finalization_date,
        deployment_target, hosting_responsibility, client_assets_access, third_party_integrations,
        acceptance_criteria, project_notes,
        features, included_services, excluded_services, client_responsibilities, third_party_dependencies,
        technical_assumptions, scope_limitations,
        pricing_mode, base_price_minor, gst_rate_bp, gst_treatment, discount_minor, additional_charges_minor,
        taxable_amount_minor, cgst_minor, sgst_minor, igst_minor, total_gst_minor, final_amount_minor,
        advance_percentage_bp, advance_amount_minor, remaining_balance_minor, payment_milestones, payment_terms_notes,
        timeline_milestones,
        free_support_months, support_start_date, support_end_date, support_scope, support_reporting_process,
        post_support_feature_rate_minor, post_support_terms,
        maintenance_included, maintenance_rate_minor, maintenance_start_date, maintenance_frequency,
        maintenance_scope, maintenance_exclusions,
        custom_clauses, special_terms, nextora_signatory_name, nextora_signatory_title,
        client_signatory_name, client_signatory_title,
        created_by, created_at, updated_at
      ) VALUES (
        $1, $2, 1, 'DRAFT', $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19,
        $20, $21, $22, $23, $24,
        $25, $26, $27, $28,
        $29, $30, $31, $32,
        $33, $34,
        $35, $36, $37, $38, $39,
        $40, $41,
        $42, $43, $44, $45, $46, $47,
        $48, $49, $50, $51, $52, $53,
        $54, $55, $56, $57, $58,
        $59,
        $60, $61, $62, $63, $64,
        $65, $66,
        $67, $68, $69, $70,
        $71, $72,
        $73, $74, $75, $76,
        $77, $78,
        $79, now(), now()
      ) RETURNING *
    `, [
      id, allocated.number, input.branding_mode || 'COMPANY_ONLY', input.client_id || null,
      input.client_name.trim(), input.client_legal_name?.trim() || '', input.contact_person?.trim() || '',
      input.client_email?.trim() || '', input.client_phone?.trim() || '',
      input.billing_address?.trim() || '', input.city?.trim() || '', input.state_code || '36',
      input.postal_code?.trim() || '', input.country || 'India',
      input.client_gstin?.trim() || '', input.client_pan?.trim() || '', input.client_business_type?.trim() || '',
      input.signatory_name?.trim() || '', input.signatory_designation?.trim() || '',

      input.title?.trim() || 'Software Development Services Agreement',
      input.service_category || 'Custom software development',
      input.service_category_custom?.trim() || '',
      input.service_description?.trim() || '',
      input.business_objectives?.trim() || '',
      input.start_date,
      input.estimated_completion_date || null,
      input.development_duration?.trim() || '1 Month',
      input.requirements_finalization_date || null,
      input.deployment_target?.trim() || '',
      input.hosting_responsibility?.trim() || '',
      input.client_assets_access?.trim() || '',
      input.third_party_integrations?.trim() || '',
      input.acceptance_criteria?.trim() || '',
      input.project_notes?.trim() || '',

      featuresJson,
      input.included_services?.trim() || '',
      input.excluded_services?.trim() || '',
      input.client_responsibilities?.trim() || '',
      input.third_party_dependencies?.trim() || '',
      input.technical_assumptions?.trim() || '',
      input.scope_limitations?.trim() || '',

      financials.pricing_mode,
      financials.base_price_minor,
      financials.gst_rate_bp,
      financials.gst_treatment,
      financials.discount_minor,
      financials.additional_charges_minor,
      financials.taxable_amount_minor,
      financials.cgst_minor,
      financials.sgst_minor,
      financials.igst_minor,
      financials.total_gst_minor,
      financials.final_amount_minor,
      financials.advance_percentage_bp,
      financials.advance_amount_minor,
      financials.remaining_balance_minor,
      milestonesJson,
      input.payment_terms_notes?.trim() || '',

      timelineJson,

      input.free_support_months ?? 3,
      supportStart,
      supportEnd,
      input.support_scope?.trim() || '',
      input.support_reporting_process?.trim() || '',
      input.post_support_feature_rate_minor ?? 500000,
      input.post_support_terms?.trim() || '',

      Boolean(input.maintenance_included),
      input.maintenance_rate_minor ?? 200000,
      input.maintenance_start_date || null,
      input.maintenance_frequency || 'MONTHLY',
      input.maintenance_scope?.trim() || '',
      input.maintenance_exclusions?.trim() || '',

      customClausesJson,
      input.special_terms?.trim() || '',
      input.nextora_signatory_name?.trim() || business.signatory_name || 'Authorized Signatory',
      input.nextora_signatory_title?.trim() || business.signatory_title || 'Director',
      input.client_signatory_name?.trim() || input.signatory_name?.trim() || '',
      input.client_signatory_title?.trim() || input.signatory_designation?.trim() || '',

      actor.id,
    ]);

    await audit(tx, 'SOFTWARE_AGREEMENT_CREATED', {
      actorId: actor.id, entityType: 'SOFTWARE_AGREEMENT', entityId: id,
      metadata: { contract_number: allocated.number, client_name: input.client_name }
    });

    return normalizeAgreement(rows[0]);
  });
}

export async function updateSoftwareAgreementDraft(db, actor, id, input) {
  const existing = await getSoftwareAgreement(db, id);
  assert(['DRAFT', 'PENDING_APPROVAL'].includes(existing.status), 409,
    `Cannot edit contract in status ${existing.status}. Only DRAFT or PENDING_APPROVAL agreements can be edited.`, 'IMMUTABLE_AGREEMENT');

  const { rows: settingsRows } = await db.query('SELECT * FROM inv.business_settings WHERE id = true');
  const business = settingsRows[0] || {};

  const clientName = input.client_name !== undefined ? input.client_name.trim() : existing.client_name;
  assert(clientName, 400, 'Client name is required.', 'VALIDATION_ERROR');

  const basePriceMinor = input.base_price_minor !== undefined ? input.base_price_minor : existing.base_price_minor;
  const pricingMode = input.pricing_mode !== undefined ? input.pricing_mode : existing.pricing_mode;
  const gstRateBp = input.gst_rate_bp !== undefined ? input.gst_rate_bp : existing.gst_rate_bp;
  const gstTreatment = input.gst_treatment !== undefined ? input.gst_treatment : existing.gst_treatment;
  const discountMinor = input.discount_minor !== undefined ? input.discount_minor : existing.discount_minor;
  const addMinor = input.additional_charges_minor !== undefined ? input.additional_charges_minor : existing.additional_charges_minor;
  const stateCode = input.state_code !== undefined ? input.state_code : existing.state_code;
  const advanceBp = input.advance_percentage_bp !== undefined ? input.advance_percentage_bp : existing.advance_percentage_bp;
  const paymentMilestones = input.payment_milestones !== undefined ? input.payment_milestones : existing.payment_milestones;

  const financials = calculateSoftwareContractFinancials({
    base_price_minor: basePriceMinor,
    pricing_mode: pricingMode,
    gst_rate_bp: gstRateBp,
    gst_treatment: gstTreatment,
    discount_minor: discountMinor,
    additional_charges_minor: addMinor,
    supplier_state_code: business.state_code || '36',
    client_state_code: stateCode || '36',
    advance_percentage_bp: advanceBp,
    payment_milestones: paymentMilestones,
  });

  const featuresJson = input.features !== undefined
    ? (typeof input.features === 'string' ? input.features : JSON.stringify(input.features))
    : (typeof existing.features === 'string' ? existing.features : JSON.stringify(existing.features || []));

  const milestonesJson = typeof paymentMilestones === 'string'
    ? paymentMilestones
    : JSON.stringify(paymentMilestones || []);

  const timelineJson = input.timeline_milestones !== undefined
    ? (typeof input.timeline_milestones === 'string' ? input.timeline_milestones : JSON.stringify(input.timeline_milestones))
    : (typeof existing.timeline_milestones === 'string' ? existing.timeline_milestones : JSON.stringify(existing.timeline_milestones || []));

  const customClausesJson = input.custom_clauses !== undefined
    ? (typeof input.custom_clauses === 'string' ? input.custom_clauses : JSON.stringify(input.custom_clauses))
    : (typeof existing.custom_clauses === 'string' ? existing.custom_clauses : JSON.stringify(existing.custom_clauses || {}));

  return db.transaction(async tx => {
    const { rows } = await tx.query(`
      UPDATE inv.software_agreements SET
        client_id = $1, client_name = $2, client_legal_name = $3, contact_person = $4,
        client_email = $5, client_phone = $6, billing_address = $7, city = $8, state_code = $9,
        postal_code = $10, country = $11, client_gstin = $12, client_pan = $13, client_business_type = $14,
        signatory_name = $15, signatory_designation = $16,
        title = $17, service_category = $18, service_category_custom = $19, service_description = $20,
        business_objectives = $21, start_date = $22, estimated_completion_date = $23, development_duration = $24,
        requirements_finalization_date = $25, deployment_target = $26, hosting_responsibility = $27,
        client_assets_access = $28, third_party_integrations = $29, acceptance_criteria = $30, project_notes = $31,
        features = $32, included_services = $33, excluded_services = $34, client_responsibilities = $35,
        third_party_dependencies = $36, technical_assumptions = $37, scope_limitations = $38,
        pricing_mode = $39, base_price_minor = $40, gst_rate_bp = $41, gst_treatment = $42,
        discount_minor = $43, additional_charges_minor = $44, taxable_amount_minor = $45,
        cgst_minor = $46, sgst_minor = $47, igst_minor = $48, total_gst_minor = $49, final_amount_minor = $50,
        advance_percentage_bp = $51, advance_amount_minor = $52, remaining_balance_minor = $53,
        payment_milestones = $54, payment_terms_notes = $55, timeline_milestones = $56,
        free_support_months = $57, support_start_date = $58, support_end_date = $59,
        support_scope = $60, support_reporting_process = $61, post_support_feature_rate_minor = $62,
        post_support_terms = $63, maintenance_included = $64, maintenance_rate_minor = $65,
        maintenance_start_date = $66, maintenance_frequency = $67, maintenance_scope = $68,
        maintenance_exclusions = $69, custom_clauses = $70, special_terms = $71,
        nextora_signatory_name = $72, nextora_signatory_title = $73,
        client_signatory_name = $74, client_signatory_title = $75,
        branding_mode = $76,
        version = version + 1, updated_at = now()
      WHERE id = $77
      RETURNING *
    `, [
      input.client_id !== undefined ? input.client_id : existing.client_id,
      clientName,
      input.client_legal_name !== undefined ? input.client_legal_name.trim() : existing.client_legal_name,
      input.contact_person !== undefined ? input.contact_person.trim() : existing.contact_person,
      input.client_email !== undefined ? input.client_email.trim() : existing.client_email,
      input.client_phone !== undefined ? input.client_phone.trim() : existing.client_phone,
      input.billing_address !== undefined ? input.billing_address.trim() : existing.billing_address,
      input.city !== undefined ? input.city.trim() : existing.city,
      stateCode,
      input.postal_code !== undefined ? input.postal_code.trim() : existing.postal_code,
      input.country !== undefined ? input.country : existing.country,
      input.client_gstin !== undefined ? input.client_gstin.trim() : existing.client_gstin,
      input.client_pan !== undefined ? input.client_pan.trim() : existing.client_pan,
      input.client_business_type !== undefined ? input.client_business_type.trim() : existing.client_business_type,
      input.signatory_name !== undefined ? input.signatory_name.trim() : existing.signatory_name,
      input.signatory_designation !== undefined ? input.signatory_designation.trim() : existing.signatory_designation,

      input.title !== undefined ? input.title.trim() : existing.title,
      input.service_category !== undefined ? input.service_category : existing.service_category,
      input.service_category_custom !== undefined ? input.service_category_custom.trim() : existing.service_category_custom,
      input.service_description !== undefined ? input.service_description.trim() : existing.service_description,
      input.business_objectives !== undefined ? input.business_objectives.trim() : existing.business_objectives,
      input.start_date !== undefined ? input.start_date : existing.start_date,
      input.estimated_completion_date !== undefined ? input.estimated_completion_date : existing.estimated_completion_date,
      input.development_duration !== undefined ? input.development_duration.trim() : existing.development_duration,
      input.requirements_finalization_date !== undefined ? input.requirements_finalization_date : existing.requirements_finalization_date,
      input.deployment_target !== undefined ? input.deployment_target.trim() : existing.deployment_target,
      input.hosting_responsibility !== undefined ? input.hosting_responsibility.trim() : existing.hosting_responsibility,
      input.client_assets_access !== undefined ? input.client_assets_access.trim() : existing.client_assets_access,
      input.third_party_integrations !== undefined ? input.third_party_integrations.trim() : existing.third_party_integrations,
      input.acceptance_criteria !== undefined ? input.acceptance_criteria.trim() : existing.acceptance_criteria,
      input.project_notes !== undefined ? input.project_notes.trim() : existing.project_notes,

      featuresJson,
      input.included_services !== undefined ? input.included_services.trim() : existing.included_services,
      input.excluded_services !== undefined ? input.excluded_services.trim() : existing.excluded_services,
      input.client_responsibilities !== undefined ? input.client_responsibilities.trim() : existing.client_responsibilities,
      input.third_party_dependencies !== undefined ? input.third_party_dependencies.trim() : existing.third_party_dependencies,
      input.technical_assumptions !== undefined ? input.technical_assumptions.trim() : existing.technical_assumptions,
      input.scope_limitations !== undefined ? input.scope_limitations.trim() : existing.scope_limitations,

      financials.pricing_mode,
      financials.base_price_minor,
      financials.gst_rate_bp,
      financials.gst_treatment,
      financials.discount_minor,
      financials.additional_charges_minor,
      financials.taxable_amount_minor,
      financials.cgst_minor,
      financials.sgst_minor,
      financials.igst_minor,
      financials.total_gst_minor,
      financials.final_amount_minor,
      financials.advance_percentage_bp,
      financials.advance_amount_minor,
      financials.remaining_balance_minor,
      milestonesJson,
      input.payment_terms_notes !== undefined ? input.payment_terms_notes.trim() : existing.payment_terms_notes,

      timelineJson,

      input.free_support_months !== undefined ? input.free_support_months : existing.free_support_months,
      input.support_start_date !== undefined ? input.support_start_date : existing.support_start_date,
      input.support_end_date !== undefined ? input.support_end_date : existing.support_end_date,
      input.support_scope !== undefined ? input.support_scope.trim() : existing.support_scope,
      input.support_reporting_process !== undefined ? input.support_reporting_process.trim() : existing.support_reporting_process,
      input.post_support_feature_rate_minor !== undefined ? input.post_support_feature_rate_minor : existing.post_support_feature_rate_minor,
      input.post_support_terms !== undefined ? input.post_support_terms.trim() : existing.post_support_terms,

      input.maintenance_included !== undefined ? Boolean(input.maintenance_included) : existing.maintenance_included,
      input.maintenance_rate_minor !== undefined ? input.maintenance_rate_minor : existing.maintenance_rate_minor,
      input.maintenance_start_date !== undefined ? input.maintenance_start_date : existing.maintenance_start_date,
      input.maintenance_frequency !== undefined ? input.maintenance_frequency : existing.maintenance_frequency,
      input.maintenance_scope !== undefined ? input.maintenance_scope.trim() : existing.maintenance_scope,
      input.maintenance_exclusions !== undefined ? input.maintenance_exclusions.trim() : existing.maintenance_exclusions,

      customClausesJson,
      input.special_terms !== undefined ? input.special_terms.trim() : existing.special_terms,
      input.nextora_signatory_name !== undefined ? input.nextora_signatory_name.trim() : existing.nextora_signatory_name,
      input.nextora_signatory_title !== undefined ? input.nextora_signatory_title.trim() : existing.nextora_signatory_title,
      input.client_signatory_name !== undefined ? input.client_signatory_name.trim() : existing.client_signatory_name,
      input.client_signatory_title !== undefined ? input.client_signatory_title.trim() : existing.client_signatory_title,

      input.branding_mode || existing.branding_mode || 'COMPANY_ONLY',
      id,
    ]);

    await audit(tx, 'SOFTWARE_AGREEMENT_UPDATED', {
      actorId: actor.id, entityType: 'SOFTWARE_AGREEMENT', entityId: id,
      metadata: { contract_number: existing.contract_number, version: rows[0].version }
    });

    return normalizeAgreement(rows[0]);
  });
}

export async function transitionSoftwareAgreementStatus(db, actor, id, { action, date: actionDate, reason = '' }) {
  const agr = await getSoftwareAgreement(db, id);

  const VALID_TRANSITIONS = {
    DRAFT: ['SUBMIT_APPROVAL', 'APPROVE', 'CANCEL'],
    PENDING_APPROVAL: ['APPROVE', 'REJECT', 'CANCEL'],
    APPROVED: ['SEND', 'SIGN', 'CANCEL'],
    SENT: ['ACCEPT', 'SIGN', 'CANCEL'],
    ACCEPTED: ['SIGN', 'CANCEL'],
    SIGNED: ['ACTIVATE', 'COMPLETE', 'TERMINATE', 'CANCEL', 'ARCHIVE'],
    ACTIVE: ['COMPLETE', 'TERMINATE', 'CANCEL', 'ARCHIVE'],
    COMPLETED: ['ARCHIVE'],
    TERMINATED: ['ARCHIVE'],
    CANCELLED: ['ARCHIVE'],
    ARCHIVED: [],
  };

  const allowed = VALID_TRANSITIONS[agr.status] || [];
  assert(allowed.includes(action), 400,
    `Cannot perform '${action}' on software agreement in status '${agr.status}'.`, 'INVALID_STATUS_TRANSITION');

  const now = new Date().toISOString();
  let newStatus = agr.status;
  const updates = [];
  const params = [now, id];

  switch (action) {
    case 'SUBMIT_APPROVAL':
      newStatus = 'PENDING_APPROVAL';
      break;
    case 'APPROVE':
      newStatus = 'APPROVED';
      updates.push(`approved_by = $${params.length + 1}`);
      params.push(actor.id);
      break;
    case 'REJECT':
      newStatus = 'DRAFT';
      break;
    case 'SEND':
      newStatus = 'SENT';
      updates.push(`sent_at = $${params.length + 1}`);
      params.push(actionDate || now);
      break;
    case 'ACCEPT':
      newStatus = 'ACCEPTED';
      updates.push(`accepted_at = $${params.length + 1}`);
      params.push(actionDate || now);
      break;
    case 'SIGN':
      newStatus = 'SIGNED';
      updates.push(`signed_at = $${params.length + 1}`);
      params.push(actionDate || now);
      break;
    case 'ACTIVATE':
      newStatus = 'ACTIVE';
      break;
    case 'COMPLETE':
      newStatus = 'COMPLETED';
      break;
    case 'TERMINATE':
      newStatus = 'TERMINATED';
      updates.push(`terminated_at = $${params.length + 1}`);
      params.push(actionDate || now);
      updates.push(`termination_reason = $${params.length + 1}`);
      params.push(reason || 'Terminated by mutual consent');
      break;
    case 'CANCEL':
      newStatus = 'CANCELLED';
      updates.push(`terminated_at = $${params.length + 1}`);
      params.push(actionDate || now);
      updates.push(`termination_reason = $${params.length + 1}`);
      params.push(reason || 'Agreement cancelled');
      break;
    case 'ARCHIVE':
      newStatus = 'ARCHIVED';
      break;
  }

  updates.unshift(`status = '${newStatus}'`);
  updates.push(`updated_at = $1`);

  const sql = `
    UPDATE inv.software_agreements
    SET ${updates.join(', ')}
    WHERE id = $2
    RETURNING *
  `;

  const { rows } = await db.query(sql, params);

  await audit(db, 'SOFTWARE_AGREEMENT_STATUS_CHANGED', {
    actorId: actor.id, entityType: 'SOFTWARE_AGREEMENT', entityId: id,
    metadata: { previous_status: agr.status, new_status: newStatus, action, reason }
  });

  return normalizeAgreement(rows[0]);
}

export async function deleteDraftSoftwareAgreement(db, actor, id) {
  requireWriter(actor);
  const existing = await getSoftwareAgreement(db, id);
  assert(['DRAFT', 'PENDING_APPROVAL'].includes(existing.status), 409,
    `Only unexecuted draft agreements can be deleted (current status: ${existing.status}). Please cancel or archive active agreements instead.`,
    'NOT_DELETABLE');

  await db.query('DELETE FROM inv.software_agreements WHERE id = $1', [id]);
  await audit(db, 'SOFTWARE_AGREEMENT_DRAFT_DELETED', {
    actorId: actor.id,
    entityType: 'SOFTWARE_AGREEMENT',
    entityId: id,
    metadata: { contract_number: existing.contract_number, client_name: existing.client_name },
  });
  return { deleted: true, contract_number: existing.contract_number };
}

export async function duplicateSoftwareAgreement(db, actor, id) {
  const source = await getSoftwareAgreement(db, id);
  const input = {
    ...source,
    title: `${source.title} (Copy)`,
    start_date: new Date().toISOString().slice(0, 10),
  };
  delete input.id;
  delete input.contract_number;
  delete input.version;
  delete input.status;
  delete input.created_at;
  delete input.updated_at;
  delete input.pdf_generated_at;
  delete input.snapshot;

  return createSoftwareAgreement(db, actor, input);
}

export async function recordSoftwarePdfGenerated(db, actor, id, snapshot) {
  const now = new Date().toISOString();
  const snapshotJson = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);

  await db.query(`
    UPDATE inv.software_agreements
    SET pdf_generated_at = $1, snapshot = $2, updated_at = $1
    WHERE id = $3
  `, [now, snapshotJson, id]);

  await audit(db, 'SOFTWARE_AGREEMENT_PDF_GENERATED', {
    actorId: actor.id, entityType: 'SOFTWARE_AGREEMENT', entityId: id,
    metadata: { contract_number: snapshot.contract_number, generated_at: now }
  });
}
