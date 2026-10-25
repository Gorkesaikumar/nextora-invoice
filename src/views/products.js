import { api, query } from '../lib/api.js';
import { computeLine } from '../lib/money.js';
import {
  esc, money, percent, button, card, emptyState, loading, pageHeader, pagination, field, alertBox,
  modal, closeModal, toast, statusBadge, toMajor, parseAmount, titleCase,
} from '../lib/ui.js';

function productForm(ctx, existing = null) {
  const reference = ctx.reference;
  const orgTaxMode = reference?.business?.product_price_tax_mode || 'EXCLUSIVE';
  const product = existing || {
    name: '', sku: '', description: '', category: '', unit: 'NOS', unit_price_minor: 0,
    tax_treatment: 'TAXABLE', tax_rate_bp: reference.business.default_tax_rate_bp, tax_mode: null, hsn_sac: '',
    status: 'ACTIVE', billing_interval: 'NONE', license_duration_months: 0, validity_notes: '',
  };
  const node = modal({
    title: existing ? 'Edit catalog entry' : 'New product or service',
    body: `
      <form id="product-form" class="grid grid-cols-1 gap-4 sm:grid-cols-2" novalidate>
        ${field({ label: 'Name', name: 'name', required: true, value: product.name, className: 'sm:col-span-2' })}
        ${field({ label: 'Internal SKU or code', name: 'sku', value: product.sku })}
        ${field({ label: 'Category', name: 'category', value: product.category, hint: 'Group related items, for example Nextora POS.' })}
        ${field({ label: 'Unit of measurement', name: 'unit', value: product.unit, placeholder: 'NOS, LIC, HRS, DAY' })}
        ${field({ label: 'Default unit price (₹)', name: 'unit_price', type: 'number', step: '0.01', min: '0',
    value: toMajor(product.unit_price_minor) })}
        ${field({ label: 'Price tax mode', name: 'tax_mode', value: product.tax_mode || '',
    options: [
      { value: '', label: `Inherit business setting (${orgTaxMode})` },
      { value: 'EXCLUSIVE', label: 'EXCLUSIVE — GST is added to entered price' },
      { value: 'INCLUSIVE', label: 'INCLUSIVE — Entered price includes GST' },
    ],
    hint: 'Whether entered product price includes or excludes GST.' })}
        ${field({ label: 'Tax classification', name: 'tax_treatment', value: product.tax_treatment,
    options: reference.tax_treatments.map(treatment => ({ value: treatment, label: titleCase(treatment) })) })}
        ${field({ label: 'GST rate', name: 'tax_rate_bp', value: String(product.tax_rate_bp),
    options: reference.gst_rate_slabs.map(slab => ({ value: String(slab.bp), label: slab.label })) })}
        <div id="product-price-preview" class="sm:col-span-2 rounded border border-outline bg-surface-dim p-3 text-xs"></div>
        ${field({ label: 'HSN / SAC code', name: 'hsn_sac', value: product.hsn_sac, placeholder: '998314' })}
        ${field({ label: 'Status', name: 'status', value: product.status,
    options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }] })}
        ${field({ label: 'Billing interval', name: 'billing_interval', value: product.billing_interval,
    options: reference.billing_intervals.map(interval => ({ value: interval, label: titleCase(interval) })),
    hint: 'Leave as None for one-time work.' })}
        ${field({ label: 'Licence duration (months)', name: 'license_duration_months', type: 'number', min: '0', max: '600',
    value: String(product.license_duration_months) })}
        ${field({ label: 'Description', name: 'description', type: 'textarea', value: product.description, className: 'sm:col-span-2' })}
        ${field({ label: 'Validity or renewal notes', name: 'validity_notes', type: 'textarea', value: product.validity_notes, className: 'sm:col-span-2' })}
      </form>
      <p class="mt-4 text-xs text-on-surface-variant">Catalog prices are defaults only. Editing this entry later never changes an already issued document.</p>`,
    footer: `${button({ label: 'Cancel', action: 'close-modal' })}${button({ label: existing ? 'Save entry' : 'Create entry', action: 'save-product', variant: 'primary' })}`,
  });

  const updatePricePreview = () => {
    const form = node.querySelector('#product-form');
    if (!form) return;
    const priceMinor = parseAmount(form.querySelector('[name="unit_price"]')?.value || 0);
    const taxTreatmentVal = String(form.querySelector('[name="tax_treatment"]')?.value || 'TAXABLE');
    const taxRateBpVal = taxTreatmentVal === 'TAXABLE' ? Number(form.querySelector('[name="tax_rate_bp"]')?.value || 0) : 0;
    const chosenMode = String(form.querySelector('[name="tax_mode"]')?.value || '');
    const effectiveMode = chosenMode || orgTaxMode;

    const calc = computeLine({
      quantity_milli: 1000,
      unit_price_minor: priceMinor,
      discount_bp: 0,
      discount_minor: 0,
      tax_treatment: taxTreatmentVal,
      tax_rate_bp: taxRateBpVal,
    }, { tax_mode: effectiveMode });

    const previewHost = node.querySelector('#product-price-preview');
    if (previewHost) {
      const modeLabel = effectiveMode === 'INCLUSIVE' ? 'Inclusive (GST included in price)' : 'Exclusive (GST added on top)';
      previewHost.innerHTML = `
        <div class="font-semibold text-on-surface mb-1 flex items-center justify-between">
          <span>Price breakdown preview</span>
          <span class="font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface border border-outline">${esc(modeLabel)}</span>
        </div>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 mt-2">
          <div><span class="text-on-surface-variant block text-[11px]">Entered price:</span><span class="font-mono font-medium">${money(priceMinor)}</span></div>
          <div><span class="text-on-surface-variant block text-[11px]">Taxable value:</span><span class="font-mono font-medium">${money(calc.taxable_minor)}</span></div>
          <div><span class="text-on-surface-variant block text-[11px]">GST (${percent(taxRateBpVal)}):</span><span class="font-mono font-medium">${money(calc.tax_minor)}</span></div>
          <div><span class="text-on-surface-variant block text-[11px]">Customer price:</span><span class="font-mono font-semibold text-cyan-accent">${money(calc.total_minor)}</span></div>
        </div>
      `;
    }
  };

  const formElement = node.querySelector('#product-form');
  formElement.addEventListener('input', updatePricePreview);
  formElement.addEventListener('change', updatePricePreview);
  updatePricePreview();

  ctx.on('save-product', async () => {
    const form = new FormData(node.querySelector('#product-form'));
    const payload = {
      name: String(form.get('name') || '').trim(),
      sku: String(form.get('sku') || '').trim(),
      description: String(form.get('description') || ''),
      category: String(form.get('category') || '').trim(),
      unit: String(form.get('unit') || 'NOS').trim().toUpperCase(),
      unit_price_minor: parseAmount(form.get('unit_price')),
      tax_treatment: String(form.get('tax_treatment')),
      tax_rate_bp: Number(form.get('tax_rate_bp') || 0),
      tax_mode: form.get('tax_mode') ? String(form.get('tax_mode')) : null,
      hsn_sac: String(form.get('hsn_sac') || '').trim().toUpperCase(),
      status: String(form.get('status')),
      billing_interval: String(form.get('billing_interval')),
      license_duration_months: Number(form.get('license_duration_months') || 0),
      validity_notes: String(form.get('validity_notes') || ''),
    };
    try {
      if (existing) await api.patch(`/api/products/${existing.id}`, payload);
      else await api.post('/api/products', payload);
      closeModal();
      toast(existing ? 'Catalog entry updated.' : 'Catalog entry created.');
      ctx.rerender();
    } catch (error) {
      toast(error.fields?.length ? error.fields.map(item => `${item.field}: ${item.message}`).join(' · ') : error.message, 'danger');
    }
  });
}

