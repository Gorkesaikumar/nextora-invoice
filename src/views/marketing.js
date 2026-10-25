import { api, query } from '../lib/api.js';
import {
  esc, money, date, button, card, emptyState, loading, pageHeader, pagination, field, alertBox,
  statusBadge, modal, closeModal, toast, statusLabel, badge, stat, icon,
} from '../lib/ui.js';
import { softwareAgreementForm, renderSoftwareAgreementPreview } from './software-contract-editor.js';
import { DATE_PRESETS, resolveDatePreset } from '../lib/date-presets.js';

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
      { type: 'Instagram Reels', quantity: 4, frequency: 'Monthly', required_tags: '@nextora_pos, @nextora_creations', approval_requirements: 'Draft preview 48h prior', performance_metrics: 'Reach & engagement analytics' },
      { type: 'Product Demonstration', quantity: 1, frequency: 'Quarterly', required_tags: '@nextora_pos, @nextora_creations', approval_requirements: 'Live outline approval', performance_metrics: 'Lead link clicks' },
    ];

  const agreement = existing || {
    influencer_id: preselectedInfluencerId || influencers[0]?.id || '',
    title: 'Influencer Marketing & Revenue-Sharing Agreement — Nextora POS',
    brand_name: 'Nextora Creations',
    product_name: 'Nextora POS',
    commission_basis_points: 5000, // 50%
    commission_basis: 'NET_SALES_EX_GST',
    custom_basis_description: '',
    product_tax_mode: 'INCLUSIVE',
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
    return currentDeliverables.map((d, index) => {
      const isReel = String(d.type || '').toLowerCase().includes('reel');
      const isDemo = String(d.type || '').toLowerCase().includes('demonstration');
      const qty = isReel ? Math.max(4, Number(d.quantity || 4)) : (d.quantity || 1);
      const handles = (isReel || isDemo)
        ? '@nextora_pos, @nextora_creations'
        : (d.required_tags || '@nextora_pos, @nextora_creations');

      return `
        <tr data-index="${index}" class="border-b border-outline">
          <td class="p-2"><input type="text" class="input-text text-xs" name="del_type_${index}" value="${esc(d.type)}" placeholder="e.g. Instagram Reels, Product Demo"></td>
          <td class="p-2 w-28"><input type="number" min="${isReel ? 4 : 1}" class="input-text text-xs text-center" name="del_qty_${index}" value="${qty}"></td>
          <td class="p-2 w-32"><input type="text" class="input-text text-xs" name="del_freq_${index}" value="${esc(d.frequency || 'Monthly')}" placeholder="Monthly"></td>
          <td class="p-2"><input type="text" class="input-text text-xs" name="del_tags_${index}" value="${esc(handles)}" placeholder="@nextora_pos, @nextora_creations"></td>
          <td class="p-2 w-12 text-center">
            <button type="button" data-del-remove="${index}" class="text-red-600 hover:text-red-800 text-xs">${icon('close')}</button>
          </td>
        </tr>
      `;
    }).join('');
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

            ${field({
              label: 'Contract Branding Mode', name: 'branding_mode',
              options: [
                { value: 'BOTH', label: 'Company & Product Logos (Default: Company on Left, Product on Right)' },
                { value: 'COMPANY_ONLY', label: 'Company Logo Only' },
                { value: 'PRODUCT_ONLY', label: 'Product Logo Only' },
                { value: 'TEXT_ONLY', label: 'Text Only (No brand logo images)' },
              ],
              value: agreement.branding_mode || 'BOTH',
              hint: 'Determines whether Company and Product logos appear in preview and downloaded contract PDF.',
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
                  <th class="p-2">Deliverable</th>
                  <th class="p-2 w-28 text-center">Minimum Quantity</th>
                  <th class="p-2 w-32">Frequency</th>
                  <th class="p-2">Required Instagram Handles</th>
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
      type: 'Instagram Reels', quantity: 4, frequency: 'Monthly',
      required_tags: '@nextora_pos, @nextora_creations', approval_requirements: '24h prior', performance_metrics: 'Reach & engagement analytics',
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
    const deliverables = currentDeliverables.map((_, i) => {
      const type = String(form.get(`del_type_${i}`) || 'Deliverable').trim();
      const isReel = type.toLowerCase().includes('reel');
      const isDemo = type.toLowerCase().includes('demonstration');
      const rawQty = Number(form.get(`del_qty_${i}`) || 1);
      const quantity = isReel ? Math.max(4, rawQty) : Math.max(1, rawQty);
      const frequency = String(form.get(`del_freq_${i}`) || 'Monthly').trim();
      const rawTags = String(form.get(`del_tags_${i}`) || '').trim();
      const required_tags = rawTags || ((isReel || isDemo) ? '@nextora_pos, @nextora_creations' : '');
      return {
        type,
        quantity,
        frequency,
        required_tags,
        approval_requirements: '',
        performance_metrics: '',
      };
    }).filter(d => d.type.length > 0);

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
      branding_mode: String(form.get('branding_mode') || 'BOTH'),
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
      if (location.hash === `#/marketing/contracts/${agr.id}/preview`) {
        ctx.rerender();
      } else {
        ctx.navigate(`#/marketing/contracts/${agr.id}/preview`);
      }
    } catch (error) {
      const warnContainer = node.querySelector('#agreement-warnings');
      const details = error.fields?.length
        ? error.fields.map(item => `${item.field ? `${item.field}: ` : ''}${item.message}`).join(' · ')
        : error.message;
      if (warnContainer) {
        warnContainer.innerHTML = alertBox(details, 'danger');
        warnContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      toast(details || 'Failed to save agreement.', 'danger');
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
                    <button type="button" data-action="download-agr-pdf" data-id="${esc(a.id)}" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Download PDF</button>
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
  ctx.on('download-agr-pdf', async trigger => {
    try {
      await api.openDocument(`/api/marketing/agreements/${trigger.dataset.id}/pdf`, { download: true });
    } catch (err) { toast(err.message, 'danger'); }
  });
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
                      <button type="button" data-action="edit-influencer" data-id="${esc(row.id)}" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent mr-3">Edit</button>
                      <button type="button" data-action="delete-influencer" data-id="${esc(row.id)}" data-name="${esc(row.display_name || row.legal_name)}" class="text-xs text-red-600 hover:text-red-800">Delete</button>
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

  ctx.on('delete-influencer', trigger => {
    const id = trigger.dataset.id;
    const name = trigger.dataset.name;
    const node = modal({
      title: 'Delete Influencer',
      body: `
        <div class="space-y-3">
          <p class="text-sm">Are you sure you want to permanently delete influencer <strong class="font-semibold">${esc(name)}</strong>?</p>
          <p class="text-xs text-on-surface-variant">An influencer can only be deleted if they have zero associated contracts and zero imported sales attributions. Otherwise, update their status to INACTIVE or ARCHIVED.</p>
        </div>
      `,
      footer: `
        ${button({ label: 'Cancel', action: 'close-modal' })}
        ${button({ label: 'Delete Influencer', action: 'confirm-delete-influencer-btn', variant: 'danger' })}
      `,
    });
    node.querySelector('[data-action="confirm-delete-influencer-btn"]')?.addEventListener('click', async () => {
      try {
        await api.del(`/api/marketing/influencers/${id}`);
        closeModal();
        toast('Influencer deleted successfully.');
        ctx.rerender();
      } catch (err) {
        toast(err.message, 'danger');
      }
    });
  });
}

function promptContractType(ctx) {
  const node = modal({
    title: 'Select Agreement Type',
    body: `
      <p class="text-xs text-on-surface-variant mb-4">Select the contract category you wish to create for Nextora Creations:</p>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="border-2 border-outline hover:border-cyan-accent p-4 cursor-pointer rounded transition-all bg-surface hover:bg-surface-dim group" id="type-opt-software">
          <div class="flex items-center gap-2 mb-2">
            <span class="inline-flex p-2 rounded-full bg-cyan-50 text-cyan-accent">${icon('event_available')}</span>
            <h4 class="font-bold text-sm text-on-surface group-hover:text-cyan-accent">Software Development Services</h4>
          </div>
          <p class="text-xs text-on-surface-variant leading-relaxed mb-4">
            Professional software agreements for client projects. Features Schedule A scope table, 10% advance, milestone payments, 1-month timeline, 3 months free support, ₹5,000 post-support feature development, and optional ₹2,000/mo maintenance.
          </p>
          <div class="flex justify-end">
            <span class="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-accent">Configure Software Contract →</span>
          </div>
        </div>

        <div class="border-2 border-outline hover:border-primary p-4 cursor-pointer rounded transition-all bg-surface hover:bg-surface-dim group" id="type-opt-influencer">
          <div class="flex items-center gap-2 mb-2">
            <span class="inline-flex p-2 rounded-full bg-purple-50 text-purple-700">${icon('campaign')}</span>
            <h4 class="font-bold text-sm text-on-surface group-hover:text-primary">Influencer Marketing &amp; Rev-Share</h4>
          </div>
          <p class="text-xs text-on-surface-variant leading-relaxed mb-4">
            Marketing partnership contracts for creators promoting Nextora POS. Includes agreed revenue-sharing %, TDS Section 194H withholding, and social media deliverables.
          </p>
          <div class="flex justify-end">
            <span class="inline-flex items-center gap-1.5 text-xs font-bold text-primary">Configure Influencer Contract →</span>
          </div>
        </div>
      </div>
    `,
    footer: `${button({ label: 'Cancel', action: 'close-modal' })}`,
  });

  node.querySelector('#type-opt-software')?.addEventListener('click', () => {
    closeModal();
    softwareAgreementForm(ctx);
  });
  node.querySelector('#type-opt-influencer')?.addEventListener('click', () => {
    closeModal();
    agreementForm(ctx);
  });
}

async function renderAgreements(container, params, ctx) {
  const filters = ctx.filters || {};
  container.innerHTML = pageHeader({
    title: 'Contracts & Agreements',
    subtitle: 'Client software development contracts, influencer revenue-sharing agreements, GST commercial terms, and formal PDF generation.',
    actions: button({ label: 'New Contract', action: 'new-agreement', variant: 'primary', icon: 'add' }),
  }) + tabs('contracts') + loading();

  let data;
  try {
    data = await api.get(`/api/marketing/contracts${query({
      search: filters.search, status: filters.status, contract_type: filters.contract_type, page: ctx.page,
    })}`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Contracts & Agreements' }) + tabs('contracts') + alertBox(error.message, 'danger');
    return;
  }

  const contracts = data.contracts || [];

  container.innerHTML = `
    ${pageHeader({
      title: 'Contracts & Agreements',
      subtitle: 'Client software development contracts, influencer revenue-sharing agreements, GST commercial terms, and formal PDF generation.',
      actions: button({ label: 'New Contract', action: 'new-agreement', variant: 'primary', icon: 'add' }),
    })}
    ${tabs('contracts')}

    ${card({
      body: `
        <form id="agreement-filters" class="flex flex-wrap items-end gap-3 border-b border-outline px-5 py-4">
          ${field({ label: 'Search', name: 'search', value: filters.search || '', placeholder: 'Contract #, client name, influencer, service...', className: 'min-w-[200px]' })}
          ${field({ label: 'Agreement Type', name: 'contract_type', options: [
            { value: '', label: 'All Agreement Types' },
            { value: 'SOFTWARE_SERVICES', label: 'Software Development Services' },
            { value: 'INFLUENCER', label: 'Influencer Marketing' },
          ], value: filters.contract_type || '', className: '' })}
          ${field({ label: 'Status', name: 'status', options: [
            { value: '', label: 'All Statuses' },
            { value: 'DRAFT', label: 'Draft' },
            { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'SENT', label: 'Sent' },
            { value: 'ACCEPTED', label: 'Accepted' },
            { value: 'SIGNED', label: 'Signed' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'COMPLETED', label: 'Completed' },
            { value: 'TERMINATED', label: 'Terminated' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ], value: filters.status || '', className: '' })}
          <div class="flex gap-2 pb-0.5">${button({ label: 'Search', type: 'submit', variant: 'primary' })}</div>
        </form>

        ${contracts.length ? `
          <div class="overflow-x-auto">
            <table class="data-table w-full min-w-[950px]">
              <thead>
                <tr>
                  <th>Contract #</th>
                  <th>Agreement Type</th>
                  <th>Client / Partner</th>
                  <th>Service / Product</th>
                  <th class="text-right">Commercial Value</th>
                  <th>Status</th>
                  <th>PDF Generated</th>
                  <th class="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${contracts.map(row => {
                  const isSoftware = row.contract_type === 'SOFTWARE_SERVICES';
                  const previewHref = isSoftware
                    ? `#/marketing/contracts/software/${esc(row.id)}/preview`
                    : `#/marketing/contracts/${esc(row.id)}/preview`;
                  const pdfUrl = isSoftware
                    ? `/api/marketing/software-agreements/${esc(row.id)}/pdf`
                    : `/api/marketing/agreements/${esc(row.id)}/pdf`;

                  return `
                    <tr>
                      <td class="font-mono text-xs font-medium">
                        <a href="${previewHref}" class="underline decoration-outline underline-offset-2 hover:decoration-cyan-accent font-bold">${esc(row.contract_number)}</a>
                        <div class="text-[10px] text-on-surface-variant">v${row.version || 1}</div>
                      </td>
                      <td class="text-xs">
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${isSoftware ? 'bg-cyan-50 text-cyan-900 border border-cyan-200' : 'bg-purple-50 text-purple-900 border border-purple-200'}">
                          ${isSoftware ? 'Software Services' : 'Influencer Marketing'}
                        </span>
                      </td>
                      <td class="text-xs">
                        <div class="font-medium">${esc(row.counterparty_name || '—')}</div>
                        ${row.secondary_info ? `<div class="text-on-surface-variant text-[11px]">${esc(row.secondary_info)}</div>` : ''}
                      </td>
                      <td class="text-xs text-on-surface-variant">
                        ${esc(row.title || row.service_category || row.product_name || '—')}
                      </td>
                      <td class="num text-right font-bold text-xs font-mono">
                        ${esc(row.commercial_summary)}
                      </td>
                      <td>${statusBadge(row.status)}</td>
                      <td class="text-xs text-on-surface-variant">${row.pdf_generated_at ? date(row.pdf_generated_at.slice(0, 10)) : '<span class="italic">Not yet</span>'}</td>
                      <td class="text-right whitespace-nowrap">
                        <a href="${previewHref}" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent mr-2.5">Preview</a>
                        <button type="button" data-action="download-contract-pdf" data-url="${pdfUrl}" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent mr-2.5">Download</button>
                        ${['DRAFT', 'PENDING_APPROVAL'].includes(row.status)
                          ? `<button type="button" data-action="${isSoftware ? 'edit-draft-sw-agreement' : 'edit-draft-agreement'}" data-id="${esc(row.id)}" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent mr-2.5">Edit</button>
                             <button type="button" data-action="${isSoftware ? 'delete-draft-sw-agreement' : 'delete-draft-agreement'}" data-id="${esc(row.id)}" data-number="${esc(row.contract_number)}" class="text-xs text-red-600 hover:text-red-800 mr-2.5">Delete</button>`
                          : ''}
                        ${['ACCEPTED', 'SIGNED', 'ACTIVE', 'TERMINATED'].includes(row.status)
                          ? `<button type="button" data-action="${isSoftware ? 'archive-sw-agreement' : 'archive-agreement'}" data-id="${esc(row.id)}" data-number="${esc(row.contract_number)}" class="text-xs text-on-surface-variant hover:text-on-surface mr-2.5">Archive</button>`
                          : ''}
                        <button type="button" data-action="${isSoftware ? 'duplicate-sw-agreement' : 'duplicate-agreement'}" data-id="${esc(row.id)}" class="text-xs text-on-surface-variant hover:text-on-surface">Copy</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
          ${pagination({ page: data.page, total: data.total, limit: data.limit })}
        ` : emptyState({
          icon: 'request_quote', title: 'No contracts found',
          message: 'Create a software development services agreement or influencer marketing partnership contract.',
          actionLabel: 'New Contract', action: 'new-agreement',
        })}
      `,
    })}
  `;

  ctx.on('new-agreement', () => promptContractType(ctx));

  container.querySelector('#agreement-filters')?.addEventListener('submit', e => {
    e.preventDefault();
    const form = new FormData(e.target);
    ctx.setFilters({ search: form.get('search'), status: form.get('status'), contract_type: form.get('contract_type') });
    ctx.setPage(1);
    ctx.rerender();
  });

  ctx.on('download-contract-pdf', async trigger => {
    const url = trigger.dataset.url;
    try {
      await api.openDocument(url, { download: true });
      toast('Contract PDF downloaded successfully.');
    } catch (err) {
      if (!err.message?.includes('canceled') && !err.message?.includes('cancelled')) {
        toast(err.message, 'danger');
      }
    }
  });

  ctx.on('edit-draft-agreement', async trigger => {
    const id = trigger.dataset.id;
    try {
      const res = await api.get(`/api/marketing/agreements/${id}`);
      agreementForm(ctx, res.agreement);
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('edit-draft-sw-agreement', async trigger => {
    const id = trigger.dataset.id;
    try {
      const res = await api.get(`/api/marketing/software-agreements/${id}`);
      softwareAgreementForm(ctx, res.agreement);
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

  ctx.on('duplicate-sw-agreement', async trigger => {
    const id = trigger.dataset.id;
    try {
      const res = await api.post(`/api/marketing/software-agreements/${id}/duplicate`);
      toast('Draft duplicate created.');
      ctx.navigate(`#/marketing/contracts/software/${res.agreement.id}/preview`);
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('delete-draft-agreement', trigger => {
    const id = trigger.dataset.id;
    const number = trigger.dataset.number;
    const node = modal({
      title: 'Delete Draft Agreement',
      body: `
        <div class="space-y-3">
          <p class="text-sm">Are you sure you want to permanently delete draft agreement <strong class="font-mono">${esc(number)}</strong>?</p>
          <p class="text-xs text-on-surface-variant">Only draft agreements without any imported sales attributions can be deleted. This action cannot be undone.</p>
        </div>
      `,
      footer: `
        ${button({ label: 'Cancel', action: 'close-modal' })}
        ${button({ label: 'Delete Draft', action: 'confirm-delete-draft-table', variant: 'danger' })}
      `,
    });
    node.querySelector('[data-action="confirm-delete-draft-table"]')?.addEventListener('click', async () => {
      try {
        await api.del(`/api/marketing/agreements/${id}`);
        closeModal();
        toast('Draft agreement deleted successfully.');
        ctx.rerender();
      } catch (err) {
        toast(err.message, 'danger');
      }
    });
  });

  ctx.on('delete-draft-sw-agreement', trigger => {
    const id = trigger.dataset.id;
    const number = trigger.dataset.number;
    const node = modal({
      title: 'Delete Draft Software Contract',
      body: `
        <div class="space-y-3">
          <p class="text-sm">Are you sure you want to permanently delete draft software contract <strong class="font-mono">${esc(number)}</strong>?</p>
          <p class="text-xs text-on-surface-variant">Only draft agreements can be deleted. This action cannot be undone.</p>
        </div>
      `,
      footer: `
        ${button({ label: 'Cancel', action: 'close-modal' })}
        ${button({ label: 'Delete Draft', action: 'confirm-delete-sw-draft-table', variant: 'danger' })}
      `,
    });
    node.querySelector('[data-action="confirm-delete-sw-draft-table"]')?.addEventListener('click', async () => {
      try {
        await api.del(`/api/marketing/software-agreements/${id}`);
        closeModal();
        toast('Draft software contract deleted successfully.');
        ctx.rerender();
      } catch (err) {
        toast(err.message, 'danger');
      }
    });
  });

  ctx.on('archive-agreement', trigger => {
    const id = trigger.dataset.id;
    const number = trigger.dataset.number;
    const node = modal({
      title: 'Archive Contract',
      body: `
        <div class="space-y-3">
          <p class="text-sm">Archive contract <strong class="font-mono">${esc(number)}</strong>?</p>
          <p class="text-xs text-on-surface-variant">Archived contracts remain in your historical audit records and reports but are marked as ARCHIVED.</p>
        </div>
      `,
      footer: `
        ${button({ label: 'Cancel', action: 'close-modal' })}
        ${button({ label: 'Archive Contract', action: 'confirm-archive-agreement-table', variant: 'primary' })}
      `,
    });
    node.querySelector('[data-action="confirm-archive-agreement-table"]')?.addEventListener('click', async () => {
      try {
        await api.post(`/api/marketing/agreements/${id}/archive`, {});
        closeModal();
        toast('Contract archived.');
        ctx.rerender();
      } catch (err) {
        toast(err.message, 'danger');
      }
    });
  });

  ctx.on('archive-sw-agreement', trigger => {
    const id = trigger.dataset.id;
    const number = trigger.dataset.number;
    const node = modal({
      title: 'Archive Software Contract',
      body: `
        <div class="space-y-3">
          <p class="text-sm">Archive software contract <strong class="font-mono">${esc(number)}</strong>?</p>
          <p class="text-xs text-on-surface-variant">Archived contracts remain in your historical audit records but are marked as ARCHIVED.</p>
        </div>
      `,
      footer: `
        ${button({ label: 'Cancel', action: 'close-modal' })}
        ${button({ label: 'Archive Contract', action: 'confirm-archive-sw-agreement-table', variant: 'primary' })}
      `,
    });
    node.querySelector('[data-action="confirm-archive-sw-agreement-table"]')?.addEventListener('click', async () => {
      try {
        await api.post(`/api/marketing/software-agreements/${id}/archive`, {});
        closeModal();
        toast('Software contract archived.');
        ctx.rerender();
      } catch (err) {
        toast(err.message, 'danger');
      }
    });
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
  const warnings = [];
  if (s.company_logo?.warning) warnings.push(s.company_logo.warning);
  if (s.product_logo?.warning) warnings.push(s.product_logo.warning);

  container.innerHTML = `
    ${pageHeader({
      title: `${esc(s.contract_number)} — Preview`,
      subtitle: `${esc(s.title)} · Version ${s.version || 1}`,
      breadcrumb: '<a href="#/marketing" class="hover:underline">Marketing</a> / <a href="#/marketing/contracts" class="hover:underline">Contracts</a> / Preview',
      actions: `
        ${button({ label: 'Generate PDF', action: 'generate-pdf-btn', variant: 'primary', icon: 'picture_as_pdf' })}
        ${button({ label: 'Download PDF', action: 'download-pdf-btn', variant: 'secondary', icon: 'download' })}
        ${button({ label: 'Download HTML', action: 'download-html-btn', variant: 'secondary', icon: 'code' })}
        ${['DRAFT', 'PENDING_APPROVAL'].includes(s.status)
          ? button({ label: 'Edit Draft', action: 'edit-preview-draft', variant: 'secondary' })
          : ''}
        ${['DRAFT', 'PENDING_APPROVAL'].includes(s.status)
          ? button({ label: 'Delete Draft', action: 'delete-preview-draft', variant: 'danger' })
          : ''}
        ${['ACCEPTED', 'SIGNED', 'ACTIVE', 'TERMINATED'].includes(s.status)
          ? button({ label: 'Archive', action: 'archive-preview-contract', variant: 'secondary' })
          : ''}
        ${button({ label: 'Status Actions', action: 'open-status-modal', variant: 'secondary' })}
      `,
    })}

    <!-- Status Banner -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-4 border border-outline bg-surface p-4">
      <div class="flex items-center gap-3">
        <span class="text-xs text-on-surface-variant">Contract Status:</span>
        ${statusBadge(s.status)}
        ${s.is_finalized
          ? `<span class="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
               ${icon('lock', '!text-[13px]')} Sealed & Immutable Snapshot
             </span>`
          : `<span class="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
               ${icon('edit_note', '!text-[13px]')} Editable Draft
             </span>`
        }
        ${s.pdf_generated_at ? `<span class="text-xs text-on-surface-variant font-mono">PDF Generated: ${date(s.pdf_generated_at.slice(0, 10))}</span>` : '<span class="text-xs text-amber-700 italic">PDF not yet compiled</span>'}
      </div>
      <div class="text-xs text-on-surface-variant">
        Effective: <span class="font-medium text-on-surface">${date(s.effective_start_date)}</span> until <span class="font-medium text-on-surface">${s.is_indefinite ? 'Indefinite' : date(s.effective_end_date)}</span>
      </div>
    </div>

    ${warnings.length > 0 && !s.is_finalized ? `
      <div class="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
        <div class="font-bold flex items-center gap-1.5 mb-1">
          ${icon('warning', '!text-[16px] text-amber-700')} Brand Asset Notice (Draft)
        </div>
        <ul class="list-disc pl-5 space-y-0.5">
          ${warnings.map(w => `<li>${esc(w)}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    ${s.is_finalized ? `
      <div class="mb-4 rounded border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 flex items-center justify-between">
        <div class="flex items-center gap-2">
          ${icon('lock', '!text-[16px] text-emerald-700')}
          <span><strong>Finalized Contract Snapshot:</strong> This agreement is sealed. Stored logos and commercial terms will not change if brand settings are modified.</span>
        </div>
        <span class="font-mono text-[11px] text-emerald-800">Version ${s.version || 1}</span>
      </div>
    ` : ''}

    <!-- Canonical Influencer Agreement Document Preview (Single Source of Truth) -->
    <div class="mx-auto max-w-5xl overflow-x-auto pb-8">
      ${res.html || '<p class="p-8 text-center text-on-surface-variant">Unable to load contract preview HTML.</p>'}
    </div>
  `;

  ctx.on('generate-pdf-btn', async () => {
    try {
      await api.post(`/api/marketing/agreements/${agreementId}/generate-pdf`);
      toast('Contract PDF generated and snapshot preserved.');
      await api.openDocument(`/api/marketing/agreements/${agreementId}/pdf?view=true`, { download: false });
      ctx.rerender();
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('download-pdf-btn', async () => {
    try {
      await api.openDocument(`/api/marketing/agreements/${agreementId}/pdf`, { download: true });
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('download-html-btn', async () => {
    try {
      await api.openDocument(`/api/marketing/agreements/${agreementId}/html`, { download: true });
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('edit-preview-draft', async () => {
    try {
      const res = await api.get(`/api/marketing/agreements/${agreementId}`);
      agreementForm(ctx, res.agreement);
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('delete-preview-draft', () => {
    const node = modal({
      title: 'Delete Draft Agreement',
      body: `
        <div class="space-y-3">
          <p class="text-sm">Are you sure you want to delete draft agreement <strong class="font-mono">${esc(s.contract_number)}</strong> for <strong class="font-semibold">${esc(s.influencer?.legal_name || 'Influencer')}</strong>?</p>
          <p class="text-xs text-red-600 bg-red-50 p-3 rounded border border-red-200">This action will permanently delete this draft agreement. It cannot be undone.</p>
        </div>
      `,
      footer: `
        ${button({ label: 'Cancel', action: 'close-modal' })}
        ${button({ label: 'Delete Draft', action: 'confirm-delete-agreement-draft', variant: 'danger' })}
      `,
    });

    ctx.on('confirm-delete-agreement-draft', async () => {
      try {
        await api.delete(`/api/marketing/agreements/${agreementId}`);
        closeModal();
        toast('Draft agreement deleted.');
        ctx.navigate('#/marketing/contracts');
      } catch (err) { toast(err.message, 'danger'); }
    });
  });

  ctx.on('archive-preview-contract', () => {
    const node = modal({
      title: 'Archive Contract',
      body: `
        <div class="space-y-3">
          <p class="text-sm">Archive contract <strong class="font-mono">${esc(s.contract_number)}</strong>?</p>
          <p class="text-xs text-on-surface-variant bg-surface-dim p-3 rounded border border-outline">Archiving removes the contract from active workflows while preserving all historical attribution, sales links, and audit logs.</p>
        </div>
      `,
      footer: `
        ${button({ label: 'Cancel', action: 'close-modal' })}
        ${button({ label: 'Archive Contract', action: 'confirm-archive-agreement', variant: 'primary' })}
      `,
    });

    ctx.on('confirm-archive-agreement', async () => {
      try {
        await api.post(`/api/marketing/agreements/${agreementId}/archive`, {});
        closeModal();
        toast('Contract archived.');
        ctx.rerender();
      } catch (err) { toast(err.message, 'danger'); }
    });
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

  const assets = await api.get('/api/marketing/brand-assets').catch(() => ({ product_logo: {}, company_logo: {} }));
  const prodExists = Boolean(assets?.product_logo?.exists && assets.product_logo.dataUri);
  const compExists = Boolean(assets?.company_logo?.exists && assets.company_logo.dataUri);

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
              <img id="product-logo-img" src="${prodExists ? assets.product_logo.dataUri : ''}" alt="Nextora POS Logo"
                class="max-h-32 max-w-full object-contain ${prodExists ? '' : 'hidden'}">
              <div id="prod-logo-placeholder" class="${prodExists ? 'hidden' : ''} text-center text-xs text-on-surface-variant">
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
              <img id="company-logo-img" src="${compExists ? assets.company_logo.dataUri : ''}" alt="Nextora Creations Company Logo"
                class="max-h-32 max-w-full object-contain ${compExists ? '' : 'hidden'}">
              <div id="comp-logo-placeholder" class="${compExists ? 'hidden' : ''} text-center text-xs text-on-surface-variant">
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
    if (!['image/png', 'image/jpeg'].includes(file.type) && !file.name.match(/\.(png|jpe?g)$/i)) {
      toast('Please choose a valid PNG or JPEG image.', 'danger');
      return;
    }
    if (file.size > 1048576) { toast('Product logo must be 1 MB or smaller.', 'danger'); return; }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUri = String(reader.result);
        await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            if (img.width < 40 || img.height < 20 || img.width > 2500 || img.height > 2500) {
              reject(new Error(`Image dimensions ${img.width}x${img.height} are out of range (must be between 40x20 and 2500x2500).`));
            } else {
              resolve();
            }
          };
          img.onerror = () => reject(new Error('Invalid or unreadable image file.'));
          img.src = dataUri;
        });

        await api.post('/api/marketing/product-logo', { logo: dataUri });
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
    if (file.type !== 'image/png' && !file.name.match(/\.png$/i)) {
      toast('Company logo must be a valid PNG image.', 'danger');
      return;
    }
    if (file.size > 512000) { toast('Company logo must be 500 KB or smaller.', 'danger'); return; }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUri = String(reader.result);
        await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            if (img.width < 40 || img.height < 20 || img.width > 2000 || img.height > 2000) {
              reject(new Error(`Image dimensions ${img.width}x${img.height} are out of range.`));
            } else {
              resolve();
            }
          };
          img.onerror = () => reject(new Error('Invalid or unreadable PNG file.'));
          img.src = dataUri;
        });

        await api.post('/api/settings/logo', { png: dataUri });
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
  let batches = [];

  async function loadBatches() {
    const res = await api.get('/api/marketing/sales/batches').catch(() => ({ batches: [] }));
    batches = res.batches || [];
  }

  await loadBatches();

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
                    <th class="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-outline">
                  ${batches.map(b => `
                    <tr data-batch-id="${esc(b.id)}">
                      <td class="p-3 whitespace-nowrap">${date(b.imported_at)}</td>
                      <td class="p-3 font-semibold font-mono">${esc(b.filename)}</td>
                      <td class="p-3 text-center font-mono">${b.row_count}</td>
                      <td class="p-3 text-center font-mono text-emerald-700 font-bold">${b.valid_row_count}</td>
                      <td class="p-3 text-center font-mono text-amber-700">${b.duplicate_row_count}</td>
                      <td class="p-3">${esc(b.imported_by_name || '-')}</td>
                      <td class="p-3">${statusBadge(b.status)}</td>
                      <td class="p-3 text-right whitespace-nowrap">
                        <div class="inline-flex items-center gap-1.5 justify-end">
                          <button type="button"
                            data-action="view-batch-details"
                            data-id="${esc(b.id)}"
                            class="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-dim border border-outline rounded"
                            title="View Batch Details">
                            ${icon('visibility', '!text-[14px]')}<span>Details</span>
                          </button>
                          <a href="/api/marketing/sales/batches/${esc(b.id)}/export.xlsx"
                            download
                            class="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-dim border border-outline rounded"
                            title="Download Batch Excel Records">
                            ${icon('download', '!text-[14px]')}<span>Download</span>
                          </a>
                          <button type="button"
                            data-action="delete-batch"
                            data-id="${esc(b.id)}"
                            data-filename="${esc(b.filename)}"
                            data-date="${esc(date(b.imported_at))}"
                            data-rows="${b.row_count}"
                            data-valid="${b.valid_row_count}"
                            data-duplicates="${b.duplicate_row_count}"
                            class="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded font-medium transition-colors"
                            title="Delete Batch">
                            ${icon('delete', '!text-[14px] text-red-600')}<span>Delete</span>
                          </button>
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

  // Register Delete Batch Confirmation Action
  ctx.on('delete-batch', trigger => {
    const batchId = trigger.dataset.id;
    const filename = trigger.dataset.filename;
    const importDate = trigger.dataset.date;
    const totalRows = trigger.dataset.rows;
    const validRows = trigger.dataset.valid;
    const duplicates = trigger.dataset.duplicates;

    const node = modal({
      title: 'Delete Import Batch?',
      body: `
        <div class="space-y-4">
          <p class="text-sm text-on-surface">
            Are you sure you want to permanently delete import batch <strong class="font-mono text-primary font-bold">${esc(filename)}</strong>?
          </p>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-surface-dim border border-outline text-xs">
            <div>
              <div class="text-[11px] font-mono uppercase text-on-surface-variant">Import Date</div>
              <div class="font-semibold mt-0.5">${esc(importDate)}</div>
            </div>
            <div>
              <div class="text-[11px] font-mono uppercase text-on-surface-variant">Total Rows</div>
              <div class="font-mono font-bold mt-0.5">${esc(totalRows)}</div>
            </div>
            <div>
              <div class="text-[11px] font-mono uppercase text-on-surface-variant">Valid Records</div>
              <div class="font-mono font-bold text-emerald-700 mt-0.5">${esc(validRows)}</div>
            </div>
            <div>
              <div class="text-[11px] font-mono uppercase text-on-surface-variant">Duplicates</div>
              <div class="font-mono font-bold text-amber-700 mt-0.5">${esc(duplicates)}</div>
            </div>
          </div>

          <div class="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 space-y-1.5">
            <div class="font-semibold flex items-center gap-1.5">
              ${icon('error', '!text-[16px] text-amber-700')}
              <span>Records Affected:</span>
            </div>
            <p>
              This will remove the selected import batch and its eligible imported sales records. Related report totals may change. Records referenced by protected business transactions may prevent deletion.
            </p>
            <p class="text-[11px] text-amber-800">
              Shared entities (influencer profiles, contracts, customers, and invoices) are never deleted.
            </p>
          </div>

          <div id="delete-batch-error" class="hidden p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700"></div>
        </div>
      `,
      footer: `
        ${button({ label: 'Cancel', action: 'close-modal' })}
        <button type="button" id="btn-confirm-delete-batch"
          class="inline-flex items-center justify-center gap-2 border font-medium px-3.5 py-2 text-sm bg-red-600 text-white border-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          ${icon('delete', '!text-[18px]')}<span>Delete Batch</span>
        </button>
      `
    });

    const confirmBtn = node.querySelector('#btn-confirm-delete-batch');
    const errBox = node.querySelector('#delete-batch-error');

    confirmBtn?.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `<span>Deleting...</span>`;
      errBox.classList.add('hidden');
      errBox.textContent = '';

      try {
        const res = await api.delete(`/api/marketing/sales/batches/${batchId}`);
        closeModal();
        toast(`Import batch "${filename}" (${res.deleted_records_count} records) deleted successfully.`);
        await loadBatches();
        renderView();
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `${icon('delete', '!text-[18px]')}<span>Delete Batch</span>`;
        errBox.textContent = err.message || 'Failed to delete batch.';
        errBox.classList.remove('hidden');
      }
    });
  });

  // Register View Batch Details Action
  ctx.on('view-batch-details', async trigger => {
    const batchId = trigger.dataset.id;
    try {
      const data = await api.get(`/api/marketing/sales/batches/${batchId}`);
      modal({
        title: `Batch Details: ${data.filename}`,
        size: 'wide',
        body: `
          <div class="space-y-4">
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-surface-dim border border-outline text-xs">
              <div>
                <span class="text-[11px] font-mono uppercase text-on-surface-variant block">Import Date</span>
                <span class="font-semibold">${date(data.imported_at)}</span>
              </div>
              <div>
                <span class="text-[11px] font-mono uppercase text-on-surface-variant block">Imported By</span>
                <span class="font-semibold">${esc(data.imported_by_name || '-')}</span>
              </div>
              <div>
                <span class="text-[11px] font-mono uppercase text-on-surface-variant block">Status</span>
                <span>${statusBadge(data.status)}</span>
              </div>
              <div>
                <span class="text-[11px] font-mono uppercase text-on-surface-variant block">Total Rows</span>
                <span class="font-mono font-bold">${data.row_count} (${data.valid_row_count} valid, ${data.duplicate_row_count} dupes)</span>
              </div>
            </div>

            <div class="text-[11px] font-mono text-on-surface-variant bg-surface p-2 border border-outline break-all">
              <strong>SHA-256:</strong> ${esc(data.file_sha256)}
            </div>

            ${data.notes ? `
              <div class="text-xs p-2 bg-surface border border-outline">
                <span class="font-semibold text-on-surface-variant">Batch Notes:</span> ${esc(data.notes)}
              </div>
            ` : ''}

            <div>
              <h3 class="font-headline text-xs font-semibold uppercase text-on-surface-variant mb-2">
                Imported Sales Records (${data.records?.length || 0} loaded)
              </h3>
              <div class="max-h-60 overflow-y-auto border border-outline">
                <table class="w-full text-left text-xs">
                  <thead class="border-b border-outline bg-surface-dim font-mono uppercase text-[10px] text-on-surface-variant sticky top-0">
                    <tr>
                      <th class="p-2">S.No.</th>
                      <th class="p-2">Customer</th>
                      <th class="p-2">Product</th>
                      <th class="p-2">Purchased</th>
                      <th class="p-2">Influencer</th>
                      <th class="p-2 text-right">Sale Amount</th>
                      <th class="p-2 text-right">Commission</th>
                      <th class="p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-outline">
                    ${(data.records || []).map(r => `
                      <tr>
                        <td class="p-2 font-mono">${r.serial_number}</td>
                        <td class="p-2 font-semibold">${esc(r.customer_name)}</td>
                        <td class="p-2">${esc(r.product_name)}</td>
                        <td class="p-2 whitespace-nowrap">${r.purchased_date ? date(r.purchased_date) : '-'}</td>
                        <td class="p-2">${esc(r.influencer_display_name || r.raw_influencer_name || '-')}</td>
                        <td class="p-2 text-right font-mono">${r.sale_amount_minor !== null ? money(r.sale_amount_minor) : '-'}</td>
                        <td class="p-2 text-right font-mono">${r.calculated_commission_minor !== null ? money(r.calculated_commission_minor) : '-'}</td>
                        <td class="p-2">${statusBadge(r.commission_status)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `,
        footer: `
          <a href="/api/marketing/sales/batches/${esc(batchId)}/export.xlsx" download
            class="btn btn-secondary text-xs inline-flex items-center gap-1.5 mr-auto">
            ${icon('download', '!text-[14px]')}<span>Download Excel</span>
          </a>
          ${button({ label: 'Close', action: 'close-modal' })}
        `
      });
    } catch (err) {
      toast(err.message || 'Failed to load batch details.', 'danger');
    }
  });

  renderView();
}

/* ---------------------------------------------------- Influencer Sales Reports */

/* ---------------------------------------------------- Influencer Sales Reports */

export async function renderSalesReports(container, params, ctx) {
  let search = ctx.filters.search || '';
  let preset = ctx.filters.preset || '';
  let fromDate = ctx.filters.from || '';
  let toDate = ctx.filters.to || '';
  let productId = ctx.filters.productId || '';
  let influencerId = ctx.filters.influencerId || '';
  let status = ctx.filters.status || '';
  let page = ctx.page || 1;
  const limit = 25;
  let sort = ctx.filters.sort || 'purchased_date_desc';
  let viewTab = ctx.filters.viewTab || 'transactions'; // 'transactions' | 'partners'

  async function loadAndRender() {
    container.innerHTML = loading('Loading Influencer Sales Reports…');

    // Date range validation
    let dateWarning = '';
    if (fromDate && toDate && fromDate > toDate) {
      dateWarning = alertBox("Invalid date range: 'From Date' cannot be later than 'To Date'. Please adjust the date selection.", 'warn');
    }

    try {
      // Parallel fetch: Reference influencers list, Aggregated Dashboard KPIs, and Detailed Paginated Sales
      const [allInfluencersRes, data, salesData] = await Promise.all([
        api.get('/api/marketing/influencers?limit=1000').catch(() => ({ influencers: [] })),
        api.get(`/api/marketing/sales/dashboard${query({ fromDate, toDate, productId, influencerId })}`),
        api.get(`/api/marketing/sales${query({ influencerId, search, fromDate, toDate, productId, status, page, limit, sort })}`),
      ]);

      const allInfluencers = allInfluencersRes.influencers || [];
      const kpis = data.kpis || {};
      const influencerSummaries = data.influencers || [];
      const salesRecords = salesData.records || [];
      const totalSalesCount = salesData.total || 0;

      const exportParams = { influencerId, search, fromDate, toDate, productId, status };
      const hasActiveFilters = Boolean(search || fromDate || toDate || productId || influencerId || status || preset);

      container.innerHTML = `
        ${pageHeader({
          title: 'Influencer Sales Reports',
          subtitle: 'Track attributed customer purchases, calculate revenue share, and export individual or consolidated financial reports.',
          actions: `
            <div class="flex flex-wrap items-center gap-2">
              ${button({ label: 'Consolidated PDF', action: 'export-pdf', icon: 'picture_as_pdf', variant: 'secondary' })}
              ${button({ label: 'Export Excel', action: 'export-excel', icon: 'download', variant: 'secondary' })}
              ${button({ label: 'Export CSV', action: 'export-csv', icon: 'download', variant: 'secondary' })}
              <a href="#/marketing/import" class="btn btn-primary inline-flex items-center gap-2">
                ${icon('upload_file', '!text-[18px]')}<span>Import Sales Excel</span>
              </a>
            </div>
          `,
        })}

        ${tabs('reports')}

        ${dateWarning ? `<div class="mb-4">${dateWarning}</div>` : ''}

        <div class="space-y-6">
          <!-- KPI Summary Cards: Clearly distinguish gross sales, eligible net sales excluding GST, and commissions -->
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
            ${card({
              body: `
                <div class="p-3.5">
                  <span class="label-technical block text-[10px] text-on-surface-variant font-mono">TOTAL RECORDED SALES</span>
                  <p class="num mt-1 font-headline text-xl font-bold text-on-surface">${money(kpis.total_gross_sales_minor || 0)}</p>
                  <p class="mt-1 text-[11px] text-on-surface-variant">${kpis.total_valid_sales || 0} order${kpis.total_valid_sales === 1 ? '' : 's'} in period</p>
                </div>
              `
            })}
            ${card({
              body: `
                <div class="p-3.5">
                  <span class="label-technical block text-[10px] text-emerald-800 font-mono">ELIGIBLE NET SALES</span>
                  <p class="num mt-1 font-headline text-xl font-bold text-emerald-700">${money(kpis.total_verified_revenue_minor || 0)}</p>
                  <p class="mt-1 text-[11px] text-on-surface-variant">Net sales excl. GST</p>
                </div>
              `
            })}
            ${card({
              body: `
                <div class="p-3.5">
                  <span class="label-technical block text-[10px] text-blue-800 font-mono">COMMISSION EARNED</span>
                  <p class="num mt-1 font-headline text-xl font-bold text-blue-700">${money(kpis.total_calculated_commission_minor || 0)}</p>
                  <p class="mt-1 text-[11px] text-on-surface-variant">Calculated rev share</p>
                </div>
              `
            })}
            ${card({
              body: `
                <div class="p-3.5">
                  <span class="label-technical block text-[10px] text-amber-800 font-mono">PENDING SETTLEMENT</span>
                  <p class="num mt-1 font-headline text-xl font-bold text-amber-700">${money(kpis.pending_commission_minor || 0)}</p>
                  <p class="mt-1 text-[11px] text-on-surface-variant">Awaiting payment</p>
                </div>
              `
            })}
            ${card({
              body: `
                <div class="p-3.5">
                  <span class="label-technical block text-[10px] text-emerald-900 font-mono">COMMISSION PAID</span>
                  <p class="num mt-1 font-headline text-xl font-bold text-emerald-800">${money(kpis.paid_commission_minor || 0)}</p>
                  <p class="mt-1 text-[11px] text-on-surface-variant">Settled &amp; finalized</p>
                </div>
              `
            })}
            ${card({
              body: `
                <div class="p-3.5">
                  <span class="label-technical block text-[10px] text-on-surface-variant font-mono">ACTIVE INFLUENCERS</span>
                  <p class="num mt-1 font-headline text-xl font-bold text-on-surface">${kpis.active_influencers_count || 0}</p>
                  <p class="mt-1 text-[11px] text-on-surface-variant">${kpis.total_influencers_with_sales || 0} with sales in period</p>
                </div>
              `
            })}
            ${card({
              body: `
                <div class="p-3.5">
                  <span class="label-technical block text-[10px] ${kpis.refunded_sales_count > 0 ? 'text-red-700' : 'text-on-surface-variant'} font-mono">REFUNDS / CANCELLED</span>
                  <p class="num mt-1 font-headline text-xl font-bold ${kpis.refunded_sales_count > 0 ? 'text-red-700' : 'text-on-surface'}">${kpis.refunded_sales_count || 0}</p>
                  <p class="mt-1 text-[11px] text-on-surface-variant">${kpis.total_refund_amount_minor > 0 ? money(kpis.total_refund_amount_minor) : 'None tracked'}</p>
                </div>
              `
            })}
          </div>

          <!-- Date Filters & Filter Toolbar -->
          <form id="sales-report-filters" class="border border-outline bg-surface p-4 space-y-3">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
              <div>
                <label class="label-technical mb-1 block text-xs">Date Preset</label>
                <select name="preset" id="filter-preset" class="field text-xs w-full">
                  <option value="">Custom / Select preset...</option>
                  ${DATE_PRESETS.map(p => `<option value="${p.key}" ${preset === p.key ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
                </select>
              </div>

              <div>
                <label class="label-technical mb-1 block text-xs">From Date</label>
                <input type="date" name="from" id="filter-from" value="${esc(fromDate)}" class="field text-xs w-full">
              </div>

              <div>
                <label class="label-technical mb-1 block text-xs">To Date</label>
                <input type="date" name="to" id="filter-to" value="${esc(toDate)}" class="field text-xs w-full">
              </div>

              <div>
                <label class="label-technical mb-1 block text-xs">Influencer Partner</label>
                <select name="influencerId" id="filter-influencer" class="field text-xs w-full">
                  <option value="">All Influencers</option>
                  ${allInfluencers.map(inf => `
                    <option value="${inf.id}" ${influencerId === inf.id ? 'selected' : ''}>
                      ${esc(inf.display_name)} (${esc(inf.instagram_username || '-')})
                    </option>
                  `).join('')}
                </select>
              </div>

              <div>
                <label class="label-technical mb-1 block text-xs">Commission Status</label>
                <select name="status" id="filter-status" class="field text-xs w-full">
                  <option value="">All Statuses</option>
                  <option value="VERIFIED" ${status === 'VERIFIED' ? 'selected' : ''}>Verified</option>
                  <option value="PENDING" ${status === 'PENDING' ? 'selected' : ''}>Pending</option>
                  <option value="APPROVED" ${status === 'APPROVED' ? 'selected' : ''}>Approved</option>
                  <option value="PAID" ${status === 'PAID' ? 'selected' : ''}>Paid</option>
                  <option value="REVERSED" ${status === 'REVERSED' ? 'selected' : ''}>Reversed</option>
                  <option value="DISPUTED" ${status === 'DISPUTED' ? 'selected' : ''}>Disputed</option>
                </select>
              </div>

              <div>
                <label class="label-technical mb-1 block text-xs">Sort By</label>
                <select name="sort" id="filter-sort" class="field text-xs w-full">
                  <option value="purchased_date_desc" ${sort === 'purchased_date_desc' ? 'selected' : ''}>Purchase Date (Newest)</option>
                  <option value="purchased_date_asc" ${sort === 'purchased_date_asc' ? 'selected' : ''}>Purchase Date (Oldest)</option>
                  <option value="revenue_desc" ${sort === 'revenue_desc' ? 'selected' : ''}>Eligible Value (High to Low)</option>
                  <option value="revenue_asc" ${sort === 'revenue_asc' ? 'selected' : ''}>Eligible Value (Low to High)</option>
                  <option value="commission_desc" ${sort === 'commission_desc' ? 'selected' : ''}>Commission (High to Low)</option>
                  <option value="commission_asc" ${sort === 'commission_asc' ? 'selected' : ''}>Commission (Low to High)</option>
                  <option value="customer_asc" ${sort === 'customer_asc' ? 'selected' : ''}>Customer Name (A-Z)</option>
                </select>
              </div>

              <div>
                <label class="label-technical mb-1 block text-xs">Search Text</label>
                <input type="text" name="search" id="filter-search" value="${esc(search)}" placeholder="Customer, business, ref..." class="field text-xs w-full">
              </div>
            </div>

            <div class="flex items-center justify-between gap-3 pt-1 border-t border-outline/50">
              <p class="text-[11px] text-on-surface-variant">
                ${hasActiveFilters ? '<span class="text-primary font-medium">Filtered active</span> · ' : ''}
                Values exclude GST from commissionable base per partner agreement.
              </p>
              <div class="flex items-center gap-2">
                ${button({ label: 'Reset', action: 'reset-sales-filters', size: 'sm' })}
                ${button({ label: 'Apply Filters', type: 'submit', variant: 'primary', size: 'sm' })}
              </div>
            </div>
          </form>

          <!-- Report View Switcher Tabs -->
          <div class="flex border-b border-outline">
            <button type="button" data-action="switch-sales-view" data-tab="transactions"
              class="border-b-2 px-5 py-2.5 text-xs font-medium transition-colors ${viewTab === 'transactions' ? 'border-primary font-bold text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}">
              Sales Transactions (${totalSalesCount})
            </button>
            <button type="button" data-action="switch-sales-view" data-tab="partners"
              class="border-b-2 px-5 py-2.5 text-xs font-medium transition-colors ${viewTab === 'partners' ? 'border-primary font-bold text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}">
              Influencer Performance Breakdown (${influencerSummaries.length})
            </button>
          </div>

          <!-- TAB 1: Detailed Sales Transactions Table -->
          ${viewTab === 'transactions' ? card({
            title: `Attributed Sales Transactions`,
            subtitle: `Showing ${salesRecords.length} of ${totalSalesCount} recorded customer transactions matching active criteria.`,
            body: totalSalesCount === 0 ? (
              hasActiveFilters ? emptyState({
                icon: 'search_off',
                title: 'No Sales Matching Filters',
                message: 'No sales records match the selected date range or filter criteria. Try adjusting or clearing your date range.',
                actionLabel: 'Reset All Filters',
                action: 'reset-sales-filters'
              }) : emptyState({
                icon: 'receipt_long',
                title: 'No Sales Recorded Yet',
                message: 'No influencer sales transactions have been imported or attributed yet. Upload customer sales in Excel format to populate reports.',
                actionLabel: 'Import Sales Excel',
                action: 'goto-import'
              })
            ) : `
              <div class="overflow-x-auto">
                <table class="w-full text-left text-xs min-w-[1100px]">
                  <thead class="border-b border-outline bg-surface-dim font-mono uppercase text-[10px] text-on-surface-variant">
                    <tr>
                      <th class="p-2.5">S.No.</th>
                      <th class="p-2.5">Date</th>
                      <th class="p-2.5">Influencer Partner</th>
                      <th class="p-2.5">Customer &amp; Business</th>
                      <th class="p-2.5">Product</th>
                      <th class="p-2.5">Ref / Order</th>
                      <th class="p-2.5 text-right">Gross Price</th>
                      <th class="p-2.5 text-right">GST Amount</th>
                      <th class="p-2.5 text-right font-bold text-emerald-800">Net Eligible</th>
                      <th class="p-2.5 text-center">Comm %</th>
                      <th class="p-2.5 text-right font-bold text-blue-800">Commission</th>
                      <th class="p-2.5">Status</th>
                      <th class="p-2.5">Source</th>
                      <th class="p-2.5 text-right">Settlement Action</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-outline">
                    ${salesRecords.map((r, idx) => {
                      const rowNum = (page - 1) * limit + idx + 1;
                      const isVerified = r.is_revenue_verified && r.eligible_revenue_minor !== null;
                      const commPercentStr = r.commission_rate_bp ? `${(r.commission_rate_bp / 100).toFixed(1)}%` : '-';
                      return `
                        <tr class="hover:bg-surface-dim transition-colors">
                          <td class="p-2.5 font-mono text-[11px] text-on-surface-variant">${rowNum}</td>
                          <td class="p-2.5 whitespace-nowrap font-mono text-[11px]">${date(r.purchased_date)}</td>
                          <td class="p-2.5">
                            <p class="font-semibold text-on-surface">${esc(r.influencer_display_name || r.raw_influencer_name || 'Unattributed')}</p>
                            <p class="font-mono text-[10px] text-on-surface-variant">${esc(r.influencer_handle ? `@${r.influencer_handle.replace(/^@/, '')}` : '-')}</p>
                          </td>
                          <td class="p-2.5">
                            <p class="font-medium text-on-surface">${esc(r.customer_name)}</p>
                            <p class="text-[10px] text-on-surface-variant">${esc(r.business_name || '-')}</p>
                          </td>
                          <td class="p-2.5">
                            <p class="text-on-surface">${esc(r.product_name)}</p>
                            <p class="text-[10px] text-on-surface-variant">${r.is_lifetime ? 'Lifetime' : (r.expiry_date ? `Exp: ${date(r.expiry_date)}` : '')}</p>
                          </td>
                          <td class="p-2.5 font-mono text-[11px] text-on-surface-variant">${esc(r.order_reference || '—')}</td>
                          <td class="p-2.5 text-right font-mono">${r.sale_amount_minor !== null ? money(r.sale_amount_minor) : '—'}</td>
                          <td class="p-2.5 text-right font-mono text-on-surface-variant">${money(r.gst_amount_minor || 0)}</td>
                          <td class="p-2.5 text-right font-mono font-semibold text-emerald-700">
                            ${isVerified ? money(r.eligible_revenue_minor) : '<span class="text-[10px] text-amber-700 italic">Awaiting</span>'}
                          </td>
                          <td class="p-2.5 text-center font-mono text-[11px]">${commPercentStr}</td>
                          <td class="p-2.5 text-right font-mono font-bold text-blue-700">
                            ${isVerified ? money(r.calculated_commission_minor) : '<span class="text-[10px] text-on-surface-variant italic">—</span>'}
                          </td>
                          <td class="p-2.5 whitespace-nowrap">${statusBadge(r.commission_status)}</td>
                          <td class="p-2.5 whitespace-nowrap">${badge(r.revenue_source || 'IMPORTED', 'neutral')}</td>
                          <td class="p-2.5 text-right whitespace-nowrap">
                            <select class="sale-status-quick-select text-[10px] py-1 px-1.5 border border-outline bg-surface rounded" data-id="${r.id}">
                              <option value="VERIFIED" ${r.commission_status === 'VERIFIED' ? 'selected' : ''}>Verified</option>
                              <option value="PENDING" ${r.commission_status === 'PENDING' ? 'selected' : ''}>Pending</option>
                              <option value="APPROVED" ${r.commission_status === 'APPROVED' ? 'selected' : ''}>Approved</option>
                              <option value="PAID" ${r.commission_status === 'PAID' ? 'selected' : ''}>Paid</option>
                              <option value="REVERSED" ${r.commission_status === 'REVERSED' ? 'selected' : ''}>Reversed</option>
                              <option value="DISPUTED" ${r.commission_status === 'DISPUTED' ? 'selected' : ''}>Disputed</option>
                            </select>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
              ${pagination({ page: salesData.page, total: totalSalesCount, limit: salesData.limit })}
            `
          }) : ''}

          <!-- TAB 2: Influencer Partner Performance Summary Table -->
          ${viewTab === 'partners' ? card({
            title: 'Influencer Performance & Revenue-Sharing Summary',
            subtitle: 'Aggregated sales totals and commission entitlements per partner creator.',
            body: influencerSummaries.length === 0 ? `
              <div class="p-12 text-center text-xs text-on-surface-variant">
                No attributed sales records found for active partners in this date period.
              </div>
            ` : `
              <div class="overflow-x-auto">
                <table class="w-full text-left text-xs min-w-[860px]">
                  <thead class="border-b border-outline bg-surface-dim font-mono uppercase text-[11px] text-on-surface-variant">
                    <tr>
                      <th class="p-3">Influencer</th>
                      <th class="p-3 text-center">Total Sales</th>
                      <th class="p-3 text-right">Verified Net Revenue</th>
                      <th class="p-3 text-center">Commission Rate</th>
                      <th class="p-3 text-right">Calculated Comm</th>
                      <th class="p-3 text-right">Pending</th>
                      <th class="p-3 text-right">Paid</th>
                      <th class="p-3 text-right">Reports &amp; Drilldown</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-outline">
                    ${influencerSummaries.map(inf => `
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
                            <button type="button" class="btn btn-secondary text-xs py-1 px-2.5 btn-view-sales" data-action="view-partner-sales" data-id="${inf.influencer_id}">
                              ${icon('visibility', '!text-[14px]')}<span>View Sales</span>
                            </button>
                            <button type="button" class="btn btn-secondary text-xs py-1 px-2 btn-dl-inf-pdf" data-action="download-partner-pdf" data-id="${inf.influencer_id}" title="Download Partner PDF Report">
                              ${icon('picture_as_pdf', '!text-[14px]')}
                            </button>
                            <button type="button" class="btn btn-secondary text-xs py-1 px-2 btn-dl-inf-xlsx" data-action="export-partner-xlsx" data-id="${inf.influencer_id}" title="Export Partner Excel">
                              ${icon('download', '!text-[14px]')}
                            </button>
                            <button type="button" class="btn btn-secondary text-xs py-1 px-2 btn-dl-inf-csv" data-action="export-partner-csv" data-id="${inf.influencer_id}" title="Export Partner CSV">
                              <span class="font-mono text-[10px]">CSV</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `
          }) : ''}
        </div>
      `;

      // Preset auto-populator
      const presetSelect = container.querySelector('#filter-preset');
      const fromInput = container.querySelector('#filter-from');
      const toInput = container.querySelector('#filter-to');
      if (presetSelect && fromInput && toInput) {
        presetSelect.addEventListener('change', () => {
          if (presetSelect.value && presetSelect.value !== 'custom') {
            const resolved = resolveDatePreset(presetSelect.value);
            fromInput.value = resolved.from || '';
            toInput.value = resolved.to || '';
          }
        });
      }

      // Filter Form Submit
      const filterForm = container.querySelector('#sales-report-filters');
      if (filterForm) {
        filterForm.addEventListener('submit', event => {
          event.preventDefault();
          const fd = new FormData(filterForm);
          search = String(fd.get('search') || '').trim();
          preset = String(fd.get('preset') || '');
          fromDate = String(fd.get('from') || '');
          toDate = String(fd.get('to') || '');
          influencerId = String(fd.get('influencerId') || '');
          status = String(fd.get('status') || '');
          sort = String(fd.get('sort') || 'purchased_date_desc');
          page = 1;

          ctx.setFilters({ search, preset, from: fromDate, to: toDate, influencerId, status, sort, viewTab });
          ctx.setPage(1);
          loadAndRender();
        });
      }

      // Quick status update dropdowns in transactions table
      container.querySelectorAll('.sale-status-quick-select').forEach(sel => {
        sel.addEventListener('change', async () => {
          const saleId = sel.dataset.id;
          const newStatus = sel.value;
          try {
            await api.post(`/api/marketing/sales/${saleId}/status`, { status: newStatus });
            toast(`Commission status updated to ${newStatus}`);
            loadAndRender();
          } catch (err) {
            toast(err.message || 'Status update failed.', 'danger');
            loadAndRender();
          }
        });
      });

      // View sales drilldown modal in partners table
      container.querySelectorAll('.btn-view-sales').forEach(btn => {
        btn.addEventListener('click', async () => {
          const infId = btn.dataset.id;
          await openInfluencerSalesModal(infId, ctx, loadAndRender);
        });
      });

      // Individual partner export buttons
      container.querySelectorAll('.btn-dl-inf-pdf').forEach(btn => {
        btn.addEventListener('click', async () => {
          const infId = btn.dataset.id;
          try {
            await api.openDocument(`/api/marketing/influencers/${infId}/sales/report.pdf${query({ fromDate, toDate, productId })}`, { download: false });
          } catch (err) {
            toast(err.message || 'PDF report generation failed.', 'danger');
          }
        });
      });

      container.querySelectorAll('.btn-dl-inf-xlsx').forEach(btn => {
        btn.addEventListener('click', async () => {
          const infId = btn.dataset.id;
          try {
            await api.openDocument(`/api/marketing/influencers/${infId}/sales/export.xlsx${query({ fromDate, toDate, productId, search, status })}`, { download: true });
          } catch (err) {
            toast(err.message || 'Excel export failed.', 'danger');
          }
        });
      });

      container.querySelectorAll('.btn-dl-inf-csv').forEach(btn => {
        btn.addEventListener('click', async () => {
          const infId = btn.dataset.id;
          try {
            await api.openDocument(`/api/marketing/influencers/${infId}/sales/export.csv${query({ fromDate, toDate, productId, search, status })}`, { download: true });
          } catch (err) {
            toast(err.message || 'CSV export failed.', 'danger');
          }
        });
      });

    } catch (err) {
      container.innerHTML = `
        ${pageHeader({
          title: 'Influencer Sales Reports',
          subtitle: 'Track attributed customer purchases, calculate revenue share, and export individual or consolidated financial reports.',
        })}
        ${tabs('reports')}
        <div class="my-6 space-y-4">
          ${alertBox(`Failed to load sales reports: ${esc(err.message || 'Unexpected server error')}`, 'danger')}
          <div class="flex items-center gap-2">
            ${button({ label: 'Try Again', action: 'retry-sales-reports', variant: 'primary', icon: 'refresh' })}
            <a href="#/marketing" class="btn btn-secondary inline-flex items-center gap-2">
              ${icon('arrow_back', '!text-[18px]')}<span>Back to Marketing</span>
            </a>
          </div>
        </div>
      `;
    }
  }

  // Action Registrations
  ctx.on('retry-sales-reports', () => loadAndRender());

  ctx.on('reset-sales-filters', () => {
    search = '';
    preset = '';
    fromDate = '';
    toDate = '';
    influencerId = '';
    status = '';
    sort = 'purchased_date_desc';
    page = 1;
    ctx.setFilters({ viewTab });
    ctx.setPage(1);
    loadAndRender();
  });

  ctx.on('goto-import', () => {
    location.hash = '#/marketing/import';
  });

  ctx.on('switch-sales-view', trigger => {
    viewTab = trigger.dataset.tab || 'transactions';
    ctx.setFilters({ ...ctx.filters, viewTab });
    loadAndRender();
  });

  ctx.on('page-prev', () => {
    if (page > 1) {
      page -= 1;
      ctx.setPage(page);
      loadAndRender();
    }
  });

  ctx.on('page-next', () => {
    page += 1;
    ctx.setPage(page);
    loadAndRender();
  });

  ctx.on('export-pdf', async () => {
    try {
      await api.openDocument(`/api/marketing/sales/consolidated-report.pdf${query({ fromDate, toDate, productId, influencerId })}`, { download: false });
    } catch (err) {
      toast(err.message || 'PDF export failed.', 'danger');
    }
  });

  ctx.on('export-excel', async () => {
    try {
      await api.openDocument(`/api/marketing/sales/export.xlsx${query({ influencerId, search, fromDate, toDate, productId, status })}`, { download: true });
    } catch (err) {
      toast(err.message || 'Excel export failed.', 'danger');
    }
  });

  ctx.on('export-csv', async () => {
    try {
      await api.openDocument(`/api/marketing/sales/export.csv${query({ influencerId, search, fromDate, toDate, productId, status })}`, { download: true });
    } catch (err) {
      toast(err.message || 'CSV export failed.', 'danger');
    }
  });

  ctx.on('view-partner-sales', async trigger => {
    const infId = trigger.dataset.id;
    await openInfluencerSalesModal(infId, ctx, loadAndRender);
  });

  ctx.on('download-partner-pdf', async trigger => {
    const infId = trigger.dataset.id;
    try {
      await api.openDocument(`/api/marketing/influencers/${infId}/sales/report.pdf${query({ fromDate, toDate, productId })}`, { download: false });
    } catch (err) {
      toast(err.message || 'PDF report generation failed.', 'danger');
    }
  });

  ctx.on('export-partner-xlsx', async trigger => {
    const infId = trigger.dataset.id;
    try {
      await api.openDocument(`/api/marketing/influencers/${infId}/sales/export.xlsx${query({ fromDate, toDate, productId, search, status })}`, { download: true });
    } catch (err) {
      toast(err.message || 'Excel export failed.', 'danger');
    }
  });

  ctx.on('export-partner-csv', async trigger => {
    const infId = trigger.dataset.id;
    try {
      await api.openDocument(`/api/marketing/influencers/${infId}/sales/export.csv${query({ fromDate, toDate, productId, search, status })}`, { download: true });
    } catch (err) {
      toast(err.message || 'CSV export failed.', 'danger');
    }
  });

  await loadAndRender();
}

async function openInfluencerSalesModal(infId, ctx, onRefresh) {
  try {
    const res = await api.get(`/api/marketing/influencers/${infId}/sales?limit=100`);
    const influencer = res.influencer;
    const records = res.records || [];

    const m = modal({
      title: `Attributed Sales — ${influencer.display_name}`,
      size: 'wide',
      body: `
        <div class="space-y-4">
          <div class="flex flex-col sm:flex-row items-center justify-between gap-3 border-b border-outline pb-3">
            <div>
              <p class="font-mono text-xs text-on-surface-variant">Instagram: ${esc(influencer.instagram_username || '-')} | Legal Name: ${esc(influencer.legal_name)}</p>
              <p class="text-xs text-on-surface-variant">Showing ${records.length} customer sales attributed to this partner.</p>
            </div>
            <div class="flex items-center gap-2">
              <button type="button" class="btn btn-secondary text-xs inline-flex items-center gap-1.5 btn-modal-pdf">
                ${icon('picture_as_pdf', '!text-[14px]')}<span>PDF Report</span>
              </button>
              <button type="button" class="btn btn-secondary text-xs inline-flex items-center gap-1.5 btn-modal-xlsx">
                ${icon('download', '!text-[14px]')}<span>Export Excel</span>
              </button>
              <button type="button" class="btn btn-secondary text-xs inline-flex items-center gap-1.5 btn-modal-csv">
                <span class="font-mono text-[10px]">CSV</span>
              </button>
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
                        <option value="VERIFIED" ${r.commission_status === 'VERIFIED' ? 'selected' : ''}>Verified</option>
                        <option value="PENDING" ${r.commission_status === 'PENDING' ? 'selected' : ''}>Pending</option>
                        <option value="APPROVED" ${r.commission_status === 'APPROVED' ? 'selected' : ''}>Approved</option>
                        <option value="PAID" ${r.commission_status === 'PAID' ? 'selected' : ''}>Paid</option>
                        <option value="REVERSED" ${r.commission_status === 'REVERSED' ? 'selected' : ''}>Reversed</option>
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

    m.querySelector('.btn-modal-pdf')?.addEventListener('click', async () => {
      try {
        await api.openDocument(`/api/marketing/influencers/${infId}/sales/report.pdf`, { download: false });
      } catch (err) {
        toast(err.message || 'PDF export failed.', 'danger');
      }
    });

    m.querySelector('.btn-modal-xlsx')?.addEventListener('click', async () => {
      try {
        await api.openDocument(`/api/marketing/influencers/${infId}/sales/export.xlsx`, { download: true });
      } catch (err) {
        toast(err.message || 'Excel export failed.', 'danger');
      }
    });

    m.querySelector('.btn-modal-csv')?.addEventListener('click', async () => {
      try {
        await api.openDocument(`/api/marketing/influencers/${infId}/sales/export.csv`, { download: true });
      } catch (err) {
        toast(err.message || 'CSV export failed.', 'danger');
      }
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
  } catch (err) {
    toast(err.message || 'Failed to open partner sales drilldown.', 'danger');
  }
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
    if (segments[2] === 'software' && segments[4] === 'preview') {
      await renderSoftwareAgreementPreview(container, segments[3], ctx);
    } else if (segments[2] === 'software' && segments[4] === 'edit') {
      await renderAgreements(container, params, ctx);
      const res = await api.get(`/api/marketing/software-agreements/${segments[3]}`);
      softwareAgreementForm(ctx, res.agreement);
    } else if (segments[2] === 'new') {
      await renderAgreements(container, params, ctx);
      promptContractType(ctx);
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
