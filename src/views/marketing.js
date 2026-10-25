import { api, query } from '../lib/api.js';
import {
  esc, money, date, button, card, emptyState, loading, pageHeader, pagination, field, alertBox,
  statusBadge, modal, closeModal, toast, statusLabel, badge, stat, icon,
} from '../lib/ui.js';

const STATE_OPTIONS = reference => [
  { value: '', label: 'Not selected' },
  ...(reference?.states || []).map(state => ({ value: state.code, label: `${state.code} · ${state.name}` })),
];

function tabs(activeTab) {
  const items = [
    { id: 'dashboard', label: 'Overview', href: '#/marketing' },
    { id: 'influencers', label: 'Influencers', href: '#/marketing/influencers' },
    { id: 'contracts', label: 'Contracts & Agreements', href: '#/marketing/contracts' },
    { id: 'import', label: 'Import Sales Excel', href: '#/marketing/import' },
    { id: 'reports', label: 'Influencer Sales Reports', href: '#/marketing/reports' },
    { id: 'brand-assets', label: 'Brand Assets & Logos', href: '#/marketing/brand-assets' },
  ];
  return `
    <nav class="mb-6 flex space-x-1 border-b border-outline overflow-x-auto" aria-label="Marketing Sections">
      ${items.map(item => {
        const active = item.id === activeTab;
        return `<a href="${item.href}" class="inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap
          ${active ? 'border-primary font-semibold text-primary' : 'border-transparent text-on-surface-variant hover:border-outline hover:text-on-surface'}">
          ${esc(item.label)}
        </a>`;
      }).join('')}
    </nav>
  `;
}

/* ------------------------------------------------------------------ Forms */

export async function influencerForm(ctx, existing = null, callback = null) {
  const reference = ctx.reference;
  const influencer = existing || {
    legal_name: '', display_name: '', instagram_username: '', instagram_url: '',
    phone: '', email: '', address: '', city: '', state_code: '', postal_code: '',
    country: 'India', niche: '', follower_count: 0, other_social_links: '',
    profile_image_url: '', internal_notes: '', status: 'ACTIVE',
  };

  const node = modal({
    title: existing ? 'Edit Influencer' : 'Add New Influencer',
    body: `
      <div id="influencer-warnings" class="mb-4 space-y-2"></div>
      <form id="influencer-form" class="grid grid-cols-1 gap-4 sm:grid-cols-2" novalidate>
        ${field({ label: 'Full Legal Name', name: 'legal_name', required: true, value: influencer.legal_name, hint: 'Official name as per PAN or government ID for contract execution.' })}
        ${field({ label: 'Influencer Display Name', name: 'display_name', required: true, value: influencer.display_name, hint: 'Public brand or creator name.' })}
        ${field({ label: 'Instagram Handle', name: 'instagram_username', required: true, value: influencer.instagram_username, placeholder: '@influencername', hint: 'Primary social media identity.' })}
        ${field({ label: 'Instagram Profile URL', name: 'instagram_url', value: influencer.instagram_url, placeholder: 'https://instagram.com/influencername' })}
        ${field({ label: 'Mobile Number', name: 'phone', value: influencer.phone, placeholder: '+91 98765 43210', hint: 'Include country code.' })}
        ${field({ label: 'Email Address', name: 'email', type: 'email', value: influencer.email, hint: 'Official email for contract delivery and formal correspondence.' })}
        ${field({ label: 'Street Address', name: 'address', type: 'textarea', value: influencer.address, className: 'sm:col-span-2' })}
        ${field({ label: 'City', name: 'city', value: influencer.city })}
        ${field({ label: 'State (India)', name: 'state_code', options: STATE_OPTIONS(reference), value: influencer.state_code })}
        ${field({ label: 'PIN / Postal Code', name: 'postal_code', value: influencer.postal_code })}
        ${field({ label: 'Country', name: 'country', value: influencer.country || 'India' })}
        ${field({ label: 'Content Niche / Category', name: 'niche', value: influencer.niche, placeholder: 'e.g. Retail Tech, F&B, Business Lifestyle' })}
        ${field({ label: 'Audience / Follower Count', name: 'follower_count', type: 'number', min: '0', value: String(influencer.follower_count || 0) })}
        ${field({ label: 'Other Social Profiles', name: 'other_social_links', type: 'textarea', value: influencer.other_social_links, placeholder: 'YouTube, LinkedIn, Twitter/X URLs', className: 'sm:col-span-2' })}
        ${field({ label: 'Internal Notes', name: 'internal_notes', type: 'textarea', value: influencer.internal_notes, placeholder: 'Partnership background, engagement rates, verified demographics...', className: 'sm:col-span-2' })}
        ${existing ? field({ label: 'Status', name: 'status', options: [
          { value: 'ACTIVE', label: 'Active Partner' },
          { value: 'INACTIVE', label: 'Inactive' },
          { value: 'ARCHIVED', label: 'Archived' },
        ], value: influencer.status }) : ''}
      </form>`,
    footer: `
      ${button({ label: 'Cancel', action: 'close-modal' })}
      ${button({ label: existing ? 'Update Influencer' : 'Save Influencer', action: 'save-influencer', variant: 'primary' })}
    `,
  });

  const checkDuplicates = async () => {
    const form = new FormData(node.querySelector('#influencer-form'));
    const handle = String(form.get('instagram_username') || '').trim();
    const emailVal = String(form.get('email') || '').trim();
    const phoneVal = String(form.get('phone') || '').trim();

    if (!handle && !emailVal && !phoneVal) return;
    try {
      const res = await api.post('/api/marketing/influencers/check-duplicates', {
        instagram_username: handle,
        email: emailVal,
        phone: phoneVal,
        exclude_id: existing?.id || null,
      });
      const warnContainer = node.querySelector('#influencer-warnings');
      if (warnContainer) {
        warnContainer.innerHTML = (res.warnings || []).map(w => alertBox(w, 'warn')).join('');
      }
    } catch { /* duplicate warning check should not block entry */ }
  };

  node.querySelector('#instagram_username')?.addEventListener('blur', checkDuplicates);
  node.querySelector('#email')?.addEventListener('blur', checkDuplicates);
  node.querySelector('#phone')?.addEventListener('blur', checkDuplicates);

  ctx.on('save-influencer', async () => {
    const form = new FormData(node.querySelector('#influencer-form'));
    const payload = {
      legal_name: String(form.get('legal_name') || '').trim(),
      display_name: String(form.get('display_name') || '').trim(),
      instagram_username: String(form.get('instagram_username') || '').trim(),
      instagram_url: String(form.get('instagram_url') || '').trim(),
      phone: String(form.get('phone') || '').trim(),
      email: String(form.get('email') || '').trim(),
      address: String(form.get('address') || '').trim(),
      city: String(form.get('city') || '').trim(),
      state_code: String(form.get('state_code') || '').trim(),
      postal_code: String(form.get('postal_code') || '').trim(),
      country: String(form.get('country') || 'India').trim(),
      niche: String(form.get('niche') || '').trim(),
      follower_count: Number(form.get('follower_count') || 0),
      other_social_links: String(form.get('other_social_links') || '').trim(),
      internal_notes: String(form.get('internal_notes') || '').trim(),
      status: String(form.get('status') || 'ACTIVE'),
    };

    try {
      const result = existing
        ? await api.patch(`/api/marketing/influencers/${existing.id}`, payload)
        : await api.post('/api/marketing/influencers', payload);
      closeModal();
      toast(existing ? 'Influencer record updated.' : 'Influencer registered successfully.');
      if (result.warnings?.length) toast(result.warnings[0], 'info');
      if (callback) callback(result.influencer);
      else ctx.rerender();
    } catch (error) {
      const warnContainer = node.querySelector('#influencer-warnings');
      const details = error.fields?.length
        ? error.fields.map(item => `${item.field}: ${item.message}`).join(' · ')
        : error.message;
      if (warnContainer) warnContainer.innerHTML = alertBox(details, 'danger');
    }
  });
}

