import { api, query } from '../lib/api.js';
import {
  esc, money, date, button, card, emptyState, loading, pageHeader, pagination, field, alertBox,
  statusBadge, modal, closeModal, toast, statusLabel, badge, icon, toMajor, parseAmount,
} from '../lib/ui.js';

export async function softwareAgreementForm(ctx, existing = null) {
  const reference = ctx.reference || await ctx.refreshReference();
  const states = reference.states || [];
  const stateOptions = [{ value: '', label: 'Select State (Place of Supply)' }, ...states.map(s => ({ value: s.code, label: `${s.code} · ${s.name}` }))];

  let clientsList = [];
  try {
    const clientsRes = await api.get('/api/clients?limit=100');
    clientsList = clientsRes.clients || [];
  } catch {
    clientsList = [];
  }

  const defaultCategories = reference.software_service_categories || [
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
  ];

  const defaultFeatures = [
    {
      sno: 1,
      name: 'System Architecture & Database Design',
      description: 'Design of database schemas, technical architecture, and system specifications.',
      deliverables: 'Entity Relationship Diagram, Architecture Documentation',
      priority: 'High',
      acceptance_criteria: 'Approved relational schema with normalized tables and indexes',
      included: true,
      notes: '',
    },
    {
      sno: 2,
      name: 'Core Application Development',
      description: 'Implementation of primary business logic, functional workflows, and data processing.',
      deliverables: 'Functional software modules in staging environment',
      priority: 'High',
      acceptance_criteria: 'All primary workflows execute without unhandled exceptions',
      included: true,
      notes: '',
    },
    {
      sno: 3,
      name: 'Responsive User Interface & Portal',
      description: 'Front-end interface optimized for desktop, tablet, and mobile browsers.',
      deliverables: 'Web / desktop interface screens and components',
      priority: 'Normal',
      acceptance_criteria: 'Responsive rendering across modern browsers and specified viewports',
      included: true,
      notes: '',
    },
    {
      sno: 4,
      name: 'API & Third-Party Service Integration',
      description: 'Integration of payment gateway, external notifications, and third-party APIs.',
      deliverables: 'Configured webhook handlers and integrated API clients',
      priority: 'Normal',
      acceptance_criteria: 'Successful test transactions and API payloads in sandbox',
      included: true,
      notes: '',
    },
    {
      sno: 5,
      name: 'Deployment, Testing & Handover',
      description: 'End-to-end testing, user acceptance review, and production deployment configuration.',
      deliverables: 'Deployed application, admin credentials, source code repository',
      priority: 'Critical',
      acceptance_criteria: 'Successful production deployment and administrative access verification',
      included: true,
      notes: '',
    },
  ];

  const defaultMilestones = [
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
  ];

  const a = existing || {
    client_id: '',
    client_name: '',
    client_legal_name: '',
    contact_person: '',
    client_email: '',
    client_phone: '',
    billing_address: '',
    city: '',
    state_code: '36', // Default Telangana
    postal_code: '',
    country: 'India',
    client_gstin: '',
    client_pan: '',
    client_business_type: '',
    signatory_name: '',
    signatory_designation: '',
    title: 'Software Development Services Agreement',
    service_category: 'Custom software development',
    service_category_custom: '',
    service_description: '',
    business_objectives: '',
    start_date: new Date().toISOString().slice(0, 10),
    estimated_completion_date: '',
    development_duration: '1 Month',
    requirements_finalization_date: '',
    deployment_target: 'Cloud VPS / Docker / Client Infrastructure',
    hosting_responsibility: 'Client provides and funds hosting; Developer configures deployment',
    client_assets_access: 'Branding logos, domain DNS access, third-party API keys, and content',
    third_party_integrations: '',
    acceptance_criteria: '7 business days User Acceptance Testing window upon staging deployment',
    project_notes: '',
    features: defaultFeatures,
    included_services: 'Software engineering, architecture, code reviews, staging deployment, 3 months complimentary support.',
    excluded_services: 'Paid third-party API usage, cloud hosting fees, domain renewals, graphic design creation.',
    client_responsibilities: 'Timely feedback within 5 business days, providing credentials and content assets.',
    third_party_dependencies: 'External payment processor verification, domain registrar access, SMS gateway.',
    technical_assumptions: 'Application hosted on Ubuntu 22.04 LTS / Node.js 22 LTS environment.',
    scope_limitations: 'Custom features requested outside this specification require a separate written Change Order.',
    pricing_mode: 'EXCLUSIVE',
    base_price_minor: 5000000, // ₹50,000.00
    gst_rate_bp: 1800,
    gst_treatment: 'TAXABLE',
    discount_minor: 0,
    additional_charges_minor: 0,
    advance_percentage_bp: 1000, // 10.00%
    payment_milestones: defaultMilestones,
    payment_terms_notes: '10% advance payable prior to project kickoff. Milestones payable within 7 business days of completion.',
    free_support_months: 3,
    support_start_date: '',
    support_end_date: '',
    support_scope: 'Defect corrections, bug troubleshooting, minor alignments to approved specification.',
    support_reporting_process: 'Email to support@nextoracreations.co.in with reproducible steps and screenshots.',
    post_support_feature_rate_minor: 500000, // ₹5,000.00
    post_support_terms: 'New features billed at ₹5,000 default rate per approved feature, subject to scope confirmation.',
    maintenance_included: false,
    maintenance_rate_minor: 200000, // ₹2,000.00
    maintenance_start_date: '',
    maintenance_frequency: 'MONTHLY',
    maintenance_scope: 'Periodic health checks, security dependency updates, application uptime monitoring.',
    maintenance_exclusions: 'New feature development, major design overhauls, third-party infrastructure fees.',
    special_terms: '',
    nextora_signatory_name: reference.business?.signatory_name || 'Authorized Signatory',
    nextora_signatory_title: reference.business?.signatory_title || 'Managing Partner',
    client_signatory_name: '',
    client_signatory_title: '',
  };

  let features = Array.isArray(a.features)
    ? [...a.features]
    : (typeof a.features === 'string' ? JSON.parse(a.features || '[]') : defaultFeatures);

  let milestones = Array.isArray(a.payment_milestones)
    ? [...a.payment_milestones]
    : (typeof a.payment_milestones === 'string' ? JSON.parse(a.payment_milestones || '[]') : defaultMilestones);

  const previewContractNo = existing
    ? existing.contract_number
    : (reference.numbering_preview?.software_agreement || 'NC/SDA/2026-27/0001 (Preview)');

  function renderFeaturesTable() {
    if (!features.length) {
      return `<tr><td colspan="7" class="p-3 text-center text-xs text-on-surface-variant">No features added. Click "Add Feature Row" to itemize project scope.</td></tr>`;
    }
    return features.map((f, i) => `
      <tr class="border-b border-outline hover:bg-surface-dim" data-feature-index="${i}">
        <td class="p-2 text-center font-mono text-xs w-12">${i + 1}</td>
        <td class="p-2 w-44">
          <input type="text" class="input-text text-xs font-semibold w-full" name="feat_name_${i}" value="${esc(f.name)}" placeholder="Feature name" required>
        </td>
        <td class="p-2">
          <textarea class="input-text text-xs w-full" rows="2" name="feat_desc_${i}" placeholder="Feature description...">${esc(f.description)}</textarea>
        </td>
        <td class="p-2 w-36">
          <input type="text" class="input-text text-xs w-full" name="feat_del_${i}" value="${esc(f.deliverables)}" placeholder="Deliverable / Code">
        </td>
        <td class="p-2 w-28 text-center">
          <select class="field text-xs w-full" name="feat_priority_${i}">
            <option value="Low" ${f.priority === 'Low' ? 'selected' : ''}>Low</option>
            <option value="Normal" ${f.priority === 'Normal' || !f.priority ? 'selected' : ''}>Normal</option>
            <option value="High" ${f.priority === 'High' ? 'selected' : ''}>High</option>
            <option value="Critical" ${f.priority === 'Critical' ? 'selected' : ''}>Critical</option>
          </select>
        </td>
        <td class="p-2 w-24 text-center">
          <label class="inline-flex items-center gap-1 cursor-pointer text-xs">
            <input type="checkbox" name="feat_inc_${i}" ${f.included !== false ? 'checked' : ''} class="rounded border-outline text-emerald-600">
            <span class="${f.included !== false ? 'text-emerald-700 font-semibold' : 'text-red-700'}">${f.included !== false ? 'Included' : 'Excluded'}</span>
          </label>
        </td>
        <td class="p-2 w-12 text-center">
          <button type="button" data-action="remove-feature-row" data-index="${i}" class="text-red-600 hover:text-red-800 p-1" title="Remove Feature">
            ${icon('close', '!text-[16px]')}
          </button>
        </td>
      </tr>
    `).join('');
  }

  function renderMilestonesTable() {
    if (!milestones.length) {
      return `<tr><td colspan="5" class="p-3 text-center text-xs text-on-surface-variant">No payment milestones configured. Click "Add Milestone" to allocate remaining project balance.</td></tr>`;
    }
    return milestones.map((m, i) => `
      <tr class="border-b border-outline hover:bg-surface-dim" data-milestone-index="${i}">
        <td class="p-2 text-center font-mono text-xs w-12">${i + 1}</td>
        <td class="p-2 w-48">
          <input type="text" class="input-text text-xs font-semibold w-full" name="ms_name_${i}" value="${esc(m.name)}" placeholder="Milestone name" required>
        </td>
        <td class="p-2">
          <input type="text" class="input-text text-xs w-full" name="ms_trigger_${i}" value="${esc(m.trigger)}" placeholder="Trigger condition / Acceptance event">
        </td>
        <td class="p-2 w-32">
          <input type="date" class="input-text text-xs w-full" name="ms_date_${i}" value="${esc(m.due_date || '')}">
        </td>
        <td class="p-2 w-36">
          <div class="relative">
            <span class="absolute left-2.5 top-2 text-xs font-bold text-on-surface-variant">₹</span>
            <input type="number" step="0.01" min="0" class="input-text text-xs font-mono font-bold pl-6 w-full ms-amount-input" name="ms_amount_${i}" value="${toMajor(m.amount_minor || 0)}">
          </div>
        </td>
        <td class="p-2 w-12 text-center">
          <button type="button" data-action="remove-milestone-row" data-index="${i}" class="text-red-600 hover:text-red-800 p-1" title="Remove Milestone">
            ${icon('close', '!text-[16px]')}
          </button>
        </td>
      </tr>
    `).join('');
  }

  const node = modal({
    title: existing ? `Edit Software Services Agreement (${esc(existing.contract_number)})` : 'New Software Development Services Agreement',
    className: 'max-w-5xl',
    body: `
      <div id="contract-form-warnings" class="mb-4 space-y-2"></div>
      <form id="software-contract-form" class="space-y-6" novalidate>
        
        <!-- Header Banner -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3 bg-surface-dim p-4 border border-outline">
          <div>
            <label class="label-technical">Contract Identifier</label>
            <p class="font-mono text-sm font-bold text-primary mt-1">${esc(previewContractNo)}</p>
            <p class="text-[11px] text-on-surface-variant">Allocated sequentially upon save</p>
          </div>
          <div>
            <label class="label-technical">Service Provider</label>
            <p class="font-bold text-xs mt-1 text-on-surface">Nextora Creations</p>
            <p class="text-[11px] text-on-surface-variant">Telangana GSTIN: 36JTAPK9167A1ZK</p>
          </div>
          <div>
            <label class="label-technical">Contract Type</label>
            <p class="font-bold text-xs mt-1 text-cyan-accent">Software Development Services</p>
            <p class="text-[11px] text-on-surface-variant">Professional Milestone Agreement</p>
          </div>
        </div>

        <!-- 1. Client Details Section (Phase 3) -->
        <div class="border border-outline p-4 bg-surface">
          <div class="flex items-center justify-between mb-3 border-b border-outline pb-2">
            <div>
              <h3 class="font-headline text-xs font-bold uppercase tracking-wider text-on-surface">1. Client Details &amp; Legal Identity</h3>
              <p class="text-xs text-on-surface-variant">Select an existing registered client or enter details for this contract.</p>
            </div>
            ${clientsList.length ? `
              <div class="w-64">
                <select id="client-picker-select" class="field text-xs">
                  <option value="">— Load Saved Client —</option>
                  ${clientsList.map(c => `<option value="${esc(c.id)}" ${c.id === a.client_id ? 'selected' : ''}>${esc(c.name)} ${c.company_name ? `(${c.company_name})` : ''}</option>`).join('')}
                </select>
              </div>
            ` : ''}
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input type="hidden" name="client_id" id="client_id" value="${esc(a.client_id || '')}">
            
            ${field({ label: 'Client / Business Name', name: 'client_name', id: 'client_name', required: true, value: a.client_name, placeholder: 'Acme Technologies or John Doe' })}
            ${field({ label: 'Client Legal Entity Name', name: 'client_legal_name', id: 'client_legal_name', value: a.client_legal_name, placeholder: 'Acme Technologies Private Limited' })}
            ${field({ label: 'Primary Contact Person', name: 'contact_person', id: 'contact_person', value: a.contact_person, placeholder: 'Name of project manager or executive' })}

            ${field({ label: 'Client Email', name: 'client_email', id: 'client_email', type: 'email', value: a.client_email, placeholder: 'contact@acme.com' })}
            ${field({ label: 'Client Phone', name: 'client_phone', id: 'client_phone', value: a.client_phone, placeholder: '+91 98765 43210' })}
            ${field({ label: 'Client Business Type', name: 'client_business_type', id: 'client_business_type', value: a.client_business_type, placeholder: 'Private Limited / Partnership / Individual' })}

            ${field({ label: 'State (Place of Supply)', name: 'state_code', id: 'state_code', options: stateOptions, value: a.state_code || '36', hint: 'Determines CGST+SGST (Telangana 36) vs IGST' })}
            ${field({ label: 'City', name: 'city', id: 'city', value: a.city, placeholder: 'Hyderabad' })}
            ${field({ label: 'PIN / Postal Code', name: 'postal_code', id: 'postal_code', value: a.postal_code, placeholder: '500081' })}

            ${field({ label: 'Registered Billing Address', name: 'billing_address', id: 'billing_address', type: 'textarea', value: a.billing_address, className: 'sm:col-span-2', placeholder: 'Door No, Street, Landmark...' })}
            
            <div class="space-y-3">
              ${field({ label: 'Client GSTIN (if registered)', name: 'client_gstin', id: 'client_gstin', value: a.client_gstin, placeholder: '36AAAAA0000A1Z5', hint: 'Advisory checksum check applies.' })}
              ${field({ label: 'Client PAN', name: 'client_pan', id: 'client_pan', value: a.client_pan, placeholder: 'ABCDE1234F' })}
            </div>

            ${field({ label: 'Client Signatory Name', name: 'client_signatory_name', id: 'client_signatory_name', value: a.client_signatory_name || a.signatory_name, placeholder: 'Authorized Signatory' })}
            ${field({ label: 'Client Signatory Designation', name: 'client_signatory_title', id: 'client_signatory_title', value: a.client_signatory_title || a.signatory_designation, placeholder: 'Director / Chief Executive Officer' })}
          </div>
        </div>

        <!-- 2. Project and Service Details (Phase 4) -->
        <div class="border border-outline p-4 bg-surface">
          <h3 class="font-headline text-xs font-bold uppercase tracking-wider mb-3 text-on-surface border-b border-outline pb-2">
            2. Project &amp; Service Configuration
          </h3>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            ${field({ label: 'Project Title', name: 'title', required: true, value: a.title, className: 'sm:col-span-2' })}
            ${field({
              label: 'Service Category', name: 'service_category', id: 'service_category',
              options: defaultCategories.map(c => ({ value: c, label: c })),
              value: a.service_category || 'Custom software development',
            })}

            <div id="custom-category-wrap" class="sm:col-span-3 ${a.service_category === 'Other custom services' ? '' : 'hidden'}">
              ${field({ label: 'Custom Service Category Name', name: 'service_category_custom', id: 'service_category_custom', value: a.service_category_custom, placeholder: 'e.g. Embedded Firmware Development & IoT Integration' })}
            </div>

            ${field({ label: 'Project Description', name: 'service_description', type: 'textarea', value: a.service_description, className: 'sm:col-span-3', placeholder: 'Summary of the software solution to be engineered...' })}
            ${field({ label: 'Business Objectives', name: 'business_objectives', type: 'textarea', value: a.business_objectives, className: 'sm:col-span-3', placeholder: 'Key business outcomes, operational goals, target users...' })}

            ${field({ label: 'Start Date', name: 'start_date', type: 'date', required: true, value: a.start_date })}
            ${field({ label: 'Estimated Completion Date', name: 'estimated_completion_date', type: 'date', value: a.estimated_completion_date || '' })}
            ${field({ label: 'Estimated Development Duration', name: 'development_duration', value: a.development_duration || '1 Month', placeholder: '1 Month / 6 Weeks' })}

            ${field({ label: 'Deployment Target', name: 'deployment_target', value: a.deployment_target, placeholder: 'AWS Cloud / Linux VPS / Docker' })}
            ${field({ label: 'Hosting Responsibility', name: 'hosting_responsibility', value: a.hosting_responsibility, placeholder: 'Client provides and funds cloud infrastructure' })}
            ${field({ label: 'Third-Party Integrations', name: 'third_party_integrations', value: a.third_party_integrations, placeholder: 'Razorpay, AWS S3, Twilio SMS, OpenAI API' })}

            ${field({ label: 'Client-Provided Assets & Access', name: 'client_assets_access', type: 'textarea', value: a.client_assets_access, className: 'sm:col-span-3', placeholder: 'Branding collateral, domain registrar credentials, API keys...' })}
            ${field({ label: 'User Acceptance Testing Criteria', name: 'acceptance_criteria', type: 'textarea', value: a.acceptance_criteria, className: 'sm:col-span-3', placeholder: 'Standard 7 business days review window upon staging deployment...' })}
          </div>
        </div>

        <!-- 3. Requirements and Feature Scope (Phase 5) -->
        <div class="border border-outline p-4 bg-surface">
          <div class="flex items-center justify-between mb-3 border-b border-outline pb-2">
            <div>
              <h3 class="font-headline text-xs font-bold uppercase tracking-wider text-on-surface">3. Requirements &amp; Feature Scope (Schedule A)</h3>
              <p class="text-xs text-on-surface-variant">Detailed itemized feature breakdown approved with the client.</p>
            </div>
            ${button({ label: 'Add Feature Row', action: 'add-feature-row', size: 'sm', icon: 'add' })}
          </div>

          <div class="overflow-x-auto mb-4 border border-outline">
            <table class="w-full text-left text-xs">
              <thead class="bg-surface-dim border-b border-outline text-[11px] font-bold text-on-surface uppercase">
                <tr>
                  <th class="p-2 w-12 text-center">S.No</th>
                  <th class="p-2 w-44">Feature Name</th>
                  <th class="p-2">Description &amp; Specifications</th>
                  <th class="p-2 w-36">Deliverables</th>
                  <th class="p-2 w-28 text-center">Priority</th>
                  <th class="p-2 w-24 text-center">Scope</th>
                  <th class="p-2 w-12 text-center"></th>
                </tr>
              </thead>
              <tbody id="features-tbody">
                ${renderFeaturesTable()}
              </tbody>
            </table>
          </div>

          <!-- Scope Boundaries -->
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-2">
            ${field({ label: 'Included Services', name: 'included_services', type: 'textarea', value: a.included_services, placeholder: 'Scope explicitly covered by Nextora Creations...' })}
            ${field({ label: 'Excluded Services', name: 'excluded_services', type: 'textarea', value: a.excluded_services, placeholder: 'Paid hosting, external API licenses, domain renewals...' })}
            ${field({ label: 'Client Responsibilities', name: 'client_responsibilities', type: 'textarea', value: a.client_responsibilities, placeholder: 'Providing credentials, timely feedback, content assets...' })}
            ${field({ label: 'Third-Party Dependencies & Limitations', name: 'third_party_dependencies', type: 'textarea', value: a.third_party_dependencies, placeholder: 'External provider rate limits, API approval delays...' })}
          </div>
        </div>

        <!-- 4. Project Pricing, GST & Milestone Reconciliation (Phase 6, Phase 7) -->
        <div class="border border-outline p-4 bg-surface">
          <h3 class="font-headline text-xs font-bold uppercase tracking-wider mb-3 text-on-surface border-b border-outline pb-2">
            4. Project Pricing, GST Breakdown &amp; Payment Milestones
          </h3>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-5">
            <div>
              <label class="label-technical">Base Project Price (₹)</label>
              <div class="relative mt-1">
                <span class="absolute left-2.5 top-2 text-xs font-bold text-on-surface-variant">₹</span>
                <input type="number" step="0.01" min="0" name="base_price" id="base_price" class="input-text text-sm font-mono font-bold pl-6 w-full" value="${toMajor(a.base_price_minor)}">
              </div>
              <p class="text-[11px] text-on-surface-variant mt-1">Total contract value</p>
            </div>

            ${field({
              label: 'Pricing Mode', name: 'pricing_mode', id: 'pricing_mode',
              options: [
                { value: 'EXCLUSIVE', label: 'GST Exclusive (Tax added to base price)' },
                { value: 'INCLUSIVE', label: 'GST Inclusive (Base price already includes tax)' },
              ],
              value: a.pricing_mode || 'EXCLUSIVE',
              hint: 'Governs how GST is computed',
            })}

            ${field({
              label: 'GST Rate', name: 'gst_rate_bp', id: 'gst_rate_bp',
              options: [
                { value: '1800', label: '18% GST (Standard Software Services)' },
                { value: '1200', label: '12% GST' },
                { value: '500', label: '5% GST' },
                { value: '2800', label: '28% GST' },
                { value: '0', label: '0% (Exempt / Nil-Rated / Export)' },
              ],
              value: String(a.gst_rate_bp || 1800),
            })}

            <div>
              <label class="label-technical">Agreed Discount (₹)</label>
              <div class="relative mt-1">
                <span class="absolute left-2.5 top-2 text-xs font-bold text-on-surface-variant">₹</span>
                <input type="number" step="0.01" min="0" name="discount" id="discount" class="input-text text-xs font-mono pl-6 w-full" value="${toMajor(a.discount_minor || 0)}">
              </div>
            </div>

            <div>
              <label class="label-technical">Additional Approved Charges (₹)</label>
              <div class="relative mt-1">
                <span class="absolute left-2.5 top-2 text-xs font-bold text-on-surface-variant">₹</span>
                <input type="number" step="0.01" min="0" name="additional_charges" id="additional_charges" class="input-text text-xs font-mono pl-6 w-full" value="${toMajor(a.additional_charges_minor || 0)}">
              </div>
            </div>

            <div>
              <label class="label-technical">Advance Payment Percentage (%)</label>
              <div class="relative mt-1">
                <input type="number" step="0.1" min="0" max="100" name="advance_percentage" id="advance_percentage" class="input-text text-xs font-mono font-bold w-full" value="${((a.advance_percentage_bp || 1000) / 100).toFixed(1)}">
              </div>
              <p class="text-[11px] text-on-surface-variant mt-1">Default: 10.0% before kickoff</p>
            </div>
          </div>

          <!-- Dynamic Live Calculation Card -->
          <div id="financial-summary-card" class="bg-surface-dim border border-outline p-4 mb-5">
            <h4 class="font-headline text-xs font-bold uppercase tracking-wider text-primary mb-3">Financial Summary &amp; Tax Distribution</h4>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <span class="text-on-surface-variant block">Taxable Amount:</span>
                <span class="font-mono font-bold text-sm text-on-surface" id="disp-taxable">—</span>
              </div>
              <div>
                <span class="text-on-surface-variant block">Applicable GST:</span>
                <span class="font-mono font-bold text-sm text-on-surface" id="disp-gst">—</span>
                <span class="text-[10px] text-on-surface-variant block" id="disp-tax-split">—</span>
              </div>
              <div>
                <span class="text-on-surface-variant block">Final Contract Value:</span>
                <span class="font-mono font-bold text-sm text-primary" id="disp-final">—</span>
              </div>
              <div>
                <span class="text-on-surface-variant block">10% Advance Payable:</span>
                <span class="font-mono font-bold text-sm text-cyan-accent" id="disp-advance">—</span>
              </div>
            </div>
            <div class="mt-3 pt-3 border-t border-outline flex flex-wrap items-center justify-between text-xs">
              <div>
                <span class="text-on-surface-variant">Remaining Project Balance:</span>
                <span class="font-mono font-bold text-on-surface ml-1" id="disp-balance">—</span>
              </div>
              <div id="reconciliation-indicator" class="font-semibold text-xs flex items-center gap-1.5">
                <!-- Reconciled badge updated via JS -->
              </div>
            </div>
          </div>

          <!-- Payment Milestones Section (Phase 7) -->
          <div class="pt-2">
            <div class="flex items-center justify-between mb-3">
              <div>
                <h4 class="font-headline text-xs font-bold uppercase tracking-wider text-on-surface">Payment Milestones (Balance Allocation)</h4>
                <p class="text-[11px] text-on-surface-variant">Milestone amounts must reconcile with the remaining project balance.</p>
              </div>
              ${button({ label: 'Add Milestone', action: 'add-milestone-row', size: 'sm', icon: 'add' })}
            </div>

            <div class="overflow-x-auto border border-outline mb-3">
              <table class="w-full text-left text-xs">
                <thead class="bg-surface-dim border-b border-outline text-[11px] font-bold text-on-surface uppercase">
                  <tr>
                    <th class="p-2 w-12 text-center">S.No</th>
                    <th class="p-2 w-48">Milestone Name</th>
                    <th class="p-2">Trigger Event / Deliverable</th>
                    <th class="p-2 w-32">Target Due Date</th>
                    <th class="p-2 w-36">Amount (₹)</th>
                    <th class="p-2 w-12 text-center"></th>
                  </tr>
                </thead>
                <tbody id="milestones-tbody">
                  ${renderMilestonesTable()}
                </tbody>
              </table>
            </div>

            ${field({ label: 'Payment Terms, Invoicing & Suspension Notes', name: 'payment_terms_notes', type: 'textarea', value: a.payment_terms_notes, placeholder: 'Invoices due within 7 days. Delayed payments pause development...' })}
          </div>
        </div>

        <!-- 5. Free Support, Post-Support Features & Maintenance (Phase 9, 10, 11) -->
        <div class="border border-outline p-4 bg-surface">
          <h3 class="font-headline text-xs font-bold uppercase tracking-wider mb-3 text-on-surface border-b border-outline pb-2">
            5. Support, Post-Support Feature Rates &amp; Ongoing Maintenance
          </h3>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-4">
            <div>
              <label class="label-technical">Complimentary Support Period</label>
              <div class="flex items-center gap-2 mt-1">
                <input type="number" min="0" max="24" name="free_support_months" id="free_support_months" class="input-text text-xs font-mono font-bold w-24" value="${a.free_support_months ?? 3}">
                <span class="text-xs font-semibold">Months Included</span>
              </div>
              <p class="text-[11px] text-on-surface-variant mt-1">Commences on project handover</p>
            </div>

            ${field({ label: 'Support Commencement Date', name: 'support_start_date', type: 'date', value: a.support_start_date || '' })}
            ${field({ label: 'Support End Date', name: 'support_end_date', type: 'date', value: a.support_end_date || '' })}

            ${field({ label: 'Covered Free Support Scope', name: 'support_scope', type: 'textarea', value: a.support_scope, className: 'sm:col-span-3', placeholder: 'Correction of defects, bugs, and minor corrective configuration...' })}
            ${field({ label: 'Issue Reporting & Support Process', name: 'support_reporting_process', type: 'textarea', value: a.support_reporting_process, className: 'sm:col-span-3', placeholder: 'Report via email with reproducible steps and screenshots...' })}

            <!-- Post-Support Feature Development Rate (Phase 10) -->
            <div>
              <label class="label-technical">Post-Support Feature Rate (₹)</label>
              <div class="relative mt-1">
                <span class="absolute left-2.5 top-2 text-xs font-bold text-on-surface-variant">₹</span>
                <input type="number" step="0.01" min="0" name="post_support_feature_rate" class="input-text text-xs font-mono font-bold pl-6 w-full" value="${toMajor(a.post_support_feature_rate_minor || 500000)}">
              </div>
              <p class="text-[11px] text-on-surface-variant mt-1">Default: ₹5,000 per approved feature</p>
            </div>

            ${field({ label: 'Post-Support Feature Terms', name: 'post_support_terms', className: 'sm:col-span-2', value: a.post_support_terms, placeholder: 'Features evaluated upon written request and billed per approved feature.' })}
          </div>

          <!-- Monthly Maintenance Section (Phase 11) -->
          <div class="border-t border-outline pt-3">
            <div class="flex items-center gap-3 mb-3">
              <label class="inline-flex items-center gap-2 cursor-pointer text-xs font-bold">
                <input type="checkbox" name="maintenance_included" id="maintenance_included" ${a.maintenance_included ? 'checked' : ''} class="rounded border-outline text-cyan-accent">
                <span>Include Ongoing Application Maintenance Plan</span>
              </label>
              <span class="text-xs text-on-surface-variant">(Optional monthly operational care)</span>
            </div>

            <div id="maintenance-config-wrap" class="grid grid-cols-1 gap-3 sm:grid-cols-3 ${a.maintenance_included ? '' : 'opacity-60 pointer-events-none'}">
              <div>
                <label class="label-technical">Monthly Maintenance Rate (₹)</label>
                <div class="relative mt-1">
                  <span class="absolute left-2.5 top-2 text-xs font-bold text-on-surface-variant">₹</span>
                  <input type="number" step="0.01" min="0" name="maintenance_rate" class="input-text text-xs font-mono font-bold pl-6 w-full" value="${toMajor(a.maintenance_rate_minor || 200000)}">
                </div>
                <p class="text-[11px] text-on-surface-variant mt-1">Default: ₹2,000 / month</p>
              </div>

              ${field({ label: 'Maintenance Start Date', name: 'maintenance_start_date', type: 'date', value: a.maintenance_start_date || '' })}
              ${field({ label: 'Billing Frequency', name: 'maintenance_frequency', options: [{ value: 'MONTHLY', label: 'Monthly in Advance' }, { value: 'QUARTERLY', label: 'Quarterly' }, { value: 'YEARLY', label: 'Yearly' }], value: a.maintenance_frequency || 'MONTHLY' })}

              ${field({ label: 'Covered Maintenance Services', name: 'maintenance_scope', type: 'textarea', value: a.maintenance_scope, className: 'sm:col-span-3', placeholder: 'Routine uptime checks, security dependency updates, application health monitoring...' })}
              ${field({ label: 'Maintenance Exclusions', name: 'maintenance_exclusions', type: 'textarea', value: a.maintenance_exclusions, className: 'sm:col-span-3', placeholder: 'New feature development, major design changes, paid cloud infrastructure...' })}
            </div>
          </div>
        </div>

        <!-- 6. Special Terms & Signatures (Phase 12) -->
        <div class="border border-outline p-4 bg-surface">
          <h3 class="font-headline text-xs font-bold uppercase tracking-wider mb-3 text-on-surface border-b border-outline pb-2">
            6. Signatures &amp; Special Contract Conditions
          </h3>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            ${field({ label: 'Nextora Creations Authorized Signatory', name: 'nextora_signatory_name', value: a.nextora_signatory_name })}
            ${field({ label: 'Signatory Title / Designation', name: 'nextora_signatory_title', value: a.nextora_signatory_title })}
            ${field({ label: 'Client Signatory Name', name: 'client_signatory_name_sig', value: a.client_signatory_name || a.signatory_name, placeholder: 'Legal name of client signatory' })}
            ${field({ label: 'Client Signatory Designation', name: 'client_signatory_title_sig', value: a.client_signatory_title || a.signatory_designation, placeholder: 'Director / Managing Director' })}
            ${field({ label: 'Special Agreed Terms / Notes', name: 'special_terms', type: 'textarea', value: a.special_terms, className: 'sm:col-span-2', placeholder: 'Any project-specific warranties, non-disclosure terms, or commercial caveats...' })}
          </div>
        </div>
      </form>`,
    footer: `
      ${button({ label: 'Cancel', action: 'close-modal' })}
      ${button({ label: existing ? 'Save Contract Changes' : 'Create & Preview Contract', action: 'save-software-agreement', variant: 'primary' })}
    `,
  });

  // Client picker event
  node.querySelector('#client-picker-select')?.addEventListener('change', e => {
    const selectedId = e.target.value;
    const client = clientsList.find(c => c.id === selectedId);
    if (!client) return;

    node.querySelector('#client_id').value = client.id;
    node.querySelector('#client_name').value = client.name || '';
    node.querySelector('#client_legal_name').value = client.company_name || client.name || '';
    node.querySelector('#contact_person').value = client.contact_person || '';
    node.querySelector('#client_email').value = client.email || '';
    node.querySelector('#client_phone').value = client.phone || '';
    node.querySelector('#billing_address').value = client.billing_address || '';
    node.querySelector('#state_code').value = client.state_code || '36';
    node.querySelector('#client_gstin').value = client.gstin || '';
    node.querySelector('#client_signatory_name').value = client.contact_person || client.name || '';
    triggerLiveCalculation();
  });

  // Service category toggle
  node.querySelector('#service_category')?.addEventListener('change', e => {
    const wrap = node.querySelector('#custom-category-wrap');
    if (wrap) wrap.classList.toggle('hidden', e.target.value !== 'Other custom services');
  });

  // Maintenance checkbox toggle
  node.querySelector('#maintenance_included')?.addEventListener('change', e => {
    const wrap = node.querySelector('#maintenance-config-wrap');
    if (wrap) {
      wrap.classList.toggle('opacity-60', !e.target.checked);
      wrap.classList.toggle('pointer-events-none', !e.target.checked);
    }
  });

  // Dynamic feature handlers
  ctx.on('add-feature-row', () => {
    features.push({
      sno: features.length + 1,
      name: '',
      description: '',
      deliverables: '',
      priority: 'Normal',
      acceptance_criteria: '',
      included: true,
      notes: '',
    });
    const tbody = node.querySelector('#features-tbody');
    if (tbody) tbody.innerHTML = renderFeaturesTable();
  });

  node.addEventListener('click', e => {
    const remFeat = e.target.closest('[data-action="remove-feature-row"]');
    if (remFeat) {
      const idx = Number(remFeat.dataset.index);
      features.splice(idx, 1);
      const tbody = node.querySelector('#features-tbody');
      if (tbody) tbody.innerHTML = renderFeaturesTable();
      return;
    }

    const remMs = e.target.closest('[data-action="remove-milestone-row"]');
    if (remMs) {
      const idx = Number(remMs.dataset.index);
      milestones.splice(idx, 1);
      const tbody = node.querySelector('#milestones-tbody');
      if (tbody) tbody.innerHTML = renderMilestonesTable();
      triggerLiveCalculation();
      return;
    }
  });

  // Dynamic milestone handlers
  ctx.on('add-milestone-row', () => {
    milestones.push({
      name: `Milestone ${milestones.length + 1}`,
      trigger: 'Upon deliverable completion and UAT sign-off',
      due_date: '',
      amount_minor: 0,
    });
    const tbody = node.querySelector('#milestones-tbody');
    if (tbody) tbody.innerHTML = renderMilestonesTable();
    triggerLiveCalculation();
  });

  // Live calculation function
  let lastCalcResult = null;
  async function triggerLiveCalculation() {
    const form = new FormData(node.querySelector('#software-contract-form'));
    const basePrice = parseAmount(form.get('base_price') || '0');
    const pricingMode = String(form.get('pricing_mode') || 'EXCLUSIVE');
    const gstRateBp = Number(form.get('gst_rate_bp') || 1800);
    const discount = parseAmount(form.get('discount') || '0');
    const additional = parseAmount(form.get('additional_charges') || '0');
    const clientState = String(form.get('state_code') || '36');
    const advPercent = parseFloat(form.get('advance_percentage') || '10');
    const advBp = Math.round(advPercent * 100);

    // Harvest milestone amounts from inputs
    const msInputs = node.querySelectorAll('.ms-amount-input');
    const currentMilestones = Array.from(msInputs).map((input, idx) => ({
      name: String(form.get(`ms_name_${idx}`) || `Milestone ${idx + 1}`),
      amount_minor: parseAmount(input.value || '0'),
    }));

    try {
      const calcRes = await api.post('/api/marketing/software-agreements/calculate', {
        base_price_minor: basePrice,
        pricing_mode: pricingMode,
        gst_rate_bp: gstRateBp,
        gst_treatment: 'TAXABLE',
        discount_minor: discount,
        additional_charges_minor: additional,
        client_state_code: clientState,
        advance_percentage_bp: advBp,
        payment_milestones: currentMilestones,
      });

      const fin = calcRes.financials;
      lastCalcResult = fin;

      node.querySelector('#disp-taxable').textContent = money(fin.taxable_amount_minor);
      node.querySelector('#disp-gst').textContent = money(fin.total_gst_minor);
      node.querySelector('#disp-final').textContent = money(fin.final_amount_minor);
      node.querySelector('#disp-advance').textContent = `${money(fin.advance_amount_minor)} (${fin.advance_percentage_label})`;
      node.querySelector('#disp-balance').textContent = money(fin.remaining_balance_minor);

      if (fin.supply_type === 'INTRA') {
        node.querySelector('#disp-tax-split').textContent = `CGST 9%: ${money(fin.cgst_minor)} · SGST 9%: ${money(fin.sgst_minor)}`;
      } else {
        node.querySelector('#disp-tax-split').textContent = `IGST 18%: ${money(fin.igst_minor)} (Interstate)`;
      }

      const recDiv = node.querySelector('#reconciliation-indicator');
      if (recDiv) {
        if (fin.is_milestones_reconciled) {
          recDiv.innerHTML = `<span class="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">${icon('event_available')} Milestones Reconciled</span>`;
        } else {
          recDiv.innerHTML = `<span class="inline-flex items-center gap-1 text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">${icon('close')} Unallocated Balance: ${money(fin.milestones_difference_minor)}</span>`;
        }
      }
    } catch {
      /* calculation error */
    }
  }

  // Bind live calculation listeners
  ['#base_price', '#pricing_mode', '#gst_rate_bp', '#discount', '#additional_charges', '#state_code', '#advance_percentage'].forEach(sel => {
    node.querySelector(sel)?.addEventListener('input', triggerLiveCalculation);
    node.querySelector(sel)?.addEventListener('change', triggerLiveCalculation);
  });
  node.querySelector('#milestones-tbody')?.addEventListener('input', triggerLiveCalculation);

  // Initial calculation trigger
  triggerLiveCalculation();

  // Save handler
  ctx.on('save-software-agreement', async () => {
    const form = new FormData(node.querySelector('#software-contract-form'));

    // Harvest features
    const finalFeatures = features.map((_, i) => ({
      sno: i + 1,
      name: String(form.get(`feat_name_${i}`) || '').trim(),
      description: String(form.get(`feat_desc_${i}`) || '').trim(),
      deliverables: String(form.get(`feat_del_${i}`) || '').trim(),
      priority: String(form.get(`feat_priority_${i}`) || 'Normal'),
      acceptance_criteria: '',
      included: form.get(`feat_inc_${i}`) !== null,
      notes: '',
    })).filter(f => f.name.length > 0);

    // Harvest milestones
    const msInputs = node.querySelectorAll('.ms-amount-input');
    const finalMilestones = Array.from(msInputs).map((input, i) => ({
      name: String(form.get(`ms_name_${i}`) || `Milestone ${i + 1}`).trim(),
      trigger: String(form.get(`ms_trigger_${i}`) || '').trim(),
      due_date: String(form.get(`ms_date_${i}`) || '').trim(),
      amount_minor: parseAmount(input.value || '0'),
    })).filter(m => m.name.length > 0);

    const clientName = String(form.get('client_name') || '').trim();
    if (!clientName) {
      node.querySelector('#contract-form-warnings').innerHTML = alertBox('Client Name is required.', 'danger');
      return;
    }

    const payload = {
      client_id: form.get('client_id') ? String(form.get('client_id')) : null,
      client_name: clientName,
      client_legal_name: String(form.get('client_legal_name') || '').trim(),
      contact_person: String(form.get('contact_person') || '').trim(),
      client_email: String(form.get('client_email') || '').trim(),
      client_phone: String(form.get('client_phone') || '').trim(),
      billing_address: String(form.get('billing_address') || '').trim(),
      city: String(form.get('city') || '').trim(),
      state_code: String(form.get('state_code') || '36'),
      postal_code: String(form.get('postal_code') || '').trim(),
      country: String(form.get('country') || 'India').trim(),
      client_gstin: String(form.get('client_gstin') || '').trim().toUpperCase(),
      client_pan: String(form.get('client_pan') || '').trim().toUpperCase(),
      client_business_type: String(form.get('client_business_type') || '').trim(),
      signatory_name: String(form.get('client_signatory_name') || '').trim(),
      signatory_designation: String(form.get('client_signatory_title') || '').trim(),

      title: String(form.get('title') || 'Software Development Services Agreement').trim(),
      service_category: String(form.get('service_category') || 'Custom software development'),
      service_category_custom: String(form.get('service_category_custom') || '').trim(),
      service_description: String(form.get('service_description') || '').trim(),
      business_objectives: String(form.get('business_objectives') || '').trim(),
      start_date: String(form.get('start_date')),
      estimated_completion_date: String(form.get('estimated_completion_date') || '') || null,
      development_duration: String(form.get('development_duration') || '1 Month').trim(),
      requirements_finalization_date: String(form.get('requirements_finalization_date') || '') || null,
      deployment_target: String(form.get('deployment_target') || '').trim(),
      hosting_responsibility: String(form.get('hosting_responsibility') || '').trim(),
      client_assets_access: String(form.get('client_assets_access') || '').trim(),
      third_party_integrations: String(form.get('third_party_integrations') || '').trim(),
      acceptance_criteria: String(form.get('acceptance_criteria') || '').trim(),
      project_notes: '',

      features: finalFeatures,
      included_services: String(form.get('included_services') || '').trim(),
      excluded_services: String(form.get('excluded_services') || '').trim(),
      client_responsibilities: String(form.get('client_responsibilities') || '').trim(),
      third_party_dependencies: String(form.get('third_party_dependencies') || '').trim(),

      pricing_mode: String(form.get('pricing_mode') || 'EXCLUSIVE'),
      base_price_minor: parseAmount(form.get('base_price') || '0'),
      gst_rate_bp: Number(form.get('gst_rate_bp') || 1800),
      gst_treatment: 'TAXABLE',
      discount_minor: parseAmount(form.get('discount') || '0'),
      additional_charges_minor: parseAmount(form.get('additional_charges') || '0'),
      advance_percentage_bp: Math.round(parseFloat(form.get('advance_percentage') || '10') * 100),
      payment_milestones: finalMilestones,
      payment_terms_notes: String(form.get('payment_terms_notes') || '').trim(),

      free_support_months: Number(form.get('free_support_months') || 3),
      support_start_date: String(form.get('support_start_date') || '') || null,
      support_end_date: String(form.get('support_end_date') || '') || null,
      support_scope: String(form.get('support_scope') || '').trim(),
      support_reporting_process: String(form.get('support_reporting_process') || '').trim(),
      post_support_feature_rate_minor: parseAmount(form.get('post_support_feature_rate') || '5000'),
      post_support_terms: String(form.get('post_support_terms') || '').trim(),

      maintenance_included: node.querySelector('#maintenance_included')?.checked || false,
      maintenance_rate_minor: parseAmount(form.get('maintenance_rate') || '2000'),
      maintenance_start_date: String(form.get('maintenance_start_date') || '') || null,
      maintenance_frequency: String(form.get('maintenance_frequency') || 'MONTHLY'),
      maintenance_scope: String(form.get('maintenance_scope') || '').trim(),
      maintenance_exclusions: String(form.get('maintenance_exclusions') || '').trim(),

      special_terms: String(form.get('special_terms') || '').trim(),
      nextora_signatory_name: String(form.get('nextora_signatory_name') || '').trim(),
      nextora_signatory_title: String(form.get('nextora_signatory_title') || '').trim(),
      client_signatory_name: String(form.get('client_signatory_name_sig') || '').trim(),
      client_signatory_title: String(form.get('client_signatory_title_sig') || '').trim(),
    };

    try {
      const res = existing
        ? await api.patch(`/api/marketing/software-agreements/${existing.id}`, payload)
        : await api.post('/api/marketing/software-agreements', payload);
      closeModal();
      const agr = res.agreement;
      toast(existing ? 'Software agreement updated.' : 'Software agreement created as draft.');
      ctx.navigate(`#/marketing/contracts/software/${agr.id}/preview`);
    } catch (error) {
      const warnContainer = node.querySelector('#contract-form-warnings');
      const details = error.fields?.length
        ? error.fields.map(item => `${item.field}: ${item.message}`).join(' · ')
        : error.message;
      if (warnContainer) warnContainer.innerHTML = alertBox(details, 'danger');
    }
  });
}

