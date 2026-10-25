import { api, query } from '../lib/api.js';
import {
  esc, money, date, percent, button, card, loading, pageHeader, alertBox, toast, titleCase, stat, badge, modal, closeModal,
} from '../lib/ui.js';
import { DATE_PRESETS, resolveDatePreset } from '../lib/date-presets.js';

const SECTIONS = [
  { key: 'overview', label: 'Business Overview' },
  { key: 'monthly_revenue', label: 'Monthly Revenue' },
  { key: 'clients', label: 'Client Register' },
  { key: 'invoices', label: 'Invoice Register' },
  { key: 'quotations', label: 'Quotation Register' },
  { key: 'products', label: 'Product Performance' },
  { key: 'influencers', label: 'Influencer Partners' },
  { key: 'influencer_sales', label: 'Influencer Sales Detail' },
  { key: 'collections', label: 'Collections & Receipts' },
  { key: 'receivables', label: 'Receivables & Ageing' },
  { key: 'tax', label: 'Tax Summary (GST)' },
  { key: 'imports', label: 'Import Batches' },
  { key: 'audit', label: 'Audit Trail' },
];

const table = (headers, rows, emptyMessage) => (rows && rows.length
  ? `<div class="overflow-x-auto"><table class="data-table w-full min-w-[760px]">
      <thead><tr>${headers.map(header => `<th class="${header.align === 'right' ? 'text-right' : header.align === 'center' ? 'text-center' : ''}">${esc(header.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(row => `<tr>${headers.map(header => `<td class="${header.align === 'right' ? 'num text-right' : header.align === 'center' ? 'text-center' : ''}">${header.render(row)}</td>`).join('')}</tr>`).join('')}</tbody>
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
  const clientId = ctx.filters.client_id || '';
  const productId = ctx.filters.product_id || '';
  const influencerId = ctx.filters.influencer_id || '';
  const invoiceStatus = ctx.filters.status || '';
  const limit = ctx.filters.limit || '20';
  const zeroSales = ctx.filters.zero_sales === 'true';

  container.innerHTML = pageHeader({ title: 'Reports' }) + loading();

  // Load supporting reference dropdowns in background
  let clientsList = [];
  let productsList = [];
  let influencersList = [];
  try {
    const [cRes, pRes, iRes] = await Promise.allSettled([
      api.get('/api/clients'),
      api.get('/api/products'),
      api.get('/api/marketing/influencers'),
    ]);
    clientsList = cRes.status === 'fulfilled' ? (cRes.value?.clients || cRes.value?.rows || cRes.value || []) : [];
    productsList = pRes.status === 'fulfilled' ? (pRes.value?.products || pRes.value?.rows || pRes.value || []) : [];
    influencersList = iRes.status === 'fulfilled' ? (iRes.value?.influencers || iRes.value?.rows || iRes.value || []) : [];
  } catch {
    // Non-fatal reference fetch
  }

  const baseParams = { ...range };
  if (preset) baseParams.preset = preset;
  if (clientId) baseParams.client_id = clientId;
  if (productId) baseParams.product_id = productId;
  if (influencerId) baseParams.influencer_id = influencerId;
  if (invoiceStatus) baseParams.status = invoiceStatus;
  if (section === 'products') {
    if (limit) baseParams.limit = limit;
    if (zeroSales) baseParams.zero_sales = 'true';
  }
  const base = query(baseParams);

  let data = null;
  try {
    if (section === 'overview') data = await api.get(`/api/reports/overview${base}`);
    else if (section === 'monthly_revenue') data = await api.get(`/api/reports/monthly-revenue${base}`);
    else if (section === 'clients') data = await api.get(`/api/reports/client-register${base}`);
    else if (section === 'invoices') data = await api.get(`/api/reports/invoices${base}`);
    else if (section === 'collections') data = await api.get(`/api/reports/collections${base}`);
    else if (section === 'receivables') data = await api.get('/api/reports/receivables');
    else if (section === 'quotations') data = await api.get(`/api/reports/quotations${base}`);
    else if (section === 'products') data = await api.get(`/api/reports/revenue-by-product${base}`);
    else if (section === 'influencers') data = await api.get(`/api/reports/influencer-register${base}`);
    else if (section === 'influencer_sales') data = await api.get(`/api/reports/influencer-sales${base}`);
    else if (section === 'imports') data = await api.get(`/api/reports/import-batches${base}`);
    else if (section === 'tax') data = await api.get(`/api/reports/tax-summary${base}`);
    else data = await api.get(`/api/audit${query({ page: ctx.page })}`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Reports' }) + alertBox(error.message, 'danger');
    return;
  }

  let body = '';

  if (section === 'overview') {
    const m = data.metrics || {};
    const activeClientsCount = typeof m.active_clients === 'number' ? m.active_clients : (m.active_clients?.current || 0);
    const winRate = m.quotations_issued?.current ? ((m.quotations_converted?.current / m.quotations_issued?.current) * 100).toFixed(1) : 0;

    body = `
      <!-- Group 1: Direct Sales & Cash Flow -->
      <div class="mb-2">
        <h3 class="label-technical text-xs font-semibold uppercase text-on-surface-variant">1. Direct Sales & Collections</h3>
      </div>
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
              <span class="label-technical">Net Invoiced Sales</span>
              ${trendBadge(m.net_invoiced)}
            </div>
            <p class="num mt-2 font-headline text-2xl font-bold">${money(m.net_invoiced?.current)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Net of refunds and cancellations</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <div class="flex items-center justify-between">
              <span class="label-technical">Collections Received</span>
              ${trendBadge(m.collected)}
            </div>
            <p class="num mt-2 font-headline text-2xl font-bold">${money(m.collected?.current)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Prior period: ${money(m.collected?.prior)} (${m.receipts_count?.current || 0} receipts)</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <div class="flex items-center justify-between">
              <span class="label-technical">Refunds Issued</span>
              ${m.refunds?.current > 0 ? badge('Deduction', 'danger') : badge('None', 'neutral')}
            </div>
            <p class="num mt-2 font-headline text-2xl font-bold">${money(m.refunds?.current)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Customer credit notes & refunds</p>
          </div>`,
  })}
      </div>

      <!-- Group 2: Receivables & Risk -->
      <div class="mb-2 mt-4">
        <h3 class="label-technical text-xs font-semibold uppercase text-on-surface-variant">2. Accounts Receivable & Risk</h3>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${card({
    body: `<div class="p-5">
            <div class="flex items-center justify-between">
              <span class="label-technical">Total Receivables</span>
              ${badge(`${m.receivables?.count || 0} unpaid`, 'neutral')}
            </div>
            <p class="num mt-2 font-headline text-2xl font-bold">${money(m.receivables?.total_minor)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Outstanding balance across all issued invoices</p>
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
        ${card({
    body: `<div class="p-5">
            <div class="flex items-center justify-between">
              <span class="label-technical">Cancelled / Void Invoices</span>
              ${m.cancelled_count > 0 ? badge(`${m.cancelled_count} void`, 'danger') : badge('0', 'neutral')}
            </div>
            <p class="num mt-2 font-headline text-2xl font-bold">${m.cancelled_count || 0}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Excluded from sales & revenue totals</p>
          </div>`,
  })}
      </div>

      <!-- Group 3: Tax Liabilities -->
      <div class="mb-2 mt-4">
        <h3 class="label-technical text-xs font-semibold uppercase text-on-surface-variant">3. GST Tax Liabilities</h3>
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
            <span class="label-technical">Intra-State GST (CGST + SGST)</span>
            <p class="num mt-2 font-headline text-xl font-bold">${money(Number(m.cgst?.current || 0) + Number(m.sgst?.current || 0))}</p>
            <p class="mt-1 text-xs text-on-surface-variant">CGST: ${money(m.cgst?.current)} | SGST: ${money(m.sgst?.current)}</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <span class="label-technical">Inter-State GST (IGST)</span>
            <p class="num mt-2 font-headline text-xl font-bold">${money(m.igst?.current)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Integrated GST on interstate supplies</p>
          </div>`,
  })}
      </div>

      <!-- Group 4: Operations & Pipeline -->
      <div class="mb-2 mt-4">
        <h3 class="label-technical text-xs font-semibold uppercase text-on-surface-variant">4. Commercial Pipeline & Operations</h3>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        ${card({
    body: `<div class="p-5">
            <div class="flex items-center justify-between">
              <span class="label-technical">Quotations Issued</span>
              ${badge(`${winRate}% won`, 'neutral')}
            </div>
            <p class="num mt-2 font-headline text-xl font-bold">${m.quotations_issued?.current || 0}</p>
            <p class="mt-1 text-xs text-on-surface-variant">${m.quotations_converted?.current || 0} successfully converted to invoices</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <span class="label-technical">Units / Volume Sold</span>
            <p class="num mt-2 font-headline text-xl font-bold">${(m.units_sold?.current || 0).toLocaleString('en-IN')}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Total product quantity on issued invoices</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <span class="label-technical">Active Clients Billed</span>
            <p class="num mt-2 font-headline text-xl font-bold">${activeClientsCount}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Customers with issued invoices in range</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <span class="label-technical">New Clients Registered</span>
            <p class="num mt-2 font-headline text-xl font-bold">${m.new_clients?.current || 0}</p>
            <p class="mt-1 text-xs text-on-surface-variant">New accounts created in this range</p>
          </div>`,
  })}
      </div>

      <!-- Group 5: Influencer Marketing & Operations -->
      <div class="mb-2 mt-4">
        <h3 class="label-technical text-xs font-semibold uppercase text-on-surface-variant">5. Influencer Marketing & Revenue Sharing</h3>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        ${card({
    body: `<div class="p-5">
            <div class="flex items-center justify-between">
              <span class="label-technical">Influencer Sales</span>
              ${trendBadge(m.influencer_attributed_sales)}
            </div>
            <p class="num mt-2 font-headline text-xl font-bold">${money(m.influencer_attributed_sales?.current)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Attributed partner sales</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <span class="label-technical">Commission Earned</span>
            <p class="num mt-2 font-headline text-xl font-bold">${money(m.influencer_commission_earned?.current)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Earned on verified orders</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <span class="label-technical">Commission Paid</span>
            <p class="num mt-2 font-headline text-xl font-bold text-success">${money(m.influencer_commission_paid?.current)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Disbursed to partners</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-5">
            <div class="flex items-center justify-between">
              <span class="label-technical">Commission Due</span>
              ${m.influencer_commission_payable?.current > 0 ? badge('Payable', 'danger') : badge('Settled', 'success')}
            </div>
            <p class="num mt-2 font-headline text-xl font-bold ${m.influencer_commission_payable?.current > 0 ? 'text-danger' : ''}">${money(m.influencer_commission_payable?.current)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Pending payout reconciliation</p>
          </div>`,
  })}
      </div>

      <!-- Top Products and Top Clients -->
      <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
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
  } else if (section === 'monthly_revenue') {
    const tot = data.totals || {};
    body = `
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        ${card({
    body: `<div class="p-4">
            <span class="label-technical">Total Invoiced Sales</span>
            <p class="num mt-1 font-headline text-xl font-bold">${money(tot.net_invoiced_minor)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">${tot.invoices_count || 0} direct invoices</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-4">
            <span class="label-technical">Collections Received</span>
            <p class="num mt-1 font-headline text-xl font-bold">${money(tot.collected_minor)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Net: ${money(tot.net_collected_minor)}</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-4">
            <span class="label-technical">Receivables Balance</span>
            <p class="num mt-1 font-headline text-xl font-bold ${tot.receivables_minor > 0 ? 'text-danger' : ''}">${money(tot.receivables_minor)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Outstanding on invoices</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-4">
            <span class="label-technical">Influencer Sales</span>
            <p class="num mt-1 font-headline text-xl font-bold">${money(tot.influencer_sales_minor)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Partner attributed sales</p>
          </div>`,
  })}
        ${card({
    body: `<div class="p-4">
            <span class="label-technical">Commission Due</span>
            <p class="num mt-1 font-headline text-xl font-bold ${tot.influencer_commission_payable_minor > 0 ? 'text-danger' : ''}">${money(tot.influencer_commission_payable_minor)}</p>
            <p class="mt-1 text-xs text-on-surface-variant">Earned: ${money(tot.influencer_commission_earned_minor)}</p>
          </div>`,
  })}
      </div>

      ${card({
    title: 'Monthly Company Financial Breakdown',
    subtitle: 'Month-by-month financial reconciliation between direct invoiced sales, collections, and influencer sales.',
    body: table([
      { label: 'Month', render: r => `<strong>${esc(r.month_label)}</strong>` },
      { label: 'Invs', align: 'right', render: r => String(r.invoices_count || 0) },
      { label: 'Invoiced', align: 'right', render: r => `<strong>${money(r.net_invoiced_minor)}</strong>` },
      { label: 'Collections', align: 'right', render: r => money(r.collected_minor) },
      { label: 'Refunds', align: 'right', render: r => (r.refunds_minor > 0 ? `<span class="text-danger">${money(r.refunds_minor)}</span>` : '—') },
      { label: 'Net Coll', align: 'right', render: r => money(r.net_collected_minor) },
      { label: 'Receivables', align: 'right', render: r => `<span class="${r.receivables_minor > 0 ? 'text-danger font-semibold' : ''}">${money(r.receivables_minor)}</span>` },
      { label: 'Influencer Sales', align: 'right', render: r => money(r.influencer_sales_minor) },
      { label: 'Comm Earned', align: 'right', render: r => money(r.influencer_commission_earned_minor) },
      { label: 'Comm Due', align: 'right', render: r => `<span class="${r.influencer_commission_payable_minor > 0 ? 'text-danger' : ''}">${money(r.influencer_commission_payable_minor)}</span>` },
      { label: 'MoM %', align: 'right', render: r => (r.growth_pct !== null && r.growth_pct !== undefined ? badge(`${r.growth_pct > 0 ? '+' : ''}${r.growth_pct}%`, r.growth_pct >= 0 ? 'success' : 'danger') : '—') },
    ], data.rows || [], 'No monthly transaction activity found for the selected date range.'),
  })}
    `;
  } else if (section === 'clients') {
    body = card({
      title: 'Customer-Wise Revenue & Receivables',
      subtitle: 'Sales totals, cash receipts, outstanding balances, and statement drilldown for each client.',
      body: table([
        { label: 'Client', render: row => `<strong>${esc(row.client_name || row.name)}</strong>` },
        { label: 'Company', render: row => esc(row.company_name || '—') },
        { label: 'GSTIN', render: row => `<span class="font-mono text-xs">${esc(row.gstin || '—')}</span>` },
        { label: 'Quotes', align: 'right', render: row => String(row.quotation_count || 0) },
        { label: 'Invoices', align: 'right', render: row => String(row.invoice_count || 0) },
        { label: 'Invoiced', align: 'right', render: row => `<strong>${money(row.invoiced_minor || row.gross_invoiced_minor || 0)}</strong>` },
        { label: 'Collected', align: 'right', render: row => money(row.collected_minor || 0) },
        { label: 'Balance', align: 'right', render: row => money(row.balance_minor || 0) },
        { label: 'Overdue', align: 'right', render: row => `<span class="${row.overdue_minor > 0 ? 'text-danger font-bold' : ''}">${money(row.overdue_minor || 0)}</span>` },
        { label: 'Action', align: 'center', render: row => `<button type="button" data-action="statement" data-client-id="${esc(row.id)}" data-client-name="${esc(row.client_name || row.name)}" class="text-xs font-semibold text-primary hover:underline">Statement</button>` },
      ], data.rows || [], 'No client activity in this range.'),
    });
  } else if (section === 'invoices') {
    body = card({
      title: 'Invoices Issued',
      subtitle: 'Complete invoice register with taxable value, GST classification, payment status, and balance due.',
      body: table([
        { label: 'Invoice #', render: row => `<span class="font-mono text-xs font-bold">${esc(row.invoice_number || 'Draft')}</span>` },
        { label: 'Issued', render: row => date(row.issue_date) },
        { label: 'Due Date', render: row => date(row.due_date) },
        { label: 'Client', render: row => esc(row.client_name) },
        { label: 'Status', render: row => badge(titleCase(row.status), row.status === 'ISSUED' ? 'accent' : row.status === 'CANCELLED' ? 'danger' : 'neutral') },
        { label: 'Payment', render: row => badge(titleCase(row.payment_status), row.payment_status === 'PAID' ? 'success' : row.payment_status === 'OVERDUE' ? 'danger' : 'neutral') },
        { label: 'Taxable', align: 'right', render: row => money(row.taxable_minor) },
        { label: 'GST', align: 'right', render: row => money(Number(row.cgst_minor || 0) + Number(row.sgst_minor || 0) + Number(row.igst_minor || 0)) },
        { label: 'Invoice Total', align: 'right', render: row => `<strong>${money(row.grand_total_minor)}</strong>` },
        { label: 'Collected', align: 'right', render: row => money(row.paid_minor) },
        { label: 'Balance', align: 'right', render: row => `<strong class="${row.balance_due_minor > 0 ? 'text-danger' : ''}">${money(row.balance_due_minor)}</strong>` },
      ], data.rows || [], 'No invoices issued in this range.'),
    });
  } else if (section === 'quotations') {
    body = `
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
        ${card({ body: `<div class="p-4"><span class="label-technical">Total Quotations</span><p class="num mt-1 font-headline text-2xl font-bold">${data.rows?.length || 0}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Accepted</span><p class="num mt-1 font-headline text-2xl font-bold text-success">${data.accepted || 0}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Converted to Invoices</span><p class="num mt-1 font-headline text-2xl font-bold text-primary">${data.converted || 0}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Acceptance Rate</span><p class="num mt-1 font-headline text-2xl font-bold">${((data.conversion_rate_bp || 0) / 100).toFixed(1)}%</p></div>` })}
      </div>

      ${card({
    title: 'Quotation Register',
    subtitle: 'Estimates issued, client response, and invoice conversions.',
    body: table([
      { label: 'Quote #', render: row => `<span class="font-mono text-xs font-bold">${esc(row.quotation_number || 'Draft')}</span>` },
      { label: 'Client', render: row => esc(row.client_name) },
      { label: 'Title / Subject', render: row => esc(row.title) },
      { label: 'Issued', render: row => date(row.issue_date) },
      { label: 'Status', render: row => badge(titleCase(row.effective_status), row.effective_status === 'ACCEPTED' ? 'success' : row.effective_status === 'REJECTED' ? 'danger' : 'neutral') },
      { label: 'Converted', align: 'center', render: row => (row.converted ? badge('Yes', 'success') : badge('No', 'neutral')) },
      { label: 'Quoted Total', align: 'right', render: row => `<strong>${money(row.grand_total_minor)}</strong>` },
    ], data.rows || [], 'No quotations issued in this range.'),
  })}
    `;
  } else if (section === 'products') {
    body = `
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        ${card({ body: `<div class="p-4"><span class="label-technical">Active Products Sold</span><p class="num mt-1 font-headline text-2xl font-bold">${data.rows?.length || 0}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Taxable Turnover</span><p class="num mt-1 font-headline text-2xl font-bold">${money(data.taxable_minor)}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Total Invoiced Sales</span><p class="num mt-1 font-headline text-2xl font-bold">${money(data.total_minor)}</p></div>` })}
      </div>

      ${card({
    title: 'Revenue by Product or Service',
    subtitle: `Showing ${data.rows?.length || 0} items. Total turnover: ${money(data.total_minor)}.`,
    body: table([
      { label: 'Item Name', render: row => `<strong>${esc(row.description)}</strong>` },
      { label: 'SKU', render: row => `<span class="font-mono text-xs">${esc(row.sku || '—')}</span>` },
      { label: 'Category', render: row => esc(row.category || '—') },
      { label: 'Quantity', align: 'right', render: row => (row.quantity_milli / 1000).toLocaleString('en-IN') },
      { label: 'Unit', render: row => esc(row.unit || 'NOS') },
      { label: 'Invoices', align: 'right', render: row => String(row.invoices) },
      { label: 'Avg Price', align: 'right', render: row => money(row.average_price_minor) },
      { label: 'Taxable', align: 'right', render: row => money(row.taxable_minor) },
      { label: 'GST', align: 'right', render: row => money(row.tax_minor) },
      { label: 'Total', align: 'right', render: row => `<strong>${money(row.total_minor)}</strong>` },
      { label: 'Share', align: 'right', render: row => badge(esc(row.contribution_pct), 'neutral') },
    ], data.rows || [], 'No issued invoice lines in this range.'),
  })}

      ${data.zero_sales_rows?.length ? card({
    title: `Zero-Sales Catalog Items (${data.zero_sales_rows.length})`,
    subtitle: 'Active products in the catalog with no recorded sales during this period.',
    body: table([
      { label: 'Product Name', render: row => `<strong>${esc(row.description)}</strong>` },
      { label: 'SKU', render: row => `<span class="font-mono text-xs">${esc(row.sku || '—')}</span>` },
      { label: 'Category', render: row => esc(row.category || '—') },
      { label: 'Unit', render: row => esc(row.unit || 'NOS') },
      { label: 'Catalog Price', align: 'right', render: row => money(row.unit_price_minor) },
    ], data.zero_sales_rows, 'No inactive products.'),
  }) : ''}
    `;
  } else if (section === 'influencers') {
    const tot = data.totals || {};
    body = `
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        ${card({ body: `<div class="p-4"><span class="label-technical">Active Partners</span><p class="num mt-1 font-headline text-2xl font-bold">${data.rows?.length || 0}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Attributed Sales</span><p class="num mt-1 font-headline text-2xl font-bold">${money(tot.attributed_sales_minor)}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Commission Earned</span><p class="num mt-1 font-headline text-2xl font-bold">${money(tot.commission_earned_minor)}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Commission Paid</span><p class="num mt-1 font-headline text-2xl font-bold text-success">${money(tot.commission_paid_minor)}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Commission Payable</span><p class="num mt-1 font-headline text-2xl font-bold ${tot.commission_payable_minor > 0 ? 'text-danger' : ''}">${money(tot.commission_payable_minor)}</p></div>` })}
      </div>

      ${card({
    title: 'Influencer Marketing Partners Register',
    subtitle: 'Commercial terms, attributed sales turnover, and commission reconciliation per partner.',
    body: table([
      { label: 'Partner Name', render: r => `<strong>${esc(r.display_name || r.legal_name || '—')}</strong>` },
      { label: 'Handle / Code', render: r => `<span class="font-mono text-xs">${esc(r.handle || '—')}</span>` },
      { label: 'Contract #', render: r => `<span class="font-mono text-xs">${esc(r.contract_number || '—')}</span>` },
      { label: 'Rate %', align: 'right', render: r => `${((r.commission_rate_bp || 0) / 100).toFixed(1)}%` },
      { label: 'Orders', align: 'right', render: r => String(r.sales_count || 0) },
      { label: 'Gross Sales', align: 'right', render: r => `<strong>${money(r.attributed_sales_minor)}</strong>` },
      { label: 'Eligible Rev', align: 'right', render: r => money(r.eligible_revenue_minor) },
      { label: 'Comm Earned', align: 'right', render: r => money(r.commission_earned_minor) },
      { label: 'Comm Paid', align: 'right', render: r => `<span class="text-success">${money(r.commission_paid_minor)}</span>` },
      { label: 'Comm Payable', align: 'right', render: r => `<strong class="${r.commission_payable_minor > 0 ? 'text-danger' : ''}">${money(r.commission_payable_minor)}</strong>` },
    ], data.rows || [], 'No influencer partners registered or attributed in this range.'),
  })}
    `;
  } else if (section === 'influencer_sales') {
    const tot = data.totals || {};
    body = `
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
        ${card({ body: `<div class="p-4"><span class="label-technical">Attributed Orders</span><p class="num mt-1 font-headline text-2xl font-bold">${data.rows?.length || 0}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Gross Sales Value</span><p class="num mt-1 font-headline text-2xl font-bold">${money(tot.sale_amount_minor)}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Eligible Net Revenue</span><p class="num mt-1 font-headline text-2xl font-bold">${money(tot.eligible_revenue_minor)}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Total Commission</span><p class="num mt-1 font-headline text-2xl font-bold">${money(tot.commission_minor)}</p></div>` })}
      </div>

      ${card({
    title: 'Individual Influencer Sales Attribution Detail',
    subtitle: 'Itemized sales transactions linked to marketing partners with calculated commission and payout status.',
    body: table([
      { label: 'Date', render: r => date(r.sale_date) },
      { label: 'Customer', render: r => esc(r.customer_name || 'POS Customer') },
      { label: 'Product', render: r => esc(r.product_name || 'Item') },
      { label: 'Partner', render: r => `<strong>${esc(r.influencer_name || '—')}</strong>` },
      { label: 'Sale Amount', align: 'right', render: r => `<strong>${money(r.sale_amount_minor)}</strong>` },
      { label: 'Eligible Rev', align: 'right', render: r => money(r.eligible_revenue_minor) },
      { label: 'Rate %', align: 'right', render: r => `${((r.commission_rate_bp || 0) / 100).toFixed(1)}%` },
      { label: 'Commission', align: 'right', render: r => `<strong>${money(r.commission_minor)}</strong>` },
      { label: 'Status', align: 'center', render: r => badge(titleCase(r.payment_status || 'PENDING'), r.payment_status === 'PAID' ? 'success' : r.payment_status === 'VERIFIED' ? 'accent' : 'neutral') },
    ], data.rows || [], 'No attributed sales records found for this period.'),
  })}
    `;
  } else if (section === 'collections') {
    body = `
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        ${card({ body: `<div class="p-4"><span class="label-technical">Total Receipts</span><p class="num mt-1 font-headline text-2xl font-bold">${data.rows?.length || 0}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Total Money Collected</span><p class="num mt-1 font-headline text-2xl font-bold text-success">${money(data.collected_minor)}</p></div>` })}
      </div>

      ${card({
    title: 'Collections & Cash Receipts',
    subtitle: 'Recorded payments received against issued invoices.',
    body: table([
      { label: 'Receipt #', render: row => `<span class="font-mono text-xs font-bold">${esc(row.receipt_number)}</span>` },
      { label: 'Paid On', render: row => date(row.paid_on) },
      { label: 'Client', render: row => esc(row.client_name) },
      { label: 'Invoice #', render: row => `<span class="font-mono text-xs">${esc(row.invoice_number || '—')}</span>` },
      { label: 'Payment Method', render: row => esc(titleCase(row.method)) },
      { label: 'Reference / UTR', render: row => esc(row.reference || '—') },
      { label: 'Amount Paid', align: 'right', render: row => `<strong>${money(row.amount_minor)}</strong>` },
    ], data.rows || [], 'No payments recorded in this range.'),
  })}
    `;
  } else if (section === 'receivables') {
    body = `
      ${card({
    title: 'Ageing Schedule',
    body: `<div class="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-5">
        ${Object.entries(data.buckets || {}).map(([b, val]) => `<div>
          <p class="label-technical">${esc(b === 'NOT_DUE' ? 'Not due' : `${b} days`)}</p>
          <p class="num mt-1 font-headline text-lg font-bold ${b !== 'NOT_DUE' && val > 0 ? 'text-danger' : ''}">${money(val)}</p></div>`).join('')}
      </div>`,
  })}

      ${card({
    title: 'Outstanding Accounts Receivable',
    subtitle: `Total outstanding receivables: ${money(data.total_minor)} across ${data.rows?.length || 0} unpaid documents.`,
    body: table([
      { label: 'Invoice #', render: row => `<span class="font-mono text-xs font-bold">${esc(row.invoice_number)}</span>` },
      { label: 'Client', render: row => esc(row.client_name) },
      { label: 'Issued', render: row => date(row.issue_date) },
      { label: 'Due Date', render: row => date(row.due_date) },
      { label: 'Days Overdue', align: 'right', render: row => `<span class="${row.days_overdue > 0 ? 'text-danger font-semibold' : ''}">${row.days_overdue} d</span>` },
      { label: 'Bucket', render: row => esc(row.ageing === 'NOT_DUE' ? 'Not due' : row.ageing) },
      { label: 'Total Invoiced', align: 'right', render: row => money(row.grand_total_minor) },
      { label: 'Collected', align: 'right', render: row => money(row.paid_minor) },
      { label: 'Balance Due', align: 'right', render: row => `<strong class="text-danger">${money(row.balance_due_minor)}</strong>` },
    ], data.rows || [], 'Nothing outstanding. Every issued invoice is fully settled.'),
  })}
    `;
  } else if (section === 'tax') {
    body = `
      ${card({
    title: 'GST Tax Summary & Net Liability',
    subtitle: 'Output GST liability net of credit notes. Computed from actual stored transactions.',
    body: `<div class="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
          ${stat({ label: 'Taxable value', value: money(data.net?.taxable_minor) })}
          ${stat({ label: 'Total Output GST', value: money(data.net?.tax_minor) })}
          ${stat({ label: 'Non-taxable value', value: money(data.exempt_taxable_minor), hint: 'Exempt or zero-rated supply' })}
        </div>
        <div class="grid grid-cols-1 gap-4 border-t border-outline px-5 py-4 sm:grid-cols-3">
          ${stat({ label: 'Central GST (CGST)', value: money(data.net?.cgst_minor) })}
          ${stat({ label: 'State GST (SGST)', value: money(data.net?.sgst_minor) })}
          ${stat({ label: 'Integrated GST (IGST)', value: money(data.net?.igst_minor) })}
        </div>`,
  })}

      ${card({
    title: 'By HSN / SAC and Tax Slab',
    body: table([
      { label: 'HSN / SAC', render: row => `<strong>${esc(row.hsn_sac || '—')}</strong>` },
      { label: 'Rate %', align: 'right', render: row => esc(percent(row.tax_rate_bp)) },
      { label: 'Taxable Value', align: 'right', render: row => money(row.taxable_minor) },
      { label: 'CGST', align: 'right', render: row => money(row.cgst_minor) },
      { label: 'SGST', align: 'right', render: row => money(row.sgst_minor) },
      { label: 'IGST', align: 'right', render: row => money(row.igst_minor) },
      { label: 'Total GST', align: 'right', render: row => `<strong>${money(row.tax_minor)}</strong>` },
    ], data.output_rows || [], 'No taxable supply in this range.'),
  })}
    `;
  } else if (section === 'imports') {
    const tot = data.totals || {};
    body = `
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
        ${card({ body: `<div class="p-4"><span class="label-technical">Total Batches</span><p class="num mt-1 font-headline text-2xl font-bold">${data.rows?.length || 0}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Valid Records</span><p class="num mt-1 font-headline text-2xl font-bold text-success">${tot.valid_count || 0}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Attributed Turnover</span><p class="num mt-1 font-headline text-2xl font-bold">${money(tot.total_sales_minor)}</p></div>` })}
        ${card({ body: `<div class="p-4"><span class="label-technical">Total Commission</span><p class="num mt-1 font-headline text-2xl font-bold">${money(tot.total_commission_minor)}</p></div>` })}
      </div>

      ${card({
    title: 'Sales Excel Import Batches',
    subtitle: 'History of external sales spreadsheets imported into the system with audit totals.',
    body: table([
      { label: 'Batch ID', render: r => `<span class="font-mono text-xs font-bold">${esc(r.id?.slice(0, 8) || '—')}</span>` },
      { label: 'Imported At', render: r => date(r.imported_at) },
      { label: 'Source File', render: r => esc(r.filename || '—') },
      { label: 'Total Rows', align: 'right', render: r => String(r.row_count || 0) },
      { label: 'Valid Sales', align: 'right', render: r => `<span class="text-success font-semibold">${r.valid_count || 0}</span>` },
      { label: 'Attributed Sales', align: 'right', render: r => `<strong>${money(r.total_sales_minor)}</strong>` },
      { label: 'Commission', align: 'right', render: r => money(r.total_commission_minor) },
      { label: 'Status', align: 'center', render: r => badge(titleCase(r.status || 'COMPLETED'), 'success') },
    ], data.rows || [], 'No sales spreadsheets have been imported yet.'),
  })}
    `;
  } else {
    body = card({
      title: 'Audit Trail',
      subtitle: 'Immutable record of document creation, payments, and system events.',
      body: table([
        { label: 'When', render: row => esc(row.created_at.slice(0, 19).replace('T', ' ')) },
        { label: 'Event', render: row => `<span class="font-mono text-xs font-bold">${esc(row.event)}</span>` },
        { label: 'Entity', render: row => esc(row.entity_type) },
        { label: 'Actor', render: row => esc(row.actor_name || row.actor_email || 'System') },
        { label: 'Detail', render: row => `<span class="text-xs text-on-surface-variant">${esc(JSON.stringify(row.metadata))}</span>` },
      ], data.events || [], 'No audit events found.'),
    });
  }

  const exportActions = `
    <div class="flex items-center gap-2">
      ${button({ label: 'Export PDF', action: 'pdf', icon: 'picture_as_pdf', variant: 'primary' })}
      ${button({ label: 'Export Excel', action: 'excel', icon: 'download', variant: 'secondary' })}
      ${button({ label: 'Export CSV', action: 'csv', icon: 'download' })}
    </div>
  `;

  container.innerHTML = `
    ${pageHeader({
    title: 'Reports & Business Intelligence',
    subtitle: 'Comprehensive financial statements, sales analytics, and partner attribution derived from actual stored documents.',
    actions: exportActions,
  })}
    <nav class="mb-4 flex flex-wrap gap-2">
      ${SECTIONS.map(item => `<button type="button" data-action="section" data-section="${item.key}"
        class="border px-3 py-1.5 text-xs font-medium transition-colors ${item.key === section
    ? 'border-primary bg-primary text-on-primary' : 'border-outline bg-surface text-on-surface-variant hover:bg-surface-dim'}">${esc(item.label)}</button>`).join('')}
    </nav>

    <form id="report-filters" class="mb-5 flex flex-wrap items-end gap-3 border border-outline bg-surface px-5 py-4 shadow-sm">
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

      ${clientsList.length ? `
        <div>
          <label class="label-technical mb-1.5 block">Client</label>
          <select name="client_id" class="field text-sm">
            <option value="">All Clients</option>
            ${clientsList.map(c => `<option value="${c.id}" ${clientId === c.id ? 'selected' : ''}>${esc(c.name || c.company_name)}</option>`).join('')}
          </select>
        </div>
      ` : ''}

      ${productsList.length ? `
        <div>
          <label class="label-technical mb-1.5 block">Product</label>
          <select name="product_id" class="field text-sm">
            <option value="">All Products</option>
            ${productsList.map(p => `<option value="${p.id}" ${productId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </div>
      ` : ''}

      ${influencersList.length ? `
        <div>
          <label class="label-technical mb-1.5 block">Partner</label>
          <select name="influencer_id" class="field text-sm">
            <option value="">All Partners</option>
            ${influencersList.map(inf => `<option value="${inf.id}" ${influencerId === inf.id ? 'selected' : ''}>${esc(inf.display_name || inf.legal_name)}</option>`).join('')}
          </select>
        </div>
      ` : ''}

      ${section === 'invoices' ? `
        <div>
          <label class="label-technical mb-1.5 block">Status</label>
          <select name="status" class="field text-sm">
            <option value="">All Statuses</option>
            <option value="ISSUED" ${invoiceStatus === 'ISSUED' ? 'selected' : ''}>Issued</option>
            <option value="PAID" ${invoiceStatus === 'PAID' ? 'selected' : ''}>Paid</option>
            <option value="PARTIALLY_PAID" ${invoiceStatus === 'PARTIALLY_PAID' ? 'selected' : ''}>Partially Paid</option>
            <option value="OVERDUE" ${invoiceStatus === 'OVERDUE' ? 'selected' : ''}>Overdue</option>
            <option value="CANCELLED" ${invoiceStatus === 'CANCELLED' ? 'selected' : ''}>Cancelled</option>
          </select>
        </div>
      ` : ''}

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
      <p class="w-full text-xs text-on-surface-variant">Default preset: Current Indian Financial Year (April 1 – March 31). Filter parameters reconcile across all exported tables.</p>
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

  // Export handlers
  const buildExportParams = format => query({
    from: range.from,
    to: range.to,
    preset,
    client_id: clientId,
    product_id: productId,
    influencer_id: influencerId,
    status: invoiceStatus,
    limit,
    zero_sales: zeroSales ? 'true' : 'false',
    format,
  });

  ctx.on('pdf', async () => {
    try {
      const q = query({
        section,
        from: range.from,
        to: range.to,
        preset,
        client_id: clientId,
        product_id: productId,
        influencer_id: influencerId,
        status: invoiceStatus,
        limit,
        zero_sales: zeroSales ? 'true' : 'false',
      });
      await api.openDocument(`/api/reports/export-pdf${q}`, { download: false });
      toast('Opening PDF report...');
    } catch (error) { toast(error.message, 'danger'); }
  });

  ctx.on('excel', async () => {
    try {
      const q = query({
        section,
        from: range.from,
        to: range.to,
        preset,
        client_id: clientId,
        product_id: productId,
        influencer_id: influencerId,
        status: invoiceStatus,
        limit,
        zero_sales: zeroSales ? 'true' : 'false',
      });
      await api.openDocument(`/api/reports/export-excel${q}`, { download: true });
      toast('Excel (.xlsx) export started.');
    } catch (error) { toast(error.message, 'danger'); }
  });

  ctx.on('csv', async () => {
    try {
      let path = '';
      const q = buildExportParams('csv');
      if (section === 'overview') path = `/api/reports/invoices${q}`;
      else if (section === 'monthly_revenue') path = `/api/reports/monthly-revenue${q}`;
      else if (section === 'clients') path = `/api/reports/client-register${q}`;
      else if (section === 'invoices') path = `/api/reports/invoices${q}`;
      else if (section === 'collections') path = `/api/reports/collections${q}`;
      else if (section === 'receivables') path = `/api/reports/receivables${query({ format: 'csv' })}`;
      else if (section === 'quotations') path = `/api/reports/quotations${q}`;
      else if (section === 'products') path = `/api/reports/revenue-by-product${q}`;
      else if (section === 'influencers') path = `/api/reports/influencer-register${q}`;
      else if (section === 'influencer_sales') path = `/api/reports/influencer-sales${q}`;
      else if (section === 'imports') path = `/api/reports/import-batches${q}`;
      else if (section === 'tax') path = `/api/reports/tax-summary${q}`;
      else path = `/api/reports/invoices${q}`;

      await api.openDocument(path, { download: true });
      toast('CSV export started.');
    } catch (error) { toast(error.message, 'danger'); }
  });

  ctx.on('statement', async trigger => {
    const targetClientId = trigger.dataset.clientId;
    const clientName = trigger.dataset.clientName;
    try {
      const st = await api.get(`/api/reports/statement${query({ client_id: targetClientId, from: range.from, to: range.to })}`);
      modal({
        title: `Customer Statement — ${esc(clientName)}`,
        size: 'wide',
        body: `
          <div class="mb-4 grid grid-cols-2 gap-4 rounded border border-outline bg-surface-dim p-3 text-xs">
            <div>
              <p class="font-bold text-sm text-on-surface">${esc(st.client?.name || '')}</p>
              ${st.client?.company_name ? `<p class="text-on-surface-variant">${esc(st.client.company_name)}</p>` : ''}
              <p class="text-on-surface-variant">GSTIN: ${esc(st.client?.gstin || 'Unregistered')}</p>
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
  ], st.transactions || [], 'No transactions found for this customer in this date range.')}
          </div>
        `,
        footer: `
          ${button({ label: 'Export Statement PDF', action: 'export-statement-pdf', attributes: `data-client-id="${targetClientId}"`, icon: 'picture_as_pdf', variant: 'primary' })}
          ${button({ label: 'Export Statement CSV', action: 'export-statement-csv', attributes: `data-client-id="${targetClientId}"`, icon: 'download' })}
          ${button({ label: 'Close', action: 'close-modal' })}
        `,
      });
    } catch (err) {
      toast(err.message, 'danger');
    }
  });

  ctx.on('export-statement-pdf', async trigger => {
    const targetClientId = trigger.dataset.clientId;
    try {
      await api.openDocument(`/api/reports/statement${query({ client_id: targetClientId, from: range.from, to: range.to, format: 'pdf' })}`, { download: false });
      toast('Opening Statement PDF...');
    } catch (err) { toast(err.message, 'danger'); }
  });

  ctx.on('export-statement-csv', async trigger => {
    const targetClientId = trigger.dataset.clientId;
    try {
      await api.openDocument(`/api/reports/statement${query({ client_id: targetClientId, from: range.from, to: range.to, format: 'csv' })}`, { download: true });
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
      client_id: String(form.get('client_id') || ''),
      product_id: String(form.get('product_id') || ''),
      influencer_id: String(form.get('influencer_id') || ''),
      status: String(form.get('status') || ''),
      limit: String(form.get('limit') || '20'),
      zero_sales: form.get('zero_sales') === 'true' ? 'true' : 'false',
    });
    ctx.rerender();
  });
};