export async function agreementForm(ctx, existing = null, preselectedInfluencerId = null) {
  const reference = ctx.reference;
  const business = reference?.business || {};

  // Fetch influencers list for dropdown
  let influencers = [];
  try {
    const res = await api.get('/api/marketing/influencers?limit=100&status=ACTIVE');
    influencers = res.influencers || [];
  } catch { /* proceed */ }

  const todayStr = new Date().toISOString().slice(0, 10);
  const nextYearDate = new Date();
  nextYearDate.setFullYear(nextYearDate.getFullYear() + 1);
  const nextYearStr = nextYearDate.toISOString().slice(0, 10);

  const existingDeliverables = existing?.deliverables
    ? (typeof existing.deliverables === 'string' ? JSON.parse(existing.deliverables) : existing.deliverables)
    : [
      { type: 'Instagram Reel', quantity: 2, frequency: 'Monthly', deadline: '15th of each month', required_tags: '@nextoracreations #NextoraPOS', approval_requirements: 'Draft preview 48h prior', performance_metrics: 'Insights screenshot in 7d' },
      { type: 'Product Demonstration', quantity: 1, frequency: 'Quarterly', deadline: 'End of quarter', required_tags: '@nextoracreations #NextoraPOSDemo', approval_requirements: 'Live outline approval', performance_metrics: 'Lead link clicks' },
    ];

  const agreement = existing || {
    influencer_id: preselectedInfluencerId || influencers[0]?.id || '',
    title: 'Influencer Marketing & Revenue-Sharing Agreement — Nextora POS',
    brand_name: 'Nextora Creations',
    product_name: 'Nextora POS',
    commission_basis_points: 1000, // 10%
    commission_basis: 'NET_SALES_EX_GST',
    custom_basis_description: '',
    product_tax_mode: 'EXCLUSIVE',
    commission_tax_terms: 'EXCLUSIVE',
    influencer_gst_registered: false,
    influencer_gstin: '',
    withholding_tax_rate_bp: 500, // 5% TDS
    withholding_section: '194H',
    start_date: todayStr,
    end_date: nextYearStr,
    is_indefinite: false,
    payment_frequency: 'MONTHLY',
    payment_due_days: 15,
    minimum_payout_minor: 100000, // ₹1,000
    special_terms: '',
    signatory_name: business.signatory_name || 'Gorke Sai Kumar',
    signatory_title: business.signatory_title || 'Founder & CEO',
    influencer_signatory_name: '',
  };

  const previewContractNo = existing?.contract_number || reference?.numbering_preview?.influencer_agreement || 'NC/INF/2026-27/0001';

  let currentDeliverables = [...existingDeliverables];

  function renderDeliverablesRows() {
    return currentDeliverables.map((d, index) => `
      <tr data-index="${index}" class="border-b border-outline">
        <td class="p-2"><input type="text" class="input-text text-xs" name="del_type_${index}" value="${esc(d.type)}" placeholder="e.g. Reel, Story, Demo"></td>
        <td class="p-2 w-16"><input type="number" min="1" class="input-text text-xs text-center" name="del_qty_${index}" value="${d.quantity || 1}"></td>
        <td class="p-2 w-28"><input type="text" class="input-text text-xs" name="del_freq_${index}" value="${esc(d.frequency)}" placeholder="Monthly"></td>
        <td class="p-2"><input type="text" class="input-text text-xs" name="del_deadline_${index}" value="${esc(d.deadline)}" placeholder="Deadline"></td>
        <td class="p-2"><input type="text" class="input-text text-xs" name="del_tags_${index}" value="${esc(d.required_tags)}" placeholder="@nextoracreations"></td>
        <td class="p-2 w-12 text-center">
          <button type="button" data-del-remove="${index}" class="text-red-600 hover:text-red-800 text-xs">${icon('close')}</button>
        </td>
      </tr>
    `).join('');
  }

  const node = modal({
    title: existing ? `Edit Agreement (${existing.contract_number})` : 'New Revenue-Sharing Agreement',
    className: 'max-w-4xl',
    body: `
      <div id="agreement-warnings" class="mb-4 space-y-2"></div>
      <form id="agreement-form" class="space-y-6" novalidate>
        <!-- Contract Meta Header -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3 bg-surface-dim p-4 border border-outline">
          <div>
            <label class="label-technical">Contract Number</label>
            <p class="font-mono text-sm font-bold text-primary mt-1">${esc(previewContractNo)}</p>
            <p class="text-[11px] text-on-surface-variant">Allocated sequentially upon save.</p>
          </div>
          <div>
            <label class="label-technical">Brand</label>
            <input type="text" name="brand_name" class="input-text text-xs mt-1" value="${esc(agreement.brand_name)}">
          </div>
          <div>
            <label class="label-technical">Product Promoted</label>
            <input type="text" name="product_name" class="input-text text-xs mt-1" value="${esc(agreement.product_name)}">
          </div>
        </div>

        <!-- Influencer Selection & Commercial Terms -->
        <div class="border border-outline p-4 bg-surface">
          <h3 class="font-headline text-xs font-bold uppercase tracking-wider mb-3 text-on-surface">1. Parties & Commercial Terms</h3>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            ${existing ? `
              <div>
                <label class="label-technical">Influencer Partner</label>
                <p class="text-sm font-semibold mt-1">${esc(existing.influencer_legal_name || existing.influencer_display_name)}</p>
                <p class="font-mono text-xs text-on-surface-variant">${esc(existing.influencer_instagram_username || '')}</p>
                <input type="hidden" name="influencer_id" value="${existing.influencer_id}">
              </div>
            ` : field({
              label: 'Select Influencer', name: 'influencer_id', required: true,
              options: influencers.map(i => ({ value: i.id, label: `${i.display_name} (${i.instagram_username}) — ${i.legal_name}` })),
              value: agreement.influencer_id,
            })}

            ${field({
              label: 'Agreement Title', name: 'title', required: true, value: agreement.title,
            })}

            <div>
              <label class="label-technical">Revenue-Sharing Percentage (%)</label>
              <div class="flex items-center gap-2 mt-1">
                <input type="number" step="0.01" min="0.01" max="100" name="commission_percent" id="commission_percent"
                  class="input-text font-mono font-bold text-sm w-32" value="${(agreement.commission_basis_points / 100).toFixed(2)}">
                <span class="font-bold text-sm text-on-surface">%</span>
                <span class="text-xs text-on-surface-variant">(e.g. 10.00%, 15.00%)</span>
              </div>
              <p class="text-[11px] text-on-surface-variant mt-1">Commission percentage applied to verified eligible revenue.</p>
            </div>

            ${field({
              label: 'Commission Calculation Basis', name: 'commission_basis', id: 'commission_basis',
              options: [
                { value: 'NET_SALES_EX_GST', label: '1. Net eligible sales revenue excluding GST (Recommended)' },
                { value: 'COLLECTED_NET_REFUNDS', label: '2. Collected eligible revenue after approved refunds and discounts' },
                { value: 'GROSS_COLLECTED', label: '3. Gross collected revenue including tax' },
                { value: 'CUSTOM', label: '4. Custom contract calculation basis' },
              ],
              value: agreement.commission_basis,
            })}
          </div>

          <div id="custom-basis-wrap" class="mt-3 ${agreement.commission_basis === 'CUSTOM' ? '' : 'hidden'}">
            ${field({
              label: 'Custom Basis Description', name: 'custom_basis_description',
              value: agreement.custom_basis_description, placeholder: 'Explain exactly how commission is computed...',
            })}
          </div>
        </div>

        <!-- GST & Taxation Distinctions (Section 5) -->
        <div class="border border-outline p-4 bg-surface">
          <h3 class="font-headline text-xs font-bold uppercase tracking-wider mb-3 text-on-surface">2. GST & Statutory Tax Treatment</h3>
          <p class="text-xs text-on-surface-variant mb-4">Clearly distinguish product sales tax treatment from influencer service tax treatment:</p>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            ${field({
              label: 'Product Sales Tax Mode', name: 'product_tax_mode',
              options: [
                { value: 'EXCLUSIVE', label: 'GST Exclusive (Tax added on top of base product price)' },
                { value: 'INCLUSIVE', label: 'GST Inclusive (Base product price already includes GST)' },
              ],
              value: agreement.product_tax_mode,
              hint: 'Determines whether product sales price includes or excludes applicable GST.',
            })}

            ${field({
              label: 'Influencer Commission GST Terms', name: 'commission_tax_terms',
              options: [
                { value: 'EXCLUSIVE', label: 'GST Exclusive (Influencer adds applicable GST on their commission invoice)' },
                { value: 'INCLUSIVE', label: 'GST Inclusive (Agreed commission payout includes any applicable GST)' },
                { value: 'EXEMPT', label: 'GST Exempt / Not Applicable' },
              ],
              value: agreement.commission_tax_terms,
            })}

            ${field({
              label: 'Influencer Registered for GST?', name: 'influencer_gst_registered', id: 'influencer_gst_registered',
              options: [
                { value: 'false', label: 'No (Unregistered creator)' },
                { value: 'true', label: 'Yes (GST Registered business)' },
              ],
              value: String(agreement.influencer_gst_registered),
            })}

            <div id="gstin-wrap" class="${agreement.influencer_gst_registered ? '' : 'hidden'}">
              ${field({
                label: 'Influencer GSTIN', name: 'influencer_gstin', value: agreement.influencer_gstin,
                placeholder: '27AAAAA0000A1Z5',
              })}
            </div>

            ${field({
              label: 'TDS Withholding Section', name: 'withholding_section',
              options: [
                { value: '194H', label: 'Section 194H — Commission / Brokerage (Default 5%)' },
                { value: '194J', label: 'Section 194J — Professional / Technical Services' },
                { value: 'NONE', label: 'None / No statutory withholding' },
              ],
              value: agreement.withholding_section,
            })}

            <div>
              <label class="label-technical">TDS Withholding Rate (%)</label>
              <div class="flex items-center gap-2 mt-1">
                <input type="number" step="0.1" min="0" max="30" name="withholding_percent"
                  class="input-text font-mono text-xs w-28" value="${(agreement.withholding_tax_rate_bp / 100).toFixed(2)}">
                <span class="text-xs font-bold">%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Agreement Term & Payout Schedule -->
        <div class="border border-outline p-4 bg-surface">
          <h3 class="font-headline text-xs font-bold uppercase tracking-wider mb-3 text-on-surface">3. Agreement Duration & Payment Terms</h3>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            ${field({ label: 'Effective Start Date', name: 'start_date', type: 'date', value: agreement.start_date })}
            ${field({ label: 'Effective End Date', name: 'end_date', type: 'date', value: agreement.end_date || '' })}
            <div class="flex flex-col justify-center pt-5">
              <label class="inline-flex items-center gap-2 cursor-pointer text-xs font-medium">
                <input type="checkbox" name="is_indefinite" id="is_indefinite" ${agreement.is_indefinite ? 'checked' : ''} class="rounded border-outline">
                <span>Indefinite Duration (No expiry)</span>
              </label>
            </div>

            ${field({
              label: 'Settlement Frequency', name: 'payment_frequency',
              options: [
                { value: 'MONTHLY', label: 'Monthly Reconciliation' },
                { value: 'QUARTERLY', label: 'Quarterly Settlement' },
                { value: 'BI_MONTHLY', label: 'Bi-Monthly' },
                { value: 'ON_MILESTONE', label: 'On Deliverable Completion' },
              ],
              value: agreement.payment_frequency,
            })}

            ${field({
              label: 'Payment Due Period (days)', name: 'payment_due_days', type: 'number', min: '0', max: '365',
              value: String(agreement.payment_due_days),
              hint: 'Days after monthly reconciliation to process payout.',
            })}

            <div>
              <label class="label-technical">Minimum Payout Threshold (₹)</label>
              <input type="number" min="0" name="minimum_payout" class="input-text text-xs mt-1"
                value="${((agreement.minimum_payout_minor || 100000) / 100).toFixed(0)}">
              <p class="text-[11px] text-on-surface-variant mt-1">Earnings carry over until threshold reached.</p>
            </div>
          </div>
        </div>

        <!-- Section 3: Scope of Work / Deliverables Builder -->
        <div class="border border-outline p-4 bg-surface">
          <div class="flex items-center justify-between mb-3">
            <div>
              <h3 class="font-headline text-xs font-bold uppercase tracking-wider text-on-surface">4. Configurable Marketing Deliverables</h3>
              <p class="text-xs text-on-surface-variant">Specify agreed creator obligations for Nextora POS.</p>
            </div>
            ${button({ label: 'Add Deliverable', action: 'add-del-row', size: 'sm', icon: 'add' })}
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border border-outline">
              <thead class="bg-surface-dim border-b border-outline">
                <tr>
                  <th class="p-2">Deliverable Type</th>
                  <th class="p-2 w-16 text-center">Qty</th>
                  <th class="p-2 w-28">Frequency</th>
                  <th class="p-2">Deadline</th>
                  <th class="p-2">Required Tags / CTA</th>
                  <th class="p-2 w-12"></th>
                </tr>
              </thead>
              <tbody id="deliverables-tbody">
                ${renderDeliverablesRows()}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Signatories & Special Terms -->
        <div class="border border-outline p-4 bg-surface">
          <h3 class="font-headline text-xs font-bold uppercase tracking-wider mb-3 text-on-surface">5. Signatures & Special Conditions</h3>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            ${field({ label: 'Nextora Authorized Signatory Name', name: 'signatory_name', value: agreement.signatory_name })}
            ${field({ label: 'Designation / Title', name: 'signatory_title', value: agreement.signatory_title })}
            ${field({ label: 'Influencer Signatory Name', name: 'influencer_signatory_name', value: agreement.influencer_signatory_name, placeholder: 'Legal name of influencer' })}
            ${field({ label: 'Special Agreed Terms / Exclusivity', name: 'special_terms', type: 'textarea', value: agreement.special_terms, placeholder: 'Niche exclusivity, promotional coupon code rules...', className: 'sm:col-span-2' })}
          </div>
        </div>
      </form>`,
    footer: `
      ${button({ label: 'Cancel', action: 'close-modal' })}
      ${button({ label: existing ? 'Save Changes' : 'Create & Preview Agreement', action: 'save-agreement', variant: 'primary' })}
    `,
  });

  // UI Interactive wires
  node.querySelector('#commission_basis')?.addEventListener('change', e => {
    const customWrap = node.querySelector('#custom-basis-wrap');
    if (customWrap) customWrap.classList.toggle('hidden', e.target.value !== 'CUSTOM');
  });

  node.querySelector('#influencer_gst_registered')?.addEventListener('change', e => {
    const gstinWrap = node.querySelector('#gstin-wrap');
    if (gstinWrap) gstinWrap.classList.toggle('hidden', e.target.value !== 'true');
  });

  node.querySelector('#is_indefinite')?.addEventListener('change', e => {
    const endInput = node.querySelector('#end_date');
    if (endInput) endInput.disabled = e.target.checked;
  });

  // Dynamic deliverables handlers
  ctx.on('add-del-row', () => {
    currentDeliverables.push({
      type: 'Instagram Story', quantity: 4, frequency: 'Monthly', deadline: 'Weekly on Fridays',
      required_tags: '@nextoracreations #NextoraPOS', approval_requirements: '24h prior', performance_metrics: 'View count',
    });
    const tbody = node.querySelector('#deliverables-tbody');
    if (tbody) tbody.innerHTML = renderDeliverablesRows();
  });

  node.addEventListener('click', e => {
    const removeBtn = e.target.closest('[data-del-remove]');
    if (removeBtn) {
      const idx = Number(removeBtn.dataset.delRemove);
      currentDeliverables.splice(idx, 1);
      const tbody = node.querySelector('#deliverables-tbody');
      if (tbody) tbody.innerHTML = renderDeliverablesRows();
    }
  });

  ctx.on('save-agreement', async () => {
    const form = new FormData(node.querySelector('#agreement-form'));

    // Harvest deliverables
    const deliverables = currentDeliverables.map((_, i) => ({
      type: String(form.get(`del_type_${i}`) || 'Deliverable').trim(),
      quantity: Number(form.get(`del_qty_${i}`) || 1),
      frequency: String(form.get(`del_freq_${i}`) || 'Monthly').trim(),
      deadline: String(form.get(`del_deadline_${i}`) || '').trim(),
      required_tags: String(form.get(`del_tags_${i}`) || '').trim(),
      approval_requirements: '',
      performance_metrics: '',
    })).filter(d => d.type.length > 0);

    const commissionPercent = parseFloat(form.get('commission_percent') || '10');
    const commissionBp = Math.round(commissionPercent * 100);

    const withholdingPercent = parseFloat(form.get('withholding_percent') || '0');
    const withholdingBp = Math.round(withholdingPercent * 100);

    const minPayoutVal = parseFloat(form.get('minimum_payout') || '1000');
    const minPayoutMinor = Math.round(minPayoutVal * 100);

    const isIndefinite = node.querySelector('#is_indefinite')?.checked || false;

    const payload = {
      influencer_id: String(form.get('influencer_id')),
      title: String(form.get('title') || '').trim(),
      brand_name: String(form.get('brand_name') || 'Nextora Creations').trim(),
      product_name: String(form.get('product_name') || 'Nextora POS').trim(),
      commission_basis_points: commissionBp,
      commission_basis: String(form.get('commission_basis') || 'NET_SALES_EX_GST'),
      custom_basis_description: String(form.get('custom_basis_description') || '').trim(),
      product_tax_mode: String(form.get('product_tax_mode') || 'EXCLUSIVE'),
      commission_tax_terms: String(form.get('commission_tax_terms') || 'EXCLUSIVE'),
      influencer_gst_registered: form.get('influencer_gst_registered') === 'true',
      influencer_gstin: String(form.get('influencer_gstin') || '').trim().toUpperCase(),
      withholding_tax_rate_bp: withholdingBp,
      withholding_section: String(form.get('withholding_section') || '194H'),
      start_date: String(form.get('start_date')),
      end_date: isIndefinite ? null : (String(form.get('end_date')) || null),
      is_indefinite: isIndefinite,
      payment_frequency: String(form.get('payment_frequency') || 'MONTHLY'),
      payment_due_days: Number(form.get('payment_due_days') || 15),
      minimum_payout_minor: minPayoutMinor,
      deliverables,
      special_terms: String(form.get('special_terms') || '').trim(),
      signatory_name: String(form.get('signatory_name') || '').trim(),
      signatory_title: String(form.get('signatory_title') || '').trim(),
      influencer_signatory_name: String(form.get('influencer_signatory_name') || '').trim(),
    };

    try {
      const res = existing
        ? await api.patch(`/api/marketing/agreements/${existing.id}`, payload)
        : await api.post('/api/marketing/agreements', payload);
      closeModal();
      const agr = res.agreement;
      toast(existing ? 'Agreement updated.' : 'Agreement created as draft.');
      ctx.navigate(`#/marketing/contracts/${agr.id}/preview`);
    } catch (error) {
      const warnContainer = node.querySelector('#agreement-warnings');
      const details = error.fields?.length
        ? error.fields.map(item => `${item.field}: ${item.message}`).join(' · ')
        : error.message;
      if (warnContainer) warnContainer.innerHTML = alertBox(details, 'danger');
    }
  });
}