export async function renderSoftwareAgreementPreview(container, agreementId, ctx) {
  container.innerHTML = pageHeader({
    title: 'Software Contract Preview',
    breadcrumb: '<a href="#/marketing" class="hover:underline">Marketing</a> / <a href="#/marketing/contracts" class="hover:underline">Contracts</a> / Preview',
  }) + loading();

  let res;
  try {
    res = await api.get(`/api/marketing/software-agreements/${agreementId}/preview`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Contract Preview' }) + alertBox(error.message, 'danger');
    return;
  }

  const s = res.snapshot;
  const fin = s.financials || {};
  const features = s.scope?.features || [];
  const milestones = s.milestones?.payment_milestones || [];
  const sup = s.support_and_maintenance || {};
  const clauses = s.clauses || {};

  container.innerHTML = `
    ${pageHeader({
      title: `${esc(s.contract_number)} — Preview`,
      subtitle: `${esc(s.title)} · Version ${s.version || 1}`,
      breadcrumb: '<a href="#/marketing" class="hover:underline">Marketing</a> / <a href="#/marketing/contracts" class="hover:underline">Contracts</a> / Preview',
      actions: `
        ${button({ label: 'Generate PDF', action: 'generate-sw-pdf-btn', variant: 'primary', icon: 'download' })}
        ${button({ label: 'Download PDF', action: 'download-sw-pdf-btn', variant: 'secondary', icon: 'download' })}
        ${['DRAFT', 'PENDING_APPROVAL'].includes(s.status)
          ? button({ label: 'Edit Draft', action: 'edit-sw-preview-draft', variant: 'secondary' })
          : ''}
        ${button({ label: 'Status Actions', action: 'open-sw-status-modal', variant: 'secondary' })}
      `,
    })}

    <!-- Status Banner -->
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4 border border-outline bg-surface p-4">
      <div class="flex items-center gap-3">
        <span class="text-xs text-on-surface-variant">Contract Status:</span>
        ${statusBadge(s.status)}
        ${s.pdf_generated_at ? `<span class="text-xs text-on-surface-variant font-mono">Last Generated: ${date(s.pdf_generated_at.slice(0, 10))}</span>` : ''}
      </div>
      <div class="text-xs text-on-surface-variant">
        Estimated Timeline: <span class="font-bold text-on-surface">${esc(s.project?.development_duration || '1 Month')}</span> · 
        Start: <span class="font-medium text-on-surface">${date(s.project?.start_date)}</span>
      </div>
    </div>

    <!-- Legal Agreement Document Container (Phase 13 Branded HTML View) -->
    <div class="mx-auto max-w-4xl border border-outline bg-surface p-8 sm:p-12 shadow-sm font-body text-sm leading-relaxed text-on-surface">
      
      <!-- Document Header with Company Letterhead & Identity -->
      <div class="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-outline pb-6 mb-8">
        <div>
          <h2 class="font-headline text-lg font-bold uppercase tracking-tight text-primary">${esc(s.business.business_name)}</h2>
          <p class="text-xs text-on-surface-variant">${esc(s.business.address)}</p>
          <p class="text-xs text-on-surface-variant">${[s.business.phone, s.business.website, s.business.email].filter(Boolean).join(' · ')}</p>
          <p class="font-mono text-xs text-on-surface-variant mt-0.5 font-bold">GSTIN: ${esc(s.business.gstin)} · State: Telangana (36)</p>
        </div>
        <div class="sm:text-right">
          <div class="inline-block border border-outline bg-surface-dim px-3 py-1 text-xs font-mono font-bold">
            CONTRACT #${esc(s.contract_number)}
          </div>
          <div class="mt-2 text-xs text-on-surface-variant">Service: <span class="font-bold text-on-surface">${esc(s.service_category)}</span></div>
          <div class="text-xs text-on-surface-variant font-mono">Date: ${date(s.project?.start_date)}</div>
        </div>
      </div>

      <!-- Agreement Title -->
      <div class="text-center mb-8">
        <h1 class="font-headline text-xl font-bold tracking-tight uppercase">${esc(s.title)}</h1>
        <p class="text-xs text-on-surface-variant mt-1">Professional Software Development Services, Scope &amp; Milestone Terms</p>
      </div>

      <!-- Section 1: Parties -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 1: Parties to the Agreement
        </h3>
        <p class="text-xs mb-3 leading-relaxed">${esc(clauses.section_1_parties)}</p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="border border-outline p-3 bg-surface-dim">
            <p class="label-technical">Developer / Service Provider</p>
            <p class="font-bold text-sm mt-1">${esc(s.business.business_name)}</p>
            <p class="text-xs text-on-surface-variant mt-1">${esc(s.business.address)}</p>
            <p class="text-xs text-on-surface-variant">Phone: ${esc(s.business.phone)} · Web: ${esc(s.business.website)}</p>
            <p class="font-mono text-xs font-bold mt-1">GSTIN: ${esc(s.business.gstin)}</p>
          </div>
          <div class="border border-outline p-3 bg-surface-dim">
            <p class="label-technical">Client / Customer</p>
            <p class="font-bold text-sm mt-1">${esc(s.client.legal_name || s.client.name)}</p>
            <p class="text-xs text-on-surface-variant mt-1">${esc([s.client.billing_address, s.client.city, s.client.postal_code, s.client.country].filter(Boolean).join(', '))}</p>
            <p class="text-xs text-on-surface-variant">Contact: ${esc(s.client.contact_person || '—')} · Email: ${esc(s.client.email || '—')}</p>
            <p class="font-mono text-xs font-bold mt-1">GSTIN: ${esc(s.client.gstin || 'Unregistered')} · State Code: ${esc(s.client.state_code || '36')}</p>
          </div>
        </div>
      </div>

      <!-- Section 2: Project Overview & Objectives -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 2: Project Overview &amp; Specifications
        </h3>
        <div class="space-y-2 text-xs leading-relaxed">
          <p><span class="font-semibold">Service Category:</span> ${esc(s.service_category)}</p>
          ${s.project?.service_description ? `<p><span class="font-semibold">Description:</span> ${esc(s.project.service_description)}</p>` : ''}
          ${s.project?.business_objectives ? `<p><span class="font-semibold">Business Objectives:</span> ${esc(s.project.business_objectives)}</p>` : ''}
          <p><span class="font-semibold">Estimated Timeline:</span> ${esc(s.project?.development_duration || '1 Month')} (Commencing from satisfaction of prerequisites)</p>
          ${s.project?.deployment_target ? `<p><span class="font-semibold">Deployment Target:</span> ${esc(s.project.deployment_target)}</p>` : ''}
          ${s.project?.hosting_responsibility ? `<p><span class="font-semibold">Hosting Responsibility:</span> ${esc(s.project.hosting_responsibility)}</p>` : ''}
          ${s.project?.third_party_integrations ? `<p><span class="font-semibold">Third-Party Integrations:</span> ${esc(s.project.third_party_integrations)}</p>` : ''}
        </div>
      </div>

      <!-- Section 3: Feature Scope (Schedule A) -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 3: Requirements &amp; Feature Scope (Schedule A)
        </h3>
        <p class="text-xs mb-3 text-on-surface-variant">Only the approved features itemized in the table below form part of this engagement scope:</p>

        <div class="overflow-x-auto border border-outline mb-4">
          <table class="w-full text-left text-xs">
            <thead class="bg-surface-dim border-b border-outline font-bold">
              <tr>
                <th class="p-2 w-10 text-center">S.No</th>
                <th class="p-2 w-44">Feature Name</th>
                <th class="p-2">Description</th>
                <th class="p-2 w-32">Deliverables</th>
                <th class="p-2 w-20 text-center">Priority</th>
                <th class="p-2 w-20 text-center">Scope</th>
              </tr>
            </thead>
            <tbody>
              ${features.map((f, i) => `
                <tr class="border-b border-outline ${i % 2 === 1 ? 'bg-surface-dim' : ''}">
                  <td class="p-2 text-center font-mono">${i + 1}</td>
                  <td class="p-2 font-semibold">${esc(f.name)}</td>
                  <td class="p-2">${esc(f.description)}</td>
                  <td class="p-2 text-on-surface-variant">${esc(f.deliverables || '—')}</td>
                  <td class="p-2 text-center">${esc(f.priority || 'Normal')}</td>
                  <td class="p-2 text-center">
                    <span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${f.included !== false ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}">
                      ${f.included !== false ? 'Included' : 'Excluded'}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="space-y-1 text-xs text-on-surface-variant">
          ${s.scope?.included_services ? `<p>• <span class="font-semibold text-on-surface">Included Services:</span> ${esc(s.scope.included_services)}</p>` : ''}
          ${s.scope?.excluded_services ? `<p>• <span class="font-semibold text-on-surface">Excluded Services:</span> ${esc(s.scope.excluded_services)}</p>` : ''}
          ${s.scope?.client_responsibilities ? `<p>• <span class="font-semibold text-on-surface">Client Responsibilities:</span> ${esc(s.scope.client_responsibilities)}</p>` : ''}
          ${s.scope?.third_party_dependencies ? `<p>• <span class="font-semibold text-on-surface">Third-Party Dependencies:</span> ${esc(s.scope.third_party_dependencies)}</p>` : ''}
        </div>
      </div>

      <!-- Section 4: Project Pricing & GST Calculations -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 4: Project Pricing &amp; GST Calculations
        </h3>
        <p class="text-xs mb-3 text-on-surface-variant">Financial breakdown configured pursuant to applicable Indian GST regulations:</p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 border border-outline p-4 bg-surface-dim text-xs mb-4">
          <div class="space-y-2">
            <div class="flex justify-between"><span>Pricing Basis:</span><span class="font-bold">${fin.pricing_mode === 'INCLUSIVE' ? 'GST-Inclusive' : 'GST-Exclusive'}</span></div>
            <div class="flex justify-between"><span>1. Project Base Price:</span><span class="font-mono font-bold">${money(fin.base_price_minor)}</span></div>
            ${fin.discount_minor > 0 ? `<div class="flex justify-between text-emerald-700"><span>2. Agreed Discount:</span><span class="font-mono font-bold">-${money(fin.discount_minor)}</span></div>` : ''}
            <div class="flex justify-between font-semibold border-t border-outline pt-1"><span>3. Total Taxable Value:</span><span class="font-mono">${money(fin.taxable_amount_minor)}</span></div>
            <div class="flex justify-between text-[11px] text-on-surface-variant">
              <span>Tax Classification:</span>
              <span>${esc(fin.supply_type_label || 'Intra-state')}</span>
            </div>
            ${fin.supply_type === 'INTRA' ? `
              <div class="flex justify-between pl-2 text-[11px]"><span>• CGST (${(fin.gst_rate_bp/200).toFixed(1)}%):</span><span class="font-mono">${money(fin.cgst_minor)}</span></div>
              <div class="flex justify-between pl-2 text-[11px]"><span>• SGST (${(fin.gst_rate_bp/200).toFixed(1)}%):</span><span class="font-mono">${money(fin.sgst_minor)}</span></div>
            ` : `
              <div class="flex justify-between pl-2 text-[11px]"><span>• IGST (${fin.gst_rate_percent}%):</span><span class="font-mono">${money(fin.igst_minor)}</span></div>
            `}
          </div>

          <div class="space-y-2 border-t sm:border-t-0 sm:border-l border-outline sm:pl-4 pt-2 sm:pt-0">
            <div class="flex justify-between text-sm font-bold text-primary"><span>4. Final Project Amount:</span><span class="font-mono">${money(fin.final_amount_minor)}</span></div>
            <div class="flex justify-between text-xs font-semibold text-cyan-accent border-t border-outline pt-2">
              <span>5. Advance Payable (${fin.advance_percentage_label || '10%'}):</span>
              <span class="font-mono">${money(fin.advance_amount_minor)}</span>
            </div>
            <p class="text-[11px] text-on-surface-variant">Payable upon contract execution prior to project kickoff.</p>
            <div class="flex justify-between text-xs font-bold text-on-surface border-t border-outline pt-2">
              <span>6. Remaining Project Balance:</span>
              <span class="font-mono">${money(fin.remaining_balance_minor)}</span>
            </div>
            <div class="mt-2 text-[11px]">
              <span class="font-semibold">Reconciliation:</span>
              <span class="${fin.is_milestones_reconciled ? 'text-emerald-700 font-bold' : 'text-amber-800 font-bold'}">
                ${fin.is_milestones_reconciled ? 'Reconciled with agreed payment milestones' : 'Milestone allocation pending'}
              </span>
            </div>
          </div>
        </div>

        <!-- Milestones Table -->
        <h4 class="font-headline text-xs font-bold uppercase tracking-wider mb-2 text-on-surface">Agreed Payment Milestones</h4>
        <div class="overflow-x-auto border border-outline mb-3">
          <table class="w-full text-left text-xs">
            <thead class="bg-surface-dim border-b border-outline font-bold">
              <tr>
                <th class="p-2 w-12 text-center">S.No</th>
                <th class="p-2 w-48">Milestone Event</th>
                <th class="p-2">Trigger Event / Deliverable</th>
                <th class="p-2 w-32">Target Due Date</th>
                <th class="p-2 w-32 text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${milestones.map((m, i) => `
                <tr class="border-b border-outline ${i % 2 === 1 ? 'bg-surface-dim' : ''}">
                  <td class="p-2 text-center font-mono">${i + 1}</td>
                  <td class="p-2 font-semibold">${esc(m.name)}</td>
                  <td class="p-2">${esc(m.trigger)}</td>
                  <td class="p-2 text-on-surface-variant">${m.due_date ? date(m.due_date) : 'On Acceptance'}</td>
                  <td class="p-2 text-right font-mono font-bold">${money(m.amount_minor || 0)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Section 5: Development Schedule & Timeline -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 5: Development Schedule &amp; Timeline
        </h3>
        <p class="text-xs leading-relaxed mb-2">${esc(clauses.section_4_development_schedule)}</p>
      </div>

      <!-- Section 6: Support, Paid Features & Maintenance -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 6: Three Months Free Support, Paid Features &amp; Maintenance
        </h3>
        <div class="space-y-3 text-xs leading-relaxed">
          <div class="p-3 bg-surface-dim border border-outline">
            <p class="font-bold text-on-surface">A. Three Months Complimentary Support</p>
            <p class="mt-1">${esc(clauses.section_8_free_support)}</p>
            <p class="mt-2 text-[11px] text-on-surface-variant font-mono">Period: ${date(sup.support_start_date)} to ${date(sup.support_end_date)}</p>
          </div>

          <div class="p-3 bg-surface-dim border border-outline">
            <p class="font-bold text-on-surface">B. Post-Support Feature Development (₹5,000 / Feature Default)</p>
            <p class="mt-1">${esc(clauses.section_9_paid_features)}</p>
            <p class="mt-1 text-on-surface font-semibold">Configured Default Rate: ${esc(sup.post_support_feature_rate_formatted)} per approved feature.</p>
          </div>

          <div class="p-3 bg-surface-dim border border-outline">
            <p class="font-bold text-on-surface">C. Optional Ongoing Monthly Maintenance (₹2,000 / Month Default)</p>
            <p class="mt-1">${esc(clauses.section_10_maintenance)}</p>
            <p class="mt-1 text-on-surface font-semibold">Status: ${sup.maintenance_included ? `Active (${sup.maintenance_rate_formatted} / Month)` : 'Not active unless elected in writing'}</p>
          </div>
        </div>
      </div>

      <!-- Section 7: Standard Legal Clauses -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 7: Standard Commercial Terms &amp; Conditions
        </h3>
        <div class="space-y-4 text-xs leading-relaxed">
          <div><p class="font-bold text-on-surface">7.1 Scope of Work &amp; Exclusions</p><p>${esc(clauses.section_2_scope_of_work)}</p></div>
          <div><p class="font-bold text-on-surface">7.2 Requirements Sign-Off &amp; Approvals</p><p>${esc(clauses.section_3_requirements_approvals)}</p></div>
          <div><p class="font-bold text-on-surface">7.3 Payment Obligations &amp; Delayed Settlements</p><p>${esc(clauses.section_5_payment_obligations)}</p></div>
          <div><p class="font-bold text-on-surface">7.4 Scope Change Requests</p><p>${esc(clauses.section_6_change_requests)}</p></div>
          <div><p class="font-bold text-on-surface">7.5 Testing, Review &amp; Acceptance</p><p>${esc(clauses.section_7_testing_acceptance)}</p></div>
          <div><p class="font-bold text-on-surface">7.6 Intellectual Property Rights</p><p>${esc(clauses.section_11_intellectual_property)}</p></div>
          <div><p class="font-bold text-on-surface">7.7 Confidentiality &amp; Data Protection</p><p>${esc(clauses.section_12_confidentiality)}</p></div>
          <div><p class="font-bold text-on-surface">7.8 Third-Party Platforms &amp; API Limitations</p><p>${esc(clauses.section_13_third_party_services)}</p></div>
          <div><p class="font-bold text-on-surface">7.9 Suspension &amp; Termination</p><p>${esc(clauses.section_15_suspension_termination)}</p></div>
          <div><p class="font-bold text-on-surface">7.10 Limitation of Liability</p><p>${esc(clauses.section_16_limitation_liability)}</p></div>
          <div><p class="font-bold text-on-surface">7.11 Dispute Resolution &amp; Jurisdiction</p><p>${esc(clauses.section_17_dispute_resolution)}</p></div>
        </div>
      </div>

      <!-- Section 8: Signatures & Execution -->
      <div class="border-t-2 border-outline pt-6">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider mb-2 text-on-surface">
          Section 8: Acceptance &amp; Execution
        </h3>
        <p class="text-xs mb-6 text-on-surface-variant">${esc(clauses.section_18_signatures)}</p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-8 text-xs">
          <!-- Nextora Block -->
          <div class="border border-outline p-4 bg-surface-dim">
            <p class="label-technical">For Nextora Creations</p>
            <div class="h-16 border-b border-outline mb-2"></div>
            <p class="font-bold text-on-surface">${esc(s.business.signatory_name)}</p>
            <p class="text-on-surface-variant">${esc(s.business.signatory_title)}</p>
            <p class="text-on-surface-variant font-mono mt-1 text-[11px]">Date: ____________________</p>
          </div>

          <!-- Client Block -->
          <div class="border border-outline p-4 bg-surface-dim">
            <p class="label-technical">For Client / Customer</p>
            <div class="h-16 border-b border-outline mb-2"></div>
            <p class="font-bold text-on-surface">${esc(s.client.signatory_name || s.client.name)}</p>
            <p class="text-on-surface-variant">${esc(s.client.signatory_designation || 'Authorized Representative')}</p>
            <p class="text-on-surface-variant font-mono mt-1 text-[11px]">Date: ____________________</p>
          </div>
        </div>

        <p class="text-[10px] text-on-surface-variant italic mt-6 text-center">
          Note: Previewing or downloading this document does not constitute proof of signature. Both parties must execute this Agreement via verified signature before project commencement.
        </p>
      </div>
    </div>
  `;

  // Action listeners
  ctx.on('generate-sw-pdf-btn', async () => {
    try {
      await api.post(`/api/marketing/software-agreements/${agreementId}/generate-pdf`);
      toast('Software contract PDF generated and snapshot preserved.');
      ctx.rerender();
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('download-sw-pdf-btn', async () => {
    try {
      await api.openDocument(`/api/marketing/software-agreements/${agreementId}/pdf`, { download: true });
      toast('Software contract PDF downloaded successfully.');
    } catch (err) {
      if (!err.message?.includes('canceled') && !err.message?.includes('cancelled')) {
        toast(err.message, 'danger');
      }
    }
  });

  ctx.on('edit-sw-preview-draft', async () => {
    try {
      const res = await api.get(`/api/marketing/software-agreements/${agreementId}`);
      softwareAgreementForm(ctx, res.agreement);
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('open-sw-status-modal', () => {
    const node = modal({
      title: 'Update Software Contract Status',
      body: `
        <form id="sw-status-form" class="space-y-4">
          ${field({
            label: 'Transition Action', name: 'action',
            options: [
              { value: 'SUBMIT_APPROVAL', label: 'Submit for Internal Approval (DRAFT → PENDING)' },
              { value: 'APPROVE', label: 'Approve Agreement (PENDING → APPROVED)' },
              { value: 'SEND', label: 'Mark as Sent to Client (APPROVED → SENT)' },
              { value: 'ACCEPT', label: 'Record Acceptance by Client (SENT → ACCEPTED)' },
              { value: 'SIGN', label: 'Record Execution / Signatures (ACCEPTED → SIGNED)' },
              { value: 'ACTIVATE', label: 'Activate Development (SIGNED → ACTIVE)' },
              { value: 'COMPLETE', label: 'Complete Project (ACTIVE → COMPLETED)' },
              { value: 'CANCEL', label: 'Cancel Agreement (→ CANCELLED)' },
            ],
            value: s.status === 'DRAFT' ? 'SUBMIT_APPROVAL' : (s.status === 'SENT' ? 'ACCEPT' : 'SIGN'),
          })}
          ${field({ label: 'Effective Date', name: 'date', type: 'date', value: new Date().toISOString().slice(0, 10) })}
          ${field({ label: 'Status Reason / Notes', name: 'reason', type: 'textarea', placeholder: 'Document notes or reason for status transition...' })}
        </form>
      `,
      footer: `
        ${button({ label: 'Cancel', action: 'close-modal' })}
        ${button({ label: 'Apply Transition', action: 'confirm-sw-status-transition', variant: 'primary' })}
      `,
    });

    ctx.on('confirm-sw-status-transition', async () => {
      const form = new FormData(node.querySelector('#sw-status-form'));
      try {
        await api.post(`/api/marketing/software-agreements/${agreementId}/status`, {
          action: String(form.get('action')),
          date: String(form.get('date')),
          reason: String(form.get('reason') || ''),
        });
        closeModal();
        toast('Software contract status updated.');
        ctx.rerender();
      } catch (err) { toast(err.message, 'danger'); }
    });
  });
}
