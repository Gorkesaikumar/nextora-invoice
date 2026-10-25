import { api, query } from '../lib/api.js';
import {
  esc, money, date, badge, statusBadge, button, card, stat, emptyState, loading, pageHeader,
  pagination, field, alertBox,
} from '../lib/ui.js';

export const render = async (container, params, ctx) => {
  const filters = ctx.filters || {};
  container.innerHTML = `${pageHeader({ title: 'Dashboard', subtitle: 'Financial position from recorded documents only. Invoiced value and collected money are always shown separately.' })}
    ${loading()}`;

  let data;
  try {
    data = await api.get(`/api/dashboard${query({ from: filters.from, to: filters.to })}`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Dashboard' }) + alertBox(error.message, 'danger');
    return;
  }

  const rangeLabel = filters.from || filters.to
    ? `${filters.from || 'earliest'} → ${filters.to || 'today'}`
    : 'current financial year to today';

  const quotationRows = data.recent_quotations.length ? `
    <div class="overflow-x-auto">
      <table class="data-table w-full min-w-[720px]">
        <thead><tr>
          <th>Number</th><th>Client</th><th>Title</th><th>Issued</th><th>Valid until</th>
          <th class="text-right">Value</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>
          ${data.recent_quotations.map(row => `<tr>
            <td class="font-mono text-xs">${esc(row.quotation_number || 'Draft')}</td>
            <td>${esc(row.client_name)}</td>
            <td class="max-w-[220px] truncate">${esc(row.title)}</td>
            <td class="whitespace-nowrap">${date(row.issue_date)}</td>
            <td class="whitespace-nowrap">${row.expiry_date ? date(row.expiry_date) : '—'}</td>
            <td class="num text-right">${money(row.totals.grand_total_minor)}</td>
            <td>${statusBadge(row.effective_status)}${row.converted_invoice_id ? ' ' + badge('Converted', 'success') : ''}</td>
            <td class="text-right"><a class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent" href="#/quotations/${esc(row.id)}">Open</a></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState({
    icon: 'request_quote', title: 'No quotations yet',
    message: 'Create a quotation to send a priced offer to a client.',
    actionLabel: 'New quotation', action: 'new-quotation',
  });

  const invoiceRows = data.recent_invoices.length ? `
    <div class="overflow-x-auto">
      <table class="data-table w-full min-w-[720px]">
        <thead><tr>
          <th>Number</th><th>Client</th><th>Issued</th><th>Due</th>
          <th class="text-right">Total</th><th class="text-right">Balance</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>
          ${data.recent_invoices.map(row => `<tr>
            <td class="font-mono text-xs">${esc(row.invoice_number || 'Draft')}</td>
            <td>${esc(row.client_name)}</td>
            <td class="whitespace-nowrap">${date(row.issue_date)}</td>
            <td class="whitespace-nowrap">${row.due_date ? date(row.due_date) : '—'}</td>
            <td class="num text-right">${money(row.totals.grand_total_minor)}</td>
            <td class="num text-right">${money(row.balance_due_minor)}</td>
            <td>${statusBadge(row.status === 'ISSUED' && row.balance_due_minor <= 0 ? 'PAID' : row.status)}</td>
            <td class="text-right"><a class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent" href="#/invoices/${esc(row.id)}">Open</a></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState({
    icon: 'receipt_long', title: 'No invoices yet',
    message: 'Issue an invoice, or convert an accepted quotation into one.',
    actionLabel: 'New invoice', action: 'new-invoice',
  });

  container.innerHTML = `
    ${pageHeader({
      title: 'Dashboard',
      subtitle: `Totals for ${rangeLabel}. A quotation is not revenue and an issued invoice is not money received.`,
      actions: `${button({ label: 'New quotation', action: 'new-quotation' })}${button({ label: 'New invoice', action: 'new-invoice', variant: 'primary', icon: 'add' })}`,
    })}

    <form id="range-form" class="mb-6 flex flex-wrap items-end gap-3 border border-outline bg-surface px-5 py-4">
      ${field({ label: 'From', name: 'from', type: 'date', value: filters.from || '', className: '' })}
      ${field({ label: 'To', name: 'to', type: 'date', value: filters.to || '', className: '' })}
      <div class="flex gap-2 pb-0.5">
        ${button({ label: 'Apply', type: 'submit', variant: 'primary' })}
        ${button({ label: 'Reset', action: 'reset-range' })}
      </div>
    </form>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      ${stat({ label: 'Total invoiced', value: money(data.invoiced.total_minor), hint: `${data.invoiced.count} issued invoice(s) in range` })}
      ${stat({ label: 'Amount collected', value: money(data.collected.total_minor), hint: `${data.collected.count} payment(s) received in range`, tone: 'text-emerald-700' })}
      ${stat({ label: 'Outstanding receivables', value: money(data.outstanding.total_minor), hint: `${data.outstanding.count} invoice(s) awaiting payment` })}
      ${stat({ label: 'Overdue', value: money(data.overdue.total_minor), hint: `${data.overdue.count} invoice(s) past due`, tone: data.overdue.count ? 'text-red-700' : '' })}
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      ${stat({ label: 'Collected this month', value: money(data.collected_this_month_minor) })}
      ${stat({ label: 'Quotations awaiting response', value: String(data.quotations.awaiting_response), hint: `${data.quotations.expired} expired` })}
      ${stat({ label: 'Quotations accepted', value: String(data.quotations.accepted), hint: `${data.quotations.rejected} rejected` })}
      ${stat({ label: 'Quotation conversion rate', value: `${(data.quotations.conversion_rate_bp / 100).toFixed(1)}%`,
        hint: `${data.quotations.converted} converted to invoices` })}
    </div>

    <div class="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
      ${card({ title: 'Recent invoices', actions: `<a class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent" href="#/invoices">View all</a>`, body: invoiceRows })}
      ${card({ title: 'Recent quotations', actions: `<a class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent" href="#/quotations">View all</a>`, body: quotationRows })}
    </div>

    <div class="mt-4">
      ${card({
    title: 'Upcoming payment due dates',
    subtitle: 'Issued invoices with a balance due in the next 30 days.',
    body: data.upcoming_dues.length
      ? `<div class="overflow-x-auto"><table class="data-table w-full min-w-[560px]">
          <thead><tr><th>Invoice</th><th>Client</th><th>Due date</th><th class="text-right">Balance due</th></tr></thead>
          <tbody>${data.upcoming_dues.map(row => `<tr>
            <td class="font-mono text-xs">${esc(row.invoice_number)}</td>
            <td>${esc(row.client_name)}</td>
            <td class="whitespace-nowrap">${date(row.due_date)}</td>
            <td class="num text-right">${money(row.balance_due_minor)}</td></tr>`).join('')}</tbody>
        </table></div>`
      : emptyState({ icon: 'event_available', title: 'Nothing due soon', message: 'No issued invoice has a balance falling due within 30 days.' }),
  })}
    </div>`;

  ctx.on('new-quotation', () => ctx.navigate('#/quotations/new'));
  ctx.on('new-invoice', () => ctx.navigate('#/invoices/new'));
  ctx.on('reset-range', () => { ctx.setFilters({}); ctx.setPage(1); ctx.rerender(); });
  container.querySelector('#range-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.target);
    ctx.setFilters({ from: String(form.get('from') || ''), to: String(form.get('to') || '') });
    ctx.rerender();
  });
};

export { pagination };