/* ---------------------------------------------------------------- Main Views */

async function renderDashboard(container, ctx) {
  container.innerHTML = pageHeader({
    title: 'Marketing & Partnerships',
    subtitle: 'Manage influencer marketing partnerships, commercial revenue-sharing agreements, and Nextora POS contract execution.',
    actions: `
      ${button({ label: 'New Influencer', action: 'new-influencer', variant: 'secondary', icon: 'person_add' })}
      ${button({ label: 'New Agreement', action: 'new-agreement', variant: 'primary', icon: 'add' })}
    `,
  }) + tabs('dashboard') + loading();

  let data;
  let recentAgreements = [];
  try {
    const [dashRes, agrRes] = await Promise.all([
      api.get('/api/marketing/dashboard'),
      api.get('/api/marketing/agreements?limit=5'),
    ]);
    data = dashRes;
    recentAgreements = agrRes.agreements || [];
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Marketing & Partnerships' }) + tabs('dashboard') + alertBox(error.message, 'danger');
    return;
  }

  container.innerHTML = `
    ${pageHeader({
      title: 'Marketing & Partnerships',
      subtitle: 'Manage influencer marketing partnerships, commercial revenue-sharing agreements, and Nextora POS contract execution.',
      actions: `
        ${button({ label: 'New Influencer', action: 'new-influencer', variant: 'secondary', icon: 'person_add' })}
        ${button({ label: 'New Agreement', action: 'new-agreement', variant: 'primary', icon: 'add' })}
      `,
    })}
    ${tabs('dashboard')}

    <!-- Summary KPI Cards -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
      ${stat({ label: 'Total Influencers', value: data.total_influencers, hint: 'Registered marketing creators' })}
      ${stat({ label: 'Active Partnerships', value: data.active_partnerships, tone: 'text-emerald-700', hint: 'Currently executed agreements' })}
      ${stat({ label: 'Contracts Awaiting Approval', value: data.contracts_awaiting_approval, tone: data.contracts_awaiting_approval ? 'text-amber-700' : '', hint: 'Pending internal review' })}
      ${stat({ label: 'Contracts Generated', value: data.contracts_generated, hint: 'Formal PDFs rendered' })}
      ${stat({
        label: 'Attributed Sales Revenue',
        value: money(data.total_attributed_revenue_minor),
        hint: data.has_verified_attribution ? 'From verified attributed sales' : 'Awaiting verified attribution records',
      })}
      ${stat({
        label: 'Commission Payable',
        value: money(data.total_commission_payable_minor),
        tone: data.total_commission_payable_minor ? 'text-cyan-accent' : '',
        hint: data.has_verified_attribution ? 'Calculated on verified net basis' : 'Based on approved sales transactions',
      })}
    </div>

    <!-- Quick Navigation Cards -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-3 mb-6">
      <div class="border border-outline bg-surface p-5">
        <h3 class="font-headline text-sm font-bold flex items-center gap-2">
          ${icon('campaign', '!text-[20px]')} Influencers
        </h3>
        <p class="mt-2 text-xs text-on-surface-variant">Maintain influencer contacts, Instagram handles, verified addresses, and content niches.</p>
        <div class="mt-4 flex gap-2">
          <a href="#/marketing/influencers" class="text-xs font-semibold underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">View all influencers →</a>
        </div>
      </div>

      <div class="border border-outline bg-surface p-5">
        <h3 class="font-headline text-sm font-bold flex items-center gap-2">
          ${icon('request_quote', '!text-[20px]')} Contracts & Agreements
        </h3>
        <p class="mt-2 text-xs text-on-surface-variant">Draft, configure deliverables, generate professional multi-page PDF agreements, and record executions.</p>
        <div class="mt-4 flex gap-2">
          <a href="#/marketing/contracts" class="text-xs font-semibold underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Manage contracts →</a>
        </div>
      </div>

      <div class="border border-outline bg-surface p-5">
        <h3 class="font-headline text-sm font-bold flex items-center gap-2">
          ${icon('upload_file', '!text-[20px]')} Brand Assets & Logos
        </h3>
        <p class="mt-2 text-xs text-on-surface-variant">Upload the Nextora POS product logo and view the Nextora Creations corporate logo for contracts.</p>
        <div class="mt-4 flex gap-2">
          <a href="#/marketing/brand-assets" class="text-xs font-semibold underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Brand asset manager →</a>
        </div>
      </div>
    </div>

    <!-- Recent Agreements Card -->
    ${card({
      title: 'Recent Marketing Partnership Contracts',
      subtitle: 'Latest generated or pending commercial agreements.',
      actions: `<a href="#/marketing/contracts" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">View All Agreements</a>`,
      body: recentAgreements.length ? `
        <div class="overflow-x-auto">
          <table class="data-table w-full min-w-[700px]">
            <thead>
              <tr>
                <th>Contract #</th>
                <th>Influencer</th>
                <th>Handle</th>
                <th class="text-right">Commission %</th>
                <th>Effective Period</th>
                <th>Status</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${recentAgreements.map(a => `
                <tr>
                  <td class="font-mono text-xs font-medium">
                    <a href="#/marketing/contracts/${esc(a.id)}/preview" class="underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">${esc(a.contract_number)}</a>
                  </td>
                  <td class="font-medium text-xs">${esc(a.influencer_legal_name || a.influencer_display_name)}</td>
                  <td class="font-mono text-xs text-on-surface-variant">${esc(a.influencer_instagram_username)}</td>
                  <td class="num text-right font-bold text-xs">${(a.commission_basis_points / 100).toFixed(2)}%</td>
                  <td class="text-xs text-on-surface-variant">${date(a.start_date)} – ${a.is_indefinite ? 'Indefinite' : date(a.end_date)}</td>
                  <td>${statusBadge(a.status)}</td>
                  <td class="text-right whitespace-nowrap">
                    <a href="#/marketing/contracts/${esc(a.id)}/preview" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent mr-2">Preview</a>
                    <a href="/api/marketing/agreements/${esc(a.id)}/pdf" target="_blank" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Download PDF</a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <div class="p-8 text-center text-xs text-on-surface-variant">
          No agreements generated yet. Click "New Agreement" to configure an influencer contract.
        </div>
      `,
    })}
  `;

  ctx.on('new-influencer', () => influencerForm(ctx));
  ctx.on('new-agreement', () => agreementForm(ctx));
}

