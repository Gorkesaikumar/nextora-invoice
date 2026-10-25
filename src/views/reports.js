import { api, query } from '../lib/api.js';
import {
  esc, money, date, percent, button, card, loading, pageHeader, alertBox, toast, titleCase, stat, badge, modal, closeModal,
} from '../lib/ui.js';
import { DATE_PRESETS, resolveDatePreset } from '../lib/date-presets.js';

const SECTIONS = [
  { key: 'overview', label: 'Business overview' },
  { key: 'invoices', label: 'Invoice register' },
  { key: 'collections', label: 'Collections' },
  { key: 'receivables', label: 'Receivables and ageing' },
  { key: 'quotations', label: 'Quotation performance' },
  { key: 'clients', label: 'Revenue by client' },
  { key: 'products', label: 'Revenue by product' },
  { key: 'tax', label: 'Tax summary' },
  { key: 'audit', label: 'Audit trail' },
];

const table = (headers, rows, emptyMessage) => (rows.length
  ? `<div class="overflow-x-auto"><table class="data-table w-full min-w-[760px]">
      <thead><tr>${headers.map(header => `<th class="${header.align === 'right' ? 'text-right' : ''}">${esc(header.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(row => `<tr>${headers.map(header => `<td class="${header.align === 'right' ? 'num text-right' : ''}">${header.render(row)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`
  : `<p class="px-5 py-8 text-center text-sm text-on-surface-variant">${esc(emptyMessage)}</p>`);

const trendBadge = m => {
  if (!m) return '';
  const sign = m.diff > 0 ? '+' : '';
  const tone = m.trend === 'up' ? 'success' : m.trend === 'down' ? 'danger' : 'neutral';
  return badge(`${sign}${m.percent}%`, tone);
};

export const render = async (container, params, ctx) => {
  const section = ctx.filters.section || 'overview';
  const range = { from: ctx.filters.from || '', to: ctx.filters.to || '' };
  const preset = ctx.filters.preset || '';
  const limit = ctx.filters.limit || '20';
  const zeroSales = ctx.filters.zero_sales === 'true';

  container.innerHTML = pageHeader({ title: 'Reports' }) + loading();

  const baseParams = { ...range };
  if (preset) baseParams.preset = preset;
  if (section === 'products') {
    if (limit) baseParams.limit = limit;
    if (zeroSales) baseParams.zero_sales = 'true';
  }
  const base = query(baseParams);

  let data = null;
  try {
    if (section === 'overview') data = await api.get(`/api/reports/overview${base}`);
    else if (section === 'invoices') data = await api.get(`/api/reports/invoices${base}`);
    else if (section === 'collections') data = await api.get(`/api/reports/collections${base}`);
    else if (section === 'receivables') data = await api.get('/api/reports/receivables');
    else if (section === 'quotations') data = await api.get(`/api/reports/quotations${base}`);
    else if (section === 'clients') data = await api.get(`/api/reports/revenue-by-client${base}`);
    else if (section === 'products') data = await api.get(`/api/reports/revenue-by-product${base}`);
    else if (section === 'tax') data = await api.get(`/api/reports/tax-summary${base}`);
    else data = await api.get(`/api/audit${query({ page: ctx.page })}`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Reports' }) + alertBox(error.message, 'danger');
    return;
  }

  let body = '';

  if (section === 'overview') {
    const m = data.metrics || {};
    body = `
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        ${card({
    body: `<div class="p-5">
            <div class="flex items-center justify-between">
              <span class="label-technical">Invoiced Sales</span>
              ${trendBadge(m.invoiced)}
            </div>
            <p class="num mt-2 font-headline text-2xl font-bold">${money(m.invoiced?.current)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Prior period: ${money(m.invoiced?.prior)} (${m.invoices_count?.current || 0} invoices)</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <div class="flex items-center justify-between">
              <span class="label-technical">Collections</span>
              ${trendBadge(m.collected)}
            </div>
            <p class="num mt-2 font-headline text-2xl font-bold">${money(m.collected?.current)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Prior period: ${money(m.collected?.prior)} (${m.receipts_count?.current || 0} receipts)</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <div class="flex items-center justify-between">
              <span class="label-technical">Total Receivables</span>
              ${badge(`${m.receivables?.count || 0} unpaid`, 'neutral')}
            </div>
            <p class="num mt-2 font-headline text-2xl font-bold">${money(m.receivables?.total_minor)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Outstanding across all issued invoices</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <div class="flex items-center justify-between">
              <span class="label-technical">Overdue Balance</span>
              ${m.overdue?.total_minor > 0 ? badge('Attention', 'danger') : badge('Clear', 'success')}
            </div>
            <p class="num mt-2 font-headline text-2xl font-bold ${m.overdue?.total_minor > 0 ? 'text-danger' : ''}">${money(m.overdue?.total_minor)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">${m.overdue?.count || 0} invoices past payment due date</p>
          </div>`,
  })}
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        ${card({
    body: `<div class="p-5">
            <span class="label-technical">Taxable Turnover</span>
            <p class="num mt-2 font-headline text-xl font-bold">${money(m.taxable?.current)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">${trendBadge(m.taxable)} vs prior period</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <span class="label-technical">Total Output GST</span>
            <p class="num mt-2 font-headline text-xl font-bold">${money(m.tax?.current)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">CGST + SGST + IGST liability</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <span class="label-technical">Active Clients</span>
            <p class="num mt-2 font-headline text-xl font-bold">${m.active_clients || 0}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Customers billed in this date range</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <span class="label-technical">Cancelled Invoices</span>
            <p class="num mt-2 font-headline text-xl font-bold">${m.cancelled_count || 0}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Excluded from sales totals</p>
          </div>`,
  })}
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        ${card({
    title: 'Top Products & Services',
    subtitle: 'Ranked by total invoiced sales value in this period',
    body: table([
      { label: '#', render: (_, i) => String(i + 1) },
      { label: 'Item', render: row => `<strong>${esc(row.description)}</strong>` },
      { label: 'Qty', align: 'right', render: row => (Number(row.quantity_milli || 0) / 1000).toLocaleString('en-IN') },
      { label: 'Sales', align: 'right', render: row => money(row.total_minor) },
    ], data.top_products || [], 'No product sales recorded in this period.'),
  })}
        ${card({
    title: 'Top Clients by Invoiced Value',
    subtitle: 'Clients with highest billing volume in this period',
    body: table([
      { label: '#', render: (_, i) => String(i + 1) },
      { label: 'Client Name', render: row => `<strong>${esc(row.client_name)}</strong>` },
      { label: 'Invoiced Value', align: 'right', render: row => money(row.invoiced_minor) },
    ], data.top_clients || [], 'No client billings recorded in this period.'),
  })}
      </div>
    `;
  } else if (section === 'invoices') {
    body = card({
      title: 'Invoices issued',
      subtitle: 'Invoiced value is the full document value; collected is money actually received.',
      body: table([
        { label: 'Number', render: row => `<span class="font-mono text-xs">${esc(row.invoice_number || 'Draft')}</span>` },
        { label: 'Issued', render: row => date(row.issue_date) },
        { label: 'Client', render: row => esc(row.client_name) },
        { label: 'Document status', render: row => `${esc(titleCase(row.status))}` },
        { label: 'Payment state', render: row => esc(titleCase(row.payment_status)) },
        { label: 'Taxable', align: 'right', render: row => money(row.taxable_minor) },
        { label: 'Tax', align: 'right', render: row => money(Number(row.cgst_minor || 0) + Number(row.sgst_minor || 0) + Number(row.igst_minor || 0)) },
        { label: 'Invoice total', align: 'right', render: row => money(row.grand_total_minor) },
        { label: 'Collected', align: 'right', render: row => money(row.paid_minor) },
        { label: 'Balance', align: 'right', render: row => money(row.balance_due_minor) },
      ], data.rows, 'No invoices issued in this range.'),
    });
  } else if (section === 'collections') {
    body = `${card({
      title: 'Money collected',
      subtitle: 'Receipts recorded against issued invoices.',
      body: table([
        { label: 'Receipt', render: row => `<span class="font-mono text-xs">${esc(row.receipt_number)}</span>` },
        { label: 'Paid on', render: row => date(row.paid_on) },
        { label: 'Client', render: row => esc(row.client_name) },
        { label: 'Invoice', render: row => `<span class="font-mono text-xs">${esc(row.invoice_number || '')}</span>` },
        { label: 'Method', render: row => esc(titleCase(row.method)) },
        { label: 'Reference', render: row => esc(row.reference || '—') },
        { label: 'Amount', align: 'right', render: row => money(row.amount_minor) },
      ], data.rows, 'No payments recorded in this range.'),
    })}
    ${card({
    title: 'By month',
    body: table([
      { label: 'Month', render: row => esc(row.month) },
      { label: 'Receipts', align: 'right', render: row => String(row.receipts) },
      { label: 'Collected', align: 'right', render: row => money(row.collected_minor) },
    ], data.by_month, 'No collections in this range.'),
  })}`;
  } else if (section === 'receivables') {
    body = `${card({
      title: 'Ageing',
      body: `<div class="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-5">
        ${Object.entries(data.buckets).map(([b, val]) => `<div>
          <p class="label-technical">${esc(b === 'NOT_DUE' ? 'Not due' : `${b} days`)}</p>
          <p class="num mt-1 font-headline text-lg font-bold">${money(val)}</p></div>`).join('')}
      </div>`,
    })}
    ${card({
    title: 'Outstanding balances',
    subtitle: `Total outstanding ${money(data.total_minor)}`,
    body: table([
      { label: 'Invoice', render: row => `<span class="font-mono text-xs">${esc(row.invoice_number)}</span>` },
      { label: 'Client', render: row => esc(row.client_name) },
      { label: 'Issued', render: row => date(row.issue_date) },
      { label: 'Due', render: row => date(row.due_date) },
      { label: 'Days overdue', align: 'right', render: row => String(row.days_overdue) },
      { label: 'Bucket', render: row => esc(row.ageing === 'NOT_DUE' ? 'Not due' : row.ageing) },
      { label: 'Total', align: 'right', render: row => money(row.grand_total_minor) },
      { label: 'Collected', align: 'right', render: row => money(row.paid_minor) },
      { label: 'Balance', align: 'right', render: row => money(row.balance_due_minor) },
    ], data.rows, 'Nothing outstanding. Every issued invoice is settled.'),
  })}`;
  } else if (section === 'quotations') {
    body = `${card({
      body: `<div class="grid grid-cols-1 gap-4 p-5 sm:grid-cols-4">
        ${stat({ label: 'Accepted', value: String(data.accepted) })}
        ${stat({ label: 'Rejected', value: String(data.rejected) })}
        ${stat({ label: 'Converted to invoices', value: String(data.converted) })}
        ${stat({ label: 'Acceptance rate', value: `${(data.conversion_rate_bp / 100).toFixed(1)}%` })}
      </div>`,
    })}
    ${card({
    title: 'Quotations issued',
    body: table([
      { label: 'Number', render: row => `<span class="font-mono text-xs">${esc(row.quotation_number || 'Draft')}</span>` },
      { label: 'Client', render: row => esc(row.client_name) },
      { label: 'Title', render: row => esc(row.title) },
      { label: 'Issued', render: row => date(row.issue_date) },
      { label: 'Status', render: row => esc(titleCase(row.effective_status)) },
      { label: 'Converted', render: row => (row.converted ? badge('Yes', 'success') : badge('No', 'neutral')) },
      { label: 'Value', align: 'right', render: row => money(row.grand_total_minor) },
    ], data.rows, 'No quotations issued in this range.'),
  })}`;
  } else if (section === 'clients') {
    body = card({
      title: 'Customer-Wise Revenue & Receivables',
      subtitle: 'Click "Statement" to view the complete itemized transaction ledger for any customer.',
      body: table([
        { label: 'Client', render: row => `<strong>${esc(row.client_name)}</strong>` },
        { label: 'Company', render: row => esc(row.company_name || '—') },
        { label: 'GSTIN', render: row => `<span class="font-mono text-xs">${esc(row.gstin || '—')}</span>` },
        { label: 'Invoices', align: 'right', render: row => String(row.invoice_count || 0) },
        { label: 'First Inv', render: row => date(row.first_invoice_date) },
        { label: 'Last Inv', render: row => date(row.last_invoice_date) },
        { label: 'Invoiced', align: 'right', render: row => money(row.invoiced_minor) },
        { label: 'Collected', align: 'right', render: row => money(row.collected_minor) },
        { label: 'Balance', align: 'right', render: row => money(row.balance_minor) },
        { label: 'Overdue', align: 'right', render: row => `<span class="${row.overdue_minor > 0 ? 'text-danger font-bold' : ''}">${money(row.overdue_minor)}</span>` },
        { label: 'Action', render: row => `<button type="button" data-action="statement" data-client-id="${esc(row.id)}" data-client-name="${esc(row.client_name)}" class="text-xs font-semibold text-primary hover:underline">Statement</button>` },
      ], data.rows, 'No client activity in this range.'),
    });
  } else if (section === 'products') {
    body = `${card({
      title: 'Revenue by product or service',
      subtitle: `Showing ${data.rows.length} items. Total invoiced product turnover: ${money(data.total_minor)}.`,
      body: table([
        { label: 'Item', render: row => `<strong>${esc(row.description)}</strong>` },
        { label: 'SKU', render: row => `<span class="font-mono text-xs">${esc(row.sku || '—')}</span>` },
        { label: 'Category', render: row => esc(row.category || '—') },
        { label: 'Quantity', align: 'right', render: row => (row.quantity_milli / 1000).toLocaleString('en-IN') },
        { label: 'Unit', render: row => esc(row.unit || 'NOS') },
        { label: 'Invoices', align: 'right', render: row => String(row.invoices) },
        { label: 'Avg Price', align: 'right', render: row => money(row.average_price_minor) },
        { label: 'Taxable', align: 'right', render: row => money(row.taxable_minor) },
        { label: 'Tax', align: 'right', render: row => money(row.tax_minor) },
        { label: 'Total', align: 'right', render: row => `<strong>${money(row.total_minor)}</strong>` },
        { label: 'Share', align: 'right', render: row => badge(esc(row.contribution_pct), 'neutral') },
      ], data.rows, 'No issued invoice lines in this range.'),
    })}
    ${data.zero_sales_rows?.length ? card({
    title: `Zero-Sales Catalog Items (${data.zero_sales_rows.length})`,
    subtitle: 'Active products in the catalog with no sales during this period.',
    body: table([
      { label: 'Product Name', render: row => `<strong>${esc(row.description)}</strong>` },
      { label: 'SKU', render: row => `<span class="font-mono text-xs">${esc(row.sku || '—')}</span>` },
      { label: 'Category', render: row => esc(row.category || '—') },
      { label: 'Unit', render: row => esc(row.unit || 'NOS') },
      { label: 'Catalog Price', align: 'right', render: row => money(row.unit_price_minor) },
    ], data.zero_sales_rows, 'No inactive products.'),
  }) : ''}`;
  } else if (section === 'tax') {
    body = `${card({
      title: 'Tax on issued invoices',
      subtitle: 'Calculated from saved transactions and net of credit notes. This is a system record, not a filed return.',
      body: `<div class="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
          ${stat({ label: 'Taxable value', value: money(data.net.taxable_minor) })}
          ${stat({ label: 'Total tax', value: money(data.net.tax_minor) })}
          ${stat({ label: 'Non-taxable value', value: money(data.exempt_taxable_minor), hint: 'Exempt, nil rated or outside GST' })}
        </div>
        <div class="grid grid-cols-1 gap-4 border-t border-outline px-5 py-4 sm:grid-cols-3">
          ${stat({ label: 'CGST', value: money(data.net.cgst_minor) })}
          ${stat({ label: 'SGST', value: money(data.net.sgst_minor) })}
          ${stat({ label: 'IGST', value: money(data.net.igst_minor) })}
        </div>`,
    })}
    ${card({
    title: 'By rate and HSN/SAC',
    body: table([
      { label: 'HSN/SAC', render: row => esc(row.hsn_sac || '—') },
      { label: 'Rate', render: row => esc(percent(row.tax_rate_bp)) },
      { label: 'Taxable value', align: 'right', render: row => money(row.taxable_minor) },
      { label: 'CGST', align: 'right', render: row => money(row.cgst_minor) },
      { label: 'SGST', align: 'right', render: row => money(row.sgst_minor) },
      { label: 'IGST', align: 'right', render: row => money(row.igst_minor) },
      { label: 'Total tax', align: 'right', render: row => money(row.tax_minor) },
    ], data.output_rows, 'No taxable supply in this range.'),
  })}
    ${data.credit_note || data.debit_note ? card({
    title: 'Adjustment notes',
    body: table([
      { label: 'Kind', render: row => esc(titleCase(row.kind)) },
      { label: 'Taxable value', align: 'right', render: row => money(row.taxable_minor) },
      { label: 'Tax', align: 'right', render: row => money(row.tax_minor) },
    ], [data.credit_note, data.debit_note].filter(Boolean), 'No notes.'),
  }) : ''}`;
  } else {
    body = card({
      title: 'Audit trail',
      subtitle: 'Append-only record of document, payment and configuration events.',
      body: table([
        { label: 'When', render: row => esc(row.created_at.slice(0, 19).replace('T', ' ')) },
        { label: 'Event', render: row => `<span class="font-mono text-xs">${esc(row.event)}</span>` },
        { label: 'Entity', render: row => esc(row.entity_type) },
        { label: 'Actor', render: row => esc(row.actor_name || row.actor_email || 'System') },
        { label: 'Detail', render: row => `<span class="text-xs text-on-surface-variant">${esc(JSON.stringify(row.metadata))}</span>` },
      ], data.events, 'No audit events.'),
    });
  }

  const exportActions = `
    <div class="flex items-center gap-2">
      ${button({ label: 'Export PDF', action: 'pdf', icon: 'picture_as_pdf', variant: 'primary' })}
      ${button({ label: 'Export CSV', action: 'csv', icon: 'download' })}
    </div>
  `;

  container.innerHTML = `
    ${pageHeader({
    title: 'Reports',
    subtitle: 'Business analytics, sales metrics, and financial records derived from stored documents.',
    actions: exportActions,
  })}
    <nav class="mb-4 flex flex-wrap gap-2">
      ${SECTIONS.map(item => `<button type="button" data-action="section" data-section="${item.key}"
        class="border px-3 py-1.5 text-xs transition-colors ${item.key === section
    ? 'border-primary bg-primary text-on-primary' : 'border-outline bg-surface text-on-surface-variant hover:bg-surface-dim'}">${esc(item.label)}</button>`).join('')}
    </nav>

    <form id="report-filters" class="mb-4 flex flex-wrap items-end gap-3 border border-outline bg-surface px-5 py-4">
      <div>
        <label class="label-technical mb-1.5 block">Preset Range</label>
        <select name="preset" id="filter-preset" class="field text-sm">
          <option value="">Custom / Select preset...</option>
          ${DATE_PRESETS.map(p => `<option value="${p.key}" ${preset === p.key ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
        </select>
      </div>

      <div>
        <label class="label-technical mb-1.5 block">From Date</label>
        <input type="date" name="from" id="filter-from" value="${esc(range.from)}" class="field">
      </div>

      <div>
        <label class="label-technical mb-1.5 block">To Date</label>
        <input type="date" name="to" id="filter-to" value="${esc(range.to)}" class="field">
      </div>

      ${section === 'products' ? `
        <div>
          <label class="label-technical mb-1.5 block">View Limit</label>
          <select name="limit" class="field text-sm">
            <option value="5" ${limit === '5' ? 'selected' : ''}>Top 5</option>
            <option value="10" ${limit === '10' ? 'selected' : ''}>Top 10</option>
            <option value="20" ${limit === '20' ? 'selected' : ''}>Top 20</option>
            <option value="all" ${limit === 'all' ? 'selected' : ''}>All products</option>
          </select>
        </div>
        <div class="flex items-center gap-2 pb-2">
          <label class="flex items-center gap-2 text-xs text-on-surface cursor-pointer">
            <input type="checkbox" name="zero_sales" value="true" ${zeroSales ? 'checked' : ''} class="rounded border-outline">
            Include zero-sales items
          </label>
        </div>
      ` : ''}

      <div class="flex gap-2 pb-0.5">
        ${button({ label: 'Apply', type: 'submit', variant: 'primary' })}
        ${button({ label: 'Reset', action: 'reset' })}
      </div>
      <p class="w-full text-xs text-on-surface-variant">Default preset: Current Indian Financial Year (April 1 – March 31).</p>
    </form>

    <div class="space-y-4">${body}</div>`;

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

  ctx.on('section', trigger => {
    ctx.setFilters({ ...ctx.filters, section: trigger.dataset.section });
    ctx.setPage(1);
    ctx.rerender();
  });

  ctx.on('reset', () => {
    ctx.setFilters({ section });
    ctx.setPage(1);
    ctx.rerender();
  });

  ctx.on('csv', async () => {
    try {
      let path = '';
      const q = query({ from: range.from, to: range.to, format: 'csv' });
      if (section === 'overview') path = `/api/reports/invoices${q}`;
      else if (section === 'invoices') path = `/api/reports/invoices${q}`;
      else if (section === 'collections') path = `/api/reports/collections${q}`;
      else if (section === 'receivables') path = `/api/reports/receivables${query({ format: 'csv' })}`;
      else if (section === 'quotations') path = `/api/reports/quotations${q}`;
      else if (section === 'clients') path = `/api/reports/revenue-by-client${q}`;
      else if (section === 'products') path = `/api/reports/revenue-by-product${query({ from: range.from, to: range.to, limit, zero_sales: zeroSales ? 'true' : 'false', format: 'csv' })}`;
      else if (section === 'tax') path = `/api/reports/tax-summary${q}`;
      else path = `/api/reports/invoices${q}`;

      await api.openDocument(path, { download: true });
      toast('CSV export started.');
    } catch (error) { toast(error.message, 'danger'); }
  });

  ctx.on('pdf', async () => {
    try {
      const q = query({
        section,
        from: range.from,
        to: range.to,
        preset,
        limit,
        zero_sales: zeroSales ? 'true' : 'false',
      });
      await api.openDocument(`/api/reports/export-pdf${q}`, { download: false });
      toast('Opening PDF report...');
    } catch (error) { toast(error.message, 'danger'); }
  });

  ctx.on('statement', async trigger => {
    const clientId = trigger.dataset.clientId;
    const clientName = trigger.dataset.clientName;
    try {
      const st = await api.get(`/api/reports/statement${query({ client_id: clientId, from: range.from, to: range.to })}`);
      modal({
        title: `Customer Statement — ${esc(clientName)}`,
        size: 'wide',
        body: `
          <div class="mb-4 grid grid-cols-2 gap-4 rounded border border-outline bg-surface-dim p-3 text-xs">
            <div>
              <p class="font-bold text-sm text-on-surface">${esc(st.client.name)}</p>
              ${st.client.company_name ? `<p class="text-on-surface-variant">${esc(st.client.company_name)}</p>` : ''}
              <p class="text-on-surface-variant">GSTIN: ${esc(st.client.gstin || 'Unregistered')}</p>
            </div>
            <div class="text-right">
              <p>Opening Balance: <strong>${money(st.opening_balance_minor)}</strong></p>
              <p>Period Invoiced: <strong>${money(st.total_debits_minor)}</strong></p>
              <p>Period Payments: <strong class="text-success">${money(st.total_credits_minor)}</strong></p>
              <p class="mt-1 border-t border-outline pt-1 text-sm font-bold">Closing Balance: ${money(st.closing_balance_minor)}</p>
            </div>
          </div>
          <div class="max-h-[400px] overflow-y-auto">
            ${table([
    { label: 'Date', render: r => date(r.trans_date) },
    { label: 'Type', render: r => `<span class="font-bold text-xs">${esc(r.trans_type)}</span>` },
    { label: 'Doc #', render: r => `<span class="font-mono text-xs">${esc(r.doc_number)}</span>` },
    { label: 'Notes', render: r => esc(r.notes || r.method || '—') },
    { label: 'Debit (Inv)', align: 'right', render: r => (r.debit_minor > 0 ? money(r.debit_minor) : '—') },
    { label: 'Credit (Paid)', align: 'right', render: r => (r.credit_minor > 0 ? `<span class="text-success font-semibold">${money(r.credit_minor)}</span>` : '—') },
    { label: 'Balance', align: 'right', render: r => `<strong>${money(r.balance_minor)}</strong>` },
  ], st.transactions, 'No transactions found for this customer in this date range.')}
          </div>
        `,
        footer: `
          ${button({ label: 'Export Statement PDF', action: 'export-statement-pdf', attributes: `data-client-id="${clientId}"`, icon: 'picture_as_pdf', variant: 'primary' })}
          ${button({ label: 'Export Statement CSV', action: 'export-statement-csv', attributes: `data-client-id="${clientId}"`, icon: 'download' })}
          ${button({ label: 'Close', action: 'close-modal' })}
        `,
      });
    } catch (err) {
      toast(err.message, 'danger');
    }
  });

  ctx.on('export-statement-pdf', async trigger => {
    const clientId = trigger.dataset.clientId;
    try {
      await api.openDocument(`/api/reports/statement${query({ client_id: clientId, from: range.from, to: range.to, format: 'pdf' })}`, { download: false });
      toast('Opening Statement PDF...');
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('export-statement-csv', async trigger => {
    const clientId = trigger.dataset.clientId;
    try {
      await api.openDocument(`/api/reports/statement${query({ client_id: clientId, from: range.from, to: range.to, format: 'csv' })}`, { download: true });
      toast('Statement CSV export started.');
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('close-modal', () => closeModal());

  container.querySelector('#report-filters').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.target);
    ctx.setFilters({
      ...ctx.filters,
      preset: String(form.get('preset') || ''),
      from: String(form.get('from') || ''),
      to: String(form.get('to') || ''),
      limit: String(form.get('limit') || '20'),
      zero_sales: form.get('zero_sales') === 'true' ? 'true' : 'false',
    });
    ctx.rerender();
  });
};