export const render = async (container, params, ctx) => {
  const filters = ctx.filters || {};
  container.innerHTML = pageHeader({ title: 'Products & Services' }) + loading();

  let data;
  try {
    data = await api.get(`/api/products${query({ search: filters.search, status: filters.status, category: filters.category, page: ctx.page })}`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Products & Services' }) + alertBox(error.message, 'danger');
    return;
  }

  container.innerHTML = `
    <div class="space-y-6 w-full min-w-0">
      ${pageHeader({
    title: 'Products & Services',
    subtitle: 'Reusable catalog of what Nextora Creations sells, including licences, projects, maintenance and renewals.',
    actions: button({ label: 'New entry', action: 'new-product', variant: 'primary', icon: 'add' }),
  })}
      ${card({
    className: 'w-full max-w-full overflow-hidden',
    body: `
      <form id="product-filters" class="flex flex-wrap items-end gap-3 border-b border-outline px-5 py-4">
        ${field({ label: 'Search', name: 'search', value: filters.search || '', placeholder: 'Name, SKU or description', className: '' })}
        ${field({ label: 'Category', name: 'category', value: filters.category || '',
      options: [{ value: '', label: 'All categories' }, ...data.categories.map(value => ({ value, label: value }))], className: '' })}
        ${field({ label: 'Status', name: 'status', value: filters.status || '',
      options: [{ value: '', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }], className: '' })}
        <div class="flex gap-2 pb-0.5">${button({ label: 'Search', type: 'submit', variant: 'primary' })}</div>
      </form>
      ${data.products.length ? `
      <div class="overflow-x-auto w-full">
        <table class="data-table w-full min-w-[960px]">
          <thead><tr>
            <th>Name</th><th>SKU</th><th>Category</th><th>Unit</th>
            <th class="text-right">Default price <span class="text-[10px] font-normal text-on-surface-variant">(${ctx.reference?.business?.product_price_tax_mode === 'INCLUSIVE' ? 'Incl. GST' : 'Excl. GST'})</span></th><th>Tax</th><th>HSN/SAC</th><th>Interval</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            ${data.products.map(row => {
    const effectiveMode = row.tax_mode || ctx.reference?.business?.product_price_tax_mode || 'EXCLUSIVE';
    const modePill = effectiveMode === 'INCLUSIVE'
      ? '<span class="ml-1 text-[10px] font-sans text-cyan-accent" title="Price includes GST">incl.</span>'
      : '<span class="ml-1 text-[10px] font-sans text-on-surface-variant" title="GST added to price">+GST</span>';
    return `<tr>
              <td><span class="font-medium">${esc(row.name)}</span>
                ${row.description ? `<div class="max-w-[280px] truncate text-xs text-on-surface-variant">${esc(row.description)}</div>` : ''}</td>
              <td class="font-mono text-xs">${esc(row.sku || '—')}</td>
              <td class="text-xs">${esc(row.category || '—')}</td>
              <td class="font-mono text-xs">${esc(row.unit)}</td>
              <td class="num text-right">${money(row.unit_price_minor)}${row.tax_treatment === 'TAXABLE' ? modePill : ''}</td>
              <td class="text-xs">${row.tax_treatment === 'TAXABLE' ? esc(percent(row.tax_rate_bp)) : esc(titleCase(row.tax_treatment))}</td>
              <td class="font-mono text-xs">${esc(row.hsn_sac || '—')}</td>
              <td class="text-xs">${esc(row.billing_interval === 'NONE' ? '—' : titleCase(row.billing_interval))}</td>
              <td>${statusBadge(row.status)}</td>
              <td class="text-right"><button type="button" data-action="edit-product" data-id="${esc(row.id)}"
                class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Edit</button></td>
            </tr>`;
  }).join('')}
          </tbody>
        </table>
      </div>
      ${pagination({ page: data.page, total: data.total, limit: data.limit })}`
      : emptyState({
        icon: 'inventory_2', title: 'The catalog is empty',
        message: 'Add the products and services you sell so quotations and invoices can be created in seconds.',
        actionLabel: 'New entry', action: 'new-product',
      })}
    `,
  })}
    </div>`;

  const rows = new Map(data.products.map(row => [row.id, row]));
  ctx.on('new-product', () => productForm(ctx));
  ctx.on('edit-product', trigger => productForm(ctx, rows.get(trigger.dataset.id)));
  ctx.on('page-prev', () => { ctx.setPage(Math.max(1, ctx.page - 1)); ctx.rerender(); });
  ctx.on('page-next', () => { ctx.setPage(ctx.page + 1); ctx.rerender(); });

  container.querySelector('#product-filters').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.target);
    ctx.setFilters({
      ...ctx.filters,
      search: String(form.get('search') || ''),
      category: String(form.get('category') || ''),
      status: String(form.get('status') || ''),
    });
    ctx.setPage(1);
    ctx.rerender();
  });
};