async function renderInfluencers(container, params, ctx) {
  const filters = ctx.filters || {};
  container.innerHTML = pageHeader({
    title: 'Influencers',
    subtitle: 'Creator profiles, social identities, and contact information for Nextora Creations partnerships.',
    actions: button({ label: 'Add Influencer', action: 'new-influencer', variant: 'primary', icon: 'person_add' }),
  }) + tabs('influencers') + loading();

  let data;
  try {
    data = await api.get(`/api/marketing/influencers${query({
      search: filters.search, status: filters.status, page: ctx.page,
    })}`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Influencers' }) + tabs('influencers') + alertBox(error.message, 'danger');
    return;
  }

  container.innerHTML = `
    ${pageHeader({
      title: 'Influencers',
      subtitle: 'Creator profiles, social identities, and contact information for Nextora Creations partnerships.',
      actions: button({ label: 'Add Influencer', action: 'new-influencer', variant: 'primary', icon: 'person_add' }),
    })}
    ${tabs('influencers')}

    ${card({
      body: `
        <form id="influencer-filters" class="flex flex-wrap items-end gap-3 border-b border-outline px-5 py-4">
          ${field({ label: 'Search', name: 'search', value: filters.search || '', placeholder: 'Name, @handle, email, phone...', className: '' })}
          ${field({ label: 'Status', name: 'status', options: [
            { value: '', label: 'All Statuses' }, { value: 'ACTIVE', label: 'Active Partners' },
            { value: 'INACTIVE', label: 'Inactive' }, { value: 'ARCHIVED', label: 'Archived' },
          ], value: filters.status || '', className: '' })}
          <div class="flex gap-2 pb-0.5">${button({ label: 'Search', type: 'submit', variant: 'primary' })}</div>
        </form>

        ${data.influencers.length ? `
          <div class="overflow-x-auto">
            <table class="data-table w-full min-w-[900px]">
              <thead>
                <tr>
                  <th>Influencer</th>
                  <th>Instagram Handle</th>
                  <th>Contact Info</th>
                  <th>Location</th>
                  <th>Niche</th>
                  <th class="text-right">Followers</th>
                  <th class="text-center">Contracts</th>
                  <th>Status</th>
                  <th class="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${data.influencers.map(row => `
                  <tr>
                    <td>
                      <div class="font-medium text-sm">${esc(row.legal_name)}</div>
                      <div class="text-xs text-on-surface-variant">${esc(row.display_name)}</div>
                    </td>
                    <td class="font-mono text-xs">
                      ${row.instagram_url
                        ? `<a href="${esc(row.instagram_url)}" target="_blank" rel="noopener noreferrer" class="underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">${esc(row.instagram_username)}</a>`
                        : esc(row.instagram_username)}
                    </td>
                    <td class="text-xs">
                      <div>${esc(row.email || '—')}</div>
                      <div class="text-on-surface-variant font-mono text-[11px]">${esc(row.phone || '')}</div>
                    </td>
                    <td class="text-xs">${esc([row.city, row.state_code].filter(Boolean).join(', ') || '—')}</td>
                    <td class="text-xs">${esc(row.niche || '—')}</td>
                    <td class="num text-right text-xs">${row.follower_count ? row.follower_count.toLocaleString('en-IN') : '—'}</td>
                    <td class="text-center font-mono text-xs">${row.agreement_count}</td>
                    <td>${statusBadge(row.status)}</td>
                    <td class="text-right whitespace-nowrap">
                      <button type="button" data-action="new-agreement-for" data-id="${esc(row.id)}" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent mr-3">Create Contract</button>
                      <button type="button" data-action="edit-influencer" data-id="${esc(row.id)}" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Edit</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${pagination({ page: data.page, total: data.total, limit: data.limit })}
        ` : emptyState({
          icon: 'campaign', title: 'No influencers found',
          message: 'Add influencer creators to onboard them for Nextora POS marketing.',
          actionLabel: 'Add Influencer', action: 'new-influencer',
        })}
      `,
    })}
  `;

  ctx.on('new-influencer', () => influencerForm(ctx));

  container.querySelector('#influencer-filters')?.addEventListener('submit', e => {
    e.preventDefault();
    const form = new FormData(e.target);
    ctx.setFilters({ search: form.get('search'), status: form.get('status') });
    ctx.setPage(1);
    ctx.rerender();
  });

  ctx.on('edit-influencer', async trigger => {
    const id = trigger.dataset.id;
    try {
      const res = await api.get(`/api/marketing/influencers/${id}`);
      influencerForm(ctx, res.influencer);
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('new-agreement-for', trigger => {
    agreementForm(ctx, null, trigger.dataset.id);
  });
}

async function renderAgreements(container, params, ctx) {
  const filters = ctx.filters || {};
  container.innerHTML = pageHeader({
    title: 'Marketing Contracts & Agreements',
    subtitle: 'Revenue-sharing agreements, GST commercial terms, deliverables, and formal PDF generation.',
    actions: button({ label: 'New Agreement', action: 'new-agreement', variant: 'primary', icon: 'add' }),
  }) + tabs('contracts') + loading();

  let data;
  try {
    data = await api.get(`/api/marketing/agreements${query({
      search: filters.search, status: filters.status, page: ctx.page,
    })}`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Marketing Contracts & Agreements' }) + tabs('contracts') + alertBox(error.message, 'danger');
    return;
  }

  container.innerHTML = `
    ${pageHeader({
      title: 'Marketing Contracts & Agreements',
      subtitle: 'Revenue-sharing agreements, GST commercial terms, deliverables, and formal PDF generation.',
      actions: button({ label: 'New Agreement', action: 'new-agreement', variant: 'primary', icon: 'add' }),
    })}
    ${tabs('contracts')}

    ${card({
      body: `
        <form id="agreement-filters" class="flex flex-wrap items-end gap-3 border-b border-outline px-5 py-4">
          ${field({ label: 'Search', name: 'search', value: filters.search || '', placeholder: 'Contract #, influencer, Instagram handle...', className: '' })}
          ${field({ label: 'Status', name: 'status', options: [
            { value: '', label: 'All Statuses' },
            { value: 'DRAFT', label: 'Draft' },
            { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
            { value: 'SENT', label: 'Sent' },
            { value: 'ACCEPTED', label: 'Accepted' },
            { value: 'SIGNED', label: 'Signed' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'TERMINATED', label: 'Terminated' },
          ], value: filters.status || '', className: '' })}
          <div class="flex gap-2 pb-0.5">${button({ label: 'Search', type: 'submit', variant: 'primary' })}</div>
        </form>

        ${data.agreements.length ? `
          <div class="overflow-x-auto">
            <table class="data-table w-full min-w-[950px]">
              <thead>
                <tr>
                  <th>Contract #</th>
                  <th>Influencer Name</th>
                  <th>Instagram Handle</th>
                  <th class="text-right">Revenue Share</th>
                  <th>GST Treatment</th>
                  <th>Effective Period</th>
                  <th>Status</th>
                  <th>PDF Generated</th>
                  <th class="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${data.agreements.map(row => `
                  <tr>
                    <td class="font-mono text-xs font-medium">
                      <a href="#/marketing/contracts/${esc(row.id)}/preview" class="underline decoration-outline underline-offset-2 hover:decoration-cyan-accent font-bold">${esc(row.contract_number)}</a>
                      <div class="text-[10px] text-on-surface-variant">v${row.version || 1}</div>
                    </td>
                    <td class="text-xs">
                      <div class="font-medium">${esc(row.influencer_legal_name || '—')}</div>
                      <div class="text-on-surface-variant">${esc(row.influencer_display_name || '')}</div>
                    </td>
                    <td class="font-mono text-xs text-on-surface-variant">${esc(row.influencer_instagram_username || '—')}</td>
                    <td class="num text-right font-bold text-xs">${(row.commission_basis_points / 100).toFixed(2)}%</td>
                    <td class="text-[11px]">
                      <div>Sales: <span class="font-mono font-medium">${esc(row.product_tax_mode)}</span></div>
                      <div class="text-on-surface-variant">Comm: <span class="font-mono">${esc(row.commission_tax_terms)}</span></div>
                    </td>
                    <td class="text-xs text-on-surface-variant">
                      ${date(row.start_date)} – ${row.is_indefinite ? '<span class="italic">Indefinite</span>' : date(row.end_date)}
                    </td>
                    <td>${statusBadge(row.status)}</td>
                    <td class="text-xs text-on-surface-variant">${row.pdf_generated_at ? date(row.pdf_generated_at.slice(0, 10)) : '<span class="italic">Not yet</span>'}</td>
                    <td class="text-right whitespace-nowrap">
                      <a href="#/marketing/contracts/${esc(row.id)}/preview" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent mr-3">Preview</a>
                      <a href="/api/marketing/agreements/${esc(row.id)}/pdf" target="_blank" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent mr-3">Download</a>
                      ${['DRAFT', 'PENDING_APPROVAL'].includes(row.status)
                        ? `<button type="button" data-action="edit-draft-agreement" data-id="${esc(row.id)}" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent mr-3">Edit</button>`
                        : ''}
                      <button type="button" data-action="duplicate-agreement" data-id="${esc(row.id)}" class="text-xs text-on-surface-variant hover:text-on-surface">Copy</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${pagination({ page: data.page, total: data.total, limit: data.limit })}
        ` : emptyState({
          icon: 'request_quote', title: 'No agreements found',
          message: 'Configure a revenue-sharing agreement to generate formal influencer marketing contracts.',
          actionLabel: 'New Agreement', action: 'new-agreement',
        })}
      `,
    })}
  `;

  ctx.on('new-agreement', () => agreementForm(ctx));

  container.querySelector('#agreement-filters')?.addEventListener('submit', e => {
    e.preventDefault();
    const form = new FormData(e.target);
    ctx.setFilters({ search: form.get('search'), status: form.get('status') });
    ctx.setPage(1);
    ctx.rerender();
  });

  ctx.on('edit-draft-agreement', async trigger => {
    const id = trigger.dataset.id;
    try {
      const res = await api.get(`/api/marketing/agreements/${id}`);
      agreementForm(ctx, res.agreement);
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('duplicate-agreement', async trigger => {
    const id = trigger.dataset.id;
    try {
      const res = await api.post(`/api/marketing/agreements/${id}/duplicate`);
      toast('Draft duplicate created.');
      ctx.navigate(`#/marketing/contracts/${res.agreement.id}/preview`);
    } catch (err) { toast(err.message, 'danger'); }
  });
}

/* ---------------------------------------------------- Contract Preview Screen */

async function renderContractPreview(container, agreementId, ctx) {
  container.innerHTML = pageHeader({
    title: 'Contract Preview & Execution',
    breadcrumb: '<a href="#/marketing" class="hover:underline">Marketing</a> / <a href="#/marketing/contracts" class="hover:underline">Contracts</a> / Preview',
  }) + loading();

  let res;
  try {
    res = await api.get(`/api/marketing/agreements/${agreementId}/preview`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Contract Preview' }) + alertBox(error.message, 'danger');
    return;
  }

  const s = res.snapshot;
  const c = s.commercial_terms;
  const calc = s.illustrative_calculation;
  const deliverables = s.deliverables || [];

  container.innerHTML = `
    ${pageHeader({
      title: `${esc(s.contract_number)} — Preview`,
      subtitle: `${esc(s.title)} · Version ${s.version || 1}`,
      breadcrumb: '<a href="#/marketing" class="hover:underline">Marketing</a> / <a href="#/marketing/contracts" class="hover:underline">Contracts</a> / Preview',
      actions: `
        ${button({ label: 'Generate PDF', action: 'generate-pdf-btn', variant: 'primary', icon: 'download' })}
        <a href="/api/marketing/agreements/${esc(s.contract_id)}/pdf" target="_blank" class="inline-flex items-center gap-2 border px-3.5 py-2 text-sm font-medium border-outline bg-surface text-primary hover:bg-surface-dim">
          ${icon('download')}<span>Download PDF</span>
        </a>
        ${['DRAFT', 'PENDING_APPROVAL'].includes(s.status)
          ? button({ label: 'Edit Draft', action: 'edit-preview-draft', variant: 'secondary' })
          : ''}
        ${button({ label: 'Status Actions', action: 'open-status-modal', variant: 'secondary' })}
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
        Effective: <span class="font-medium text-on-surface">${date(s.effective_start_date)}</span> until <span class="font-medium text-on-surface">${s.is_indefinite ? 'Indefinite' : date(s.effective_end_date)}</span>
      </div>
    </div>

    <!-- The 10-Section Legal Agreement Document Container -->
    <div class="mx-auto max-w-4xl border border-outline bg-surface p-8 sm:p-12 shadow-sm font-body text-sm leading-relaxed text-on-surface">
      
      <!-- Document Header with Company & Product Brand Blocks -->
      <div class="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-outline pb-6 mb-8">
        <div>
          <h2 class="font-headline text-lg font-bold uppercase tracking-tight text-primary">${esc(s.business.business_name)}</h2>
          <p class="text-xs text-on-surface-variant">${esc(s.business.legal_name)}</p>
          <p class="text-xs text-on-surface-variant mt-1">${esc(s.business.address)}</p>
          <p class="text-xs text-on-surface-variant">${[s.business.email, s.business.phone, s.business.website].filter(Boolean).join(' · ')}</p>
          <p class="font-mono text-xs text-on-surface-variant mt-0.5">GSTIN: ${esc(s.business.gstin || '—')} · PAN: ${esc(s.business.pan || '—')}</p>
        </div>
        <div class="sm:text-right">
          <div class="inline-block border border-outline bg-surface-dim px-3 py-1 text-xs font-mono font-bold">
            CONTRACT #${esc(s.contract_number)}
          </div>
          <div class="mt-2 text-xs text-on-surface-variant">Product: <span class="font-bold text-on-surface">${esc(s.product_name)}</span></div>
          <div class="text-xs text-on-surface-variant">Partnership Version ${s.version || 1}</div>
        </div>
      </div>

      <!-- Agreement Title -->
      <div class="text-center mb-8">
        <h1 class="font-headline text-xl font-bold tracking-tight uppercase">${esc(s.title)}</h1>
        <p class="text-xs text-on-surface-variant mt-1">Marketing Partnership &amp; Commercial Revenue-Sharing Terms</p>
      </div>

      <!-- Section 1: Parties -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 1: Parties to the Agreement
        </h3>
        <p class="text-xs mb-3">This Influencer Marketing and Revenue-Sharing Agreement is entered into by and between:</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="border border-outline p-3 bg-surface-dim">
            <p class="label-technical">Brand &amp; Product Owner</p>
            <p class="font-bold text-sm mt-1">${esc(s.business.business_name)}</p>
            <p class="text-xs text-on-surface-variant">Brand and owner of ${esc(s.product_name)}</p>
            <p class="text-xs text-on-surface-variant mt-1">${esc(s.business.address)}</p>
          </div>
          <div class="border border-outline p-3 bg-surface-dim">
            <p class="label-technical">Influencer / Marketing Partner</p>
            <p class="font-bold text-sm mt-1">${esc(s.influencer.legal_name)}</p>
            <p class="text-xs text-on-surface-variant">Instagram: <span class="font-mono font-semibold">${esc(s.influencer.instagram_username)}</span></p>
            <p class="text-xs text-on-surface-variant">${esc([s.influencer.address, s.influencer.city, s.influencer.postal_code, s.influencer.country].filter(Boolean).join(', '))}</p>
            <p class="text-xs text-on-surface-variant">Email: ${esc(s.influencer.email || '—')} · Phone: ${esc(s.influencer.phone || '—')}</p>
          </div>
        </div>
      </div>

      <!-- Section 2: Purpose -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 2: Purpose of the Partnership
        </h3>
        <div class="text-xs space-y-2 whitespace-pre-line text-on-surface-variant leading-relaxed">
          ${esc(s.clauses.section_2_purpose)}
        </div>
      </div>

      <!-- Section 3: Scope of Work & Deliverables -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 3: Scope of Work and Responsibilities
        </h3>
        <p class="text-xs mb-3">The Influencer agrees to produce, publish, and maintain the following marketing deliverables:</p>
        ${deliverables.length ? `
          <div class="overflow-x-auto border border-outline">
            <table class="w-full text-left text-xs">
              <thead class="bg-surface-dim border-b border-outline">
                <tr>
                  <th class="p-2.5">Deliverable</th>
                  <th class="p-2.5 text-center w-16">Qty</th>
                  <th class="p-2.5">Frequency</th>
                  <th class="p-2.5">Deadline</th>
                  <th class="p-2.5">Required Tags / CTA</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-outline">
                ${deliverables.map(d => `
                  <tr>
                    <td class="p-2.5 font-medium">${esc(d.type)}</td>
                    <td class="p-2.5 text-center font-mono">${d.quantity}</td>
                    <td class="p-2.5 text-on-surface-variant">${esc(d.frequency)}</td>
                    <td class="p-2.5 text-on-surface-variant">${esc(d.deadline || 'Standard campaign timeline')}</td>
                    <td class="p-2.5 font-mono text-[11px] text-on-surface-variant">${esc(d.required_tags || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `<p class="text-xs text-on-surface-variant italic">Deliverables to be agreed in written campaign schedules.</p>`}
      </div>

      <!-- Section 4: Revenue-Sharing Terms -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 4: Revenue-Sharing Terms &amp; Calculation Mechanics
        </h3>
        <div class="text-xs space-y-2 whitespace-pre-line text-on-surface-variant leading-relaxed mb-4">
          ${esc(s.clauses.section_4_revenue_terms)}
        </div>

        <!-- Illustrative Table -->
        ${calc ? `
          <div class="border border-outline bg-surface-dim p-4 my-4">
            <h4 class="font-headline text-xs font-bold uppercase tracking-wider text-primary mb-2">Illustrative Calculation Example (Non-Binding)</h4>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <p class="text-on-surface-variant">Hypothetical Sale Amount:</p>
                <p class="font-mono font-bold">${money(calc.sample_sale_minor)}</p>
                <p class="text-[10px] text-on-surface-variant mt-0.5">Product Tax Mode: GST ${esc(c.product_tax_mode)}</p>
              </div>
              <div>
                <p class="text-on-surface-variant">Agreed Commission Rate:</p>
                <p class="font-mono font-bold text-cyan-accent">${calc.commission_percentage}%</p>
                <p class="text-[10px] text-on-surface-variant mt-0.5">Basis: ${esc(calc.basis_explanation)}</p>
              </div>
              <div>
                <p class="text-on-surface-variant">Net Influencer Payout:</p>
                <p class="font-mono font-bold text-emerald-700">${money(calc.net_commission_payable_minor)}</p>
                <p class="text-[10px] text-on-surface-variant mt-0.5">Less ${(calc.withholding_tax_rate_bp / 100).toFixed(2)}% TDS (${esc(c.withholding_section)})</p>
              </div>
            </div>
            <p class="text-[10px] text-on-surface-variant italic mt-3 border-t border-outline pt-2">${esc(calc.disclaimer)}</p>
          </div>
        ` : ''}
      </div>

      <!-- Section 5: Conduct -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 5: Marketing Obligations and Professional Conduct
        </h3>
        <div class="text-xs space-y-2 whitespace-pre-line text-on-surface-variant leading-relaxed">
          ${esc(s.clauses.section_5_conduct_obligations)}
        </div>
      </div>

      <!-- Section 6: IP -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 6: Brand Assets and Intellectual Property
        </h3>
        <div class="text-xs space-y-2 whitespace-pre-line text-on-surface-variant leading-relaxed">
          ${esc(s.clauses.section_6_brand_intellectual_property)}
        </div>
      </div>

      <!-- Section 7: Payment & Invoicing -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 7: Payment Schedule, Invoicing &amp; Taxes
        </h3>
        <div class="text-xs space-y-2 whitespace-pre-line text-on-surface-variant leading-relaxed">
          ${esc(s.clauses.section_7_payment_invoicing)}
        </div>
      </div>

      <!-- Section 8: Term & Termination -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 8: Term, Termination &amp; Post-Termination Rights
        </h3>
        <div class="text-xs space-y-2 whitespace-pre-line text-on-surface-variant leading-relaxed">
          ${esc(s.clauses.section_8_term_termination)}
        </div>
      </div>

      <!-- Section 9: Legal Terms -->
      <div class="mb-8">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
          Section 9: General Legal Provisions
        </h3>
        <div class="text-xs space-y-2 whitespace-pre-line text-on-surface-variant leading-relaxed">
          ${esc(s.clauses.section_9_general_legal)}
        </div>
      </div>

      ${s.special_terms ? `
        <div class="mb-8">
          <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-3">
            Special Agreed Terms &amp; Conditions
          </h3>
          <p class="text-xs text-on-surface-variant whitespace-pre-line leading-relaxed">${esc(s.special_terms)}</p>
        </div>
      ` : ''}

      <!-- Section 10: Signatures -->
      <div class="mt-12 pt-6 border-t-2 border-outline">
        <h3 class="font-headline text-xs font-bold uppercase tracking-wider bg-surface-dim px-3 py-1.5 border-l-4 border-primary mb-6">
          Section 10: Acceptance and Signatures
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-8 text-xs">
          <div class="border border-outline p-4 bg-surface">
            <p class="label-technical mb-6">For Nextora Creations:</p>
            <div class="border-b border-outline pb-1 mb-2"></div>
            <p class="font-bold">${esc(s.business.signatory_name)}</p>
            <p class="text-on-surface-variant">${esc(s.business.signatory_title)}</p>
            <p class="text-on-surface-variant mt-2 font-mono text-[11px]">Date: ____________________</p>
          </div>
          <div class="border border-outline p-4 bg-surface">
            <p class="label-technical mb-6">For Influencer / Marketing Partner:</p>
            <div class="border-b border-outline pb-1 mb-2"></div>
            <p class="font-bold">${esc(s.influencer.legal_name)}</p>
            <p class="text-on-surface-variant">${esc(s.influencer.instagram_username)}</p>
            <p class="text-on-surface-variant mt-2 font-mono text-[11px]">Date: ____________________</p>
          </div>
        </div>
        <p class="text-[10px] text-on-surface-variant italic mt-6 text-center">
          Note: Previewing or downloading this document does not constitute proof of signature. Both parties must execute this Agreement via verified electronic signature or physical ink signature before active commercial settlement begins.
        </p>
      </div>
    </div>
  `;

  ctx.on('generate-pdf-btn', async () => {
    try {
      const res = await api.post(`/api/marketing/agreements/${agreementId}/generate-pdf`);
      toast('Contract PDF generated and snapshot preserved.');
      ctx.rerender();
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('edit-preview-draft', async () => {
    try {
      const res = await api.get(`/api/marketing/agreements/${agreementId}`);
      agreementForm(ctx, res.agreement);
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('open-status-modal', () => {
    const node = modal({
      title: 'Update Contract Status',
      body: `
        <form id="status-action-form" class="space-y-4">
          ${field({
            label: 'Transition Action', name: 'action',
            options: [
              { value: 'SUBMIT_APPROVAL', label: 'Submit for Internal Approval (DRAFT → PENDING)' },
              { value: 'APPROVE', label: 'Approve Agreement (PENDING → APPROVED DRAFT)' },
              { value: 'SEND', label: 'Mark as Sent to Influencer (DRAFT → SENT)' },
              { value: 'ACCEPT', label: 'Record Acceptance by Influencer (SENT → ACCEPTED)' },
              { value: 'SIGN', label: 'Record Formal Signature (ACCEPTED → SIGNED)' },
              { value: 'ACTIVATE', label: 'Activate Partnership (SIGNED → ACTIVE)' },
              { value: 'TERMINATE', label: 'Terminate Partnership (→ TERMINATED)' },
            ],
            value: s.status === 'DRAFT' ? 'SUBMIT_APPROVAL' : (s.status === 'SENT' ? 'ACCEPT' : 'SIGN'),
          })}
          ${field({ label: 'Effective Date', name: 'date', type: 'date', value: new Date().toISOString().slice(0, 10) })}
          ${field({ label: 'Reason / Status Notes', name: 'reason', type: 'textarea', placeholder: 'Document notes or reason for termination...' })}
        </form>
      `,
      footer: `
        ${button({ label: 'Cancel', action: 'close-modal' })}
        ${button({ label: 'Apply Transition', action: 'confirm-status-transition', variant: 'primary' })}
      `,
    });

    ctx.on('confirm-status-transition', async () => {
      const form = new FormData(node.querySelector('#status-action-form'));
      try {
        await api.post(`/api/marketing/agreements/${agreementId}/status`, {
          action: String(form.get('action')),
          date: String(form.get('date')),
          reason: String(form.get('reason') || ''),
        });
        closeModal();
        toast('Agreement status updated.');
        ctx.rerender();
      } catch (err) { toast(err.message, 'danger'); }
    });
  });
}

/* ------------------------------------------------ Brand Assets Manager */

async function renderBrandAssets(container, ctx) {
  container.innerHTML = pageHeader({
    title: 'Brand Assets & Logos',
    subtitle: 'Manage Nextora Creations corporate logo and Nextora POS product logo for agreements and invoices.',
  }) + tabs('brand-assets') + loading();

  container.innerHTML = `
    ${pageHeader({
      title: 'Brand Assets & Logos',
      subtitle: 'Manage Nextora Creations corporate logo and Nextora POS product logo for agreements and invoices.',
    })}
    ${tabs('brand-assets')}

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- Nextora POS Product Logo -->
      ${card({
        title: 'Nextora POS Product Logo',
        subtitle: 'Embedded beside agreement title and dedicated brand section in marketing partnership contracts.',
        body: `
          <div class="p-5">
            <div class="mb-4 flex items-center justify-center border border-dashed border-outline bg-surface-dim h-40 p-4">
              <img id="product-logo-img" src="/api/marketing/product-logo?t=${Date.now()}" alt="Nextora POS Logo"
                class="max-h-32 max-w-full object-contain"
                onerror="this.style.display='none'; document.getElementById('prod-logo-placeholder').style.display='block';">
              <div id="prod-logo-placeholder" class="hidden text-center text-xs text-on-surface-variant">
                ${icon('campaign', '!text-[36px] block mx-auto mb-2')}
                <span>No product logo uploaded yet.<br>Contract will use clean text header.</span>
              </div>
            </div>

            <div class="space-y-3">
              <div>
                <label class="label-technical mb-1.5 block" for="prod-logo-input">Upload Nextora POS Logo (PNG/JPEG, max 1 MB)</label>
                <input id="prod-logo-input" type="file" accept="image/png,image/jpeg" class="text-xs">
              </div>
              <div class="flex gap-2">
                ${button({ label: 'Upload Product Logo', action: 'upload-product-logo', variant: 'primary', icon: 'upload_file' })}
              </div>
              <p class="text-[11px] text-on-surface-variant">Validated as a real PNG/JPEG file, transparent background preserved, scaled proportionally without distortion.</p>
            </div>
          </div>
        `,
      })}

      <!-- Nextora Creations Company Logo -->
      ${card({
        title: 'Nextora Creations Company Logo',
        subtitle: 'Primary brand letterhead logo rendered in header across invoices, quotations, and partnership agreements.',
        body: `
          <div class="p-5">
            <div class="mb-4 flex items-center justify-center border border-dashed border-outline bg-surface-dim h-40 p-4">
              <img id="company-logo-img" src="/api/settings/logo?t=${Date.now()}" alt="Nextora Creations Company Logo"
                class="max-h-32 max-w-full object-contain"
                onerror="this.style.display='none'; document.getElementById('comp-logo-placeholder').style.display='block';">
              <div id="comp-logo-placeholder" class="hidden text-center text-xs text-on-surface-variant">
                ${icon('receipt_long', '!text-[36px] block mx-auto mb-2')}
                <span>No company logo uploaded yet.<br>Default typographic header used.</span>
              </div>
            </div>

            <div class="space-y-3">
              <div>
                <label class="label-technical mb-1.5 block" for="comp-logo-input">Upload Corporate Logo (PNG, max 500 KB)</label>
                <input id="comp-logo-input" type="file" accept="image/png" class="text-xs">
              </div>
              <div class="flex gap-2">
                ${button({ label: 'Upload Company Logo', action: 'upload-company-logo', variant: 'secondary', icon: 'upload_file' })}
              </div>
              <p class="text-[11px] text-on-surface-variant">Reuses existing corporate media pipeline. Automatically appears on every generated contract header.</p>
            </div>
          </div>
        `,
      })}
    </div>
  `;

  ctx.on('upload-product-logo', () => {
    const input = container.querySelector('#prod-logo-input');
    const file = input?.files?.[0];
    if (!file) { toast('Please choose an image file first.', 'warn'); return; }
    if (file.size > 1048576) { toast('Product logo must be 1 MB or smaller.', 'danger'); return; }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api.post('/api/marketing/product-logo', { logo: String(reader.result) });
        toast('Nextora POS product logo uploaded successfully.');
        ctx.rerender();
      } catch (err) { toast(err.message, 'danger'); }
    };
    reader.readAsDataURL(file);
  });

  ctx.on('upload-company-logo', () => {
    const input = container.querySelector('#comp-logo-input');
    const file = input?.files?.[0];
    if (!file) { toast('Please choose an image file first.', 'warn'); return; }
    if (file.size > 512000) { toast('Company logo must be 500 KB or smaller.', 'danger'); return; }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api.post('/api/settings/logo', { png: String(reader.result) });
        toast('Corporate logo uploaded successfully.');
        ctx.rerender();
      } catch (err) { toast(err.message, 'danger'); }
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------------------------- Import Influencer Sales */

export async function renderSalesImport(container, ctx) {
  let previewData = null;
  let remappings = {};
  const { batches } = await api.get('/api/marketing/sales/batches').catch(() => ({ batches: [] }));

  function renderView() {
    container.innerHTML = `
      ${pageHeader({
        title: 'Import Influencer Sales',
        subtitle: 'Upload customer purchase records from Excel to attribute sales, segregate by influencer, and compute revenue sharing.',
        actions: `
          <a href="/api/marketing/sales/template" download class="btn btn-secondary inline-flex items-center gap-2">
            ${icon('download', '!text-[18px]')}<span>Download Sample Template</span>
          </a>
        `,
      })}

      ${tabs('import')}

      <div class="space-y-6">
        <!-- File Upload Area -->
        ${card({
          title: 'Upload Spreadsheet (.xlsx, .csv)',
          body: `
            <div class="p-5">
              <div class="flex flex-col sm:flex-row items-center gap-4">
                <input id="sales-excel-input" type="file" accept=".xlsx,.xls,.csv" class="block w-full text-sm text-on-surface-variant file:mr-4 file:py-2 file:px-4 file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-on-primary hover:file:bg-primary-hover">
                <button type="button" id="btn-preview-file" class="btn btn-primary whitespace-nowrap inline-flex items-center gap-2">
                  ${icon('search', '!text-[18px]')}<span>Inspect &amp; Preview</span>
                </button>
              </div>
              <p class="mt-2 text-xs text-on-surface-variant">
                Required columns: S.No., Customer Name, Business Name, Purchased Date, Product Name, Expiry Date, Customer Location, Influencer Name. Financial columns (Sale Amount, Discount, GST %, Refund) are optional.
              </p>
            </div>
          `,
        })}

        <!-- Staged Preview Section -->
        ${previewData ? `
          <div id="staged-preview-container" class="space-y-6">
            <!-- Metrics Bar -->
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
              ${card({ body: `<div class="p-3"><p class="text-xs text-on-surface-variant font-mono">TOTAL ROWS</p><p class="text-xl font-bold">${previewData.total_rows}</p></div>` })}
              ${card({ body: `<div class="p-3"><p class="text-xs text-emerald-700 font-mono">VALID ROWS</p><p class="text-xl font-bold text-emerald-700">${previewData.valid_rows_count}</p></div>` })}
              ${card({ body: `<div class="p-3"><p class="text-xs text-amber-700 font-mono">DUPLICATES</p><p class="text-xl font-bold text-amber-700">${previewData.duplicate_rows_count}</p></div>` })}
              ${card({ body: `<div class="p-3"><p class="text-xs text-blue-700 font-mono">UNMATCHED INFLUENCERS</p><p class="text-xl font-bold text-blue-700">${previewData.unmatched_influencer_count}</p></div>` })}
              ${card({ body: `<div class="p-3"><p class="text-xs text-red-700 font-mono">INVALID ROWS</p><p class="text-xl font-bold text-red-700">${previewData.invalid_rows_count}</p></div>` })}
            </div>

            <!-- Unmatched Influencer Remapping Section -->
            ${previewData.unmatched_influencer_count > 0 ? `
              ${card({
                title: 'Resolve Unmatched Influencer Names',
                body: `
                  <div class="p-5">
                    <p class="text-xs text-on-surface-variant mb-3">
                      The following names in your spreadsheet could not be matched automatically. Map them to an existing partner, or leave unassigned to review later.
                    </p>
                    <div class="space-y-3">
                      ${[...new Set(previewData.preview_rows.filter(r => !r.influencer_id).map(r => r.raw_influencer_name))].map(rawName => `
                        <div class="flex items-center justify-between border-b border-outline pb-2">
                          <span class="font-mono text-xs font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 border border-amber-200">${esc(rawName)}</span>
                          <div class="flex items-center gap-2">
                            <span class="text-xs text-on-surface-variant">Map to:</span>
                            <select class="inf-remap-select select-field text-xs py-1 px-2 border border-outline bg-surface" data-raw="${esc(rawName)}">
                              <option value="">-- Leave Unassigned --</option>
                              ${(previewData.influencers || []).map(inf => `
                                <option value="${inf.id}" ${remappings[rawName] === inf.id ? 'selected' : ''}>
                                  ${esc(inf.display_name)} (${esc(inf.instagram_username || '-')})
                                </option>
                              `).join('')}
                            </select>
                          </div>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                `
              })}
            ` : ''}

            <!-- Validation Errors Alert & Download -->
            ${previewData.errors?.length > 0 ? `
              <div class="p-4 border border-red-200 bg-red-50 text-red-900 text-xs space-y-2">
                <div class="flex items-center justify-between">
                  <span class="font-semibold">${previewData.errors.length} invalid rows detected (these rows will be skipped during import):</span>
                  <button type="button" id="btn-download-errors" class="btn btn-secondary text-xs py-1 px-2">Download Error Report (CSV)</button>
                </div>
                <ul class="list-disc pl-5 space-y-1 max-h-32 overflow-y-auto">
                  ${previewData.errors.slice(0, 10).map(e => `
                    <li>Row ${e.row}: ${esc(e.error)} (${esc(e.customer_name || 'No customer name')})</li>
                  `).join('')}
                  ${previewData.errors.length > 10 ? `<li>...and ${previewData.errors.length - 10} more errors.</li>` : ''}
                </ul>
              </div>
            ` : ''}

            <!-- Options & Confirmation -->
            <div class="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border border-outline bg-surface">
              <div class="flex items-center gap-6">
                <label class="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input type="checkbox" id="chk-allow-duplicates" class="rounded border-outline text-primary">
                  <span>Allow duplicate records / re-import previously imported rows</span>
                </label>
                <input id="input-import-notes" type="text" placeholder="Optional batch notes..." class="text-xs py-1 px-2 border border-outline bg-surface">
              </div>
              <div class="flex items-center gap-3">
                <button type="button" id="btn-cancel-preview" class="btn btn-secondary text-xs">Cancel Preview</button>
                <button type="button" id="btn-confirm-import" class="btn btn-primary text-xs" ${previewData.valid_rows_count === 0 ? 'disabled' : ''}>
                  Confirm &amp; Apply Import (${previewData.valid_rows_count} Rows)
                </button>
              </div>
            </div>

            <!-- Preview Data Table -->
            ${card({
              title: `Previewing Staged Records (Showing First ${Math.min(50, previewData.preview_rows.length)} of ${previewData.total_rows})`,
              body: `
                <div class="overflow-x-auto">
                  <table class="w-full text-left text-xs">
                    <thead class="border-b border-outline bg-surface-dim font-mono uppercase text-[11px] text-on-surface-variant">
                      <tr>
                        <th class="p-3">S.No.</th>
                        <th class="p-3">Status</th>
                        <th class="p-3">Customer Name</th>
                        <th class="p-3">Business Name</th>
                        <th class="p-3">Purchased Date</th>
                        <th class="p-3">Product</th>
                        <th class="p-3">Location</th>
                        <th class="p-3">Influencer</th>
                        <th class="p-3 text-right">Sale Amount</th>
                        <th class="p-3 text-right">Eligible Rev</th>
                        <th class="p-3 text-right">Commission</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-outline">
                      ${previewData.preview_rows.map(r => `
                        <tr class="${r.is_valid ? '' : 'bg-red-50/40'}">
                          <td class="p-3 font-mono">${r.serial_number}</td>
                          <td class="p-3 whitespace-nowrap">
                            ${!r.is_valid ? '<span class="badge badge-danger">Invalid</span>' :
                              r.is_duplicate ? '<span class="badge badge-warn">Duplicate</span>' :
                              '<span class="badge badge-success">Valid</span>'}
                          </td>
                          <td class="p-3 font-semibold">${esc(r.customer_name)}</td>
                          <td class="p-3 text-on-surface-variant">${esc(r.business_name || '-')}</td>
                          <td class="p-3 whitespace-nowrap">${r.purchased_date ? date(r.purchased_date) : '-'}</td>
                          <td class="p-3">${esc(r.product_name)}</td>
                          <td class="p-3 text-on-surface-variant">${esc(r.customer_location || '-')}</td>
                          <td class="p-3 whitespace-nowrap">
                            ${r.influencer_name ? `<span class="font-medium">${esc(r.influencer_name)}</span>` :
                              `<span class="text-amber-800 font-mono text-[10px] bg-amber-50 px-1 border border-amber-200">Unmatched: ${esc(r.raw_influencer_name)}</span>`}
                          </td>
                          <td class="p-3 text-right font-mono">${r.sale_amount_minor !== null ? money(r.sale_amount_minor) : '-'}</td>
                          <td class="p-3 text-right font-mono">${r.eligible_revenue_minor !== null ? money(r.eligible_revenue_minor) : '<span class="text-[10px] text-on-surface-variant italic">Awaiting</span>'}</td>
                          <td class="p-3 text-right font-mono font-semibold">${r.calculated_commission_minor !== null ? money(r.calculated_commission_minor) : '-'}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `
            })}
          </div>
        ` : ''}

        <!-- Import History Table -->
        ${card({
          title: 'Import History & Batches',
          body: batches.length === 0 ? `
            <div class="p-8 text-center text-xs text-on-surface-variant">No sales batches have been imported yet.</div>
          ` : `
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead class="border-b border-outline bg-surface-dim font-mono uppercase text-[11px] text-on-surface-variant">
                  <tr>
                    <th class="p-3">Import Date</th>
                    <th class="p-3">Spreadsheet File</th>
                    <th class="p-3 text-center">Total Rows</th>
                    <th class="p-3 text-center">Valid</th>
                    <th class="p-3 text-center">Duplicates</th>
                    <th class="p-3">Imported By</th>
                    <th class="p-3">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-outline">
                  ${batches.map(b => `
                    <tr>
                      <td class="p-3 whitespace-nowrap">${date(b.imported_at)}</td>
                      <td class="p-3 font-semibold font-mono">${esc(b.filename)}</td>
                      <td class="p-3 text-center font-mono">${b.row_count}</td>
                      <td class="p-3 text-center font-mono text-emerald-700 font-bold">${b.valid_row_count}</td>
                      <td class="p-3 text-center font-mono text-amber-700">${b.duplicate_row_count}</td>
                      <td class="p-3">${esc(b.imported_by_name || '-')}</td>
                      <td class="p-3">${statusBadge(b.status)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `
        })}
      </div>
    `;

    // Attach listeners
    container.querySelector('#btn-preview-file')?.addEventListener('click', async () => {
      const fileInput = container.querySelector('#sales-excel-input');
      const file = fileInput?.files?.[0];
      if (!file) { toast('Select a spreadsheet file first.', 'warn'); return; }

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = String(reader.result).split(',')[1];
          const res = await api.post('/api/marketing/sales/preview-import', {
            filename: file.name,
            content_base64: base64
          });
          previewData = res;
          remappings = {};
          renderView();
          toast(`Inspected ${res.total_rows} rows from ${file.name}.`);
        } catch (err) {
          toast(err.message || 'Failed to inspect file.', 'danger');
        }
      };
      reader.readAsDataURL(file);
    });

    container.querySelectorAll('.inf-remap-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const raw = sel.dataset.raw;
        remappings[raw] = sel.value;
      });
    });

    container.querySelector('#btn-cancel-preview')?.addEventListener('click', () => {
      previewData = null;
      renderView();
    });

    container.querySelector('#btn-download-errors')?.addEventListener('click', () => {
      if (!previewData?.errors?.length) return;
      const csv = ['Row,Customer Name,Error',
        ...previewData.errors.map(e => `${e.row},"${String(e.customer_name || '').replace(/"/g, '""')}","${String(e.error).replace(/"/g, '""')}"`)
      ].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import_errors_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });

    container.querySelector('#btn-confirm-import')?.addEventListener('click', async () => {
      if (!previewData) return;
      const allowDupes = Boolean(container.querySelector('#chk-allow-duplicates')?.checked);
      const notes = String(container.querySelector('#input-import-notes')?.value || '');

      try {
        const res = await api.post('/api/marketing/sales/confirm-import', {
          filename: previewData.filename,
          file_sha256: previewData.file_sha256,
          staged_rows: previewData.all_staged_rows,
          influencer_mappings: remappings,
          allow_duplicates: allowDupes,
          notes
        });
        toast(`Successfully imported ${res.imported_count} sales records!`);
        location.hash = '#/marketing/reports';
      } catch (err) {
        toast(err.message || 'Import failed.', 'danger');
      }
    });
  }

  renderView();
}

/* ---------------------------------------------------- Influencer Sales Reports */

export async function renderSalesReports(container, params, ctx) {
  let search = '';
  let fromDate = '';
  let toDate = '';
  let productId = '';

  async function loadAndRender() {
    container.innerHTML = loading();
    try {
      const data = await api.get(query('/api/marketing/sales/dashboard', { search, fromDate, toDate, productId }));
      const kpis = data.kpis || {};
      const influencers = data.influencers || [];

      container.innerHTML = `
        ${pageHeader({
          title: 'Influencer Sales Reports',
          subtitle: 'Track attributed customer purchases, calculate revenue share, and export individual or consolidated financial reports.',
          actions: `
            <a href="/api/marketing/sales/consolidated-report.pdf" target="_blank" class="btn btn-secondary inline-flex items-center gap-2">
              ${icon('picture_as_pdf', '!text-[18px]')}<span>Consolidated PDF</span>
            </a>
            <a href="/api/marketing/sales/export.xlsx" download class="btn btn-secondary inline-flex items-center gap-2">
              ${icon('download', '!text-[18px]')}<span>Export All (Excel)</span>
            </a>
            <a href="#/marketing/import" class="btn btn-primary inline-flex items-center gap-2">
              ${icon('upload_file', '!text-[18px]')}<span>Import Sales Excel</span>
            </a>
          `,
        })}

        ${tabs('reports')}

        <div class="space-y-6">
          <!-- KPI Summary Cards -->
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            ${card({ body: `<div class="p-3"><p class="text-[10px] text-on-surface-variant font-mono">TOTAL ORDERS</p><p class="text-xl font-bold">${kpis.total_valid_sales || 0}</p></div>` })}
            ${card({ body: `<div class="p-3"><p class="text-[10px] text-on-surface-variant font-mono">INFLUENCERS</p><p class="text-xl font-bold">${kpis.total_influencers_with_sales || 0}</p></div>` })}
            ${card({ body: `<div class="p-3"><p class="text-[10px] text-emerald-700 font-mono">VERIFIED REVENUE</p><p class="text-xl font-bold text-emerald-700">${money(kpis.total_verified_revenue_minor || 0)}</p></div>` })}
            ${card({ body: `<div class="p-3"><p class="text-[10px] text-blue-700 font-mono">CALCULATED COMM</p><p class="text-xl font-bold text-blue-700">${money(kpis.total_calculated_commission_minor || 0)}</p></div>` })}
            ${card({ body: `<div class="p-3"><p class="text-[10px] text-amber-700 font-mono">PENDING PAYOUT</p><p class="text-xl font-bold text-amber-700">${money(kpis.pending_commission_minor || 0)}</p></div>` })}
            ${card({ body: `<div class="p-3"><p class="text-[10px] text-emerald-800 font-mono">SETTLED / PAID</p><p class="text-xl font-bold text-emerald-800">${money(kpis.paid_commission_minor || 0)}</p></div>` })}
            ${card({ body: `<div class="p-3"><p class="text-[10px] text-on-surface-variant font-mono">UNVERIFIED SALES</p><p class="text-xl font-bold ${kpis.unverified_revenue_count > 0 ? 'text-amber-800 font-semibold' : ''}">${kpis.unverified_revenue_count || 0}</p></div>` })}
          </div>

          <!-- Influencer Performance Table -->
          ${card({
            title: 'Influencer Performance & Revenue-Sharing Summary',
            body: influencers.length === 0 ? `
              <div class="p-12 text-center text-xs text-on-surface-variant">
                No attributed sales records found. Upload a customer sales spreadsheet in the <a href="#/marketing/import" class="text-primary font-semibold underline">Import Sales Excel</a> section.
              </div>
            ` : `
              <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                  <thead class="border-b border-outline bg-surface-dim font-mono uppercase text-[11px] text-on-surface-variant">
                    <tr>
                      <th class="p-3">Influencer</th>
                      <th class="p-3 text-center">Total Sales</th>
                      <th class="p-3 text-right">Verified Revenue</th>
                      <th class="p-3 text-center">Commission Rate</th>
                      <th class="p-3 text-right">Calculated Comm</th>
                      <th class="p-3 text-right">Pending</th>
                      <th class="p-3 text-right">Paid</th>
                      <th class="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-outline">
                    ${influencers.map(inf => `
                      <tr class="hover:bg-surface-dim transition-colors">
                        <td class="p-3">
                          <p class="font-semibold text-on-surface">${esc(inf.display_name)}</p>
                          <p class="font-mono text-[10px] text-on-surface-variant">${esc(inf.instagram_username || '-')}</p>
                        </td>
                        <td class="p-3 text-center font-mono font-bold">${inf.total_sales}</td>
                        <td class="p-3 text-right font-mono text-emerald-700 font-semibold">
                          ${inf.verified_sales_count > 0 ? money(inf.verified_revenue_minor) : '<span class="text-[10px] text-on-surface-variant italic">Awaiting</span>'}
                        </td>
                        <td class="p-3 text-center font-mono">
                          ${inf.commission_basis_points ? `${(inf.commission_basis_points / 100).toFixed(1)}%` : '10.0%'}
                        </td>
                        <td class="p-3 text-right font-mono font-bold text-blue-700">
                          ${inf.verified_sales_count > 0 ? money(inf.calculated_commission_minor) : '<span class="text-[10px] text-on-surface-variant italic">Awaiting</span>'}
                        </td>
                        <td class="p-3 text-right font-mono text-amber-700">${money(inf.pending_commission_minor)}</td>
                        <td class="p-3 text-right font-mono text-emerald-700">${money(inf.paid_commission_minor)}</td>
                        <td class="p-3 text-right">
                          <div class="flex items-center justify-end gap-1.5">
                            <button type="button" class="btn btn-secondary text-xs py-1 px-2.5 btn-view-sales" data-id="${inf.influencer_id}">
                              ${icon('visibility', '!text-[14px]')}<span>View Sales</span>
                            </button>
                            <a href="/api/marketing/influencers/${inf.influencer_id}/sales/report.pdf" target="_blank" class="btn btn-secondary text-xs py-1 px-2" title="Generate &amp; Download PDF">
                              ${icon('picture_as_pdf', '!text-[14px]')}
                            </a>
                            <a href="/api/marketing/influencers/${inf.influencer_id}/sales/export.xlsx" download class="btn btn-secondary text-xs py-1 px-2" title="Export Excel">
                              ${icon('download', '!text-[14px]')}
                            </a>
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `
          })}
        </div>
      `;

      // Attach view sales drilldown modal handler
      container.querySelectorAll('.btn-view-sales').forEach(btn => {
        btn.addEventListener('click', async () => {
          const infId = btn.dataset.id;
          await openInfluencerSalesModal(infId, ctx, loadAndRender);
        });
      });
    } catch (err) {
      container.innerHTML = `<div class="p-8 text-center text-red-600">${esc(err.message)}</div>`;
    }
  }

  await loadAndRender();
}

async function openInfluencerSalesModal(infId, ctx, onRefresh) {
  const res = await api.get(`/api/marketing/influencers/${infId}/sales?limit=100`);
  const influencer = res.influencer;
  const records = res.records || [];

  const m = modal({
    title: `Attributed Sales — ${influencer.display_name}`,
    body: `
      <div class="space-y-4">
        <div class="flex flex-col sm:flex-row items-center justify-between gap-3 border-b border-outline pb-3">
          <div>
            <p class="font-mono text-xs text-on-surface-variant">Instagram: ${esc(influencer.instagram_username || '-')} | Legal Name: ${esc(influencer.legal_name)}</p>
            <p class="text-xs text-on-surface-variant">Showing ${records.length} customer sales attributed to this partner.</p>
          </div>
          <div class="flex items-center gap-2">
            <a href="/api/marketing/influencers/${infId}/sales/report.pdf" target="_blank" class="btn btn-secondary text-xs inline-flex items-center gap-1.5">
              ${icon('picture_as_pdf', '!text-[14px]')}<span>PDF Report</span>
            </a>
            <a href="/api/marketing/influencers/${infId}/sales/export.xlsx" download class="btn btn-secondary text-xs inline-flex items-center gap-1.5">
              ${icon('download', '!text-[14px]')}<span>Export Excel</span>
            </a>
          </div>
        </div>

        <div class="overflow-x-auto max-h-[60vh]">
          <table class="w-full text-left text-xs">
            <thead class="sticky top-0 bg-surface-dim border-b border-outline font-mono uppercase text-[10px] text-on-surface-variant">
              <tr>
                <th class="p-2">S.No.</th>
                <th class="p-2">Customer</th>
                <th class="p-2">Business</th>
                <th class="p-2">Purchased</th>
                <th class="p-2">Product</th>
                <th class="p-2">Location</th>
                <th class="p-2 text-right">Eligible Rev</th>
                <th class="p-2 text-right">Commission</th>
                <th class="p-2">Status</th>
                <th class="p-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-outline">
              ${records.map((r, idx) => `
                <tr>
                  <td class="p-2 font-mono">${idx + 1}</td>
                  <td class="p-2 font-semibold">${esc(r.customer_name)}</td>
                  <td class="p-2 text-on-surface-variant">${esc(r.business_name || '-')}</td>
                  <td class="p-2 whitespace-nowrap">${date(r.purchased_date)}</td>
                  <td class="p-2">${esc(r.product_name)}</td>
                  <td class="p-2 text-on-surface-variant">${esc(r.customer_location || '-')}</td>
                  <td class="p-2 text-right font-mono">
                    ${r.eligible_revenue_minor !== null ? money(r.eligible_revenue_minor) : '<span class="text-[10px] text-amber-700 font-mono italic">Awaiting</span>'}
                  </td>
                  <td class="p-2 text-right font-mono font-semibold">
                    ${r.calculated_commission_minor !== null ? money(r.calculated_commission_minor) : '-'}
                  </td>
                  <td class="p-2 whitespace-nowrap">${statusBadge(r.commission_status)}</td>
                  <td class="p-2 text-right whitespace-nowrap">
                    <select class="sale-status-select text-[10px] py-0.5 px-1.5 border border-outline bg-surface rounded" data-id="${r.id}">
                      <option value="PENDING" ${r.commission_status === 'PENDING' ? 'selected' : ''}>Pending</option>
                      <option value="VERIFIED" ${r.commission_status === 'VERIFIED' ? 'selected' : ''}>Verified</option>
                      <option value="APPROVED" ${r.commission_status === 'APPROVED' ? 'selected' : ''}>Approved</option>
                      <option value="PAID" ${r.commission_status === 'PAID' ? 'selected' : ''}>Paid</option>
                      <option value="DISPUTED" ${r.commission_status === 'DISPUTED' ? 'selected' : ''}>Disputed</option>
                    </select>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `,
    footer: `
      ${button({ label: 'Close', action: 'close-modal' })}
    `,
  });

  m.querySelectorAll('.sale-status-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const saleId = sel.dataset.id;
      const newStatus = sel.value;
      try {
        await api.post(`/api/marketing/sales/${saleId}/status`, { status: newStatus });
        toast(`Commission status updated to ${newStatus}`);
        if (onRefresh) onRefresh();
      } catch (err) {
        toast(err.message || 'Status update failed.', 'danger');
      }
    });
  });
}

/* -------------------------------------------------------------- Route Router */

export const render = async (container, params, ctx) => {
  const segments = params.segments || [];
  const sub = segments[1] || 'dashboard';

  if (sub === 'influencers') {
    if (segments[2] === 'new') {
      await renderInfluencers(container, params, ctx);
      influencerForm(ctx);
    } else {
      await renderInfluencers(container, params, ctx);
    }
  } else if (sub === 'contracts' || sub === 'agreements') {
    if (segments[2] === 'new') {
      await renderAgreements(container, params, ctx);
      agreementForm(ctx);
    } else if (segments[2] && segments[3] === 'preview') {
      await renderContractPreview(container, segments[2], ctx);
    } else if (segments[2] && segments[3] === 'edit') {
      await renderAgreements(container, params, ctx);
      const res = await api.get(`/api/marketing/agreements/${segments[2]}`);
      agreementForm(ctx, res.agreement);
    } else {
      await renderAgreements(container, params, ctx);
    }
  } else if (sub === 'import') {
    await renderSalesImport(container, ctx);
  } else if (sub === 'reports') {
    await renderSalesReports(container, params, ctx);
  } else if (sub === 'brand-assets') {
    await renderBrandAssets(container, ctx);
  } else {
    await renderDashboard(container, ctx);
  }
};
